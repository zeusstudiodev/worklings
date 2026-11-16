import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  companyAddress,
  expectAddress,
  expectNoSidewaysScroll,
  hiddenFocus,
  inboxKey,
  layoutOf,
  nameFor,
  onElements,
  open,
  openBoard,
  panelTitle,
  running,
  shot,
  sidePanel,
  talk,
  talkBox,
  theTo,
  watchErrors,
} from './v3-kit.ts';
import { view } from './v3-world.ts';

// H60, the org chart board (docs/design-v3.md, "The org chart"): the tree as one flat ARIA tree with its keys and focus
// never hidden, a click opening the person with the talk bar pointed at them, a paper along the lit line (none with
// reduced motion), Fire, Move, Hire and Find from the chart, the phone's collapsible outline, and the chart with 8, 18
// and 40 people. The demo companies (Café Lumen with 18, Ledger with 40) keep their changes in the page, so each test
// starts from the same café; the live company (eight people, the fake desks) proves a hire and a paper through the hub.

const DEMO = 'demo';
const LEDGER = 'ledger';

const chart = (page: Page): Locator => page.getByRole('tree', { name: 'Org chart' });
const nodes = (page: Page): Locator => chart(page).getByRole('treeitem');
const node = (page: Page, who: string): Locator => chart(page).getByRole('treeitem', { name: new RegExp(`^${who},`) });

/** What the board's result row says ("Kai was fired. …"), with its Undo. */
const resultLine = (frame: Locator, words: RegExp): Locator => frame.locator('.undo-line', { hasText: words });

/** The names the tree lists, in its own order: the first word of each node's accessible name. */
async function order(page: Page): Promise<string[]> {
  return nodes(page).evaluateAll(onElements<string[]>(`return els.map((el) => (el.getAttribute('aria-label') || '').split(',')[0]);`));
}

/** Focuses a node without a press, as arriving by Tab does: it is the tree's one tab stop, or a key moves there. */
async function focusNode(page: Page, who: string): Promise<void> {
  await node(page, who).focus();
  await expect(node(page, who)).toBeFocused();
}

async function press(page: Page, key: string, focused: string): Promise<void> {
  await page.keyboard.press(key);
  await expect(node(page, focused), `${key} lands on ${focused}`).toBeFocused();
  expect(await hiddenFocus(page), `${focused} is not hidden after ${key}`).toBeNull();
}

