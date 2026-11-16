// Turns an office plan into a handful of merged meshes, one per material: Furniture Bits with every piece made here,
// Restaurant Bits, rugs, the walls, one per floor pattern, everything that glows, and one instanced mesh of light
// pools. About ten draw calls for a building of any size. Monitors, desk lamps and the lab's rack lights keep their
// vertex ranges in the glowing mesh, so a person starting work changes a few colours instead of rebuilding.
// Every part belongs to an element (a room's floor, its walls, a desk, a piece), so the office can leave out what is
// building in or going and draw those few elements loose, each its own small group, to animate (`buildLoose`).
// Pure three.js: the textures come in from outside (textures.ts draws them on canvases), so the tests build an
// office in Node and count what it draws.
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from 'three';
import { type ArtPack, pieceOf, THEME_LOOKS } from '../../../../src/core/themes.ts';
import { recolour } from './atlas.ts';
import { CHAIR_BACK, DESK_TOP, deskBooks, deskLamp, desk as deskTable, keyboard, lampBulb, leadDesk, monitor, monitorScreen, ON_DESK, officeChair, tray } from './desk.ts';
import { FRONT_DESKS, frontLamp } from './fronts.ts';
import { rackLightOn } from './heroes.ts';
import { MADE } from './made.ts';
import { mergeParts, type Part, trianglesOf } from './merge.ts';
import type { DeskPlan, LightPlan, OfficePlan, PiecePlan } from './plan.ts';
import { WALL_HEIGHT } from './plan.ts';
import { artwork, type Built, meetingScreen, meetingTable, milestoneBoard, orgBoard, poster, windowPiece } from './props.ts';
import { BASE, type Floor, floorKey, wallLook } from './style.ts';

/** A pack's pieces as plain geometry in the pack's own scale (loader.ts's `Scenery`). */
export interface PackKit {
  pieces: ReadonlyMap<string, BufferGeometry>;
}

export interface Textures {
  atlas: Partial<Record<ArtPack, Texture>>;
  /** The screens atlas: eight tiles in a row, the last plain white. */
  screens: Texture;
  /** A soft round gradient for light pools and halos. */
  glow: Texture;
  floor: (floor: Floor) => Texture;
}

export interface BuildKit {
  packs: Partial<Record<ArtPack, PackKit>>;
  /** None in the tests: materials without maps, the same meshes. */
  textures: Textures | null;
}

/** A desk's state, as the monitor and lamp show it (docs/game-feel.md, section 7). */
export type DeskLight = 'on' | 'dim' | 'off';

/** What a part belongs to: the base board, a room's floor or walls, a desk with its set, or a piece. */
export interface Element {
  kind: 'base' | 'floor' | 'walls' | 'desk' | 'piece';
  room: string | null;
  /** Unique in the office: "desk:<key>", "piece:<n>", "floor:<room>", "walls:<room>", "base". */
  key: string;
  /** A desk or piece's place among its room's furniture, for building in one after another. */
  order: number;
  /** Where it stands, for matching a desk dropping in. */
  x: number;
  z: number;
}

/**
 * The layer light pools and halos are drawn on: one the cameras see and the contact shadows' camera doesn't (the
 * stage's people layer, people/rig.ts), so a halo standing in the air never darkens the floor under it.
 */
export const LIGHT_LAYER = 1;

export interface OfficeBuild {
  group: Group;
  /** The meshes that cast contact shadows: furniture and walls, not floors, rugs or light. */
  casters: Mesh[];
  /** Meshes and triangles, as the renderer will draw them. */
  stats: { meshes: number; triangles: number; byMesh: Record<string, number> };
  /** Pieces left out because their pack hasn't loaded. */
  missing: string[];
  /** Lights monitors and lamps by desk; returns whether anything changed. */
  setLights(state: (desk: string) => DeskLight): boolean;
  /** Steps the rack lights' blinking; returns whether anything changed. */
  blink(step: number): boolean;
  /**
   * Night from 0 (day) to 1: every light pool and halo fades but the front desk lamp's, the windows' sky turns to
   * night, and the pieces that glow on their own (the meeting room's screen, signs) go dark like the monitors, all but
   * the front desk's. Returns whether anything changed, so an unchanged level costs nothing.
   */
  setNight(level: number): boolean;
  dispose(): void;
}

