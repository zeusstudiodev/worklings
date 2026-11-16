import { expect, test } from '@playwright/test';
import { open, scratchOf, setting, shot, stopWork, watchErrors } from './v3-kit.ts';
import { api, found, PROPOSAL, say, view } from './v3-world.ts';

// v0.4 (SPEC-v0.4.md, H1 and H2): a harness-shaped company's seats in the office, and a Builder's helper (a Claude Code
// subagent the desk started with the Agent tool) standing beside the Builder's desk while it works.
const member = (id: string, name: string, title: string, level: string, room: string, reportsTo: string | null, owns: string, library: string) => ({
  id, name, title, level, room, reportsTo, model: 'sonnet', owns, library,
});
const SEATS = {
  ...PROPOSAL,
  size: 'small',
  sizing: 'Balanced: one app, so one Builder.',
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
    { id: 'quality', title: 'Quality', style: 'quality' },
  ],
  people: [
    member('ceo', 'Noor', 'Lead', 'ceo', 'direction', null, 'The plan and the line to the stakeholder', 'ceo'),
    member('builder', 'Sam', 'Builder', 'worker', 'engineering', 'ceo', 'The whole codebase', 'builder'),
    member('tester', 'Tom', 'Tester', 'worker', 'quality', 'ceo', 'The acceptance tests', 'tester'),
    member('reviewer', 'Rae', 'Reviewer', 'worker', 'quality', 'ceo', 'The final review', 'reviewer'),
  ],
};

test.describe('a Builder and a helper', () => {
  test("the helper the Builder's desk starts stands beside the Builder's desk while it works", async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), `helpers-${info.project.name}`);
    await expect.poll(async () => (await view(request, id)).phase, { timeout: 60_000, intervals: [100, 250, 500] }).toBe('proposed');
    const edited = await api(request, `api/c/${id}/proposal`, { proposal: SEATS });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    await setting(request, id, { planApproval: 'off' });
    expect((await api(request, `api/c/${id}/start`, {})).status).toBe(200);
    await expect.poll(async () => (await view(request, id)).phase, { timeout: 60_000 }).toBe('running');
    try {
      await say(request, id, 'builder', '[fake:helper] Build the watering flow.');
      // The office has the helper as the Builder's, beside their desk, with what it was asked to do.
      await expect
        .poll(async () => (await api<{ agents?: { helperOf?: string; name: string; task: string | null }[] }>(request, `api/c/${id}/state`)).body.agents?.find((a) => a.helperOf === 'builder') ?? null, { timeout: 60_000 })
        .toMatchObject({ name: "Builder's helper", task: 'Explores the watering routes' });
      await open(page, `/c/${id}`);
      // Over the office, the helper's bubble says what it was asked to do, beside the Builder's desk.
      // (cut to fit: "Explores the watering…" on a desktop, "Explores…" on a phone).
      await expect(page.locator('.labels .label--person').filter({ hasText: /^Explores/ }).first()).toBeAttached({ timeout: 60_000 });
      await expect.poll(async () => (await view(request, id)).people.find((p) => p.id === 'builder')?.desk.state, { timeout: 30_000 }).toBe('working');
      await page.waitForTimeout(1_500);
      await shot(page, 'v04-builder-helper', info);
      expect(errors).toEqual([]);
    } finally {
      await stopWork(request, id, 'builder');
    }
  });
});
