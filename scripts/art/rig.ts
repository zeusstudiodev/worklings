// The one skeleton: KayKit's medium rig as every body and clip shares it. Reads and checks it in the packs, writes it
// into built files, and moves animation between glTF channels and three.js clips, so retargeting and the typing layer
// can use three's own SkeletonUtils and AnimationUtils, exactly as the browser will play them.
import type { Animation, Buffer, Document, Node } from '@gltf-transform/core';
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  InterpolateDiscrete,
  InterpolateLinear,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { JOINT_PARENT, JOINTS, type Joint } from '../../web/src/scene/art/spec.ts';
import { floats, threeName } from './gltf.ts';

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface RestJoint {
  t: Vec3;
  r: Vec4;
  s: Vec3;
}
export type Rest = ReadonlyMap<Joint, RestJoint>;

export const isJoint = (name: string): name is Joint => (JOINTS as readonly string[]).includes(name);

function nodesByName(doc: Document): Map<string, Node> {
  return new Map(doc.getRoot().listNodes().map((n) => [threeName(n.getName()), n]));
}

/** The rest pose of every joint in a pack file, checked for the medium rig's hierarchy. */
export function readRest(doc: Document, label: string): Rest {
  const nodes = nodesByName(doc);
  const rest = new Map<Joint, RestJoint>();
  for (const joint of JOINTS) {
    const node = nodes.get(joint);
    if (!node) throw new Error(`${label}: the medium rig has no joint ${joint}`);
    const expected = JOINT_PARENT[joint];
    const parent = node.getParentNode();
    if (expected !== null && (parent ? threeName(parent.getName()) : null) !== expected) {
      throw new Error(`${label}: joint ${joint} hangs under ${parent?.getName() ?? 'nothing'}, not ${expected}`);
    }
    rest.set(joint, { t: node.getTranslation(), r: node.getRotation(), s: node.getScale() });
  }
  return rest;
}

/** How another file's rig differs from the rest pose, in words; empty when it matches. */
export function restDifferences(rest: Rest, other: Rest, label: string, tolerance = 1e-4): string[] {
  const problems: string[] = [];
  for (const joint of JOINTS) {
    const a = rest.get(joint);
    const b = other.get(joint);
    if (!a || !b) continue;
    const dt = Math.max(...a.t.map((v, i) => Math.abs(v - (b.t[i] ?? 0))));
    const ds = Math.max(...a.s.map((v, i) => Math.abs(v - (b.s[i] ?? 0))));
    const dot = Math.abs(a.r.reduce((sum, v, i) => sum + v * (b.r[i] ?? 0), 0));
    if (dt > tolerance || ds > tolerance || 1 - dot > tolerance) {
      problems.push(`${label}: ${joint} rests at a different place (moved ${dt.toFixed(5)}, turned ${(1 - dot).toExponential(1)})`);
    }
  }
  return problems;
}

/** Adds the skeleton to a built file: one node per joint, parents linked. */
export function addSkeleton(doc: Document, rest: Rest): Map<Joint, Node> {
  const nodes = new Map<Joint, Node>();
  for (const joint of JOINTS) {
    const r = restOf(rest, joint);
    const node = doc.createNode(joint).setTranslation(r.t).setRotation(r.r).setScale(r.s);
    nodes.set(joint, node);
    const parent = JOINT_PARENT[joint];
    if (parent) nodeOf(nodes, parent).addChild(node);
  }
  return nodes;
}

export function restOf(rest: Rest, joint: Joint): RestJoint {
  const r = rest.get(joint);
  if (!r) throw new Error(`no rest pose for ${joint}`);
  return r;
}

export function nodeOf<K>(nodes: ReadonlyMap<K, Node>, key: K): Node {
  const node = nodes.get(key);
  if (!node) throw new Error(`no node ${String(key)}`);
  return node;
}

/** Each joint's world matrix at rest, in JOINTS order. */
export function restWorld(rest: Rest): Matrix4[] {
  const world = new Map<Joint, Matrix4>();
  for (const joint of JOINTS) {
    const r = restOf(rest, joint);
    const local = new Matrix4().compose(new Vector3(...r.t), new Quaternion(...r.r), new Vector3(...r.s));
    const parent = JOINT_PARENT[joint];
    world.set(joint, parent ? new Matrix4().multiplyMatrices(world.get(parent) ?? new Matrix4(), local) : local);
  }
  return JOINTS.map((joint) => world.get(joint) ?? new Matrix4());
}

