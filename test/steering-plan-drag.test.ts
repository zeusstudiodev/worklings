import { describe, expect, it } from 'vitest';
import { edgeSpeed, nearestLine } from '../web/src/company/plan/drag.ts';

describe('where a dragged row lands', () => {
  const lines = [
    { y: 0, slot: 'before a' },
    { y: 100, slot: 'before b' },
    { y: 200, slot: 'end' },
  ];

  it('is the drop line nearest the pointer', () => {
    expect(nearestLine(lines, 30)?.slot).toBe('before a');
    expect(nearestLine(lines, 70)?.slot).toBe('before b');
    expect(nearestLine(lines, 900)?.slot).toBe('end');
    expect(nearestLine(lines, -50)?.slot).toBe('before a');
  });

  it('takes the first of two lines as near, and nothing without lines', () => {
    expect(nearestLine(lines, 50)?.slot).toBe('before a');
    expect(nearestLine([], 10)).toBeNull();
  });
});

describe('scrolling while dragging', () => {
  it('holds still away from the edges', () => {
    expect(edgeSpeed(400, 0, 800)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom, faster closer to the edge', () => {
    expect(edgeSpeed(40, 0, 800)).toBeLessThan(0);
    expect(edgeSpeed(5, 0, 800)).toBeLessThan(edgeSpeed(40, 0, 800));
    expect(edgeSpeed(780, 0, 800)).toBeGreaterThan(0);
    expect(edgeSpeed(-20, 0, 800)).toBe(-14);
    expect(edgeSpeed(900, 0, 800)).toBe(14);
  });

  it("doesn't scroll a scroller too small to have edges and a middle", () => {
    expect(edgeSpeed(10, 0, 120)).toBe(0);
  });
});
