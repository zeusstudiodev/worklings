// A stand-in for a Claude Code desk (`claude -p --input-format stream-json --output-format stream-json --verbose`) for
// the switchboard's tests and the end-to-end suite. It never calls a model. Point WORKLINGS_CLAUDE at this file and
// the switchboard runs it with the current Node. Its lines follow Claude Code 2.1.312's, as the fixtures in
// test/fixtures/claude-2.1.312/desk/ and mcp/ show them: system/init at the start of every turn, command_lifecycle for
// every user line (queued, started, completed or cancelled), session_state_changed, tool calls with tool_progress
// heartbeats and tasks, one result per turn with model_usage_since_last_result, the interrupt control request, and
// sessions that --resume finds again. It calls the office the way Claude Code does: the PermissionRequest and Stop
// hooks in its --settings (headers expanded from its environment) and the org tools in its --mcp-config (MCP
// 2026-07-28, falling back to the 2025-11-25 handshake on a 400).
//
// Environment:
//   FAKE_DESK_SCRIPT    a JSON file saying what each turn does (below); without one every turn just answers
//   FAKE_DESK_LOG       a JSONL file it appends to: start (argv, cwd, the --settings and --mcp-config text, which
//                       variables were set, never the token's value, and TMP, TEMP and TMPDIR), every line it reads,
//                       children it starts, hook and MCP calls with their answers, scratch files, and its exit
//   FAKE_DESK_SESSIONS  the folder that keeps its sessions, so --resume finds them (the system temp folder otherwise)
//
// The script: { startup?, heartbeatMs?, initDelayMs?, interrupt?: { ackMs?, ignore? }, closeDelayMs?, scenarios?: { name: steps },
// turns?: [name, ...], byText?: [{ includes, scenario }], default?: steps }. A turn runs the scenario its first message
// names with "[fake:<name>]", else the first `byText` rule whose text the message contains (and, with `folder`, whose
// working folder's name contains that), else the next name in
// `turns`, else `default`, else one answer. `startup` is { delayMs?, exit?: { code, stderr } }.
// Steps, one key each:
//   { say: "text" }                         an answer; the last one is the turn's result text
//   { wait: ms }                            silence: nothing at all is written for that long
//   { think: ms }                           a thinking_tokens line, then silence
//   { tool: "Bash", input: {...}, ms?, spawn?, ask? }
//                                           a tool call: asks the PermissionRequest hook when Claude Code would
//                                           (`ask` overrides), runs for `ms` with heartbeats and a task, starts a real
//                                           child process when `spawn` is set (killed when the call ends or stops)
//   { org: "post_status", arguments: {...} } a call to the org tools' server
//   { limit: { status, resetsInMs?|resetsAt?, utilization?, rateLimitType? } }   a rate_limit_event
//   { fail: "usage-limit"|"overloaded"|"not-signed-in"|"api-error", text? }       ends the turn with an error result
//   { crash: { code, stderr? } }            exits at once, mid-turn
//   { partial: "text" }                     writes a line without its end, then exits with code 1
//   { garbage: ["line", ...] }              lines that aren't protocol
//   { big: bytes }                          one line longer than any reader keeps
//   { stderr: "text", repeat? }             writes to standard error
//   { hang: true | "deaf" }                 never finishes; an interrupt stops it unless it is deaf
//   { orphan: true, lingerMs? }             what a background `npm run dev` does on Windows: a shell (a child of the desk) starts
//                                           a long-running node server detached, stays for lingerMs (3 s: the office polls
//                                           the process table, so it needs to see the shell) and exits, leaving the server's
//                                           parent gone. Logged as "orphan" with childPid; the fake never kills it (it gives
//                                           up on its own after ORPHAN_MS)
//   { background: ms }                      starts a background command; when it ends, one more turn follows
//   { recall: true }                        answers with every message of the session so far
//   { sayResult: "lead" }                   answers with the lead and the last org call's result, its fence lines left out
//                                           (the studio chat passing on what CEOs said)
//   { scratchFile: "name" }                 writes a file into TMPDIR, as a script the desk runs would
//   { helper: { type?, description?, ms? } } a subagent started with the Agent tool: its meta and transcript files under
//                                           CLAUDE_CONFIG_DIR's projects folder, unfinished for `ms`, then finished
// Lean desks: init's tools are the ones --tools names (the four it always had without the flag), plus a `ping` tool for
// each server --mcp-config names besides org. Script keys: `rejectFlags` (exits at once, as a Claude Code without
// --setting-sources, --strict-mcp-config and --tools does: "error: unknown option"), `leakMcp: ["name"]` (init also lists
// a tool of a server nobody gave it, as Claude Code does when --strict-mcp-config isn't honoured), `leakServers` (the same
// in init's mcp_servers) and `omitTools` (init names no tools, as an older Claude Code's didn't).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { answerClaudeCommand } from './fake-claude-cli.mjs';

// `--version` and `auth status`, which the hub's first-run check runs, are answered there and never open a desk.
await answerClaudeCommand(process.argv.slice(2));

