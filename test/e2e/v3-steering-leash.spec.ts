import { expect, test } from '@playwright/test';
import { sheetUp, deskTurns, open, openBoard, running, shot, until, watchErrors } from './v3-kit.ts';
import { api, view } from './v3-world.ts';

// H44 (AC21): the per-person leash from Kai's panel, its badge, the hold ("check with me") on a new task, a trusted
// leash, and a room's leash from Settings. The change by talking is in v3-steering-talking.spec.ts.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `leash-${info.project.name}`);
  await request.dispose();
});

test.describe('the leash', () => {
  test('"checks with you" is set from their panel and shows as a badge on their row and their name', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/people/ui-designer`);
    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByLabel('Leash', { exact: true }).selectOption('check');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(request, id, (c) => c.steering?.people['ui-designer']?.leash === 'check');
    await expect(page.getByText('Saved. Kai checks with you before each new task now.').first()).toBeVisible();
    await expect(page.getByText('Leash: Checks with you').first()).toBeVisible();
    await shot(page, 'h44-leash-panel', info);
    const org = await openBoard(page, id, 'org');
    // On the chart a node's name ends with its leash.
    const row = org.getByRole('treeitem', { name: /^Kai,.*Checks with you\./ });
    await expect(row).toBeVisible();
    await shot(page, 'h44-leash-badge', info);
    expect(errors).toEqual([]);
  });

  test('a new task for someone who checks with you waits in the inbox, and Start it lets it go', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const made = await api<{ id: string }>(request, `api/c/${id}/tasks`, { title: 'Check me', brief: `Pick the palette [hold-brief-${info.project.name}]`, files: ['palette.md'], owner: 'ui-designer', doneWhen: 'It is picked', milestone: null });
    expect(made.status).toBe(201);
    const question = await until(request, id, (c) => c.questions.find((q) => q.gate?.task === made.body.id));
    expect(question.text).toBe('Kai would like to start “Check me”. Start it, or hold it until you resume it?');
    await open(page, `/c/${id}/inbox`);
    await sheetUp(page);
    await expect(page.getByRole('region', { name: 'Needs you' })).toContainText('Kai would like to start');
    await shot(page, 'h44-hold-inbox', info);
    // Nothing has reached Kai's desk: the brief is held back.
    await page.waitForTimeout(1500);
    expect(deskTurns(`[hold-brief-${info.project.name}]`)).toEqual([]);
    expect((await view(request, id)).tasks.find((t) => t.id === made.body.id)?.status).toBe('queued');
    await page.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: 'Start it', exact: true }).click();
    await until(request, id, (c) => c.tasks.find((t) => t.id === made.body.id)?.status === 'working');
    await expect.poll(() => deskTurns(`[hold-brief-${info.project.name}]`).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await shot(page, 'h44-hold-started', info);
    expect(errors).toEqual([]);
  });

  test('Not now keeps the task waiting', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const made = await api<{ id: string }>(request, `api/c/${id}/tasks`, { title: 'Not yet', brief: `Leave it [declined-brief-${info.project.name}]`, files: ['later.md'], owner: 'ui-designer', doneWhen: 'It is left', milestone: null });
    await until(request, id, (c) => c.questions.find((q) => q.gate?.task === made.body.id && q.answer === null));
    await open(page, `/c/${id}/inbox`);
    await sheetUp(page);
    await page.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: 'Not now', exact: true }).click();
    // An answer reaches the asker at appliesAt (5 s after the press, so it can be undone). Wait until that has passed:
    // a wrong start would only show then.
    const answered = await until(request, id, (c) => c.questions.find((q) => q.gate?.task === made.body.id && q.answer !== null)?.answer);
    await expect.poll(() => Date.now(), { timeout: 20_000 }).toBeGreaterThan((answered?.appliesAt ?? 0) + 1000);
    expect((await view(request, id)).tasks.find((t) => t.id === made.body.id)?.status).toBe('queued');
    expect(deskTurns(`[declined-brief-${info.project.name}]`)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('trusted is set from the panel too, and the badge says it', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/people/frontend-engineer`);
    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByLabel('Leash', { exact: true }).selectOption('trusted');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(request, id, (c) => c.steering?.people['frontend-engineer']?.leash === 'trusted');
    await expect(page.getByText('Leash: Trusted').first()).toBeVisible();
    await shot(page, 'h44-leash-trusted', info);
    expect(errors).toEqual([]);
  });

  test('a room has a leash of its own, from Settings, and a person keeps their own over it', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/settings`);
    await expect(page.getByRole('heading', { name: /Leash/ }).first()).toBeVisible();
    const room = page.getByRole('combobox', { name: 'Engineering', exact: true });
    await room.selectOption('check');
    await page.getByRole('button', { name: 'Save', exact: true, disabled: false }).click();
    await until(request, id, (c) => c.steering?.settings.leash.rooms.engineering === 'check');
    // Sam's own trusted wins over the room; Ivo follows the room.
    const c = await view(request, id);
    expect(c.steering?.people['frontend-engineer']).toMatchObject({ leash: 'trusted', leashFrom: 'person' });
    expect(c.steering?.people['backend-engineer']).toMatchObject({ leash: 'check', leashFrom: 'room' });
    await shot(page, 'h44-leash-room-settings', info);
    expect(errors).toEqual([]);
  });
});
