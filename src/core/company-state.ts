// The state of a company the office runs, and the reducer over its events. Every change is an event: the company
// signs it and appends it to .worklings/events.jsonl before acting on it (src/company/store.ts), and opening the
// company folds the log back into this state. Pure and free of Node APIs, like the rest of src/core.
import {
  type Approval,
  type CompanyLooks,
  type CompanyPhase,
  type CompanySettings,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_DESKS,
  type Goal,
  type LogEntry,
  LOOK_GAP_MS,
  type Message,
  type Pause,
  PHASES,
  type Question,
  type Report,
  type Screenshot,
  type SpendSample,
  STAKEHOLDER,
  type StatusLine,
  type Task,
  type TaskCheck,
  type TaskLook,
  type TaskNote,
  type TaskStatus,
  THE_OFFICE,
} from './company.ts';
import type { Dashboard } from './dashboard.ts';
import type { OrgProposal } from './org.ts';
import { type CompanyShape, isCompanyShape } from './harness-shape.ts';
import { cleanLaunch, type PlainLaunch } from './plain.ts';
import { DEFAULT_PRESET, isPresetId, MODEL_LEVELS, presetModels, PRESETS } from './presets.ts';
import { cleanBudget } from './spending.ts';
import { ROLE_MODELS, type RoleModel } from './studio.ts';
import type { Ack } from './steering.ts';
import { blankSteering, foldSteering, isSteeringEvent, reviveSteering, STEERING_EVENT_TYPES, type SteeringEvent, type SteeringState } from './steering-state.ts';
import { type DeliveredHow, foldTrace, reviveAcks, TRACE_EVENT_TYPES, type TraceEvent, withDelivery } from './trace-state.ts';

export const STATE_VERSION = 1;

/** A record keyed by ids from outside (person, message and task ids): no prototype, so "constructor" is just a key. */
export const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/** The value under an own key, never one inherited from Object.prototype. */
export const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

const copyDict = <T>(record: Readonly<Record<string, T>>): Record<string, T> => Object.assign(dict<T>(), record);

/** How many entries of each list the state keeps, oldest dropped first (never an undelivered message or an open item). */
export const STATE_LIMITS = { messages: 5_000, statuses: 2_000, reports: 1_000, spend: 5_000, log: 2_000, questions: 500, approvals: 500, screenshots: 100 } as const;

export const HOUR_MS = 3_600_000;
/** How many session ids a desk's record keeps: handovers give a person several, and accounting reads transcripts by them. */
export const SESSIONS_KEPT = 60;
/** Hourly spend is kept this long: a week for the Spend dashboard, plus a day. */
export const SPEND_HOURS_KEPT = 8 * 24;

/** What the company keeps about each person's desk between restarts. */
export interface DeskRecord {
  /** Their Claude Code session, resumed on their next turn. */
  sessionId: string | null;
  /** Every session they have had, oldest first, so the office can show their transcripts as them. */
  sessions: string[];
  /** Dollars so far, from the turns that ended. */
  cost: number;
  /**
   * Dollars the person's transcripts show beyond `cost`: a turn still going (or killed by a restart) is priced only when
   * it ends. Kept so a reopened company reads what it read before, until the next ended turn prices it (and resets this).
   */
  unpriced: number;
  /** The latest prompt's size. */
  contextTokens: number | null;
  lastTurnAt: number | null;
  /** In a turn when the office last heard: a restart gives them a turn to carry on. */
  busy: boolean;
  /** Handed over to the stakeholder's own Claude Code since then; null while the office runs their desk. */
  awaySince: number | null;
  /** v0.2: fresh pages so far: how many times the office closed this desk at a handover and began a new session. */
  fresh: number;
  /** v0.2: turns taken on the current page; a handover starts it again at 0. */
  turns: number;
  /** v0.2: a handover the office asked for and the person hasn't finished; null otherwise. */
  handover: { messageId: string; at: number; tokens: number } | null;
  /** v0.2: set at a handover until the new page's first turn ends: its turns point at the handover notes. */
  freshFrom: HandoverBy | null;
  /** v0.2: the handovers so far, newest last: the context before, and after the new page's first turn (null until then). */
  handovers: HandoverNote[];
}

/** Who wrote the notes a handover leaves: the person, or the office from its records when they wrote none. */
export type HandoverBy = 'person' | 'office';
export interface HandoverNote {
  at: number;
  by: HandoverBy;
  /** The context size when the old page ended; null when the desk never reported one. */
  before: number | null;
  /** The context size at the end of the new page's first turn; null until then. */
  after: number | null;
}
/** How many handovers a desk's record keeps. */
export const HANDOVERS_KEPT = 30;

export type Worktree = NonNullable<Task['worktree']>;
/** A proposal kept beside the log, in .worklings/proposals/<n>.json: its number and the SHA-256 of its text. */
export interface ProposalRef {
  n: number;
  hash: string;
}
/** making: git is making a task's worktree. waiting: the work branch needs its first commit before git can. */
export type WorktreeWait = 'making' | 'waiting';

/** Spend in one hour, per person. */
export interface SpendHour {
  hour: number;
  byPerson: Record<string, number>;
}

/** How the CEO's drafting of the org goes while the company is founding. */
export interface Drafting {
  /** Drafts the office turned down, and the first one's reason. */
  refused: number;
  firstRefusal: string | null;
  /** The CEO's turn ended without a proposal, with its last words; null again once a message reaches the CEO. */
  stopped: { person: string; at: number; words: string } | null;
}

