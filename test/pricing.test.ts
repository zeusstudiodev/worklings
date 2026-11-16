import { describe, expect, it } from 'vitest';
import { canonicalModel, costOf, knownModel, modelLabel } from '../src/core/pricing.ts';
import { newCursor, readUsage } from '../src/core/transcript.ts';
import { ZERO_USAGE } from '../src/core/usage.ts';
import { SESSION, SUBAGENT, transcript } from './fixtures.ts';

describe('costOf', () => {
  it("reproduces Claude Code's own cost for the captured run to the nano-dollar", () => {
    const events = [
      ...readUsage(transcript('main'), newCursor(), { sessionId: SESSION, fallbackTime: 0 }),
      ...readUsage(transcript('subagent'), newCursor(), { sessionId: SESSION, agentId: SUBAGENT, agentType: 'reviewer', fallbackTime: 0 }),
    ];
    let total = 0;
    for (const e of events) if (e.kind === 'usage') total += costOf(e.model, e.usage) ?? NaN;
    // `claude -p --output-format json` reported total_cost_usd 0.012947045 for this run.
    expect(total).toBeCloseTo(0.012947045, 9);
  });

  it("matches Claude Code's cost for a live run with a Sonnet 5.5 subagent (cache reads at 0.05x)", () => {
    const u = (input: number, output: number, cacheRead: number, w5: number, w1: number) => ({ input, output, cacheRead, cacheWrite5m: w5, cacheWrite1h: w1 });
    const total =
      (costOf('claude-haiku-5-5', u(2, 301, 16_829, 0, 28_218)) ?? NaN) +
      (costOf('claude-haiku-5-5', u(2, 84, 45_047, 0, 2_175)) ?? NaN) +
      (costOf('claude-sonnet-5-5', u(2, 85, 0, 9_155, 0)) ?? NaN) +
      (costOf('claude-sonnet-5-5', u(2, 188, 9_155, 879, 0)) ?? NaN);
    // `claude -p --output-format json` reported total_cost_usd 0.035628759999999995 for this session (2026-11-04).
    expect(total).toBeCloseTo(0.03562876, 9);
  });

  it('adds the 1.1x US-only inference premium', () => {
    const usage = { ...ZERO_USAGE, output: 1_000_000 };
    expect(costOf('claude-sonnet-5-5', usage, { usOnly: true })).toBeCloseTo(11, 9);
  });

  it('uses the long-prompt rate for Haiku 5.5 above 100K prompt tokens', () => {
    const small = costOf('claude-haiku-5-5', { ...ZERO_USAGE, input: 1_000_000 });
    const large = costOf('claude-haiku-5-5', { ...ZERO_USAGE, input: 50_000, cacheRead: 60_000, output: 0 });
    expect(small).toBeCloseTo(0.5, 9); // above 100K the whole request is priced at $0.50 input
    expect(large).toBeCloseTo((50_000 * 0.5 + 60_000 * 0.05) / 1e6, 9);
  });

  it('prices Opus 5.5 cache reads at $0.20 and fast mode at double', () => {
    expect(costOf('claude-opus-5-5', { ...ZERO_USAGE, cacheRead: 1_000_000 })).toBeCloseTo(0.2, 9);
    expect(costOf('claude-opus-5-5', { ...ZERO_USAGE, output: 1_000_000 }, { fast: true })).toBeCloseTo(40, 9);
  });

  it('returns null for models it does not know', () => {
    expect(costOf('gpt-9', { ...ZERO_USAGE, input: 10 })).toBeNull();
    expect(knownModel('<synthetic>')).toBe(false);
  });
});

describe('model names', () => {
  it('strips dates and provider prefixes', () => {
    expect(canonicalModel('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(canonicalModel('us.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(canonicalModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('claude-sonnet-4-5');
    expect(knownModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
    expect(knownModel('constructor')).toBe(false);
    expect(knownModel('__proto__')).toBe(false);
    expect(canonicalModel('claude-opus-4-5@20251101')).toBe('claude-opus-4-5');
  });

  it('labels models the way people say them', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-fable-5')).toBe('Fable 5');
    expect(modelLabel('claude-3-5-haiku')).toBe('Haiku 3.5');
  });
});
