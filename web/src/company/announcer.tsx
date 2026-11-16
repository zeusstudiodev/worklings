// The office's one polite live region (docs/design-v3.md, "Every panel", screen reader). News that arrives together is
// said as one sentence; your own actions' results are said at once. Rows, counts, status lines and the Timeline are
// never live. Each sentence is a node of its own, so a screen reader reads what was added, once.
import { useCallback, useEffect, useRef, useState } from 'react';
import { oneSentence } from './model.ts';

/** News this close together is said in one sentence... */
const GATHER_MS = 1_500;
/** ...and news comes at least this far apart, as v2's announcer does. */
const APART_MS = 10_000;
/** How long a sentence stays in the region after it was said (a removal isn't read out). */
const KEPT_MS = 8_000;

export interface Announcer {
  /** Says it now: the result of something you did. */
  announce: (text: string) => void;
  /** Says it with whatever else is news within the next moments. */
  news: (sentences: readonly string[]) => void;
  items: { id: number; text: string; at: number }[];
}

export function useAnnouncer(): Announcer {
  const [items, setItems] = useState<{ id: number; text: string; at: number }[]>([]);
  const last = useRef(0);
  const pending = useRef<string[]>([]);
  const timer = useRef<number | null>(null);
  const lastNews = useRef(Number.NEGATIVE_INFINITY);

  const say = useCallback((text: string) => {
    if (!text) return;
    last.current += 1;
    const item = { id: last.current, text, at: Date.now() };
    setItems((all) => [...all, item]);
  }, []);

  const news = useCallback(
    (sentences: readonly string[]) => {
      if (sentences.length === 0) return;
      pending.current.push(...sentences);
      if (timer.current !== null) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const all = pending.current.splice(0);
        lastNews.current = Date.now();
        say(oneSentence(all));
      }, Math.max(GATHER_MS, lastNews.current + APART_MS - Date.now()));
    },
    [say],
  );

  useEffect(() => {
    const oldest = items[0];
    if (!oldest) return;
    const id = window.setTimeout(() => setItems((all) => all.slice(1)), Math.max(0, oldest.at + KEPT_MS - Date.now()));
    return () => window.clearTimeout(id);
  }, [items]);

  useEffect(() => {
    const pendingTimer = timer;
    return () => {
      if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    };
  }, []);

  return { announce: say, news, items };
}

export function LiveRegion({ items }: { items: Announcer['items'] }) {
  return (
    <div className="visually-hidden" aria-live="polite" aria-relevant="additions" data-testid="announcer">
      {items.map((a) => (
        <p key={a.id}>{a.text}</p>
      ))}
    </div>
  );
}
