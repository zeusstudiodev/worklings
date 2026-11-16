// The office's history rules (web/src/company/routerCore.ts) against a fake browser history: every view opened is an
// entry, tabs included, and one opened again too, and so is a change of the side panel's view in the query; Back
// returns to the view before it, query and all; closing goes back only when the entry before is where it leads; a
// panel's Back is the browser's Back, or its fallback in place; a view come back to (Back, Forward, a reload) knows it,
// so a phone doesn't open the inbox over it again. Last, the static demo's base path (web/src/site/base.ts).
import { describe, expect, it } from 'vitest';
import { peeksAt } from '../web/src/company/panelView.ts';
import { createRouter, type FocusKey, type RouterBrowser } from '../web/src/company/routerCore.ts';
import { underBase } from '../web/src/site/base.ts';

interface Entry {
  path: string;
  search: string;
  hash: string;
  state: unknown;
}

const split = (url: string): Omit<Entry, 'state'> => {
  const u = new URL(url, 'http://127.0.0.1');
  return { path: u.pathname, search: u.search, hash: u.hash };
};

/**
 * A tab's session history as browsers keep it: entries and where the tab is in them. A traversal (Back, Forward,
 * history.back()) is asynchronous, as in a browser, and lands when `settle` runs; popstate then hands over the state.
 */
function fakeBrowser(start = '/') {
  const entries: Entry[] = [{ ...split(start), state: null }];
  let index = 0;
  const pops = new Set<(state: unknown) => void>();
  const pending: number[] = [];
  let focused: FocusKey | null = null;
  const entry = (): Entry => {
    const e = entries[index];
    if (!e) throw new Error('no entry');
    return e;
  };
  const browser: RouterBrowser = {
    history: {
      get state() {
        return entry().state;
      },
      pushState(state, _unused, url) {
        entries.splice(index + 1);
        entries.push({ ...split(url), state: structuredClone(state) });
        index = entries.length - 1;
      },
      replaceState(state, _unused, url) {
        entries[index] = { ...split(url), state: structuredClone(state) };
      },
      back() {
        pending.push(-1);
      },
    },
    location: {
      get pathname() {
        return entry().path;
      },
      get search() {
        return entry().search;
      },
      get hash() {
        return entry().hash;
      },
    },
    focusKey: () => focused,
    listenPop(onPop) {
      pops.add(onPop);
      return () => pops.delete(onPop);
    },
  };
  return {
    browser,
    /** The browser's own Back and Forward. */
    back: () => pending.push(-1),
    forward: () => pending.push(1),
    /** Lets every traversal asked for so far land, firing popstate for each. */
    settle() {
      for (let step = pending.shift(); step !== undefined; step = pending.shift()) {
        const to = index + step;
        if (to < 0 || to >= entries.length) continue;
        index = to;
        for (const pop of pops) pop(structuredClone(entry().state));
      }
    },
    paths: () => entries.map((e) => e.path),
    /** Every entry's whole address: its path, query and hash. */
    urls: () => entries.map((e) => `${e.path}${e.search}${e.hash}`),
    url: () => `${entry().path}${entry().search}${entry().hash}`,
    focus: (key: FocusKey | null) => {
      focused = key;
    },
  };
}

/** A router on a fake browser, listening as the app does once it renders. */
function office(start = '/') {
  const b = fakeBrowser(start);
  const router = createRouter(b.browser);
  router.subscribe(() => undefined);
  router.getSnapshot();
  return { ...b, router, location: () => router.getSnapshot() };
}

