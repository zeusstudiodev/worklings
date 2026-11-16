// The CEO's plan (SPEC-v3.md "Steering", 1): the check every version passes, from the CEO's propose_plan or the
// stakeholder's edit, and what the rest of steering reads off a plan (which milestones an approval covers, what each
// task waits for, whether a plan waits in the inbox). Ids stay stable across versions, so a version is a diff of the
// one before and a task made from a plan task keeps it as `Task.planTask`. Pure, with no Node APIs: the demo uses it.
import { checklistProblems, readChecklist } from './checklist.ts';
import { LIMITS } from './company.ts';
import { cutSentence, cutText } from './cut.ts';
import { countWord, plainText } from './now.ts';
import { planDiff } from './planDiff.ts';
import { redactClip } from './redact.ts';
import {
  PLAN_LIMITS,
  PLAN_TASK_KINDS,
  type ChecklistItem,
  type Plan,
  type PlanApprovalState,
  type PlanContract,
  type PlanMilestone,
  type PlanTask,
  type PlanTaskKind,
  type PlanVersion,
  type PlanView,
  type SteeringSettings,
} from './steering.ts';
import { commandProblem, lintProblems } from './plan-lint.ts';
import type { PresetId } from './presets.ts';
import { REVIEWER_ID } from './harness-shape.ts';
import type { Size } from './size.ts';
import { inSentence } from './studio.ts';
import { tooLong as tooLongSentence } from './too-long.ts';
import { capital } from './words.ts';

/**
 * A version is one line of the company's log, which holds 256 KB, and its tasks go on the board in one more; this keeps
 * both well inside, multi-byte text included. Eighty tasks with briefs of a few paragraphs fit easily.
 */
export const PLAN_BYTES = 96 * 1024;

/** Problems a refused plan lists at most: the first ones show what to fix. */
const MAX_ERRORS = 20;

/** A plan's own ids: "p-7", "ms-2", or the stakeholder's "p-s1" and "ms-launch"; as the propose_plan tool takes them. */
export const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface PlanPerson {
  id: string;
  name: string;
  title: string;
  /** The person's level, when the caller has it (the company does): the CEO and checkers don't need a check on their tasks. */
  level?: string;
}

export interface CheckPlanOptions {
  /**
   * The plans of earlier versions, oldest first. Their ids stay taken, so a new id never reuses one, and a task or
   * milestone sent without an id keeps the id its title had in the latest of them.
   */
  earlier?: readonly Plan[];
  /** People who were let go, so a task given to one of them says so. */
  fired?: readonly PlanPerson[];
  /**
   * Whether the rules about how a big plan is organised apply (contracts, integration tasks, the independent check at
   * the end). They guide the CEO, so only the CEO's propose_plan asks for them; the stakeholder's own edit, its undo
   * and the browser's copy of the check leave them off, so a person can shape their plan as they like. The rules that
   * keep a plan runnable (no clashing files, contracts that make sense) always apply.
   */
  structure?: boolean;
  /**
   * v0.2: the company's size, for the CEO's plans (`structure`): how many tasks the plan may hold, whether it ends with a
   * verification task (medium and large) or the CEO's own check (small), and whether contracts and integration tasks are
   * asked for (large). Left out, the plan is held to the v0.2 rules that don't depend on it.
   */
  size?: Size;
  /** v0.2: the stakeholder's preset, which says how many tasks a maker holds (Lean 2, Balanced 3, Thorough 4); Balanced when left out. */
  preset?: PresetId;
  /**
   * v0.2: the plan must carry a checklist of what the stakeholder asked for, every item covered by a task and every task
   * that builds a part covering one (src/core/checklist.ts). Only the CEO's propose_plan asks for it. A checklist that is
   * sent is read and kept either way.
   */
  checklist?: boolean;
  /**
   * v0.4 (SPEC-v0.4.md, H5): a harness company's plan, which harnessPlan wrote from the Lead's milestones: it always ends
   * with the final review, given to the Reviewer seat, at any size, and the linter takes its tasks as the loop's.
   */
  harness?: boolean;
}

/**
 * A plan that passes, with `notes`: what the office changed instead of refusing it (v0.2), one sentence each. Only the
 * CEO's plans (`structure`) are adjusted: text over its limit is cut, the final verification task is the office's, and a
 * brief that reads another task's file makes the two wait. A person's own edit is held to what it says.
 */
export type PlanCheck = { ok: true; plan: Plan; notes?: string[] } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const stripControls = (text: string): string => text.replace(/(?![\n\t])\p{Cc}/gu, '');
/** Text as the company keeps it: no control characters, Windows line ends made plain, trimmed. Masked afterwards. */
const blockOf = (v: unknown): string => (typeof v === 'string' ? stripControls(v.replace(/\r\n?/g, '\n')).trim() : '');
const lineOf = (v: unknown): string => (typeof v === 'string' ? stripControls(v).replace(/\s+/g, ' ').trim() : '');
const plainKey = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** “Menu data”, as a sentence names it. */
export const quoted = (title: string): string => `“${title.length > 60 ? `${title.slice(0, 59)}…` : title}”`;

/** "the QA engineer" or "Lena", inside a sentence. */
const nameIn = (p: PlanPerson): string => (p.name === p.title ? `the ${inSentence(p.title)}` : p.name);

const shownPath = (raw: string): string => `"${raw.length > 80 ? `${raw.slice(0, 79)}…` : raw}"`;

/** The folders no task owns: the company's own state and git's (src/company/files.ts keeps the same). */
const RESERVED = new Set(['.worklings', '.git']);

