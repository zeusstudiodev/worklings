import { expect, type APIRequestContext, type Locator, type Page, test } from '@playwright/test';
import {
  card,
  cardDrag,
  cardKeys,
  carryOver,
  column,
  companyAddress,
  deskTurns,
  expectAddress,
  expectNoSidewaysScroll,
  layoutOf,
  liftCard,
  moveMenu,
  nameFor,
  onElements,
  openBoard,
  panelTitle,
  running,
  setting,
  shot,
  stopWork,
  tell,
  titlesIn,
  until,
  watchErrors,
} from './v3-kit.ts';
import { api, view } from './v3-world.ts';

// H61 (AC37), the task board (docs/design-v3.md, "The task board"): columns by status with Waiting for you among them,
// cards as links, every row of the drop table by drag and by keyboard, the drop forms, Undo, filters and lanes, and
// the phone's column chips. The flows run in the demo company, Café Lumen; that a drag steers the switchboard runs in a
// company of the e2e hub with one desk, where the order work is handed out in can be seen.

const DEMO = 'demo';
const COLUMNS = ['Waiting for you', 'Queued', 'Working', 'Paused', 'Blocked', 'In review', 'Done'];
// The café's tasks at work with nothing of their owners waiting on you, so they stay in Working; one queued; one done.
const CLARA = 'Bilingual menu copy plan';
const JULES = 'Pickup flow from menu to counter';
const ADA = 'Design review of the pickup pages';
const INES = 'Checkout plan: payment and confirmation';
const QUEUED = 'Darker palette across the site';
const PAUSED = 'Slot picker visuals';
const DONE = 'Menu page layout';

const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What the row under the board's header says: the last result, with Undo while it can be taken back. */
const result = (frame: Locator, text: string | RegExp) => expect(frame.getByText(text).first()).toBeVisible();
const undo = (frame: Locator) => frame.getByRole('button', { name: 'Undo', exact: true });
/** A lifted card's own status, replaced at every step (the results stay in the live region). */
const step = (page: Page, text: RegExp) => expect(page.getByRole('status').filter({ hasText: text }).first()).toBeAttached();
const rail = (frame: Locator) => frame.getByRole('button', { name: /^Cancelled, \w+ tasks?$/ });

/**
 * A control of the board's header, through Filter where the head has folded the filters into it (a phone's sheet too):
 * the search field, or a picker named by its chip's word and what it shows ("Group None").
 */
async function headControl(page: Page, frame: Locator, label: 'Find a task' | 'Who' | 'Milestone' | 'Group'): Promise<Locator> {
  const control = label === 'Find a task' ? page.getByRole('searchbox', { name: label }) : page.getByRole('combobox', { name: new RegExp(`^${label}\\b`) });
  const filter = frame.getByRole('button', { name: /^Filter\b/ });
  // The head measures its room once the board has drawn and may fold its filters then: wait until it shows either.
  await expect(control.or(filter)).toBeVisible();
  if (!(await control.isVisible())) await filter.click();
  await expect(control).toBeVisible();
  return control;
}

/** Cancelled, opened: its rail opens on a press. */
async function cancelled(frame: Locator): Promise<Locator> {
  if (await rail(frame).isVisible()) await rail(frame).click();
  await expect(column(frame, 'Cancelled')).toBeVisible();
  return column(frame, 'Cancelled');
}

const dragging = (page: Page) => test.skip(layoutOf(page).phone, 'Phones have no dragging: Move does it there.');

