// Proves the protocol the switchboard builds on (SPEC-v3.md, "The switchboard") against the real Claude Code and
// records the exchanges as fixtures. A desk is `claude -p --input-format stream-json --output-format stream-json
// --verbose` in a neutral temp folder, started as the office starts Claude Code (findClaude, claudeEnv) but with
// prompt caching left on. In order, the script shows:
//   1. a message written to a busy desk is taken at its next step, in the same turn; a line written after a turn has
//      ended starts the next one;
//   2. an http PermissionRequest hook that answers after 2 s allows (the command runs) or denies (it doesn't), and what
//      happens when it doesn't answer before its timeout;
//   3. a turn stops on the stream-json interrupt control request, and on a user message sent with priority "now"
//      (with and without a human origin), and the session goes on in the same process; what a signal does instead;
//   4. a closed desk reopens with --resume and keeps its context; whether --append-system-prompt is honoured there,
//      with and without --system-prompt-snapshot off; how the process exits when stdin closes;
//   5. a PreToolUse "defer" parks a call, and the call runs once the desk is reopened.
// The slow steps run `node -e "setTimeout(...)"` in the foreground: Claude Code 2.1.312 blocks a standalone `sleep 30`.
// Haiku only, a few cents in all; needs Claude Code signed in. The desks run without CLAUDECODE (claudeEnv drops it).
//
//   node scripts/check-desk.mjs [--keep]
//
// Writes test-results/desk-check.json and the sanitized exchanges in test/fixtures/claude-<version>/desk/ (the
// fixtures only when every required step passed; otherwise in test-results/desk-fixtures-partial/). Run it again when
// Claude Code changes (see "Stream-json desks" in docs/claude-code-surfaces.md).
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const { claudeEnv, findClaude } = await import('../src/server/claude.ts');
const { costOf } = await import('../src/core/pricing.ts');
const { usageFromApi } = await import('../src/core/usage.ts');

const keep = process.argv.includes('--keep');
const repo = resolve(import.meta.dirname, '..');
const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const isWindows = process.platform === 'win32';
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
/** How long the approval hook may take before Claude Code gives up on it (the timeout step waits it out). */
const APPROVAL_TIMEOUT_S = 5;
/** How long the office takes to answer an approval in the allow and deny steps. */
const APPROVAL_WAIT_MS = 2_000;
const LINE_LIMIT = 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;
/** A runaway guard for each desk; the whole check costs a few cents. */
const BUDGET_USD = '0.50';
/** The word in every slow command, so the process table can tell it from the rest. */
const WAIT_MARK = 'waited';

const log = (...args) => process.stderr.write(`${args.join(' ')}\n`);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** A repo path as the report shows it. */
const shown = (path) => relative(repo, path).replaceAll('\\', '/');

const claude = findClaude(process.env);
if (!claude.found) {
  log(claude.reason);
  process.exit(1);
}

const deskToken = randomUUID();
/**
 * A desk's environment: claudeEnv's (the host session's wiring removed) without DISABLE_PROMPT_CACHING, because a desk
 * is a long conversation whose cache every later request reads; session-state events on; and the desk's token, which
 * the hooks' headers read from the environment so that it never appears on a command line.
 */
function deskEnv() {
  const env = claudeEnv(process.env);
  delete env.DISABLE_PROMPT_CACHING;
  env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';
  env.WORKLINGS_DESK_TOKEN = deskToken;
  return env;
}

const project = mkdtempSync(join(tmpdir(), 'worklings-desk-check-'));
const harness = mkdtempSync(join(tmpdir(), 'worklings-desk-harness-'));
const transcripts = join(claudeHome, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
const inProject = (name) => existsSync(join(project, name));

// ---------------------------------------------------------------------------------------------------------------------
// Sanitizing: machine paths become /project, /harness and ~, with forward slashes; the user name and email addresses
// go; the person's own hook output and their lists of skills, agents, plugins and commands are left out.

const home = homedir();
const username = userInfo().username;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forms = (path) => {
  const forward = path.replaceAll('\\', '/');
  return [path, forward, forward.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)];
};
const encoded = (path) => path.replace(/[^a-zA-Z0-9]/g, '-');
const replacements = [
  [encoded(project), '-project'],
  [encoded(harness), '-harness'],
  [encoded(home), '-home'],
  [`/tmp/${basename(project)}`, '/project'],
  [`/tmp/${basename(harness)}`, '/harness'],
  ...forms(project).map((form) => [form, '/project']),
  ...forms(harness).map((form) => [form, '/harness']),
  ...forms(home).map((form) => [form, '~']),
]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([from, to]) => [new RegExp(escapeRegExp(from), 'gi'), to]);
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const USERNAME = new RegExp(`\\b${escapeRegExp(username)}\\b`, 'gi');
const HAS_USERNAME = new RegExp(`\\b${escapeRegExp(username)}\\b`, 'i');
/** The first word of git's user.name on this machine, if any: a first name must not be left in what was written either. */
const FIRST_NAME = (() => {
  try {
    const first = execFileSync('git', ['config', '--get', 'user.name'], { encoding: 'utf8' }).trim().split(/\s+/)[0] ?? '';
    return first.length >= 3 ? new RegExp(`\\b${escapeRegExp(first)}\\b`, 'i') : null;
  } catch {
    return null;
  }
})();
/** A path that now starts at a placeholder, with Windows separators after it. */
const PLACED_PATH = /(\/project|\/harness|-project|~)((?:\\[^\\\s"'<>|*?]+)+\\?)/g;

function cleanText(text) {
  let s = text;
  for (const [pattern, to] of replacements) s = s.replace(pattern, to);
  s = s.replace(PLACED_PATH, (_, root, rest) => root + rest.replaceAll('\\', '/'));
  return s.replace(EMAIL, 'user@example.com').replace(USERNAME, 'user');
}

/** A sanitized deep copy; thinking signatures go, as in refresh-fixtures.mjs. */
function clean(value) {
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) if (key !== 'signature') out[cleanText(key)] = clean(v);
    return out;
  }
  return value;
}

const PERSONAL_LISTS = ['slash_commands', 'skills', 'agents', 'plugins', 'plugin_errors'];
const OUTPUT_FIELDS = ['output', 'stdout', 'stderr', 'content'];
const leftOut = (text) => `(${text.length} characters of the person's own hook output, left out)`;
/** A stream line as the fixtures keep it. */
function forFixture(line) {
  if (line?.type === 'system' && line.subtype === 'init') {
    const out = { ...line };
    for (const key of PERSONAL_LISTS) if (Array.isArray(out[key])) out[key] = [];
    return out;
  }
  if (line?.type === 'system' && typeof line.subtype === 'string' && line.subtype.startsWith('hook_')) {
    const out = { ...line };
    for (const key of OUTPUT_FIELDS) if (typeof out[key] === 'string' && out[key].length > 200) out[key] = leftOut(out[key]);
    return out;
  }
  if (line?.type === 'attachment' && line.attachment && typeof line.attachment === 'object') {
    const attachment = { ...line.attachment };
    for (const key of OUTPUT_FIELDS) if (typeof attachment[key] === 'string' && attachment[key].length > 200) attachment[key] = leftOut(attachment[key]);
    return { ...line, attachment };
  }
  return line;
}

// ---------------------------------------------------------------------------------------------------------------------
// The office's side: hooks posted to a loopback server, answered the way the switchboard would.

/** The open desk: hook calls are recorded in its exchange. */
let current = null;
/** What PreToolUse answers for the defer step's command: "defer" until the stakeholder says yes. */
let deferAnswer = 'defer';
const hanging = new Set();

const insideProject = (file) => {
  if (typeof file !== 'string' || file === '') return false;
  const rel = relative(project, resolve(project, file));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};
/** The slow commands the check asks for, as Haiku may write them. */
const isWait = (command) => /^\s*node -e "setTimeout\(/.test(command) && command.includes(WAIT_MARK);

async function answerHook(req, res, text) {
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Recorded as text below.
  }
  const desk = current;
  const event = typeof body?.hook_event_name === 'string' ? body.hook_event_name : null;
  const entry = desk
    ? note(desk, { from: 'hook', path: req.url, event, tokenOk: req.headers['x-worklings-desk'] === deskToken, body: body ?? text.slice(0, 2000) })
    : null;
  const reply = (answer) => {
    if (entry) {
      entry.answer = answer;
      entry.answeredAt = Date.now() - desk.started;
    }
    if (answer === null) res.writeHead(200).end();
    else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
  };
  const tool = String(body?.tool_name ?? '');
  const command = String(body?.tool_input?.command ?? '');

  if (event === 'PermissionRequest') {
    if (command.includes('hang-proof')) {
      if (entry) entry.answer = 'none (left to time out)';
      hanging.add(res);
      res.on('close', () => {
        hanging.delete(res);
        if (entry) entry.closedByClaudeAt = Date.now() - desk.started;
      });
      return;
    }
    const allowed =
      (tool === 'Bash' && (isWait(command) || command.includes('allow-proof'))) ||
      ((tool === 'Write' || tool === 'Edit') && insideProject(body?.tool_input?.file_path));
    if (command.includes('-proof')) await pause(APPROVAL_WAIT_MS);
    const decision = allowed
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: command.includes('deny-proof') ? 'The stakeholder declined this command.' : 'Not part of this check.' };
    reply({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
    return;
  }
  if (event === 'PreToolUse' && command.includes('defer-proof')) {
    const reason = deferAnswer === 'defer' ? 'Waiting for the stakeholder.' : 'The stakeholder approved it.';
    reply({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: deferAnswer, permissionDecisionReason: reason } });
    return;
  }
  reply(null);
}

