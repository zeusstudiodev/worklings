// v0.2's spending plan in the browser (SPEC-v0.2.md, "the maintainer's decisions"), through the real hub with only Claude Code faked:
// the preset before the start, the models per level, the budget, what a person's desk loads and the estimate that follows
// it, a company walked up to 80% and to its budget with the pause and the raise, and the demo companies. Each runs at 1440
// and 375 px (projects v3 and v3-phone): nothing scrolls sideways, and focus is never lost or hidden.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { tokensShort } from '../../web/src/company/spending/spendingModel.ts';
import { boardFrame, expectNoSidewaysScroll, hiddenFocus, layoutOf, nameFor, open, openBoard, openCompany, openPanel, running, scratchOf, shot, sheetUp, sidePanel, tell, waitForProposal, watchErrors, moreKey } from './v3-kit.ts';
import { api, found, view } from './v3-world.ts';

/** Where focus is, in a few words, and whether the page has lost it (focus on the body, or on nothing). */
async function expectFocusKept(page: Page, where: string): Promise<void> {
  const lost = (await page.evaluate('!document.activeElement || document.activeElement === document.body')) as boolean;
  expect(lost, `focus fell to the page ${where}`).toBe(false);
  expect(await hiddenFocus(page), `focus is hidden ${where}`).toBeNull();
}

/** The proposal panel of a freshly proposed company, with its Spending plan in view. */
async function proposed(page: Page, request: Parameters<typeof found>[0], name: string): Promise<{ id: string; plan: Locator }> {
  const id = await found(request, scratchOf(), name);
  await waitForProposal(request, id);
  await open(page, `/c/${id}/proposal`);
  await sheetUp(page);
  const plan = sidePanel(page).getByRole('region', { name: 'Spending plan' });
  await expect(plan).toBeVisible({ timeout: 30_000 });
  return { id, plan };
}

const formOf = (field: Locator): Locator => field.locator('xpath=ancestor::form[1]');
const choose = (plan: Locator, preset: string): Locator => plan.locator('label', { hasText: new RegExp(`^${preset}$`) });

