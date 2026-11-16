import { expect, test } from '@playwright/test';
import { open, openBoard, scratchOf, shot, stopWork, watchErrors } from './v3-kit.ts';
import { api, found, PLAIN_HUB, view } from './v3-world.ts';

// v0.7 (SPEC-v0.7.md, "Granularity"): a plain job is one Claude Code session at the desk. Its own todo list is the task
// board and the subagent it starts is a helper beside the desk with its own cost, both read from its stream.
interface PlainState {
  shape?: string;
  todos?: { text: string; status: string }[];
  helpers?: { type: string; description: string; state: string; costUsd: number }[];
}

test.describe('a plain job', () => {
  test("shows the session's own list on the task board and its helper beside the desk, mid-run", async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), `plain-${info.project.name}`, '[fake:plain-demo] Add a watering streak to the plant app.', PLAIN_HUB);
    try {
      // The job starts at once: no CEO, no proposal, the words verbatim at the one desk.
      await expect.poll(async () => (await view(request, id, PLAIN_HUB)).phase, { timeout: 30_000 }).toBe('running');
      await expect
        .poll(async () => {
          const c = (await api<{ company: PlainState }>(request, `api/c/${id}/state`, undefined, PLAIN_HUB)).body.company;
          return { list: c.todos?.length ?? 0, helper: c.helpers?.[0]?.state ?? null };
        }, { timeout: 60_000 })
        .toEqual({ list: 3, helper: 'working' });

      await open(page, `/c/${id}`, PLAIN_HUB);
      // Over the office, the helper's bubble says what it was asked to do, beside the desk.
      await expect(page.locator('.labels .label--person').filter({ hasText: /^Maps/ }).first()).toBeAttached({ timeout: 60_000 });
      // Long enough for the person to reach their desk after the office opens.
      await page.waitForTimeout(5_000);
      await shot(page, 'v07-plain-office', info);

      const board = await openBoard(page, id, 'tasks', { hub: PLAIN_HUB });
      const list = board.getByRole('region', { name: "Claude Code's list" });
      await expect(list.getByRole('listitem')).toHaveCount(3);
      await expect(list.getByRole('listitem').nth(1)).toContainText('Add the watering streak');
      await expect(list.getByRole('listitem').nth(1)).toContainText('Doing');
      const helpers = board.getByRole('region', { name: /^Helpers/ });
      await expect(helpers.getByRole('listitem')).toHaveCount(1);
      await expect(helpers.getByRole('listitem')).toContainText('Explore');
      await expect(helpers.getByRole('listitem')).toContainText('Maps where reminders are sent');
      await expect(helpers.getByRole('listitem')).toContainText(/\$\d/);
      await expect(board.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
      await shot(page, 'v07-plain-board', info);
      expect(errors).toEqual([]);
    } finally {
      await stopWork(request, id, 'builder', PLAIN_HUB);
    }
  });
});