const MODEL = 'claude-haiku-5-5';
const VERSION = '2.1.312';
/** What one request costs here, in dollars, so tests can check a turn's cost against its requests. */
const REQUEST_COST = 0.001;
const CONTEXT_WINDOW = 200_000;
/** Nobody should need the fake longer than this; it leaves on its own so a failed test leaves nothing running. */
const GIVE_UP_MS = 10 * 60_000;
const CAPABILITIES = ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1', 'interrupt_send_now_v1', 'msg_lifecycle_v1'];

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const logFile = process.env.FAKE_DESK_LOG;
const log = (entry) => {
  if (logFile) appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, at: Date.now(), ...entry })}\n`);
};

function readJsonArg(value) {
  if (value === undefined) return { text: null, json: null };
  const text = existsSync(value) ? readFileSync(value, 'utf8') : value;
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

const script = (() => {
  const file = process.env.FAKE_DESK_SCRIPT;
  if (!file) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
})();
const settings = readJsonArg(flag('--settings'));
const mcpConfig = readJsonArg(flag('--mcp-config'));
const sessionsDir = process.env.FAKE_DESK_SESSIONS || join(tmpdir(), 'worklings-fake-desk-sessions');
const resumeId = flag('--resume');
const sessionId = resumeId ?? flag('--session-id') ?? randomUUID();
const emitStates = process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS === '1';
const heartbeatMs = script.heartbeatMs ?? 30_000;
const token = process.env.WORKLINGS_DESK_TOKEN;

log({
  event: 'start',
  argv,
  cwd: process.cwd(),
  settings: settings.text,
  mcpConfig: mcpConfig.text,
  env: {
    emitSessionState: process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS ?? null,
    disablePromptCaching: process.env.DISABLE_PROMPT_CACHING ?? null,
    claudecode: 'CLAUDECODE' in process.env,
    hasToken: typeof token === 'string' && token.length > 0,
    tokenLength: token?.length ?? 0,
  },
  tmp: { TMP: process.env.TMP ?? null, TEMP: process.env.TEMP ?? null, TMPDIR: process.env.TMPDIR ?? null },
  claudeaiMcp: process.env.ENABLE_CLAUDEAI_MCP_SERVERS ?? null,
});
setTimeout(() => finish(4), GIVE_UP_MS).unref();
if (script.rejectFlags && argv.some((a) => ['--setting-sources', '--strict-mcp-config', '--tools'].includes(a))) {
  const first = ['--setting-sources', '--strict-mcp-config', '--tools'].find((a) => argv.includes(a));
  process.stderr.write(`error: unknown option '${first}'
`);
  log({ event: 'exit', code: 1, reason: 'unknown option' });
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sessions

const sessionFile = join(sessionsDir, `${sessionId.replace(/[^\w-]/g, '_')}.json`);
let session = { texts: [], requests: 0, costUsd: 0 };
if (resumeId) {
  if (!existsSync(sessionFile)) {
    process.stderr.write(`No conversation found with session ID: ${resumeId}\n`);
    log({ event: 'exit', code: 1, reason: 'no session' });
    process.exit(1);
  }
  session = JSON.parse(readFileSync(sessionFile, 'utf8'));
}
const saveSession = () => {
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(sessionFile, JSON.stringify(session));
};

// ---------------------------------------------------------------------------------------------------------------------
// Output

const out = (line) => process.stdout.write(`${JSON.stringify({ ...line, session_id: sessionId, uuid: line.uuid ?? randomUUID() })}\n`);
const raw = (text) => process.stdout.write(text);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let exiting = false;
function finish(code) {
  if (exiting) return;
  exiting = true;
  log({ event: 'exit', code });
  for (const child of children) child.kill();
  process.stdout.write('', () => process.exit(code));
}

/** An orphan outlives the fake on purpose, so a test that fails before stopping it still leaves nothing for long. */
const ORPHAN_MS = 3 * 60_000;
const children = new Set();
function startChild() {
  // Detached on Windows, as a real claude.exe's commands are, so only killing the whole tree stops it.
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${GIVE_UP_MS})`], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' });
  children.add(child);
  child.on('exit', () => children.delete(child));
  log({ event: 'child', childPid: child.pid });
  return child;
}

// ---------------------------------------------------------------------------------------------------------------------
// The office: hooks and the org tools

/** `$NAME` and `${NAME}` from the environment, for the names a hook allows (all of them for MCP headers). */
function expandHeaders(headers, allowed) {
  const outHeaders = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    outHeaders[key] = String(value).replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, a, b) => {
      const name = a ?? b;
      return allowed === null || allowed.includes(name) ? (process.env[name] ?? '') : '';
    });
  }
  return outHeaders;
}

