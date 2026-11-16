// v3: what a person's body does and holds in the office. The cast decides it (cast.ts, moments.ts, from the snapshot
// and docs/game-feel.md); the people renderer draws it with the KayKit rigs (people/, People.tsx). Neither side
// changes this list alone: it is the contract between them.
import type { Look } from '../../../src/core/studio.ts';

/**
 * rest: off duty or idle at the desk, one of three still rest poses by look (`restPose`). type: working, sitting with
 * the typing layer. think: chin on hand after 4 s with no step running. read: waiting for a desk with their task
 * paper. stuck: hand on the back of the head. sleep: night, head on folded arms. look: just stopped, sitting back
 * facing the camera. walk: on a route (`walk` legs), holding whatever `holding` says. stand: standing at a spot (a
 * desk they deliver to, a path's end). wait: in line at the front desk, a still Holding frame. talk, listen, nod: the
 * meeting room and walk-overs. clap, cheer: a milestone's celebration. interact: setting the plant down, the CEO at
 * the whiteboard. pickup: a fired person picking up their plant. wave: at the door, arriving or leaving. lounge:
 * off duty in a lounge, kitchen or games room.
 */
export const POSES = [
  'rest', 'type', 'think', 'read', 'stuck', 'sleep', 'look',
  'walk', 'stand', 'wait', 'talk', 'listen', 'nod', 'clap', 'cheer', 'interact', 'pickup', 'wave', 'lounge',
] as const;
export type Pose = (typeof POSES)[number];

/**
 * Poses usually on a chair. The cast says for each member whether they sit (`seated`), which the renderer follows:
 * it plays sitting down and standing up when that changes. A talker stands (game-feel.md).
 */
export const SEATED_POSES: ReadonlySet<Pose> = new Set(['rest', 'type', 'think', 'read', 'stuck', 'sleep', 'look', 'lounge']);

/**
 * note: a white paper (a message passed on). note-yours: yellow, it carries the stakeholder's words or needs them.
 * task: their own task paper while waiting for a desk. plant: a first day, or leaving. laptop: carrying work.
 */
export const HOLDINGS = ['none', 'note', 'note-yours', 'task', 'plant', 'laptop'] as const;
export type Holding = (typeof HOLDINGS)[number];

/** Context use as a long day: 0 fresh, 1 one cup (50%), 2 two cups and a slight slouch (75%), 3 three and deeper (90%). */
export type Tiredness = 0 | 1 | 2 | 3;

/** v3: what a cast member adds for the renderer. */
export interface BodyState {
  pose: Pose;
  holding: Holding;
  tired: Tiredness;
  /** Which of the three rest poses, stable per person. */
  restPose: 0 | 1 | 2;
  /** Their look from studio.yaml; what's missing comes from their room's colour and a stable hash of `look`. */
  outfit: Look;
  /** The moment the pose began on the scene clock, so clips start where they should and the typing never syncs. */
  since: number;
  /** Mannequin bodies are visitors: sessions the company didn't start. */
  visitor: boolean;
}

/** A desk tray: the notes waiting for its person, yellow when one carries the stakeholder's words. */
export interface Tray {
  person: string;
  notes: number;
  yours: boolean;
}

/** v3: what the cast adds for the whole scene. */
export interface SceneMoments {
  /** 0 day to 1 night, from a usage-limit or overload pause; the scene eases between them. */
  night: number;
  trays: Tray[];
  /** Who waits at the front desk, first in line first (at most six places; the rest wait at their desks). */
  frontDesk: string[];
  /** A milestone's celebration under way: streamers in these rooms' hues until `until`. */
  celebration: { until: number; rooms: string[]; streamers: number } | null;
}
