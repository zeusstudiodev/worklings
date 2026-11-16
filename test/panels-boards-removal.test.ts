import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNDO_MS } from '../src/core/company.ts';
import { clearRemoval, finishedIn, removalOf, startRemoval, undoRemoval } from '../web/src/company/dashboards/removal.ts';

// Each test uses a company of its own: the waits live in one module, as they do on the page.
let company = 0;
const next = () => `company-${(company += 1)}`;
const launch = { id: 'd-1', title: 'Launch checklist' };

describe('removing a dashboard with Undo in place', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits five seconds on the page before asking the office, then says it was removed', async () => {
    const c = next();
    const send = vi.fn(() => Promise.resolve());
    expect(startRemoval(c, launch, send, 1_000)).toBe(true);
    expect(removalOf(c, 'd-1')).toMatchObject({ state: 'waiting', until: 1_000 + UNDO_MS, title: 'Launch checklist' });
    await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledOnce();
    expect(removalOf(c, 'd-1')?.state).toBe('done');
    expect(finishedIn(c)?.dashboard).toBe('d-1');
  });

  it('never asks the office when Undo comes first', async () => {
    const c = next();
    const send = vi.fn(() => Promise.resolve());
    startRemoval(c, launch, send);
    await vi.advanceTimersByTimeAsync(UNDO_MS - 100);
    expect(undoRemoval(c, 'd-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(send).not.toHaveBeenCalled();
    expect(removalOf(c, 'd-1')).toBeNull();
  });

  it('can no longer be undone once the office has been asked', async () => {
    const c = next();
    let finish: () => void = () => undefined;
    startRemoval(c, launch, () => new Promise<void>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(removalOf(c, 'd-1')?.state).toBe('sending');
    expect(undoRemoval(c, 'd-1')).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(removalOf(c, 'd-1')?.state).toBe('done');
  });

  it("keeps the office's sentence when it refuses, and lets you try again", async () => {
    const c = next();
    startRemoval(c, launch, () => Promise.reject(new Error("There's no dashboard d-1.")));
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(removalOf(c, 'd-1')).toMatchObject({ state: 'failed', problem: "There's no dashboard d-1." });
    expect(finishedIn(c)).toBeNull();
    expect(startRemoval(c, launch, () => Promise.resolve())).toBe(true);
    expect(removalOf(c, 'd-1')?.state).toBe('waiting');
  });

  it('lands as a refusal when the action throws instead of rejecting', async () => {
    const c = next();
    startRemoval(c, launch, () => {
      throw new Error('The office is closed.');
    });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(removalOf(c, 'd-1')).toMatchObject({ state: 'failed', problem: 'The office is closed.' });
  });

  it('starts one removal of a dashboard at a time', () => {
    const c = next();
    const send = vi.fn(() => Promise.resolve());
    expect(startRemoval(c, launch, send)).toBe(true);
    expect(startRemoval(c, launch, send)).toBe(false);
    expect(startRemoval(c, { id: 'd-2', title: 'Orders' }, send)).toBe(true);
  });

  it('forgets a finished removal once the tab has said so, but never one still waiting', async () => {
    const c = next();
    startRemoval(c, launch, () => Promise.resolve());
    clearRemoval(c, 'd-1');
    expect(removalOf(c, 'd-1')?.state).toBe('waiting');
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    clearRemoval(c, 'd-1');
    expect(removalOf(c, 'd-1')).toBeNull();
    expect(finishedIn(c)).toBeNull();
  });

  it("keeps each company's removals apart", () => {
    const a = next();
    const b = next();
    startRemoval(a, launch, () => Promise.resolve());
    expect(removalOf(b, 'd-1')).toBeNull();
    expect(undoRemoval(b, 'd-1')).toBe(false);
    expect(removalOf(a, 'd-1')?.state).toBe('waiting');
  });
});
