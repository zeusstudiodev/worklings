import { expect, test } from '@playwright/test';
import { fromPalette, open, person, running, shot, sidePanel, stopWork, watchErrors } from './v3-kit.ts';
import { lobby, say, view } from './v3-world.ts';

test.describe('the lobby', () => {
  test('two companies keep working while you switch between them', async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const plant = await running(request, `lobby-plant-${info.project.name}`);
    const bakery = await running(request, `lobby-bakery-${info.project.name}`, { prompt: 'A bakery site [fake:found-bakery]' });
    expect([plant, bakery]).toEqual([`lobby-plant-${info.project.name}`, `lobby-bakery-${info.project.name}`]);

    // Both have someone at work for a good while.
    await say(request, plant, 'ui-designer', '[fake:work] Work on the streak card');
    await say(request, bakery, 'ui-designer', '[fake:work] Work on the order page');
    for (const id of [plant, bakery]) {
      await expect.poll(async () => person(await view(request, id), 'ui-designer').desk.state, { timeout: 60_000 }).toBe('working');
    }

    await open(page, '/');
    // A company's entry says its folder's name when another company has the same name ("Plant Pal in lobby-plant-v3."),
    // and has nothing there when its name is its own ("Corner Bakery .").
    const entry = (id: string) => {
      const title = id.includes('bakery') ? 'Corner Bakery' : 'Plant Pal';
      return page.getByRole('button', { name: new RegExp(`^${title} in ${id}\\.|^${title} \\.`) });
    };
    await expect(entry(plant)).toBeVisible({ timeout: 30_000 });
    await expect(entry(bakery)).toBeVisible();
    await expect(entry(plant)).toContainText('Plant Pal');
    await expect(entry(bakery)).toContainText('Corner Bakery');
    // v0.2: each card says its stage in the word the bar and progress use, and the stakeholder's words.
    await expect(entry(plant)).toContainText('Working');
    await expect(entry(plant)).toContainText('A plant care app with watering streaks');
    // The worlds load after the panel, on desktops only: the shot waits for the bakery's sign over its world on the mat.
    if (!info.project.name.includes('phone')) {
      const mat = page.getByRole('main', { name: 'Your companies on the mat' });
      await expect(mat.getByText('Corner Bakery').first()).toBeVisible({ timeout: 30_000 });
    }
    await shot(page, 'lobby-two', info);

    // Into the bakery: v0.8's cards land on its office, its own people at work.
    await entry(bakery).click();
    await expect(page).toHaveURL(new RegExp(`/c/${bakery}$`));
    await expect(page.getByRole('banner')).toContainText('Corner Bakery');
    await shot(page, 'lobby-bakery', info);
    // Its own Kai is at work: opened beside the office, his panel says so.
    await fromPalette(page, 'Kai', /^Open Kai\b/);
    await expect(sidePanel(page).getByRole('region', { name: 'What Kai is doing' })).toContainText('Working');

    // Back through the lobby to the other one.
    await page.getByRole('link', { name: 'Lobby' }).click();
    await expect(entry(plant)).toBeVisible();
    await entry(plant).click();
    await expect(page).toHaveURL(new RegExp(`/c/${plant}$`));
    await expect(page.getByRole('banner')).toContainText('Plant Pal');
    await fromPalette(page, 'Kai', /^Open Kai\b/);
    await expect(sidePanel(page).getByRole('region', { name: 'What Kai is doing' })).toContainText('Working');

    // Neither stopped while we looked: the same desks are still at work, and the lobby counts both.
    for (const id of [plant, bakery]) expect(person(await view(request, id), 'ui-designer').desk.state).toBe('working');
    const entries = (await lobby(request)).companies.filter((c) => [plant, bakery].includes(c.id));
    expect(entries.map((c) => [c.id, c.working > 0])).toEqual(expect.arrayContaining([[plant, true], [bakery, true]]));
    expect(errors).toEqual([]);

    await stopWork(request, plant, 'ui-designer');
    await stopWork(request, bakery, 'ui-designer');
  });

  test('the demo company is one link away, and its Lobby link comes back to your own companies', async ({ page }, info) => {
    const errors = watchErrors(page);
    await open(page, '/');
    const demoLink = page.getByRole('link', { name: 'Open the demo company' });
    await expect(demoLink).toBeVisible({ timeout: 30_000 });
    await demoLink.click();
    // The demo café's own address (a phone opens it with the inbox's sheet up, at the same address).
    await expect(page).toHaveURL(/\/c\/demo$/);
    await expect(page.getByRole('banner')).toContainText('Café Lumen');
    await shot(page, 'lobby-demo-company', info);

    await page.getByRole('link', { name: 'Lobby' }).click();
    await expect(page).toHaveURL(/\/$/);
    // Your own lobby again, not the demo's: it offers the demo rather than saying you are in it.
    await expect(page.getByRole('link', { name: 'Open the demo company' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Open the demo company' })).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
