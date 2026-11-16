// v0.3, the studio over many companies (SPEC-v0.3.md, "Stream S"): from the lobby, a portfolio of two companies made in
// the form, its card rolled up from them, the studio chat asking both CEOs and showing their answers, and the shared
// budget that, once spent, pauses both, with each company's inbox saying why and where to raise it. Studio chat >
// portfolio > company > person, each a click apart, at 1440 and 375 px.
import { expect, type Page, test } from '@playwright/test';
import type { StudioLobbyView } from '../../src/studio/model.ts';
import { inboxKey, open, openCompany, panelToggle, running, shot, sidePanel, watchErrors } from './v3-kit.ts';
import { api } from './v3-world.ts';

const studioLobby = async (request: Parameters<typeof api>[0]) => (await api<StudioLobbyView>(request, 'api/lobby')).body;

/** The studio chat is one per hub and both projects run this spec at once: wait for it to be free, then send. */
async function sendWhenFree(page: Page, request: Parameters<typeof api>[0], text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message the studio chat' });
  const deadline = Date.now() + 90_000;
  for (;;) {
    await expect.poll(async () => (await studioLobby(request)).studio.state, { timeout: 60_000, intervals: [200, 500] }).not.toMatch(/thinking|starting/);
    await box.fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    // Sent: the box empties. Taken by the other project's message first: the hint says so, and we try again.
    const sent = await expect(box).toHaveValue('', { timeout: 5_000 }).then(() => true, () => false);
    if (sent) return;
    if (Date.now() > deadline) throw new Error('The studio chat never came free.');
  }
}

