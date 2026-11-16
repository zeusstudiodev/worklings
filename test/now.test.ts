import { describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import type { OfficeEvent } from '../src/core/events.ts';
import { agentKey, apply, emptyOffice, indexStudio, leadKey, type OfficeState } from '../src/core/office.ts';
import {
  coarseAge, coarseDuration, DONE_FOR_MS, FOLD_ROWS, goalOf, LINE_CHARS, mostUrgent, needsYou, needsYouSentence, nowBoard, personRow, personState,
  plainText, quote, RESULT_CHARS, STUCK_AFTER_MS,
} from '../src/core/now.ts';
import type { Studio } from '../src/core/studio.ts';
import { replayEvents } from '../src/core/transcript.ts';
import { demoScript, demoStudio } from '../src/server/demo.ts';
import { SESSION, transcript } from './fixtures.ts';

type WithoutSession<T> = T extends unknown ? Omit<T, 'sessionId'> : never;
const at = (n: number) => n * 1000;
const ev = (e: WithoutSession<OfficeEvent>) => ({ sessionId: 's', ...e }) as OfficeEvent;

function lead(state: OfficeState) {
  const a = state.agents[leadKey('s')];
  if (!a) throw new Error('no lead');
  return a;
}

describe('personState', () => {
  it('is on it while working, and mentions a step only once it has run over a minute', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'prompt', at: at(1), text: 'Plan the importer for us', notification: false }));
    apply(state, ev({ kind: 'tool-start', at: at(2), toolUseId: 't', tool: 'Bash', target: 'npm test' }));
    expect(personState(lead(state), at(30))).toEqual({ kind: 'on-it', since: at(1), step: null });
    expect(personState(lead(state), at(70))).toEqual({ kind: 'on-it', since: at(1), step: { phrase: 'Runs npm test', since: at(2) } });
  });

  it('needs your OK, naming what for', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'permission', at: at(1), tool: 'Bash', target: 'npm install' }));
    const s = personState(lead(state), at(5));
    expect(s).toEqual({ kind: 'needs-ok', since: at(1), what: 'run npm install' });
    expect(needsYou(s)).toBe(true);
  });

  it('needs an answer while a question to you is open, with or without its text', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'tool-start', at: at(1), toolUseId: 'q', tool: 'AskUserQuestion', target: 'asking you a question', ask: 'Which chart library?' }));
    expect(personState(lead(state), at(2))).toEqual({ kind: 'needs-answer', since: at(1), question: 'Which chart library?' });
    const other = emptyOffice();
    apply(other, ev({ kind: 'notice', at: at(1), message: 'Claude needs your input', needsYou: true }));
    expect(personState(lead(other), at(2))).toEqual({ kind: 'needs-answer', since: at(1), question: null });
  });

  it('reads a failed command as on it for 30 seconds, then as stuck; a failed turn is stuck at once', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'tool-start', at: at(1), toolUseId: 't', tool: 'Bash', target: 'npm test' }));
    apply(state, ev({ kind: 'tool-end', at: at(2), toolUseId: 't', tool: 'Bash', ok: false, error: 'Exit code 1' }));
    expect(personState(lead(state), at(2) + STUCK_AFTER_MS - 1).kind).toBe('on-it');
    expect(personState(lead(state), at(2) + STUCK_AFTER_MS)).toEqual({ kind: 'stuck', since: at(2), error: 'Exit code 1' });
    apply(state, ev({ kind: 'turn-end', at: at(3), failed: true, lastMessage: 'API Error: overloaded' }));
    expect(personState(lead(state), at(3))).toEqual({ kind: 'stuck', since: at(2), error: 'API Error: overloaded' });
  });

  it('has a question when a report ends with one, and is done with its result otherwise', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'subagent-start', at: at(1), agentId: 'x', agentType: 'qa-engineer' }));
    apply(state, ev({ kind: 'subagent-stop', at: at(9), agentId: 'x', agentType: 'qa-engineer', lastMessage: 'Two fail. Retry?', question: 'Retry?' }));
    const qa = state.agents[agentKey('s', 'x')];
    if (!qa) throw new Error('no qa');
    expect(personState(qa, at(10))).toEqual({ kind: 'has-question', since: at(9), question: 'Retry?' });
    apply(state, ev({ kind: 'turn-end', at: at(11), failed: false, lastMessage: 'QA found two failures.' }));
    expect(personState(qa, at(12))).toEqual({ kind: 'done', since: at(9), result: 'Two fail. Retry?' });
    expect(personState(lead(state), at(12))).toEqual({ kind: 'done', since: at(11), result: 'QA found two failures.' });
  });

  it('is idle before it has done anything', () => {
    const state = emptyOffice();
    apply(state, ev({ kind: 'usage', at: at(1), messageId: 'm', model: 'claude-opus-5-5', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } }));
    expect(personState(lead(state), at(2))).toEqual({ kind: 'idle', since: at(1) });
  });
});

