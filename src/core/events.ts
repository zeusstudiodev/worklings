// Normalises Claude Code hook payloads (and usage from transcripts and OpenTelemetry) into office events.
import { redactSecrets } from './redact.ts';
import type { TokenUsage } from './usage.ts';

interface Base {
  /** When the office received it (hooks carry no timestamp). */
  at: number;
  sessionId: string;
  /** Set when the event comes from inside a subagent. */
  agentId?: string;
  agentType?: string;
  cwd?: string;
  transcriptPath?: string;
}

export type OfficeEvent =
  | (Base & { kind: 'prompt'; text: string; notification: boolean })
  | (Base & {
    kind: 'tool-start'; toolUseId: string; tool: string; target: string; spawn?: { agentType: string; description: string }; ask?: string;
    /** A SendMessage that continues a subagent: a new brief for the agent with that id. */
    brief?: { agentId: string; description: string };
  })
  | (Base & { kind: 'tool-end'; toolUseId: string; tool: string; ok: boolean; durationMs?: number; error?: string; file?: string })
  | (Base & { kind: 'subagent-start'; agentId: string; agentType: string })
  | (Base & { kind: 'subagent-stop'; agentId: string; agentType: string; agentTranscriptPath?: string; lastMessage?: string; question?: string })
  | (Base & { kind: 'permission'; tool: string; target: string })
  | (Base & { kind: 'permission-denied'; tool: string; target: string })
  | (Base & { kind: 'notice'; message: string; needsYou: boolean })
  | (Base & { kind: 'turn-end'; lastMessage?: string; question?: string; failed: boolean })
  | (Base & { kind: 'session-end'; reason?: string })
  | (Base & { kind: 'compact'; phase: 'start' | 'end' })
  | (Base & { kind: 'teammate-idle'; teammate: string })
  | (Base & { kind: 'task'; taskId: string; title: string; status: 'open' | 'done'; owner?: string })
  | (Base & { kind: 'usage'; messageId: string; model: string; usage: TokenUsage; skill?: string; fast?: boolean; usOnly?: boolean })
  | (Base & { kind: 'cost'; costUsd: number; model?: string });