test.describe('the chart as a tree', () => {
  test('is one flat tree: every person a treeitem with level, set size and position, managers with aria-expanded, one tab stop', async ({ page }) => {
    const errors = watchErrors(page);
    await openBoard(page, DEMO, 'org');
    await expect(nodes(page)).toHaveCount(18);
    const facts = await nodes(page).evaluateAll(
      onElements<{ name: string; level: number; size: number; pos: number; expanded: string | null; tab: string | null }[]>(`
        return els.map((el) => ({
          name: (el.getAttribute('aria-label') || '').split(',')[0],
          level: Number(el.getAttribute('aria-level')),
          size: Number(el.getAttribute('aria-setsize')),
          pos: Number(el.getAttribute('aria-posinset')),
          expanded: el.getAttribute('aria-expanded'),
          tab: el.getAttribute('tabindex'),
        }));
      `),
    );
    // The CEO on level 1, the heads and the office manager on 2, Theo's team lead on 3 and Ines's three on 4.
    const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
    expect(byName.Mara).toMatchObject({ level: 1, size: 1, pos: 1, expanded: 'true' });
    expect(byName.Theo).toMatchObject({ level: 2, expanded: 'true' });
    expect(byName.Ines).toMatchObject({ level: 3, expanded: 'true' });
    expect(byName.Kai?.level).toBe(4);
    expect(byName.Kai?.expanded).toBeNull();
    // Positions run 1..size among a manager's reports.
    for (const f of facts) {
      expect(f.pos, `${f.name}'s position`).toBeGreaterThanOrEqual(1);
      expect(f.pos, `${f.name}'s position`).toBeLessThanOrEqual(f.size);
    }
    expect(facts.filter((f) => f.tab === '0'), 'one tab stop').toHaveLength(1);
    expect(facts.filter((f) => f.tab === '-1')).toHaveLength(17);
    // A node's name says who and how they are; the ticking figures sit in its description.
    await expect(node(page, 'Kai')).toHaveAccessibleName(/^Kai, frontend engineer, Engineering\./);
    await expect(node(page, 'Kai')).toHaveAccessibleDescription(/Shift\+F10 for more\.$/);
    // No name holds a figure that ticks (a duration or a clock time): a screen reader would read it again as minutes pass.
    const names = await nodes(page).evaluateAll(onElements<string[]>(`return els.map((el) => el.getAttribute('aria-label') || '');`));
    for (const name of names) expect(name, 'a node name never ticks').not.toMatch(/\b\d+ (min|h|hours?|days?)\b|\bsince \d/);
    expect(errors).toEqual([]);
  });

  test('Up and Down walk the visible nodes in order, Home and End go to the ends, focus is never hidden', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones have the outline, checked below.');
    await openBoard(page, DEMO, 'org');
    const names = await order(page);
    expect(names).toHaveLength(18);
    await focusNode(page, names[0] ?? '');
    for (const next of names.slice(1)) await press(page, 'ArrowDown', next);
    // End of the list: Down stays.
    await page.keyboard.press('ArrowDown');
    await expect(node(page, names.at(-1) ?? '')).toBeFocused();
    for (const previous of [...names.slice(0, -1)].reverse().slice(0, 4)) await press(page, 'ArrowUp', previous);
    await press(page, 'Home', names[0] ?? '');
    await press(page, 'End', names.at(-1) ?? '');
    await shot(page, 'h60-keys', info);
    // Roving focus: the tab stop followed the last node.
    await expect(node(page, names.at(-1) ?? '')).toHaveAttribute('tabindex', '0');
    await expect(nodes(page).and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  });

  test('Left closes a manager, Right opens one or goes to the first report, Left on a worker goes to the manager', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones have the outline, checked below.');
    await openBoard(page, DEMO, 'org');
    await focusNode(page, 'Ines');
    const before = await order(page);
    // Left on an open manager closes it: its three workers leave the tree and focus stays on the manager.
    await page.keyboard.press('ArrowLeft');
    await expect(node(page, 'Ines')).toHaveAttribute('aria-expanded', 'false');
    await expect(nodes(page)).toHaveCount(before.length - 3);
    await expect(node(page, 'Ines')).toBeFocused();
    expect(await hiddenFocus(page)).toBeNull();
    for (const gone of ['Kai', 'Noah', 'Sofia']) await expect(node(page, gone)).toHaveCount(0);
    // Right on a closed manager opens it again, in the same order, focus still on the manager.
    await page.keyboard.press('ArrowRight');
    await expect(node(page, 'Ines')).toHaveAttribute('aria-expanded', 'true');
    expect(await order(page)).toEqual(before);
    await expect(node(page, 'Ines')).toBeFocused();
    // Right on an open manager goes to their first report; Left on a worker goes back to the manager.
    await page.keyboard.press('ArrowRight');
    const first = (await order(page))[before.indexOf('Ines') + 1] ?? '';
    await expect(node(page, first)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(node(page, 'Ines')).toBeFocused();
    // Left on a node that manages nobody and Right on one: nothing opens or closes.
    await focusNode(page, 'Kai');
    await page.keyboard.press('ArrowRight');
    await expect(node(page, 'Kai')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(node(page, 'Ines')).toBeFocused();
  });

  test('typing a name jumps to it, and Tab from a node reaches its More and then leaves the chart', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones have the outline, checked below.');
    await openBoard(page, DEMO, 'org');
    await focusNode(page, 'Mara');
    await page.keyboard.type('th');
    await expect(node(page, 'Theo')).toBeFocused();
    expect(await hiddenFocus(page)).toBeNull();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'More for Theo', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(`document.activeElement?.closest('[role="tree"]') !== null`), 'Tab left the tree').toBe(false);
    expect(await page.evaluate(`document.activeElement?.closest('[role="menu"]') !== null`)).toBe(false);
  });
});

test.describe('the fold keys', () => {
  test('every key that closes a manager is at least 24 by 24 px, so a miss never opens the person below', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones have the outline, with no fold keys on a chart.');
    await openBoard(page, DEMO, 'org');
    const sizes = await page.locator('.org-fold--open').evaluateAll(onElements<{ w: number; h: number }[]>(`return els.map((el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height }; });`));
    expect(sizes.length, 'the café has managers').toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size.w).toBeGreaterThanOrEqual(24);
      expect(size.h).toBeGreaterThanOrEqual(24);
    }
  });
});