describe("the office's history", () => {
  it('pushes an entry for every view opened, a tab included, so Back returns to the view before it', () => {
    const o = office('/');
    const walk = ['/c/plant-pal', '/c/plant-pal/people/kai', '/c/plant-pal/tasks', '/c/plant-pal/tasks/t-1', '/c/plant-pal/dashboards', '/c/plant-pal/inbox', '/c/plant-pal/plan'];
    for (const path of walk) o.router.navigate(path);
    expect(o.paths()).toEqual(['/', ...walk]);
    const back: string[] = [];
    for (let i = 0; i < walk.length; i++) {
      o.back();
      o.settle();
      back.push(o.location().path);
    }
    expect(back).toEqual([...walk.slice(0, -1).reverse(), '/']);
    const forward: string[] = [];
    for (let i = 0; i < walk.length; i++) {
      o.forward();
      o.settle();
      forward.push(o.location().path);
    }
    expect(forward).toEqual(walk);
  });

  it('replaces the entry only for an address put right to what shows, and adds none for the view already shown', () => {
    const o = office('/');
    o.router.navigate('/c/plant-pal');
    o.router.navigate('/c/plant-pal/inbox', { replace: true });
    o.router.navigate('/c/plant-pal/inbox');
    expect(o.paths()).toEqual(['/', '/c/plant-pal/inbox']);
    o.back();
    o.settle();
    expect(o.location().path).toBe('/');
  });

  it('pushes a view opened again, so Back returns to the one just before it rather than skipping it', () => {
    const o = office('/');
    o.router.navigate('/c/plant-pal');
    o.router.navigate('/c/plant-pal/inbox');
    o.router.navigate('/c/plant-pal');
    expect(o.location()).toMatchObject({ path: '/c/plant-pal', returned: false });
    expect(o.paths()).toEqual(['/', '/c/plant-pal', '/c/plant-pal/inbox', '/c/plant-pal']);
    o.back();
    o.settle();
    expect(o.location().path).toBe('/c/plant-pal/inbox');
  });

  it('tells a view come back to from one opened: Back, Forward, a panel\'s Back and a reload come back', () => {
    const o = office('/c/plant-pal');
    // The first view of a tab is an arrival; so is every view opened from here.
    expect(o.location().returned).toBe(false);
    o.router.navigate('/c/plant-pal/people/kai');
    expect(o.location().returned).toBe(false);
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/plant-pal', returned: true });
    o.forward();
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/plant-pal/people/kai', returned: true });
    // A reload: a new page reads the same entry, which was shown before.
    const reloaded = createRouter(o.browser);
    expect(reloaded.getSnapshot()).toMatchObject({ path: '/c/plant-pal/people/kai', returned: true });
  });

  it('closes a view nothing in the office opened by going where closing leads as a new entry, so Back reopens it, and by Back otherwise', () => {
    const linked = office('/c/plant-pal/tasks/t-1');
    linked.router.goBack('/c/plant-pal/tasks');
    expect(linked.paths()).toEqual(['/c/plant-pal/tasks/t-1', '/c/plant-pal/tasks']);
    // Marked as a close, so a phone can bring the side panel's home up where nothing was under what closed.
    expect(linked.location()).toMatchObject({ path: '/c/plant-pal/tasks', returned: true, closed: true });
    linked.back();
    linked.settle();
    expect(linked.location()).toMatchObject({ path: '/c/plant-pal/tasks/t-1', returned: true, closed: false });

    const opened = office('/c/plant-pal');
    opened.router.navigate('/c/plant-pal/settings');
    opened.router.goBack('/c/plant-pal');
    opened.settle();
    expect(opened.location()).toMatchObject({ path: '/c/plant-pal', returned: true, closed: false });
    expect(opened.paths()).toEqual(['/c/plant-pal', '/c/plant-pal/settings']);
  });

  it('drops an address put right for a place the person has since left, so Back stays where it went', () => {
    // A company started from the form takes its place; its office draws, and its effect would put the address right.
    const o = office('/');
    o.router.navigate('/new');
    o.router.navigate('/c/plant-pal/proposal', { replace: true });
    const drawn = o.location().key;
    o.back();
    o.settle();
    o.router.navigate('/c/plant-pal/proposal', { replace: true, at: drawn });
    expect(o.urls()).toEqual(['/', '/c/plant-pal/proposal']);
    expect(o.url()).toBe('/');
    // For the place shown, it applies.
    o.router.navigate('/c/plant-pal', { replace: true, at: o.location().key });
    expect(o.urls()).toEqual(['/c/plant-pal', '/c/plant-pal/proposal']);
  });

  it('keeps what had focus on the entry it leaves, and hands it back when Back returns there', () => {
    const o = office('/c/plant-pal');
    o.focus({ focus: 'now:kai' });
    o.router.navigate('/c/plant-pal/people/kai');
    expect(o.location().restore).toBeNull();
    o.focus(null);
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/plant-pal', restore: { focus: 'now:kai' } });
  });

  it('hands back what had focus on Back only: Forward reopens what Back closed with nothing to restore, so its title takes focus', () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe?panel=people/mina');
    // Mina's page is left by the link to Ada, which keeps focus on Mina's entry.
    o.focus({ text: 'Ada' });
    o.router.navigate('/c/cafe?panel=people/ada');
    o.focus(null);
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ search: '?panel=people/mina', restore: { text: 'Ada' } });
    // "Back to the inbox" is the browser's Back here: the entry before is the inbox.
    o.router.goBack('/c/cafe');
    o.settle();
    expect(o.location()).toMatchObject({ search: '', returned: true });
    o.forward();
    o.settle();
    expect(o.location()).toMatchObject({ search: '?panel=people/mina', returned: true, restore: null });
    // A reload keeps the places, so Back and Forward still tell themselves apart.
    const reloaded = createRouter(o.browser);
    reloaded.subscribe(() => undefined);
    reloaded.getSnapshot();
    o.back();
    o.settle();
    expect(reloaded.getSnapshot()).toMatchObject({ search: '', returned: true });
    o.forward();
    o.settle();
    expect(reloaded.getSnapshot()).toMatchObject({ search: '?panel=people/mina', restore: null });
  });

  it('leaves the address as it was when it only marks an entry shown', () => {
    const o = office('/c/demo?demo#top');
    expect(o.url()).toBe('/c/demo?demo#top');
    expect(o.location().path).toBe('/c/demo');
  });

  it('writes the history twice a navigation at most, under the rate Safari allows (100 writes in 10 s)', () => {
    const o = office('/');
    let writes = 0;
    const { pushState, replaceState } = o.browser.history;
    o.browser.history.pushState = (...args) => {
      writes += 1;
      pushState(...args);
    };
    o.browser.history.replaceState = (...args) => {
      writes += 1;
      replaceState(...args);
    };
    for (const tab of ['inbox', 'people', 'tasks', 'dashboards', 'inbox']) o.router.navigate(`/c/plant-pal/${tab}`);
    o.router.navigate('/c/plant-pal/inbox/q-3', { replace: true });
    expect(writes).toBeLessThanOrEqual(11);
  });
});

