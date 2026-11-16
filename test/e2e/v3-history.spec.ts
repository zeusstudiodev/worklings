import { expect, type Page, test } from '@playwright/test';
import {
  boardFrame,
  card,
  companyAddress,
  expectAddress,
  fromPalette,
  inboxKey,
  layoutOf,
  nameFor,
  open,
  openBoard,
  panelTitle,
  planVersions,
  running,
  scratchOf,
  shot,
  sidePanel,
  switchTo,
  until,
  watchErrors,
} from './v3-kit.ts';
import { api, folderFor } from './v3-world.ts';

// Back and Forward as a person meets them (docs/design-v3.md, "Addresses"): every change of the main view and of the
// side panel's view is an address of its own, so Back returns to the step before and Forward walks the same way again;
// a reload keeps the main view and the side panel's view; a phone opens a company on the office with the inbox's sheet peeking, and
// Back puts the sheet away without leaving the company; a trip to the demo company and back leaves the history as
// walked; the start form's Back is a Back, and a company started from it takes the form's place.
test.describe.configure({ mode: 'serial' });

const TASK = 'Water the test plant';

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  // Plan approval on: the CEO proposes a plan, which waits in the inbox, and the plan has a page of its own.
  id = await running(request, nameFor('history', info), { planApproval: 'before-work' });
  await until(request, id, (c) => planVersions(c) === 1);
  const made = await api(request, `api/c/${id}/tasks`, { title: TASK, brief: 'One pot, one glass of water.', files: [], owner: 'ux-designer', doneWhen: 'The plant is watered.' });
  expect(made.status).toBe(201);
  await request.dispose();
});

interface Step {
  name: string;
  address: string;
  /** What shows only at this step. */
  shows: (page: Page) => Promise<void>;
}

