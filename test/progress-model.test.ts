// The office's progress view, its pure parts (web/src/company/progress/progressModel.ts, checklistModel.ts): the goal in
// the stakeholder's words, what needs them and where it opens, milestones with their tasks as status words, what happened
// since they last looked, and the checklist's rows and counts. No ids, paths or tool names in what a person reads first.
import { describe, expect, it } from 'vitest';
import type { CompanyView, SinceDigest, Task } from '../src/core/company.ts';
import { checklistView } from '../src/core/checklist.ts';
import { DEFAULT_PLAN_APPROVAL, type ChecklistVerdict, type PlanVersion } from '../src/core/steering.ts';
import { demoCompanyView, demoFinishedView } from '../src/core/demo-company.ts';
import { checkRows, countsLine } from '../web/src/company/progress/checklistModel.ts';
import { fixingView, goalWords, milestoneRows, needsRows, progressView, seenView, sinceView, stageOfView, stageShown, summaryInputOf, taskWord } from '../web/src/company/progress/progressModel.ts';
import { summaryOf } from '../src/core/overview.ts';
import { companyState, stateOfCompany } from '../web/src/company/model.ts';
import { stagePill } from '../web/src/company/lobby/lobbyModel.ts';
import { company, min, NOW, person, question, task } from './panels-work-kit.ts';
import { milestone, plan, planView, version } from './steering-plan-kit.ts';

const steering = (versions: PlanVersion[], approved: number | null): CompanyView['steering'] => ({
  plan: planView(versions, approved === null ? {} : { approved: { version: approved, through: null, at: NOW - min(30), by: '@stakeholder', cites: [] } }),
  acks: [],
  decisions: [],
  settings: { planApproval: DEFAULT_PLAN_APPROVAL, leash: { people: {}, rooms: {} }, effort: {} },
  people: {},
});

describe('the goal', () => {
  it('leads with the first sentence of your words, the rest after it, plain', () => {
    expect(goalWords('Build a **café** site. Guests order online.\n\nAnd pay with TWINT.')).toEqual({ lead: 'Build a café site.', rest: 'Guests order online. And pay with TWINT.' });
    expect(goalWords('One line with no stop')).toEqual({ lead: 'One line with no stop', rest: '' });
    expect(goalWords('   ')).toBeNull();
  });
});

describe('a task in a word', () => {
  it('says what a person would: done, working, checking, waiting, stuck, paused, dropped or not started', () => {
    const paused = { at: NOW, by: '@stakeholder' };
    expect(taskWord(null)).toBe('Not started');
    expect(taskWord({ status: 'done', paused: null })).toBe('Done');
    expect(taskWord({ status: 'working', paused: null })).toBe('Working');
    expect(taskWord({ status: 'working', paused: null }, 'verification')).toBe('Checking');
    expect(taskWord({ status: 'review', paused: null })).toBe('Checking');
    expect(taskWord({ status: 'queued', paused: null })).toBe('Waiting');
    expect(taskWord({ status: 'queued', paused })).toBe('Paused');
    expect(taskWord({ status: 'blocked', paused: null })).toBe('Stuck');
    expect(taskWord({ status: 'dropped', paused: null })).toBe('Dropped');
  });
});

