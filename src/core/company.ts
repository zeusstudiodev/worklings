// v3: the company the office runs. The shapes the switchboard, the org tools, the hub and the web app share, and the
// org rules more than one of them applies. Pure, with no Node APIs: the web app imports it.
import type { Loads } from './loads.ts';
import type { PlanSummary } from './plan-summary.ts';
import type { CostEstimate } from './cost-estimate.ts';
import type { ModelsByLevel, PresetId } from './presets.ts';
import type { SpendingView } from './spending.ts';
import type { Dashboard } from './dashboard.ts';
import type { Theme } from './looks.ts';
import type { NewRole, OrgProposal } from './org.ts';
import type { WorkSignal } from './desk-work.ts';
import type { HelperView, PlainDesk, PlainLaunch, TodoItem } from './plain.ts';
import type { ReshapeResult } from './snapshot.ts';
import type { Ack, Audience, ChecklistState, ChecklistView, Effort, Leash, SteeringView, TaskCancel, TaskHandover, TaskPause } from './steering.ts';
import { inSentence, type Level, type Look, type OfficeRoom, type Studio } from './studio.ts';

/** The stakeholder in `from`, `to` and `askedBy`. The `@` keeps it from ever being a role id. */
export const STAKEHOLDER = '@stakeholder';
/** The office itself, for turns no person wrote ("You were stopped", "The company was restarted"). */
export const THE_OFFICE = '@office';

/** Library roles the org flow hires; no domain's team uses them. */
export const ORG_ROLES: readonly string[] = ['ceo', 'head', 'office-manager', 'builder', 'tester', 'reviewer'];

/** Caps on what people send through the org tools, in characters (lists in entries). */
export const LIMITS = {
  status: 200,
  title: 120,
  message: 4_000,
  /** The most of a free-text report the office keeps (the pre-0.2 form); it cuts rather than refuses. */
  report: 4_000,
  brief: 8_000,
  doneWhen: 1_000,
  /**
   * The stakeholder's first prompt. v0.4 (SPEC-v0.4.md, B1): any length up to this; past `promptInline` it reaches the
   * CEO through the brief file, whole and word for word, and its opening turn points there instead of quoting it.
   */
  prompt: 64_000,
  /** The longest first prompt the CEO's opening turn quotes in full. */
  promptInline: 4_000,
  goal: 1_000,
  milestones: 12,
  question: 500,
  option: 120,
  options: { min: 2, max: 4 },
  /** The CEO's one-line reason for its pick on a scoping question. */
  why: 200,
  /** The CEO's scoping questions, asked before it drafts the org (ask_scoping). */
  scoping: { min: 1, max: 5 },
  files: 50,
  path: 300,
  caption: 200,
  /** A shared screenshot, in bytes. */
  screenshot: 4 * 1024 * 1024,
} as const;

/**
 * v0.2: a report is a small fixed form (src/orgtools/tools.ts) that code can read. Past any of these the office cuts the
 * text and never refuses the report: a report refused for length costs a second request with the whole context.
 */
export const REPORT_FORM = { note: 600, open: 8, openItem: 200, files: 30, ran: 200, tail: 400 } as const;

// ---------------------------------------------------------------------------------------------------------------
// People and the org

/** A role in the company with its place in the org. */
export interface Person {
  id: string;
  /** Their first name, or their title when the role has none. */
  name: string;
  title: string;
  level: Level;
  /** Their room: a department id. */
  room: string;
  /** Their manager's id; null for the CEO, and for everyone in a studio that has no org. */
  reportsTo: string | null;
  look: Look;
}

/** The people of a studio. A role without a level is a worker; a role with the id `ceo` and no level is the CEO. */
export function peopleOf(studio: Studio | null): Person[] {
  return (studio?.roles ?? []).map((r) => ({
    id: r.id,
    name: r.name ?? r.title,
    title: r.title,
    level: r.level ?? (r.id === 'ceo' ? 'ceo' : 'worker'),
    room: r.department,
    reportsTo: r.reportsTo ?? null,
    look: r.look ?? {},
  }));
}

export const isManager = (p: Pick<Person, 'level'>): boolean => p.level === 'ceo' || p.level === 'head' || p.level === 'lead';
export const personById = (people: readonly Person[], id: string): Person | undefined => people.find((p) => p.id === id);
export const managerOf = (people: readonly Person[], id: string): Person | undefined => {
  const manager = personById(people, id)?.reportsTo;
  return manager ? personById(people, manager) : undefined;
};
export const reportsOf = (people: readonly Person[], id: string): Person[] => people.filter((p) => p.reportsTo === id);

/** Everyone below a person, nearest first. */
export function below(people: readonly Person[], id: string): Person[] {
  const out: Person[] = [];
  const seen = new Set([id]);
  for (let queue = [id]; queue.length > 0; ) {
    const next: string[] = [];
    for (const at of queue) {
      for (const p of reportsOf(people, at)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
        next.push(p.id);
      }
    }
    queue = next;
  }
  return out;
}

/** Their manager, their manager's manager and so on up to the CEO. */
export function chainUp(people: readonly Person[], id: string): Person[] {
  const out: Person[] = [];
  const seen = new Set([id]);
  for (let at = managerOf(people, id); at && !seen.has(at.id); at = managerOf(people, at.id)) {
    seen.add(at.id);
    out.push(at);
  }
  return out;
}

/**
 * Who may message whom. The stakeholder may message anyone. People message their manager, their direct reports and
 * their own team (the others with the same manager), and reach other teams through managers. The CEO's manager is
 * the stakeholder; anyone else may write to the stakeholder only to reply, once the stakeholder has written to them.
 */
export function mayMessage(people: readonly Person[], from: string, to: string, stakeholderWroteToSender = false): boolean {
  if (from === to) return false;
  if (from === STAKEHOLDER) return personById(people, to) !== undefined;
  const sender = personById(people, from);
  if (!sender) return false;
  if (to === STAKEHOLDER) return sender.level === 'ceo' || stakeholderWroteToSender;
  const target = personById(people, to);
  if (!target) return false;
  return sender.reportsTo === target.id || target.reportsTo === sender.id || (sender.reportsTo !== null && sender.reportsTo === target.reportsTo);
}

/** Managers assign work only to their own people: anyone below them. */
export function mayAssign(people: readonly Person[], from: string, to: string): boolean {
  const manager = personById(people, from);
  return manager !== undefined && isManager(manager) && below(people, from).some((p) => p.id === to);
}

/** The org tools by who may call them. */
export const ORG_TOOLS = {
  everyone: ['post_status', 'report', 'message', 'ask', 'org', 'tasks', 'share_screenshot', 'stakeholder_words'],
  managers: ['assign', 'relay', 'review'],
  ceo: ['library_catalogue', 'ask_scoping', 'propose_org', 'ask_stakeholder', 'set_goal', 'publish_dashboard', 'remove_dashboard', 'hire', 'fire', 'move', 'rehire', 'change_office'],
} as const;
export type OrgTool = (typeof ORG_TOOLS)[keyof typeof ORG_TOOLS][number];

/** The tools a person's desk offers. The office manager also changes the office. */
export function toolsFor(person: Pick<Person, 'id' | 'level'>): OrgTool[] {
  const tools: OrgTool[] = [...ORG_TOOLS.everyone];
  if (isManager(person)) tools.push(...ORG_TOOLS.managers);
  if (person.level === 'ceo') tools.push(...ORG_TOOLS.ceo);
  else if (person.id === 'office-manager') tools.push('change_office');
  return tools;
}

