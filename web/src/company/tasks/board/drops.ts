// What a lifted card does where it is let go (docs/design-v3.md, "The task board": the drop table, the keyboard way and
// Move), whether it is carried by the pointer, by the arrow keys or picked from the Move menu, and what is said at each
// step. Pure, so it can be tested; useCardDrag.ts, useLift.ts and MoveMenu.tsx drive it.
import type { CompanyView, Task } from '../../../../../src/core/company.ts';
import { countWord, plainText } from '../../../../../src/core/now.ts';
import { nameOf } from '../../people/peopleModel.ts';
import { named, placeWord } from '../../plan/planEdit.ts';
import { dropInOrder, isOpenTask } from '../boardModel.ts';
import { type Card, type ColumnId, columnTitle, homeOf, ORDERED, type TaskCard } from './columns.ts';

/** A lane under Group: Person or Group: Room; null without grouping. */
export type LaneOf = { kind: 'person'; person: string } | { kind: 'room'; room: string };

/** A lane as a key, for lookups and DOM data: "person:kai", "room:design"; "" without grouping. */
export const laneKey = (lane: LaneOf | null): string => (lane === null ? '' : lane.kind === 'person' ? `person:${lane.person}` : `room:${lane.room}`);

/** What letting a lifted card go over a column means. */
export type Means =
  /** In its own ordered column: a new place in line. */
  | { kind: 'order' }
  | { kind: 'pause' }
  /** A queued card over Working: it jumps to the front of the open order, so it starts as soon as its owner is free. */
  | { kind: 'start' }
  /** A paused card over the column it came from: resume, at that place in line. */
  | { kind: 'resume' }
  /** The cancel form, under the card in Cancelled. */
  | { kind: 'cancel' }
  /** The reassign form, under the card in another person's lane. */
  | { kind: 'reassign'; to: string }
  /** Its own column, which isn't ordered (Waiting for you): it goes back quietly. */
  | { kind: 'back' }
  /** The column sinks and says why. */
  | { kind: 'refused'; reason: string };

/** Why each column refuses a card that can't go there (a card's own column never does). */
export const REFUSED: Readonly<Record<'you' | 'queued' | 'working' | 'blocked' | 'review' | 'done', string>> = {
  you: 'Cards land here when someone needs you.',
  queued: "Started tasks don't go back to Queued.",
  working: 'Tasks reach Working when their owner starts them.',
  blocked: 'Tasks get here by themselves as the work goes.',
  review: 'Tasks get here by themselves as the work goes.',
  done: 'Done tasks stay done.',
};

/** A card out of Waiting for you moves on when it is answered. */
export const ANSWER_FIRST = 'Answer it to move it on.';
/** Group: Room is for reading: a drop across rooms names no one to take the task. */
export const PICK_THE_PERSON = 'Pick the person: group by person, or use Reassign.';
/** A paused card goes back where it came from. */
export const resumeThere = (home: ColumnId): string => `It goes back to ${columnTitle(home)}: drop it there to resume it.`;

/** Whether a card can be lifted at all: an open task's. Done, Cancelled and the plan's card never lift. */
export const lifts = (card: Card): card is TaskCard => card.kind === 'task' && isOpenTask(card.task);

/**
 * What letting `card` go over `column` means. With lanes, `from` is the card's lane and `to` the lane it is over: under
 * Group: Person a drop in another person's lane reassigns, whatever the column; under Group: Room a drop across rooms is
 * refused. In its own lane a column means what it means without lanes.
 */
