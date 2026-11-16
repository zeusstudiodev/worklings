import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { ACK_WINDOW_MS } from '../src/core/steering.ts';
import { familyOf, traceOf } from '../src/core/trace.ts';
import { ack, audience, copy, decision, planVersion, steered } from './panels-steering-kit.ts';
import { desk, message, min, NOW, report, task, update } from './panels-work-kit.ts';

/** "Make the palette darker" to the CEO, passed on to Ada, who passes it on to Mina (relayOf naming the first). */
function relayed(extra: { delivered?: boolean } = {}) {
  const delivered = extra.delivered ?? true;
  return [
    message('m1', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(30), deliveredAt: NOW - min(29), deliveredHow: 'next-step', for: ['ui-designer'] }),
    message('m2', 'ceo', 'head-of-design', 'Make the palette darker.', { at: NOW - min(26), deliveredAt: NOW - min(25), deliveredHow: 'new-turn', origin: STAKEHOLDER, relayOf: 'm1', note: 'Please take this through design.' }),
    message('m3', 'head-of-design', 'ui-designer', 'Make the palette darker.', { at: NOW - min(20), deliveredAt: delivered ? NOW - min(19) : null, origin: STAKEHOLDER, relayOf: 'm1' }),
  ];
}

describe("a message's stops", () => {
  it('follows relays from the message they pass on, whichever one their relayOf names', () => {
    const view = steered({ messages: relayed() }, { acks: [ack('k1', 'm1', 'ceo', 'Passing it to design.')] });
    const trace = traceOf(view, 'm1', NOW);
    expect(trace.stops).toEqual([
      { person: 'ceo', message: 'm1', via: null, deliveredAt: NOW - min(29), how: 'next-step', ack: view.steering?.acks[0] },
      { person: 'head-of-design', message: 'm2', via: 'ceo', deliveredAt: NOW - min(25), how: 'new-turn', ack: null },
      { person: 'ui-designer', message: 'm3', via: 'head-of-design', deliveredAt: NOW - min(19), how: null, ack: null },
    ]);
  });

  it('reads the same trace from a relay as from the message it passes on', () => {
    const view = steered({ messages: relayed() });
    expect(traceOf(view, 'm3', NOW).stops).toEqual(traceOf(view, 'm1', NOW).stops);
    expect(traceOf(view, 'm3', NOW).message).toBe('m3');
  });

  it('gathers every copy sent to a room, from one copy or from the group they share', () => {
    const room = audience('room', 'design', 'the design room', 'g-7');
    const messages = [
      copy('m10', 'head-of-design', 'Darker, please.', room, { at: NOW - min(3), deliveredAt: NOW - min(2), deliveredHow: 'next-step' }),
      copy('m11', 'ui-designer', 'Darker, please.', room, { at: NOW - min(3) }),
      message('m12', STAKEHOLDER, 'ui-designer', 'Something else.', { at: NOW - min(3) }),
    ];
    const view = steered({ messages });
    for (const id of ['m10', 'm11', 'g-7']) {
      expect(traceOf(view, id, NOW).stops.map((s) => [s.person, s.message, s.via])).toEqual([
        ['head-of-design', 'm10', null],
        ['ui-designer', 'm11', null],
      ]);
    }
  });

  it("takes each person's newest acknowledgement of their own copy, or of any copy of the message", () => {
    const view = steered(
      { messages: relayed() },
      {
        acks: [
          ack('k1', 'm2', 'head-of-design', 'On it.', { at: NOW - min(24) }),
          ack('k2', 'm2', 'head-of-design', 'Espresso brown fails contrast on the buttons.', { at: NOW - min(22), agree: false }),
          // Mina acknowledges the message number her turn named, the first copy's.
          ack('k3', 'm1', 'ui-designer', 'Trying espresso brown at 4.5:1.', { at: NOW - min(18) }),
          // Someone else's acknowledgement is never theirs, even of a copy in this trace.
          ack('k4', 'm1', 'frontend-engineer', 'Not mine to acknowledge.', { at: NOW - min(17) }),
        ],
      },
    );
    const byPerson = Object.fromEntries(traceOf(view, 'm1', NOW).stops.map((s) => [s.person, s.ack?.id ?? null]));
    expect(byPerson).toEqual({ ceo: null, 'head-of-design': 'k2', 'ui-designer': 'k3' });
  });

  it('is empty for a message the view no longer holds, and still lists what cites it', () => {
    const view = steered({ tasks: [task('t1', 'ui-designer', 'Darker palette', { cites: ['m-gone'], askedBy: 'head-of-design' })] });
    const trace = traceOf(view, 'm-gone', NOW);
    expect(trace.stops).toEqual([]);
    expect(trace.flags).toEqual([]);
    expect(trace.cites.map((c) => c.id)).toEqual(['t1']);
  });

  it("works without the steering view an older office leaves out", () => {
    const view = { ...steered({ messages: relayed() }), steering: undefined };
    const trace = traceOf(view, 'm1', NOW);
    expect(trace.stops).toHaveLength(3);
    expect(trace.stops.every((s) => s.ack === null)).toBe(true);
  });
});

