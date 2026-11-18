// The office's progress view (SPEC-v0.2.md, "Simple, visible, proven", 2 and 4; docs/design-v3.md, "Progress"): where a
// company stands in plain words, written by code from its view. The goal in the stakeholder's words, what needs them and
// where it opens, the checklist, the milestones with their tasks as status words, and what happened since they last
// looked. No ids, paths or tool names in what it says; files changed sit one press away under a finished task. Pure, for
// tests (test/progress-model.test.ts).
import { type CompanyStage, type CompanyView, FIX_ROUNDS, type NeedsYouItem, type SinceDigest, type Task, type TaskLook } from '../../../../src/core/company.ts';
import { isOpenTask } from '../../../../src/core/company-state.ts';
import type { JobPack } from '../../../../src/core/packs.ts';
import type { TodoItem } from '../../../../src/core/plain.ts';
import { clip, coarseAge, countWord, plainText } from '../../../../src/core/now.ts';
import { needsYouOf, stageOf, summaryInputOfView, summaryOf, type SummaryInput } from '../../../../src/core/overview.ts';
import { approvedVersion, latestVersion } from '../../../../src/core/plan.ts';
import { type Plan, type PlanTask } from '../../../../src/core/steering.ts';
import { inSentence } from '../../../../src/core/studio.ts';
import { capital } from '../../../../src/core/words.ts';
import { dollars } from '../../lib/format.ts';
import type { CompanyRoute } from '../address.ts';
import { type CardProgress, progressLine, routeOf, spendLine, stageWord } from '../lobby/lobbyModel.ts';
import type { StateTone } from '../ui/tone.ts';

// ---------------------------------------------------------------------------------------------------------------
// The summary, from a view: the same summaryOf the lobby card uses, so the two always agree

/**
 * The view as the overview's input (summaryInputOfView): what the lobby's summary and the progress view are both written
 * from, with the lobby card's own at-work set and spend.
 */
export const summaryInputOf = (c: CompanyView): SummaryInput => summaryInputOfView(c);

/**
 * Where the company stands, from its view: the one stage the bar's pill, the lobby's card (from the same summaryOf on the
 * hub) and this view's heading all say. `now` is the office's clock: an approval that has timed out no longer waits.
 */
export const stageOfView = (c: CompanyView, now: number): CompanyStage => stageOf(summaryInputOf(c), now);

// ---------------------------------------------------------------------------------------------------------------
// v0.3: fixing, and what the office saw of the app (SPEC-v0.3.md, Q1 and Q3)

export interface FixingView {
  /** "Kai fixes one thing the office's checks found, round 1 of 2." */
  line: string;
  round: number;
}

