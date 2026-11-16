// What the moments add to the office that isn't a person (docs/game-feel.md): notes in desk trays, yellow when they
// carry your words; cups on a long day; first-day plants; the milestone cards and their flip; the boxes the CEO draws
// while drafting the org; the front desk's sign and its lamp's glow; paper streamers for a milestone. Each kind is one
// instanced mesh of a simple shape in the palette, papers, cups and plants drawn 1.5 times life size, placed from the
// cast's props (moments.ts) on the scene clock, so the 3D artist can restyle any of them without touching the moments.
import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  BoxGeometry, type BufferGeometry, Color, CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute, IcosahedronGeometry, InstancedBufferAttribute,
  type InstancedMesh, type Material, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneClock } from './cast.ts';
import { COMPANY_DESK } from './layout.ts';
import { CARD_FLIP_MS, CUP_SCALE, DESK_DROP_MS, type MomentProps, PIN_POP_MS, STREAMER_MS } from './moments.ts';
import { heldPaper, holdVersion, noteTrays, watchHolds } from './noteHold.ts';
import { COUNTER_TOP } from './office/fronts.ts';
import { HIGHLIGHTER, INK, PLANT, PLANT_DARK } from './palette.ts';

/** Heights things stand at: a desk's top (the counter's is the scenery's). */
const DESK_TOP = COMPANY_DESK.top;
/** Cards and boxes lie this far off their board's face, which the moments give, hung on a tall wall or on legs. */
const OFF_FACE = 0.02;
const PAPER = '#FBFAF6';
const CUP = '#F1EADC';
const SLEEVE = '#B98A5E';
const CARD_DONE = '#A9D3A2';
const MARKER = '#5B8FC7';
const LAMP_GLOW = '#FFD48A';
const DUST = '#E9E2D5';
/** A plant set down or a box drawn pops in this fast; a new desk's dust puffs drift out and settle this long. */
const POP_MS = PIN_POP_MS;
const PUFF_MS = 600;
const PUFFS = 6;

interface Props {
  props: MomentProps | null;
  clock: SceneClock;
  reducedMotion: boolean;
  /** Night from 0 to 1 (SceneMoments.night): yellow papers and the lamp keep glowing as the light dims. */
  night?: number;
}

