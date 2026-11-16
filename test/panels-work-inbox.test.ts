import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Question, STAKEHOLDER, THE_OFFICE, UNDO_MS } from '../src/core/company.ts';
import {
  answeredLine,
  appliedAnnouncement,
  approvalLines,
  askerCalled,
  conversationsOf,
  conversationsTitle,
  inboxView,
  type Item,
  itemPerson,
  itemView,
  messageLabel,
  needsYouLine,
  pressAnnouncement,
  type Press,
  questionLines,
  refusalLine,
  undoUntil,
} from '../web/src/company/inbox/inboxModel.ts';
import { officeNow } from '../web/src/company/people/clock.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { approval, company, message, min, NOW, question, report, sec, task } from './panels-work-kit.ts';

// Times beside facts carry their day when it isn't today: the suite's clock sits on the day of its fixtures.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const ctx = { now: NOW, openedAt: NOW - min(1), skew: 0 };
const press = (answer: Press['answer'], state: Press['state'], extra: Partial<Press> = {}): Press => ({ answer, state, at: NOW - sec(1), error: null, undid: null, ...extra });
const allowOnce: Press['answer'] = { kind: 'approval', decision: 'allow', always: false };
const asApproval = (a: ReturnType<typeof approval>): Item => ({ kind: 'approval', approval: a });
const asQuestion = (q: ReturnType<typeof question>): Item => ({ kind: 'question', question: q });

describe('what needs you', () => {
  it('counts in words, oldest first', () => {
    expect(needsYouLine(0)).toBe('Nothing needs you.');
    expect(needsYouLine(1)).toBe('One needs you.');
    expect(needsYouLine(3)).toBe('Three need you, oldest first.');
    const c = company({
      questions: [question('q1', 'ui-designer', 'Which?', ['A', 'B'], { askedAt: NOW - min(6) })],
      approvals: [approval('a1', 'frontend-engineer', 'Push', { askedAt: NOW - min(9) }), approval('a2', 'qa-engineer', 'Push', { askedAt: NOW - min(1) })],
    });
    const view = inboxView(c, {}, ctx);
    expect(view.needs.map((n) => n.item.kind === 'question' ? n.item.question.id : n.item.approval.id)).toEqual(['a1', 'q1', 'a2']);
    expect(view.open).toBe(3);
  });

  it('says who asks, who has a copy and for which task', () => {
    const c = company({ tasks: [task('t1', 'ui-designer', 'Pickup slot picker')] });
    const lines = questionLines(c, question('q1', 'ui-designer', '15 or 30 minutes?', ['15-minute windows', '30-minute windows'], { recommended: 0, taskId: 't1' }), NOW);
    expect(lines.who).toBe('Mina, UI designer, asks you. Ada has a copy.');
    expect(lines.asked).toBe('Asked 2 min ago.');
    expect(lines.task).toEqual({ id: 't1', title: 'Pickup slot picker' });
    expect(lines.options).toEqual([{ label: '15-minute windows', pick: true }, { label: '30-minute windows', pick: false }]);
    expect(questionLines(c, question('q2', 'ceo', 'Cards too?', ['Yes', 'No']), NOW).who).toBe('The CEO asks you.');
    expect(questionLines(c, question('q3', 'qa-engineer', 'Retry?', ['Yes', 'No']), NOW).who).toBe('The QA engineer asks you. Ben has a copy.');
  });

  it('says what an approval asks for, what Always allow adds and when silence counts as a no', () => {
    const c = company();
    const lines = approvalLines(c, approval('a1', 'frontend-engineer', 'Push the work branch to GitHub'), NOW);
    expect(lines.who).toBe('Kai, frontend engineer, wants your OK. Waiting 3 min.');
    expect(lines.summary).toBe('Push the work branch to GitHub');
    expect(lines.detailLabel).toBe('Show the command');
    expect(lines.always).toBe('Always allow adds a rule for this company: any git push to origin.');
    expect(lines.expires).toBe(`No answer by ${hourMinute(NOW + min(20))} counts as a no.`);
    const file = approvalLines(c, approval('a2', 'frontend-engineer', 'Write outside the project', { tool: 'Write', detail: 'C:\\Users\\jamie\\.gitconfig', alwaysRule: null }), NOW);
    expect(file.detailLabel).toBe('Show the path');
    expect(file.always).toBeNull();
  });
});

