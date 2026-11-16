import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { boardFrame, inboxKey, layoutOf, nameFor, open, scratchOf, shot, sheetUp, sendKey, sidePanel, switcher, switchTo, talkBox, watchErrors } from './v3-kit.ts';
import { folderFor, view } from './v3-world.ts';

const PEOPLE = ['Noor', 'Ada', 'Lea', 'Kai', 'Ben', 'Sam', 'Ivo', 'Tom'];

test.describe('a new company', () => {
  test("the start form, the CEO's scoping questions, its draft, a change by message, Start, and the approved plan puts people to work", async ({ page, request }, info) => {
    // Scoping, drafting, a revision and the start are four turns of the fake CEO plus the 3D office's screenshots.
    test.setTimeout(150_000);
    const errors = watchErrors(page);
    const name = nameFor('new-co', info);
    const phone = layoutOf(page).phone;
    const folder = folderFor(scratchOf(), name);

    // Back to the office from the chart: its own key on a desktop, Office in the views row on a phone, whose sheet then
    // peeks again for the person to bring up.
    const leaveChart = async () => {
      if (phone) {
        await switchTo(page, 'Office');
        await sheetUp(page);
      } else await boardFrame(page, 'Org chart').getByRole('button', { name: 'Back to the office', exact: true }).click();
    };

    // The form: a folder and a sentence about what to build.
    await open(page, '/new');
    await page.getByRole('textbox', { name: 'Folder' }).fill(folder);
    await page.getByRole('textbox', { name: 'What should the company build?' }).fill('A plant care app with watering streaks [fake:scope]');
    await shot(page, 'start-form', info);
    await page.getByRole('button', { name: 'Start the company' }).click();

    // A short prompt: before it drafts, the CEO asks its scoping questions, and the proposal panel shows them first.
    await page.waitForURL(new RegExp(`/c/${name}(/proposal)?$`));
    // A phone shows the office with the sheet peeking; the person brings it up.
    await sheetUp(page);
    await expect(page.getByRole('heading', { name: 'A few questions first' })).toBeVisible({ timeout: 60_000 });
    const scoping = page.getByRole('region', { name: "The CEO's questions" });
    await expect(scoping.getByRole('listitem')).toHaveCount(4);
    await expect(scoping.getByText('Why the CEO picks \u201cAnyone, through the App Store\u201d: A streak is more fun when other people keep one too.')).toBeVisible();
    await expect(page.getByText(/^The CEO has four questions before drafting your company\./)).toBeVisible();
    expect((await view(request, name)).proposal).toBeNull();
    await shot(page, 'scoping', info);

    // One press answers a question, with Undo for a few seconds; "Use the CEO's picks" answers the other three.
    await scoping.getByRole('button', { name: /^Friends and family/ }).click();
    await expect(scoping.getByText('Answering: Friends and family.')).toBeVisible();
    await page.getByRole('button', { name: "Use the CEO's picks", exact: true }).click();
    await expect(page.getByText('Your answers reach the CEO in a few seconds, and it drafts your company from them.')).toBeVisible();
    await shot(page, 'scoping-answered', info);

    // The answers reach the CEO in one message, and the office says it drafts from them.
    await expect(page.getByRole('heading', { name: 'Drafting your company' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('The CEO is drafting your company from your answers. About a minute.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your answers' })).toContainText('Friends and family');
    await shot(page, 'drafting', info);
    const told = (await view(request, name)).messages.filter((m) => m.to === 'ceo' && m.text.startsWith('Answers to your scoping questions:'));
    expect(told.map((m) => m.text.split('\n').filter((l) => /^ {3}/.test(l)).map((l) => l.trim()))).toEqual([
      ['Friends and family.', 'A polished first release (your pick).', 'As an app on phones (your pick).', 'Reminders that arrive on time (your pick).'],
    ]);

    // The proposal: a summary, and the org chart one press away.
    await expect(page.getByRole('heading', { name: "The CEO's proposal" })).toBeVisible({ timeout: 60_000 });
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary).toContainText('Eight people in three rooms');
    // Why this size, in the CEO's words, and what you told it first.
    await expect(summary).toContainText('Eight people: an app with a design side and an engineering side, each with three people and a head.');
    await summary.getByText('What you told the CEO first').click();
    await expect(summary).toContainText('Friends and family');
    await summary.getByText('What you told the CEO first').click();
    await summary.getByRole('button', { name: 'See the chart' }).click();
    // The chart is the Org board over the office, holding the proposal's tree; on a phone its sheet goes down for it.
    const chart = boardFrame(page, 'Org chart');
    for (const person of PEOPLE) await expect(chart.getByRole('treeitem', { name: new RegExp(`^${person},`) })).toBeVisible();
    await expect(chart.getByRole('treeitem', { name: /^Mila,/ })).toHaveCount(0);
    await shot(page, 'proposal-chart', info);
    await leaveChart();

    // "Add a German copywriter", said to the CEO: it revises, and the new proposal has her.
    // The talk bar is the one box for it: the side panel has no box or Send of its own, only a way to the bar.
    await expect(sidePanel(page).getByRole('textbox')).toHaveCount(0);
    await expect(sidePanel(page).getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    await expect(talkBox(page)).toHaveCount(1);
    await talkBox(page).fill('Please add a German copywriter [fake:revise]');
    await sendKey(page).click();
    await expect(summary).toContainText('Nine people in three rooms', { timeout: 60_000 });
    await summary.getByRole('button', { name: 'See the chart' }).click();
    await expect(chart.getByRole('treeitem', { name: /^Mila, German copywriter/ })).toBeVisible();
    await shot(page, 'proposal-revised', info);
    await leaveChart();

    // Start: the company runs and its people are at their desks (the People tab lists all nine, off duty until they have work).
    // A new company waits for the stakeholder's approval of the plan, so nobody has work yet.
    await page.getByRole('button', { name: 'Start the company' }).first().click();
    await expect(switcher(page)).toBeVisible({ timeout: 60_000 });
    await switchTo(page, 'Org');
    const org = boardFrame(page, 'Org chart');
    // The board reads "Opening…" until the company's first snapshot after Start arrives, which takes a while on a busy machine.
    for (const person of [...PEOPLE, 'Mila']) await expect(org.getByRole('treeitem', { name: new RegExp(`^${person},`) })).toBeVisible({ timeout: 30_000 });
    await expect(org.getByRole('treeitem', { name: /^Mila, German copywriter/ })).toContainText('Off duty');
    await shot(page, 'h25-people-at-desks', info);

    // The start turn tells the CEO to propose the plan first, and the fake CEO does. Until the stakeholder approves it,
    // the company holds the plan and no task exists.
    await expect.poll(async () => (await view(request, name)).steering?.plan?.versions.length ?? 0, { timeout: 60_000 }).toBe(1);
    expect((await view(request, name)).tasks).toEqual([]);
    // It waits in the inbox as an item of its own, with a way in.
    await inboxKey(page).click();
    await page.getByRole('link', { name: 'Open the plan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The plan' }).first()).toBeVisible();
    await expect(page.getByText('Waits for you').first()).toBeVisible();
    await shot(page, 'h25-plan-waiting', info);

    // Approving it in the office hands the tasks that wait for nothing to their owners; the one that waits for another stays queued.
    await page.getByRole('button', { name: 'Approve the plan', exact: true }).click();
    await expect
      .poll(async () => (await view(request, name)).tasks.map((t) => [t.title, t.owner]).sort(), { timeout: 60_000 })
      .toEqual([['Build the streak card', 'frontend-engineer'], ['Sketch the watering flow', 'ux-designer'], ['Write the store listing', 'ui-designer']]);
    expect((await view(request, name)).steering?.plan?.approved).not.toBeNull();
    await shot(page, 'h25-plan-approved', info);

    // And on disk and in the hub: the agents and studio.yaml were written, the company runs with nine people.
    const company = await view(request, name);
    expect([company.phase, company.people.map((p) => p.id).sort()]).toEqual(['running', ['backend-engineer', 'ceo', 'copywriter', 'frontend-engineer', 'head-of-design', 'head-of-engineering', 'qa-engineer', 'ui-designer', 'ux-designer']]);
    expect(readFileSync(join(folder, '.claude', 'studio.yaml'), 'utf8')).toContain('id: copywriter');
    expect(existsSync(join(folder, '.claude', 'agents', 'copywriter.md'))).toBe(true);
    expect(errors).toEqual([]);
  });
});
