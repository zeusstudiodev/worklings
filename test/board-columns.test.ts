// The task board's columns, cards, filters and lanes (web/src/company/tasks/board/columns.ts and lanes.ts), as
// docs/design-v3.md "The task board" defines what lands where and what each card says.
import { describe, expect, it } from 'vitest';
import { type CompanyView, STAKEHOLDER, type Task } from '../src/core/company.ts';
import type { Decision } from '../src/core/steering.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { priorityOrder } from '../web/src/company/tasks/boardModel.ts';
import {
  boardIndex,
  boardOf,
  boardSentence,
  type Card,
  cardWords,
  changedSince,
  type ColumnId,
  filteredLine,
  filtersFrom,
  NO_FILTERS,
  seenFrom,
  seenOf,
  shortPlace,
  shownCount,
  type TaskCard,
  waitsOnTasks,
} from '../web/src/company/tasks/board/columns.ts';
import { lanesOf } from '../web/src/company/tasks/board/lanes.ts';
import { approval, company, desk, min, NOW, question, task, update } from './panels-work-kit.ts';
import { companyWithPlan, plan, planView, steering, version } from './steering-plan-kit.ts';

const order = (c: CompanyView) => priorityOrder(c.tasks).map((t) => t.id);
const board = (c: CompanyView, filters = NO_FILTERS) => boardOf(c, order(c), NOW, filters);
const ids = (c: CompanyView, column: ColumnId, filters = NO_FILTERS) => board(c, filters).columns.find((x) => x.id === column)?.cards.map((card) => card.id) ?? [];
const cardOf = (c: CompanyView, id: string): TaskCard => {
  const found = board(c)
    .columns.flatMap((x) => x.cards)
    .find((card): card is TaskCard => card.kind === 'task' && card.id === id);
  if (!found) throw new Error(`No card for ${id}.`);
  return found;
};
const words = (c: CompanyView, id: string, files?: number) =>
  cardWords(c, cardOf(c, id), { index: boardIndex(c, order(c)), now: NOW, roomName: (room) => `${room[0]?.toUpperCase()}${room.slice(1)}` }, files);

/** Kai (frontend engineer) and Mina (UI designer) with a task in every state. */
function cafe(extra: Partial<CompanyView> = {}): CompanyView {
  return company({
    goal: { text: 'Pickup orders.', milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'Live.', doneAt: null }], setAt: NOW - min(120) },
    tasks: [
      task('t-1', 'frontend-engineer', 'Menu data', { status: 'queued', priority: 1, milestone: 'ms-1' }),
      task('t-2', 'frontend-engineer', 'Cart summary', { status: 'working', priority: 2, updatedAt: NOW - min(22) }),
      task('t-3', 'ui-designer', 'Slot picker visuals', { status: 'blocked', priority: 3 }),
      task('t-4', 'ui-designer', 'Darker palette', { status: 'review', priority: 4, askedBy: 'head-of-design' }),
      task('t-5', 'frontend-engineer', 'Order status page', { status: 'done', updatedAt: NOW - min(90) }),
      task('t-6', 'ui-designer', 'Menu photos', { status: 'dropped', updatedAt: NOW - min(40) }),
      task('t-7', 'frontend-engineer', 'Opening hours', { status: 'queued', priority: 5 }),
    ],
    ...extra,
  });
}

