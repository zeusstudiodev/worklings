// Steering's state and the reducer over its events (SPEC-v3.md "Steering": the plan, the task board, the leash and the
// decision log). The company keeps it beside its own state, under `steering`, and folds these events like its own; the
// fields steering adds to a task (priority, paused, cancel, handovers, planTask, cites) change here too, so a replay of
// the log gives the same board. Acknowledgements are the messages stream's (trace-state.ts). Pure and free of Node
// APIs, like the rest of src/core: the demo and the web app can use the projection.
//
// No runtime import from company-state.ts: it folds these events, so importing back would make a cycle.
import type { OfficeChange, Person, Task } from './company.ts';
import {
  type Ack,
  type ChecklistVerdict,
  type Decision,
  type Effort,
  EFFORTS,
  type Leash,
  LEASHES,
  LEGACY_PLAN_APPROVAL,
  PLAN_APPROVALS,
  type PersonSteering,
  type PlanApproval,
  type PlanApprovalState,
  type PlanComment,
  type PlanVersion,
  type PlanView,
  type SettingsChange,
  STEERING_VIEW_LIMITS,
  type SteeringSettings,
  type SteeringView,
  type TaskCancel,
  type TaskHandover,
  type TaskPause,
} from './steering.ts';

const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

function withEntry<T>(record: Readonly<Record<string, T>>, key: string, value: T): Record<string, T> {
  const copy = Object.assign(dict<T>(), record);
  copy[key] = value;
  return copy;
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = Object.assign(dict<T>(), record);
  delete copy[key];
  return copy;
}

const newest = <T>(list: readonly T[], max: number): T[] => list.slice(Math.max(0, list.length - max));

/** How much the state keeps, oldest dropped first: plan versions (the approved one always stays), comments, decisions. */
export const STEERING_STATE_LIMITS = { planVersions: 30, comments: 500, decisions: 2_000, verdicts: 200 } as const;

/** Ids steering makes besides the company's own: decisions ("d-4") and plan comments ("c-2"). */
export const STEERING_ID_KINDS = ['decision', 'comment'] as const;
export type SteeringIdKind = (typeof STEERING_ID_KINDS)[number];
export const STEERING_ID_PREFIX: Readonly<Record<SteeringIdKind, string>> = { decision: 'd', comment: 'c' };

/** The fields a plan's new version can change on a task made from it. */
export type TaskFields = Partial<Pick<Task, 'title' | 'brief' | 'files' | 'doneWhen' | 'milestone' | 'owner' | 'askedBy'>>;

/** A cancelled task's work on its way to a branch. */
export interface Saving {
  /** The stops and notices the owners get first: the save waits until each reached them, or can't any more. */
  after: string[];
  /** The cancelled tasks whose work this save keeps: the task, and its parts in the same checkout. */
  covers: string[];
}

/** Making someone Trusted by talking, waiting for the stakeholder's yes in the inbox. */
export interface Confirm {
  /** The CEO, acting on the stakeholder's word. */
  by: string;
  cites: string[];
  target: { person: string } | { room: string };
}

/** A settings change Undo can make: SettingsChange, and an Always allow rule put back. */
export type SettingsUndo = SettingsChange & { addRule?: string };

/** The inverse of a change to the org. */
export type OrgUndo =
  | { action: 'fire'; role: string }
  | { action: 'rehire'; role: string }
  | { action: 'move'; role: string; room: string; reportsTo: string | null };

/**
 * How Undo takes a decision back. `key` names what the decision changed ("setting:maxDesks", "task:t-4"): only the
 * newest change of a thing can be taken back, so an undo never brings back a value something later replaced.
 */
export type UndoPlan =
  | { kind: 'settings'; key: string; change: SettingsUndo }
  | { kind: 'org'; key: string; change: OrgUndo }
  | { kind: 'office'; key: string; change: OfficeChange }
  /** A plan edit: this version's plan comes back as a new version. */
  | { kind: 'plan'; key: string; version: number }
  /** A cancel: the tasks open again. */
  | { kind: 'reopen'; key: string; tasks: string[] }
  /** The undo of a reopen: the tasks are cancelled again, for the same reason. */
  | { kind: 'cancel'; key: string; tasks: string[]; reason: string };

