import { describe, expect, it } from 'vitest';
import { normalizeHook, type OfficeEvent } from '../src/core/events.ts';
import {
  agentCost, agentKey, apply, assignSession, burnRate, emptyOffice, evict, indexStudio, KEEP_SESSIONS, leadKey, relabel, sweep, totals, type OfficeState,
} from '../src/core/office.ts';
import type { Studio } from '../src/core/studio.ts';
import { newCursor, readUsage } from '../src/core/transcript.ts';
import { payroll } from '../src/core/payroll.ts';
import { personState } from '../src/core/now.ts';
import { hookPayloads, SESSION, SUBAGENT, transcript } from './fixtures.ts';

const studio: Studio = {
  version: 1, name: 'Test', domain: 'custom', rigor: 'lean',
  departments: [{ id: 'quality', name: 'Quality', style: 'quality' }, { id: 'design', name: 'Design', style: 'design' }],
  roles: [{ id: 'reviewer', department: 'quality', title: 'Reviewer' }],
  rules: [], skills: [],
  gates: [{ id: 'design-review', title: 'Design review', from: 'design', to: 'quality' }],
  fired: [],
};
const index = indexStudio(studio);

function replay(upTo?: number): OfficeState {
  const state = emptyOffice();
  hookPayloads().slice(0, upTo).forEach((p, i) => {
    const e = normalizeHook(p, 1000 + i * 1000);
    if (e) apply(state, e, index);
  });
  return state;
}

describe('apply over the captured session', () => {
  it('ends with the lead idle, the reviewer done and the session closed', () => {
    const state = replay();
    const lead = state.agents[leadKey(SESSION)];
    const reviewer = state.agents[agentKey(SESSION, SUBAGENT)];
    expect(Object.keys(state.agents)).toHaveLength(2);
    expect(lead).toMatchObject({ kind: 'lead', name: 'Lead', status: 'idle', toolCalls: 4, files: ['notes.txt'], tool: null });
    expect(reviewer).toMatchObject({
      kind: 'role', roleId: 'reviewer', name: 'Reviewer', status: 'done', toolCalls: 1, task: 'Read notes.txt contents',
      lastMessage: 'The file `notes.txt` contains one line: `hello`.',
    });
    expect(state.sessions[SESSION]).toMatchObject({ ended: true, turns: 1, cwd: '/project', lastPrompt: expect.stringMatching(/^Do these steps/) });
  });

  it('shows the reviewer still working after the lead ended its turn', () => {
    const state = replay(12); // up to the first Stop, before SubagentStop
    expect(state.agents[leadKey(SESSION)]?.status).toBe('idle');
    expect(state.agents[agentKey(SESSION, SUBAGENT)]?.status).toBe('thinking');
  });

  it('shows the current tool while it runs', () => {
    const state = replay(9); // the subagent's Read has started
    expect(state.agents[agentKey(SESSION, SUBAGENT)]?.tool).toMatchObject({ name: 'Read', target: 'notes.txt', phrase: 'Reads notes.txt' });
    expect(state.agents[agentKey(SESSION, SUBAGENT)]?.status).toBe('working');
  });

  it('treats an agent type the studio has no role for as a contractor', () => {
    const state = emptyOffice();
    hookPayloads().forEach((p, i) => {
      const e = normalizeHook(p, i);
      if (e) apply(state, e);
    });
    expect(state.agents[agentKey(SESSION, SUBAGENT)]).toMatchObject({ kind: 'contractor', roleId: null, name: 'Reviewer' });
    relabel(state, index);
    expect(state.agents[agentKey(SESSION, SUBAGENT)]).toMatchObject({ kind: 'role', roleId: 'reviewer' });
  });

  it('matches a running agent to its role by the name Claude Code reports', () => {
    const named = indexStudio({ ...studio, roles: [{ id: 'frontend-developer', department: 'design', title: 'Frontend developer', agent: 'Frontend Developer' }] });
    const state = emptyOffice();
    apply(state, { kind: 'subagent-start', at: 1, sessionId: 's', agentId: 'a1', agentType: 'Frontend Developer' }, named);
    expect(state.agents[agentKey('s', 'a1')]).toMatchObject({ kind: 'role', roleId: 'frontend-developer', name: 'Frontend developer' });
  });

  it('keeps a readable activity log', () => {
    const lines = replay().activity.map((a) => `${a.who}: ${a.text}`);
    expect(lines[0]).toMatch(/^You: Do these steps in order/);
    expect(lines).toContain('Lead: Writes notes.txt');
    expect(lines).toContain('Lead: Briefs reviewer: Read notes.txt contents');
    expect(lines).toContain('Reviewer: Starts on: Read notes.txt contents');
    expect(lines).toContain('Reviewer: Reads notes.txt');
    expect(lines).toContain('Reviewer: Reports back');
    expect(lines).toContain('Lead: A background task finished');
    expect(lines).toContain('Lead: Done for now');
  });
});