describe('what lands in which column', () => {
  it('puts each task under its status, cancelled and dropped tasks under Cancelled', () => {
    const c = cafe();
    expect(ids(c, 'queued')).toEqual(['t-1', 't-7']);
    expect(ids(c, 'working')).toEqual(['t-2']);
    expect(ids(c, 'blocked')).toEqual(['t-3']);
    expect(ids(c, 'review')).toEqual(['t-4']);
    expect(ids(c, 'done')).toEqual(['t-5']);
    expect(ids(c, 'cancelled')).toEqual(['t-6']);
    expect(ids(c, 'you')).toEqual([]);
    expect(ids(c, 'paused')).toEqual([]);
  });

  it('shows a paused task under Paused whatever its status', () => {
    const c = cafe();
    const paused = { ...c, tasks: c.tasks.map((t) => (t.id === 't-2' ? { ...t, paused: { at: NOW - min(5), by: STAKEHOLDER } } : t)) };
    expect(ids(paused, 'paused')).toEqual(['t-2']);
    expect(ids(paused, 'working')).toEqual([]);
  });

  it('puts a task whose owner waits on you under Waiting for you, over Paused', () => {
    const base = cafe({ questions: [question('q-1', 'frontend-engineer', '15-minute or 30-minute windows?', ['15', '30'], { taskId: 't-2' })] });
    const c = { ...base, tasks: base.tasks.map((t) => (t.id === 't-2' ? { ...t, paused: { at: NOW - min(5), by: STAKEHOLDER } } : t)) };
    expect(ids(c, 'you')).toEqual(['t-2']);
    expect(ids(c, 'paused')).toEqual([]);
  });

  it('puts an approval on its person’s current task, and an office’s “start it?” on the task it holds', () => {
    const c = update(
      cafe({
        approvals: [approval('a-1', 'ui-designer', 'Push the work branch to GitHub')],
        questions: [question('q-2', '@office', 'Mina would like to start “Darker palette”. Start it?', ['Start it', 'Not now'], { taskId: 't-7', gate: { task: 't-7' } })],
      }),
      'ui-designer',
      { task: 't-3' },
    );
    expect(waitsOnTasks(c, NOW).get('t-3')).toMatchObject({ kind: 'ok', item: 'a-1' });
    expect(waitsOnTasks(c, NOW).get('t-7')).toMatchObject({ kind: 'start', item: 'q-2' });
    // The approval was asked three minutes ago, the start two: the longest waiting comes first.
    expect(ids(c, 'you')).toEqual(['t-3', 't-7']);
  });

  it('leaves an approval off the board when its person has no task, or a closed one', () => {
    const none = cafe({ approvals: [approval('a-1', 'ui-designer', 'Push the work branch')] });
    expect(ids(none, 'you')).toEqual([]);
    const closed = update(none, 'ui-designer', { task: 't-6' });
    expect(ids(closed, 'you')).toEqual([]);
  });

  it('opens Waiting for you with the plan while it waits, then the longest waiting first', () => {
    const view = planView([version(1, plan())]);
    const c: CompanyView = {
      ...cafe(),
      steering: companyWithPlan(view).steering,
      questions: [
        question('q-new', 'ui-designer', 'Which green?', ['A', 'B'], { taskId: 't-3', askedAt: NOW - min(1) }),
        question('q-old', 'frontend-engineer', 'Which provider?', ['A', 'B'], { taskId: 't-1', askedAt: NOW - min(9) }),
      ],
    };
    expect(ids(c, 'you')).toEqual(['plan', 't-1', 't-3']);
  });

  it('orders the ordered columns by the order work is handed out in, yours while it is on its way', () => {
    const c = cafe();
    expect(boardOf(c, ['t-7', 't-2', 't-1', 't-3', 't-4'], NOW).columns.find((x) => x.id === 'queued')?.cards.map((x) => x.id)).toEqual(['t-7', 't-1']);
  });

  it('puts Done and Cancelled newest first', () => {
    const c = cafe();
    const more = { ...c, tasks: [...c.tasks, task('t-8', 'ui-designer', 'Tokens', { status: 'done', updatedAt: NOW - min(10) })] };
    expect(ids(more, 'done')).toEqual(['t-8', 't-5']);
  });

  it('counts each open card’s place over every open task, and gives closed ones none', () => {
    const c = cafe();
    expect(cardOf(c, 't-7').place).toBe(5);
    expect(cardOf(c, 't-2').place).toBe(2);
    expect(cardOf(c, 't-5').place).toBeNull();
    expect(shortPlace(1)).toBe('1st');
    expect(shortPlace(12)).toBe('12th');
    expect(shortPlace(23)).toBe('23rd');
  });
});

