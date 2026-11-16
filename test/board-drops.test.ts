// What a lifted card does where it is let go (web/src/company/tasks/board/drops.ts): the drop table, places in line,
// the keyboard way's steps and Move, as docs/design-v3.md "The task board" defines them.
import { describe, expect, it } from 'vitest';
import { STAKEHOLDER, type Task } from '../src/core/company.ts';
import { type ColumnId, type TaskCard } from '../web/src/company/tasks/board/columns.ts';
import {
  ANSWER_FIRST,
  beforeFor,
  defaultBefore,
  keptBefore,
  liftStep,
  lifts,
  meansOver,
  placed,
  takes,
  movingLine,
  moveItems,
  nextStop,
  nothingFurther,
  orderForDrop,
  PICK_THE_PERSON,
  REFUSED,
  resumeThere,
  startLine,
  startOrder,
  stepBefore,
  wentBack,
} from '../web/src/company/tasks/board/drops.ts';
import { company, min, NOW, task } from './panels-work-kit.ts';

const card = (t: Task, column: ColumnId, place: number | null = 1): TaskCard => ({ kind: 'task', id: t.id, task: t, column, place, waits: null });
const queued = card(task('t-1', 'frontend-engineer', 'Cart summary'), 'queued');
const working = card(task('t-2', 'frontend-engineer', 'Order API', { status: 'working' }), 'working');
const pausedQueued = card(task('t-3', 'frontend-engineer', 'Menu data', { paused: { at: NOW - min(3), by: STAKEHOLDER } }), 'paused');
const blocked = card(task('t-7', 'frontend-engineer', 'Checkout', { status: 'blocked' }), 'blocked');
const waiting = card(task('t-4', 'ui-designer', 'Slot picker', { status: 'working' }), 'you');

