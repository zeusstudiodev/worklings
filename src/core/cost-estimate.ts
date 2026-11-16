// What a company costs while it works, said before its first start: API-equivalent dollars an hour, priced from the
// org's models with pricing.ts against the requests real people made. The figures come from the full real company run
// of 5 Nov 2026 on Claude Code 2.1.312 (.claude/runs/v3/progress.md): 15 people, the CEO on Sonnet 5.5 and 14 on
// Haiku 5.5, whose transcripts, priced with costOf, came to $1.41 in the 17.4 minutes after the start ($4.86 an hour)
// and $1.80 with the CEO's draft before it. Pure, with no Node APIs: the hub puts it in the company's view, and the
// browser can work it out for an org it edits.
import { countWord } from './now.ts';
import { costOf, knownModel, modelLabel, PRICES_AS_OF } from './pricing.ts';
import type { TokenUsage } from './usage.ts';

/** The desk cap a company starts with (DEFAULT_MAX_DESKS in company.ts, which imports this file's types). */
const STARTING_DESKS = 8;

/** Claude Code 2.1.312's model aliases, as its desks resolved them in the real runs (their transcripts name the model). */
const ALIASES: Readonly<Record<string, string>> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
/** What `inherit`, or a model the price table doesn't know, is priced as. */
const ASSUMED = 'sonnet';

/** A request: how many of them an hour, and the tokens one of them uses. */
interface Requests {
  perHour: number;
  request: TokenUsage;
}

/**
 * The CEO after the start, per hour of the company's time with its idle stretches: 21 requests in 17.4 minutes, each
 * rereading its whole context (about 80k tokens) from the cache and writing a little to it, with a short answer.
 */
const CEO_HOUR: readonly Requests[] = [{ perHour: 72.4, request: { input: 2, output: 537, cacheRead: 79_801, cacheWrite5m: 0, cacheWrite1h: 5_637 } }];

/**
 * Anyone else, per hour at work, their subagents included: 165 requests over 2.08 hours of 11 people. About one in
 * eight carried more than 100k tokens of context, where Haiku 5.5 charges its higher rate, so they are kept apart:
 * costOf prices a request by its own size.
 */
const WORK_HOUR: readonly Requests[] = [
  { perHour: 68.9, request: { input: 2, output: 2_667, cacheRead: 54_528, cacheWrite5m: 853, cacheWrite1h: 6_036 } },
  { perHour: 10.6, request: { input: 2, output: 750, cacheRead: 106_189, cacheWrite5m: 0, cacheWrite1h: 1_887 } },
];

/** Someone in the org, as a proposal or a running company's view has them. */
export interface CostedPerson {
  level: string;
  /** An alias (`haiku`, `sonnet`, `opus`), `inherit` for the person's own model, or a model id. */
  model: string;
}

export interface EstimateOptions {
  /** At most this many people work at once: the company's desk cap (8 when not given). */
  maxDesks?: number;
  /** 'plan': the person's own Claude plan (the default). 'api-key': their Claude Code bills per token. */
  billing?: 'plan' | 'api-key';
  /** What `inherit` runs on (an alias or a model id), when known. Priced as Sonnet otherwise, and the estimate says so. */
  yourModel?: string | null;
}

/** One model the org uses, besides the CEO's seat: how many people run on it and what one of them costs an hour at work. */
export interface ModelRate {
  /** As the org names it: an alias, `inherit` or a model id. */
  model: string;
  /** "Haiku", "your own model", "Sonnet 5.5". */
  label: string;
  people: number;
  perPersonHour: number;
}

export interface CostEstimate {
  /** API-equivalent dollars an hour while the company works: the CEO, plus the others as many at once as the cap allows. */
  perHour: number;
  /** The CEO's share of perHour; 0 when the org has no CEO. */
  ceoPerHour: number;
  /** How many people besides the CEO work at once, at most. */
  atOnce: number;
  /** The models of everyone but the CEO, the dearest first. */
  models: ModelRate[];
  billing: 'plan' | 'api-key';
  /** The model someone was priced as because theirs isn't known (your own model, say); null when none was. */
  assumed: string | null;
  /** What the office says before the first start, in sentences. */
  lines: string[];
  /** The price list the figures come from (pricing.ts). */
  pricesAsOf: string;
}

/** The model a person is priced as, and whether it had to be assumed. */
function pricedAs(model: string, yours: string | null): { id: string; assumed: boolean } {
  const named = model.trim().toLowerCase();
  if (named === 'inherit') return yours ? pricedAs(yours, null) : { id: ALIASES[ASSUMED] ?? '', assumed: true };
  if (Object.hasOwn(ALIASES, named)) return { id: ALIASES[named] ?? '', assumed: false };
  if (knownModel(named)) return { id: named, assumed: false };
  return { id: ALIASES[ASSUMED] ?? '', assumed: true };
}

const rateOf = (id: string, hour: readonly Requests[]): number => hour.reduce((sum, r) => sum + r.perHour * (costOf(id, r.request) ?? 0), 0);

