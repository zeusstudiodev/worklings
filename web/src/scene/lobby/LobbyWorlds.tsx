// The lobby's 3D stage (docs/game-feel.md, section 5; docs/design-v3.md, "Lobby"): every company as a small world in
// its theme on the mat, in a place it keeps, its windows lit while people work, a figure with a yellow paper at the
// door when it needs you, dark but for the door lamp while it rests. Its sign is a button with the name, state and
// count; the lobby's panel is the accessible twin, so the signs stay out of the tab order. Entering lifts the roof and
// lowers the front walls as the view closes in (600 ms), then calls `onEnter`; with reduced motion, a 150 ms fade.
// It draws on change only: a window fades in over a second, and nothing else moves.
import { Grid } from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { type CSSProperties, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type DirectionalLight, NeutralToneMapping, type OrthographicCamera, type Texture, Vector3 } from 'three';
import type { LobbyCompany, LobbyView } from '../../../../src/core/company.ts';
import { stageWord } from '../../company/lobby/lobbyModel.ts';
import { lobbyRow } from '../../company/model.ts';
import { Count } from '../../company/ui/Count.tsx';
import { THEME_SWATCH } from '../../company/ui/ThemeStill.tsx';
import { useReducedMotion } from '../../lib/hooks.ts';
import { loadScenery } from '../art/loader.ts';
import { LabelContext, LabelProjector, LabelStore } from '../labels.tsx';
import { FilmCamera, filmHolds } from '../filmCamera.tsx';
import { MAT, MAT_GRID } from '../palette.ts';
import { WorldView } from './view.ts';
import { doorFigure, type WorldParts, worldParts } from './world.ts';
import { LOBBY, lobbyBounds, lobbySlots, slotPoint, type WorldState, worldState } from './worlds.ts';

export interface LobbyWorldsProps {
  lobby: LobbyView;
  /** Called once the way in has played: the shell navigates to the company. */
  onEnter: (company: string) => void;
  /** What the HUD covers at the stage's edges, so the worlds sit in the part left free. */
  insets?: { top: number; right: number; bottom: number };
  /** The company just left: its world starts open and closes up again. */
  returning?: string | null;
}

const VIEW = new Vector3(1, 1.18, 1).normalize();
const GL = { toneMapping: NeutralToneMapping, antialias: true } as const;
const NO_INSETS = { top: 0, right: 0, bottom: 0 } as const;
const ENTER_MS = 600;
const FADE_MS = 150;
/** How much the view closes in at the end of the way in. */
const CLOSE_IN = 2.3;
/** Pixels kept above the top row of worlds for their signs. */
const SIGN_ROOM = 44;
/** Where each company's place is kept between visits. */
const PLACES_KEY = 'worklings-lobby-places';

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function readPlaces(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PLACES_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [id, slot] of Object.entries(raw)) if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < 1000) out[id] = slot;
    return out;
  } catch {
    // Storage off or the entry unreadable: places start afresh and are kept from now on.
    return {};
  }
}

function writePlaces(places: Readonly<Record<string, number>>) {
  try {
    window.localStorage.setItem(PLACES_KEY, JSON.stringify(places));
  } catch {
    // Storage off: places hold for this visit only.
  }
}

/** The way in (or out) of one world: who, and when it started. */
interface Opening {
  id: string;
  at: number;
  /** In: lifting the roof, then entering. Out: closing up after coming back. */
  dir: 'in' | 'out';
}