describe('the drop table', () => {
  it('orders a card in its own ordered column', () => {
    expect(meansOver(queued, 'queued')).toEqual({ kind: 'order' });
    expect(meansOver(working, 'working')).toEqual({ kind: 'order' });
    expect(meansOver(pausedQueued, 'paused')).toEqual({ kind: 'order' });
  });

  it('lets a card from Waiting for you go back quietly over its own column', () => {
    expect(meansOver(waiting, 'you')).toEqual({ kind: 'back' });
  });

  it('pauses a card dropped on Paused, from Waiting for you too', () => {
    expect(meansOver(queued, 'paused')).toEqual({ kind: 'pause' });
    expect(meansOver(working, 'paused')).toEqual({ kind: 'pause' });
    expect(meansOver(waiting, 'paused')).toEqual({ kind: 'pause' });
  });

  it('resumes a paused card on the column it came from, and refuses the others with where it goes back', () => {
    expect(meansOver(pausedQueued, 'queued')).toEqual({ kind: 'resume' });
    expect(meansOver(pausedQueued, 'working')).toEqual({ kind: 'refused', reason: resumeThere('queued') });
    expect(resumeThere('queued')).toBe('It goes back to Queued: drop it there to resume it.');
  });

  it('opens the cancel form for any open card dropped on Cancelled', () => {
    for (const c of [queued, working, pausedQueued, waiting]) expect(meansOver(c, 'cancelled')).toEqual({ kind: 'cancel' });
  });

  it('starts a queued card next when it is dropped on Working: it jumps to the front, so it no longer refuses (was: refused)', () => {
    expect(meansOver(queued, 'working')).toEqual({ kind: 'start' });
    expect(takes({ kind: 'start' })).toBe(true);
    expect(placed({ kind: 'start' })).toBe(false);
    // A paused card resumes where it came from; blocked, review and working cards still don't go to Working.
    expect(meansOver(pausedQueued, 'working')).toEqual({ kind: 'refused', reason: resumeThere('queued') });
    expect(meansOver(blocked, 'working')).toEqual({ kind: 'refused', reason: REFUSED.working });
  });

  it('refuses every other column with its own reason', () => {
    expect(meansOver(queued, 'blocked')).toEqual({ kind: 'refused', reason: 'Tasks get here by themselves as the work goes.' });
    expect(meansOver(queued, 'review')).toEqual({ kind: 'refused', reason: 'Tasks get here by themselves as the work goes.' });
    expect(meansOver(queued, 'done')).toEqual({ kind: 'refused', reason: 'Done tasks stay done.' });
    expect(meansOver(queued, 'you')).toEqual({ kind: 'refused', reason: 'Cards land here when someone needs you.' });
    expect(meansOver(working, 'queued')).toEqual({ kind: 'refused', reason: "Started tasks don't go back to Queued." });
    expect(REFUSED.done).toBe('Done tasks stay done.');
  });

  it('asks for an answer before a card leaves Waiting for you for any other column', () => {
    for (const column of ['queued', 'working', 'blocked', 'review', 'done'] as const) expect(meansOver(waiting, column)).toEqual({ kind: 'refused', reason: ANSWER_FIRST });
  });

  it('reassigns a card dropped anywhere in another person’s lane, and reads its own lane as no lanes', () => {
    const kai = { kind: 'person', person: 'frontend-engineer' } as const;
    const mina = { kind: 'person', person: 'ui-designer' } as const;
    expect(meansOver(queued, 'done', kai, mina)).toEqual({ kind: 'reassign', to: 'ui-designer' });
    expect(meansOver(queued, 'queued', kai, mina)).toEqual({ kind: 'reassign', to: 'ui-designer' });
    expect(meansOver(queued, 'queued', kai, kai)).toEqual({ kind: 'order' });
  });

  it('refuses a drop across rooms under Group: Room', () => {
    expect(meansOver(queued, 'queued', { kind: 'room', room: 'engineering' }, { kind: 'room', room: 'design' })).toEqual({ kind: 'refused', reason: PICK_THE_PERSON });
  });

  it('lifts only open tasks’ cards', () => {
    expect(lifts(queued)).toBe(true);
    expect(lifts(card(task('t-9', 'a', 'Done', { status: 'done' }), 'done', null))).toBe(false);
    expect(lifts(card(task('t-9', 'a', 'Gone', { status: 'dropped' }), 'cancelled', null))).toBe(false);
    expect(lifts({ kind: 'plan', id: 'plan', version: 3, title: 'The plan', line: 'Waits.', at: NOW })).toBe(false);
  });
});

describe('a place in line', () => {
  // The whole order, and Queued's cards within it.
  const order = ['a', 'w1', 'b', 'w2', 'c', 'd'];
  const column = ['a', 'b', 'c', 'd'];

  it('lands before the card it is dropped above', () => {
    expect(orderForDrop(order, column, 'd', 'b')).toEqual(['a', 'w1', 'd', 'b', 'w2', 'c']);
  });

  it('lands right after the column’s last card in the whole order when dropped below it', () => {
    expect(orderForDrop(order, column, 'a', null)).toEqual(['w1', 'b', 'w2', 'c', 'd', 'a']);
    expect(orderForDrop(['a', 'b', 'x', 'y'], ['a', 'b'], 'a', null)).toEqual(['b', 'a', 'x', 'y']);
  });

  it('sends nothing when the card lands where it is', () => {
    expect(orderForDrop(order, column, 'b', 'c')).toBeNull();
    expect(orderForDrop(order, column, 'd', null)).toBeNull();
    expect(orderForDrop(order, column, 'b', 'b')).toBeNull();
  });

  it('lands before the card it lands above with filters on, among the cards the column shows', () => {
    expect(orderForDrop(order, ['a', 'c'], 'c', 'a')).toEqual(['c', 'a', 'w1', 'b', 'w2', 'd']);
  });

  it('starts a lifted card at its own place, and a resuming one where its place already falls', () => {
    expect(defaultBefore(order, column, 'b')).toBe('c');
    expect(defaultBefore(order, column, 'd')).toBeNull();
    expect(defaultBefore(['a', 'p', 'b'], ['a', 'b'], 'p')).toBe('b');
  });

  it('steps up and down among the places and stays at the ends', () => {
    expect(stepBefore(column, 'b', 'c', -1)).toBe('a');
    expect(stepBefore(column, 'b', 'a', -1)).toBe('a');
    expect(stepBefore(column, 'b', 'c', 1)).toBe('d');
    expect(stepBefore(column, 'b', 'd', 1)).toBeNull();
    expect(stepBefore(column, 'b', null, 1)).toBeNull();
  });
});

