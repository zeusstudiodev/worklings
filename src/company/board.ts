// The task board (SPEC-v3.md "Steering", 4): the order work is handed out in, pause and resume (a task with its parts,
// or a whole room), cancel with a reason and the work kept on a branch, reassign with a handover note, a task the
// stakeholder creates, and handing a task to its owner, which waits for the stakeholder's start when the owner checks
// with them first (the leash). Pure over the SteerCtx: the company commits the steps and carries out their effects
// (stops, deliveries, the save's git work), so the switchboard and the approvals policy enforce what the board says.
import { isOpenTask } from '../core/company-state.ts';
import { chainUp, LIMITS, type Message, mayAssign, OrgRefusal, type Person, personById, type Question, STAKEHOLDER, type Task, THE_OFFICE } from '../core/company.ts';
import { oneLine } from '../core/events.ts';
import { movedInOrder } from '../core/planDiff.ts';
import { pathsOverlap } from '../core/plan.ts';
import { type NewTaskInput, PLAN_LIMITS, type TaskSteer } from '../core/steering.ts';
import { effectiveLeash, taskOfTurn } from '../core/steering-state.ts';
import { capital } from '../core/words.ts';
import { checkTaskFiles } from './files.ts';
import {
  actor,
  after,
  andList,
  bossName,
  called,
  cleanBlock,
  cleanLine,
  decided,
  inLog,
  member,
  type Outcome,
  rawLength,
  roomOf,
  roomTitle,
  stakeholderCites,
  stakeholderWord,
  type SteerCtx,
  type SteerEffect,
  type SteerEvent,
  type Step,
  step,
  titled,
  unstopped,
  type World,
} from './decisions.ts';

/** Desks that are in a turn: an owner there hears a pause, a cancel or a handover as an interrupt. */
const AT_WORK = new Set(['starting', 'working', 'stopping']);
/** Tasks one order can name, far past any board. */
const MAX_ORDER = 1_000;
/** What a handover carries of the old owner's account, in characters. */
const SO_FAR = 3_000;

// ---------------------------------------------------------------------------------------------------------------
// Priority

const rank = (t: Task): number => t.priority ?? Number.POSITIVE_INFINITY;

