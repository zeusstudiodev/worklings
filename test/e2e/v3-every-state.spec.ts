import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  boardFrame,
  boardTitle,
  expectNoSidewaysScroll,
  feed,
  feedKey,
  focusedThing,
  focusTop,
  hiddenFocus,
  layoutOf,
  nameFor,
  onElement,
  open,
  openBoard,
  openCompany,
  running,
  scratchOf,
  shot,
  sheetUp,
  sidePanel,
  switchTo,
  talkBox,
  tell,
  theTo,
  until,
  waitForProposal,
  watchErrors,
  moreKey,
} from './v3-kit.ts';
import { api, found } from './v3-world.ts';

// H64 (AC40), every state of every new view: empty, loading, error, long content, a 40-person org, reduced motion and
// keyboard focus, in the live company (the e2e hub, only Claude Code faked), the demo companies and, in test/site, the
// static demo. What the other specs already prove is mapped in the run's coverage.md; this file fills what it found
// missing and saves a screenshot of each state for a person to look at. A state's checks are what must hold in it
// (the words it says, nothing scrolling sideways, no focus hidden); how it looks is for the eyes.

const DEMO = 'demo';
const phoneOf = (page: Page): boolean => layoutOf(page).phone;

/** Opens the feed with Feed, in the talk bar at every size since v0.8. */
async function openFeed(page: Page): Promise<Locator> {
  const opener = feedKey(page);
  await opener.click();
  await expect(feed(page)).toBeVisible();
  return feed(page);
}

/**
 * The feed asks the office for one message before the oldest it holds, to know whether to offer "Show earlier lines".
 * This company keeps nothing older, so a test that needs the key answers that ask as an office with history would.
 */
async function officeWithHistory(page: Page, companyId: string): Promise<void> {
  await page.route(new RegExp(`/api/c/${companyId}/messages\\?.*limit=1(&|$)`), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [{ id: 'm-earlier', from: 'ceo', to: 'you', text: 'Earlier.', origin: null, relayOf: null, note: null, at: 1, deliveredAt: null, interrupt: false }], acks: [], more: true }),
    }),
  );
}

/** Closes the feed again (Escape, as a keyboard does). */
async function closeFeed(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(feed(page)).toBeHidden();
}

/** The 3D office has drawn: its room signs, which the labels put over it once the scene is projected, are there. */
// v0.8: a room's sign shows only while someone works there, so the office counts as drawn once its canvas and its labels'
// layer are on the page.
const officeDrawn = async (page: Page) => {
  await expect(page.locator('.stage canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.labels--office')).toBeAttached({ timeout: 30_000 });
};

/** The demo companies live in the page: the tab enters the demo at the café, then opens one by its address. */
async function enterDemo(page: Page): Promise<void> {
  await open(page, `/c/${DEMO}`);
  await expect(moreKey(page)).toBeVisible({ timeout: 30_000 });
}

/** A board of a company, opened at its address, with its frame drawn. */
async function board(page: Page, id: string, path: string): Promise<Locator> {
  return openBoard(page, id, path);
}

/**
 * Whatever lies outside `root` sideways, for the failure message: a visible element that ends past the root's edges, and a
 * scroller of its own (a table, a board) that scrolls sideways when it need not. What sits inside a scroller that is meant
 * to scroll sideways (overflow auto or scroll, as the boards' columns are) is its own business and is not looked into.
 */
async function overflowing(page: Page, root: Locator): Promise<string[]> {
  return root
    .evaluate(
      onElement<string[]>(`
        const out = [];
        const edge = el.getBoundingClientRect();
        const name = (e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40);
        const visit = (node) => {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const box = node.getBoundingClientRect();
          if (box.width > 0 && node !== el && (box.right > edge.right + 1 || box.left < edge.left - 1)) {
            out.push(name(node) + ' lies ' + Math.round(Math.max(box.right - edge.right, edge.left - box.left)) + 'px outside');
          }
          if (/(auto|scroll)/.test(style.overflowX)) {
            if (node.scrollWidth - node.clientWidth > 1 && node.matches('.feed__body, .side-panel__body, .panel__body')) out.push(name(node) + ' scrolls sideways by ' + (node.scrollWidth - node.clientWidth) + 'px');
            return;
          }
          for (const child of node.children) visit(child);
        };
        visit(el);
        return out.slice(0, 6);
      `),
    )
    .catch(() => []);
}

