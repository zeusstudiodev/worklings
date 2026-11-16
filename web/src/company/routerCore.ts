// The History API's rules for the office's addresses, without the browser: the history, the address and what has focus
// come in as parts, so tests drive them with a fake. router.ts binds them to the page.
//
// An address is its path and its query (the side panel's view rides in `?panel=`), less what means something only on
// arrival: the CLI's `?token=` and `?demo`. Every change of address pushes an entry, a change of the side panel's view
// alone included, so Back returns to the place before it, even one the person had open earlier; only an address put
// right to what shows (the proposal while the CEO drafts, the inbox a phone opens on) replaces one. Closing something
// goes back when the entry before is where closing leads, else goes there as a new entry, so Back reopens what was
// closed; a panel's own Back is the browser's Back when the view came from inside the office. The entry being left keeps what had focus, and Back to it puts
// focus there again; Forward opens again what Back closed, with focus on its title, so each entry keeps its place in the
// history to tell the two apart. An entry remembers it was shown, so Back, Forward and a reload open it as it was left
// rather than as a fresh arrival.

/** How an element is found again when Back returns to its page: its data-focus, its id, or its words. */
export interface FocusKey {
  focus?: string;
  id?: string;
  text?: string;
}

export interface Location {
  path: string;
  /** The address's query as the address bar has it ("?panel=people/kai"), "" for none. */
  search: string;
  /** Its hash ("#q-3"), "" for none: only old addresses carry one. */
  hash: string;
  /** The address of the entry this one was pushed from, as it was left; null when opened from outside the office. */
  prev: string | null;
  /** The mark of an entry pushed at the same address for a sheet over it (a phone's feed or inbox); null for none. */
  mark: string | null;
  /** Changes on every navigation, Back included. */
  key: number;
  /** After a Back: what had focus when the entry was left, to put focus on again. Forward has none: the view's title takes it. */
  restore: FocusKey | null;
  /**
   * True when the view is one the person comes back to (Back, Forward, a panel's Back, a reload) rather than one they
   * open: it opens as it was left, with no redirect an arrival makes (a phone opening on the inbox) and focus put back.
   */
  returned: boolean;
  /** True when closing something went to the place it leads as a new entry (`goBack` with somewhere else before it). */
  closed: boolean;
}

/** The parts of the browser the rules use: window.history, window.location, and the element that has focus. */
export interface RouterBrowser {
  history: {
    readonly state: unknown;
    pushState(state: unknown, unused: string, url: string): void;
    replaceState(state: unknown, unused: string, url: string): void;
    back(): void;
  };
  location: { readonly pathname: string; readonly search: string; readonly hash: string };
  /** What has focus now, as a key Back can find it by again; null for nothing worth keeping. */
  focusKey(): FocusKey | null;
  /** Listens to popstate, handing over the entry's state; returns what stops listening. */
  listenPop(onPop: (state: unknown) => void): () => void;
}

export interface NavigateOptions {
  /** Puts the address in place of the entry shown, for an address put right to what shows. */
  replace?: boolean;
  /**
   * The key of the location the caller drew. A navigation made for a place the person has since left (Back, Forward)
   * is out of date and does nothing: a view's effect can run after the address moved on, and must not take it back.
   */
  at?: number;
  /**
   * Pushes the address shown again, marked, for a sheet over the page (a phone's feed or inbox) that Back and the
   * iPhone's back swipe should close. A reload of that entry shows the page without it.
   */
  mark?: string;
}

export interface Router {
  navigate(address: string, options?: NavigateOptions): void;
  goBack(to: string): void;
  backToOpener(fallback: string): void;
  /** Closes a sheet a marked entry holds: the browser's Back when the entry shown carries `mark`, else nothing. */
  unmark(mark: string): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): Location;
}

interface EntryState {
  worklings: true;
  /**
   * The address of the entry this one was pushed from, so closing can tell whether Back leads where it should and a
   * panel's Back is the browser's; null when the entry was opened from outside the office.
   */
  prev: string | null;
  /** What had focus when this entry was left. */
  focus: FocusKey | null;
  /** Set once the entry has been shown, so coming back to it (Back, Forward, a reload) isn't a fresh arrival. */
  shown?: true;
  /** A sheet's mark on an entry pushed at the same address (NavigateOptions.mark). */
  mark?: string;
  /** Its place in the history: one more than the entry it was pushed from, so a traversal tells Forward from Back. */
  n?: number;
}

const isEntryState = (v: unknown): v is EntryState => typeof v === 'object' && v !== null && 'worklings' in v && v.worklings === true;

/** Query parameters that mean something only on arrival: the token the CLI's link carries, and `?demo`. */
const ARRIVAL_ONLY = new Set(['token', 'demo']);

/** A query parameter's name, as the query's own rules read it. */
const nameOf = (pair: string): string => [...new URLSearchParams(pair).keys()][0] ?? '';

/** An address as an entry keeps it: as it is, less the parameters that mean something only on arrival. */
function kept(pathname: string, search: string, hash: string): string {
  const query = search
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => pair !== '' && !ARRIVAL_ONLY.has(nameOf(pair)));
  return `${pathname}${query.length > 0 ? `?${query.join('&')}` : ''}${hash}`;
}

