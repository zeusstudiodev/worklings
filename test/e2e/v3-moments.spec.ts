import { expect, type Page, test } from '@playwright/test';
import { boardFrame, inboxKey, layoutOf, open, person, running, shot, stopWork, watchErrors } from './v3-kit.ts';
import { api, say, view } from './v3-world.ts';

// H24: the 3D moments. They are WebGL, so the specs assert on what the label layer and the page show (a person's label
// is marked while the scene walks them, bubbles and the front desk button say who needs the stakeholder, the timeline
// says a milestone is done) and the screenshots carry the rest. Reduced motion gets its own pictures, and its own
// assertion: nobody walks.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(180_000);
  const request = await playwright.request.newContext();
  id = await running(request, `moments-${info.project.name}`);
  await request.dispose();
});

/** Records every label the scene ever walked and every bubble it showed, from before the page loads (page code as a string). */
const record = (page: Page) =>
  page.addInitScript(`(() => {
    window.__walked = new Set();
    window.__bubbles = new Set();
    const scan = () => {
      for (const l of document.querySelectorAll('.labels .label[data-walking="true"]')) window.__walked.add(l.textContent.trim());
      for (const b of document.querySelectorAll('.labels .bubble')) window.__bubbles.add(b.textContent.trim());
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  })()`);
const walked = async (page: Page): Promise<string[]> => (await page.evaluate('[...window.__walked]')) as string[];

test.describe('moments in the office', () => {
  test('a relay down the tree is a walk-over (and none with reduced motion)', async ({ page, browser, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const calm = await browser.newContext({ viewport: page.viewportSize() ?? { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const still = await calm.newPage();
    await Promise.all([record(page), record(still)]);
    await Promise.all([open(page, `/c/${id}`), open(still, `/c/${id}`)]);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(still.locator('canvas')).toBeVisible();

    await say(request, id, 'head-of-design', '[fake:relay] Make the palette darker for the menu');
    await expect.poll(async () => (await view(request, id)).messages.some((m) => m.from === 'head-of-design' && m.to === 'ui-designer' && m.deliveredAt !== null), { timeout: 60_000 }).toBe(true);
    // Labels are marked while the scene walks someone; a phone draws labels only for the selected person and whoever needs you.
    if (info.project.name === 'v3') await expect.poll(async () => (await walked(page)).length, { timeout: 30_000, message: 'someone walked over for the relay' }).toBeGreaterThan(0);
    await shot(page, 'h24-relay', info);
    await shot(still, 'h24-relay-reduced-motion', info);
    expect(await walked(still)).toEqual([]);
    await calm.close();
    expect(errors).toEqual([]);
  });

  test('someone who needs the stakeholder stands at the front desk with a paper, and the screen says so', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await open(page, `/c/${id}`);
    await say(request, id, 'backend-engineer', '[fake:push] Push the work branch');
    const desk = page.getByRole('button', { name: /^Front desk, 1 needs you/ });
    await expect(desk).toBeVisible({ timeout: 30_000 });
    // The crowd at the desk is said once by its sign; focus on the sign opens the fold and shows who waits.
    await desk.focus();
    await expect(page.getByRole('main').getByRole('button', { name: /Ivo.*wants your OK|Ivo.*needs your OK|^Ivo/ }).first()).toBeVisible();
    await shot(page, 'h24-front-desk', info);
    // Answering sends them back to work: the desk empties.
    // The inbox is the side panel's home; a phone brings its sheet up first.
    if (layoutOf(page).phone) await inboxKey(page).click();
    await page.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: 'Allow once' }).click();
    await expect(page.getByRole('main').getByRole('button', { name: /^Front desk/ })).toHaveCount(0, { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test('a finished milestone is announced, with its small celebration in the scene', async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await say(request, id, 'ceo', '[fake:goal] Set the goal');
    await expect.poll(async () => (await view(request, id)).goal?.milestones.length, { timeout: 60_000 }).toBe(2);
    await say(request, id, 'head-of-design', '[fake:assign-m1] Plan the watering flow');
    await expect.poll(async () => (await view(request, id)).tasks.length, { timeout: 60_000 }).toBe(1);
    await say(request, id, 'ux-designer', '[fake:report-done] Report back');
    await expect.poll(async () => (await view(request, id)).reports.length, { timeout: 60_000 }).toBeGreaterThan(0);
    await open(page, `/c/${id}`);
    await expect(page.locator('canvas')).toBeVisible();
    await say(request, id, 'head-of-design', '[fake:accept] Review it');
    await expect.poll(async () => (await view(request, id)).goal?.milestones[0]?.doneAt, { timeout: 60_000 }).not.toBeNull();
    await shot(page, 'h24-milestone', info);
    await open(page, `/c/${id}/dashboards/timeline`);
    await expect(boardFrame(page, 'Dashboards').getByText(/Milestone done: Watering flow/)).toBeVisible();
    await open(page, `/c/${id}/dashboards/progress`);
    await expect(page.getByRole('list', { name: 'Milestones' })).toContainText('Done at');
    expect(errors).toEqual([]);
  });

  test('tiredness as context fills, and a pause at night, are drawn from state the office already holds', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    // The fake desk reports the same context size every turn, so tiredness has no state to follow here: its evidence is
    // the unit tests of the cast. A pause is real: pausing the company puts the office to sleep.
    const errors = watchErrors(page);
    await open(page, `/c/${id}`);
    expect((await api(request, `api/c/${id}/pause`, {})).status).toBe(200);
    await expect(page.getByRole('banner')).toContainText(/[Pp]aused|Resting/, { timeout: 30_000 });
    await shot(page, 'h24-paused-night', info);
    expect((await api(request, `api/c/${id}/resume`, {})).status).toBe(200);
    await expect(page.getByRole('banner')).not.toContainText(/[Pp]aused|Resting/, { timeout: 30_000 });
    await stopWork(request, id, 'ui-designer');
    expect(person(await view(request, id), 'ceo').desk.state).not.toBe('away');
    expect(errors).toEqual([]);
  });
});
