// Shared parts of the benchmark harness (scripts/bench/): where the tasks live, how a starting point is prepared,
// how a program is run with a wall-time cap, and how cost and tokens are read from what a run left behind.
//
// The tasks and their hidden tests live OUTSIDE the repo, in BENCH_ROOT (default: worklings-bench in your home folder),
// so no run can read them: <BENCH_ROOT>/tasks/<task>/{goal.md, hidden/, start/?}.
//
// Rules this harness keeps (AGENTS.md): it never kills by port, name or command-line pattern, only the process trees of
// programs it started itself, by the PIDs it recorded; leftovers it can see are reported, never killed. Anything that
// calls a model reads WORKLINGS_CLAUDE, so a dry run points it at a fake.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * The Worklings the company arm runs: BENCH_PRODUCT, a frozen copy of a commit (made with `git archive`, with this
 * repo's node_modules linked in and the commit in a PRODUCT_COMMIT file), else this repo. The harness, the scoring and
 * the reviews always come from this repo, so two versions of the product are measured the same way.
 */
export const PRODUCT = resolve(process.env.BENCH_PRODUCT ?? REPO);
export const BENCH_ROOT = resolve(process.env.BENCH_ROOT ?? join(homedir(), 'worklings-bench'));
/** Every task with a goal in BENCH_ROOT/tasks (on 12 Nov 2026: api, feature, game, link-checker, pomodoro). */
export const TASKS = existsSync(join(BENCH_ROOT, 'tasks')) ? readdirSync(join(BENCH_ROOT, 'tasks')).filter((t) => existsSync(join(BENCH_ROOT, 'tasks', t, 'goal.md'))).sort() : [];
export const MODEL = process.env.BENCH_MODEL || 'sonnet';
export const MINUTES = Number(process.env.BENCH_MINUTES) > 0 ? Number(process.env.BENCH_MINUTES) : 45;

