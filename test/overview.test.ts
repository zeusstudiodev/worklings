import { describe, expect, it } from 'vitest';
import {
  type Approval,
  type LobbyCompany,
  LOOK_GAP_MS,
  type Question,
  type Report,
  STAKEHOLDER,
  type Task,
  THE_OFFICE,
} from '../src/core/company.ts';
import {
  goalLine,
  needsAcross,
  needsYouOf,
  nextLooks,
  OVERVIEW_LIMITS,
  sameTurnHandoverSince,
  type SinceInput,
  sinceOf,
  sinceStart,
  stageOf,
  type SummaryInput,
  summaryOf,
} from '../src/core/overview.ts';
import type { Decision, Plan, PlanVersion, PlanView } from '../src/core/steering.ts';

const NOW = 10_000_000;
const MIN = 60_000;

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    brief: '',
    owner: 'lea',
    askedBy: 'ceo',
    files: [`src/${id}.ts`],
    doneWhen: 'Done.',
    status: 'queued',
    outcome: null,
    parent: null,
    milestone: null,
    worktree: null,
    commit: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function question(id: string, over: Partial<Question> = {}): Question {
  return { id, from: 'ceo', text: `Question ${id}?`, options: ['Yes', 'No'], recommended: 0, taskId: null, askedAt: 0, answer: null, withdrawn: null, ...over };
}

function approval(id: string, over: Partial<Approval> = {}): Approval {
  return {
    id,
    person: 'lea',
    tool: 'Bash',
    summary: 'Push the work branch to GitHub',
    detail: 'git push',
    kind: 'push',
    askedAt: 0,
    expiresAt: NOW + 10 * MIN,
    alwaysRule: null,
    answer: null,
    withdrawn: null,
    ...over,
  };
}

const plan: Plan = {
  goal: 'A café site',
  milestones: [
    { id: 'ms-1', title: 'Menu', doneWhen: 'The menu shows.' },
    { id: 'ms-2', title: 'Launch', doneWhen: 'It is live.' },
  ],
  tasks: [
    { id: 'p-1', title: 'Menu page', owner: 'lea', files: ['src/menu'], milestone: 'ms-1', after: [], brief: '', doneWhen: 'Shows.' },
    { id: 'p-2', title: 'Prices', owner: 'noor', files: ['src/prices'], milestone: 'ms-1', after: [], brief: '', doneWhen: 'Shows.' },
    { id: 'p-3', title: 'Deploy', owner: 'noor', files: ['deploy'], milestone: 'ms-2', after: ['p-1'], brief: '', doneWhen: 'Live.' },
    { id: 'p-4', title: 'Final review of the whole result', owner: 'qa', files: [], milestone: 'ms-2', after: ['p-3'], brief: '', doneWhen: 'Reviewed.', kind: 'verification' },
  ],
};
const v1: PlanVersion = { version: 1, by: 'ceo', at: 5 * MIN, plan, note: null, cites: [] };
const approved: Pick<PlanView, 'versions' | 'approved' | 'waiting'> = { versions: [v1], approved: { version: 1, through: null, at: 6 * MIN, by: STAKEHOLDER, cites: [] }, waiting: null };
const people = [
  { id: 'ceo', name: 'Ada', level: 'ceo' },
  { id: 'lea', name: 'Lea', level: 'worker' },
  { id: 'noor', name: 'Noor', level: 'worker' },
  { id: 'qa', name: 'QA engineer', level: 'worker' },
];

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    id: 'cafe',
    phase: 'running',
    prompt: 'A site for our café. It should show the menu with prices.',
    goal: null,
    tasks: [],
    questions: [],
    approvals: [],
    reports: [],
    statuses: [],
    log: [],
    pause: null,
    problem: null,
    done: null,
    stalled: null,
    plan: approved,
    planApproval: 'before-work',
    people,
    working: [],
    spent: 0,
    budget: null,
    checklist: null,
    ...over,
  };
}

describe('goalLine', () => {
  it('is the first sentence of the prompt, plain and cut to one line', () => {
    expect(goalLine('A site for our **café**. It should show the menu.')).toBe('A site for our café.');
    expect(goalLine('\n\n  Build `the app`\nwith more lines')).toBe('Build the app');
    const long = goalLine(`${'word '.repeat(80)}end.`);
    expect(long.length).toBeLessThanOrEqual(OVERVIEW_LIMITS.goal);
    expect(long.endsWith('…')).toBe(true);
  });

  it('masks a secret in the prompt', () => {
    expect(goalLine('Use the key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 for the bot.')).not.toContain('abcdefghijklmnop');
  });
});