describe('what a card says', () => {
  it('says a queued task’s place among its owner’s queued tasks', () => {
    const c = cafe();
    expect(words(c, 't-1').line).toBe('Next for Kai.');
    expect(words(c, 't-7').line).toBe('Second for Kai.');
  });

  it('says how long a task has been at work, or where its owner waits for a desk', () => {
    const c = cafe();
    expect(words(c, 't-2').line).toBe('Working for 22 min.');
    const waiting = update(c, 'frontend-engineer', { task: 't-2', desk: desk('waiting', { queue: 2 }) });
    expect(words(waiting, 't-2').line).toBe('Waits for a desk, second in line.');
  });

  it('says why a task is blocked from its owner’s report, and who reviews it', () => {
    const c = cafe({ reports: [{ id: 'r-1', person: 'ui-designer', to: 'head-of-design', taskId: 't-3', outcome: 'blocked', text: 'Blocked: needs the order API. Asked Ben.', at: NOW - min(3), cites: [] }] });
    expect(words(c, 't-3').line).toBe('Blocked: needs the order API.');
    expect(words(cafe(), 't-3').line).toBe('Blocked.');
    expect(words(c, 't-4').line).toBe('In review with Ada.');
  });

  it('says what the owner waits on you for, with Answer', () => {
    const c = update(
      cafe({
        approvals: [approval('a-1', 'frontend-engineer', 'Push the work branch to GitHub')],
        questions: [question('q-1', 'ui-designer', '15-minute or 30-minute windows', ['15', '30'], { taskId: 't-3' })],
      }),
      'frontend-engineer',
      { task: 't-2' },
    );
    expect(words(c, 't-2')).toMatchObject({ band: 'Waits for your OK', line: 'Waits for your OK: push the work branch to GitHub.', key: { kind: 'answer', item: 'a-1' } });
    expect(words(c, 't-3')).toMatchObject({ band: 'Waits for your answer', line: 'Waits for your answer: 15-minute or 30-minute windows.' });
  });

  it('says a paused task’s pause, with Resume', () => {
    const c = cafe();
    const at = NOW - min(20);
    const paused = { ...c, tasks: c.tasks.map((t) => (t.id === 't-1' ? { ...t, paused: { at, by: STAKEHOLDER } } : t)) };
    expect(words(paused, 't-1')).toMatchObject({ line: `Paused by you at ${hourMinute(at)}.`, key: { kind: 'resume' } });
  });

  it('says when a task was done, with the files its commit changed once they are known', () => {
    const c = cafe();
    expect(words(c, 't-5').line).toBe(`Done at ${hourMinute(NOW - min(90))}.`);
    expect(words(c, 't-5', 6).line).toBe(`Done at ${hourMinute(NOW - min(90))}. 6 files changed.`);
    expect(words(c, 't-5')).toMatchObject({ band: 'Done', place: null, key: null });
  });

  it('says why a task was cancelled, with Undo the cancel while it can be undone', () => {
    const c = cafe();
    const cancel = { at: NOW - min(30), by: STAKEHOLDER, reason: 'not needed for the launch', branch: null };
    const decision: Decision = {
      id: 'd-1', at: cancel.at, by: STAKEHOLDER, kind: 'task', what: 'You cancelled “Menu photos”.', why: null, alternatives: [], people: [], rooms: [],
      links: { task: 't-6' }, reversible: true, undone: null, reconsider: null,
    };
    const cancelled: CompanyView = { ...c, tasks: c.tasks.map((t) => (t.id === 't-6' ? { ...t, cancel } : t)), steering: steering(null, { decisions: [decision] }) };
    expect(words(cancelled, 't-6')).toMatchObject({ band: 'Cancelled', line: `Cancelled by you at ${hourMinute(cancel.at)}: not needed for the launch.`, key: { kind: 'undo-cancel', decision: 'd-1' } });
    expect(words(c, 't-6')).toMatchObject({ band: 'Dropped', line: `Dropped at ${hourMinute(NOW - min(40))}.`, key: null });
  });

  it('names a card by its title and puts the owner, line, milestone and place in its description', () => {
    const w = words(cafe(), 't-1');
    expect(w.title).toBe('Menu data');
    expect(w.description).toBe('Kai. Next for Kai. Menu pages live. First of five in line.');
    expect(w).toMatchObject({ band: 'Engineering', place: '1st', owner: 'Kai', milestone: 'Menu pages live' });
  });

  it('cuts the milestone on the note at 24 characters and keeps it whole in the description', () => {
    const c = cafe({ goal: { text: 'x', milestones: [{ id: 'ms-1', title: 'Launch in German and English for everyone', doneWhen: 'x', doneAt: null }], setAt: NOW - min(120) } });
    const w = words(c, 't-1');
    expect(w.milestone?.length).toBeLessThanOrEqual(24);
    expect(w.milestone?.endsWith('…')).toBe(true);
    expect(w.description).toContain('Launch in German and English for everyone.');
  });

  it('says what a subtask is part of, and how far a parent’s parts are', () => {
    const c = cafe();
    const parts: CompanyView = {
      ...c,
      tasks: [
        ...c.tasks.map((t) => (t.id === 't-2' || t.id === 't-5' || t.id === 't-6' ? { ...t, parent: 't-1' } : t)),
        task('t-9', 'frontend-engineer', 'Slot picker', { status: 'done', parent: 't-1' }),
      ],
    };
    expect(words(parts, 't-2').part).toBe('Part of: Menu data');
    // The dropped part isn't counted: three parts, two of them done.
    expect(words(parts, 't-1').parts).toEqual({ done: 2, total: 3, line: '2 of 3 subtasks done' });
  });

  it('tags a task whose owner is stuck', () => {
    const c = update(cafe(), 'frontend-engineer', { task: 't-2', desk: desk('failed', { since: NOW - min(4) }) });
    expect(words(c, 't-2').stuck).toBe('Stuck for 4 min');
    expect(words(c, 't-2').description).toContain('Stuck for 4 min.');
  });
});

