#!/usr/bin/env node
// Proves the plugin installs the way people will install it, and that its command starts the hub, without touching
// anyone's own Claude Code: every `claude` call runs with CLAUDE_CONFIG_DIR, HOME and USERPROFILE in a throwaway folder
// and without CLAUDECODE or the other variables of a running session. Free: no model call.
//
//   node scripts/check-plugin.mjs [--keep]
//
// Needs `claude` (WORKLINGS_CHECK_CLAUDE names another), git, and the built runtime (npm run build:plugin, or
// scripts/release-plugin.ts, which runs this check).
//  1. `claude plugin validate` on the plugin and on the marketplace (the repository root).
//  2. As from GitHub: the repository with its history, plus the working tree and the runtime in one commit, as the
//     release commit will hold them, served over git's smart HTTP on 127.0.0.1. `claude plugin marketplace add
//     http://127.0.0.1:<port>/worklings.git` (owner/repo always means github.com), then `claude plugin install
//     worklings@worklings`. Reports what the clone and the plugin cache hold and their sizes.
//  3. From the local path: `claude plugin marketplace add <repository>` and the same install, in a second config.
//  4. The installed copy's `worklings hub`, run as the plugin runs it: through Git Bash with the plugin's bin/ after
//     everything else on the PATH (and through cmd on Windows), on a free port in 4380-4386 or 4390-4395. The lobby
//     page answers, and the lobby API answers with the token and refuses without it.
// Writes test-results/plugin-check.json and deletes its temp folders unless --keep.
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { checkRuntime, PLUGIN, ROOT } from './plugin-runtime.ts';

const isWindows = process.platform === 'win32';
const keep = process.argv.includes('--keep');
const CLAUDE = process.env.WORKLINGS_CHECK_CLAUDE || 'claude';
/** Ports a check may take, in the range this machine's other checks keep to. */
const PORTS = [4380, 4381, 4382, 4383, 4384, 4385, 4386, 4390, 4391, 4392, 4393, 4394, 4395];
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
const log = (line) => process.stderr.write(`${line}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const temp = mkdtempSync(join(tmpdir(), 'worklings-plugin-check-'));
const work = join(temp, 'work');
mkdirSync(work);
const report = { ok: false, claude: null, steps: {}, sizes: {}, errors: [] };
const pluginJson = JSON.parse(readFileSync(join(ROOT, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));

/**
 * The environment minus everything a running Claude Code session sets, so no call joins or reads that session, plus
 * `extra`. Windows names are case-insensitive (Path and PATH are one variable), so an extra replaces any spelling.
 */
function outsideClaude(extra = {}) {
  const env = {};
  const replaced = new Set(Object.keys(extra).map((k) => (isWindows ? k.toUpperCase() : k)));
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/i.test(key) || replaced.has(isWindows ? key.toUpperCase() : key)) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/** A throwaway Claude Code configuration: its own config folder and home, so nothing of the person's is read or written. */
function throwawayConfig(name) {
  const config = join(temp, name, 'claude');
  const home = join(temp, name, 'home');
  mkdirSync(config, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { config, env: outsideClaude({ CLAUDE_CONFIG_DIR: config, HOME: home, USERPROFILE: home, DISABLE_AUTOUPDATER: '1' }) };
}

/** Runs claude without blocking: the git server this script runs has to answer the clone it starts. */
function claude(where, args, timeout = 180_000) {
  return new Promise((done, failed) => {
    execFile(CLAUDE, args, { cwd: work, env: where.env, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 1 << 24 }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') {
        failed(new Error(`claude isn't on the PATH: install Claude Code, or set WORKLINGS_CHECK_CLAUDE to its path.`));
        return;
      }
      const status = error ? (typeof error.code === 'number' ? error.code : null) : 0;
      done({ status, out: `${stdout}${stderr}`.trim() + (error?.killed ? `\n(stopped after ${timeout / 1000} s)` : '') });
    });
  });
}

function step(name, ok, detail) {
  report.steps[name] = { ok, ...detail };
  log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) report.errors.push(name);
  return ok;
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function folderBytes(dir) {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    bytes += entry.isDirectory() ? folderBytes(path) : statSync(path).size;
  }
  return bytes;
}