describe('stageOf', () => {
  const pause = { reason: 'stakeholder' as const, since: 0, until: null, message: 'Paused.' };
  const stalled = { since: 1, tasks: [] };

  it('names each of the seven stages', () => {
    expect(stageOf(input({ phase: 'founding', plan: null }), NOW)).toBe('scoping');
    expect(stageOf(input({ phase: 'proposed', plan: null }), NOW)).toBe('waiting');
    expect(stageOf(input({ plan: { versions: [v1], approved: null, waiting: null } }), NOW)).toBe('waiting');
    expect(stageOf(input({ tasks: [task('t-1', { planTask: 'p-1', status: 'working' })] }), NOW)).toBe('working');
    expect(stageOf(input({ tasks: [task('t-4', { planTask: 'p-4', status: 'working' })] }), NOW)).toBe('checking');
    expect(stageOf(input({ done: NOW }), NOW)).toBe('done');
    expect(stageOf(input({ pause }), NOW)).toBe('paused');
    expect(stageOf(input({ stalled }), NOW)).toBe('stuck');
    expect(stageOf(input({ problem: "Its folder isn't there any more." }), NOW)).toBe('stuck');
  });

  it('counts a re-check or the end check as checking, and a fix as working', () => {
    const followUp = (kind: 'fix' | 'recheck' | 'end-check') => task('t-9', { status: 'queued', followUp: { kind, verification: 't-4', items: [] } });
    expect(stageOf(input({ tasks: [followUp('recheck')] }), NOW)).toBe('checking');
    expect(stageOf(input({ tasks: [followUp('end-check')] }), NOW)).toBe('checking');
    expect(stageOf(input({ tasks: [followUp('fix')] }), NOW)).toBe('working');
    expect(stageOf(input({ tasks: [task('t-4', { planTask: 'p-4', status: 'done' })] }), NOW)).toBe('working');
  });

  it('lets paused and stuck beat working and checking', () => {
    const checking = [task('t-4', { planTask: 'p-4', status: 'working' })];
    expect(stageOf(input({ tasks: checking, pause }), NOW)).toBe('paused');
    expect(stageOf(input({ tasks: checking, stalled }), NOW)).toBe('stuck');
    expect(stageOf(input({ phase: 'stopped' }), NOW)).toBe('paused');
    expect(stageOf(input({ phase: 'stopped', done: NOW }), NOW)).toBe('done');
  });

  it('reads working, not checking, while the final review only waits in the queue with the rest of the approved plan', () => {
    // Approval queues every plan task at once, the final review among them; only the first is under way.
    const queued = [task('t-1', { planTask: 'p-1', status: 'working' }), task('t-2', { planTask: 'p-2' }), task('t-3', { planTask: 'p-3' }), task('t-4', { planTask: 'p-4', owner: 'qa' })];
    expect(stageOf(input({ tasks: queued }), NOW)).toBe('working');
    const reviewing = [task('t-1', { planTask: 'p-1', status: 'done' }), task('t-4', { planTask: 'p-4', owner: 'qa', status: 'working' })];
    expect(stageOf(input({ tasks: reviewing }), NOW)).toBe('checking');
    expect(stageOf(input({ tasks: [task('t-4', { planTask: 'p-4', owner: 'qa', status: 'blocked' })] }), NOW)).toBe('checking');
  });

  it('reads waiting when everyone at work only waits on you, as the office says', () => {
    const lea = { id: 'lea', name: 'Lea', task: 'Menu page' };
    const noor = { id: 'noor', name: 'Noor', task: 'Prices' };
    const tasks = [task('t-1', { planTask: 'p-1', status: 'working' })];
    // Lea's turn holds on her own question, and nobody else works.
    expect(stageOf(input({ tasks, working: [lea], questions: [question('q-1', { from: 'lea' })] }), NOW)).toBe('waiting');
    expect(stageOf(input({ tasks, working: [lea], approvals: [approval('a-1')] }), NOW)).toBe('waiting');
    // Nobody at work and a question open.
    expect(stageOf(input({ tasks, questions: [question('q-1')] }), NOW)).toBe('waiting');
    // Someone else still works.
    expect(stageOf(input({ tasks, working: [lea, noor], questions: [question('q-1', { from: 'lea' })] }), NOW)).toBe('working');
    // The office's "start?" before a task holds nobody, and an answered or expired item waits on nobody.
    expect(stageOf(input({ tasks, working: [lea], questions: [question('q-1', { from: 'lea', gate: { task: 't-2' } })] }), NOW)).toBe('working');
    expect(stageOf(input({ tasks, working: [lea], approvals: [approval('a-1', { expiresAt: NOW - 1 })] }), NOW)).toBe('working');
    expect(stageOf(input({ tasks, working: [lea], questions: [question('q-1', { from: 'lea', answer: { option: 0, text: 'Yes', at: 1, appliesAt: 2 } })] }), NOW)).toBe('working');
  });

  it("doesn't wait on a plan when plan approval is off", () => {
    expect(stageOf(input({ plan: { versions: [v1], approved: null, waiting: null }, planApproval: 'off' }), NOW)).toBe('working');
  });
});

