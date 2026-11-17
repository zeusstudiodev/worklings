import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  addressOf,
  companyAddress,
  expectAddress,
  expectNoSidewaysScroll,
  focusTop,
  FOCUSED_THING,
  fromPalette,
  HIDDEN_FOCUS,
  hiddenFocus,
  inboxCard,
  inboxKey,
  layoutOf,
  moreKey,
  onElement,
  onElements,
  open,
  openBoard,
  openCompany,
  openInbox,
  openMore,
  openPanel,
  panelTitle,
  scratchOf,
  waitForProposal,
  separator,
  shot,
  sidePanel,
  switchTo,
  talkBar,
  talkBox,
  viewLinks,
  viewLinkName,
  watchErrors,
} from './v3-kit.ts';
import { found } from './v3-world.ts';

// H56 (AC32), the shell of the stage and dock (docs/design-v3.md, "The shell"): the view switcher, the side panel opened,
// closed, hidden, resized by keys and by drag and remembered, floating from 721 to 895 px, sheets on phones, the order
// Escape works in, and focus never hidden. All in the demo company, Café Lumen, whose inbox has things waiting. Every
// test is a first visit: Playwright gives each its own browser storage.

const DEMO = 'demo';

/** The docked side panel's widths for a window (The shell): 300 to min(560, window − 596); 320 by default below 1280, 360 from it. */
function dockedWidths(window: number) {
  const widest = Math.min(560, window - 596);
  return { narrow: 300, widest, normal: Math.min(window >= 1280 ? 360 : 320, widest) };
}

const widthOf = async (target: Locator): Promise<number> => (await target.boundingBox())?.width ?? 0;
const valueOf = async (page: Page): Promise<number> => Number(await separator(page).getAttribute('aria-valuenow'));

/** The side panel's width as the separator says it and as it is drawn, which agree. */
async function expectWidth(page: Page, width: number, message: string): Promise<void> {
  await expect(separator(page), message).toHaveAttribute('aria-valuenow', String(width));
  await expect(separator(page)).toHaveAttribute('aria-valuetext', `${width} pixels wide`);
  await expect.poll(() => widthOf(sidePanel(page)), { message: `${message}: as drawn` }).toBeCloseTo(width, 0);
}

/** Whether the focused element is the last of the page's Tab stops, so the next Tab leaves the page. */
const LAST_STOP = `(() => {
    const el = document.activeElement;
    const stop = (n) => {
      if (n.disabled || n.closest('[inert]')) return false;
      const index = n.getAttribute('tabindex');
      if (index !== null && Number(index) < 0) return false;
      const style = getComputedStyle(n);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const box = n.getBoundingClientRect();
      return box.width > 0 || box.height > 0;
    };
    const last = () => [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')].filter(stop).at(-1);
    // Finding the last stop reads every candidate's style, which a Tab walk of a whole office can't afford at each stop:
    // it is found once and found again only when focus reaches it (or it left the page), so a change is still seen.
    const known = window.__lastTabStop;
    if (!known || !known.isConnected || known === el) window.__lastTabStop = last();
    return window.__lastTabStop === el;
  })()`;

/**
 * One Tab stop's checks in one call: the office keeps the page's main thread busy drawing, so each call waits its turn,
 * and a walk of a whole office can't afford three of them per stop.
 */
const tabStop = async (page: Page): Promise<{ hidden: string | null; thing: string; last: boolean }> =>
  (await page.evaluate(`({ hidden: ${HIDDEN_FOCUS}, thing: ${FOCUSED_THING}, last: ${LAST_STOP} })`)) as { hidden: string | null; thing: string; last: boolean };

/** v0.8: a closed side panel leaves nothing on the window's edge after the start: no title, no separator, no pull. */
async function expectHidden(page: Page): Promise<void> {
  await expect(panelTitle(page)).toBeHidden();
  await expect(separator(page)).toHaveCount(0);
}

/** Puts focus on nothing, as after a click on the office's empty floor. */
const blur = (page: Page) => page.evaluate('document.activeElement && document.activeElement.blur()');

