import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { open, openBoard, openPanel, running, scratchOf, shot, sidePanel, talk, theTo, watchErrors } from './v3-kit.ts';
import { folderFor, view } from './v3-world.ts';

// H23: the office and the org change by talking to the CEO. The fake CEO's org tool calls are scripted ("[fake:<name>]"
// in the message), and each change must show in the office, in the company's state and in the files that record it.
test.describe.configure({ mode: 'serial' });

let id = '';
let folder = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  const name = `changes-${info.project.name}`;
  id = await running(request, name);
  folder = folderFor(scratchOf(), name);
  await request.dispose();
});

/** Says it to the CEO through the talk bar, with the CEO's panel open beside it, as the stakeholder would. */
async function tellTheCeo(page: Page, text: string) {
  await openPanel(page, id, 'people/ceo');
  await expect(theTo(page)).toHaveAccessibleName('To Noor, CEO');
  await talk(page, null, text);
  await expect(sidePanel(page).getByRole('region', { name: 'Conversation with the CEO' })).toContainText(text.replace(/^\[fake:[\w-]+\] /, ''));
}

const studio = () => readFileSync(join(folder, '.claude', 'studio.yaml'), 'utf8');

test.describe('changed by talking to the CEO', () => {
  test('"Add a games room with an arcade theme" adds the room to the office and to studio.yaml', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tellTheCeo(page, '[fake:games-room] Add a games room with an arcade theme');
    await expect.poll(async () => (await view(request, id)).rooms.map((r) => r.id), { timeout: 60_000 }).toContain('games');
    const room = (await view(request, id)).rooms.find((r) => r.id === 'games');
    expect(room).toMatchObject({ title: 'Games room', kind: 'games' });
    await open(page, `/c/${id}`);
    // Room signs are drawn on desktops only: a phone's scene strip carries no signs.
    if (info.project.name === 'v3') await expect(page.getByRole('main').getByText('Games room', { exact: true })).toBeVisible({ timeout: 30_000 });
    await shot(page, 'h23-games-room', info);
    expect(studio()).toContain('Games room');
    expect(studio()).toContain('arcade');
    expect(errors).toEqual([]);
  });

  test('"Fire Tom" takes him out of the org and the people list, and rehiring puts him back where he was', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tellTheCeo(page, '[fake:fire-tom] Please let Tom go');
    await expect.poll(async () => (await view(request, id)).people.map((p) => p.id), { timeout: 60_000 }).not.toContain('qa-engineer');
    const org = await openBoard(page, id, 'org');
    await expect(org.getByRole('treeitem', { name: /^Ben,/ })).toBeVisible();
    await expect(org.getByRole('treeitem', { name: /^Tom,/ })).toHaveCount(0);
    expect(existsSync(join(folder, '.claude', 'agents', 'qa-engineer.md'))).toBe(false);
    await shot(page, 'h23-fired', info);

    await tellTheCeo(page, '[fake:rehire-tom] Bring Tom back');
    await expect.poll(async () => (await view(request, id)).people.find((p) => p.id === 'qa-engineer')?.reportsTo, { timeout: 60_000 }).toBe('head-of-engineering');
    await openBoard(page, id, 'org');
    await expect(org.getByRole('treeitem', { name: /^Tom,/ })).toBeVisible();
    expect(existsSync(join(folder, '.claude', 'agents', 'qa-engineer.md'))).toBe(true);
    expect(studio()).toContain('id: qa-engineer');
    // Said once each in the timeline.
    const board = await openBoard(page, id, 'dashboards/timeline');
    await expect(board.getByText(/The CEO fired Tom/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the office takes a theme by name, and the screenshots show it in four', async ({ page, request }, info) => {
    // Four themes, each a CEO turn, a reload of the 3D office and a screenshot.
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    for (const theme of ['arcade', 'cafe', 'lab', 'garden']) {
      await tellTheCeo(page, `[fake:theme-${theme}] Make the office a ${theme}`);
      await expect.poll(async () => (await view(request, id)).theme, { timeout: 60_000 }).toBe(theme);
      await open(page, `/c/${id}`);
      await expect(page.locator('canvas')).toBeVisible();
      // Let the scene settle (light, props) before the picture: wait for the labels, which draw after the first frame.
      if (info.project.name === 'v3') await expect(page.getByRole('main').getByText('Games room', { exact: true })).toBeVisible({ timeout: 30_000 });
      await shot(page, `h26-theme-${theme}`, info);
    }
    expect(studio()).toContain('theme: garden');
    expect(errors).toEqual([]);
  });
});
