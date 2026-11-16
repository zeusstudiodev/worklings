import { defaultSettings } from '../src/core/company-state.ts';
import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, milestoneOf, progressBoard, SERIES_POINTS, spendBoard, startOfDay, taskCounts, timeline, waitingForYou } from '../src/core/boards.ts';
import {
  type Approval, type CompanyView, type LogEntry, type Message, type PersonView, type Question, type Report, STAKEHOLDER, type StatusLine, type Task, THE_OFFICE,
} from '../src/core/company.ts';

// Times are local, so "today" starts at local midnight in whatever zone the tests run in. 5 Nov 2026 is clear of DST.
const at = (hour: number, minute = 0, day = 5) => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(14, 30);

function person(p: Pick<PersonView, 'id' | 'room'> & Partial<PersonView>): PersonView {
  return {
    name: p.title ?? p.id,
    title: p.id,
    level: 'worker',
    reportsTo: null,
    look: {},
    model: 'sonnet',
    desk: { person: p.id, state: 'closed', sessionId: null, since: 0, context: null, problem: null, queue: null },
    task: null,
    status: null,
    agentKey: null,
    cost: 0,
    ...p,
  };
}

const PEOPLE: PersonView[] = [
  person({ id: 'ceo', name: 'CEO', title: 'CEO', level: 'ceo', room: 'leadership', model: 'opus' }),
  person({ id: 'head-of-design', name: 'Ada', title: 'Head of design', level: 'head', room: 'design', reportsTo: 'ceo' }),
  person({ id: 'frontend-engineer', name: 'Kai', title: 'Frontend engineer', room: 'engineering', reportsTo: 'ceo' }),
  person({ id: 'ui-designer', name: 'Mina', title: 'UI designer', room: 'design', reportsTo: 'head-of-design' }),
  person({ id: 'german-copywriter', name: 'Lena', title: 'German copywriter', room: 'content', reportsTo: 'ceo', model: 'haiku' }),
];

function company(o: Partial<CompanyView> = {}): CompanyView {
  return {
    id: 'cafe-lumen',
    name: 'Café Lumen',
    phase: 'running',
    prompt: 'A bilingual café website with pickup orders',
    stakeholder: 'Robin',
    branch: 'worklings/cafe-lumen',
    theme: 'cafe',
    rooms: [],
    goal: null,
    people: PEOPLE,
    proposal: null,
    tasks: [],
    messages: [],
    questions: [],
    approvals: [],
    statuses: [],
    reports: [],
    dashboards: [],
    screenshots: [],
    spend: { samples: [], hourly: [], byPerson: [] },
    log: [],
    pause: null,
    settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [] },
    desks: { working: 0, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: null, problem: null },
    inbox: 0,
    seen: {},
    proposalEdited: false,
    problem: null,
    ...o,
  };
}

function task(t: Pick<Task, 'id' | 'owner' | 'status'> & Partial<Task>): Task {
  return {
    title: `Task ${t.id}`,
    brief: 'Do it well.',
    askedBy: 'ceo',
    files: [],
    doneWhen: 'It works.',
    outcome: null,
    parent: null,
    milestone: null,
    worktree: null,
    commit: null,
    createdAt: at(9),
    updatedAt: at(10),
    ...t,
  };
}

const question = (q: Pick<Question, 'id' | 'from'> & Partial<Question>): Question => ({
  text: 'Which payment first?',
  options: ['TWINT', 'Cards'],
  recommended: 0,
  taskId: null,
  askedAt: at(11),
  answer: null,
  withdrawn: null,
  ...q,
});

const approval = (a: Pick<Approval, 'id' | 'person'> & Partial<Approval>): Approval => ({
  tool: 'Bash',
  summary: 'Push the work branch to GitHub',
  detail: 'git push origin worklings/cafe-lumen --force-with-lease',
  kind: 'push',
  askedAt: at(12),
  expiresAt: at(12, 10),
  alwaysRule: { rule: 'Bash(git push origin:*)', sentence: 'any git push to origin.' },
  answer: null,
  withdrawn: null,
  ...a,
});

