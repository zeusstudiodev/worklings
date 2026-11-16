// Dragging a row to a new place, for the plan's tasks and the board's priority: pointer events, so a mouse, a finger
// and a pen all work, from a handle that holds the drag (`touch-action: none` in CSS). The row follows the pointer, the
// nearest drop line is marked, the scroller scrolls near its edges, Escape puts it back. Rows keep their move buttons:
// this is the pointer's way, never the only one (WCAG 2.5.7).
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { type DropLine, edgeSpeed, nearestLine } from './drag.ts';

/** Reads the drop lines from the page when a drag starts; `yOf` gives an element's top in the scroller's content. */
export type ReadLines<S> = (area: HTMLElement, yOf: (el: Element) => number) => DropLine<S>[];

interface Callbacks<S> {
  read: ReadLines<S>;
  onDrop: (id: string, slot: S) => void;
}

/** The nearest ancestor that scrolls, else the page. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && at.scrollHeight > at.clientHeight) return at;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * `start(id, event)` goes on a handle's pointerdown, inside an element marked `data-drag-area` and a row marked
 * `data-drag-row`. While a drag runs, `dragging` is the row's id and `over` the slot it would land in.
 */
export function useDragMove<S>(read: ReadLines<S>, onDrop: (id: string, slot: S) => void) {
  const [state, setState] = useState<{ id: string; over: S | null } | null>(null);
  const latest = useRef<Callbacks<S>>({ read, onDrop });
  const end = useRef<(() => void) | null>(null);
  // The listeners a drag adds call whatever the latest render passed, so a drop uses the plan as it is now.
  useEffect(() => {
    latest.current = { read, onDrop };
  });
  // Leaving the view mid-drag ends the drag.
  useEffect(() => () => end.current?.(), []);

  const start = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (end.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const handle = event.currentTarget;
    const area = handle.closest<HTMLElement>('[data-drag-area]');
    const row = handle.closest<HTMLElement>('[data-drag-row]');
    if (!area || !row) return;
    event.preventDefault();
    const pointer = event.pointerId;
    const scroller = scrollerOf(area);
    const top = () => (scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top);
    const toContent = (clientY: number) => clientY - top() + scroller.scrollTop;
    const lines = latest.current.read(area, (el) => toContent(el.getBoundingClientRect().top));
    const startY = event.clientY;
    const startScroll = scroller.scrollTop;
    let lastY = startY;
    let frame: number | null = null;
    let over: DropLine<S> | null = nearestLine(lines, toContent(startY));

    const move = (clientY: number) => {
      lastY = clientY;
      row.style.transform = `translateY(${clientY - startY + (scroller.scrollTop - startScroll)}px)`;
      const next = nearestLine(lines, toContent(clientY));
      if (next !== over) {
        over = next;
        setState({ id, over: next?.slot ?? null });
      }
    };
    // Near an edge of the scroller, it scrolls, and the row keeps up with the pointer.
    const tick = () => {
      frame = null;
      const box = scroller === document.documentElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const speed = edgeSpeed(lastY, box.top, box.bottom);
      if (speed === 0) return;
      const before = scroller.scrollTop;
      scroller.scrollTop += speed;
      if (scroller.scrollTop !== before) move(lastY);
      frame = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      move(e.clientY);
      if (frame === null) frame = requestAnimationFrame(tick);
    };
    const finish = (drop: boolean) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      handle.removeEventListener('lostpointercapture', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (frame !== null) cancelAnimationFrame(frame);
      row.style.transform = '';
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      end.current = null;
      setState(null);
      if (drop && over) latest.current.onDrop(id, over.slot);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === pointer) finish(true);
    };
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    handle.setPointerCapture(pointer);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    handle.addEventListener('lostpointercapture', onCancel);
    window.addEventListener('keydown', onKey, true);
    end.current = () => finish(false);
    setState({ id, over: over?.slot ?? null });
  };

  return { dragging: state?.id ?? null, over: state?.over ?? null, start };
}
