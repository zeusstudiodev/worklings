// Everyone in the office, advanced from one loop: where each person is (walks, glides and turns on the cast's clock,
// as v2's people moved), what their body plays (plan.ts) with sitting down and standing up between seated and standing
// poses, and how often their mixer runs. People off screen update every fourth frame and people under 16 px ten times
// a second, with the time saved up so nobody jumps; still people aren't touched at all.
import { type AnimationClip, type Camera, Frustum, Matrix4, type Object3D, type OrthographicCamera, Sphere, Vector3 } from 'three';
import type { LookBody } from '../../../../src/core/looks.ts';
import { type Body, loadBody, loadClips } from '../art/loader.ts';
import type { BodyDetail, ClipName } from '../art/spec.ts';
import { type CastMember, gazeAt, placeOn } from '../cast.ts';
import { HEAD_DOWN_MS, HEAD_UP_MS } from '../moments.ts';
import type { BodyState, Pose } from '../poses.ts';
import { walkMs } from '../walk.ts';
import { type Dress, dressFor } from './dress.ts';
import { type Plan, planFor, STRIDE } from './plan.ts';
import { PropKit } from './props.ts';
import { PersonRig } from './rig.ts';
import { BlobShadows } from './shadows.ts';

/** How far the seated clips put the hips behind the body's origin: seated, the body moves forward so the hips sit on the chair. */
const SIT_FORWARD = 0.397;
/** Sit_Chair_Down and Sit_Chair_StandUp. */
const TRANSITION_S = 0.8;
const FADE_S = 0.25;
/** game-feel.md, section 6: arrivals fade in and leavers fade out at the model's edge. */
const PRESENCE_MS = 400;
/** A person's height in units, for their size on screen. */
const HEIGHT = 2.2;
const TINY_PX = 16;
const MAX_PEOPLE = 256;
/** Someone they look at turns a seated person at work by the head, up to 60°, and an idle one by the chair, up to 45°. */
const HEAD_REACH = Math.PI / 3;
const CHAIR_REACH = Math.PI / 4;
/** Hands busy at the desk: a visitor gets a turn of the head, not of the chair. */
const AT_WORK: ReadonlySet<Pose> = new Set(['type', 'think', 'read', 'stuck']);
/** A listener nods every 2 to 4 s (their own period); a nod (scripts/art/made.ts) lasts this long. */
const LISTEN_NODS = [2, 4] as const;
const NOD_S = 0.8;
/** A pose that starts this soon waits for its moment (heads going down at nightfall, staggered); later ones don't. */
const WAIT_FOR_MS = 5000;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const towards = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const within = (v: number, reach: number) => Math.max(-reach, Math.min(reach, v));

interface Motion {
  plan: string;
  x: number;
  z: number;
  offX: number;
  offZ: number;
  glideFrom: number;
  glideMs: number;
  heading: number;
  /** Units a second, smoothed: walking clips match their pace to it. */
  speed: number;
}

interface Posture {
  /** What the body was last asked to play: pose, holding, tiredness and so on. */
  key: string;
  /** The pose it was, for how long the change takes (heads go down on folded arms slower than a usual change). */
  pose: Pose | null;
  seated: boolean;
  /** 0 standing to 1 seated: how far forward the body sits, eased through sitting down and standing up. */
  sit: number;
  /** Real time (ms) a sit-down or stand-up ends, and the plan to play after it. */
  until: number;
  after: Plan | null;
}

interface Entry {
  member: CastMember;
  group: Object3D | null;
  dress: Dress;
  dim: number;
  rig: PersonRig | null;
  /** The body and detail the rig was made from. */
  made: string;
  motion: Motion;
  posture: Posture;
  /** Seconds saved up while the mixer skipped frames. */
  lag: number;
  /** For typing's pauses: its own period, 9 to 15 s. */
  period: number;
}

export interface CrowdOptions {
  reducedMotion: boolean;
  detail: BodyDetail;
  /** The adaptive-quality governor's level: 3 stops animating people under 16 px tall. */
  quality: number;
}

export interface CrowdFrame {
  /** Someone walks, glides, turns or changes pose: the motion tier. */
  motion: boolean;
  /** Someone loops at their desk (typing, talking): the ambient tier. */
  ambient: boolean;
  /** Milliseconds the loop took, for the measurements. */
  ms: number;
}

export class Crowd {
  readonly shadows = new BlobShadows(MAX_PEOPLE);
  readonly props = new PropKit();
  private readonly entries = new Map<string, Entry>();
  private clips: ReadonlyMap<string, AnimationClip> | null = null;
  private readonly bodies = new Map<string, Body>();
  private readonly waiting = new Set<string>();
  private options: CrowdOptions;
  private frame = 0;
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly sphere = new Sphere(new Vector3(), 1.5);
  private disposed = false;
  private onReady: () => void = () => {};
  private onError: (error: unknown) => void = () => {};