const GOAL = {
  text: 'Pickup orders work in German and English',
  setAt: at(8),
  milestones: [
    { id: 'm1', title: 'Menu pages live', doneWhen: 'Both menus render', doneAt: at(13) },
    { id: 'm2', title: 'Pickup orders work', doneWhen: 'An order reaches the café', doneAt: null },
  ],
};

const TASKS: Task[] = [
  task({ id: 't1', owner: 'frontend-engineer', status: 'done', milestone: 'm1', updatedAt: at(11) }),
  task({ id: 't2', owner: 'ui-designer', status: 'done', milestone: 'm1', updatedAt: at(12, 30) }),
  task({ id: 't3', owner: 'frontend-engineer', status: 'working', milestone: 'm2' }),
  task({ id: 't3a', owner: 'frontend-engineer', status: 'blocked', parent: 't3', title: 'Pay with TWINT at pickup', updatedAt: at(12) }),
  task({ id: 't4', owner: 'ui-designer', status: 'review', milestone: 'm2' }),
  task({ id: 't5', owner: 'german-copywriter', status: 'queued', milestone: 'm2' }),
  task({ id: 't6', owner: 'german-copywriter', status: 'dropped', milestone: 'm2' }),
  task({ id: 't7', owner: 'head-of-design', status: 'queued' }),
  task({ id: 't8', owner: 'seo-specialist', status: 'done', updatedAt: at(9, 30) }),
];

