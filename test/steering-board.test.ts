// The task board (src/company/board.ts): the order work is handed out in, pause and resume, cancel with the work kept
// on a branch, reassign with a handover, a task the stakeholder creates, and who may steer what.
import { describe, expect, it } from 'vitest';
import {
  cancelSteps,
  createTask,
  nextPriority,
  priorityFor,
  priorityOrder,
  reopenSteps,
  reorder,
  saved,
  saveJob,
  savesDue,
  steerTask,
  turnPriority,
} from '../src/company/board.ts';
import { applyEvents } from '../src/company/decisions.ts';
import type { Task } from '../src/core/company.ts';
import type { NewTaskInput, TaskSteer } from '../src/core/steering.ts';
import { normalizePlanPath } from '../src/core/plan.ts';
import { heldTurn } from '../src/core/steering-state.ts';
import { refusal, Sim, STAKEHOLDER, THE_OFFICE } from './steering-core-kit.ts';

const input = (title: string, owner: string, extra: Partial<NewTaskInput & { cites: string[] }> = {}): NewTaskInput & { cites: string[] } => ({
  title, brief: `${title}, please.`, files: [], owner, doneWhen: `${title} is done.`, milestone: null, cites: [], ...extra,
});

/** The stakeholder's own task on the board, delivered to its owner unless `land` is false. */
function give(sim: Sim, title: string, owner: string, extra: Partial<NewTaskInput> = {}, land = true): Task {
  const t = sim.run((c) => createTask(c, STAKEHOLDER, input(title, owner, extra)));
  if (land) sim.land();
  return sim.task(t.id);
}

/**
 * A task a manager assigned, as the company's assign makes it (its files written as checkTaskFiles writes them), handed
 * to the switchboard and not delivered yet.
 */
function assigned(sim: Sim, fields: Partial<Task> & Pick<Task, 'title' | 'owner'>): Task {
  const task: Task = {
    id: sim.newId('task'), brief: 'Do it.', askedBy: 'frontend-lead', files: [], doneWhen: 'Done.', status: 'queued', outcome: null, parent: null, milestone: null,
    worktree: null, commit: null, createdAt: sim.now, updatedAt: sim.now, priority: nextPriority(sim.state.tasks), ...fields,
  };
  task.files = task.files.map(normalizePlanPath);
  const m = sim.newMessage(task.askedBy, task.owner, `New task ${task.id}: ${task.title}`);
  sim.world = applyEvents(sim.world, [{ type: 'task', task, messageId: m.id }, { type: 'message', message: m }]);
  sim.handed.push(m.id);
  return sim.task(task.id);
}

const steer = (sim: Sim, by: string, s: TaskSteer) => sim.run((c) => steerTask(c, by, s));
const host = (sim: Sim) => ({ tasks: sim.state.tasks, assignments: sim.state.assignments, steering: sim.steering });