export const now = () => Date.now();
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function die(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export const taskDir = (task) => join(BENCH_ROOT, 'tasks', task);

/** The task named on the command line, checked against what exists on disk. */
export function requireTask(name) {
  if (!name || !TASKS.includes(name)) die(`Say which task: ${TASKS.join(', ')}.`);
  if (!existsSync(join(taskDir(name), 'goal.md'))) die(`No goal for ${name}: expected ${join(taskDir(name), 'goal.md')} (BENCH_ROOT=${BENCH_ROOT}).`);
  return name;
}

/** The goal both arms get: one paragraph, exactly as written in goal.md. */
export const goalOf = (task) => readFileSync(join(taskDir(task), 'goal.md'), 'utf8').trim().replace(/\s*\n\s*/g, ' ');

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** An output folder, made if needed; refuses to overwrite a finished run unless BENCH_FORCE=1. */
export function outDir(path, resultFile) {
  if (!path) die('Say where to save the run: the second argument is the output folder.');
  const dir = resolve(path);
  if (existsSync(join(dir, resultFile)) && process.env.BENCH_FORCE !== '1') die(`${join(dir, resultFile)} exists already. Pick another folder, or set BENCH_FORCE=1 to overwrite.`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/** `node_modules` and the build's own output are not part of what a run produced. */
const SKIP = new Set(['node_modules']);
export function copyTree(from, to, { skip = SKIP } = {}) {
  cpSync(from, to, { recursive: true, filter: (src) => !skip.has(src.split(sep).at(-1) ?? '') });
}

/** Removes a folder we made, by its literal path; a program that still holds a file in it is reported, not fought. */
export function removeTree(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Programs

const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a);

/** Runs a program to the end. `npm` and `npx` are .cmd files on Windows and go through a shell as one quoted string. */
export function sh(command, args, { cwd, env, timeoutMs = 300_000, input } = {}) {
  const started = now();
  const options = { cwd, env, encoding: 'utf8', timeout: timeoutMs, input, maxBuffer: 64 * 1024 * 1024, windowsHide: true };
  const viaShell = process.platform === 'win32' && /^(npm|npx)$/i.test(command);
  const r = viaShell ? spawnSync([command, ...args.map(quote)].join(' '), { ...options, shell: true }) : spawnSync(command, args, options);
  return { code: r.status ?? (r.error ? -1 : 0), signal: r.signal ?? null, timedOut: r.error?.code === 'ETIMEDOUT', stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: now() - started };
}

export const tail = (text, n = 40) => text.split('\n').slice(-n).join('\n').trim();

/** Kills a process tree we started: taskkill /T on Windows, the process group elsewhere. Never rejects. */
export function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

/**
 * Starts a program with its output going to files, and resolves when it exits or `timeoutMs` passes (then its tree is
 * killed by the PID recorded here). `onSpawn(pid)` lets a caller record the PID at once.
 */
export function runLogged(command, args, { cwd, env, input, stdoutFile, stderrFile, timeoutMs, onSpawn }) {
  return new Promise((done) => {
    const started = now();
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    onSpawn?.(child.pid);
    const out = stdoutFile ? createWriteStream(stdoutFile) : null;
    const err = stderrFile ? createWriteStream(stderrFile) : null;
    child.stdout.on('data', (c) => out?.write(c));
    child.stderr.on('data', (c) => err?.write(c));
    child.stdin.on('error', () => {});
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, timeoutMs)
      : null;
    let spawnError = null;
    child.on('error', (e) => {
      spawnError = e;
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      out?.end();
      err?.end();
      done({ code, signal, timedOut, ms: now() - started, pid: child.pid, error: spawnError ? spawnError.message : null });
    });
  });
}

/** [command, ...leading args] for Claude Code: WORKLINGS_CLAUDE (a script runs under this Node) or `claude`. */
export function claudeCommand() {
  const file = process.env.WORKLINGS_CLAUDE;
  if (!file) return { command: 'claude', lead: [], fake: false };
  if (/\.(mjs|cjs|js|ts)$/i.test(file)) return { command: process.execPath, lead: [file], fake: true };
  return { command: file, lead: [], fake: true };
}

/** The environment a one-prompt session gets: this one, less the variables of the Claude Code that runs us, as the desks get theirs. */
export async function soloEnv() {
  const base = { ...process.env };
  delete base.CLAUDECODE;
  try {
    const { deskEnv } = await import(pathToFileURL(join(REPO, 'src', 'server', 'claude.ts')).href);
    return deskEnv(base);
  } catch {
    for (const key of Object.keys(base)) if (key.toUpperCase().startsWith('CLAUDE_CODE_') && key.toUpperCase() !== 'CLAUDE_CODE_OAUTH_TOKEN') delete base[key];
    delete base.DISABLE_PROMPT_CACHING;
    return base;
  }
}

/**
 * v0.7: every process that descends from `rootPid` while a run goes on, read every `everyMs` (Windows only), so the ones a
 * session left running when it ended (a test moved to the background, a dev server) can be stopped afterwards by the PIDs
 * recorded here, each with its start time so a reused PID is never taken for it. `stop()` ends the watch and returns them.
 */
export function watchTree(rootPid, everyMs = 10_000) {
  const seen = new Map();
  if (process.platform !== 'win32' || !Number.isInteger(rootPid)) return { stop: () => seen, read: () => {} };
  const read = () => {
    const script = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate; $kids = @{}; foreach ($p in $all) { if (-not $kids.ContainsKey([int]$p.ParentProcessId)) { $kids[[int]$p.ParentProcessId] = @() }; $kids[[int]$p.ParentProcessId] += $p }; $queue = @(${rootPid}); while ($queue.Count -gt 0) { $id = $queue[0]; $queue = @($queue | Select-Object -Skip 1); foreach ($c in $kids[[int]$id]) { if ($c.ProcessId -ne $id) { "$($c.ProcessId)|$($c.CreationDate.ToString('o'))"; $queue += [int]$c.ProcessId } } }`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    for (const line of (r.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
      const [pid, born] = line.split('|');
      if (Number(pid) > 0 && born) seen.set(Number(pid), born);
    }
  };
  read();
  const timer = setInterval(read, everyMs);
  timer.unref?.();
  return {
    read,
    stop() {
      clearInterval(timer);
      return seen;
    },
  };
}

/** Stops the recorded processes still running with the same start time, each by its PID; returns the ones it stopped. */
export function stopRecorded(recorded) {
  if (process.platform !== 'win32' || recorded.size === 0) return [];
  const ids = [...recorded.keys()].join(',');
  const script = `Get-CimInstance Win32_Process | Where-Object { @(${ids}) -contains $_.ProcessId } | ForEach-Object { "$($_.ProcessId)|$($_.CreationDate.ToString('o'))|$($_.Name)" }`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  const stopped = [];
  for (const line of (r.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
    const [pid, born, name] = line.split('|');
    if (recorded.get(Number(pid)) !== born) continue;
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    stopped.push({ pid: Number(pid), name });
  }
  return stopped;
}

/** Processes whose command line mentions `folder`: read-only, so a leftover dev server is reported and the person decides. */
export function leftovers(folder) {
  if (process.platform !== 'win32') return [];
  const escaped = folder.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') -and $_.ProcessId -ne ${process.pid} -and $_.CommandLine -notlike '*Get-CimInstance*' } | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return (r.stdout ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pid, name] = line.split('|');
      return { pid: Number(pid), name };
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Starting points

/**
 * A fresh folder for a run, holding the task's starting point (nothing, or the feature project with its packages
 * installed) as a git repository with one commit. Setup time is not part of any arm's wall time.
 */
export function prepareStart(task, prefix) {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-${task}-`));
  const start = join(taskDir(task), 'start');
  if (existsSync(start)) copyTree(start, dir);
  if (existsSync(join(dir, 'package.json'))) {
    const installed = sh('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: dir, timeoutMs: 600_000 });
    if (installed.code !== 0) die(`npm install in the starting point failed:\n${tail(installed.stderr || installed.stdout)}`);
  }
  commitAll(dir, 'Starting point');
  return dir;
}

/** `git init` (once) and a commit of everything, with a throwaway identity and no signing. */
export function commitAll(dir, message) {
  const git = (...args) => sh('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, timeoutMs: 60_000 });
  if (!existsSync(join(dir, '.git'))) git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', message);
}

// ---------------------------------------------------------------------------------------------------------------------
// What a run cost

/** Streamed lines of `claude -p --output-format stream-json`, parsed; lines that are not JSON are skipped. */
export function parseJsonl(file) {
  if (!existsSync(file)) return [];
  const lines = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // a partial last line when a run was cut off
    }
  }
  return lines;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Tokens a result's `usage` block reports, in the office's TokenUsage shape. */
export function usageOf(u) {
  const creation = u?.cache_creation;
  const write5m = creation ? num(creation.ephemeral_5m_input_tokens) : num(u?.cache_creation_input_tokens);
  return { input: num(u?.input_tokens), output: num(u?.output_tokens), cacheRead: num(u?.cache_read_input_tokens), cacheWrite5m: write5m, cacheWrite1h: creation ? num(creation.ephemeral_1h_input_tokens) : 0 };
}

export const addUsage = (a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m, cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h });
export const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

/**
 * What the assistant messages of a stream add up to, by model, each message once (the last line of an id wins). Used when
 * a run was cut off before its result line: the cost is then an estimate from the office's price table.
 */
export async function usageFromStream(lines) {
  const byId = new Map();
  for (const l of lines) {
    if (l?.type !== 'assistant' || !l.message?.usage) continue;
    byId.set(l.message.id ?? `${byId.size}`, { model: l.message.model ?? 'unknown', usage: usageOf(l.message.usage) });
  }
  const perModel = {};
  for (const { model, usage } of byId.values()) perModel[model] = addUsage(perModel[model] ?? ZERO, usage);
  let cost = 0;
  let priced = true;
  try {
    const { costOf } = await import(pathToFileURL(join(REPO, 'src', 'core', 'pricing.ts')).href);
    for (const [model, usage] of Object.entries(perModel)) {
      const c = costOf(model, usage);
      if (c === null || c === undefined) priced = false;
      else cost += c;
    }
  } catch {
    priced = false;
  }
  const total = Object.values(perModel).reduce((a, u) => addUsage(a, u), ZERO);
  return { perModel, total, cost: priced && byId.size > 0 ? cost : null, messages: byId.size };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shots (SPEC-v0.3.md, Q4)

/**
 * The times the stakeholder stepped in after approving the plan, from what a company run's harness did (events.jsonl):
 * each question it answered, each approval it gave or refused, and each later version of the plan it had to approve. The
 * scoping answers, the first plan approval and the benchmark's own model change come before the work and are not shots.
 * A one-prompt run (arm A) has none. Works on runs from any version of run-b.mjs, which all write these events.
 */
export function stepInsOf(dir) {
  const lines = parseJsonl(join(dir, 'events.jsonl'));
  const ok = (e) => e.status === 200;
  const approvals = lines.filter((e) => e.kind === 'plan-approved' && ok(e));
  const firstAt = approvals[0]?.at ?? null;
  const after = (e) => firstAt === null || e.at > firstAt;
  const questions = lines.filter((e) => e.kind === 'question-answered' && ok(e) && after(e)).length;
  const permissions = lines.filter((e) => (e.kind === 'approval-allowed' || e.kind === 'approval-denied') && ok(e) && after(e)).length;
  const planVersions = Math.max(0, approvals.length - 1);
  return { total: questions + permissions + planVersions, questions, permissions, planVersions };
}

/**
 * Shots per run: the step-ins after the plan's approval, plus one follow-up prompt when the result wasn't what was asked
 * (the run didn't finish, or the hidden core tests didn't all pass), as a person would have had to ask again.
 */
export function shotsOf(dir, result, score) {
  const stepIns = result.arm === 'A' || result.arm === 'P' ? { total: 0, questions: 0, permissions: 0, planVersions: 0 } : (result.shots?.stepIns ?? stepInsOf(dir));
  const core = score?.hidden?.core;
  const followUp = result.done !== true || (core !== undefined && core.total > 0 && core.passed < core.total) ? 1 : 0;
  return { stepIns, followUp, total: stepIns.total + followUp };
}

/** Versions and the state of the Worklings checkout, for the "works on my machine" record. */
export function environment() {
  const git = (...args) => sh('git', args, { cwd: REPO, timeoutMs: 20_000 }).stdout.trim();
  const { command, lead, fake } = claudeCommand();
  const claude = sh(command, [...lead, '--version'], { timeoutMs: 20_000 });
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    claudeVersion: claude.code === 0 ? claude.stdout.trim() : `unavailable (${claude.code})`,
    claudeIsFake: fake,
    // A frozen harness copy (made with `git archive`, not a git checkout) names its commit in HARNESS_COMMIT.
    worklingsCommit: existsSync(join(REPO, 'HARNESS_COMMIT')) ? readFileSync(join(REPO, 'HARNESS_COMMIT'), 'utf8').trim() : git('rev-parse', '--short', 'HEAD'),
    worklingsDirty: existsSync(join(REPO, 'HARNESS_COMMIT')) ? false : git('status', '--porcelain').length > 0,
    model: MODEL,
    minutesCap: MINUTES,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// v0.4 (SPEC-v0.4.md, B1): how arm A is set up, so it is measured against the company on equal terms

/**
 * The effort the product's Builder runs at under Balanced (src/core/presets.ts in BENCH_PRODUCT, else this repo), the
 * effort arm A runs at unless BENCH_EFFORT says otherwise. Products from before v0.4 have no seats: their desks ran at
 * `medium` (DEFAULT_EFFORT), which is returned then.
 */
export async function builderEffort() {
  try {
    const presets = await import(pathToFileURL(join(PRODUCT, 'src', 'core', 'presets.ts')).href);
    const e = presets.PRESETS?.balanced?.efforts?.builder;
    if (typeof e === 'string') return e;
  } catch {
    // an older product
  }
  return 'medium';
}

/**
 * What arm A's session is started with. Neutral (the default) is a lean desk's isolation: project and local settings
 * only (no user CLAUDE.md, settings, skills or plugins), no MCP server at all (an empty --mcp-config with
 * --strict-mcp-config, and the claude.ai connectors off), and an explicit --effort. "user" (BENCH_A_SETUP=user, arm A+)
 * is the person's own setup as v0.3 ran it. `out` is where the empty MCP config is written (the run's own folder).
 */
export async function armSetup(out) {
  const setup = process.env.BENCH_A_SETUP === 'user' ? 'user' : 'neutral';
  const given = process.env.BENCH_EFFORT || null;
  if (setup === 'user') {
    const args = given ? ['--effort', given] : [];
    return { setup, effort: given ?? 'the user settings (effortLevel)', args, shown: args, env: {}, settings: {} };
  }
  const effort = given ?? (await builderEffort());
  // --setting-sources project,local still loads the user's own CLAUDE.md (probed 15 Nov 2026 on 2.1.312): a lean desk
  // leaves it out with claudeMdExcludes (src/server/claude-config.ts, readCarry), and so does this arm.
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const settings = { claudeMdExcludes: [join(configDir, 'CLAUDE.md').split(sep).join('/')] };
  const mcp = join(out, 'mcp-empty.json');
  writeFileSync(mcp, `${JSON.stringify({ mcpServers: {} })}\n`);
  const args = ['--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', mcp, '--effort', effort];
  return {
    setup,
    effort,
    args,
    shown: ['--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--effort', effort, '--settings', '{"claudeMdExcludes":["the user CLAUDE.md"]}'],
    env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
    settings,
  };
}

/** What the session reported loading, from its init line: counts, and the MCP servers and plugins by name. */
export function loadedSetup(lines) {
  const init = lines.find((l) => l?.type === 'system' && l.subtype === 'init');
  if (!init) return null;
  const n = (v) => (Array.isArray(v) ? v.length : null);
  return {
    tools: n(init.tools),
    mcpServers: Array.isArray(init.mcp_servers) ? init.mcp_servers.map((m) => m?.name).filter(Boolean) : null,
    skills: n(init.skills),
    plugins: Array.isArray(init.plugins) ? init.plugins.map((p) => p?.name).filter(Boolean) : null,
    agents: Array.isArray(init.agents) ? init.agents : null,
  };
}
