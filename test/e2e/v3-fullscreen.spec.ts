import { expect, type Page, test } from '@playwright/test';
import { moreKey, openCompany, openMore, shot, watchErrors } from './v3-kit.ts';

// The office's camera keys (docs/design-v3.md, "The office view"), in More at every size since v0.8: Full screen with a
// real click shows the whole office full screen and leaves it, a browser that refuses says so, and Fit the office in view
// sits beside it. Full screen only where the browser can show a page full screen (Android's Chrome; never iPhone Safari,
// which can't, so it offers nothing that does nothing). The preview's own Full screen is in v3-preview.spec.ts.
const fullscreen = (page: Page) => page.evaluate('document.fullscreenElement === null ? null : document.fullscreenElement === document.documentElement ? "the office" : "something else"');

test.describe('full screen', () => {
  test('Full screen shows the office full screen and leaves it, and says so when the browser refuses', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, 'demo');
    const bar = page.getByRole('banner');
    const company = moreKey(page);

    // v0.8: the map keys moved into More at every size, as phones had them: Fit, the zoom keys and Full screen.
    await expect(page.getByRole('main').getByRole('button', { name: /full screen|fit the office/i })).toHaveCount(0);
    await company.click();
    await expect(bar.getByRole('button', { name: 'Fit the office in view' })).toBeVisible();
    await bar.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect.poll(() => fullscreen(page)).toBe('the office');
    await shot(page, 'fullscreen-office', info);
    await company.click();
    await bar.getByRole('button', { name: 'Exit full screen' }).click();
    await expect.poll(() => fullscreen(page)).toBeNull();

    // A browser that refuses (a setting, a policy) is said to, rather than the press doing nothing.
    await page.evaluate("Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'))");
    await (await openMore(page)).getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: "The browser didn't allow full screen." })).toBeVisible();
    expect(await fullscreen(page)).toBeNull();

    // Where the browser can't (iPhone Safari), More offers no full screen at all, and Fit is still there.
    await page.addInitScript('Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false })');
    await page.reload();
    await company.click();
    await expect(bar.getByRole('button', { name: 'Fit the office in view' })).toBeVisible();
    await expect(bar.getByRole('button', { name: /full screen/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