describe('the order work is handed out in', () => {
  it('sorts open tasks by priority, then by when they were asked for', () => {
    const sim = new Sim();
    const a = give(sim, 'A', 'ui-designer');
    sim.tick();
    const b = give(sim, 'B', 'ux-designer');
    sim.world = applyEvents(sim.world, [{ type: 'task-priority', priorities: [[b.id, 1], [a.id, 2]] }]);
    expect(priorityOrder(sim.state.tasks).map((t) => t.title)).toEqual(['B', 'A']);
    sim.done(b.id);
    expect(priorityOrder(sim.state.tasks).map((t) => t.title)).toEqual(['A']);
  });

  it('puts a new task at the end of the line, and a part where its task is', () => {
    const sim = new Sim();
    const a = give(sim, 'A', 'ui-designer');
    give(sim, 'B', 'ux-designer');
    expect(nextPriority(sim.state.tasks)).toBe(3);
    expect(priorityFor(sim.state.tasks, a.id)).toBe(1);
    expect(priorityFor(sim.state.tasks, null)).toBe(3);
  });

  it('moves only the tasks an order names, within the places they hold', () => {
    expect(reorder(['a', 'b', 'c', 'd'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b']);
    expect(reorder(['a', 'b'], ['b', 'a', 'gone'])).toEqual(['b', 'a']);
  });

  it('renumbers the board, records the move and hands waiting turns out again in the new order', () => {
    const sim = new Sim();
    const a = give(sim, 'Menu data', 'frontend-engineer');
    const b = give(sim, 'Slot picker', 'ui-designer');
    const c = give(sim, 'Order API', 'backend-engineer', {}, false);
    const result = steer(sim, STAKEHOLDER, { action: 'order', tasks: [c.id, a.id, b.id], cites: [] });
    expect(result.map((t) => [t.title, t.priority])).toEqual([['Order API', 1], ['Menu data', 2], ['Slot picker', 3]]);
    expect(sim.lastDecision()).toMatchObject({ kind: 'task', what: 'You moved “Order API” to the top of the board.', links: { task: c.id } });
    expect(sim.effects.at(-1)).toEqual({ kind: 'redeliver', messages: [sim.assignmentOf(c.id)?.id] });
    expect(turnPriority(sim.world, sim.assignmentOf(c.id)?.id ?? '')).toBe(1);
  });

  it("says where a task moved when it isn't to the top or bottom", () => {
    const sim = new Sim();
    const ids = ['A', 'B', 'C', 'D'].map((t) => give(sim, t, 'ui-designer').id);
    steer(sim, STAKEHOLDER, { action: 'order', tasks: [ids[0], ids[3], ids[1], ids[2]].filter((x): x is string => x !== undefined), cites: [] });
    expect(sim.lastDecision().what).toBe('You moved “D” up the board: now second of 4 in line.');
  });

  it('refuses an order that names a task twice, a closed task or an unknown one', () => {
    const sim = new Sim();
    const a = give(sim, 'A', 'ui-designer');
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'order', tasks: [a.id, a.id], cites: [] })).message).toBe('The order names a task twice; name each once.');
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'order', tasks: ['t-404'], cites: [] })).code).toBe('unknown');
    sim.done(a.id);
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'order', tasks: [a.id], cites: [] })).message).toBe(`Task ${a.id} is done, so it has no place in line.`);
  });

  it("lets a manager order their own team's tasks and nobody else's", () => {
    const sim = new Sim();
    const mine = assigned(sim, { title: 'Icons', owner: 'ui-designer', askedBy: 'head-of-design' });
    const theirs = assigned(sim, { title: 'Menu data', owner: 'frontend-engineer' });
    const also = assigned(sim, { title: 'Flows', owner: 'ux-designer', askedBy: 'head-of-design' });
    expect(steer(sim, 'head-of-design', { action: 'order', tasks: [also.id, mine.id], cites: [] }).map((t) => t.title)).toEqual(['Flows', 'Menu data', 'Icons']);
    expect(refusal(() => steer(sim, 'head-of-design', { action: 'order', tasks: [theirs.id, mine.id], cites: [] })).code).toBe('not-allowed');
  });

  it("takes the stakeholder's word for a manager to move the stakeholder's own task", () => {
    const sim = new Sim();
    const yours = give(sim, 'Brand colours', 'ui-designer');
    const mine = assigned(sim, { title: 'Icons', owner: 'ui-designer', askedBy: 'head-of-design' });
    expect(refusal(() => steer(sim, 'head-of-design', { action: 'order', tasks: [mine.id, yours.id], cites: [] })).code).toBe('not-allowed');
    sim.tick();
    const word = sim.say('head-of-design', 'Icons come first.');
    expect(steer(sim, 'head-of-design', { action: 'order', tasks: [mine.id, yours.id], cites: [word.id] }).map((t) => t.title)).toEqual(['Icons', 'Brand colours']);
  });
});