// The Now board, through sessions written as the office sees them.
const studio: Studio = {
  version: 1, name: 'Importer', domain: 'web-app', rigor: 'standard',
  departments: [
    { id: 'engineering', name: 'Engineering', style: 'engineering' }, { id: 'quality', name: 'Quality', style: 'quality' },
    { id: 'design', name: 'Design', style: 'design' }, { id: 'content', name: 'Content', style: 'content' },
  ],
  roles: [
    { id: 'backend-engineer', department: 'engineering', title: 'Backend engineer' },
    { id: 'mobile-engineer', department: 'engineering', title: 'Mobile engineer' },
    { id: 'qa-engineer', department: 'quality', title: 'QA engineer' },
    { id: 'code-reviewer', department: 'quality', title: 'Code reviewer' },
    { id: 'ux-designer', department: 'design', title: 'UX designer' },
    { id: 'copywriter', department: 'content', title: 'Copywriter' },
  ],
  rules: [], skills: [], gates: [], fired: [],
};
const index = indexStudio(studio);

const T0 = Date.parse('2026-11-04T10:00:00.000Z');
const m = (minutes: number) => T0 + minutes * 60_000;
type Who = { agentId: string; agentType: string } | null;
const who = (agentId: string, agentType: string): Who => ({ agentId, agentType });
const fields = (w: Who) => w ?? {};

const ask = (s: string, at: number, text: string): OfficeEvent[] => [{ kind: 'prompt', sessionId: s, at, text, notification: false }];
function brief(s: string, at: number, w: Who, task: string | null): OfficeEvent[] {
  if (!w) throw new Error('only subagents are briefed');
  const toolUseId = `spawn-${w.agentId}`;
  return [
    { kind: 'tool-start', sessionId: s, at, toolUseId, tool: 'Agent', target: `${w.agentType}: ${task}`, spawn: { agentType: w.agentType, description: task ?? '' } },
    { kind: 'subagent-start', sessionId: s, at, ...w },
    { kind: 'tool-end', sessionId: s, at, toolUseId, tool: 'Agent', ok: true },
  ];
}
let calls = 0;
function step(s: string, at: number, w: Who, tool: string, target: string, end: { at: number; ok?: boolean; error?: string; file?: string } | null): OfficeEvent[] {
  const toolUseId = `call-${++calls}`;
  const start: OfficeEvent = { kind: 'tool-start', sessionId: s, at, ...fields(w), toolUseId, tool, target };
  if (!end) return [start];
  return [start, { kind: 'tool-end', sessionId: s, ...fields(w), toolUseId, tool, at: end.at, ok: end.ok ?? true, ...(end.error ? { error: end.error } : {}), ...(end.file ? { file: end.file } : {}) }];
}
const fail = (s: string, at: number, w: Who, error: string) => step(s, at, w, 'Bash', 'npm test', { at, ok: false, error });
const okPlease = (s: string, at: number, w: Who, command: string): OfficeEvent[] => [{ kind: 'permission', sessionId: s, at, ...fields(w), tool: 'Bash', target: command }];
const answerPlease = (s: string, at: number, w: Who, question: string) => step(s, at, w, 'AskUserQuestion', 'asking you a question', null).map((e) => ({ ...e, ask: question }) as OfficeEvent);
function reportBack(s: string, at: number, w: Who, lastMessage: string, question?: string): OfficeEvent[] {
  if (!w) throw new Error('only subagents report back');
  return [{ kind: 'subagent-stop', sessionId: s, at, ...w, lastMessage, ...(question ? { question } : {}) }];
}
const endTurn = (s: string, at: number, lastMessage: string, question?: string): OfficeEvent[] => [{ kind: 'turn-end', sessionId: s, at, failed: false, lastMessage, ...(question ? { question } : {}) }];