export interface ThreeRig {
  group: Object3D;
  bones: Map<Joint, Bone>;
  /** Bound to the skeleton at rest, so `skeleton.pose()` brings the rest pose back. */
  mesh: SkinnedMesh;
}

/** The skeleton as three.js bones under a group at the origin, with a bound, empty skinned mesh. */
export function threeRig(rest: Rest): ThreeRig {
  const group = new Object3D();
  const bones = new Map<Joint, Bone>();
  for (const joint of JOINTS) {
    const r = restOf(rest, joint);
    const bone = new Bone();
    bone.name = joint;
    bone.position.fromArray(r.t);
    bone.quaternion.fromArray(r.r);
    bone.scale.fromArray(r.s);
    const parent = JOINT_PARENT[joint];
    (parent ? (bones.get(parent) ?? group) : group).add(bone);
    bones.set(joint, bone);
  }
  group.updateMatrixWorld(true);
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
  group.add(mesh);
  mesh.bind(new Skeleton(JOINTS.map((joint) => bones.get(joint) ?? new Bone())));
  return { group, bones, mesh };
}

/**
 * Any file's node tree as three.js objects: its skin's joints as bones, the rest as plain objects. The returned root
 * carries a `skeleton`, which is what three's AnimationMixer and SkeletonUtils.retargetClip look bones up in.
 */
export function threeTree(doc: Document, label: string): Object3D & { skeleton: Skeleton } {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) throw new Error(`${label}: no skin`);
  const joints = new Set(skin.listJoints());
  const made = new Map<Node, Object3D>();
  const build = (node: Node): Object3D => {
    const object = joints.has(node) ? new Bone() : new Object3D();
    object.name = threeName(node.getName());
    object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation());
    object.scale.fromArray(node.getScale());
    made.set(node, object);
    for (const child of node.listChildren()) object.add(build(child));
    return object;
  };
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${label}: no scene`);
  const tree = new Object3D();
  for (const node of scene.listChildren()) tree.add(build(node));
  const bones = skin.listJoints().flatMap((node) => {
    const bone = made.get(node);
    return bone instanceof Bone ? [bone] : [];
  });
  if (bones.length !== joints.size) throw new Error(`${label}: some joints are outside the scene`);
  const root = Object.assign(tree, { skeleton: new Skeleton(bones) });
  root.updateMatrixWorld(true);
  return root;
}

const PROPERTY = { translation: 'position', rotation: 'quaternion', scale: 'scale' } as const;

/** A glTF animation as a three.js clip, tracks named the way GLTFLoader names them. */
export function threeClip(animation: Animation, label: string): AnimationClip {
  const tracks = animation.listChannels().map((channel) => {
    const node = channel.getTargetNode();
    const sampler = channel.getSampler();
    const path = channel.getTargetPath();
    if (!node || !sampler || (path !== 'translation' && path !== 'rotation' && path !== 'scale')) {
      throw new Error(`${label}: ${animation.getName()} has a channel without a node, a sampler or a TRS path`);
    }
    const input = sampler.getInput();
    const output = sampler.getOutput();
    if (!input || !output) throw new Error(`${label}: ${animation.getName()} has a sampler without data`);
    const interpolation = sampler.getInterpolation();
    if (interpolation === 'CUBICSPLINE') throw new Error(`${label}: ${animation.getName()} uses cubic splines, which the build doesn't read`);
    const name = `${threeName(node.getName())}.${PROPERTY[path]}`;
    const mode = interpolation === 'STEP' ? InterpolateDiscrete : InterpolateLinear;
    return path === 'rotation'
      ? new QuaternionKeyframeTrack(name, floats(input), floats(output), mode)
      : new VectorKeyframeTrack(name, floats(input), floats(output), mode);
  });
  return new AnimationClip(animation.getName(), -1, tracks);
}

export type Path = 'translation' | 'rotation' | 'scale';

/** One joint's animated property, sampled linearly. */
export interface Track {
  joint: Joint;
  path: Path;
  times: Float32Array;
  values: Float32Array;
}

export interface Clip {
  name: string;
  tracks: Track[];
  extras?: Record<string, unknown>;
}

const PATH_OF: Readonly<Record<string, Path>> = { position: 'translation', quaternion: 'rotation', scale: 'scale' };

