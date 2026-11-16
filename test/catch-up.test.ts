import { describe, expect, it } from 'vitest';
import { type AsideCall, type AsideFailureCode, type AsideView, type Digest, emptySpend } from '../src/core/aside.ts';
import { agentKey, apply, emptyOffice, indexStudio } from '../src/core/office.ts';
import type { ReplayInfo } from '../src/core/snapshot.ts';
import type { Studio } from '../src/core/studio.ts';
import { CATCH_UP_FAILED, type CatchUpContext, catchUpView } from '../web/src/hud/catchUpModel.ts';
import { officeCalls } from '../web/src/hud/model.ts';
import { LOCKED } from '../web/src/hud/asideModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';

const T = Date.parse('2026-11-04T13:32:00.000Z');
const min = (m: number) => T + m * 60_000;
const estimate = { input: 4_000, output: 300, cost: 0.012, model: 'claude-haiku-5-5' };

function aside(overrides: Partial<AsideView> = {}): AsideView {
  return { running: null, answers: [], digests: [], catchUp: { since: T, estimate, nothingNew: false }, spend: emptySpend(), ...overrides };
}
const digest = (id: string, since: number, until: number, overrides: Partial<Digest> = {}): Digest => ({
  id, since, until, at: until, source: 'model', text: `What happened up to ${until}.`, failure: null, cost: 0.004, tokens: 4_400, estimated: false, ...overrides,
});
const ctx = (overrides: Partial<CatchUpContext> = {}): CatchUpContext => ({ locked: false, connected: true, sending: false, reply: null, realNow: min(60), ...overrides });
const live = (view: AsideView) => ({ mode: 'live' as const, replay: null, agents: [], aside: view });
const replay: ReplayInfo = { sessionId: 's', title: 'Build', startedAt: T, endedAt: min(10), position: T + 200_000, speed: 4, playing: false };
const replayed = (view: AsideView) => ({ mode: 'replay' as const, replay, agents: [], aside: view });

