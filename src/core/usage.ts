// Token accounting shared by the transcript reader, the reducer and the office.

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  /** Cache writes that live five minutes (1.25x input price) and one hour (2x). */
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

/** Every token the model processed for this work, cache reads included. */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Reads an Anthropic API `usage` object. Cache writes are split by lifetime when the API reports it; otherwise they
 * count as five-minute writes, the API default.
 */
export function usageFromApi(raw: unknown): TokenUsage {
  if (!raw || typeof raw !== 'object') return ZERO_USAGE;
  const u = raw as Record<string, unknown>;
  const write = num(u.cache_creation_input_tokens);
  const split = u.cache_creation && typeof u.cache_creation === 'object' ? (u.cache_creation as Record<string, unknown>) : null;
  const write1h = split ? num(split.ephemeral_1h_input_tokens) : 0;
  const write5m = split ? num(split.ephemeral_5m_input_tokens) : write;
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    // If the split doesn't add up to the total, trust the total and put the difference in the default bucket.
    cacheWrite5m: write5m + Math.max(0, write - write5m - write1h),
    cacheWrite1h: write1h,
  };
}
