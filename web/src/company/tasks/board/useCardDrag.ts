// Carrying a note across the task board with the pointer (docs/design-v3.md, "Dragging"; the feasibility review's "The
// task board"): the whole note is the target. A press that moves less than 4 px opens the task (the link's own click); a
// 4 px move starts a mouse drag; on touch screens a 400 ms hold without moving starts one, and from then on the page
// doesn't scroll under the finger. Only a copy of the note moves, with the pointer; the board draws where it would land.
// Near the board's edges it scrolls, sideways and down. Escape, or letting go outside the board, puts it back.
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { edgeSpeed } from '../../plan/drag.ts';
import type { ColumnId } from './columns.ts';

/** Where a carried note is over: a column (in a lane), and the card it would land before; null when over nothing. */
export interface DragOver {
  column: ColumnId;
  /** The lane's key, "" without lanes. */
  lane: string;
  before: string | null;
  /** Over the Cancelled rail, which opens under it. */
  rail: boolean;
}

interface DragCallbacks {
  /** The board's root: letting go outside it puts the card back. */
  root: () => HTMLElement | null;
  /** Whether this card lifts now: an open task's, while the office can be steered and reached. */
  canStart: (id: string) => boolean;
  onStart: (id: string) => void;
  onOver: (over: DragOver | null) => void;
  /** Let go over `over` (null: outside the board). True when it landed there; false when it goes back. */
  onDrop: (over: DragOver | null) => boolean;
  /** Escape, a lost pointer, or the board going away: it goes back. */
  onCancel: () => void;
}

const MOUSE_SLOP = 4;
const TOUCH_SLOP = 10;
const HOLD_MS = 400;

/**
 * The note in the hand goes: where it landed the board draws it at once; where it goes back (refused, Escape, let go
 * outside), it flies back to its place first (design-hud's motion: 220 ms), or just goes with reduced motion or Still
 * office.
 */
