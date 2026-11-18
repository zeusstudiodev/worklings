import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { installPacks } from '../../src/packs/install.ts';
import { open, scratchOf, shot, stopWork, watchErrors } from './v3-kit.ts';
import { folderFor, PLAIN_HUB, view } from './v3-world.ts';

// v0.9 (SPEC-v0.9.md, "The start form"); 0.4.0 ships Kickoff alone: an Add row under "How the work runs" for a
// one-session job, off when the form opens. The office adds a ticked pack to the project's .claude/ before the session
// starts, and Progress says the job started with it.
test.describe('packs in the start form', () => {
  test('offers Kickoff off with what it measured, hides it for a team, and starts a job with it when ticked', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const name = `packs-${info.project.name}`;
    await open(page, '/new', PLAIN_HUB);
    const add = page.getByRole('group', { name: 'Add' });
    const kickoff = add.getByRole('checkbox', { name: 'Kickoff' });
    await expect(kickoff).not.toBeChecked();
    await expect(kickoff).toBeEnabled();
    await expect(add.getByRole('checkbox')).toHaveCount(1);
    await expect(add).toContainText("Packs are off unless you add them. Each is plain files in the project's .claude/ that you can read, edit or delete.");
    await expect(add).toContainText('with a stand-in who knew the full request answering');

    // A team has its own way of starting: no Add row.
    await page.getByRole('radio', { name: 'A team (experimental)' }).check();
    await expect(add).toHaveCount(0);
    await page.getByRole('radio', { name: 'One Claude Code session' }).check();

    const folder = folderFor(scratchOf(), name);
    await page.getByRole('textbox', { name: 'Folder' }).fill(folder);
    await page.getByRole('textbox', { name: 'What should the company build?' }).fill('[fake:plain-demo] Add a watering streak to the plant app.');
    // The keyboard reaches the box, and Space ticks it.
    await kickoff.focus();
    await page.keyboard.press('Space');
    await expect(kickoff).toBeChecked();
    await expect(page.getByText(/^Reading /)).toHaveCount(0);
    await add.scrollIntoViewIfNeeded();
    await shot(page, 'v09-start-packs', info);
    await page.getByRole('button', { name: 'Start the company' }).click();
    await page.waitForURL(new RegExp(`/c/${name}$`));
    await expect.poll(async () => (await view(request, name, PLAIN_HUB)).shape, { timeout: 30_000 }).toBe('plain');
    expect(existsSync(join(folder, '.claude', 'rules', 'worklings-kickoff.md'))).toBe(true);

    // The office says which pack the job started with, under its goal in Progress.
    await open(page, `/c/${name}/progress`, PLAIN_HUB);
    await expect(page.getByText("Started with the pack Kickoff: files in the project's .claude/ you can edit or delete.")).toBeVisible();
    await shot(page, 'v09-office-packs', info);
    expect(errors).toEqual([]);
    await stopWork(request, name, 'builder', PLAIN_HUB);
  });

  test('marks Kickoff as there when the folder has it', async ({ page }, info) => {
    test.setTimeout(60_000);
    const folder = folderFor(scratchOf(), `packs-there-${info.project.name}`);
    installPacks(folder, ['kickoff']);
    await open(page, '/new', PLAIN_HUB);
    await page.getByRole('textbox', { name: 'Folder' }).fill(folder);
    const add = page.getByRole('group', { name: 'Add' });
    const kickoff = add.getByRole('checkbox', { name: 'Kickoff' });
    await expect(kickoff).toBeChecked({ timeout: 15_000 });
    await expect(kickoff).toBeDisabled();
    await expect(add).toContainText("Already in this folder's .claude/.");
    await add.scrollIntoViewIfNeeded();
    await shot(page, 'v09-start-packs-there', info);
  });

  test("marks Kickoff unavailable when a file of the person's own is in its place", async ({ page }, info) => {
    test.setTimeout(60_000);
    const folder = folderFor(scratchOf(), `packs-own-${info.project.name}`);
    mkdirSync(join(folder, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(folder, '.claude', 'rules', 'worklings-kickoff.md'), 'Our own kickoff rule.\n');
    await open(page, '/new', PLAIN_HUB);
    await page.getByRole('textbox', { name: 'Folder' }).fill(folder);
    const add = page.getByRole('group', { name: 'Add' });
    await expect(add).toContainText('This folder has its own .claude/rules/worklings-kickoff.md, so the pack would replace it.', { timeout: 15_000 });
    const kickoff = add.getByRole('checkbox', { name: 'Kickoff' });
    await expect(kickoff).toBeDisabled();
    await expect(kickoff).not.toBeChecked();
  });
});
