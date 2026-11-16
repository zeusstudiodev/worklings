// What v3's end-to-end specs share: the hub's address and token, the org the fake CEO proposes, the scripts the fake
// Claude Code plays (test/fake-desk.mjs; each message names its scenario with "[fake:<name>]"), and helpers that put a
// company in a state through the hub's own HTTP API, as the browser would, so a spec starts where its flow starts.
// scripts/e2e-hub.mjs and playwright.config.ts import this file too, so it holds data and plain functions only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { CompanyView, LobbyView } from '../../src/core/company.ts';
import type { Snapshot } from '../../src/core/snapshot.ts';
import { origin, ports } from './addresses.ts';

export const HUB_PORT = ports().hub;
export const DEV_APP_PORT = ports().devApp;
export const HUB = origin(HUB_PORT);
/** A second hub, for the one flow that stops every company of its hub: the usage-limit rest. */
export const REST_HUB_PORT = ports().restHub;
export const REST_HUB = origin(REST_HUB_PORT);
/** v0.7: the hub whose new companies are plain jobs, as the CLI founds them. */
export const PLAIN_HUB_PORT = ports().plainHub;
export const PLAIN_HUB = origin(PLAIN_HUB_PORT);
export const TOKEN = process.env.E2E_TOKEN ?? 'e2e-token-0123456789abcdefghijklmnopqrstuv';
/** When the scripted usage limit resets: two hours on, in seconds as Claude Code's rate_limit_event gives it. */
// Kept in the environment so every Playwright worker that loads this file agrees with the script the hub was given.
export const RESETS_AT_S = Number(process.env.E2E_RESETS_AT) || Math.ceil(Date.now() / 1000) + 2 * 3600;
process.env.E2E_RESETS_AT = String(RESETS_AT_S);

const member = (id: string, name: string, title: string, level: string, room: string, reportsTo: string | null, model: string, owns: string, library: string) => ({
  id, name, title, level, room, reportsTo, model, owns, library,
});