describe('what a press says at once', () => {
  it('names who it was for and says how long Undo lasts, for a denial, an approval and an answer', () => {
    const a = approval('a1', 'frontend-engineer', 'Push the work branch to GitHub');
    const deny: Press['answer'] = { kind: 'approval', decision: 'deny', always: false };
    expect(pressAnnouncement(company(), asApproval(a), deny)).toBe('Denying Kai. Undo is available for 5 seconds.');
    expect(pressAnnouncement(company(), asApproval(a), allowOnce)).toBe('Allowing Kai once. Undo is available for 5 seconds.');
    const q = question('q1', 'ceo', 'Which payment?', ['TWINT', 'Card']);
    expect(pressAnnouncement(company(), asQuestion(q), { kind: 'question', option: 1, text: '' })).toBe('Answering the CEO: Card. Undo is available for 5 seconds.');
  });
});

describe('an item after a press', () => {
  const a = approval('a1', 'frontend-engineer', 'Push the work branch to GitHub');
  const answered = (decision: 'allow' | 'deny', always: boolean, at: number, note: string | null = null) => ({ ...a, answer: { decision, always, at, appliesAt: at + UNDO_MS, note } });

  it('becomes one line with Undo at once, before the hub’s answer arrives', () => {
    const view = itemView(company(), asApproval(a), press(allowOnce, 'sending'), ctx);
    expect(view).toEqual({ kind: 'pending', text: 'Allowing Kai once.', until: NOW - sec(1) + UNDO_MS, denial: false });
  });

  it('keeps Undo until the hub applies it, then says what happened', () => {
    const item = asApproval(answered('allow', false, NOW - sec(2)));
    expect(itemView(company(), item, press(allowOnce, 'sent'), ctx)).toMatchObject({ kind: 'pending', text: 'Allowing Kai once.', until: NOW - sec(2) + UNDO_MS });
    expect(itemView(company(), item, press(allowOnce, 'sent'), { ...ctx, now: NOW + sec(4) })).toEqual({
      kind: 'done',
      text: `Allowed once at ${hourMinute(NOW - sec(2))}. Kai carries on.`,
      denial: false,
    });
  });

  it('words each answer as the design does', () => {
    const later = { ...ctx, now: NOW + sec(10) };
    const always: Press['answer'] = { kind: 'approval', decision: 'allow', always: true };
    const deny: Press['answer'] = { kind: 'approval', decision: 'deny', always: false };
    expect(itemView(company(), asApproval(answered('allow', true, NOW)), press(always, 'sent'), ctx)).toMatchObject({ text: 'Allowing Kai always.' });
    expect(itemView(company(), asApproval(answered('deny', false, NOW)), press(deny, 'sent'), ctx)).toMatchObject({ text: 'Denying Kai.', denial: true });
    expect(itemView(company(), asApproval(answered('deny', false, NOW)), press(deny, 'sent'), later)).toMatchObject({ text: `Denied at ${hourMinute(NOW)}. Kai was told no.` });
    expect(itemView(company(), asApproval(answered('deny', false, NOW, 'Not before launch.')), press(deny, 'sent'), later)).toMatchObject({ text: `Denied at ${hourMinute(NOW)}. Kai was told why.` });
    const q = question('q1', 'ui-designer', 'Which?', ['Stripe', 'TWINT'], { answer: { option: 0, text: '', at: NOW, appliesAt: NOW + UNDO_MS } });
    const stripe: Press['answer'] = { kind: 'question', option: 0, text: '' };
    expect(itemView(company(), asQuestion(q), press(stripe, 'sent'), ctx)).toMatchObject({ text: 'Answering Mina: Stripe.' });
    expect(itemView(company(), asQuestion(q), press(stripe, 'sent'), later)).toMatchObject({ text: `Answered at ${hourMinute(NOW)}: Stripe. Mina carries on.` });
  });

  it('comes back open after Undo, even before the snapshot catches up, unless someone answered it since', () => {
    const was = answered('allow', false, NOW - sec(2));
    expect(itemView(company(), asApproval(was), press(allowOnce, 'undone', { undid: NOW - sec(2) }), ctx)).toEqual({ kind: 'open', refusal: null });
    expect(itemView(company(), asApproval(a), press(allowOnce, 'undone', { undid: NOW - sec(2) }), ctx)).toEqual({ kind: 'open', refusal: null });
    const again = answered('deny', false, NOW);
    expect(itemView(company(), asApproval(again), press(allowOnce, 'undone', { undid: NOW - sec(2) }), ctx)).toEqual({
      kind: 'elsewhere',
      text: `Answered in another window: denied at ${hourMinute(NOW)}.`,
    });
  });

  it('comes back open with why when the office turned the answer down', () => {
    const why = refusalLine("The office didn't answer.");
    expect(why).toBe("Couldn't send your answer. The office didn't answer. Try again.");
    // The hub client's own offline sentence already says to try again: it is said once.
    expect(refusalLine("The office didn't answer. Try again.")).toBe(why);
    expect(itemView(company(), asApproval(a), press(allowOnce, 'refused', { error: why }), ctx)).toEqual({ kind: 'open', refusal: why });
  });

  it('announces in a few words once the answer reaches them', () => {
    expect(appliedAnnouncement(company(), asApproval(a), allowOnce)).toBe('Allowed. Kai carries on.');
    expect(appliedAnnouncement(company(), asApproval(a), { kind: 'approval', decision: 'deny', always: false })).toBe('Denied. Kai was told no.');
  });
});

