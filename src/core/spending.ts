// What a company will cost, said before it starts and while it works (v0.2's spending plan): each preset's cost an hour and
// for a whole job, the job's range for a given org or plan, the live cost an hour, and the budget's thresholds. Pure, with
// no Node APIs: the hub puts the result in the company's view and the browser can work it out for an org it edits.
import type { CompanySettings, PersonView } from './company.ts';
import { type CostedPerson, estimateCompanyCost } from './cost-estimate.ts';
import type { LoadCost } from './loads.ts';
import { type ModelsByLevel, outsideRange, PRESET_IDS, type PresetId, PRESETS } from './presets.ts';
import type { Level } from './studio.ts';

// ---------------------------------------------------------------------------------------------------------------------
// The whole job

/**
 * What a job's range rests on, calibrated on 15 real runs (test/job-calibration.test.ts has the table): the demo company
 * and the benchmark's lean and earlier B runs, three to ten people, two to eleven tasks, all on Sonnet 5.5. They cost
 * $0.40 to $1.40 a task all in (about 4 to 16 minutes of a person's work at the measured rates) and had one to two and a
 * half tasks for each person besides the CEO. The range is meant to hold most such runs, not all: counting the plan's
 * tasks it holds 14 of the 15 (the demo bakery, the dearest a task, runs past the top), and assuming the tasks 14 of the 15 too
 * (an eight-person team that split four tasks falls under the bottom).
 * Those runs predate v0.2's cuts, so a job now should come in lower; the estimate says that rather than guess how much.
 */
export const JOB_BASIS = {
  /** Minutes of one person's work on one task, the low and the high figure. */
  minutesPerTask: { low: 4, high: 14 },
  /** Tasks per person besides the CEO when there is no plan to count them in. */
  tasksPerPerson: { low: 1, high: 2.5 },
  /** How much of the desks at once actually work in parallel: dependencies and waiting take the rest. */
  parallel: { low: 0.85, high: 0.6 },
} as const;

export interface JobEstimate {
  /** API-equivalent dollars for the whole job, the low and the high figure. */
  low: number;
  high: number;
  /** 'plan': counted from the plan's tasks. 'preset': assumed from the preset's typical team, or the proposal's size. */
  basis: 'plan' | 'proposal' | 'preset';
  tasks: { low: number; high: number };
  /** The job's length on the clock. */
  hours: { low: number; high: number };
  /** What the figures are based on and how rough they are, in sentences. */
  lines: string[];
}

export interface JobInput {
  people: readonly CostedPerson[];
  maxDesks: number;
  billing?: 'plan' | 'api-key';
  yourModel?: string | null;
  /** The plan's task count; null when there is no plan yet. */
  tasks: number | null;
  /** Where the people come from, for the sentence that says what the estimate is based on. */
  from: 'proposal' | 'preset' | 'team';
}

const dollars = (n: number): number => Math.round(n * 100) / 100;

function figure(n: number): string {
  if (n >= 10) return `$${Math.round(n)}`;
  if (n >= 1) return `$${n.toFixed(1)}`;
  return `$${Math.max(0.01, n).toFixed(2)}`;
}

/**
 * The whole job as a range, in API-equivalent dollars: the work (tasks times minutes a task, at what a person costs an
 * hour at work), plus the CEO's share over the hours the job takes on the clock. Null when nobody but the CEO is in the org.
 */
