// Helpers for v3's end-to-end specs that need a browser or Playwright's expect: opening the office with the token,
// putting a company in a state through the hub's API, driving the stage and dock as a person does, and the evidence
// folder. Data and plain API calls live in v3-world.ts.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { CompanyView, PersonView } from '../../src/core/company.ts';
import { companyHref, parseCompanyAddress } from '../../web/src/company/address.ts';
import { api, found, HUB, PROPOSAL, TOKEN, view } from './v3-world.ts';

/** Where `shot` puts its pictures: E2E_EVIDENCE when a run keeps them elsewhere, as runs beside others' do. */
const EVIDENCE = process.env.E2E_EVIDENCE ?? 'test-results/evidence';
mkdirSync(EVIDENCE, { recursive: true });

/** The folder every hub's files for the suite go under (playwright.config.ts sets it). */
export const scratchOf = (): string => {
  const dir = process.env.E2E_HUB_SCRATCH;
  if (!dir) throw new Error('E2E_HUB_SCRATCH is not set: run these specs through playwright.config.ts.');
  return dir;
};

/** A name that differs between the desktop and the phone run, so the two never share a company. */
export const nameFor = (base: string, info: TestInfo): string => `${base}-${info.project.name}`;

export const person = (company: CompanyView, id: string): PersonView => {
  const found = company.people.find((p) => p.id === id);
  if (!found) throw new Error(`${company.name} has nobody called ${id}.`);
  return found;
};

/** Collects what the page logs as errors; a spec ends by expecting none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A failed load is reported with its address (the console's own line leaves it out).
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(/token=[^&]+/, 'token=...')}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  return errors;
}

/** Opens an address of the office with the access token, as the link `worklings hub` prints does. */
export async function open(page: Page, path: string, hub = HUB): Promise<void> {
  await page.goto(`${hub}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`);
}

export const shot = (page: Page, name: string, info: TestInfo) => page.screenshot({ path: join(EVIDENCE, `v3-${name}-${info.project.name}.png`) });

/** Waits for the CEO's proposal of a company that was just founded. */
export async function waitForProposal(request: APIRequestContext, id: string, hub = HUB): Promise<void> {
  await expect.poll(async () => (await view(request, id, hub)).phase, { timeout: 60_000, intervals: [100, 250, 500] }).toBe('proposed');
  await restoreRoster(request, id, hub);
}

/**
 * The CEO's proposal is held to Balanced's shape (flat, no QA seat); the specs read the headed roster of PROPOSAL, so the
 * stakeholder's own edit, which is held to the schema only, puts it back: the same company and goal, the CEO's own sizing.
 */
export async function restoreRoster(request: APIRequestContext, id: string, hub = HUB): Promise<void> {
  const proposal = (await view(request, id, hub)).proposal;
  if (!proposal || !proposal.people.some((p) => p.id === 'test-engineer')) return;
  const edited = await api(request, `api/c/${id}/proposal`, { proposal: { ...PROPOSAL, company: proposal.company, goal: proposal.goal, size: proposal.size, ...(proposal.sizing ? { sizing: proposal.sizing } : {}), people: [...PROPOSAL.people, ...proposal.people.filter((p) => p.id === 'copywriter').map((p) => ({ ...p, reportsTo: 'head-of-design' }))] } }, hub);
  expect(edited.status, JSON.stringify(edited.body)).toBe(200);
}

/**
 * Founds a company, takes the CEO's proposal as it is and starts it: eight people, running.
 * Plan approval is turned off before Start unless `planApproval` says otherwise. The product default is "before work",
 * where the CEO must propose a plan and the stakeholder approve it before anyone gets work; the specs that use this
 * helper test something else (messages, desks, boards, the org) and hand work out with assign, which a waiting plan
 * refuses. The new-company spec and the plan specs exercise the default itself.
 */
