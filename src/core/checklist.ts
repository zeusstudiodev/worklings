// v0.2, "Simple, visible, proven" (SPEC-v0.2.md, 3): the checklist of what the stakeholder asked for, proposed with the
// plan. Reading it from the CEO's propose_plan or the stakeholder's edit (ids stable across versions, covers named by id
// or title, text cut and masked), the linter's rules on it, carrying it through an edit that doesn't send it, and what
// the office, the brief and the final review read off it with the verdicts. Pure, with no Node APIs. It doesn't import
// plan.ts, which calls it from checkPlan.
import { readAccept } from './acceptance.ts';
import { REPORT_FORM, type Task } from './company.ts';
import { redactClip } from './redact.ts';
import {
  CHECKLIST_LIMITS,
  type ChecklistItem,
  type ChecklistRow,
  type ChecklistState,
  type ChecklistVerdict,
  type ChecklistView,
  type Plan,
  type PlanTask,
  type PlanTaskKind,
  type PlanVersion,
  VERDICTS,
} from './steering.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const stripControls = (text: string): string => text.replace(/(?![\n\t])\p{Cc}/gu, '');
const blockOf = (v: unknown): string => (typeof v === 'string' ? stripControls(v.replace(/\r\n?/g, '\n')).trim() : '');
const lineOf = (v: unknown): string => (typeof v === 'string' ? stripControls(v).replace(/\s+/g, ' ').trim() : '');
const plainKey = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** A checklist item's id, as plan.ts's PLAN_ID takes a plan's ids. */
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** “The menu shows prices”, as a sentence names an item or a task (plan.ts's `quoted`). */
const quoted = (text: string): string => `“${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`;

/** "k-1" for the CEO's items, "k-s1" for the stakeholder's own. */
export const CHECKLIST_PREFIX = { ceo: 'k-', stakeholder: 'k-s' } as const;

/** Hands out ids: the one given, else the one the same text had in the latest version, else the next free number. */
function itemIds(prefix: string, taken: readonly string[], latest: readonly ChecklistItem[], given: readonly string[]): (text: string) => string {
  const used = new Set(given);
  const re = new RegExp(`^${prefix}(\\d{1,9})$`);
  let next = 1;
  for (const id of [...taken, ...given]) {
    const m = re.exec(id);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  const byText = new Map<string, string>();
  for (const k of latest) if (!byText.has(plainKey(k.text))) byText.set(plainKey(k.text), k.id);
  return (text) => {
    const old = byText.get(plainKey(text));
    if (old !== undefined && !used.has(old)) {
      used.add(old);
      return old;
    }
    let id = `${prefix}${next}`;
    while (used.has(id)) id = `${prefix}${++next}`;
    next += 1;
    used.add(id);
    return id;
  };
}

/** What readChecklist needs from checkPlan: the same shape as its contract reader. */
export interface ChecklistReader {
  /** The plans of earlier versions, oldest first: their item ids stay taken, and the latest's keep their text's id. */
  earlier: readonly Plan[];
  /** The plan's task ids, in the order of its raw tasks. */
  ids: readonly string[];
  /** The raw tasks a word names: by id, or by title. */
  taskByWord: (said: string) => number[];
  /** The kind of the i-th raw task: covers that name a verification task are left out, since the final review checks every item. */
  kindOf?: (i: number) => PlanTaskKind | undefined;
  add: (problem: string | null) => void;
  /** Text under its limit as it came, or cut to it (the CEO's plans); a refusal otherwise. */
  fit: (what: string, text: string, max: number) => string;
  /** The stakeholder's own edit: new items get "k-s" ids. */
  stakeholder?: boolean;
}

/**
 * The checklist a plan sends, as the plan keeps it: ids given or made (kept from the latest version by text), text and
 * quote cut and masked, covers as plan task ids without repeats and without the final review. Empty when none is sent;
 * whether one is required is checklistProblems' rule.
 */
export function readChecklist(raw: unknown, r: ChecklistReader): ChecklistItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    r.add("The plan lists its checklist as something other than a list; give each item as an object with its text, the stakeholder's words in quote and the tasks that cover it.");
    return [];
  }
  if (raw.length > CHECKLIST_LIMITS.items) {
    r.add(`The checklist has ${raw.length} items and holds ${CHECKLIST_LIMITS.items}; merge the ones that are checked together.`);
    return [];
  }
  const seen = new Set<string>();
  const given = raw.map((entry, i) => {
    const id = isObj(entry) && typeof entry.id === 'string' && ITEM_ID.test(entry.id.trim()) ? entry.id.trim() : null;
    if (id === null) return null;
    if (seen.has(id)) {
      r.add(`Two checklist items have the id ${id}; give each its own.`);
      return `#repeat-${i}`;
    }
    seen.add(id);
    return id;
  });
  const latest = r.earlier.at(-1)?.checklist ?? [];
  const taken = r.earlier.flatMap((p) => (p.checklist ?? []).map((k) => k.id));
  const idFor = itemIds(r.stakeholder ? CHECKLIST_PREFIX.stakeholder : CHECKLIST_PREFIX.ceo, taken, latest, [...seen]);

  return raw.map((entry, i) => {
    const k = isObj(entry) ? entry : {};
    const said = lineOf(k.text);
    const label = said ? `The checklist item ${quoted(said)}` : `Checklist item ${i + 1}`;
    if (!isObj(entry)) r.add(`Checklist item ${i + 1} isn't an object with its text, the stakeholder's words in quote and the tasks that cover it.`);
    else if (!said) r.add(`Checklist item ${i + 1} has no text; say what the stakeholder asked for as a short sentence that can be checked.`);
    const text = r.fit(`The text of ${label.charAt(0).toLowerCase()}${label.slice(1)}`, said, CHECKLIST_LIMITS.text);

    let quote: string | null = null;
    if (k.quote !== undefined && k.quote !== null && k.quote !== '') {
      if (typeof k.quote !== 'string') r.add(`${label} has a quote that isn't text; give the stakeholder's words as they wrote them, or null.`);
      else {
        const words = r.fit(`The quote of ${label.charAt(0).toLowerCase()}${label.slice(1)}`, blockOf(k.quote), CHECKLIST_LIMITS.quote);
        quote = words ? redactClip(words, CHECKLIST_LIMITS.quote) : null;
      }
    }

    const covers: string[] = [];
    const rawCovers = k.covers === undefined || k.covers === null ? [] : k.covers;
    if (!Array.isArray(rawCovers)) r.add(`${label} lists the tasks that cover it as something other than a list of tasks.`);
    else if (rawCovers.length > CHECKLIST_LIMITS.covers) r.add(`${label} is covered by ${rawCovers.length} tasks; name ${CHECKLIST_LIMITS.covers} at most, or split the item.`);
    else {
      for (const w of rawCovers) {
        const word = typeof w === 'string' ? w.trim() : '';
        const found = word ? r.taskByWord(word) : [];
        if (found.length === 0) r.add(`${label} names "${word.slice(0, 60)}" as a task that covers it, which isn't a task in the plan; name a task by its id.`);
        else if (found.length > 1) r.add(`${label} names "${word.slice(0, 60)}" as a task that covers it, and ${found.length} tasks are called that; name it by id.`);
        else {
          const at = found[0] ?? -1;
          const id = r.ids[at];
          if (id !== undefined && r.kindOf?.(at) !== 'verification' && !covers.includes(id)) covers.push(id);
        }
      }
    }
    const accept = readAccept(k.accept, label, r.add);
    const id = given[i];
    return { id: id && !id.startsWith('#') ? id : idFor(said || `item ${i + 1}`), text: redactClip(text, CHECKLIST_LIMITS.text), quote, covers, ...(accept ? { accept } : {}) };
  });
}

