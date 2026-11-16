// The clips every person shares: KayKit's own medium-rig clips the office plays, Mesh2Motion's human clips retargeted
// onto the medium rig (the layers made here are in made.ts). Everything ends up as tracks on the one skeleton; tracks
// that never leave the rest pose are dropped, since the mixer falls back to the rest pose without them.
import type { Document } from '@gltf-transform/core';
import { AnimationMixer, type Bone, Matrix4, type Object3D, Quaternion, Vector3 } from 'three';
import { type RetargetClipOptions, retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { JOINTS, KAYKIT_CLIPS, RETARGETED_CLIPS } from '../../web/src/scene/art/spec.ts';
import { atRest, type Clip, continuous, type Rest, threeClip, threeRig, threeTree, tracksOf } from './rig.ts';

export interface ClipReport {
  name: string;
  from: string;
  seconds: number;
  tracks: number;
  /** Tracks in the source before slimming. */
  before: number;
}

/** KayKit's clips by name from the pack's clip files, slimmed. Fails when one the office plays is missing. */
export function kaykitClips(files: { label: string; doc: Document }[], rest: Rest, report: ClipReport[]): Map<string, Clip> {
  const wanted = new Set<string>(KAYKIT_CLIPS);
  const clips = new Map<string, Clip>();
  for (const { label, doc } of files) {
    for (const animation of doc.getRoot().listAnimations()) {
      const name = animation.getName();
      if (!wanted.has(name) || clips.has(name)) continue;
      const three = threeClip(animation, label);
      const tracks = tracksOf(three).filter((t) => !atRest(t, rest)).map(continuous);
      clips.set(name, { name, tracks });
      report.push({ name, from: label, seconds: three.duration, tracks: tracks.length, before: animation.listChannels().length });
    }
  }
  const missing = [...wanted].filter((name) => !clips.has(name));
  if (missing.length) throw new Error(`KayKit clips not found in the clip files: ${missing.join(', ')}`);
  return clips;
}

/**
 * Mesh2Motion bone for each medium-rig joint; joints not listed keep their own pose. Both the wrist and the hand
 * follow Mesh2Motion's hand: a joint left out keeps its rest pose in world space and the hand twists off.
 */
const FROM_MESH2MOTION: Readonly<Record<string, string>> = {
  hips: 'pelvis',
  spine: 'spine_02',
  chest: 'spine_03',
  head: 'head',
  upperarml: 'upperarm_l',
  lowerarml: 'lowerarm_l',
  wristl: 'hand_l',
  handl: 'hand_l',
  upperarmr: 'upperarm_r',
  lowerarmr: 'lowerarm_r',
  wristr: 'hand_r',
  handr: 'hand_r',
  upperlegl: 'thigh_l',
  lowerlegl: 'calf_l',
  footl: 'foot_l',
  toesl: 'ball_l',
  upperlegr: 'thigh_r',
  lowerlegr: 'calf_r',
  footr: 'foot_r',
  toesr: 'ball_r',
};

const worldQuaternion = (o: Object3D) => o.getWorldQuaternion(new Quaternion());

/**
 * Mesh2Motion's clips on the medium rig, with three's SkeletonUtils.retargetClip. The rigs' bone axes differ, so each
 * joint gets an offset measured with both in a T-pose (Mesh2Motion's rest-pose clip, KayKit's bind pose):
 * inverse(source world) * target world. The hips follow the pelvis, scaled by the ratio of their heights.
 */
export function retargetedClips(restPose: Document, sources: Map<string, Document>, rest: Rest, report: ClipReport[]): Map<string, Clip> {
  const rig = threeRig(rest);
  const restTree = threeTree(restPose, 'rest-pose');
  const restAnimation = restPose.getRoot().listAnimations()[0];
  if (!restAnimation) throw new Error('rest-pose: no clip');
  const mixer = new AnimationMixer(restTree);
  mixer.clipAction(threeClip(restAnimation, 'rest-pose')).play();
  mixer.setTime(0);
  restTree.updateMatrixWorld(true);
  rig.mesh.skeleton.pose();
  rig.group.updateMatrixWorld(true);

  const localOffsets: Record<string, Matrix4> = {};
  for (const joint of JOINTS) {
    const from = FROM_MESH2MOTION[joint];
    if (!from) continue;
    const source = restTree.skeleton.getBoneByName(from);
    if (!source) throw new Error(`rest-pose: no bone ${from}`);
    const offset = worldQuaternion(source).invert().multiply(worldQuaternion(rig.bones.get(joint) as Bone));
    localOffsets[joint] = new Matrix4().makeRotationFromQuaternion(offset);
  }
  const pelvis = restTree.skeleton.getBoneByName('pelvis');
  if (!pelvis) throw new Error('rest-pose: no pelvis');
  const hipHeight = (rig.bones.get('hips') as Bone).getWorldPosition(new Vector3()).y;
  const scale = hipHeight / pelvis.getWorldPosition(new Vector3()).y;

  const clips = new Map<string, Clip>();
  for (const [name, file] of Object.entries(RETARGETED_CLIPS)) {
    const doc = sources.get(file);
    const animation = doc?.getRoot().listAnimations()[0];
    if (!doc || !animation) throw new Error(`Mesh2Motion clip ${file} not found`);
    const source = threeTree(doc, file);
    const clip = threeClip(animation, file);
    // three's retarget reads `localOffsets` (a rotation per joint, after the source's world rotation), which
    // @types/three doesn't declare: the options go in as a variable, not a literal.
    const options: RetargetClipOptions & { localOffsets: Record<string, Matrix4> } = { names: FROM_MESH2MOTION, hip: 'pelvis', scale, localOffsets, fps: 30 };
    const retargeted = retargetClip(rig.mesh, source, clip, options);
    rig.mesh.skeleton.pose();
    const tracks = tracksOf(retargeted).filter((t) => !atRest(t, rest)).map(continuous);
    clips.set(name, { name, tracks });
    report.push({ name, from: `Mesh2Motion ${file}`, seconds: retargeted.duration, tracks: tracks.length, before: animation.listChannels().length });
  }
  return clips;
}
