// H51: the static web demo (npm run build:site, dist/site) from plain files, served the way GitHub Pages serves them
// (scripts/site-server.mjs). There is no API: a request to /api or /events, or to anything off the site, is blocked and
// fails the test, as does any console error, failed response or policy violation. It drives the lobby, the office, the
// inbox, a steering action and the layout at 1440 and 375 px. Screenshots go to SITE_EVIDENCE when it is set.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page, type Response, type TestInfo } from '@playwright/test';

const SITE = '/worklings/';
const INSTALL = 'https://github.com/zeusstudiodev/worklings';
const EVIDENCE = process.env.SITE_EVIDENCE ?? join(import.meta.dirname, '..', '..', 'test-results', 'site', 'evidence');
mkdirSync(EVIDENCE, { recursive: true });

interface Watch {
  /** Requests the site must never make (an API, a stream, anything off the site): each was blocked. */
  blocked: string[];
  /** What went wrong: thrown, logged as an error, or a request that failed. */
  errors: string[];
  /** Every art file fetched, as "200 /worklings/art/clips.glb". */
  art: string[];
}

/** Pages' answer to an address with no file: 404.html, which is the app itself, at that address. */
const isFallback = (r: Response) => r.status() === 404 && r.request().isNavigationRequest() && new URL(r.url()).pathname.startsWith(SITE);

const test = base.extend<{ watch: Watch }>({
  watch: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL ?? 'http://127.0.0.1:4393').origin;
      const watch: Watch = { blocked: [], errors: [], art: [] };
      const onSite = (path: string) => path.startsWith(SITE) || path === SITE.slice(0, -1);
      await page.context().route(
        (url) => url.origin !== origin || !onSite(url.pathname) || /\/(api|events)(\/|$)/.test(url.pathname),
        (route) => {
          watch.blocked.push(`${route.request().method()} ${route.request().url()}`);
          return route.abort('blockedbyclient');
        },
      );
      // Violations of the site's policy, from before its first script (page code as a string: the tests have no DOM types).
      await page.addInitScript(`window.__violations = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI));`);
      page.on('pageerror', (e) => watch.errors.push(e.message));
      // Chrome's line for a failed load names no address: the responses below report each with its own.
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) watch.errors.push(m.text());
      });
      page.on('response', (r) => {
        if (new URL(r.url()).pathname.includes('/art/')) watch.art.push(`${r.status()} ${new URL(r.url()).pathname}`);
        if (r.status() >= 400 && !isFallback(r)) watch.errors.push(`${r.status()} ${r.url()}`);
      });
      page.on('requestfailed', (r) => {
        if (r.failure()?.errorText !== 'net::ERR_BLOCKED_BY_CLIENT') watch.errors.push(`${r.failure()?.errorText ?? 'failed'} ${r.url()}`);
      });
      await use(watch);
      expect(watch.blocked, 'requests to an API, a stream or off the site').toEqual([]);
      expect(watch.errors, 'errors on the page').toEqual([]);
      expect(await page.evaluate('window.__violations'), 'violations of the content security policy').toEqual([]);
    },
    { auto: true },
  ],
});

const phone = (info: TestInfo) => info.project.name === 'site-375';
const shot = (page: Page, name: string, info: TestInfo) => page.screenshot({ path: join(EVIDENCE, `site-${name}-${info.project.name.replace('site-', '')}.png`) });

