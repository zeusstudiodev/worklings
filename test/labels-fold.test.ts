// The front desk's crowd folds into its sign (web/src/scene/stack.ts): pure, so no browser is needed.
import { describe, expect, it } from 'vitest';
import { CROWD_PX, foldCrowds, type LabelBox, stackLabels } from '../web/src/scene/stack.ts';

const DESK = 'desk:front';
const sign: LabelBox = { id: DESK, x: 300, y: 400, w: 150, h: 32, hang: 'below', kind: 'fixed', rank: 1, depth: 0 };
const waiter = (id: string, x: number, y: number, rank = 2): LabelBox => ({ id: `person:${id}`, x, y, w: 150, h: 21, hang: 'above', kind: 'person', rank, depth: 0, fold: DESK });
const near = [waiter('a', 300, 380), waiter('b', 310, 372), waiter('c', 322, 366)];

describe('folding the front desk crowd', () => {
  it('folds every waiter standing close together into the sign', () => {
    expect(foldCrowds([sign, ...near])).toEqual(new Set(['person:a', 'person:b', 'person:c']));
  });

  it('folds a lone waiter, since the sign already says who waits', () => {
    expect(foldCrowds([sign, waiter('a', 300, 380)])).toEqual(new Set(['person:a']));
  });

  it('shows them once any two stand apart by the crowd distance, which is what zooming in does', () => {
    const apart = [waiter('a', 300, 380), waiter('b', 300 + CROWD_PX, 380), waiter('c', 300 + 2 * CROWD_PX, 380)];
    expect(foldCrowds([sign, ...apart]).size).toBe(0);
    expect(foldCrowds([sign, waiter('a', 300, 380), waiter('b', 300 + CROWD_PX - 1, 380)]).size).toBe(2);
  });

  it('shows them while the fold is open (the pointer or focus is on the sign)', () => {
    expect(foldCrowds([sign, ...near], new Set([DESK])).size).toBe(0);
  });

  it('never folds labels that name no fold, so people who ask elsewhere keep their bubbles', () => {
    const own: LabelBox = { id: 'person:z', x: 305, y: 376, w: 150, h: 21, hang: 'above', kind: 'person', rank: 2, depth: 0 };
    expect(foldCrowds([sign, own, ...near]).has('person:z')).toBe(false);
  });

  it('takes the folded out of the stacking, so they leave no lift or drop behind and the others stay clear of one another', () => {
    const other: LabelBox = { id: 'person:o', x: 305, y: 376, w: 150, h: 21, hang: 'above', kind: 'person', rank: 0, depth: 0 };
    const stacked = stackLabels([sign, other, ...near]);
    expect(stacked.folded).toEqual(new Set(['person:a', 'person:b', 'person:c']));
    for (const id of stacked.folded) {
      expect(stacked.lifts.has(id)).toBe(false);
      expect(stacked.dropped.has(id)).toBe(false);
    }
    expect(stacked.dropped.size).toBe(0);
    const open = stackLabels([sign, other, ...near], { open: new Set([DESK]) });
    expect(open.folded.size).toBe(0);
    expect(open.lifts.has('person:a')).toBe(true);
  });

  it('drops a bubble held down at the ceiling rather than lay it over another', () => {
    const top = (id: string, x: number): LabelBox => ({ id, x, y: 60, w: 150, h: 21, hang: 'above', kind: 'person', rank: 0, depth: 0 });
    const stacked = stackLabels([top('person:p', 300), top('person:q', 340)], { ceiling: 40 });
    expect(stacked.dropped.size).toBe(1);
  });
});
