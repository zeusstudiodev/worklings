import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseRun, companyFolder, labelOf, loadCompany } from '../scripts/accounting.ts';
import {
  addSubagent,
  analyseSession,
  cachedShare,
  classifyTrigger,
  classifyWork,
  freshSessionSavings,
  group,
  overheadShares,
  parseSession,
  type PersonInfo,
  roleOf,
  total,
  type Trigger,
  unfence,
} from '../src/core/accounting.ts';
import { type Person, STAKEHOLDER, THE_OFFICE, turnText } from '../src/core/company.ts';
import { costOf } from '../src/core/pricing.ts';
import { tempDir, writeTree } from './library-kit.ts';

const ceo: Person = { id: 'ceo', name: 'Ceo', title: 'CEO', level: 'ceo', room: 'ceo-office', reportsTo: null, look: {} };
const head: Person = { id: 'head-design', name: 'Ada', title: 'head of design', level: 'head', room: 'design', reportsTo: 'ceo', look: {} };
const worker: Person = { id: 'ui-designer', name: 'Mia', title: 'designer', level: 'worker', room: 'design', reportsTo: 'head-design', look: {} };
const people = [ceo, head, worker];
const FENCE = 'wl0123456789abcdef';

/** A delivered turn as the office writes it. */
const delivered = (from: string, text: string, extra: { id?: string; origin?: string } = {}): string =>
  turnText({ from, text, origin: extra.origin ?? null, ...(extra.id ? { id: extra.id } : {}) }, people, 'Robin', FENCE);

// ---------------------------------------------------------------------------------------------------------------
// Synthetic transcripts

const stamp = (s: number): string => new Date(Date.UTC(2026, 10, 12, 10, 0, s)).toISOString();
const line = (o: object): string => JSON.stringify(o);

const user = (s: number, content: string | object[]): string => line({ type: 'user', timestamp: stamp(s), message: { role: 'user', content } });
const queued = (s: number, prompt: string): string => line({ type: 'attachment', timestamp: stamp(s), attachment: { type: 'queued_command', prompt } });

interface Use {
  tool?: string;
  input?: object;
}
/** An assistant message as Claude Code writes it: one line per content block, all carrying the same usage. */
function assistant(s: number, id: string, usage: { input?: number; write?: number; read?: number; output?: number }, uses: Use[] = [], model = 'claude-sonnet-5-5'): string[] {
  const u = { input_tokens: usage.input ?? 2, cache_creation_input_tokens: usage.write ?? 0, cache_read_input_tokens: usage.read ?? 0, output_tokens: usage.output ?? 10, cache_creation: { ephemeral_1h_input_tokens: usage.write ?? 0, ephemeral_5m_input_tokens: 0 } };
  const blocks: object[] = [{ type: 'thinking', thinking: '' }, ...uses.map((x, i) => ({ type: 'tool_use', id: `tu-${id}-${i}`, name: x.tool, input: x.input ?? {} }))];
  if (uses.length === 0) blocks.push({ type: 'text', text: 'Done.' });
  return blocks.map((block) => line({ type: 'assistant', timestamp: stamp(s), message: { id, model, role: 'assistant', stop_reason: uses.length ? 'tool_use' : 'end_turn', content: [block], usage: u } }));
}
const toolResult = (s: number, id: string): string => user(s, [{ type: 'tool_result', tool_use_id: id, content: 'ok' }]);

const shapeLine = (): string =>
  line({
    type: 'api-request-shape',
    timestamp: stamp(0),
    shape: {
      system: [{ type: 'text', text: 'x'.repeat(94) }, { type: 'text', text: `${'r'.repeat(1000)}\n# Working at Test\n\nYou are Mia, designer at Test.${'h'.repeat(400)}` }],
      tools: [{ name: 'Bash', description: 'b'.repeat(200) }, { name: 'mcp__org__report', description: 'o'.repeat(100) }],
    },
  });

