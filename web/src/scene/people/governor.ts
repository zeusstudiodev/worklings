// The adaptive-quality governor (docs/game-feel.md, "Phones"): when the frames of the last 2 s run slow it steps
// quality down, and after 10 s of easy frames it steps back up. Pure, so its rules are tested without a browser.
//
// A frame is slow when its own work (the frame loop's main-thread time) or its GPU time takes more than 33 ms, or when
// it comes a beat or more later than its tier asked for and slower than 30 a second: a phone's 30 fps motion tier and
// the ambient tiers come every 33 to 66 ms by design, and that isn't slow. GPU time comes from timer queries where the
// browser has them (people/gpuTimer.ts); Safari has none. A late frame counts only while the GPU might be why: when it
// is known to sit idle for half the frame, the lateness is the machine's (other programs, the page's other work), and
// drawing less wouldn't bring the frames back.
//
// The governor judges a window of the last 2 s, not an unbroken run: under GPU back-pressure frames come long and short
// in turn (75 ms, 35 ms, 80 ms...), and each on-time one would restart a run. It steps down once frames have kept
// coming for 2 s and half of the window's frames were slow, or they came at under 80% of the rate they asked for and
// slower than 30 a second, which catches a GPU that can't keep up where nothing times it. Frames apart (an office at
// rest draws one now and then) only count for their work.
//
// Level 0 draws everything; 1 drops the desktop extras (bloom); 2 draws at a pixel ratio of 1 and lowers
// the walk budget to 2; 3 also slows the ambient rate to 15 fps and stops animating people under 16 px tall.
export const MAX_LEVEL = 3;
const SLOW_MS = 33;
/** How long the window is, and how long frames must have kept coming before the governor steps down. */
const WINDOW_MS = 2000;
/** Steps down when at least this share of the window's frames were slow... */
const SLOW_SHARE = 0.5;
/** ...or when they came at under this share of the rate their tiers asked for. */
const RATE_SHARE = 0.8;
const EASY_MS = 20;
const EASY_FOR_MS = 10_000;
/** A frame this much later than asked missed a beat (16.7 ms at 60 Hz). */
const LATE_MS = 12;
/** Frames further apart than this aren't a run: the window starts again. */
const GAP_MS = 250;
/** Stepping up and straight back down: the next try waits twice as long, up to this. */
const MAX_EASY_FOR_MS = 160_000;
const BOUNCE_MS = 5000;
/** A GPU reading stands for this long: results come back a frame or two late, and not with every frame. */
const GPU_FRESH_MS = 1000;

export interface FrameSample {
  /** Main-thread milliseconds the frame's loop took: the people, the labels, the draw calls. */
  work: number;
  /** Milliseconds since the frame before, when that one asked for this one; null otherwise. */
  took: number | null;
  /** The interval the frame before asked for (its tier's), in milliseconds; null when it asked for none. */
  asked: number | null;
  /** GPU milliseconds of a recent frame (people/gpuTimer.ts); null or absent where the browser can't time the GPU. */
  gpu?: number | null;
}

/** One frame in the window: whether it was slow, and its timing when it was asked for and its lateness counts. */
interface Seen {
  at: number;
  slow: boolean;
  took: number | null;
  asked: number | null;
}

export class Governor {
  level = 0;
  private window: Seen[] = [];
  /** When frames started coming without a gap, or the last step: the window must cover 2 s from here. */
  private runSince: number | null = null;
  private easySince: number | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;
  private upAt = Number.NEGATIVE_INFINITY;
  private easyFor = EASY_FOR_MS;
  private gpu: number | null = null;
  private gpuAt = Number.NEGATIVE_INFINITY;

  /** One drawn frame, at `at` (real ms). Returns true when the level changed. */
  sample(frame: FrameSample, at: number): boolean {
    if (at - this.lastAt > GAP_MS) this.restart(at);
    this.lastAt = at;
    if (typeof frame.gpu === 'number') {
      this.gpu = frame.gpu;
      this.gpuAt = at;
    }
    const gpu = at - this.gpuAt <= GPU_FRESH_MS ? this.gpu : null;
    const timed = frame.took !== null && frame.asked !== null;
    const late = timed ? (frame.took as number) - (frame.asked as number) : 0;
    const lateCounts = timed && (gpu === null || gpu >= (frame.asked as number) / 2);
    const slow = frame.work > SLOW_MS || (gpu !== null && gpu > SLOW_MS) || (lateCounts && late > LATE_MS && (frame.took as number) > SLOW_MS);
    this.window.push({ at, slow, took: lateCounts ? frame.took : null, asked: lateCounts ? frame.asked : null });
    while (this.window.length > 0 && at - (this.window[0] as Seen).at > WINDOW_MS) this.window.shift();

    if (this.level < MAX_LEVEL && this.runSince !== null && at - this.runSince >= WINDOW_MS && this.struggling()) {
      this.level++;
      this.restart(at);
      // Down again right after a step up: that level is too much here, so the next try waits longer.
      if (at - this.upAt < BOUNCE_MS + WINDOW_MS) this.easyFor = Math.min(MAX_EASY_FOR_MS, this.easyFor * 2);
      return true;
    }
    if (!slow && frame.work < EASY_MS && (gpu === null || gpu < EASY_MS) && late <= LATE_MS / 2) {
      this.easySince ??= at;
      if (at - this.easySince >= this.easyFor && this.level > 0) {
        this.level--;
        this.restart(at);
        this.upAt = at;
        return true;
      }
    } else this.easySince = null;
    return false;
  }

  /**
   * Half the window's frames slow, or frames at under 80% of the rate they asked for and slower than 30 a second, judged
   * on the frames whose lateness counts when they are at least half the window.
   */
  private struggling(): boolean {
    const n = this.window.length;
    if (n === 0) return false;
    if (this.window.filter((s) => s.slow).length >= n * SLOW_SHARE) return true;
    let took = 0;
    let asked = 0;
    let timed = 0;
    for (const s of this.window) {
      if (s.took === null || s.asked === null) continue;
      took += s.took;
      asked += s.asked;
      timed++;
    }
    return timed >= n * SLOW_SHARE && asked < took * RATE_SHARE && took / timed > SLOW_MS;
  }

  /** A new window from `at`: after a gap or a step, the frames before it say nothing about the level now. */
  private restart(at: number): void {
    this.window = [];
    this.runSince = at;
    this.easySince = null;
  }
}

/** People out walking at once at a governor level: lowered to 2 from level 2 (game-feel.md); undefined keeps the cast's own. */
export const walkBudget = (level: number): number | undefined => (level >= 2 ? 2 : undefined);
