// Moving between addresses (address.ts) with the History API: routerCore.ts's rules bound to the page. Every change of
// address pushes an entry, the side panel's view (`?panel=`) included, so Back returns to the place before it; only an
// address put right to what shows replaces one. The entry being left keeps which element had focus, and going back puts
// focus there again.
import { useSyncExternalStore } from 'react';
import { createRouter, type FocusKey, type Location, type NavigateOptions } from './routerCore.ts';

export {
  type Address,
  type CompanyAddress,
  companyHref,
  companyPath,
  type CompanyRoute,
  type MainView,
  openSub,
  type PanelView,
  parseAddress,
  parseCompanyAddress,
  routePath,
  type TabbedRoute,
  type TalkIntent,
} from './address.ts';
export type { FocusKey, Location, NavigateOptions } from './routerCore.ts';

function focusKeyOf(element: Element | null): FocusKey | null {
  if (!(element instanceof HTMLElement) || element === document.body) return null;
  if (element.dataset.focus) return { focus: element.dataset.focus };
  if (element.id) return { id: element.id };
  const text = wordsOf(element);
  return text ? { text } : null;
}

/** An element's words: its text, or its name where it is a glyph alone (the views' links when their words give way). */
function wordsOf(element: HTMLElement): string {
  return (element.textContent?.trim() || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 80);
}

/** Puts focus back on the element a focus key names, if it is on the page. True when it found it. */
export function restoreFocus(key: FocusKey, within: ParentNode = document): boolean {
  let target: HTMLElement | null = null;
  if (key.focus) target = within.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key.focus)}"]`);
  if (!target && key.id) target = document.getElementById(key.id);
  if (!target && key.text) {
    for (const el of within.querySelectorAll<HTMLElement>('button, a[href], [tabindex]')) {
      if (wordsOf(el) === key.text) {
        target = el;
        break;
      }
    }
  }
  if (!target) return false;
  target.focus({ preventScroll: false });
  return document.activeElement === target;
}

const router = createRouter({
  history: window.history,
  location: window.location,
  focusKey: () => focusKeyOf(document.activeElement),
  listenPop: (onPop) => {
    const listener = (event: PopStateEvent) => onPop(event.state);
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  },
});

/**
 * Goes to an address, its path and query. A new entry is pushed and the one left keeps what had focus; `replace` swaps
 * the current entry instead, for an address put right to what shows, and `at` (the drawn location's key) drops it once
 * the person has moved on. The address shown already adds nothing. To close something, use goBack.
 */
export const navigate: (address: string, options?: NavigateOptions) => void = router.navigate;

/**
 * Closes something to `to`, where closing it leads (the side panel's Close: the address without `?panel=`): the
 * browser's Back when the entry before is that place, so focus goes back to its opener; otherwise `to` as a new entry,
 * so Back reopens what was closed.
 */
export const goBack: (to: string) => void = router.goBack;

/**
 * Back, as a panel's own Back button does it: to whatever opened this view (focus goes back to its opener), or to
 * `fallback` in place when the view was opened from outside the office (a link, a reload).
 */
export const backToOpener: (fallback: string) => void = router.backToOpener;

/** Closes a phone's sheet that a marked entry holds (the feed, the inbox): Back when the entry shown carries `mark`. */
export const unmark: (mark: string) => void = router.unmark;

/**
 * The address, kept current through navigate() and the browser's Back and Forward. An external store, so a navigation a
 * child makes while the app first mounts is seen too.
 */
export function useLocation(): Location {
  return useSyncExternalStore(router.subscribe, router.getSnapshot);
}