/** Open tasks in the order work is handed out: by priority (lower first), then in the order they were asked for. */
export function priorityOrder(tasks: readonly Task[]): Task[] {
  return tasks.filter(isOpenTask).sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The end of the line: after every open task. */
export function nextPriority(tasks: readonly Task[]): number {
  let n = 0;
  for (const t of tasks) if (isOpenTask(t) && t.priority !== undefined && Number.isFinite(t.priority)) n = Math.max(n, t.priority);
  return n + 1;
}

/** A new task's place: a part of a task goes where the task is, anything else at the end of the line. */
export function priorityFor(tasks: readonly Task[], parent: string | null): number {
  const p = parent === null ? undefined : tasks.find((t) => t.id === parent);
  return p?.priority ?? nextPriority(tasks);
}

/** The priority a turn carries to the switchboard: its task's, so a person's next task and the desk line follow the board. */
export function turnPriority(w: Pick<World, 'state' | 'steering'>, messageId: string): number | undefined {
  const taskId = taskOfTurn({ assignments: w.state.assignments, steering: w.steering }, messageId);
  return taskId === undefined ? undefined : w.state.tasks.find((t) => t.id === taskId)?.priority;
}

/**
 * The open tasks' new order: the tasks named take the places they hold between them, in the order given, and the
 * others keep theirs. So a team's own order moves only that team's tasks.
 */
export function reorder(current: readonly string[], named: readonly string[]): string[] {
  const picked = new Set(named);
  const queue = named.filter((id) => current.includes(id));
  let k = 0;
  return current.map((id) => (picked.has(id) ? (queue[k++] ?? id) : id));
}

/** The priority events that make an order real: 1, 2, 3... for the open tasks, only where a number changes. */
function renumber(tasks: readonly Task[], order: readonly string[]): [string, number][] {
  const out: [string, number][] = [];
  order.forEach((id, i) => {
    const t = tasks.find((x) => x.id === id);
    if (t && t.priority !== i + 1) out.push([id, i + 1]);
  });
  return out;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const placeWord = (n: number): string => ORDINALS[n - 1] ?? `${n}th`;

// ---------------------------------------------------------------------------------------------------------------
// Handing out: the "check with me" gate

/** Messages that are a task's turns and haven't reached its owner. */
export function waitingTurns(ctx: Pick<SteerCtx, 'state' | 'steering'>, taskId: string): Message[] {
  const host = { assignments: ctx.state.assignments, steering: ctx.steering };
  return ctx.state.messages.filter((m) => m.deliveredAt === null && taskOfTurn(host, m.id) === taskId);
}

/** Whether a task reached its owner's hands: a turn of it was delivered, or it is past queued. */
export function started(ctx: Pick<SteerCtx, 'state' | 'steering'>, t: Task): boolean {
  if (t.status !== 'queued') return true;
  const host = { assignments: ctx.state.assignments, steering: ctx.steering };
  return ctx.state.messages.some((m) => m.deliveredAt !== null && m.to === t.owner && taskOfTurn(host, m.id) === t.id);
}

/**
 * For an owner who checks with the stakeholder before each task: the question from the office that holds the task's
 * hand-out until the stakeholder says start (option 0). Null for everyone else.
 */
export function gateFor(ctx: SteerCtx, task: Task, messageId: string): Step | null {
  const owner = personById(ctx.people, task.owner);
  if (!owner || effectiveLeash(ctx.steering.settings, owner).leash !== 'check') return null;
  const question: Question = {
    id: ctx.newId('question'),
    from: THE_OFFICE,
    text: `${capital(called(ctx, owner.id))} would like to start ${titled(task.title)}. Start it, or hold it until you resume it?`,
    options: ['Start it', 'Not now'],
    recommended: null,
    taskId: task.id,
    askedAt: ctx.now,
    answer: null,
    withdrawn: null,
    gate: { task: task.id },
  };
  return step([{ type: 'question', question }, { type: 'gate', message: messageId, question: question.id }]);
}

/**
 * Hands a task to its owner with this message, which becomes the task's assignment: delivered now, or, for an owner
 * who checks with the stakeholder, held behind the gate's question.
 */
export function handOut(ctx: SteerCtx, task: Task, message: Message, cwd?: string): Step[] {
  const handed = step([{ type: 'message', message }, { type: 'handed-out', message: message.id, task: task.id }]);
  const gate = gateFor(ctx, task, message.id);
  if (gate) return [handed, gate];
  return [{ ...handed, effects: [{ kind: 'deliver', message: message.id, ...(cwd ? { cwd } : {}) }] }];
}

/** Withdraws the gate questions of messages that won't go out: their task is over, or someone else has it now. */
function dropGates(ctx: SteerCtx, messages: readonly Message[], reason: string): SteerEvent[] {
  const out: SteerEvent[] = [];
  for (const m of messages) {
    const question = Object.hasOwn(ctx.steering.gates, m.id) ? ctx.steering.gates[m.id] : undefined;
    if (question === undefined) continue;
    out.push({ type: 'withdrawn', id: question, reason, at: ctx.now }, { type: 'gate', message: m.id, question: null });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Who may steer what

/**
 * Checks that `by` may steer this task, and gives the stakeholder's message they act on, if any. The stakeholder may
 * steer anything. A manager steers their own people's tasks and the ones they asked for; a task the stakeholder asked
 * for takes the stakeholder's word, cited, newer than the task's last change.
 */
function maySteer(ctx: SteerCtx, by: string, task: Task, cites: unknown): Message | null {
  if (by === STAKEHOLDER) return null;
  const steerer = member(ctx, by);
  const name = capital(called(ctx, steerer.id));
  if (steerer.level === 'worker') {
    const manager = personById(ctx.people, steerer.reportsTo ?? '');
    throw new OrgRefusal('not-allowed', `${name} can't steer tasks; ${manager ? `ask ${called(ctx, manager.id)}, who can` : 'only managers can'}.`);
  }
  if (task.askedBy !== by && !mayAssign(ctx.people, by, task.owner)) {
    const theirs = chainUp(ctx.people, task.owner)[0];
    throw new OrgRefusal('not-allowed', `Task ${task.id} is ${called(ctx, task.owner)}'s, who isn't in ${called(ctx, by)}'s team; ${theirs ? `ask ${called(ctx, theirs.id)} to steer it` : 'leave it to its owner'}.`);
  }
  if (task.askedBy === STAKEHOLDER) {
    return stakeholderWord(ctx, by, cites, Object.hasOwn(ctx.steering.changedAt, `task:${task.id}`) ? (ctx.steering.changedAt[`task:${task.id}`] ?? 0) : 0, `task ${task.id}, which ${bossName(ctx)} asked for`);
  }
  return null;
}

/** The cites a steered task records: the stakeholder's word acted on, or the stakeholder's messages it names. */
function citesFor(ctx: SteerCtx, by: string, word: Message | null, cites: unknown): string[] {
  if (word) return [word.id];
  return by === STAKEHOLDER ? [] : stakeholderCites(ctx, by, cites);
}

function taskOf(ctx: SteerCtx, id: unknown): Task {
  const t = typeof id === 'string' ? ctx.state.tasks.find((x) => x.id === id) : undefined;
  if (!t) throw new OrgRefusal('unknown', `There's no task ${oneLine(String(id), 40)}.`);
  return t;
}

/** A task and its open parts, nearest first. */
function withParts(tasks: readonly Task[], root: Task): Task[] {
  const out = [root];
  const seen = new Set([root.id]);
  for (let i = 0; i < out.length; i += 1) {
    const at = out[i];
    if (!at) continue;
    for (const t of tasks) {
      if (t.parent === at.id && !seen.has(t.id) && isOpenTask(t)) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}

const parts = (n: number): string => (n === 0 ? '' : n === 1 ? ' and its part' : ` and its ${n} parts`);

// ---------------------------------------------------------------------------------------------------------------
// Telling owners

/**
 * The notice an owner gets when a task of theirs changes under them. An owner at work hears it as an interrupt; one
 * who started the task but isn't at work now gets it as their next turn; one who never got the task hears nothing.
 */
function notice(ctx: SteerCtx, owner: string, text: string): { message: Message; effect: SteerEffect } {
  const message = ctx.newMessage(THE_OFFICE, owner, text, { interrupt: AT_WORK.has(ctx.deskState(owner)) });
  return { message, effect: message.interrupt ? { kind: 'stop', message: message.id } : { kind: 'deliver', message: message.id } };
}

/** Tasks grouped by owner, in the order they come. */
function byOwner(tasks: readonly Task[]): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const t of tasks) out.set(t.owner, [...(out.get(t.owner) ?? []), t]);
  return out;
}

const taskList = (tasks: readonly Task[]): string => andList(tasks.map((t) => `${t.id}, ${titled(t.title)}`));

// ---------------------------------------------------------------------------------------------------------------
// Pause and resume

function pauseSteps(ctx: SteerCtx, by: string, tasks: readonly Task[], cites: readonly string[]): Step {
  const events: SteerEvent[] = [];
  const effects: SteerEffect[] = [];
  const paused = { at: ctx.now, by };
  for (const t of tasks) {
    events.push({ type: 'task-paused', id: t.id, paused, at: ctx.now });
    if (cites.length > 0) events.push({ type: 'task-cites', id: t.id, cites: [...cites] });
    const held = waitingTurns(ctx, t.id).map((m) => m.id);
    if (held.length > 0) effects.push({ kind: 'take-back', messages: held, unsend: false });
  }
  const who = by === STAKEHOLDER ? bossName(ctx) : called(ctx, by);
  for (const [owner, theirs] of byOwner(tasks.filter((t) => t.status === 'working'))) {
    if (!personById(ctx.people, owner)) continue;
    // Only work that has reached them: a task whose turn hasn't come isn't theirs to carry on with yet.
    const others = ctx.state.tasks.some((t) => t.owner === owner && isOpenTask(t) && !t.paused && !theirs.includes(t) && started(ctx, t));
    const n = notice(
      ctx,
      owner,
      `${capital(who)} paused ${theirs.length === 1 ? 'task' : 'tasks'} ${taskList(theirs)}. Stop work on ${theirs.length === 1 ? 'it' : 'them'} now and wait: you'll hear when ${theirs.length === 1 ? 'it resumes' : 'they resume'}.${others ? ' Your other work carries on.' : ''}`,
    );
    events.push({ type: 'message', message: n.message });
    effects.push(n.effect);
  }
  return step(events, effects);
}

function resumeSteps(ctx: SteerCtx, by: string, tasks: readonly Task[], cites: readonly string[]): Step {
  const events: SteerEvent[] = [];
  const effects: SteerEffect[] = [];
  const who = by === STAKEHOLDER ? bossName(ctx) : called(ctx, by);
  const carryOn: Task[] = [];
  for (const t of tasks) {
    events.push({ type: 'task-paused', id: t.id, paused: null, at: ctx.now });
    if (cites.length > 0) events.push({ type: 'task-cites', id: t.id, cites: [...cites] });
    const held = waitingTurns(ctx, t.id);
    for (const m of held) effects.push({ kind: 'deliver', message: m.id, ...(t.worktree ? { cwd: t.worktree.path } : {}) });
    if (held.length === 0 && t.status === 'working') carryOn.push(t);
  }
  for (const [owner, theirs] of byOwner(carryOn)) {
    if (!personById(ctx.people, owner)) continue;
    const message = ctx.newMessage(THE_OFFICE, owner, `${capital(who)} resumed ${theirs.length === 1 ? 'task' : 'tasks'} ${taskList(theirs)}: carry on where you stopped.`);
    events.push({ type: 'message', message });
    // A turn of the task: paused again before it goes out, it waits with the task.
    const first = theirs[0];
    if (first) events.push({ type: 'task-turn', message: message.id, task: first.id });
    effects.push({ kind: 'deliver', message: message.id, ...(first?.worktree ? { cwd: first.worktree.path } : {}) });
  }
  return step(events, effects);
}

// ---------------------------------------------------------------------------------------------------------------
// Cancel, and opening a cancelled task again

/**
 * Cancels tasks with their open parts: each is dropped with the reason, its owner stops (an interrupt when at work),
 * its turns not yet delivered are taken back, and whoever asked for it is told. The work stays on a branch: a
 * worktree's own, or, in the shared checkout, a commit the office makes once the owners heard to stop (savesDue).
 */
export function cancelSteps(ctx: SteerCtx, by: string, roots: readonly Task[], reason: string, cites: readonly string[]): { steps: Step[]; cancelled: Task[] } {
  const all: Task[] = [];
  for (const root of roots) for (const t of withParts(ctx.state.tasks, root)) if (!all.includes(t)) all.push(t);
  const events: SteerEvent[] = [];
  const effects: SteerEffect[] = [];
  const who = by === STAKEHOLDER ? bossName(ctx) : called(ctx, by);
  const at = ctx.now;
  const savable = ctx.state.branch !== null;
  for (const t of all) {
    const turns = waitingTurns(ctx, t.id);
    events.push(
      ...dropGates(ctx, turns, `${capital(who)} cancelled the task.`),
      { type: 'task-status', id: t.id, status: 'dropped', at, outcome: `Cancelled: ${reason}` },
      { type: 'task-cancelled', id: t.id, cancel: { at, by, reason, branch: t.worktree?.branch ?? null } },
    );
    if (cites.length > 0) events.push({ type: 'task-cites', id: t.id, cites: [...cites] });
    if (turns.length > 0) effects.push({ kind: 'take-back', messages: turns.map((m) => m.id), unsend: true });
  }
  const begun = all.filter((t) => started(ctx, t));
  const notices = new Map<string, string>();
  for (const [owner, theirs] of byOwner(begun)) {
    if (!personById(ctx.people, owner)) continue;
    const where = theirs.every((t) => t.worktree)
      ? `the work stays on ${theirs.length === 1 ? 'its branch' : 'their branches'}`
      : savable
        ? 'the office keeps what you changed on a branch'
        : "the project isn't a git repository, so what you changed stays as it is";
    const n = notice(ctx, owner, `${capital(who)} cancelled ${theirs.length === 1 ? 'task' : 'tasks'} ${taskList(theirs)}: ${unstopped(reason)}. Stop work on ${theirs.length === 1 ? 'it' : 'them'} now and leave ${theirs.length === 1 ? 'its' : 'their'} files as they are: ${where}.`);
    events.push({ type: 'message', message: n.message });
    effects.push(n.effect);
    notices.set(owner, n.message.id);
  }
  // Whoever asked for the work hears of it, so they don't wait for its report.
  for (const [asker, theirs] of byOwner(all.filter((t) => t.askedBy !== by && t.askedBy !== STAKEHOLDER).map((t) => ({ ...t, owner: t.askedBy })))) {
    if (!personById(ctx.people, asker) || notices.has(asker)) continue;
    const message = ctx.newMessage(THE_OFFICE, asker, `${capital(who)} cancelled ${theirs.length === 1 ? 'task' : 'tasks'} ${taskList(theirs)}: ${unstopped(reason)}. Nothing more comes of ${theirs.length === 1 ? 'it' : 'them'}.`);
    events.push({ type: 'message', message });
    effects.push({ kind: 'deliver', message: message.id });
  }
  // The saves: a worktree's own branch keeps its work; the shared checkout's started tasks are saved together.
  if (savable) {
    // Every worktree, started or not: the save leaves it ready to go once its owner is off work.
    for (const t of all.filter((x) => x.worktree)) events.push({ type: 'saving', task: t.id, saving: { after: [notices.get(t.owner)].filter((x): x is string => x !== undefined), covers: [t.id] } });
    const inCheckout = begun.filter((x) => !x.worktree && x.files.length > 0);
    const first = inCheckout[0];
    if (first) {
      const after = [...new Set(inCheckout.map((t) => notices.get(t.owner)).filter((x): x is string => x !== undefined))];
      events.push({ type: 'saving', task: first.id, saving: { after, covers: inCheckout.map((t) => t.id) } });
    }
  }
  return { steps: [step(events, effects)], cancelled: all };
}

/** Opens cancelled tasks again (the undo of a cancel): back in line, with their earlier work named on its branch. */
export function reopenSteps(ctx: SteerCtx, taskIds: readonly string[]): Step[] {
  const steps: Step[] = [];
  for (const id of taskIds) {
    const t = ctx.state.tasks.find((x) => x.id === id);
    if (!t || t.status !== 'dropped' || !t.cancel) continue;
    const events: SteerEvent[] = [
      { type: 'task-status', id: t.id, status: 'queued', at: ctx.now, outcome: null },
      { type: 'task-reopened', id: t.id, at: ctx.now },
    ];
    // A save still waiting goes: the files are where the owner left them. So does a worktree's retirement, since the
    // task opens in it again.
    for (const [key, saving] of Object.entries(ctx.steering.saving)) if (saving.covers.includes(t.id)) events.push({ type: 'saving', task: key, saving: null });
    if (Object.hasOwn(ctx.state.retiring, t.id)) events.push({ type: 'retired', id: t.id });
    steps.push(step(events));
    if (!personById(ctx.people, t.owner)) continue;
    const branch = t.cancel.branch;
    const earlier = branch
      ? t.worktree
        ? ` Your desk opens in its worktree again, on the branch ${branch}, with your earlier work.`
        : ` Your earlier work on it is on the branch ${branch}; bring back what you need from there (git checkout ${branch} -- <file>).`
      : '';
    const message = ctx.newMessage(THE_OFFICE, t.owner, [`Task ${t.id}, ${titled(t.title)}, is open again: ${bossName(ctx)} undid its cancel.${earlier}`, '', ...briefLines(t)].join('\n'));
    if (t.worktree) {
      // Its worktree comes back first; the turn then goes out there, after the stakeholder's start for one who checks.
      steps.push(step([{ type: 'message', message }, { type: 'handed-out', message: message.id, task: t.id }], [{ kind: 'reopen-worktree', task: t.id, message: message.id }]));
      const gate = gateFor(ctx, t, message.id);
      if (gate) steps.push(gate);
    } else steps.push(...handOut(ctx, t, message));
  }
  return steps;
}

/** The brief, files and done-when of a task, as its assignment gives them. */
export function briefLines(t: Pick<Task, 'brief' | 'files' | 'doneWhen'>): string[] {
  return [
    ...(t.brief ? [t.brief, ''] : []),
    t.files.length > 0 ? `Files you may change: ${t.files.join(', ')}.` : 'It names no files, so change nothing in the project without asking first.',
    `Done when: ${t.doneWhen}`,
    "Report with report when it's done or blocked.",
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Saving cancelled work

/** Saves whose owners heard to stop, or can't any more (gone, the message gone): the company runs them now. */
export function savesDue(ctx: Pick<SteerCtx, 'state' | 'steering' | 'people'>): string[] {
  const out: string[] = [];
  for (const [key, saving] of Object.entries(ctx.steering.saving)) {
    const waits = saving.after.some((id) => {
      const m = ctx.state.messages.find((x) => x.id === id);
      return m !== undefined && m.deliveredAt === null && personById(ctx.people, m.to) !== undefined;
    });
    if (!waits) out.push(key);
  }
  return out;
}

export type SaveJob =
  | { kind: 'worktree'; worktree: NonNullable<Task['worktree']>; task: Task; message: string }
  | { kind: 'checkout'; task: Task; files: string[]; message: string };

/** What git does for a save: commit a worktree's last changes on its branch, or the checkout's onto a branch of their own. */
export function saveJob(ctx: Pick<SteerCtx, 'state' | 'steering' | 'people' | 'fired'>, key: string): SaveJob | null {
  const saving = Object.hasOwn(ctx.steering.saving, key) ? ctx.steering.saving[key] : undefined;
  const task = ctx.state.tasks.find((t) => t.id === key);
  if (!saving || !task) return null;
  const covered = saving.covers.map((id) => ctx.state.tasks.find((t) => t.id === id)).filter((t): t is Task => t !== undefined);
  const reason = task.cancel?.reason ?? 'cancelled';
  const message = [
    oneLine(`Unfinished: ${task.title}`, 72),
    '',
    `Saved when ${bossName(ctx)} cancelled it: ${reason}`,
    '',
    `Worklings task ${task.id}${covered.length > 1 ? `, with ${andList(covered.slice(1).map((t) => t.id))}` : ''}, by ${called(ctx, task.owner)}.`,
  ].join('\n');
  if (task.worktree) return { kind: 'worktree', worktree: task.worktree, task, message };
  const files = [...new Set(covered.flatMap((t) => t.files))];
  return { kind: 'checkout', task, files, message };
}

/** A save finished: the branch the work stays on, a worktree retired once its owner is off work, and who needs to hear. */
export function saved(ctx: SteerCtx, key: string, result: { branch: string | null; problem: string | null }): Outcome<void> {
  const saving = Object.hasOwn(ctx.steering.saving, key) ? ctx.steering.saving[key] : undefined;
  const task = ctx.state.tasks.find((t) => t.id === key);
  if (!saving || !task) return { steps: [], result: undefined };
  const events: SteerEvent[] = [{ type: 'task-saved', save: key, tasks: [...saving.covers], branch: result.branch }];
  const effects: SteerEffect[] = [];
  if (task.worktree && task.cancel && result.problem === null) events.push({ type: 'retire', id: task.id, person: task.owner, worktree: task.worktree });
  if (result.problem !== null) {
    const m = ctx.newMessage(THE_OFFICE, STAKEHOLDER, `The office couldn't keep the work of ${titled(task.title)} on a branch: ${unstopped(result.problem)}. Its files stay as ${called(ctx, task.owner)} left them.`);
    events.push({ type: 'message', message: m });
  }
  // Opened again before the save ended: its owner hears where the earlier work went.
  for (const id of saving.covers) {
    const t = ctx.state.tasks.find((x) => x.id === id);
    if (!t || t.cancel || !result.branch || !personById(ctx.people, t.owner)) continue;
    const m = ctx.newMessage(THE_OFFICE, t.owner, `The office saved your earlier work on ${t.id}, ${titled(t.title)}, on the branch ${result.branch} just before it opened again; bring back what you need from there.`);
    events.push({ type: 'message', message: m }, { type: 'task-turn', message: m.id, task: t.id });
    effects.push({ kind: 'deliver', message: m.id });
  }
  return { steps: [step(events, effects)], result: undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// Reassign

/** What the old owner did so far, from their status lines and reports on the task, for the new owner's brief. */
function soFar(ctx: SteerCtx, t: Task, from: string): string[] {
  const statuses = ctx.state.statuses.filter((s) => s.taskId === t.id && s.person === from).slice(-5).map((s) => `- ${s.text}`);
  const reports = ctx.state.reports.filter((r) => r.taskId === t.id && r.person === from).slice(-3).map((r) => `- Report (${r.outcome}): ${oneLine(r.text, 600)}`);
  const lines = [...statuses, ...reports];
  const name = called(ctx, from);
  if (lines.length === 0) return [`${capital(name)} hadn't posted anything about it yet.`];
  let text = `What ${name} did so far:\n${lines.join('\n')}`;
  if (text.length > SO_FAR) text = `${text.slice(0, SO_FAR - 1)}…`;
  return [text];
}

/** Hands a task from its owner to someone else: the old owner stops, the new one gets the brief, the note and what was done. */
export function handOverSteps(ctx: SteerCtx, by: string, t: Task, to: Person, note: string, cites: readonly string[]): Step[] {
  const from = t.owner;
  const who = by === STAKEHOLDER ? bossName(ctx) : called(ctx, by);
  const events: SteerEvent[] = [];
  const effects: SteerEffect[] = [];
  const turns = waitingTurns(ctx, t.id);
  events.push(...dropGates(ctx, turns, `${capital(called(ctx, from))} doesn't have the task any more.`));
  if (turns.length > 0) effects.push({ kind: 'take-back', messages: turns.map((m) => m.id), unsend: true });
  if (started(ctx, t) && personById(ctx.people, from)) {
    const n = notice(ctx, from, `${capital(who)} moved task ${t.id}, ${titled(t.title)}, to ${called(ctx, to.id)}${note ? `: “${note}”` : ''}. Stop work on it now; ${called(ctx, to.id)} carries on from what you did.`);
    events.push({ type: 'message', message: n.message });
    effects.push(n.effect);
  }
  events.push({ type: 'task-handover', id: t.id, handover: { at: ctx.now, by, from, to: to.id, note } });
  if (cites.length > 0) events.push({ type: 'task-cites', id: t.id, cites: [...cites] });
  // Whoever asked for it hears who has it now, unless they are part of the handover.
  const asker = t.askedBy;
  if (asker !== by && asker !== to.id && asker !== from && personById(ctx.people, asker)) {
    const message = ctx.newMessage(THE_OFFICE, asker, `${capital(who)} moved ${called(ctx, from)}'s task ${t.id}, ${titled(t.title)}, to ${called(ctx, to.id)}.`);
    events.push({ type: 'message', message });
    effects.push({ kind: 'deliver', message: message.id });
  }
  const where = t.worktree ? "The work so far is in the task's worktree, where your desk opens." : started(ctx, t) ? 'The changes so far are in those files in the checkout; carry on from them.' : '';
  const lines = [
    `Task ${t.id}, ${titled(t.title)}, is yours now: ${who} moved it to you from ${called(ctx, from)}.`,
    ...(note ? [`${capital(who)}'s note: ${note}`] : []),
    '',
    ...briefLines(t),
    '',
    ...soFar(ctx, t, from),
    ...(where ? [where] : []),
  ];
  const brief = ctx.newMessage(THE_OFFICE, to.id, lines.join('\n'));
  const moved = { ...t, owner: to.id };
  return [step(events, effects), ...handOut({ ...ctx, state: { ...ctx.state, tasks: ctx.state.tasks.map((x) => (x.id === t.id ? moved : x)) } }, moved, brief, t.worktree?.path)];
}

// ---------------------------------------------------------------------------------------------------------------
// The board's controls

/** What a reason, a note and a title may be, in characters. */
const REASON = PLAN_LIMITS.note;

/**
 * One control of the board (TaskSteer), from the office (`by` is STAKEHOLDER) or a manager's steer_task: pause or
 * resume a task with its parts, or a room's open tasks; cancel; reassign; set the order. Every change is a decision.
 */
export function steerTask(ctx: SteerCtx, by: string, input: TaskSteer): Outcome<Task[]> {
  const raw: unknown = input;
  if (typeof raw !== 'object' || raw === null || !('action' in input)) throw new OrgRefusal('invalid', 'Say what to do with the task: pause, resume, cancel, reassign or order.');
  const rawCites: unknown = input.cites;
  switch (input.action) {
    case 'pause':
    case 'resume': {
      const t = taskOf(ctx, input.task);
      const word = maySteer(ctx, by, t, rawCites);
      if (!isOpenTask(t)) throw new OrgRefusal('closed', `Task ${t.id} is ${t.status}, so there's nothing to ${input.action}.`);
      const pausing = input.action === 'pause';
      if (pausing && t.paused) throw new OrgRefusal('conflict', `Task ${t.id} is paused already.`);
      if (!pausing && !t.paused) throw new OrgRefusal('conflict', `Task ${t.id} isn't paused.`);
      // Parts go with the task: pausing the checkout stops everyone on it; a resume brings back what that pause held.
      const group = withParts(ctx.state.tasks, t).filter((x) => (pausing ? !x.paused : x.id === t.id || (x.paused?.at === t.paused?.at && x.paused?.by === t.paused?.by)));
      const cites = citesFor(ctx, by, word, rawCites);
      const s = pausing ? pauseSteps(ctx, by, group, cites) : resumeSteps(ctx, by, group, cites);
      const verb = pausing ? 'paused' : 'resumed';
      const { event } = decided(ctx, {
        by,
        kind: 'task',
        what: `${actor(ctx, by)} ${verb} ${titled(t.title)}${parts(group.length - 1)}.`,
        people: [...new Set(group.map((x) => x.owner))],
        rooms: group.map((x) => roomOf(ctx, x.owner)),
        links: { task: t.id, ...(word ? { message: word.id } : {}) },
        key: `task:${t.id}`,
      });
      const steps = [{ ...s, events: [...s.events, event] }];
      return { steps, result: resultTasks(ctx, steps, group) };
    }
    case 'pause-room':
    case 'resume-room': {
      const room = typeof input.room === 'string' ? input.room : '';
      if (!ctx.rooms.some((r) => r.id === room) && !ctx.people.some((p) => p.room === room)) throw new OrgRefusal('unknown', `There's no room ${oneLine(room, 40)} in the company.`);
      const pausing = input.action === 'pause-room';
      const inRoom = ctx.state.tasks.filter((t) => isOpenTask(t) && personById(ctx.people, t.owner)?.room === room);
      const group = inRoom.filter((t) => (pausing ? !t.paused : Boolean(t.paused)));
      const words = new Map<string, Message | null>();
      for (const t of group) words.set(t.id, maySteer(ctx, by, t, rawCites));
      if (group.length === 0) return { steps: [], result: inRoom.map(copyTask) };
      const word = [...words.values()].find((w) => w !== null) ?? null;
      const cites = citesFor(ctx, by, word, rawCites);
      const s = pausing ? pauseSteps(ctx, by, group, cites) : resumeSteps(ctx, by, group, cites);
      const { event } = decided(ctx, {
        by,
        kind: 'task',
        what: `${actor(ctx, by)} ${pausing ? 'paused' : 'resumed'} the ${roomTitle(ctx, room)} room: ${group.length} task${group.length === 1 ? '' : 's'}.`,
        people: [...new Set(group.map((x) => x.owner))],
        rooms: [room],
        links: word ? { message: word.id } : {},
      });
      const steps = [{ ...s, events: [...s.events, event] }];
      return { steps, result: resultTasks(ctx, steps, inRoom) };
    }
    case 'cancel': {
      const t = taskOf(ctx, input.task);
      const word = maySteer(ctx, by, t, rawCites);
      if (!isOpenTask(t)) throw new OrgRefusal('closed', `Task ${t.id} is ${t.status} already.`);
      if (rawLength(input.reason) > REASON) throw new OrgRefusal('invalid', `Keep the reason to ${REASON} characters.`);
      const reason = cleanBlock(input.reason, REASON);
      if (!reason) throw new OrgRefusal('invalid', 'Say why the task is cancelled, so its owner and the log know.');
      const cites = citesFor(ctx, by, word, rawCites);
      const { steps, cancelled } = cancelSteps(ctx, by, [t], reason, cites);
      const { event } = decided(ctx, {
        by,
        kind: 'task',
        what: `${actor(ctx, by)} cancelled ${titled(t.title)}${parts(cancelled.length - 1)}: ${unstopped(oneLine(reason, 200))}.`,
        why: reason,
        people: [...new Set(cancelled.flatMap((x) => [x.owner, x.askedBy]))],
        rooms: cancelled.map((x) => roomOf(ctx, x.owner)),
        links: { task: t.id, ...(word ? { message: word.id } : {}) },
        key: `task:${t.id}`,
        undo: { kind: 'reopen', key: `task:${t.id}`, tasks: cancelled.map((x) => x.id) },
      });
      const last = steps.at(-1);
      if (last) last.events.push(event);
      return { steps, result: resultTasks(ctx, steps, cancelled) };
    }
    case 'reassign': {
      const t = taskOf(ctx, input.task);
      const word = maySteer(ctx, by, t, rawCites);
      if (!isOpenTask(t)) throw new OrgRefusal('closed', `Task ${t.id} is ${t.status}, so it can't change hands.`);
      const to = member(ctx, input.to);
      if (to.id === t.owner) throw new OrgRefusal('conflict', `Task ${t.id} is ${called(ctx, to.id)}'s already.`);
      if (by !== STAKEHOLDER && !mayAssign(ctx.people, by, to.id)) {
        throw new OrgRefusal('not-allowed', `${capital(called(ctx, by))} can hand work only to people below them, and ${called(ctx, to.id)} isn't.`);
      }
      if (rawLength(input.note) > REASON) throw new OrgRefusal('invalid', `Keep the handover note to ${REASON} characters.`);
      const note = cleanBlock(input.note, REASON);
      const cites = citesFor(ctx, by, word, rawCites);
      const steps = handOverSteps(ctx, by, t, to, note, cites);
      const { event } = decided(ctx, {
        by,
        kind: 'task',
        what: `${actor(ctx, by)} handed ${titled(t.title)} from ${inLog(ctx, t.owner)} to ${inLog(ctx, to.id)}${note ? `: ${unstopped(oneLine(note, 160))}` : ''}.`,
        why: note || null,
        people: [t.owner, to.id, t.askedBy],
        rooms: [roomOf(ctx, t.owner), to.room],
        links: { task: t.id, ...(word ? { message: word.id } : {}) },
        key: `task:${t.id}`,
      });
      const first = steps[0];
      if (first) first.events.push(event);
      return { steps, result: resultTasks(ctx, steps, [t]) };
    }
    case 'order': {
      const named = Array.isArray(input.tasks) ? input.tasks : null;
      if (!named || named.length === 0 || named.some((id) => typeof id !== 'string')) throw new OrgRefusal('invalid', 'Give the tasks in their new order, by id.');
      if (named.length > MAX_ORDER) throw new OrgRefusal('invalid', `An order names up to ${MAX_ORDER} tasks.`);
      if (new Set(named).size !== named.length) throw new OrgRefusal('invalid', 'The order names a task twice; name each once.');
      const tasks = named.map((id) => taskOf(ctx, id));
      const closed = tasks.find((t) => !isOpenTask(t));
      if (closed) throw new OrgRefusal('closed', `Task ${closed.id} is ${closed.status}, so it has no place in line.`);
      let word: Message | null = null;
      for (const t of tasks) word = maySteer(ctx, by, t, rawCites) ?? word;
      const before = priorityOrder(ctx.state.tasks).map((t) => t.id);
      const order = reorder(before, named);
      const priorities = renumber(ctx.state.tasks, order);
      if (priorities.length === 0) return { steps: [], result: priorityOrder(ctx.state.tasks).map(copyTask) };
      const moved = movedInOrder(before, order);
      const one = moved.length === 1 ? tasks.find((t) => t.id === moved[0]) : undefined;
      const place = one ? order.indexOf(one.id) : -1;
      const what = one
        ? `${actor(ctx, by)} moved ${titled(one.title)} ${place === 0 ? 'to the top of the board' : place === order.length - 1 ? 'to the bottom of the board' : `${before.indexOf(one.id) > place ? 'up' : 'down'} the board: now ${placeWord(place + 1)} of ${order.length} in line`}.`
        : `${actor(ctx, by)} reordered the board: ${moved.length} tasks moved.`;
      const changed = new Set(priorities.map(([id]) => id));
      const waiting = ctx.state.messages.filter((m) => m.deliveredAt === null && changed.has(taskOfTurn({ assignments: ctx.state.assignments, steering: ctx.steering }, m.id) ?? '')).map((m) => m.id);
      const cites = citesFor(ctx, by, word, rawCites);
      const { event } = decided(ctx, {
        by,
        kind: 'task',
        what,
        people: one ? [one.owner] : [],
        rooms: one ? [roomOf(ctx, one.owner)] : [],
        links: { ...(one ? { task: one.id } : {}), ...(word ? { message: word.id } : {}) },
        key: one ? `task:${one.id}` : null,
      });
      const events: SteerEvent[] = [{ type: 'task-priority', priorities }, ...(cites.length > 0 ? tasks.map((t): SteerEvent => ({ type: 'task-cites', id: t.id, cites })) : []), event];
      const steps = [step(events, waiting.length > 0 ? [{ kind: 'redeliver', messages: waiting }] : [])];
      return { steps, result: priorityOrder(after(ctx, steps).state.tasks).map(copyTask) };
    }
    default:
      throw new OrgRefusal('invalid', 'Say what to do with the task: pause, resume, cancel, reassign or order.');
  }
}

const copyTask = (t: Task): Task => ({ ...t, files: [...t.files] });

function resultTasks(ctx: SteerCtx, steps: readonly Step[], tasks: readonly Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  return after(ctx, steps).state.tasks.filter((t) => ids.has(t.id)).map(copyTask);
}

/**
 * The task that already holds one of these files, and which file, or null: an open task, or a cancelled one whose work
 * the office is still saving (its files go back to the work branch's version when the save is done, so nobody may
 * start on them before). `except` holds tasks that don't count.
 */
export function fileHolder(
  ctx: Pick<SteerCtx, 'state' | 'steering'>,
  files: readonly string[],
  except: ReadonlySet<string> = new Set(),
): { file: string; task: Task; saving: boolean } | null {
  const saving = new Set(Object.values(ctx.steering.saving).flatMap((s) => s.covers));
  for (const other of ctx.state.tasks) {
    if ((!isOpenTask(other) && !saving.has(other.id)) || except.has(other.id)) continue;
    for (const mine of files) {
      const theirs = other.files.find((f) => pathsOverlap(f, mine));
      if (theirs !== undefined) return { file: theirs.length > mine.length ? `${theirs} (in ${mine})` : mine, task: other, saving: !isOpenTask(other) };
    }
  }
  return null;
}

/** Their head, else their nearest manager: who hears of a task the stakeholder gives someone. Nobody for the CEO. */
export function headOf(people: readonly Person[], owner: string): Person | undefined {
  const chain = chainUp(people, owner);
  return chain.find((p) => p.level === 'head') ?? chain[0];
}

/**
 * A task the stakeholder creates on the board (or the CEO creates on their word): it goes on the board at the end of
 * the line, reaches its owner in priority order, and their head is told. The stakeholder reviews it.
 */
export function createTask(ctx: SteerCtx, by: string, input: NewTaskInput & { cites: string[] }): Outcome<Task> {
  let word: Message | null = null;
  if (by !== STAKEHOLDER) {
    const p = member(ctx, by);
    if (p.level !== 'ceo') throw new OrgRefusal('not-allowed', `Only ${bossName(ctx)} puts tasks on the board directly; ${called(ctx, by)} gives work with assign.`);
    word = stakeholderWord(ctx, by, input.cites, 0, 'a new task');
  }
  const owner = member(ctx, input.owner);
  if (rawLength(input.title) > LIMITS.title) throw new OrgRefusal('invalid', `Keep the title to ${LIMITS.title} characters.`);
  const title = cleanLine(input.title, LIMITS.title);
  if (!title) throw new OrgRefusal('invalid', 'Give the task a title.');
  if (rawLength(input.brief) > LIMITS.brief) throw new OrgRefusal('invalid', `Keep the brief to ${LIMITS.brief.toLocaleString('en-US')} characters.`);
  const brief = cleanBlock(input.brief, LIMITS.brief);
  if (rawLength(input.doneWhen) > LIMITS.doneWhen) throw new OrgRefusal('invalid', `Keep what marks it done to ${LIMITS.doneWhen.toLocaleString('en-US')} characters.`);
  const doneWhen = cleanBlock(input.doneWhen, LIMITS.doneWhen);
  if (!doneWhen) throw new OrgRefusal('invalid', "Say when it's done, so they know when to stop.");
  const files = checkTaskFiles(Array.isArray(input.files) ? input.files : []);
  if (!files.ok) throw new OrgRefusal('invalid', files.error);
  const milestone = input.milestone === null || input.milestone === undefined ? null : ctx.state.goal?.milestones.find((m) => m.id === input.milestone);
  if (milestone === undefined) throw new OrgRefusal('unknown', `The goal has no milestone ${oneLine(String(input.milestone), 40)}.`);
  const holder = fileHolder(ctx, files.files);
  if (holder?.saving) throw new OrgRefusal('busy', `${holder.file} is being saved from the cancelled task ${titled(holder.task.title)}; try again in a moment.`);
  if (holder) throw new OrgRefusal('conflict', `${holder.file} already belongs to ${called(ctx, holder.task.owner)}'s task ${titled(holder.task.title)}; pick other files, or wait until it's done.`);
  const at = ctx.now;
  const task: Task = {
    id: ctx.newId('task'),
    title,
    brief,
    owner: owner.id,
    askedBy: STAKEHOLDER,
    files: files.files,
    doneWhen,
    status: 'queued',
    outcome: null,
    parent: null,
    milestone: milestone?.id ?? null,
    worktree: null,
    commit: null,
    createdAt: at,
    updatedAt: at,
    priority: nextPriority(ctx.state.tasks),
    paused: null,
    cancel: null,
    handovers: [],
    planTask: null,
    cites: word ? [word.id] : [],
  };
  // The owner's brief is the office's line even when you made the task: your own words are never put in your mouth.
  const from = THE_OFFICE;
  const head = headOf(ctx.people, owner.id);
  const assignment = ctx.newMessage(
    from,
    owner.id,
    [`New task ${task.id}, from ${bossName(ctx)}: ${task.title}`, '', ...briefLines(task), ...(milestone ? [`Milestone: ${milestone.title}.`] : []), `Report to ${bossName(ctx)} when it's done.`].join('\n'),
  );
  const events: SteerEvent[] = [{ type: 'task', task, messageId: assignment.id }, { type: 'message', message: assignment }];
  const effects: SteerEffect[] = [];
  if (head && head.id !== by) {
    const told = ctx.newMessage(
      THE_OFFICE,
      head.id,
      `${capital(bossName(ctx))} gave ${called(ctx, owner.id)} a task of their own: ${task.id}, ${titled(task.title)}${task.files.length > 0 ? ` (files: ${task.files.join(', ')})` : ''}. It reaches them in priority order; nothing for you to do unless it clashes with their other work.`,
    );
    events.push({ type: 'message', message: told });
    effects.push({ kind: 'deliver', message: told.id });
  }
  const { event } = decided(ctx, {
    by,
    kind: 'task',
    what: `${actor(ctx, by)} added ${titled(task.title)} for ${inLog(ctx, owner.id)}${word ? ', as you asked' : ''}.`,
    people: [owner.id, head?.id],
    rooms: [owner.room],
    links: { task: task.id, ...(word ? { message: word.id } : {}) },
    key: `task:${task.id}`,
  });
  events.push(event);
  const gate = gateFor(ctx, task, assignment.id);
  if (!gate) effects.push({ kind: 'deliver', message: assignment.id });
  const steps = [step(events, effects), ...(gate ? [gate] : [])];
  return { steps, result: copyTask(after(ctx, steps).state.tasks.find((t) => t.id === task.id) ?? task) };
}

/** Steps that cancel tasks again for the undo of a reopen, through the same path as the board's cancel. */
export function cancelAgain(ctx: SteerCtx, taskIds: readonly string[], reason: string): Step[] {
  const roots = taskIds.map((id) => ctx.state.tasks.find((t) => t.id === id)).filter((t): t is Task => t !== undefined && isOpenTask(t));
  return roots.length === 0 ? [] : cancelSteps(ctx, STAKEHOLDER, roots, reason, []).steps;
}