/** The repository as the release commit will hold it: its history, then the working tree and the runtime on top. */
function releaseRepository() {
  const repo = join(temp, 'repo');
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', ROOT, repo], { stdio: 'ignore' });
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], ROOT).split('\0').filter(Boolean);
  for (const file of files) {
    const from = join(ROOT, file);
    const to = join(repo, file);
    if (existsSync(from) && statSync(from).isFile()) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    } else rmSync(to, { force: true });
  }
  cpSync(join(ROOT, 'plugin', 'runtime'), join(repo, 'plugin', 'runtime'), { recursive: true });
  const id = ['-c', 'user.name=Worklings check', '-c', 'user.email=check@worklings.invalid', '-c', 'core.autocrlf=false'];
  git([...id, 'add', '--force', '--all'], repo);
  git(['update-index', '--chmod=+x', 'plugin/bin/worklings'], repo);
  git([...id, 'commit', '--quiet', '-m', 'Release check'], repo);
  const served = join(temp, 'served');
  execFileSync('git', ['clone', '--quiet', '--bare', repo, join(served, 'worklings.git')], { stdio: 'ignore' });
  return { repo, served };
}

/** git's smart HTTP protocol for the folders under root, through `git http-backend`, on a port the system picks. */
async function gitHttp(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const env = {
      ...outsideClaude(),
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: req.method ?? 'GET',
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      REMOTE_ADDR: '127.0.0.1',
    };
    if (req.headers['content-length']) env.CONTENT_LENGTH = req.headers['content-length'];
    if (req.headers['content-encoding']) env.HTTP_CONTENT_ENCODING = req.headers['content-encoding'];
    if (typeof req.headers['git-protocol'] === 'string') env.GIT_PROTOCOL = req.headers['git-protocol'];
    const backend = spawn('git', ['http-backend'], { env, windowsHide: true });
    req.pipe(backend.stdin);
    let head = Buffer.alloc(0);
    let started = false;
    backend.stdout.on('data', (chunk) => {
      if (started) return void res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const text = head.toString('latin1');
      const end = /\r?\n\r?\n/.exec(text);
      if (!end) return;
      let status = 200;
      const headers = {};
      for (const line of text.slice(0, end.index).split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const [key, value] = [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
        if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else headers[key] = value;
      }
      res.writeHead(status, headers);
      started = true;
      res.write(head.subarray(end.index + end[0].length));
    });
    backend.stdout.on('end', () => res.end());
    backend.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((done, failed) => server.once('error', failed).listen(0, '127.0.0.1', done));
  return { server, port: server.address().port };
}

async function freePort() {
  for (const port of PORTS) {
    const free = await new Promise((done) => {
      const probe = createTcpServer();
      probe.once('error', () => done(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free port among ${PORTS.join(', ')}.`);
}

/** Git Bash, which Claude Code's Bash tool runs on Windows (never WSL's bash.exe); sh elsewhere. */
function bashPath() {
  if (!isWindows) return 'sh';
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const exec = git(['--exec-path'], ROOT);
  const candidates = [resolve(exec, '..', '..', '..', 'bin', 'bash.exe'), resolve(exec, '..', '..', '..', 'usr', 'bin', 'bash.exe')];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Git Bash not found next to git (${exec}); set CLAUDE_CODE_GIT_BASH_PATH.`);
  return found;
}

/** Kills a process and everything it started: taskkill /T on Windows, its process group elsewhere when it leads one. */
function killTree(pid, group = true) {
  if (!pid) return Promise.resolve();
  if (!isWindows) {
    try {
      process.kill(group ? -pid : pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    return Promise.resolve();
  }
  return new Promise((done) => {
    execFile(join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => done());
  });
}

async function get(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
  } catch {
    return { status: 0, type: '', body: '' };
  }
}

/** A hub's own folder for one run: its WORKLINGS_HOME with a known token, and a temp folder. */
function hubHome(name) {
  const home = join(temp, `hub-${name}`);
  const scratch = join(home, 'temp');
  mkdirSync(join(home, '.worklings'), { recursive: true });
  mkdirSync(scratch, { recursive: true });
  const token = randomBytes(24).toString('base64url');
  writeFileSync(join(home, '.worklings', 'token'), `${token}\n`, { mode: 0o600 });
  return { home, token, env: { WORKLINGS_HOME: home, TEMP: scratch, TMP: scratch, TMPDIR: scratch } };
}

/** The process the hub's lock names: on Windows, killing Git Bash's tree doesn't reach the node.exe it started. */
function lockedPid(home) {
  try {
    const lock = JSON.parse(readFileSync(join(home, '.worklings', 'hub.lock'), 'utf8'));
    return Number.isInteger(lock?.pid) ? lock.pid : null;
  } catch {
    return null;
  }
}

/** Starts `worklings hub` through a shell the way the plugin's bin/ is reached, checks it answers, then stops it. */
async function hubThrough(name, command, args, env, hub) {
  const port = await freePort();
  const child = spawn(command, args(port), { env, detached: !isWindows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  let page = { status: 0 };
  while (Date.now() - started < 60_000 && child.exitCode === null) {
    page = await get(`${base}/`);
    if (page.status === 200) break;
    await sleep(250);
  }
  const answeredAfter = (Date.now() - started) / 1000;
  const refused = await get(`${base}/api/lobby`);
  const lobby = await get(`${base}/api/lobby`, { authorization: `Bearer ${hub.token}` });
  await killTree(lockedPid(hub.home), false);
  await killTree(child.pid);
  let stopped = false;
  for (let i = 0; i < 40 && !stopped; i++) {
    stopped = (await get(`${base}/`)).status === 0;
    if (!stopped) await sleep(250);
  }
  let companies = null;
  try {
    companies = JSON.parse(lobby.body).companies?.length ?? null;
  } catch {
    // Not JSON: the step below fails on the status anyway.
  }
  const shown = output.replace(/token=[\w-]+/g, 'token=…').trim().split(/\r?\n/).slice(0, 8);
  const ok = page.status === 200 && page.type.startsWith('text/html') && page.body.includes('id="root"') && refused.status === 401 && lobby.status === 200 && companies !== null && stopped;
  return step(name, ok, { port, secondsToAnswer: answeredAfter, page: page.status, lobbyWithoutToken: refused.status, lobbyWithToken: lobby.status, companies, stoppedByLockPid: stopped, output: shown });
}

async function main() {
  const runtime = join(ROOT, 'plugin', 'runtime');
  const problems = checkRuntime(runtime);
  if (!step('runtime is built and complete', problems.length === 0, { problems })) return;

  const viaGit = throwawayConfig('from-git');
  const version = await claude(viaGit, ['--version']);
  report.claude = version.out;
  log(`Claude Code ${version.out}`);

  for (const [name, path] of [['validate the plugin', join(ROOT, 'plugin')], ['validate the marketplace', ROOT]]) {
    const r = await claude(viaGit, ['plugin', 'validate', path]);
    step(name, r.status === 0, { output: r.out.split(/\r?\n/).filter(Boolean) });
  }

  // 2. As from GitHub.
  const { served } = releaseRepository();
  const { server, port: gitPort } = await gitHttp(served);
  try {
    const url = `http://127.0.0.1:${gitPort}/worklings.git`;
    const added = await claude(viaGit, ['plugin', 'marketplace', 'add', url]);
    step('marketplace add over git', added.status === 0 && added.out.includes(`marketplace: ${PLUGIN}`), { command: `claude plugin marketplace add ${url}`, output: added.out.split(/\r?\n/) });
    const installed = await claude(viaGit, ['plugin', 'install', `${PLUGIN}@${PLUGIN}`]);
    step('install from the git marketplace', installed.status === 0, { command: `claude plugin install ${PLUGIN}@${PLUGIN}`, output: installed.out.split(/\r?\n/) });
  } finally {
    server.closeAllConnections();
    server.close();
  }
  const clone = join(viaGit.config, 'plugins', 'marketplaces', PLUGIN);
  if (existsSync(clone)) {
    report.sizes.marketplaceClone = {
      bytes: folderBytes(clone),
      gitBytes: folderBytes(join(clone, '.git')),
      shallow: existsSync(join(clone, '.git', 'shallow')),
      commits: Number(git(['rev-list', '--count', 'HEAD'], clone)),
      binMode: git(['ls-files', '--stage', '--', 'plugin/bin/worklings'], clone).split(/\s+/)[0],
    };
  }
  const records = join(viaGit.config, 'plugins', 'installed_plugins.json');
  const record = existsSync(records) ? JSON.parse(readFileSync(records, 'utf8')).plugins?.[`${PLUGIN}@${PLUGIN}`]?.[0] : undefined;
  const cached = record?.installPath;
  const cacheProblems = cached && existsSync(cached) ? checkRuntime(join(cached, 'runtime')) : ['no install path recorded'];
  if (cached && existsSync(cached)) report.sizes.pluginCache = { path: cached.replace(temp, '<temp>'), bytes: folderBytes(cached), version: record.version };
  step('the cached copy holds the whole runtime', cacheProblems.length === 0 && existsSync(join(cached ?? '', 'bin', 'worklings')), { problems: cacheProblems, record: record ? { ...record, installPath: cached.replace(temp, '<temp>') } : null });
  const details = await claude(viaGit, ['plugin', 'details', PLUGIN]);
  const skills = readdirSync(join(ROOT, 'plugin', 'skills'));
  step('details list every skill', details.status === 0 && skills.every((s) => details.out.includes(s)), { skills, output: details.out.split(/\r?\n/).filter(Boolean).slice(0, 30) });

  // 3. From the local path.
  const local = throwawayConfig('from-path');
  const addedLocal = await claude(local, ['plugin', 'marketplace', 'add', ROOT]);
  step('marketplace add from the local path', addedLocal.status === 0, { output: addedLocal.out.split(/\r?\n/) });
  const installedLocal = await claude(local, ['plugin', 'install', `${PLUGIN}@${PLUGIN}`]);
  const listed = await claude(local, ['plugin', 'list', '--json']);
  step('install from the local path', installedLocal.status === 0 && listed.out.includes(`${PLUGIN}@${PLUGIN}`), { output: installedLocal.out.split(/\r?\n/), list: listed.out.slice(0, 2000) });

  // 4. The command's script, as the plugin runs it, from the copy people get.
  if (!cached || !existsSync(cached)) return;
  const shellEnv = (hub) =>
    outsideClaude({
      // Claude Code puts plugin bin/ folders after the person's own PATH entries.
      PATH: `${process.env.PATH ?? ''}${delimiter}${join(cached, 'bin')}`,
      // No company runs here, so no desk starts; the fake stands in all the same, so the real Claude Code never could.
      WORKLINGS_CLAUDE: join(ROOT, 'test', 'fake-desk.mjs'),
      ...hub.env,
    });
  const bash = bashPath();
  const first = hubHome('which');
  const which = spawnSync(bash, ['-c', 'command -v worklings && worklings --version'], { env: shellEnv(first), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const [found = '', shownVersion = ''] = which.stdout.trim().split(/\r?\n/);
  step("bash finds the plugin's worklings", which.status === 0 && shownVersion === pluginJson.version && found.includes('bin'), { found: found.replace(temp.replaceAll('\\', '/'), '<temp>'), version: shownVersion, stderr: which.stderr.trim() });
  const viaBash = hubHome('bash');
  await hubThrough('the hub answers when started through bash', bash, (port) => ['-c', 'worklings hub --port "$1" --no-open', 'worklings-check', String(port)], shellEnv(viaBash), viaBash);
  if (isWindows) {
    const viaCmd = hubHome('cmd');
    await hubThrough('the hub answers when started through cmd', join(systemRoot, 'System32', 'cmd.exe'), (port) => ['/d', '/c', 'worklings', 'hub', '--port', String(port), '--no-open'], shellEnv(viaCmd), viaCmd);
  }
}

try {
  await main();
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  log(`FAIL ${report.errors.at(-1)}`);
} finally {
  report.ok = report.errors.length === 0;
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  writeFileSync(join(ROOT, 'test-results', 'plugin-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (keep) log(`Kept ${temp}`);
  else rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  log(`${report.ok ? 'Plugin check passed' : `Plugin check failed: ${report.errors.join('; ')}`}. Wrote test-results/plugin-check.json`);
  process.exitCode = report.ok ? 0 : 1;
}
