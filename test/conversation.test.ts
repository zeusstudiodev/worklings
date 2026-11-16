import { describe, expect, it } from 'vitest';
import { ASIDE_ANSWERS_KEPT, type AsideAnswer, type AsideCall, type AsideView, emptyAsideView } from '../src/core/aside.ts';
import type { OfficeEvent } from '../src/core/events.ts';
import { apply, emptyOffice, indexStudio, type OfficeState } from '../src/core/office.ts';
import type { ReplayInfo } from '../src/core/snapshot.ts';
import type { Studio } from '../src/core/studio.ts';
import {
  blockedReason,
  counter,
  failureCopy,
  headerLines,
  LOCKED,
  refusalCopy,
  runningLine,
  shownQuestion,
  signature,
  talkFor,
  targetOf,
  threadView,
  withTyped,
} from '../web/src/hud/asideModel.ts';
import { aboutCost, spent } from '../web/src/lib/format.ts';
import { ANSWERED_SHOWN_MS, type Cast, castFrom, type CastAsks, figureFor } from '../web/src/scene/cast.ts';
import { computeLayout } from '../web/src/scene/layout.ts';
import { placeBeside, shiftToShow } from '../web/src/scene/stack.ts';

const studio: Studio = {
  version: 1, name: 'Plant Pal', domain: 'mobile-app', rigor: 'standard',
  departments: [
    { id: 'quality', name: 'Quality', style: 'quality' },
    { id: 'content', name: 'Content', style: 'content' },
  ],
  roles: [
    { id: 'qa-engineer', department: 'quality', title: 'QA engineer' },
    { id: 'docs-writer', department: 'content', title: 'Docs writer' },
  ],
  rules: [], gates: [], skills: [], fired: [],
};
const layout = computeLayout(studio);
const index = indexStudio(studio);
const T0 = Date.UTC(2026, 10, 4, 14, 0, 0);
const at = (seconds: number) => T0 + seconds * 1000;
type Event = OfficeEvent extends infer E ? (E extends OfficeEvent ? Omit<E, 'sessionId'> : never) : never;

/** A lead who briefed the QA engineer twice, the second call reading 18k tokens of context. */
function office(): OfficeState {
  const state = emptyOffice();
  const events: Event[] = [
    { kind: 'prompt', at: at(0), text: 'Test the streak on a small screen and with large text', notification: false },
    { kind: 'subagent-start', at: at(10), agentId: 'q1', agentType: 'qa-engineer' },
    { kind: 'subagent-stop', at: at(30), agentId: 'q1', agentType: 'qa-engineer', lastMessage: 'Passes at 375px.' },
    { kind: 'subagent-start', at: at(40), agentId: 'q2', agentType: 'qa-engineer' },
    { kind: 'usage', at: at(45), agentId: 'q2', messageId: 'm1', model: 'claude-sonnet-5-5', usage: { input: 6, output: 300, cacheRead: 18_000, cacheWrite5m: 2_000, cacheWrite1h: 0 } },
  ];
  for (const e of events) apply(state, { sessionId: 's', ...e } as OfficeEvent, index);
  return state;
}
const scene = (state: OfficeState) => ({ agents: Object.values(state.agents), studio });
const ROLE = { roleId: 'qa-engineer', agentKey: null };

const answer = (over: Partial<AsideAnswer> = {}): AsideAnswer => ({
  id: 'a1', agentKey: 's:q2', roleId: 'qa-engineer', sessionId: 's', who: 'QA engineer', question: "What's left?", askedAt: at(60), answeredAt: at(66),
  source: 'transcript', text: 'Seeing the run pass at 200% text, then reporting back.', failure: null, cost: 0.006, tokens: 4_300, estimated: false, asOf: null, ...over,
});
const call = (over: Partial<AsideCall> = {}): AsideCall => ({
  id: 'c1', kind: 'ask', agentKey: 's:q2', roleId: 'qa-engineer', who: 'QA engineer', question: 'Is anything blocking you?', startedAt: at(70), estimate: null, ...over,
});
const view = (over: Partial<AsideView> = {}): AsideView => ({ ...emptyAsideView(at(0)), ...over });
const replay = (position: number): ReplayInfo => ({ sessionId: 's', title: 'Build', startedAt: at(0), endedAt: at(600), position, speed: 1, playing: true });

