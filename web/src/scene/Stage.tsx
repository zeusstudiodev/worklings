// The canvas: the cutting mat, the light, the model and its people, an isometric camera that frames the building.
// Light as the art proof found it: neutral tone mapping so the palette stays true, a hemisphere and a warm key with
// soft PCF shadows and a cool fill; the static shadow map and the contact shadows under the furniture are drawn when
// the office changes, not every frame, and the static scene is memoised away from the HUD's state. Phones draw at a
// pixel ratio of at most 1.5 with the simplified bodies; an adaptive-quality governor steps down when frames run long.
// A company's moments (useCast) come in here too: night's light and dark monitors, the props MomentLayer draws, the
// frame tier, and a click on the stage seating everyone still walking in (Escape does it through the shell's one
// Escape handler, last in its order).
//
// Stage and dock (docs/design-v3.md, "Stage and dock"; docs/design-hud.md): a company's stage takes two insets, the
// camera's fit and the labels' area, and a mode the shell picks. "office" fills the window under the HUD; "mini" is the
// same canvas shrunk into the mini-map's window over a board (never a second WebGL view): it moves there by a transform
// (FLIP) while the camera frames the building as the mini-map will show it, its drawing buffer is resized once (at the
// end when it shrinks, at the start when it grows), it draws without labels at a capped frame rate, and the camera comes
// back as you left it. "covered" draws nothing (Preview, a diff, a phone's sheet over it). The camera's refits ease over
// 350 ms and the zoom keys step it 1.25 times toward whoever is open in the side panel; both jump with reduced motion.
import { Grid, MapControls } from '@react-three/drei';
import { addAfterEffect, addEffect, advance, Canvas, useFrame, useThree } from '@react-three/fiber';
import { type ComponentProps, createContext, type CSSProperties, lazy, memo, type ReactNode, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { type Camera, Color, type DirectionalLight, type HemisphereLight, type Mesh, NeutralToneMapping, type OrthographicCamera, type PointLight, type ShaderMaterial, Vector3 } from 'three';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { cropInsets, FULL_FRAME, type Insets, miniFrame, miniMove, type Rect, type StageInsets } from '../company/insets.ts';
import { miniGeometry, type MiniVariant } from '../company/shell/frameModel.ts';
import { Count } from '../company/ui/Count.tsx';
import { ContactShadows } from './art/contact.ts';
import { useMediaQuery } from '../lib/hooks.ts';
import { Building, type Selection } from './Building.tsx';
import type { CastMember, SceneClock } from './cast.ts';
import { LabelLayer } from './LabelLayer.tsx';
import { registerStage } from './flightApi.ts';
import { LabelContext, LabelProjector, LabelStore } from './labels.tsx';
import type { Layout } from './layout.ts';
import { MomentLayer } from './MomentLayer.tsx';
import { TrayAnchors } from './trayAnchors.tsx';
import type { NightRamp } from './moments.ts';
import { hash, MAT, MAT_GRID } from './palette.ts';
import { People } from './People.tsx';
import { Portraits } from './portraits/Portraits.tsx';
import { type FrameSample, Governor, walkBudget } from './people/governor.ts';
import { GpuTimer } from './people/gpuTimer.ts';
import { rimLight } from './people/material.ts';
import { PEOPLE_LAYER } from './people/rig.ts';
import type { SceneCast } from './useCast.ts';
import { modelLabel } from './alt.ts';
import { type CameraDriver, StageCamera, useStageCamera } from './stageCamera.ts';
import { FilmCamera } from './filmCamera.tsx';
import '../company/shell/frame.css';

export type { Insets, StageInsets };
export { StageCamera, useStageCamera };

/** What the shell shows of the stage: the office as the main view, the mini-map over a board, or nothing. */
export type StageMode = 'office' | 'mini' | 'covered';

/** Where the stage's box is: whole, shrinking into the mini-map's window, in it, or growing back. */
type Phase = 'office' | 'to-mini' | 'mini' | 'to-office';

interface StageProps {
  snapshot: Snapshot;
  layout: Layout;
  /** The people in the scene (useCast), shared with the HUD so both agree on who has a figure. */
  cast: CastMember[];
  clock: SceneClock;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  reducedMotion: boolean;
  /**
   * What the HUD covers at the stage's edges: one inset for both the camera and the labels (v2's office, where labels
   * keep a margin inside it), or a company's two (stage and dock: the camera's fit and the labels' area, exact).
   */
  insets: Insets | StageInsets;
  /** v2: changes whenever the camera should re-frame the building (the reset button). A company uses `camera.fit()`. */
  fitKey?: number;
  /** A company's stage and dock: the office, the mini-map over a board, or covered. Office unless given. */
  mode?: StageMode;
  /** The HUD's way to the camera (the map keys) and the mini-map's window (useStageCamera). */
  camera?: StageCamera;
  /** The conversation open with someone who has a figure (Ask aside): theirs, and on desktops the conversation to show beside them. */
  asking?: { figureKey: string; popover: ReactNode | null } | null;
  /** The Ask button on the selected person's name tag. */
  onAsk?: (member: CastMember, opener: HTMLElement) => void;
  /** Phones with the sheet at 78%: the strip above shows only who you selected or ask, and whoever needs you. */
  thumbnail?: boolean;
  /** Progress beside the office: only urgent bubbles over the people (LabelLayer). */
  quiet?: boolean;
  /**
   * v3: the rest of useCast's result: night, the moments' props, the frame tier and `skip`. Without it the stage is
   * day, draws no moments and paces frames by its people alone.
   */
  scene?: StageScene | null;
  /** v3: people out walking at once, as the frame governor allows (useCast's `budget`); undefined keeps the cast's own. */
  onWalkBudget?: (budget: number | undefined) => void;
}

export type StageScene = Pick<SceneCast, 'moments' | 'props' | 'night' | 'tier' | 'skip'>;

const VIEW = new Vector3(1, 1.18, 1).normalize();
/** Module constants: renderer options and arrays whose identity must not change between renders. */
const GL = { toneMapping: NeutralToneMapping, antialias: true } as const;
const DPR_DESKTOP: [number, number] = [1, 2];
const DPR_PHONE: [number, number] = [1, 1.5];
const DPR_LOW: [number, number] = [1, 1];

/** Night's light: dimmed to about 30% and cooled to blue (docs/game-feel.md, section 4). */
const NIGHT_DIM = 0.7;
const NIGHT_SKY = new Color('#7F95C9');
const NIGHT_GROUND = new Color('#2E3A52');
const DAY = { sky: new Color('#FFF0DA'), ground: new Color('#4E6A5C'), key: new Color('#FFE3BE'), fill: new Color('#CFE0F4') };
const MAT_GRID_SECTION = '#7C998B';
/** The cutting mat and its grid at night: dimmed and cooled with the light. */
const MAT_DAY = { base: new Color(MAT), cell: new Color(MAT_GRID), section: new Color(MAT_GRID_SECTION) };
const MAT_NIGHT = { base: new Color('#1C2833'), cell: new Color('#2C3B49'), section: new Color('#3A4C5C') };
const LAMP = '#FFC77A';
/** At nightfall monitors go dark one by one within this long (docs/game-feel.md, section 4). */
const MONITORS_OUT_MS = 1000;

/** Something static changed (furniture loaded, an office change): the shadow map and the contact shadows draw again. */
const StaticChange = createContext<() => void>(() => {});
/** For the scenery: call it after something in the static building changes on its own (an asset arrives). */
export const useStaticChange = () => useContext(StaticChange);

/** Night's level now, 0 day to 1 night: a getter, so reading it in a frame costs no render. */
const NightLevel = createContext<() => number>(() => 0);
/**
 * For the scenery: what glows on its own (light pools, a lamp's halo) dims with night, read in a frame. Stage draws
 * frames while night falls or lifts.
 */
export const useNightLevel = () => useContext(NightLevel);

/** The level of night now, from the cast's ramp: 0 day, 1 night. */
function nightLevel(ramp: NightRamp | null | undefined, now: number): number {
  if (!ramp) return 0;
  const t = ramp.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - ramp.at) / ramp.ms));
  return ramp.from + (ramp.to - ramp.from) * t;
}