/** What makes two addresses the same place: the path and the query's values, read, less the arrival-only ones. */
function placeOf(address: string): string {
  const url = new URL(address, 'http://office.invalid');
  const query = [...url.searchParams].filter(([name]) => !ARRIVAL_ONLY.has(name)).map(([name, value]) => `${name}=${value}`);
  return `${url.pathname}?${query.join('&')}`;
}

export function createRouter(browser: RouterBrowser): Router {
  const { history, location } = browser;
  let counter = 0;
  /** The place in the history of the entry last read. */
  let position = 0;
  const listeners = new Set<() => void>();
  let current: Location | null = null;
  let stopListening: (() => void) | null = null;

  const entryState = (): EntryState | null => (isEntryState(history.state) ? history.state : null);
  /** The address as it stands, so a change to the entry's state alone leaves it as it is. */
  const here = () => `${location.pathname}${location.search}${location.hash}`;
  const isHere = (address: string) => placeOf(address) === placeOf(here());

  /**
   * The address now. `returned` is how it was reached when the caller knows (a navigation, a Back); otherwise, on the
   * page's first read, the entry says whether it was shown before (a reload). An entry not marked shown is marked now.
   */
  function read(restore: FocusKey | null, returned?: boolean, closed = false): Location {
    counter += 1;
    const state = entryState();
    const shown = state?.shown === true;
    // The page's first read of a marked entry is a reload: the sheet it held isn't open on the new page, so neither is the mark.
    const reloadedMark = returned === undefined && state?.mark !== undefined;
    position = state?.n ?? 0;
    if (!shown || reloadedMark) history.replaceState({ worklings: true, prev: state?.prev ?? null, focus: state?.focus ?? null, shown: true, n: position } satisfies EntryState, '', here());
    const mark = reloadedMark ? null : (entryState()?.mark ?? null);
    return { path: location.pathname, search: location.search, hash: location.hash, prev: state?.prev ?? null, mark, key: counter, restore, returned: returned ?? shown, closed };
  }

  function emit(next: Location) {
    current = next;
    for (const listener of listeners) listener();
  }

  /** Pushes `address`. The entry being left keeps its query (the side panel's view) and what had focus, so Back returns to the place as it was. */
  function push(address: string, mark?: string) {
    const was = entryState();
    const at = was?.n ?? position;
    const left = kept(location.pathname, location.search, location.hash);
    history.replaceState({ worklings: true, prev: was?.prev ?? null, focus: browser.focusKey(), shown: true, n: at, ...(was?.mark !== undefined ? { mark: was.mark } : {}) } satisfies EntryState, '', left);
    history.pushState({ worklings: true, prev: left, focus: null, shown: true, n: at + 1, ...(mark !== undefined ? { mark } : {}) } satisfies EntryState, '', address);
  }

  function navigate(address: string, options: NavigateOptions = {}) {
    if (options.at !== undefined && current !== null && current.key !== options.at) return;
    if (options.mark !== undefined) {
      if (!isHere(address) || entryState()?.mark === options.mark) return;
      push(address, options.mark);
    } else if (isHere(address)) {
      return;
    } else if (options.replace) {
      history.replaceState({ worklings: true, prev: entryState()?.prev ?? null, focus: null, shown: true, n: entryState()?.n ?? position } satisfies EntryState, '', address);
    } else {
      push(address);
    }
    emit(read(null, false));
  }

  function goBack(to: string) {
    // Nothing is open to close: an entry put right in place can share the place of the one before it.
    if (isHere(to)) return;
    const prev = entryState()?.prev ?? null;
    if (prev !== null && placeOf(prev) === placeOf(to)) {
      history.back();
      return;
    }
    // Somewhere else is before it: closing goes to `to` as a new entry, so Back reopens what was closed.
    push(to);
    emit(read(null, true, true));
  }

  function backToOpener(fallback: string) {
    if (entryState()?.prev) {
      history.back();
      return;
    }
    if (isHere(fallback)) return;
    history.replaceState({ worklings: true, prev: null, focus: null, shown: true, n: entryState()?.n ?? position } satisfies EntryState, '', fallback);
    emit(read(null, true));
  }

  function unmark(mark: string) {
    if (entryState()?.mark === mark) history.back();
  }

  const onPop = (state: unknown) => {
    const entry = isEntryState(state) ? state : null;
    // What had focus when the entry was left is for coming back to it; Forward reopens it with focus on its title.
    const forward = entry?.n !== undefined && entry.n > position;
    emit(read(entry !== null && !forward ? entry.focus : null, true));
  };

  function subscribe(listener: () => void): () => void {
    stopListening ??= browser.listenPop(onPop);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0 || !stopListening) return;
      stopListening();
      stopListening = null;
    };
  }

  function getSnapshot(): Location {
    current ??= read(null);
    return current;
  }

  return { navigate, goBack, backToOpener, unmark, subscribe, getSnapshot };
}
