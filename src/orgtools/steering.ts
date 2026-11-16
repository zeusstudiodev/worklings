// Steering's org tools (SPEC-v3.md "Steering", docs/architecture.md "Steering"): acknowledging a message, recording a
// decision, steering a team's tasks, and the CEO's plan and settings; also the audiences `message` reaches. Each calls
// the company's SteeringApi, which applies the org's rules and checks every cite: where the CEO acts for the
// stakeholder, the cited message must be the stakeholder's to the CEO and newer than what it changes. A tool refuses
// early only what it can see itself (who may use it, its arguments, a task or a room outside the caller's team), each
// with a sentence that says what to do instead.
import { below, isManager, LIMITS, type Message, type Person, personById, REPORT_FORM, type Task } from '../core/company.ts';
import { ACCEPT_KINDS, ACCEPT_LIMITS, STEP_GRAMMAR } from '../core/acceptance.ts';
import { isCheckerSeat } from '../core/size.ts';
import {
  CHECKLIST_LIMITS,
  CHECKLIST_PAGE,
  DECISION_LIMITS,
  EFFORTS,
  LEASHES,
  PLAN_APPROVALS,
  PLAN_LIMITS,
  PLAN_TASK_KINDS,
  type PlanApproval,
  type Recipient,
  type SettingsChange,
  STEERING_TOOLS,
  type SteeringApi,
  type SteeringSettings,
  type SteeringTool,
  type TaskSteer,
  VERDICTS,
} from '../core/steering.ts';
import { ROLE_ID, ROLE_MODELS } from '../core/studio.ts';
import { type DeskCall, defineTool, refuse, type ToolDef } from './define.ts';
import { andList, badArgs, ITEM_ID } from './schema.ts';
import { named, taskLabel, who } from './words.ts';

/** The most messages one call may cite. */
export const MAX_CITES = 10;
/** As the company holds desks per company (src/company/company.ts and the office's settings route). */
const DESKS = { min: 1, max: 20 } as const;
const IDLE_MINUTES = { min: 1, max: 120 } as const;

const MESSAGE_ID = { type: 'id', of: 'item', like: 'm-12', about: 'A message, by the id its turn gives: "(message m-12)" is m-12.' } as const;
export const CITES = {
  type: 'list',
  item: MESSAGE_ID,
  max: MAX_CITES,
  optional: true,
  about: 'The messages this answers or acts on, by the ids their turns give.',
} as const;
/** Where the CEO acts for the stakeholder: the stakeholder's message that asks for it, at least one. */
const STAKEHOLDER_CITES = {
  type: 'list',
  item: MESSAGE_ID,
  min: 1,
  max: MAX_CITES,
  about: "The stakeholder's message to you that asks for this, by the id its turn gives.",
} as const;
const PERSON = { type: 'id', of: 'role', about: 'Their id from org, like "ui-designer".' } as const;
const ROOM = { type: 'id', of: 'role', like: 'design', about: 'The id of a room, as org shows them.' } as const;
const TASK = { type: 'id', of: 'item', like: 't-12', about: 'The task, like "t-12".' } as const;

/**
 * The steering tools a person may use, by STEERING_TOOLS: everyone's, managers' and the CEO's, and the checkers' for the
 * CEO and the checker seats (QA, testers, reviewers), who give the final review.
 */
export function steeringToolsFor(person: Pick<Person, 'id' | 'title' | 'level'>): SteeringTool[] {
  const tools: SteeringTool[] = [...STEERING_TOOLS.everyone];
  if (isManager(person)) tools.push(...STEERING_TOOLS.managers);
  if (person.level === 'ceo') tools.push(...STEERING_TOOLS.ceo);
  if (person.level === 'ceo' || isCheckerSeat(person)) tools.push(...STEERING_TOOLS.checkers);
  return tools;
}

/** The company's SteeringApi for a call. The tools are listed only when the company serves it. */
function steer(call: DeskCall): SteeringApi {
  if (!call.steering) throw refuse('unknown', "This company doesn't take steering yet.");
  return call.steering;
}

const unique = (ids: readonly string[] | undefined): string[] => [...new Set(ids ?? [])];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A refusal is the sentences and nothing else: the CEO pays for every word of it again. One sentence stands alone. */
const bullets = (lines: readonly string[]) => (lines.length === 1 ? (lines[0] ?? '') : lines.map((line) => `- ${line}`).join('\n'));
const mustExist = (people: readonly Person[], id: string): Person => {
  const p = personById(people, id);
  if (!p) throw refuse('unknown', `Nobody in the org has the id "${id}"; org lists everyone's id.`);
  return p;
};
const roomExists = (people: readonly Person[], room: string) => {
  if (!people.some((p) => p.room === room)) throw refuse('unknown', `Nobody works in a room with the id "${room}"; org lists the rooms.`);
};

