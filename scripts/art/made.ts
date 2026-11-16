// Layers made here, since no CC0 clip has them: typing, talking gestures, the seated poses of game-feel.md's section 7
// and the long day's slouch. Each starts from its base clip's first frame, aims bones along directions in the rig's
// space (which works whatever KayKit's bone axes are) and is stored as a delta from that frame, so the office plays it
// over the base with three's additive blend mode. Still layers (one pose) are played paused and cost nothing a frame.
import { AnimationMixer, AnimationUtils, type Bone, type Object3D, Quaternion, Vector3 } from 'three';
import { ADDITIVE_CLIPS, JOINTS, type Joint } from '../../web/src/scene/art/spec.ts';
import type { ClipReport } from './clips.ts';
import { type Clip, clipOf, continuous, type Rest, threeRig, tracksOf } from './rig.ts';

const AXES = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) } as const;

/** What a made layer can do to the rig, in the rig's own space: +z is forward, +x the person's left, +y up. */
export interface Posing {
  /** Points a bone (its +y, along the bone) along a direction. */
  aim(joint: Joint, x: number, y: number, z: number): void;
  /** Turns a bone about one of the rig's axes through its own head: +x pitches it forward, +y turns it left. */
  turn(joint: Joint, axis: keyof typeof AXES, angle: number): void;
}

interface MadeLayer {
  /** A loop's or a one-off's length, or 0 for a still pose. */
  seconds: number;
  joints: readonly Joint[];
  /** The pose at a point of the loop, `u` from 0 to 1; whole cycles, so a loop closes without a pop. */
  shape(pose: Posing, u: number): void;
}

const ARMS: readonly Joint[] = ['upperarml', 'lowerarml', 'wristl', 'handl', 'upperarmr', 'lowerarmr', 'wristr', 'handr'];
const UPPER: readonly Joint[] = ['spine', 'chest', 'head', ...ARMS];
const SIDES = [['l', 1], ['r', -1]] as const;
const wave = (u: number, cycles: number, shift = 0) => Math.sin(u * Math.PI * 2 * cycles + shift);
/** Key frames a second for looping layers, as the art proof's final code makes Typing. */
const LAYER_FPS = 24;

function arm(pose: Posing, side: 'l' | 'r', upper: [number, number, number], fore: [number, number, number], hand: [number, number, number]) {
  pose.aim(`upperarm${side}`, ...upper);
  pose.aim(`lowerarm${side}`, ...fore);
  pose.aim(`wrist${side}`, ...hand);
  pose.aim(`hand${side}`, ...hand);
}

