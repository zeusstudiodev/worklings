// The CEO's scoping questions (Robin, 12 Nov 2026): before it commits to an org, a CEO with a short or open prompt asks
// a few questions, each with its pick and why; the stakeholder answers them (or takes the picks with one press), and the
// answers reach the CEO together, in one message, so it drafts once from all of them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgRefusal, STAKEHOLDER, UNDO_MS } from '../src/core/company.ts';
import { presetGuidance } from '../src/core/presets.ts';
import { crashCopy, ended, proposal, rig } from './company-kit.ts';

function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

const QUESTIONS = [
  { text: 'Who is it for?', options: ['Just me', 'Anyone'], recommended: 1, why: 'Most tools like this are for other people too.' },
  { text: 'How far should the first version go?', options: ['A quick prototype', 'A solid first release'], recommended: 0, why: 'A prototype answers the big question soonest.' },
  { text: 'Where should it run?', options: ['On the web', 'On phones', 'Both'], recommended: 0, why: 'The web reaches every device with one build.' },
];

const founding = () => rig({ now: () => Date.now() });
/** What the CEO is told about the preset with the answers: Balanced, still only the default while "How thorough?" is open. */
const PRESET = presetGuidance('balanced', false);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-12T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the CEO's scoping questions", () => {
  it('wait in the inbox before the org, and their answers reach the CEO together in one message', async () => {
    const { company, desks } = await founding();
    const asked = company.askScoping('ceo', QUESTIONS);
    expect(asked.map((q) => [q.from, q.text, q.options, q.recommended, q.why])).toEqual(QUESTIONS.map((q) => ['ceo', q.text, q.options, q.recommended, q.why]));
    const ids = asked.map((q) => q.id);
    const view = company.view();
    expect(view.phase).toBe('founding');
    expect(view.scoping).toEqual({ questions: ids, askedAt: Date.now(), answeredAt: null });
    // The office's own "How thorough?" waits beside the CEO's three, and is no part of the round.
    expect(view.inbox).toBe(4);
    expect(view.log.at(-1)).toMatchObject({ kind: 'scoping', by: 'ceo', text: 'The CEO asked three questions to scope the company before drafting it.' });

    // A press and the stakeholder's own words apply after the undo window, but nothing reaches the CEO while one is open.
    const before = desks().textsFor('ceo').length;
    company.answer(ids[0] ?? '', { option: 0, text: '' });
    company.answer(ids[1] ?? '', { option: null, text: 'Something I can show friends next week.' });
    vi.advanceTimersByTime(UNDO_MS);
    expect(desks().textsFor('ceo')).toHaveLength(before);
    expect(company.view().scoping?.answeredAt).toBeNull();

    // "Use the CEO's picks" answers the one still open, with its own undo window.
    const picked = company.answerWithPicks();
    expect(picked.map((q) => [q.id, q.answer?.option, q.answer?.appliesAt])).toEqual([[ids[2], 0, Date.now() + UNDO_MS]]);
    vi.advanceTimersByTime(UNDO_MS);
    const texts = desks().textsFor('ceo');
    expect(texts).toHaveLength(before + 1);
    expect(texts.at(-1)).toBe(
      [
        'From Robin, the stakeholder: Answers to your scoping questions:',
        '1. Who is it for?',
        '   Just me.',
        '2. How far should the first version go?',
        '   In their own words: Something I can show friends next week.',
        '3. Where should it run?',
        '   On the web (your pick).',
        ...PRESET,
        'Now draft the org from these answers, sized to the goal they describe and to the preset above.',
      ].join('\n'),
    );
    const after = company.view();
    expect(after.scoping).toEqual({ questions: ids, askedAt: view.scoping?.askedAt, answeredAt: Date.now() });
    // The office wrote it from the inbox's answers, as every inbox answer is: never a message anyone may cite as the
    // stakeholder's word, and no message of its own per answer.
    expect(after.messages.at(-1)).toMatchObject({ from: STAKEHOLDER, to: 'ceo', fromOffice: true });
    expect(after.messages.at(-1)?.typed).toBeUndefined();
    expect(after.messages.filter((m) => ids.includes(m.answers ?? ''))).toEqual([]);
    expect(after.log.at(-1)).toMatchObject({ kind: 'scoping', by: STAKEHOLDER, text: "You answered the CEO's three questions; it drafts the org from your answers." });
    expect(after.inbox).toBe(1);
    // The answers are decisions in the log, as any answer is.
    expect(after.steering?.decisions.filter((d) => d.kind === 'answer')).toHaveLength(3);

    // The CEO drafts once, from all of them: a small org is the CEO's call.
    const small = company.proposeOrg('ceo', proposal({ people: proposal().people.slice(0, 2) }));
    expect(small.ok && small.proposal.people).toHaveLength(2);
    expect(company.view().phase).toBe('proposed');
  });

  it('are the CEO’s alone, asked once, while founding', async () => {
    const { company } = await founding();
    expect(refusal(() => company.askScoping('head-of-design', QUESTIONS)).message).toBe('Only the CEO can ask scoping questions.');
    expect(refusal(() => company.askScoping('ceo', [])).message).toBe('The questions need changes:\n- questions: expected 1 to 5 questions, got 0');
    expect(refusal(() => company.askScoping('ceo', [{ ...QUESTIONS[0], why: '' }])).message).toBe('The questions need changes:\n- questions[0].why: expected a line on why you pick it as text, got ""');
    expect(company.view().scoping).toBeNull();
    const asked = company.askScoping('ceo', QUESTIONS.slice(0, 1));
    expect(refusal(() => company.askScoping('ceo', QUESTIONS))).toMatchObject({ code: 'conflict', message: 'Your scoping questions are with the stakeholder. Their answers come to you in one message; wait for it.' });
    company.answer(asked[0]?.id ?? '', { option: 1, text: '' });
    vi.advanceTimersByTime(UNDO_MS);
    expect(refusal(() => company.askScoping('ceo', QUESTIONS)).message).toBe(
      'You scoped the company already. Draft the org from the answers with propose_org, and put anything still open in its questions.',
    );
    expect(refusal(() => company.answerWithPicks())).toMatchObject({ code: 'conflict', message: 'There are no open questions from the CEO to answer with its picks.' });
    company.proposeOrg('ceo', proposal());
    expect(refusal(() => company.askScoping('ceo', QUESTIONS)).message).toBe(
      'The proposal is out already: put what you still need to know in its questions, and revise it with propose_org.',
    );
  });

  it('give way to a CEO that drafts early: the open ones keep its picks, and answers given still reach it', async () => {
    const { company, desks } = await founding();
    const asked = company.askScoping('ceo', QUESTIONS);
    company.answer(asked[0]?.id ?? '', { option: 0, text: '' });
    // The stakeholder wrote to the CEO instead, and it drafted before the answer applied.
    expect(company.proposeOrg('ceo', proposal()).ok).toBe(true);
    const view = company.view();
    expect(view.questions.filter((q) => asked.some((a) => a.id === q.id)).map((q) => q.withdrawn?.reason ?? null)).toEqual([
      null,
      "The CEO drafted the org before this was answered, so its pick stands; tell the CEO if it matters.",
      "The CEO drafted the org before this was answered, so its pick stands; tell the CEO if it matters.",
    ]);
    const before = desks().textsFor('ceo').length;
    vi.advanceTimersByTime(UNDO_MS);
    expect(desks().textsFor('ceo').slice(before)).toEqual([
      [
        'From Robin, the stakeholder: Answers to your scoping questions:',
        '1. Who is it for?',
        '   Just me.',
        'Two were withdrawn before an answer, so your pick stands there.',
        ...PRESET,
        'Now draft the org from these answers, sized to the goal they describe and to the preset above.',
      ].join('\n'),
    ]);
  });

  it('are taken back when the stakeholder stops the CEO, and nothing goes to it', async () => {
    const { company, desks } = await founding();
    const asked = company.askScoping('ceo', QUESTIONS);
    company.answer(asked[0]?.id ?? '', { option: 1, text: '' });
    company.stop('ceo', '');
    const before = desks().textsFor('ceo').length;
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(desks().textsFor('ceo')).toHaveLength(before);
    expect(company.view().questions.filter((q) => q.withdrawn !== null)).toHaveLength(3);
    expect(company.view().scoping?.answeredAt).toBeNull();
    expect(company.view().inbox).toBe(1);
    // Told to draft again, the CEO may ask afresh: the round it asks replaces the one taken back.
    const again = company.askScoping('ceo', QUESTIONS.slice(0, 2));
    expect(company.view().scoping?.questions).toEqual(again.map((q) => q.id));
    expect(company.view().inbox).toBe(3);
  });

  it('survive a restart: the round, the whys, and answers still inside their undo window', async () => {
    const r = await founding();
    const asked = r.company.askScoping('ceo', QUESTIONS);
    r.company.answerWithPicks();
    // The CEO's turn ended after asking: it waits for the answers, saying so.
    r.desks().events.turn('ceo', ended('I asked three questions before drafting.'));
    const again = r.reopen(crashCopy(r.root));
    const view = again.view();
    expect(view.scoping).toEqual({ questions: asked.map((q) => q.id), askedAt: expect.any(Number), answeredAt: null });
    expect(view.questions.filter((q) => !q.preset).map((q) => q.why)).toEqual(QUESTIONS.map((q) => q.why));
    vi.advanceTimersByTime(UNDO_MS);
    expect(again.view().scoping?.answeredAt).toBe(Date.now());
    expect(again.view().messages.at(-1)?.text).toMatch(/^Answers to your scoping questions:\n1\. Who is it for\?\n {3}Anyone \(your pick\)\./);
    await again.close();
  });
});
