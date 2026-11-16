import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { agentCost } from '../../src/core/office.ts';
import type { Snapshot } from '../../src/core/snapshot.ts';
import { LIVE, playSession } from './live.ts';

const token = process.env.E2E_TOKEN ?? '';
mkdirSync('test-results/evidence', { recursive: true });

/** "$0.42", the way the web app formats a dollar amount. */
const dollars = (n: number) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString('en-US')}`);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function snapshot(page: Page): Promise<Snapshot> {
  return (await (await page.request.get(`${LIVE}/api/state?token=${token}`)).json()) as Snapshot;
}

test.describe('a live session', () => {
  test('puts the lead and the code reviewer on the Team tab with what each cost', async ({ page }, info) => {
    const errors = watchErrors(page);
    const played = await playSession();
    // The tails read the transcripts a moment after the hooks: wait until the office has priced both people.
    await expect
      .poll(async () => {
        const s = await snapshot(page);
        const lead = s.agents.find((a) => a.key === played.leadKey);
        const reviewer = s.agents.find((a) => a.key === played.subagentKey);
        return lead && reviewer ? [agentCost(lead) > 0, agentCost(reviewer) > 0, reviewer.roleId] : null;
      }, { timeout: 15_000 })
      .toEqual([true, true, 'code-reviewer']);

    await page.goto(`${LIVE}/?token=${token}`);
    await expect(page.locator('canvas')).toBeVisible();
    await page.getByRole('tab', { name: 'Team' }).click();

    // Other tests' sessions share this office, so the rows are checked against the server's own numbers: the lead of
    // this session by its id, the reviewer role as the sum over everyone who played it.
    const s = await snapshot(page);
    const lead = s.agents.find((a) => a.key === played.leadKey)!;
    const leadRow = page.getByRole('button', { name: new RegExp(`^Lead(, session ${played.sessionId.slice(0, 6)})?\\b`) }).filter({ hasText: dollars(agentCost(lead)) });
    await expect(leadRow.first()).toBeVisible();

    const reviewers = s.agents.filter((a) => a.roleId === 'code-reviewer');
    const reviewerCost = dollars(reviewers.reduce((sum, a) => sum + agentCost(a), 0));
    expect(reviewerCost).not.toBe('$0');
    await expect(page.getByRole('button', { name: /^Code reviewer/ }).filter({ hasText: reviewerCost })).toBeVisible();

    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/evidence/live-team-${info.project.name}.png` });
    expect(errors).toEqual([]);
  });
});

test.describe('hooks installed before the rename', () => {
  test('still reach the office with the old marker in their URL', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Hooks are the same on every screen: checked once, on the desktop layout.');
    const request = 'Review notes.txt for a session whose hooks predate the rename';
    const played = await playSession({ legacyHooks: true, prompt: request });
    // The office learns of a session only from its hooks: the lead and the reviewer it briefed are there for this request.
    await expect
      .poll(async () => {
        const s = await snapshot(page);
        return [played.leadKey, played.subagentKey].map((key) => s.agents.find((a) => a.key === key)?.purpose ?? null);
      }, { timeout: 15_000 })
      .toEqual([request, request]);
  });
});

test.describe('the Now tab on a live session', () => {
  test('shows the code reviewer on it with its goal and request, then done with its result', async ({ page }, info) => {
    const errors = watchErrors(page);
    const request = `Review notes.txt for the ${info.project.name} check`;
    const played = await playSession({ stopBefore: 'SubagentStop', prompt: request });
    await page.goto(`${LIVE}/?token=${token}`);
    await expect(page.getByRole('tab', { name: 'Now' })).toHaveAttribute('aria-selected', 'true');

    // Other sessions share this office: this one's rows carry its own request, so they are found by that text.
    const reviewer = page.getByRole('button', { name: 'Code reviewer', exact: true });
    const mine = (group: string) =>
      page.getByRole('region', { name: group, exact: true }).locator('li').filter({ hasText: `For your request: ${request}` }).filter({ has: reviewer });
    const row = mine('On it');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('Read notes.txt contents');
    await expect(row).toContainText(/On it for/);
    await page.screenshot({ path: `test-results/evidence/live-now-working-${info.project.name}.png` });

    await played.finish();
    const finished = mine('Done in the last 15 minutes');
    await expect(finished).toBeVisible({ timeout: 15_000 });
    // The office shows inline code as plain text.
    await expect(finished).toContainText('contains one line: hello.');
    await expect(mine('On it')).toHaveCount(0);
    await page.screenshot({ path: `test-results/evidence/live-now-done-${info.project.name}.png` });
    expect(errors).toEqual([]);
  });
});