export async function running(request: APIRequestContext, name: string, options: { prompt?: string; hub?: string; planApproval?: 'off' | 'before-work' | 'milestones' } = {}): Promise<string> {
  const hub = options.hub ?? HUB;
  const id = await found(request, scratchOf(), name, options.prompt, hub);
  await waitForProposal(request, id, hub);
  await setting(request, id, { planApproval: options.planApproval ?? 'off' }, hub);
  expect((await api(request, `api/c/${id}/start`, {}, hub)).status).toBe(200);
  await expect.poll(async () => (await view(request, id, hub)).phase, { timeout: 60_000, intervals: [100, 250, 500] }).toBe('running');
  return id;
}

/** Stops a person's long turn so the desk is free for the next spec. */
export async function stopWork(request: APIRequestContext, id: string, person: string, hub = HUB): Promise<void> {
  await api(request, `api/c/${id}/stop`, { person, instruction: 'Stop here and wait for my next message.' }, hub);
}

// ---------------------------------------------------------------------------------------------------------------------
// Steering (H39 to H46)

/**
 * The stakeholder's message to a person, through the hub as the composer sends it: words they typed, so the CEO may
 * cite it as their word. Returns the message id.
 */
export async function tell(request: APIRequestContext, id: string, to: string, text: string, hub = HUB): Promise<string> {
  const sent = await api<{ id: string }>(request, `api/c/${id}/messages`, { to, text, typed: true }, hub);
  expect(sent.status).toBe(202);
  return sent.body.id;
}

