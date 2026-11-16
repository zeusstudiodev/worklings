// The stream-json protocol of a desk (`claude -p --input-format stream-json --output-format stream-json --verbose`) as
// Claude Code 2.1.312 speaks it: the lines the switchboard writes, and what it reads from the lines a desk writes. What
// the real program sends is pinned in test/fixtures/claude-2.1.312/desk/ and described in docs/claude-code-surfaces.md
// ("Stream-json desks"). Every line from a desk is untrusted: parsed defensively, capped, and a malformed one is
// skipped without stopping the rest. No Node APIs, so the tests can feed it the fixtures directly.
import { type WorkSignal, workSignals } from '../core/desk-work.ts';
import { safeId } from '../core/events.ts';
import { costOf } from '../core/pricing.ts';
import { usageFromApi } from '../core/usage.ts';

/** The longest line kept from a desk, in UTF-16 units. Tool results that inline a big file or an image come close. */
export const LINE_LIMIT = 8 * 1024 * 1024;
/** How much of a turn's final text is kept before it is masked and cut again for the company. */
const TEXT_LIMIT = 64 * 1024;
/** How much of Claude Code's own words about a failure is kept for the sentence the office shows. */
const ERROR_TEXT_LIMIT = 4_000;
/** The most uuids one result may list. */
const UUID_LIMIT = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const amount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// ---------------------------------------------------------------------------------------------------------------------
// What the switchboard writes

/** One user turn: `uuid` is the switchboard's and comes back in command_lifecycle and the turn's result. */
export function userLine(text: string, sessionId: string, uuid: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: sessionId, uuid })}\n`;
}

/** Stops the running turn; answered by a control_response with the same request_id (0.3 to 2.1 s on 2.1.312). */
export function interruptLine(requestId: string): string {
  return `${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })}\n`;
}

/** The answer to a control_request the desk sent the switchboard. */
export function controlAnswer(requestId: string, response: Obj): string {
  return `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`;
}

/** A refusal of a control_request the switchboard doesn't serve, so the desk doesn't wait for an answer. */
export function controlRefusal(requestId: string, error: string): string {
  return `${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } })}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// What a desk writes

export type LifecycleState = 'queued' | 'started' | 'completed' | 'cancelled';
const LIFECYCLE: ReadonlySet<string> = new Set(['queued', 'started', 'completed', 'cancelled']);

/** A turn's end, from its `result` line. */
export interface TurnEnd {
  sessionId: string | null;
  ok: boolean;
  subtype: string | null;
  terminalReason: string | null;
  /** The turn's final text, capped; the switchboard masks it before it leaves. */
  text: string;
  /** What this turn cost: model_usage_since_last_result, never the session's running totals; null when unknown. */
  costUsd: number | null;
  /** This turn's tokens, summed over its requests. */
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** The size of the turn's last prompt. */
  contextTokens: number | null;
  /** The model's context window, when the result says. */
  contextWindow: number | null;
  durationMs: number | null;
  /** The user lines the turn took, by the uuids the switchboard gave them. */
  uuids: string[];
  /** Claude Code's own words about a failure (the result text and its errors), capped; empty for a success. */
  errorText: string;
  apiStatus: number | null;
}

/** A rate_limit_event's rate_limit_info. `resetsAt` is in milliseconds (the line gives seconds). */
export interface LimitInfo {
  status: string;
  resetsAt: number | null;
  utilization: number | null;
  /** five_hour, seven_day and the like. */
  type: string | null;
}