export interface SteeringState {
  /** Oldest first: the newest STEERING_STATE_LIMITS.planVersions and the approved one. */
  versions: PlanVersion[];
  approved: PlanApprovalState | null;
  comments: PlanComment[];
  waiting: PlanView['waiting'];
  /** The task made from each plan task (plan task id to task id), while the plan keeps it. */
  planTasks: Record<string, string>;
  settings: SteeringSettings;
  /**
   * When each thing a decision names last changed ("setting:maxDesks", "leash:person:lena", "task:t-4",
   * "plan-approval"): what the stakeholder's cited message has to be newer than when the CEO acts on it.
   */
  changedAt: Record<string, number>;
  /** A task's turns besides its assignment (message id to task id): held while it is paused. */
  taskTurns: Record<string, string>;
  /** "Check with me": a hand-out waiting for the stakeholder's start (message id to the question's id). */
  gates: Record<string, string>;
  /** Trusted by talking, waiting for the stakeholder's yes (question id to the change). */
  confirms: Record<string, Confirm>;
  /** Cancelled work on its way to a branch, by the id of the task the save is named after. */
  saving: Record<string, Saving>;
  /** Oldest first. */
  decisions: Decision[];
  /** How Undo takes back each reversible decision (decision id to the change). */
  undos: Record<string, UndoPlan>;
  /** What each decision changed (decision id to its key), so a later change of the same thing can supersede it. */
  keys: Record<string, string>;
  counters: Record<SteeringIdKind, number>;
  /** v0.2: the final review's verdicts on the checklist, the newest per item and plan version, oldest first. */
  verdicts: ChecklistVerdict[];
}

/** Everything steering adds to the company's log. */
export type SteeringEvent =
  | { type: 'plan-version'; version: PlanVersion }
  | { type: 'plan-approved'; approval: PlanApprovalState }
  | { type: 'plan-comment'; comment: PlanComment }
  | { type: 'plan-waiting'; waiting: PlanView['waiting'] }
  | { type: 'plan-task'; planTask: string; task: string | null }
  | { type: 'task-priority'; priorities: [string, number][] }
  | { type: 'task-paused'; id: string; paused: TaskPause | null; at: number }
  | { type: 'task-cancelled'; id: string; cancel: TaskCancel }
  /** A save finished: the branch its tasks' work stays on, or null when nothing had changed or it couldn't be made. */
  | { type: 'task-saved'; save: string; tasks: string[]; branch: string | null }
  | { type: 'task-handover'; id: string; handover: TaskHandover; askedBy?: string }
  | { type: 'task-reopened'; id: string; at: number }
  | { type: 'task-fields'; id: string; fields: TaskFields; at: number }
  | { type: 'task-cites'; id: string; cites: string[] }
  | { type: 'task-turn'; message: string; task: string }
  /** A task reached its owner's hands: the message that carries it, like an assignment. */
  | { type: 'handed-out'; message: string; task: string }
  | { type: 'steering-settings'; settings: SteeringSettings }
  | { type: 'gate'; message: string; question: string | null }
  | { type: 'confirm'; question: string; confirm: Confirm | null }
  | { type: 'saving'; task: string; saving: Saving | null }
  | { type: 'decision-recorded'; decision: Decision; key: string | null; undo: UndoPlan | null }
  | { type: 'decision-undone'; id: string; undone: NonNullable<Decision['undone']> }
  | { type: 'decision-reconsidered'; id: string; reconsider: NonNullable<Decision['reconsider']> }
  /** v0.2: the final review marked checklist items (mark_checklist). */
  | { type: 'checklist-verdicts'; verdicts: ChecklistVerdict[] };

export type SteeringEventType = SteeringEvent['type'];

export const STEERING_EVENT_TYPES: readonly SteeringEventType[] = [
  'plan-version', 'plan-approved', 'plan-comment', 'plan-waiting', 'plan-task', 'task-priority', 'task-paused', 'task-cancelled', 'task-saved',
  'task-handover', 'task-reopened', 'task-fields', 'task-cites', 'task-turn', 'handed-out', 'steering-settings', 'gate', 'confirm', 'saving',
  'decision-recorded', 'decision-undone', 'decision-reconsidered', 'checklist-verdicts',
];

