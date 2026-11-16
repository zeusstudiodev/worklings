import { describe, expect, it } from 'vitest';
import { messageTurn, planSend, reach, roomTitle, teamTitle, turnWords } from '../src/company/audience.ts';
import { type Message, STAKEHOLDER } from '../src/core/company.ts';
import type { Recipient } from '../src/core/steering.ts';
import { AT, bigCompany, cafe, maker, org, refusal } from './steering-messages-kit.ts';

const WORDS = 'Make the palette darker.';
const room = (id: string): Recipient => ({ kind: 'room', id });
const team = (head: string): Recipient => ({ kind: 'team', head });
const one = (id: string): Recipient => ({ kind: 'person', id });
const everyone: Recipient = { kind: 'everyone' };

/** Who a send gives a copy to, from `by` in the café (or the org given). */
const reached = (by: string, to: Recipient, o = org()) => reach(o, by, to).to;

describe('a message from the stakeholder', () => {
  it('reaches one person as one message that names no audience', () => {
    const { make } = maker();
    const [m, ...rest] = planSend(org(), STAKEHOLDER, { to: one('ui-designer'), text: WORDS }, make);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ id: 'm-1', from: STAKEHOLDER, to: 'ui-designer', text: WORDS, deliveredAt: null });
    expect(m?.audience).toBeUndefined();
  });

  it('reaches everyone in a room, one copy each', () => {
    expect(reached(STAKEHOLDER, room('design'))).toEqual(['head-of-design', 'ui-designer', 'ux-designer']);
    expect(reach(org(), STAKEHOLDER, room('design')).audience).toEqual({ kind: 'room', id: 'design', title: 'the design room' });
  });

  it('reaches a head and everyone below them as their team, the team lead\'s people included', () => {
    expect(reached(STAKEHOLDER, team('head-of-engineering'))).toEqual(['head-of-engineering', 'frontend-lead', 'frontend-engineer']);
    expect(reach(org(), STAKEHOLDER, team('head-of-engineering')).audience).toEqual({ kind: 'team', id: 'head-of-engineering', title: "Ben's team" });
    // A team lead's team is a team too.
    expect(reached(STAKEHOLDER, team('frontend-lead'))).toEqual(['frontend-lead', 'frontend-engineer']);
  });

  it('reaches every one of 25 people with a copy each, sharing one group', () => {
    const people = bigCompany();
    expect(people).toHaveLength(25);
    const { make } = maker();
    const copies = planSend(org({ people }), STAKEHOLDER, { to: everyone, text: 'Launch is Monday.' }, make);
    expect(copies.map((m) => m.to)).toEqual(people.map((p) => p.id));
    expect(new Set(copies.map((m) => m.id)).size).toBe(25);
    expect(new Set(copies.map((m) => m.audience?.group))).toEqual(new Set(['m-1']));
    expect(copies.every((m) => m.from === STAKEHOLDER && m.text === 'Launch is Monday.')).toBe(true);
    expect(copies[24]?.audience).toEqual({ kind: 'everyone', id: null, title: 'everyone', group: 'm-1' });
  });

  it('reaches a head with nobody below them yet as that head alone, still as their team', () => {
    const people = cafe().filter((p) => p.reportsTo !== 'head-of-design');
    const { make } = maker();
    const copies = planSend(org({ people }), STAKEHOLDER, { to: team('head-of-design'), text: WORDS }, make);
    expect(copies.map((m) => [m.to, m.audience?.title])).toEqual([['head-of-design', "Ada's team"]]);
  });

  it("refuses a room nobody works in, and one the office doesn't have", () => {
    expect(refusal(() => reach(org(), STAKEHOLDER, room('games')))).toMatchObject({
      code: 'invalid',
      message: "Nobody works in the games room yet, so there's nobody to send it to.",
    });
    expect(refusal(() => reach(org(), STAKEHOLDER, room('basement')))).toMatchObject({ code: 'unknown', message: 'There\'s no room called "basement" in the office.' });
  });

  it("refuses a team of someone who doesn't lead one, saying whose team to send it to", () => {
    expect(refusal(() => reach(org(), STAKEHOLDER, team('ui-designer')))).toMatchObject({
      code: 'invalid',
      message: "Kai doesn't lead a team; send it to Kai or to Ada's team.",
    });
  });

  it('refuses someone who is not in the company, and a recipient of no known kind', () => {
    expect(refusal(() => reach(org(), STAKEHOLDER, one('seo-specialist')))).toMatchObject({ code: 'unknown', message: 'There\'s nobody called "seo-specialist" in the company.' });
    expect(refusal(() => reach(org(), STAKEHOLDER, team('nobody'))).code).toBe('unknown');
    expect(refusal(() => reach(org(), STAKEHOLDER, one(STAKEHOLDER))).code).toBe('invalid');
    for (const bad of [null, 'design', { kind: 'room' }, { kind: 'floor', id: 'design' }, { kind: 'person', id: '' }, { kind: 'team', id: 'head-of-design' }, { kind: 'room', id: 'x'.repeat(201) }]) {
      expect(refusal(() => reach(org(), STAKEHOLDER, bad))).toMatchObject({ code: 'invalid', message: 'Send it to a person, a room, a team or everyone.' });
    }
  });
});

