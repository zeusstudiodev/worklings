// The shell's keys (docs/design-v3.md, "The shell": Escape, and "The office view": Enter). Escape is one handler, by where
// focus is: what handles Escape itself (a list, a menu, a drop form, a lifted card, the palette, a popover, the talk bar
// and the feed in `[data-dock]`) takes it first and prevents it, and the side panel takes nothing past that. Here,
// what is left: on a board or on nothing while one is open, the board closes; on nothing with nothing open, a company's
// walk-in skips. Enter on nothing puts focus in the talk bar, a game's "Enter to talk".
import { useEffect, useEffectEvent } from 'react';

/** Focus on nothing: the page itself, or the 3D office's canvas. */
export function onNothing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return target === document.body || target === document.documentElement || target.closest('.stage') !== null;
}

/** Whether a key is the shell's to act on: not taken already, and not inside a piece that keeps its own keys. */
function shellOwns(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target;
  if (target instanceof Element && target.closest('[data-dock], #company-panel, dialog, [role="dialog"], [popover]')) return false;
  return document.querySelector(':popover-open') === null;
}

export interface ShellKeys {
  /** A board, Preview or a diff fills the main view: Escape closes it. */
  mainOpen: boolean;
  closeMain: () => void;
  /** A company's walk-in, while anyone still walks to their desk: Escape seats them. */
  skip: (() => void) | null;
  /** Enter on nothing: focus to the talk bar's box. */
  talk: () => void;
}

export function useShellKeys(keys: ShellKeys): void {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!shellOwns(event)) return;
    const nothing = onNothing(event.target);
    if (event.key === 'Escape') {
      const inMain = event.target instanceof Element && event.target.closest('[data-main-view]') !== null;
      if (keys.mainOpen && (inMain || nothing)) {
        event.preventDefault();
        keys.closeMain();
      } else if (!keys.mainOpen && nothing && keys.skip) {
        keys.skip();
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && nothing) {
      event.preventDefault();
      keys.talk();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