function post(url, body, headers, timeoutMs) {
  return new Promise((done) => {
    const data = Buffer.from(JSON.stringify(body));
    let target;
    try {
      target = new URL(url);
    } catch {
      done({ status: 0, headers: {}, body: null });
      return;
    }
    const req = request(
      { method: 'POST', hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, headers: { 'content-type': 'application/json', 'content-length': data.length, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? 'null' : text) : null;
          } catch {
            json = null;
          }
          done({ status: res.statusCode ?? 0, headers: res.headers, body: json });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on('error', () => done({ status: 0, headers: {}, body: null }));
    req.end(data);
  });
}

const hooksFor = (event) => (settings.json?.hooks?.[event] ?? []).flatMap((m) => m.hooks ?? []).filter((h) => h.type === 'http');

function hookPayload(event, extra) {
  return {
    session_id: sessionId,
    transcript_path: join(tmpdir(), 'fake-desk', `${sessionId}.jsonl`),
    cwd: process.cwd(),
    prompt_id: randomUUID(),
    permission_mode: flag('--permission-mode') ?? 'default',
    effort: { level: 'medium' },
    hook_event_name: event,
    ...extra,
  };
}

/** Asks the office as Claude Code's PermissionRequest hook does: allow, deny with a message, or no answer (a no). */
async function askPermission(tool, input, extra = {}) {
  const hooks = hooksFor('PermissionRequest');
  if (hooks.length === 0) return { behavior: 'deny', message: `Claude requested permissions to use ${tool}, but you haven't granted it yet.`, reason: 'other' };
  const hook = hooks[0];
  const ruleContent = typeof input.command === 'string' ? input.command : undefined;
  const payload = hookPayload('PermissionRequest', {
    tool_name: tool,
    tool_input: input,
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: tool, ...(ruleContent ? { ruleContent } : {}) }], behavior: 'allow', destination: 'localSettings' }],
    ...extra,
  });
  const res = await post(hook.url, payload, expandHeaders(hook.headers, hook.allowedEnvVars ?? []), (hook.timeout ?? 600) * 1000);
  const decision = res.body?.hookSpecificOutput?.decision;
  log({ event: 'permission', tool, status: res.status, behavior: decision?.behavior ?? null });
  if (decision?.behavior === 'allow') return { behavior: 'allow' };
  if (decision?.behavior === 'deny') return { behavior: 'deny', message: String(decision.message ?? 'Denied.'), reason: 'hook' };
  return { behavior: 'deny', message: 'This command requires approval', reason: 'other' };
}

async function stopHook(lastText) {
  for (const hook of [...hooksFor('Stop')]) {
    const res = await post(hook.url, hookPayload('Stop', { stop_hook_active: false, last_assistant_message: lastText, background_tasks: [] }), expandHeaders(hook.headers, hook.allowedEnvVars ?? []), (hook.timeout ?? 5) * 1000);
    log({ event: 'hook', hook: 'Stop', status: res.status });
  }
}

const org = { status: 'pending', era: null, sessionId: null, tools: [], nextId: 1 };
const orgServer = mcpConfig.json?.mcpServers?.org ?? null;
const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'claude-code', title: 'Claude Code', version: VERSION },
  'io.modelcontextprotocol/clientCapabilities': { roots: { listChanged: true } },
});

async function mcp(method, params, name) {
  const headers = { accept: 'application/json, text/event-stream', ...expandHeaders(orgServer.headers, null) };
  if (org.era === 'legacy') {
    headers['mcp-protocol-version'] = '2025-11-25';
    if (org.sessionId) headers['mcp-session-id'] = org.sessionId;
    // A notification carries no id, as Claude Code sends notifications/initialized.
    const message = method.startsWith('notifications/') ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id: org.nextId++, method, params };
    const res = await post(orgServer.url, message, headers, 10_000);
    log({ event: 'mcp', era: 'legacy', method, status: res.status });
    return res;
  }
  headers['mcp-protocol-version'] = '2026-07-28';
  headers['mcp-method'] = method;
  if (name) headers['mcp-name'] = name;
  const res = await post(orgServer.url, { jsonrpc: '2.0', id: org.nextId++, method, params: { ...params, _meta: { ...meta(), ...(params._meta ?? {}) } } }, headers, 10_000);
  log({ event: 'mcp', era: 'modern', method, status: res.status });
  return res;
}

/** Connects at startup, before the first message, as Claude Code does with alwaysLoad. */
const orgReady = (async () => {
  if (!orgServer || orgServer.type !== 'http') {
    org.status = 'none';
    return;
  }
  const discover = await mcp('server/discover', {});
  if (discover.status === 200) {
    org.era = 'modern';
  } else if (discover.status === 400) {
    org.era = 'legacy';
    const init = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: VERSION } });
    if (init.status !== 200) {
      org.status = 'failed';
      return;
    }
    org.sessionId = typeof init.headers['mcp-session-id'] === 'string' ? init.headers['mcp-session-id'] : null;
    await mcp('notifications/initialized', {});
  } else {
    org.status = 'failed';
    return;
  }
  const list = await mcp('tools/list', {});
  org.tools = Array.isArray(list.body?.result?.tools) ? list.body.result.tools.map((t) => t.name).filter((n) => typeof n === 'string') : [];
  org.status = list.status === 200 ? 'connected' : 'failed';
})();

