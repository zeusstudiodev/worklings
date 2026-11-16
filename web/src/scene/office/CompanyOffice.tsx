// A company's office in the 3D view (docs/game-feel.md): its floor plan built in its theme, merged into a handful of
// meshes, with monitors and lamps lit by who is at work. It rebuilds only when the floor plan, the theme or the decor
// change, or a room or desk the moments animate settles in; a new theme keeps the old office on screen until its packs
// have loaded. What the moments animate (rooms building in and going, desks dropping in) is left out of the merged
// meshes and drawn loose while it moves; the org board's pins are one instanced mesh. The stage's static shadows and
// contact shadows are told when a new building is up. Nothing here asks for frames unless something moves: an idle
// office draws nothing.
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { memo, useContext, useEffect, useMemo, useState } from 'react';
import { Mesh, MeshBasicMaterial, PlaneGeometry, type Texture, Vector3 } from 'three';
import type { Theme } from '../../../../src/core/looks.ts';
import type { ArtPack } from '../../../../src/core/themes.ts';
import { loadScenery, type Scenery } from '../art/loader.ts';
import { LabelContext } from '../labels.tsx';
import type { Layout } from '../layout.ts';
import { BUILD_FLOOR_MS, BUILD_WALLS_MS, type MomentProps, ROOM_OUT_MS } from '../moments.ts';
import { HIGHLIGHTER } from '../palette.ts';
import { useNightLevel, useStaticChange } from '../Stage.tsx';
import { buildLoose, buildOffice, type BuildKit, type DeskLight, type Element, type LooseBuild } from './build.ts';
import { builtBy, buildingPose, droppingDesks, dropPose, goingPose, type Pose } from './motion.ts';
import { BoardPins, pinsFrom, pinsKey } from './pins.ts';
import { type OfficePlan, planOffice } from './plan.ts';
import { officeTextures } from './textures.ts';

/** What the moments (moments.ts) ask of the scenery: rooms building in and going, desks dropping in, the board's pins. */
export type OfficeMoments = Pick<MomentProps, 'built' | 'gone' | 'drops' | 'pins'>;

/** The scene clock the moments' times are on (cast.ts's SceneClock). */
export interface Clock {
  now(at: number): number;
}

export interface CompanyOfficeProps {
  layout: Layout;
  theme: Theme;
  /** studio.yaml's office.decor: catalogue ids; others are skipped. */
  decor: readonly string[];
  /** People at work: monitors and lamps on. */
  lit: ReadonlySet<string>;
  /** People whose desk is open between steps: monitors dim. */
  dim: ReadonlySet<string>;
  /** A department's room picked in the scene or on its sign. */
  selectedRoom: string | null;
  onSelectRoom: (room: string | null) => void;
  /** The moments' rooms, drops and pins; without them the board shows the org from the floor plan, and nothing moves. */
  moments?: OfficeMoments | null;
  clock?: Clock | null;
}

/** How fast the lab's rack lights step while anyone works. */
const BLINK_MS = 450;
const NONE: OfficeMoments = { built: [], gone: [], drops: [], pins: [] };

type Packs = Partial<Record<ArtPack, Scenery>>;

function kitOf(packs: Packs): BuildKit {
  const atlas: Partial<Record<ArtPack, Texture>> = {};
  for (const [pack, scenery] of Object.entries(packs) as [ArtPack, Scenery][]) atlas[pack] = scenery.atlas;
  return { packs, textures: officeTextures(atlas) };
}