export const isSteeringEvent = (event: { type: string }): event is SteeringEvent => (STEERING_EVENT_TYPES as readonly string[]).includes(event.type);

export function blankSettings(planApproval: PlanApproval): SteeringSettings {
  return { planApproval, leash: { people: dict(), rooms: dict() }, effort: dict() };
}

/**
 * Steering for a company with no steering yet. Companies founded before plan approval existed run with it off; a new
 * company's first lines set the default (DEFAULT_PLAN_APPROVAL) with a `steering-settings` event.
 */
export function blankSteering(planApproval: PlanApproval = LEGACY_PLAN_APPROVAL): SteeringState {
  return {
    versions: [],
    approved: null,
    comments: [],
    waiting: null,
    planTasks: dict(),
    settings: blankSettings(planApproval),
    changedAt: dict(),
    taskTurns: dict(),
    gates: dict(),
    confirms: dict(),
    saving: dict(),
    decisions: [],
    undos: dict(),
    keys: dict(),
    counters: { decision: 0, comment: 0 },
    verdicts: [],
  };
}

/** What a state must carry for steering to fold into it: the company's state does. */
export interface SteeringHost {
  tasks: Task[];
  /** The message that handed each task to its owner (message id to task id). */
  assignments: Record<string, string>;
  steering: SteeringState;
}

