// Where people walk when they go to meet someone: a coarse grid over the floor plan keeps them out of walls, desks and
// furniture, the shortest way between two spots goes through the doors, and it is straightened into a few stretches.
// Pure geometry, cached per layout, so the cast can plan walks in tests without a browser.
import { deskRects, furnitureRects, type Layout, type Point, type Rect, wallRects, wallsOf } from './layout.ts';

/** Grid cells, in model units. */
const CELL = 0.25;
/** How far a walker's middle keeps from a wall or a desk: about half a person. */
const WALL_CLEARANCE = 0.25;
const DESK_CLEARANCE = 0.15;
/** v2's walking pace in model units a second; a walk takes 0.8 to 2 s by distance (docs/design.md, "Meetings"). */
const SPEED = 7;
export const WALK_MIN_MS = 800;
export const WALK_MAX_MS = 2000;

export function walkMs(length: number): number {
  if (length < 0.05) return 0;
  return Math.round(Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, (length / SPEED) * 1000)));
}

/** v3's pace (docs/game-feel.md, section 1): 3 units a second (1.5 m/s), Walking_A's own speed. */
export const PACE = 3;
/** A longer route speeds up to fit in this long, at most to MAX_PACE; a route longer still is no walk. */
export const MAX_WALK_MS = 6000;
export const MAX_PACE = 7.5;

/** How long a v3 walk takes along a route this long; null when it would need more than MAX_PACE to fit in 6 s. */
export function paceMs(length: number): number | null {
  if (length < 0.05) return 0;
  if (length / MAX_PACE > MAX_WALK_MS / 1000) return null;
  return Math.round(Math.min(MAX_WALK_MS, (length / PACE) * 1000));
}

/** A stretch of walking on the snapshot clock: along `path`, starting at `at`, for `ms`. */
export interface Leg {
  at: number;
  ms: number;
  path: Point[];
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** How far along its path a leg has come at `now`. */
export function walked(leg: Leg, now: number): number {
  const t = leg.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - leg.at) / leg.ms));
  return ease(t) * pathLength(leg.path);
}

export interface Placement extends Point {
  /** The way the walk heads, while walking. */
  heading: number | null;
  /** Away from home: walking, or standing at a meeting between walks. */
  away: boolean;
}

/** Where someone is on the snapshot clock: on a walk, at a meeting between walks, or at home. */
export function placeOn(walk: readonly Leg[], home: Point, now: number): Placement {
  let leg: Leg | undefined;
  for (const l of walk) if (l.at <= now) leg = l;
  if (!leg) return { x: home.x, z: home.z, heading: null, away: false };
  const length = pathLength(leg.path);
  const moving = length > 0 && now < leg.at + leg.ms;
  const p = pointAlong(leg.path, walked(leg, now));
  return { x: p.x, z: p.z, heading: moving ? p.heading : null, away: moving || leg !== walk[walk.length - 1] };
}

interface Grid {
  x0: number;
  z0: number;
  cols: number;
  rows: number;
  /** 1 where a walker's middle can't be. */
  blocked: Uint8Array;
}

function gridFor(layout: Layout): Grid {
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const blocked = new Uint8Array(cols * rows);
  // Blocks every cell whose middle lies within `pad` of the rectangle.
  const block = (r: Rect, pad: number) => {
    const i1 = Math.max(0, Math.ceil((r.x - pad - minX) / CELL - 0.5));
    const i2 = Math.min(cols - 1, Math.floor((r.x + r.w + pad - minX) / CELL - 0.5));
    const j1 = Math.max(0, Math.ceil((r.z - pad - minZ) / CELL - 0.5));
    const j2 = Math.min(rows - 1, Math.floor((r.z + r.d + pad - minZ) / CELL - 0.5));
    for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) blocked[j * cols + i] = 1;
  };
  for (const room of wallsOf(layout)) for (const wall of wallRects(room)) block(wall, WALL_CLEARANCE);
  for (const desk of [...deskRects(layout), ...furnitureRects(layout)]) block(desk, DESK_CLEARANCE);
  return { x0: minX, z0: minZ, cols, rows, blocked };
}

function cellAt(g: Grid, x: number, z: number): number {
  const i = Math.floor((x - g.x0) / CELL);
  const j = Math.floor((z - g.z0) / CELL);
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? -1 : j * g.cols + i;
}

const middleOf = (g: Grid, c: number): Point => ({ x: g.x0 + ((c % g.cols) + 0.5) * CELL, z: g.z0 + (Math.floor(c / g.cols) + 0.5) * CELL });

/** A binary min-heap of cell indices by priority, for the search. */
class Heap {
  private readonly cells: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, key: number) {
    let i = this.cells.length;
    this.cells.push(cell);
    this.keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentKey = this.keys[parent] ?? 0;
      if (parentKey <= key) break;
      this.cells[i] = this.cells[parent] ?? 0;
      this.keys[i] = parentKey;
      i = parent;
    }
    this.cells[i] = cell;
    this.keys[i] = key;
  }

  pop(): number {
    const top = this.cells[0] ?? -1;
    const cell = this.cells.pop() ?? -1;
    const key = this.keys.pop() ?? 0;
    const n = this.cells.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      let smallest = i;
      let smallestKey = key;
      for (const child of [left, left + 1]) {
        const childKey = this.keys[child] ?? 0;
        if (child < n && childKey < smallestKey) {
          smallest = child;
          smallestKey = childKey;
        }
      }
      if (smallest === i) break;
      this.cells[i] = this.cells[smallest] ?? 0;
      this.keys[i] = smallestKey;
      i = smallest;
    }
    this.cells[i] = cell;
    this.keys[i] = key;
    return top;
  }
}

