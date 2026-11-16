import { describe, expect, it } from 'vitest';
import { STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import {
  answerSentence,
  boxCount,
  boxHint,
  boxLabel,
  canStop,
  contextLine,
  deliveryLine,
  emptyThread,
  folderOf,
  latestReportOf,
  noFiguresLine,
  noSessionLine,
  othersOf,
  type Outgoing,
  pendingSends,
  resumeCommand,
  roleLine,
  statusOf,
  threadOf,
} from '../web/src/company/person/personModel.ts';
import { whenAt } from '../web/src/lib/format.ts';
import { company, desk, message, min, NOW, question, report, sec, snapshotOf, studio, task, update } from './panels-work-kit.ts';

const who = (c: ReturnType<typeof company>, id: string) => c.people.find((p) => p.id === id)!;

describe('the lines under the name', () => {
  it('says their title, room and manager, and that the CEO reports to you', () => {
    const c = company();
    expect(roleLine({ studio }, c, who(c, 'frontend-engineer'))).toEqual({ title: 'Frontend engineer', room: 'Engineering', manager: { id: 'frontend-lead', name: 'Ola' } });
    expect(roleLine({ studio }, c, who(c, 'ceo')).manager).toBe('you');
  });

  it('gives the status line its age and the latest report whole', () => {
    const c = update(company({ reports: [report('r1', 'frontend-engineer', 'frontend-lead', 'Old.', { at: NOW - min(50) }), report('r2', 'frontend-engineer', 'frontend-lead', 'Card renders.\nWired to the store.', { at: NOW - min(5) })] }), 'frontend-engineer', {
      status: { person: 'frontend-engineer', text: 'Wiring the slot picker', taskId: null, at: NOW - min(31) },
    });
    expect(statusOf(who(c, 'frontend-engineer'), NOW)).toEqual({ text: 'Wiring the slot picker.', age: '31 min ago.' });
    expect(latestReportOf(c, 'frontend-engineer', NOW)).toEqual({ label: `Latest report ${whenAt(NOW - min(5), NOW)}:`, text: 'Card renders.\nWired to the store.' });
    expect(latestReportOf(c, 'ui-designer')).toBeNull();
  });

  it('offers Stop only while they work', () => {
    const c = company();
    expect(canStop({ ...who(c, 'frontend-engineer'), desk: desk('working') })).toBe(true);
    expect(canStop({ ...who(c, 'frontend-engineer'), desk: desk('idle') })).toBe(false);
  });
});

describe('what the office told them', () => {
  const told = (text: string, to = 'ceo') => {
    const c = company({ messages: [message('m1', THE_OFFICE, to, text, { at: NOW - min(5) })] });
    return threadOf(c, who(c, to)).filter((e) => e.kind === 'office');
  };

  it('shows a briefing as one line about the office, with the full words kept for a disclosure', () => {
    const opening = 'You are founding a new company, and its first task is the org. The stakeholder asked for this: > A plant app \n\nFirst set the goal with set_goal, then assign.';
    const [entry] = told(opening);
    expect(entry).toMatchObject({ kind: 'office', text: 'The office briefed the CEO on your prompt.' });
    expect(entry?.kind === 'office' && entry.full).toContain('set_goal');
    expect(told('Grace started the company. Everyone in the proposal is hired; nobody costs anything until they have work. First set the goal with set_goal.')[0]).toMatchObject({ text: 'The office told the CEO the company has started.' });
    expect(told('Grace edited your proposal: added a copywriter. Build on this version if you revise it.')[0]).toMatchObject({ text: 'The office told the CEO you changed the proposal.' });
    expect(told("You're back at your desk in the office. Carry on with \"Pickup\".", 'frontend-engineer')[0]).toMatchObject({ text: 'The office put Kai back at their desk.' });
  });

  it('keeps a short note as it is, with nothing to disclose, and cuts a long unknown one with the rest under it', () => {
    expect(told('Kai was fired.')[0]).toMatchObject({ text: 'Kai was fired.', full: null });
    const long = `${'The build is slow today. '.repeat(30)}End.`;
    const [entry] = told(long);
    expect(entry?.kind === 'office' && entry.text.length).toBeLessThan(long.length);
    expect(entry?.kind === 'office' && entry.full).toContain('End.');
  });
});

describe('when there are no figures or session to show', () => {
  it('says so only for someone who really hasn’t worked', () => {
    const c = company();
    const kai = who(c, 'frontend-engineer');
    expect(noFiguresLine({ ...kai, desk: desk('closed') })).toBe("Kai hasn't worked yet, so there are no figures.");
    expect(noFiguresLine({ ...kai, desk: desk('waiting') })).toBe("Kai hasn't worked yet, so there are no figures.");
    expect(noFiguresLine({ ...kai, desk: desk('working') })).toBe("Kai's figures haven't come in yet. They show here once the first step has finished.");
    expect(noFiguresLine({ ...kai, desk: desk('closed', { sessionId: 's1' }) })).toContain("haven't come in yet");
    expect(noSessionLine({ ...kai, desk: desk('closed') })).toBe("Kai hasn't worked yet, so there's no session to open.");
    expect(noSessionLine({ ...kai, desk: desk('working') })).toBe("Kai's session isn't ready to open yet. Try again in a moment.");
  });
});

describe('the thread', () => {
  it('shows your words, theirs, and the office’s lines about them, oldest first', () => {
    const c = company({
      messages: [
        message('m1', STAKEHOLDER, 'frontend-engineer', 'Make it work with one thumb.', { at: NOW - min(40), deliveredAt: NOW - min(39) }),
        message('m2', 'frontend-lead', 'frontend-engineer', 'Slot picker first.', { at: NOW - min(38) }),
        message('m3', 'frontend-engineer', STAKEHOLDER, 'Done: one row of big buttons.', { at: NOW - min(25) }),
      ],
      tasks: [task('t1', 'frontend-engineer', 'Pickup slot picker', { askedBy: 'frontend-lead', createdAt: NOW - min(60) })],
      reports: [report('r1', 'frontend-engineer', 'frontend-lead', 'Order status page is done: it checks every 10 s.', { at: NOW - min(30) })],
      log: [{ at: NOW - min(20), kind: 'restart', by: THE_OFFICE, text: 'The company was restarted.' }],
    });
    expect(threadOf(c, who(c, 'frontend-engineer')).map((e) => [e.kind, e.text])).toEqual([
      ['office', 'Ola assigned Kai: Pickup slot picker.'],
      ['mine', 'Make it work with one thumb.'],
      ['office', 'Kai reported to Ola: Order status page is done: it checks every 10 s.'],
      ['theirs', 'Done: one row of big buttons.'],
      ['office', 'The company was restarted.'],
    ]);
    expect(threadOf(c, who(c, 'frontend-engineer')).find((e) => e.kind === 'office' && e.text.startsWith('Kai reported'))).toMatchObject({ check: true });
  });

  it('shows your words passed on, the way they came and the passer’s own note', () => {
    const c = company({
      messages: [
        message('m5', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(14), deliveredAt: NOW - min(13) }),
        message('m6', 'ceo', 'head-of-design', 'Alex wants a darker palette. Take it through design.', { at: NOW - min(12), origin: STAKEHOLDER, relayOf: 'm5' }),
        // Relays may name the first message rather than the one before them.
        message('m7', 'head-of-design', 'ui-designer', 'Try a deeper espresso brown.', { at: NOW - min(10), origin: STAKEHOLDER, relayOf: 'm5' }),
      ],
    });
    const mina = threadOf(c, who(c, 'ui-designer'));
    expect(mina).toEqual([
      {
        kind: 'passed',
        id: 'm7',
        at: NOW - min(10),
        text: 'Make the palette darker.',
        passer: 'head-of-design',
        heading: 'Ada passed on your message',
        through: 'From you, through the CEO and Ada.',
        note: 'Try a deeper espresso brown.',
      },
    ]);
    const ceo = threadOf(c, who(c, 'ceo'));
    expect(ceo.map((e) => [e.kind, e.text])).toEqual([
      ['mine', 'Make the palette darker.'],
      ['office', 'The CEO passed it on to Ada, head of design.'],
    ]);
    expect(threadOf(c, who(c, 'head-of-design'))[0]).toMatchObject({ kind: 'passed', heading: 'The CEO passed on your message', through: 'From you, through the CEO.' });
  });

  it('shows the note a relayer added, with your words in the bubble', () => {
    const c = company({
      messages: [
        message('m5', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(14) }),
        message('m6', 'ceo', 'head-of-design', 'Make the palette darker.', { at: NOW - min(12), origin: STAKEHOLDER, relayOf: 'm5', note: 'Start with the menu page.' }),
      ],
    });
    expect(threadOf(c, who(c, 'head-of-design'))[0]).toMatchObject({ kind: 'passed', text: 'Make the palette darker.', note: 'Start with the menu page.' });
  });

  it('shows your answer to their question as an answer, not the words it travelled in', () => {
    const q = question('q3', 'ui-designer', 'Pickup slots: should guests pick from 15-minute or 30-minute windows? Shorter windows spread the rush.', ['15-minute windows', '30-minute windows'], {
      answer: { option: 0, text: '15-minute windows', at: NOW - min(3), appliesAt: NOW - min(3) + sec(5) },
    });
    const carried = message('m9', STAKEHOLDER, 'ui-designer', `on "${q.text}": 15-minute windows.`, { at: NOW - min(3), answers: 'q3', deliveredAt: NOW - min(2) });
    const c = company({ questions: [q], messages: [carried] });
    expect(threadOf(c, who(c, 'ui-designer'), NOW)).toEqual([
      {
        kind: 'answer',
        id: 'm9',
        at: NOW - min(3),
        // The question is cut at a word within 60 characters.
        text: 'You answered “Pickup slots: should guests pick from 15-minute or…”: 15-minute windows.',
        delivery: `Delivered ${whenAt(NOW - min(2), NOW)}.`,
      },
    ]);
  });

  it('words an answer in your own words, and one whose question left the view from the message itself', () => {
    const q = question('q4', 'ceo', 'Cards too?', ['TWINT only', 'TWINT and cards'], { answer: { option: null, text: 'TWINT only for the launch.', at: NOW, appliesAt: NOW } });
    expect(answerSentence({ questions: [q] }, { answers: 'q4', text: 'on "Cards too?": TWINT only for the launch.' })).toBe('You answered “Cards too?”: TWINT only for the launch.');
    expect(answerSentence({ questions: [] }, { answers: 'q-gone', text: 'on "Which font?": Barlow.' })).toBe('You answered “Which font?”: Barlow.');
    expect(answerSentence({ questions: [] }, { answers: null, text: 'Hello' })).toBeNull();
    expect(answerSentence({ questions: [] }, { text: 'Hello' })).toBeNull();
  });

  it('says a report to you once when it also came as a message', () => {
    const c = company({
      messages: [message('m1', 'ceo', STAKEHOLDER, 'Menu pages are live.', { at: NOW - min(180) })],
      reports: [report('r1', 'ceo', STAKEHOLDER, 'Menu pages are live.', { at: NOW - min(180) }), report('r2', 'ceo', STAKEHOLDER, 'Pickup is next.', { at: NOW - min(100) })],
    });
    expect(threadOf(c, who(c, 'ceo')).map((e) => [e.kind, e.text])).toEqual([
      ['theirs', 'Menu pages are live.'],
      ['theirs', 'Pickup is next.'],
    ]);
  });

  it('says what each of your messages waits for until it is delivered', () => {
    const m = message('m1', STAKEHOLDER, 'frontend-engineer', 'Hi');
    const c = company();
    const kai = who(c, 'frontend-engineer');
    expect(deliveryLine(m, c, { ...kai, desk: desk('working') })).toEqual({ text: "Waits for Kai's next step.", unsend: true });
    expect(deliveryLine(m, c, { ...kai, desk: desk('waiting', { queue: 2 }) }).text).toBe('Waits for a desk, second in line.');
    expect(deliveryLine(m, c, { ...kai, desk: desk('away') }).text).toBe('Waits until you bring Kai back.');
    expect(deliveryLine(m, { ...c, pause: { reason: 'usage-limit', since: NOW, until: NOW + min(60), message: '' } }, kai, NOW).text).toBe(`Waits until the company wakes ${whenAt(NOW + min(60), NOW)}.`);
    expect(deliveryLine({ ...m, deliveredAt: NOW - min(1) }, c, kai, NOW)).toEqual({ text: `Delivered ${whenAt(NOW - min(1), NOW)}.`, unsend: false });
    expect(deliveryLine({ ...m, deliveredAt: NOW - min(1), interrupt: true }, c, kai, NOW).text).toBe(`Stopped Kai and delivered ${whenAt(NOW - min(1), NOW)}.`);
  });

  it('has a first line for an empty thread', () => {
    expect(emptyThread(who(company(), 'frontend-engineer'))).toBe('No messages yet. Kai reads what you send here at their next step.');
  });
});

