// What one person in the office knows, read from their own transcript, for Ask aside: a fresh, read-only Claude Code
// call answers as them from this text. Claude Code's transcript format is internal, so every field is optional, a
// line that doesn't parse is skipped, and nothing here throws.
import { crossSessionWords, describeTool, toolPhrase } from './events.ts';
import { redactClip, redactSecrets } from './redact.ts';

export interface Excerpt {
  text: string;
  /** Steps in the text, the latest report included. */
  steps: number;
  /** The oldest steps left out to fit the budget. */
  omitted: number;
  /** Nothing to tell: no brief and no steps. */
  empty: boolean;
}

export interface ExcerptOptions {
  /** The person's name in the office: "QA engineer", "Lead". */
  who: string;
  /** A main session: the brief is everything the person typed, and subagent lines in the file are skipped. */
  lead: boolean;
  /** Leaves out entries after this time, so a replay answers from what had happened by then. */
  until?: number;
  /** Characters the text may use. */
  budgetChars?: number;
  /** The project folder, so paths read relative to it (default: the transcript's own `cwd`). */
  cwd?: string;
}

export const EXCERPT_BUDGET = 60_000;
const MIN_BUDGET = 1_000;
const BRIEF_CHARS = 4_000;
const REPORT_CHARS = 4_000;
/** Each message the person typed, in the lead's brief. */
const MESSAGE_CHARS = 1_000;
const SAID_CHARS = 1_500;
const RESULT_CHARS = 600;
const CALL_CHARS = 600;
const SUMMARY_CHARS = 2_000;
/** A glimpse of the input of a tool the office has no words for. */
const INPUT_CHARS = 160;
/** Room kept for the title of the steps section, which says how many were left out. */
const STEPS_TITLE_CHARS = 90;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Call {
  kind: 'call';
  tool: string;
  line: string;
  result: { ok: boolean; text: string } | null;
}
type Step = Call | { kind: 'said'; text: string } | { kind: 'note'; text: string; max: number };

interface Reading {
  lead: boolean;
  cwd: string | undefined;
  steps: Step[];
  calls: Map<string, Call>;
  /** A subagent's brief, or every message the person typed to the lead. */
  messages: string[];
}

/** Tools whose call line already says enough (see describeTool). */
const DESCRIBED = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Bash', 'PowerShell', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'ToolSearch', 'Agent', 'Task', 'Skill']);
const COMPACTED = 'This session is being continued from a previous conversation';

function parse(line: string): Obj | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isObj(value) ? value : null;
  } catch {
    // Not a transcript line (or half of one): skipped, like every line the reader doesn't understand.
    return null;
  }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const indent = (text: string) => text.replaceAll('\n', '\n  ');

/** The first `max` UTF-16 units, never half a surrogate pair. */
function head(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Text from the transcript as the excerpt shows it: reminders and blank runs gone, masked, cut to `max`. */
function piece(text: string, max: number): string {
  const tidy = head(text, max * 8)
    .replace(/<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g, '')
    .replace(/<\/?tool_use_error>/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return redactClip(tidy, max);
}

function slashCommand(text: string): string | null {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim();
  if (!name) return null;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? '';
  return `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`;
}

function notification(text: string): string {
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim();
  const result = tag('result');
  return `Hears back: ${tag('summary') || 'a background task finished'}${result ? `: ${result}` : ''}`;
}

type Heard = { kind: 'message'; text: string } | { kind: 'note'; text: string; max: number } | null;

/** What a user line is: something the person (or, for a subagent, the lead) wrote, news to note, or machinery. */
function hear(raw: string, compactSummary: boolean): Heard {
  const text = raw.trim();
  if (!text) return null;
  if (compactSummary || text.startsWith(COMPACTED)) {
    return { kind: 'note', text: `Earlier work, as summarised when the conversation was compacted: ${text}`, max: SUMMARY_CHARS };
  }
  if (text.startsWith('<task-notification>')) return { kind: 'note', text: notification(text), max: RESULT_CHARS };
  if (text.startsWith('[Request interrupted by user')) return { kind: 'note', text: 'The person interrupted.', max: 100 };
  const relayed = crossSessionWords(text);
  if (relayed) return { kind: 'message', text: relayed };
  const command = slashCommand(text);
  if (command) return { kind: 'message', text: command };
  // System reminders, command output, hook context and other tagged text Claude Code adds on its own.
  return text.startsWith('<') ? null : { kind: 'message', text };
}

function message(r: Reading, text: string) {
  if (r.lead) {
    // The brief holds the whole message; the step only marks where it arrived.
    r.messages.push(text);
    r.steps.push({ kind: 'note', text: `The person writes: ${text}`, max: 160 });
  } else if (r.messages.length === 0) {
    r.messages.push(text);
  } else {
    r.steps.push({ kind: 'note', text: `Gets a new message: ${text}`, max: SAID_CHARS });
  }
}

function heard(r: Reading, h: Heard) {
  if (h?.kind === 'message') message(r, h.text);
  else if (h?.kind === 'note') r.steps.push(h);
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!isObj(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'image') parts.push('[image]');
    else if (block.type === 'document') parts.push('[document]');
  }
  return parts.join('\n');
}

function toolResult(r: Reading, id: string, block: Obj, toolUseResult: unknown) {
  const call = r.calls.get(id);
  if (!call || call.result) return;
  // A background agent's launch notice is internal metadata; its report arrives later as a notification.
  const launched = (call.tool === 'Agent' || call.tool === 'Task') && isObj(toolUseResult) && (toolUseResult.status === 'async_launched' || toolUseResult.isAsync === true);
  call.result = { ok: block.is_error !== true, text: launched ? 'Started in the background; its report comes back later.' : resultText(block.content) };
}

/** User content: the person's words or a brief, tool results, notifications, or machinery to skip. */
function user(r: Reading, content: unknown, compactSummary: boolean, toolUseResult: unknown) {
  if (typeof content === 'string') return heard(r, hear(content, compactSummary));
  if (!Array.isArray(content)) return;
  const words: string[] = [];
  for (const block of content) {
    if (!isObj(block)) continue;
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      toolResult(r, block.tool_use_id, block, toolUseResult);
    } else if (block.type === 'text' && typeof block.text === 'string') {
      const h = hear(block.text, compactSummary);
      if (h?.kind === 'message') words.push(h.text);
      else heard(r, h);
    } else if (block.type === 'image') {
      words.push('[image]');
    }
  }
  if (words.length > 0) message(r, words.join('\n'));
}

