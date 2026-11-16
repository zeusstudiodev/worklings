// The stakeholder's steering routes under /api/c/<id>/ (docs/architecture.md, "Steering"): the plan, messages to a
// person, a room, a team or everyone and following them up, the task board, the decision log and the settings. Each
// takes a JSON object with only its fields, of the right kind and within the contract's limits, and calls the
// company's SteeringApi as the stakeholder. The company applies the org's rules; its refusal goes back as its sentence
// with the status its code means (company()). Ids in the path are checked like every id the office makes.
import { type CompanySettings, LIMITS, STAKEHOLDER, type Task } from '../core/company.ts';
import { safeId } from '../core/events.ts';
import {
  DECISION_LIMITS,
  EFFORTS,
  LEASHES,
  type NewTaskInput,
  PLAN_APPROVALS,
  PLAN_LIMITS,
  type PlanComment,
  type Recipient,
  type SettingsChange,
  type SteeringApi,
  type TaskSteer,
} from '../core/steering.ts';
import { type ApiReply, HttpError } from '../server/http.ts';
import { badInput, company, fields, type Fields, flag, id, idList, MAX_COMPANY_DESKS, oneOf, optionalText, optionalWhole, text, textList, whole } from './input.ts';

/** A steering route: how much body it reads, and what it does with it. */
export interface SteeringPost {
  limit: number;
  run: (body: unknown) => ApiReply;
}

const KB = 1024;
/** An idle desk closes after one minute at the soonest and two hours at the latest. */
const IDLE_MS = { min: 60_000, max: 2 * 60 * 60_000 } as const;
/** As many people as an org the stakeholder edits may hold (PROPOSAL_LIMITS.people). */
const MAX_PEOPLE = 60;
/** Tasks one new order may name. */
const MAX_ORDER = 500;
/** A model as the company keeps one (its SAFE_MODEL): an alias or a model id. */
const MODEL = /^[A-Za-z0-9][\w.:@[\]-]{0,99}$/;
const RULE_MAX = 1_000;
const VERSION_MAX = 1_000_000;

const ok = (body: unknown, status = 200): ApiReply => ({ status, body });

/** A file or folder a task may change, as the stakeholder names it: relative to the project and inside it. */
function projectPath(raw: string, at: string): string {
  const path = raw.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
  if (/^[A-Za-z]:|^\//.test(path) || path.split('/').includes('..') || /[\p{Cc}<>:"|]/u.test(path)) {
    throw badInput(`${at} must be a path inside the project, like "src/menu/".`);
  }
  return path;
}

/** A message's recipient: a person, a room, a team (a head and their people) or everyone. */
function recipient(raw: unknown): Recipient {
  const kind = oneOf(fields(raw, ['kind', 'id', 'head']), 'kind', ['person', 'room', 'team', 'everyone'] as const);
  switch (kind) {
    case 'person':
    case 'room':
      return { kind, id: id(fields(raw, ['kind', 'id']), 'id') };
    case 'team':
      return { kind, head: id(fields(raw, ['kind', 'head']), 'head') };
    case 'everyone':
      fields(raw, ['kind']);
      return { kind };
  }
}

/** What a plan comment is on: the plan, one milestone or one task. */
function commentOn(raw: unknown): PlanComment['on'] {
  const kind = oneOf(fields(raw, ['kind', 'id']), 'kind', ['plan', 'milestone', 'task'] as const);
  if (kind === 'plan') {
    fields(raw, ['kind']);
    return { kind };
  }
  return { kind, id: id(fields(raw, ['kind', 'id']), 'id') };
}

function newTask(body: unknown): NewTaskInput {
  const o = fields(body, ['title', 'brief', 'files', 'owner', 'doneWhen', 'milestone']);
  const files = o.files === undefined ? [] : textList(o, 'files', LIMITS.files, LIMITS.path).map((f, i) => projectPath(f, `files[${i}]`));
  return {
    title: text(o, 'title', LIMITS.title),
    brief: text(o, 'brief', LIMITS.brief, 0),
    files: [...new Set(files)],
    owner: id(o, 'owner'),
    doneWhen: text(o, 'doneWhen', LIMITS.doneWhen, 0),
    milestone: o.milestone === undefined || o.milestone === null ? null : id(o, 'milestone'),
  };
}