describe('what cites it', () => {
  it('lists the tasks, commits, reports, status lines, decisions and plan versions that cite any copy, oldest first', () => {
    const view = steered(
      {
        messages: relayed(),
        tasks: [
          task('t1', 'ui-designer', 'Darker palette across the site', { askedBy: 'head-of-design', cites: ['m3'], createdAt: NOW - min(18), status: 'done', commit: 'a1b2c3d4e5', updatedAt: NOW - min(4) }),
          task('t2', 'frontend-engineer', 'Slot picker', { cites: [] }),
        ],
        reports: [report('r1', 'ui-designer', 'head-of-design', 'Palette is darker. Buttons pass 4.5:1 now.', { cites: ['m1'], at: NOW - min(5) })],
        statuses: [{ person: 'ui-designer', text: 'Trying **espresso** brown', taskId: 't1', at: NOW - min(15), cites: ['m3'] }],
      },
      {
        decisions: [decision('d1', 'head-of-design', 'decide', 'Ada chose espresso brown over charcoal.', { at: NOW - min(16), links: { message: 'm2' } })],
        plan: { versions: [planVersion(2, 'ceo', { at: NOW - min(27), note: 'Adds the palette work to design', cites: ['m1'] }), planVersion(1, 'ceo')], approved: null, comments: [], waiting: null },
      },
    );
    expect(traceOf(view, 'm1', NOW).cites).toEqual([
      { kind: 'plan', id: '2', by: 'ceo', at: NOW - min(27), text: 'The CEO wrote version 2 of the plan: Adds the palette work to design.' },
      { kind: 'task', id: 't1', by: 'head-of-design', at: NOW - min(18), text: 'Ada assigned Mina: Darker palette across the site.' },
      { kind: 'decision', id: 'd1', by: 'head-of-design', at: NOW - min(16), text: 'Ada chose espresso brown over charcoal.' },
      { kind: 'status', id: `ui-designer@${NOW - min(15)}`, by: 'ui-designer', at: NOW - min(15), text: 'Mina: Trying espresso brown.' },
      { kind: 'report', id: 'r1', by: 'ui-designer', at: NOW - min(5), text: 'Mina reported to Ada: Palette is darker.' },
      { kind: 'commit', id: 'a1b2c3d4e5', by: 'ui-designer', at: NOW - min(4), text: 'Mina committed a1b2c3d: Darker palette across the site.' },
    ]);
  });

  it('says what the latest change to a citing task was', () => {
    const tasks = [
      task('t1', 'frontend-engineer', 'Cart summary', { cites: ['m1'], cancel: { at: NOW - min(3), by: STAKEHOLDER, reason: 'Cards wait for launch', branch: 'worklings/cart' } }),
      task('t2', 'frontend-engineer', 'Slot picker', { cites: ['m1'], paused: { at: NOW - min(2), by: 'frontend-lead' } }),
      task('t3', 'ui-designer', 'Menu icons', { cites: ['m1'], handovers: [{ at: NOW - min(1), by: 'head-of-design', from: 'ui-designer', to: 'head-of-design', note: 'I will finish them.' }] }),
    ];
    const texts = traceOf(steered({ messages: relayed(), tasks }), 'm1', NOW).cites.map((c) => c.text);
    expect(texts).toEqual(['You cancelled “Cart summary”: Cards wait for launch.', 'Ola paused “Slot picker”.', 'Ada handed “Menu icons” from Mina to Ada.']);
  });

  it('counts what cites a follow-up of the message', () => {
    const messages = [...relayed(), message('m9', STAKEHOLDER, 'head-of-design', 'A reminder about the palette.', { cites: ['m1'], at: NOW - min(2) })];
    const view = steered({ messages, reports: [report('r2', 'head-of-design', 'ceo', 'Done, the palette is darker.', { cites: ['m9'], at: NOW - min(1) })] });
    expect(familyOf(view.messages, 'm1').followUps.map((m) => m.id)).toEqual(['m9']);
    expect(traceOf(view, 'm1', NOW).cites.map((c) => c.id)).toEqual(['r2']);
  });
});