export type OfficeEventKind = OfficeEvent['kind'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * Session, agent and task ids as Claude Code makes them (UUIDs, hex, numbers); anything else is dropped. An id starts
 * with a letter, digit or underscore, so none can pass for a command-line flag ("--debug") or a relative path ("..").
 */
export const safeId = (v: unknown): string | undefined =>
  typeof v === 'string' && /^\w[\w.:-]{0,127}$/.test(v) && !(v in Object.prototype) ? v : undefined;

export function oneLine(value: string, max = 72): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** How much of a free-text field is flattened, and how much of that masked: far past any cut, and cheap on a 1 MB hook. */
const FLATTEN_WINDOW = 16_384;
const MASKED_WINDOW = 2_000;

/**
 * Free text from a hook or a transcript (a prompt, a report, a question, an error, what a command is for) as the office
 * shows it: flattened to one line, its start masked, then cut to `max` characters. Masking happens before the cut, on a
 * window well past it, so a secret can't half-show where the text is cut; flattening comes first, so a long run of
 * spaces can't pull the cut-off end of a secret into view.
 */
export function shownText(value: string, max = 72): string {
  const flat = value.slice(0, FLATTEN_WINDOW).replace(/\s+/g, ' ').trim();
  return oneLine(redactSecrets(flat.slice(0, MASKED_WINDOW)), max);
}

const CROSS_SESSION = /^\s*<cross-session-message\b[^>]*>([\s\S]*?)(?:<\/cross-session-message>\s*)?$/;

/**
 * The words of a message another Claude Code session sent, which reaches a session as its prompt wrapped in
 * `<cross-session-message from="..." from-name="...">`; null for anything else. The office shows the words, never the
 * wrapper and its ids.
 */
export function crossSessionWords(prompt: string): string | null {
  const words = CROSS_SESSION.exec(prompt.slice(0, FLATTEN_WINDOW))?.[1]?.trim();
  return words || null;
}

/** A path as the user thinks of it: relative to the project when it is inside it, with forward slashes. */
export function displayPath(path: string, cwd?: string): string {
  const p = path.replaceAll('\\', '/');
  if (cwd) {
    const root = cwd.replaceAll('\\', '/').replace(/\/$/, '');
    if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return p.slice(root.length + 1);
  }
  const parts = p.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p;
}

/**
 * What a command without a description shows: the program and the plain words after it, up to the first flag, value
 * or quote. Commands carry secrets (`export KEY=...`, `curl -H "Authorization: ..."`), and the office shows this text.
 */
export function commandGist(command: string): string {
  const words: string[] = [];
  for (const word of command.trim().split(/\s+/)) {
    if (words.length === 0 && /^\w+=/.test(word)) continue;
    if (words.length === 3 || word.length > 24 || !/^[A-Za-z0-9][\w./:@-]*$/.test(word)) break;
    words.push(word);
  }
  return words.join(' ');
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead']);
export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The few words a speech bubble shows for a tool call: the file, the command's purpose, the search. */
export function describeTool(tool: string, input: unknown, cwd?: string): string {
  const i = isObj(input) ? input : {};
  if (FILE_TOOLS.has(tool)) {
    const path = text(i.file_path) ?? text(i.notebook_path) ?? text(i.path);
    return path ? displayPath(path, cwd) : '';
  }
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return shownText(text(i.description) ?? commandGist(text(i.command) ?? ''));
    case 'Grep':
    case 'Glob':
      return shownText(text(i.pattern) ?? '');
    case 'WebFetch': {
      const url = text(i.url);
      if (!url) return '';
      try {
        const u = new URL(url);
        return shownText(u.host + (u.pathname === '/' ? '' : u.pathname));
      } catch {
        return shownText(url);
      }
    }
    case 'WebSearch':
    case 'ToolSearch':
      return shownText(text(i.query) ?? '');
    case 'Agent':
    case 'Task':
      return shownText([text(i.subagent_type), text(i.description)].filter(Boolean).join(': '));
    case 'Skill':
      return shownText(text(i.skill) ?? text(i.command) ?? '');
    case 'TodoWrite':
      return 'updating the plan';
    case 'AskUserQuestion':
      return 'asking you a question';
  }
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__');
    return oneLine(`${server} › ${name.replaceAll('_', ' ')}`);
  }
  return '';
}

/** Only the end of a message can hold its closing question; a 1 MB report must stay cheap (hooks wait on the office). */
const QUESTION_WINDOW = 4_000;
/** Markdown emphasis, a closing quote or bracket, or spaces may follow the question mark. */
const AFTER_QUESTION = /[*_`'")\]\s]/;

/**
 * The question a message ends with, if it ends with one: its last sentence, masked and cut at 200 characters. Reports
 * keep only their first 200 characters, so this is taken from the end of the whole message first.
 */
export function closingQuestion(message: string): string | undefined {
  const start = Math.max(0, message.length - QUESTION_WINDOW);
  let end = message.length;
  while (end > start && AFTER_QUESTION.test(message.charAt(end - 1))) end -= 1;
  const body = message.slice(start, end).trim();
  if (!body.endsWith('?')) return undefined;
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((t) => t.replace(/^[*_`>#\s-]+/, '').trim()).filter(Boolean);
  return shownText(sentences.at(-1) ?? body, 200);
}

/**
 * The brief a SendMessage call gives: Claude Code continues a subagent with `to` set to the id its hooks report and a
 * five-to-ten-word `summary` of the message. The id, and that recap (or the message's start) masked.
 */
export function sentBrief(tool: string, input: unknown): { agentId: string; description: string } | undefined {
  if (tool !== 'SendMessage' || !isObj(input)) return undefined;
  const agentId = safeId(input.to);
  return agentId ? { agentId, description: shownText(text(input.summary) ?? text(input.message) ?? '', 200) } : undefined;
}

/** The first question an AskUserQuestion call puts to the person. */
export function askedQuestion(input: unknown): string | undefined {
  if (!isObj(input) || !Array.isArray(input.questions)) return undefined;
  const first: unknown = input.questions[0];
  const question = isObj(first) ? text(first.question) : undefined;
  return question ? shownText(question, 200) : undefined;
}

