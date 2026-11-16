// Addresses (docs/design-v3.md, "Stage and dock", "Boards over the map"): the lobby at `/`, Start at `/new` and a
// company at `/c/:company`. Under a company the path names the main view, the office or a board over it, and `?panel=`
// what the side panel shows. Addresses from before the stage and dock keep working: the old-address map reads each one
// as its new form. Only this module builds and reads company addresses, purely, for tests; router.ts moves between them
// with the History API. Take the builders of whole addresses (companyPath, companyHref) from router.ts: the static demo
// swaps it for its own (web/src/site/router.ts), which puts them under the site's base path.
import type { Recipient } from '../../../src/core/steering.ts';

/** The longest id an address carries. A longer one names nothing: no id is that long. */
const MAX_ID = 200;

/** An id in a path, decoded; null for none, a malformed escape or one too long. */
const decode = (part: string | undefined): string | null => {
  if (!part) return null;
  try {
    const text = decodeURIComponent(part);
    return text.length > 0 && text.length <= MAX_ID ? text : null;
  } catch {
    return null;
  }
};

/** `v3` in `plan/v3`: an older version of the plan. Anything else names the latest. */
const versionOf = (part: string | undefined): number | null => {
  const version = /^v([1-9]\d{0,5})$/.exec(part ?? '');
  return version ? Number(version[1]) : null;
};

export const companyPath = (company: string, sub = ''): string => {
  const rest = sub.replace(/^\/+/, '');
  return `/c/${encodeURIComponent(company)}${rest ? `/${rest}` : ''}`;
};

// ---------------------------------------------------------------------------------------------------------------
// The stage and dock: a main view, and the side panel beside it

/** What fills the window under the company bar: the office, or a board over it. The path names it. */
export type MainView =
  | { kind: 'office' }
  /** v0.2: where the company stands, in plain words, a column beside the office (`progress`); every entry point lands here. */
  | { kind: 'progress' }
  | { kind: 'org' }
  /** Tasks: the board. */
  | { kind: 'tasks' }
  /** Tasks: the plan; `version` is an older version to show (`plan/v3`), null for the latest. */
  | { kind: 'plan'; version: number | null }
  /** Dashboards: one by its id (`spend`, `timeline`, one of the CEO's), null for the first. */
  | { kind: 'dashboards'; board: string | null }
  /** Dashboards: the decision log. */
  | { kind: 'decisions' }
  | { kind: 'preview' }
  /** A task's changes (`tasks/t-12/diff`), in a board's frame. */
  | { kind: 'diff'; task: string };

/** What the side panel shows besides its home. `?panel=` names it. */
export type PanelView =
  /** The inbox opened on one item (`inbox/q-3`), as the front desk opens it. */
  | { kind: 'inbox'; item: string }
  | { kind: 'person'; person: string }
  | { kind: 'task'; task: string }
  /** Add a task (`tasks/new`). */
  | { kind: 'new-task' }
  /** Where one of your messages went (`messages/m-12`): its trace. */
  | { kind: 'message'; message: string }
  | { kind: 'decision'; decision: string }
  | { kind: 'customize' }
  | { kind: 'settings' }
  | { kind: 'proposal' };

/** Where a company is open: the main view, and the side panel's view, null for its home (the inbox; before the start, the proposal). */
export interface CompanyRoute {
  main: MainView;
  panel: PanelView | null;
}

/**
 * The To an old address asked the talk bar for, with focus in its box (`people/kai/message`, `send/room/design`). No
 * address holds either, so the shell does it once. `to` null leaves the To as it is (`send`).
 */
export interface TalkIntent {
  to: Recipient | null;
}

/** A company's address, read. */
export interface CompanyAddress {
  company: string;
  route: CompanyRoute;
  /** An address from before the stage and dock (`inbox`, `people/kai`): the shell puts its new form in its place. */
  old: boolean;
  /** What an old address asked for that no address holds. */
  talk: TalkIntent | null;
}