describe('milestones and their tasks', () => {
  const p = plan();
  const goal = { text: p.goal, setAt: NOW - min(90), milestones: p.milestones.map((m) => ({ ...m, doneAt: m.id === 'ms-1' ? NOW - min(10) : null })) };
  const c = company({
    goal,
    steering: steering([version(1, p)], 1),
    tasks: [
      task('t-1', 'frontend-engineer', 'Menu data', { planTask: 'p-1', status: 'done' }),
      task('t-2', 'ui-designer', 'Menu photos', { planTask: 'p-2', status: 'done' }),
      task('t-3', 'frontend-engineer', 'Slot picker', { planTask: 'p-3', status: 'working', milestone: 'ms-2' }),
      // A task the team split off, which the plan doesn't list.
      task('t-9', 'frontend-engineer', 'Slot picker styles', { parent: 't-3', status: 'queued', milestone: 'ms-2' }),
    ],
  });

  it("tells the approved plan's milestones in order: done, the one work is on, and later; tasks with owners, no ids", () => {
    const rows = milestoneRows(c);
    expect(rows.map((m) => [m.title, m.state, m.line, m.extra])).toEqual([
      ['Menu pages live', 'done', 'Done', 0],
      ['Pickup orders work', 'now', '0 of 3 tasks done', 1],
    ]);
    expect(rows[1]?.tasks.map((t) => [t.title, t.owner, t.word, t.task])).toEqual([
      ['Slot picker', 'Kai', 'Working', 't-3'],
      ['Cart', 'Kai', 'Not started', null],
      ['Order tests', 'QA engineer', 'Not started', null],
    ]);
  });

  it('marks a milestone after the current one as later until its work starts, and says so when it has no tasks', () => {
    const three = plan({ milestones: [milestone('ms-1', 'Menu pages live'), milestone('ms-2', 'Pickup orders work'), milestone('ms-3', 'Launch')] });
    const rows = milestoneRows(company({ steering: steering([version(1, three)], null) }));
    expect(rows.map((m) => [m.state, m.line])).toEqual([
      ['now', 'Not started'],
      ['later', 'Not started'],
      ['later', 'No tasks yet'],
    ]);
  });

  it("falls back on the goal's milestones and the board when there is no plan, and on nothing before either", () => {
    const goal = { text: 'Ship it.', setAt: NOW, milestones: [{ id: 'g-1', title: 'First', doneWhen: 'Done.', doneAt: null }] };
    const rows = milestoneRows(company({ goal, tasks: [task('t-1', 'frontend-engineer', 'A part', { milestone: 'g-1', status: 'review' })] }));
    expect(rows.map((m) => [m.title, m.tasks.map((t) => t.word)])).toEqual([['First', ['Checking']]]);
    expect(milestoneRows(company())).toEqual([]);
    expect(progressView(company({ phase: 'founding' }), NOW).noPlan).toMatch(/drafting/);
  });

  it('shows how far along it is and the money against the budget', () => {
    const view = progressView(c, NOW);
    expect(view.progress).toEqual({ line: '1 of 2 milestones, 2 of 5 tasks', share: 0.4 });
    expect(view.spend).toBe('Nothing spent yet');
  });
});

describe('what needs you', () => {
  it('lists open questions oldest first with who asked and when, and where Answer opens', () => {
    const c = company({
      questions: [question('q-2', 'ui-designer', 'Which green?', ['Sage', 'Moss'], { askedAt: NOW - min(5) }), question('q-1', 'ceo', 'Launch on Monday?', ['Yes', 'No'], { askedAt: NOW - min(40) })],
    });
    const rows = needsRows(c, NOW);
    expect(rows.map((r) => [r.kind, r.text, r.meta, r.open?.label])).toEqual([
      ['A question', 'Launch on Monday?', 'Noor, 40 min ago', 'Answer'],
      ['A question', 'Which green?', 'Mina, 5 min ago', 'Answer'],
    ]);
    expect(rows[0]?.open?.route).toEqual({ main: { kind: 'progress' }, panel: { kind: 'inbox', item: 'q-1' } });
  });

  it('sends a plan that waits to the plan, and says when work has stopped, with nowhere else to go', () => {
    const waiting = company({ steering: steering([version(1, plan())], null) });
    expect(needsRows(waiting, NOW).map((r) => [r.kind, r.open?.label, r.open?.route.main.kind])).toEqual([['The plan', 'Open the plan', 'plan']]);
    const open = (id: string) => ({ id, title: `Task ${id}`, owner: 'noor', status: 'working' as const, lastStatus: null });
    const stalled = company({ stalled: { since: NOW - min(20), tasks: [open('t-1'), open('t-2')], text: 'Stalled: t-1 waits on Noor.' } });
    expect(needsRows(stalled, NOW).map((r) => [r.kind, r.text, r.open])).toEqual([['Stopped', 'Work has stopped with 2 tasks still open.', null]]);
  });
});