function flyBack(avatar: HTMLElement, note: HTMLElement, landed: boolean) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.still === 'on';
  if (landed || still || !note.isConnected || typeof avatar.animate !== 'function') {
    avatar.remove();
    return;
  }
  const home = note.getBoundingClientRect();
  const flight = avatar.animate([{ transform: avatar.style.transform }, { transform: `translate(${home.left}px, ${home.top}px)` }], { duration: 220, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
  const remove = () => avatar.remove();
  flight.addEventListener('finish', remove);
  flight.addEventListener('cancel', remove);
}

/**
 * `start(id, event)` goes on a note's pointerdown. Notes carry `data-tb-note`, the places they can land `data-tb-cell`
 * (with `data-tb-column`, `data-tb-lane`, and `data-tb-rail` on the closed Cancelled rail), the cards in them
 * `data-tb-card`; the sideways scroller is `data-tb-hscroll` and the ones that scroll down `data-tb-vscroll`.
 */
export function useCardDrag(callbacks: DragCallbacks) {
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });
  const active = useRef<{ stop: () => void } | null>(null);
  // Leaving the board mid-drag puts the card back.
  useEffect(() => () => active.current?.stop(), []);

  const start = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (active.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // Move and the note's key (a button, or Answer's link) are presses of their own; the title's link is the note's.
    if (event.target instanceof Element && event.target.closest('button, select, input, textarea, a:not(.tb-note__link)')) return;
    if (!latest.current.canStart(id)) return;
    const note = event.currentTarget;
    const pointer = event.pointerId;
    const touch = event.pointerType !== 'mouse';
    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let started = false;
    let hold: number | null = null;
    let frame: number | null = null;
    let avatar: HTMLElement | null = null;
    let offsetX = 0;
    let offsetY = 0;
    let over: DragOver | null = null;

    const overAt = (x: number, y: number): DragOver | null | 'keep' => {
      const root = latest.current.root();
      if (!root) return null;
      const box = root.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-tb-cell]');
      // Between columns, over a lane's ribbon or the head: it stays where it was.
      if (!cell || !root.contains(cell)) return 'keep';
      const column = cell.dataset.tbColumn as ColumnId | undefined;
      if (!column) return 'keep';
      const lane = cell.dataset.tbLane ?? '';
      if (cell.dataset.tbRail !== undefined) return { column, lane, before: null, rail: true };
      let before: string | null = null;
      for (const card of cell.querySelectorAll<HTMLElement>('[data-tb-card]')) {
        if (card.dataset.tbCard === id) continue;
        const r = card.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          before = card.dataset.tbCard ?? null;
          break;
        }
      }
      return { column, lane, before, rail: false };
    };

    // Said on every move, not only on a change: the board drops what changes nothing, and a report that reached it
    // before it had drawn the lift isn't lost.
    const report = () => {
      const next = overAt(lastX, lastY);
      if (next === 'keep') return;
      over = next;
      latest.current.onOver(next);
    };

    // Near an edge of the board it scrolls sideways; near the top or foot of the column under it, down or up.
    const tick = () => {
      frame = null;
      const root = latest.current.root();
      if (!root || !started) return;
      let moved = false;
      const sideways = root.querySelector<HTMLElement>('[data-tb-hscroll]');
      if (sideways) {
        const b = sideways.getBoundingClientRect();
        const speed = edgeSpeed(lastX, b.left, b.right);
        const was = sideways.scrollLeft;
        if (speed !== 0) sideways.scrollLeft += speed;
        moved ||= sideways.scrollLeft !== was;
      }
      const down = document.elementFromPoint(lastX, lastY)?.closest<HTMLElement>('[data-tb-vscroll]') ?? root.querySelector<HTMLElement>('[data-tb-vscroll][data-tb-hscroll]');
      if (down) {
        const b = down.getBoundingClientRect();
        const speed = edgeSpeed(lastY, b.top, b.bottom);
        const was = down.scrollTop;
        if (speed !== 0) down.scrollTop += speed;
        moved ||= down.scrollTop !== was;
      }
      if (moved) {
        report();
        frame = requestAnimationFrame(tick);
      }
    };

    const follow = () => {
      if (avatar) avatar.style.transform = `translate(${lastX - offsetX}px, ${lastY - offsetY}px)`;
      report();
      if (frame === null) frame = requestAnimationFrame(tick);
    };

    const begin = () => {
      started = true;
      if (hold !== null) window.clearTimeout(hold);
      hold = null;
      const box = note.getBoundingClientRect();
      offsetX = startX - box.left;
      offsetY = startY - box.top;
      // The note in the hand: a copy, so the one in the column can keep its place as an outline.
      const wrap = document.createElement('div');
      wrap.className = 'tb-avatar';
      wrap.setAttribute('aria-hidden', 'true');
      const copy = note.cloneNode(true) as HTMLElement;
      copy.classList.add('tb-avatar__note');
      copy.removeAttribute('data-tb-note');
      copy.style.width = `${box.width}px`;
      for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
      for (const el of copy.querySelectorAll('a, button')) el.setAttribute('tabindex', '-1');
      wrap.append(copy);
      document.body.append(wrap);
      avatar = wrap;
      if (!note.hasPointerCapture(pointer)) note.setPointerCapture(pointer);
      window.addEventListener('touchmove', holdStill, { passive: false });
      window.addEventListener('keydown', onKey, true);
      latest.current.onStart(id);
      follow();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!started) {
        const far = Math.hypot(lastX - startX, lastY - startY);
        // On touch, moving before the hold is a scroll: the browser takes it.
        if (touch) {
          if (far > TOUCH_SLOP) end(false);
          return;
        }
        if (far < MOUSE_SLOP) return;
        begin();
        return;
      }
      follow();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!started) {
        end(false);
        return;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      const at = overAt(lastX, lastY);
      end(true, at === 'keep' ? over : at);
    };

    const onLost = (e: PointerEvent) => {
      if (e.pointerId === pointer) end(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Taken here, before the shell's handler: Escape puts the card back and nothing else closes.
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };

    // From the moment the hold lifts the note, the page stays still under the finger.
    const holdStill = (e: TouchEvent) => {
      if (started) e.preventDefault();
    };
    // A long press would open the browser's menu for the link.
    const noMenu = (e: Event) => e.preventDefault();

    // After a drag, the click that ends it isn't a press on the note's link.
    const swallowClick = () => {
      const swallow = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };

    function end(drop: boolean, at: DragOver | null = null) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onLost);
      window.removeEventListener('touchmove', holdStill);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', noMenu, true);
      if (hold !== null) window.clearTimeout(hold);
      if (frame !== null) cancelAnimationFrame(frame);
      if (note.hasPointerCapture(pointer)) note.releasePointerCapture(pointer);
      active.current = null;
      if (!started) {
        avatar?.remove();
        return;
      }
      swallowClick();
      let landed = false;
      if (drop) landed = latest.current.onDrop(at);
      else latest.current.onCancel();
      if (avatar) flyBack(avatar, note, landed);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onLost);
    if (touch) {
      window.addEventListener('contextmenu', noMenu, true);
      hold = window.setTimeout(begin, HOLD_MS);
    }
    active.current = { stop: () => end(false) };
  };

  /** Puts a carried card back from outside the pointer's handlers (the company changed under it, the office went away). */
  const cancel = () => active.current?.stop();

  return { start, cancel };
}