/** The fix rounds under way, in plain words; null while none is. */
export function fixingView(c: Pick<CompanyView, 'tasks' | 'people'>): FixingView | null {
  const open = c.tasks.filter((t) => t.followUp?.kind === 'fix' && isOpenTask(t));
  if (open.length === 0) return null;
  const round = Math.max(...open.map((t) => t.followUp?.round ?? 1));
  const names = [...new Set(open.map((t) => ownerName(c, t.owner)))];
  const things = open.reduce((n, t) => n + Math.max(1, t.followUp?.items.length ?? 1), 0);
  const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${countWord(names.length - 2)} more`;
  const found = open.some((t) => t.followUp?.source === 'acceptance') ? "the office's checks found" : 'the final review found';
  return { line: `${who} ${names.length === 1 ? 'fixes' : 'fix'} ${things === 1 ? 'one thing' : `${countWord(things)} things`} ${found}, round ${round} of ${FIX_ROUNDS}.`, round };
}

/** Where the company stands in a word, as the bar's pill and this view say it: "Fixing" while fix rounds run, else the stage's word. */
export function stageShown(c: CompanyView, now: number): { word: string; tone: StateTone } {
  const stage = stageOfView(c, now);
  if ((stage === 'working' || stage === 'checking') && fixingView(c) !== null) return { word: 'Fixing', tone: 'working' };
  return stageWord(stage);
}

export interface SeenView {
  /** "The office opened the app on a phone and a desktop screen 12 min ago." */
  line: string;
  /** "2 of 3 checks passed. One error showed in the browser." */
  detail: string | null;
  tone: StateTone;
}

/** The newest look the office took at the app before a review, in plain words; null before any. */
export function seenView(c: Pick<CompanyView, 'tasks'>, now: number): SeenView | null {
  const looks = c.tasks.flatMap((t) => (t.look ? [t.look] : [])).sort((a, b) => a.at - b.at);
  const look: TaskLook | undefined = looks.at(-1);
  if (!look) return null;
  if (look.state === 'running') return { line: 'The office is opening the app to look at it, on a phone and a desktop screen.', detail: null, tone: 'working' };
  const ago = coarseAge(now - look.at);
  if (look.state === 'skipped') return { line: `The office didn't open it in a browser (${ago}), so the final review judged it from its code and checks.`, detail: null, tone: 'neutral' };
  if (look.state === 'failed') return { line: `The office tried to open the app ${ago}, and it didn't open.`, detail: null, tone: 'error' };
  const passed = look.checks.filter((k) => k.ok).length;
  const parts = [
    ...(look.checks.length > 0 ? [`${capital(countWord(passed))} of ${countWord(look.checks.length)} ${look.checks.length === 1 ? 'check' : 'checks'} passed.`] : []),
    look.errors.length === 0 ? 'No errors showed in the browser.' : `${capital(countWord(look.errors.length))} ${look.errors.length === 1 ? 'error' : 'errors'} showed in the browser.`,
    ...(look.shots.some((s) => s.overflow) ? ['On a phone the page scrolls sideways.'] : []),
  ];
  const clean = passed === look.checks.length && look.errors.length === 0 && !look.shots.some((s) => s.overflow);
  return { line: `The office opened the app on a phone and a desktop screen ${ago}.`, detail: parts.join(' '), tone: clean ? 'done' : 'needs' };
}

// ---------------------------------------------------------------------------------------------------------------
// What needs you

export interface NeedsRow {
  key: string;
  /** A word for what it is: "A question", "Your OK", "The plan". */
  kind: string;
  text: string;
  /** "Mina, 12 min ago", "The office, 3 h ago". */
  meta: string;
  /** Where it opens, and the words on the way there; null for work that stopped (this view is where it shows). */
  open: { route: CompanyRoute; label: string } | null;
}

const NEEDS_KIND: Readonly<Record<NeedsYouItem['kind'], { word: string; action: string | null }>> = {
  proposal: { word: 'The proposal', action: 'Open the proposal' },
  scoping: { word: "The CEO's question", action: 'Answer' },
  plan: { word: 'The plan', action: 'Open the plan' },
  milestone: { word: 'A milestone', action: 'Open the plan' },
  question: { word: 'A question', action: 'Answer' },
  approval: { word: 'Your OK', action: 'Answer' },
  budget: { word: 'The budget', action: 'Answer' },
  stuck: { word: 'Stopped', action: null },
};