describe('a message from the CEO', () => {
  it('reaches everyone but the CEO: 24 copies in a company of 25', () => {
    const people = bigCompany();
    const to = reached('ceo', everyone, org({ people }));
    expect(to).toHaveLength(24);
    expect(to).not.toContain('ceo');
  });

  it('reaches any room and any team, never with a copy for the CEO', () => {
    expect(reached('ceo', room('engineering'))).toEqual(['head-of-engineering', 'frontend-lead', 'frontend-engineer']);
    expect(reached('ceo', room('direction'))).toEqual(['office-manager']);
    expect(reached('ceo', team('frontend-lead'))).toEqual(['frontend-lead', 'frontend-engineer']);
    // The CEO's own team is everyone else.
    expect(reached('ceo', team('ceo'))).toHaveLength(7);
  });

  it('messages one person only as the org rules allow, saying who passes it on otherwise', () => {
    expect(reached('ceo', one('head-of-design'))).toEqual(['head-of-design']);
    expect(reached('ceo', one(STAKEHOLDER))).toEqual([STAKEHOLDER]);
    expect(refusal(() => reach(org(), 'ceo', one('frontend-engineer')))).toMatchObject({
      code: 'not-allowed',
      message: 'Noor can message Robin and their own reports; ask Ben to pass this on.',
    });
  });
});

describe('a message from a head', () => {
  it('reaches their own team and the teams inside it', () => {
    expect(reached('head-of-engineering', team('head-of-engineering'))).toEqual(['frontend-lead', 'frontend-engineer']);
    expect(reached('head-of-engineering', team('frontend-lead'))).toEqual(['frontend-lead', 'frontend-engineer']);
  });

  it('reaches their own room', () => {
    expect(reached('head-of-design', room('design'))).toEqual(['ui-designer', 'ux-designer']);
  });

  it("refuses another head's room and team, saying who passes it on", () => {
    const sentence = 'Ada can message the design room, their own team and the people the org lets them message, and Ola in the engineering room isn\'t one of them; ask Noor to pass this on.';
    expect(refusal(() => reach(org(), 'head-of-design', room('engineering')))).toMatchObject({ code: 'not-allowed', message: sentence });
    expect(refusal(() => reach(org(), 'head-of-design', team('frontend-lead'))).code).toBe('not-allowed');
  });

  it('refuses everyone: only the CEO messages everyone', () => {
    expect(refusal(() => reach(org(), 'head-of-design', everyone))).toMatchObject({ code: 'not-allowed', message: 'Only the CEO messages everyone; ask Noor to pass this on.' });
  });

  it('reaches another room when they may message each person in it on their own', () => {
    // Noor is Ada's manager and Tia has the same manager as Ada.
    expect(reached('head-of-design', room('direction'))).toEqual(['ceo', 'office-manager']);
  });

  it('refuses their own team while nobody is in it', () => {
    const people = cafe().filter((p) => p.reportsTo !== 'head-of-design');
    expect(refusal(() => reach(org({ people }), 'head-of-design', team('head-of-design')))).toMatchObject({
      code: 'invalid',
      message: "Ada has nobody in their team yet, so there's nobody to send it to.",
    });
  });
});

