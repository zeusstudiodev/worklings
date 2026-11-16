// The path and timing of Send's flight (docs/design-hud.md, "Send's flight"): pure, so a test pins them. The paper
// lifts off Send's top centre (80 ms), then arcs along a quadratic curve to its target over 300 ms plus a quarter
// millisecond a pixel, at most 520, turning from -10 to +6 degrees and shrinking to the 3D note's size on screen.
import type { Recipient } from '../../../../src/core/steering.ts';
import { OFFICE_MIDDLE, type Pt } from '../../scene/reach.ts';

export const LIFT_MS = 80;
export const LIFT_PX = 8;
export const LIFT_SCALE = 1.1;
/** The hand-off: the paper fades out as the office's own note takes over. */
export const FADE_MS = 120;
/** Papers for several picks leave this far apart, in the To's order. */
export const GAP_MS = 60;
export const TURN_FROM = -10;
export const TURN_TO = 6;
/** The 3D note's size on screen at the target, as a share of the paper (about 55%). */
export const LAND_SCALE = 0.55;
/** The paper: 22 x 17 px (talk.css, `.tflight`). */
export const PAPER_W = 22;
export const PAPER_H = 17;

/** How long the flight takes by distance: 300 ms plus 0.25 ms a pixel, 520 at most. */
export const flightMs = (distance: number): number => Math.min(520, 300 + 0.25 * distance);

export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export const distance = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The arc's control point: 35% of the way along the line, then 30% of the line's length off it, on the upper side, so
 * the paper climbs over the strip and the talk bar first and turns down onto the target.
 */
export function control(from: Pt, to: Pt): Pt {
  const len = distance(from, to);
  if (len === 0) return { x: from.x, y: from.y };
  const dx = (to.x - from.x) / len;
  const dy = (to.y - from.y) / len;
  // The two normals; the one pointing up the page (smaller y), or to the left when the line is level with them.
  const left = { x: dy, y: -dx };
  const right = { x: -dy, y: dx };
  const n = left.y < right.y - 1e-9 ? left : right.y < left.y - 1e-9 ? right : left.x <= right.x ? left : right;
  return { x: from.x + dx * len * 0.35 + n.x * len * 0.3, y: from.y + dy * len * 0.35 + n.y * len * 0.3 };
}

/** A point on the quadratic curve from `a` through `c` to `b`, at `t` from 0 to 1. */
export function bezier(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

export interface Pose {
  x: number;
  y: number;
  /** Degrees. */
  turn: number;
  scale: number;
}

/**
 * Where the paper is `elapsed` ms after it began to lift off `from` for `to`, a flight of `ms`. The target is passed
 * every frame, so a camera that moves doesn't lose it.
 */
export function poseAt(elapsed: number, from: Pt, to: Pt, ms: number): Pose {
  const lifted: Pt = { x: from.x, y: from.y - LIFT_PX };
  if (elapsed < LIFT_MS) {
    const u = easeOut(clamp01(elapsed / LIFT_MS));
    return { x: from.x, y: from.y - LIFT_PX * u, turn: TURN_FROM, scale: 1 + (LIFT_SCALE - 1) * u };
  }
  const t = clamp01((elapsed - LIFT_MS) / ms);
  const at = bezier(lifted, control(lifted, to), to, easeInOut(t));
  return { x: at.x, y: at.y, turn: TURN_FROM + (TURN_TO - TURN_FROM) * t, scale: LIFT_SCALE + (LAND_SCALE - LIFT_SCALE) * t };
}

/** The anchor a pick's paper flies to: a person's tray, a room's sign, a team's head's tray, the office's middle. */
export function anchorOf(to: Recipient): string {
  switch (to.kind) {
    case 'person':
      return `tray:${to.id}`;
    case 'team':
      return `tray:${to.head}`;
    case 'room':
      return `room:${to.id}`;
    case 'everyone':
      return OFFICE_MIDDLE;
  }
}