describe('usage and cost', () => {
  it("adds up tokens per person and matches Claude Code's cost", () => {
    const state = replay();
    const usage = [
      ...readUsage(transcript('main'), newCursor(), { sessionId: SESSION, fallbackTime: 0 }),
      ...readUsage(transcript('subagent'), newCursor(), { sessionId: SESSION, agentId: SUBAGENT, agentType: 'reviewer', fallbackTime: 0 }),
    ];
    for (const e of usage) apply(state, e, index);
    expect(state.agents[leadKey(SESSION)]?.usage.output).toBe(1073);
    expect(state.agents[agentKey(SESSION, SUBAGENT)]?.usage.output).toBe(299);
    expect(state.agents[agentKey(SESSION, SUBAGENT)]?.requests).toBe(2);
    const t = totals(state);
    expect(t.cost).toBeCloseTo(0.012947045, 9);
    expect(t.costExact).toBe(false);
    expect(t.usage.input + t.usage.output + t.usage.cacheRead + t.usage.cacheWrite5m + t.usage.cacheWrite1h).toBe(16 + 1372 + 189_502 + 54_110);
  });

  it('prefers OpenTelemetry cost when it arrives', () => {
    const state = emptyOffice();
    apply(state, { kind: 'usage', at: 1, sessionId: 's', messageId: 'm', model: 'claude-opus-5-5', usage: { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } });
    expect(totals(state).cost).toBeCloseTo(20, 6);
    apply(state, { kind: 'cost', at: 2, sessionId: 's', costUsd: 19.5 });
    expect(totals(state)).toMatchObject({ cost: 19.5, costExact: true });
  });

  it('uses reported cost only once it covers every request', () => {
    const state = emptyOffice();
    const u = { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    apply(state, { kind: 'usage', at: 1, sessionId: 's', messageId: 'm1', model: 'claude-opus-5-5', usage: u });
    apply(state, { kind: 'usage', at: 2, sessionId: 's', messageId: 'm2', model: 'claude-opus-5-5', usage: u });
    // The office started mid-session: telemetry has reported one request of the two the transcript shows.
    apply(state, { kind: 'cost', at: 3, sessionId: 's', costUsd: 0.01 });
    const lead = state.agents[leadKey('s')];
    if (!lead) throw new Error('no lead');
    expect(agentCost(lead)).toBeCloseTo(lead.costEstimate, 9);
    expect(lead.costEstimate).toBeGreaterThan(1);
    expect(totals(state).costExact).toBe(false);
    apply(state, { kind: 'cost', at: 4, sessionId: 's', costUsd: 0.02 });
    expect(agentCost(lead)).toBeCloseTo(0.03, 9);
    expect(totals(state).costExact).toBe(true);
  });

  it('folds old sessions into the archive without losing their cost', () => {
    const state = emptyOffice();
    const u = { input: 0, output: 100_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    for (let i = 0; i < KEEP_SESSIONS + 3; i++) {
      apply(state, { kind: 'usage', at: i, sessionId: `s${i}`, messageId: `m${i}`, model: 'claude-opus-5-5', usage: u });
      apply(state, { kind: 'subagent-start', at: i, sessionId: `s${i}`, agentId: `a${i}`, agentType: 'Explore' });
      apply(state, { kind: 'session-end', at: i, sessionId: `s${i}` });
    }
    const before = totals(state);
    expect(evict(state, 100)).toEqual(['s2', 's1', 's0']);
    expect(Object.keys(state.sessions)).toHaveLength(KEEP_SESSIONS);
    expect(Object.keys(state.agents)).toHaveLength(KEEP_SESSIONS * 2);
    expect(totals(state).cost).toBeCloseTo(before.cost, 9);
    expect(totals(state).usage).toEqual(before.usage);
    expect(state.archive).toMatchObject({ sessions: 3, people: { lead: { shifts: 3, requests: 3 }, Explore: { kind: 'contractor', shifts: 3 } } });
    const p = payroll(Object.values(state.agents), null, Object.values(state.archive.people));
    expect(p.total.cost).toBeCloseTo(before.cost, 9);
    // Sessions still running, or the most recent ones, stay whatever their age.
    expect(evict(state, 10 ** 12)).toEqual([]);
  });

  it('counts tokens from unknown models separately instead of guessing a price', () => {
    const state = emptyOffice();
    apply(state, { kind: 'usage', at: 1, sessionId: 's', messageId: 'm', model: 'claude-future-9', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } });
    expect(totals(state)).toMatchObject({ cost: 0, unpricedTokens: 15 });
  });

  it('computes the burn rate over a window', () => {
    const state = emptyOffice();
    const u = { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    apply(state, { kind: 'usage', at: 60_000, sessionId: 's', messageId: 'a', model: 'claude-sonnet-5-5', usage: u });
    apply(state, { kind: 'usage', at: 120_000, sessionId: 's', messageId: 'b', model: 'claude-sonnet-5-5', usage: u });
    const rate = burnRate(state, 120_000, 5 * 60_000);
    expect(rate.dollarsPerHour).toBeCloseTo(240, 6); // $20 spent in a 5-minute window
  });
});

describe('statuses', () => {
  type WithoutSession<T> = T extends unknown ? Omit<T, 'sessionId'> : never;
  const at = (n: number) => n * 1000;
  const ev = (e: WithoutSession<OfficeEvent>) => ({ sessionId: 's', ...e }) as OfficeEvent;

  it('raises a hand for permission, shows errors and recovers on the next tool', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'permission', at: at(1), tool: 'Bash', target: 'npm test' }));
    expect(state.agents[leadKey('s')]?.status).toBe('waiting');
    apply(state, ev({ kind: 'tool-start', at: at(2), toolUseId: 't1', tool: 'Bash', target: 'npm test' }));
    apply(state, ev({ kind: 'tool-end', at: at(3), toolUseId: 't1', tool: 'Bash', ok: false, error: 'Exit code 1' }));
    expect(state.agents[leadKey('s')]).toMatchObject({ status: 'error', error: 'Exit code 1', toolErrors: 1 });
    apply(state, ev({ kind: 'tool-start', at: at(4), toolUseId: 't2', tool: 'Read', target: 'a.ts' }));
    expect(state.agents[leadKey('s')]).toMatchObject({ status: 'working', error: null });
  });

  it('opens a gate while its skill runs and closes it when the turn ends', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'tool-start', at: at(1), toolUseId: 't', tool: 'Skill', target: 'design-review' }), index);
    expect(state.gateRuns).toEqual([{ gateId: 'design-review', sessionId: 's', agentKey: leadKey('s'), since: at(1), until: null }]);
    expect(state.agents[leadKey('s')]?.skill).toBe('design-review');
    apply(state, ev({ kind: 'turn-end', at: at(5), failed: false }), index);
    expect(state.gateRuns[0]?.until).toBe(at(5));
    expect(state.agents[leadKey('s')]?.skill).toBeNull();
  });

  it('tracks agent-team tasks', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'task', at: at(1), taskId: '1', title: 'Parser', status: 'open', owner: 'backend' }));
    apply(state, ev({ kind: 'task', at: at(2), taskId: '1', title: 'Parser', status: 'done' }));
    expect(state.tasks['s:1']).toMatchObject({ status: 'done', owner: 'backend', doneAt: at(2) });
    // Task ids start over in every team, so another session's task 1 is a different task.
    apply(state, { kind: 'task', at: at(3), sessionId: 's2', taskId: '1', title: 'Docs', status: 'open' });
    expect(Object.values(state.tasks).map((t) => [t.sessionId, t.title, t.status])).toEqual([['s', 'Parser', 'done'], ['s2', 'Docs', 'open']]);
  });

  it('keeps ids like __proto__ as plain keys', () => {
    const state = emptyOffice();
    apply(state, { kind: 'prompt', at: 1, sessionId: '__proto__', text: 'hi', notification: false });
    apply(state, { kind: 'usage', at: 2, sessionId: 's', messageId: 'm', model: '__proto__', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } });
    expect(Object.keys(state.sessions)).toEqual(['__proto__', 's']);
    expect(state.agents[leadKey('s')]?.models['__proto__']).toBe(1);
    expect(Object.prototype).not.toHaveProperty('turns');
    expect(Object.prototype).not.toHaveProperty('transcriptPath');
  });

  it('says since when someone has been at work, without restarting the clock on every tool call', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'prompt', at: at(1), text: 'Plan the importer', notification: false }));
    const lead = () => state.agents[leadKey('s')];
    expect(lead()).toMatchObject({ status: 'thinking', statusSince: at(1) });
    apply(state, ev({ kind: 'tool-start', at: at(2), toolUseId: 't1', tool: 'Read', target: 'a.ts' }));
    apply(state, ev({ kind: 'tool-end', at: at(3), toolUseId: 't1', tool: 'Read', ok: true }));
    apply(state, ev({ kind: 'tool-start', at: at(4), toolUseId: 't2', tool: 'Bash', target: 'npm test' }));
    expect(lead()).toMatchObject({ status: 'working', statusSince: at(1) });
    apply(state, ev({ kind: 'permission', at: at(5), tool: 'Bash', target: 'npm test' }));
    expect(lead()).toMatchObject({ status: 'waiting', statusSince: at(5) });
    apply(state, ev({ kind: 'tool-end', at: at(6), toolUseId: 't2', tool: 'Bash', ok: false, error: 'Exit code 1' }));
    expect(lead()).toMatchObject({ status: 'error', statusSince: at(6) });
    apply(state, ev({ kind: 'turn-end', at: at(7), failed: false, lastMessage: 'Tests fail on the parser.' }));
    expect(lead()).toMatchObject({ status: 'idle', statusSince: at(7), lastMessage: 'Tests fail on the parser.', reportedAt: at(7) });
  });

  it('dates a subagent report and the moment a quiet one was retired', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'subagent-start', at: at(1), agentId: 'x', agentType: 'qa-engineer' }));
    apply(state, ev({ kind: 'subagent-stop', at: at(9), agentId: 'x', agentType: 'qa-engineer', lastMessage: 'All green.' }));
    expect(state.agents[agentKey('s', 'x')]).toMatchObject({ status: 'done', statusSince: at(9), reportedAt: at(9) });
    apply(state, ev({ kind: 'subagent-start', at: at(10), agentId: 'y', agentType: 'Explore' }));
    sweep(state, at(10) + 16 * 60_000);
    // It most likely stopped at its last event, not when the office noticed.
    expect(state.agents[agentKey('s', 'y')]).toMatchObject({ status: 'done', statusSince: at(10), reportedAt: null });
  });

  it('remembers which request of the person each piece of work serves', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'prompt', at: at(1), text: 'Build the importer', notification: false }));
    apply(state, ev({ kind: 'tool-start', at: at(2), toolUseId: 't1', tool: 'Agent', target: 'qa-engineer: Test the importer', spawn: { agentType: 'qa-engineer', description: 'Test the importer' } }));
    apply(state, ev({ kind: 'subagent-start', at: at(3), agentId: 'q', agentType: 'qa-engineer' }));
    // A background task finishing is not a new request.
    apply(state, ev({ kind: 'prompt', at: at(4), text: 'A background task finished', notification: true }));
    expect(state.agents[leadKey('s')]?.purpose).toBe('Build the importer');
    expect(state.agents[agentKey('s', 'q')]).toMatchObject({ task: 'Test the importer', purpose: 'Build the importer' });
    apply(state, ev({ kind: 'prompt', at: at(5), text: 'Now build the exporter', notification: false }));
    expect(state.agents[leadKey('s')]?.purpose).toBe('Now build the exporter');
    expect(state.agents[agentKey('s', 'q')]?.purpose).toBe('Build the importer');
  });

  it('keeps a question open until it is answered or the lead moves on', () => {
    const state = emptyOffice();
    const lead = () => state.agents[leadKey('s')];
    apply(state, ev({ kind: 'tool-start', at: at(1), toolUseId: 'q1', tool: 'AskUserQuestion', target: 'asking you a question', ask: 'Which chart library?' }));
    expect(lead()?.question).toEqual({ text: 'Which chart library?', at: at(1), source: 'ask' });
    apply(state, ev({ kind: 'tool-end', at: at(2), toolUseId: 'q1', tool: 'AskUserQuestion', ok: true }));
    expect(lead()?.question).toBeNull();
    apply(state, ev({ kind: 'turn-end', at: at(3), failed: false, lastMessage: 'Built it. Want the docs too?', question: 'Want the docs too?' }));
    expect(lead()?.question).toMatchObject({ text: 'Want the docs too?', source: 'message' });
    apply(state, ev({ kind: 'prompt', at: at(4), text: 'yes', notification: false }));
    expect(lead()?.question).toBeNull();
    // A subagent's question stands until its lead's turn ends.
    apply(state, ev({ kind: 'subagent-start', at: at(5), agentId: 'x', agentType: 'qa-engineer' }));
    apply(state, ev({ kind: 'subagent-stop', at: at(6), agentId: 'x', agentType: 'qa-engineer', lastMessage: 'Two fail. Retry?', question: 'Retry?' }));
    expect(state.agents[agentKey('s', 'x')]?.question?.text).toBe('Retry?');
    apply(state, ev({ kind: 'turn-end', at: at(7), failed: false, lastMessage: 'QA found two failures.' }));
    expect(state.agents[agentKey('s', 'x')]?.question).toBeNull();
    expect(lead()?.question).toBeNull();
  });

  it('keeps the request when the person only answers "yes" or "go on"', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'prompt', at: at(1), text: 'fix it', notification: false }));
    expect(state.agents[leadKey('s')]?.purpose).toBe('fix it');
    apply(state, ev({ kind: 'prompt', at: at(2), text: 'Add a watering streak to the home screen', notification: false }));
    apply(state, ev({ kind: 'prompt', at: at(3), text: 'yes go on', notification: false }));
    expect(state.agents[leadKey('s')]?.purpose).toBe('Add a watering streak to the home screen');
    apply(state, ev({ kind: 'subagent-start', at: at(4), agentId: 'x', agentType: 'qa-engineer' }));
    expect(state.agents[agentKey('s', 'x')]?.purpose).toBe('Add a watering streak to the home screen');
  });

  it('says what someone waits for your OK on, what they were refused, and whether an error stopped the turn', () => {
    const state = emptyOffice();
    const lead = () => state.agents[leadKey('s')];
    apply(state, ev({ kind: 'permission', at: at(1), tool: 'Bash', target: 'npm install' }));
    expect(lead()).toMatchObject({ status: 'waiting', waitingFor: 'run npm install' });
    apply(state, ev({ kind: 'permission-denied', at: at(2), tool: 'Bash', target: 'npm install' }));
    expect(lead()).toMatchObject({ status: 'thinking', waitingFor: null, refused: { what: 'run npm install', at: at(2) } });
    apply(state, ev({ kind: 'tool-start', at: at(3), toolUseId: 't', tool: 'Bash', target: 'npm test' }));
    apply(state, ev({ kind: 'tool-end', at: at(4), toolUseId: 't', tool: 'Bash', ok: false, error: 'Exit code 1' }));
    expect(lead()).toMatchObject({ status: 'error', errorFrom: 'tool' });
    apply(state, ev({ kind: 'turn-end', at: at(5), failed: true, lastMessage: 'API Error: overloaded' }));
    expect(lead()).toMatchObject({ status: 'error', errorFrom: 'turn', error: 'API Error: overloaded' });
    apply(state, ev({ kind: 'prompt', at: at(6), text: 'Try that again please', notification: false }));
    expect(lead()).toMatchObject({ status: 'thinking', errorFrom: null });
  });

  it('keeps the clock of a piece of work through waits and passing errors, and restarts it for the next one', () => {
    const state = emptyOffice();
    const lead = () => state.agents[leadKey('s')];
    apply(state, ev({ kind: 'prompt', at: at(1), text: 'Build the importer for us', notification: false }));
    apply(state, ev({ kind: 'permission', at: at(60), tool: 'Bash', target: 'npm install' }));
    apply(state, ev({ kind: 'tool-start', at: at(90), toolUseId: 't', tool: 'Bash', target: 'npm install' }));
    apply(state, ev({ kind: 'tool-end', at: at(100), toolUseId: 't', tool: 'Bash', ok: false, error: 'Exit code 1' }));
    expect(lead()).toMatchObject({ status: 'error', statusSince: at(100), busySince: at(1) });
    expect(personState(lead() as NonNullable<ReturnType<typeof lead>>, at(110))).toMatchObject({ kind: 'on-it', since: at(1) });
    apply(state, ev({ kind: 'tool-start', at: at(120), toolUseId: 't2', tool: 'Read', target: 'a.ts' }));
    apply(state, ev({ kind: 'turn-end', at: at(200), failed: false, lastMessage: 'Done.' }));
    apply(state, ev({ kind: 'prompt', at: at(300), text: 'Now build the exporter', notification: false }));
    expect(lead()?.busySince).toBe(at(300));
  });

  it('keeps the size of the latest prompt, which a side question would have to read', () => {
    const state = emptyOffice();
    const u = (cacheRead: number) => ({ input: 5, output: 300, cacheRead, cacheWrite5m: 100, cacheWrite1h: 1000 });
    apply(state, ev({ kind: 'usage', at: at(1), messageId: 'm1', model: 'claude-opus-5-5', usage: u(20_000) }));
    apply(state, ev({ kind: 'usage', at: at(2), messageId: 'm2', model: 'claude-opus-5-5', usage: u(48_000) }));
    expect(state.agents[leadKey('s')]?.contextTokens).toBe(5 + 48_000 + 100 + 1000);
  });

  it('logs tool calls and the failures an agent works around as steps, and what the story tells as milestones', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'prompt', at: at(1), text: 'Build the importer for us', notification: false }));
    apply(state, ev({ kind: 'tool-start', at: at(2), toolUseId: 't1', tool: 'Bash', target: 'npm test' }));
    apply(state, ev({ kind: 'tool-end', at: at(3), toolUseId: 't1', tool: 'Bash', ok: false, error: 'Exit code 1' }));
    apply(state, ev({ kind: 'prompt', at: at(4), text: 'A background task finished', notification: true }));
    apply(state, ev({ kind: 'compact', at: at(5), phase: 'start' }));
    apply(state, ev({ kind: 'turn-end', at: at(6), failed: false, lastMessage: 'The importer is in.' }));
    apply(state, ev({ kind: 'turn-end', at: at(7), failed: false }));
    expect(state.activity.map((e) => [e.kind, e.text])).toEqual([
      ['milestone', 'Build the importer for us'],
      ['step', 'Runs npm test'],
      ['step', "Couldn't run npm test: Exit code 1"],
      ['step', 'A background task finished'],
      ['step', 'Tidies up the conversation to free context'],
      ['milestone', 'Done for now'],
      // A second end with nothing to say adds nothing to the story.
      ['step', 'Done for now'],
    ]);
  });

  it('retires subagents that went quiet', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'subagent-start', at: at(1), agentId: 'x', agentType: 'qa-engineer' }));
    expect(sweep(state, at(1) + 5 * 60_000)).toBe(false);
    expect(sweep(state, at(1) + 16 * 60_000)).toBe(true);
    expect(state.agents[agentKey('s', 'x')]).toMatchObject({ status: 'done', endedAt: at(1) });
    expect(sweep(state, at(1) + 17 * 60_000)).toBe(false);
  });
});