describe('a message from a team lead or a worker', () => {
  it('reaches a room or a team only when they may message each person in it on their own', () => {
    expect(reached('frontend-lead', team('frontend-lead'))).toEqual(['frontend-engineer']);
    // Ada is Kai's manager and Lea is on Kai's team.
    expect(reached('ui-designer', room('design'))).toEqual(['head-of-design', 'ux-designer']);
    // Ben is Ola's manager and Sam her report, so she reaches Ben's team too.
    expect(reached('frontend-lead', team('head-of-engineering'))).toEqual(['head-of-engineering', 'frontend-engineer']);
  });

  it('refuses a room with someone they may not message, naming who passes it on', () => {
    expect(refusal(() => reach(org(), 'frontend-engineer', room('engineering')))).toMatchObject({
      code: 'not-allowed',
      message: "Sam can message their manager, their own team and their reports, and Ben in the engineering room isn't one of them; ask Ola to pass this on.",
    });
    expect(refusal(() => reach(org(), 'frontend-lead', room('design'))).code).toBe('not-allowed');
    expect(refusal(() => reach(org(), 'ui-designer', everyone))).toMatchObject({ code: 'not-allowed', message: 'Only the CEO messages everyone; ask Ada to pass this on.' });
  });

  it('messages one person by the org rules, with the sentences the company has always used', () => {
    expect(reached('ui-designer', one('head-of-design'))).toEqual(['head-of-design']);
    expect(reached('ui-designer', one('ux-designer'))).toEqual(['ux-designer']);
    expect(refusal(() => reach(org(), 'ui-designer', one('frontend-engineer')))).toMatchObject({
      code: 'not-allowed',
      message: 'Kai can message their manager, their own team and their reports; ask Ada to pass this on.',
    });
  });

  it('writes to the stakeholder only once the stakeholder has written to them', () => {
    expect(refusal(() => reach(org(), 'ui-designer', one(STAKEHOLDER))).message).toBe(
      'Kai can write to Robin once Robin has written to them; until then, ask Ada to take it up, or use ask.',
    );
    expect(reached('ui-designer', one(STAKEHOLDER), org({ wrote: ['ui-designer'] }))).toEqual([STAKEHOLDER]);
  });

  it("can't send a message to themselves, alone or as the only one in a room", () => {
    expect(refusal(() => reach(org(), 'ui-designer', one('ui-designer'))).message).toBe("Kai can't send a message to themselves.");
    const people = cafe().map((p) => (p.id === 'office-manager' ? { ...p, room: 'games' } : p));
    expect(refusal(() => reach(org({ people }), 'office-manager', room('games'))).message).toBe("Nobody else works in the games room yet, so there's nobody to send it to.");
  });

  it('is refused for someone who is not in the company', () => {
    expect(refusal(() => reach(org(), 'seo-specialist', room('design'))).code).toBe('unknown');
  });
});

describe("a send's copies", () => {
  it("each name the audience, and share the first copy's id as their group", () => {
    const { make } = maker();
    const copies = planSend(org(), 'head-of-design', { to: room('design'), text: WORDS }, make);
    expect(copies.map((m) => [m.id, m.from, m.to])).toEqual([
      ['m-1', 'head-of-design', 'ui-designer'],
      ['m-2', 'head-of-design', 'ux-designer'],
    ]);
    for (const m of copies) expect(m.audience).toEqual({ kind: 'room', id: 'design', title: 'the design room', group: 'm-1' });
  });

  it('carry whom the stakeholder means it for, on the one message and on every copy', () => {
    const { make } = maker();
    const [direct] = planSend(org(), STAKEHOLDER, { to: one('ceo'), text: WORDS, for: ['ui-designer'] }, make);
    expect(direct).toMatchObject({ to: 'ceo', for: ['ui-designer'] });
    const copies = planSend(org(), STAKEHOLDER, { to: room('design'), text: WORDS, for: ['ui-designer', 'ux-designer', 'ui-designer'] }, make);
    expect(copies.map((m) => m.for)).toEqual([
      ['ui-designer', 'ux-designer'],
      ['ui-designer', 'ux-designer'],
      ['ui-designer', 'ux-designer'],
    ]);
    // Each copy has its own list, so changing one never changes another.
    expect(copies[0]?.for).not.toBe(copies[1]?.for);
  });

  it('leave out "for" when nobody is named', () => {
    const { make } = maker();
    const [m] = planSend(org(), STAKEHOLDER, { to: one('ceo'), text: WORDS, for: [] }, make);
    expect(m && 'for' in m).toBe(false);
  });

  it('refuse a "for" naming someone outside the company, one from anyone but the stakeholder, and one that is no list', () => {
    const { make, made } = maker();
    expect(refusal(() => planSend(org(), STAKEHOLDER, { to: one('ceo'), text: WORDS, for: ['ui-designer', 'brand-designer'] }, make))).toMatchObject({
      code: 'unknown',
      message: 'There\'s nobody called "brand-designer" in the company.',
    });
    expect(refusal(() => planSend(org(), 'ceo', { to: one('head-of-design'), text: WORDS, for: ['ui-designer'] }, make))).toMatchObject({
      code: 'not-allowed',
      message: 'Only Robin says who a message is for; name them in the words instead.',
    });
    expect(refusal(() => planSend(org(), STAKEHOLDER, { to: one('ceo'), text: WORDS, for: 'ui-designer' }, make)).code).toBe('invalid');
    const many = Array.from({ length: 51 }, (_, i) => `person-${i}`);
    expect(refusal(() => planSend(org(), STAKEHOLDER, { to: one('ceo'), text: WORDS, for: many }, make)).message).toBe('A message can be for up to 50 people; this one names 51.');
    // Nothing was made for a send that was refused.
    expect(made).toEqual([]);
  });

  it('refuse a message with no words', () => {
    const { make, made } = maker();
    expect(refusal(() => planSend(org(), STAKEHOLDER, { to: room('design'), text: '' }, make))).toMatchObject({ code: 'invalid', message: 'Say something to send.' });
    expect(made).toEqual([]);
  });
});