describe('who a conversation is with', () => {
  it("is a role across its calls, asking its newest call and saying which one when there are several", () => {
    const talk = talkFor(scene(office()), ROLE);
    expect(talk).toMatchObject({ threadKey: 'role:qa-engineer', title: 'QA engineer', who: 'the QA engineer', kind: 'role' });
    expect(talk?.agent?.key).toBe('s:q2');
    expect(talk?.calls.map((a) => a.key)).toEqual(['s:q2', 's:q1']);
    const lines = talk ? headerLines({ mode: 'live', replay: null }, talk) : [];
    expect(lines[0]).toMatch(/^(About \d+¢|Less than 1¢) on Haiku for each answer\.$/);
    expect(lines[1]).toMatch(/^Questions go to its call from .+\.$/);
  });

  it('is the lead as itself, per session', () => {
    const state = office();
    const lead = state.agents['s:lead'];
    if (!lead) throw new Error('no lead');
    const talk = talkFor(scene(state), targetOf(lead));
    expect(talk).toMatchObject({ threadKey: 'agent:s:lead', title: 'Lead', who: 'the lead', kind: 'lead' });
    // Nothing sizes the lead's context yet, so the cost shows with the answer.
    expect(talk ? headerLines({ mode: 'live', replay: null }, talk) : []).toEqual(['The cost shows with the answer.']);
  });

  it('names a lead with its session when the office has several', () => {
    const state = office();
    apply(state, { sessionId: '3f2a1c9e', kind: 'prompt', at: at(50), text: 'Write the release notes', notification: false }, index);
    const second = state.agents['3f2a1c9e:lead'];
    if (!second) throw new Error('no second lead');
    expect(talkFor(scene(state), targetOf(second))?.who).toBe('the lead in session 3f2a1c');
  });

  it("says when someone can be asked: once they've worked, with the office's link, while it is connected", () => {
    const docs = talkFor(scene(office()), { roleId: 'docs-writer', agentKey: null });
    if (!docs) throw new Error('no docs writer');
    expect(blockedReason(docs, { locked: false, stoppedAt: null })).toBe('You can ask the docs writer once it has worked in a session.');
    const qa = talkFor(scene(office()), ROLE);
    if (!qa) throw new Error('no qa');
    expect(blockedReason(qa, { locked: true, stoppedAt: null })).toBe(LOCKED);
    expect(blockedReason(qa, { locked: false, stoppedAt: at(60) })).toMatch(/^Reconnecting to the office\. This is how things stood at .+\.$/);
    expect(blockedReason(qa, { locked: false, stoppedAt: null })).toBeNull();
  });

  it('says samples are free in the demo, and where a replay stands', () => {
    const talk = talkFor(scene(office()), ROLE);
    if (!talk) throw new Error('no qa');
    expect(headerLines({ mode: 'demo', replay: null }, talk)[0]).toBe("Answers in the demo are made-up samples, so they're free.");
    expect(headerLines({ mode: 'replay', replay: replay(at(200)) }, talk).at(-1)).toBe('From the session as it stood at 3m 20s.');
  });
});

describe('the thread', () => {
  it('keeps the last three exchanges with a role across its calls, oldest first', () => {
    const talk = talkFor(scene(office()), ROLE);
    if (!talk) throw new Error('no qa');
    const answers = [
      answer({ id: 'a1', agentKey: 's:q1' }),
      answer({ id: 'lead', agentKey: 's:lead', roleId: null }),
      answer({ id: 'a2' }),
      answer({ id: 'a3' }),
      answer({ id: 'a4', text: null, failure: { code: 'timed-out', message: 'x', detail: null } }),
    ];
    expect(threadView(view({ answers }), talk).answers.map((a) => a.id)).toEqual(['a2', 'a3', 'a4']);
  });

  it("waits on its own question, or on someone else's question or a catch-up", () => {
    const talk = talkFor(scene(office()), ROLE);
    if (!talk) throw new Error('no qa');
    expect(threadView(view({ running: call() }), talk)).toMatchObject({ running: { id: 'c1' }, elsewhere: null });
    expect(threadView(view({ running: call({ agentKey: 's:lead', roleId: null }) }), talk)).toMatchObject({ running: null, elsewhere: { id: 'c1' } });
    expect(threadView(view({ running: call({ kind: 'catch-up', agentKey: null, roleId: null, question: null }) }), talk)).toMatchObject({ running: null, elsewhere: { kind: 'catch-up' } });
  });
});

