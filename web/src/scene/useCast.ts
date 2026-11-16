// The scene's people for a snapshot, kept current between snapshots: a clock that runs on from the snapshot's time,
// a log of when this browser first saw each brief and report (and, in a company, each moment's cause), and timers for
// the next bubble or walk that changes on its own (the server sends snapshots only when something happens) and for
// "Answered you", which runs on real time. The office keeps one cast for the scene and the HUD, so both agree on who
// has a figure (the conversation sits by it).
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import type { Studio } from '../../../src/core/studio.ts';
import { useMediaQuery } from '../lib/hooks.ts';
import { type Cast, type CastAsks, type CastMember, castFrom, clockRate, SceneClock, SeenLog } from './cast.ts';
import { computeLayout, type Layout, type OfficePlaces } from './layout.ts';
import { gatheringRoutes, type MomentProps, type NightRamp } from './moments.ts';
import type { SceneMoments } from './poses.ts';
import { route } from './walk.ts';

const NOBODY: CastMember[] = [];
const STILL: SceneMoments = { night: 0, trays: [], frontDesk: [], celebration: null };

export interface CastExtras {
  /** People out walking at once, when the frame governor lowers it (docs/game-feel.md, "Phones"). */
  budget?: number;
}

export interface SceneCast {
  cast: CastMember[];
  clock: SceneClock;
  /** v3: night, trays, the front desk's line and a celebration, for the stage and the people renderer. */
  moments: SceneMoments;
  /** v3: what MomentLayer draws; null in an office that only watches. */
  props: MomentProps | null;
  night: NightRamp | null;
  /** Still, ambient or motion: how often the stage needs to draw. */
  tier: Cast['tier'];
  /** A click on the stage or Escape: seats everyone still walking in at a company's start. */
  skip: () => void;
}

export function useCast(snapshot: Snapshot | null, layout: Layout, reducedMotion: boolean, open: CastAsks['open'] = null, extras: CastExtras = {}): SceneCast {
  const narrow = useMediaQuery('(max-width: 720px)');
  const [seen] = useState(() => new SeenLog());
  const [clock] = useState(() => new SceneClock());
  // The timer moves the clock on; a new snapshot brings its own time.
  const [tick, setTick] = useState<{ snapshot: Snapshot; now: number } | null>(null);
  const now = snapshot === null ? 0 : tick !== null && tick.snapshot === snapshot ? tick.now : snapshot.serverTime;
  // Real time, for answers: it only has to move on when an "Answered you" bubble is due to go.
  const [realNow, setRealNow] = useState(() => Date.now());
  const [skipAt, setSkipAt] = useState<number | null>(null);
  const { budget } = extras;
  const result = useMemo(
    () =>
      snapshot === null
        ? null
        : castFrom(snapshot, layout, {
          now, seen, reducedMotion, narrow, skipAt, ...(budget === undefined ? {} : { budget }),
          asks: { running: snapshot.aside.running, answers: snapshot.aside.answers, open, realNow },
        }),
    [snapshot, layout, now, seen, reducedMotion, narrow, open, realNow, skipAt, budget],
  );
  const nextChangeAt = result?.nextChangeAt ?? null;
  const nextRealChangeAt = result?.nextRealChangeAt ?? null;

  // Before the frame that draws this snapshot: people walk on its clock, and what it shows counts as seen now.
  useLayoutEffect(() => {
    if (!snapshot) return;
    clock.sync(snapshot, performance.now());
    seen.note(snapshot, layout);
  }, [clock, seen, snapshot, layout]);

  useEffect(() => {
    if (!snapshot || nextChangeAt === null) return;
    const rate = clockRate(snapshot);
    if (rate === 0) return;
    const wait = Math.max(0, (nextChangeAt - clock.now(performance.now())) / rate);
    const timer = window.setTimeout(() => setTick({ snapshot, now: nextChangeAt }), wait);
    return () => window.clearTimeout(timer);
  }, [clock, snapshot, nextChangeAt]);

  useEffect(() => {
    if (nextRealChangeAt === null) return;
    const timer = window.setTimeout(() => setRealNow(Date.now()), Math.max(0, nextRealChangeAt - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [nextRealChangeAt]);

  const skip = useCallback(() => setSkipAt(clock.now(performance.now())), [clock]);

  // An all-hands walks the whole office to one room. Its routes are worked out a few at a time while the office is
  // idle, so the cast that plans it costs a frame nothing (moments.ts, gatheringRoutes).
  useEffect(() => {
    const pairs = gatheringRoutes(layout);
    if (pairs.length === 0) return;
    // iOS Safari has no idle callbacks: a little at a time on a timer there.
    const idle: Partial<Pick<Window, 'requestIdleCallback' | 'cancelIdleCallback'>> = window;
    let next = 0;
    let timer = 0;
    let handle = 0;
    const work = (until: number) => {
      while (next < pairs.length && performance.now() < until) {
        const pair = pairs[next++];
        if (pair) route(layout, pair[0], pair[1]);
      }
      if (next < pairs.length) schedule();
    };
    const schedule = () => {
      if (idle.requestIdleCallback) handle = idle.requestIdleCallback((deadline) => work(performance.now() + Math.max(1, deadline.timeRemaining() - 2)));
      else timer = window.setTimeout(() => work(performance.now() + 3), 40);
    };
    schedule();
    return () => {
      if (handle) idle.cancelIdleCallback?.(handle);
      window.clearTimeout(timer);
    };
  }, [layout]);

  return {
    cast: result?.members ?? NOBODY,
    clock,
    moments: result?.moments ?? STILL,
    props: result?.props ?? null,
    night: result?.night ?? null,
    tier: result?.tier ?? 'still',
    skip,
  };
}

/**
 * The floor plan for a studio, learned once: a company's rooms and desks keep their places from one studio to the
 * next (a hire takes a free desk, a firing leaves one, new rooms join at the edge). v1 and v2 studios get their own
 * plan as before. The places live for as long as the office is open; studio.yaml has no place for them yet.
 */
export function useOfficeLayout(studio: Studio | null): Layout {
  const [kept, setKept] = useState(() => ({ studio, layout: computeLayout(studio) }));
  if (kept.studio === studio) return kept.layout;
  // A new studio: lay it out from the last plan's places, during this render (React's way to keep a previous value).
  const next = { studio, layout: computeLayout(studio, placesOf(kept.layout)) };
  setKept(next);
  return next.layout;
}

const placesOf = (layout: Layout): OfficePlaces | null => layout.office?.places ?? null;