/** Changes a company setting through the hub's settings route. */
export async function setting(request: APIRequestContext, id: string, change: Record<string, unknown>, hub = HUB): Promise<void> {
  const res = await api(request, `api/c/${id}/settings`, change, hub);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** The company's state, polled until `pick` returns something other than undefined. */
export async function until<T>(request: APIRequestContext, id: string, pick: (company: CompanyView) => T | undefined | false | null, timeout = 60_000, hub = HUB): Promise<T> {
  let got: T | undefined;
  await expect
    .poll(async () => {
      const found = pick(await view(request, id, hub));
      if (found !== undefined && found !== false && found !== null) got = found;
      return got !== undefined;
    }, { timeout, intervals: [100, 250, 500] })
    .toBe(true);
  return got as T;
}

/** How many versions of the plan the view carries. */
export const planVersions = (company: CompanyView): number => company.steering?.plan?.versions.length ?? 0;

/** The user turns the fake desks were handed so far that contain `needle`, as the hub's desk log recorded them. */
export function deskTurns(needle: string): { turn: string; at: number }[] {
  const file = `${scratchOf()}/desk.jsonl`;
  if (!existsSync(file)) return [];
  const found: { turn: string; at: number }[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"event":"line"') || !line.includes(needle)) continue;
    const entry = JSON.parse(line) as { at: number; line?: { message?: { content?: unknown } } };
    const content = entry.line?.message?.content;
    if (typeof content === 'string' && content.includes(needle)) found.push({ turn: content, at: entry.at });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage and dock (docs/design-v3.md, "Stage and dock"; checklist H56 to H65)
//
// The shell, the talk bar and the boards, driven as a person does: by role and name, at the addresses the app's own
// address.ts writes. Specs go through these rather than the layout, so a change of layout touches this file only.

/** Which of the design's layouts a window gets (docs/design-v3.md, "The shell"), at the browser's default text size. */
export interface Layout {
  /** 720 px wide or less, or 480 px tall or less: the bar and the views row on top, sheets, the talk bar at the foot. */
  phone: boolean;
  /** The phone layout under 560 px tall: the views fold into one Views key, the strip hides, Feed joins the talk bar. */
  short: boolean;
  /** 721 to 895 px wide: the side panel floats over the main view, with no separator and no pull. */
  floating: boolean;
}

export function layoutOf(page: Page): Layout {
  const { width, height } = page.viewportSize() ?? { width: 1440, height: 900 };
  const phone = width <= 720 || height <= 480;
  return { phone, short: phone && height < 560, floating: !phone && width <= 895 };
}

/** Touch-first screens, where Return starts a new line in the talk bar and Send sends. */
export const touchFirst = async (page: Page): Promise<boolean> => (await page.evaluate("matchMedia('(hover: none) and (pointer: coarse)').matches")) === true;

/**
 * A company's address in the stage and dock's form, written by the app's own address.ts. `main` is the main view's path
 * under the company: '' for the office, 'org', 'tasks', 'plan', 'plan/v2', 'dashboards', 'dashboards/spend', 'decisions',
 * 'preview', 'tasks/t-12/diff'. `panel` is the side panel's view: 'people/kai', 'tasks/t-12', 'tasks/new', 'inbox/q-3',
 * 'messages/m-3', 'decisions/d-4', 'customize', 'settings', 'proposal'. An old form throws: a spec that means an old
 * address opens it with `open`, on purpose.
 */
export function companyAddress(id: string, where: { main?: string; panel?: string } = {}): string {
  const path = `/c/${encodeURIComponent(id)}${where.main ? `/${where.main}` : ''}`;
  const read = parseCompanyAddress(path, where.panel ? `?panel=${where.panel}` : '');
  if (!read || read.old) throw new Error(`${path} is an address from before the stage and dock.`);
  if (where.panel && !read.route.panel) throw new Error(`?panel=${where.panel} names no view of the side panel.`);
  return companyHref(read.company, read.route);
}

/** The page's address as the app keeps it: its path and search, without the token. */
export function addressOf(page: Page): string {
  const url = new URL(page.url());
  const search = url.search.replace(/([?&])token=[^&]*&?/, '$1').replace(/[?&]$/, '');
  return `${url.pathname}${search}`;
}

/** Waits until the address bar shows `address` (as companyAddress writes it). */
export const expectAddress = (page: Page, address: string, message?: string) => expect.poll(() => addressOf(page), { message }).toBe(address);

/**
 * The views a person goes to (v0.2): Progress, Office and Tasks in the switcher; the org chart, the dashboards and the
 * decision log behind More ("Org" is the org chart's link, named "Org chart" there).
 */
export type ViewName = 'Progress' | 'Office' | 'Tasks' | 'Org' | 'Dashboards' | 'Decision log';

/** The views behind More, by the name of their link there. */
const MORE_VIEWS: Partial<Record<ViewName, string>> = { Org: 'Org chart', Dashboards: 'Dashboards', 'Decision log': 'Decision log' };
/** The link's name for a view: "Org chart" for Org, the view's own name otherwise. */
export const viewLinkName = (view: ViewName): string => MORE_VIEWS[view] ?? view;

/** The company bar's More, a disclosure of the views behind it and the office's own choices. */
export const moreKey = (page: Page): Locator => page.getByRole('banner').getByRole('button', { name: 'More', exact: true });

/** Opens More (if it isn't open) and returns its list. */
export async function openMore(page: Page): Promise<Locator> {
  const key = moreKey(page);
  if ((await key.getAttribute('aria-expanded')) !== 'true') await key.click();
  const id = await key.getAttribute('aria-controls');
  if (!id) throw new Error('More controls nothing.');
  return page.locator(`[id="${id}"]`);
}

/**
 * The view switcher: the `nav` named "Views", in the bar or a phone's views row (both in the banner; the task board's
 * Board and Plan have a nav of that name too). Short windows fold it behind a Views key.
 */
export const switcher = (page: Page): Locator => page.getByRole('banner').getByRole('navigation', { name: 'Views' });
/**
 * A short window's Views key, a disclosure of the four links. The design names it with the current view ("Views, Org");
 * the switcher spec checks that name, while navigation finds the key either way.
 */
export const viewsKey = (page: Page): Locator => page.getByRole('banner').getByRole('button', { name: /^Views(, |$)/ });

/** Opens a company at an address of the stage and dock and waits for its shell: the company bar with Inbox in it. */
export async function openCompany(page: Page, id: string, where: { main?: string; panel?: string } = {}, hub = HUB): Promise<void> {
  await open(page, companyAddress(id, where), hub);
  await expect(inboxKey(page)).toBeVisible({ timeout: 30_000 });
}

/** In the page: what has focus, in a few words for a failure message (focusedThing, and walks that ask more at once). */
export const FOCUSED_THING = `(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'nothing';
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 50);
    return el.tagName.toLowerCase() + (label ? ' "' + label + '"' : '');
  })()`;

/** What has focus, in a few words for a failure message. */
export async function focusedThing(page: Page): Promise<string> {
  return (await page.evaluate(FOCUSED_THING)) as string;
}

/**
 * Where a view's link is: the switcher (Progress, Office, Tasks), More for the org chart, the dashboards and the decision
 * log (opened here first), or in a short window what its Views key discloses, which lists all of them.
 */
export async function viewLinks(page: Page, view: ViewName = 'Office'): Promise<Locator> {
  if (!layoutOf(page).short) return MORE_VIEWS[view] ? openMore(page) : switcher(page);
  const key = viewsKey(page);
  if ((await key.getAttribute('aria-expanded')) !== 'true') await key.click();
  const id = await key.getAttribute('aria-controls');
  if (!id) throw new Error('The Views key controls nothing.');
  return page.locator(`[id="${id}"]`);
}

/** Goes to a main view the way a person does: its link in the switcher or More, through the Views key in a short window. */
export async function switchTo(page: Page, view: ViewName): Promise<void> {
  await (await viewLinks(page, view)).getByRole('link', { name: viewLinkName(view), exact: true }).click();
}

/** Opens a company's progress view, where every entry point lands, and waits for its heading. */
export async function openProgress(page: Page, id: string, options: { panel?: string; hub?: string } = {}): Promise<Locator> {
  await openCompany(page, id, { main: 'progress', panel: options.panel }, options.hub);
  const column = page.locator('[data-progress]');
  await expect(column.getByRole('heading', { level: 2, name: 'Progress' })).toBeVisible({ timeout: 30_000 });
  return column;
}

/** The side panel: a docked or floating panel on desktops, a sheet on phones; its view's title is its first `h2`. */
export const sidePanel = (page: Page): Locator => page.getByRole('complementary', { name: 'Side panel' });
export const panelTitle = (page: Page): Locator => sidePanel(page).getByRole('heading', { level: 2 }).first();
/** The side panel's left edge, a window splitter; hidden, the same control is the pull on the window's right edge. */
export const separator = (page: Page): Locator => page.getByRole('separator', { name: 'Resize the side panel' });
/** Inbox in the company bar ("Inbox", "Inbox, 6 need you"). */
export const inboxKey = (page: Page): Locator => page.getByRole('banner').getByRole('button', { name: /^Inbox\b/ });
/**
 * The side panel's toggle on desktops (v0.2): Inbox, which shows the inbox in the panel and hides the panel when the
 * inbox already shows there (`aria-expanded` says whether the panel shows). Phones have no toggle: Inbox raises a sheet.
 * Found by role, so the bar's hidden measuring copies (aria-hidden) never count.
 */
export const panelToggle = (page: Page): Locator => inboxKey(page).and(page.locator('[aria-expanded]'));

/**
 * A phone opens on the office with the side panel's sheet only peeking (its head and first line): this brings the
 * home view's sheet up with the Inbox key, as a person does. Where the sheet is up already (a docked panel on a
 * desktop, a `?panel=` address on a phone) it does nothing.
 */
export async function sheetUp(page: Page): Promise<void> {
  const peek = sidePanel(page).getByRole('button', { name: /^Open the / });
  await expect(peek.or(panelTitle(page))).toBeVisible({ timeout: 30_000 });
  if (await peek.isVisible()) await inboxKey(page).click();
  await expect(peek).toHaveCount(0);
}

/** Opens a company with the side panel on a view (`panel` as in companyAddress) and waits for that view's title. */
export async function openPanel(page: Page, id: string, panel: string, options: { main?: string; hub?: string } = {}): Promise<Locator> {
  await openCompany(page, id, { main: options.main, panel }, options.hub);
  await expect(panelTitle(page)).toBeVisible();
  return sidePanel(page);
}

/** A board's title, by the first part of its path: sub-views keep their board's. */
const BOARD_TITLES: Record<string, string> = { org: 'Org chart', tasks: 'Tasks', plan: 'Tasks', dashboards: 'Dashboards', decisions: 'Dashboards' };
export const boardTitle = (board: string): string => {
  const title = BOARD_TITLES[board.split('/')[0] ?? ''];
  if (!title) throw new Error(`${board} is not a board.`);
  return title;
};

/** A board over the map: the frame, a region named by its `h2` title. */
export const boardFrame = (page: Page, title: string): Locator => page.getByRole('region', { name: title, exact: true });

/** Opens a company on a board (`board` as `main` in companyAddress) and waits for the board's title. */
export async function openBoard(page: Page, id: string, board: string, options: { panel?: string; hub?: string } = {}): Promise<Locator> {
  await openCompany(page, id, { main: board, panel: options.panel }, options.hub);
  const title = boardTitle(board);
  const frame = boardFrame(page, title);
  await expect(frame.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible({ timeout: 30_000 });
  // The frame says "Opening the task board…" (aria-busy) until the board's code has loaded.
  await expect(frame).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
  return frame;
}

/** Opens the palette from More, as a person without the shortcut does: "Find an action". */
export async function findAnAction(page: Page): Promise<void> {
  await (await openMore(page)).getByRole('button', { name: /^Find an action/ }).click();
}

/**
 * Runs a palette command the device's way (Ctrl+K with a keyboard, More's Find an action on a phone): types `query` in
 * its search and picks the first option named `option`.
 */
export async function fromPalette(page: Page, query: string, option: string | RegExp): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Actions' });
  if (layoutOf(page).phone) await findAnAction(page);
  else {
    // The shortcut listens once the company has drawn: a press made the moment its address shows (a step's checks can pass
    // while it still loads) is pressed again, never while the palette is already up.
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.keyboard.press('Control+k');
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
  }
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill(query);
  await dialog.getByRole('option', { name: option }).first().click();
}

/** The office in a board's corner: one button, "Back to the office. Working, 4 need you." (none on phones). */
export const miniMap = (page: Page): Locator => page.getByRole('button', { name: /^Back to the office\. / });

// The talk bar (docs/design-v3.md, "The talk bar"): a form named "Talk bar" holding the To, the box, Send and Feed.
export const talkBar = (page: Page): Locator => page.getByRole('form', { name: 'Talk bar' });
/** The box: a textarea named for whoever hears it ("Message to Mara, CEO"), a step's question, or Stop's instruction. */
export const talkBox = (page: Page): Locator => talkBar(page).locator('textarea');
/** The To: a button named for who hears it ("To Mara, CEO"); while Stop or a command lasts, a row with those words. */
export const theTo = (page: Page): Locator => talkBar(page).getByRole('button', { name: /^To / });
export const sendKey = (page: Page): Locator => talkBar(page).getByRole('button', { name: 'Send', exact: true });
/** Feed, a toggle named "Feed", "Feed, 2 new replies" or, while the feed is open, "Close the feed". */
export const feedKey = (page: Page): Locator => talkBar(page).getByRole('button', { name: /^(Feed\b|Close the feed$)/ });
export const feed = (page: Page): Locator => page.getByRole('region', { name: 'Feed', exact: true });
/** The live strip, on the Office view only (v0.2): one button, "Open the feed" (or "Open the feed, 2 new replies"), its lines inside it as text. */
export const strip = (page: Page): Locator => page.getByRole('button', { name: /^Open the feed\b/ });

/** The list the box opens (`@`, `/`, a command's choices): the listbox its `aria-controls` names. */
export async function talkList(page: Page): Promise<Locator> {
  const id = await talkBox(page).getAttribute('aria-controls');
  if (!id) throw new Error('The talk bar box controls no list.');
  return page.locator(`[id="${id}"]`);
}

/** Who to pick in the talk bar's `@` list: what is typed after the `@`, and the option to pick (by default the first whose name starts with it). */
export type Mention = string | { type: string; pick: string | RegExp };

const startsWith = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');

/**
 * Types `@` and a mention at the box's caret, then picks its option by keyboard: Down until it is the active option
 * (`aria-activedescendant`), then Enter. The list closes and the typed `@…` leaves the box.
 */
export async function pickMention(page: Page, mention: Mention): Promise<void> {
  const { type, pick } = typeof mention === 'string' ? { type: mention, pick: startsWith(mention) } : mention;
  const box = talkBox(page);
  await box.pressSequentially(`@${type}`);
  const list = await talkList(page);
  const option = list.getByRole('option', { name: pick }).first();
  await expect(option).toBeVisible();
  const wanted = await option.getAttribute('id');
  expect(wanted, 'options carry ids for aria-activedescendant').toBeTruthy();
  for (let i = 0; i < 20 && (await box.getAttribute('aria-activedescendant')) !== wanted; i++) await box.press('ArrowDown');
  await expect(box, `the option for @${type} is active`).toHaveAttribute('aria-activedescendant', wanted ?? '');
  await box.press('Enter');
  await expect(list).toBeHidden();
}

/**
 * Says something through the talk bar by keyboard, as a person does: `to` picks who hears it with leading `@` mentions
 * (null keeps the To), then the words, sent with Enter, or with Send on touch-first screens where Return starts a new
 * line. Resolves once the box has emptied, as a send does; the caller checks what the hint row says.
 */
export async function talk(page: Page, to: Mention | Mention[] | null, words: string): Promise<void> {
  const box = talkBox(page);
  await box.click();
  for (const m of to === null ? [] : Array.isArray(to) ? to : [to]) await pickMention(page, m);
  await box.pressSequentially(words);
  if (await touchFirst(page)) await sendKey(page).click();
  else await box.press('Enter');
  await expect(box).toHaveValue('');
}

// The task board (docs/design-v3.md, "The task board"): columns are lists under their headings, cards are links named
// by their task's title.

/**
 * A column by its word ("Queued", "Waiting for you", "In review"); a count may follow the word in its name. On desktops
 * it is a list under its heading; on phones, one column at a time, it is the tab panel its chip (a tab) shows.
 */
export const column = (scope: Page | Locator, name: string): Locator => {
  const named = new RegExp(`^${name}\\b`);
  return scope.getByRole('list', { name: named }).or(scope.getByRole('tabpanel', { name: named }));
};
/** A task's card: the link named by the task's title. */
export const card = (scope: Page | Locator, title: string): Locator => scope.getByRole('link', { name: title, exact: true });

/**
 * Page code run on an element (`el`) or a list of them (`els`), written as a string since the Node typecheck has no DOM
 * types, made into a function: a string given to evaluate is an expression, so an arrow function in one is never called.
 */
export const onElement = <R>(body: string) => new Function('el', body) as (el: unknown) => R;
export const onElements = <R>(body: string) => new Function('els', body) as (els: unknown[]) => R;

/** The titles of a column's cards, top to bottom: their links' names. */
export async function titlesIn(list: Locator): Promise<string[]> {
  return list.getByRole('link').evaluateAll(onElements<string[]>(`return els.map((a) => a.getAttribute('aria-label') || a.textContent.trim());`));
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(target: Locator): Promise<Box> {
  const b = await target.boundingBox();
  if (!b) throw new Error('Not on the page.');
  return b;
}

/**
 * The box of `target` once it has one. A target that is a choice between two things (the rail, or the column it opens
 * into) can change between one call and the next while a card is held, so a missing box is waited out, not an error.
 */
async function boxWhenShown(target: Locator): Promise<Box> {
  await expect.poll(async () => (await target.boundingBox()) !== null, { message: 'the target has a place on the page', timeout: 5_000 }).toBe(true);
  return boxOf(target);
}

/**
 * The part of the window `target` can show in: the box of its nearest sideways scroller (the board) and of its nearest
 * upright one (its column), cut to each other and to the window.
 */
async function viewOf(target: Locator): Promise<Box> {
  return target.evaluate(
    onElement<Box>(`
      const scroller = (axis) => {
        let s = el.parentElement;
        const scrolls = (n) => axis === 'x'
          ? n.scrollWidth > n.clientWidth && /(auto|scroll)/.test(getComputedStyle(n).overflowX)
          : n.scrollHeight > n.clientHeight && /(auto|scroll)/.test(getComputedStyle(n).overflowY);
        while (s && !scrolls(s)) s = s.parentElement;
        return s ? s.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      };
      const x = scroller('x'), y = scroller('y');
      const left = Math.max(x.left, y.left, 0), top = Math.max(x.top, y.top, 0);
      const right = Math.min(x.right, y.right, innerWidth), bottom = Math.min(x.bottom, y.bottom, innerHeight);
      return { x: left, y: top, width: right - left, height: bottom - top };
    `),
  );
}

/** Holds a lifted card at the board's or the column's edge toward `target` until it has scrolled `target` into view. */
async function carryTo(page: Page, target: Locator): Promise<void> {
  let nudge = 0;
  await expect
    .poll(
      async () => {
        const b = await target.boundingBox().catch(() => null);
        if (!b) return false; // the rail is opening into its column: look again
        const view = await viewOf(target).catch(() => null);
        if (!view) return false;
        const x = b.x + Math.min(b.width / 2, 30);
        const y = b.y + Math.min(b.height / 2, 20);
        const inX = x >= view.x + 24 && x <= view.x + view.width - 24;
        const inY = y >= view.y + 8 && y <= view.y + view.height - 8;
        if (inX && inY) return true;
        nudge = 1 - nudge;
        // Held toward the side the target is out on, the dead band inside the edge included: from there the board scrolls.
        const edgeX = inX ? x : x > view.x + view.width - 24 ? view.x + view.width - 4 : view.x + 4;
        const edgeY = inY ? view.y + view.height / 2 : y > view.y + view.height - 8 ? view.y + view.height - 4 : view.y + 4;
        await page.mouse.move(edgeX - nudge, edgeY, { steps: 2 });
        return false;
      },
      { message: 'the board scrolls the target into view while a card is held at its edge', timeout: 15_000, intervals: [100] },
    )
    .toBe(true);
}

/** Presses on a card's note (its link covers it) and moves past the slop, so the card lifts as a mouse drag starts. */
export async function liftCard(page: Page, from: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const a = await boxOf(from);
  const start = { x: a.x + a.width * 0.4, y: a.y + a.height * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 10, { steps: 5 });
}

/**
 * Carries a lifted card over `onto`, without letting go: a card, landing before it (`before`), or a column, over its
 * visible part above the talk bar (after its last card when the column is short). A target out of view is reached by
 * holding the card at the edge until it scrolls there, as a person does.
 */
export async function carryOver(page: Page, onto: Locator, { before = false } = {}): Promise<void> {
  await carryTo(page, onto);
  // Out of the edge band before measuring, so the board stops scrolling under the pointer, and a frame to settle.
  const middle = await viewOf(onto);
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2, { steps: 3 });
  await page.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))');
  await carryTo(page, onto);
  const b = await boxWhenShown(onto);
  const view = await viewOf(onto);
  const floor = Math.min(b.y + b.height, view.y + view.height, (page.viewportSize()?.height ?? 900) - 160);
  const y = before ? b.y + Math.min(10, b.height / 4) : Math.max(b.y + 12, floor - 16);
  // Aim within the part that shows: a wide target half out of view would put the pointer past the board's edge (under
  // the side panel), where letting go puts the card back.
  const x = Math.min(Math.max(b.x + b.width / 2, view.x + 24), view.x + view.width - 24);
  await page.mouse.move(x, y, { steps: 15 });
  // Two frames, so the board has taken the last move before the card is let go: a busy machine let go of one over the
  // column the board last saw, and the card stayed where it was.
  await page.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))');
}

