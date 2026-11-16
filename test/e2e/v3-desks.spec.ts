import { expect, test } from '@playwright/test';
import { open, openBoard, openMore, person, running, shot, stopWork, watchErrors } from './v3-kit.ts';
import { api, say, view } from './v3-world.ts';

// H11: at the company's desk cap the rest of the people wait, and the office says so.
test.describe('the desk cap', () => {
  test('with two desks, two of four people wait, and the office shows them waiting', async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const id = await running(request, `desks-${info.project.name}`);
    const crew = ['ui-designer', 'ux-designer', 'frontend-engineer', 'backend-engineer'];
    try {
      expect((await api(request, `api/c/${id}/settings`, { maxDesks: 2 })).status).toBe(200);
      for (const who of crew) await say(request, id, who, '[fake:work] Work on it');
      await expect
        .poll(
          async () => {
            const company = await view(request, id);
            const states = crew.map((who) => person(company, who).desk.state);
            return [states.filter((s) => s === 'working').length, states.filter((s) => s === 'waiting').length];
          },
          { timeout: 60_000 },
        )
        .toEqual([2, 2]);
      const company = await view(request, id);
      const waiting = crew.filter((who) => person(company, who).desk.state === 'waiting');

      await open(page, `/c/${id}`);
      // The counts the bar held until v0.2 are More's "Now" figures, on a desktop and a phone alike.
      const more = await openMore(page);
      const waitingFigure = more.getByRole('group', { name: 'Now' }).locator('div', { has: page.getByText('Waiting for a desk', { exact: true }) });
      await expect(waitingFigure).toContainText('2', { timeout: 30_000 });
      await page.keyboard.press('Escape');
      // Who waits shows on the org, each with their state in words.
      const org = await openBoard(page, id, 'org');
      await expect(org.getByText('Waiting for a desk', { exact: true })).toHaveCount(2);
      await shot(page, 'h11-desks-waiting', info);

      // A waiting person's own panel says the same.
      const who = waiting[0] ?? '';
      await open(page, `/c/${id}/people/${who}`);
      await expect(page.getByRole('region', { name: /^What .* is doing$/ })).toContainText('Waiting for a desk');
      expect(errors).toEqual([]);
    } finally {
      await api(request, `api/c/${id}/settings`, { maxDesks: 8 });
      for (const who of crew) await stopWork(request, id, who);
    }
  });
});