function Lights({ layout, night }: { layout: Layout; night: NightRamp | null }) {
  const level = useNightLevel();
  const invalidate = useThree((s) => s.invalidate);
  // A new ramp starts its frames; the frames carry it on.
  useEffect(() => invalidate(), [night, invalidate]);
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  const lamp = useRef<PointLight>(null);
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const half = Math.max(maxX - minX, maxZ - minZ) / 2 + 4;
  const frontDesk = layout.office?.reception.frontDesk.lamp ?? null;
  useLayoutEffect(() => {
    const l = key.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    l.shadow.camera.updateProjectionMatrix();
  }, [cx, cz, half]);
  // Night eases the light: the key and the sky dim and cool, and only the front desk's lamp stays on.
  useFrame((state) => {
    const n = level();
    const day = 1 - NIGHT_DIM * n;
    if (sky.current) {
      sky.current.intensity = 0.82 * day + 0.12 * n;
      sky.current.color.copy(DAY.sky).lerp(NIGHT_SKY, n);
      sky.current.groundColor.copy(DAY.ground).lerp(NIGHT_GROUND, n);
    }
    if (key.current) {
      key.current.intensity = 3.0 * day;
      key.current.color.copy(DAY.key).lerp(NIGHT_SKY, n);
    }
    if (fill.current) fill.current.intensity = 0.32 * day;
    if (lamp.current) lamp.current.intensity = 6 * n;
    // The rim fades faster than the light: at night a warm outline on dark hair reads as a glow.
    rimLight(day * day);
    // Still easing: keep drawing until the ramp is done.
    if (night && n !== night.to) state.invalidate();
  });
  return (
    <>
      <hemisphereLight ref={sky} args={[DAY.sky, DAY.ground, 0.82]} />
      <directionalLight
        ref={key}
        position={[cx - 19, 28, cz + 19]}
        intensity={3.0}
        color={DAY.key}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={3.5}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={1}
        shadow-camera-far={120}
      />
      {/* A cool fill from the other side, so the shadow side of things isn't flat. */}
      <directionalLight ref={fill} position={[cx + 24, 16, cz - 20]} intensity={0.32} color={DAY.fill} />
      {/* The front desk's lamp: off by day, the one warm light at night. Always there, so night needs no new shader. */}
      {frontDesk && <pointLight ref={lamp} position={[frontDesk.x, 2.2, frontDesk.z]} intensity={0} distance={7} decay={1.6} color={LAMP} />}
    </>
  );
}

/** The cameras see people's layer, and so does picking (the contact shadows' camera doesn't, so it leaves them out). */
function PeopleLayer() {
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);
  useLayoutEffect(() => {
    camera.layers.enable(PEOPLE_LAYER);
    raycaster.layers.enable(PEOPLE_LAYER);
  }, [camera, raycaster]);
  return null;
}

/** After a change, static shadows draw again at these moments (ms), for furniture that arrives a moment later. */
const SETTLE_AT = [0, 250, 600, 1200, 2000];