export const CompanyOffice = memo(function CompanyOffice({ layout, theme, decor, lit, dim, selectedRoom, onSelectRoom, moments = null, clock = null }: CompanyOfficeProps) {
  const invalidate = useThree((s) => s.invalidate);
  const staticChange = useStaticChange();
  const labels = useContext(LabelContext);
  const m = moments ?? NONE;
  const pinned = moments !== null;

  // The plan follows the decor's content, not the array's identity, which is new with every snapshot.
  const decorKey = decor.join('\n');
  const plan = useMemo(() => planOffice(layout, { theme, decor: decorKey ? decorKey.split('\n') : [], chart: !pinned }), [layout, theme, decorKey, pinned]);

  // The packs this plan draws from, loaded on demand; the made pieces sample Furniture Bits' atlas, so it is always one.
  const needed = useMemo(() => [...new Set<ArtPack>(['furniture-bits', ...(plan?.packs ?? [])])].sort(), [plan]);
  const [packs, setPacks] = useState<Packs>({});
  const [failed, setFailed] = useState<ReadonlySet<ArtPack>>(new Set());
  useEffect(() => {
    let alive = true;
    for (const pack of needed) {
      if (packs[pack] || failed.has(pack)) continue;
      loadScenery(pack).then(
        (scenery) => {
          if (alive) setPacks((p) => ({ ...p, [pack]: scenery }));
        },
        (error: unknown) => {
          console.error(`The office couldn't load ${pack}, so it draws without its pieces.`, error);
          if (alive) setFailed((f) => new Set([...f, pack]));
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [needed, packs, failed]);
  const ready = plan !== null && needed.every((p) => packs[p] !== undefined || failed.has(p));

  // What's on screen: the newest plan whose packs are in, so a theme still loading keeps the old office up. Each room
  // is remembered with the last plan that had it, so a room taken out can still lift away.
  const [shown, setShown] = useState<{ plan: OfficePlan; packs: Packs } | null>(null);
  const [remembered, setRemembered] = useState<ReadonlyMap<string, { plan: OfficePlan; packs: Packs }>>(new Map());
  if (ready && plan && shown?.plan !== plan) {
    const next = { plan, packs };
    setShown(next);
    setRemembered((before) => new Map([...before, ...plan.rooms.map((r) => [r.id, next] as const)]));
  }

  // What the moments animate now, left out of the merged building and drawn loose.
  const building = useMemo(() => new Map(m.built.map((b) => [b.room, b.at])), [m.built]);
  const dropping = useMemo(() => (shown ? droppingDesks(shown.plan.desks, m.drops) : new Map<string, number>()), [shown, m.drops]);
  const movingKey = `${[...building.keys()].sort().join(',')}|${[...dropping.keys()].sort().join(',')}`;
  const moving = useMemo(() => {
    const [rooms = '', desks = ''] = movingKey.split('|');
    return { rooms: new Set(rooms ? rooms.split(',') : []), desks: new Set(desks ? desks.split(',') : []) };
  }, [movingKey]);
  const isMoving = useMemo(() => (e: Element) => (e.room !== null && moving.rooms.has(e.room)) || (e.kind === 'desk' && moving.desks.has(e.key.slice('desk:'.length))), [moving]);

  const build = useMemo(() => (shown ? buildOffice(shown.plan, kitOf(shown.packs), (e) => !isMoving(e)) : null), [shown, isMoving]);
  // A new building has the stage draw its shadows again; a replaced one is freed once its successor is on screen,
  // and the last one when the office goes.
  useEffect(() => {
    if (!build) return;
    staticChange();
    invalidate();
    return () => build.dispose();
  }, [build, staticChange, invalidate]);

  const loose = useMemo<LooseBuild | null>(() => (shown && (moving.rooms.size > 0 || moving.desks.size > 0) ? buildLoose(shown.plan, kitOf(shown.packs), isMoving) : null), [shown, moving, isMoving]);
  useEffect(() => (loose ? () => loose.dispose() : undefined), [loose]);
  // The board's pins by what they show: a new array would make a new instanced mesh with every snapshot.
  const pinKey = pinsKey(m.pins);
  const pins = useMemo(() => pinsFrom(pinKey), [pinKey]);
  // The rooms going, by id and time: the moments' array itself is new with every snapshot.
  const goneKey = m.gone.map((g) => `${g.room}@${g.at}`).join(',');
  const gone = useMemo(() => (goneKey ? goneKey.split(',') : []).map((entry) => ({ room: entry.slice(0, entry.lastIndexOf('@')), at: Number(entry.slice(entry.lastIndexOf('@') + 1)) })), [goneKey]);
  const going = useMemo(() => {
    const out: { build: LooseBuild; at: number }[] = [];
    for (const g of gone) {
      const was = remembered.get(g.room);
      if (!was || shown?.plan.rooms.some((r) => r.id === g.room)) continue;
      out.push({ build: buildLoose(was.plan, kitOf(was.packs), (e) => e.room === g.room), at: g.at });
    }
    return out;
  }, [gone, remembered, shown]);
  useEffect(() => () => going.forEach((g) => g.build.dispose()), [going]);

  // Where each loose part is now, on the scene clock; frames keep coming while anything moves.
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const { element } of loose?.elements ?? []) if (element.kind === 'desk' || element.kind === 'piece') out.set(element.room ?? '', (out.get(element.room ?? '') ?? 0) + 1);
    return out;
  }, [loose]);
  useFrame(() => {
    if (!loose && going.length === 0) return;
    const now = clock ? clock.now(performance.now()) : Number.POSITIVE_INFINITY;
    let busy = false;
    const apply = (group: { visible: boolean; position: Vector3; scale: Vector3 }, pose: Pose) => {
      group.visible = pose.visible;
      group.position.y = pose.y;
      group.scale.set(pose.sx, pose.sy, pose.sz);
    };
    for (const { element, group } of loose?.elements ?? []) {
      const roomAt = element.room !== null ? building.get(element.room) : undefined;
      const drop = element.kind === 'desk' ? (dropping.get(element.key.slice('desk:'.length)) ?? null) : null;
      const pose = roomAt !== undefined ? buildingPose(element, roomAt, now, counts.get(element.room ?? '') ?? 1, drop) : drop !== null ? dropPose(drop, now) : null;
      if (!pose) continue;
      apply(group, pose);
      if ((roomAt !== undefined && now < builtBy(roomAt)) || (drop !== null && now < builtBy(drop - BUILD_FLOOR_MS - BUILD_WALLS_MS))) busy = true;
    }
    for (const g of going) {
      for (const { element, group } of g.build.elements) apply(group, goingPose(element, g.at, now));
      if (now < g.at + ROOM_OUT_MS) busy = true;
    }
    if (busy) invalidate();
  });

  // Monitors and lamps follow who is at work.
  useEffect(() => {
    if (!build) return;
    const state = (desk: string): DeskLight => (lit.has(desk) ? 'on' : dim.has(desk) ? 'dim' : 'off');
    if (build.setLights(state)) invalidate();
  }, [build, lit, dim, invalidate]);

  // The lab's rack lights blink only while someone works, and night dims the light pools and the windows' sky, on
  // the frames the stage draws anyway (it draws while night falls or lifts); an unchanged level changes nothing.
  const working = lit.size > 0;
  const nightLevel = useNightLevel();
  useFrame(() => {
    if (working) build?.blink(Math.floor(performance.now() / BLINK_MS));
    build?.setNight(nightLevel());
  });
  useEffect(() => {
    if (!working && build?.blink(0)) invalidate();
  }, [working, build, invalidate]);

  // Room signs, posters and the screen's corners for the label layer.
  useEffect(() => {
    if (!labels || !shown) return;
    const { anchors } = shown.plan;
    for (const a of anchors) labels.anchors.set(a.id, { point: new Vector3(a.x, a.y, a.z) });
    invalidate();
    return () => {
      for (const a of anchors) labels.anchors.delete(a.id);
    };
  }, [labels, shown, invalidate]);

  const selected = useMemo(() => {
    const room = shown?.plan.rooms.find((r) => r.id === selectedRoom && r.department);
    if (!room) return null;
    const mesh = new Mesh(new PlaneGeometry(room.w - 0.3, room.d - 0.3), new MeshBasicMaterial({ color: HIGHLIGHTER, transparent: true, opacity: 0.18, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(room.x + room.w / 2, 0.012, room.z + room.d / 2);
    mesh.raycast = () => {};
    return mesh;
  }, [shown, selectedRoom]);
  useEffect(() => {
    invalidate();
    if (!selected) return;
    return () => {
      selected.geometry.dispose();
      (selected.material as MeshBasicMaterial).dispose();
    };
  }, [selected, invalidate]);

  if (!build || !shown) return null;
  const rooms = shown.plan.rooms;
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const room = rooms.find((r) => e.point.x >= r.x && e.point.x <= r.x + r.w && e.point.z >= r.z && e.point.z <= r.z + r.d);
    onSelectRoom(room?.department ? room.id : null);
  };
  const board = shown.plan.pieces.find((p) => p.id === 'org-board');
  return (
    <>
      <primitive object={build.group} onClick={click} />
      {loose && loose.elements.map(({ element, group }) => <primitive key={element.key} object={group} />)}
      {going.map((g) => g.build.elements.map(({ element, group }) => <primitive key={`${g.at}:${element.key}`} object={group} />))}
      {selected && <primitive object={selected} />}
      {pinned && board && <Pins pins={pins} face={board.z + BOARD_FACE} clock={clock} />}
    </>
  );
});

/** The org board's face stands this far out from the board's origin (props.ts: the sheet's front). */
const BOARD_FACE = 0.1;

/** A pin per person on the CEO's org board, in their room's hue, popping in and out (moments.ts places them). */
function Pins({ pins, face, clock }: { pins: OfficeMoments['pins']; face: number; clock: Clock | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const board = useMemo(() => new BoardPins(pins, face), [pins, face]);
  useEffect(() => {
    invalidate();
    return () => board.dispose();
  }, [board, invalidate]);
  useFrame(() => {
    if (board.place(clock ? clock.now(performance.now()) : null)) invalidate();
  });
  return <primitive object={board.mesh} />;
}