describe('needsYouOf', () => {
  it('opens each item at its place, oldest first', () => {
    const items = needsYouOf(
      input({
        questions: [question('q-1', { askedAt: 3 }), question('q-2', { askedAt: 1, from: THE_OFFICE, budget: { scope: 'company', person: null, at: 80, cap: 20, raiseTo: [30] } }), question('q-3', { answer: { option: 0, text: 'Yes', at: 1, appliesAt: 2 } })],
        approvals: [approval('a-1', { askedAt: 2 }), approval('a-2', { expiresAt: NOW - 1 })],
        plan: { versions: [v1], approved: null, waiting: null },
      }),
      'cafe',
      NOW,
    );
    expect(items.map((n) => [n.kind, n.from, n.target])).toEqual([
      ['budget', null, { panel: 'inbox', item: 'q-2' }],
      ['approval', 'Lea', { panel: 'inbox', item: 'a-1' }],
      ['question', 'Ada', { panel: 'inbox', item: 'q-1' }],
      ['plan', 'Ada', { main: 'plan' }],
    ]);
    expect(items.every((n) => n.company === 'cafe')).toBe(true);
  });

  it('points a proposal at the proposal, scoping questions at the inbox, a waiting milestone and stalled work at plan and progress', () => {
    const founding = needsYouOf(input({ phase: 'founding', plan: null, questions: [question('q-1')] }), 'cafe', NOW);
    expect(founding.map((n) => n.kind)).toEqual(['scoping']);
    const proposed = needsYouOf(input({ phase: 'proposed', plan: null, log: [{ at: 7, kind: 'proposal', by: 'ceo', text: 'Proposed.' }] }), 'cafe', NOW);
    expect(proposed).toEqual([{ company: 'cafe', kind: 'proposal', text: 'The proposed team waits for your OK to start.', from: 'Ada', at: 7, target: { panel: 'proposal' } }]);
    const milestone = needsYouOf(input({ plan: { ...approved, approved: { ...approved.approved!, through: 'ms-1' }, waiting: { milestone: 'ms-1', since: 9, report: null } }, planApproval: 'milestones' }), 'cafe', NOW);
    expect(milestone).toEqual([{ company: 'cafe', kind: 'milestone', text: '“Launch” waits for your approval before it starts.', from: null, at: 9, target: { main: 'plan' } }]);
    const stuck = needsYouOf(input({ stalled: { since: 4, tasks: [{ id: 't-5', title: 'Menu page', owner: 'lea', status: 'working', lastStatus: null }] } }), 'cafe', NOW);
    expect(stuck).toEqual([{ company: 'cafe', kind: 'stuck', text: 'Work has stopped with 1 task still open.', from: null, at: 4, target: { main: 'progress' } }]);
  });

  it('writes no ids or paths in its own sentences', () => {
    const items = needsYouOf(
      input({
        phase: 'proposed',
        problem: "Its folder isn't at C:\\Users\\jamie\\plant-pal any more.",
        stalled: { since: 4, tasks: [{ id: 't-5', title: 'Menu page', owner: 'lea', status: 'working', lastStatus: null }] },
      }),
      'cafe',
      NOW,
    );
    for (const n of items) expect(n.text).not.toMatch(/\b[tp]-\d+\b|[\\/]|ms-\d/);
  });
});

