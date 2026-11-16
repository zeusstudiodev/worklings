// The task board's arrow keys (docs/design-v3.md, "The keyboard way"): the board is one tab stop with roving focus on
// the cards' links, "And 22 more" and the Cancelled rail. Up and Down run down a column (through the open lanes), Home
// and End go to its ends, Left and Right to the nearest item in the next column that has one (within one lane). Pure;
// the board says which item is nearest on screen.
import type { ColumnId } from './columns.ts';

/** An item focus can rest on: a card ("card:t-12"), a cell's "And 22 more" ("more:<lane>|done"), the Cancelled rail. */
export type ItemKey = string;

export const cardKey = (id: string): ItemKey => `card:${id}`;
export const moreKey = (lane: string, column: ColumnId): ItemKey => `more:${lane}|${column}`;
export const RAIL_KEY: ItemKey = 'rail';

export const cardOfKey = (key: ItemKey): string | null => (key.startsWith('card:') ? key.slice('card:'.length) : null);

/** A column's items, top to bottom, each with the lane it is in ("" without lanes). */
export interface NavColumn {
  column: ColumnId;
  items: readonly { key: ItemKey; lane: string }[];
}

export type Arrow = 'up' | 'down' | 'left' | 'right' | 'home' | 'end';

export const ARROWS: Readonly<Record<string, Arrow>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end' };

/**
 * Where an arrow key moves focus from `at`, or null to stay. `nearest` picks, among items in another column, the one
 * nearest the item focus leaves (by where they are on screen); it is given them in order and may take the first.
 */
export function arrowTo(grid: readonly NavColumn[], at: ItemKey, arrow: Arrow, nearest: (candidates: readonly ItemKey[]) => ItemKey | null): ItemKey | null {
  const ci = grid.findIndex((c) => c.items.some((i) => i.key === at));
  const column = grid[ci];
  if (!column) return null;
  const ii = column.items.findIndex((i) => i.key === at);
  const here = column.items[ii];
  switch (arrow) {
    case 'up':
      return column.items[ii - 1]?.key ?? null;
    case 'down':
      return column.items[ii + 1]?.key ?? null;
    case 'home':
      return ii > 0 ? (column.items[0]?.key ?? null) : null;
    case 'end':
      return ii < column.items.length - 1 ? (column.items.at(-1)?.key ?? null) : null;
    case 'left':
    case 'right': {
      const step = arrow === 'left' ? -1 : 1;
      for (let c = ci + step; c >= 0 && c < grid.length; c += step) {
        const items = grid[c]?.items ?? [];
        // Across the columns within one lane; the rail stands for the whole column.
        const candidates = items.filter((i) => i.key === RAIL_KEY || here === undefined || i.lane === here.lane).map((i) => i.key);
        if (candidates.length > 0) return nearest(candidates) ?? candidates[0] ?? null;
      }
      return null;
    }
  }
}

/** The item that keeps the board's one tab stop: the one asked for while it is on the board, else the first there is. */
export function tabStop(grid: readonly NavColumn[], wanted: ItemKey | null): ItemKey | null {
  const all = grid.flatMap((c) => c.items.map((i) => i.key));
  if (wanted !== null && all.includes(wanted)) return wanted;
  return all[0] ?? null;
}

/**
 * Where focus goes when the card it was on left its place (its task left the board): the card that took its place in
 * the column, else the one before it, else null (the column's heading).
 */
export function tookItsPlace(was: readonly ItemKey[], now: readonly ItemKey[], gone: ItemKey): ItemKey | null {
  const at = was.indexOf(gone);
  if (at < 0) return null;
  const after = was.slice(at + 1).find((k) => now.includes(k));
  if (after) return after;
  return [...was.slice(0, at)].reverse().find((k) => now.includes(k)) ?? null;
}