describe('start next', () => {
  it('puts the card first in the whole open order, or sends nothing when it already is', () => {
    expect(startOrder(['t-2', 't-3', 't-1'], 't-1')).toEqual(['t-1', 't-2', 't-3']);
    expect(startOrder(['t-1', 't-2'], 't-1')).toBeNull();
    expect(startOrder(['t-2'], 't-1')).toBeNull();
  });

  it('says whether it starts now or after the owner’s current task', () => {
    expect(startLine(company({ tasks: [queued.task] }), queued.task)).toBe('Starts now.');
    expect(startLine(company({ tasks: [queued.task, working.task] }), queued.task)).toBe('Next for Kai, after “Order API”.');
    expect(startLine(company({ tasks: [queued.task, { ...working.task, owner: 'ui-designer' }] }), queued.task)).toBe('Starts now.');
  });
});

describe('the keyboard way', () => {
  const stops = (['you', 'queued', 'working', 'paused', 'blocked', 'review', 'done', 'cancelled'] as const).map((column) => ({ column, lane: null }));

  it('goes to the next column that takes it, saying why it skipped the others', () => {
    const right = nextStop(queued, null, stops, 1, 1);
    expect(right?.index).toBe(2);
    expect(right?.means).toEqual({ kind: 'start' });
    expect(right?.skipped).toEqual([]);
    const past = nextStop(queued, null, stops, 2, 1);
    expect(past?.index).toBe(3);
    expect(past?.means).toEqual({ kind: 'pause' });
    expect(nextStop(queued, null, stops, 3, 1)?.index).toBe(7);
  });

  it('finds nothing further when no column that way takes it', () => {
    expect(nextStop(queued, null, stops, 1, -1)).toBeNull();
    expect(nothingFurther(-1)).toBe('Nothing further left takes it.');
  });

  it('says each step in words', () => {
    const c = company({ tasks: [queued.task, working.task, task('t-5', 'ui-designer', 'Pickup slot picker'), task('t-6', 'ui-designer', 'Menu')] });
    const column = ['t-6', 't-1', 't-5'];
    expect(liftStep(c, queued, { kind: 'order' }, { column: 'queued', lane: null, before: 't-5' }, column)).toBe('Before Pickup slot picker, second of three in Queued.');
    expect(liftStep(c, queued, { kind: 'order' }, { column: 'queued', lane: null, before: null }, column)).toBe('After Pickup slot picker, last of three in Queued.');
    expect(liftStep(c, queued, { kind: 'pause' }, { column: 'paused', lane: null, before: null }, [], [{ column: 'working', reason: 'Tasks reach Working when their owner starts them.' }])).toBe(
      'Over Paused: dropping it here pauses it. Skipped Working: tasks reach Working when their owner starts them.',
    );
    expect(liftStep(c, queued, { kind: 'start' }, { column: 'working', lane: null, before: null }, [])).toBe('Over Working: dropping it here starts it next. Next for Kai, after “Order API”.');
    expect(liftStep(company({ tasks: [queued.task] }), queued, { kind: 'start' }, { column: 'working', lane: null, before: null }, [])).toBe('Over Working: dropping it here starts it next. Starts now.');
    expect(liftStep(c, queued, { kind: 'reassign', to: 'ui-designer' }, { column: 'queued', lane: { kind: 'person', person: 'ui-designer' }, before: null }, [])).toBe('Over Mina\'s lane: dropping it here reassigns it to Mina.');
    expect(movingLine(queued.task)).toBe('Moving “Cart summary”. Arrow keys move it, Space puts it here, Escape puts it back.');
  });

  it('counts fourth of 14 among a column’s cards', () => {
    const others = Array.from({ length: 13 }, (_, i) => task(`o-${i}`, 'ui-designer', `Other ${i}`));
    const c = company({ tasks: [queued.task, ...others] });
    const column = others.map((t) => t.id);
    expect(liftStep(c, queued, { kind: 'order' }, { column: 'queued', lane: null, before: 'o-3' }, column)).toBe('Before Other 3, fourth of 14 in Queued.');
  });
});

