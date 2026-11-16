import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchorOf, bezier, control, distance, easeInOut, flightMs, LAND_SCALE, LIFT_MS, LIFT_PX, poseAt, TURN_FROM, TURN_TO } from '../web/src/company/talk/flightMath.ts';
import { heldPaper, holdNotes, holdVersion, noteTrays } from '../web/src/scene/noteHold.ts';
import { edgeToward, inBox, OFFICE_MIDDLE } from '../web/src/scene/reach.ts';

describe("Send's flight: path and timing", () => {
  it('takes 300 ms plus a quarter millisecond a pixel, at most 520', () => {
    expect(flightMs(0)).toBe(300);
    expect(flightMs(400)).toBe(400);
    expect(flightMs(5000)).toBe(520);
  });

  it('arcs above the line between its ends, toward the start, by 30% of its length', () => {
    const from = { x: 700, y: 860 };
    const to = { x: 700, y: 360 };
    const c = control(from, to);
    // Along the line 35% of 500 px, and 150 px off it, on one side.
    expect(c.y).toBeCloseTo(860 - 175, 5);
    expect(Math.abs(c.x - 700)).toBeCloseTo(150, 5);
    const across = control({ x: 100, y: 500 }, { x: 600, y: 500 });
    expect(across.y).toBeCloseTo(350, 5);
    expect(across.x).toBeCloseTo(275, 5);
  });

  it('starts on the key, lifts 8 px in 80 ms, then ends on the target at the 3D note size', () => {
    const from = { x: 700, y: 860 };
    const to = { x: 400, y: 300 };
    const ms = flightMs(distance(from, to));
    expect(poseAt(0, from, to, ms)).toMatchObject({ x: 700, y: 860, turn: TURN_FROM, scale: 1 });
    const lifted = poseAt(LIFT_MS, from, to, ms);
    expect(lifted.y).toBeCloseTo(860 - LIFT_PX, 5);
    expect(lifted.scale).toBeCloseTo(1.1, 5);
    const end = poseAt(LIFT_MS + ms, from, to, ms);
    expect(end.x).toBeCloseTo(400, 5);
    expect(end.y).toBeCloseTo(300, 5);
    expect(end.turn).toBeCloseTo(TURN_TO, 5);
    expect(end.scale).toBeCloseTo(LAND_SCALE, 5);
  });

  it('follows a target that moves: the end is wherever the target is that frame', () => {
    const from = { x: 700, y: 860 };
    const ms = 400;
    expect(poseAt(LIFT_MS + ms, from, { x: 100, y: 200 }, ms).x).toBeCloseTo(100, 5);
    expect(poseAt(LIFT_MS + ms, from, { x: 900, y: 250 }, ms).x).toBeCloseTo(900, 5);
  });

  it('eases in and out, and the curve passes through its ends', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(bezier({ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 10, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
    expect(bezier({ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 10, y: 0 }, 1)).toEqual({ x: 10, y: 0 });
  });

  it("flies to a person's tray, a room's sign, a team head's tray and the office's middle", () => {
    expect(anchorOf({ kind: 'person', id: 'mina' })).toBe('tray:mina');
    expect(anchorOf({ kind: 'room', id: 'design' })).toBe('room:design');
    expect(anchorOf({ kind: 'team', head: 'ada' })).toBe('tray:ada');
    expect(anchorOf({ kind: 'everyone' })).toBe(OFFICE_MIDDLE);
  });
});

describe('Send flight: a target out of view or under the side panel', () => {
  const area = { left: 12, top: 100, right: 1000, bottom: 700 };

  it('leaves a point inside the labels area where it is', () => {
    expect(inBox({ x: 500, y: 400 }, area)).toBe(true);
    expect(edgeToward(area, { x: 500, y: 400 })).toEqual({ x: 500, y: 400 });
  });

  it('flies to the edge toward a point beyond it, kept inside the area', () => {
    const edge = edgeToward(area, { x: 1400, y: 400 }, 10);
    expect(edge.x).toBeCloseTo(990, 5);
    expect(edge.y).toBeCloseTo(400, 5);
    const above = edgeToward(area, { x: 506, y: -500 }, 10);
    expect(above.y).toBeCloseTo(110, 5);
    expect(inBox(above, area)).toBe(true);
  });

  it('heads for the corner when the point lies diagonally off the area', () => {
    const edge = edgeToward(area, { x: 3000, y: 3000 }, 0);
    expect(inBox(edge, area)).toBe(true);
    expect(edge.x === area.right || edge.y === area.bottom).toBe(true);
  });
});

describe("Send's flight: keeping the 3D note out of its tray until the paper lands", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    noteTrays([{ person: 'mina', x: 0, z: 0, yours: false, index: 0, stack: false }]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides a paper beyond the ones the tray had, until the hold ends', () => {
    const hold = holdNotes();
    expect(heldPaper('mina', 0)).toBe(false);
    expect(heldPaper('mina', 1)).toBe(true);
    expect(heldPaper('kai', 0)).toBe(true);
    const before = holdVersion();
    hold.until(performance.now() + 450);
    vi.advanceTimersByTime(449);
    expect(heldPaper('mina', 1)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(heldPaper('mina', 1)).toBe(false);
    expect(holdVersion()).toBeGreaterThan(before);
  });

  it('shows it at once when released, and never holds longer than its cap', () => {
    const hold = holdNotes();
    hold.release();
    expect(heldPaper('mina', 1)).toBe(false);
    holdNotes();
    expect(heldPaper('mina', 1)).toBe(true);
    vi.advanceTimersByTime(3600);
    expect(heldPaper('mina', 1)).toBe(false);
  });
});
