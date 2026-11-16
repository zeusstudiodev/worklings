// v0.2, "Simple, visible, proven" (SPEC-v0.2.md): a company at a glance, written by code from the board, the ledger and
// the log with no model call. The lobby card's TL;DR (summaryOf), the stage in a word (stageOf), what waits on the
// stakeholder and where it opens (needsYouOf, needsAcross), and what happened since they last looked (nextLooks,
// sinceStart, sinceOf). Every text field is one plain line, masked and capped, with no ids or paths. Pure, with no Node
// APIs: the web and the demo call the same functions as the company.
import {
  type Approval,
  type CompanyLooks,
  type CompanyPhase,
  type CompanyStage,
  type CompanySummary,
  type CompanyView,
  type DeskView,
  type Goal,
  type LobbyCompany,
  LOOK_GAP_MS,
  type LogEntry,
  type NeedsYouItem,
  type Pause,
  type Question,
  type Report,
  type SinceDigest,
  type SpendSample,
  STAKEHOLDER,
  type StalledView,
  type StatusLine,
  type Task,
  THE_OFFICE,
} from './company.ts';
import { isOpenItem, isOpenTask, nextLooks } from './company-state.ts';
import { clip, plainText } from './now.ts';
import { approvedVersion, latestVersion, planWaitingFor } from './plan.ts';
import { redactClip } from './redact.ts';
import { type ChecklistState, type Decision, DEFAULT_PLAN_APPROVAL, type PlanApproval, type PlanTaskKind, type PlanView } from './steering.ts';

/** How much of each list and line the overview keeps. */
export const OVERVIEW_LIMITS = { goal: 140, title: 120, line: 160, name: 60, achieved: 3, working: 4, needs: 100, finished: 12, files: 8, decisions: 8, path: 300 } as const;

/** One plain line of untrusted text: Markdown marks gone, secrets masked, whitespace collapsed, cut with "…". */
const line = (text: string, max: number): string => clip(plainText(text), max);

type Named = { id: string; name: string; level?: string };

function nameIn(people: readonly Named[], id: string): string {
  const p = people.find((x) => x.id === id);
  return p ? line(p.name, OVERVIEW_LIMITS.name) : 'Someone who left';
}

/** The stakeholder's request as one line: its first sentence, cut to 140 characters. */
export function goalLine(prompt: string): string {
  const first = plainText(prompt)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '') ?? '';
  const sentence = /^.*?[.!?](?=\s|$)/.exec(first)?.[0] ?? first;
  return clip(sentence, OVERVIEW_LIMITS.goal);
}

// ---------------------------------------------------------------------------------------------------------------
// The stage

type PlanState = Pick<PlanView, 'versions' | 'approved' | 'waiting'>;

/** Desks at work: the lobby card, the progress view and the stage all count these, so they agree on who is working. */
export const AT_WORK: readonly DeskView['state'][] = ['starting', 'working', 'stopping'];
export const isAtWork = (state: DeskView['state']): boolean => AT_WORK.includes(state);

/** Someone at work now: their id, their name and the title of the task they are on. */
export interface AtWork {
  id: string;
  name: string;
  task: string | null;
}

export interface StageInput {
  phase: CompanyPhase;
  pause: Pause | null;
  problem: string | null;
  done: number | null;
  stalled: Pick<StalledView, 'since' | 'tasks'> | null;
  plan: PlanState | null;
  planApproval: PlanApproval;
  tasks: readonly Pick<Task, 'id' | 'status' | 'planTask' | 'followUp'>[];
  questions: readonly Question[];
  approvals: readonly Approval[];
  working: readonly AtWork[];
}

/** Each plan task's kind, from every version (a later one wins), for tasks made from older versions too. */
function planKinds(plan: PlanState | null): Map<string, PlanTaskKind | undefined> {
  const out = new Map<string, PlanTaskKind | undefined>();
  for (const v of plan?.versions ?? []) for (const t of v.plan.tasks) out.set(t.id, t.kind);
  return out;
}

/**
 * Whether everyone at work only waits on the stakeholder: something is open in the inbox and nobody works but those whose
 * own question or approval holds their turn. The office's "start?" before a task holds nobody (model.ts's heldCount).
 */
function waitsOnYou(i: Pick<StageInput, 'questions' | 'approvals' | 'working'>, now: number): boolean {
  const questions = i.questions.filter((q) => isOpenItem(q, now));
  const approvals = i.approvals.filter((a) => isOpenItem(a, now));
  if (questions.length === 0 && approvals.length === 0) return false;
  const held = new Set([...questions.filter((q) => !q.gate).map((q) => q.from), ...approvals.map((a) => a.person)]);
  return i.working.every((w) => held.has(w.id));
}

