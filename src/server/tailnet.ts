// `worklings --tailnet`: serves the hub on the person's tailnet with `tailscale serve`, as HTTPS at this computer's
// MagicDNS name proxied to the hub on 127.0.0.1, so their own devices reach it and the internet doesn't; and each
// running preview at an https port of its own on the same name (its proxy's port number), so a phone can open the app.
// It never runs `tailscale funnel`, refuses an address that Funnel shares or that already leads somewhere else, and stop
// removes only the entry it added. Nothing runs through a shell, every command has a time limit, and every failure is a
// sentence that says what to do.
//
// The commands follow `tailscale serve` as documented at https://tailscale.com/kb/1242/tailscale-serve (page last
// validated 26 Jan 2026): the syntax Tailscale 1.52 introduced, checked against the CLI's source at v1.104.5 (3 Nov 2026).
//
//   tailscale status --json --peers=false            this computer: its state, MagicDNS name and certificate names
//   tailscale serve status --json                    what is served: TCP, Web, AllowFunnel and Foreground (ipn.ServeConfig)
//   tailscale serve --bg --yes --https=<443 or the preview's port> --set-path=/ http://127.0.0.1:<port>
//   tailscale serve --https=<443 or the preview's port> --set-path=/ --yes off
//
// `--set-path=/` on `off` removes that one handler; without it, `off` removes every handler on the port. A failed command
// has saved nothing, but serve also exits 0 without saving anything while HTTPS still has to be turned on (it prints how,
// or waits), so a serve that succeeds is read back from `serve status`; `off` exits 0 only once its change is saved.
// Tailscale says its JSON may change, so every field is checked before it is used.
//
// A --bg entry outlives the hub, and a hub that crashes can't take its previews off. So each preview port is written
// down in a ledger in the hub's own folder before it is served, and crossed off once it is off again; a start takes off
// what an earlier run's ledger still lists, where it still leads to that same local port, and nothing else.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { oneLine } from '../core/events.ts';
import { tokenFile } from './token.ts';

/** The variable that names the Tailscale CLI to run, ahead of the PATH. */
const VARIABLE = 'WORKLINGS_TAILSCALE';
/** The office is at https://<name>/, so the port browsers use for HTTPS. */
const HTTPS_PORT = 443;
/** Each command answers in well under a second; one that takes this long is stuck, or waiting for someone. */
export const DEFAULT_TIMEOUT_MS = 20_000;
/** Status without peers and the serve config are a few kilobytes. */
const OUTPUT_LIMIT = 1024 * 1024;
/** The release that brought the `tailscale serve` syntax used here. */
const MIN_MAJOR = 1;
const MIN_MINOR = 52;

const STATUS = ['status', '--json', '--peers=false'];
const SERVE_STATUS = ['serve', 'status', '--json'];
const serveOff = (https: number) => ['serve', `--https=${https}`, '--set-path=/', '--yes', 'off'];
const serveOn = (port: number, https: number) => ['serve', '--bg', '--yes', `--https=${https}`, '--set-path=/', `http://127.0.0.1:${port}`];
/** The address browsers use for a port of the name: https://<name> for 443, https://<name>:<port> for any other. */
const originAt = (host: string, https: number) => (https === HTTPS_PORT ? `https://${host}` : `https://${host}:${https}`);

const NOT_INSTALLED = "Tailscale isn't installed: install it from tailscale.com and sign in, then try again.";
const NOT_RUNNING = "Tailscale is installed but isn't running: start Tailscale (or restart the computer), then try again.";
const NOT_SIGNED_IN = 'Tailscale is installed but not signed in: run tailscale up (or sign in from the Tailscale app), then try again.';
const NO_MAGICDNS =
  'MagicDNS is off for your tailnet: turn on MagicDNS and HTTPS certificates in the DNS page of the Tailscale admin console, then try again.';
const DENIED =
  "Tailscale didn't let Worklings change what this computer serves: run Worklings as the user signed in to Tailscale (on Linux, run sudo tailscale set --operator=$USER once), then try again.";
const BAD_OUTPUT = `Tailscale answered in a form Worklings doesn't understand: update Tailscale, and check that ${VARIABLE} or the PATH leads to it.`;