function office(...steps: OfficeEvent[][]): OfficeState {
  const state = emptyOffice();
  for (const e of steps.flat().sort((a, b) => a.at - b.at)) apply(state, e, index);
  return state;
}
const board = (state: OfficeState, now: number) => nowBoard({ agents: Object.values(state.agents) }, now);
const lines = (rows: { name: string; status: string }[]) => rows.map((r) => `${r.name}: ${r.status}`);

const ux = who('ux1', 'ux-designer');
const backend = who('be1', 'backend-engineer');
const qa = who('qa1', 'qa-engineer');
const mobile = who('me1', 'mobile-engineer');
const copy = who('cw1', 'copywriter');
const reviewer = who('cr1', 'code-reviewer');

describe('the headline', () => {
  it('names the one person at work and quotes their goal, then the latest report', () => {
    const state = office(
      ask('s', m(0), 'Add a watering streak to the home screen, with a small celebration at 7 days'),
      brief('s', m(1), ux, 'Design the streak card'),
      reportBack('s', m(6), ux, 'Spec in docs/streak-card.md.'),
    );
    expect(board(state, m(10)).headline).toEqual([
      'The lead is at work on “Add a watering streak to the home screen…”.',
      'Last report 4 min ago from the UX designer.',
    ]);
  });

  it('puts who needs you first and counts everyone at work, waiting included', () => {
    const state = office(
      ask('s', m(0), 'Plan the importer'),
      brief('s', m(1), ux, 'Sketch the import flow'),
      reportBack('s', m(3), ux, 'Flow in docs/import.md.'),
      brief('s', m(2), backend, 'Design the import endpoint'),
      brief('s', m(2), qa, 'Write the import tests'),
      okPlease('s', m(4), backend, 'npm install csv-parse'),
    );
    const b = board(state, m(5));
    expect(b.headline).toEqual([
      'The backend engineer needs your OK.',
      'Three at work on “Plan the importer”.',
      'Last report 2 min ago from the UX designer.',
    ]);
    expect(b.caption).toEqual(b.headline.slice(0, 2));
  });

  it('joins who needs you, who asks and who is stuck in one sentence, and counts the requests', () => {
    const explore = Array.from({ length: 9 }, (_, i) => who(`ex${i}`, 'Explore'));
    const state = office(
      ask('s', m(0), 'Import the old CSV files into the new schema'),
      ...[backend, qa, mobile, ...explore.slice(0, 3)].flatMap((w) => [brief('s', m(1), w, 'Part of the import')]),
      ask('s', m(2), 'Add a progress bar to the import screen'),
      ...explore.slice(3).map((w) => brief('s', m(3), w, 'Part of the progress bar')),
      brief('s', m(3), reviewer, 'Review the importer'),
      endTurn('s', m(4), 'Both are under way. Should I also migrate the archive?', 'Should I also migrate the archive?'),
      okPlease('s', m(5), backend, 'npm install csv-parse'),
      answerPlease('s', m(6), qa, 'Which browsers matter?'),
      fail('s', m(6), mobile, 'Exit code 1'),
      reportBack('s', m(8) - 10_000, reviewer, 'Looks good.'),
    );
    expect(board(state, m(8)).headline).toEqual([
      'The backend engineer and the QA engineer need you, the lead has a question for you, and the mobile engineer is stuck.',
      'Twelve at work on two requests.',
      'Last report just now from the code reviewer.',
    ]);
  });

  it('says nobody else is at work when everyone at work is already named', () => {
    const state = office(
      ask('s', m(0), 'Build the streak card and its copy'),
      brief('s', m(1), copy, 'Write the streak copy'),
      brief('s', m(1), mobile, 'Build the streak card'),
      endTurn('s', m(2), 'Two helpers are on it.'),
      reportBack('s', m(8), copy, 'Four strings added.'),
      okPlease('s', m(8.5), mobile, 'npx expo install expo-haptics'),
    );
    expect(board(state, m(9)).headline).toEqual([
      'The mobile engineer needs your OK.',
      'Nobody else is at work.',
      'Last report 1 min ago from the copywriter.',
    ]);
  });

  it('says nobody is at work, and yet before anyone has worked', () => {
    const state = office(ask('s', m(0), 'Tidy up the readme for the release'), endTurn('s', m(5), 'The readme is tidy.'));
    expect(board(state, m(30)).headline).toEqual(['Nobody is at work.', 'Last report 25 min ago from the lead.']);
    const empty = board(emptyOffice(), m(0));
    expect(empty).toEqual({ headline: ['Nobody is at work yet.'], caption: ['Nobody is at work yet.'], needsYou: [], onIt: [], done: [], earlier: { rows: [], more: 0 } });
  });

  it('leaves out the latest report when its author is named for needing you', () => {
    const state = office(ask('s', m(0), 'Plan the importer'), endTurn('s', m(1), 'Want me to run the end-to-end suite too?', 'Want me to run the end-to-end suite too?'));
    expect(board(state, m(3)).headline).toEqual(['The lead has a question for you.', 'Nobody is at work.']);
  });

  it("doesn't change on a tool call, a failed command or a step", () => {
    const state = office(
      ask('s', m(0), 'Plan the importer'),
      brief('s', m(1), ux, 'Sketch the import flow'),
      reportBack('s', m(3), ux, 'Flow in docs/import.md.'),
      brief('s', m(2), backend, 'Design the import endpoint'),
      brief('s', m(2), qa, 'Write the import tests'),
      okPlease('s', m(4), backend, 'npm install csv-parse'),
    );
    const before = board(state, m(5)).headline;
    for (const e of [
      ...step('s', m(5) + 1000, qa, 'Read', 'src/import.ts', { at: m(5) + 2000, file: 'src/import.ts' }),
      ...step('s', m(5) + 3000, null, 'Grep', 'parseCsv', { at: m(5) + 4000 }),
      ...fail('s', m(5) + 5000, qa, 'Exit code 1'),
      ...step('s', m(5) + 6000, null, 'Bash', 'npm run e2e', null),
    ]) {
      apply(state, e, index);
      expect(board(state, m(5) + 10_000).headline).toEqual(before);
    }
  });

  it('names leads by session and switches to numerals from 13', () => {
    const sessions = ['aaaaaa11-0000', 'bbbbbb22-0000', 'cccccc33-0000'];
    const steps = sessions.flatMap((s, i) => [
      ask(s, m(i), `Request number ${i + 1} for the whole studio`),
      ...Array.from({ length: [17, 16, 14][i] ?? 0 }, (_, n) => brief(s, m(i) + 1000 + n, who(`${s}-x${n}`, 'Explore'), `Look into part ${n}`)),
    ]);
    const state = office(...steps, okPlease('bbbbbb22-0000', m(5), null, 'git push'));
    const b = board(state, m(6));
    expect(b.headline.slice(0, 2)).toEqual(['The lead in session bbbbbb needs your OK.', '50 at work on three requests.']);
    expect(b.needsYou.length + b.onIt.length).toBe(50);
    expect(b.needsYou[0]?.name).toBe('Lead, session bbbbbb');
    expect(b.onIt.filter((r) => r.kind === 'lead').map((r) => r.name)).toEqual(['Lead, session cccccc', 'Lead, session aaaaaa']);
  });
});

