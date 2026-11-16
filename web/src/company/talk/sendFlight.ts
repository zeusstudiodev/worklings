// Send's flight (docs/design-hud.md, "Send's flight"; docs/game-feel.md): your paper lifts off the talk bar and arcs to
// the receiver's desk, then fades as the office's own note takes over. One positioned element per paper, moved by
// `transform` each frame from the stage's projection of the target, so a moving camera doesn't lose it. With reduced
// motion or Still office, or with no stage to fly to, nothing flies. The stage keeps its 3D note out of the tray until
// the paper lands (scene/noteHold.ts). Nothing here sends anything: a paper is launched only for a copy that went.
import type { Recipient } from '../../../../src/core/steering.ts';
import { holdNotes, mapMiddle, OFFICE_MIDDLE, type Pt, reachOf, stageMode } from '../../scene/flightApi.ts';
import { anchorOf, distance, FADE_MS, flightMs, GAP_MS, LIFT_MS, PAPER_H, PAPER_W, poseAt } from './flightMath.ts';

export interface FlightSession {
  /** A copy went to `to`: its paper leaves now, or 60 ms after the one before it. */
  note(to: Recipient): void;
  /** Every call is done: with no paper launched, the office's notes show again at once. */
  end(): void;
}

/** Where a paper is headed this frame: the point itself, or the edge toward it when it is out of view or under a panel. */
type Goal = () => Pt | null;

function goalFor(mode: 'office' | 'map', to: Recipient): Goal | null {
  if (mode === 'map') return mapMiddle() ? mapMiddle : null;
  const wanted = anchorOf(to);
  const anchor = reachOf(wanted) ? wanted : reachOf(OFFICE_MIDDLE) ? OFFICE_MIDDLE : null;
  if (!anchor) return null;
  return () => {
    const r = reachOf(anchor);
    return r ? (r.inside ? { x: r.x, y: r.y } : r.edge) : null;
  };
}

function paper(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tflight';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  return el;
}

/** Runs one paper to the end of its flight and its fade, then takes it away. */
function fly(from: Pt, startAt: number, goal: Goal, first: Pt, ms: number): void {
  const el = paper();
  let last = first;
  const frame = (now: number) => {
    const elapsed = now - startAt;
    last = goal() ?? last;
    if (elapsed >= LIFT_MS + ms + FADE_MS) {
      el.remove();
      return;
    }
    if (elapsed >= 0) {
      const pose = poseAt(elapsed, from, last, ms);
      el.style.transform = `translate(${(pose.x - PAPER_W / 2).toFixed(1)}px, ${(pose.y - PAPER_H / 2).toFixed(1)}px) rotate(${pose.turn.toFixed(1)}deg) scale(${pose.scale.toFixed(3)})`;
      const gone = elapsed - LIFT_MS - ms;
      el.style.opacity = gone > 0 ? String(Math.max(0, 1 - gone / FADE_MS)) : '1';
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/**
 * Begins the flights of one send, from the Send key `origin`. Null when nothing should fly: reduced motion, no stage in
 * view as the office or a board's mini-map, or no key to lift off.
 */
export function beginFlight(origin: HTMLElement | null, reduced: boolean): FlightSession | null {
  if (reduced || !origin) return null;
  const mode = stageMode();
  if (!mode) return null;
  const hold = mode === 'office' ? holdNotes() : null;
  let launched = 0;
  let free = 0;
  let lands = 0;
  return {
    note(to) {
      const box = origin.getBoundingClientRect();
      const goal = box.width > 0 ? goalFor(mode, to) : null;
      const first = goal?.();
      if (!goal || !first) return;
      const from = { x: box.left + box.width / 2, y: box.top };
      const ms = flightMs(distance(from, first));
      const startAt = Math.max(performance.now(), free);
      free = startAt + GAP_MS;
      fly(from, startAt, goal, first, ms);
      launched += 1;
      // The office's own note appears as the paper lands.
      lands = Math.max(lands, startAt + LIFT_MS + ms);
      hold?.until(lands);
    },
    end() {
      if (launched === 0) hold?.release();
    },
  };
}