export type TailnetErrorCode =
  | 'not-installed'
  | 'not-running'
  | 'not-signed-in'
  /** Signed in but disconnected, still connecting, or in use by another user of this computer. */
  | 'not-connected'
  /** The tailnet's admin hasn't approved this computer yet. */
  | 'needs-approval'
  | 'no-magicdns'
  /** HTTPS certificates are off for the tailnet. */
  | 'no-https'
  | 'too-old'
  /** The address is shared on the internet through Funnel. */
  | 'funnel'
  /** The address already leads somewhere else. */
  | 'in-use'
  /** Tailscale didn't let this user change what it serves. */
  | 'denied'
  | 'timed-out'
  | 'bad-output'
  | 'failed';

/** Why the hub isn't on the tailnet (or is still on it), as a sentence that says what to do. */
export class TailnetError extends Error {
  readonly code: TailnetErrorCode;
  /** Tailscale's own first line, when it said something useful; null otherwise. */
  readonly detail: string | null;

  constructor(code: TailnetErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = 'TailnetError';
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding the CLI

export interface FoundTailscale {
  found: true;
  /** What to spawn: Tailscale's CLI, or this Node for a JavaScript stand-in. */
  command: string;
  /** Arguments before Tailscale's own: the script when `command` is Node. */
  prefixArgs: string[];
  /** The file that runs, for messages. */
  path: string;
}

export interface MissingTailscale {
  found: false;
  /** Why, as a sentence the person can act on. */
  reason: string;
}

export type TailscaleLookup = FoundTailscale | MissingTailscale;

function isFile(file: string): boolean {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    // A PATH entry that is a file, or a folder this user may not read: nothing to run there.
    return false;
  }
}

/** Windows variable names ignore case, and a copied environment keeps whatever case it had ("Path", "ProgramFiles"). */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32' || Object.hasOwn(env, name)) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, '$1');

/** How to run `file` without a shell, or null when only a shell could. A configured JavaScript file runs with this Node. */
function launch(file: string, platform: NodeJS.Platform, configured: boolean): FoundTailscale | null {
  const ext = (platform === 'win32' ? win32 : posix).extname(file).toLowerCase();
  if (configured && (ext === '.js' || ext === '.mjs' || ext === '.cjs')) return { found: true, command: process.execPath, prefixArgs: [file], path: file };
  if (platform !== 'win32' || ext === '.exe' || ext === '.com') return { found: true, command: file, prefixArgs: [], path: file };
  return null;
}

/**
 * Finds the Tailscale CLI: `configured` (startTailnet's `tailscale` option) first, then WORKLINGS_TAILSCALE, each the
 * full path to the executable or to a .js, .mjs or .cjs stand-in that runs with this Node; then the PATH; then, on
 * Windows, where the installer puts it (C:\Program Files\Tailscale\tailscale.exe). A configured path wins even when it
 * leads nowhere, since falling back past it would hide the mistake. Empty and relative PATH entries are skipped, so a
 * project folder can't supply a tailscale of its own. `exists` says whether a file is there (a folder doesn't count).
 */
export function findTailscale(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = isFile,
): TailscaleLookup {
  const p = platform === 'win32' ? win32 : posix;
  const exe = platform === 'win32' ? 'tailscale.exe' : 'tailscale';

  const option = unquote(configured ?? '');
  const variable = unquote(envValue(env, VARIABLE, platform) ?? '');
  const chosen = option !== '' ? { value: option, named: 'The Tailscale path' } : variable !== '' ? { value: variable, named: VARIABLE } : null;
  if (chosen) {
    if (!p.isAbsolute(chosen.value)) return { found: false, reason: `${chosen.named} must be the full path to ${exe}, but it is ${chosen.value}.` };
    if (!exists(chosen.value)) {
      return { found: false, reason: `${chosen.named} is set to ${chosen.value}, but there is no file there: set it to the full path of ${exe}, then try again.` };
    }
    return (
      launch(chosen.value, platform, true) ?? {
        found: false,
        reason: `${chosen.named} points to ${p.basename(chosen.value)}, which only a shell can run: set it to the full path of ${exe}, then try again.`,
      }
    );
  }

  const dirs = (envValue(env, 'PATH', platform) ?? '').split(p.delimiter).map(unquote).filter((dir) => dir !== '' && p.isAbsolute(dir));
  if (platform === 'win32') {
    for (const programs of [envValue(env, 'ProgramFiles', platform), 'C:\\Program Files']) {
      const dir = programs && p.isAbsolute(programs) ? p.join(programs, 'Tailscale') : null;
      if (dir && !dirs.some((known) => known.toLowerCase() === dir.toLowerCase())) dirs.push(dir);
    }
  }
  for (const dir of dirs) {
    const file = p.join(dir, exe);
    if (exists(file)) return { found: true, command: file, prefixArgs: [], path: file };
  }
  return { found: false, reason: NOT_INSTALLED };
}

// ---------------------------------------------------------------------------------------------------------------------
// Running it

interface Ran {
  /** The exit code, or null when something else stopped it. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The first non-empty line of what Tailscale printed, without terminal colour codes, cut to about `max` characters. */
function firstLine(text: string, max = 160): string {
  const plain = text.replace(/\p{Cc}\[[\d;?]*[A-Za-z]/gu, '');
  for (const line of plain.split(/\r?\n/)) {
    const clean = oneLine(line.replace(/\p{Cc}/gu, ' '), max);
    if (clean) return clean;
  }
  return '';
}

/** Text from Tailscale's own config (a target, a folder, a mount point) as one short line. */
const shown = (value: string) => oneLine(value.replace(/\p{Cc}/gu, ' '), 80);

/** URL.parse needs Node 22.1; the project supports 22.0. */
const urlOf = (text: string): URL | null => (URL.canParse(text) ? new URL(text) : null);

/**
 * The link Tailscale prints when HTTPS has to be turned on for the tailnet before serve can work (from its control
 * server: https://login.tailscale.com/f/serve?node=...). Only that host counts, so a link to the docs isn't taken for it.
 */
function enableLink(output: string): string | null {
  for (const [text] of output.matchAll(/https:\/\/login\.tailscale\.com\/[^\s"'<>]{1,240}/g)) {
    const url = urlOf(text);
    if (url?.hostname === 'login.tailscale.com') return url.href;
  }
  return null;
}

const noHttps = (link: string) => `HTTPS certificates are off for your tailnet: open ${link}, turn them on, then try again.`;

function timedOut(args: readonly string[], ms: number, output: string): TailnetError {
  const link = args[0] === 'serve' ? enableLink(output) : null;
  if (link) return new TailnetError('no-https', noHttps(link));
  const seconds = Math.round(ms / 100) / 10;
  return new TailnetError(
    'timed-out',
    `tailscale ${args[0] ?? ''} didn't answer within ${seconds} second${seconds === 1 ? '' : 's'}, so Worklings stopped it: check that Tailscale is connected, then try again.`,
  );
}

function startFailure(code: string, file: string): TailnetError {
  if (code === 'ENOENT') return new TailnetError('not-installed', `Couldn't find Tailscale at ${file}: install it from tailscale.com, or set ${VARIABLE} to its full path, then try again.`);
  if (code === 'EACCES' || code === 'EPERM') return new TailnetError('failed', `Worklings isn't allowed to run ${file}: check that it is a program you can run, then try again.`);
  return new TailnetError('failed', `Worklings couldn't start Tailscale at ${file} (${code}): check that it is a program you can run, then try again.`);
}

/**
 * Runs the CLI once with an argument list and no shell, killed after `timeoutMs`. Resolves with how it ended; rejects
 * with a TailnetError when it couldn't start, timed out or printed far more than any answer.
 */
function run(tool: FoundTailscale, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Ran> {
  return new Promise((resolve, reject) => {
    execFile(
      tool.command,
      [...tool.prefixArgs, ...args],
      { env, timeout: timeoutMs, maxBuffer: OUTPUT_LIMIT, windowsHide: true, shell: false, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr });
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new TailnetError('bad-output', BAD_OUTPUT));
        if (typeof error.code === 'string') return reject(startFailure(error.code, tool.path));
        if (error.killed) return reject(timedOut(args, timeoutMs, `${stdout}\n${stderr}`));
        resolve({ code: typeof error.code === 'number' ? error.code : null, stdout, stderr });
      },
    );
  });
}

/** A command that ended badly, as a sentence. */
function failure(args: readonly string[], ran: Ran): TailnetError {
  const said = `${ran.stderr}\n${ran.stdout}`;
  // Every variant starts so: "...local tailscaled process; is the Tailscale service running?", "...local Tailscale service".
  if (/failed to connect to (?:the )?local tailscale/i.test(said)) return new TailnetError('not-running', NOT_RUNNING);
  const line = firstLine(ran.stderr) || firstLine(ran.stdout);
  if (/access denied|permission denied/i.test(said)) return new TailnetError('denied', DENIED, line || null);
  const what = `tailscale ${args[0] ?? ''}`;
  const how = line ? `failed (${line})` : ran.code === null ? 'stopped unexpectedly' : `failed with exit code ${ran.code}`;
  const next = args[0] === 'serve' ? 'check tailscale serve status' : 'check that Tailscale is connected';
  return new TailnetError('failed', `${what} ${how}: ${next}, then try again.`, line || null);
}

const NOT_JSON = Symbol('not JSON');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON; // the caller says what that means
  }
}

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------------------------------
// This computer on the tailnet (`tailscale status --json`, an ipnstate.Status)

const DNS_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Self.DNSName is the FQDN with a trailing dot ("office-pc.tail1234.ts.net."); browsers send it without. */
function dnsName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.toLowerCase().replace(/\.$/, '');
  return DNS_NAME.test(name) ? name : null;
}

