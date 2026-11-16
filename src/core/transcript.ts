// Incremental reader for Claude Code session transcripts (JSONL). The format is internal to Claude Code and can
// change between versions, so every field is optional here and a line that doesn't parse is skipped, never thrown.
import { askedQuestion, closingQuestion, crossSessionWords, type OfficeEvent, describeTool, displayPath, safeId, sentBrief, shownText, WRITE_TOOLS } from './events.ts';
import { usageFromApi } from './usage.ts';

export interface TranscriptCursor {
  /** The start of a line whose end hasn't arrived yet (callers that read bytes keep their own byte offset). */
  pending: string;
  /** True while dropping the rest of a line longer than MAX_LINE. */
  skipping: boolean;
  /** message.id values already counted: Claude Code writes one entry per content block with the same usage. */
  seen: Set<string>;
}

export function newCursor(): TranscriptCursor {
  return { pending: '', skipping: false, seen: new Set() };
}

/** The longest line the reader holds on to. Claude Code's lines are far shorter; a file without newlines is not a transcript. */
const MAX_LINE = 64 * 1024 * 1024;

function hold(cursor: TranscriptCursor, text: string, maxLine: number) {
  if (cursor.skipping || text === '') return;
  if (cursor.pending.length + text.length > maxLine) {
    cursor.pending = '';
    cursor.skipping = true;
  } else {
    cursor.pending += text;
  }
}