/** "./src//app\\" -> "src/app", as src/company/files.ts writes a task's paths. */
export function normalizePlanPath(raw: string): string {
  return raw
    .trim()
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

/** Whether two paths touch: the same file, or one is a folder the other is inside. Without case, as on Windows. */
export function pathsOverlap(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || y.startsWith(`${x}/`) || x.startsWith(`${y}/`);
}

/** Whether `inner` is `outer` or inside it. */
export function pathInside(inner: string, outer: string): boolean {
  const x = inner.toLowerCase();
  const y = outer.toLowerCase();
  return x === y || x.startsWith(`${y}/`);
}

function filesOf(raw: unknown, whose: string, problems: string[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${whose} lists its files as something other than a list; give them as paths relative to the project, like ["src/cart/"].`);
    return [];
  }
  if (raw.length > LIMITS.files) {
    problems.push(`${whose} names ${raw.length} files; keep it to ${LIMITS.files}, since a folder covers what's in it.`);
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      problems.push(`${whose} names a file that isn't text; files are paths relative to the project.`);
      continue;
    }
    const path = normalizePlanPath(entry);
    const parts = path.split('/');
    if (entry.length > LIMITS.path) problems.push(`${whose} names a path of ${entry.length} characters; keep paths to ${LIMITS.path}.`);
    else if (/^(?:[\\/~]|[a-zA-Z]:)/.test(entry.trim())) problems.push(`${whose} names ${shownPath(entry)}, an absolute path; name files relative to the project, like src/app.ts.`);
    else if (path === '') problems.push(`${whose} names an empty path; name the files or folders it changes, or none.`);
    else if (/\p{Cc}/u.test(entry) || entry.includes(':')) problems.push(`${whose} names ${shownPath(entry)}, which has a character a project path can't have.`);
    else if (parts.includes('..')) problems.push(`${whose} names ${shownPath(entry)}, which leaves the project; name files inside it.`);
    else if (RESERVED.has((parts[0] ?? '').toLowerCase()) || parts.some((p) => p.toLowerCase() === '.git')) {
      problems.push(`${whose} names ${shownPath(entry)}, git's or Worklings' own folder, which no task owns.`);
    } else if (!seen.has(path.toLowerCase())) {
      seen.add(path.toLowerCase());
      out.push(path);
    }
  }
  return out;
}

function tooLong(what: string, text: string, max: number): string | null {
  return text.length > max ? tooLongSentence(what, text.length, max) : null;
}

