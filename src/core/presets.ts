// The spending plan's presets (v0.2): how big the company is, how many work at once and which model each level runs on,
// as one choice the stakeholder makes. Lean, Balanced (the default) and Thorough. Pure, with no Node APIs: the company,
// the CEO's opening turn and the proposal's form read the same table.
import { SIZE_RULES, type Size } from './size.ts';
import type { Effort } from './steering.ts';
import type { Level, RoleModel } from './studio.ts';

export const PRESET_IDS = ['lean', 'balanced', 'thorough'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export const DEFAULT_PRESET: PresetId = 'balanced';

/**
 * v0.4 (SPEC-v0.4.md, H1): the seats a harness-shaped company has. The Lead is the CEO seat; Builders own the code;
 * the Tester writes the acceptance tests before the build and runs them after; the Reviewer gives the one final review.
 */
export const SEATS = ['lead', 'builder', 'tester', 'reviewer'] as const;
export type Seat = (typeof SEATS)[number];
/** The office title of each seat. */
export const SEAT_TITLES: Readonly<Record<Seat, string>> = { lead: 'Lead', builder: 'Builder', tester: 'Tester', reviewer: 'Reviewer' };

export const isPresetId = (value: unknown): value is PresetId => typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value);

/** The model each level runs on, as Claude Code aliases (never a dated id: the user's Claude Code resolves them). */
export type ModelsByLevel = Record<Level, RoleModel>;

export interface Preset {
  id: PresetId;
  label: string;
  /** One line for the selector. */
  summary: string;
  /** The people a company under this preset usually has, the CEO included: what the selector says and what a proposal's count is compared with. The size rules below are what the CEO's proposal is held to. */
  team: { min: number; max: number };
  /** v0.2: the sizes the CEO may pick (the preset caps the size; the CEO picks at or under it). */
  sizes: readonly Size[];
  /** The most makers (people who do the work) a proposal under this preset holds. */
  maxMakers: number;
  /** The most checker seats (QA, reviewers, accessibility) a proposal holds: none unless the stakeholder chose Thorough. */
  checkers: number;
  /** Whether testing is someone's own job, or the makers test their own work. */
  qa: 'folded' | 'separate';
  /** Whether reviewing the work is someone's own job, or the head or the CEO reviews it. */
  review: 'folded' | 'separate';
  /** v0.2: the most tasks a plan holds for each maker (the verification the office adds isn't counted): Lean 2, Balanced 3, Thorough 4. */
  tasksPerMaker: number;
  /** Desks working at once in the company, the CEO's included (the company's maxDesks). */
  desks: number;
  models: ModelsByLevel;
  /**
   * v0.4 (H4): Claude Code's --effort for each seat's desk. The Builder's moves with the preset (Lean medium, Balanced
   * high, Thorough xhigh); the Lead thinks hard in all three, the Tester and the Reviewer at medium. A person's own
   * effort, set in steering, wins over their seat's.
   */
  efforts: Readonly<Record<Seat, Effort>>;
  /**
   * The team the estimates assume when there is no proposal yet: heads and workers beside the CEO. Typical, not a
   * promise: the CEO sizes the real one to the goal.
   */
  typical: { heads: number; workers: number };
}

/**
 * Why these numbers (Robin, 13 Nov 2026; SPEC-v0.2.md): the CEO is on Opus in all three, because the plan is what
 * every other person's work is spent on and Opus 5.5 costs only twice Sonnet 5.5; the people who do the work are on
 * Sonnet; only Thorough puts heads on Opus too, where they integrate and review. Lean and Balanced differ in how much
 * company there is, not in how good the model is: no preset runs anyone on a small model.
 *
 * Desks at once follow the spec's "at most 4 or 5 roles at once": Lean 3 (the CEO and two), Balanced 5 (the CEO and
 * four), Thorough 8 (the cap v0.1 started with).
 */
