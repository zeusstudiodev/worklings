// The plan linter (v0.2, SPEC-v0.2.md "Better by design", 2): what the shape of a CEO's plan costs, held in code because
// a sentence in the house rules gets ignored (a preset line once made the CEO split build and tests into two tasks, and
// the run cost 2.4 times as much and didn't finish). checkPlan runs it on propose_plan (`structure`) and never on the
// stakeholder's own edit. Pure, with no Node APIs.
import { DEFAULT_PRESET, PRESETS, type PresetId } from './presets.ts';
import { isCheckerSeat, makersIn, type Size, taskCap } from './size.ts';
import { PLAN_LIMITS, type PlanTask } from './steering.ts';

/**
 * What one context holds, as a task's limits: files in at most this many areas (see `areasOf`, which leaves out config,
 * lockfiles, README and docs), a brief of at most this many characters (about 400 words), a done-when of at most this
 * many separate requirements. Past any of them the task is asked to be narrowed to one feature or split by feature.
 * Chosen so that the tasks of the five real plan-only runs (test/plan-only-runs.test.ts), which a desk finished well
 * inside 80k tokens, pass; the files cover a whole feature and its tests, so a task that spans more is several features.
 */
export const TASK_LIMITS = { areas: 6, brief: 2400, requirements: 6 } as const;

