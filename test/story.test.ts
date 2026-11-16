import { describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { normalizeHook, type OfficeEvent } from '../src/core/events.ts';
import { LINE_CHARS, RESULT_CHARS } from '../src/core/now.ts';
import { agentKey, apply, emptyOffice, indexStudio, leadKey, milestones, type OfficeState } from '../src/core/office.ts';
import { ECHO_MS, storyLines } from '../src/core/story.ts';
import type { Studio } from '../src/core/studio.ts';
import { DemoPlayer, demoScript, demoStudio } from '../src/server/demo.ts';
import { Office } from '../src/server/office.ts';
import { hookPayloads, SESSION, SUBAGENT } from './fixtures.ts';

type WithoutSession<T> = T extends unknown ? Omit<T, 'sessionId'> : never;
type Step = WithoutSession<OfficeEvent>;

/** How the log words tool calls ("Reads notes.txt", "Runs npm test"): none of it may reach the story. */
const TOOL_WORDS = /\b(?:Reads|Writes|Edits|Runs|Searches the|Looks for files|Looks up tools|Follows the|Briefs|Uses|Updates the plan|Starts on|Starts work|Reports back|Done for now|Couldn't)\b/;

const studio: Studio = {
  version: 1, name: 'Importer', domain: 'web-app', rigor: 'standard',
  departments: [{ id: 'engineering', name: 'Engineering', style: 'engineering' }, { id: 'quality', name: 'Quality', style: 'quality' }],
  roles: [
    { id: 'backend-engineer', department: 'engineering', title: 'Backend engineer' },
    { id: 'qa-engineer', department: 'quality', title: 'QA engineer' },
    { id: 'security-reviewer', department: 'quality', title: 'Security reviewer' },
  ],
  rules: [], skills: [], fired: [],
  gates: [{ id: 'code-gate', title: 'Code gate', from: 'engineering', to: 'quality' }],
};
const index = indexStudio(studio);

const T0 = Date.parse('2026-11-04T10:00:00.000Z');
const sec = (s: number) => T0 + s * 1000;
const backend = { agentId: 'b1', agentType: 'backend-engineer' };
const qa = { agentId: 'q1', agentType: 'qa-engineer' };
/** Made-up credentials, put together at run time so no secret scanner mistakes this file for a leak. */
const fake = (prefix: string, length = 40) => prefix + 'a1B2c3D4e5F6g7H8i9J0'.repeat(10).slice(0, length);

/** The lead briefing a subagent as the office sees it: the Agent call, the subagent starting, the call returning. */
function spawn(at: number, who: { agentId: string; agentType: string }, task: string): Step[] {
  const toolUseId = `spawn-${who.agentId}`;
  return [
    { kind: 'tool-start', at, toolUseId, tool: 'Agent', target: `${who.agentType}: ${task}`, spawn: { agentType: who.agentType, description: task } },
    { kind: 'subagent-start', at: at + 1, ...who },
    { kind: 'tool-end', at: at + 2, toolUseId, tool: 'Agent', ok: true },
  ];
}

function office(steps: Step[], sessionId = 's', state: OfficeState = emptyOffice()): OfficeState {
  for (const e of steps) apply(state, { sessionId, ...e } as OfficeEvent, index);
  return state;
}

const source = (state: OfficeState, s: Studio | null = studio) => ({ agents: Object.values(state.agents), activity: state.activity, studio: s });
const told = (state: OfficeState, people?: ReadonlySet<string>) => storyLines(source(state), people).map((l) => l.text);

describe('the story of the demo', () => {
  const demo = demoStudio(loadLibrary(), '0.1.0');
  const demoIndex = indexStudio(demo);
  const start = Date.parse('2026-11-04T09:00:00.000Z');
  function upTo(seconds: number) {
    const state = emptyOffice();
    for (const [t, s] of demoScript()) if (t <= seconds) apply(state, { ...s, at: start + t * 1000, sessionId: 'demo-session' } as OfficeEvent, demoIndex);
    return state;
  }
  const tell = (state: OfficeState, people?: ReadonlySet<string>) => storyLines(source(state, demo), people).map((l) => l.text);

  it('tells the loop as requests, briefs, reports, gates, the OK it needed and the result, newest first', () => {
    expect(tell(upTo(119))).toEqual([
      'The lead finished: The streak card is in: designed, built, tested at 375px and with large text, and through the design, accessibility and code gates.',
      'The lead ran the code gate',
      'The QA engineer reported back: Passes at 375px and at 200% text. Added a regression test.',
      'The accessibility specialist reported back: Labels and roles are set and contrast is 4.8:1. Passes.',
      'The accessibility specialist ran the accessibility gate',
      'The lead briefed the accessibility specialist: Run the accessibility gate on the streak card',
      'The lead briefed the QA engineer: Test the streak on a small screen and with large text',
      'The mobile engineer reported back: Streak card built with a haptic tap at 7 days. Typecheck and tests pass.',
      'The mobile engineer asked for your OK to run npx expo install expo-haptics',
      'The Explore agent reported back: Plant data is cached in lib/storage.ts under the key "plants:v2".',
      'The lead briefed the Explore agent: Find where plant data is cached on the device',
      'The copywriter reported back: Added four strings: title, day count, celebration and the empty state.',
      'The lead briefed the copywriter: Write the streak copy and the empty state',
      'The lead briefed the mobile engineer: Build the streak card and the celebration',
      'The UI designer reported back: Passes: it uses the existing flame icon, colours and spacing scale.',
      'The UI designer ran the design gate',
      'The lead briefed the UI designer: Check the streak spec against the design system',
      'The UX designer reported back: Spec in docs/streak-card.md: flame icon, day count, gentle confetti at 7.',
      'The lead briefed the UX designer: Design the streak card and the 7-day celebration',
      'You asked: Add a watering streak to the home screen, with a small celebration at 7 days',
    ]);
  });

  it('never tells a tool call, a file read or the failed typecheck, at any moment of the loop', () => {
    for (const seconds of [4, 16, 44, 47, 56, 60, 75, 96, 119]) {
      const state = upTo(seconds);
      expect(state.activity.some((e) => e.kind === 'step')).toBe(true);
      for (const line of tell(state)) expect(line).not.toMatch(TOOL_WORDS);
    }
  });

  it('tells each brief once, the Agent call and the subagent starting as one line', () => {
    const lines = storyLines(source(upTo(119), demo));
    expect(lines.filter((l) => l.type === 'briefed')).toHaveLength(7);
    expect(lines.filter((l) => /the UX designer/i.test(l.text))).toHaveLength(2);
    const brief = lines.find((l) => l.type === 'briefed' && l.whom?.name === 'the UX designer');
    expect(brief).toMatchObject({
      who: { name: 'The lead', key: 'demo-session:lead' }, did: 'briefed', whom: { name: 'the UX designer', key: 'demo-session:demo-ux' },
      about: 'Design the streak card and the 7-day celebration', keys: ['demo-session:demo-ux', 'demo-session:lead'],
    });
  });

  it("gives a badge its people's lines: a subagent's brief and report, the lead's asks, briefs, gates and result", () => {
    const state = upTo(119);
    expect(tell(state, new Set(['demo-session:demo-ux']))).toEqual([
      'The UX designer reported back: Spec in docs/streak-card.md: flame icon, day count, gentle confetti at 7.',
      'The lead briefed the UX designer: Design the streak card and the 7-day celebration',
    ]);
    const lead = tell(state, new Set(['demo-session:lead']));
    expect(lead).toHaveLength(10);
    expect(lead[0]).toMatch(/^The lead finished: /);
    expect(lead.at(-1)).toMatch(/^You asked: /);
    expect(lead.some((l) => l.includes('reported back'))).toBe(false);
  });

  it('is empty before anything happened', () => {
    expect(tell(upTo(-1))).toEqual([]);
  });

  it('reaches the browser as milestones only, which tell the same story', () => {
    const office = new Office(process.cwd(), 'Plant Pal', 'demo');
    office.setStudio({ studio: demo, source: 'manifest', errors: [] });
    const player = new DemoPlayer(office);
    const now = Date.now();
    player.start(now);
    player.stop();
    player.tick(now + 119_000);
    const snapshot = office.snapshot();
    expect(office.state.activity.some((e) => e.kind === 'step')).toBe(true);
    expect(snapshot.activity.map((e) => e.kind)).toEqual(milestones(office.state.activity).map(() => 'milestone'));
    expect(storyLines(snapshot).map((l) => l.text)).toEqual(storyLines(source(office.state, demo)).map((l) => l.text));
  });
});

describe('the story of a real Claude Code session', () => {
  it('tells the captured 2.1.312 session in five lines', () => {
    const state = emptyOffice();
    const reviewer = indexStudio({ ...studio, roles: [{ id: 'reviewer', department: 'quality', title: 'Reviewer' }] });
    hookPayloads().forEach((p, i) => {
      const e = normalizeHook(p, sec(i));
      if (e) apply(state, e, reviewer);
    });
    const lines = storyLines(source(state));
    expect(lines.map((l) => l.text)).toEqual([
      'The lead finished: Finished',
      'The reviewer reported back: The file notes.txt contains one line: hello.',
      "The lead finished: Steps 1 and 2 are in progress. notes.txt was created with hello. The reviewer agent is reading it in the background, and I'll run steps 3 and 4 once its result comes back, so the order holds.",
      'The lead briefed the reviewer: Read notes.txt contents',
      'You asked: Do these steps in order. 1) Use the Write tool to create notes.txt containing the word hello. 2) Use the Agent tool with subagent_type revi…',
    ]);
    expect(lines.find((l) => l.type === 'briefed')?.keys).toEqual([agentKey(SESSION, SUBAGENT), leadKey(SESSION)]);
  });
});

describe('what each milestone says', () => {
  it('tells a request from a short reply', () => {
    const state = office([
      { kind: 'prompt', at: sec(1), text: 'Build the CSV importer for the admin', notification: false },
      { kind: 'prompt', at: sec(2), text: 'A background task finished', notification: true },
      { kind: 'prompt', at: sec(3), text: 'yes go on', notification: false },
    ]);
    expect(told(state)).toEqual(['You replied: yes go on', 'You asked: Build the CSV importer for the admin']);
  });

  it('flags a report or a last word that ends with a question, keeping the question a long report cut off', () => {
    const long = `${'The importer reads every sample file and reports the rows it cannot parse. '.repeat(3).trim()}…`;
    const state = office([
      { kind: 'prompt', at: sec(1), text: 'Build the CSV importer for the admin', notification: false },
      ...spawn(sec(2), qa, 'Test the importer'),
      { kind: 'subagent-stop', at: sec(5), ...qa, lastMessage: 'two fail. **Retry?**', question: 'Retry?' },
      ...spawn(sec(6), backend, 'Write the importer'),
      { kind: 'subagent-stop', at: sec(9), ...backend, lastMessage: long, question: 'Should it skip bad rows?' },
      { kind: 'turn-end', at: sec(10), failed: false, lastMessage: 'Built it. Want the docs too?', question: 'Want the docs too?' },
    ]);
    expect(told(state).slice(0, 2)).toEqual(['The lead finished with a question for you: Built it. Want the docs too?', expect.stringMatching(/^The backend engineer reported back with a question: The importer reads .*… Should it skip bad rows\?$/)]);
    expect(told(state)).toContain('The QA engineer reported back with a question: Two fail. Retry?');
  });

  it('says what needed you, what was refused and what stopped', () => {
    const state = office([
      { kind: 'prompt', at: sec(1), text: 'Release the new version today', notification: false },
      { kind: 'tool-start', at: sec(2), toolUseId: 'q1', tool: 'AskUserQuestion', target: 'asking you a question', ask: 'Which chart library?' },
      { kind: 'tool-end', at: sec(3), toolUseId: 'q1', tool: 'AskUserQuestion', ok: true },
      { kind: 'tool-start', at: sec(4), toolUseId: 'q2', tool: 'AskUserQuestion', target: 'asking you a question' },
      ...spawn(sec(5), backend, 'Publish the package'),
      { kind: 'permission', at: sec(8), ...backend, tool: 'Bash', target: 'npm publish' },
      { kind: 'permission-denied', at: sec(9), ...backend, tool: 'Bash', target: 'npm publish' },
      { kind: 'notice', at: sec(10), message: 'Claude needs your input', needsYou: true },
      { kind: 'turn-end', at: sec(11), failed: true, lastMessage: 'API Error: overloaded' },
    ]);
    expect(told(state)).toEqual([
      'The lead stopped on an error: API Error: overloaded',
      'The lead needed you in Claude Code: Claude needs your input',
      "The backend engineer wasn't allowed to run npm publish",
      'The backend engineer asked for your OK to run npm publish',
      'The lead briefed the backend engineer: Publish the package',
      'The lead asked you a question in Claude Code',
      'The lead asked you: Which chart library?',
      'You asked: Release the new version today',
    ]);
  });

  it("leaves out the notice a permission prompt sends, whichever comes first", () => {
    const after = office([
      { kind: 'permission', at: sec(1), tool: 'Bash', target: 'npm publish' },
      { kind: 'notice', at: sec(30), message: 'Claude needs your permission to use Bash', needsYou: true },
    ]);
    const before = office([
      { kind: 'notice', at: sec(1), message: 'Claude needs your permission to use Bash', needsYou: true },
      { kind: 'permission', at: sec(1) + ECHO_MS, tool: 'Bash', target: 'npm publish' },
    ]);
    for (const state of [after, before]) expect(told(state)).toEqual(['The lead asked for your OK to run npm publish']);
    // Further apart, they are two moments that needed you.
    const apart = office([
      { kind: 'notice', at: sec(1), message: 'Claude needs your input', needsYou: true },
      { kind: 'permission', at: sec(1) + ECHO_MS + 1, tool: 'Bash', target: 'npm publish' },
    ]);
    expect(told(apart)).toHaveLength(2);
  });

  it('tells a gate run, and an agent-team task once when added and once when done', () => {
    const state = office([
      { kind: 'tool-start', at: sec(1), toolUseId: 'g', tool: 'Skill', target: 'code-gate' },
      { kind: 'tool-start', at: sec(2), toolUseId: 'p', tool: 'Skill', target: 'plan-feature' },
      { kind: 'task', at: sec(3), taskId: '1', title: 'Write the parser', status: 'open', owner: 'backend' },
      { kind: 'task', at: sec(4), taskId: '1', title: 'Write the parser', status: 'open' },
      { kind: 'task', at: sec(5), ...backend, taskId: '1', title: 'Write the parser', status: 'done' },
      { kind: 'task', at: sec(6), ...backend, taskId: '1', title: 'Write the parser', status: 'done' },
    ]);
    expect(told(state)).toEqual(['The backend engineer finished a task: Write the parser', 'The lead added a task: Write the parser', 'The lead ran the code gate']);
  });

  it('says a brief without its task when the office missed the call, and names a gate the studio no longer has', () => {
    const state = office([
      { kind: 'subagent-start', at: sec(1), ...qa },
      { kind: 'tool-start', at: sec(2), ...qa, toolUseId: 'g', tool: 'Skill', target: 'code-gate' },
    ]);
    expect(told(state)).toEqual(['The QA engineer ran the code gate', 'The lead briefed the QA engineer']);
    expect(storyLines({ ...source(state), studio: { gates: [], roles: [] } }).map((l) => l.text)[0]).toBe('The QA engineer ran the code gate');
  });

  it('cuts a request and a brief at 160 characters and a report at 240, at a word', () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
    const state = office([
      { kind: 'prompt', at: sec(1), text: long(100), notification: false },
      ...spawn(sec(2), qa, long(100)),
      { kind: 'subagent-stop', at: sec(5), ...qa, lastMessage: long(200) },
    ]);
    const lines = storyLines(source(state));
    for (const l of lines) expect((l.about ?? '').length).toBeLessThanOrEqual(l.type === 'reported' ? RESULT_CHARS : LINE_CHARS);
    expect(lines.map((l) => l.about?.endsWith('…'))).toEqual([true, true, true]);
    expect(lines[0]?.about?.length).toBeGreaterThan(LINE_CHARS);
  });

  it('shows Markdown as plain text, and starts a report with a capital', () => {
    const state = office([...spawn(sec(1), qa, 'Check `notes.txt` and _the_ flow'), { kind: 'subagent-stop', at: sec(5), ...qa, lastMessage: 'the file `notes.txt` contains **hello**.' }]);
    expect(told(state)).toEqual(['The QA engineer reported back: The file notes.txt contains hello.', 'The lead briefed the QA engineer: Check notes.txt and the flow']);
  });
});

describe('many people', () => {
  it('names leads by session, says which lead you asked, and keeps each badge to its people', () => {
    const sessions = ['aaaaaa11-0000', 'bbbbbb22-0000', 'cccccc33-0000'];
    const state = emptyOffice();
    sessions.forEach((s, i) => {
      const helpers = Array.from({ length: [17, 16, 14][i] ?? 0 }, (_, n) => ({ agentId: `${s}-x${n}`, agentType: 'Explore' }));
      office([
        { kind: 'prompt', at: sec(i * 100), text: `Request number ${i + 1} for the whole studio`, notification: false },
        ...helpers.flatMap((w, n) => spawn(sec(i * 100 + 10 + n), w, `Look into part ${n}`)),
        ...helpers.map((w, n): Step => ({ kind: 'subagent-stop', at: sec(i * 100 + 40 + n), ...w, lastMessage: `Part ${n} looked into.` })),
        { kind: 'prompt', at: sec(i * 100 + 80), text: 'ok', notification: false },
      ], s, state);
    });
    const lines = storyLines(source(state));
    expect(lines).toHaveLength(3 * 2 + 2 * (17 + 16 + 14));
    expect(lines.map((l) => l.text)).toContain('You asked the lead in session aaaaaa: Request number 1 for the whole studio');
    expect(lines.map((l) => l.text)).toContain('You replied to the lead in session cccccc: ok');
    expect(lines.map((l) => l.text)).toContain('The lead in session bbbbbb briefed the Explore agent: Look into part 15');
    expect(lines[0]?.text).toBe('You replied to the lead in session cccccc: ok');

    const lead = told(state, new Set([leadKey('bbbbbb22-0000')]));
    expect(lead).toHaveLength(2 + 16);
    expect(lead.every((l) => l.includes('the lead in session bbbbbb') || l.startsWith('The lead in session bbbbbb'))).toBe(true);
    expect(told(state, new Set([agentKey('cccccc33-0000', 'cccccc33-0000-x3')]))).toEqual([
      'The Explore agent reported back: Part 3 looked into.',
      'The lead in session cccccc briefed the Explore agent: Look into part 3',
    ]);
  });

  it('keeps every milestone of a busy session while the tool calls between them come and go', () => {
    const steps: Step[] = [{ kind: 'prompt', at: sec(0), text: 'Tidy every file in the repo', notification: false }, ...spawn(sec(1), backend, 'Tidy the server')];
    for (let i = 0; i < 400; i++) steps.push({ kind: 'tool-start', at: sec(10 + i), ...backend, toolUseId: `t${i}`, tool: 'Edit', target: `src/file-${i}.ts` });
    steps.push({ kind: 'subagent-stop', at: sec(500), ...backend, lastMessage: 'Every server file is tidy.' });
    const state = office(steps);
    expect(state.activity.filter((e) => e.kind === 'step')).toHaveLength(300);
    expect(told(state)).toEqual([
      'The backend engineer reported back: Every server file is tidy.',
      'The lead briefed the backend engineer: Tidy the server',
      'You asked: Tidy every file in the repo',
    ]);
  });

  it('names someone the office has let go of from the log, without a button', () => {
    const state = office([...spawn(sec(1), qa, 'Test the importer'), ...spawn(sec(2), { agentId: 'x1', agentType: 'Explore' }, 'Find the parser')]);
    const gone = { ...source(state), agents: [] };
    expect(storyLines(gone).map((l) => [l.text, l.who.key, l.whom?.key])).toEqual([
      ['The lead briefed the Explore agent: Find the parser', null, null],
      ['The lead briefed the QA engineer: Test the importer', null, null],
    ]);
  });
});

describe('secrets in the story', () => {
  it('keeps a secret in a report masked', () => {
    const token = fake('ghp_', 36);
    const state = emptyOffice();
    for (const [i, p] of [
      { hook_event_name: 'SubagentStart', agent_id: 'q1', agent_type: 'qa-engineer' },
      { hook_event_name: 'SubagentStop', agent_id: 'q1', agent_type: 'qa-engineer', last_assistant_message: `Deployed with ${token}. Should I rotate it?` },
    ].entries()) {
      const e = normalizeHook({ session_id: 's', cwd: '/p', ...p }, sec(i));
      if (e) apply(state, e, index);
    }
    const lines = told(state);
    expect(lines[0]).toBe('The QA engineer reported back with a question: Deployed with [redacted]. Should I rotate it?');
    expect(JSON.stringify(storyLines(source(state)))).not.toContain(token);
  });

  it('masks a secret that Markdown hid from earlier masking, in a report, a brief and a question', () => {
    // Applied as written, without the masking events get on arrival: this is the story's own pass.
    const secret = 'token: `a1b2c3d4e5f6`';
    const state = office([
      ...spawn(sec(1), qa, `Check the deploy ${secret}`),
      { kind: 'subagent-stop', at: sec(5), ...qa, lastMessage: `The deploy ${secret}` },
      { kind: 'tool-start', at: sec(6), toolUseId: 'q', tool: 'AskUserQuestion', target: 'asking you a question', ask: `Keep the ${secret}?` },
    ]);
    expect(told(state)).toEqual([
      'The lead asked you: Keep the token: [redacted]?',
      'The QA engineer reported back: The deploy token: [redacted]',
      'The lead briefed the QA engineer: Check the deploy token: [redacted]',
    ]);
  });
});