const board = (page: Page, title: string) => expect(boardFrame(page, title).getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
const panel = (page: Page, title: string | RegExp) => expect(panelTitle(page)).toHaveAccessibleName(title);
const noPanel = (page: Page) => expect(panelTitle(page)).toBeHidden();

/** The address bar and the page agree: the address is the step's, and what only that step shows is there. */
async function at(page: Page, step: Step) {
  await expectAddress(page, step.address, `the address of ${step.name}`);
  await step.shows(page);
}

test.describe('history', () => {
  test('Back walks every step in the order it was taken, and Forward walks it again', async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const phone = layoutOf(page).phone;
    const c = (main = '', side?: string) => companyAddress(id, { main, panel: side });
    const walked: Step[] = [];
    const step = async (s: Step) => {
      await at(page, s);
      walked.push(s);
    };

    await open(page, '/');
    await step({ name: 'the lobby', address: '/', shows: (p) => expect(p.getByRole('heading', { name: 'Companies', level: 2, exact: true })).toBeVisible() });
    // Every company of the suite's hub is a Plant Pal: this one's row by the key the lobby gives it.
    await page.locator(`[data-focus="company-${id}"]`).click();
    // v0.2: a company's card lands on its progress.
    if (phone) {
      // A phone opens progress with no sheet over it; Inbox brings the inbox's sheet up, and Back puts it away and stays.
      await at(page, { name: 'progress', address: c('progress'), shows: noPanel });
      await inboxKey(page).click();
      await at(page, { name: 'the inbox sheet', address: c('progress'), shows: (p) => panel(p, /^Inbox\b/) });
      await page.goBack();
      await step({ name: 'progress again', address: c('progress'), shows: noPanel });
      await switchTo(page, 'Org');
      await step({ name: 'Org', address: c('org'), shows: (p) => board(p, 'Org chart') });
      await switchTo(page, 'Tasks');
      await step({ name: 'Tasks', address: c('tasks'), shows: (p) => board(p, 'Tasks') });
      await card(page, TASK).click();
      await step({ name: 'the task', address: c('tasks', 'tasks/t-1'), shows: (p) => panel(p, TASK) });
      // A press in the views row puts the task's sheet away: the views row drops the side panel's view.
      await switchTo(page, 'Dashboards');
      await step({ name: 'Dashboards', address: c('dashboards'), shows: (p) => board(p, 'Dashboards') });
    } else {
      // Progress opens with the side panel closed on a desktop; Noor, opened from the palette, opens it beside progress.
      await step({ name: 'progress, the side panel closed', address: c('progress'), shows: noPanel });
      await fromPalette(page, 'Noor', /^Open Noor\b/);
      await step({ name: 'Noor', address: c('progress', 'people/ceo'), shows: (p) => panel(p, 'Noor') });
      // On a desktop the side panel keeps its view when the main view changes.
      await switchTo(page, 'Tasks');
      await step({ name: 'Tasks beside Noor', address: c('tasks', 'people/ceo'), shows: async (p) => {
        await board(p, 'Tasks');
        await panel(p, 'Noor');
      } });
      await card(page, TASK).click();
      await step({ name: 'the task', address: c('tasks', 'tasks/t-1'), shows: (p) => panel(p, TASK) });
      await switchTo(page, 'Dashboards');
      await step({ name: 'Dashboards beside the task', address: c('dashboards', 'tasks/t-1'), shows: async (p) => {
        await board(p, 'Dashboards');
        await panel(p, TASK);
      } });
    }
    await inboxKey(page).click();
    await step({ name: 'the inbox over Dashboards', address: c('dashboards'), shows: async (p) => {
      await board(p, 'Dashboards');
      await panel(p, /^Inbox\b/);
    } });
    await sidePanel(page).getByRole('link', { name: 'Open the plan', exact: true }).click();
    await step({ name: 'the plan', address: c('plan'), shows: (p) => expect(p.getByRole('heading', { name: 'The plan' }).first()).toBeVisible() });
    await shot(page, 'history-walked', info);

    for (const s of walked.slice(0, -1).reverse()) {
      await page.goBack();
      await at(page, s);
    }
    for (const s of walked.slice(1)) {
      await page.goForward();
      await at(page, s);
    }
    expect(errors).toEqual([]);
  });

  test('a reload keeps the main view and the side panel, and Back and the × still go where they lead', async ({ page }) => {
    const errors = watchErrors(page);
    const tasks: Step = { name: 'Tasks', address: companyAddress(id, { main: 'tasks' }), shows: (p) => board(p, 'Tasks') };
    const task: Step = { name: 'the task', address: companyAddress(id, { main: 'tasks', panel: 'tasks/t-1' }), shows: (p) => panel(p, TASK) };
    await openBoard(page, id, 'tasks');
    if (layoutOf(page).phone && (await panelTitle(page).isVisible())) await page.goBack();
    await at(page, tasks);
    await card(page, TASK).click();
    await at(page, task);
    await page.reload();
    await at(page, task);
    await page.goBack();
    await at(page, tasks);
    await page.goForward();
    await at(page, task);
    // "Back to the inbox" goes back, since the entry before is where it leads; a phone's Close does the same.
    await sidePanel(page).getByRole('button', { name: /^(Back to the inbox|Close)$/ }).first().click();
    await at(page, tasks);
    await page.goForward();
    await at(page, task);
    expect(errors).toEqual([]);
  });

  test('a view opened again is a step of its own, so Back returns to the view just before it', async ({ page }) => {
    const errors = watchErrors(page);
    const c = (main: string) => companyAddress(id, { main });
    await openBoard(page, id, 'tasks');
    if (layoutOf(page).phone && (await panelTitle(page).isVisible())) await page.goBack();
    await switchTo(page, 'Org');
    await expectAddress(page, c('org'));
    await switchTo(page, 'Tasks');
    await expectAddress(page, c('tasks'));
    await page.goBack();
    await expectAddress(page, c('org'));
    await page.goBack();
    await expectAddress(page, c('tasks'));
    await noPanelOrInbox(page);
    expect(errors).toEqual([]);
  });

  test('a trip to the demo company and back leaves the history as it was walked', async ({ page }) => {
    const errors = watchErrors(page);
    const lobby: Step = {
      name: 'your lobby',
      address: '/',
      shows: async (p) => {
        await expect(p.getByRole('heading', { name: 'Companies', level: 2, exact: true })).toBeVisible();
        await expect(p.getByRole('link', { name: 'Open the demo company' })).toBeVisible();
      },
    };
    const cafe = (p: Page) => expect(p.getByRole('banner').getByText('Café Lumen').filter({ visible: true })).toBeVisible();
    const demo: Step = { name: 'the demo company', address: companyAddress('demo'), shows: cafe };
    const org: Step = { name: "the demo's Org", address: companyAddress('demo', { main: 'org' }), shows: async (p) => {
      await cafe(p);
      await board(p, 'Org chart');
    } };
    const mara: Step = { name: 'Mara, the demo CEO', address: companyAddress('demo', { main: 'org', panel: 'people/ceo' }), shows: (p) => panel(p, 'Mara') };

    await open(page, '/');
    await at(page, lobby);
    await page.getByRole('link', { name: 'Open the demo company' }).click();
    // A phone opens it on the office with the inbox's sheet only peeking: nothing to put away.
    await at(page, demo);
    await switchTo(page, 'Org');
    await at(page, org);
    await boardFrame(page, 'Org chart').getByRole('treeitem', { name: /^Mara,/ }).click();
    await at(page, mara);
    // Its Lobby leads to your own lobby, as a new step.
    await page.getByRole('link', { name: /^Lobby/ }).click();
    await at(page, lobby);

    for (const s of [mara, org, demo]) {
      await page.goBack();
      await at(page, s);
    }
    for (const s of [org, mara, lobby]) {
      await page.goForward();
      await at(page, s);
    }
    expect(errors).toEqual([]);
  });

  test('a company started from the form takes its place, so Back goes to the lobby, not to the form', async ({ page }, info) => {
    const errors = watchErrors(page);
    const name = nameFor('history-new', info);
    const folder = folderFor(scratchOf(), name);
    await open(page, '/');
    await expect(page.getByRole('heading', { name: 'Companies', level: 2, exact: true })).toBeVisible();
    // The form's own Back closes it: the lobby it came from, not a second lobby after it.
    await page.getByRole('button', { name: 'Start a new company' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/new');
    await page.getByRole('button', { name: 'Back to the lobby' }).click();
    await expectAddress(page, '/');
    await page.goForward();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/new');
    await page.getByRole('textbox', { name: 'Folder' }).fill(folder);
    await page.getByRole('textbox', { name: 'What should the company build?' }).fill('A plant care app with watering streaks [fake:found]');
    await page.getByRole('button', { name: 'Start the company' }).click();
    // Before the start the side panel's home is the proposal, at the company's own address.
    await expectAddress(page, companyAddress(name));
    await page.goBack();
    await expectAddress(page, '/');
    await expect(page.getByRole('heading', { name: 'Companies', level: 2, exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

/** Neither another view of the side panel nor a sheet: a desktop's side panel on the inbox, a phone's put away. */
async function noPanelOrInbox(page: Page) {
  if (layoutOf(page).phone) await noPanel(page);
  else await panel(page, /^Inbox\b/);
}