const at = (path: string) => new RegExp(`^[^#?]*${(SITE + path).replaceAll('/', '\\/')}$`);
/** The company bar's More, which holds Inbox since v0.8. */
const moreKey = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'More', exact: true });
/** How many need you, from the page's title ("(5) Café Lumen in Worklings"), 0 when it says none. */
// Read straight from the page: the test freezes the page's clock, and a locator's own retries wait on timers it owns.
const inboxCount = async (page: Page) => Number(((await page.evaluate('document.title')) as string).match(/^\((\d+)\)/)?.[1] ?? 0);
/** The inbox card over the talk bar (v0.8). */
const card = (page: Page) => page.locator('[data-inbox-card]');
/** The side panel: a docked panel on desktops, a sheet on phones, which open peeking over the office. */
const sidePanel = (page: Page) => page.getByRole('complementary', { name: 'Side panel' });
/** A phone's sheet peeks (its head and first line) until a press on the peek brings it up; a docked panel is up already. */
async function sheetUp(page: Page) {
  // v0.8: the side panel opens when asked for (the inbox from More, or the card's See all); a proposal still peeks on phones.
  const more = page.getByRole('banner').getByRole('button', { name: 'More', exact: true });
  await expect(more).toBeVisible({ timeout: 30_000 });
  const peek = sidePanel(page).getByRole('button', { name: /^Open the / });
  const title = sidePanel(page).getByRole('heading', { level: 2 }).first();
  if (await peek.isVisible()) await peek.click();
  else if (!(await title.isVisible())) {
    await more.click();
    await page.getByRole('banner').getByRole('button', { name: /^Inbox\b/ }).click();
  }
  await expect(title).toBeVisible();
  await expect(peek).toHaveCount(0);
}