/**
 * A three.js clip's tracks on the skeleton's joints. Track names may be `hips.quaternion` or, as retargetClip writes
 * them, `.bones[hips].quaternion`; tracks on anything but a joint are left out and reported through `skipped`.
 */
export function tracksOf(clip: AnimationClip, skipped: Set<string> = new Set()): Track[] {
  const tracks: Track[] = [];
  for (const track of clip.tracks) {
    const match = /^(?:\.bones\[(.+)\]|(.+))\.(position|quaternion|scale)$/.exec(track.name);
    const target = match?.[1] ?? match?.[2] ?? track.name;
    const path = PATH_OF[match?.[3] ?? ''];
    if (!path || !isJoint(target)) {
      skipped.add(target);
      continue;
    }
    if (track.getInterpolation() !== InterpolateLinear) {
      // A stepped track holds each key until the next: resampled to linear keys at the same places.
      const times: number[] = [];
      const values: number[] = [];
      const size = track.getValueSize();
      for (let k = 0; k < track.times.length; k++) {
        const value = Array.from(track.values.subarray(k * size, (k + 1) * size));
        if (k > 0) {
          times.push(Math.max((track.times[k] ?? 0) - 1e-4, times.at(-1) ?? 0));
          values.push(...Array.from(track.values.subarray((k - 1) * size, k * size)));
        }
        times.push(track.times[k] ?? 0);
        values.push(...value);
      }
      tracks.push({ joint: target, path, times: Float32Array.from(times), values: Float32Array.from(values) });
    } else tracks.push({ joint: target, path, times: Float32Array.from(track.times), values: Float32Array.from(track.values) });
  }
  return tracks;
}

/** Our tracks as a three.js clip, for posing a rig with AnimationMixer. */
export function clipOf(clip: Clip): AnimationClip {
  const tracks = clip.tracks.map((t) => {
    const name = `${t.joint}.${t.path === 'translation' ? 'position' : t.path === 'rotation' ? 'quaternion' : 'scale'}`;
    return t.path === 'rotation' ? new QuaternionKeyframeTrack(name, t.times, t.values) : new VectorKeyframeTrack(name, t.times, t.values);
  });
  return new AnimationClip(clip.name, -1, tracks);
}

function restValue(rest: Rest, track: Track): number[] {
  const r = restOf(rest, track.joint);
  return track.path === 'translation' ? r.t : track.path === 'rotation' ? r.r : r.s;
}

/** True when a track never leaves the rest pose: the mixer falls back to the rest pose for a missing track anyway. */
export function atRest(track: Track, rest: Rest): boolean {
  const target = restValue(rest, track);
  const size = target.length;
  for (let k = 0; k * size < track.values.length; k++) {
    if (track.path === 'rotation') {
      let dot = 0;
      for (let i = 0; i < 4; i++) dot += (track.values[k * 4 + i] ?? 0) * (target[i] ?? 0);
      if (1 - Math.abs(dot) > 1e-7) return false;
    } else {
      for (let i = 0; i < size; i++) if (Math.abs((track.values[k * size + i] ?? 0) - (target[i] ?? 0)) > 1e-4) return false;
    }
  }
  return true;
}

/** Keeps neighbouring quaternions on the same side, so linear interpolation never takes the long way round. */
export function continuous(track: Track): Track {
  if (track.path !== 'rotation') return track;
  const v = track.values;
  for (let k = 1; k * 4 < v.length; k++) {
    let dot = 0;
    for (let i = 0; i < 4; i++) dot += (v[k * 4 + i] ?? 0) * (v[(k - 1) * 4 + i] ?? 0);
    if (dot < 0) for (let i = 0; i < 4; i++) v[k * 4 + i] = -(v[k * 4 + i] ?? 0);
  }
  return track;
}

/** Writes a clip into a built file as a glTF animation on the skeleton's nodes. */
export function writeClip(doc: Document, buffer: Buffer, nodes: ReadonlyMap<Joint, Node>, clip: Clip): Animation {
  const animation = doc.createAnimation(clip.name);
  if (clip.extras) animation.setExtras(clip.extras);
  for (const track of clip.tracks) {
    const input = doc.createAccessor().setType('SCALAR').setArray(track.times).setBuffer(buffer);
    const output = doc
      .createAccessor()
      .setType(track.path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(track.values)
      .setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetNode(nodeOf(nodes, track.joint)).setTargetPath(track.path).setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  return animation;
}
