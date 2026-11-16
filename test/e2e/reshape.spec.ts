import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { LIVE } from './addresses.ts';

const token = process.env.E2E_TOKEN ?? '';
const project = process.env.E2E_PROJECT ?? '';
const file = (path: string) => join(project, path);

// These tests change files in one shared project, so they run once, on the desktop layout.
test.beforeEach(({ browserName: _ }, info) => {
  test.skip(info.project.name !== 'desktop', 'Studio changes are tested once, on the desktop layout.');
});

test.describe.serial('reshaping the studio from the office', () => {
  test('hires a role from the library into its room', async ({ page }) => {
    await page.goto(`${LIVE}/?token=${token}`);
    await expect(page).toHaveURL(`${LIVE}/`);
    await page.locator('.room-sign__button', { hasText: 'Quality' }).click();
    const row = page.locator('.hire', { hasText: 'Performance engineer' });
    await row.getByRole('button', { name: 'Hire' }).click();
    await expect(page.getByText('Hired the performance engineer.')).toBeVisible();
    expect(existsSync(file('.claude/agents/performance-engineer.md'))).toBe(true);
    expect(readFileSync(file('.claude/studio.yaml'), 'utf8')).toContain('id: performance-engineer');
    await expect(page.getByRole('button', { name: 'Performance engineer' })).toBeVisible();
  });

  test('fires a role after confirming, and rehires it', async ({ page }) => {
    await page.goto(`${LIVE}/?token=${token}`);
    await page.getByRole('tab', { name: 'Team' }).click();
    await page.getByRole('button', { name: 'Code reviewer' }).first().click();
    await page.getByRole('button', { name: 'Fire' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Fire the code reviewer?');
    await dialog.getByRole('button', { name: 'Fire' }).click();
    await expect(page.getByText('Fired the code reviewer.')).toBeVisible();
    expect(existsSync(file('.claude/agents/code-reviewer.md'))).toBe(false);
    expect(existsSync(file('.claude/studio/fired/code-reviewer.md'))).toBe(true);
    // Firing opens the room the role sat in, where it can be brought back.
    await page.locator('.hire', { hasText: 'Code reviewer' }).getByRole('button', { name: 'Rehire' }).click();
    await expect(page.getByText('Rehired the code reviewer.')).toBeVisible();
    expect(existsSync(file('.claude/agents/code-reviewer.md'))).toBe(true);
  });

  test('changes a role model and moves it to another room, writing only on Save', async ({ page }) => {
    await page.goto(`${LIVE}/?token=${token}`);
    await page.getByRole('tab', { name: 'Team' }).click();
    await page.getByRole('button', { name: 'UX designer' }).first().click();
    const agentBefore = readFileSync(file('.claude/agents/ux-designer.md'), 'utf8');
    const studioBefore = readFileSync(file('.claude/studio.yaml'), 'utf8');
    // Arrowing through a closed list changes its value key by key; none of that may reach the files.
    await page.getByLabel('Room', { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
    expect(readFileSync(file('.claude/studio.yaml'), 'utf8')).toBe(studioBefore);
    await page.getByLabel('Model', { exact: true }).selectOption('sonnet');
    await page.getByLabel('Room', { exact: true }).selectOption('engineering');
    expect(readFileSync(file('.claude/agents/ux-designer.md'), 'utf8')).toBe(agentBefore);
    await expect(page.getByText('Save writes .claude/agents/ux-designer.md and .claude/studio.yaml.')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Moved the UX designer to Engineering.')).toBeVisible();
    expect(readFileSync(file('.claude/agents/ux-designer.md'), 'utf8')).toMatch(/^model: sonnet$/m);
    expect(readFileSync(file('.claude/studio.yaml'), 'utf8')).toMatch(/- id: ux-designer\n\s+department: engineering/);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
  });

  test('edits a rule on the wall', async ({ page }) => {
    await page.goto(`${LIVE}/?token=${token}`);
    await page.locator('.room-sign__button', { hasText: 'Engineering' }).click();
    await page.locator('.rule summary', { hasText: 'TypeScript' }).click();
    await page.getByRole('button', { name: 'Edit rule' }).click();
    await page.getByRole('textbox').fill('- Keep strict mode on.\n- Validate input at the boundary.');
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByText('Saved the typescript rule.')).toBeVisible();
    const rule = readFileSync(file('.claude/rules/typescript.md'), 'utf8');
    expect(rule).toContain('- Keep strict mode on.\n- Validate input at the boundary.\n');
    expect(rule).toMatch(/^---\npaths:/);
  });

  test('without the access link, the office shows nothing and changes nothing', async ({ page }) => {
    await page.goto(LIVE);
    await expect(page.getByText('This office needs its access link')).toBeVisible();
    expect((await page.request.get(`${LIVE}/api/state`)).status()).toBe(401);
    const res = await page.request.post(`${LIVE}/api/reshape`, { data: { action: 'fire', role: 'frontend-engineer' } });
    expect(res.status()).toBe(401);
    expect(existsSync(file('.claude/agents/frontend-engineer.md'))).toBe(true);
  });
});
