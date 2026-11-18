// The launch film's camera (scripts/launch/film/): lets the film's director fly the camera over the lobby and through an
// office in smooth, scripted moves. Only a build made with VITE_WORKLINGS_FILM=1 has it: the stages mount it behind
// `import.meta.env.VITE_WORKLINGS_FILM === '1'`, written out at each place so every other build drops it whole (a
// constant imported from here was not dropped), and the office people run never has it.
import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect } from 'react';
import { type OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { LabelContext } from './labels.tsx';

/** A camera as the director writes it: where it looks, from which side (degrees), and how close (pixels per unit). */
export interface FilmPose {
  target: [number, number, number];
  /** Around the vertical, 0 looking from +z toward -z; the office's resting view is 45. */
  azimuth: number;
  /** From straight down (0) toward the horizon (90); the office's resting view is about 47.7. */
  polar: number;
  zoom: number;
}

/** One point of a move: a pose and where it falls in the move, 0 to 1. */
export interface FilmKey extends FilmPose {
  at: number;
}

type Ease = 'inOut' | 'out' | 'linear';

interface Move {
  keys: FilmKey[];
  start: number;
  ms: number;
  /** 'inOut' eases the whole move; 'out' starts at speed and settles (a shot that opens in motion); 'linear' keeps an even speed. */
  ease: Ease;
}

interface Hold {
  move: Move | null;
  pose: FilmPose | null;
}

declare global {
  interface Window {
    __worklingsFilm?: Record<string, FilmApi>;
  }
}

/** What the director calls, as `window.__worklingsFilm[stage]`. */
interface FilmApi {
  /** The camera now. */
  pose(): FilmPose;
  /** Holds the camera at a pose until released. */
  set(pose: FilmPose): void;
  /** Plays a move through `keys` over `seconds`; resolves when it ends, and the camera holds its last pose. */
  play(keys: FilmKey[], seconds: number, ease?: Ease): Promise<void>;
  /** Where the ground (y = `height`) is under a point of the canvas, in CSS pixels from its top left. */
  ground(x: number, y: number, height?: number): [number, number, number] | null;
  /** Every label anchor's place in the world (people, desks, room signs, lobby worlds), by the label's id. */
  anchors(): Record<string, [number, number, number]>;
  /** Hands the camera back to the stage. */
  release(): void;
}

const DISTANCE = 90;
const RAD = Math.PI / 180;
const EASES: Record<Ease, (t: number) => number> = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  linear: (t) => t,
};

function poseOf(camera: OrthographicCamera, controls: unknown): FilmPose {
  const c = controls as { target?: unknown } | null;
  const target = c && c.target instanceof Vector3 ? c.target.clone() : camera.position.clone().add(camera.getWorldDirection(new Vector3()).multiplyScalar(DISTANCE));
  const d = camera.position.clone().sub(target).normalize();
  return { target: [target.x, target.y, target.z], azimuth: Math.atan2(d.x, d.z) / RAD, polar: Math.acos(Math.min(1, Math.max(-1, d.y))) / RAD, zoom: camera.zoom };
}

function apply(camera: OrthographicCamera, controls: unknown, pose: FilmPose) {
  const t = new Vector3(...pose.target);
  const a = pose.azimuth * RAD;
  const p = pose.polar * RAD;
  const dir = new Vector3(Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a));
  camera.position.copy(t).addScaledVector(dir, DISTANCE);
  camera.up.set(0, 1, 0);
  camera.lookAt(t);
  camera.zoom = pose.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const c = controls as { target?: unknown } | null;
  if (c && c.target instanceof Vector3) c.target.copy(t);
}