/**
 * The linter's rules on the CEO's checklist (`checklist: true`): there is one, every item has a task that covers it, and
 * every task that builds a part covers an item. Integration and verification tasks (the office's final review among
 * them) build no part of their own, so they cover none. `nameAt(i)` names the i-th task, as checkPlan's sentences do.
 */
export function checklistProblems(items: readonly ChecklistItem[], tasks: readonly PlanTask[], nameAt: (i: number) => string, add: (problem: string | null) => void, harness = false): void {
  if (items.length === 0) {
    add("The plan has no checklist; list each thing the stakeholder asked for as a short checkable sentence, quoting their words, with the tasks that cover it.");
    return;
  }
  const builds = new Set(tasks.filter((t) => t.kind !== 'verification').map((t) => t.id));
  for (const k of items) {
    if (!k.covers.some((id) => builds.has(id))) add(`The checklist item ${quoted(k.text)} (${k.id}) has no task that covers it; name the task that builds it in covers, or add one.`);
  }
  const covered = new Set(items.flatMap((k) => k.covers));
  tasks.forEach((t, i) => {
    // v0.4: a harness plan's tasks are milestones and their acceptance tests, written by the office, not features.
    if (t.kind === undefined && !harness && !covered.has(t.id)) add(`${nameAt(i)} (${t.id}) covers no checklist item; add it to the covers of the item it builds, or remove the task.`);
  });
}

