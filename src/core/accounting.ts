// Token accounting for a company run: which turns the desks took, what began each one, what it did, and what it cost.
// Pure and free of Node APIs, like the rest of src/core: scripts/accounting.ts reads the files and calls this.
//
// A company's people are long-lived Claude Code desks. Each of their turns begins with a message the office delivered
// (turnText in company.ts), so a desk's transcript splits into turns at those user messages, and the message says what
// began the turn. The usage on the assistant lines says what the turn cost.
import { isManager, type Message, type Person, STAKEHOLDER, THE_OFFICE } from './company.ts';
import { costOf, canonicalModel, knownModel } from './pricing.ts';
import { addUsage, totalTokens, type TokenUsage, usageFromApi, ZERO_USAGE } from './usage.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------
// Reading a transcript

export interface ToolUse {
  name: string;
  /** A Bash command, cut short, so tests and builds can be told from other commands. */
  command?: string;
}

/** One API request. Claude Code writes one line per content block with the same message id and usage. */
export interface Call {
  id: string;
  at: number;
  model: string;
  usage: TokenUsage;
  fast: boolean;
  usOnly: boolean;
  tools: ToolUse[];
  /** A subagent's request, made inside this turn. */
  sub: boolean;
}

/** A message the office put to the desk: a user turn, or one folded into a turn that was under way. */
export interface Delivered {
  text: string;
  at: number;
}

export interface RawTurn {
  began: Delivered;
  /** Delivered while the turn was under way (a "next step" delivery): they join this turn instead of starting one. */
  folded: Delivered[];
  calls: Call[];
  endedAt: number;
}

export interface SessionShape {
  /** The role's own prompt (before "# Working at"), and the house rules and place after it, in characters. */
  roleChars: number;
  houseChars: number;
  /** The house rules' first line ("You are Ada, ... at Company ..."), which says whose desk this is. */
  houseHead: string;
  tools: { name: string; chars: number }[];
}

export interface ParsedSession {
  turns: RawTurn[];
  shape: SessionShape | null;
  /** The size in characters of what Claude Code added before the first request, by attachment type. */
  attachments: Record<string, number>;
}

function parseLine(line: string): Obj | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

const timeOf = (e: Obj): number => {
  const t = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** The text of a user entry that is a prompt (a string, or text blocks with no tool result); null for anything else. */
function promptText(entry: Obj): string | null {
  const message = isObj(entry.message) ? entry.message : null;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((b) => isObj(b) && b.type === 'tool_result')) return null;
  const text = content.filter((b): b is Obj => isObj(b) && b.type === 'text' && typeof b.text === 'string').map((b) => String(b.text)).join('\n');
  return text === '' ? null : text;
}

const max = (a: number, b: number): number => (a > b ? a : b);

/** Per-field maximum, since a message's lines can repeat the usage as it grew. */
function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: max(a.input, b.input), output: max(a.output, b.output), cacheRead: max(a.cacheRead, b.cacheRead), cacheWrite5m: max(a.cacheWrite5m, b.cacheWrite5m), cacheWrite1h: max(a.cacheWrite1h, b.cacheWrite1h) };
}

const HOUSE_MARKER = '\n# Working at ';

function shapeOf(entry: Obj): SessionShape | null {
  const shape = isObj(entry.shape) ? entry.shape : null;
  if (!shape) return null;
  const system = Array.isArray(shape.system) ? shape.system : [];
  let roleChars = 0;
  let houseChars = 0;
  let houseHead = '';
  for (const block of system) {
    const text = isObj(block) && typeof block.text === 'string' ? block.text : '';
    const at = text.indexOf(HOUSE_MARKER);
    if (at === -1) roleChars += text.length;
    else {
      roleChars += at;
      houseChars += text.length - at;
      if (houseHead === '') houseHead = /You are [^\r\n]{0,300}/.exec(text.slice(at))?.[0].trim() ?? '';
    }
  }
  const tools = (Array.isArray(shape.tools) ? shape.tools : []).flatMap((t) => (isObj(t) && typeof t.name === 'string' ? [{ name: t.name, chars: JSON.stringify(t).length }] : []));
  return { roleChars, houseChars, houseHead, tools };
}

