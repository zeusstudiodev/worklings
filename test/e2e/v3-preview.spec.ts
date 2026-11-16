import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { open, running, scratchOf, shot, watchErrors } from './v3-kit.ts';
import { api, DEV_APP_PORT, folderFor, HUB_PORT } from './v3-world.ts';

test.describe('preview', () => {
  test("the project's dev server runs behind the proxy, on an origin of its own, and shows in the panel", async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const name = `preview-${info.project.name}`;
    // The project's own dev script, there before the company starts (the office reads package.json once in a while):
    // the fixture server prints its address the way a dev server does.
    const devApp = process.env.E2E_DEV_APP;
    if (!devApp) throw new Error('E2E_DEV_APP is not set: run these specs through playwright.config.ts.');
    writeFileSync(join(folderFor(scratchOf(), name), 'package.json'), JSON.stringify({ name, private: true, scripts: { dev: `node "${devApp}"` } }));
    const id = await running(request, name);

    try {
      await open(page, `/c/${id}/preview`);
      const preview = page.getByRole('region', { name: 'Preview' });
      await expect(preview.getByText("The app isn't running.")).toBeVisible({ timeout: 30_000 });
      await expect(preview.getByText('npm run dev')).toBeVisible();
      await expect(preview.getByRole('button', { name: 'Reload' })).toBeDisabled();
      await shot(page, 'preview-off', info);

      await preview.getByRole('button', { name: 'Start the app' }).click();
      const app = page.frameLocator('iframe');
      await expect(app.getByRole('heading', { name: 'Plant Pal preview' })).toBeVisible({ timeout: 60_000 });
      await shot(page, 'preview-up', info);

      // The app is a different origin from the office, so its scripts can't reach the office's API.
      const src = await page.locator('iframe').getAttribute('src');
      expect(src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(new URL(src ?? '').port).not.toBe(String(HUB_PORT));
      // The phone's bar is Back, the path, Reload and Screenshots; the link to a tab of its own is on desktops.
      if (info.project.name === 'v3') await expect(preview.getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', src ?? '');

      // Full screen (desktops; phones show the preview full screen already), with a real click: the browser's own, and
      // where the browser refuses, the stage fills the window with the same Exit.
      if (info.project.name === 'v3') {
        const stageFull = () => page.evaluate('document.fullscreenElement === null ? null : document.fullscreenElement.contains(document.querySelector("iframe"))');
        const exit = preview.getByRole('button', { name: 'Exit full screen' });
        await preview.getByRole('button', { name: 'Full screen', exact: true }).click();
        await expect.poll(stageFull).toBe(true);
        await expect(exit).toBeVisible();
        await shot(page, 'preview-full-screen', info);
        await exit.click();
        await expect.poll(stageFull).toBeNull();
        await expect(exit).toHaveCount(0);
        await page.evaluate("Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'))");
        await preview.getByRole('button', { name: 'Full screen', exact: true }).click();
        await expect(exit).toBeVisible();
        expect(await stageFull()).toBeNull();
        // Filling the window: the app takes its width, not the wide view's beside the panel.
        expect((await page.locator('iframe').boundingBox())?.width ?? 0).toBeGreaterThan(1400);
        await exit.click();
        await expect(exit).toHaveCount(0);
      }

      // A path typed in the bar is the path the app is asked for.
      await preview.getByRole('textbox', { name: 'Path in the app' }).fill('/menu');
      await preview.getByRole('textbox', { name: 'Path in the app' }).press('Enter');
      await expect(app.locator('#path')).toHaveText('/menu');
      expect((await page.request.get(src ?? '')).status()).toBe(200);
      expect(errors).toEqual([]);
    } finally {
      await api(request, `api/c/${id}/preview`, { action: 'stop' });
    }
    // Stopped: the dev server is gone, not left running on its port.
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${DEV_APP_PORT}/`).then(() => 'up', () => 'down')), { timeout: 30_000 }).toBe('down');
  });
});