/** Short tool label for bubbles: mcp tools get their own name instead of the long mcp__server__tool id. */
export function toolLabel(tool: string): string {
  if (tool.startsWith('mcp__')) return tool.split('__')[2]?.replaceAll('_', ' ') ?? tool;
  return tool;
}

/** How each tool reads in a sentence: "Reads notes.txt" (third person) or "asks to read notes.txt" (infinitive). */
const VERBS: Record<string, [third: string, infinitive: string]> = {
  Read: ['Reads', 'read'],
  NotebookRead: ['Reads', 'read'],
  Write: ['Writes', 'write'],
  Edit: ['Edits', 'edit'],
  MultiEdit: ['Edits', 'edit'],
  NotebookEdit: ['Edits', 'edit'],
  Bash: ['Runs', 'run'],
  PowerShell: ['Runs', 'run'],
  Grep: ['Searches the code for', 'search the code for'],
  Glob: ['Looks for files matching', 'look for files matching'],
  WebFetch: ['Reads', 'read'],
  WebSearch: ['Searches the web for', 'search the web for'],
  ToolSearch: ['Looks up tools for', 'look up tools for'],
  Agent: ['Briefs', 'brief'],
  Task: ['Briefs', 'brief'],
  Skill: ['Follows the playbook', 'follow the playbook'],
  TodoWrite: ['Updates the plan', 'update the plan'],
  AskUserQuestion: ['Asks you a question', 'ask you a question'],
};

/**
 * One tool call as a short sentence for bubbles and the activity log, e.g. "Edits src/App.tsx" or, with the
 * infinitive, "edit src/App.tsx" to follow "Asks to". Bash calls with a description use the description itself.
 */
export function toolPhrase(tool: string, target: string, form: 'third' | 'infinitive' = 'third'): string {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (tool.startsWith('mcp__')) {
    const [, server = 'a tool', name = ''] = tool.split('__');
    const what = `${server}${name ? `: ${name.replaceAll('_', ' ')}` : ''}`;
    return form === 'third' ? `Uses ${what}` : `use ${what}`;
  }
  const verbs = VERBS[tool];
  if (!verbs) return form === 'third' ? `Uses ${tool}${target ? `: ${target}` : ''}` : `use ${tool}${target ? `: ${target}` : ''}`;
  const [third, infinitive] = verbs;
  if (!target || tool === 'TodoWrite' || tool === 'AskUserQuestion') return form === 'third' ? third : infinitive;
  // A Bash description is already a sentence ("Install dependencies"); a bare command reads after "Runs".
  if ((tool === 'Bash' || tool === 'PowerShell') && !/^[a-z0-9./_-]+(\s|$)/.test(target)) return form === 'third' ? upper(target) : lower(target);
  if (tool === 'Skill') return form === 'third' ? `Follows the ${target} playbook` : `follow the ${target} playbook`;
  return `${form === 'third' ? third : infinitive} ${target}`;
}

/**
 * Notification types that mean Claude is blocked on the person at the keyboard. `idle_prompt` isn't one: it only says
 * a finished session is waiting for its next prompt, which is how every idle session looks.
 */
const NEEDS_YOU = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

