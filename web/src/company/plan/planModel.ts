// The plan as the office shows it (SPEC-v3.md "Steering", 1): where it stands, what you can approve, which milestones
// are approved or wait for you, the versions, what changed from one to the next in words, comments, and the tasks the
// board made from it. Pure, so it can be tested; Plan.tsx only draws it.
import { type CompanyView, STAKEHOLDER, type Task } from '../../../../src/core/company.ts';
import { clip, countWord, plainText } from '../../../../src/core/now.ts';
import { planWaitingFor } from '../../../../src/core/plan.ts';
import { planDiff } from '../../../../src/core/planDiff.ts';
import type { Plan, PlanApproval, PlanComment, PlanDiff, PlanMilestone, PlanTask, PlanVersion, PlanView } from '../../../../src/core/steering.ts';
import { inSentence } from '../../../../src/core/studio.ts';
import { capital } from '../../../../src/core/words.ts';
import { whenAt } from '../../lib/format.ts';
import { firstSentence, nameOf } from '../people/peopleModel.ts';
import { milestoneTasks, NO_TASKS, TASK_WORD } from '../tasks/tasksModel.ts';
import type { StateTone } from '../ui/tone.ts';
import { kindWords } from './contractsModel.ts';
import { milestoneById, named, placeWord, tasksIn } from './planEdit.ts';

// ---------------------------------------------------------------------------------------------------------------
// Reading the view

export const planOf = (company: Pick<CompanyView, 'steering'>): PlanView | null => company.steering?.plan ?? null;
/** The company's Plan approval setting; null where the office doesn't say (an office without steering). */
export const approvalOf = (company: Pick<CompanyView, 'steering'>): PlanApproval | null => company.steering?.settings.planApproval ?? null;
export const latestOf = (view: PlanView | null): PlanVersion | null => view?.versions.at(-1) ?? null;
export const versionIn = (view: PlanView | null, n: number): PlanVersion | null => view?.versions.find((v) => v.version === n) ?? null;
/** The version just before `n` that the view still carries. */
export const previousOf = (view: PlanView | null, n: number): PlanVersion | null =>
  view?.versions.filter((v) => v.version < n).reduce<PlanVersion | null>((best, v) => (best === null || v.version > best.version ? v : best), null) ?? null;

/** "v3" in an address is version 3; anything else is none. */
export function planVersionPart(part: string | undefined | null): number | null {
  const m = /^v([1-9]\d{0,5})$/.exec(part ?? '');
  return m ? Number(m[1]) : null;
}
/** The plan's address under the company: "plan", or "plan/v3" for an older version. */
export const planPath = (version: number | null = null): string => (version === null ? 'plan' : `plan/v${version}`);

/** What the plan waits on you for ("The CEO's plan waits for your approval."), or null: the inbox, Now and the pill say it. */
export function planWait(company: Pick<CompanyView, 'steering' | 'phase'>): { kind: 'plan' | 'milestone'; sentence: string } | null {
  const view = planOf(company);
  const setting = approvalOf(company);
  if (!view || setting === null || company.phase === 'founding' || company.phase === 'proposed') return null;
  return planWaitingFor(view, { planApproval: setting });
}

/** Tasks' empty line: while a plan waits for you, its tasks come once you approve, not "once the company starts". */
export const noTasksLine = (company: Pick<CompanyView, 'steering' | 'phase'>): string =>
  planWait(company) ? 'No tasks yet. The plan puts its tasks on the board once you approve it.' : NO_TASKS;

/** Who did something, inside a sentence: "you", "the CEO", "Ada". */
export const whoIn = (company: Pick<CompanyView, 'people'>, id: string): string => nameOf(company, id).called;

// ---------------------------------------------------------------------------------------------------------------
// Which milestones are approved

