// The "Still office" switch without the browser: what it keeps, how it reads and what it says, against the small parts
// of storage and the page it needs, so tests drive it without a DOM. still.ts binds it to the page.

export const STILL_KEY = 'worklings-still-office';

/** What the storage holds: only the word "on" means on, so a stale or odd value leaves the office moving. */
export const parseStill = (value: string | null | undefined): boolean => value === 'on';

/** What the live region says when the switch moves. */
export const stillWords = (on: boolean): string => (on ? 'Still office on. The office stops moving.' : 'Still office off. The office moves again.');

/** The part of localStorage the switch uses. */
export interface StillStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The part of the page the switch marks for the CSS. */
export interface StillRoot {
  dataset: Record<string, string | undefined>;
}

/** localStorage as `get` finds it, or storage that keeps nothing where the browser blocks it (the getter itself throws then). */
export function safeStorage(get: () => StillStorage): StillStorage {
  try {
    return get();
  } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
}

export function readStill(storage: StillStorage): boolean {
  try {
    return parseStill(storage.getItem(STILL_KEY));
  } catch {
    // Storage blocked (private mode, a policy): the office moves until the switch is used this visit.
    return false;
  }
}

export function keepStill(storage: StillStorage, on: boolean): void {
  try {
    if (on) storage.setItem(STILL_KEY, 'on');
    else storage.removeItem(STILL_KEY);
  } catch {
    // Storage blocked: the switch holds for this visit only, kept in memory by still.ts.
  }
}

/** The same switch for the CSS: an attribute on the page, which styles.css reads like the media query. */
export function markStill(root: StillRoot, on: boolean): void {
  if (on) root.dataset.still = 'on';
  else delete root.dataset.still;
}