test.describe('the static web demo', () => {
  test('the lobby lists the demo companies, under a line that says it is a demo and links to the install', async ({ page, watch }, info) => {
    const response = await page.goto(SITE);
    expect(response?.status()).toBe(200);
    const companies = page.getByRole('complementary', { name: 'Companies' });
    await expect(companies.getByRole('heading', { name: 'Companies' })).toBeVisible();
    for (const name of ['Café Lumen', 'Plant Pal', 'Ledger']) await expect(companies.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();

    const line = page.getByRole('complementary', { name: 'About this demo' });
    await expect(line).toContainText('A demo with made-up data.');
    await expect(line.getByRole('link', { name: 'Install it' })).toHaveAttribute('href', INSTALL);
    // Links name the site's own addresses, so one opened in a new tab lands on the view.
    await expect(companies.getByRole('link', { name: /^Open the inbox of Café Lumen/ })).toHaveAttribute('href', `${SITE}c/demo/inbox`);
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'nothing scrolls sideways').toBe(true);

    if (phone(info)) {
      // Phones have no 3D lobby: the list fills the screen.
      await expect(page.locator('canvas')).toHaveCount(0);
    } else {
      // The worlds on the mat, drawn from the art under the site's own address.
      await expect(page.getByRole('main', { name: 'Your companies on the mat' }).locator('canvas')).toBeVisible();
      await expect.poll(() => watch.art.some((a) => a.startsWith(`200 ${SITE}art/scenery/`)), { timeout: 30_000 }).toBe(true);
    }
    await shot(page, 'lobby', info);

    // The lobby's skip link waits above the app, under the line, and shows inside the app when it has focus; the
    // line's link and button come before it.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to the panel' });
    await expect(skip).toBeFocused();
    const [lineBox, skipBox] = await Promise.all([line.boundingBox(), skip.boundingBox()]);
    expect(skipBox?.y ?? 0).toBeGreaterThanOrEqual((lineBox?.y ?? 0) + (lineBox?.height ?? 0));
    await page.keyboard.press('Shift+Tab');
    await expect(line.getByRole('button', { name: 'Hide this line' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(line.getByRole('link', { name: 'Install it' })).toBeFocused();
  });

  test('the policy travels in the page and holds: no inline script, while WebAssembly may compile for the art', async ({ page }) => {
    await page.goto(SITE);
    const policy = await page.evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`);
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy, 'only a header can carry frame-ancestors').not.toContain('frame-ancestors');
    // The meshopt decoder compiles WebAssembly: an empty module compiles under the policy.
    expect(await page.evaluate(`WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => 'compiled')`)).toBe('compiled');
    // A script written into the page doesn't run, and the page reports it as a violation: a page of its own takes that.
    const probe = await page.context().newPage();
    await probe.goto(SITE);
    const ran = await probe.evaluate(`(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__inline = true';
      document.head.append(script);
      return window.__inline === true;
    })()`);
    expect(ran, 'an inline script ran').toBe(false);
    await probe.close();
  });

  test('the office draws its people from the compressed art, and a reload keeps the view', async ({ page, watch }, info) => {
    await page.goto(SITE);
    await page.getByRole('complementary', { name: 'Companies' }).getByRole('button', { name: /^Café Lumen/ }).click();
    // v0.8: a company opens on its office, with the next thing that needs you on the card.
    await expect(page).toHaveURL(at('c/demo'));
    const office = page.getByRole('main', { name: 'Café Lumen office' });
    await expect(office.locator('canvas')).toBeVisible();

    // Pages has no file at this address and answers with 404.html, the app itself: a reload opens the same view, and
    // the office loads its art again, on its own this time (the lobby's worlds share some of it).
    watch.art.length = 0;
    const again = await page.reload();
    expect(again?.status()).toBe(404);
    await expect(page).toHaveURL(at('c/demo'));
    await expect(office.locator('canvas')).toBeVisible();
    await expect(moreKey(page)).toBeVisible({ timeout: 30_000 });
    await expect(card(page)).toBeVisible({ timeout: 30_000 });
    // The people, their clips and the scenery are meshopt-compressed: each arrives whole and decodes under the policy
    // (a refused WebAssembly compile would be a violation and an error, and the view would say it couldn't draw).
    await expect.poll(() => watch.art.filter((a) => a.startsWith(`200 ${SITE}art/people/`)).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => watch.art.includes(`200 ${SITE}art/clips.glb`), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => watch.art.some((a) => a.startsWith(`200 ${SITE}art/scenery/`)), { timeout: 30_000 }).toBe(true);
    await expect(page.getByText("The 3D view couldn't draw")).toHaveCount(0);
    await shot(page, 'office', info);
  });

  test('every view opens from its own address, and one the demo lacks goes back to the lobby', async ({ page }) => {
    // Old addresses still open: the task board is a board over the office, the proposal a view of the side panel.
    expect((await page.goto(`${SITE}c/demo/tasks`))?.status()).toBe(404);
    await expect(page.getByRole('region', { name: 'Tasks', exact: true }).getByRole('heading', { level: 2, name: 'Tasks', exact: true })).toBeVisible();
    await page.goto(`${SITE}c/demo/org`);
    await expect(page.getByRole('region', { name: 'Org chart', exact: true })).toBeVisible();
    await page.goto(`${SITE}c/demo/dashboards`);
    await expect(page.getByRole('region', { name: 'Dashboards', exact: true })).toBeVisible();
    // A company still at its proposal opens on it: the proposal is the side panel's home, so its address is the company's.
    await page.goto(`${SITE}c/plant-pal/proposal`);
    await sheetUp(page);
    await expect(sidePanel(page).getByRole('heading', { name: "The CEO's proposal" })).toBeVisible();
    // Going to the lobby and Back again stay under the site's address.
    await page.getByRole('banner').getByRole('link', { name: /^Lobby/ }).click();
    await expect(page).toHaveURL(at(''));
    await page.goBack();
    await expect(page).toHaveURL(at('c/plant-pal'));

    await page.goto(`${SITE}c/nowhere`);
    await expect(page).toHaveURL(at(''));
    await expect(page.getByRole('complementary', { name: 'Companies' })).toContainText("That company isn't in the lobby any more.");
    // The site's address without its last slash, as people type it.
    await page.goto(SITE.slice(0, -1));
    await expect(page).toHaveURL(at(''));
  });

  test('the inbox takes an answer, Undo puts it back, and the answer applies once its window closes', async ({ page }, info) => {
    // The page's clock is the test's, so Undo's five seconds pass when the test says, however busy the machine is.
    const start = Date.now();
    await page.clock.install({ time: start });
    await page.goto(`${SITE}c/demo`);
    await sheetUp(page);
    const needs = page.getByRole('region', { name: 'Needs you' });
    await expect(needs.getByRole('button', { name: 'Allow once' }).first()).toBeVisible();
    const before = await inboxCount(page);
    const allows = await needs.getByRole('button', { name: 'Allow once' }).count();
    expect(before).toBeGreaterThan(0);
    // Held two minutes past its start, which is ahead of it however long the page took to load (the test has 90 s), and
    // well before any of the demo's asks expire.
    await page.clock.pauseAt(start + 120_000);

    // An answer leaves a line with Undo for five seconds, as the hub's does; Undo puts the item back.
    await needs.getByRole('button', { name: 'Allow once' }).first().click();
    const undo = needs.getByRole('button', { name: 'Undo' });
    await undo.click();
    await expect(needs.getByRole('button', { name: 'Allow once' })).toHaveCount(allows);
    await expect.poll(() => inboxCount(page)).toBe(before);

    await needs.getByRole('button', { name: 'Allow once' }).first().click();
    await expect(needs.getByText(/^Allowing \S+ once\.$/)).toBeVisible();
    await expect(undo).toBeVisible();
    await shot(page, 'inbox', info);
    // Once the window closes, the answer applies: the line says so, and the item has left the count. (Jumping fires each
    // due timer once; running the six seconds would draw every frame of the office on the way.)
    await page.clock.fastForward(6_000);
    await expect(undo).toHaveCount(0);
    await expect(needs.getByText(/^Allowed once at .+ carries on\.$/)).toBeVisible();
    await expect.poll(() => inboxCount(page)).toBe(before - 1);
    await expect(needs.getByRole('button', { name: 'Allow once' })).toHaveCount(allows - 1);
  });

  test('steering: a task you add goes on the board for its owner and opens from there', async ({ page }, info) => {
    await page.goto(`${SITE}c/demo/tasks`);
    const board = page.getByRole('region', { name: 'Tasks', exact: true });
    await expect(board.getByRole('heading', { level: 2, name: 'Tasks', exact: true })).toBeVisible();
    await board.getByRole('link', { name: 'Add a task' }).click();
    const form = page.getByRole('form', { name: 'Add a task' });
    await form.getByLabel(/^Title/).fill('Opening hours in the footer');
    await form.getByLabel(/^Who does it/).selectOption('local-seo-specialist');
    await form.getByLabel(/^Brief/).fill("Show the café's opening hours in the footer of every page, in German and English.");
    await form.getByLabel(/^Done when/).fill('Every page shows the hours in both languages.');
    await form.getByRole('button', { name: 'Add the task' }).click();
    await expect(form).toHaveCount(0);
    const panel = sidePanel(page);
    await expect(panel.getByText(/^Added .Opening hours in the footer. for Tom\./)).toBeVisible();
    // It is on the board, under its owner's work, behind the panel.
    await expect(board.getByText('Opening hours in the footer').first()).toBeAttached();
    const open = panel.getByRole('link', { name: 'Open it' });
    await expect(open).toHaveAttribute('href', new RegExp(`^${SITE}c/demo/tasks/[^/]+$`));
    await shot(page, 'steering', info);
    await open.click();
    await expect(panel.getByRole('heading', { name: 'Opening hours in the footer' })).toBeVisible();
    await expect(panel.getByText(/^Tom, local SEO specialist, owns it\. You asked at /)).toBeVisible();

    // From its page, Pause holds it until Resume.
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(panel.getByText(/^Paused by you at /)).toBeVisible();
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(panel.getByText(/^Paused by you at /)).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });

  test('the layout fits the screen: the office with the card over the talk bar, the whole inbox a press away', async ({ page }, info) => {
    await page.goto(SITE);
    const line = page.getByRole('complementary', { name: 'About this demo' });
    // One line, on a phone too.
    expect((await line.boundingBox())?.height ?? 0).toBeLessThanOrEqual(40);
    await page.getByRole('complementary', { name: 'Companies' }).getByRole('button', { name: /^Café Lumen/ }).click();
    const office = page.getByRole('main', { name: 'Café Lumen office' });
    await expect(office.locator('canvas')).toBeVisible();
    await expect(page).toHaveURL(at('c/demo'));
    // v0.8: the office first, the next thing that needs you on one card, the side panel closed until asked for.
    await expect(card(page)).toBeVisible();
    const panel = sidePanel(page);
    await expect(panel.getByRole('heading', { level: 2 })).toHaveCount(0);
    await shot(page, phone(info) ? 'phone-office' : 'office-card', info);
    await card(page).getByRole('button', { name: 'See all', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'Needs you' })).toBeVisible();
    const [panelBox, lineBox] = await Promise.all([panel.boundingBox(), line.boundingBox()]);
    expect(panelBox?.y ?? 0, 'the panel starts under the demo line').toBeGreaterThanOrEqual((lineBox?.y ?? 0) + (lineBox?.height ?? 0));
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'nothing scrolls sideways').toBe(true);
    if (!phone(info)) {
      // Desktops: the panel docked beside the office with the inbox in it.
      expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(1440);
      expect(panelBox?.width ?? 0).toBeLessThan(500);
      return;
    }
    // Phones: the inbox's sheet, most of the screen.
    expect(panelBox?.height ?? 0).toBeGreaterThan(812 * 0.5);
    await shot(page, 'phone-inbox', info);
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(card(page)).toBeVisible();

    // The line gives its height back to the office once hidden, for the rest of the visit.
    const before = (await office.boundingBox())?.height ?? 0;
    await line.getByRole('button', { name: 'Hide this line' }).click();
    await expect(line).toHaveCount(0);
    expect((await office.boundingBox())?.height ?? 0).toBeGreaterThan(before);
    await page.reload();
    await expect(office.locator('canvas')).toBeVisible();
    await expect(line).toHaveCount(0);
  });
});

// v0.8 (SPEC-v0.8.md, decision 2): what needs you, one card at a time over the talk bar.
test.describe('the inbox card', () => {
  test('the oldest first; an answer brings the next in with focus, Next and Skip move through, See all opens the list', async ({ page }, info) => {
    // The page's clock is the test's, so Undo's five seconds pass only when the test says, however busy the machine is.
    const start = Date.now();
    await page.clock.install({ time: start });
    await page.goto(`${SITE}c/demo`);
    const c = card(page);
    await expect(c).toBeVisible({ timeout: 30_000 });
    const count = c.getByText(/^\d+ of \d+$/);
    const total = await inboxCount(page);
    await expect(count).toHaveText(`1 of ${total}`);
    // The oldest is the plan waiting for approval, with its one key.
    await expect(c.getByRole('link', { name: 'Open the plan' })).toBeVisible();
    // Next shows the one after; Skip sends the shown one to the end, so the same place shows the next.
    await c.getByRole('button', { name: /^Next/ }).click();
    await expect(count).toHaveText(`2 of ${total}`);
    const second = (await c.locator('[data-item-line]').first().textContent()) ?? '';
    await c.getByRole('button', { name: /^Skip/ }).click();
    await expect(count).toHaveText(`2 of ${total}`);
    await expect(c.locator('[data-item-line]').first()).not.toHaveText(second);
    // An answer: the press's line with Undo stays above, the next item comes in with focus on its first line, and the
    // count drops and is said politely.
    // Held two minutes past the start, well before any of the demo's asks expire, so the answer's Undo waits for the test.
    await page.clock.pauseAt(start + 120_000);
    const answered = (await c.locator('[data-item-line]').first().textContent()) ?? '';
    await c.locator('.inbox-card__body').getByRole('button').filter({ hasNotText: /own words|Show the command|Read all/ }).first().click();
    await expect(c.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(count).toHaveText(new RegExp(`^\\d+ of ${total - 1}$`));
    await expect(c.locator('.inbox-card__body [data-item-line]')).toBeFocused();
    await expect(c.locator('.inbox-card__body [data-item-line]')).not.toHaveText(answered);
    await expect(page.getByTestId('announcer')).toContainText(/need you\.$/);
    await shot(page, 'card', info);
    // Undo puts it back on the card.
    await c.getByRole('button', { name: 'Undo' }).click();
    await expect(count).toHaveText(new RegExp(`^\\d+ of ${total}$`));
    // See all opens the whole list (its code loads on the page's clock, running again), and the card steps aside meanwhile.
    await page.clock.resume();
    await c.getByRole('button', { name: 'See all', exact: true }).click();
    await expect(sidePanel(page).getByRole('region', { name: 'Needs you' })).toBeVisible();
    await expect(c).toHaveCount(0);
  });

  test('the keyboard reaches the card after the bar and before the talk bar', async ({ page }) => {
    await page.goto(`${SITE}c/demo`);
    const c = card(page);
    await expect(c).toBeVisible({ timeout: 30_000 });
    await moreKey(page).focus();
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const where = (await page.evaluate(`(() => { const el = document.activeElement; if (!el) return 'none'; if (el.closest('[data-inbox-card]')) return 'card'; if (el.closest('.talkbar')) return 'talk'; return 'other'; })()`)) as string;
      order.push(where);
      if (where === 'talk') break;
    }
    expect(order.indexOf('card'), `Tab order after More: ${order.join(', ')}`).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('card')).toBeLessThan(order.indexOf('talk'));
  });

  test('on a phone it is a sheet over the talk bar, folded to its head while the talk bar has focus', async ({ page }, info) => {
    await page.goto(`${SITE}c/demo`);
    const c = card(page);
    await expect(c).toBeVisible({ timeout: 30_000 });
    // After a page has loaded, so the demo's own checks (its policy, its errors) have a page to read.
    test.skip(!phone(info), 'The phone layout.');
    const box = page.getByRole('textbox', { name: /^Message to / });
    const [sheet, talk] = await Promise.all([c.boundingBox(), page.locator('.talkbar').boundingBox()]);
    expect((sheet?.y ?? 0) + (sheet?.height ?? 0), 'the sheet ends above the talk bar').toBeLessThanOrEqual((talk?.y ?? 0) + 1);
    expect(sheet?.width ?? 0).toBeGreaterThan(375 - 24);
    await shot(page, 'phone-sheet', info);
    await box.focus();
    await expect(c.locator('.inbox-card__body')).toBeHidden();
    await expect(c.getByText(/^\d+ of \d+$/)).toBeVisible();
    const folded = await c.boundingBox();
    const bar = await page.locator('.talkbar').boundingBox();
    expect((folded?.y ?? 0) + (folded?.height ?? 0), 'the folded sheet stays above the talk bar').toBeLessThanOrEqual((bar?.y ?? 0) + 1);
    await shot(page, 'phone-sheet-typing', info);
    await box.blur();
    await expect(c.locator('.inbox-card__body')).toBeVisible();
    // Answering in its own words: the talk bar steps aside while the card's box has focus.
    await c.getByRole('button', { name: /^Next/ }).click();
    await c.getByRole('button', { name: 'Answer in your own words' }).click();
    const own = c.getByRole('textbox', { name: 'Your answer' });
    await expect(own).toBeFocused();
    await expect(page.locator('.dock__bar')).toBeHidden();
    const [ownBox, sheetNow] = await Promise.all([own.boundingBox(), c.boundingBox()]);
    expect((ownBox?.y ?? 0) + (ownBox?.height ?? 0), 'the box shows inside the sheet').toBeLessThanOrEqual((sheetNow?.y ?? 0) + (sheetNow?.height ?? 0));
  });
});

// v0.8 (SPEC-v0.8.md, decision 3): a project started from scratch, as a replay of one real run.
test.describe('try it: start a project', () => {
  test('the form comes filled with the recorded words and says what Start does; other words say they replay the recording', async ({ page }) => {
    await page.goto(SITE);
    await page.getByRole('link', { name: 'Try it: start a project' }).click();
    await expect(page).toHaveURL(new RegExp(`${SITE.replaceAll('/', '\\/')}new\\?try$`));
    await expect(page.getByRole('heading', { name: 'Try it: start a project' })).toBeVisible();
    const words = page.getByRole('textbox', { name: 'What should the company build?' });
    await expect(words).toHaveValue(/^Build haiku-check, a tiny zero-dependency Node CLI/);
    await expect(page.getByRole('textbox', { name: 'Folder' })).toHaveValue('C:\\Users\\you\\Projects\\haiku-check');
    await expect(words).toHaveAccessibleDescription(/Nothing runs in your browser: Start replays a real Claude Code run of these words/);
    await words.fill('A to-do app with reminders');
    await expect(words).toHaveAccessibleDescription(/replays the recorded run of “Build haiku-check.*not your words/);
  });

  test('Start plays the run sped up: the todo list, a helper with its cost, each prompt waiting for a tap, then the last words', async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.goto(`${SITE}new?try`);
    await page.getByRole('button', { name: 'Start the company' }).click();
    await expect(page).toHaveURL(at('c/haiku-check'));
    const banner = page.getByRole('complementary', { name: 'Recorded run' });
    await expect(banner.getByText(/^Recorded run, sped up ×8$/)).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(/A real Claude Code session from an empty folder: .* on Sonnet when it ran\./);
    // The line over the demo says the run is a recording, not made up, and still offers the install.
    const line = page.getByRole('complementary', { name: 'About this demo' });
    await expect(line).toContainText('A recorded Claude Code run, replayed in your browser.');
    await expect(line).not.toContainText('made-up data');
    await expect(line.getByRole('link', { name: 'Install it' })).toHaveAttribute('href', INSTALL);
    await shot(page, 'replay-start', info);
    // Each permission prompt stops the clock until it is answered on the card.
    const c = card(page);
    let taps = 0;
    for (; taps < 10; taps++) {
      const allow = c.getByRole('button', { name: 'Allow once' });
      const next = await Promise.race([allow.waitFor({ timeout: 60_000 }).then(() => 'prompt'), banner.getByRole('button', { name: 'Watch again' }).waitFor({ timeout: 60_000 }).then(() => 'done')]).catch(() => 'stuck');
      if (next !== 'prompt') break;
      await expect(banner).toContainText('Claude Code waits for your answer on the card below.');
      if (taps === 0) await shot(page, 'replay-permission', info);
      // It waits: the banner still asks a moment later.
      await page.waitForTimeout(1_500);
      await expect(banner).toContainText('Claude Code waits for your answer on the card below.');
      await allow.click();
    }
    expect(taps, 'the run asked at least once').toBeGreaterThan(0);
    await expect(banner.getByRole('button', { name: 'Watch again' })).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText(/That was the whole run/);
    // The job's last words wait on the card. They ask nothing, so Claude Code finished its turn (v0.8), and the person may
    // reply in their own words.
    await expect(c).toContainText(/npm test passes/);
    await expect(c).toContainText('Claude Code finished its turn.');
    await expect(c.getByRole('button', { name: 'Reply in your own words' })).toBeVisible();
    await shot(page, 'replay-done', info);
    // The board has its todo list done and its helper with what it cost.
    await moreKey(page).click();
    await page.getByRole('banner').getByRole('link', { name: 'Tasks', exact: true }).click();
    const board = page.getByRole('region', { name: 'Tasks', exact: true });
    await expect(board.getByRole('heading', { name: /^Helpers, \$\d+\.\d\d so far$/ })).toBeVisible({ timeout: 30_000 });
    await expect(board).toContainText('Subagent: write node:test tests');
  });
});