export function meansOver(card: TaskCard, column: ColumnId, from: LaneOf | null = null, to: LaneOf | null = null): Means {
  if (from && to && laneKey(from) !== laneKey(to)) {
    if (to.kind === 'person') return { kind: 'reassign', to: to.person };
    return { kind: 'refused', reason: PICK_THE_PERSON };
  }
  const t = card.task;
  if (column === card.column) return ORDERED.has(column) ? { kind: 'order' } : { kind: 'back' };
  if (column === 'cancelled') return { kind: 'cancel' };
  if (column === 'working' && card.column === 'queued') return { kind: 'start' };
  if (card.column === 'paused') return column === homeOf(t) ? { kind: 'resume' } : { kind: 'refused', reason: resumeThere(homeOf(t)) };
  // A card held in Waiting for you while paused is paused already: answering is what moves it on.
  if (column === 'paused') return t.paused ? { kind: 'refused', reason: ANSWER_FIRST } : { kind: 'pause' };
  if (card.column === 'you') return { kind: 'refused', reason: ANSWER_FIRST };
  return { kind: 'refused', reason: REFUSED[column] };
}

/** A column takes the card (it lights under it) unless it refuses it, or is its own unordered column. */
export const takes = (m: Means): boolean => m.kind !== 'refused' && m.kind !== 'back';
/** Places a card can land between: a column that takes it in line. */
export const placed = (m: Means): boolean => m.kind === 'order' || m.kind === 'resume';

// ---------------------------------------------------------------------------------------------------------------
// Start next

/** The whole open order with `id` first, or null when it already is (nothing to send). */
export function startOrder(order: readonly string[], id: string): string[] | null {
  if (order[0] === id || !order.includes(id)) return null;
  return [id, ...order.filter((x) => x !== id)];
}

/**
 * What jumping to the front means for its owner: "Starts now." when they are free, else "Next for Kai, after “Cart
 * summary”." (the task they are on).
 */
export function startLine(company: Pick<CompanyView, 'tasks' | 'people'>, task: Pick<Task, 'id' | 'owner'>): string {
  const busy = company.tasks.find((t) => t.owner === task.owner && t.id !== task.id && t.status === 'working' && !t.paused);
  return busy ? `Next for ${nameOf(company, task.owner).called}, after ${named(busy.title)}.` : 'Starts now.';
}

// ---------------------------------------------------------------------------------------------------------------
// A place in line

/**
 * The whole order after `id` lands before `before` in a column showing `column` (its cards' ids, in order; with filters
 * on, those that match), or at the column's end with null: right after the column's last card in the whole order. Null
 * when it lands where it already is, so nothing is sent.
 */
export function orderForDrop(order: readonly string[], column: readonly string[], id: string, before: string | null): string[] | null {
  if (before === id) return null;
  const at = column.indexOf(id);
  if (at >= 0 && (before === null ? at === column.length - 1 : column[at + 1] === before)) return null;
  if (before !== null) return dropInOrder(order, id, before);
  const others = column.filter((x) => x !== id);
  const last = others.at(-1);
  if (last === undefined) return null;
  const rest = order.filter((x) => x !== id);
  const i = rest.indexOf(last);
  if (i < 0) return null;
  return dropInOrder(order, id, rest[i + 1] ?? null);
}

/**
 * Where a card lands by default when it enters a column it takes in line: its own place in its own column; in the
 * column a paused card came from, where its place in line already falls, so resuming alone changes nothing.
 */
export function defaultBefore(order: readonly string[], column: readonly string[], id: string): string | null {
  const own = column.indexOf(id);
  if (own >= 0) return column[own + 1] ?? null;
  const place = order.indexOf(id);
  if (place < 0) return null;
  return column.find((x) => {
    const p = order.indexOf(x);
    return p >= 0 && p > place;
  }) ?? null;
}