function planLine(input: unknown): string {
  const items: string[] = [];
  for (const todo of isObj(input) && Array.isArray(input.todos) ? input.todos : []) {
    if (!isObj(todo) || typeof todo.content !== 'string') continue;
    items.push(`${todo.content} (${todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'in progress' : 'to do'})`);
  }
  return items.length > 0 ? `Updates the plan: ${items.join('; ')}` : 'Updates the plan';
}

function questionLine(input: unknown): string {
  const first = (isObj(input) && Array.isArray(input.questions) ? input.questions : []).find(isObj);
  return first && typeof first.question === 'string' ? `Asks the person: ${first.question}` : 'Asks the person a question';
}

/** One tool call as a step: "Edits src/App.tsx", "Runs npm test", or a glimpse of the input for tools without words. */
function callLine(tool: string, input: unknown, cwd: string | undefined): string {
  if (tool === 'TodoWrite') return planLine(input);
  if (tool === 'AskUserQuestion') return questionLine(input);
  const phrase = toolPhrase(tool, describeTool(tool, input, cwd));
  if (DESCRIBED.has(tool) || !isObj(input) || Object.keys(input).length === 0) return phrase;
  return `${phrase}: ${redactClip(flat(JSON.stringify(input)), INPUT_CHARS)}`;
}

function assistant(r: Reading, content: unknown) {
  const said = (text: string) => {
    const t = text.trim();
    if (t && t !== '(no content)') r.steps.push({ kind: 'said', text: t });
  };
  if (typeof content === 'string') return said(content);
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isObj(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      said(block.text);
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string' && !r.calls.has(block.id)) {
      const call: Call = { kind: 'call', tool: block.name, line: callLine(block.name, block.input, r.cwd), result: null };
      r.calls.set(block.id, call);
      r.steps.push(call);
    }
  }
}

function read(jsonl: string, options: ExcerptOptions): Reading {
  const r: Reading = { lead: options.lead, cwd: options.cwd, steps: [], calls: new Map(), messages: [] };
  const seen = new Set<string>();
  // An entry without a time belongs to the moment of the entry before it.
  let clock: number | undefined;
  for (const line of jsonl.split('\n')) {
    const entry = parse(line);
    if (!entry) continue;
    if (typeof entry.uuid === 'string') {
      if (seen.has(entry.uuid)) continue;
      seen.add(entry.uuid);
    }
    const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    if (Number.isFinite(at)) clock = at;
    if (options.until !== undefined && clock !== undefined && clock > options.until) continue;
    if (entry.isMeta === true || (options.lead && entry.isSidechain === true)) continue;
    if (r.cwd === undefined && typeof entry.cwd === 'string') r.cwd = entry.cwd;
    const msg = isObj(entry.message) ? entry.message : null;
    if (entry.type === 'assistant' && msg) assistant(r, msg.content);
    else if (entry.type === 'user' && msg) user(r, msg.content, entry.isCompactSummary === true, entry.toolUseResult);
    // What the person types while Claude works, and most background-task notifications, arrive as queued commands.
    else if (entry.type === 'attachment' && isObj(entry.attachment) && entry.attachment.type === 'queued_command') user(r, entry.attachment.prompt, false, undefined);
  }
  return r;
}

function header(options: ExcerptOptions): string {
  const who = redactClip(flat(options.who), 80) || (options.lead ? 'Lead' : 'Agent');
  return options.lead
    ? `Transcript excerpt of ${who}, the main session the person talks to: what the person asked, each step oldest first, and the latest report.`
    : `Transcript excerpt of ${who}: the brief they were given, each step oldest first, and the latest report.`;
}