/**
 * Where the company stands, in a word. A company that can't run is stuck whatever its phase; then founding is scoping,
 * a proposal or a plan waiting is waiting, stalled work is stuck, a pause (or a stopped company not done) is paused,
 * a finished plan is done, an open inbox with nobody else at work is waiting, an open final review or re-check is
 * checking, and anything else is working. The plan's own final review counts once it is under way: approval queues
 * it with every other plan task, long before its turn.
 */
export function stageOf(i: StageInput, now: number): CompanyStage {
  if (i.problem !== null) return 'stuck';
  if (i.phase === 'founding') return 'scoping';
  if (i.phase === 'proposed') return 'waiting';
  if (i.plan && planWaitingFor(i.plan, { planApproval: i.planApproval }) !== null) return 'waiting';
  if (i.stalled) return 'stuck';
  if (i.pause !== null) return 'paused';
  if (i.done !== null) return 'done';
  if (i.phase === 'stopped') return 'paused';
  if (waitsOnYou(i, now)) return 'waiting';
  const kinds = planKinds(i.plan);
  const checking = i.tasks.some((t) => {
    if (!isOpenTask(t)) return false;
    const kind = t.followUp?.kind;
    if (kind === 'end-check' || kind === 'recheck') return true;
    return t.planTask ? kinds.get(t.planTask) === 'verification' && t.status !== 'queued' : false;
  });
  return checking ? 'checking' : 'working';
}

// ---------------------------------------------------------------------------------------------------------------
// What needs the stakeholder

export interface NeedsInput {
  phase: CompanyPhase;
  questions: readonly Question[];
  approvals: readonly Approval[];
  people: readonly Named[];
  log: readonly LogEntry[];
  plan: PlanState | null;
  planApproval: PlanApproval;
  stalled: Pick<StalledView, 'since' | 'tasks'> | null;
  problem: string | null;
}

/**
 * Everything that waits on the stakeholder, oldest first, each with where it opens: open questions and approvals (the
 * inbox), a proposal waiting to start, a plan version or milestone waiting for approval, and work that has stopped or a
 * company that can't run. All but the "stuck" items are what the inbox counts.
 */