export interface TranscriptContext {
  sessionId: string;
  /** For a subagent's own transcript: its agent id and type (from the file name and .meta.json). */
  agentId?: string;
  agentType?: string;
  cwd?: string;
  /** Used for entries that carry no timestamp. */
  fallbackTime: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function timeOf(entry: Obj, fallback: number): number {
  const t = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
  return Number.isFinite(t) ? t : fallback;
}

/**
 * Feeds a chunk of newly appended transcript text and returns the usage events it completes. A trailing partial line
 * is kept in the cursor until the rest of it arrives.
 */
export function readUsage(chunk: string, cursor: TranscriptCursor, ctx: TranscriptContext, maxLine = MAX_LINE): OfficeEvent[] {
  // Only text up to the chunk's last newline is complete; joining it with what was held happens once per line, so a
  // long line costs its length once instead of once per chunk.
  const end = chunk.lastIndexOf('\n');
  if (end === -1) {
    hold(cursor, chunk, maxLine);
    return [];
  }
  let text = chunk.slice(0, end);
  if (cursor.skipping) {
    const first = text.indexOf('\n');
    text = first === -1 ? '' : text.slice(first + 1);
    cursor.skipping = false;
  } else {
    text = cursor.pending + text;
  }
  cursor.pending = '';
  hold(cursor, chunk.slice(end + 1), maxLine);
  const events: OfficeEvent[] = [];
  for (const line of text.split('\n')) {
    const entry = parseLine(line);
    if (!entry || entry.type !== 'assistant' || !isObj(entry.message)) continue;
    const message = entry.message;
    const id = typeof message.id === 'string' ? message.id : undefined;
    const model = typeof message.model === 'string' ? message.model : undefined;
    if (!id || !model || model.startsWith('<') || cursor.seen.has(id)) continue;
    cursor.seen.add(id);
    const usage = usageFromApi(message.usage);
    const event: OfficeEvent = { kind: 'usage', at: timeOf(entry, ctx.fallbackTime), sessionId: ctx.sessionId, messageId: id, model, usage };
    const agentId = ctx.agentId ?? (entry.isSidechain === true ? safeId(entry.agentId) : undefined);
    if (agentId) event.agentId = agentId;
    if (ctx.agentType) event.agentType = ctx.agentType;
    if (typeof entry.attributionSkill === 'string') event.skill = entry.attributionSkill;
    if (isObj(message.usage) && message.usage.speed === 'fast') event.fast = true;
    if (isObj(message.usage) && message.usage.inference_geo === 'us') event.usOnly = true;
    events.push(event);
  }
  return events;
}

/** The text blocks of a message, joined. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is Obj => isObj(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => String(b.text))
    .join('\n')
    .trim();
}

/** What a finished transcript ended on: the text of its last finished turn (a subagent's report), or null. */
export function finalReport(text: string): string | null {
  let last: string | null = null;
  for (const line of text.split('\n')) {
    const entry = parseLine(line);
    if (!entry || entry.type !== 'assistant' || !isObj(entry.message) || entry.message.stop_reason !== 'end_turn') continue;
    const said = textOf(entry.message.content);
    if (said) last = said;
  }
  return last;
}

/**
 * A message to the lead as the UserPromptSubmit hook carries it (see normalizeHook): the person's words, or a
 * background-task notification. Anything else in angle brackets is Claude Code's own (reminders, command output).
 */
function promptEvent(text: string, base: { at: number; sessionId: string }): OfficeEvent | null {
  const start = text.trimStart();
  const notification = start.startsWith('<task-notification>');
  // A message from another session is that session's words to this one, as the live hook shows it.
  const said = crossSessionWords(text);
  if (said) return { ...base, kind: 'prompt', text: shownText(said, 140), notification: false };
  if (!start || (start.startsWith('<') && !notification)) return null;
  return { ...base, kind: 'prompt', text: notification ? 'A background task finished' : shownText(text, 140), notification };
}

function parseLine(line: string): Obj | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Rebuilds the office events of a finished transcript for replay: prompts, tool calls and results, subagent spawns
 * and usage. Subagent activity comes from each subagent's own transcript, read with its context.
 */
export function replayEvents(text: string, ctx: TranscriptContext): OfficeEvent[] {
  const events: OfficeEvent[] = [];
  const cursor = newCursor();
  const toolNames = new Map<string, { tool: string; input: unknown }>();
  for (const line of text.split('\n')) {
    const entry = parseLine(line);
    if (!entry) continue;
    const at = timeOf(entry, ctx.fallbackTime);
    const base = { at, sessionId: ctx.sessionId, ...(ctx.agentId ? { agentId: ctx.agentId, agentType: ctx.agentType ?? 'agent' } : {}) };
    const message = isObj(entry.message) ? entry.message : undefined;
    const content = message?.content;

    if (entry.type === 'user' && !ctx.agentId && typeof content === 'string' && entry.isMeta !== true) {
      const prompt = promptEvent(content, base);
      if (prompt) events.push(prompt);
    }

    // What the person types while Claude works, and most background-task notifications, arrive as queued commands
    // (Claude Code 2.1), never as user messages.
    const queued = entry.type === 'attachment' && isObj(entry.attachment) && entry.attachment.type === 'queued_command' ? entry.attachment : undefined;
    if (queued && !ctx.agentId && entry.isSidechain !== true) {
      const prompt = promptEvent(typeof queued.prompt === 'string' ? queued.prompt : textOf(queued.prompt), base);
      if (prompt) events.push(prompt);
    }

    if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!isObj(block) || block.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string') continue;
        toolNames.set(block.id, { tool: block.name, input: block.input });
        const start: OfficeEvent = { ...base, kind: 'tool-start', toolUseId: block.id, tool: block.name, target: describeTool(block.name, block.input, ctx.cwd) };
        if ((block.name === 'Agent' || block.name === 'Task') && isObj(block.input) && typeof block.input.subagent_type === 'string') {
          start.spawn = { agentType: block.input.subagent_type, description: typeof block.input.description === 'string' ? shownText(block.input.description, 200) : '' };
        }
        const ask = block.name === 'AskUserQuestion' ? askedQuestion(block.input) : undefined;
        if (ask) start.ask = ask;
        const sent = sentBrief(block.name, block.input);
        if (sent) start.brief = sent;
        events.push(start);
      }
      events.push(...readUsage(`${line}\n`, cursor, ctx));
      // The lead's last word of a turn, which live offices get from the Stop hook. Claude Code writes one entry per
      // content block, so only the one with the text says it.
      const said = message?.stop_reason === 'end_turn' && !ctx.agentId ? textOf(content) : '';
      if (said) {
        const question = closingQuestion(said);
        events.push({ ...base, kind: 'turn-end', failed: false, lastMessage: shownText(said, 200), ...(question ? { question } : {}) });
      }
    }

    if (entry.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (!isObj(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        const call = toolNames.get(block.tool_use_id);
        if (!call) continue;
        const end: OfficeEvent = { ...base, kind: 'tool-end', toolUseId: block.tool_use_id, tool: call.tool, ok: block.is_error !== true };
        if (end.ok && WRITE_TOOLS.has(call.tool) && isObj(call.input) && typeof call.input.file_path === 'string') {
          end.file = displayPath(call.input.file_path, ctx.cwd);
        }
        events.push(end);
      }
    }
  }
  return events;
}