describe('the company goes on while a card is lifted', () => {
  const c = company();

  it('sends the card back with why when its task changed', () => {
    expect(wentBack(c, queued, { ...queued, column: 'working' })).toBe('“Cart summary” started meanwhile, so it went back.');
    expect(wentBack(c, queued, { ...queued, column: 'cancelled' })).toBe('“Cart summary” was cancelled meanwhile, so it went back.');
    expect(wentBack(c, queued, { ...queued, task: { ...queued.task, owner: 'ui-designer' } })).toBe('“Cart summary” went to Mina meanwhile, so it went back.');
    expect(wentBack(c, queued, null)).toBe('“Cart summary” left the board, so the move ended.');
  });

  it('keeps going while nothing about its task changed', () => {
    expect(wentBack(c, queued, { ...queued, place: 4 })).toBeNull();
  });

  it('keeps its place by the card it lands before; the next one holds it when that card leaves', () => {
    expect(keptBefore('b', ['a', 'b', 'c'], ['a', 'b', 'c', 'x'])).toBe('b');
    expect(keptBefore('b', ['a', 'b', 'c'], ['a', 'c'])).toBe('c');
    expect(keptBefore('b', ['a', 'b'], ['a'])).toBeNull();
  });
});

describe('Move', () => {
  const column = ['t-0', 't-1', 't-2'];
  const labels = (items: ReturnType<typeof moveItems>) => items.map((i) => i.label);

  it('offers every move in the middle of an ordered column', () => {
    expect(labels(moveItems(queued, column, true))).toEqual(['Start next', 'Move to the top', 'Up', 'Down', 'Move to the bottom', 'Pick up', 'Pause', 'Reassign…', 'Cancel the task…', 'Open']);
  });

  it('leaves out the moves that can’t apply at the ends', () => {
    expect(labels(moveItems(queued, ['t-1', 't-2'], true))).toEqual(['Start next', 'Down', 'Move to the bottom', 'Pick up', 'Pause', 'Reassign…', 'Cancel the task…', 'Open']);
    expect(labels(moveItems(queued, ['t-0', 't-1'], true)).slice(1, 3)).toEqual(['Move to the top', 'Up']);
  });

  it('offers Resume on a paused card, no places in Waiting for you, and no Pick up where cards don’t lift', () => {
    expect(labels(moveItems(pausedQueued, ['t-3'], true))).toContain('Resume');
    expect(labels(moveItems(waiting, ['t-4'], true))).toEqual(['Pick up', 'Pause', 'Reassign…', 'Cancel the task…', 'Open']);
    expect(labels(moveItems(queued, column, false))).not.toContain('Pick up');
  });

  it('lands each move before the right card', () => {
    expect(beforeFor('top', column, 't-1')).toBe('t-0');
    expect(beforeFor('up', column, 't-1')).toBe('t-0');
    expect(beforeFor('down', column, 't-1')).toBeNull();
    expect(beforeFor('down', ['t-1', 't-2', 't-3'], 't-1')).toBe('t-3');
    expect(beforeFor('bottom', column, 't-1')).toBeNull();
  });
});
