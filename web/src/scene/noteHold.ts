// Keeps the office's own note out of a desk tray while Send's paper is still flying to it (docs/game-feel.md,
// docs/design-hud.md, "Send's flight"). The snapshot with your message usually arrives before the paper lands, so
// without a rule the 3D note would show first. A hold remembers how many papers each tray had when it began and hides
// the ones beyond that until its time comes (or it is released, or its cap runs out), then the layer draws them.
import type { MomentProps } from './moments.ts';

/** A hold never outlasts this, whatever happens to the send it waits for. */
export const HOLD_CAP_MS = 3500;

export interface NoteHold {
  /** Hides the new notes until this time on `performance.now()`'s clock. */
  until(at: number): void;
  /** Lets them show now. */
  release(): void;
}

interface Hold {
  base: ReadonlyMap<string, number>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const holds = new Set<Hold>();
const listeners = new Set<() => void>();
let version = 0;
let counts: ReadonlyMap<string, number> = new Map();

const notify = () => {
  version += 1;
  for (const listener of listeners) listener();
};

/** What the layer draws now: papers per person, so a hold knows which are new. */
export function noteTrays(papers: MomentProps['papers']): void {
  const next = new Map<string, number>();
  for (const p of papers) next.set(p.person, (next.get(p.person) ?? 0) + 1);
  counts = next;
}

/** Begins holding the notes that arrive from now on. */
export function holdNotes(): NoteHold {
  const hold: Hold = { base: counts, timer: undefined };
  const end = () => {
    clearTimeout(hold.timer);
    if (holds.delete(hold)) notify();
  };
  const until = (at: number) => {
    clearTimeout(hold.timer);
    hold.timer = setTimeout(end, Math.max(0, Math.min(at - performance.now(), HOLD_CAP_MS)));
  };
  holds.add(hold);
  until(performance.now() + HOLD_CAP_MS);
  return { until, release: end };
}

/** Whether a tray's paper is one a hold keeps back: it is beyond the papers the tray had when the hold began. */
export function heldPaper(person: string, index: number): boolean {
  for (const hold of holds) if (index >= (hold.base.get(person) ?? 0)) return true;
  return false;
}

export const watchHolds = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const holdVersion = (): number => version;
export const holding = (): boolean => holds.size > 0;