/** The highest number in ids like `prefix`<n> across these ids, so a new one goes after them all. */
function highest(prefix: string, ids: Iterable<string>): number {
  let n = 0;
  const re = new RegExp(`^${prefix}(\\d{1,9})$`);
  for (const id of ids) {
    const m = re.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n;
}

/** Hands out ids: the one given, else the one the same title had in the latest version, else the next "p-n". */
class Ids {
  private readonly used = new Set<string>();
  private next: number;
  private readonly prefix: string;
  private readonly byTitle: Map<string, string>;

  constructor(prefix: string, taken: Iterable<string>, latest: readonly { id: string; title: string }[], given: readonly string[]) {
    this.prefix = prefix;
    this.next = highest(prefix, [...taken, ...given]) + 1;
    for (const id of given) this.used.add(id);
    this.byTitle = new Map();
    for (const x of latest) if (!this.byTitle.has(plainKey(x.title))) this.byTitle.set(plainKey(x.title), x.id);
  }

  idFor(title: string): string {
    const old = this.byTitle.get(plainKey(title));
    if (old !== undefined && !this.used.has(old)) {
      this.used.add(old);
      return old;
    }
    let id = `${this.prefix}${this.next}`;
    while (this.used.has(id)) id = `${this.prefix}${++this.next}`;
    this.next += 1;
    this.used.add(id);
    return id;
  }
}

/** The ids given in a list of raw entries, the first of each only, and which entries repeat one. */
function givenIds(raw: readonly unknown[]): { ids: (string | null)[]; repeats: Set<number> } {
  const seen = new Set<string>();
  const repeats = new Set<number>();
  const ids = raw.map((entry, i) => {
    const id = isObj(entry) && typeof entry.id === 'string' && PLAN_ID.test(entry.id.trim()) ? entry.id.trim() : null;
    if (id === null) return null;
    if (seen.has(id)) {
      repeats.add(i);
      return null;
    }
    seen.add(id);
    return id;
  });
  return { ids, repeats };
}

/** The person a task names: by id, or by a first name or title only one person has. */
function findOwner(raw: unknown, people: readonly PlanPerson[], fired: readonly PlanPerson[]): { person: PlanPerson } | { fired: PlanPerson } | { many: PlanPerson[] } | { none: string } {
  const said = typeof raw === 'string' ? raw.trim() : '';
  if (!said) return { none: '' };
  const byId = people.find((p) => p.id === said);
  if (byId) return { person: byId };
  const firedById = fired.find((p) => p.id === said);
  if (firedById) return { fired: firedById };
  const key = said.toLowerCase();
  const named = people.filter((p) => p.name.toLowerCase() === key || p.title.toLowerCase() === key);
  if (named.length === 1 && named[0]) return { person: named[0] };
  if (named.length > 1) return { many: named };
  const firedNamed = fired.find((p) => p.name.toLowerCase() === key || p.title.toLowerCase() === key);
  if (firedNamed) return { fired: firedNamed };
  return { none: said };
}

/** Tasks a plan task waits for, directly or through others. Assumes no loop (checkPlan refuses those first). */
export function waitClosure(plan: Pick<Plan, 'tasks'>): Map<string, Set<string>> {
  const direct = new Map(plan.tasks.map((t) => [t.id, t.after]));
  const memo = new Map<string, Set<string>>();
  const visit = (id: string, path: Set<string>): Set<string> => {
    const known = memo.get(id);
    if (known) return known;
    const out = new Set<string>();
    path.add(id);
    for (const next of direct.get(id) ?? []) {
      if (path.has(next)) continue;
      out.add(next);
      for (const further of visit(next, path)) out.add(further);
    }
    path.delete(id);
    memo.set(id, out);
    return out;
  };
  for (const t of plan.tasks) visit(t.id, new Set());
  return memo;
}

/** A loop among the tasks' waits, as task ids in order, or null. */
function waitLoop(tasks: readonly PlanTask[]): string[] | null {
  const after = new Map(tasks.map((t) => [t.id, t.after]));
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'open') return path.slice(path.indexOf(id));
    state.set(id, 'open');
    path.push(id);
    for (const next of after.get(id) ?? []) {
      if (!after.has(next)) continue;
      const loop = visit(next);
      if (loop) return loop;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };
  for (const t of tasks) {
    const loop = visit(t.id);
    if (loop) return loop;
  }
  return null;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Checks a plan from outside (the CEO's propose_plan, the stakeholder's edit) and gives it back clean: text without
 * control characters and with secrets masked, ids for everything (kept from the latest version where a title matches),
 * owners, milestones and waits named by id, files as project paths. Or the problems, each a sentence that names the
 * task, milestone or person and says what to do.
 */
export function checkPlan(raw: unknown, people: readonly PlanPerson[], o: CheckPlanOptions = {}): PlanCheck {
  const errors: string[] = [];
  const add = (problem: string | null) => {
    if (problem && !errors.includes(problem)) errors.push(problem);
  };
  if (!isObj(raw)) return { ok: false, errors: ['A plan is an object with a goal, its milestones and its tasks.'] };
  const earlier = o.earlier ?? [];
  const fired = o.fired ?? [];
  const latest = earlier.at(-1);

  // The CEO's plans (`structure`) have free text over its limit cut and accepted, as the notes say; a person's edit is refused for it.
  const notes: string[] = [];
  const fit = (what: string, text: string, max: number): string => {
    const cut = o.structure === true ? cutText(text, max) : null;
    if (cut === null) {
      add(tooLong(what, text, max));
      return text;
    }
    notes.push(`${what} was ${cutSentence(text.length, cut)}.`);
    return cut.text;
  };

  const goal = fit('The goal', blockOf(raw.goal), PLAN_LIMITS.goal);
  if (!goal) add('The plan has no goal; say what the company is building.');

  const rawMilestones = Array.isArray(raw.milestones) ? raw.milestones : null;
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : null;
  if (!rawMilestones) add('The plan has no list of milestones; give it at least one, each with a title and when it is done.');
  else if (rawMilestones.length === 0) add('The plan has no milestones; give it at least one, each with a title and when it is done.');
  else if (rawMilestones.length > PLAN_LIMITS.milestones) add(`The plan has ${rawMilestones.length} milestones and holds ${PLAN_LIMITS.milestones}; merge some.`);
  if (!rawTasks) add('The plan has no list of tasks; give each milestone the tasks that finish it.');
  else if (rawTasks.length === 0) add('The plan has no tasks; give each milestone the tasks that finish it.');
  else if (rawTasks.length > PLAN_LIMITS.tasks) add(`The plan has ${rawTasks.length} tasks and holds ${PLAN_LIMITS.tasks}; merge or cut some.`);
  if (!rawMilestones || !rawTasks || rawMilestones.length > PLAN_LIMITS.milestones || rawTasks.length > PLAN_LIMITS.tasks) {
    return { ok: false, errors: errors.slice(0, MAX_ERRORS) };
  }

  // Milestones: their ids first, so tasks can name them.
  const msGiven = givenIds(rawMilestones);
  const msIds = new Ids('ms-', earlier.flatMap((p) => p.milestones.map((m) => m.id)), latest?.milestones ?? [], msGiven.ids.filter((id): id is string => id !== null));
  const milestones: PlanMilestone[] = rawMilestones.map((entry, i) => {
    const m = isObj(entry) ? entry : {};
    const title = lineOf(m.title);
    const name = title ? `The milestone ${quoted(title)}` : `Milestone ${i + 1}`;
    if (!isObj(entry)) add(`Milestone ${i + 1} isn't an object with a title and when it is done.`);
    else if (!title) add(`Milestone ${i + 1} has no title; give it one.`);
    if (msGiven.repeats.has(i)) add(`Two milestones have the id ${String(m.id).trim()}; give each its own.`);
    const shortTitle = fit(`The title of ${name.charAt(0).toLowerCase()}${name.slice(1)}`, title, PLAN_LIMITS.title);
    const doneWhen = blockOf(m.doneWhen);
    if (!doneWhen && isObj(entry)) add(`${name} doesn't say when it is done; say when.`);
    const shortDone = fit(`What marks ${title ? quoted(title) : `milestone ${i + 1}`} done`, doneWhen, PLAN_LIMITS.doneWhen);
    const id = msGiven.ids[i] ?? msIds.idFor(title || `milestone ${i + 1}`);
    return { id, title: redactClip(shortTitle, PLAN_LIMITS.title), doneWhen: redactClip(shortDone, PLAN_LIMITS.doneWhen) };
  });
  const milestoneFor = (raw: unknown): PlanMilestone | undefined => {
    const said = typeof raw === 'string' ? raw.trim() : '';
    if (!said) return undefined;
    return milestones.find((m) => m.id === said) ?? milestones.find((m) => plainKey(m.title) === plainKey(said));
  };

  // Tasks: ids, then everything that names another task.
  const taskGiven = givenIds(rawTasks);
  const taskIds = new Ids('p-', earlier.flatMap((p) => p.tasks.map((t) => t.id)), latest?.tasks ?? [], taskGiven.ids.filter((id): id is string => id !== null));
  const titles = rawTasks.map((entry) => (isObj(entry) ? lineOf(entry.title) : ''));
  const ids = rawTasks.map((_, i) => taskGiven.ids[i] ?? taskIds.idFor(titles[i] || `task ${i + 1}`));
  const nameOf = (i: number): string => (titles[i] ? quoted(titles[i] ?? '') : `Task ${i + 1}`);
  const taskByWord = (said: string): number[] => {
    const byId = ids.indexOf(said);
    if (byId >= 0) return [byId];
    const key = plainKey(said);
    return titles.flatMap((t, i) => (plainKey(t) === key ? [i] : []));
  };

  const read: PlanTask[] = rawTasks.map((entry, i) => {
    const t = isObj(entry) ? entry : {};
    const name = nameOf(i);
    const title = titles[i] ?? '';
    if (!isObj(entry)) add(`Task ${i + 1} isn't an object with a title, an owner and what it changes.`);
    else if (!title) add(`Task ${i + 1} has no title; give it one.`);
    if (taskGiven.repeats.has(i)) add(`Two tasks have the id ${String(t.id).trim()}; give each its own.`);
    const shortTitle = fit(`The title of ${title ? quoted(title) : `task ${i + 1}`}`, title, PLAN_LIMITS.title);

    const owner = findOwner(t.owner, people, fired);
    let ownerId = '';
    if ('person' in owner) ownerId = owner.person.id;
    else if ('fired' in owner) add(`${name} is for ${nameIn(owner.fired)}, who was let go; give it to someone in the company.`);
    else if ('many' in owner) add(`${name} is for "${String(t.owner).trim()}", and ${owner.many.length} people go by that; name one of them by id (${owner.many.map((p) => p.id).join(', ')}).`);
    else if (isObj(entry)) add(owner.none ? `${name} is for "${owner.none.slice(0, 60)}", who isn't in the company; give it to someone who is.` : `${name} has no owner; say who does it.`);

    const milestone = milestoneFor(t.milestone);
    if (!milestone && isObj(entry)) {
      add(typeof t.milestone === 'string' && t.milestone.trim() ? `${name} is in the milestone "${t.milestone.trim().slice(0, 60)}", which the plan doesn't have; put it in one it does.` : `${name} isn't in a milestone; put it in one.`);
    }

    const brief = fit(`The brief of ${title ? quoted(title) : `task ${i + 1}`}`, blockOf(t.brief), PLAN_LIMITS.brief);
    const doneWhen = blockOf(t.doneWhen);
    if (!doneWhen && isObj(entry)) add(`${name} doesn't say when it is done; say when, so its owner knows when to stop.`);
    const shortDone = fit(`What marks ${title ? quoted(title) : `task ${i + 1}`} done`, doneWhen, PLAN_LIMITS.doneWhen);

    let kind: PlanTaskKind | undefined;
    const rawKind = typeof t.kind === 'string' ? t.kind.trim() : t.kind;
    if (rawKind !== undefined && rawKind !== null && rawKind !== '') {
      if (typeof rawKind === 'string' && (PLAN_TASK_KINDS as readonly string[]).includes(rawKind)) kind = rawKind as PlanTaskKind;
      else add(`${name} has the kind ${shownPath(String(rawKind))}; a task's kind is "integration" or "verification", or left out for a task that builds a part.`);
    }

    const problems: string[] = [];
    const files = filesOf(t.files, name, problems);
    for (const p of problems) add(p);

    let check: string | undefined;
    if (t.check !== undefined && t.check !== null && t.check !== '') {
      const said = typeof t.check === 'string' ? t.check.trim() : '';
      const problem = typeof t.check !== 'string' ? 'is not text' : commandProblem(said);
      // Kept as said even when refused, so the linter doesn't also call the task checkless: a plan with errors isn't returned.
      if (problem) add(`The check of ${name} ${problem}; give one command the office can run, like "npm test".`);
      check = problem ? said : redactClip(said, PLAN_LIMITS.check);
    }

    const after: string[] = [];
    const rawAfter = t.after === undefined || t.after === null ? [] : t.after;
    if (!Array.isArray(rawAfter)) add(`${name} lists what it waits for as something other than a list of tasks.`);
    else {
      if (rawAfter.length > PLAN_LIMITS.after) add(`${name} waits for ${rawAfter.length} tasks; it can wait for ${PLAN_LIMITS.after} at most.`);
      for (const w of rawAfter.slice(0, PLAN_LIMITS.after)) {
        const said = typeof w === 'string' ? w.trim() : '';
        const found = said ? taskByWord(said) : [];
        if (found.length === 0) add(`${name} waits for "${said.slice(0, 60)}", which isn't a task in the plan; take it out of what it waits for.`);
        else if (found.length > 1) add(`${name} waits for "${said.slice(0, 60)}", and ${found.length} tasks are called that; name it by id.`);
        else {
          const other = found[0] ?? -1;
          const id = ids[other] ?? '';
          if (other === i) add(`${name} waits for itself; take it out of what it waits for.`);
          else if (!after.includes(id)) after.push(id);
        }
      }
    }
    return {
      id: ids[i] ?? `p-${i + 1}`,
      title: redactClip(shortTitle, PLAN_LIMITS.title),
      owner: ownerId,
      files,
      milestone: milestone?.id ?? '',
      after,
      brief: redactClip(brief, PLAN_LIMITS.brief),
      doneWhen: redactClip(shortDone, PLAN_LIMITS.doneWhen),
      ...(check ? { check } : {}),
      ...(kind ? { kind } : {}),
    };
  });

  // v0.2: the checklist, read against the tasks as sent (covers that name a verification task are left out, since the
  // final review checks every item). A plan from anyone but the CEO gives its new items the stakeholder's ids.
  const checklist: ChecklistItem[] = readChecklist(raw.checklist, { earlier, ids, taskByWord, kindOf: (i) => read[i]?.kind, add, fit, stakeholder: o.structure !== true });

  // v0.2: the final verification of a medium or large CEO plan is the office's, so one the CEO wrote is replaced, and a
  // small plan's is dropped (its CEO checks the result at the end). Names and "was it an object" follow the tasks that stay.
  let tasks = read;
  let nameAt = nameOf;
  let parsedAt = (i: number): boolean => isObj(rawTasks[i]);
  if (o.structure === true && o.size !== undefined) {
    const kept = read.flatMap((t, at) => (t.kind === 'verification' ? [] : [{ t, at }]));
    const written = read.filter((t) => t.kind === 'verification');
    const gone = new Set(written.map((t) => t.id));
    tasks = kept.map(({ t }) => (gone.size > 0 ? { ...t, after: t.after.filter((id) => !gone.has(id)) } : t));
    const rawAt = kept.map((k) => k.at);
    const last = milestones.at(-1);
    if (o.size === 'small' && o.harness !== true) {
      for (const v of written) notes.push(`${quoted(v.title)} (${v.id}) was dropped: a small plan has no verification task, since you check the result against stakeholder_words yourself at the end.`);
    } else if (last && tasks.length > 0) {
      const mine = finalReview(tasks, last.id, people, written[0]?.id ?? taskIds.idFor(FINAL_REVIEW.title), o.harness === true);
      if (written.length > 0) notes.push(`The final review is added by the office, so ${written.map((v) => `${quoted(v.title)} (${v.id})`).join(' and ')} ${written.length === 1 ? 'was' : 'were'} replaced by "${FINAL_REVIEW.title}" (${mine.id}).`);
      tasks = [...tasks, mine];
      rawAt.push(-1);
    }
    nameAt = (i) => ((rawAt[i] ?? -1) >= 0 ? nameOf(rawAt[i] ?? i) : quoted(FINAL_REVIEW.title));
    parsedAt = (i) => (rawAt[i] ?? -1) < 0 || isObj(rawTasks[rawAt[i] ?? i]);
  }

  // The plan linter needs only the tasks as read, so its sentences come back with whatever else is wrong, and with the
  // structure rules below when nothing else is: one answer to put right, not a round for each kind of problem.
  const beforeLint = errors.length;
  if (o.structure === true) lintProblems(tasks, people, { size: o.size, preset: o.preset, harness: o.harness === true }, nameAt, parsedAt, add);

  // The checklist's own rules come back with the linter's, in the same answer.
  if (o.checklist === true) checklistProblems(checklist, tasks, nameAt, add, o.harness === true);
  const lintCount = errors.length - beforeLint;

  const contracts = readContracts(raw.contracts, { earlier, latest, ids, nameOf, taskByWord, add, fit });

  if (errors.length - lintCount > 0) return { ok: false, errors: errors.slice(0, MAX_ERRORS) };

  // The waits as a whole: no loop, nothing waiting on later milestones, and nothing two tasks change at once.
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  const named = (id: string): string => nameAt(index.get(id) ?? -1);
  const loop = waitLoop(tasks);
  if (loop) {
    const [first = '', ...rest] = loop.map(named);
    add(loop.length === 2 ? `${first} and ${rest[0] ?? ''} wait for each other; take one out of the other's list.` : `${first} waits for itself through ${rest.join(', ')}; break the loop.`);
    return { ok: false, errors };
  }
  const order = milestones.map((m) => m.id);
  for (const t of tasks) {
    for (const id of t.after) {
      const other = tasks[index.get(id) ?? -1];
      if (!other || order.indexOf(other.milestone) <= order.indexOf(t.milestone)) continue;
      const later = milestones.find((m) => m.id === other.milestone);
      add(`${named(t.id)} waits for ${named(other.id)}, which comes later, in ${quoted(later?.title ?? other.milestone)}; move one of them, since a milestone approved on its own would wait for ever.`);
    }
  }
  // A brief that reads a file another task owns is a wait for it, made here instead of sent back (CEO plans only).
  if (o.structure === true) {
    const made = readDependencies(tasks, order);
    if (made.length > 0) notes.push(`A brief reads a file another task owns, so the office made ${made.join(', ')}.`);
  }
  const closure = waitClosure({ tasks });
  for (let i = 0; i < tasks.length; i += 1) {
    const a = tasks[i];
    if (!a || a.files.length === 0) continue;
    for (let j = i + 1; j < tasks.length; j += 1) {
      const b = tasks[j];
      if (!b || b.files.length === 0) continue;
      if (closure.get(a.id)?.has(b.id) || closure.get(b.id)?.has(a.id)) continue;
      const shared = a.files.find((f) => b.files.some((g) => pathsOverlap(f, g)));
      if (shared === undefined) continue;
      const shareHint = a.owner === b.owner ? '' : ' If they build against the same interface, write it first as a contract (a file one of them writes, with the other waiting for it) instead of both editing it.';
      add(`${named(a.id)} and ${named(b.id)} both change ${shared} and could run at the same time; make one wait for the other, or split the files.${shareHint}`);
      if (errors.length >= MAX_ERRORS) break;
    }
  }
  contractProblems(contracts, tasks, closure, named, add);
  if (o.structure === true) structureProblems({ milestones, tasks, contracts }, people, closure, named, add, o.size);
  const plan: Plan = { goal: redactClip(goal, PLAN_LIMITS.goal), milestones, tasks, ...(contracts.length > 0 ? { contracts } : {}), ...(checklist.length > 0 ? { checklist } : {}) };
  const bytes = byteLength(JSON.stringify(plan));
  if (bytes > PLAN_BYTES) add(`The plan is ${Math.ceil(bytes / 1024)} KB, and a plan holds ${PLAN_BYTES / 1024} KB; shorten the briefs.`);
  return errors.length > 0 ? { ok: false, errors: errors.slice(0, MAX_ERRORS) } : { ok: true, plan, ...(notes.length > 0 ? { notes } : {}) };
}

/** The task the office adds at the end of a medium or large CEO plan: a fresh review of the whole result. It has no check, since it is the model review. */
export const FINAL_REVIEW = {
  title: 'Final review of the whole result',
  brief: "Read the stakeholder's words with stakeholder_words and list every requirement in them. Run the finished result and report each requirement as pass or fail with the evidence. Fix nothing yourself.",
  doneWhen: "Every requirement from the stakeholder's words in stakeholder_words is listed with its result, pass or fail, and the evidence for it.",
} as const;

/** Who gives the final review: the checker seat if the company has one (QA first), else the CEO, who built none of it. */
function finalReview(tasks: readonly PlanTask[], milestone: string, people: readonly PlanPerson[], id: string, harness = false): PlanTask {
  const checkers = people.filter((p) => p.id !== 'ceo' && isChecker(p));
  // v0.4: a harness company's Reviewer gives it, never the Tester who wrote the acceptance tests.
  const reviewer = harness ? people.find((p) => p.id === REVIEWER_ID) : undefined;
  const owner = reviewer ?? checkers.find((p) => QA.test(p.id) || QA.test(p.title)) ?? checkers[0] ?? people.find((p) => p.level === 'ceo' || p.id === 'ceo');
  // After the tasks nothing else waits for: that is every task, directly or through the others, inside the 12 a task can wait for.
  const after = tasks.filter((t) => !tasks.some((u) => u.after.includes(t.id))).map((t) => t.id);
  return { id, title: FINAL_REVIEW.title, owner: owner?.id ?? 'ceo', files: [], milestone, after, brief: FINAL_REVIEW.brief, doneWhen: FINAL_REVIEW.doneWhen, kind: 'verification' };
}

/**
 * A path a brief names: a file name with an extension, with or without folders ("src/cli.ts", "package.json"), not part
 * of a longer word, a URL or an address.
 */
const NAMED_PATH = /(?<![\w./@:\\-])((?:[\w.-]+\/)*[\w-][\w.-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?![\w/\\-])/g;

/**
 * Tasks whose brief names a file another task of the plan owns, outside their own files, read it (benchmark run 1:
 * "finishing src/cli.ts" in a task without it). The wait is made for them: the task waits for the owner, unless it
 * already does, the owner waits for it (an order exists the other way, and a loop must not follow), the owner is in a
 * later milestone, or its waits are full. Only files some task owns count, so a brief that mentions SPEC.md or Node.js
 * in passing changes nothing. Returns what it made, as "p-3 wait for p-1".
 */
function readDependencies(tasks: PlanTask[], milestoneOrder: readonly string[]): string[] {
  const made = new Map<string, string[]>();
  let closure = waitClosure({ tasks });
  for (const t of tasks) {
    if (t.kind === 'verification') continue;
    for (const m of t.brief.matchAll(NAMED_PATH)) {
      const path = normalizePlanPath(m[1] ?? '');
      if (path === '' || t.files.some((f) => pathInside(path, f))) continue;
      const owner = tasks.find((x) => x.id !== t.id && x.kind !== 'verification' && x.files.some((f) => pathInside(path, f)));
      if (!owner || closure.get(t.id)?.has(owner.id) || closure.get(owner.id)?.has(t.id)) continue;
      if (milestoneOrder.indexOf(owner.milestone) > milestoneOrder.indexOf(t.milestone) || t.after.length >= PLAN_LIMITS.after) continue;
      t.after.push(owner.id);
      made.set(t.id, [...(made.get(t.id) ?? []), owner.id]);
      closure = waitClosure({ tasks });
    }
  }
  return [...made].map(([id, owners]) => `${id} wait for ${owners.join(' and ')}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Contracts, integration and the independent check (SPEC-v0.2.md, "What makes big one-shot tasks work")

interface ContractReader {
  earlier: readonly Plan[];
  latest: Plan | undefined;
  ids: readonly string[];
  nameOf: (i: number) => string;
  taskByWord: (said: string) => number[];
  add: (problem: string | null) => void;
  /** Text under its limit as it came, or cut to it (the CEO's plans); a refusal otherwise. */
  fit: (what: string, text: string, max: number) => string;
}

/** The contracts a plan sends, as the plan keeps them: ids given or made, the file as a project path, tasks by id. */
function readContracts(raw: unknown, r: ContractReader): PlanContract[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    r.add('The plan lists its contracts as something other than a list; give each as an object with a title, its file, the task that writes it (writer) and the tasks that build on it (dependents).');
    return [];
  }
  if (raw.length > PLAN_LIMITS.contracts) {
    r.add(`The plan has ${raw.length} contracts and holds ${PLAN_LIMITS.contracts}; merge the ones that could live in one file.`);
    return [];
  }
  const given = givenIds(raw);
  const contractIds = new Ids('c-', r.earlier.flatMap((p) => (p.contracts ?? []).map((c) => c.id)), r.latest?.contracts ?? [], given.ids.filter((id): id is string => id !== null));
  const out: PlanContract[] = [];
  raw.forEach((entry, i) => {
    const c = isObj(entry) ? entry : {};
    const rawTitle = lineOf(c.title);
    const label = rawTitle ? `The contract ${quoted(rawTitle)}` : `Contract ${i + 1}`;
    const inSentenceLabel = `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    if (!isObj(entry)) r.add(`Contract ${i + 1} isn't an object with a title, a file, a writer and its dependents.`);
    else if (!rawTitle) r.add(`Contract ${i + 1} has no title; name the interface it settles, like "Orders API".`);
    if (given.repeats.has(i)) r.add(`Two contracts have the id ${String(c.id).trim()}; give each its own.`);
    const title = r.fit(`The title of ${inSentenceLabel}`, rawTitle, PLAN_LIMITS.title);
    const summary = r.fit(`The summary of ${inSentenceLabel}`, blockOf(c.summary), PLAN_LIMITS.contractSummary);

    const problems: string[] = [];
    const rawFile = typeof c.file === 'string' && c.file.trim() !== '' ? [c.file] : [];
    const file = filesOf(rawFile, label, problems)[0] ?? '';
    for (const p of problems) r.add(p);
    if (isObj(entry) && rawFile.length === 0) r.add(`${label} names no file; name the project file it lives in (a types module, an OpenAPI or markdown spec), like "docs/contracts/api.md".`);

    const one = (word: unknown, what: string): string => {
      const said = typeof word === 'string' ? word.trim() : '';
      const found = said ? r.taskByWord(said) : [];
      if (found.length === 0) r.add(`${label} names "${said.slice(0, 60)}" as ${what}, which isn't a task in the plan; name a task by its id.`);
      else if (found.length > 1) r.add(`${label} names "${said.slice(0, 60)}" as ${what}, and ${found.length} tasks are called that; name it by id.`);
      else return r.ids[found[0] ?? -1] ?? '';
      return '';
    };
    const writer = isObj(entry) ? one(c.writer, 'the task that writes it') : '';
    const dependents: string[] = [];
    if (isObj(entry)) {
      if (!Array.isArray(c.dependents) || c.dependents.length === 0) r.add(`${label} has no dependents; list the tasks that build against it, or leave the contract out.`);
      else if (c.dependents.length > PLAN_LIMITS.dependents) r.add(`${label} has ${c.dependents.length} dependents; it can have ${PLAN_LIMITS.dependents} at most.`);
      else {
        for (const d of c.dependents) {
          const id = one(d, 'a task that builds on it');
          if (id !== '' && !dependents.includes(id)) dependents.push(id);
        }
      }
    }
    out.push({
      id: given.ids[i] ?? contractIds.idFor(rawTitle || `contract ${i + 1}`),
      title: redactClip(title, PLAN_LIMITS.title),
      file,
      writer,
      dependents,
      ...(summary ? { summary: redactClip(summary, PLAN_LIMITS.contractSummary) } : {}),
    });
  });
  return out;
}

/** Contracts that can't work as written: a writer that doesn't own the file, or builders that don't wait for it. */
function contractProblems(
  contracts: readonly PlanContract[],
  tasks: readonly PlanTask[],
  closure: ReadonlyMap<string, ReadonlySet<string>>,
  named: (id: string) => string,
  add: (problem: string | null) => void,
): void {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen: PlanContract[] = [];
  for (const c of contracts) {
    const label = `The contract ${quoted(c.title)} (${c.id})`;
    const writer = byId.get(c.writer);
    if (!writer) continue;
    const twin = seen.find((s) => pathsOverlap(s.file, c.file));
    if (twin) add(`${label} and ${quoted(twin.title)} (${twin.id}) both live in ${c.file}; one file holds one contract, so merge them or give each its own file.`);
    seen.push(c);
    if (!writer.files.some((f) => pathInside(c.file, f))) {
      add(`${label} lives in ${c.file}, but ${named(writer.id)} (${writer.id}), which writes it, doesn't have that file; add ${c.file} to its files.`);
    }
    for (const d of c.dependents) {
      if (!byId.has(d)) continue;
      if (d === c.writer) add(`${label} lists ${named(d)} as both its writer and a dependent; the tasks that build on it are other tasks.`);
      else if (!closure.get(d)?.has(c.writer)) {
        add(`${named(d)} (${d}) builds against ${label}, which ${named(writer.id)} (${writer.id}) writes, but doesn't wait for it; add ${writer.id} to its after, so the contract is written before anyone builds on it.`);
      }
    }
  }
}

/**
 * What makes a plan big: people building parts, and tasks in all. Under it, a plan is small enough for its heads to
 * integrate, and the extra tasks would cost more than they catch.
 */
export const BIG_PLAN = { streams: 3, tasks: 6 } as const;

/** The roles that check others' work, by the id or title a person has. */
const CHECKER = /(?:^|[\s-])(?:qa|quality|tester|reviewer|accessibility|performance)(?:$|[\s-])/i;
const QA = /(?:^|[\s-])(?:qa|quality|tester)(?:$|[\s-])/i;
const isChecker = (p: PlanPerson): boolean => CHECKER.test(p.id) || CHECKER.test(p.title);

const listOf = (items: readonly string[], limit = 5): string => (items.length > limit ? `${items.slice(0, limit).join(', ')} and ${items.length - limit} more` : items.join(', '));

/**
 * How a plan is organised. Contracts (v0.2): with 3 or more makers building parts, a plan names at least one contract,
 * unless no two makers' tasks wait for each other (then they share nothing to agree on); the message gives the shape to
 * add. Big is `BIG_PLAN`: enough people building parts and enough tasks that the heads can't keep the whole in their
 * heads; a big large-company plan (or, with no size, any big plan) also has an integration task at each milestone where
 * several people's work meets. The final verification isn't a rule here: a medium or large plan's is the office's (see
 * checkPlan), and a small plan has none.
 */
function structureProblems(
  plan: Pick<Plan, 'milestones' | 'tasks' | 'contracts'>,
  people: readonly PlanPerson[],
  closure: ReadonlyMap<string, ReadonlySet<string>>,
  named: (id: string) => string,
  add: (problem: string | null) => void,
  size?: Size,
): void {
  const { milestones, tasks } = plan;
  const builders = tasks.filter((t) => t.kind === undefined);
  const streams = new Set(builders.map((t) => t.owner));
  const ref = (t: PlanTask): string => `${named(t.id)} (${t.id})`;
  const who = (id: string): string => {
    const p = people.find((x) => x.id === id);
    return p ? nameIn(p) : id;
  };

  if (streams.size >= BIG_PLAN.streams && (plan.contracts ?? []).length === 0) {
    // Whose tasks wait for whose: a stream that others build on is the one that owns a contract, and its first task writes it.
    const needs = new Map<string, Set<string>>();
    for (const a of builders) {
      for (const b of builders) {
        if (a.owner !== b.owner && closure.get(a.id)?.has(b.id)) needs.set(b.owner, (needs.get(b.owner) ?? new Set()).add(a.id));
      }
    }
    // The stream most tasks build on owns the contract (the first one named when they tie).
    const [owner, dependents] = [...needs].sort((a, b) => b[1].size - a[1].size)[0] ?? [];
    const writer = builders.find((t) => t.owner === owner);
    if (owner !== undefined && dependents !== undefined && writer !== undefined) {
      const shape = JSON.stringify({ title: '<what they share, like Orders API>', file: `docs/contracts/${owner}.md`, writer: writer.id, dependents: [...dependents].slice(0, PLAN_LIMITS.dependents) });
      add(
        `${streams.size} people build parts of this plan and ${[...dependents].length === 1 ? 'one task builds' : 'some tasks build'} on ${who(owner)}'s work, but it has no contracts. Add to contracts one for each interface they share, like ${shape}: its file is written by the first task of the stream that owns it (add the file to that task's files), and every task that builds on it waits for that task. Put the stakeholder's requirements for it in the file word for word.`,
      );
    }
  }

  const big = streams.size >= BIG_PLAN.streams && tasks.length >= BIG_PLAN.tasks;
  const asksIntegration = big && (size === undefined || size === 'large');
  for (const m of asksIntegration ? milestones : []) {
    const parts = builders.filter((t) => t.milestone === m.id);
    const owners = [...new Set(parts.map((t) => t.owner))];
    if (owners.length < 2) continue;
    const integrations = tasks.filter((t) => t.milestone === m.id && t.kind === 'integration');
    const missing = (i: PlanTask): PlanTask[] => parts.filter((p) => !closure.get(i.id)?.has(p.id));
    const first = integrations[0];
    if (!first) {
      add(
        `The milestone ${quoted(m.title)} has work from ${listOf(owners.map(who))} but no integration task. Add a task in it with kind "integration", owned by one person, waiting for ${listOf(parts.map((t) => t.id), 12)}, that builds and runs the whole thing together and fixes or reports each mismatch against the contracts.`,
      );
    } else if (!integrations.some((i) => missing(i).length === 0)) {
      add(`${ref(first)} integrates ${quoted(m.title)} but doesn't wait for ${listOf(missing(first).map((t) => t.id), 12)}; add them to its after, so it runs the whole milestone together.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What steering reads off a plan

/** With approval off, the plan applies as proposed and managers assign freely, as before plans existed. */
export const planGoverns = (settings: Pick<SteeringSettings, 'planApproval'>): boolean => settings.planApproval !== 'off';

export const latestVersion = (view: Pick<PlanView, 'versions'>): PlanVersion | null => view.versions.at(-1) ?? null;

/** The approved version, while the state still holds it. */
export function approvedVersion(view: Pick<PlanView, 'versions' | 'approved'>): PlanVersion | null {
  const a = view.approved;
  return a ? (view.versions.find((v) => v.version === a.version) ?? null) : null;
}

/** The milestones an approval covers: all of them, or those up to and including `through`. */
export function scopeOf(plan: Pick<Plan, 'milestones'>, through: string | null): Set<string> {
  const ids = plan.milestones.map((m) => m.id);
  if (through === null) return new Set(ids);
  const at = ids.indexOf(through);
  return new Set(at < 0 ? [] : ids.slice(0, at + 1));
}

/** The approved plan and what of it is approved, or null when nothing is. */
export function approvedScope(view: Pick<PlanView, 'versions' | 'approved'>): { version: PlanVersion; approval: PlanApprovalState; milestones: Set<string> } | null {
  const version = approvedVersion(view);
  const approval = view.approved;
  if (!version || !approval) return null;
  return { version, approval, milestones: scopeOf(version.plan, approval.through) };
}

/**
 * Whether the plan waits for the stakeholder, which the inbox counts: a newer version than the one approved (or none
 * approved yet), or a milestone done whose next one waits. Never with approval off.
 */
export function planWaits(view: Pick<PlanView, 'versions' | 'approved' | 'waiting'>, settings: Pick<SteeringSettings, 'planApproval'>): boolean {
  if (!planGoverns(settings)) return false;
  const latest = latestVersion(view);
  if (!latest) return false;
  return view.waiting !== null || view.approved?.version !== latest.version;
}

/**
 * What the plan waits on you for, in words the inbox, Now and the palette share: the whole version, or the milestone
 * after one that is done (at every milestone). Null when nothing waits.
 */
export function planWaitingFor(view: Pick<PlanView, 'versions' | 'approved' | 'waiting'>, settings: Pick<SteeringSettings, 'planApproval'>): { kind: 'plan' | 'milestone'; sentence: string } | null {
  if (!planWaits(view, settings)) return null;
  const latest = latestVersion(view);
  if (view.waiting && latest) {
    const ms = latest.plan.milestones;
    const at = ms.findIndex((m) => m.id === view.waiting?.milestone);
    const next = at >= 0 ? ms[at + 1] : undefined;
    if (next) return { kind: 'milestone', sentence: `${quoted(plainText(next.title))} waits for your approval before it starts.` };
  }
  return { kind: 'plan', sentence: "The CEO's plan waits for your approval." };
}

export const planInbox = (view: Pick<PlanView, 'versions' | 'approved' | 'waiting'>, settings: Pick<SteeringSettings, 'planApproval'>): number => (planWaits(view, settings) ? 1 : 0);

/** "three milestones and 17 tasks". */
export function planSize(plan: Pick<Plan, 'milestones' | 'tasks'>): string {
  const ms = plan.milestones.length;
  const ts = plan.tasks.length;
  return `${countWord(ms)} milestone${ms === 1 ? '' : 's'} and ${countWord(ts)} task${ts === 1 ? '' : 's'}`;
}

/** What one version changes from another, as clauses: "added “Cart”", "cut “Table cards”", "moved “Deploy previews”". */
export function planChanges(before: Plan, after: Plan): string[] {
  const d = planDiff(before, after);
  const list = (verb: string, items: readonly { title: string }[]): string[] => {
    if (items.length === 0) return [];
    if (items.length > 3) return [`${verb} ${items.length} tasks`];
    return [`${verb} ${items.map((x) => quoted(x.title)).join(', ')}`];
  };
  const out: string[] = [];
  if (d.goal) out.push('changed the goal');
  for (const m of d.milestones.added) out.push(`added the milestone ${quoted(m.title)}`);
  for (const m of d.milestones.removed) out.push(`cut the milestone ${quoted(m.title)}`);
  for (const c of d.milestones.changed) out.push(`changed the milestone ${quoted(c.after.title)}`);
  out.push(...list('added', d.tasks.added), ...list('cut', d.tasks.removed), ...list('changed', d.tasks.changed.map((c) => c.after)));
  out.push(...contractChanges(before.contracts ?? [], after.contracts ?? []));
  if (d.checklist) {
    // Covers that went only because their task was cut are part of that cut, not a change of the item.
    const kept = new Set(after.tasks.map((t) => t.id));
    const changed = d.checklist.changed.filter(
      (c) => c.before.text !== c.after.text || c.before.quote !== c.after.quote || c.after.covers.some((id) => !c.before.covers.includes(id)) || c.before.covers.some((id) => kept.has(id) && !c.after.covers.includes(id)),
    );
    for (const k of d.checklist.added) out.push(`added the checklist item ${quoted(k.text)}`);
    for (const k of d.checklist.removed) out.push(`cut the checklist item ${quoted(k.text)}`);
    for (const c of changed) out.push(`changed the checklist item ${quoted(c.after.text)}`);
  }
  const moved = d.tasks.moved.map((id) => after.tasks.find((t) => t.id === id)).filter((t): t is PlanTask => t !== undefined);
  out.push(...list('moved', moved));
  return out;
}

/** The contracts a version adds, cuts or changes, as clauses. */
function contractChanges(before: readonly PlanContract[], after: readonly PlanContract[]): string[] {
  const was = new Map(before.map((c) => [c.id, c]));
  const now = new Map(after.map((c) => [c.id, c]));
  const out: string[] = [];
  for (const c of after) {
    const old = was.get(c.id);
    if (!old) out.push(`added the contract ${quoted(c.title)}`);
    else if (JSON.stringify(old) !== JSON.stringify(c)) out.push(`changed the contract ${quoted(c.title)}`);
  }
  for (const c of before) if (!now.has(c.id)) out.push(`cut the contract ${quoted(c.title)}`);
  return out;
}

/** "Added “Cart” and cut “Table cards”." for a sentence; empty when nothing changed. */
export function changesSentence(changes: readonly string[]): string {
  if (changes.length === 0) return '';
  const text = changes.length === 1 ? (changes[0] ?? '') : `${changes.slice(0, -1).join(', ')} and ${changes[changes.length - 1] ?? ''}`;
  return `${capital(text)}.`;
}