export const PRESETS: Readonly<Record<PresetId, Preset>> = {
  lean: {
    id: 'lean',
    label: 'Lean',
    summary: 'One to three people do the work and the CEO leads them: no heads, makers test their own work.',
    team: { min: 2, max: 4 },
    sizes: ['small', 'medium'],
    maxMakers: 3,
    checkers: 0,
    qa: 'folded',
    review: 'folded',
    tasksPerMaker: 2,
    desks: 3,
    models: { ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' },
    efforts: { lead: 'high', builder: 'medium', tester: 'medium', reviewer: 'medium' },
    typical: { heads: 0, workers: 2 },
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    summary: "The company is sized to the job. Makers test their own work, the office runs each task's check, and one independent review comes at the end.",
    team: { min: 3, max: 10 },
    sizes: ['small', 'medium', 'large'],
    maxMakers: 24,
    checkers: 0,
    qa: 'folded',
    review: 'folded',
    tasksPerMaker: 3,
    desks: 5,
    models: { ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' },
    efforts: { lead: 'high', builder: 'high', tester: 'medium', reviewer: 'medium' },
    typical: { heads: 1, workers: 5 },
  },
  thorough: {
    id: 'thorough',
    label: 'Thorough',
    summary: 'Specialists for every area, independent testing and a separate reviewer, heads on the strongest model.',
    team: { min: 6, max: 25 },
    sizes: ['small', 'medium', 'large'],
    maxMakers: 24,
    checkers: 2,
    qa: 'separate',
    review: 'separate',
    tasksPerMaker: 4,
    desks: 8,
    models: { ceo: 'opus', head: 'opus', lead: 'sonnet', worker: 'sonnet' },
    efforts: { lead: 'high', builder: 'xhigh', tester: 'medium', reviewer: 'medium' },
    typical: { heads: 2, workers: 11 },
  },
};

export const presetOf = (id: PresetId): Preset => PRESETS[id];

/** v0.4: the effort a seat's desk runs at under a preset. */
export const seatEffort = (id: PresetId, seat: Seat): Effort => PRESETS[id].efforts[seat];

/** The levels models are set for, in the order a form lists them. */
export const MODEL_LEVELS: readonly Level[] = ['ceo', 'head', 'lead', 'worker'];

export const presetModels = (id: PresetId): ModelsByLevel => ({ ...PRESETS[id].models });

/** `team` says an org is under, over or inside a preset's range. */
export function outsideRange(id: PresetId, people: number): 'under' | 'over' | null {
  const { min, max } = PRESETS[id].team;
  return people < min ? 'under' : people > max ? 'over' : null;
}

const sizeList = (sizes: readonly Size[]): string => (sizes.length === 3 ? 'small, medium or large' : sizes.join(' or '));

/**
 * What the CEO is told about the preset, in its opening turn, in the scoping answers and when the stakeholder changes it:
 * the sizes it may pick, how testing and review are staffed, and that `sizing` starts with the preset's name. Code
 * holds the proposal to it (checkProposal), so these lines say what to do, not what is forbidden.
 * `chosen`: the stakeholder picked it; false while it is only the default.
 */
export function presetGuidance(id: PresetId, chosen: boolean, models: ModelsByLevel = PRESETS[id].models): string[] {
  const p = PRESETS[id];
  const { small, medium, large } = SIZE_RULES;
  const shapes = `small is ${small.summary}; medium is ${medium.summary}; large is ${large.summary}`;
  const cap = p.sizes.length === 3 ? '' : ` ${p.label} stops at ${p.sizes.at(-1)}${p.maxMakers < medium.makers.max ? `, with up to ${p.maxMakers} makers` : ''}.`;
  const checks =
    p.checkers > 0
      ? "Makers test their own work inside their own tasks and the office runs each task's check. A checker seat (a QA engineer, a reviewer) is allowed here: one in a medium company, up to two in a large one, for the independent look at the end; tests are never a task of their own."
      : p.id === 'lean'
        ? "Makers test their own work, the office runs each task's check, and you check the result yourself at the end: no QA or reviewer seat, and no task of its own for tests."
        : "Makers test their own work, the office runs each task's check, and one independent review of the whole result happens at the end: no QA or reviewer seat working alongside, and no task of its own for tests.";
  return [
    `Thoroughness: ${p.label}${chosen ? " (the stakeholder's choice)" : ' (the default until the stakeholder chooses)'}. ${p.summary}`,
    `Size the company with propose_org's size, ${sizeList(p.sizes)}: ${shapes}.${cap} Up to ${p.desks} work at once, you included. ${checks}`,
    `Models are set from it (${MODEL_LEVELS.map((l) => `${l} ${models[l]}`).join(', ')}): leave a person's model out of the proposal to take theirs.`,
    `Start sizing with the preset's name ("${p.label}: ..."), then the reason in one line.`,
  ];
}
