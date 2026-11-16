import { describe, expect, it } from 'vitest';
import { ackFor, citesOf, linesOf } from '../src/company/audience.ts';
import { type Message, STAKEHOLDER } from '../src/core/company.ts';
import type { Ack } from '../src/core/steering.ts';
import { ackIdFor, acksInView, foldTrace, reviveAcks, TRACE_LIMITS, withAck, withDelivery } from '../src/core/trace-state.ts';
import { AT, bigCompany, min, Office, refusal } from './steering-messages-kit.ts';

/** The stakeholder's message to the design room, delivered: Ada has m-1, Kai m-2 and Lea m-3. */
function designRoom(): Office {
  const office = new Office();
  const copies = office.send(STAKEHOLDER, { kind: 'room', id: 'design' }, 'Make the palette darker.');
  office.later(min(1)).deliver(copies.map((m) => m.id), 'next-step');
  return office;
}

const ack = (message: string, by: string, text: string, at = AT, agree = true): Ack => ({ id: ackIdFor(message), message, by, agree, text, at });

/** Freezes a value and everything in it, so a fold that changes its input throws. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('an acknowledgement', () => {
  it("is of the person's own copy: whether they agree, and one sentence on what they will do", () => {
    const office = designRoom();
    expect(office.ack('ui-designer', 'm-2', 'Trying espresso brown at 4.5:1.')).toEqual({
      id: 'k-2',
      message: 'm-2',
      by: 'ui-designer',
      agree: true,
      text: 'Trying espresso brown at 4.5:1.',
      at: AT + min(1),
    });
  });

  it('says so when they disagree, and why', () => {
    const office = designRoom();
    expect(office.ack('head-of-design', 'm-1', 'Darker fails contrast on the buttons.', false)).toMatchObject({ message: 'm-1', agree: false });
  });

  it('replaces the first when they acknowledge the same message again', () => {
    const office = designRoom();
    office.ack('ui-designer', 'm-2', 'On it.');
    office.ack('ux-designer', 'm-3', 'Checking the checkout.');
    office.later(min(3)).ack('ui-designer', 'm-2', 'Espresso brown fails on the buttons; trying charcoal.', false);
    expect(office.acks.map((a) => [a.id, a.by, a.agree, a.text, a.at])).toEqual([
      ['k-3', 'ux-designer', true, 'Checking the checkout.', AT + min(1)],
      ['k-2', 'ui-designer', false, 'Espresso brown fails on the buttons; trying charcoal.', AT + min(4)],
    ]);
  });

  it('is kept to one line of at most 300 characters', () => {
    const office = designRoom();
    const a = office.ack('ui-designer', 'm-2', `Darker it is.\n\n${'Really '.repeat(80)}`);
    expect(a.text).not.toContain('\n');
    expect(a.text).toHaveLength(TRACE_LIMITS.ackText);
    expect(a.text.startsWith('Darker it is. Really')).toBe(true);
    expect(a.text.endsWith('…')).toBe(true);
  });

  it("takes a copy the switchboard hasn't reported as delivered yet: the person can only know its id from their turn", () => {
    const office = new Office();
    const [m] = office.send(STAKEHOLDER, { kind: 'person', id: 'ui-designer' }, 'Use teal.');
    expect(m && office.ack('ui-designer', m.id, 'Switching to teal.').message).toBe(m?.id);
  });

  it("is refused for someone else's copy, naming the person's own", () => {
    const office = designRoom();
    expect(refusal(() => office.ack('ui-designer', 'm-1', 'On it.'))).toMatchObject({
      code: 'not-allowed',
      message: "Message m-1 went to Ada; Kai's own copy is message m-2, so acknowledge that one.",
    });
    const [toSam] = office.send(STAKEHOLDER, { kind: 'person', id: 'frontend-engineer' }, 'Bigger slots.');
    expect(refusal(() => office.ack('ui-designer', toSam?.id ?? '', 'On it.'))).toMatchObject({
      code: 'not-allowed',
      message: 'Message m-4 went to Sam, and Kai can acknowledge only messages sent to them.',
    });
    // A message someone sent is theirs to have sent, not to acknowledge.
    const [reply] = office.send('ui-designer', { kind: 'person', id: 'head-of-design' }, 'Done.');
    expect(refusal(() => office.ack('ui-designer', reply?.id ?? '', 'Sent.')).code).toBe('not-allowed');
  });

  it("is refused for a message the company doesn't have, or without one", () => {
    const office = designRoom();
    expect(refusal(() => office.ack('ui-designer', 'm-99', 'On it.'))).toMatchObject({ code: 'unknown', message: "There's no message m-99." });
    expect(refusal(() => ackFor(office.org, office.messages, 'ui-designer', { message: '  ', agree: true, text: 'On it.' }, AT)).code).toBe('invalid');
    expect(refusal(() => ackFor(office.org, office.messages, 'ui-designer', { message: 12, agree: true, text: 'On it.' }, AT)).code).toBe('invalid');
  });

  it('is refused from the stakeholder and from anyone outside the company', () => {
    const office = designRoom();
    expect(refusal(() => office.ack(STAKEHOLDER, 'm-2', 'Seen.')).code).toBe('not-allowed');
    expect(refusal(() => office.ack('seo-specialist', 'm-2', 'Seen.'))).toMatchObject({ code: 'unknown', message: 'There\'s nobody called "seo-specialist" in the company.' });
  });

  it('is refused without a yes or no, or without its sentence', () => {
    const office = designRoom();
    for (const agree of ['yes', 1, null, undefined]) {
      expect(refusal(() => ackFor(office.org, office.messages, 'ui-designer', { message: 'm-2', agree, text: 'On it.' }, AT))).toMatchObject({
        code: 'invalid',
        message: 'Say whether you agree with it: agree is true or false.',
      });
    }
    expect(refusal(() => office.ack('ui-designer', 'm-2', ' \n '))).toMatchObject({ code: 'invalid', message: 'Say in one sentence what you will do with it.' });
    expect(refusal(() => office.ack('ui-designer', 'm-2', '', false)).message).toBe('Say in one sentence why you disagree.');
    expect(office.acks).toEqual([]);
  });
});

describe("the trace's state", () => {
  it("names an acknowledgement after its message's number", () => {
    expect(ackIdFor('m-12')).toBe('k-12');
    expect(ackIdFor('legacy')).toBe('k-legacy');
  });

  it('keeps acknowledgements oldest first, moving a replaced one to the end', () => {
    const acks = withAck([ack('m-1', 'head-of-design', 'On it.'), ack('m-2', 'ui-designer', 'On it.')], ack('m-1', 'head-of-design', 'Done, it is darker.', AT + 5));
    expect(acks.map((a) => [a.message, a.text])).toEqual([
      ['m-2', 'On it.'],
      ['m-1', 'Done, it is darker.'],
    ]);
  });

  it('keeps the newest 2,000 acknowledgements', () => {
    let acks: Ack[] = [];
    for (let i = 1; i <= TRACE_LIMITS.acks + 1; i += 1) acks = withAck(acks, ack(`m-${i}`, 'ui-designer', 'On it.', AT + i));
    expect(acks).toHaveLength(TRACE_LIMITS.acks);
    expect(acks[0]?.message).toBe('m-2');
    expect(acks.at(-1)?.message).toBe(`m-${TRACE_LIMITS.acks + 1}`);
  });

  it('folds an acknowledgement without changing the state it is given', () => {
    const before = deepFreeze({ acks: [ack('m-1', 'head-of-design', 'On it.')], other: 'kept' });
    const after = foldTrace(before, { type: 'ack', ack: ack('m-1', 'head-of-design', 'Done.', AT + 1) });
    expect(after).toEqual({ acks: [ack('m-1', 'head-of-design', 'Done.', AT + 1)], other: 'kept' });
    expect(before.acks[0]?.text).toBe('On it.');
  });

  it('marks a message delivered with how it was taken, and only the first time', () => {
    const m = (id: string): Message => ({ id, from: STAKEHOLDER, to: 'ui-designer', text: 'Darker.', origin: null, relayOf: null, note: null, at: AT, deliveredAt: null, interrupt: false });
    const messages = deepFreeze([m('m-1'), m('m-2')]);
    const once = withDelivery(messages, 'm-1', AT + 10, 'next-step');
    expect(once[0]).toMatchObject({ deliveredAt: AT + 10, deliveredHow: 'next-step' });
    expect(once[1]).toBe(messages[1]);
    expect(withDelivery(once, 'm-1', AT + 20, 'new-turn')[0]).toMatchObject({ deliveredAt: AT + 10, deliveredHow: 'next-step' });
    // A desk that doesn't say how, or says something else, leaves it out.
    expect(withDelivery(messages, 'm-2', AT + 10)[1]).not.toHaveProperty('deliveredHow');
    expect(withDelivery(messages, 'm-2', AT + 10, 'by-pigeon')[1]).not.toHaveProperty('deliveredHow');
    expect(withDelivery(messages, 'm-2', AT + 10, 'new-turn')[1]?.deliveredHow).toBe('new-turn');
  });

  it('reads acknowledgements back from a snapshot, dropping anything not shaped like one', () => {
    const good = ack('m-1', 'ui-designer', 'On it.');
    expect(reviveAcks([good, { ...good, agree: 'yes' }, { ...good, at: Number.NaN }, null, 'k-1', { id: 'k-2' }])).toEqual([good]);
    expect(reviveAcks(undefined)).toEqual([]);
    expect(reviveAcks({ acks: [good] })).toEqual([]);
  });

  it("gives the view the acknowledgements of the messages it holds, the newest 300", () => {
    const acks = Array.from({ length: 400 }, (_, i) => ack(`m-${i + 1}`, 'ui-designer', 'On it.', AT + i));
    const shown = Array.from({ length: 350 }, (_, i) => ({ id: `m-${i + 51}` }));
    const inView = acksInView(acks, shown);
    expect(inView).toHaveLength(300);
    expect(inView[0]?.message).toBe('m-101');
    expect(inView.at(-1)?.message).toBe('m-400');
    expect(acksInView(acks, [{ id: 'm-7' }]).map((a) => a.id)).toEqual(['k-7']);
  });
});

describe('what a report, a status line or a task cites', () => {
  /** The design room's message (Ada m-1, Kai m-2, Lea m-3), Kai's word to Ada (m-4) and the stakeholder's to Sam (m-5). */
  function cited(): Office {
    const office = designRoom();
    office.send('ui-designer', { kind: 'person', id: 'head-of-design' }, 'The palette is ready for a look.');
    office.send(STAKEHOLDER, { kind: 'person', id: 'frontend-engineer' }, 'Bigger slots.');
    return office;
  }
  const cites = (office: Office, by: string, raw: unknown) => citesOf(office.org, office.messages, by, raw);

  it('is nothing unless it names messages', () => {
    const office = cited();
    expect(cites(office, 'ui-designer', undefined)).toEqual([]);
    expect(cites(office, 'ui-designer', null)).toEqual([]);
    expect(cites(office, 'ui-designer', [])).toEqual([]);
  });

  it('names each message once: one sent to them, and one they sent', () => {
    expect(cites(cited(), 'ui-designer', ['m-2', ' m-4 ', 'm-2'])).toEqual(['m-2', 'm-4']);
  });

  it('takes the relays someone made, and the message they passed on', () => {
    const office = cited();
    const [relay] = office.relay('head-of-design', office.messages[0] as Message, ['ui-designer']);
    expect(cites(office, 'head-of-design', ['m-1', relay?.id])).toEqual(['m-1', relay?.id]);
  });

  it("is refused for a message they never had, naming their own copy when it's a copy of one they did", () => {
    const office = cited();
    expect(refusal(() => cites(office, 'ui-designer', ['m-2', 'm-1']))).toMatchObject({
      code: 'not-allowed',
      message: 'Kai can cite only messages sent to them or by them; their own copy of message m-1 is message m-2, so cite that one.',
    });
    expect(refusal(() => cites(office, 'ui-designer', ['m-5']))).toMatchObject({
      code: 'not-allowed',
      message: 'Kai can cite only messages sent to them or by them, and message m-5 is neither.',
    });
  });

  it("is refused for a message the company doesn't have", () => {
    expect(refusal(() => cites(cited(), 'ui-designer', ['m-2', 'm-9']))).toMatchObject({ code: 'unknown', message: "There's no message m-9 to cite." });
  });

  it('is refused when it is no list of ids, or too long a one', () => {
    const office = cited();
    expect(refusal(() => cites(office, 'ui-designer', 'm-2'))).toMatchObject({ code: 'invalid', message: 'Cite messages as a list of their ids, like ["m-12"].' });
    for (const bad of [[12], [''], [null], [{ id: 'm-2' }]]) {
      expect(refusal(() => cites(office, 'ui-designer', bad))).toMatchObject({ code: 'invalid', message: 'Cite a message by its id, like "m-12".' });
    }
    const many = Array.from({ length: 11 }, () => office.send(STAKEHOLDER, { kind: 'person', id: 'ui-designer' }, 'One more thing.')[0]?.id);
    expect(refusal(() => cites(office, 'ui-designer', many))).toMatchObject({ code: 'invalid', message: 'Cite up to 10 messages; this names 11.' });
  });
});