test.describe('the spending plan before the start', () => {
  test('the three presets are a radio group: Balanced is the default, a choice says what the CEO does, and the arrow keys walk them', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const { id, plan } = await proposed(page, request, nameFor('spend-preset', info));
    await plan.scrollIntoViewIfNeeded();

    const group = plan.getByRole('group', { name: 'How thorough the company is' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(group.getByRole('radio', { name: 'Balanced' })).toBeChecked();
    await expect(plan.locator('.preset-card', { hasText: 'Balanced' }).getByText('Default', { exact: true })).toBeVisible();
    await expect(plan.locator('.preset-card', { hasText: 'Lean' }).getByText('Default', { exact: true })).toHaveCount(0);
    // Each card says what it is: its line, the team, what it costs an hour and for the whole job, honestly rough.
    const thorough = plan.locator('.preset-card', { hasText: 'Thorough' });
    await expect(thorough).toContainText('Specialists for every area');
    await expect(thorough).toContainText('6 to 25');
    await expect(thorough).toContainText('The CEO and heads on Opus, everyone else on Sonnet');
    await expect(thorough).toContainText(/about \$[\d.]+ an hour/);
    await expect(thorough).toContainText(/about \$[\d.]+ to \$[\d.]+/);
    await expect(plan).toContainText('Costs are rough');
    // Nobody answered "How thorough?", so the question is still open beside the form; Balanced stands.
    expect((await view(request, id)).spending?.presetQuestion).toEqual(expect.any(String));
    await shot(page, 'spend-presets', info);

    // A press sets it at once, the office moves the desks, and the CEO is asked to revise to it.
    await choose(plan, 'Lean').click();
    await expect(plan.getByText('Lean is set. The CEO is revising the proposal to fit it.')).toBeVisible();
    await expect(group.getByRole('radio', { name: 'Lean' })).toBeChecked();
    await expect.poll(async () => (await view(request, id)).settings.preset).toBe('lean');
    const lean = await view(request, id);
    expect(lean.settings.maxDesks).toBe(3);
    expect(lean.spending?.presetQuestion).toBeNull();
    await expectFocusKept(page, 'after choosing Lean');

    // The arrow keys walk the group, each stop a choice; the last one stands, and focus stays on the radio.
    await group.getByRole('radio', { name: 'Lean' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(group.getByRole('radio', { name: 'Thorough' })).toBeFocused();
    await expect(group.getByRole('radio', { name: 'Thorough' })).toBeChecked();
    await expect.poll(async () => (await view(request, id)).settings.preset, { timeout: 30_000 }).toBe('thorough');
    expect((await view(request, id)).settings.maxDesks).toBe(8);
    await expectFocusKept(page, 'after the arrow keys');

    // The proposal has eight people, inside Thorough's 6 to 25, so no note about its size.
    await expect(plan.getByRole('note').filter({ hasText: /sizes to/ })).toHaveCount(0);
    await expectNoSidewaysScroll(page, 'the proposal with its Spending plan');
    await shot(page, 'spend-preset-thorough', info);
    expect(errors).toEqual([]);
  });

  test('the models are one select a level, and a choice changes everyone at that level in the proposal', async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const { id, plan } = await proposed(page, request, nameFor('spend-models', info));
    await plan.scrollIntoViewIfNeeded();

    await expect(plan.getByLabel('CEO', { exact: true })).toHaveValue('opus');
    await expect(plan.getByLabel('Workers', { exact: true })).toHaveValue('sonnet');
    await plan.getByLabel('CEO', { exact: true }).selectOption('sonnet');
    await expect(plan.getByText('The CEO runs on Sonnet.')).toBeVisible();
    await plan.getByLabel('Workers', { exact: true }).selectOption('haiku');
    await expect(plan.getByText('Workers run on Haiku.')).toBeVisible();
    await expect.poll(async () => (await view(request, id)).settings.models).toMatchObject({ ceo: 'sonnet', worker: 'haiku' });
    const company = await view(request, id);
    expect(company.proposal?.people.find((p) => p.level === 'ceo')?.model).toBe('sonnet');
    expect(company.proposal?.people.filter((p) => p.level === 'worker').every((p) => p.model === 'haiku')).toBe(true);
    // The sentence under the selects says it as words, and the focus is still on the select pressed last.
    await expect(plan.getByText(/^The CEO and heads on Sonnet, workers on Haiku|Sonnet.*Haiku/).first()).toBeVisible();
    await expect(plan.getByLabel('Workers', { exact: true })).toHaveValue('haiku');
    await expectNoSidewaysScroll(page, 'the models');
    await shot(page, 'spend-models', info);
    expect(errors).toEqual([]);
  });

  test('the budget: dollars to the cent, validated here and by the office, saved a field at a time and cleared with focus kept', async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const { id, plan } = await proposed(page, request, nameFor('spend-budget', info));
    await plan.scrollIntoViewIfNeeded();
    const company = plan.getByLabel('Company budget');
    const person = plan.getByLabel('Budget for each person');
    await expect(company).toHaveValue('');
    await expect(company).toHaveAttribute('placeholder', 'No budget');

    // Not an amount: the field says so in its words and Save waits.
    await company.fill('twenty');
    await expect(plan.getByText('Enter an amount from $0.01 to $1,000,000, to the cent, or leave it empty for no budget.').first()).toBeVisible();
    await expect(company).toHaveAttribute('aria-invalid', 'true');
    await expect(formOf(company).getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
    await company.fill('0');
    await expect(company).toHaveAttribute('aria-invalid', 'true');

    await company.fill('$25');
    await formOf(company).getByRole('button', { name: 'Save' }).click();
    await expect(plan.getByText('Company budget is $25.')).toBeVisible();
    await person.fill('4.5');
    await person.press('Enter');
    await expect(plan.getByText('Per-person budget is $4.50.')).toBeVisible();
    expect((await view(request, id)).settings.budget).toEqual({ company: 25, person: 4.5 });
    await expectFocusKept(page, 'after saving a budget');

    // The office's own refusal shows when the browser's check lets one through: 1,000,001 is over its limit.
    await company.fill('1000001');
    await expect(company).toHaveAttribute('aria-invalid', 'true');
    await company.fill('25');

    // Clear takes the company's cap off, and focus moves into the field the Clear button leaves.
    await formOf(company).getByRole('button', { name: /^Clear/ }).click();
    await expect(company).toBeFocused();
    await expect(company).toHaveValue('');
    await expect.poll(async () => (await view(request, id)).settings.budget.company).toBeNull();
    expect((await view(request, id)).settings.budget.person).toBe(4.5);
    await expectNoSidewaysScroll(page, 'the budget fields');
    await shot(page, 'spend-budget', info);
    expect(errors).toEqual([]);
  });

  test('what a person loads: tools, skills and servers in their card, the estimate changing as they change, and the office refusing a server nobody has installed', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const id = await found(request, scratchOf(), nameFor('spend-loads', info));
    await waitForProposal(request, id);
    const before = (await view(request, id)).spending?.loads;
    expect(before?.byPerson['frontend-engineer']?.tokens).toBe(13_000);

    await openCompany(page, id, { main: 'org' });
    const chart = boardFrame(page, 'Org chart');
    await chart.getByRole('treeitem', { name: /^Sam,/ }).click();
    const loads = sidePanel(page).getByRole('group', { name: 'What this desk loads' });
    await expect(loads).toBeVisible({ timeout: 30_000 });
    await expectFocusKept(page, 'after opening a card');

    // Defaults are shown as defaults: six tools for a worker, no skills, no servers; the fixed prompt is said in tokens.
    await expect(loads.getByText('Default for workers: Read, Edit, Write, Bash, Glob, Grep.')).toBeVisible();
    await expect(loads.getByRole('checkbox', { name: 'Read' })).toBeChecked();
    await expect(loads.getByRole('checkbox', { name: 'WebSearch' })).not.toBeChecked();
    await expect(loads.getByRole('checkbox', { name: 'Load skills' })).not.toBeChecked();
    await expect(loads.getByText('about 13k tokens before any work', { exact: false }).first()).toBeVisible();
    await expect(loads.getByRole('button', { name: 'Back to the defaults' })).toHaveCount(0);

    // Skills add the Skill tool: the estimate moves, in the form, before anything is saved.
    await loads.getByRole('checkbox', { name: 'Load skills' }).check();
    await expect(loads.getByText('about 16k tokens before any work', { exact: false }).first()).toBeVisible();
    await expect(loads.getByRole('button', { name: 'Back to the defaults' })).toBeVisible();
    await loads.getByText('What adds up').click();
    await expect(loads.getByText('skills: 3k tokens')).toBeVisible();
    await expect(loads.getByText('Claude Code and the office: 13k tokens')).toBeVisible();

    await sidePanel(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(sidePanel(page).getByText("Saved Sam's changes.")).toBeVisible();
    await expectFocusKept(page, 'after saving a card');
    const after = await view(request, id);
    expect(after.proposal?.people.find((p) => p.id === 'frontend-engineer')?.loads).toEqual({ skills: true });
    expect(after.spending?.loads?.byPerson['frontend-engineer']?.tokens).toBe(16_000);
    expect((after.spending?.loads?.tokens ?? 0) - (before?.tokens ?? 0)).toBe(3_000);

    // The company's total says it too, in the Spending plan.
    const plan = sidePanel(page).getByRole('region', { name: 'Spending plan' });
    await plan.scrollIntoViewIfNeeded();
    await expect(plan.getByText(`about ${tokensShort(after.spending?.loads?.tokens ?? 0)} tokens`, { exact: false }).first()).toBeVisible();
    await plan.getByText('Each person', { exact: true }).click();
    await expect(plan.getByText('Skills on.')).toBeVisible();

    // A server nobody installed is added by name and refused by the office, with a sentence that says so.
    // The chart again, as a person comes back to it (a phone's sheet covers it while a card is open).
    await openCompany(page, id, { main: 'org' });
    await boardFrame(page, 'Org chart').getByRole('treeitem', { name: /^Sam,/ }).click();
    const again = sidePanel(page).getByRole('group', { name: 'What this desk loads' });
    await again.getByLabel('Add an MCP server by name').fill('not-installed-server');
    await again.getByLabel('Add an MCP server by name').press('Enter');
    await expect(again.getByRole('checkbox', { name: 'not-installed-server' })).toBeChecked();
    await expect(again.getByText('(partly estimated)', { exact: false }).first()).toBeVisible();
    await sidePanel(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(sidePanel(page).getByText(/^Not saved\./)).toBeVisible();
    await expectFocusKept(page, 'after a refused save');
    expect((await view(request, id)).proposal?.people.find((p) => p.id === 'frontend-engineer')?.loads).toEqual({ skills: true });
    await expectNoSidewaysScroll(page, 'a card with its loads');
    await shot(page, 'spend-loads', info);
    // The refused save is a 400 the page logs, and the office's console line for it: expected here, nothing else.
    expect(errors.filter((e) => !/^400 |Failed to load|status of 400/.test(e))).toEqual([]);
  });
});

test.describe('the budget while the company runs', () => {
  test('80% asks in the inbox, the limit pauses with Raise the budget, and raising it lets the company carry on', async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    const id = await running(request, nameFor('spend-run', info));
    const spent = async () => (await view(request, id)).spending?.budget.spent ?? 0;
    const state = async () => (await view(request, id)).spending?.budget.state;

    // A cap ten cents above what was spent so far: each [fake:spend] turn costs a cent, so the climb is a few turns.
    const cap = Math.round((await spent()) * 100 + 10) / 100;
    expect((await api(request, `api/c/${id}/budget`, { company: cap })).status).toBe(200);
    const turn = async () => {
      const was = await spent();
      await tell(request, id, 'ceo', 'Keep going [fake:spend]');
      await expect.poll(spent, { timeout: 60_000, intervals: [200, 500] }).toBeGreaterThan(was + 0.005);
    };
    for (let i = 0; i < 30 && (await state()) === 'ok'; i += 1) await turn();
    expect(await state(), 'the company is at 80% and not yet over').toBe('warning');

    // The office asks in the inbox, with its raise options and a way to carry on.
    await openCompany(page, id);
    await sheetUp(page);
    const notice = sidePanel(page).getByText(/budget, 80%\./);
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(sidePanel(page).getByRole('button', { name: /^Raise it to \$/ }).first()).toBeVisible();
    await expect(sidePanel(page).getByRole('button', { name: 'Carry on' })).toBeVisible();
    if (!layoutOf(page).phone) {
      // The company bar's meter carries the budget (v0.2: "$4 of $5"), with its state in its tooltip and the whole sum in its name.
      const figure = page.locator('.cbar__meter--warning:visible').first();
      await expect(figure).toContainText(/\$[\d.,]+ of \$[\d.,]+/);
      await expect(figure).toHaveAttribute('title', /has spent \d+% of its budget/);
      await expect(figure).toHaveAccessibleName(/^\$[\d.,]+ of the \$[\d.,]+ budget spent/);
    }
    await expectNoSidewaysScroll(page, 'the inbox with the budget notice');
    await shot(page, 'spend-budget-80', info);

    // The limit: the company pauses for its budget, and says so where a pause is shown.
    for (let i = 0; i < 30 && (await state()) !== 'paused'; i += 1) await turn();
    await expect.poll(async () => (await view(request, id)).pause?.reason, { timeout: 30_000 }).toBe('budget');
    await expect(sidePanel(page).getByText(/^Paused: the company's \$[\d.]+ budget is spent\. Raise it to carry on\./).first()).toBeVisible({ timeout: 30_000 });
    if (!layoutOf(page).phone) {
      // v0.2: the bar's pill says the stage, Paused, as progress and the lobby do; the meter turns to the stuck ink.
      await expect(page.getByRole('banner').getByText('Paused', { exact: true }).first()).toBeVisible();
      await expect(page.locator('.cbar__meter--paused:visible').first()).toBeVisible();
      // Nobody Try nows a budget: More offers the raise instead.
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.locator('.cbar__menu').getByRole('button', { name: 'Raise the budget' })).toBeVisible();
      await expect(page.locator('.cbar__menu').getByRole('button', { name: 'Try now' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await shot(page, 'spend-budget-paused', info);

    // "Raise the budget" opens Settings with the company's field ready; raising the cap lifts the pause.
    await sidePanel(page).getByRole('button', { name: 'Raise the budget' }).click();
    const field = sidePanel(page).getByLabel('Company budget');
    await expect(field).toBeFocused({ timeout: 15_000 });
    await expect(sidePanel(page).getByText(/budget is spent/).first()).toBeVisible();
    await shot(page, 'spend-budget-settings', info);
    await field.fill(String(cap * 10));
    await field.press('Enter');
    await expect(sidePanel(page).getByText(`Company budget is $${cap * 10}`, { exact: false })).toBeVisible();
    await expect.poll(async () => (await view(request, id)).pause, { timeout: 30_000 }).toBeNull();
    await expect.poll(state).toBe('ok');
    await expectFocusKept(page, 'after raising the budget');
    await expectNoSidewaysScroll(page, 'Settings with the budget');
    expect(errors).toEqual([]);
  });

  test('the Spend dashboard shows the cost an hour now and the budget so far', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const id = await running(request, nameFor('spend-board', info));
    await api(request, `api/c/${id}/budget`, { company: 50, person: 10 });
    await expect.poll(async () => (await view(request, id)).spending?.budget.company).toBe(50);
    await open(page, `/c/${id}/dashboards`);
    const frame = boardFrame(page, 'Dashboards');
    const select = frame.getByRole('combobox', { name: 'Dashboard' });
    const link = frame.getByRole('navigation', { name: 'Dashboards' }).getByRole('link', { name: 'Spend', exact: true });
    await expect(select.or(link)).toBeVisible();
    if (await select.isVisible()) await select.selectOption({ label: 'Spend' });
    else await link.click();
    const card = frame.getByRole('region', { name: 'Cost now and the budget' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText('Cost an hour now')).toBeVisible();
    await expect(card.getByText('Company budget', { exact: true })).toBeVisible();
    await expect(card).toContainText('of $50 spent.');
    await expect(card).toContainText('Each person has $10.');
    await expectNoSidewaysScroll(page, 'the Spend dashboard');
    await shot(page, 'spend-board', info);
    expect(errors).toEqual([]);
  });
});

test.describe('the demo companies', () => {
  test('Café Lumen runs on Thorough with a $60 budget: the bar, Settings and the Spend dashboard say so, and a raise saves', async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await openPanel(page, 'demo', 'settings');
    const settings = sidePanel(page);
    await expect(settings.getByText('Thorough', { exact: true })).toBeVisible();
    await expect(settings.getByText(', chosen at the start.')).toBeVisible();
    await expect(settings.getByLabel('Company budget')).toHaveValue('60');
    await expect(settings.getByLabel('Budget for each person')).toHaveValue('8');
    if (!layoutOf(page).phone) await expect(page.locator('.cbar__meter:visible').first()).toContainText(/\$[\d.,]+ of \$60/);
    await settings.getByLabel('Company budget').fill('80');
    await settings.getByLabel('Company budget').press('Enter');
    await expect(settings.getByText('Company budget is $80.')).toBeVisible();
    if (!layoutOf(page).phone) await expect(page.locator('.cbar__meter:visible').first()).toContainText(/of \$80/);
    await expectNoSidewaysScroll(page, 'Settings in the demo');
    await shot(page, 'spend-demo-settings', info);

    await openBoard(page, 'demo', 'dashboards');
    const frame = boardFrame(page, 'Dashboards');
    const select = frame.getByRole('combobox', { name: 'Dashboard' });
    const link = frame.getByRole('navigation', { name: 'Dashboards' }).getByRole('link', { name: 'Spend', exact: true });
    await expect(select.or(link)).toBeVisible();
    if (await select.isVisible()) await select.selectOption({ label: 'Spend' });
    else await link.click();
    await expect(frame.getByRole('region', { name: 'Cost now and the budget' })).toContainText('Each person has $8.');
    expect(errors).toEqual([]);
  });

  test('a demo proposal takes a preset, a model and a budget as the office does', async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    // The demo companies live in the page: the tab enters the demo at the café, then opens one by its address.
    await open(page, '/c/demo');
    await expect(moreKey(page)).toBeVisible({ timeout: 30_000 });
    await openCompany(page, 'plant-pal');
    await sheetUp(page);
    const plan = sidePanel(page).getByRole('region', { name: 'Spending plan' });
    await expect(plan).toBeVisible({ timeout: 30_000 });
    await plan.scrollIntoViewIfNeeded();
    await choose(plan, 'Lean').click();
    await expect(plan.getByText('Lean is set. The CEO is revising the proposal to fit it.')).toBeVisible();
    await expect(plan.getByRole('radio', { name: 'Lean' })).toBeChecked();
    await plan.getByLabel('Heads', { exact: true }).selectOption('opus');
    await expect(plan.getByText('Heads run on Opus.')).toBeVisible();
    await plan.getByLabel('Company budget').fill('12.50');
    await plan.getByLabel('Company budget').press('Enter');
    await expect(plan.getByText('Company budget is $12.50.')).toBeVisible();
    await expect(moreKey(page)).toBeVisible();
    await expectNoSidewaysScroll(page, 'the demo proposal');
    await shot(page, 'spend-demo-proposal', info);
    expect(errors).toEqual([]);
  });
});

test.describe('the plan with contracts and kinds', () => {
  test('the plan lists its contracts and tags integration and check tasks; the task board carries the tags', async ({ page, request }, info) => {
    test.setTimeout(150_000);
    const errors = watchErrors(page);
    // Plan approval stays on its default, so the start turn has the CEO propose the first plan.
    const id = await running(request, nameFor('spend-contracts', info), { planApproval: 'before-work' });
    await expect.poll(async () => (await view(request, id)).steering?.plan?.versions.length ?? 0, { timeout: 60_000 }).toBe(1);
    await tell(request, id, 'ceo', 'Please agree the interface first [fake:plan-contracts]');
    await expect.poll(async () => (await view(request, id)).steering?.plan?.versions.at(-1)?.plan.contracts?.length ?? 0, { timeout: 60_000 }).toBe(1);

    await open(page, `/c/${id}/plan`);
    const contracts = page.getByRole('region', { name: 'Contracts' });
    await expect(contracts).toBeVisible({ timeout: 30_000 });
    await expect(contracts).toContainText('Watering flow screens');
    await expect(contracts).toContainText('design/flow.md');
    await expect(contracts.getByText('Written by')).toBeVisible();
    await expect(contracts).toContainText('Lea');
    await expect(contracts).toContainText('Built against by');
    await expect(contracts).toContainText('Build the streak card');
    await expect(page.locator('.kind-tag', { hasText: 'Integration' }).first()).toBeVisible();
    await expect(page.locator('.kind-tag', { hasText: 'Check' }).first()).toBeVisible();
    await expectNoSidewaysScroll(page, 'the plan with its contracts');
    await shot(page, 'plan-contracts', info);

    // Approved, the tasks come to the board with the same tags.
    await page.getByRole('button', { name: 'Approve the plan', exact: true }).first().click();
    await expect.poll(async () => (await view(request, id)).tasks.length, { timeout: 60_000 }).toBeGreaterThan(2);
    await openBoard(page, id, 'tasks');
    const board = boardFrame(page, 'Tasks');
    await expect(board.getByText('Integration', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expectNoSidewaysScroll(page, 'the task board with kinds');
    await shot(page, 'tasks-kinds', info);
    expect(errors).toEqual([]);
  });
});
