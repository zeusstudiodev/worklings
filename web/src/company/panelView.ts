// What the company's shell shows for an address (docs/design-v3.md, "Stage and dock"): the stage's mode, a phone's inbox
// on arrival, the side panel head's Back and the page's title. Pure, for tests.
import { type CompanyRoute, type MainView, type PanelView, parseCompanyAddress } from './address.ts';

export type StageMode = 'office' | 'mini' | 'covered';

/** A board over the map: Org, Tasks (its board or plan) and Dashboards (a dashboard or the decision log). */
export const isBoard = (main: MainView): boolean => main.kind !== 'office' && main.kind !== 'progress' && main.kind !== 'preview' && main.kind !== 'diff';

/**
 * How the 3D office draws behind a main view: whole on the office, and beside the progress column on desktops (phones
 * give progress the whole screen); in the mini-map's corner on a desktop's board; not at all under Preview, a diff, a
 * phone's board sheet, or the feed open over a board (where the mini-map hides) or over a phone's whole screen.
 */
export function stageModeOf(o: { main: MainView; phone: boolean; feedOpen: boolean }): StageMode {
  if (o.main.kind === 'office') return o.phone && o.feedOpen ? 'covered' : 'office';
  if (o.main.kind === 'progress') return o.phone ? 'covered' : 'office';
  if (!isBoard(o.main) || o.phone || o.feedOpen) return 'covered';
  return 'mini';
}

/**
 * Whether a phone shows the office with the side panel's sheet only peeking (its head and first line; a swipe up or a
 * press opens it): the office with nothing open in the side panel, no sheet up, nothing over it and nobody typing. The
 * person opens the inbox (the Inbox key, a link to it, a `?panel=` address), the phone never does it for them (Robin,
 * 12 Nov 2026, replacing "a phone opens on the inbox while something waits").
 */
export const peeksAt = (o: { phone: boolean; main: MainView; panel: PanelView | null; sheetUp: boolean; overlay: boolean; feedOpen: boolean; typing: boolean }): boolean =>
  o.phone && o.main.kind === 'office' && o.panel === null && !o.sheetUp && !o.overlay && !o.feedOpen && !o.typing;

/**
 * Whether the side panel shows. Phones: a sheet up for a view, the inbox or an overlay. Desktops: unless you hid it, except
 * on progress, which opens with it closed (the column already says what needs you, and the office gets the room) and
 * shows it only for a view opened into it (a `?panel=` address, an inbox item from a needs-you link), an overlay, or the
 * inbox you asked for there (`inboxBeside`: the Inbox key, a link to the inbox).
 */
export const sideShownAt = (o: { phone: boolean; main: MainView; panel: PanelView | null; overlay: boolean; homeSheet: boolean; hidden: boolean; inboxBeside: boolean }): boolean => {
  if (o.phone) return o.panel !== null || o.homeSheet || o.overlay;
  if (o.main.kind !== 'progress') return !o.hidden;
  return o.panel !== null || o.overlay || (o.inboxBeside && !o.hidden);
};

const same = (a: MainView | PanelView | null, b: MainView | PanelView | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether the side panel's head offers Back (the browser's Back): only when the entry before is another side panel view
 * over the same main view, or the same main view with the feed open, where the person opened this view from a line.
 * `prev` is the entry before as the app's addresses write it (the static demo's base already off).
 */
export function headBackAt(o: { prev: string | null; company: string; route: CompanyRoute; feedOpen: boolean }): boolean {
  if (o.prev === null || o.route.panel === null) return false;
  const url = new URL(o.prev, 'http://office.invalid');
  const before = parseCompanyAddress(url.pathname, url.search, url.hash);
  if (!before || before.old || before.company !== o.company || !same(before.route.main, o.route.main)) return false;
  return before.route.panel !== null ? !same(before.route.panel, o.route.panel) : o.feedOpen;
}

/** The main view in the page's title ("(6) Org chart, Café Lumen in Worklings"), so Back and Forward say where they land; null on the office. */
export function mainViewTitle(main: MainView): string | null {
  switch (main.kind) {
    case 'office':
      return null;
    case 'progress':
      return 'Progress';
    case 'org':
      return 'Org chart';
    case 'tasks':
      return 'Tasks';
    case 'plan':
      return main.version === null ? 'The plan' : `The plan, version ${main.version}`;
    case 'dashboards':
      return 'Dashboards';
    case 'decisions':
      return 'Decision log';
    case 'preview':
      return 'Preview';
    case 'diff':
      return 'Changes';
  }
}
