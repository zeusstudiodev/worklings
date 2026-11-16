// Your changes to the plan, before they are saved (SPEC-v3.md "Steering", 1): each change is an operation, and the draft
// is the latest version with your operations replayed on it. A new version from the CEO meanwhile takes your changes on
// top; one that no longer applies (its task was cut) is dropped with a sentence saying why. Saving sends the result as
// one new version, so a run of small moves doesn't become a run of versions. Pure, so it can be tested.
import { LIMITS } from '../../../../src/core/company.ts';
import { clip, countWord, plainText } from '../../../../src/core/now.ts';
import { checkPlan, normalizePlanPath, pathsOverlap, type PlanPerson } from '../../../../src/core/plan.ts';
import { CHECKLIST_LIMITS, type ChecklistItem, PLAN_LIMITS, type Plan, type PlanMilestone, type PlanTask } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';

export type TaskFields = Pick<PlanTask, 'title' | 'owner' | 'files' | 'milestone' | 'after' | 'brief' | 'doneWhen'>;
export type MilestoneFields = Pick<PlanMilestone, 'title' | 'doneWhen'>;
/** What you change on a checklist item: its sentence and the tasks that cover it. Their words (the quote) stay as written. */
export type ItemFields = Pick<ChecklistItem, 'text' | 'covers'>;

/** Where a task goes: into a milestone, before one of its tasks or, with `before: null`, at its end. */
export interface TaskSlot {
  milestone: string;
  before: string | null;
}

/** One change to the plan. `name` is the title it had when you changed it, for the sentence if it no longer applies. */
export type PlanOp =
  | { op: 'goal'; goal: string }
  | { op: 'edit-task'; id: string; name: string; set: Partial<TaskFields> }
  | { op: 'edit-milestone'; id: string; name: string; set: Partial<MilestoneFields> }
  | { op: 'move-task'; id: string; name: string; to: TaskSlot }
  | { op: 'move-milestone'; id: string; name: string; before: string | null }
  | { op: 'cut-task'; id: string; name: string }
  | { op: 'cut-milestone'; id: string; name: string }
  | { op: 'add-task'; task: PlanTask; before: string | null }
  | { op: 'add-milestone'; milestone: PlanMilestone; before: string | null }
  // v0.2: the checklist of what you asked for (SPEC-v0.2.md, "Simple, visible, proven", 3).
  | { op: 'add-item'; item: ChecklistItem; before: string | null }
  | { op: 'edit-item'; id: string; name: string; set: Partial<ItemFields> }
  | { op: 'cut-item'; id: string; name: string };

export interface Draft {
  ops: PlanOp[];
  /** Your note for the version, in your words; empty lets the office say what changed. */
  note: string;
}

export const EMPTY_DRAFT: Draft = { ops: [], note: '' };
/** A draft keeps this many changes; older ones fold into the plan it shows (they stay applied). */
export const MAX_OPS = 300;

/** The draft with one more change, or null when it already holds MAX_OPS: the oldest is never dropped silently. */
export const withOp = (draft: Draft, op: PlanOp): Draft | null => (draft.ops.length >= MAX_OPS ? null : { ...draft, ops: [...draft.ops, op] });

/** A title as a sentence quotes it: plain, one line, cut. */
export const named = (title: string): string => `“${clip(plainText(title), 60)}”`;

// ---------------------------------------------------------------------------------------------------------------
// Reading a plan

/** A milestone's tasks in the plan's order. */
export const tasksIn = (plan: Plan, milestone: string): PlanTask[] => plan.tasks.filter((t) => t.milestone === milestone);