describe('Undo on a phone whose clock is off', () => {
  // The hub took the answer at 13:59:58 by its clock and applies it at 14:00:03. The last snapshot came at 14:00:00.
  const a = approval('a1', 'frontend-engineer', 'Push the work branch to GitHub', { answer: { decision: 'allow', always: false, at: NOW - sec(2), appliesAt: NOW + sec(3), note: null } });

  it.each([
    ['two minutes ahead of the hub', -min(2)],
    ['two minutes behind the hub', min(2)],
  ])("keeps Undo for the hub's last three seconds when this browser's clock runs %s", (_, skew) => {
    const view = itemView(company(), asApproval(a), press(allowOnce, 'sent', { at: NOW - skew - sec(2) }), { ...ctx, skew });
    // The Undo line times `until` on this browser's clock, which reads the hub's 14:00:00 as NOW - skew.
    expect(view).toMatchObject({ kind: 'pending', until: NOW - skew + sec(3) });
  });

  it("keeps the Undo of a browser that runs ahead, instead of calling the answer done at once", () => {
    const skew = -min(2);
    // A second after the snapshot came, by this browser's clock: the office's clock says one second after 14:00:00.
    const now = officeNow(NOW, NOW - skew + sec(1), skew);
    expect(now).toBe(NOW + sec(1));
    expect(itemView(company(), asApproval(a), press(allowOnce, 'sent'), { ...ctx, now, skew })).toMatchObject({ kind: 'pending', text: 'Allowing Kai once.' });
    expect(itemView(company(), asApproval(a), press(allowOnce, 'sent'), { ...ctx, now: officeNow(NOW, NOW - skew + sec(4), skew), skew })).toMatchObject({ kind: 'done' });
  });

  it("runs the office's clock on the hub's time from the snapshot on, whatever this browser's clock says", () => {
    // Ten seconds after a snapshot stamped 14:00:00, on a browser two minutes ahead and on one two minutes behind.
    expect(officeNow(NOW, NOW + min(2) + sec(10), -min(2))).toBe(NOW + sec(10));
    expect(officeNow(NOW, NOW - min(2) + sec(10), min(2))).toBe(NOW + sec(10));
    // Never before the latest snapshot.
    expect(officeNow(NOW, NOW - min(2) - sec(5), min(2))).toBe(NOW);
  });

  it("times the inbox's own wake-ups and the why of a no on the same clock", () => {
    const skew = -min(2);
    expect(undoUntil(asApproval(a), { at: NOW - skew - sec(2) }, skew)).toBe(NOW - skew + sec(3));
    // Before the snapshot has the answer, the window runs from the press, which this browser stamped itself.
    const pressedAt = NOW - skew;
    expect(undoUntil(asApproval(approval('a2', 'frontend-engineer', 'Push')), { at: pressedAt }, skew)).toBe(pressedAt + UNDO_MS);
  });
});