describe('the line under Catch me up', () => {
  it('says what the next catch-up covers and about what it costs', () => {
    expect(catchUpView(live(aside()), ctx())).toMatchObject({ unavailable: false, running: null, latest: null, line: `Covers ${hourMinute(T)} to now. About 1¢ on Haiku.` });
    expect(catchUpView({ ...live(aside({ catchUp: { since: T, estimate: null, nothingNew: false } })), mode: 'demo' }, ctx()).line).toBe("The demo makes up its catch-ups, so they're free.");
  });

  it('says it in replay time: from the start, or from the last catch-up in it', () => {
    expect(catchUpView(replayed(aside({ catchUp: { since: T - 1, estimate, nothingNew: false } })), ctx()).line).toBe('Covers the replay from the start to 3m 20s. About 1¢ on Haiku.');
    expect(catchUpView(replayed(aside({ catchUp: { since: T + 65_000, estimate, nothingNew: false } })), ctx()).line).toBe('Covers the replay from 1m 5s to 3m 20s. About 1¢ on Haiku.');
  });

  it('turns the button down when nothing is new, saying since when', () => {
    const last = digest('d1', min(0), min(30));
    const sinceLast = catchUpView(live(aside({ digests: [last], catchUp: { since: min(30), estimate, nothingNew: true } })), ctx());
    expect(sinceLast).toMatchObject({ unavailable: true, line: `Nothing new since your last catch-up at ${hourMinute(min(30))}.` });
    expect(catchUpView(live(aside({ catchUp: { since: T, estimate, nothingNew: true } })), ctx()).line).toBe('Nothing happened in the last hour.');
    // The office can be the one to find out: its answer to the press says the same.
    expect(catchUpView(live(aside({ digests: [last], catchUp: { since: min(30), estimate, nothingNew: false } })), ctx({ reply: { kind: 'nothing-new', since: min(30) } })).line).toBe(
      `Nothing new since your last catch-up at ${hourMinute(min(30))}.`,
    );
    expect(catchUpView(replayed(aside({ digests: [digest('d1', T - 1, T + 80_000)], catchUp: { since: T + 80_000, estimate, nothingNew: true } })), ctx()).line).toBe(
      'Nothing new since your last catch-up at 1m 20s into the replay.',
    );
  });

  it('shows a running catch-up with the seconds so far and a Cancel, and says from 30 s when it stops', () => {
    const call: AsideCall = { id: 'c1', kind: 'catch-up', agentKey: null, roleId: null, who: null, question: null, startedAt: min(59), estimate };
    const at12 = catchUpView(live(aside({ running: call })), ctx({ realNow: min(59) + 12_400 }));
    expect(at12).toMatchObject({ unavailable: true, line: 'Haiku is writing your catch-up, 12s so far.', running: { id: 'c1', cancelLabel: 'Cancel the catch-up' } });
    expect(catchUpView(live(aside({ running: call })), ctx({ realNow: min(59) + 34_000 })).line).toBe('Haiku is writing your catch-up, 34s so far. It stops at 60s.');
  });

  it("shows a running question's line and its Cancel instead", () => {
    const studio: Studio = {
      version: 1, name: 'S', domain: 'web-app', rigor: 'lean', departments: [{ id: 'quality', name: 'Quality', style: 'quality' }],
      roles: [{ id: 'qa-engineer', department: 'quality', title: 'QA engineer' }], rules: [], skills: [], gates: [], fired: [],
    };
    const state = emptyOffice();
    apply(state, { kind: 'subagent-start', sessionId: 's', at: T, agentId: 'q', agentType: 'qa-engineer' }, indexStudio(studio));
    const call: AsideCall = { id: 'a1', kind: 'ask', agentKey: agentKey('s', 'q'), roleId: 'qa-engineer', who: 'QA engineer', question: "What's left?", startedAt: min(59), estimate };
    const view = catchUpView({ ...live(aside({ running: call })), agents: Object.values(state.agents) }, ctx({ realNow: min(59) + 6_000 }));
    expect(view).toMatchObject({ unavailable: true, line: 'The QA engineer is answering, 6s so far.', running: { id: 'a1', cancelLabel: 'Cancel the question' } });
  });

  it('says why the last catch-up failed until the next one, with the button ready again', () => {
    const failed = (code: AsideFailureCode, detail: string | null, message = '') =>
      catchUpView(live(aside({ digests: [digest('f', T, min(59), { text: null, failure: { code, message, detail } }), digest('d1', min(0), min(30))] })), ctx());
    expect(failed('cancelled', null)).toMatchObject({ unavailable: false, line: 'Cancelled.', failed: false });
    expect(failed('timed-out', null).failed).toBe(true);
    expect(failed('limit', '3pm').line).toBe(`${CATCH_UP_FAILED} You've reached your Claude usage limit. It resets at 3pm.`);
    expect(failed('failed', 'Something broke.').line).toBe(`${CATCH_UP_FAILED} Claude Code stopped with an error: Something broke. Try again.`);
    expect(failed('not-signed-in', null).line).toBe(`${CATCH_UP_FAILED} Claude Code isn't signed in. Run claude in a terminal, sign in, then try again.`);
    // The failure doesn't hide the catch-up before it.
    expect(failed('timed-out', null).latest?.id).toBe('d1');
  });

  it('says what stops the button: a press the office turned down, no access link, a dropped connection', () => {
    const refused = `${CATCH_UP_FAILED} The office takes a few calls a minute. Try again in 40 seconds.`;
    expect(catchUpView(live(aside()), ctx({ reply: { kind: 'refused', line: refused } }))).toMatchObject({ unavailable: false, line: refused, failed: true });
    expect(catchUpView(live(aside()), ctx({ locked: true }))).toMatchObject({ unavailable: true, line: LOCKED });
    expect(catchUpView(live(aside()), ctx({ connected: false }))).toMatchObject({ unavailable: true, line: 'Catch me up waits until the office reconnects.' });
    expect(catchUpView(live(aside()), ctx({ sending: true })).unavailable).toBe(true);
  });
});

