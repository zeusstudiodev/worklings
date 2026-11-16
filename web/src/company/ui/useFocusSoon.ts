import { useEffect, useRef } from 'react';

const WAIT_MS = 5000;

/**
 * Moves focus to what replaces a control the press removed, once it is in the page: the answer may arrive with the
 * stream after the press resolved. Call the returned function from the handler while the pressed control still has
 * focus; `find` answers null until the replacement is there. Focus moves only if nobody has moved it since (it fell to the page, or is still on that control); after a few
 * seconds the wish is dropped.
 */
export function useFocusSoon(): (find: () => HTMLElement | null) => void {
  const wanted = useRef<{ find: () => HTMLElement | null; from: Element | null; until: number } | null>(null);
  const settle = () => {
    const w = wanted.current;
    if (!w) return;
    const at = document.activeElement;
    const free = !at || at === document.body || !at.isConnected;
    if (Date.now() > w.until || (!free && at !== w.from)) {
      wanted.current = null;
      return;
    }
    const el = w.find();
    if (!el || (!free && el === at)) return;
    wanted.current = null;
    el.focus();
  };
  // After every render: the thing that replaces a control comes with a render.
  useEffect(settle);
  return (find) => {
    wanted.current = { find, from: document.activeElement, until: Date.now() + WAIT_MS };
  };
}
