import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  boardFrame,
  boardTitle,
  column,
  companyAddress,
  expectAddress,
  expectNoSidewaysScroll,
  feed,
  feedKey,
  hiddenFocus,
  layoutOf,
  miniMap,
  onElements,
  open,
  openBoard,
  openCompany,
  panelTitle,
  panelToggle,
  shot,
  sidePanel,
  switcher,
  switchTo,
  talkBox,
  theTo,
  type ViewName,
  watchErrors,
} from './v3-kit.ts';

// H59 (AC35), boards over the map (docs/design-v3.md, "Boards over the map"): Org, Tasks and Dashboards open over the
// office, which shrinks into a live mini-map; the mini-map, "Back to the office", Office, Escape and Back return; each
// board and sub-view is an address of its own, so Back, Forward and a reload keep the view. In the demo company.

const DEMO = 'demo';
const BOARDS: { view: ViewName; main: string }[] = [
  { view: 'Org', main: 'org' },
  { view: 'Tasks', main: 'tasks' },
  { view: 'Dashboards', main: 'dashboards' },
];

const title = (page: Page, main: string): Locator => boardFrame(page, boardTitle(main)).getByRole('heading', { level: 2, name: boardTitle(main), exact: true });

/** Two pictures of the mini-map 1.5 s apart: different, since the office in it is live. */
async function expectLive(page: Page): Promise<void> {
  // The office has finished shrinking into the corner (250 ms), so what changes is the office itself, not the move.
  await expect(page.locator('[data-phase="mini"]')).toBeAttached();
  const box = await miniMap(page).boundingBox();
  expect(box, 'the mini-map is on the page').not.toBeNull();
  if (!box) return;
  const clip = { x: box.x + 8, y: box.y + 8, width: Math.max(box.width - 16, 8), height: Math.max(box.height - 40, 8) };
  const first = await page.screenshot({ clip });
  await expect
    .poll(async () => !(await page.screenshot({ clip })).equals(first), { message: 'the office in the mini-map keeps drawing', timeout: 10_000, intervals: [1_500] })
    .toBe(true);
}

