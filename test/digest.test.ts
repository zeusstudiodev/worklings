import { describe, expect, it } from 'vitest';
import { ACCOUNT_MAX_CHARS, ACCOUNT_MAX_LINES, type AccountInput, catchUpAccount } from '../src/core/digest.ts';
import type { OfficeEvent } from '../src/core/events.ts';
import { apply, emptyOffice, indexStudio, type OfficeState } from '../src/core/office.ts';
import type { Studio } from '../src/core/studio.ts';

type WithoutSession<T> = T extends unknown ? Omit<T, 'sessionId'> : never;
type Step = WithoutSession<OfficeEvent>;

const studio: Studio = {
  version: 1, name: 'Importer', domain: 'web-app', rigor: 'standard',
  departments: [{ id: 'engineering', name: 'Engineering', style: 'engineering' }, { id: 'quality', name: 'Quality', style: 'quality' }],
  roles: [{ id: 'backend-engineer', department: 'engineering', title: 'Backend engineer' }, { id: 'qa-engineer', department: 'quality', title: 'QA engineer' }],
  rules: [], skills: [], fired: [],
  gates: [{ id: 'code-gate', title: 'Code gate', from: 'engineering', to: 'quality' }],
};
const index = indexStudio(studio);

const T0 = Date.parse('2026-11-04T10:00:00.000Z');
const min = (m: number) => T0 + m * 60_000;
const backend = { agentId: 'b1', agentType: 'backend-engineer' };
const qa = { agentId: 'q1', agentType: 'qa-engineer' };
const usage = { input: 5, output: 900, cacheRead: 40_000, cacheWrite5m: 2_000, cacheWrite1h: 0 };
/** Made-up credentials, assembled at run time so no secret scanner mistakes this file for a leak. */
const fake = (prefix: string, length = 40) => prefix + 'a1B2c3D4e5F6g7H8i9J0'.repeat(10).slice(0, length);

/** The lead briefing a subagent, as the office sees it: the Agent call, then the subagent starting. */
function spawn(at: number, who: { agentId: string; agentType: string }, task: string, toolUseId: string): Step[] {
  return [
    { kind: 'tool-start', at, toolUseId, tool: 'Agent', target: `${who.agentType}: ${task}`, spawn: { agentType: who.agentType, description: task } },
    { kind: 'subagent-start', at, ...who },
    { kind: 'tool-end', at, toolUseId, tool: 'Agent', ok: true },
  ];
}

function office(steps: Step[], sessionId = 's1', state: OfficeState = emptyOffice()): OfficeState {
  for (const e of steps) apply(state, { sessionId, ...e } as OfficeEvent, index);
  return state;
}

function input(state: OfficeState): AccountInput {
  return {
    studioName: 'Importer', agents: Object.values(state.agents), sessions: Object.values(state.sessions), activity: state.activity,
    gateRuns: state.gateRuns, studio,
  };
}

/** An hour in which the lead hands the importer to the backend engineer, then QA tests it. */
const busyHour: Step[] = [
  { kind: 'prompt', at: min(1), text: 'Build the CSV importer and get it reviewed', notification: false },
  { kind: 'usage', at: min(1), messageId: 'm1', model: 'claude-opus-5-5', usage },
  ...spawn(min(2), backend, 'Write the CSV importer', 't1'),
  { kind: 'tool-start', at: min(5), ...backend, toolUseId: 't2', tool: 'Edit', target: 'src/importer.ts' },
  { kind: 'tool-end', at: min(6), ...backend, toolUseId: 't2', tool: 'Edit', ok: true, file: 'src/importer.ts' },
  { kind: 'usage', at: min(6), ...backend, messageId: 'm2', model: 'claude-sonnet-5-5', usage },
  { kind: 'subagent-stop', at: min(31), ...backend, lastMessage: 'The importer reads CSV files and reports bad rows.' },
  ...spawn(min(32), qa, 'Test the importer end to end', 't3'),
  { kind: 'tool-start', at: min(40), ...qa, toolUseId: 't4', tool: 'Bash', target: 'npm run e2e' },
  { kind: 'turn-end', at: min(41), failed: false, lastMessage: 'The importer is in; QA is running the end-to-end suite.' },
];