export type DeskEvent =
  /** At the start of every turn, not only the first. */
  | {
      kind: 'init';
      sessionId: string | null;
      model: string | null;
      apiKeySource: string | null;
      /** The tool names the desk has, capped; null when the line names none (an older Claude Code). */
      tools: string[] | null;
      /** The MCP servers it connected to or tried, with their status. */
      mcpServers: { name: string; status: string }[];
    }
  | { kind: 'lifecycle'; uuid: string; state: LifecycleState }
  /** session_state_changed: running or idle. */
  | { kind: 'state'; state: string }
  /** An assistant or user line of the main conversation: the tool calls it opened and closed, and its prompt size. */
  | { kind: 'turn-line'; opened: string[]; closed: string[]; contextTokens: number | null; work?: WorkSignal[] }
  /** Work going on that says nothing else: tool_progress heartbeats, tasks, a subagent's lines, the person's own hooks. */
  | { kind: 'progress'; work?: WorkSignal[] }
  | { kind: 'limit'; info: LimitInfo }
  /** Claude Code retrying a request itself (system/api_retry). */
  | { kind: 'retry'; error: string | null; delayMs: number | null }
  /** The answer to a control_request the switchboard sent. */
  | { kind: 'ack'; requestId: string; ok: boolean }
  /** A control_request the desk sends the switchboard (can_use_tool would be one). */
  | { kind: 'request'; requestId: string; subtype: string | null; tool?: string; input?: Record<string, unknown> }
  | { kind: 'result'; end: TurnEnd }
  /** A line of a type this version doesn't need: it still shows the desk is alive. */
  | { kind: 'other'; type: string | null }
  | { kind: 'malformed'; reason: 'not-json' | 'not-an-object' | 'too-long' };

/** Splits a desk's output into lines, never holding more than `max` units: an oversized line becomes null. */
export class LineSplitter {
  private readonly max: number;
  private pending = '';
  private skipping = false;

  constructor(max = LINE_LIMIT) {
    this.max = max;
  }

  /** The complete lines in `chunk`, in order; null stands for a line that was too long and was dropped. */
  push(chunk: string): (string | null)[] {
    const out: (string | null)[] = [];
    let start = 0;
    for (let nl = chunk.indexOf('\n'); nl !== -1; nl = chunk.indexOf('\n', start)) {
      const piece = chunk.slice(start, nl);
      start = nl + 1;
      if (this.skipping || this.pending.length + piece.length > this.max) {
        this.skipping = false;
        this.pending = '';
        out.push(null);
        continue;
      }
      const line = (this.pending + piece).replace(/\r$/, '');
      this.pending = '';
      if (line.trim() !== '') out.push(line);
    }
    const rest = chunk.slice(start);
    if (this.skipping) return out;
    if (this.pending.length + rest.length > this.max) {
      this.pending = '';
      this.skipping = true;
    } else {
      this.pending += rest;
    }
    return out;
  }

  /** What is left when the stream ends: a line cut off without its newline, or null. */
  end(): string | null {
    const rest = this.skipping ? '' : this.pending.trim();
    this.pending = '';
    this.skipping = false;
    return rest === '' ? null : rest;
  }
}

/**
 * Reads one line from a desk. Never throws. v0.7: a line that says something about the desk's own todo list or its
 * subagents carries that as `work` (src/core/desk-work.ts).
 */
export function parseLine(text: string | null): DeskEvent {
  const e = readLine(text);
  if ((e.kind === 'turn-line' || e.kind === 'progress') && text !== null && WORK_HINT.test(text)) {
    try {
      const work = workSignals(JSON.parse(text));
      if (work.length > 0) e.work = work;
    } catch {
      // read already as malformed or not: nothing more to take from it
    }
  }
  return e;
}

/** Only lines that can hold work signals are read twice. */
const WORK_HINT = /"(?:TodoWrite|TaskCreate|TaskUpdate|task_started|task_notification|parent_tool_use_id":"|tool_use_result)/;