describe('briefs sent with SendMessage', () => {
  type WithoutSession<T> = T extends unknown ? Omit<T, 'sessionId'> : never;
  const at = (n: number) => n * 1000;
  const ev = (e: WithoutSession<OfficeEvent>) => ({ sessionId: 's', ...e }) as OfficeEvent;
  const reviewerIndex = indexStudio({ ...studio, roles: [{ id: 'security-reviewer', department: 'quality', title: 'Security reviewer' }] });
  const ID = 'a4e964624f302ccfe';
  const who = { agentId: ID, agentType: 'security-reviewer' };
  const send = (t: number, description: string, to = ID) =>
    ev({ kind: 'tool-start', at: at(t), toolUseId: `send-${t}`, tool: 'SendMessage', target: '', brief: { agentId: to, description } });
  const briefs = (state: OfficeState) =>
    state.activity.flatMap((e) => (e.kind === 'milestone' && e.milestone.type === 'briefed' ? [[e.at, e.agentKey, e.milestone.task, e.milestone.by]] : []));
  function play(...events: OfficeEvent[]) {
    const state = emptyOffice();
    for (const e of events) apply(state, e, reviewerIndex);
    return state;
  }

  it('briefs a subagent the office knows again: its goal, the request it serves and when', () => {
    const state = play(
      ev({ kind: 'prompt', at: at(1), text: 'Fix the security findings in the importer', notification: false }),
      ev({ kind: 'subagent-start', at: at(2), ...who }),
      ev({ kind: 'subagent-stop', at: at(9), ...who, lastMessage: 'Two findings: an open redirect and a missing check.' }),
      ev({ kind: 'prompt', at: at(10), text: 'Now have the fixes checked again', notification: false }),
      send(11, 'Re-check the security fixes'),
    );
    expect(state.agents[agentKey('s', ID)]).toMatchObject({
      task: 'Re-check the security fixes', purpose: 'Now have the fixes checked again', briefedAt: at(11), status: 'done',
    });
    expect(briefs(state)).toEqual([
      [at(2), agentKey('s', ID), null, leadKey('s')],
      [at(11), agentKey('s', ID), 'Re-check the security fixes', leadKey('s')],
    ]);
    // Its start when it picks the message up is that brief's, not another one.
    apply(state, ev({ kind: 'subagent-start', at: at(12), ...who }), reviewerIndex);
    expect(state.agents[agentKey('s', ID)]).toMatchObject({ status: 'thinking', briefedAt: at(11), endedAt: null });
    expect(briefs(state)).toHaveLength(2);
  });

  it("keeps a brief for a subagent it hasn't seen until that subagent starts", () => {
    const state = play(
      ev({ kind: 'prompt', at: at(1), text: 'Fix the security findings in the importer', notification: false }),
      send(2, 'Re-check the security fixes'),
    );
    expect(state.agents[agentKey('s', ID)]).toBeUndefined();
    apply(state, ev({ kind: 'subagent-start', at: at(3), ...who }), reviewerIndex);
    expect(state.agents[agentKey('s', ID)]).toMatchObject({
      task: 'Re-check the security fixes', purpose: 'Fix the security findings in the importer', briefedAt: at(3), status: 'thinking',
    });
    expect(briefs(state)).toEqual([[at(3), agentKey('s', ID), 'Re-check the security fixes', leadKey('s')]]);
  });

  it('gives the brief to the subagent when its first sign of life is a tool call', () => {
    const state = play(send(2, 'Re-check the security fixes'), ev({ kind: 'tool-start', at: at(3), ...who, toolUseId: 'r', tool: 'Read', target: 'src/auth.ts' }));
    expect(state.agents[agentKey('s', ID)]).toMatchObject({ task: 'Re-check the security fixes', briefedAt: at(3), status: 'working' });
    expect(briefs(state)).toHaveLength(1);
  });

  it('matches an Agent call by type and a SendMessage by id, never one for the other', () => {
    const state = play(
      ev({ kind: 'tool-start', at: at(1), toolUseId: 'spawn', tool: 'Agent', target: '', spawn: { agentType: 'security-reviewer', description: 'Review the importer' } }),
      send(2, 'Re-check the security fixes', 'b5e964624f302ccfe'),
      ev({ kind: 'subagent-start', at: at(3), ...who }),
    );
    expect(state.agents[agentKey('s', ID)]).toMatchObject({ task: 'Review the importer', briefedAt: at(3) });
    expect(state.pendingBriefs.s).toEqual([{ by: leadKey('s'), description: 'Re-check the security fixes', agentId: 'b5e964624f302ccfe' }]);
  });

  it('never briefs the lead through an id that names it, and keeps only the latest 50 waiting briefs', () => {
    const state = play(ev({ kind: 'prompt', at: at(1), text: 'Plan the importer with the team', notification: false }), send(2, 'Message for the lead', 'lead'));
    expect(state.agents[leadKey('s')]).toMatchObject({ task: null, briefedAt: null });
    expect(briefs(state)).toEqual([]);
    for (let i = 0; i < 60; i++) apply(state, send(3 + i, `Brief ${i}`, `teammate-${i}`), reviewerIndex);
    expect(state.pendingBriefs.s).toHaveLength(50);
    expect(state.pendingBriefs.s?.[0]).toMatchObject({ description: 'Brief 10' });
  });
});