test.describe('boards over the map', () => {
  for (const { view, main } of BOARDS) {
    test(`${view} opens over the office with focus on its title, the office live in the corner`, async ({ page }, info) => {
      const errors = watchErrors(page);
      await openCompany(page, DEMO);
      await switchTo(page, view);
      await expectAddress(page, companyAddress(DEMO, { main }));
      await expect(title(page, main)).toBeFocused();
      await expect(page).toHaveTitle(new RegExp(`^\\(\\d+\\) ${boardTitle(main)}, Café Lumen in Worklings$`));
      if (layoutOf(page).phone) {
        // Phones: the board is a sheet and Office in the views row is the way back; no mini-map.
        await expect(miniMap(page)).toHaveCount(0);
      } else {
        // The mini-map says the company's stage in the bar pill's word (v0.2, one stage everywhere: the café's plan waits
        // for your OK) and how many things need you.
        await expect(miniMap(page)).toHaveAccessibleName(/^Back to the office\. Waiting for your OK, \w+ needs? you\.$/);
        await expectLive(page);
        const corner = await miniMap(page).boundingBox();
        const window = page.viewportSize() ?? { width: 1440, height: 900 };
        // The main view's bottom right, left of a docked side panel.
        const panel = await sidePanel(page).boundingBox();
        expect((corner?.x ?? 0) + (corner?.width ?? 0)).toBeLessThanOrEqual((layoutOf(page).floating || !panel ? window.width : panel.x) - 12 + 1);
        expect((corner?.y ?? 0) + (corner?.height ?? 0)).toBeLessThanOrEqual(window.height - 12 + 1);
      }
      await expectNoSidewaysScroll(page, `${view} at ${info.project.name}`);
      await shot(page, `h59-${main}`, info);
      expect(errors).toEqual([]);
    });
  }

  test('the whole mini-map where the main view has room, the thumbnail where it has not', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones have no mini-map.');
    await openBoard(page, DEMO, 'tasks');
    const window = page.viewportSize() ?? { width: 1440, height: 900 };
    const size = async () => {
      const b = await miniMap(page).boundingBox();
      return { width: Math.round(b?.width ?? 0), height: Math.round(b?.height ?? 0) };
    };
    // With the side panel shown the main view is under 1288 px at every desktop size here: a 104 x 56 thumbnail in its frame.
    expect((await size()).width).toBeLessThan(140);
    if (window.width >= 1324 && !layoutOf(page).floating) {
      // Hidden, the main view is the window less the pull's 36 px: the whole 240 x 150 map with its caption.
      await panelToggle(page).click();
      await expect.poll(async () => (await size()).width).toBeGreaterThanOrEqual(240);
      await expect(miniMap(page)).toContainText('Back to the office');
      await shot(page, 'h59-whole-mini-map', info);
      await expectLive(page);
    }
  });

  test('Escape, the mini-map, "Back to the office" and Office return to the office, focus on what opened the board', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones return with Office and Back, checked below.');
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    // v0.2: Tasks is the board the switcher opens (the org chart is behind More).
    const tasks = switcher(page).getByRole('link', { name: 'Tasks', exact: true });
    const office = companyAddress(DEMO);
    const ways: [string, () => Promise<void>][] = [
      ['Escape on its title', () => page.keyboard.press('Escape')],
      ['a press on the mini-map', () => miniMap(page).click()],
      ['"Back to the office"', () => boardFrame(page, 'Tasks').getByRole('button', { name: 'Back to the office', exact: true }).click()],
      ['Office in the switcher', () => switcher(page).getByRole('link', { name: 'Office', exact: true }).click()],
    ];
    for (const [way, close] of ways) {
      await tasks.click();
      await expect(title(page, 'tasks')).toBeFocused();
      await close();
      await expectAddress(page, office, `${way} goes back to the office`);
      await expect(boardFrame(page, 'Tasks')).toBeHidden();
      if (way !== 'Office in the switcher') await expect(tasks, `${way}: focus returns to what opened the board`).toBeFocused();
    }
    await shot(page, 'h59-back-to-the-office', info);
    expect(errors).toEqual([]);
  });

  test('the camera comes back as it was left, not refitted', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Checked where the office shows beside the mini-map.');
    await openCompany(page, DEMO);
    // A room's sign near the middle of the office. Which of them stays in the labels' area through a step of zoom
    // depends on the room the window leaves (the floating side panel narrows it), so the sign is the first that shows
    // after the zoom.
    const signs = page.getByRole('main').getByText(/^(Kitchen|Reception|Meeting room)$/);
    await expect(signs.filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(signs.filter({ visible: true }).first()).toBeVisible();
    const sign = page.getByRole('main').getByText((await signs.filter({ visible: true }).first().innerText()).trim(), { exact: true });
    // The zoom steps the camera; the sign settles where the zoom left it.
    let before = await sign.boundingBox();
    await expect.poll(async () => {
      const now = await sign.boundingBox();
      const settled = now !== null && before !== null && Math.abs(now.x - before.x) < 0.5 && Math.abs(now.y - before.y) < 0.5;
      before = now;
      return settled;
    }, { intervals: [400] }).toBe(true);
    await switchTo(page, 'Tasks');
    await expect(title(page, 'tasks')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sign).toBeVisible();
    await expect.poll(async () => {
      const now = await sign.boundingBox();
      return now !== null && before !== null && Math.abs(now.x - before.x) <= 2 && Math.abs(now.y - before.y) <= 2;
    }, { message: 'the Design sign stands where the zoom left it' }).toBe(true);
  });

  test('Back and Forward walk the boards and their sub-views, and a reload keeps each', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    // The dashboards' own sub-views (Spend, Timeline) come with the full-width dashboards (build step 7, H62).
    const steps: { main: string; go: () => Promise<void> }[] = [
      { main: 'org', go: () => switchTo(page, 'Org') },
      { main: 'tasks', go: () => switchTo(page, 'Tasks') },
      { main: 'plan', go: () => boardFrame(page, 'Tasks').getByRole('link', { name: /^Plan\b/ }).click() },
      { main: 'dashboards', go: () => switchTo(page, 'Dashboards') },
    ];
    const walked = [''];
    for (const step of steps) {
      await step.go();
      await expectAddress(page, companyAddress(DEMO, { main: step.main }));
      await expect(title(page, step.main)).toBeVisible();
      walked.push(step.main);
    }
    // The plan is the Tasks board's sub-view: a reload of it keeps it.
    await page.goBack();
    await page.reload();
    await expectAddress(page, companyAddress(DEMO, { main: 'plan' }), 'a reload keeps the sub-view');
    await expect(title(page, 'plan')).toBeVisible();
    await page.goForward();
    await expectAddress(page, companyAddress(DEMO, { main: 'dashboards' }));
    for (const main of walked.slice(0, -1).reverse()) {
      await page.goBack();
      await expectAddress(page, companyAddress(DEMO, { main }), `Back to ${main || 'the office'}`);
      if (main) await expect(title(page, main)).toBeVisible();
      else await expect(boardFrame(page, 'Org chart')).toBeHidden();
    }
    for (const main of walked.slice(1)) {
      await page.goForward();
      await expectAddress(page, companyAddress(DEMO, { main }), `Forward to ${main}`);
      // Forward opens again what Back closed, with focus on its title.
      await expect(title(page, main)).toBeFocused();
    }
    await shot(page, 'h59-walked', info);
    expect(errors).toEqual([]);
  });

  test('Escape in the side panel or the talk bar never closes a board; in the board or on nothing it does', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones close a board with Office and Back.');
    await openBoard(page, DEMO, 'org');
    const org = companyAddress(DEMO, { main: 'org' });
    await panelTitle(page).focus();
    await page.keyboard.press('Escape');
    await expectAddress(page, org, 'from the side panel');
    await talkBox(page).click();
    await page.keyboard.press('Escape');
    await expectAddress(page, org, 'from the talk bar');
    await expect(talkBox(page)).toBeFocused();
    await title(page, 'org').focus();
    await page.keyboard.press('Escape');
    await expectAddress(page, companyAddress(DEMO), 'from the board');
    // Opened by its address, nothing on the page opened it: focus goes to the office's heading.
    await expect(page.getByRole('heading', { level: 1, name: 'Café Lumen office' })).toBeFocused();
  });

  test('the mini-map hides while the feed is open over a board', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones have no mini-map.');
    await openBoard(page, DEMO, 'tasks');
    await expect(miniMap(page)).toBeVisible();
    await feedKey(page).click();
    await expect(feed(page)).toBeVisible();
    await expect(miniMap(page)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(feed(page)).toBeHidden();
    await expect(miniMap(page)).toBeVisible();
    // Escape closed the feed, not the board.
    await expectAddress(page, companyAddress(DEMO, { main: 'tasks' }));
  });

  test("a board keeps focus clear of the talk bar and the mini-map: Working's last card scrolls above them", async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones show one column at a time, checked in v3-task-board.');
    const frame = await openBoard(page, DEMO, 'tasks');
    const working = column(frame, 'Working');
    const cards = working.getByRole('link');
    const count = await cards.count();
    expect(count, 'the café has several tasks at work').toBeGreaterThan(3);
    await cards.first().focus();
    for (let i = 1; i < count; i++) {
      await page.keyboard.press('ArrowDown');
      await expect(cards.nth(i)).toBeFocused();
      expect(await hiddenFocus(page), `card ${i + 1} of Working`).toBeNull();
    }
    await shot(page, 'h59-last-card-clear', info);
  });

  test('at 768 a floating side panel leaves the board the width beside it, and its head fits', async ({ page }, info) => {
    test.skip(!layoutOf(page).floating, 'The side panel floats from 721 to 895 px.');
    for (const main of ['org', 'tasks', 'dashboards']) {
      const frame = await openBoard(page, DEMO, main);
      const panel = await sidePanel(page).boundingBox();
      const board = await frame.boundingBox();
      expect(panel, 'the side panel shows on a first visit').not.toBeNull();
      // Nothing of the board lies under the floating side panel.
      expect((board?.x ?? 0) + (board?.width ?? 0), `${main} ends left of the side panel`).toBeLessThanOrEqual((panel?.x ?? 0) - 12 + 1);
      await expect(frame.getByRole('button', { name: 'Back to the office', exact: true })).toBeVisible();
      await expectNoSidewaysScroll(page, main);
      await shot(page, `h59-768-${main}`, info);
    }
    // Hidden, the board takes the whole width again.
    await panelToggle(page).click();
    await expect(panelTitle(page)).toBeHidden();
    const frame = boardFrame(page, 'Dashboards');
    expect((await frame.boundingBox())?.width ?? 0).toBeGreaterThan(700);
  });

  test('phones: a board is a sheet, Office in the views row and Back return to the office', async ({ page }, info) => {
    test.skip(!layoutOf(page).phone, 'The phone layout.');
    const errors = watchErrors(page);
    await openBoard(page, DEMO, 'tasks');
    await expect(miniMap(page)).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    await shot(page, 'h59-phone-tasks', info);
    await switchTo(page, 'Office');
    await expectAddress(page, companyAddress(DEMO));
    await expect(boardFrame(page, 'Tasks')).toBeHidden();
    await page.goBack();
    await expectAddress(page, companyAddress(DEMO, { main: 'tasks' }));
    await expect(boardFrame(page, 'Tasks')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('addresses from before the stage and dock', () => {
  const OLD: [string, string][] = [
    ['inbox', companyAddress(DEMO)],
    ['people', companyAddress(DEMO, { main: 'org' })],
    ['people/frontend-engineer', companyAddress(DEMO, { panel: 'people/frontend-engineer' })],
    ['tasks/t-12', companyAddress(DEMO, { main: 'tasks', panel: 'tasks/t-12' })],
    ['messages/m-19', companyAddress(DEMO, { panel: 'messages/m-19' })],
    ['customize', companyAddress(DEMO, { panel: 'customize' })],
    ['settings', companyAddress(DEMO, { panel: 'settings' })],
    ['proposal', companyAddress(DEMO)],
  ];
  test('each opens its new form, in place', async ({ page }) => {
    const errors = watchErrors(page);
    for (const [old, now] of OLD) {
      await open(page, `/c/${DEMO}/${old}`);
      await expectAddress(page, now, `/c/${DEMO}/${old}`);
    }
    expect(errors).toEqual([]);
  });

  test('"Message Kai" and the composer\'s addresses set the To and put focus in the talk bar', async ({ page }) => {
    await open(page, `/c/${DEMO}/people/frontend-engineer/message`);
    await expectAddress(page, companyAddress(DEMO, { panel: 'people/frontend-engineer' }));
    await expect(theTo(page)).toHaveAccessibleName('To Kai, frontend engineer');
    await expect(talkBox(page)).toBeFocused();
    await open(page, `/c/${DEMO}/send/room/design`);
    await expectAddress(page, companyAddress(DEMO));
    await expect(theTo(page)).toHaveAccessibleName('To the design room');
    await expect(talkBox(page)).toBeFocused();
  });
});

test.describe('a board\'s own row and the window around it (final gates, F2)', () => {
  test('the row of what a press did, and its Undo, end with the board', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Checked at the desktop sizes; the phone sheet takes the same host.');
    const frame = await openBoard(page, DEMO, 'tasks');
    await column(frame, 'Paused').getByRole('button', { name: 'Resume' }).first().click();
    await expect(frame.getByText(/^Resumed “/)).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    // Away from the board, to another one: nothing of it is left, so an old Undo can never take back newer changes.
    await switchTo(page, 'Org');
    await expect(title(page, 'org')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
    await switchTo(page, 'Tasks');
    await expect(title(page, 'tasks')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  });

  test('the row takes a line of its own: it never lies over the column heads', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones show one column at a time.');
    const frame = await openBoard(page, DEMO, 'tasks');
    await column(frame, 'Paused').getByRole('button', { name: 'Resume' }).first().click();
    const row = frame.locator('.bf__row');
    await expect(row).toBeVisible();
    const rowBox = await row.boundingBox();
    const head = await frame.locator('.tb-col__head').first().boundingBox();
    expect((rowBox?.y ?? 0) + (rowBox?.height ?? 0)).toBeLessThanOrEqual((head?.y ?? 0) + 1);
  });

  test('a board ends a gutter above the strip and the talk bar, never under them', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones end their sheet above the dock (below).');
    const frame = await openBoard(page, DEMO, 'tasks');
    const scroller = frame.locator('.tb-scroll, .tb-grid').first();
    const strip = await scroller.boundingBox();
    const talk = await page.locator('#company-talk').boundingBox();
    expect((strip?.y ?? 0) + (strip?.height ?? 0)).toBeLessThanOrEqual((talk?.y ?? 0) - 12);
    // ...and not far above it: the strip's line and a gutter are all it keeps clear (the mini-map's corner is padding).
    expect((talk?.y ?? 0) - ((strip?.y ?? 0) + (strip?.height ?? 0))).toBeLessThanOrEqual(80);
  });
});

for (const [width, height] of [
  [720, 450],
  [768, 432],
  [320, 568],
  [844, 390],
] as const) {
  test.describe(`a phone layout at ${width} x ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test('the task board shows a card, and the plan keeps room for itself with its Approve bar in the flow', async ({ page }, info) => {
      test.skip(info.project.name !== 'v3', 'One project drives every size here.');
      const errors = watchErrors(page);
      const frame = await openBoard(page, DEMO, 'tasks');
      const visibleCards = await frame
        .getByRole('link')
        .evaluateAll(onElements<number>(`return els.filter((a) => { const r = a.getBoundingClientRect(); const f = a.closest('.bf').getBoundingClientRect(); return r.height > 0 && r.top >= f.top && r.top + 24 <= f.bottom; }).length;`));
      expect(visibleCards, 'a task card is in view').toBeGreaterThan(0);
      await expectNoSidewaysScroll(page, `tasks at ${width} x ${height}`);
      await shot(page, `f2-tasks-${width}x${height}`, info);
      await openBoard(page, DEMO, 'plan');
      const plan = await page.locator('.tb-plan').boundingBox();
      expect(plan?.height ?? 0, 'the plan has room to read').toBeGreaterThan(100);
      expect(errors).toEqual([]);
    });
  });
}