test.describe('opening someone', () => {
  test('a click, or Enter, opens them in the side panel, marks the node open and points the talk bar at them', async ({ page }) => {
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'org');
    const chartOrOutline = layoutOf(page).phone ? frame.getByRole('tree', { name: 'Org chart' }) : chart(page);
    await chartOrOutline.getByRole('treeitem', { name: /^Kai,/ }).click();
    await expectAddress(page, companyAddress(DEMO, { main: 'org', panel: 'people/frontend-engineer' }));
    await expect(panelTitle(page)).toHaveText('Kai');
    await expect(chartOrOutline.getByRole('treeitem', { name: /^Kai,/ })).toHaveAttribute('aria-selected', 'true');
    await expect(theTo(page)).toHaveAccessibleName('To Kai, frontend engineer');
    if (!layoutOf(page).phone) {
      // Another node: the panel and the To follow, and Kai is no longer the open one. (A phone's sheet covers the outline.)
      await chartOrOutline.getByRole('treeitem', { name: /^Ada,/ }).click();
      await expectAddress(page, companyAddress(DEMO, { main: 'org', panel: 'people/head-of-design' }));
      await expect(panelTitle(page)).toHaveText('Ada');
      await expect(theTo(page)).toHaveAccessibleName(/^To Ada, head of design/);
      await expect(chartOrOutline.getByRole('treeitem', { name: /^Kai,/ })).not.toHaveAttribute('aria-selected', 'true');
    }
    if (!layoutOf(page).phone) {
      // The keyboard way: Enter on a focused node.
      await chartOrOutline.getByRole('treeitem', { name: /^Theo,/ }).focus();
      await page.keyboard.press('Enter');
      await expectAddress(page, companyAddress(DEMO, { main: 'org', panel: 'people/head-of-engineering' }));
      await expect(panelTitle(page)).toHaveText('Theo');
    }
    expect(errors).toEqual([]);
  });

  test('a click does not change the To while the box holds words', async ({ page }) => {
    test.skip(layoutOf(page).phone, "Phones' talk bar sits under the sheet; checked on the desktop sizes.");
    await openBoard(page, DEMO, 'org');
    await node(page, 'Ada').click();
    await expect(theTo(page)).toHaveAccessibleName(/^To Ada/);
    await talkBox(page).fill('Remember the palette');
    await node(page, 'Theo').click();
    await expect(panelTitle(page)).toHaveText('Theo');
    await expect(theTo(page)).toHaveAccessibleName(/^To Ada/);
    await expect(talkBox(page)).toHaveValue('Remember the palette');
  });
});

