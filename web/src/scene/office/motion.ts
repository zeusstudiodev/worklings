// How the office's own parts move in the moments (docs/game-feel.md, section 6), on the scene clock: a room building
// in (its floor, then its walls, then its furniture a piece at a time), a new desk dropping in with a squash, a room
// taken out (its furniture lifting away and its floor lowering), and the org board's pins popping in and out. Pure
// timing: the moments (moments.ts) say when; this says where each part is at a moment.
import { BUILD_FLOOR_MS, BUILD_PIECE_MS, BUILD_WALLS_MS, DESK_DROP_MS, PIN_POP_MS, ROOM_OUT_MS } from '../moments.ts';
import type { Element } from './build.ts';
import type { DeskPlan } from './plan.ts';

/** Where a part is at a moment: hidden, or raised by `y` and scaled. */
export interface Pose {
  visible: boolean;
  y: number;
  sx: number;
  sy: number;
  sz: number;
}

export const STILL: Pose = { visible: true, y: 0, sx: 1, sy: 1, sz: 1 };
const HIDDEN: Pose = { visible: false, y: 0, sx: 1, sy: 1, sz: 1 };
/** A desk falls from this high; a room's furniture lifts this high as it goes. */
const DROP_FROM = 3.2;
const LIFT_TO = 3.0;
/** The squash a desk lands with, and how long it takes to spring back. */
const SQUASH = 0.8;
const SQUASH_MS = 160;
/** A piece of furniture grows into place this fast. */
const POP_MS = 220;
/** The furniture of a room takes at most this long to build in after its walls, however much there is. */
const FURNITURE_MS = 6 * BUILD_PIECE_MS;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t;
/** Out with a small overshoot, so a piece settles into place. */
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

/** When a room's piece of furniture starts building in: one after another, all in within the room's time. */
export function pieceStart(roomAt: number, order: number, count: number): number {
  const gap = Math.min(BUILD_PIECE_MS, FURNITURE_MS / Math.max(1, count));
  return roomAt + BUILD_FLOOR_MS + BUILD_WALLS_MS + order * gap;
}

/** A new desk falling for DESK_DROP_MS from `at`, landing with a squash. */
export function dropPose(at: number, now: number): Pose {
  if (now < at) return HIDDEN;
  if (now < at + DESK_DROP_MS) {
    const t = clamp01((now - at) / DESK_DROP_MS);
    return { ...STILL, y: DROP_FROM * (1 - easeIn(t)) };
  }
  const t = clamp01((now - at - DESK_DROP_MS) / SQUASH_MS);
  const sy = SQUASH + (1 - SQUASH) * easeOut(t);
  const wide = 1 + (1 - sy) * 0.5;
  return { ...STILL, sx: wide, sy, sz: wide };
}

/**
 * A part of a room building in from `roomAt`: the floor over BUILD_FLOOR_MS, the walls over the next BUILD_WALLS_MS,
 * then each piece in its turn; a desk falls in when the moments drop it (`drop`).
 */
export function buildingPose(element: Element, roomAt: number, now: number, count: number, drop: number | null): Pose {
  if (element.kind === 'floor') {
    if (now < roomAt) return HIDDEN;
    return { ...STILL, sy: Math.max(0.02, easeOut(clamp01((now - roomAt) / BUILD_FLOOR_MS))) };
  }
  if (element.kind === 'walls') {
    const from = roomAt + BUILD_FLOOR_MS;
    if (now < from) return HIDDEN;
    return { ...STILL, sy: Math.max(0.02, easeOut(clamp01((now - from) / BUILD_WALLS_MS))) };
  }
  if (element.kind === 'desk' && drop !== null) return dropPose(drop, now);
  const from = pieceStart(roomAt, element.order, count);
  if (now < from) return HIDDEN;
  const s = Math.max(0.05, easeOutBack(clamp01((now - from) / POP_MS)));
  return { ...STILL, sx: s, sy: s, sz: s };
}

/** A part of a room taken out from `at`: furniture lifts away and shrinks, walls sink, the floor lowers last. */
export function goingPose(element: Element, at: number, now: number): Pose {
  const t = clamp01((now - at) / ROOM_OUT_MS);
  if (t >= 1) return HIDDEN;
  if (element.kind === 'floor') {
    const late = clamp01((t - 0.5) / 0.5);
    return { ...STILL, y: late > 0 ? -0.3 * easeIn(late) : 0, sy: Math.max(0.02, 1 - easeIn(late)) };
  }
  if (element.kind === 'walls') {
    const mid = clamp01((t - 0.25) / 0.5);
    return { ...STILL, sy: Math.max(0.02, 1 - easeIn(mid)) };
  }
  const early = clamp01(t / 0.6);
  const s = 1 - 0.5 * easeIn(early);
  return { visible: early < 1, y: LIFT_TO * easeIn(early), sx: s, sy: s, sz: s };
}

/** A pin's size on the org board: popping in over PIN_POP_MS from `since`, out from `until`. */
export function pinScale(since: number, until: number | null, now: number): number {
  if (now < since) return 0;
  if (until !== null && now >= until) return 1 - clamp01((now - until) / PIN_POP_MS);
  return Math.max(0, easeOutBack(clamp01((now - since) / PIN_POP_MS)));
}

/** Whether a pin is still popping in or out at `now`, so the office asks for another frame. */
export const pinMoving = (since: number, until: number | null, now: number): boolean =>
  (now >= since && now < since + PIN_POP_MS) || (until !== null && now >= until && now < until + PIN_POP_MS);

/** The desks the moments drop in, by desk key, matched by where they stand. */
export function droppingDesks(desks: readonly DeskPlan[], drops: readonly { x: number; z: number; at: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of drops) {
    const desk = desks.find((k) => Math.abs(k.x - d.x) < 0.05 && Math.abs(k.z - d.z) < 0.05);
    if (desk) out.set(desk.key, d.at);
  }
  return out;
}

/** When a building room is fully in: its last piece settled, or its last desk landed. */
export function builtBy(roomAt: number): number {
  return roomAt + BUILD_FLOOR_MS + BUILD_WALLS_MS + FURNITURE_MS + DESK_DROP_MS + SQUASH_MS;
}