/** Elements drawn on their own to animate: each a group at its own origin (its foot, or the room's middle). */
export interface LooseBuild {
  elements: { element: Element; group: Group }[];
  dispose(): void;
}

const VIEW = new Vector3(1, 1.18, 1).normalize();
const UP = new Vector3(0, 1, 0);

/** What a part is drawn with: the atlases, rugs, walls, light, or a floor pattern by its key. */
type Bucket = 'furniture' | 'restaurant' | 'rugs' | 'structure' | 'glow' | `floor:${string}`;

interface Emitted {
  bucket: Bucket;
  part: Part;
  element: Element;
  /**
   * A glowing part whose colours change: a desk's screen or lamp bulb, a rack's lights, a window's sky at night, or
   * another piece's own glow, which goes dark at night.
   */
  lit?: { desk: string | null; kind: 'screen' | 'lamp' | 'rack' | 'window' | 'piece' };
}

const matrixOf = (x: number, y: number, z: number, rot: number, scale: number | readonly [number, number, number]) => {
  const s = typeof scale === 'number' ? new Vector3(scale, scale, scale) : new Vector3(scale[0], scale[1], scale[2]);
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, rot), s);
};

const linear = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

let sharedBox: BoxGeometry | null = null;
/** One unit box every wall and plinth part is scaled from. */
function unitBox(): BoxGeometry {
  sharedBox ??= new BoxGeometry(1, 1, 1);
  return sharedBox;
}

/** A floor slab whose top is at `top`, its pattern's UVs in world units so it keeps its scale in every room. */
function floorSlab(x: number, z: number, w: number, d: number, top: number, repeat: number): BufferGeometry {
  const g = new BoxGeometry(w, 0.06, d);
  g.translate(x + w / 2, top - 0.03, z + d / 2);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / repeat, pos.getZ(i) / repeat);
  return g;
}

/**
 * Walks a plan and emits every part of every element `keep` lets through, with the geometry made once per kind of
 * piece and shared: placing a piece only moves it.
 */