// ---------------------------------------------------------------------------------------------------------------------
// message: a room, a team or everyone

/**
 * The audience `message` names with room, team or everyone, refused where the org rules don't let the caller reach it:
 * the CEO may write to everyone, any room and any head's team; a head to their own room and their own team.
 */
export function groupRecipient(me: Person, people: readonly Person[], a: { room?: string; team?: string; everyone?: boolean }): Recipient {
  const ceo = me.level === 'ceo';
  const head = me.level === 'head';
  const nobody = 'Only the CEO and heads write to a room or a team. Write to people one at a time, or ask your manager to pass it on.';
  if (a.everyone === true) {
    if (!ceo) throw refuse('not-allowed', head ? 'Only the CEO writes to everyone. Write to your own team or room instead.' : nobody);
    return { kind: 'everyone' };
  }
  if (a.room !== undefined) {
    roomExists(people, a.room);
    if (!ceo && !(head && me.room === a.room)) throw refuse('not-allowed', head ? 'A head writes to their own room; reach another room through its head.' : nobody);
    return { kind: 'room', id: a.room };
  }
  if (a.team === undefined) throw badArgs('message needs to, room, team or everyone: who it is for.');
  const lead = mustExist(people, a.team);
  if (lead.level !== 'head') throw refuse('invalid', `${named(people, lead.id)} isn't a head; a team is a head and the people below them.`);
  if (!ceo && lead.id !== me.id) throw refuse('not-allowed', head ? 'A head writes to their own team; reach another team through its head.' : nobody);
  return { kind: 'team', head: lead.id };
}

/** An audience as a turn names it, for when the company's copies don't carry one. */
function audienceWords(to: Recipient, people: readonly Person[]): string {
  switch (to.kind) {
    case 'everyone':
      return 'everyone';
    case 'room':
      return `the ${to.id} room`;
    case 'team':
      return `${named(people, to.head)}'s team`;
    case 'person':
      return who(people, to.id);
  }
}

/** What a message to a room, a team or everyone did, in a sentence. */
export function sentWords(sent: readonly Message[], to: Recipient, people: readonly Person[]): string {
  const audience = sent.find((m) => m.audience)?.audience?.title ?? audienceWords(to, people);
  if (sent.length === 0) return `Nobody else is in ${audience}, so nobody got it.`;
  const names = [...new Set(sent.map((m) => who(people, m.to)))];
  const whom = names.length <= 6 ? andList(names) : `${names.length} people`;
  return `Sent to ${audience}: ${whom}. It reaches each of them at their next step; replies come to you as messages.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// steer_task

const STEER_ACTIONS = ['pause', 'resume', 'cancel', 'reassign', 'order', 'pause-room', 'resume-room'] as const;
type SteerAction = (typeof STEER_ACTIONS)[number];
/** The fields each action takes besides action and cites. */
const STEER_TAKES: Record<SteerAction, readonly string[]> = {
  pause: ['task'],
  resume: ['task'],
  cancel: ['task', 'reason'],
  reassign: ['task', 'to', 'note'],
  order: ['tasks'],
  'pause-room': ['room'],
  'resume-room': ['room'],
};

/** A task of the caller's team: its owner is below them. */
function teamTask(call: DeskCall, id: string): Task {
  const task = call.company.tasks(call.me.id, {}).find((t) => t.id === id);
  if (!task) throw refuse('unknown', `There is no task ${id}; tasks lists them.`);
  if (!below(call.people, call.me.id).some((p) => p.id === task.owner)) {
    throw refuse('not-allowed', `${taskLabel(task)} belongs to ${who(call.people, task.owner)}, who isn't one of your people; ask their manager to steer it.`);
  }
  return task;
}

/** Whom a reassigned task may go to: one of the caller's people. */
function teamMember(call: DeskCall, id: string): string {
  const p = mustExist(call.people, id);
  if (!below(call.people, call.me.id).some((x) => x.id === p.id)) throw refuse('not-allowed', `${named(call.people, p.id)} isn't one of your people; give tasks only to the people below you.`);
  return p.id;
}

