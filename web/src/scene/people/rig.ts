// One person's body: a SkeletonUtils clone of a KayKit body with its own mixer and outfit, playing a plan (plan.ts)
// with crossfades, holding a prop in the hand slot or at the chest, and costing nothing a frame while still.
import {
  type AnimationAction,
  type AnimationClip,
  type AnimationMixer,
  DataTexture,
  LoopOnce,
  LoopRepeat,
  Mesh,
  Object3D,
  Quaternion,
  Sphere,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';
import { type Body, makePerson } from '../art/loader.ts';
import type { ClipName } from '../art/spec.ts';
import type { Holding } from '../poses.ts';
import type { Dress } from './dress.ts';
import { type OutfitMaterial, outfitMaterial, setOutfit } from './material.ts';
import type { Plan, Track } from './plan.ts';
import { PROP_ANCHOR, type PropKind, type PropKit } from './props.ts';

/** People live on this layer: the contact shadow's camera doesn't see it, the main camera and picking do. */
export const PEOPLE_LAYER = 1;
/** Rows of gradient blocks in each body's atlas (the build's role tables use the same grids). */
const ATLAS_ROWS = { mannequin: 2, knight: 4, barbarian: 4, mage: 4, rogue: 4, ranger: 4 } as const;
/** Where KayKit's right weapon slot sat on the hand bone before the build removed it: props held in a fist go here. */
const HAND_SLOT = { position: [0, 0.096, -0.058], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } as const;
/** In front of the chest, where both hands carry a plant or a laptop. */
const CHEST = { position: [0, -0.12, 0.44], pitch: -0.22 } as const;
/** A person's bounds for culling, fixed: computing them from skinned vertices on every pose would cost more. */
const BOUNDS = new Sphere(new Vector3(0, 1.1, 0), 1.5);
/** The head turns toward whoever they look at at this rate (per second, of what's left), and settles within this. */
const HEAD_TURN = 8;
const HEAD_SETTLED = 1e-3;
const UP = new Vector3(0, 1, 0);
const turn = new Quaternion();

let white: Texture | null = null;
/** Stands in for an atlas that failed to load, so the outfit shader still compiles (it reads the map's UVs). */
function whiteMap(): Texture {
  white ??= Object.assign(new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), { colorSpace: SRGBColorSpace, needsUpdate: true });
  return white;
}

export class PersonRig {
  readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly material: OutfitMaterial;
  private readonly action: (name: ClipName) => AnimationAction;
  private readonly anchors: Record<'hand' | 'chest' | 'head', Object3D>;
  private readonly clips: ReadonlyMap<string, AnimationClip>;
  private active = new Map<ClipName, AnimationAction>();
  private held: { kind: PropKind; hue: string; sheets: number; mesh: Mesh } | null = null;
  private worn: Mesh | null = null;
  private live = false;
  /** Seconds left of a crossfade: the mixer runs until the fade is done, even for still frames. */
  private settling = 0;
  private planKey = '';
  private readonly props: PropKit;
  /** The head bone, and its pose from the clips before the head turns toward someone (rotation about its own up). */
  private readonly head: Object3D;
  private readonly headPose = new Quaternion();
  private headYaw = 0;
  private headWant = 0;
  private headRate = HEAD_TURN;

  constructor(body: Body, clips: ReadonlyMap<string, AnimationClip>, dress: Dress, dim: number, props: PropKit) {
    this.props = props;
    const person = makePerson(body, clips);
    this.root = person.root;
    this.mixer = person.mixer;
    this.action = person.action;
    this.clips = clips;
    const source = person.mesh.material as { map?: Texture | null };
    this.material = outfitMaterial(source.map ?? whiteMap(), ATLAS_ROWS[body.id], dress.outfit, dim);
    person.mesh.material = this.material;
    person.mesh.boundingSphere = BOUNDS.clone();
    person.mesh.castShadow = false;
    person.mesh.receiveShadow = true;
    const bone = (name: string) => {
      const b = this.root.getObjectByName(name);
      if (!b) throw new Error(`${body.id} has no ${name} bone`);
      return b;
    };
    const slot = new Object3D();
    slot.name = 'hand-slot';
    slot.position.fromArray(HAND_SLOT.position);
    slot.quaternion.fromArray(HAND_SLOT.quaternion);
    bone('handr').add(slot);
    const chest = new Object3D();
    chest.name = 'chest-carry';
    chest.position.fromArray(CHEST.position);
    chest.rotation.set(CHEST.pitch, 0, 0);
    bone('chest').add(chest);
    this.head = bone('head');
    this.headPose.copy(this.head.quaternion);
    this.anchors = { hand: slot, chest, head: this.head };
    this.root.traverse((o) => o.layers.set(PEOPLE_LAYER));
    this.dress(dress, dim);
  }

