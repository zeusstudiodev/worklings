import { expect, type Page, test } from '@playwright/test';
import { api } from './v3-world.ts';
import { findAnAction, open, openMore, planVersions, running, setting, shot, tell, until, watchErrors } from './v3-kit.ts';

// H45 (AC22): the command palette. Ctrl+K at 1440 px and the Actions button at 375 px reach the actions by typing; the
// dialog, its search box, the list and its options carry names a screen reader reads, and the keyboard alone drives it.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `palette-${info.project.name}`);
  await setting(request, id, { planApproval: 'before-work' });
  await tell(request, id, 'ceo', '[fake:plan] Plan the watering flow');
  await until(request, id, (c) => planVersions(c) === 1);
  await api(request, `api/c/${id}/tasks`, { title: 'Sketch the empty state', brief: 'b', files: ['empty.md'], owner: 'ux-designer', doneWhen: 'd', milestone: null });
  await request.dispose();
});

/** Opens the palette the way the device does: Ctrl+K with a keyboard, More's Find an action on a phone. */
async function openPalette(page: Page, phone: boolean) {
  await open(page, `/c/${id}`);
  await expect(page.locator('canvas')).toBeVisible();
  if (phone) await findAnAction(page);
  else {
    await page.getByRole('main').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await page.keyboard.press('Control+k');
  }
  const dialog = page.getByRole('dialog', { name: 'Actions' });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('combobox');
  await expect(search).toBeFocused();
  return { dialog, search };
}

test.describe('the command palette', () => {
  test('opens with the device’s own way and names its dialog, search box and list', async ({ page }, info) => {
    const errors = watchErrors(page);
    const phone = info.project.name === 'v3-phone';
    const { dialog, search } = await openPalette(page, phone);
    await expect(search).toHaveAccessibleName(/./);
    await expect(dialog.getByRole('listbox', { name: 'Actions' })).toBeVisible();
    expect(await dialog.getByRole('option').count()).toBeGreaterThan(3);
    await shot(page, 'h45-palette-open', info);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus returns to where it was: More on a phone (Find an action closed it first), the page elsewhere.
    if (phone) await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused();
    // v0.2: More's Find an action reaches the same palette, with its shortcut named.
    await expect((await openMore(page)).getByRole('button', { name: /^Find an action/ })).toHaveAttribute('aria-keyshortcuts', /Control\+K|Meta\+K/);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('"message lea" sends a message by typing and Enter alone', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const { dialog, search } = await openPalette(page, info.project.name === 'v3-phone');
    await search.fill('message lea');
    await expect(dialog.getByRole('option', { name: /^Message Lea/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('textbox')).toBeFocused();
    await page.keyboard.type(`Lea, please check the empty state [palette-${info.project.name}]`);
    await shot(page, 'h45-palette-message', info);
    await page.keyboard.press('Enter');
    await until(request, id, (c) => c.messages.some((m) => m.to === 'ux-designer' && m.from === '@stakeholder' && m.text.includes(`[palette-${info.project.name}]`)));
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('"leash kai" changes a leash in two steps', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const { dialog, search } = await openPalette(page, info.project.name === 'v3-phone');
    await search.fill('leash kai');
    await expect(dialog.getByRole('option', { name: /Change Kai's leash/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await search.fill('checks');
    await expect(dialog.getByRole('listbox', { name: /Kai's leash/ })).toBeVisible();
    await shot(page, 'h45-palette-leash', info);
    await page.keyboard.press('Enter');
    await until(request, id, (c) => c.steering?.people['ui-designer']?.leash === 'check');
    // The result stays in view with Undo, which takes the change back.
    const toast = page.getByTestId('palette-toast');
    await expect(toast).toContainText('leash');
    await shot(page, 'web-fixes-palette-toast', info);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await until(request, id, (c) => c.steering?.people['ui-designer']?.leash !== 'check');
    // The button went with the toast; focus went to the view rather than falling to the page.
    await expect(toast).toBeHidden();
    await expect.poll(() => page.evaluate('document.activeElement !== null && document.activeElement !== document.body')).toBe(true);
    expect(errors).toEqual([]);
  });

  test('"pause" holds a task from the palette, and "resume" lets it go', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const phone = info.project.name === 'v3-phone';
    const { dialog, search } = await openPalette(page, phone);
    await search.fill('pause empty state');
    await expect(dialog.getByRole('option', { name: /Pause .*Sketch the empty state/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await until(request, id, (c) => c.tasks.find((t) => t.title === 'Sketch the empty state')?.paused);
    // What it did stays in view for about ten seconds, with Undo: its opposite call, which resumes the task.
    const toast = page.getByTestId('palette-toast');
    await expect(toast).toContainText('Paused');
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
    // Meanwhile Sam's leash changes through the hub, as another tab would change it: each change is a new snapshot, so
    // the toast's timer must not start over with each one; it goes when its time is up. (Which change its Undo takes
    // back is pinned by madeByCall's unit tests.)
    let flips = 0;
    await expect
      .poll(
        async () => {
          flips += 1;
          await setting(request, id, { leash: { person: 'frontend-engineer', leash: flips % 2 === 1 ? 'check' : null } });
          return toast.count();
        },
        { intervals: [1_500], timeout: 20_000 },
      )
      .toBe(0);
    if (flips % 2 === 1) await setting(request, id, { leash: { person: 'frontend-engineer', leash: null } });
    expect((await until(request, id, (c) => c.tasks.find((t) => t.title === 'Sketch the empty state')))?.paused).toBeTruthy();
    const again = await openPalette(page, phone);
    await again.search.fill('resume empty state');
    await expect(again.dialog.getByRole('option', { name: /Resume .*Sketch the empty state/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await until(request, id, (c) => c.tasks.find((t) => t.title === 'Sketch the empty state'))).paused ?? null).toBeNull();
    expect(errors).toEqual([]);
  });

  test('"approve" approves the plan that waits for you', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const { dialog, search } = await openPalette(page, info.project.name === 'v3-phone');
    await search.fill('approve plan');
    await expect(dialog.getByRole('option', { name: /^Approve the plan/ }).first()).toBeVisible();
    await shot(page, 'h45-palette-approve', info);
    await page.keyboard.press('Enter');
    await until(request, id, (c) => c.steering?.plan?.approved?.version === 1);
    expect(errors).toEqual([]);
  });
});
