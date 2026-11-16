// The package as people get it. Packs Worklings as `npm publish` would, installs the tarball in a clean folder as
// `npx worklings` does, and runs it there: --version, doctor, the hub's lobby with no command, and the demo company.
//
//   node scripts/check-package.mjs [--keep] [--old-node <path to node 18 or 20>]
//   npm run check:package
//
// It never needs the real Claude Code: test/fake-claude.mjs stands in, as WORKLINGS_CLAUDE (and test/fake-tailscale.mjs
// for Tailscale). It never touches the repo's own dist/, which other work may be using: it builds into a staging folder
// with the same commands `npm run build` runs, and packs from there with the repo's package.json, so the `files` list
// is what decides. It also lists what `npm pack` would take from the repo as it is, to catch a `files` entry that lets
// in something it shouldn't. The hub and the demo listen on free ports between 4380 and 4395 (never the e2e suite's).
// Everything goes in one temp folder, deleted at the end unless --keep. Exit code 0 when every check passes.
import { execFile, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { keep: { type: 'boolean' }, 'old-node': { type: 'string' } } });

/** The most the packed tarball may weigh: the web app's 3D art and fonts are most of it. */
const MAX_PACKED = 4 * 1024 * 1024;
/** Ports this check may listen on: 4380 to 4395 without the e2e suite's 4387 to 4389. */
const PORTS = [4380, 4381, 4382, 4383, 4384, 4385, 4386, 4390, 4391, 4392, 4393, 4394, 4395];
const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'dist/bin.js', 'dist/cli.js', 'dist/paths.js', 'dist/hub/real.js', 'dist/web/index.html', 'dist/web/THIRD-PARTY-NOTICES.md', 'library/README.md', 'CREDITS.md', 'THIRD-PARTY-NOTICES.md'];
const FORBIDDEN = [
  [/^(src|test|scripts|web|plugin|docs|\.claude|\.github|node_modules|test-results|playwright-report)\//, 'a source, test or tooling folder'],
  [/^dist\/site\//, 'the static web demo, which is deployed apart'],
  [/(?<!\.d)\.(ts|tsx|mts|cts)$/, 'TypeScript source'],
  [/\.map$/, 'a source map'],
  [/\.tsbuildinfo$/, "TypeScript's build cache"],
  [/(^|\/)\.env(\.|$)/, 'an environment file'],
];

const started = Date.now();
const lines = [];
const say = (line = '') => {
  lines.push(line);
  process.stdout.write(`${line}\n`);
};
const failures = [];
const fail = (line) => {
  failures.push(line);
  say(`  FAILED: ${line}`);
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/** npm's own CLI script, run with this Node: npm and npx are shell scripts on Windows, and nothing here uses a shell. */
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((c) => c && /npm-cli\.js$/.test(c) && existsSync(c));
  if (!found) throw new Error(`Couldn't find npm's npm-cli.js beside ${process.execPath}. Run this as \`npm run check:package\`.`);
  return found;
}

/** Kills a process and what it started: taskkill /T on Windows, its process group elsewhere. */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve();
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL'); // its group is gone already: make sure of the process itself
    }
    return Promise.resolve();
  }
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  return new Promise((done) => execFile(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => done()));
}

