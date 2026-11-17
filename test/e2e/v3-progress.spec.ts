import { expect, type Page, test } from '@playwright/test';
import type { CompanyView } from '../../src/core/company.ts';
import {
  addressOf,
  companyAddress,
  expectAddress,
  feed,
  inboxKey,
  layoutOf,
  moreKey,
  onElement,
  open,
  openCompany,
  openMore,
  openProgress,
  panelTitle,
  running,
  sheetUp,
  shot,
  sidePanel,
  strip,
  talkBar,
  talkBox,
  tell,
  until,
  watchErrors,
  openInbox,
  inboxCard,
  switchTo,
} from './v3-kit.ts';
import { api, view } from './v3-world.ts';

// v0.2's progress view (docs/design-v3.md, "Progress"; SPEC-v0.2.md, "Simple, visible, proven"): where every entry point
// lands, the stage it shows, where its needs-you links open, what happened since you last looked, More reaching every
// view the bar used to hold, every older address still opening, and the end of a plan: the final review marks the
// checklist and the handover leads with it. Also the simpler bar and talk bar around it (Robin, 13 Nov 2026).

const DEMO = 'demo';
const isDesk = (page: Page) => !layoutOf(page).phone;
/** The progress column's heading, and the stage pill beside it. */
const progressHead = (page: Page) => page.locator('[data-progress]').getByRole('heading', { level: 2, name: 'Progress' });
const stageIn = (page: Page) => page.locator('[data-progress] .progress__title-row');
const section = (page: Page, name: RegExp) => page.locator('[data-progress]').getByRole('region', { name });
/**
 * A company's card in the lobby: "Plant Pal in <folder>. …" when another company has the same name (the shared hub has
 * many), "Plant Pal . …" when it is the only one.
 */
const cardOf = (page: Page, id: string) => page.getByRole('button', { name: new RegExp(`^Plant Pal in ${id}\\.|^Plant Pal \\.`) });
/** Opens a company of the demo hub (the café is `demo`, the finished one `rhine-swim`) on its progress. */
const demoProgress = async (page: Page, id: string) => {
  await open(page, `/c/${id}/progress?demo`);
  await expect(progressHead(page)).toBeVisible({ timeout: 30_000 });
};

