// Diffs as this tab has read them, so the task's page, its rows and the wide view share one read per commit. A commit
// never changes, so a read is kept; a failed read can be tried again. Only the newest few are kept: a diff can be big.
import { useSyncExternalStore } from 'react';
import { type ParsedDiff, parseDiff } from './diffModel.ts';

export type DiffRead = { state: 'loading' } | { state: 'done'; diff: ParsedDiff } | { state: 'failed'; error: string };

const KEPT = 12;
const reads = new Map<string, DiffRead>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const diffKey = (companyId: string, task: string, commit: string): string => `${companyId}\n${task}\n${commit}`;

/** Reads a diff once; later calls for the same commit find it here. */
export function loadDiff(key: string, read: () => Promise<string>) {
  if (reads.has(key)) return;
  reads.set(key, { state: 'loading' });
  while (reads.size > KEPT) {
    const oldest = reads.keys().next().value;
    if (oldest === undefined) break;
    reads.delete(oldest);
  }
  emit();
  read().then(
    (text) => {
      reads.set(key, { state: 'done', diff: parseDiff(text) });
      emit();
    },
    (error: unknown) => {
      reads.set(key, { state: 'failed', error: error instanceof Error ? error.message : String(error) });
      emit();
    },
  );
}

/** Forgets a failed read, so the next look reads it again. */
export function forgetDiff(key: string) {
  if (reads.get(key)?.state !== 'failed') return;
  reads.delete(key);
  emit();
}

export function useDiff(key: string | null): DiffRead | null {
  return useSyncExternalStore(subscribe, () => (key === null ? null : (reads.get(key) ?? null)));
}