const blankDrafting = (): Drafting => ({ refused: 0, firstRefusal: null, stopped: null });

/** The CEO's scoping questions (ask_scoping): which they are, when asked, and when the answers went to the CEO. */
export interface Scoping {
  questions: string[];
  askedAt: number;
  /** When the answers went to the CEO in one message; null until then. */
  answeredAt: number | null;
}

export const ID_KINDS = ['task', 'message', 'question', 'approval', 'report', 'dashboard', 'screenshot', 'milestone'] as const;
export type IdKind = (typeof ID_KINDS)[number];
/** Ids are a prefix and a number ("t-12"): short in addresses, and safe as file names and in URLs. */
export const ID_PREFIX: Readonly<Record<IdKind, string>> = { task: 't', message: 'm', question: 'q', approval: 'a', report: 'r', dashboard: 'd', screenshot: 's', milestone: 'ms' };

export interface CompanyState {
  version: typeof STATE_VERSION;
  id: string;
  name: string;
  /** The folder when the company was founded; the company runs wherever it is opened. */
  root: string;
  prompt: string;
  stakeholder: string;
  /** v0.4 (SPEC-v0.4.md, H1): the seats of a harness, or v0.3's job titles; companies founded before v0.4 are classic. */
  shape: CompanyShape;
  /** v0.7: a plain company's launch choices; everything null (Claude Code's own defaults) for other shapes. */
  launch: PlainLaunch;
  createdAt: number;
  phase: CompanyPhase;
  branch: string | null;
  /** v0.2: the commit the work branch started from, so the final review can diff what the company changed; null when unknown. */
  branchBase: string | null;
  goal: Goal | null;
  /** When the plan was finished (every task and milestone done); null while work is open (src/company/company.ts). */
  done: number | null;
  /** The proposal as it stands: the CEO's, or the stakeholder's edit of it. */
  proposal: OrgProposal | null;
  /** The CEO's own version, for "Back to the CEO's version". */
  ceoProposal: OrgProposal | null;
  proposalEdited: boolean;
  /** The questions that came with the current proposal. */
  proposalQuestions: string[];
  /** The CEO's scoping questions, asked before it drafted the org; null when it asked none. */
  scoping: Scoping | null;
  /** How many proposals have been kept beside the log, the CEO's and the stakeholder's edits. */
  proposalCount: number;
  drafting: Drafting;
  tasks: Task[];
  /** The message that handed each task to its owner (message id to task id): delivering it starts the task. */
  assignments: Record<string, string>;
  /**
   * Tasks whose worktree git is making, or which wait for the work branch's first commit before git can (task id to
   * which). Their owner's turn waits too.
   */
  worktreeWaits: Record<string, WorktreeWait>;
  /** Accepted tasks whose commit or merge git is making (task id to whom to tell if it fails). */
  commitWaits: Record<string, string>;
  /** Merged worktrees that go once their owner's desk can close (task id to the owner and the worktree). */
  retiring: Record<string, { person: string; worktree: Worktree }>;
  messages: Message[];
  /** Each person's acknowledgement of a message sent to them, one per message, oldest first (trace-state.ts). */
  acks: Ack[];
  /** The plan, the board's steering, the leash and the decision log (steering-state.ts). */
  steering: SteeringState;
  questions: Question[];
  approvals: Approval[];
  /** Answers and decisions that reached their person (id to when). */
  applied: Record<string, number>;
  statuses: StatusLine[];
  reports: Report[];
  dashboards: Dashboard[];
  screenshots: Screenshot[];
  spend: SpendSample[];
  spendHours: SpendHour[];
  log: LogEntry[];
  pause: Pause | null;
  settings: CompanySettings;
  desks: Record<string, DeskRecord>;
  /** People the stakeholder has written to (person to when), who may write back. */
  wroteTo: Record<string, number>;
  /** When the stakeholder last opened each person's conversation. */
  seen: Record<string, number>;
  /** v0.2: when the stakeholder last opened the company, and the last look of the visit before (src/core/overview.ts). */
  looked: CompanyLooks;
  counters: Record<IdKind, number>;
}

export type FoundedEvent = { type: 'founded'; id: string; name: string; root: string; prompt: string; stakeholder: string; at: number; shape?: CompanyShape; launch?: PlainLaunch };

