import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { type AgentState, agentCost } from '../../src/core/office.ts';
import { LIVE, playSession } from './live.ts';
import { DEMO } from './addresses.ts';

const token = process.env.E2E_TOKEN ?? '';
mkdirSync('test-results/evidence', { recursive: true });

interface Spend { questions: number; catchUps: number; samples: number; estimated: number; cost: number }
interface State { totals: { cost: number }; aside: { spend: Spend }; agents: AgentState[] }

/** "$0.42", the way the web app formats a dollar amount. */
const dollars = (n: number) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString('en-US')}`);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const stateOf = async (page: Page, base: string): Promise<State> => (await (await page.request.get(`${base}/api/state?token=${token}`)).json()) as State;
/** Everything in the total that is not the office's own spend: it must not move when the office asks and writes. */
const studioPart = (s: State) => s.totals.cost - s.aside.spend.cost;

/** Presses the first Ask button on Now and sends a suggested question; waits until the office has counted the call. */
async function askSuggested(page: Page, base: string, counted: (s: Spend) => number, before: number) {
  await page.getByRole('tab', { name: 'Now' }).click();
  await page.getByRole('button', { name: /^Ask the / }).first().click();
  await page.getByRole('button', { name: 'What are you working on?' }).click();
  await expect.poll(async () => counted((await stateOf(page, base)).aside.spend), { timeout: 20_000 }).toBe(before + 1);
  // Desktops show a popover with Close; phones put the conversation in the sheet, with Back.
  await page.getByRole('button', { name: /^(Close|Back)$/ }).click();
}

const officeRow = (page: Page) => page.getByRole('row', { name: /The office/ });

test.describe('the office line on the payroll', () => {
  test('the demo counts a suggested question as one free sample, pinned after the roles', async ({ page }, info) => {
    await page.goto(`${DEMO}/?token=${token}`);
    await expect(page.getByRole('button', { name: /^Ask the / }).first()).toBeVisible({ timeout: 30_000 });
    const before = (await stateOf(page, DEMO)).aside.spend.samples;
    await askSuggested(page, DEMO, (s) => s.samples, before);
    const samples = (await stateOf(page, DEMO)).aside.spend.samples;

    await page.getByRole('tab', { name: 'Payroll' }).click();
    const row = officeRow(page);
    await expect(row).toContainText(`${count(samples, 'sample', 'samples')}, free`);
    await expect(row).toContainText('$0');
    await expect(row.getByRole('button')).toHaveCount(0);
    // Pinned: the last line of the table, after every role.
    await expect(page.locator('.ledger-table tbody tr').last()).toContainText('The office');
    await page.screenshot({ path: `test-results/evidence/payroll-office-demo-${info.project.name}.png` });
  });

  test('a live office counts its question and its catch-up, and the top bar includes them', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const played = await playSession({ prompt: `Pay for the office (${info.project.name})` });
    await page.goto(`${LIVE}/?token=${token}`);
    await expect(page.getByRole('button', { name: /^Ask the / }).first()).toBeVisible({ timeout: 15_000 });
    // The office is shared with other tests: wait until this session's own transcripts have been read, so that nothing
    // but the office's own calls changes the total from here on.
    await expect
      .poll(async () => {
        const agents = (await stateOf(page, LIVE)).agents;
        return [played.leadKey, played.subagentKey].map((k) => agents.find((a) => a.key === k)).every((a) => a !== undefined && agentCost(a) > 0);
      })
      .toBe(true);
    const before = await stateOf(page, LIVE);

    await askSuggested(page, LIVE, (s) => s.questions, before.aside.spend.questions);
    const catchUp = page.getByRole('button', { name: 'Catch me up' });
    await expect(catchUp).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
    await catchUp.click();
    await expect.poll(async () => (await stateOf(page, LIVE)).aside.spend.catchUps, { timeout: 20_000 }).toBe(before.aside.spend.catchUps + 1);

    const after = await stateOf(page, LIVE);
    const spend = after.aside.spend;
    // One question and one catch-up more than before, and they cost something.
    expect(spend.questions).toBe(before.aside.spend.questions + 1);
    expect(spend.cost).toBeGreaterThan(before.aside.spend.cost);
    // The office's spend is part of the total and nothing else moved.
    expect(Math.abs(studioPart(after) - studioPart(before))).toBeLessThan(1e-9);

    await page.getByRole('tab', { name: 'Payroll' }).click();
    const row = officeRow(page);
    const calls = `${count(spend.questions, 'question', 'questions')} and ${count(spend.catchUps, 'catch-up', 'catch-ups')}`;
    await expect(row).toContainText(calls);
    await expect(row).toContainText(dollars(spend.cost));
    await expect(page.locator('.ledger-table tbody tr').last()).toContainText('The office');
    await expect(page.locator('.payroll__total-figure')).toHaveText(dollars(after.totals.cost));
    await expect(page.locator('.ledger__item', { hasText: 'API-equivalent' }).locator('dd')).toHaveText(dollars(after.totals.cost));
    await page.screenshot({ path: `test-results/evidence/payroll-office-live-${info.project.name}.png` });
    expect(errors).toEqual([]);
  });
});
