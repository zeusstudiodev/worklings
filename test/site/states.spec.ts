// H64 (AC40) for the static web demo (npm run build:site, dist/site): every new view in each demo company's states at
// 1440 and 375 px, as v3-every-state.spec.ts does for the hub: empty (a CEO alone, no tasks, no goal), drafting, the
// proposal after its scoping questions, a company that cannot run, forty people and a hundred tasks, the feed, keyboard
// focus and reduced motion. The same rules as site.spec.ts hold: a request to an API, a stream or anything off the site
// is blocked and fails the test, as does any console error, failed response or policy violation. Screenshots go to
// SITE_EVIDENCE when it is set.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { focusedThing, focusTop, hiddenFocus } from '../e2e/v3-kit.ts';

const SITE = '/worklings/';
const EVIDENCE = process.env.SITE_EVIDENCE ?? join(import.meta.dirname, '..', '..', 'test-results', 'site', 'evidence');
mkdirSync(EVIDENCE, { recursive: true });

const test = base.extend<{ watch: string[] }>({
  watch: [
    async ({ page, baseURL }, use) => {
      const problems: string[] = [];
      const origin = new URL(baseURL ?? 'http://127.0.0.1:4393').origin;
      await page.context().route(
        (url) => url.origin !== origin || !url.pathname.startsWith(SITE) || /\/(api|events)(\/|$)/.test(url.pathname),
        (route) => {
          problems.push(`blocked ${route.request().method()} ${route.request().url()}`);
          return route.abort('blockedbyclient');
        },
      );
      await page.addInitScript(`window.__violations = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI));`);
      page.on('pageerror', (e) => problems.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(m.text());
      });
      page.on('response', (r) => {
        // 404.html is the app itself at an address with no file of its own.
        const fallback = r.status() === 404 && r.request().isNavigationRequest() && new URL(r.url()).pathname.startsWith(SITE);
        if (r.status() >= 400 && !fallback) problems.push(`${r.status()} ${r.url()}`);
      });
      await use(problems);
      expect(problems, 'blocked requests and errors on the page').toEqual([]);
      expect(await page.evaluate('window.__violations'), 'violations of the content security policy').toEqual([]);
    },
    { auto: true },
  ],
});

const phone = (info: TestInfo) => info.project.name === 'site-375';
const shot = (page: Page, name: string, info: TestInfo) => page.screenshot({ path: join(EVIDENCE, `site-h64-${name}-${info.project.name.replace('site-', '')}.png`) });
const sidePanel = (page: Page) => page.getByRole('complementary', { name: 'Side panel' });
const feed = (page: Page): Locator => page.getByRole('region', { name: 'Feed', exact: true });

async function sheetUp(page: Page): Promise<void> {
  const peek = sidePanel(page).getByRole('button', { name: /^Open the / });
  await expect(peek.or(sidePanel(page).getByRole('heading', { level: 2 }).first())).toBeVisible({ timeout: 30_000 });
  if (await peek.isVisible()) await peek.click();
  await expect(peek).toHaveCount(0);
}

/** A company's view at its own address (the site's base path in front), waiting for its frame to draw. */
async function go(page: Page, company: string, board = ''): Promise<void> {
  await page.goto(`${SITE}c/${company}${board ? `/${board}` : ''}`);
  await expect(page.getByRole('banner').getByRole('button', { name: /^Inbox\b/ })).toBeVisible({ timeout: 30_000 });
  if (board) {
    const title = board.startsWith('org') ? 'Org chart' : board.startsWith('tasks') ? 'Tasks' : 'Dashboards';
    const frame = page.getByRole('region', { name: title, exact: true });
    await expect(frame.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(frame).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
  }
}

const noSidewaysScroll = async (page: Page, where: string) => {
  const over = (await page.evaluate('document.documentElement.scrollWidth - innerWidth')) as number;
  expect(over, `${where} scrolls sideways by ${over} px`).toBeLessThanOrEqual(0);
};

/** Opens the feed: the Feed key beside the talk bar, or the strip on a phone. */
async function openFeed(page: Page, info: TestInfo): Promise<Locator> {
  const opener = phone(info) ? page.getByRole('button', { name: /^Open the feed\b/ }) : page.getByRole('form', { name: 'Talk bar' }).getByRole('button', { name: /^Feed\b/ });
  await opener.click();
  await expect(feed(page)).toBeVisible();
  return feed(page);
}

async function walk(page: Page, steps: number, where: string): Promise<string[]> {
  await focusTop(page);
  const problems: string[] = [];
  let stops = 0;
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    if ((await focusedThing(page)) === 'nothing') continue;
    stops++;
    const hidden = await hiddenFocus(page);
    if (hidden) problems.push(`${where}: ${hidden}`);
  }
  expect(stops, `${where}: the keyboard reaches something`).toBeGreaterThan(3);
  return problems;
}