describe('the rows', () => {
  it('says what a subagent is on, for which request, since when, and the facts worth knowing', () => {
    const state = office(
      ask('s', m(0), 'Add a watering streak to the home screen'),
      brief('s', m(0), qa, 'Test the streak on a small screen'),
      step('s', m(0.5), qa, 'Write', 'e2e/streak.spec.ts', { at: m(0.6), file: 'e2e/streak.spec.ts' }),
      [{ kind: 'permission-denied', sessionId: 's', at: m(0.8), ...fields(qa), tool: 'Bash', target: 'npm install' }],
      fail('s', m(0.9), qa, 'Exit code 1'),
      step('s', m(1), qa, 'Bash', 'npm run e2e', null),
    );
    const b = board(state, m(5));
    expect(b.onIt.map((r) => r.name)).toEqual(['Lead', 'QA engineer']);
    expect(b.onIt[1]).toMatchObject({
      called: 'the QA engineer',
      goal: 'Test the streak on a small screen',
      request: 'For your request: Add a watering streak to the home screen',
      status: 'On it for 5 min.',
      result: null,
      facts: ['Busy with one step for 4 min', '1 file changed', "Wasn't allowed to run npm install"],
    });
    expect(b.onIt[0]).toMatchObject({ goal: 'Add a watering streak to the home screen', request: null, status: 'On it for 5 min.', facts: [] });
  });

  it('says what each state needs, with coarse times', () => {
    const state = office(
      ask('s', m(0), 'Plan the importer'),
      brief('s', m(0), backend, 'Design the endpoint'),
      okPlease('s', m(1), backend, 'npm install'),
      brief('s', m(0), qa, 'Pick the browsers'),
      answerPlease('s', m(2), qa, 'Which chart library should I use?'),
      brief('s', m(0), ux, 'Sketch the flow'),
      [{ kind: 'notice', sessionId: 's', at: m(2), ...fields(ux), message: 'Claude needs your input', needsYou: true }],
      brief('s', m(0), mobile, 'Build the screen'),
      fail('s', m(3), mobile, "Exit code 2: Property 'streak' does not exist on type 'Plant'"),
      brief('s', m(0), copy, 'Write the copy'),
      reportBack('s', m(4), copy, 'Two strings left. Want me to write the empty state too?', 'Want me to write the empty state too?'),
      brief('s', m(0), reviewer, 'Review the plan'),
      reportBack('s', m(4.5), reviewer, 'Ship it?', 'Ship it?'),
    );
    const b = board(state, m(5));
    expect(lines(b.needsYou)).toEqual([
      'Backend engineer: Needs your OK to run npm install. Waiting 4 min.',
      'QA engineer: Needs your answer: Which chart library should I use? Waiting 3 min.',
      'UX designer: Needs your answer in Claude Code. Waiting 3 min.',
      'Mobile engineer: Stuck for 2 min.',
      'Code reviewer: Has a question: Ship it? Asked just now.',
      'Copywriter: Has a question: Want me to write the empty state too? Asked 1 min ago.',
    ]);
    expect(b.needsYou.map((r) => r.result)).toEqual([
      null, null, null, "Exit code 2: Property 'streak' does not exist on type 'Plant'", null, 'Two strings left. Want me to write the empty state too?',
    ]);
    expect(b.headline[0]).toBe('Three people need you, the code reviewer and the copywriter have questions, and the mobile engineer is stuck.');
  });

  it('lists who is done in the last 15 minutes and folds everyone earlier, newest first', () => {
    const helpers = Array.from({ length: FOLD_ROWS + 4 }, (_, i) => who(`h${i}`, 'Explore'));
    const state = office(
      ask('s', m(0), 'Survey the codebase'),
      ...helpers.flatMap((w, i) => [brief('s', m(0), w, `Survey part ${i}`), reportBack('s', m(1) + i * 1000, w, `Part ${i} surveyed.`)]),
      brief('s', m(2), ux, 'Sketch the flow'),
      reportBack('s', m(10), ux, 'Flow sketched.'),
      brief('s', m(2), qa, 'Write the tests'),
      reportBack('s', m(20), qa, 'Tests written.'),
      endTurn('s', m(21), 'All surveyed.'),
    );
    const b = board(state, m(21) + DONE_FOR_MS - 60_000);
    expect(lines(b.done)).toEqual(['Lead: Done 14 min ago.', 'QA engineer: Done 15 min ago.']);
    expect(b.done[1]?.result).toBe('Tests written.');
    expect(b.earlier.rows.map((r) => r.name).slice(0, 2)).toEqual(['UX designer', 'Explore']);
    expect(b.earlier.rows[1]?.goal).toBe(`Survey part ${FOLD_ROWS + 3}`);
    expect(b.earlier.rows).toHaveLength(FOLD_ROWS);
    expect(b.earlier.more).toBe(5);
  });

  it('orders by session, the lead first, and by how long someone has waited', () => {
    const state = office(
      ask('one', m(0), 'First request for the studio'),
      brief('one', m(1), who('x', 'Explore'), 'Look around'),
      brief('one', m(3), who('y', 'Plan'), 'Plan it'),
      ask('two', m(4), 'Second request for the studio'),
      brief('one', m(0), backend, 'Endpoint'),
      okPlease('one', m(2), backend, 'npm install'),
      brief('one', m(0), qa, 'Tests'),
      okPlease('one', m(1), qa, 'npx playwright install'),
    );
    const b = board(state, m(5));
    expect(b.needsYou.map((r) => r.name)).toEqual(['QA engineer', 'Backend engineer']);
    expect(b.onIt.map((r) => r.name)).toEqual(['Lead, session two', 'Lead, session one', 'Plan', 'Explore']);
    expect(b.onIt[2]?.called).toBe('the Plan agent');
  });

  it('shows inline code and emphasis as plain text, leaving snake_case and what was inside code alone', () => {
    const state = office(
      ask('s', m(0), 'Fix the `parse_rows` helper in **lib/import.ts**'),
      brief('s', m(0), ux, 'Check `notes.txt` and _the_ flow'),
      reportBack('s', m(1), ux, 'The file `notes.txt` contains **hello**; the `__init__` hook and snake_case_names stay.'),
    );
    const row = board(state, m(2)).done.find((r) => r.name === 'UX designer');
    expect(row).toMatchObject({
      goal: 'Check notes.txt and the flow',
      request: 'For your request: Fix the parse_rows helper in lib/import.ts',
      result: 'The file notes.txt contains hello; the __init__ hook and snake_case_names stay.',
    });
    expect(plainText('2 * 3 * 4 and *emphasis*')).toBe('2 * 3 * 4 and emphasis');
  });

  it('masks a secret that Markdown hid from earlier masking, on the rows, in the headline and on the badge', () => {
    // Applied as written, without the masking events get on arrival: this is the board's own pass.
    const secret = 'token: `a1b2c3d4e5f6`';
    const state = office(
      ask('s', m(0), `Rotate the deploy ${secret} today`),
      brief('s', m(0), qa, `Check that the ${secret} works`),
      reportBack('s', m(1), qa, `Done: the ${secret} works.`),
      brief('s', m(0), backend, 'Rotate the deploy key'),
      answerPlease('s', m(1), backend, `Should I keep the old ${secret}?`),
    );
    const b = board(state, m(2));
    const rows = [...b.needsYou, ...b.onIt, ...b.done];
    const shown = [...b.headline, ...rows.flatMap((r) => [r.goal, r.request, r.status, r.result, ...r.facts])].join('\n');
    expect(shown).not.toContain('a1b2c3d4e5f6');
    expect(b.headline[1]).toBe('Two at work on “Rotate the deploy token: [redacted] today”.');
    expect(b.done.find((r) => r.name === 'QA engineer')).toMatchObject({
      goal: 'Check that the token: [redacted] works', request: 'For your request: Rotate the deploy token: [redacted] today', result: 'Done: the token: [redacted] works.',
    });
    expect(b.needsYou[0]?.status).toBe('Needs your answer: Should I keep the old token: [redacted]? Waiting 1 min.');
    // The badge: its lines come from personRow, and what someone wrote goes through plainText.
    const checker = state.agents[agentKey('s', 'qa1')];
    if (!checker) throw new Error('no QA engineer');
    expect(personRow({ agents: Object.values(state.agents) }, checker, m(2)).result).toBe('Done: the token: [redacted] works.');
    expect([goalOf(checker), checker.purpose, checker.lastMessage].map((t) => plainText(t ?? ''))).toEqual([
      'Check that the token: [redacted] works', 'Rotate the deploy token: [redacted] today', 'Done: the token: [redacted] works.',
    ]);
  });

  it('starts a result with a capital letter, as agents sometimes forget to', () => {
    const state = office(ask('s', m(0), 'Survey the codebase'), brief('s', m(0), ux, 'Sketch the flow'), reportBack('s', m(1), ux, 'flow sketched in docs/flow.md.'));
    expect(board(state, m(2)).done.find((r) => r.name === 'UX designer')?.result).toBe('Flow sketched in docs/flow.md.');
  });

  it("shows the lead's refusal only until your next message", () => {
    const state = office(ask('s', m(0), 'Release the new version'), [{ kind: 'permission-denied', sessionId: 's', at: m(1), tool: 'Bash', target: 'git push' }]);
    expect(board(state, m(2)).onIt[0]?.facts).toEqual(["Wasn't allowed to run git push"]);
    for (const e of ask('s', m(3), 'Leave the push to me and write the changelog')) apply(state, e, index);
    expect(board(state, m(4)).onIt[0]?.facts).toEqual([]);
  });

  it('cuts long text: lines at 160 characters, a result at 240, a quoted request at eight words', () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
    const state = office(
      ask('s', m(0), long(300)),
      brief('s', m(0), qa, long(200)),
      reportBack('s', m(1), qa, long(400)),
      brief('s', m(0), backend, 'Endpoint'),
      answerPlease('s', m(1), backend, `${long(100)}?`),
      brief('s', m(0), mobile, 'Screen'),
      [{ kind: 'turn-end', sessionId: 's', at: m(0.5), ...fields(mobile), failed: true, lastMessage: long(300) }],
    );
    const b = board(state, m(2));
    const all = [...b.needsYou, ...b.onIt, ...b.done];
    for (const r of all) {
      for (const line of [r.goal, r.request, r.status, ...r.facts]) expect((line ?? '').length).toBeLessThanOrEqual(LINE_CHARS);
      expect((r.result ?? '').length).toBeLessThanOrEqual(r.state.kind === 'stuck' ? LINE_CHARS : RESULT_CHARS);
    }
    const qaRow = b.done.find((r) => r.name === 'QA engineer');
    expect(qaRow?.goal?.endsWith('…')).toBe(true);
    expect(qaRow?.result?.length).toBeGreaterThan(LINE_CHARS);
    expect(b.needsYou.find((r) => r.name === 'Backend engineer')?.status).toMatch(/^Needs your answer: word0 .*… Waiting 1 min\.$/);
    expect(b.headline).toContain('Three at work on “word0 word1 word2 word3 word4 word5 word6 word7…”.');
  });
});