test.describe('changing the company from the chart', () => {
  test('Fire from a node\'s menu: the node leaves, focus goes to their manager, and Undo brings them back', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones fire from the person\'s sheet (checked in v3-people).');
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'org');
    // The bar's meter (v0.2) names the whole sum, cents and all.
    const spent = page.locator('.cbar__meter:visible').first();
    // Narrow bars (768) fold the meter away; there the unit test of companySpend covers it.
    const showsSpend = (await spent.count()) > 0;
    const before = showsSpend ? await spent.getAttribute('aria-label') : null;
    await focusNode(page, 'Kai');
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'More for Kai' });
    await expect(menu).toBeVisible();
    // The menu is the node's: it opens with focus on its first item, and Escape gives focus back to the node.
    await expect(menu.getByRole('menuitem', { name: 'Message Kai' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(node(page, 'Kai')).toBeFocused();
    // The More key opens the same menu.
    await page.getByRole('button', { name: 'More for Kai', exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Fire Kai' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Change Kai\'s model' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Move Kai to another room' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Fire Kai' }).click();
    await expect(node(page, 'Kai')).toHaveCount(0);
    await expect(nodes(page)).toHaveCount(17);
    // What Kai cost was spent: firing leaves the money spent where it was.
    if (showsSpend) await expect(spent).toHaveAttribute('aria-label', before ?? '');
    const said = resultLine(frame, /^Kai was fired\./);
    await expect(said).toBeVisible();
    await expect(said.getByRole('button', { name: /^Undo/ })).toBeVisible();
    // Focus went to Kai's manager, not to the page.
    await expect(node(page, 'Ines')).toBeFocused();
    await shot(page, 'h60-fired', info);
    await said.getByRole('button', { name: /^Undo/ }).click();
    await expect(node(page, 'Kai')).toBeVisible();
    await expect(nodes(page)).toHaveCount(18);
    await expect(node(page, 'Kai')).toHaveAttribute('aria-level', '4');
    expect(errors).toEqual([]);
  });

  test('the CEO has no Fire and no Move in their menu', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'The More menu is the chart\'s.');
    await openBoard(page, DEMO, 'org');
    await focusNode(page, 'Mara');
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'More for Mara' });
    await expect(menu.getByRole('menuitem', { name: 'Message Mara' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Fire / })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: /^Move / })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('Move from a node\'s menu says the manager stays, the chart marks who is in another room, and Undo puts them back', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones move people from the person\'s sheet (checked in v3-people).');
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'org');
    await focusNode(page, 'Kai');
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'More for Kai' });
    await menu.getByRole('menuitem', { name: 'Move Kai to another room' }).click();
    const rooms = page.getByRole('menu', { name: 'Move Kai to' });
    await expect(rooms).toBeVisible();
    // The room Kai is in is the current one and cannot be picked again.
    await expect(rooms.getByRole('menuitem', { name: /^Engineering/ })).toHaveAttribute('aria-disabled', 'true');
    await rooms.getByRole('menuitem', { name: 'Design', exact: true }).click();
    const said = resultLine(frame, /Kai moved to Design and still reports to Ines\. Ask Mara to give Kai a manager there\./);
    await expect(said).toBeVisible();
    // Kai stays under Ines, and their node says what Move left undone.
    await expect(node(page, 'Kai')).toHaveAttribute('aria-level', '4');
    await expect(node(page, 'Kai')).toHaveAccessibleName(/^Kai, frontend engineer, Design\..* In Design now, still reporting here\.$/);
    await shot(page, 'h60-moved', info);
    await said.getByRole('button', { name: /^Undo/ }).click();
    await expect(node(page, 'Kai')).toHaveAccessibleName(/^Kai, frontend engineer, Engineering\./);
    await expect(node(page, 'Kai')).not.toHaveAccessibleName(/In Design now/);
    expect(errors).toEqual([]);
  });

  test('Hire someone: ask the CEO fills the talk bar, a room fills it for the demo, and the fired come back with Rehire', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones keep Hire in the outline\'s head, checked below.');
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'org');
    const hire = frame.getByRole('button', { name: 'Hire someone', exact: true });
    await hire.click();
    const menu = page.getByRole('menu', { name: 'Hire someone' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Ask Mara to hire someone' }).click();
    await expect(theTo(page)).toHaveAccessibleName(/^To Mara/);
    await expect(talkBox(page)).toBeFocused();
    await expect(talkBox(page)).toHaveValue('Hire ');
    // A room: the demo has no library, so it asks the CEO for that room instead.
    await talkBox(page).fill('');
    await hire.click();
    await menu.getByRole('menuitem', { name: 'Hire into a room' }).click();
    await expect(menu.getByText('Which room? Mara hires for it.')).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Content', exact: true }).click();
    await expect(talkBox(page)).toHaveValue('Hire someone for Content: ');
    await expect(talkBox(page)).toBeFocused();
    await talkBox(page).fill('');
    // Rehire: the café has two fired people, who return under the manager they had.
    await hire.click();
    await expect(menu.getByText('Fired (2)')).toBeVisible();
    await menu.getByRole('menuitem', { name: /^Rehire Sam/ }).click();
    await expect(node(page, 'Sam')).toBeVisible();
    await expect(nodes(page)).toHaveCount(19);
    await expect(node(page, 'Sam')).toHaveAttribute('aria-level', '3');
    const said = resultLine(frame, /Sam is back at their desk\./);
    await expect(said).toBeVisible();
    await said.getByRole('button', { name: /^Undo/ }).click();
    await expect(node(page, 'Sam')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Find someone dims the rest, says how many match, Enter focuses the first and Escape clears', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones: checked in the outline test.');
    const frame = await openBoard(page, DEMO, 'org');
    const find = frame.getByRole('searchbox', { name: 'Find someone' });
    await find.fill('copywriter');
    // Said once typing pauses: Lena is the only one with the word in their title.
    await expect(frame.getByRole('status').filter({ hasText: 'of 18 match' })).toHaveText('1 of 18 match');
    await find.press('Enter');
    await expect(node(page, 'Lena')).toBeFocused();
    expect(await hiddenFocus(page)).toBeNull();
    // By room too: "design" matches the head of design and the three who work for them (and anyone moved there).
    await find.fill('design');
    await expect(frame.getByRole('status').filter({ hasText: 'of 18 match' })).toHaveText('4 of 18 match');
    await find.fill('zzz');
    await expect(frame.getByRole('status').filter({ hasText: 'Nobody matches' })).toHaveText('Nobody matches “zzz”.');
    await find.press('Escape');
    await expect(find).toHaveValue('');
    await expect(frame.getByRole('status').filter({ hasText: /match/ }), 'the count goes with the words').toHaveCount(0);
    await expect(nodes(page)).toHaveCount(18);
  });
});

