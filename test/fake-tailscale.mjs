// A stand-in for the Tailscale CLI for test/tailnet.test.ts. It never touches a network or a real Tailscale. Point
// startTailnet's `tailscale` option (or WORKLINGS_TAILSCALE) at this file and Worklings runs it with the current Node.
//
// It answers the commands src/server/tailnet.ts runs the way Tailscale 1.104.5's CLI does (cmd/tailscale/cli/serve_v2.go
// and ipn/serve.go at that tag): flags parsed like Go's flag package, so a flag after the target or one it doesn't know
// fails as it would there.
//   status --json [--peers=false]       prints `status` from the state file (an ipnstate.Status)
//   serve status --json                 prints the serve config (an ipn.ServeConfig): {} when nothing is served
//   serve --bg [--yes] [--https=<port>] [--set-path=<path>] <target>
//                                       adds a web handler as SetWebHandler does, and turns Funnel off for that address
//   serve [--https=<port>] [--set-path=<path>] [--yes] off
//                                       removes that handler, or every handler on the port without --set-path, and
//                                       the port and its Funnel flag once none is left
// Serving in the foreground (no --bg), a removal the real CLI would ask about, and `tailscale funnel` fail with exit
// code 3 and a "fake-tailscale:" message: Worklings must never get there.
//
// Everything lives in the folder FAKE_TAILSCALE_DIR names:
//   state.json   { status, serve, fail }: what `status --json` prints, the serve config (missing or {} for none, null
//                to answer null as older releases do), and optionally a mode per command, keyed status, serveStatus,
//                serveOn or serveOff. The fake writes `serve` back after each change.
//   calls.jsonl  one {"argv": [...]} line per run, written before it acts.
// Modes:
//   not-running     what Tailscale prints on Windows when its service isn't running, exit code 1
//   denied          an access-denied error, exit code 1
//   error           "error: something broke" on stderr, exit code 1
//   bad-json        plain text, exit code 0
//   no-op           exit code 0 without a word or a change
//   https-off       how to turn HTTPS on, with its link, then exit code 0 and no change (control says not to wait)
//   https-off-wait  the same, then waits for HTTPS to come on (it never does)
//   hang            never answers (gives up after five minutes)
//   also-funnel     serveOn only: does the change, and Funnel comes on for the address at the same time
//   gone            serveOff only: the handler goes some other way just before, so the command finds nothing to remove
//                   and fails as Tailscale does then
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GIVE_UP_MS = 5 * 60_000;
const ENABLE_LINK = 'https://login.tailscale.com/f/serve?node=nFAKE0000CNTRL';