describe('the board’s sentence', () => {
  it('counts the tasks, the done, the working and what waits for you', () => {
    const c = cafe({ questions: [question('q-1', 'ui-designer', 'Which?', ['A'], { taskId: 't-3' })] });
    expect(boardSentence(c, board(c))).toBe('Seven tasks: one done, one working, one waits for you.');
  });

  it('says nothing without tasks, and that none is done before anything moves', () => {
    expect(boardSentence(company(), board(company()))).toBeNull();
    const fresh = company({ tasks: [task('t-1', 'frontend-engineer', 'One'), task('t-2', 'frontend-engineer', 'Two')] });
    expect(boardSentence(fresh, board(fresh))).toBe('Two tasks, none done yet.');
  });
});

describe('filters', () => {
  it('shows one person’s tasks, a room’s, a milestone’s, or the ones Find matches', () => {
    const c = cafe();
    const all = (f: Partial<typeof NO_FILTERS>) =>
      board(c, { ...NO_FILTERS, ...f })
        .columns.flatMap((x) => x.cards)
        .map((x) => x.id)
        .sort();
    expect(all({ who: 'person:ui-designer' })).toEqual(['t-3', 't-4', 't-6']);
    expect(all({ who: 'room:engineering' })).toEqual(['t-1', 't-2', 't-5', 't-7']);
    expect(all({ milestone: 'ms-1' })).toEqual(['t-1']);
    expect(all({ find: 'mina' })).toEqual(['t-3', 't-4', 't-6']);
    expect(all({ find: 'menu' })).toEqual(['t-1', 't-6']);
  });

  it('says how many of the tasks the filters show', () => {
    const c = cafe();
    expect(filteredLine(board(c, { ...NO_FILTERS, who: 'person:ui-designer' }))).toBe('3 of 7 tasks');
  });

  it('hides the plan’s card under a filter that leaves the CEO out', () => {
    const c: CompanyView = { ...cafe(), steering: companyWithPlan(planView([version(1, plan())])).steering };
    expect(ids(c, 'you', { ...NO_FILTERS, who: 'person:ceo' })).toEqual(['plan']);
    expect(ids(c, 'you', { ...NO_FILTERS, who: 'person:frontend-engineer' })).toEqual([]);
    expect(ids(c, 'you', { ...NO_FILTERS, find: 'menu' })).toEqual([]);
  });

  it('reads filters kept for the tab as untrusted, keeping only what makes sense', () => {
    expect(filtersFrom({ who: 'person:kai', milestone: 'ms-1', find: 'cart', group: 'person' })).toEqual({ who: 'person:kai', milestone: 'ms-1', find: 'cart', group: 'person' });
    expect(filtersFrom({ who: 4, group: 'everything', find: 'x'.repeat(500) })).toEqual(NO_FILTERS);
    expect(filtersFrom(null)).toEqual(NO_FILTERS);
  });
});

