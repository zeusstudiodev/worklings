// What changed between two versions of the CEO's plan (SPEC-v3.md "Steering", 1): the goal, milestones and tasks added,
// removed and changed, and milestones and tasks whose place in the order changed. Ids are stable across versions, so a
// task with the same id is the same task however much it changed. Pure, with no Node APIs: the web app and the core
// streams use it.
import type { ChecklistItem, Plan, PlanDiff, PlanMilestone, PlanTask } from './steering.ts';

/** A task's fields in the order a task has them, which is the order a change lists them in. */
const TASK_FIELDS = ['title', 'owner', 'files', 'milestone', 'after', 'brief', 'doneWhen', 'check', 'kind'] as const satisfies readonly (keyof PlanTask)[];

/** Files and the tasks one waits for are sets: the same members in another order are no change. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
};

const sameField = (a: PlanTask, b: PlanTask, field: (typeof TASK_FIELDS)[number]): boolean => {
  if (field === 'files' || field === 'after') return sameSet(a[field], b[field]);
  return a[field] === b[field];
};

/** By id, the first of each: a plan with a repeated id (which the plan check refuses) is read by its first copy. */
function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const x of list) if (!map.has(x.id)) map.set(x.id, x);
  return map;
}

const firsts = <T extends { id: string }>(list: readonly T[]): T[] => [...byId(list).values()];

/**
 * The ids of `after` (in its order) whose place relative to the others changed: every id both orders hold, less the
 * longest run that kept its order. Moving one task to the top marks that task, not the ones it passed. Where two runs
 * are as long (a swap), the one that keeps the earlier tasks of `before` stays, so the task that moved up is marked.
 */
export function movedInOrder(before: readonly string[], after: readonly string[]): string[] {
  const at = new Map<string, number>();
  after.forEach((id, i) => {
    if (!at.has(id)) at.set(id, i);
  });
  const common: { id: string; at: number }[] = [];
  const seen = new Set<string>();
  for (const id of before) {
    const place = at.get(id);
    if (seen.has(id) || place === undefined) continue;
    seen.add(id);
    common.push({ id, at: place });
  }
  // From the end: the longest run of rising places that starts at each entry. `tails[k]` holds the highest place a run
  // of k + 1 can start from among the entries after this one, so it falls as k grows.
  const startLength = common.map(() => 1);
  const tails: number[] = [];
  for (let i = common.length - 1; i >= 0; i -= 1) {
    const place = common[i]?.at ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tails[mid] ?? -1) > place) lo = mid + 1;
      else hi = mid;
    }
    startLength[i] = lo + 1;
    tails[lo] = place;
  }
  // The earliest such run, taken from the front.
  const kept = new Set<string>();
  let need = tails.length;
  let last = -1;
  common.forEach((entry, i) => {
    if (need > 0 && (startLength[i] ?? 0) >= need && entry.at > last) {
      kept.add(entry.id);
      last = entry.at;
      need -= 1;
    }
  });
  return [...at].filter(([id]) => seen.has(id) && !kept.has(id)).map(([id]) => id);
}

/** An item's text, quote and covers: covers are a set, like a task's files. */
const sameItem = (a: ChecklistItem, b: ChecklistItem): boolean => a.text === b.text && a.quote === b.quote && sameSet(a.covers, b.covers);

/** The checklist's changes, by item id; absent when neither version has one (plans saved before it). */
function checklistDiff(before: readonly ChecklistItem[] | undefined, after: readonly ChecklistItem[] | undefined): PlanDiff['checklist'] {
  if (before === undefined && after === undefined) return undefined;
  const was = byId(before ?? []);
  const now = byId(after ?? []);
  const changed: { before: ChecklistItem; after: ChecklistItem }[] = [];
  for (const k of now.values()) {
    const old = was.get(k.id);
    if (old && !sameItem(old, k)) changed.push({ before: old, after: k });
  }
  return { added: [...now.values()].filter((k) => !was.has(k.id)), removed: [...was.values()].filter((k) => !now.has(k.id)), changed };
}

export function planDiff(before: Plan, after: Plan): PlanDiff {
  const msBefore = byId(before.milestones);
  const msAfter = byId(after.milestones);
  const tasksBefore = byId(before.tasks);
  const tasksAfter = byId(after.tasks);

  const milestonesChanged: { before: PlanMilestone; after: PlanMilestone }[] = [];
  for (const m of msAfter.values()) {
    const was = msBefore.get(m.id);
    if (was && (was.title !== m.title || was.doneWhen !== m.doneWhen)) milestonesChanged.push({ before: was, after: m });
  }

  const tasksChanged: PlanDiff['tasks']['changed'] = [];
  for (const t of tasksAfter.values()) {
    const was = tasksBefore.get(t.id);
    if (!was) continue;
    const fields = TASK_FIELDS.filter((f) => !sameField(was, t, f));
    if (fields.length > 0) tasksChanged.push({ before: was, after: t, fields });
  }

  const checklist = checklistDiff(before.checklist, after.checklist);
  return {
    goal: before.goal === after.goal ? null : { before: before.goal, after: after.goal },
    milestones: {
      added: firsts(after.milestones).filter((m) => !msBefore.has(m.id)),
      removed: firsts(before.milestones).filter((m) => !msAfter.has(m.id)),
      changed: milestonesChanged,
      moved: movedInOrder(
        before.milestones.map((m) => m.id),
        after.milestones.map((m) => m.id),
      ),
    },
    tasks: {
      added: firsts(after.tasks).filter((t) => !tasksBefore.has(t.id)),
      removed: firsts(before.tasks).filter((t) => !tasksAfter.has(t.id)),
      changed: tasksChanged,
      moved: movedInOrder(
        before.tasks.map((t) => t.id),
        after.tasks.map((t) => t.id),
      ),
    },
    ...(checklist ? { checklist } : {}),
  };
}
