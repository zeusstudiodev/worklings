// Full screen bound to the page: the element shown full screen now, kept current as the browser enters and leaves it.
// The logic is in fullscreenCore.ts.
import { useSyncExternalStore } from 'react';

export { canFullscreen, enterFullscreen, fullscreenProblem, leaveFullscreen, toggleFullscreen } from './fullscreenCore.ts';

const subscribe = (listener: () => void) => {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
};

/** The element shown full screen now; the browser's own Escape leaving it included. */
export const useFullscreenElement = (): Element | null => useSyncExternalStore(subscribe, () => document.fullscreenElement, () => null);