export function MomentLayer({ props, clock, reducedMotion, night = 0 }: Props) {
  if (!props) return null;
  return (
    <group name="moments">
      <Papers papers={props.papers} night={night} />
      <Cups cups={props.cups} />
      <Plants plants={props.plants} clock={clock} reducedMotion={reducedMotion} />
      <Cards cards={props.cards} clock={clock} reducedMotion={reducedMotion} />
      <Boxes boxes={props.boxes} clock={clock} reducedMotion={reducedMotion} />
      {props.frontDesk && <FrontDeskSign desk={props.frontDesk} night={night} />}
      {props.streamers && !reducedMotion && <Streamers streamers={props.streamers} clock={clock} />}
      {!reducedMotion && <Dust drops={props.drops} clock={clock} />}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes and materials, made once and shared by every office

/** Paints every vertex of a part one colour, so parts merge into one mesh drawn with vertex colours. */
function painted(geometry: BufferGeometry, hex: string): BufferGeometry {
  const out = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new Color(hex);
  const count = out.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return out;
}

/** Merged parts, or the first part alone if three can't merge them (it never fails for these shapes). */
const merged = (parts: BufferGeometry[]): BufferGeometry => mergeGeometries(parts) ?? (parts[0] as BufferGeometry);

const SHAPES = {
  /** A sheet of paper lying flat, sized to sit in a desk's tray. */
  paper: new BoxGeometry(0.32, 0.008, 0.24),
  /** The thicker stack a tray shows past three papers. */
  stack: new BoxGeometry(0.32, 0.05, 0.24).translate(0, 0.021, 0),
  /** A takeaway cup with its sleeve and lid (not a mug: `mug` is a look prop). */
  cup: merged([
    painted(new CylinderGeometry(0.056, 0.044, 0.15, 10).translate(0, 0.075, 0), CUP),
    painted(new CylinderGeometry(0.058, 0.052, 0.05, 10).translate(0, 0.08, 0), SLEEVE),
    painted(new CylinderGeometry(0.06, 0.058, 0.02, 10).translate(0, 0.16, 0), PAPER),
  ]),
  pot: new CylinderGeometry(0.09, 0.07, 0.13, 9).translate(0, 0.065, 0),
  leaves: merged([
    painted(new IcosahedronGeometry(0.13, 0).translate(0, 0.22, 0), PLANT),
    painted(new IcosahedronGeometry(0.085, 0).translate(0.07, 0.31, 0.03), PLANT_DARK),
  ]),
  card: new PlaneGeometry(1, 1),
  box: new PlaneGeometry(1, 1),
  sign: new BoxGeometry(0.9, 0.24, 0.03),
  glow: new SphereGeometry(0.09, 10, 8),
  puff: new IcosahedronGeometry(1, 0),
  streamer: new PlaneGeometry(0.07, 0.3),
};

const flat = { flatShading: true, roughness: 0.85, metalness: 0 } as const;
const MATERIALS = {
  paper: new MeshStandardMaterial({ ...flat, color: PAPER }),
  /** Your words: highlighter yellow with a glow of its own that rises at night. */
  yours: new MeshStandardMaterial({ ...flat, color: HIGHLIGHTER, emissive: HIGHLIGHTER, emissiveIntensity: 0 }),
  cup: new MeshStandardMaterial({ ...flat, vertexColors: true }),
  pot: new MeshStandardMaterial({ ...flat, color: '#FFFFFF' }),
  leaves: new MeshStandardMaterial({ ...flat, vertexColors: true }),
  card: new MeshStandardMaterial({ ...flat, color: '#FFFFFF', side: DoubleSide }),
  box: new MeshBasicMaterial({ color: MARKER, transparent: true, opacity: 0.55, depthWrite: false }),
  sign: new MeshStandardMaterial({ ...flat, color: INK }),
  waiting: new MeshStandardMaterial({ ...flat, color: HIGHLIGHTER }),
  glow: new MeshBasicMaterial({ color: LAMP_GLOW, transparent: true, opacity: 0.6, depthWrite: false }),
  dust: new MeshBasicMaterial({ color: DUST, transparent: true, opacity: 0.75, depthWrite: false }),
};

const M = new Matrix4();
const Q = new Quaternion();
const E = new Euler();
const P = new Vector3();
const S = new Vector3();
const C = new Color();

/** Room for this many instances: a power of two, so a kind's mesh is rebuilt only when it outgrows it. */
const roomFor = (n: number) => Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const progress = (from: number, ms: number, now: number) => (ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - from) / ms)));
const still = () => false;

/**
 * One instanced mesh for a list: `place` sets the shared matrix M and colour C of each instance for the scene time.
 * While `moving` says something still animates, the layer redraws every frame and asks for the next, then draws once
 * more in the final state; otherwise it draws only when the list changes.
 */