describe('what you sent, until the snapshot has it', () => {
  const sending = (text: string, before: string[] = []): Outgoing => ({ id: 'out-1', text, state: 'sending', message: null, error: null, before: new Set(before) });

  it('shows a send on its way, and hides it once the snapshot has the message, even before the office answers', () => {
    const c = company({ messages: [message('m1', STAKEHOLDER, 'frontend-engineer', 'Earlier.', { at: NOW - min(5) })] });
    expect(pendingSends([sending('Add a loading state.', ['m1'])], c, 'frontend-engineer', new Set())).toHaveLength(1);
    const arrived = company({ messages: [...c.messages, message('m2', STAKEHOLDER, 'frontend-engineer', 'Add a loading state.', { at: NOW })] });
    expect(pendingSends([sending('Add a loading state.', ['m1'])], arrived, 'frontend-engineer', new Set())).toEqual([]);
  });

  it('keeps the same words sent before apart from this send', () => {
    const c = company({ messages: [message('m1', STAKEHOLDER, 'frontend-engineer', 'Thanks.', { at: NOW - min(5) })] });
    expect(pendingSends([sending('Thanks.', ['m1'])], c, 'frontend-engineer', new Set())).toHaveLength(1);
  });

  it('hides a sent one by its id once it arrives, and never brings back one you unsent', () => {
    const m = message('m2', STAKEHOLDER, 'frontend-engineer', 'Wait for Mina.', { at: NOW });
    const sent: Outgoing = { ...sending('Wait for Mina.'), state: 'sent', message: m };
    expect(pendingSends([sent], company(), 'frontend-engineer', new Set())).toHaveLength(1);
    expect(pendingSends([sent], company({ messages: [m] }), 'frontend-engineer', new Set())).toEqual([]);
    // Unsent: the office took it out of the snapshot, and the send must not stand in for it.
    expect(pendingSends([sent], company(), 'frontend-engineer', new Set(['m2']))).toEqual([]);
  });
});

