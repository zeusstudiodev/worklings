// v0.2, "verify by a model once": one independent review at the end, in a fresh desk, against the stakeholder's words. A
// failed requirement goes back to the task's maker as a small fix task; then one re-check of only those items, for up to two
// rounds (v0.3) before a person decides. A plan
// with no verification task gets the CEO's own end check, which ends with the final handover in the same turn.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAKEHOLDER, type Task } from '../src/core/company.ts';
import { ended, rig, type Rig } from './company-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';
import { handoverOf } from '../web/src/company/inbox/handoverModel.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T10:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const settled = () => vi.advanceTimersByTimeAsync(0);
const flush = async (r: Rig): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await r.company.idle();
    await settled();
  }
};
const CLEAN = { files: [], open: [], check: { ran: 'npm test', passed: true } };

const PLAN = (withVerification: boolean) => ({
  goal: 'A menu.',
  milestones: [{ id: 'ms-1', title: 'Menu', doneWhen: 'The menu is in.' }],
  tasks: [
    { id: 'p-1', title: 'Menu data', owner: 'office-manager', files: ['src/menu'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' },
    ...(withVerification
      ? [{ id: 'p-2', title: 'Final check', owner: 'ceo', files: [] as string[], milestone: 'ms-1', after: ['p-1'], brief: "Check it against the stakeholder's words.", doneWhen: 'Each requirement from stakeholder_words is reported pass or fail, with its evidence.', kind: 'verification' }]
      : []),
  ],
  note: null,
  cites: [] as string[],
});

async function started(withVerification: boolean): Promise<Rig> {
  // A medium company has the final review as a task of its plan; a small one has the CEO's end check.
  const r = await rig({ running: true, planApproval: 'before-work', org: { size: withVerification ? 'medium' : 'small' } });
  const proposed = r.company.proposePlan('ceo', withChecklist(PLAN(withVerification)));
  if (!proposed.ok) throw new Error(proposed.errors.join('\n'));
  r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
  r.desks().deliverAll();
  await settled();
  // The CEO has planned and gone to sleep: it has a session, which a fresh desk for the review would leave behind.
  r.desks().events.turn('ceo', ended('The plan is proposed.'));
  return r;
}

const taskBy = (r: Rig, planTask: string): Task => {
  const t = r.company.view().tasks.find((x) => x.planTask === planTask);
  if (!t) throw new Error(`No task for ${planTask}.`);
  return t;
};
const taskIn = (r: Rig, id: string): Task => {
  const t = r.company.view().tasks.find((x) => x.id === id);
  if (!t) throw new Error(`No task ${id}.`);
  return t;
};
const turnsOf = (r: Rig, person: string) => r.desks().turns.filter((t) => t.plan.person.id === person);
const lastTurn = (r: Rig, person: string): string => turnsOf(r, person).at(-1)?.turn.text ?? '';
const followUps = (r: Rig, kind: string): Task[] => r.company.view().tasks.filter((t) => t.followUp?.kind === kind);

async function built(r: Rig): Promise<void> {
  const first = taskBy(r, 'p-1');
  r.company.report('office-manager', { taskId: first.id, outcome: 'done', text: '', form: CLEAN });
  await flush(r);
  r.desks().deliverAll();
}

describe("the plan's verification task", () => {
  it('goes to a fresh desk, with the diff against where the company started, the brief file and the steps', async () => {
    const r = await started(true);
    await built(r);
    const review = taskBy(r, 'p-2');
    // Its owner's old desk was closed, and the session left behind, so nothing of the planning is carried over.
    expect(r.desks().closed).toContain('ceo');
    expect(r.company.view().log.some((l) => l.kind === 'handover' && l.text.includes('fresh desk for the final check, with nothing carried over'))).toBe(true);
    const turn = turnsOf(r, 'ceo').find((t) => t.turn.text.includes(`New task ${review.id}`))?.turn.text ?? '';
    expect(turn).toContain('This is the final check, in a fresh desk: you built none of it, and you fix nothing.');
    expect(turn).toContain('`git diff --stat ba5e0f1c2d3e worklings/test`');
    expect(turn).toContain('`git diff ba5e0f1c2d3e worklings/test -- <path>`');
    expect(turn).toContain('Read the company brief and stakeholder_words.');
    expect(turn).toContain('one line for each failed requirement, starting with the id of the task that built it');
    expect(turn).toMatch(/The company brief, with Robin's request word for word: .*\/\.worklings-shared\/brief\.md/);
    // No notes to read: the desk is new, and the office wrote nothing for it.
    expect(turn).not.toContain('Your desk is new');
    expect(turnsOf(r, 'ceo').find((t) => t.turn.text.includes(`New task ${review.id}`))?.plan.fresh).toBe(true);
  });

  it('closes on a clean review without a turn for anyone, and the plan finishes with the final handover to write', async () => {
    const r = await started(true);
    await built(r);
    const review = taskBy(r, 'p-2');
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read every requirement against the diff', passed: true } } });
    await flush(r);
    expect(taskIn(r, review.id).status).toBe('done');
    expect(followUps(r, 'fix')).toHaveLength(0);
    expect(r.company.view().done).not.toBeNull();
    const finish = lastTurn(r, 'ceo');
    expect(finish).toContain('the plan is finished, and the final review passed.');
    expect(finish).toContain("in the final handover's shape from your house rules: what was built, how to open or run it, what is not done, what it cost against the estimate");
    expect(finish).toMatch(/So far the company cost \$[\d.]+ .*the estimate was \$[\d.]+ to \$[\d.]+/);
  });

  it('sends a failed requirement back to the maker as a small fix task, once, and then re-checks only that', async () => {
    const r = await started(true);
    await built(r);
    const make = taskBy(r, 'p-1');
    const review = taskBy(r, 'p-2');
    const ceoTurns = turnsOf(r, 'ceo').length;
    r.company.report('ceo', {
      taskId: review.id,
      outcome: 'done',
      text: '',
      form: { files: [], open: ['p-1: the menu has no Flat white (src/menu/items.ts line 12)'], check: { ran: 'read the diff', passed: false } },
    });
    await flush(r);
    // The review is over; the fix task is the maker's, with their own files and check, and the office made it by itself.
    expect(taskIn(r, review.id)).toMatchObject({ status: 'done', outcome: '1 requirement failed and went back to their makers.' });
    const [fix] = followUps(r, 'fix');
    expect(fix).toMatchObject({ owner: 'office-manager', files: ['src/menu'], askedBy: 'ceo', milestone: 'ms-1', title: 'Fix: Menu data', check: { command: 'npm test', state: 'pending', runs: 0 } });
    expect(fix?.followUp).toEqual({ kind: 'fix', verification: review.id, items: ['p-1: the menu has no Flat white (src/menu/items.ts line 12)'], round: 1, maker: make.id, batch: review.id });
    expect(fix?.brief).toContain(`not met in what you built (task ${make.id})`);
    expect(fix?.brief).toContain('the menu has no Flat white');
    expect(lastTurn(r, 'office-manager')).toContain(`New task ${fix?.id}: Fix: Menu data`);
    // Nobody who sleeps was woken, and the plan is not finished over a failed requirement.
    expect(turnsOf(r, 'ceo')).toHaveLength(ceoTurns);
    expect(r.company.view().done).toBeNull();

    // The fix passes its check and closes; then the reviewer checks only those items again.
    r.desks().deliverAll();
    r.company.report('office-manager', { taskId: fix?.id ?? '', outcome: 'done', text: '', form: CLEAN });
    await flush(r);
    expect(taskIn(r, fix?.id ?? '')).toMatchObject({ status: 'done', check: { state: 'passed' } });
    const [recheck] = followUps(r, 'recheck');
    expect(recheck).toMatchObject({ owner: 'ceo', title: 'Re-check: 1 requirement', files: [] });
    const turn = lastTurn(r, 'ceo');
    expect(turn).toContain('Look again at only these requirements');
    expect(turn).toContain('the menu has no Flat white');
    expect(turn).toContain('Check only the requirements listed above, again; nothing else, and fix nothing.');
    expect(followUps(r, 'recheck')).toHaveLength(1);

    r.company.report('ceo', { taskId: recheck?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read the fix', passed: true } } });
    r.desks().events.turn('ceo', ended('Re-checked.'));
    await flush(r);
    expect(taskIn(r, recheck?.id ?? '').status).toBe('done');
    expect(r.company.view().done).not.toBeNull();
    expect(lastTurn(r, 'ceo')).toContain('the final review passed');
  });

  it('makes a second fix round when the re-check fails, and only after that goes to a person (v0.3)', async () => {
    const r = await started(true);
    await built(r);
    const review = taskBy(r, 'p-2');
    const item = 'p-1: the menu has no Flat white';
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [item], check: { ran: 'read', passed: false } } });
    await flush(r);
    for (const round of [1, 2]) {
      const fix = followUps(r, 'fix').at(-1);
      expect(fix?.followUp).toMatchObject({ verification: review.id, round });
      expect(fix?.brief).toContain(`fix round ${round} of 2`);
      r.desks().deliverAll();
      r.company.report('office-manager', { taskId: fix?.id ?? '', outcome: 'done', text: '', form: CLEAN });
      await flush(r);
      const recheck = followUps(r, 'recheck').at(-1);
      expect(recheck?.followUp).toMatchObject({ verification: review.id, round });
      // The re-check still fails: round 1 sends it back again by itself, round 2 hands it to a person.
      r.company.report('ceo', { taskId: recheck?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [item], check: { ran: 'read', passed: false } } });
      await flush(r);
    }
    expect(followUps(r, 'fix')).toHaveLength(2);
    expect(followUps(r, 'recheck')).toHaveLength(2);
    const last = followUps(r, 'recheck').at(-1);
    // The task stays open, blocked on a decision, with the stakeholder told in plain words; the plan isn't finished.
    expect(taskIn(r, last?.id ?? '').status).toBe('blocked');
    expect(r.company.view().done).toBeNull();
    expect(r.company.view().messages.at(-1)).toMatchObject({ from: '@office', to: STAKEHOLDER });
    expect(r.company.view().messages.at(-1)?.text).toContain("the office can't send it back to a maker by itself");
  });

  it('does not guess whose a failed requirement is: a line that names no task goes to a person', async () => {
    const r = await started(true);
    await built(r);
    const review = taskBy(r, 'p-2');
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: ['The README has no run instructions'], check: { ran: 'read', passed: false } } });
    await flush(r);
    expect(followUps(r, 'fix')).toHaveLength(0);
    expect(taskIn(r, review.id).status).toBe('blocked');
  });
});