/** The milestones of `plan` approved in its version, in order; null when that version isn't approved at all. */
export function approvedIn(view: PlanView | null, version: PlanVersion): Set<string> | null {
  const a = view?.approved;
  if (!a || a.version !== version.version) return null;
  const ids = version.plan.milestones.map((m) => m.id);
  if (a.through === null) return new Set(ids);
  const at = ids.indexOf(a.through);
  // A milestone the version doesn't hold approves nothing in it.
  return new Set(at < 0 ? [] : ids.slice(0, at + 1));
}

/** The milestone after one in a plan, or null. */
const nextMilestone = (plan: Plan, id: string): PlanMilestone | null => {
  const i = plan.milestones.findIndex((m) => m.id === id);
  return i < 0 ? null : (plan.milestones[i + 1] ?? null);
};

// ---------------------------------------------------------------------------------------------------------------
// Where the plan stands

export type PlanStateKind = 'founding' | 'none' | 'drafting' | 'waiting' | 'revising' | 'held' | 'partly' | 'approved' | 'off';

export interface PlanState {
  kind: PlanStateKind;
  pill: { label: string; tone: StateTone } | null;
  /** The state in sentences, the first one first. */
  lines: string[];
}

const ceoOf = (company: Pick<CompanyView, 'people'>) => company.people.find((p) => p.level === 'ceo') ?? null;

/** Your comments on the latest version, newer than it: you asked for changes the CEO hasn't made yet. */
export function askedChanges(view: PlanView, latest: PlanVersion): PlanComment[] {
  return view.comments.filter((c) => c.by === STAKEHOLDER && c.at > latest.at);
}

/** "You approved", "The CEO approved, as you asked,". */
function approver(company: Pick<CompanyView, 'people'>, by: string, cites: readonly string[]): string {
  if (by === STAKEHOLDER) return 'You';
  const who = capital(whoIn(company, by));
  return cites.length > 0 ? `${who}, as you asked,` : who;
}

