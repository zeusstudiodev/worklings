// The demo's replay of one real plain job (SPEC-v0.8.md, "The demo replay"): the recorded frames, stored as changes from
// the frame before (scripts/make-demo-replay.mjs), put back together, with the recording's times moved to now and what
// the visitor answered laid over them. Pure, for tests; player.ts drives it with a clock.
import type { CompanyView } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';

export type Live = Snapshot & { company: CompanyView };

/** A change: `$` replaces, `o` patches an object's keys and `d` drops some, `a` patches an array's items and `n` sets its length. */
export type Patch = { $: unknown } | { o: Record<string, Patch>; d?: string[] } | { a: Record<string, Patch>; n: number };

export type Frame = { t: number; full: Live } | { t: number; patch: Patch };

export interface Recording {
  prompt: string;
  folder: string;
  recorded: string;
  model: string;
  todoTools: boolean;
  durationMs: number;
  costUsd: number;
  timeRange: [number, number];
  frames: Frame[];
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The fixture's outline, checked once when it loads: the frames themselves are the hub's own snapshots. */
export function isRecording(v: unknown): v is Recording {
  if (!isObject(v) || typeof v.prompt !== 'string' || typeof v.folder !== 'string' || typeof v.durationMs !== 'number' || typeof v.costUsd !== 'number') return false;
  const range = v.timeRange;
  const frames = v.frames;
  if (!Array.isArray(range) || range.length !== 2 || !Array.isArray(frames) || frames.length === 0) return false;
  const [first] = frames;
  return isObject(first) && isObject(first.full) && frames.every((f) => isObject(f) && typeof f.t === 'number' && (isObject(f.full) || isObject(f.patch)));
}

export function applyPatch(value: unknown, patch: Patch): unknown {
  if ('$' in patch) return patch.$;
  if ('o' in patch) {
    const base: Record<string, unknown> = isObject(value) ? { ...value } : {};
    for (const k of patch.d ?? []) delete base[k];
    for (const [k, p] of Object.entries(patch.o)) base[k] = applyPatch(Object.hasOwn(base, k) ? base[k] : undefined, p);
    return base;
  }
  const base = Array.isArray(value) ? value.slice(0, patch.n) : [];
  for (const [i, p] of Object.entries(patch.a)) base[Number(i)] = applyPatch(base[Number(i)], p);
  base.length = patch.n;
  return base;
}

/** Every frame's snapshot, put together once, in order. */
export function framesOf(recording: Recording): { t: number; snapshot: Live }[] {
  const out: { t: number; snapshot: Live }[] = [];
  let current: Live | null = null;
  for (const f of recording.frames) {
    current = 'full' in f ? f.full : (applyPatch(current, f.patch) as Live);
    out.push({ t: f.t, snapshot: current });
  }
  return out;
}

/** Every time in a value moved by `offset`: any number inside the recording's range is a time (costs and counts are far smaller). */
export function shiftTimes<T>(value: T, offset: number, [from, to]: [number, number]): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'number') return v >= from && v <= to ? v + offset : v;
    if (Array.isArray(v)) return v.map(walk);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** What the visitor answered: a permission prompt, or the job's last words. */
export type Tap = { kind: 'approval'; decision: 'allow' | 'deny'; always: boolean; note: string | null; at: number } | { kind: 'question'; option: number | null; text: string; at: number };

/** The recording's view with the visitor's answers over it, and the count that follows from them. */
export function withTaps(company: CompanyView, taps: ReadonlyMap<string, Tap>, undoMs: number): CompanyView {
  const approvals = company.approvals.map((a) => {
    const tap = taps.get(a.id);
    return tap?.kind === 'approval' ? { ...a, withdrawn: null, answer: { decision: tap.decision, always: tap.always, at: tap.at, appliesAt: tap.at + undoMs, note: tap.note } } : a;
  });
  // A turn's last words left open while the session carried on by itself (a background helper reported, and it asked for
  // more since) no longer wait on anyone: the replay shows them withdrawn, so the card shows what the run waits on now.
  // The hub keeps them open until the next turn's words arrive.
  const questions = company.questions.map((q) => {
    const tap = taps.get(q.id);
    if (tap?.kind === 'question') return { ...q, withdrawn: null, answer: { option: tap.option, text: tap.text, at: tap.at, appliesAt: tap.at + undoMs } };
    const after = company.approvals.find((a) => a.askedAt > q.askedAt);
    if (q.plainTurn && !q.answer && !q.withdrawn && after) return { ...q, withdrawn: { reason: 'Claude Code went on by itself.', at: after.askedAt } };
    return q;
  });
  const open = approvals.filter((a) => !a.answer && !a.withdrawn).length + questions.filter((q) => !q.answer && !q.withdrawn).length;
  return { ...company, approvals, questions, inbox: open, batches: [] };
}

/** The run's questions and approvals with ids of this playing's own ("a-1.2"), as a new run's would be. */
export const withRunIds = (company: CompanyView, run: number): CompanyView => ({
  ...company,
  approvals: company.approvals.map((a) => ({ ...a, id: `${a.id}.${run}` })),
  questions: company.questions.map((q) => ({ ...q, id: `${q.id}.${run}` })),
});

/** The permission prompt the replay waits on: the first one open in this frame that the visitor hasn't answered. */
export const waitingOn = (company: CompanyView, taps: ReadonlyMap<string, Tap>): string | null =>
  company.approvals.find((a) => !a.answer && !a.withdrawn && !taps.has(a.id))?.id ?? null;

/** How long the clock waits before a frame, played `speed` times faster; long quiet stretches are cut to a beat. */
export const gapBefore = (recordedGap: number, speed: number): number => Math.min(Math.max(recordedGap / speed, 0), 1_500);

/** "3 min 10 s" for the banner. */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}
