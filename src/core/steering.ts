// The steering contracts (SPEC-v3.md "Steering"; Robin, 5 Nov 2026, "all six"): the plan, audiences, acknowledgements
// and traces, the task board's controls, the decision log and the leash. Types and constants only, owned by the lead
// like company.ts; docs/architecture.md ("Steering") says which stream implements what. The fields steering adds to
// company.ts's Task, Message, Report, StatusLine, Question, DeskPlan and CompanyView are optional there until every
// writer sets them, so v3 keeps building while the streams land.
import type { AcceptCheck } from './acceptance.ts';
import type { Message, Task, TaskStatus } from './company.ts';

/** Org tools the steering features add, merged into ORG_TOOLS by the org tools stream as it serves them. */
export const STEERING_TOOLS = {
  everyone: ['ack', 'decide'],
  managers: ['steer_task'],
  ceo: ['propose_plan', 'approve_plan', 'change_settings'],
  /** v0.2: the CEO and the checker seats (QA, testers, reviewers), who give the final review: its verdicts on the checklist. */
  checkers: ['mark_checklist'],
} as const;
export type SteeringTool = (typeof STEERING_TOOLS)[keyof typeof STEERING_TOOLS][number];

// ---------------------------------------------------------------------------------------------------------------
// 1. Approve the plan

export const PLAN_APPROVALS = ['before-work', 'milestones', 'off'] as const;
export type PlanApproval = (typeof PLAN_APPROVALS)[number];
/** New companies wait for the stakeholder's approval of the plan before work starts. */
export const DEFAULT_PLAN_APPROVAL: PlanApproval = 'before-work';
/** Companies founded before the setting existed keep running as they did. */
export const LEGACY_PLAN_APPROVAL: PlanApproval = 'off';

export const PLAN_LIMITS = { milestones: 12, tasks: 80, after: 12, title: 120, goal: 1000, brief: 4000, doneWhen: 1000, note: 1000, comment: 2000, contracts: 24, contractSummary: 600, dependents: 12, check: 200 } as const;

export interface PlanMilestone {
  /** Stable across versions ("ms-2"), so a diff can tell a change from a removal. */
  id: string;
  title: string;
  doneWhen: string;
}

export interface PlanTask {
  /** Stable across versions ("p-7"); the task made from it keeps it as `Task.planTask`. */
  id: string;
  title: string;
  /** A person's id. */
  owner: string;
  /** Files or folders the owner may change; open tasks never share one. */
  files: string[];
  milestone: string;
  /** Plan task ids this one waits for. */
  after: string[];
  brief: string;
  doneWhen: string;
  /**
   * v0.2: one command the office can run to see the task is done (`npm test`, `npm run typecheck && npm test`,
   * `node --test`): a plain command line of up to PLAN_LIMITS.check characters, with no pipes, redirects or
   * substitution. The CEO's plan gives one to every task a maker does; it is only stored and shown here, and absent from
   * plans saved before 0.2 and from the stakeholder's own tasks.
   */
  check?: string;
  /**
   * What a task is for, when it isn't building a part. "integration" builds and runs the whole milestone together and
   * checks it against the contracts; "verification" checks the finished work against the stakeholder's own words, by
   * someone who didn't build it. Absent for ordinary tasks, and for every plan saved before 0.2.
   */
  kind?: PlanTaskKind;
}

export const PLAN_TASK_KINDS = ['integration', 'verification'] as const;
export type PlanTaskKind = (typeof PLAN_TASK_KINDS)[number];

/**
 * An interface two or more streams of the plan share (an API's routes and shapes, a data schema, a shared module's
 * exports), agreed first: it lives in a real file of the project, one task writes that file, and the tasks that build
 * against it wait for that task.
 */
export interface PlanContract {
  /** Stable across versions ("c-1"). */
  id: string;
  title: string;
  /** The project file (or folder) it lives in, relative to the project; inside the writer's files. */
  file: string;
  /** The plan task that writes it. */
  writer: string;
  /** Plan task ids that build against it; each waits for the writer. */
  dependents: string[];
  /** What it settles, in a line or two. */
  summary?: string;
}

/** The CEO's plan. The order of `tasks` is their priority. `contracts` is absent when a plan names none. */
export interface Plan {
  goal: string;
  milestones: PlanMilestone[];
  tasks: PlanTask[];
  contracts?: PlanContract[];
  /** v0.2: what the stakeholder asked for, as checkable sentences (src/core/checklist.ts); absent on plans saved before it. */
  checklist?: ChecklistItem[];
}

