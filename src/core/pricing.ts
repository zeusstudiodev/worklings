// API-equivalent cost of the tokens Claude Code used. Subscribers don't pay per token, so the office labels these
// figures as what the same work would cost on the Claude API; OpenTelemetry's cost_usd replaces them when enabled.
import type { TokenUsage } from './usage.ts';

interface Rate {
  /** Dollars per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
}

interface ModelPrice {
  base: Rate;
  /** Fast mode (usage.speed === "fast"), where the API offers it. */
  fast?: Rate;
  /** Higher rate for requests whose prompt exceeds `above` tokens. */
  long?: { above: number; rate: Rate };
}

const rate = (input: number, output: number, cacheRead = input / 10): Rate => ({ input, output, cacheRead });

/**
 * Anthropic list prices per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing as checked
 * on PRICES_AS_OF. Cache writes cost 1.25x input for five-minute entries and 2x for one-hour entries on every model;
 * cache reads are 0.1x except where a model lists its own rate (0.05x on Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.1).
 * Update this table when prices change; `PRICES_AS_OF` is shown next to every estimate.
 */
export const PRICES_AS_OF = '2026-11-04';

/** US-only inference (`inference_geo: "us"`) costs 1.1x on Claude 4.6 and later. */
const US_GEO = 1.1;

const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { base: rate(10, 50, 0.25) },
  'claude-mythos-5-1': { base: rate(10, 50, 0.25) },
  'claude-fable-5': { base: rate(10, 50) },
  'claude-mythos-5': { base: rate(10, 50) },
  'claude-opus-5-5': { base: rate(4, 20, 0.2), fast: rate(8, 40, 0.4) },
  'claude-opus-5': { base: rate(5, 25), fast: rate(10, 50) },
  'claude-opus-4-8': { base: rate(5, 25), fast: rate(10, 50) },
  'claude-opus-4-7': { base: rate(5, 25) },
  'claude-opus-4-6': { base: rate(5, 25) },
  'claude-opus-4-5': { base: rate(5, 25) },
  'claude-opus-4-1': { base: rate(15, 75) },
  'claude-opus-4': { base: rate(15, 75) },
  'claude-sonnet-5-5': { base: rate(2, 10, 0.1) },
  'claude-sonnet-5': { base: rate(2, 10) },
  'claude-sonnet-4-6': { base: rate(3, 15) },
  'claude-sonnet-4-5': { base: rate(3, 15) },
  'claude-sonnet-4': { base: rate(3, 15) },
  'claude-haiku-5-5': { base: rate(0.1, 0.5), long: { above: 100_000, rate: rate(0.5, 2.5) } },
  'claude-haiku-4-5': { base: rate(1, 5) },
  'claude-3-5-haiku': { base: rate(0.8, 4) },
};

/** "claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5"; "us.anthropic.claude-opus-4-8" -> "claude-opus-4-8". */
export function canonicalModel(model: string): string {
  // Bedrock's version suffix comes last ("...-20250929-v1:0"), so it goes before the date.
  return model.toLowerCase().replace(/^.*?(claude-)/, '$1').replace(/-v\d+(:\d+)?$/, '').replace(/[@-]\d{8}$/, '');
}

/** The price table's entry, looked up so that a model named "constructor" is simply unknown. */
function priceOf(model: string): ModelPrice | undefined {
  const id = canonicalModel(model);
  return Object.hasOwn(PRICES, id) ? PRICES[id] : undefined;
}

export function knownModel(model: string): boolean {
  return priceOf(model) !== undefined;
}

/** Cost in dollars of one API request's usage, or null for a model the table doesn't know. */
export function costOf(model: string, usage: TokenUsage, options: { fast?: boolean; usOnly?: boolean } = {}): number | null {
  const price = priceOf(model);
  if (!price) return null;
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h;
  let r = price.base;
  if (options.fast && price.fast) r = price.fast;
  else if (price.long && prompt > price.long.above) r = price.long.rate;
  const dollars =
    usage.input * r.input +
    usage.output * r.output +
    usage.cacheRead * r.cacheRead +
    usage.cacheWrite5m * r.input * 1.25 +
    usage.cacheWrite1h * r.input * 2;
  return (dollars / 1_000_000) * (options.usOnly ? US_GEO : 1);
}

/** Short display name for a model id: "claude-opus-5-5" -> "Opus 5.5". */
export function modelLabel(model: string): string {
  const id = canonicalModel(model);
  const m = /^claude-(?:(\d)-(\d)-)?([a-z]+)(?:-(\d+)(?:-(\d+))?)?$/.exec(id);
  if (!m) return model;
  const family = (m[3] ?? '').charAt(0).toUpperCase() + (m[3] ?? '').slice(1);
  const version = m[4] ? (m[5] ? `${m[4]}.${m[5]}` : m[4]) : m[1] ? `${m[1]}.${m[2]}` : '';
  return version ? `${family} ${version}` : family;
}