export function estimateJob(input: JobInput): JobEstimate | null {
  const est = estimateCompanyCost({ people: input.people }, { maxDesks: input.maxDesks, ...(input.billing ? { billing: input.billing } : {}), ...(input.yourModel !== undefined ? { yourModel: input.yourModel } : {}) });
  const workers = input.people.filter((p) => p.level !== 'ceo').length;
  if (workers === 0) return null;
  const others = est.models.reduce((n, m) => n + m.people, 0);
  const perWorkerHour = est.models.reduce((sum, m) => sum + m.people * m.perPersonHour, 0) / Math.max(1, others);
  const atOnce = Math.max(1, Math.min(est.atOnce, workers));
  const taskCount = input.tasks !== null ? { low: input.tasks, high: input.tasks } : { low: Math.round(workers * JOB_BASIS.tasksPerPerson.low), high: Math.round(workers * JOB_BASIS.tasksPerPerson.high) };
  const at = (tasks: number, minutes: number, efficiency: number) => {
    const workHours = (tasks * minutes) / 60;
    const clock = workHours / (atOnce * efficiency);
    return { cost: est.ceoPerHour * clock + perWorkerHour * workHours, clock };
  };
  const low = at(taskCount.low, JOB_BASIS.minutesPerTask.low, JOB_BASIS.parallel.low);
  const high = at(taskCount.high, JOB_BASIS.minutesPerTask.high, JOB_BASIS.parallel.high);
  const basis: JobEstimate['basis'] = input.tasks !== null ? 'plan' : input.from === 'preset' ? 'preset' : 'proposal';
  const based =
    basis === 'plan'
      ? `from the plan's ${input.tasks} tasks`
      : basis === 'proposal'
        ? `from the proposal's ${workers + 1} people, assuming ${JOB_BASIS.tasksPerPerson.low} to ${JOB_BASIS.tasksPerPerson.high} tasks each`
        : `from the preset's typical team of ${workers + 1} people, assuming ${JOB_BASIS.tasksPerPerson.low} to ${JOB_BASIS.tasksPerPerson.high} tasks each`;
  return {
    low: dollars(low.cost),
    high: dollars(high.cost),
    basis,
    tasks: taskCount,
    hours: { low: Math.round(low.clock * 10) / 10, high: Math.round(high.clock * 10) / 10 },
    lines: [
      `The whole job: about ${figure(low.cost)} to ${figure(high.cost)} at API prices, ${based}.`,
      `That assumes ${JOB_BASIS.minutesPerTask.low} to ${JOB_BASIS.minutesPerTask.high} minutes of work a task, with ${atOnce} working at once, and the hourly rates measured in real runs. It is a rough guide: real jobs vary a lot, and the Spend dashboard shows what the company really spends.`,
      'The figures come from real runs made before v0.2 trimmed what each desk spends, so a job now should come in lower, most likely near the low end.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The presets, with their costs

export interface PresetInfo {
  id: PresetId;
  label: string;
  summary: string;
  team: { min: number; max: number };
  qa: 'folded' | 'separate';
  review: 'folded' | 'separate';
  desks: number;
  models: ModelsByLevel;
  /** The team these figures assume: people in all, the CEO included. */
  typicalTeam: number;
  /** API-equivalent dollars an hour while the company works, for the typical team at this preset's desks and models. */
  perHour: number;
  /** The whole job for the typical team (no plan yet). */
  job: { low: number; high: number };
  /** The job's middle against Balanced's, to one decimal: Lean 0.4, Balanced 1, Thorough 2.5 (the numbers of the day). */
  multiple: number;
}

/** The people an estimate without a proposal assumes for a preset. */
export function typicalPeople(id: PresetId, models: ModelsByLevel = PRESETS[id].models): CostedPerson[] {
  const { heads, workers } = PRESETS[id].typical;
  const people: CostedPerson[] = [{ level: 'ceo', model: models.ceo }];
  for (let i = 0; i < heads; i += 1) people.push({ level: 'head', model: models.head });
  for (let i = 0; i < workers; i += 1) people.push({ level: 'worker', model: models.worker });
  return people;
}

const middle = (j: { low: number; high: number }): number => (j.low + j.high) / 2;

export interface PresetOptions {
  billing?: 'plan' | 'api-key';
  /** What the user's `ANTHROPIC_MODEL` forces on everyone, when set: every person is then priced as that model. */
  modelOverride?: string | null;
}

/** The three presets with what each costs, from the same estimator the proposal uses. */
export function presetInfos(options: PresetOptions = {}): PresetInfo[] {
  const override = options.modelOverride ?? null;
  const estimate = (id: PresetId) => {
    const people = typicalPeople(id).map((p) => (override ? { ...p, model: 'inherit' } : p));
    const common = { ...(options.billing ? { billing: options.billing } : {}), ...(override ? { yourModel: override } : {}) };
    const hour = estimateCompanyCost({ people }, { maxDesks: PRESETS[id].desks, ...common });
    const job = estimateJob({ people, maxDesks: PRESETS[id].desks, tasks: null, from: 'preset', ...common });
    return { hour, job };
  };
  const all = new Map(PRESET_IDS.map((id) => [id, estimate(id)] as const));
  const base = middle(all.get('balanced')?.job ?? { low: 0, high: 0 });
  return PRESET_IDS.map((id): PresetInfo => {
    const p = PRESETS[id];
    const e = all.get(id);
    const job = e?.job ?? { low: 0, high: 0 };
    return {
      id, label: p.label, summary: p.summary, team: { ...p.team }, qa: p.qa, review: p.review, desks: p.desks, models: { ...p.models },
      typicalTeam: 1 + p.typical.heads + p.typical.workers,
      perHour: dollars(e?.hour.perHour ?? 0),
      job: { low: job.low, high: job.high },
      multiple: base > 0 ? Math.round((middle(job) / base) * 10) / 10 : 1,
    };
  });
}

/** The cost multiples as words, for the "How thorough?" question's options: "about 0.4x Balanced's cost". */
export function multipleWords(multiple: number): string {
  if (multiple === 1) return 'the default cost';
  return `about ${multiple}x Balanced's cost`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The live rate

/** The live cost an hour is measured over this long, and no shorter than the floor so one turn is not an hourly rate. */
export const LIVE_WINDOW_MS = 15 * 60_000;
export const LIVE_FLOOR_MS = 5 * 60_000;
const HOUR = 3_600_000;

export interface LiveRate {
  /** API-equivalent dollars an hour over the window; 0 before any turn has ended. */
  perHour: number;
  /** How long the window was, in minutes: shorter for a company that is young. */
  windowMinutes: number;
}

/** The cost an hour over the last LIVE_WINDOW_MS, from the turns that ended in it (a turn is priced when it ends). */
export function liveRate(samples: readonly { at: number; cost: number }[], now: number): LiveRate {
  const first = samples.reduce((at, s) => Math.min(at, s.at), now);
  const window = Math.min(LIVE_WINDOW_MS, Math.max(LIVE_FLOOR_MS, now - first));
  const since = now - window;
  let total = 0;
  for (const s of samples) if (s.at >= since && s.at <= now && Number.isFinite(s.cost) && s.cost > 0) total += s.cost;
  return { perHour: dollars(total / (window / HOUR)), windowMinutes: Math.round(window / 60_000) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The budget

/** A notice at this share of a budget, the hard pause at all of it. */
export const WARN_AT = 0.8;
export const BUDGET_LIMITS = { min: 0.01, max: 1_000_000 } as const;

export type BudgetLevel = 'ok' | 'warning' | 'paused';

/** Where spending stands against a cap, in cents so that $0.1 + $0.2 reaches $0.3. */
export function budgetLevel(spent: number, cap: number): BudgetLevel {
  const s = Math.round(spent * 100);
  const c = Math.round(cap * 100);
  if (s >= c) return 'paused';
  if (s >= c * WARN_AT) return 'warning';
  return 'ok';
}

/** A budget in whole cents, or null when `value` isn't a dollar amount within the limits. */
export function cleanBudget(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < BUDGET_LIMITS.min || value > BUDGET_LIMITS.max) return null;
  return Math.round(value * 100) / 100;
}

export interface PersonBudget {
  person: string;
  spent: number;
  /** spent / cap */
  share: number;
  state: BudgetLevel;
}

export interface BudgetView {
  /** The caps, in dollars; null: none. */
  company: number | null;
  person: number | null;
  /** The company's spend so far (cost plus what transcripts showed of unfinished turns). */
  spent: number;
  /** spent / company cap; null without a cap. */
  share: number | null;
  /** 'off' without a company cap. */
  state: 'off' | BudgetLevel;
  /** Each person with something spent, when a per-person cap is set; the dearest first. Empty without a cap. */
  people: PersonBudget[];
  /** The share at which the office gives its notice. */
  warnAt: number;
}

export function budgetViewOf(settings: Pick<CompanySettings, 'budget'>, spentBy: Readonly<Record<string, number>>): BudgetView {
  const spent = Object.values(spentBy).reduce((n, v) => n + v, 0);
  const { company, person } = settings.budget;
  const people: PersonBudget[] =
    person === null
      ? []
      : Object.entries(spentBy)
          .filter(([, v]) => v > 0)
          .map(([id, v]) => ({ person: id, spent: v, share: v / person, state: budgetLevel(v, person) }))
          .sort((a, b) => b.spent - a.spent || a.person.localeCompare(b.person));
  return { company, person, spent, share: company === null ? null : spent / company, state: company === null ? 'off' : budgetLevel(spent, company), people, warnAt: WARN_AT };
}

// ---------------------------------------------------------------------------------------------------------------------
// The view

/**
 * What the user has installed that a person's desk can be given (src/server/claude-config.ts), for the proposal's
 * multi-select: names and a line each, never a command, address, header or environment value.
 */
export interface InstalledCatalogue {
  mcp: { name: string; summary: string; kind: 'local' | 'remote' }[];
  /** The skills the user wrote themselves. Desks don't load these: `skills: true` gives the project's and Claude Code's own. */
  skills: number;
}

export interface SpendingView {
  preset: PresetId;
  /** All three, with what each costs: the selector's rows. */
  presets: PresetInfo[];
  /** What a person with no model of their own gets, by level: the preset's, as the stakeholder set them. */
  models: Record<Level, string>;
  /** The user's `ANTHROPIC_MODEL`, which runs everyone whatever their model says; null when it isn't set. */
  modelOverride: string | null;
  budget: BudgetView;
  /** The live cost an hour. */
  live: LiveRate;
  /** The whole job; null while there is nobody besides the CEO to estimate. */
  job: JobEstimate | null;
  /** Each proposed person's fixed prompt and what the assignments add (proposalLoadCosts); null once the company runs. */
  loads: { byPerson: Record<string, LoadCost>; tokens: number } | null;
  /** The proposal's size against the preset's range; null when there is no proposal or it is inside. */
  outside: { side: 'under' | 'over'; people: number; min: number; max: number } | null;
  /** The open "How thorough?" question's id, which the office asks first of all; null once answered or withdrawn. */
  presetQuestion: string | null;
  /** The installed catalogue to assign from; only while the company is founding or proposed, null once it has started. */
  catalogue: InstalledCatalogue | null;
}

export interface SpendingInput {
  settings: CompanySettings;
  phase: 'founding' | 'proposed' | 'running' | 'stopped';
  proposal: { people: readonly { id: string; level: Level; model: string }[] } | null;
  /** The running company's people. */
  people: readonly Pick<PersonView, 'id' | 'level' | 'model'>[];
  planTasks: number | null;
  spentBy: Readonly<Record<string, number>>;
  samples: readonly { at: number; cost: number }[];
  now: number;
  modelOverride: string | null;
  presetQuestion: string | null;
  loads: SpendingView['loads'];
  /** The installed catalogue; the view carries it only before the start. */
  catalogue?: InstalledCatalogue | null;
}

export function spendingViewOf(i: SpendingInput): SpendingView {
  const s = i.settings;
  const source: readonly CostedPerson[] | null = i.phase === 'proposed' && i.proposal ? i.proposal.people : i.phase !== 'founding' && i.people.length > 0 ? i.people : null;
  const people = (source ?? typicalPeople(s.preset, s.models as ModelsByLevel)).map((p) => (i.modelOverride ? { level: p.level, model: 'inherit' } : { level: p.level, model: p.model }));
  const job = estimateJob({ people, maxDesks: s.maxDesks, billing: s.billing, ...(i.modelOverride ? { yourModel: i.modelOverride } : {}), tasks: i.planTasks, from: source === null ? 'preset' : 'proposal' });
  const count = i.phase === 'proposed' && i.proposal ? i.proposal.people.length : null;
  const side = count === null ? null : outsideRange(s.preset, count);
  const range = PRESETS[s.preset].team;
  return {
    preset: s.preset,
    presets: presetInfos({ billing: s.billing, modelOverride: i.modelOverride }),
    models: { ...s.models },
    modelOverride: i.modelOverride,
    budget: budgetViewOf(s, i.spentBy),
    live: liveRate(i.samples, i.now),
    job,
    loads: i.loads,
    outside: side && count !== null ? { side, people: count, min: range.min, max: range.max } : null,
    presetQuestion: i.presetQuestion,
    catalogue: (i.phase === 'founding' || i.phase === 'proposed') && i.catalogue ? { mcp: i.catalogue.mcp.map((m) => ({ ...m })), skills: i.catalogue.skills } : null,
  };
}