describe("the side panel's view in the address", () => {
  it('keeps the query on the entry it leaves, so Back, Forward and a reload return to the side panel as it was', () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe?panel=people/kai');
    o.router.navigate('/c/cafe/tasks?panel=people/kai');
    o.router.navigate('/c/cafe/tasks');
    expect(o.urls()).toEqual(['/c/cafe', '/c/cafe?panel=people/kai', '/c/cafe/tasks?panel=people/kai', '/c/cafe/tasks']);
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/cafe/tasks', search: '?panel=people/kai', returned: true });
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/cafe', search: '?panel=people/kai', returned: true });
    o.forward();
    o.settle();
    expect(o.url()).toBe('/c/cafe/tasks?panel=people/kai');
    expect(createRouter(o.browser).getSnapshot()).toMatchObject({ path: '/c/cafe/tasks', search: '?panel=people/kai', returned: true });
  });

  it("pushes a change of the side panel's view alone, and adds nothing for the place shown, however its query is written", () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe?panel=people/kai');
    o.router.navigate('/c/cafe?panel=people/mina');
    o.router.navigate('/c/cafe?panel=people/mina');
    o.router.navigate('/c/cafe?panel=people%2Fmina');
    expect(o.urls()).toEqual(['/c/cafe', '/c/cafe?panel=people/kai', '/c/cafe?panel=people/mina']);
    expect(o.location()).toMatchObject({ path: '/c/cafe', search: '?panel=people/mina', returned: false });
  });

  it('takes the token and ?demo as no part of the place, and leaves them out of the entry it leaves', () => {
    const o = office('/c/demo?demo');
    o.router.navigate('/c/demo');
    expect(o.urls()).toEqual(['/c/demo?demo']);
    o.router.navigate('/c/demo/tasks');
    expect(o.urls()).toEqual(['/c/demo', '/c/demo/tasks']);
    const kept = office('/c/demo?panel=people/kai&demo&token=abc');
    kept.router.navigate('/c/demo/tasks');
    expect(kept.urls()).toEqual(['/c/demo?panel=people/kai', '/c/demo/tasks']);
  });

  it('writes the history twice a navigation at most with the query too', () => {
    const o = office('/c/cafe');
    let writes = 0;
    const { pushState, replaceState } = o.browser.history;
    o.browser.history.pushState = (...args) => {
      writes += 1;
      pushState(...args);
    };
    o.browser.history.replaceState = (...args) => {
      writes += 1;
      replaceState(...args);
    };
    for (const panel of ['people/kai', 'people/mina', 'tasks/t-1', 'inbox/q-3']) o.router.navigate(`/c/cafe/tasks?panel=${panel}`);
    // Closing from there is one more navigation: the entry before isn't the board, so it goes there as a new entry.
    o.router.goBack('/c/cafe/tasks');
    expect(writes).toBeLessThanOrEqual(10);
  });
});

