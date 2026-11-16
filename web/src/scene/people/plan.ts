// What a person's body plays for a pose (docs/game-feel.md, section 7, and the poses in ../poses.ts): a base clip and
// the additive layers over it, each looping, played once or held as one still frame. Pure, so the mapping is tested
// without a browser; the rig (rig.ts) turns a plan into three.js actions.
import type { ClipName } from '../art/spec.ts';
import type { BodyState, Holding } from '../poses.ts';

/** loop: repeats from `at` (a fraction of the clip). once: plays through from `elapsed` seconds and holds its end. still: one frame at `at`. */
export type TrackMode = 'loop' | 'once' | 'still';

export interface Track {
  clip: ClipName;
  mode: TrackMode;
  /** Where in the clip, 0 to 1: a loop's start or a still frame. */
  at: number;
  /** For `once`: how far into it the person already is, in seconds (the pose began before this browser saw it). */
  elapsed: number;
  timeScale: number;
  weight: number;
}

export interface Plan {
  base: Track;
  /** Additive layers over the base. */
  layers: Track[];
  seated: boolean;
  /** What is in their hand. */
  holding: Holding;
  /** Something moves every frame (a loop or a one-off), so the mixer has to run; false holds still frames. */
  live: boolean;
}

export interface PlanOptions {
  reducedMotion: boolean;
  /** The person's own phase and pace (dress.ts). */
  phase: number;
  pace: number;
  /** Seconds since the pose began on the scene clock. */
  elapsed: number;
  /** On a chair: the cast's `seated`, whatever the pose (a nod at the desk sits, one at the front desk stands). */
  seated: boolean;
}

/** Typing slows on a long day: 0.85 at "long day", 0.75 when spent (game-feel.md, section 4). */
const TYPING_SPEED = [1, 1, 0.85, 0.75] as const;
/** The slouch layer's weight: 0.55 of the full 18 degrees is the slight one. */
const SLOUCH = [0, 0, 0.55, 1] as const;
/** The two rest poses made as layers; the first rest pose is sitting idle itself. */
const REST_LAYERS: readonly (ClipName | null)[] = [null, 'Arms_Crossed', 'Lean_Back'];

const track = (clip: ClipName, mode: TrackMode, at = 0, timeScale = 1, weight = 1, elapsed = 0): Track => ({ clip, mode, at, elapsed, timeScale, weight });

export function planFor(body: Pick<BodyState, 'pose' | 'holding' | 'tired' | 'restPose'>, o: PlanOptions): Plan {
  const { seated } = o;
  const loop = (clip: ClipName, timeScale = 1, weight = 1) => track(clip, 'loop', o.phase, timeScale * o.pace, weight);
  const still = (clip: ClipName, at = 0, weight = 1) => track(clip, 'still', at, 1, weight);
  const once = (clip: ClipName) => track(clip, 'once', 0, 1, 1, o.elapsed);
  const standing = body.holding === 'none' ? loop('Idle_A') : loop('Holding_A');
  // A desk pose with the cast saying they stand (in a line, say) keeps its layer over a standing frame.
  const sitting = (moving: boolean, timeScale = 1) =>
    seated ? (moving ? loop('Sit_Chair_Idle', timeScale) : still('Sit_Chair_Idle', o.phase)) : moving ? standing : still(body.holding === 'none' ? 'Idle_A' : 'Holding_A', o.phase);
  const layers: Track[] = [];
  let base: Track;

  switch (body.pose) {
    case 'type':
      base = sitting(true);
      layers.push(loop('Typing', TYPING_SPEED[body.tired]));
      break;
    case 'think':
      // Chin on hand, breathing slowly.
      base = sitting(true, 0.5);
      layers.push(still('Think'));
      break;
    case 'read':
      base = sitting(false);
      layers.push(still('Read'));
      break;
    case 'stuck':
      base = sitting(false);
      layers.push(still('Stuck'));
      break;
    case 'sleep':
      base = sitting(false);
      layers.push(still('Sleep'));
      break;
    case 'look':
      base = sitting(false);
      layers.push(still('Look_Up'));
      break;
    case 'rest':
    case 'lounge': {
      base = sitting(false);
      const rest = REST_LAYERS[body.restPose];
      if (rest) layers.push(still(rest));
      break;
    }
    case 'talk':
      base = seated ? loop('Sitting_Talking') : loop('Idle_Talking');
      layers.push(loop('Gesturing', 1, seated ? 0.7 : 1));
      break;
    case 'walk':
      base = body.holding === 'none' ? loop('Walking_A') : loop('Walk_Carry');
      break;
    case 'stand':
      base = standing;
      break;
    case 'wait':
      // One still Holding frame: a line at the front desk waits for hours at no cost.
      base = still('Holding_A', 0.5);
      break;
    case 'listen':
      // A nod every 2 to 4 s: the crowd plays this layer's 0.8 s now and then (crowd.ts, LISTEN_NODS), weightless between.
      base = loop('Idle_Listening');
      layers.push(track('Nodding', 'loop', 0, 1, 0));
      break;
    case 'nod':
      base = seated ? sitting(false) : loop('Idle_Listening');
      layers.push(once('Nodding'));
      break;
    case 'clap':
      base = loop('Clapping');
      break;
    case 'cheer':
      base = loop('Victory_Fist_Pump');
      break;
    case 'interact':
      base = loop('Interact');
      break;
    case 'pickup':
      base = once('PickUp_Table');
      break;
    case 'wave':
      base = loop('Waving');
      break;
  }

  if (seated && body.tired >= 2 && body.pose !== 'sleep') layers.push(still('Slouch', 0, SLOUCH[body.tired]));
  const plan: Plan = { base, layers, seated, holding: body.holding, live: false };
  if (o.reducedMotion) {
    // Nobody animates: every clip holds one frame, a one-off its last.
    const freeze = (t: Track): Track => (t.mode === 'still' ? t : { ...t, mode: 'still', at: t.mode === 'once' ? 1 : t.at, timeScale: 1 });
    plan.base = freeze(plan.base);
    plan.layers = plan.layers.map(freeze);
  }
  plan.live = [plan.base, ...plan.layers].some((t) => t.mode !== 'still');
  return plan;
}

/** Poses whose clip carries the walk: the rig matches its pace to how fast the person moves. */
export const STRIDE: Partial<Record<ClipName, number>> = {
  // Units a second the feet cover at a time scale of 1 (the art proof: Walking_A 1.25, Walk_Carry 1.05).
  Walking_A: 1.25,
  Walk_Carry: 1.05,
};