describe("the CEO's own end check", () => {
  it('is made for a plan with no verification task, once its tasks are done: a task for the CEO, in a fresh desk', async () => {
    const r = await started(false);
    await built(r);
    const [end] = followUps(r, 'end-check');
    expect(end).toMatchObject({ owner: 'ceo', askedBy: STAKEHOLDER, title: 'End check against the request', files: [], milestone: 'ms-1' });
    expect(end?.followUp?.verification).toBe(end?.id);
    // Not finished yet: the end check is the last task.
    expect(r.company.view().done).toBeNull();
    expect(r.desks().closed).toContain('ceo');
    const turn = lastTurn(r, 'ceo');
    expect(turn).toContain(`New task ${end?.id}: End check against the request`);
    expect(turn).toContain('When every requirement passes, write the final handover to Robin in this same turn, with report and no task');
    expect(turn).toContain('This is the final check, in a fresh desk');
    expect(turn).toContain('`git diff --stat ba5e0f1c2d3e worklings/test`');
  });

  it('finishes the plan without a second turn when the handover came in the same turn', async () => {
    const r = await started(false);
    await built(r);
    const [end] = followUps(r, 'end-check');
    const turns = turnsOf(r, 'ceo').length;
    r.company.report('ceo', { taskId: end?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    r.company.report('ceo', { taskId: null, outcome: 'done', text: 'Built: the menu. Open it with npm start. Nothing is missing. It cost $1.' });
    await flush(r);
    expect(taskIn(r, end?.id ?? '').status).toBe('done');
    // The turn is still under way: the office waits for it to end before it asks for a handover that may be coming.
    await flush(r);
    expect(turnsOf(r, 'ceo')).toHaveLength(turns);
    r.desks().events.turn('ceo', ended('Handed over.'));
    await flush(r);
    expect(r.company.view().done).not.toBeNull();
    // The handover was written, so the office asks for nothing more.
    expect(turnsOf(r, 'ceo')).toHaveLength(turns);
    expect(r.company.view().reports.at(-1)).toMatchObject({ person: 'ceo', to: STAKEHOLDER, taskId: null });
  });

  it('shows that same-turn handover on the end card, though the plan is marked done after it', async () => {
    const r = await started(false);
    await built(r);
    const [end] = followUps(r, 'end-check');
    r.company.report('ceo', { taskId: end?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    await vi.advanceTimersByTimeAsync(1_000);
    r.company.report('ceo', { taskId: null, outcome: 'done', text: 'Built: the menu.\n\nOpen it with npm start.' });
    // The turn runs on a while after the handover; the plan is marked done when it ends.
    await vi.advanceTimersByTimeAsync(3_000);
    r.desks().events.turn('ceo', ended('Handed over.'));
    await flush(r);
    const view = r.company.view();
    const handover = view.reports.at(-1);
    expect(view.done).not.toBeNull();
    expect(handover?.at).toBeLessThan(view.done ?? 0);
    expect(handoverOf(view)).toMatchObject({ state: 'written', writtenAt: handover?.at, paragraphs: ['Built: the menu.', 'Open it with npm start.'] });
  });

  it('checks again, and asks for a new handover, when work finishes after the plan did', async () => {
    const r = await started(false);
    await built(r);
    const [first] = followUps(r, 'end-check');
    r.company.report('ceo', { taskId: first?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    r.company.report('ceo', { taskId: null, outcome: 'done', text: 'Built: the menu.' });
    r.desks().events.turn('ceo', ended('Handed over.'));
    await flush(r);
    expect(r.company.view().done).not.toBeNull();

    // The stakeholder asks for more, and it is done: the work after the handover gets its own end check.
    await vi.advanceTimersByTimeAsync(5_000);
    const extra = r.company.createTask(STAKEHOLDER, { title: 'Opening hours', brief: 'Add them.', files: ['src/hours'], owner: 'office-manager', doneWhen: 'They show.', milestone: null, cites: [] });
    r.desks().deliverAll();
    r.company.report('office-manager', { taskId: extra.id, outcome: 'done', text: '', form: CLEAN });
    await flush(r);
    expect(followUps(r, 'end-check')).toHaveLength(2);
    expect(r.company.view().done).toBeNull();
  });

  it('tells the CEO, who decides, when the re-check of its end check fails', async () => {
    const r = await started(false);
    await built(r);
    const [end] = followUps(r, 'end-check');
    const item = 'p-1: the menu has no Flat white';
    r.company.report('ceo', { taskId: end?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [item], check: { ran: 'read', passed: false } } });
    await flush(r);
    // Two fix rounds go by themselves (v0.3); the second re-check's failure is the CEO's to decide.
    for (const round of [1, 2]) {
      const fix = followUps(r, 'fix').at(-1);
      r.desks().deliverAll();
      r.company.report('office-manager', { taskId: fix?.id ?? '', outcome: 'done', text: '', form: CLEAN });
      await flush(r);
      if (round === 2) break;
      const first = followUps(r, 'recheck').at(-1);
      r.company.report('ceo', { taskId: first?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [item], check: { ran: 'read', passed: false } } });
      await flush(r);
    }
    const recheck = followUps(r, 'recheck').at(-1);
    r.desks().events.turn('ceo', ended('Re-check started.'));
    const turns = turnsOf(r, 'ceo').length;
    r.company.report('ceo', { taskId: recheck?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [item], check: { ran: 'read', passed: false } } });
    await flush(r);
    r.desks().events.turn('ceo', ended('Reported.'));
    await flush(r);
    expect(taskIn(r, recheck?.id ?? '').status).toBe('blocked');
    const messages = r.company.view().messages;
    expect(messages.some((m) => m.from === '@office' && m.to === STAKEHOLDER && m.text.includes('The CEO decides what to do.'))).toBe(true);
    const told = messages.find((m) => m.from === '@office' && m.to === 'ceo' && m.text.includes(`Task ${recheck?.id}`));
    expect(told?.text).toContain('The task waits, blocked, for you to decide: assign the fixes, or ask Robin what to do.');
    // And it reaches the CEO's desk as a turn.
    expect(turnsOf(r, 'ceo').length).toBeGreaterThan(turns);
    expect(lastTurn(r, 'ceo')).toContain('for you to decide');
  });

  it('is made when the stakeholder dropped the plan’s own final review', async () => {
    const r = await started(true);
    r.company.steerTask(STAKEHOLDER, { action: 'cancel', task: taskBy(r, 'p-2').id, reason: 'Not needed.', cites: [] });
    await flush(r);
    await built(r);
    const [end] = followUps(r, 'end-check');
    expect(end).toMatchObject({ owner: 'ceo', title: 'End check against the request' });
    expect(r.company.view().done).toBeNull();
  });

  it('asks for the handover afterwards when the turn that checked did not write it', async () => {
    const r = await started(false);
    await built(r);
    const [end] = followUps(r, 'end-check');
    r.company.report('ceo', { taskId: end?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    r.desks().events.turn('ceo', ended('Checked.'));
    await flush(r);
    expect(lastTurn(r, 'ceo')).toContain('the plan is finished');
    expect(lastTurn(r, 'ceo')).toContain('Report to Robin with report and no task');
  });
});

describe('a company without a plan', () => {
  it('has no end check and finishes as before', async () => {
    const r = await rig({ running: true });
    expect(followUps(r, 'end-check')).toHaveLength(0);
  });
});