function useInstances<T>(items: readonly T[], place: (item: T, now: number) => void, clock: SceneClock | null, moving: (now: number) => boolean) {
  const mesh = useRef<InstancedMesh>(null);
  const settled = useRef(true);
  const draw = (now: number) => {
    const m = mesh.current;
    if (!m) return;
    m.count = items.length;
    items.forEach((item, i) => {
      M.identity();
      C.set('#FFFFFF');
      place(item, now);
      m.setMatrixAt(i, M);
      m.setColorAt(i, C);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  // After every render: new items, or a mesh rebuilt for more room.
  useLayoutEffect(() => {
    draw(clock ? clock.now(performance.now()) : 0);
    settled.current = false;
  });
  useFrame((state) => {
    if (!clock) return;
    const now = clock.now(performance.now());
    if (moving(now)) {
      draw(now);
      settled.current = false;
      state.invalidate();
    } else if (!settled.current) {
      draw(now);
      settled.current = true;
    }
  });
  return { mesh, capacity: roomFor(items.length) };
}

function Instanced({ meshRef, capacity, geometry, material }: { meshRef: RefObject<InstancedMesh | null>; capacity: number; geometry: BufferGeometry; material: Material }) {
  return <instancedMesh key={capacity} ref={meshRef} args={[geometry, material, capacity]} frustumCulled={false} receiveShadow />;
}

// ---------------------------------------------------------------------------------------------------------------
// The kinds of things

type Paper = MomentProps['papers'][number];

/** Where a paper lies in its tray: a little askew, each one higher than the last. */
function placePaper(p: Paper) {
  const turn = (((p.index * 37 + Math.round(p.x * 10)) % 7) - 3) * 0.06;
  M.compose(P.set(p.x, DESK_TOP + 0.024 + p.index * 0.012, p.z), Q.setFromEuler(E.set(0, turn, 0)), S.set(1, 1, 1));
}

/** Notes waiting in trays: up to three papers, a thicker stack past that; yellow when one carries your words. */
function Papers({ papers: all, night }: { papers: MomentProps['papers']; night: number }) {
  // Send's paper still flying to a tray keeps the office's note out of it until it lands (noteHold.ts).
  const holds = useSyncExternalStore(watchHolds, holdVersion);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => noteTrays(all), [all]);
  const papers = useMemo(() => {
    void holds; // the holds' version: the filter reads them, so it runs again when one ends
    return all.filter((p) => !heldPaper(p.person, p.index));
  }, [all, holds]);
  useLayoutEffect(() => invalidate(), [papers, invalidate]);
  const kinds = useMemo(
    () => ({
      white: papers.filter((p) => !p.stack && !p.yours),
      yours: papers.filter((p) => !p.stack && p.yours),
      stacks: papers.filter((p) => p.stack && !p.yours),
      yourStacks: papers.filter((p) => p.stack && p.yours),
    }),
    [papers],
  );
  useLayoutEffect(() => {
    MATERIALS.yours.emissiveIntensity = 0.35 * night;
  }, [night]);
  const white = useInstances(kinds.white, placePaper, null, still);
  const yours = useInstances(kinds.yours, placePaper, null, still);
  const stacks = useInstances(kinds.stacks, placePaper, null, still);
  const yourStacks = useInstances(kinds.yourStacks, placePaper, null, still);
  return (
    <>
      <Instanced meshRef={white.mesh} capacity={white.capacity} geometry={SHAPES.paper} material={MATERIALS.paper} />
      <Instanced meshRef={yours.mesh} capacity={yours.capacity} geometry={SHAPES.paper} material={MATERIALS.yours} />
      <Instanced meshRef={stacks.mesh} capacity={stacks.capacity} geometry={SHAPES.stack} material={MATERIALS.paper} />
      <Instanced meshRef={yourStacks.mesh} capacity={yourStacks.capacity} geometry={SHAPES.stack} material={MATERIALS.yours} />
    </>
  );
}

/** Takeaway cups on a long day: one, two, then three at the desk's front left corner. */
function Cups({ cups }: { cups: MomentProps['cups'] }) {
  const { mesh, capacity } = useInstances(
    cups,
    (c) => {
      M.compose(P.set(c.x, DESK_TOP, c.z), Q.setFromEuler(E.set(0, c.index * 1.3, 0)), S.set(CUP_SCALE, CUP_SCALE, CUP_SCALE));
    },
    null,
    still,
  );
  return <Instanced meshRef={mesh} capacity={capacity} geometry={SHAPES.cup} material={MATERIALS.cup} />;
}

/** First-day plants, in a pot of the room's hue, popping up when they are set on the desk. */
function Plants({ plants, clock, reducedMotion }: { plants: MomentProps['plants']; clock: SceneClock; reducedMotion: boolean }) {
  const moving = (now: number) => !reducedMotion && plants.some((p) => now >= p.since && now < p.since + POP_MS);
  const at = (p: MomentProps['plants'][number], now: number) => {
    const s = Math.max(0.001, reducedMotion ? 1 : easeOut(progress(p.since, POP_MS, now)));
    M.compose(P.set(p.x, DESK_TOP, p.z), Q.identity(), S.set(s, s, s));
  };
  const pots = useInstances(
    plants,
    (p, now) => {
      at(p, now);
      C.set(p.hue);
    },
    clock,
    moving,
  );
  const leaves = useInstances(plants, at, clock, moving);
  return (
    <>
      <Instanced meshRef={pots.mesh} capacity={pots.capacity} geometry={SHAPES.pot} material={MATERIALS.pot} />
      <Instanced meshRef={leaves.mesh} capacity={leaves.capacity} geometry={SHAPES.leaves} material={MATERIALS.leaves} />
    </>
  );
}

/** Milestone cards on the meeting room's board: a card turns over to done in 0.4 s, and stays done. */
function Cards({ cards, clock, reducedMotion }: { cards: MomentProps['cards']; clock: SceneClock; reducedMotion: boolean }) {
  const moving = (now: number) => !reducedMotion && cards.some((c) => c.flippedAt !== null && now >= c.flippedAt && now < c.flippedAt + CARD_FLIP_MS);
  const { mesh, capacity } = useInstances(
    cards,
    (c, now) => {
      const t = c.flippedAt === null || reducedMotion ? 1 : progress(c.flippedAt, CARD_FLIP_MS, now);
      const turning = c.done && t < 1;
      // Half a turn about its middle: the open face until it is edge-on, then the done face.
      M.compose(P.set(c.x, c.y, c.z + OFF_FACE), Q.setFromEuler(E.set(0, turning ? Math.PI * t : 0, 0)), S.set(c.w, c.h, 1));
      C.set(c.done && (!turning || t >= 0.5) ? CARD_DONE : PAPER);
    },
    clock,
    moving,
  );
  return <Instanced meshRef={mesh} capacity={capacity} geometry={SHAPES.card} material={MATERIALS.card} />;
}

/** The org as the CEO drafts it on the board: a marker box every few seconds, each drawn in as it comes. */
function Boxes({ boxes, clock, reducedMotion }: { boxes: MomentProps['boxes']; clock: SceneClock; reducedMotion: boolean }) {
  const moving = (now: number) => !reducedMotion && boxes.some((b) => now >= b.since && now < b.since + POP_MS);
  const { mesh, capacity } = useInstances(
    boxes,
    (b, now) => {
      const t = reducedMotion ? 1 : easeOut(progress(b.since, POP_MS, now));
      M.compose(P.set(b.x - (b.w * (1 - t)) / 2, b.y, b.z + OFF_FACE), Q.identity(), S.set(Math.max(0.001, b.w * t), b.h, 1));
    },
    clock,
    moving,
  );
  return <Instanced meshRef={mesh} capacity={capacity} geometry={SHAPES.box} material={MATERIALS.box} />;
}

/** The front desk's sign on the counter (the label layer carries its words), yellow while someone waits, and the lamp's glow while it is on. */
function FrontDeskSign({ desk, night }: { desk: NonNullable<MomentProps['frontDesk']>; night: number }) {
  useLayoutEffect(() => {
    MATERIALS.glow.opacity = 0.55 + 0.4 * night;
  }, [night]);
  return (
    <>
      <mesh geometry={SHAPES.sign} material={desk.waiting > 0 ? MATERIALS.waiting : MATERIALS.sign} position={[desk.sign.x, COUNTER_TOP - 0.24, desk.sign.z + 0.02]} />
      {desk.lit && <mesh geometry={SHAPES.glow} material={MATERIALS.glow} position={[desk.lamp.x, COUNTER_TOP + 0.42, desk.lamp.z]} />}
    </>
  );
}

/** Six dust puffs where a new desk lands, drifting out and settling (the desk's own drop and squash are the scenery's). */
function Dust({ drops, clock }: { drops: MomentProps['drops']; clock: SceneClock }) {
  const puffs = useMemo(() => drops.flatMap((d) => Array.from({ length: PUFFS }, (_, k) => ({ x: d.x, z: d.z, landed: d.at + DESK_DROP_MS, k }))), [drops]);
  const moving = (now: number) => puffs.some((p) => now >= p.landed && now < p.landed + PUFF_MS);
  const { mesh, capacity } = useInstances(
    puffs,
    (p, now) => {
      const t = progress(p.landed, PUFF_MS, now);
      const size = now < p.landed || t >= 1 ? 0.001 : 0.16 * (1 - t) + 0.02;
      const angle = (p.k / PUFFS) * Math.PI * 2 + 0.4;
      const out = 0.9 + 0.55 * easeOut(t);
      M.compose(P.set(p.x + Math.cos(angle) * out * 1.05, 0.1 + 0.18 * t, p.z + Math.sin(angle) * out * 0.65), Q.identity(), S.set(size, size * 0.8, size));
    },
    clock,
    moving,
  );
  return <Instanced meshRef={mesh} capacity={capacity} geometry={SHAPES.puff} material={MATERIALS.dust} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Streamers: paper falling from the milestone board for 1.6 s, moved in the vertex shader

/** Each streamers material's clock: the fall's progress, 0 to 1, read by its vertex shader. */
const FALLING = new WeakMap<Material, { value: number }>();

/** Each streamer starts at its own place above the board, then falls, sways and turns, all on the GPU. */
function streamerMaterial(): MeshBasicMaterial {
  const time = { value: 0 };
  const material = new MeshBasicMaterial({ side: DoubleSide, transparent: true });
  FALLING.set(material, time);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aFall;').replace(
      '#include <begin_vertex>',
      [
        // aFall: sideways drift, how far it falls, a phase, and a delay (up to a quarter of the fall).
        'float t = clamp((uTime - aFall.w) / (1.0 - aFall.w), 0.0, 1.0);',
        'float spin = aFall.z * 6.2831 + t * 9.0;',
        'vec3 transformed = vec3(position.x * cos(spin), position.y * cos(spin * 0.7), position.x * sin(spin));',
        'transformed.x += aFall.x * t + sin(t * 7.0 + aFall.z * 6.2831) * 0.18;',
        'transformed.y -= aFall.y * t * t;',
      ].join('\n'),
    );
  };
  return material;
}

/** Moves the fall on to `t` (0 to 1), fading the streamers out over its last quarter. */
function fallTo(material: Material | Material[], t: number) {
  const m = Array.isArray(material) ? material[0] : material;
  if (!m) return;
  const time = FALLING.get(m);
  if (time) time.value = Math.min(1, Math.max(0, t));
  m.opacity = t >= 1 ? 0 : Math.min(1, (1 - t) * 4);
}

/** A seeded number from 0 to 1 per streamer and use, so the same celebration falls the same way every time. */
const seeded = (i: number, k: number) => {
  const v = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

function Streamers({ streamers, clock }: { streamers: NonNullable<MomentProps['streamers']>; clock: SceneClock }) {
  const mesh = useRef<InstancedMesh>(null);
  const material = useMemo(() => streamerMaterial(), []);
  const geometry = useMemo(() => SHAPES.streamer.clone(), []);
  const { count, hues, from, face, at } = streamers;
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const fall = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      M.compose(P.set(from.x + (seeded(i, 1) - 0.5) * from.w, from.y + from.h + 0.1 + seeded(i, 2) * 0.3, face + 0.05 + seeded(i, 3) * 0.6), Q.identity(), S.set(1, 1, 1));
      m.setMatrixAt(i, M);
      m.setColorAt(i, C.set(hues[i % hues.length] ?? HIGHLIGHTER));
      fall.set([(seeded(i, 4) - 0.5) * 1.2, from.y + from.h + 0.3, seeded(i, 5), seeded(i, 6) * 0.25], i * 4);
    }
    m.geometry.setAttribute('aFall', new InstancedBufferAttribute(fall, 4));
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count, hues, from, face]);
  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = (clock.now(performance.now()) - at) / STREAMER_MS;
    fallTo(m.material, t);
    if (t < 1) state.invalidate();
  });
  return <instancedMesh ref={mesh} args={[geometry, material, Math.max(1, count)]} frustumCulled={false} />;
}