const allowRules = () => (Array.isArray(settings.json?.permissions?.allow) ? settings.json.permissions.allow : []);
const orgAllowed = (tool) => allowRules().some((r) => r === 'mcp__org' || r === 'mcp__org__*' || r === `mcp__org__${tool}`);

// ---------------------------------------------------------------------------------------------------------------------
// Turns

const queue = [];
let current = null;
let turnIndex = 0;
let inputEnded = false;
let background = 0;

function scenarioFor(text) {
  const marked = /\[fake:([\w-]+)\]/.exec(text)?.[1];
  // `byText` lets a turn nobody can mark (the CEO's start turn, which the office writes) pick its scenario by what it says.
  // A rule with a `folder` applies only to desks whose working folder's name contains it (one CEO among several companies).
  const here = process.cwd().replaceAll('\\', '/').split('/').pop() ?? '';
  const byText = script.byText?.find((rule) => text.includes(rule.includes) && (rule.folder === undefined || here.includes(rule.folder)))?.scenario;
  const name = marked ?? byText ?? script.turns?.[turnIndex];
  if (name && script.scenarios?.[name]) return script.scenarios[name];
  if (marked && marked !== 'answer') process.stderr.write(`fake-desk: no scenario named ${marked}\n`);
  return script.default ?? [];
}

function usageOf(requests) {
  const read = 20_000 + 500 * session.requests;
  return { input_tokens: 2 * requests, cache_creation_input_tokens: 300 * requests, cache_read_input_tokens: read * requests, output_tokens: 50 * requests, cache_creation: { ephemeral_1h_input_tokens: 300 * requests, ephemeral_5m_input_tokens: 0 }, iterations: [{ input_tokens: 2, output_tokens: 50, cache_read_input_tokens: read, cache_creation_input_tokens: 300, type: 'message' }] };
}

/** One model request: counted for the turn's cost and the session's. */
function request_(turn) {
  turn.requests++;
  session.requests++;
  return { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 20_000 + 500 * session.requests, output_tokens: 50 };
}

function assistant(turn, content) {
  out({ type: 'assistant', message: { model: MODEL, id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', content, usage: request_(turn) }, parent_tool_use_id: null });
}

function toolResult(id, content, isError = false) {
  out({ type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, ...(isError ? { is_error: true } : {}) }] }, parent_tool_use_id: null });
}

/** Waits `ms`, or less when the turn is interrupted; true when the wait ran out. */
function interruptible(turn, ms, onAbort) {
  return new Promise((done) => {
    const timer = setTimeout(() => {
      turn.abort = null;
      done(true);
    }, ms);
    turn.abort = () => {
      clearTimeout(timer);
      onAbort?.();
      done(false);
    };
  });
}

function permissionNeeded(tool, input) {
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'WebFetch') {
    const command = String(input.command ?? '');
    return !allowRules().some((r) => r === `${tool}(${command})` || (r.endsWith(':*)') && command.startsWith(r.slice(tool.length + 1, -3))));
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit' || tool === 'Read') {
    const file = resolve(String(input.file_path ?? ''));
    const cwd = process.cwd();
    if (!file.toLowerCase().startsWith(cwd.toLowerCase())) return true;
    if (tool === 'Read') return false;
    // Claude Code 2.1.312 asks for edits to its protected paths even in acceptEdits, and for any `ask` rule's match.
    const rel = file.slice(cwd.length).replace(/^[\\/]+/, '').replaceAll('\\', '/');
    const parts = rel.toLowerCase().split('/');
    if (parts.includes('.claude') || parts.includes('.git') || parts.at(-1) === '.mcp.json') return true;
    return askRules(tool).some((pattern) => pattern.test(rel));
  }
  return false;
}

