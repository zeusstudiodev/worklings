// "Still office": the person's own switch for the office's motion, kept per browser. It does what prefers-reduced-motion
// does (the scene stops walking and typing, the CSS animations stop), for someone whose system setting is off or who
// wants this one office calm. WCAG 2.2.2: motion that starts by itself and lasts over five seconds can be stopped.
// The logic is in stillCore.ts; this file binds it to the page.
import { useSyncExternalStore } from 'react';
import { keepStill, markStill, parseStill, readStill, safeStorage, STILL_KEY } from './stillCore.ts';

export { STILL_KEY, stillWords } from './stillCore.ts';

const listeners = new Set<() => void>();
let current: boolean | null = null;
const storage = () => safeStorage(() => window.localStorage);

function snapshot(): boolean {
  if (current === null) {
    current = readStill(storage());
    markStill(document.documentElement, current);
  }
  return current;
}

export function setStill(on: boolean): void {
  current = on;
  markStill(document.documentElement, on);
  keepStill(storage(), on);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of the same browser changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STILL_KEY) return;
    current = parseStill(event.newValue);
    markStill(document.documentElement, current);
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** True when the person turned the office still in this browser. */
export const useStillOffice = (): boolean => useSyncExternalStore(subscribe, snapshot, () => false);