  /**
   * `options` are the first configure(): the people who join before it runs (their layout effects run before their
   * parent's) are built with the detail they will keep, so a phone fetches the low-detail bodies only.
   */
  constructor(options: CrowdOptions = { reducedMotion: false, detail: 'full', quality: 0 }) {
    this.options = options;
    loadClips().then(
      (clips) => {
        this.clips = clips;
        if (this.disposed) return;
        for (const entry of this.entries.values()) this.build(entry);
        this.onReady();
      },
      (error: unknown) => this.onError(error),
    );
  }

  /**
   * `ready`: something new can be drawn (a body or the clips arrived). `failed`: the art can't load; the people stay
   * out, and the labels and the panels still carry everything.
   */
  listen(ready: () => void, failed: (error: unknown) => void): void {
    this.onReady = ready;
    this.onError = failed;
  }

  configure(options: CrowdOptions): void {
    const detailChanged = options.detail !== this.options.detail;
    this.options = options;
    if (detailChanged) for (const entry of this.entries.values()) this.build(entry);
  }

  /** A person joins (their group is mounted) or their cast member changes. */
  set(member: CastMember, group: Object3D): void {
    this.disposed = false;
    const existing = this.entries.get(member.key);
    const dim = member.body.visitor ? 0 : (member.status === 'off' || member.status === 'done') && !member.meeting && !member.person ? 0.55 : 0;
    const dress = dressFor({ key: member.look, look: member.body.outfit, hue: member.hue, visitor: member.body.visitor });
    if (existing) {
      existing.member = member;
      existing.group = group;
      const redress = JSON.stringify(existing.dress) !== JSON.stringify(dress) || existing.dim !== dim;
      existing.dress = dress;
      existing.dim = dim;
      if (existing.made !== this.bodyKey(dress.body)) this.build(existing);
      else if (redress) existing.rig?.dress(dress, dim);
      return;
    }
    const entry: Entry = {
      member,
      group,
      dress,
      dim,
      rig: null,
      made: '',
      motion: { plan: '', x: Number.NaN, z: Number.NaN, offX: 0, offZ: 0, glideFrom: 0, glideMs: 0, heading: 0, speed: 0 },
      posture: { key: '', pose: null, seated: member.seated, sit: member.seated ? 1 : 0, until: 0, after: null },
      lag: 0,
      period: 9 + (Math.floor(dress.phase * 1000) % 7),
    };
    this.entries.set(member.key, entry);
    this.build(entry);
  }

  remove(key: string): void {
    const entry = this.entries.get(key);
    entry?.rig?.dispose();
    this.entries.delete(key);
  }

  private bodyKey(body: LookBody): string {
    return `${body}:${this.options.detail}`;
  }

  /** Makes (or remakes) a person's rig once their body and the clips are loaded. */
  private build(entry: Entry): void {
    const key = this.bodyKey(entry.dress.body);
    const body = this.bodies.get(key);
    if (!body || !this.clips) {
      if (!this.waiting.has(key) && !body) {
        this.waiting.add(key);
        loadBody(entry.dress.body, this.options.detail).then(
          (loaded) => {
            this.waiting.delete(key);
            this.bodies.set(key, loaded);
            if (this.disposed) return;
            for (const e of this.entries.values()) if (this.bodyKey(e.dress.body) === key && e.made !== key) this.build(e);
            this.onReady();
          },
          (error: unknown) => {
            this.waiting.delete(key);
            this.onError(error);
          },
        );
      }
      return;
    }
    entry.rig?.dispose();
    entry.rig = new PersonRig(body, this.clips, entry.dress, entry.dim, this.props);
    entry.made = key;
    entry.posture.key = '';
    entry.group?.add(entry.rig.root);
  }