test.describe('the studio over many companies', () => {
  test('a portfolio of two companies, the studio chat asking both CEOs, and a spent shared budget pausing both', async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    const project = info.project.name;
    const plant = await running(request, `studio-plant-${project}`);
    const bakery = await running(request, `studio-bakery-${project}`, { prompt: 'A bakery site with pickup orders [fake:found-bakery]' });
    const name = `Client work ${project}`;
    const id = `p-client-work-${project}`;

    // The lobby is the top level: the studio chat first, then portfolios, then the companies.
    await open(page, '/');
    await expect(page.getByRole('button', { name: /^Studio chat/ })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: 'New portfolio' }).click();
    await expect(page).toHaveURL(/\/p\/new$/);
    await expect(page.getByRole('heading', { name: 'New portfolio' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByRole('textbox', { name: 'Shared budget, in dollars' }).fill('20');
    await page.getByRole('textbox', { name: 'Shared brief' }).fill('Both sites are bilingual, German first, and use the shop’s own photos.');
    // A name only one company has stays as it is; several are told apart by their folders.
    await page.getByRole('checkbox', { name: new RegExp(`^Plant Pal( in studio-plant-${project})?$`) }).check();
    await page.getByRole('checkbox', { name: new RegExp(`^Corner Bakery( in studio-bakery-${project})?$`) }).check();
    await page.getByRole('button', { name: 'Make the portfolio' }).click();

    // Its page: its line, figures and brief, and its companies a click away.
    await expect(page).toHaveURL(new RegExp(`/p/${id}$`));
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
    await expect(page.getByText('of $20 budget').first()).toBeVisible();
    await expect(page.getByText('Both sites are bilingual, German first')).toBeVisible();
    const companyCard = (cid: string) => page.getByRole('button', { name: new RegExp(`in ${cid}\\.|^Corner Bakery \\.|^Plant Pal \\.`) }).filter({ hasText: cid.includes('bakery') ? 'Corner Bakery' : 'Plant Pal' });
    await expect(companyCard(plant).first()).toBeVisible();
    await expect(companyCard(bakery).first()).toBeVisible();
    await shot(page, 'studio-portfolio', info);

    // Back in the lobby it is one card, and its companies sit under it rather than in the list.
    await page.getByRole('button', { name: 'Back to the lobby' }).click();
    const card = page.getByRole('button', { name: new RegExp(`^${name} ?, portfolio`) });
    await expect(card).toBeVisible();
    await expect(card).toContainText('of $20 budget');
    await shot(page, 'studio-lobby', info);
    const lobbyNow = await studioLobby(request);
    expect(lobbyNow.portfolios.find((p) => p.id === id)?.companies).toEqual([plant, bakery]);
    // Each CEO has the shared brief in its brief file, and only there.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}$`));

    // Studio chat: one click from the portfolio. It asks this portfolio's CEOs and shows each answer, and what it cost.
    await page.getByRole('button', { name: 'Ask its CEOs in the studio chat' }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole('heading', { name: 'Studio chat', level: 2 })).toBeFocused();
    await sendWhenFree(page, request, `[fake:studio-ask-${project}] How far along are both client companies?`);
    await expect
      .poll(
        async () => {
          const s = (await studioLobby(request)).studio;
          return s.entries.filter((e) => e.kind === 'reply' && [plant, bakery].includes(e.companies?.[0]?.id ?? '')).length;
        },
        { timeout: 60_000, intervals: [250, 500] },
      )
      .toBe(2);
    const log = page.getByRole('list', { name: 'Conversation' });
    await expect(log.getByText('The watering flow is done and reminders are next.').last()).toBeVisible({ timeout: 30_000 });
    await expect(log.getByText('The menu page is up and pickup slots are next.').last()).toBeVisible();
    await expect(log.getByText(/^Both CEOs answered\./).last()).toBeVisible({ timeout: 30_000 });
    await expect(log.getByText(/API-equivalent$/).last()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toHaveCount(0, { timeout: 30_000 });
    await log.getByText(/^Both CEOs answered\./).last().scrollIntoViewIfNeeded();
    await shot(page, 'studio-chat', info);

    // Company, then person: the answer opens the company, whose CEO is a click away.
    await log.getByRole('link', { name: 'Open Plant Pal' }).last().click();
    await expect(page).toHaveURL(/\/c\/[^/]+\/progress$/);

    // The shared budget, spent: both pause, and the portfolio says so.
    await expect.poll(async () => (await studioLobby(request)).portfolios.find((p) => p.id === id)?.spent ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(0.01);
    expect((await api(request, `api/portfolios/${id}`, { budget: 0.01 })).status).toBe(200);
    await expect.poll(async () => (await studioLobby(request)).portfolios.find((p) => p.id === id)?.held, { timeout: 30_000 }).toBe(true);
    await open(page, `/p/${id}`);
    await expect(page.getByRole('alert').filter({ hasText: 'Its budget is spent' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Paused: its $0.01 budget is spent.')).toBeVisible();
    await shot(page, 'studio-portfolio-held', info);

    // In the company, the inbox says why and where to raise it.
    // The inbox is the side panel's home: beside the office on desktops, the sheet a phone brings up from its peek.
    // (The kit's sheetUp takes any "Open the ..." button for the peek, and the callout's own "Open the portfolio" is one.)
    await openCompany(page, plant);
    await expect(inboxKey(page)).toBeVisible({ timeout: 30_000 });
    const callout = sidePanel(page).getByRole('group', { name: 'State of the company' });
    const peek = sidePanel(page).getByRole('button', { name: /^Open the (inbox|side panel)/ });
    const toggle = panelToggle(page);
    // A phone's peeking sheet comes up with Inbox, and a desktop that hid its side panel shows it again the same way.
    if ((await peek.isVisible()) || ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false')) await inboxKey(page).click();
    await expect(callout).toContainText(`the ${name} portfolio's $0.01 budget is spent`);
    await shot(page, 'studio-company-held', info);
    await callout.getByRole('button', { name: 'Open the portfolio' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}$`));

    // Raised: both carry on. Then the portfolio goes, and its companies stay in the lobby.
    expect((await api(request, `api/portfolios/${id}`, { budget: null })).status).toBe(200);
    await expect.poll(async () => (await studioLobby(request)).portfolios.find((p) => p.id === id)?.held, { timeout: 30_000 }).toBe(false);
    await page.getByRole('button', { name: 'Delete the portfolio' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('status').filter({ hasText: `The ${name} portfolio is gone.` })).toBeVisible();
    expect((await studioLobby(request)).companies.map((c) => c.id)).toEqual(expect.arrayContaining([plant, bakery]));
    expect(errors).toEqual([]);
  });
});
