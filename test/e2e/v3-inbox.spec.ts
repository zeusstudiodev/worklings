import { expect, test } from '@playwright/test';
import { companyAddress, expectAddress, open, openCompany, person, running, shot, sheetUp, watchErrors, inboxCard, moreKey } from './v3-kit.ts';
import { HUB, say, TOKEN, view } from './v3-world.ts';

test.describe.configure({ mode: 'serial' });

/** When the company's stream first carries a push ask, as a client that does nothing else receives it: the hub's own part. */
function watchStream(id: string) {
  const controller = new AbortController();
  const at = (async (): Promise<number> => {
    const res = await fetch(`${HUB}/events/c/${id}?token=${TOKEN}`, { signal: controller.signal });
    const reader = res.body?.getReader();
    if (!reader) throw new Error('The stream has no body.');
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('The stream ended before the ask came.');
      text += decoder.decode(value, { stream: true });
      if (/"kind":"push"/.test(text)) return Date.now();
    }
  })();
  at.catch(() => undefined);
  return { at, close: () => controller.abort() };
}

let id = '';
test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext();
  id = await running(request, `inbox-${info.project.name}`);
  await request.dispose();
});

test.describe('the inbox', () => {
  test('a git push waits in the inbox within a second, the top bar counts it, and Allow once lets the person carry on', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    // When the office's stream first carries the ask, as the page's own EventSource receives it: it splits the time into
    // the hub's part (the ask to the stream) and the page's (the stream to the top bar).
    await page.addInitScript(`(() => {
      window.__streamAt = 0;
      const add = EventSource.prototype.addEventListener;
      EventSource.prototype.addEventListener = function (type, listener, options) {
        if (type === 'snapshot') add.call(this, type, (event) => { if (!window.__streamAt && /"kind":"push"/.test(event.data)) window.__streamAt = Date.now(); }, options);
        return add.call(this, type, listener, options);
      };
    })()`);
    await open(page, `/c/${id}`);
    await expect(moreKey(page)).toBeVisible({ timeout: 30_000 });
    // v0.8: what needs you shows on the card over the talk bar. Record when it first names Ivo. (Page code as a string: the
    // tests' TypeScript has no DOM types.)
    await page.evaluate(`(() => {
      window.__needsAt = 0;
      const check = () => {
        if (window.__needsAt) return;
        if ((document.querySelector('[data-inbox-card]')?.textContent ?? '').includes('Ivo')) window.__needsAt = Date.now();
      };
      new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    })()`);

    const stream = watchStream(id);
    await say(request, id, 'backend-engineer', '[fake:push] Push the work branch');
    let askedAt = 0;
    await expect
      .poll(async () => {
        askedAt = (await view(request, id)).approvals.find((a) => a.person === 'backend-engineer' && a.answer === null)?.askedAt ?? 0;
        return askedAt;
      }, { timeout: 60_000, intervals: [25] })
      .toBeGreaterThan(0);
    const bar = inboxCard(page).filter({ hasText: 'Ivo' });
    await expect(bar).toBeVisible({ timeout: 5_000 });
    const needsAt = Number(await page.evaluate('window.__needsAt'));
    expect(needsAt).toBeGreaterThan(0);
    const hubAt = await stream.at;
    stream.close();
    const pageAt = Number(await page.evaluate('window.__streamAt'));
    const said = `ask to a plain client ${hubAt - askedAt} ms, to the page's stream ${pageAt - askedAt} ms, then to its top bar ${needsAt - pageAt} ms`;
    info.annotations.push({ type: 'latency', description: said });
    // The hub's own promise: the ask is on the stream within a second. The page's part is checked too, but a headless
    // browser drawing the 3D office in software can hold its main thread for a second or more, so only the hub is held to 1 s.
    expect(hubAt - askedAt, said).toBeLessThan(1_000);
    expect(needsAt - askedAt, said).toBeLessThan(5_000);

    // The whole inbox, from the card's See all, where the answer's line stays once it applies.
    await bar.getByRole('button', { name: 'See all', exact: true }).click();
    const needs = page.getByRole('region', { name: 'Needs you' });
    await expect(needs).toContainText('Ivo, backend engineer, wants your OK', { timeout: 15_000 });
    await expect(needs).toContainText('Push HEAD to origin');
    await needs.getByText('Show the command').click();
    await expect(needs).toContainText('git push origin HEAD');
    await shot(page, 'inbox-approval', info);

    await needs.getByRole('button', { name: 'Allow once' }).click();
    await expect(needs).toContainText(/Allowing Ivo once./);
    // The answer applies after the undo window; then the person's hook hears it and the turn goes on.
    await expect(needs).toContainText('Allowed once at', { timeout: 30_000 });
    await expect(needs).toContainText('Ivo carries on.');
    await expect.poll(() => page.title(), { message: 'the title counts nothing waiting' }).not.toMatch(/^\(/);
    await expect.poll(async () => person(await view(request, id), 'backend-engineer').desk.state, { timeout: 60_000 }).toBe('idle');
    const company = await view(request, id);
    expect(company.approvals.find((a) => a.person === 'backend-engineer')?.answer).toMatchObject({ decision: 'allow', always: false });
    expect(company.spend.samples.some((s) => s.person === 'backend-engineer')).toBe(true);
    await shot(page, 'inbox-allowed', info);
    expect(errors).toEqual([]);
  });

  test('a question from the CEO is answered with one of its choices', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await say(request, id, 'ceo', '[fake:ask] Ask me about payments');
    await expect.poll(async () => (await view(request, id)).questions.some((q) => q.from === 'ceo' && q.answer === null), { timeout: 60_000 }).toBe(true);
    // The inbox is the side panel's home, so the company's own address shows it: beside the office on desktops, and as
    // the sheet a phone brings up from its peek.
    await openCompany(page, id);
    await expectAddress(page, companyAddress(id));
    await sheetUp(page);
    const needs = page.getByRole('region', { name: 'Needs you' });
    await expect(needs).toContainText('The CEO asks you.', { timeout: 60_000 });
    await expect(needs).toContainText('Which payment should the app take?');
    const choices = needs.getByRole('group', { name: "Answers to the CEO's question" });
    await expect(choices.getByRole('button', { name: /^TWINT/ })).toContainText('Their pick');
    await shot(page, 'inbox-question', info);

    await choices.getByRole('button', { name: /^Card/ }).click();
    await expect(needs).toContainText('Answering the CEO: Card.');
    await expect(needs).toContainText('Answered at', { timeout: 30_000 });
    await expect(needs).toContainText('Card. The CEO carries on.');
    const question = (await view(request, id)).questions.find((q) => q.from === 'ceo');
    expect(question?.answer).toMatchObject({ option: 1 });
    expect(question?.options).toEqual(['TWINT', 'Card']);
    expect(errors).toEqual([]);
  });
});