describe("an audience's title", () => {
  it('names a room as the composer does', () => {
    expect(roomTitle('Design')).toBe('the design room');
    expect(roomTitle('Data & AI')).toBe('the data & AI room');
    expect(roomTitle('Games room')).toBe('the games room');
    expect(roomTitle('The Lab')).toBe('the lab room');
    expect(refusal(() => reach(org(), STAKEHOLDER, room('data'))).message).toBe("Nobody works in the data & AI room yet, so there's nobody to send it to.");
  });

  it('names a room the office has no name for after its id', () => {
    const people = cafe().map((p) => (p.id === 'ux-designer' ? { ...p, room: 'research-lab' } : p));
    expect(reach(org({ people }), STAKEHOLDER, room('research-lab')).audience?.title).toBe('the research lab room');
  });

  it('names a team after its head', () => {
    expect(teamTitle({ name: 'Ada', title: 'Head of design' })).toBe("Ada's team");
    expect(teamTitle({ name: 'Head of design', title: 'Head of design' })).toBe("the head of design's team");
  });
});

describe('the turn a copy arrives as', () => {
  const copy = (extra: Partial<Message> = {}): Message => ({
    id: 'm-12', from: STAKEHOLDER, to: 'ui-designer', text: WORDS, origin: null, relayOf: null, note: null, at: AT, deliveredAt: null, interrupt: false,
    audience: { kind: 'room', id: 'design', title: 'the design room', group: 'm-11' }, ...extra,
  });

  it('names the audience on the line before the fence, with the words inside it', () => {
    expect(messageTurn(copy(), org(), 'fence1234')).toBe(`From Robin, the stakeholder, to the design room (message m-12), between the two fence1234 lines:\nfence1234\n${WORDS}\nfence1234`);
    expect(messageTurn(copy({ from: 'head-of-design', to: 'ux-designer' }), org(), 'fence1234').split('\n')[0]).toBe('From Ada, head of design, to the design room (message m-12), between the two fence1234 lines:');
  });

  it('says whom the stakeholder means it for, inside the fence', () => {
    expect(turnWords(copy({ to: 'ux-designer', for: ['ui-designer'] }), org())).toBe(`${WORDS}\n\nRobin means this for Kai, UI designer.`);
    expect(turnWords(copy({ to: 'ceo', audience: null, for: ['ui-designer', 'ux-designer', 'frontend-engineer'] }), org())).toBe(
      `${WORDS}\n\nRobin means this for Kai, UI designer; Lea, UX designer and Sam, frontend engineer.`,
    );
  });

  it("tells the person it's for that it's meant for them", () => {
    expect(turnWords(copy({ for: ['ui-designer'] }), org())).toBe(`${WORDS}\n\nRobin means this for you.`);
    expect(turnWords(copy({ for: ['ux-designer', 'ui-designer'] }), org())).toBe(`${WORDS}\n\nRobin means this for you and Lea, UX designer.`);
    // Without the stakeholder's name, the office says who they are.
    expect(turnWords(copy({ for: ['ui-designer'] }), org({ stakeholder: '' }))).toBe(`${WORDS}\n\nThe stakeholder means this for you.`);
  });

  it("keeps a relayer's note with the words, then whom it is for", () => {
    const relayed = copy({ from: 'head-of-design', origin: STAKEHOLDER, relayOf: 'm-11', audience: null, note: 'Mostly the buttons.', for: ['ui-designer'] });
    expect(turnWords(relayed, org())).toBe(`${WORDS}\n\nAda adds: Mostly the buttons.\n\nRobin means this for you.`);
    expect(messageTurn(relayed, org(), 'fence1234').split('\n')[0]).toBe('From Ada, head of design, passing on from Robin (message m-12), between the two fence1234 lines:');
  });

  it('leaves out people it was for who have left the company', () => {
    expect(turnWords(copy({ for: ['seo-specialist'] }), org())).toBe(WORDS);
  });
});