/** "Ada, head of design" or, for a role without a name, "the head of design". */
export function introduce(person: Pick<Person, 'name' | 'title'>): string {
  return person.name === person.title ? `the ${inSentence(person.title)}` : `${person.name}, ${inSentence(person.title)}`;
}

/** A fence's marker: letters and digits only, so the text it wraps can't close it by accident. */
export const FENCE_MARKER = /^[A-Za-z0-9]{8,64}$/;

/**
 * The user turn that carries a message to a person: who it is from, whom it was passed on from, and the message's id
 * so a manager can relay it ("From Ada, head of design, passing on from Robin (message m-12): make the palette
 * darker"). With a `fence` (a random marker per delivery, which the company makes), the words go between two marker
 * lines, so a body that itself contains "From Robin, the stakeholder: ..." can't pass for a turn of its own: the
 * house rules say only the line before the fence says who a message is from.
 */
export function turnText(
  m: Pick<Message, 'from' | 'origin' | 'text'> & { id?: string; audience?: Audience | null; fromStudio?: boolean },
  people: readonly Person[],
  stakeholder: string,
  fence?: string,
): string {
  const who = (id: string): string => {
    if (id === STAKEHOLDER) return stakeholder || 'the stakeholder';
    if (id === THE_OFFICE) return 'the office';
    const p = personById(people, id);
    return p ? introduce(p) : id;
  };
  // The studio chat asks across the stakeholder's companies and decides nothing: its words are never theirs.
  const from =
    m.fromStudio === true
      ? `the studio chat, which asks for ${stakeholder || 'the stakeholder'} across their companies and decides nothing`
      : m.from === STAKEHOLDER
        ? stakeholder
          ? `${stakeholder}, the stakeholder`
          : 'the stakeholder'
        : who(m.from);
  // A message to a room, a team or everyone names its audience: "From Robin, the stakeholder, to the design room".
  const to = m.audience ? `${from.includes(', ') ? ',' : ''} to ${m.audience.title}` : '';
  const via = m.origin && m.origin !== m.from ? `, passing on from ${who(m.origin)}` : '';
  const answer = m.fromStudio === true ? "; answer it in your turn's last words" : '';
  const ref = m.id ? ` (message ${m.id}${answer})` : answer ? ` (${answer.slice(2)})` : '';
  if (fence === undefined) return `From ${from}${to}${via}${ref}: ${m.text}`;
  if (!FENCE_MARKER.test(fence)) throw new Error(`turnText: a fence is 8 to 64 letters and digits, got ${JSON.stringify(fence)}`);
  // The marker can't appear inside the words: the company picks it at random, and a clash is cut out rather than trusted.
  const words = m.text.split(fence).join('');
  return `From ${from}${to}${via}${ref}, between the two ${fence} lines:\n${fence}\n${words}\n${fence}`;
}

// ---------------------------------------------------------------------------------------------------------------
// What happens in a company

export const TASK_STATUSES = ['queued', 'working', 'blocked', 'review', 'done', 'dropped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  brief: string;
  owner: string;
  /** Who asked for it: their manager, or STAKEHOLDER. */
  askedBy: string;
  /** Files or folders the owner may change, relative to the project; no two open tasks share one. */
  files: string[];
  doneWhen: string;
  status: TaskStatus;
  /** What came of it, from the owner's report. */
  outcome: string | null;
  parent: string | null;
  milestone: string | null;
  /** Long or risky work runs in its own worktree and branch, merged by the owner's manager. */
  worktree: { path: string; branch: string } | null;
  /** The commit on the company's branch that finished it. */
  commit: string | null;
  createdAt: number;
  updatedAt: number;
  // Steering (src/core/steering.ts): optional until every writer sets them.
  /** Lower goes first: the order the switchboard hands out queued work in. */
  priority?: number;
  /** Paused by the stakeholder or a manager: its turns are held until it resumes. */
  paused?: TaskPause | null;
  /** Cancelled with a reason (status dropped); the work stays on `cancel.branch`. */
  cancel?: TaskCancel | null;
  handovers?: TaskHandover[];
  /** The plan task it was made from. */
  planTask?: string | null;
  /** Messages it answers, by id: the stakeholder's trace lists it. */
  cites?: string[];
  /** The words its owner's last turn ended with when that turn ended with the task under way and no report. */
  note?: TaskNote | null;
  /** v0.2: the check the office ran when the task was reported done, and what came of it. */
  check?: TaskCheck | null;
  /** v0.2: set on a small fix task, or a re-check, that the final review made. */
  followUp?: TaskFollowUp;
  /** v0.3: what the office saw of the running app before this final review or re-check (src/company/app-look.ts). */
  look?: TaskLook | null;
}

/** v0.2: the command the office runs as a task's gate (PlanTask.check), and the result, for the board. */
export interface TaskCheck {
  command: string;
  /** pending: not run yet. running: under way. passed, failed. unrunnable: the office wouldn't or couldn't run it, so a person reviews. */
  state: 'pending' | 'running' | 'passed' | 'failed' | 'unrunnable';
  /** How many times the office ran it (a failure that sent the task back counts). */
  runs: number;
  at: number;
  /** The end of its output, or why it wasn't run; masked and cut to 600 characters. */
  tail: string;
}

/**
 * v0.2: the final review's follow-up work. A fix task is one failed requirement sent back to its maker, once; a re-check
 * is the reviewer looking at only those requirements again, once.
 */
export interface TaskFollowUp {
  kind: 'fix' | 'recheck' | 'end-check';
  /** The verification task whose report it follows. */
  verification: string;
  /** The failed requirements, as the reviewer wrote them. */
  items: string[];
  /** v0.3: which fix round this is for the task it fixes, 1 or 2 (FIX_ROUNDS); absent before 0.3, which had one. */
  round?: number;
  /** v0.3: the task whose work it fixes; rounds count per task, so per checklist item it builds. */
  maker?: string;
  /** v0.3: the report (or look) that sent it: its fixes are re-checked together, once. */
  batch?: string;
  /** v0.3: "acceptance" when the office's own acceptance checks failed before the review ran; absent for the review's. */
  source?: 'acceptance';
}

/** v0.3 (SPEC-v0.3.md, Q3): automatic fix rounds per final review before a failure reaches a person. */
export const FIX_ROUNDS = 2;

/** v0.3: one acceptance check the office ran before a review, for a checklist item. */
export interface LookCheck {
  item: string;
  kind: 'walk' | 'command';
  ok: boolean;
  /** The step that failed (a walk's) or the command; null when it passed. */
  step: string | null;
  /** Why, in plain words; masked and cut. */
  why: string | null;
  /** A screenshot at the end of a walk, relative to the project. */
  shot: string | null;
}

/** v0.3: the office's look at the running app before a final review (src/company/app-look.ts). */
export interface TaskLook {
  /** running: under way. seen: the app was opened. failed: it is a web app and served no page. skipped: not a web app, or not run. */
  state: 'running' | 'seen' | 'failed' | 'skipped';
  /** Which look of this task it is, from 1: each keeps its screenshots in a folder of its own. */
  runs: number;
  at: number;
  /** A plain sentence about what the office did. */
  note: string;
  /** Relative to the project, with the page and the width each shows. */
  shots: { file: string; page: string; width: number; overflow?: boolean }[];
  /** Console errors, page errors and failed requests, masked and cut. */
  errors: string[];
  checks: LookCheck[];
}

