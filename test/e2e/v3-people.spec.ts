import { expect, test } from '@playwright/test';
import { card, column, companyAddress, expectAddress, open, openBoard, panelTitle, person, running, shot, sidePanel, talkBox, theTo, watchErrors } from './v3-kit.ts';
import { say, view } from './v3-world.ts';

// H19 (the org chart, a person's panel) and H20 (the tasks panel) on one company that has a goal, a task that went from
// assigned to reported to accepted, and a person with a session: Lea, the UX designer.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(180_000);
  const request = await playwright.request.newContext();
  id = await running(request, `people-${info.project.name}`);
  await say(request, id, 'ceo', '[fake:goal] Set the goal');
  await expect.poll(async () => (await view(request, id)).goal?.milestones.map((m) => m.id), { timeout: 60_000 }).toEqual(['ms-1', 'ms-2']);
  await say(request, id, 'head-of-design', '[fake:assign-m1] Plan the watering flow');
  await expect.poll(async () => (await view(request, id)).tasks.map((t) => t.id), { timeout: 60_000 }).toEqual(['t-1']);
  await say(request, id, 'ux-designer', '[fake:report-done] Report back');
  await expect.poll(async () => (await view(request, id)).reports.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await say(request, id, 'head-of-design', '[fake:accept] Review it');
  await expect.poll(async () => (await view(request, id)).tasks[0]?.status, { timeout: 60_000 }).toBe('done');
  await request.dispose();
});

test.describe('people', () => {
  test('the org chart shows everyone, and opening someone on it opens their panel', async ({ page }, info) => {
    const errors = watchErrors(page);
    // The org chart is the Org board itself (a tree of everyone; on a phone the same tree as an outline).
    const chart = await openBoard(page, id, 'org');
    for (const who of ['Noor', 'Ada', 'Lea', 'Kai', 'Ben', 'Sam', 'Ivo', 'Tom']) await expect(chart.getByRole('treeitem', { name: new RegExp(`^${who},`) })).toBeVisible();
    await shot(page, 'h19-org-chart', info);
    await chart.getByRole('treeitem', { name: /^Lea,/ }).click();
    await expectAddress(page, companyAddress(id, { main: 'org', panel: 'people/ux-designer' }));
    await expect(panelTitle(page)).toHaveText('Lea');
    expect(errors).toEqual([]);
  });

  test("a person's panel has the real conversation, their task, status, latest report, cost and their session to open in Claude Code", async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const company = await view(request, id);
    const lea = person(company, 'ux-designer');
    expect(lea.desk.sessionId).toBeTruthy();
    await open(page, `/c/${id}/people/ux-designer`);
    const panel = page.getByRole('article', { name: 'Lea' });
    await expect(panel).toContainText('UX designer in Design, reports to Ada');
    await expect(panel).toContainText('spent, API-equivalent');
    // The conversation is the messages that really went to Lea, in order.
    const talk = panel.getByRole('region', { name: 'Conversation with Lea' });
    await expect(talk).toContainText('[fake:report-done] Report back');
    await expect(talk).toContainText('Sketch the watering flow');
    // Their latest report (their task, now done, is in the conversation as the office's own line and in the Tasks tab).
    await expect(talk).toContainText('The office: Ada assigned Lea: Sketch the watering flow.');
    await expect(panel).toContainText('Latest report');
    await expect(panel).toContainText('Three screens described: plant, water, streak.');
    // Details: Open in Claude Code names the session the desk really has.
    await panel.getByRole('button', { name: 'Details' }).click();
    const handover = panel.getByRole('region', { name: 'Open in Claude Code' });
    await expect(handover).toContainText(lea.desk.sessionId ?? 'no session');
    await shot(page, 'h19-person', info);
    expect(errors).toEqual([]);
  });

  test('clicking anyone on the org opens them beside it, and "Message Kai" makes Kai the talk bar\'s To', async ({ page }, info) => {
    const org = await openBoard(page, id, 'org');
    await org.getByRole('treeitem', { name: /^Kai,/ }).click();
    await expect(panelTitle(page)).toHaveText('Kai');
    // Opening Kai with an empty box made him the To already; "Message Kai" does it with words in the box too.
    await expect(theTo(page)).toHaveAccessibleName('To Kai, UI designer');
    await sidePanel(page).getByRole('button', { name: 'Message Kai', exact: true }).click();
    await expect(talkBox(page)).toBeFocused();
    await expect(talkBox(page)).toHaveAccessibleName('Message to Kai, UI designer');
    await shot(page, 'h19-kai', info);
  });
});

test.describe('tasks', () => {
  test('the board has the finished task in Done, by room too, and its card opens it with its report', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const company = await view(request, id);
    expect(company.tasks[0]).toMatchObject({ id: 't-1', status: 'done', owner: 'ux-designer', milestone: 'ms-1' });
    const board = await openBoard(page, id, 'tasks');
    if (info.project.name.includes('phone')) await board.getByRole('tab', { name: /^Done\b/ }).click();
    const done = column(board, 'Done');
    await expect(card(done, 'Sketch the watering flow')).toBeVisible();
    await shot(page, 'h20-tasks', info);

    await card(done, 'Sketch the watering flow').click();
    await expectAddress(page, companyAddress(id, { main: 'tasks', panel: 'tasks/t-1' }));
    await expect(panelTitle(page)).toHaveText('Sketch the watering flow');
    await expect(sidePanel(page).getByText('Three screens described: plant, water, streak.', { exact: false }).first()).toBeVisible();
    await expect(sidePanel(page).getByText('Watering flow', { exact: false }).first()).toBeVisible();
    await shot(page, 'h20-task-finished', info);
    expect(errors).toEqual([]);
  });
});