describe('the Progress board', () => {
  const view = company({ goal: GOAL, tasks: TASKS });

  it("counts each milestone's tasks, subtasks included, done of all but the dropped", () => {
    expect(progressBoard(view, NOW).milestones).toEqual([
      { id: 'm1', title: 'Menu pages live', doneWhen: 'Both menus render', doneAt: at(13), done: true, tasks: { done: 2, total: 2 } },
      { id: 'm2', title: 'Pickup orders work', doneWhen: 'An order reaches the café', doneAt: null, done: false, tasks: { done: 0, total: 4 } },
    ]);
  });

  it('agrees with the tasks themselves, overall and per room', () => {
    const board = progressBoard(view, NOW);
    const count = (tasks: Task[], status: Task['status']) => tasks.filter((t) => t.status === status).length;
    for (const status of ['queued', 'working', 'blocked', 'review', 'done', 'dropped'] as const) expect(board.counts[status]).toBe(count(TASKS, status));
    expect(board.counts.total).toBe(TASKS.filter((t) => t.status !== 'dropped').length);
    const roomOf = (t: Task) => PEOPLE.find((p) => p.id === t.owner)?.room ?? null;
    expect(board.rooms.map((r) => r.room)).toEqual(['design', 'engineering', 'content', null]);
    for (const r of board.rooms) {
      const inRoom = TASKS.filter((t) => roomOf(t) === r.room);
      expect(r.counts).toEqual(taskCounts(inRoom));
      expect(r.counts.done).toBe(count(inRoom, 'done'));
    }
    expect(board.rooms.reduce((sum, r) => sum + r.counts.total + r.counts.dropped, 0)).toBe(TASKS.length);
  });

  it('gives a subtask the milestone of its nearest parent that has one, and survives a loop', () => {
    const byId = new Map(TASKS.map((t) => [t.id, t]));
    expect(milestoneOf(byId.get('t3a') as Task, byId)).toBe('m2');
    expect(milestoneOf(byId.get('t7') as Task, byId)).toBeNull();
    const a = task({ id: 'a', owner: 'ceo', status: 'queued', parent: 'b' });
    const b = task({ id: 'b', owner: 'ceo', status: 'queued', parent: 'a' });
    expect(milestoneOf(a, new Map([['a', a], ['b', b]]))).toBeNull();
  });

  it('lists blocked tasks with the first sentence of why, longest blocked first', () => {
    const reports: Report[] = [
      { id: 'r1', person: 'frontend-engineer', to: 'ceo', taskId: 't3a', outcome: 'blocked', text: 'Needs a merchant id. Asked the CEO.', at: at(11, 30) },
      { id: 'r2', person: 'frontend-engineer', to: 'ceo', taskId: 't3a', outcome: 'blocked', text: 'Waiting for the TWINT sandbox keys. The CEO asked you.', at: at(12) },
      { id: 'r3', person: 'frontend-engineer', to: 'ceo', taskId: 't3a', outcome: 'progress', text: 'Started on the form.', at: at(12, 5) },
    ];
    const tasks = [...TASKS, task({ id: 't9', owner: 'ui-designer', status: 'blocked', outcome: 'No brand colours yet', updatedAt: at(9) })];
    expect(progressBoard(company({ tasks, reports }), NOW).blocked).toEqual([
      { id: 't9', title: 'Task t9', owner: 'ui-designer', why: 'No brand colours yet', since: at(9) },
      { id: 't3a', title: 'Pay with TWINT at pickup', owner: 'frontend-engineer', why: 'Waiting for the TWINT sandbox keys.', since: at(12) },
    ]);
  });

  it('counts what waits for you the way the inbox does: open, not answered or withdrawn', () => {
    const questions = [
      question({ id: 'q1', from: 'ui-designer' }),
      question({ id: 'q2', from: 'ceo', answer: { option: 0, text: '', at: at(12), appliesAt: at(12) + 5_000 } }),
      question({ id: 'q3', from: 'frontend-engineer', withdrawn: { reason: 'Kai was stopped.', at: at(12) } }),
    ];
    const approvals = [approval({ id: 'a1', person: 'frontend-engineer' }), approval({ id: 'a2', person: 'frontend-engineer', withdrawn: { reason: 'Timed out.', at: at(12, 10) } })];
    const view2 = company({ questions, approvals, inbox: 2 });
    expect(waitingForYou(view2)).toBe(2);
    expect(progressBoard(view2, NOW).waitingForYou).toBe(view2.inbox);
  });

  it('draws tasks done over time as a running count that ends where the counts do', () => {
    const board = progressBoard(view, NOW);
    expect(board.done.points.length).toBeLessThanOrEqual(SERIES_POINTS);
    expect(board.done.step).toBe(HOUR_MS);
    expect(board.done.points[0]?.at).toBe(at(8));
    expect(board.done.points.at(-1)).toEqual({ at: at(14), value: board.counts.done });
    // Hours from 8:00: the SEO specialist's task at 9:30, Kai's at 11:00, Mina's at 12:30.
    expect(board.done.points.map((p) => p.value)).toEqual([0, 1, 1, 2, 3, 3, 3]);
  });

  it('is empty before there is a goal or a task', () => {
    expect(progressBoard(company(), NOW)).toEqual({
      goal: null,
      counts: { queued: 0, working: 0, blocked: 0, review: 0, done: 0, dropped: 0, total: 0 },
      waitingForYou: 0,
      milestones: [],
      rooms: [],
      blocked: [],
      done: { step: HOUR_MS, points: [] },
    });
  });
});