const UNSAFE_COMMAND = /[|;`<>]|\$\(|(?<!&)&(?!&)/;

/**
 * Why a check isn't a plain command line, as a clause that follows "the check of X", or null when it is one: one line
 * of at most PLAN_LIMITS.check characters, starting with a program or path, with no pipe, redirect, substitution or
 * background marker (chain commands with &&). The office will run it, so it stays a command and not a script.
 */
export function commandProblem(command: string): string | null {
  if (command === '') return 'is empty';
  if (/[\r\n\p{Cc}]/u.test(command)) return 'has more than one line';
  if (command.length > PLAN_LIMITS.check) return `is ${command.length} characters long, and a check holds ${PLAN_LIMITS.check}`;
  if (!/^[A-Za-z0-9./_]/.test(command)) return `starts with "${command.slice(0, 1)}", and a command starts with a program or a path`;
  if (UNSAFE_COMMAND.test(command)) return 'has a pipe, a redirect, a substitution or a background marker, and a check is one plain command, chained with && when it needs several';
  return null;
}

/** Top-level folders that only hold the areas: their next folder is the area. */
const CONTAINERS = new Set(['src', 'app', 'apps', 'lib', 'packages', 'web', 'server', 'client', 'test', 'tests', 'docs']);

/** The area a path is in: its first folder, or its first two when the first only holds areas (src/cart, src/orders); a file at the root is "the project root". */
export function areaOf(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/').filter((part) => part !== '' && part !== '.');
  // A last part with an extension is a file; what is left is the folders it sits in.
  const folders = /\.[A-Za-z0-9]{1,8}$/.test(parts.at(-1) ?? '') ? parts.slice(0, -1) : parts;
  const first = folders[0];
  if (first === undefined) return 'the project root';
  return CONTAINERS.has(first.toLowerCase()) && folders.length >= 2 ? `${first}/${folders[1] ?? ''}` : first;
}

/**
 * Files that say nothing about how big a task is: dot files, config, lockfiles, the README and the like, and what is in
 * docs/, wherever they sit. (A task that scaffolds a project touches a dozen of them and is still one piece of work.)
 */
const NOT_AN_AREA = /(?:^|\/)(?:\.[^/]*|[^/]*\.(?:json|jsonc|ya?ml|toml|lock|lockb|ini|cfg|md|mdx|rst)|[^/]*\.config\.[cm]?[jt]s|[^/]*\.d\.ts|(?:readme|license|licence|changelog|contributing|makefile|dockerfile)[^/]*)$/i;

/** The distinct areas a task's files are in, leaving out what `NOT_AN_AREA` and docs folders say nothing about. */
export function areasOf(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const path = normalized(file);
    if (/^(?:docs?|\.[^/]+)(?:\/|$)/i.test(path) || NOT_AN_AREA.test(path)) continue;
    out.add(areaOf(path));
  }
  return [...out];
}

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|specs?|e2e|cypress)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$/i;
const TEST_VERBS = '(?:write|add|create|run|do|build|extend|implement|perform|expand|finish|complete)';
const TEST_ADJECTIVES = '(?:the|all|more|some|new|extra|full|a|automated|unit|integration|e2e|end[- ]to[- ]end|regression|acceptance|smoke|playwright|vitest|jest|pytest)';
/** A title that is only tests: "Write tests for the cart", "Unit tests", "QA the checkout"; "Cart tests" by the end rule; "Cart page and tests" is not. */
const TESTS_TITLE = new RegExp(`^(?:${TEST_VERBS}\\s+)?(?:${TEST_ADJECTIVES}\\s+)*(?:tests?|testing|test suites?|qa|quality assurance|verification)\\b|^(?:test|qa|verify)\\s+(?:the|all|that|everything)\\b`, 'i');
const TESTS_TITLE_END = /\b(?:tests?|qa|testing|test suite)$/i;
const COMBINED = /\b(?:and|with|plus)\b|[+&]/i;
const TESTS_BRIEF = new RegExp(`^(?:${TEST_VERBS}\\s+(?:\\w+\\s+){0,3}(?:tests?|test suites?|qa)\\b|(?:test|qa|verify)\\s+(?:the|all|that|everything)\\b)`, 'i');

/** Whether a task is only tests, QA or verification of work another task builds, from its title, brief and files. */
export function isTestsOnly(t: Pick<PlanTask, 'title' | 'brief' | 'files' | 'kind'>): boolean {
  if (t.kind === 'verification' || t.kind === 'integration') return false;
  if (t.files.length > 0 && t.files.every((f) => TEST_PATH.test(f))) return true;
  const title = t.title.trim();
  if (TESTS_TITLE.test(title) || (!COMBINED.test(title) && TESTS_TITLE_END.test(title))) return true;
  return t.files.length === 0 && TESTS_BRIEF.test(t.brief.trim());
}

/**
 * How many separate requirements a done-when holds, read the way people list them: numbered items ("1. a 2. b"), then
 * bulleted lines, then semicolon clauses, then sentences; the first of these that finds two or more, else the sentences.
 */
export function requirementsIn(doneWhen: string): number {
  const text = doneWhen.trim();
  if (text === '') return 0;
  const numbered = (text.match(/(?:^|\s)\d{1,2}[.)]\s+\S/g) ?? []).length;
  if (numbered >= 2) return numbered;
  const bullets = text.split('\n').filter((line) => /^\s*[-*•]\s+\S/.test(line)).length;
  if (bullets >= 2) return bullets;
  const clauses = text.split(/;\s*/).filter((c) => c.trim() !== '').length;
  if (clauses >= 2) return clauses;
  return Math.max(1, text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter((c) => c.trim() !== '').length);
}

/**
 * A task of documentation only: its files are all READMEs, changelogs and the like (anywhere), or markdown at the root,
 * or it has no files and is titled that way ("Write the README"). That prose is written by whoever builds what it
 * describes, with it. Files in docs/ never count: a spec, a design note, an API reference or a contract there is
 * something other tasks build against, so a task that writes one is a deliverable, and code can't tell it from a
 * guide the stakeholder asked for.
 */
const DOC_PATH = /^(?:.*\/)?(?:readme|changelog|contributing|license|licence|code_of_conduct)[^/]*$|^[^/]+\.(?:md|mdx|rst|txt)$/i;
const DOC_TITLE = /^(?:(?:write|add|update|create|draft|finish|polish)\s+)?(?:the\s+|a\s+|an\s+)?(?:project\s+)?(?:readme|docs|documentation|user guide|changelog)\b/i;

export function isDocsOnly(t: Pick<PlanTask, 'title' | 'files' | 'kind'>): boolean {
  if (t.kind !== undefined) return false;
  if (t.files.length > 0) return t.files.every((f) => DOC_PATH.test(normalized(f)));
  return DOC_TITLE.test(t.title.trim());
}

const normalized = (path: string): string => path.replaceAll('\\', '/').replace(/^\.\//, '');

export interface LintPerson {
  id: string;
  level?: string;
  title: string;
}

/** What the plan is held to besides its tasks: the company's size and the stakeholder's preset. */
export interface LintContext {
  size?: Size | undefined;
  preset?: PresetId | undefined;
  /**
   * v0.4: a harness company's plan (src/core/harness-shape.ts), whose tasks the office wrote: a Builder's task is a whole
   * milestone and the Tester's is only tests on purpose, so the task cap, "only tests" and "too big" don't apply.
   */
  harness?: boolean;
}

const listOf = (items: readonly string[], limit = 5): string => (items.length > limit ? `${items.slice(0, limit).join(', ')} and ${items.length - limit} more` : items.join(', '));

/**
 * The rules that need only the tasks, on the CEO's plan: no task that is only tests or only documentation, a check on
 * every maker's task, no more tasks than the makers hold, no task too big for one context. Every refusal names its task
 * and the fix. `nameOf(i)` is how a sentence names the i-th task; `parsed(i)` says whether it was an object (a task that
 * isn't one is already refused for that, and gets no second sentence). The final verification task, which the office
 * adds itself, is among `tasks` and none of this: it isn't counted and has no check.
 */
export function lintProblems(
  tasks: readonly PlanTask[],
  people: readonly LintPerson[],
  context: LintContext,
  nameOf: (i: number) => string,
  parsed: (i: number) => boolean,
  add: (problem: string | null) => void,
): void {
  const { size } = context;
  const preset = PRESETS[context.preset ?? DEFAULT_PRESET];
  const counted = tasks.filter((t) => t.kind !== 'verification').length;
  if (size !== undefined && context.harness !== true) {
    const makers = makersIn(people);
    const cap = taskCap(size, makers, preset.tasksPerMaker);
    if (counted > cap) {
      add(`The plan has ${counted} tasks, and ${makers} ${makers === 1 ? 'maker holds' : 'makers hold'} ${cap} (${preset.label}: up to ${preset.tasksPerMaker} each). Plan the fewest tasks that run in parallel, each a whole feature with its own tests that one person finishes in one sitting, and fold the rest into them.`);
    }
  }
  const named = (id: string): string => {
    const at = tasks.findIndex((x) => x.id === id);
    return at >= 0 ? `${nameOf(at)} (${id})` : id;
  };
  tasks.forEach((t, i) => {
    if (!parsed(i)) return;
    const ref = `${nameOf(i)} (${t.id})`;
    const owner = people.find((p) => p.id === t.owner);

    if (context.harness === true) {
      // The loop's own shape: acceptance tests first, then the milestone's build.
    } else if (isTestsOnly(t)) {
      const target = t.after.length > 0 ? `the task it tests, probably ${t.after.slice(0, 3).map(named).join(' or ')}` : 'the task it tests';
      add(`${ref} is only tests of another task's work; fold it into ${target}, so one owner builds and tests it together, and remove this task. A task that really integrates or verifies the whole has kind "integration" or "verification".`);
    } else if (isDocsOnly(t)) {
      add(`${ref} is only documentation; fold it into the task that builds what it documents, so its owner writes the README with the feature. A spec or a guide in docs/ is a task of its own.`);
    }

    const makes = owner !== undefined && owner.id !== 'ceo' && owner.level !== 'ceo' && !isCheckerSeat(owner) && t.kind !== 'verification';
    if (makes && t.check === undefined) {
      add(`${ref} has no check; give it one command the office can run to see it is done, in check, like "npm test", "npm run typecheck && npm test" or "node --test".`);
    }

    if (t.kind === undefined && context.harness !== true) {
      const areas = areasOf(t.files);
      const reqs = requirementsIn(t.doneWhen);
      const why: string[] = [];
      if (areas.length > TASK_LIMITS.areas) why.push(`its files span ${areas.length} areas (${listOf(areas, 8)})`);
      if (t.brief.length > TASK_LIMITS.brief) why.push(`its brief is ${t.brief.length} characters`);
      if (reqs > TASK_LIMITS.requirements) why.push(`its doneWhen holds ${reqs} separate requirements`);
      if (why.length > 0) {
        add(`${ref} is too big for one context: ${why.join(' and ')}. Narrow it to one feature, or split it by feature (a slice a user can see, with its own tests and check), never by file or into one task to build and another to test.`);
      }
    }
  });
}
