import { mkdirSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { DEMO } from './addresses.ts';

// The demo loops every 150 s: the UX designer is briefed at 5 s and reports back at 20 s. A page sees a meeting only
// if it is open when the event arrives (an office opened mid-session doesn't replay old ones), so the pages are
// opened first and the test waits for the moment, however far off.
mkdirSync('test-results/evidence', { recursive: true });

// Bubbles have no role or label (they are visual; the Now tab is the accessible copy), so they are found by text
// inside the label layer. `data-walking` on a person's label says the scene planned a walk for them.
const bubble = (page: Page, text: string | RegExp): Locator => page.locator('.labels .bubble').filter({ hasText: text });
const personWith = (page: Page, text: string | RegExp): Locator => page.locator('.labels .label[data-walking]').filter({ has: page.locator('.bubble').filter({ hasText: text }) });

/**
 * Records every bubble the page ever shows and whether anyone ever walked, from before the page loads. A brief's bubble
 * stands for 2.5 s, so asking "is it visible now?" from a second page after the first page's own checks (and its slow
 * screenshot of the 3D scene) found the bubble already gone: the product showed it, the check looked too late.
 * (Page code as a string: the tests' TypeScript has no DOM types.)
 */
const recordBubbles = (page: Page) =>
  page.addInitScript(`(() => {
    window.__bubbles = new Set();
    window.__walked = false;
    const scan = () => {
      for (const b of document.querySelectorAll('.labels .bubble')) window.__bubbles.add(b.textContent.trim());
      if (document.querySelector('.labels .label[data-walking="true"]')) window.__walked = true;
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  })()`);
const sawBubble = async (page: Page, text: RegExp): Promise<boolean> => ((await page.evaluate('[...window.__bubbles]')) as string[]).some((t) => text.test(t));
const walked = async (page: Page): Promise<boolean> => (await page.evaluate('window.__walked')) as boolean;

test.describe('meetings in the demo', () => {
  test('the lead briefs and the UX designer reports back, and with reduced motion nobody walks', async ({ browser, page }, info) => {
    test.setTimeout(240_000);
    const size = page.viewportSize() ?? { width: 1440, height: 900 };
    const calm = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
    const still = await calm.newPage();
    await recordBubbles(still);
    await Promise.all([page.goto(DEMO), still.goto(DEMO)]);
    for (const p of [page, still]) await expect(p.locator('canvas')).toBeVisible();

    // The brief: the lead's bubble carries the goal, the subagent's says "On it".
    // A page opened mid-loop sees the loop's earlier events as old and plans no walk for them, so the test waits for a
    // meeting that began after the page opened: the subagent's "On it" with a planned walk.
    const goal = /^Design the streak/;
    // Other briefs in the loop (the UI designer at 21 s, the mobile engineer at 32 s) have other goals, so wait for both.
    await expect
      .poll(async () => (await bubble(page, goal).count()) > 0 && (await personWith(page, /^On it$/).count()) > 0, { timeout: 170_000, intervals: [200] })
      .toBe(true);
    await expect(personWith(page, /^On it$/)).toHaveAttribute('data-walking', 'true');
    // Reduced motion shows the same bubbles and the scene plans no walk for anyone, at any moment (recorded, not sampled).
    await expect.poll(() => sawBubble(still, goal), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => sawBubble(still, /^On it$/), { timeout: 10_000 }).toBe(true);
    expect(await walked(still)).toBe(false);
    await Promise.all([
      page.screenshot({ path: `test-results/evidence/meeting-brief-${info.project.name}.png` }),
      still.screenshot({ path: `test-results/evidence/meeting-brief-reduced-${info.project.name}.png` }),
    ]);

    // The report: the subagent's bubble says the first sentence of what it reported.
    const report = /^Spec in docs/;
    await expect(personWith(page, report)).toHaveAttribute('data-walking', 'true', { timeout: 30_000 });
    await expect.poll(() => sawBubble(still, report), { timeout: 10_000 }).toBe(true);
    expect(await walked(still)).toBe(false);
    await Promise.all([
      page.screenshot({ path: `test-results/evidence/meeting-report-${info.project.name}.png` }),
      still.screenshot({ path: `test-results/evidence/meeting-report-reduced-${info.project.name}.png` }),
    ]);
    await calm.close();
  });
});