describe('the box', () => {
  it('says what will happen to what you send', () => {
    const c = company();
    const kai = who(c, 'frontend-engineer');
    expect(boxHint(c, { ...kai, desk: desk('working') })).toBe('Kai reads it at their next step.');
    expect(boxHint(c, { ...kai, desk: desk('closed') })).toBe('Kai starts on it now.');
    expect(boxHint(c, { ...kai, desk: desk('waiting', { queue: 2 }) })).toBe('Kai gets it when a desk is free, second in line.');
    expect(boxHint(c, { ...kai, desk: desk('away') })).toBe('Kai is with you in Claude Code. It waits until you bring them back.');
    expect(boxHint({ ...c, pause: { reason: 'usage-limit', since: NOW, until: NOW + min(60), message: '' } }, kai, NOW)).toBe(`Kai reads it when the company wakes ${whenAt(NOW + min(60), NOW)}.`);
    expect(boxHint(c, who(c, 'head-of-design'))).toBe('Ada passes it on to whoever it concerns.');
    expect(boxHint(c, who(c, 'ceo'))).toBe('The CEO passes it on to whoever it concerns.');
  });

  it('becomes the stop box', () => {
    const kai = who(company(), 'frontend-engineer');
    expect(boxLabel(kai, false)).toBe('Message Kai');
    expect(boxLabel(kai, true)).toBe('Stop Kai and say what to do instead');
  });

  it('counts only near the limit, and says how much to cut when over it', () => {
    expect(boxCount('hello')).toEqual({ text: null, over: false });
    expect(boxCount('x'.repeat(3000))).toEqual({ text: '3,000 of 4,000', over: false });
    expect(boxCount('x'.repeat(4120))).toEqual({ text: '4,120 of 4,000. Shorten it by 120 to send.', over: true });
    // Counted as characters, not UTF-16 units.
    expect(boxCount('🌱'.repeat(4000)).over).toBe(false);
  });
});