/** A room the caller may pause as a whole: any for the CEO, their own for a head. */
function ownRoom(call: DeskCall, room: string): string {
  roomExists(call.people, room);
  if (call.me.level === 'ceo' || (call.me.level === 'head' && call.me.room === room)) return room;
  throw refuse('not-allowed', call.me.level === 'head' ? 'A head pauses only their own room; ask its head.' : 'Only heads and the CEO pause a whole room; pause your people\'s tasks one at a time.');
}

/** `before` is the task as it was, with its owner, before the company changed it. */
function steeredWords(s: TaskSteer, before: { task: Task; owner: string } | null, changed: readonly Task[], people: readonly Person[]): string {
  const task = changed[0] ?? before?.task;
  const label = task ? taskLabel(task) : 'the task';
  switch (s.action) {
    case 'pause':
      return `Paused ${label}: ${before ? named(people, before.owner) : 'its owner'} stops at their next step, and its turns wait until you resume it.`;
    case 'resume':
      return `Resumed ${label}; it goes back in line in its place.`;
    case 'cancel': {
      const branch = task?.cancel?.branch;
      return `Cancelled ${label}.${branch ? ` Its work stays on the branch ${branch}.` : ''}`;
    }
    case 'reassign':
      return `${label} is ${who(people, s.to)}'s now, with your note.${before ? ` ${named(people, before.owner)} stops working on it.` : ''}`;
    case 'order':
      return `Set the order of ${plural(s.tasks.length, 'task')}; your people get them first to last.`;
    case 'pause-room':
      return changed.length === 0 ? `Nothing in the ${s.room} room was open to pause.` : `Paused ${plural(changed.length, 'open task')} in the ${s.room} room; their turns wait until you resume them.`;
    case 'resume-room':
      return changed.length === 0 ? `Nothing in the ${s.room} room was paused.` : `Resumed ${plural(changed.length, 'task')} in the ${s.room} room.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// change_settings

/** The changes change_settings takes, one per call. */
const SETTINGS = ['maxDesks', 'idleMinutes', 'planApproval', 'leash', 'effort', 'model', 'removeRule'] as const;
const APPROVAL_WORDS: Record<PlanApproval, string> = {
  'before-work': "the plan waits for the stakeholder's approval before work starts",
  milestones: "the plan waits for the stakeholder's approval before work starts and at every milestone",
  off: 'the plan applies as proposed, without approval',
};
/** A leash, as what the person or room now does: "Kai now waits ...". */
const LEASH_WORDS: Record<(typeof LEASHES)[number], string> = {
  check: 'now waits for the stakeholder before each new task',
  default: "now follows the company's approvals",
  trusted: 'is now Trusted with routine work inside the project',
};

function settingsWords(change: SettingsChange, settings: SteeringSettings, people: readonly Person[]): string {
  if (change.maxDesks !== undefined) return `Now at most ${plural(change.maxDesks, 'person', 'people')} work at once.`;
  if (change.idleMs !== undefined) return `An open desk with nothing to do now closes after ${plural(change.idleMs / 60_000, 'minute')}.`;
  if (change.planApproval !== undefined) return `Plan approval is set: ${APPROVAL_WORDS[change.planApproval]}.`;
  if (change.leash) {
    const asked = change.leash.leash;
    const person = 'person' in change.leash;
    const target = 'person' in change.leash ? named(people, change.leash.person) : `The ${change.leash.room} room`;
    const now = 'person' in change.leash ? settings.leash.people[change.leash.person] : settings.leash.rooms[change.leash.room];
    if (asked === null) return `${target} follows ${person ? 'their room and the company' : 'the company'} again.`;
    if (asked === 'trusted' && now !== 'trusted') return `${target} becomes Trusted once the stakeholder says yes in their inbox.`;
    return `${target} ${LEASH_WORDS[asked]}.`;
  }
  if (change.effort) {
    const effort = change.effort.effort;
    return effort === null ? `${named(people, change.effort.person)} works at Claude Code's default effort from their next desk.` : `${named(people, change.effort.person)} works at ${effort} effort from their next desk.`;
  }
  if (change.model) return `${named(people, change.model.person)} runs on ${change.model.model} from their next desk.`;
  return 'Took the rule away: what it allowed is asked again.';
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan's shape, as tools/list shows it. The company checks it (checkPlan) and names the fields in its sentences.

const MILESTONE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: ITEM_ID.source, description: 'Its id, kept across versions, like "ms-1".' },
    title: { type: 'string', maxLength: PLAN_LIMITS.title, description: 'The milestone in a few words.' },
    doneWhen: { type: 'string', maxLength: PLAN_LIMITS.doneWhen, description: 'How everyone will know it is reached.' },
  },
  required: ['id', 'title', 'doneWhen'],
  additionalProperties: false,
};
const PLAN_TASK_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: ITEM_ID.source, description: 'Its id, kept across versions, like "p-1".' },
    title: { type: 'string', maxLength: PLAN_LIMITS.title, description: 'The task in a few words.' },
    owner: { type: 'string', pattern: ROLE_ID.source, description: 'Who does it: their id from org.' },
    files: { type: 'array', maxItems: LIMITS.files, items: { type: 'string', maxLength: LIMITS.path }, description: 'The files and folders they may change, relative to the project; no two tasks share one.' },
    milestone: { type: 'string', description: 'The id of the milestone it belongs to.' },
    after: { type: 'array', maxItems: PLAN_LIMITS.after, items: { type: 'string' }, description: 'The ids of the tasks it waits for; an empty list when none.' },
    brief: { type: 'string', maxLength: PLAN_LIMITS.brief, description: 'What to do and why.' },
    doneWhen: { type: 'string', maxLength: PLAN_LIMITS.doneWhen, description: 'How everyone will know it is done.' },
    check: { type: 'string', maxLength: PLAN_LIMITS.check, description: 'One command the office can run to see the task is done, like "npm test" or "npm run typecheck && npm test": a plain command line, chained with && if it needs several, no pipes or redirects. Every task a maker does has one; the final verification task has none.' },
    kind: { type: 'string', enum: [...PLAN_TASK_KINDS], description: "\"integration\" for the task that builds and runs a milestone's parts together, leave it out for a task that builds a part. Don't write a \"verification\" task: the office adds the final review itself and replaces one you write." },
  },
  required: ['id', 'title', 'owner', 'files', 'milestone', 'after', 'brief', 'doneWhen'],
  additionalProperties: false,
};
const CONTRACT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: ITEM_ID.source, description: 'Its id, kept across versions, like "c-1".' },
    title: { type: 'string', maxLength: PLAN_LIMITS.title, description: 'The interface it settles, like "Orders API".' },
    file: { type: 'string', maxLength: LIMITS.path, description: 'The project file it lives in, relative to the project: a types module, an OpenAPI or markdown spec. Inside the files of the task that writes it.' },
    writer: { type: 'string', description: 'The id of the task that writes the file.' },
    dependents: { type: 'array', minItems: 1, maxItems: PLAN_LIMITS.dependents, items: { type: 'string' }, description: 'The ids of the tasks that build against it; each waits for the writer.' },
    summary: { type: 'string', maxLength: PLAN_LIMITS.contractSummary, description: 'What it settles, in a line or two.' },
  },
  required: ['id', 'title', 'file', 'writer', 'dependents'],
  additionalProperties: false,
};

