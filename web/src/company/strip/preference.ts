// "Show the live strip" (docs/design-v3.md, "The live strip"): one preference for this browser. Since v0.8 (SPEC-v0.8.md,
// decision 1) the strip is off by default, its lines all in the feed; More turns it on. A browser that chose to hide it
// before keeps it hidden. Storage that is switched off or blocked leaves it hidden, and More still shows it for as long as
// the page is open.
import { useSyncExternalStore } from 'react';

const KEY = 'worklings-live-strip';

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'shown';
  } catch {
    return true;
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
    hidden = event.newValue !== 'shown';
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
    if (next) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, 'shown');
  } catch {
    // Kept for this page only where storage is switched off.
  }
  for (const listener of listeners) listener();
}

/** Whether the live strip is hidden, and the setter the Company menu's "Hide the live strip" uses. */
export function useLiveStripHidden(): [hidden: boolean, setHidden: (hidden: boolean) => void] {
  return [useSyncExternalStore(subscribe, current, () => true), setLiveStripHidden];
}