/** Runs a program from an argument list, never a shell, and resolves with how it ended; stopped after `timeoutMs`. */
function run(command, argv, { cwd = repo, env = process.env, timeoutMs = 600_000 } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, argv, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.stdin.end();
    const timer = setTimeout(() => {
      void killTree(child);
      reject(new Error(`${[command, ...argv].join(' ')} took longer than ${timeoutMs / 1000} s.`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

/** Runs it and fails the whole check when it doesn't exit with 0, with the end of what it said. */
async function must(what, command, argv, options) {
  const result = await run(command, argv, options);
  if (result.code !== 0) throw new Error(`${what} failed with exit code ${result.code}:\n${(result.stderr || result.stdout).trim().split('\n').slice(-15).join('\n')}`);
  return result;
}

function freePortFrom(candidates, taken) {
  return candidates.reduce(
    (found, port) =>
      found.then((already) => {
        if (already !== null || taken.has(port)) return already;
        return new Promise((done) => {
          const probe = createServer();
          probe.once('error', () => done(null));
          probe.listen(port, '127.0.0.1', () => probe.close(() => done(port)));
        });
      }),
    Promise.resolve(null),
  );
}

/** Every package under node_modules, nested ones too, with what would make it native or run code at install. */
function scanPackages(nodeModules) {
  const found = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      if (name.startsWith('@')) {
        visit(path);
        continue;
      }
      const manifest = join(path, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      const scripts = pkg.scripts ?? {};
      const native = [];
      for (const hook of ['preinstall', 'install', 'postinstall']) if (scripts[hook]) native.push(`a ${hook} script`);
      if (pkg.gypfile) native.push('gypfile');
      const walk = (folder, depth) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          const inner = join(folder, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules' && depth < 8) walk(inner, depth + 1);
          else if (entry.isFile() && (entry.name.endsWith('.node') || entry.name === 'binding.gyp')) native.push(inner.slice(path.length + 1).replaceAll('\\', '/'));
        }
      };
      walk(path, 0);
      found.push({ name: pkg.name, version: pkg.version, native });
      visit(join(path, 'node_modules'));
    }
  };
  visit(nodeModules);
  return found;
}

/** Starts the installed CLI and waits until it has printed `until`; resolves with what it printed and the child. */
function startCli(bin, argv, env, until) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [bin, ...argv], { env, windowsHide: true, detached: process.platform !== 'win32' });
    let text = '';
    const timer = setTimeout(() => reject(new Error(`worklings ${argv.join(' ')} didn't start within 60 s:\n${text}`)), 60_000);
    child.stdout.on('data', (c) => {
      text += c;
      if (until.test(text)) {
        clearTimeout(timer);
        done({ child, text });
      }
    });
    child.stderr.on('data', (c) => (text += c));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`worklings ${argv.join(' ')} exited with ${code}:\n${text}`));
    });
  });
}

/** GETs a page and says what came back, in one line for the report. */
async function page(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const body = await res.text();
  return { status: res.status, type: res.headers.get('content-type') ?? '', body };
}

const root = mkdtempSync(join(tmpdir(), 'worklings-package-'));
const stage = join(root, 'stage');
const packDir = join(root, 'pack');
const install = join(root, 'install');
const home = join(root, 'home');
const tailscale = join(root, 'tailscale');
const children = [];

/** This process's environment without a Claude Code session's wiring, which a check run from inside one would pass on. */
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CLAUDECODE$|^CLAUDE_CODE_|^CLAUDE_AGENT_SDK_/i.test(key)));

