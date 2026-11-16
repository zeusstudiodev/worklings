// v0.3, "Acceptance first" (SPEC-v0.3.md, Q2): each checklist item can carry the check that will accept it, written with the
// plan before any maker starts, so makers build against it (the exact page, button and field names) and the office can run it
// itself at the end. A walk is a few plain steps on one page of the running app, run by the office in a headless browser
// (src/company/app-look.ts); a command is one plain command the office runs as it runs a task's check; a judgement says why no
// machine can check it, and stays for the final review. Pure, with no Node APIs: the plan reader and the runner share it.
import { commandProblem } from './plan-lint.ts';

export const ACCEPT_KINDS = ['walk', 'command', 'judgement'] as const;
export type AcceptKind = (typeof ACCEPT_KINDS)[number];

/** How the office accepts one checklist item. Absent on items no one wrote one for, and on every plan saved before 0.3. */
export type AcceptCheck = { kind: 'walk'; page: string; steps: string[] } | { kind: 'command'; command: string } | { kind: 'judgement'; why: string };

export const ACCEPT_LIMITS = { steps: 12, step: 200, page: 200, why: 200 } as const;

/** One step of a walk, as the runner drives it. */
export type WalkStep =
  | { verb: 'open'; target: string }
  | { verb: 'click'; target: string }
  | { verb: 'fill'; target: string; value: string }
  | { verb: 'select'; target: string; value: string }
  | { verb: 'check'; target: string }
  | { verb: 'see'; target: string };

/** A path on the app, as CHECKLIST_PAGE takes one: never `//host/x`, which a browser reads as another site. */
export const WALK_PAGE = /^\/(?![/\\])[\w\-./?=&%#~]*$/;

const STEP = /^(open|click|fill|select|check|see)\s+"([^"]{1,120})"(?:\s+(with|option)\s+"([^"]{0,160})")?$/i;

/** The grammar, as a sentence the CEO's tool and a refusal both quote. */
export const STEP_GRAMMAR =
  'open "/path", click "Button or link name", fill "Field label" with "text", select "Field label" option "Choice", check "Checkbox label" or see "Text on the page"; {unique} in a value becomes a fresh word each run';

/** A step as the runner drives it, or why it isn't one. */
export function parseStep(text: string): WalkStep | string {
  const m = STEP.exec(text.trim());
  if (!m) return `"${text.slice(0, 60)}" isn't a step the office can drive; write it as one of: ${STEP_GRAMMAR}`;
  const verb = (m[1] ?? '').toLowerCase();
  const target = m[2] ?? '';
  const joiner = m[3]?.toLowerCase();
  const value = m[4];
  if (verb === 'fill' || verb === 'select') {
    const want = verb === 'fill' ? 'with' : 'option';
    if (joiner !== want || value === undefined) return `"${text.slice(0, 60)}" needs ${want} "…" after the ${verb === 'fill' ? 'field' : 'list'}'s label`;
    return { verb, target, value };
  }
  if (joiner !== undefined) return `"${text.slice(0, 60)}" has words after the name that a ${verb} step doesn't take`;
  if (verb === 'open') return WALK_PAGE.test(target) ? { verb, target } : `"${text.slice(0, 60)}" opens something other than a path on the app, like "/settings"`;
  return { verb: verb as 'click' | 'check' | 'see', target };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const lineOf = (v: unknown): string => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim() : '');

/**
 * An item's acceptance check as the plan keeps it, or null when none was given. A check that is wrong is a problem for the
 * plan's answer (`add`), named by `label` ("The checklist item “…”"), and the item keeps none.
 */
export function readAccept(raw: unknown, label: string, add: (problem: string) => void): AcceptCheck | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) {
    add(`${label} has an accept that isn't an object; give {"kind":"walk","page":"/","steps":[…]}, {"kind":"command","command":"…"} or {"kind":"judgement","why":"…"}.`);
    return null;
  }
  const kind = raw.kind;
  if (kind === 'walk') {
    const page = lineOf(raw.page) || '/';
    if (page.length > ACCEPT_LIMITS.page || !WALK_PAGE.test(page)) {
      add(`${label} walks a page that isn't a path on the app; give one like "/" or "/households".`);
      return null;
    }
    const steps = Array.isArray(raw.steps) ? raw.steps.map(lineOf) : null;
    if (steps === null || steps.length === 0) {
      add(`${label} has a walk with no steps; list them as ${STEP_GRAMMAR}.`);
      return null;
    }
    if (steps.length > ACCEPT_LIMITS.steps) {
      add(`${label} has a walk of ${steps.length} steps and one holds ${ACCEPT_LIMITS.steps}; keep the steps that show the item is met.`);
      return null;
    }
    for (const step of steps) {
      const parsed = step.length > ACCEPT_LIMITS.step ? 'is too long' : parseStep(step);
      if (typeof parsed === 'string') {
        add(`${label}: ${parsed}.`);
        return null;
      }
    }
    if (!steps.some((s) => /^see\s/i.test(s))) {
      add(`${label} has a walk with no see step, so it can't fail; end it with what the page shows once the item is met, like see "Your vote counted".`);
      return null;
    }
    return { kind, page, steps };
  }
  if (kind === 'command') {
    const command = lineOf(raw.command);
    const problem = commandProblem(command);
    if (problem !== null) {
      add(`${label} has an acceptance command that ${problem}.`);
      return null;
    }
    return { kind, command };
  }
  if (kind === 'judgement') {
    const why = lineOf(raw.why).slice(0, ACCEPT_LIMITS.why);
    return { kind, why: why || 'A person judges it.' };
  }
  add(`${label} has an accept of kind "${String(kind).slice(0, 20)}"; the kinds are walk, command and judgement.`);
  return null;
}

/** An acceptance check as one line for the brief and a turn: `walk on "/": fill "Email" with "…"; see "Welcome"`. */
export function acceptLine(a: AcceptCheck): string {
  if (a.kind === 'walk') return `walk on "${a.page}": ${a.steps.join('; ')}`;
  if (a.kind === 'command') return `command: ${a.command}`;
  return `judged by the final review: ${a.why}`;
}