describe('summaryOf', () => {
  const tasks = [
    task('t-1', { planTask: 'p-1', status: 'done', title: 'Menu page', owner: 'lea', updatedAt: 30 }),
    task('t-2', { planTask: 'p-2', status: 'done', title: 'Prices', owner: 'noor', updatedAt: 40 }),
    task('t-3', { planTask: 'p-3', status: 'working', title: 'Deploy', owner: 'noor', updatedAt: 50 }),
    task('t-5', { status: 'done', title: 'Fix: Menu page', updatedAt: 60, followUp: { kind: 'fix', verification: 't-4', items: ['p-1 prices'] } }),
    task('t-6', { status: 'done', title: 'Old work', updatedAt: 10 }),
  ];

  it('counts the plan without follow-ups, and lists what was achieved newest first, three at most and without the office’s follow-ups', () => {
    const s = summaryOf(input({ tasks, goal: { text: 'A café site', setAt: 0, milestones: [{ id: 'ms-1', title: 'Menu', doneWhen: '', doneAt: 45 }, { id: 'ms-2', title: 'Launch', doneWhen: '', doneAt: null }] } }), NOW);
    expect(s.tasks).toEqual({ done: 2, planned: 4 });
    expect(s.milestones).toEqual({ done: 1, planned: 2 });
    // "Fix: Menu page" is how the final review's failure was put right, not something the company achieved.
    expect(s.achieved).toEqual([
      { title: 'Prices', by: 'Noor', at: 40 },
      { title: 'Menu page', by: 'Lea', at: 30 },
      { title: 'Old work', by: 'Lea', at: 10 },
    ]);
    expect(s.goal).toBe('A site for our café.');
    expect(s.stage).toBe('working');
    expect(s.movedAt).toBe(60);
    expect(s.preview).toBeNull();
  });

  it("leaves the plan's final review out of what was achieved: it checks the work, it isn't work of its own", () => {
    const reviewed = [
      task('t-1', { planTask: 'p-1', status: 'done', title: 'Menu page', owner: 'lea', updatedAt: 30 }),
      task('t-4', { planTask: 'p-4', status: 'done', title: 'Final review of the whole result', owner: 'qa', updatedAt: 70 }),
    ];
    const s = summaryOf(input({ tasks: reviewed, plan: approved }), NOW);
    expect(s.achieved.map((a) => a.title)).toEqual(['Menu page']);
  });

  it('leaves a dropped plan task out of the plan, and counts tasks without a plan', () => {
    const dropped = [task('t-1', { planTask: 'p-1', status: 'done' }), task('t-2', { planTask: 'p-2', status: 'dropped' })];
    expect(summaryOf(input({ tasks: dropped }), NOW).tasks).toEqual({ done: 1, planned: 3 });
    expect(summaryOf(input({ tasks, plan: null }), NOW).tasks).toEqual({ done: 3, planned: 4 });
    expect(summaryOf(input({ plan: { versions: [v1], approved: null, waiting: null } }), NOW).milestones).toEqual({ done: 0, planned: 2 });
  });

  it('counts the inbox, keeps every need oldest first, and caps who is working at four', () => {
    const questions = Array.from({ length: 7 }, (_, n) => question(`q-${n}`, { askedAt: 100 - n }));
    const s = summaryOf(
      input({
        questions,
        stalled: { since: 1, tasks: [] },
        working: Array.from({ length: 6 }, (_, n) => ({ id: `p${n}`, name: `Person ${n}`, task: n === 0 ? null : `Task ${n}` })),
        spent: 4.2,
        budget: 20,
        checklist: { met: 1, partly: 0, 'not-met': 0, unchecked: 2 },
      }),
      NOW,
    );
    expect(s.needs.count).toBe(7);
    // Every item, work that stopped too: the lobby's strip counts and shows them all.
    expect(s.needs.items).toHaveLength(8);
    expect(s.needs.items.map((n) => n.at)).toEqual([1, 94, 95, 96, 97, 98, 99, 100]);
    expect(s.working).toHaveLength(4);
    expect(s.working[0]).toEqual({ name: 'Person 0', task: null });
    expect(s.spend).toEqual({ spent: 4.2, budget: 20 });
    expect(s.checklist).toEqual({ met: 1, partly: 0, 'not-met': 0, unchecked: 2 });
    expect(s.stage).toBe('stuck');
  });

  it('caps and masks untrusted titles, and names someone who left without an id', () => {
    const s = summaryOf(input({ tasks: [task('t-1', { status: 'done', owner: 'gone', title: `Set token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 ${'x'.repeat(300)}`, updatedAt: 5 })] }), NOW);
    const [a] = s.achieved;
    expect(a?.title.length).toBeLessThanOrEqual(OVERVIEW_LIMITS.title);
    expect(a?.title).not.toContain('ghp_abcdefghij');
    expect(a?.by).toBe('Someone who left');
  });
});