/** Asks for frames at SETTLE_AT after each change of `version`, and says when one of them is due. */
function useSettle(version: unknown): () => boolean {
  const invalidate = useThree((s) => s.invalidate);
  const due = useRef<number[]>([]);
  useEffect(() => {
    const start = performance.now();
    due.current = SETTLE_AT.map((ms) => start + ms);
    const timers = SETTLE_AT.map((ms) => window.setTimeout(invalidate, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [version, invalidate]);
  return useCallback(() => {
    const now = performance.now();
    const before = due.current.length;
    due.current = due.current.filter((at) => at > now);
    return due.current.length < before;
  }, []);
}

/**
 * The shadow map holds only the static building (people have blob shadows): drawn when the office changes, not every
 * frame. Contact shadows (art/contact.ts) draw at the same moments.
 */
const StaticShadows = memo(function StaticShadows({ layout, version }: { layout: Layout; version: unknown }) {
  const get = useThree((s) => s.get);
  const settle = useSettle(version);
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  // Disposing frees the GPU's copies; three makes them again if the same pass is drawn after a remount.
  const contact = useMemo(() => new ContactShadows((minX + maxX) / 2, 0.075, (minZ + maxZ) / 2, maxX - minX + 4, maxZ - minZ + 4), [minX, maxX, minZ, maxZ]);
  useEffect(() => () => contact.dispose(), [contact]);
  useEffect(() => {
    const { gl } = get();
    gl.shadowMap.autoUpdate = false;
    return () => {
      get().gl.shadowMap.autoUpdate = true;
    };
  }, [get]);
  useFrame((state) => {
    if (!settle()) return;
    state.gl.shadowMap.needsUpdate = true;
    contact.render(state.gl, state.scene);
  });
  return <primitive object={contact.mesh} />;
});

// ---------------------------------------------------------------------------------------------------------------
// The camera: where it looks, how far it is zoomed, and how it eases from one to the other

/** A camera: the point it looks at, the way back from there to the camera, and its zoom (pixels per world unit). */
interface Pose {
  target: Vector3;
  dir: Vector3;
  zoom: number;
}

const DISTANCE = 90;
/** The camera's own axes when it looks along VIEW: right and up on screen. */
const AXIS_X = new Vector3().crossVectors(new Vector3(0, 1, 0), VIEW).normalize();
const AXIS_Y = new Vector3().crossVectors(VIEW, AXIS_X).normalize();
const NO_INSETS: Required<Insets> = { top: 0, right: 0, bottom: 0, left: 0 };
/** The zoom keys' step, and the camera's limits (the controls' too, in the office). */
const ZOOM_STEP = 1.25;
const MIN_ZOOM = 6;
const MAX_ZOOM = 160;
/** docs/design-hud.md, "Motion": the refit, the board's move, a zoom step. */
const REFIT_MS = 350;
const STAGE_MS = 250;
const ZOOM_MS = 220;
/** The mini-map draws at most this often: plenty at 240 x 150, and the main thread stays the board's. */
const MINI_FPS = 12;

/** A cubic-bezier easing, as CSS draws it. */
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const at = (a: number, b: number, c: number, t: number) => ((a * t + b) * t + c) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = at(ax, bx, cx, t) - x;
      if (Math.abs(error) < 1e-5) break;
      const slope = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(slope) < 1e-6) break;
      t = Math.min(1, Math.max(0, t - error / slope));
    }
    return at(ay, by, cy, t);
  };
}
/** --ease-in-out and --ease-out (docs/design-hud.md, "Motion"). */
const EASE_IN_OUT = bezier(0.65, 0, 0.35, 1);
const EASE_OUT = bezier(0.2, 0.8, 0.2, 1);
const EASE_IN_OUT_CSS = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * The camera that frames the building in the part of a `width` x `height` stage the insets leave free: zoomed so the
 * building fills 90% of it, and moved so it sits in that part's middle rather than the stage's.
 */
function fitPose(layout: Layout, width: number, height: number, insets: Insets): Pose {
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const corner = new Vector3();
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      for (const y of [0, 2.6]) {
        corner.set(x, y, z).sub(center);
        const cx = corner.dot(AXIS_X);
        const cy = corner.dot(AXIS_Y);
        x0 = Math.min(x0, cx);
        x1 = Math.max(x1, cx);
        y0 = Math.min(y0, cy);
        y1 = Math.max(y1, cy);
      }
    }
  }
  const left = insets.left ?? 0;
  const freeW = Math.max(Math.min(120, width), width - insets.right - left);
  const freeH = Math.max(Math.min(120, height), height - insets.bottom - insets.top);
  const zoom = Math.min(freeW / Math.max(1e-6, x1 - x0), freeH / Math.max(1e-6, y1 - y0)) * 0.9;
  const target = center
    .clone()
    .addScaledVector(AXIS_X, (insets.right - left) / 2 / zoom)
    .addScaledVector(AXIS_Y, (insets.top - insets.bottom) / 2 / zoom);
  return { target, dir: VIEW.clone(), zoom };
}

interface Controls {
  target: Vector3;
  update: () => void;
}
const controlsOf = (controls: unknown): Controls | null =>
  typeof controls === 'object' && controls !== null && 'target' in controls && controls.target instanceof Vector3 && 'update' in controls ? (controls as Controls) : null;

function readPose(camera: Camera, controls: unknown): Pose {
  const cam = camera as OrthographicCamera;
  const target = controlsOf(controls)?.target.clone() ?? cam.position.clone().addScaledVector(VIEW, -DISTANCE);
  const dir = cam.position.clone().sub(target);
  if (dir.lengthSq() < 1e-9) dir.copy(VIEW);
  return { target, dir: dir.normalize(), zoom: cam.zoom };
}

