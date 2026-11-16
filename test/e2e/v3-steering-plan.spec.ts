import { expect, test } from '@playwright/test';
import { STAKEHOLDER } from '../../src/core/company.ts';
import { companyAddress, expectAddress, layoutOf, open, openCompany, planVersions, running, setting, shot, sheetUp, sidePanel, tell, until, watchErrors } from './v3-kit.ts';
import { view } from './v3-world.ts';

// H39 (AC16): the CEO's plan, edited and approved in the office, revised by the CEO and shown as a diff, with the gate:
// no task of an unapproved plan starts. Plan approval is turned on first: the product default is off for now.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `plan-${info.project.name}`);
  await setting(request, id, { planApproval: 'before-work' });
  await request.dispose();
});

test.describe('the plan', () => {
  test('a plan waiting for approval starts no task, even when the CEO tries to assign one', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tell(request, id, 'ceo', '[fake:plan] Plan the watering flow');
    await until(request, id, (c) => planVersions(c) === 1);
    // The CEO then tries to hand out the plan's first task anyway; the company refuses it.
    await tell(request, id, 'ceo', '[fake:assign] Start Lea on the sketch now');
    // The scenario's status line comes after its assign step, so once it is there the assign has been tried.
    await until(request, id, (c) => c.statuses.some((st) => st.text === 'Planning the watering flow with Lea.'));
    expect((await view(request, id)).tasks).toEqual([]);
    expect((await view(request, id)).steering?.plan?.approved).toBeNull();
    await open(page, `/c/${id}/plan`);
    await expect(page.getByRole('heading', { name: 'The plan', level: 3, exact: true })).toBeVisible();
    await expect(page.getByText('Waits for you').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve the plan', exact: true })).toBeVisible();
    await shot(page, 'h39-plan-waiting', info);
    expect(errors).toEqual([]);
  });

  test('a plan waiting for approval is the first thing in the inbox, on a desktop and on a phone', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    // The inbox is the side panel's home: beside the office on a desktop, a sheet a phone brings up.
    await openCompany(page, id);
    await expectAddress(page, companyAddress(id));
    await sheetUp(page);
    const needs = sidePanel(page).getByRole('region', { name: 'Needs you' });
    await expect(needs).toContainText("The CEO's plan waits for your approval.");
    // The count sentence is the side panel's head's, above the region.
    // A phone's head says the headline's sentences instead ("The CEO's plan waits for your approval."), checked above.
    if (!layoutOf(page).phone) await expect(sidePanel(page)).toContainText('One needs you');
    await shot(page, 'web-fixes-plan-in-inbox', info);
    await needs.getByRole('link', { name: 'Open the plan' }).click();
    await expect(page.getByRole('heading', { name: 'The plan', level: 3, exact: true })).toBeVisible();
    expect((await view(request, id)).inbox).toBe(1);
    expect(errors).toEqual([]);
  });

  test('editing a task shows what changes, saves a new version that starts no task', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/plan`);
    await page.getByRole('button', { name: 'Build the streak card', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Build the streak card', exact: true }).click();
    const title = page.getByRole('textbox', { name: 'Title' });
    await title.fill('Build the streak card with a flame');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your changes' })).toBeVisible();
    await page.getByText('See what changes').click();
    await expect(page.getByText('Build the streak card with a flame').first()).toBeVisible();
    await shot(page, 'h39-plan-edit-diff', info);
    await page.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(page.getByText('Saved as a new version.')).toBeVisible();
    const saved = await until(request, id, (c) => c.steering?.plan?.versions.at(-1)?.version === 2 && c.steering.plan.versions.at(-1));
    expect(saved?.by).toBe(STAKEHOLDER);
    expect(saved?.plan.tasks.find((t) => t.id === 'p-2')?.title).toBe('Build the streak card with a flame');
    expect((await view(request, id)).tasks).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a comment on the plan reaches the CEO as a message', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/plan`);
    await page.getByRole('button', { name: 'Comment on the plan', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your comment' }).fill('Please keep the first milestone small.');
    await page.getByRole('button', { name: 'Send to the CEO' }).click();
    await until(request, id, (c) => c.messages.some((m) => m.to === 'ceo' && m.text.includes('Please keep the first milestone small.')));
    await until(request, id, (c) => (c.steering?.plan?.comments ?? []).length === 1);
    await shot(page, 'h39-plan-comment', info);
    expect(errors).toEqual([]);
  });

  test('asking the CEO to revise it brings a new version, shown as a diff against the one before', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tell(request, id, 'ceo', '[fake:plan-v2] Revise it: the streak card needs a flame, and the German listing comes first');
    await until(request, id, (c) => planVersions(c) === 3);
    await open(page, `/c/${id}/plan`);
    await expect(page.getByText('Version 3').first()).toBeVisible();
    await expect(page.getByText('What changed from version 2')).toBeVisible();
    await expect(page.getByText('Added (1)')).toBeVisible();
    await expect(page.getByText('Cut (1)')).toBeVisible();
    // Three changed: the milestone's title, the final review (the office's), which now waits for the German listing,
    // and the checklist item that listing covers.
    await expect(page.getByText('Changed (3)')).toBeVisible();
    await expect(page.getByText('The milestone “Store listing in two languages”.')).toBeVisible();
    await expect(page.getByText('“Final review of the whole result”: what it waits for.')).toBeVisible();
    await expect(page.getByText('The checklist item “The app has a store listing in English and German.”.')).toBeVisible();
    await expect(page.getByText('“Draft the German listing”, for Kai')).toBeVisible();
    await shot(page, 'h39-plan-revised-diff', info);
    expect(errors).toEqual([]);
  });

  test('approving the revised plan makes the task tree and hands the first tasks out', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/plan`);
    await page.getByRole('button', { name: 'Approve the plan', exact: true }).click();
    await until(request, id, (c) => c.steering?.plan?.approved?.version === 3);
    // Four tasks: the plan's three and the office's final review (p-4), which waits for them all.
    const tasks = await until(request, id, (c) => c.tasks.length === 4 && c.tasks);
    expect(tasks.map((t) => t.planTask).sort()).toEqual(['p-1', 'p-2', 'p-4', 'p-5']);
    // p-1 and p-5 wait for nothing, so they start; p-2 waits for p-1.
    await expect.poll(async () => (await view(request, id)).tasks.find((t) => t.planTask === 'p-1')?.status, { timeout: 60_000 }).not.toBe('queued');
    await open(page, `/c/${id}/plan`);
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await shot(page, 'h39-plan-approved', info);
    expect(errors).toEqual([]);
  });
});

// v0.2: the plan's checklist, edited before approval like any other part of the plan: an item's sentence and what covers
// it changed, one of yours added, one removed, all in one draft saved as a new version, which starts no task.
test.describe("the plan's checklist", () => {
  test('edit, add and remove items, then save them as a new version', async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const listId = await running(request, `plan-list-${info.project.name}`, { planApproval: 'before-work' });
    // The CEO's start turn proposes the plan with its checklist.
    await until(request, listId, (c) => planVersions(c) === 1);
    await open(page, `/c/${listId}/plan`);
    const list = page.getByRole('region', { name: 'The checklist' });
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list).toContainText('“watering streaks”');
    await expect(list).toContainText('Covered by “Sketch the watering flow”, “Build the streak card”');

    // Edit: its sentence, and one task fewer that covers it. Your words stay as you wrote them.
    await list.getByRole('button', { name: 'Edit A plant can be watered and its streak grows.', exact: true }).click();
    await list.getByLabel('What should be true when it is done').fill('A plant can be watered twice a day and its streak grows.');
    await expect(list.getByText('Your words, as you wrote them:')).toBeVisible();
    await list.getByRole('button', { name: /^Remove Sketch the watering flow from what covers it$/ }).click();
    await list.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(list).toContainText('A plant can be watered twice a day and its streak grows.');

    // Add one of yours, covered by the streak card.
    await list.getByRole('button', { name: 'Add something you asked for', exact: true }).click();
    await list.getByLabel('What should be true when it is done').fill('A reminder arrives at seven in the morning.');
    // Picked as a person picks, focus on the list first. On a phone the plan's "Not saved" bar used to come back over Add
    // the moment a field let go, and the press went nowhere; it now waits while a form is open.
    const pick = list.getByLabel('A task that covers it');
    await pick.focus();
    await pick.selectOption({ label: 'Build the streak card' });
    await list.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(list.getByRole('button', { name: 'Remove Build the streak card from what covers it' })).toBeVisible();
    await list.getByRole('button', { name: 'Add it', exact: true }).click();
    await expect(list).toContainText('A reminder arrives at seven in the morning.');

    // Remove one.
    await list.getByRole('button', { name: 'Remove The app has a store listing in English and German.', exact: true }).click();
    // Gone from the list, with Undo in its place.
    await expect(list.getByRole('button', { name: 'Edit The app has a store listing in English and German.', exact: true })).toHaveCount(0);
    await expect(list).toContainText('Took “The app has a store listing in English and German.” off the checklist.');
    await expect(list.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await shot(page, 'plan-checklist-draft', info);

    await expect(page.getByRole('heading', { name: 'Your changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Save as a new version' }).click();
    await expect(page.getByText('Saved as a new version.')).toBeVisible();
    const saved = await until(request, listId, (c) => c.steering?.plan?.versions.at(-1)?.version === 2 && c.steering.plan.versions.at(-1));
    expect(saved?.by).toBe(STAKEHOLDER);
    expect(saved?.plan.checklist).toEqual([
      { id: 'k-1', text: 'A plant can be watered twice a day and its streak grows.', quote: 'watering streaks', covers: ['p-2'] },
      { id: 'k-s1', text: 'A reminder arrives at seven in the morning.', quote: null, covers: ['p-2'] },
    ]);
    expect((await view(request, listId)).tasks).toEqual([]);

    // The version says what changed in its checklist.
    await open(page, `/c/${listId}/plan`);
    await expect(page.getByText('What changed from version 1')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('To the checklist: “A reminder arrives at seven in the morning.”.')).toBeVisible();
    await expect(page.getByText('From the checklist: “The app has a store listing in English and German.”.')).toBeVisible();
    await expect(page.getByText('The checklist item “A plant can be watered twice a day and its streak grows.”.')).toBeVisible();
    await shot(page, 'plan-checklist-saved', info);
    expect(errors).toEqual([]);
  });
});