/**
 * A plan sent without `checklist` (the stakeholder's edit, from an editor that may not show it) takes the earlier
 * version's, its covers pruned to the tasks the plan still has. An item left uncovered stays: the plan shows "No task
 * covers this yet" rather than refusing a person's edit over it.
 */
export function carryChecklist(raw: unknown, earlier: Plan): unknown {
  if (!isObj(raw) || Object.hasOwn(raw, 'checklist') || !earlier.checklist?.length) return raw;
  const tasks = raw.tasks;
  const ids = new Set(Array.isArray(tasks) ? tasks.map((t) => (isObj(t) && typeof t.id === 'string' ? t.id.trim() : '')) : []);
  return { ...raw, checklist: earlier.checklist.map((k) => ({ ...k, covers: k.covers.filter((id) => ids.has(id)) })) };
}

const isVerdict = (v: ChecklistVerdict): boolean => (VERDICTS as readonly string[]).includes(v.verdict);

/**
 * Whether a verdict counts on a version's checklist: one given on that version, or on an earlier version whose item of
 * the same id says the same thing (a new version that leaves an item alone keeps its verdict; one that rewrites it
 * starts it unchecked). Earlier versions are looked up in `versions`; without them only the version's own verdicts count.
 */
function countsOn(version: PlanVersion, versions: readonly PlanVersion[]): (v: ChecklistVerdict) => boolean {
  const now = new Map((version.plan.checklist ?? []).map((k) => [k.id, plainKey(k.text)]));
  return (v) => {
    if (v.version === version.version) return true;
    if (v.version > version.version) return false;
    const then = versions.find((x) => x.version === v.version)?.plan.checklist?.find((k) => k.id === v.item);
    return then !== undefined && now.get(v.item) === plainKey(then.text);
  };
}

/**
 * A version's checklist with where it stands: each item's newest verdict on this version, or carried from an earlier one
 * where the item is unchanged (countsOn; an item without one is unchecked, never passed), and its covering tasks with the
 * board task made from each. `planTasks` maps plan task ids to board tasks, as the company's state keeps them; without it
 * the tasks' own `planTask` say. `versions` are the plan's versions, for the verdicts carried. Null without a checklist.
 */
export function checklistView(
  version: PlanVersion | null,
  verdicts: readonly ChecklistVerdict[],
  tasks: readonly Task[],
  planTasks?: Readonly<Record<string, string>>,
  versions: readonly PlanVersion[] = [],
): ChecklistView | null {
  const items = version?.plan.checklist;
  if (!version || !items || items.length === 0) return null;
  const boardOf = (planTask: string): Task | null => {
    if (planTasks && Object.hasOwn(planTasks, planTask)) return tasks.find((t) => t.id === planTasks[planTask]) ?? null;
    return tasks.findLast((t) => t.planTask === planTask) ?? null;
  };
  const counted = countsOn(version, versions);
  const newest = new Map<string, ChecklistVerdict>();
  for (const v of verdicts) {
    if (!counted(v) || !isVerdict(v)) continue;
    const before = newest.get(v.item);
    if (!before || v.at >= before.at) newest.set(v.item, v);
  }
  const counts: Record<ChecklistState, number> = { met: 0, partly: 0, 'not-met': 0, unchecked: 0 };
  let reviewedAt: number | null = null;
  const rows: ChecklistRow[] = items.map((k) => {
    const verdict = newest.get(k.id) ?? null;
    const state: ChecklistState = verdict?.verdict ?? 'unchecked';
    counts[state] += 1;
    if (verdict && (reviewedAt === null || verdict.at > reviewedAt)) reviewedAt = verdict.at;
    const covering = k.covers.flatMap((id) => {
      const planned = version.plan.tasks.find((t) => t.id === id);
      if (!planned) return [];
      const board = boardOf(id);
      return [{ planTask: id, task: board?.id ?? null, title: planned.title, status: board?.status ?? ('planned' as const) }];
    });
    return { ...k, covers: [...k.covers], state, verdict, tasks: covering };
  });
  return { version: version.version, rows, counts, reviewedAt };
}

