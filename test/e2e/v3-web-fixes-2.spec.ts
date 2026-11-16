import { expect, test } from '@playwright/test';
import { focusTop, hiddenFocus, layoutOf, openBoard, openCompany, openPanel, panelTitle, running, sendKey, shot, sidePanel, talkBar, talkBox, theTo, watchErrors } from './v3-kit.ts';
import { api } from './v3-world.ts';

// The second half of the web fixes from the design, accessibility and web code gates, moved into the stage and dock:
// focus after a press in a task's page (the control that was pressed is gone, so focus goes to what replaced it), the
// forms' required marks, the talk bar's To and its Send on a phone, focus never under the talk bar while tabbing through
// a person's details, a skip link the company bar doesn't hide, and Escape in the Company menu.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `webfix2-${info.project.name}`);
  await request.dispose();
});

const newTask = (title: string, owner: string, file: string) => ({ title, brief: `Do ${title}`, files: [file], owner, doneWhen: 'It is done', milestone: null });

test.describe('focus after a press', () => {
  test('Pause hands focus to the state line, Resume to Pause, Cancel to its line and Undo back to the controls', async ({ page, request }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const t = (await api<{ id: string }>(request, `api/c/${id}/tasks`, newTask('Focus me', 'backend-engineer', 'focus.md'))).body;
    const panel = await openPanel(page, id, `tasks/${t.id}`, { main: 'tasks' });
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(panel.locator('[data-steer="paused"]')).toBeFocused();
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Cancel the task', exact: true }).click();
    await panel.getByLabel('Why (they read it)').fill('Not needed any more');
    await panel.getByRole('button', { name: 'Cancel the task', exact: true }).last().click();
    await expect(panel.locator('[data-steer="cancelled"]')).toBeFocused();
    await panel.getByRole('button', { name: 'Undo the cancel' }).click();
    await expect(panel.locator('.task-steer__actions button').first()).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('an error in the cancel form sits outside its label and is described by it', async ({ page, request }) => {
    const t = (await api<{ id: string }>(request, `api/c/${id}/tasks`, newTask('Describe me', 'qa-engineer', 'describe.md'))).body;
    const panel = await openPanel(page, id, `tasks/${t.id}`, { main: 'tasks' });
    await panel.getByRole('button', { name: 'Cancel the task', exact: true }).click();
    await panel.getByRole('button', { name: 'Cancel the task', exact: true }).last().click();
    const why = panel.getByLabel('Why (they read it)');
    await expect(why).toHaveAttribute('aria-invalid', 'true');
    await expect(panel.locator('label', { hasText: 'Why (they read it)' })).not.toContainText('Say why');
    await expect(why).toHaveAccessibleDescription(/Say why/);
  });

  test('Save in the leash controls hands focus to the line with Undo, and an Undo to the select it put back', async ({ page }) => {
    const errors = watchErrors(page);
    const panel = await openPanel(page, id, 'people/ui-designer');
    await panel.getByRole('button', { name: 'Details' }).click();
    await panel.getByLabel('Leash', { exact: true }).selectOption('trusted');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    const undo = panel.locator('.leash-controls .undo-line__undo');
    await expect(undo).toBeFocused();
    await undo.click();
    await expect(panel.getByLabel('Leash', { exact: true })).toBeFocused();
    // No Undo waits disabled after an Undo.
    await expect(panel.locator('.leash-controls .undo-line__undo')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('forms and the talk bar', () => {
  test('Add a task marks what is required before anything is sent', async ({ page }, info) => {
    const board = await openBoard(page, id, 'tasks');
    await board.getByRole('link', { name: 'Add a task', exact: true }).or(board.getByRole('button', { name: 'Add a task', exact: true })).first().click();
    await expect(panelTitle(page)).toHaveText('Add a task');
    const panel = sidePanel(page);
    for (const name of ['Title (required)', 'Who does it (required)', 'Brief (required)', 'Done when (required)']) await expect(panel.getByLabel(name, { exact: true })).toHaveAttribute('aria-required', 'true');
    await expect(panel.getByLabel('Files it may change, one per line (optional)')).toBeVisible();
    await shot(page, 'web-fixes-2-add-task', info);
  });

  test('the talk bar does not start on everyone: its To is the CEO', async ({ page }, info) => {
    await openCompany(page, id);
    await expect(theTo(page)).toHaveAccessibleName('To Noor, CEO');
    await expect(talkBox(page)).not.toHaveAccessibleName(/everyone/i);
    await shot(page, 'web-fixes-2-talk-bar', info);
  });
});

test.describe('tapping Send on a phone', () => {
  // The old composer's sheet grew while its box had focus and shrank when it lost it, so a press on Send moved the
  // button from under the finger. The talk bar stays at the foot: a tap on Send right after the page opens sends.
  test('a tap on Send right after the page opens sends, every time', async ({ page }, info) => {
    test.skip(info.project.name !== 'v3-phone', 'Taps are a phone matter.');
    for (let i = 0; i < 6; i++) {
      await openCompany(page, id);
      await talkBox(page).fill(`Tap test ${i} [tap-${i}]`);
      await sendKey(page).tap();
      await expect(talkBox(page), `tap ${i}`).toHaveValue('');
      await expect(talkBox(page), `tap ${i}`).toHaveAccessibleDescription(/^Sent\./);
    }
  });
});

test.describe('the person in the side panel', () => {
  test("Tab through a person's details never leaves focus under the talk bar", async ({ page }, info) => {
    const errors = watchErrors(page);
    const panel = await openPanel(page, id, 'people/ui-designer');
    await panel.getByRole('button', { name: 'Details' }).click();
    await panelTitle(page).focus();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await hiddenFocus(page), `Tab stop ${i}`).toBeNull();
    }
    await shot(page, 'web-fixes-2-person-tab', info);
    expect(errors).toEqual([]);
  });

  test('in a short window a field in the sheet keeps its room: the talk bar steps aside while it has focus', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    const panel = await openPanel(page, id, 'people/ui-designer');
    expect(layoutOf(page).short).toBe(true);
    await panel.getByRole('button', { name: 'Details' }).click();
    const model = panel.getByLabel('Model', { exact: true });
    await model.focus();
    expect(await hiddenFocus(page)).toBeNull();
    await expect(talkBar(page)).toBeHidden();
  });
});

test.describe('the company bar and the skip links', () => {
  test('"Skip to the talk bar" shows over the company bar when it has focus', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Checked where the bar and the side panel are both on screen.');
    await openCompany(page, id);
    await focusTop(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to the talk bar' });
    await expect(skip).toBeFocused();
    expect(await hiddenFocus(page)).toBeNull();
    await shot(page, 'web-fixes-2-skip', info);
  });

  test('Escape closes More with focus on its button, from the button as from the menu', async ({ page }) => {
    await openCompany(page, id);
    const button = page.getByRole('button', { name: 'More', exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
    await button.click();
    await page.getByRole('button', { name: 'Settings', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });
});
