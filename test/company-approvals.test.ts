import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ApprovalAsk, OrgRefusal, STAKEHOLDER, type TurnResult, UNDO_MS } from '../src/core/company.ts';
import { rig } from './company-kit.ts';

function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

const running = () => rig({ running: true, now: () => Date.now() });

const push = (extra: Partial<ApprovalAsk> = {}): ApprovalAsk => ({
  tool: 'Bash',
  summary: 'Push the work branch to GitHub',
  detail: 'git push origin worklings/cafe',
  kind: 'push',
  expiresAt: Date.now() + 600_000,
  alwaysRule: { rule: 'Bash(git push origin worklings/cafe)', sentence: 'any git push of the work branch to origin' },
  ...extra,
});

const turn = (extra: Partial<TurnResult> = {}): TurnResult => ({
  sessionId: '0b7c1d2e-0000-4000-8000-000000000001', ok: true, text: 'Done.', costUsd: 0.4, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
  contextTokens: 50_000, durationMs: 1_000, problem: null, ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('answers to questions', () => {
  it('reach the asker only after the undo window, in their words', async () => {
    const { company, desks } = await running();
    const q = company.askStakeholder('ceo', { text: 'Which blue?', options: ['Navy', 'Teal.'], recommended: 0, taskId: null });
    const answered = company.answer(q.id, { option: 1, text: 'Keep it calm.' });
    expect(answered.answer).toEqual({ option: 1, text: 'Keep it calm.', at: Date.now(), appliesAt: Date.now() + UNDO_MS });
    expect(company.view().inbox).toBe(0);
    const before = desks().textsFor('ceo').length;
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(desks().textsFor('ceo')).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(desks().textsFor('ceo').at(-1)).toBe('From Robin, the stakeholder: on "Which blue?": Teal. Keep it calm.');
    // The message that carries it names the question it answers; other messages answer none.
    const messages = company.view().messages;
    expect(messages.at(-1)).toMatchObject({ from: '@stakeholder', to: 'ceo', answers: q.id });
    expect(messages.filter((m) => m.answers === q.id)).toHaveLength(1);
    expect(company.say('ceo', 'Thanks.').answers).toBeNull();
    expect(refusal(() => company.undo(q.id)).message).toMatch(/^That answer already reached .+, so it can't be undone\.$/);
  });

  it('can be undone inside the window, which puts the question back', async () => {
    const { company, desks } = await running();
    const q = company.askStakeholder('ceo', { text: 'Open on Sundays?', options: ['Yes', 'No'], recommended: 1, taskId: null });
    company.answer(q.id, { option: 0, text: '' });
    vi.advanceTimersByTime(UNDO_MS - 100);
    expect(company.undo(q.id).answer).toBeNull();
    expect(company.view().inbox).toBe(1);
    const before = desks().textsFor('ceo').length;
    vi.advanceTimersByTime(60_000);
    expect(desks().textsFor('ceo')).toHaveLength(before);
    // It can be answered again.
    company.answer(q.id, { option: null, text: 'Only in summer.' });
    vi.advanceTimersByTime(UNDO_MS);
    expect(desks().textsFor('ceo').at(-1)).toBe('From Robin, the stakeholder: on "Open on Sundays?": Only in summer.');
  });

  it('refuses answers that pick nothing, or pick an option that is not there', async () => {
    const { company } = await running();
    const q = company.askStakeholder('ceo', { text: 'Open on Sundays?', options: ['Yes', 'No'], recommended: null, taskId: null });
    expect(refusal(() => company.answer(q.id, { option: null, text: '  ' })).code).toBe('invalid');
    expect(refusal(() => company.answer(q.id, { option: 2, text: '' })).code).toBe('invalid');
    expect(refusal(() => company.answer('q-999', { option: 0, text: '' })).code).toBe('unknown');
  });
});

describe('approvals', () => {
  it('put a request in the inbox and allow it once the undo window has passed', async () => {
    const { company } = await running();
    let settled: unknown = null;
    void company.requestApproval('frontend-engineer', push()).then((answer) => {
      settled = answer;
    });
    const view = company.view();
    expect(view.inbox).toBe(1);
    const approval = view.approvals.at(-1);
    expect(approval).toMatchObject({ person: 'frontend-engineer', kind: 'push', summary: 'Push the work branch to GitHub', answer: null, withdrawn: null });
    company.decide(approval?.id ?? '', { decision: 'allow', always: false, note: null });
    expect(company.view().inbox).toBe(0);
    await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ decision: 'allow', always: false, note: null });
    expect(company.view().settings.alwaysAllow).toEqual([]);
  });

  it('add the rule an "Always allow" offers, and refuse always where none is offered', async () => {
    const { company } = await running();
    const answer = company.requestApproval('frontend-engineer', push());
    const id = company.view().approvals.at(-1)?.id ?? '';
    company.decide(id, { decision: 'allow', always: true, note: null });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await expect(answer).resolves.toEqual({ decision: 'allow', always: true, note: null });
    expect(company.view().settings.alwaysAllow).toEqual(['Bash(git push origin worklings/cafe)']);

    void company.requestApproval('frontend-engineer', push({ kind: 'outside-project', summary: 'Write outside the project', alwaysRule: null }));
    const other = company.view().approvals.at(-1)?.id ?? '';
    expect(refusal(() => company.decide(other, { decision: 'allow', always: true, note: null })).message).toBe(
      "Always allow isn't offered for this request; allow it once instead.",
    );
  });

  it("deny with the stakeholder's note, which goes back to the person with the no", async () => {
    const { company, desks } = await running();
    const before = desks().textsFor('frontend-engineer').length;
    const answer = company.requestApproval('frontend-engineer', push());
    company.decide(company.view().approvals.at(-1)?.id ?? '', { decision: 'deny', always: true, note: 'We push on Fridays.' });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await expect(answer).resolves.toEqual({ decision: 'deny', always: false, note: 'We push on Fridays.' });
    // The hook carries it, so it isn't sent a second time as a message.
    expect(desks().textsFor('frontend-engineer')).toHaveLength(before);
    expect(company.view().settings.alwaysAllow).toEqual([]);
  });

  it("withdraw a request whose hook gave up first, and say no", async () => {
    const { company } = await running();
    const hook = new AbortController();
    const answer = company.requestApproval('frontend-engineer', push(), hook.signal);
    const id = company.view().approvals.at(-1)?.id ?? '';
    // Answered, but still inside the undo window when the hook stops waiting.
    company.decide(id, { decision: 'allow', always: false, note: null });
    hook.abort();
    await expect(answer).resolves.toEqual({ decision: 'deny', always: false, note: null });
    expect(company.view().approvals.find((a) => a.id === id)?.withdrawn?.reason).toBe("Sam's request timed out.");
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(company.view().approvals.find((a) => a.id === id)?.withdrawn).not.toBeNull();
    // A hook that has given up already gets a no at once, and nothing reaches the inbox.
    const gone = new AbortController();
    gone.abort();
    const before = company.view().approvals.length;
    await expect(company.requestApproval('frontend-engineer', push(), gone.signal)).resolves.toEqual({ decision: 'deny', always: false, note: null });
    expect(company.view().approvals).toHaveLength(before);
  });

  it('count as a no when nobody answers in time, even after an undo', async () => {
    const { company } = await running();
    const answer = company.requestApproval('frontend-engineer', push({ expiresAt: Date.now() + 60_000 }));
    const id = company.view().approvals.at(-1)?.id ?? '';
    company.decide(id, { decision: 'allow', always: false, note: null });
    company.undo(id);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(answer).resolves.toMatchObject({ decision: 'deny', always: false, note: null, expired: true });
    const expired = company.view().approvals.find((a) => a.id === id);
    expect(expired?.withdrawn?.reason).toMatch(/^Timed out at \d\d:\d\d, so Sam was told no\.$/);
    expect(company.view().inbox).toBe(0);
    expect(refusal(() => company.decide(id, { decision: 'allow', always: false, note: null })).code).toBe('closed');
  });

  it('send an answer given near the end before the hook stops waiting', async () => {
    const { company } = await running();
    const answer = company.requestApproval('frontend-engineer', push({ expiresAt: Date.now() + 2_000 }));
    company.decide(company.view().approvals.at(-1)?.id ?? '', { decision: 'allow', always: false, note: null });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(answer).resolves.toEqual({ decision: 'allow', always: false, note: null });
  });

  it('say no at once for someone the company does not know', async () => {
    const { company } = await running();
    await expect(company.requestApproval('nobody', push())).resolves.toEqual({ decision: 'deny', always: false, note: null });
    expect(company.view().approvals).toEqual([]);
  });
});

describe('pausing and resting', () => {
  it('pauses and resumes the desks when the stakeholder says', async () => {
    const { company, desks } = await running();
    company.pause();
    expect(company.view().pause).toMatchObject({ reason: 'stakeholder', until: null });
    expect(desks().pauses).toEqual([null]);
    company.resume();
    expect(company.view().pause).toBeNull();
    expect(desks().resumes).toBe(1);
    expect(company.view().log.slice(-2).map((l) => l.text)).toEqual(['You paused work.', 'You resumed work.']);
  });

  it('rests until a usage limit resets, then resumes once, with no retries', async () => {
    const { company, desks } = await running();
    const until = Date.now() + 2 * 3_600_000;
    desks().events.limited(until, "You've hit your limit.", 'usage-limit');
    expect(company.view().pause).toMatchObject({ reason: 'usage-limit', until, message: expect.stringMatching(/^Resting until \d\d:\d\d, when your plan's limit resets\.$/) });
    expect(desks().pauses).toEqual([until]);
    // A later limit while resting sets a new time; still one timer.
    const later = until + 600_000;
    desks().events.limited(later, "You've hit your limit.", 'usage-limit');
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(company.view().pause?.until).toBe(later);
    expect(desks().resumes).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(company.view().pause).toBeNull();
    expect(desks().resumes).toBe(1);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(desks().resumes).toBe(1);
    expect(company.view().log.slice(-1)[0]).toMatchObject({ kind: 'wake' });
  });

  it('says when Claude is overloaded, and waits for the stakeholder when a limit gives no time', async () => {
    const { company, desks } = await running();
    // The switchboard says why; the words don't decide it.
    desks().events.limited(Date.now() + 300_000, 'Please try again later.', 'overloaded');
    expect(company.view().pause).toMatchObject({ reason: 'overloaded', message: expect.stringMatching(/^Resting until \d\d:\d\d: Claude is overloaded\.$/) });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(company.view().pause).toBeNull();
    desks().events.limited(null, 'Usage limit reached, not overloaded', 'usage-limit');
    expect(company.view().pause).toMatchObject({ reason: 'usage-limit', until: null, message: 'Resting: Usage limit reached, not overloaded. Resume work to try again.' });
    await vi.advanceTimersByTimeAsync(7 * 24 * 3_600_000);
    expect(company.view().pause).not.toBeNull();
    company.resume();
    expect(company.view().pause).toBeNull();
  });

  it("keeps the stakeholder's pause when a limit comes in", async () => {
    const { company, desks } = await running();
    company.pause();
    desks().events.limited(Date.now() + 1_000, 'Overloaded.', 'overloaded');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(company.view().pause?.reason).toBe('stakeholder');
    expect(desks().resumes).toBe(0);
  });
});

describe('turns and spend', () => {
  it("adds each turn's cost to the person and to the Spend dashboard, and keeps the context size", async () => {
    const { company, desks } = await running();
    desks().events.turn('ui-designer', turn());
    vi.advanceTimersByTime(3_600_000);
    desks().events.turn('ui-designer', turn({ costUsd: 0.1, contextTokens: null }));
    desks().events.turn('frontend-engineer', turn({ sessionId: '0b7c1d2e-0000-4000-8000-000000000002', costUsd: null }));
    const view = company.view();
    const kai = view.people.find((p) => p.id === 'ui-designer');
    expect(kai?.cost).toBeCloseTo(0.5);
    expect(kai?.desk).toMatchObject({ sessionId: '0b7c1d2e-0000-4000-8000-000000000001', context: 0.25 });
    expect(view.spend.samples.map((s) => [s.person, s.cost])).toEqual([['ui-designer', 0.4], ['ui-designer', 0.1], ['frontend-engineer', 0]]);
    expect(view.spend.hourly).toHaveLength(7 * 24);
    expect(view.spend.hourly.slice(-2).map((h) => h.cost)).toEqual([0.4, 0.1]);
    expect(view.spend.byPerson).toEqual([{ person: 'ui-designer', today: expect.closeTo(0.5), week: expect.closeTo(0.5), all: expect.closeTo(0.5) }]);
    expect(company.lobbyEntry().spend).toBeCloseTo(0.5);
    expect(company.sessions().get('0b7c1d2e-0000-4000-8000-000000000002')).toBe('frontend-engineer');
  });
});

describe('handing a person over to Claude Code', () => {
  it("closes their desk, holds their messages and withdraws what they wait on, then brings them back on their session", async () => {
    const { company, desks } = await running();
    desks().events.session('ui-designer', '0b7c1d2e-0000-4000-8000-00000000000b');
    const waiting = company.say('ui-designer', 'Before you go: use teal.');
    const approval = company.requestApproval('ui-designer', push());
    const away = company.handOver('ui-designer');
    expect(away).toMatchObject({ person: 'ui-designer', state: 'away', sessionId: '0b7c1d2e-0000-4000-8000-00000000000b' });
    expect(desks().closed).toEqual(['ui-designer']);
    expect(desks().withdrawn).toEqual([waiting.id]);
    await expect(approval).resolves.toEqual({ decision: 'deny', always: false, note: null });
    expect(company.view().approvals.at(-1)?.withdrawn?.reason).toBe('Kai was handed over to Claude Code.');

    const held = company.say('ui-designer', 'And the menu icons.');
    const turnsWhileAway = desks().turns.filter((t) => t.turn.messageId === held.id);
    expect(turnsWhileAway).toEqual([]);
    expect(refusal(() => company.stop('ui-designer', 'Stop.')).message).toBe('Kai is with you in Claude Code; bring them back first.');

    const back = company.bringBack('ui-designer');
    expect(back.state).toBe('closed');
    const handed = desks().turns.filter((t) => t.turn.messageId === waiting.id || t.turn.messageId === held.id);
    expect(handed.map((t) => [t.turn.messageId, t.plan.sessionId])).toEqual([
      [waiting.id, '0b7c1d2e-0000-4000-8000-00000000000b'],
      [waiting.id, '0b7c1d2e-0000-4000-8000-00000000000b'],
      [held.id, '0b7c1d2e-0000-4000-8000-00000000000b'],
    ]);
    expect(company.view().log.slice(-2).map((l) => l.kind)).toEqual(['hand-over', 'bring-back']);
  });
});

describe('settings and unread marks', () => {
  it('sets the desks at once from 1 to 20 and removes a rule', async () => {
    const { company, desks } = await running();
    expect(company.updateSettings({ maxDesks: 3 }).maxDesks).toBe(3);
    expect(desks().maxDesks).toBe(3);
    expect(refusal(() => company.updateSettings({ maxDesks: 21 })).code).toBe('invalid');
    expect(refusal(() => company.updateSettings({ maxDesks: 2.5 })).code).toBe('invalid');
    void company.requestApproval('frontend-engineer', push());
    company.decide(company.view().approvals.at(-1)?.id ?? '', { decision: 'allow', always: true, note: null });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(company.updateSettings({ removeRule: 'Bash(git push origin worklings/cafe)' }).alwaysAllow).toEqual([]);
    expect(refusal(() => company.updateSettings({ removeRule: 'Bash(rm -rf /)' })).code).toBe('unknown');
  });

  it('remembers when the stakeholder last opened a conversation', async () => {
    const { company } = await running();
    company.markSeen('ui-designer');
    expect(company.view().seen['ui-designer']).toBe(Date.now());
    expect(refusal(() => company.markSeen(STAKEHOLDER)).code).toBe('unknown');
  });
});
