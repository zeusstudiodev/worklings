// What the spending plan says (v0.2; SPEC-v0.2.md, "the maintainer's decisions"): the presets' words, the budget's figures and
// the words for what a person's desk loads. Pure, so each sentence is tested without a page. The numbers come from the
// hub's `CompanyView.spending` (src/core/spending.ts); this file only phrases them.
import { aboutDollars } from '../../../../src/core/cost-estimate.ts';
import { defaultLoads, type Loads, type LoadCost, type ResolvedLoads, resolveLoads, sameLoads } from '../../../../src/core/loads.ts';
import type { ProposedPerson } from '../../../../src/core/org.ts';
import { DEFAULT_PRESET, type PresetId } from '../../../../src/core/presets.ts';
import { BUDGET_LIMITS, type BudgetView, cleanBudget, type PresetInfo, type SpendingView } from '../../../../src/core/spending.ts';
import type { Level, RoleModel } from '../../../../src/core/studio.ts';
import type { Size } from '../../../../src/core/size.ts';
import { SIZE_RULES } from '../../../../src/core/size.ts';
import { dollars, percent } from '../../lib/format.ts';
import { MODEL_NAMES } from '../proposal/model.ts';

/** How a level is named on the model selects and in the sentences about models. */
export const LEVEL_NAMES: Record<Level, { label: string; plural: string }> = {
  ceo: { label: 'CEO', plural: 'the CEO' },
  head: { label: 'Heads', plural: 'heads' },
  lead: { label: 'Leads', plural: 'leads' },
  worker: { label: 'Workers', plural: 'workers' },
};

export const modelName = (model: string): string => (Object.hasOwn(MODEL_NAMES, model) ? MODEL_NAMES[model as RoleModel] : model);

// ---------------------------------------------------------------------------------------------------------------
// The presets

/** "$30 to $90": a range of dollars at the precision an estimate has. */
export const rangeWords = (low: number, high: number): string => `${aboutDollars(low)} to ${aboutDollars(high)}`;

/**
 * Which model each level runs on, as a sentence: "The CEO on Opus, everyone else on Sonnet." Levels that share a model
 * are said together, and the group with the workers is "everyone else".
 */
