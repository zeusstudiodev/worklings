// What the browser and the lobby get from a company: the state, the org and the live desks, in the contract's shapes.
import type { DeskWork } from '../core/plain.ts';
import { checklistView } from '../core/checklist.ts';
import { blankDesk, type CompanyState, type DeskRecord, dict, HOUR_MS, isOpenItem, own } from '../core/company-state.ts';
import {
  type CompanyView,
  type DeskView,
  type InboxBatch,
  type LobbyCompany,
  type Person,
  type PersonView,
  type SpendView,
  type StalledView,
  type StatusLine,
  type Task,
  VIEW_LIMITS,
} from '../core/company.ts';
import { newestMessages } from '../core/message-pages.ts';
import { proposalLoadCosts } from '../core/org.ts';
import { AT_WORK, isAtWork, sinceOf, sinceStart, summaryOf } from '../core/overview.ts';
import { approvedVersion, latestVersion, planInbox, planWaitingFor } from '../core/plan.ts';
import { planSummaryOf } from '../core/plan-summary.ts';
import { companySize } from '../core/size.ts';
import { type InstalledCatalogue, spendingViewOf } from '../core/spending.ts';
import { steeringView, type UndoPlan } from '../core/steering-state.ts';
import type { ChecklistView } from '../core/steering.ts';
import type { Studio } from '../core/studio.ts';

/** Context tokens taken as a full desk, for tiredness when the switchboard doesn't say. */
export const CONTEXT_TOKENS = 200_000;

export interface ViewInput {
  state: CompanyState;
  people: readonly Person[];
  /** A person's model, from their agent file. */
  modelOf: (person: string) => string;
  /** The switchboard's desks. */
  desks: readonly DeskView[];
  studio: Studio | null;
  root: string;
  now: number;
  problem: string | null;
  /** start() is hiring everyone and making the work branch. */
  starting: boolean;
  /** Whether a decision's undo can run now, which only the company can tell; without it, the log alone decides. */
  undoPossible?: (undo: UndoPlan) => boolean;
  /** Work that stopped with tasks open, as the company found it; none when not given. */
  stalled?: StalledView | null;
  /** The model the user's `ANTHROPIC_MODEL` runs everyone on, when it is set; none when not given. */
  modelOverride?: string | null;
  /** What the user has installed, for the proposal; the view drops it once the company has started. */
  catalogue?: InstalledCatalogue | null;
  /** v0.7: a plain desk's own todo list and subagents, read from its stream. */
  work?: DeskWork | null;
}

const newest = <T>(list: readonly T[], max: number): T[] => list.slice(Math.max(0, list.length - max));

/** The newest entries up to `max`, never leaving out one that is still open. */
function keepOpen<T>(list: readonly T[], max: number, open: (item: T) => boolean): T[] {
  if (list.length <= max) return list.slice();
  const openCount = list.filter(open).length;
  let closedRoom = Math.max(0, max - openCount);
  const keep = new Set<T>();
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (item === undefined) continue;
    if (open(item)) keep.add(item);
    else if (closedRoom > 0) {
      keep.add(item);
      closedRoom -= 1;
    }
  }
  return list.filter((item) => keep.has(item));
}

/**
 * The task a person is on: the newest they work on, else the newest waiting for them or for a review. Tasks in
 * `notYet` haven't reached them (`notHandedOut`), so they aren't on them yet.
 */
export function currentTask(tasks: readonly Task[], person: string, notYet: ReadonlySet<string> = new Set()): Task | undefined {
  for (const status of ['working', 'queued', 'blocked', 'review'] as const) {
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      const t = tasks[i];
      if (t && t.owner === person && t.status === status && !notYet.has(t.id)) return t;
    }
  }
  return undefined;
}

/**
 * Tasks that haven't reached their owner yet: the plan's tasks whose turn hasn't come, and tasks waiting for the
 * stakeholder's start because their owner checks with them first.
 */
export function notHandedOut(state: Pick<CompanyState, 'tasks' | 'assignments' | 'steering'>): Set<string> {
  const handed = new Set(Object.values(state.assignments));
  const out = new Set(state.tasks.filter((t) => t.planTask && t.status === 'queued' && !handed.has(t.id)).map((t) => t.id));
  for (const message of Object.keys(state.steering.gates)) {
    const task = own(state.assignments, message);
    if (task !== undefined) out.add(task);
  }
  return out;
}

const contextOf = (d: DeskRecord): number | null => (d.contextTokens === null ? null : Math.min(1, d.contextTokens / CONTEXT_TOKENS));

