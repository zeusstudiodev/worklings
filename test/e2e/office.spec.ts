import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { BIG as BIG_OFFICE, DEMO, EMPTY as EMPTY_OFFICE } from './addresses.ts';

// Live offices: their prompts and costs are private, so opening them takes the access link.
const token = process.env.E2E_TOKEN ?? '';
const EMPTY = `${EMPTY_OFFICE}/?token=${token}`;
const BIG = `${BIG_OFFICE}/?token=${token}`;
mkdirSync('test-results/evidence', { recursive: true });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** How the log words tool calls ("Reads notes.txt", "Runs npm test"): the story never does. */
const TOOL_PHRASES = /\b(?:Reads|Writes|Edits|Runs|Searches the code|Looks for files|Follows the|Uses|Briefs|Starts on|Reports back|Done for now)\b/;

/** "$0.42" in the HUD for a dollar amount, the way the web app formats it. */
const dollars = (n: number) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString('en-US')}`);

test.describe('demo office', () => {
  test('renders the model with its room signs, people and HUD', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(DEMO);
    await expect(page.getByRole('status').filter({ hasText: 'Demo' })).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    for (const room of ['Design', 'Engineering', 'Quality', 'Content', 'Ops & Release']) {
      await expect(page.locator('.room-sign__button', { hasText: room })).toBeVisible();
    }
    await expect(page.locator('.ledger')).toContainText('API-equivalent');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `test-results/evidence/demo-${info.project.name}.png` });
    expect(errors).toEqual([]);
  });

  test('shows the same spend in the HUD as the server reports', async ({ page }) => {
    await page.goto(DEMO);
    await expect
      .poll(async () => {
        const state = (await (await page.request.get(`${DEMO}/api/state`)).json()) as { totals: { cost: number } };
        const shown = await page.locator('.ledger__item', { hasText: 'API-equivalent' }).locator('dd').textContent();
        return shown === dollars(state.totals.cost);
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('opens a room and a person with the keyboard alone', async ({ page }) => {
    await page.goto(DEMO);
    await expect(page.locator('.room-sign__button', { hasText: 'Design' })).toBeVisible();
    // The room signs come first in the tab order, before the HUD.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Design');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Design', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await page.getByRole('button', { name: 'UX designer' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'UX designer', level: 2 })).toBeVisible();
    await expect(page.getByText('Changes are off in the demo.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fire' })).toBeDisabled();
    await page.getByRole('button', { name: 'Back', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Team' })).toBeVisible();
  });

  test('payroll flags the role that never worked', async ({ page }, info) => {
    await page.goto(DEMO);
    await page.getByRole('tab', { name: 'Payroll' }).click();
    await expect(page.locator('.ledger-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
    // Idle desks are pointed out once the studio has done some work.
    await expect(page.locator('.advice__item', { hasText: 'Release manager' })).toContainText('worked yet', { timeout: 30_000 });
    await page.screenshot({ path: `test-results/evidence/payroll-${info.project.name}.png` });
  });

  test('the story tells the demo as requests, briefs and reports, never tool calls', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(DEMO);
    await page.getByRole('tab', { name: 'Story' }).click();
    const lines = page.getByRole('tabpanel', { name: 'Story' }).getByRole('listitem');
    // The demo reads and edits files and runs commands all the time: none of that is told, whenever we look.
    const told = async () => (await lines.allInnerTexts()).join('\n');
    const brief = lines.filter({ hasText: /^The lead briefed the UX designer/ });
    await expect(brief).toBeVisible({ timeout: 30_000 });
    expect(await told()).not.toMatch(TOOL_PHRASES);
    await expect(lines.filter({ hasText: /^The UX designer reported back/ })).toBeVisible({ timeout: 30_000 });
    await expect(lines.filter({ hasText: /^You asked/ })).toBeVisible();
    expect(await told()).not.toMatch(TOOL_PHRASES);
    await page.screenshot({ path: `test-results/evidence/story-${info.project.name}.png` });

    // A name opens that person; their badge's Recent work tells their milestones, and only other people are buttons.
    await brief.getByRole('button', { name: 'the UX designer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'UX designer', level: 2 })).toBeVisible();
    const recent = page.getByRole('region', { name: 'Recent work' });
    await expect(recent.getByRole('listitem').filter({ hasText: /^The lead briefed the UX designer/ })).toBeVisible();
    await expect(recent.getByRole('button', { name: 'The lead', exact: true }).first()).toBeVisible();
    await expect(recent.getByRole('button', { name: 'the UX designer', exact: true })).toHaveCount(0);
    expect((await recent.getByRole('listitem').allInnerTexts()).join('\n')).not.toMatch(TOOL_PHRASES);
    expect(errors).toEqual([]);
  });

  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DEMO);
    await expect(page.locator('.mode__dot')).toBeVisible();
    // Evaluated in the page, as a string, because the test files are typed for Node rather than the DOM.
    const animation = await page.evaluate("getComputedStyle(document.querySelector('.mode__dot')).animationName");
    expect(animation).toBe('none');
  });

  test('says when the connection drops and keeps the last view', async ({ page }) => {
    const state = await (await page.request.get(`${DEMO}/api/state`)).text();
    let served = false;
    await page.route('**/events', async (route) => {
      if (served) return route.abort();
      served = true;
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `retry: 500\n\nevent: snapshot\ndata: ${state}\n\n` });
    });
    await page.goto(DEMO);
    await expect(page.getByRole('status').filter({ hasText: 'Reconnecting' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.room-sign__button', { hasText: 'Design' })).toBeVisible();
  });

  test('shows a loading screen until the office answers', async ({ page }) => {
    await page.route('**/events', (route) => route.abort());
    await page.goto(DEMO);
    await expect(page.getByText('Opening the office')).toBeVisible();
  });
});

test.describe('the Now tab', () => {
  test('opens first, with the headline and a row for each person at work', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(DEMO);
    await expect(page.getByRole('tab', { name: 'Now' })).toHaveAttribute('aria-selected', 'true');
    const now = page.getByRole('tabpanel', { name: 'Now' });
    await expect(now.getByRole('button', { name: 'Lead', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(now.getByRole('heading', { name: 'On it' }).or(now.getByRole('heading', { name: 'Done in the last 15 minutes' })).first()).toBeVisible();
    await expect(now.getByText(/at work/).first()).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/evidence/now-${info.project.name}.png` });
    expect(errors).toEqual([]);
  });

  test('moves between tabs with the arrow keys, opens a badge from a row and comes back to it', async ({ page }) => {
    await page.goto(DEMO);
    const nowTab = page.getByRole('tab', { name: 'Now' });
    await nowTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Team' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Story' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(nowTab).toBeFocused();
    const lead = page.getByRole('tabpanel', { name: 'Now' }).getByRole('button', { name: 'Lead', exact: true });
    await expect(lead).toBeVisible({ timeout: 15_000 });
    await lead.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Lead', level: 2 })).toBeFocused();
    await page.getByRole('button', { name: 'Back', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(lead).toBeFocused();
  });

  test('reads over the scene while another tab is open, and a click there opens Now', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Phones keep the model uncovered.');
    await page.goto(DEMO);
    const caption = page.getByTestId('now-caption');
    await expect(caption).toBeHidden();
    await page.getByRole('tab', { name: 'Payroll' }).click();
    await expect(caption).toContainText(/at work/);
    await page.screenshot({ path: 'test-results/evidence/now-caption-desktop.png' });
    await caption.click();
    await expect(page.getByRole('tab', { name: 'Now' })).toHaveAttribute('aria-selected', 'true');
    await expect(caption).toBeHidden();
  });

  test('on a phone, the sheet opens at half the screen with the headline in it', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'The bottom sheet exists only on phones.');
    await page.goto(DEMO);
    await expect(page.getByRole('tabpanel', { name: 'Now' }).getByText(/at work/).first()).toBeInViewport();
    const sheet = await page.getByRole('complementary', { name: 'Studio details' }).boundingBox();
    expect(sheet?.height).toBe(Math.round(812 * 0.5));
    await expect(page.getByTestId('now-caption')).toHaveCount(0);
  });
});