describe('pause and resume', () => {
  it('stops an owner at work with "stop and wait", and holds the task', () => {
    const sim = new Sim();
    const t = give(sim, 'Write the DE copy', 'german-copywriter');
    sim.desks['german-copywriter'] = 'working';
    const [paused] = steer(sim, STAKEHOLDER, { action: 'pause', task: t.id, cites: [] });
    expect(paused?.paused).toEqual({ at: sim.now, by: STAKEHOLDER });
    const stop = sim.message(sim.stops.at(-1) ?? '');
    expect(stop).toMatchObject({ from: THE_OFFICE, to: 'german-copywriter', interrupt: true, text: `Robin paused task ${t.id}, “Write the DE copy”. Stop work on it now and wait: you'll hear when it resumes.` });
    expect(sim.lastDecision()).toMatchObject({ kind: 'task', what: 'You paused “Write the DE copy”.', reversible: false, links: { task: t.id } });
  });

  it('tells an owner who started the task but is not at work as a plain turn', () => {
    const sim = new Sim();
    const t = give(sim, 'Icons', 'ui-designer');
    steer(sim, STAKEHOLDER, { action: 'pause', task: t.id, cites: [] });
    expect(sim.lastTo('ui-designer')).toMatchObject({ interrupt: false });
    expect(sim.effects.some((e) => e.kind === 'deliver' && e.message === sim.lastTo('ui-designer').id)).toBe(true);
  });

  it("holds a task's turn that hasn't gone out, and hands it out on resume", () => {
    const sim = new Sim();
    const t = give(sim, 'Icons', 'ui-designer', {}, false);
    const turn = sim.assignmentOf(t.id)?.id ?? '';
    steer(sim, STAKEHOLDER, { action: 'pause', task: t.id, cites: [] });
    expect(sim.handed).not.toContain(turn);
    expect(heldTurn(host(sim), turn)).toBe('paused');
    expect(sim.messagesTo('ui-designer')).toHaveLength(1);
    steer(sim, STAKEHOLDER, { action: 'resume', task: t.id, cites: [] });
    expect(heldTurn(host(sim), turn)).toBeNull();
    expect(sim.handed).toContain(turn);
    expect(sim.lastDecision().what).toBe('You resumed “Icons”.');
  });

  it('tells an owner to carry on when nothing of the task was waiting', () => {
    const sim = new Sim();
    const t = give(sim, 'Icons', 'ui-designer');
    steer(sim, STAKEHOLDER, { action: 'pause', task: t.id, cites: [] });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'resume', task: t.id, cites: [] });
    expect(sim.lastTo('ui-designer').text).toBe(`Robin resumed task ${t.id}, “Icons”: carry on where you stopped.`);
  });

  it('pauses the parts with the task, and resumes only what that pause held', () => {
    const sim = new Sim();
    const parent = give(sim, 'Checkout', 'frontend-lead', { files: ['src/checkout/'] });
    const part = assigned(sim, { title: 'Pay button', owner: 'frontend-engineer', parent: parent.id, files: ['src/checkout/Pay.tsx'] });
    const own = assigned(sim, { title: 'Receipt', owner: 'backend-engineer', parent: parent.id });
    steer(sim, STAKEHOLDER, { action: 'pause', task: own.id, cites: [] });
    sim.tick();
    const paused = steer(sim, STAKEHOLDER, { action: 'pause', task: parent.id, cites: [] });
    expect(paused.map((t) => t.id)).toEqual([parent.id, part.id]);
    expect(sim.lastDecision().what).toBe('You paused “Checkout” and its part.');
    const resumed = steer(sim, STAKEHOLDER, { action: 'resume', task: parent.id, cites: [] });
    expect(resumed.map((t) => t.id)).toEqual([parent.id, part.id]);
    expect(sim.task(own.id).paused).not.toBeNull();
  });

  it('refuses to pause what is paused, resume what is not, or touch a closed task', () => {
    const sim = new Sim();
    const t = give(sim, 'Icons', 'ui-designer');
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'resume', task: t.id, cites: [] })).message).toBe(`Task ${t.id} isn't paused.`);
    steer(sim, STAKEHOLDER, { action: 'pause', task: t.id, cites: [] });
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'pause', task: t.id, cites: [] })).message).toBe(`Task ${t.id} is paused already.`);
    sim.done(t.id);
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'resume', task: t.id, cites: [] })).code).toBe('closed');
  });

  it("pauses and resumes a room's open tasks together", () => {
    const sim = new Sim();
    const a = give(sim, 'Icons', 'ui-designer');
    const b = give(sim, 'Flows', 'ux-designer', {}, false);
    const other = give(sim, 'Menu data', 'frontend-engineer');
    const paused = steer(sim, STAKEHOLDER, { action: 'pause-room', room: 'design', cites: [] });
    expect(paused.map((t) => [t.id, Boolean(t.paused)])).toEqual([[a.id, true], [b.id, true]]);
    expect(sim.task(other.id).paused ?? null).toBeNull();
    expect(sim.lastDecision()).toMatchObject({ what: 'You paused the Design room: 2 tasks.', rooms: ['design'] });
    const resumed = steer(sim, STAKEHOLDER, { action: 'resume-room', room: 'design', cites: [] });
    expect(resumed.every((t) => t.paused === null)).toBe(true);
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'pause-room', room: 'kitchen', cites: [] })).message).toBe("There's no room kitchen in the company.");
  });
});

