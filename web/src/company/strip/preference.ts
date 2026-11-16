// "Hide the live strip" (docs/design-v3.md, "The live strip"): one preference for this browser, for anyone the moving
// lines distract (WCAG 2.2.2). The Company menu sets it and the strip reads it, both through this hook. Storage that is
// switched off or blocked leaves the strip shown, and the menu still hides it for as long as the page is open.
import { useSyncExternalStore } from 'react';

const KEY = 'worklings-live-strip';

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'hidden';
  } catch {
    return false;
  }
}

let hidden: boolean | null = null;
const listeners = new Set<() => void>();

const current = (): boolean => (hidden ??= read());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of this browser changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    hidden = event.newValue === 'hidden';
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setLiveStripHidden(next: boolean): void {
  hidden = next;
  try {
    if (next) window.localStorage.setItem(KEY, 'hidden');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Kept for this page only where storage is switched off.
  }
  for (const listener of listeners) listener();
}

/** Whether the live strip is hidden, and the setter the Company menu's "Hide the live strip" uses. */
export function useLiveStripHidden(): [hidden: boolean, setHidden: (hidden: boolean) => void] {
  return [useSyncExternalStore(subscribe, current, () => false), setLiveStripHidden];
}
