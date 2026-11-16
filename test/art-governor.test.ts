// The frame governor (people/governor.ts) judged on frames recorded in the real office (H26, test/fixtures/governor/):
// an integrated GPU at a pixel ratio of 2 whose frames came long and short in turn, which the old rule (2 s of slow
// frames in a row) never stepped down for; a steady desktop; the same with one hitch; a desktop on a busy machine. Then
// its rate and GPU rules on made-up frames, and the GPU timer that feeds it (people/gpuTimer.ts) against a stand-in.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type FrameSample, Governor } from '../web/src/scene/people/governor.ts';
import { type FrameHook, GpuTimer, MAX_PENDING, type TimerContext } from '../web/src/scene/people/gpuTimer.ts';

type Frame = FrameSample & { at: number };
type Row = [at: number, work: number, took: number | null, asked: number | null];

function recorded(name: string): Frame[] {
  const file = JSON.parse(readFileSync(new URL(`./fixtures/governor/${name}.json`, import.meta.url), 'utf8')) as { samples: Row[] };
  return file.samples.map(([at, work, took, asked]) => ({ at, work, took, asked }));
}

/** Plays frames into a fresh governor; returns each step as [ms from the start, the level after it]. */
function play(frames: Frame[], governor = new Governor()): [number, number][] {
  const steps: [number, number][] = [];
  for (const { at, ...sample } of frames) if (governor.sample(sample, at)) steps.push([at, governor.level]);
  return steps;
}

/** Frames `gap(i)` ms apart for `ms`, from `start`, each as `frame` says. */
function made(ms: number, gap: (i: number) => number, frame: (i: number) => FrameSample, start = 0): Frame[] {
  const out: Frame[] = [];
  for (let at = start, i = 0; at <= start + ms; at += gap(i), i++) out.push({ at, ...frame(i) });
  return out;
}

/** The governor's rule for one frame without a GPU time: work over 33 ms, or a beat late and slower than 30 a second. */
const slow = (f: Frame) => f.work > 33 || (f.took !== null && f.asked !== null && f.took - f.asked > 12 && f.took > 33);

/** The longest stretch, in ms, of slow frames one after another. */
function longestSlowRun(frames: Frame[]): number {
  let longest = 0;
  let since: number | null = null;
  for (const f of frames) {
    if (!slow(f)) since = null;
    else {
      since ??= f.at;
      longest = Math.max(longest, f.at - since);
    }
  }
  return longest;
}

describe('the frame governor on recorded frames', () => {
  it('steps down 2 to 3 s into the integrated GPU at a pixel ratio of 2, whose frames come long and short in turn', () => {
    const igpu = recorded('igpu-dpr2');
    // About half the frames slow, but never 2 s of them in a row: why the old run rule waited forever.
    const share = igpu.filter(slow).length / igpu.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.7);
    expect(longestSlowRun(igpu)).toBeLessThan(2000);
    const steps = play(igpu);
    expect(steps[0]?.[1]).toBe(1);
    expect(steps[0]?.[0]).toBeGreaterThanOrEqual(2000);
    expect(steps[0]?.[0]).toBeLessThan(3000);
  });

  it('leaves a steady desktop alone', () => {
    expect(play(recorded('desktop-steady'))).toEqual([]);
  });

  it('is not moved by one hitch', () => {
    const hitch = recorded('desktop-hitch');
    expect(Math.max(...hitch.map((f) => f.took ?? 0))).toBeGreaterThan(150);
    expect(play(hitch)).toEqual([]);
  });

  it('leaves a desktop alone whose frames came late on a busy machine while its GPU sat idle', () => {
    const loaded = recorded('desktop-loaded');
    // A beat late often enough to look like a struggling GPU, which drawing less wouldn't have helped.
    expect(loaded.filter(slow).length / loaded.length).toBeGreaterThan(0.25);
    expect(play(loaded.map((f) => ({ ...f, gpu: 0.6 })))).toEqual([]);
  });
});

