import { expect, type Page, test } from '@playwright/test';
import {
  deskTurns,
  feed,
  feedKey,
  fromPalette,
  layoutOf,
  nameFor,
  openCompany,
  openPanel,
  pickMention,
  running,
  scratchOf,
  sendKey,
  shot,
  sidePanel,
  stopWork,
  strip,
  talk,
  talkBar,
  talkBox,
  talkList,
  tell,
  theTo,
  touchFirst,
  until,
  waitForProposal,
  watchErrors,
  showStrip,
} from './v3-kit.ts';
import { api, found, view } from './v3-world.ts';

// H57 (AC33), the dock (docs/design-v3.md, "The talk bar", "The live strip"): the one box for talking. Who hears it
// (the To, its picker, `@` at the start and after the first word, the exact-match rule), `/` commands with their steps,
// Stop, sending one copy per pick with partial refusals, Unsend, history, the strip's lines within a second, and the
// feed it opens into, by keyboard. The flows run in the demo company; what must reach the office runs in a company of
// the e2e hub, where only Claude Code is faked.

const DEMO = 'demo';

/** The office's one polite live region, where sends, refusals and changes of who hears it are said. */
// The office's live region holds each sentence it said as a paragraph of its own (announcer.tsx), so a sentence is
// matched on its own, not on the whole region, which keeps the last few together.
const said = (page: Page, text: string | RegExp) => expect(page.locator('[aria-live="polite"] > p, [role="status"]').filter({ hasText: text }).first()).toBeAttached();

/** The talk bar's hint row, the box's description. */
const hintSays = (page: Page, text: string | RegExp) => expect(talkBox(page)).toHaveAccessibleDescription(text);

