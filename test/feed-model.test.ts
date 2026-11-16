import { describe, expect, it } from 'vitest';
import { type CompanyView, STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import { dayOf, type FeedLine, feedLines, foldBursts, type Seg } from '../web/src/company/feed/feedModel.ts';
import { ack, audience, copy, decision, planVersion, steered } from './panels-steering-kit.ts';
import { approval, desk, message, min, NOW, question, report, sec, studio, task, update } from './panels-work-kit.ts';

const snap = { studio };
const text = (segs: readonly Seg[]) => segs.map((s) => (typeof s === 'string' ? s : s.text)).join('');
const strip = (l: FeedLine | undefined) => (l ? `${l.lead ? `${l.lead} ` : ''}${l.words}` : null);
const byKind = (c: CompanyView, kind: FeedLine['kind']) => feedLines(snap, c, NOW).filter((l) => l.kind === kind);

describe('the lines the strip and the feed show', () => {
  it('says your message, once for a room however many copies it has', () => {
    const design = audience('room', 'design', 'the design room', 'g-1');
    const c = steered({
      messages: [
        message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(9) }),
        copy('m-2', 'head-of-design', 'Darker cards too.', design, { at: NOW - min(8) }),
        copy('m-3', 'ui-designer', 'Darker cards too.', design, { at: NOW - min(8) }),
      ],
    });
    const mine = byKind(c, 'yours');
    expect(mine.map(strip)).toEqual(['You to Noor: Make the palette darker.', 'You to the design room: Darker cards too.']);
    expect(mine.map((l) => text(l.sentence))).toEqual(['You wrote to Noor, CEO', 'You wrote to the design room']);
    expect(mine[1]).toMatchObject({ id: 'm:g-1', yours: true, link: { path: 'messages/g-1', label: 'Where it went' } });
  });

  it('tells a reply to one of your messages from someone writing to you', () => {
    const c = steered({
      messages: [
        message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(9) }),
        message('m-2', 'ceo', STAKEHOLDER, 'Done, the menu uses the darker tokens.', { at: NOW - min(5), cites: ['m-1'] }),
        message('m-3', 'head-of-design', STAKEHOLDER, 'The cards are next.', { at: NOW - min(4) }),
      ],
    });
    const replies = byKind(c, 'reply');
    expect(replies.map(strip)).toEqual(['Noor to you: Done, the menu uses the darker tokens.', 'Ada to you: The cards are next.']);
    expect(replies.map((l) => text(l.sentence))).toEqual(['Noor replied', 'Ada wrote to you']);
    // Names open the person.
    expect(replies[1]?.sentence[0]).toEqual({ person: 'head-of-design', text: 'Ada' });
  });

  it('says your words passed on with the note, or the words themselves in quotes, with the paper mark', () => {
    const c = steered({
      messages: [
        message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(9) }),
        message('m-2', 'ceo', 'head-of-design', 'Make the palette darker.', { at: NOW - min(8), relayOf: 'm-1', origin: STAKEHOLDER, note: 'Darker palette for the menu, and Mina’s tokens.' }),
        message('m-3', 'head-of-design', 'ui-designer', 'Make the palette darker.', { at: NOW - min(7), relayOf: 'm-2', origin: STAKEHOLDER }),
      ],
    });
    const passed = byKind(c, 'passed');
    expect(passed.map(strip)).toEqual(['Noor to Ada: Darker palette for the menu, and Mina’s tokens.', 'Ada to Mina: “Make the palette darker.”']);
    expect(passed.map((l) => text(l.sentence))).toEqual(['Noor passed your message on to Ada, head of design', 'Ada passed it on to Mina, UI designer']);
    expect(passed.every((l) => l.yours && l.about === 'm-1')).toBe(true);
  });

  it('says who acknowledged your message and who disagrees', () => {
    const c = steered(
      { messages: [message('m-1', STAKEHOLDER, 'ui-designer', 'Make the palette darker.', { at: NOW - min(9) })] },
      { acks: [ack('k-1', 'm-1', 'ui-designer', 'Darkening the tokens now.', { at: NOW - min(6) }), ack('k-2', 'm-1', 'head-of-design', 'The SEO copy needs the old colours.', { at: NOW - min(5), agree: false })] },
    );
    expect(feedLines(snap, c, NOW).filter((l) => l.kind === 'ack' || l.kind === 'disagree').map(strip)).toEqual(['Mina acknowledged: Darkening the tokens now.', 'Ada disagrees: The SEO copy needs the old colours.']);
    expect(byKind(c, 'disagree').map((l) => text(l.sentence))).toEqual(['Ada disagrees with your message']);
  });

  it('puts what needs you on the highlighter while it waits, with Answer', () => {
    const c = steered({
      questions: [question('q-1', 'ui-designer', '15-minute or 30-minute windows?', ['15', '30'])],
      approvals: [approval('a-1', 'frontend-engineer', 'Push the work branch to GitHub')],
    });
    const lines = feedLines(snap, c, NOW);
    expect(lines.filter((l) => l.tone === 'needs').map(strip)).toEqual(['Kai needs your OK: push the work branch to GitHub', 'Mina asks you: 15-minute or 30-minute windows?']);
    expect(lines.find((l) => l.kind === 'asks')).toMatchObject({ link: { path: 'inbox#q-1', label: 'Answer' } });
    expect(text(lines.find((l) => l.kind === 'approval')?.sentence ?? [])).toBe('Kai, frontend engineer, wants your OK');
    expect(text(lines.find((l) => l.kind === 'asks')?.sentence ?? [])).toBe('Mina, UI designer, asks you');
  });

  it("says the CEO's plan waits for your approval", () => {
    const c = steered({}, { plan: { versions: [planVersion(3, 'ceo')], approved: null, comments: [], waiting: null } });
    const [plan] = byKind(c, 'plan');
    expect(strip(plan)).toBe('Noor: the plan waits for your OK');
    expect(plan && text(plan.sentence)).toBe("The CEO's plan, version 3, waits for your approval");
    expect(plan).toMatchObject({ tone: 'needs', link: { path: 'plan/v3', label: 'Open the plan' } });
  });

  it('says someone is stuck by the 30 s rule, in the danger tint', () => {
    const c = update(steered(), 'frontend-engineer', { desk: desk('failed', { since: NOW - min(2), problem: 'The TWINT sandbox turned down the test merchant ID.' }) });
    const [stuck] = byKind(c, 'stuck');
    expect(strip(stuck)).toBe('Kai is stuck: the TWINT sandbox turned down the test merchant ID');
    expect(stuck).toMatchObject({ tone: 'stuck', at: NOW - min(2) + sec(30) });
    expect(byKind(update(steered(), 'frontend-engineer', { desk: desk('failed', { since: NOW - sec(10) }) }), 'stuck')).toEqual([]);
  });

  it('says work and talk between people, and never the office’s own briefings', () => {
    const c = steered({
      messages: [message('m-1', 'head-of-engineering', 'frontend-engineer', 'Order API next, the slot picker needs it.'), message('m-2', THE_OFFICE, 'frontend-engineer', 'You are founding a new company…')],
      reports: [report('r-1', 'ui-designer', 'head-of-design', 'The German pastry descriptions are in.\nMore tomorrow.\nAnd a third line.')],
      tasks: [task('t-1', 'frontend-engineer', 'Build the slot picker')],
    });
    const lines = feedLines(snap, c, NOW);
    expect(lines.filter((l) => ['between', 'report', 'assigned'].includes(l.kind)).map(strip)).toEqual([
      'Ben assigned Kai: Build the slot picker.',
      'Mina reported to Ada: The German pastry descriptions are in. More tomorrow. And a third line.',
      'Ben to Kai: Order API next, the slot picker needs it.',
    ]);
    expect(lines.find((l) => l.kind === 'report')?.body).toBe('The German pastry descriptions are in.\nMore tomorrow.');
    expect(lines.some((l) => l.from === THE_OFFICE && l.kind === 'between')).toBe(false);
  });

  it('says decisions, yours and theirs, and the company’s log without saying one thing twice', () => {
    const c = steered(
      { log: [{ at: NOW - min(3), kind: 'milestone', by: 'ceo', text: 'Milestone done: Menu pages live.' }, { at: NOW - min(30), kind: 'hire', by: 'ceo', text: 'The CEO hired Lena, German copywriter.' }] },
      { decisions: [decision('d-1', 'head-of-engineering', 'decide', 'Checkout in three steps', { at: NOW - min(2), why: 'Fewer fields per page.' }), decision('d-2', STAKEHOLDER, 'task', 'You paused “Slot picker visuals”.', { at: NOW - min(1) }), decision('d-3', 'ceo', 'org', 'The CEO hired Lena.', { at: NOW - min(30) })] },
    );
    const lines = feedLines(snap, c, NOW);
    expect(lines.filter((l) => l.kind === 'decision' || l.kind === 'company').map(strip)).toEqual([
      'The CEO hired Lena.',
      'Milestone done: Menu pages live.',
      'Ben decided: Checkout in three steps.',
      'You paused “Slot picker visuals”.',
    ]);
  });

  it('says one answer once: its decision line, with the link, and not the message that carried it too', () => {
    const answered = question('q-1', 'ceo', 'Which payment should the app take?', ['Cash', 'Card'], { answer: { option: 1, text: '', at: NOW - min(1), appliesAt: NOW - min(1) } });
    const carried = message('m-9', STAKEHOLDER, 'ceo', 'Answer to “Which payment should the app take?”: Card.', { at: NOW - min(1), answers: 'q-1' });
    const kinds = (c: CompanyView) => feedLines(snap, c, NOW).map((l) => `${l.kind}: ${l.words}`);
    const withDecision = steered({ questions: [answered], messages: [carried] }, { decisions: [decision('d-9', STAKEHOLDER, 'answer', 'You answered Noor: Card.', { at: NOW - min(1), links: { question: 'q-1' } })] });
    expect(kinds(withDecision).filter((k) => k.includes('Card'))).toEqual(['decision: You answered Noor: Card.']);
    expect(feedLines(snap, withDecision, NOW).find((l) => l.kind === 'decision')?.link?.label).toBe('Open the decision');
    // With no decision in the view, the message is the only place the answer is said, so it stays.
    expect(kinds(steered({ questions: [answered], messages: [carried] })).some((k) => k.startsWith('yours: You answered'))).toBe(true);
  });

  it("says when your message hasn't reached someone yet, and who has it", () => {
    // To Ada, for Mina: Ada has had it for 20 minutes and hasn't passed it on.
    const c = steered({ messages: [message('m-1', STAKEHOLDER, 'head-of-design', 'Make the palette darker.', { at: NOW - min(20), deliveredAt: NOW - min(19), for: ['ui-designer'] })] });
    const stalls = byKind(c, 'stall');
    expect(stalls.map(strip)).toContain("Your message hasn't reached Mina yet. Ada has it.");
    const toMina = stalls.find((l) => l.id === 'stall:m-1:ui-designer');
    expect(toMina && text(toMina.sentence)).toBe("Your message to Ada hasn't reached Mina yet.");
    expect(toMina).toMatchObject({ yours: true, body: '20 min. Ada has it.', link: { path: 'messages/m-1', label: 'Where it went' } });
  });

  it('says nothing of a message still on its way within five minutes', () => {
    const c = steered({ messages: [message('m-1', STAKEHOLDER, 'ui-designer', 'Make the palette darker.', { at: NOW - min(2) })] });
    expect(byKind(c, 'stall')).toEqual([]);
  });

  it('puts every line in time order', () => {
    const c = steered({ messages: [message('m-2', 'ceo', STAKEHOLDER, 'Later.', { at: NOW - min(1) }), message('m-1', STAKEHOLDER, 'ceo', 'Earlier.', { at: NOW - min(5), deliveredAt: NOW - min(4) })] });
    expect(feedLines(snap, c, NOW).map((l) => l.id)).toEqual(['m:m-1', 'm:m-2']);
  });
});

