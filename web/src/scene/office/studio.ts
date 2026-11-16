// v2's model of a studio the office only watches (v1 and v2), as three merged meshes instead of a mesh per box: the
// same boxes, cones and plants in the same colours, so it looks as it always did, at a handful of draw calls instead of
// hundreds (566 at 25 roles). Static parts are one flat-shaded mesh; the floors another, so the selected room can
// change colour in place; laptop screens and lamp bulbs a third, with a per-vertex glow so a desk lights up exactly
// as v2's emissive materials did. Clicks resolve by where they land: a poster, a room, the lobby or the lead's office.
// Pure three.js, so the tests count what it draws.
import {
  type BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { DESK_DEPTH, DESK_WIDTH, DOOR_WIDTH, LEAD_DESK_WIDTH, type Layout, type Rect, seatOf, WALL_HEIGHT, WALL_THICKNESS } from '../layout.ts';
import { BASE_BOARD, BASE_EDGE, DEPARTMENT_HUE, floorColor, HIGHLIGHTER, METAL, PLANT, PLANT_DARK, POT, SCREEN_OFF, SCREEN_ON, tint, WALL, WALL_TOP, WOOD, WOOD_DARK } from '../palette.ts';
import { mergeParts, type Part, trianglesOf } from './merge.ts';

/** The lead's colour in v2: gold. */
const LEAD_HUE = '#C9B458';
const LOBBY_FLOOR = '#E4DED3';
const LEAD_FLOOR = '#F4ECC8';
const LOBBY_MAT = '#B9AE9C';
const POSTER = '#FBFAF6';
const POSTER_LINE = '#B9B4AA';
const BULB_OFF = '#7d7a6f';

export interface StudioBuild {
  group: Group;
  /** Meshes and triangles, as the renderer will draw them. */
  stats: { meshes: number; triangles: number };
  /** Lights laptops and desk lamps by role id ("lead" for the lead's desk); returns whether anything changed. */
  setLit(lit: (desk: string) => boolean): boolean;
  /** Tints the selected room's floor as v2 did; returns whether anything changed. */
  select(room: string | null): boolean;
  /** What a click at a point on the model means: a rule's poster, a room, or the lobby or the lead's office. */
  pick(point: { x: number; y: number; z: number }): { kind: 'poster'; room: string; rule: string } | { kind: 'room'; room: string } | { kind: 'floor' } | null;
  dispose(): void;
}

const linear = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

const turn = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z));
const at = (x: number, y: number, z: number, rot?: [number, number, number], s = 1) => new Matrix4().compose(new Vector3(x, y, z), rot ? turn(...rot) : new Quaternion(), new Vector3(s, s, s));

/** A geometry with each triangle drawn from both sides: for v2's open lamp shades in a one-sided material. */
function bothSides(g: BufferGeometry): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  const pos = flat.getAttribute('position');
  const nor = flat.getAttribute('normal');
  const positions = Array.from(pos.array as Float32Array);
  const normals = Array.from(nor.array as Float32Array);
  for (let t = 0; t < pos.count; t += 3) {
    for (const k of [0, 2, 1]) {
      positions.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
      normals.push(-nor.getX(t + k), -nor.getY(t + k), -nor.getZ(t + k));
    }
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  return out;
}

// Shapes shared by every placement: placing a part only moves it.
const SHAPES = {
  box: new BoxGeometry(1, 1, 1),
  shade: bothSides(new ConeGeometry(0.13, 0.16, 7, 1, true)),
  bulb: new SphereGeometry(0.05, 8, 6),
  screen: new PlaneGeometry(0.54, 0.32),
  post: new CylinderGeometry(0.04, 0.04, 0.44, 6),
  pot: new CylinderGeometry(0.2, 0.16, 0.44, 7),
  leaves: new IcosahedronGeometry(0.36, 0),
  sprig: new IcosahedronGeometry(0.24, 0),
};

/** A part whose colour changes with its desk: a laptop's lid, screen or lamp bulb. */
interface Lit {
  desk: string;
  kind: 'lid' | 'screen' | 'bulb';
  hue: string;
  part: Part;
}