describe('the clock', () => {
  it('runs a replay on its own clock: ages come from the replay position, not from now', () => {
    const events = replayEvents(transcript('main'), { sessionId: SESSION, cwd: '/project', fallbackTime: 0 });
    const until = (position: number) => {
      const state = emptyOffice();
      for (const e of events) if (e.at <= position) apply(state, e);
      return board(state, position);
    };
    expect(until(Date.parse('2026-11-04T13:32:50.000Z')).headline).toEqual(['The lead is at work on “Do these steps in order”.']);
    const end = Date.parse('2026-11-04T13:33:30.000Z');
    const b = until(end);
    expect(b.headline).toEqual(['Nobody is at work.', 'Last report just now from the lead.']);
    expect(b.done.map((r) => [r.name, r.status, r.result])).toEqual([['Lead', 'Done just now.', 'Finished']]);
    const later = until(end + 20 * 60_000);
    expect(later.done).toEqual([]);
    expect(later.earlier.rows.map((r) => r.status)).toEqual(['Done 20 min ago.']);
    expect(later.headline).toEqual(['Nobody is at work.', 'Last report 20 min ago from the lead.']);
  });

  it('keeps times coarse', () => {
    expect([59_999, 12 * 60_000, 65 * 60_000, 120 * 60_000].map(coarseDuration)).toEqual(['under a minute', '12 min', '1 h 5 min', '2 h']);
    expect([0, 4 * 60_000 + 59_000, 150 * 60_000, 30 * 3_600_000, 80 * 3_600_000].map(coarseAge)).toEqual(['just now', '4 min ago', '2 h ago', '1 day ago', '3 days ago']);
  });

  it('quotes the first sentence of a request, eight words at most', () => {
    expect(quote('Fix the login bug. Then deploy it.')).toBe('“Fix the login bug”');
    expect(quote('Can you fix the build? It fails on CI.')).toBe('“Can you fix the build?”');
    expect(quote('Plan the importer\n\nIt reads CSV files from the old system.')).toBe('“Plan the importer”');
    expect(quote('Do the following:\n1. Build it')).toBe('“Do the following…”');
  });
});

