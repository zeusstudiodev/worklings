import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import {
  allDoneLine,
  byRoom,
  byStatus,
  findTasks,
  flattenTasks,
  LANDS_LATER,
  milestonesOf,
  taskPage,
  taskRow,
} from '../web/src/company/tasks/tasksModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { approval, company, min, NOW, question, report, studio, task } from './panels-work-kit.ts';

describe('the goal and milestones', () => {
  it('counts done tasks per milestone, leaving dropped ones out, and says when one was done', () => {
    const c = company({
      goal: {
        text: 'Pickup orders',
        setAt: NOW - min(600),
        milestones: [
          { id: 'ms-menu', title: 'Menu pages live', doneWhen: '', doneAt: NOW - min(180) },
          { id: 'ms-pickup', title: 'Pickup orders work', doneWhen: '', doneAt: null },
          { id: 'ms-launch', title: 'Launch', doneWhen: '', doneAt: null },
        ],
      },
      tasks: [
        task('t1', 'frontend-engineer', 'Slots', { milestone: 'ms-pickup', status: 'done' }),
        task('t2', 'frontend-engineer', 'Cart', { milestone: 'ms-pickup', status: 'working' }),
        task('t3', 'ui-designer', 'Photos', { milestone: 'ms-pickup', status: 'dropped' }),
      ],
    });
    expect(milestonesOf(c).map((m) => [m.title, m.line, m.share])).toEqual([
      ['Menu pages live', `Done at ${hourMinute(NOW - min(180))}`, 1],
      ['Pickup orders work', '1 of 2 tasks done', 0.5],
      ['Launch', 'No tasks yet', 0],
    ]);
  });
});

describe('a task’s row', () => {
  it('says who works on it and for how long', () => {
    const c = company();
    expect(taskRow(c, task('t1', 'frontend-engineer', 'Pickup slot picker', { status: 'working', updatedAt: NOW - min(12) }), NOW).line).toBe('Kai, frontend engineer. Working for 12 min.');
    expect(taskRow(c, task('t2', 'qa-engineer', 'Test', { status: 'queued' }), NOW).line).toBe('The QA engineer. Queued.');
    expect(taskRow(c, task('t3', 'frontend-engineer', 'Cart', { status: 'review', askedBy: 'frontend-lead' }), NOW).line).toBe('Kai, frontend engineer. In review with Ola.');
  });

  it('says what a blocked task waits on, with Answer when that is you', () => {
    const blocked = task('t1', 'frontend-engineer', 'Pay with TWINT', { status: 'blocked' });
    const ok = company({ tasks: [blocked], approvals: [approval('a1', 'frontend-engineer', 'Use a paid API')] });
    expect(taskRow(ok, blocked, NOW)).toMatchObject({ line: 'Blocked: waits for your OK to use a paid API.', answer: 'a1' });
    const asks = company({ tasks: [blocked], questions: [question('q1', 'frontend-engineer', 'Which merchant account?', ['Test', 'Real'], { taskId: 't1' })] });
    expect(taskRow(asks, blocked, NOW)).toMatchObject({ line: 'Blocked: waits for your answer: Which merchant account?', answer: 'q1' });
    const reported = company({ tasks: [blocked], reports: [report('r1', 'frontend-engineer', 'frontend-lead', 'Blocked: the order API isn’t there yet. Noah waits for a desk.', { taskId: 't1', outcome: 'blocked' })] });
    expect(taskRow(reported, blocked, NOW)).toMatchObject({ line: 'Blocked: the order API isn’t there yet.', answer: null });
  });

  it('says when it was done, and how many files changed once the diff was read', () => {
    const done = task('t1', 'frontend-engineer', 'Status page', { status: 'done', updatedAt: NOW - min(40), commit: 'a1b2c3d' });
    expect(taskRow(company(), done, NOW).line).toBe(`Done at ${hourMinute(NOW - min(40))}.`);
    expect(taskRow(company(), done, NOW, 4).line).toBe(`Done at ${hourMinute(NOW - min(40))}. 4 files changed.`);
  });
});