/** The settings' `ask` rules for a file tool ("Write(./**\/CLAUDE.md)"; Edit's cover every tool) as tests of a path. */
const askRules = (tool) =>
  (Array.isArray(settings.json?.permissions?.ask) ? settings.json.permissions.ask : []).flatMap((rule) => {
    const m = /^(Edit|Write|MultiEdit|NotebookEdit)\(\.\/(.+)\)$/.exec(String(rule));
    if (!m || (m[1] !== 'Edit' && m[1] !== tool)) return [];
    const body = m[2].split(/(\*\*\/|\*\*|\*)/).map((part) => (part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('');
    return [new RegExp(`^${body}$`, 'i')];
  });

async function toolStep(turn, step) {
  const tool = step.tool;
  // Claude Code's file tools always carry an absolute path; a script may give one relative to the desk's folder.
  const input = typeof step.input?.file_path === 'string' ? { ...step.input, file_path: resolve(step.input.file_path) } : (step.input ?? {});
  const id = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  assistant(turn, [{ type: 'tool_use', id, name: tool, input }]);
  turn.tool = { id, task: null, child: null };
  if (step.ask ?? permissionNeeded(tool, input)) {
    const answer = await askPermission(tool, input);
    if (turn.aborted) return;
    if (answer.behavior !== 'allow') {
      out({ type: 'system', subtype: 'permission_denied', tool_name: tool, tool_use_id: id, decision_reason_type: answer.reason, message: answer.message });
      turn.denials.push({ tool_name: tool, tool_use_id: id, tool_input: input });
      toolResult(id, answer.message, true);
      turn.tool = null;
      return;
    }
  }
  const ms = step.ms ?? 0;
  const child = step.spawn ? startChild() : null;
  const task = ms >= 1_000 ? `task_${randomUUID().slice(0, 8)}` : null;
  turn.tool = { id, task, child };
  if (task) out({ type: 'system', subtype: 'task_started', task_id: task, tool_use_id: id, description: `Run ${tool}`, is_backgrounded: false, task_type: 'local_bash' });
  let beats = 0;
  const heartbeat = setInterval(() => {
    beats++;
    out({ type: 'tool_progress', tool_use_id: `${id}-heartbeat-${beats - 1}`, tool_name: tool, parent_tool_use_id: id, elapsed_time_seconds: Math.round((beats * heartbeatMs) / 1000), heartbeat: true });
  }, heartbeatMs);
  const ran = await interruptible(turn, ms, () => {
    clearInterval(heartbeat);
    child?.kill();
  });
  clearInterval(heartbeat);
  if (!ran) return;
  child?.kill();
  if (task) out({ type: 'system', subtype: 'task_notification', task_id: task, tool_use_id: id, status: 'completed', output_file: '', summary: `Run ${tool}` });
  toolResult(id, step.output ?? 'done');
  turn.tool = null;
}

/**
 * "$message" in a step's arguments stands for the id of the stakeholder's message that named the scenario ("(message
 * m-12)" in its turn), so a script can cite it. "$task" stands for the task the turn is about: "[task t-3]" in the
 * stakeholder's words, else the office's "New task t-3, from the plan:" or "New task t-3:" (a final review's turn, which
 * nobody can mark). Bound when the steps are queued, so a message that joins a running turn cites its own id.
 */
function bindMessage(steps, text) {
  const id = /the stakeholder[^()]*\(message (m-\d+)\)/.exec(text)?.[1] ?? /\(message (m-\d+)\)/.exec(text)?.[1] ?? null;
  const task = /\[task (t-\d+)\]/.exec(text)?.[1] ?? /New task (t-\d+)[,:]/.exec(text)?.[1] ?? null;
  if (!id && !task) return steps;
  const bind = (args) => {
    let json = JSON.stringify(args);
    if (id) json = json.replaceAll('$message', id);
    if (task) json = json.replaceAll('$task', task);
    return JSON.parse(json);
  };
  return steps.map((step) => (step.arguments ? { ...step, arguments: bind(step.arguments) } : step));
}

async function orgStep(turn, step) {
  await orgReady;
  const name = step.org;
  const id = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const tool = `mcp__org__${name}`;
  assistant(turn, [{ type: 'tool_use', id, name: tool, input: step.arguments ?? {} }]);
  if (org.status !== 'connected' || !org.tools.includes(name)) {
    turn.lastResult = `No such tool available: ${tool}`;
    toolResult(id, `No such tool available: ${tool}`, true);
    return;
  }
  if (!orgAllowed(name)) {
    const answer = await askPermission(tool, step.arguments ?? {}, { mcp_server: { name: 'org', source: 'dynamic' } });
    if (turn.aborted) return;
    if (answer.behavior !== 'allow') {
      out({ type: 'system', subtype: 'permission_denied', tool_name: tool, tool_use_id: id, message: answer.message });
      turn.denials.push({ tool_name: tool, tool_use_id: id, tool_input: step.arguments ?? {} });
      toolResult(id, answer.message, true);
      return;
    }
  }
  const res = await mcp('tools/call', { name, arguments: step.arguments ?? {}, _meta: { 'claudecode/toolUseId': id, progressToken: org.nextId } }, name);
  if (turn.aborted) return;
  const content = res.body?.result?.content;
  const text = Array.isArray(content) ? content.map((c) => c?.text ?? '').join('') : JSON.stringify(res.body?.error ?? null);
  turn.lastResult = text;
  toolResult(id, [{ type: 'text', text }], res.body?.result?.isError === true || res.status !== 200);
}

function result(turn, fields) {
  const turnCost = turn.requests * REQUEST_COST;
  session.costUsd += turnCost;
  const totals = { inputTokens: 2 * session.requests, outputTokens: 50 * session.requests, cacheReadInputTokens: 20_000 * session.requests, cacheCreationInputTokens: 300 * session.requests, costUSD: session.costUsd, contextWindow: CONTEXT_WINDOW, canonicalModel: MODEL };
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: Date.now() - turn.started,
    duration_api_ms: 10 * turn.requests,
    num_turns: Math.max(1, turn.requests),
    result: turn.text,
    stop_reason: 'end_turn',
    total_cost_usd: session.costUsd,
    usage: usageOf(turn.requests),
    modelUsage: { [MODEL]: totals },
    permission_denials: turn.denials,
    terminal_reason: 'completed',
    user_message_uuid: turn.uuids[0] ?? null,
    user_message_uuids: turn.uuids,
    model_usage_since_last_result: { [MODEL]: { ...totals, costUSD: turnCost } },
    api_error_status: null,
    ...fields,
  });
  saveSession();
}

