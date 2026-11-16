import { describe, expect, it } from 'vitest';
import { barExtents, centTicks, formatNumber, lineWords, linePoints, moneyTick, nearestIndex, niceTicks, withUnit } from '../web/src/company/dashboards/chartsModel.ts';

describe('numbers and units', () => {
  it('groups thousands and keeps two decimals at most', () => {
    expect([formatNumber(1284), formatNumber(4.5), formatNumber(2 / 3), formatNumber(-3), formatNumber(0)]).toEqual(['1,284', '4.5', '0.67', '-3', '0']);
  });

  it('puts a unit after its figure, with no space before a percent sign', () => {
    expect([withUnit('12', 'days'), withUnit('42', '%'), withUnit('7', undefined), withUnit('7', '')]).toEqual(['12 days', '42%', '7', '7']);
  });
});

describe('ticks', () => {
  it('gives three to five clean ticks that cover the values', () => {
    for (const [lo, hi] of [
      [0, 21],
      [0, 7],
      [0, 1],
      [0, 0.37],
      [0, 3.2],
      [0, 1234],
      [-4, 9],
      [0, 100],
      [0, 51],
    ] as const) {
      const ticks = niceTicks(lo, hi);
      expect(ticks.length, `${lo} to ${hi}`).toBeGreaterThanOrEqual(3);
      expect(ticks.length, `${lo} to ${hi}`).toBeLessThanOrEqual(5);
      expect(ticks[0], `${lo} to ${hi}`).toBeLessThanOrEqual(lo);
      expect(ticks.at(-1), `${lo} to ${hi}`).toBeGreaterThanOrEqual(hi);
      const steps = ticks.slice(1).map((t, i) => Number((t - (ticks[i] ?? 0)).toFixed(6)));
      expect(new Set(steps).size, `${lo} to ${hi} is evenly spaced`).toBe(1);
    }
  });

  it('reads like numbers people write, without float noise', () => {
    expect(niceTicks(0, 21)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(0, 0.3)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(niceTicks(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('steps counts by whole numbers', () => {
    expect(niceTicks(0, 1, true)).toEqual([0, 1, 2]);
    expect(niceTicks(0, 3, true).every(Number.isInteger)).toBe(true);
    expect(niceTicks(0, 24, true).every(Number.isInteger)).toBe(true);
  });

  it('opens an empty range instead of dividing by nothing', () => {
    expect(niceTicks(0, 0, true)).toEqual([0, 1, 2]);
    expect(niceTicks(5, 5).at(-1)).toBeGreaterThanOrEqual(6);
  });

  it('puts money on whole cents, so no two ticks read the same', () => {
    // Two cents spent: half-cent ticks read "$0.01" three times before.
    expect(centTicks(0, 0.02).map(moneyTick)).toEqual(['$0', '$0.01', '$0.02']);
    expect(centTicks(0, 0.003).map(moneyTick)).toEqual(['$0', '$0.01', '$0.02']);
    for (const hi of [0.004, 0.02, 0.03, 0.07, 0.37, 1.2, 4.2, 40.27, 1234.5]) {
      const labels = centTicks(0, hi).map(moneyTick);
      expect(new Set(labels).size, `${hi}: ${labels.join(', ')}`).toBe(labels.length);
      expect(centTicks(0, hi).every((t) => Number.isInteger(Math.round(t * 100 * 1e6) / 1e6)), `${hi} on whole cents`).toBe(true);
      expect(centTicks(0, hi).at(-1), `${hi} covered`).toBeGreaterThanOrEqual(hi);
    }
    expect(centTicks(0, 40.27)).toEqual([0, 20, 40, 60]);
  });

  it('writes money ticks as people write prices', () => {
    expect([moneyTick(0), moneyTick(2), moneyTick(0.5), moneyTick(0.01)]).toEqual(['$0', '$2', '$0.50', '$0.01']);
  });
});

describe('bars', () => {
  it('grows every bar from zero at the left, on one scale', () => {
    const { zero, bars } = barExtents([7, 3, 0, 14]);
    expect(zero).toBe(0);
    expect(bars).toEqual([
      { start: 0, size: 0.5 },
      { start: 0, size: 3 / 14 },
      { start: 0, size: 0 },
      { start: 0, size: 1 },
    ]);
  });

  it('moves the baseline in when a value is negative, so bars grow both ways from it', () => {
    const { zero, bars } = barExtents([-5, 15]);
    expect(zero).toBe(0.25);
    expect(bars).toEqual([
      { start: 0, size: 0.25 },
      { start: 0.25, size: 0.75 },
    ]);
  });

  it('draws nothing for bars that are all zero', () => {
    expect(barExtents([0, 0]).bars.map((b) => b.size)).toEqual([0, 0]);
  });
});

describe('lines', () => {
  it('places points across the plot against the first and last tick', () => {
    expect(linePoints([0, 10, 30], [0, 10, 20, 30])).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 1 - 1 / 3 },
      { x: 1, y: 0 },
    ]);
    expect(linePoints([5], [0, 10])).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('snaps the crosshair to the nearest point', () => {
    expect([nearestIndex(0, 5), nearestIndex(0.12, 5), nearestIndex(0.13, 5), nearestIndex(1.4, 5), nearestIndex(0.7, 1)]).toEqual([0, 0, 1, 4, 0]);
  });

  it('says the first, the last and the highest in one sentence', () => {
    const days = (values: number[]) => values.map((value, i) => ({ label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i] ?? '', value }));
    expect(lineWords(days([0, 3, 8, 14, 21]), 'orders')).toBe('Starts at 0 orders (Mon) and ends at 21 orders (Fri), its highest.');
    expect(lineWords(days([3, 9, 21, 17, 14]))).toBe('Starts at 3 (Mon), peaks at 21 (Wed) and ends at 14 (Fri).');
    expect(lineWords(days([30, 9, 21]), '%')).toBe('Starts at 30% (Mon), its highest, and ends at 21% (Wed).');
    expect(lineWords(days([4, 4, 4]))).toBe('Stays at 4 from Mon to Wed.');
    expect(lineWords(days([1234]))).toBe('One point: 1,234 (Mon).');
    expect(lineWords([])).toBe('No points yet.');
  });
});
