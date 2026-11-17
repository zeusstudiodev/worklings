import { expect, type Locator, type Page, test } from '@playwright/test';
import { feed, feedKey, layoutOf, nameFor, openCompany, person, onElements, running, shot, sidePanel, talkBox, theTo, tell, until, watchErrors } from './v3-kit.ts';
import { view } from './v3-world.ts';

// H58 (AC34), the feed (docs/design-v3.md, "The feed"): one conversation with everything said, in order, as people would
// report it. A company of the e2e hub, where only Claude Code is faked, so every line is made the way a real one is: a
// message through the hub, a desk answering, a relay, a question, an approval. The keyboard and layout details of
// opening the feed are v3-talk.spec.ts's; this file is what the feed holds and what it lets you do with it.
test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, nameFor('feed', info));
  await request.dispose();
});

/** What opens the feed: Feed, in the talk bar at every size since v0.8. */
const opener = (page: Page): Locator => feedKey(page);

async function openFeed(page: Page): Promise<Locator> {
  await openCompany(page, id);
  await opener(page).click();
  await expect(feed(page)).toBeVisible();
  return feed(page);
}

/** The lines on the page, top to bottom, as the words a person reads. */
const linesOf = (list: Locator): Promise<string[]> => list.getByRole('article').allInnerTexts();

/** The feed's filters: on a phone they sit behind the Filter key. */
async function chooseFilter(page: Page, which: 'Who' | 'Kind', value: string): Promise<void> {
  const key = feed(page).getByRole('button', { name: 'Filter', exact: true });
  if ((await key.isVisible()) && (await key.getAttribute('aria-expanded')) !== 'true') await key.click();
  await feed(page).getByRole('combobox', { name: which, exact: true }).selectOption(value);
}

const nobodyUnread = (list: Locator): Locator => list.getByText('New.', { exact: true });