describe("a phone's sheets as marked entries", () => {
  it('pushes the address shown again, marked, so Back closes the sheet and leaves the page as it was', () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe', { mark: 'inbox' });
    expect(o.urls()).toEqual(['/c/cafe', '/c/cafe']);
    expect(o.location()).toMatchObject({ path: '/c/cafe', mark: 'inbox', prev: '/c/cafe' });
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/cafe', mark: null, returned: true });
    o.forward();
    o.settle();
    expect(o.location().mark).toBe('inbox');
  });

  it('marks only the address shown, once', () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe/tasks', { mark: 'feed' });
    o.router.navigate('/c/cafe', { mark: 'feed' });
    o.router.navigate('/c/cafe', { mark: 'feed' });
    expect(o.urls()).toEqual(['/c/cafe', '/c/cafe']);
  });

  it('closes a sheet by Back only from its own marked entry', () => {
    const o = office('/c/cafe');
    o.router.unmark('feed');
    o.settle();
    expect(o.urls()).toEqual(['/c/cafe']);
    o.router.navigate('/c/cafe', { mark: 'feed' });
    o.router.unmark('inbox');
    o.settle();
    expect(o.location().mark).toBe('feed');
    o.router.unmark('feed');
    o.settle();
    expect(o.location()).toMatchObject({ mark: null, returned: true });
  });

  it('keeps the mark of an entry left for another page, so Back reopens the sheet under it', () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe', { mark: 'feed' });
    o.router.navigate('/c/cafe?panel=people/kai');
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ search: '', mark: 'feed' });
  });

  it('shows the page without its sheet after a reload of a marked entry', () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe', { mark: 'feed' });
    const reloaded = createRouter(o.browser);
    expect(reloaded.getSnapshot()).toMatchObject({ path: '/c/cafe', mark: null, returned: true });
    expect(createRouter(o.browser).getSnapshot().mark).toBeNull();
  });
});

describe('closing', () => {
  it('goes back when the entry before is where closing leads, so Forward opens it again', () => {
    const o = office('/c/cafe');
    o.focus({ focus: 'office:kai' });
    o.router.navigate('/c/cafe?panel=people/kai');
    o.focus(null);
    o.router.goBack('/c/cafe');
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/cafe', search: '', returned: true, restore: { focus: 'office:kai' } });
    o.forward();
    o.settle();
    expect(o.url()).toBe('/c/cafe?panel=people/kai');
  });

  it('goes where closing leads as a new entry when the entry before is somewhere else, so Back reopens what was closed', () => {
    // Kai opened from Ines's panel: closing Kai leads to the inbox, not to Ines.
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe?panel=people/ines');
    o.router.navigate('/c/cafe?panel=people/kai');
    // Kai's entry keeps what had focus when he was closed, for the Back that reopens him.
    o.focus({ focus: 'panel:close' });
    o.router.goBack('/c/cafe');
    expect(o.urls()).toEqual(['/c/cafe', '/c/cafe?panel=people/ines', '/c/cafe?panel=people/kai', '/c/cafe']);
    expect(o.location()).toMatchObject({ path: '/c/cafe', search: '', returned: true });
    o.back();
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/cafe', search: '?panel=people/kai', restore: { focus: 'panel:close' } });
    o.back();
    o.settle();
    expect(o.url()).toBe('/c/cafe?panel=people/ines');
    // Closing Ines now: the entry before her is the office, so it's a Back.
    o.router.goBack('/c/cafe');
    o.settle();
    expect(o.url()).toBe('/c/cafe');
    expect(o.urls()).toHaveLength(4);
  });

  it('compares the entry before with where closing leads by place: its query read as written, the token and ?demo left out', () => {
    const demo = office('/c/demo?demo');
    demo.router.navigate('/c/demo?panel=people/kai');
    demo.router.goBack('/c/demo');
    demo.settle();
    expect(demo.urls()).toEqual(['/c/demo', '/c/demo?panel=people/kai']);
    expect(demo.url()).toBe('/c/demo');

    const board = office('/c/cafe/tasks?panel=people/kai');
    board.router.navigate('/c/cafe/tasks?panel=tasks/t-1');
    board.router.goBack('/c/cafe/tasks?panel=people%2Fkai');
    board.settle();
    expect(board.url()).toBe('/c/cafe/tasks?panel=people/kai');
    expect(board.urls()).toHaveLength(2);
  });

  it('does nothing when the place shown is where closing leads, even when the entry before is that place too', () => {
    const o = office('/c/cafe');
    const before = o.location().key;
    o.router.goBack('/c/cafe');
    o.settle();
    expect(o.urls()).toEqual(['/c/cafe']);
    expect(o.location().key).toBe(before);
    // An address put right in place (the proposal while the CEO drafts) can leave an entry where the one before it is.
    o.router.navigate('/c/cafe/inbox');
    o.router.navigate('/c/cafe', { replace: true });
    const shown = o.location().key;
    o.router.goBack('/c/cafe');
    o.settle();
    expect(o.location().key).toBe(shown);
    expect(o.urls()).toEqual(['/c/cafe', '/c/cafe']);
  });

  it("returns a panel's own Back to whatever opened the view, else to its fallback in place", () => {
    const o = office('/c/cafe');
    o.router.navigate('/c/cafe/people/ines');
    o.router.navigate('/c/cafe/people/kai');
    o.router.backToOpener('/c/cafe/people');
    o.settle();
    expect(o.location()).toMatchObject({ path: '/c/cafe/people/ines', returned: true });

    const linked = office('/c/cafe/people/kai');
    linked.router.backToOpener('/c/cafe/people');
    expect(linked.urls()).toEqual(['/c/cafe/people']);
    expect(linked.location()).toMatchObject({ path: '/c/cafe/people', returned: true });
  });
});