/** One step up or down among a column's places: the card it would land before after the step. */
export function stepBefore(column: readonly string[], id: string, before: string | null, step: -1 | 1): string | null {
  const others = column.filter((x) => x !== id);
  const slots: (string | null)[] = [...others, null];
  const at = before === null ? others.length : Math.max(0, others.indexOf(before));
  const next = Math.min(slots.length - 1, Math.max(0, at + step));
  return slots[next] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// The keyboard way: the next column it can go to

export interface ColumnStop {
  column: ColumnId;
  lane: LaneOf | null;
}

/**
 * The next column it can go to, left or right of where it is, and the columns skipped on the way with their reasons.
 * `stops` lists the columns in reading order (in a lane, that lane's). Null when nothing further that way takes it.
 */
export function nextStop(card: TaskCard, from: LaneOf | null, stops: readonly ColumnStop[], at: number, step: -1 | 1): { index: number; means: Means; skipped: { column: ColumnId; reason: string }[] } | null {
  const skipped: { column: ColumnId; reason: string }[] = [];
  for (let i = at + step; i >= 0 && i < stops.length; i += step) {
    const stop = stops[i];
    if (!stop) break;
    const means = meansOver(card, stop.column, from, stop.lane);
    if (means.kind === 'refused') skipped.push({ column: stop.column, reason: means.reason });
    else return { index: i, means, skipped };
  }
  return null;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const titleOf = (company: Pick<CompanyView, 'tasks'>, id: string) => plainText(company.tasks.find((t) => t.id === id)?.title ?? '');

/** Where a lifted card is: the column (and lane) it would land in and, in a column ordered for it, the card it lands before. */
export interface LiftAt {
  column: ColumnId;
  lane: LaneOf | null;
  before: string | null;
}

/**
 * What a lifted card's step says, replaced at every step: "Before Pickup slot picker, fourth of 14 in Queued.", "Over
 * Paused: dropping it here pauses it. Skipped Working: tasks reach Working when their owner starts them." `laneName` says
 * which lane with lanes ("Mina's lane", "the Design lane").
 */
export function liftStep(company: Pick<CompanyView, 'tasks' | 'people'>, card: TaskCard, means: Means, at: LiftAt, column: readonly string[], skipped: readonly { column: ColumnId; reason: string }[] = [], laneName: string | null = null): string {
  const title = columnTitle(at.column);
  const where = laneName ? `${title}, in ${laneName}` : title;
  const others = column.filter((x) => x !== card.id);
  let said: string;
  switch (means.kind) {
    case 'order':
    case 'resume': {
      const n = others.length + 1;
      const i = at.before === null ? others.length : Math.max(0, others.indexOf(at.before));
      const place =
        others.length === 0
          ? `The only card in ${where}.`
          : at.before === null
            ? `After ${titleOf(company, others.at(-1) ?? '')}, last of ${countWord(n)} in ${where}.`
            : `Before ${titleOf(company, at.before)}, ${placeWord(i + 1)} of ${countWord(n)} in ${where}.`;
      said = means.kind === 'resume' ? `${place} Dropping it here resumes it.` : place;
      break;
    }
    case 'pause':
      said = `Over ${where}: dropping it here pauses it.`;
      break;
    case 'start':
      said = `Over ${where}: dropping it here starts it next. ${startLine(company, card.task)}`;
      break;
    case 'cancel':
      said = `Over ${where}: dropping it here asks why, then cancels it.`;
      break;
    case 'reassign': {
      const who = nameOf(company, means.to).called;
      said = `Over ${who}'s lane: dropping it here reassigns it to ${who}.`;
      break;
    }
    case 'back':
      said = `Back over ${where}, where it came from.`;
      break;
    case 'refused':
      said = `Over ${where}: ${lowerFirst(means.reason)}`;
      break;
  }
  const skips = skipped.map((s) => ` Skipped ${columnTitle(s.column)}: ${lowerFirst(s.reason)}`).join('');
  return `${said}${skips}`;
}

/** The row under the board's header while a card is lifted by the keyboard. */
export const movingLine = (t: Pick<Task, 'title'>): string => `Moving ${named(t.title)}. Arrow keys move it, Space puts it here, Escape puts it back.`;

/** Said when the arrow keys find nothing further that way. */
export const nothingFurther = (step: -1 | 1): string => `Nothing further ${step < 0 ? 'left' : 'right'} takes it.`;

// ---------------------------------------------------------------------------------------------------------------
// The company goes on while a card is lifted

/**
 * Why a lifted card went back because the company changed under it, or null while the drop is still possible: its task
 * started, finished, was cancelled, paused, resumed or reassigned, or now waits for you. `was` is the card when it was
 * lifted; `now` the card as the board draws it now, null once it has left the board.
 */
export function wentBack(company: Pick<CompanyView, 'people'>, was: TaskCard, now: TaskCard | null): string | null {
  if (!now) return `${named(was.task.title)} left the board, so the move ended.`;
  if (now.task.owner !== was.task.owner) return `${named(was.task.title)} went to ${nameOf(company, now.task.owner).called} meanwhile, so it went back.`;
  if (now.column === was.column) return null;
  const what: Record<ColumnId, string> = {
    you: 'now waits for you',
    queued: was.column === 'paused' ? 'was resumed meanwhile' : 'went back to Queued meanwhile',
    working: was.column === 'paused' ? 'was resumed meanwhile' : 'started meanwhile',
    paused: 'was paused meanwhile',
    blocked: was.column === 'paused' ? 'was resumed meanwhile' : 'was blocked meanwhile',
    review: was.column === 'paused' ? 'was resumed meanwhile' : 'went to review meanwhile',
    done: 'was done meanwhile',
    cancelled: 'was cancelled meanwhile',
  };
  return `${named(was.task.title)} ${what[now.column]}, so it went back.`;
}

/**
 * The card a lifted card lands before, kept by that card rather than a count: if it left the column, the next one that
 * is still there holds the place (`was` is the column's cards as last seen), else the end.
 */
export function keptBefore(before: string | null, was: readonly string[], now: readonly string[]): string | null {
  if (before === null || now.includes(before)) return before;
  const at = was.indexOf(before);
  if (at < 0) return null;
  return was.slice(at + 1).find((id) => now.includes(id)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Move

export type MoveAction = 'start' | 'top' | 'up' | 'down' | 'bottom' | 'pick' | 'pause' | 'resume' | 'reassign' | 'cancel' | 'open';

export interface MoveItem {
  action: MoveAction;
  label: string;
  danger?: boolean;
}

/**
 * Move's items for an open task's card, in today's words: its place in its column (left out where they can't apply,
 * and in Waiting for you, which isn't ordered), Pick up where cards lift (not on phones), Pause or Resume, Reassign…,
 * Cancel the task…, Open. `column` is the column's cards' ids as shown.
 */
export function moveItems(card: TaskCard, column: readonly string[], canPick: boolean): MoveItem[] {
  const items: MoveItem[] = [];
  const i = column.indexOf(card.id);
  if (card.column === 'queued' && !card.task.paused) items.push({ action: 'start', label: 'Start next' });
  if (ORDERED.has(card.column) && i >= 0) {
    if (i > 0) items.push({ action: 'top', label: 'Move to the top' }, { action: 'up', label: 'Up' });
    if (i < column.length - 1) items.push({ action: 'down', label: 'Down' }, { action: 'bottom', label: 'Move to the bottom' });
  }
  if (canPick) items.push({ action: 'pick', label: 'Pick up' });
  items.push(card.task.paused ? { action: 'resume', label: 'Resume' } : { action: 'pause', label: 'Pause' });
  items.push({ action: 'reassign', label: 'Reassign…' }, { action: 'cancel', label: 'Cancel the task…', danger: true }, { action: 'open', label: 'Open' });
  return items;
}

/** The card a move in its column lands before: Move to the top, Up, Down, Move to the bottom. */
export function beforeFor(action: 'top' | 'up' | 'down' | 'bottom', column: readonly string[], id: string): string | null {
  const i = column.indexOf(id);
  switch (action) {
    case 'top':
      return column[0] ?? null;
    case 'up':
      return column[i - 1] ?? null;
    case 'down':
      return column[i + 2] ?? null;
    case 'bottom':
      return null;
  }
}
