import { describe, expect, it } from 'vitest';
import { STAKEHOLDER, type Task } from '../src/core/company.ts';
import type { Decision } from '../src/core/steering.ts';
import {
  blankTask,
  branchLine,
  choiceName,
  cancelDecision,
  cancelHint,
  cancelLine,
  checkNewTask,
  createdLine,
  dropInOrder,
  handoverHint,
  handoverLines,
  headOf,
  moveInOrder,
  movedLine,
  newTaskInput,
  originLine,
  pausedLine,
  peopleByRoom,
  placeLine,
  priorityOrder,
  reachesLine,
  reassignChoices,
  sameOrder,
  sharePath,
  sharedFiles,
  steerable,
  steeredRow,
  steeredWord,
  toldLine,
  withPending,
} from '../web/src/company/tasks/boardModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { company, min, NOW, task } from './panels-work-kit.ts';
import { companyWithPlan, plan, planView, steering, version } from './steering-plan-kit.ts';

const ids = (list: readonly Task[]) => list.map((t) => t.id);

describe('the order work is handed out in', () => {
  it('puts open tasks by priority, then in the order they were asked for', () => {
    const tasks = [
      task('t-1', 'frontend-engineer', 'One', { priority: 3, createdAt: NOW - min(50) }),
      task('t-2', 'frontend-engineer', 'Two', { priority: 1, createdAt: NOW - min(40) }),
      task('t-3', 'ui-designer', 'Three', { status: 'done', priority: 0 }),
      task('t-4', 'ui-designer', 'Four', { createdAt: NOW - min(90) }),
      task('t-5', 'ui-designer', 'Five', { priority: 3, createdAt: NOW - min(60), status: 'working' }),
      task('t-6', 'ui-designer', 'Six', { status: 'dropped' }),
    ];
    expect(ids(priorityOrder(tasks))).toEqual(['t-2', 't-5', 't-1', 't-4']);
  });

  it('keeps the order tasks were asked for while the office gives no priority', () => {
    const tasks = [task('t-2', 'a', 'Two', { createdAt: NOW - min(5) }), task('t-1', 'a', 'One', { createdAt: NOW - min(9) })];
    expect(ids(priorityOrder(tasks))).toEqual(['t-1', 't-2']);
  });

  it('moves a task up, down, to the top or to the bottom', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(moveInOrder(order, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveInOrder(order, 'b', 'down')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveInOrder(order, 'd', 'top')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveInOrder(order, 'a', 'bottom')).toEqual(['b', 'c', 'd', 'a']);
    expect(moveInOrder(order, 'a', 'up')).toBeNull();
    expect(moveInOrder(order, 'd', 'bottom')).toBeNull();
    expect(moveInOrder(order, 'x', 'up')).toBeNull();
  });

  it('drops a task before another or at the end, and is no change where it already is', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(dropInOrder(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(dropInOrder(order, 'a', null)).toEqual(['b', 'c', 'd', 'a']);
    expect(dropInOrder(order, 'a', 'c')).toEqual(['b', 'a', 'c', 'd']);
    expect(dropInOrder(order, 'b', 'c')).toBeNull();
    expect(dropInOrder(order, 'b', 'b')).toBeNull();
    expect(dropInOrder(order, 'd', null)).toBeNull();
    expect(dropInOrder(order, 'b', 'zz')).toBeNull();
  });

  it('shows your order while it is on its way, with tasks that came or went since in step', () => {
    expect(withPending(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c']);
    expect(withPending(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    // b finished meanwhile, and n came after a in the office's order.
    expect(withPending(['a', 'n', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'n']);
    // A new task first in the office's order goes first.
    expect(withPending(['n', 'a', 'b'], ['b', 'a'])).toEqual(['n', 'b', 'a']);
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });

  it('says a task’s place in line, and where a move put it', () => {
    expect(placeLine(['a', 'b', 'c', 'd', 'e'], 'e')).toBe('Fifth of five in line.');
    expect(placeLine(['a'], 'a')).toBe('The only task in line.');
    expect(placeLine(['a'], 'x')).toBeNull();
    const order = Array.from({ length: 14 }, (_, i) => `t-${i}`);
    expect(movedLine(order, task('t-1', 'a', 'Cart'))).toBe('Moved “Cart”: now second of 14 in line.');
  });
});

describe('pause and resume', () => {
  const paused = task('t-1', 'frontend-engineer', 'Cart', { status: 'working', paused: { at: NOW - min(3), by: STAKEHOLDER } });

  it('says who paused a task and when, on its row and in its word', () => {
    expect(pausedLine(company(), paused)).toBe(`Paused by you at ${hourMinute(NOW - min(3))}.`);
    expect(pausedLine(company(), { ...paused, paused: { at: NOW, by: 'head-of-engineering' } })).toBe(`Paused by Ben at ${hourMinute(NOW)}.`);
    expect(steeredRow(company({ tasks: [paused] }), paused, NOW).line).toBe(`Kai, frontend engineer. Paused by you at ${hourMinute(NOW - min(3))}.`);
    expect(steeredWord(paused)).toEqual({ word: 'Paused', tone: 'rest' });
  });

  it('offers pause or resume as fits, and nothing for finished work', () => {
    expect(steerable(task('t-1', 'a', 'Open', { status: 'queued' }))).toEqual({ pause: true, resume: false, cancel: true, reassign: true, order: true });
    expect(steerable(paused)).toMatchObject({ pause: false, resume: true });
    expect(steerable(task('t-2', 'a', 'Done', { status: 'done' }))).toEqual({ pause: false, resume: false, cancel: false, reassign: false, order: false });
  });

  it('reads as before without steering', () => {
    const working = task('t-3', 'frontend-engineer', 'Slots', { status: 'working', updatedAt: NOW - min(12) });
    expect(steeredRow(company({ tasks: [working] }), working, NOW).line).toBe('Kai, frontend engineer. Working for 12 min.');
    expect(steeredWord(working)).toEqual({ word: 'Working', tone: 'working' });
  });
});

describe('cancel', () => {
  const cancelled = task('t-1', 'frontend-engineer', 'Cart', { status: 'dropped', cancel: { at: NOW - min(2), by: STAKEHOLDER, reason: 'Not needed for the launch.', branch: 'worklings/t-1-cart' } });

  it('says who cancelled it, when and why, and where the work stays', () => {
    expect(cancelLine(company(), cancelled)).toBe(`Cancelled by you at ${hourMinute(NOW - min(2))}: Not needed for the launch.`);
    expect(branchLine(company(), cancelled)).toEqual({ text: 'The work stays on its branch:', branch: 'worklings/t-1-cart' });
    expect(steeredRow(company({ tasks: [cancelled] }), cancelled, NOW)).toMatchObject({ line: cancelLine(company(), cancelled), answer: null });
    expect(steeredWord(cancelled).word).toBe('Cancelled');
  });

  it('says why no branch keeps the work', () => {
    const none = { ...cancelled, cancel: { ...cancelled.cancel!, branch: null } };
    expect(branchLine(company(), none)?.text).toBe('Nothing had changed, so no branch keeps it.');
    expect(branchLine(company({ branch: null }), none)?.text).toBe("The project isn't a git repository, so no branch keeps the work.");
  });

  it('says before you cancel where the work will stay', () => {
    const open = task('t-2', 'frontend-engineer', 'Slots', { status: 'working' });
    expect(cancelHint(company(), open)).toBe('Kai stops, and what they changed is kept on a branch named after the task.');
    expect(cancelHint(company(), { ...open, worktree: { path: 'x', branch: 'worklings/slots' } })).toBe('Kai stops, and the work stays on its branch, worklings/slots.');
    expect(cancelHint(company({ branch: null }), open)).toBe("Kai stops. The project isn't a git repository, so what changed stays as it is.");
  });

  it('finds the decision that cancelled it while it can be undone', () => {
    const decision = (extra: Partial<Decision>): Decision => ({
      id: 'd-1',
      at: NOW - min(2),
      by: STAKEHOLDER,
      kind: 'task',
      what: 'Robin cancelled Cart.',
      why: null,
      alternatives: [],
      people: [],
      rooms: [],
      links: { task: 't-1' },
      reversible: true,
      undone: null,
      reconsider: null,
      ...extra,
    });
    const withDecisions = (decisions: Decision[]) => company({ steering: { ...steering(null), decisions } });
    expect(cancelDecision(withDecisions([decision({})]), cancelled)).toBe('d-1');
    expect(cancelDecision(withDecisions([decision({ reversible: false })]), cancelled)).toBeNull();
    expect(cancelDecision(withDecisions([decision({ undone: { at: NOW, by: STAKEHOLDER, decision: 'd-2' } })]), cancelled)).toBeNull();
    // A pause long before isn't the cancel.
    expect(cancelDecision(withDecisions([decision({ at: NOW - min(60) })]), cancelled)).toBeNull();
    expect(cancelDecision(company(), cancelled)).toBeNull();
  });
});

describe('reassign', () => {
  it('offers everyone but the owner, their own room first, and says what the handover does', () => {
    const t = task('t-1', 'frontend-engineer', 'Cart');
    const choices = reassignChoices(company(), t).map((p) => p.id);
    expect(choices).not.toContain('frontend-engineer');
    expect(choices).toHaveLength(7);
    // Kai's teammates in engineering first, by name: Ben, Ola, the QA engineer.
    expect(choices.slice(0, 3)).toEqual(['head-of-engineering', 'frontend-lead', 'qa-engineer']);
    expect(handoverHint(company(), t, 'qa-engineer')).toBe('Kai stops, and the QA engineer gets the brief, your note and what Kai did so far.');
  });

  it('groups people by room for a choice, a room of your pick first, without the owner', () => {
    const names = (room: string) => ({ direction: 'Direction', engineering: 'Engineering', design: 'Design' })[room] ?? room;
    const groups = peopleByRoom(company(), names, { except: 'frontend-engineer', first: 'engineering' });
    expect(groups.map((g) => [g.name, g.people.map((p) => p.id)])).toEqual([
      ['Engineering', ['head-of-engineering', 'frontend-lead', 'qa-engineer']],
      ['Direction', ['ceo', 'office-manager']],
      ['Design', ['head-of-design', 'ui-designer']],
    ]);
    expect(peopleByRoom(company(), names).map((g) => g.name)).toEqual(['Direction', 'Engineering', 'Design']);
    expect(company().people.map(choiceName).slice(0, 4)).toEqual(['The CEO', 'Ben, head of engineering', 'Ola, frontend lead', 'Kai, frontend engineer']);
  });

  it('lists handovers in sentences', () => {
    const t = task('t-1', 'qa-engineer', 'Cart', {
      handovers: [
        { at: NOW - min(30), by: STAKEHOLDER, from: 'frontend-engineer', to: 'ui-designer', note: 'Mina knows the cart.' },
        { at: NOW - min(10), by: 'head-of-design', from: 'ui-designer', to: 'qa-engineer', note: '' },
      ],
    });
    expect(handoverLines(company(), t)).toEqual([
      `You moved it from Kai to Mina at ${hourMinute(NOW - min(30))}: “Mina knows the cart.”`,
      `Ada moved it from Mina to the QA engineer at ${hourMinute(NOW - min(10))}.`,
    ]);
  });
});

describe('a task you create', () => {
  it('tells the owner’s head, or the CEO for a head, and nobody for the CEO', () => {
    expect(headOf(company(), 'frontend-engineer')?.id).toBe('head-of-engineering');
    expect(toldLine(company(), 'frontend-engineer')).toBe('Ben, head of engineering, is told.');
    expect(toldLine(company(), 'head-of-design')).toBe('The CEO is told.');
    expect(toldLine(company(), 'ceo')).toBeNull();
    expect(createdLine(company(), { title: 'Fix the footer link', owner: 'ui-designer' })).toBe('Added “Fix the footer link” for Mina. Ada, head of design, is told.');
  });

  it('says when it reaches its owner', () => {
    const c = company({ tasks: [task('t-1', 'frontend-engineer', 'Cart'), task('t-2', 'frontend-engineer', 'Slots', { status: 'working' }), task('t-3', 'frontend-engineer', 'Old', { status: 'done' })] });
    expect(reachesLine(c, 'frontend-engineer')).toBe('It reaches Kai in priority order, after their two open tasks; move it up the board to make it sooner.');
    expect(reachesLine(c, 'ui-designer')).toBe('It reaches Mina first: nothing else is open for them.');
  });

  it('needs a title, an owner, a brief and when it is done', () => {
    const problems = checkNewTask(blankTask('nobody'), company());
    expect(problems.map((p) => p.field)).toEqual(['title', 'owner', 'brief', 'doneWhen']);
    const fine = { ...blankTask('frontend-engineer'), title: 'Fix the footer link', brief: 'The footer links to the old menu.', doneWhen: 'The link opens the menu.' };
    expect(checkNewTask(fine, company())).toEqual([]);
  });

  it('keeps its files inside the project and apart from open tasks', () => {
    const c = company({ tasks: [task('t-1', 'frontend-engineer', 'Cart', { files: ['src/cart/'] }), task('t-2', 'ui-designer', 'Old cart', { files: ['src/old/'], status: 'done' })] });
    const d = { ...blankTask('ui-designer'), title: 'Footer', brief: 'Fix the footer.', doneWhen: 'Done.' };
    expect(checkNewTask({ ...d, files: 'src/cart/Cart.tsx' }, c)).toEqual([
      { field: 'files', text: "src/cart/Cart.tsx is in “Cart”, an open task of Kai's. Open tasks never share a file: pick others, or wait until it's done." },
    ]);
    expect(checkNewTask({ ...d, files: 'src/old/x.ts\nsrc/footer/' }, c)).toEqual([]);
    expect(checkNewTask({ ...d, files: '../outside' }, c)[0]?.text).toBe('The task names ../outside. Files are relative to the project, like src/cart/.');
  });

  it('compares paths as files and the folders they are in', () => {
    expect(sharePath('src/cart/', 'src/cart/Cart.tsx')).toBe(true);
    expect(sharePath('src/cart', 'src\\cart\\Cart.tsx')).toBe(true);
    expect(sharePath('./src/a.ts', 'src/a.ts')).toBe(true);
    expect(sharePath('src/cart', 'src/cartography')).toBe(false);
    expect(sharedFiles(company({ tasks: [task('t-1', 'a', 'A', { files: ['src/'] })] }), ['src/x.ts'], 't-1')).toEqual([]);
  });

  it('becomes the input the office takes', () => {
    expect(newTaskInput({ title: ' Footer ', brief: ' Fix it. ', files: 'src/footer/\n\nsrc/footer/\n', owner: 'ui-designer', doneWhen: ' Works. ', milestone: 'ms-1' })).toEqual({
      title: 'Footer',
      brief: 'Fix it.',
      files: ['src/footer/'],
      owner: 'ui-designer',
      doneWhen: 'Works.',
      milestone: 'ms-1',
    });
  });
});

describe('the plan task a task came from', () => {
  it('names it and its milestone from the newest version that has it', () => {
    const v1 = version(1, plan());
    const v2 = version(2, plan({ tasks: plan().tasks.map((t) => (t.id === 'p-3' ? { ...t, title: 'Pickup slot picker' } : t)) }));
    const c = companyWithPlan(planView([v1, v2]));
    expect(originLine(c, task('t-1', 'frontend-engineer', 'Slots', { planTask: 'p-3' }))).toBe('From the plan: “Pickup slot picker”, in “Pickup orders work”.');
    expect(originLine(c, task('t-2', 'frontend-engineer', 'Slots', { planTask: 'p-99' }))).toBe('From the plan.');
    expect(originLine(c, task('t-3', 'frontend-engineer', 'Slots'))).toBeNull();
  });
});