function toolUses(content: unknown): ToolUse[] {
  if (!Array.isArray(content)) return [];
  const out: ToolUse[] = [];
  for (const block of content) {
    if (!isObj(block) || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
    const input = isObj(block.input) ? block.input : null;
    const command = typeof input?.command === 'string' ? input.command.slice(0, 300) : undefined;
    out.push(command === undefined ? { name: block.name } : { name: block.name, command });
  }
  return out;
}

/**
 * Splits a desk's transcript into turns. A turn starts at a user prompt and runs to the next one; a message queued while
 * the turn was under way (a queued_command) belongs to that turn. Requests made before any prompt count as a turn of
 * their own whose message is empty.
 */
export function parseSession(text: string): ParsedSession {
  const turns: RawTurn[] = [];
  const attachments: Record<string, number> = Object.create(null) as Record<string, number>;
  let shape: SessionShape | null = null;
  let turn: RawTurn | null = null;
  const byId = new Map<string, Call>();
  let seenCall = false;
  for (const line of text.split('\n')) {
    const entry = parseLine(line);
    if (!entry) continue;
    const at = timeOf(entry);
    if (entry.type === 'api-request-shape' && shape === null) shape = shapeOf(entry);
    if (entry.type === 'attachment' && isObj(entry.attachment)) {
      const a = entry.attachment;
      if (a.type === 'queued_command' && turn) {
        const prompt = typeof a.prompt === 'string' ? a.prompt : '';
        if (prompt) turn.folded.push({ text: prompt, at });
      } else if (!seenCall && typeof a.type === 'string') {
        attachments[a.type] = (attachments[a.type] ?? 0) + JSON.stringify(a).length;
      }
      continue;
    }
    if (entry.type === 'user' && entry.isMeta !== true && entry.isSidechain !== true) {
      const prompt = promptText(entry);
      if (prompt !== null && prompt.trim() !== '' && !prompt.trimStart().startsWith('<')) {
        turn = { began: { text: prompt, at }, folded: [], calls: [], endedAt: at };
        turns.push(turn);
      }
      continue;
    }
    if (entry.type !== 'assistant' || !isObj(entry.message)) continue;
    const message = entry.message;
    const id = typeof message.id === 'string' ? message.id : null;
    const model = typeof message.model === 'string' ? message.model : '';
    if (!id || !model || model.startsWith('<')) continue;
    seenCall = true;
    if (!turn) {
      turn = { began: { text: '', at }, folded: [], calls: [], endedAt: at };
      turns.push(turn);
    }
    const usage = usageFromApi(message.usage);
    const tools = toolUses(message.content);
    const known = byId.get(id);
    if (known) {
      known.usage = mergeUsage(known.usage, usage);
      known.tools.push(...tools);
    } else {
      const u = isObj(message.usage) ? message.usage : {};
      const call: Call = { id, at, model, usage, fast: u.speed === 'fast', usOnly: u.inference_geo === 'us', tools, sub: false };
      byId.set(id, call);
      turn.calls.push(call);
    }
    turn.endedAt = at;
  }
  return { turns, shape, attachments };
}

/** Adds a subagent's transcript: its requests count in the turn that was under way at the time. */
export function addSubagent(parsed: ParsedSession, text: string): void {
  const sub = parseSession(text);
  for (const t of sub.turns) {
    for (const call of t.calls) {
      const host = [...parsed.turns].reverse().find((x) => x.began.at <= call.at) ?? parsed.turns[0];
      if (host) host.calls.push({ ...call, sub: true });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What began a turn

export const TRIGGERS = [
  'opening', // the office's first turn to the CEO: found the company, draft the org
  'scoping-answers', // the stakeholder's answers to the CEO's scoping questions, in one message
  'company-start', // the org was approved: set the goal or propose the plan
  'plan-event', // plan approved, commented on, milestone reached, plan finished, proposal edited
  'stakeholder-message', // words the stakeholder typed
  'inbox-answer', // an answer to a question the person asked
  'approval-notice', // a "No to ..." on something the person asked to do
  'steering-note', // a task note or a reconsider request in the stakeholder's name
  'task-brief', // a new task: the office's brief or a manager's assign
  'task-update', // a task reopened, moved, paused, cancelled or handed back
  'relay', // a manager passed a message on
  'report-up', // a report or progress note from a person who reports to this one
  'question-up', // a question from someone below
  'review-return', // a manager returned the work with a note
  'message-down', // a message from someone above (their manager or the chain above): instructions, answers
  'message-up', // a message from someone below that is not a report or a question
  'message-side', // a message between people with no line between them
  'stall-nudge', // work stopped and nobody was at work
  'unreported-nudge', // a turn ended with its task open and no report
  'restart', // the office restarted or the person came back to their desk
  'handover', // the office asked for a handover (context grew large), or began a fresh desk after one
  'office-notice', // git or worktree news
  'other',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** The parts of a delivered message the office wrote around its words (turnText in company.ts). */
export interface Unfenced {
  header: string;
  body: string;
  messageId: string | null;
}

/** "From Ada (message m-4), between the two <fence> lines:\n<fence>\n<words>\n<fence>" into its header and words. */
export function unfence(text: string): Unfenced {
  const newline = text.indexOf('\n');
  const header = newline === -1 ? text : text.slice(0, newline);
  const id = /\(message (m-\d+)\)/.exec(header.slice(0, 600))?.[1] ?? null;
  const fence = /between the two ([A-Za-z0-9]{8,64}) lines:?$/.exec(header)?.[1];
  if (fence && newline !== -1) {
    const open = `\n${fence}\n`;
    const start = text.indexOf(open);
    const end = text.lastIndexOf(`\n${fence}`);
    if (start !== -1 && end > start) return { header: header.replace(/, between the two .*$/, ''), body: text.slice(start + open.length, end), messageId: id };
  }
  const colon = header.indexOf(': ');
  return colon === -1 ? { header, body: text, messageId: id } : { header: header.slice(0, colon), body: text.slice(colon + 2), messageId: id };
}

export type MessageFacts = Pick<Message, 'from' | 'to'> & Partial<Pick<Message, 'relayOf' | 'answers' | 'fromOffice' | 'typed' | 'text'>>;

/**
 * What began a turn, from the delivered words and, when the company's records still have it, the message itself. The
 * wording comes from the office's own writers: the opening and start turns (src/org/index.ts openingTurn, company.ts
 * begin), the scoping answers (company.ts "Answers to your scoping questions"), inbox answers (`on "...": ...`,
 * company.ts answer), denials ("No to ...", company.ts noteFor), plan notices (plan.ts), task briefs (board.ts handOut,
 * company.ts assignmentText), reports (reportText), returns (review), nudges (company.ts stall and unreportedTurn).
 */
export function classifyTrigger(text: string, message: MessageFacts | null, direction?: (from: string, to: string) => 'down' | 'up' | 'side'): Trigger {
  const { header, body } = unfence(text);
  const fromOffice = message ? message.from === THE_OFFICE : header.startsWith('From the office');
  const fromStakeholder = message ? message.from === STAKEHOLDER : /, the stakeholder\b/.test(header) || header.startsWith('From the stakeholder');
  const first = body.trimStart();
  if (fromOffice) {
    if (/^You are founding a new company/.test(first)) return 'opening';
    if (/started the company\. Everyone in the proposal is hired/.test(first)) return 'company-start';
    if (/^New task t-\d+/.test(first)) return 'task-brief';
    if (/^Work has stopped:/.test(first)) return 'stall-nudge';
    if (/turn ended with .* still under way and no report/s.test(first.slice(0, 300))) return 'unreported-nudge';
    if (/approved version \d+ of the plan|the plan is finished|is done: every task of the plan|went back to your own version|edited your proposal|^Version \d+ of the plan changes|^Milestone ms-\d+ ".*" is done\./s.test(first.slice(0, 300))) return 'plan-event';
    // v0.2: the office's own check sent a task back, or failed it for good: the same turn a review's return is.
    if (/came back: the office ran its check|failed the office's check/.test(first.slice(0, 300))) return 'review-return';
    if (/^Your context has grown large, so the office will give you a fresh desk|^You're on a fresh desk/.test(first)) return 'handover';
    if (/^The office restarted|^You're back at your desk/.test(first)) return 'restart';
    if (/couldn't be committed|couldn't keep the work|saved your earlier work|worktree/.test(first.slice(0, 400))) return 'office-notice';
    if (/is open again|is yours now|resumed tasks? |cancelled tasks? |paused task|was moved to|moved .*'s task|was fired|gave .* a task of their own|would like to start|undid its cancel/.test(first.slice(0, 400))) return 'task-update';
    return 'other';
  }
  if (fromStakeholder) {
    if (/^Answers to your scoping questions/.test(first)) return 'scoping-answers';
    if (message?.answers || (message?.fromOffice === true && /^on "/.test(first)) || /^on ".*": /s.test(first.slice(0, 400))) return 'inbox-answer';
    if (/^No to "/.test(first)) return 'approval-notice';
    if (/^A comment on the plan/.test(first)) return 'plan-event';
    if (/^On t-\d+, /.test(first) || /^Please reconsider your decision/.test(first)) return 'steering-note';
    if (message?.fromOffice === true) return 'other';
    return 'stakeholder-message';
  }
  if (message?.relayOf || /passing on from/.test(header)) return 'relay';
  if (/^(Report on task|Progress on task|Report \(|Progress:)/.test(first)) return 'report-up';
  if (/^A question for you:/.test(first)) return 'question-up';
  if (/came back from review/.test(first.slice(0, 200))) return 'review-return';
  if (/^New task t-\d+/.test(first)) return 'task-brief';
  const way = message && direction ? direction(message.from, message.to) : 'side';
  return way === 'down' ? 'message-down' : way === 'up' ? 'message-up' : 'message-side';
}

// ---------------------------------------------------------------------------------------------------------------
// What a turn did

export const WORKS = ['planning', 'briefing', 'relaying', 'deciding', 'making', 'checking', 'reporting', 'idle'] as const;
export type Work = (typeof WORKS)[number];

const ORG = 'mcp__org__';
const PLANNING = new Set(['propose_org', 'propose_plan', 'set_goal', 'ask_scoping', 'change_office', 'change_settings', 'hire', 'fire', 'move', 'rehire', 'publish_dashboard', 'remove_dashboard', 'library_catalogue', 'ask_stakeholder']);
const DECIDING = new Set(['review', 'decide', 'steer_task', 'approve_plan']);
const REPORTING = new Set(['report', 'message', 'ask', 'share_screenshot']);
/** Org tools that are checking work in themselves: the final review's verdicts on the checklist. */
const CHECKING = new Set(['mark_checklist']);
const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'ToolSearch', 'Skill', 'TaskList', 'TaskGet', 'ListAgents', 'WebFetch', 'WebSearch']);
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TESTING = /\b(?:test|tests|vitest|jest|playwright|pytest|mocha|tsc|typecheck|lint|eslint|build|check|astro check|e2e|curl|wrangler dev)\b/i;
/** A role that checks other people's work, as the house rules name it (src/company/house-rules.ts CHECKS_WORK). */
export const CHECKS_WORK = /\b(?:qa|quality|tester|testing|reviewer|review|auditor)\b/i;

const orgTool = (name: string): string | null => (name.startsWith(ORG) ? name.slice(ORG.length) : null);

/**
 * What a turn did, from its tool calls: planning (org, goal, plan), briefing (assign), relaying (relay), deciding
 * (review, decide, steer), making (edits and commands that build), checking (the final review's mark_checklist, tests,
 * browsers, or any work by a reviewer or tester), reporting (reports, messages and questions only) and idle (no calls, or only reads and status
 * lines, with nothing new said). The first that applies wins in that order, except that a checker's turn that edited
 * and ran tests is checking, and a builder's turn that edited is making.
 */
export function classifyWork(tools: readonly ToolUse[], person: Pick<Person, 'id' | 'title'>): Work {
  const org = new Set<string>();
  let edits = 0;
  let commands = 0;
  let testing = 0;
  let browsing = 0;
  let reads = 0;
  let other = 0;
  for (const t of tools) {
    const o = orgTool(t.name);
    if (o !== null) org.add(o);
    else if (EDITS.has(t.name)) edits += 1;
    else if (t.name === 'Bash' || t.name === 'PowerShell') {
      commands += 1;
      if (t.command && TESTING.test(t.command)) testing += 1;
    } else if (READS.has(t.name)) reads += 1;
    else if (/chrome|playwright|browser|devtools/i.test(t.name)) browsing += 1;
    else other += 1;
  }
  const has = (set: ReadonlySet<string>): boolean => [...org].some((n) => set.has(n));
  if (has(PLANNING)) return 'planning';
  if (org.has('assign')) return 'briefing';
  if (has(CHECKING)) return 'checking';
  const checker = CHECKS_WORK.test(person.id) || CHECKS_WORK.test(person.title);
  if (checker && (testing > 0 || browsing > 0 || edits + commands + reads > 0)) return edits > 0 && testing === 0 && browsing === 0 ? 'making' : 'checking';
  if (edits > 0) return 'making';
  if (testing > 0 || browsing > 0) return 'checking';
  if (commands > 0 || other > 0) return 'making';
  if (org.has('relay')) return 'relaying';
  if (has(DECIDING)) return 'deciding';
  if (has(REPORTING)) return 'reporting';
  // What is left is reads and the quiet org tools (ack, post_status, tasks, org, stakeholder_words): nothing new said.
  return 'idle';
}

// ---------------------------------------------------------------------------------------------------------------
// One turn, with its numbers

export interface CallStat {
  model: string;
  usage: TokenUsage;
  ctx: number;
  cost: number;
  fast: boolean;
  usOnly: boolean;
  sub: boolean;
}

export interface TurnStat {
  person: string;
  session: string;
  /** The turn's number in its session, from 0. */
  n: number;
  at: number;
  trigger: Trigger;
  work: Work;
  messageId: string | null;
  /** What was folded into this turn while it was under way. */
  folded: Trigger[];
  /** Milliseconds from the end of the desk's previous turn to the start of this one; null for its first. */
  gapMs: number | null;
  tools: Record<string, number>;
  usage: TokenUsage;
  cost: number;
  /** Tokens of calls whose model the price table doesn't know (their cost is left out). */
  unpricedTokens: number;
  calls: CallStat[];
}

export interface PersonInfo {
  id: string;
  title: string;
  level: Person['level'];
  reportsTo?: string | null;
}

export interface Desk {
  person: PersonInfo;
  session: string;
  /** The model that took most of the requests. */
  model: string;
  /** The first request: everything the desk carries before it has done anything. */
  first: { prompt: number; input: number; cacheWrite: number; cacheRead: number; cost: number } | null;
  /** The share of that first request, in tokens (estimated from characters), by what it holds. */
  overhead: Record<string, number>;
  shape: SessionShape | null;
  attachments: Record<string, number>;
}

export const sumUsage = (calls: readonly CallStat[]): TokenUsage => calls.reduce((u, c) => addUsage(u, c.usage), ZERO_USAGE);

const cacheWrite = (u: TokenUsage): number => u.cacheWrite5m + u.cacheWrite1h;
const promptOf = (u: TokenUsage): number => u.input + u.cacheRead + cacheWrite(u);

function callStat(c: Call): CallStat {
  const price = costOf(c.model, c.usage, { fast: c.fast, usOnly: c.usOnly });
  return { model: c.model, usage: c.usage, ctx: promptOf(c.usage), cost: price ?? 0, fast: c.fast, usOnly: c.usOnly, sub: c.sub };
}

/** How the first request's tokens divide, by what Claude Code and the office put in front of the first message. */
export function overheadShares(shape: SessionShape | null, attachments: Record<string, number>, promptTokens: number): Record<string, number> {
  const chars: Record<string, number> = Object.create(null) as Record<string, number>;
  const add = (k: string, n: number): void => {
    if (n > 0) chars[k] = (chars[k] ?? 0) + n;
  };
  if (shape) {
    add('role prompt', shape.roleChars);
    add('house rules', shape.houseChars);
    for (const t of shape.tools) {
      const org = orgTool(t.name);
      if (org !== null) add('org tools', t.chars);
      else if (t.name.startsWith('mcp__')) add(`mcp tools (${t.name.split('__')[1] ?? '?'})`, t.chars);
      else add('built-in tools', t.chars);
    }
  }
  const names: Record<string, string> = {
    skill_listing: 'skill list',
    deferred_tools_delta: 'deferred tool names',
    agent_listing_delta: 'agent list',
    mcp_instructions_delta: 'mcp server instructions',
    instructions: 'CLAUDE.md and rules',
    hook_additional_context: 'session-start hook text',
  };
  for (const [type, n] of Object.entries(attachments)) add(Object.hasOwn(names, type) ? (names[type] ?? type) : 'other', n);
  const total = Object.values(chars).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  if (total === 0) return out;
  for (const [k, n] of Object.entries(chars)) out[k] = Math.round((n / total) * promptTokens);
  return out;
}

export interface SessionInput {
  person: PersonInfo;
  session: string;
  parsed: ParsedSession;
  /** The company's message with this id, when its records still have it. */
  message: (id: string) => MessageFacts | null;
  /** How a message's sender stands to its receiver in the org; sideways when unknown. */
  direction?: (from: string, to: string) => 'down' | 'up' | 'side';
}

/** Turns a parsed desk transcript into its desk and its turns. */
export function analyseSession(input: SessionInput): { desk: Desk; turns: TurnStat[] } {
  const { person, session, parsed } = input;
  const turns: TurnStat[] = parsed.turns.map((t, n) => {
    const { messageId } = unfence(t.began.text);
    const facts = messageId ? input.message(messageId) : null;
    const trigger: Trigger = t.began.text === '' ? 'other' : classifyTrigger(t.began.text, facts, input.direction);
    const folded = t.folded.map((f) => {
      const id = unfence(f.text).messageId;
      return classifyTrigger(f.text, id ? input.message(id) : null, input.direction);
    });
    const calls = t.calls.map(callStat);
    const tools: Record<string, number> = Object.create(null) as Record<string, number>;
    const uses = t.calls.flatMap((c) => c.tools);
    for (const u of uses) tools[u.name] = (tools[u.name] ?? 0) + 1;
    return {
      person: person.id,
      session,
      n,
      at: t.began.at,
      trigger,
      work: classifyWork(uses, person),
      messageId,
      folded,
      gapMs: n === 0 ? null : Math.max(0, t.began.at - (parsed.turns[n - 1]?.endedAt ?? t.began.at)),
      tools,
      usage: sumUsage(calls),
      cost: calls.reduce((a, c) => a + c.cost, 0),
      unpricedTokens: t.calls.filter((c) => !knownModel(c.model)).reduce((a, c) => a + totalTokens(c.usage), 0),
      calls,
    };
  });
  const all = turns.flatMap((t) => t.calls).filter((c) => !c.sub);
  const first = all[0] ?? null;
  const byModel = new Map<string, number>();
  for (const c of all) byModel.set(c.model, (byModel.get(c.model) ?? 0) + 1);
  const model = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const desk: Desk = {
    person,
    session,
    model,
    first: first ? { prompt: first.ctx, input: first.usage.input, cacheWrite: cacheWrite(first.usage), cacheRead: first.usage.cacheRead, cost: first.cost } : null,
    overhead: first ? overheadShares(parsed.shape, parsed.attachments, first.ctx) : (Object.create(null) as Record<string, number>),
    shape: parsed.shape,
    attachments: parsed.attachments,
  };
  return { desk, turns };
}

// ---------------------------------------------------------------------------------------------------------------
// Adding turns up

export interface Bucket {
  turns: number;
  calls: number;
  usage: TokenUsage;
  cost: number;
  /** Sum of every request's prompt size, for the average, and the largest one. */
  ctxSum: number;
  ctxMax: number;
  unpricedTokens: number;
}

export const emptyBucket = (): Bucket => ({ turns: 0, calls: 0, usage: ZERO_USAGE, cost: 0, ctxSum: 0, ctxMax: 0, unpricedTokens: 0 });

export function addTurn(b: Bucket, t: TurnStat): void {
  b.turns += 1;
  const own = t.calls.filter((c) => !c.sub);
  b.calls += own.length;
  b.usage = addUsage(b.usage, t.usage);
  b.cost += t.cost;
  b.unpricedTokens += t.unpricedTokens;
  for (const c of own) {
    b.ctxSum += c.ctx;
    b.ctxMax = max(b.ctxMax, c.ctx);
  }
}

export function group<K extends string>(turns: readonly TurnStat[], key: (t: TurnStat) => K): Map<K, Bucket> {
  const out = new Map<K, Bucket>();
  for (const t of turns) {
    const k = key(t);
    let b = out.get(k);
    if (!b) out.set(k, (b = emptyBucket()));
    addTurn(b, t);
  }
  return out;
}

export const total = (turns: readonly TurnStat[]): Bucket => {
  const b = emptyBucket();
  for (const t of turns) addTurn(b, t);
  return b;
};

/** Cache reads as a share of every prompt token (input, writes and reads). */
export const cachedShare = (u: TokenUsage): number => {
  const p = promptOf(u);
  return p === 0 ? 0 : u.cacheRead / p;
};

export type Role = 'ceo' | 'manager' | 'checker' | 'maker';

/** A person's part in the company: the CEO, a head or lead, someone who checks others' work, or someone who makes. */
export function roleOf(p: PersonInfo): Role {
  if (p.level === 'ceo' || p.id === 'ceo') return 'ceo';
  if (isManager({ level: p.level })) return 'manager';
  return CHECKS_WORK.test(p.id) || CHECKS_WORK.test(p.title) ? 'checker' : 'maker';
}

// ---------------------------------------------------------------------------------------------------------------
// What-ifs: how much a change would have saved on the turns that were measured. Estimates, not forecasts.

/** What the same calls would have cost on another model, at that model's list prices. */
export function repriced(calls: readonly CallStat[], model: string): number {
  return calls.reduce((a, c) => a + (costOf(model, c.usage, { fast: false, usOnly: c.usOnly }) ?? c.cost), 0);
}

/**
 * Dollars saved if every task began in a fresh session: the context a desk carried in from earlier tasks is read from the
 * cache on every request, so dropping it saves those reads, less the cost of writing the desk's fixed prompt again once
 * per task (priced as a one-hour cache write). `carried` is what the desk held before each task began, minus its fixed
 * prompt; `fixedWritten` is the part of the fixed prompt the first request had to write (the rest was already cached
 * by another desk). A task begins at a task-brief turn.
 */
export function freshSessionSavings(turnsOfDesk: readonly TurnStat[], fixedPrompt: number, fixedWritten: number = fixedPrompt): { saved: number; segments: number; carriedTokens: number } {
  let carried = 0;
  let saved = 0;
  let segments = 0;
  let carriedTokens = 0;
  let lastCtx = fixedPrompt;
  for (const t of turnsOfDesk) {
    if (t.trigger === 'task-brief' && lastCtx - fixedPrompt > 0 && t.n > 0) {
      carried = lastCtx - fixedPrompt;
      segments += 1;
      const model = t.calls.find((c) => !c.sub)?.model ?? '';
      const write = costOf(model, { ...ZERO_USAGE, cacheWrite1h: fixedWritten }) ?? 0;
      saved -= write;
    }
    for (const c of t.calls) {
      if (c.sub) continue;
      if (carried > 0) {
        const r = costOf(c.model, { ...ZERO_USAGE, cacheRead: Math.min(carried, c.usage.cacheRead) }) ?? 0;
        saved += r;
        carriedTokens += Math.min(carried, c.usage.cacheRead);
      }
      lastCtx = c.ctx;
    }
  }
  return { saved, segments, carriedTokens };
}

export { canonicalModel };