/**
 * Drags a card with the mouse as a person does: lift it, carry it over `onto` (see carryOver) and let go. Phones have
 * no dragging (they have Move), so this is for the desktop sizes.
 */
export async function cardDrag(page: Page, from: Locator, onto: Locator, options: { before?: boolean } = {}): Promise<void> {
  await liftCard(page, from);
  await carryOver(page, onto, options);
  await page.mouse.up();
}

/**
 * The keyboard way of a drag (docs/design-v3.md, "The keyboard way"): focus on the card, Space picks it up, `keys` move
 * it (ArrowUp, ArrowDown, ArrowLeft, ArrowRight), and `put` ends it: Space or Enter puts it there, Escape puts it back.
 */
export async function cardKeys(page: Page, from: Locator, keys: readonly string[], put: 'Space' | 'Enter' | 'Escape' = 'Space'): Promise<void> {
  await from.focus();
  await expect(from).toBeFocused();
  await page.keyboard.press('Space');
  for (const key of keys) await page.keyboard.press(key);
  await page.keyboard.press(put);
}

/** Opens a card's Move ("Move “Cart summary”") and returns its menu; on phones the action sheet, a modal dialog. */
export async function moveMenu(page: Page, title: string): Promise<Locator> {
  const move = page.getByRole('button', { name: `Move “${title}”`, exact: true });
  if (!layoutOf(page).phone) await card(page, title).hover();
  await move.click();
  const menu = layoutOf(page).phone ? page.getByRole('dialog') : page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

// Checks every view of the stage and dock owes at every size.

/**
 * Puts the keyboard at the top of the page, as a fresh load does, so the next Tab reaches the page's first stop. A
 * script's blur() would leave the browser's starting point where focus was.
 */
export async function focusTop(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const top = document.createElement('span');
    top.tabIndex = -1;
    document.body.prepend(top);
    top.focus();
  })()`);
}

/** Nothing scrolls sideways (docs/design-v3.md, "Narrow and short windows"). */
export async function expectNoSidewaysScroll(page: Page, where = 'the page'): Promise<void> {
  const over = (await page.evaluate('document.documentElement.scrollWidth - innerWidth')) as number;
  expect(over, `${where} scrolls sideways by ${over} px`).toBeLessThanOrEqual(0);
}

/**
 * Whether the focused element can be seen (docs/design-hud.md, "Focus is never hidden"): inside the window, and the
 * topmost thing at its middle, so no talk bar, strip, mini-map, feed or side panel lies over it. Null when it can be
 * seen (or nothing has focus); else what is wrong, for the failure message.
 */
export async function hiddenFocus(page: Page): Promise<string | null> {
  return (await page.evaluate(HIDDEN_FOCUS)) as string | null;
}

/** In the page: hiddenFocus's answer, for walks that ask more at once. */
export const HIDDEN_FOCUS = `(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const name = (e) => e.tagName.toLowerCase() + (e.getAttribute('aria-label') ? ' "' + e.getAttribute('aria-label') + '"' : e.textContent ? ' "' + e.textContent.trim().slice(0, 40) + '"' : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) return null;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return name(el) + ' has focus outside the window';
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    // Hit-testing skips what lets the pointer through (a label over the 3D office passes presses to the canvas), so
    // the focused element takes the pointer for the moment of the test.
    const before = el.style.pointerEvents;
    el.style.pointerEvents = 'auto';
    const at = document.elementFromPoint(x, y);
    el.style.pointerEvents = before;
    if (!at || at === el || el.contains(at) || at.contains(el)) return null;
    return name(el) + ' has focus under ' + name(at);
  })()`;