function applyPose(camera: Camera, controls: unknown, pose: Pose): void {
  const cam = camera as OrthographicCamera;
  cam.position.copy(pose.target).addScaledVector(pose.dir, DISTANCE);
  cam.up.set(0, 1, 0);
  cam.lookAt(pose.target);
  cam.zoom = pose.zoom;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const c = controlsOf(controls);
  if (c) {
    c.target.copy(pose.target);
    c.update();
  }
}

/** Between two cameras: the target along a line, the direction turning, the zoom evenly in scale. */
function blend(from: Pose, to: Pose, e: number): Pose {
  const dir = from.dir.clone().lerp(to.dir, e);
  if (dir.lengthSq() < 1e-9) dir.copy(to.dir);
  return { target: from.target.clone().lerp(to.target, e), dir: dir.normalize(), zoom: from.zoom * (to.zoom / from.zoom) ** e };
}

interface Tween {
  start: number;
  ms: number;
  ease: (x: number) => number;
  at: (e: number) => Pose;
  /** A zoom step's zoom at its end, so a press during it steps on from there. */
  zoomTo?: number;
}

/** What the Stage asks of the camera while the office moves into the mini-map's window and back. */
interface RigControl {
  /** Keeps the office's camera, to come back to (leaving the office). */
  save(): void;
  /** Eases (`ms` 0: jumps) to frame the building inside what `insets` leave of the stage now. */
  frame(insets: Insets, ms: number): void;
  /** Eases (or jumps) back to the camera kept, or to the office's fit where the stage changed size since. */
  restore(ms: number): void;
  /** Resizes the drawing buffer at once and draws one frame, framed for `insets` or as kept: no stretched picture between. */
  drawAt(width: number, height: number, framing: Insets | 'kept'): void;
}

interface RigProps {
  layout: Layout;
  /** The office's fit: what the HUD covers. */
  fit: Insets;
  /** The labels' area, exact: a zoom step's middle. */
  area: Required<Insets>;
  fitKey: number;
  phase: Phase;
  /** Nothing is drawn (frameloop never); drawing again needs a frame. */
  covered: boolean;
  reducedMotion: boolean;
  camera: StageCamera | null;
  labels: LabelStore;
  /** The label anchor of whoever is open in the side panel, for the zoom keys. */
  focus: string | null;
  controlRef: { current: RigControl | null };
}

/**
 * The camera's one owner: it fits the building to the stage (at once on a resize or a new office, eased when the HUD's
 * insets change or Fit is pressed), steps the zoom, keeps the office's camera while it is the mini-map and brings it
 * back, and frames the mini-map as the Stage moves the canvas.
 */
