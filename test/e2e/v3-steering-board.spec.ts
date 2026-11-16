import { expect, test } from '@playwright/test';
import { boardFrame, deskTurns, openBoard, openPanel, running, setting, shot, sidePanel, until, watchErrors } from './v3-kit.ts';
import { api, view } from './v3-world.ts';

// H42 (AC19): steering a task from its page in the side panel, beside the task board: pause and resume, cancel with a
// reason, reassign with a note, and a task made in the office. That a drag on the board sets the order work is handed
// out in is in v3-task-board.spec.ts.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `board-${info.project.name}`);
  await setting(request, id, { maxDesks: 1 });
  await request.dispose();
});

const newTask = (title: string, owner: string, file: string) => ({ title, brief: `Do ${title}`, files: [file], owner, doneWhen: 'It is done', milestone: null });

/** A task's page in the side panel, over the task board. */
const openTask = (page: import('@playwright/test').Page, task: string) => openPanel(page, id, `tasks/${task}`, { main: 'tasks' });

test.describe('a task in the side panel', () => {
  test('pause holds a task and resume lets it go', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const t = (await api<{ id: string }>(request, `api/c/${id}/tasks`, newTask('Pause me', 'backend-engineer', 'pause.md'))).body;
    const panel = await openTask(page, t.id);
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await until(request, id, (c) => c.tasks.find((x) => x.id === t.id)?.paused);
    await expect(panel.getByText(/Its turns are held until it resumes/)).toBeVisible();
    await shot(page, 'h42-task-paused', info);
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(async () => (await view(request, id)).tasks.find((x) => x.id === t.id)?.paused ?? null).toBeNull();
    await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('cancel needs a reason and the work stays on a branch', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const t = (await api<{ id: string }>(request, `api/c/${id}/tasks`, newTask('Cancel me', 'qa-engineer', 'cancel.md'))).body;
    const panel = await openTask(page, t.id);
    await panel.getByRole('button', { name: 'Cancel the task', exact: true }).click();
    await panel.getByRole('button', { name: 'Cancel the task', exact: true }).last().click();
    // An empty reason is not sent.
    expect((await view(request, id)).tasks.find((x) => x.id === t.id)?.cancel ?? null).toBeNull();
    await panel.getByRole('textbox', { name: 'Why (they read it)' }).fill('The streak card replaces it.');
    await shot(page, 'h42-cancel-form', info);
    await panel.getByRole('button', { name: 'Cancel the task', exact: true }).last().click();
    const cancelled = await until(request, id, (c) => c.tasks.find((x) => x.id === t.id)?.cancel);
    expect(cancelled.reason).toBe('The streak card replaces it.');
    expect(cancelled.by).toBe('@stakeholder');
    expect((await view(request, id)).tasks.find((x) => x.id === t.id)?.status).toBe('dropped');
    await expect(panel.getByText(/Cancelled|cancelled/).first()).toBeVisible();
    await shot(page, 'h42-task-cancelled', info);
    expect(errors).toEqual([]);
  });

  test('reassign hands the task and a note to someone else', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const t = (await api<{ id: string }>(request, `api/c/${id}/tasks`, newTask('Hand me over', 'frontend-engineer', 'handover.md'))).body;
    const panel = await openTask(page, t.id);
    await panel.getByRole('button', { name: 'Reassign', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Who takes it over' }).selectOption('backend-engineer');
    await panel.getByRole('textbox', { name: 'A handover note (optional)' }).fill(`Sam started the layout; keep the card round [handover-note-${info.project.name}]`);
    await shot(page, 'h42-reassign-form', info);
    await panel.getByRole('button', { name: 'Reassign to Ivo', exact: true }).click();
    const task = await until(request, id, (c) => c.tasks.find((x) => x.id === t.id && x.owner === 'backend-engineer'));
    expect(task.handovers?.at(-1)).toMatchObject({ from: 'frontend-engineer', to: 'backend-engineer', note: `Sam started the layout; keep the card round [handover-note-${info.project.name}]` });
    await expect(panel.getByRole('heading', { name: 'Handovers' })).toBeVisible();
    // The new owner is handed the brief and the note.
    await expect.poll(() => deskTurns(`[handover-note-${info.project.name}]`).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await shot(page, 'h42-task-reassigned', info);
    expect(errors).toEqual([]);
  });

  test('a task made in the office reaches its owner and their head is told', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const frame = await openBoard(page, id, 'tasks');
    // Add a task in the board's head opens its form in the side panel (?panel=tasks/new).
    await frame.getByRole('link', { name: 'Add a task', exact: true }).or(frame.getByRole('button', { name: 'Add a task', exact: true })).first().click();
    const panel = sidePanel(page);
    await panel.getByLabel('Title (required)', { exact: true }).fill('Write the empty state');
    await panel.getByLabel('Who does it', { exact: false }).selectOption('ux-designer');
    await panel.getByLabel('Brief', { exact: false }).fill('Words for a plant list with no plants [new-brief]');
    await panel.getByLabel('Files it may change, one per line', { exact: false }).fill('design/empty.md');
    await panel.getByLabel('Done when', { exact: false }).fill('The words exist.');
    await shot(page, 'h42-add-task', info);
    await panel.getByRole('button', { name: 'Add the task', exact: true }).click();
    const made = await until(request, id, (c) => c.tasks.find((x) => x.title === 'Write the empty state'));
    expect(made).toMatchObject({ owner: 'ux-designer', askedBy: '@stakeholder', files: ['design/empty.md'] });
    // The owner's head hears of it.
    await until(request, id, (c) => c.messages.some((m) => m.to === 'head-of-design' && m.text.includes('Write the empty state')));
    await expect(boardFrame(page, 'Tasks').getByRole('link', { name: 'Write the empty state', exact: true })).toBeVisible();
    await shot(page, 'h42-task-added', info);
    expect(errors).toEqual([]);
  });
});