describe('catchUpAccount', () => {
  it('tells who worked, on what, and what they reported', () => {
    const { text, nothingNew } = catchUpAccount(input(office(busyHour)), min(0), min(60));
    expect(nothingNew).toBe(false);
    expect(text).toContain('People who worked (3):');
    expect(text).toContain('Lead\n- For the request: Build the CSV importer and get it reviewed\n- Now: done 19 min before now');
    expect(text).toContain('Backend engineer\n- Brief: Write the CSV importer\n- For the request: Build the CSV importer and get it reviewed\n- Now: done 29 min before now');
    expect(text).toContain('- Reported 29 min before now: The importer reads CSV files and reports bad rows.');
    expect(text).toContain('- Files changed so far (1): src/importer.ts');
    expect(text).toContain('QA engineer\n- Brief: Test the importer end to end\n- For the request: Build the CSV importer and get it reviewed\n- Now: on it since 28 min before now');
  });

  it('names the step someone has been on for a while, as the Now board does', () => {
    const { text } = catchUpAccount(input(office(busyHour)), min(0), min(60));
    expect(text).toContain('- Now: on it since 28 min before now, current step: Runs npm run e2e (running for 20 min)');
  });

  it("gives the person's last message when it is only a reply to the request", () => {
    const state = office([...busyHour, { kind: 'prompt', at: min(44), text: 'yes', notification: false }]);
    expect(catchUpAccount(input(state), min(0), min(60)).text)
      .toContain('Lead\n- For the request: Build the CSV importer and get it reviewed\n- Your last message: yes\n- Now: on it since 16 min before now');
  });

  it('gives each person their cost and everyone a total', () => {
    const { text } = catchUpAccount(input(office(busyHour)), min(0), min(60));
    expect(text).toMatch(/Lead\n(?:- .*\n)*- Cost so far: \$0\.\d\d/);
    expect(text).toMatch(/Cost so far of the people above: \$0\.\d\d\. Of everyone the office has seen: \$0\.\d\d\./);
  });

  it('lists the activity of the period oldest first', () => {
    const { text } = catchUpAccount(input(office(busyHour)), min(0), min(60));
    const order = ['You: Build the CSV importer', 'Backend engineer: Edits src/importer.ts', 'Backend engineer: Reports back', 'QA engineer: Runs npm run e2e', 'Lead: Done for now']
      .map((line) => text.indexOf(line));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('counts time back from the end of the period instead of giving clock times', () => {
    const { text } = catchUpAccount(input(office(busyHour)), min(0), min(60));
    expect(text).toContain('Catch-up account for Importer, from 1 h before now to now.');
    expect(text).toContain('[59 min before now] You: Build the CSV importer and get it reviewed');
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
  });

  it('says nothing is new when no activity, report or status change falls in the period', () => {
    const { text, nothingNew } = catchUpAccount(input(office(busyHour)), min(60), min(90));
    expect(nothingNew).toBe(true);
    expect(text).toContain('Nothing new happened in this period.');
    expect(text).toContain('Activity: none in this period.');
  });

  it('still says who is at work when nothing is new', () => {
    const { text } = catchUpAccount(input(office(busyHour)), min(60), min(90));
    expect(text).toContain('People who worked (1):\nQA engineer');
    expect(text).toContain('on it since 58 min before now');
  });

  it('still lists who needs the person when nothing is new', () => {
    const state = office([
      { kind: 'prompt', at: min(1), text: 'Plan the CSV importer for me', notification: false },
      { kind: 'turn-end', at: min(5), failed: false, lastMessage: 'The plan is ready. Want me to start?', question: 'Want me to start?' },
    ]);
    const { text, nothingNew } = catchUpAccount(input(state), min(60), min(90));
    expect(nothingNew).toBe(true);
    expect(text).toContain('Needs you:\n- The lead has a question for you (asked 1 h 25 min before now): Want me to start?');
    expect(text).toContain('People who worked (1):\nLead');
  });

  it('counts a status change without an activity line as news', () => {
    // A permission granted: the command finishes and its runner is back at work, which the activity log doesn't show.
    const state = office([
      ...spawn(min(1), backend, 'Publish the package', 't1'),
      { kind: 'tool-start', at: min(2), ...backend, toolUseId: 't2', tool: 'Bash', target: 'npm publish' },
      { kind: 'permission', at: min(3), ...backend, tool: 'Bash', target: 'npm publish' },
      { kind: 'tool-end', at: min(70), ...backend, toolUseId: 't2', tool: 'Bash', ok: true },
    ]);
    expect(catchUpAccount(input(state), min(60), min(90)).nothingNew).toBe(false);
  });

  it('puts whoever needs the OK first, with what it is for', () => {
    const state = office([
      ...busyHour,
      { kind: 'permission', at: min(50), ...qa, tool: 'Bash', target: 'npm publish' },
    ]);
    const { text } = catchUpAccount(input(state), min(0), min(60));
    expect(text).toContain('Needs you:\n- The QA engineer needs your OK to run npm publish (waiting since 10 min before now).');
    expect(text).toContain('- Now: needs your OK to run npm publish, waiting since 10 min before now');
    expect(text.indexOf('Needs you:')).toBeLessThan(text.indexOf('People who worked'));
  });

  it('writes role titles in sentences in lower case unless they start with an acronym', () => {
    const state = office([
      ...spawn(min(1), backend, 'Publish the package', 't1'),
      { kind: 'permission', at: min(2), ...backend, tool: 'Bash', target: 'npm publish' },
    ]);
    expect(catchUpAccount(input(state), min(0), min(10)).text).toContain('- The backend engineer needs your OK to run npm publish (waiting since 8 min before now).');
  });

  it('names an open question with its text', () => {
    const state = office([
      ...busyHour,
      { kind: 'tool-start', at: min(55), toolUseId: 'q1', tool: 'AskUserQuestion', target: 'asking you a question', ask: 'Which database should the importer use?' },
    ]);
    const { text } = catchUpAccount(input(state), min(0), min(60));
    expect(text).toContain('Needs you:\n- The lead needs your answer (waiting since 5 min before now): Which database should the importer use?');
    expect(text).toContain('- Now: needs your answer, waiting since 5 min before now: Which database should the importer use?');
  });

  it("names the question the lead's last word ends with, as a question for the person", () => {
    const state = office([
      ...busyHour.filter((e) => e.kind !== 'turn-end'),
      { kind: 'turn-end', at: min(55), failed: false, lastMessage: 'The importer is in. Want me to run the end-to-end suite too?', question: 'Want me to run the end-to-end suite too?' },
    ]);
    expect(catchUpAccount(input(state), min(0), min(60)).text)
      .toContain('Needs you:\n- The lead has a question for you (asked 5 min before now): Want me to run the end-to-end suite too?');
  });

  it("names the question a subagent's report ends with until its lead's turn ends", () => {
    const report: Step = { kind: 'subagent-stop', at: min(31), ...backend, lastMessage: 'Parsed. Should empty rows be skipped?', question: 'Should empty rows be skipped?' };
    const before = office([...busyHour.filter((e) => e.kind !== 'turn-end' && e.kind !== 'subagent-stop'), report]);
    expect(catchUpAccount(input(before), min(0), min(60)).text)
      .toContain('Needs you:\n- The backend engineer has a question (asked 29 min before now): Should empty rows be skipped?');
    const after = office([...busyHour.filter((e) => e.kind !== 'subagent-stop' && e.kind !== 'turn-end'), report, { kind: 'turn-end', at: min(41), failed: false, lastMessage: 'QA is on it.' }]);
    expect(catchUpAccount(input(after), min(0), min(60)).text).not.toContain('The backend engineer has a question');
  });

  it('names who is stuck, since when, and on what error', () => {
    const state = office([
      ...busyHour,
      { kind: 'tool-end', at: min(45), ...qa, toolUseId: 't4', tool: 'Bash', ok: false, error: 'Exit code 1' },
    ]);
    const { text } = catchUpAccount(input(state), min(0), min(60));
    expect(text).toContain('Needs you:\n- The QA engineer is stuck (since 15 min before now): Exit code 1.');
    expect(text).toContain('- Now: stuck since 15 min before now: Exit code 1');
    expect(text).toContain("[15 min before now] QA engineer: Couldn't run npm run e2e: Exit code 1");
  });

  it('reads an error under 30 seconds old as still on it since the work began, like the Now board', () => {
    const state = office([
      ...busyHour,
      { kind: 'tool-end', at: min(60) - 10_000, ...qa, toolUseId: 't4', tool: 'Bash', ok: false, error: 'Exit code 1' },
    ]);
    const { text } = catchUpAccount(input(state), min(0), min(60));
    expect(text).not.toContain('The QA engineer is stuck');
    expect(text).toContain('Needs you: nobody needs your OK or an answer, has a question, or is stuck.');
    expect(text).toContain('QA engineer\n- Brief: Test the importer end to end\n- For the request: Build the CSV importer and get it reviewed\n- Now: on it since 28 min before now');
  });

  it('says what someone was not allowed to do, as a fact rather than a state', () => {
    const state = office([...busyHour, { kind: 'permission-denied', at: min(45), ...qa, tool: 'Bash', target: 'rm -rf dist' }]);
    const { text } = catchUpAccount(input(state), min(0), min(60));
    expect(text).toContain("- Wasn't allowed to run rm -rf dist (15 min before now)");
    expect(text).toContain('Needs you: nobody needs your OK or an answer, has a question, or is stuck.');
  });

  it('says plainly when nobody needs the person', () => {
    expect(catchUpAccount(input(office(busyHour)), min(0), min(60)).text).toContain('Needs you: nobody needs your OK or an answer, has a question, or is stuck.');
  });

  it('lists a gate that ran by its title from the studio, and who ran it', () => {
    const state = office([
      ...busyHour,
      { kind: 'prompt', at: min(45), text: 'Run the code gate', notification: false },
      { kind: 'tool-start', at: min(46), toolUseId: 'g1', tool: 'Skill', target: 'code-gate' },
      { kind: 'tool-end', at: min(46), toolUseId: 'g1', tool: 'Skill', ok: true },
      { kind: 'turn-end', at: min(48), failed: false, lastMessage: 'The code gate passes.' },
    ]);
    expect(catchUpAccount(input(state), min(0), min(60)).text).toContain('Gates that ran:\n- Code gate: the lead ran it from 14 min before now to 12 min before now.');
  });

  it('tells apart the leads of two sessions the way the Team list does', () => {
    const state = office([{ kind: 'prompt', at: min(5), text: 'Fix the login bug', notification: false }], 'b0581371-e091-4b14-9a83-550be0bb1ac8');
    office([
      { kind: 'prompt', at: min(20), text: 'Write the changelog', notification: false },
      { kind: 'permission', at: min(25), tool: 'Bash', target: 'npm publish' },
    ], '3f2a1c9e-77d0-4c51-a0f4-2d9e6b1c8a55', state);
    const { text } = catchUpAccount(input(state), min(0), min(30));
    expect(text).toContain('Lead, session b05813\n- For the request: Fix the login bug');
    expect(text).toContain('Lead, session 3f2a1c\n- For the request: Write the changelog');
    expect(text).toContain('- The lead in session 3f2a1c needs your OK to run npm publish (waiting since 5 min before now).');
  });

  it('cuts a long brief', () => {
    const task = `Rewrite the importer: ${'keep every row that parses and report the rest. '.repeat(100)}`;
    const { text } = catchUpAccount(input(office(spawn(min(1), backend, task, 't1'))), min(0), min(10));
    const brief = text.split('\n').find((line) => line.startsWith('- Brief: ')) ?? '';
    expect(brief.length).toBeLessThanOrEqual('- Brief: '.length + 300);
    expect(brief).toMatch(/^- Brief: Rewrite the importer: keep every row.*…$/);
  });

  it('keeps the newest 120 activity lines and says how many earlier ones it left out', () => {
    const steps: Step[] = [{ kind: 'prompt', at: min(0.5), text: 'Tidy every file', notification: false }];
    for (let i = 0; i < 200; i += 1) {
      steps.push({ kind: 'tool-start', at: min(1) + i * 1000, toolUseId: `t${i}`, tool: 'Read', target: `src/file-${String(i).padStart(3, '0')}.ts` });
    }
    const { text } = catchUpAccount(input(office(steps)), min(0), min(10));
    const lines = text.split('\n').filter((line) => line.startsWith('['));
    expect(lines).toHaveLength(ACCOUNT_MAX_LINES);
    expect(text).toContain(`Activity, oldest first (${ACCOUNT_MAX_LINES} lines; the 81 earlier ones are left out):`);
    expect(text).toContain('Lead: Reads src/file-199.ts');
    expect(text).not.toContain('Lead: Reads src/file-079.ts');
    expect(text).toContain('Lead: Reads src/file-080.ts');
  });

  it('stays under its size cap with 50 people at work, and says who and what it left out', () => {
    const state = emptyOffice();
    for (let p = 0; p < 50; p += 1) {
      const who = { agentId: `a${p}`, agentType: p % 2 ? 'qa-engineer' : 'backend-engineer' };
      const task = `Task ${p}: ${'check the importer against every sample file and report what breaks. '.repeat(30)}`;
      office([
        ...spawn(min(1) + p * 1000, who, task, `spawn-${p}`),
        { kind: 'tool-start', at: min(10) + p * 1000, ...who, toolUseId: `run-${p}`, tool: 'Bash', target: 'npm test' },
        { kind: 'tool-end', at: min(11) + p * 1000, ...who, toolUseId: `run-${p}`, tool: 'Bash', ok: true },
        { kind: 'tool-start', at: min(12) + p * 1000, ...who, toolUseId: `edit-${p}`, tool: 'Edit', target: `src/part-${p}.ts` },
      ], 's1', state);
    }
    const { text } = catchUpAccount(input(state), min(0), min(30));
    expect(text.length).toBeLessThanOrEqual(ACCOUNT_MAX_CHARS);
    expect(text).toContain('People who worked (51):');
    expect(text).toMatch(/\n\d+ more people also worked: (?:Lead, )?(?:Backend engineer|QA engineer) \(\d+\), (?:Backend engineer|QA engineer) \(\d+\)\./);
    expect(text).toMatch(/Activity, oldest first \(\d+ lines; the \d+ earlier ones are left out\):/);
  });

  it('masks a secret in a command description and in a report', () => {
    const key = fake('sk-ant-api03-', 90);
    const token = fake('ghp_', 36);
    const state = office([
      ...spawn(min(1), backend, 'Set up the deploy', 't1'),
      { kind: 'tool-start', at: min(2), ...backend, toolUseId: 't2', tool: 'Bash', target: `Set ANTHROPIC_API_KEY=${key} for the deploy` },
      { kind: 'subagent-stop', at: min(3), ...backend, lastMessage: `Deployed. The CI token is ${token}.` },
    ]);
    const { text } = catchUpAccount(input(state), min(0), min(10));
    expect(text).not.toContain(key);
    expect(text).not.toContain(token);
    expect(text).toContain('Backend engineer: Set ANTHROPIC_API_KEY=[redacted] for the deploy');
    expect(text).toContain('- Reported 7 min before now: Deployed. The CI token is [redacted].');
  });

  it('writes the same account whatever the order of its lists', () => {
    const state = office([...busyHour, { kind: 'permission', at: min(50), ...qa, tool: 'Bash', target: 'npm publish' }]);
    const forward = input(state);
    const backward = { ...forward, agents: [...forward.agents].reverse(), sessions: [...forward.sessions].reverse(), activity: [...forward.activity].reverse() };
    expect(catchUpAccount(backward, min(0), min(60))).toEqual(catchUpAccount(forward, min(0), min(60)));
  });
});