/** Catmull-Rom through the keys on each channel (zoom in log scale), so a move through several keys never kinks. */
function sample(keys: FilmKey[], u: number): FilmPose {
  const first = keys[0];
  if (!first) throw new Error('A move needs keys.');
  if (keys.length === 1 || u <= first.at) return first;
  const i = keys.findIndex((k, n) => n > 0 && u <= k.at);
  if (i < 0) return keys[keys.length - 1] ?? first;
  const k1 = keys[i - 1] ?? first;
  const k2 = keys[i] ?? first;
  const k0 = keys[i - 2] ?? k1;
  const k3 = keys[i + 1] ?? k2;
  const s = (u - k1.at) / Math.max(1e-6, k2.at - k1.at);
  const chan = (f: (k: FilmKey) => number) => {
    const p0 = f(k0);
    const p1 = f(k1);
    const p2 = f(k2);
    const p3 = f(k3);
    // Tangents scaled by each segment's length in `at`, so uneven keys keep an even speed through them.
    const span = k2.at - k1.at;
    const m1 = k1 === k0 ? 0 : ((p2 - p0) / Math.max(1e-6, k2.at - k0.at)) * span;
    const m2 = k3 === k2 ? 0 : ((p3 - p1) / Math.max(1e-6, k3.at - k1.at)) * span;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * p1 + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2 + (s3 - s2) * m2;
  };
  return {
    target: [chan((k) => k.target[0]), chan((k) => k.target[1]), chan((k) => k.target[2])],
    azimuth: chan((k) => k.azimuth),
    polar: chan((k) => k.polar),
    zoom: Math.exp(chan((k) => Math.log(k.zoom))),
  };
}

/** Inside a stage's canvas: answers the director as `window.__worklingsFilm[stage]` and holds the camera it sets. */
export function FilmCamera({ stage }: { stage: string }) {
  const get = useThree((s) => s.get);
  const labels = useContext(LabelContext);
  useEffect(() => {
    const state: Hold = { move: null, pose: null };
    const done = new Set<() => void>();
    const ray = new Raycaster();
    const api: FilmApi = {
      pose: () => {
        const s = get();
        return poseOf(s.camera as OrthographicCamera, s.controls);
      },
      set(pose) {
        state.move = null;
        state.pose = pose;
        get().invalidate();
      },
      play(keys, seconds, ease = 'inOut') {
        state.move = { keys: [...keys].sort((a, b) => a.at - b.at), start: performance.now(), ms: seconds * 1000, ease };
        get().invalidate();
        return new Promise((resolve) => done.add(resolve));
      },
      ground(x, y, height = 0) {
        const s = get();
        ray.setFromCamera(new Vector2((x / s.size.width) * 2 - 1, -(y / s.size.height) * 2 + 1), s.camera);
        const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -height), new Vector3());
        return hit ? [hit.x, hit.y, hit.z] : null;
      },
      anchors() {
        const out: Record<string, [number, number, number]> = {};
        const v = new Vector3();
        for (const [id, a] of labels?.anchors ?? []) {
          if ('point' in a) v.copy(a.point);
          else a.object.getWorldPosition(v).add(new Vector3(0, a.lift, 0));
          out[id] = [v.x, v.y, v.z];
        }
        return out;
      },
      release() {
        state.move = null;
        state.pose = null;
      },
    };
    const all = (window.__worklingsFilm ??= {});
    all[stage] = api;
    const tick = () => {
      const m = state.move;
      if (!m) return;
      const k = Math.min(1, (performance.now() - m.start) / m.ms);
      state.pose = sample(m.keys, EASES[m.ease](k));
      if (k >= 1) {
        state.move = null;
        for (const f of done) f();
        done.clear();
      }
    };
    ticks.set(stage, { tick, pose: () => state.pose });
    return () => {
      // A stage that goes (the lobby, once a world is entered) ends its move: the director isn't left waiting.
      for (const f of done) f();
      ticks.delete(stage);
      if (all[stage] === api) delete all[stage];
    };
  }, [get, stage, labels]);
  // After the controls and the stage's own camera moves (priority -1), before the labels follow the camera (0).
  useFrame((s) => {
    const t = ticks.get(stage);
    if (!t) return;
    t.tick();
    const pose = t.pose();
    if (!pose) return;
    apply(s.camera as OrthographicCamera, s.controls, pose);
    s.invalidate();
  }, -0.5);
  return null;
}

const ticks = new Map<string, { tick: () => void; pose: () => FilmPose | null }>();

/** Whether the director holds this stage's camera (the lobby's own way in then leaves the camera alone). */
export function filmHolds(stage: string): boolean {
  return (ticks.get(stage)?.pose() ?? null) !== null;
}