function CameraRig(props: RigProps) {
  const { layout, fit, fitKey, phase, covered, camera, controlRef } = props;
  const get = useThree((s) => s.get);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const controlsReady = useThree((s) => Boolean(s.controls));
  const tween = useRef<Tween | null>(null);
  const saved = useRef<{ pose: Pose; width: number; height: number } | null>(null);
  const seen = useRef<{ phase: Phase; width: number; height: number; layout: Layout; fitKey: number; fit: string } | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  // The tween in hand moves the camera every frame until it is done (priority -1: before the labels follow it).
  useFrame((state) => {
    const t = tween.current;
    if (!t) return;
    const k = t.ms <= 0 ? 1 : Math.min(1, (performance.now() - t.start) / t.ms);
    applyPose(state.camera, state.controls, t.at(t.ease(k)));
    if (k >= 1) tween.current = null;
    else state.invalidate();
  }, -1);

  const [rig] = useState(() => {
    const now = () => get();
    const go = (to: Pose, ms: number, ease = EASE_IN_OUT) => {
      const state = now();
      if (ms <= 0 || latest.current.reducedMotion) {
        tween.current = null;
        applyPose(state.camera, state.controls, to);
        state.invalidate();
        return;
      }
      const from = readPose(state.camera, state.controls);
      tween.current = { start: performance.now(), ms, ease, at: (e) => blend(from, to, e) };
      state.invalidate();
    };
    const kept = (w: number, h: number): Pose => {
      const keep = saved.current;
      if (keep && Math.abs(keep.width - w) < 1 && Math.abs(keep.height - h) < 1) return keep.pose;
      return fitPose(latest.current.layout, w, h, latest.current.fit);
    };
    const control: RigControl = {
      save() {
        const state = now();
        // A refit or a zoom under way ends where it was going: that is the camera you left.
        const t = tween.current;
        const pose = t ? t.at(1) : readPose(state.camera, state.controls);
        saved.current = { pose, width: state.size.width, height: state.size.height };
      },
      frame(insets, ms) {
        const { size } = now();
        go(fitPose(latest.current.layout, size.width, size.height, insets), ms);
      },
      restore(ms) {
        const { size } = now();
        go(kept(size.width, size.height), ms);
      },
      drawAt(w, h, framing) {
        const before = now();
        if (w <= 0 || h <= 0) return;
        before.setSize(w, h, before.size.top, before.size.left);
        const state = now();
        tween.current = null;
        applyPose(state.camera, state.controls, framing === 'kept' ? kept(w, h) : fitPose(latest.current.layout, w, h, framing));
        advance(performance.now(), false, state);
      },
    };
    const driver: CameraDriver = {
      fit() {
        if (latest.current.phase !== 'office') return;
        const { size } = now();
        go(fitPose(latest.current.layout, size.width, size.height, latest.current.fit), REFIT_MS);
      },
      zoom(direction) {
        const { phase: at, area, focus, labels, reducedMotion } = latest.current;
        if (at !== 'office') return false;
        const state = now();
        const cam = state.camera as OrthographicCamera;
        const base = tween.current?.zoomTo ?? cam.zoom;
        const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base * ZOOM_STEP ** direction));
        if (Math.abs(z1 - base) < 1e-3) return false;
        cam.updateMatrixWorld();
        const x = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        const y = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
        const start = readPose(cam, state.controls);
        const z0 = cam.zoom;
        const { width: w, height: h } = state.size;
        // The middle of the labels' area, as an offset from the stage's middle (screen y runs down).
        const mid = { x: (area.left + w - area.right) / 2 - w / 2, y: (area.top + h - area.bottom) / 2 - h / 2 };
        const person = focus ? labels.worldOf(focus) : null;
        const point = person ?? start.target.clone().addScaledVector(x, mid.x / z0).addScaledVector(y, -mid.y / z0);
        const rel = point.clone().sub(start.target);
        const s0 = { x: rel.dot(x) * z0, y: -rel.dot(y) * z0 };
        // Someone open in the side panel stays where they are on screen while it zooms; out of the labels' area, they come to its middle.
        const inside = s0.x >= area.left - w / 2 && s0.x <= w / 2 - area.right && s0.y >= area.top - h / 2 && s0.y <= h / 2 - area.bottom;
        const s1 = inside ? s0 : mid;
        const at1 = (e: number): Pose => {
          const z = z0 * (z1 / z0) ** e;
          const sx = s0.x + (s1.x - s0.x) * e;
          const sy = s0.y + (s1.y - s0.y) * e;
          const a = rel.dot(x) - sx / z;
          const b = rel.dot(y) + sy / z;
          return { target: start.target.clone().addScaledVector(x, a).addScaledVector(y, b), dir: start.dir.clone(), zoom: z };
        };
        if (reducedMotion) {
          tween.current = null;
          applyPose(cam, state.controls, at1(1));
          state.invalidate();
        } else {
          tween.current = { start: performance.now(), ms: ZOOM_MS, ease: EASE_OUT, at: at1, zoomTo: z1 };
          state.invalidate();
        }
        return true;
      },
    };
    return { control, driver };
  });

  useLayoutEffect(() => {
    controlRef.current = rig.control;
    return () => {
      if (controlRef.current === rig.control) controlRef.current = null;
    };
  }, [controlRef, rig]);
  useEffect(() => (camera ? camera.attach(rig.driver) : undefined), [camera, rig]);
  // Drawing again after nothing was drawn: one frame, the rest follow on demand.
  useEffect(() => {
    if (!covered) get().invalidate();
  }, [covered, get]);

  // The office's camera follows the stage: at once for a new size, a new office or v2's reset; eased when what the HUD
  // covers changes (the side panel committed, shown or hidden). The mini-map is fitted whole at its own size. While the
  // stage moves between the two, the Stage frames it; coming back, the camera is the one you left.
  const fitSig = `${fit.top} ${fit.right} ${fit.bottom} ${fit.left ?? 0}`;
  useLayoutEffect(() => {
    if (!controlsReady) return;
    const prev = seen.current;
    seen.current = { phase, width, height, layout, fitKey, fit: fitSig };
    const state = get();
    if (phase === 'office') {
      // Back from the mini-map: the Stage brought the camera back as you left it.
      if (prev !== null && prev.phase !== 'office') return;
      if (prev === null || prev.layout !== layout || prev.fitKey !== fitKey || prev.width !== width || prev.height !== height) {
        tween.current = null;
        applyPose(state.camera, state.controls, fitPose(layout, width, height, fit));
        state.invalidate();
      } else if (prev.fit !== fitSig) rig.control.frame(fit, REFIT_MS);
    } else if (phase === 'mini' && (prev === null || prev.width !== width || prev.height !== height || prev.layout !== layout)) {
      tween.current = null;
      applyPose(state.camera, state.controls, fitPose(layout, width, height, NO_INSETS));
      state.invalidate();
    }
  });
  return null;
}

/** Renders again whenever a new snapshot arrives, for the on-demand frame loop. */
function Refresh({ snapshot }: { snapshot: Snapshot }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [snapshot, invalidate]);
  return null;
}

/** The mat the model stands on: a plane that takes the building's shadow, and the grid; it dims with night. Static, so drawn from memo. */
const Mat = memo(function Mat() {
  const level = useNightLevel();
  const grid = useRef<Mesh>(null);
  useFrame((state) => {
    const n = level();
    if (state.scene.background instanceof Color) state.scene.background.copy(MAT_DAY.base).lerp(MAT_NIGHT.base, n);
    const uniforms = (grid.current?.material as ShaderMaterial | undefined)?.uniforms;
    uniforms?.cellColor?.value.copy(MAT_DAY.cell).lerp(MAT_NIGHT.cell, n);
    uniforms?.sectionColor?.value.copy(MAT_DAY.section).lerp(MAT_NIGHT.section, n);
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.24, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <shadowMaterial opacity={0.22} />
      </mesh>
      <Grid
        ref={grid}
        position={[0, -0.235, 0]}
        args={[400, 400]}
        cellSize={1}
        cellThickness={0.55}
        cellColor={MAT_GRID}
        sectionSize={5}
        sectionThickness={1}
        sectionColor={MAT_GRID_SECTION}
        fadeDistance={260}
        fadeStrength={1}
        infiniteGrid
      />
    </>
  );
});

/** Desktop extras (art/effects.tsx): a little bloom, loaded only where drawn. */
const Effects = lazy(() => import('./art/effects.tsx'));

/**
 * Feeds the governor every drawn frame (people/governor.ts), with the GPU time of a recent one where the browser can
 * measure it (people/gpuTimer.ts): a phone or a slow laptop that can't keep up steps quality down, and easy frames step
 * it back up. The walk budget it allows goes to the cast.
 */
function useGovernor(onWalkBudget: StageProps['onWalkBudget']): { quality: number; onFrame: (sample: FrameSample) => void; timer: GpuTimer } {
  const [governor] = useState(() => new Governor());
  const [timer] = useState(() => new GpuTimer(addEffect, addAfterEffect));
  const [quality, setQuality] = useState(0);
  const onFrame = useCallback(
    (sample: FrameSample) => {
      if (governor.sample({ ...sample, gpu: timer.take() }, performance.now())) setQuality(governor.level);
    },
    [governor, timer],
  );
  const budget = walkBudget(quality);
  useEffect(() => onWalkBudget?.(budget), [budget, onWalkBudget]);
  return { quality, onFrame, timer };
}

/** Starts the governor's GPU timer on the canvas's context, and stops it with the canvas. */
function GpuTiming({ timer }: { timer: GpuTimer }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    timer.attach(gl.getContext());
    return () => timer.detach();
  }, [gl, timer]);
  return null;
}

