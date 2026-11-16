// The steering routes (docs/architecture.md, "Steering") as SteeringActions for one company: the live office's binding,
// as api.ts binds CompanyActions, with the same headers, token and refusals. Every refusal becomes an ActionError with
// the office's sentence; an answer in a shape the office shouldn't give is refused rather than made up.
import { type Message, STAKEHOLDER, type Task, TASK_STATUSES, type TaskStatus } from '../../../src/core/company.ts';
import {
  type Effort,
  EFFORTS,
  type Leash,
  LEASHES,
  type NewTaskInput,
  type Plan,
  PLAN_APPROVALS,
  type PlanApproval,
  type PlanComment,
  type Recipient,
  type SettingsChange,
  type SteeringSettings,
} from '../../../src/core/steering.ts';
import { exchange, refusal, typedField } from './api.ts';
import { ActionError, type SteeringActions } from './types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const orNull = <T>(v: unknown, is: (x: unknown) => x is T): v is T | null => v === null || is(v);
const isTaskStatus = (v: unknown): v is TaskStatus => TASK_STATUSES.some((s) => s === v);
const isLeash = (v: unknown): v is Leash => LEASHES.some((l) => l === v);
const isEffort = (v: unknown): v is Effort => EFFORTS.some((e) => e === v);
const isPlanApproval = (v: unknown): v is PlanApproval => PLAN_APPROVALS.some((p) => p === v);

/** A check's refusal as its sentences (400 with `errors`), so a form can show them; anything else throws. */
async function checked(path: string, token: string | null, body: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const answer = await exchange(path, token, { body });
  if (answer.ok) return { ok: true };
  const errors = isObj(answer.body) && isStrings(answer.body.errors) ? answer.body.errors : [];
  if (answer.status === 400 && errors.length > 0) return { ok: false, errors };
  throw refusal(answer.status, answer.body);
}

/** A message as the hub answers with it, every field in place, or null. */
function asMessage(v: unknown): Message | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.from) || !isStr(v.to) || !isStr(v.text) || !isNum(v.at)) return null;
  const m: Message = {
    id: v.id,
    from: v.from,
    to: v.to,
    text: v.text,
    at: v.at,
    origin: isStr(v.origin) ? v.origin : null,
    relayOf: isStr(v.relayOf) ? v.relayOf : null,
    note: isStr(v.note) ? v.note : null,
    deliveredAt: isNum(v.deliveredAt) ? v.deliveredAt : null,
    interrupt: v.interrupt === true,
  };
  if (isStrings(v.for)) m.for = [...v.for];
  return m;
}

/**
 * What a send made. The route answers `{ids}`; the copies themselves, when the hub gives them, say who got each. Until
 * the stream brings them, a copy for a room, a team or everyone has no person yet (`to` is empty).
 */
function sentMessages(body: unknown, to: Recipient, text: string, forPeople: string[]): Message[] {
  const fields = isObj(body) ? body : {};
  const copies = Array.isArray(fields.messages) ? fields.messages.map(asMessage).filter((m): m is Message => m !== null) : [];
  if (copies.length > 0) return copies;
  const ids = isStrings(fields.ids) ? fields.ids : isStr(fields.id) ? [fields.id] : [];
  if (ids.length === 0) throw new ActionError(500, "The office took your message but didn't say which it was. It shows in their conversations.", 'bad-answer');
  const at = Date.now();
  return ids.map((id) => ({
    id,
    from: STAKEHOLDER,
    to: to.kind === 'person' ? to.id : '',
    text,
    origin: null,
    relayOf: null,
    note: null,
    at,
    deliveredAt: null,
    interrupt: false,
    for: [...forPeople],
  }));
}

