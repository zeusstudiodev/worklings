// The shell's hooks over the browser: the window's size and the layout it gets, and the side panel's one preference kept
// in this browser (docs/design-v3.md, "The side panel": Memory). Storage that is blocked or switched off gives the defaults
// and keeps a change for as long as the page is open.
import { useCallback, useState, useSyncExternalStore } from 'react';
import { layoutOf, PANEL_MEMORY_KEY, type PanelMemory, readPanelMemory, type ShellLayout, writePanelMemory } from './sidePanelModel.ts';

let size = { width: 0, height: 0 };
const readSize = () => {
  if (size.width !== window.innerWidth || size.height !== window.innerHeight) size = { width: window.innerWidth, height: window.innerHeight };
  return size;
};
const onResize = (listener: () => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};

/** The window's size, kept current; the same object until it changes. */
export const useWindowSize = (): { width: number; height: number } => useSyncExternalStore(onResize, readSize, () => size);

/** Which layout the window gets: docked, floating, the phone's or its short form. */
export function useShellLayout(): ShellLayout {
  const { width, height } = useWindowSize();
  return layoutOf(width, height);
}

function readStored(): PanelMemory {
  try {
    return readPanelMemory(window.localStorage.getItem(PANEL_MEMORY_KEY));
  } catch {
    return readPanelMemory(null);
  }
}

/** The side panel's width and whether it is hidden, as this browser keeps them. */
/** The side panel's kept preference, and what changes it: a change to its width, whether it is hidden, or both at once. */
export function usePanelMemory(): [PanelMemory, (change: Partial<PanelMemory>) => void] {
  const [memory, setMemory] = useState(readStored);
  // Each change lands on the latest memory, so two in one event (pulled out to a width, and shown) both hold.
  const keep = useCallback((change: Partial<PanelMemory>) => {
    setMemory((was) => {
      const next = { ...was, ...change };
      try {
        window.localStorage.setItem(PANEL_MEMORY_KEY, writePanelMemory(next));
      } catch {
        // Storage is blocked: the change holds until the page reloads.
      }
      return next;
    });
  }, []);
  return [memory, keep];
}