const server = createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= LINE_LIMIT) chunks.push(chunk);
  });
  req.on('end', () => {
    answerHook(req, res, Buffer.concat(chunks).toString('utf8')).catch((error) => {
      log(`  the hook handler failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const port = server.address().port;

/** The office's hooks, passed with --settings. The desk token reaches them from the environment, not the command line. */
const hook = (path, timeout) => ({
  type: 'http',
  url: `http://127.0.0.1:${port}${path}`,
  timeout,
  headers: { 'X-Worklings-Desk': '$WORKLINGS_DESK_TOKEN' },
  allowedEnvVars: ['WORKLINGS_DESK_TOKEN'],
});
const settings = {
  hooks: {
    PermissionRequest: [{ hooks: [hook('/hooks/permission', APPROVAL_TIMEOUT_S)] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [hook('/hooks/pre-tool-use', 5)] }],
    UserPromptSubmit: [{ hooks: [hook('/hooks/event', 5)] }],
    Stop: [{ hooks: [hook('/hooks/event', 5)] }],
    SessionEnd: [{ hooks: [hook('/hooks/event', 5)] }],
  },
};
const settingsFile = join(harness, 'desk-settings.json');
writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

// ---------------------------------------------------------------------------------------------------------------------
// Desks: one claude process each, every line in and out recorded with its time.

const desks = [];

function note(desk, entry) {
  const recorded = { at: Date.now() - desk.started, scenario: desk.scenario, ...entry };
  desk.exchange.push(recorded);
  for (const listener of [...desk.listeners]) listener(recorded);
  return recorded;
}

function take(desk, text) {
  let line;
  try {
    line = JSON.parse(text);
  } catch {
    note(desk, { from: 'claude', kind: 'not-json', text: text.slice(0, 500) });
    return;
  }
  const entry = note(desk, { from: 'claude', line });
  // A write to a desk that has gone fails on its stdin, whose error handler records it.
  if (line?.type === 'control_request') answerHost(desk, entry).catch(() => undefined);
}

function openDesk(label, args, { sessionId, endInput = false }) {
  const desk = { label, args, sessionId, started: Date.now(), scenario: label, exchange: [], listeners: new Set(), stderr: '', exited: false };
  desks.push(desk);
  current = desk;
  const child = spawn(claude.command, [...claude.prefixArgs, ...args], {
    cwd: project,
    env: deskEnv(),
    shell: false,
    windowsHide: true,
    // Its own process group off Windows, so the whole tree can be killed; Windows uses taskkill /T.
    detached: !isWindows,
  });
  desk.child = child;
  desk.pid = child.pid;
  note(desk, { from: 'process', kind: 'start', args });
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    for (let nl = pending.indexOf('\n'); nl !== -1; nl = pending.indexOf('\n')) {
      const text = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (text) take(desk, text);
    }
    if (pending.length > LINE_LIMIT) {
      note(desk, { from: 'claude', kind: 'oversized', bytes: pending.length });
      pending = '';
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (desk.stderr.length < STDERR_LIMIT) desk.stderr += chunk.slice(0, STDERR_LIMIT - desk.stderr.length);
  });
  child.stdin.on('error', (error) => note(desk, { from: 'process', kind: 'stdin-error', code: error.code ?? String(error) }));
  child.on('error', (error) => note(desk, { from: 'process', kind: 'spawn-error', code: error.code ?? String(error) }));
  child.on('exit', (code, signal) => {
    desk.exited = true;
    note(desk, { from: 'process', kind: 'exit', code, signal });
  });
  if (endInput) {
    child.stdin.end();
    note(desk, { from: 'switchboard', kind: 'stdin-closed' });
  }
  return desk;
}

function send(desk, line) {
  desk.child.stdin.write(`${JSON.stringify(line)}\n`);
  return note(desk, { from: 'switchboard', line });
}

/** A user turn as the switchboard writes it: one JSON line on stdin. */
function say(desk, text, extra = {}) {
  return send(desk, { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: desk.sessionId, uuid: randomUUID(), ...extra });
}

const indexOf = (desk, entry) => desk.exchange.indexOf(entry);

/** The first entry from `from` on that passes `test`; rejects on a timeout, or when the process exits first. */
function waitFor(desk, test, { from = 0, ms = 120_000, what = 'a line' } = {}) {
  const hit = desk.exchange.slice(from).find(test);
  if (hit) return Promise.resolve(hit);
  if (desk.exited) return Promise.reject(new Error(`${desk.label}: Claude Code had exited before ${what}`));
  return new Promise((resolveWait, rejectWait) => {
    const finish = (error, entry) => {
      clearTimeout(timer);
      desk.listeners.delete(listener);
      if (error) rejectWait(error);
      else resolveWait(entry);
    };
    const listener = (entry) => {
      if (test(entry)) finish(null, entry);
      else if (entry.kind === 'exit') finish(new Error(`${desk.label}: Claude Code exited before ${what}`));
    };
    const timer = setTimeout(() => finish(new Error(`${desk.label}: no ${what} within ${ms / 1000} s`)), ms);
    desk.listeners.add(listener);
  });
}

const fromClaude = (type, subtype) => (e) => e.from === 'claude' && e.line?.type === type && (subtype === undefined || e.line.subtype === subtype);
const isResult = fromClaude('result');
const isExit = (e) => e.kind === 'exit';
const blocks = (e) => (Array.isArray(e?.line?.message?.content) ? e.line.message.content : []);
const bashCall = (needle) => (e) => fromClaude('assistant')(e) && blocks(e).some((b) => b?.type === 'tool_use' && String(b.input?.command ?? '').includes(needle));
const callId = (e, needle) => blocks(e).find((b) => b?.type === 'tool_use' && String(b.input?.command ?? '').includes(needle))?.id;
const callInput = (e, needle) => blocks(e).find((b) => b?.type === 'tool_use' && String(b.input?.command ?? '').includes(needle))?.input ?? null;
const toolResultOf = (id) => (e) => fromClaude('user')(e) && blocks(e).some((b) => b?.type === 'tool_result' && b.tool_use_id === id);
/** Whether a result's text holds a word, in any case (Haiku may write "Mango-1234"). */
const has = (entry, word) => String(entry?.line?.result ?? '').toLowerCase().includes(word.toLowerCase());
const contentText = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => (typeof b?.text === 'string' ? b.text : typeof b?.content === 'string' ? b.content : '')).join('') : '';
const resultText = (desk, id) => {
  const entry = desk.exchange.find(toolResultOf(id));
  const block = blocks(entry).find((b) => b?.type === 'tool_result' && b.tool_use_id === id);
  return block ? { at: entry.at, isError: block.is_error === true, text: contentText(block.content).slice(0, 300) } : null;
};
const hookCall = (desk, event, needle = '') =>
  desk.exchange.find((e) => e.from === 'hook' && e.event === event && (needle === '' || String(e.body?.tool_input?.command ?? '').includes(needle)));
const kinds = (entries) => entries.filter((e) => e.from === 'claude').map((e) => [e.line?.type, e.line?.subtype].filter(Boolean).join('/') || e.kind);
/** The states a message went through (queued, started, completed, cancelled), with their times. */
const lifecycle = (desk, sent) =>
  desk.exchange.filter((e) => fromClaude('command_lifecycle')(e) && e.line.command_uuid === sent.line.uuid).map((e) => `${e.line.state}@${e.at}`);
const echoes = (desk, sent) => desk.exchange.filter((e) => fromClaude('user')(e) && e.line.uuid === sent.line.uuid).map((e) => e.at);

/** Sends one user turn and waits for the result that ends it. */
async function turn(desk, text, { ms = 120_000, extra } = {}) {
  const sent = say(desk, text, extra);
  const result = await waitFor(desk, isResult, { from: indexOf(desk, sent) + 1, ms, what: 'a result' });
  return { sent, result };
}

const waitCommand = (seconds) => `node -e "setTimeout(() => console.log('${WAIT_MARK}'), ${seconds * 1000})"`;

/**
 * Asks for a slow foreground command and returns once it runs: Claude Code reports a foreground command that takes a
 * while as a task (system/task_started with is_backgrounded false).
 */
async function startWait(desk, seconds, word) {
  const sent = say(desk, `Use the Bash tool to run exactly this command, in the foreground and not in the background: ${waitCommand(seconds)}\nWhen it has finished, reply with one short line that starts with ${word}.`);
  const needle = `${seconds * 1000})`;
  const call = await waitFor(desk, bashCall(needle), { from: indexOf(desk, sent) + 1, ms: 90_000, what: `the ${seconds} s command` });
  const id = callId(call, needle);
  const running = await waitFor(desk, (e) => fromClaude('system', 'task_started')(e) && e.line.tool_use_id === id, { from: indexOf(desk, call) + 1, ms: 60_000, what: `the ${seconds} s command to start` });
  return { sent, call, id, running };
}

function brief(entry) {
  const r = entry?.line;
  if (!r) return null;
  return {
    at: entry.at,
    subtype: r.subtype,
    isError: r.is_error,
    stopReason: r.stop_reason ?? null,
    terminalReason: r.terminal_reason ?? null,
    text: String(r.result ?? '').slice(0, 300),
    numTurns: r.num_turns,
    totalCostUsd: r.total_cost_usd,
    usage: r.usage
      ? { input: r.usage.input_tokens, output: r.usage.output_tokens, cacheRead: r.usage.cache_read_input_tokens, cacheWrite: r.usage.cache_creation_input_tokens }
      : null,
    userMessageUuids: r.user_message_uuids ?? (r.user_message_uuid ? [r.user_message_uuid] : null),
    queuedTurnCount: r.queued_turn_count ?? null,
    permissionDenials: Array.isArray(r.permission_denials) ? r.permission_denials.map((d) => ({ tool: d.tool_name, command: d.tool_input?.command ?? null })) : null,
    apiErrorStatus: r.api_error_status ?? null,
    errors: r.errors ?? null,
    deferredToolUse: r.deferred_tool_use ?? null,
  };
}

const states = (desk, scenario) =>
  desk.exchange.filter((e) => fromClaude('system', 'session_state_changed')(e) && (!scenario || e.scenario === scenario)).map((e) => `${e.line.state}@${e.at}`);

async function closeDesk(desk, ms = 90_000) {
  const closed = note(desk, { from: 'switchboard', kind: 'stdin-closed' });
  desk.child.stdin.end();
  const exit = desk.exited ? desk.exchange.find(isExit) : await waitFor(desk, isExit, { from: indexOf(desk, closed) + 1, ms, what: 'its exit after stdin closed' });
  return {
    code: exit.code,
    signal: exit.signal,
    msToExit: exit.at - closed.at,
    linesAfterClose: kinds(desk.exchange.slice(indexOf(desk, closed) + 1)),
    sessionEnd: desk.exchange.filter((e) => e.from === 'hook' && e.event === 'SessionEnd').map((e) => e.body?.reason ?? null),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Processes: the tree under a desk, and killing it.

/** Every process with its parent and name, and whether its command line holds WAIT_MARK (the line itself isn't kept). */
function processTable() {
  const [file, args] = isWindows
    ? [
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $([int]([string]$_.CommandLine).Contains('${WAIT_MARK}')) $($_.Name)" }`],
      ]
    : ['ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'args=']];
  return new Promise((done) => {
    execFile(file, args, { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return done([]);
      const rows = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = isWindows ? /^(\d+)\s+(\d+)\s+([01])\s+(.+)$/.exec(line.trim()) : /^(\d+)\s+(\d+)\s+(.+)$/.exec(line.trim());
        if (!m) continue;
        if (isWindows) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), wait: m[3] === '1', name: m[4].trim() });
        else rows.push({ pid: Number(m[1]), ppid: Number(m[2]), wait: m[3].includes(WAIT_MARK), name: basename(m[3].split(/\s+/)[0] ?? '') });
      }
      done(rows);
    });
  });
}