/** A person's desk as the office shows it: the switchboard's view, or what the company remembers when they have none. */
export function deskViewOf(state: CompanyState, person: string, live: DeskView | undefined): DeskView {
  const d = own(state.desks, person) ?? blankDesk();
  const context = contextOf(d);
  if (d.awaySince !== null) return { person, state: 'away', sessionId: d.sessionId, since: d.awaySince, context, problem: null, queue: null };
  if (live) return { ...live, sessionId: live.sessionId ?? d.sessionId, context: live.context ?? context };
  return { person, state: 'closed', sessionId: d.sessionId, since: d.lastTurnAt ?? state.createdAt, context, problem: null, queue: null };
}

const startOfDay = (now: number): number => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** What a desk has cost: its ended turns, and what its transcripts showed of a turn that never got priced. */
const spentOf = (d: DeskRecord): number => d.cost + d.unpriced;

/** Spend for the Spend dashboard: the newest turns, each hour of the last week, and each person's totals. */
export function spendView(state: CompanyState, now: number): SpendView {
  const thisHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const firstHour = thisHour - (7 * 24 - 1) * HOUR_MS;
  const perHour = new Map<number, number>();
  const byPerson = new Map<string, { today: number; week: number; all: number }>();
  for (const [person, d] of Object.entries(state.desks)) if (spentOf(d) > 0) byPerson.set(person, { today: 0, week: 0, all: spentOf(d) });
  const today = startOfDay(now);
  for (const h of state.spendHours) {
    for (const [person, cost] of Object.entries(h.byPerson)) {
      if (h.hour >= firstHour && h.hour <= thisHour) perHour.set(h.hour, (perHour.get(h.hour) ?? 0) + cost);
      const totals = byPerson.get(person) ?? { today: 0, week: 0, all: 0 };
      if (h.hour >= today) totals.today += cost;
      if (h.hour >= firstHour) totals.week += cost;
      byPerson.set(person, totals);
    }
  }
  const hourly: SpendView['hourly'] = [];
  for (let hour = firstHour; hour <= thisHour; hour += HOUR_MS) hourly.push({ hour, cost: perHour.get(hour) ?? 0 });
  return {
    samples: newest(state.spend, VIEW_LIMITS.spend),
    hourly,
    byPerson: [...byPerson].map(([person, totals]) => ({ person, ...totals })).sort((a, b) => b.all - a.all || a.person.localeCompare(b.person)),
  };
}

/** Everyone's spend by person, cost plus what transcripts showed of unfinished turns: what the budget counts. */
export function spentByPerson(state: Pick<CompanyState, 'desks'>): Record<string, number> {
  const out: Record<string, number> = dict<number>();
  for (const [person, d] of Object.entries(state.desks)) if (spentOf(d) > 0) out[person] = spentOf(d);
  return out;
}

/** The plan's tasks not done or dropped yet: what is left to spend on. Null while there is no plan. */
export function planTasksLeft(state: Pick<CompanyState, 'steering' | 'tasks'>): number | null {
  const version = latestVersion({ versions: state.steering.versions });
  if (!version) return null;
  return version.plan.tasks.filter((pt) => {
    const id = own(state.steering.planTasks, pt.id);
    const task = id === undefined ? undefined : state.tasks.find((t) => t.id === id);
    return !task || (task.status !== 'done' && task.status !== 'dropped');
  }).length;
}

/** The id of the open "How thorough?" question, if there is one. */
export function openPresetQuestion(state: Pick<CompanyState, 'questions'>, now: number): string | null {
  return state.questions.find((q) => q.preset === true && isOpenItem(q, now))?.id ?? null;
}

/**
 * The open questions and approvals grouped by the batch they were raised in (CompanyState keeps each item's `batch`), oldest
 * batch first. An item from before batches existed stands alone. The inbox shows each group once, with one press for its
 * recommendations.
 */
export function inboxBatches(state: Pick<CompanyState, 'questions' | 'approvals'>, now: number): InboxBatch[] {
  const batches = new Map<string, InboxBatch>();
  const add = (kind: 'question' | 'approval', item: { id: string; batch?: string | null; askedAt: number }) => {
    const id = item.batch ?? item.id;
    const batch = batches.get(id) ?? { id, at: item.askedAt, items: [] };
    batch.at = Math.min(batch.at, item.askedAt);
    batch.items.push({ kind, id: item.id });
    batches.set(id, batch);
  };
  for (const q of state.questions) if (isOpenItem(q, now)) add('question', q);
  for (const a of state.approvals) if (isOpenItem(a, now)) add('approval', a);
  return [...batches.values()].sort((a, b) => a.at - b.at);
}