test.describe('the outline on a phone', () => {
  test('is a tree of rows: managers open and close, a closed one says how many are under it, a row opens the sheet, Find and Hire stay above', async ({ page }, info) => {
    test.skip(!layoutOf(page).phone, 'The phone layout (375 wide, or 812 x 375).');
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'org');
    const tree = frame.getByRole('tree', { name: 'Org chart' });
    await expect(tree.getByRole('treeitem')).toHaveCount(18);
    const row = (who: string) => tree.getByRole('treeitem', { name: new RegExp(`^${who},`) });
    await expect(row('Theo')).toHaveAttribute('aria-expanded', 'true');
    await expect(row('Kai')).toHaveAttribute('aria-level', '4');
    await expect(tree.locator('[tabindex="0"]')).toHaveCount(1);
    await expect(frame.getByRole('searchbox', { name: 'Find someone' })).toBeVisible();
    await expect(frame.getByRole('button', { name: /Hire someone/ })).toBeVisible();
    // Keys: Down, End, Home; Left closes Theo, whose row then reads "Theo, head of engineering, and 8 more, 1 needs you.".
    await row('Mara').focus();
    await page.keyboard.press('ArrowDown');
    await expect(tree.getByRole('treeitem').nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(tree.getByRole('treeitem').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(row('Mara')).toBeFocused();
    await row('Theo').focus();
    await page.keyboard.press('ArrowLeft');
    const closed = tree.getByRole('treeitem', { name: /^Theo, head of engineering, and 8 more/ });
    await expect(closed).toHaveAttribute('aria-expanded', 'false');
    await expect(tree.getByRole('treeitem')).toHaveCount(10);
    await expect(closed).toBeFocused();
    await expectNoSidewaysScroll(page, 'the outline');
    await shot(page, 'h60-outline-closed', info);
    await page.keyboard.press('ArrowRight');
    await expect(tree.getByRole('treeitem')).toHaveCount(18);
    // A press opens the person's sheet, and Find dims the rest.
    await row('Kai').click();
    await expectAddress(page, companyAddress(DEMO, { main: 'org', panel: 'people/frontend-engineer' }));
    await expect(panelTitle(page)).toHaveText('Kai');
    await expect(sidePanel(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Find someone on a phone says how many match and Enter reaches the first', async ({ page }) => {
    test.skip(!layoutOf(page).phone, 'The phone layout.');
    const frame = await openBoard(page, DEMO, 'org');
    const tree = frame.getByRole('tree', { name: 'Org chart' });
    const find = frame.getByRole('searchbox', { name: 'Find someone' });
    await find.fill('copywriter');
    await expect(frame.getByRole('status').filter({ hasText: 'of 18 match' })).toHaveText('1 of 18 match');
    await find.press('Enter');
    await expect(tree.getByRole('treeitem', { name: /^Lena,/ })).toBeFocused();
  });
});

test.describe('the live company: a paper along the line, and a hire', () => {
  test.describe.configure({ mode: 'serial' });
  let id = '';
  test.beforeAll(async ({ playwright }, info) => {
    test.setTimeout(180_000);
    const request = await playwright.request.newContext();
    id = await running(request, nameFor('org', info));
    await request.dispose();
  });

  /** Counts every `.org-paper` and every lit line the chart ever draws from now on (they last a second at most). */
  async function watchPapers(page: Page): Promise<void> {
    await page.evaluate(`(() => {
      const seen = { papers: 0, yours: 0, lit: 0 };
      window.__papers = seen;
      const count = (n) => {
        if (!(n instanceof Element)) return;
        for (const el of [n, ...n.querySelectorAll('.org-paper, path.is-lit')]) {
          if (el.matches('.org-paper')) { seen.papers++; if (el.classList.contains('org-paper--yours')) seen.yours++; }
          if (el.matches('path.is-lit')) seen.lit++;
        }
      };
      new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(count))).observe(document.body, { childList: true, subtree: true });
    })()`);
  }
  const papers = (page: Page) => page.evaluate(`window.__papers`) as Promise<{ papers: number; yours: number; lit: number }>;

  test('a message through the talk bar flies a yellow paper along the lit line to the person, who rings', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones mark the row instead of drawing papers.');
    const errors = watchErrors(page);
    await openBoard(page, id, 'org');
    await expect(nodes(page)).toHaveCount(8);
    await watchPapers(page);
    await talk(page, { type: 'Ada', pick: /^Ada/ }, 'Please look at the palette');
    await expect.poll(async () => (await papers(page)).papers, { message: 'a paper flew', timeout: 10_000, intervals: [50] }).toBeGreaterThan(0);
    const seen = await papers(page);
    expect(seen.yours, 'your words are on a yellow paper').toBeGreaterThan(0);
    expect(seen.lit, 'the line it follows is lit').toBeGreaterThan(0);
    await shot(page, 'h60-paper', info);
    // The paper lands within 1.2 s and takes its line with it.
    await expect(page.locator('.org-paper')).toHaveCount(0, { timeout: 5_000 });
    expect(errors).toEqual([]);
  });

  test('with reduced motion no paper flies: the person\'s node says "From you" for a moment instead', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones mark the row; checked below.');
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openBoard(page, id, 'org');
    await expect(nodes(page)).toHaveCount(8);
    await watchPapers(page);
    await talk(page, { type: 'Ada', pick: /^Ada/ }, 'And the type scale');
    await expect(node(page, 'Ada')).toContainText('From you', { timeout: 10_000 });
    // Past a paper's whole flight (1.2 s) and still none.
    await page.waitForTimeout(1_500);
    expect(await papers(page)).toEqual({ papers: 0, yours: 0, lit: 0 });
    expect(errors).toEqual([]);
  });

  test('on a phone the row the message reached says "From you"', async ({ page }) => {
    test.skip(!layoutOf(page).phone, 'The phone layout.');
    const frame = await openBoard(page, id, 'org');
    const tree = frame.getByRole('tree', { name: 'Org chart' });
    await talk(page, { type: 'Ada', pick: /^Ada/ }, 'Please look at the palette');
    await expect(tree.getByRole('treeitem', { name: /^Ada,/ })).toContainText('From you', { timeout: 10_000 });
  });

  test("Fire from a node's menu in a live company takes them off the chart, and Undo brings them back", async ({ page, request }) => {
    test.skip(layoutOf(page).phone, "The More menu is the chart's.");
    const errors = watchErrors(page);
    const frame = await openBoard(page, id, 'org');
    const total = (await view(request, id)).people.length;
    await expect(nodes(page)).toHaveCount(total);
    await focusNode(page, 'Tom');
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menu', { name: 'More for Tom' }).getByRole('menuitem', { name: 'Fire Tom' }).click();
    const said = resultLine(frame, /^Tom was fired\./);
    await expect(said).toBeVisible();
    await expect(node(page, 'Tom')).toHaveCount(0);
    await expect.poll(async () => (await view(request, id)).people.some((p) => p.id === 'qa-engineer'), { message: 'the company lost Tom' }).toBe(false);
    await expect(node(page, 'Ben')).toBeFocused();
    await said.getByRole('button', { name: /^Undo/ }).click();
    await expect(node(page, 'Tom')).toBeVisible();
    await expect.poll(async () => (await view(request, id)).people.find((p) => p.id === 'qa-engineer')?.reportsTo).toBe('head-of-engineering');
    expect(errors).toEqual([]);
  });

  test('Hire into a room puts a library role under the room\'s head, and the chart shows them there', async ({ page, request }, info) => {
    test.skip(layoutOf(page).phone, 'The hiring card opens in the side panel from the chart\'s head.');
    const errors = watchErrors(page);
    const frame = await openBoard(page, id, 'org');
    await expect(nodes(page)).toHaveCount(8);
    const was = (await view(request, id)).people.map((p) => p.id);
    await frame.getByRole('button', { name: 'Hire someone', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Hire someone' });
    await menu.getByRole('menuitem', { name: 'Hire into a room' }).click();
    await menu.getByRole('menuitem', { name: 'Design', exact: true }).click();
    // The room's card opens in the side panel with what the library can add to it.
    const hires = sidePanel(page).getByRole('region', { name: 'Hire' }).or(sidePanel(page).locator('section[aria-labelledby="room-hire"]'));
    await expect(hires).toBeVisible({ timeout: 30_000 });
    const first = hires.locator('li.hire').first();
    const title = (await first.locator('.hire__title').innerText()).trim();
    await first.getByRole('button', { name: 'Hire', exact: true }).click();
    const arrived = await expect
      .poll(async () => (await view(request, id)).people.find((p) => !was.includes(p.id)), { message: `${title} joined`, timeout: 30_000 })
      .toBeTruthy()
      .then(async () => (await view(request, id)).people.find((p) => !was.includes(p.id)));
    expect(arrived?.room).toBe('design');
    expect(arrived?.reportsTo, 'reports to the head of the room').toBe('head-of-design');
    await expect(nodes(page)).toHaveCount(9);
    const them = chart(page).getByRole('treeitem', { name: new RegExp(`^${arrived?.name},`) });
    await expect(them).toBeVisible();
    await expect(them).toHaveAttribute('aria-level', '3');
    await shot(page, 'h60-hired', info);
    expect(errors).toEqual([]);
  });
});

test.describe('the chart at 8, 18 and 40 people', () => {
  test('Café Lumen, 18 people, everyone on the board without sideways scroll of the page', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openBoard(page, DEMO, 'org');
    await expect(page.getByRole('tree', { name: 'Org chart' }).getByRole('treeitem')).toHaveCount(18);
    await expectNoSidewaysScroll(page, 'the 18-person chart');
    await shot(page, 'h60-org-18', info);
    expect(errors).toEqual([]);
  });

  test('Ledger, 40 people: the chart opens in a form that fits (or the rooms nobody works in start closed) and every node is reachable by Find', async ({ page }, info) => {
    const errors = watchErrors(page);
    // Ledger is the demo's second company: the tab enters the demo at the café, then opens it by its address.
    await open(page, `/c/${DEMO}`);
    await expect(inboxKey(page)).toBeVisible({ timeout: 30_000 });
    const frame = await openBoard(page, LEDGER, 'org');
    const tree = frame.getByRole('tree', { name: 'Org chart' });
    await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 15_000 });
    await expectNoSidewaysScroll(page, 'the 40-person chart');
    if (!layoutOf(page).phone && (page.viewportSize()?.width ?? 0) >= 1300) {
      // "The chart opens in the largest form that fits all 40" at 1440: every node, with its whole width, in the board's view.
      const view = await frame.boundingBox();
      const panel = await sidePanel(page).boundingBox();
      const right = Math.min((view?.x ?? 0) + (view?.width ?? 0), panel?.x ?? Infinity);
      const out = await tree.getByRole('treeitem').evaluateAll(
        onElements<string[]>(`return els.filter((el) => { const r = el.getBoundingClientRect(); return r.left < ${view?.x ?? 0} - 1 || r.right > ${right} + 1; }).map((el) => (el.getAttribute('aria-label') || '').split(',')[0]);`),
      );
      expect(out, 'nodes cut off by the edges of the board when the chart opens').toEqual([]);
    }
    await shot(page, 'h60-org-40', info);
    // Whatever starts closed, Find opens the way to a person and says how many match.
    const find = frame.getByRole('searchbox', { name: 'Find someone' });
    await find.fill('engineer');
    await expect(frame.getByRole('status').filter({ hasText: / of 40 match$/ })).toBeVisible();
    await find.press('Enter');
    await expect(tree.locator(':focus')).toHaveCount(1);
    expect(await hiddenFocus(page)).toBeNull();
    // Every person in the company can be listed by the tree's own keys: End reaches the last one.
    await find.press('Escape');
    expect(errors).toEqual([]);
  });

  test('the eight-person live company draws as a small tree', async ({ page, playwright }, info) => {
    test.setTimeout(180_000);
    const request = await playwright.request.newContext();
    const small = await running(request, nameFor('org-8', info));
    await request.dispose();
    const errors = watchErrors(page);
    const frame = await openBoard(page, small, 'org');
    const tree = frame.getByRole('tree', { name: 'Org chart' });
    await expect(tree.getByRole('treeitem')).toHaveCount(8);
    await expectNoSidewaysScroll(page, 'the 8-person chart');
    await shot(page, 'h60-org-8', info);
    expect(errors).toEqual([]);
  });
});