test.describe('the feed', () => {
  test('a relay chain appears in order as it happens, and the feed follows the foot', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const list = await openFeed(page);
    // Nothing yet but the company's own start: the chain is not there before it happens.
    await expect(list.getByText(/passed your message on to/)).toHaveCount(0);
    const tag = `[chain-${info.project.name}]`;
    // Ada passes it on to Kai with a note, then answers a few seconds later, as the fake desk's relay-late scenario does.
    await tell(request, id, 'head-of-design', `[fake:relay-late] Darker palette for the menu ${tag}`);

    const wrote = list.getByRole('article').filter({ hasText: /You wrote to Ada/ }).filter({ hasText: tag });
    const passed = list.getByRole('article').filter({ hasText: /Ada passed your message on to Kai/ });
    const replied = list.getByRole('article').filter({ hasText: /Ada replied/ }).filter({ hasText: 'Passed it on to Kai.' });
    await expect(wrote).toBeVisible({ timeout: 15_000 });
    await expect(passed).toBeVisible({ timeout: 30_000 });
    // The relay shows before the answer that follows it three seconds later: at that moment the answer is not there yet.
    await expect(replied).toHaveCount(0);
    await expect(replied).toBeVisible({ timeout: 30_000 });

    const texts = await linesOf(list);
    const at = (re: RegExp) => texts.findIndex((t) => re.test(t));
    const [a, b, c] = [at(new RegExp(`You wrote to Ada[\\s\\S]*${tag.replace(/[[\]]/g, '\\$&')}`)), at(/Ada passed your message on to Kai/), at(/Ada replied[\s\S]*Passed it on to Kai\./)];
    expect([a, b, c], `the chain in order in: ${texts.join(' | ')}`).toEqual([a, b, c].toSorted((x, y) => x - y));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(new Set([a, b, c]).size).toBe(3);
    // The relay hangs on the message it follows from, with the note it carried, and links to where it went.
    await expect(passed).toContainText('Menu pages first.');
    await expect(passed.getByRole('button', { name: 'Where it went', exact: true }).or(list.getByRole('article').filter({ hasText: tag }).getByRole('button', { name: 'Where it went', exact: true })).first()).toBeVisible();
    // Opened at the foot, the newest line stays in view as the lines come in.
    await expect(replied).toBeInViewport();
    await shot(page, 'h58-chain', info);
    expect(errors).toEqual([]);
  });

  test('a question and an approval are answered in the feed, each with its Undo window', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tell(request, id, 'ceo', '[fake:ask] Ask me about payments');
    await tell(request, id, 'backend-engineer', '[fake:push] Push the work branch');
    await until(request, id, (c) => c.questions.some((q) => q.from === 'ceo' && q.answer === null) && c.approvals.some((a) => a.person === 'backend-engineer' && a.answer === null), 60_000);
    const list = await openFeed(page);

    // The line is found by its sentence, which stays when the card inside it changes from the question to its answer.
    const question = list.getByRole('article').filter({ hasText: /CEO.* asks you/ });
    await expect(question).toBeVisible({ timeout: 15_000 });
    await expect(question).toContainText('Which payment should the app take?');
    const choices = question.getByRole('group', { name: "Answers to the CEO's question" });
    await expect(choices).toBeVisible();
    await shot(page, 'h58-needs-you', info);
    await choices.getByRole('button', { name: /^Card/ }).click();
    await expect(question).toContainText('Answering the CEO: Card.');
    // The answer waits out its undo window, with Undo in the line, and then stands as a sentence of its own.
    await expect(question.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect(question).toContainText(/You answered Card at /, { timeout: 30_000 });
    expect((await view(request, id)).questions.find((q) => q.from === 'ceo')?.answer).toMatchObject({ option: 1 });

    const approval = list.getByRole('article').filter({ hasText: 'wants your OK' }).filter({ hasText: 'Ivo' });
    await expect(approval).toBeVisible();
    await approval.getByRole('button', { name: 'Allow once' }).click();
    await expect(approval).toContainText(/Allowing Ivo once\./);
    await expect(approval.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect(approval).toContainText(/You allowed it once at /, { timeout: 30_000 });
    await expect.poll(async () => person(await view(request, id), 'backend-engineer').desk.state, { timeout: 60_000 }).toBe('idle');
    expect((await view(request, id)).approvals.find((a) => a.person === 'backend-engineer')?.answer).toMatchObject({ decision: 'allow', always: false });
    await shot(page, 'h58-answered', info);
    expect(errors).toEqual([]);
  });

  test('an unread reply keeps its dot until it has been on screen, and the New rule moves on after a close', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    // The office's "seen" is held in the page while the dot is looked at, so how long the machine takes to draw the feed
    // never decides whether the dot is still there: the request is what the feed does once a reply has been on screen.
    const asked: string[] = [];
    let release: () => void = () => undefined;
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    await page.route(`**/api/c/${id}/seen`, async (route) => {
      asked.push((JSON.parse(route.request().postData() ?? '{}') as { person?: string }).person ?? '');
      await gate;
      await route.continue();
    });
    await openCompany(page, id);
    const before = Date.now();
    await tell(request, id, 'frontend-engineer', '[fake:default] Anything on the menu page?');
    await until(request, id, (c) => c.messages.some((m) => m.from === 'frontend-engineer' && m.to === '@stakeholder' && m.at >= before), 30_000);
    await opener(page).click();
    const list = feed(page);
    await expect(list).toBeVisible();
    const sam = list.getByRole('article').filter({ hasText: /Sam replied/ }).last();
    await expect(sam).toBeVisible();
    // The dot says it in words too ("New."): the reply is unread until it has been seen.
    await expect(nobodyUnread(sam)).toHaveCount(1);
    await shot(page, 'h58-unread', info);
    // The feed opens at the first new line, so a reply further down can be out of view: then nothing marks it however long
    // the feed stays open. The dwell is the point (a second on screen counts), so this waits it out once, deliberately.
    const onScreen = await expect(sam).toBeInViewport({ ratio: 0.6, timeout: 500 }).then(() => true, () => false);
    if (!onScreen) {
      await page.waitForTimeout(1_500);
      expect(asked, 'nothing is marked seen while the reply is out of view').not.toContain('frontend-engineer');
      await expect(nobodyUnread(sam)).toHaveCount(1);
    }
    await sam.scrollIntoViewIfNeeded();
    await expect.poll(() => asked, { message: 'a reply on screen for a second marks the conversation seen', timeout: 15_000 }).toContain('frontend-engineer');
    await expect(nobodyUnread(sam)).toHaveCount(1);
    release();
    await expect(nobodyUnread(sam)).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await view(request, id)).seen['frontend-engineer'] ?? 0, { timeout: 15_000 }).toBeGreaterThan(before);

    // Close it; a reply that comes while it is closed sits under the New rule the next time, and the key leads to it.
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    const later = Date.now();
    await tell(request, id, 'ux-designer', '[fake:default] Anything on the flow?');
    await until(request, id, (c) => c.messages.some((m) => m.from === 'ux-designer' && m.to === '@stakeholder' && m.at >= later), 30_000);
    hold();
    await opener(page).click();
    await expect(list).toBeVisible();
    const rule = list.getByText('New lines start here');
    await expect(rule).toBeAttached();
    const lea = list.getByRole('article').filter({ hasText: /Lea replied/ }).last();
    await expect(nobodyUnread(lea)).toHaveCount(1);
    // The rule sits above Lea's reply and above nothing Sam said before the close.
    const texts = await list.locator('.feed__new, article').evaluateAll(onElements<string[]>(`return els.map((el) => (el.className.includes('feed__new') ? 'RULE' : el.innerText));`));
    const ruleAt = texts.indexOf('RULE');
    expect(ruleAt).toBeGreaterThan(0);
    expect(texts.findIndex((t) => /Lea replied/.test(t))).toBeGreaterThan(ruleAt);
    expect(texts.findIndex((t) => /Sam replied/.test(t))).toBeLessThan(ruleAt);
    // The jump key shows only while it has focus (a keyboard way, right after the heading): focus it and press it.
    const jump = list.getByRole('button', { name: 'Jump to the new lines', exact: true });
    await jump.focus();
    await page.keyboard.press('Enter');
    await expect(list.locator('.feed__new')).toBeFocused();
    await shot(page, 'h58-new-rule', info);
    release();
    await expect(nobodyUnread(lea)).toHaveCount(0, { timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test('Who and Kind filter the lines, say what they show, keep to the tab and clear with Show everything', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await tell(request, id, 'ui-designer', '[fake:decide] Flame or leaf for the streak card?');
    await until(request, id, (c) => (c.steering?.decisions.length ?? 0) > 0, 30_000);
    const list = await openFeed(page);
    const lines = (re: RegExp) => list.getByRole('article').filter({ hasText: re });
    const status = list.getByRole('status');

    // A person: the lines they speak in or are spoken to in; the others go.
    await chooseFilter(page, 'Who', 'person:ui-designer');
    await expect(status).toHaveText('Showing lines with Kai.');
    await expect(lines(/Ada passed your message on to Kai/)).toBeVisible();
    await expect(lines(/Sam replied/)).toHaveCount(0);
    await expect(lines(/Lea replied/)).toHaveCount(0);
    await shot(page, 'h58-filter-person', info);

    // A room: anyone in it, speaking or spoken to.
    await chooseFilter(page, 'Who', 'room:engineering');
    await expect(status).toHaveText('Showing lines with the engineering room.');
    await expect(lines(/Sam replied/)).toBeVisible();
    await expect(lines(/Ivo.* wants your OK/)).toBeVisible();
    await expect(lines(/Ada passed your message on to Kai/)).toHaveCount(0);
    await expect(lines(/Lea replied/)).toHaveCount(0);

    // A kind, for everyone.
    await chooseFilter(page, 'Who', 'all');
    await chooseFilter(page, 'Kind', 'needs');
    await expect(status).toHaveText('Showing needs you.');
    await expect(lines(/Which payment should the app take\?/)).toBeVisible();
    await expect(lines(/wants your OK/)).toBeVisible();
    await expect(lines(/Sam replied/)).toHaveCount(0);
    await chooseFilter(page, 'Kind', 'passed');
    await expect(status).toHaveText('Showing passed on.');
    await expect(lines(/Ada passed your message on to Kai/)).toBeVisible();
    await expect(lines(/wants your OK/)).toHaveCount(0);
    await chooseFilter(page, 'Kind', 'decisions');
    await expect(lines(/Kai decided/)).toBeVisible();
    await expect(lines(/Ada passed your message on to Kai/)).toHaveCount(0);
    await chooseFilter(page, 'Kind', 'yours');
    await expect(lines(/Sam replied/)).toBeVisible();
    await expect(lines(/You wrote to Ada/)).toBeVisible();
    await expect(lines(/wants your OK/)).toHaveCount(0);

    // Both together, with nothing to show: a sentence, not a blank feed.
    await chooseFilter(page, 'Who', 'person:qa-engineer');
    await chooseFilter(page, 'Kind', 'needs');
    await expect(status).toHaveText('Nothing in needs you with Tom yet.');
    await expect(list.getByRole('article')).toHaveCount(0);
    await shot(page, 'h58-filter-nothing', info);

    // The choice stays with the tab: close the feed and open it again.
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await opener(page).click();
    await expect(feed(page).getByRole('status')).toHaveText('Nothing in needs you with Tom yet.');
    await feed(page).getByRole('button', { name: 'Show everything', exact: true }).click();
    await expect(feed(page).getByRole('button', { name: 'Show everything', exact: true })).toHaveCount(0);
    await expect(feed(page).getByText('Nothing in needs you with Tom yet.')).toHaveCount(0);
    await expect(lines(/Ada passed your message on to Kai/)).toBeVisible();
    await expect(lines(/Sam replied/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a person's thread opens beside the feed from their name, and Reply talks to them", async ({ page }, info) => {
    const errors = watchErrors(page);
    const list = await openFeed(page);
    const ada = list.getByRole('article').filter({ hasText: /Ada replied/ }).last();
    await ada.getByRole('button', { name: 'Ada', exact: true }).click();
    const panel = sidePanel(page);
    await expect(panel.getByRole('region', { name: 'Conversation with Ada' })).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Conversation with Ada' })).toContainText('Darker palette for the menu');
    if (!layoutOf(page).phone) {
      // Beside it, not over it: the feed stays open and the two do not overlap.
      await expect(list).toBeVisible();
      const [f, p] = [await list.boundingBox(), await panel.boundingBox()];
      expect(f && p && f.x + f.width <= p.x + 1, `the feed ${JSON.stringify(f)} lies beside the panel ${JSON.stringify(p)}`).toBe(true);
      await expect(page).toHaveURL(/panel=people(%2F|\/)head-of-design/);
    }
    await shot(page, 'h58-thread', info);

    if (!layoutOf(page).phone) {
      // Reply makes them the To and puts focus in the box.
      await list.getByRole('article').filter({ hasText: /Kai/ }).filter({ hasText: /passed your message on/ }).getByRole('button', { name: /^Kai\b/ }).first().click();
      await expect(panel.getByRole('region', { name: 'Conversation with Kai' })).toBeVisible();
      const reply = list.getByRole('article').filter({ hasText: /Lea replied/ }).last().getByRole('button', { name: 'Reply', exact: true });
      await reply.click();
      await expect(theTo(page)).toHaveAccessibleName(/^To Lea, UX designer/);
      await expect(talkBox(page)).toBeFocused();
    }
    expect(errors).toEqual([]);
  });
});