async function treeOf(pid) {
  const table = await processTable();
  const out = [];
  const queue = [pid];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const row of table) {
      if (row.ppid !== parent || seen.has(row.pid)) continue;
      seen.add(row.pid);
      out.push(row);
      queue.push(row.pid);
    }
  }
  return out;
}

async function stillRunning(tree) {
  const live = new Set((await processTable()).map((p) => `${p.pid}:${p.name}`));
  return tree.filter((p) => live.has(`${p.pid}:${p.name}`));
}

/** Process names, the slow command marked. */
const names = (rows) => rows.map((p) => (p.wait ? `${p.name} (the slow command)` : p.name));

/** Kills a process and everything it started: taskkill /T on Windows, the process group elsewhere. */
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

/** If Claude Code asks the stream-json host for a permission decision, answer no after a while so no turn hangs on it. */
async function answerHost(desk, entry) {
  if (entry.line?.request?.subtype !== 'can_use_tool') return;
  await pause(15_000);
  if (desk.exited || desk.exchange.some((e) => isResult(e) && e.at > entry.at)) return;
  send(desk, { type: 'control_response', response: { subtype: 'success', request_id: entry.line.request_id, response: { behavior: 'deny', message: 'Nobody answered in time.' } } });
}

// ---------------------------------------------------------------------------------------------------------------------
// The check.