/** A small org the CEO proposes: eight people in three rooms under two heads. */
export const PROPOSAL = {
  company: 'Plant Pal',
  goal: 'A plant care app that reminds people to water their plants and keeps a streak.',
  sizing: 'Eight people: an app with a design side and an engineering side, each with three people and a head.',
  theme: 'garden',
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'design', title: 'Design', style: 'design' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
  ],
  people: [
    member('ceo', 'Noor', 'CEO', 'ceo', 'direction', null, 'opus', 'The company, its goal and the line to the stakeholder', 'ceo'),
    member('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo', 'sonnet', 'The look and the flows of the app', 'head'),
    member('ux-designer', 'Lea', 'UX designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The watering flow and its reminders', 'ux-designer'),
    member('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The palette, type and the streak card', 'ui-designer'),
    member('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo', 'sonnet', 'The app, its data and its releases', 'head'),
    member('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'The screens and the reminders', 'frontend-engineer'),
    member('backend-engineer', 'Ivo', 'Backend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'The plant data, streaks and sync', 'backend-engineer'),
    member('qa-engineer', 'Tom', 'QA engineer', 'worker', 'engineering', 'head-of-engineering', 'haiku', 'Testing the app end to end on phones', 'qa-engineer'),
  ],
  questions: [],
};

/**
 * The CEO's scoping questions for a short prompt (the `scope` scenario): asked before it drafts, answered in the
 * proposal panel, and sent back to it in one message that the `found-scoped` rule picks up.
 */
export const SCOPING = [
  { text: 'Who is it for?', options: ['Just me', 'Friends and family', 'Anyone, through the App Store'], recommended: 2, why: 'A streak is more fun when other people keep one too.' },
  { text: 'How far should the first version go?', options: ['A quick prototype', 'A polished first release'], recommended: 1, why: 'Polished enough to keep a streak going, small enough to finish soon.' },
  { text: 'Where should it run?', options: ['As an app on phones', 'On the web', 'Both'], recommended: 0, why: 'Reminders work best as phone notifications.' },
  { text: 'What matters most?', options: ['Reminders that arrive on time', 'A streak that brings people back'], recommended: 0, why: 'A missed reminder is a dry plant.' },
];

/** The same org with a German copywriter under the head of design. */
export const COPYWRITER = member('copywriter', 'Mila', 'German copywriter', 'worker', 'design', 'head-of-design', 'sonnet', 'The German words in the app and its store listing', 'copywriter');
export const REVISED = { ...PROPOSAL, people: [...PROPOSAL.people, COPYWRITER] };

/**
 * What the CEO may propose under Balanced (v0.2): a size, everyone reporting to the CEO (heads only for more than six
 * makers who need briefing), and no QA or reviewer seat. Every spec that reads the org is written against the headed
 * roster above, so `restoreRoster` (v3-kit.ts) hands the stakeholder's own edit back to it: an edit is held to the
 * schema only, as in the product.
 */
const ceoShape = (p: typeof PROPOSAL) => ({
  ...p,
  size: 'large',
  people: p.people.map((x) => {
    const level = x.level === 'head' ? 'worker' : x.level;
    const reportsTo = x.reportsTo === null ? null : 'ceo';
    return x.id === 'qa-engineer' ? { ...x, id: 'test-engineer', title: 'Test engineer', level, reportsTo } : { ...x, level, reportsTo };
  }),
});
export const PROPOSAL_FOR_CEO = ceoShape(PROPOSAL);
export const REVISED_FOR_CEO = ceoShape(REVISED);

export const GOOD_DASHBOARD = {
  title: 'Launch checklist',
  widgets: [
    { kind: 'stat', title: 'Screens designed', value: 7, unit: 'of 9', note: 'The watering flow is done.' },
    { kind: 'progress', title: 'Store listing', value: 3, max: 8 },
    { kind: 'bars', title: 'Open bugs by area', bars: [{ label: 'Reminders', value: 4 }, { label: 'Sync', value: 2 }] },
  ],
};
/**
 * A dashboard at the schema's limits (src/core/dashboard.ts, DASHBOARD_LIMITS): an 80-character title, words that never
 * break, the most bars, columns and rows, so the every-state sweep can look at how the board holds them.
 */
const LONG_WORD = `https://example.com/${'a-very-long-path-segment-'.repeat(7)}end`;
export const LONG_DASHBOARD = {
  title: 'Everything the company measured about the watering flow in its first week of work'.slice(0, 80),
  widgets: [
    { kind: 'stat', title: 'Screens designed and reviewed and accepted by the head of design this week'.slice(0, 80), value: 7, unit: 'screens', note: LONG_WORD.slice(0, 200) },
    { kind: 'bars', title: 'Open bugs by area', bars: Array.from({ length: 60 }, (_, i) => ({ label: `${i + 1}. ${LONG_WORD}`.slice(0, 200), value: 60 - i })) },
    {
      kind: 'table',
      title: 'Every task with its owner, its state and what it is waiting for',
      columns: ['Task', 'Owner', 'State', 'Waiting for', 'Branch', 'Files', 'Cost', 'Note'],
      rows: Array.from({ length: 50 }, (_, i) => [`Task ${i + 1}`, 'Kai', 'Working', LONG_WORD.slice(0, 80), `worklings/t-${i + 1}`, 'src/streak/', 1.25, 'A note that goes on for a while.']),
    },
  ],
};
/** The third widget is a line with no points, as the design doc's example refuses it. */
export const BAD_DASHBOARD = {
  title: 'Broken board',
  widgets: [
    { kind: 'stat', title: 'Screens designed', value: 7 },
    { kind: 'progress', title: 'Store listing', value: 3, max: 8 },
    { kind: 'line', title: 'Downloads', points: [] },
  ],
};

/** What the office runs when a task is reported done (v0.2): one plain command that passes at once. */
export const CHECK = 'node --version';

/**
 * What the flow and the card share. A plan with three people building parts and one task waiting for another's work needs
 * a contract (the CEO's plans are held to it), so the plans below carry this one; test/e2e-fixture-plans.test.ts checks it.
 */
const FLOW_CONTRACT = { id: 'c-1', title: 'Watering flow screens', file: 'design/flow.md', writer: 'p-1', dependents: ['p-2'], summary: 'The three screens the card is built against: plant, water, streak.' };

/** The prompt the e2e companies start from (`found`), whose words the checklists quote. */
export const PROMPT = 'A plant care app with watering streaks [fake:found]';

/**
 * v0.2: what the stakeholder asked for, as the CEO's plans must list it (`checklist: true`), quoting the prompt. Every
 * task that builds a part covers an item; integration and verification tasks are exempt.
 */
const checklist = (listing: string) => [
  { id: 'k-1', text: 'A plant can be watered and its streak grows.', quote: 'watering streaks', covers: ['p-1', 'p-2'] },
  { id: 'k-2', text: 'The app has a store listing in English and German.', quote: 'A plant care app', covers: [listing] },
];

/** The CEO's first plan: two milestones, three tasks with files of their own and the contract between the flow and the card. */
export const PLAN = {
  goal: 'Ship the watering flow with its streak.',
  milestones: [
    { id: 'ms-1', title: 'Watering flow', doneWhen: 'A plant can be watered and the streak grows.' },
    { id: 'ms-2', title: 'Store listing', doneWhen: 'The listing is written in two languages.' },
  ],
  tasks: [
    { id: 'p-1', title: 'Sketch the watering flow', owner: 'ux-designer', files: ['design/flow.md'], milestone: 'ms-1', after: [], brief: 'Three screens: plant, water, streak.', doneWhen: 'The three screens are described.', check: CHECK },
    { id: 'p-2', title: 'Build the streak card', owner: 'frontend-engineer', files: ['src/streak/'], milestone: 'ms-1', after: ['p-1'], brief: 'The card shows the streak and a flame.', doneWhen: 'The card renders in the app.', check: CHECK },
    { id: 'p-3', title: 'Write the store listing', owner: 'ui-designer', files: ['store/listing.md'], milestone: 'ms-2', after: [], brief: 'Short and long text for the stores.', doneWhen: 'Both texts exist in English and German.', check: CHECK },
  ],
  contracts: [FLOW_CONTRACT],
  checklist: checklist('p-3'),
};
/**
 * The revision: p-2 changes its title, p-3 goes, a new p-5 comes in and ms-2 gets a new title. The new task is p-5, not
 * p-4: the version the CEO revises already has p-4, the final review the office added, and a CEO reading it doesn't
 * reuse that id (reused, the diff compared the German listing with the final review).
 */
export const PLAN_V2 = {
  goal: PLAN.goal,
  milestones: [PLAN.milestones[0], { ...PLAN.milestones[1], title: 'Store listing in two languages' }],
  tasks: [
    PLAN.tasks[0],
    { ...PLAN.tasks[1], title: 'Build the streak card with a flame' },
    { id: 'p-5', title: 'Draft the German listing', owner: 'ui-designer', files: ['store/de.md'], milestone: 'ms-2', after: [], brief: 'The German store text.', doneWhen: 'The German text exists.', check: CHECK },
  ],
  contracts: [FLOW_CONTRACT],
  checklist: checklist('p-5'),
};

/** v0.2: the plan with a contract between the flow and the card, an integration task for the first milestone and a check at the end. */
export const PLAN_CONTRACTS = {
  goal: PLAN.goal,
  milestones: PLAN.milestones,
  tasks: [
    PLAN.tasks[0],
    PLAN.tasks[1],
    { id: 'p-4', title: 'Run the watering flow end to end', owner: 'frontend-engineer', files: ['src/e2e/'], milestone: 'ms-1', after: ['p-1', 'p-2'], brief: 'Build and run the flow and the card together against the contract.', doneWhen: 'The flow runs and every mismatch is fixed or reported.', kind: 'integration', check: CHECK },
    // The final review is the office's to add, as a task of kind verification at the end.
    { ...PLAN.tasks[2], after: ['p-4'] },
  ],
  contracts: [FLOW_CONTRACT],
  // The integration task covers no item: it is exempt, as the final review is.
  checklist: checklist('p-3'),
};

/** What each desk's turn does, by the scenario its message names; anything else just answers. */
export const SCRIPT = {
  default: [{ say: 'On it.' }],
  // The start turn of a company whose plan waits for approval (what a new company meets by default) tells the CEO to
  // propose the plan first; the fake CEO then proposes PLAN, as a real one would. Companies started with plan approval off get a different turn.
  // The answers to the CEO's scoping questions come back in one message the office writes; the fake CEO then drafts.
  byText: [
    { includes: 'First propose the plan with propose_plan', scenario: 'plan' },
    { includes: 'Answers to your scoping questions', scenario: 'found-scoped' },
    // v0.2's end of a plan: the final review's turn (fresh, written by the office) marks the checklist and reports, and the
    // CEO's turn after it writes the final handover. Only a company whose every plan task is done gets either.
    // v0.3: a company whose dev script the office won't start by itself (it listens on every network) gets a review that
    // finds the streak not met, so the office's fix round shows (test/e2e/v3-quality.spec.ts). The look's note is in its turn.
    { includes: 'Serve the project on every network', scenario: 'review-fail' },
    { includes: 'with mark_checklist: met, partly or not met', scenario: 'review' },
    { includes: "in the final handover's shape", scenario: 'handover' },
    // v0.3: the CEOs of the studio spec's companies answer the studio chat, each in its own words (by its folder).
    { includes: 'From the studio chat', folder: 'studio-plant', scenario: 'studio-answer-plant' },
    { includes: 'From the studio chat', folder: 'studio-bakery', scenario: 'studio-answer-bakery' },
  ],
  scenarios: {
    found: [{ org: 'library_catalogue', arguments: {} }, { org: 'propose_org', arguments: PROPOSAL_FOR_CEO }, { say: 'I proposed an org of eight for Plant Pal.' }],
    // Scoping first, as a CEO does with a short prompt: the questions, then the end of the turn. The draft comes with the answers.
    scope: [{ org: 'ask_scoping', arguments: { questions: SCOPING } }, { say: 'I asked four questions before drafting.' }],
    'found-scoped': [{ wait: 2_500 }, { org: 'library_catalogue', arguments: {} }, { org: 'propose_org', arguments: PROPOSAL_FOR_CEO }, { say: 'I proposed an org of eight for Plant Pal, from your answers.' }],
    'found-bakery': [{ org: 'propose_org', arguments: { ...PROPOSAL_FOR_CEO, company: 'Corner Bakery', goal: 'A bakery site with pickup orders.' } }, { say: 'I proposed an org of eight for Corner Bakery.' }],
    // The same proposal after a pause, so a spec can see the "Drafting your company" screen before the proposal replaces it.
    'found-slow': [{ wait: 2_500 }, { org: 'propose_org', arguments: PROPOSAL_FOR_CEO }, { say: 'I proposed an org of eight for Plant Pal.' }],
    // A CEO that answers in words and ends its turn without a proposal, as a real one can.
    words: [{ say: 'Before I draft: should the plant app work on iOS only, or on Android too?' }],
    revise: [{ org: 'propose_org', arguments: REVISED_FOR_CEO }, { say: 'I added Mila, a German copywriter, under Ada.' }],
    busy: [{ wait: 6_000 }, { say: 'Started on the palette.' }],
    relay: [{ org: 'relay', arguments: { to: ['ui-designer'], note: 'Menu pages first.' } }, { say: 'Passed it on to Kai.' }],
    // The same, with Ada's answer a moment after the relay, so the relay is the newest line for long enough to be seen (a strip
    // that shows one line, on a phone, would otherwise skip it for the answer that follows at once).
    'relay-late': [{ org: 'relay', arguments: { to: ['ui-designer'], note: 'Menu pages first.' } }, { wait: 3_000 }, { say: 'Passed it on to Kai.' }],
    push: [{ tool: 'Bash', input: { command: 'git push origin HEAD', description: 'Push the work branch' }, ask: true }, { say: 'Pushed the branch.' }],
    long: [{ wait: 120_000 }, { say: 'Built the menu page.' }],
    // v0.4 (H2): a Builder who starts a helper with the Agent tool and works beside it for a while.
    helper: [{ tool: 'Bash', input: { command: 'npm test', description: 'Run the tests' }, ms: 400 }, { helper: { type: 'Explore', description: 'Explores the watering routes', ms: 90_000 } }, { say: 'Built the watering flow with a helper.' }],
    // v0.7: a plain job's session keeps its own todo list and hands part of the work to a helper while it works.
    'plain-demo': [
      { tool: 'TodoWrite', input: { todos: [{ content: 'Read how reminders are scheduled', status: 'completed', activeForm: 'Reading' }, { content: 'Add the watering streak', status: 'in_progress', activeForm: 'Adding the streak' }, { content: 'Cover the streak with tests', status: 'pending', activeForm: 'Writing tests' }] } },
      { helper: { type: 'Explore', description: 'Maps where reminders are sent', ms: 120_000 } },
      { say: 'Added the watering streak, with tests.' },
    ],
    limit: [{ limit: { status: 'rejected', resetsAt: RESETS_AT_S, rateLimitType: 'five_hour', utilization: 1 } }, { fail: 'usage-limit' }],
    ask: [{ org: 'ask_stakeholder', arguments: { question: 'Which payment should the app take?', options: ['TWINT', 'Card'], recommended: 0 } }, { say: 'Asked.' }],
    goal: [
      { org: 'set_goal', arguments: { goal: 'Ship the watering flow.', milestones: [{ title: 'Watering flow', doneWhen: 'A plant can be watered and the streak grows.' }, { title: 'Store listing', doneWhen: 'The listing is written in two languages.' }] } },
      { say: 'Goal set.' },
    ],
    assign: [
      { org: 'assign', arguments: { to: 'ux-designer', title: 'Sketch the watering flow', brief: 'Three screens: plant, water, streak.', files: [], doneWhen: 'The three screens are described.' } },
      { org: 'post_status', arguments: { text: 'Planning the watering flow with Lea.' } },
      { say: 'Assigned.' },
    ],
    // The first milestone's first task: assigned by Ada to Lea, reported done by Lea, accepted by Ada (t-1, ms-1 in a fresh company).
    'assign-m1': [
      { org: 'assign', arguments: { to: 'ux-designer', title: 'Sketch the watering flow', brief: 'Three screens: plant, water, streak.', files: [], doneWhen: 'The three screens are described.', milestone: 'ms-1' } },
      { say: 'Assigned.' },
    ],
    'report-done': [{ org: 'report', arguments: { task: 't-1', state: 'done', files: ['design/flow.md'], check: { ran: CHECK, passed: true }, open: [], note: 'Three screens described: plant, water, streak. Nothing needed in code yet.' } }, { say: 'Reported.' }],
    accept: [{ org: 'review', arguments: { task: 't-1', verdict: 'accept', note: 'Clear, thank you.' } }, { say: 'Accepted.' }],
    'games-room': [{ org: 'change_office', arguments: { change: 'add-room', room: 'games', title: 'Games room', kind: 'games', theme: 'arcade' } }, { say: 'Added the games room.' }],
    'fire-tom': [{ org: 'fire', arguments: { role: 'qa-engineer' } }, { say: 'Let Tom go.' }],
    'rehire-tom': [{ org: 'rehire', arguments: { role: 'qa-engineer' } }, { say: 'Tom is back.' }],
    'theme-arcade': [{ org: 'change_office', arguments: { change: 'theme', theme: 'arcade' } }, { say: 'Arcade it is.' }],
    'theme-cafe': [{ org: 'change_office', arguments: { change: 'theme', theme: 'cafe' } }, { say: 'A cafe.' }],
    'theme-lab': [{ org: 'change_office', arguments: { change: 'theme', theme: 'lab' } }, { say: 'A lab.' }],
    'theme-garden': [{ org: 'change_office', arguments: { change: 'theme', theme: 'garden' } }, { say: 'A garden.' }],
    dashboard: [{ org: 'publish_dashboard', arguments: GOOD_DASHBOARD }, { say: 'Published the launch checklist.' }],
    'dashboard-long': [{ org: 'publish_dashboard', arguments: LONG_DASHBOARD }, { say: 'Published the long dashboard.' }],
    'bad-dashboard': [{ org: 'publish_dashboard', arguments: BAD_DASHBOARD }, { say: 'Tried to publish.' }],
    // Steering (H39 to H46). "$message" stands for the message the turn answers, so a scenario can cite it.
    plan: [{ org: 'propose_plan', arguments: { ...PLAN, note: 'First plan.' } }, { say: 'I proposed a plan.' }],
    'plan-v2': [{ org: 'propose_plan', arguments: { ...PLAN_V2, note: 'Streak card gets its flame; the German listing replaces the store task.', cites: ['$message'] } }, { say: 'Revised the plan.' }],
    'plan-contracts': [{ org: 'propose_plan', arguments: { ...PLAN_CONTRACTS, note: 'Contracts and kinds.', cites: ['$message'] } }, { say: 'Revised the plan with contracts.' }],
    'approve-plan-1': [{ org: 'approve_plan', arguments: { version: 1, cites: ['$message'] } }, { say: 'Approved version 1.' }],
    'approve-plan-2': [{ org: 'approve_plan', arguments: { version: 2, cites: ['$message'] } }, { say: 'Approved version 2.' }],
    'approve-plan-stale': [{ org: 'approve_plan', arguments: { version: 1, cites: ['m-999'] } }, { org: 'post_status', arguments: { text: 'Tried to approve the plan.' } }, { say: 'Tried to approve.' }],
    'setting-desks': [{ org: 'change_settings', arguments: { maxDesks: 3, cites: ['$message'] } }, { say: 'Three desks at once.' }],
    'setting-plan-milestones': [{ org: 'change_settings', arguments: { planApproval: 'milestones', cites: ['$message'] } }, { say: 'Approval at every milestone.' }],
    'setting-refused': [{ org: 'change_settings', arguments: { maxDesks: 2, cites: ['m-999'] } }, { org: 'post_status', arguments: { text: 'Tried to change the desks.' } }, { say: 'Tried to change it.' }],
    'leash-check-kai': [{ org: 'change_settings', arguments: { leash: 'check', person: 'ui-designer', cites: ['$message'] } }, { say: 'Kai checks with you now.' }],
    'leash-trusted-sam': [{ org: 'change_settings', arguments: { leash: 'trusted', person: 'frontend-engineer', cites: ['$message'] } }, { say: 'Asked you about trusting Sam.' }],
    'leash-room-design': [{ org: 'change_settings', arguments: { leash: 'check', room: 'design', cites: ['$message'] } }, { say: 'The design room checks with you.' }],
    'steer-pause-t1': [{ org: 'steer_task', arguments: { action: 'pause', task: 't-1', cites: ['$message'] } }, { say: 'Paused t-1.' }],
    'steer-resume-t1': [{ org: 'steer_task', arguments: { action: 'resume', task: 't-1', cites: ['$message'] } }, { say: 'Resumed t-1.' }],
    decide: [{ org: 'decide', arguments: { what: 'The streak card uses a flame, not a leaf.', why: 'Users read a flame as a streak at a glance.', alternatives: ['A leaf', 'A number only'], cites: ['$message'] } }, { say: 'Recorded.' }],
    ack: [{ org: 'ack', arguments: { message: '$message', agree: true, text: 'I will start on it now.' } }, { say: 'Acknowledged.' }],
    // v0.2's budget: ten model requests, a cent at the fake desk's rate (REQUEST_COST in test/fake-desk.mjs), so a spec can walk a budget up.
    spend: Array.from({ length: 10 }, (_, i) => ({ say: `Working through step ${i + 1}.` })),
    // v0.3, the studio chat (test/e2e/v3-studio.spec.ts): it asks the CEOs of its project's own portfolio, so no other
    // spec's company gets a turn, and passes their answers on.
    ...Object.fromEntries(
      ['v3', 'v3-phone'].map((project) => [
        `studio-ask-${project}`,
        [
          { org: 'list_portfolios', arguments: {} },
          { org: 'message_ceos', arguments: { to: { portfolio: `p-client-work-${project}` }, text: 'How far along are you, and does anything wait on me? One line, please.' } },
          { org: 'collect_replies', arguments: { wait_seconds: 8 } },
          {
            say: 'Both CEOs answered. Plant Pal: the watering flow is done and reminders are next; one question waits on you (open Plant Pal in the lobby, then its inbox). Corner Bakery: the menu page is up, pickup slots are next, and nothing waits on you.',
          },
        ],
      ]),
    ),
    'studio-answer-plant': [{ say: 'The watering flow is done and reminders are next. One question waits in the inbox: which reminder time to use.' }],
    'studio-answer-bakery': [{ say: 'The menu page is up and pickup slots are next. Nothing waits on you.' }],
    work: [{ org: 'post_status', arguments: { text: 'Working on the streak card.' } }, { wait: 90_000 }, { say: 'Done.' }],
    // v0.2: a maker finishing the task its message names ("[fake:finish] [task t-2]"), in the report's form.
    finish: [{ org: 'report', arguments: { task: '$task', state: 'done', files: [], check: { ran: CHECK, passed: true }, open: [], note: 'Built as the brief says.' } }, { say: 'Reported.' }],
    // The final review: every checklist item marked with its evidence, then the report (an empty open: all passed).
    review: [
      {
        org: 'mark_checklist',
        arguments: {
          task: '$task',
          items: [
            { item: 'k-1', verdict: 'met', evidence: 'Watered a plant twice: the streak went from 0 to 2.', check: { ran: CHECK, passed: true } },
            { item: 'k-2', verdict: 'met', evidence: 'The listing has its English and German texts.', files: ['store/listing.md'] },
          ],
        },
      },
      { org: 'report', arguments: { task: '$task', state: 'done', files: [], check: { ran: CHECK, passed: true }, open: [], note: 'Every checklist item is met.' } },
      { say: 'Reviewed.' },
    ],
    'review-fail': [
      {
        org: 'mark_checklist',
        arguments: {
          task: '$task',
          items: [
            { item: 'k-1', verdict: 'not-met', evidence: 'Watered a plant twice: the streak stayed at 1.', check: { ran: CHECK, passed: true } },
            { item: 'k-2', verdict: 'met', evidence: 'The listing has its English and German texts.', files: ['store/listing.md'] },
          ],
        },
      },
      { org: 'report', arguments: { task: '$task', state: 'done', files: [], check: { ran: CHECK, passed: false }, open: [], note: 'The streak does not grow.' } },
      { say: 'Reviewed.' },
    ],
    handover: [
      { org: 'report', arguments: { state: 'done', note: 'Plant Pal is built: the watering flow with its streak, and the store listing in English and German.\n\nOpen it with npm start.' } },
      { say: 'Handed over.' },
    ],
  },
};

/** Writes the script the fake desk reads and returns its path. */
export function writeScript(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'desk-script.json');
  writeFileSync(file, JSON.stringify(SCRIPT));
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers that go through the hub's HTTP API

// `connection: close`: a kept-alive socket that Node's server closes (after 5 s idle, or when a busy hub answers late)
// at the moment the client reuses it fails as ECONNRESET, which is the machine being busy and not the hub failing.
const headers = { authorization: `Bearer ${TOKEN}`, connection: 'close' };

export async function api<T = Record<string, unknown>>(request: APIRequestContext, path: string, body?: unknown, hub = HUB): Promise<{ status: number; body: T }> {
  const res = body === undefined ? await request.get(`${hub}/${path}`, { headers }) : await request.post(`${hub}/${path}`, { headers, data: body });
  const text = await res.text();
  return { status: res.status(), body: (text ? JSON.parse(text) : null) as T };
}

export async function lobby(request: APIRequestContext, hub = HUB): Promise<LobbyView> {
  return (await api<LobbyView>(request, 'api/lobby', undefined, hub)).body;
}

export async function view(request: APIRequestContext, id: string, hub = HUB): Promise<CompanyView> {
  const snapshot = (await api<Snapshot>(request, `api/c/${id}/state`, undefined, hub)).body;
  if (!snapshot.company) throw new Error(`The snapshot of ${id} has no company.`);
  return snapshot.company;
}

export async function say(request: APIRequestContext, id: string, to: string, text: string, hub = HUB): Promise<string> {
  const sent = await api<{ id: string }>(request, `api/c/${id}/messages`, { to, text }, hub);
  if (sent.status !== 202) throw new Error(`Saying to ${to} gave ${sent.status}.`);
  return sent.body.id;
}

/** A folder no other spec uses; the company's id comes from its name. The hub wants the folder to exist. */
export function folderFor(scratch: string, name: string): string {
  const folder = join(scratch, 'companies', name);
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** Founds a company through the hub (the CEO starts drafting) and returns its id. */
export async function found(request: APIRequestContext, scratch: string, name: string, prompt = PROMPT, hub = HUB): Promise<string> {
  // The plain hub leaves the shape to the creator, as the CLI's does: these specs ask for one Claude Code session.
  const created = await api<{ id: string }>(request, 'api/companies', { folder: folderFor(scratch, name), prompt, ...(hub === PLAIN_HUB ? { work: 'plain' } : {}) }, hub);
  if (created.status !== 201) throw new Error(`Creating ${name} gave ${created.status}: ${JSON.stringify(created.body)}`);
  return created.body.id;
}