export function planState(company: CompanyView): PlanState {
  if (company.phase === 'founding' || company.phase === 'proposed') {
    return { kind: 'founding', pill: null, lines: ['The CEO proposes a plan once the company starts.'] };
  }
  const view = planOf(company);
  const setting = approvalOf(company);
  const latest = latestOf(view);
  const on = setting !== null && setting !== 'off';
  if (!view || !latest) {
    const ceo = ceoOf(company);
    const atWork = ceo !== null && (ceo.desk.state === 'working' || ceo.desk.state === 'starting');
    // An office that doesn't say how plans are approved says nothing about what waits for one.
    const waits = setting === null ? [] : [on ? 'Nobody starts a task until there is a plan and you approve it.' : 'With plan approval off, the heads assign work as they go.'];
    if (atWork) {
      const status = ceo.status ? `The CEO: ${clip(plainText(ceo.status.text), 160)}` : null;
      return { kind: 'drafting', pill: { label: 'No plan yet', tone: 'working' }, lines: ["The CEO is at work and hasn't proposed a plan yet.", ...(status ? [status] : []), ...waits] };
    }
    return { kind: 'none', pill: { label: 'No plan yet', tone: 'neutral' }, lines: ["The CEO hasn't proposed a plan yet.", ...waits] };
  }

  const by = `${whoIn(company, latest.by)}`;
  const made = `Version ${latest.version}, by ${by} ${whenAt(latest.at)}`;
  if (!on) {
    return { kind: 'off', pill: { label: 'Approval off', tone: 'neutral' }, lines: [`${made}.`, 'Plan approval is off, so the plan applies as proposed and the heads assign work as they go.'] };
  }

  const plan = latest.plan;
  const approved = approvedIn(view, latest);
  const a = view.approved;
  if (view.waiting) {
    const done = milestoneById(plan, view.waiting.milestone);
    const next = done ? nextMilestone(plan, done.id) : null;
    const report = view.waiting.report ? company.reports.find((r) => r.id === view.waiting?.report) : undefined;
    return {
      kind: 'held',
      pill: { label: 'Waits for you', tone: 'needs' },
      lines: [
        done && next ? `${capital(named(done.title))} is done. ${capital(named(next.title))} waits for your approval before it starts.` : 'A milestone is done. The next one waits for your approval before it starts.',
        ...(report ? [`${capital(whoIn(company, report.person))} reported ${whenAt(report.at)}: ${firstSentence(report.text, 200)}`] : []),
      ],
    };
  }
  if (approved && a && approved.size === plan.milestones.length) {
    return {
      kind: 'approved',
      pill: { label: 'Approved', tone: 'done' },
      lines: [`${approver(company, a.by, a.cites)} approved version ${latest.version} ${whenAt(a.at)}.`, 'Its tasks go on the board in this order and reach their owners as their turn comes.'],
    };
  }
  if (approved && a && a.through !== null) {
    const through = milestoneById(plan, a.through);
    const next = through ? nextMilestone(plan, through.id) : null;
    return {
      kind: 'partly',
      pill: { label: 'Approved in part', tone: 'waiting' },
      lines: [
        `${approver(company, a.by, a.cites)} approved version ${latest.version} through ${through ? named(through.title) : 'a milestone'} ${whenAt(a.at)}.`,
        next ? `${capital(named(next.title))}${plan.milestones.length - plan.milestones.indexOf(next) > 1 ? ' and the milestones after it wait' : ' waits'} for your approval.` : 'The rest waits for your approval.',
      ],
    };
  }
  const older = a && a.version < latest.version ? `${approver(company, a.by, a.cites)} approved version ${a.version} ${whenAt(a.at)}. Version ${latest.version} changes it.` : null;
  // Once an older version was approved, work is under way: what waits is this version's changes.
  const how = older
    ? setting === 'milestones'
      ? 'Its changes wait for your approval, a milestone at a time.'
      : 'Its changes wait for your approval.'
    : setting === 'milestones'
      ? 'Approve the first milestone to start work; each milestone after it waits for you too.'
      : 'Nobody starts a task of it until you approve it.';
  const asked = askedChanges(view, latest);
  if (asked.length > 0) {
    const last = asked.at(-1);
    return {
      kind: 'revising',
      pill: { label: 'Changes asked', tone: 'waiting' },
      lines: [
        `You asked the CEO for changes ${whenAt(last?.at ?? latest.at)}. The new version shows here with what changed.`,
        `${made} waits for your approval meanwhile, and you can approve it as it is.`,
        ...(older ? [older] : []),
      ],
    };
  }
  return { kind: 'waiting', pill: { label: 'Waits for you', tone: 'needs' }, lines: [`${made}, waits for your approval.`, ...(older ? [older] : []), how] };
}

// ---------------------------------------------------------------------------------------------------------------
// What you can approve

export interface ApproveChoice {
  /** null approves the whole plan. */
  through: string | null;
  label: string;
}

/**
 * The approval to offer for the latest version: before work starts, the whole plan, with each milestone as a stopping
 * point; at every milestone, the next milestone, with the whole plan and the later ones as the alternatives. Milestones
 * already done on the board (`done`) are no stopping point: approving the next one covers them. Null when there is
 * nothing to approve (approval off, or the version is approved through its end).
 */