test.describe('the static demo, every state', () => {
  test('lake-wind, a CEO alone and drafting: empty views say what they wait for, and its feed has what it wrote about itself', async ({ page }, info) => {
    await go(page, 'lake-wind');
    // A phone has no way into the feed before the start: the CEO's suggestions stand where the strip does.
    if (!phone(info)) {
      const list = await openFeed(page, info);
      await expect(list.getByRole('article').first()).toBeVisible();
      await shot(page, 'lakewind-feed', info);
      await page.keyboard.press('Escape');
    }
    await go(page, 'lake-wind', 'org');
    await expect(page.getByRole('region', { name: 'Org chart', exact: true }).getByText('The CEO is drafting your company. About a minute.')).toBeVisible();
    await noSidewaysScroll(page, 'the org chart of one');
    await shot(page, 'lakewind-org', info);
    await go(page, 'lake-wind', 'tasks');
    await expect(page.getByText('No tasks yet. The heads split the goal into tasks once the company starts.')).toBeVisible();
    await shot(page, 'lakewind-tasks', info);
    await go(page, 'lake-wind', 'dashboards');
    await expect(page.getByText('No goal yet. The CEO sets one when the company starts.')).toBeVisible();
    await shot(page, 'lakewind-dashboards', info);
  });

  test('plant-pal after its scoping questions, and old-site, which cannot run', async ({ page }, info) => {
    await go(page, 'plant-pal');
    await sheetUp(page);
    await expect(sidePanel(page).getByRole('heading', { name: "The CEO's proposal" })).toBeVisible();
    await expect(page.getByRole('region', { name: "The CEO's questions" })).toBeVisible();
    await noSidewaysScroll(page, 'the proposal');
    await shot(page, 'plantpal-proposal', info);
    await go(page, 'old-site');
    await sheetUp(page);
    await expect(sidePanel(page)).toContainText("Its folder isn't at");
    await shot(page, 'oldsite', info);
  });

  test('Ledger, forty people and a hundred tasks, and the feed of a busy company', async ({ page }, info) => {
    await go(page, 'ledger', 'org');
    await expect(page.getByRole('tree', { name: 'Org chart' }).getByRole('treeitem').first()).toBeVisible({ timeout: 15_000 });
    await noSidewaysScroll(page, 'the 40-person chart');
    await shot(page, 'ledger-org', info);
    await go(page, 'ledger', 'tasks');
    await expect(page.getByRole('region', { name: 'Tasks', exact: true }).getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    await noSidewaysScroll(page, 'the 100-task board');
    await shot(page, 'ledger-tasks', info);
    await go(page, 'ledger');
    await openFeed(page, info);
    await noSidewaysScroll(page, "Ledger's feed");
    await shot(page, 'ledger-feed', info);
  });

  test('keyboard focus: Tab through the open feed never hides focus under it', async ({ page }, info) => {
    test.setTimeout(180_000);
    await go(page, 'demo');
    await openFeed(page, info);
    const problems = await walk(page, 24, 'the open feed');
    await shot(page, 'tab-feed', info);
    expect(problems).toEqual([]);
  });

  test('keyboard focus: Tab through each board never hides focus', async ({ page }, info) => {
    test.setTimeout(180_000);
    const problems: string[] = [];
    for (const board of ['org', 'tasks', 'dashboards']) {
      await go(page, 'demo', board);
      problems.push(...(await walk(page, 30, board)));
    }
    await shot(page, 'tab-boards', info);
    expect(problems).toEqual([]);
  });

  test('reduced motion: nothing of the new views keeps moving', async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const moving: string[] = [];
    const look = async (where: string) => {
      await page.evaluate('new Promise((done) => setTimeout(done, 700))');
      const now = (await page.evaluate(`(() => document.getAnimations()
        .filter((a) => a.playState === 'running' && a.effect && a.effect.target && !(a.effect.target.closest && a.effect.target.closest('canvas')))
        .map((a) => (a.animationName || a.transitionProperty || 'animation') + ' on ' + (a.effect.target.tagName || '').toLowerCase() + '.' + String(a.effect.target.className || '').slice(0, 40)))()`)) as string[];
      moving.push(...now.map((m) => `${where}: ${m}`));
    };
    await go(page, 'demo');
    await look('the office');
    await openFeed(page, info);
    await look('the feed');
    await shot(page, 'reduced-feed', info);
    for (const board of ['org', 'tasks', 'dashboards']) {
      await go(page, 'demo', board);
      await look(board);
    }
    expect(moving, 'running animations with reduced motion').toEqual([]);
  });
});
