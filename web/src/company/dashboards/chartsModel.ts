// The arithmetic and the words behind every chart on the Dashboards tab (docs/design-v3.md, the widget table): clean
// ticks, bar extents from one baseline, a line's points, and the sentence a line has beside it, since a chart is never
// the only way to read a value. Pure, so the tests read what the tab shows.

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A number as the office writes it: grouped thousands, two decimals at most ("1,284", "4.5", "-3"). */
export const formatNumber = (n: number): string => NUMBER.format(n);

/** A value with its unit: "12 days", "42%", "21 orders"; without a unit, the figure alone. */
export function withUnit(value: string, unit: string | undefined): string {
  if (!unit) return value;
  return /^[%‰]/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

/** Multiples a clean step is made of, at every power of ten. Whole-number data never steps by 2.5. */
const STEPS = [1, 2, 2.5, 5, 10];
const WHOLE_STEPS = [1, 2, 5, 10];

function cleanStep(raw: number, whole: boolean): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ((whole ? WHOLE_STEPS : STEPS).find((m) => m * power >= raw - 1e-12) ?? 10) * power;
  return whole ? Math.max(1, step) : step;
}

/** A tick as it should read: the float noise of adding steps rounded away. */
const tidy = (value: number, step: number) => Number(value.toFixed(Math.max(0, 1 - Math.floor(Math.log10(step)))));

/**
 * Three to five evenly spaced, clean ticks from at or below `lo` to at or above `hi` (the design's "3 to 5 ticks").
 * `whole`: the values are whole numbers (counts), so the ticks are too. An empty range opens to [lo, lo + 1].
 */
export function niceTicks(lo: number, hi: number, whole = false): number[] {
  const low = Number.isFinite(lo) ? lo : 0;
  const high = Number.isFinite(hi) && hi > low ? hi : low + 1;
  for (const intervals of [4, 3, 5, 2]) {
    const step = cleanStep((high - low) / intervals, whole);
    const first = Math.floor(low / step + 1e-9) * step;
    const last = Math.ceil(high / step - 1e-9) * step;
    const count = Math.round((last - first) / step) + 1;
    if (count >= 3 && count <= 5) return Array.from({ length: count }, (_, i) => tidy(first + i * step, step));
  }
  const step = cleanStep((high - low) / 2, whole);
  const first = Math.floor(low / step + 1e-9) * step;
  return [0, 1, 2].map((i) => tidy(first + i * step, step));
}

/**
 * Ticks for money, in dollars, that fall on whole cents: a young company's two cents read $0, $0.01, $0.02 rather
 * than half cents that round to "$0.01" three times.
 */
export function centTicks(lo: number, hi: number): number[] {
  return niceTicks(lo * 100, hi * 100, true).map((cents) => cents / 100);
}

/** A money tick: "$0", "$2", "$0.50". */
export const moneyTick = (n: number): string => (n === 0 ? '$0' : Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** Where a bar starts on its track and how much of it it fills, both 0 to 1. */
export interface BarExtent {
  start: number;
  size: number;
}

/**
 * Bars that grow from one baseline: zero, which sits at the left unless some value is negative. Every bar shares the
 * same scale, so lengths compare.
 */
export function barExtents(values: readonly number[]): { zero: number; bars: BarExtent[] } {
  const finite = values.map((v) => (Number.isFinite(v) ? v : 0));
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  const span = hi - lo || 1;
  const zero = (0 - lo) / span;
  return {
    zero,
    bars: finite.map((v) => {
      const at = (v - lo) / span;
      return { start: Math.min(at, zero), size: Math.abs(at - zero) };
    }),
  };
}

/** A line's points on its plot, as fractions: x left to right, y top to bottom, against the first and last tick. */
export function linePoints(values: readonly number[], ticks: readonly number[]): { x: number; y: number }[] {
  const bottom = ticks[0] ?? 0;
  const top = ticks[ticks.length - 1] ?? 1;
  const span = top - bottom || 1;
  const last = values.length - 1;
  return values.map((v, i) => ({ x: last <= 0 ? 0.5 : i / last, y: 1 - ((Number.isFinite(v) ? v : 0) - bottom) / span }));
}

/** The index of the point nearest an x on the plot (a fraction, 0 to 1), for the crosshair. */
export function nearestIndex(x: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(x * (count - 1))));
}

export interface LabelledValue {
  label: string;
  value: number;
}

/**
 * A line in one sentence, as the widget table asks (first, last, highest): "Starts at 0 (Mon) and ends at 21 (Fri),
 * its highest.", "Starts at 3 (Mon), peaks at 21 (Wed) and ends at 14 (Fri).", "Stays at 4 from Mon to Fri."
 */
export function lineWords(points: readonly LabelledValue[], unit?: string): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 'No points yet.';
  const say = (p: LabelledValue) => `${withUnit(formatNumber(p.value), unit)} (${p.label})`;
  if (points.length === 1) return `One point: ${say(first)}.`;
  const highest = points.reduce((best, p) => (p.value > best.value ? p : best), first);
  if (points.every((p) => p.value === first.value)) return `Stays at ${withUnit(formatNumber(first.value), unit)} from ${first.label} to ${last.label}.`;
  if (highest.value === last.value) return `Starts at ${say(first)} and ends at ${say(last)}, its highest.`;
  if (highest === first) return `Starts at ${say(first)}, its highest, and ends at ${say(last)}.`;
  return `Starts at ${say(first)}, peaks at ${say(highest)} and ends at ${say(last)}.`;
}