/** "1.50.1" when the daemon is older than the serve syntax used here; null when it is new enough or doesn't say. */
function tooOld(version: unknown): string | null {
  const match = typeof version === 'string' ? /^(\d{1,4})\.(\d{1,4})(?:\.\d{1,6})?/.exec(version) : null;
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR) ? match[0] : null;
}

/** What to do about a BackendState other than Running (ipn.State: NoState, InUseOtherUser, NeedsLogin, ...). */
function stateProblem(state: string): TailnetError | null {
  switch (state) {
    case 'Running':
      return null;
    case 'NeedsLogin':
      return new TailnetError('not-signed-in', NOT_SIGNED_IN);
    case 'NeedsMachineAuth':
      return new TailnetError(
        'needs-approval',
        'This computer is waiting for approval to join your tailnet: approve it on the Machines page of the Tailscale admin console, then try again.',
      );
    case 'Stopped':
      return new TailnetError('not-connected', 'Tailscale is signed in but disconnected: run tailscale up (or connect from the Tailscale app), then try again.');
    case 'Starting':
    case 'NoState':
      return new TailnetError('not-connected', 'Tailscale is still connecting: wait a moment, then try again.');
    case 'InUseOtherUser':
      return new TailnetError('not-connected', 'Tailscale on this computer is in use by another user: sign in to Tailscale as yourself, then try again.');
    default: {
      const said = /^\w{1,40}$/.test(state) ? ` (it says ${state})` : '';
      return new TailnetError('not-connected', `Tailscale isn't connected${said}: connect it from the Tailscale app, then try again.`);
    }
  }
}