function assemble(plan: OfficePlan, kit: BuildKit, keep: (element: Element) => boolean) {
  const emitted: Emitted[] = [];
  const lights: { light: LightPlan; element: Element }[] = [];
  const floors = new Map<string, Floor>();
  const missing: string[] = [];
  const made = new Map<string, Built>();
  const recoloured = new Map<string, BufferGeometry>();
  const owned: BufferGeometry[] = [];
  const own = <T extends BufferGeometry | null | undefined>(g: T): T => {
    if (g) owned.push(g);
    return g;
  };
  const builtOnce = (key: string, make: () => Built): Built => {
    let b = made.get(key);
    if (!b) {
      b = make();
      own(b.solid);
      own(b.glow);
      made.set(key, b);
    }
    return b;
  };
  const bottomOf = (g: BufferGeometry) => {
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox?.min.y ?? 0;
  };
  let element: Element = { kind: 'base', room: null, key: 'base', order: 0, x: 0, z: 0 };
  const emit = (bucket: Bucket, part: Part, lit?: Emitted['lit']) => emitted.push({ bucket, part, element, ...(lit ? { lit } : {}) });

  /** Adds a made piece: its solid to the furniture, its glow, its lights moved with it. */
  const addBuilt = (b: Built, m: Matrix4, lit?: Emitted['lit']) => {
    if (b.solid) emit('furniture', { geometry: b.solid, matrix: m });
    if (b.glow) emit('glow', { geometry: b.glow, matrix: m }, lit);
    for (const l of b.lights ?? []) {
      const at = new Vector3(l.x, l.y, l.z).applyMatrix4(m);
      lights.push({ light: { ...l, x: at.x, y: at.y, z: at.z, desk: null, room: element.room }, element });
    }
  };

  /** The office's own parts by id, made to the plan's sizes, and the catalogue's made pieces. */
  const madeFor = (p: PiecePlan): Built | null => {
    const accent = THEME_LOOKS[p.theme].accent;
    const front = FRONT_DESKS[p.id];
    if (front && p.w !== undefined && p.d !== undefined) return builtOnce(`${p.id}/${p.w}/${p.d}/${accent}`, () => front(p.w ?? 3.6, p.d ?? 1.2, accent));
    switch (p.id) {
      case 'window':
        return builtOnce(`window/${p.w}/${p.h}`, () => windowPiece(p.w ?? 2, p.h ?? 1.5));
      case 'poster':
        return builtOnce(`poster/${p.hue}`, () => poster(p.hue));
      case 'front-lamp':
        return builtOnce('front-lamp', () => frontLamp());
      case 'meeting-table':
        return builtOnce(`meeting-table/${p.w}/${p.d}`, () => meetingTable(p.w ?? 4.4, p.d ?? 1.6));
      case 'org-board':
        return builtOnce(`org-board/${p.w}/${p.h}/${p.stand}/${JSON.stringify(plan.chart)}`, () => orgBoard(p.w ?? 3.6, p.h ?? 1.25, plan.chart, p.stand ?? null));
      case 'milestone-board':
        return builtOnce(`milestone-board/${p.w}/${p.h}/${p.stand}/${accent}`, () => milestoneBoard(p.w ?? 2.4, p.h ?? 1.0, accent, p.stand ?? null));
      case 'meeting-screen':
        return builtOnce(`meeting-screen/${p.w}/${p.h}/${p.stand}`, () => meetingScreen(p.w ?? 2.4, p.h ?? 1.35, p.stand ?? null));
      default: {
        const make = MADE[p.id];
        if (!make) return null;
        // Pieces that vary with their seed or colour are made per variant; the rest once.
        return builtOnce(`${p.id}/${p.hue}/${accent}/${p.seed % 5}`, () => make({ accent, hue: p.hue, seed: p.seed % 5, chart: plan.chart }));
      }
    }
  };

  const addPiece = (p: PiecePlan) => {
    const catalogue = pieceOf(p.id);
    if (catalogue?.draw.from === 'pack') {
      const source = kit.packs[catalogue.draw.pack]?.pieces.get(catalogue.draw.piece);
      if (!source) {
        missing.push(p.id);
        return;
      }
      const key = `${catalogue.draw.pack}/${catalogue.draw.piece}/${JSON.stringify(p.colours ?? {})}`;
      let g = recoloured.get(key);
      if (!g) {
        g = own(recolour(source, catalogue.draw.pack, p.colours ?? {}));
        recoloured.set(key, g);
      }
      const base = catalogue.draw.scale;
      const scale: [number, number, number] = typeof p.scale === 'number' ? [base * p.scale, base * p.scale, base * p.scale] : [base * p.scale[0], base * p.scale[1], base * p.scale[2]];
      const m = matrixOf(p.x, p.y - bottomOf(g) * scale[1], p.z, p.rot, scale);
      emit(p.id.includes('rug') ? 'rugs' : catalogue.draw.pack === 'restaurant-bits' ? 'restaurant' : 'furniture', { geometry: g, matrix: m });
      // KayKit's frames are empty: a painting made here goes in each.
      if (p.id.includes('picture')) {
        if (!g.boundingBox) g.computeBoundingBox();
        const box = g.boundingBox;
        if (box) {
          const art = builtOnce(`art/${key}/${p.seed % 6}`, () => ({
            solid: artwork((box.max.x - box.min.x) * 0.72, (box.max.y - box.min.y) * 0.72, p.seed % 6).translate((box.max.x + box.min.x) / 2, (box.max.y + box.min.y) / 2, box.max.z + 0.004),
          }));
          addBuilt(art, m);
        }
      }
      if (p.id === 'standing-lamp') {
        const top = new Vector3(0, 2.25, 0).applyMatrix4(m);
        lights.push({ light: { x: p.x, y: 0.03, z: p.z, sx: 4.2, sz: 4.2, colour: '#FFB25C', strength: 0.13, desk: null, room: p.room }, element });
        lights.push({ light: { x: top.x, y: top.y, z: top.z, sx: 1.1, sz: 1.1, colour: '#FFCF7A', strength: 0.28, halo: true, desk: null, room: p.room }, element });
      }
      return;
    }
    const b = madeFor(p);
    if (!b) {
      missing.push(p.id);
      return;
    }
    const bottom = Math.min(b.solid ? bottomOf(b.solid) : 0, b.glow ? bottomOf(b.glow) : Number.POSITIVE_INFINITY);
    // At night the rack keeps blinking and the front desk keeps its glow (its lamp is the one light left on); the
    // windows turn to night and every other piece's glow goes dark.
    const front = Object.hasOwn(FRONT_DESKS, p.id) || p.id === 'front-lamp';
    const tag: Emitted['lit'] = p.id === 'server-rack' ? { desk: null, kind: 'rack' } : p.id === 'window' ? { desk: null, kind: 'window' } : front ? undefined : { desk: null, kind: 'piece' };
    addBuilt(b, matrixOf(p.x, p.y - bottom, p.z, p.rot, p.scale), tag);
  };

  const addDesk = (d: DeskPlan) => {
    const at = (x: number, y: number, z: number, rot = 0) => matrixOf(d.x + x, y, d.z + z, rot, 1);
    const variant = d.seed % 2;
    addBuilt(builtOnce(`desk/${d.wide}/${d.w}/${d.d}/${d.hue}/${variant}`, () => ({ solid: d.wide ? leadDesk(d.w, d.d) : deskTable(d.w, d.d, d.hue, variant) })), at(0, 0, 0));
    addBuilt(builtOnce('monitor', () => ({ solid: monitor() })), at(ON_DESK.monitor.x, DESK_TOP, ON_DESK.monitor.z));
    addBuilt(builtOnce(`screen/${d.tile}`, () => ({ solid: null, glow: monitorScreen(d.tile) })), at(ON_DESK.monitor.x, DESK_TOP, ON_DESK.monitor.z), { desk: d.key, kind: 'screen' });
    addBuilt(builtOnce('keyboard', () => ({ solid: keyboard() })), at(ON_DESK.keyboard.x, DESK_TOP, ON_DESK.keyboard.z));
    addBuilt(builtOnce('tray', () => ({ solid: tray() })), matrixOf(d.tray.x, DESK_TOP, d.tray.z, 0, 1));
    addBuilt(builtOnce(`chair/${d.hue}`, () => ({ solid: officeChair(d.hue) })), at(0, 0, -CHAIR_BACK));
    const corner = ON_DESK.corner;
    if (d.corner === 'lamp') {
      addBuilt(builtOnce(`lamp/${d.hue}`, () => ({ solid: deskLamp(d.hue) })), at(corner.x, DESK_TOP, corner.z, Math.PI));
      addBuilt(builtOnce('bulb', () => ({ solid: null, glow: lampBulb('#FFE7A8') })), at(corner.x, DESK_TOP, corner.z, Math.PI), { desk: d.key, kind: 'lamp' });
    } else if (d.corner) {
      const piece = pieceOf(d.corner);
      const source = piece?.draw.from === 'pack' ? kit.packs[piece.draw.pack]?.pieces.get(piece.draw.piece) : undefined;
      if (piece?.draw.from === 'pack' && source) {
        const s = piece.draw.scale;
        emit('furniture', { geometry: source, matrix: matrixOf(d.x + corner.x, DESK_TOP - bottomOf(source) * s, d.z + corner.z, d.corner === 'photo-frame' ? Math.PI - 0.3 : 0.4, s) });
      } else {
        addBuilt(builtOnce(`books/${d.seed % 5}`, () => ({ solid: deskBooks(d.seed % 5) })), at(corner.x, DESK_TOP, corner.z, 0.3));
      }
    }
  };

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, colour: string) => {
    emit('structure', { geometry: unitBox(), matrix: matrixOf(x, y, z, 0, [w, h, d]), tint: linear(colour) });
  };

  // The base board and the hall.
  const b = plan.base;
  element = { kind: 'base', room: null, key: 'base', order: 0, x: b.x + b.w / 2, z: b.z + b.d / 2 };
  if (keep(element)) {
    box(b.w + 0.5, 0.2, b.d + 0.5, b.x + b.w / 2, -0.2, b.z + b.d / 2, BASE.edge);
    // Its top 1 cm under the hall floor's (-0.02, plan.ts): level with it, the two fought for depth in stripes.
    box(b.w, 0.1, b.d, b.x + b.w / 2, -0.08, b.z + b.d / 2, BASE.board);
  }
  for (const f of plan.floors) {
    element = f.room ? { kind: 'floor', room: f.room, key: `floor:${f.room}`, order: 0, x: f.x + f.w / 2, z: f.z + f.d / 2 } : { ...element, kind: 'base', room: null, key: 'base' };
    if (!keep(element)) continue;
    const key = floorKey(f.floor);
    floors.set(key, f.floor);
    emit(`floor:${key}`, { geometry: own(floorSlab(f.x, f.z, f.w, f.d, f.top, f.floor.pattern === 'checks' ? 1.8 : 3.2)), tint: linear(f.tint) });
  }

  // Walls: tall ones with a wainscot, rail, skirting, cap and the department's stripe; low ones capped.
  for (const w of plan.walls) {
    const room = plan.rooms.find((r) => r.id === w.room);
    element = { kind: 'walls', room: w.room, key: `walls:${w.room}`, order: 0, x: room ? room.x + room.w / 2 : w.x, z: room ? room.z + room.d / 2 : w.z };
    if (!keep(element)) continue;
    const look = wallLook(w.theme);
    const height = WALL_HEIGHT[w.kind];
    const along = w.w >= w.d;
    const cx = w.x + w.w / 2;
    const cz = w.z + w.d / 2;
    const at = (y: number, h: number, wider: number, colour: string) => (along ? box(w.w, h, w.d + wider, cx, y, cz, colour) : box(w.w + wider, h, w.d, cx, y, cz, colour));
    if (w.kind === 'full') {
      at(0.525, 1.05, 0, look.wainscot);
      at(1.05 + (height - 1.05) / 2, height - 1.05, 0, look.wall);
      at(1.07, 0.06, 0.06, look.cap);
      at(0.07, 0.14, 0.04, look.skirting);
      at(height + 0.04, 0.08, 0.08, look.cap);
      if (w.stripe) {
        // A band of the department's colour near the top of the inner face.
        const length = (along ? w.w : w.d) - 0.3;
        if (w.side === 'back') box(length, 0.09, 0.025, cx, height - 0.32, cz + w.d / 2 + 0.012, w.stripe);
        else box(0.025, 0.09, length, cx + w.w / 2 + 0.012, height - 0.32, cz, w.stripe);
      }
    } else {
      at(height / 2, height, 0, look.wall);
      at(height + 0.035, 0.07, 0.07, look.cap);
    }
  }

  // Desks and pieces, each in its room's order.
  const orders = new Map<string, number>();
  const nextOrder = (room: string | null) => {
    const k = orders.get(room ?? '') ?? 0;
    orders.set(room ?? '', k + 1);
    return k;
  };
  for (const d of plan.desks) {
    element = { kind: 'desk', room: d.room, key: `desk:${d.key}`, order: nextOrder(d.room), x: d.x, z: d.z };
    if (keep(element)) addDesk(d);
  }
  plan.pieces.forEach((p, i) => {
    element = { kind: 'piece', room: p.room, key: `piece:${i}`, order: nextOrder(p.room), x: p.x, z: p.z };
    if (keep(element)) addPiece(p);
  });
  // The plan's own lights go with their desk or room.
  for (const light of plan.lights) {
    const owner: Element = light.desk ? { kind: 'desk', room: light.room, key: `desk:${light.desk}`, order: 0, x: light.x, z: light.z } : { kind: 'floor', room: light.room, key: `floor:${light.room ?? ''}`, order: 0, x: light.x, z: light.z };
    if (keep(owner)) lights.push({ light, element: owner });
  }
  return { emitted, lights: lights.map((l) => l.light), floors, missing, owned };
}