export const taskById = (plan: Plan, id: string): PlanTask | undefined => plan.tasks.find((t) => t.id === id);
export const milestoneById = (plan: Plan, id: string): PlanMilestone | undefined => plan.milestones.find((m) => m.id === id);
export const itemById = (plan: Plan, id: string): ChecklistItem | undefined => plan.checklist?.find((k) => k.id === id);

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** A place in a list: "second", "12th", "21st". */
export function placeWord(n: number): string {
  const word = ORDINALS[n - 1];
  if (word) return word;
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** "Second of five in “Pickup orders work”." */
export function taskPlace(plan: Plan, id: string): string | null {
  const task = taskById(plan, id);
  if (!task) return null;
  const list = tasksIn(plan, task.milestone);
  const milestone = milestoneById(plan, task.milestone);
  return `${capital(placeWord(list.findIndex((t) => t.id === id) + 1))} of ${countWord(list.length)} in ${milestone ? named(milestone.title) : 'its milestone'}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Applying changes

type Applied = { ok: true; plan: Plan } | { ok: false; why: string };

const missingTask = (name: string): Applied => ({ ok: false, why: `${capital(named(name))} isn't in the plan any more.` });
const missingMilestone = (name: string): Applied => ({ ok: false, why: `The milestone ${named(name)} isn't in the plan any more.` });
const missingItem = (name: string): Applied => ({ ok: false, why: `The checklist item ${named(name)} isn't in the plan any more.` });

/** Takes task ids out of what every checklist item is covered by: a cut task covers nothing. */
function uncover(plan: Plan, gone: ReadonlySet<string>): Pick<Plan, 'checklist'> {
  if (!plan.checklist) return {};
  return { checklist: plan.checklist.map((k) => (k.covers.some((id) => gone.has(id)) ? { ...k, covers: k.covers.filter((id) => !gone.has(id)) } : k)) };
}

/**
 * Where a task for `milestone` goes when it joins at the milestone's end: after its last task, else before the first
 * task of a milestone that comes later, else at the end of the plan.
 */
function endOf(plan: Plan, tasks: readonly PlanTask[], milestone: string): number {
  let last = -1;
  tasks.forEach((t, i) => {
    if (t.milestone === milestone) last = i;
  });
  if (last >= 0) return last + 1;
  const order = plan.milestones.map((m) => m.id);
  const at = order.indexOf(milestone);
  const later = tasks.findIndex((t) => order.indexOf(t.milestone) > at);
  return later >= 0 ? later : tasks.length;
}

/** Puts `task` into the plan's tasks at a slot; the slot's milestone must be in the plan. */
function placeTask(plan: Plan, others: readonly PlanTask[], task: PlanTask, slot: TaskSlot): PlanTask[] {
  const moved = { ...task, milestone: slot.milestone };
  const anchor = slot.before === null ? -1 : others.findIndex((t) => t.id === slot.before && t.milestone === slot.milestone);
  const at = anchor >= 0 ? anchor : endOf(plan, others, slot.milestone);
  return [...others.slice(0, at), moved, ...others.slice(at)];
}

/** Takes ids out of what every task waits for. */
const unwait = (tasks: readonly PlanTask[], gone: ReadonlySet<string>): PlanTask[] =>
  tasks.map((t) => (t.after.some((id) => gone.has(id)) ? { ...t, after: t.after.filter((id) => !gone.has(id)) } : t));

export function applyOp(plan: Plan, op: PlanOp): Applied {
  switch (op.op) {
    case 'goal':
      return { ok: true, plan: { ...plan, goal: op.goal } };
    case 'edit-task': {
      const task = taskById(plan, op.id);
      if (!task) return missingTask(op.name);
      const { milestone, ...rest } = op.set;
      const edited: PlanTask = { ...task, ...rest };
      if (milestone !== undefined && milestone !== task.milestone) {
        if (!milestoneById(plan, milestone)) return { ok: false, why: `${capital(named(op.name))} was to move to a milestone that isn't in the plan any more.` };
        return { ok: true, plan: { ...plan, tasks: placeTask(plan, plan.tasks.filter((t) => t.id !== op.id), edited, { milestone, before: null }) } };
      }
      return { ok: true, plan: { ...plan, tasks: plan.tasks.map((t) => (t.id === op.id ? edited : t)) } };
    }
    case 'edit-milestone': {
      if (!milestoneById(plan, op.id)) return missingMilestone(op.name);
      return { ok: true, plan: { ...plan, milestones: plan.milestones.map((m) => (m.id === op.id ? { ...m, ...op.set } : m)) } };
    }
    case 'move-task': {
      const task = taskById(plan, op.id);
      if (!task) return missingTask(op.name);
      if (!milestoneById(plan, op.to.milestone)) return { ok: false, why: `${capital(named(op.name))} was to move to a milestone that isn't in the plan any more.` };
      if (op.to.before === op.id) return { ok: true, plan };
      return { ok: true, plan: { ...plan, tasks: placeTask(plan, plan.tasks.filter((t) => t.id !== op.id), task, op.to) } };
    }
    case 'move-milestone': {
      const m = milestoneById(plan, op.id);
      if (!m) return missingMilestone(op.name);
      if (op.before === op.id) return { ok: true, plan };
      const rest = plan.milestones.filter((x) => x.id !== op.id);
      const anchor = op.before === null ? -1 : rest.findIndex((x) => x.id === op.before);
      const at = anchor >= 0 ? anchor : rest.length;
      const milestones = [...rest.slice(0, at), m, ...rest.slice(at)];
      // Its tasks move with it as a block, so the order work is handed out in follows the milestones.
      const order = milestones.map((x) => x.id);
      const own = plan.tasks.filter((t) => t.milestone === op.id);
      const others = plan.tasks.filter((t) => t.milestone !== op.id);
      const next = others.findIndex((t) => order.indexOf(t.milestone) > order.indexOf(op.id));
      const cut = next >= 0 ? next : others.length;
      return { ok: true, plan: { ...plan, milestones, tasks: [...others.slice(0, cut), ...own, ...others.slice(cut)] } };
    }
    case 'cut-task': {
      if (!taskById(plan, op.id)) return missingTask(op.name);
      const gone = new Set([op.id]);
      return { ok: true, plan: { ...plan, tasks: unwait(plan.tasks.filter((t) => t.id !== op.id), gone), ...uncover(plan, gone) } };
    }
    case 'cut-milestone': {
      if (!milestoneById(plan, op.id)) return missingMilestone(op.name);
      const gone = new Set(plan.tasks.filter((t) => t.milestone === op.id).map((t) => t.id));
      return {
        ok: true,
        plan: { ...plan, milestones: plan.milestones.filter((m) => m.id !== op.id), tasks: unwait(plan.tasks.filter((t) => !gone.has(t.id)), gone), ...uncover(plan, gone) },
      };
    }
    case 'add-task': {
      if (taskById(plan, op.task.id)) return { ok: false, why: `The plan has another task with the id of ${named(op.task.title)}. Add it again.` };
      if (!milestoneById(plan, op.task.milestone)) return { ok: false, why: `${capital(named(op.task.title))} was for a milestone that isn't in the plan any more.` };
      return { ok: true, plan: { ...plan, tasks: placeTask(plan, plan.tasks, op.task, { milestone: op.task.milestone, before: op.before }) } };
    }
    case 'add-milestone': {
      if (milestoneById(plan, op.milestone.id)) return { ok: false, why: `The plan has another milestone with the id of ${named(op.milestone.title)}. Add it again.` };
      const anchor = op.before === null ? -1 : plan.milestones.findIndex((m) => m.id === op.before);
      const at = anchor >= 0 ? anchor : plan.milestones.length;
      return { ok: true, plan: { ...plan, milestones: [...plan.milestones.slice(0, at), op.milestone, ...plan.milestones.slice(at)] } };
    }
    case 'add-item': {
      const list = plan.checklist ?? [];
      if (itemById(plan, op.item.id)) return { ok: false, why: `The checklist has another item with the id of ${named(op.item.text)}. Add it again.` };
      if (list.length >= CHECKLIST_LIMITS.items) return { ok: false, why: `The checklist holds ${CHECKLIST_LIMITS.items} items. Remove one to add another.` };
      const anchor = op.before === null ? -1 : list.findIndex((k) => k.id === op.before);
      const at = anchor >= 0 ? anchor : list.length;
      const item = { ...op.item, covers: op.item.covers.filter((id) => taskById(plan, id)) };
      return { ok: true, plan: { ...plan, checklist: [...list.slice(0, at), item, ...list.slice(at)] } };
    }
    case 'edit-item': {
      if (!itemById(plan, op.id)) return missingItem(op.name);
      const set = op.set.covers ? { ...op.set, covers: op.set.covers.filter((id) => taskById(plan, id)) } : op.set;
      return { ok: true, plan: { ...plan, checklist: (plan.checklist ?? []).map((k) => (k.id === op.id ? { ...k, ...set } : k)) } };
    }
    case 'cut-item': {
      if (!itemById(plan, op.id)) return missingItem(op.name);
      return { ok: true, plan: { ...plan, checklist: (plan.checklist ?? []).filter((k) => k.id !== op.id) } };
    }
  }
}

/** The ids an operation adds to the plan, so later changes to what it added are dropped with it. */
const addedId = (op: PlanOp): string | null => (op.op === 'add-task' ? op.task.id : op.op === 'add-milestone' ? op.milestone.id : op.op === 'add-item' ? op.item.id : null);
const targetId = (op: PlanOp): string | null => ('id' in op ? op.id : null);
/** The title a change was about, as it was when you made it. */
const nameOf = (op: PlanOp): string | null =>
  op.op === 'goal' ? null : op.op === 'add-task' ? op.task.title : op.op === 'add-milestone' ? op.milestone.title : op.op === 'add-item' ? op.item.text : op.name;

export interface Replayed {
  plan: Plan;
  /** Changes that no longer apply, each with why. */
  dropped: { op: PlanOp; why: string }[];
}

/** Your changes on top of a version: those that no longer apply are dropped, and so is anything you did to what they added. */
export function replay(plan: Plan, ops: readonly PlanOp[]): Replayed {
  let at = plan;
  const dropped: Replayed['dropped'] = [];
  const lost = new Set<string>();
  for (const op of ops) {
    const target = targetId(op);
    const into = op.op === 'add-task' ? op.task.milestone : op.op === 'move-task' ? op.to.milestone : null;
    if ((target !== null && lost.has(target)) || (into !== null && lost.has(into))) {
      const name = nameOf(op);
      dropped.push({ op, why: `${name ? `Your change to ${named(name)}` : 'A change'} went with an addition that no longer applies.` });
      const id = addedId(op);
      if (id !== null) lost.add(id);
      continue;
    }
    const result = applyOp(at, op);
    if (result.ok) {
      at = result.plan;
    } else {
      dropped.push({ op, why: result.why });
      const id = addedId(op);
      if (id !== null) lost.add(id);
    }
  }
  return { plan: at, dropped };
}

// ---------------------------------------------------------------------------------------------------------------
// Making changes: moves for the buttons and for a drop

/** Up or down within its milestone, or to its top or bottom; null when it is already there. */
export function taskMove(plan: Plan, id: string, where: 'up' | 'down' | 'top' | 'bottom'): PlanOp | null {
  const task = taskById(plan, id);
  if (!task) return null;
  const list = tasksIn(plan, task.milestone);
  const i = list.findIndex((t) => t.id === id);
  const target = where === 'up' ? i - 1 : where === 'down' ? i + 1 : where === 'top' ? 0 : list.length - 1;
  if (target === i || target < 0 || target >= list.length) return null;
  // Moving down puts it before the task after the one it passes; at the end, there is none.
  const before = target < i ? (list[target]?.id ?? null) : (list[target + 1]?.id ?? null);
  return { op: 'move-task', id, name: task.title, to: { milestone: task.milestone, before } };
}

/** A drop at a slot, or null when the task would land where it already is. */
export function taskDrop(plan: Plan, id: string, slot: TaskSlot): PlanOp | null {
  const task = taskById(plan, id);
  if (!task || !milestoneById(plan, slot.milestone)) return null;
  if (task.milestone === slot.milestone) {
    const list = tasksIn(plan, slot.milestone);
    const i = list.findIndex((t) => t.id === id);
    const next = list[i + 1]?.id ?? null;
    if (slot.before === id || slot.before === next) return null;
  }
  return { op: 'move-task', id, name: task.title, to: slot };
}

export function milestoneMove(plan: Plan, id: string, where: 'up' | 'down'): PlanOp | null {
  const i = plan.milestones.findIndex((m) => m.id === id);
  const m = plan.milestones[i];
  if (!m) return null;
  if (where === 'up') {
    const previous = plan.milestones[i - 1];
    return previous ? { op: 'move-milestone', id, name: m.title, before: previous.id } : null;
  }
  if (i >= plan.milestones.length - 1) return null;
  return { op: 'move-milestone', id, name: m.title, before: plan.milestones[i + 2]?.id ?? null };
}

const numbered = (prefix: string, ids: Iterable<string>): number => {
  let most = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of ids) {
    const n = Number(pattern.exec(id)?.[1] ?? 0);
    if (n > most) most = n;
  }
  return most + 1;
};

/**
 * A new task's id. Yours are numbered on their own ("p-s3"), so a task you add can't take the id of one the CEO adds in
 * a version that lands meanwhile; ids stay stable across versions once saved.
 */
export const newTaskId = (plans: readonly Plan[]): string => `p-s${numbered('p-s', plans.flatMap((p) => p.tasks.map((t) => t.id)))}`;
export const newMilestoneId = (plans: readonly Plan[]): string => `ms-s${numbered('ms-s', plans.flatMap((p) => p.milestones.map((m) => m.id)))}`;
/** A checklist item you add: "k-s1", numbered on its own as your tasks are, so the CEO's "k-1" never clashes with it. */
export const newItemId = (plans: readonly Plan[]): string => `k-s${numbered('k-s', plans.flatMap((p) => (p.checklist ?? []).map((k) => k.id)))}`;

// ---------------------------------------------------------------------------------------------------------------
// Saying what a change did

/** One sentence for a change you just made, read from the plan after it: "Moved “Cart”: second of four in “Pickup orders work”." */
export function describeOp(before: Plan, after: Plan, op: PlanOp): string {
  switch (op.op) {
    case 'goal':
      return 'Changed the goal.';
    case 'edit-task': {
      const moved = op.set.milestone !== undefined && op.set.milestone !== taskById(before, op.id)?.milestone;
      const to = moved ? milestoneById(after, op.set.milestone ?? '') : undefined;
      return `Changed ${named(taskById(after, op.id)?.title ?? op.name)}${to ? `, now in ${named(to.title)}` : ''}.`;
    }
    case 'edit-milestone':
      return `Changed the milestone ${named(milestoneById(after, op.id)?.title ?? op.name)}.`;
    case 'move-task': {
      const place = taskPlace(after, op.id);
      return `Moved ${named(op.name)}${place ? `: ${place.charAt(0).toLowerCase()}${place.slice(1)}` : '.'}`;
    }
    case 'move-milestone': {
      const i = after.milestones.findIndex((m) => m.id === op.id);
      return `Moved the milestone ${named(op.name)}: ${placeWord(i + 1)} of ${countWord(after.milestones.length)}.`;
    }
    case 'cut-task': {
      const waited = before.tasks.filter((t) => t.after.includes(op.id));
      const freed = waited.length === 0 ? '' : waited.length === 1 ? ` ${capital(named(waited[0]?.title ?? ''))} no longer waits for it.` : ` ${capital(countWord(waited.length))} tasks no longer wait for it.`;
      return `Cut ${named(op.name)}.${freed}`;
    }
    case 'cut-milestone': {
      const n = tasksIn(before, op.id).length;
      return `Cut the milestone ${named(op.name)}${n === 0 ? '' : ` and its ${n === 1 ? 'task' : `${countWord(n)} tasks`}`}.`;
    }
    case 'add-task': {
      const m = milestoneById(after, op.task.milestone);
      return `Added ${named(op.task.title)}${m ? ` to ${named(m.title)}` : ''}.`;
    }
    case 'add-milestone':
      return `Added the milestone ${named(op.milestone.title)}.`;
    case 'add-item':
      return `Added ${named(op.item.text)} to the checklist${op.item.covers.length === 0 ? '; no task covers it yet' : ''}.`;
    case 'edit-item': {
      const item = itemById(after, op.id);
      return `Changed the checklist item ${named(item?.text ?? op.name)}${item && item.covers.length === 0 ? '; no task covers it now' : ''}.`;
    }
    case 'cut-item':
      return `Took ${named(op.name)} off the checklist.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What stops a save: the office's own check (src/core/plan.ts), so the panel says what the office would

/** Files are the project's own: a path that starts at a root or climbs out of the project is refused. */
export const outsideProject = (path: string): boolean => /^([a-zA-Z]:)?[\\/]/.test(path) || /^[a-zA-Z]:/.test(path) || path.split(/[\\/]/).includes('..') || path.startsWith('~');

/** A list of files as typed, one per line: trimmed, empty lines and repeats left out. */
export function filesFrom(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const path = line.trim();
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/** Problems with one task's files, in sentences, as the office's check words them, for a form's own field. */
export function filesProblems(files: readonly string[], whose: string): string[] {
  const out: string[] = [];
  if (files.length > LIMITS.files) out.push(`${whose} names ${files.length} files. Keep it to ${LIMITS.files}; a folder covers what's in it.`);
  const outside = files.find(outsideProject);
  if (outside) out.push(`${whose} names ${clip(outside, 80)}. Files are relative to the project, like src/cart/.`);
  const odd = files.find((f) => /\p{Cc}/u.test(f) || f.includes(':'));
  if (odd && odd !== outside) out.push(`${whose} names ${clip(odd, 80)}, which has a character a project path can't have.`);
  const own = files.find((f) => normalizePlanPath(f).split('/').some((part, i) => part.toLowerCase() === '.git' || (i === 0 && part.toLowerCase() === '.worklings')));
  if (own) out.push(`${whose} names ${clip(own, 80)}: that is git's or Worklings' own folder, which no task owns.`);
  const long = files.find((f) => f.length > LIMITS.path);
  if (long) out.push(`${whose} names a path of ${long.length} characters. Keep paths to ${LIMITS.path}.`);
  return out;
}

/** Two paths touch when they are the same, or one is a folder the other is in; case doesn't count (Windows). */
export const sharePath = (a: string, b: string): boolean => pathsOverlap(normalizePlanPath(a), normalizePlanPath(b));

/**
 * What stops the plan from being saved, each a sentence with the fix: the office's own check (`checkPlan`), run here
 * so the panel says it before sending. The office checks again and may still turn a version down (the plan changed
 * meanwhile, say); that comes back in its words. `earlier` are the versions before, whose ids stay taken.
 */
export function checkDraft(plan: Plan, people: readonly PlanPerson[], earlier: readonly Plan[] = []): string[] {
  const check = checkPlan(plan, people, { earlier });
  return check.ok ? [] : check.errors;
}

// ---------------------------------------------------------------------------------------------------------------
// A draft kept in this tab: read back as data, not trusted

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isPlanTask = (v: unknown): v is PlanTask =>
  isObj(v) && isStr(v.id) && isStr(v.title) && isStr(v.owner) && isStrs(v.files) && isStr(v.milestone) && isStrs(v.after) && isStr(v.brief) && isStr(v.doneWhen);
const isMilestone = (v: unknown): v is PlanMilestone => isObj(v) && isStr(v.id) && isStr(v.title) && isStr(v.doneWhen);
const isSlot = (v: unknown): v is TaskSlot => isObj(v) && isStr(v.milestone) && (v.before === null || isStr(v.before));
const isAnchor = (v: unknown): v is string | null => v === null || isStr(v);
const TASK_SET: Record<keyof TaskFields, (v: unknown) => boolean> = { title: isStr, owner: isStr, files: isStrs, milestone: isStr, after: isStrs, brief: isStr, doneWhen: isStr };
const MILESTONE_SET: Record<keyof MilestoneFields, (v: unknown) => boolean> = { title: isStr, doneWhen: isStr };
const ITEM_SET: Record<keyof ItemFields, (v: unknown) => boolean> = { text: isStr, covers: isStrs };
const isItem = (v: unknown): v is ChecklistItem => isObj(v) && isStr(v.id) && isStr(v.text) && (v.quote === null || isStr(v.quote)) && isStrs(v.covers);
const isSet = (v: unknown, fields: Record<string, (v: unknown) => boolean>): boolean =>
  isObj(v) && Object.entries(v).every(([k, x]) => Object.hasOwn(fields, k) && (fields[k] ?? (() => false))(x));

export function isPlanOp(v: unknown): v is PlanOp {
  if (!isObj(v)) return false;
  switch (v.op) {
    case 'goal':
      return isStr(v.goal);
    case 'edit-task':
      return isStr(v.id) && isStr(v.name) && isSet(v.set, TASK_SET);
    case 'edit-milestone':
      return isStr(v.id) && isStr(v.name) && isSet(v.set, MILESTONE_SET);
    case 'move-task':
      return isStr(v.id) && isStr(v.name) && isSlot(v.to);
    case 'move-milestone':
      return isStr(v.id) && isStr(v.name) && isAnchor(v.before);
    case 'cut-task':
    case 'cut-milestone':
      return isStr(v.id) && isStr(v.name);
    case 'add-task':
      return isPlanTask(v.task) && isAnchor(v.before);
    case 'add-milestone':
      return isMilestone(v.milestone) && isAnchor(v.before);
    case 'add-item':
      return isItem(v.item) && isAnchor(v.before);
    case 'edit-item':
      return isStr(v.id) && isStr(v.name) && isSet(v.set, ITEM_SET);
    case 'cut-item':
      return isStr(v.id) && isStr(v.name);
    default:
      return false;
  }
}

/** A draft read back from storage; anything else is no draft. */
export function draftFrom(v: unknown): Draft {
  if (!isObj(v) || !Array.isArray(v.ops) || !isStr(v.note)) return EMPTY_DRAFT;
  const ops = v.ops.filter(isPlanOp).slice(-MAX_OPS);
  return { ops, note: v.note.slice(0, PLAN_LIMITS.note) };
}