// v0.8 (SPEC-v0.8.md, "office first"): a company opens on its office; Progress is a panel of its own, one at a time.
test.describe('landing on the office, progress on demand', () => {
  test('a lobby card lands on the office with the card; Progress opens beside it with the side panel closed, and the inbox closes it', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const id = await running(request, `progress-land-${info.project.name}`);
    await open(page, '/');
    const card = cardOf(page, id);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expectAddress(page, companyAddress(id));
    await expect(moreKey(page)).toBeVisible({ timeout: 30_000 });
    await expect(panelTitle(page)).toBeHidden();
    await switchTo(page, 'Progress');
    await expectAddress(page, companyAddress(id, { main: 'progress' }));
    await expect(progressHead(page)).toBeVisible({ timeout: 30_000 });
    // One stage everywhere: the column's pill and the bar's say the same word (a phone's bar has the stage's dot).
    await expect(stageIn(page)).toContainText('Working');
    if (isDesk(page)) await expect(page.getByRole('banner')).toContainText('Working');
    await expect(page.locator('[data-progress]')).toContainText('A plant care app with watering streaks');
    if (isDesk(page)) {
      // The office draws whole beside the column; the side panel stays closed.
      await expect(page.locator('.stage[data-mode="office"] canvas')).toBeVisible();
      await expect(panelTitle(page)).toBeHidden();
      const column = await page.locator('[data-progress]').boundingBox();
      const window = page.viewportSize() ?? { width: 1440, height: 900 };
      expect((column?.x ?? 0) + (column?.width ?? 0), 'the column leaves the office room').toBeLessThan(window.width * 0.6);
      // One panel at a time: the inbox closes Progress and opens over the office.
      await openInbox(page);
      await expect(panelTitle(page)).toBeVisible();
      await expectAddress(page, companyAddress(id));
      await expect(progressHead(page)).toHaveCount(0);
    }
    await shot(page, 'progress-landed', info);
    expect(errors).toEqual([]);
  });

  test("a world's sign on the demo's mat lands on the office too, and says Done for a finished company", async ({ page }) => {
    test.skip(!isDesk(page), 'The worlds on the mat are a desktop thing; phones list the cards, checked above.');
    const errors = watchErrors(page);
    await open(page, '/?demo');
    // A sign is a mouse target over its world (the panel's card is the accessible twin, so the sign is hidden from the
    // accessibility tree): found by its words.
    const sign = page.locator('.labels .room-sign__button', { hasText: 'Rhine Swim' });
    await expect(sign).toBeVisible({ timeout: 30_000 });
    await expect(sign).toContainText('Done');
    await sign.click();
    await expectAddress(page, companyAddress('rhine-swim'));
    await expect(moreKey(page)).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});

test.describe("the demo café's progress", () => {
  // v0.8: Progress says how many need you in one line, with See all; the card over the talk bar shows the next one.
  test('needs you is one line with See all, not a second list of the inbox', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openProgress(page, DEMO);
    const needs = section(page, /^Needs you/);
    await expect(needs).toBeVisible();
    await expect(needs.getByRole('listitem')).toHaveCount(0);
    if (isDesk(page)) {
      await expect(needs).toContainText(/^Needs you\s*\S+ things need you\. The next one is above the talk bar\./);
      await expect(inboxCard(page)).toBeVisible();
    } else {
      // A phone's progress fills the screen: the card waits for the office, and the line doesn't point at it.
      await expect(needs).toContainText(/^Needs you\s*\S+ things need you\. See all$/);
      await expect(inboxCard(page)).toHaveCount(0);
    }
    await shot(page, 'progress-needs-line', info);
    await needs.getByRole('button', { name: 'See all', exact: true }).click();
    await expect(panelTitle(page)).toHaveAccessibleName(/^Inbox\b/);
    expect(errors).toEqual([]);
  });

  test('since you last looked: the lead line and See what, the section at the foot with the files a press away', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openProgress(page, DEMO);
    const lead = page.locator('[data-progress]').getByText(/^Since you last looked, 3 h ago: three tasks finished/);
    await expect(lead).toBeVisible();
    await lead.getByRole('link', { name: 'See what' }).click();
    const since = section(page, /^Since you last looked$/);
    await expect(since).toBeInViewport();
    await expect(since).toContainText('You last looked 3 h ago.');
    await expect(since.getByRole('heading', { name: 'Three tasks finished' })).toBeVisible();
    await shot(page, 'progress-since', info);
    expect(errors).toEqual([]);
  });

  test("Rhine Swim, finished: Done everywhere, the checklist marked, and nothing needs you", async ({ page }, info) => {
    const errors = watchErrors(page);
    await demoProgress(page, 'rhine-swim');
    await expect(stageIn(page)).toContainText('Done');
    // The bar's pill says Done too, where it used to say Idle.
    await expect(page.getByRole('banner')).not.toContainText('Idle');
    if (isDesk(page)) await expect(page.getByRole('banner')).toContainText('Done');
    await expect(section(page, /^Checklist$/)).toContainText('5 of 6 met, 1 partly met.');
    await expect(section(page, /^Needs you/)).toContainText('Nothing needs you. The work is done');
    await shot(page, 'progress-done', info);
    expect(errors).toEqual([]);
  });
});

