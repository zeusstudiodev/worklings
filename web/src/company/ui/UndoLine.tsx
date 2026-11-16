// What a press leaves in place of what it answered or changed (docs/design-v3.md, "Undo, not confirm"): one line with a
// still mark, "Allowing once. Undo", until the change takes effect. After `until` the Undo goes; the caller then says
// what happened ("Allowed once at 14:32. Kai carries on."). If the Undo had focus as it went, focus moves on to the
// line or something near it (handOn.ts), never to the page.
import { type Ref, useRef } from 'react';
import { focusAfterLeaving } from './handOn.ts';
import { useReached } from './useReached.ts';

interface UndoLineProps {
  /** "Allowing once.", "Answering: Stripe.", "Changed." */
  text: string;
  onUndo: () => void;
  /** When the change takes effect (the hub's `appliesAt`), by this browser's clock; null when there is nothing to undo (the line only says it). */
  until: number | null;
  /** Focus goes here when a press turns an item into this line, so a keyboard can undo at once. */
  ref?: Ref<HTMLButtonElement>;
  /** Shown but not pressable (offline): the reconnecting line says why. */
  unavailable?: boolean;
}

/** Gives `value` to the caller's ref, and returns what takes it back. */
function share<T>(ref: Ref<T> | undefined, value: T): () => void {
  if (typeof ref === 'function') {
    const cleanup = ref(value);
    return typeof cleanup === 'function' ? cleanup : () => ref(null);
  }
  if (ref) {
    ref.current = value;
    return () => {
      ref.current = null;
    };
  }
  return () => undefined;
}

export function UndoLine({ text, onUndo, until, ref, unavailable = false }: UndoLineProps) {
  const over = useReached(until);
  // Undo hands focus to what the caller restores (the item's first button); only a window closing hands it on here.
  const pressed = useRef(false);
  const handOn = (el: HTMLElement) => () => {
    if (pressed.current || document.activeElement !== el) return;
    queueMicrotask(focusAfterLeaving(el));
  };
  return (
    <p className="undo-line" tabIndex={-1} ref={(el) => (el ? handOn(el) : undefined)}>
      <span className="undo-line__mark" aria-hidden="true" />
      <span className="undo-line__text">{text}</span>
      {!over && (
        <button
          ref={(el) => {
            if (!el) return undefined;
            const release = share(ref, el);
            const leave = handOn(el);
            return () => {
              release();
              leave();
            };
          }}
          type="button"
          className="link undo-line__undo"
          aria-disabled={unavailable || undefined}
          onClick={() => {
            if (unavailable) return;
            pressed.current = true;
            onUndo();
          }}
        >
          Undo
        </button>
      )}
    </p>
  );
}