test.describe('the columns and the cards', () => {
  test('columns by status in order, each a list under its heading, Cancelled a rail', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones show one column at a time, checked below.');
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    const names = await frame.getByRole('list').evaluateAll(
      onElements<string[]>(`return els.map((l) => {
        const by = l.getAttribute('aria-labelledby');
        const label = l.getAttribute('aria-label') || (by ? by.split(' ').map((id) => (document.getElementById(id) || {}).textContent || '').join(' ') : '');
        return label.trim();
      });`),
    );
    expect(names.map((n) => COLUMNS.find((c) => n.startsWith(c))).filter(Boolean)).toEqual(COLUMNS);
    // Mina's paused task is in Paused; In review is empty, so it says so (Theo's own review waits for his OK).
    await expect(card(column(frame, 'Paused'), PAUSED)).toBeVisible();
    await expect(frame.getByText('Nothing waits for review.')).toBeAttached();
    await expect(rail(frame)).toBeAttached();
    await expect(card(column(frame, 'Queued'), QUEUED)).toBeVisible();
    await expect(card(column(frame, 'Working'), CLARA)).toBeVisible();
    await expect(card(column(frame, 'Done'), DONE)).toBeAttached();
    // The plan waits for approval: its card leads Waiting for you.
    await expect(column(frame, 'Waiting for you').getByRole('link').first()).toHaveAccessibleName(/plan/i);
    await expectNoSidewaysScroll(page);
    await shot(page, 'h61-board', info);
    expect(errors).toEqual([]);
  });

  test('a card is a link to its task, named by its title and described by its owner, line and place in line', async ({ page }) => {
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    if (layoutOf(page).phone) await frame.getByRole('tab', { name: /^Working\b/ }).click();
    const clara = card(frame, CLARA);
    await expect(clara).toHaveAttribute('href', companyAddress(DEMO, { main: 'tasks', panel: 'tasks/t-30' }));
    await expect(clara).toHaveAccessibleDescription(/^Clara\. Working for .+\. .+ of \w+ in line\.$/);
    await clara.focus();
    await clara.press('Enter');
    await expectAddress(page, companyAddress(DEMO, { main: 'tasks', panel: 'tasks/t-30' }));
    await expect(panelTitle(page)).toHaveText(CLARA);
    expect(errors).toEqual([]);
  });

  test('every open card has Move, even out of sight; Done cards and the plan have none', async ({ page }) => {
    const frame = await openBoard(page, DEMO, 'tasks');
    // Hidden until hover or focus, Move stays in the accessibility tree (clipped, never display: none).
    await expect(page.getByRole('button', { name: `Move “${CLARA}”`, exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Move “${QUEUED}”`, exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Move “${DONE}”`, exact: true })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: /^Move “The CEO's plan/ })).toHaveCount(0);
  });
});

