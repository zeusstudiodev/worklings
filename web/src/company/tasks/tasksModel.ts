// Tasks (docs/design-v3.md, "Tasks"): the goal and its milestones, the work by status or by room, each row's line and
// a task's own page. Pure, so it can be tested.
import { type CompanyView, STAKEHOLDER, type Task, type TaskStatus } from '../../../../src/core/company.ts';
import { clip, coarseDuration, plainText } from '../../../../src/core/now.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute } from '../../lib/format.ts';
import { endSentence, firstSentence, inLine, latestReport, nameOf, roomName, type Tone, waitsOf } from '../people/peopleModel.ts';

export const TASK_WORD: Record<TaskStatus, string> = { queued: 'Queued', working: 'Working', blocked: 'Blocked', review: 'In review', done: 'Done', dropped: 'Dropped' };
export const TASK_TONE: Record<TaskStatus, Tone> = { queued: 'waiting', working: 'working', blocked: 'error', review: 'waiting', done: 'done', dropped: 'neutral' };

/** Find shows from this many tasks. */
export const FIND_TASKS_OVER = 20;
export const NO_TASKS = 'No tasks yet. The heads split the goal into tasks once the company starts.';
export const LANDS_LATER = "Changes land in one commit when it's done.";

const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'dropped';

// ---------------------------------------------------------------------------------------------------------------
// The goal and its milestones

export interface MilestoneView {
  id: string;
  title: string;
  done: number;
  total: number;
  /** "8 of 10 tasks done", or "Done at 13:40". */
  line: string;
  /** How far along, 0 to 1, for the bar. */
  share: number;
}

/**
 * A milestone's tasks as Tasks and the plan both count them: the top-level ones that belong to it, whether the board
 * says so (`milestone`) or the plan made them (`planIds`), without those dropped. Subtasks are their parent's work.
 */
export const milestoneTasks = (tasks: readonly Task[], milestone: string, planIds: ReadonlySet<string> = new Set()): Task[] =>
  tasks.filter((t) => t.parent === null && t.status !== 'dropped' && (t.milestone === milestone || (!!t.planTask && planIds.has(t.planTask))));