describe("the static demo's addresses under its base", () => {
  const site = underBase('/worklings/');

  it('puts an app address under the base once, its query and hash kept', () => {
    expect(site.toUrl('/')).toBe('/worklings/');
    expect(site.toUrl('/c/demo?panel=people/kai')).toBe('/worklings/c/demo?panel=people/kai');
    expect(site.toUrl('/c/demo/inbox#q-3')).toBe('/worklings/c/demo/inbox#q-3');
    expect(site.toUrl('/worklings/c/demo?panel=people/kai')).toBe('/worklings/c/demo?panel=people/kai');
    expect(site.toUrl('/worklings?panel=people/kai')).toBe('/worklings?panel=people/kai');
    expect(site.toUrl('/worklingsville')).toBe('/worklings/worklingsville');
  });

  it('takes the base off an address the address bar shows, its query and hash kept', () => {
    expect(site.toApp('/worklings/')).toBe('/');
    expect(site.toApp('/worklings')).toBe('/');
    expect(site.toApp('/worklings/c/demo')).toBe('/c/demo');
    expect(site.toApp('/c/demo')).toBe('/c/demo');
    expect(site.toApp('/worklings/c/demo?panel=people/kai')).toBe('/c/demo?panel=people/kai');
    expect(site.toApp('/worklings?panel=people/kai#top')).toBe('/?panel=people/kai#top');
  });

  it('leaves every address as it is at the root of a domain', () => {
    const root = underBase('/');
    for (const address of ['/', '/new', '/c/demo?panel=people/kai']) {
      expect(root.toUrl(address)).toBe(address);
      expect(root.toApp(address)).toBe(address);
    }
  });

  it("keeps the side panel's view through the router under the base", () => {
    const o = office('/worklings/c/demo');
    o.router.navigate(site.toUrl('/c/demo?panel=people/kai'));
    o.router.navigate(site.toUrl('/c/demo/tasks?panel=people/kai'));
    expect(o.urls()).toEqual(['/worklings/c/demo', '/worklings/c/demo?panel=people/kai', '/worklings/c/demo/tasks?panel=people/kai']);
    o.back();
    o.settle();
    expect(site.toApp(o.location().path)).toBe('/c/demo');
    expect(o.location().search).toBe('?panel=people/kai');
    o.router.goBack(site.toUrl('/c/demo'));
    o.settle();
    expect(o.url()).toBe('/worklings/c/demo');
  });
});

describe("a phone's office peeks at the side panel", () => {
  const base = { phone: true, main: { kind: 'office' }, panel: null, sheetUp: false, overlay: false, feedOpen: false, typing: false } as const;
  it('shows the office first with the sheet only peeking, even while something waits (changed on purpose: a phone no longer opens on the inbox)', () => {
    expect(peeksAt(base)).toBe(true);
  });

  it('peeks on no desktop, over no board, and not once the person opened something, or while the feed, an overlay or typing has the screen', () => {
    expect(peeksAt({ ...base, phone: false })).toBe(false);
    expect(peeksAt({ ...base, main: { kind: 'tasks' } })).toBe(false);
    expect(peeksAt({ ...base, panel: { kind: 'person', person: 'kai' } })).toBe(false);
    expect(peeksAt({ ...base, sheetUp: true })).toBe(false);
    expect(peeksAt({ ...base, overlay: true })).toBe(false);
    expect(peeksAt({ ...base, feedOpen: true })).toBe(false);
    expect(peeksAt({ ...base, typing: true })).toBe(false);
  });
});