describe('parseSession', () => {
  const text = [
    shapeLine(),
    line({ type: 'attachment', timestamp: stamp(0), attachment: { type: 'skill_listing', content: 's'.repeat(300) } }),
    user(1, delivered(STAKEHOLDER, 'Make it warmer.', { id: 'm-1' })),
    ...assistant(2, 'a1', { write: 5_000, read: 1_000, output: 100 }, [{ tool: 'Edit' }]),
    toolResult(3, 'tu-a1-0'),
    queued(3, 'From Robin, the stakeholder (message m-2), between the two x lines:\nx\nAlso bigger.\nx'),
    ...assistant(4, 'a2', { write: 100, read: 6_000, output: 50 }),
    user(10, delivered(STAKEHOLDER, 'Thanks.', { id: 'm-3' })),
    ...assistant(11, 'a3', { write: 10, read: 6_100, output: 5 }),
    user(12, '<system-reminder>not a prompt</system-reminder>'),
  ].join('\n');

  it('splits turns at delivered prompts, folds queued messages in and ignores tool results and reminders', () => {
    const parsed = parseSession(text);
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[0]?.folded).toHaveLength(1);
    expect(parsed.turns[0]?.calls.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(parsed.turns[1]?.calls.map((c) => c.id)).toEqual(['a3']);
  });

  it('counts a message once however many lines it was written on', () => {
    const calls = parseSession(text).turns.flatMap((t) => t.calls);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.usage.cacheWrite1h).toBe(5_000);
    expect(calls[0]?.tools).toEqual([{ name: 'Edit' }]);
  });

  it('reads the shape of the first request and what was added before it', () => {
    const parsed = parseSession(text);
    expect(parsed.shape?.roleChars).toBeGreaterThan(1000);
    expect(parsed.shape?.houseChars).toBeGreaterThan(400);
    expect(parsed.shape?.houseHead).toContain('Mia, designer');
    expect(parsed.shape?.tools.map((t) => t.name)).toEqual(['Bash', 'mcp__org__report']);
    expect(parsed.attachments.skill_listing).toBeGreaterThan(300);
  });

  it('skips lines that are not JSON', () => {
    expect(parseSession(`garbage\n{"type":\n${text}`).turns).toHaveLength(2);
  });

  it('puts a subagent request in the turn that was under way', () => {
    const parsed = parseSession(text);
    addSubagent(parsed, [user(3, 'sub task'), ...assistant(3, 's1', { write: 700, output: 20 })].join('\n'));
    expect(parsed.turns[0]?.calls.some((c) => c.sub && c.id === 's1')).toBe(true);
  });
});