/** Every change to a company. A batch is one line in the log, so a change of several parts lands whole or not at all. */
export type CompanyEvent =
  | FoundedEvent
  | { type: 'batch'; events: CompanyEvent[] }
  | { type: 'named'; name: string }
  | { type: 'phase'; phase: CompanyPhase }
  | { type: 'branch'; branch: string | null; base?: string | null }
  /** The CEO's scoping questions, asked before it drafts the org. */
  | { type: 'scoping'; questions: Question[]; at: number }
  /** The answers to them went to the CEO, in one message. */
  | { type: 'scoped'; at: number }
  | { type: 'proposal'; proposal: OrgProposal; questions: Question[]; ref?: ProposalRef }
  | { type: 'proposal-edited'; proposal: OrgProposal; ref?: ProposalRef }
  | { type: 'proposal-restored' }
  | { type: 'draft-refused'; reason: string; at: number }
  | { type: 'draft-stopped'; person: string; words: string; at: number }
  | { type: 'goal'; goal: Goal; at: number }
  | { type: 'message'; message: Message }
  /** `how`: taken at the person's next step or as a new turn, when the switchboard said. */
  | { type: 'delivered'; id: string; at: number; how?: DeliveredHow }
  | { type: 'unsent'; id: string }
  | { type: 'question'; question: Question }
  | { type: 'answer'; id: string; answer: NonNullable<Question['answer']> }
  | { type: 'approval'; approval: Approval }
  | { type: 'decision'; id: string; answer: NonNullable<Approval['answer']> }
  | { type: 'undo'; id: string }
  | { type: 'applied'; id: string; at: number }
  | { type: 'withdrawn'; id: string; reason: string; at: number }
  | { type: 'status'; status: StatusLine }
  | { type: 'report'; report: Report }
  | { type: 'task'; task: Task; messageId: string | null; wantsWorktree?: boolean }
  | { type: 'task-status'; id: string; status: TaskStatus; at: number; outcome?: string | null }
  /** A turn ended with the task under way and no report: its last words, kept on the task. */
  | { type: 'task-note'; id: string; note: TaskNote }
  | { type: 'task-check'; id: string; check: TaskCheck }
  /** v0.3: the office's look at the running app before a review, as it starts and when it is done. */
  | { type: 'task-look'; id: string; look: TaskLook }
  /** The plan finished (`at`), or work came in again after it had (null). */
  | { type: 'plan-done'; at: number | null }
  | { type: 'worktree'; id: string; worktree: Worktree | null; waiting?: boolean }
  | { type: 'commit-wait'; id: string; by: string }
  | { type: 'commit'; id: string; commit: string | null }
  | { type: 'retire'; id: string; person: string; worktree: Worktree }
  | { type: 'retired'; id: string }
  | { type: 'dashboard'; dashboard: Dashboard }
  | { type: 'dashboard-removed'; id: string }
  | { type: 'screenshot'; screenshot: Screenshot }
  | { type: 'session'; person: string; sessionId: string }
  | { type: 'turn'; person: string; cost: number; contextTokens: number | null; at: number }
  /** v0.2: the office asked a person to write a handover (message `messageId`) at `tokens` of context. */
  | { type: 'handover-asked'; person: string; messageId: string; at: number; tokens: number }
  /** v0.2: the person's desk was closed and their session dropped: the next turn starts a new one, at the notes. */
  | { type: 'handover'; person: string; by: HandoverBy; at: number; tokens: number | null }
  | { type: 'spent'; person: string; unpriced: number }
  | { type: 'busy'; person: string; busy: boolean }
  | { type: 'away'; person: string; since: number | null }
  | { type: 'pause'; pause: Pause | null }
  | { type: 'settings'; settings: CompanySettings }
  | { type: 'seen'; person: string; at: number }
  /** v0.2: the stakeholder looked at the company. */
  | { type: 'looked'; at: number }
  | { type: 'log'; entry: LogEntry }
  | TraceEvent
  | SteeringEvent;

export type CompanyEventType = CompanyEvent['type'];

export const EVENT_TYPES: readonly CompanyEventType[] = [
  'founded', 'batch', 'named', 'phase', 'branch', 'scoping', 'scoped', 'proposal', 'proposal-edited', 'proposal-restored', 'draft-refused', 'draft-stopped', 'goal', 'message', 'delivered', 'unsent',
  'question', 'answer', 'approval', 'decision', 'undo', 'applied', 'withdrawn', 'status', 'report', 'task', 'task-status', 'task-note', 'task-check', 'task-look', 'plan-done', 'worktree',
  'commit-wait', 'commit', 'retire', 'retired', 'dashboard', 'dashboard-removed', 'screenshot', 'session', 'turn', 'handover-asked', 'handover', 'spent', 'busy', 'away', 'pause',
  'settings', 'seen', 'looked', 'log',
  ...TRACE_EVENT_TYPES,
  ...STEERING_EVENT_TYPES,
];

/** A new company starts on Balanced: its desks at once and its models by level (src/core/presets.ts), and no budget. */
export const defaultSettings = (): CompanySettings => ({
  maxDesks: PRESETS[DEFAULT_PRESET].desks, idleMs: DEFAULT_IDLE_MS, billing: 'plan', alwaysAllow: [], preset: DEFAULT_PRESET, models: presetModels(DEFAULT_PRESET), budget: { company: null, person: null },
});

const zeroCounters = (): Record<IdKind, number> => ({ task: 0, message: 0, question: 0, approval: 0, report: 0, dashboard: 0, screenshot: 0, milestone: 0 });

export const blankDesk = (): DeskRecord => ({ sessionId: null, sessions: [], cost: 0, unpriced: 0, contextTokens: null, lastTurnAt: null, busy: false, awaySince: null, fresh: 0, turns: 0, handover: null, freshFrom: null, handovers: [] });