describe('details', () => {
  it('says how much context is used, in words', () => {
    expect(contextLine(0.64)).toBe('Context used: 64%. Busy, with room to go.');
    expect(contextLine(0.92)).toBe('Context used: 92%. Soon they summarise their notes and may lose detail.');
    expect(contextLine(0.2)).toBe('Context used: 20%.');
    expect(contextLine(null)).toBeNull();
  });

  it('lists messages with colleagues, newest first, then counts the rest', () => {
    const c = company({
      messages: Array.from({ length: 23 }, (_, i) => message(`m${i}`, i % 2 ? 'frontend-lead' : 'frontend-engineer', i % 2 ? 'frontend-engineer' : 'frontend-lead', `Note ${i}`, { at: NOW - min(30 - i) })),
    });
    const others = othersOf(c, who(c, 'frontend-engineer'));
    expect(others.shown).toHaveLength(20);
    expect(others.more).toBe(3);
    expect(others.shown[0]).toMatchObject({ with: 'To Ola', text: 'Note 22' });
    expect(others.shown[1]).toMatchObject({ with: 'From Ola', text: 'Note 21' });
  });

  it('opens their session in their worktree when the task has one', () => {
    const c = update(company({ tasks: [task('t1', 'frontend-engineer', 'Pay', { worktree: { path: 'C:\\work\\twint', branch: 'worklings/twint' } })] }), 'frontend-engineer', { task: 't1' });
    const snap = snapshotOf(c);
    expect(folderOf(snap, c, who(c, 'frontend-engineer'))).toBe('C:\\work\\twint');
    expect(folderOf(snap, c, who(c, 'ui-designer'))).toBe('C:\\Users\\jamie\\plant-pal');
    expect(resumeCommand('3f2a1c')).toBe('claude --resume 3f2a1c');
  });
});