test.describe('More and the old addresses', () => {
  test('More reaches every view the bar used to hold', async ({ page }, info) => {
    // Five views, each opened from More and back to progress: slow on a busy machine, never stuck.
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await openProgress(page, DEMO);
    const views: [string, string][] = [
      ['Org chart', 'org'],
      ['Dashboards', 'dashboards'],
      ['Decision log', 'decisions'],
      ['Spending', 'dashboards/spend'],
      ['Timeline', 'dashboards/timeline'],
    ];
    for (const [name, main] of views) {
      const more = await openMore(page);
      await more.getByRole('link', { name, exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname, { message: `${name} opens ${main}` }).toBe(`/c/${DEMO}/${main}`);
      await expect(moreKey(page)).toHaveAttribute('aria-current', 'true');
      await openProgress(page, DEMO);
    }
    // Your messages opens the feed; Find an action, the palette; the figures the bar dropped are there.
    let more = await openMore(page);
    await expect(more.getByText('At work')).toBeVisible();
    await expect(more.getByText('Burn, last 5 min')).toBeVisible();
    await expect(more.getByRole('link', { name: /budget spent, API-equivalent/ })).toBeVisible();
    await shot(page, 'progress-more', info);
    await more.getByRole('button', { name: 'Your messages', exact: true }).click();
    await expect(feed(page)).toBeVisible();
    await page.keyboard.press('Escape');
    more = await openMore(page);
    await more.getByRole('button', { name: /^Find an action/ }).click();
    await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('every older address still opens what it did', async ({ page }) => {
    const errors = watchErrors(page);
    const desk = isDesk(page);
    const cases: { path: string; sees: (p: Page) => ReturnType<Page['getByRole']> }[] = [
      { path: `/c/${DEMO}`, sees: (p) => p.getByRole('heading', { level: 1, name: 'Café Lumen office' }) },
      { path: `/c/${DEMO}/org`, sees: (p) => p.getByRole('heading', { level: 2, name: 'Org chart', exact: true }) },
      { path: `/c/${DEMO}/tasks`, sees: (p) => p.getByRole('heading', { level: 2, name: 'Tasks', exact: true }) },
      { path: `/c/${DEMO}/plan`, sees: (p) => p.getByRole('heading', { name: 'The plan', level: 3, exact: true }) },
      { path: `/c/${DEMO}/dashboards`, sees: (p) => p.getByRole('heading', { level: 2, name: 'Dashboards', exact: true }) },
      { path: `/c/${DEMO}/decisions`, sees: (p) => p.getByRole('heading', { level: 2, name: 'Dashboards', exact: true }) },
      { path: `/c/${DEMO}?panel=people/ui-designer`, sees: (p) => p.getByRole('complementary', { name: 'Side panel' }).getByRole('heading', { level: 2, name: 'Mina' }) },
      { path: `/c/${DEMO}/progress`, sees: (p) => progressHead(p) },
    ];
    for (const c of cases) {
      await open(page, c.path);
      await expect(moreKey(page), c.path).toBeVisible({ timeout: 30_000 });
      if (c.path.includes('?panel=') && !desk) await expect(c.sees(page), c.path).toBeAttached({ timeout: 30_000 });
      else await expect(c.sees(page), c.path).toBeVisible({ timeout: 30_000 });
    }
    expect(errors).toEqual([]);
  });
});

test.describe('the simpler bar and talk bar', () => {
  // v0.8: the slim bar is Lobby, the name, the stage, the meter and More; the views and Inbox moved into More.
  test('the bar holds the stage, the meter and More; the views, Inbox, Actions, the ledger and the toggle moved', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const bar = page.getByRole('banner');
    await expect(bar.getByRole('navigation', { name: 'Views' })).toHaveCount(0);
    await expect(inboxKey(page)).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Actions', exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: /^(Hide|Show) the side panel$/ })).toHaveCount(0);
    await expect(bar.getByText('At work', { exact: true })).toHaveCount(0);
    await expect(bar.getByText('Burn, last 5 min')).toHaveCount(0);
    await openMore(page);
    await expect(inboxKey(page)).toHaveAccessibleName(/^Inbox \d+, \S+ needs? you$/);
    await page.keyboard.press('Escape');
    // The demo's preview isn't running, so Preview waits in More.
    await expect(bar.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
    if (isDesk(page)) {
      const meter = bar.getByRole('link', { name: /budget spent, API-equivalent$/ });
      await expect(meter).toHaveText(/^\$\d+ of \$60$/);
      await expect(meter).toHaveAttribute('title', /API-equivalent/);
      await meter.click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/c/${DEMO}/dashboards/spend`);
    }
    await shot(page, 'bar-simple', info);
    expect(errors).toEqual([]);
  });

  // v0.8: the live strip is off by default (More's "Show the live strip" brings it back), and rides on the office only.
  test('the live strip is off until More shows it, rides on the office only, and an empty box offers chips that run as the palette does', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    await expect(strip(page)).toHaveCount(0);
    await (await openMore(page)).getByRole('button', { name: 'Show the live strip' }).click();
    if (!layoutOf(page).short) await expect(strip(page)).toBeVisible({ timeout: 30_000 });
    await openProgress(page, DEMO);
    await expect(strip(page)).toHaveCount(0);
    // Feed is a small key with its name for a screen reader (on phones, the Feed key over the bar takes the strip's place).
    if (isDesk(page)) await expect(talkBar(page).getByRole('button', { name: /^Feed\b/ })).toHaveText('');
    await talkBox(page).focus();
    const chips = talkBar(page).getByRole('group', { name: 'Things to do' });
    await expect(chips).toBeVisible();
    await expect(chips.getByRole('button', { name: "Ask Mara how it's going" })).toBeVisible();
    await expect(chips.getByRole('button', { name: 'Pause work' })).toBeVisible();
    await shot(page, 'talk-chips', info);
    // Words in the box put the chips away.
    await talkBox(page).fill('Hello');
    await expect(chips).toBeHidden();
    await talkBox(page).fill('');
    await talkBox(page).focus();
    // Asking the CEO opens the palette's message command at its step, the words filled in, ready to send.
    await chips.getByRole('button', { name: "Ask Mara how it's going" }).click();
    const dialog = page.getByRole('dialog', { name: 'Actions' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveValue('How is it going?');
    await page.keyboard.press('Escape');
    // Pause work needs nothing more: it runs at once, with the palette's toast and its Undo.
    await talkBox(page).focus();
    await chips.getByRole('button', { name: 'Pause work' }).click();
    await expect(page.getByTestId('palette-toast')).toBeVisible();
    await expect(dialog).toBeHidden();
    await page.getByTestId('palette-toast').getByRole('button', { name: 'Undo' }).click();
    expect(errors).toEqual([]);
  });
});

test.describe('the end of a plan', () => {
  test('the final review marks the checklist, and the handover leads with it', async ({ page, request }, info) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    const id = await running(request, `progress-end-${info.project.name}`, { planApproval: 'before-work' });
    // The CEO's start turn proposes the plan, its checklist quoting the prompt.
    const plan = await until(request, id, (c) => c.steering?.plan?.versions.at(-1));
    expect(plan.plan.checklist?.map((k) => k.quote)).toEqual(['watering streaks', 'A plant care app']);
    const approved = await api(request, `api/c/${id}/plan/approve`, { version: plan.version, through: null });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    // Each maker finishes their task as it reaches them; the office runs each task's check itself.
    const owners: Record<string, string> = { 'p-1': 'ux-designer', 'p-2': 'frontend-engineer', 'p-3': 'ui-designer' };
    const doneOf = (c: CompanyView, planTask: string) => c.tasks.find((t) => t.planTask === planTask)?.status === 'done';
    for (const planTask of ['p-1', 'p-3', 'p-2']) {
      const task = await until(request, id, (c) => c.tasks.find((t) => t.planTask === planTask && t.status !== 'queued'), 120_000);
      await tell(request, id, owners[planTask] ?? 'ceo', `[fake:finish] [task ${task.id}] Report it done.`);
      await until(request, id, (c) => doneOf(c, planTask), 120_000);
    }
    // The final review (Tom, the QA engineer, in a fresh desk) marks every item met, then reports; the plan is done and
    // the CEO writes the handover.
    const finished = await until(request, id, (c) => (c.done ?? null) !== null && c.checklist?.counts.met === 2 && c, 180_000);
    expect(finished.checklist?.rows.map((r) => r.verdict?.by)).toEqual(['qa-engineer', 'qa-engineer']);
    await until(request, id, (c) => c.reports.some((r) => r.person === 'ceo' && r.taskId === null && r.text.includes('Plant Pal is built')), 120_000);

    await openProgress(page, id);
    await expect(stageIn(page)).toContainText('Done');
    await expect(section(page, /^Checklist$/)).toContainText('2 of 2 met.');
    await expect(section(page, /^Checklist$/)).toContainText('A plant can be watered and its streak grows.');
    await shot(page, 'progress-final-review', info);

    // The inbox opens on the handover: what you asked for first, then the CEO's words.
    await openInbox(page);
    if (!isDesk(page)) await sheetUp(page);
    const handover = sidePanel(page).getByRole('region', { name: 'Done: the final handover' });
    await expect(handover).toBeVisible({ timeout: 30_000 });
    const asked = handover.getByRole('heading', { name: 'What you asked for' });
    const ceo = handover.getByRole('heading', { name: 'From the CEO' });
    await expect(asked).toBeVisible();
    await expect(ceo).toBeVisible();
    const order = await handover.evaluate(onElement<string[]>("return [...el.querySelectorAll('h4')].map((h) => h.textContent.trim());"));
    expect(order).toEqual(['What you asked for', 'From the CEO']);
    await expect(handover).toContainText('Plant Pal is built');
    await shot(page, 'handover-checklist', info);

    // The lobby's card says Done, as the bar does.
    expect((await view(request, id)).done).not.toBeNull();
    await open(page, '/');
    await expect(cardOf(page, id)).toContainText('Done', { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});

test.describe("the lobby's needs-you strip", () => {
  test('one number, every item behind Show all, and each opens its company at the right place', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const id = await running(request, `progress-strip-${info.project.name}`);
    await tell(request, id, 'ceo', '[fake:ask] Ask me about payments');
    await until(request, id, (c) => c.questions.find((q) => q.text.includes('Which payment')));
    await open(page, '/');
    const strip = page.getByRole('region', { name: /^Needs you/ });
    await expect(strip).toBeVisible({ timeout: 30_000 });
    // The badge is the list's own length: Show all names the same number and shows every item. The shared hub has other
    // specs' companies, so the number is read from the page.
    const toggle = strip.getByRole('button', { name: /^Show all/ });
    if (await toggle.isVisible()) {
      const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
      const said = (await toggle.innerText()).replace(/^Show all /, '').trim();
      const total = words.includes(said) ? words.indexOf(said) : Number(said);
      await expect(strip.getByRole('heading')).toContainText(String(total));
      await toggle.click();
      await expect(strip.getByRole('listitem')).toHaveCount(total);
    }
    await expect(strip).not.toContainText('more wait');
    const item = strip.getByRole('link', { name: new RegExp(`^Plant Pal( in ${id})?: Noor: Which payment`) });
    await item.click();
    await expect.poll(() => addressOf(page)).toMatch(new RegExp(`^/c/${id}/progress\\?panel=inbox/`));
    if (isDesk(page)) await expect(sidePanel(page)).toContainText('Which payment should the app take?');
    expect(errors).toEqual([]);
  });
});