describe('the Spend board', () => {
  const costs = { ceo: 4, 'head-of-design': 1.5, 'frontend-engineer': 6, 'ui-designer': 2, 'german-copywriter': 0.5 };
  const people = PEOPLE.map((p) => ({ ...p, cost: costs[p.id as keyof typeof costs] }));
  const byPerson = [
    { person: 'ceo', today: 1, week: 3, all: 4 },
    { person: 'head-of-design', today: 0.5, week: 1.5, all: 1.5 },
    { person: 'frontend-engineer', today: 3, week: 5, all: 6 },
    { person: 'ui-designer', today: 0, week: 2, all: 2 },
    { person: 'german-copywriter', today: 0.25, week: 0.5, all: 0.5 },
    // Fired before today: what they cost still counts.
    { person: 'seo-specialist', today: 0, week: 0.75, all: 1.25 },
    { person: THE_OFFICE, today: 0.02, week: 0.05, all: 0.08 },
  ];
  const hourly = [
    { hour: at(9, 0, 3), cost: 1 },
    { hour: at(16, 0, 4), cost: 2 },
    { hour: at(9), cost: 1.5 },
    { hour: at(13), cost: 2 },
    { hour: at(14), cost: 1.27 },
  ];
  const samples = [
    { person: 'frontend-engineer', at: at(9, 0, 1), cost: 0.5 },
    { person: 'frontend-engineer', at: at(9, 10), cost: 1 },
    { person: 'frontend-engineer', at: at(13, 40), cost: 1 },
    { person: 'frontend-engineer', at: at(14, 20), cost: 1 },
    { person: 'ceo', at: at(13, 20), cost: 0.75 },
    { person: 'german-copywriter', at: at(14, 25), cost: 0.25 },
  ];
  const view = company({ people, spend: { samples, hourly, byPerson } });

  it("adds up, over all of it, to what the people's costs add up to, with people who left and the office", () => {
    const all = spendBoard(view, NOW).all;
    const peopleTotal = people.reduce((sum, p) => sum + p.cost, 0);
    expect(all.spent).toBeCloseTo(peopleTotal + 1.25 + 0.08, 10);
    for (const p of people) expect(all.people.find((l) => l.person === p.id)?.cost).toBe(p.cost);
    expect(all.people.map((l) => l.person)).toEqual(['frontend-engineer', 'ceo', 'ui-designer', 'head-of-design', 'seo-specialist', 'german-copywriter', THE_OFFICE]);
    expect(all.people.find((l) => l.person === 'seo-specialist')).toMatchObject({ name: 'SEO specialist', room: null });
    expect(all.people.at(-1)).toMatchObject({ name: 'The office', room: null });
    expect(all.people.reduce((sum, l) => sum + l.share, 0)).toBeCloseTo(1, 10);
  });

  it("takes today and the last seven days from each person's totals for them", () => {
    const board = spendBoard(view, NOW);
    expect(board.today.spent).toBeCloseTo(1 + 0.5 + 3 + 0.25 + 0.02, 10);
    expect(board.today.people.map((l) => l.person)).toEqual(['frontend-engineer', 'ceo', 'head-of-design', 'german-copywriter', THE_OFFICE]);
    expect(board.week.spent).toBeCloseTo(3 + 1.5 + 5 + 2 + 0.5 + 0.75 + 0.05, 10);
    expect(board.today.from).toBe(startOfDay(NOW));
    expect(board.week.from).toBe(NOW - 7 * DAY_MS);
  });

  it("adds up each room from its people, leaving the office and people who left to the total", () => {
    const all = spendBoard(view, NOW).all;
    expect(all.rooms.map((r) => [r.room, r.cost])).toEqual([
      ['leadership', 4],
      ['design', 3.5],
      ['engineering', 6],
      ['content', 0.5],
    ]);
  });

  it("burns what the last hour's turns cost, in dollars an hour", () => {
    // Kai's turns at 13:40 and 14:20 and Lena's at 14:25; the CEO's at 13:20 ended more than an hour before 14:30.
    expect(spendBoard(view, NOW).burn.dollarsPerHour).toBeCloseTo(1 + 1 + 0.25, 10);
    expect(spendBoard(view, at(16, 0)).burn.dollarsPerHour).toBe(0);
  });

  it('draws today by the hour from midnight, seven days in a few hours each, and all of it in at most 48 buckets', () => {
    const board = spendBoard(view, NOW);
    expect(board.today.series.step).toBe(HOUR_MS);
    expect(board.today.series.points).toHaveLength(15);
    expect(board.today.series.points[0]?.at).toBe(startOfDay(NOW));
    expect(board.today.series.points.filter((p) => p.value > 0)).toEqual([
      { at: at(9), value: 1.5 },
      { at: at(13), value: 2 },
      { at: at(14), value: 1.27 },
    ]);
    expect(board.week.series.step).toBe(4 * HOUR_MS);
    expect(board.week.series.points.length).toBeLessThanOrEqual(SERIES_POINTS);
    expect(board.week.series.points.reduce((sum, p) => sum + p.value, 0)).toBeCloseTo(1 + 2 + 1.5 + 2 + 1.27, 10);
    // All of it: the hours the view keeps, and the one turn it holds from before them.
    expect(board.all.from).toBe(at(9, 0, 1));
    expect(board.all.series.points.length).toBeLessThanOrEqual(SERIES_POINTS);
    expect(board.all.series.points.reduce((sum, p) => sum + p.value, 0)).toBeCloseTo(0.5 + 1 + 2 + 1.5 + 2 + 1.27, 10);
  });

  it('says whether the figures are estimates on a plan or what an API key was billed', () => {
    expect(spendBoard(view, NOW)).toMatchObject({ billing: 'plan', estimate: true, label: 'API-equivalent' });
    const billed = company({ ...view, settings: { ...view.settings, billing: 'api-key' } });
    expect(spendBoard(billed, NOW)).toMatchObject({ billing: 'api-key', estimate: false, label: 'Spend' });
  });

  it('points at someone who takes a big share and could work on a cheaper model', () => {
    const board = spendBoard(view, NOW);
    // The CEO takes 26% too, but in one turn.
    expect(board.all.advice).toEqual([{ person: 'frontend-engineer', message: 'Takes 39% of the spend. Try them on a cheaper model and keep it there if the work holds up.' }]);
  });

  it("doesn't point at someone already on Haiku, or at someone who spends alone", () => {
    const turns = (who: string) => [1, 2, 3].map((n) => ({ person: who, at: at(10, n), cost: 1 }));
    const spending = (costs: Record<string, number>, who: string[]) =>
      company({ people: PEOPLE.map((p) => ({ ...p, cost: costs[p.id] ?? 0 })), spend: { samples: who.flatMap(turns), hourly: [], byPerson: [] } });
    // Lena takes 80% on Haiku; Kai's 20% is under the bar.
    expect(spendBoard(spending({ 'german-copywriter': 8, 'frontend-engineer': 2 }, ['german-copywriter', 'frontend-engineer']), NOW).all.advice).toEqual([]);
    expect(spendBoard(spending({ 'frontend-engineer': 5 }, ['frontend-engineer']), NOW).all.advice).toEqual([]);
  });

  it('has nothing to show before anyone has spent anything', () => {
    const board = spendBoard(company(), NOW);
    expect(board.all).toMatchObject({ from: NOW, spent: 0, people: [], rooms: [], advice: [] });
    expect(board.all.series.points).toEqual([{ at: startOfDay(NOW) + 14 * HOUR_MS, value: 0 }]);
    expect(board.burn.dollarsPerHour).toBe(0);
  });
});