export function foundedState(e: FoundedEvent): CompanyState {
  return {
    version: STATE_VERSION,
    id: e.id,
    name: e.name,
    root: e.root,
    prompt: e.prompt,
    shape: isCompanyShape(e.shape) ? e.shape : 'classic',
    launch: cleanLaunch(e.launch),
    stakeholder: e.stakeholder,
    createdAt: e.at,
    phase: 'founding',
    branch: null,
    branchBase: null,
    goal: null,
    done: null,
    proposal: null,
    ceoProposal: null,
    proposalEdited: false,
    proposalQuestions: [],
    scoping: null,
    proposalCount: 0,
    drafting: blankDrafting(),
    tasks: [],
    assignments: dict(),
    worktreeWaits: dict(),
    commitWaits: dict(),
    retiring: dict(),
    messages: [],
    acks: [],
    // A company from before steering runs with plan approval off; a new one's founding sets the default.
    steering: blankSteering(),
    questions: [],
    approvals: [],
    applied: dict(),
    statuses: [],
    reports: [],
    dashboards: [],
    screenshots: [],
    spend: [],
    spendHours: [],
    log: [],
    pause: null,
    settings: defaultSettings(),
    desks: dict(),
    wroteTo: dict(),
    seen: dict(),
    looked: { last: null, previous: null },
    counters: zeroCounters(),
  };
}

/** Tasks someone still owns: their files can't go to anyone else. */
export const OPEN_TASK: readonly TaskStatus[] = ['queued', 'working', 'blocked', 'review'];
export const isOpenTask = (t: Pick<Task, 'status'>): boolean => OPEN_TASK.includes(t.status);

/** An item still waiting on the stakeholder, or answered but inside its undo window. */
export const isPending = (state: Pick<CompanyState, 'applied'>, item: Question | Approval): boolean =>
  item.withdrawn === null && own(state.applied, item.id) === undefined;

/** A question or approval nobody has answered yet: what the inbox counts. */
export function isOpenItem(item: Question | Approval, now: number): boolean {
  if (item.answer !== null || item.withdrawn !== null) return false;
  return !('expiresAt' in item) || item.expiresAt > now;
}

const newest = <T>(list: T[], max: number): T[] => (list.length > max ? list.slice(list.length - max) : list);

/** Drops the oldest entries `done` says may go until the list fits; the others stay whatever the count. */
function trim<T>(list: T[], max: number, done: (item: T) => boolean): T[] {
  let excess = list.length - max;
  if (excess <= 0) return list;
  return list.filter((item) => {
    if (excess > 0 && done(item)) {
      excess -= 1;
      return false;
    }
    return true;
  });
}

/** The number in an id like "t-12", so the counters stay ahead of every id in the log. */
function idNumber(id: string): number {
  const m = /-(\d{1,12})$/.exec(id);
  return m ? Number(m[1]) : 0;
}

function bump(counters: CompanyState['counters'], kind: IdKind, ids: readonly string[]): CompanyState['counters'] {
  const n = Math.max(counters[kind], ...ids.map(idNumber));
  return n > counters[kind] ? { ...counters, [kind]: n } : counters;
}

function withDesk(state: CompanyState, person: string, change: (desk: DeskRecord) => DeskRecord): CompanyState {
  const desks = copyDict(state.desks);
  desks[person] = change(own(state.desks, person) ?? blankDesk());
  return { ...state, desks };
}

function withEntry<T>(record: Readonly<Record<string, T>>, key: string, value: T): Record<string, T> {
  const copy = copyDict(record);
  copy[key] = value;
  return copy;
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = copyDict(record);
  delete copy[key];
  return copy;
}

const pushLog = (state: CompanyState, entries: LogEntry[]): LogEntry[] => newest([...state.log, ...entries], STATE_LIMITS.log);

/**
 * A milestone is done when it has tasks and all of them are done or dropped. Worked out after every change to the
 * tasks or the goal, so a replay gets the same answer; a task added later reopens it.
 */
function settleMilestones(state: CompanyState, at: number): CompanyState {
  const goal = state.goal;
  if (!goal) return state;
  const entries: LogEntry[] = [];
  let changed = false;
  const milestones = goal.milestones.map((m) => {
    const tasks = state.tasks.filter((t) => t.milestone === m.id);
    const done = tasks.length > 0 && tasks.every((t) => t.status === 'done' || t.status === 'dropped');
    if (done && m.doneAt === null) {
      changed = true;
      entries.push({ at, kind: 'milestone', by: THE_OFFICE, text: `Milestone done: ${m.title}.` });
      return { ...m, doneAt: at };
    }
    if (!done && m.doneAt !== null) {
      changed = true;
      return { ...m, doneAt: null };
    }
    return m;
  });
  return changed ? { ...state, goal: { ...goal, milestones }, log: pushLog(state, entries) } : state;
}

function addSpend(hours: SpendHour[], person: string, cost: number, at: number): SpendHour[] {
  const hour = Math.floor(at / HOUR_MS) * HOUR_MS;
  const kept = hours.filter((h) => h.hour > hour - SPEND_HOURS_KEPT * HOUR_MS);
  const i = kept.findIndex((h) => h.hour === hour);
  const bucket = i >= 0 ? kept[i] : undefined;
  const before = bucket ? (own(bucket.byPerson, person) ?? 0) : 0;
  const byPerson = withEntry(bucket?.byPerson ?? dict<number>(), person, before + cost);
  if (i >= 0) return kept.map((h, j) => (j === i ? { hour, byPerson } : h));
  return [...kept, { hour, byPerson }].sort((a, b) => a.hour - b.hour);
}

function closedItem(state: CompanyState) {
  return (item: Question | Approval): boolean => item.withdrawn !== null || own(state.applied, item.id) !== undefined;
}

