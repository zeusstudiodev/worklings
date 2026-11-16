// First run (H49, AC26): the cost on their plan before the first start, and watching an existing project only with
// consent. The shared hub's Claude Code is the ready fake; the missing and signed-out callouts need a hub of their own
// and are looked at by a scratch script (see the run's evidence).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { open, scratchOf, shot, sheetUp, waitForProposal, watchErrors } from './v3-kit.ts';
import { found, view } from './v3-world.ts';

test.describe('first run', () => {
  test('the proposal says what the company costs on their plan before Start', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), `first-run-cost-${info.project.name}`);
    await waitForProposal(request, id);
    expect((await view(request, id)).estimate?.lines.length).toBeGreaterThan(0);

    await open(page, `/c/${id}/proposal`);
    await sheetUp(page);
    const start = page.getByRole('button', { name: 'Start the company' });
    await expect(start).toBeVisible({ timeout: 30_000 });
    await start.scrollIntoViewIfNeeded();
    // The proposal's own line; the spending plan's "While it works…" says it too, folded under "How it adds up".
    await expect(page.getByText(/^About \$[\d.,]+ an hour at API prices/)).toBeVisible();
    await expect(page.getByText(/on Pro or Max it counts against your limits/)).toBeVisible();
    // The change chips are for a proposal that exists.
    await expect(page.getByRole('group', { name: 'Suggestions for the CEO' })).toBeVisible();
    // The old line stays true only without an estimate: with one, the estimate's own last line says it.
    await expect(page.getByText('Nobody costs anything until they have work.')).toHaveCount(0);
    // The breakdown folds under "How it adds up", in the proposal's "What it costs" (the spending plan has its own fold).
    const cost = page.getByRole('region', { name: 'What it costs' });
    await cost.getByText('How it adds up').click();
    await expect(cost.getByText(/People cost nothing while they have no work/)).toBeVisible();
    // No sideways scroll at this width.
    // A string, as the other specs do, since the Node typecheck has no DOM types.
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
    await shot(page, 'first-run-estimate', info);
    expect(errors).toEqual([]);
  });

  test("a short prompt meets the CEO's scoping questions first: its picks and whys, your own words, Undo and the picks for the rest", async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), `first-run-scope-${info.project.name}`, 'A plant care app [fake:scope]');
    await expect.poll(async () => (await view(request, id)).scoping?.questions.length ?? 0, { timeout: 60_000 }).toBe(4);

    await open(page, `/c/${id}/proposal`);
    await sheetUp(page);
    await expect(page.getByRole('heading', { name: 'A few questions first' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('blockquote').or(page.locator('.proposal__prompt'))).toContainText('A plant care app');
    const scoping = page.getByRole('region', { name: "The CEO's questions" });
    // Each question has its choices, the CEO's pick tagged, and why it picks that one.
    const first = scoping.getByRole('listitem').first();
    await expect(first.getByRole('button', { name: /Their pick$/ })).toHaveText(/Anyone, through the App Store/);
    await expect(first).toContainText('Why the CEO picks');
    // They wait in the inbox too: the four questions and the office's own "How thorough?".
    expect((await view(request, id)).inbox).toBe(5);
    // Nothing sideways at this width, and the org suggestions wait for the draft.
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
    await expect(page.getByRole('group', { name: 'Suggestions for the CEO' })).toHaveCount(0);
    await shot(page, 'first-run-scoping', info);

    // Your own words on one question; Undo puts it back while it waits.
    const second = scoping.getByRole('listitem').nth(1);
    await second.getByRole('button', { name: 'Answer in your own words' }).click();
    await second.getByRole('textbox', { name: 'Your answer' }).fill('Something I can show friends next week');
    await second.getByRole('button', { name: 'Send answer' }).click();
    await expect(second.getByText('Answering: Something I can show friends next week.')).toBeVisible();
    await second.getByRole('button', { name: 'Undo' }).click();
    await expect(second.getByRole('button', { name: /^A quick prototype/ })).toBeVisible();
    await second.getByRole('button', { name: /^A quick prototype/ }).click();
    await expect(page.getByText("Three of four still open. Answer them, or use the CEO's picks for the rest.")).toBeVisible();
    await page.getByRole('button', { name: "Use the CEO's picks", exact: true }).click();
    await shot(page, 'first-run-scoping-picks', info);

    // Once they apply, the CEO drafts from them and proposes.
    await waitForProposal(request, id);
    const company = await view(request, id);
    expect(company.scoping?.answeredAt).toEqual(expect.any(Number));
    expect(company.messages.filter((m) => m.to === 'ceo' && m.text.startsWith('Answers to your scoping questions:'))).toHaveLength(1);
    await expect(page.getByRole('heading', { name: "The CEO's proposal" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('What you told the CEO first')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a CEO that ends its turn in words, with no proposal, says so and shows its words, and the change chips wait for a proposal', async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), `first-run-words-${info.project.name}`, 'A plant care app [fake:words]');
    await expect.poll(async () => (await view(request, id)).drafting?.stopped?.words ?? '', { timeout: 60_000 }).toContain('iOS only');

    await open(page, `/c/${id}/proposal`);
    await sheetUp(page);
    await expect(page.getByRole('heading', { name: 'The CEO is waiting for you' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("The CEO's turn ended without a proposal", { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Before I draft: should the plant app work on iOS only, or on Android too?')).toBeVisible();
    // Not "Drafting": no timer, no Stop; what the person can do is there.
    await expect(page.getByText(/^Drafting for/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop the CEO' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Draft again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Answer the CEO' })).toBeVisible();
    // Before any org exists the change chips have nothing to change.
    await expect(page.getByRole('group', { name: 'Suggestions for the CEO' })).toHaveCount(0);
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
    await shot(page, 'first-run-ceo-words', info);

    // Draft again: the CEO is asked, and the words go.
    await page.getByRole('button', { name: 'Draft again' }).click();
    await expect.poll(async () => (await view(request, id)).messages.some((m) => m.to === 'ceo' && m.text.includes('draft the org again')), { timeout: 30_000 }).toBe(true);
    expect(errors).toEqual([]);
  });

  test('stopping the CEO while it drafts changes the top status from "Drafting the org"', async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), `first-run-stop-${info.project.name}`, 'A plant care app [fake:long]');
    await open(page, `/c/${id}/proposal`);
    await sheetUp(page);
    const status = page.locator('.cbar').first();
    // The bar says it in its sentence at every width (a phone drops the pill's word).
    await expect(status).toContainText('The CEO is drafting your company.', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Stop the CEO' }).click();
    await expect(page.getByRole('heading', { name: 'The draft is stopped' })).toBeVisible({ timeout: 30_000 });
    await expect(status).toContainText('You stopped the CEO.');
    await expect(status).not.toContainText('The CEO is drafting your company.');
    await shot(page, 'first-run-ceo-stopped', info);
    expect(errors).toEqual([]);
  });

  test('watching a project writes its hooks only after "Add the hooks"', async ({ page }, info) => {
    const errors = watchErrors(page);
    const folder = join(scratchOf(), 'watched', `first-run-${info.project.name}`);
    mkdirSync(folder, { recursive: true });
    // A git repository, so watching adds its .gitignore line too.
    execFileSync('git', ['init', '-q'], { cwd: folder });
    const settings = join(folder, '.claude', 'settings.local.json');

    await open(page, '/');
    await page.getByRole('button', { name: 'Watch an existing project' }).click({ timeout: 30_000 });
    await page.getByLabel('Project folder').fill(folder);
    await page.getByRole('button', { name: 'Show what changes' }).click();

    // The plan comes first, and nothing is written yet.
    await expect(page.getByText(/Claude Code hooks to \.claude\/settings\.local\.json/)).toBeVisible();
    await expect(page.getByText('Nothing else in the project changes.')).toBeVisible();
    await expect(page.getByText(/to the folder's \.gitignore/)).toBeVisible();
    expect(existsSync(settings)).toBe(false);
    await shot(page, 'first-run-watch-plan', info);

    // Changing the folder drops the plan: what is shown is always for the folder typed.
    await page.getByLabel('Project folder').fill(`${folder}-other`);
    await expect(page.getByRole('button', { name: 'Add the hooks' })).toHaveCount(0);
    await page.getByLabel('Project folder').fill(folder);
    await page.getByRole('button', { name: 'Show what changes' }).click();
    await expect(page.getByRole('button', { name: 'Add the hooks' })).toBeVisible();
    expect(existsSync(settings)).toBe(false);

    await page.getByRole('button', { name: 'Add the hooks' }).click();
    await expect(page.getByText(/^Hooks added to \.claude\/settings\.local\.json/)).toBeVisible();
    await expect(page.getByText(/npx worklings office /).first()).toBeVisible();
    await expect(page.getByText(/npx worklings hooks uninstall /)).toBeVisible();
    expect(JSON.parse(readFileSync(settings, 'utf8')).hooks.UserPromptSubmit).toBeTruthy();
    expect(readFileSync(join(folder, '.gitignore'), 'utf8')).toContain('.claude/settings.local.json');
    await shot(page, 'first-run-watch-done', info);

    // Asking again says there is nothing to add.
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Watch an existing project' }).click();
    await page.getByLabel('Project folder').fill(folder);
    await page.getByRole('button', { name: 'Show what changes' }).click();
    await expect(page.getByText(/so there is nothing to add/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add the hooks' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a folder that isn't there shows the hub's sentence and writes nothing", async ({ page }, info) => {
    const folder = join(scratchOf(), 'watched', `nope-${info.project.name}`);
    await open(page, '/');
    await page.getByRole('button', { name: 'Watch an existing project' }).click({ timeout: 30_000 });
    await page.getByLabel('Project folder').fill(folder);
    await page.getByRole('button', { name: 'Show what changes' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "doesn't exist" })).toBeVisible();
    expect(existsSync(folder)).toBe(false);
  });
});