const CHECKLIST_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: ITEM_ID.source, description: 'Its id, kept across versions, like "k-1".' },
    text: { type: 'string', maxLength: CHECKLIST_LIMITS.text, description: 'One thing the stakeholder asked for, as a short sentence that can be checked, like "The menu shows each price in CHF."' },
    quote: { type: ['string', 'null'], maxLength: CHECKLIST_LIMITS.quote, description: "The stakeholder's own words it comes from, exactly as written; null when no words fit." },
    covers: { type: 'array', minItems: 1, maxItems: CHECKLIST_LIMITS.covers, items: { type: 'string' }, description: 'The ids of the tasks that build it.' },
    accept: {
      type: 'object',
      description: `How the office accepts it, written now so makers build against it. A walk on the running app: {"kind":"walk","page":"/","steps":[...]}, each step one of: ${STEP_GRAMMAR}; end with a see step. A command: {"kind":"command","command":"npm test"}. Or {"kind":"judgement","why":"..."} when no machine can tell.`,
      properties: {
        kind: { enum: [...ACCEPT_KINDS] },
        page: { type: 'string', maxLength: ACCEPT_LIMITS.page },
        steps: { type: 'array', maxItems: ACCEPT_LIMITS.steps, items: { type: 'string', maxLength: ACCEPT_LIMITS.step } },
        command: { type: 'string', maxLength: PLAN_LIMITS.check },
        why: { type: 'string', maxLength: ACCEPT_LIMITS.why },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  required: ['id', 'text', 'quote', 'covers'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------------------------------------------------
// The tools

export const STEERING_TOOL_DEFS: Record<SteeringTool, ToolDef> = {
  ack: defineTool({
    name: 'ack',
    title: 'Acknowledge a message',
    description:
      'Say in one sentence what you will do with a message, or why you disagree with it. Acknowledge every message from the stakeholder and from your manager as soon as it arrives, before you act on it, naming it by the id its turn gives ("(message m-12)" is m-12). Set agree to false when you disagree, and say why in text. The stakeholder sees it where they follow the message.',
    fields: {
      message: { ...MESSAGE_ID, about: 'The message you acknowledge, by the id its turn gives: "(message m-12)" is m-12.' },
      agree: { type: 'flag', about: 'true when you will do it; false when you disagree.' },
      text: { type: 'text', max: DECISION_LIMITS.what, line: true, about: 'One sentence: what you will do with it, or why you disagree.' },
    },
    run: (call, a) => {
      const ack = steer(call).ack(call.me.id, { message: a.message, agree: a.agree, text: a.text });
      return ack.agree ? `Acknowledged ${ack.message}; whoever follows it sees what you will do.` : `Told them you disagree with ${ack.message}, and why.`;
    },
  }),

  decide: defineTool({
    name: 'decide',
    title: 'Record a decision',
    description:
      "Put a decision you made in the decision log, where the stakeholder sees it and can ask you to reconsider: what you decided, why, and the alternatives you weighed. Use it for choices that shape the work (a library, a layout, the order of tasks), not for routine steps. When it answers a message, put the message's id in cites.",
    fields: {
      what: { type: 'text', max: DECISION_LIMITS.what, line: true, about: 'The decision in a sentence, like "Pickup times come in 15-minute slots."' },
      why: { type: 'text', max: DECISION_LIMITS.why, about: 'Why, in a sentence or two.' },
      alternatives: {
        type: 'list',
        item: { type: 'text', max: DECISION_LIMITS.alternative, line: true, about: 'One option you weighed, in a few words.' },
        max: DECISION_LIMITS.alternatives,
        optional: true,
        about: 'The other options you weighed.',
      },
      cites: CITES,
    },
    run: (call, a) => {
      const decision = steer(call).recordDecision(call.me.id, { what: a.what, why: a.why, alternatives: a.alternatives ?? [], cites: unique(a.cites) });
      return `Recorded in the decision log as ${decision.id}. The stakeholder can ask you to reconsider it.`;
    },
  }),

  steer_task: defineTool({
    name: 'steer_task',
    title: "Steer your team's tasks",
    description:
      "Steer the tasks of the people below you: pause or resume one (a paused task's turns wait), cancel one with a reason (its work stays on a branch), reassign one to another of your people with a note for them, or order your people's tasks (they get them first to last). Heads and the CEO can also pause or resume every open task in a room with pause-room and resume-room: a head their own room. When the stakeholder asked for it, put their message's id in cites.",
    fields: {
      action: { type: 'choice', of: STEER_ACTIONS, about: 'pause, resume, cancel, reassign, order, pause-room or resume-room.' },
      task: { ...TASK, optional: true, about: 'The task, like "t-12": for pause, resume, cancel and reassign.' },
      reason: { type: 'text', max: DECISION_LIMITS.note, optional: true, about: 'Why it is cancelled: needed to cancel.' },
      to: { ...PERSON, optional: true, about: 'Who takes it over, one of your people: needed to reassign.' },
      note: { type: 'text', max: PLAN_LIMITS.note, optional: true, about: 'What the new owner needs to know: needed to reassign.' },
      tasks: { type: 'list', item: TASK, min: 1, max: PLAN_LIMITS.tasks, optional: true, about: "Your people's tasks in the order they should go: needed to order." },
      room: { ...ROOM, optional: true, about: 'The room: for pause-room and resume-room.' },
      cites: CITES,
    },
    run: (call, a) => {
      const takes = STEER_TAKES[a.action];
      const extra = Object.keys(a).filter((key) => key !== 'action' && key !== 'cites' && !takes.includes(key));
      if (extra.length > 0) throw badArgs(`action "${a.action}" doesn't take ${andList(extra)}; it takes ${andList([...takes, 'cites'])}.`);
      const needs = <T>(value: T | undefined, field: string): T => {
        if (value === undefined) throw badArgs(`action "${a.action}" needs ${field}.`);
        return value;
      };
      const cites = unique(a.cites);
      let before: { task: Task; owner: string } | null = null;
      const one = (id: string) => {
        const task = teamTask(call, id);
        before = { task, owner: task.owner };
        return task.id;
      };
      let s: TaskSteer;
      switch (a.action) {
        case 'pause':
        case 'resume':
          s = { action: a.action, task: one(needs(a.task, 'task')), cites };
          break;
        case 'cancel':
          s = { action: 'cancel', task: one(needs(a.task, 'task')), reason: needs(a.reason, 'reason'), cites };
          break;
        case 'reassign':
          s = { action: 'reassign', task: one(needs(a.task, 'task')), to: teamMember(call, needs(a.to, 'to')), note: needs(a.note, 'note'), cites };
          break;
        case 'order': {
          const ids = needs(a.tasks, 'tasks');
          const twice = ids.find((id, i) => ids.indexOf(id) !== i);
          if (twice !== undefined) throw badArgs(`tasks has ${twice} twice; give each task once.`);
          s = { action: 'order', tasks: ids.map((id) => teamTask(call, id).id), cites };
          break;
        }
        case 'pause-room':
        case 'resume-room':
          s = { action: a.action, room: ownRoom(call, needs(a.room, 'room')), cites };
          break;
      }
      return steeredWords(s, before, steer(call).steerTask(call.me.id, s), call.people);
    },
  }),

  propose_plan: defineTool({
    name: 'propose_plan',
    title: 'Propose the plan',
    description: `Propose the plan the company works from, once it has started: the goal, up to ${PLAN_LIMITS.milestones} milestones and up to ${PLAN_LIMITS.tasks} tasks, in the order they should go. A milestone has an id ("ms-1"), a title and when it is done. A task has an id ("p-1"), a title, an owner (their id from org), the files and folders they may change (no two tasks share one), its milestone, the ids of the tasks it waits for (after), a brief, when it is done and its check. A task is a whole piece of work with its own tests in it: never one task to build a thing and another to test it, never one only for the README, and never one maker's work cut by phase ("build", then "polish, responsive, accessible"): accessibility, responsive layout, print and polish are requirements of the feature, in its brief and doneWhen. Plan the fewest tasks that run in parallel, each a feature a person finishes in one sitting: a maker holds at most 2 tasks under Lean, 3 under Balanced and 4 under Thorough (the final review not counted). A task too big for one context (files in more than 6 areas, not counting config, lockfiles, README and docs; a brief over 2400 characters; more than 6 requirements) is narrowed to one feature or split by feature, never by file. Every task a maker does has a check, one plain command the office can run to see it is done, like "npm test" or "npm run typecheck && npm test". Don't write the final verification task: the office adds it to a medium or large plan (the checker seat's or yours, after every other task, citing the stakeholder's words) and replaces one you wrote, and a small plan has none, since you check the result against the stakeholder's words yourself at the end. When 3 or more makers build parts and one's tasks wait for another's, the plan has a contract in contracts for what they share (an API's routes and shapes, a data schema, a shared module's exports): the real file it lives in, the task that writes it first (writer, the first task of the stream that owns it) and the tasks that build against it (dependents, each waiting for the writer); a large plan also has an integration task (kind "integration") at each milestone where several people's work meets. Text over its limit is cut at a sentence end, and a task whose brief reads a file another task owns is made to wait for it: neither is refused, and the answer says what changed. The stakeholder reviews it, may change it and approves it; none of its work starts before then. To revise it, propose it again: keep the ids of what stays, say what changed in note, and put the stakeholder's message that asked for it in cites. A checklist: each thing the stakeholder asked for, as a short sentence that can be checked, quoting their words in quote where it can, with the tasks that cover it; every task covers at least one. Give each item its accept where a machine can check it (a walk through the app's pages, or a command), so the makers build to its exact names. A plan that breaks a rule comes back with what to fix.`,
    fields: {
      goal: { type: 'data', json: 'text', schema: { maxLength: PLAN_LIMITS.goal }, about: 'What the company is building, in a sentence or two.' },
      milestones: { type: 'data', json: 'list', schema: { minItems: 1, maxItems: PLAN_LIMITS.milestones, items: MILESTONE_SCHEMA }, about: 'The milestones, in order.' },
      tasks: { type: 'data', json: 'list', schema: { maxItems: PLAN_LIMITS.tasks, items: PLAN_TASK_SCHEMA }, about: 'The tasks, in the order they should go.' },
      contracts: { type: 'data', json: 'list', optional: true, schema: { maxItems: PLAN_LIMITS.contracts, items: CONTRACT_SCHEMA }, about: 'The interfaces two or more streams share, agreed first: each with its file, the task that writes it and the tasks that build on it. A plan of one to three tasks needs none.' },
      checklist: { type: 'data', json: 'list', optional: true, schema: { minItems: 1, maxItems: CHECKLIST_LIMITS.items, items: CHECKLIST_SCHEMA }, about: "What the stakeholder asked for, as checkable sentences with their words and the tasks that cover each; the final review judges every item." },
      note: { type: 'text', max: PLAN_LIMITS.note, optional: true, about: 'What this version changes, in a sentence or two.' },
      cites: CITES,
    },
    run: (call, a) => {
      const result = steer(call).proposePlan(call.me.id, { goal: a.goal, milestones: a.milestones, tasks: a.tasks, ...(a.contracts !== undefined ? { contracts: a.contracts } : {}), ...(a.checklist !== undefined ? { checklist: a.checklist } : {}), note: a.note ?? null, cites: unique(a.cites) });
      if (!result.ok) throw refuse('invalid', bullets(result.errors));
      const v = result.version;
      const changed = result.notes && result.notes.length > 0 ? ` The office changed: ${result.notes.slice(0, 4).join(' ')}${result.notes.length > 4 ? ` And ${result.notes.length - 4} more.` : ''}` : '';
      return `Proposed version ${v.version} of the plan: ${plural(v.plan.milestones.length, 'milestone')} and ${plural(v.plan.tasks.length, 'task')}. The stakeholder reviews it and approves it; none of its work starts before then, and what they want changed comes to you as a message.${changed}`;
    },
  }),

  approve_plan: defineTool({
    name: 'approve_plan',
    title: 'Approve the plan for the stakeholder',
    description:
      'Approve a version of the plan only when the stakeholder told you to in a message to you, and put that message in cites by the id its turn gives; it must be newer than the version, so they saw what they approved. Never approve on your own judgment: they can approve it in the office themselves. When the plan is approved milestone by milestone, through approves up to and including that milestone; leave it out to approve the whole plan.',
    fields: {
      version: { type: 'integer', min: 1, max: 1_000_000, about: 'The version they approved, as propose_plan numbered it.' },
      through: { type: 'id', of: 'item', like: 'ms-2', optional: true, about: 'The last milestone it approves, by its id; leave it out for the whole plan.' },
      cites: STAKEHOLDER_CITES,
    },
    run: (call, a) => {
      const state = steer(call).approvePlan(call.me.id, { version: a.version, through: a.through ?? null, cites: unique(a.cites) });
      const through = state.through ? ` through the milestone ${state.through}` : '';
      return `Approved version ${state.version} of the plan${through}, as the stakeholder asked in ${andList(state.cites)}. Its tasks go to their owners in order.`;
    },
  }),

  mark_checklist: defineTool({
    name: 'mark_checklist',
    title: 'Mark the checklist',
    description:
      'Mark each checklist item met, partly or not-met with the evidence: the check you ran and its result, the files, the preview page. Only the final review\'s owner, on that task.',
    fields: {
      task: { ...TASK, about: 'The final review or re-check task you are on, like "t-12".' },
      items: {
        type: 'list',
        min: 1,
        max: CHECKLIST_LIMITS.items,
        about: 'One entry per item you judged, by the ids the company brief gives them.',
        item: {
          type: 'object',
          about: 'One checklist item and your verdict on it.',
          fields: {
            item: { type: 'id', of: 'item', like: 'k-2', about: 'The checklist item, like "k-2".' },
            verdict: { type: 'choice', of: VERDICTS, about: '"met", "partly" or "not-met".' },
            evidence: { type: 'text', max: CHECKLIST_LIMITS.evidence, about: 'What you saw: what you ran or opened, and what it showed.' },
            files: { type: 'list', item: { type: 'text', max: LIMITS.path, line: true, about: 'A project path, like "src/menu.ts".' }, max: CHECKLIST_LIMITS.files, optional: true, about: 'The files that show it.' },
            check: {
              type: 'object',
              optional: true,
              about: 'The command you ran for it and whether it passed.',
              fields: {
                ran: { type: 'text', max: REPORT_FORM.ran, line: true, about: 'The command, like "npm test".' },
                passed: { type: 'flag', about: 'true when it passed.' },
              },
            },
            page: { type: 'text', max: CHECKLIST_LIMITS.page, line: true, optional: true, pattern: CHECKLIST_PAGE, shape: 'a path on the preview, like "/menu"', about: 'The page of the preview that shows it, like "/menu".' },
          },
        },
      },
    },
    run: (call, a) => {
      const marked = steer(call).markChecklist(call.me.id, {
        task: a.task,
        items: a.items.map((i) => ({ item: i.item, verdict: i.verdict, evidence: i.evidence, files: i.files ?? [], check: i.check ?? null, page: i.page ?? null })),
      });
      return `Marked ${plural(marked.length, 'checklist item')}. Report the review with report once every item is marked; the office sends each item not met back to its maker.`;
    },
  }),

  change_settings: defineTool({
    name: 'change_settings',
    title: "Change a setting for the stakeholder",
    description: `Change one company setting, only when the stakeholder asks you to in a message to you, and put that message in cites by the id its turn gives. maxDesks: how many people work at once (${DESKS.min} to ${DESKS.max}). idleMinutes: how long an open desk with nothing to do stays open. planApproval: before-work, milestones or off. leash, for a person or a whole room: check (each new task waits for the stakeholder), default (the company's approvals) or trusted (routine work inside the project without asking, which waits for the stakeholder's yes in their inbox), or clear to drop their own setting. effort and model, for a person: from their next desk. removeRule: an Always allow rule to take away, exactly as written.`,
    fields: {
      maxDesks: { type: 'integer', min: DESKS.min, max: DESKS.max, optional: true, about: 'How many people may work at once in this company.' },
      idleMinutes: { type: 'integer', min: IDLE_MINUTES.min, max: IDLE_MINUTES.max, optional: true, about: 'How long an open desk with nothing to do stays open, in minutes.' },
      planApproval: { type: 'choice', of: PLAN_APPROVALS, optional: true, about: '"before-work", "milestones" or "off".' },
      leash: { type: 'choice', of: [...LEASHES, 'clear'], optional: true, about: 'For person or room: "check", "default", "trusted", or "clear" to drop their own setting.' },
      effort: { type: 'choice', of: [...EFFORTS, 'clear'], optional: true, about: 'For person: Claude Code\'s effort, or "clear" for its default.' },
      model: { type: 'choice', of: ROLE_MODELS, optional: true, about: 'For person: the model they run on.' },
      person: { ...PERSON, optional: true, about: 'Whose leash, effort or model: their id from org.' },
      room: { ...ROOM, optional: true, about: 'A whole room, for its leash: its id.' },
      removeRule: { type: 'text', max: 1_000, line: true, optional: true, about: 'The Always allow rule to take away, as the settings list it.' },
      cites: STAKEHOLDER_CITES,
    },
    run: (call, a) => {
      const given = SETTINGS.filter((key) => a[key] !== undefined);
      if (given.length !== 1) throw badArgs(`change_settings takes one change at a time: one of ${andList([...SETTINGS])}.`);
      const [kind] = given;
      const forPerson = kind === 'effort' || kind === 'model';
      const forEither = kind === 'leash';
      if (!forPerson && !forEither && (a.person !== undefined || a.room !== undefined)) throw badArgs(`${kind ?? 'that'} is the company's: it takes no person or room.`);
      if (forPerson && (a.person === undefined || a.room !== undefined)) throw badArgs(`${kind ?? 'that'} needs person, and is for one person, not a room.`);
      if (forEither && (a.person === undefined) === (a.room === undefined)) throw badArgs('leash needs one of person or room: whose leash it is.');
      if (a.person !== undefined) mustExist(call.people, a.person);
      if (a.room !== undefined) roomExists(call.people, a.room);
      let change: SettingsChange;
      if (a.maxDesks !== undefined) change = { maxDesks: a.maxDesks };
      else if (a.idleMinutes !== undefined) change = { idleMs: a.idleMinutes * 60_000 };
      else if (a.planApproval !== undefined) change = { planApproval: a.planApproval };
      else if (a.leash !== undefined) {
        const leash = a.leash === 'clear' ? null : a.leash;
        change = { leash: a.person !== undefined ? { person: a.person, leash } : { room: a.room ?? '', leash } };
      } else if (a.effort !== undefined) change = { effort: { person: a.person ?? '', effort: a.effort === 'clear' ? null : a.effort } };
      else if (a.model !== undefined) change = { model: { person: a.person ?? '', model: a.model } };
      else change = { removeRule: a.removeRule ?? '' };
      const settings = steer(call).changeSettings(call.me.id, { ...change, cites: unique(a.cites) });
      return `${settingsWords(change, settings, call.people)} It is in the decision log.`;
    },
  }),
};