/** Tab through the page from its top: no focus lies under anything, and every stop shows where it is. */
async function walk(page: Page, steps: number, where: string): Promise<string[]> {
  await focusTop(page);
  const seen: string[] = [];
  const problems: string[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const now = await focusedThing(page);
    if (now === 'nothing') continue;
    seen.push(now);
    const hidden = await hiddenFocus(page);
    if (hidden) problems.push(`${where}: ${hidden}`);
    const ring = (await page.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'ok';
      // The side panel's separator shows focus on its handle, a child (shell.css), which v3-shell.spec.ts looks at.
      if (el.getAttribute('role') === 'separator') return 'ok';
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow !== 'none';
      return outline || shadow ? 'ok' : 'no indicator on ' + el.tagName.toLowerCase() + ' ' + (el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30));
    })()`)) as string;
    if (ring !== 'ok') problems.push(`${where}: ${ring}`);
  }
  expect(seen.length, `${where}: the keyboard reaches something`).toBeGreaterThan(3);
  return problems;
}

/** What still moves with reduced motion: running CSS animations and transitions on the page's own elements. */
async function stillMoving(page: Page): Promise<string[]> {
  return (await page.evaluate(`(() => document.getAnimations()
    .filter((a) => a.playState === 'running' && a.effect && a.effect.target && !(a.effect.target.closest && a.effect.target.closest('canvas')))
    .map((a) => (a.animationName || a.transitionProperty || 'animation') + ' on ' + (a.effect.target.tagName || '').toLowerCase() + '.' + String(a.effect.target.className || '').slice(0, 40)))()`)) as string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// The demo companies: empty, drafting, a proposal after scoping, 40 people, a company that can't run

test.describe('the demo companies, every view', () => {
  test('lake-wind, a CEO alone and drafting: each view says what it waits for', async ({ page }, info) => {
    const errors = watchErrors(page);
    await enterDemo(page);
    await openCompany(page, 'lake-wind');
    await officeDrawn(page);
    await shot(page, 'h64-lakewind-office', info);
    // The feed first. A phone has no way in before the start: the CEO's suggestions stand where the strip does (a finding
    // in the run's notes), so the feed of a company that is drafting or proposed is checked on desktops.
    if (!phoneOf(page)) {
      const list = await openFeed(page);
      // Not empty: what the company wrote about itself (its start, the scoping) is there.
      await expect(list.getByRole('article').first()).toBeVisible();
      await shot(page, 'h64-lakewind-feed', info);
      await closeFeed(page);
    }
    await sheetUp(page);
    await expect(page.getByRole('heading', { name: 'Drafting your company' })).toBeVisible();
    await shot(page, 'h64-lakewind-panel', info);

    const org = await board(page, 'lake-wind', 'org');
    await expect(org.getByText('The CEO is drafting your company. About a minute.')).toBeVisible();
    // One card, the CEO, until the draft comes: not yet a tree.
    await expect(org.getByText('Rhea', { exact: true })).toBeVisible();
    await expectNoSidewaysScroll(page, 'the org chart of one');
    await shot(page, 'h64-lakewind-org', info);

    const tasks = await board(page, 'lake-wind', 'tasks');
    await expect(tasks.getByText('No tasks yet. The heads split the goal into tasks once the company starts.')).toBeVisible();
    await expectNoSidewaysScroll(page, 'the empty task board');
    await shot(page, 'h64-lakewind-tasks', info);

    const dashboards = await board(page, 'lake-wind', 'dashboards');
    await expect(dashboards.getByText('No goal yet. The CEO sets one when the company starts.')).toBeVisible();
    await shot(page, 'h64-lakewind-progress', info);
    for (const name of ['spend', 'timeline']) {
      await openBoard(page, 'lake-wind', `dashboards/${name}`);
      await expectNoSidewaysScroll(page, `the ${name} dashboard of a company that has done nothing`);
      await shot(page, `h64-lakewind-${name}`, info);
    }

    expect(errors).toEqual([]);
  });

  test('plant-pal, the proposal after its scoping questions; old-site, a company that cannot run', async ({ page }, info) => {
    const errors = watchErrors(page);
    await enterDemo(page);
    await openCompany(page, 'plant-pal');
    if (!phoneOf(page)) {
      const list = await openFeed(page);
      await expect(list.getByRole('article').first()).toBeVisible();
      await shot(page, 'h64-plantpal-feed', info);
      await closeFeed(page);
    }
    await sheetUp(page);
    await expect(page.getByRole('heading', { name: "The CEO's proposal" })).toBeVisible();
    // What was asked and what was answered stays above the proposal it led to.
    await expect(page.getByRole('region', { name: "The CEO's questions" })).toBeVisible();
    await expectNoSidewaysScroll(page, 'the proposal');
    await shot(page, 'h64-plantpal-proposal', info);

    await openCompany(page, 'old-site');
    await sheetUp(page);
    await expect(sidePanel(page)).toContainText("Its folder isn't at");
    // The head and the card said it twice; once is enough.
    expect((await sidePanel(page).innerText()).match(/Its folder isn't at/g)).toHaveLength(1);
    await expectNoSidewaysScroll(page, 'a company that cannot run');
    await shot(page, 'h64-oldsite-office', info);
    expect(errors).toEqual([]);
  });

  test('Ledger, 40 people and a hundred tasks: the board, the dashboards and the feed hold', async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await enterDemo(page);
    const tasks = await board(page, 'ledger', 'tasks');
    await expect(tasks.getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    // Phones show one column at a time, so the count to expect is the columns the chips name.
    expect(await tasks.getByRole('link').count(), 'cards drawn').toBeGreaterThan(3);
    await expectNoSidewaysScroll(page, 'the 100-task board');
    await shot(page, 'h64-ledger-tasks', info);
    for (const name of ['', '/spend', '/timeline']) {
      await openBoard(page, 'ledger', `dashboards${name}`);
      await expectNoSidewaysScroll(page, `the Ledger dashboard ${name || 'progress'}`);
      await shot(page, `h64-ledger-dashboards${name.replace('/', '-')}`, info);
    }
    await openCompany(page, 'ledger');
    await sheetUp(page);
    await openFeed(page);
    await expectNoSidewaysScroll(page, "Ledger's feed");
    await shot(page, 'h64-ledger-feed', info);
    await closeFeed(page);
    // The To's picker with forty people to choose from: inside the window, nothing sideways, and Escape puts it away.
    await openCompany(page, 'ledger');
    await theTo(page).click();
    const picker = page.getByRole('dialog', { name: 'Who hears it' }).or(page.getByRole('group', { name: 'Who hears it' })).first();
    await expect(picker).toBeVisible();
    const [box, size] = [await picker.boundingBox(), page.viewportSize()];
    expect(box && size && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, `the picker ${JSON.stringify(box)} lies inside the window`).toBe(true);
    await expectNoSidewaysScroll(page, 'the picker of forty');
    await shot(page, 'h64-ledger-picker', info);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    expect(errors).toEqual([]);
  });

  for (const [name, where] of [
    ['the org chart of Café Lumen', { id: DEMO, main: 'org' }],
    ['the task board of Café Lumen', { id: DEMO, main: 'tasks' }],
    ['the dashboards of Café Lumen', { id: DEMO, main: 'dashboards' }],
    ['the 40-person org chart of Ledger', { id: 'ledger', main: 'org' }],
    ['the 100-task board of Ledger', { id: 'ledger', main: 'tasks' }],
  ] as const) {
    test(`keyboard focus: Tab through ${name} never hides focus and every stop shows where it is`, async ({ page }, info) => {
      const errors = watchErrors(page);
      await enterDemo(page);
      await board(page, where.id, where.main);
      const problems = await walk(page, 36, name);
      await shot(page, `h64-tab-${where.id}-${where.main}`, info);
      expect(problems).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('keyboard focus: Tab through the open feed never hides focus under it', async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await enterDemo(page);
    await openCompany(page, DEMO);
    await openFeed(page);
    const inFeed = await walk(page, 24, 'the open feed');
    await shot(page, 'h64-tab-feed', info);
    expect(inFeed).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the open feed hides the office labels beneath it, so nothing shows through or takes focus', async ({ page }, info) => {
    test.setTimeout(120_000);
    await enterDemo(page);
    await openCompany(page, DEMO);
    await officeDrawn(page);
    await openFeed(page);
    // Whatever label still shows (desktops keep the ones beside the feed) lies clear of it; on a phone none shows.
    const underFeed = async () =>
      (await page.evaluate(`(() => {
      const feed = document.querySelector('#company-feed')?.getBoundingClientRect();
      if (!feed) return ['no feed'];
      return [...document.querySelectorAll('.labels .label')]
        .filter((el) => getComputedStyle(el).visibility !== 'hidden')
        .filter((el) => {
          const r = (el.firstElementChild || el).getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left < feed.right && feed.left < r.right && r.top < feed.bottom && feed.top < r.bottom;
        })
        .map((el) => (el.textContent || '').trim().slice(0, 30) || el.className);
    })()`)) as string[];
    await expect.poll(underFeed, { message: 'labels visible under the feed', timeout: 10_000 }).toEqual([]);
    if (phoneOf(page)) {
      const shown = await page.evaluate(`[...document.querySelectorAll('.labels .label')].filter((el) => getComputedStyle(el).visibility !== 'hidden').length`);
      expect(shown, 'labels computed visible while a phone covers the office').toBe(0);
    }
    await shot(page, 'h64-feed-over-labels', info);
  });

  test('keyboard focus: Tab through the proposal', async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await enterDemo(page);
    await openCompany(page, 'plant-pal');
    await sheetUp(page);
    const inProposal = await walk(page, 24, 'the proposal');
    await shot(page, 'h64-tab-proposal', info);
    expect(inProposal).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('reduced motion: nothing of the new views keeps moving, in the café, the proposal and Ledger', async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterDemo(page);
    const moving: string[] = [];
    for (const [id, main] of [[DEMO, 'org'], [DEMO, 'tasks'], [DEMO, 'dashboards'], ['ledger', 'org'], ['ledger', 'tasks']] as const) {
      await board(page, id, main);
      await page.evaluate('new Promise((done) => setTimeout(done, 700))');
      moving.push(...(await stillMoving(page)).map((m) => `${id}/${main}: ${m}`));
    }
    await openCompany(page, DEMO);
    await page.evaluate('new Promise((done) => setTimeout(done, 700))');
    moving.push(...(await stillMoving(page)).map((m) => `office, strip and talk bar: ${m}`));
    await openFeed(page);
    await page.evaluate('new Promise((done) => setTimeout(done, 700))');
    moving.push(...(await stillMoving(page)).map((m) => `feed: ${m}`));
    await shot(page, 'h64-reduced-feed', info);
    await closeFeed(page);
    await openCompany(page, 'plant-pal');
    await sheetUp(page);
    await page.evaluate('new Promise((done) => setTimeout(done, 700))');
    moving.push(...(await stillMoving(page)).map((m) => `proposal: ${m}`));
    await shot(page, 'h64-reduced-proposal', info);
    expect(moving, 'running animations with reduced motion').toEqual([]);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The live company: before the start, long content, loading, offline

test.describe('the live company, states the hub makes', () => {
  test.describe.configure({ mode: 'serial' });

  test('before the start: every view of a company with nothing in it, and the feed with only its own start', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), nameFor('every-state-new', info));
    await waitForProposal(request, id);
    await openCompany(page, id);
    await officeDrawn(page);
    await shot(page, 'h64-new-office', info);
    for (const main of ['org', 'tasks', 'dashboards', 'dashboards/spend', 'dashboards/timeline']) {
      const frame = await openBoard(page, id, main);
      await expectNoSidewaysScroll(page, `${main} of a company that has not started`);
      if (main === 'org') {
        // Before the start the chart carries the cost sentence and the Start key: on a phone both stay inside the board
        // (the key once lay out of the window, clipped away, with the sentence cut at its edge).
        const start = await frame.getByRole('button', { name: /^Start the company/ }).boundingBox();
        const width = page.viewportSize()?.width ?? 0;
        expect(start && start.x >= 0 && start.x + start.width <= width, `Start the company ${JSON.stringify(start)} lies inside the ${width} px window`).toBe(true);
      }
      await shot(page, `h64-new-${main.replace('/', '-')}`, info);
    }
    // A phone's strip gives way to the CEO's suggestions until the start, so its feed opens from the Feed key on
    // desktops only (listed in the run's findings).
    if (!phoneOf(page)) {
      await openCompany(page, id);
      const list = await openFeed(page);
      await expect(list.getByRole('article').or(list.getByText(/^Nothing said yet/)).first()).toBeVisible();
      await shot(page, 'h64-new-feed', info);
    }
    expect(errors).toEqual([]);
  });

  let id = '';
  test('long content: a message of nearly 4,000 characters and a word that never breaks stay inside the feed, the board and the panel', async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    id = await running(request, nameFor('every-state-long', info));
    const unbroken = `https://example.com/${'long-path-segment-'.repeat(12)}end`;
    // The word that never breaks comes first: the feed keeps the first 600 characters of a message.
    const words = `${unbroken} ${'Please keep every sentence of this message, it matters to the menu page. '.repeat(50)}`.slice(0, 3_950);
    await tell(request, id, 'frontend-engineer', `[fake:default] ${words}`);
    const longTitle = `A task whose title runs on and on about the menu page and its many many states ${unbroken}`.slice(0, 120);
    const made = await api<{ id: string }>(request, `api/c/${id}/tasks`, { title: longTitle, brief: words.slice(0, 1_800), files: ['src/a/very/long/path/'.repeat(6)], owner: 'frontend-engineer', doneWhen: `Done when ${unbroken}`, milestone: null });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    await until(request, id, (c) => c.messages.some((m) => m.from === 'frontend-engineer' && m.to === '@stakeholder'), 60_000);

    await openCompany(page, id);
    const list = await openFeed(page);
    const yours = list.getByRole('article').filter({ hasText: 'You wrote to Sam' }).last();
    await expect(yours).toBeVisible();
    // The feed keeps the first 600 characters of a message and cuts them to six lines, the rest behind a key where they
    // overflow (on a narrow screen); the unbroken address breaks inside the line instead of running out of it.
    expect((await yours.innerText()).length, 'a long message is cut, not poured into the feed').toBeLessThan(900);
    await shot(page, 'h64-long-feed', info);
    const more = yours.getByRole('button', { name: 'Read all of it', exact: true });
    if (await more.isVisible()) await more.click();
    expect(await overflowing(page, list), 'the feed holds its words').toEqual([]);
    await expectNoSidewaysScroll(page, 'the feed with a long message');
    await shot(page, 'h64-long-feed-open', info);
    await closeFeed(page);

    const tasks = await board(page, id, 'tasks');
    await expect(tasks.getByRole('link').filter({ hasText: 'A task whose title runs on' }).first()).toBeVisible({ timeout: 15_000 });
    expect(await overflowing(page, tasks.getByRole('link').filter({ hasText: 'A task whose title runs on' }).first()), 'a card holds a long title').toEqual([]);
    await expectNoSidewaysScroll(page, 'the board with a long title');
    // The board slides to its one column on a phone: the card is looked at once it has arrived.
    if (phoneOf(page)) await expect(tasks.getByRole('link').filter({ hasText: 'A task whose title runs on' }).first()).toBeInViewport({ ratio: 0.9 });
    await shot(page, 'h64-long-tasks', info);
    // A dashboard at the schema's limits (80-character titles, 60 bars, 8 columns and 50 rows).
    await tell(request, id, 'ceo', '[fake:dashboard-long] Publish the long dashboard');
    await until(request, id, (c) => c.dashboards.some((d) => d.title.startsWith('Everything the company measured')), 60_000);
    await openBoard(page, id, 'dashboards');
    const boards = boardFrame(page, 'Dashboards');
    const select = boards.getByRole('combobox', { name: 'Dashboard' });
    const link = boards.getByRole('navigation', { name: 'Dashboards' }).getByRole('link', { name: /^Everything the company measured/ });
    await expect(select.or(link)).toBeVisible();
    if (await select.isVisible()) {
      const label = await select.locator('option', { hasText: /^Everything the company measured/ }).first().textContent();
      await select.selectOption({ label: label ?? '' });
    } else await link.click();
    await expect(boards.getByRole('heading', { level: 3 }).first()).toBeVisible();
    const cards = boards.locator('.db-card');
    await expect(cards.first()).toBeVisible();
    const wide: string[] = [];
    for (const card of await cards.all()) wide.push(...(await overflowing(page, card)));
    expect(wide, 'every widget holds its limits').toEqual([]);
    await expectNoSidewaysScroll(page, 'a dashboard at its limits');
    await shot(page, 'h64-long-dashboard', info);
    const again = await board(page, id, 'tasks');
    await again.getByRole('link').filter({ hasText: 'A task whose title runs on' }).first().click();
    await expect(sidePanel(page).getByRole('heading', { level: 2 }).first()).toBeVisible();
    expect(await overflowing(page, sidePanel(page).locator('.side-panel__paper')), 'the task panel holds a long title and brief').toEqual([]);
    await expectNoSidewaysScroll(page, "a task's panel with long words");
    await shot(page, 'h64-long-task-panel', info);
    expect(errors).toEqual([]);
  });

  test('the feed offers no earlier lines in a company whose view holds every message', async ({ page }) => {
    test.setTimeout(120_000);
    expect(id, 'the long-content test made the company').not.toBe('');
    // The office answers the feed's ask for one earlier message with nothing; wait for that answer, then look.
    const asked = page.waitForResponse((r) => new RegExp(`/api/c/${id}/messages\\?.*limit=1(&|$)`).test(r.url()), { timeout: 60_000 });
    await openCompany(page, id);
    const list = await openFeed(page);
    expect((await asked).ok()).toBe(true);
    await expect(list.getByRole('heading', { name: 'Feed' })).toBeVisible();
    await expect(list.getByRole('button', { name: /^(Show earlier lines|Try again)$/ })).toHaveCount(0);
  });

  test('the feed reaching for earlier lines: waiting, refused and nothing older kept', async ({ page }, info) => {
    test.setTimeout(120_000);
    expect(id, 'the long-content test made the company').not.toBe('');
    const errors = watchErrors(page);
    await officeWithHistory(page, id);
    let mode: 'slow' | 'refuse' | 'real' = 'slow';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(new RegExp(`/api/c/${id}/messages\\?`), async (route) => {
      // The one-message ask that decides whether the key shows goes to the office-with-history answer above.
      if (/limit=1(&|$)/.test(route.request().url())) return route.fallback();
      if (mode === 'slow') {
        await gate;
        await route.continue();
      } else if (mode === 'refuse') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The office is busy.' }) });
      else await route.continue();
    });
    await openCompany(page, id);
    const list = await openFeed(page);
    const key = list.getByRole('button', { name: /^(Show earlier lines|Try again)$/ });
    await key.click();
    await expect(list.getByRole('button', { name: 'Loading earlier lines…' })).toHaveAttribute('aria-busy', 'true');
    await shot(page, 'h64-earlier-loading', info);
    mode = 'refuse';
    release();
    // The held ask goes through to the office and ends: nothing older is kept here, so the feed says so.
    await expect(list.getByText("Earlier lines aren't kept in the office.")).toBeVisible({ timeout: 15_000 });
    await shot(page, 'h64-earlier-ended', info);
    // The refusal: a fresh feed, the ask fails, and the sentence says why with Try again.
    await closeFeed(page);
    await page.reload();
    await expect(moreKey(page)).toBeVisible({ timeout: 30_000 });
    const again = await openFeed(page);
    await again.getByRole('button', { name: 'Show earlier lines' }).click();
    await expect(again.getByRole('alert')).toContainText("Couldn't load earlier lines. The office is busy.");
    await expect(again.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await shot(page, 'h64-earlier-refused', info);
    // The refusal is the test's own: the office's 409 is expected, nothing else.
    expect(errors.filter((e) => !/^409 .*\/messages\?before=/.test(e))).toEqual([]);
  });

  test('loading: a board opens as blank paper in its shapes while its code comes, then draws', async ({ page }, info) => {
    test.setTimeout(120_000);
    expect(id).not.toBe('');
    const errors = watchErrors(page);
    await openCompany(page, id);
    // Held scripts: the boards' code is fetched when a board opens, so the first press shows the wait.
    let held = true;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/.*\.js$/, async (route) => {
      if (held) await gate;
      await route.continue();
    });
    await switchTo(page, 'Org');
    const frame = boardFrame(page, boardTitle('org'));
    await expect(frame).toHaveAttribute('aria-busy', 'true');
    await expect(frame).toContainText('Opening the org chart…');
    await expectNoSidewaysScroll(page, 'a board while it loads');
    await shot(page, 'h64-loading-org', info);
    held = false;
    release();
    await expect(frame).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
    await expect(frame.getByRole('tree', { name: 'Org chart' }).getByRole('treeitem').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('offline: the feed says the office is out of reach while the stream is down, and is back with the next snapshot', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    expect(id).not.toBe('');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // The page's own streams are kept, so the test can make one fail as a dropped connection does (an "error" event on
    // an open EventSource); the browser's offline switch leaves a stream that is already open alone.
    await page.addInitScript(`(() => {
      const Original = window.EventSource;
      function Wrapped(url, init) { const source = new Original(url, init); (window.__streams = window.__streams || []).push(source); return source; }
      Wrapped.prototype = Original.prototype;
      for (const key of ['CONNECTING', 'OPEN', 'CLOSED']) Wrapped[key] = Original[key];
      window.EventSource = Wrapped;
    })()`);
    await officeWithHistory(page, id);
    await openCompany(page, id);
    const list = await openFeed(page);
    await page.evaluate(`(window.__streams || []).forEach((s) => s.dispatchEvent(new Event('error')))`);
    await expect(list.getByText('Reconnecting to the office.')).toBeVisible({ timeout: 15_000 });
    await expect(list.getByRole('button', { name: /^(Show earlier lines|Try again)$/ })).toHaveAttribute('aria-disabled', 'true');
    if (phoneOf(page)) {
      // The row under the bar says it, and the sheet starts below it: Close and Filter stay where a finger reaches.
      const clash = await page.evaluate(`(() => {
        const row = document.querySelector('.shell-reconnecting')?.getBoundingClientRect();
        const head = document.querySelector('.feed__head')?.getBoundingClientRect();
        return row && head ? head.top - row.bottom : null;
      })()`);
      expect(clash, "the feed's head lies below the reconnecting row").not.toBeNull();
      expect(clash as number).toBeGreaterThanOrEqual(0);
    }
    await talkBox(page).fill('Water the fern');
    await expectNoSidewaysScroll(page, 'the feed while the office is out of reach');
    await shot(page, 'h64-offline-feed', info);
    await tell(request, id, 'ceo', '[fake:default] Are you there?');
    await expect(list.getByText('Reconnecting to the office.')).toBeHidden({ timeout: 30_000 });
    await expect(talkBox(page)).toHaveValue('Water the fern');
    await shot(page, 'h64-online-again', info);
    expect(errors).toEqual([]);
  });
});