const LAYERS: Readonly<Record<keyof typeof ADDITIVE_CLIPS, MadeLayer>> = {
  // Both hands at a keyboard in front of the belly, tapping in turn with one short pause a loop; the head on the
  // screen. The numbers are the art proof's final ones (preview/src/people/clips.ts).
  Typing: {
    seconds: 2.4,
    joints: [...ARMS, 'head'],
    shape(pose, u) {
      const pause = Math.max(0, wave(u, 1)) ** 6;
      for (const [side, s] of SIDES) {
        const tap = Math.max(0, wave(u, 7, side === 'l' ? 0 : Math.PI * 0.9)) * (1 - pause);
        arm(pose, side, [0.3 * s, -0.82, 0.48], [-0.04 * s, -0.1 - tap * 0.3, 1], [-0.02 * s, -0.3 - tap * 0.4, 1]);
      }
      pose.turn('head', 'x', 0.16 + wave(u, 1) * 0.03);
      pose.turn('head', 'y', wave(u, 1) * 0.1);
    },
  },
  // Talking: the right hand opens and beats with the words, the left follows a little, the head nods on the beats.
  Gesturing: {
    seconds: 2.4,
    joints: [...ARMS, 'head'],
    shape(pose, u) {
      const beat = Math.max(0, wave(u, 3)) ** 2;
      const small = Math.max(0, wave(u, 3, Math.PI * 0.8)) ** 2;
      const drift = wave(u, 1);
      arm(pose, 'r', [-0.5, -0.66, 0.56], [-0.28 + drift * 0.12, 0.3 + beat * 0.32, 0.9], [-0.42, 0.42 + beat * 0.2, 0.8]);
      arm(pose, 'l', [0.42, -0.8, 0.42], [0.24, 0.06 + small * 0.2, 0.97], [0.3, 0.12 + small * 0.15, 0.95]);
      pose.turn('head', 'x', beat * 0.07 - 0.02);
      pose.turn('head', 'y', drift * 0.08);
    },
  },
  // Thinking: the right elbow on the desk, chin on the hand, the head leaning into it.
  Think: {
    seconds: 0,
    joints: UPPER,
    shape(pose) {
      pose.turn('spine', 'x', 0.12);
      arm(pose, 'r', [0.24, -0.62, 0.75], [0.36, 0.78, 0.5], [0.42, 0.62, 0.66]);
      pose.turn('head', 'z', -0.14);
      pose.turn('head', 'x', 0.06);
    },
  },
  // Stuck: a hand on the back of the head, looking down at the problem.
  Stuck: {
    seconds: 0,
    joints: UPPER,
    shape(pose) {
      arm(pose, 'r', [-0.62, 0.72, -0.3], [0.78, 0.42, -0.46], [0.8, 0.1, -0.6]);
      pose.turn('head', 'x', 0.16);
      pose.turn('head', 'z', 0.06);
    },
  },
  // Resting at night: leaning over the desk, the head on folded arms.
  Sleep: {
    seconds: 0,
    joints: UPPER,
    shape(pose) {
      pose.turn('spine', 'x', 0.32);
      pose.turn('chest', 'x', 0.24);
      for (const [side, s] of SIDES) arm(pose, side, [0.28 * s, -0.36, 0.89], [-0.95 * s, 0.02, 0.32], [-0.9 * s, 0, 0.42]);
      pose.turn('head', 'x', 0.48);
      pose.turn('head', 'y', 0.35);
    },
  },
  // Waiting for a desk: the task paper held up in both hands, read with the head down.
  Read: {
    seconds: 0,
    joints: UPPER,
    shape(pose) {
      for (const [side, s] of SIDES) arm(pose, side, [0.22 * s, -0.78, 0.58], [-0.3 * s, 0.5, 0.82], [-0.35 * s, 0.6, 0.72]);
      pose.turn('head', 'x', 0.3);
    },
  },
  // Just stopped: sitting back, the head up toward the camera.
  Look_Up: {
    seconds: 0,
    joints: ['spine', 'chest', 'head'],
    shape(pose) {
      pose.turn('spine', 'x', -0.14);
      pose.turn('head', 'x', -0.22);
      pose.turn('head', 'y', 0.2);
    },
  },
  // Two of the three rest poses (the third is sitting idle itself): arms crossed, and leaning back loose.
  Arms_Crossed: {
    seconds: 0,
    joints: UPPER,
    shape(pose) {
      pose.turn('spine', 'x', -0.08);
      for (const [side, s] of SIDES) arm(pose, side, [0.3 * s, -0.62, 0.72], [-0.9 * s, side === 'l' ? 0.3 : 0.22, 0.32], [-0.9 * s, 0.2, -0.2]);
      pose.turn('head', 'x', -0.05);
    },
  },
  Lean_Back: {
    seconds: 0,
    joints: UPPER,
    shape(pose) {
      pose.turn('spine', 'x', -0.24);
      for (const [side, s] of SIDES) {
        pose.aim(`upperarm${side}`, 0.5 * s, -0.86, -0.1);
        pose.aim(`lowerarm${side}`, 0.42 * s, -0.62, 0.66);
      }
      pose.turn('head', 'z', 0.2);
      pose.turn('head', 'x', -0.12);
    },
  },
  // A nod (game-feel.md: taking a note, listening): the head dips and comes back once, so the layer ends where it began
  // and can be held at its end. Over any base: only the head and chest move.
  Nodding: {
    seconds: 0.8,
    joints: ['chest', 'head'],
    shape(pose, u) {
      const dip = Math.sin(u * Math.PI);
      pose.turn('chest', 'x', dip * 0.05);
      pose.turn('head', 'x', dip * 0.34);
    },
  },
  // A long day (game-feel.md, section 4): the full slouch is 18 degrees in the spine and 6 in the head; a weight of
  // 0.55 gives the slight one, 10 degrees.
  Slouch: {
    seconds: 0,
    joints: ['spine', 'head'],
    shape(pose) {
      pose.turn('spine', 'x', (18 * Math.PI) / 180);
      pose.turn('head', 'x', (6 * Math.PI) / 180);
    },
  },
};