function briefSection(messages: string[], lead: boolean, cap: number): string {
  if (messages.length === 0) return '';
  if (!lead) return `Brief:\n${piece(messages[0] ?? '', cap)}`;
  const title = 'What the person asked, oldest first:';
  const each = Math.max(80, Math.min(MESSAGE_CHARS, Math.floor(cap / 4)));
  const items = messages.map((m, i) => `${i + 1}. ${indent(piece(m, each))}`);
  if (title.length + items.reduce((sum, item) => sum + item.length + 1, 0) <= cap) return [title, ...items].join('\n');
  // Too many to keep: the first message (it usually sets the task) and as many of the newest as fit.
  const [first = '', ...rest] = items;
  const newest: string[] = [];
  let used = title.length + first.length + 60;
  for (let i = rest.length - 1; i >= 0; i--) {
    const item = rest[i] ?? '';
    if (used + item.length + 1 > cap) break;
    newest.unshift(item);
    used += item.length + 1;
  }
  const skipped = rest.length - newest.length;
  return [title, first, ...(skipped > 0 ? [`(${skipped} ${skipped === 1 ? 'message' : 'messages'} in between left out)`] : []), ...newest].join('\n');
}

function render(step: Step, pending: boolean): string {
  if (step.kind === 'said') return `- Says: ${indent(piece(step.text, SAID_CHARS))}`;
  if (step.kind === 'note') return `- ${piece(flat(step.text), step.max)}`;
  const line = `- ${piece(step.line, CALL_CHARS)}`;
  if (!step.result) return pending ? `${line} (no result yet)` : line;
  const body = piece(step.result.text, RESULT_CHARS);
  if (step.result.ok) return body ? `${line}\n  Result: ${indent(body)}` : line;
  return `${line}\n  Failed${body ? `: ${indent(body)}` : '.'}`;
}

/**
 * What `who` knows, from their transcript (JSONL): the brief (a subagent's first message, or everything the person
 * typed to the lead), each step in order (what they wrote, each tool call with its trimmed result, notes such as
 * notifications), and their latest report. The newest steps fill the budget and the oldest go first. Secrets come out
 * as "[redacted]".
 */
export function transcriptExcerpt(jsonl: string, options: ExcerptOptions): Excerpt {
  const r = read(jsonl, options);
  const top = header(options);
  if (r.messages.length === 0 && r.steps.length === 0) return { text: `${top}\n\nNothing in the transcript yet.`, steps: 0, omitted: 0, empty: true };

  const requested = options.budgetChars;
  const budget = requested !== undefined && Number.isFinite(requested) ? Math.max(MIN_BUDGET, Math.floor(requested)) : EXCERPT_BUDGET;
  // The latest report is the last thing they wrote: it gets its own section instead of a line among the steps.
  const reportAt = r.steps.findLastIndex((s) => s.kind === 'said');
  const report = r.steps[reportAt];
  const list = r.steps.filter((_, i) => i !== reportAt);
  // Calls at the very end with no result yet are what they are doing now.
  const pending = new Set<Step>();
  for (let i = r.steps.length - 1; i >= 0; i--) {
    const step = r.steps[i];
    if (step?.kind !== 'call' || step.result) break;
    pending.add(step);
  }

  const brief = briefSection(r.messages, options.lead, Math.min(BRIEF_CHARS, Math.floor(budget * 0.3)));
  const latest = report?.kind === 'said' ? `Latest report:\n${piece(report.text, Math.min(REPORT_CHARS, Math.floor(budget * 0.2)))}` : '';
  const rendered = new Map<Step, string>();
  const write = (room: number) => {
    const shown: string[] = [];
    let left = room;
    for (let i = list.length - 1; i >= 0; i--) {
      const step = list[i];
      if (!step) continue;
      const text = rendered.get(step) ?? render(step, pending.has(step));
      rendered.set(step, text);
      if (text.length + 1 > left) break;
      shown.push(text);
      left -= text.length + 1;
    }
    shown.reverse();
    const omitted = list.length - shown.length;
    let steps = '';
    if (shown.length > 0) steps = [`Steps, oldest first${omitted > 0 ? ` (the ${omitted} earliest are left out to fit)` : ''}:`, ...shown].join('\n');
    else if (list.length > 0) steps = `Steps: ${list.length}, all left out to fit.`;
    return { text: redactSecrets([top, brief, steps, latest].filter(Boolean).join('\n\n')), shown: shown.length, omitted };
  };
  // Every piece was masked as it went in; a pass over the whole text catches anything that spans pieces. That pass can
  // lengthen the text (a private key cut short gets its END line back), so it comes before the fitting: the oldest steps
  // make the room, never the latest report at the end.
  let room = budget - [top, brief, latest].reduce((sum, s) => sum + s.length + 2, 0) - STEPS_TITLE_CHARS;
  let out = write(room);
  for (let tries = 0; out.text.length > budget && tries < 8; tries++) {
    room -= out.text.length - budget;
    out = write(room);
  }
  const text = out.text.length > budget ? redactClip(out.text, budget) : out.text;
  return { text, steps: out.shown + (latest ? 1 : 0), omitted: out.omitted, empty: false };
}