/** What the office kept from a turn that ended with the task still under way and no report on it. */
export interface TaskNote {
  at: number;
  /** The turn's last words, masked and cut to 400 characters; empty when it ended saying nothing. */
  text: string;
}

export interface Message {
  id: string;
  /** A person's id, STAKEHOLDER or THE_OFFICE. */
  from: string;
  to: string;
  text: string;
  /** Who first said it, when this message passes it on. */
  origin: string | null;
  /** The message this one passes on. */
  relayOf: string | null;
  /** What the relayer added when passing it on. */
  note: string | null;
  at: number;
  /** When it reached them: written to their open desk, or the turn a desk opened with. */
  deliveredAt: number | null;
  /** Sent with Stop: the person's turn was interrupted to take it. */
  interrupt: boolean;
  /** The question this message answers, when it carries the stakeholder's answer. */
  answers?: string | null;
  // Steering (src/core/steering.ts): optional until every writer sets them.
  /** Sent to a room, a team or everyone: this person's copy names the audience. */
  audience?: Audience | null;
  /** The people the stakeholder said it is for, so the trace can flag who it hasn't reached. */
  for?: string[];
  /** Taken at the person's next step (written to their open desk) or as a new turn. */
  deliveredHow?: 'next-step' | 'new-turn' | null;
  /**
   * What this one answers or follows up, by id: messages ("m-12") for a Remind or an Escalate, the decision ("d-3") for
   * a Reconsider. The prefixes tell them apart.
   */
  cites?: string[];
  /**
   * The words the person's turn ended with, which the office posted as their reply: the stakeholder's message began
   * that turn and the person sent the stakeholder no message in it.
   */
  turnReply?: boolean;
  /**
   * Written by the office in the stakeholder's name (the answer to someone's question, the note on a denied approval,
   * a plan comment, a Reconsider request): the stakeholder's own typed words are the only ones anyone may cite as
   * their word, so these never count.
   */
  fromOffice?: boolean;
  /**
   * v0.3: sent by the studio chat (src/studio/), the hub-level chat over every company, to a CEO. The office writes it in
   * the stakeholder's name, so `fromOffice` is set too and it never counts as their word; its turn names the studio chat
   * as the sender (turnText) and the CEO's last words answer it.
   */
  fromStudio?: boolean;
  /**
   * Words the stakeholder typed into a box in the office (the composer, a person's message box, a Stop's instruction),
   * sent with `typed: true`: the only messages in their name anyone may cite as their word. A button's words, a plain
   * Stop, the office's notes and every message kept from before this mark existed go without it, so they never count.
   */
  typed?: boolean;
}

/**
 * A choice put to the stakeholder: by the CEO, or by anyone with `ask` to the stakeholder (their manager gets a copy).
 * Questions for a manager travel as messages.
 */
export interface Question {
  id: string;
  from: string;
  text: string;
  options: string[];
  /** The index of the asker's pick. */
  recommended: number | null;
  taskId: string | null;
  askedAt: number;
  /**
   * The stakeholder's answer. It reaches the asker at `appliesAt` (UNDO_MS after the press) unless undone first. `byDefault`
   * marks the office's own answer, the asker's pick, given when nobody answered by `defaultAt` (see `safe`).
   */
  answer: { option: number | null; text: string; at: number; appliesAt: number; byDefault?: true } | null;
  /** Taken back before an answer: the asker was stopped, fired or handed over, or the CEO revised its proposal. */
  withdrawn: { reason: string; at: number } | null;
  /**
   * v0.2: what happens when nobody answers by `defaultAt`. `safe` is the asker's word that every option is reversible and
   * stays inside the company: then its pick (`recommended`) applies by itself, and the asker is told so. Otherwise (a
   * product choice that is costly to undo, money, anything irreversible or seen outside the company) no answer is a no:
   * the question is withdrawn, and the asker carries on with its `fallback`. Absent on the office's own questions
   * (thoroughness, budget, a "check with me" start, scoping), which have their own rules, and on older ones.
   */
  safe?: boolean;
  /** v0.2: what the asker does if nobody answers (a sentence); null when the asker gave none. */
  fallback?: string | null;
  /** v0.2: when the default applies by itself. */
  defaultAt?: number | null;
  /** v0.2: asks raised close together, or in one turn, share a batch the inbox shows as one (`InboxBatch`). */
  batch?: string | null;
  /** Steering: the office asks before a person on "check with me" starts this task; option 0 starts it. */
  gate?: { task: string } | null;
  /** The asker's reason for its pick, in a line: the CEO gives one for each scoping question. */
  why?: string | null;
  /** The office's own "How thorough?" question: its options are the presets in PRESET_IDS order; the answer sets the preset. */
  preset?: boolean;
  /**
   * The office's budget notice (from THE_OFFICE): who it is about, how far spending was and the cap it was asked at.
   * `raiseTo` lists the new caps the first options offer, in order; the last option leaves the cap as it is.
   */
  budget?: { scope: 'company' | 'person'; person: string | null; at: 80 | 100; cap: number; raiseTo: number[] };
  /**
   * v0.7: a plain session ended its turn and waits for the person; `text` is its last words. The answer reaches it as
   * the person's own words, verbatim.
   */
  plainTurn?: true;
}

/** What an approval asks for, by the autonomy decision's ask list. */
export const ASK_KINDS = ['push', 'deploy', 'publish', 'outside-project', 'branch-delete', 'paid-api', 'message-out', 'global-config', 'other'] as const;
export type AskKind = (typeof ASK_KINDS)[number];

export interface Approval {
  id: string;
  person: string;
  tool: string;
  /** In plain words: "Push the work branch to GitHub". */
  summary: string;
  /** The exact command or path, masked, one click away. */
  detail: string;
  kind: AskKind;
  askedAt: number;
  /** When the person's hook stops waiting; an approval still open then counts as a no. */
  expiresAt: number;
  /** The rule "Always allow" would add, and the sentence that says what it allows; null where it isn't offered. */
  alwaysRule: { rule: string; sentence: string } | null;
  /** The stakeholder's answer, sent at `appliesAt` unless undone first; `note` is the optional "why" of a denial. */
  answer: { decision: 'allow' | 'deny'; always: boolean; at: number; appliesAt: number; note: string | null } | null;
  /** Gone before an answer: the person was stopped or fired, or the hook gave up (timed out). */
  withdrawn: { reason: string; at: number } | null;
  /** v0.2: the policy's recommendation, in a sentence the inbox shows with the request; absent on older ones. */
  advice?: ApprovalAdvice;
  /** v0.2: asks raised close together share a batch the inbox shows as one (`InboxBatch`). */
  batch?: string | null;
}

/**
 * What the hub hears back about an approval: the decision, whether it is always, the stakeholder's why for a no, and for a no
 * nobody gave (`expired`: nobody answered in time) what the person does instead.
 */
export interface ApprovalAnswer {
  decision: 'allow' | 'deny';
  always: boolean;
  note: string | null;
  expired?: true;
  fallback?: string;
}

