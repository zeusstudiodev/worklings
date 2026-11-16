import { expect, test } from '@playwright/test';
import { EMPTY } from './addresses.ts';

// The empty-folder office: like every live office, it shows nothing without its access token.
const OFFICE = EMPTY;
const token = process.env.E2E_TOKEN ?? '';

test.describe('the access token', () => {
  test('a tab that kept it while Worklings was called Headcount reconnects after a reload', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'The token is the same on every screen: checked once, on the desktop layout.');
    await page.goto(OFFICE);
    await expect(page.getByText('This office needs its access link')).toBeVisible();
    // What a tab opened by an earlier version holds. (Page code as a string: the tests' TypeScript has no DOM types.)
    await page.evaluate(`sessionStorage.setItem('headcount-token', ${JSON.stringify(token)})`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No studio here yet' })).toBeVisible();
    await expect(page).toHaveURL(`${OFFICE}/`);
    // Moved to the new name, so the next reload finds it there.
    expect(await page.evaluate(`[sessionStorage.getItem('worklings-token'), sessionStorage.getItem('headcount-token')]`)).toEqual([token, null]);
  });
});