/** Folds one event into the state. Pure: the state passed in is never changed, and unknown events change nothing. */
export function fold(state: CompanyState, event: CompanyEvent): CompanyState {
  if (isSteeringEvent(event)) return foldSteering(state, event);
  switch (event.type) {
    case 'batch':
      return event.events.reduce(fold, state);
    case 'founded':
      return state;
    case 'named':
      return { ...state, name: event.name };
    case 'phase':
      return { ...state, phase: event.phase };
    case 'branch':
      return { ...state, branch: event.branch, branchBase: event.base ?? null };
    case 'scoping':
      return {
        ...state,
        scoping: { questions: event.questions.map((q) => q.id), askedAt: event.at, answeredAt: null },
        questions: trim([...state.questions, ...event.questions], STATE_LIMITS.questions, closedItem(state)),
        counters: bump(state.counters, 'question', event.questions.map((q) => q.id)),
      };
    case 'scoped':
      return state.scoping ? { ...state, scoping: { ...state.scoping, answeredAt: event.at } } : state;
    case 'proposal':
      return {
        ...state,
        name: event.proposal.company || state.name,
        proposal: event.proposal,
        ceoProposal: event.proposal,
        proposalEdited: false,
        proposalQuestions: event.questions.map((q) => q.id),
        proposalCount: Math.max(state.proposalCount, event.ref?.n ?? 0),
        questions: trim([...state.questions, ...event.questions], STATE_LIMITS.questions, closedItem(state)),
        counters: bump(state.counters, 'question', event.questions.map((q) => q.id)),
      };
    case 'proposal-edited':
      return {
        ...state,
        name: event.proposal.company || state.name,
        proposal: event.proposal,
        proposalEdited: true,
        proposalCount: Math.max(state.proposalCount, event.ref?.n ?? 0),
      };
    case 'proposal-restored':
      return state.ceoProposal ? { ...state, name: state.ceoProposal.company || state.name, proposal: state.ceoProposal, proposalEdited: false } : state;
    case 'draft-refused': {
      const d = state.drafting;
      return { ...state, drafting: { ...d, refused: d.refused + 1, firstRefusal: d.firstRefusal ?? event.reason } };
    }
    case 'draft-stopped':
      return { ...state, drafting: { ...state.drafting, stopped: { person: event.person, at: event.at, words: event.words } } };
    case 'goal': {
      const counters = bump(state.counters, 'milestone', event.goal.milestones.map((m) => m.id));
      return settleMilestones({ ...state, goal: event.goal, counters }, event.at);
    }
    case 'message': {
      const m = event.message;
      const messages = trim([...state.messages, m], STATE_LIMITS.messages, (x) => x.deliveredAt !== null);
      const wroteTo = m.from === STAKEHOLDER && m.to !== STAKEHOLDER ? withEntry(state.wroteTo, m.to, m.at) : state.wroteTo;
      return { ...state, messages, wroteTo, counters: bump(state.counters, 'message', [m.id]) };
    }
    case 'delivered': {
      const messages = withDelivery(state.messages, event.id, event.at, event.how);
      // A message reaching a CEO who stopped without a proposal starts its next turn: it drafts again.
      const stopped = state.drafting.stopped;
      const reached = stopped !== null && state.messages.some((m) => m.id === event.id && m.to === stopped.person && m.deliveredAt === null);
      return { ...state, messages, ...(reached ? { drafting: { ...state.drafting, stopped: null } } : {}) };
    }
    case 'unsent':
      return { ...state, messages: state.messages.filter((m) => m.id !== event.id || m.deliveredAt !== null) };
    case 'question':
      return {
        ...state,
        questions: trim([...state.questions, event.question], STATE_LIMITS.questions, closedItem(state)),
        counters: bump(state.counters, 'question', [event.question.id]),
      };
    case 'answer':
      return {
        ...state,
        questions: state.questions.map((q) => (q.id === event.id && q.answer === null && q.withdrawn === null ? { ...q, answer: event.answer } : q)),
      };
    case 'approval':
      return {
        ...state,
        approvals: trim([...state.approvals, event.approval], STATE_LIMITS.approvals, closedItem(state)),
        counters: bump(state.counters, 'approval', [event.approval.id]),
      };
    case 'decision':
      return {
        ...state,
        approvals: state.approvals.map((a) => (a.id === event.id && a.answer === null && a.withdrawn === null ? { ...a, answer: event.answer } : a)),
      };
    case 'undo': {
      if (own(state.applied, event.id) !== undefined) return state;
      return {
        ...state,
        questions: state.questions.map((q) => (q.id === event.id ? { ...q, answer: null } : q)),
        approvals: state.approvals.map((a) => (a.id === event.id ? { ...a, answer: null } : a)),
      };
    }
    case 'applied': {
      if (own(state.applied, event.id) !== undefined) return state;
      const next = { ...state, applied: withEntry(state.applied, event.id, event.at) };
      // An "Always allow" that reached its person becomes a rule, so the policy lets the same request through next time.
      const approval = state.approvals.find((a) => a.id === event.id);
      const rule = approval?.answer?.decision === 'allow' && approval.answer.always ? approval.alwaysRule?.rule : undefined;
      if (rule && !state.settings.alwaysAllow.includes(rule)) next.settings = { ...state.settings, alwaysAllow: [...state.settings.alwaysAllow, rule] };
      return next;
    }
    case 'withdrawn': {
      if (own(state.applied, event.id) !== undefined) return state;
      const withdrawn = { reason: event.reason, at: event.at };
      return {
        ...state,
        questions: state.questions.map((q) => (q.id === event.id && q.withdrawn === null ? { ...q, withdrawn } : q)),
        approvals: state.approvals.map((a) => (a.id === event.id && a.withdrawn === null ? { ...a, withdrawn } : a)),
      };
    }
    case 'status':
      return { ...state, statuses: newest([...state.statuses, event.status], STATE_LIMITS.statuses) };
    case 'report':
      return { ...state, reports: newest([...state.reports, event.report], STATE_LIMITS.reports), counters: bump(state.counters, 'report', [event.report.id]) };
    case 'task': {
      const assignments = event.messageId ? withEntry(state.assignments, event.messageId, event.task.id) : state.assignments;
      const worktreeWaits = event.wantsWorktree ? withEntry<WorktreeWait>(state.worktreeWaits, event.task.id, 'making') : state.worktreeWaits;
      const counters = bump(state.counters, 'task', [event.task.id]);
      return settleMilestones({ ...state, tasks: [...state.tasks, event.task], assignments, worktreeWaits, counters }, event.task.createdAt);
    }
    case 'task-status': {
      const tasks = state.tasks.map((t) => {
        if (t.id !== event.id) return t;
        const next: Task = { ...t, status: event.status, updatedAt: event.at };
        if (event.outcome !== undefined) next.outcome = event.outcome;
        return next;
      });
      // A task that is over waits for no worktree.
      const over = event.status === 'done' || event.status === 'dropped';
      const worktreeWaits = over && own(state.worktreeWaits, event.id) !== undefined ? without(state.worktreeWaits, event.id) : state.worktreeWaits;
      return settleMilestones({ ...state, tasks, worktreeWaits }, event.at);
    }
    case 'task-note':
      // A note isn't a change to the task: its updatedAt stays, so the office tells the manager once per change.
      return { ...state, tasks: state.tasks.map((t) => (t.id === event.id ? { ...t, note: { at: event.note.at, text: event.note.text } } : t)) };
    case 'task-check':
      // The check's result isn't a change to the task: its updatedAt stays.
      return { ...state, tasks: state.tasks.map((t) => (t.id === event.id ? { ...t, check: { ...event.check } } : t)) };
    case 'task-look':
      // Neither is the office's look at the app.
      return { ...state, tasks: state.tasks.map((t) => (t.id === event.id ? { ...t, look: { ...event.look } } : t)) };
    case 'plan-done':
      return { ...state, done: event.at };
    case 'worktree': {
      const worktree = event.worktree;
      const tasks = worktree ? state.tasks.map((t) => (t.id === event.id ? { ...t, worktree } : t)) : state.tasks;
      const worktreeWaits = event.waiting ? withEntry<WorktreeWait>(state.worktreeWaits, event.id, 'waiting') : without(state.worktreeWaits, event.id);
      return { ...state, tasks, worktreeWaits };
    }
    case 'retire':
      return { ...state, retiring: withEntry(state.retiring, event.id, { person: event.person, worktree: event.worktree }) };
    case 'retired':
      return { ...state, retiring: without(state.retiring, event.id) };
    case 'commit-wait':
      return { ...state, commitWaits: withEntry(state.commitWaits, event.id, event.by) };
    case 'commit':
      return {
        ...state,
        tasks: event.commit === null ? state.tasks : state.tasks.map((t) => (t.id === event.id ? { ...t, commit: event.commit } : t)),
        commitWaits: without(state.commitWaits, event.id),
      };
    case 'dashboard': {
      const d = event.dashboard;
      const exists = state.dashboards.some((x) => x.id === d.id);
      const dashboards = exists ? state.dashboards.map((x) => (x.id === d.id ? d : x)) : [...state.dashboards, d];
      return { ...state, dashboards, counters: bump(state.counters, 'dashboard', [d.id]) };
    }
    case 'dashboard-removed':
      return { ...state, dashboards: state.dashboards.filter((d) => d.id !== event.id) };
    case 'screenshot':
      return {
        ...state,
        screenshots: newest([...state.screenshots, event.screenshot], STATE_LIMITS.screenshots),
        counters: bump(state.counters, 'screenshot', [event.screenshot.id]),
      };
    case 'session':
      return withDesk(state, event.person, (d) => ({
        ...d,
        sessionId: event.sessionId,
        sessions: d.sessions.includes(event.sessionId) ? d.sessions : newest([...d.sessions, event.sessionId], SESSIONS_KEPT),
      }));
    case 'turn': {
      const cost = Number.isFinite(event.cost) && event.cost > 0 ? event.cost : 0;
      const next = withDesk(state, event.person, (d) => ({
        ...d,
        cost: d.cost + cost,
        // A priced turn replaces what the transcripts showed of it; one with no price leaves it standing.
        unpriced: cost > 0 ? 0 : d.unpriced,
        contextTokens: event.contextTokens ?? d.contextTokens,
        lastTurnAt: event.at,
        busy: false,
        turns: d.turns + 1,
        // The first turn on a fresh page ends the pointer to its notes, and tells the handover what the page grew to.
        freshFrom: null,
        handovers: d.handovers.map((h, i) => (i === d.handovers.length - 1 && h.after === null && event.contextTokens !== null ? { ...h, after: event.contextTokens } : h)),
      }));
      return {
        ...next,
        spend: newest([...state.spend, { person: event.person, at: event.at, cost }], STATE_LIMITS.spend),
        spendHours: cost > 0 ? addSpend(state.spendHours, event.person, cost, event.at) : state.spendHours,
      };
    }
    case 'handover-asked':
      return withDesk(state, event.person, (d) => ({ ...d, handover: { messageId: event.messageId, at: event.at, tokens: event.tokens } }));
    case 'handover':
      return withDesk(state, event.person, (d) => ({
        ...d,
        sessionId: null,
        contextTokens: null,
        busy: false,
        fresh: d.fresh + 1,
        turns: 0,
        handover: null,
        freshFrom: event.by,
        handovers: newest([...d.handovers, { at: event.at, by: event.by, before: event.tokens, after: null }], HANDOVERS_KEPT),
      }));
    case 'spent':
      return withDesk(state, event.person, (d) => ({ ...d, unpriced: Number.isFinite(event.unpriced) && event.unpriced > 0 ? event.unpriced : 0 }));
    case 'busy':
      return withDesk(state, event.person, (d) => ({ ...d, busy: event.busy }));
    case 'away':
      return withDesk(state, event.person, (d) => ({ ...d, awaySince: event.since, busy: event.since === null ? d.busy : false }));
    case 'pause':
      return { ...state, pause: event.pause };
    case 'settings':
      return { ...state, settings: event.settings };
    case 'seen':
      return { ...state, seen: withEntry(state.seen, event.person, event.at) };
    case 'looked':
      return { ...state, looked: nextLooks(state.looked, event.at) };
    case 'log':
      return { ...state, log: pushLog(state, [event.entry]) };
    case 'ack':
      return foldTrace(state, event);
    default:
      return state;
  }
}