export const CHECKLIST_LIMITS = { items: 20, text: 200, quote: 400, covers: 12, evidence: 600, files: 8, page: 200 } as const;

/** One thing the stakeholder asked for, as a short checkable sentence. */
export interface ChecklistItem {
  /** Stable across versions: "k-1" from the CEO, "k-s1" for the stakeholder's own. */
  id: string;
  text: string;
  /** Their words, exactly as written in the request or a typed message; null when no words fit. */
  quote: string | null;
  /** Plan task ids that build it. Never the final review (kind "verification"). */
  covers: string[];
  /** v0.3: how the office accepts it before anyone judges it (src/core/acceptance.ts); absent when none was written. */
  accept?: AcceptCheck;
}

export const VERDICTS = ['met', 'partly', 'not-met'] as const;
export type Verdict = (typeof VERDICTS)[number];
export type ChecklistState = Verdict | 'unchecked';

/** What the final review saw for one checklist item. */
export interface ChecklistEvidence {
  /** What was seen, up to CHECKLIST_LIMITS.evidence characters. */
  note: string;
  /** The command run and its result. */
  check: { ran: string; passed: boolean } | null;
  /** Project paths, up to CHECKLIST_LIMITS.files. */
  files: string[];
  /** A path on the preview ("/menu"), matching CHECKLIST_PAGE. */
  page: string | null;
}