const OFFICE: MainView = { kind: 'office' };

/** A task in the side panel. `tasks/new` is the form that adds one: task ids are `t-12`, never `new`. */
const taskPanel = (task: string): PanelView => (task === 'new' ? { kind: 'new-task' } : { kind: 'task', task });

/**
 * A company's address: the main view its path names and the side panel's view its `?panel=` names, or an old address's
 * new form. Null for an address outside a company.
 */
export function parseCompanyAddress(pathname: string, search = '', hash = ''): CompanyAddress | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'c') return null;
  const company = decode(parts[1]);
  if (!company) return null;
  const under = parts.slice(2);
  const old = oldRoute(under, hash);
  if (old) return { company, route: old.route, old: true, talk: old.talk };
  return { company, route: { main: mainOf(under), panel: panelOf(search) }, old: false, talk: null };
}

/** The main view a path under a company names; anything it doesn't know is the office. */
function mainOf(parts: readonly string[]): MainView {
  const [view, a, b] = parts;
  switch (view) {
    case 'org':
      return { kind: 'org' };
    case 'progress':
      return { kind: 'progress' };
    case 'tasks': {
      const task = decode(a);
      return task && b === 'diff' ? { kind: 'diff', task } : { kind: 'tasks' };
    }
    case 'plan':
      return { kind: 'plan', version: versionOf(a) };
    case 'dashboards':
      return { kind: 'dashboards', board: decode(a) };
    case 'decisions':
      return { kind: 'decisions' };
    case 'preview':
      return { kind: 'preview' };
    default:
      return OFFICE;
  }
}

/**
 * The side panel's view `?panel=` names: a kind and, for most, an id after a slash. Read with the query's own rules, so
 * the form URLSearchParams writes (`people%2Fkai`, `+` for a space) reads too. The value is untrusted: a kind it
 * doesn't know, a missing id or one that can't be an id names nothing, and the side panel shows its home.
 */
function panelOf(search: string): PanelView | null {
  const value = new URLSearchParams(search).get('panel');
  if (value === null) return null;
  const slash = value.indexOf('/');
  const kind = slash < 0 ? value : value.slice(0, slash);
  const raw = slash < 0 ? '' : value.slice(slash + 1);
  // A malformed escape reads as U+FFFD here, where a path's decode refuses it: it names nothing either way.
  const id = raw.length > 0 && raw.length <= MAX_ID && !raw.includes('\uFFFD') ? raw : null;
  switch (kind) {
    case 'inbox':
      return id ? { kind: 'inbox', item: id } : null;
    case 'people':
      return id ? { kind: 'person', person: id } : null;
    case 'tasks':
      return id ? taskPanel(id) : null;
    case 'messages':
      return id ? { kind: 'message', message: id } : null;
    case 'decisions':
      return id ? { kind: 'decision', decision: id } : null;
    case 'customize':
    case 'settings':
    case 'proposal':
      return slash < 0 ? { kind } : null;
    default:
      return null;
  }
}

/**
 * What an old address named: a side panel view (`people/kai`, `inbox`), a main view (`people`, the org) or, for the
 * composer (`send/…`), only the talk bar. Opened from inside the office (openSub), a side panel view opens over the main
 * view shown and a main view keeps the side panel's; on arrival the old address's whole new form applies.
 */
type OldScope = 'panel' | 'main' | 'talk';

/**
 * The old-address map (docs/design-v3.md, "Addresses"): an address from before the stage and dock as its new form, with
 * what it asked for that no address holds. An id that names nothing leaves the view it sat under. Null for an address
 * both forms read alike (`tasks`, `plan/v2`, `dashboards/spend`, a task's diff) or the new form alone has.
 */
