import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { LIVE, playSession } from './live.ts';
import { DEMO } from './addresses.ts';

const token = process.env.E2E_TOKEN ?? '';
mkdirSync('test-results/evidence', { recursive: true });

const catchUp = (page: Page) => page.getByRole('button', { name: 'Catch me up' });
/** The office's one live region: it has no role of its own, and holds a node per sentence it says. */
const announcer = (page: Page) => page.getByTestId('announcer');
/** The sentences in the announcer that read exactly `text`: each is said on its own, never joined to another. */
const said = (page: Page, text: string | RegExp) => announcer(page).getByText(text, { exact: true });
const LOCKED = 'Open the office from the link the CLI printed. It carries the access token.';
/** The demo loops, and right after a catch-up there can be nothing new for a while: wait until it can be pressed. */
const ready = (page: Page) => expect(catchUp(page)).not.toHaveAttribute('aria-disabled', 'true', { timeout: 45_000 });

test.describe('Catch me up in the demo', () => {
  test('writes a sample, says so, and counts it free on the payroll', async ({ page }, info) => {
    await page.goto(`${DEMO}/?token=${token}`);
    await ready(page);
    await expect(catchUp(page)).toHaveAccessibleDescription("The demo makes up its catch-ups, so they're free.");
    await catchUp(page).focus();
    await page.keyboard.press('Enter');
    // Said only for a sample that arrives while the page is open (the demo keeps the ones other tests asked for).
    await expect(said(page, 'Your catch-up is ready.')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sample catch-up', level: 3 }).first()).toBeVisible();
    await expect(page.getByText('Made up for the demo. No call to Claude Code.').first()).toBeVisible();
    // The arrival doesn't move focus.
    await expect(catchUp(page)).toBeFocused();
    await page.screenshot({ path: `test-results/evidence/catch-up-demo-${info.project.name}.png` });
    await page.getByRole('tab', { name: 'Payroll' }).click();
    const office = page.getByRole('row', { name: /The office/ });
    await expect(office).toContainText(/\d+ samples?, free/);
    await expect(office.getByRole('button')).toHaveCount(0);
  });

  test('shows the locked copy without its link, and the copy for a press the office turns down', async ({ page }) => {
    await page.goto(DEMO);
    await expect(catchUp(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(catchUp(page)).toHaveAccessibleDescription(LOCKED);
    await page.goto(`${DEMO}/?token=${token}`);
    await ready(page);
    await page.route('**/api/catch-up', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'busy', code: 'busy' }) }));
    await catchUp(page).click();
    await expect(catchUp(page)).toHaveAccessibleDescription(
      "Couldn't write your catch-up. The office is already on a question or a catch-up and does one at a time. Wait for it or cancel it.",
    );
    await expect(catchUp(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test("says why each time it is pressed while it can't be used", async ({ page }) => {
    await page.goto(DEMO);
    await expect(catchUp(page)).toHaveAttribute('aria-disabled', 'true');
    // By key or by pointer: each press is a sentence of its own, so a screen reader says it again.
    await catchUp(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await catchUp(page).click({ force: true });
    await expect(said(page, LOCKED)).toHaveCount(3);
    await expect(catchUp(page)).toBeFocused();
  });
});

test.describe('Catch me up in a live office', () => {
  test('writes a catch-up through Claude Code, then has nothing new, and the office pays for it', async ({ page }, info) => {
    await playSession({ prompt: `Catch me up on the importer (${info.project.name})` });
    await page.goto(`${LIVE}/?token=${token}`);
    await ready(page);
    await expect(catchUp(page)).toHaveAccessibleDescription(/^Covers .+ to now\. (About \d+¢|Less than 1¢) on Haiku\.$/);
    await catchUp(page).click();
    // Said only for a catch-up that arrives while the page is open: other tests share this office, and the one written
    // a moment ago by another test already shows a heading and "Written just now" when the page opens.
    await expect(said(page, 'Your catch-up is ready.')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /^Your catch-up from .+$/, level: 3 })).toBeVisible();
    // The newest comes first; the earlier ones, folded under it, can be just as recent.
    await expect(page.getByText(/^Written just now for .+ on Haiku\.$/).first()).toBeVisible();
    const nothingNew = /^Nothing new since your last catch-up at .+\.$/;
    await expect(catchUp(page)).toHaveAccessibleDescription(nothingNew);
    await expect(catchUp(page)).toHaveAttribute('aria-disabled', 'true');
    // Pressed now, it says why it does nothing.
    await catchUp(page).focus();
    await page.keyboard.press('Enter');
    await expect(said(page, nothingNew)).toHaveCount(1);
    await page.screenshot({ path: `test-results/evidence/catch-up-live-${info.project.name}.png` });
    await page.getByRole('tab', { name: 'Payroll' }).click();
    await expect(page.getByRole('row', { name: /The office/ })).toContainText(/\d+ catch-ups?/);
  });
});