test.describe('who hears it', () => {
  test('the To starts on the CEO, and opening someone makes them the To only while the box is empty', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    await expect(theTo(page)).toHaveAccessibleName('To Mara, CEO');
    await expect(theTo(page)).toHaveAccessibleDescription('Change who hears it');
    await expect(theTo(page)).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(theTo(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(talkBox(page)).toHaveAccessibleName('Message to Mara, CEO');
    await expect(talkBox(page)).toHaveAttribute('placeholder', 'Say something to Mara');
    await fromPalette(page, 'Kai', /^Open Kai\b/);
    await expect(theTo(page)).toHaveAccessibleName('To Kai, frontend engineer');
    // A half-written message never changes hands: opening Mina leaves the To on Kai.
    await talkBox(page).fill('The slot buttons need');
    await fromPalette(page, 'Mina', /^Open Mina\b/);
    await expect(theTo(page)).toHaveAccessibleName('To Kai, frontend engineer');
    await expect(talkBox(page)).toHaveValue('The slot buttons need');
    // "Message Mina" changes it with words in the box: they stay, and focus goes there.
    await sidePanel(page).getByRole('button', { name: 'Message Mina', exact: true }).click();
    await expect(theTo(page)).toHaveAccessibleName('To Mina, UI designer');
    await expect(talkBox(page)).toHaveValue('The slot buttons need');
    await expect(talkBox(page)).toBeFocused();
    await shot(page, 'h57-to-mina', info);
    expect(errors).toEqual([]);
  });

  test("the To's picker: search, pick by keyboard, and Escape clears the search, then closes it", async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const phone = layoutOf(page).phone;
    await theTo(page).click();
    // A popover over the To on desktops (a non-modal dialog), a modal sheet on phones.
    const picker = page.getByRole('dialog', { name: 'Who hears it' }).or(page.getByRole('group', { name: 'Who hears it' })).first();
    await expect(picker).toBeVisible();
    await expect(theTo(page)).toHaveAttribute('aria-expanded', 'true');
    const search = picker.getByLabel('Find someone, a room or a team', { exact: true });
    // Desktops start in the field; a phone's sheet on its first option, so the keyboard doesn't rise over the choices.
    if (!phone) await expect(search).toBeFocused();
    await search.fill('design');
    if (phone) {
      await picker.getByRole('button', { name: /design room/i }).first().click();
    } else {
      const option = picker.getByRole('option', { name: /design room/i }).first();
      const wanted = await option.getAttribute('id');
      for (let i = 0; i < 12 && (await search.getAttribute('aria-activedescendant')) !== wanted; i++) await search.press('ArrowDown');
      await search.press('Enter');
    }
    await expect(picker).toBeHidden();
    await expect(theTo(page)).toHaveAccessibleName('To the design room');
    await expect(talkBox(page)).toBeFocused();
    await expect(talkBox(page)).toHaveAttribute('placeholder', 'Say something to the design room');
    // Nothing matching says so; Escape clears the words, then closes, with focus back on the To.
    await theTo(page).click();
    await expect(picker).toBeVisible();
    await search.fill('zo');
    await expect(picker.getByText('No one called “zo”.').first()).toBeVisible();
    await shot(page, 'h57-picker-no-match', info);
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(picker).toBeVisible();
    await search.press('Escape');
    await expect(picker).toBeHidden();
    await expect(theTo(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('@ at the start lists who can hear it; a pick by keyboard is for this message only, and Backspace drops it', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const box = talkBox(page);
    await box.click();
    // An empty box with focus teaches the two keys.
    await hintSays(page, /Type @ to choose who hears it, \/ for a command\./);
    await box.pressSequentially('@des');
    const list = await talkList(page);
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute('role', 'listbox');
    await expect(box).toHaveAttribute('aria-autocomplete', 'list');
    await expect(list.getByRole('option', { name: /design room/i }).first()).toBeVisible();
    // The count is said once typing pauses.
    await expect(page.getByRole('status').filter({ hasText: /match\. Up and Down choose, Enter picks\.$/ }).first()).toBeAttached();
    await shot(page, 'h57-at-list', info);
    await box.press('Escape');
    await expect(list).toBeHidden();
    await expect(box).toHaveValue('@des');
    await box.fill('');
    await pickMention(page, { type: 'des', pick: /design room/i });
    await expect(box).toHaveValue('');
    await expect(theTo(page)).toHaveAccessibleName(/^To the design room/);
    // Said in its name everywhere; shown as its second line where the To has room (compact, the hint row says it).
    await expect(theTo(page)).toHaveAccessibleName(/, for this message only$/);
    if (!layoutOf(page).phone) await expect(theTo(page)).toContainText('For this message only');
    await said(page, 'To the design room, for this message only.');
    await box.press('Backspace');
    await expect(theTo(page)).toHaveAccessibleName('To Mara, CEO');
    await said(page, 'To Mara, CEO.');
    // All hands only from "@al" or "@ev", so a slip of a key never reaches 18 people.
    await box.pressSequentially('@a');
    await expect((await talkList(page)).getByRole('option', { name: /^All hands|^Everyone/ })).toHaveCount(0);
    await box.pressSequentially('l');
    await expect((await talkList(page)).getByRole('option', { name: /^All hands|^Everyone/ }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a typed mention counts only when it is exact; anything else stays as words, said before sending', async ({ page }) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const box = talkBox(page);
    await box.click();
    await box.pressSequentially('@ka make the slots bigger');
    await hintSays(page, /@ka isn't anyone's name, so it stays as words\./);
    await expect(theTo(page)).toHaveAccessibleName('To Mara, CEO');
    await box.fill('');
    await box.pressSequentially('@Kai make the slots bigger');
    // Exact, it works as a pick, and the words stay as typed.
    await expect(theTo(page)).toHaveAccessibleName(/^To Kai, frontend engineer/);
    await expect(box).toHaveValue('@Kai make the slots bigger');
    await box.fill('make the slots bigger');
    await expect(theTo(page)).toHaveAccessibleName('To Mara, CEO');
    expect(errors).toEqual([]);
  });
});

test.describe('commands', () => {
  test('/ lists the palette\'s commands; one without steps runs at once and offers Undo', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const box = talkBox(page);
    await box.click();
    // "/pause des" finds the design room too; a task's pause is one the office can take back, so it offers Undo.
    await box.pressSequentially('/pause des');
    const list = await talkList(page);
    await expect(list.getByRole('option', { name: /^Pause the design room/ }).first()).toBeVisible();
    await box.fill('');
    await box.pressSequentially('/pause bilingual');
    const option = list.getByRole('option', { name: /^Pause “?Bilingual menu copy plan/ }).first();
    await expect(option).toBeVisible();
    await shot(page, 'h57-commands', info);
    const wanted = await option.getAttribute('id');
    for (let i = 0; i < 12 && (await box.getAttribute('aria-activedescendant')) !== wanted; i++) await box.press('ArrowDown');
    await box.press('Enter');
    await hintSays(page, /^Paused/);
    await expect(talkBar(page).getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await said(page, /^Paused/);
    await talkBar(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(talkBar(page).getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a command's steps are asked in the bar: Escape steps back, the last step's key is Run", async ({ page }, info) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const box = talkBox(page);
    await box.click();
    await box.pressSequentially('/cancel cart');
    const option = (await talkList(page)).getByRole('option', { name: /^Cancel “Cart summary”/ }).first();
    await expect(option).toBeVisible();
    const wanted = await option.getAttribute('id');
    for (let i = 0; i < 12 && (await box.getAttribute('aria-activedescendant')) !== wanted; i++) await box.press('ArrowDown');
    await box.press('Enter');
    // The To becomes the command, a row and not a button; the box asks the step.
    await expect(talkBar(page).getByText(/^Cancel “Cart summary”/).first()).toBeVisible();
    await expect(theTo(page)).toHaveCount(0);
    await expect(box).toHaveAccessibleName('Why cancel it?');
    await expect(talkBar(page).getByRole('button', { name: 'Run', exact: true })).toBeVisible();
    await shot(page, 'h57-command-step', info);
    // Escape from the first step goes back to the list, with what was typed.
    await box.press('Escape');
    await expect(box).toHaveValue('/cancel cart');
    await expect((await talkList(page)).getByRole('option', { name: /^Cancel “Cart summary”/ }).first()).toBeVisible();
    await box.press('Enter');
    await expect(box).toHaveAccessibleName('Why cancel it?');
    await box.pressSequentially('Not needed for the launch');
    // Enter runs the last step, as Run does; touch-first screens press Run, since Return starts a line there.
    if (await touchFirst(page)) await talkBar(page).getByRole('button', { name: 'Run', exact: true }).click();
    else await box.press('Enter');
    await hintSays(page, /Cancelled “Cart summary”|“Cart summary” is cancelled/);
    await expect(talkBar(page).getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect(theTo(page)).toHaveAccessibleName('To Mara, CEO');
    expect(errors).toEqual([]);
  });

  test('a / that matches no command says Enter sends it as a message', async ({ page }) => {
    await openCompany(page, DEMO);
    await talkBox(page).click();
    await talkBox(page).pressSequentially('/zzzz');
    await expect(page.getByText('No command matches. Enter sends it as a message.').first()).toBeVisible();
  });
});

test.describe('typing', () => {
  test('Enter sends and Shift+Enter starts a line; over 4,000 characters Send is unavailable and nothing is cut', async ({ page }) => {
    test.skip(await touchFirst(page), 'Touch-first screens start a line with Return and send with Send.');
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    const box = talkBox(page);
    await box.click();
    // Send is unavailable with an empty box, and focus stays.
    await expect(sendKey(page)).toHaveAttribute('aria-disabled', 'true');
    await box.pressSequentially('line one');
    await box.press('Shift+Enter');
    await box.pressSequentially('line two');
    await expect(box).toHaveValue('line one\nline two');
    const long = 'x'.repeat(4_120);
    await box.fill(long);
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await hintSays(page, /4,120 of 4,000\. Shorten it by 120 to send\./);
    await expect(sendKey(page)).toHaveAttribute('aria-disabled', 'true');
    await box.press('Enter');
    await expect(box).toHaveValue(long);
    expect(errors).toEqual([]);
  });

  test('Up in an empty box brings back what was sent with its To, and Down returns to the draft', async ({ page }) => {
    const errors = watchErrors(page);
    await openCompany(page, DEMO);
    await talk(page, null, 'The menu reads well now');
    await talk(page, 'Kai', 'Bigger slot buttons, please');
    await expect(theTo(page)).toHaveAccessibleName('To Mara, CEO');
    const box = talkBox(page);
    await box.press('ArrowUp');
    await expect(box).toHaveValue('Bigger slot buttons, please');
    await expect(theTo(page)).toHaveAccessibleName(/^To Kai, frontend engineer/);
    await box.press('ArrowUp');
    await expect(box).toHaveValue('The menu reads well now');
    await expect(theTo(page)).toHaveAccessibleName(/^To Mara, CEO/);
    await box.press('ArrowDown');
    await box.press('ArrowDown');
    await expect(box).toHaveValue('');
    // What was sent stays for the tab only: nothing of it is left in localStorage, which outlives the tab.
    const kept = await page.evaluate(`[sessionStorage, localStorage].map((s) => Object.keys(s).filter((k) => k.startsWith('worklings-talk-history')).length)`);
    expect(kept).toEqual([1, 0]);
    expect(errors).toEqual([]);
  });

  test('Feed opens the feed with focus on its heading and closes it back to Feed, by keyboard; so does the strip', async ({ page }, info) => {
    const errors = watchErrors(page);
    // v0.8: the strip is off by default; this test shows it to check it too. Feed is in the talk bar on phones as well.
    await showStrip(page);
    await openCompany(page, DEMO);
    const phone = layoutOf(page).phone;
    const opener = feedKey(page);
    await opener.focus();
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    const controls = await opener.getAttribute('aria-controls');
    await page.keyboard.press('Enter');
    await expect(feed(page)).toBeVisible();
    expect(await feed(page).getAttribute('id')).toBe(controls);
    await expect(feed(page).getByRole('heading', { level: 2, name: 'Feed' })).toBeFocused();
    if (!phone) {
      await expect(feedKey(page)).toHaveAccessibleName('Close the feed');
      await expect(feedKey(page)).toHaveAttribute('aria-expanded', 'true');
      // The strip hides while the feed is open.
      await expect(strip(page)).toBeHidden();
    }
    await shot(page, 'h57-feed-open', info);
    await page.keyboard.press('Escape');
    await expect(feed(page)).toBeHidden();
    await expect(feedKey(page)).toBeFocused();
    if (!phone) {
      await strip(page).focus();
      await page.keyboard.press('Enter');
      await expect(feed(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(feedKey(page)).toBeFocused();
    }
    expect(errors).toEqual([]);
  });

  test('the compact talk bar: the To as a face and first name, Send an icon key', async ({ page }, info) => {
    test.skip(!layoutOf(page).phone, 'The compact form is the phone layout here; under a 640 px main view on desktops too.');
    await openCompany(page, DEMO);
    await expect(theTo(page)).toHaveAccessibleName('To Mara, CEO');
    // The phone's To chip reads "To Mara": the first name, not the title.
    await expect(theTo(page)).toContainText('Mara');
    await expect(theTo(page).getByText(/CEO/)).toHaveCount(0);
    const send = await sendKey(page).boundingBox();
    expect(send?.width).toBeGreaterThanOrEqual(44);
    expect(send?.height).toBeGreaterThanOrEqual(44);
    await shot(page, 'h57-compact', info);
  });

  test('Stop turns the bar into Stop for that person, and Escape cancels it with the words kept', async ({ page }, info) => {
    const errors = watchErrors(page);
    await openPanel(page, DEMO, 'people/frontend-engineer');
    await talkBox(page).fill('Use the darker tokens');
    await sidePanel(page).getByRole('button', { name: /^Stop( Kai)?$/ }).click();
    await expect(talkBar(page).getByText('Stop Kai', { exact: true })).toBeVisible();
    await expect(theTo(page)).toHaveCount(0);
    await expect(talkBox(page)).toHaveAccessibleName('Stop Kai and say what to do instead');
    await expect(talkBox(page)).toBeFocused();
    await expect(talkBox(page)).toHaveValue('Use the darker tokens');
    await expect(talkBar(page).getByRole('button', { name: 'Stop and send', exact: true })).toBeVisible();
    await expect(talkBar(page).getByRole('button', { name: 'Stop and wait', exact: true })).toBeVisible();
    await expect(talkBar(page).getByRole('button', { name: /^Cancel( stopping Kai)?$/ })).toBeVisible();
    await shot(page, 'h57-stop', info);
    await talkBox(page).press('Escape');
    await expect(theTo(page)).toHaveAccessibleName('To Kai, frontend engineer');
    await expect(talkBox(page)).toHaveValue('Use the darker tokens');
    expect(errors).toEqual([]);
  });
});

test.describe('sending to the office', () => {
  test.describe.configure({ mode: 'serial' });

  let id = '';
  test.beforeAll(async ({ playwright }, info) => {
    test.setTimeout(120_000);
    const request = await playwright.request.newContext();
    id = await running(request, nameFor('talk', info));
    await request.dispose();
  });

  test('an @room picked by keyboard sends a copy to each of its people, and the To comes back after', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const tag = `[talk-room-${info.project.name}]`;
    await openCompany(page, id);
    await talk(page, { type: 'des', pick: /design room/i }, `Menu pages come first this week ${tag}`);
    await hintSays(page, /^Sent\./);
    await said(page, /^Sent\./);
    const copies = await until(request, id, (c) => {
      const m = c.messages.filter((x) => x.text.includes(tag));
      return m.length === 3 && m;
    });
    expect(copies.map((m) => m.to).sort()).toEqual(['head-of-design', 'ui-designer', 'ux-designer']);
    expect(copies.every((m) => m.audience?.kind === 'room' && m.typed === true)).toBe(true);
    await expect(theTo(page)).toHaveAccessibleName('To Noor, CEO');
    await shot(page, 'h57-sent-room', info);
    expect(errors).toEqual([]);
  });

  test('several picks before the first word all hear it, one copy each', async ({ page, request }, info) => {
    const tag = `[talk-two-${info.project.name}]`;
    await openCompany(page, id);
    await talkBox(page).click();
    await pickMention(page, 'Kai');
    await pickMention(page, 'Lea');
    await expect(theTo(page)).toHaveAccessibleName(/^To Kai and Lea/);
    await talkBox(page).pressSequentially(`Make the buttons bigger ${tag}`);
    if (await touchFirst(page)) await sendKey(page).click();
    else await talkBox(page).press('Enter');
    const copies = await until(request, id, (c) => {
      const m = c.messages.filter((x) => x.text.includes(tag));
      return m.length === 2 && m;
    });
    expect(copies.map((m) => m.to).sort()).toEqual(['ui-designer', 'ux-designer']);
  });

  test("@ after the first word says who it's for: the hint says what will happen, and the message carries it", async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const tag = `[talk-for-${info.project.name}]`;
    await openCompany(page, id);
    const box = talkBox(page);
    await box.click();
    await pickMention(page, 'Ada');
    await box.pressSequentially('ask ');
    await box.pressSequentially('@Ka');
    const list = await talkList(page);
    await expect(list.getByText("Who it's for. You'll see if it reaches them.")).toBeVisible();
    await expect(list.getByRole('option', { name: /^Send it to Kai instead/ })).toBeVisible();
    await box.press('Backspace');
    await box.press('Backspace');
    await box.press('Backspace');
    await pickMention(page, 'Kai');
    await expect(talkBar(page).getByRole('button', { name: 'Not for Kai', exact: true })).toBeAttached();
    await hintSays(page, /Ada gets it and passes it on to Kai\./);
    await shot(page, 'h57-for-kai', info);
    await box.pressSequentially(` to darken the palette ${tag}`);
    if (await touchFirst(page)) await sendKey(page).click();
    else await box.press('Enter');
    const sent = await until(request, id, (c) => c.messages.find((m) => m.text.includes(tag) && !m.relayOf));
    expect(sent.to).toBe('head-of-design');
    expect(sent.for).toEqual(['ui-designer']);
    expect(errors).toEqual([]);
  });

  test('a send to several picks, partly refused, says who got it, and Try again sends only to the rest', async ({ page, request }, info) => {
    const tag = `[talk-partial-${info.project.name}]`;
    let refuse = true;
    // The office turns Lea's copy down once, as a desk restarting would; Kai's goes through.
    await page.route(`**/api/c/${id}/**`, async (route) => {
      const body = route.request().postData() ?? '';
      if (refuse && route.request().method() === 'POST' && body.includes(tag) && body.includes('ux-designer')) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Lea is in a meeting' }) });
      } else await route.continue();
    });
    await openCompany(page, id);
    await talk(page, ['Kai', 'Lea'], `The streak card needs a flame ${tag}`);
    await hintSays(page, /Sent to Kai\. Couldn't send to Lea: .*in a meeting/i);
    await said(page, /Sent to Kai\. Couldn't send to Lea/);
    await shot(page, 'h57-partly-refused', info);
    refuse = false;
    await talkBar(page).getByRole('button', { name: 'Try again', exact: true }).click();
    const copies = await until(request, id, (c) => {
      const m = c.messages.filter((x) => x.text.includes(tag));
      return m.length === 2 && m;
    });
    // Kai got one copy, not a second one from Try again.
    expect(copies.map((m) => m.to).sort()).toEqual(['ui-designer', 'ux-designer']);
  });

  test('a refused send puts the words back, with Try again', async ({ page }, info) => {
    const tag = `[talk-refused-${info.project.name}]`;
    await page.route(`**/api/c/${id}/**`, async (route) => {
      if (route.request().method() === 'POST' && (route.request().postData() ?? '').includes(tag)) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The office is busy' }) });
      } else await route.continue();
    });
    await openCompany(page, id);
    const box = talkBox(page);
    await box.click();
    await box.pressSequentially(`Water the fern ${tag}`);
    if (await touchFirst(page)) await sendKey(page).click();
    else await box.press('Enter');
    await hintSays(page, /^Couldn't send: The office is busy/);
    await expect(box).toHaveValue(`Water the fern ${tag}`);
    await expect(talkBar(page).getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  });

  test('Unsend takes a waiting message back and puts its words in the box', async ({ page, request }, info) => {
    const tag = `[talk-unsend-${info.project.name}]`;
    // A message waits only while it is still with the office: one written to a working desk is already theirs (the desk
    // has it queued), so the wait here is for a desk. The company has one, Lea holds it on a long turn, and Kai waits.
    expect((await api(request, `api/c/${id}/settings`, { maxDesks: 1 })).status).toBe(200);
    try {
      await tell(request, id, 'ux-designer', '[fake:long] Think the whole flow through');
      await until(request, id, (c) => c.people.find((p) => p.id === 'ux-designer')?.desk.state === 'working');
      await openPanel(page, id, 'people/ui-designer');
      await expect(theTo(page)).toHaveAccessibleName('To Kai, UI designer');
      await talk(page, null, `Skip the onboarding for now ${tag}`);
      await hintSays(page, /^Sent\. Kai starts on it now\./);
      await until(request, id, (c) => c.people.find((p) => p.id === 'ui-designer')?.desk.state === 'waiting');
      await talkBar(page).getByRole('button', { name: 'Unsend', exact: true }).click();
      await hintSays(page, /^Unsent\. Your words are back in the box\./);
      await expect(talkBox(page)).toHaveValue(`Skip the onboarding for now ${tag}`);
      await expect(talkBox(page)).toBeFocused();
      // An unsent message leaves the company's messages.
      await expect.poll(async () => (await view(request, id)).messages.filter((m) => m.text.includes(tag)).length).toBe(0);
    } finally {
      await api(request, `api/c/${id}/settings`, { maxDesks: 8 });
      await stopWork(request, id, 'ux-designer');
      await stopWork(request, id, 'ui-designer');
    }
  });

  test('Stop and send stops the person with the words as what to do instead', async ({ page, request }, info) => {
    const tag = `[talk-stop-${info.project.name}]`;
    // Kai is at work on a long turn, so there is something to stop.
    await tell(request, id, 'ui-designer', '[fake:long] Draw every state of the streak card');
    await until(request, id, (c) => c.people.find((p) => p.id === 'ui-designer')?.desk.state === 'working');
    await openPanel(page, id, 'people/ui-designer');
    await sidePanel(page).getByRole('button', { name: /^Stop( Kai)?$/ }).click();
    await expect(talkBox(page)).toHaveAccessibleName('Stop Kai and say what to do instead');
    await talkBox(page).pressSequentially(`Use the darker tokens instead ${tag}`);
    await talkBar(page).getByRole('button', { name: 'Stop and send', exact: true }).click();
    await expect.poll(() => deskTurns(tag).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(theTo(page)).toHaveAccessibleName('To Kai, UI designer');
  });

  test('a /command runs in the office', async ({ page, request }, info) => {
    const title = `Water the cactus ${info.project.name}`;
    const made = await api<{ id: string }>(request, `api/c/${id}/tasks`, { title, brief: 'One glass.', files: [], owner: 'backend-engineer', doneWhen: 'Watered.', milestone: null });
    expect(made.status).toBe(201);
    await openCompany(page, id);
    const box = talkBox(page);
    await box.click();
    await box.pressSequentially(`/pause ${title}`);
    const option = (await talkList(page)).getByRole('option', { name: new RegExp(`^Pause “${title}”`) }).first();
    await expect(option).toBeVisible();
    const wanted = await option.getAttribute('id');
    for (let i = 0; i < 12 && (await box.getAttribute('aria-activedescendant')) !== wanted; i++) await box.press('ArrowDown');
    await box.press('Enter');
    await until(request, id, (c) => c.tasks.find((t) => t.id === made.body.id)?.paused);
    await hintSays(page, /^Paused/);
  });

  test('the strip shows a relay within a second of it happening, and opens the feed at it', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await showStrip(page);
    await openCompany(page, id);
    // The page notes when the strip first shows this relay, so the second is the office's own (from the relay's time on the
    // server to the strip, one machine's clock), not the test runner's round trips, which a busy machine stretches.
    await page.evaluate(`(() => {
      window.__relayShownAt = null;
      const text = () => document.querySelector('button.livestrip')?.textContent ?? '';
      // What the strip says now, so a line already saying it (an earlier relay) doesn't count until the strip changes.
      const before = text();
      const watch = new MutationObserver(() => {
        const now = text();
        if (now !== before && now.includes('Ada to Kai')) {
          window.__relayShownAt = Date.now();
          watch.disconnect();
        }
      });
      watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    })()`);
    // Ada passes it on to Kai with a note, as the fake desk's relay scenario does.
    const root = await tell(request, id, 'head-of-design', `[fake:relay-late] Darker palette for the menu [relay-${info.project.name}]`);
    const relayed = await until(request, id, (c) => c.messages.find((m) => m.relayOf === root), 30_000);
    await expect(strip(page)).toContainText(/Ada to Kai/, { timeout: 5_000 });
    const shownAt = await page.evaluate<number | null>('window.__relayShownAt');
    expect(shownAt).not.toBeNull();
    expect((shownAt ?? 0) - relayed.at).toBeLessThanOrEqual(1_000);
    await shot(page, 'h57-strip-relay', info);
    await strip(page).click();
    await expect(feed(page)).toBeVisible();
    await expect(feed(page)).toContainText(/Ada passed your message on to Kai/);
    expect(errors).toEqual([]);
  });
});

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('the strip and the feed, final gates', () => {
  test("the strip's name holds the words it shows, after what the key does (2.5.3)", async ({ page }) => {
    const errors = watchErrors(page);
    // v0.8: the strip is off by default; this test is about it, so it shows it.
    await showStrip(page);
    await openCompany(page, DEMO);
    await expect(strip(page)).toBeVisible();
    const words = await strip(page).locator('.livestrip__words').last().innerText();
    const flat = words.replace(/\s+/g, ' ').trim();
    expect(flat.length).toBeGreaterThan(0);
    await expect(strip(page)).toHaveAttribute('aria-labelledby', /^\S+ \S+$/);
    await expect(strip(page)).toHaveAccessibleName(new RegExp(`^Open the feed.*${escapeRe(flat)}`));
    expect(errors).toEqual([]);
  });

  test("the feed's head grows with its filters, and Show everything keeps focus in the feed", async ({ page }) => {
    test.skip(layoutOf(page).phone, 'The phone folds the filters behind a key; the 768 px width is the one that wraps them.');
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await openCompany(page, DEMO);
    await feedKey(page).click();
    await expect(feed(page)).toBeVisible();
    const head = feed(page).locator('.feed__head');
    const body = feed(page).locator('.feed__body');
    await feed(page).getByRole('combobox', { name: 'Who' }).selectOption({ index: 2 });
    const [h, b] = [await head.boundingBox(), await body.boundingBox()];
    expect(h && b && h.y + h.height <= b.y + 1).toBe(true);
    // A joined line's hidden header has no unseen stops in the Tab order.
    expect(await feed(page).locator('.feed__line--joined .visually-hidden button').count()).toBe(0);
    await feed(page).getByRole('button', { name: 'Show everything' }).click();
    await expect(feed(page).getByRole('combobox', { name: 'Who' })).toBeFocused();
    expect(errors).toEqual([]);
  });
});

test.describe('before the start', () => {
  test('the To is the CEO, and @ and / say why they wait', async ({ page, request }, info) => {
    const id = await found(request, scratchOf(), nameFor('talk-proposed', info));
    await waitForProposal(request, id);
    await openCompany(page, id);
    await expect(theTo(page).or(talkBar(page).getByText(/^To Noor, CEO/)).first()).toBeVisible();
    await expect(talkBox(page)).toHaveAttribute('placeholder', 'Tell the CEO what to change');
    await talkBox(page).click();
    await talkBox(page).pressSequentially('@');
    await hintSays(page, /Until the start you talk to the CEO\./);
    await talkBox(page).fill('');
    await talkBox(page).pressSequentially('/');
    await hintSays(page, /Commands work once the company starts\. Until then, tell the CEO what you want\./);
  });
});