/** This computer's MagicDNS name, once Tailscale is running, MagicDNS is on and the tailnet issues it a certificate. */
function machineName(stdout: string): string {
  const status = parseJson(stdout);
  if (!isObject(status) || typeof status.BackendState !== 'string') throw new TailnetError('bad-output', BAD_OUTPUT);
  const old = tooOld(status.Version);
  if (old) throw new TailnetError('too-old', `Tailscale ${old} is too old for --tailnet: update it to ${MIN_MAJOR}.${MIN_MINOR} or later, then try again.`);
  const problem = stateProblem(status.BackendState);
  if (problem) throw problem;
  const self = isObject(status.Self) ? status.Self : {};
  const tailnet = isObject(status.CurrentTailnet) ? status.CurrentTailnet : {};
  const host = dnsName(self.DNSName);
  if (!host || tailnet.MagicDNSEnabled === false) throw new TailnetError('no-magicdns', NO_MAGICDNS);
  // CertDomains lists the names the tailnet issues certificates for; it is empty while HTTPS is off (`tailscale cert`
  // reads it the same way). The admin console is where it is turned on, and doing so publishes the name.
  const certified = Array.isArray(status.CertDomains) && status.CertDomains.some((name) => typeof name === 'string' && name.toLowerCase() === host);
  if (!certified) {
    throw new TailnetError(
      'no-https',
      `HTTPS certificates are off for your tailnet: turn them on in the DNS page of the Tailscale admin console, then try again (that publishes ${host} in public certificate logs).`,
    );
  }
  return host;
}

