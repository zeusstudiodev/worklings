import { expect, type Page, test } from '@playwright/test';
import { moreKey, openCompany, openMore, shot, watchErrors } from './v3-kit.ts';

// The office's map keys (docs/design-v3.md, "The office view"): Full screen with a real click shows the whole office
// full screen and leaves it, a browser that refuses says so, and Fit the office in view sits beside it. Phones have them
// in More (v0.2: desktops have Full screen there too), Full screen only where the browser can show a page full screen (Android's Chrome; never iPhone Safari,
// which can't, so it offers nothing that does nothing). The preview's own Full screen is in v3-preview.spec.ts.
const fullscreen = (page: Page) => page.evaluate('document.fullscreenElement === null ? null : document.fullscreenElement === document.documentElement ? "the office" : "something else"');

test.describe('full screen', () => {
  test('Full screen shows the office full screen and leaves it, and says so when the browser refuses', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, 'demo');
    const bar = page.getByRole('banner');
    const company = moreKey(page);

    if (info.project.name === 'v3-phone') {
      // More holds Fit, the zoom keys and, here, Full screen.
      await company.click();
      await expect(bar.getByRole('button', { name: 'Fit the office in view' })).toBeVisible();
      await bar.getByRole('button', { name: 'Full screen', exact: true }).click();
      await expect.poll(() => fullscreen(page)).toBe('the office');
      await company.click();
      await bar.getByRole('button', { name: 'Exit full screen' }).click();
      await expect.poll(() => fullscreen(page)).toBeNull();
      // Where the browser can't (iPhone Safari), More offers no full screen at all.
      await page.addInitScript('Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false })');
      await page.reload();
      await company.click();
      await expect(bar.getByRole('button', { name: 'Fit the office in view' })).toBeVisible();
      await expect(bar.getByRole('button', { name: /full screen/i })).toHaveCount(0);
      expect(errors).toEqual([]);
      return;
    }

    // The map keys at the office's top right, their words shown: Fit and Full screen.
    const full = page.getByRole('button', { name: 'Full screen', exact: true });
    const fit = page.getByRole('button', { name: 'Fit the office in view', exact: true });
    await expect(bar.getByRole('button', { name: /full screen|fit the office/i })).toHaveCount(0);
    await expect(fit).toHaveText(/Fit/);
    await full.click();
    await expect.poll(() => fullscreen(page)).toBe('the office');
    await shot(page, 'fullscreen-office', info);
    await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
    await expect.poll(() => fullscreen(page)).toBeNull();
    await expect(full).toBeVisible();
    await fit.click();
    // v0.2: More has Full screen too, for the views without the map keys.
    const more = await openMore(page);
    await more.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect.poll(() => fullscreen(page)).toBe('the office');
    await page.getByRole('button', { name: 'Exit full screen', exact: true }).first().click();
    await expect.poll(() => fullscreen(page)).toBeNull();

    // A browser that refuses (a setting, a policy) is said to, rather than the press doing nothing.
    await page.evaluate("Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'))");
    await full.click();
    await expect(page.getByRole('status').filter({ hasText: "The browser didn't allow full screen." })).toBeVisible();
    expect(await fullscreen(page)).toBeNull();

    // A browser with no page full screen gets no Full screen key, and Fit is still there.
    await page.addInitScript('Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false })');
    await page.reload();
    await expect(fit).toBeVisible();
    await expect(page.getByRole('button', { name: /full screen/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