/** How a state reads in a sentence. */
export const CHECKLIST_STATE_WORDS: Readonly<Record<ChecklistState, string>> = { met: 'met', partly: 'partly met', 'not-met': 'not met', unchecked: 'not checked' };

const sentence = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/**
 * The checklist as plain lines, one per item, for the company brief and the CEO's notice: "k-2: The menu shows prices.
 * Their words: “…”. Covered by “Menu page”. Marked partly met."
 */
export function checklistLines(view: ChecklistView): string[] {
  return view.rows.map((r) => {
    const words = r.quote ? ` Their words: “${r.quote.replace(/\s+/g, ' ')}”.` : '';
    const covered = r.tasks.length > 0 ? ` Covered by ${andList(r.tasks.map((t) => quoted(t.title)))}.` : ' No task covers it yet.';
    const state = r.state === 'unchecked' ? '' : ` Marked ${CHECKLIST_STATE_WORDS[r.state]}.`;
    return `${r.id}: ${sentence(r.text)}${words}${covered}${state}`;
  });
}

/** "The checklist: 6 met, 1 partly met, 0 not met." with ", 2 not checked" when any are. */
export function checklistCountsLine(view: Pick<ChecklistView, 'counts'>): string {
  const c = view.counts;
  return `The checklist: ${c.met} met, ${c.partly} partly met, ${c['not-met']} not met${c.unchecked > 0 ? `, ${c.unchecked} not checked` : ''}.`;
}

const mentions = (text: string, id: string): boolean => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\w-])`).test(text);

/**
 * The open lines the office adds to a final review's report from its own verdicts, so they drive the fix and re-check
 * path: one per item this review task marked not met or partly met whose covering tasks no open line names already, as
 * "<first covering plan task id> <item text>: <evidence note>". An item no task covers starts with its own id instead,
 * which no fix task can take, so the report goes to a person.
 */
/** What names a checklist row in a report's line: its covering plan tasks and the board tasks made from them. */
const namesOf = (r: ChecklistRow): string[] => r.tasks.flatMap((t) => (t.task ? [t.planTask, t.task] : [t.planTask]));

const failed = (v: ChecklistVerdict | null): v is ChecklistVerdict => v !== null && (v.verdict === 'not-met' || v.verdict === 'partly');

export function verdictOpenLines(view: ChecklistView, reviewTaskId: string, open: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of view.rows) {
    const v = r.verdict;
    if (!failed(v) || v.task !== reviewTaskId) continue;
    const names = namesOf(r);
    if (open.some((l) => names.some((n) => mentions(l, n)))) continue;
    const first = r.tasks.find((t) => /^p-\d+$/.test(t.planTask))?.planTask ?? r.tasks[0]?.planTask ?? r.id;
    const note = v.evidence.note.replace(/\s+/g, ' ').trim();
    out.push(redactClip(`${first} ${r.text.replace(/[.!?]$/, '')}${note ? `: ${note}` : ''}`, REPORT_FORM.openItem));
  }
  return out;
}

/**
 * The checklist items a re-check looks at again (one of its lines names the item's covering tasks, or the item's own id)
 * whose newest verdict is still an earlier review's not met or partly met. A re-check that reports clean while any is
 * left would leave "not met" on a finished company, so the office asks it to mark them first.
 */
export function unmarkedRecheckItems(view: ChecklistView, recheckTaskId: string, lines: readonly string[]): string[] {
  return view.rows
    .filter((r) => failed(r.verdict) && r.verdict.task !== recheckTaskId && lines.some((l) => [r.id, ...namesOf(r)].some((n) => mentions(l, n))))
    .map((r) => r.id);
}