function oldRoute(parts: readonly string[], hash: string): { route: CompanyRoute; talk: TalkIntent | null; scope: OldScope } | null {
  const [view, a, b] = parts;
  const at = (scope: OldScope, main: MainView, panel: PanelView | null = null, talk: TalkIntent | null = null) => ({ route: { main, panel }, talk, scope });
  switch (view) {
    case 'inbox': {
      // `inbox/q-3`, or `inbox#q-3` as the Answer links write it.
      const item = decode(a) ?? decode(hash.replace(/^#/, ''));
      return at('panel', OFFICE, item ? { kind: 'inbox', item } : null);
    }
    case 'people': {
      const person = decode(a);
      if (!person) return at('main', { kind: 'org' });
      return at('panel', OFFICE, { kind: 'person', person }, b === 'message' ? { to: { kind: 'person', id: person } } : null);
    }
    case 'tasks': {
      if (a === undefined || b === 'diff') return null;
      const task = decode(a);
      return at('panel', { kind: 'tasks' }, task ? taskPanel(task) : null);
    }
    case 'messages': {
      const message = decode(a);
      return at('panel', OFFICE, message ? { kind: 'message', message } : null);
    }
    case 'decisions': {
      if (a === undefined) return null;
      const decision = decode(a);
      return at('panel', { kind: 'decisions' }, decision ? { kind: 'decision', decision } : null);
    }
    case 'send':
      return at('talk', OFFICE, null, { to: recipientOf(parts.slice(1)) });
    case 'customize':
    case 'settings':
      return at('panel', OFFICE, { kind: view });
    case 'proposal':
      return at('panel', OFFICE);
    default:
      return null;
  }
}

/**
 * Where a link inside the office leads from the route shown (TabProps.navigate): today's views still write their old
 * sub-paths ("people/kai", "tasks/t-12", "inbox#q-3", "send/room/design"), and a new one may carry `?panel=`. A side panel
 * view opens over the main view shown; a main view keeps the side panel's view when `keepPanel` (desktops: decision 4)
 * and drops it on phones; the composer's address only says who the talk bar is to.
 */
export function openSub(here: CompanyRoute, sub: string, keepPanel: boolean): { route: CompanyRoute; talk: TalkIntent | null } {
  const query = sub.search(/[?#]/);
  const path = query < 0 ? sub : sub.slice(0, query);
  const rest = query < 0 ? '' : sub.slice(query);
  const hashAt = rest.indexOf('#');
  const search = hashAt < 0 ? rest : rest.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : rest.slice(hashAt);
  const parts = path.split('/').filter(Boolean);
  const kept = keepPanel ? here.panel : null;
  const old = oldRoute(parts, hash);
  if (old?.scope === 'talk') return { route: here, talk: old.talk };
  if (old?.scope === 'panel') return { route: { main: here.main, panel: old.route.panel }, talk: old.talk };
  if (old) return { route: { main: old.route.main, panel: kept }, talk: old.talk };
  const named = new URLSearchParams(search).has('panel');
  return { route: { main: mainOf(parts), panel: named ? panelOf(search) : kept }, talk: null };
}

/** Who a composer's address wrote to: `everyone`, `room/design`, `team/head-of-design`, `person/kai`. */
function recipientOf([kind, raw]: readonly string[]): Recipient | null {
  if (kind === 'everyone') return { kind: 'everyone' };
  const id = decode(raw);
  if (!id) return null;
  switch (kind) {
    case 'person':
      return { kind: 'person', id };
    case 'room':
      return { kind: 'room', id };
    case 'team':
      return { kind: 'team', head: id };
    default:
      return null;
  }
}

/**
 * A company's address for a route: the main view's path and, when the side panel shows more than its home, `?panel=`.
 * Written by hand, since URLSearchParams would write the panel's slash as `%2F` and the address should stay readable.
 */
export function companyHref(company: string, route: CompanyRoute): string {
  const panel = route.panel ? panelValue(route.panel) : null;
  return `${companyPath(company, mainPath(route.main))}${panel ? `?panel=${panel}` : ''}`;
}

function mainPath(main: MainView): string {
  switch (main.kind) {
    case 'office':
      return '';
    case 'org':
    case 'progress':
    case 'tasks':
    case 'decisions':
    case 'preview':
      return main.kind;
    case 'plan':
      return main.version === null ? 'plan' : `plan/v${main.version}`;
    case 'dashboards':
      return main.board === null ? 'dashboards' : `dashboards/${encodeURIComponent(main.board)}`;
    case 'diff':
      return `tasks/${encodeURIComponent(main.task)}/diff`;
  }
}

function panelValue(panel: PanelView): string {
  const enc = encodeURIComponent;
  switch (panel.kind) {
    case 'inbox':
      return `inbox/${enc(panel.item)}`;
    case 'person':
      return `people/${enc(panel.person)}`;
    case 'task':
      return `tasks/${enc(panel.task)}`;
    case 'new-task':
      return 'tasks/new';
    case 'message':
      return `messages/${enc(panel.message)}`;
    case 'decision':
      return `decisions/${enc(panel.decision)}`;
    case 'customize':
    case 'settings':
    case 'proposal':
      return panel.kind;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What an address is

export type Address = { kind: 'lobby' } | { kind: 'new' } | ({ kind: 'company' } & CompanyAddress);

/** What an address is: the lobby, the start form or a place in a company. An unknown path is the lobby. */
export function parseAddress(pathname: string, search = '', hash = ''): Address {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'new' && parts.length === 1) return { kind: 'new' };
  const read = parseCompanyAddress(pathname, search, hash);
  return read ? { kind: 'company', ...read } : { kind: 'lobby' };
}

// ---------------------------------------------------------------------------------------------------------------
// The views' old sub-paths, which some views still write until each moves to companyHref (TabProps.navigate, the
// office's labels): openSub reads them

/** A view as an old sub-path names it. */
export type TabbedRoute =
  | { view: 'now' }
  | { view: 'proposal' }
  /** `item`: an inbox item to open on (`inbox/q-3`), as the front desk in the scene opens one. */
  | { view: 'inbox'; item: string | null }
  /** `compose`: opened by a "Message" button (`people/kai/message`), so focus goes to the box. */
  | { view: 'people'; person: string | null; compose: boolean }
  | { view: 'tasks'; task: string | null; diff: boolean }
  /** The plan; `version` is an older version to show (`plan/v3`), null for the latest. */
  | { view: 'plan'; version: number | null }
  | { view: 'dashboards'; board: string | null }
  /** Where one of your messages went (`messages/m-12`): its trace. */
  | { view: 'message'; message: string }
  /** The decision log, opened on one decision (`decisions/d-4`) or at the top. */
  | { view: 'decisions'; decision: string | null }
  /** Writing to a person, a room, a team or everyone: `to` holds the address's own parts after `send`, still encoded. */
  | { view: 'send'; to: string[] }
  | { view: 'preview' }
  | { view: 'customize' }
  | { view: 'settings' };

/** The old sub-path of a view: "" for the office, "people/kai", "inbox/q-3", "tasks/t-12/diff". */
export function routePath(route: TabbedRoute): string {
  const enc = encodeURIComponent;
  switch (route.view) {
    case 'now':
      return '';
    case 'people':
      return route.person ? `people/${enc(route.person)}${route.compose ? '/message' : ''}` : 'people';
    case 'tasks':
      return route.task ? `tasks/${enc(route.task)}${route.diff ? '/diff' : ''}` : 'tasks';
    case 'plan':
      return route.version === null ? 'plan' : `plan/v${route.version}`;
    case 'dashboards':
      return route.board ? `dashboards/${enc(route.board)}` : 'dashboards';
    case 'inbox':
      return route.item ? `inbox/${enc(route.item)}` : 'inbox';
    case 'message':
      return `messages/${enc(route.message)}`;
    case 'decisions':
      return route.decision ? `decisions/${enc(route.decision)}` : 'decisions';
    case 'send':
      return ['send', ...route.to].join('/');
    default:
      return route.view;
  }
}