describe('since you last looked', () => {
  const digest = (over: Partial<SinceDigest> = {}): SinceDigest => ({
    since: NOW - min(180),
    finished: [{ title: 'Menu data', by: 'Kai', at: NOW - min(40), files: ['src/menu/data.ts'] }],
    finishedCount: 4,
    decisions: [{ what: 'Checkout is two steps.', by: 'Ines', at: NOW - min(30) }],
    decisionCount: 2,
    spent: 1.8,
    waiting: 1,
    ...over,
  });

  it('says nothing for an office that keeps no visits, and a first look as such', () => {
    expect(sinceView({}, NOW)).toEqual({ kind: 'unknown' });
    expect(sinceView({ looked: { last: null, previous: null }, since: null }, NOW)).toEqual({ kind: 'first' });
  });

  it('counts in words what finished, what was decided and what it cost, with the files a press away', () => {
    const view = sinceView({ looked: { last: NOW - min(180), previous: null }, since: digest() }, NOW);
    expect(view).toMatchObject({ kind: 'since', ago: '3 h ago', summary: 'Four tasks finished, two decisions made and $1.80 spent.', spent: '$1.80', waiting: 1, finishedCount: 4 });
    if (view.kind === 'since') expect(view.finished[0]).toMatchObject({ title: 'Menu data', by: 'Kai', ago: '40 min ago', files: ['src/menu/data.ts'] });
  });

  it('says plainly when nothing has changed', () => {
    const view = sinceView({ since: digest({ finished: [], finishedCount: 0, decisions: [], decisionCount: 0, spent: 0, waiting: 0 }) }, NOW);
    expect(view).toMatchObject({ kind: 'since', summary: 'Nothing has changed.', spent: null });
  });
});

describe('the checklist rows', () => {
  const p = plan({
    checklist: [
      { id: 'k-1', text: 'Guests read the menu.', quote: 'read the **menu**', covers: ['p-1'] },
      { id: 'k-2', text: 'Guests order for pickup.', quote: null, covers: ['p-3', 'p-4'] },
    ],
  });
  const tasks = [task('t-1', 'frontend-engineer', 'Menu data', { planTask: 'p-1', status: 'done' }), task('t-3', 'frontend-engineer', 'Slot picker', { planTask: 'p-3', status: 'working' })];
  const verdict = (item: string, v: ChecklistVerdict['verdict'], page: string | null, passed = true): ChecklistVerdict => ({
    item, version: 1, verdict: v, by: 'qa-engineer', task: 't-9', at: NOW - min(20),
    evidence: { note: 'Seen on a phone.', check: { ran: 'npm test', passed }, files: ['src/menu/page.tsx'], page },
  });
  const nameOf = (id: string) => (id === 'qa-engineer' ? 'Nils' : 'Someone');

  it('says how many there are to check before the review, then how it went', () => {
    const before = checklistView(version(1, p), [], tasks);
    if (!before) throw new Error('expected a checklist');
    expect(countsLine(before)).toBe('Two things to check. The final review marks each one met, partly met or not met.');
    const after = checklistView(version(1, p), [verdict('k-1', 'met', '/menu'), verdict('k-2', 'partly', null, false)], tasks);
    if (!after) throw new Error('expected a checklist');
    expect(countsLine(after)).toBe('1 of 2 met, 1 partly met.');
  });

  it('shows each item with your words plain, its tasks in a word, and the evidence with a link on the preview while it runs', () => {
    const view = checklistView(version(1, p), [verdict('k-1', 'met', '/menu'), verdict('k-2', 'partly', null, false)], tasks);
    if (!view) throw new Error('expected a checklist');
    const rows = checkRows(view, { now: NOW, preview: 'http://127.0.0.1:5199/', nameOf });
    expect(rows[0]).toMatchObject({ text: 'Guests read the menu.', quote: 'read the menu', state: 'met', word: 'Met', tasks: [{ title: 'Menu data', word: 'Done', task: 't-1' }] });
    expect(rows[0]?.evidence).toEqual({ note: 'Seen on a phone.', check: 'Ran npm test: it passed.', passed: true, files: ['src/menu/page.tsx'], page: { href: 'http://127.0.0.1:5199/menu', path: '/menu' }, by: 'Nils, 20 min ago' });
    expect(rows[1]).toMatchObject({ word: 'Partly met', tasks: [{ title: 'Slot picker', word: 'Working' }, { title: 'Cart', word: 'Not started', task: null }] });
    expect(rows[1]?.evidence?.check).toBe('Ran npm test: it failed.');
    // No preview running, or a page that isn't a path on it: no link.
    expect(checkRows(view, { now: NOW, preview: null, nameOf })[0]?.evidence?.page).toBeNull();
    const odd = checklistView(version(1, p), [verdict('k-1', 'met', 'javascript:alert(1)')], tasks);
    if (!odd) throw new Error('expected a checklist');
    expect(checkRows(odd, { now: NOW, preview: 'http://127.0.0.1:5199/', nameOf })[0]?.evidence?.page).toBeNull();
  });
});