  /** New colours or a new worn prop, without rebuilding the person. */
  dress(dress: Dress, dim: number): void {
    setOutfit(this.material, dress.outfit, dim);
    const wantsHeadset = dress.prop === 'headset';
    if (wantsHeadset && !this.worn) {
      this.worn = new Mesh(this.props.geometry('headset', dress.outfit.top), this.props.material);
      this.worn.layers.set(PEOPLE_LAYER);
      this.anchors.head.add(this.worn);
    } else if (!wantsHeadset && this.worn) {
      this.worn.removeFromParent();
      this.worn = null;
    }
  }

  /** What is in their hand: `sheets` papers make a thicker stack. */
  hold(holding: Holding, hue: string, sheets = 1): void {
    if (holding === 'none') {
      this.held?.mesh.removeFromParent();
      this.held = null;
      return;
    }
    if (this.held?.kind === holding && this.held.hue === hue && this.held.sheets === sheets) return;
    this.held?.mesh.removeFromParent();
    const mesh = new Mesh(this.props.geometry(holding, hue, sheets), this.props.material);
    mesh.layers.set(PEOPLE_LAYER);
    mesh.frustumCulled = false;
    this.anchors[PROP_ANCHOR[holding]].add(mesh);
    this.held = { kind: holding, hue, sheets, mesh };
  }

  private duration(name: ClipName): number {
    return this.clips.get(name)?.duration ?? 1;
  }

  /** Plays a plan, crossfading from whatever played before. The same plan again changes nothing. */
  play(plan: Plan, fade: number): void {
    // How far into a one-off the person was when the plan was made isn't part of what it plays.
    const key = JSON.stringify([plan.base, plan.layers].flat().map(({ elapsed: _, ...t }) => t));
    if (key === this.planKey) return;
    this.planKey = key;
    const wanted = new Map<ClipName, Track>();
    for (const t of [plan.base, ...plan.layers]) wanted.set(t.clip, t);
    for (const [name, action] of this.active) {
      if (wanted.has(name)) continue;
      if (fade > 0) action.fadeOut(fade);
      else action.stop();
      this.active.delete(name);
    }
    for (const [name, t] of wanted) {
      const action = this.action(name);
      const duration = this.duration(name);
      const fresh = !this.active.has(name);
      if (fresh) action.reset();
      action.setLoop(t.mode === 'once' ? LoopOnce : LoopRepeat, t.mode === 'once' ? 1 : Number.POSITIVE_INFINITY);
      action.clampWhenFinished = t.mode === 'once';
      action.timeScale = t.timeScale;
      if (t.mode === 'still') {
        action.paused = true;
        action.time = Math.min(t.at, 0.999) * duration;
      } else {
        action.paused = false;
        if (fresh) action.time = t.mode === 'once' ? Math.min(t.elapsed, duration) : t.at * duration;
      }
      if (fresh) {
        action.setEffectiveWeight(t.weight);
        if (fade > 0) action.fadeIn(fade);
        action.play();
      } else action.setEffectiveWeight(t.weight);
      this.active.set(name, action);
    }
    this.live = plan.live;
    this.settling = Math.max(fade, 0) + 0.05;
  }

  /** Scales one playing clip's speed, as walking does to match the pace. */
  pace(name: ClipName, timeScale: number): void {
    const action = this.active.get(name);
    if (action && !action.paused) action.timeScale = timeScale;
  }

  /** Fades a layer in or out by weight, as typing does when someone pauses. */
  weigh(name: ClipName, weight: number): void {
    this.active.get(name)?.setEffectiveWeight(weight);
  }

  /** Puts a playing layer at `seconds` with `weight`, as a listener's nods do every few seconds. */
  scrub(name: ClipName, seconds: number, weight: number): void {
    const action = this.active.get(name);
    if (!action) return;
    action.time = seconds;
    action.setEffectiveWeight(weight);
  }

  /** Turns the head toward someone, `yaw` radians from where the body faces (0 looks ahead): eased, or at once. */
  look(yaw: number, atOnce = false): void {
    this.headWant = yaw;
    this.headRate = atOnce ? Number.POSITIVE_INFINITY : HEAD_TURN;
  }

  /** True while the body moves on its own: a loop, a one-off, a crossfade or the head turning. */
  get moving(): boolean {
    return this.live || this.settling > 0 || Math.abs(this.headWant - this.headYaw) > HEAD_SETTLED;
  }

  /** Advances the body; a still body isn't touched. */
  tick(dt: number): void {
    if (!this.moving) return;
    if (this.live || this.settling > 0) {
      // Back to the clips' own head first, in case none of them moves it, so the turn never adds up.
      this.head.quaternion.copy(this.headPose);
      this.mixer.update(dt);
      this.settling = Math.max(0, this.settling - dt);
      this.headPose.copy(this.head.quaternion);
    }
    const left = this.headWant - this.headYaw;
    this.headYaw = Math.abs(left) <= HEAD_SETTLED || this.headRate === Number.POSITIVE_INFINITY ? this.headWant : this.headYaw + left * Math.min(1, dt * this.headRate);
    this.head.quaternion.copy(this.headPose).multiply(turn.setFromAxisAngle(UP, this.headYaw));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.material.dispose();
    this.root.removeFromParent();
  }
}
