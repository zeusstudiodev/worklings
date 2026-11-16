import { useEffect, useState } from 'react';

/** What the hook last checked: a deadline, and whether this browser's clock had passed it then. */
export interface Seen {
  until: number | null;
  reached: boolean;
}

export function seenAt(until: number | null, now: number): Seen {
  return { until, reached: until === null || now >= until };
}

/**
 * A deadline not checked yet counts as ahead. A fresh answer brings a new one, and reading the old check would hide its
 * Undo for a render, so focus meant for the Undo would find nothing.
 */
export function reachedFrom(seen: Seen, until: number | null): boolean {
  return seen.until === until ? seen.reached : until === null;
}

/** True from `until` on (and when there is none), by this browser's clock: checked at once and again at the deadline. */
export function useReached(until: number | null): boolean {
  const [seen, setSeen] = useState(() => seenAt(until, Date.now()));
  useEffect(() => {
    if (until === null) return;
    // At once, for a new deadline already past, and when it passes.
    const check = () => setSeen(seenAt(until, Date.now()));
    const soon = setTimeout(check, 0);
    const later = setTimeout(check, Math.max(0, until - Date.now()) + 20);
    return () => {
      clearTimeout(soon);
      clearTimeout(later);
    };
  }, [until]);
  return reachedFrom(seen, until);
}