describe("the office's words", () => {
  it('say how long a call has run, and from 30 seconds when it stops', () => {
    expect(runningLine(call(), 'the QA engineer', at(70) + 6_400)).toBe('The QA engineer is answering, 6s so far.');
    expect(runningLine(call(), 'the QA engineer', at(70) + 31_000)).toBe('The QA engineer is answering, 31s so far. It stops at 60s.');
    expect(runningLine(call({ kind: 'catch-up' }), 'the studio', at(70) + 12_000)).toBe('Haiku is writing your catch-up, 12s so far.');
  });

  it('say the office is making up a sample in the demo, where nothing calls Haiku', () => {
    expect(runningLine(call(), 'the QA engineer', at(70) + 1_200, true)).toBe("The office is making up the QA engineer's sample answer, 1s so far.");
    expect(runningLine(call({ kind: 'catch-up' }), 'the studio', at(70) + 1_200, true)).toBe('The office is making up a sample catch-up, 1s so far.');
  });

  it('give each failure its own copy, with the reset time or the first line when Claude Code gives one', () => {
    const fail = (code: Parameters<typeof failureCopy>[0]['code'], detail: string | null = null, message = 'The office said so.') => failureCopy({ code, message, detail }, 'the QA engineer');
    expect(fail('cancelled')).toBe('Cancelled.');
    expect(fail('timed-out')).toBe('Claude Code took more than 60 seconds, so the office stopped it. Try again.');
    expect(fail('limit', '3pm')).toBe("You've reached your Claude usage limit. It resets at 3pm.");
    expect(fail('limit', 'tomorrow')).toBe("You've reached your Claude usage limit. It resets tomorrow.");
    expect(fail('limit', null, 'Claude is overloaded right now. Try again in a minute.')).toBe('Claude is overloaded right now. Try again in a minute.');
    expect(fail('failed', 'API Error: 500.')).toBe('Claude Code stopped with an error: API Error: 500. Try again.');
    expect(fail('no-transcript')).toBe("The office can't find the QA engineer's transcript on this machine, so there's nothing to answer from.");
    expect(fail('not-installed')).toMatch(/^Worklings asks through your own Claude Code and couldn't find it\. .*set WORKLINGS_CLAUDE to its path/);
  });

  it("explain a question the office turned down, or couldn't take at all", () => {
    const refused = (status: number, code: string | null, retryAfter: number | null = null) => refusalCopy({ status, code, message: 'Type a question to ask.', retryAfter });
    expect(refused(0, null)).toBe("The office didn't answer. Is it still running?");
    expect(refused(401, null)).toBe(LOCKED);
    expect(refused(409, 'busy')).toBe('The office is already on a question or a catch-up and does one at a time. Wait for it or cancel it.');
    expect(refused(429, 'rate-limited', 40)).toBe('The office takes a few calls a minute. Try again in 40 seconds.');
    expect(refused(429, 'rate-limited')).toBe('The office takes a few calls a minute. Try again in a minute.');
    expect(refused(400, 'bad-input')).toBe('Type a question to ask.');
    // Over --lan, a phone gets the office's own reason rather than the access-link copy.
    expect(refusalCopy({ status: 403, code: 'local-only', message: 'Questions and catch-ups work only on the computer running the office.', retryAfter: null }))
      .toBe('Questions and catch-ups work only on the computer running the office.');
  });

  it('sign answers with their age and cost, a replay position, or as a demo sample', () => {
    expect(signature(answer(), at(66) + 2 * 60_000 + 5_000, null)).toBe('2 min ago, 0.6¢ on Haiku');
    expect(signature(answer(), at(70), null)).toBe('Just now, 0.6¢ on Haiku');
    expect(signature(answer({ asOf: at(200) }), at(70), at(0))).toBe('At 3m 20s, 0.6¢ on Haiku');
    expect(signature(answer({ source: 'sample', cost: 0 }), at(70), null)).toBe('Sample answer, made up for the demo.');
  });

  it("show a question's words: the office's, else what this tab typed, else that it was your own", () => {
    expect(shownQuestion({ id: 'a1', question: "What's left?" }, {})).toEqual({ shown: "What's left?", text: "What's left?" });
    // The demo keeps no words for a free-text question, so the tab that asked it shows what it typed.
    expect(shownQuestion({ id: 'a2', question: null }, { a2: 'Is the confetti ready?' })).toEqual({ shown: 'Is the confetti ready?', text: 'Is the confetti ready?' });
    // Another tab's, or one asked before this tab opened: nobody here knows the words, so it can't be asked again.
    expect(shownQuestion({ id: 'a3', question: null }, { a2: 'Is the confetti ready?' })).toEqual({ shown: 'Your own question', text: null });
    expect(shownQuestion({ id: '__proto__', question: null }, {})).toEqual({ shown: 'Your own question', text: null });
  });

  it('keep the words of as many questions typed here as the office keeps answers, dropping the oldest', () => {
    let typed: Record<string, string> = {};
    for (let i = 0; i <= ASIDE_ANSWERS_KEPT; i++) typed = withTyped(typed, `call-${i}`, `Question ${i}`);
    expect(Object.keys(typed)).toHaveLength(ASIDE_ANSWERS_KEPT);
    expect(typed['call-0']).toBeUndefined();
    expect(typed[`call-${ASIDE_ANSWERS_KEPT}`]).toBe(`Question ${ASIDE_ANSWERS_KEPT}`);
  });

  it('count a question as the office does, saying how much to shorten it by', () => {
    expect(counter('a'.repeat(120), 500)).toEqual({ text: '120 of 500', over: false });
    expect(counter('a'.repeat(520), 500)).toEqual({ text: '520 of 500. Shorten it by 20 to ask.', over: true });
    expect(counter('🌱'.repeat(3), 500).text).toBe('3 of 500');
  });

  it('put money the way the design does: estimates in words, costs as Claude Code reports them', () => {
    expect([aboutCost(0.004), aboutCost(0.016), aboutCost(0.4), aboutCost(1.2)]).toEqual(['Less than 1¢', 'About 2¢', 'About 40¢', 'About $1.20']);
    expect([spent(0), spent(0.0002), spent(0.004), spent(0.0996), spent(0.14), spent(1.2)]).toEqual(['0¢', 'less than 0.1¢', '0.4¢', '10¢', '14¢', '$1.20']);
  });
});

describe('bubbles while you ask', () => {
  function cast(asks: Partial<CastAsks>, state = office()): Cast {
    return castFrom({ agents: Object.values(state.agents), studio, serverTime: at(80), replay: null }, layout, {
      asks: { running: null, answers: [], open: null, realNow: at(80), ...asks },
    });
  }
  const bubbleOf = (c: Cast, key: string) => c.members.find((m) => m.key === key)?.bubble ?? null;

  it('say "Answering you…" in yellow while a question to them runs', () => {
    expect(bubbleOf(cast({ running: call() }), 'desk:qa-engineer')).toEqual({ tone: 'answering', lead: null, text: 'Answering you…', dot: null });
    // A catch-up isn't anyone's answer.
    expect(bubbleOf(cast({ running: call({ kind: 'catch-up', agentKey: null, roleId: null }) }), 'desk:qa-engineer')?.tone).not.toBe('answering');
  });

  it('say "Answered you" for two minutes while their conversation is closed', () => {
    const answers = [answer({ answeredAt: at(70) })];
    const closed = cast({ answers });
    expect(bubbleOf(closed, 'desk:qa-engineer')?.text).toBe('Answered you');
    expect(closed.nextRealChangeAt).toBe(at(70) + ANSWERED_SHOWN_MS);
    expect(bubbleOf(cast({ answers, open: ROLE }), 'desk:qa-engineer')?.text).not.toBe('Answered you');
    expect(bubbleOf(cast({ answers, realNow: at(70) + ANSWERED_SHOWN_MS }), 'desk:qa-engineer')?.text).not.toBe('Answered you');
    // A failed question isn't an answer.
    expect(bubbleOf(cast({ answers: [answer({ text: null, failure: { code: 'timed-out', message: 'x', detail: null } })] }), 'desk:qa-engineer')?.text).not.toBe('Answered you');
  });

  it('let someone who needs your OK say so first', () => {
    const state = office();
    apply(state, { sessionId: 's', kind: 'permission', at: at(75), agentId: 'q2', tool: 'Bash', target: 'npm run e2e' } as OfficeEvent, index);
    expect(bubbleOf(cast({ running: call() }, state), 'desk:qa-engineer')?.tone).toBe('needs-you');
  });

  it("go to the role's desk for a call that has no figure of its own", () => {
    // The first call is off duty and the desk shows the second: a question to the first still shows at the desk.
    expect(bubbleOf(cast({ running: call({ agentKey: 's:q1' }) }), 'desk:qa-engineer')?.text).toBe('Answering you…');
  });

  it('find the figure a conversation sits beside', () => {
    const members = cast({}).members;
    expect(figureFor(members, ROLE)).toBe('desk:qa-engineer');
    expect(figureFor(members, { roleId: null, agentKey: 's:lead' })).toBe('lead');
    expect(figureFor(members, { roleId: null, agentKey: 's:nobody' })).toBeNull();
  });
});

describe('placing the conversation', () => {
  const free = { left: 12, top: 76, right: 1016, bottom: 888 };
  const size = { w: 320, h: 400 };

  it("sits just under the person's label, to their right, or to their left when only that side has room", () => {
    expect(placeBeside({ x: 400, y: 300 }, size, free)).toMatchObject({ left: 428, top: 304, side: 'right', tail: 20 });
    expect(placeBeside({ x: 900, y: 300 }, size, free)).toMatchObject({ left: 552, top: 304, side: 'left', tail: 20 });
  });

  it("changes sides only when its own lacks 24 px and the other has room, so it doesn't flicker", () => {
    expect(placeBeside({ x: 678, y: 300 }, size, free, 'right')).toMatchObject({ side: 'right', left: 696 });
    expect(placeBeside({ x: 700, y: 300 }, size, free, 'right')).toMatchObject({ side: 'left', left: 352 });
  });

  it('stays inside the free part of the stage, its tail following the person until they are out of reach', () => {
    // Held up from the bottom edge: the tail slides down its edge, kept 20 px from the corner.
    expect(placeBeside({ x: 400, y: 860 }, size, free)).toMatchObject({ top: 488, tail: 380 });
    expect(placeBeside({ x: 400, y: 920 }, size, free).tail).toBeNull();
  });

  it("moves along its side, clear of its person's label, when the stage's foot holds it up over it", () => {
    // Held up 376 px from where it would sit, it would cover the right half of their name tag and bubble.
    expect(placeBeside({ x: 400, y: 860 }, size, free, null, 28, { left: 310, top: 800, right: 490, bottom: 860 })).toMatchObject({ left: 498, top: 488, side: 'right', tail: 380 });
    expect(placeBeside({ x: 900, y: 860 }, size, free, null, 28, { left: 810, top: 800, right: 990, bottom: 860 })).toMatchObject({ left: 482, top: 488, side: 'left' });
    // Under their label, where it belongs, it stays put.
    expect(placeBeside({ x: 400, y: 300 }, size, free, null, 28, { left: 310, top: 240, right: 490, bottom: 300 })).toMatchObject({ left: 428, top: 304 });
  });

  it('pans just enough to show what is hidden, and nothing when all of it shows', () => {
    expect(shiftToShow({ left: 300, top: 300, right: 700, bottom: 700 }, free)).toEqual({ dx: 0, dy: 0 });
    // Under the panel on the right: move it left by what sticks out.
    expect(shiftToShow({ left: 900, top: 300, right: 1100, bottom: 700 }, free)).toEqual({ dx: -84, dy: 0 });
    // Taller than the free area: its top comes first.
    expect(shiftToShow({ left: 300, top: 0, right: 700, bottom: 1000 }, free)).toEqual({ dx: 0, dy: 76 });
  });
});