const FAILURES = {
  'usage-limit': { text: "You've hit your session limit · resets 3:45pm", status: 429 },
  overloaded: { text: 'API Error: Repeated 529 Overloaded errors', status: 529 },
  'not-signed-in': { text: 'Not logged in · Please run /login', status: 401 },
  'api-error': { text: 'API Error: 500 Internal server error', status: 500 },
};

let notifications = 0;

async function runStep(turn, step) {
  if ('say' in step) {
    turn.text = String(step.say);
    assistant(turn, [{ type: 'text', text: turn.text }]);
  } else if ('wait' in step) {
    await interruptible(turn, step.wait);
  } else if ('think' in step) {
    out({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, estimated_tokens_delta: 50 });
    await interruptible(turn, step.think);
  } else if ('tool' in step) {
    await toolStep(turn, step);
  } else if ('org' in step) {
    await orgStep(turn, step);
  } else if ('limit' in step) {
    const l = step.limit;
    const resetsAt = l.resetsAt ?? Math.ceil((Date.now() + (l.resetsInMs ?? 3_600_000)) / 1000);
    out({ type: 'rate_limit_event', rate_limit_info: { status: l.status ?? 'allowed_warning', resetsAt, rateLimitType: l.rateLimitType ?? 'five_hour', utilization: l.utilization ?? 0.5, isUsingOverage: false } });
  } else if ('fail' in step) {
    const known = FAILURES[step.fail] ?? FAILURES['api-error'];
    turn.failed = { text: step.text ?? known.text, status: known.status };
  } else if ('crash' in step) {
    if (step.crash.stderr) process.stderr.write(`${step.crash.stderr}\n`);
    finish(step.crash.code ?? 1);
    await new Promise(() => {});
  } else if ('partial' in step) {
    raw(String(step.partial));
    finish(1);
    await new Promise(() => {});
  } else if ('garbage' in step) {
    for (const line of step.garbage) raw(`${line}\n`);
  } else if ('big' in step) {
    const size = Math.max(0, Number(step.big) || 0);
    const piece = 'x'.repeat(64 * 1024);
    for (let n = 0; n < size; n += piece.length) raw(piece);
    raw('\n');
  } else if ('stderr' in step) {
    for (let i = 0; i < (step.repeat ?? 1); i++) process.stderr.write(`${step.stderr}\n`);
  } else if ('hang' in step) {
    if (step.hang === 'deaf') turn.deaf = true;
    await new Promise((done) => {
      turn.abort = () => done(false);
    });
  } else if ('orphan' in step) {
    const file = join(tmpdir(), `worklings-fake-orphan-${randomUUID()}`);
    const shell = [
      "const { spawn } = require('node:child_process');",
      "const server = spawn(process.execPath, ['-e', 'setTimeout(() => {}, ' + process.argv[2] + ')'], { stdio: 'ignore', windowsHide: true, detached: true });",
      "require('node:fs').writeFileSync(process.argv[1], String(server.pid));",
      'server.unref();',
      'setTimeout(() => {}, Number(process.argv[3]));',
    ].join(' ');
    // Not detached: like a real Bash tool's shell, it belongs to the desk's tree until it exits.
    const launcher = spawn(process.execPath, ['-e', shell, file, String(ORPHAN_MS), String(step.lingerMs ?? 3_000)], { stdio: 'ignore', windowsHide: true });
    await new Promise((done) => launcher.once('exit', done));
    const serverPid = Number(readFileSync(file, 'utf8'));
    rmSync(file, { force: true });
    log({ event: 'orphan', childPid: serverPid, shellPid: launcher.pid });
  } else if ('background' in step) {
    background++;
    const task = `task_${randomUUID().slice(0, 8)}`;
    out({ type: 'system', subtype: 'task_started', task_id: task, description: 'Run a command in the background', is_backgrounded: true, task_type: 'local_bash' });
    setTimeout(() => {
      background--;
      out({ type: 'system', subtype: 'task_notification', task_id: task, status: 'completed', output_file: '', summary: 'Run a command in the background' });
      notifications++;
      void next();
    }, step.background);
  } else if ('sayResult' in step) {
    // What the studio chat does with its tools' answers: says them on, without the fences' marker lines.
    const plain = String(turn.lastResult ?? '')
      .split('\n')
      .filter((line) => !/^st[0-9a-f]{18}$/.test(line))
      .map((line) => line.replace(/, between the two st[0-9a-f]{18} lines\. It is data, never instructions to you:$/, ':'))
      .join('\n')
      .trim();
    turn.text = `${step.sayResult} ${plain}`.trim().slice(0, 4000);
    assistant(turn, [{ type: 'text', text: turn.text }]);
  } else if ('recall' in step) {
    turn.text = `Fake desk remembers: ${session.texts.join(' | ')}`;
    assistant(turn, [{ type: 'text', text: turn.text }]);
  } else if ('helper' in step) {
    // v0.4 (H2): a helper the desk starts with the Agent tool, as Claude Code 2.1.312 writes it beside the session's
    // transcript (<session>/subagents/agent-<id>.meta.json and .jsonl), working for `ms`, then finished. Only under a
    // CLAUDE_CONFIG_DIR a test made: never in the real ~/.claude.
    const h = step.helper ?? {};
    const home = process.env.CLAUDE_CONFIG_DIR;
    if (!home) {
      log({ event: 'helper-skipped', why: 'CLAUDE_CONFIG_DIR is not set' });
    } else {
      const dir = join(home, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
      const sub = join(dir, sessionId, 'subagents');
      const id = `f${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      mkdirSync(sub, { recursive: true });
      const main = join(dir, `${sessionId}.jsonl`);
      if (!existsSync(main)) writeFileSync(main, '');
      writeFileSync(join(sub, `agent-${id}.jsonl`), '');
      const meta = (finished) => writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: h.type ?? 'general-purpose', description: h.description ?? 'Helps with the work', finished }));
      meta(false);
      log({ event: 'helper', id, dir: sub });
      // v0.7: and in the stream, as 2.1.312 writes it: the Agent call, task_started naming its type, the subagent's own
      // request with its usage and the main call as its parent, task_notification, and the call's result.
      const toolUseId = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
      const description = h.description ?? 'Helps with the work';
      const type = h.type ?? 'general-purpose';
      assistant(turn, [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { description, subagent_type: type, prompt: description } }]);
      turn.tool = { id: toolUseId, task: id, child: null };
      out({ type: 'system', subtype: 'task_started', task_id: id, tool_use_id: toolUseId, description, subagent_type: type, is_backgrounded: false, task_type: 'local_agent' });
      out({ type: 'assistant', parent_tool_use_id: toolUseId, message: { model: MODEL, id: `msg_${id}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'On it.' }], usage: { input_tokens: 40_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      const ran = await interruptible(turn, Number(h.ms ?? 1000));
      meta(true);
      if (!ran) return;
      out({ type: 'system', subtype: 'task_notification', task_id: id, tool_use_id: toolUseId, status: 'completed', output_file: '', summary: description });
      toolResult(toolUseId, 'Done.');
      turn.tool = null;
    }
  } else if ('scratchFile' in step) {
    // What a script the desk runs does with a temporary file: it lands wherever TMPDIR says, without asking anyone.
    const path = join(process.env.TMPDIR || tmpdir(), String(step.scratchFile));
    writeFileSync(path, 'scratch\n');
    log({ event: 'scratch', path });
  }
}