describe('who may steer a task', () => {
  it('refuses a worker, and a manager outside the owner\'s team', () => {
    const sim = new Sim();
    const t = give(sim, 'Menu data', 'frontend-engineer');
    expect(refusal(() => steer(sim, 'ui-designer', { action: 'pause', task: t.id, cites: [] })).message).toBe("Kai can't steer tasks; ask Ada, who can.");
    expect(refusal(() => steer(sim, 'head-of-design', { action: 'pause', task: t.id, cites: [] })).message).toBe(`Task ${t.id} is Sam's, who isn't in Ada's team; ask Ola to steer it.`);
  });

  it("lets a manager steer their team's work", () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Pay button', owner: 'frontend-engineer' });
    expect(steer(sim, 'frontend-lead', { action: 'pause', task: t.id, cites: [] })[0]?.paused?.by).toBe('frontend-lead');
    expect(sim.lastDecision().what).toBe('Ola paused “Pay button”.');
  });

  it("takes the stakeholder's word, cited, to steer a task the stakeholder asked for", () => {
    const sim = new Sim();
    const t = give(sim, 'Menu data', 'frontend-engineer');
    expect(refusal(() => steer(sim, 'ceo', { action: 'pause', task: t.id, cites: [] })).message).toBe(
      `The CEO acts for Robin only on Robin's word: cite the message where Robin asked for this (task ${t.id}, which Robin asked for).`,
    );
    sim.tick();
    const word = sim.say('ceo', 'Pause the menu data until Monday.');
    steer(sim, 'ceo', { action: 'pause', task: t.id, cites: [word.id] });
    expect(sim.task(t.id).cites).toEqual([word.id]);
    expect(sim.lastDecision()).toMatchObject({ by: 'ceo', what: 'The CEO paused “Menu data”.', links: { task: t.id, message: word.id } });
    // The same word can't steer it again: the task changed since.
    sim.tick();
    expect(refusal(() => steer(sim, 'ceo', { action: 'resume', task: t.id, cites: [word.id] })).message).toMatch(/is older than the last change to task/);
  });
});

