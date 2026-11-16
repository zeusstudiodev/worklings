import { useEffect, useState } from 'react';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { useStillOffice } from './still.ts';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** The system asks for less motion, or the person turned the office still (lib/still.ts). */
export const useReducedMotion = (): boolean => {
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  return useStillOffice() || system;
};

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Real time, ticking every `ms`: for what the office stamps in real time (when a call started, when a digest was
 * written), which a replay's clock doesn't measure.
 */
export function useWallClock(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // A faster pace starts with a fresh reading: the last one may be a whole slow interval old.
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, ms);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [ms]);
  return now;
}

/**
 * The office's clock, which is the snapshot's. Live and in the demo it runs on between snapshots (the server sends one
 * only when something changes), ticking every `ms`; a replay runs on the replay's position, so pausing stops it; and
 * while the connection is down it stops where it was, since the office can't say what happened after.
 */
export function useOfficeClock(snapshot: Snapshot | null, receivedAt: number, connected: boolean, ms = 5000): number {
  const running = connected && snapshot !== null && snapshot.mode !== 'replay';
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [running, ms]);
  if (!snapshot) return 0;
  return snapshot.mode === 'replay' ? snapshot.serverTime : snapshot.serverTime + Math.max(0, tick - receivedAt);
}
