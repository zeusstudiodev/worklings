// What the office's one live region says (docs/design.md, "The Now tab", screen reader): that someone started to need
// you, and that a catch-up arrived or failed. Headline, rows, bubbles and counters stay quiet.
import { useEffect, useRef } from 'react';
import type { AsideView } from '../../../src/core/aside.ts';
import { needsYouSentence, type NowBoard } from '../../../src/core/now.ts';
import { failureCopy } from './asideModel.ts';
import { CATCH_UP_FAILED } from './catchUpModel.ts';

/** People who start to need you this close together are said in one sentence... */
const GATHER_MS = 1500;
/** ...and the sentences come at least this far apart, each saying everyone who started since the last one. */
const APART_MS = 10_000;

/**
 * Announces people as they start to need you, a sentence at a time ("The backend engineer and the QA engineer need
 * you."), leaving out anyone who no longer needs you by the time it is said. Whoever already needed you when the office
 * opened isn't news, and a replay says nothing.
 */
export function useNeedsYouAnnouncements(board: NowBoard | null, enabled: boolean, announce: (text: string) => void) {
  const known = useRef<Set<string> | null>(null);
  const pending = useRef(new Set<string>());
  const latest = useRef<NowBoard | null>(null);
  const timer = useRef<number | null>(null);
  const lastSaid = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!board) return;
    latest.current = board;
    const needing = new Set(board.needsYou.map((r) => r.key));
    const before = known.current;
    known.current = needing;
    if (!enabled || !before) return;
    for (const key of needing) if (!before.has(key)) pending.current.add(key);
    if (pending.current.size === 0 || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const rows = latest.current?.needsYou.filter((r) => pending.current.has(r.key)) ?? [];
      pending.current.clear();
      const sentence = needsYouSentence(rows);
      if (!sentence) return;
      lastSaid.current = Date.now();
      announce(sentence);
    }, Math.max(GATHER_MS, lastSaid.current + APART_MS - Date.now()));
  }, [board, enabled, announce]);

  useEffect(() => {
    const pendingTimer = timer;
    return () => {
      if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    };
  }, []);
}

/**
 * Says when a catch-up arrives ("Your catch-up is ready.") or fails, whichever tab is open; focus stays where it is. A
 * cancelled one says nothing, since whoever cancelled it knows, and neither do the ones there when the office opened.
 */
export function useCatchUpAnnouncements(aside: AsideView | null, announce: (text: string) => void) {
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!aside) return;
    const before = known.current;
    known.current = new Set(aside.digests.map((d) => d.id));
    if (!before) return;
    const arrived = aside.digests.find((d) => !before.has(d.id));
    if (!arrived) return;
    if (arrived.text !== null) announce('Your catch-up is ready.');
    else if (arrived.failure && arrived.failure.code !== 'cancelled') announce(`${CATCH_UP_FAILED} ${failureCopy(arrived.failure, 'the studio')}`);
  }, [aside, announce]);
}