describe('the frame governor on made-up frames', () => {
  it('steps down when frames come at under 80% of the rate asked for, though none is a beat late on its own', () => {
    // 45 and 40 ms in turn against 33.3 asked: 11.7 and 6.7 ms late, under the 12 a frame needs, at 78% of the rate.
    const frames = made(2600, (i) => (i % 2 ? 40 : 45), (i) => ({ work: 3, took: i % 2 ? 45 : 40, asked: 33.3 }));
    expect(frames.some(slow)).toBe(false);
    const steps = play(frames);
    expect(steps.map(([, level]) => level)).toEqual([1]);
    expect(steps[0]?.[0]).toBeLessThan(2100);
  });

  it('leaves frames alone that come at 90% of the rate asked for', () => {
    expect(play(made(10_000, () => 37, () => ({ work: 3, took: 37, asked: 33.3 })))).toEqual([]);
  });

  it('steps down for a GPU over 33 ms a frame even when frames come on time, and not without it', () => {
    const onTime = (gpu: number | null) => made(2100, () => 33.3, () => ({ work: 3, took: 33.3, asked: 33.3, gpu }));
    const steps = play(onTime(40));
    expect(steps.map(([, level]) => level)).toEqual([1]);
    expect(steps[0]?.[0]).toBeGreaterThanOrEqual(2000);
    expect(play(onTime(null))).toEqual([]);
  });

  it('counts late frames only while the GPU might be why: not when it is known to sit idle', () => {
    const late = (gpu: number | null) => made(3000, () => 50, () => ({ work: 3, took: 50, asked: 33.3, gpu }));
    expect(play(late(1))).toEqual([]);
    expect(play(late(20)).map(([, level]) => level)).toEqual([1]);
    expect(play(late(null)).map(([, level]) => level)).toEqual([1]);
  });

  it('keeps a GPU reading for frames whose own reading has not come back yet', () => {
    // One reading in four, as results come back late and bunched: the idle GPU still excuses every late frame.
    expect(play(made(3000, () => 50, (i) => ({ work: 3, took: 50, asked: 33.3, gpu: i % 4 ? null : 1 })))).toEqual([]);
  });

  it('waits to step back up while the GPU takes 20 ms or more a frame', () => {
    const g = new Governor();
    play(made(2100, () => 33.3, () => ({ work: 3, took: 33.3, asked: 33.3, gpu: 40 })), g);
    expect(g.level).toBe(1);
    expect(play(made(15_000, () => 33.3, () => ({ work: 3, took: 33.3, asked: 33.3, gpu: 25 }), 2133), g)).toEqual([]);
    const up = play(made(11_000, () => 33.3, () => ({ work: 3, took: 33.3, asked: 33.3, gpu: 5 }), 17_166), g);
    expect(up.map(([, level]) => level)).toEqual([0]);
  });
});

/** A WebGL 2 context's timer queries, stood in for: results come back when `finish` says. */
function fakeGl(withTimer = true) {
  const log: string[] = [];
  const results = new Map<number, number>();
  let disjoint = false;
  let next = 1;
  const idOf = (q: object) => (q as { id: number }).id;
  const gl = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    getExtension: (name: string) => (withTimer && name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb } : null),
    createQuery: () => ({ id: next++ }),
    beginQuery: (_target: number, q: object) => void log.push(`begin ${idOf(q)}`),
    endQuery: () => void log.push('end'),
    deleteQuery: (q: object | null) => void log.push(`delete ${q ? idOf(q) : 'none'}`),
    getQueryParameter: (q: object, name: number) => (name === 0x8867 ? results.has(idOf(q)) : results.get(idOf(q))),
    getParameter: (name: number) => (name === 0x8fbb ? disjoint : null),
  };
  return {
    gl: gl satisfies TimerContext,
    log,
    finish: (id: number, ns: number) => void results.set(id, ns),
    disjoint: () => void (disjoint = true),
  };
}

/** R3F's addEffect and addAfterEffect, stood in for: `frame` runs one loop iteration. */
function loop() {
  const before = new Set<() => void>();
  const after = new Set<() => void>();
  const hook = (set: Set<() => void>): FrameHook => (callback) => {
    const run = () => callback(0);
    set.add(run);
    return () => void set.delete(run);
  };
  return {
    before: hook(before),
    after: hook(after),
    frame: () => {
      for (const run of before) run();
      for (const run of after) run();
    },
    hooks: () => before.size + after.size,
  };
}

describe('the GPU timer', () => {
  it('times nothing where the browser has no timer queries', () => {
    const r3f = loop();
    const timer = new GpuTimer(r3f.before, r3f.after);
    expect(timer.attach(fakeGl(false).gl)).toBe(false);
    expect(r3f.hooks()).toBe(0);
    expect(timer.take()).toBeNull();
  });

  it('brackets each frame with one query and hands its GPU time back once', () => {
    const r3f = loop();
    const fake = fakeGl();
    const timer = new GpuTimer(r3f.before, r3f.after);
    expect(timer.attach(fake.gl)).toBe(true);
    r3f.frame();
    expect(fake.log).toEqual(['begin 1', 'end']);
    expect(timer.take()).toBeNull();
    fake.finish(1, 12_500_000);
    expect(timer.take()).toBe(12.5);
    expect(timer.take()).toBeNull();
    expect(fake.log).toContain('delete 1');
  });

  it('voids results from a disjoint GPU', () => {
    const r3f = loop();
    const fake = fakeGl();
    const timer = new GpuTimer(r3f.before, r3f.after);
    timer.attach(fake.gl);
    r3f.frame();
    fake.finish(1, 40_000_000);
    fake.disjoint();
    expect(timer.take()).toBeNull();
  });

  it(`starts no query while ${MAX_PENDING} results are still out`, () => {
    const r3f = loop();
    const fake = fakeGl();
    const timer = new GpuTimer(r3f.before, r3f.after);
    timer.attach(fake.gl);
    for (let i = 0; i < MAX_PENDING + 3; i++) r3f.frame();
    expect(fake.log.filter((l) => l.startsWith('begin'))).toHaveLength(MAX_PENDING);
    fake.finish(1, 1_000_000);
    r3f.frame();
    expect(fake.log.filter((l) => l.startsWith('begin'))).toHaveLength(MAX_PENDING + 1);
  });

  it('stops with the canvas: its hooks go, an open query ends and every query is freed', () => {
    const r3f = loop();
    const fake = fakeGl();
    const timer = new GpuTimer(r3f.before, r3f.after);
    timer.attach(fake.gl);
    r3f.frame();
    timer.detach();
    expect(r3f.hooks()).toBe(0);
    expect(fake.log).toEqual(['begin 1', 'end', 'delete 1']);
  });
});