describe("the demo's progress", () => {
  it("tells the café's progress and the finished company's from the same model the office uses", () => {
    const cafe = progressView(demoCompanyView(NOW), NOW);
    expect(cafe.stage.word).toBe('Waiting for your OK');
    // The launch milestone has work started already, so it counts as now beside pickup orders.
    expect(cafe.milestones.map((m) => m.state)).toEqual(['done', 'now', 'now']);
    expect(cafe.since.kind).toBe('since');
    const swim = progressView(demoFinishedView(NOW), NOW);
    expect(swim).toMatchObject({ stage: { word: 'Done' }, progress: { line: '2 of 2 milestones, 6 of 6 tasks', share: 1 }, needs: [] });
    // No ids or paths where a person reads first.
    for (const m of [...cafe.milestones, ...swim.milestones]) for (const t of m.tasks) expect(`${t.title} ${t.owner} ${t.word}`).not.toMatch(/\b[tp]-\d+\b|[\\/]/);
  });
});

describe('one stage everywhere', () => {
  it("gives the bar's pill, the lobby's card and progress's heading the same stage, with the office's sentence as the bar's detail", () => {
    const p = plan();
    // Two at work while version 1 of the plan waits for your OK: the office's own reading said "Working".
    const c = company({ steering: steering([version(1, p)], null), desks: { working: 2, waiting: 0, max: 8 } });
    const office = companyState(stateOfCompany(c, NOW), NOW);
    expect(office.pill).toBe('Working');
    const pill = stagePill(stageOfView(c, NOW), office.sentence);
    expect(stageOfView(c, NOW)).toBe('waiting');
    expect(pill).toEqual({ pill: 'Waiting for your OK', tone: 'needs', sentence: office.sentence });
    expect(progressView(c, NOW).stage.word).toBe(pill.pill);
    expect(summaryOf(summaryInputOf(c), NOW).stage).toBe(stageOfView(c, NOW));
  });

  it('says Done for a finished company where the office alone said Idle, and Working for one between turns', () => {
    const done = demoFinishedView(NOW);
    expect(stagePill(stageOfView(done, NOW), '').pill).toBe('Done');
    const idle = company({ desks: { working: 0, waiting: 0, max: 8 } });
    expect(stagePill(stageOfView(idle, NOW), '').pill).toBe('Working');
  });
});

describe('fix rounds and what the office saw (v0.3)', () => {
  const p = plan();
  const look = (over: Partial<NonNullable<Task['look']>> = {}): NonNullable<Task['look']> => ({
    state: 'seen', runs: 1, at: NOW - min(12), note: 'Opened.', shots: [{ file: '.worklings-shared/looks/t-5-1/home-phone.png', page: '/', width: 375, overflow: false }], errors: [],
    checks: [{ item: 'k-1', kind: 'walk', ok: true, step: null, why: null, shot: null }, { item: 'k-2', kind: 'walk', ok: false, step: 'click "Vote"', why: 'no button', shot: null }],
    ...over,
  });
  const fixing = company({
    steering: steering([version(1, p)], 1),
    tasks: [
      task('t-3', 'frontend-engineer', 'Slot picker', { planTask: 'p-3', status: 'done', milestone: 'ms-2' }),
      task('t-5', 'qa-engineer', 'Final check', { status: 'queued', look: look() }),
      task('t-6', 'frontend-engineer', 'Fix: Slot picker', { status: 'working', followUp: { kind: 'fix', verification: 't-5', items: ['p-3 Slots pick a time: the walk failed'], round: 1, source: 'acceptance' } }),
    ],
  });

  it('says Fixing on the bar and in progress while a fix round runs, with who fixes what, and the built task reads Fixing', () => {
    expect(fixingView(fixing)).toEqual({ line: "Kai fixes one thing the office's checks found, round 1 of 2.", round: 1 });
    expect(stageShown(fixing, NOW)).toEqual({ word: 'Fixing', tone: 'working' });
    expect(progressView(fixing, NOW).stage.word).toBe('Fixing');
    const slot = milestoneRows(fixing)[1]?.tasks.find((t) => t.title === 'Slot picker');
    expect(slot?.word).toBe('Fixing');
    // Once it is fixed, the stage is the plain one again.
    const after = company({ ...fixing, tasks: fixing.tasks.map((t) => (t.id === 't-6' ? { ...t, status: 'done' as const } : t)) });
    expect(fixingView(after)).toBeNull();
    expect(stageShown(after, NOW).word).not.toBe('Fixing');
  });

  it("tells what the office saw when it opened the app, in plain words with no paths", () => {
    expect(seenView(fixing, NOW)).toEqual({ line: 'The office opened the app on a phone and a desktop screen 12 min ago.', detail: 'One of two checks passed. No errors showed in the browser.', tone: 'needs' });
    const clean = company({ tasks: [task('t-5', 'qa-engineer', 'Final check', { look: look({ checks: [], errors: [] }) })] });
    expect(seenView(clean, NOW)?.tone).toBe('done');
    const wide = company({ tasks: [task('t-5', 'qa-engineer', 'Final check', { look: look({ checks: [], errors: ['x', 'y'], shots: [{ file: 'a.png', page: '/', width: 375, overflow: true }] }) })] });
    expect(seenView(wide, NOW)?.detail).toBe('Two errors showed in the browser. On a phone the page scrolls sideways.');
    const skipped = company({ tasks: [task('t-5', 'qa-engineer', 'Final check', { look: look({ state: 'skipped' }) })] });
    expect(seenView(skipped, NOW)?.line).toContain("didn't open it in a browser");
    expect(seenView(company(), NOW)).toBeNull();
  });
});