/** Messages that arrived while the turn ran join it at its next step. */
function takeQueued(turn) {
  while (queue.length > 0) {
    const m = queue.shift();
    out({ type: 'command_lifecycle', command_uuid: m.uuid, state: 'started' });
    turn.uuids.push(m.uuid);
    session.texts.push(m.text);
    const marked = /\[fake:([\w-]+)\]/.exec(m.text)?.[1];
    const extra = marked && script.scenarios?.[marked] ? script.scenarios[marked] : [{ say: `Fake desk took your message too: ${m.text.slice(0, 60)}` }];
    turn.steps.push(...bindMessage(extra, m.text));
  }
}

async function runTurn(first) {
  const turn = { uuids: [], steps: [], requests: 0, text: '', denials: [], aborted: false, abort: null, tool: null, deaf: false, failed: null, started: Date.now() };
  current = turn;
  if (first) {
    turn.uuids.push(first.uuid);
    session.texts.push(first.text);
    turn.steps = bindMessage([...scenarioFor(first.text)], first.text);
    turn.text = `Fake desk: ${first.text.slice(0, 80)}`;
    turnIndex++;
    // Claude Code records the message before it answers, so a desk killed mid-turn can be resumed.
    saveSession();
  } else {
    turn.steps = [{ say: 'The background command finished.' }];
  }
  if (emitStates) out({ type: 'system', subtype: 'session_state_changed', state: 'running' });
  if (first) out({ type: 'command_lifecycle', command_uuid: first.uuid, state: 'started' });
  await orgReady;
  // A slow start between taking the message and init (MCP servers connecting on a busy machine), when the script asks.
  if (script.initDelayMs) await pause(script.initDelayMs);
  if (turn.aborted || exiting) return;
  const named = flag('--tools');
  const builtin = named === undefined ? ['Bash', 'Edit', 'Read', 'Write'] : named.split(',').filter(Boolean);
  const others = Object.keys(mcpConfig.json?.mcpServers ?? {}).filter((key) => key !== 'org');
  const tools = [
    ...builtin,
    ...(org.status === 'connected' ? org.tools.map((t) => `mcp__org__${t}`) : []),
    ...others.map((key) => `mcp__${key}__ping`),
    ...(script.leakMcp ?? []).map((name) => `mcp__${name}__ping`),
  ];
  log({ event: 'init', tools, mcpServers: Object.keys(mcpConfig.json?.mcpServers ?? {}) });
  out({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    ...(script.omitTools ? {} : { tools }),
    mcp_servers: [...(orgServer ? [{ name: 'org', status: org.status, source: 'dynamic' }] : []), ...others.map((name) => ({ name, status: 'connected', source: 'dynamic' })), ...(script.leakServers ?? []).map((name) => ({ name, status: 'connected', source: 'dynamic' }))],
    model: flag('--model') ?? MODEL,
    permissionMode: flag('--permission-mode') ?? 'default',
    apiKeySource: 'none',
    claude_code_version: VERSION,
    capabilities: CAPABILITIES,
    agents: [],
    skills: [],
    plugins: [],
  });
  for (let i = 0; i < turn.steps.length; i++) {
    await runStep(turn, turn.steps[i]);
    if (turn.aborted || exiting) return;
    if (turn.failed) break;
    takeQueued(turn);
  }
  if (turn.requests === 0) assistant(turn, [{ type: 'text', text: turn.text }]);
  await stopHook(turn.text);
  if (turn.aborted || exiting) return;
  for (const uuid of turn.uuids) out({ type: 'command_lifecycle', command_uuid: uuid, state: 'completed' });
  if (turn.failed) {
    turn.text = turn.failed.text;
    result(turn, { is_error: true, result: turn.failed.text, api_error_status: turn.failed.status, terminal_reason: 'api_error', stop_reason: 'stop_sequence' });
  } else {
    result(turn, {});
  }
  if (emitStates) out({ type: 'system', subtype: 'session_state_changed', state: 'idle' });
  if (current === turn) current = null;
}