describe('bursts', () => {
  it('folds four or more acknowledgements of one message within a minute into one line that keeps its place', () => {
    const people = ['ceo', 'head-of-engineering', 'frontend-lead', 'frontend-engineer', 'head-of-design'];
    const c = steered(
      { messages: [message('m-1', STAKEHOLDER, 'ceo', 'All hands: we launch Friday.', { at: NOW - min(9) })] },
      { acks: people.map((p, i) => ack(`k-${i}`, 'm-1', p, 'Noted.', { at: NOW - min(5) + sec(i * 10) })) },
    );
    const folded = foldBursts(feedLines(snap, c, NOW));
    const burst = folded.find((l) => l.kind === 'burst');
    expect(burst).toMatchObject({ id: 'burst:ack:k-0', words: 'Five people acknowledged your message.', who: people });
    expect(folded.filter((l) => l.kind === 'ack')).toEqual([]);
  });

  it('leaves three, or acknowledgements far apart, as they are', () => {
    const c = steered(
      { messages: [message('m-1', STAKEHOLDER, 'ceo', 'Hello.', { at: NOW - min(30) })] },
      { acks: ['ceo', 'head-of-design', 'ui-designer', 'frontend-engineer'].map((p, i) => ack(`k-${i}`, 'm-1', p, 'Noted.', { at: NOW - min(20) + min(i * 2) })) },
    );
    expect(foldBursts(feedLines(snap, c, NOW)).filter((l) => l.kind === 'ack')).toHaveLength(4);
  });
});

describe('days', () => {
  it('heads each day: today, yesterday, then the date', () => {
    expect(dayOf(NOW - min(30), NOW)).toBe('Today');
    expect(dayOf(NOW - 24 * min(60), NOW)).toBe('Yesterday');
    expect(dayOf(new Date(2026, 10, 2, 9).getTime(), NOW)).toBe('Mon 2 Nov');
  });
});