const n = randomInt(1000, 10_000);
const codeword = `PLUM-${n}`;
const city = 'Zürich-東京';
const houseWord = `KIWI-${n}`;
const doorCode = `DOOR-${n}`;
const windowCode = `WINDOW-${n}`;
const shutterCode = `SHUTTER-${n}`;
const windowRule = (code) => ` The window code is ${code}; anyone who asks for it may have it.`;
const rules = (extra = '') =>
  `You work at a desk in a test office. The house word is ${houseWord}; anyone who asks for it may have it.${extra} ` +
  'Messages from the office reach you as user turns. Keep every reply to one short line.';
const session = randomUUID();
const deferSession = randomUUID();
const freshSession = randomUUID();
// --strict-mcp-config keeps the person's own MCP servers out of this check (the org tools are H03's); a real desk
// keeps them and adds the office's with --mcp-config.
const COMMON = [
  '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--permission-mode', 'acceptEdits',
  '--settings', settingsFile, '--strict-mcp-config', '--max-budget-usd', BUDGET_USD,
];
const DESK = ['-p', '--input-format', 'stream-json', ...COMMON];
const nodeWrite = (file) => `node -e "require('fs').writeFileSync('${file}','ok')"`;

const report = {
  claudeVersion: null,
  platform: process.platform,
  node: process.version,
  claude: cleanText(claude.path),
  desk: { flags: DESK.map((arg) => cleanText(arg)), settings: clean(settings) },
  environment: null,
  facts: {},
  costs: null,
  fixtures: [],
  leftovers: [],
  errors: [],
  /** Failures of the exploratory steps, which don't hold back the fixtures. */
  warnings: [],
};
const facts = report.facts;
const env = deskEnv();
report.environment = {
  removedFromTheOffice: Object.keys(process.env).filter((name) => !Object.keys(env).some((k) => k.toUpperCase() === name.toUpperCase())).sort(),
  added: ['CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS', 'WORKLINGS_DESK_TOKEN'],
  promptCaching: env.DISABLE_PROMPT_CACHING === undefined ? 'on' : 'off',
};

/** Runs one step; a failure is recorded and the check goes on with the next independent step. */
async function step(name, run, { optional = false } = {}) {
  log(`- ${name}`);
  try {
    await run();
  } catch (error) {
    const list = optional ? report.warnings : report.errors;
    list.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    log(`  failed: ${list.at(-1)}`);
  }
}