function readLine(text: string | null): DeskEvent {
  if (text === null) return { kind: 'malformed', reason: 'too-long' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'malformed', reason: 'not-json' };
  }
  if (!isObj(value)) return { kind: 'malformed', reason: 'not-an-object' };
  const type = str(value.type, 64);
  switch (type) {
    case 'system':
      return systemEvent(value);
    case 'command_lifecycle': {
      const uuid = safeId(value.command_uuid);
      const state = str(value.state, 32);
      return uuid && state && LIFECYCLE.has(state) ? { kind: 'lifecycle', uuid, state: state as LifecycleState } : { kind: 'other', type };
    }
    case 'assistant':
    case 'user':
      return turnLine(value);
    case 'tool_progress':
      return { kind: 'progress' };
    case 'rate_limit_event':
      return limitEvent(value) ?? { kind: 'other', type };
    case 'control_response':
      return ackEvent(value) ?? { kind: 'other', type };
    case 'control_request': {
      const requestId = str(value.request_id, 200);
      const request = isObj(value.request) ? value.request : null;
      if (!requestId) return { kind: 'other', type };
      const subtype = request ? str(request.subtype, 64) : null;
      // can_use_tool names the tool and its input, which the stdio host (plan first's ExitPlanMode) answers with.
      const tool = subtype === 'can_use_tool' && request ? str(request.tool_name, 200) : null;
      return { kind: 'request', requestId, subtype, ...(tool ? { tool, input: isObj(request?.input) ? request.input : {} } : {}) };
    }
    case 'result':
      return { kind: 'result', end: turnEnd(value) };
    default:
      return { kind: 'other', type };
  }
}

/** The most tool names or servers an init line is read for: a desk has dozens; a line with thousands is not trusted. */
const INIT_LIST_MAX = 2000;

function initTools(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.slice(0, INIT_LIST_MAX).flatMap((t) => {
    const name = typeof t === 'string' ? str(t, 200) : null;
    return name === null ? [] : [name];
  });
}

function initServers(v: unknown): { name: string; status: string }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).flatMap((s) => {
    const name = isObj(s) ? str(s.name, 200) : null;
    return name === null ? [] : [{ name, status: isObj(s) ? (str(s.status, 32) ?? 'unknown') : 'unknown' }];
  });
}

function systemEvent(line: Obj): DeskEvent {
  const subtype = str(line.subtype, 64);
  if (subtype === 'init') {
    return { kind: 'init', sessionId: safeId(line.session_id) ?? null, model: str(line.model, 200), apiKeySource: str(line.apiKeySource, 100), tools: initTools(line.tools), mcpServers: initServers(line.mcp_servers) };
  }
  if (subtype === 'session_state_changed') return { kind: 'state', state: str(line.state, 32) ?? 'unknown' };
  if (subtype === 'api_retry') return { kind: 'retry', error: str(line.error, 200), delayMs: amount(line.retry_delay_ms) };
  // task_started, task_notification, task_updated, thinking_tokens, permission_denied, hook_started, hook_response and
  // the rest: the desk is at work.
  return { kind: 'progress' };
}

function blocksOf(line: Obj): unknown[] {
  const message = isObj(line.message) ? line.message : null;
  return message && Array.isArray(message.content) ? message.content : [];
}

/** The prompt size of one request: its fresh input, cache reads and cache writes. */
function promptTokens(usage: unknown): number | null {
  if (!isObj(usage)) return null;
  const total = count(usage.input_tokens) + count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens);
  return total > 0 ? total : null;
}

function turnLine(line: Obj): DeskEvent {
  // A subagent's lines carry the Agent call that runs it; they show work, not the person's own tool calls.
  if (line.parent_tool_use_id !== null && line.parent_tool_use_id !== undefined) return { kind: 'progress' };
  const opened: string[] = [];
  const closed: string[] = [];
  for (const block of blocksOf(line)) {
    if (!isObj(block)) continue;
    if (block.type === 'tool_use') {
      const id = safeId(block.id);
      if (id) opened.push(id);
    } else if (block.type === 'tool_result') {
      const id = safeId(block.tool_use_id);
      if (id) closed.push(id);
    }
  }
  const message = isObj(line.message) ? line.message : null;
  const contextTokens = line.type === 'assistant' && message ? promptTokens(message.usage) : null;
  return { kind: 'turn-line', opened, closed, contextTokens };
}

