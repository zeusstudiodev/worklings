// Small pieces the boards share: the company's rooms by name and
// whether a box scrolls sideways (a scrolling region needs to be reachable by keyboard; one that fits doesn't).
import { type RefObject, useEffect, useState } from 'react';
import type { Snapshot } from '../../../../src/core/snapshot.ts';

/** The rooms as the office names them: the studio's departments. */
export const roomsOf = (snapshot: Pick<Snapshot, 'studio'>): { id: string; name: string }[] => (snapshot.studio?.departments ?? []).map((d) => ({ id: d.id, name: d.name }));

/** True while the element is wider inside than it shows, so it scrolls sideways. */
export function useScrollsSideways(ref: RefObject<HTMLElement | null>): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    const inner = el.firstElementChild;
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, [ref]);
  return scrolls;
}