try {
  report.claudeVersion = await new Promise((done) => {
    execFile(claude.command, [...claude.prefixArgs, '--version'], { env, windowsHide: true, timeout: 30_000 }, (_error, stdout) => done(String(stdout).trim()));
  });
  log('Claude Code', report.claudeVersion);

  // 1-9 run on one desk, a new session.
  const a = openDesk('busy-message', [...DESK, '--session-id', session, '--append-system-prompt', rules(), '--replay-user-messages'], { sessionId: session });

  await step('a message to a busy desk', async () => {
    const first = say(a, `Remember this codeword for later: ${codeword}, and this city: ${city}. Reply with just OK.`);
    const init = await waitFor(a, fromClaude('system', 'init'), { what: 'the init message' });
    const ok = await waitFor(a, isResult, { from: indexOf(a, first) + 1, what: 'the first result' });
    const wait = await startWait(a, 32, 'DONE-1');
    await pause(1_500);
    const second = say(a, `A second message, sent while you work: before you reply, also create a file named extra.txt in the current folder containing the word extra, and put the word MANGO-${n} in your reply.`);
    const results = [await waitFor(a, isResult, { from: indexOf(a, second) + 1, ms: 150_000, what: 'the result' })];
    if (!has(results[0], `MANGO-${n}`)) {
      const next = await waitFor(a, isResult, { from: indexOf(a, results[0]) + 1, ms: 90_000, what: 'a second result' }).catch(() => null);
      if (next) results.push(next);
    }
    const write = a.exchange.find((e) => fromClaude('assistant')(e) && blocks(e).some((b) => b?.type === 'tool_use' && String(b.input?.file_path ?? '').includes('extra.txt')));
    const firstEcho = a.exchange.find((e) => fromClaude('user')(e) && e.line.uuid === first.line.uuid);
    facts.busyMessage = {
      init: {
        at: init.at,
        sameSession: init.line.session_id === session,
        model: init.line.model,
        permissionMode: init.line.permissionMode,
        apiKeySource: init.line.apiKeySource,
        capabilities: init.line.capabilities ?? null,
        tools: init.line.tools,
        mcpServers: init.line.mcp_servers,
        personalListCounts: Object.fromEntries(PERSONAL_LISTS.map((key) => [key, Array.isArray(init.line[key]) ? init.line[key].length : null])),
      },
      firstTurn: { lifecycle: lifecycle(a, first), echoedAt: echoes(a, first), result: brief(ok) },
      stdinUtf8RoundTrip: firstEcho ? contentText(firstEcho.line.message?.content) === first.line.message.content : null,
      waitCall: { at: wait.call.at, input: callInput(wait.call, '32000)'), runningAt: wait.running.at, running: wait.running.line },
      waitPermission: hookCall(a, 'PermissionRequest', '32000)')?.answer ?? 'not asked',
      secondSentAt: second.at,
      secondLifecycle: lifecycle(a, second),
      secondEchoedAt: echoes(a, second),
      waitFinishedAt: resultText(a, wait.id)?.at ?? null,
      waitResult: resultText(a, wait.id),
      extraFileWrittenAt: write?.at ?? null,
      heartbeats: a.exchange.filter(fromClaude('tool_progress')).map((e) => ({ at: e.at, heartbeat: e.line.heartbeat ?? null, tool: e.line.tool_name ?? null, seconds: e.line.elapsed_time_seconds ?? null })),
      userPromptSubmitHooks: a.exchange.filter((e) => e.from === 'hook' && e.event === 'UserPromptSubmit').map((e) => ({ at: e.at, prompt: String(e.body?.prompt ?? '').slice(0, 60) })),
      stopHooks: a.exchange.filter((e) => e.from === 'hook' && e.event === 'Stop').map((e) => e.at),
      initMessages: a.exchange.filter(fromClaude('system', 'init')).length,
      results: results.map(brief),
      oneTurn: results.length === 1 && has(results[0], `MANGO-${n}`) && has(results[0], 'DONE-1'),
      extraFile: inProject('extra.txt'),
      states: states(a, 'busy-message'),
    };
    log(`  one turn: ${facts.busyMessage.oneTurn}, extra.txt: ${facts.busyMessage.extraFile}, results: ${results.length}`);
  });

  await step('the next line after a turn ended, approved by the hook', async () => {
    a.scenario = 'approval-allow';
    const { sent, result } = await turn(a, `Use the Bash tool to run exactly this command: ${nodeWrite('allow-proof.txt')}\nThen reply with one short line saying whether it ran.`);
    const asked = hookCall(a, 'PermissionRequest', 'allow-proof');
    const call = a.exchange.find(bashCall('allow-proof'));
    facts.approvalAllow = {
      sentAt: sent.at,
      lifecycle: lifecycle(a, sent),
      initMessages: a.exchange.filter((e) => e.scenario === 'approval-allow' && fromClaude('system', 'init')(e)).length,
      hookAt: asked?.at ?? null,
      answeredAt: asked?.answeredAt ?? null,
      tokenArrived: asked?.tokenOk ?? null,
      payloadKeys: asked && typeof asked.body === 'object' ? Object.keys(asked.body).sort() : null,
      answer: asked?.answer ?? null,
      toolResult: call ? resultText(a, callId(call, 'allow-proof')) : null,
      ran: inProject('allow-proof.txt'),
      result: brief(result),
      states: states(a, 'approval-allow'),
    };
    log(`  hook asked: ${Boolean(asked)}, ran: ${facts.approvalAllow.ran}`);
  });

  await step('a denial from the hook', async () => {
    a.scenario = 'approval-deny';
    const { result } = await turn(a, `Use the Bash tool to run exactly this command: ${nodeWrite('deny-proof.txt')}\nThen reply with one short line saying whether it ran.`);
    const asked = hookCall(a, 'PermissionRequest', 'deny-proof');
    const call = a.exchange.find(bashCall('deny-proof'));
    facts.approvalDeny = {
      hookAt: asked?.at ?? null,
      answeredAt: asked?.answeredAt ?? null,
      answer: asked?.answer ?? null,
      toolResult: call ? resultText(a, callId(call, 'deny-proof')) : null,
      ran: inProject('deny-proof.txt'),
      permissionDenied: a.exchange.filter((e) => e.scenario === 'approval-deny' && fromClaude('system', 'permission_denied')(e)).map((e) => e.line),
      result: brief(result),
    };
    log(`  ran: ${facts.approvalDeny.ran}`);
  });

  await step('an approval left unanswered past the hook timeout', async () => {
    a.scenario = 'approval-timeout';
    const { result } = await turn(a, `Use the Bash tool to run exactly this command: ${nodeWrite('hang-proof.txt')}\nThen reply with one short line saying whether it ran.`, { ms: 90_000 });
    const asked = hookCall(a, 'PermissionRequest', 'hang-proof');
    const call = a.exchange.find(bashCall('hang-proof'));
    facts.approvalTimeout = {
      hookTimeoutSeconds: APPROVAL_TIMEOUT_S,
      hookAt: asked?.at ?? null,
      gaveUpAt: asked?.closedByClaudeAt ?? null,
      msUntilClaudeGaveUp: asked && asked.closedByClaudeAt !== undefined ? asked.closedByClaudeAt - asked.at : null,
      hostAsked: a.exchange.filter((e) => e.scenario === 'approval-timeout' && fromClaude('control_request')(e)).map((e) => e.line),
      permissionDenied: a.exchange.filter((e) => e.scenario === 'approval-timeout' && fromClaude('system', 'permission_denied')(e)).map((e) => e.line),
      toolResult: call ? resultText(a, callId(call, 'hang-proof')) : null,
      ran: inProject('hang-proof.txt'),
      result: brief(result),
    };
    log(`  gave up after ${facts.approvalTimeout.msUntilClaudeGaveUp} ms, ran: ${facts.approvalTimeout.ran}`);
  });

  await step('stop with the interrupt control request', async () => {
    a.scenario = 'interrupt';
    const wait = await startWait(a, 40, 'DONE-5');
    await pause(2_000);
    const tree = await treeOf(a.pid);
    const interrupt = send(a, { type: 'control_request', request_id: `interrupt-${n}`, request: { subtype: 'interrupt' } });
    const ack = await waitFor(a, fromClaude('control_response'), { from: indexOf(a, interrupt) + 1, ms: 30_000, what: 'the interrupt response' }).catch(() => null);
    const stopped = await waitFor(a, isResult, { from: indexOf(a, interrupt) + 1, ms: 60_000, what: 'the result of the stopped turn' });
    await pause(1_500);
    facts.interrupt = {
      waitRunningAt: wait.running.at,
      interruptSentAt: interrupt.at,
      acknowledged: ack ? { at: ack.at, line: ack.line } : null,
      resultAt: stopped.at,
      msUntilResult: stopped.at - interrupt.at,
      toolResult: resultText(a, wait.id),
      result: brief(stopped),
      lifecycle: lifecycle(a, wait.sent),
      processesDuringCommand: names(tree),
      stillRunningAfter: names(await stillRunning(tree)),
      states: states(a, 'interrupt'),
    };
    log(`  result ${facts.interrupt.msUntilResult} ms after the interrupt: ${stopped.line.subtype}/${stopped.line.terminal_reason}; still running: ${facts.interrupt.stillRunningAfter.join(', ') || 'nothing'}`);
  });

  await step('the same process after the interrupt', async () => {
    a.scenario = 'after-interrupt';
    const { result } = await turn(a, 'You were stopped a moment ago. Reply in one line with: the codeword and the city from my first message, the house word, and whether your last command finished.');
    facts.afterInterrupt = { result: brief(result), codeword: has(result, codeword), city: has(result, city), houseWord: has(result, houseWord) };
    log(`  codeword: ${facts.afterInterrupt.codeword}, city: ${facts.afterInterrupt.city}, house word: ${facts.afterInterrupt.houseWord}`);
  });

  // A message with priority "now" and no origin interrupts the turn; with a human origin, the docs say the running
  // command moves to the background and the message is read in the same turn.
  for (const [scenario, origin, seconds, word] of [['priority-now', null, 41, 'DONE-6'], ['priority-now-human', { kind: 'human' }, 25, 'DONE-7']]) {
    await step(`a message with priority "now"${origin ? ' from a human' : ''}`, async () => {
      a.scenario = scenario;
      const wait = await startWait(a, seconds, word);
      await pause(2_000);
      const tree = await treeOf(a.pid);
      const reply = origin ? `HELLO-${n}` : `REDIRECTED-${n}`;
      const text = origin
        ? `A quick question while you work, no need to stop: reply with the word ${reply}.`
        : `Stop what you are doing. Reply with only the word ${reply}.`;
      const urgent = say(a, text, { priority: 'now', ...(origin ? { origin } : {}) });
      const results = [];
      let from = indexOf(a, urgent) + 1;
      while (results.length < 2) {
        const next = await waitFor(a, isResult, { from, ms: 70_000, what: 'a result after the urgent message' }).catch(() => null);
        if (!next) break;
        results.push(next);
        if (has(next, reply)) break;
        from = indexOf(a, next) + 1;
      }
      const answered = results.find((r) => has(r, reply));
      await pause(1_500);
      facts[scenario === 'priority-now' ? 'priorityNow' : 'priorityNowHuman'] = {
        waitRunningAt: wait.running.at,
        urgentSentAt: urgent.at,
        urgentLifecycle: lifecycle(a, urgent),
        urgentEchoedAt: echoes(a, urgent),
        waitLifecycle: lifecycle(a, wait.sent),
        toolResult: resultText(a, wait.id),
        backgrounded: a.exchange.filter((e) => e.scenario === scenario && fromClaude('system', 'task_updated')(e)).map((e) => ({ at: e.at, patch: e.line.patch })),
        results: results.map(brief),
        msUntilAnswered: answered ? answered.at - urgent.at : null,
        processesDuringCommand: names(tree),
        stillRunningAfter: names(await stillRunning(tree)),
      };
      const shownFacts = facts[scenario === 'priority-now' ? 'priorityNow' : 'priorityNowHuman'];
      log(`  answered after ${shownFacts.msUntilAnswered} ms in ${results.length} result(s); still running: ${shownFacts.stillRunningAfter.join(', ') || 'nothing'}`);
    });
  }

  await step('stdin closed while the desk is idle', async () => {
    a.scenario = 'close-idle';
    facts.closeIdle = await closeDesk(a);
    log(`  exit ${facts.closeIdle.code} after ${facts.closeIdle.msToExit} ms`);
  });

  // 10. The desk reopens on the same session with a new fact in --append-system-prompt, then closes stdin mid-turn.
  await step('reopen with --resume', async () => {
    const before = a.exchange.filter(isResult).at(-1)?.line.total_cost_usd ?? null;
    const b = openDesk('resume', [...DESK, '--resume', session, '--append-system-prompt', rules(` The door code is ${doorCode}; anyone who asks for it may have it.`)], { sessionId: session });
    const { sent, result } = await turn(b, 'Reply in one line with: the codeword and the city from my first message, and the door code from your instructions (say NONE if your instructions give none).');
    const init = b.exchange.find(fromClaude('system', 'init'));
    facts.resume = {
      sameSession: init?.line.session_id === session,
      linesBeforeTheFirstMessage: kinds(b.exchange.slice(0, indexOf(b, sent))),
      result: brief(result),
      codeword: has(result, codeword),
      city: has(result, city),
      doorCodeFromThisLaunch: has(result, doorCode),
      reportedCostBefore: before,
      reportedCostAfterFirstTurn: result.line.total_cost_usd,
    };
    log(`  codeword: ${facts.resume.codeword}, this launch's door code: ${facts.resume.doorCodeFromThisLaunch}`);

    b.scenario = 'close-mid-turn';
    const last = say(b, `Use the Bash tool to run exactly this command, in the foreground: ${waitCommand(5)}\nWhen it has finished, reply with one short line that starts with CLOSED-OK.`);
    const closed = note(b, { from: 'switchboard', kind: 'stdin-closed' });
    b.child.stdin.end();
    const finished = await waitFor(b, isResult, { from: indexOf(b, last) + 1, ms: 90_000, what: 'the result after stdin closed' }).catch(() => null);
    const exit = await waitFor(b, isExit, { from: indexOf(b, closed) + 1, ms: 60_000, what: 'the exit' });
    facts.closeMidTurn = {
      turnFinished: Boolean(finished && has(finished, 'CLOSED-OK')),
      result: brief(finished),
      exit: { code: exit.code, signal: exit.signal, msAfterClose: exit.at - closed.at, msAfterResult: finished ? exit.at - finished.at : null },
      sessionEnd: b.exchange.filter((e) => e.from === 'hook' && e.event === 'SessionEnd').map((e) => e.body?.reason ?? null),
    };
    log(`  turn finished: ${facts.closeMidTurn.turnFinished}, exit ${exit.code}`);
  });

  // 11. Reopen with the snapshot off and another new fact, then a signal mid-command.
  await step('reopen with --system-prompt-snapshot off, then a signal', async () => {
    const c = openDesk('snapshot-off', [...DESK, '--resume', session, '--system-prompt-snapshot', 'off', '--append-system-prompt', rules(windowRule(windowCode))], { sessionId: session });
    const { result } = await turn(c, 'Reply in one line with the window code from your instructions (say NONE if your instructions give none).');
    facts.snapshotOff = { result: brief(result), windowCodeFromThisLaunch: has(result, windowCode) };
    log(`  this launch's window code: ${facts.snapshotOff.windowCodeFromThisLaunch}`);

    c.scenario = 'signal';
    const wait = await startWait(c, 42, 'DONE-8');
    await pause(2_000);
    const tree = await treeOf(c.pid);
    const signalled = note(c, { from: 'switchboard', kind: 'signal', signal: 'SIGINT' });
    c.child.kill('SIGINT');
    const exit = await waitFor(c, isExit, { from: indexOf(c, signalled) + 1, ms: 20_000, what: 'its exit after SIGINT' }).catch(() => null);
    await pause(1_500);
    const left = await stillRunning(tree);
    facts.signal = {
      waitRunningAt: wait.running.at,
      signalAt: signalled.at,
      exit: exit ? { code: exit.code, signal: exit.signal, msAfterSignal: exit.at - signalled.at } : null,
      linesAfterSignal: kinds(c.exchange.slice(indexOf(c, signalled) + 1)),
      processesDuringCommand: names(tree),
      stillRunningAfter: names(left),
    };
    for (const p of left) await killTree(p.pid, false);
    if (!exit) facts.signal.afterStdinClosed = await closeDesk(c).catch((error) => String(error));
    facts.signal.leftAfterCleanup = names(await stillRunning(tree));
    log(`  exit ${JSON.stringify(facts.signal.exit)}, still running after: ${facts.signal.stillRunningAfter.join(', ') || 'nothing'}`);
  });

  // 12. The session after the kill, reopened without --append-system-prompt.
  await step('reopen after the signal', async () => {
    const d = openDesk('after-signal', [...DESK, '--resume', session], { sessionId: session });
    const { result } = await turn(d, 'Reply in one line with: the codeword from my first message, the door code and the window code from your instructions (NONE for any they give none of), and whether your last command finished.');
    facts.afterSignal = {
      result: brief(result),
      codeword: has(result, codeword),
      doorCode: has(result, doorCode),
      windowCode: has(result, windowCode),
      close: await closeDesk(d),
    };
    log(`  codeword: ${facts.afterSignal.codeword}, door code: ${facts.afterSignal.doorCode}, window code: ${facts.afterSignal.windowCode}`);
  });

  // 13. A session that never records its system prompt: started with --system-prompt-snapshot off, then reopened the
  // same way with a different window code. The first answer is in the history, so only the new code shows the new
  // prompt reached the model.
  await step('a session started with --system-prompt-snapshot off', async () => {
    const g = openDesk('no-snapshot', [...DESK, '--session-id', freshSession, '--system-prompt-snapshot', 'off', '--append-system-prompt', rules(windowRule(windowCode))], { sessionId: freshSession });
    const first = await turn(g, 'Reply in one line with the window code from your instructions (say NONE if your instructions give none).');
    const firstClose = await closeDesk(g);
    const h = openDesk('no-snapshot-resume', [...DESK, '--resume', freshSession, '--system-prompt-snapshot', 'off', '--append-system-prompt', rules(windowRule(shutterCode))], { sessionId: freshSession });
    const second = await turn(h, 'Your instructions may have changed since. Reply in one line with the window code your instructions give now (say NONE if they give none).');
    facts.noSnapshot = {
      first: brief(first.result),
      firstSawItsCode: has(first.result, windowCode),
      firstClose,
      second: brief(second.result),
      secondSawTheNewCode: has(second.result, shutterCode),
      secondSawTheOldCode: has(second.result, windowCode),
      secondClose: await closeDesk(h),
    };
    log(`  new session saw its code: ${facts.noSnapshot.firstSawItsCode}; reopened desk saw the new code: ${facts.noSnapshot.secondSawTheNewCode}`);
  }, { optional: true });

  // 14. A call parked with PreToolUse "defer", then run once the stakeholder says yes.
  await step('a call parked with defer', async () => {
    deferAnswer = 'defer';
    const e = openDesk('defer', [...DESK, '--session-id', deferSession], { sessionId: deferSession });
    const { result } = await turn(e, `Use the Bash tool to run exactly this command: ${nodeWrite('defer-proof.txt')}\nThen reply with one short line saying whether it ran.`, { ms: 90_000 });
    await pause(2_000);
    facts.defer = {
      result: brief(result),
      ranWhileParked: inProject('defer-proof.txt'),
      deskStillOpen: !e.exited,
      preToolUseAnswers: e.exchange.filter((x) => x.from === 'hook' && x.event === 'PreToolUse').map((x) => x.answer?.hookSpecificOutput?.permissionDecision ?? null),
      close: await closeDesk(e),
    };
    log(`  stop reason: ${facts.defer.result?.stopReason}, ran: ${facts.defer.ranWhileParked}`);
    if (facts.defer.result?.stopReason !== 'tool_deferred') throw new Error('the turn did not end with stop_reason tool_deferred');

    // The stakeholder says yes. The desk reopens on the session and is sent nothing: a prompt would drop the call.
    deferAnswer = 'allow';
    const f = openDesk('defer-resume', [...DESK, '--resume', deferSession], { sessionId: deferSession });
    const ran = await waitFor(f, isResult, { ms: 150_000, what: 'the parked call to run' }).catch(() => null);
    facts.deferResume = {
      ranWithoutAPrompt: Boolean(ran) && inProject('defer-proof.txt'),
      result: brief(ran),
      preToolUseAnswers: f.exchange.filter((x) => x.from === 'hook' && x.event === 'PreToolUse').map((x) => x.answer?.hookSpecificOutput?.permissionDecision ?? null),
      promptsSeen: f.exchange.filter((x) => x.from === 'hook' && x.event === 'UserPromptSubmit').map((x) => String(x.body?.prompt ?? '').slice(0, 80)),
      close: await closeDesk(f),
      ran: inProject('defer-proof.txt'),
    };
    log(`  reopened desk ran it without a prompt: ${facts.deferResume.ranWithoutAPrompt}`);
  }, { optional: true });

  // Every hook call should have carried the desk's token, read from the environment into the header.
  const hookCalls = desks.flatMap((desk) => desk.exchange.filter((e) => e.from === 'hook'));
  facts.hooks = {
    calls: hookCalls.length,
    withTheDeskToken: hookCalls.filter((e) => e.tokenOk).length,
    byEvent: Object.fromEntries([...new Set(hookCalls.map((e) => e.event))].map((event) => [event, hookCalls.filter((e) => e.event === event).length])),
  };
  const limits = desks.flatMap((desk) => desk.exchange.filter(fromClaude('rate_limit_event')));
  facts.rateLimitEvents = {
    count: limits.length,
    statuses: [...new Set(limits.map((e) => e.line.rate_limit_info?.status))],
    keys: [...new Set(limits.flatMap((e) => Object.keys(e.line.rate_limit_info ?? {})))].sort(),
  };
  facts.lineTypes = [...new Set(desks.flatMap((desk) => kinds(desk.exchange)))].sort();
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  for (const desk of desks) if (!desk.exited) await killTree(desk.pid);
  for (const res of hanging) res.destroy();
  server.close();

  // How the sessions' transcripts store what the desks were sent, and what they cost.
  const readTranscript = (id) => {
    const file = join(transcripts, `${id}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  };
  const entries = readTranscript(session);
  const deferEntries = readTranscript(deferSession);
  const freshEntries = readTranscript(freshSession);
  // Claude Code 2.1.312 records the requests it sends (api-request-blob) and the system prompt it snapshots
  // (attachment/prompt_snapshot) in the transcript. Which launch's facts each one carries shows what reached the model;
  // only those booleans are kept, never the text, which holds the person's own CLAUDE.md.
  const carried = (list) =>
    list
      .filter((e) => e.type === 'api-request-blob' || e.attachment?.type === 'prompt_snapshot')
      .map((e) => {
        const text = JSON.stringify(e);
        const codes = [houseWord, doorCode, windowCode, shutterCode].filter((code) => text.includes(code)).map((code) => code.replace(`-${n}`, ''));
        return `${e.type === 'attachment' ? 'prompt_snapshot' : 'request'}: ${codes.join(', ') || 'none of the codes'}`;
      });
  facts.systemPromptInTranscripts = { main: carried(entries), noSnapshot: carried(freshEntries) };
  const holding = (needle) =>
    entries
      .filter((e) => e.type !== 'assistant' && e.type !== 'api-request-blob' && JSON.stringify(e).includes(needle))
      .map((e) => [e.type, e.attachment?.type ?? e.operation ?? null].filter(Boolean).join('/'));
  facts.transcript = {
    entries: entries.length,
    types: [...new Set(entries.map((e) => (e.type === 'attachment' ? `attachment/${e.attachment?.type}` : e.type)))].sort(),
    busyMessageStoredAs: holding(`MANGO-${n}`),
    urgentMessageStoredAs: holding(`REDIRECTED-${n}`),
    humanMessageStoredAs: holding(`HELLO-${n}`),
    interruptedTurns: entries
      .filter((e) => e.type === 'user' && /interrupt/i.test(JSON.stringify(e.message?.content ?? '')))
      .map((e) => cleanText(contentText(e.message?.content).slice(0, 200) || JSON.stringify(e.message?.content).slice(0, 200))),
  };

  // Costs. Each API request is priced once from the transcripts (deduped by message id); total_cost_usd is cumulative
  // per session, and a resumed desk starts from what Claude Code recorded for the session.
  const priced = (list) => {
    const seen = new Set();
    let usd = 0;
    for (const e of list) {
      const id = e.message?.id;
      if (e.type !== 'assistant' || !id || seen.has(id) || typeof e.message?.model !== 'string' || !e.message.usage) continue;
      seen.add(id);
      usd += costOf(e.message.model, usageFromApi(e.message.usage)) ?? 0;
    }
    return { requests: seen.size, usd };
  };
  const bills = [entries, deferEntries, freshEntries].map(priced);
  report.costs = {
    transcriptPricedUsd: bills.reduce((sum, bill) => sum + bill.usd, 0),
    requests: bills.reduce((sum, bill) => sum + bill.requests, 0),
    reportedByDesk: desks.map((desk) => {
      const results = desk.exchange.filter(isResult).map((e) => e.line.total_cost_usd);
      return { desk: desk.label, results: results.length, first: results[0] ?? null, last: results.at(-1) ?? null };
    }),
  };
  log(`Spent about $${report.costs.transcriptPricedUsd.toFixed(4)} in ${report.costs.requests} requests`);

  const version = /^\d+\.\d+\.\d+/.exec(report.claudeVersion ?? '')?.[0];
  const outDir = report.errors.length === 0 && version ? join(repo, 'test', 'fixtures', `claude-${version}`, 'desk') : join(repo, 'test-results', 'desk-fixtures-partial');
  mkdirSync(outDir, { recursive: true });
  for (const desk of desks) {
    const scenarios = [...new Set(desk.exchange.map((e) => e.scenario))];
    for (const [i, scenario] of scenarios.entries()) {
      const own = desk.exchange.filter((e) => e.scenario === scenario && e.kind !== 'start');
      if (own.length === 0) continue;
      const t0 = own[0].at;
      const header = { at: 0, from: 'process', kind: i === 0 ? 'desk' : 'continues', desk: desk.label, deskAt: t0, args: desk.args };
      const shift = (value) => (typeof value === 'number' ? value - t0 : value);
      const lines = [
        header,
        ...own.map(({ at, scenario: _scenario, ...rest }) => ({
          at: at - t0,
          ...rest,
          ...(rest.line ? { line: forFixture(rest.line) } : {}),
          ...('answeredAt' in rest ? { answeredAt: shift(rest.answeredAt) } : {}),
          ...('closedByClaudeAt' in rest ? { closedByClaudeAt: shift(rest.closedByClaudeAt) } : {}),
        })),
      ];
      writeFileSync(join(outDir, `${scenario}.jsonl`), `${lines.map((l) => JSON.stringify(clean(l))).join('\n')}\n`);
      report.fixtures.push(shown(join(outDir, `${scenario}.jsonl`)));
    }
  }
  // The session's transcript: what the watching side (v1's parser) reads for a desk.
  const kept = entries.filter((e) => e.type === 'user' || e.type === 'assistant' || e.attachment?.type === 'queued_command');
  writeFileSync(join(outDir, 'transcript.jsonl'), `${kept.map((e) => JSON.stringify(clean(e))).join('\n')}\n`);
  writeFileSync(join(outDir, 'settings.json'), `${JSON.stringify(clean(settings), null, 2)}\n`);
  report.fixtures.push(shown(join(outDir, 'transcript.jsonl')), shown(join(outDir, 'settings.json')));

  // Nothing of this machine may be left in what was written.
  for (const file of readdirSync(outDir)) {
    const text = readFileSync(join(outDir, file), 'utf8');
    if (HAS_USERNAME.test(text)) report.leftovers.push(`${file}: the user name`);
    if (FIRST_NAME?.test(text)) report.leftovers.push(`${file}: a first name`);
    if (text.toLowerCase().includes(home.toLowerCase()) || text.toLowerCase().includes(home.replaceAll('\\', '/').toLowerCase())) report.leftovers.push(`${file}: the home folder`);
    if ((text.replaceAll('user@example.com', '').match(EMAIL) ?? []).length > 0) report.leftovers.push(`${file}: an email address`);
  }
  if (report.leftovers.length > 0) log('Sanitizing left something:', report.leftovers.join('; '));

  for (const desk of desks) {
    if (desk.stderr.trim()) (report.stderr ??= {})[desk.label] = cleanText(desk.stderr).slice(0, 2000);
  }
  mkdirSync(join(repo, 'test-results'), { recursive: true });
  writeFileSync(join(repo, 'test-results', 'desk-check.json'), `${JSON.stringify(clean(report), null, 2)}\n`);
  log(`Wrote test-results/desk-check.json and ${report.fixtures.length} fixtures in ${shown(outDir)}`);
  if (report.errors.length > 0) log(`${report.errors.length} step(s) failed:\n  ${report.errors.join('\n  ')}`);
  if (report.warnings.length > 0) log(`${report.warnings.length} exploratory step(s) failed:\n  ${report.warnings.join('\n  ')}`);

  if (!keep) {
    // Only what this run made: the two temp folders, and the temp project's transcripts and task output (Claude Code
    // keeps the latter in <temp>/claude/<project folder as a name>).
    const remove = (path, parent, marker) => {
      const full = resolve(path);
      if (full.startsWith(resolve(parent) + sep) && basename(full).includes(marker)) rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    };
    remove(project, tmpdir(), 'worklings-desk-check-');
    remove(harness, tmpdir(), 'worklings-desk-harness-');
    remove(transcripts, join(claudeHome, 'projects'), 'worklings-desk-check-');
    remove(join(tmpdir(), 'claude', encoded(project)), join(tmpdir(), 'claude'), 'worklings-desk-check-');
  }
  process.exitCode = report.errors.length > 0 ? 1 : 0;
}