describe('the demo', () => {
  const demoIndex = indexStudio(demoStudio(loadLibrary(), '0.1.0'));
  const start = Date.parse('2026-11-04T09:00:00.000Z');
  function upTo(seconds: number) {
    const state = emptyOffice();
    for (const [t, s] of demoScript()) if (t <= seconds) apply(state, { ...s, at: start + t * 1000, sessionId: 'demo-session' } as OfficeEvent, demoIndex);
    return board(state, start + seconds * 1000);
  }

  it('says the mobile engineer needs your OK during the permission wait', () => {
    const b = upTo(60);
    expect(b.headline).toEqual([
      'The mobile engineer needs your OK.',
      'Two at work on “Add a watering streak to the home screen…”.',
      'Last report just now from the Explore agent.',
    ]);
    expect(lines(b.needsYou)).toEqual(['Mobile engineer: Needs your OK to run npx expo install expo-haptics. Waiting under a minute.']);
    expect(b.needsYou[0]?.facts).toEqual(['3 files changed']);
  });

  it('reads the failing typecheck as on it, not stuck', () => {
    const b = upTo(47.5);
    expect(b.needsYou).toEqual([]);
    expect(lines(b.onIt)).toEqual(['Lead: On it for under a minute.', 'Mobile engineer: On it for under a minute.']);
    expect(b.headline[0]).toBe('Two at work on “Add a watering streak to the home screen…”.');
  });

  it('ends with nobody at work and everyone done, newest first', () => {
    const b = upTo(119);
    expect(b.headline).toEqual(['Nobody is at work.', 'Last report just now from the lead.']);
    expect(b.done.map((r) => r.name)).toEqual(['Lead', 'QA engineer', 'Accessibility specialist', 'Mobile engineer', 'Explore', 'Copywriter', 'UI designer', 'UX designer']);
  });
});