/** Folds a list of events, as one batch line does. */
export const foldAll = (state: CompanyState, events: readonly CompanyEvent[]): CompanyState => events.reduce(fold, state);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An event as the log holds it: the company wrote it and its line's MAC checked, so only its type is looked at. */
export function isCompanyEvent(raw: unknown): raw is CompanyEvent {
  return isObj(raw) && typeof raw.type === 'string' && (EVENT_TYPES as readonly string[]).includes(raw.type);
}

/**
 * A list from our own signed snapshot: its entries are what the company wrote (the store checked the MAC), so only the
 * list itself is checked here.
 */
function listOf<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/** A record from our own signed snapshot, for the same reason checked only for being an object. */
function recordOf<T>(raw: unknown): T | null {
  if (!isObj(raw)) return null;
  const value: unknown = raw;
  return value as T;
}

const isPhase = (v: unknown): v is CompanyPhase => typeof v === 'string' && (PHASES as readonly string[]).includes(v);

/** Rebuilds a record read back from JSON without a prototype, keeping the entries `each` accepts. */
function dictOf<T>(raw: unknown, each: (value: unknown) => T | undefined): Record<string, T> {
  const out = dict<T>();
  if (!isObj(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const v = each(value);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numberOrUndefined = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const textOr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/** The drafting record of a snapshot written before it existed is a blank one. */
function draftingOf(raw: unknown): Drafting {
  if (!isObj(raw)) return blankDrafting();
  const s = isObj(raw.stopped) ? raw.stopped : null;
  const stopped = s && typeof s.person === 'string' && typeof s.words === 'string' ? { person: s.person, at: finiteOr(s.at, 0), words: s.words } : null;
  return { refused: finiteOr(raw.refused, 0), firstRefusal: typeof raw.firstRefusal === 'string' ? raw.firstRefusal : null, stopped };
}

function scopingOf(raw: unknown): Scoping | null {
  if (!isObj(raw)) return null;
  const questions = listOf<unknown>(raw.questions).filter((q): q is string => typeof q === 'string');
  if (questions.length === 0) return null;
  return { questions, askedAt: finiteOr(raw.askedAt, 0), answeredAt: numberOrUndefined(raw.answeredAt) ?? null };
}

function handoverOf(raw: unknown): DeskRecord['handover'] {
  if (!isObj(raw) || typeof raw.messageId !== 'string') return null;
  return { messageId: raw.messageId, at: finiteOr(raw.at, 0), tokens: finiteOr(raw.tokens, 0) };
}

function deskOf(raw: unknown): DeskRecord | undefined {
  if (!isObj(raw)) return undefined;
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : null;
  return {
    sessionId,
    sessions: listOf<unknown>(raw.sessions).filter((s): s is string => typeof s === 'string'),
    cost: finiteOr(raw.cost, 0),
    unpriced: Math.max(0, finiteOr(raw.unpriced, 0)),
    contextTokens: numberOrUndefined(raw.contextTokens) ?? null,
    lastTurnAt: numberOrUndefined(raw.lastTurnAt) ?? null,
    busy: raw.busy === true,
    awaySince: numberOrUndefined(raw.awaySince) ?? null,
    fresh: Math.max(0, Math.round(finiteOr(raw.fresh, 0))),
    turns: Math.max(0, Math.round(finiteOr(raw.turns, 0))),
    handover: handoverOf(raw.handover),
    freshFrom: raw.freshFrom === 'person' || raw.freshFrom === 'office' ? raw.freshFrom : null,
    handovers: listOf<unknown>(raw.handovers).flatMap((h): HandoverNote[] => {
      if (!isObj(h) || (h.by !== 'person' && h.by !== 'office')) return [];
      return [{ at: finiteOr(h.at, 0), by: h.by, before: numberOrUndefined(h.before) ?? null, after: numberOrUndefined(h.after) ?? null }];
    }),
  };
}

/** The looks after one at `at`: a pause longer than LOOK_GAP_MS since the last look starts a new visit (src/core/overview.ts). */
export function nextLooks(looks: CompanyLooks, at: number): CompanyLooks {
  const newVisit = looks.last !== null && at - looks.last > LOOK_GAP_MS;
  return { last: at, previous: newVisit ? looks.last : looks.previous };
}

/** The looks from company.json; a state written before them has none. */
function looksOf(raw: unknown): CompanyLooks {
  if (!isObj(raw)) return { last: null, previous: null };
  return { last: numberOrUndefined(raw.last) ?? null, previous: numberOrUndefined(raw.previous) ?? null };
}

/**
 * The state from company.json, which the store checked against its MAC: the shape is the company's own, so this
 * checks the top level and gives records keyed by ids their null prototype back.
 */
export function reviveState(raw: unknown): CompanyState | null {
  if (!isObj(raw) || raw.version !== STATE_VERSION || typeof raw.id !== 'string' || !isObj(raw.settings) || !isObj(raw.counters)) return null;
  const counters = zeroCounters();
  for (const kind of ID_KINDS) counters[kind] = finiteOr(raw.counters[kind], 0);
  const settings = defaultSettings();
  // A company from before the spending plan keeps the desks it had, and runs as Balanced with no budget.
  settings.maxDesks = finiteOr(raw.settings.maxDesks, DEFAULT_MAX_DESKS);
  if (isPresetId(raw.settings.preset)) settings.preset = raw.settings.preset;
  settings.models = presetModels(settings.preset);
  if (isObj(raw.settings.models)) for (const level of MODEL_LEVELS) if ((ROLE_MODELS as readonly unknown[]).includes(raw.settings.models[level])) settings.models[level] = raw.settings.models[level] as RoleModel;
  if (isObj(raw.settings.budget)) {
    settings.budget = { company: cleanBudget(raw.settings.budget.company), person: cleanBudget(raw.settings.budget.person) };
  }
  settings.idleMs = finiteOr(raw.settings.idleMs, settings.idleMs);
  settings.billing = raw.settings.billing === 'api-key' ? 'api-key' : 'plan';
  settings.alwaysAllow = listOf<unknown>(raw.settings.alwaysAllow).filter((r): r is string => typeof r === 'string');
  return {
    version: STATE_VERSION,
    id: raw.id,
    name: textOr(raw.name, raw.id),
    root: textOr(raw.root, ''),
    prompt: textOr(raw.prompt, ''),
    shape: isCompanyShape(raw.shape) ? raw.shape : 'classic',
    launch: cleanLaunch(raw.launch),
    stakeholder: textOr(raw.stakeholder, ''),
    createdAt: finiteOr(raw.createdAt, 0),
    phase: isPhase(raw.phase) ? raw.phase : 'founding',
    branch: typeof raw.branch === 'string' ? raw.branch : null,
    branchBase: typeof raw.branchBase === 'string' ? raw.branchBase : null,
    goal: recordOf<Goal>(raw.goal),
    done: numberOrUndefined(raw.done) ?? null,
    proposal: recordOf<OrgProposal>(raw.proposal),
    ceoProposal: recordOf<OrgProposal>(raw.ceoProposal),
    proposalEdited: raw.proposalEdited === true,
    proposalQuestions: listOf<unknown>(raw.proposalQuestions).filter((q): q is string => typeof q === 'string'),
    scoping: scopingOf(raw.scoping),
    proposalCount: finiteOr(raw.proposalCount, 0),
    drafting: draftingOf(raw.drafting),
    tasks: listOf<Task>(raw.tasks),
    assignments: dictOf(raw.assignments, (v) => (typeof v === 'string' ? v : undefined)),
    worktreeWaits: dictOf<WorktreeWait>(raw.worktreeWaits, (v) => (v === 'making' || v === 'waiting' ? v : undefined)),
    commitWaits: dictOf(raw.commitWaits, (v) => (typeof v === 'string' ? v : undefined)),
    retiring: dictOf(raw.retiring, (v) => recordOf<{ person: string; worktree: Worktree }>(v) ?? undefined),
    messages: listOf<Message>(raw.messages),
    acks: reviveAcks(raw.acks),
    steering: reviveSteering(raw.steering),
    questions: listOf<Question>(raw.questions),
    approvals: listOf<Approval>(raw.approvals),
    applied: dictOf(raw.applied, numberOrUndefined),
    statuses: listOf<StatusLine>(raw.statuses),
    reports: listOf<Report>(raw.reports),
    dashboards: listOf<Dashboard>(raw.dashboards),
    screenshots: listOf<Screenshot>(raw.screenshots),
    spend: listOf<SpendSample>(raw.spend),
    spendHours: listOf<unknown>(raw.spendHours).flatMap((h) => (isObj(h) && typeof h.hour === 'number' ? [{ hour: h.hour, byPerson: dictOf(h.byPerson, numberOrUndefined) }] : [])),
    log: listOf<LogEntry>(raw.log),
    pause: recordOf<Pause>(raw.pause),
    settings,
    desks: dictOf(raw.desks, deskOf),
    wroteTo: dictOf(raw.wroteTo, numberOrUndefined),
    seen: dictOf(raw.seen, numberOrUndefined),
    looked: looksOf(raw.looked),
    counters,
  };
}