describe('an item something else took away', () => {
  it('says it was answered in another window while you looked', () => {
    const a = approval('a1', 'frontend-engineer', 'Push', { answer: { decision: 'allow', always: false, at: NOW - sec(20), appliesAt: NOW - sec(15), note: null } });
    expect(itemView(company(), asApproval(a), undefined, ctx)).toEqual({ kind: 'elsewhere', text: `Answered in another window: allowed once at ${hourMinute(NOW - sec(20))}.` });
  });

  it('says why it was withdrawn, in the office’s words', () => {
    const q = question('q1', 'frontend-engineer', 'Which?', ['A', 'B'], { withdrawn: { reason: 'Kai was stopped.', at: NOW - sec(30) } });
    expect(itemView(company(), asQuestion(q), undefined, ctx)).toEqual({ kind: 'gone', text: 'Withdrawn: Kai was stopped.' });
  });

  it('says a timed-out approval was a no', () => {
    const expiresAt = NOW - sec(10);
    const gone = approval('a1', 'frontend-engineer', 'Push', { expiresAt });
    expect(itemView(company(), asApproval(gone), undefined, ctx)).toEqual({ kind: 'gone', text: `Timed out at ${hourMinute(expiresAt)}, so Kai was told no.` });
    const withdrawn = approval('a2', 'frontend-engineer', 'Push', { expiresAt, withdrawn: { reason: 'Timed out, so Kai was told no.', at: expiresAt } });
    expect(itemView(company(), asApproval(withdrawn), undefined, ctx)).toEqual({ kind: 'gone', text: `Timed out at ${hourMinute(expiresAt)}, so Kai was told no.` });
  });

  it('leaves what changed before this visit to the Answered fold, or out', () => {
    const before = { now: NOW, openedAt: NOW, skew: 0 };
    const done = approval('a1', 'frontend-engineer', 'Push the work branch to GitHub', { answer: { decision: 'allow', always: true, at: NOW - min(30), appliesAt: NOW - min(30) + UNDO_MS, note: null } });
    const gone = question('q1', 'ui-designer', 'Which?', ['A', 'B'], { withdrawn: { reason: 'Mina was fired.', at: NOW - min(5) } });
    const yesterday = question('q2', 'ui-designer', 'Old?', ['A', 'B'], { askedAt: NOW - min(60 * 30), answer: { option: 1, text: '', at: NOW - min(60 * 29), appliesAt: NOW - min(60 * 29) } });
    const view = inboxView(company({ approvals: [done], questions: [gone, yesterday] }), {}, before);
    expect(view.needs).toEqual([]);
    expect(view.answered).toEqual([{ id: 'a1', what: 'Push the work branch to GitHub.', answer: 'Always allowed', at: NOW - min(30) }]);
    expect(answeredLine(14)).toBe('14 answered today');
    expect(answeredLine(3)).toBe('Three answered today');
  });
});

