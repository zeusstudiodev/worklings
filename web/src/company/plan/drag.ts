// Where a dragged row would land (the plan's tasks, the board's priority): the drop lines between rows, read from the
// page when a drag starts, and the one nearest the pointer. Pure, so it can be tested; useDragMove.ts does the pointer.

/** A place a row can be dropped: the line it draws at, as a y in the scroller's content, and what it means. */
export interface DropLine<S> {
  y: number;
  slot: S;
}

/** The drop line nearest to `y`; the first of two as near. Null with none. */
export function nearestLine<S>(lines: readonly DropLine<S>[], y: number): DropLine<S> | null {
  let best: DropLine<S> | null = null;
  for (const line of lines) if (best === null || Math.abs(line.y - y) < Math.abs(best.y - y)) best = line;
  return best;
}

/** How fast to scroll while a drag holds the pointer near an edge of the scroller: 0 away from them, up to `max` at them. */
export function edgeSpeed(y: number, top: number, bottom: number, band = 48, max = 14): number {
  if (bottom - top < band * 3) return 0;
  if (y < top + band) return -Math.ceil(max * Math.min(1, (top + band - y) / band));
  if (y > bottom - band) return Math.ceil(max * Math.min(1, (y - (bottom - band)) / band));
  return 0;
}