/**
 * What the office advises on an approval and what happens without an answer: the recommendation and why, in plain words,
 * what the person does instead when it is a no, and the default, which is always a no (an ask is something the policy
 * could not show to be safe).
 */
export interface ApprovalAdvice {
  recommend: 'allow' | 'deny';
  why: string;
  fallback: string;
  ifNoAnswer: 'deny';
}

/** How long an answer, a decision or an office change can be undone before it takes effect. */
export const UNDO_MS = 5_000;
/** v0.2: how long a question waits for the stakeholder before its default applies (an approval's wait is the hub's, about as long). */
export const QUESTION_WAIT_MS = 10 * 60_000;
/** v0.2: an ask raised within this long of the newest one still waiting joins its batch. */
export const BATCH_WINDOW_MS = 90_000;

/**
 * Asks that waited on the stakeholder together, for the inbox to show as one: a person's questions and approvals raised
 * close together, answerable in one press (the recommendations). Open items only.
 */
export interface InboxBatch {
  id: string;
  /** When the first of them was raised. */
  at: number;
  items: { kind: 'question' | 'approval'; id: string }[];
}

/** One sentence a person posts when they start, finish, change step or get stuck. */
export interface StatusLine {
  person: string;
  text: string;
  taskId: string | null;
  at: number;
  /** Steering: messages it follows up, by id. */
  cites?: string[];
}

export interface Report {
  id: string;
  person: string;
  /** Their manager, or STAKEHOLDER for the CEO. */
  to: string;
  taskId: string | null;
  outcome: 'done' | 'blocked' | 'progress';
  /** The note, or for a report without one a sentence the office wrote from the form. */
  text: string;
  at: number;
  /** Steering: messages it answers, by id. */
  cites?: string[];
  /** v0.2, the form: the files it changed, the check run and its result, and what is still open. Absent on the old free-text form. */
  files?: string[];
  check?: ReportCheck;
  open?: string[];
}

/** What the person ran to see the work is done, and whether it passed. */
export interface ReportCheck {
  ran: string;
  passed: boolean;
  /** The end of what it printed, up to REPORT_FORM.tail characters. */
  tail?: string;
}

/** The report form as the tool gives it to the company; `text` is the note (or the old summary). */
export interface ReportForm {
  files: string[];
  check?: ReportCheck;
  open: string[];
}

export interface Milestone {
  id: string;
  title: string;
  doneWhen: string;
  doneAt: number | null;
}

export interface Goal {
  text: string;
  milestones: Milestone[];
  setAt: number;
}

/** What one turn of one person cost, for the Spend dashboard. */
export interface SpendSample {
  person: string;
  at: number;
  cost: number;
}

/** Spend for the Spend dashboard: recent turns, hours over a week, and each person's totals. */
export interface SpendView {
  /** The newest turns, oldest first. */
  samples: SpendSample[];
  /** Cost per hour over the last seven days, oldest first; `hour` is the hour's start. */
  hourly: { hour: number; cost: number }[];
  byPerson: { person: string; today: number; week: number; all: number }[];
}

