import { expect, test } from '@playwright/test';
import { LIVE, playSession } from './live.ts';

const token = process.env.E2E_TOKEN ?? '';
/** Page code as a function (the Node typecheck has no DOM types): the buttons' accessible labels. */
const labelsOf = new Function('els', "return els.map((el) => el.getAttribute('aria-label'));") as (els: unknown[]) => (string | null)[];

test.describe('names on the Now tab of a live office', () => {
  test('tell calls of one role with the same goal apart by when each started', async ({ page }, info) => {
    // Two sessions whose code reviewers are both at work on the captured call's goal, "Read notes.txt contents".
    const requests = [1, 2].map((n) => `Check notes.txt, take ${n} (${info.project.name})`);
    for (const prompt of requests) await playSession({ stopBefore: 'SubagentStop', prompt });
    await page.goto(`${LIVE}/?token=${token}`);

    const reviewer = page.getByRole('button', { name: 'Code reviewer', exact: true });
    for (const request of requests) {
      const row = page.getByRole('region', { name: 'On it', exact: true }).getByRole('listitem').filter({ hasText: `For your request: ${request}` }).filter({ has: reviewer });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByRole('button', { name: /^Ask the code reviewer about Read notes\.txt contents, started \d{1,2}:\d{2}/ })).toBeVisible();
      await expect(row.getByRole('button', { name: 'Code reviewer', exact: true })).toHaveAccessibleDescription(/^Read notes\.txt contents Started \d{1,2}:\d{2}.*\.$/);
    }

    // No two Ask buttons on the tab share a name, the folded rows' included: other tests' reviewers had this goal too.
    // Read in one go: the tab's rows come and go as other sessions end, so one read per button could ask for a button
    // that has left by then.
    const names = await page.getByRole('tabpanel', { name: 'Now' }).getByRole('button', { name: /^Ask /, includeHidden: true }).evaluateAll(labelsOf);
    expect(names.length).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);
  });
});