describe('the catch-ups', () => {
  it('shows the newest with its period and what it cost, and folds the two before it', () => {
    const digests = [digest('d3', min(30), min(48)), digest('d2', min(10), min(30)), digest('d1', min(0), min(10))];
    const view = catchUpView(live(aside({ digests })), ctx({ realNow: min(60) }));
    expect(view.latest).toEqual({ id: 'd3', heading: `Your catch-up from ${hourMinute(min(30))} to ${hourMinute(min(48))}`, text: `What happened up to ${min(48)}.`, signature: 'Written 12 min ago for 0.4¢ on Haiku.' });
    expect(view.earlier.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('heads a replay catch-up by its place in the replay, and signs a demo sample as made up', () => {
    expect(catchUpView(replayed(aside({ digests: [digest('r', T - 1, T + 200_000)] })), ctx()).latest?.heading).toBe('Your catch-up on the replay up to 3m 20s');
    expect(catchUpView(replayed(aside({ digests: [digest('r', T + 65_000, T + 200_000)] })), ctx()).latest?.heading).toBe('Your catch-up on the replay from 1m 5s to 3m 20s');
    const sample = catchUpView({ ...live(aside({ digests: [digest('s', T, min(1), { source: 'sample', cost: 0, tokens: 0 })] })), mode: 'demo' }, ctx()).latest;
    expect(sample).toMatchObject({ heading: 'Sample catch-up', signature: 'Made up for the demo. No call to Claude Code.' });
  });

  it('says when a cost is only the estimate: in a signature, and on a stopped catch-up', () => {
    const guessed = digest('g', min(30), min(48), { cost: 0.006, estimated: true });
    expect(catchUpView(live(aside({ digests: [guessed] })), ctx()).latest?.signature).toBe('Written 12 min ago for about 0.6¢ on Haiku, by its estimate.');
    const stopped = digest('c', min(50), min(59), { text: null, failure: { code: 'cancelled', message: 'Cancelled.', detail: null }, cost: 0.012, estimated: true });
    expect(catchUpView(live(aside({ digests: [stopped] })), ctx()).line).toBe('Cancelled. The office counts it at its estimate, about 1.2¢.');
  });

  it('names one time when the period falls within a minute, and shows the digest without Markdown', () => {
    const quick = digest('q', T + 5_000, T + 40_000, { text: 'The **lead** updated `notes.txt`.' });
    expect(catchUpView(live(aside({ digests: [quick] })), ctx()).latest).toMatchObject({ heading: `Your catch-up from ${hourMinute(T)}`, text: 'The lead updated notes.txt.' });
  });
});

describe("the office's own payroll line", () => {
  it('counts its questions and catch-ups, and the demo samples as free', () => {
    expect(officeCalls({ ...emptySpend(), questions: 3, catchUps: 1 })).toBe('3 questions and 1 catch-up');
    expect(officeCalls({ ...emptySpend(), catchUps: 2 })).toBe('2 catch-ups');
    expect(officeCalls({ ...emptySpend(), samples: 2 })).toBe('2 samples, free');
    expect(officeCalls({ ...emptySpend(), questions: 1 })).toBe('1 question');
  });

  it('says how many calls count at their estimate, so an estimate never passes for a reported cost', () => {
    expect(officeCalls({ ...emptySpend(), questions: 3, catchUps: 1, estimated: 1 })).toBe('3 questions and 1 catch-up, 1 at its estimate');
    expect(officeCalls({ ...emptySpend(), catchUps: 2, estimated: 2 })).toBe('2 catch-ups, 2 at their estimate');
  });
});
