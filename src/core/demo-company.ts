// v3's demo: a café company with every state the panels draw, three more companies for the lobby, and the snapshot
// around each, so the web app can be built and tested without a hub. Everything is made up and deterministic for a
// given `now`. Pure, with no Node APIs: the web app imports it.
import { emptyAsideView } from './aside.ts';
import { checklistView } from './checklist.ts';
import { sinceOf, sinceStart, summaryInputOfView, summaryOf } from './overview.ts';
import { approvedVersion, latestVersion, planInbox } from './plan.ts';
import {
  type Approval,
  type CompanyView,
  DEFAULT_IDLE_MS,
  type DeskState,
  type DeskView,
  type Goal,
  type LobbyCompany,
  type LobbyView,
  type LogEntry,
  type Message,
  type PersonView,
  type Question,
  type Report,
  type ScopingView,
  type Screenshot,
  type SpendView,
  STAKEHOLDER,
  type StatusLine,
  type Task,
  type TaskStatus,
  THE_OFFICE,
  UNDO_MS,
} from './company.ts';
import { dict } from './company-state.ts';
import { type PresetId, presetModels } from './presets.ts';
import { proposalLoadCosts } from './org.ts';
import { spendingViewOf } from './spending.ts';
import type { Dashboard } from './dashboard.ts';
import type { BaseDepartment } from './departments.ts';
import type { Theme } from './looks.ts';
import type { AgentState } from './office.ts';
import type { NewRole, OrgProposal, ProposedPerson } from './org.ts';
import type { CatalogRole, Snapshot } from './snapshot.ts';
import {
  type Ack,
  type Audience,
  type ChecklistItem,
  type ChecklistVerdict,
  type Decision,
  DEFAULT_PLAN_APPROVAL,
  type Effort,
  type Leash,
  type PersonSteering,
  type Plan,
  type PlanMilestone,
  type PlanTask,
  type PlanView,
  type SettingsChange,
  type SteeringSettings,
  type SteeringView,
} from './steering.ts';
import type { FiredRole, Level, Look, OfficeRoom, RoleModel, Studio, StudioDepartment } from './studio.ts';
import { ZERO_USAGE } from './usage.ts';

/** The demo company's id: `/c/demo` opens it. */
export const DEMO_COMPANY = 'demo';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A small seeded random, so the demo's numbers are the same on every load. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------
// People

interface Seat {
  id: string;
  name: string;
  title: string;
  level: Level;
  room: string;
  reportsTo: string | null;
  model: RoleModel;
  look?: Look;
}

const seat = (id: string, name: string, title: string, level: Level, room: string, reportsTo: string | null, model: RoleModel, look?: Look): Seat => ({
  id, name, title, level, room, reportsTo, model, ...(look ? { look } : {}),
});

const CAFE_ROOMS: StudioDepartment[] = [
  { id: 'direction', name: 'Direction', style: 'direction' },
  { id: 'design', name: 'Design', style: 'design' },
  { id: 'engineering', name: 'Engineering', style: 'engineering' },
  { id: 'content', name: 'Content', style: 'content' },
  { id: 'quality', name: 'Quality', style: 'quality' },
];

const CAFE_SEATS: Seat[] = [
  seat('ceo', 'Mara', 'CEO', 'ceo', 'direction', null, 'opus'),
  seat('office-manager', 'Otto', 'Office manager', 'worker', 'direction', 'ceo', 'haiku', { prop: 'headset' }),
  seat('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo', 'sonnet', { body: 'mage' }),
  seat('ui-designer', 'Mina', 'UI designer', 'worker', 'design', 'head-of-design', 'sonnet', { prop: 'tablet' }),
  seat('ux-designer', 'Jules', 'UX designer', 'worker', 'design', 'head-of-design', 'sonnet'),
  seat('brand-designer', 'Pia', 'Brand designer', 'worker', 'design', 'head-of-design', 'sonnet'),
  seat('head-of-engineering', 'Theo', 'Head of engineering', 'head', 'engineering', 'ceo', 'opus'),
  seat('web-lead', 'Ines', 'Team lead, web', 'lead', 'engineering', 'head-of-engineering', 'sonnet'),
  seat('frontend-engineer', 'Kai', 'Frontend engineer', 'worker', 'engineering', 'web-lead', 'sonnet', { prop: 'laptop' }),
  seat('backend-engineer', 'Noah', 'Backend engineer', 'worker', 'engineering', 'web-lead', 'sonnet'),
  seat('twint-payments-engineer', 'Sofia', 'TWINT payments engineer', 'worker', 'engineering', 'web-lead', 'sonnet'),
  seat('devops-engineer', 'Marco', 'DevOps engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', { prop: 'headset' }),
  seat('security-reviewer', 'Yara', 'Security reviewer', 'worker', 'engineering', 'head-of-engineering', 'sonnet'),
  seat('head-of-content', 'Clara', 'Head of content', 'head', 'content', 'ceo', 'sonnet'),
  seat('german-copywriter', 'Lena', 'German copywriter', 'worker', 'content', 'head-of-content', 'haiku', { prop: 'notebook' }),
  seat('local-seo-specialist', 'Tom', 'Local SEO specialist', 'worker', 'content', 'head-of-content', 'haiku'),
  seat('qa-engineer', 'Ravi', 'QA engineer', 'worker', 'quality', 'head-of-engineering', 'sonnet', { prop: 'clipboard' }),
  seat('accessibility-specialist', 'Elif', 'Accessibility specialist', 'worker', 'quality', 'head-of-engineering', 'sonnet'),
];

/** What each person was doing when the demo starts: their desk, their task and how full their context is. */
const CAFE_DESKS: Record<string, { state: DeskState; ago: number; task: string | null; context: number | null; problem?: string; queue?: number }> = {
  ceo: { state: 'idle', ago: 8, task: null, context: 0.41 },
  // Otto, Pia and Tom took the all-hands, the design room's message or Clara's as a new turn, then idled out.
  'office-manager': { state: 'closed', ago: 48, task: null, context: 0.12 },
  'head-of-design': { state: 'working', ago: 9, task: 't-22', context: 0.33 },
  'ui-designer': { state: 'idle', ago: 6, task: 't-25', context: 0.52 },
  'ux-designer': { state: 'working', ago: 22, task: 't-19', context: 0.61 },
  'brand-designer': { state: 'closed', ago: 26, task: null, context: 0.2 },
  'head-of-engineering': { state: 'working', ago: 4, task: 't-16', context: 0.47 },
  'web-lead': { state: 'working', ago: 11, task: 't-23', context: 0.58 },
  'frontend-engineer': { state: 'working', ago: 31, task: 't-11', context: 0.78 },
  'backend-engineer': { state: 'waiting', ago: 2, task: 't-12', context: 0.36, queue: 1 },
  'twint-payments-engineer': { state: 'failed', ago: 4, task: 't-13', context: 0.44, problem: 'The TWINT sandbox turned down the test merchant ID, so the payment call failed.' },
  'devops-engineer': { state: 'away', ago: 25, task: 't-34', context: 0.39 },
  'security-reviewer': { state: 'starting', ago: 0.3, task: 't-17', context: null },
  'head-of-content': { state: 'working', ago: 14, task: 't-30', context: 0.29 },
  'german-copywriter': { state: 'working', ago: 7, task: 't-31', context: 0.92 },
  'local-seo-specialist': { state: 'idle', ago: 24, task: null, context: 0.31 },
  'qa-engineer': { state: 'idle', ago: 15, task: 't-15', context: 0.22 },
  // Hired 40 minutes ago, after the all-hands, and not at work yet.
  'accessibility-specialist': { state: 'closed', ago: 40, task: null, context: null },
};

