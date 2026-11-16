import { expect, test } from '@playwright/test';
import { DEMO } from './addresses.ts';


interface Tag {
  x: number;
  y: number;
  /** The middle of the name tag's Ask is over the panel. */
  underPanel: boolean;
  /** A click there reaches the panel, not the tag. */
  panelGetsIt: boolean;
}

// Page code as a string: the tests' TypeScript has no DOM types.
const TAG = `(() => {
  const ask = document.querySelector('.labels [data-ask^="tag:"]');
  const panel = document.querySelector('[aria-label="Studio details"]');
  if (!ask || !panel) return null;
  const r = ask.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const x = (r.left + r.right) / 2;
  const y = (r.top + r.bottom) / 2;
  return { x, y, underPanel: x > p.left && x < p.right && y > p.top && y < p.bottom, panelGetsIt: panel.contains(document.elementFromPoint(x, y)) };
})()`;
const tagOf = async (page: import('@playwright/test').Page) => (await page.evaluate(TAG)) as Tag | null;

test.describe('labels over the model', () => {
  test('pass under the panel, so a name tag dragged there never takes its clicks', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'Phones leave Ask off the name tag');
    await page.goto(DEMO);
    await expect(page.locator('canvas')).toBeVisible();
    // Selecting the lead puts their name tag, with its Ask, over them in the scene.
    await page.getByRole('tabpanel', { name: 'Now' }).getByRole('button', { name: 'Lead', exact: true }).click();
    await expect(page.locator('.labels [data-ask^="tag:"]')).toBeVisible();
    const before = await tagOf(page);
    if (!before) throw new Error('No name tag');
    // Drag the model until the tag sits in the middle of the panel.
    const panel = await page.getByRole('complementary', { name: 'Studio details' }).boundingBox();
    if (!panel) throw new Error('No panel');
    const dx = panel.x + panel.width / 2 - before.x;
    const dy = panel.y + panel.height / 2 - before.y;
    await page.mouse.move(240, 640);
    await page.mouse.down();
    await page.mouse.move(240 + dx, 640 + dy, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await tagOf(page))?.underPanel, { timeout: 5000 }).toBe(true);
    expect((await tagOf(page))?.panelGetsIt).toBe(true);
  });
});