/** Builds v2's model of a studio from its floor plan, every part where v2's components put it. */
export function buildStudio(layout: Layout): StudioBuild {
  const solid: Part[] = [];
  const floors: { part: Part; room: string | null; hue: string; colour: string }[] = [];
  const glow: Part[] = [];
  const lit: Lit[] = [];
  const posters: { room: string; rule: string; x: number; z: number }[] = [];

  /** v2's `Box`: a box of a size at a place in a colour, inside a parent transform. */
  const box = (parent: Matrix4, size: [number, number, number], position: [number, number, number], colour: string) => {
    const m = parent.clone().multiply(new Matrix4().compose(new Vector3(...position), new Quaternion(), new Vector3(...size)));
    const part = { geometry: SHAPES.box, matrix: m, tint: linear(colour) };
    solid.push(part);
    return part;
  };
  const shape = (parent: Matrix4, geometry: BufferGeometry, position: [number, number, number], colour: string, rot?: [number, number, number]) => {
    const part = { geometry, matrix: parent.clone().multiply(at(...position, rot)), tint: linear(colour) };
    solid.push(part);
    return part;
  };

  const walls = (r: Rect, door = true) => {
    const t = WALL_THICKNESS;
    const knee = 0.36;
    const frontLeft = (r.w - DOOR_WIDTH) / 2;
    const o = new Matrix4();
    box(o, [r.w, WALL_HEIGHT, t], [r.x + r.w / 2, WALL_HEIGHT / 2, r.z + t / 2], WALL);
    box(o, [r.w, 0.05, t + 0.02], [r.x + r.w / 2, WALL_HEIGHT + 0.025, r.z + t / 2], WALL_TOP);
    box(o, [t, WALL_HEIGHT, r.d], [r.x + t / 2, WALL_HEIGHT / 2, r.z + r.d / 2], WALL);
    box(o, [t + 0.02, 0.05, r.d], [r.x + t / 2, WALL_HEIGHT + 0.025, r.z + r.d / 2], WALL_TOP);
    box(o, [t, knee, r.d], [r.x + r.w - t / 2, knee / 2, r.z + r.d / 2], WALL);
    if (door) {
      box(o, [frontLeft, knee, t], [r.x + frontLeft / 2, knee / 2, r.z + r.d - t / 2], WALL);
      box(o, [frontLeft, knee, t], [r.x + r.w - frontLeft / 2, knee / 2, r.z + r.d - t / 2], WALL);
    } else {
      box(o, [r.w, knee, t], [r.x + r.w / 2, knee / 2, r.z + r.d - t / 2], WALL);
    }
  };

  /** v2's `Desk`: a top on four legs, a laptop and a lamp, the laptop and the lamp lit while its person works. */
  const desk = (key: string, x: number, z: number, hue: string, wide = false) => {
    const w = wide ? LEAD_DESK_WIDTH : DESK_WIDTH;
    const o = at(x, 0, z);
    box(o, [w, 0.08, DESK_DEPTH], [0, 0.74, 0], WOOD);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(o, [0.07, 0.7, 0.07], [sx * (w / 2 - 0.08), 0.36, sz * 0.34], WOOD_DARK);
    box(o, [0.62, 0.035, 0.42], [0, 0.8, -0.05], METAL);
    const lid = { geometry: SHAPES.box, matrix: o.clone().multiply(new Matrix4().compose(new Vector3(0, 0.98, 0.15), turn(0.32, 0, 0), new Vector3(0.62, 0.4, 0.03))), tint: linear(METAL) };
    solid.push(lid);
    lit.push({ desk: key, kind: 'lid', hue, part: lid });
    const screen = { geometry: SHAPES.screen, matrix: o.clone().multiply(at(0, 0.98, 0.13, [0.32, 0, 0])), tint: linear(SCREEN_OFF) };
    glow.push(screen);
    lit.push({ desk: key, kind: 'screen', hue, part: screen });
    const lamp = o.clone().multiply(at(w / 2 - 0.25, 0.78, 0.2));
    box(lamp, [0.18, 0.03, 0.18], [0, 0, 0], METAL);
    box(lamp, [0.03, 0.42, 0.03], [0, 0.22, 0], METAL);
    shape(lamp, SHAPES.shade, [0, 0.45, 0.05], hue, [0.5, 0, 0]);
    const bulb = { geometry: SHAPES.bulb, matrix: lamp.clone().multiply(at(0, 0.42, 0.08)), tint: linear(BULB_OFF) };
    glow.push(bulb);
    lit.push({ desk: key, kind: 'bulb', hue, part: bulb });
  };

  /** v2's `Chair`, behind the desk in the room's colour. */
  const chair = (x: number, z: number, hue: string) => {
    const o = at(x, 0, z);
    box(o, [0.56, 0.09, 0.52], [0, 0.46, 0], hue);
    box(o, [0.56, 0.62, 0.08], [0, 0.8, -0.24], hue);
    shape(o, SHAPES.post, [0, 0.22, 0], METAL);
    box(o, [0.5, 0.04, 0.08], [0, 0.02, 0], METAL);
    box(o, [0.08, 0.04, 0.5], [0, 0.02, 0], METAL);
  };

  const plant = (x: number, z: number, scale = 1) => {
    const o = at(x, 0, z, undefined, scale);
    shape(o, SHAPES.pot, [0, 0.22, 0], POT);
    shape(o, SHAPES.leaves, [0, 0.72, 0], PLANT);
    shape(o, SHAPES.sprig, [0.16, 0.98, 0.05], PLANT_DARK);
  };

  /** v2's `Poster`: a sheet with a band in the room's hue and lines of "text", on the back wall. */
  const poster = (room: string, rule: string, x: number, z: number, hue: string) => {
    const o = at(x, 1.3, z);
    box(o, [0.9, 1.15, 0.03], [0, 0, 0], POSTER);
    box(o, [0.7, 0.16, 0.01], [0, 0.4, 0.02], hue);
    [0.12, -0.04, -0.2, -0.36].forEach((y, i) => box(o, [i === 3 ? 0.4 : 0.66, 0.045, 0.01], [i === 3 ? -0.13 : 0, y, 0.02], POSTER_LINE));
    posters.push({ room, rule, x, z });
  };

  const floor = (r: Rect, colour: string, room: string | null, hue: string) => {
    floors.push({ part: { geometry: SHAPES.box, matrix: new Matrix4().compose(new Vector3(r.x + r.w / 2, 0.03, r.z + r.d / 2), new Quaternion(), new Vector3(r.w, 0.06, r.d)), tint: linear(colour) }, room, hue, colour });
  };

  // The base board, layered like a cut sheet on a plinth.
  const { bounds, lobby, lead } = layout;
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  box(new Matrix4(), [w + 0.5, 0.12, d + 0.5], [cx, -0.17, cz], BASE_EDGE);
  box(new Matrix4(), [w, 0.12, d], [cx, -0.06, cz], BASE_BOARD);

  for (const room of layout.rooms) {
    const hue = DEPARTMENT_HUE[room.style];
    floor(room, floorColor(room.style), room.id, hue);
    walls(room);
    box(new Matrix4(), [room.w - 0.4, 0.06, 0.05], [room.x + room.w / 2, WALL_HEIGHT - 0.25, room.z + 0.2], hue);
    for (const k of room.desks) {
      desk(k.roleId, k.x, k.z, hue);
      const seat = seatOf(k);
      chair(seat.x, seat.z, hue);
    }
    for (const p of room.posters) poster(room.id, p.ruleId, p.x, p.z + 0.12, hue);
    plant(room.x + room.w - 0.6, room.z + 0.6, 0.9);
  }

  // The lobby, where contractors sit, and the way in.
  floor(lobby, LOBBY_FLOOR, null, LOBBY_FLOOR);
  walls(lobby);
  box(new Matrix4(), [1.8, 0.08, 1.1], [lobby.x + lobby.w / 2, 0.05, lobby.z + lobby.d + 0.6], LOBBY_MAT);
  plant(lobby.x + 0.7, lobby.z + lobby.d - 0.7);

  // The lead's office: the main Claude Code session.
  floor(lead, LEAD_FLOOR, null, LEAD_FLOOR);
  walls(lead);
  desk('lead', lead.desk.x, lead.desk.z, LEAD_HUE, true);
  const leadSeat = seatOf(lead.desk);
  chair(leadSeat.x, leadSeat.z, LEAD_HUE);
  plant(lead.x + lead.w - 0.7, lead.z + 0.7, 1.15);

  // Merge: v2's boxes were flat-shaded at roughness 0.85; its floors smooth at 0.95; screens and bulbs glowed.
  const solidMaterial = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  const floorMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const glowMaterial = glowingMaterial();
  const materials: Material[] = [solidMaterial, floorMaterial, glowMaterial];
  const make = (name: string, parts: readonly Part[], material: Material, cast: boolean) => {
    const geometry = mergeParts(parts);
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  };
  const solidMesh = make('studio', solid, solidMaterial, true);
  const floorMesh = make('studio-floors', floors.map((f) => f.part), floorMaterial, false);
  const glowGeometry = mergeParts(glow);
  glowGeometry.setAttribute('emission', new Float32BufferAttribute(new Float32Array(glowGeometry.getAttribute('position').count * 3), 3));
  const glowMesh = new Mesh(glowGeometry, glowMaterial);
  glowMesh.name = 'studio-glow';
  glowMesh.castShadow = false;
  glowMesh.matrixAutoUpdate = false;
  const group = new Group();
  group.name = 'studio';
  group.add(solidMesh, floorMesh, glowMesh);

  // Where each part's vertices start in its mesh, to change their colours in place.
  const startOf = (parts: readonly Part[]) => {
    const out = new Map<Part, { start: number; count: number }>();
    let start = 0;
    for (const p of parts) {
      const count = p.geometry.getAttribute('position').count;
      out.set(p, { start, count });
      start += count;
    }
    return out;
  };
  const solidStarts = startOf(solid);
  const glowStarts = startOf(glow);
  const floorStarts = startOf(floors.map((f) => f.part));

  const paint = (attribute: BufferAttribute, range: { start: number; count: number } | undefined, rgb: readonly number[]) => {
    if (!range) return;
    for (let i = range.start; i < range.start + range.count; i++) attribute.setXYZ(i, rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0);
    attribute.needsUpdate = true;
  };
  const scaled = (hex: string, k: number) => linear(hex).map((c) => c * k);

  // Each desk's lid, screen and bulb, repainted together when its person starts or stops working.
  const byDesk = new Map<string, Lit[]>();
  for (const l of lit) byDesk.set(l.desk, [...(byDesk.get(l.desk) ?? []), l]);
  const deskState = new Map<string, boolean>();
  const setLit = (isLit: (desk: string) => boolean): boolean => {
    let changed = false;
    const solidColour = solidMesh.geometry.getAttribute('color') as BufferAttribute;
    const glowColour = glowMesh.geometry.getAttribute('color') as BufferAttribute;
    const emission = glowMesh.geometry.getAttribute('emission') as BufferAttribute;
    for (const [desk, parts] of byDesk) {
      const on = isLit(desk);
      if (deskState.get(desk) === on) continue;
      deskState.set(desk, on);
      changed = true;
      for (const l of parts) {
        if (l.kind === 'lid') {
          paint(solidColour, solidStarts.get(l.part), linear(on ? tint(l.hue, 0.15) : METAL));
          continue;
        }
        const range = glowStarts.get(l.part);
        const [hex, off, strength] = l.kind === 'screen' ? [SCREEN_ON, SCREEN_OFF, 0.6] : [HIGHLIGHTER, BULB_OFF, 1.6];
        paint(glowColour, range, linear(on ? hex : off));
        paint(emission, range, on ? scaled(hex, strength) : [0, 0, 0]);
      }
    }
    return changed;
  };

  let selected: string | null = null;
  const select = (room: string | null): boolean => {
    if (room === selected) return false;
    const colour = floorMesh.geometry.getAttribute('color') as BufferAttribute;
    for (const f of floors) {
      if (f.room === null || (f.room !== room && f.room !== selected)) continue;
      paint(colour, floorStarts.get(f.part), linear(f.room === room ? tint(f.hue, 0.45) : f.colour));
    }
    selected = room;
    return true;
  };

  const inside = (r: Rect, p: { x: number; z: number }) => p.x >= r.x && p.x <= r.x + r.w && p.z >= r.z && p.z <= r.z + r.d;
  const pick: StudioBuild['pick'] = (p) => {
    const poster = posters.find((q) => Math.abs(p.x - q.x) <= 0.47 && Math.abs(p.y - 1.3) <= 0.6 && Math.abs(p.z - q.z) <= 0.1);
    if (poster) return { kind: 'poster', room: poster.room, rule: poster.rule };
    const room = layout.rooms.find((r) => inside(r, p));
    if (room) return { kind: 'room', room: room.id };
    if (inside(lobby, p) || inside(lead, p)) return { kind: 'floor' };
    return null;
  };

  setLit(() => false);
  return {
    group,
    stats: { meshes: group.children.length, triangles: trianglesOf(solidMesh.geometry) + trianglesOf(floorMesh.geometry) + trianglesOf(glowGeometry) },
    setLit,
    select,
    pick,
    dispose() {
      for (const m of [solidMesh, floorMesh, glowMesh]) m.geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/** Lit by the scene like v2's materials, plus each vertex's own glow: v2's emissive screens and bulbs in one mesh. */
function glowingMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 emission;\nvarying vec3 vEmission;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmission = emission;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmission;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vEmission;');
  };
  material.customProgramCacheKey = () => 'worklings-studio-glow';
  return material;
}
