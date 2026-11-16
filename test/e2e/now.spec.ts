import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { DEMO, LIVE } from './addresses.ts';

mkdirSync('test-results/evidence', { recursive: true });

// Evaluated in the page, as a string, because the test files are typed for Node rather than the DOM.
const MOTION = `(() => {
  const found = [];
  const els = [...document.querySelectorAll('.now, .now *, [data-testid="now-caption"], [data-testid="now-caption"] *, .bubble, .bubble *')];
  const spans = (v) => v.split(',').map((t) => t.trim());
  for (const el of els) {
    const cs = getComputedStyle(el);
    const animates = cs.animationName !== 'none' && spans(cs.animationDuration).some((d) => d !== '0s');
    const transitions = cs.transitionProperty !== 'none' && spans(cs.transitionDuration).some((d) => d !== '0s');
    if (animates || transitions) found.push(el.className + ' | ' + cs.animationName + ' ' + cs.animationDuration + ' | ' + cs.transitionProperty + ' ' + cs.transitionDuration);
  }
  return { checked: els.length, moving: found };
})()`;

const motionOf = async (page: Page) => (await page.evaluate(MOTION)) as { checked: number; moving: string[] };

test.describe('the Now tab with reduced motion', () => {
  test('nothing on Now or in its caption animates or transitions', async ({ page, browser }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DEMO);
    await expect(page.locator('.now-row').first()).toBeVisible({ timeout: 15_000 });
    const now = await motionOf(page);
    expect(now.checked).toBeGreaterThan(10);
    expect(now.moving).toEqual([]);

    // The caption over the scene shows on desktops while the panel is on another tab; phones have none.
    if (info.project.name === 'desktop') {
      await page.getByRole('tab', { name: 'Team' }).click();
      await expect(page.getByTestId('now-caption')).toBeVisible();
      expect((await motionOf(page)).moving).toEqual([]);
      await page.getByRole('tab', { name: 'Now' }).click();
    } else {
      await expect(page.getByTestId('now-caption')).toHaveCount(0);
    }
    await page.screenshot({ path: `test-results/evidence/now-reduced-${info.project.name}.png` });

    // The check must be able to see motion: with the default preference a live office's status dot pulses.
    const normal = await browser.newContext({ viewport: page.viewportSize() });
    const other = await normal.newPage();
    await other.goto(`${LIVE}/?token=${process.env.E2E_TOKEN ?? ''}`);
    await expect(other.locator('.mode__dot')).toBeVisible();
    expect(await other.evaluate("getComputedStyle(document.querySelector('.mode__dot')).animationName")).not.toBe('none');
    await normal.close();
  });
});