describe("a send's copies in the log's lines", () => {
  const office = (): Office => {
    const o = new Office({ people: bigCompany() });
    o.send(STAKEHOLDER, { kind: 'everyone' }, `${'Ünïcödé '.repeat(40)}launch is Monday.`);
    return o;
  };
  const bytes = (m: Message) => new TextEncoder().encode(JSON.stringify({ type: 'message', message: m })).byteLength + 1;

  it('keeps them on one line while they fit', () => {
    const copies = office().messages;
    expect(linesOf(copies, 1_000_000)).toEqual([copies]);
  });

  it('splits them in order over as few lines as fit the budget, counted in bytes', () => {
    const copies = office().messages;
    // Counted in bytes: the umlauts take two each, so counting characters would undercount.
    expect(bytes(copies[0] as Message)).toBeGreaterThan(JSON.stringify({ type: 'message', message: copies[0] }).length + 1);
    const budget = 3 * Math.max(...copies.map(bytes));
    const lines = linesOf(copies, budget) ?? [];
    expect(lines.flat()).toEqual(copies);
    const sizes = lines.map((line) => line.reduce((n, m) => n + bytes(m), 0));
    for (const [i, line] of lines.entries()) {
      if (i < lines.length - 1) expect(line.length).toBeGreaterThanOrEqual(3);
      expect(sizes[i]).toBeLessThanOrEqual(budget);
      // Each line is as full as it gets: the next copy wouldn't have fitted.
      const next = lines[i + 1]?.[0];
      if (next) expect((sizes[i] ?? 0) + bytes(next)).toBeGreaterThan(budget);
    }
    expect(lines.length).toBeGreaterThan(1);
  });

  it("gives null when one copy alone can't fit a line", () => {
    const copies = office().messages;
    expect(linesOf(copies, bytes(copies[0] as Message) - 1)).toBeNull();
    expect(linesOf([], 10)).toEqual([]);
  });
});
