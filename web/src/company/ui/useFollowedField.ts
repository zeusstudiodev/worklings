// A number field for a setting the office keeps current, which another tab may change: it follows the office's value
// while it isn't being edited. What you type stays until it is saved; a saved value shows at once and stays until the
// stream brings it, so the field doesn't flick back to the old value in between.
import { useState } from 'react';

export interface Followed {
  /** What the field shows. */
  text: string;
  /** The office's value the field last took. */
  from: number;
  /** Typed in since it last took the office's value or was saved. */
  typed: boolean;
}

/** The field once the office says `current`: it takes it, unless it holds something else you typed. */
export function follow(field: Followed, current: number): Followed {
  const editing = field.typed && field.text.trim() !== String(field.from);
  return editing || field.from === current ? field : { text: String(current), from: current, typed: false };
}

/** Typed into the field: it stops following until it is saved. */
export const typedIn = (field: Followed, text: string): Followed => ({ ...field, text, typed: true });

/** Saved: the field shows `value` and follows again. It keeps the value it took last, so the stream's next one, this, is taken when it comes. */
export const savedAs = (field: Followed, value: number): Followed => ({ text: String(value), from: field.from, typed: false });

export function useFollowedField(current: number): { text: string; type: (text: string) => void; saved: (value: number) => void } {
  const [field, setField] = useState<Followed>(() => ({ text: String(current), from: current, typed: false }));
  const shown = follow(field, current);
  if (shown !== field) setField(shown);
  return {
    text: shown.text,
    type: (text) => setField((f) => typedIn(f, text)),
    saved: (value) => setField((f) => savedAs(f, value)),
  };
}