/** Turns one hook payload into an office event, or null for events the office doesn't show. */
export function normalizeHook(payload: unknown, at: number): OfficeEvent | null {
  if (!isObj(payload)) return null;
  const event = text(payload.hook_event_name);
  const sessionId = safeId(payload.session_id);
  if (!event || !sessionId) return null;

  const base: Base = { at, sessionId };
  const agentId = safeId(payload.agent_id);
  const agentType = text(payload.agent_type);
  if (agentId) base.agentId = agentId;
  if (agentType) base.agentType = agentType;
  const cwd = text(payload.cwd);
  if (cwd) base.cwd = cwd;
  const transcriptPath = text(payload.transcript_path);
  if (transcriptPath) base.transcriptPath = transcriptPath;

  const tool = text(payload.tool_name) ?? '';
  const toolUseId = text(payload.tool_use_id) ?? '';
  const target = describeTool(tool, payload.tool_input, cwd);

  switch (event) {
    case 'UserPromptSubmit': {
      const prompt = text(payload.prompt) ?? '';
      const notification = prompt.trimStart().startsWith('<task-notification>');
      const said = crossSessionWords(prompt) ?? prompt;
      return { ...base, kind: 'prompt', text: notification ? 'A background task finished' : shownText(said, 140), notification };
    }
    case 'PreToolUse': {
      const e: OfficeEvent = { ...base, kind: 'tool-start', toolUseId, tool, target };
      const input = payload.tool_input;
      if ((tool === 'Agent' || tool === 'Task') && isObj(input) && text(input.subagent_type)) {
        e.spawn = { agentType: text(input.subagent_type) ?? '', description: shownText(text(input.description) ?? '', 200) };
      }
      const ask = tool === 'AskUserQuestion' ? askedQuestion(input) : undefined;
      if (ask) e.ask = ask;
      const sent = sentBrief(tool, input);
      if (sent) e.brief = sent;
      return e;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const ok = event === 'PostToolUse';
      const e: OfficeEvent = { ...base, kind: 'tool-end', toolUseId, tool, ok };
      if (typeof payload.duration_ms === 'number') e.durationMs = payload.duration_ms;
      const error = text(payload.error);
      if (!ok) e.error = payload.is_interrupt === true ? 'Interrupted' : shownText(error ?? 'Failed', 160);
      const input = payload.tool_input;
      if (ok && WRITE_TOOLS.has(tool) && isObj(input)) {
        const path = text(input.file_path) ?? text(input.notebook_path);
        if (path) e.file = displayPath(path, cwd);
      }
      return e;
    }
    case 'SubagentStart':
      if (!agentId) return null;
      return { ...base, kind: 'subagent-start', agentId, agentType: agentType ?? 'agent' };
    case 'SubagentStop': {
      if (!agentId) return null;
      const e: OfficeEvent = { ...base, kind: 'subagent-stop', agentId, agentType: agentType ?? 'agent' };
      const path = text(payload.agent_transcript_path);
      if (path) e.agentTranscriptPath = path;
      const last = text(payload.last_assistant_message);
      if (last) e.lastMessage = shownText(last, 200);
      const question = last ? closingQuestion(last) : undefined;
      if (question) e.question = question;
      return e;
    }
    case 'PermissionRequest':
      return { ...base, kind: 'permission', tool, target };
    case 'PermissionDenied':
      return { ...base, kind: 'permission-denied', tool, target };
    case 'Notification': {
      const message = text(payload.message) ?? '';
      const needsYou = NEEDS_YOU.has(text(payload.notification_type) ?? '');
      return { ...base, kind: 'notice', message: shownText(message, 160), needsYou };
    }
    case 'Stop':
    case 'StopFailure': {
      const e: OfficeEvent = { ...base, kind: 'turn-end', failed: event === 'StopFailure' };
      const last = text(payload.last_assistant_message);
      if (last) e.lastMessage = shownText(last, 200);
      const question = last ? closingQuestion(last) : undefined;
      if (question) e.question = question;
      return e;
    }
    case 'SessionEnd':
      return { ...base, kind: 'session-end', ...(text(payload.reason) ? { reason: text(payload.reason) } : {}) };
    case 'PreCompact':
      return { ...base, kind: 'compact', phase: 'start' };
    case 'PostCompact':
      return { ...base, kind: 'compact', phase: 'end' };
    case 'TeammateIdle':
      return { ...base, kind: 'teammate-idle', teammate: text(payload.teammate_name) ?? agentType ?? 'teammate' };
    case 'TaskCreated':
    case 'TaskCompleted': {
      const taskId = safeId(payload.task_id) ?? safeId(toolUseId);
      if (!taskId) return null;
      const title = shownText(text(payload.task_subject) ?? text(payload.task_description) ?? 'Task', 90);
      const owner = text(payload.teammate_name);
      return { ...base, kind: 'task', taskId, title, status: event === 'TaskCreated' ? 'open' : 'done', ...(owner ? { owner } : {}) };
    }
    default:
      return null;
  }
}
