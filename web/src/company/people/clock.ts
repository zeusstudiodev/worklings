// The office's clock for a company tab: the snapshot's time, running on between snapshots by this browser's clock, and
// stopped where it was while the office is unreachable (it can't say what happened after).
import { createContext, useContext, useEffect, useState } from 'react';

/**
 * How far the hub's clock runs ahead of this browser's, in ms (negative when behind), from the company's stream
 * (stream.ts), which the shell provides; 0 in the demo, whose hub is this browser. A time the hub stamped minus the skew
 * is a time on this browser's clock, which timers and Undo windows run on.
 */
export const SkewContext = createContext(0);
export const useSkew = (): number => useContext(SkewContext);

/** The hub's time now: this browser's clock moved by the skew, never before the latest snapshot. */
export const officeNow = (serverTime: number, wall: number, skew: number): number => Math.max(serverTime, wall + skew);

/**
 * `wake` lists moments, by this browser's clock, a view changes at by itself (an undo window closing), so it draws then
 * instead of at the next tick. Ages read in minutes, so a tick every 15 s is plenty.
 */
export function useCompanyClock(serverTime: number, online: boolean, wake: readonly number[] = [], every = 15_000): number {
  const skew = useSkew();
  const [wall, setWall] = useState(() => Date.now());
  // Plain timers rather than window's: the tests read this module on Node.
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => setWall(Date.now()), every);
    return () => clearInterval(id);
  }, [online, every]);
  const next = wake.reduce((soonest, t) => (t > wall && t < soonest ? t : soonest), Number.POSITIVE_INFINITY);
  useEffect(() => {
    if (!online || !Number.isFinite(next)) return;
    const id = setTimeout(() => setWall(Date.now()), Math.max(0, next - Date.now()) + 30);
    return () => clearTimeout(id);
  }, [online, next]);
  return online ? officeNow(serverTime, wall, skew) : serverTime;
}