describe('cancel', () => {
  it('drops the task with the reason, stops its owner and saves the work once they heard', () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    sim.land();
    sim.desks['frontend-engineer'] = 'working';
    const [cancelled] = steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'TWINT covers mobile payments here.', cites: [] });
    expect(cancelled).toMatchObject({ status: 'dropped', outcome: 'Cancelled: TWINT covers mobile payments here.', cancel: { by: STAKEHOLDER, reason: 'TWINT covers mobile payments here.', branch: null } });
    const stop = sim.message(sim.stops.at(-1) ?? '');
    expect(stop.text).toBe(`Robin cancelled task ${t.id}, “Apple Pay”: TWINT covers mobile payments here. Stop work on it now and leave its files as they are: the office keeps what you changed on a branch.`);
    expect(sim.lastTo('frontend-lead').text).toBe(`Robin cancelled task ${t.id}, “Apple Pay”: TWINT covers mobile payments here. Nothing more comes of it.`);
    expect(sim.steering.saving[t.id]).toEqual({ after: [stop.id], covers: [t.id] });
    expect(sim.lastDecision()).toMatchObject({ what: 'You cancelled “Apple Pay”: TWINT covers mobile payments here.', reversible: true });
    expect(sim.steering.undos[sim.lastDecision().id]).toEqual({ kind: 'reopen', key: `task:${t.id}`, tasks: [t.id] });
    expect(savesDue(sim.ctx())).toEqual([]);
    sim.land();
    expect(savesDue(sim.ctx())).toEqual([t.id]);
    expect(saveJob(sim.ctx(), t.id)).toMatchObject({ kind: 'checkout', files: ['src/pay'], message: expect.stringMatching(/^Unfinished: Apple Pay\n\nSaved when Robin cancelled it: TWINT/) });
    sim.run((c) => saved(c, t.id, { branch: `worklings/cafe--${t.id}`, problem: null }));
    expect(sim.task(t.id).cancel?.branch).toBe(`worklings/cafe--${t.id}`);
    expect(sim.steering.saving).toEqual({});
  });

  it('keeps the files of work being saved from anyone else until the save is done', () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Not now.', cites: [] });
    expect(refusal(() => sim.run((c) => createTask(c, STAKEHOLDER, input('Pay again', 'backend-engineer', { files: ['src/pay/Button.tsx'] })))).code).toBe('busy');
  });

  it('cancels the parts with the task, saving them together', () => {
    const sim = new Sim();
    const parent = give(sim, 'Checkout', 'frontend-lead', { files: ['src/checkout/'] });
    const part = assigned(sim, { title: 'Pay button', owner: 'frontend-engineer', parent: parent.id, files: ['src/checkout/Pay.tsx'] });
    sim.land();
    const cancelled = steer(sim, STAKEHOLDER, { action: 'cancel', task: parent.id, reason: 'Pickup only.', cites: [] });
    expect(cancelled.map((t) => t.id)).toEqual([parent.id, part.id]);
    expect(sim.steering.saving[parent.id]?.covers).toEqual([parent.id, part.id]);
    expect(sim.lastDecision().what).toBe('You cancelled “Checkout” and its part: Pickup only.');
  });

  it("takes back a task that never reached its owner, with nothing to save", () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    const turn = sim.assignmentOf(t.id)?.id ?? '';
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Not now.', cites: [] });
    expect(sim.state.messages.some((m) => m.id === turn)).toBe(false);
    expect(sim.steering.saving).toEqual({});
    expect(sim.messagesTo('frontend-engineer')).toEqual([]);
  });

  it("says so when the project isn't a git repository, and saves nothing", () => {
    const sim = new Sim({ branch: null });
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Not now.', cites: [] });
    expect(sim.lastTo('frontend-engineer').text).toContain("the project isn't a git repository, so what you changed stays as it is.");
    expect(sim.steering.saving).toEqual({});
  });

  it("keeps a worktree's branch and retires the worktree once saved", () => {
    const sim = new Sim();
    const worktree = { path: '/worktrees/cafe/t-1', branch: 'worklings/cafe--t-1' };
    const t = assigned(sim, { title: 'Big refactor', owner: 'frontend-engineer', files: ['src/'], worktree });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Too risky now.', cites: [] });
    expect(sim.task(t.id).cancel?.branch).toBe(worktree.branch);
    expect(sim.lastTo('frontend-engineer').text).toContain('the work stays on its branch.');
    sim.land();
    expect(saveJob(sim.ctx(), t.id)).toMatchObject({ kind: 'worktree', worktree });
    sim.run((c) => saved(c, t.id, { branch: worktree.branch, problem: null }));
    expect(sim.state.retiring[t.id]).toEqual({ person: 'frontend-engineer', worktree });
  });

  it('tells the stakeholder when the work could not be saved', () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Not now.', cites: [] });
    sim.run((c) => saved(c, t.id, { branch: null, problem: 'Git has no name and email for you.' }));
    expect(sim.lastTo(STAKEHOLDER).text).toBe("The office couldn't keep the work of “Apple Pay” on a branch: Git has no name and email for you. Its files stay as Sam left them.");
    expect(sim.state.retiring).toEqual({});
  });

  it('needs a reason, kept to a thousand characters', () => {
    const sim = new Sim();
    const t = give(sim, 'Icons', 'ui-designer');
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: ' ', cites: [] })).message).toBe('Say why the task is cancelled, so its owner and the log know.');
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'x'.repeat(1001), cites: [] })).message).toBe('Keep the reason to 1000 characters.');
  });
});

