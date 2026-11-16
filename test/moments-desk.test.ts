// What the moments put on a desk (docs/game-feel.md, sections 4 and 6): a long day's cups and the first-day plant stand
// on the desk top where the default camera sees them, past the monitor, clear of each other, the tray, the keyboard and
// the scenery's corner piece. The UI gate found the cups behind the monitor, where nobody saw even three (5 Nov 2026).
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { demoCompanyView, studioOf } from '../src/core/demo-company.ts';
import { type CompanyDesk, computeLayout, type Point } from '../web/src/scene/layout.ts';
import { CUP_SCALE } from '../web/src/scene/moments.ts';
import { DESK_TOP, monitor, ON_DESK } from '../web/src/scene/office/desk.ts';

/** Stage.tsx's VIEW: the camera looks from the front right and above. */
const TO_CAMERA = (() => {
  const v = { x: 1, y: 1.18, z: 1 };
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
})();
/** MomentLayer's cup: 0.06 at the lid and 0.17 tall, drawn CUP_SCALE times that. */
const CUP = { r: 0.06 * CUP_SCALE, h: 0.17 * CUP_SCALE };
/** MomentLayer's first-day plant: its pot, and its leaves up to about 0.35. */
const PLANT = { pot: 0.09, leaves: 0.13, h: 0.35 };
/** The scenery's piece in the far right corner (books, a frame, a cactus or a lamp), as a round footprint. */
const CORNER_REACH = 0.16;
const TRAY = { w: 0.36, d: 0.28 };
const KEYBOARD = { w: 0.7 + 0.2, d: 0.24 };

const MONITOR = (() => {
  const g = monitor();
  g.computeBoundingBox();
  return g.boundingBox ?? new Box3();
})();

const desks = (): CompanyDesk[] => {
  const office = computeLayout(studioOf(demoCompanyView(Date.UTC(2026, 10, 5, 12)))).office;
  if (!office) throw new Error('The demo café should have a company layout');
  return office.desks;
};

/** The monitor's box on this desk, in the office's space. */
function monitorOn(desk: CompanyDesk) {
  return {
    min: { x: desk.x + ON_DESK.monitor.x + MONITOR.min.x, y: DESK_TOP + MONITOR.min.y, z: desk.z + ON_DESK.monitor.z + MONITOR.min.z },
    max: { x: desk.x + ON_DESK.monitor.x + MONITOR.max.x, y: DESK_TOP + MONITOR.max.y, z: desk.z + ON_DESK.monitor.z + MONITOR.max.z },
  };
}

/** Whether the line from `p` toward the camera passes through the box. */
function blocked(p: { x: number; y: number; z: number }, box: ReturnType<typeof monitorOn>): boolean {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = TO_CAMERA[axis];
    const lo = (box.min[axis] - p[axis]) / d;
    const hi = (box.max[axis] - p[axis]) / d;
    near = Math.max(near, Math.min(lo, hi));
    far = Math.min(far, Math.max(lo, hi));
  }
  return near <= far;
}

/** Points on the outline the camera sees of something round standing on the desk: its middle and both sides, low to high. */
function outline(at: Point, r: number, h: number) {
  const side = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
  return [0.15, 0.5, 0.9].flatMap((f) => [-1, 0, 1].map((s) => ({ x: at.x + s * r * side.x, y: DESK_TOP + f * h, z: at.z + s * r * side.z })));
}

const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
/** How far a round footprint keeps from a rectangle centred at `c`. */
function gap(p: Point, r: number, c: Point, size: { w: number; d: number }): number {
  const dx = Math.max(0, Math.abs(p.x - c.x) - size.w / 2);
  const dz = Math.max(0, Math.abs(p.z - c.z) - size.d / 2);
  return Math.hypot(dx, dz) - r;
}

describe('a long day on the desk', () => {
  it('stands every cup where the default camera sees all of it, past the monitor', () => {
    for (const desk of desks()) {
      expect(desk.cups).toHaveLength(3);
      for (const [k, cup] of desk.cups.entries()) {
        for (const p of outline(cup, CUP.r, CUP.h)) expect(blocked(p, monitorOn(desk)), `cup ${k + 1} on ${desk.room}:${desk.slot}`).toBe(false);
      }
    }
  });

  it('keeps the first-day plant in view too', () => {
    for (const desk of desks()) {
      for (const p of outline(desk.plant, 0, PLANT.h)) expect(blocked(p, monitorOn(desk)), `plant on ${desk.room}:${desk.slot}`).toBe(false);
    }
  });

  it('puts the cups and the plant on the desk top, clear of each other and of what the scenery puts there', () => {
    for (const desk of desks()) {
      const where = `${desk.room}:${desk.slot}`;
      const things = [...desk.cups.map((at) => ({ at, r: CUP.r })), { at: desk.plant, r: PLANT.pot }];
      const box = monitorOn(desk);
      const screen = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
      for (const { at, r } of things) {
        expect(Math.abs(at.x - desk.x), where).toBeLessThanOrEqual(desk.w / 2 - r);
        expect(Math.abs(at.z - desk.z), where).toBeLessThanOrEqual(desk.d / 2 - r);
        expect(gap(at, r, desk.tray, TRAY), where).toBeGreaterThan(0);
        expect(gap(at, r, screen, { w: box.max.x - box.min.x, d: box.max.z - box.min.z }), where).toBeGreaterThan(0);
        expect(gap(at, r, { x: desk.x + ON_DESK.keyboard.x, z: desk.z + ON_DESK.keyboard.z }, KEYBOARD), where).toBeGreaterThan(0);
        expect(apart(at, { x: desk.x + ON_DESK.corner.x, z: desk.z + ON_DESK.corner.z }), where).toBeGreaterThan(r + CORNER_REACH);
      }
      for (const [i, a] of things.entries()) for (const b of things.slice(i + 1)) expect(apart(a.at, b.at), where).toBeGreaterThanOrEqual(a.r + b.r);
      // The plant's leaves spread wider than its pot and stay off the cups too.
      for (const cup of desk.cups) expect(apart(cup, desk.plant), where).toBeGreaterThanOrEqual(CUP.r + PLANT.leaves);
    }
  });
});