export function modelsSentence(models: Record<Level, string>): string {
  const order: Level[] = ['ceo', 'head', 'lead', 'worker'];
  const groups = new Map<string, Level[]>();
  for (const level of order) groups.set(models[level], [...(groups.get(models[level]) ?? []), level]);
  if (groups.size === 1) return `Everyone on ${modelName(models.worker)}.`;
  const rest = models.worker;
  const parts: string[] = [];
  for (const [model, levels] of groups) {
    if (model === rest && levels.length > 1) continue;
    const names = levels.map((l) => LEVEL_NAMES[l].plural);
    const said = names.length === 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
    parts.push(`${said} on ${modelName(model)}`);
  }
  const restLevels = groups.get(rest) ?? [];
  const everyone = restLevels.length > 1 ? `everyone else on ${modelName(rest)}` : null;
  const all = everyone ? [...parts, everyone] : parts;
  const sentence = all.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** What a model change did: "The CEO runs on Opus.", "Heads run on Sonnet." */
export const modelChangedLine = (level: Level, model: string): string => (level === 'ceo' ? `The CEO runs on ${modelName(model)}.` : `${LEVEL_NAMES[level].label} run on ${modelName(model)}.`);

/** The facts under a preset's name, each a label with its value: what a person compares presets by. */
export function presetFacts(info: PresetInfo, compact = false): { label: string; value: string }[] {
  const all = [
    { label: 'People', value: `${info.team.min} to ${info.team.max}` },
    { label: 'At work at once', value: String(info.desks), more: true },
    { label: 'Models', value: modelsSentence(info.models).replace(/\.$/, ''), more: true },
    { label: 'Cost while it works', value: `about ${aboutDollars(info.perHour)} an hour` },
    { label: 'Whole job', value: `about ${rangeWords(info.job.low, info.job.high)}` },
  ];
  return all.filter((f) => !compact || !('more' in f)).map(({ label, value }) => ({ label, value }));
}

export const isDefaultPreset = (id: PresetId): boolean => id === DEFAULT_PRESET;

/** The proposal's size against the preset's range, in a sentence; null inside it. */
export function outsideSentence(outside: NonNullable<SpendingView['outside']>, label: string): string {
  const people = `${outside.people} ${outside.people === 1 ? 'person' : 'people'}`;
  return outside.side === 'under'
    ? `The proposal has ${people}, fewer than the ${outside.min} to ${outside.max} that ${label} sizes to. The CEO says why in the summary above; ask it to resize if you want it to fit.`
    : `The proposal has ${people}, more than the ${outside.min} to ${outside.max} that ${label} sizes to. The CEO says why in the summary above; ask it to resize if you want it to fit.`;
}

/** What the preset change did, for the line under the selector and the live region. */
export function presetChangedLine(label: string, phase: 'founding' | 'proposed' | 'running' | 'stopped', scopingWaits: boolean): string {
  if (phase === 'proposed') return `${label} is set. The CEO is revising the proposal to fit it.`;
  return scopingWaits ? `${label} is set. The CEO hears it with your answers.` : `${label} is set. The CEO sizes its draft to it.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The budget

/** "$20", "$4.50", "$1,200": a cap as a person typed it. */
export const capWords = (cap: number): string => (Number.isInteger(cap) ? `$${cap.toLocaleString('en-US')}` : `$${cap.toFixed(2)}`);

export type DollarsInput = { ok: true; value: number | null } | { ok: false; message: string };

/** The sentence a budget field gives when its text isn't an amount the office takes. */
export const BUDGET_MESSAGE = `Enter an amount from ${capWords(BUDGET_LIMITS.min)} to ${capWords(BUDGET_LIMITS.max)}, to the cent, or leave it empty for no budget.`;

/**
 * A budget field's text as dollars: "$20", "1,200" and "4.5" are amounts, an empty field is no budget. Anything else
 * isn't, and says so in the field's words (the office checks the same limits and answers with its own sentence).
 */
export function parseDollars(text: string): DollarsInput {
  const clean = text.trim().replace(/^\$\s*/, '').replace(/,/g, '');
  if (clean === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return { ok: false, message: BUDGET_MESSAGE };
  const value = cleanBudget(Number(clean));
  return value === null ? { ok: false, message: BUDGET_MESSAGE } : { ok: true, value };
}

/** A cap as the field holds it: "20", "4.50"; empty for none. */
export const capField = (cap: number | null): string => (cap === null ? '' : Number.isInteger(cap) ? String(cap) : cap.toFixed(2));

export interface BudgetFigure {
  /** "$4.20 of $20". */
  text: string;
  state: BudgetView['state'];
  /** 0 to 1: how much of the cap is spent. */
  share: number;
  /** What the figure means, for a screen reader and the tooltip: "80% of the company budget is spent." */
  words: string;
}

/** The company's spend against its budget; null when it has none. */
export function budgetFigure(budget: BudgetView): BudgetFigure | null {
  if (budget.company === null || budget.state === 'off') return null;
  const share = Math.min(1, Math.max(0, budget.share ?? 0));
  const state = budget.state;
  const lead = state === 'paused' ? 'The company budget is spent' : state === 'warning' ? `The company has spent ${percent(share)} of its budget` : `${percent(share)} of the company budget is spent`;
  return { text: `${dollars(budget.spent)} of ${capWords(budget.company)}`, state, share, words: `${lead}${state === 'paused' ? ', so work is paused' : ''}.` };
}

/** "$40", "$4.20": whole dollars (rounded down) from ten up, cents below, for the bar's compact meter. */
export const compactDollars = (n: number): string => (n >= 10 ? `$${Math.floor(n).toLocaleString('en-US')}` : dollars(n));

/** The company bar's one money figure (v0.2): short on the bar, the whole story in its name and tooltip. */
export interface BarMeter {
  /** "$40 of $60", or "$4.20" without a budget. */
  text: string;
  /** How much of the budget is spent, for the bar under it; null without a budget. */
  share: number | null;
  state: BudgetFigure['state'] | null;
  /** For a screen reader: "$40.27 of the $60 budget spent, API-equivalent". */
  name: string;
  /** The tooltip: the budget's sentence and what the money means ("API-equivalent: what the same tokens would cost…"). */
  title: string;
}

export function barMeter(spent: number, budget: BudgetView | undefined, money: { label: 'Spend' | 'API-equivalent'; title: string }): BarMeter {
  const kind = money.label === 'API-equivalent' ? ', API-equivalent' : '';
  const means = `${money.label === 'API-equivalent' ? 'API-equivalent: ' : ''}${money.title}`;
  const figure = budget ? budgetFigure(budget) : null;
  if (budget && figure && budget.company !== null) {
    return { text: `${compactDollars(budget.spent)} of ${capWords(budget.company)}`, share: figure.share, state: figure.state, name: `${dollars(budget.spent)} of the ${capWords(budget.company)} budget spent${kind}`, title: `${figure.words} ${means}` };
  }
  return { text: compactDollars(spent), share: null, state: null, name: `${dollars(spent)} spent, no budget${kind}`, title: means };
}

/** The phone's spend line: "$4.20 of $20 spent, API-equivalent." with the budget, "$4.20 spent, API-equivalent." without. */
export function spendWithBudget(spent: number, budget: BudgetView | undefined, plan: boolean): string {
  const tail = plan ? ', API-equivalent' : '';
  if (!budget || budget.company === null) return `${dollars(spent)} spent${tail}.`;
  return `${dollars(budget.spent)} of ${capWords(budget.company)} spent${tail}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// What a desk loads

/** "13.6k", "13k", "980": a token count the way the proposal says it. */
export function tokensShort(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const k = Math.round(n / 100) / 10;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

/** "about 13.6k tokens before any work", with "(partly estimated)" when any part is a guess. */
export const fixedPromptLine = (cost: Pick<LoadCost, 'tokens' | 'measured'>): string =>
  `about ${tokensShort(cost.tokens)} tokens before any work${cost.measured ? '' : ' (partly estimated)'}`;

/** What a person's loads are, every part filled from their level's defaults. */
export const loadsOf = (person: Pick<ProposedPerson, 'loads' | 'level'>): ResolvedLoads => resolveLoads(person.loads, person.level);

/**
 * The loads to write into the proposal: only the parts that differ from the level's defaults, so a person who loads
 * nothing special carries no `loads` at all. Undefined when everything is the default.
 */
export function loadsToWrite(loads: ResolvedLoads, level: Level): Loads | undefined {
  const base = defaultLoads(level);
  const out: Loads = {};
  if (loads.tools.join() !== base.tools.join()) out.tools = [...loads.tools];
  if (loads.skills !== base.skills) out.skills = loads.skills;
  if (loads.mcp.length > 0) out.mcp = [...loads.mcp];
  return Object.keys(out).length === 0 ? undefined : out;
}

export const sameResolved = (a: ResolvedLoads, b: ResolvedLoads): boolean => sameLoads(a, b);

/** Every MCP server named in the proposal: all the view has of the user's catalogue (see the note in SpendingPlan). */
export function mcpNamed(people: readonly Pick<ProposedPerson, 'loads'>[]): string[] {
  return [...new Set(people.flatMap((p) => p.loads?.mcp ?? []))].sort((a, b) => a.localeCompare(b));
}

/** "Tools: Read, Bash. Skills on. MCP: github." for a person whose loads differ from the defaults; null when they don't. */
export function loadsSummary(person: Pick<ProposedPerson, 'loads' | 'level'>): string | null {
  const now = loadsOf(person);
  const base = defaultLoads(person.level);
  const parts: string[] = [];
  if (now.tools.join() !== base.tools.join()) parts.push(`tools ${now.tools.length === 0 ? 'none' : now.tools.join(', ')}`);
  if (now.skills !== base.skills) parts.push(now.skills ? 'skills on' : 'skills off');
  if (now.mcp.length > 0) parts.push(`MCP ${now.mcp.join(', ')}`);
  if (parts.length === 0) return null;
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** The size the CEO chose, in everyday words: "A large company: the CEO and 5 or more makers, with heads only when more than 6 makers need briefing." */
export const sizeWords = (size: Size | undefined): string | null => {
  if (!size || !Object.hasOwn(SIZE_RULES, size)) return null;
  return `A ${size} company: ${SIZE_RULES[size].summary}.`;
};