export function needsRows(c: CompanyView, now: number): NeedsRow[] {
  const items = needsYouOf(summaryInputOf(c), c.id, now);
  return items.map((item, i) => {
    const words = NEEDS_KIND[item.kind];
    const target = item.target;
    const key = 'panel' in target && target.panel === 'inbox' ? `inbox:${target.item}` : `${item.kind}:${i}`;
    return {
      key,
      kind: words.word,
      text: item.text,
      meta: `${item.from ?? 'The office'}, ${coarseAge(now - item.at)}`,
      open: words.action ? { route: routeOf(target), label: words.action } : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Milestones and their tasks

/** A task as one word: what a person would say it is doing. */
export type TaskWord = 'Done' | 'Working' | 'Checking' | 'Fixing' | 'Waiting' | 'Stuck' | 'Paused' | 'Dropped' | 'Not started';

export const TASK_TONE: Readonly<Record<TaskWord, StateTone>> = {
  Done: 'done',
  Working: 'working',
  Checking: 'working',
  Fixing: 'working',
  Waiting: 'waiting',
  Stuck: 'error',
  Paused: 'rest',
  Dropped: 'neutral',
  'Not started': 'neutral',
};

/** A board task (or none yet) in a word; a verification task at work is checking. */
export function taskWord(task: Pick<Task, 'status' | 'paused'> | null, kind?: PlanTask['kind']): TaskWord {
  if (!task) return 'Not started';
  switch (task.status) {
    case 'done':
      return 'Done';
    case 'dropped':
      return 'Dropped';
    case 'review':
      return 'Checking';
    case 'blocked':
      return 'Stuck';
    case 'queued':
      return task.paused ? 'Paused' : 'Waiting';
    case 'working':
      return task.paused ? 'Paused' : kind === 'verification' ? 'Checking' : 'Working';
  }
}

export interface TaskRow {
  key: string;
  title: string;
  /** "Kai", or "Someone who left". */
  owner: string;
  word: TaskWord;
  tone: StateTone;
  /** The board task to open in the side panel; null before the plan task has one. */
  task: string | null;
}

export interface MilestoneRow {
  id: string;
  title: string;
  /** Done; the one work is on now (the first not done); or later. */
  state: 'done' | 'now' | 'later';
  /** "Done", "4 of 6 tasks done", "Not started", "No tasks yet". */
  line: string;
  done: number;
  total: number;
  tasks: TaskRow[];
  /** Tasks the team split off the plan's for this milestone, which the plan doesn't list. */
  extra: number;
}

const ownerName = (c: Pick<CompanyView, 'people'>, id: string): string => {
  const name = c.people.find((p) => p.id === id)?.name;
  return name ? clip(plainText(name), 60) : 'Someone who left';
};

/** The plan the progress view tells: the approved version, else the latest, else none. */
export function planShown(c: Pick<CompanyView, 'steering'>): Plan | null {
  const plan = c.steering?.plan;
  if (!plan) return null;
  return (approvedVersion(plan) ?? latestVersion(plan))?.plan ?? null;
}

export function milestoneRows(c: Pick<CompanyView, 'steering' | 'goal' | 'tasks' | 'people'>): MilestoneRow[] {
  const plan = planShown(c);
  const doneAt = new Map((c.goal?.milestones ?? []).map((m) => [m.id, m.doneAt]));
  const newest = new Map<string, Task>();
  for (const t of c.tasks) if (t.planTask) newest.set(t.planTask, t);
  const fromPlan = new Set(newest.values());
  const milestones = plan?.milestones ?? c.goal?.milestones ?? [];
  let current = false;
  return milestones.map((m) => {
    const tasks: TaskRow[] = plan
      ? plan.tasks
          .filter((t) => t.milestone === m.id)
          .map((t) => {
            const board = newest.get(t.id) ?? null;
            // A built task whose fix is under way reads "Fixing" (v0.3).
            const names = (line: string): boolean => new RegExp(`(?<![\\w-])(?:${t.id}|${board?.id ?? t.id})(?![\\w-])`).test(line);
            const fixing = board !== null && c.tasks.some((x) => x.followUp?.kind === 'fix' && isOpenTask(x) && x.followUp.items.some(names));
            const word = fixing ? 'Fixing' : taskWord(board, t.kind);
            return { key: t.id, title: clip(plainText(t.title), 120), owner: ownerName(c, board?.owner ?? t.owner), word, tone: TASK_TONE[word], task: board?.id ?? null };
          })
      : c.tasks
          .filter((t) => t.milestone === m.id && t.parent === null && t.followUp === undefined)
          .map((t) => {
            const word = taskWord(t);
            return { key: t.id, title: clip(plainText(t.title), 120), owner: ownerName(c, t.owner), word, tone: TASK_TONE[word], task: t.id };
          });
    const counted = tasks.filter((t) => t.word !== 'Dropped');
    const done = counted.filter((t) => t.word === 'Done').length;
    const total = counted.length;
    const finished = (doneAt.get(m.id) ?? null) !== null || (total > 0 && done === total);
    const started = tasks.some((t) => t.word !== 'Not started' && t.word !== 'Dropped');
    // The first milestone not done is the one work is on; a later one already started counts as now too.
    const state: MilestoneRow['state'] = finished ? 'done' : !current || started ? 'now' : 'later';
    if (!finished) current = true;
    const extra = plan ? c.tasks.filter((t) => t.milestone === m.id && !fromPlan.has(t) && t.status !== 'dropped').length : 0;
    const line = finished ? 'Done' : total === 0 ? 'No tasks yet' : done === 0 && !started ? 'Not started' : `${done} of ${total} tasks done`;
    return { id: m.id, title: clip(plainText(m.title), 120), state, line, done, total, tasks, extra };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Since you last looked

export type SinceView =
  /** The office keeps no visits (one from before 0.2): nothing is said. */
  | { kind: 'unknown' }
  | { kind: 'first' }
  | {
      kind: 'since';
      /** "3 h ago". */
      ago: string;
      /** "Four tasks finished, two decisions made and $1.80 spent." or "Nothing has changed." */
      summary: string;
      finished: { key: string; title: string; by: string; ago: string; files: string[] }[];
      finishedCount: number;
      decisions: { key: string; what: string; by: string; ago: string }[];
      decisionCount: number;
      spent: string | null;
      waiting: number;
    };

const plural = (n: number, one: string, many: string): string => `${countWord(n)} ${n === 1 ? one : many}`;

function sinceSummary(d: SinceDigest): string {
  const parts = [
    ...(d.finishedCount > 0 ? [`${plural(d.finishedCount, 'task', 'tasks')} finished`] : []),
    ...(d.decisionCount > 0 ? [`${plural(d.decisionCount, 'decision', 'decisions')} made`] : []),
    ...(d.spent >= 0.005 ? [`${dollars(d.spent)} spent`] : []),
  ];
  if (parts.length === 0) return 'Nothing has changed.';
  const list = parts.length === 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
  return `${capital(list)}.`;
}

export function sinceView(c: Pick<CompanyView, 'looked' | 'since'>, now: number): SinceView {
  if (c.since === undefined && c.looked === undefined) return { kind: 'unknown' };
  const d = c.since ?? null;
  if (d === null) return { kind: 'first' };
  return {
    kind: 'since',
    ago: coarseAge(now - d.since),
    summary: sinceSummary(d),
    finished: d.finished.map((f, i) => ({ key: `${i}:${f.at}`, title: f.title, by: f.by, ago: coarseAge(now - f.at), files: f.files })),
    finishedCount: d.finishedCount,
    decisions: d.decisions.map((x, i) => ({ key: `${i}:${x.at}`, what: x.what, by: x.by, ago: coarseAge(now - x.at) })),
    decisionCount: d.decisionCount,
    spent: d.spent >= 0.005 ? dollars(d.spent) : null,
    waiting: d.waiting,
  };
}

/** "One question waits for you.", "Three wait for you." */
export const waitingWords = (n: number): string => `${capital(countWord(n))} ${n === 1 ? 'thing waits' : 'things wait'} for you.`;

// ---------------------------------------------------------------------------------------------------------------
// The whole view

export interface ProgressView {
  /** The stakeholder's words: the first sentence leads, the rest follows. Null before they wrote any. */
  goal: { lead: string; rest: string } | null;
  stage: { word: string; tone: StateTone };
  /** v0.3: fix rounds under way, and the office's last look at the app. */
  fixing: FixingView | null;
  seen: SeenView | null;
  progress: CardProgress;
  spend: string;
  needs: NeedsRow[];
  milestones: MilestoneRow[];
  /** What the milestones say when there are none: no plan yet, or whoever leads still drafting. */
  noPlan: string;
  /** What the checklist says before there is one; null for a one-session job, which never has one. */
  noChecklist: string | null;
  /** A one-session job's own to-do list, as Claude Code keeps it; null for a team, which has milestones instead. */
  todos: TodoRow[] | null;
  since: SinceView;
}

/** One item of Claude Code's own to-do list, in a word. */
export interface TodoRow {
  key: string;
  title: string;
  word: TaskWord;
  tone: StateTone;
}

/** Whether the job is one Claude Code session (v0.7), which has no plan, milestones, checklist or CEO. */
const isPlainJob = (c: Pick<CompanyView, 'shape'>): boolean => c.shape === 'plain';

/** Who leads a team, in a sentence: "the CEO", "the lead". */
function leaderOf(c: Pick<CompanyView, 'people'>): string {
  const title = c.people.find((p) => p.level === 'ceo')?.title;
  return `the ${title ? inSentence(title) : 'CEO'}`;
}

const TODO_WORD: Readonly<Record<TodoItem['status'], TaskWord>> = { pending: 'Not started', in_progress: 'Working', completed: 'Done' };

/** Claude Code's to-do list as rows, in its own order. */
export function todoRows(todos: readonly TodoItem[]): TodoRow[] {
  return todos.map((t) => ({ key: t.id, title: clip(plainText(t.text), 120), word: TODO_WORD[t.status], tone: TASK_TONE[TODO_WORD[t.status]] }));
}

/** How far a one-session job's to-do list is: "2 of 5 to-dos done", or none kept yet. */
export function todoProgress(todos: readonly TodoItem[]): CardProgress {
  if (todos.length === 0) return { line: 'No to-do list yet', share: null };
  const done = todos.filter((t) => t.status === 'completed').length;
  return { line: `${done} of ${todos.length} ${todos.length === 1 ? 'to-do' : 'to-dos'} done`, share: done / todos.length };
}

/** The prompt as the stakeholder wrote it, plain and on one line: its first sentence leads, the rest follows. */
export function goalWords(prompt: string): { lead: string; rest: string } | null {
  const text = plainText(prompt).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const first = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  return { lead: first, rest: text.slice(first.length).trim() };
}

export function progressView(c: CompanyView, now: number): ProgressView {
  const summary = summaryOf(summaryInputOf(c), now);
  const plain = isPlainJob(c);
  const leader = leaderOf(c);
  return {
    goal: goalWords(c.prompt) ?? (c.goal ? goalWords(c.goal.text) : null),
    stage: fixingView(c) !== null && (summary.stage === 'working' || summary.stage === 'checking') ? { word: 'Fixing', tone: 'working' } : stageWord(summary.stage),
    fixing: fixingView(c),
    seen: seenView(c, now),
    progress: plain ? todoProgress(c.todos ?? []) : progressLine(summary),
    spend: spendLine(summary.spend),
    needs: needsRows(c, now),
    milestones: milestoneRows(c),
    noPlan: plain
      ? "No to-do list yet. When Claude Code keeps one for this job, its items show here and on the task board."
      : c.phase === 'founding'
        ? `${capital(leader)} is drafting your company. The plan comes once you start it.`
        : c.phase === 'proposed'
          ? `The plan comes once you start the company: ${leader} writes it first thing.`
          : `No plan yet. ${capital(leader)} proposes one, and you approve it before work starts.`,
    noChecklist: plain ? null : `No checklist yet. ${capital(leader)} writes one with the plan: each thing you asked for, as a sentence that can be checked, and the tasks that build it.`,
    todos: plain ? todoRows(c.todos ?? []) : null,
    since: sinceView(c, now),
  };
}

/** v0.9: what packs a one-session job started with, as Progress says it under the goal; null when none. */
export function packsLine(packs: readonly JobPack[] | undefined): string | null {
  if (!packs || packs.length === 0) return null;
  const how = (p: JobPack): string =>
    p.state === 'edited' ? `${p.title} (edited since)` : p.state === 'partial' ? `${p.title} (partly removed since)` : p.state === 'absent' || p.state === 'conflict' ? `${p.title} (removed since)` : p.title;
  const names = packs.map(how);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}` : (names[0] ?? '');
  return `Started with ${packs.length === 1 ? 'the pack' : 'the packs'} ${list}: files in the project's .claude/ you can edit or delete.`;
}