// ---------------------------------------------------------------------------------------------------------------------
// What is served at https://<name>/ (`tailscale serve status --json`, an ipn.ServeConfig)

interface Served {
  /** The root handler leads to the hub, and to nothing else: the entry stop removes. */
  ours: boolean;
  /** Ours, and Tailscale listens for HTTPS on the port for it, so the office is reachable. */
  live: boolean;
  /** Set when Funnel shares the address on the internet. */
  funnel: TailnetError | null;
  /** Set when anything else uses the address: another handler, a TCP forward, a serve running in a terminal. */
  conflict: TailnetError | null;
}

/** A table's entry whose key matches without case (host names), or undefined. Only own keys count. */
function entryOf(table: unknown, key: string): unknown {
  if (!isObject(table)) return undefined;
  for (const [k, v] of Object.entries(table)) if (k.toLowerCase() === key) return v;
  return undefined;
}

/** True for a handler that proxies exactly to http://127.0.0.1:<port>, which is how startTailnet writes it. */
function leadsTo(handler: unknown, port: number): boolean {
  if (!isObject(handler) || typeof handler.Proxy !== 'string' || handler.Path || handler.Text || handler.Redirect) return false;
  const url = urlOf(handler.Proxy);
  return (
    url !== null && url.protocol === 'http:' && url.hostname === '127.0.0.1' && (url.port || '80') === String(port) &&
    url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === ''
  );
}

function described(handler: unknown): string {
  if (!isObject(handler)) return 'something else';
  if (typeof handler.Proxy === 'string' && handler.Proxy) return shown(handler.Proxy);
  if (typeof handler.Path === 'string' && handler.Path) return `the files in ${shown(handler.Path)}`;
  if (typeof handler.Redirect === 'string' && handler.Redirect) return `a redirect to ${shown(handler.Redirect)}`;
  if (typeof handler.Text === 'string') return 'a text page';
  return 'something else';
}

function inspect(stdout: string, host: string, port: number, https: number): Served {
  const config = parseJson(stdout);
  // Older releases print null when nothing is served, newer ones {}.
  if (config === null) return { ours: false, live: false, funnel: null, conflict: null };
  if (!isObject(config)) throw new TailnetError('bad-output', BAD_OUTPUT);
  const url = originAt(host, https);
  const hostPort = `${host}:${https}`;
  const funnelled = (sc: Fields) => entryOf(sc.AllowFunnel, hostPort) === true;
  // Foreground configs belong to a `tailscale serve` or `tailscale funnel` running in a terminal, keyed by its session.
  const foreground = isObject(config.Foreground) ? Object.values(config.Foreground).filter(isObject) : [];

  let funnel: TailnetError | null = null;
  if (funnelled(config)) {
    funnel = new TailnetError(
      'funnel',
      `Tailscale Funnel shares ${url} on the public internet, and Worklings never serves there: turn it off with tailscale funnel --https=${https} off, then try again.`,
    );
  } else if (foreground.some(funnelled)) {
    funnel = new TailnetError(
      'funnel',
      `A tailscale funnel running in a terminal shares ${url} on the public internet, and Worklings never serves there: stop it with Ctrl+C, then try again.`,
    );
  }

  const web = entryOf(config.Web, hostPort);
  if (web !== undefined && !(isObject(web) && (web.Handlers === undefined || web.Handlers === null || isObject(web.Handlers)))) {
    throw new TailnetError('bad-output', BAD_OUTPUT);
  }
  const handlers: Fields = isObject(web) && isObject(web.Handlers) ? web.Handlers : {};
  const tcp = entryOf(config.TCP, String(https));
  const ours = Object.hasOwn(handlers, '/') && leadsTo(handlers['/'], port);
  const live = ours && isObject(tcp) && tcp.HTTPS === true && !tcp.TCPForward;
  const usedInTerminal = foreground.some((sc) => entryOf(sc.TCP, String(https)) !== undefined || entryOf(sc.Web, hostPort) !== undefined);
  return { ours, live, funnel, conflict: conflictAt(host, https, usedInTerminal, tcp, handlers, ours) };
}