const worldQuaternion = (o: Object3D) => o.getWorldQuaternion(new Quaternion());

/** Every made layer, from the clips they go over, which must be built first. */
export function madeClips(built: ReadonlyMap<string, Clip>, rest: Rest, report: ClipReport[]): Map<string, Clip> {
  const out = new Map<string, Clip>();
  for (const [name, layer] of Object.entries(LAYERS)) {
    const over = ADDITIVE_CLIPS[name as keyof typeof ADDITIVE_CLIPS];
    const base = built.get(over);
    if (!base) throw new Error(`${name} is made over ${over}, which was not built`);
    const clip = madeClip(name, layer, base, over, rest);
    out.set(name, clip);
    report.push({ name, from: `made over ${over}`, seconds: layer.seconds, tracks: clip.tracks.length, before: 0 });
  }
  return out;
}

function madeClip(name: string, layer: MadeLayer, base: Clip, over: string, rest: Rest): Clip {
  const rig = threeRig(rest);
  const mixer = new AnimationMixer(rig.group);
  mixer.clipAction(clipOf(base)).play();
  mixer.setTime(0);
  rig.group.updateMatrixWorld(true);
  const bone = (joint: Joint) => rig.bones.get(joint) as Bone;
  const start = new Map(JOINTS.map((joint) => [joint, bone(joint).quaternion.clone()]));
  const setWorld = (b: Bone, world: Quaternion) => {
    const parent = b.parent as Object3D;
    parent.updateMatrixWorld(true);
    b.quaternion.copy(worldQuaternion(parent).invert().multiply(world));
    b.updateMatrixWorld(true);
  };
  const posing: Posing = {
    aim(joint, x, y, z) {
      const b = bone(joint);
      (b.parent as Object3D).updateMatrixWorld(true);
      const world = worldQuaternion(b);
      const along = new Vector3(0, 1, 0).applyQuaternion(world);
      setWorld(b, new Quaternion().setFromUnitVectors(along, new Vector3(x, y, z).normalize()).multiply(world));
    },
    turn(joint, axis, angle) {
      const b = bone(joint);
      (b.parent as Object3D).updateMatrixWorld(true);
      setWorld(b, new Quaternion().setFromAxisAngle(AXES[axis], angle).multiply(worldQuaternion(b)));
    },
  };
  // A still pose is two equal keys a second apart: a clip with no length can't loop.
  const frames = layer.seconds > 0 ? Math.round(layer.seconds * LAYER_FPS) : 1;
  const duration = layer.seconds > 0 ? layer.seconds : 1;
  const times = Float32Array.from({ length: frames + 1 }, (_, f) => (f / frames) * duration);
  const values = new Map(layer.joints.map((joint) => [joint, new Float32Array((frames + 1) * 4)]));
  for (let f = 0; f <= frames; f++) {
    for (const joint of JOINTS) bone(joint).quaternion.copy(start.get(joint) as Quaternion);
    rig.group.updateMatrixWorld(true);
    layer.shape(posing, layer.seconds > 0 ? f / frames : 0);
    for (const joint of layer.joints) bone(joint).quaternion.toArray(values.get(joint) as Float32Array, f * 4);
  }
  const absolute: Clip = { name, tracks: layer.joints.map((joint) => ({ joint, path: 'rotation', times, values: values.get(joint) as Float32Array })) };
  const reference: Clip = {
    name: `${name} reference`,
    tracks: layer.joints.map((joint) => ({ joint, path: 'rotation', times: Float32Array.of(0), values: Float32Array.from((start.get(joint) as Quaternion).toArray()) })),
  };
  const additive = clipOf(absolute);
  AnimationUtils.makeClipAdditive(additive, 0, clipOf(reference));
  return { name, tracks: tracksOf(additive).map(continuous), extras: { additive: true, over, still: layer.seconds === 0 } };
}