/** A path on the preview a verdict may point at; never `//host/x`, which a browser reads as another site. */
export const CHECKLIST_PAGE = /^\/(?![/\\])[\w\-./?=&%#]*$/;

export interface ChecklistVerdict {
  item: string;
  /** The plan version whose checklist was judged. */
  version: number;
  verdict: Verdict;
  evidence: ChecklistEvidence;
  by: string;
  /** The review task it was given on. */
  task: string;
  at: number;
}

/** One item of mark_checklist, as the tool takes it. */
export type VerdictInput = { item: string; verdict: Verdict; evidence: string; files: string[]; check: { ran: string; passed: boolean } | null; page: string | null };

export interface ChecklistRow extends ChecklistItem {
  state: ChecklistState;
  verdict: ChecklistVerdict | null;
  /** The covering tasks: the plan task, the board task made from it (null before it is), its title and where it stands. */
  tasks: { planTask: string; task: string | null; title: string; status: TaskStatus | 'planned' }[];
}

export interface ChecklistView {
  version: number;
  rows: ChecklistRow[];
  counts: Record<ChecklistState, number>;
  /** When the newest verdict shown was given; null before any. */
  reviewedAt: number | null;
}

export interface PlanVersion {
  version: number;
  /** The CEO, or STAKEHOLDER for the stakeholder's own edit. */
  by: string;
  at: number;
  plan: Plan;
  /** What this version changes, in its author's words. */
  note: string | null;
  /** Messages it answers, such as the stakeholder's "revise it". */
  cites: string[];
}

export interface PlanComment {
  id: string;
  at: number;
  by: string;
  version: number;
  on: { kind: 'plan' } | { kind: 'milestone'; id: string } | { kind: 'task'; id: string };
  text: string;
  /** The message that carried it to the CEO. */
  message: string | null;
}

export interface PlanApprovalState {
  version: number;
  /** Approved through this milestone ("at every milestone"); null approves the whole plan. */
  through: string | null;
  at: number;
  /** STAKEHOLDER, or the CEO acting on the cited message. */
  by: string;
  cites: string[];
}

export interface PlanView {
  /** Oldest first; the view carries the latest STEERING_VIEW_LIMITS.planVersions. */
  versions: PlanVersion[];
  approved: PlanApprovalState | null;
  comments: PlanComment[];
  /** At every milestone: the milestone that is done and waits for the stakeholder before the next one starts. */
  waiting: { milestone: string; since: number; report: string | null } | null;
}

/** What changed between two versions, for the plan's diff view. */
export interface PlanDiff {
  goal: { before: string; after: string } | null;
  milestones: {
    added: PlanMilestone[];
    removed: PlanMilestone[];
    changed: { before: PlanMilestone; after: PlanMilestone }[];
    /** Ids of milestones whose place in the order changed. */
    moved?: string[];
  };
  tasks: {
    added: PlanTask[];
    removed: PlanTask[];
    changed: { before: PlanTask; after: PlanTask; fields: (keyof PlanTask)[] }[];
    /** Ids of tasks whose place in the order changed. */
    moved: string[];
  };
  /** v0.2: absent when neither version has a checklist. */
  checklist?: { added: ChecklistItem[]; removed: ChecklistItem[]; changed: { before: ChecklistItem; after: ChecklistItem }[] };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Message a room, a team or everyone

export type Recipient =
  | { kind: 'person'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'team'; head: string }
  | { kind: 'everyone' };

/** On each person's copy of a message sent to more than one person, and named in their turn. */
export interface Audience {
  kind: 'room' | 'team' | 'everyone';
  /** The room's id or the head's id; null for everyone. */
  id: string | null;
  /** As the turn says it: "the design room", "Ada's team", "everyone". */
  title: string;
  /** Shared by every copy, so the trace and the 3D view see one message. */
  group: string;
}

/** How long an all-hands keeps people gathered in the 3D view before they go back to their desks. */
export const ALL_HANDS_MS = 6_000;

// ---------------------------------------------------------------------------------------------------------------
// 3. See your message land

/** After this long without an acknowledgement, a delivered message is flagged. */
export const ACK_WINDOW_MS = 10 * 60_000;

export interface Ack {
  id: string;
  /** The person's own copy of the message they acknowledge. */
  message: string;
  by: string;
  /** False when they disagree; `text` then says why. */
  agree: boolean;
  /** One sentence: what they will do with it, or why they disagree. */
  text: string;
  at: number;
}

export const TRACE_FLAGS = ['not-delivered', 'no-ack', 'not-passed-on', 'not-reached'] as const;
export type TraceFlagKind = (typeof TRACE_FLAGS)[number];

export interface TraceFlag {
  kind: TraceFlagKind;
  /** Who it hasn't reached, or who hasn't acknowledged it. */
  person: string;
  /** Who holds it now: the person Remind nudges. */
  holder: string;
  since: number;
  /** "Not passed on to the UI designer yet." */
  sentence: string;
}

export interface TraceStop {
  person: string;
  /** Their copy of the message. */
  message: string;
  /** Who passed it to them; null when the stakeholder sent it to them directly. */
  via: string | null;
  deliveredAt: number | null;
  how: 'next-step' | 'new-turn' | null;
  ack: Ack | null;
}

export interface TraceCite {
  kind: 'task' | 'report' | 'status' | 'decision' | 'commit' | 'plan';
  id: string;
  by: string;
  at: number;
  /** A sentence about it, for the trace's list. */
  text: string;
}

/** Where one stakeholder message went, worked out from the view (no extra state). */
export interface MessageTrace {
  message: string;
  stops: TraceStop[];
  cites: TraceCite[];
  flags: TraceFlag[];
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Steer the task board

export interface TaskPause {
  at: number;
  by: string;
}

export interface TaskCancel {
  at: number;
  by: string;
  reason: string;
  /** The branch the work stays on: the worktree's, or one the office made from the shared checkout. */
  branch: string | null;
}

export interface TaskHandover {
  at: number;
  by: string;
  from: string;
  to: string;
  note: string;
}

export interface NewTaskInput {
  title: string;
  brief: string;
  files: string[];
  owner: string;
  doneWhen: string;
  milestone: string | null;
}

/** A manager's or the CEO's control of a task, by tool; `cites` names the stakeholder's message when they asked. */
export type TaskSteer =
  | { action: 'pause' | 'resume'; task: string; cites: string[] }
  | { action: 'cancel'; task: string; reason: string; cites: string[] }
  | { action: 'reassign'; task: string; to: string; note: string; cites: string[] }
  | { action: 'order'; tasks: string[]; cites: string[] }
  /** Every open task of the room's people, paused or resumed together. */
  | { action: 'pause-room' | 'resume-room'; room: string; cites: string[] };

// ---------------------------------------------------------------------------------------------------------------
// 5. The decision log

export const DECISION_KINDS = ['answer', 'approval', 'rule', 'plan', 'org', 'office', 'setting', 'leash', 'task', 'decide', 'undo', 'reconsider'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_LIMITS = { what: 300, why: 1000, alternatives: 4, alternative: 300, note: 1000 } as const;

export interface DecisionLinks {
  message?: string;
  task?: string;
  question?: string;
  approval?: string;
  planVersion?: number;
  /** For an undo or a reconsider: the decision it acts on. */
  decision?: string;
}

export interface Decision {
  id: string;
  at: number;
  /** A person, STAKEHOLDER or THE_OFFICE. */
  by: string;
  kind: DecisionKind;
  /** In a sentence: "Robin approved version 3 of the plan." */
  what: string;
  why: string | null;
  alternatives: string[];
  /** Everyone it concerns, the decider first: the person filter. */
  people: string[];
  /** The rooms it concerns: the room filter. */
  rooms: string[];
  links: DecisionLinks;
  /** Whether Undo can take it back now. */
  reversible: boolean;
  undone: { at: number; by: string; decision: string } | null;
  reconsider: { at: number; note: string; message: string } | null;
}

// ---------------------------------------------------------------------------------------------------------------
// 6. The leash, and model and effort per person

export const LEASHES = ['check', 'default', 'trusted'] as const;
export type Leash = (typeof LEASHES)[number];

/** Claude Code's `--effort` levels (2.1.312's --help). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface LeashSettings {
  /** A person's own setting wins over their room's. */
  people: Record<string, Leash>;
  rooms: Record<string, Leash>;
}

export interface SteeringSettings {
  planApproval: PlanApproval;
  leash: LeashSettings;
  /** Per person; absent means Claude Code's default. */
  effort: Record<string, Effort>;
}

export interface PersonSteering {
  leash: Leash;
  leashFrom: 'person' | 'room' | 'company';
  effort: Effort | null;
}

/** One change to the company's settings: from the office, or by the CEO on the stakeholder's word. */
export interface SettingsChange {
  maxDesks?: number;
  idleMs?: number;
  planApproval?: PlanApproval;
  /** null clears that person's or room's own leash. */
  leash?: { person: string; leash: Leash | null } | { room: string; leash: Leash | null };
  effort?: { person: string; effort: Effort | null };
  model?: { person: string; model: string };
  removeRule?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// What the view carries, and the API

export const STEERING_VIEW_LIMITS = { acks: 300, decisions: 300, planVersions: 10, comments: 100 } as const;

export interface SteeringView {
  plan: PlanView | null;
  acks: Ack[];
  decisions: Decision[];
  settings: SteeringSettings;
  /** Per person id. */
  people: Record<string, PersonSteering>;
}

/**
 * The company implements it; the hub's routes and the org tools call it. `by` is STAKEHOLDER from the office or the
 * calling person from their desk's token. Where the CEO acts for the stakeholder (approvePlan, changeSettings), `cites`
 * must name a message the stakeholder typed to the CEO (Message.typed), newer than what it changes, or the call is
 * refused; making someone Trusted that way waits for the stakeholder's yes in the inbox.
 */
export interface SteeringApi {
  // The plan.
  /** `notes`: what the office cut or changed in the CEO's plan instead of refusing it (v0.2). */
  proposePlan(by: string, input: unknown): { ok: true; version: PlanVersion; notes?: string[] } | { ok: false; errors: string[] };
  editPlan(by: string, input: { plan: unknown; note: string | null }): { ok: true; version: PlanVersion } | { ok: false; errors: string[] };
  approvePlan(by: string, input: { version: number; through: string | null; cites: string[] }): PlanApprovalState;
  commentPlan(by: string, input: { on: PlanComment['on']; text: string }): PlanComment;

  // Messages to a room, a team or everyone; acknowledgements; following a message. `typed` counts only from the stakeholder.
  send(by: string, input: { to: Recipient; text: string; for: string[]; typed?: boolean }): Message[];
  ack(by: string, input: { message: string; agree: boolean; text: string }): Ack;
  remind(by: string, input: { message: string; person: string }): Message;
  escalate(by: string, input: { message: string; person: string }): Message;

  // The task board.
  steerTask(by: string, input: TaskSteer): Task[];
  createTask(by: string, input: NewTaskInput & { cites: string[] }): Task;

  // The decision log.
  recordDecision(by: string, input: { what: string; why: string; alternatives: string[]; cites: string[] }): Decision;
  undoDecision(by: string, id: string): Decision;
  reconsider(by: string, input: { decision: string; note: string }): Message;

  // Settings, the leash, model and effort.
  changeSettings(by: string, input: SettingsChange & { cites: string[] }): SteeringSettings;

  // v0.2: the final review's verdicts on the checklist, by the review task's owner, on that task.
  markChecklist(by: string, input: { task: string; items: VerdictInput[] }): ChecklistVerdict[];
}