describe('the Timeline', () => {
  const statuses: StatusLine[] = [
    { person: 'frontend-engineer', text: 'Wiring the streak card to the store', taskId: 't3', at: at(10) },
    { person: 'ui-designer', text: 'Darker palette is in. Token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF', taskId: 't4', at: at(10, 30) },
    { person: 'seo-specialist', text: 'Checked the **meta tags**.', taskId: null, at: at(9) },
  ];
  const reports: Report[] = [
    { id: 'r1', person: 'frontend-engineer', to: 'ceo', taskId: 't1', outcome: 'done', text: 'Card renders in both languages.', at: at(11) },
    { id: 'r2', person: 'ceo', to: STAKEHOLDER, taskId: null, outcome: 'progress', text: 'Menus are live; pickup next.', at: at(13, 5) },
    { id: 'r3', person: 'frontend-engineer', to: 'ceo', taskId: 't3a', outcome: 'blocked', text: 'Waiting for the TWINT keys.', at: at(12) },
  ];
  const questions: Question[] = [
    question({ id: 'q1', from: 'ui-designer', text: 'Warm or cool greys?', options: ['Warm', 'Cool'], answer: { option: 1, text: '', at: at(11, 5), appliesAt: at(11, 5) + 5_000 } }),
    question({ id: 'q2', from: 'frontend-engineer', withdrawn: { reason: 'Kai was stopped', at: at(12, 40) } }),
    question({ id: 'q3', from: 'ceo', text: 'Stripe or TWINT first?', options: ['Stripe', 'TWINT'], answer: { option: 0, text: 'cards can wait', at: at(13, 10), appliesAt: at(13, 10) + 5_000 } }),
  ];
  const approvals: Approval[] = [
    approval({ id: 'a1', person: 'frontend-engineer', answer: { decision: 'allow', always: false, at: at(12, 2), appliesAt: at(12, 2) + 5_000, note: null } }),
    approval({ id: 'a2', person: 'frontend-engineer', askedAt: at(12, 20), answer: { decision: 'allow', always: true, at: at(12, 21), appliesAt: at(12, 21) + 5_000, note: null } }),
    approval({
      id: 'a3',
      person: 'ceo',
      summary: 'Deploy the site to Cloudflare Pages.',
      detail: 'npx wrangler pages deploy dist --project-name cafe-lumen',
      kind: 'deploy',
      askedAt: at(13, 30),
      answer: { decision: 'deny', always: false, at: at(13, 31), appliesAt: at(13, 31) + 5_000, note: 'not before the review' },
    }),
    approval({ id: 'a4', person: 'ui-designer', summary: 'GitHub: open a pull request', askedAt: at(14), withdrawn: { reason: 'Mina was stopped.', at: at(14, 5) } }),
  ];
  const messages: Message[] = [
    { id: 'm1', from: STAKEHOLDER, to: 'ceo', text: 'Make the palette darker', origin: null, relayOf: null, note: null, at: at(10, 5), deliveredAt: at(10, 6), interrupt: false },
    { id: 'm2', from: 'ceo', to: 'head-of-design', text: 'Make the palette darker', origin: STAKEHOLDER, relayOf: 'm1', note: null, at: at(10, 7), deliveredAt: at(10, 8), interrupt: false },
    { id: 'm3', from: 'head-of-design', to: 'ui-designer', text: 'Darker palette, please', origin: STAKEHOLDER, relayOf: 'm2', note: null, at: at(10, 9), deliveredAt: null, interrupt: false },
    { id: 'm4', from: STAKEHOLDER, to: 'frontend-engineer', text: 'Stop here and wait for my next message.', origin: null, relayOf: null, note: null, at: at(12, 39), deliveredAt: at(12, 39), interrupt: true },
    { id: 'm5', from: 'ceo', to: STAKEHOLDER, text: 'On it: the head of design has it.', origin: null, relayOf: null, note: null, at: at(10, 10), deliveredAt: at(10, 10), interrupt: false },
    { id: 'm6', from: 'frontend-engineer', to: 'ui-designer', text: 'Which grey for the card?', origin: null, relayOf: null, note: null, at: at(10, 20), deliveredAt: at(10, 21), interrupt: false },
  ];
  const log: LogEntry[] = [
    { at: at(8), kind: 'goal', by: 'ceo', text: 'The CEO set the goal: Pickup orders work in German and English.' },
    { at: at(9, 45), kind: 'hire', by: 'ceo', text: 'The CEO hired Lena, German copywriter.' },
    { at: at(13) + 1_000, kind: 'milestone', by: THE_OFFICE, text: 'Milestone done: Menu pages live.' },
    { at: at(12, 39) + 200, kind: 'stop', by: STAKEHOLDER, text: 'You stopped Kai.' },
    { at: at(14, 10), kind: 'dashboard-refused', by: THE_OFFICE, text: 'The office turned down the CEO\'s dashboard "Launch": widget 3 is a line with no points.' },
  ];
  const view = company({ goal: GOAL, statuses, reports, questions, approvals, messages, log });
  const lines = timeline(view);
  const text = (id: string) => lines.find((l) => l.id === id)?.text;

  it('tells status lines, reports, questions, approvals, your messages, milestones and the log, newest first', () => {
    const kinds = lines.reduce<Record<string, number>>((n, l) => ({ ...n, [l.kind]: (n[l.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ status: 3, report: 3, question: 3, answer: 2, approval: 4, decision: 3, withdrawn: 2, message: 5, milestone: 1, goal: 1, hire: 1, 'dashboard-refused': 1 });
    expect(lines.map((l) => l.at)).toEqual([...lines.map((l) => l.at)].sort((a, b) => b - a));
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });

  it('says what was decided in outcome words', () => {
    expect(text('decision:a1')).toBe('You allowed Kai to push the work branch to GitHub, once.');
    expect(text('decision:a2')).toBe('You allowed Kai to push the work branch to GitHub, and always from now on.');
    expect(text('decision:a3')).toBe("You didn't allow the CEO to deploy the site to Cloudflare Pages: not before the review.");
    expect(text('approval:a3')).toBe('The CEO asked for your OK to deploy the site to Cloudflare Pages.');
    expect(text('withdrawn:a4')).toBe("Mina's request to GitHub: open a pull request was withdrawn: Mina was stopped.");
    expect(text('answer:q1')).toBe('You answered Mina: Cool.');
    expect(text('answer:q3')).toBe('You answered the CEO: Stripe (cards can wait).');
    expect(text('withdrawn:q2')).toBe("Kai's question was withdrawn: Kai was stopped.");
    expect(text('question:q1')).toBe('Mina asked you: Warm or cool greys?');
  });

  it('tells reports, messages from and to you, and your messages passed on', () => {
    expect(text('report:r1')).toBe('Kai finished and reported to the CEO: Card renders in both languages.');
    expect(text('report:r2')).toBe('The CEO reported progress to you: Menus are live; pickup next.');
    expect(text('report:r3')).toBe('Kai was blocked and told the CEO: Waiting for the TWINT keys.');
    expect(text('message:m1')).toBe('You told the CEO: Make the palette darker');
    expect(text('message:m2')).toBe('The CEO passed your message on to Ada.');
    expect(text('message:m3')).toBe('Ada passed your message on to Mina.');
    expect(text('message:m4')).toBe('You stopped Kai: Stop here and wait for my next message.');
    expect(text('message:m5')).toBe('The CEO told you: On it: the head of design has it.');
    expect(text('message:m6')).toBeUndefined();
    expect(lines.find((l) => l.id === 'message:m3')?.people).toEqual(['head-of-design', 'ui-designer', STAKEHOLDER]);
  });

  it("tells a milestone done once, and a Stop once, when the log tells them too", () => {
    expect(lines.filter((l) => l.kind === 'milestone').map((l) => l.text)).toEqual(['Milestone done: Menu pages live.']);
    expect(lines.filter((l) => l.kind === 'stop')).toEqual([]);
    expect(text('log:hire:' + String(at(9, 45)))).toBe('The CEO hired Lena, German copywriter.');
  });

  it('never shows the command an approval was for, and masks what people wrote', () => {
    const all = lines.map((l) => l.text).join('\n');
    for (const a of approvals) expect(all).not.toContain(a.detail);
    expect(all).not.toContain('sk-ant-api03');
    expect(text(`status:ui-designer:${at(10, 30)}`)).toMatch(/^Mina: Darker palette is in\. Token: \S*redacted\S*\.?$/);
    expect(text(`status:seo-specialist:${at(9)}`)).toBe('The SEO specialist: Checked the meta tags.');
  });

  it('is empty when nothing has happened yet', () => {
    expect(timeline(company())).toEqual([]);
  });
});