// v0.8 (SPEC-v0.8.md, "office first"): the bar has no views row; every view is in More, at every size.
test.describe('the views, in More', () => {
  test('every view is in More, the current one marked, each an address of its own', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    await expect(page.getByRole('banner').getByRole('navigation', { name: 'Views' }), 'no views row in the bar').toHaveCount(0);
    // The Views group of More (More's money line is a link of its own, to Spending).
    const views = (await viewLinks(page)).getByRole('group', { name: 'Views' });
    const links = views.getByRole('link');
    const names = ['Progress', 'Office', 'Tasks', 'Org chart', 'Dashboards', 'Decision log', 'Spending', 'Timeline'];
    await expect(links).toHaveCount(names.length);
    for (const [i, name] of names.entries()) await expect(links.nth(i)).toHaveAccessibleName(name);
    await expect(views.getByRole('link', { name: 'Office', exact: true })).toHaveAttribute('aria-current', 'page');
    await shot(page, 'h56-views-office', info);
    await page.keyboard.press('Escape');
    for (const [view, main] of [['Progress', 'progress'], ['Org', 'org'], ['Tasks', 'tasks'], ['Dashboards', 'dashboards'], ['Decision log', 'decisions'], ['Office', '']] as const) {
      await switchTo(page, view);
      await expectAddress(page, companyAddress(DEMO, { main }), `${view} has its own address`);
      // More is marked while any view but the office is the main view, so you can always see where you are.
      if (view === 'Office') await expect(moreKey(page)).not.toHaveAttribute('aria-current', 'true');
      else await expect(moreKey(page)).toHaveAttribute('aria-current', 'true');
      const name = viewLinkName(view);
      const now = (await viewLinks(page)).getByRole('group', { name: 'Views' });
      await expect(now.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      expect(await now.getByRole('link').evaluateAll(onElements<string[]>("return els.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('aria-label') || a.textContent.trim());"))).toEqual([name]);
      await page.keyboard.press('Escape');
      await expectNoSidewaysScroll(page, `${view} at ${info.project.name}`);
    }
    expect(errors).toEqual([]);
  });

  test("a board's link stays current on its sub-views", async ({ page }) => {
    await openCompany(page, DEMO, { main: 'plan' });
    await expect((await openMore(page)).getByRole('link', { name: 'Tasks', exact: true }), 'the plan is under Tasks').toHaveAttribute('aria-current', 'page');
    for (const [main, name] of [['decisions', 'Decision log'], ['dashboards/spend', 'Spending'], ['dashboards/timeline', 'Timeline']] as const) {
      await openCompany(page, DEMO, { main });
      await expect(moreKey(page), `${main} is behind More`).toHaveAttribute('aria-current', 'true');
      await expect((await openMore(page)).locator('[aria-current="page"]'), `${name} is current on ${main}`).toHaveText(name);
    }
  });

  test('one panel at a time: a view of its own closes the side panel', async ({ page }) => {
    const errors = watchErrors(page);
    await openPanel(page, DEMO, 'people/ui-designer');
    await expect(panelTitle(page)).toHaveText('Mina');
    await expect((await viewLinks(page)).getByRole('link', { name: 'Org chart', exact: true })).toHaveAttribute('href', companyAddress(DEMO, { main: 'org' }));
    await page.keyboard.press('Escape');
    await switchTo(page, 'Org');
    await expectAddress(page, companyAddress(DEMO, { main: 'org' }));
    await expect(sidePanel(page).getByRole('heading', { level: 2, name: 'Mina' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the side panel', () => {
  // v0.8: a first visit is the office, the slim bar and the card; the side panel opens when asked for.
  test('a first visit shows the office with the side panel closed, and More\'s Inbox opens it at its default width', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const { phone, floating } = layoutOf(page);
    await expect(inboxCard(page)).toBeVisible();
    await expectHidden(page);
    await expect(page).toHaveTitle(/^\(\d+\) Café Lumen in Worklings$/);
    await shot(page, 'h56-first-visit', info);
    await openInbox(page);
    await expect(panelTitle(page)).toHaveAccessibleName(/^Inbox, .+ needs? you$/);
    // The card steps aside while the whole list shows: what needs you is said once.
    await expect(inboxCard(page)).toHaveCount(0);
    await openMore(page);
    await expect(inboxKey(page)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    if (phone) {
      await expect(separator(page)).toHaveCount(0);
    } else if (floating) {
      await expect(separator(page)).toHaveCount(0);
      await expect.poll(() => widthOf(sidePanel(page))).toBeCloseTo(300, 0);
    } else {
      const sizes = dockedWidths(page.viewportSize()?.width ?? 1440);
      await expect(separator(page)).toHaveAttribute('aria-orientation', 'vertical');
      await expect(separator(page)).toHaveAttribute('aria-valuemin', '0');
      await expect(separator(page)).toHaveAttribute('aria-valuemax', String(sizes.widest));
      await expect(separator(page)).toHaveAttribute('aria-controls', (await sidePanel(page).getAttribute('id')) ?? 'the side panel has an id');
      await expect(separator(page)).toHaveAccessibleDescription('Left and Right resize it, Enter hides it.');
      await expectWidth(page, sizes.normal, 'the default width');
    }
    await expectNoSidewaysScroll(page);
    await shot(page, 'h56-inbox-open', info);
    expect(errors).toEqual([]);
  });

  test('the main view, the side panel and the talk bar sit where the design puts them', async ({ page }, info) => {
    await openCompany(page, DEMO);
    if (!layoutOf(page).phone) await openInbox(page);
    const window = page.viewportSize() ?? { width: 1440, height: 900 };
    const { phone, floating } = layoutOf(page);
    const bar = await talkBar(page).boundingBox();
    expect(bar, 'the talk bar is on the page').not.toBeNull();
    if (!bar) return;
    // The talk bar keeps one gutter (8 px on phones) above the window's foot, or the safe area's.
    expect(window.height - (bar.y + bar.height)).toBeGreaterThanOrEqual(phone ? 8 : 12 - 1);
    if (phone) {
      expect(bar.width).toBeCloseTo(window.width - 16, 0);
      return;
    }
    const panel = await sidePanel(page).boundingBox();
    expect(panel, 'the side panel shows once opened').not.toBeNull();
    if (!panel) return;
    // One gutter from the window's right edge, under the bar's 68 px band.
    expect(window.width - (panel.x + panel.width)).toBeCloseTo(12, 0);
    expect(panel.y).toBeGreaterThanOrEqual(68 - 1);
    if (floating) {
      // Floating: over the main view, ending one gutter above the talk bar, which keeps the window's whole width under it.
      expect(panel.y + panel.height).toBeLessThanOrEqual(bar.y - 12 + 1);
      expect(bar.width).toBeCloseTo(Math.min(760, window.width - 24), 0);
    } else {
      // Docked: the main view is what the side panel leaves, and the talk bar is centred over it, min(760, main − 24) wide.
      const main = window.width - panel.width - 24;
      expect(bar.width).toBeCloseTo(Math.min(760, main - 24), 0);
      expect(bar.x + bar.width / 2).toBeCloseTo(main / 2, -1);
      expect(bar.x + bar.width).toBeLessThanOrEqual(panel.x);
    }
    await shot(page, 'h56-layout', info);
  });

  test('what you open shows in it with focus on its title; Back steps between its views and Close closes them', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    await fromPalette(page, 'Mina', /^Open Mina\b/);
    await expect(panelTitle(page)).toHaveText('Mina');
    await expect(panelTitle(page)).toBeFocused();
    await expectAddress(page, companyAddress(DEMO, { panel: 'people/ui-designer' }));
    // Nothing before Mina's view was another of the side panel's views: no Back yet.
    await expect(sidePanel(page).getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await sidePanel(page).getByRole('link', { name: 'Ada', exact: true }).click();
    await expect(panelTitle(page)).toHaveText('Ada');
    await expect(panelTitle(page)).toBeFocused();
    await shot(page, 'h56-person-in-side-panel', info);
    await sidePanel(page).getByRole('button', { name: 'Back', exact: true }).click();
    await expect(panelTitle(page)).toHaveText('Mina');
    await expectAddress(page, companyAddress(DEMO, { panel: 'people/ui-designer' }));
    // v0.8: the × closes the side panel, since the inbox wasn't open (it leads back to the inbox only when it was). The
    // entry before is where it leads, so it is a Back, and Forward opens Mina again.
    await sidePanel(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expectHidden(page);
    await expectAddress(page, companyAddress(DEMO));
    await page.goForward();
    await expect(panelTitle(page)).toHaveText('Mina');
    await expect(panelTitle(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('an address naming someone gone says so, with Show the inbox', async ({ page }) => {
    await openPanel(page, DEMO, 'people/nobody-here');
    await expect(sidePanel(page).getByText("That person isn't in the company any more.")).toBeVisible();
    await sidePanel(page).getByRole('button', { name: 'Show the inbox', exact: true }).click();
    await expect(panelTitle(page)).toHaveAccessibleName(/^Inbox\b/);
    await openPanel(page, DEMO, 'tasks/t-999', { main: 'tasks' });
    await expect(sidePanel(page).getByText("That task isn't on the board any more.")).toBeVisible();
  });

  // v0.8: no pull after the start and no Inbox toggle in the bar; Hide closes the panel and More's Inbox opens it.
  test('Hide closes it and More\'s Inbox brings it back, with focus where each leads', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones have sheets, without Hide.');
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    const { floating } = layoutOf(page);
    await openCompany(page, DEMO);
    await openInbox(page);
    await expect(panelTitle(page)).toBeFocused();
    const shown = floating ? 300 : await valueOf(page);
    await sidePanel(page).getByRole('button', { name: 'Hide the side panel', exact: true }).click();
    await expectHidden(page);
    // Focus goes to the talk bar's box, and the card is back over it.
    await expect(talkBox(page)).toBeFocused();
    await expect(inboxCard(page)).toBeVisible();
    await openInbox(page);
    await expect(panelTitle(page)).toBeVisible();
    await expect(panelTitle(page)).toBeFocused();
    if (!floating) await expectWidth(page, shown, 'shown again at its last width');
    // While the panel shows something else, Inbox brings the inbox back.
    await openPanel(page, DEMO, 'people/ui-designer');
    await openInbox(page);
    await expect(panelTitle(page)).toHaveAccessibleName(/^Inbox\b/);
    expect(errors).toEqual([]);
  });

  test('the separator resizes it by keys, 16 px a step and 64 with Shift, Home and End the ends, Enter hides it', async ({ page }, info) => {
    test.skip(layoutOf(page).phone || layoutOf(page).floating, 'Only a docked side panel has a separator.');
    const errors = watchErrors(page);
    const sizes = dockedWidths(page.viewportSize()?.width ?? 1440);
    await openCompany(page, DEMO);
    await openInbox(page);
    await separator(page).focus();
    await expectWidth(page, sizes.normal, 'the default');
    await page.keyboard.press('ArrowLeft');
    await expectWidth(page, sizes.normal + 16, 'Left widens it by 16');
    await page.keyboard.press('ArrowRight');
    await expectWidth(page, sizes.normal, 'Right narrows it by 16');
    await page.keyboard.press('Shift+ArrowLeft');
    await expectWidth(page, Math.min(sizes.normal + 64, sizes.widest), 'Shift and Left widen it by 64');
    await page.keyboard.press('Home');
    await expectWidth(page, sizes.narrow, 'Home is the narrowest');
    await page.keyboard.press('ArrowRight');
    await expectWidth(page, sizes.narrow, 'never under 300');
    await page.keyboard.press('End');
    await expectWidth(page, sizes.widest, 'End is the widest');
    await page.keyboard.press('ArrowLeft');
    await expectWidth(page, sizes.widest, 'never over the widest');
    await shot(page, 'h56-widest', info);
    // v0.8: Enter closes it (no pull is left to show it again), and More's Inbox opens it at its last width.
    await page.keyboard.press('Enter');
    await expectHidden(page);
    await expect(talkBox(page)).toBeFocused();
    await openInbox(page);
    await expectWidth(page, sizes.widest, 'opened again at its last width');
    expect(errors).toEqual([]);
  });

  test('the separator resizes it by drag, and a press steps through narrow, default and wide', async ({ page }) => {
    test.skip(layoutOf(page).phone || layoutOf(page).floating, 'Only a docked side panel has a separator.');
    const errors = watchErrors(page);
    const window = page.viewportSize() ?? { width: 1440, height: 900 };
    const sizes = dockedWidths(window.width);
    await openCompany(page, DEMO);
    await openInbox(page);
    // A press without dragging steps through the three widths, so no width needs a drag (WCAG 2.5.7).
    const pressed = new Set<number>();
    for (let i = 0; i < 3; i++) {
      await separator(page).click();
      pressed.add(await valueOf(page));
    }
    expect([...pressed].sort((a, b) => a - b)).toEqual([...new Set([sizes.narrow, sizes.normal, sizes.widest])].sort((a, b) => a - b));
    // A drag follows the pointer between 300 and the widest.
    await page.keyboard.press('Home');
    const grip = async () => {
      const b = await separator(page).boundingBox();
      return { x: (b?.x ?? 0) + (b?.width ?? 0) / 2, y: (b?.y ?? 0) + (b?.height ?? 0) / 2 };
    };
    let at = await grip();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 60, at.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => valueOf(page), { message: 'dragged 60 px wider' }).toBeGreaterThanOrEqual(sizes.narrow + 58);
    expect(await valueOf(page)).toBeLessThanOrEqual(sizes.narrow + 62);
    await expect.poll(() => widthOf(sidePanel(page))).toBeCloseTo(await valueOf(page), 0);
    at = await grip();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(40, at.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => valueOf(page), { message: 'dragged past the widest' }).toBe(sizes.widest);
    at = await grip();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(window.width - 4, at.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => valueOf(page), { message: 'dragged past the narrowest, it stays shown' }).toBe(sizes.narrow);
    expect(errors).toEqual([]);
  });

  test('its width is kept for the next visit, fitted to the window, and a visit starts with it closed', async ({ page }) => {
    test.skip(layoutOf(page).phone || layoutOf(page).floating, 'Only a docked side panel has a width to keep.');
    const errors = watchErrors(page);
    const window = page.viewportSize() ?? { width: 1440, height: 900 };
    await openCompany(page, DEMO);
    await openInbox(page);
    await separator(page).focus();
    await page.keyboard.press('End');
    const widest = dockedWidths(window.width).widest;
    await expectWidth(page, widest, 'the widest');
    await page.reload();
    await expect(moreKey(page)).toBeVisible();
    await expectHidden(page);
    await openInbox(page);
    await expectWidth(page, widest, 'kept across a reload');
    // A narrower window fits what was kept.
    await page.setViewportSize({ width: 1000, height: window.height });
    await page.reload();
    await openInbox(page);
    await expectWidth(page, dockedWidths(1000).widest, 'fitted to a narrower window');
    expect(errors).toEqual([]);
  });

  test('blocked storage gives the defaults and nothing breaks', async ({ page }) => {
    test.skip(layoutOf(page).phone || layoutOf(page).floating, 'Only a docked side panel has a width to keep.');
    const errors = watchErrors(page);
    await page.addInitScript(`Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });`);
    await openCompany(page, DEMO);
    await openInbox(page);
    await expectWidth(page, dockedWidths(page.viewportSize()?.width ?? 1440).normal, 'the default width');
    await separator(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(separator(page)).toHaveAttribute('aria-valuenow', String(dockedWidths(page.viewportSize()?.width ?? 1440).normal + 16));
    expect(errors).toEqual([]);
  });

  test("phones: the side panel is a sheet that Back and Close put away, and the inbox's sheet doesn't leave the company", async ({ page }, info) => {
    test.skip(!layoutOf(page).phone, 'Sheets are the phone layout.');
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    // v0.8: the card over the talk bar is the way in; See all raises the inbox's sheet as an entry of its own (it has no
    // address), so Back puts it away again and the company stays.
    await inboxCard(page).getByRole('button', { name: 'See all', exact: true }).click();
    await expect(panelTitle(page)).toHaveAccessibleName(/^Inbox\b/);
    await page.goBack();
    await expectHidden(page);
    await expect(inboxCard(page)).toBeVisible();
    await expectAddress(page, companyAddress(DEMO));
    await openPanel(page, DEMO, 'people/ui-designer');
    await expect(panelTitle(page)).toHaveText('Mina');
    if (!layoutOf(page).short) await expect(page.getByRole('button', { name: 'Show the office', exact: true })).toBeVisible();
    await shot(page, 'h56-phone-sheet', info);
    await sidePanel(page).getByRole('button', { name: /^(Close|Back to the inbox)$/ }).first().click();
    await expect(sidePanel(page).getByRole('heading', { level: 2, name: 'Mina' })).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    expect(errors).toEqual([]);
  });
});

test.describe('Escape and focus', () => {
  test('Escape closes a menu first, then the board; never from the side panel or the talk bar', async ({ page }) => {
    test.skip(layoutOf(page).phone, "Phones' boards are sheets, closed by Back and Close (v3-boards).");
    const errors = watchErrors(page);
    // v0.8: the side panel shows once something opens in it; here a person beside the board.
    await openBoard(page, DEMO, 'tasks', { panel: 'people/ui-designer' });
    // The address as it was opened (the query as the browser writes it), which no Escape but the board's may change.
    const board = addressOf(page);
    // An open menu closes, with focus back on its button, and the board stays.
    const company = moreKey(page);
    await company.click();
    await expect(company).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(company).toHaveAttribute('aria-expanded', 'false');
    await expect(company).toBeFocused();
    await expectAddress(page, board);
    // In the side panel nothing past the palette: Back, the × and Hide do the rest.
    await panelTitle(page).focus();
    await page.keyboard.press('Escape');
    await expectAddress(page, board, 'Escape in the side panel leaves the board open');
    await expect(panelTitle(page)).toBeVisible();
    // In the talk bar Escape never closes a board while you type, and the words stay.
    await talkBox(page).fill('Half a thought');
    await page.keyboard.press('Escape');
    await expectAddress(page, board, 'Escape in the talk bar leaves the board open');
    await expect(talkBox(page)).toHaveValue('Half a thought');
    // On nothing, the board closes, and focus goes to the office's heading (nothing opened it on this page).
    await blur(page);
    await page.keyboard.press('Escape');
    await expectAddress(page, companyAddress(DEMO, { panel: 'people/ui-designer' }));
    await expect(page.getByRole('heading', { level: 1, name: 'Café Lumen office' })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('Enter on nothing puts focus in the talk bar', async ({ page }) => {
    await openCompany(page, DEMO);
    await blur(page);
    await page.keyboard.press('Enter');
    await expect(talkBox(page)).toBeFocused();
  });

  test('the skip links come first and lead to the talk bar and the side panel, which opens on the inbox', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Checked at desktop sizes, where the side panel and the talk bar are both on screen.');
    await openCompany(page, DEMO);
    await focusTop(page);
    await page.keyboard.press('Tab');
    const toTalk = page.getByRole('link', { name: 'Skip to the talk bar', exact: true });
    await expect(toTalk).toBeFocused();
    expect(await hiddenFocus(page), 'the skip link shows on focus').toBeNull();
    await page.keyboard.press('Enter');
    await expect(talkBox(page)).toBeFocused();
    await focusTop(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the side panel', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => sidePanel(page).evaluate(onElement<boolean>('return el.contains(document.activeElement);'))).toBe(true);
  });

  test('Tab through the office never puts focus under the talk bar, the strip, the caption or the side panel', async ({ page }, info) => {
    // A walk of up to 120 stops on a page that draws the office in software WebGL: at 1440 x 900 on a busy machine each
    // stop waits behind the drawing for about a second (15 ms on a quiet one), so the walk needs more than the default.
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    await focusTop(page);
    const seen = new Set<string>();
    let before = 'the top of the page';
    let stops = 0;
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Tab');
      const at = await tabStop(page);
      expect(at.hidden, `Tab stop ${i}`).toBeNull();
      expect(at.thing, `focus is lost at Tab stop ${i}, after ${before}`).not.toBe('nothing');
      before = at.thing;
      stops++;
      seen.add(addressOf(page));
      // The order ends at the page's last stop (a window shows fewer stops than 120, a phone with its sheet peeking far
      // fewer): the next Tab would leave the page for the browser's own controls, which is no loss of focus.
      if (at.last) break;
    }
    expect(stops, 'Tab reaches the whole order, from the skip links to its last stop').toBeGreaterThan(10);
    // Tabbing moves focus; it never navigates.
    expect([...seen]).toEqual([companyAddress(DEMO)]);
    await shot(page, 'h56-tab-office', info);
    expect(errors).toEqual([]);
  });
});

for (const [width, height] of [
  [812, 375],
  [720, 450],
  [844, 390],
  [768, 432],
] as const) {
  test.describe(`a short window, ${width} x ${height} (final gates, F2)`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    // v0.8: no peek and no front desk sign; the office shows between the bar and the card over the talk bar.
    test('the office shows between the bar and the inbox card', async ({ page }, info) => {
      test.skip(info.project.name !== 'v3', 'One project drives every size here.');
      const errors = watchErrors(page);
      await openCompany(page, DEMO);
      const card = await inboxCard(page).boundingBox();
      const talk = await talkBar(page).boundingBox();
      expect(card, 'the card shows').not.toBeNull();
      expect((card?.y ?? 0) + (card?.height ?? 0), 'the card ends above the talk bar').toBeLessThanOrEqual(talk?.y ?? 0);
      await expect(page.getByRole('main', { name: 'Café Lumen office' }).locator('canvas')).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `f2-office-${width}x${height}`, info);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('the first run on a phone (final gates, F2)', () => {
  test('the sheet that peeks is named and shows its words, not an empty card', async ({ page, request }, info) => {
    test.skip(!layoutOf(page).phone, 'The phone layout.');
    const id = await found(request, scratchOf(), `f2-first-run-peek-${info.project.name}`);
    await waitForProposal(request, id);
    await open(page, `/c/${id}`);
    await expect(sidePanel(page).getByRole('button', { name: /^Open the CEO's proposal\./ })).toBeVisible({ timeout: 30_000 });
    await expect(sidePanel(page).getByText(/^Read it, then start it/)).toBeVisible();
    await shot(page, 'f2-first-run-peek', info);
  });
});