export function needsYouOf(i: NeedsInput, company: string, now: number): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];
  const from = (id: string): string | null => (id === THE_OFFICE || id === STAKEHOLDER ? null : nameIn(i.people, id));
  const ceo = i.people.find((p) => p.level === 'ceo') ?? i.people.find((p) => p.id === 'ceo');
  for (const q of i.questions) {
    if (!isOpenItem(q, now)) continue;
    const kind = q.budget ? 'budget' : i.phase === 'founding' ? 'scoping' : 'question';
    out.push({ company, kind, text: line(q.text, OVERVIEW_LIMITS.line), from: from(q.from), at: q.askedAt, target: { panel: 'inbox', item: q.id } });
  }
  for (const a of i.approvals) {
    if (!isOpenItem(a, now)) continue;
    out.push({ company, kind: 'approval', text: line(a.summary, OVERVIEW_LIMITS.line), from: from(a.person), at: a.askedAt, target: { panel: 'inbox', item: a.id } });
  }
  if (i.phase === 'proposed') {
    const proposed = i.log.findLast((e) => e.kind === 'proposal' || e.kind === 'proposal-edited');
    out.push({
      company,
      kind: 'proposal',
      text: 'The proposed team waits for your OK to start.',
      from: ceo ? line(ceo.name, OVERVIEW_LIMITS.name) : null,
      at: proposed?.at ?? now,
      target: { panel: 'proposal' },
    });
  }
  const waits = i.plan ? planWaitingFor(i.plan, { planApproval: i.planApproval }) : null;
  if (i.plan && waits) {
    const latest = latestVersion(i.plan);
    const by = waits.kind === 'plan' && latest ? from(latest.by) : null;
    const at = waits.kind === 'milestone' ? (i.plan.waiting?.since ?? now) : (latest?.at ?? now);
    out.push({ company, kind: waits.kind, text: line(waits.sentence, OVERVIEW_LIMITS.line), from: by, at, target: { main: 'plan' } });
  }
  if (i.stalled) {
    const n = i.stalled.tasks.length;
    out.push({ company, kind: 'stuck', text: `Work has stopped with ${n} ${n === 1 ? 'task' : 'tasks'} still open.`, from: null, at: i.stalled.since, target: { main: 'progress' } });
  }
  if (i.problem !== null) {
    out.push({ company, kind: 'stuck', text: "The office can't run this company; open it to see why.", from: null, at: now, target: { main: 'progress' } });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * What waits on the stakeholder across every company, oldest first: every item, so the lobby's strip can count them all
 * and show each one ("Show all 14"). A company's own list stops at OVERVIEW_LIMITS.needs, far past any real inbox.
 */
export function needsAcross(companies: readonly Pick<LobbyCompany, 'summary'>[]): NeedsYouItem[] {
  return companies.flatMap((c) => c.summary?.needs.items ?? []).sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------------------------------------------
// The lobby card

/**
 * What both the company (from its state) and a view (summaryInputOfView) fill. `working` is who is at work now (AT_WORK)
 * and the title of their task; `spent` and `budget` are dollars; `checklist` the checklist's counts, or null without one.
 */
export interface SummaryInput extends StageInput, NeedsInput {
  id: string;
  prompt: string;
  goal: Goal | null;
  tasks: readonly Task[];
  reports: readonly Report[];
  statuses: readonly StatusLine[];
  spent: number;
  budget: number | null;
  checklist: Record<ChecklistState, number> | null;
}

/**
 * A view as the overview's input: what the demo's lobby card and the office's progress view are written from. Who is at
 * work and what was spent read as the hub's lobby card reads them from the state (view.ts's lobbyEntryOf): desks in
 * AT_WORK, each on their current task, and the budget's own total of what everyone spent.
 */
export function summaryInputOfView(c: CompanyView): SummaryInput {
  return {
    id: c.id,
    phase: c.phase,
    prompt: c.prompt,
    goal: c.goal,
    tasks: c.tasks,
    questions: c.questions,
    approvals: c.approvals,
    reports: c.reports,
    statuses: c.statuses,
    log: c.log,
    pause: c.pause,
    problem: c.problem,
    done: c.done ?? null,
    stalled: c.stalled ?? null,
    plan: c.steering?.plan ?? null,
    planApproval: c.steering?.settings.planApproval ?? DEFAULT_PLAN_APPROVAL,
    people: c.people.map((p) => ({ id: p.id, name: p.name, level: p.level })),
    working: c.people
      .filter((p) => isAtWork(p.desk.state))
      .map((p) => ({ id: p.id, name: p.name, task: p.task ? (c.tasks.find((t) => t.id === p.task)?.title ?? null) : null })),
    spent: c.spending?.budget.spent ?? c.people.reduce((s, p) => s + p.cost, 0),
    budget: c.spending?.budget.company ?? c.settings.budget.company,
    checklist: c.checklist?.counts ?? null,
  };
}

/** The newest task made from each plan task. */
function boardTasks(tasks: readonly Task[]): Map<string, Task> {
  const out = new Map<string, Task>();
  for (const t of tasks) if (t.planTask) out.set(t.planTask, t);
  return out;
}

function taskCounts(i: Pick<SummaryInput, 'plan' | 'tasks'>): { done: number; planned: number } {
  const version = i.plan ? (approvedVersion(i.plan) ?? latestVersion(i.plan)) : null;
  let done = 0;
  let planned = 0;
  if (version) {
    const board = boardTasks(i.tasks);
    for (const pt of version.plan.tasks) {
      const status = board.get(pt.id)?.status;
      if (status === 'dropped') continue;
      planned += 1;
      if (status === 'done') done += 1;
    }
    return { done, planned };
  }
  for (const t of i.tasks) {
    if (t.followUp !== undefined || t.status === 'dropped') continue;
    planned += 1;
    if (t.status === 'done') done += 1;
  }
  return { done, planned };
}

function milestoneCounts(i: Pick<SummaryInput, 'goal' | 'plan'>): { done: number; planned: number } {
  if (i.goal) return { done: i.goal.milestones.filter((m) => m.doneAt !== null).length, planned: i.goal.milestones.length };
  const version = i.plan ? latestVersion(i.plan) : null;
  return { done: 0, planned: version?.plan.milestones.length ?? 0 };
}

/** The company's TL;DR for its lobby card. `preview` is the hub's to fill. */
export function summaryOf(i: SummaryInput, now: number): CompanySummary {
  const needs = needsYouOf(i, i.id, now);
  // The office's own follow-ups (the end check, fixes, re-checks) are how the work was checked, not what it achieved.
  // The plan's final review is a check too: it says the work holds, it isn't work of its own.
  const kinds = planKinds(i.plan);
  const achieved = i.tasks
    .filter((t) => t.status === 'done' && t.followUp === undefined && !(t.planTask && kinds.get(t.planTask) === 'verification'))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, OVERVIEW_LIMITS.achieved)
    .map((t) => ({ title: line(t.title, OVERVIEW_LIMITS.title), by: nameIn(i.people, t.owner), at: t.updatedAt }));
  const moves = [i.statuses.at(-1)?.at, i.reports.at(-1)?.at, i.log.at(-1)?.at, ...i.tasks.map((t) => t.updatedAt)].filter((at): at is number => at !== undefined);
  return {
    goal: goalLine(i.prompt) || goalLine(i.goal?.text ?? ''),
    stage: stageOf(i, now),
    milestones: milestoneCounts(i),
    tasks: taskCounts(i),
    achieved,
    working: i.working.slice(0, OVERVIEW_LIMITS.working).map((w) => ({ name: line(w.name, OVERVIEW_LIMITS.name), task: w.task === null ? null : line(w.task, OVERVIEW_LIMITS.title) })),
    needs: { count: needs.filter((n) => n.kind !== 'stuck').length, items: needs.slice(0, OVERVIEW_LIMITS.needs) },
    spend: { spent: i.spent, budget: i.budget },
    preview: null,
    movedAt: moves.length > 0 ? Math.max(...moves) : null,
    checklist: i.checklist ? { ...i.checklist } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Since you last looked

// nextLooks lives beside the reducer that folds a look (company-state.ts), which this module imports.
export { nextLooks };

/**
 * Where "since you last looked" starts: the last look when this is a new visit, else the end of the visit before, so the
 * window stays the same before and after the visit's first look is recorded. Null on the first visit.
 */
export function sinceStart(looks: CompanyLooks, now: number): number | null {
  if (looks.last === null) return null;
  return now - looks.last > LOOK_GAP_MS ? looks.last : looks.previous;
}

export interface SinceInput {
  tasks: readonly Task[];
  reports: readonly Report[];
  decisions: readonly Decision[];
  people: readonly Named[];
  /** The stakeholder's name, for their own decisions. */
  stakeholder: string;
  spend: readonly SpendSample[];
  questions: readonly Question[];
  approvals: readonly Approval[];
}

/**
 * What happened after `since`: tasks finished (with the files each changed; the office's follow-ups left out, as in
 * summaryOf), decisions, money spent, and what waits now.
 */
export function sinceOf(i: SinceInput, since: number, now: number): SinceDigest {
  const finished = i.tasks.filter((t) => t.status === 'done' && t.followUp === undefined && t.updatedAt > since).sort((a, b) => b.updatedAt - a.updatedAt);
  const decisions = i.decisions.filter((d) => d.at > since).sort((a, b) => b.at - a.at);
  const by = (id: string): string => (id === STAKEHOLDER ? line(i.stakeholder, OVERVIEW_LIMITS.name) || 'You' : id === THE_OFFICE ? 'The office' : nameIn(i.people, id));
  const filesOf = (t: Task): string[] => {
    const report = i.reports.findLast((r) => r.taskId === t.id && r.outcome === 'done' && (r.files?.length ?? 0) > 0);
    return (report?.files ?? t.files).slice(0, OVERVIEW_LIMITS.files).map((f) => redactClip(f, OVERVIEW_LIMITS.path));
  };
  let spent = 0;
  for (const s of i.spend) if (s.at > since) spent += s.cost;
  return {
    since,
    finished: finished.slice(0, OVERVIEW_LIMITS.finished).map((t) => ({ title: line(t.title, OVERVIEW_LIMITS.title), by: nameIn(i.people, t.owner), at: t.updatedAt, files: filesOf(t) })),
    finishedCount: finished.length,
    decisions: decisions.slice(0, OVERVIEW_LIMITS.decisions).map((d) => ({ what: line(d.what, OVERVIEW_LIMITS.line), by: by(d.by), at: d.at })),
    decisionCount: decisions.length,
    spent,
    waiting: i.questions.filter((q) => isOpenItem(q, now)).length + i.approvals.filter((a) => isOpenItem(a, now)).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The final handover

/**
 * Where a final handover written in the CEO's end check turn starts: the end check asks for it in that same turn, before
 * the office marks the plan done, so a handover after the newest end check (or the last of the plan's own work, whichever
 * is later) is the one. Null when no end check asked for it: a plan with its own final review, or an end check whose
 * failures went to a re-check; the CEO is then asked once the plan is done. The company (settleFinish) and the handover
 * card read the same window.
 */
export function sameTurnHandoverSince(tasks: readonly Pick<Task, 'followUp' | 'createdAt' | 'updatedAt'>[]): number | null {
  const checks = tasks.filter((t) => t.followUp?.kind === 'end-check' || t.followUp?.kind === 'recheck');
  if (!checks.some((t) => t.followUp?.kind === 'end-check') || checks.some((t) => t.followUp?.kind === 'recheck')) return null;
  const workDone = tasks.filter((t) => t.followUp === undefined).reduce((newest, t) => Math.max(newest, t.updatedAt), 0);
  return Math.max(workDone, ...checks.map((t) => t.createdAt));
}
