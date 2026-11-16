import { expect, type Page, test } from '@playwright/test';
import { dollars } from '../../web/src/lib/format.ts';
import { boardFrame, open, running, shot, watchErrors } from './v3-kit.ts';
import { say, view } from './v3-world.ts';

// One company for the file: its goal, tasks, spend and statuses are what the built-in dashboards must agree with.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(180_000);
  const request = await playwright.request.newContext();
  id = await running(request, `boards-${info.project.name}`);
  await say(request, id, 'ceo', '[fake:goal] Set the goal');
  await say(request, id, 'head-of-design', '[fake:assign] Plan the watering flow');
  await say(request, id, 'ui-designer', '[fake:busy] Start on the palette');
  await expect
    .poll(
      async () => {
        const company = await view(request, id);
        return [company.goal?.milestones.length, company.tasks.length, company.statuses.length > 0, company.spend.samples.length >= 3];
      },
      { timeout: 90_000 },
    )
    .toEqual([2, 1, true, true]);
  await request.dispose();
});

/** Picks a dashboard the way the window offers it: the rail's link where it fits, the Dashboard select where it doesn't. */
const pick = async (page: Page, board: string) => {
  const frame = boardFrame(page, 'Dashboards');
  const select = frame.getByRole('combobox', { name: 'Dashboard' });
  const link = frame.getByRole('navigation', { name: 'Dashboards' }).getByRole('link', { name: board, exact: true });
  await expect(select.or(link)).toBeVisible();
  if (await select.isVisible()) await select.selectOption({ label: board });
  else await link.click();
};

test.describe('dashboards', () => {
  test('Progress agrees with the goal, the tasks and the inbox', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const company = await view(request, id);
    await open(page, `/c/${id}/dashboards`);
    const panel = boardFrame(page, 'Dashboards');
    await expect(panel.getByRole('heading', { name: 'Progress', level: 3 })).toBeVisible();
    const done = company.tasks.filter((t) => t.status === 'done').length;
    await expect(panel.getByText(`${done} of ${company.tasks.length}`, { exact: true })).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Goal' })).toContainText(company.goal?.text ?? 'no goal');
    const milestones = panel.getByRole('list', { name: 'Milestones' });
    await expect(milestones.getByRole('listitem')).toHaveCount(company.goal?.milestones.length ?? -1);
    for (const m of company.goal?.milestones ?? []) await expect(milestones).toContainText(m.title);
    await expect(panel.getByRole('region', { name: 'Tasks done per room' })).toContainText('Design');
    await shot(page, 'dashboard-progress', info);
    expect(errors).toEqual([]);
  });

  test('Spend adds up what the office recorded, and names who spent it', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const company = await view(request, id);
    const total = company.spend.byPerson.reduce((sum, p) => sum + p.all, 0);
    expect(total).toBeGreaterThan(0);
    await open(page, `/c/${id}/dashboards`);
    await pick(page, 'Spend');
    const panel = boardFrame(page, 'Dashboards');
    await panel.getByRole('button', { name: 'All' }).click();
    await expect(panel.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByText(dollars(total), { exact: true }).first()).toBeVisible();
    const table = panel.getByRole('table');
    for (const row of company.spend.byPerson.filter((p) => p.all > 0)) {
      const who = company.people.find((p) => p.id === row.person);
      if (who) await expect(table.getByRole('row').filter({ has: page.getByRole('button', { name: who.name, exact: true }) })).toContainText(dollars(row.all));
    }
    await shot(page, 'dashboard-spend', info);
    expect(errors).toEqual([]);
  });

  test('Timeline tells what happened, and the status filter hides the status lines', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const company = await view(request, id);
    expect(company.statuses.at(-1)?.text).toBe('Planning the watering flow with Lea.');
    await open(page, `/c/${id}/dashboards`);
    await pick(page, 'Timeline');
    const panel = boardFrame(page, 'Dashboards');
    await expect(panel.getByText('Ada: Planning the watering flow with Lea.')).toBeVisible();
    await expect(panel.getByText('The CEO set the goal (2 milestones)', { exact: false })).toBeVisible();
    await expect(panel.getByText('The CEO proposed an org of 8 people in 3 rooms.')).toBeVisible();
    await shot(page, 'dashboard-timeline', info);
    await panel.getByRole('checkbox', { name: 'Status lines' }).uncheck();
    await expect(panel.getByText('Ada: Planning the watering flow with Lea.')).toHaveCount(0);
    await expect(panel.getByText('The CEO set the goal (2 milestones)', { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a dashboard the CEO publishes is drawn from its widgets, and a malformed one is refused with the office sentence', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await say(request, id, 'ceo', '[fake:dashboard] Make a launch checklist');
    await expect.poll(async () => (await view(request, id)).dashboards.map((d) => d.title), { timeout: 60_000 }).toEqual(['Launch checklist']);
    await open(page, `/c/${id}/dashboards`);
    await pick(page, 'Launch checklist');
    const board = page.getByRole('article', { name: 'Launch checklist' });
    await expect(board.getByRole('heading', { name: 'Launch checklist', level: 3 })).toBeVisible();
    await expect(board).toContainText('Made by the CEO');
    await expect(board.getByRole('heading', { name: 'Screens designed', level: 4 })).toBeVisible();
    await expect(board).toContainText('7 of 9');
    await expect(board).toContainText('The watering flow is done.');
    await expect(board.getByRole('heading', { name: 'Store listing' })).toBeVisible();
    await expect(board).toContainText('3 of 8');
    await expect(board.getByRole('listitem').filter({ hasText: 'Reminders' })).toContainText('4');
    await shot(page, 'dashboard-ceo', info);

    // A line with no points: refused, said on the tab and in the timeline, and the good one stays up.
    await say(request, id, 'ceo', '[fake:bad-dashboard] Make a broken one');
    const sentence = /The office turned down the CEO's dashboard “Broken board”: Widget 3 needs points as a list with at least one entry\./;
    const panel = boardFrame(page, 'Dashboards');
    await expect(panel.getByText(sentence)).toBeVisible({ timeout: 60_000 });
    await shot(page, 'dashboard-refused', info);
    expect((await view(request, id)).dashboards.map((d) => d.title)).toEqual(['Launch checklist']);
    await pick(page, 'Timeline');
    await expect(panel.getByRole('listitem').filter({ hasText: sentence })).toBeVisible();
    await pick(page, 'Launch checklist');
    await expect(board).toBeVisible();

    // Taking it down waits out the undo window, then it is gone.
    await panel.getByRole('button', { name: 'Remove this dashboard' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect.poll(async () => (await view(request, id)).dashboards.length, { timeout: 30_000 }).toBe(0);
    expect(errors).toEqual([]);
  });
});