describe('where it stalls', () => {
  it('flags a copy that has not been delivered, saying why from their desk', () => {
    const view = update(steered({ messages: relayed({ delivered: false }) }, { acks: ['ceo', 'head-of-design'].map((by, i) => ack(`k${i}`, 'm1', by, 'On it.')) }), 'ui-designer', { desk: desk('waiting', { queue: 2 }) });
    expect(traceOf(view, 'm1', NOW).flags).toEqual([
      { kind: 'not-delivered', person: 'ui-designer', holder: 'ui-designer', since: NOW - min(20), sentence: 'Not delivered to Mina yet: Mina waits for a desk.' },
    ]);
    const working = update(view, 'ui-designer', { desk: desk('working') });
    expect(traceOf(working, 'm1', NOW).flags[0]?.sentence).toBe("Not delivered to Mina yet: it waits for Mina's next step.");
    const paused = { ...working, pause: { reason: 'stakeholder' as const, since: NOW - min(30), until: null, message: 'You paused work.' } };
    expect(traceOf(paused, 'm1', NOW).flags[0]?.sentence).toBe('Not delivered to Mina yet: work is paused.');
  });

  it('flags someone who has not acknowledged it once the window has passed, and not before', () => {
    const sent = (deliveredAgo: number) => [message('m1', STAKEHOLDER, 'frontend-engineer', 'One thumb, please.', { at: NOW - deliveredAgo - min(1), deliveredAt: NOW - deliveredAgo })];
    expect(traceOf(steered({ messages: sent(ACK_WINDOW_MS - 1) }), 'm1', NOW).flags).toEqual([]);
    expect(traceOf(steered({ messages: sent(ACK_WINDOW_MS) }), 'm1', NOW).flags).toEqual([
      { kind: 'no-ack', person: 'frontend-engineer', holder: 'frontend-engineer', since: NOW - ACK_WINDOW_MS, sentence: "Kai hasn't acknowledged it yet." },
    ]);
    const acked = steered({ messages: sent(ACK_WINDOW_MS * 3) }, { acks: [ack('k1', 'm1', 'frontend-engineer', 'Making the slots bigger.')] });
    expect(traceOf(acked, 'm1', NOW).flags).toEqual([]);
  });

  it("flags a manager who got it on their own and neither passed it on nor acknowledged it", () => {
    const messages = [message('m1', STAKEHOLDER, 'head-of-design', 'Darker, please.', { at: NOW - min(20), deliveredAt: NOW - min(19) })];
    expect(traceOf(steered({ messages }), 'm1', NOW).flags).toEqual([
      { kind: 'not-passed-on', person: 'head-of-design', holder: 'head-of-design', since: NOW - min(19), sentence: "Ada hasn't passed it on or acknowledged it yet." },
    ]);
    // Passed on: only the acknowledgement is missing.
    const passed = [...messages, message('m2', 'head-of-design', 'ui-designer', 'Darker, please.', { at: NOW - min(15), deliveredAt: NOW - min(14), origin: STAKEHOLDER, relayOf: 'm1' })];
    expect(traceOf(steered({ messages: passed }), 'm1', NOW).flags.map((f) => [f.kind, f.person])).toEqual([
      ['no-ack', 'head-of-design'],
      ['no-ack', 'ui-designer'],
    ]);
  });

  it("doesn't ask a manager to pass on what their whole room got", () => {
    const room = audience('room', 'design', 'the design room', 'g-1');
    const messages = [copy('m1', 'head-of-design', 'Darker.', room, { at: NOW - min(20), deliveredAt: NOW - min(19) })];
    expect(traceOf(steered({ messages }), 'm1', NOW).flags.map((f) => f.kind)).toEqual(['no-ack']);
  });

  it('flags someone the message is for that it has not reached, held by their nearest manager who has it', () => {
    const messages = relayed().slice(0, 2);
    const view = steered({ messages }, { acks: [ack('k1', 'm1', 'ceo', 'Passing it on.'), ack('k2', 'm2', 'head-of-design', 'Will tell Mina.')] });
    expect(traceOf(view, 'm1', NOW).flags).toEqual([
      { kind: 'not-reached', person: 'ui-designer', holder: 'head-of-design', since: NOW - min(30), sentence: 'Not passed on to Mina yet.' },
    ]);
  });

  it('holds it at whoever got it when no manager of theirs has it', () => {
    const messages = [message('m1', STAKEHOLDER, 'frontend-engineer', 'Tell Mina the slot picker needs her colours.', { at: NOW - min(30), deliveredAt: NOW - min(29), for: ['ui-designer'] })];
    const view = steered({ messages }, { acks: [ack('k1', 'm1', 'frontend-engineer', 'Will do.')] });
    expect(traceOf(view, 'm1', NOW).flags.map((f) => [f.kind, f.person, f.holder])).toEqual([['not-reached', 'ui-designer', 'frontend-engineer']]);
  });

  it('flags nobody who has left the company', () => {
    const messages = [message('m1', STAKEHOLDER, 'seo-specialist', 'Hold the meta tags.', { at: NOW - min(30), for: ['brand-designer'] })];
    const trace = traceOf(steered({ messages }), 'm1', NOW);
    expect(trace.stops.map((s) => s.person)).toEqual(['seo-specialist']);
    expect(trace.flags).toEqual([]);
  });

  it('flags each person once, oldest first', () => {
    const room = audience('everyone', null, 'everyone', 'g-2');
    const messages = [
      copy('m1', 'frontend-engineer', 'Launch is Monday.', room, { at: NOW - min(40), deliveredAt: NOW - min(39) }),
      copy('m2', 'ui-designer', 'Launch is Monday.', room, { at: NOW - min(40) }),
      message('m3', 'frontend-lead', 'frontend-engineer', 'Launch is Monday.', { at: NOW - min(35), relayOf: 'm1', origin: STAKEHOLDER }),
    ];
    // Kai has a delivered copy and a relay still on its way: he is reached, and flagged once for the acknowledgement.
    const flags = traceOf(steered({ messages }), 'g-2', NOW).flags;
    expect(flags.map((f) => [f.kind, f.person, f.since])).toEqual([
      ['not-delivered', 'ui-designer', NOW - min(40)],
      ['no-ack', 'frontend-engineer', NOW - min(39)],
    ]);
  });
});

describe("a message's family", () => {
  it('stops climbing at a loop of relays instead of going round it', () => {
    const messages = [
      message('a', 'head-of-design', 'ui-designer', 'x', { relayOf: 'b' }),
      message('b', 'ui-designer', 'head-of-design', 'x', { relayOf: 'a' }),
    ];
    const family = familyOf(messages, 'a');
    expect([...family.ids].sort()).toEqual(['a', 'b']);
  });
});