describe('what began a turn', () => {
  const trigger = (from: string, to: string, text: string, extra: Partial<{ id: string; origin: string; fromOffice: boolean; answers: string; relayOf: string }> = {}): Trigger => {
    const turn = delivered(from, text, { id: 'm-9', ...(extra.origin ? { origin: extra.origin } : {}) });
    return classifyTrigger(turn, { from, to, ...(extra.fromOffice ? { fromOffice: true } : {}), ...(extra.answers ? { answers: extra.answers } : {}), ...(extra.relayOf ? { relayOf: extra.relayOf } : {}) });
  };
  const direction = (a: string, b: string): 'down' | 'up' | 'side' => (a === 'ceo' ? 'down' : b === 'ceo' ? 'up' : 'side');

  it('unwraps the fenced words and the message id', () => {
    const u = unfence(delivered('head-design', 'Report on task t-3: done.', { id: 'm-12' }));
    expect(u.messageId).toBe('m-12');
    expect(u.body).toBe('Report on task t-3: done.');
    expect(u.header).toContain('Ada, head of design');
  });

  it.each<[string, string, string, Trigger, object?]>([
    [THE_OFFICE, 'ceo', 'You are founding a new company, and its first task is the org. The stakeholder asked for this:\n\n> A site', 'opening'],
    [THE_OFFICE, 'ceo', 'Corner started the company. Everyone in the proposal is hired; nobody costs anything until they have work.\nFirst set the goal', 'company-start'],
    [THE_OFFICE, 'ui-designer', 'New task t-4, from Robin: Palette\n\nBrief', 'task-brief'],
    [THE_OFFICE, 'ceo', 'Work has stopped: for a minute nobody has been at work\n- t-1', 'stall-nudge'],
    [THE_OFFICE, 'ceo', "Mia's turn ended with task t-3 still under way and no report on it. It ended without a word.", 'unreported-nudge'],
    [THE_OFFICE, 'ceo', 'Corner approved version 1 of the plan. Its tasks reach their owners', 'plan-event'],
    [THE_OFFICE, 'ceo', 'Milestone ms-1 "Menu" is done. What closed since your last turn comes with this one.', 'plan-event'],
    [THE_OFFICE, 'ui-designer', 'Task t-3, "Palette", came back: the office ran its check, npm test, and it failed (try 1 of 3).', 'review-return'],
    [THE_OFFICE, 'ceo', "Task t-3, \"Palette\", failed the office's check, npm test, 3 times, and Kai hasn't got it past.", 'review-return'],
    [THE_OFFICE, 'ui-designer', 'The office restarted. Carry on with "Palette".', 'restart'],
    [THE_OFFICE, 'head-design', 'Task t-3, "Palette", couldn\'t be committed, so it is back in review: x', 'office-notice'],
    [THE_OFFICE, 'ui-designer', 'Task t-3, "Palette", is open again: Corner undid its cancel.', 'task-update'],
    [STAKEHOLDER, 'ceo', 'Answers to your scoping questions:\n1. Who?\n   Everyone.', 'scoping-answers', { fromOffice: true }],
    [STAKEHOLDER, 'ceo', 'on "Which colours?": Warm ones.', 'inbox-answer', { fromOffice: true, answers: 'q-1' }],
    [STAKEHOLDER, 'ui-designer', 'No to "push the branch": not now', 'approval-notice', { fromOffice: true }],
    [STAKEHOLDER, 'ceo', 'A comment on the plan (version 1): add a footer', 'plan-event', { fromOffice: true }],
    [STAKEHOLDER, 'ui-designer', 'Make the colours warmer', 'stakeholder-message'],
    ['head-design', 'ceo', 'Report on task t-3, "Palette": done. Review it with review', 'report-up'],
    ['head-design', 'ceo', 'A question for you: which font?', 'question-up'],
    ['ceo', 'ui-designer', 'Task t-3, "Palette", came back from review: darker', 'review-return'],
  ])('%s to %s: "%.30s" is %s', (from, to, text, expected, extra) => {
    expect(trigger(from, to, text, extra as never)).toBe(expected);
  });

  it('tells a relay by its message or its header, and a plain message by who stands above whom', () => {
    expect(trigger('ceo', 'head-design', 'Make it darker', { origin: STAKEHOLDER, relayOf: 'm-4' })).toBe('relay');
    expect(classifyTrigger(delivered('ceo', 'Please look at the footer'), { from: 'ceo', to: 'ui-designer' }, direction)).toBe('message-down');
    expect(classifyTrigger(delivered('ui-designer', 'Which footer?'), { from: 'ui-designer', to: 'ceo' }, direction)).toBe('message-up');
    expect(classifyTrigger(delivered('ui-designer', 'Done with the header'), { from: 'ui-designer', to: 'copywriter' }, direction)).toBe('message-side');
  });

  it('falls back on the header when the company no longer has the message', () => {
    expect(classifyTrigger(delivered(THE_OFFICE, 'Work has stopped: x'), null)).toBe('stall-nudge');
    expect(classifyTrigger(delivered(STAKEHOLDER, 'Hello'), null)).toBe('stakeholder-message');
  });
});

describe('what a turn did', () => {
  const org = (n: string) => ({ name: `mcp__org__${n}` });
  const mia = { id: 'ui-designer', title: 'designer' };
  const sam = { id: 'qa-engineer', title: 'QA and accessibility tester' };

  it.each([
    [[org('propose_plan')], mia, 'planning'],
    [[org('assign'), org('post_status')], head, 'briefing'],
    [[org('relay')], head, 'relaying'],
    [[org('review')], head, 'deciding'],
    [[{ name: 'Edit' }, org('report')], mia, 'making'],
    [[{ name: 'Bash', command: 'npm install' }], mia, 'making'],
    [[{ name: 'Bash', command: 'npx vitest run' }], mia, 'checking'],
    [[{ name: 'mcp__chrome-devtools__take_snapshot' }], mia, 'checking'],
    [[{ name: 'Read' }, org('report')], sam, 'checking'],
    [[org('report')], mia, 'reporting'],
    [[org('message')], head, 'reporting'],
    [[org('ack'), { name: 'Read' }], mia, 'idle'],
    [[], mia, 'idle'],
  ])('%j for %j is %s', (tools, person, expected) => {
    expect(classifyWork(tools as never, person as never)).toBe(expected);
  });

  it('counts a tester who only wrote files as making, and one who also ran tests as checking', () => {
    expect(classifyWork([{ name: 'Write' }], sam)).toBe('making');
    expect(classifyWork([{ name: 'Write' }, { name: 'Bash', command: 'npm test' }], sam)).toBe('checking');
  });
});