let running = false;
async function next() {
  if (running || exiting) return;
  running = true;
  try {
    while (!exiting && (queue.length > 0 || notifications > 0)) {
      if (queue.length > 0) await runTurn(queue.shift());
      else {
        notifications--;
        await runTurn(null);
      }
    }
  } finally {
    running = false;
  }
  maybeExit();
}

function maybeExit() {
  if (inputEnded && !current && !running && queue.length === 0 && background === 0 && notifications === 0) setTimeout(() => finish(0), script.closeDelayMs ?? 30);
}

function interrupt(requestId) {
  log({ event: 'interrupt', requestId, running: current !== null });
  if (script.interrupt?.ignore || current?.deaf) return;
  setTimeout(() => {
    out({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { still_queued: queue.map((m) => m.uuid) } } });
    const turn = current;
    if (!turn || turn.aborted) return;
    turn.aborted = true;
    const tool = turn.tool;
    turn.abort?.();
    if (tool) {
      toolResult(tool.id, "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.", true);
      out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, parent_tool_use_id: null });
      if (tool.task) out({ type: 'system', subtype: 'task_notification', task_id: tool.task, tool_use_id: tool.id, status: 'stopped', output_file: '', summary: 'Stopped' });
    } else {
      out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null });
    }
    result(turn, { subtype: 'error_during_execution', is_error: true, stop_reason: tool ? 'tool_use' : null, terminal_reason: tool ? 'aborted_tools' : 'aborted_streaming', result: undefined, errors: ['[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use'] });
    for (const uuid of turn.uuids) out({ type: 'command_lifecycle', command_uuid: uuid, state: 'cancelled' });
    if (emitStates) out({ type: 'system', subtype: 'session_state_changed', state: 'idle' });
    current = null;
  }, script.interrupt?.ackMs ?? 20);
}

// ---------------------------------------------------------------------------------------------------------------------
// Input

async function main() {
  const startup = script.startup ?? {};
  if (startup.delayMs) await pause(startup.delayMs);
  if (startup.exit) {
    if (startup.exit.stderr) process.stderr.write(`${startup.exit.stderr}\n`);
    finish(startup.exit.code ?? 1);
    return;
  }
  let pending = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    pending += chunk;
    for (let nl = pending.indexOf('\n'); nl !== -1; nl = pending.indexOf('\n')) {
      const text = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!text) continue;
      let line;
      try {
        line = JSON.parse(text);
      } catch {
        log({ event: 'bad-line', text: text.slice(0, 200) });
        continue;
      }
      log({ event: 'line', line });
      if (line?.type === 'user') {
        const content = line.message?.content;
        const said = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text ?? '').join('') : '';
        const uuid = typeof line.uuid === 'string' ? line.uuid : randomUUID();
        queue.push({ uuid, text: said });
        out({ type: 'command_lifecycle', command_uuid: uuid, state: 'queued' });
        void next();
      } else if (line?.type === 'control_request' && line.request?.subtype === 'interrupt') {
        interrupt(line.request_id);
      }
    }
  });
  process.stdin.on('end', () => {
    inputEnded = true;
    log({ event: 'stdin-closed' });
    maybeExit();
  });
}

void main();