/** Materials for the buckets a build uses: the atlases, rugs, walls, the floors' patterns, and glow. */
function materialsFor(kit: BuildKit, floors: ReadonlyMap<string, Floor>) {
  const tex = kit.textures;
  const made = new Map<Bucket, Material>();
  const atlas = (pack: ArtPack) => new MeshStandardMaterial({ map: tex?.atlas[pack] ?? null, vertexColors: true, roughness: 0.78, metalness: 0 });
  return {
    get(bucket: Bucket): Material {
      let m = made.get(bucket);
      if (m) return m;
      if (bucket === 'furniture' || bucket === 'rugs') m = atlas('furniture-bits');
      else if (bucket === 'restaurant') m = atlas('restaurant-bits');
      else if (bucket === 'structure') m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
      else if (bucket === 'glow') m = new MeshBasicMaterial({ map: tex?.screens ?? null, vertexColors: true });
      else {
        const floor = floors.get(bucket.slice('floor:'.length));
        m = new MeshStandardMaterial({ vertexColors: true, map: floor && tex ? tex.floor(floor) : null, roughness: 0.95, metalness: 0 });
      }
      made.set(bucket, m);
      return m;
    },
    dispose() {
      for (const m of made.values()) m.dispose();
    },
  };
}

const casts = (bucket: Bucket) => bucket === 'furniture' || bucket === 'restaurant' || bucket === 'structure';
const receives = (bucket: Bucket) => bucket !== 'glow';

