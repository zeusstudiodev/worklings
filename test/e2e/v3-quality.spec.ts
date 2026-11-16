import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { CompanyView } from '../../src/core/company.ts';
import { open, openProgress, running, scratchOf, shot, tell, until, watchErrors } from './v3-kit.ts';
import { api, folderFor } from './v3-world.ts';

// v0.3, "better software in fewer shots" (SPEC-v0.3.md, Q1 and Q3): before the final review the office tries to open the
// app (here it won't: the dev script listens on every network, so the review is told so in plain words), and a requirement
// the review finds not met goes back to its maker as a fix round: the bar and Progress say "Fixing", with who fixes what,
// and nothing reaches the stakeholder.

test('a failed requirement goes back to its maker as a fix round, shown as Fixing', async ({ page, request }, info) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const name = `quality-fixing-${info.project.name}`;
  const id = await running(request, name, { planApproval: 'before-work' });
  // An app whose dev script the office wouldn't start by itself.
  writeFileSync(join(folderFor(scratchOf(), name), 'package.json'), JSON.stringify({ name: 'plant-pal', private: true, scripts: { dev: 'vite --host' } }));
  const plan = await until(request, id, (c) => c.steering?.plan?.versions.at(-1));
  expect((await api(request, `api/c/${id}/plan/approve`, { version: plan.version, through: null })).status).toBe(200);
  const owners: Record<string, string> = { 'p-1': 'ux-designer', 'p-2': 'frontend-engineer', 'p-3': 'ui-designer' };
  const doneOf = (c: CompanyView, planTask: string) => c.tasks.find((t) => t.planTask === planTask)?.status === 'done';
  for (const planTask of ['p-1', 'p-3', 'p-2']) {
    const task = await until(request, id, (c) => c.tasks.find((t) => t.planTask === planTask && t.status !== 'queued'), 120_000);
    await tell(request, id, owners[planTask] ?? 'ceo', `[fake:finish] [task ${task.id}] Report it done.`);
    await until(request, id, (c) => doneOf(c, planTask), 120_000);
  }
  // The review got what the office saw, and found the streak not met: a fix task for its maker, round 1 of 2.
  const fix = await until(request, id, (c) => c.tasks.find((t) => t.followUp?.kind === 'fix'), 180_000);
  expect(fix.followUp).toMatchObject({ round: 1 });
  const review = await until(request, id, (c) => c.tasks.find((t) => t.look && t.look.state !== 'running'));
  expect(review.look?.note).toContain("doesn't start npm run dev by itself");

  await openProgress(page, id);
  const column = page.locator('[data-progress]');
  await expect(column.locator('.progress__title-row')).toContainText('Fixing');
  await expect(column).toContainText('round 1 of 2.');
  await expect(column).toContainText("The office didn't open it in a browser");
  await shot(page, 'progress-fixing', info);
  // Nothing went to the stakeholder: the inbox is as empty as before.
  const view = await until(request, id, (c) => c);
  expect(view.messages.some((m) => m.to === '@stakeholder' && /not met/.test(m.text))).toBe(false);
  await open(page, '/');
  expect(errors).toEqual([]);
});
