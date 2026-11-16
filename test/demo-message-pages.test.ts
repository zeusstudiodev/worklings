// The demo company pages through its made-up first day as the hub pages through what a company keeps: two presses of
// "Show earlier lines" reach the start, in the café's own story and by the org's rules, the same on every load.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CompanyView, mayMessage, MESSAGE_PAGE, type MessagePage, STAKEHOLDER } from '../src/core/company.ts';
import { demoCompanyView } from '../src/core/demo-company.ts';
import { NOT_KEPT } from '../src/core/message-pages.ts';
import { DemoHub } from '../web/src/company/demo.ts';
import { cafeEarlier } from '../web/src/company/demoHistory.ts';

const NOW = Date.UTC(2026, 10, 5, 13, 30);

describe("the demo company's earlier messages", () => {
  let hub: DemoHub;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    hub = new DemoHub(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const view = (company = 'demo'): CompanyView => {
    const v = hub.snapshot(company)?.company;
    if (!v) throw new Error(`${company} is gone`);
    return v;
  };

  /** A page, once the moment the demo takes to answer has passed. */
  async function earlier(company: string, before: string, limit?: number): Promise<MessagePage> {
    const asked = hub.actions(company).earlierMessages(before, limit);
    await vi.advanceTimersByTimeAsync(300);
    return asked;
  }

  it("pages back through the café's first day in two presses: a full page, then the rest and the end", async () => {
    const oldest = view().messages[0];
    if (!oldest) throw new Error('the café has no messages');
    const first = await earlier('demo', oldest.id);
    expect([first.messages.length, first.more]).toEqual([MESSAGE_PAGE.max, true]);
    const second = await earlier('demo', first.messages.at(-1)?.id ?? '');
    expect(second.more).toBe(false);
    expect(second.messages.length).toBeGreaterThan(0);
    expect(second.messages.length).toBeLessThan(MESSAGE_PAGE.max);
    // Newest first, each once, all from before the view's oldest message, and the whole history between them.
    const lines = [...first.messages, ...second.messages];
    expect(lines.map((m) => m.at)).toEqual(lines.map((m) => m.at).sort((a, b) => b - a));
    expect(new Set(lines.map((m) => m.id)).size).toBe(lines.length);
    expect(lines.every((m) => m.at < oldest.at)).toBe(true);
    expect(lines.reverse()).toEqual(cafeEarlier(NOW).messages);
  });

  it('sends the acknowledgements of the messages on each page, by the people they went to', async () => {
    const first = await earlier('demo', view().messages[0]?.id ?? '');
    const second = await earlier('demo', first.messages.at(-1)?.id ?? '');
    for (const page of [first, second]) {
      const onPage = new Map(page.messages.map((m) => [m.id, m]));
      for (const a of page.acks) expect(onPage.get(a.message)?.to).toBe(a.by);
    }
    // Every line of yours on them has the CEO's acknowledgement.
    const yours = [...first.messages, ...second.messages].filter((m) => m.from === STAKEHOLDER);
    expect(yours.length).toBeGreaterThan(0);
    expect([...first.acks, ...second.acks].map((a) => a.message).sort()).toEqual(yours.map((m) => m.id).sort());
  });

  it("carries on from the view's own messages, the ones sent in the demo too", async () => {
    const sent = await hub.actions('demo').say('frontend-engineer', 'One more thing: the buttons could be bigger.');
    const before = view().messages;
    const page = await earlier('demo', sent.id, 3);
    expect(page).toMatchObject({ more: true, messages: before.slice(-4, -1).reverse() });
  });

  it('has nothing before the first message of a company with no made-up past', async () => {
    const first = view('plant-pal').messages[0];
    if (!first) throw new Error('Plant Pal has no messages');
    expect(await earlier('plant-pal', first.id)).toEqual({ messages: [], acks: [], more: false });
  });

  it('refuses what the hub refuses, in its words', async () => {
    const actions = hub.actions('demo');
    await expect(actions.earlierMessages('--help')).rejects.toMatchObject({ status: 400, code: 'bad-input', message: "before isn't an id this office made." });
    for (const limit of [0, MESSAGE_PAGE.max + 1, 2.5]) {
      await expect(actions.earlierMessages('m-1', limit)).rejects.toMatchObject({ status: 400, code: 'bad-input', message: 'limit must be a whole number from 1 to 200.' });
    }
    await expect(actions.earlierMessages('m-9999')).rejects.toMatchObject({ status: 400, code: 'unknown', message: NOT_KEPT });
    await expect(hub.actions('nope').earlierMessages('m-1')).rejects.toMatchObject({ status: 404, code: 'gone' });
  });
});

describe("the café's made-up first day", () => {
  const cafe = demoCompanyView(NOW);
  const { messages, acks } = cafeEarlier(NOW);
  const logged = (text: string): number => {
    const entry = cafe.log.find((e) => e.text === text);
    if (!entry) throw new Error(`the café's log has no "${text}"`);
    return entry.at;
  };
  const kind = (k: string): number => cafe.log.find((e) => e.kind === k)?.at ?? Number.NaN;

  it('is the same for the same moment', () => {
    expect(cafeEarlier(NOW)).toEqual({ messages, acks });
  });

  it("keeps to the café's log: after the start, nothing while it rested, and before the view's oldest message", () => {
    const [rest, wake] = [kind('rest'), kind('wake')];
    for (const m of messages) {
      expect(m.at).toBeGreaterThan(kind('started'));
      expect(m.at > rest && m.at < wake, `${m.id} while the company rested`).toBe(false);
      expect(m.at).toBeLessThan(cafe.messages[0]?.at ?? 0);
    }
  });

  it("has only people who were there: Lena after she was hired, nobody who hadn't started yet", () => {
    const hired = logged('The CEO hired Lena, German copywriter.');
    const lena = messages.filter((m) => m.from === 'german-copywriter' || m.to === 'german-copywriter');
    expect(lena.length).toBeGreaterThan(0);
    expect(lena.every((m) => m.at > hired)).toBe(true);
    // Elif was hired 40 minutes ago, and Yara hasn't had a desk yet.
    for (const late of ['accessibility-specialist', 'security-reviewer']) expect(messages.some((m) => m.from === late || m.to === late)).toBe(false);
  });

  it("follows the org's rules for who may message whom, and passes your words on unchanged", () => {
    for (const m of messages) {
      if (m.from !== STAKEHOLDER) expect(mayMessage(cafe.people, m.from, m.to, true), `${m.from} to ${m.to}`).toBe(true);
    }
    const passed = messages.filter((m) => m.relayOf !== null);
    expect(passed.length).toBeGreaterThan(0);
    for (const m of passed) {
      const original = messages.find((x) => x.id === m.relayOf);
      expect(original && original.at < m.at && original.text === m.text && original.from === m.origin).toBe(true);
    }
  });

  it('has every message delivered, never before it was sent, and each acknowledgement after its message arrived', () => {
    for (const m of messages) expect(m.deliveredAt ?? 0).toBeGreaterThanOrEqual(m.at);
    for (const a of acks) {
      const m = messages.find((x) => x.id === a.message);
      expect(m && m.to === a.by && a.at > (m.deliveredAt ?? Number.POSITIVE_INFINITY)).toBe(true);
    }
  });
});