describe('opening a cancelled task again', () => {
  it('puts it back in line and names the branch its earlier work is on', () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Not now.', cites: [] });
    sim.land();
    sim.run((c) => saved(c, t.id, { branch: 'worklings/cafe--t-1', problem: null }));
    sim.apply(reopenSteps(sim.ctx(), [t.id]));
    expect(sim.task(t.id)).toMatchObject({ status: 'queued', cancel: null });
    const back = sim.lastTo('frontend-engineer');
    expect(back.text).toMatch(/^Task t-1, “Apple Pay”, is open again: Robin undid its cancel\. Your earlier work on it is on the branch worklings\/cafe--t-1; bring back what you need from there/);
    expect(sim.handed).toContain(back.id);
  });

  it('drops a save still waiting, since the files stay where they are', () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Not now.', cites: [] });
    sim.apply(reopenSteps(sim.ctx(), [t.id]));
    expect(sim.steering.saving).toEqual({});
  });

  it("brings a worktree back before the task's turn goes out there", () => {
    const sim = new Sim();
    const worktree = { path: '/worktrees/cafe/t-1', branch: 'worklings/cafe--t-1' };
    const t = assigned(sim, { title: 'Refactor', owner: 'frontend-engineer', files: ['src/'], worktree });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Later.', cites: [] });
    sim.apply(reopenSteps(sim.ctx(), [t.id]));
    expect(sim.effects.at(-1)).toEqual({ kind: 'reopen-worktree', task: t.id, message: sim.lastTo('frontend-engineer').id });
  });

  it('tells the owner where the work went when the save ended after it opened again', () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Apple Pay', owner: 'frontend-engineer', files: ['src/pay/'] });
    sim.land();
    steer(sim, STAKEHOLDER, { action: 'cancel', task: t.id, reason: 'Not now.', cites: [] });
    const saving = sim.steering.saving[t.id];
    sim.apply(reopenSteps(sim.ctx(), [t.id]));
    if (saving) sim.world = applyEvents(sim.world, [{ type: 'saving', task: t.id, saving }]);
    sim.run((c) => saved(c, t.id, { branch: 'worklings/cafe--t-1', problem: null }));
    expect(sim.lastTo('frontend-engineer').text).toContain('on the branch worklings/cafe--t-1 just before it opened again');
  });
});

