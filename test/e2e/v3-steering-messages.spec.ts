import { expect, type Page, test } from '@playwright/test';
import { THE_OFFICE } from '../../src/core/company.ts';
import { deskTurns, feed, feedKey, type Mention, openCompany, openPanel, panelTitle, running, shot, sidePanel, talk, talkBox, tell, until, watchErrors } from './v3-kit.ts';
import { api } from './v3-world.ts';

// H40 (AC17) and H41 (AC18): a message to a room, a team and everyone, sent from the talk bar with `@`, how each
// recipient's turn names the audience, the all-hands in the 3D view (and the cut with reduced motion), and the trace of
// a message with its flags, Remind and Escalate. Flags are worked out in the page from the clock, so the clock is moved
// past the wait instead of waiting.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `steering-messages-${info.project.name}`);
  await request.dispose();
});

/** Records every label the scene ever walked, from before the page loads (page code as a string). */
const record = (page: Page) =>
  page.addInitScript(`(() => {
    window.__walked = new Set();
    const scan = () => {
      for (const l of document.querySelectorAll('.labels .label[data-walking="true"]')) window.__walked.add(l.textContent.trim());
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  })()`);
const walked = async (page: Page): Promise<string[]> => (await page.evaluate('[...window.__walked]')) as string[];

/**
 * Sends from the talk bar to whoever `to` picks with a leading `@`, and waits for the feed to show the line. The strip
 * shows only the newest lines, which replies push off at once when several people answer, so the feed is where a line
 * stays; a phone's strip gives way to the hint while the box has focus, so the box lets go first.
 */
async function sendTo(page: Page, to: Mention, text: string, line: RegExp) {
  await openCompany(page, id);
  await talk(page, to, text);
  await expect(talkBox(page)).toHaveAccessibleDescription(/^Sent\./);
  // v0.8: Feed is in the talk bar on phones too.
  await feedKey(page).click();
  await expect(feed(page)).toContainText(line);
}

