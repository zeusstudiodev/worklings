import { describe, expect, it } from 'vitest';
import { type CompanyView, type Message, STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import { ACK_WINDOW_MS } from '../src/core/steering.ts';
import { familyOf, traceOf } from '../src/core/trace.ts';
import {
  citedBy,
  citeRows,
  escalateTarget,
  flagRows,
  followUpRows,
  forRows,
  isStalled,
  listOf,
  messageHead,
  readTrace,
  stopRows,
  summaryLine,
  summaryOf,
  TRANSIT_MS,
  tracePath,
} from '../web/src/company/trace/traceModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { ack, audience, copy, decision, planVersion, steered } from './panels-steering-kit.ts';
import { desk, message, min, NOW, report, task, update } from './panels-work-kit.ts';

const ENGINEERING = audience('room', 'engineering', 'the engineering room', 'g-eng');
const ROOM = ['head-of-engineering', 'frontend-lead', 'frontend-engineer', 'qa-engineer'];

/** "Use the staging database" to the engineering room, a minute ago; `delivered` people got it at `deliveredAgo`. */
function roomMessage(delivered: readonly string[], deliveredAgo = min(1)): Message[] {
  return ROOM.map((to, i) => copy(`m${i + 1}`, to, 'Use the staging database for the demo.', ENGINEERING, { at: NOW - min(2), deliveredAt: delivered.includes(to) ? NOW - deliveredAgo : null }));
}

const read = (view: CompanyView, id: string, at = NOW) => {
  const trace = traceOf(view, id, at);
  const r = readTrace(trace, at);
  return { state: r.state, summary: summaryOf(view, trace, r) };
};

describe('how far a message got, in a sentence', () => {
  it('reads every state of a message to a room', () => {
    expect(read(steered({ messages: roomMessage([]) }), 'm1')).toEqual({ state: 'on-its-way', summary: 'On its way to four people.' });
    const landing = steered({ messages: roomMessage(['head-of-engineering', 'frontend-lead']) }, { acks: [ack('k1', 'm1', 'head-of-engineering', 'Switching the demo to staging.')] });
    expect(read(landing, 'm1')).toEqual({ state: 'landing', summary: 'Reached two of four people. One acknowledged it.' });
    const reached = steered({ messages: roomMessage(ROOM) }, { acks: [ack('k1', 'm1', 'head-of-engineering', 'On it.'), ack('k2', 'm2', 'frontend-lead', 'On it.')] });
    expect(read(reached, 'm3')).toEqual({ state: 'reached', summary: 'Reached all four people. Two acknowledged it.' });
    const all = steered({ messages: roomMessage(ROOM) }, { acks: ROOM.map((by, i) => ack(`k${i}`, `m${i + 1}`, by, 'On it.')) });
    expect(read(all, 'g-eng')).toEqual({ state: 'acknowledged', summary: 'Reached all four people. All four acknowledged it.' });
  });

  it('says who disagrees', () => {
    const acks = ROOM.map((by, i) => ack(`k${i}`, `m${i + 1}`, by, by === 'frontend-engineer' ? 'Staging has no TWINT sandbox yet.' : 'On it.', { agree: by !== 'frontend-engineer' }));
    expect(read(steered({ messages: roomMessage(ROOM) }, { acks }), 'm1')).toEqual({ state: 'disagreement', summary: 'Reached all four people. Three acknowledged it, and Kai disagrees.' });
  });

  it('says where it stalls once a copy has been on its way too long', () => {
    const messages = roomMessage(['head-of-engineering', 'frontend-lead', 'qa-engineer']).map((m) => ({ ...m, at: NOW - TRANSIT_MS - min(1) }));
    const acks = [ack('k1', 'm1', 'head-of-engineering', 'Ok.'), ack('k2', 'm2', 'frontend-lead', 'Ok.'), ack('k4', 'm4', 'qa-engineer', 'Ok.')];
    const view = update(steered({ messages }, { acks }), 'frontend-engineer', { desk: desk('waiting', { queue: 2 }) });
    expect(read(view, 'm1')).toEqual({ state: 'stalled', summary: 'Reached three of four people. Three acknowledged it. It stalls with Kai.' });
    // A copy younger than TRANSIT_MS is still on its way: no stall.
    const young = update(steered({ messages: roomMessage(['head-of-engineering', 'frontend-lead', 'qa-engineer']) }, { acks }), 'frontend-engineer', { desk: desk('waiting') });
    expect(read(young, 'm1').state).toBe('landing');
  });

  it('reads a message to one person as them', () => {
    const to = (extra: Partial<Message>) => [message('m1', STAKEHOLDER, 'frontend-engineer', 'One thumb, please.', { at: NOW - min(30), ...extra })];
    expect(read(steered({ messages: to({ at: NOW - min(1) }) }), 'm1').summary).toBe('On its way to Kai.');
    expect(read(steered({ messages: to({ deliveredAt: NOW - min(2) }) }), 'm1').summary).toBe('Reached Kai. No acknowledgement yet.');
    expect(read(steered({ messages: to({ deliveredAt: NOW - min(2) }) }, { acks: [ack('k1', 'm1', 'frontend-engineer', 'Bigger slots.')] }), 'm1').summary).toBe('Kai acknowledged it.');
    expect(read(steered({ messages: to({ deliveredAt: NOW - ACK_WINDOW_MS - min(1) }) }), 'm1')).toEqual({ state: 'stalled', summary: "Kai hasn't acknowledged it yet." });
  });

  it("says when the office no longer holds the message", () => {
    expect(read(steered(), 'm-gone')).toEqual({ state: 'gone', summary: "That message isn't in the office's view any more." });
  });

  it('counts a flag that waits for delivery as stalled only after TRANSIT_MS', () => {
    const flag = { kind: 'not-delivered' as const, person: 'frontend-engineer', holder: 'frontend-engineer', since: NOW - TRANSIT_MS + 1, sentence: '' };
    expect(isStalled(flag, NOW)).toBe(false);
    expect(isStalled({ ...flag, since: NOW - TRANSIT_MS }, NOW)).toBe(true);
    expect(isStalled({ ...flag, kind: 'no-ack', since: NOW }, NOW)).toBe(true);
  });
});

describe('the line under your message in a conversation', () => {
  const direct = (extra: Partial<Message> = {}) => [message('m1', STAKEHOLDER, 'frontend-engineer', 'One thumb, please.', { at: NOW - min(5), deliveredAt: NOW - min(4), ...extra })];

  it('says nothing the delivery line already says', () => {
    expect(summaryLine(steered({ messages: direct() }), traceOf(steered({ messages: direct() }), 'm1', NOW), NOW)).toBeNull();
  });

  it("quotes one person's acknowledgement, and what cites it", () => {
    const view = steered({ messages: direct(), tasks: [task('t1', 'frontend-engineer', 'Bigger slot buttons', { cites: ['m1'] })] }, { acks: [ack('k1', 'm1', 'frontend-engineer', 'Making the **slots** bigger.')] });
    expect(summaryLine(view, traceOf(view, 'm1', NOW), NOW)).toEqual({ text: 'Kai acknowledged it: “Making the slots bigger.” Cited by a task.', tone: 'quiet', link: true });
    const disagrees = steered({ messages: direct() }, { acks: [ack('k1', 'm1', 'frontend-engineer', 'One thumb breaks the time grid.', { agree: false })] });
    expect(summaryLine(disagrees, traceOf(disagrees, 'm1', NOW), NOW)).toEqual({ text: 'Kai disagrees: “One thumb breaks the time grid.”', tone: 'disagree', link: false });
  });

  it('gives a message that reached several people its summary and a link', () => {
    const view = steered({ messages: roomMessage(ROOM) });
    expect(summaryLine(view, traceOf(view, 'm2', NOW), NOW)).toEqual({ text: 'Reached all four people. No acknowledgements yet.', tone: 'quiet', link: true });
  });

  it('marks a stall', () => {
    const view = steered({ messages: direct({ deliveredAt: NOW - ACK_WINDOW_MS }) });
    expect(summaryLine(view, traceOf(view, 'm1', NOW), NOW)).toEqual({ text: "Kai hasn't acknowledged it yet.", tone: 'stalled', link: true });
  });
});

/** "Make the palette darker" to the CEO for Mina, passed on to Ada. */
function forMina(extra: { reachedMina?: boolean } = {}): Message[] {
  return [
    message('m1', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(30), deliveredAt: NOW - min(29), deliveredHow: 'next-step', for: ['ui-designer'] }),
    message('m2', 'ceo', 'head-of-design', 'Make the palette darker.', { at: NOW - min(25), deliveredAt: NOW - min(24), deliveredHow: 'new-turn', origin: STAKEHOLDER, relayOf: 'm1', note: 'Please take this through design.' }),
    ...(extra.reachedMina ? [message('m3', 'head-of-design', 'ui-designer', 'Make the palette darker.', { at: NOW - min(20), deliveredAt: NOW - min(19), origin: STAKEHOLDER, relayOf: 'm2' })] : []),
  ];
}

