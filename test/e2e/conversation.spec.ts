import { expect, test } from '@playwright/test';
import { LIVE, playSession } from './live.ts';

const token = process.env.E2E_TOKEN ?? '';

test.describe('a conversation in the live office', () => {
  test('stays open, with its draft, when the person it sits by leaves the scene', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'On phones the conversation is always in the sheet');
    test.setTimeout(90_000);
    // An Explore agent at work: a contractor, who sits in the lobby while it works and leaves the scene after reporting
    // (through the lobby door after its report walk, or 20 s after it stops).
    const session = await playSession({ role: 'Explore', stopBefore: 'SubagentStop' });
    await page.goto(`${LIVE}/?token=${token}`);
    await expect(page.locator('canvas')).toBeVisible();

    await page.getByRole('button', { name: 'Ask the Explore agent' }).click();
    const popover = page.getByRole('dialog', { name: 'Ask the Explore agent' });
    await expect(popover).toBeVisible();
    await popover.getByRole('textbox', { name: 'Or ask your own question' }).fill('Where did you look?');

    // It reports back and goes: the scene has no figure for it any more, so the conversation takes the panel's place.
    // It must be on screen at every moment of the move, so the page notes any change to the page that leaves it out.
    // (Page code as a string: the tests' TypeScript has no DOM types.)
    await page.evaluate(`new MutationObserver(() => {
      if (![...document.querySelectorAll('h2')].some((h) => h.textContent === 'Ask the Explore agent')) document.body.dataset.conversationGone = 'true';
    }).observe(document.body, { childList: true, subtree: true })`);
    await session.finish();
    const panel = page.getByRole('complementary', { name: 'Studio details' });
    await expect(panel.getByRole('heading', { name: 'Ask the Explore agent' })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate('document.body.dataset.conversationGone ?? null')).toBeNull();
    await expect(popover).toHaveCount(0);
    const box = panel.getByRole('textbox', { name: 'Or ask your own question' });
    await expect(box).toHaveValue('Where did you look?');
    // Focus was in the box when it moved, so it follows the box.
    await expect(box).toBeFocused();
  });
});