const ROOM: Mention = { type: 'des', pick: /design room/i };
const TEAM: Mention = { type: 'Ada', pick: /^Ada's team/ };
const ALL: Mention = { type: 'all', pick: /^(All hands|Everyone)/ };

test.describe('a message to more than one person (H40)', () => {
  test('to the design room: each of its three gets their own copy, and their turn names the room', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await sendTo(page, ROOM, `Menu pages come first this week [room-note-${info.project.name}]`, /You (wrote )?to the design room/);
    const copies = await until(request, id, (c) => {
      const m = c.messages.filter((x) => x.text.includes(`[room-note-${info.project.name}]`) && x.audience);
      return m.length === 3 && m.every((x) => x.deliveredAt !== null) && m;
    });
    expect(copies.map((m) => m.to).sort()).toEqual(['head-of-design', 'ui-designer', 'ux-designer']);
    expect(new Set(copies.map((m) => m.audience?.group)).size).toBe(1);
    expect(copies.every((m) => m.audience?.kind === 'room' && m.audience.title === 'the design room')).toBe(true);
    // The user turns the desks were handed name the audience and the message's own id.
    const turns = deskTurns(`[room-note-${info.project.name}]`);
    expect(turns.length).toBeGreaterThanOrEqual(3);
    for (const t of turns) expect(t.turn).toMatch(/^From \w+, the stakeholder, to the design room \(message m-\d+\)/);
    // Busy people take it at their next step, idle ones as a new turn: every copy says which.
    expect(copies.every((m) => m.deliveredHow === 'new-turn' || m.deliveredHow === 'next-step')).toBe(true);
    expect(copies.every((m) => m.typed === true)).toBe(true);
    await shot(page, 'h40-room', info);
    expect(errors).toEqual([]);
  });

  test("to Ada's team: her three reach her and her two, not the other room", async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await sendTo(page, TEAM, `Team lunch moves to Thursday [team-note-${info.project.name}]`, /You (wrote )?to Ada's team/);
    const copies = await until(request, id, (c) => {
      const m = c.messages.filter((x) => x.text.includes(`[team-note-${info.project.name}]`) && x.audience);
      return m.length === 3 && m.every((x) => x.deliveredAt !== null) && m;
    });
    expect(copies.every((m) => m.audience?.kind === 'team' && m.audience.title === "Ada's team")).toBe(true);
    expect(copies.map((m) => m.to).sort()).toEqual(['head-of-design', 'ui-designer', 'ux-designer']);
    for (const t of deskTurns(`[team-note-${info.project.name}]`)) expect(t.turn).toMatch(/to Ada's team \(message m-\d+\)/);
    await shot(page, 'h40-team', info);
    expect(errors).toEqual([]);
  });

  test('to everyone: eight copies and an all-hands in the 3D view, with a cut when motion is reduced', async ({ page, browser, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const size = page.viewportSize() ?? { width: 1440, height: 900 };
    const calm = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
    const still = await calm.newPage();
    await Promise.all([record(page), record(still)]);
    await Promise.all([openCompany(page, id), openCompany(still, id)]);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(still.locator('canvas')).toBeVisible();
    // The crowd speaks with one voice: its bubble says what you sent, in the meeting room where everyone gathers. A phone's
    // strip draws labels only for the selected person, so the bubble is asserted on the desktop. With reduced motion it is a
    // cut: the same gathering with nobody walking. The gathering lasts a few seconds, and the sender spends longer than that
    // typing and opening its feed, so both pages are watched from before the send: the bubble can only be the sent words.
    const crowd = (p: Page) => p.locator('.labels .bubble', { hasText: 'From you' }).first();
    const desktop = info.project.name === 'v3';
    const watch = async (p: Page, name: string) => {
      await expect(crowd(p)).toBeVisible({ timeout: 60_000 });
      await shot(p, name, info); // taken as the gathering shows
    };
    const seen = desktop ? Promise.all([watch(page, 'h40-all-hands'), watch(still, 'h40-all-hands-reduced-motion')]) : Promise.resolve();
    // A watch that fails while the send is still going is reported where it is awaited, not as an unhandled rejection.
    seen.catch(() => {});
    // Sent from a third page, so both watching pages see the gathering as it begins.
    const sender = await browser.newPage({ viewport: size });
    await sendTo(sender, ALL, `Everyone: demo at five on Friday [all-hands-${info.project.name}]`, /You (wrote )?to (everyone|all hands)/);
    await sender.close();
    const copies = await until(request, id, (c) => {
      const m = c.messages.filter((x) => x.text.includes(`[all-hands-${info.project.name}]`) && x.audience);
      return m.length === 8 && m;
    });
    expect(copies.every((m) => m.audience?.kind === 'everyone')).toBe(true);
    await seen;
    if (!desktop) await Promise.all([shot(page, 'h40-all-hands', info), shot(still, 'h40-all-hands-reduced-motion', info)]);
    expect(await walked(still)).toEqual([]);
    await until(request, id, (c) => c.messages.filter((x) => x.text.includes(`[all-hands-${info.project.name}]`)).every((x) => x.deliveredAt !== null));
    await calm.close();
    expect(errors).toEqual([]);
  });
});

test.describe('where a message went (H41)', () => {
  test('a person acknowledges it, and the trace says what they will do', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const message = await tell(request, id, 'ux-designer', '[fake:ack] Please sketch the plant screen first');
    await until(request, id, (c) => (c.steering?.acks ?? []).some((a) => a.message === message));
    await openPanel(page, id, `messages/${message}`);
    await expect(panelTitle(page)).toHaveText('Where your message went');
    await expect(sidePanel(page).getByText('I will start on it now.')).toBeVisible();
    await shot(page, 'h41-trace-ack', info);
    expect(errors).toEqual([]);
  });

  test('a message for Kai that Ada never passed on is flagged, and Remind and Escalate reach the people who hold it', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const sent = await api<{ ids: string[] }>(request, `api/c/${id}/send`, { to: { kind: 'person', id: 'head-of-design' }, text: `Make the palette darker [flag-note-${info.project.name}]`, for: ['ui-designer'] });
    expect(sent.status).toBe(202);
    const root = sent.body.ids[0] ?? '';
    await until(request, id, (c) => c.messages.find((m) => m.id === root)?.deliveredAt);
    // Page time moves past the wait for a flag, as if the message had been stuck that long.
    await page.clock.install();
    await openPanel(page, id, `messages/${root}`);
    await expect(page.getByText('Not reached yet.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Where it stalls' })).toHaveCount(0);
    await shot(page, 'h41-trace-on-its-way', info);
    await page.clock.fastForward('12:00');
    await expect(page.getByRole('heading', { name: 'Where it stalls' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Not passed on to Kai yet.')).toBeVisible();
    await shot(page, 'h41-trace-flag', info);

    await page.getByRole('button', { name: 'Remind Ada', exact: true }).click();
    await expect(page.locator('.trace-flag__note', { hasText: 'Reminded Ada.' })).toBeVisible();
    await until(request, id, (c) => c.messages.some((m) => m.to === 'head-of-design' && m.from === THE_OFFICE && /reminder/i.test(m.text)));

    await page.getByRole('button', { name: /^Escalate to / }).click();
    await expect(page.locator('.trace-flag__note', { hasText: /^Escalated to / })).toBeVisible();
    await until(request, id, (c) => c.messages.some((m) => /escalated this to you/.test(m.text)));
    await shot(page, 'h41-trace-remind-escalate', info);
    expect(errors).toEqual([]);
  });
});