describe('needsAcross', () => {
  it('merges every item of every company oldest first, drops none, and skips companies without a summary', () => {
    const cafe = summaryOf(input({ questions: Array.from({ length: 7 }, (_, n) => question(`q-${n}`, { askedAt: n * 2 })) }), NOW);
    const shop = summaryOf(input({ id: 'shop', questions: Array.from({ length: 7 }, (_, n) => question(`q-${n}`, { askedAt: n * 2 + 1 })) }), NOW);
    const entry = (id: string, summary?: LobbyCompany['summary']): Pick<LobbyCompany, 'summary'> & { id: string } => ({ id, ...(summary ? { summary } : {}) });
    const items = needsAcross([entry('cafe', cafe), entry('broken'), entry('shop', shop)]);
    // 14 waiting: the strip's badge and "Show all 14" count the same list.
    expect(items).toHaveLength(cafe.needs.count + shop.needs.count);
    expect(items.map((n) => n.at)).toEqual(Array.from({ length: 14 }, (_, n) => n));
    expect(items.map((n) => n.company)).toEqual(Array.from({ length: 14 }, (_, n) => (n % 2 === 0 ? 'cafe' : 'shop')));
  });
});

describe('looks', () => {
  const gap = LOOK_GAP_MS;

  it('starts a new visit only after a pause longer than the gap', () => {
    const first = nextLooks({ last: null, previous: null }, 1000);
    expect(first).toEqual({ last: 1000, previous: null });
    const sameVisit = nextLooks(first, 1000 + gap);
    expect(sameVisit).toEqual({ last: 1000 + gap, previous: null });
    const nextVisit = nextLooks(sameVisit, 1000 + 2 * gap + 1);
    expect(nextVisit).toEqual({ last: 1000 + 2 * gap + 1, previous: 1000 + gap });
  });

  it('keeps the window the same before and after the visit’s first look is recorded', () => {
    expect(sinceStart({ last: null, previous: null }, NOW)).toBeNull();
    const looks = { last: NOW - 3 * gap, previous: NOW - 10 * gap };
    const before = sinceStart(looks, NOW);
    expect(before).toBe(NOW - 3 * gap);
    expect(sinceStart(nextLooks(looks, NOW), NOW + 1000)).toBe(before);
    expect(sinceStart({ last: NOW - gap, previous: null }, NOW)).toBeNull();
  });
});

