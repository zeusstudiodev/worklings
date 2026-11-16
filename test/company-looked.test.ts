// v0.2, "since you last looked" (SPEC-v0.2.md, "Simple, visible, proven"): the company keeps when the stakeholder last
// looked and the last look of the visit before, at most one look a minute, through restarts and from a company.json
// written before looks existed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foundedState, reviveState } from '../src/core/company-state.ts';
import { LOOK_GAP_MS } from '../src/core/company.ts';
import { crashCopy, eventsFile, rig } from './company-kit.ts';
import { readFileSync } from 'node:fs';

const START = new Date('2026-11-13T10:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

const lookedLines = (root: string): number => readFileSync(eventsFile(root), 'utf8').split('\n').filter((l) => l.includes('"type":"looked"')).length;

describe('a look at the company', () => {
  it('is kept at most once a minute', async () => {
    const r = await rig({ running: true });
    expect(r.company.view().looked).toEqual({ last: null, previous: null });
    expect(r.company.view().since).toBeNull();
    r.company.markLooked();
    vi.advanceTimersByTime(59_000);
    r.company.markLooked();
    expect(r.company.view().looked).toEqual({ last: START, previous: null });
    expect(lookedLines(r.root)).toBe(1);
    vi.advanceTimersByTime(1_000);
    r.company.markLooked();
    expect(r.company.view().looked).toEqual({ last: START + 60_000, previous: null });
    expect(lookedLines(r.root)).toBe(2);
  });

  it('starts a new visit after a pause longer than the gap, and the view says what happened since the visit before', async () => {
    const r = await rig({ running: true });
    r.company.markLooked();
    vi.advanceTimersByTime(LOOK_GAP_MS + 1);
    // Back after the gap: before this visit's look lands, "since" starts at the last look.
    expect(r.company.view().since?.since).toBe(START);
    r.company.markLooked();
    expect(r.company.view().looked).toEqual({ last: START + LOOK_GAP_MS + 1, previous: START });
    // ...and it stays there after it lands, for the whole visit.
    expect(r.company.view().since?.since).toBe(START);
    vi.advanceTimersByTime(5 * 60_000);
    r.company.markLooked();
    expect(r.company.view().looked?.previous).toBe(START);
  });

  it('survives a restart', async () => {
    const r = await rig({ running: true });
    r.company.markLooked();
    const copy = crashCopy(r.root);
    await r.company.close();
    const again = r.reopen(copy);
    try {
      await again.idle();
      expect(again.view().looked).toEqual({ last: START, previous: null });
    } finally {
      await again.close();
    }
  });

  it('is none for a company.json written before looks and verdicts were kept', () => {
    const state = foundedState({ type: 'founded', id: 'old', name: 'Old Co', root: '/p', prompt: 'A site.', stakeholder: 'Robin', at: START });
    const { looked: _, ...older } = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    const steering = { ...(older.steering as Record<string, unknown>) };
    delete steering.verdicts;
    const revived = reviveState({ ...older, steering });
    expect(revived?.looked).toEqual({ last: null, previous: null });
    expect(revived?.steering.verdicts).toEqual([]);
  });
});
