import { expect, test } from '@playwright/test';
import { sheetUp, open, openBoard, planVersions, running, setting, shot, tell, until, watchErrors } from './v3-kit.ts';
import { api, view } from './v3-world.ts';

// H46 (AC23): the fake CEO acts on the stakeholder's word through the same code as the office, citing the stakeholder's
// message, and each act lands in the decision log. A citation the company refuses changes nothing; making someone Trusted
// by talking waits for the stakeholder's yes in the inbox. "$message" in v3-world.ts's scenarios stands for the message the
// CEO's turn answers, which is how the fake cites it.
test.describe.configure({ mode: 'serial' });

let id = '';
let taskId = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `talking-${info.project.name}`);
  await setting(request, id, { planApproval: 'before-work' });
  taskId = (await api<{ id: string }>(request, `api/c/${id}/tasks`, { title: 'Sketch the empty state', brief: 'b', files: ['empty.md'], owner: 'ux-designer', doneWhen: 'd', milestone: null })).body.id;
  await request.dispose();
});

test.describe('the CEO acts on the stakeholder’s word', () => {
  test('a setting: "let three people work at once" changes the desks and records who decided and on which message', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const said = await tell(request, id, 'ceo', '[fake:setting-desks] Let three people work at once');
    await until(request, id, (c) => c.settings.maxDesks === 3);
    const decision = await until(request, id, (c) => c.steering?.decisions.find((d) => d.kind === 'setting' && d.by === 'ceo'));
    expect(decision.links.message).toBe(said);
    expect(decision.reversible).toBe(true);
    await open(page, `/c/${id}/decisions`);
    await expect(page.getByText(/set 3 desks at once/).first()).toBeVisible();
    await shot(page, 'h46-setting-by-talking', info);
    expect(errors).toEqual([]);
  });

  test('a leash: "check with me before Kai starts anything" puts Kai on "checks with you", with a badge', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const said = await tell(request, id, 'ceo', '[fake:leash-check-kai] Kai should check with me before each task');
    await until(request, id, (c) => c.steering?.people['ui-designer']?.leash === 'check');
    const decision = await until(request, id, (c) => c.steering?.decisions.find((d) => d.kind === 'leash' && d.by === 'ceo'));
    expect(decision.links.message).toBe(said);
    await expect((await openBoard(page, id, 'org')).getByRole('treeitem', { name: /^Kai,.*Checks with you\./ })).toBeVisible();
    await shot(page, 'h46-leash-by-talking', info);
    expect(errors).toEqual([]);
  });

  test('making Sam Trusted by talking waits for the stakeholder’s yes, and takes effect only then', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tell(request, id, 'ceo', '[fake:leash-trusted-sam] Sam can be trusted with routine work');
    const question = await until(request, id, (c) => c.questions.find((q) => q.answer === null && !q.gate && /Trusted|trust/i.test(q.text) && /Sam/.test(q.text)));
    // Until the yes, nothing changed.
    expect((await view(request, id)).steering?.people['frontend-engineer']?.leash).not.toBe('trusted');
    await open(page, `/c/${id}/inbox`);
    await sheetUp(page);
    await expect(page.getByRole('region', { name: 'Needs you' })).toContainText('Sam');
    await shot(page, 'h46-trusted-asks', info);
    await page.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: question.options[0] ?? '', exact: true }).click();
    await until(request, id, (c) => c.steering?.people['frontend-engineer']?.leash === 'trusted');
    await expect((await openBoard(page, id, 'org')).getByRole('treeitem', { name: /^Sam,.*Trusted\./ })).toBeVisible();
    await shot(page, 'h46-trusted-after-yes', info);
    expect(errors).toEqual([]);
  });

  test('steering a task: "pause that task" and "go on with it" hold and release it', async ({ request }) => {
    await tell(request, id, 'ceo', `[fake:steer-pause-t1] Pause ${taskId}`.replace('t-1', taskId));
    const paused = await until(request, id, (c) => c.tasks.find((t) => t.id === taskId)?.paused);
    expect(paused.by).toBe('ceo');
    await tell(request, id, 'ceo', `[fake:steer-resume-t1] Resume ${taskId}`);
    await expect.poll(async () => (await view(request, id)).tasks.find((t) => t.id === taskId)?.paused ?? null, { timeout: 60_000 }).toBeNull();
    expect((await view(request, id)).steering?.decisions.filter((d) => d.kind === 'task' && d.by === 'ceo').length).toBeGreaterThanOrEqual(2);
  });

  test('a citation the company refuses changes nothing and leaves no decision', async ({ request }) => {
    const before = (await view(request, id)).steering?.decisions.length ?? 0;
    await tell(request, id, 'ceo', '[fake:setting-refused] Make it two desks');
    // The scenario posts a status line after the refused call, so once it is there the call has been made.
    await until(request, id, (c) => c.statuses.some((s) => s.text === 'Tried to change the desks.'));
    const after = await view(request, id);
    expect(after.settings.maxDesks).toBe(3);
    expect(after.steering?.decisions.length).toBe(before);
  });

  test('approving a plan by talking: a refused citation does nothing, then the real one approves it and makes the tasks', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tell(request, id, 'ceo', '[fake:plan] Plan the watering flow');
    await until(request, id, (c) => planVersions(c) === 1);
    await tell(request, id, 'ceo', '[fake:approve-plan-stale] Approve it');
    await until(request, id, (c) => c.statuses.some((s) => s.text === 'Tried to approve the plan.'));
    expect((await view(request, id)).steering?.plan?.approved).toBeNull();
    const said = await tell(request, id, 'ceo', '[fake:approve-plan-1] Yes, approve the plan');
    const approved = await until(request, id, (c) => c.steering?.plan?.approved);
    expect(approved).toMatchObject({ version: 1, by: 'ceo', cites: [said] });
    // Four plan tasks: the CEO's three and the final review the office adds at the end of the plan (p-4).
    const tasks = await until(request, id, (c) => c.tasks.filter((t) => t.planTask).length === 4 && c.tasks);
    expect(tasks.filter((t) => t.planTask).map((t) => t.planTask).sort()).toEqual(['p-1', 'p-2', 'p-3', 'p-4']);
    expect(tasks.find((t) => t.planTask === 'p-4')?.title).toBe('Final review of the whole result');
    const decision = await until(request, id, (c) => c.steering?.decisions.find((d) => d.kind === 'plan' && d.by === 'ceo' && /approved version 1/.test(d.what)));
    expect(decision.links.message).toBe(said);
    await open(page, `/c/${id}/plan`);
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await shot(page, 'h46-plan-by-talking', info);
    await open(page, `/c/${id}/decisions`);
    await shot(page, 'h46-decisions-after-talking', info);
    expect(errors).toEqual([]);
  });
});
