// Earlier messages than a view carries, a page at a time (GET /api/c/<id>/messages): the paging the company, the hub's
// fake and the demo share, and the company paging back through everything its state keeps, shown as its view shows them.
import { describe, expect, it } from 'vitest';
import { type Message, MESSAGE_PAGE, OrgRefusal, VIEW_LIMITS } from '../src/core/company.ts';
import { messagesBefore, NOT_KEPT } from '../src/core/message-pages.ts';
import type { Ack } from '../src/core/steering.ts';
import { rig } from './company-kit.ts';

/** The refusal a call throws, so a test can check its code and sentence. */
function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

/** Messages m-1 to m-<n> as a company keeps them, oldest first. */
const kept = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m-${i + 1}`, from: '@stakeholder', to: 'ui-designer', text: `Note ${i + 1}.`, origin: null, relayOf: null, note: null, at: 1_000 + i, deliveredAt: 1_001 + i, interrupt: false,
  }));

const ack = (message: string, at: number): Ack => ({ id: `k-${message}`, message, by: 'ui-designer', agree: true, text: 'On it.', at });
const ids = (messages: readonly { id: string }[]) => messages.map((m) => m.id);

describe('a page of earlier messages', () => {
  it('holds the messages before the one named, newest first, and whether older ones remain', () => {
    const five = kept(5);
    expect(messagesBefore(five, [], 'm-4', 2)).toEqual({ messages: [five[2], five[1]], acks: [], more: true });
    // A page that reaches the first message says nothing older remains, even when it is full.
    expect(messagesBefore(five, [], 'm-3', 2)).toEqual({ messages: [five[1], five[0]], acks: [], more: false });
    expect(messagesBefore(five, [], 'm-1', 2)).toEqual({ messages: [], acks: [], more: false });
  });

  it('carries the acknowledgements of its own messages and no others, oldest first', () => {
    const acks = [ack('m-2', 10), ack('m-5', 11), ack('m-3', 12)];
    expect(messagesBefore(kept(5), acks, 'm-4', 3)?.acks).toEqual([ack('m-2', 10), ack('m-3', 12)]);
  });

  it('gives nothing for a message that is not kept', () => {
    expect(messagesBefore(kept(5), [], 'm-6', 2)).toBeNull();
  });

  it(`holds 1 to ${MESSAGE_PAGE.max} messages`, () => {
    const many = kept(MESSAGE_PAGE.max + 5);
    expect(messagesBefore(many, [], `m-${MESSAGE_PAGE.max + 5}`, MESSAGE_PAGE.max)?.messages).toHaveLength(MESSAGE_PAGE.max);
    for (const limit of [0, MESSAGE_PAGE.max + 1, 1.5, Number.NaN]) expect(() => messagesBefore(many, [], 'm-9', limit)).toThrow(RangeError);
  });
});

describe("a company's earlier messages", () => {
  it('pages back through every message the company keeps, past the 200 its view carries', async () => {
    const { company } = await rig({ running: true });
    const setup = company.view().messages.length;
    for (let i = 1; i <= 450; i += 1) company.say('ui-designer', `Note ${i}.`);
    const view = company.view();
    expect(view.messages).toHaveLength(VIEW_LIMITS.messages);
    const pages = [];
    for (let before = view.messages[0]?.id; before !== undefined; ) {
      const page = company.earlierMessages(before, MESSAGE_PAGE.max);
      pages.push(page);
      before = page.more ? page.messages.at(-1)?.id : undefined;
    }
    expect(pages.map((p) => [p.messages.length, p.more])).toEqual([
      [200, true],
      [setup + 450 - 400, false],
    ]);
    // Read oldest first, the pages and the view hold every note once, in the order it was sent.
    const all = [...pages.flatMap((p) => p.messages).reverse(), ...view.messages];
    expect(new Set(ids(all)).size).toBe(all.length);
    expect(all.filter((m) => m.text.startsWith('Note ')).map((m) => m.text)).toEqual(Array.from({ length: 450 }, (_, i) => `Note ${i + 1}.`));
  });

  it('shows each message and its acknowledgement exactly as the view shows them', async () => {
    const { company } = await rig({ running: true });
    const notes = Array.from({ length: 120 }, (_, i) => company.say('ui-designer', `Note ${i + 1}.`));
    for (const m of notes.filter((_, i) => i % 2 === 0)) company.ack('ui-designer', { message: m.id, agree: true, text: `Taking ${m.text}` });
    const view = company.view();
    const anchor = view.messages[100]?.id ?? '';
    const page = company.earlierMessages(anchor, 50);
    const shown = view.messages.slice(50, 100).reverse();
    expect(page.messages).toEqual(shown);
    const onPage = new Set(ids(shown));
    expect(page.acks.length).toBeGreaterThan(0);
    expect(page.acks).toEqual(view.steering?.acks.filter((a) => onPage.has(a.message)));
  });

  it("refuses a message it doesn't keep, a taken-back one too, in a sentence", async () => {
    const { company } = await rig({ running: true });
    expect(refusal(() => company.earlierMessages('m-99999', MESSAGE_PAGE.max))).toMatchObject({ code: 'unknown', message: NOT_KEPT });
    const unsent = company.say('ui-designer', 'Never mind.');
    company.unsend(unsent.id);
    expect(refusal(() => company.earlierMessages(unsent.id, MESSAGE_PAGE.max))).toMatchObject({ code: 'unknown', message: NOT_KEPT });
  });

  it('has nothing before its first message', async () => {
    const { company } = await rig({ running: true });
    const first = company.view().messages[0]?.id ?? '';
    expect(company.earlierMessages(first, MESSAGE_PAGE.max)).toEqual({ messages: [], acks: [], more: false });
  });
});