/** A task as the hub answers a create with it, every field in place, or a refusal. */
function asTask(v: unknown): Task {
  const worktreeOk = (w: unknown) => w === null || (isObj(w) && isStr(w.path) && isStr(w.branch));
  if (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.title) &&
    isStr(v.brief) &&
    isStr(v.owner) &&
    isStr(v.askedBy) &&
    isStrings(v.files) &&
    isStr(v.doneWhen) &&
    isTaskStatus(v.status) &&
    orNull(v.outcome, isStr) &&
    orNull(v.parent, isStr) &&
    orNull(v.milestone, isStr) &&
    orNull(v.commit, isStr) &&
    worktreeOk(v.worktree) &&
    isNum(v.createdAt) &&
    isNum(v.updatedAt)
  ) {
    const w = v.worktree;
    const task: Task = {
      id: v.id,
      title: v.title,
      brief: v.brief,
      owner: v.owner,
      askedBy: v.askedBy,
      files: [...v.files],
      doneWhen: v.doneWhen,
      status: v.status,
      outcome: v.outcome,
      parent: v.parent,
      milestone: v.milestone,
      worktree: isObj(w) && isStr(w.path) && isStr(w.branch) ? { path: w.path, branch: w.branch } : null,
      commit: v.commit,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
    if (isNum(v.priority)) task.priority = v.priority;
    if (isStr(v.planTask)) task.planTask = v.planTask;
    if (isStrings(v.cites)) task.cites = [...v.cites];
    return task;
  }
  throw new ActionError(500, "The office made the task but didn't say what it is. It shows on Tasks.", 'bad-answer');
}

/** A record keyed by people's or rooms' ids, every value checked; no prototype, so an id can't reach one. */
function record<T>(v: unknown, is: (x: unknown) => x is T): Record<string, T> | null {
  if (!isObj(v)) return null;
  const out = Object.create(null) as Record<string, T>;
  for (const [key, value] of Object.entries(v)) {
    if (!is(value)) return null;
    out[key] = value;
  }
  return out;
}

/** Steering's settings as the hub answers a change with them: nested under `steering`, or beside v3's settings. */
function asSteeringSettings(body: unknown): SteeringSettings {
  const fields = isObj(body) && isObj(body.steering) ? body.steering : body;
  if (isObj(fields) && isPlanApproval(fields.planApproval) && isObj(fields.leash)) {
    const people = record(fields.leash.people, isLeash);
    const rooms = record(fields.leash.rooms, isLeash);
    const effort = record(fields.effort, isEffort);
    if (people && rooms && effort) return { planApproval: fields.planApproval, leash: { people, rooms }, effort };
  }
  throw new ActionError(500, "The office saved it but didn't say what the settings are now.", 'bad-answer');
}

/** A company's steering actions bound to the hub's routes under /api/c/<id>/. */
export function liveSteering(companyId: string, token: string | null): SteeringActions {
  const base = `/api/c/${encodeURIComponent(companyId)}`;
  const enc = encodeURIComponent;
  const post = async (path: string, body: unknown = {}): Promise<unknown> => {
    const answer = await exchange(`${base}/${path}`, token, { body });
    if (!answer.ok) throw refusal(answer.status, answer.body);
    return answer.body;
  };
  return {
    editPlan(plan: Plan, note: string | null) {
      return checked(`${base}/plan`, token, { plan, note });
    },
    async approvePlan(version, through) {
      await post('plan/approve', { version, through });
    },
    async commentPlan(on: PlanComment['on'], text) {
      await post('plan/comment', { on, text });
    },
    async send(to, text, forPeople, options) {
      return sentMessages(await post('send', { to, text, for: forPeople, ...typedField(options) }), to, text, forPeople);
    },
    async remind(message, person) {
      await post(`messages/${enc(message)}/remind`, { person });
    },
    async escalate(message, person) {
      await post(`messages/${enc(message)}/escalate`, { person });
    },
    async orderTasks(ids) {
      await post('tasks/order', { tasks: ids });
    },
    async pauseTask(task) {
      await post(`tasks/${enc(task)}/pause`);
    },
    async resumeTask(task) {
      await post(`tasks/${enc(task)}/resume`);
    },
    async pauseRoom(room) {
      await post(`rooms/${enc(room)}/pause`);
    },
    async resumeRoom(room) {
      await post(`rooms/${enc(room)}/resume`);
    },
    async cancelTask(task, reason) {
      await post(`tasks/${enc(task)}/cancel`, { reason });
    },
    async reassignTask(task, to, note) {
      await post(`tasks/${enc(task)}/reassign`, { to, note });
    },
    async createTask(input: NewTaskInput) {
      return asTask(await post('tasks', input));
    },
    async undoDecision(decision) {
      await post(`decisions/${enc(decision)}/undo`);
    },
    async reconsider(decision, note) {
      await post(`decisions/${enc(decision)}/reconsider`, { note });
    },
    async changeSettings(change: SettingsChange) {
      return asSteeringSettings(await post('settings', change));
    },
  };
}