describe('a question exactly as the hub sends it', () => {
  // As GET /api/c/<id>/state gave the CEO's question after "[fake:ask]": no gate key at all, where the demo writes
  // gate: null. The inbox crashed on it once, in a build caught between two edits of the inbox (itemPerson's arguments).
  const fromHub: Question = { id: 'q-1', from: 'ceo', text: 'Which payment should the app take?', options: ['TWINT', 'Card'], recommended: 0, taskId: null, askedAt: NOW - min(1), answer: null, withdrawn: null };
  const item = asQuestion(fromHub);
  const c = company({ questions: [fromHub] });

  it('is open in Needs you, as the CEO asking, with their pick marked', () => {
    expect(inboxView(c, {}, ctx)).toMatchObject({ open: 1, needs: [{ item, view: { kind: 'open', refusal: null } }] });
    expect(questionLines(c, fromHub, NOW)).toMatchObject({ who: 'The CEO asks you.', task: null, options: [{ label: 'TWINT', pick: true }, { label: 'Card', pick: false }] });
  });

  it("is about the CEO, whom you can message, and not the office's start? before a task", () => {
    expect(itemPerson(c, item)).toBe('ceo');
    expect(askerCalled(c, item)).toBe('the CEO');
    expect(messageLabel(c, item)).toBe('Message the CEO');
  });

  it('says your answer goes to the CEO, who carries on', () => {
    const twint: Press['answer'] = { kind: 'question', option: 0, text: '' };
    expect(pressAnnouncement(c, item, twint)).toBe('Answering the CEO: TWINT. Undo is available for 5 seconds.');
    expect(appliedAnnouncement(c, item, twint)).toBe('Answered. The CEO carries on.');
  });
});

describe("the office's start? before a task, for someone who checks with you", () => {
  const c = company({ tasks: [task('t-2', 'frontend-engineer', 'Receipt screen')] });
  const gate = question('q1', THE_OFFICE, 'Kai would like to start t-2, “Receipt screen”. Start it?', ['Start it', 'Not now'], { taskId: 't-2', gate: { task: 't-2' } });
  const start: Press['answer'] = { kind: 'question', option: 0, text: '' };
  const notNow: Press['answer'] = { kind: 'question', option: 1, text: '' };
  const answered = (option: number) => asQuestion({ ...gate, answer: { option, text: '', at: NOW - sec(2), appliesAt: NOW - sec(2) + UNDO_MS } });
  const later = { ...ctx, now: NOW + sec(4) };

  it("reads as the office asking about the owner's next task, with no copy for anyone", () => {
    expect(questionLines(c, gate, NOW)).toMatchObject({ who: "The office asks about Kai's next task.", task: { id: 't-2', title: 'Receipt screen' } });
    // The task is gone, or the office asks something else: it still asks, and nobody else.
    expect(questionLines(company(), gate, NOW).who).toBe('The office asks you.');
    expect(questionLines(c, { ...gate, gate: null }, NOW).who).toBe('The office asks you.');
  });

  it('is about the owner, whom you can message; the office itself has nobody to message', () => {
    expect(itemPerson(c, asQuestion(gate))).toBe('frontend-engineer');
    expect(messageLabel(c, asQuestion(gate))).toBe('Message Kai');
    expect(itemPerson(c, asQuestion({ ...gate, gate: null }))).toBeNull();
    expect(messageLabel(c, asQuestion({ ...gate, gate: null }))).toBeNull();
    expect(askerCalled(c, asQuestion(gate))).toBe('the office');
    expect(messageLabel(c, asQuestion(question('q2', 'ui-designer', 'Which?', ['A', 'B'])))).toBe('Message Mina');
  });

  it('says you answer the office, then that the owner starts it or that it waits until you resume it', () => {
    expect(pressAnnouncement(c, asQuestion(gate), start)).toBe('Answering the office: Start it. Undo is available for 5 seconds.');
    expect(itemView(c, answered(0), press(start, 'sent'), ctx)).toMatchObject({ kind: 'pending', text: 'Answering the office: Start it.' });
    expect(itemView(c, answered(0), press(start, 'sent'), later)).toMatchObject({ kind: 'done', text: `Answered at ${hourMinute(NOW - sec(2))}: Start it. Kai starts it.` });
    expect(itemView(c, answered(1), press(notNow, 'sent'), later)).toMatchObject({ kind: 'done', text: `Answered at ${hourMinute(NOW - sec(2))}: Not now. The task waits until you resume it.` });
    expect(appliedAnnouncement(c, answered(0), start)).toBe('Answered. Kai starts it.');
    expect(appliedAnnouncement(c, answered(1), notNow)).toBe('Answered. The task waits until you resume it.');
    // Your own words hold the task back too.
    expect(appliedAnnouncement(c, answered(1), { kind: 'question', option: null, text: 'After the launch.' })).toBe('Answered. The task waits until you resume it.');
  });

  it("says it was withdrawn in the office's words, or that the office doesn't need it", () => {
    const why = { ...gate, withdrawn: { reason: "Kai doesn't check with you before each task any more.", at: NOW - sec(30) } };
    expect(itemView(c, asQuestion(why), undefined, ctx)).toEqual({ kind: 'gone', text: "Withdrawn: Kai doesn't check with you before each task any more." });
    expect(itemView(c, asQuestion({ ...why, withdrawn: { reason: '', at: NOW - sec(30) } }), undefined, ctx)).toEqual({ kind: 'gone', text: "Withdrawn: The office doesn't need it any more." });
  });
});