describe('reassign', () => {
  it("stops the old owner and gives the new one the brief, the note and what was done so far", () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Order API', owner: 'frontend-engineer', files: ['api/orders/'], brief: 'Save pickup orders.' });
    sim.land();
    sim.world = applyEvents(sim.world, [
      { type: 'status', status: { person: 'frontend-engineer', text: 'Writing the order table.', taskId: t.id, at: sim.now } },
      { type: 'report', report: { id: 'r-1', person: 'frontend-engineer', to: 'frontend-lead', taskId: t.id, outcome: 'progress', text: 'The table is in; the endpoint is next.', at: sim.now } },
    ]);
    sim.desks['frontend-engineer'] = 'working';
    const [moved] = steer(sim, STAKEHOLDER, { action: 'reassign', task: t.id, to: 'backend-engineer', note: 'Noah knows the database.', cites: [] });
    expect(moved).toMatchObject({ owner: 'backend-engineer', handovers: [{ by: STAKEHOLDER, from: 'frontend-engineer', to: 'backend-engineer', note: 'Noah knows the database.' }] });
    expect(sim.message(sim.stops.at(-1) ?? '').text).toBe(`Robin moved task ${t.id}, “Order API”, to Noah: “Noah knows the database.”. Stop work on it now; Noah carries on from what you did.`);
    const brief = sim.lastTo('backend-engineer').text;
    expect(brief).toContain(`Task ${t.id}, “Order API”, is yours now: Robin moved it to you from Sam.`);
    expect(brief).toContain("Robin's note: Noah knows the database.");
    expect(brief).toContain('Save pickup orders.');
    expect(brief).toContain('What Sam did so far:\n- Writing the order table.\n- Report (progress): The table is in; the endpoint is next.');
    expect(sim.lastDecision()).toMatchObject({ what: 'You handed “Order API” from Sam to Noah: Noah knows the database.', people: [STAKEHOLDER, 'frontend-engineer', 'backend-engineer', 'frontend-lead'] });
    expect(Object.entries(sim.state.assignments).some(([m, task]) => task === t.id && sim.message(m).to === 'backend-engineer')).toBe(true);
  });

  it("takes back a task that hadn't reached its old owner", () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Order API', owner: 'frontend-engineer' });
    const turn = sim.assignmentOf(t.id)?.id ?? '';
    steer(sim, STAKEHOLDER, { action: 'reassign', task: t.id, to: 'backend-engineer', note: '', cites: [] });
    expect(sim.state.messages.some((m) => m.id === turn)).toBe(false);
    expect(sim.messagesTo('frontend-engineer')).toEqual([]);
    expect(sim.lastTo('backend-engineer').text).toContain("Sam hadn't posted anything about it yet.");
  });

  it('refuses the same owner, someone unknown, and a manager handing work outside their team', () => {
    const sim = new Sim();
    const t = assigned(sim, { title: 'Order API', owner: 'frontend-engineer' });
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'reassign', task: t.id, to: 'frontend-engineer', note: '', cites: [] })).message).toBe(`Task ${t.id} is Sam's already.`);
    expect(refusal(() => steer(sim, STAKEHOLDER, { action: 'reassign', task: t.id, to: 'nobody', note: '', cites: [] })).code).toBe('unknown');
    expect(refusal(() => steer(sim, 'frontend-lead', { action: 'reassign', task: t.id, to: 'ui-designer', note: '', cites: [] })).message).toBe(
      "Ola can hand work only to people below them, and Kai isn't.",
    );
  });

  it('holds the handover for a new owner who checks with the stakeholder', () => {
    const sim = new Sim();
    sim.world = applyEvents(sim.world, [{ type: 'steering-settings', settings: { ...sim.steering.settings, leash: { people: { 'german-copywriter': 'check' }, rooms: {} } } }]);
    const t = assigned(sim, { title: 'Menu words', owner: 'frontend-engineer' });
    steer(sim, STAKEHOLDER, { action: 'reassign', task: t.id, to: 'german-copywriter', note: '', cites: [] });
    const q = sim.state.questions.at(-1);
    expect(q).toMatchObject({ from: THE_OFFICE, gate: { task: t.id }, text: `Lena would like to start “Menu words”. Start it, or hold it until you resume it?`, options: ['Start it', 'Not now'] });
    expect(sim.waiting('german-copywriter')).toEqual([]);
  });
});

