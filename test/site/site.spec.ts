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
/** The office from the views row, as a person switches to it from where a company opens (progress). */
const openOffice = (page: Page) => page.getByRole('link', { name: 'Office', exact: true }).first().click();

const at = (path: string) => new RegExp(`^[^#?]*${(SITE + path).replaceAll('/', '\\/')}$`);
/** The figure on the company bar's Inbox key ("Inbox 5, five need you"), 0 when it shows none. */
const inboxKey = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Inbox\b/ });
// Read straight from the page: the test freezes the page's clock, and a locator's own retries wait on timers it owns.
const inboxCount = async (page: Page) =>
  Number((await page.evaluate(`[...document.querySelectorAll('header button')].map((b) => b.getAttribute('aria-label') ?? '').find((l) => /^Inbox \\d/.test(l)) ?? ''`) as string).match(/^Inbox (\d+)/)?.[1] ?? 0);
/** The side panel: a docked panel on desktops, a sheet on phones, which open peeking over the office. */
const sidePanel = (page: Page) => page.getByRole('complementary', { name: 'Side panel' });
/** A phone's sheet peeks (its head and first line) until a press on the peek brings it up; a docked panel is up already. */
async function sheetUp(page: Page) {
  const peek = sidePanel(page).getByRole('button', { name: /^Open the / });
  await expect(peek.or(sidePanel(page).getByRole('heading', { level: 2 }).first())).toBeVisible({ timeout: 30_000 });
  if (await peek.isVisible()) await peek.click();
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
    // A company opens on where it stands (progress, since 0.2); Office is one press away in the views.
    await expect(page).toHaveURL(at('c/demo/progress'));
    await openOffice(page);
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
    await expect(inboxKey(page)).toBeVisible({ timeout: 30_000 });
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

  test('the layout fits the screen: on a phone the office opens with the inbox peeking, a press away', async ({ page }, info) => {
    await page.goto(SITE);
    const line = page.getByRole('complementary', { name: 'About this demo' });
    // One line, on a phone too.
    expect((await line.boundingBox())?.height ?? 0).toBeLessThanOrEqual(40);
    await page.getByRole('complementary', { name: 'Companies' }).getByRole('button', { name: /^Café Lumen/ }).click();
    await expect(page).toHaveURL(at('c/demo/progress'));
    await openOffice(page);
    const office = page.getByRole('main', { name: 'Café Lumen office' });
    await expect(office.locator('canvas')).toBeVisible();
    await expect(page).toHaveURL(at('c/demo'));
    const panel = sidePanel(page);
    await expect(panel).toBeVisible();
    const [panelBox, lineBox] = await Promise.all([panel.boundingBox(), line.boundingBox()]);
    expect(panelBox?.y ?? 0, 'the panel starts under the demo line').toBeGreaterThanOrEqual((lineBox?.y ?? 0) + (lineBox?.height ?? 0));
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'nothing scrolls sideways').toBe(true);
    if (!phone(info)) {
      // Desktops: the office fills the window, the panel docked beside it with the inbox in it.
      await expect(panel.getByRole('region', { name: 'Needs you' })).toBeVisible();
      expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(1440);
      expect(panelBox?.width ?? 0).toBeLessThan(500);
      return;
    }
    // Phones: the office first, the inbox's sheet only peeking at the foot until it is pressed.
    const peek = panel.getByRole('button', { name: /^Open the / });
    await expect(peek).toBeVisible();
    expect(panelBox?.height ?? 0, 'the sheet only peeks').toBeLessThan(812 * 0.35);
    await shot(page, 'phone-office', info);
    // The whole peek is a key: pressed from the keyboard here.
    await peek.focus();
    await page.keyboard.press('Enter');
    await expect(peek).toHaveCount(0);
    await expect(panel.getByRole('region', { name: 'Needs you' })).toBeVisible();
    expect((await panel.boundingBox())?.height ?? 0).toBeGreaterThan(812 * 0.5);
    await shot(page, 'phone-inbox', info);

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