/** A desk's own moment, within the first second of nightfall, to go dark: a stable hash, so they go one by one. */
const outAt = (desk: string) => ((hash(desk) % 1000) / 1000) * MONITORS_OUT_MS;

type OfficeBuildingProps = Omit<ComponentProps<typeof Building>, 'litDesks' | 'dimDesks'> & {
  cast: CastMember[];
  night: NightRamp | null;
  /** The office opened on a night already fallen: dark at once. */
  fallen: boolean;
  reducedMotion: boolean;
};

/**
 * Monitors and desk lamps (docs/game-feel.md, sections 4 and 7): on for someone working, thinking or stuck, dim for a
 * desk open between steps, off otherwise. At nightfall they go dark one by one within a second (at once with reduced
 * motion, or when the office opens on a night already fallen); in the morning each lights as its desk reopens. On its
 * own, so nightfall's steps draw the building again and not the people.
 */
function OfficeBuilding({ cast, night, fallen, reducedMotion, ...rest }: OfficeBuildingProps) {
  const desks = useMemo(() => {
    const lit = new Set<string>();
    const dim = new Set<string>();
    for (const m of cast) {
      // A company's desks are its people's; v2's are its roles' and the lead's.
      const desk = m.person ?? (m.target.kind === 'role' ? m.target.id : m.key === 'lead' ? 'lead' : null);
      if (desk === null) continue;
      if (m.status === 'working' || m.status === 'thinking' || m.status === 'error') lit.add(desk);
      else if (m.status === 'idle' || m.status === 'waiting') dim.add(desk);
    }
    return { lit, dim };
  }, [cast]);
  // The cast makes its ramp again with every snapshot: the same nightfall is the same start.
  const falling = night !== null && night.to > night.from ? `${night.at}` : null;
  // How far into nightfall the monitors are: timers step it through the first second.
  const [into, setInto] = useState<{ falling: string; ms: number } | null>(null);
  useEffect(() => {
    if (falling === null) return;
    const timers: number[] = [];
    for (let ms = 100; ms <= MONITORS_OUT_MS; ms += 100) timers.push(window.setTimeout(() => setInto({ falling, ms }), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [falling]);
  const ms = falling === null ? -1 : reducedMotion || fallen || (night?.ms ?? 0) <= 0 ? MONITORS_OUT_MS : into?.falling === falling ? into.ms : 0;
  const shown = useMemo(() => {
    if (ms < 0) return desks;
    const on = (d: string) => outAt(d) > ms;
    return { lit: new Set([...desks.lit].filter(on)), dim: new Set([...desks.dim].filter(on)) };
  }, [desks, ms]);
  return <Building {...rest} litDesks={shown.lit} dimDesks={shown.dim} />;
}

/** v2's office keeps labels this far inside its one inset. */
const LABEL_MARGIN = 12;
const RESIZE = { scroll: false, offsetSize: true } as const;
const noSubscribe = () => () => {};
const noVersion = () => 0;

/**
 * The mini-map's window in the stage's box, from the mini-map's form: in the main view's corner, or the window's beside a
 * floating side panel (the shell's --float-clear). It follows the side panel and the talk bar by CSS, as MiniMap does.
 */
function miniStyle(variant: MiniVariant): CSSProperties {
  const g = miniGeometry(variant);
  const bottom =
    variant === 'above'
      ? `calc(var(--gutter, 12px) * 2 + var(--talk-now, 56px) + ${g.below}px)`
      : `calc(var(--gutter, 12px) + ${g.below}px${g.captionRem > 0 ? ` + ${g.captionRem}rem` : ''})`;
  const right = `calc(var(--main-right, 0px) - var(--float-clear, 0px) + var(--gutter, 12px) + ${g.side}px)`;
  return { right, bottom, width: g.width, height: g.height };
}

/** A rectangle of the page, in the stage box's own terms. */
const within = (outer: DOMRect, inner: DOMRect): Rect => ({ left: inner.left - outer.left, top: inner.top - outer.top, width: inner.width, height: inner.height });

export function Stage({ snapshot, layout, cast, clock, selection, onSelect, reducedMotion, insets, fitKey = 0, mode = 'office', camera, asking = null, onAsk = () => {}, thumbnail = false, quiet = false, scene = null, onWalkBudget }: StageProps) {
  // The person you are asking wears the yellow ring too.
  const askKey = asking?.figureKey ?? null;
  // Phones and tablets: the lighter mode (docs/game-feel.md, "Phones").
  const lighter = useMediaQuery('(max-width: 720px), (pointer: coarse)');
  const { quality, onFrame, timer } = useGovernor(onWalkBudget);
  const dpr = quality >= 2 ? DPR_LOW : lighter ? DPR_PHONE : DPR_DESKTOP;
  const extras = !lighter && quality < 1;
  const night = scene?.night ?? null;
  // A click seats everyone still walking in; Escape does too, through the shell's one Escape handler.
  const skip = scene?.skip;
  const nightNow = useCallback(() => nightLevel(night, clock.now(performance.now())), [night, clock]);

  // The camera's fit and the labels' area: a company's two, or v2's one with the labels' margin inside it.
  const pair = 'fit' in insets ? insets : null;
  const fit: Insets = 'fit' in insets ? insets.fit : insets;
  const area: Required<Insets> = pair
    ? { top: pair.labels.top, right: pair.labels.right, bottom: pair.labels.bottom, left: pair.labels.left ?? LABEL_MARGIN }
    : { top: fit.top + LABEL_MARGIN, right: fit.right + LABEL_MARGIN, bottom: fit.bottom + LABEL_MARGIN, left: LABEL_MARGIN };
  const { phase, boxRef, rigRef, marks, hidden } = useStageMove(mode, camera ?? null, reducedMotion);
  const office = phase === 'office' && !hidden;

  const runningGates = useMemo(() => new Set(snapshot.gateRuns.filter((g) => g.until === null).map((g) => g.gateId)), [snapshot.gateRuns]);
  const roomNames = useMemo(() => new Map(snapshot.studio?.departments.map((d) => [d.id, d.name]) ?? []), [snapshot.studio]);
  // A selected agent that sits at a role's desk highlights that desk's person; the main lead's figure is 'lead'.
  const selectedKey =
    selection?.kind === 'role'
      ? selection.id === 'lead'
        ? 'lead'
        : `desk:${selection.id}`
      : selection?.kind === 'agent'
        ? (cast.find((m) => m.key === selection.key || (m.agentKey === selection.key && (m.key.startsWith('desk:') || m.key === 'lead')))?.key ?? null)
        : null;
  const [labels] = useState(() => new LabelStore());
  // Send's flight asks the stage where an anchor is (flightApi.ts).
  useEffect(() => registerStage(labels, () => boxRef.current), [labels, boxRef]);
  // Static shadows draw again when the office changes, or when the scenery says it did.
  const [staticVersion, setStaticVersion] = useState(0);
  const changed = useCallback(() => setStaticVersion((v) => v + 1), []);
  const version = useMemo(() => [layout, staticVersion], [layout, staticVersion]);

  return (
    <div
      ref={boxRef}
      className="stage-view"
      data-phase={phase}
      data-covered={hidden || undefined}
      style={phase === 'mini' && marks ? miniStyle(marks.variant) : undefined}
      aria-hidden={office ? undefined : true}
      inert={office ? undefined : true}
    >
    <Canvas
      orthographic
      shadows="percentage"
      dpr={dpr}
      gl={GL}
      frameloop={hidden ? 'never' : 'demand'}
      resize={RESIZE}
      camera={{ position: [60, 70, 60], zoom: 20, near: 0.1, far: 500 }}
      onPointerMissed={() => onSelect(null)}
      onClick={skip}
      aria-label={modelLabel(layout.rooms.length, cast.filter((c) => c.status !== 'off' && c.status !== 'idle').length)}
      role="img"
    >
      <color attach="background" args={[MAT]} />
      <GpuTiming timer={timer} />
      <PeopleLayer />
      <NightLevel.Provider value={nightNow}>
        <Lights layout={layout} night={night} />
        <Mat />
        <StaticShadows layout={layout} version={version} />
        <StaticChange.Provider value={changed}>
          <LabelContext.Provider value={labels}>
            <OfficeBuilding
              layout={layout}
              cast={cast}
              night={night}
              fallen={(scene?.moments.night ?? 0) >= 1}
              reducedMotion={reducedMotion}
              theme={snapshot.studio?.office?.theme}
              decor={snapshot.studio?.office?.decor}
              moments={scene?.props ?? null}
              clock={clock}
              runningGates={runningGates}
              selection={selection}
              onSelect={onSelect}
            />
            <TrayAnchors layout={layout} />
            <MomentLayer props={scene?.props ?? null} clock={clock} reducedMotion={reducedMotion} night={scene?.moments.night ?? 0} />
            <People
              cast={cast}
              clock={clock}
              tier={scene?.tier ?? 'still'}
              selectedKey={selectedKey}
              askKey={askKey}
              reducedMotion={reducedMotion}
              lighter={lighter}
              quality={quality}
              onSelect={onSelect}
              onFrame={onFrame}
              cap={phase === 'mini' ? MINI_FPS : null}
            />
            {import.meta.env.VITE_WORKLINGS_FILM === '1' && <FilmCamera stage="office" />}
            <LabelProjector store={labels} />
          </LabelContext.Provider>
        </StaticChange.Provider>
      </NightLevel.Provider>
      {/* A company's faces (ui/Face.tsx): portraits of its people, baked with this renderer. */}
      {scene && <Portraits cast={cast} detail={lighter ? 'low' : 'full'} />}
      <CameraRig
        layout={layout}
        fit={fit}
        area={area}
        fitKey={fitKey}
        phase={phase}
        covered={hidden}
        reducedMotion={reducedMotion}
        camera={camera ?? null}
        labels={labels}
        focus={selectedKey ? `person:${selectedKey}` : null}
        controlRef={rigRef}
      />
      <Refresh snapshot={snapshot} />
      {/* The office's own pan and zoom; the mini-map is fitted whole, under any zoom the office allows. */}
      <MapControls
        makeDefault
        enabled={office}
        enableDamping={!reducedMotion && office}
        minZoom={phase === 'office' ? MIN_ZOOM : 0.05}
        maxZoom={MAX_ZOOM}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.6}
        minAzimuthAngle={-Math.PI / 12}
        maxAzimuthAngle={Math.PI / 2 + Math.PI / 12}
        screenSpacePanning
      />
      {extras && (
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      )}
    </Canvas>
    <LabelLayer
      store={labels}
      layout={layout}
      cast={cast}
      selection={selection}
      selectedKey={selectedKey}
      runningGates={runningGates}
      roomNames={roomNames}
      onSelect={onSelect}
      asking={asking}
      onAsk={onAsk}
      insets={fit}
      area={pair ? area : null}
      covered={pair?.covered ?? null}
      active={office}
      reducedMotion={reducedMotion}
      thumbnail={thumbnail}
      quiet={quiet}
    />
    {phase === 'mini' && marks && !hidden && (
      <div className={marks.variant === 'whole' ? 'stage-mini' : 'stage-mini stage-mini--thumb'} aria-hidden="true">
        <span className="stage-mini__live" data-mark={marks.mark}>
          {marks.pill}
        </span>
        {marks.needs > 0 && (
          <span className="stage-mini__needs">
            <Count n={marks.needs} />
          </span>
        )}
      </div>
    )}
    </div>
  );
}

/**
 * Moves the stage's box between the whole window and the mini-map's window as the mode changes: a transform (FLIP) while
 * the camera frames the building as the mini-map will show it, then one resize; growing back, the resize first and the
 * camera back as you left it. With reduced motion, or from covered, it jumps. Covered (or a mini-map with no window to lie
 * over) draws nothing.
 */
function useStageMove(mode: StageMode, camera: StageCamera | null, reducedMotion: boolean) {
  const [phase, setPhase] = useState<Phase>(() => (mode === 'mini' ? 'mini' : 'office'));
  const boxRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<RigControl | null>(null);
  const motion = useRef<Animation | null>(null);
  // Whether anything was showing before this change: from covered there is nothing to move.
  const shown = useRef(mode !== 'covered');
  useSyncExternalStore(camera?.subscribe ?? noSubscribe, camera?.snapshot ?? noVersion);
  const marks = camera?.miniMarks ?? null;
  const view = camera?.miniViewElement ?? null;
  // Nothing to draw: covered, or a board whose mini-map has no window to lie over (yet, or at all: the feed is open).
  const hidden = mode === 'covered' || (mode === 'mini' && phase !== 'to-mini' && (!marks || !view));

  useLayoutEffect(() => {
    const was = shown.current;
    shown.current = mode !== 'covered';
    if (mode === 'covered') return;
    const el = boxRef.current;
    const control = rigRef.current;
    const stage = el?.offsetParent;
    const end = () => {
      motion.current?.cancel();
      motion.current = null;
      if (el) el.style.clipPath = '';
    };
    if (mode === 'mini' && (phase === 'office' || phase === 'to-office')) {
      // The mini-map lays its window out in the same commit: wait for it, hidden meanwhile.
      if (!view || !marks) return;
      // Leaving the office, its camera is kept to come back to; turning back while growing, it is kept already.
      if (phase === 'office') control?.save();
      end();
      if (!el || !control || !(stage instanceof HTMLElement) || !was || reducedMotion || phase === 'to-office') {
        setPhase('mini');
        const g = miniGeometry(marks.variant);
        control?.drawAt(g.width, g.height, NO_INSETS);
        return;
      }
      const outer = stage.getBoundingClientRect();
      const full = { width: outer.width, height: outer.height };
      const move = miniMove(full, within(outer, view.getBoundingClientRect()));
      const at = miniFrame(move, full);
      // The camera frames the building as the mini-map will show it while the box shrinks into its window (a transform
      // the compositor runs, the clip to the crop held still); then the drawing buffer is resized once, to the window.
      control.frame(cropInsets(full, move.crop), STAGE_MS);
      setPhase('to-mini');
      el.style.clipPath = at.clipPath;
      const animation = el.animate([{ transform: FULL_FRAME.transform }, { transform: at.transform }], { duration: STAGE_MS, easing: EASE_IN_OUT_CSS, fill: 'forwards' });
      motion.current = animation;
      // The window's size is known from its form: reading the layout here would pull the board's first layout into
      // the move's last frame.
      const size = miniGeometry(marks.variant);
      animation.onfinish = () => {
        if (motion.current !== animation) return;
        flushSync(() => setPhase('mini'));
        control.drawAt(size.width, size.height, NO_INSETS);
        end();
      };
      return;
    }
    if (mode === 'office' && (phase === 'mini' || phase === 'to-mini')) {
      end();
      const outer = stage instanceof HTMLElement ? stage.getBoundingClientRect() : null;
      const from = phase === 'mini' && el ? el.getBoundingClientRect() : null;
      if (!el || !control || !outer || !from || from.width <= 0 || !was || reducedMotion) {
        setPhase('office');
        if (control && outer) control.drawAt(outer.width, outer.height, 'kept');
        return;
      }
      const full = { width: outer.width, height: outer.height };
      const move = miniMove(full, within(outer, from));
      const at = miniFrame(move, full);
      // Resized first and drawn at the whole size, framed as the mini-map shows it; then eased back to the camera you
      // left while the box grows from the corner.
      el.style.clipPath = at.clipPath;
      const animation = el.animate([{ transform: at.transform }, { transform: FULL_FRAME.transform }], { duration: STAGE_MS, easing: EASE_IN_OUT_CSS, fill: 'backwards' });
      motion.current = animation;
      control.drawAt(full.width, full.height, cropInsets(full, move.crop));
      control.restore(STAGE_MS);
      setPhase('to-office');
      animation.onfinish = () => {
        if (motion.current !== animation) return;
        flushSync(() => setPhase('office'));
        end();
      };
    }
  }, [mode, phase, view, marks, reducedMotion]);
  useEffect(() => () => motion.current?.cancel(), []);

  return { phase, boxRef, rigRef, marks, hidden };
}