  /** Advances everyone: one call a rendered frame. */
  update(dt: number, real: number, now: number, camera: Camera): CrowdFrame {
    const t0 = performance.now();
    const { reducedMotion } = this.options;
    this.frame++;
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    const zoom = (camera as OrthographicCamera).isOrthographicCamera ? (camera as OrthographicCamera).zoom : 40;
    const tiny = HEIGHT * zoom < TINY_PX;
    let motion = false;
    let ambient = false;
    let shown = 0;
    let index = 0;
    for (const entry of this.entries.values()) {
      index++;
      const { member } = entry;
      const group = entry.group;
      if (!group) continue;
      const placed = this.place(entry, real, now, dt);
      motion ||= placed.moving;
      const rig = entry.rig;
      if (!rig) continue;

      // What the body plays: the cast's pose, except that whoever is actually on the move walks.
      const body: BodyState = placed.walking ? { ...member.body, pose: 'walk' } : member.body.pose === 'walk' ? { ...member.body, pose: 'stand' } : member.body;
      const seated = placed.walking ? false : member.seated;
      // A pose waiting for its moment keeps frames coming (the ambient rate is close enough) until it starts.
      if (this.pose(entry, rig, body, seated, now, real)) ambient = true;
      rig.look(placed.yaw, reducedMotion);

      // Typing pauses now and then for a few seconds, each person on their own period.
      if (body.pose === 'type' && !reducedMotion) {
        const p = ((now / 1000 + entry.dress.phase * entry.period) % entry.period) / entry.period;
        const w = p < 0.78 ? 1 : p < 0.82 ? 1 - ease((p - 0.78) / 0.04) : p < 0.95 ? 0 : ease((p - 0.95) / 0.05);
        rig.weigh('Typing', w);
      }
      // A listener nods now and then: the nod's 0.8 s once a period, weightless between.
      if (body.pose === 'listen' && !reducedMotion) {
        const period = LISTEN_NODS[0] + (LISTEN_NODS[1] - LISTEN_NODS[0]) * entry.dress.phase;
        const t = (((now / 1000 + entry.dress.phase * period) % period) + period) % period;
        rig.scrub('Nodding', Math.min(t, NOD_S), t < NOD_S ? 1 : 0);
      }
      if (placed.walking) for (const [clip, stride] of Object.entries(STRIDE)) rig.pace(clip as ClipName, Math.min(3, Math.max(0.5, entry.motion.speed / stride)));

      // Seated, the body sits forward so the hips land on the chair; it eases there while sitting down or getting up.
      const s = entry.posture;
      const target = seated ? 1 : 0;
      if (s.until > real && !reducedMotion) s.sit = Math.min(1, Math.max(0, s.sit + (target - s.sit) * Math.min(1, dt / Math.max(0.05, (s.until - real) / 1000))));
      else s.sit = target;
      rig.root.position.z = SIT_FORWARD * s.sit;

      // Arriving or leaving: grow from and shrink to nothing at the model's edge (a fade on skinned toys sorts badly).
      const presence = this.presence(member, now);
      group.visible = presence > 0;
      rig.root.scale.setScalar(Math.max(0.001, presence));
      if (presence > 0 && presence < 1) motion = true;

      // The mixer: every frame on screen, every fourth off it, ten times a second when tiny; never while still.
      this.sphere.center.set(group.position.x, 1.1, group.position.z);
      const visible = this.frustum.intersectsSphere(this.sphere);
      entry.lag += dt;
      const every = !visible ? 4 : tiny ? 6 : 1;
      const frozen = tiny && this.options.quality >= 3 && visible;
      if (rig.moving && !frozen) {
        if (this.frame % every === index % every) {
          rig.tick(entry.lag);
          entry.lag = 0;
        }
        if (visible) {
          if (s.until > real || placed.moving) motion = true;
          else ambient = true;
        }
      } else entry.lag = 0;

      if (presence > 0 && shown < this.shadows.capacity) this.shadows.set(shown++, group.position.x, group.position.z, (seated ? 1.5 : 1.25) * presence);
    }
    this.shadows.show(shown);
    return { motion, ambient, ms: performance.now() - t0 };
  }