function limitEvent(line: Obj): DeskEvent | null {
  const info = isObj(line.rate_limit_info) ? line.rate_limit_info : null;
  const status = info ? str(info.status, 64) : null;
  if (!info || !status) return null;
  const resetsAt = amount(info.resetsAt);
  const utilization = amount(info.utilization);
  return {
    kind: 'limit',
    info: {
      status,
      // Seconds since the epoch, as 2.1.312 sends it; a value already in milliseconds is taken as it is.
      resetsAt: resetsAt === null || resetsAt === 0 ? null : resetsAt < 1e11 ? Math.round(resetsAt * 1000) : Math.round(resetsAt),
      utilization,
      type: str(info.rateLimitType, 64),
    },
  };
}

function ackEvent(line: Obj): DeskEvent | null {
  const response = isObj(line.response) ? line.response : null;
  const requestId = response ? str(response.request_id, 200) : null;
  if (!response || !requestId) return null;
  return { kind: 'ack', requestId, ok: response.subtype === 'success' };
}

/** What one result says this turn cost: the sum of model_usage_since_last_result's costUSD, or null without one. */
function costSinceLast(raw: unknown): number | null {
  if (!isObj(raw)) return null;
  let total = 0;
  let seen = false;
  for (const entry of Object.values(raw)) {
    const cost = isObj(entry) ? amount(entry.costUSD) : null;
    if (cost === null) continue;
    total += cost;
    seen = true;
  }
  return seen ? total : null;
}

/** The turn's cost priced from its usage when the result has no per-turn figure, by the first model it names. */
function costFromUsage(result: Obj): number | null {
  const models = isObj(result.modelUsage) ? Object.keys(result.modelUsage) : [];
  const model = models.length === 1 ? models[0] : undefined;
  return model ? costOf(model, usageFromApi(result.usage)) : null;
}

function contextWindowOf(result: Obj): number | null {
  let window: number | null = null;
  for (const source of [result.model_usage_since_last_result, result.modelUsage]) {
    if (!isObj(source)) continue;
    for (const entry of Object.values(source)) {
      const size = isObj(entry) ? amount(entry.contextWindow) : null;
      if (size !== null && size > 0) window = Math.max(window ?? 0, size);
    }
  }
  return window;
}

function uuidsOf(result: Obj): string[] {
  const list = Array.isArray(result.user_message_uuids) ? result.user_message_uuids : [result.user_message_uuid];
  const out: string[] = [];
  for (const item of list.slice(0, UUID_LIMIT)) {
    const id = safeId(item);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Reads a result line. Every field is optional and checked; nothing here throws. */
export function turnEnd(result: Obj): TurnEnd {
  const subtype = str(result.subtype, 64);
  const ok = result.is_error !== true && !(subtype ?? '').startsWith('error');
  const text = typeof result.result === 'string' ? result.result.slice(0, TEXT_LIMIT) : '';
  const errors = Array.isArray(result.errors) ? result.errors.filter((e): e is string => typeof e === 'string').slice(0, 5).map((e) => e.slice(0, 500)) : [];
  const usage = isObj(result.usage) ? result.usage : {};
  const iterations = Array.isArray(usage.iterations) ? usage.iterations : [];
  const status = result.api_error_status;
  return {
    sessionId: safeId(result.session_id) ?? null,
    ok,
    subtype,
    terminalReason: str(result.terminal_reason, 64),
    text,
    costUsd: costSinceLast(result.model_usage_since_last_result) ?? costFromUsage(result),
    usage: {
      input: count(usage.input_tokens),
      output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      cacheWrite: count(usage.cache_creation_input_tokens),
    },
    contextTokens: promptTokens(iterations.at(-1)),
    contextWindow: contextWindowOf(result),
    durationMs: amount(result.duration_ms),
    uuids: uuidsOf(result),
    errorText: ok ? '' : [text, ...errors].filter(Boolean).join('\n').slice(0, ERROR_TEXT_LIMIT),
    apiStatus: typeof status === 'number' && Number.isInteger(status) ? status : null,
  };
}