describe("a company's desks", () => {
  const withDesigner: Studio = { ...studio, roles: [...studio.roles, { id: 'ux-designer', department: 'design', title: 'UX designer' }] };
  const desks = indexStudio(withDesigner);
  const prompt = (sessionId: string, at: number, text: string): OfficeEvent => ({ kind: 'prompt', at, sessionId, text, notification: false });
  const usage = (sessionId: string, at: number): OfficeEvent => ({
    kind: 'usage', at, sessionId, messageId: `m-${sessionId}-${at}`, model: 'claude-sonnet-5-5', usage: { input: 0, output: 1_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  });

  it("draws a desk's session as its person, and leaves the folder's other sessions as visitors", () => {
    const state = emptyOffice();
    apply(state, prompt('desk', 1, 'From Ada, head of design: make the palette darker'), desks);
    apply(state, prompt('visitor', 2, 'Run the tests for me please'), desks);
    expect(assignSession(state, 'desk', 'ux-designer', desks)).toBe(true);
    expect(assignSession(state, 'desk', 'ux-designer', desks)).toBe(false);
    expect(state.agents[leadKey('desk')]).toMatchObject({ kind: 'role', roleId: 'ux-designer', name: 'UX designer', agentType: 'ux-designer', agentId: null });
    expect(state.agents[leadKey('visitor')]).toMatchObject({ kind: 'lead', roleId: null, name: 'Lead' });
  });

  it('draws a session assigned before its first event as the person from the start, at work as a session lead is', () => {
    const state = emptyOffice();
    assignSession(state, 'desk', 'ux-designer', desks);
    apply(state, prompt('desk', 1, 'From the CEO: draft the palette'), desks);
    apply(state, { kind: 'tool-start', at: 2, sessionId: 'desk', toolUseId: 't', tool: 'Read', target: 'theme.css' }, desks);
    expect(state.agents[leadKey('desk')]).toMatchObject({ kind: 'role', roleId: 'ux-designer', status: 'working', purpose: 'From the CEO: draft the palette' });
  });

  it('shows a fired person as a contractor until a rehire, and keeps their cost on their own line', () => {
    const state = emptyOffice();
    assignSession(state, 'desk', 'ux-designer', desks);
    apply(state, usage('desk', 1), desks);
    relabel(state, index);
    expect(state.agents[leadKey('desk')]).toMatchObject({ kind: 'contractor', roleId: null, name: 'UX designer' });
    relabel(state, desks);
    expect(state.agents[leadKey('desk')]).toMatchObject({ kind: 'role', roleId: 'ux-designer' });
    const lines = payroll(Object.values(state.agents), withDesigner).lines.map((l) => [l.id, l.kind]);
    expect(lines).toContainEqual(['ux-designer', 'role']);
    expect(lines).not.toContainEqual(['lead', 'lead']);
  });

  it('forgets which person a session was once it folds into the archive, under their role', () => {
    const state = emptyOffice();
    for (let i = 0; i <= KEEP_SESSIONS; i++) {
      apply(state, usage(`s${i}`, i + 1), desks);
      apply(state, { kind: 'session-end', at: i + 1, sessionId: `s${i}` }, desks);
    }
    assignSession(state, 's0', 'ux-designer', desks);
    expect(evict(state, 100)).toEqual(['s0']);
    expect(Object.keys(state.assigned)).toEqual([]);
    expect(state.archive.people['ux-designer']).toMatchObject({ kind: 'role', shifts: 1, requests: 1 });
  });

  it('keeps a session id like __proto__ a plain key', () => {
    const state = emptyOffice();
    assignSession(state, '__proto__', 'ux-designer', desks);
    apply(state, prompt('__proto__', 1, 'From the CEO: hello there friend'), desks);
    expect(state.agents[leadKey('__proto__')]).toMatchObject({ kind: 'role', roleId: 'ux-designer' });
    expect(Object.prototype).not.toHaveProperty('ux-designer');
  });
});