  /** Where someone is now, as v2 placed people: on a walk, at a meeting, or home, gliding on from wherever a new plan finds them. */
  private place(entry: Entry, real: number, now: number, dt: number): { moving: boolean; walking: boolean; yaw: number } {
    const { member, motion: s } = entry;
    const group = entry.group as Object3D;
    const reduced = this.options.reducedMotion;
    const home = { x: member.x, z: member.z };
    const at = reduced ? { ...home, heading: null, away: false } : placeOn(member.walk, home, now);
    const plan = `${member.x.toFixed(3)},${member.z.toFixed(3)}|${member.walk.map((l) => `${l.at}+${l.ms}`).join(',')}`;
    const first = Number.isNaN(s.x);
    if (first) {
      s.x = at.x;
      s.z = at.z;
      s.plan = plan;
    } else if (s.plan !== plan) {
      s.plan = plan;
      s.offX = s.x - at.x;
      s.offZ = s.z - at.z;
      s.glideFrom = real;
      s.glideMs = reduced ? 0 : walkMs(Math.hypot(s.offX, s.offZ));
    }
    let left = 0;
    if (s.glideMs > 0) {
      const t = (real - s.glideFrom) / s.glideMs;
      if (t >= 1) s.glideMs = 0;
      else left = 1 - ease(t);
    }
    const x = at.x + s.offX * left;
    const z = at.z + s.offZ * left;
    const dx = x - s.x;
    const dz = z - s.z;
    const step = Math.hypot(dx, dz);
    const walking = !reduced && step > 1e-3;
    s.speed = dt > 0 ? s.speed + (step / dt - s.speed) * Math.min(1, dt * 8) : s.speed;
    s.x = x;
    s.z = z;
    group.position.set(x, 0, z);
    // Facing: the way they walk; otherwise their own way (a desk, the counter, a lounge seat, the CEO's board), turned
    // toward whoever they look at: all the way standing, by the head at work, by the chair when idle, not asleep.
    const toward = walking ? null : gazeAt(member.gaze, now);
    let heading = walking ? Math.atan2(dx, dz) : member.facing;
    let yaw = 0;
    if (toward) {
      const want = Math.atan2(toward.x - x, toward.z - z);
      const off = towards(member.facing, want);
      if (!member.seated) heading = want;
      else if (AT_WORK.has(member.body.pose)) yaw = within(off, HEAD_REACH);
      else if (member.body.pose !== 'sleep') heading = member.facing + within(off, CHAIR_REACH);
    }
    // Someone the office opens on already faces their way.
    const turn = first ? 0 : towards(s.heading, heading);
    const next = reduced || first ? heading : s.heading + turn * Math.min(1, dt * 10);
    s.heading = Math.atan2(Math.sin(next), Math.cos(next));
    group.rotation.y = s.heading;
    return { moving: walking || at.away || s.glideMs > 0 || Math.abs(turn) > 1e-3, walking, yaw };
  }

  /**
   * Plays the body's pose, getting up or sitting down first when it moves between a chair and standing. A pose that
   * begins a moment from now waits for it; returns true while one does.
   */
  private pose(entry: Entry, rig: PersonRig, body: BodyState, seated: boolean, now: number, real: number): boolean {
    const s = entry.posture;
    const reduced = this.options.reducedMotion;
    if (s.after && real >= s.until) {
      rig.play(s.after, FADE_S);
      s.after = null;
    }
    const key = `${body.pose}|${body.holding}|${body.tired}|${body.restPose}|${seated}|${reduced}|${body.pose === 'nod' || body.pose === 'pickup' ? body.since : ''}`;
    if (key === s.key) {
      rig.hold(body.holding, entry.member.hue, entry.member.papers);
      return false;
    }
    // Heads go down at nightfall and come up in the morning one by one: the cast staggers `since`. The office opening
    // on someone shows them as they are.
    if (!reduced && s.key !== '' && body.since > now && body.since - now < WAIT_FOR_MS) return true;
    rig.hold(body.holding, entry.member.hue, entry.member.papers);
    const fade = reduced ? 0 : body.pose === 'sleep' ? HEAD_DOWN_MS / 1000 : s.pose === 'sleep' ? HEAD_UP_MS / 1000 : FADE_S;
    s.key = key;
    s.pose = body.pose;
    const plan = planFor(body, { reducedMotion: reduced, phase: entry.dress.phase, pace: entry.dress.pace, elapsed: Math.max(0, (now - body.since) / 1000), seated });
    const between = s.seated !== seated && !reduced && body.pose !== 'walk' && entry.made !== '';
    s.seated = seated;
    if (between) {
      const clip: ClipName = seated ? 'Sit_Chair_Down' : 'Sit_Chair_StandUp';
      rig.play({ base: { clip, mode: 'once', at: 0, elapsed: 0, timeScale: 1, weight: 1 }, layers: [], seated, holding: body.holding, live: true }, FADE_S);
      s.until = real + TRANSITION_S * 1000;
      s.after = plan;
      return false;
    }
    s.after = null;
    s.until = 0;
    rig.play(plan, fade);
    return false;
  }

  private presence(member: CastMember, now: number): number {
    const { from, until } = member.presence;
    let p = 1;
    if (from !== null) p = Math.min(p, Math.max(0, Math.min(1, (now - from) / PRESENCE_MS)));
    if (until !== null) p = Math.min(p, Math.max(0, Math.min(1, (until - now) / PRESENCE_MS)));
    return this.options.reducedMotion ? (p > 0 ? 1 : 0) : p;
  }

  /**
   * Frees everyone and the GPU's copies of the shared meshes. A crowd mounted again (React's strict mode does it) comes
   * back as people join: three makes the GPU copies again, and the loaded bodies and clips are kept.
   */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.rig?.dispose();
    this.entries.clear();
    this.shadows.dispose();
    this.props.dispose();
  }
}