// 0.4.0: a one-session job (v0.7's plain company) has no CEO, plan, milestones or checklist. Progress spoke of the CEO's
// plan to it (0.3.1); now it shows Claude Code's own to-do list, and a team's copy names whoever leads it.
describe('a one-session job', () => {
  const plain = (extra: Partial<CompanyView> = {}) =>
    company({ shape: 'plain', phase: 'running', people: [person('builder', 'Claude Code', 'Claude Code', 'desk', { level: 'ceo' })], todos: [], helpers: [], ...extra });
  /** Every sentence the view shows before any work, as one string. */
  const words = (c: CompanyView) => {
    const v = progressView(c, NOW);
    return [v.noPlan, v.noChecklist ?? '', v.progress.line, v.stage.word].join(' ');
  };

  it("never mentions a CEO, a plan or a checklist, and says where Claude Code's to-do list shows", () => {
    for (const phase of ['founding', 'proposed', 'running'] as const) {
      const text = words(plain({ phase }));
      expect(text).not.toMatch(/CEO|plan|checklist/i);
    }
    const view = progressView(plain(), NOW);
    expect(view.noChecklist).toBeNull();
    expect(view.todos).toEqual([]);
    expect(view.progress).toEqual({ line: 'No to-do list yet', share: null });
    expect(view.noPlan).toBe('No to-do list yet. When Claude Code keeps one for this job, its items show here and on the task board.');
  });

  it("shows Claude Code's own to-do list in its order, each in a word, and how far along it is", () => {
    const view = progressView(
      plain({
        todos: [
          { id: '1', text: 'Read the **README**', status: 'completed' },
          { id: '2', text: 'Add the streak counter', status: 'in_progress' },
          { id: '3', text: 'Write the tests', status: 'pending' },
        ],
      }),
      NOW,
    );
    expect(view.todos?.map((t) => [t.title, t.word, t.tone])).toEqual([
      ['Read the README', 'Done', 'done'],
      ['Add the streak counter', 'Working', 'working'],
      ['Write the tests', 'Not started', 'neutral'],
    ]);
    expect(view.progress.line).toBe('1 of 3 to-dos done');
    expect(view.progress.share).toBeCloseTo(1 / 3);
  });

  it('names whoever leads a team: the CEO in a company, the lead in the experimental team', () => {
    expect(progressView(company({ phase: 'running' }), NOW).noPlan).toBe('No plan yet. The CEO proposes one, and you approve it before work starts.');
    expect(progressView(company({ phase: 'running' }), NOW).noChecklist).toMatch(/^No checklist yet\. The CEO writes one/);
    const solo = company({ shape: 'solo', phase: 'founding', people: [person('lead', 'Lead', 'Lead', 'direction', { level: 'ceo' })] });
    expect(progressView(solo, NOW).noPlan).toBe('The lead is drafting your company. The plan comes once you start it.');
    expect(progressView(solo, NOW).todos).toBeNull();
  });
});