class Exit extends Error {
  constructor(code, stderr = '', stdout = '') {
    super(stderr);
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

const usage = (command) => `try \`tailscale ${command} --help\` for usage info`;

function folder() {
  const dir = process.env.FAKE_TAILSCALE_DIR;
  if (!dir) throw new Exit(3, 'fake-tailscale: FAKE_TAILSCALE_DIR is not set.\n');
  return dir;
}

/** Go's flag package: flags until the first argument that isn't one; --name, -name, --name=value or --name value. */
function parseFlags(args, kinds) {
  const flags = {};
  let i = 0;
  for (; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      i += 1;
      break;
    }
    if (!arg.startsWith('-') || arg === '-') break;
    const body = arg.replace(/^--?/, '');
    const equals = body.indexOf('=');
    const name = equals === -1 ? body : body.slice(0, equals);
    const kind = kinds[name];
    if (!kind) throw new Exit(2, `flag provided but not defined: -${name}\n`);
    if (kind === 'bool') {
      const value = equals === -1 ? 'true' : body.slice(equals + 1);
      if (!['true', 'false', '1', '0'].includes(value)) throw new Exit(2, `invalid boolean value ${JSON.stringify(value)} for -${name}\n`);
      flags[name] = value === 'true' || value === '1';
      continue;
    }
    const value = equals === -1 ? args[++i] : body.slice(equals + 1);
    if (value === undefined) throw new Exit(2, `flag needs an argument: -${name}\n`);
    if (kind === 'uint' && !/^\d+$/.test(value)) throw new Exit(2, `invalid value ${JSON.stringify(value)} for flag -${name}: parse error\n`);
    flags[name] = kind === 'uint' ? Number(value) : value;
  }
  return { flags, rest: args.slice(i) };
}

const SERVE_FLAGS = {
  'accept-app-caps': 'string',
  bg: 'bool',
  http: 'uint',
  https: 'uint',
  'proxy-protocol': 'uint',
  service: 'string',
  'set-path': 'string',
  tcp: 'uint',
  'tls-terminated-tcp': 'uint',
  tun: 'bool',
  yes: 'bool',
};

function hostOf(state) {
  const name = state.status?.Self?.DNSName;
  if (typeof name !== 'string' || name === '') throw new Exit(1, 'getting client status: no self node\n');
  return name.replace(/\.$/, '');
}

/** ExpandProxyTargetValue, for the targets a test gives: a port, host:port, or a URL. */
function expandTarget(target) {
  if (/^\d+$/.test(target)) return `http://127.0.0.1:${Number(target)}`;
  const full = target.includes('://') ? target : `http://${target}`;
  let url;
  try {
    url = new URL(full);
  } catch {
    throw new Exit(1, `error: failed apply web serve: invalid URL parse "${full}"\n\n${usage('serve')}\n`);
  }
  if (!['http:', 'https:', 'https+insecure:'].includes(url.protocol)) {
    throw new Exit(1, `error: failed apply web serve: must be a URL starting with one of the supported schemes: [http https https+insecure unix]\n\n${usage('serve')}\n`);
  }
  return full;
}

/** Drops empty maps, as the real config does ("Clear empty maps, mostly for testing"). */
function tidy(sc) {
  for (const key of ['TCP', 'Web', 'AllowFunnel']) {
    if (sc[key] && Object.keys(sc[key]).length === 0) delete sc[key];
  }
  return sc;
}

function serveOn(state, flags, target, mode) {
  if (!flags.bg) throw new Exit(3, 'fake-tailscale: this fake only serves in the background (--bg); in the foreground the real CLI blocks.\n');
  const kinds = ['https', 'http', 'tcp', 'tls-terminated-tcp'].filter((kind) => flags[kind] !== undefined);
  if (kinds.length > 1) throw new Exit(1, `error: cannot serve multiple types for a single mount point\n\n${usage('serve')}\n`);
  if (kinds[0] && kinds[0] !== 'https') throw new Exit(3, `fake-tailscale: --${kinds[0]} isn't something this fake serves.\n`);
  const port = flags.https ?? 443;
  const mount = flags['set-path'] === undefined || flags['set-path'] === '' ? '/' : flags['set-path'];
  const host = hostOf(state);
  const hp = `${host}:${port}`;
  const sc = state.serve ?? {};
  if (sc.TCP?.[port]?.TCPForward) throw new Exit(1, `error: failed apply web serve: cannot serve web; already serving TCP\n\n${usage('serve')}\n`);
  const proxy = expandTarget(target);

  sc.TCP = { ...sc.TCP, [port]: { HTTPS: true } };
  sc.Web = { ...sc.Web };
  const web = (sc.Web[hp] = { Handlers: { ...sc.Web[hp]?.Handlers } });
  web.Handlers[mount] = { Proxy: proxy };
  // "If the new mount point ends in / and another mount point shares the same prefix, remove the other handler."
  for (const other of Object.keys(web.Handlers)) {
    if (other !== mount && other.replace(/\/$/, '') === mount.replace(/\/$/, '')) delete web.Handlers[other];
  }
  let stderr = '';
  if (sc.AllowFunnel && Object.hasOwn(sc.AllowFunnel, hp)) {
    stderr += `Removing Funnel for ${host}:${hp}\n`;
    delete sc.AllowFunnel[hp];
  }
  if (mode === 'also-funnel') sc.AllowFunnel = { ...sc.AllowFunnel, [hp]: true };
  state.serve = tidy(sc);
  const where = port === 443 ? `https://${host}${mount}` : `https://${host}:${port}${mount}`;
  const stdout = [
    'Available within your tailnet:',
    '',
    where,
    `|-- proxy ${proxy}`,
    '',
    'Serve started and running in the background.',
    `To disable the proxy, run: tailscale serve --https=${port} off`,
    '',
  ].join('\n');
  return { stdout, stderr };
}

function serveOff(state, flags) {
  const kinds = ['https', 'http', 'tcp', 'tls-terminated-tcp'].filter((kind) => flags[kind] !== undefined);
  if (kinds[0] && kinds[0] !== 'https') throw new Exit(3, `fake-tailscale: --${kinds[0]} isn't something this fake removes.\n`);
  const port = flags.https ?? 443;
  const host = hostOf(state);
  const hp = `${host}:${port}`;
  const sc = state.serve ?? {};
  if (sc.TCP?.[port]?.TCPForward) {
    throw new Exit(1, `error: failed to remove web serve: cannot remove web handler; currently serving TCP\n\n${usage('serve')}\n`);
  }
  const handlers = sc.Web?.[hp]?.Handlers ?? {};
  const setPath = flags['set-path'];
  const mounts = setPath === undefined || setPath === '' ? Object.keys(handlers) : Object.hasOwn(handlers, setPath) ? [setPath] : [];
  if (mounts.length === 0) throw new Exit(1, `error: failed to remove web serve: handler does not exist\n\n${usage('serve')}\n`);
  if (mounts.length > 1 && !flags.yes) {
    throw new Exit(3, `fake-tailscale: the real CLI would ask "Are you sure you want to delete ${mounts.length} handlers under port ${port}?" here.\n`);
  }
  for (const mount of mounts) delete handlers[mount];
  if (Object.keys(handlers).length === 0) {
    if (sc.Web) delete sc.Web[hp];
    if (sc.TCP) delete sc.TCP[port];
    if (sc.AllowFunnel) delete sc.AllowFunnel[hp];
  }
  state.serve = tidy(sc);
  return { stdout: '', stderr: '' };
}

function failWith(mode, command) {
  switch (mode) {
    case 'not-running':
      throw new Exit(1, 'failed to connect to local tailscaled process; is the Tailscale service running?\n');
    case 'denied':
      throw new Exit(1, 'Access denied: serve config denied\n');
    case 'error':
      throw new Exit(1, `error: something broke\n\n${usage(command)}\n`);
    case 'bad-json':
      throw new Exit(0, '', 'this is not JSON\n');
    case 'no-op':
      throw new Exit(0);
    case 'https-off':
      throw new Exit(0, '', `\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         ${ENABLE_LINK}\n\n`);
    default:
      return;
  }
}

function waitForever(stdout) {
  process.stdout.write(stdout);
  setTimeout(() => process.exit(1), GIVE_UP_MS);
}

function main() {
  const argv = process.argv.slice(2);
  const dir = folder();
  appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify({ argv })}\n`);
  const file = join(dir, 'state.json');
  const state = JSON.parse(readFileSync(file, 'utf8'));

  if (argv[0] === 'funnel') throw new Exit(3, 'fake-tailscale: Worklings must never run tailscale funnel.\n');
  if (argv[0] !== 'status' && argv[0] !== 'serve') throw new Exit(3, `fake-tailscale: no such command here: ${JSON.stringify(argv[0] ?? '')}.\n`);

  const command = argv[0] === 'status' ? 'status' : argv[1] === 'status' ? 'serveStatus' : argv.at(-1) === 'off' ? 'serveOff' : 'serveOn';
  const mode = state.fail?.[command];
  if (mode === 'hang') return waitForever('');
  if (mode === 'https-off-wait') return waitForever(`\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         ${ENABLE_LINK}\n\n`);
  failWith(mode, argv[0]);

  if (command === 'status') {
    const { flags, rest } = parseFlags(argv.slice(1), { json: 'bool', peers: 'bool', active: 'bool', self: 'bool', header: 'bool' });
    if (!flags.json || rest.length > 0) throw new Exit(3, 'fake-tailscale: only `status --json` is answered here.\n');
    return { stdout: `${JSON.stringify(state.status, null, 2)}\n`, stderr: '' };
  }
  if (command === 'serveStatus') {
    const { flags, rest } = parseFlags(argv.slice(2), { json: 'bool' });
    if (!flags.json || rest.length > 0) throw new Exit(3, 'fake-tailscale: only `serve status --json` is answered here.\n');
    return { stdout: `${JSON.stringify(state.serve === undefined ? {} : state.serve, null, 2)}\n`, stderr: '' };
  }

  const { flags, rest } = parseFlags(argv.slice(1), SERVE_FLAGS);
  if (rest.length === 0) throw new Exit(0, `USAGE\n  tailscale serve [flags] <target> [off]\n`);
  if (rest.length > 2) throw new Exit(1, `Error: invalid number of arguments (${rest.length})\n${usage('serve')}\n`);
  const turnOff = rest.at(-1) === 'off';
  if (rest.length === 2 && !turnOff) throw new Exit(1, `Error: invalid argument format\n${usage('serve')}\n`);
  if (turnOff && mode === 'gone') {
    state.serve = {};
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    throw new Exit(1, `error: failed to remove web serve: handler does not exist\n\n${usage('serve')}\n`);
  }
  const result = turnOff ? serveOff(state, flags) : serveOn(state, flags, rest[0], mode);
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return result;
}

try {
  const result = main();
  if (result) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
} catch (error) {
  if (!(error instanceof Exit)) throw error;
  process.stdout.write(error.stdout);
  process.stderr.write(error.stderr);
  process.exitCode = error.code;
}
