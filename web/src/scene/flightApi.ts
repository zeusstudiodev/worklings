// What the stage gives Send's flight (docs/design-hud.md, "Send's flight"): where something is on the page, and a way to
// keep the office's own note out of its tray until the paper lands. The stage registers itself; the talk bar asks.
import type { LabelStore } from './labels.tsx';
import type { Pt, Reach } from './reach.ts';

export { holdNotes, type NoteHold } from './noteHold.ts';
export { OFFICE_MIDDLE, type Pt, type Reach } from './reach.ts';

interface Registered {
  labels: LabelStore;
  box: () => HTMLElement | null;
}

let stage: Registered | null = null;

/** The stage of a company's office, for as long as it is mounted. Returns how to take it away. */
export function registerStage(labels: LabelStore, box: () => HTMLElement | null): () => void {
  const mine = { labels, box };
  stage = mine;
  return () => {
    if (stage === mine) stage = null;
  };
}

/** What the stage is for the person now: the main office, the mini-map over a board, or nothing flies to it. */
export function stageMode(): 'office' | 'map' | null {
  const el = stage?.box();
  if (!el || el.dataset.covered !== undefined) return null;
  return el.dataset.phase === 'office' ? 'office' : el.dataset.phase === 'mini' ? 'map' : null;
}

/** An anchor's place on the page against the labels' area (`tray:<person>`, `room:<id>`, `OFFICE_MIDDLE`); office only. */
export function reachOf(anchorId: string): Reach | null {
  return stageMode() === 'office' ? (stage?.labels.reach(anchorId) ?? null) : null;
}

/** The mini-map's middle on the page; only while the main view is a board. */
export function mapMiddle(): Pt | null {
  const el = stage?.box();
  if (!el || stageMode() !== 'map') return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}
