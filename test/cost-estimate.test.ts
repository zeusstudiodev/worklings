import { describe, expect, it } from 'vitest';
import { aboutDollars, type CostedPerson, estimateCompanyCost } from '../src/core/cost-estimate.ts';
import { PRICES_AS_OF } from '../src/core/pricing.ts';

/** The real company run of 5 Nov 2026: the CEO on Sonnet, 14 people on Haiku, the desk cap at its default of 8. */
const REAL_RUN: CostedPerson[] = [{ level: 'ceo', model: 'sonnet' }, ...Array.from({ length: 14 }, (_, i) => ({ level: i < 2 ? 'head' : 'worker', model: 'haiku' }))];
/** What its transcripts cost after the start, priced with pricing.ts: $1.41 in 17.4 minutes. */
const MEASURED = { dollars: 1.4101, minutes: 17.42 };

const people = (level: string, model: string, n = 1): CostedPerson[] => Array.from({ length: n }, () => ({ level, model }));

describe('estimateCompanyCost', () => {
  it('gives back what the real company run cost, within a few percent', () => {
    const e = estimateCompanyCost({ people: REAL_RUN });
    const measuredPerHour = MEASURED.dollars / (MEASURED.minutes / 60);
    expect(Math.abs(e.perHour - measuredPerHour) / measuredPerHour).toBeLessThan(0.03);
    expect(e.perHour * (MEASURED.minutes / 60)).toBeCloseTo(MEASURED.dollars, 1);
    expect(e.atOnce).toBe(7);
    expect(e.ceoPerHour).toBeCloseTo(2.6, 1);
    expect(e.models).toEqual([{ model: 'haiku', label: 'Haiku', people: 14, perPersonHour: expect.closeTo(0.316, 2) as number }]);
    expect(e.assumed).toBeNull();
    expect(e.pricesAsOf).toBe(PRICES_AS_OF);
  });

  it('says it in sentences, and plainly that a Pro or Max plan pays in usage limits', () => {
    const e = estimateCompanyCost({ people: REAL_RUN });
    expect(e.lines).toEqual([
      'While it works, this company uses about $4.80 an hour at API prices.',
      "That's the CEO on Sonnet at about $2.60 an hour, and up to seven of the 14 others at once, at $0.32 an hour each on Haiku.",
      "On a Pro or Max plan you pay no per-token bill, but all of this counts against your plan's usage limits, and eight people working at once reach them far sooner than one chat does.",
      'People cost nothing while they have no work, and the Spend dashboard shows what the company really spends.',
    ]);
  });

  it('bills an API key per token, without the plan sentence', () => {
    const e = estimateCompanyCost({ people: REAL_RUN }, { billing: 'api-key' });
    expect(e.billing).toBe('api-key');
    expect(e.lines[0]).toBe('While it works, this company costs about $4.80 an hour, billed per token to your API key.');
    expect(e.lines.join(' ')).not.toContain('Pro or Max');
  });

  it('prices every model from the price list, the dearest first', () => {
    const e = estimateCompanyCost({ people: [...people('ceo', 'opus'), ...people('worker', 'haiku', 3), ...people('worker', 'opus'), ...people('head', 'sonnet', 2)] });
    expect(e.models.map((m) => [m.model, m.people])).toEqual([['opus', 1], ['sonnet', 2], ['haiku', 3]]);
    const [opus, sonnet, haiku] = e.models.map((m) => m.perPersonHour);
    expect(opus).toBeGreaterThan(sonnet ?? Infinity);
    expect(sonnet).toBeGreaterThan(haiku ?? Infinity);
    // Sonnet 5.5's tokens cost 20 times Haiku 5.5's, less where Haiku's long-context rate applies.
    expect((sonnet ?? 0) / (haiku ?? 1)).toBeGreaterThan(10);
    // The CEO on Opus costs twice the CEO on Sonnet, as Opus 5.5's prices are twice Sonnet 5.5's.
    expect(e.ceoPerHour / estimateCompanyCost({ people: people('ceo', 'sonnet') }).ceoPerHour).toBeCloseTo(2, 5);
    expect(e.lines[1]).toBe("That's the CEO on Opus at about $5.20 an hour, and the six others, at $8.60 an hour each on Opus, $4.30 an hour each on Sonnet, $0.32 an hour each on Haiku.");
  });

  it('prices your own model as Sonnet and says so, or as the model you name', () => {
    const own = estimateCompanyCost({ people: [...people('ceo', 'inherit'), ...people('worker', 'inherit', 2)] });
    expect(own.assumed).toBe('sonnet');
    expect(own.models).toEqual([{ model: 'inherit', label: 'your own model', people: 2, perPersonHour: expect.any(Number) as number }]);
    expect(own.lines.at(-1)).toBe('People on your own model are priced as Sonnet.');
    expect(own.lines[1]).toContain('the CEO on your own model');
    const sonnet = estimateCompanyCost({ people: [...people('ceo', 'sonnet'), ...people('worker', 'sonnet', 2)] });
    expect(own.perHour).toBeCloseTo(sonnet.perHour, 6);
    const named = estimateCompanyCost({ people: [...people('ceo', 'inherit'), ...people('worker', 'inherit', 2)] }, { yourModel: 'claude-opus-5-5' });
    expect(named.assumed).toBeNull();
    expect(named.perHour).toBeCloseTo(sonnet.perHour * 2, 6);
  });

  it('prices a model the list does not know as Sonnet, and says so', () => {
    const e = estimateCompanyCost({ people: [...people('ceo', 'sonnet'), ...people('worker', 'gpt-9')] });
    expect(e.assumed).toBe('sonnet');
    expect(e.perHour).toBeCloseTo(estimateCompanyCost({ people: [...people('ceo', 'sonnet'), ...people('worker', 'sonnet')] }).perHour, 6);
  });

  it('counts only as many people at once as the desk cap allows', () => {
    const big = [...people('ceo', 'haiku'), ...people('worker', 'haiku', 20)];
    expect(estimateCompanyCost({ people: big }, { maxDesks: 3 }).atOnce).toBe(2);
    expect(estimateCompanyCost({ people: big }, { maxDesks: 1 }).atOnce).toBe(1);
    expect(estimateCompanyCost({ people: big }, { maxDesks: 0 }).atOnce).toBe(7);
    const four = estimateCompanyCost({ people: big }, { maxDesks: 4 });
    const eight = estimateCompanyCost({ people: big }, { maxDesks: 8 });
    expect(eight.perHour - eight.ceoPerHour).toBeCloseTo(((four.perHour - four.ceoPerHour) / 3) * 7, 6);
    expect(four.lines[2]).toContain('four people working at once');
    const small = estimateCompanyCost({ people: [...people('ceo', 'haiku'), ...people('worker', 'haiku', 2)] });
    expect(small.atOnce).toBe(2);
    expect(small.lines[1]).toContain('and the two others, at');
  });

  it('does not add the CEO and a second person when the desk cap is one', () => {
    const mixed = [...people('ceo', 'sonnet'), ...people('worker', 'haiku', 5)];
    const one = estimateCompanyCost({ people: mixed }, { maxDesks: 1 });
    const two = estimateCompanyCost({ people: mixed }, { maxDesks: 2 });
    // One desk in all: an hour costs the dearer of the CEO and a worker, not both.
    expect(one.perHour).toBeCloseTo(Math.max(one.ceoPerHour, two.perHour - two.ceoPerHour), 6);
    expect(one.perHour).toBeLessThan(two.perHour);
    expect(one.lines[1]).toContain('take turns with the CEO at the one desk');
  });

  it('works for an org without a CEO, and for nobody at all', () => {
    const headless = estimateCompanyCost({ people: people('worker', 'haiku', 3) }, { maxDesks: 2 });
    expect(headless.ceoPerHour).toBe(0);
    expect(headless.atOnce).toBe(2);
    expect(headless.lines[1]).toBe("That's up to two of the three others at once, at $0.32 an hour each on Haiku.");
    const nobody = estimateCompanyCost({ people: [] });
    expect(nobody.perHour).toBe(0);
    expect(nobody.lines[0]).toBe('While it works, this company uses about $0 an hour at API prices.');
  });

  it('rounds dollars to two figures', () => {
    expect([aboutDollars(4.81), aboutDollars(2.597), aboutDollars(0.316), aboutDollars(12.4), aboutDollars(0.001), aboutDollars(0), aboutDollars(Number.NaN)]).toEqual([
      '$4.80', '$2.60', '$0.32', '$12', '$0.01', '$0', '$0',
    ]);
  });
});
