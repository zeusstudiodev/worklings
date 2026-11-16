// The board's lanes (docs/design-v3.md, "The task board", "Filters and grouping"): Group: Person makes a lane per owner
// with open tasks, in the org's order; Group: Room a lane per room, in People's order. Each lane is a row of the status
// columns under the same column heads. Pure, so it can be tested.
import { type CompanyView, introduce, type PersonView } from '../../../../../src/core/company.ts';
import { countWord } from '../../../../../src/core/now.ts';
import type { Snapshot } from '../../../../../src/core/snapshot.ts';
import { capital } from '../../../../../src/core/words.ts';
import { flatten, nameOf, orgOutline } from '../../people/peopleModel.ts';
import { isOpenTask } from '../boardModel.ts';
import { type BoardView, type Card, type ColumnId, type ColumnView } from './columns.ts';
import { type LaneOf, laneKey } from './drops.ts';

export interface LaneView {
  of: LaneOf;
  /** "person:kai", "room:design". */
  key: string;
  /** Its name on the head: "Noah, backend engineer"; "Engineering". */
  name: string;
  /** The person a Person lane is, for the face; null for a room, or someone who left. */
  person: PersonView | null;
  /** Its open tasks: what the ribbon counts. */
  count: number;
  /** The head's heading: "Noah, backend engineer, three tasks". */
  heading: string;
  /** What a closed lane keeps, a count per column: "One waits for you, one queued, one working." */
  closedLine: string;
  columns: ColumnView[];
}

const COUNTED: Readonly<Record<ColumnId, (n: number) => string>> = {
  you: (n) => `${countWord(n)} ${n === 1 ? 'waits' : 'wait'} for you`,
  queued: (n) => `${countWord(n)} queued`,
  working: (n) => `${countWord(n)} working`,
  paused: (n) => `${countWord(n)} paused`,
  blocked: (n) => `${countWord(n)} blocked`,
  review: (n) => `${countWord(n)} in review`,
  done: (n) => `${countWord(n)} done`,
  cancelled: (n) => `${countWord(n)} cancelled`,
};

/** "One waits for you, one queued, one working." */
export function closedLine(columns: readonly ColumnView[]): string {
  const parts = columns.filter((c) => c.cards.length > 0).map((c) => COUNTED[c.id](c.cards.length));
  return parts.length === 0 ? 'Nothing here.' : `${capital(parts.join(', '))}.`;
}

/** Whether a card is work still to do: an open task, or the plan waiting for you. */
const open = (card: Card): boolean => card.kind === 'plan' || isOpenTask(card.task);

const openTasks = (columns: readonly ColumnView[]) => columns.reduce((n, c) => n + c.cards.filter((x) => x.kind === 'task' && isOpenTask(x.task)).length, 0);

function lane(of: LaneOf, name: string, person: PersonView | null, columns: ColumnView[]): LaneView {
  const count = openTasks(columns);
  return { of, key: laneKey(of), name, person, count, heading: `${capital(name)}, ${count === 0 ? 'no' : countWord(count)} ${count === 1 ? 'task' : 'tasks'}`, closedLine: closedLine(columns), columns };
}

/** Who a card belongs to: a task's owner; the plan's card is the CEO's. */
function ownerOf(company: Pick<CompanyView, 'people'>, card: Card): string | null {
  if (card.kind === 'task') return card.task.owner;
  return company.people.find((p) => p.level === 'ceo')?.id ?? null;
}

/**
 * The board in lanes. Person: a lane per owner with an open task on the board (as filtered), in the org's order, then
 * anyone who left; their done and cancelled tasks go with them. Room: a lane per room with an open task, in People's
 * order, and "No room" last for the open tasks of people who left. The plan's card, while it waits, is the CEO's.
 */
export function lanesOf(company: CompanyView, snapshot: Pick<Snapshot, 'studio'>, board: Pick<BoardView, 'columns'>, group: 'person' | 'room', roomName: (room: string) => string): LaneView[] {
  const org = flatten(orgOutline(snapshot, company)).map((n) => n.person);
  const cards = board.columns.flatMap((c) => c.cards);
  const split = (belongs: (card: Card) => boolean): ColumnView[] => board.columns.map((c) => ({ ...c, cards: c.cards.filter(belongs) }));

  if (group === 'person') {
    const withWork = new Set<string>();
    for (const card of cards) {
      const owner = ownerOf(company, card);
      if (owner !== null && open(card)) withWork.add(owner);
    }
    const order = [...org.map((p) => p.id).filter((id) => withWork.has(id)), ...[...withWork].filter((id) => !org.some((p) => p.id === id))];
    return order.map((id) => {
      const person = company.people.find((p) => p.id === id) ?? null;
      const name = person ? introduce(person) : nameOf(company, id).introduced;
      return lane({ kind: 'person', person: id }, name, person, split((card) => ownerOf(company, card) === id));
    });
  }

  const roomOf = (card: Card): string => {
    const owner = ownerOf(company, card);
    return company.people.find((p) => p.id === owner)?.room ?? '';
  };
  const present = new Set(cards.filter(open).map(roomOf));
  const rooms = [...new Set([...org.map((p) => p.room), ...cards.map(roomOf)])].filter((r) => present.has(r)).sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0));
  return rooms.map((room) => lane({ kind: 'room', room }, room === '' ? 'No room' : roomName(room), null, split((card) => roomOf(card) === room)));
}

/** The lane a card is in. */
export function laneOfCard(company: Pick<CompanyView, 'people'>, card: Card, group: 'none' | 'person' | 'room'): LaneOf | null {
  if (group === 'none') return null;
  const owner = ownerOf(company, card);
  if (group === 'person') return owner === null ? null : { kind: 'person', person: owner };
  return { kind: 'room', room: company.people.find((p) => p.id === owner)?.room ?? '' };
}