export function approveChoices(
  view: PlanView | null,
  setting: PlanApproval | null,
  done: ReadonlySet<string> = new Set(),
): { version: number; primary: ApproveChoice; more: ApproveChoice[] } | null {
  const latest = latestOf(view);
  if (!latest || setting === null || setting === 'off') return null;
  const plan = latest.plan;
  const approved = approvedIn(view, latest) ?? new Set<string>();
  const left = plan.milestones.filter((m) => !approved.has(m.id));
  if (plan.milestones.length > 0 && left.length === 0) return null;
  const last = plan.milestones.at(-1)?.id;
  const open = left.filter((m) => !done.has(m.id));
  const through = (m: PlanMilestone): ApproveChoice => ({ through: m.id, label: `Approve through ${named(m.title)}` });
  const rest = approved.size > 0 || open.length < left.length;
  const next = open[0] ?? left.at(-1);
  if (setting === 'milestones' && next) {
    const later = open.filter((m) => m.id !== next.id);
    return {
      version: latest.version,
      primary: { through: next.id, label: `Approve ${named(next.title)}` },
      more: later.length > 0 ? [...later.filter((m) => m.id !== last).map(through), { through: null, label: rest ? 'Approve the rest of the plan' : 'Approve the whole plan' }] : [],
    };
  }
  return { version: latest.version, primary: { through: null, label: rest ? 'Approve the rest of the plan' : 'Approve the plan' }, more: open.filter((m) => m.id !== last).map(through) };
}

/** Milestones whose work is all done on the board, or that the goal marks done. */
export function doneMilestones(company: Pick<CompanyView, 'tasks' | 'goal'>, plan: Plan): Set<string> {
  const done = new Set<string>();
  for (const m of plan.milestones) {
    const progress = milestoneProgress(company, plan, m.id);
    const goal = company.goal?.milestones.find((g) => g.id === m.id);
    if ((progress && progress.total > 0 && progress.done === progress.total) || (goal && goal.doneAt !== null)) done.add(m.id);
  }
  return done;
}