test.describe('phone layout', () => {
  test('puts the panel in a bottom sheet that expands', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'The bottom sheet exists only on phones.');
    await page.goto(DEMO);
    const handle = page.getByRole('button', { name: 'Show more' });
    await expect(handle).toBeVisible();
    const collapsed = await page.locator('.panel').boundingBox();
    await handle.click();
    await expect(page.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    // The sheet animates open; wait for it to settle rather than measuring mid-transition.
    await expect.poll(async () => (await page.locator('.panel').boundingBox())?.height ?? 0).toBeGreaterThan((collapsed?.height ?? 0) + 200);
    await page.screenshot({ path: 'test-results/evidence/phone-sheet-open.png' });
  });
});

test.describe('other studios', () => {
  test('a project without a studio says how to make one and waits for sessions', async ({ page }, info) => {
    await page.goto(EMPTY);
    await expect(page.getByRole('heading', { name: 'No studio here yet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiting for Claude Code' })).toBeVisible();
    await page.screenshot({ path: `test-results/evidence/empty-${info.project.name}.png` });
  });

  test('a 50-person studio without studio.yaml still fits, long names included', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(BIG);
    await expect(page.locator('.room-sign__button').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Team' }).click();
    await expect(page.locator('.team .row')).toHaveCount(50);
    await expect(page.getByText('Senior principal distinguished gameplay systems and tooling programmer')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/evidence/big-studio-${info.project.name}.png` });
    expect(errors).toEqual([]);
  });
});