/** Anything at the address besides Worklings' own entry, as the sentence that refuses it. */
function conflictAt(host: string, https: number, usedInTerminal: boolean, tcp: unknown, handlers: Fields, ours: boolean): TailnetError | null {
  const url = originAt(host, https);
  const inUse = (message: string) => new TailnetError('in-use', message);
  if (usedInTerminal) return inUse(`A tailscale serve running in a terminal already uses ${url}: stop it with Ctrl+C, then try again.`);
  if (tcp !== undefined && !(isObject(tcp) && tcp.HTTPS === true && !tcp.TCPForward)) {
    if (isObject(tcp) && typeof tcp.TCPForward === 'string' && tcp.TCPForward) {
      const flag = tcp.TerminateTLS ? 'tls-terminated-tcp' : 'tcp';
      return inUse(
        `Port ${https} of ${host} already forwards TCP to ${shown(tcp.TCPForward)}, and Worklings won't replace it: remove it with tailscale serve --${flag}=${https} off, then try again.`,
      );
    }
    return inUse(`Port ${https} of ${host} is already in use by tailscale serve, and Worklings won't replace it: see tailscale serve status, then try again.`);
  }
  for (const [mount, handler] of Object.entries(handlers)) {
    if (mount === '/' && ours) continue;
    if (mount === '/') {
      return inUse(`${url} already serves ${described(handler)} on your tailnet, and Worklings won't replace it: remove it with tailscale serve --https=${https} off, then try again.`);
    }
    // Another app under the office's origin could read what the office keeps for that origin, the token included.
    const setPath = /\s/.test(mount) ? `"--set-path=${shown(mount)}"` : `--set-path=${shown(mount)}`;
    return inUse(
      `${url}${shown(mount)} already serves ${described(handler)}, and the office needs ${url} to itself: remove it with tailscale serve --https=${https} ${setPath} off, then try again.`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Serving

export interface TailnetOptions {
  /** The hub's port on 127.0.0.1. */
  port: number;
  /** Full path to the Tailscale CLI, or to a .js, .mjs or .cjs stand-in run with this Node; see findTailscale. */
  tailscale?: string;
  /** The environment to look for Tailscale in and run it with; process.env when not given. */
  env?: NodeJS.ProcessEnv;
  /** How long each Tailscale command may take; DEFAULT_TIMEOUT_MS when not given. */
  timeoutMs?: number;
  /**
   * The ledger of preview ports served on the tailnet: tailnet.json in the hub's own folder (~/.worklings, or under
   * WORKLINGS_HOME) when not given.
   */
  ledger?: string;
  /** Where the lines about an earlier run's leftovers go: the terminal when not given. */
  say?: (line: string) => void;
}

const LEDGER_FILE = 'tailnet.json';
/** The ledger holds a few ports, one per company's preview; a bigger file isn't one Worklings wrote. */
const LEDGER_BYTES = 64 * 1024;
const MAX_LEDGER = 64;

/** The preview ports a ledger lists. A missing or unreadable one lists none: nothing Worklings can vouch for. */
function readLedger(file: string): number[] {
  try {
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > LEDGER_BYTES) return [];
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    const ports: unknown[] = isObject(raw) && Array.isArray(raw.previews) ? raw.previews : [];
    const valid = ports.filter((p): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65_535 && p !== HTTPS_PORT);
    return [...new Set(valid)].slice(0, MAX_LEDGER);
  } catch {
    return []; // not JSON, or not readable: the next write replaces it
  }
}

/** Writes the ledger whole, through a temporary file, so a crash mid-write leaves the old one. */
function writeLedger(file: string, ports: Iterable<number>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, previews: [...ports].sort((a, b) => a - b) }, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

const errorCode = (error: unknown) => (error instanceof Error && 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '');

/** Something Worklings serves on the tailnet: the hub at 443, or a preview at a port of its own. */
export interface TailnetEntry {
  /** This computer's MagicDNS name, which browsers on the tailnet send as the Host: "office-pc.tail1234.ts.net". */
  host: string;
  /** The https port on that name. */
  port: number;
  /** https://<host>/ for 443, https://<host>:<port>/ for any other. */
  url: string;
  /**
   * Takes it off the tailnet: removes the entry Worklings added (or took over), if it is still there and still leads to
   * the same local port, and nothing else. Calling it again does nothing; after a failure, it tries again.
   */
  stop(): Promise<void>;
}

export interface Tailnet extends TailnetEntry {
  /**
   * Serves another local port on the tailnet, at https://<host>:<port>/ with the same port number (a preview proxy's),
   * under the same rules: never Funnel, never over anything else's entry. Its stop takes only it off.
   */
  serve(port: number): Promise<TailnetEntry>;
}

function stopFailure(error: unknown, url: string, https: number): unknown {
  if (!(error instanceof TailnetError)) return error;
  if (error.code === 'not-running') {
    return new TailnetError('not-running', `Tailscale isn't running, so Worklings couldn't take ${url} off your tailnet: once it runs again, run tailscale serve --https=${https} off.`);
  }
  const said = error.detail ? ` (${error.detail})` : '';
  return new TailnetError(error.code, `Worklings couldn't take ${url} off your tailnet${said}: run tailscale serve --https=${https} off to do it yourself.`, error.detail);
}

const checkPort = (port: number, what: string) => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${what}: port must be a whole number from 1 to 65535, got ${String(port)}.`);
};

/**
 * Serves the hub at https://<this computer's MagicDNS name>/ on the tailnet, proxied to http://127.0.0.1:<port>, in
 * the background (the entry outlives this process until stop removes it), once it has taken off the preview entries
 * an earlier run's ledger still lists (see the top of this file). Rejects with a TailnetError when Tailscale
 * isn't installed, running, signed in or connected, when MagicDNS or HTTPS certificates are off, when it is older than
 * 1.52, or when the address is shared through Funnel or already leads somewhere else; and with a plain Error for a call
 * that is wrong (a port that isn't one).
 */
export async function startTailnet(o: TailnetOptions): Promise<Tailnet> {
  const { port } = o;
  checkPort(port, 'startTailnet');
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new Error('startTailnet: timeoutMs must be a positive number of milliseconds.');
  const env = o.env ?? process.env;
  const tool = findTailscale(o.tailscale, env);
  if (!tool.found) throw new TailnetError('not-installed', tool.reason);

  const tailscale = (args: readonly string[]) => run(tool, args, env, timeoutMs);
  const answer = async (args: readonly string[]) => {
    const ran = await tailscale(args);
    if (ran.code !== 0) throw failure(args, ran);
    return ran.stdout;
  };

  const host = machineName(await answer(STATUS));

  const ledger = o.ledger ?? join(dirname(tokenFile()), LEDGER_FILE);
  const say = o.say ?? ((line: string) => void process.stderr.write(`worklings: ${line}\n`));
  /** The preview ports in the ledger: an earlier run's until the sweep, then this run's. */
  const noted = new Set(readLedger(ledger));
  /** Crosses a port off. A ledger that can't be written keeps it, and the next start looks at it again. */
  const forget = (local: number) => {
    if (!noted.delete(local)) return;
    try {
      writeLedger(ledger, noted);
    } catch (error) {
      say(`couldn't update ${ledger}${errorCode(error)}, so the next start looks at ${originAt(host, local)} again.`);
    }
  };
  /** Writes a port down before it is served, so a crash after that still leaves it in the ledger. */
  const remember = (local: number) => {
    if (noted.has(local)) return;
    noted.add(local);
    try {
      writeLedger(ledger, noted);
    } catch (error) {
      noted.delete(local);
      throw new TailnetError(
        'failed',
        `Worklings couldn't write ${originAt(host, local)} down in ${ledger}${errorCode(error)}, so it kept the preview off your tailnet: after a crash nothing would take it off.`,
      );
    }
  };

  /**
   * Takes off the preview entries an earlier run's ledger lists, where they still lead to that same local port, and
   * crosses off those that are gone or lead elsewhere now without touching them. Never rejects: an entry it can't take
   * off stays in the ledger, and the terminal says how to do it by hand.
   */
  async function sweep(): Promise<void> {
    if (noted.size === 0) return;
    let config: string;
    try {
      config = await answer(SERVE_STATUS);
    } catch (error) {
      say(`couldn't look for what an earlier run left on your tailnet: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const local of [...noted]) {
      const origin = originAt(host, local);
      try {
        if (!inspect(config, host, local, local).ours) {
          forget(local);
          continue;
        }
        const ran = await tailscale(serveOff(local));
        if (ran.code !== 0 && inspect(await answer(SERVE_STATUS), host, local, local).ours) throw failure(serveOff(local), ran);
        forget(local);
        say(`took ${origin} off your tailnet: a run that ended without cleaning up had left it there.`);
      } catch (error) {
        const failed = stopFailure(error, origin, local);
        say(`an earlier run left ${origin} on your tailnet. ${failed instanceof Error ? failed.message : String(failed)}`);
      }
    }
  }

  /** Serves http://127.0.0.1:<local> at the name's https port `https`, and returns how to take it off again. */
  async function expose(local: number, https: number): Promise<TailnetEntry> {
    const origin = originAt(host, https);
    const preview = https !== HTTPS_PORT;
    const served = async () => inspect(await answer(SERVE_STATUS), host, local, https);

    async function takeDown(): Promise<void> {
      try {
        if (!(await served()).ours) {
          // Gone, or someone else's by now: not ours to remove.
          if (preview) forget(local);
          return;
        }
        const ran = await tailscale(serveOff(https));
        // A failure needs a second look: the handler may have gone some other way meanwhile, which is all stop wants.
        if (ran.code !== 0 && (await served()).ours) throw failure(serveOff(https), ran);
        if (preview) forget(local);
      } catch (error) {
        throw stopFailure(error, origin, https);
      }
    }

    const before = await served();
    if (before.funnel) throw before.funnel;
    if (before.conflict) throw before.conflict;
    if (preview) remember(local);
    // An entry already leading to this port is an earlier run's (a --bg entry outlives a crash or a power cut): it is
    // taken over as it is, and stop removes it.
    if (!before.live) {
      const ran = await tailscale(serveOn(local, https));
      if (ran.code !== 0) {
        // A serve that failed saved nothing.
        if (preview) forget(local);
        throw failure(serveOn(local, https), ran);
      }
      const after = await served();
      if (after.funnel) {
        // Funnel came on for the address meanwhile: Worklings leaves it at once rather than be on the internet.
        if (after.ours) await takeDown();
        throw after.funnel;
      }
      if (!after.live) {
        const link = enableLink(`${ran.stdout}\n${ran.stderr}`);
        if (link) throw new TailnetError('no-https', noHttps(link));
        const line = firstLine(ran.stderr) || firstLine(ran.stdout);
        throw new TailnetError(
          'failed',
          `tailscale serve finished but didn't add ${origin}${line ? ` (it said: ${line})` : ''}: check tailscale serve status, then try again.`,
          line || null,
        );
      }
    }

    let stopping: Promise<void> | null = null;
    return {
      host,
      port: https,
      url: `${origin}/`,
      stop() {
        stopping ??= takeDown().catch((error: unknown) => {
          stopping = null;
          throw error;
        });
        return stopping;
      },
    };
  }

  await sweep();
  const hub = await expose(port, HTTPS_PORT);
  return {
    ...hub,
    async serve(local: number) {
      checkPort(local, 'serve');
      // 443 is the office's: a preview there would share its origin, and what the office keeps for it.
      if (local === HTTPS_PORT) throw new Error(`serve: port ${HTTPS_PORT} is the office's own.`);
      return expose(local, local);
    },
  };
}

/**
 * For `worklings doctor`: this computer's MagicDNS name once --tailnet could serve the hub there, or the TailnetError
 * that says what to do first. It runs only `tailscale status`, which changes nothing.
 */
export async function tailnetReady(o: Pick<TailnetOptions, 'tailscale' | 'env' | 'timeoutMs'> = {}): Promise<string> {
  const env = o.env ?? process.env;
  const tool = findTailscale(o.tailscale, env);
  if (!tool.found) throw new TailnetError('not-installed', tool.reason);
  const ran = await run(tool, STATUS, env, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (ran.code !== 0) throw failure(STATUS, ran);
  return machineName(ran.stdout);
}