describe('by status and by room', () => {
  it('groups by status, longest waiting first and the newest done first', () => {
    const groups = byStatus([
      task('w1', 'a', 'One', { status: 'working', updatedAt: NOW - min(5) }),
      task('w2', 'a', 'Two', { status: 'working', updatedAt: NOW - min(50) }),
      task('d1', 'a', 'Old', { status: 'done', updatedAt: NOW - min(90) }),
      task('d2', 'a', 'New', { status: 'done', updatedAt: NOW - min(9) }),
      task('q1', 'a', 'Later', { status: 'queued', createdAt: NOW - min(5) }),
      task('q2', 'a', 'First', { status: 'queued', createdAt: NOW - min(70) }),
    ]);
    expect(groups.working.map((t) => t.id)).toEqual(['w2', 'w1']);
    expect(groups.done.map((t) => t.id)).toEqual(['d2', 'd1']);
    expect(groups.queued.map((t) => t.id)).toEqual(['q2', 'q1']);
  });

  it('builds the tree per room from the owners’ rooms, with subtasks one level in', () => {
    const c = company();
    const tasks = [
      task('t10', 'head-of-engineering', 'Pickup orders', { createdAt: NOW - min(240) }),
      task('t11', 'frontend-engineer', 'Slot picker', { parent: 't10', createdAt: NOW - min(200) }),
      task('t12', 'frontend-engineer', 'Slot styles', { parent: 't11', createdAt: NOW - min(100) }),
      task('t25', 'ui-designer', 'Slot visuals', { parent: 't10', createdAt: NOW - min(70) }),
      task('t99', 'someone-gone', 'Orphan', { createdAt: NOW - min(10) }),
    ];
    const rooms = byRoom({ studio }, c, tasks);
    expect(rooms.map((r) => [r.name, r.count])).toEqual([
      ['Design', 1],
      ['Engineering', 3],
      ['No room', 1],
    ]);
    expect(flattenTasks(rooms[1]!.nodes).map((n) => [n.task.id, n.depth])).toEqual([
      ['t10', 0],
      ['t11', 1],
      ['t12', 2],
    ]);
  });

  it('survives tasks whose parents form a loop', () => {
    const rooms = byRoom({ studio }, company(), [task('a', 'frontend-engineer', 'A', { parent: 'b' }), task('b', 'frontend-engineer', 'B', { parent: 'a' })]);
    expect(flattenTasks(rooms.flatMap((r) => r.nodes)).map((n) => n.task.id).sort()).toEqual(['a', 'b']);
  });

  it('finds tasks by title or owner', () => {
    const c = company();
    const tasks = [task('t1', 'frontend-engineer', 'Slot picker'), task('t2', 'ui-designer', 'Palette'), task('t3', 'qa-engineer', 'End-to-end test')];
    expect(findTasks(c, tasks, 'kai').map((t) => t.id)).toEqual(['t1']);
    expect(findTasks(c, tasks, 'PALETTE').map((t) => t.id)).toEqual(['t2']);
    expect(findTasks(c, tasks, 'qa').map((t) => t.id)).toEqual(['t3']);
  });

  it('says when every task is done', () => {
    expect(allDoneLine([])).toBeNull();
    expect(allDoneLine([task('a', 'x', 'A', { status: 'done' }), task('b', 'x', 'B', { status: 'working' })])).toBeNull();
    expect(allDoneLine([task('a', 'x', 'A', { status: 'done' }), task('b', 'x', 'B', { status: 'done' }), task('c', 'x', 'C', { status: 'dropped' })])).toBe('All 2 tasks are done.');
  });
});

describe('a task’s page', () => {
  it('says who owns it, who asked, what it is part of and when its changes land', () => {
    const c = company({
      goal: { text: 'Pickup', setAt: 0, milestones: [{ id: 'ms', title: 'Pickup orders work', doneWhen: '', doneAt: null }] },
      tasks: [task('t10', 'head-of-engineering', 'Pickup orders'), task('t11', 'frontend-engineer', 'Slot picker', { parent: 't10', milestone: 'ms', status: 'working' }), task('t12', 'frontend-engineer', 'Slot styles', { parent: 't11' })],
    });
    const page = taskPage(c, c.tasks[1]!);
    expect(page.owns).toBe('Kai, frontend engineer, owns it.');
    expect(page.asked).toBe(`Ben asked at ${hourMinute(NOW - min(60))}.`);
    expect(page.partOf).toEqual({ kind: 'task', id: 't10', title: 'Pickup orders' });
    expect(page.subtasks.map((t) => t.id)).toEqual(['t12']);
    expect(page.changes).toBe(LANDS_LATER);
    const mine = taskPage(c, task('t13', 'qa-engineer', 'Retest', { askedBy: STAKEHOLDER, milestone: 'ms', status: 'done' }));
    expect(mine.owns).toBe('The QA engineer owns it.');
    expect(mine.asked).toBe(`You asked at ${hourMinute(NOW - min(60))}.`);
    expect(mine.partOf).toEqual({ kind: 'milestone', title: 'Pickup orders work' });
    expect(mine.changes).toBe('Nothing in the project changed.');
    expect(taskPage(c, task('t14', 'qa-engineer', 'Done', { status: 'done', commit: 'a1b2c3d' })).changes).toBeNull();
  });
});