test.describe('dragging', () => {
  test('a drag within a column sets its place in line and keeps focus on the card, with Undo', async ({ page }, info) => {
    dragging(page);
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    const working = column(frame, 'Working');
    const before = await titlesIn(working);
    const [first, second] = before;
    if (!first || !second) throw new Error('Working has fewer than two cards.');
    await cardDrag(page, card(working, second), card(working, first), { before: true });
    await result(frame, new RegExp(`^Moved “${esc(second)}”: now \\w+ of \\w+ in line\\.`));
    await expect.poll(() => titlesIn(working)).toEqual([second, first, ...before.slice(2)]);
    await expect(card(working, second)).toBeFocused();
    await shot(page, 'h61-moved-in-line', info);
    await undo(frame).click();
    await expect.poll(() => titlesIn(working)).toEqual(before);
    expect(errors).toEqual([]);
  });

  test('a drag onto Paused pauses, and back onto its own column resumes, each with Undo', async ({ page }, info) => {
    dragging(page);
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    await cardDrag(page, card(column(frame, 'Working'), CLARA), column(frame, 'Paused'));
    await result(frame, `Paused “${CLARA}”. Clara stops and waits.`);
    await expect(card(column(frame, 'Paused'), CLARA)).toBeVisible();
    await expect(card(column(frame, 'Paused'), CLARA)).toHaveAccessibleDescription(/Paused by you at \d{1,2}:\d{2}( ?[AP]M)?\./);
    await shot(page, 'h61-paused', info);
    // Lifted out of Paused, the column it came from lights up; dropped there, it resumes.
    await cardDrag(page, card(column(frame, 'Paused'), CLARA), column(frame, 'Working'));
    await result(frame, `Resumed “${CLARA}”. Clara carries on.`);
    await expect(card(column(frame, 'Working'), CLARA)).toBeVisible();
    await undo(frame).click();
    await expect(card(column(frame, 'Paused'), CLARA)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a drag onto Cancelled opens the form there: Keep it puts the card back, Cancel the task cancels it, with Undo the cancel', async ({ page }, info) => {
    dragging(page);
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    // The rail opens into the column under the carried card (the rail stays, hidden), so the target is whichever shows.
    await cardDrag(page, card(column(frame, 'Working'), JULES), rail(frame).or(column(frame, 'Cancelled')).filter({ visible: true }).first());
    const why = frame.getByRole('textbox', { name: 'Why (they read it)' });
    await expect(frame.getByText(`Cancel “${JULES}”`).first()).toBeVisible();
    await expect(why).toBeFocused();
    await expect(frame.getByText('Jules stops, and what they changed is kept on a branch named after the task.')).toBeVisible();
    await shot(page, 'h61-cancel-form', info);
    await frame.getByRole('button', { name: 'Keep it', exact: true }).click();
    await expect(card(column(frame, 'Working'), JULES)).toBeFocused();
    // Nothing happens until the form's button; a reason is needed.
    await cardDrag(page, card(column(frame, 'Working'), JULES), rail(frame).or(column(frame, 'Cancelled')).filter({ visible: true }).first());
    await expect(why).toBeFocused();
    await frame.getByRole('button', { name: 'Cancel the task', exact: true }).click();
    await expect(why).toHaveAttribute('aria-invalid', 'true');
    await why.fill('The flow is settled in the plan.');
    await frame.getByRole('button', { name: 'Cancel the task', exact: true }).click();
    const list = await cancelled(frame);
    await expect(card(list, JULES)).toBeVisible();
    await expect(card(list, JULES)).toHaveAccessibleDescription(/Cancelled by you at \d{1,2}:\d{2}( ?[AP]M)?: the flow is settled in the plan\./i);
    // "Undo the cancel", on the card (its name may say which task, so several cancelled cards can be told apart).
    await frame.getByRole('button', { name: new RegExp(`^Undo the cancel( of “${esc(JULES)}”)?$`) }).first().click();
    await expect(card(column(frame, 'Working'), JULES)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a column that refuses a card sinks and says why while it is carried, and the card goes back', async ({ page }, info) => {
    dragging(page);
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    const refusals: [string, string, string][] = [
      [ADA, 'Done', 'Done tasks stay done.'],
      [ADA, 'Queued', "Started tasks don't go back to Queued."],
      [ADA, 'Blocked', 'Tasks get here by themselves as the work goes.'],
      [ADA, 'Waiting for you', 'Cards land here when someone needs you.'],
    ];
    for (const [title, to, why] of refusals) {
      const home = (await titlesIn(column(frame, 'Working'))).includes(title) ? 'Working' : 'Queued';
      await liftCard(page, card(frame, title));
      await carryOver(page, column(frame, to));
      await expect(frame.getByText(why).first(), `${to} says why it refuses ${title}`).toBeVisible();
      if (to === 'Done') await shot(page, 'h61-refused', info);
      await page.mouse.up();
      await expect(card(column(frame, home), title), `${title} goes back to ${home}`).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('a Queued card dropped on Working starts next, with Undo', async ({ page }) => {
    dragging(page);
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    // Robin, 12 Nov 2026: the drop on Working means "start it next", once refused.
    await cardDrag(page, card(column(frame, 'Queued'), QUEUED), column(frame, 'Working'));
    await result(frame, `“${QUEUED}” goes to the front.`);
    await expect(card(frame, QUEUED)).toHaveAccessibleDescription(/First of \w+ in line\./i);
    await undo(frame).click();
    await expect(card(frame, QUEUED)).not.toHaveAccessibleDescription(/First of \w+ in line\./i);
    expect(errors).toEqual([]);
  });

  test("a Done card doesn't lift", async ({ page }) => {
    dragging(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    const done = column(frame, 'Done');
    const before = await titlesIn(done);
    await liftCard(page, card(done, DONE));
    await page.mouse.move(200, 400, { steps: 10 });
    // Nothing lifted, so no column sinks to say why it would refuse it.
    await expect(frame.getByText('Cards land here when someone needs you.')).toBeHidden();
    await page.mouse.up();
    expect(await titlesIn(done)).toEqual(before);
  });

  test("Group: Person makes a lane per owner, and a drop in another person's lane reassigns after its form", async ({ page }, info) => {
    dragging(page);
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    await (await headControl(page, frame, 'Group')).selectOption({ label: 'Person' });
    await expect(frame.getByRole('heading', { name: /^Clara, head of content, \w+ tasks?$/ })).toBeVisible();
    await expect(frame.getByRole('heading', { name: /^Ines, team lead, web, \w+ tasks?$/ })).toBeAttached();
    await shot(page, 'h61-lanes', info);
    // Onto Ines's own card: a drop anywhere in her lane reassigns, after the form, with Ines chosen.
    await cardDrag(page, card(frame, CLARA), card(frame, INES));
    const note = frame.getByRole('textbox', { name: 'A handover note (optional)' });
    await expect(frame.getByText(`Reassign “${CLARA}”`).first()).toBeVisible();
    await expect(note).toBeFocused();
    await expect(frame.getByRole('button', { name: 'Keep it with Clara', exact: true })).toBeVisible();
    await note.fill('The copy plan needs a web view of the pages.');
    await frame.getByRole('button', { name: 'Reassign to Ines', exact: true }).click();
    await expect(card(frame, CLARA)).toHaveAccessibleDescription(/^Ines\./);
    // A reassignment has no Undo: the new owner may have started.
    await expect(undo(frame)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the keyboard way', () => {
  test('Space picks a card up, the arrows move it with each step said, Space puts it there, Escape puts it back', async ({ page }, info) => {
    test.skip(layoutOf(page).phone, 'Phones move cards with Move, checked below.');
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    const working = column(frame, 'Working');
    const before = await titlesIn(working);
    const [first, second] = before;
    if (!first || !second) throw new Error('Working has fewer than two cards.');
    await card(working, second).focus();
    await page.keyboard.press('Space');
    await result(frame, `Moving “${second}”. Arrow keys move it, Space puts it here, Escape puts it back.`);
    await page.keyboard.press('ArrowUp');
    await step(page, new RegExp(`^Before ${esc(first)}, \\w+ of \\w+ in Working\\.$`));
    await shot(page, 'h61-lifted-by-keys', info);
    await page.keyboard.press('Space');
    await result(frame, new RegExp(`^Moved “${esc(second)}”: now \\w+ of \\w+ in line\\.`));
    await expect.poll(() => titlesIn(working)).toEqual([second, first, ...before.slice(2)]);
    await expect(card(working, second)).toBeFocused();
    await cardKeys(page, card(working, second), ['ArrowDown', 'ArrowDown'], 'Escape');
    await expect.poll(() => titlesIn(working)).toEqual([second, first, ...before.slice(2)]);
    await expect(card(working, second)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('Right carries a lifted card to the next column that takes it, and Left takes it home', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones move cards with Move, checked below.');
    const frame = await openBoard(page, DEMO, 'tasks');
    await cardKeys(page, card(frame, CLARA), ['ArrowRight'], 'Space');
    await result(frame, `Paused “${CLARA}”. Clara stops and waits.`);
    await expect(card(column(frame, 'Paused'), CLARA)).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await step(page, /^Over Working: dropping it here resumes it\.|^Before /);
    await page.keyboard.press('Space');
    await result(frame, `Resumed “${CLARA}”. Clara carries on.`);
    await expect(card(column(frame, 'Working'), CLARA)).toBeFocused();
  });

  test('Right from Working says Paused takes it; past Paused the columns that refuse are skipped and named', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones move cards with Move, checked below.');
    const frame = await openBoard(page, DEMO, 'tasks');
    await card(frame, CLARA).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await step(page, /^Over Paused: dropping it here pauses it\./);
    await page.keyboard.press('ArrowRight');
    await step(page, /Skipped Blocked: tasks get here by themselves as the work goes\./i);
    await page.keyboard.press('Escape');
    await expect(card(column(frame, 'Working'), CLARA)).toBeFocused();
  });

  test("Move's menu covers every drop: Pause from it, focus staying on the card in its new place", async ({ page }, info) => {
    const errors = watchErrors(page);
    const phone = layoutOf(page).phone;
    const frame = await openBoard(page, DEMO, 'tasks');
    if (phone) await frame.getByRole('tab', { name: /^Working\b/ }).click();
    const menu = await moveMenu(page, CLARA);
    const item = (name: string) => menu.getByRole(phone ? 'button' : 'menuitem', { name, exact: true });
    for (const name of ['Move to the top', 'Up', 'Down', 'Move to the bottom', 'Pause', 'Reassign…', 'Cancel the task…', 'Open']) await expect(item(name), name).toBeVisible();
    // Picking up is for keyboards; a phone's sheet has no dragging.
    await expect(item('Pick up')).toHaveCount(phone ? 0 : 1);
    await shot(page, 'h61-move-menu', info);
    if (phone) {
      // The action sheet closes with Escape, focus back on Move.
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(page.getByRole('button', { name: `Move “${CLARA}”`, exact: true })).toBeFocused();
      await page.getByRole('button', { name: `Move “${CLARA}”`, exact: true }).click();
    }
    await item('Pause').click();
    await result(frame, `Paused “${CLARA}”. Clara stops and waits.`);
    // A phone brings Paused into view itself, and focus follows the card there.
    await expect(card(frame, CLARA)).toBeFocused();
    if (phone) await expect(frame.getByRole('tab', { name: /^Paused\b/ })).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
});

test.describe('filters and the phone', () => {
  test('Find a task narrows the board and says how many match; Show all brings it back', async ({ page }, info) => {
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    await (await headControl(page, frame, 'Find a task')).fill('pickup');
    await expect(page.getByRole('status').filter({ hasText: /^\d+ of \d+ tasks$/ }).first()).toBeAttached();
    if (!layoutOf(page).phone) {
      await expect(card(frame, CLARA)).toHaveCount(0);
      await expect(card(frame, JULES)).toBeVisible();
    }
    await shot(page, 'h61-filtered', info);
    // Where the head folds the filters into Filter, their popover lies over the row with Show all: press Filter to put it away.
    const filterKey = frame.getByRole('button', { name: /^Filter\b/ });
    const sheet = page.getByRole('dialog', { name: 'Filter the tasks' });
    if (await sheet.isVisible()) {
      // On a phone the filters are a modal sheet over the board, with its own Show all and Close.
      await sheet.getByRole('button', { name: 'Show all', exact: true }).click();
      await sheet.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(sheet).toBeHidden();
    } else {
      if ((await filterKey.isVisible()) && (await frame.getByRole('group', { name: 'Filters' }).isVisible())) await filterKey.click();
      await page.getByRole('button', { name: 'Show all', exact: true }).first().click();
    }
    if (!layoutOf(page).phone) await expect(card(frame, CLARA)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('phones: one column at a time under chips with their counts', async ({ page }, info) => {
    test.skip(!layoutOf(page).phone, 'The phone layout.');
    const errors = watchErrors(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    const chips = frame.getByRole('tablist');
    await expect(chips).toBeVisible();
    for (const name of COLUMNS) await expect(chips.getByRole('tab', { name: new RegExp(`^${name}\\b`) })).toHaveCount(1);
    await chips.getByRole('tab', { name: /^Queued\b/ }).click();
    await expect(chips.getByRole('tab', { name: /^Queued\b/ })).toHaveAttribute('aria-selected', 'true');
    const queued = frame.getByRole('tabpanel', { name: /^Queued\b/ });
    await expect(card(queued, QUEUED)).toBeVisible();
    await expect(card(queued, QUEUED)).toBeInViewport();
    await chips.getByRole('tab', { name: /^Done\b/ }).click();
    await expect(chips.getByRole('tab', { name: /^Done\b/ })).toHaveAttribute('aria-selected', 'true');
    // Done, newest first: its first card is in view (Menu page layout, further down, is in the panel too).
    const done = frame.getByRole('tabpanel', { name: /^Done\b/ });
    await expect(done.getByRole('link').first()).toBeInViewport();
    await expect(card(done, DONE)).toBeAttached();
    // Only the current column is in reach: the others are inert, out of the tab order.
    await expect(queued).toHaveAttribute('inert', '');
    await expectNoSidewaysScroll(page);
    await shot(page, 'h61-phone-columns', info);
    expect(errors).toEqual([]);
  });
});

test.describe('the board steers the office', () => {
  test.describe.configure({ mode: 'serial' });

  let id = '';
  test.beforeAll(async ({ playwright }, info) => {
    test.setTimeout(120_000);
    const request = await playwright.request.newContext();
    id = await running(request, nameFor('cards', info));
    // One desk at a time, so the order work is handed out in shows.
    await setting(request, id, { maxDesks: 1 });
    await request.dispose();
  });

  const newTask = (title: string, owner: string) => ({ title, brief: `Do ${title}`, files: [`${title}.md`], owner, doneWhen: 'It is done', milestone: null });

  /** Two tasks behind a busy desk: Lea holds the only one with a long turn, so both wait their turn. */
  async function queueTwo(request: APIRequestContext, a: [string, string], b: [string, string]): Promise<void> {
    await tell(request, id, 'ux-designer', '[fake:long] Think about the whole flow');
    await until(request, id, (c) => c.people.find((p) => p.id === 'ux-designer')?.desk.state === 'working');
    const made = [await api(request, `api/c/${id}/tasks`, newTask(...a)), await api(request, `api/c/${id}/tasks`, newTask(...b))];
    expect(made.map((m) => m.status)).toEqual([201, 201]);
  }

  /** Once Lea lets go of the desk, which of the two the switchboard hands out first, by the briefs' own words. */
  async function handedFirst(request: APIRequestContext, a: string, b: string): Promise<string> {
    await stopWork(request, id, 'ux-designer');
    await expect.poll(() => deskTurns(`Do ${a}`).length > 0 && deskTurns(`Do ${b}`).length > 0, { timeout: 60_000 }).toBe(true);
    return (deskTurns(`Do ${a}`)[0]?.at ?? Infinity) < (deskTurns(`Do ${b}`)[0]?.at ?? Infinity) ? a : b;
  }

  /** The column both wait in: Queued, or Working while their owners wait for a desk. */
  async function columnOf(frame: Locator, a: string, b: string): Promise<Locator> {
    for (const name of ['Queued', 'Working']) {
      const titles = await titlesIn(column(frame, name));
      if (titles.includes(a) && titles.includes(b)) return column(frame, name);
    }
    throw new Error(`${a} and ${b} don't wait in one column.`);
  }

  test('a drag sets the order the switchboard hands out work in', async ({ page, request }, info) => {
    dragging(page);
    test.setTimeout(150_000);
    const a = `Drag Alpha ${info.project.name}`;
    const b = `Drag Beta ${info.project.name}`;
    await queueTwo(request, [a, 'ui-designer'], [b, 'frontend-engineer']);
    const frame = await openBoard(page, id, 'tasks');
    await expect(card(frame, b)).toBeVisible();
    const list = await columnOf(frame, a, b);
    expect((await titlesIn(list)).indexOf(a)).toBeLessThan((await titlesIn(list)).indexOf(b));
    await cardDrag(page, card(list, b), card(list, a), { before: true });
    await expect.poll(async () => (await titlesIn(list)).indexOf(b) < (await titlesIn(list)).indexOf(a)).toBe(true);
    const tasks = (await view(request, id)).tasks;
    const rank = (t: string) => tasks.find((x) => x.title === t)?.priority ?? 0;
    expect(rank(b)).toBeLessThan(rank(a));
    await shot(page, 'h61-hub-drag', info);
    expect(await handedFirst(request, a, b)).toBe(b);
  });

  test('the same by keyboard: Space, Up, Space', async ({ page, request }, info) => {
    test.skip(layoutOf(page).phone, 'Phones use Move.');
    test.setTimeout(150_000);
    const a = `Keys Gamma ${info.project.name}`;
    const b = `Keys Delta ${info.project.name}`;
    await queueTwo(request, [a, 'backend-engineer'], [b, 'qa-engineer']);
    const frame = await openBoard(page, id, 'tasks');
    await expect(card(frame, b)).toBeVisible();
    const list = await columnOf(frame, a, b);
    const order = await titlesIn(list);
    const ups = order.indexOf(b) - order.indexOf(a);
    expect(ups).toBeGreaterThan(0);
    await cardKeys(page, card(list, b), Array.from({ length: ups }, () => 'ArrowUp'));
    await expect.poll(async () => (await titlesIn(list)).indexOf(b) < (await titlesIn(list)).indexOf(a)).toBe(true);
    expect(await handedFirst(request, a, b)).toBe(b);
  });
});

test.describe('focus and the hand on the board (final gates, F2)', () => {
  test('Move to the bottom brings the card, where focus follows it, into view', async ({ page }) => {
    test.skip(layoutOf(page).phone, 'Phones show one column at a time; the card stays under its chips there.');
    const frame = await openBoard(page, DEMO, 'tasks');
    const working = column(frame, 'Working');
    const menu = await moveMenu(page, INES);
    await menu.getByRole('menuitem', { name: 'Move to the bottom', exact: true }).click();
    await expect(card(working, INES)).toBeFocused();
    // The column's scroller keeps the card in view, clear of the talk bar below the board.
    await expect(card(working, INES)).toBeInViewport({ ratio: 1 });
    const box = await card(working, INES).boundingBox();
    const talk = await page.locator('#company-talk').boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(talk?.y ?? 0);
  });

  test('Space on another card while the mouse holds one leaves the dragged card alone', async ({ page }) => {
    dragging(page);
    const frame = await openBoard(page, DEMO, 'tasks');
    await liftCard(page, card(column(frame, 'Working'), CLARA));
    await card(column(frame, 'Working'), JULES).focus();
    await page.keyboard.press('Space');
    await carryOver(page, column(frame, 'Paused'));
    await page.mouse.up();
    await result(frame, `Paused “${CLARA}”. Clara stops and waits.`);
    await expect(card(column(frame, 'Working'), JULES)).toBeVisible();
    await expect(card(column(frame, 'Paused'), JULES)).toHaveCount(0);
  });
});