/** Builds an office from its plan, leaving out the elements `keep` turns down (those building in or going). */
export function buildOffice(plan: OfficePlan, kit: BuildKit, keep: (element: Element) => boolean = () => true): OfficeBuild {
  const { emitted, lights, floors, missing, owned } = assemble(plan, kit, keep);
  const materials = materialsFor(kit, floors);
  const group = new Group();
  group.name = 'office';
  const casters: Mesh[] = [];
  const byMesh: Record<string, number> = {};
  const buckets = new Map<Bucket, Emitted[]>();
  for (const e of emitted) {
    const list = buckets.get(e.bucket) ?? [];
    list.push(e);
    buckets.set(e.bucket, list);
  }
  const order: Bucket[] = ['furniture', 'restaurant', 'rugs', 'structure', ...[...buckets.keys()].filter((b) => b.startsWith('floor:')), 'glow'];
  const meshes = new Map<Bucket, Mesh>();
  for (const bucket of order) {
    const list = buckets.get(bucket);
    if (!list?.length) continue;
    const geometry = mergeParts(list.map((e) => e.part));
    const m = new Mesh(geometry, materials.get(bucket));
    m.name = bucket;
    m.castShadow = casts(bucket);
    m.receiveShadow = receives(bucket);
    m.matrixAutoUpdate = false;
    group.add(m);
    meshes.set(bucket, m);
    byMesh[bucket] = trianglesOf(geometry);
    if (casts(bucket)) casters.push(m);
  }

  // The glowing parts whose colours change, by their place in the glowing mesh.
  const glowMesh = meshes.get('glow') ?? null;
  const ranges: { lit: NonNullable<Emitted['lit']>; start: number; count: number; base: Float32Array }[] = [];
  if (glowMesh) {
    const colour = glowMesh.geometry.getAttribute('color') as BufferAttribute;
    let start = 0;
    for (const e of buckets.get('glow') ?? []) {
      const count = e.part.geometry.getAttribute('position').count;
      if (e.lit) ranges.push({ lit: e.lit, start, count, base: (colour.array as Float32Array).slice(start * 3, (start + count) * 3) });
      start += count;
    }
  }

  // Light pools and halos: one instanced quad, added on top of what's below, never in the contact shadow.
  let pools: InstancedMesh | null = null;
  const poolBase: Color[] = [];
  let poolMaterial: Material | null = null;
  if (lights.length > 0) {
    poolMaterial = new MeshBasicMaterial({ map: kit.textures?.glow ?? null, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide });
    const quad = new PlaneGeometry(1, 1);
    owned.push(quad);
    pools = new InstancedMesh(quad, poolMaterial, lights.length);
    pools.name = 'pools';
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    const facing = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), VIEW);
    const m = new Matrix4();
    lights.forEach((l, i) => {
      m.compose(new Vector3(l.x, l.y, l.z), l.halo ? facing : flat, new Vector3(l.sx, l.sz, 1));
      pools?.setMatrixAt(i, m);
      const c = new Color(l.colour).multiplyScalar(l.strength);
      poolBase.push(c);
      pools?.setColorAt(i, c);
    });
    pools.renderOrder = 2;
    pools.frustumCulled = false;
    pools.matrixAutoUpdate = false;
    // Light is never picked, and stays off the layer the contact shadows are drawn from.
    pools.raycast = () => {};
    pools.layers.set(LIGHT_LAYER);
    group.add(pools);
    byMesh.pools = lights.length * 2;
  }

  // Lighting by desk: the screens, their halos and pools, and the lamps.
  const SCALE: Readonly<Record<DeskLight, { screen: number; lamp: number; pool: number }>> = {
    on: { screen: 1, lamp: 1, pool: 1 },
    dim: { screen: 0.32, lamp: 0, pool: 0.25 },
    off: { screen: 0, lamp: 0, pool: 0 },
  };
  const DARK = linear('#1E2622');
  // Each pool's share of its full light: its desk's state, and night's for everything but the front desk's lamp.
  const deskShare = lights.map(() => 1);
  let night = 0;
  const paintPools = () => {
    if (!pools) return;
    const c = new Color();
    lights.forEach((l, i) => {
      const k = (deskShare[i] ?? 1) * (l.stays ? 1 : 1 - night);
      pools?.setColorAt(i, c.copy(poolBase[i] ?? c.set(0, 0, 0)).multiplyScalar(k));
    });
    if (pools.instanceColor) pools.instanceColor.needsUpdate = true;
  };
  const known = new Map<string, DeskLight>();
  const deskKeys = new Set([...ranges.flatMap((r) => (r.lit.desk ? [r.lit.desk] : [])), ...lights.flatMap((l) => (l.desk ? [l.desk] : []))]);
  const setLights = (state: (desk: string) => DeskLight): boolean => {
    const now = new Map<string, DeskLight>();
    let changed = false;
    for (const key of deskKeys) {
      const s = state(key);
      now.set(key, s);
      if (known.get(key) !== s) changed = true;
    }
    if (!changed) return false;
    for (const [k, v] of now) known.set(k, v);
    if (glowMesh) {
      const colour = glowMesh.geometry.getAttribute('color') as BufferAttribute;
      const array = colour.array as Float32Array;
      for (const { lit, start, count, base } of ranges) {
        if (!lit.desk) continue;
        const k = SCALE[now.get(lit.desk) ?? 'off'][lit.kind === 'lamp' ? 'lamp' : 'screen'];
        for (let i = 0; i < count * 3; i++) array[start * 3 + i] = k > 0 ? (base[i] ?? 0) * k : (DARK[i % 3] ?? 0) * (lit.kind === 'lamp' ? 2.5 : 1);
      }
      colour.needsUpdate = true;
    }
    lights.forEach((l, i) => {
      if (!l.desk) return;
      const scale = SCALE[now.get(l.desk) ?? 'off'];
      deskShare[i] = l.part === 'lamp' ? scale.lamp : scale.pool;
    });
    paintPools();
    return true;
  };

  /** The windows' glass at night: a deep blue in place of the day's sky. Other pieces go as dark as a monitor. */
  const NIGHT_GLASS = linear('#1B2640');
  const nightly = ranges.filter((r) => r.lit.kind === 'window' || r.lit.kind === 'piece');
  const setNight = (level: number): boolean => {
    const next = Math.min(1, Math.max(0, level));
    // Steps too small to see are skipped, but day and full night are always reached.
    if (next === night || (Math.abs(next - night) < 0.002 && next > 0 && next < 1)) return false;
    night = next;
    paintPools();
    if (glowMesh && nightly.length > 0) {
      const colour = glowMesh.geometry.getAttribute('color') as BufferAttribute;
      const array = colour.array as Float32Array;
      for (const { lit, start, count, base } of nightly) {
        const to = lit.kind === 'window' ? NIGHT_GLASS : DARK;
        for (let i = 0; i < count * 3; i++) array[start * 3 + i] = (base[i] ?? 0) * (1 - night) + (to[i % 3] ?? 0) * night;
      }
      colour.needsUpdate = true;
    }
    return true;
  };

  let blinkStep = -1;
  const blink = (step: number): boolean => {
    const racks = ranges.filter((r) => r.lit.kind === 'rack');
    if (!glowMesh || racks.length === 0 || step === blinkStep) return false;
    blinkStep = step;
    const colour = glowMesh.geometry.getAttribute('color') as BufferAttribute;
    const array = colour.array as Float32Array;
    racks.forEach(({ start, count, base }, rack) => {
      for (let v = 0; v < count; v++) {
        const on = rackLightOn(Math.floor(v / 4) + rack * 18, step);
        for (let k = 0; k < 3; k++) array[(start + v) * 3 + k] = on ? (base[v * 3 + k] ?? 0) : (DARK[k] ?? 0) * 1.4;
      }
    });
    colour.needsUpdate = true;
    return true;
  };

  // Everyone starts dark; the office lights desks from the cast at once.
  setLights(() => 'off');
  blink(0);

  const triangles = Object.values(byMesh).reduce((s, n) => s + n, 0);
  return {
    group,
    casters,
    stats: { meshes: group.children.length, triangles, byMesh },
    missing,
    setLights,
    blink,
    setNight,
    dispose() {
      for (const m of meshes.values()) m.geometry.dispose();
      for (const g of owned) g.dispose();
      materials.dispose();
      poolMaterial?.dispose();
    },
  };
}