/** A* over the grid, eight ways, never cutting a corner past a wall's end. The cells from start to goal. */
function search(g: Grid, start: number, goal: number): number[] | null {
  const n = g.cols * g.rows;
  const cost = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const goalI = goal % g.cols;
  const goalJ = Math.floor(goal / g.cols);
  const estimate = (c: number) => {
    const di = Math.abs((c % g.cols) - goalI);
    const dj = Math.abs(Math.floor(c / g.cols) - goalJ);
    return Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj);
  };
  // The ends may sit in a blocked cell (a chair behind its desk); everything else must be clear.
  const open = (c: number) => c === start || c === goal || g.blocked[c] === 0;
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, estimate(start));
  while (heap.size > 0) {
    const c = heap.pop();
    if (c === goal) break;
    if (closed[c] === 1) continue;
    closed[c] = 1;
    const ci = c % g.cols;
    const cj = Math.floor(c / g.cols);
    const here = cost[c] ?? Number.POSITIVE_INFINITY;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue;
        const next = nj * g.cols + ni;
        if (closed[next] === 1 || !open(next)) continue;
        const diagonal = di !== 0 && dj !== 0;
        if (diagonal && (!open(cj * g.cols + ni) || !open(nj * g.cols + ci))) continue;
        const through = here + (diagonal ? Math.SQRT2 : 1);
        if (through < (cost[next] ?? Number.POSITIVE_INFINITY)) {
          cost[next] = through;
          from[next] = c;
          heap.push(next, through + estimate(next));
        }
      }
    }
  }
  if (start !== goal && from[goal] === -1) return null;
  const cells = [goal];
  for (let c = goal; c !== start; ) {
    c = from[c] ?? -1;
    if (c < 0) return null;
    cells.push(c);
  }
  return cells.reverse();
}

/** Whether a straight stretch between two points stays on clear floor. */
function inSight(g: Grid, a: Point, b: Point, start: number, goal: number): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 3));
  for (let s = 1; s < steps; s++) {
    const c = cellAt(g, a.x + ((b.x - a.x) * s) / steps, a.z + ((b.z - a.z) * s) / steps);
    if (c < 0 || (c !== start && c !== goal && g.blocked[c] === 1)) return false;
  }
  return true;
}

/** Keeps only the corners a walker needs: from each point, straight on to the farthest one still in sight. */
function straighten(g: Grid, points: Point[], start: number, goal: number): Point[] {
  const first = points[0];
  if (!first) return [];
  const out = [first];
  let i = 0;
  while (i < points.length - 1) {
    const from = points[i] ?? first;
    let j = i + 1;
    for (let next = points[j + 1]; next && inSight(g, from, next, start, goal); next = points[j + 1]) j += 1;
    const corner = points[j];
    if (!corner) break;
    out.push(corner);
    i = j;
  }
  return out;
}

function findRoute(g: Grid, from: Point, to: Point): Point[] | null {
  const start = cellAt(g, from.x, from.z);
  const goal = cellAt(g, to.x, to.z);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [from, to];
  const cells = search(g, start, goal);
  if (!cells) return null;
  const points = cells.map((c) => middleOf(g, c));
  points[0] = from;
  points[points.length - 1] = to;
  return straighten(g, points, start, goal);
}

const cache = new WeakMap<Layout, { grid: Grid; routes: Map<string, Point[] | null> }>();

/** The way from one spot to another around walls and desks, as a few straight stretches; null when there is none. */
export function route(layout: Layout, from: Point, to: Point): Point[] | null {
  let entry = cache.get(layout);
  if (!entry) {
    entry = { grid: gridFor(layout), routes: new Map() };
    cache.set(layout, entry);
  }
  const key = `${from.x.toFixed(2)},${from.z.toFixed(2)}>${to.x.toFixed(2)},${to.z.toFixed(2)}`;
  const known = entry.routes.get(key);
  if (known !== undefined) return known;
  const found = findRoute(entry.grid, from, to);
  entry.routes.set(key, found);
  return found;
}

export function pathLength(path: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

/** The point `distance` along a path, and the way the path heads there as a turn about the vertical axis. */
export function pointAlong(path: readonly Point[], distance: number): Point & { heading: number } {
  let left = Math.max(0, distance);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= length || i === path.length - 1) {
      const t = length > 0 ? Math.min(1, left / length) : 1;
      const heading = Math.atan2(b.x - a.x, b.z - a.z);
      // Land exactly on the corner at the end, so a finished walk ends exactly where it was meant to.
      return t >= 1 - 1e-9 ? { x: b.x, z: b.z, heading } : { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading };
    }
    left -= length;
  }
  const only = path[0] ?? { x: 0, z: 0 };
  return { x: only.x, z: only.z, heading: 0 };
}

/** The stretch of a path between two distances along it, walked backwards when `to` comes before `from`. */
export function subPath(path: readonly Point[], from: number, to: number): Point[] {
  if (to < from) return subPath(path, to, from).reverse();
  const at = (d: number): Point => {
    const p = pointAlong(path, d);
    return { x: p.x, z: p.z };
  };
  const out = [at(from)];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    walked += Math.hypot(b.x - a.x, b.z - a.z);
    if (walked > from && walked < to) out.push(b);
  }
  out.push(at(to));
  return out;
}
