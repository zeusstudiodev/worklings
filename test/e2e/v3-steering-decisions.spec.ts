import { expect, test } from '@playwright/test';
import { open, running, setting, shot, sidePanel, tell, until, watchErrors } from './v3-kit.ts';
import { api, view } from './v3-world.ts';

// H43 (AC20): the decision log from several sources (a setting, a task cancelled, a call a person recorded), its filters
// by person, room and kind, Undo for what can be taken back, and Reconsider, which sends the decision back with a note.
test.describe.configure({ mode: 'serial' });

let id = '';
/** How many desks the company had before the setting the log undoes: the spending plan's (Balanced: five), not always eight. */
let desksBefore = 0;
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `decisions-${info.project.name}`);
  desksBefore = (await view(request, id)).settings.maxDesks;
  await setting(request, id, { maxDesks: 6 });
  const task = (await api<{ id: string }>(request, `api/c/${id}/tasks`, { title: 'Cancel me', brief: 'b', files: ['c.md'], owner: 'qa-engineer', doneWhen: 'd', milestone: null })).body;
  await api(request, `api/c/${id}/tasks/${task.id}/cancel`, { reason: 'Not needed.' });
  await tell(request, id, 'ceo', '[fake:decide] Which icon for the streak card?');
  await until(request, id, (c) => (c.steering?.decisions ?? []).some((d) => d.kind === 'decide'));
  await request.dispose();
});

test.describe('the decision log', () => {
  test('lists each source with who, why and the options weighed, newest first', async ({ page }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/decisions`);
    // Four from this spec's own sources, and the setting running() makes to turn plan approval off before Start.
    await expect(page.getByText('Five decisions, newest first.')).toBeVisible();
    await expect(page.getByText('You set plan approval to “Off”.')).toBeVisible();
    const call = page.getByRole('listitem').filter({ hasText: 'The streak card uses a flame, not a leaf.' });
    await expect(call).toContainText('Users read a flame as a streak at a glance.');
    await expect(page.getByText('You set 6 desks at once.')).toBeVisible();
    await expect(page.getByText('You cancelled “Cancel me”: Not needed.')).toBeVisible();
    // A row on the board is the short form; it opens in the side panel whole, with the options weighed and where it came from.
    await call.getByRole('link', { name: 'The streak card uses a flame, not a leaf.' }).click();
    const whole = sidePanel(page);
    await expect(whole).toContainText('Users read a flame as a streak at a glance.');
    await expect(whole).toContainText('A leaf');
    await expect(whole).toContainText('A number only');
    await expect(whole.getByRole('link', { name: /message/i })).toBeVisible();
    await shot(page, 'h43-decisions', info);
    expect(errors).toEqual([]);
  });

  test('filters by person, by room and by kind', async ({ page }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/decisions`);
    const entries = page.locator('[data-decision]');
    await expect(entries).toHaveCount(5);
    await page.getByLabel('Who', { exact: true }).selectOption({ label: 'Noor, CEO (1)' });
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('The streak card uses a flame');
    await shot(page, 'h43-filter-person', info);
    await page.getByLabel('Who', { exact: true }).selectOption({ label: 'Anyone' });
    await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Tasks (2)' });
    await expect(entries).toHaveCount(2);
    await expect(page.getByText('You set 6 desks at once.')).toHaveCount(0);
    await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Every kind' });
    await page.getByLabel('Room', { exact: true }).selectOption({ label: 'Direction (1)' });
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('The streak card uses a flame');
    await shot(page, 'h43-filter-room', info);
    expect(errors).toEqual([]);
  });

  test('Undo takes a setting back, and the undo is an entry of its own', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/decisions`);
    // A row opens in the side panel, the log with that decision in focus, where its Undo is.
    await page.locator('[data-decision]').filter({ hasText: 'You set 6 desks at once.' }).getByRole('link').click();
    await sidePanel(page).locator('[data-decision]').filter({ hasText: 'You set 6 desks at once.' }).getByRole('button', { name: 'Undo', exact: true }).click();
    expect(desksBefore).not.toBe(6);
    await until(request, id, (c) => c.settings.maxDesks === desksBefore);
    await expect(page.getByText(/Undone/).first()).toBeVisible();
    const log = (await view(request, id)).steering?.decisions ?? [];
    expect(log.some((d) => d.kind === 'undo')).toBe(true);
    expect(log.find((d) => d.what.includes('6 desks'))?.undone).not.toBeNull();
    await shot(page, 'h43-undo', info);
    expect(errors).toEqual([]);
  });

  test('Reconsider sends the decision back to the CEO with a note', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await open(page, `/c/${id}/decisions`);
    await page.locator('[data-decision]').filter({ hasText: 'The streak card uses a flame' }).getByRole('link').click();
    await sidePanel(page).locator('[data-decision]').filter({ hasText: 'The streak card uses a flame' }).getByRole('button', { name: 'Reconsider', exact: true }).click();
    await page.getByRole('textbox', { name: /What should .* reconsider\?/ }).fill('Try the leaf in the dark theme before you settle.');
    await shot(page, 'h43-reconsider-form', info);
    await page.getByRole('button', { name: /^Send to / }).click();
    const decision = await until(request, id, (c) => c.steering?.decisions.find((d) => d.what.includes('flame') && d.reconsider));
    expect(decision.reconsider?.note).toBe('Try the leaf in the dark theme before you settle.');
    await until(request, id, (c) => c.messages.some((m) => m.id === decision.reconsider?.message && m.to === 'ceo' && m.text.includes('Try the leaf in the dark theme')));
    await expect(sidePanel(page).locator(`[data-decision="${decision.id}"]`)).toContainText('Where it went');
    await shot(page, 'h43-reconsidered', info);
    expect(errors).toEqual([]);
  });
});
