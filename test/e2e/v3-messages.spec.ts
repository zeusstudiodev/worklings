import { expect, test } from '@playwright/test';
import { openPanel, person, running, shot, sidePanel, talk, talkBar, talkBox, theTo, watchErrors } from './v3-kit.ts';
import { view } from './v3-world.ts';

// Talking to one person through the talk bar, with their panel open beside it: a message to a busy worker, a head
// passing one on, and Stop. One company for the file: its people are talked to in turn, and nobody is left working.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `messages-${info.project.name}`);
  await request.dispose();
});

test.describe('messages', () => {
  test('a message to a busy worker is delivered at its next step and the conversation says so', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    // Opening Kai with an empty box makes him the To.
    await openPanel(page, id, 'people/ui-designer');
    await expect(theTo(page)).toHaveAccessibleName('To Kai, UI designer');
    const doing = sidePanel(page).getByRole('region', { name: 'What Kai is doing' });
    const thread = sidePanel(page).getByRole('region', { name: 'Conversation with Kai' });

    await talk(page, null, '[fake:busy] Start on the palette');
    await expect(doing).toContainText('Working', { timeout: 30_000 });
    await talk(page, null, 'Make the palette darker');
    await expect(thread).toContainText('Make the palette darker');
    await shot(page, 'message-busy', info);

    // Both reach Kai (the second joins the turn the first began), and each line says when.
    await expect(thread.getByText(/^Delivered /)).toHaveCount(2, { timeout: 60_000 });
    await expect(doing).toContainText('Idle', { timeout: 60_000 });
    const company = await view(request, id);
    const mine = company.messages.filter((m) => m.to === 'ui-designer' && m.from === '@stakeholder');
    expect(mine.map((m) => m.text)).toEqual(['[fake:busy] Start on the palette', 'Make the palette darker']);
    expect(mine.every((m) => typeof m.deliveredAt === 'number' && m.typed === true)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a head passing a message on shows who said it first, on the person it reached', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await openPanel(page, id, 'people/head-of-design');
    await talk(page, null, '[fake:relay] Make the palette darker for the menu');
    await expect(sidePanel(page).getByRole('region', { name: 'Conversation with Ada' })).toContainText('Delivered', { timeout: 60_000 });

    await openPanel(page, id, 'people/ui-designer');
    const thread = sidePanel(page).getByRole('region', { name: 'Conversation with Kai' });
    await expect(thread.getByText('Ada passed on your message')).toBeVisible({ timeout: 60_000 });
    await expect(thread.getByText('From you, through Ada.')).toBeVisible();
    await expect(thread.getByText('Ada: Menu pages first.')).toBeVisible();
    await shot(page, 'message-relay', info);
    const relayed = (await view(request, id)).messages.find((m) => m.from === 'head-of-design' && m.to === 'ui-designer');
    expect(relayed).toMatchObject({ origin: '@stakeholder', note: 'Menu pages first.' });
    expect(errors).toEqual([]);
  });

  test('Stop interrupts a long turn and the instruction comes next', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await openPanel(page, id, 'people/frontend-engineer');
    const doing = sidePanel(page).getByRole('region', { name: 'What Sam is doing' });
    const thread = sidePanel(page).getByRole('region', { name: 'Conversation with Sam' });

    await talk(page, null, '[fake:long] Build the menu page');
    await expect(doing).toContainText('Working', { timeout: 30_000 });
    // A desk shows as working from its first line, before its session exists: Stop needs the session.
    await expect.poll(async () => Boolean(person(await view(request, id), 'frontend-engineer').desk.sessionId), { timeout: 30_000 }).toBe(true);

    // Stop turns the talk bar into Stop for Sam: the box takes what to do instead.
    await doing.getByRole('button', { name: /^Stop( Sam)?$/ }).click();
    await expect(talkBox(page)).toHaveAccessibleName('Stop Sam and say what to do instead');
    await expect(talkBox(page)).toBeFocused();
    await talkBox(page).fill('Do the footer first');
    await shot(page, 'stop', info);
    await talkBar(page).getByRole('button', { name: 'Stop and send', exact: true }).click();

    await expect(thread.getByText('Do the footer first')).toBeVisible({ timeout: 30_000 });
    await expect(thread.getByText(/^Stopped Sam and delivered/)).toBeVisible({ timeout: 60_000 });
    // The long turn is over: the instruction's own turn answers and Sam is idle again.
    await expect(doing).toContainText('Idle', { timeout: 60_000 });
    const sent = (await view(request, id)).messages.find((m) => m.to === 'frontend-engineer' && m.text === 'Do the footer first');
    expect(sent).toMatchObject({ interrupt: true });
    expect(typeof sent?.deliveredAt).toBe('number');
    expect(errors).toEqual([]);
  });
});