describe('a desk and its turns', () => {
  const text = [
    shapeLine(),
    line({ type: 'attachment', timestamp: stamp(0), attachment: { type: 'skill_listing', content: 's'.repeat(2_000) } }),
    user(1, delivered(THE_OFFICE, 'New task t-1, from Robin: Palette', { id: 'm-1' })),
    ...assistant(2, 'a1', { input: 2, write: 40_000, read: 0, output: 300 }, [{ tool: 'Edit' }]),
    toolResult(3, 'tu-a1-0'),
    ...assistant(4, 'a2', { input: 2, write: 1_000, read: 40_000, output: 200 }, [{ tool: 'mcp__org__report' }]),
    toolResult(5, 'tu-a2-0'),
    ...assistant(6, 'a3', { input: 2, write: 100, read: 41_000, output: 20 }),
    user(60, delivered(STAKEHOLDER, 'Warmer please.', { id: 'm-2' })),
    ...assistant(61, 'a4', { input: 2, write: 800, read: 41_100, output: 120 }),
  ].join('\n');
  const person: PersonInfo = { id: 'ui-designer', title: 'designer', level: 'worker' };
  const run = (): ReturnType<typeof analyseSession> => analyseSession({ person, session: 's1', parsed: parseSession(text), message: () => null });

  it('prices every request and keeps cache reads apart from uncached input', () => {
    const { turns } = run();
    expect(turns.map((t) => [t.trigger, t.work])).toEqual([['task-brief', 'making'], ['stakeholder-message', 'idle']]);
    const t0 = turns[0];
    expect(t0?.usage).toMatchObject({ input: 6, cacheWrite1h: 41_100, cacheRead: 81_000, output: 520 });
    const expected = (costOf('claude-sonnet-5-5', { input: 2, output: 300, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 40_000 }) ?? 0) + (costOf('claude-sonnet-5-5', { input: 2, output: 200, cacheRead: 40_000, cacheWrite5m: 0, cacheWrite1h: 1_000 }) ?? 0) + (costOf('claude-sonnet-5-5', { input: 2, output: 20, cacheRead: 41_000, cacheWrite5m: 0, cacheWrite1h: 100 }) ?? 0);
    expect(t0?.cost).toBeCloseTo(expected, 8);
  });

  it('reads the fixed overhead off the first request and splits it by what it holds', () => {
    const { desk } = run();
    expect(desk.first).toMatchObject({ prompt: 40_002, cacheWrite: 40_000, cacheRead: 0 });
    expect(desk.model).toBe('claude-sonnet-5-5');
    const parts = desk.overhead;
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBeGreaterThan(39_990);
    expect(Object.keys(parts)).toEqual(expect.arrayContaining(['role prompt', 'house rules', 'built-in tools', 'org tools', 'skill list']));
  });

  it('sums by person, trigger and work, and gives the average and largest context', () => {
    const { turns } = run();
    const b = group(turns, (t) => t.trigger).get('task-brief');
    expect(b).toMatchObject({ turns: 1, calls: 3, ctxMax: 41_102 });
    expect(b ? b.ctxSum / b.calls : 0).toBeCloseTo((40_002 + 41_002 + 41_102) / 3, 3);
    expect(total(turns).turns).toBe(2);
    expect(cachedShare(total(turns).usage)).toBeGreaterThan(0.6);
  });

  it('counts a model the price table does not know in tokens and leaves it out of the cost', () => {
    const odd = [user(1, delivered(STAKEHOLDER, 'Hi', { id: 'm-1' })), ...assistant(2, 'o1', { write: 10, read: 20, output: 5 }, [], 'claude-unknown-9')].join('\n');
    const { turns } = analyseSession({ person, session: 's2', parsed: parseSession(odd), message: () => null });
    expect(turns[0]?.cost).toBe(0);
    expect(turns[0]?.unpricedTokens).toBe(37);
  });

  it('names the part a person plays', () => {
    expect(roleOf({ id: 'ceo', title: 'CEO', level: 'ceo' })).toBe('ceo');
    expect(roleOf({ id: 'head-design', title: 'head of design', level: 'head' })).toBe('manager');
    expect(roleOf({ id: 'qa-engineer', title: 'tester', level: 'worker' })).toBe('checker');
    expect(roleOf({ id: 'ui-designer', title: 'designer', level: 'worker' })).toBe('maker');
  });

  it('prices what a fresh session per task would save, less rewriting the fixed prompt', () => {
    const tasks = [
      user(1, delivered(THE_OFFICE, 'New task t-1, from M: A', { id: 'm-1' })),
      ...assistant(2, 'b1', { write: 40_000 }, [{ tool: 'Edit' }]),
      toolResult(3, 'tu-b1-0'),
      ...assistant(4, 'b2', { write: 160_000, read: 40_000 }),
      user(10, delivered(THE_OFFICE, 'New task t-2, from M: B', { id: 'm-2' })),
      ...assistant(11, 'b3', { write: 500, read: 200_000 }, [{ tool: 'Edit' }]),
      toolResult(12, 'tu-b3-0'),
      ...assistant(13, 'b4', { write: 500, read: 200_500 }),
    ].join('\n');
    const { turns, desk } = analyseSession({ person, session: 's3', parsed: parseSession(tasks), message: () => null });
    const f = freshSessionSavings(turns, desk.first?.prompt ?? 0, desk.first?.cacheWrite ?? 0);
    expect(f.segments).toBe(1);
    // Two requests in the second task each read the 160k that came in from the first, at the cache-read price.
    const reads = (costOf('claude-sonnet-5-5', { input: 0, output: 0, cacheRead: 320_000, cacheWrite5m: 0, cacheWrite1h: 0 }) ?? 0) - (costOf('claude-sonnet-5-5', { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 40_000 }) ?? 0);
    expect(f.saved).toBeCloseTo(reads, 6);
  });

  it('divides the first request by characters', () => {
    const shares = overheadShares({ roleChars: 100, houseChars: 100, houseHead: '', tools: [{ name: 'Read', chars: 200 }, { name: 'mcp__org__ack', chars: 200 }, { name: 'mcp__plugin_x__go', chars: 400 }] }, { skill_listing: 1000 }, 2_000);
    expect(shares).toEqual({ 'role prompt': 100, 'house rules': 100, 'built-in tools': 200, 'org tools': 200, 'mcp tools (plugin_x)': 400, 'skill list': 1_000 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A company on disk

describe('a company folder', () => {
  const MAC = '0'.repeat(64);
  const event = (seq: number, body: object): string => `{"seq":${seq},"event":${JSON.stringify(body)},"mac":"${MAC}"}`;

  function company(): { root: string; projects: string } {
    const root = tempDir('accounting-company-');
    const projects = tempDir('accounting-projects-');
    const msg = (id: string, from: string, to: string, text: string) => ({ id, from, to, text, origin: null, relayOf: null, note: null, at: 2_000, deliveredAt: 2_001, interrupt: false });
    const proposal = {
      company: 'Test Co', goal: 'g', theme: 'office', rooms: [], questions: [],
      people: [{ id: 'ceo', name: 'Ceo', title: 'CEO', level: 'ceo', room: 'ceo-office', reportsTo: null, model: 'inherit', owns: 'all' }, { id: 'ui-designer', name: 'Mia', title: 'designer', level: 'worker', room: 'design', reportsTo: 'ceo', model: 'inherit', owns: 'ui' }],
    };
    const log = [
      event(1, { type: 'founded', id: 'test-co-1a2b3c', name: 'Test Co', root, prompt: 'A site', stakeholder: 'Robin', at: 1_000 }),
      event(2, { type: 'proposal', proposal, questions: [] }),
      event(3, { type: 'message', message: msg('m-1', THE_OFFICE, 'ceo', 'You are founding a new company, and its first task is the org.') }),
      event(4, { type: 'message', message: msg('m-2', STAKEHOLDER, 'ui-designer', 'Make it warmer.') }),
      event(5, { type: 'batch', events: [{ type: 'session', person: 'ceo', sessionId: '11111111-aaaa-bbbb-cccc-000000000001' }, { type: 'session', person: 'ui-designer', sessionId: '22222222-aaaa-bbbb-cccc-000000000002' }] }),
      'this line is damaged',
    ].join('\n');
    writeTree(root, { '.worklings/events.jsonl': `${log}\n` });
    // The CEO ran in the project folder and the designer in a task worktree: another folder under the projects folder.
    writeTree(projects, {
      'C--proj/11111111-aaaa-bbbb-cccc-000000000001.jsonl': [user(1, delivered(THE_OFFICE, 'You are founding a new company, and its first task is the org.', { id: 'm-1' })), ...assistant(2, 'c1', { write: 1_000, output: 50 }, [{ tool: 'mcp__org__propose_org' }])].join('\n'),
      'C--proj-worktree/22222222-aaaa-bbbb-cccc-000000000002.jsonl': [user(1, delivered(STAKEHOLDER, 'Make it warmer.', { id: 'm-2' })), ...assistant(2, 'd1', { write: 2_000, output: 80 }, [{ tool: 'Edit' }])].join('\n'),
    });
    return { root, projects };
  }

  it('opens the company from its log, even when a line is damaged', () => {
    const { root } = company();
    const { state, warnings } = loadCompany(root);
    expect(state.messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(state.desks.ceo?.sessions).toEqual(['11111111-aaaa-bbbb-cccc-000000000001']);
    expect(state.proposal?.people).toHaveLength(2);
    expect(warnings.join(' ')).toBe('');
  });

  it('finds the company in a run folder\'s project folder and labels runs', () => {
    const { root } = company();
    const run = tempDir('accounting-run-');
    writeFileSync(join(run, 'result.json'), '{}');
    expect(companyFolder(root)).toBe(root);
    expect(companyFolder(run)).toBeNull();
    expect(labelOf('C:\\data\\runs\\api\\B-1\\project')).toBe('api/B-1');
    expect(labelOf('C:\\users\\public\\demo\\corner-bakery')).toBe('corner-bakery');
  });

  it('maps sessions to people from the records and finds a worktree session in another folder', () => {
    const { root, projects } = company();
    const report = analyseRun(root, projects);
    expect(report.unreadable).toEqual([]);
    expect(report.desks.map((d) => [d.person, d.mappedBy])).toEqual([['ceo', 'records'], ['ui-designer', 'records']]);
    expect(report.turns.map((t) => [t.person, t.trigger, t.work])).toEqual([['ceo', 'opening', 'planning'], ['ui-designer', 'stakeholder-message', 'making']]);
  });

  it('says so when a transcript is missing, and falls back on the house rules when the records name no session', () => {
    const { root } = company();
    const empty = tempDir('accounting-empty-');
    const missing = analyseRun(root, empty);
    expect(missing.unreadable.length).toBeGreaterThanOrEqual(2);

    const lone = company();
    // The records lose the designer's session; its transcript sits in the company's own folder and names her in its house rules.
    const encoded = lone.root.replace(/[^A-Za-z0-9]/g, '-');
    writeTree(lone.projects, { [`${encoded}/33333333-aaaa-bbbb-cccc-000000000003.jsonl`]: [shapeLine(), user(1, delivered(STAKEHOLDER, 'Hi', { id: 'm-2' })), ...assistant(2, 'e1', { write: 10 }, [{ tool: 'Edit' }])].join('\n') });
    const report = analyseRun(lone.root, lone.projects);
    expect(report.desks.find((d) => d.mappedBy === 'transcript')?.person).toBe('ui-designer');
  });
});