/**
 * The elements `keep` lets through, each drawn on its own: a group per element holding a mesh per material it
 * uses, its geometry moved so the group's origin is the element's foot (a desk or piece) or its room's middle (a
 * floor or walls), ready to drop, rise or lower as a whole. Light pools are left out: these are only on screen while
 * they move.
 */
export function buildLoose(plan: OfficePlan, kit: BuildKit, keep: (element: Element) => boolean): LooseBuild {
  const { emitted, floors, owned } = assemble(plan, kit, keep);
  const materials = materialsFor(kit, floors);
  const byElement = new Map<string, { element: Element; parts: Map<Bucket, Part[]> }>();
  for (const e of emitted) {
    let entry = byElement.get(e.element.key);
    if (!entry) {
      entry = { element: e.element, parts: new Map() };
      byElement.set(e.element.key, entry);
    }
    const list = entry.parts.get(e.bucket) ?? [];
    list.push(e.part);
    entry.parts.set(e.bucket, list);
  }
  const geometries: BufferGeometry[] = [];
  const elements = [...byElement.values()].map(({ element, parts }) => {
    const group = new Group();
    group.name = element.key;
    group.position.set(element.x, 0, element.z);
    const back = new Matrix4().makeTranslation(-element.x, 0, -element.z);
    for (const [bucket, list] of parts) {
      const geometry = mergeParts(list.map((p) => ({ ...p, matrix: back.clone().multiply(p.matrix ?? new Matrix4()) })));
      geometries.push(geometry);
      const m = new Mesh(geometry, materials.get(bucket));
      m.castShadow = casts(bucket);
      m.receiveShadow = receives(bucket);
      group.add(m);
    }
    return { element, group };
  });
  return {
    elements,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const g of owned) g.dispose();
      materials.dispose();
    },
  };
}
