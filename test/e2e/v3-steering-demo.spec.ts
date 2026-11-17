import { expect, test } from '@playwright/test';
import { origin, ports } from './addresses.ts';
import { boardFrame, card, column, findAnAction, layoutOf, moveMenu, shot, sidePanel, strip, talk, talkBox, theTo, titlesIn, watchErrors, showStrip } from './v3-kit.ts';

// "In the demo company" for each steering feature (checklist H39 to H46): the demo office's made-up café company holds
// the plan, messages and traces, the board, the decision log and the leashes, and the office's own steering actions
// work on its local data. Free of any hub and of Claude Code; what it shows is made up.
const demo = (path: string) => `${origin(ports().demo)}/c/demo${path ? `/${path}` : ''}`;

test.describe('every steering feature in the demo company', () => {
  test('the plan: version 3 shown as a diff against version 2, approved a milestone at a time', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(demo('plan'));
    await expect(page.getByRole('heading', { name: 'The plan', level: 3, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('What changed from version 2')).toBeVisible();
    // v0.2: the café's versions carry a checklist, so version 3 also adds the loyalty stamps' item and changes the one
    // the cut table cards covered.
    await expect(page.getByText('Added (3)')).toBeVisible();
    await expect(page.getByText('To the checklist: “A guest\'s tenth coffee is free with loyalty stamps.”.')).toBeVisible();
    await expect(page.getByText('Cut (1)')).toBeVisible();
    await expect(page.getByText('Changed (2)')).toBeVisible();
    await expect(page.getByText('Moved (1)')).toBeVisible();
    await shot(page, 'demo-plan-diff', info);
    await page.getByRole('button', { name: 'Approve “Pickup orders work”' }).click();
    await expect(page.getByText(/You approved version 3/).first()).toBeVisible();
    await shot(page, 'demo-plan-approved', info);
    expect(errors).toEqual([]);
  });

  test('the board: a move in line from Move, and the paused task resumed from its page', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(demo('tasks'));
    const board = boardFrame(page, 'Tasks');
    await expect(board.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible({ timeout: 30_000 });
    // Mina's paused task is in Paused.
    if (info.project.name.includes('phone')) await board.getByRole('tab', { name: /^Paused\b/ }).click();
    await expect(card(column(board, 'Paused'), 'Slot picker visuals')).toBeVisible();
    if (info.project.name.includes('phone')) await board.getByRole('tab', { name: /^Working\b/ }).click();
    const [first] = await titlesIn(column(board, 'Working'));
    if (!first) throw new Error('Nobody is at work in the demo café.');
    const menu = await moveMenu(page, first);
    await menu.getByRole(info.project.name.includes('phone') ? 'button' : 'menuitem', { name: 'Down', exact: true }).click();
    await expect(board.getByText(new RegExp(`^Moved “${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}”`)).first()).toBeVisible();
    await shot(page, 'demo-board-priority', info);
    await page.goto(demo('tasks?panel=tasks/t-25'));
    const panel = sidePanel(page);
    await expect(panel.getByRole('button', { name: 'Resume', exact: true })).toBeVisible({ timeout: 30_000 });
    await shot(page, 'demo-task-paused', info);
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a message that stalled: the trace flags it, and Remind reaches Ada', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(demo('messages/m-19'));
    await expect(page.getByRole('heading', { name: 'Where it stalls' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Not passed on to Mina yet.')).toBeVisible();
    await shot(page, 'demo-trace-flag', info);
    await page.getByRole('button', { name: 'Remind Ada', exact: true }).click();
    await expect(page.locator('.trace-flag__note', { hasText: 'Reminded Ada.' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a message to everyone from the talk bar shows in the strip', async ({ page }, info) => {
    const errors = watchErrors(page);
    // v0.8: the strip is off by default; this test is about it, so it shows it.
    await showStrip(page);
    // The composer's old address opens the office with everyone as the To and focus in the talk bar.
    await page.goto(demo('send/everyone'));
    await expect(theTo(page)).toHaveAccessibleName(/^To (everyone|all hands)/i, { timeout: 30_000 });
    await expect(talkBox(page)).toBeFocused();
    await talk(page, null, 'Demo day is Friday at five.');
    await expect(talkBox(page)).toHaveAccessibleDescription(/^Sent\./);
    // A phone's strip gives way to the hint while the box has focus.
    if (layoutOf(page).phone) await talkBox(page).blur();
    await expect(strip(page)).toContainText('Demo day is Friday at five.');
    await shot(page, 'demo-send-everyone', info);
    expect(errors).toEqual([]);
  });

  test('the decision log: every kind, filters, Undo and Reconsider', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(demo('decisions'));
    await expect(page.getByText('26 decisions, newest first.')).toBeVisible({ timeout: 30_000 });
    await shot(page, 'demo-decisions', info);
    await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Leashes (3)' });
    await expect(page.locator('[data-decision]')).toHaveCount(3);
    await shot(page, 'demo-decisions-filtered', info);
    await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Every kind' });
    await page.getByLabel('Who', { exact: true }).selectOption({ label: 'Mara, CEO (7)' });
    await expect(page.locator('[data-decision]')).toHaveCount(7);
    await page.getByLabel('Who', { exact: true }).selectOption({ label: 'Anyone' });
    await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Settings (4)' });
    // A row opens in the side panel, the log with that decision in focus, where its Undo and Reconsider are.
    await page.locator('[data-decision]').filter({ hasText: 'You set eight desks at once.' }).getByRole('link').click();
    await sidePanel(page).locator('[data-decision]').filter({ hasText: 'You set eight desks at once.' }).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByText(/Undone/).first()).toBeVisible();
    const entry = sidePanel(page).locator('[data-decision]').filter({ hasText: 'The CEO' }).filter({ has: page.getByRole('button', { name: 'Reconsider', exact: true }) }).first();
    await entry.getByRole('button', { name: 'Reconsider', exact: true }).click();
    await page.getByRole('textbox', { name: /What should .* reconsider\?/ }).fill('Please look at it once more.');
    await page.getByRole('button', { name: /^Send to / }).click();
    await expect(page.getByText('Where it went').first()).toBeVisible();
    await shot(page, 'demo-decisions-reconsidered', info);
    expect(errors).toEqual([]);
  });

  test('the leash: badges on the people, "checks with you" on Lena by talking, and a change from a panel', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(demo('org'));
    // On the chart a node's name ends with its leash.
    await expect(page.getByRole('treeitem', { name: /Trusted\./ }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('treeitem', { name: /Checks with you\./ }).first()).toBeVisible();
    await shot(page, 'demo-leash-badges', info);
    await page.goto(demo('people/ui-designer'));
    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByLabel('Leash', { exact: true }).selectOption('check');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/checks with you before each new task/i).first()).toBeVisible();
    await shot(page, 'demo-leash-change', info);
    expect(errors).toEqual([]);
  });

  test("the command palette: Ctrl+K at desktop width, More's Find an action on a phone", async ({ page }, info) => {
    const errors = watchErrors(page);
    const phone = info.project.name === 'v3-phone';
    await page.goto(demo(''));
    await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible({ timeout: 30_000 });
    if (phone) await findAnAction(page);
    else await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Actions' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('approve');
    await expect(dialog.getByRole('option', { name: /Approve .*plan/ }).first()).toBeVisible();
    await shot(page, 'demo-palette', info);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('the CEO’s own steering shows in the log "as you asked", citing the message', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(demo('decisions'));
    await expect(page.getByText(/as you asked/).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, 'demo-by-talking', info);
    expect(errors).toEqual([]);
  });
});