describe('who needs you', () => {
  it('builds the sentence an announcement says from the rows that just started to need you', () => {
    const state = office(
      ask('s', m(0), 'Plan the importer'),
      brief('s', m(0), backend, 'Endpoint'),
      okPlease('s', m(1), backend, 'npm install'),
      brief('s', m(0), qa, 'Tests'),
      okPlease('s', m(2), qa, 'npx playwright install'),
    );
    const rows = board(state, m(3)).needsYou;
    expect(needsYouSentence(rows.slice(0, 1))).toBe('The backend engineer needs your OK.');
    expect(needsYouSentence(rows)).toBe('The backend engineer and the QA engineer need you.');
    expect(needsYouSentence([])).toBeNull();
  });

  it('counts two calls of one role instead of naming it twice', () => {
    const state = office(
      ask('s', m(0), 'Survey the codebase twice'),
      brief('s', m(0), who('x1', 'Explore'), 'Survey the importer'),
      okPlease('s', m(1), who('x1', 'Explore'), 'npm install'),
      brief('s', m(0), who('x2', 'Explore'), 'Survey the exporter'),
      okPlease('s', m(2), who('x2', 'Explore'), 'npm ci'),
    );
    expect(board(state, m(3)).headline.slice(0, 2)).toEqual(['Two Explore agents need you.', 'Three at work on “Survey the codebase twice”.']);
  });

  it("speaks for a role's most urgent call", () => {
    const state = office(
      ask('s', m(0), 'Test everything twice'),
      brief('s', m(0), who('q1', 'qa-engineer'), 'First pass'),
      reportBack('s', m(1), who('q1', 'qa-engineer'), 'First pass done.'),
      brief('s', m(2), who('q2', 'qa-engineer'), 'Second pass'),
      okPlease('s', m(3), who('q2', 'qa-engineer'), 'npm install'),
    );
    const qaCalls = Object.values(state.agents).filter((a) => a.roleId === 'qa-engineer');
    expect(mostUrgent(qaCalls, m(4))).toMatchObject({ agent: { agentId: 'q2' }, state: { kind: 'needs-ok' } });
    expect(mostUrgent([], m(4))).toBeNull();
  });
});