export function milestonesOf(company: Pick<CompanyView, 'goal' | 'tasks'>): MilestoneView[] {
  return (company.goal?.milestones ?? []).map((m) => {
    const tasks = milestoneTasks(company.tasks, m.id);
    const done = tasks.filter((t) => t.status === 'done').length;
    const line = m.doneAt !== null ? `Done at ${hourMinute(m.doneAt)}` : tasks.length === 0 ? 'No tasks yet' : `${done} of ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} done`;
    return { id: m.id, title: plainText(m.title), done, total: tasks.length, line, share: m.doneAt !== null ? 1 : tasks.length === 0 ? 0 : done / tasks.length };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Rows

export interface TaskRow {
  task: Task;
  title: string;
  line: string;
  /** What the owner waits on you for, so the row offers Answer. */
  answer: string | null;
}

/** A report's first sentence without the "Blocked:" it may start with, since the line already says so. */
const why = (text: string) => firstSentence(text).replace(/^(blocked|stuck)\b[\s:,.-]*/i, '');

/**
 * "Kai, frontend engineer. Working for 12 min.", "Blocked: waits for your OK to use a paid API." with Answer, or "Done at
 * 14:20. 4 files changed." `changed` is the number of files its commit changed, once the diff has been read.
 */
export function taskRow(company: CompanyView, t: Task, now: number, changed?: number): TaskRow {
  const owner = nameOf(company, t.owner);
  const by = capital(owner.introduced);
  const title = clip(plainText(t.title), 200);
  const row = (line: string, answer: string | null = null): TaskRow => ({ task: t, title, line, answer });
  switch (t.status) {
    case 'working':
      return row(`${by}. Working for ${coarseDuration(now - t.updatedAt)}.`);
    case 'blocked': {
      const waits = waitsOf(company, t.owner, now);
      const own = waits.find((w) => w.kind === 'question' && w.question.taskId === t.id) ?? waits[0];
      if (own?.kind === 'approval') return row(`Blocked: waits for your OK to ${clip(inLine(own.approval.summary), 120)}.`, own.approval.id);
      if (own?.kind === 'question') return row(`Blocked: waits for your answer: ${endSentence(clip(plainText(own.question.text), 120))}`, own.question.id);
      const report = latestReport(company, t.owner, t.id);
      return row(report?.outcome === 'blocked' && why(report.text) ? `Blocked: ${why(report.text)}` : `${by}. Blocked.`);
    }
    case 'review': {
      const asker = t.askedBy === STAKEHOLDER ? null : nameOf(company, t.askedBy);
      return row(`${by}. In review${asker ? ` with ${asker.called}` : ''}.`);
    }
    case 'queued':
      return row(`${by}. Queued.`);
    case 'done':
      return row(`Done at ${hourMinute(t.updatedAt)}.${changed !== undefined && changed > 0 ? ` ${changed} ${changed === 1 ? 'file' : 'files'} changed.` : ''}`);
    case 'dropped':
      return row(`Dropped at ${hourMinute(t.updatedAt)}.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// By status and by room

export const STATUS_GROUPS: readonly { status: TaskStatus; title: string; fold: boolean }[] = [
  { status: 'blocked', title: 'Blocked', fold: false },
  { status: 'working', title: 'Working', fold: false },
  { status: 'review', title: 'In review', fold: false },
  { status: 'queued', title: 'Queued', fold: false },
  { status: 'done', title: 'Done', fold: true },
  { status: 'dropped', title: 'Dropped', fold: true },
];

const byId = (a: Task, b: Task) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Each status's tasks: longest blocked or working first, queued in the order asked, done and dropped newest first. */
export function byStatus(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const out: Record<TaskStatus, Task[]> = { queued: [], working: [], blocked: [], review: [], done: [], dropped: [] };
  for (const t of tasks) out[t.status].push(t);
  out.blocked.sort((a, b) => a.updatedAt - b.updatedAt || byId(a, b));
  out.working.sort((a, b) => a.updatedAt - b.updatedAt || byId(a, b));
  out.review.sort((a, b) => a.updatedAt - b.updatedAt || byId(a, b));
  out.queued.sort((a, b) => a.createdAt - b.createdAt || byId(a, b));
  out.done.sort((a, b) => b.updatedAt - a.updatedAt || byId(a, b));
  out.dropped.sort((a, b) => b.updatedAt - a.updatedAt || byId(a, b));
  return out;
}

export interface TaskNode {
  task: Task;
  /** 0 for a room's top tasks, one more per parent. */
  depth: number;
  children: TaskNode[];
}

export interface RoomTasks {
  room: string;
  name: string;
  nodes: TaskNode[];
  count: number;
}

/** A task's room is its owner's; tasks whose owner left the company go under "No room". */
export function byRoom(snapshot: Pick<Snapshot, 'studio'>, company: Pick<CompanyView, 'people'>, tasks: readonly Task[]): RoomTasks[] {
  const roomOf = (t: Task) => company.people.find((p) => p.id === t.owner)?.room ?? '';
  const ids = new Set(tasks.map((t) => t.id));
  const placed = new Set<string>();
  const sorted = [...tasks].sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || a.createdAt - b.createdAt || byId(a, b));
  const node = (t: Task, depth: number): TaskNode => {
    placed.add(t.id);
    const children: TaskNode[] = [];
    for (const k of sorted) if (k.parent === t.id && roomOf(k) === roomOf(t) && !placed.has(k.id)) children.push(node(k, depth + 1));
    return { task: t, depth, children };
  };
  const rooms = new Map<string, TaskNode[]>();
  for (const t of sorted) {
    if (placed.has(t.id)) continue;
    const parentHere = t.parent !== null && ids.has(t.parent) && tasks.some((p) => p.id === t.parent && roomOf(p) === roomOf(t));
    if (parentHere) continue;
    rooms.set(roomOf(t), [...(rooms.get(roomOf(t)) ?? []), node(t, 0)]);
  }
  // A loop of parents leaves its tasks unplaced: they go at the top of their room.
  for (const t of sorted) if (!placed.has(t.id)) rooms.set(roomOf(t), [...(rooms.get(roomOf(t)) ?? []), node(t, 0)]);
  const order = snapshot.studio?.departments.map((d) => d.id) ?? [];
  const count = (nodes: TaskNode[]): number => nodes.reduce((s, n) => s + 1 + count(n.children), 0);
  return [...rooms]
    .map(([room, nodes]) => ({ room, name: room ? roomName(snapshot, room) : 'No room', nodes, count: count(nodes) }))
    .sort((a, b) => (a.room === '' ? 1 : 0) - (b.room === '' ? 1 : 0) || (order.indexOf(a.room) + 1 || 99) - (order.indexOf(b.room) + 1 || 99));
}

export function flattenTasks(nodes: readonly TaskNode[]): TaskNode[] {
  return nodes.flatMap((n) => [n, ...flattenTasks(n.children)]);
}

const searchable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Tasks whose title or owner matches. */
export function findTasks(company: Pick<CompanyView, 'people'>, tasks: readonly Task[], query: string): Task[] {
  const q = searchable(query.trim());
  if (!q) return [...tasks];
  return tasks.filter((t) => {
    const owner = company.people.find((p) => p.id === t.owner);
    return [t.title, owner?.name ?? '', owner?.title ?? ''].some((f) => searchable(f).includes(q));
  });
}

/** "4 of 51 tasks". */
export const foundTasksLine = (found: number, total: number): string => `${found} of ${total} ${total === 1 ? 'task' : 'tasks'}`;

/** "All 51 tasks are done." once nothing is left to do. */
export function allDoneLine(tasks: readonly Task[]): string | null {
  if (tasks.length === 0 || tasks.some(isOpen)) return null;
  const done = tasks.filter((t) => t.status === 'done').length;
  return done === 1 ? 'The one task is done.' : `All ${done} tasks are done.`;
}

// ---------------------------------------------------------------------------------------------------------------
// A task's page

export interface TaskPage {
  /** "Kai, frontend engineer, owns it." */
  owns: string;
  /** "Ines asked at 13:02." or "You asked at 13:02." */
  asked: string;
  /** The task it is part of (a link), or its milestone. */
  partOf: { kind: 'task'; id: string; title: string } | { kind: 'milestone'; title: string } | null;
  brief: string;
  doneWhen: string;
  files: string[];
  subtasks: Task[];
  outcome: string | null;
  /** What changed, until there is a commit to read: null once there is one. */
  changes: string | null;
}

export function taskPage(company: CompanyView, t: Task): TaskPage {
  const parent = t.parent ? company.tasks.find((p) => p.id === t.parent) : undefined;
  const milestone = t.milestone ? company.goal?.milestones.find((m) => m.id === t.milestone) : undefined;
  const asker = t.askedBy === STAKEHOLDER ? 'You' : capital(nameOf(company, t.askedBy).called);
  return {
    owns: `${capital(nameOf(company, t.owner).subject)} owns it.`,
    asked: `${asker} asked at ${hourMinute(t.createdAt)}.`,
    partOf: parent ? { kind: 'task', id: parent.id, title: clip(plainText(parent.title), 160) } : milestone ? { kind: 'milestone', title: plainText(milestone.title) } : null,
    brief: plainText(t.brief),
    doneWhen: plainText(t.doneWhen),
    files: t.files,
    subtasks: company.tasks.filter((k) => k.parent === t.id).sort((a, b) => a.createdAt - b.createdAt || byId(a, b)),
    outcome: t.outcome ? plainText(t.outcome) : null,
    changes: t.commit ? null : t.status === 'done' ? 'Nothing in the project changed.' : t.status === 'dropped' ? null : LANDS_LATER,
  };
}