/** One leash: a person's or a room's; null clears their own. */
function leashChange(raw: unknown): NonNullable<SettingsChange['leash']> {
  const o = fields(raw, ['person', 'room', 'leash']);
  if ((o.person === undefined) === (o.room === undefined)) throw badInput('Send leash with person or room: whose leash it is.');
  const leash = o.leash === null ? null : oneOf(o, 'leash', LEASHES);
  return o.person !== undefined ? { person: id(o, 'person'), leash } : { room: id(o, 'room'), leash };
}

function effortChange(raw: unknown): NonNullable<SettingsChange['effort']> {
  const o = fields(raw, ['person', 'effort']);
  return { person: id(o, 'person'), effort: o.effort === null ? null : oneOf(o, 'effort', EFFORTS) };
}

function modelChange(raw: unknown): NonNullable<SettingsChange['model']> {
  const o = fields(raw, ['person', 'model']);
  const model = text(o, 'model', 100);
  if (!MODEL.test(model)) throw badInput('model must be an alias like "sonnet" or a model id.');
  return { person: id(o, 'person'), model };
}

/** A change to the company's settings, v3's maxDesks and removeRule among them. At least one field. */
export function settingsChange(body: unknown): SettingsChange {
  const o: Fields = fields(body, ['maxDesks', 'idleMs', 'planApproval', 'leash', 'effort', 'model', 'removeRule']);
  const change: SettingsChange = {};
  const maxDesks = optionalWhole(o, 'maxDesks', 1, MAX_COMPANY_DESKS);
  if (maxDesks !== null) change.maxDesks = maxDesks;
  const idleMs = optionalWhole(o, 'idleMs', IDLE_MS.min, IDLE_MS.max);
  if (idleMs !== null) change.idleMs = idleMs;
  if (o.planApproval !== undefined) change.planApproval = oneOf(o, 'planApproval', PLAN_APPROVALS);
  if (o.leash !== undefined) change.leash = leashChange(o.leash);
  if (o.effort !== undefined) change.effort = effortChange(o.effort);
  if (o.model !== undefined) change.model = modelChange(o.model);
  const removeRule = optionalText(o, 'removeRule', RULE_MAX);
  if (removeRule !== null) change.removeRule = removeRule;
  if (Object.keys(change).length === 0) throw badInput('Send a setting to change.');
  return change;
}

/** An id from the path, or a 404 that names what wasn't found. */
function pathId(raw: string, what: string): string {
  let decoded: string | undefined;
  try {
    decoded = safeId(decodeURIComponent(raw));
  } catch {
    decoded = undefined;
  }
  if (decoded === undefined) throw new HttpError(404, `No such ${what}.`);
  return decoded;
}

/** The task a steer changed: the company answers with the tasks it changed, this one first. */
const first = (tasks: readonly Task[]): Task | null => tasks[0] ?? null;

/**
 * The steering route for `rest` (the path under /api/c/<id>/), or null when `rest` isn't one. `settings` gives the
 * company's settings as they are after a change, for the settings route's answer.
 */
