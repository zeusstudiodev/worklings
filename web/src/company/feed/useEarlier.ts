// "Show earlier lines" (docs/design-v3.md, "The feed", "Older lines"): asks the office for the 200 messages before the
// oldest the feed holds, a page at a time, and puts them in front of the view's own. One request at a time; a refusal
// with code `unknown` (the message has left what the office keeps) ends the feed like `more: false` does.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { refusalOf } from '../people/shared.tsx';
import { ActionError, type CompanyActions } from '../types.ts';
import { applyPage, cursorOf, type Earlier, NO_EARLIER, needsProbe, offersEarlier, type Probe, slideOut, withEarlier } from './feedView.ts';

export interface EarlierControl {
  /** The view with the earlier pages in front, for the lines. */
  company: CompanyView;
  /** The office keeps messages before the ones held (found by asking for one), or has handed over a page saying it has more. */
  canAsk: boolean;
  loading: boolean;
  /** Why the last ask failed, in the office's words; null when it didn't. */
  error: string | null;
  /** The office said nothing older is kept. */
  ended: boolean;
  /** How many messages the pages added, so the feed knows when new lines came from above. */
  added: number;
  show: () => void;
}

export function useEarlier(company: CompanyView, actions: Pick<CompanyActions, 'earlierMessages'>): EarlierControl {
  const [earlier, setEarlier] = useState<Earlier>(NO_EARLIER);
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  // Once a page is held or on its way, lines that slide out of the live view's window must stay in the feed.
  const [seen, setSeen] = useState(company);
  if (seen !== company) {
    setSeen(company);
    if (earlier.cursor !== null || state.loading) setEarlier((was) => slideOut(was, seen, company));
  }
  // Whether anything older than the view is kept: one message asked for, so the key is offered only when there is
  // something to show. An answer that can't be read leaves the key on, as before.
  const [probe, setProbe] = useState<Probe | null>(null);
  const busy = useRef(false);
  const latest = useRef({ company, earlier, actions });
  const alive = useRef(true);
  useEffect(() => {
    latest.current = { company, earlier, actions };
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const cursor = cursorOf(company, earlier);
  const probing = needsProbe(cursor, earlier, probe);
  useEffect(() => {
    if (!probing || cursor === null) return;
    let current = true;
    latest.current.actions.earlierMessages(cursor, 1).then(
      (page) => current && setProbe({ cursor, has: page.messages.length > 0 || page.more }),
      () => current && setProbe({ cursor, has: true }),
    );
    return () => {
      current = false;
    };
  }, [probing, cursor]);

  const show = useCallback(() => {
    if (busy.current) return;
    const { company: c, earlier: e, actions: a } = latest.current;
    const before = cursorOf(c, e);
    if (before === null || e.more === false) return;
    busy.current = true;
    setState({ loading: true, error: null });
    a.earlierMessages(before).then(
      (page) => {
        busy.current = false;
        if (!alive.current) return;
        setEarlier((was) => applyPage(was, page));
        setState({ loading: false, error: null });
      },
      (error: unknown) => {
        busy.current = false;
        if (!alive.current) return;
        if (error instanceof ActionError && error.code === 'unknown') {
          setEarlier((was) => ({ ...was, more: false }));
          setState({ loading: false, error: null });
          return;
        }
        setState({ loading: false, error: refusalOf(error) });
      },
    );
  }, []);

  const merged = useMemo(() => withEarlier(company, earlier), [company, earlier]);
  return {
    company: merged,
    canAsk: offersEarlier(earlier, probe),
    loading: state.loading,
    error: state.error,
    ended: earlier.more === false,
    added: earlier.messages.length,
    show,
  };
}