/** What a press of an approval says once the office took it. */
export function approvedLine(plan: Plan, version: number, through: string | null): string {
  if (through === null) return `Approved version ${version}. Its tasks go on the board in this order.`;
  const m = milestoneById(plan, through);
  return `Approved version ${version} through ${m ? named(m.title) : 'that milestone'}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Each milestone's mark

export interface MilestoneMark {
  label: string;
  tone: StateTone;
}

/**
 * Done, approved, waiting for you, or not approved yet: for the version shown. A milestone done on the board (`done`,
 * the latest version only) says Done; at every milestone, the one Approve would approve next waits for you. Empty with
 * approval off, where only the board's progress shows.
 */
export function milestoneMarks(view: PlanView | null, version: PlanVersion, setting: PlanApproval | null, done: ReadonlySet<string> = new Set()): Record<string, MilestoneMark> {
  const marks: Record<string, MilestoneMark> = {};
  if (setting === null || setting === 'off') return marks;
  const approved = approvedIn(view, version);
  const latest = latestOf(view)?.version === version.version;
  for (const m of version.plan.milestones) {
    marks[m.id] =
      latest && done.has(m.id) ? { label: 'Done', tone: 'done' } : approved?.has(m.id) ? { label: 'Approved', tone: 'done' } : { label: latest ? 'Not approved yet' : 'Not approved', tone: 'neutral' };
  }
  const waiting = latest ? view?.waiting : null;
  if (waiting) {
    const next = nextMilestone(version.plan, waiting.milestone);
    if (marks[waiting.milestone]) marks[waiting.milestone] = { label: 'Done', tone: 'done' };
    if (next) marks[next.id] = { label: 'Waits for you', tone: 'needs' };
  } else if (latest && setting === 'milestones') {
    const next = version.plan.milestones.find((m) => !approved?.has(m.id) && !done.has(m.id));
    if (next) marks[next.id] = { label: 'Waits for you', tone: 'needs' };
  }
  return marks;
}

// ---------------------------------------------------------------------------------------------------------------
// The board: tasks made from the plan

/** The board's tasks made from a plan task, top-level ones first. */
export const boardTasksOf = (company: Pick<CompanyView, 'tasks'>, planTask: string): Task[] =>
  company.tasks.filter((t) => t.planTask === planTask).sort((a, b) => Number(a.parent !== null) - Number(b.parent !== null) || a.createdAt - b.createdAt);

/** A board task's state in a word, steering included: "Paused", "Cancelled", "Working". */
export function boardWord(t: Task): string {
  if (t.cancel) return 'Cancelled';
  if (t.paused && t.status !== 'done' && t.status !== 'dropped') return 'Paused';
  return TASK_WORD[t.status];
}

/** "Two of five tasks done": a milestone's tasks on the board; null before any is. */
export function milestoneProgress(company: Pick<CompanyView, 'tasks'>, plan: Plan, milestone: string): { done: number; total: number; line: string } | null {
  const ids = new Set(tasksIn(plan, milestone).map((t) => t.id));
  const tasks = milestoneTasks(company.tasks, milestone, ids);
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === 'done').length;
  const n = tasks.length;
  const line =
    done === n
      ? n === 1
        ? 'Its one task is done.'
        : `All ${countWord(n)} tasks done.`
      : done === 0
        ? n === 1
          ? 'Its one task is on the board, not done yet.'
          : `None of its ${countWord(n)} tasks done yet.`
        : `${capital(countWord(done))} of ${countWord(n)} tasks done.`;
  return { done, total: n, line };
}

// ---------------------------------------------------------------------------------------------------------------
// A task as the plan shows it

export interface PlanTaskView {
  task: PlanTask;
  title: string;
  /** Its place in the order work is handed out in, from 1. */
  number: number;
  /** "Kai, frontend engineer"; `missing` when they aren't in the company. */
  owner: { text: string; missing: boolean };
  files: string[];
  /** The tasks it waits for, by title. */
  waits: string[];
  brief: string;
  doneWhen: string;
  /** The command the office runs when it is reported done (v0.2); null for a task with none. */
  check: string | null;
}

export function planTaskView(company: Pick<CompanyView, 'people'>, plan: Plan, t: PlanTask): PlanTaskView {
  const owner = nameOf(company, t.owner);
  return {
    task: t,
    title: plainText(t.title),
    number: plan.tasks.findIndex((x) => x.id === t.id) + 1,
    owner: { text: capital(owner.introduced), missing: owner.person === null },
    files: t.files,
    waits: t.after.map((id) => plainText(plan.tasks.find((x) => x.id === id)?.title ?? 'a task that is no longer in the plan')),
    brief: plainText(t.brief),
    doneWhen: plainText(t.doneWhen),
    check: t.check ? plainText(t.check) : null,
  };
}

/** Tasks whose title, owner or files match a search; null for no search. */
export function findInPlan(company: Pick<CompanyView, 'people'>, plan: Plan, query: string): Set<string> | null {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  if (!q) return null;
  return new Set(
    plan.tasks
      .filter((t) => {
        const owner = company.people.find((p) => p.id === t.owner);
        return [t.title, owner?.name ?? '', owner?.title ?? '', ...t.files].some((f) => fold(f).includes(q));
      })
      .map((t) => t.id),
  );
}

/** Find shows from this many tasks. */
export const FIND_PLAN_OVER = 20;

// ---------------------------------------------------------------------------------------------------------------
// Versions

export interface VersionRow {
  version: number;
  /** "By the CEO at 14:02." */
  line: string;
  note: string | null;
  approved: boolean;
  latest: boolean;
}

/** Newest first. */
export function versionRows(view: PlanView | null, company: Pick<CompanyView, 'people'>): VersionRow[] {
  const latest = latestOf(view)?.version;
  return [...(view?.versions ?? [])].reverse().map((v) => ({
    version: v.version,
    line: `By ${whoIn(company, v.by)} ${whenAt(v.at)}.`,
    note: v.note ? clip(plainText(v.note), 240) : null,
    approved: view?.approved?.version === v.version,
    latest: v.version === latest,
  }));
}

/** Said under the list when the view no longer carries the first versions. */
export function olderVersionsLine(view: PlanView | null): string | null {
  const first = view?.versions[0]?.version;
  return first !== undefined && first > 1 ? `Versions before ${first} aren't kept here: the office keeps the latest ten.` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// What changed between two versions, in words

export interface DiffPart {
  label: string;
  before: string;
  after: string;
  /** Long text (a brief): shown on request. */
  long: boolean;
}

export interface DiffItem {
  key: string;
  text: string;
  parts: DiffPart[];
}

export interface DiffSection {
  kind: 'added' | 'cut' | 'changed' | 'moved';
  title: string;
  items: DiffItem[];
}

export interface DiffView {
  goal: { before: string; after: string } | null;
  sections: DiffSection[];
  /** "Two added, one cut and one changed." or "Nothing changed." */
  summary: string;
}

const FIELD_WORDS: Record<keyof PlanTask, string> = { id: 'id', title: 'title', owner: 'owner', files: 'files', milestone: 'milestone', after: 'what it waits for', brief: 'brief', doneWhen: 'done when', check: 'check', kind: 'kind' };

const listWords = (items: readonly string[], none: string): string => (items.length === 0 ? none : items.join(', '));

/** "a, b and c". */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * What changed in the checklist between two versions, by item id: the core's planDiff says it once it knows the
 * checklist (src/core/planDiff.ts), and this works it out the same way until then, so a checklist-only edit is a change.
 */
export function checklistDiff(before: Plan, after: Plan): NonNullable<PlanDiff['checklist']> | null {
  const was = before.checklist ?? [];
  const now = after.checklist ?? [];
  if (was.length === 0 && now.length === 0) return null;
  const old = new Map(was.map((k) => [k.id, k]));
  const kept = new Set(now.map((k) => k.id));
  return {
    added: now.filter((k) => !old.has(k.id)),
    removed: was.filter((k) => !kept.has(k.id)),
    changed: now.flatMap((k) => {
      const b = old.get(k.id);
      return b && (b.text !== k.text || b.quote !== k.quote || JSON.stringify(b.covers) !== JSON.stringify(k.covers)) ? [{ before: b, after: k }] : [];
    }),
  };
}

export function diffView(before: Plan, after: Plan, company: Pick<CompanyView, 'people'>): DiffView {
  const d = planDiff(before, after);
  const k = d.checklist ?? checklistDiff(before, after);
  const titles = (plan: Plan, ids: readonly string[]) => ids.map((id) => named(plan.tasks.find((t) => t.id === id)?.title ?? 'a task no longer in the plan'));
  const owner = (id: string) => whoIn(company, id);
  const milestoneTitle = (plan: Plan, id: string) => {
    const m = milestoneById(plan, id);
    return m ? named(m.title) : 'a milestone no longer in the plan';
  };
  const waits = (plan: Plan, ids: readonly string[]) => ids.map((id) => named(plan.tasks.find((t) => t.id === id)?.title ?? id));

  const added: DiffItem[] = [
    ...d.milestones.added.map((m) => ({ key: `m:${m.id}`, text: `The milestone ${named(m.title)}, done when ${inSentence(clip(plainText(m.doneWhen), 160)).replace(/[.]$/, '')}.`, parts: [] })),
    ...d.tasks.added.map((t) => ({ key: `t:${t.id}`, text: `${capital(named(t.title))}, for ${owner(t.owner)}, in ${milestoneTitle(after, t.milestone)}.`, parts: [] })),
    ...(k?.added ?? []).map((x) => ({ key: `k:${x.id}`, text: `To the checklist: ${named(x.text)}.`, parts: [] })),
  ];
  const cut: DiffItem[] = [
    ...d.milestones.removed.map((m) => ({ key: `m:${m.id}`, text: `The milestone ${named(m.title)}.`, parts: [] })),
    ...d.tasks.removed.map((t) => ({ key: `t:${t.id}`, text: `${capital(named(t.title))}, which was for ${owner(t.owner)}, in ${milestoneTitle(before, t.milestone)}.`, parts: [] })),
    ...(k?.removed ?? []).map((x) => ({ key: `k:${x.id}`, text: `From the checklist: ${named(x.text)}.`, parts: [] })),
  ];
  const changed: DiffItem[] = [
    ...d.milestones.changed.map(({ before: b, after: a }) => ({
      key: `m:${a.id}`,
      text: `The milestone ${named(a.title)}.`,
      parts: [
        ...(b.title !== a.title ? [{ label: 'Title', before: plainText(b.title), after: plainText(a.title), long: false }] : []),
        ...(b.doneWhen !== a.doneWhen ? [{ label: 'Done when', before: plainText(b.doneWhen), after: plainText(a.doneWhen), long: false }] : []),
      ],
    })),
    ...d.tasks.changed.map(({ before: b, after: a, fields }) => ({
      key: `t:${a.id}`,
      text: `${capital(named(a.title))}: ${joinWords(fields.map((f) => FIELD_WORDS[f]))}.`,
      parts: fields.map((f): DiffPart => {
        switch (f) {
          case 'owner':
            return { label: 'Owner', before: capital(owner(b.owner)), after: capital(owner(a.owner)), long: false };
          case 'files':
            return { label: 'Files', before: listWords(b.files, 'none'), after: listWords(a.files, 'none'), long: false };
          case 'milestone':
            return { label: 'Milestone', before: milestoneTitle(before, b.milestone), after: milestoneTitle(after, a.milestone), long: false };
          case 'after':
            return { label: 'Waits for', before: listWords(waits(before, b.after), 'nothing'), after: listWords(waits(after, a.after), 'nothing'), long: false };
          case 'brief':
            return { label: 'Brief', before: plainText(b.brief), after: plainText(a.brief), long: true };
          case 'doneWhen':
            return { label: 'Done when', before: plainText(b.doneWhen), after: plainText(a.doneWhen), long: false };
          case 'check':
            return { label: 'Check', before: b.check ? plainText(b.check) : 'none', after: a.check ? plainText(a.check) : 'none', long: false };
          case 'kind':
            return { label: 'Kind', before: kindWords(b.kind)?.label ?? 'a plain task', after: kindWords(a.kind)?.label ?? 'a plain task', long: false };
          default:
            return { label: 'Title', before: plainText(b.title), after: plainText(a.title), long: false };
        }
      }),
    })),
    ...(k?.changed ?? []).map(({ before: b, after: a }) => ({
      key: `k:${a.id}`,
      text: `The checklist item ${named(a.text)}.`,
      parts: [
        ...(b.text !== a.text ? [{ label: 'Sentence', before: plainText(b.text), after: plainText(a.text), long: false }] : []),
        ...(JSON.stringify(b.covers) !== JSON.stringify(a.covers)
          ? [{ label: 'Covered by', before: listWords(titles(before, b.covers), 'no task'), after: listWords(titles(after, a.covers), 'no task'), long: false }]
          : []),
      ],
    })),
  ];
  const place = (list: readonly { id: string }[], id: string) => list.findIndex((x) => x.id === id) + 1;
  const moved: DiffItem[] = [
    ...(d.milestones.moved ?? []).map((id) => ({
      key: `m:${id}`,
      text: `The milestone ${named(milestoneById(after, id)?.title ?? id)}: now ${placeWord(place(after.milestones, id))}, was ${placeWord(place(before.milestones, id))}.`,
      parts: [],
    })),
    ...d.tasks.moved.map((id) => ({
      key: `t:${id}`,
      text: `${capital(named(after.tasks.find((t) => t.id === id)?.title ?? id))}: now ${placeWord(place(after.tasks, id))} in the order, was ${placeWord(place(before.tasks, id))}.`,
      parts: [],
    })),
  ];
  const sections: DiffSection[] = (
    [
      { kind: 'added', title: 'Added', items: added },
      { kind: 'cut', title: 'Cut', items: cut },
      { kind: 'changed', title: 'Changed', items: changed },
      { kind: 'moved', title: 'Moved', items: moved },
    ] as const
  ).filter((s) => s.items.length > 0);
  const counts = sections.map((s) => `${countWord(s.items.length)} ${s.title.toLowerCase()}`);
  const said = [...(d.goal ? ['the goal changed'] : []), ...counts];
  return {
    goal: d.goal ? { before: plainText(d.goal.before), after: plainText(d.goal.after) } : null,
    sections,
    summary: said.length === 0 ? 'Nothing changed.' : `${capital(joinWords(said))}.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Comments

export const sameTarget = (a: PlanComment['on'], b: PlanComment['on']): boolean => a.kind === b.kind && (a.kind === 'plan' || (b.kind !== 'plan' && a.id === b.id));

/** The comments on a target, oldest first. */
export const commentsOn = (view: PlanView | null, on: PlanComment['on']): PlanComment[] => (view?.comments ?? []).filter((c) => sameTarget(c.on, on)).sort((a, b) => a.at - b.at);

/** "You at 14:02, on version 2", the version said only when it isn't the one shown. */
export function commentSign(company: Pick<CompanyView, 'people'>, c: PlanComment, shown: number): string {
  return `${capital(whoIn(company, c.by))} ${whenAt(c.at)}${c.version !== shown ? `, on version ${c.version}` : ''}`;
}

/** "On “Cart”": what a comment is about, for the plan's list of every comment. */
export function commentTarget(plan: Plan, on: PlanComment['on']): string {
  if (on.kind === 'plan') return 'On the plan';
  if (on.kind === 'milestone') {
    const m = milestoneById(plan, on.id);
    return m ? `On the milestone ${named(m.title)}` : 'On a milestone no longer in the plan';
  }
  const t = plan.tasks.find((x) => x.id === on.id);
  return t ? `On ${named(t.title)}` : 'On a task no longer in the plan';
}

// ---------------------------------------------------------------------------------------------------------------
// The Plan approval setting

export const PLAN_APPROVAL_WORDS: Record<PlanApproval, { label: string; sentence: string }> = {
  'before-work': { label: 'Before work starts', sentence: "The CEO's plan waits for your approval, and nobody starts a task of it until you approve." },
  milestones: { label: 'At every milestone', sentence: 'You approve the plan a milestone at a time: when one is done, the next waits for you.' },
  off: { label: 'Off', sentence: "The CEO's plan applies as proposed, and the heads assign work as they go." },
};

/** What a change of the setting says once the office took it: "Plan approval is now at every milestone." */
export const planApprovalChanged = (to: PlanApproval): string =>
  to === 'off' ? 'Plan approval is now off.' : `Plan approval is now ${PLAN_APPROVAL_WORDS[to].label.charAt(0).toLowerCase()}${PLAN_APPROVAL_WORDS[to].label.slice(1)}.`;

/** Said before you turn approval off while a version waits: what turning it off does to it. */
export function offWarning(company: CompanyView): string | null {
  const view = planOf(company);
  const latest = latestOf(view);
  if (!latest || approvalOf(company) === 'off') return null;
  const approved = approvedIn(view, latest);
  if (approved && approved.size === latest.plan.milestones.length) return null;
  return `Version ${latest.version} waits for your approval. Turning approval off applies it as proposed, so its work starts.`;
}

// ---------------------------------------------------------------------------------------------------------------
// On the Tasks tab

/** The plan's line atop Tasks; null where there is nothing to say (no steering, or no plan with approval off). */
export function planSummary(company: CompanyView): { label: string; tone: StateTone; line: string } | null {
  if (!company.steering || company.phase === 'founding' || company.phase === 'proposed') return null;
  const state = planState(company);
  if ((state.kind === 'none' || state.kind === 'drafting') && approvalOf(company) === 'off') return null;
  return state.pill ? { label: state.pill.label, tone: state.pill.tone, line: state.lines[0] ?? '' } : null;
}