export function steeringPost(steering: SteeringApi, settings: () => CompanySettings, rest: string): SteeringPost | null {
  const steer = (s: TaskSteer) => company(() => steering.steerTask(STAKEHOLDER, s));
  switch (rest) {
    case 'plan':
      return {
        limit: 512 * KB,
        run: (body) => {
          const o = fields(body, ['plan', 'note']);
          if (o.plan === undefined) throw badInput('Send the plan.');
          const result = company(() => steering.editPlan(STAKEHOLDER, { plan: o.plan, note: optionalText(o, 'note', PLAN_LIMITS.note) }));
          return result.ok ? ok(result) : ok({ ...result, error: result.errors[0] ?? "The plan doesn't check out." }, 400);
        },
      };
    case 'plan/approve':
      return {
        limit: KB,
        run: (body) => {
          const o = fields(body, ['version', 'through']);
          const through = o.through === undefined || o.through === null ? null : id(o, 'through');
          return ok(company(() => steering.approvePlan(STAKEHOLDER, { version: whole(o, 'version', 1, VERSION_MAX), through, cites: [] })));
        },
      };
    case 'plan/comment':
      return {
        limit: 16 * KB,
        run: (body) => {
          const o = fields(body, ['on', 'text']);
          return ok(company(() => steering.commentPlan(STAKEHOLDER, { on: commentOn(o.on), text: text(o, 'text', PLAN_LIMITS.comment) })));
        },
      };
    case 'send':
      return {
        limit: 32 * KB,
        run: (body) => {
          const o = fields(body, ['to', 'text', 'for', 'typed']);
          // Only words the person typed in a box are marked: the CEO may cite only those as their word.
          const typed = flag(o, 'typed', false);
          const sent = company(() =>
            steering.send(STAKEHOLDER, { to: recipient(o.to), text: text(o, 'text', LIMITS.message), for: idList(o, 'for', MAX_PEOPLE), ...(typed ? { typed } : {}) }),
          );
          return ok({ ids: sent.map((m) => m.id), messages: sent }, 202);
        },
      };
    case 'tasks':
      return { limit: 32 * KB, run: (body) => ok(company(() => steering.createTask(STAKEHOLDER, { ...newTask(body), cites: [] })), 201) };
    case 'tasks/order':
      return { limit: 32 * KB, run: (body) => ok(steer({ action: 'order', tasks: idList(fields(body, ['tasks']), 'tasks', MAX_ORDER, 1), cites: [] })) };
    case 'settings':
      return {
        limit: 4 * KB,
        run: (body) => {
          const change = settingsChange(body);
          const steeringSettings = company(() => steering.changeSettings(STAKEHOLDER, { ...change, cites: [] }));
          return ok({ ...settings(), steering: steeringSettings });
        },
      };
    default:
      break;
  }

  const [kind, raw, action, ...more] = rest.split('/');
  if (raw === undefined || action === undefined || more.length > 0) return null;
  if (kind === 'messages' && (action === 'remind' || action === 'escalate')) {
    const message = pathId(raw, 'message');
    return {
      limit: KB,
      run: (body) => {
        const person = id(fields(body, ['person']), 'person');
        const sent = company(() => (action === 'remind' ? steering.remind(STAKEHOLDER, { message, person }) : steering.escalate(STAKEHOLDER, { message, person })));
        return ok({ id: sent.id }, 202);
      },
    };
  }
  if (kind === 'tasks' && (action === 'pause' || action === 'resume' || action === 'cancel' || action === 'reassign')) {
    const task = pathId(raw, 'task');
    switch (action) {
      case 'pause':
      case 'resume':
        return {
          limit: KB,
          run: (body) => {
            fields(body, []);
            return ok(first(steer({ action, task, cites: [] })));
          },
        };
      case 'cancel':
        return { limit: 4 * KB, run: (body) => ok(first(steer({ action, task, reason: text(fields(body, ['reason']), 'reason', DECISION_LIMITS.note), cites: [] }))) };
      case 'reassign':
        return {
          limit: 4 * KB,
          run: (body) => {
            const o = fields(body, ['to', 'note']);
            return ok(first(steer({ action, task, to: id(o, 'to'), note: o.note === undefined ? '' : text(o, 'note', PLAN_LIMITS.note, 0), cites: [] })));
          },
        };
    }
  }
  if (kind === 'rooms' && (action === 'pause' || action === 'resume')) {
    const room = pathId(raw, 'room');
    return {
      limit: KB,
      run: (body) => {
        fields(body, []);
        return ok(steer({ action: action === 'pause' ? 'pause-room' : 'resume-room', room, cites: [] }));
      },
    };
  }
  if (kind === 'decisions' && (action === 'undo' || action === 'reconsider')) {
    const decision = pathId(raw, 'decision');
    if (action === 'undo') {
      return {
        limit: KB,
        run: (body) => {
          fields(body, []);
          return ok(company(() => steering.undoDecision(STAKEHOLDER, decision)));
        },
      };
    }
    return {
      limit: 4 * KB,
      run: (body) => ok({ id: company(() => steering.reconsider(STAKEHOLDER, { decision, note: text(fields(body, ['note']), 'note', DECISION_LIMITS.note) })).id }, 202),
    };
  }
  return null;
}