describe('sinceOf', () => {
  const decision = (id: string, by: string, at: number): Decision => ({
    id,
    at,
    by,
    kind: 'decide',
    what: `Decision ${id}.`,
    why: null,
    alternatives: [],
    people: [by],
    rooms: [],
    links: {},
    reversible: false,
    undone: null,
    reconsider: null,
  });
  const report = (taskId: string, files: string[], at: number): Report => ({ id: `r-${at}`, person: 'lea', to: 'ceo', taskId, outcome: 'done', text: 'Done.', at, files, open: [] });

  function since(over: Partial<SinceInput> = {}): SinceInput {
    return {
      tasks: [
        task('t-1', { status: 'done', title: 'Menu page', updatedAt: 200, files: ['src/menu'] }),
        task('t-2', { status: 'done', title: 'Prices', owner: 'noor', updatedAt: 300, files: ['src/prices'] }),
        task('t-3', { status: 'done', title: 'Old', updatedAt: 50 }),
        task('t-4', { status: 'working', updatedAt: 400 }),
      ],
      reports: [report('t-1', ['src/menu/page.tsx', 'src/menu/page.test.tsx'], 190), report('t-2', [], 290)],
      decisions: [decision('d-1', STAKEHOLDER, 150), decision('d-2', 'ceo', 250), decision('d-3', THE_OFFICE, 20)],
      people,
      stakeholder: 'Robin',
      spend: [
        { person: 'lea', at: 90, cost: 1 },
        { person: 'lea', at: 150, cost: 0.5 },
        { person: 'noor', at: 260, cost: 1.3 },
      ],
      questions: [question('q-1'), question('q-2', { withdrawn: { reason: 'x', at: 1 } })],
      approvals: [approval('a-1')],
      ...over,
    };
  }

  it('lists what finished after the mark, newest first, with the files each changed', () => {
    const d = sinceOf(since(), 100, NOW);
    expect(d.since).toBe(100);
    expect(d.finished).toEqual([
      { title: 'Prices', by: 'Noor', at: 300, files: ['src/prices'] },
      { title: 'Menu page', by: 'Lea', at: 200, files: ['src/menu/page.tsx', 'src/menu/page.test.tsx'] },
    ]);
    expect(d.finishedCount).toBe(2);
    expect(d.decisions).toEqual([
      { what: 'Decision d-2.', by: 'Ada', at: 250 },
      { what: 'Decision d-1.', by: 'Robin', at: 150 },
    ]);
    expect(d.decisionCount).toBe(2);
    expect(d.spent).toBeCloseTo(1.8);
    expect(d.waiting).toBe(2);
  });

  it('leaves out the office’s end check, fixes and re-checks', () => {
    const followUp = (id: string, kind: 'fix' | 'recheck' | 'end-check', title: string) => task(id, { status: 'done', title, updatedAt: 500, followUp: { kind, verification: 't-9', items: [] } });
    const tasks = [task('t-1', { status: 'done', title: 'Menu page', updatedAt: 200 }), followUp('t-7', 'end-check', 'End check against the request'), followUp('t-8', 'fix', 'Fix: Menu page'), followUp('t-9', 'recheck', 'Re-check: 1 requirement')];
    const d = sinceOf(since({ tasks }), 100, NOW);
    expect(d.finished.map((f) => f.title)).toEqual(['Menu page']);
    expect(d.finishedCount).toBe(1);
  });

  it('caps the lists but keeps the counts, and the files of each', () => {
    const many = Array.from({ length: 15 }, (_, n) => task(`t-${n}`, { status: 'done', updatedAt: 1000 + n, files: Array.from({ length: 10 }, (_, f) => `src/f${f}.ts`) }));
    const d = sinceOf(since({ tasks: many, decisions: Array.from({ length: 10 }, (_, n) => decision(`d-${n}`, THE_OFFICE, 1000 + n)) }), 100, NOW);
    expect(d.finished).toHaveLength(OVERVIEW_LIMITS.finished);
    expect(d.finishedCount).toBe(15);
    expect(d.finished[0]?.files).toHaveLength(OVERVIEW_LIMITS.files);
    expect(d.decisions).toHaveLength(OVERVIEW_LIMITS.decisions);
    expect(d.decisionCount).toBe(10);
    expect(d.decisions[0]?.by).toBe('The office');
  });
});

describe('sameTurnHandoverSince', () => {
  const work = task('t-1', { status: 'done', createdAt: 10, updatedAt: 50 });
  const end = (createdAt: number) => task(`t-e${createdAt}`, { status: 'done', createdAt, updatedAt: createdAt + 5, followUp: { kind: 'end-check', verification: 'x', items: [] } });

  it('starts at the newest end check, or at the last of the plan’s own work when that came later', () => {
    expect(sameTurnHandoverSince([work, end(60)])).toBe(60);
    expect(sameTurnHandoverSince([work, end(20), end(70)])).toBe(70);
    expect(sameTurnHandoverSince([task('t-2', { status: 'done', updatedAt: 90 }), end(60)])).toBe(90);
  });

  it('is null without an end check, or once its failures went to a re-check', () => {
    expect(sameTurnHandoverSince([work])).toBeNull();
    expect(sameTurnHandoverSince([work, end(60), task('t-r', { status: 'done', createdAt: 80, followUp: { kind: 'recheck', verification: 'x', items: [] } })])).toBeNull();
  });
});
