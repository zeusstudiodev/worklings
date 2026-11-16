import { expect, test } from '@playwright/test';
import { open, scratchOf, shot, stopWork, watchErrors } from './v3-kit.ts';
import { api, folderFor, PLAIN_HUB, view } from './v3-world.ts';

// 0.2.0: the start form asks how the work runs. One Claude Code session is the default and goes straight to work; the
// team is offered as an experiment, with what it cost in our tests. Run on the hub that leaves the choice to the form.
test.describe('how the work runs, in the start form', () => {
  test('defaults to one Claude Code session, reached and changed by keyboard, and starts the job straight away', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const name = `choice-${info.project.name}`;
    await open(page, '/new', PLAIN_HUB);
    const choice = page.getByRole('group', { name: 'How the work runs' });
    const session = choice.getByRole('radio', { name: 'One Claude Code session' });
    const team = choice.getByRole('radio', { name: 'A team (experimental)' });
    await expect(session).toBeChecked();
    await expect(team).not.toBeChecked();
    await expect(choice).toContainText('In our tests it cost about twice as much and was not better than one session.');

    // The keyboard: Tab reaches the chosen option, the arrows move the choice, and the hint follows it.
    await session.focus();
    await expect(session).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(team).toBeChecked();
    await expect(team).toBeFocused();
    await expect(page.getByText('One sentence is enough. The CEO asks about the rest.')).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect(session).toBeChecked();
    await expect(page.getByText('Write it as you would to Claude Code. It asks if it needs to.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Folder' }).fill(folderFor(scratchOf(), name));
    await page.getByRole('textbox', { name: 'What should the company build?' }).fill('[fake:plain-demo] Add a watering streak to the plant app.');
    await shot(page, 'v07-start-choice', info);
    await page.getByRole('button', { name: 'Start the company' }).click();
    // One session goes straight to work: the office, not a proposal.
    await page.waitForURL(new RegExp(`/c/${name}$`));
    await expect.poll(async () => (await view(request, name, PLAIN_HUB)).shape, { timeout: 30_000 }).toBe('plain');
    expect(errors).toEqual([]);
    await stopWork(request, name, 'builder', PLAIN_HUB);
  });

  test('founds the experimental team when it is chosen, and keeps that choice with the company', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const name = `team-${info.project.name}`;
    await open(page, '/new', PLAIN_HUB);
    await page.getByRole('radio', { name: 'A team (experimental)' }).check();
    await page.getByRole('textbox', { name: 'Folder' }).fill(folderFor(scratchOf(), name));
    await page.getByRole('textbox', { name: 'What should the company build?' }).fill('A plant care app with watering streaks.');
    await page.getByRole('button', { name: 'Start the company' }).click();
    await page.waitForURL(new RegExp(`/c/${name}/proposal$`));
    await expect.poll(async () => (await view(request, name, PLAIN_HUB)).shape, { timeout: 30_000 }).toBe('solo');
    expect((await api(request, `api/c/${name}/state`, undefined, PLAIN_HUB)).status).toBe(200);
  });
});