describe('a task the stakeholder creates', () => {
  it('goes at the end of the line, reaches its owner and is told to their head', () => {
    const sim = new Sim();
    give(sim, 'Menu data', 'frontend-engineer');
    const t = sim.run((c) => createTask(c, STAKEHOLDER, input('Fix the footer', 'ui-designer', { files: ['src/Footer.tsx'] })));
    expect(t).toMatchObject({ askedBy: STAKEHOLDER, owner: 'ui-designer', priority: 2, status: 'queued', planTask: null, files: ['src/Footer.tsx'] });
    const assignment = sim.assignmentOf(t.id);
    // Your own task reaches its owner as the office's line, never as words put in your mouth.
    expect(assignment).toMatchObject({ from: THE_OFFICE, to: 'ui-designer' });
    expect(sim.handed).toContain(assignment?.id);
    expect(sim.lastTo('head-of-design').text).toBe(
      `Robin gave Kai a task of their own: ${t.id}, “Fix the footer” (files: src/Footer.tsx). It reaches them in priority order; nothing for you to do unless it clashes with their other work.`,
    );
    expect(sim.lastDecision()).toMatchObject({ kind: 'task', what: 'You added “Fix the footer” for Kai.', people: [STAKEHOLDER, 'ui-designer', 'head-of-design'], rooms: ['design'] });
  });

  it("tells the CEO of a head's own task", () => {
    const sim = new Sim();
    give(sim, 'Brand book', 'head-of-design');
    expect(sim.lastTo('ceo').text).toMatch(/^Robin gave Ada a task of their own/);
  });

  it("is the CEO's to make only on the stakeholder's word, and never a worker's", () => {
    const sim = new Sim();
    expect(refusal(() => sim.run((c) => createTask(c, 'ceo', input('Fix the footer', 'ui-designer')))).code).toBe('not-allowed');
    expect(refusal(() => sim.run((c) => createTask(c, 'ui-designer', input('Fix the footer', 'ui-designer')))).message).toBe('Only Robin puts tasks on the board directly; Kai gives work with assign.');
    const word = sim.say('ceo', 'Give Kai the footer fix.');
    const t = sim.run((c) => createTask(c, 'ceo', input('Fix the footer', 'ui-designer', { cites: [word.id] })));
    expect(t.cites).toEqual([word.id]);
    expect(sim.assignmentOf(t.id)?.from).toBe(THE_OFFICE);
    expect(sim.lastDecision().what).toBe('The CEO added “Fix the footer” for Kai, as you asked.');
  });

  it("refuses files an open task holds, a milestone the goal lacks and missing words", () => {
    const sim = new Sim();
    give(sim, 'Menu data', 'frontend-engineer', { files: ['src/menu/'] });
    expect(refusal(() => sim.run((c) => createTask(c, STAKEHOLDER, input('Menu card', 'ui-designer', { files: ['src/menu/Card.tsx'] })))).message).toBe(
      'src/menu/Card.tsx already belongs to Sam\'s task “Menu data”; pick other files, or wait until it\'s done.',
    );
    expect(refusal(() => sim.run((c) => createTask(c, STAKEHOLDER, input('X', 'ui-designer', { milestone: 'ms-9' })))).message).toBe('The goal has no milestone ms-9.');
    expect(refusal(() => sim.run((c) => createTask(c, STAKEHOLDER, input('', 'ui-designer')))).message).toBe('Give the task a title.');
    expect(refusal(() => sim.run((c) => createTask(c, STAKEHOLDER, input('X', 'ui-designer', { doneWhen: '' })))).message).toBe("Say when it's done, so they know when to stop.");
    expect(refusal(() => sim.run((c) => createTask(c, STAKEHOLDER, input('X', 'ui-designer', { files: ['../x'] })))).code).toBe('invalid');
  });

  it('waits for the stakeholder\'s start when the owner checks with them first', () => {
    const sim = new Sim();
    sim.world = applyEvents(sim.world, [{ type: 'steering-settings', settings: { ...sim.steering.settings, leash: { people: {}, rooms: { content: 'check' } } } }]);
    const t = sim.run((c) => createTask(c, STAKEHOLDER, input('Write the DE copy', 'german-copywriter')));
    const turn = sim.assignmentOf(t.id)?.id ?? '';
    expect(heldTurn(host(sim), turn)).toBe('gate');
    expect(sim.handed).not.toContain(turn);
  });
});

describe('cancel steps on their own', () => {
  it('cancel nothing twice when roots overlap', () => {
    const sim = new Sim();
    const parent = give(sim, 'Checkout', 'frontend-lead', { files: ['src/checkout/'] });
    const part = assigned(sim, { title: 'Pay', owner: 'frontend-engineer', parent: parent.id, files: ['src/checkout/Pay.tsx'] });
    const { cancelled } = cancelSteps(sim.ctx(), STAKEHOLDER, [parent, part], 'Gone.', []);
    expect(cancelled.map((t) => t.id)).toEqual([parent.id, part.id]);
  });
});