describe("the trace's page", () => {
  it('says who it was to and who it is for, and where Back goes', () => {
    const view = steered({ messages: forMina() });
    expect(messageHead(view, familyOf(view.messages, 'm1'), NOW)).toEqual({
      whose: 'Your message',
      to: `To the CEO at ${hourMinute(NOW - min(30))}.`,
      for: 'For Mina.',
      text: 'Make the palette darker.',
      back: 'people/ceo',
    });
    const room = steered({ messages: roomMessage([]) });
    expect(messageHead(room, familyOf(room.messages, 'g-eng'), NOW)).toMatchObject({ to: `To the engineering room at ${hourMinute(NOW - min(2))}.`, back: '' });
    const direct = steered({ messages: [message('m9', STAKEHOLDER, 'frontend-engineer', 'Hi.', { at: NOW - min(3) })] });
    expect(messageHead(direct, familyOf(direct.messages, 'm9'), NOW)?.to).toBe(`To Kai, frontend engineer, at ${hourMinute(NOW - min(3))}.`);
  });

  it('lists who got it in the order it travelled, relays a step in under who passed them on', () => {
    const view = steered({ messages: forMina({ reachedMina: true }) }, { acks: [ack('k1', 'm3', 'ui-designer', 'Trying espresso brown.', { at: NOW - min(18) }), ack('k2', 'm2', 'head-of-design', 'Too dark for the menu photos.', { agree: false, at: NOW - min(23) })] });
    const rows = stopRows(view, traceOf(view, 'm1', NOW), NOW);
    expect(rows.map((r) => [r.person, r.depth, r.word.text, r.word.tone])).toEqual([
      ['ceo', 0, 'Delivered', 'neutral'],
      ['head-of-design', 1, 'Disagrees', 'needs'],
      ['ui-designer', 2, 'Acknowledged', 'done'],
    ]);
    expect(rows[0]).toMatchObject({ name: 'The CEO', delivery: `Delivered ${hourMinute(NOW - min(29))} at the CEO's next step.`, via: null, note: null, ack: null });
    expect(rows[1]).toMatchObject({
      name: 'Ada, head of design',
      via: `Passed on by the CEO at ${hourMinute(NOW - min(25))}.`,
      note: 'The CEO added: “Please take this through design.”',
      delivery: `Delivered ${hourMinute(NOW - min(24))}: Ada started on it.`,
      ack: { agree: false, text: 'Too dark for the menu photos.', when: hourMinute(NOW - min(23)) },
    });
  });

  it('says why a copy is still on its way, and marks one on its way too long', () => {
    const fresh = update(steered({ messages: [message('m1', STAKEHOLDER, 'frontend-engineer', 'Hi.', { at: NOW - min(1) })] }), 'frontend-engineer', { desk: desk('waiting', { queue: 2 }) });
    expect(stopRows(fresh, traceOf(fresh, 'm1', NOW), NOW)[0]).toMatchObject({ word: { text: 'On its way', tone: 'waiting' }, delivery: 'Waits for a desk, second in line.' });
    const old = update(steered({ messages: [message('m1', STAKEHOLDER, 'frontend-engineer', 'Hi.', { at: NOW - TRANSIT_MS })] }), 'frontend-engineer', { desk: desk('working') });
    expect(stopRows(old, traceOf(old, 'm1', NOW), NOW)[0]).toMatchObject({ word: { text: 'Not delivered', tone: 'error' }, delivery: "Waits for Kai's next step." });
  });

  it('flags carry who to remind, who to escalate to, and the follow-ups already sent', () => {
    const remind = message('m8', STAKEHOLDER, 'head-of-design', 'A reminder: Mina should get the palette note.', { at: NOW - min(2), cites: ['m1'] });
    const view = steered({ messages: [...forMina(), remind] }, { acks: [ack('k1', 'm1', 'ceo', 'Passing it on.'), ack('k2', 'm2', 'head-of-design', 'Will tell Mina.')] });
    const trace = traceOf(view, 'm1', NOW);
    expect(flagRows(view, trace, readTrace(trace, NOW).stalled, NOW)).toEqual([
      {
        key: 'holder:head-of-design',
        kinds: ['not-reached'],
        sentences: ['Not passed on to Mina yet.'],
        age: 'For 30 min.',
        holder: { id: 'head-of-design', name: 'Ada' },
        holds: 'Ada has it.',
        escalateTo: { id: 'ceo', name: 'the CEO' },
        followed: `You reminded Ada at ${hourMinute(NOW - min(2))}.`,
      },
    ]);
  });

  it('gives each holder one row, their own flag first, so Remind and Escalate show once', () => {
    // Ada got "for Mina" on her own: she hasn't passed it on or acknowledged it, and it hasn't reached Mina.
    const messages = [message('m1', STAKEHOLDER, 'head-of-design', 'For Mina: the logo needs a light version.', { at: NOW - min(24), deliveredAt: NOW - min(23), for: ['ui-designer'] })];
    const view = steered({ messages });
    const trace = traceOf(view, 'm1', NOW);
    const rows = flagRows(view, trace, readTrace(trace, NOW).stalled, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kinds: ['not-passed-on', 'not-reached'],
      sentences: ["Ada hasn't passed it on or acknowledged it yet.", 'Not passed on to Mina yet.'],
      age: 'For 24 min.',
      holds: null,
      escalateTo: { id: 'ceo', name: 'the CEO' },
    });
  });

  it('reads a Remind and an Escalate the office sent as well as yours', () => {
    // The real company sends them from the office (the demo from you): the flag and the follow-ups say who sent them.
    const remind = message('m8', THE_OFFICE, 'head-of-design', 'A reminder about message m1.', { at: NOW - min(4), cites: ['m1'] });
    const escalate = message('m9', THE_OFFICE, 'ceo', 'Message m1 is stuck with Ada.', { at: NOW - min(2), cites: ['m1'] });
    const view = steered({ messages: [...forMina(), remind, escalate] }, { acks: [ack('k1', 'm1', 'ceo', 'Passing it on.'), ack('k2', 'm2', 'head-of-design', 'Will tell Mina.')] });
    const trace = traceOf(view, 'm1', NOW);
    expect(flagRows(view, trace, readTrace(trace, NOW).stalled, NOW)[0]?.followed).toBe(`The office escalated to the CEO at ${hourMinute(NOW - min(2))}.`);
    expect(followUpRows(view, trace, NOW).map((r) => r.text)).toEqual([
      `The office followed up with Ada at ${hourMinute(NOW - min(4))}.`,
      `The office followed up with the CEO at ${hourMinute(NOW - min(2))}.`,
    ]);
  });

  it('escalates to the manager, else the CEO, and never above the CEO', () => {
    const view = steered();
    expect(escalateTarget(view, 'frontend-engineer')).toBe('frontend-lead');
    expect(escalateTarget(view, 'head-of-design')).toBe('ceo');
    expect(escalateTarget(view, 'ceo')).toBeNull();
    const loose = update(view, 'qa-engineer', { reportsTo: null });
    expect(escalateTarget(loose, 'qa-engineer')).toBe('ceo');
  });

  it("says whether it reached the people it's for", () => {
    const waiting = steered({ messages: forMina() });
    expect(forRows(waiting, traceOf(waiting, 'm1', NOW), NOW)).toEqual([{ person: 'ui-designer', name: 'Mina', line: 'Not reached yet. Ada has it.' }]);
    const reached = steered({ messages: forMina({ reachedMina: true }) });
    expect(forRows(reached, traceOf(reached, 'm1', NOW), NOW)).toEqual([{ person: 'ui-designer', name: 'Mina', line: `Reached ${hourMinute(NOW - min(19))}.` }]);
  });

  it('links what came of it to where it lives', () => {
    const view = steered(
      {
        messages: forMina(),
        tasks: [task('t1', 'ui-designer', 'Darker palette', { cites: ['m2'], status: 'done', commit: 'abc1234', askedBy: 'head-of-design' }), task('t2', 'ui-designer', 'Menu icons')],
        reports: [report('r1', 'ui-designer', 'head-of-design', 'Darker now.', { cites: ['m1'], taskId: 't2' }), report('r2', 'ceo', STAKEHOLDER, 'Design has it.', { cites: ['m1'] })],
        statuses: [{ person: 'head-of-design', text: 'Passing the palette note on.', taskId: null, at: NOW - min(21), cites: ['m2'] }],
      },
      { decisions: [decision('d1', 'head-of-design', 'decide', 'Espresso brown it is.', { links: { message: 'm2' } })], plan: { versions: [planVersion(2, 'ceo', { cites: ['m1'] })], approved: null, comments: [], waiting: null } },
    );
    // A row's key is "<kind>:<id>:<time>"; the kind and id name what it links to.
    const paths = Object.fromEntries(citeRows(view, traceOf(view, 'm1', NOW), NOW).map((r) => [r.key.split(':').slice(0, 2).join(':'), r.path]));
    expect(paths).toEqual({
      'task:t1': 'tasks/t1',
      'commit:abc1234': 'tasks/t1',
      'report:r1': 'tasks/t2',
      'report:r2': 'people/ceo',
      [`status:head-of-design@${NOW - min(21)}`]: 'people/head-of-design',
      'decision:d1': 'decisions/d1',
      'plan:2': 'plan/v2',
    });
  });

  it('lists follow-ups: yours, the office’s and replies', () => {
    const messages = [
      ...forMina(),
      message('m8', STAKEHOLDER, 'head-of-design', 'Reminder.', { at: NOW - min(3), cites: ['m1'] }),
      message('m9', 'head-of-design', STAKEHOLDER, 'Telling **Mina** now.', { at: NOW - min(2), cites: ['m2'] }),
      message('m10', 'head-of-design', 'ui-designer', 'Palette note for you.', { at: NOW - min(1), cites: ['m1'] }),
    ];
    const view = steered({ messages });
    expect(followUpRows(view, traceOf(view, 'm1', NOW), NOW).map((r) => r.text)).toEqual([
      `You followed up with Ada at ${hourMinute(NOW - min(3))}.`,
      `Ada replied at ${hourMinute(NOW - min(2))}: Telling Mina now.`,
      `Ada wrote to Mina about it at ${hourMinute(NOW - min(1))}.`,
    ]);
  });
});

describe('small words', () => {
  it('lists names as a sentence does, and cuts long lists', () => {
    expect(listOf([])).toBe('');
    expect(listOf(['Ada'])).toBe('Ada');
    expect(listOf(['Ada', 'Mina'])).toBe('Ada and Mina');
    expect(listOf(['Ada', 'Mina', 'Jules'])).toBe('Ada, Mina and Jules');
    expect(listOf(['Ada', 'Mina', 'Jules', 'Pia', 'Kai'])).toBe('Ada, Mina and three others');
  });

  it('counts what cites a message by kind', () => {
    expect(citedBy([])).toBeNull();
    const c = (kind: 'task' | 'report') => ({ kind, id: kind, by: 'x', at: 0, text: '' });
    expect(citedBy([c('task'), c('report'), c('report')])).toBe('Cited by a task and two reports.');
  });

  it('gives a trace an address of its own', () => {
    expect(tracePath('m 1/2')).toBe('messages/m%201%2F2');
  });
});
