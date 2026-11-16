// "Remove this dashboard" with Undo in place (docs/design-v3.md, "Undo, not confirm"). A taken-down dashboard can't be
// put back, so the removal waits UNDO_MS on this page before the office is asked, and Undo simply never asks. The wait
// lives here rather than in the tab, so switching tabs meanwhile still removes it; closing the page within the wait
// leaves the dashboard up.
import { useSyncExternalStore } from 'react';
import { UNDO_MS } from '../../../../src/core/company.ts';

export interface Removal {
  dashboard: string;
  title: string;
  /** waiting: Undo still stops it. sending: the office is asked. done: it was taken down. failed: the office refused. */
  state: 'waiting' | 'sending' | 'done' | 'failed';
  /** When the wait ends, by this browser's clock. */
  until: number;
  /** For failed: the office's sentence. */
  problem: string | null;
}

const removals = new Map<string, Removal>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const keyOf = (company: string, dashboard: string) => `${company}\n${dashboard}`;

function set(key: string, removal: Removal | null) {
  if (removal) removals.set(key, removal);
  else removals.delete(key);
  for (const listener of listeners) listener();
}

/**
 * Starts the wait. After `wait` ms `send` asks the office; until then undoRemoval stops it. Returns false while a removal
 * of the same dashboard is already waiting or being sent.
 */
export function startRemoval(company: string, dashboard: { id: string; title: string }, send: () => Promise<void>, now = Date.now(), wait = UNDO_MS): boolean {
  const key = keyOf(company, dashboard.id);
  const was = removals.get(key);
  if (was && (was.state === 'waiting' || was.state === 'sending')) return false;
  set(key, { dashboard: dashboard.id, title: dashboard.title, state: 'waiting', until: now + wait, problem: null });
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const waiting = removals.get(key);
      if (!waiting || waiting.state !== 'waiting') return;
      set(key, { ...waiting, state: 'sending' });
      // Through a promise, so an action that throws instead of rejecting still lands as a refusal.
      Promise.resolve()
        .then(send)
        .then(
          () => set(key, { ...waiting, state: 'done' }),
          (error: unknown) => set(key, { ...waiting, state: 'failed', problem: error instanceof Error ? error.message : "The office didn't take it down." }),
        );
    }, wait),
  );
  return true;
}

/** Undo: stops a removal that is still waiting. False once the office has been asked. */
export function undoRemoval(company: string, dashboard: string): boolean {
  const key = keyOf(company, dashboard);
  if (removals.get(key)?.state !== 'waiting') return false;
  const timer = timers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(key);
  set(key, null);
  return true;
}

/** Forgets a finished or failed removal once the tab has said so. */
export function clearRemoval(company: string, dashboard: string): void {
  const key = keyOf(company, dashboard);
  const was = removals.get(key);
  if (was && (was.state === 'done' || was.state === 'failed')) set(key, null);
}

export const removalOf = (company: string, dashboard: string): Removal | null => removals.get(keyOf(company, dashboard)) ?? null;

/** The latest removal in a company that finished, for the tab's line after the dashboard has gone. */
export function finishedIn(company: string): Removal | null {
  let latest: Removal | null = null;
  for (const [key, r] of removals) if (key.startsWith(`${company}\n`) && r.state === 'done' && (!latest || r.until > latest.until)) latest = r;
  return latest;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useRemoval = (company: string, dashboard: string | null): Removal | null =>
  useSyncExternalStore(subscribe, () => (dashboard === null ? null : removalOf(company, dashboard)));

export const useFinishedRemoval = (company: string): Removal | null => useSyncExternalStore(subscribe, () => finishedIn(company));