/** "Haiku", "your own model", or a full id's short name ("Sonnet 5.5"). */
function labelOf(model: string): string {
  const named = model.trim().toLowerCase();
  if (named === 'inherit') return 'your own model';
  if (Object.hasOwn(ALIASES, named)) return named.charAt(0).toUpperCase() + named.slice(1);
  return modelLabel(model);
}

/** "$4.80", "$0.32", "$12": two figures are as precise as an estimate is. */
export function aboutDollars(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 10) return `$${Math.round(n)}`;
  if (n >= 1) return `$${(Math.round(n * 10) / 10).toFixed(2)}`;
  return `$${Math.max(0.01, n).toFixed(2)}`;
}

/** "Sonnet" after "on": "on your own model", "on Sonnet 5.5". */
const on = (label: string) => `on ${label}`;

function lines(e: Omit<CostEstimate, 'lines' | 'pricesAsOf'>, ceoLabel: string | null, others: number, cap: number): string[] {
  const out: string[] = [];
  const total = aboutDollars(e.perHour);
  out.push(
    e.billing === 'api-key'
      ? `While it works, this company costs about ${total} an hour, billed per token to your API key.`
      : `While it works, this company uses about ${total} an hour at API prices.`,
  );
  const parts: string[] = [];
  if (ceoLabel !== null) parts.push(`the CEO ${on(ceoLabel)} at about ${aboutDollars(e.ceoPerHour)} an hour`);
  if (others > 0) {
    const rates = e.models.map((m) => `${aboutDollars(m.perPersonHour)} an hour each ${on(m.label)}`).join(', ');
    const who = cap <= 1 && ceoLabel !== null ? `the ${countWord(others)} ${others === 1 ? 'other' : 'others'}, who take turns with the CEO at the one desk` : others === e.atOnce ? (others === 1 ? 'the one other person' : `the ${countWord(others)} others`) : `up to ${countWord(e.atOnce)} of the ${countWord(others)} others at once`;
    parts.push(`${who}, at ${rates}`);
  }
  if (parts.length > 0) out.push(`That's ${parts.join(', and ')}.`);
  if (e.billing === 'plan') {
    out.push(
      `On a Pro or Max plan you pay no per-token bill, but all of this counts against your plan's usage limits, and ${countWord(Math.min(cap, others + (ceoLabel === null ? 0 : 1)))} people working at once reach them far sooner than one chat does.`,
    );
  }
  out.push("People cost nothing while they have no work, and the Spend dashboard shows what the company really spends.");
  if (e.assumed) out.push(`People on your own model are priced as ${labelOf(e.assumed)}.`);
  return out;
}

/**
 * What the org costs an hour while it works, at API prices from pricing.ts: the CEO at the rate measured over the
 * company's time (it works in bursts), and everyone else at the rate of an hour at work, as many at once as the desk
 * cap leaves beside the CEO. Idle people cost nothing, so this is the rate of a busy hour, not of a day.
 */
export function estimateCompanyCost(org: { people: readonly CostedPerson[] }, options: EstimateOptions = {}): CostEstimate {
  const cap = Number.isInteger(options.maxDesks) && (options.maxDesks ?? 0) >= 1 ? (options.maxDesks as number) : STARTING_DESKS;
  const billing = options.billing === 'api-key' ? 'api-key' : 'plan';
  const yours = typeof options.yourModel === 'string' && options.yourModel.trim() !== '' ? options.yourModel : null;
  const ceo = org.people.find((p) => p.level === 'ceo') ?? null;
  const others = org.people.filter((p) => p !== ceo);
  let assumed = false;

  let ceoPerHour = 0;
  if (ceo) {
    const priced = pricedAs(ceo.model, yours);
    assumed ||= priced.assumed;
    ceoPerHour = rateOf(priced.id, CEO_HOUR);
  }

  const byModel = new Map<string, ModelRate>();
  let othersSum = 0;
  for (const person of others) {
    const priced = pricedAs(person.model, yours);
    assumed ||= priced.assumed;
    const rate = rateOf(priced.id, WORK_HOUR);
    othersSum += rate;
    const key = person.model.trim().toLowerCase();
    const row = byModel.get(key) ?? { model: key, label: labelOf(person.model), people: 0, perPersonHour: rate };
    row.people += 1;
    byModel.set(key, row);
  }
  // With one desk in all, the CEO and the others take turns at it: an hour costs the dearer of the two, never both.
  const sharedDesk = cap <= 1 && ceo !== null && others.length > 0;
  const atOnce = Math.min(others.length, Math.max(1, cap - (ceo ? 1 : 0)));
  const othersAverage = others.length === 0 ? 0 : othersSum / others.length;
  const othersPerHour = othersAverage * atOnce;
  const models = [...byModel.values()].sort((a, b) => b.perPersonHour - a.perPersonHour || b.people - a.people);
  const base = { perHour: sharedDesk ? Math.max(ceoPerHour, othersAverage) : ceoPerHour + othersPerHour, ceoPerHour, atOnce, models, billing, assumed: assumed ? ASSUMED : null } as const;
  return { ...base, lines: lines(base, ceo ? labelOf(ceo.model) : null, others.length, cap), pricesAsOf: PRICES_AS_OF };
}