export const LobbyWorlds = memo(function LobbyWorlds({ lobby, onEnter, insets = NO_INSETS, returning = null }: LobbyWorldsProps) {
  const reduced = useReducedMotion();
  const [labels] = useState(() => new LabelStore());
  const ids = lobby.companies.map((c) => c.id);
  const idsKey = ids.join('\n');
  const [kept] = useState(readPlaces);
  const slots = useMemo(() => lobbySlots(idsKey ? idsKey.split('\n') : [], kept), [idsKey, kept]);
  useEffect(() => writePlaces({ ...kept, ...slots }), [kept, slots]);

  const [opening, setOpening] = useState<Opening | null>(() => (returning && !reduced ? { id: returning, at: performance.now(), dir: 'out' } : null));
  const [fading, setFading] = useState<string | null>(null);
  const entered = useRef(false);
  const enter = useCallback(
    (id: string) => {
      if (entered.current) return;
      if (reduced) {
        entered.current = true;
        setFading(id);
        window.setTimeout(() => onEnter(id), FADE_MS);
        return;
      }
      setOpening({ id, at: performance.now(), dir: 'in' });
    },
    [reduced, onEnter],
  );
  const arrived = useCallback(
    (id: string) => {
      if (entered.current) return;
      entered.current = true;
      onEnter(id);
    },
    [onEnter],
  );

  const bounds = useMemo(() => lobbyBounds(Object.values(slots)), [slots]);
  useEffect(() => labels.setView(insets, reduced, false), [labels, insets, reduced]);

  const style: CSSProperties = { position: 'absolute', inset: 0, opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease` };
  return (
    <div style={style}>
      <Canvas orthographic shadows="percentage" dpr={[1, 2]} gl={GL} frameloop="demand" camera={{ position: [60, 70, 60], zoom: 20, near: 0.1, far: 500 }} aria-hidden="true">
        <color attach="background" args={[MAT]} />
        <Lights bounds={bounds} />
        <Mat />
        <LabelContext.Provider value={labels}>
          <Worlds companies={lobby.companies} slots={slots} opening={opening} onPick={enter} onArrived={arrived} />
          {import.meta.env.VITE_WORKLINGS_FILM === '1' && <FilmCamera stage="lobby" />}
          <LabelProjector store={labels} />
        </LabelContext.Provider>
        <Camera bounds={bounds} insets={insets} opening={opening} slots={slots} />
      </Canvas>
      <div className="labels" aria-hidden="true">
        {lobby.companies.map((c) => {
          const row = lobbyRow(c, lobby.serverTime);
          return (
            <div key={c.id} ref={labels.node(`world:${c.id}`)} className="label">
              <div className="room-sign">
                <button type="button" tabIndex={-1} className="room-sign__button" style={{ ['--hue' as string]: THEME_SWATCH[c.theme]?.mark ?? '#6b7a73' }} onClick={() => enter(c.id)}>
                  {row.name} <Count n={row.needsYou} />
                  <span className="room-sign__more">{c.summary ? stageWord(c.summary.stage).word : row.state.pill}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** Light as the office has it: a sky, a warm key with soft shadows drawn when the worlds change, a cool fill. */
function Lights({ bounds }: { bounds: ReturnType<typeof lobbyBounds> }) {
  const key = useRef<DirectionalLight>(null);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 6;
  useLayoutEffect(() => {
    const l = key.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    l.shadow.camera.updateProjectionMatrix();
  }, [cx, cz, half]);
  return (
    <>
      <hemisphereLight args={['#FFF0DA', '#4E6A5C', 0.82]} />
      <directionalLight
        ref={key}
        position={[cx - 19, 28, cz + 19]}
        intensity={3.0}
        color="#FFE3BE"
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
      <directionalLight position={[cx + 24, 16, cz - 20]} intensity={0.32} color="#CFE0F4" />
    </>
  );
}

const Mat = memo(function Mat() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.24, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <shadowMaterial opacity={0.22} />
      </mesh>
      <Grid position={[0, -0.235, 0]} args={[400, 400]} cellSize={1} cellThickness={0.55} cellColor={MAT_GRID} sectionSize={5} sectionThickness={1} sectionColor="#7C998B" fadeDistance={260} fadeStrength={1} infiniteGrid />
    </>
  );
});

/** Fits the worlds into the free part of the stage; closes in on a world as you enter it. */
function Camera({ bounds, insets, opening, slots }: { bounds: ReturnType<typeof lobbyBounds>; insets: { top: number; right: number; bottom: number }; opening: Opening | null; slots: Readonly<Record<string, number>> }) {
  const get = useThree((s) => s.get);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const fit = useRef<{ position: Vector3; target: Vector3; zoom: number } | null>(null);
  useEffect(() => {
    const { camera, size, invalidate } = get();
    const cam = camera as OrthographicCamera;
    const center = new Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    cam.position.copy(center).addScaledVector(VIEW, 90);
    cam.up.set(0, 1, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const corners: Vector3[] = [];
    for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) for (const y of [-0.3, 6.5]) corners.push(new Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse));
    const w = Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x));
    const h = Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y));
    // Room above the top row for its signs.
    const top = insets.top + SIGN_ROOM;
    const freeW = Math.max(160, size.width - insets.right);
    const freeH = Math.max(160, size.height - top - insets.bottom);
    cam.zoom = Math.min(freeW / w, freeH / h) * 0.9;
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const shift = right.multiplyScalar(insets.right / 2 / cam.zoom).add(up.multiplyScalar((top - insets.bottom) / 2 / cam.zoom));
    cam.position.add(shift);
    const target = center.clone().add(shift);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    fit.current = { position: cam.position.clone(), target, zoom: cam.zoom };
    invalidate();
  }, [get, bounds, insets.top, insets.right, insets.bottom, width, height]);

  useFrame(({ camera, invalidate }) => {
    const base = fit.current;
    if (!opening || !base || (import.meta.env.VITE_WORKLINGS_FILM === '1' && filmHolds('lobby'))) return;
    const cam = camera as OrthographicCamera;
    const slot = slots[opening.id];
    if (slot === undefined) return;
    const p = slotPoint(slot);
    const t = Math.min(1, (performance.now() - opening.at) / ENTER_MS);
    const e = ease(opening.dir === 'in' ? t : 1 - t);
    const world = new Vector3(p.x, 1.2, p.z);
    const target = base.target.clone().lerp(world, e);
    cam.position.copy(target).addScaledVector(VIEW, 90);
    cam.lookAt(target);
    cam.zoom = base.zoom * (1 + (CLOSE_IN - 1) * e);
    cam.updateProjectionMatrix();
    if (t < 1) invalidate();
  });
  return null;
}

/** Every company's world, each built once per theme and size, and kept in step with the lobby. */
function Worlds({ companies, slots, opening, onPick, onArrived }: { companies: readonly LobbyCompany[]; slots: Readonly<Record<string, number>>; opening: Opening | null; onPick: (id: string) => void; onArrived: (id: string) => void }) {
  const [atlas, setAtlas] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    loadScenery('furniture-bits').then(
      (s) => {
        if (alive) setAtlas(s.atlas);
      },
      (error: unknown) => console.error("The lobby couldn't load its scenery, so the worlds stay off the mat.", error),
    );
    return () => {
      alive = false;
    };
  }, []);

  const states = useMemo(() => companies.map(worldState), [companies]);
  return (
    <>
      {atlas &&
        states.map((state) => {
          const slot = slots[state.id];
          const people = companies.find((c) => c.id === state.id)?.people.length ?? 0;
          if (slot === undefined) return null;
          return <World key={state.id} state={state} people={Math.min(LOBBY.maxWindows, people)} slot={slot} atlas={atlas} opening={opening?.id === state.id ? opening : null} onPick={onPick} onArrived={onArrived} />;
        })}
      <ShadowsOnChange version={`${states.map((s) => `${s.id}:${s.theme}:${s.windows.length}:${s.waiting}`).join('|')}|${atlas ? 1 : 0}`} />
    </>
  );
}

/** The worlds' shadows are drawn when they change (a world added, a theme or size changed), not every frame. */
function ShadowsOnChange({ version }: { version: string }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const { gl, invalidate } = get();
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [version, get]);
  return null;
}

const partsCache = new Map<string, WorldParts>();
const figure = doorFigure();

/** One company's world. */
const World = memo(function World({ state, people, slot, atlas, opening, onPick, onArrived }: { state: WorldState; people: number; slot: number; atlas: Texture; opening: Opening | null; onPick: (id: string) => void; onArrived: (id: string) => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const view = useMemo(() => {
    const key = `${state.theme}/${people}`;
    let parts = partsCache.get(key);
    if (!parts) {
      parts = worldParts(state.theme, people);
      partsCache.set(key, parts);
    }
    return new WorldView(parts, people, atlas);
  }, [state.theme, people, atlas]);
  useEffect(() => () => view.dispose(), [view]);

  // A resting company is dark but for its door lamp; windows fade to their light over a second.
  useEffect(() => {
    view.setResting(state.resting);
    view.setWindows(state.windows, state.resting, performance.now());
    invalidate();
  }, [view, state.windows, state.resting, invalidate]);

  // The way in: the roof lifts and the front walls drop to knee height; at the end the shell takes over.
  const done = useRef(false);
  useFrame(() => {
    const now = performance.now();
    if (view.step(now)) invalidate();
    if (!opening) return;
    const t = Math.min(1, (now - opening.at) / ENTER_MS);
    view.open(ease(opening.dir === 'in' ? t : 1 - t));
    if (t < 1) invalidate();
    else if (opening.dir === 'in' && !done.current) {
      done.current = true;
      onArrived(opening.id);
    }
  });

  const p = slotPoint(slot);
  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPick(state.id);
  };
  const store = useContext(LabelContext);
  useEffect(() => {
    if (!store) return;
    const id = `world:${state.id}`;
    store.anchors.set(id, { point: new Vector3(p.x + LOBBY.building.x0 + 0.4, view.height + 1.2, p.z + LOBBY.building.z0 + 0.4) });
    invalidate();
    return () => {
      store.anchors.delete(id);
    };
  }, [store, state.id, p.x, p.z, view, invalidate]);

  return (
    <group position={[p.x, 0, p.z]}>
      <primitive
        object={view.group}
        onClick={pick}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      />
      {state.waiting && (
        <group position={[LOBBY.doorX, 0, LOBBY.building.z1 + 0.6]}>
          <mesh geometry={figure.solid} castShadow>
            <meshStandardMaterial map={atlas} vertexColors roughness={0.82} />
          </mesh>
          {figure.glow && (
            <mesh geometry={figure.glow}>
              <meshBasicMaterial vertexColors />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
});
