// Plays the recorded run in the demo (SPEC-v0.8.md, "The demo replay"): the frames at `speed` times their pace, the
// recording's times moved to the moment it started, the clock stopped at each permission prompt until the visitor answers
// it on the card, and the last frame held at the end. The demo hub owns one player per replayed company and emits
// whenever the player changes.
import { UNDO_MS } from '../../../../src/core/company.ts';
import { framesOf, gapBefore, type Live, type Recording, shiftTimes, type Tap, waitingOn, withRunIds, withTaps } from './replayModel.ts';

export const REPLAY_SPEED = 8;
/** How long the run holds after the visitor answers a prompt, so the answer's Undo has a moment before the run moves on. */
export const AFTER_TAP_MS = 2_500;
/** While the run waits on the visitor, its clock stands still: every this often its times move up to now. */
const STILL_EVERY_MS = 2_000;

export type ReplayState = 'playing' | 'waiting' | 'done';

export interface ReplayStatus {
  state: ReplayState;
  /** Frames shown, of all. */
  frame: number;
  frames: number;
  /** The visitor said no where the recorded run said yes: the replay carries on as the run did. */
  deniedOnce: boolean;
}

export class ReplayPlayer {
  private readonly frames: { t: number; snapshot: Live }[];
  private index = 0;
  private offset = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** While waiting on a prompt: when the run's times were last moved up, so its clock stands still (nothing expires). */
  private still: { timer: ReturnType<typeof setInterval>; at: number } | null = null;
  private taps = new Map<string, Tap>();
  private denied = false;
  /** Which playing this is: from the second on, the run's items get ids of their own, so answers to the last one never show on them. */
  private run = 0;
  private shown: Live | null = null;

  readonly recording: Recording;
  readonly speed: number;
  private readonly onChange: () => void;

  constructor(recording: Recording, onChange: () => void, speed = REPLAY_SPEED) {
    this.recording = recording;
    this.onChange = onChange;
    this.speed = speed;
    this.frames = framesOf(recording);
  }

  /** From the first frame, with its times moved to now. */
  start(now = Date.now()): void {
    this.stopClock();
    this.index = 0;
    this.taps = new Map();
    this.denied = false;
    this.run += 1;
    const first = this.frames[0];
    this.offset = first ? now - first.snapshot.serverTime : 0;
    this.show();
    this.next();
  }

  /** Straight to the last frame, as the run ended, with every prompt answered as it was. */
  skipToEnd(): void {
    this.stopClock();
    this.index = this.frames.length - 1;
    this.show();
  }

  stop(): void {
    this.stopClock();
  }

  status(): ReplayStatus {
    const company = this.shown?.company;
    const waiting = company !== undefined && waitingOn(company, this.taps) !== null && this.index < this.frames.length - 1;
    return { state: waiting ? 'waiting' : this.index >= this.frames.length - 1 ? 'done' : 'playing', frame: this.index + 1, frames: this.frames.length, deniedOnce: this.denied };
  }

  snapshot(): Live | null {
    return this.shown;
  }

  /** The office's time now, which runs ahead of this browser's while the replay is sped up. */
  serverNow(): number {
    return this.shown?.serverTime ?? Date.now();
  }

  /** The visitor's answer to a permission prompt: the clock goes on once the one it waits on is answered. */
  decide(approval: string, decision: 'allow' | 'deny', always: boolean, note: string | null): void {
    if (!this.shown?.company.approvals.some((a) => a.id === approval)) throw new Error("That prompt isn't in the run.");
    this.taps.set(approval, { kind: 'approval', decision, always, note, at: this.serverNow() });
    if (decision === 'deny') this.denied = true;
    this.show();
    if (this.timer === null) this.next(AFTER_TAP_MS);
  }

  /** A reply to the job's words: kept here, since a recording can't hear it. */
  answer(question: string, option: number | null, text: string): void {
    if (!this.shown?.company.questions.some((q) => q.id === question)) throw new Error("That question isn't in the run.");
    this.taps.set(question, { kind: 'question', option, text, at: this.serverNow() });
    this.show();
  }

  /** Undo within the window: the prompt waits again if the run hasn't moved past it. */
  undo(item: string): void {
    this.taps.delete(item);
    this.show();
    if (this.status().state === 'waiting') this.next();
  }

  private show(): void {
    const frame = this.frames[this.index];
    if (!frame) return;
    // Times move to now; the office's clock is this frame's moment of the run.
    const moved = shiftTimes(frame.snapshot, this.offset, this.recording.timeRange);
    const company = this.run > 1 ? withRunIds(moved.company, this.run) : moved.company;
    this.shown = { ...moved, company: withTaps(company, this.taps, UNDO_MS) };
    this.onChange();
  }

  /** The next frame after its gap (at least `hold`), or, while a prompt waits, the clock standing still until it is answered. */
  private next(hold = 0): void {
    this.stopClock();
    if (this.status().state === 'waiting') {
      this.standStill();
      return;
    }
    if (this.index >= this.frames.length - 1) return;
    const here = this.frames[this.index];
    const there = this.frames[this.index + 1];
    if (!here || !there) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.index += 1;
      this.show();
      this.next();
    }, Math.max(hold, gapBefore(there.t - here.t, this.speed)));
  }

  /**
   * The prompt waits on the visitor as long as they like: the run's times move up with the wall clock, so it reads "just
   * asked" and never times out, and the frames after it keep their places.
   */
  private standStill(): void {
    const at = Date.now();
    this.still = {
      at,
      timer: setInterval(() => {
        const still = this.still;
        if (!still) return;
        const now = Date.now();
        this.offset += now - still.at;
        still.at = now;
        this.show();
      }, STILL_EVERY_MS),
    };
  }

  private stopClock(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.still) {
      clearInterval(this.still.timer);
      // The time it stood still moves the rest of the run with it.
      this.offset += Date.now() - this.still.at;
      this.still = null;
    }
  }
}