describe('Done and Cancelled show their newest', () => {
  it('shows ten, three in a lane, and everything once opened; other columns show every card', () => {
    expect(shownCount('done', 32, false)).toBe(10);
    expect(shownCount('cancelled', 32, false, true)).toBe(3);
    expect(shownCount('done', 32, true)).toBe(32);
    expect(shownCount('queued', 32, false)).toBe(32);
    expect(shownCount('done', 4, false)).toBe(4);
  });
});

describe('new since you looked', () => {
  const seen = (c: CompanyView) => seenOf(board(c));

  it('marks nothing on a first visit', () => {
    expect(changedSince(null, seen(cafe())).size).toBe(0);
  });

  it('marks a new card, and one that changed column or owner', () => {
    const before = seen(cafe());
    const c = cafe();
    const after: CompanyView = {
      ...c,
      tasks: [
        ...c.tasks.map((t): Task => (t.id === 't-1' ? { ...t, status: 'working' } : t.id === 't-3' ? { ...t, owner: 'frontend-engineer' } : t)),
        task('t-8', 'ui-designer', 'New one'),
      ],
    };
    expect([...changedSince(before, seen(after))].sort()).toEqual(['t-1', 't-3', 't-8']);
  });

  it('reads what this browser kept as untrusted', () => {
    expect(seenFrom('nonsense')).toBeNull();
    expect(seenFrom([1, 2])).toBeNull();
    const kept = seenFrom(JSON.parse('{"__proto__":"x","t-1":"queued|kai","t-2":7}'));
    expect(kept && Object.keys(kept).sort()).toEqual(['__proto__', 't-1']);
    expect(changedSince(kept, { 't-1': 'queued|kai' }).size).toBe(0);
  });
});

describe('lanes', () => {
  const snapshot = { studio: null };
  const roomName = (room: string) => (room === 'engineering' ? 'Engineering' : room === 'design' ? 'Design' : room);
  const laneIds = (lanes: ReturnType<typeof lanesOf>) => lanes.map((l) => l.key);
  const cardsIn = (cards: readonly Card[]) => cards.map((x) => x.id);

  it('makes a lane per owner with an open task, in the org’s order, with their done tasks', () => {
    const c = cafe({ tasks: [...cafe().tasks, task('t-8', 'qa-engineer', 'Old tests', { status: 'done' })] });
    const lanes = lanesOf(c, snapshot, board(c), 'person', roomName);
    // QA has only done work, so no lane; Kai's lane comes before Mina's, as the org lists them.
    expect(laneIds(lanes)).toEqual(['person:frontend-engineer', 'person:ui-designer']);
    const kai = lanes[0];
    expect(cardsIn(kai?.columns.find((x) => x.id === 'done')?.cards ?? [])).toEqual(['t-5']);
    // The ribbon counts open tasks: the done one rides along in its cell.
    expect(kai?.heading).toBe('Kai, frontend engineer, three tasks');
    expect(kai?.closedLine).toBe('Two queued, one working, one done.');
  });

  it('puts the plan’s card in the CEO’s lane', () => {
    const c: CompanyView = { ...cafe(), steering: companyWithPlan(planView([version(1, plan())])).steering };
    const lanes = lanesOf(c, snapshot, board(c), 'person', roomName);
    expect(lanes[0]?.key).toBe('person:ceo');
    expect(lanes[0]?.heading).toBe('Noor, CEO, no tasks');
    expect(cardsIn(lanes[0]?.columns.find((x) => x.id === 'you')?.cards ?? [])).toEqual(['plan']);
  });

  it('makes a lane per room in People’s order, with No room last for people who left', () => {
    const c = cafe({ tasks: [...cafe().tasks, task('t-9', 'gone-designer', 'Left behind')] });
    const lanes = lanesOf(c, snapshot, board(c), 'room', roomName);
    expect(laneIds(lanes)).toEqual(['room:engineering', 'room:design', 'room:']);
    expect(lanes.map((l) => l.name)).toEqual(['Engineering', 'Design', 'No room']);
  });
});