try {
  const npm = npmCli();
  const npmEnv = { ...clean, npm_config_cache: join(root, 'npm-cache'), npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const npmVersion = (await must('npm --version', process.execPath, [npm, '--version'])).stdout.trim();
  say(`Worklings package check: ${pkg.name} ${pkg.version} on ${process.platform}, Node ${process.versions.node}, npm ${npmVersion}`);
  say(`  Working in ${root}`);
  say();

  // What `npm pack` would take from the repo as it stands: the `files` list must keep out whatever else is in there.
  const dry = JSON.parse((await must('npm pack --dry-run in the repo', process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], { env: npmEnv })).stdout)[0];
  const strays = dry.files.flatMap((f) => FORBIDDEN.filter(([pattern]) => pattern.test(f.path)).map(([, why]) => `${f.path} (${why})`));
  if (strays.length > 0) fail(`package.json's files would ship ${strays.length} file(s) from the repo that don't belong: ${strays.slice(0, 5).join(', ')}`);
  else say(`From the repo as it stands, npm pack would take ${dry.entryCount} files and nothing that doesn't belong.`);

  // Stage: what `files` names besides dist/, then dist/ built the way `npm run build` builds it.
  mkdirSync(stage, { recursive: true });
  cpSync(join(repo, 'package.json'), join(stage, 'package.json'));
  for (const entry of [...(pkg.files ?? []), 'README.md', 'LICENSE']) {
    if (entry.startsWith('!') || entry === 'dist' || entry.startsWith('dist/')) continue;
    if (existsSync(join(repo, entry))) cpSync(join(repo, entry), join(stage, entry), { recursive: true });
  }
  const buildStarted = Date.now();
  await must('tsc', process.execPath, [join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.node.json', '--outDir', join(stage, 'dist')]);
  await must('vite build', process.execPath, [join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', join(stage, 'dist', 'web'), '--emptyOutDir', '--logLevel', 'error']);
  say(`Built the runtime and the web app into the staging folder in ${Math.round((Date.now() - buildStarted) / 1000)} s.`);

  // Pack.
  mkdirSync(packDir, { recursive: true });
  const info = JSON.parse((await must('npm pack', process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', packDir], { cwd: stage, env: npmEnv })).stdout)[0];
  const tarball = join(packDir, info.filename);
  const paths = info.files.map((f) => f.path);
  say();
  say(`Tarball: ${info.filename}, ${mb(info.size)} packed, ${mb(info.unpackedSize)} unpacked, ${info.entryCount} files`);
  const groups = new Map();
  /** "README.md", "dist/*" for dist's own files, "dist/core/", and the web app's folders as "dist/web/assets/". */
  const groupOf = (path) => {
    const parts = path.split('/');
    if (parts.length === 1) return path;
    if (parts[0] === 'dist' && parts[1] === 'web' && parts.length > 3) return `dist/web/${parts[2]}/`;
    return parts.length > 2 ? `${parts[0]}/${parts[1]}/` : `${parts[0]}/*`;
  };
  for (const f of info.files) {
    const key = groupOf(f.path);
    const g = groups.get(key) ?? { files: 0, size: 0 };
    g.files += 1;
    g.size += f.size;
    groups.set(key, g);
  }
  for (const [key, g] of [...groups].sort((a, b) => b[1].size - a[1].size)) say(`  ${key.padEnd(28)} ${mb(g.size).padStart(9)}  ${String(g.files).padStart(3)} file(s)`);
  const missing = REQUIRED.filter((p) => !paths.includes(p));
  if (!paths.some((p) => /^dist\/web\/assets\/.+\.js$/.test(p))) missing.push('dist/web/assets/*.js');
  if (!paths.some((p) => /^library\/roles\/.+\.md$/.test(p))) missing.push('library/roles/*.md');
  if (missing.length > 0) fail(`The tarball lacks ${missing.join(', ')}.`);
  const forbidden = paths.flatMap((p) => FORBIDDEN.filter(([pattern]) => pattern.test(p)).map(([, why]) => `${p} (${why})`));
  if (forbidden.length > 0) fail(`The tarball holds what it shouldn't: ${forbidden.slice(0, 5).join(', ')}`);
  if (info.size > MAX_PACKED) fail(`The tarball is ${mb(info.size)}, over the ${mb(MAX_PACKED)} it may weigh.`);
  if (missing.length === 0 && forbidden.length === 0 && info.size <= MAX_PACKED) {
    say(`Contents: the prebuilt runtime (dist/bin.js runs it), the web app and the library; no sources, tests or maps; under ${mb(MAX_PACKED)}.`);
  }

  // Install the tarball into a clean folder, as npx does.
  mkdirSync(install, { recursive: true });
  writeFileSync(join(install, 'package.json'), `${JSON.stringify({ name: 'worklings-package-check', version: '0.0.0', private: true }, null, 2)}\n`);
  const installStarted = Date.now();
  await must('npm install of the tarball', process.execPath, [npm, 'install', tarball, '--no-package-lock', '--loglevel', 'error'], { cwd: install, env: npmEnv });
  const packages = scanPackages(join(install, 'node_modules'));
  say();
  say(`Installed in a clean folder in ${Math.round((Date.now() - installStarted) / 1000)} s: ${packages.map((p) => `${p.name}@${p.version}`).join(', ')}.`);
  const natives = packages.filter((p) => p.native.length > 0);
  if (natives.length > 0) fail(`Native code or install scripts: ${natives.map((p) => `${p.name} (${p.native.join(', ')})`).join('; ')}`);
  else say('No native modules: no install scripts, no gypfile, no binding.gyp and no .node file in any of them.');

  const bin = join(install, 'node_modules', 'worklings', 'dist', 'bin.js');
  mkdirSync(home, { recursive: true });
  mkdirSync(tailscale, { recursive: true });
  const host = 'office-pc.tail1234.ts.net';
  writeFileSync(join(tailscale, 'state.json'), JSON.stringify({ status: { Version: '1.104.5', BackendState: 'Running', Self: { DNSName: `${host}.` }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [host] } }));
  const cliEnv = { ...clean, WORKLINGS_HOME: home, WORKLINGS_CLAUDE: join(repo, 'test', 'fake-claude.mjs'), FAKE_CLAUDE_AUTH: 'signed-in', WORKLINGS_TAILSCALE: join(repo, 'test', 'fake-tailscale.mjs'), FAKE_TAILSCALE_DIR: tailscale };

  // npx worklings --version, through npm's own bin shim in the installed folder.
  const version = await must('npx worklings --version', process.execPath, [npm, 'exec', '--no', '--', 'worklings', '--version'], { cwd: install, env: { ...npmEnv, ...cliEnv } });
  say();
  if (version.stdout.trim() === pkg.version) say(`npx worklings --version: ${version.stdout.trim()}`);
  else fail(`npx worklings --version printed "${version.stdout.trim()}", not ${pkg.version}.`);

  const taken = new Set();
  const hubPort = await freePortFrom(PORTS, taken);
  if (hubPort === null) throw new Error(`None of the ports ${PORTS.join(', ')} is free.`);
  taken.add(hubPort);
  taken.add(hubPort + 1);

  // worklings doctor, with the fakes, checking the hub's port this check uses rather than the real default.
  const doctor = await run(process.execPath, [bin, 'doctor', '--port', String(hubPort)], { env: cliEnv, timeoutMs: 120_000 });
  say(`worklings doctor --port ${hubPort}: exit code ${doctor.code}`);
  for (const line of doctor.stdout.trimEnd().split('\n')) say(`  | ${line}`);
  if (doctor.code !== 0) fail('worklings doctor found a problem with everything faked as present.');

  // worklings with no command: the hub's lobby, and the demo company's address on it.
  const hub = await startCli(bin, ['--port', String(hubPort), '--no-open'], cliEnv, /Press Ctrl\+C to stop\./);
  children.push(hub.child);
  const link = /Open: (\S+)/.exec(hub.text)?.[1] ?? '';
  const token = new URL(link).searchParams.get('token') ?? '';
  const lobbyPage = await page(link);
  const script = /<script[^>]+src="([^"]+\.js)"/.exec(lobbyPage.body)?.[1] ?? null;
  const asset = script ? await page(new URL(script, link)) : null;
  const demoPage = await page(new URL('/c/demo', link));
  const lobby = await page(new URL('/api/lobby', link), { authorization: `Bearer ${token}` });
  const lobbyJson = lobby.status === 200 ? JSON.parse(lobby.body) : null;
  say();
  say(`worklings --port ${hubPort} (no command) opened the hub: ${hub.text.split('\n')[0]}`);
  say(`  GET / ${lobbyPage.status} ${lobbyPage.type.split(';')[0]}, ${script ?? 'no script'} ${asset?.status ?? '-'}, GET /c/demo ${demoPage.status} ${demoPage.type.split(';')[0]}, GET /api/lobby ${lobby.status} (${lobbyJson ? `${lobbyJson.companies.length} companies` : 'no lobby'})`);
  if (lobbyPage.status !== 200 || !lobbyPage.type.startsWith('text/html') || !script) fail("The hub's lobby page didn't come back as the web app.");
  if (asset?.status !== 200) fail(`The web app's script ${script} didn't load from the hub.`);
  if (demoPage.status !== 200 || demoPage.body !== lobbyPage.body) fail('/c/demo on the hub isn\'t the web app.');
  if (!lobbyJson || !Array.isArray(lobbyJson.companies)) fail("The hub's /api/lobby didn't answer with a lobby.");
  if (!hub.text.includes('/c/demo?token=')) fail("The hub's first-run lines don't offer the demo company.");

  // The lobby's first-run check, and stopping the hub by its lock as the plugin does.
  const setup = await page(new URL('/api/setup', link), { authorization: `Bearer ${token}` });
  const claude = setup.status === 200 ? JSON.parse(setup.body).claude : null;
  const health = await page(new URL('/api/health', link), { authorization: `Bearer ${token}` });
  const healthPid = health.status === 200 ? JSON.parse(health.body).pid : null;
  const hubExit = new Promise((done) => hub.child.once('exit', (code) => done(code)));
  const stop = await run(process.execPath, [bin, 'hub', '--stop'], { env: cliEnv, timeoutMs: 90_000 });
  const exitCode = await Promise.race([hubExit, new Promise((done) => setTimeout(() => done('still running'), 15_000))]);
  say(`  GET /api/setup ${setup.status} (Claude Code ${claude?.state ?? '?'}, ${claude?.version ?? '?'}), GET /api/health ${health.status} (process ${healthPid}); worklings hub --stop: exit code ${stop.code}, the hub exited with ${exitCode}`);
  if (claude?.state !== 'ready') fail("The hub's first-run check didn't find the (fake) Claude Code ready.");
  if (healthPid !== hub.child.pid) fail(`The hub's /api/health named process ${healthPid}, not ${hub.child.pid}.`);
  if (stop.code !== 0 || exitCode !== 0) fail(`worklings hub --stop didn't close the hub cleanly:\n${stop.stdout}${stop.stderr}`);

  // worklings demo: the demo company, on a port of its own.
  const demoPort = await freePortFrom(PORTS, taken);
  if (demoPort === null) throw new Error(`No second free port among ${PORTS.join(', ')} for the demo.`);
  const demo = await startCli(bin, ['demo', '--port', String(demoPort), '--no-open'], cliEnv, /Press Ctrl\+C to stop\./);
  children.push(demo.child);
  const demoLink = /Open: (\S+)/.exec(demo.text)?.[1] ?? '';
  const demoCompany = await page(demoLink);
  const state = await page(new URL('/api/state', demoLink));
  const mode = state.status === 200 ? JSON.parse(state.body).mode : null;
  say(`worklings demo --port ${demoPort} opened ${new URL(demoLink).pathname}: GET ${demoCompany.status} ${demoCompany.type.split(';')[0]}, GET /api/state ${state.status} (mode ${mode})`);
  if (new URL(demoLink).pathname !== '/c/demo' || demoCompany.status !== 200 || !demoCompany.type.startsWith('text/html')) fail("worklings demo didn't open the demo company.");
  if (mode !== 'demo') fail("The demo server's state isn't the demo's.");
  await killTree(demo.child);

  // An older Node gets a sentence, not a syntax error (CI passes Node 20's path).
  if (args['old-node']) {
    const old = await run(args['old-node'], [bin, '--version'], { env: cliEnv, timeoutMs: 60_000 });
    const sentence = /^Worklings needs Node\.js 22 or newer, and this is Node\.js \d+\.\d+\.\d+\. Install the current LTS from https:\/\/nodejs\.org, then run the command again\.\n$/;
    say(`Node at ${args['old-node']}: exit code ${old.code}, "${old.stderr.trim()}"`);
    if (old.code !== 1 || !sentence.test(old.stderr) || old.stdout !== '') fail("An older Node didn't get the sentence that says Worklings needs Node 22.");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await Promise.all(children.map(killTree));
  if (args.keep) say(`Kept ${root}.`);
  else {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      say(`Couldn't delete ${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

say();
const seconds = Math.round((Date.now() - started) / 1000);
if (failures.length > 0) {
  say(`The package check failed (${failures.length} problem${failures.length === 1 ? '' : 's'}) in ${seconds} s.`);
  process.exitCode = 1;
} else {
  say(`The package check passed in ${seconds} s${args.keep ? '' : ', and its temp folder is gone'}.`);
}
