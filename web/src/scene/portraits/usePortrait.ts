import { useSyncExternalStore } from 'react';
import { portraits } from './store.ts';

/** A person's baked portrait (an object URL), or null where there is none yet: no stage, no WebGL, not baked. */
export function usePortrait(person: string | null): string | null {
  return useSyncExternalStore(portraits.subscribe, () => (person === null ? null : portraits.urlOf(person)));
}