/** The number in an id like "d-12", so the counters stay ahead of every id in the log. */
function idNumber(id: string): number {
  const m = /-(\d{1,12})$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** A settings record rebuilt with records that have no prototype, so a person's or room's id is only ever a key. */
function settingsCopy(settings: SteeringSettings): SteeringSettings {
  return {
    planApproval: settings.planApproval,
    leash: { people: Object.assign(dict<Leash>(), settings.leash.people), rooms: Object.assign(dict<Leash>(), settings.leash.rooms) },
    effort: Object.assign(dict<Effort>(), settings.effort),
  };
}

/** The versions kept: the newest few, and the approved one wherever it is. */
function keptVersions(versions: readonly PlanVersion[], approved: PlanApprovalState | null): PlanVersion[] {
  const extra = versions.length - STEERING_STATE_LIMITS.planVersions;
  if (extra <= 0) return versions.slice();
  return versions.filter((v, i) => i >= extra || v.version === approved?.version);
}

function changedTasks(tasks: readonly Task[], id: string, change: (t: Task) => Task): Task[] {
  return tasks.map((t) => (t.id === id ? change(t) : t));
}

/** The verdicts after some new ones: a new verdict replaces the one before on the same item and version; the oldest go past the cap. */
function withVerdicts(before: readonly ChecklistVerdict[], added: readonly ChecklistVerdict[]): ChecklistVerdict[] {
  const replaced = new Set(added.map((v) => `${v.version}:${v.item}`));
  return newest([...before.filter((v) => !replaced.has(`${v.version}:${v.item}`)), ...added], STEERING_STATE_LIMITS.verdicts);
}

/** Folds one of steering's events into a state that carries it. Pure: the state passed in is never changed. */
export function foldSteering<S extends SteeringHost>(host: S, event: SteeringEvent): S {
  const s = host.steering;
  const steer = (next: Partial<SteeringState>): S => ({ ...host, steering: { ...s, ...next } });
  const touched = (id: string, at: number): Record<string, number> => withEntry(s.changedAt, `task:${id}`, Math.max(at, own(s.changedAt, `task:${id}`) ?? 0));
  switch (event.type) {
    case 'plan-version': {
      const others = s.versions.filter((v) => v.version !== event.version.version);
      const versions = [...others, event.version].sort((a, b) => a.version - b.version);
      return steer({ versions: keptVersions(versions, s.approved) });
    }
    case 'plan-approved':
      return steer({
        approved: event.approval,
        waiting: null,
        changedAt: withEntry(s.changedAt, 'plan-approval', event.approval.at),
        versions: keptVersions(s.versions, event.approval),
      });
    case 'plan-comment':
      return steer({
        comments: newest([...s.comments, event.comment], STEERING_STATE_LIMITS.comments),
        counters: { ...s.counters, comment: Math.max(s.counters.comment, idNumber(event.comment.id)) },
      });
    case 'plan-waiting':
      return steer({ waiting: event.waiting });
    case 'plan-task':
      return steer({ planTasks: event.task === null ? without(s.planTasks, event.planTask) : withEntry(s.planTasks, event.planTask, event.task) });
    case 'task-priority': {
      const set = new Map(event.priorities);
      return { ...host, tasks: host.tasks.map((t) => (set.has(t.id) ? { ...t, priority: set.get(t.id) } : t)) };
    }
    case 'task-paused':
      return {
        ...host,
        tasks: changedTasks(host.tasks, event.id, (t) => ({ ...t, paused: event.paused, updatedAt: event.at })),
        steering: { ...s, changedAt: touched(event.id, event.at) },
      };
    case 'task-cancelled':
      return {
        ...host,
        tasks: changedTasks(host.tasks, event.id, (t) => ({ ...t, cancel: event.cancel, paused: null, updatedAt: event.cancel.at })),
        steering: { ...s, changedAt: touched(event.id, event.cancel.at) },
      };
    case 'task-saved': {
      const covered = new Set(event.tasks);
      return {
        ...host,
        tasks: host.tasks.map((t) => (covered.has(t.id) && t.cancel ? { ...t, cancel: { ...t.cancel, branch: event.branch } } : t)),
        steering: { ...s, saving: without(s.saving, event.save) },
      };
    }
    case 'task-handover':
      return {
        ...host,
        tasks: changedTasks(host.tasks, event.id, (t) => ({
          ...t,
          owner: event.handover.to,
          ...(event.askedBy === undefined ? {} : { askedBy: event.askedBy }),
          handovers: [...(t.handovers ?? []), event.handover],
          updatedAt: event.handover.at,
        })),
        steering: { ...s, changedAt: touched(event.id, event.handover.at) },
      };
    case 'task-reopened':
      return {
        ...host,
        tasks: changedTasks(host.tasks, event.id, (t) => ({ ...t, cancel: null, paused: null, updatedAt: event.at })),
        steering: { ...s, changedAt: touched(event.id, event.at) },
      };
    case 'task-fields':
      return { ...host, tasks: changedTasks(host.tasks, event.id, (t) => ({ ...t, ...event.fields, updatedAt: event.at })) };
    case 'task-cites':
      return { ...host, tasks: changedTasks(host.tasks, event.id, (t) => ({ ...t, cites: [...new Set([...(t.cites ?? []), ...event.cites])] })) };
    case 'task-turn':
      return steer({ taskTurns: withEntry(s.taskTurns, event.message, event.task) });
    case 'handed-out':
      return { ...host, assignments: withEntry(host.assignments, event.message, event.task) };
    case 'steering-settings':
      return steer({ settings: settingsCopy(event.settings) });
    case 'gate':
      return steer({ gates: event.question === null ? without(s.gates, event.message) : withEntry(s.gates, event.message, event.question) });
    case 'confirm':
      return steer({ confirms: event.confirm === null ? without(s.confirms, event.question) : withEntry(s.confirms, event.question, event.confirm) });
    case 'saving':
      return steer({ saving: event.saving === null ? without(s.saving, event.task) : withEntry(s.saving, event.task, event.saving) });
    case 'decision-recorded': {
      const d = event.decision;
      const all = [...s.decisions, d];
      const decisions = newest(all, STEERING_STATE_LIMITS.decisions);
      let undos = event.undo ? withEntry(s.undos, d.id, event.undo) : s.undos;
      let keys = event.key ? withEntry(s.keys, d.id, event.key) : s.keys;
      // A decision that leaves the state takes its undo with it.
      for (const gone of all.slice(0, all.length - decisions.length)) {
        if (own(undos, gone.id) !== undefined) undos = without(undos, gone.id);
        if (own(keys, gone.id) !== undefined) keys = without(keys, gone.id);
      }
      const changedAt = event.key ? withEntry(s.changedAt, event.key, Math.max(d.at, own(s.changedAt, event.key) ?? 0)) : s.changedAt;
      return steer({ decisions, undos, keys, changedAt, counters: { ...s.counters, decision: Math.max(s.counters.decision, idNumber(d.id)) } });
    }
    case 'decision-undone':
      return steer({ decisions: s.decisions.map((d) => (d.id === event.id && d.undone === null ? { ...d, undone: event.undone, reversible: false } : d)) });
    case 'decision-reconsidered':
      return steer({ decisions: s.decisions.map((d) => (d.id === event.id ? { ...d, reconsider: event.reconsider } : d)) });
    case 'checklist-verdicts':
      return steer({ verdicts: withVerdicts(s.verdicts, event.verdicts) });
    default:
      return host;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the state

/** A person's leash: their own, else their room's, else the company's approvals; and their effort. */
export function effectiveLeash(settings: SteeringSettings, person: Pick<Person, 'id' | 'room'>): PersonSteering {
  const mine = own(settings.leash.people, person.id);
  const room = own(settings.leash.rooms, person.room);
  return { leash: mine ?? room ?? 'default', leashFrom: mine ? 'person' : room ? 'room' : 'company', effort: own(settings.effort, person.id) ?? null };
}

/** Every person's leash and effort, keyed by their id. */
export function personSteering(settings: SteeringSettings, people: readonly Pick<Person, 'id' | 'room'>[]): Record<string, PersonSteering> {
  const out = dict<PersonSteering>();
  for (const p of people) out[p.id] = effectiveLeash(settings, p);
  return out;
}

const isOpen = (t: Pick<Task, 'status'>): boolean => t.status !== 'done' && t.status !== 'dropped';

/** The task a message is a turn of: its assignment, or another of its turns. */
export function taskOfTurn(host: Pick<SteeringHost, 'assignments' | 'steering'>, messageId: string): string | undefined {
  return own(host.assignments, messageId) ?? own(host.steering.taskTurns, messageId);
}

/**
 * Why a stored message mustn't reach its person yet: a "check with me" start still waits for the stakeholder, its task
 * is paused, or its task is over (cancelled or done before it went out). Null when it may go.
 */
export function heldTurn(host: Pick<SteeringHost, 'tasks' | 'assignments' | 'steering'>, messageId: string): 'gate' | 'paused' | 'over' | null {
  if (own(host.steering.gates, messageId) !== undefined) return 'gate';
  const taskId = taskOfTurn(host, messageId);
  const task = taskId === undefined ? undefined : host.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  if (!isOpen(task)) return 'over';
  return task.paused ? 'paused' : null;
}

/**
 * Whether Undo can take a decision back now, as far as the log says: it has an undo, isn't undone, and nothing later
 * changed the same thing (an undo can itself be undone only while it is the newest). `possible` adds what only the
 * company can check, such as the person still being on staff.
 */
export function reversibleIn(s: Pick<SteeringState, 'decisions' | 'undos' | 'keys'>, d: Decision, possible?: (undo: UndoPlan) => boolean): boolean {
  if (d.undone !== null) return false;
  const undo = own(s.undos, d.id);
  const key = own(s.keys, d.id);
  if (!undo || key === undefined) return false;
  const at = s.decisions.findIndex((x) => x.id === d.id);
  const later = (at < 0 ? [] : s.decisions.slice(at + 1)).filter((x) => own(s.keys, x.id) === key);
  const free = d.kind === 'undo' ? later.length === 0 : later.every((x) => x.undone !== null || x.kind === 'undo');
  return free && (possible ? possible(undo) : true);
}

export interface SteeringViewInput {
  steering: SteeringState;
  /** The acknowledgements the view carries, from the messages stream (`acksInView`). */
  acks: readonly Ack[];
  people: readonly Pick<Person, 'id' | 'room'>[];
  /** What only the company can check before an undo (src/company/decisions.ts, `undoPossible`). */
  possible?: (undo: UndoPlan) => boolean;
}

/** The plan's versions a view carries: the newest few, and the approved one when it is older. */
function versionsInView(s: SteeringState): PlanVersion[] {
  const max = STEERING_VIEW_LIMITS.planVersions;
  const kept = newest(s.versions, max);
  const approved = s.approved ? s.versions.find((v) => v.version === s.approved?.version) : undefined;
  return approved && !kept.includes(approved) ? [approved, ...kept] : kept;
}

/** What the browser gets (`CompanyView.steering`). */
export function steeringView(i: SteeringViewInput): SteeringView {
  const s = i.steering;
  const plan: PlanView | null =
    s.versions.length === 0 ? null : { versions: versionsInView(s), approved: s.approved, comments: newest(s.comments, STEERING_VIEW_LIMITS.comments), waiting: s.waiting };
  return {
    plan,
    acks: newest(i.acks, STEERING_VIEW_LIMITS.acks),
    decisions: newest(s.decisions, STEERING_VIEW_LIMITS.decisions).map((d) => ({ ...d, reversible: reversibleIn(s, d, i.possible) })),
    settings: settingsCopy(s.settings),
    people: personSteering(s.settings, i.people),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading it back from company.json

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const listOf = <T>(raw: unknown): T[] => (Array.isArray(raw) ? (raw as T[]) : []);
const isLeash = (v: unknown): v is Leash => LEASHES.some((l) => l === v);
const isEffort = (v: unknown): v is Effort => EFFORTS.some((e) => e === v);
const isPlanApproval = (v: unknown): v is PlanApproval => PLAN_APPROVALS.some((p) => p === v);

function dictOf<T>(raw: unknown, each: (value: unknown) => T | undefined): Record<string, T> {
  const out = dict<T>();
  if (!isObj(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const v = each(value);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** A record from our own signed snapshot, checked only for being an object: its shape is the company's own. */
function recordOf<T>(raw: unknown): T | undefined {
  if (!isObj(raw)) return undefined;
  const value: unknown = raw;
  return value as T;
}

/**
 * Steering from company.json, which the store checked against its MAC: the shape is the company's own, so this checks
 * the top level, keeps settings to known values and gives records keyed by ids their null prototype back. A state
 * written before steering existed (no `steering` at all) runs with plan approval off, as those companies did.
 */
export function reviveSteering(raw: unknown): SteeringState {
  const blank = blankSteering();
  if (!isObj(raw)) return blank;
  const settings = isObj(raw.settings) ? raw.settings : {};
  const leash = isObj(settings.leash) ? settings.leash : {};
  const counters = isObj(raw.counters) ? raw.counters : {};
  return {
    versions: listOf<PlanVersion>(raw.versions),
    approved: recordOf<PlanApprovalState>(raw.approved) ?? null,
    comments: listOf<PlanComment>(raw.comments),
    waiting: recordOf<NonNullable<PlanView['waiting']>>(raw.waiting) ?? null,
    planTasks: dictOf(raw.planTasks, text),
    settings: {
      planApproval: isPlanApproval(settings.planApproval) ? settings.planApproval : blank.settings.planApproval,
      leash: { people: dictOf(leash.people, (v) => (isLeash(v) ? v : undefined)), rooms: dictOf(leash.rooms, (v) => (isLeash(v) ? v : undefined)) },
      effort: dictOf(settings.effort, (v) => (isEffort(v) ? v : undefined)),
    },
    changedAt: dictOf(raw.changedAt, finite),
    taskTurns: dictOf(raw.taskTurns, text),
    gates: dictOf(raw.gates, text),
    confirms: dictOf(raw.confirms, (v) => recordOf<Confirm>(v)),
    saving: dictOf(raw.saving, (v) => recordOf<Saving>(v)),
    decisions: listOf<Decision>(raw.decisions),
    undos: dictOf(raw.undos, (v) => recordOf<UndoPlan>(v)),
    keys: dictOf(raw.keys, text),
    counters: { decision: finite(counters.decision) ?? 0, comment: finite(counters.comment) ?? 0 },
    // A state written before the checklist has no verdicts.
    verdicts: listOf<ChecklistVerdict>(raw.verdicts),
  };
}