describe('conversations', () => {
  it('lists everyone you have messages with, newest first, with new ones marked', () => {
    const c = company({
      messages: [
        message('m1', STAKEHOLDER, 'frontend-engineer', 'Make the slot picker work with one thumb.', { at: NOW - min(40) }),
        message('m2', 'frontend-engineer', STAKEHOLDER, 'Done: one row of big buttons.', { at: NOW - min(25) }),
        message('m3', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(14) }),
        message('m4', 'ceo', 'head-of-design', 'Please take a darker palette through design.', { at: NOW - min(12), origin: STAKEHOLDER, relayOf: 'm3' }),
      ],
      reports: [report('r1', 'ceo', STAKEHOLDER, 'Ada has your palette note.', { at: NOW - min(9) })],
      seen: { ceo: NOW - min(10), 'frontend-engineer': NOW - min(20) },
    });
    const rows = conversationsOf(c);
    expect(rows.map((r) => [r.person.id, r.last, r.unread])).toEqual([
      ['ceo', 'Ada has your palette note.', true],
      ['frontend-engineer', 'Done: one row of big buttons.', false],
    ]);
    expect(conversationsTitle(rows)).toBe('Conversations, one new');
    expect(conversationsTitle([])).toBe('Conversations');
  });

  it('says an answer you gave as an answer in the last line', () => {
    const q = question('q1', 'ui-designer', 'Which windows?', ['15 minutes', '30 minutes'], { answer: { option: 1, text: '30 minutes', at: NOW - min(1), appliesAt: NOW } });
    const c = company({ questions: [q], messages: [message('m1', STAKEHOLDER, 'ui-designer', 'on "Which windows?": 30 minutes.', { at: NOW, answers: 'q1' })] });
    expect(conversationsOf(c)[0]?.last).toBe('You answered “Which windows?”: 30 minutes.');
  });

  it('marks your own last line', () => {
    const c = company({ messages: [message('m1', STAKEHOLDER, 'qa-engineer', 'Run the suite on a phone too.', { at: NOW - min(3) })] });
    expect(conversationsOf(c)[0]).toMatchObject({ last: 'You: Run the suite on a phone too.', unread: false });
  });

  it('ignores a seen time someone set on the prototype', () => {
    const seen = JSON.parse('{"__proto__": 99999999999999}') as Record<string, number>;
    const c = company({ messages: [message('m1', 'qa-engineer', STAKEHOLDER, 'Two tests fail.', { at: NOW - min(1) })], seen });
    expect(conversationsOf(c)[0]?.unread).toBe(true);
  });
});