/** What changed in the company, for the Timeline: everything that isn't a status line, report, message or answer. */
export const LOG_KINDS = [
  'founded', 'scoping', 'proposal', 'proposal-edited', 'started', 'goal', 'milestone', 'hire', 'fire', 'move', 'rehire', 'office',
  'dashboard', 'dashboard-refused', 'dashboard-removed', 'stop', 'hand-over', 'bring-back', 'pause', 'resume', 'rest', 'wake', 'restart', 'settings',
  'stalled', 'finished',
  /** v0.2: a person's desk was closed at a handover and began a fresh page. */
  'handover',
  /** v0.3: the office's acceptance checks sent failures back to their makers before the final review. */
  'fixing',
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface LogEntry {
  at: number;
  kind: LogKind;
  /** Who did it: a person, STAKEHOLDER or THE_OFFICE. */
  by: string;
  /** In a sentence: "The CEO hired Lena, German copywriter." */
  text: string;
}

export interface Screenshot {
  id: string;
  person: string;
  caption: string;
  at: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Desks: the running Claude Code of a person who is working

/**
 * closed: no process (costs nothing). waiting: has work but the company is at its cap or resting. starting: the
 * process is opening. working: in a turn. idle: open between turns, closes after a while. stopping: interrupted.
 * failed: the last turn failed (the problem says why). away: handed over to the stakeholder's own Claude Code, so
 * nothing opens their session until they are brought back.
 */
export const DESK_STATES = ['closed', 'waiting', 'starting', 'working', 'idle', 'stopping', 'failed', 'away'] as const;
export type DeskState = (typeof DESK_STATES)[number];

export interface DeskView {
  person: string;
  state: DeskState;
  /** Their Claude Code session, for resumes and "open in Claude Code". */
  sessionId: string | null;
  since: number;
  /** How full their context is, 0 to 1: the office shows it as tiredness. */
  context: number | null;
  /** Why the last turn failed, in a sentence. */
  problem: string | null;
  /** Their place in the line for a desk while waiting, from 1. */
  queue: number | null;
}

/** The company rests until a usage limit resets, or because the stakeholder paused it. */
export interface Pause {
  /** 'budget': the company's budget is spent; it waits for the stakeholder to raise it (settings.budget). */
  reason: 'usage-limit' | 'overloaded' | 'stakeholder' | 'budget';
  since: number;
  /** When it resumes on its own; null when it waits for the stakeholder. */
  until: number | null;
  /** In a sentence: "Resting until 14:00, when the plan's limit resets." */
  message: string;
}

export const DEFAULT_MAX_DESKS = 8;
export const DEFAULT_IDLE_MS = 5 * 60_000;

export interface CompanySettings {
  /** At most this many people working at once in this company (the hub caps all companies too). */
  maxDesks: number;
  /** An open desk with nothing to do closes after this long. */
  idleMs: number;
  /** 'plan': the person's own Claude Code sign-in, costs are estimates. 'api-key': their Claude Code bills per token. */
  billing: 'plan' | 'api-key';
  /**
   * "Always allow this" answers, as Claude Code permission rules scoped to the project ("Bash(npm publish --dry-run)").
   * The approvals policy allows a request one of them matches without asking again.
   */
  alwaysAllow: string[];
  /** v0.2's spending plan: Lean, Balanced (the default) or Thorough (src/core/presets.ts). */
  preset: PresetId;
  /** What a person with no model of their own runs on, by level: the preset's, as the stakeholder set them. */
  models: ModelsByLevel;
  /** Caps in API-equivalent dollars, to the cent; null: none. `person` applies to each person separately. */
  budget: { company: number | null; person: number | null };
}

/** founding: the CEO drafts the org. proposed: the chart waits for the stakeholder. running. stopped. */
export const PHASES = ['founding', 'proposed', 'running', 'stopped'] as const;
export type CompanyPhase = (typeof PHASES)[number];

// ---------------------------------------------------------------------------------------------------------------
// What the browser gets (`Snapshot.company`) and the lobby

export interface PersonView extends Person {
  /** The model from the role's agent file. */
  model: string;
  desk: DeskView;
  /** The task they are on. */
  task: string | null;
  status: StatusLine | null;
  /** Their figure in `Snapshot.agents`, once their session has been seen. */
  agentKey: string | null;
  /** Dollars so far: reported in API-key mode, an API-equivalent estimate otherwise. */
  cost: number;
  /**
   * v0.2: the person's context: the size at the end of their last turn (null before one, and after a handover until the
   * new page's first turn ends) and how many fresh pages they have had (desks closed at a handover).
   */
  context?: { tokens: number | null; fresh: number };
}

export interface PreviewView {
  state: 'off' | 'starting' | 'up' | 'down';
  /** The proxy's own origin, never the office's. */
  url: string | null;
  /** The same app on the tailnet (its own https port on the ts.net name), for a phone; null without --tailnet. */
  tailnetUrl?: string | null;
  /** The project's dev command, as detected. */
  command: string | null;
  problem: string | null;
}

/** How many entries of each list a view carries, newest kept. */
export const VIEW_LIMITS = { messages: 200, statuses: 200, reports: 100, questions: 100, approvals: 100, screenshots: 30, spend: 500, log: 200 } as const;

/**
 * Earlier messages than a view carries, a page at a time (`GET /api/c/<id>/messages`, the feed's "Show earlier
 * lines"): those the company keeps before the message asked about, in the order it keeps them, which is the order they
 * were sent and the order of `CompanyView.messages`.
 */
export interface MessagePage {
  /** Newest first, shown as the view shows messages. */
  messages: Message[];
  /** The acknowledgements of those messages, oldest first, as `SteeringView.acks` carries the view's. */
  acks: Ack[];
  /** The company keeps messages older than the oldest on this page. */
  more: boolean;
}

/** Messages a page holds: 1 to the view's own window, the whole window when the asker doesn't say. */
export const MESSAGE_PAGE = { max: VIEW_LIMITS.messages, default: VIEW_LIMITS.messages } as const;

export interface CompanyView {
  id: string;
  name: string;
  phase: CompanyPhase;
  /** The stakeholder's first prompt. */
  prompt: string;
  /** v0.4: the seats of a harness, or v0.3's job titles (classic). Absent from views of hubs before v0.4. */
  shape?: 'plain' | 'solo' | 'harness' | 'classic';
  /** v0.7: a plain company's launch choices (the person's own Claude Code decides whatever is null). */
  launch?: PlainLaunch;
  /** v0.7: the plain desk's own todo list and its subagents, read from its stream. */
  todos?: TodoItem[];
  helpers?: HelperView[];
  /** The stakeholder's name in messages ("Robin"). */
  stakeholder: string;
  /** The company's work branch; null when the project is not a git repository. */
  branch: string | null;
  theme: Theme;
  /** Rooms that aren't a department's, from studio.yaml's office section. */
  rooms: OfficeRoom[];
  goal: Goal | null;
  people: PersonView[];
  proposal: OrgProposal | null;
  tasks: Task[];
  messages: Message[];
  questions: Question[];
  approvals: Approval[];
  statuses: StatusLine[];
  reports: Report[];
  dashboards: Dashboard[];
  screenshots: Screenshot[];
  spend: SpendView;
  log: LogEntry[];
  pause: Pause | null;
  settings: CompanySettings;
  desks: { working: number; waiting: number; max: number };
  preview: PreviewView;
  /** Open questions and approvals, plus one for a proposal waiting to start: the count on every screen. */
  inbox: number;
  /** When the stakeholder last opened each person's conversation, for the unread mark. */
  seen: Record<string, number>;
  /** The proposal differs from the CEO's own version because the stakeholder edited it. */
  proposalEdited: boolean;
  /** Start was pressed and the company is hiring everyone and making its branch. */
  starting?: boolean;
  /** Steering: the plan, acknowledgements, the decision log, the leash and effort per person. */
  steering?: SteeringView;
  /** While the company is founding: how the CEO's drafting goes, so the office can say when it stalls. Null after. */
  drafting?: DraftingView | null;
  /** The CEO's scoping questions, asked before it drafted the org; null when it asked none. */
  scoping?: ScopingView | null;
  /**
   * What the company costs an hour while it works, and what that means on the person's plan, from the proposal before
   * the first start and from the people after it (src/core/cost-estimate.ts); null while there is no org yet.
   */
  estimate?: CostEstimate | null;
  /** v0.2's spending plan: the preset and what each costs, the whole job, the live cost an hour, the budget and the proposal's fixed prompts. */
  spending?: SpendingView;
  /** v0.2: the open questions and approvals, grouped as they were raised (a batch each); empty when nothing waits. */
  batches?: InboxBatch[];
  /** v0.2: the plan that waits for approval, in everyday words (size, what is built first, the estimate); null when none waits. */
  planSummary?: PlanSummary | null;
  /** Why the company can't run, with the fix ("Its folder isn't at C:\Users\jamie\plant-pal any more."). */
  problem: string | null;
  /**
   * When the plan was finished: every task done or dropped, every milestone done and nothing waiting to be committed or
   * approved. Null while work is open, and again once new work comes in.
   */
  done?: number | null;
  /** Work has stopped with tasks still open; null while anything moves (stalledOf in src/company/company.ts). */
  stalled?: StalledView | null;
  /** v0.2: when the stakeholder last opened the company, and the visit before. */
  looked?: CompanyLooks;
  /** v0.2: what happened since the stakeholder last looked (src/core/overview.ts); null on their first look. */
  since?: SinceDigest | null;
  /** v0.2: the checklist of the approved plan, else of the latest version, with the final review's verdicts; null without one. */
  checklist?: ChecklistView | null;
}

/**
 * Work that stopped: for about a minute nobody was at work or waiting for a desk, nothing waited for the stakeholder
 * or for git, and tasks were still open. The office tells the CEO once per stall.
 */
export interface StalledView {
  /** Since when nothing moved. */
  since: number;
  /** The open tasks, each with its owner and the owner's last status line. */
  tasks: { id: string; title: string; owner: string; status: TaskStatus; lastStatus: string | null }[];
  /** For the office to show: "Stalled: t-5 waits on Noor." */
  text: string;
}

/** The CEO's drafting of the org, until it proposes one. */
/**
 * The short series of questions the CEO asks before it drafts the org (ask_scoping), when the first prompt leaves real
 * choices open. The questions are ordinary questions in `CompanyView.questions`, answered in the inbox or the proposal;
 * the answers reach the CEO together, in one message, once the last one applies.
 */
export interface ScopingView {
  /** The questions' ids, in the order the CEO asked them. */
  questions: string[];
  askedAt: number;
  /** When the answers went to the CEO; null while any of them is open or inside its undo window. */
  answeredAt: number | null;
}

export interface DraftingView {
  /** Drafts of the org the office turned down so far. */
  refused: number;
  /** Why the first of them was turned down, in a sentence; null while none was. */
  firstRefusal: string | null;
  /**
   * The CEO's last turn ended without a proposal: when, and the words it ended with (a question in plain text, say;
   * empty when it said nothing). Null while the CEO drafts, and again once a message reaches it.
   */
  stopped: { at: number; words: string } | null;
}

/** A company as the lobby shows it: a small world with who's working and what needs the stakeholder. */
export interface LobbyCompany {
  id: string;
  name: string;
  root: string;
  phase: CompanyPhase;
  theme: Theme;
  /** `name` is the person's first name, for the lobby row's latest line ("Lea: Finished…"). */
  people: { id: string; name?: string; room: string; state: DeskState; look: Look }[];
  working: number;
  waiting: number;
  needsYou: number;
  pause: Pause | null;
  spend: number;
  latest: StatusLine | null;
  problem: string | null;
  /** Start was pressed and the company is hiring everyone and making its branch. */
  starting?: boolean;
  /** v0.2: the company's TL;DR for the lobby card (src/core/overview.ts); absent where a lobby can't build one. */
  summary?: CompanySummary;
}

// ---------------------------------------------------------------------------------------------------------------
// v0.2: the overview of a company, and what happened since the stakeholder last looked (src/core/overview.ts)

// v0.8: 'your-turn' is a plain session that ended its turn with words and waits for nothing else: no prompt, no plan.
export const STAGES = ['scoping', 'waiting', 'your-turn', 'working', 'checking', 'done', 'paused', 'stuck'] as const;
export type CompanyStage = (typeof STAGES)[number];

/** Where a needs-you item opens; the web turns it into an address with companyHref. */
export type NeedsTarget = { panel: 'proposal' } | { panel: 'inbox'; item: string } | { main: 'plan' } | { main: 'progress' };

export interface NeedsYouItem {
  company: string;
  kind: 'proposal' | 'scoping' | 'plan' | 'milestone' | 'question' | 'approval' | 'budget' | 'stuck';
  /** One plain line. */
  text: string;
  /** A person's name; null for the office. */
  from: string | null;
  at: number;
  target: NeedsTarget;
}

export interface CompanySummary {
  /** The stakeholder's words, one line (goalLine). */
  goal: string;
  stage: CompanyStage;
  milestones: { done: number; planned: number };
  /** The plan's tasks; follow-ups aren't counted. */
  tasks: { done: number; planned: number };
  /** At most 3, newest first. */
  achieved: { title: string; by: string; at: number }[];
  /** At most 4. */
  working: { name: string; task: string | null }[];
  /** `count` is the inbox count; `items` everything that waits (work that stopped too), oldest first, at most 100. */
  needs: { count: number; items: NeedsYouItem[] };
  spend: { spent: number; budget: number | null };
  /** The preview's proxy URL while it is up; the hub fills it. */
  preview: string | null;
  movedAt: number | null;
  checklist: Record<ChecklistState, number> | null;
}

/** When the stakeholder last opened the company, and the last look of the visit before. */
export interface CompanyLooks {
  last: number | null;
  previous: number | null;
}

/** A pause longer than this between looks starts a new visit. */
export const LOOK_GAP_MS = 30 * 60_000;

export interface SinceDigest {
  since: number;
  /** At most 12, newest first; files at most 8 each. */
  finished: { title: string; by: string; at: number; files: string[] }[];
  finishedCount: number;
  /** At most 8, newest first. */
  decisions: { what: string; by: string; at: number }[];
  decisionCount: number;
  spent: number;
  /** Questions and approvals open now. */
  waiting: number;
}

export interface LobbyView {
  companies: LobbyCompany[];
  hub: {
    maxDesks: number;
    /** People at work across companies (each company's `working`). */
    working: number;
    /**
     * Desks the hub's gate holds across companies, against `maxDesks`: open desks, idle and closing ones included, which
     * is what "desks in use" counts (a person at work is a subset). Optional until every writer of a lobby sets it.
     */
    inUse?: number;
    /**
     * The plan's usage limit, which every company rests through together once one of them meets it: since and until
     * when. Companies added meanwhile rest too, so nobody's turn starts before then. Null while nothing rests on it.
     */
    rest?: { since: number; until: number } | null;
  };
  serverTime: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Between the parts: what the org tools and the office's API ask of a company, and what a company asks of the
// switchboard. Inputs reach these already shaped and capped by the caller; the company checks the org rules.

/** A refusal the org tools and the office show as it is: a sentence saying why, and what to do instead. */
export class OrgRefusal extends Error {
  /** A word for programs: "not-allowed", "unknown", "invalid", "busy", "conflict", "closed". */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface AskInput {
  text: string;
  options: string[];
  recommended: number | null;
  /**
   * 'manager': a message to their manager. 'stakeholder': a question in the inbox, with a copy to their manager, but only
   * from the CEO; anyone else's goes to their manager (to the CEO when they have none), who decides what reaches the stakeholder.
   */
  to: 'manager' | 'stakeholder';
  taskId: string | null;
  /** v0.2: every option is reversible and stays inside the company, so the asker's pick stands if nobody answers in time. */
  safe?: boolean;
  /** v0.2: what the asker does if nobody answers, when the pick doesn't stand. */
  fallback?: string | null;
}

export interface AssignInput {
  to: string;
  title: string;
  brief: string;
  files: string[];
  doneWhen: string;
  parent: string | null;
  milestone: string | null;
  /** Long or risky work: give it its own worktree and branch. */
  worktree: boolean;
  /** Steering: the message ids this task answers. */
  cites?: string[];
}

/**
 * A hire after the start. `role` is a library role, or the id of the role `written` describes when the library has none
 * for the area; `id` gives a second person with the same library role their own id ("frontend-engineer-2").
 */
export interface HireInput {
  role: string;
  /** Left out, the room the role belongs to (the stakeholder's reshape from the org chart). */
  room?: string;
  /** Left out, the head of the room they join, or the CEO when it has none. */
  reportsTo?: string;
  name: string | null;
  title: string | null;
  level?: Level;
  id?: string;
  written?: NewRole;
}

/** An office change (`change_office`, the Customize panel). Each change is one of these; all are reversible. */
export type OfficeChange =
  | { change: 'theme'; theme: Theme }
  | { change: 'add-room'; room: OfficeRoom }
  | { change: 'remove-room'; room: string }
  | { change: 'room-theme'; room: string; theme: Theme | null }
  | { change: 'decor'; add: string[]; remove: string[] }
  | { change: 'look'; person: string; look: Look };

/** A role the CEO can hire, as `library_catalogue` lists it. */
export interface CatalogueEntry {
  id: string;
  title: string;
  department: string;
  description: string;
  model: string;
}

/** Implemented by the company (`src/company/`); called by the org tools for a desk and by the office's API. */
export interface CompanyApi {
  readonly id: string;
  people(): Person[];
  view(): CompanyView;

  // Everyone. `by` is the calling person, from their desk's token.
  /** `cites`: the message ids the status line or report answers (steering's trace lists it). */
  postStatus(by: string, text: string, taskId: string | null, cites?: string[]): StatusLine;
  report(by: string, input: { taskId: string | null; outcome: Report['outcome']; text: string; cites?: string[]; form?: ReportForm }): Report;
  message(by: string, to: string, text: string): Message;
  ask(by: string, input: AskInput): Question | Message;
  tasks(by: string, filter: { owner?: string; status?: TaskStatus }): Task[];
  shareScreenshot(by: string, input: { png: Uint8Array; caption: string }): Screenshot;

  // Heads, team leads and the CEO.
  assign(by: string, input: AssignInput): Task;
  relay(by: string, input: { message: string; to: string[]; note: string | null }): Message[];
  review(by: string, input: { taskId: string; verdict: 'accept' | 'return'; note: string }): Task;

  // The CEO (and the office manager for changeOffice).
  libraryCatalogue(by: string): CatalogueEntry[];
  /**
   * The CEO's scoping questions before it drafts the org: one to five, each with two to four options, its pick and why.
   * Only while founding, and once; the answers come back to the CEO in one message once the last one applies.
   */
  askScoping(by: string, questions: unknown): Question[];
  /** `notes`: what the office cut or dropped in the CEO's proposal instead of refusing it (v0.2). */
  proposeOrg(by: string, proposal: unknown): { ok: true; proposal: OrgProposal; notes?: string[] } | { ok: false; errors: string[] };
  askStakeholder(by: string, input: Omit<AskInput, 'to'>): Question;
  setGoal(by: string, input: { text: string; milestones: { title: string; doneWhen: string }[] }): Goal;
  publishDashboard(by: string, dashboard: unknown): { ok: true; dashboard: Dashboard } | { ok: false; error: string };
  /** Takes a published dashboard down: the CEO, or the stakeholder from the office. */
  removeDashboard(by: string, id: string): Dashboard;
  hire(by: string, input: HireInput): ReshapeResult;
  fire(by: string, role: string): ReshapeResult;
  move(by: string, input: { role: string; room: string; reportsTo: string | null }): ReshapeResult;
  rehire(by: string, role: string): ReshapeResult;
  changeOffice(by: string, change: OfficeChange): ReshapeResult;

  // The stakeholder, from the office. `typed`: the stakeholder typed these words in a box (Message.typed).
  /**
   * `studio`: the studio chat's message to the CEO (Message.fromStudio), never typed and never the stakeholder's word; the
   * CEO's turn's last words come back as its reply.
   */
  say(to: string, text: string, options?: { typed?: boolean; studio?: boolean }): Message;
  /** Takes back a message that hasn't reached its person yet. */
  unsend(messageId: string): Message;
  /** Only an instruction the stakeholder typed is marked typed; an empty one gets the office's default words. */
  stop(person: string, instruction: string, options?: { typed?: boolean }): Message;
  /** Answers take effect UNDO_MS after the press; undo before then puts the item back. */
  answer(questionId: string, input: { option: number | null; text: string }): Question;
  /** Answers every open scoping question with the CEO's pick, each with its own undo window. */
  answerWithPicks(): Question[];
  decide(approvalId: string, input: { decision: 'allow' | 'deny'; always: boolean; note: string | null }): Approval;
  undo(itemId: string): Question | Approval;
  /** The stakeholder's own edit of the proposal, checked like the CEO's; restoreProposal goes back to the CEO's. */
  editProposal(proposal: unknown): { ok: true; proposal: OrgProposal } | { ok: false; errors: string[] };
  restoreProposal(): OrgProposal;
  start(): void;
  pause(): void;
  resume(): void;
  /** "Open in Claude Code": closes their desk and keeps it closed; bringBack reopens it on the same session. */
  handOver(person: string): DeskView;
  bringBack(person: string): DeskView;
  updateSettings(input: { maxDesks?: number; removeRule?: string }): CompanySettings;
  /**
   * v0.2: the thoroughness preset, before the start. It sets the desks at once and the models by level, for whatever the
   * stakeholder hasn't set otherwise, and with `resize` (the default) asks the CEO to revise a proposal that is out.
   */
  setPreset(preset: PresetId, options?: { resize?: boolean }): CompanySettings;
  /** v0.2: the company's and each person's budget, in dollars; null clears one. At least one key. */
  setBudget(change: { company?: number | null; person?: number | null }): CompanySettings;
  /** v0.2: the model for everyone at a level, in one action, before the start: the settings and the proposal change together. */
  setModels(change: Partial<ModelsByLevel>): { settings: CompanySettings; proposal: OrgProposal | null };
  markSeen(person: string): void;
  /** v0.2: the stakeholder opened the company (or still has it open); calls within a minute of the last are ignored. */
  markLooked(): void;
}

/** A turn's end, as the switchboard reads it from Claude Code's result. */
export interface TurnResult {
  sessionId: string;
  ok: boolean;
  /** The turn's final text, masked. */
  text: string;
  /** Claude Code's reported cost; in plan mode an estimate from usage, never the fork-inclusive total. */
  costUsd: number | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** The latest prompt's size, for tiredness. */
  contextTokens: number | null;
  durationMs: number;
  /** Why it failed, in a sentence. */
  problem: string | null;
}

/** What the company gives the switchboard to open a person's desk. */
export interface DeskPlan {
  person: Person;
  /** The agent file to run as (`--agent`), when the role has one. */
  agent: string | null;
  model: string;
  /** The project's checkout, or the task's worktree. */
  cwd: string;
  /** Resume this session; null starts a new one. */
  sessionId: string | null;
  /**
   * v0.2: the office dropped this person's session at a handover. A seat that remembers a session of its own forgets it
   * when this is set with no `sessionId`, so the next desk is a new session and not a resume.
   */
  fresh?: boolean;
  /** Appended to the system prompt: the house rules, their place in the org and how messages reach them. */
  systemPrompt: string;
  /** Steering: Claude Code's --effort for this person; null leaves Claude Code's default. */
  effort?: Effort | null;
  /** Steering: the person's leash, for the approvals policy. */
  leash?: Leash;
  /**
   * v0.2: what this person's desk loads (their role's `loads` in studio.yaml). Left out, the defaults of their level;
   * the switchboard resolves it either way, so every desk starts lean.
   */
  loads?: Loads;
  /**
   * v0.4 (SPEC-v0.4.md, H5): this desk is a harness company's Tester, who writes the acceptance tests into
   * `.worklings-shared/acceptance/`; every other desk only reads that folder.
   */
  writesAcceptance?: boolean;
  /**
   * v0.7 (SPEC-v0.7.md): a plain company's desk, launched as plain Claude Code with these choices and only the allowed
   * differences (src/runtime/plain-desk.ts). Its turns are the person's words verbatim, with no fence.
   */
  plain?: PlainDesk;
}

/** Implemented by the switchboard (`src/runtime/`); called by the company. */
export interface DeskControl {
  /** Hands a person a turn: written to their open desk, or opens one. Waits while the company is at its cap or resting. */
  deliver(plan: DeskPlan, turn: { text: string; messageId: string | null; priority?: number }): void;
  /** Interrupts the person's turn, then gives them the instruction as their next turn. */
  stop(plan: DeskPlan, turn: { text: string; messageId: string | null }): void;
  /** Takes a turn back while it still waits for a desk; false once it was written to the person. */
  withdraw(messageId: string): boolean;
  close(person: string): Promise<void>;
  closeAll(): Promise<void>;
  desks(): DeskView[];
  setMaxDesks(n: number): void;
  /**
   * How long an idle desk stays open, changed while the company runs: desks already idle count on from when they went
   * idle with the new time, and those already idle longer than it close now.
   */
  setIdleMs(ms: number): void;
  /** Rest until the time given (a usage limit) or until resumed; open desks finish their turn first. */
  pause(until: number | null): void;
  resume(): void;
}

/** An approval the switchboard's policy wants the stakeholder to give. */
export interface ApprovalAsk {
  tool: string;
  summary: string;
  detail: string;
  kind: AskKind;
  expiresAt: number;
  alwaysRule: { rule: string; sentence: string } | null;
  /** v0.2: what the policy advises (recommendation, why, what to do instead); the company keeps it with the approval. */
  advice?: ApprovalAdvice;
}

/** A company as the hub holds it (`src/company/index.ts`): the API plus what the hub needs to serve it. */
export interface CompanyHandle extends CompanyApi {
  /** v0.7: the studio a plain company keeps in memory, which the hub's office draws; null when it is on disk. */
  memoryStudio?(): Studio | null;
  /** Called after every change; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /**
   * v0.2: one press for a batch of asks (`InboxBatch.id`): each question takes its asker's pick (its own undo window), and
   * each approval its recommendation, which is a no unless the advice says to allow, never as "always". A question without
   * a pick stays open and is named in `left`.
   */
  answerBatch(batch: string): { questions: Question[]; approvals: Approval[]; left: string[] };
  lobbyEntry(): LobbyCompany;
  /**
   * What each person's transcripts show they have spent, as the office reads them. A turn is priced only when it ends,
   * so what the transcripts show beyond what the company recorded is kept: a restart then reads what it read before.
   */
  noteSpend(spent: ReadonlyMap<string, number>): void;
  /** Session id to person for every desk that has worked, so the office shows them as that person. */
  sessions(): ReadonlyMap<string, string>;
  /**
   * Puts an approval in the inbox and resolves once the stakeholder's answer takes effect, or with a no when it
   * expires. `signal` withdraws it when the person's hook gives up first.
   */
  requestApproval(person: string, ask: ApprovalAsk, signal?: AbortSignal): Promise<ApprovalAnswer>;
  /** A task's diff as text, from git (its commit, its open files or its worktree), masked and capped. */
  diff(taskId: string): Promise<string>;
  /**
   * Up to `limit` (1 to MESSAGE_PAGE.max) of the messages kept before message `before`, newest first, shown as the view
   * shows messages, with their acknowledgements. OrgRefusal('unknown') when the company keeps no message `before`.
   */
  earlierMessages(before: string, limit: number): MessagePage;
  /**
   * v0.3: the brief of the portfolio the company is in (src/studio/), shared by every company in it, or null. It goes into
   * the company's brief file, never into a desk's appended prompt, which stays byte-for-byte the same for the prompt cache.
   * Optional until every company implements it; the hub sets it after a company opens and whenever it changes.
   */
  setSharedBrief?(brief: SharedBrief | null): void;
  close(): Promise<void>;
}

/** v0.3: a portfolio's shared brief, as a member company's brief file carries it. */
export interface SharedBrief {
  /** The portfolio's name. */
  portfolio: string;
  /** The stakeholder's words for every company in it. */
  text: string;
}

/** The org flow's writes (`src/org/index.ts`), so a company never writes `.claude/` itself. */
export interface OrgOps {
  /** A new company: the studio and agent file for the CEO alone. */
  /** v0.4: `title` names the CEO seat ("Lead" in a harness company); the library's title when left out. */
  found(root: string, prompt: string, title?: string): ReshapeResult;
  /** The CEO's first turn: the stakeholder's prompt, what detection found and what to do. */
  /** v0.4: `shape` the company's (classic when left out); `brief` the brief file's path, which a long first prompt is read from. */
  openingTurn(input: { prompt: string; detected: string; studio: Studio | null; preset?: PresetId; models?: ModelsByLevel; shape?: 'plain' | 'solo' | 'harness' | 'classic'; brief?: string | null }): string;
  catalogue(): CatalogueEntry[];
  /** The CEO's proposals are held to a size's shape (src/core/size.ts) under the preset; the stakeholder's own edits pass `enforceSize: false`. */
  /**
   * `preset`: the stakeholder's preset, which caps the size (Balanced when not given). `models`: what a person with no model gets, by level. For the CEO's proposals (enforceSize left on) `inherit` counts as
   * no model too, since the CEO writes it out of habit; the stakeholder's edit keeps an explicit `inherit`, their own model.
   */
  check(raw: unknown, options?: { enforceSize?: boolean; models?: ModelsByLevel; preset?: PresetId; harness?: boolean; solo?: boolean }): { ok: true; proposal: OrgProposal; notes?: string[] } | { ok: false; errors: string[] };
  /** Writes an accepted proposal as agents and studio.yaml. */
  write(root: string, proposal: OrgProposal): ReshapeResult;
  hire(root: string, input: HireInput): ReshapeResult;
  /** Fires a role; the people who reported to them move to their manager, and come back with a rehire. */
  fire(root: string, role: string): ReshapeResult;
  move(root: string, input: { role: string; room: string; reportsTo: string | null }): ReshapeResult;
  rehire(root: string, role: string): ReshapeResult;
  changeOffice(root: string, change: OfficeChange): ReshapeResult;
  /** A person's model (a ROLE_MODELS alias) in their agent file, through reshape; it applies at their next desk. */
  model(root: string, input: { role: string; model: string }): ReshapeResult;
}

/** What every company is built with; the hub passes the real ones, tests pass fakes. */
export interface CompanyDeps {
  /** The hub's key that signs the company's event log. */
  key: Uint8Array;
  org: OrgOps;
  /** Makes the company's switchboard, which reports back through the events it is given. */
  desks: (events: DeskEvents, companyId: string) => DeskControl;
  now?: () => number;
  /**
   * The environment the desks run in, for `ANTHROPIC_MODEL`: when it names a model, that model runs everyone, as it did
   * before the preset's models existed. process.env when not given.
   */
  env?: Readonly<Record<string, string | undefined>>;
}
/** `id` is the hub's choice, so its registry and desk tokens use it from the start; one is made when absent. */
export type CreateCompany = (o: CompanyDeps & { root: string; prompt: string; stakeholder: string; id?: string }) => CompanyHandle;
export type OpenCompany = (o: CompanyDeps & { root: string }) => CompanyHandle;

/** What the switchboard tells the company. */
export interface DeskEvents {
  desk(view: DeskView): void;
  /**
   * A message reached its person: `how` says whether it joined a turn already running, at its next step ('next-step'),
   * or opened a turn of its own ('new-turn'); left out where the desk didn't say.
   */
  delivered(messageId: string, at: number, how?: 'next-step' | 'new-turn'): void;
  /**
   * A person's session id, and from Claude Code's init line where its sign-in comes from: 'none' for the user's own
   * Claude plan, the key's source ('ANTHROPIC_API_KEY', 'apiKeyHelper'...) when it bills per token.
   */
  session(person: string, sessionId: string, account?: { apiKeySource: string | null }): void;
  turn(person: string, result: TurnResult): void;
  /**
   * v0.8: a desk's session began a turn with none of the office's messages to open it: Claude Code went on by itself, as
   * when a background task it started reports back.
   */
  ownTurn?(person: string): void;
  /** Claude Code reported a usage limit or an overload; `until` is the reset time it gave. */
  limited(until: number | null, message: string, reason: 'usage-limit' | 'overloaded'): void;
  /** How a desk was started when it matters to the stakeholder (it came up the standard way, and why): one plain sentence. */
  notice?(sentence: string): void;
  /** v0.7: what a desk's stream said about its own todo list and its subagents (src/core/desk-work.ts). */
  work?(person: string, signals: WorkSignal[]): void;
  /**
   * v0.7: a prompt a plain desk's stdio host must answer (plan first's ExitPlanMode, which only the host can approve): the
   * company puts it in the inbox and resolves with the stakeholder's answer.
   */
  approve?(person: string, ask: ApprovalAsk, signal?: AbortSignal): Promise<ApprovalAnswer>;
}