export const inboxCount = (state: CompanyState, now: number): number =>
  state.questions.filter((q) => isOpenItem(q, now)).length +
  state.approvals.filter((a) => isOpenItem(a, now)).length +
  (state.phase === 'proposed' && state.proposal ? 1 : 0) +
  // A plan version that waits for approval, or a milestone done whose next one waits.
  planInbox({ versions: state.steering.versions, approved: state.steering.approved, waiting: state.steering.waiting }, state.steering.settings);

/** v0.2: the checklist of the approved plan, else of the latest version, with the final review's verdicts; null without one. */
export function checklistOf(state: Pick<CompanyState, 'steering' | 'tasks'>): ChecklistView | null {
  const plan = { versions: state.steering.versions, approved: state.steering.approved };
  return checklistView(approvedVersion(plan) ?? latestVersion(plan), state.steering.verdicts, state.tasks, state.steering.planTasks, state.steering.versions);
}

export function buildView(i: ViewInput): CompanyView {
  const s = i.state;
  const live = new Map(i.desks.map((d) => [d.person, d]));
  const latest = new Map<string, StatusLine>();
  for (const status of s.statuses) latest.set(status.person, status);
  const notYet = notHandedOut(s);
  // The same projection as a page of earlier messages (GET /api/c/<id>/messages), so neither shows more than the other.
  const shown = newestMessages(s.messages, s.acks);
  const people: PersonView[] = i.people.map((p) => ({
    ...p,
    look: { ...p.look },
    model: i.modelOf(p.id),
    desk: deskViewOf(s, p.id, live.get(p.id)),
    task: currentTask(s.tasks, p.id, notYet)?.id ?? null,
    status: latest.get(p.id) ?? null,
    agentKey: null,
    cost: spentOf(own(s.desks, p.id) ?? blankDesk()),
    context: { tokens: (own(s.desks, p.id) ?? blankDesk()).contextTokens, fresh: (own(s.desks, p.id) ?? blankDesk()).fresh },
  }));
  const spending = spendingViewOf({
    settings: s.settings,
    phase: s.phase,
    proposal: s.proposal,
    people: people.map((p) => ({ id: p.id, level: p.level, model: p.model })),
    planTasks: planTasksLeft(s),
    spentBy: spentByPerson(s),
    samples: s.spend,
    now: i.now,
    modelOverride: i.modelOverride ?? null,
    presetQuestion: openPresetQuestion(s, i.now),
    loads: s.phase === 'proposed' && s.proposal ? proposalLoadCosts(s.proposal) : null,
    catalogue: i.catalogue ?? null,
  });
  // A plan version that waits for approval, in everyday words: the size, what starts first and what it should cost.
  const newestPlan = latestVersion({ versions: s.steering.versions });
  const waiting = newestPlan !== null && planWaitingFor({ versions: s.steering.versions, approved: s.steering.approved, waiting: s.steering.waiting }, s.steering.settings)?.kind === 'plan';
  const planSummary =
    waiting && newestPlan
      ? planSummaryOf({ version: newestPlan, people: i.people, size: companySize(i.people, s.proposal?.size), job: spending.job })
      : null;
  return {
    id: s.id,
    name: s.name,
    phase: s.phase,
    prompt: s.prompt,
    shape: s.shape,
    ...(s.shape === 'plain' ? { launch: { ...s.launch }, todos: i.work?.todos ?? [], helpers: i.work?.helpers ?? [] } : {}),
    stakeholder: s.stakeholder,
    branch: s.branch,
    theme: i.studio?.office?.theme ?? s.proposal?.theme ?? 'office',
    rooms: (i.studio?.office?.rooms ?? []).map((r) => ({ ...r })),
    goal: s.goal,
    people,
    proposal: s.proposal,
    tasks: s.tasks.slice(),
    messages: shown.messages,
    questions: keepOpen(s.questions, VIEW_LIMITS.questions, (q) => isOpenItem(q, i.now)),
    approvals: keepOpen(s.approvals, VIEW_LIMITS.approvals, (a) => isOpenItem(a, i.now)),
    statuses: newest(s.statuses, VIEW_LIMITS.statuses),
    reports: newest(s.reports, VIEW_LIMITS.reports),
    dashboards: s.dashboards.slice(),
    screenshots: newest(s.screenshots, VIEW_LIMITS.screenshots),
    spend: spendView(s, i.now),
    log: newest(s.log, VIEW_LIMITS.log),
    pause: s.pause,
    settings: { ...s.settings, alwaysAllow: [...s.settings.alwaysAllow], models: { ...s.settings.models }, budget: { ...s.settings.budget } },
    desks: {
      working: i.desks.filter((d) => AT_WORK.includes(d.state)).length,
      waiting: i.desks.filter((d) => d.state === 'waiting').length,
      max: s.settings.maxDesks,
    },
    preview: { state: 'off', url: null, command: null, problem: null },
    inbox: inboxCount(s, i.now),
    seen: Object.assign(dict<number>(), s.seen),
    proposalEdited: s.proposalEdited,
    starting: i.starting,
    // The plan, the decision log, the leash and effort per person, with the acknowledgements of the messages shown.
    steering: steeringView({ steering: s.steering, acks: shown.acks, people: i.people, ...(i.undoPossible ? { possible: i.undoPossible } : {}) }),
    drafting:
      s.phase === 'founding'
        ? { refused: s.drafting.refused, firstRefusal: s.drafting.firstRefusal, stopped: s.drafting.stopped ? { at: s.drafting.stopped.at, words: s.drafting.stopped.words } : null }
        : null,
    spending,
    batches: inboxBatches(s, i.now),
    planSummary,
    scoping: s.scoping ? { questions: [...s.scoping.questions], askedAt: s.scoping.askedAt, answeredAt: s.scoping.answeredAt } : null,
    problem: i.problem,
    done: s.done,
    stalled: i.stalled ?? null,
    looked: { ...s.looked },
    since: sinceView(s, i.people, i.now),
    checklist: checklistOf(s),
  };
}