/** A made-up session id per person, shaped like Claude Code's. */
function sessionOf(company: string, person: string): string {
  const r = seeded(hashText(`${company}/${person}`));
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------
// The café's work

const CAFE_GOAL_TEXT = 'Guests order coffee and pastries online in German or English, pay with TWINT and pick up at the counter.';

/** The goal's milestones, which are the plan's too. */
const CAFE_MILESTONES: PlanMilestone[] = [
  { id: 'ms-menu', title: 'Menu pages live', doneWhen: 'Guests can read the menu in German and English on a phone.' },
  { id: 'ms-pickup', title: 'Pickup orders work', doneWhen: 'A guest can order, pay with TWINT and collect at the counter.' },
  { id: 'ms-launch', title: 'Launch in German and English', doneWhen: 'A native speaker checked both languages and the site is live.' },
];

const CAFE_GOAL = (now: number): Goal => ({
  text: CAFE_GOAL_TEXT,
  setAt: now - 25 * HOUR,
  milestones: CAFE_MILESTONES.map((m) => ({ ...m, doneAt: m.id === 'ms-menu' ? now - 3 * HOUR : null })),
});

interface TaskSeed {
  id: string;
  title: string;
  owner: string;
  askedBy: string;
  status: TaskStatus;
  milestone: string | null;
  parent?: string;
  files?: string[];
  brief?: string;
  doneWhen?: string;
  outcome?: string;
  commit?: string;
  worktree?: { path: string; branch: string };
  /** Minutes ago it was asked for, and last changed. */
  created: number;
  updated: number;
  // Steering. Times are minutes ago.
  /** Its place in line, for open tasks: lower goes first. */
  priority?: number;
  /** The plan task it was made from. */
  planTask?: string;
  cites?: string[];
  paused?: { ago: number; by: string };
  cancel?: { ago: number; by: string; reason: string; branch: string | null };
  handovers?: { ago: number; by: string; from: string; to: string; note: string }[];
}

const CAFE_TASKS: TaskSeed[] = [
  {
    id: 't-1', title: 'Menu page layout', owner: 'ui-designer', askedBy: 'head-of-design', status: 'done', milestone: 'ms-menu', files: ['src/pages/menu/'],
    brief: 'Lay out the menu page: coffee, pastries and lunch, with prices and allergens. It must read well on a 320 px phone.',
    doneWhen: 'The menu page renders every section from the menu data at 320 px and up.',
    outcome: 'Menu page with sections for coffee, pastries and lunch, readable from 320 px.', commit: 'a1b2c3d', created: 1440, updated: 230, planTask: 'p-1',
  },
  {
    id: 't-2', title: "Menu data from the café's price list", owner: 'backend-engineer', askedBy: 'web-lead', status: 'done', milestone: 'ms-menu', files: ['src/data/menu.ts'],
    brief: 'Turn the price list the café sent into typed menu data with allergens.', doneWhen: 'Every item on the price list is in the data with its price.',
    outcome: 'All 46 items are in the menu data, with allergens and prices in francs.', commit: 'b2c3d4e', created: 1430, updated: 260, planTask: 'p-2',
  },
  {
    id: 't-3', title: 'German menu descriptions, first pass', owner: 'german-copywriter', askedBy: 'head-of-content', status: 'done', milestone: 'ms-menu', files: ['content/de/menu.md'],
    brief: 'Describe every item on the menu in German, in Swiss spelling.', doneWhen: 'Every item on the menu has a German description.',
    outcome: 'First German descriptions for all 46 items, in Swiss spelling.', commit: 'c3d4e5f', created: 1380, updated: 250, planTask: 'p-3',
  },
  {
    id: 't-4', title: 'Google business profile and menu markup', owner: 'local-seo-specialist', askedBy: 'head-of-content', status: 'done', milestone: 'ms-menu', files: ['src/seo/'],
    brief: "Link the café's Google business profile to the menu, and mark the menu page up with schema.org.", doneWhen: 'Search Console shows the menu page indexed with its markup.',
    outcome: "The café's business profile links to the menu, and the menu page carries schema.org markup.", commit: 'd4e5f60', created: 1300, updated: 40, planTask: 'p-5',
  },
  {
    id: 't-5', title: 'Menu photos', owner: 'brand-designer', askedBy: 'head-of-design', status: 'dropped', milestone: 'ms-menu', files: ['public/photos/'],
    brief: 'A photo for each section of the menu, in the light of the café in the morning.', doneWhen: 'Each section of the menu has a photo.',
    outcome: 'Dropped: the café sends its own photos next week.', created: 1350, updated: 300, planTask: 'p-6',
  },
  {
    id: 't-6', title: 'Menu in English', owner: 'head-of-content', askedBy: 'ceo', status: 'done', milestone: 'ms-menu', files: ['content/en/menu.md'],
    brief: 'Write the English menu from the German one and check it against the price list.', doneWhen: 'Every item on the menu has an English description.',
    outcome: 'English menu written from the German one, checked against the price list.', commit: 'e5f6071', created: 1390, updated: 245, planTask: 'p-4',
  },
  {
    id: 't-10', title: 'Pickup orders', owner: 'head-of-engineering', askedBy: 'ceo', status: 'working', milestone: 'ms-pickup',
    files: ['src/pickup/', 'api/orders/', 'src/pay/', 'api/twint/', 'src/data/hours.ts', 'tests/pickup.spec.ts'],
    brief: 'Take pickup orders end to end: pick a slot, build a cart, pay with TWINT, show the order status.',
    doneWhen: 'A guest can order on a phone, pay with TWINT and see when the order is ready.', created: 240, updated: 4, planTask: 'p-8', priority: 2,
  },
  {
    id: 't-11', title: 'Pickup slot picker', owner: 'frontend-engineer', askedBy: 'web-lead', status: 'working', milestone: 'ms-pickup', parent: 't-10',
    files: ['src/pickup/SlotPicker.tsx', 'src/pickup/slots.ts'],
    brief:
      'Guests pick a pickup time between 7:00 and 17:30. Show the next slots as one row of big buttons that scrolls sideways, grey out full ones, and keep it usable with one thumb on a 375 px phone. The window length waits on Mina\'s question to you; build it so either works.',
    doneWhen: 'A guest can pick a slot with one thumb at 375 px, and the slot is saved with the order.', created: 200, updated: 31, priority: 3,
  },
  {
    id: 't-12', title: 'Order API: save pickup orders', owner: 'backend-engineer', askedBy: 'web-lead', status: 'queued', milestone: 'ms-pickup', parent: 't-10', files: ['api/orders/'],
    brief: 'An endpoint that saves an order with its items, pickup slot, name and phone number. No accounts.', doneWhen: 'Orders are saved and can be read back by the counter screen.',
    created: 190, updated: 2, priority: 1,
  },
  {
    id: 't-13', title: 'Pay with TWINT at pickup', owner: 'twint-payments-engineer', askedBy: 'web-lead', status: 'working', milestone: 'ms-pickup', parent: 't-10',
    files: ['src/pay/', 'api/twint/'], worktree: { path: 'C:\\Users\\you\\Projects\\cafe-lumen\\.worktrees\\twint', branch: 'worklings/cafe-lumen-twint' },
    brief: "Take payment with TWINT when the guest orders, using the café's merchant account in the sandbox until launch.", doneWhen: 'A sandbox payment marks the order paid.',
    created: 185, updated: 4, priority: 4,
  },
  {
    id: 't-14', title: 'Order confirmation in both languages', owner: 'german-copywriter', askedBy: 'head-of-content', status: 'queued', milestone: 'ms-pickup',
    files: ['content/de/confirmation.md', 'content/en/confirmation.md'], brief: 'The confirmation screen and text message, in German and English.',
    doneWhen: 'Both languages read well on the confirmation screen and in the text message.', created: 120, updated: 120, planTask: 'p-9', priority: 13,
  },
  {
    id: 't-15', title: 'End-to-end test of a pickup order', owner: 'qa-engineer', askedBy: 'head-of-engineering', status: 'blocked', milestone: 'ms-pickup', parent: 't-10',
    files: ['tests/pickup.spec.ts'], brief: 'Order, pay in the sandbox and check the counter screen, on a phone viewport.', created: 150, updated: 15, priority: 8,
  },
  {
    id: 't-16', title: 'Cart summary', owner: 'frontend-engineer', askedBy: 'web-lead', status: 'review', milestone: 'ms-pickup', parent: 't-10', files: ['src/pickup/Cart.tsx'],
    outcome: 'Cart summary shows the items, the pickup time and the total in francs; ready for review.', created: 170, updated: 6, priority: 5,
  },
  {
    id: 't-17', title: 'Payment data review', owner: 'security-reviewer', askedBy: 'head-of-engineering', status: 'working', milestone: 'ms-pickup', parent: 't-10',
    brief: 'Check what the payment flow stores and logs: no card or TWINT data beyond the order id.', created: 20, updated: 0.3, priority: 7,
    handovers: [
      {
        ago: 1, by: 'head-of-engineering', from: 'qa-engineer', to: 'security-reviewer',
        note: 'Ravi checked that orders keep no card or TWINT data beyond the order id. Still to check: the server logs and the TWINT callback.',
      },
    ],
  },
  {
    id: 't-18', title: 'Apple Pay at pickup', owner: 'twint-payments-engineer', askedBy: 'web-lead', status: 'dropped', milestone: 'ms-pickup', parent: 't-10', files: ['src/pay/apple-pay.ts'],
    outcome: 'Dropped: TWINT covers mobile payments here, and cards wait for your answer.', created: 180, updated: 160,
    cancel: { ago: 160, by: STAKEHOLDER, reason: 'TWINT covers mobile payments here, and cards wait for my answer.', branch: 'worklings/t-18-apple-pay-at-pickup' },
  },
  {
    id: 't-19', title: 'Pickup flow from menu to counter', owner: 'ux-designer', askedBy: 'head-of-design', status: 'working', milestone: 'ms-pickup', files: ['docs/pickup-flow.md'],
    brief: "Map the guest's way from the menu to collecting at the counter, with every state on the way.", doneWhen: 'The flow covers ordering, paying, waiting and collecting, errors included.',
    created: 210, updated: 22, planTask: 'p-7', priority: 9,
  },
  {
    id: 't-20', title: 'Order status page', owner: 'frontend-engineer', askedBy: 'web-lead', status: 'done', milestone: 'ms-pickup', parent: 't-10', files: ['src/pickup/Status.tsx'],
    outcome: 'Order status page checks every 10 s and shows Ready in big type.', commit: '7a8b9c0', created: 160, updated: 40,
  },
  {
    id: 't-21', title: 'Opening hours and pickup times', owner: 'backend-engineer', askedBy: 'web-lead', status: 'done', milestone: 'ms-pickup', parent: 't-10', files: ['src/data/hours.ts'],
    outcome: 'Opening hours per weekday, with holidays, drive which slots exist.', commit: '8b9c0d1', created: 165, updated: 90,
  },
  {
    id: 't-22', title: 'Design review of the pickup pages', owner: 'head-of-design', askedBy: 'ceo', status: 'working', milestone: 'ms-pickup',
    brief: "Review every pickup page against the menu's look and the pickup flow.", doneWhen: 'Every pickup page passes the review or has its fixes listed.',
    created: 60, updated: 9, planTask: 'p-11', priority: 11,
  },
  {
    id: 't-23', title: 'Checkout plan: payment and confirmation', owner: 'web-lead', askedBy: 'head-of-engineering', status: 'working', milestone: 'ms-pickup', parent: 't-10',
    created: 200, updated: 11, priority: 6,
  },
  {
    id: 't-24', title: 'Darker palette across the site', owner: 'ui-designer', askedBy: 'head-of-design', status: 'queued', milestone: null, files: ['src/styles/tokens.css'],
    brief: 'From the stakeholder: the menu feels washed out on phones. Darken the text and buttons toward espresso brown; keep 4.5:1 contrast.', created: 9, updated: 9,
    priority: 12, cites: ['m-5'],
  },
  {
    id: 't-25', title: 'Slot picker visuals', owner: 'ui-designer', askedBy: 'head-of-design', status: 'working', milestone: 'ms-pickup', files: ['src/styles/pickup.css'],
    brief: "Big, friendly slot buttons in the café's colours, with full slots greyed out.", doneWhen: "The slot picker matches the menu's look at 375 px.",
    created: 70, updated: 5, planTask: 'p-10', priority: 10, paused: { ago: 5, by: STAKEHOLDER },
  },
  {
    id: 't-30', title: 'Bilingual menu copy plan', owner: 'head-of-content', askedBy: 'ceo', status: 'working', milestone: 'ms-launch', files: ['content/plan.md'],
    brief: 'Plan which copy is written first, in which language, and who reads it.', doneWhen: 'Every page has its copy owner and a date.',
    created: 100, updated: 14, planTask: 'p-12', priority: 14,
  },
  {
    id: 't-31', title: 'German pastry descriptions', owner: 'german-copywriter', askedBy: 'head-of-content', status: 'working', milestone: 'ms-launch', files: ['content/de/pastries.md'],
    brief: 'Describe the pastry case in German, in Swiss spelling.', doneWhen: 'Every pastry in the case has a German description.',
    created: 90, updated: 7, planTask: 'p-13', priority: 15,
  },
  {
    id: 't-34', title: 'Deploy previews', owner: 'devops-engineer', askedBy: 'head-of-engineering', status: 'working', milestone: 'ms-launch', files: ['.github/workflows/preview.yml'],
    brief: 'A preview link for every branch, so anyone can check a change on a phone.', doneWhen: 'Every branch gets a preview link within five minutes of a push.',
    created: 80, updated: 25, planTask: 'p-14', priority: 16,
  },
];

function task(seed: TaskSeed, now: number): Task {
  return {
    id: seed.id,
    title: seed.title,
    brief: seed.brief ?? `${seed.title}.`,
    owner: seed.owner,
    askedBy: seed.askedBy,
    files: seed.files ?? [],
    doneWhen: seed.doneWhen ?? 'Its owner reports it done and their manager accepts it.',
    status: seed.status,
    outcome: seed.outcome ?? null,
    parent: seed.parent ?? null,
    milestone: seed.milestone,
    worktree: seed.worktree ?? null,
    commit: seed.commit ?? null,
    createdAt: now - seed.created * MIN,
    updatedAt: now - seed.updated * MIN,
    ...(seed.priority !== undefined ? { priority: seed.priority } : {}),
    paused: seed.paused ? { at: now - seed.paused.ago * MIN, by: seed.paused.by } : null,
    cancel: seed.cancel ? { at: now - seed.cancel.ago * MIN, by: seed.cancel.by, reason: seed.cancel.reason, branch: seed.cancel.branch } : null,
    handovers: (seed.handovers ?? []).map(({ ago, ...h }) => ({ ...h, at: now - ago * MIN })),
    planTask: seed.planTask ?? null,
    cites: seed.cites ?? [],
  };
}

/**
 * Who, minutes ago, what, the task and the messages it follows up. Each person's newest line is their status; earlier
 * ones give the Timeline something to fold.
 */
const CAFE_STATUSES: [string, number, string, string | null, string[]?][] = [
  ['office-manager', 1430, 'Set the office up as a café.', null],
  ['brand-designer', 300, 'Done with the menu icons.', null],
  ['frontend-engineer', 45, 'The slot picker renders on phones.', 't-11'],
  ['ceo', 44, 'Revised the plan: version 3 waits for your approval.', null, ['m-13']],
  ['local-seo-specialist', 40, 'The menu page is indexed; done for now.', 't-4'],
  ['frontend-engineer', 36, 'Taking your note: one row of big buttons for one thumb.', 't-11', ['m-2']],
  ['head-of-design', 33, 'Checking the pickup pages against the chalkboard look.', 't-22', ['m-21']],
  ['devops-engineer', 30, 'Setting up deploy previews for every branch.', 't-34'],
  ['frontend-engineer', 31, 'Wiring the slot picker to the order store.', 't-11'],
  ['ux-designer', 22, 'Mapping the pickup flow from menu to counter.', 't-19'],
  ['qa-engineer', 15, 'Blocked until the order API exists.', 't-15'],
  ['head-of-content', 14, 'Planning the German and English menu copy.', 't-30'],
  ['web-lead', 11, 'Splitting checkout into payment and confirmation.', 't-23'],
  ['head-of-design', 9, 'Passing your palette note to Mina.', 't-22', ['m-5']],
  ['ui-designer', 8, 'Trying espresso brown for the text and buttons.', 't-24', ['m-5']],
  ['german-copywriter', 7, 'Writing the German pastry descriptions.', 't-31'],
  ['ui-designer', 6, 'Asked you how long pickup windows should be.', 't-25'],
  ['twint-payments-engineer', 4, 'Stuck on the TWINT sandbox: it turns down the test merchant ID.', 't-13'],
  ['head-of-engineering', 4, "Reviewing Kai's cart summary.", 't-16'],
  ['ceo', 2, 'Waiting for your answer on card payments.', null],
  ['backend-engineer', 2, 'Ready to start on the order API.', 't-12'],
  ['security-reviewer', 0.3, 'Starting the payment data review.', 't-17'],
];

/** Steering's fields on a message: its audience, who it is for, how it was taken and what it follows up. */
type MessageSteer = Partial<Pick<Message, 'audience' | 'for' | 'deliveredHow' | 'cites'>>;

function message(
  id: string, from: string, to: string, text: string, ago: number, delivered: number | null, now: number,
  relay?: { origin: string; of: string; note: string | null } | null, steer: MessageSteer = {},
): Message {
  return {
    id, from, to, text,
    origin: relay?.origin ?? null,
    relayOf: relay?.of ?? null,
    note: relay?.note ?? null,
    at: now - ago * MIN,
    deliveredAt: delivered === null ? null : now - delivered * MIN,
    interrupt: false,
    audience: steer.audience ?? null,
    for: steer.for ?? [],
    deliveredHow: delivered === null ? null : (steer.deliveredHow ?? null),
    cites: steer.cites ?? [],
  };
}

const NEXT: MessageSteer = { deliveredHow: 'next-step' };
const NEW: MessageSteer = { deliveredHow: 'new-turn' };

/** The design room's message, the all-hands and Clara's to her team: one copy per person, each naming the audience. */
const DESIGN_ROOM: Audience = { kind: 'room', id: 'design', title: 'the design room', group: 'g-1' };
const ALL_HANDS: Audience = { kind: 'everyone', id: null, title: 'everyone', group: 'g-2' };
const CLARAS_TEAM: Audience = { kind: 'team', id: 'head-of-content', title: "Clara's team", group: 'g-3' };

/** Who had a turn running when the all-hands arrived 55 minutes ago (they took it at their next step). */
const BUSY_AT_ALL_HANDS = new Set(['head-of-design', 'ux-designer', 'head-of-engineering', 'web-lead', 'frontend-engineer', 'twint-payments-engineer', 'devops-engineer', 'head-of-content', 'german-copywriter']);

/** The all-hands copies: everyone but Elif, hired after it. Yara had no desk yet, so hers waits for her first turn. */
const allHandsCopies = (now: number): Message[] =>
  CAFE_SEATS.filter((s) => s.id !== 'accessibility-specialist').map((s, i) => {
    const delivered = s.id === 'security-reviewer' ? null : 54;
    return message(`m-${25 + i}`, STAKEHOLDER, s.id, 'Thank you all: the menu is live and the café loves it. Pickup orders are next, then the launch on 17 November.', 55, delivered, now, null, {
      audience: ALL_HANDS, ...(BUSY_AT_ALL_HANDS.has(s.id) ? NEXT : NEW),
    });
  });

function cafeMessages(now: number): Message[] {
  const room = 'The café\'s owner loves the chalkboard look. Keep the hand-drawn feel in the pickup pages too.';
  const team = 'German first, then English: the native speaker reads both on Thursday.';
  return [
    message('m-1', 'ceo', STAKEHOLDER, 'Menu pages are live on the work branch. Pickup orders are next: Theo has the slot picker and the TWINT payment in progress.', 180, 180, now),
    message('m-2', STAKEHOLDER, 'frontend-engineer', 'Please make the slot picker work with one thumb.', 40, 39, now, null, NEXT),
    message('m-3', 'web-lead', 'frontend-engineer', 'Slot picker first, then the cart summary.', 38, 37, now, null, NEXT),
    message('m-4', 'frontend-engineer', STAKEHOLDER, 'Done: the slots are one row of big buttons now, and the row scrolls sideways.', 25, 25, now, null, { cites: ['m-2'] }),
    // "For Mina": the stakeholder named who it is for, and it reached her through Ada.
    message('m-5', STAKEHOLDER, 'ceo', 'Make the palette darker. The menu feels washed out on phones.', 14, 13, now, null, { ...NEW, for: ['ui-designer'] }),
    message('m-6', 'ceo', 'head-of-design', 'Make the palette darker. The menu feels washed out on phones.', 12, 11, now, { origin: STAKEHOLDER, of: 'm-5', note: 'Please take this through design.' }, NEXT),
    message('m-7', 'head-of-design', 'ui-designer', 'Make the palette darker. The menu feels washed out on phones.', 10, 9, now, { origin: STAKEHOLDER, of: 'm-5', note: 'Try a deeper espresso brown for the text and the buttons.' }, NEW),
    message('m-8', 'ceo', STAKEHOLDER, 'Ada and Mina have your palette note. Mina will share a screenshot before it lands.', 9, 9, now, null, { cites: ['m-5'] }),
    message('m-9', 'ui-designer', 'head-of-design', 'Got it. I will try espresso brown at 4.5:1 and share a screenshot.', 8, 8, now, null, { ...NEXT, cites: ['m-7'] }),
    message('m-10', 'twint-payments-engineer', 'web-lead', 'The sandbox turns down the test merchant ID. Do we have the real one from the café?', 4, 4, now, null, NEXT),
    message('m-11', STAKEHOLDER, 'backend-engineer', 'Keep the order API simple: no accounts, just a name and a phone number.', 2, null, now),
    message('m-12', THE_OFFICE, 'devops-engineer', 'Handed over to you in Claude Code.', 25, 25, now),
    // The plan: "revise it", the CEO's answer with version 3, and the comments that went to the CEO as messages.
    message('m-13', STAKEHOLDER, 'ceo', 'Revise it, please: add loyalty stamps after the launch, and take my comments into the plan.', 48, 47.5, now, null, NEW),
    message('m-14', 'ceo', STAKEHOLDER, CEO_PLAN_REPORT, 44, 44, now, null, { cites: ['m-13'] }),
    message('m-15', STAKEHOLDER, 'ceo', 'On the plan: keep the reopening date in every version. The café reopens on Monday 17 November.', 1515, 1515, now, null, NEW),
    message('m-16', STAKEHOLDER, 'ceo', 'On the milestone “Launch in German and English”: launch only after a native speaker has read both languages, the order confirmation included.', 186, 185.5, now, null, NEXT),
    message('m-17', STAKEHOLDER, 'ceo', "On the task “Printed table cards with a QR code”: the café prints its own table cards, so we don't need these.", 50, 49.5, now, null, NEW),
    // The leash by talking: the CEO set it, citing this message.
    message('m-18', STAKEHOLDER, 'ceo', 'Lena checks with me before each task from now on. I want to read the German before more of it lands.', 70, 69.5, now, null, NEW),
    // For Mina, sent to Ada, who has neither passed it on nor acknowledged it: the trace flags where it stalls.
    message('m-19', STAKEHOLDER, 'head-of-design', 'For Mina: the logo needs a light version for the dark menu board.', 24, 23, now, null, { ...NEXT, for: ['ui-designer'] }),
    // Reconsider: the decision goes back to Ines with your note, citing it.
    message('m-20', STAKEHOLDER, 'web-lead', `Please reconsider: “${CHECKOUT_DECISION}” One page would be quicker on a phone. Can payment and confirmation share a screen?`, 12, 11.5, now, null, { ...NEXT, cites: ['d-20'] }),
    message('m-21', STAKEHOLDER, 'head-of-design', room, 35, 34, now, null, { audience: DESIGN_ROOM, ...NEXT }),
    message('m-22', STAKEHOLDER, 'ui-designer', room, 35, 35, now, null, { audience: DESIGN_ROOM, ...NEW }),
    message('m-23', STAKEHOLDER, 'ux-designer', room, 35, 33, now, null, { audience: DESIGN_ROOM, ...NEXT }),
    message('m-24', STAKEHOLDER, 'brand-designer', room, 35, 34, now, null, { audience: DESIGN_ROOM, ...NEW }),
    ...allHandsCopies(now),
    message('m-42', 'head-of-content', 'german-copywriter', team, 26, 25.5, now, null, { audience: CLARAS_TEAM, ...NEXT }),
    message('m-43', 'head-of-content', 'local-seo-specialist', team, 26, 25.5, now, null, { audience: CLARAS_TEAM, ...NEW }),
  ];
}

function cafeQuestions(now: number): Question[] {
  return [
    {
      id: 'q-1', from: 'head-of-content', text: 'Should the menu use Swiss spellings, with ss where Germany writes ß?', options: ['Swiss spellings', 'Standard German'], recommended: 0,
      taskId: 't-3', askedAt: now - 60 * MIN, answer: { option: 0, text: 'Swiss spellings', at: now - 55 * MIN, appliesAt: now - 55 * MIN + UNDO_MS }, withdrawn: null,
    },
    {
      id: 'q-2', from: 'devops-engineer', text: 'Deploy previews to Cloudflare Pages or to Netlify?', options: ['Cloudflare Pages', 'Netlify'], recommended: 0, taskId: 't-34',
      askedAt: now - 28 * MIN, answer: null, withdrawn: { reason: 'Marco was handed over to you in Claude Code.', at: now - 25 * MIN },
    },
    {
      id: 'q-3', from: 'ui-designer',
      text: 'Pickup slots: should guests pick from 15-minute or 30-minute windows? Shorter windows spread the morning rush, but the counter needs someone free every quarter hour. The café opens at 7:00 and most orders come before 9:00.',
      options: ['15-minute windows', '30-minute windows'], recommended: 0, taskId: 't-11', askedAt: now - 6 * MIN, answer: null, withdrawn: null,
    },
    {
      id: 'q-4', from: 'ceo', text: 'Should guests be able to pay by card as well as with TWINT? Cards add a Stripe account and its fees.',
      options: ['TWINT only', 'TWINT and cards', 'TWINT, cards and cash at pickup'], recommended: 1, taskId: 't-13', askedAt: now - 2 * MIN, answer: null, withdrawn: null,
    },
    // Lena checks with you before each task, so the office holds her next one here until you say start (option 0
    // starts it). It asks in the real company's words (gateFor in src/company/board.ts) and recommends neither.
    {
      id: 'q-5', from: THE_OFFICE, text: 'Lena would like to start “Order confirmation in both languages”. Start it, or hold it until you resume it?',
      options: ['Start it', 'Not now'], recommended: null, taskId: 't-14', askedAt: now - 66 * MIN, answer: null, withdrawn: null, gate: { task: 't-14' },
    },
  ].map((q): Question => ({ gate: null, ...q }));
}

function cafeApprovals(now: number): Approval[] {
  return [
    {
      id: 'a-1', person: 'twint-payments-engineer', tool: 'Bash', summary: 'Call the TWINT sandbox API', detail: 'curl -X POST https://api.sandbox.twint.ch/v2/payments -H "Authorization: Bearer ****"',
      kind: 'paid-api', askedAt: now - 50 * MIN, expiresAt: now - 40 * MIN, alwaysRule: null,
      answer: { decision: 'allow', always: false, at: now - 48 * MIN, appliesAt: now - 48 * MIN + UNDO_MS, note: null }, withdrawn: null,
    },
    {
      id: 'a-2', person: 'backend-engineer', tool: 'Bash', summary: 'Install a command-line tool for the whole computer', detail: 'npm install --global wrangler',
      kind: 'global-config', askedAt: now - 70 * MIN, expiresAt: now - 60 * MIN, alwaysRule: null, answer: null,
      withdrawn: { reason: 'Timed out, so Noah was told no.', at: now - 60 * MIN },
    },
    {
      id: 'a-3', person: 'frontend-engineer', tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push origin worklings/cafe-lumen', kind: 'push',
      askedAt: now - 3 * MIN, expiresAt: now + 12 * MIN, alwaysRule: { rule: 'Bash(git push origin:*)', sentence: 'any git push to origin' }, answer: null, withdrawn: null,
    },
    {
      id: 'a-4', person: 'head-of-engineering', tool: 'Bash', summary: 'Delete the merged branch worklings/menu-pages', detail: 'git branch -D worklings/menu-pages', kind: 'branch-delete',
      askedAt: now - 1 * MIN, expiresAt: now + 14 * MIN, alwaysRule: null, answer: null, withdrawn: null,
    },
  ];
}

function cafeReports(now: number): Report[] {
  const report = (id: string, person: string, to: string, taskId: string | null, outcome: Report['outcome'], text: string, ago: number, cites: string[] = []): Report => ({
    id, person, to, taskId, outcome, text, at: now - ago * MIN, cites,
  });
  return [
    report('r-1', 'ui-designer', 'head-of-design', 't-1', 'done', 'Menu page layout is done: coffee, pastries and lunch sections, readable from 320 px. 3 files changed.', 230),
    report('r-2', 'ceo', STAKEHOLDER, null, 'progress', 'Menu pages are live on the work branch. Pickup orders are next: Theo has the slot picker and the TWINT payment in progress.', 180),
    report('r-8', 'ceo', STAKEHOLDER, null, 'progress', CEO_PLAN_REPORT, 44, ['m-13']),
    report('r-3', 'frontend-engineer', 'web-lead', 't-20', 'done', 'Order status page is done: it checks every 10 s and shows Ready in big type. 3 files changed.', 40),
    report('r-4', 'local-seo-specialist', 'head-of-content', 't-4', 'done', "Google business profile and the menu's schema.org markup are in, and Search Console shows the menu page indexed.", 40),
    report('r-5', 'qa-engineer', 'head-of-engineering', 't-15', 'blocked', 'Blocked: the end-to-end test needs the order API, and Noah waits for a desk.', 15),
    report('r-6', 'frontend-engineer', 'web-lead', 't-16', 'progress', 'Cart summary is ready for review: items, pickup time and the total in francs.', 6),
    report('r-7', 'twint-payments-engineer', 'web-lead', 't-13', 'blocked', "Stuck: the TWINT sandbox turns down the test merchant ID. I need the café's real sandbox ID.", 4),
  ];
}

function cafeLog(now: number): LogEntry[] {
  const at = (minutes: number) => now - minutes * MIN;
  return [
    { at: at(26 * 60), kind: 'founded', by: STAKEHOLDER, text: 'You started Café Lumen.' },
    { at: at(25.8 * 60), kind: 'proposal', by: 'ceo', text: 'The CEO proposed an org of 17 people in five rooms.' },
    { at: at(25.6 * 60), kind: 'proposal-edited', by: STAKEHOLDER, text: 'You moved the QA engineer to Quality.' },
    { at: at(25.5 * 60), kind: 'started', by: STAKEHOLDER, text: 'You started the company. Everyone walked in.' },
    { at: at(25.4 * 60), kind: 'goal', by: 'ceo', text: 'The CEO set the goal: guests order online, pay with TWINT and pick up at the counter.' },
    { at: at(25 * 60), kind: 'office', by: 'office-manager', text: 'Otto made the office a café.' },
    { at: at(22 * 60), kind: 'rest', by: THE_OFFICE, text: 'The company rested until 02:00: your plan’s limit was reached.' },
    { at: at(19 * 60), kind: 'wake', by: THE_OFFICE, text: 'The company woke up and carried on.' },
    { at: at(6 * 60), kind: 'hire', by: 'ceo', text: 'The CEO hired Lena, German copywriter.' },
    { at: at(5.5 * 60), kind: 'fire', by: 'ceo', text: 'The CEO let Sam, social media manager, go: nobody posts until launch.' },
    { at: at(3 * 60), kind: 'milestone', by: THE_OFFICE, text: 'Milestone done: Menu pages live.' },
    { at: at(2 * 60), kind: 'pause', by: STAKEHOLDER, text: 'You paused work.' },
    { at: at(1.8 * 60), kind: 'resume', by: STAKEHOLDER, text: 'You resumed work.' },
    { at: at(68), kind: 'settings', by: 'ceo', text: 'The CEO set Lena to check with you before each task, as you asked.' },
    { at: at(40), kind: 'hire', by: 'ceo', text: 'The CEO hired Elif, accessibility specialist.' },
    { at: at(30), kind: 'dashboard', by: 'ceo', text: 'The CEO published the dashboard “Launch checklist”.' },
    { at: at(25), kind: 'hand-over', by: STAKEHOLDER, text: 'You opened Marco in Claude Code.' },
    { at: at(20), kind: 'settings', by: STAKEHOLDER, text: 'You set eight desks at once.' },
  ];
}

function cafeDashboards(now: number): Dashboard[] {
  return [
    {
      id: 'launch-checklist',
      title: 'Launch checklist',
      by: 'ceo',
      publishedAt: now - 30 * MIN,
      widgets: [
        { kind: 'stat', title: 'Days to the reopening', value: 12, unit: 'days', note: 'The café reopens on Monday 17 November.' },
        { kind: 'progress', title: 'Launch tasks done', value: 9, max: 14, note: 'Pickup orders and the language check are left.' },
        { kind: 'bars', title: 'Open tasks by room', bars: [{ label: 'Engineering', value: 7 }, { label: 'Design', value: 3 }, { label: 'Content', value: 4 }, { label: 'Quality', value: 1 }] },
        {
          kind: 'line', title: 'Test orders per day', unit: 'orders',
          points: [{ label: 'Mon', value: 0 }, { label: 'Tue', value: 3 }, { label: 'Wed', value: 8 }, { label: 'Thu', value: 14 }, { label: 'Fri', value: 21 }],
        },
        { kind: 'list', title: 'Before launch', items: ['Real TWINT merchant ID from the café', 'Photos from the café', 'A native speaker reads the German copy', 'Opening hours for the holidays'] },
        {
          kind: 'table', title: 'Payment options', columns: ['Option', 'Fee', 'State'],
          rows: [['TWINT', '1.3%', 'In progress'], ['Cards', '2.9% + 30 rp', 'Waiting for your answer'], ['Cash', 'None', 'At the counter']],
        },
      ],
    },
  ];
}

/** The spending plan's settings a demo company runs on: a preset, its models, and the caps when it has any. */
const spendingSettings = (preset: PresetId, budget: { company: number | null; person: number | null } = { company: null, person: null }) => ({ preset, models: presetModels(preset), budget });

/** Two made-up installed servers, so the proposal's multi-select has something to show in the demo. */
const DEMO_CATALOGUE = { mcp: [{ name: 'docs-lookup', summary: 'Look up current library documentation; from a docs plugin, runs over the web', kind: 'remote' as const }, { name: 'browser-tools', summary: 'Drive and inspect a browser page; from a browser plugin, runs on this machine', kind: 'local' as const }], skills: 3 };

/** The view's `spending`, worked out from what the view shows, as the hub does from the company's state. */
function withSpending(view: CompanyView, now: number): CompanyView {
  const spentBy: Record<string, number> = {};
  for (const p of view.spend.byPerson) spentBy[p.person] = p.all;
  view.spending = spendingViewOf({
    settings: view.settings,
    phase: view.phase,
    proposal: view.proposal,
    people: view.people.map((p) => ({ id: p.id, level: p.level, model: p.model })),
    planTasks: view.tasks.length > 0 ? view.tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped').length : null,
    spentBy,
    samples: view.spend.samples,
    now,
    modelOverride: null,
    presetQuestion: null,
    loads: view.phase === 'proposed' && view.proposal ? proposalLoadCosts(view.proposal) : null,
    catalogue: DEMO_CATALOGUE,
  });
  return view;
}

const CAFE_COSTS: Record<string, number> = {
  ceo: 6.84, 'office-manager': 0.21, 'head-of-design': 2.96, 'ui-designer': 3.42, 'ux-designer': 2.18, 'brand-designer': 0.94, 'head-of-engineering': 5.73,
  'web-lead': 3.05, 'frontend-engineer': 4.66, 'backend-engineer': 2.37, 'twint-payments-engineer': 2.81, 'devops-engineer': 1.12, 'security-reviewer': 0.08,
  'head-of-content': 1.64, 'german-copywriter': 0.86, 'local-seo-specialist': 0.47, 'qa-engineer': 0.93, 'accessibility-specialist': 0,
};

/** Spend that adds up: each person's samples today, hours over the week since the company started, and the totals. */
function spendFor(costs: Record<string, number>, founded: number, now: number, seed: string, resting: { from: number; to: number } | null): SpendView {
  const rand = seeded(hashText(seed));
  const ids = Object.keys(costs);
  const byPerson = ids.map((person) => {
    const all = costs[person] ?? 0;
    return { person, all, week: all, today: cents(all * 0.55) };
  });
  // Turns over the last eight hours for the people who worked today, a few cents each.
  const samples: SpendView['samples'] = [];
  for (const p of byPerson) {
    if (p.today <= 0) continue;
    const turns = Math.max(1, Math.round(p.today / 0.12));
    for (let i = 0; i < turns; i++) samples.push({ person: p.person, at: now - Math.floor(rand() * 8 * HOUR), cost: cents(p.today / turns) });
  }
  samples.sort((a, b) => a.at - b.at);
  const total = byPerson.reduce((s, p) => s + p.all, 0);
  const startHour = Math.floor(now / HOUR) * HOUR - 167 * HOUR;
  const weights = Array.from({ length: 168 }, (_, i) => {
    const hour = startHour + i * HOUR;
    if (hour + HOUR <= founded) return 0;
    if (resting && hour >= resting.from && hour < resting.to) return 0;
    return 0.4 + rand();
  });
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const hourly = weights.map((w, i) => ({ hour: startHour + i * HOUR, cost: cents((w / sum) * total) }));
  return { samples: samples.slice(-500), hourly, byPerson };
}

function deskOf(company: string, person: string, d: { state: DeskState; ago: number; context: number | null; problem?: string; queue?: number }, now: number): DeskView {
  const worked = d.context !== null;
  return {
    person,
    state: d.state,
    sessionId: worked ? sessionOf(company, person) : null,
    since: now - d.ago * MIN,
    context: d.context,
    problem: d.problem ?? null,
    queue: d.queue ?? null,
  };
}

function peopleOfSeats(company: string, seats: Seat[], desks: typeof CAFE_DESKS, statuses: StatusLine[], costs: Record<string, number>, now: number): PersonView[] {
  return seats.map((s) => {
    const d = desks[s.id] ?? { state: 'closed', ago: 60, task: null, context: null };
    const desk = deskOf(company, s.id, d, now);
    const status = statuses.filter((l) => l.person === s.id).reduce<StatusLine | null>((latest, l) => (!latest || l.at > latest.at ? l : latest), null);
    return {
      id: s.id,
      name: s.name,
      title: s.title,
      level: s.level,
      room: s.room,
      reportsTo: s.reportsTo,
      look: s.look ?? {},
      model: s.model,
      desk,
      task: d.task,
      status,
      agentKey: desk.sessionId ? `${desk.sessionId}:lead` : null,
      cost: costs[s.id] ?? 0,
    };
  });
}

const deskCounts = (people: PersonView[], max: number) => ({
  working: people.filter((p) => p.desk.state === 'working' || p.desk.state === 'starting' || p.desk.state === 'stopping').length,
  waiting: people.filter((p) => p.desk.state === 'waiting').length,
  max,
});

const inboxOf = (view: Pick<CompanyView, 'questions' | 'approvals' | 'phase' | 'proposal' | 'steering'>) =>
  view.questions.filter((q) => !q.answer && !q.withdrawn).length +
  view.approvals.filter((a) => !a.answer && !a.withdrawn).length +
  (view.phase === 'proposed' && view.proposal ? 1 : 0) +
  // A plan that waits for approval counts as the live office counts it (src/company/view.ts).
  (view.steering?.plan && view.phase !== 'founding' && view.phase !== 'proposed' ? planInbox(view.steering.plan, view.steering.settings) : 0);

// ---------------------------------------------------------------------------------------------------------------
// Steering (src/core/steering.ts): the plan, audiences and acknowledgements, the board, the decision log, the leash

const CEO_PLAN_REPORT =
  'Version 3 of the plan is ready: loyalty stamps after the launch, no table cards, the native speaker also reads the order confirmation, and deploy previews come first. It needs your approval.';
const CHECKOUT_DECISION = 'Checkout is two steps: pay with TWINT, then a confirmation screen.';

/** A plan task made from one of the café's tasks, so the two agree on title, owner, files, milestone and brief. */
function fromSeed(id: string, seedId: string, after: string[] = []): PlanTask {
  const seed = CAFE_TASKS.find((t) => t.id === seedId);
  if (!seed?.milestone) throw new Error(`The demo's plan has no task ${seedId} with a milestone.`);
  const t = task(seed, 0);
  return { id, title: t.title, owner: t.owner, files: t.files, milestone: seed.milestone, after, brief: t.brief, doneWhen: t.doneWhen };
}

const P1 = fromSeed('p-1', 't-1');
const P2 = fromSeed('p-2', 't-2');
const P3 = fromSeed('p-3', 't-3', ['p-2']);
const P4 = fromSeed('p-4', 't-6', ['p-3']);
const P5 = fromSeed('p-5', 't-4', ['p-1']);
const P6 = fromSeed('p-6', 't-5');
const P7 = fromSeed('p-7', 't-19');
const P8 = fromSeed('p-8', 't-10', ['p-2']);
const P9 = fromSeed('p-9', 't-14', ['p-8']);
const P10 = fromSeed('p-10', 't-25');
const P11 = fromSeed('p-11', 't-22');
const P12 = fromSeed('p-12', 't-30');
const P13 = fromSeed('p-13', 't-31');
const P14 = fromSeed('p-14', 't-34');
const P15: PlanTask = {
  id: 'p-15', title: 'Native speaker read-through', owner: 'head-of-content', files: ['content/review.md'], milestone: 'ms-launch', after: ['p-13'],
  brief: 'A native speaker reads the German and English pages and lists what to fix.', doneWhen: 'The fixes are in, and the reader signed off both languages.',
};
const P16: PlanTask = {
  id: 'p-16', title: 'Printed table cards with a QR code', owner: 'brand-designer', files: ['public/print/'], milestone: 'ms-launch', after: ['p-12'],
  brief: 'A card for each table with a QR code to the menu.', doneWhen: 'The print file is ready for the printer.',
};
const P17: PlanTask = {
  id: 'p-17', title: 'Loyalty stamp card', owner: 'frontend-engineer', files: ['src/stamps/'], milestone: 'ms-stamps', after: ['p-18'],
  brief: 'A stamp with each pickup order, shown on the order status page; the tenth coffee is free.', doneWhen: 'A guest who orders ten times gets the tenth coffee free.',
};
const P18: PlanTask = {
  id: 'p-18', title: 'Go live', owner: 'devops-engineer', files: ['.github/workflows/deploy.yml'], milestone: 'ms-launch', after: ['p-14', 'p-15'],
  brief: "Put the site live on the café's own domain.", doneWhen: 'cafe-lumen.ch shows the site in German and English.',
};
const MS_STAMPS: PlanMilestone = { id: 'ms-stamps', title: 'Loyalty stamps', doneWhen: 'A guest collects a stamp with each pickup, and the tenth coffee is free.' };

/** Version 1, the CEO's: the English menu waited for the launch. */
const CAFE_PLAN_1: Plan = {
  goal: CAFE_GOAL_TEXT, milestones: CAFE_MILESTONES,
  tasks: [P1, P2, P3, P5, P6, P7, P8, P9, P10, P11, { ...P4, milestone: 'ms-launch' }, P12, P13, P15, P14, P16, P18],
};
/** Version 2, your edit: the English menu moved into the first milestone. Approved through the launch. */
const CAFE_PLAN_2: Plan = { goal: CAFE_GOAL_TEXT, milestones: CAFE_MILESTONES, tasks: [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P15, P14, P16, P18] };
/**
 * Version 3, the CEO's answer to "revise it": loyalty stamps added (a milestone and a task), the table cards cut, the
 * read-through changed to take in the order confirmation, and deploy previews moved to the front of the launch.
 */
const CAFE_PLAN_3: Plan = {
  goal: CAFE_GOAL_TEXT,
  milestones: [...CAFE_MILESTONES, MS_STAMPS],
  tasks: [
    P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P14, P12, P13,
    {
      ...P15, title: 'A native speaker reads both languages', after: ['p-13', 'p-9'],
      brief: 'A native speaker reads the German and English pages and the order confirmation, and lists what to fix.',
    },
    P18, P17,
  ],
};

/**
 * v0.2: what the stakeholder asked for, as checkable sentences quoting their words (the prompt, a typed comment, the
 * message asking for loyalty stamps), with the plan tasks that cover each. A plan keeps the items its tasks cover, so
 * version 3's stamps item is its own, and every task covers at least one item, as the linter asks.
 */
const CAFE_CHECKLIST: ChecklistItem[] = [
  { id: 'k-1', text: 'The website is in German and English.', quote: 'A bilingual website', covers: ['p-3', 'p-4', 'p-12', 'p-13', 'p-15'] },
  { id: 'k-2', text: 'Guests can read the menu of coffee and pastries, with prices.', quote: 'coffee and pastries', covers: ['p-1', 'p-2', 'p-5', 'p-6'] },
  { id: 'k-3', text: 'Guests order online for pickup and see when it is ready.', quote: 'guests order coffee and pastries for pickup', covers: ['p-7', 'p-8', 'p-10', 'p-11'] },
  { id: 'k-4', text: 'Guests pay with TWINT.', quote: 'pay with TWINT', covers: ['p-8'] },
  { id: 'k-5', text: 'A native speaker has read both languages, the order confirmation included.', quote: 'Launch only after a native speaker has read both languages, the order confirmation included.', covers: ['p-9', 'p-15'] },
  { id: 'k-6', text: 'The site is live for Café Lumen in Basel.', quote: 'for Café Lumen in Basel', covers: ['p-14', 'p-16', 'p-18'] },
  { id: 'k-7', text: "A guest's tenth coffee is free with loyalty stamps.", quote: 'add loyalty stamps after the launch', covers: ['p-17'] },
];

/** A plan with the checklist items its tasks cover, each item's covers kept to the tasks it has. */
function withCafeChecklist(plan: Plan): Plan {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const checklist = CAFE_CHECKLIST.map((k) => ({ ...k, covers: k.covers.filter((id) => ids.has(id)) })).filter((k) => k.covers.length > 0);
  return { ...structuredClone(plan), checklist };
}

function cafePlan(now: number): PlanView {
  const at = (minutes: number) => now - minutes * MIN;
  return {
    versions: [
      { version: 1, by: 'ceo', at: at(1518), plan: withCafeChecklist(CAFE_PLAN_1), note: 'Menu pages first, then pickup orders, then the launch in German and English.', cites: [] },
      { version: 2, by: STAKEHOLDER, at: at(1509), plan: withCafeChecklist(CAFE_PLAN_2), note: 'The English menu moves into the first milestone: guests from abroad read the menu too.', cites: [] },
      {
        version: 3, by: 'ceo', at: at(44), plan: withCafeChecklist(CAFE_PLAN_3), cites: ['m-13'],
        note: 'Loyalty stamps after the launch; no table cards, as you said; the native speaker also reads the order confirmation; deploy previews first, so they can read on a phone.',
      },
    ],
    approved: { version: 2, through: 'ms-launch', at: at(170), by: STAKEHOLDER, cites: [] },
    comments: [
      { id: 'c-1', at: at(1515), by: STAKEHOLDER, version: 1, on: { kind: 'plan' }, text: 'Keep the reopening date in every version. The café reopens on Monday 17 November.', message: 'm-15' },
      {
        id: 'c-2', at: at(186), by: STAKEHOLDER, version: 2, on: { kind: 'milestone', id: 'ms-launch' }, message: 'm-16',
        text: 'Launch only after a native speaker has read both languages, the order confirmation included.',
      },
      { id: 'c-3', at: at(50), by: STAKEHOLDER, version: 2, on: { kind: 'task', id: 'p-16' }, text: "The café prints its own table cards, so we don't need these.", message: 'm-17' },
    ],
    waiting: null,
  };
}

/** Acknowledgements, oldest first: [their copy of the message, who, agrees, what they will do or why not, minutes ago]. */
const CAFE_ACKS: [string, string, boolean, string, number][] = [
  ['m-15', 'ceo', true, 'Every version keeps the 17 November reopening.', 1514.5],
  ['m-16', 'ceo', true, 'The launch waits for a native speaker, and the order confirmation goes into the read-through.', 185],
  ['m-18', 'ceo', true, 'Done: Lena checks with you before each task from now on.', 69],
  ['m-25', 'ceo', true, 'Shared with the heads: pickup first, then the launch on 17 November.', 53.5],
  ['m-27', 'head-of-design', true, 'Design stays on the pickup pages until they pass review.', 53.4],
  ['m-28', 'ui-designer', true, "Slot visuals next, in the menu's style.", 53.3],
  ['m-29', 'ux-designer', true, 'Mapping the pickup flow next.', 53.2],
  ['m-30', 'brand-designer', true, "I'll keep the menu icons in step with the pickup pages.", 53.1],
  ['m-31', 'head-of-engineering', true, 'Engineering is on pickup orders; launch work waits behind it.', 53],
  ['m-32', 'web-lead', true, 'Checkout is next for the web team.', 52.9],
  ['m-33', 'frontend-engineer', true, 'On the slot picker now.', 52.8],
  ['m-34', 'backend-engineer', true, 'The order API is next for me.', 52.7],
  ['m-35', 'twint-payments-engineer', true, 'TWINT payments are next.', 52.6],
  ['m-36', 'devops-engineer', true, 'Previews for every branch next, so you can check the launch on a phone.', 52.5],
  ['m-38', 'head-of-content', true, 'The German and English copy will be ready before 17 November.', 52.4],
  ['m-39', 'german-copywriter', true, 'Pastry descriptions next, in Swiss spelling.', 52.3],
  ['m-40', 'local-seo-specialist', true, "I'll put the pickup page on the Google profile once it's live.", 52.2],
  ['m-41', 'qa-engineer', true, "I'll test a whole pickup order once the order API is in.", 52.1],
  ['m-17', 'ceo', true, 'Cutting the table cards in the next version.', 49],
  ['m-13', 'ceo', true, 'Revising the plan now: stamps after the launch, and your comments in.', 47],
  ['m-2', 'frontend-engineer', true, 'Making the slots one row of big buttons for one thumb.', 38.5],
  ['m-3', 'frontend-engineer', true, 'Slot picker first, then the cart.', 36.8],
  ['m-22', 'ui-designer', true, 'Keeping the chalk texture on headings and buttons.', 34.5],
  ['m-21', 'head-of-design', true, "I'll check the pickup pages against the chalkboard look in my review.", 33.5],
  ['m-23', 'ux-designer', false, "The hand-drawn type is hard to read at small sizes: I'd keep it for headings and use the plain face for prices and times.", 32.5],
  ['m-42', 'german-copywriter', true, 'German first, then English.', 25],
  ['m-43', 'local-seo-specialist', true, "I'll have the German page titles ready for Thursday.", 24.5],
  ['m-5', 'ceo', true, 'Passing it to Ada for the design room; Mina will try espresso brown.', 12.6],
  ['m-20', 'web-lead', false, 'Two steps keep the cart safe if the switch to the TWINT app fails. I would keep them, but I will try one screen if you still want it.', 11],
  ['m-6', 'head-of-design', true, 'Giving it to Mina with a note on espresso brown.', 10.6],
  ['m-7', 'ui-designer', true, 'Darkening the text and buttons toward espresso brown at 4.5:1, with a screenshot before it lands.', 8.8],
];

const cafeAcks = (now: number): Ack[] => CAFE_ACKS.map(([message, by, agree, text, ago], i) => ({ id: `k-${i + 1}`, message, by, agree, text, at: now - ago * MIN }));

/** A decision as the log keeps it; `ago` in minutes. */
function decision(now: number, id: string, ago: number, by: string, kind: Decision['kind'], what: string, extra: Partial<Omit<Decision, 'id' | 'at' | 'by' | 'kind' | 'what'>> = {}): Decision {
  return { id, at: now - ago * MIN, by, kind, what, why: null, alternatives: [], people: [by], rooms: [], links: {}, reversible: false, undone: null, reconsider: null, ...extra };
}

/** Every kind of decision, oldest first: some reversible, one undone, one sent back to be reconsidered. */
function cafeDecisions(now: number): Decision[] {
  const d = (id: string, ago: number, by: string, kind: Decision['kind'], what: string, extra: Parameters<typeof decision>[6] = {}) => decision(now, id, ago, by, kind, what, extra);
  const you = STAKEHOLDER;
  return [
    d('d-1', 1527, you, 'setting', 'You set plan approval to “At every milestone”.', { reversible: true }),
    d('d-2', 1518, 'ceo', 'plan', 'The CEO proposed version 1 of the plan: three milestones and 17 tasks.', { rooms: ['direction'], links: { planVersion: 1 } }),
    d('d-3', 1509, you, 'plan', 'You edited the plan: the English menu moves into the first milestone.', {
      why: 'Guests from abroad read the menu too.', people: [you, 'head-of-content'], rooms: ['content'], links: { planVersion: 2 },
    }),
    d('d-4', 1506, you, 'plan', 'You approved version 2 of the plan through “Menu pages live”.', { people: [you, 'ceo'], rooms: ['direction'], links: { planVersion: 2 } }),
    d('d-5', 1500, 'office-manager', 'office', 'Otto made the office a café.', { rooms: ['direction'], reversible: true }),
    d('d-6', 330, 'ceo', 'org', 'The CEO let Sam, social media manager, go.', {
      why: 'Nobody posts until the launch.', alternatives: ['Keep Sam for the launch posts'], people: ['ceo', 'social-media-manager', 'head-of-content'], rooms: ['content'], reversible: true,
    }),
    d('d-7', 300, you, 'rule', 'You always allowed the Playwright tests: Bash(npx playwright test:*).', { people: [you, 'qa-engineer'], rooms: ['quality'], reversible: true }),
    d('d-8', 180, you, 'leash', 'You made the engineering room Trusted.', {
      why: 'They work inside the project all day, and asking about every git command slows them down.', people: [you, 'head-of-engineering'], rooms: ['engineering'], reversible: true,
    }),
    d('d-9', 179, you, 'leash', "You kept Yara on the company's approvals inside a Trusted engineering room.", {
      why: 'A security review asks before it changes anything.', people: [you, 'security-reviewer'], rooms: ['engineering'], reversible: true,
    }),
    d('d-10', 170, you, 'plan', 'You approved version 2 of the plan through “Launch in German and English”.', {
      why: 'The menu pages are live, so pickup orders and the launch can go ahead.', people: [you, 'ceo'], rooms: ['direction'], links: { planVersion: 2 },
    }),
    d('d-11', 160, you, 'task', 'You cancelled “Apple Pay at pickup”: TWINT covers mobile payments here, and cards wait for my answer.', {
      people: [you, 'twint-payments-engineer', 'web-lead'], rooms: ['engineering'], links: { task: 't-18' }, reversible: true,
    }),
    d('d-12', 120, you, 'setting', "You set Sofia's effort to extra high.", { why: 'Payments get the most care.', people: [you, 'twint-payments-engineer'], rooms: ['engineering'], reversible: true }),
    d('d-13', 70, you, 'setting', 'You moved Kai to Opus.', {
      people: [you, 'frontend-engineer'], rooms: ['engineering'], undone: { at: now - 69 * MIN, by: you, decision: 'd-14' },
    }),
    d('d-14', 69, you, 'undo', 'You undid moving Kai to Opus: he stays on Sonnet.', { people: [you, 'frontend-engineer'], rooms: ['engineering'], links: { decision: 'd-13' } }),
    d('d-15', 68, 'ceo', 'leash', 'The CEO set Lena to check with you before each task, as you asked.', {
      why: 'You want to read the German before more of it lands.', people: ['ceo', 'german-copywriter'], rooms: ['content'], links: { message: 'm-18' }, reversible: true,
    }),
    d('d-16', 55, you, 'answer', 'You answered Clara: Swiss spellings.', { people: [you, 'head-of-content'], rooms: ['content'], links: { question: 'q-1', task: 't-3' } }),
    d('d-17', 48, you, 'approval', 'You allowed Sofia to call the TWINT sandbox API, once.', { people: [you, 'twint-payments-engineer'], rooms: ['engineering'], links: { approval: 'a-1' } }),
    d('d-18', 44, 'ceo', 'plan', 'The CEO revised the plan as you asked: version 3.', {
      why: 'You asked for loyalty stamps after the launch, and your comments cut the table cards and widened the read-through.', rooms: ['direction'], links: { planVersion: 3, message: 'm-13' },
    }),
    d('d-19', 40, 'ceo', 'org', 'The CEO hired Elif, accessibility specialist.', {
      why: 'The pickup pages need a keyboard and screen reader check before the launch.', people: ['ceo', 'accessibility-specialist', 'head-of-engineering'], rooms: ['quality'], reversible: true,
    }),
    d('d-20', 30, 'web-lead', 'decide', CHECKOUT_DECISION, {
      why: "TWINT's app switch returns to a page of its own, so a second step keeps the cart safe if the switch fails.",
      alternatives: ['One page with the TWINT button and the confirmation together', 'Pay at the counter only'],
      people: ['web-lead', 'head-of-engineering'], rooms: ['engineering'], links: { task: 't-23' },
      reconsider: { at: now - 12 * MIN, note: 'One page would be quicker on a phone. Can payment and confirmation share a screen?', message: 'm-20' },
    }),
    d('d-21', 21, you, 'task', 'You moved “Order API: save pickup orders” to the top of the board.', {
      why: "Noah's order API holds up the end-to-end test.", people: [you, 'backend-engineer'], rooms: ['engineering'], links: { task: 't-12' },
    }),
    d('d-22', 20, you, 'setting', 'You set eight desks at once.', { reversible: true }),
    d('d-23', 12, you, 'reconsider', 'You asked Ines to reconsider the two-step checkout.', { people: [you, 'web-lead'], rooms: ['engineering'], links: { decision: 'd-20', message: 'm-20' } }),
    d('d-24', 5, 'ui-designer', 'decide', 'Text and buttons go espresso brown, #3B2A20, at 7:1 on the cream background.', {
      why: 'Darker than the 4.5:1 minimum, so the small prices stay readable in sunlight.',
      alternatives: ["Dark grey #333333, which loses the café's warmth", "Keep today's brown and only make the prices bold"],
      people: ['ui-designer', 'head-of-design'], rooms: ['design'], links: { message: 'm-5', task: 't-24' },
    }),
    d('d-25', 5, you, 'task', 'You paused “Slot picker visuals” until the slot length is decided.', { people: [you, 'ui-designer'], rooms: ['design'], links: { task: 't-25', question: 'q-3' } }),
    d('d-26', 1, 'head-of-engineering', 'task', 'Theo handed “Payment data review” from Ravi to Yara.', {
      why: 'A security reviewer should own it, and Ravi is back on the end-to-end test.', people: ['head-of-engineering', 'qa-engineer', 'security-reviewer'], rooms: ['engineering', 'quality'],
      links: { task: 't-17' },
    }),
  ];
}

/** The café runs "at every milestone"; Lena checks with you, engineering is Trusted, and Yara keeps the company's approvals. */
function cafeSettings(): SteeringSettings {
  return {
    planApproval: 'milestones',
    leash: { people: record<Leash>([['german-copywriter', 'check'], ['security-reviewer', 'default']]), rooms: record<Leash>([['engineering', 'trusted']]) },
    effort: record<Effort>([['ceo', 'high'], ['head-of-engineering', 'high'], ['twint-payments-engineer', 'xhigh']]),
  };
}

/** A record keyed by ids, with no prototype (as the company keeps them). */
function record<T>(entries: [string, T][]): Record<string, T> {
  const out = dict<T>();
  for (const [key, value] of entries) out[key] = value;
  return out;
}

const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** Each person's leash (their own, else their room's, else the company's default) and effort. */
export function personSteering(settings: SteeringSettings, people: readonly { id: string; room: string }[]): Record<string, PersonSteering> {
  const out = dict<PersonSteering>();
  for (const p of people) {
    const mine = own(settings.leash.people, p.id);
    const room = own(settings.leash.rooms, p.room);
    out[p.id] = { leash: mine ?? room ?? 'default', leashFrom: mine ? 'person' : room ? 'room' : 'company', effort: own(settings.effort, p.id) ?? null };
  }
  return out;
}

/** Steering for a company with no plan yet, at the founding defaults. */
export function newSteering(people: readonly { id: string; room: string }[]): SteeringView {
  const settings: SteeringSettings = { planApproval: DEFAULT_PLAN_APPROVAL, leash: { people: dict(), rooms: dict() }, effort: dict() };
  return { plan: null, acks: [], decisions: [], settings, people: personSteering(settings, people) };
}

/**
 * How the demo takes back each reversible decision it starts with: the change that undoes it. The real company keeps
 * this in its event log; the demo binding (web/src/company/demo.ts) applies it on Undo.
 */
export type DemoUndo =
  | { kind: 'settings'; change: SettingsChange }
  | { kind: 'theme'; theme: Theme }
  | { kind: 'rehire'; role: string }
  | { kind: 'fire'; role: string }
  | { kind: 'restore-task'; task: string; status: TaskStatus }
  /** A plan edit: the plan of this version comes back as a new version. */
  | { kind: 'plan'; version: number }
  | { kind: 'add-rule'; rule: string };

const DEMO_UNDOS: Record<string, Record<string, DemoUndo>> = {
  demo: {
    'd-1': { kind: 'settings', change: { planApproval: 'before-work' } },
    'd-5': { kind: 'theme', theme: 'office' },
    'd-6': { kind: 'rehire', role: 'social-media-manager' },
    'd-7': { kind: 'settings', change: { removeRule: 'Bash(npx playwright test:*)' } },
    'd-8': { kind: 'settings', change: { leash: { room: 'engineering', leash: null } } },
    'd-9': { kind: 'settings', change: { leash: { person: 'security-reviewer', leash: null } } },
    'd-11': { kind: 'restore-task', task: 't-18', status: 'queued' },
    'd-12': { kind: 'settings', change: { effort: { person: 'twint-payments-engineer', effort: null } } },
    'd-15': { kind: 'settings', change: { leash: { person: 'german-copywriter', leash: null } } },
    'd-19': { kind: 'fire', role: 'accessibility-specialist' },
    'd-22': { kind: 'settings', change: { maxDesks: 6 } },
  },
};

/** The undo of each reversible decision a demo company starts with, by decision id. */
export const demoUndos = (company: string): Record<string, DemoUndo> => ({ ...(own(DEMO_UNDOS, company) ?? {}) });

function cafeSteering(now: number, people: readonly PersonView[]): SteeringView {
  const settings = cafeSettings();
  return { plan: cafePlan(now), acks: cafeAcks(now), decisions: cafeDecisions(now), settings, people: personSteering(settings, people) };
}

const CAFE_ROOMS_EXTRA: OfficeRoom[] = [
  { id: 'reception', title: 'Reception', kind: 'reception' },
  { id: 'ceo-office', title: "The CEO's office", kind: 'ceo' },
  { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
  { id: 'kitchen', title: 'Kitchen', kind: 'kitchen' },
];

/** The café: 18 people at work on pickup orders, with something in every state the panels draw. */
export function demoCompanyView(now: number): CompanyView {
  const statuses: StatusLine[] = CAFE_STATUSES.map(([person, ago, text, taskId, cites]) => ({ person, text, taskId, at: now - ago * MIN, cites: cites ?? [] }));
  const people = peopleOfSeats(DEMO_COMPANY, CAFE_SEATS, CAFE_DESKS, statuses, CAFE_COSTS, now);
  const questions = cafeQuestions(now);
  const approvals = cafeApprovals(now);
  const founded = now - 26 * HOUR;
  const screenshots: Screenshot[] = [
    { id: 'shot-1', person: 'frontend-engineer', caption: 'The slot picker on a 375 px phone.', at: now - 20 * MIN },
    { id: 'shot-2', person: 'ui-designer', caption: 'A darker palette, first try: espresso brown at 7:1.', at: now - 5 * MIN },
  ];
  const view: CompanyView = {
    id: DEMO_COMPANY,
    name: 'Café Lumen',
    phase: 'running',
    prompt: 'A bilingual website for Café Lumen in Basel where guests order coffee and pastries for pickup and pay with TWINT.',
    stakeholder: 'Alex',
    branch: 'worklings/cafe-lumen',
    theme: 'cafe',
    rooms: CAFE_ROOMS_EXTRA,
    goal: CAFE_GOAL(now),
    people,
    proposal: null,
    tasks: CAFE_TASKS.map((t) => task(t, now)),
    messages: cafeMessages(now),
    questions,
    approvals,
    statuses,
    reports: cafeReports(now),
    dashboards: cafeDashboards(now),
    screenshots,
    spend: spendFor(CAFE_COSTS, founded, now, 'cafe', { from: now - 22 * HOUR, to: now - 19 * HOUR }),
    log: cafeLog(now),
    pause: null,
    settings: {
      maxDesks: 8, idleMs: DEFAULT_IDLE_MS, billing: 'plan', alwaysAllow: ['Bash(npm run test:*)', 'Bash(npx playwright test:*)'],
      ...spendingSettings('thorough', { company: 60, person: 8 }),
    },
    desks: deskCounts(people, 8),
    preview: { state: 'off', url: null, command: 'npm run dev', problem: null },
    inbox: 0,
    seen: { ceo: now - 10 * MIN, 'frontend-engineer': now - 20 * MIN, 'backend-engineer': now - 2 * MIN },
    proposalEdited: false,
    steering: cafeSteering(now, people),
    problem: null,
    // v0.2: Alex last looked three hours ago, after a visit the day before.
    looked: { last: now - 3 * HOUR, previous: now - 26 * HOUR },
  };
  view.inbox = inboxOf(view);
  return withOverview(withSpending(view, now), now);
}

// ---------------------------------------------------------------------------------------------------------------
// v0.2: the overview (src/core/overview.ts), as the hub writes it from a company's state, here from a view

/**
 * The view's checklist (the approved version's, else the latest's, with the final review's verdicts kept) and what
 * happened since the stakeholder last looked, worked out again as the demo's view changes.
 */
export function withOverview(view: CompanyView, now: number, verdicts: readonly ChecklistVerdict[] = view.checklist?.rows.flatMap((r) => (r.verdict ? [r.verdict] : [])) ?? []): CompanyView {
  const plan = view.steering?.plan ?? null;
  const version = plan ? (approvedVersion(plan) ?? latestVersion(plan)) : null;
  const checklist = checklistView(version, verdicts, view.tasks, undefined, plan?.versions ?? []);
  if (view.looked === undefined) return { ...view, checklist };
  const start = sinceStart(view.looked, now);
  const since =
    start === null
      ? null
      : sinceOf(
          {
            tasks: view.tasks,
            reports: view.reports,
            decisions: view.steering?.decisions ?? [],
            people: view.people,
            stakeholder: view.stakeholder,
            spend: view.spend.samples,
            questions: view.questions,
            approvals: view.approvals,
          },
          start,
          now,
        );
  return { ...view, checklist, since };
}

// ---------------------------------------------------------------------------------------------------------------
// The other companies in the demo lobby

const PLANT_ROOMS: OrgProposal['rooms'] = [
  { id: 'direction', title: 'Direction', style: 'direction' },
  { id: 'design', title: 'Design', style: 'design' },
  { id: 'engineering', title: 'Engineering', style: 'engineering' },
  { id: 'plant-care', title: 'Plant care', style: 'content' },
  { id: 'quality', title: 'Quality', style: 'quality' },
];

const proposed = (id: string, name: string, title: string, level: Level, room: string, reportsTo: string | null, model: RoleModel, owns: string, extra: Partial<ProposedPerson> = {}): ProposedPerson => ({
  id, name, title, level, room, reportsTo, model, owns, ...extra,
});

/**
 * A role written for a company, as the CEO writes one for an area the library lacks: the library's sections (Mission,
 * You own, How you work, Done means) and length, so the library linter takes it.
 */
function writtenRole(title: string, description: string, mission: string, owns: string[], steps: string[], watch: string[], done: string[]): NewRole {
  const body = [
    `You are the company's ${title.charAt(0).toLowerCase()}${title.slice(1)}. ${mission}`,
    '',
    '## Mission',
    mission,
    '',
    '## You own',
    ...owns.map((o) => `- ${o}`),
    '',
    '## How you work',
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    '## Watch for',
    ...watch.map((w) => `- ${w}`),
    '',
    '## Done means',
    ...done.map((d) => `- ${d}`),
  ].join('\n');
  return { description, body };
}

/** Plant Pal's proposal: a large company of 15 people in five rooms, two heads who each brief five, two checker seats, two roles written for it, two questions. */
export function demoProposal(): OrgProposal {
  return {
    company: 'Plant Pal',
    goal: 'Plant Pal reminds people to water each plant and keeps a watering streak that makes them want to come back.',
    size: 'large',
    sizing:
      'You want a polished App Store release with reminders that arrive on time, a streak and plant care advice to trust, so each of those areas has its own owner.',
    theme: 'garden',
    rooms: PLANT_ROOMS,
    people: [
      proposed('ceo', 'Juno', 'CEO', 'ceo', 'direction', null, 'opus', 'The company, its goal and the decisions that are yours.', { library: 'ceo' }),
      proposed('office-manager', 'Bea', 'Office manager', 'worker', 'direction', 'ceo', 'haiku', 'The office: rooms, decor and looks.', { library: 'office-manager' }),
      proposed('head-of-design', 'Rosa', 'Head of design', 'head', 'design', 'ceo', 'sonnet', 'How Plant Pal looks, reads and feels.', { library: 'head' }),
      proposed('ui-designer', 'Leo', 'UI designer', 'worker', 'design', 'head-of-design', 'sonnet', 'Screens, components and the visual system.', { library: 'ui-designer' }),
      proposed('ux-designer', 'Ivy', 'UX designer', 'worker', 'design', 'head-of-design', 'sonnet', 'Flows from the first plant to a long streak.', { library: 'ux-designer' }),
      proposed('motion-designer', 'Finn', 'Motion designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The small animations: a plant perking up, a streak growing.', {
        library: 'technical-artist',
        notes: ['Your work is the app\'s motion, not 3D: transitions and small celebrations in CSS and SVG, still with reduced motion.'],
      }),
      proposed('art-director', 'Nia', 'Art director', 'worker', 'design', 'head-of-design', 'haiku', 'The plant drawings and the look they share.', { library: 'art-director' }),
      proposed('ux-writer', 'Oli', 'UX writer', 'worker', 'design', 'head-of-design', 'haiku', 'The words in the app and in its reminders.', { library: 'copywriter' }),
      proposed('head-of-engineering', 'Sam', 'Head of engineering', 'head', 'engineering', 'ceo', 'sonnet', 'How Plant Pal is built and shipped.', { library: 'head' }),
      proposed('frontend-engineer', 'Kit', 'Frontend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'The web app in React.', { library: 'frontend-engineer' }),
      proposed('backend-engineer', 'Ana', 'Backend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'Accounts, plants and streaks on the server.', { library: 'backend-engineer' }),
      proposed('push-notification-engineer', 'Ben', 'Push notification engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'Reminders that arrive on time on iPhone and Android.', {
        role: writtenRole(
          'Push notification engineer',
          'Builds the reminders that reach a phone on time: web push and its permission prompt, quiet hours, time zones and what a reminder says. Use for anything that notifies a person outside the app.',
          'Every reminder arrives when the plant needs water, in the person\'s own time zone, and never nags.',
          ['Web push: the service worker, subscriptions and their renewal.', 'The permission prompt and when it is asked.', 'Quiet hours, time zones and daylight saving.', 'Reminder delivery: retries, expiry and dropped subscriptions.', 'What each reminder says, with the UX writer.'],
          [
            'Read how reminders are planned before changing how they are sent.',
            'Ask for permission only after the person has added a plant, never on the first screen.',
            'Schedule in the person\'s time zone and test the hour around a daylight-saving change.',
            'Keep each reminder to one plant and one action, and link it to that plant.',
            'Drop a subscription the push service rejects instead of retrying it.',
            'Check iPhone home-screen web apps separately: Safari delivers push only there.',
            'Report what you checked on a real device and what still needs one.',
          ],
          ['A reminder sent twice, or at night.', 'A permission prompt shown before the person sees why.', 'Time stored without its zone.'],
          ['Reminders arrive within a minute of their time on an iPhone and an Android phone.', 'Quiet hours hold across a daylight-saving change.', 'A refused permission leaves the app working, with a way to ask again.'],
        ),
      }),
      proposed('plant-care-expert', 'Eve', 'Plant care expert', 'worker', 'plant-care', 'ceo', 'haiku', 'How often each species needs water, light and food.', {
        role: writtenRole(
          'Plant care expert',
          'Knows how often common houseplants need water, light and food through the seasons, and checks every care tip the app gives against sound sources. Use for plant facts and care schedules.',
          'Every care tip Plant Pal gives keeps a real plant alive, for the species and the season it is in.',
          ['The care table: water, light and food for each species the app knows.', 'How schedules change with the season and the room.', 'The wording of care tips, with the UX writer.', 'The sources behind every number.'],
          [
            'Start from the species list the app ships and add the most common houseplants first.',
            'Give a range and a sign to look for, not a single rigid interval.',
            'Note how the schedule shifts in winter and in a dry, heated room.',
            'Mark plants that are toxic to cats and dogs.',
            'Cite a horticultural source for each species, never a forum.',
            'Review every care tip the app shows before it ships.',
          ],
          ['Overwatering advice, the most common way houseplants die.', 'One schedule for every season.', 'Facts with no source.'],
          ['Every species in the app has a sourced care entry.', 'Seasonal changes are in the schedules.', 'The UX writer has signed off the wording of each tip.'],
        ),
      }),
      proposed('qa-engineer', 'Joy', 'QA engineer', 'worker', 'quality', 'head-of-engineering', 'sonnet', 'Tests reminders, streaks and every screen on a phone.', { library: 'qa-engineer' }),
      proposed('accessibility-specialist', 'Ray', 'Accessibility specialist', 'worker', 'quality', 'head-of-engineering', 'sonnet', 'Keyboard, screen readers, contrast and large text.', { library: 'accessibility-specialist' }),
    ],
    questions: [
      { text: 'Should a streak forgive one missed day a week?', options: ['Forgive one day a week', 'No: a missed day resets it'], recommended: 0 },
      { text: 'iPhone first, or iPhone and Android from the start?', options: ['iPhone first', 'Both from the start'], recommended: 0 },
    ],
  };
}

function soloCeo(company: string, state: DeskState, ago: number, now: number, statuses: StatusLine[], cost: number, problem?: string): PersonView {
  const desk = deskOf(company, 'ceo', { state, ago, context: 0.18, ...(problem ? { problem } : {}) }, now);
  return {
    id: 'ceo', name: 'Juno', title: 'CEO', level: 'ceo', room: 'direction', reportsTo: null, look: {}, model: 'opus', desk, task: null,
    status: statuses.filter((s) => s.person === 'ceo').at(-1) ?? null, agentKey: desk.sessionId ? `${desk.sessionId}:lead` : null, cost,
  };
}

function emptyCompany(id: string, name: string): Omit<CompanyView, 'people' | 'phase' | 'prompt' | 'theme'> {
  return {
    id, name, stakeholder: 'Alex', branch: `worklings/${id}`, rooms: [], goal: null, proposal: null, tasks: [], messages: [], questions: [], approvals: [], statuses: [],
    reports: [], dashboards: [], screenshots: [], spend: { samples: [], hourly: [], byPerson: [] }, log: [], pause: null,
    settings: { maxDesks: 8, idleMs: DEFAULT_IDLE_MS, billing: 'plan', alwaysAllow: [], ...spendingSettings('balanced') }, desks: { working: 0, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: null, problem: null }, inbox: 0, seen: {}, proposalEdited: false, problem: null,
  };
}

/** A scoping question as the demo writes it: its options, the CEO's pick and why, and the answer it got. */
export interface DemoScopingQuestion {
  text: string;
  options: string[];
  recommended: number;
  why: string;
  /** The option pressed, or the stakeholder's own words; absent while it is open. */
  answer?: { option: number } | { words: string };
}

/**
 * The CEO's scoping questions as the hub keeps them: questions in the inbox (`<company>-s1`, ...) and the round that
 * names them. Answered ones applied long ago when `answeredAt` is given; open ones wait.
 */
export function demoScoping(company: string, asked: readonly DemoScopingQuestion[], askedAt: number, answeredAt: number | null): { questions: Question[]; scoping: ScopingView } {
  const questions = asked.map((q, i): Question => {
    const given = q.answer;
    const at = answeredAt === null ? askedAt : answeredAt - UNDO_MS - (asked.length - i) * 20_000;
    const answer = !given ? null : 'option' in given ? { option: given.option, text: '', at, appliesAt: at + UNDO_MS } : { option: null, text: given.words, at, appliesAt: at + UNDO_MS };
    return { id: `${company}-s${i + 1}`, from: 'ceo', text: q.text, options: q.options, recommended: q.recommended, why: q.why, taskId: null, askedAt, answer, withdrawn: null };
  });
  return { questions, scoping: { questions: questions.map((q) => q.id), askedAt, answeredAt } };
}

/** What the CEO asked before drafting Plant Pal, and what you answered: a pick turned down, two picks taken, your own words. */
export const PLANT_PAL_SCOPING: readonly DemoScopingQuestion[] = [
  {
    text: 'Who is it for?',
    options: ['Just me', 'Friends and family', 'Anyone, through the App Store'],
    recommended: 0,
    why: 'You wrote “reminds me”, and a tool for one person ships soonest.',
    answer: { option: 2 },
  },
  {
    text: 'How far should the first version go?',
    options: ['A quick prototype', 'A polished first release', 'A full product with accounts and sync'],
    recommended: 1,
    why: 'Polished enough to keep a streak going, small enough to finish this month.',
    answer: { option: 1 },
  },
  {
    text: 'Where should it run?',
    options: ['As an app on phones', 'On the web', 'Both'],
    recommended: 0,
    why: 'Reminders work best as phone notifications.',
    answer: { option: 0 },
  },
  {
    text: 'What matters most in the first release?',
    options: ['Reminders that arrive on time', 'A streak that brings people back', 'Plant care advice they can trust'],
    recommended: 0,
    why: 'A missed reminder is a dry plant, and nothing else matters then.',
    answer: { words: 'All three, but reminders that never fail come first.' },
  },
];

/** What the CEO asks a new company before drafting it, in the demo: the same four for any prompt. */
export const DEMO_SCOPING: readonly DemoScopingQuestion[] = [
  {
    text: 'Who is it for?',
    options: ['Just me', 'A group I know', 'Anyone who finds it'],
    recommended: 2,
    why: 'Most ideas like this are meant for other people to use.',
  },
  {
    text: 'How far should the first version go?',
    options: ['A quick prototype', 'A small, solid first release', 'A full product'],
    recommended: 1,
    why: 'Small enough to finish soon, solid enough to show people.',
  },
  {
    text: 'Where should it run?',
    options: ['On the web', 'On phones', 'Both'],
    recommended: 0,
    why: 'The web reaches every device with one build.',
  },
  {
    text: 'What matters most?',
    options: ['Shipping it soon', 'Polish and quality', 'Low running cost'],
    recommended: 0,
    why: 'Something people can try this week teaches you the most.',
  },
];

/** A small org for a quick prototype: the CEO and the one person who builds it, no heads and no checker seat. */
export function demoSmallProposal(company: string, goal: string): OrgProposal {
  return {
    company,
    goal,
    size: 'small',
    sizing: 'A quick prototype needs one person to build and test it, and I manage them and check the result myself.',
    theme: 'office',
    rooms: [
      { id: 'direction', title: 'Direction', style: 'direction' },
      { id: 'engineering', title: 'Engineering', style: 'engineering' },
    ],
    people: [
      proposed('ceo', 'Juno', 'CEO', 'ceo', 'direction', null, 'opus', 'The company, its goal and the decisions that are yours.', { library: 'ceo' }),
      proposed('frontend-engineer', 'Kit', 'Frontend engineer', 'worker', 'engineering', 'ceo', 'sonnet', 'The prototype, end to end, with its tests.', { library: 'frontend-engineer' }),
    ],
    questions: [],
  };
}

/** The proposal's questions as the hub asks them: the CEO's questions in the inbox, answered there. */
export function proposalQuestions(proposal: OrgProposal, company: string, askedAt: number): Question[] {
  return proposal.questions.map((q, i) => ({
    id: `${company}-q${i + 1}`, from: 'ceo', text: q.text, options: q.options, recommended: q.recommended ?? null, taskId: null, askedAt, answer: null, withdrawn: null,
  }));
}

/** Plant Pal: the CEO's proposal waits for you. */
export function demoProposalView(now: number): CompanyView {
  const statuses: StatusLine[] = [
    { person: 'ceo', text: 'Reading the folder: a Vite and React app with a plant list.', taskId: null, at: now - 34.5 * MIN },
    { person: 'ceo', text: 'Asked you four questions before drafting.', taskId: null, at: now - 34 * MIN },
    { person: 'ceo', text: 'Drafting from your answers: plant care, push notifications and the streak.', taskId: null, at: now - 33 * MIN },
    { person: 'ceo', text: 'The proposal is ready: 15 people in five rooms.', taskId: null, at: now - 31 * MIN },
  ];
  const ceo = soloCeo('plant-pal', 'idle', 31, now, statuses, 0.14);
  const proposal = demoProposal();
  const scoped = demoScoping('plant-pal', PLANT_PAL_SCOPING, now - 34 * MIN, now - 33.5 * MIN);
  const answers = [
    'Answers to your scoping questions:',
    '1. Who is it for?\n   Anyone, through the App Store.',
    '2. How far should the first version go?\n   A polished first release (your pick).',
    '3. Where should it run?\n   As an app on phones (your pick).',
    '4. What matters most in the first release?\n   In their own words: All three, but reminders that never fail come first.',
  ].join('\n');
  const view: CompanyView = {
    ...emptyCompany('plant-pal', 'Plant Pal'),
    phase: 'proposed',
    prompt: 'An app that reminds me to water my plants and keeps a watering streak.',
    theme: 'garden',
    people: [ceo],
    proposal,
    questions: [...scoped.questions, ...proposalQuestions(proposal, 'plant-pal', now - 31 * MIN)],
    scoping: scoped.scoping,
    statuses,
    log: [
      { at: now - 35 * MIN, kind: 'founded', by: STAKEHOLDER, text: 'You started Plant Pal.' },
      { at: now - 34 * MIN, kind: 'scoping', by: 'ceo', text: 'The CEO asked four questions to scope the company before drafting it.' },
      { at: now - 33.5 * MIN, kind: 'scoping', by: STAKEHOLDER, text: "You answered the CEO's four questions; it drafts the org from your answers." },
      { at: now - 31 * MIN, kind: 'proposal', by: 'ceo', text: 'The CEO proposed an org of 15 people in five rooms.' },
    ],
    messages: [
      { ...message('pm-0', STAKEHOLDER, 'ceo', answers, 33.5, 33.5, now, null, NEW), fromOffice: true },
      message('pm-1', 'ceo', STAKEHOLDER, 'My proposal is ready: 15 people in five rooms, with two roles written for Plant Pal. Two questions are open for you.', 31, 31, now),
    ],
    spend: { samples: [{ person: 'ceo', at: now - 31 * MIN, cost: 0.14 }], hourly: [], byPerson: [{ person: 'ceo', today: 0.14, week: 0.14, all: 0.14 }] },
    desks: { working: 0, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: 'npm run dev', problem: null },
    steering: newSteering([ceo]),
  };
  view.inbox = inboxOf(view);
  return withSpending(view, now);
}

/** Lake Wind: the CEO is drafting the org right now. */
export function demoFoundingView(now: number): CompanyView {
  const statuses: StatusLine[] = [
    { person: 'ceo', text: 'Reading the folder: an empty Astro site.', taskId: null, at: now - 170_000 },
    { person: 'ceo', text: 'Asked you three questions before drafting.', taskId: null, at: now - 160_000 },
    { person: 'ceo', text: 'Drafting from your answers: looking through the library for a weather data role.', taskId: null, at: now - 20_000 },
  ];
  const ceo = soloCeo('lake-wind', 'working', 1, now, statuses, 0.05);
  ceo.name = 'Rhea';
  const scoped = demoScoping(
    'lake-wind',
    [
      { text: 'Who is it for?', options: ['Sailors at my club', 'Anyone sailing on Lake Geneva'], recommended: 1, why: 'A public site helps every boat on the lake.', answer: { option: 1 } },
      { text: 'How fast must a warning arrive?', options: ['Within the hour', 'Within minutes'], recommended: 1, why: 'The bise can rise in under half an hour.', answer: { option: 1 } },
      { text: 'Which languages?', options: ['French', 'French and English', 'French, German and English'], recommended: 1, why: 'Most sailors on the lake read one of the two.', answer: { words: 'French and German, please.' } },
    ],
    now - 160_000,
    now - 40_000,
  );
  return withSpending({
    ...emptyCompany('lake-wind', 'lake-wind'),
    phase: 'founding',
    prompt: 'A site for sailors on Lake Geneva that warns them when the bise picks up.',
    theme: 'office',
    people: [ceo],
    statuses,
    questions: scoped.questions,
    scoping: scoped.scoping,
    log: [
      { at: now - 180_000, kind: 'founded', by: STAKEHOLDER, text: 'You started lake-wind.' },
      { at: now - 160_000, kind: 'scoping', by: 'ceo', text: 'The CEO asked three questions to scope the company before drafting it.' },
      { at: now - 40_000, kind: 'scoping', by: STAKEHOLDER, text: "You answered the CEO's three questions; it drafts the org from your answers." },
    ],
    desks: { working: 1, waiting: 0, max: 8 },
    spend: { samples: [], hourly: [], byPerson: [{ person: 'ceo', today: 0.05, week: 0.05, all: 0.05 }] },
    steering: newSteering([ceo]),
  }, now);
}

/**
 * Ledger: a running company you paused. Forty people in eight rooms and a hundred tasks on the board, so the 40-person
 * chart, board and lists show in the demo and the static demo: the first milestone is done, the second is under way,
 * the third is approved and started, and the fourth waits in the plan.
 */
const LEDGER_SEATS: Seat[] = [
  seat('ceo', 'Vera', 'CEO', 'ceo', 'direction', null, 'opus'),
  seat('office-manager', 'Gerda', 'Office manager', 'worker', 'direction', 'ceo', 'haiku', { prop: 'headset' }),
  seat('head-of-product', 'Lucia', 'Head of product', 'head', 'direction', 'ceo', 'sonnet'),
  seat('product-analyst', 'Noemi', 'Product analyst', 'worker', 'direction', 'head-of-product', 'haiku'),
  seat('head-of-design', 'Hanna', 'Head of design', 'head', 'design', 'ceo', 'sonnet', { body: 'mage' }),
  seat('ui-designer', 'Mina', 'UI designer', 'worker', 'design', 'head-of-design', 'sonnet', { prop: 'tablet' }),
  seat('ux-designer', 'Jonas', 'UX designer', 'worker', 'design', 'head-of-design', 'sonnet'),
  seat('design-systems-designer', 'Tessa', 'Design systems designer', 'worker', 'design', 'head-of-design', 'sonnet'),
  seat('ux-researcher', 'Elin', 'UX researcher', 'worker', 'design', 'head-of-design', 'haiku'),
  seat('brand-designer', 'Zoe', 'Brand designer', 'worker', 'design', 'head-of-design', 'sonnet'),
  seat('head-of-engineering', 'Paul', 'Head of engineering', 'head', 'engineering', 'ceo', 'opus'),
  seat('web-lead', 'Marta', 'Team lead, web', 'lead', 'engineering', 'head-of-engineering', 'sonnet'),
  seat('frontend-engineer', 'Kai', 'Frontend engineer', 'worker', 'engineering', 'web-lead', 'sonnet', { prop: 'laptop' }),
  seat('forms-engineer', 'Rosa', 'Forms and review screen engineer', 'worker', 'engineering', 'web-lead', 'sonnet'),
  seat('dashboard-engineer', 'Timo', 'Reports and charts engineer', 'worker', 'engineering', 'web-lead', 'sonnet'),
  seat('platform-lead', 'Ben', 'Team lead, platform', 'lead', 'engineering', 'head-of-engineering', 'opus'),
  seat('backend-engineer', 'Nils', 'Backend engineer', 'worker', 'engineering', 'platform-lead', 'sonnet'),
  seat('bank-formats-engineer', 'Ilse', 'Bank statement formats engineer', 'worker', 'engineering', 'platform-lead', 'sonnet'),
  seat('shopify-engineer', 'Dario', 'Shopify orders, refunds and payouts integration engineer', 'worker', 'engineering', 'platform-lead', 'sonnet'),
  seat('matching-engineer', 'Fiona', 'Payment matching engineer', 'worker', 'engineering', 'platform-lead', 'sonnet'),
  seat('database-engineer', 'Hugo', 'Database engineer', 'worker', 'engineering', 'platform-lead', 'sonnet'),
  seat('webhooks-engineer', 'Joel', 'Webhooks and sync engineer', 'worker', 'engineering', 'platform-lead', 'haiku'),
  seat('head-of-data', 'Sabine', 'Head of data and accounting', 'head', 'data', 'ceo', 'sonnet'),
  seat('swiss-accounting-expert', 'Doris', 'Swiss accounting expert', 'worker', 'data', 'head-of-data', 'sonnet'),
  seat('vat-specialist', 'Aline', 'Swiss VAT specialist', 'worker', 'data', 'head-of-data', 'sonnet'),
  seat('data-engineer', 'Emil', 'Data engineer', 'worker', 'data', 'head-of-data', 'sonnet'),
  seat('reporting-analyst', 'Chiara', 'Reporting analyst', 'worker', 'data', 'head-of-data', 'haiku'),
  seat('head-of-quality', 'Ruedi', 'Head of quality', 'head', 'quality', 'ceo', 'sonnet'),
  seat('qa-engineer', 'Arne', 'QA engineer', 'worker', 'quality', 'head-of-quality', 'haiku', { prop: 'clipboard' }),
  seat('test-automation-engineer', 'Mirela', 'Test automation engineer', 'worker', 'quality', 'head-of-quality', 'sonnet'),
  seat('accessibility-specialist', 'Pascal', 'Accessibility specialist', 'worker', 'quality', 'head-of-quality', 'sonnet'),
  seat('security-reviewer', 'Yves', 'Security reviewer', 'worker', 'security', 'head-of-engineering', 'sonnet'),
  seat('head-of-operations', 'Lars', 'Head of operations', 'head', 'ops', 'ceo', 'sonnet'),
  seat('devops-engineer', 'Nils', 'DevOps engineer', 'worker', 'ops', 'head-of-operations', 'sonnet', { prop: 'headset' }),
  seat('release-manager', 'Katja', 'Release manager', 'worker', 'ops', 'head-of-operations', 'haiku'),
  seat('support-engineer', 'Remo', 'Support engineer', 'worker', 'ops', 'head-of-operations', 'haiku'),
  seat('head-of-content', 'Elena', 'Head of content', 'head', 'content', 'ceo', 'sonnet'),
  seat('german-copywriter', 'Lena', 'German copywriter', 'worker', 'content', 'head-of-content', 'haiku', { prop: 'notebook' }),
  seat('french-copywriter', 'Chloe', 'French copywriter', 'worker', 'content', 'head-of-content', 'haiku'),
  seat('docs-writer', 'Sven', 'Documentation writer', 'worker', 'content', 'head-of-content', 'haiku'),
];

/** Ledger's milestones: statements read (done), matching (under way), reports (started), the App Store (waits in the plan). */
const LEDGER_MILESTONES: PlanMilestone[] = [
  { id: 'lms-read', title: 'Statements read', doneWhen: 'PostFinance and UBS statements in camt.053 come in as payments.' },
  { id: 'lms-match', title: 'Payments matched to orders', doneWhen: 'Nine payments in ten find their Shopify order without help.' },
  { id: 'lms-reports', title: 'Reports for the accountant', doneWhen: 'The month-end report and the export to the accounting program work for a real month.' },
  { id: 'lms-ship', title: 'On the Shopify App Store', doneWhen: 'Shops install Ledger from the App Store.' },
];
const LEDGER_MS = { r: 'lms-read', m: 'lms-match', p: 'lms-reports', s: 'lms-ship' } as const;

/**
 * Where a task stands: done, working, queued, blocked, in review or cancelled; WP and QP are paused. A row with `plan`
 * set is a plan task (the plan keeps them all, the board only those of started milestones); the rest are fixes and
 * follow-ups the heads asked for. Per person the rows run from finished to not started, so what a task waits for is
 * never behind the task.
 */
type LedgerState = 'D' | 'W' | 'Q' | 'B' | 'R' | 'X' | 'WP' | 'QP';
type LedgerRow = [owner: string, title: string, state: LedgerState, milestone: keyof typeof LEDGER_MS, plan: boolean, reason?: string];

const LEDGER_ROWS: LedgerRow[] = [
  // Statements read
  ['bank-formats-engineer', 'Read camt.053 statements from PostFinance', 'D', 'r', true],
  ['bank-formats-engineer', 'Read camt.053 statements from UBS', 'D', 'r', true],
  ['bank-formats-engineer', 'Read camt.054 notifications for card and TWINT batches', 'D', 'r', true],
  ['swiss-accounting-expert', 'Swiss VAT rates for 2026', 'D', 'r', true],
  ['vat-specialist', 'Reduced and special VAT rates by kind of product', 'D', 'r', true],
  ['shopify-engineer', 'Import Shopify orders with their totals and taxes', 'D', 'r', true],
  ['shopify-engineer', 'Import Shopify refunds and partial refunds', 'D', 'r', true],
  ['database-engineer', 'Database tables for payments and orders', 'D', 'r', true],
  ['backend-engineer', 'Shopify app sign-in and the install flow', 'D', 'r', true],
  ['platform-lead', 'Choose how matching works: rules first, then a score', 'D', 'r', true],
  ['data-engineer', 'Sample statements from ten shops, with the names removed', 'D', 'r', true],
  ['webhooks-engineer', 'Receive Shopify order webhooks', 'D', 'r', true],
  ['head-of-design', 'Visual direction for Ledger: calm, ledger paper, one accent colour', 'D', 'r', true],
  ['ui-designer', 'Layout of the statements screen', 'D', 'r', true],
  ['ux-designer', 'Flow from the first install to the first import', 'D', 'r', true],
  ['design-systems-designer', 'Colour, type and spacing tokens', 'D', 'r', true],
  ['ux-researcher', 'Five conversations with shop owners about month-end', 'D', 'r', true],
  ['test-automation-engineer', 'Test setup for the statement readers', 'D', 'r', true],
  ['accessibility-specialist', 'Accessibility rules for tables and forms', 'D', 'r', true],
  ['security-reviewer', 'Threat model for bank data inside a Shopify app', 'D', 'r', true],
  ['bank-formats-engineer', 'Fix: PostFinance files that start with a byte order mark', 'D', 'r', false],
  ['backend-engineer', 'Fix: sign-in loops when the browser blocks cookies in the embedded app', 'D', 'r', false],
  ['database-engineer', 'Index payments by their reference', 'D', 'r', false],
  ['qa-engineer', 'Check the statement readers against the ten sample statements', 'D', 'r', false],
  ['german-copywriter', 'German words for the statements screen', 'D', 'r', false],
  ['office-manager', 'Set the office up for a bookkeeping app', 'D', 'r', false],
  // Payments matched to orders
  ['matching-engineer', 'Match payments to orders by payment reference', 'D', 'm', true],
  ['matching-engineer', 'Match by amount and date when the reference is missing', 'R', 'm', true],
  ['matching-engineer', 'Score uncertain matches and say why', 'W', 'm', true],
  ['matching-engineer', 'Match one payment to several orders', 'Q', 'm', true],
  ['matching-engineer', 'Learn from the matches a shop accepts or corrects', 'B', 'm', true],
  ['swiss-accounting-expert', 'Rules for partial and combined payments', 'W', 'm', true],
  ['swiss-accounting-expert', 'Booking rules for refunds and chargebacks', 'W', 'm', true],
  ['swiss-accounting-expert', 'Rounding and currency differences in bookings', 'Q', 'm', true],
  ['vat-specialist', 'VAT on shipping and discounts', 'D', 'm', true],
  ['vat-specialist', 'VAT for orders to the EU and the rest of the world', 'R', 'm', true],
  ['bank-formats-engineer', 'Handle statements that arrive twice', 'D', 'm', true],
  ['bank-formats-engineer', 'Read camt.053 from Raiffeisen and the cantonal banks', 'W', 'm', true],
  ['bank-formats-engineer', 'Read CSV exports from banks without camt', 'Q', 'm', true],
  ['shopify-engineer', 'Sync orders every hour and on demand', 'W', 'm', true],
  ['shopify-engineer', 'Match orders to Shopify Payments payouts', 'W', 'm', true],
  ['shopify-engineer', 'Payouts from Stripe, PayPal and TWINT in one list', 'B', 'm', true],
  ['webhooks-engineer', 'Webhook retries and a safe order of events', 'D', 'm', true],
  ['webhooks-engineer', 'Show webhook problems in the app', 'Q', 'm', true],
  ['database-engineer', 'Store each match with who decided it', 'D', 'm', true],
  ['database-engineer', 'Keep every change to a match, for the auditor', 'R', 'm', true],
  ['backend-engineer', 'Review queue API: list, accept, reject and change', 'W', 'm', true],
  ['backend-engineer', 'Rate limits for the Shopify and bank sides', 'Q', 'm', true],
  ['platform-lead', 'Plan the review queue and its states', 'D', 'm', true],
  ['frontend-engineer', 'Review screen: payments on the left, orders on the right', 'W', 'm', true],
  ['frontend-engineer', 'Keyboard shortcuts for the review screen', 'Q', 'm', true],
  ['forms-engineer', 'Accept, change and split forms in the review screen', 'W', 'm', true],
  ['forms-engineer', 'Month-end close checklist screen', 'Q', 'm', true],
  ['dashboard-engineer', 'Match rate chart by week', 'Q', 'm', true],
  ['ui-designer', 'Review screen design, with orders that have long item lists', 'D', 'm', true],
  ['ui-designer', 'States for the review screen: empty, loading and error', 'R', 'm', true],
  ['ux-designer', 'Flow for a payment nobody can match', 'W', 'm', true],
  ['test-automation-engineer', 'A real month, end to end', 'WP', 'm', true],
  ['qa-engineer', 'Try the matcher on three odd months', 'Q', 'm', true],
  // Reports for the accountant
  ['head-of-product', 'Which reports an accountant asks for first', 'D', 'p', true],
  ['head-of-data', 'Choose the first three accounting programs to export to', 'D', 'p', true],
  ['swiss-accounting-expert', 'Which account each kind of booking goes to', 'Q', 'p', true],
  ['reporting-analyst', 'Month-end report: matched, open and flagged payments', 'Q', 'p', true],
  ['reporting-analyst', 'Export bookings to Banana, Abacus and bexio in their own formats, with the accounts each shop has chosen', 'Q', 'p', true],
  ['data-engineer', 'Nightly job that prepares the report data', 'Q', 'p', true],
  ['dashboard-engineer', 'Report screen with filters and a print view', 'Q', 'p', true],
  ['dashboard-engineer', 'Export button and the file download', 'Q', 'p', true],
  ['vat-specialist', 'VAT report for the quarterly return', 'Q', 'p', true],
  ['docs-writer', 'Help page: month-end in ten minutes', 'Q', 'p', true],
  ['german-copywriter', 'German texts for the reports and exports', 'Q', 'p', true],
  ['french-copywriter', 'French texts for the reports and exports', 'Q', 'p', true],
  ['accessibility-specialist', 'Check reports and tables with a screen reader', 'Q', 'p', true],
  ['security-reviewer', 'Review exports for personal data', 'Q', 'p', true],
  ['ui-designer', 'Report layout for print and a narrow screen', 'W', 'p', true],
  // On the Shopify App Store: in the plan, not on the board until you approve it
  ['release-manager', 'Release checklist for the Shopify App Store', 'Q', 's', true],
  ['head-of-product', 'App Store listing: words, screenshots and pricing', 'Q', 's', true],
  ['brand-designer', 'Listing images and the app icon', 'Q', 's', true],
  ['support-engineer', 'Support inbox and reply templates', 'Q', 's', true],
  ['devops-engineer', 'Production setup, backups and alerts', 'Q', 's', true],
  ['security-reviewer', 'Privacy answers and data retention for the listing', 'Q', 's', true],
  ['test-automation-engineer', 'Install, upgrade and uninstall tests', 'Q', 's', true],
  ['head-of-content', 'Launch plan for French and German shops', 'Q', 's', true],
  ['product-analyst', 'Measures: installs, matched share and time to first import', 'Q', 's', true],
  // Fixes and follow-ups the heads asked for
  ['head-of-design', 'Dark theme for the whole app', 'X', 'm', false, "Shop owners use the app inside Shopify's admin, which is light. It can wait until they ask."],
  ['shopify-engineer', 'Support for WooCommerce shops', 'X', 'm', false, 'Ledger starts with Shopify only, as the plan says.'],
  ['data-engineer', 'Guess missing references with a language model', 'X', 'm', false, "A wrong guess in someone's books costs more than a payment that is flagged."],
  ['ux-designer', 'Onboarding video for new shops', 'X', 'p', false, 'The help page does the same job, and it is easier to keep right.'],
  ['dashboard-engineer', 'Live feed of matches on the dashboard', 'X', 'm', false, 'Nobody asked for it, and the weekly chart says what shops need.'],
  ['french-copywriter', 'Italian texts', 'X', 'p', false, 'French and German come first; Italian waits for the first Ticino shop.'],
  ['bank-formats-engineer', 'Raiffeisen statements that use another date format', 'B', 'm', false],
  ['backend-engineer', 'Connect to the bank sandbox for live balances', 'B', 'm', false],
  ['frontend-engineer', "Open the review screen inside Shopify's admin", 'B', 'm', false],
  ['head-of-product', 'Pricing: what a shop pays each month', 'B', 'm', false],
  ['frontend-engineer', 'Fix: the embedded app flashes white while it loads', 'R', 'm', false],
  ['accessibility-specialist', 'Fix: focus is lost after accepting a match', 'R', 'm', false],
  ['test-automation-engineer', 'Test data for refunds and part payments', 'R', 'm', false],
  ['ux-researcher', 'What the first five shops did on the review screen', 'R', 'm', false],
  ['devops-engineer', 'Preview links for every branch', 'W', 'm', false],
  ['database-engineer', 'Match a month of 5,000 payments in under a minute', 'W', 'm', false],
  ['brand-designer', 'Logo and the empty-state drawings', 'W', 'p', false],
  ['forms-engineer', 'Accept all matches above 99 percent in one go', 'QP', 'm', false],
  ['dashboard-engineer', 'Weekly match rate by email', 'QP', 'p', false],
  ['data-engineer', 'Merge the same customer across shops', 'WP', 'm', false],
  ['docs-writer', 'Script for a short video walkthrough', 'QP', 'p', false],
  ['vat-specialist', 'VAT on gift cards and vouchers', 'Q', 'p', false],
  ['head-of-quality', 'Quality gate before each release', 'Q', 'p', false],
  ['support-engineer', 'Answers to the five questions shops ask first', 'Q', 'p', false],
  ['office-manager', 'Book a demo shop with made-up statements', 'Q', 'p', false],
  ['release-manager', 'Version numbers and a change list for each release', 'Q', 'p', false],
  ['product-analyst', 'Time month-end takes before and after Ledger', 'Q', 'p', false],
];

const slugOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');

const LEDGER_DONE_WHEN: Record<string, string> = {
  design: 'The design is on the preview and the head of design has accepted it.',
  engineering: "It works on a real shop's data, its tests pass and it is on the work branch.",
  data: 'Every rule is written down with its source and checked against real statements.',
  quality: 'The checks run on every change, and a failure names the payment that caused it.',
  content: 'The texts are in the app and read well to a native speaker.',
};

/** Ledger's plan and the tasks its board holds, from the rows above: the same for the same moment. */
function ledgerWork(now: number): { plan: Plan; tasks: Task[] } {
  const rooms = new Map(LEDGER_SEATS.map((s) => [s.id, s.room]));
  const managers = new Map(LEDGER_SEATS.map((s) => [s.id, s.reportsTo ?? STAKEHOLDER]));
  const planTasks: PlanTask[] = [];
  const planOf = new Map<LedgerRow, PlanTask>();
  const lastOf = new Map<string, string>();
  for (const row of LEDGER_ROWS) {
    const [owner, title, , milestone, planned] = row;
    if (!planned) continue;
    const room = rooms.get(owner) ?? 'app';
    const before = lastOf.get(owner);
    const p: PlanTask = {
      id: `lp-${planTasks.length + 1}`, title, owner, files: [`src/${room}/${slugOf(title)}/`], milestone: LEDGER_MS[milestone], after: before ? [before] : [],
      brief: `${title}.`, doneWhen: LEDGER_DONE_WHEN[room] ?? 'Its owner reports it done and their manager accepts it.',
    };
    planTasks.push(p);
    planOf.set(row, p);
    lastOf.set(owner, p.id);
  }
  const plan: Plan = { goal: 'Shops match their bank statements to Shopify orders in minutes.', milestones: LEDGER_MILESTONES.map((m) => ({ ...m })), tasks: planTasks };

  const tasks = LEDGER_ROWS.filter((r) => r[3] !== 's').map((row, j): Task => {
    const [owner, title, state, milestone, , reason] = row;
    const paused = state === 'WP' || state === 'QP';
    const status: TaskStatus =
      state === 'D' ? 'done' : state === 'X' ? 'dropped' : state === 'B' ? 'blocked' : state === 'R' ? 'review' : state === 'W' || state === 'WP' ? 'working' : 'queued';
    const first = milestone === 'r';
    const created = first ? 1740 - j * 20 : 650 - (j % 25) * 6;
    const updated =
      first ? 700 + (26 - j) * 18
      : state === 'D' ? 40 + (j % 9) * 30
      : state === 'R' ? 30 + (j % 7) * 8
      : state === 'W' ? 22 + (j % 6) * 9
      : state === 'B' ? 60 + (j % 5) * 20
      : state === 'X' ? 90 + (j % 5) * 25
      : paused ? 21 + (j % 4) * 11
      : created;
    const p = planOf.get(row);
    return task(
      {
        id: `lt-${j + 1}`, title, owner, askedBy: managers.get(owner) ?? STAKEHOLDER, status, milestone: LEDGER_MS[milestone], files: p?.files ?? [],
        brief: p?.brief, doneWhen: p?.doneWhen, created, updated,
        ...(p ? { planTask: p.id } : {}),
        ...(status === 'done' ? { outcome: `${title}: on the work branch, with its tests.`, commit: hashText(title).toString(16).padStart(8, '0').slice(0, 7) } : {}),
        ...(status !== 'done' && status !== 'dropped' ? { priority: j + 1 } : {}),
        ...(paused ? { paused: { ago: updated, by: STAKEHOLDER } } : {}),
        ...(status === 'dropped' ? { cancel: { ago: updated, by: j % 2 === 0 ? STAKEHOLDER : 'ceo', reason: reason ?? 'Not needed for now.', branch: null } } : {}),
      },
      now,
    );
  });
  return { plan, tasks };
}

/** What each person was doing when the company paused: a desk that has worked is idle, one that has not is closed. */
function ledgerDesks(tasks: readonly Task[]): typeof CAFE_DESKS {
  const rand = seeded(hashText('ledger-desks'));
  return Object.fromEntries(
    LEDGER_SEATS.map((s) => {
      const mine = tasks.filter((t) => t.owner === s.id);
      const current = mine.find((t) => t.status === 'working') ?? mine.find((t) => t.status === 'review') ?? mine.find((t) => t.status === 'blocked');
      const worked = s.id === 'ceo' || mine.some((t) => t.status !== 'queued' && t.status !== 'dropped');
      const context = Math.round((0.15 + rand() * 0.7) * 100) / 100;
      const ago = current ? 20 : 60 + Math.round(rand() * 200);
      return [s.id, worked ? { state: 'idle' as DeskState, ago, task: current?.id ?? null, context } : { state: 'closed' as DeskState, ago: 90, task: null, context: null }];
    }),
  );
}

/** Each person's latest line, from their most active task, a while before the pause. */
function ledgerStatuses(tasks: readonly Task[], now: number): StatusLine[] {
  const out: StatusLine[] = [];
  LEDGER_SEATS.forEach((s, i) => {
    const mine = tasks.filter((t) => t.owner === s.id);
    const pick = (status: TaskStatus) => mine.filter((t) => t.status === status).at(-1);
    const t = pick('working') ?? pick('review') ?? pick('blocked') ?? pick('done');
    if (!t) return;
    const text =
      t.status === 'working' ? `Working on “${t.title}”.`
      : t.status === 'review' ? `Waiting for a review of “${t.title}”.`
      : t.status === 'blocked' ? `Stuck on “${t.title}”.`
      : `Finished “${t.title}”.`;
    out.push({ person: s.id, text, taskId: t.id, at: t.status === 'done' ? t.updatedAt : now - (21 + (i % 14) * 3) * MIN, cites: [] });
  });
  return out;
}

export function demoPausedView(now: number): CompanyView {
  const { plan, tasks } = ledgerWork(now);
  const desks = ledgerDesks(tasks);
  const statuses = ledgerStatuses(tasks, now);
  const rand = seeded(hashText('ledger-costs'));
  const costs: Record<string, number> = Object.fromEntries(LEDGER_SEATS.map((s) => [s.id, desks[s.id]?.context === null ? 0 : cents(s.id === 'ceo' ? 3.4 : 0.06 + rand() * 2.1)]));
  const people = peopleOfSeats('ledger', LEDGER_SEATS, desks, statuses, costs, now);
  const named = (id: string) => LEDGER_SEATS.find((s) => s.id === id)?.name ?? id;
  const taskOf = (title: string): Task => {
    const found = tasks.find((t) => t.title === title);
    if (!found) throw new Error(`Ledger has no task “${title}”`);
    return found;
  };
  // The office asks before these start, and two people ask you about work that waits on the answer.
  const gate = (n: number, title: string, ago: number): Question => {
    const t = taskOf(title);
    return {
      id: `lq-${n}`, from: THE_OFFICE, text: `${named(t.owner)} would like to start “${t.title}”. Start it, or hold it until you resume it?`, options: ['Start it', 'Not now'],
      recommended: null, taskId: t.id, askedAt: now - ago * MIN, answer: null, withdrawn: null, gate: { task: t.id },
    };
  };
  const questions: Question[] = [
    gate(1, 'VAT on gift cards and vouchers', 90),
    gate(2, 'Version numbers and a change list for each release', 70),
    gate(3, 'Time month-end takes before and after Ledger', 50),
    {
      id: 'lq-4', from: 'head-of-product', taskId: taskOf('Pricing: what a shop pays each month').id, askedAt: now - 140 * MIN, answer: null, withdrawn: null, gate: null,
      text: 'What should a shop pay each month? Most shops match between 200 and 2,000 payments, so a fixed price is simple, but a small shop would pay for what it never uses.',
      options: ['A fixed price per shop', 'A small price per matched payment', 'A fixed price plus a small price per matched payment'], recommended: 2,
    },
    {
      id: 'lq-5', from: 'matching-engineer', taskId: taskOf('Score uncertain matches and say why').id, askedAt: now - 45 * MIN, answer: null, withdrawn: null, gate: null,
      text: 'How sure must a match be before Ledger books it without asking the shop?', options: ['Nine in ten', 'Always ask in the first month', 'Always ask'], recommended: 1,
    },
  ];
  const view: CompanyView = {
    ...emptyCompany('ledger', 'Ledger'),
    phase: 'running',
    prompt: 'Swiss bookkeeping for Shopify shops: match bank statements to orders.',
    theme: 'office',
    people,
    statuses,
    goal: { text: plan.goal, setAt: now - 30 * HOUR, milestones: plan.milestones.map((m) => ({ ...m, doneAt: m.id === 'lms-read' ? now - 660 * MIN : null })) },
    tasks,
    messages: [message('lm-1', 'ceo', STAKEHOLDER, LEDGER_MILESTONE_REPORT, 660, 660, now)],
    questions,
    reports: [{ id: 'lr-1', person: 'ceo', to: STAKEHOLDER, taskId: null, outcome: 'progress', text: LEDGER_MILESTONE_REPORT, at: now - 660 * MIN, cites: [] }],
    log: [
      { at: now - 660 * MIN, kind: 'milestone', by: THE_OFFICE, text: 'Milestone done: Statements read.' },
      { at: now - 20 * MIN, kind: 'pause', by: STAKEHOLDER, text: 'You paused work.' },
    ],
    pause: { reason: 'stakeholder', since: now - 20 * MIN, until: null, message: 'You paused work.' },
    spend: spendFor(costs, now - 30 * HOUR, now, 'ledger', null),
    desks: deskCounts(people, 8),
    steering: ledgerSteering(now, people, plan),
  };
  view.inbox = inboxOf(view);
  return withSpending(view, now);
}

const LEDGER_MILESTONE_REPORT =
  'Statements read is done: PostFinance and UBS statements come in as payments, with their references. You approved matching and reports, so both have started.';

function ledgerSteering(now: number, people: readonly PersonView[], plan: Plan): SteeringView {
  const settings: SteeringSettings = { planApproval: 'milestones', leash: { people: dict(), rooms: dict() }, effort: dict() };
  const d = (id: string, ago: number, by: string, kind: Decision['kind'], what: string, extra: Parameters<typeof decision>[6] = {}) => decision(now, id, ago, by, kind, what, extra);
  return {
    plan: {
      versions: [{ version: 1, by: 'ceo', at: now - 29.5 * HOUR, plan: structuredClone(plan), note: 'Read the statements first, then match, then the reports, then ship.', cites: [] }],
      approved: { version: 1, through: 'lms-reports', at: now - 654 * MIN, by: STAKEHOLDER, cites: [] },
      comments: [],
      waiting: null,
    },
    acks: [],
    decisions: [
      d('d-1', 30 * 60, STAKEHOLDER, 'setting', 'You set plan approval to “At every milestone”.'),
      d('d-2', 29.5 * 60, 'ceo', 'plan', `The CEO proposed version 1 of the plan: four milestones and ${plan.tasks.length} tasks.`, { rooms: ['direction'], links: { planVersion: 1 } }),
      d('d-3', 29.4 * 60, STAKEHOLDER, 'plan', 'You approved version 1 of the plan through “Statements read”.', { people: [STAKEHOLDER, 'ceo'], rooms: ['direction'], links: { planVersion: 1 } }),
      d('d-4', 654, STAKEHOLDER, 'plan', 'You approved version 1 of the plan through “Reports for the accountant”.', { people: [STAKEHOLDER, 'ceo'], rooms: ['direction'], links: { planVersion: 1 } }),
    ],
    settings,
    people: personSteering(settings, people),
  };
}

/** Old site: the hub can't run it because its folder moved. */
export function demoBrokenView(now: number): CompanyView {
  return {
    ...emptyCompany('old-site', 'Old site'),
    phase: 'stopped',
    prompt: 'A new site for the bakery.',
    theme: 'shop',
    people: [soloCeo('old-site', 'closed', 3 * 24 * 60, now, [], 2.1)],
    problem: "Its folder isn't at C:\\Users\\you\\Projects\\old-site any more.",
    spend: { samples: [], hourly: [], byPerson: [{ person: 'ceo', today: 0, week: 2.1, all: 2.1 }] },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// v0.2: Rhine Swim, a small company that finished: the final review marked its checklist, and the CEO wrote the handover

const SWIM_SEATS: Seat[] = [
  seat('ceo', 'Lou', 'CEO', 'ceo', 'direction', null, 'opus'),
  seat('backend-engineer', 'Ben', 'Backend engineer', 'worker', 'engineering', 'ceo', 'sonnet'),
  seat('frontend-engineer', 'Ida', 'Frontend engineer', 'worker', 'engineering', 'ceo', 'sonnet', { prop: 'laptop' }),
  seat('copywriter', 'Rosa', 'Copywriter', 'worker', 'content', 'ceo', 'haiku', { prop: 'notebook' }),
  seat('qa-engineer', 'Nils', 'QA engineer', 'worker', 'quality', 'ceo', 'sonnet', { prop: 'clipboard' }),
];

const SWIM_PROMPT =
  'A page that tells Basel swimmers whether the Rhine is good for a swim today: water temperature, flow and the weather, in German and English, readable on a phone at the riverbank.';

const SWIM_MILESTONES: PlanMilestone[] = [
  { id: 'rs-data', title: 'River data in', doneWhen: 'Water temperature and flow from the federal river feed show on the page, never more than an hour old.' },
  { id: 'rs-page', title: 'The page, in both languages', doneWhen: 'A swimmer reads the verdict in German or English on a phone.' },
];

const SWIM_PLAN: Plan = {
  goal: SWIM_PROMPT,
  milestones: SWIM_MILESTONES,
  tasks: [
    { id: 'p-1', title: 'Read the river feed', owner: 'backend-engineer', files: ['src/data/river.ts'], milestone: 'rs-data', after: [], brief: "Read the water temperature and flow at the Basel gauge from the federal river feed every 15 minutes.", doneWhen: 'The page shows both figures, never more than an hour old.', check: 'npm test' },
    { id: 'p-2', title: 'Weather for the next hours', owner: 'backend-engineer', files: ['src/data/weather.ts'], milestone: 'rs-data', after: [], brief: 'Air temperature, rain and wind for the next three hours in Basel.', doneWhen: 'The next three hours show under the verdict.', check: 'npm test' },
    { id: 'p-3', title: 'The swim verdict and the page', owner: 'frontend-engineer', files: ['src/pages/', 'src/verdict.ts'], milestone: 'rs-page', after: ['p-1', 'p-2'], brief: 'One line that says whether today is good for a swim, and why, with the figures under it. Readable at 320 px in bright sun.', doneWhen: 'The verdict follows the rules in the brief and the page reads well at 320 px.', check: 'npm test' },
    { id: 'p-4', title: 'German and English words', owner: 'copywriter', files: ['content/'], milestone: 'rs-page', after: [], brief: 'Every word on the page in German and English, Swiss spelling.', doneWhen: 'A native speaker would sign off both languages.' },
    { id: 'p-5', title: 'When the river feed is down', owner: 'frontend-engineer', files: ['src/pages/stale.tsx'], milestone: 'rs-page', after: ['p-3'], brief: 'Say plainly when the figures are old or missing, and never give a verdict on old data.', doneWhen: 'With the feed down the page says so and gives no verdict.', check: 'npm test' },
    { id: 'p-6', title: 'Final review against your words', owner: 'qa-engineer', files: ['docs/review.md'], milestone: 'rs-page', after: ['p-3', 'p-4', 'p-5'], kind: 'verification', brief: 'Check the finished page against every item of the checklist, on a phone viewport, and mark each one.', doneWhen: 'Every checklist item is marked with its evidence.' },
  ],
  checklist: [
    { id: 'k-1', text: 'The page says whether today is good for a Rhine swim.', quote: 'tells Basel swimmers whether the Rhine is good for a swim today', covers: ['p-3'] },
    { id: 'k-2', text: 'It shows the water temperature.', quote: 'water temperature', covers: ['p-1', 'p-3'] },
    { id: 'k-3', text: "It shows how fast the river flows.", quote: 'flow', covers: ['p-1'] },
    { id: 'k-4', text: 'It shows the weather for the next hours.', quote: 'the weather', covers: ['p-2'] },
    { id: 'k-5', text: 'Everything on the page reads in German and English.', quote: 'in German and English', covers: ['p-4', 'p-5'] },
    { id: 'k-6', text: 'It reads well on a phone at the riverbank.', quote: 'readable on a phone at the riverbank', covers: ['p-3', 'p-5'] },
  ],
};

/** Who did each task, when it finished (minutes ago), and the files it changed. */
const SWIM_DONE: [string, number, string[]][] = [
  ['p-1', 230, ['src/data/river.ts', 'src/data/river.test.ts']],
  ['p-2', 215, ['src/data/weather.ts', 'src/data/weather.test.ts']],
  ['p-4', 150, ['content/de.json', 'content/en.json']],
  ['p-3', 112, ['src/pages/index.tsx', 'src/verdict.ts', 'src/verdict.test.ts', 'src/styles/page.css']],
  ['p-5', 88, ['src/pages/stale.tsx', 'src/pages/stale.test.tsx']],
  ['p-6', 58, ['docs/review.md']],
];

const SWIM_HANDOVER = [
  'Rhine Swim is built. The page says in one line whether today is good for a swim in the Rhine at Basel, with the water temperature, how fast the river flows and the weather for the next three hours under it, in German or English.',
  'To open it, start the preview in the office, or run the project and open the address it prints; a phone on the same network opens the same address. The river figures refresh every 15 minutes, and the page says so when they are more than an hour old.',
  "Not done: the note that shows when the river feed is down is in English only. Say the word and Rosa writes the German one; it is a small task.",
].join('\n\n');

/** The final review's verdicts: five met and one partly met, each with what Nils saw. */
function swimVerdicts(now: number): ChecklistVerdict[] {
  const at = now - 60 * MIN;
  const v = (item: string, verdict: ChecklistVerdict['verdict'], note: string, files: string[], page: string | null, check = true): ChecklistVerdict => ({
    item, version: 1, verdict, by: 'qa-engineer', task: 't-6', at,
    evidence: { note, check: check ? { ran: 'npm test', passed: true } : null, files, page },
  });
  return [
    v('k-1', 'met', 'The verdict reads "Good for a swim" at 19 °C water and a moderate flow, and "Not today" above the flow limit; the rules match the brief.', ['src/verdict.ts', 'src/verdict.test.ts'], '/'),
    v('k-2', 'met', 'The water temperature shows under the verdict, 12 minutes old when checked.', ['src/data/river.ts'], '/'),
    v('k-3', 'met', 'The flow shows in cubic metres a second, with a plain word beside it: calm, moderate or strong.', ['src/data/river.ts'], '/'),
    v('k-4', 'met', 'Air temperature, rain and wind for the next three hours show in a row under the figures.', ['src/data/weather.ts'], '/'),
    v('k-5', 'partly', 'The verdict, the figures and the weather read in both languages. The note shown when the river feed is down is in English only.', ['content/de.json', 'src/pages/stale.tsx'], '/?lang=de', false),
    v('k-6', 'met', 'Checked at 320 and 375 px: the verdict is the largest text and stays readable at full brightness.', ['src/styles/page.css'], '/'),
  ];
}

/** Rhine Swim: done an hour ago, its checklist marked by the final review and the CEO's handover written. */
export function demoFinishedView(now: number): CompanyView {
  const at = (minutes: number) => now - minutes * MIN;
  const doneAt = at(55);
  const tasks: Task[] = SWIM_DONE.map(([planTask, ago, files], i) => {
    const p = SWIM_PLAN.tasks.find((t) => t.id === planTask);
    if (!p) throw new Error(`Rhine Swim's plan has no task ${planTask}.`);
    return {
      id: `t-${Number(planTask.slice(2))}`, title: p.title, brief: p.brief, owner: p.owner, askedBy: 'ceo', files, doneWhen: p.doneWhen, status: 'done',
      outcome: null, parent: null, milestone: p.milestone, worktree: null, commit: `5a${i}c${i}e7`, createdAt: at(270), updatedAt: at(ago), paused: null, cancel: null,
      handovers: [], planTask, cites: [],
    };
  });
  const reports: Report[] = [
    ...tasks.map((t, i) => ({
      id: `sr-${i + 1}`, person: t.owner, to: 'ceo', taskId: t.id, outcome: 'done' as const, at: t.updatedAt, cites: [], files: t.files,
      text: t.planTask === 'p-6' ? 'Final review done: five checklist items met, one partly met (the feed-down note is English only).' : `${t.title} is done.`,
    })),
    { id: 'sr-9', person: 'ceo', to: STAKEHOLDER, taskId: null, outcome: 'done', text: SWIM_HANDOVER, at: at(50), cites: [] },
  ];
  const statuses: StatusLine[] = [
    { person: 'qa-engineer', text: 'Marked the checklist: five met, one partly met.', taskId: 't-6', at: at(58), cites: [] },
    { person: 'ceo', text: 'Wrote the handover.', taskId: null, at: at(50), cites: [] },
  ];
  const costs: Record<string, number> = { ceo: 3.12, 'backend-engineer': 1.94, 'frontend-engineer': 2.71, copywriter: 0.38, 'qa-engineer': 1.29 };
  const people = peopleOfSeats('rhine-swim', SWIM_SEATS, {}, statuses, costs, now);
  const plan: PlanView = {
    versions: [{ version: 1, by: 'ceo', at: at(275), plan: structuredClone(SWIM_PLAN), note: 'The river data first, then the page in both languages; Nils checks it against your words at the end.', cites: [] }],
    approved: { version: 1, through: null, at: at(272), by: STAKEHOLDER, cites: [] },
    comments: [],
    waiting: null,
  };
  const d = (id: string, ago: number, by: string, kind: Decision['kind'], what: string, extra: Parameters<typeof decision>[6] = {}) => decision(now, id, ago, by, kind, what, extra);
  const settings: SteeringSettings = { planApproval: 'before-work', leash: { people: dict(), rooms: dict() }, effort: dict() };
  const view: CompanyView = {
    ...emptyCompany('rhine-swim', 'Rhine Swim'),
    phase: 'running',
    prompt: SWIM_PROMPT,
    theme: 'garden',
    people,
    goal: { text: SWIM_PROMPT, setAt: at(276), milestones: SWIM_MILESTONES.map((m) => ({ ...m, doneAt: m.id === 'rs-data' ? at(214) : doneAt })) },
    tasks,
    statuses,
    reports,
    messages: [message('sm-1', 'ceo', STAKEHOLDER, SWIM_HANDOVER.split('\n\n')[0] ?? '', 50, 50, now)],
    log: [
      { at: at(290), kind: 'founded', by: STAKEHOLDER, text: 'You started Rhine Swim.' },
      { at: at(280), kind: 'started', by: STAKEHOLDER, text: 'You started the company. Everyone walked in.' },
      { at: at(214), kind: 'milestone', by: THE_OFFICE, text: 'Milestone done: River data in.' },
      { at: doneAt, kind: 'milestone', by: THE_OFFICE, text: 'Milestone done: The page, in both languages.' },
      { at: doneAt, kind: 'finished', by: THE_OFFICE, text: 'Every task and milestone is done.' },
    ],
    settings: { maxDesks: 4, idleMs: DEFAULT_IDLE_MS, billing: 'plan', alwaysAllow: [], ...spendingSettings('lean', { company: 15, person: null }) },
    desks: deskCounts(people, 4),
    preview: { state: 'off', url: null, command: 'npm run dev', problem: null },
    // Nobody has worked since the end, so nothing burns now.
    spend: (() => {
      const spend = spendFor(costs, at(290), now, 'rhine-swim', null);
      return { ...spend, samples: spend.samples.filter((s) => s.at < doneAt) };
    })(),
    done: doneAt,
    steering: {
      plan,
      acks: [],
      decisions: [
        d('d-1', 272, STAKEHOLDER, 'plan', 'You approved version 1 of the plan.', { people: [STAKEHOLDER, 'ceo'], rooms: ['direction'], links: { planVersion: 1 } }),
        d('d-2', 140, 'frontend-engineer', 'decide', 'The verdict says "Not today" when the river flows faster than the swim limit, whatever the weather.', { rooms: ['engineering'] }),
        d('d-3', 60, 'qa-engineer', 'decide', 'Nils marked the checklist: five met, one partly met.', { rooms: ['quality'] }),
      ],
      settings,
      people: personSteering(settings, people),
    },
    // Alex last looked two hours ago, while the page was being built.
    looked: { last: now - 2 * HOUR, previous: now - 20 * HOUR },
  };
  view.inbox = inboxOf(view);
  return withOverview(withSpending(view, now), now, swimVerdicts(now));
}

const DEMO_ROOTS: Record<string, string> = {
  demo: 'C:\\Users\\you\\Projects\\cafe-lumen',
  'rhine-swim': 'C:\\Users\\you\\Projects\\rhine-swim',
  'plant-pal': 'C:\\Users\\you\\Projects\\plant-pal',
  'lake-wind': 'C:\\Users\\you\\Sites\\lake-wind',
  ledger: 'C:\\Users\\you\\Projects\\ledger',
  'old-site': 'C:\\Users\\you\\Projects\\old-site',
};

/** Every company in the demo lobby, by id. */
export function demoCompanies(now: number): CompanyView[] {
  return [demoCompanyView(now), demoProposalView(now), demoFoundingView(now), demoPausedView(now), demoFinishedView(now), demoBrokenView(now)];
}

/** Where a demo company's folder is. */
export const demoRoot = (id: string): string => DEMO_ROOTS[id] ?? `C:\\Users\\you\\Projects\\${id}`;

/** A company as the lobby lists it, from its view, with v0.2's TL;DR as the hub writes it. */
export function lobbyEntryOf(view: CompanyView, root: string, now: number = Date.now()): LobbyCompany {
  const latest = view.statuses.reduce<StatusLine | null>((best, s) => (!best || s.at > best.at ? s : best), null);
  return {
    id: view.id,
    name: view.name,
    root,
    phase: view.phase,
    theme: view.theme,
    // Names as the real company gives them (src/company/view.ts), so a row's latest line says whose it is.
    people: view.people.map((p) => ({ id: p.id, name: p.name, room: p.room, state: p.desk.state, look: p.look })),
    working: view.desks.working,
    waiting: view.desks.waiting,
    needsYou: view.inbox,
    pause: view.pause,
    spend: cents(view.people.reduce((s, p) => s + p.cost, 0)),
    latest,
    problem: view.problem,
    // A company that can't run has no summary, as the hub has none for one it can't read: its row stays the old one.
    ...(view.problem === null ? { summary: summaryOf(summaryInputOfView(view), now) } : {}),
  };
}

/** The demo lobby: the café, a proposal waiting, a CEO drafting, a paused company and one that can't run. */
export function demoLobby(now: number, companies: CompanyView[] = demoCompanies(now)): LobbyView {
  const entries = companies.map((c) => lobbyEntryOf(c, demoRoot(c.id), now));
  return { companies: entries, hub: { maxDesks: 12, working: entries.reduce((s, c) => s + c.working, 0) }, serverTime: now };
}

// ---------------------------------------------------------------------------------------------------------------
// The snapshot around a company: v2's office reads the studio, agents and totals

const DEPARTMENT_NAMES: Record<BaseDepartment, string> = {
  direction: 'Direction', design: 'Design', engineering: 'Engineering', quality: 'Quality', security: 'Security', content: 'Content', data: 'Data & AI', ops: 'Ops & Release', art: 'Art & Audio',
};

const isBase = (id: string): id is BaseDepartment => Object.hasOwn(DEPARTMENT_NAMES, id);

const FIRED: Record<string, FiredRole[]> = {
  demo: [
    { id: 'social-media-manager', department: 'content', title: 'Social media manager', file: '.claude/agents/.fired/social-media-manager.md', name: 'Sam', level: 'worker', reportsTo: 'head-of-content' },
    { id: 'food-photographer', department: 'design', title: 'Food photographer', file: '.claude/agents/.fired/food-photographer.md', name: 'Lou', level: 'worker', reportsTo: 'head-of-design' },
  ],
};

const DECOR: Partial<Record<Theme, string[]>> = {
  cafe: ['chalkboard-menu', 'pastry-case', 'espresso-machine', 'plant', 'plant', 'coat-rack', 'bistro-table'],
  garden: ['planter', 'watering-can', 'plant'],
  office: ['water-cooler', 'plant'],
};

/** What the office knows beyond the CompanyView: room names and themes, decor and who was fired. */
export interface StudioExtras {
  departments?: StudioDepartment[];
  decor?: string[];
  fired?: FiredRole[];
}

/** The studio a company's office draws: its rooms and people as studio.yaml records them. */
export function studioOf(view: CompanyView, extras: StudioExtras = {}): Studio {
  const known = extras.departments ?? CAFE_ROOMS;
  const rooms = [...new Set(view.people.map((p) => p.room))];
  const departments: StudioDepartment[] = rooms.map((id) => known.find((r) => r.id === id) ?? { id, name: isBase(id) ? DEPARTMENT_NAMES[id] : id, style: isBase(id) ? id : 'engineering' });
  return {
    version: 1,
    name: view.name,
    domain: 'web-app',
    rigor: 'standard',
    office: { theme: view.theme, rooms: view.rooms, decor: extras.decor ?? DECOR[view.theme] ?? [] },
    departments,
    roles: view.people.map((p) => ({ id: p.id, department: p.room, title: p.title, name: p.name, level: p.level, ...(p.reportsTo ? { reportsTo: p.reportsTo } : {}), look: p.look })),
    rules: [],
    gates: [],
    skills: [],
    fired: extras.fired ?? FIRED[view.id] ?? [],
  };
}

/** The decor a demo company starts with. */
export const demoDecor = (view: Pick<CompanyView, 'theme'>): string[] => [...(DECOR[view.theme] ?? [])];

/** The roles a demo company has let go of. */
export const demoFired = (id: string): FiredRole[] => [...(FIRED[id] ?? [])];

/** The rooms of the café, with their names and looks. */
export const DEMO_DEPARTMENTS: readonly StudioDepartment[] = CAFE_ROOMS;

/** A desk's session as v2's office sees it: the person at their desk, working or between turns. */
function agentOf(p: PersonView, view: CompanyView): AgentState | null {
  if (!p.desk.sessionId || !p.agentKey) return null;
  const working = p.desk.state === 'working' || p.desk.state === 'starting' || p.desk.state === 'stopping';
  const waitingOnYou = view.approvals.some((a) => a.person === p.id && !a.answer && !a.withdrawn);
  const task = p.task ? (view.tasks.find((t) => t.id === p.task)?.title ?? null) : null;
  return {
    key: p.agentKey, sessionId: p.desk.sessionId, agentId: null, agentType: p.id, kind: 'role', roleId: p.id, name: p.title, task, purpose: view.goal?.text ?? null,
    briefedAt: null, status: p.desk.state === 'failed' ? 'error' : waitingOnYou ? 'waiting' : working ? 'working' : 'idle', statusSince: p.desk.since, busySince: p.desk.since,
    tool: null, skill: null, startedAt: p.desk.since - 30 * MIN, lastEventAt: p.status?.at ?? p.desk.since, endedAt: null, toolCalls: 0, toolErrors: 0, files: [], usage: ZERO_USAGE,
    requests: 0, models: {}, costEstimate: p.cost, costReported: null, reportedRequests: 0, unpricedTokens: 0, lastMessage: null, reportedAt: null,
    contextTokens: Math.round((p.desk.context ?? 0) * 160_000), question: null,
    waitingFor: waitingOnYou ? (view.approvals.find((a) => a.person === p.id && !a.answer && !a.withdrawn)?.summary ?? null) : null,
    refused: null, error: p.desk.state === 'failed' ? p.desk.problem : null, errorFrom: p.desk.state === 'failed' ? 'turn' : null,
  };
}

/** The office's snapshot with the company in it, as the hub would send it for a demo. */
export function demoSnapshot(view: CompanyView, root: string, now: number, extras: StudioExtras = {}): Snapshot {
  const agents = view.people.map((p) => agentOf(p, view)).filter((a): a is AgentState => a !== null);
  const cost = view.people.reduce((s, p) => s + p.cost, 0);
  const lastHour = view.spend.samples.filter((s) => s.at > now - HOUR).reduce((s, x) => s + x.cost, 0);
  const aside = emptyAsideView(now - HOUR);
  return {
    project: { name: view.name, root },
    mode: 'demo',
    studio: studioOf(view, extras),
    studioSource: 'manifest',
    studioErrors: [],
    sessions: [],
    agents,
    tasks: [],
    gateRuns: [],
    activity: [],
    totals: { usage: ZERO_USAGE, cost: cents(cost), costExact: view.settings.billing === 'api-key', unpricedTokens: 0, active: view.desks.working },
    archived: { sessions: 0, people: [] },
    burn: { dollarsPerHour: view.pause ? 0 : cents(lastHour) },
    hooks: { lastEventAt: null, ignored: 0 },
    replay: null,
    aside: { ...aside, catchUp: { ...aside.catchUp, nothingNew: false } },
    company: view,
    serverTime: now,
    pricesAsOf: '2026-11-05',
  };
}

/** The library's role ids, as the hub knows them, for the demo's stand-in of the hub's proposal check. */
export const DEMO_LIBRARY: readonly string[] = [
  '3d-artist', 'accessibility-specialist', 'ai-engineer', 'analytics-engineer', 'architect', 'art-director', 'automation-engineer', 'backend-engineer', 'builder', 'ceo',
  'code-reviewer', 'copywriter', 'data-engineer', 'desktop-engineer', 'devops-engineer', 'docs-writer', 'engine-specialist', 'extension-engineer', 'frontend-engineer',
  'game-designer', 'game-programmer', 'head', 'level-designer', 'library-engineer', 'localization-specialist', 'ml-engineer', 'mobile-engineer', 'narrative-writer',
  'office-manager', 'performance-engineer', 'privacy-officer', 'producer', 'product-manager', 'qa-engineer', 'release-manager', 'reviewer', 'runtime-engineer', 'security-reviewer',
  'seo-specialist', 'sound-designer', 'technical-artist', 'tester', 'ui-designer', 'ux-designer',
];

/** Library roles the demo offers for "Add someone" (the hub lists the real library through its studio route). */
export function demoCatalogue(): CatalogRole[] {
  const role = (id: string, title: string, department: BaseDepartment, description: string, model = 'sonnet'): CatalogRole => ({ id, title, department, description, model });
  return [
    role('copywriter', 'Copywriter', 'content', 'Writes the words people read: pages, buttons, emails and announcements.'),
    role('seo-specialist', 'SEO specialist', 'content', 'Makes pages findable: titles, structured data, speed and local search.'),
    role('localization-specialist', 'Localization specialist', 'content', 'Carries the product into other languages and regions.'),
    role('docs-writer', 'Docs writer', 'content', 'Writes guides, references and changelogs, checked against the code.'),
    role('frontend-engineer', 'Frontend engineer', 'engineering', 'Builds the web front end, responsive and fast to load.'),
    role('backend-engineer', 'Backend engineer', 'engineering', 'Builds endpoints, data models, jobs and integrations.'),
    role('mobile-engineer', 'Mobile engineer', 'engineering', 'Builds the iPhone and Android apps.', 'inherit'),
    role('ui-designer', 'UI designer', 'design', 'Shapes the visual system: tokens, components and their states.'),
    role('ux-designer', 'UX designer', 'design', 'Designs flows and screens with every state decided before building.'),
    role('qa-engineer', 'QA engineer', 'quality', 'Tests changes the way people meet them and reports with evidence.'),
    role('accessibility-specialist', 'Accessibility specialist', 'quality', 'Audits and fixes accessibility: keyboard, screen readers, contrast.'),
    role('privacy-officer', 'Privacy officer', 'security', 'Keeps personal data lawful and minimal, with the notices that go with it.'),
  ];
}