/** What happened since the stakeholder last looked; null on their first look. */
function sinceView(s: CompanyState, people: readonly Person[], now: number): CompanyView['since'] {
  const start = sinceStart(s.looked, now);
  if (start === null) return null;
  return sinceOf(
    { tasks: s.tasks, reports: s.reports, decisions: s.steering.decisions, people, stakeholder: s.stakeholder, spend: s.spend, questions: s.questions, approvals: s.approvals },
    start,
    now,
  );
}

export function lobbyEntryOf(i: ViewInput): LobbyCompany {
  const s = i.state;
  const live = new Map(i.desks.map((d) => [d.person, d]));
  // The budget's own total (spendingViewOf's), and who is at work as the company's view shows them (buildView), so this
  // card and the office's progress view (summaryInputOfView) say the same.
  const spend = Object.values(spentByPerson(s)).reduce((n, v) => n + v, 0);
  const notYet = notHandedOut(s);
  const working = i.people
    .filter((p) => isAtWork(deskViewOf(s, p.id, live.get(p.id)).state))
    .map((p) => ({ id: p.id, name: p.name, task: currentTask(s.tasks, p.id, notYet)?.title ?? null }));
  const plan = s.steering.versions.length > 0 ? { versions: s.steering.versions, approved: s.steering.approved, waiting: s.steering.waiting } : null;
  const summary = summaryOf(
    {
      id: s.id,
      phase: s.phase,
      prompt: s.prompt,
      goal: s.goal,
      tasks: s.tasks,
      questions: s.questions,
      approvals: s.approvals,
      reports: s.reports,
      statuses: s.statuses,
      log: s.log,
      pause: s.pause,
      problem: i.problem,
      done: s.done,
      stalled: i.stalled ?? null,
      plan,
      planApproval: s.steering.settings.planApproval,
      people: i.people,
      working,
      spent: spend,
      budget: s.settings.budget.company,
      checklist: checklistOf(s)?.counts ?? null,
    },
    i.now,
  );
  return {
    id: s.id,
    name: s.name,
    root: i.root,
    phase: s.phase,
    theme: i.studio?.office?.theme ?? s.proposal?.theme ?? 'office',
    people: i.people.map((p) => ({ id: p.id, name: p.name, room: p.room, state: deskViewOf(s, p.id, live.get(p.id)).state, look: { ...p.look } })),
    working: i.desks.filter((d) => AT_WORK.includes(d.state)).length,
    waiting: i.desks.filter((d) => d.state === 'waiting').length,
    needsYou: inboxCount(s, i.now),
    pause: s.pause,
    spend,
    latest: s.statuses.at(-1) ?? null,
    problem: i.problem,
    starting: i.starting,
    summary,
  };
}
