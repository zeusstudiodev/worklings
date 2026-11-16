// What a company's office draws, worked out from its floor plan (layout.ts) and its theme (src/core/themes.ts): floors,
// walls and their heights, every desk and its set, each room's furniture, the theme's front desk and hero pieces, the
// decor studio.yaml names, windows, light pools and the label anchors. Plain numbers only, so the tests check where
// everything goes without drawing it; build.ts turns a plan into meshes.
//
// Walls: the camera looks from the front right, so only the building's outer back walls and the back-left room's
// left wall stand full height (with wainscot, rail, skirting and the department's stripe); walls with a room behind
// or beside them are low partitions, and the walls on the camera's side are knee height, so nobody walking the halls
// is hidden. The front strip's boards and screen stand on their own legs for the same reason.
import type { BaseDepartment } from '../../../../src/core/departments.ts';
import { MAX_DECOR, type RoomKind, type Theme } from '../../../../src/core/looks.ts';
import { type ArtPack, type Block, type BlockColours, blockColours, furnitureOf, PACK_ATLAS, type Piece, pieceOf, THEME_LOOKS } from '../../../../src/core/themes.ts';
import { type CompanyDesk, type Door, type Layout, type OfficeFloor, type Point, type Rect, WALL_THICKNESS } from '../layout.ts';
import { DEPARTMENT_HUE, hash } from '../palette.ts';
import { tintHex } from './colour.ts';
import { DESK_TOP } from './desk.ts';
import { COUNTER_TOP } from './fronts.ts';
import type { Chart, Light } from './props.ts';
import { TILE, type Tile } from './shape.ts';
import { type Floor, floorOf, HALL_FLOORS, roomTint } from './style.ts';

export const WALL_HEIGHT = { full: 3.0, low: 0.95, knee: 0.48 } as const;
export type WallKind = keyof typeof WALL_HEIGHT;
type Side = Door['side'];

export interface FloorPlan extends Rect {
  floor: Floor;
  /** Multiplies the floor's colours: white, or a department's light tint. */
  tint: string;
  /** Its top: rooms at 0, the hall a little lower. */
  top: number;
  room: string | null;
}

export interface WallPlan extends Rect {
  kind: WallKind;
  side: Side;
  room: string;
  theme: Theme;
  /** A department's hue along a tall wall's inner face. */
  stripe: string | null;
}

/** One thing to draw: a catalogue piece by id, or one of the office's own parts ("window", "poster", "front-lamp"). */
export interface PiecePlan {
  id: string;
  /** Its origin on the floor, and its lowest point's height. */
  x: number;
  y: number;
  z: number;
  /** About +y; 0 faces +z, the camera's side. */
  rot: number;
  /** Over the catalogue's own scale: one number, or x, y and z. */
  scale: number | readonly [number, number, number];
  room: string | null;
  theme: Theme;
  /** The room's colour: a department's hue, or the theme's accent. */
  hue: string;
  seed: number;
  /** A pack piece's colours by atlas block. */
  colours?: BlockColours;
  /** Sizes for the parts made to measure: boards, the screen, tables, windows, the front desk. */
  w?: number;
  h?: number;
  d?: number;
  /** A board's lower edge, when it stands on legs instead of hanging. */
  stand?: number | null;
}

export interface DeskPlan {
  /** The person's id, or "free:<room>:<slot>" for a free desk. */
  key: string;
  person: string | null;
  room: string;
  x: number;
  z: number;
  w: number;
  d: number;
  wide: boolean;
  hue: string;
  seed: number;
  tile: Tile;
  tray: Point;
  /** What stands in the far right corner. */
  corner: 'books' | 'photo-frame' | 'small-cactus' | 'lamp' | null;
}

/** A light pool or halo; one with a desk is lit only while that desk's person works. */
export interface LightPlan extends Light {
  desk: string | null;
  /** The room it lights, so a room building in or going takes its light with it. */
  room: string | null;
  /** For a desk: the screen's halo or the lamp's pool, which dim differently. */
  part?: 'screen' | 'lamp';
}

export interface Anchor {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** The office screen's glowing face, in world units: its middle, lower edge, the plane it lies in, its size. */
export interface ScreenFace {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}

export interface RoomArea extends Rect {
  id: string;
  /** A department's room: a click selects it. */
  department: boolean;
}

export interface OfficePlan {
  theme: Theme;
  base: Rect;
  floors: FloorPlan[];
  walls: WallPlan[];
  pieces: PiecePlan[];
  desks: DeskPlan[];
  lights: LightPlan[];
  anchors: Anchor[];
  screen: ScreenFace | null;
  /** The org drawn on the CEO's board; none when the moments pin it there person by person. */
  chart: Chart | null;
  rooms: RoomArea[];
  /** The packs the pieces come from. */
  packs: ArtPack[];
  /** Decor from studio.yaml the office left out: ids it can't draw, or pieces with no room left. */
  skipped: string[];
}

export interface PlanOptions {
  theme: Theme;
  /** studio.yaml's office.decor, as ids from the catalogue; others are skipped. */
  decor: readonly string[];
  /** Draw the org on the CEO's board from the floor plan (the default); off when the moments pin it there. */
  chart?: boolean;
}

/** Where a room's sign hangs: above its back left corner. */
const signPoint = (r: Rect, height: number): [number, number, number] => [r.x + 0.5, height + 0.45, r.z + 0.3];

/** How far a board or the screen on legs stands out from a low wall, so its feet clear the wall. */
export const STAND_OUT = { board: 0.4, screen: 0.34 } as const;
/** How far a board's face, the front of its sheet, stands out from the board's origin (props.ts). */
const BOARD_FACE = 0.1;

/**
 * Where the moments draw on the boards (moments.ts): the z of the org board's face in the CEO's office and of the
 * milestone board's in the meeting room, hung on a tall back wall or on legs in front of a low one, as `board` puts
 * them. Null for a room the office doesn't have.
 */
export function boardFaces(layout: Layout): { org: number | null; milestone: number | null } {
  const office = layout.office;
  if (!office) return { org: null, milestone: null };
  // Walls don't depend on the theme.
  const areas = areasOf(layout, office, 'office');
  const face = (room: string, z: number) => {
    const area = areas.find((a) => a.id === room);
    return area ? z + (area.walls.back === 'full' ? 0 : STAND_OUT.board) + BOARD_FACE : null;
  };
  return { org: face(office.ceo.id, office.ceo.board.z), milestone: office.meeting ? face(office.meeting.id, office.meeting.board.z) : null };
}

/** Tile per department for what desks' screens show. */
const SCREEN_TILE: Readonly<Record<BaseDepartment, Tile>> = {
  direction: TILE.charts,
  design: TILE.design,
  art: TILE.design,
  engineering: TILE.code,
  data: TILE.charts,
  quality: TILE.tests,
  security: TILE.terminal,
  content: TILE.layout,
  ops: TILE.terminal,
};

/** Pieces that look right from any side, so they may stand where the camera sees their back. */
const ROUND = new Set(['leafy-plant', 'small-plant', 'cactus', 'small-cactus', 'standing-lamp', 'coat-rack', 'water-cooler', 'street-lamp', 'planter', 'crate', 'chalkboard-menu', 'side-table', 'stool', 'cafe-table', 'speaker']);

const t = WALL_THICKNESS;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z;
const square = (p: Point, size: number): Rect => ({ x: p.x - size / 2, z: p.z - size / 2, w: size, d: size });
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, z: r.z - by, w: r.w + by * 2, d: r.d + by * 2 });

interface Area extends Rect {
  id: string;
  kind: 'department' | RoomKind;
  theme: Theme;
  hue: string;
  style: BaseDepartment | null;
  doors: Door[];
  walls: Record<Side, WallKind>;
}

/** The office's rooms with their themes and wall heights: tall only where nothing stands behind or beside. */
function areasOf(layout: Layout, office: OfficeFloor, theme: Theme): Area[] {
  const raw: Omit<Area, 'walls'>[] = [
    ...layout.rooms.map((r) => ({ id: r.id, x: r.x, z: r.z, w: r.w, d: r.d, kind: 'department' as const, theme: r.theme ?? theme, hue: DEPARTMENT_HUE[r.style], style: r.style, doors: r.doors ?? [{ side: 'front' as const, at: r.w / 2, width: 1.7 }] })),
    { ...pick(office.ceo), kind: 'ceo', theme: office.ceo.theme ?? theme, hue: DEPARTMENT_HUE.direction, style: 'direction', doors: office.ceo.doors },
    { ...pick(office.reception), kind: 'reception', theme: office.reception.theme ?? theme, hue: THEME_LOOKS[office.reception.theme ?? theme].accent, style: null, doors: office.reception.doors },
    ...(office.meeting ? [{ ...pick(office.meeting), kind: 'meeting' as const, theme: office.meeting.theme ?? theme, hue: THEME_LOOKS[office.meeting.theme ?? theme].accent, style: null, doors: office.meeting.doors }] : []),
    ...office.rest.map((r) => ({ ...pick(r), kind: r.kind, theme: r.theme ?? theme, hue: THEME_LOOKS[r.theme ?? theme].accent, style: null, doors: r.doors })),
  ];
  return raw.map((a) => {
    const others = raw.filter((o) => o !== a);
    const behind = others.some((o) => o.z + o.d <= a.z + 0.01 && o.x < a.x + a.w && o.x + o.w > a.x);
    const left = others.some((o) => o.x + o.w <= a.x + 0.01 && o.z < a.z + a.d && o.z + o.d > a.z);
    const right = others.some((o) => o.x >= a.x + a.w - 0.01 && o.z < a.z + a.d && o.z + o.d > a.z);
    const back: WallKind = behind ? 'low' : 'full';
    return { ...a, walls: { back, left: !left && back === 'full' ? 'full' : 'low', right: right ? 'low' : 'knee', front: 'knee' } };
  });
}

function pick(r: Rect & { id: string }): Rect & { id: string } {
  return { id: r.id, x: r.x, z: r.z, w: r.w, d: r.d };
}

/**
 * A room's walls as segments with the door gaps cut out: the back and front walls run the full width, the side walls
 * between them, so corners are built once. The same footprint as layout.ts's `wallRects`, which people walk around.
 */
export function wallSegments(r: Rect, doors: readonly Door[]): { rect: Rect; side: Side }[] {
  const out: { rect: Rect; side: Side }[] = [];
  const along = (side: Side, from: number, to: number, piece: (a: number, b: number) => Rect) => {
    const gaps = doors.filter((d) => d.side === side).map((d) => [d.at - d.width / 2, d.at + d.width / 2] as const).sort((a, b) => a[0] - b[0]);
    let at = from;
    for (const [a, b] of gaps) {
      if (a > at) out.push({ rect: piece(at, Math.min(a, to)), side });
      at = Math.max(at, b);
    }
    if (to > at + 1e-6) out.push({ rect: piece(at, to), side });
  };
  along('back', 0, r.w, (a, b) => ({ x: r.x + a, z: r.z, w: b - a, d: t }));
  along('front', 0, r.w, (a, b) => ({ x: r.x + a, z: r.z + r.d - t, w: b - a, d: t }));
  along('left', t, r.d - t, (a, b) => ({ x: r.x, z: r.z + a, w: t, d: b - a }));
  along('right', t, r.d - t, (a, b) => ({ x: r.x + r.w - t, z: r.z + a, w: t, d: b - a }));
  return out.filter((s) => s.rect.w > 0.01 && s.rect.d > 0.01);
}

/** The org drawn on the CEO's board: the CEO, then each department's room with its head and its people. */
export function chartOf(layout: Layout): Chart {
  const office = layout.office;
  const rooms = layout.rooms.map((room) => {
    const people = (office?.desks ?? []).filter((d) => d.room === room.id && d.person !== null);
    const head = people.some((d) => d.slot === 0);
    return { hue: DEPARTMENT_HUE[room.style], head, people: people.length - (head ? 1 : 0) };
  });
  return { top: '#C9B458', rooms };
}

/** Plans a company's office. Layouts without a company floor (v1 and v2 studios) have none: they keep v2's model. */
export function planOffice(layout: Layout, options: PlanOptions): OfficePlan | null {
  const office = layout.office;
  if (!office) return null;
  const theme = options.theme;
  const areas = areasOf(layout, office, theme);
  const byId = new Map(areas.map((a) => [a.id, a]));
  const planner = new Planner(layout, office, theme, areas);

  // The base board and the hall around the rooms.
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const base: Rect = { x: minX - 0.6, z: minZ - 0.6, w: maxX - minX + 1.2, d: maxZ - minZ + 1.2 };
  planner.floors.push({ x: minX - 0.2, z: minZ - 0.2, w: maxX - minX + 0.4, d: maxZ - minZ + 0.4, floor: HALL_FLOORS[theme], tint: '#ffffff', top: -0.02, room: null });

  for (const area of areas) {
    const floor = floorOf(area.theme);
    const tint = area.kind === 'department' || area.kind === 'ceo' ? roomTint(area.hue, floor.colour) : '#ffffff';
    planner.floors.push({ x: area.x, z: area.z, w: area.w, d: area.d, floor, tint, top: 0, room: area.id });
    for (const { rect, side } of wallSegments(area, area.doors)) {
      const kind = area.walls[side];
      const stripe = kind === 'full' && (area.kind === 'department' || area.kind === 'ceo') ? area.hue : null;
      planner.walls.push({ ...rect, kind, side, room: area.id, theme: area.theme, stripe });
    }
  }

  planner.desks(office.desks, byId);
  for (const area of areas) planner.furnish(area);
  planner.windowsAndPosters(areas);
  planner.decorate(options.decor);

  // Signs over each room, the screen's corners and the old names the label layer still uses.
  const anchors: Anchor[] = [];
  for (const area of areas) {
    const [x, y, z] = signPoint(area, WALL_HEIGHT[area.walls.back]);
    anchors.push({ id: `room:${area.id}`, x, y, z });
    if (area.kind === 'reception') anchors.push({ id: 'room:lobby', x, y, z });
    if (area.kind === 'ceo') anchors.push({ id: 'room:lead', x, y, z });
  }
  for (const room of layout.rooms) {
    const area = byId.get(room.id);
    for (const p of room.posters) anchors.push({ id: `poster:${p.ruleId}`, x: p.x, y: area?.walls.back === 'full' ? 0.95 : 0.45, z: p.z + 0.12 });
  }
  const screen = planner.screen;
  if (screen) {
    for (const [id, x, y] of [
      ['top-left', screen.x - screen.w / 2, screen.y + screen.h],
      ['top-right', screen.x + screen.w / 2, screen.y + screen.h],
      ['bottom-right', screen.x + screen.w / 2, screen.y],
      ['bottom-left', screen.x - screen.w / 2, screen.y],
    ] as const) anchors.push({ id: `screen:${id}`, x, y, z: screen.z });
  }

  const packs = [...new Set(planner.pieces.flatMap((p) => {
    const piece = pieceOf(p.id);
    return piece?.draw.from === 'pack' ? [piece.draw.pack] : [];
  }))].sort();
  return {
    theme,
    base,
    floors: planner.floors,
    walls: planner.walls,
    pieces: planner.pieces,
    desks: planner.deskPlans,
    lights: planner.lights,
    anchors,
    screen,
    chart: options.chart === false ? null : chartOf(layout),
    rooms: areas.map((a) => ({ id: a.id, x: a.x, z: a.z, w: a.w, d: a.d, department: a.kind === 'department' })),
    packs,
    skipped: planner.skipped,
  };
}

/** A stretch of a tall wall still free for something hung on it. */
interface WallSpan {
  area: Area;
  side: 'back' | 'left';
  /** Along the wall: x for a back wall, z for a left wall. */
  from: number;
  to: number;
  /** The wall's inner face. */
  face: number;
  taken: [number, number][];
}

class Planner {
  readonly floors: FloorPlan[] = [];
  readonly walls: WallPlan[] = [];
  readonly pieces: PiecePlan[] = [];
  readonly deskPlans: DeskPlan[] = [];
  readonly lights: LightPlan[] = [];
  readonly skipped: string[] = [];
  screen: ScreenFace | null = null;
  /** What stands on each room's floor, so nothing new is put in the way. */
  private readonly obstacles = new Map<string, Rect[]>();
  /** Tops of things a small piece can stand on. */
  private readonly surfaces: { room: string; x: number; y: number; z: number; w: number; d: number; used: boolean }[] = [];
  private readonly spans: WallSpan[] = [];
  /** Boards hung on a tall back wall while furnishing, so the windows keep off them. */
  private readonly hung: { room: string; x: number; w: number }[] = [];
  /** How many decor pieces each room got, so decor spreads out. */
  private readonly decorCount = new Map<string, number>();
  private readonly layout: Layout;
  private readonly office: OfficeFloor;
  private readonly theme: Theme;
  private readonly areas: Area[];

  constructor(layout: Layout, office: OfficeFloor, theme: Theme, areas: Area[]) {
    this.layout = layout;
    this.office = office;
    this.theme = theme;
    this.areas = areas;
    for (const area of areas) this.obstacles.set(area.id, this.reserved(area));
  }

  /** What people need clear in a room: desks and chairs, the floor plan's furniture, seats, places to stand, doorways. */
  private reserved(area: Area): Rect[] {
    const office = this.office;
    const out: Rect[] = [];
    const desks = office.desks.filter((d) => d.x >= area.x && d.x <= area.x + area.w && d.z >= area.z && d.z <= area.z + area.d);
    for (const d of desks) {
      // The desk, its chair and the aisles round them: people walk these, and the router knows nothing of decor.
      out.push({ x: d.x - d.w / 2 - 0.65, z: d.seat.z - 1.05, w: d.w + 1.3, d: d.z + d.d / 2 - d.seat.z + 1.25 });
      out.push(square(d.visitor, 0.8), square(d.behind, 0.8));
    }
    if (desks.length > 0) {
      // The walkway in front of the desks, from the door along the front wall.
      const front = Math.max(...desks.map((d) => d.z + d.d / 2));
      const x0 = Math.min(...desks.map((d) => d.x - d.w / 2)) - 0.65;
      const x1 = Math.max(...desks.map((d) => d.x + d.w / 2)) + 0.65;
      out.push({ x: x0, z: front, w: x1 - x0, d: area.z + area.d - front });
    }
    const room = [office.ceo, office.reception, ...(office.meeting ? [office.meeting] : []), ...office.rest].find((r) => r.id === area.id);
    if (room) {
      for (const b of room.blocks) out.push(grow(b, 0.3));
      for (const s of room.seats) out.push(square(s, 1.0));
    }
    if (area.kind === 'reception') for (const p of office.reception.frontDesk.places) out.push(square(p, 1.0));
    if (area.kind === 'ceo') out.push(square(office.ceo.boardSpot, 1.2));
    if (area.kind === 'meeting' && office.meeting) for (const p of [office.meeting.head, ...office.meeting.spots]) out.push(square(p, 0.9));
    for (const door of area.doors) out.push(this.doorway(area, door));
    return out;
  }

  /** The floor in front of a door that stays clear, on both sides of the wall. */
  private doorway(area: Rect, door: Door): Rect {
    const deep = 1.7;
    const half = door.width / 2 + 0.35;
    if (door.side === 'back') return { x: area.x + door.at - half, z: area.z - deep, w: half * 2, d: deep * 2 };
    if (door.side === 'front') return { x: area.x + door.at - half, z: area.z + area.d - deep, w: half * 2, d: deep * 2 };
    if (door.side === 'left') return { x: area.x - deep, z: area.z + door.at - half, w: deep * 2, d: half * 2 };
    return { x: area.x + area.w - deep, z: area.z + door.at - half, w: deep * 2, d: half * 2 };
  }

  private block(room: string, r: Rect) {
    this.obstacles.get(room)?.push(r);
  }

  private add(p: Omit<PiecePlan, 'theme' | 'hue' | 'seed' | 'scale' | 'rot' | 'y'> & Partial<Pick<PiecePlan, 'theme' | 'hue' | 'seed' | 'scale' | 'rot' | 'y'>>, area: Area | null): PiecePlan {
    const theme = p.theme ?? area?.theme ?? this.theme;
    const piece: PiecePlan = {
      rot: 0,
      y: 0,
      scale: 1,
      seed: hash(`${p.id}:${p.x.toFixed(2)}:${p.z.toFixed(2)}`) % 997,
      ...p,
      theme,
      hue: p.hue ?? area?.hue ?? THEME_LOOKS[theme].accent,
    };
    const catalogue = pieceOf(p.id);
    if (catalogue?.draw.from === 'pack' && !piece.colours) piece.colours = this.coloursFor(catalogue, theme, area);
    this.pieces.push(piece);
    return piece;
  }

  /** A pack piece's colours in a room: the theme's swap, and upholstery and rugs in the department's hue. */
  private coloursFor(piece: Piece, theme: Theme, area: Area | null): BlockColours {
    const colours: Partial<Record<Block, string>> = { ...restaurantCalm(theme, piece.id), ...blockColours(theme, piece.id) };
    if (piece.draw.from !== 'pack' || !area || (area.kind !== 'department' && area.kind !== 'ceo')) return colours;
    const rug = piece.id.includes('rug');
    for (const block of PACK_ATLAS[piece.draw.pack].fabric) colours[block] = tintHex(area.hue, rug ? 0.45 : block === 'r1c0' ? 0.12 : 0.3);
    return colours;
  }

  /** A footprint, turned: width and depth swap a quarter turn round. */
  private static turned(p: Piece, rot: number): [number, number] {
    const [w, d] = p.footprint;
    return Math.abs(Math.sin(rot)) > 0.7 ? [d, w] : [w, d];
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Desks

  desks(desks: readonly CompanyDesk[], areas: ReadonlyMap<string, Area>) {
    const ceo = this.office.ceo;
    for (const d of desks) {
      const area = areas.get(d.room) ?? (d.x >= ceo.x && d.x <= ceo.x + ceo.w && d.z >= ceo.z && d.z <= ceo.z + ceo.d ? areas.get(ceo.id) : undefined);
      const style = area?.style ?? 'direction';
      const key = d.person ?? `free:${d.room}:${d.slot}`;
      const seed = hash(key);
      const roll = seed % 12;
      const corner = d.wide ? 'lamp' : roll < 3 ? 'books' : roll < 5 ? 'photo-frame' : roll < 7 ? 'small-cactus' : roll < 9 ? 'lamp' : null;
      this.deskPlans.push({
        key,
        person: d.person,
        room: area?.id ?? d.room,
        x: d.x,
        z: d.z,
        w: d.w,
        d: d.d,
        wide: d.wide,
        hue: DEPARTMENT_HUE[style],
        seed,
        tile: SCREEN_TILE[style],
        tray: d.tray,
        corner,
      });
      // Light that says someone works here: the screen's glow behind the monitor and on the desk top; a lamp's pool.
      const room = area?.id ?? d.room;
      this.lights.push({ x: d.x, y: DESK_TOP + 0.52, z: d.z + 0.2, sx: 2.1, sz: 1.45, colour: '#8FE3F5', strength: 0.5, halo: true, desk: key, part: 'screen', room });
      this.lights.push({ x: d.x - 0.05, y: DESK_TOP + 0.012, z: d.z, sx: 2.3, sz: 1.5, colour: '#7FD8F0', strength: 0.13, desk: key, part: 'screen', room });
      if (corner === 'lamp') this.lights.push({ x: d.x + d.w / 2 - 0.3, y: DESK_TOP + 0.014, z: d.z + 0.1, sx: 1.4, sz: 1.4, colour: '#FFB25C', strength: 0.14, desk: key, part: 'lamp', room });
    }
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Rooms

  furnish(area: Area) {
    // What the catalogue furnishes this kind of room with; the spots below take their pieces from it, and whatever
    // they leave goes wherever it fits.
    const wanted = area.kind === 'department' ? [] : furnitureOf(area.kind, area.theme).flatMap(({ piece, count }) => Array.from({ length: count }, () => piece));
    const take = (id: string): boolean => {
      const i = wanted.indexOf(id);
      if (i < 0) return false;
      wanted.splice(i, 1);
      return true;
    };
    if (area.kind === 'department') this.department(area);
    else if (area.kind === 'ceo') this.ceoOffice(area, take);
    else if (area.kind === 'reception') this.reception(area, take);
    else if (area.kind === 'meeting') this.meetingRoom(area, take);
    else this.restRoom(area, take);
    this.loose(area, wanted);
  }

  /** A rug in the room's hue under its desks, and a plant in a back corner. */
  private department(area: Area) {
    const desks = this.office.desks.filter((d) => d.room === area.id);
    if (desks.length > 0) this.rugUnder(area, desks, 'rug');
    this.loose(area, ['leafy-plant']);
  }

  private rugUnder(area: Area, desks: readonly CompanyDesk[], id: string) {
    const x0 = Math.min(...desks.map((d) => d.x - d.w / 2)) - 0.45;
    const x1 = Math.max(...desks.map((d) => d.x + d.w / 2)) + 0.45;
    const z0 = Math.min(...desks.map((d) => d.seat.z - 0.6));
    const z1 = Math.max(...desks.map((d) => d.z + d.d / 2)) + 0.35;
    this.rug(area, id, { x: x0, z: z0, w: x1 - x0, d: z1 - z0 });
  }

  /** A rug stretched over a rect of the floor, kept inside the room's walls. */
  private rug(area: Area, id: string, want: Rect) {
    const piece = pieceOf(id);
    if (!piece) return;
    const inset = t + 0.12;
    const x0 = Math.max(want.x, area.x + inset);
    const x1 = Math.min(want.x + want.w, area.x + area.w - inset);
    const z0 = Math.max(want.z, area.z + inset);
    const z1 = Math.min(want.z + want.d, area.z + area.d - inset);
    if (x1 - x0 < 0.5 || z1 - z0 < 0.5) return;
    const [fw, fd] = piece.footprint;
    this.add({ id, x: (x0 + x1) / 2, z: (z0 + z1) / 2, scale: [(x1 - x0) / fw, 0.5, (z1 - z0) / fd], room: area.id }, area);
  }

  /** A board on the back wall: hung on a tall wall, on its own legs in front of a low one. Returns its back's z. */
  private board(area: Area, id: string, at: { x: number; z: number; w: number; y: number; h: number }, out: number): number {
    const wall = area.walls.back === 'full';
    const z = at.z + (wall ? 0 : out);
    this.add({ id, x: at.x, z, y: wall ? at.y : 0, w: at.w, h: at.h, stand: wall ? null : at.y, room: area.id }, area);
    if (wall) this.hung.push({ room: area.id, x: at.x, w: at.w });
    this.block(area.id, { x: at.x - at.w / 2 - 0.1, z: area.z, w: at.w + 0.2, d: z - area.z + 0.5 });
    return z;
  }

  /** The CEO's corner: the org board, a rug under the desk, a visitor's chair, the armchair and lamp, a bookcase. */
  private ceoOffice(area: Area, take: (id: string) => boolean) {
    const ceo = this.office.ceo;
    // The desk set is drawn with the desk.
    for (const id of ['lead-desk', 'desk-chair', 'monitor', 'keyboard']) take(id);
    if (take('org-board')) this.board(area, 'org-board', ceo.board, STAND_OUT.board);
    const desk = ceo.desk;
    if (take('striped-rug')) this.rug(area, 'striped-rug', { x: desk.x - 1.73, z: desk.z - 1.5, w: 3.45, d: 2.4 });
    if (take('visitor-chair')) {
      this.add({ id: 'visitor-chair', x: desk.x, z: desk.z + desk.d / 2 + 0.55, rot: Math.PI, room: area.id }, area);
      this.block(area.id, { x: desk.x - 0.5, z: desk.z + desk.d / 2, w: 1.0, d: 1.2 });
    }
    const others = this.office.desks.filter((d) => d !== desk && d.x >= area.x && d.x <= area.x + area.w && d.z >= area.z && d.z <= area.z + area.d);
    if (others.length > 0) this.rugUnder(area, others, 'rug');
    // The armchair corner by the right wall with its lamp, and the bookcase further back.
    const right = area.x + area.w - t;
    if (take('armchair')) this.place(area, 'armchair', { x: right - 1.0, z: area.z + area.d - t - 1.45, rot: -Math.PI / 2 });
    if (take('standing-lamp')) this.place(area, 'standing-lamp', { x: right - 0.55, z: area.z + area.d - t - 2.75, rot: 0 });
    if (take('bookcase')) this.place(area, 'bookcase', { x: right - 0.55, z: area.z + t + 2.4, rot: -Math.PI / 2 });
    this.loose(area, ['leafy-plant']);
  }

  /** Reception: the theme's front desk on the floor plan's counter, its lamp, the visitors' sofa and chairs. */
  private reception(area: Area, take: (id: string) => boolean) {
    const reception = this.office.reception;
    const look = THEME_LOOKS[area.theme];
    const { counter, lamp, places } = reception.frontDesk;
    take(look.frontDesk);
    this.add({ id: look.frontDesk, x: counter.x + counter.w / 2, z: counter.z + counter.d / 2, w: counter.w, d: counter.d, room: area.id }, area);
    this.add({ id: 'front-lamp', x: lamp.x, z: lamp.z, y: COUNTER_TOP, room: area.id }, area);
    // The lamp that stays on at night: warm light over the people waiting, and on the counter.
    const first = places[0] ?? { x: counter.x + counter.w / 2, z: counter.z - 0.75 };
    this.lights.push({ x: first.x, y: 0.02, z: first.z - 0.4, sx: counter.w + 1.2, sz: 3.2, colour: '#FFC07A', strength: 0.12, desk: null, room: area.id, stays: true });
    this.lights.push({ x: lamp.x, y: COUNTER_TOP + 0.55, z: lamp.z, sx: 1.0, sz: 1.0, colour: '#FFCF7A', strength: 0.3, halo: true, desk: null, room: area.id, stays: true });
    this.seating(area, reception.seats, take);
  }

  /** Visitors' seats in rows of three: a sofa across the first, chairs and a side table on the next, a rug under them. */
  private seating(area: Area, seats: readonly (Point & { facing: number })[], take: (id: string) => boolean) {
    if (seats.length === 0) return;
    const xs = seats.map((s) => s.x);
    const zs = seats.map((s) => s.z);
    if (take('rug')) this.rug(area, 'rug', { x: Math.min(...xs) - 1.1, z: Math.min(...zs) - 1.0, w: Math.max(...xs) - Math.min(...xs) + 2.2, d: Math.max(...zs) - Math.min(...zs) + 2.0 });
    const row = seats.slice(0, 3);
    const middle = row[1];
    if (row.length === 3 && middle && Math.abs((row[0]?.z ?? 0) - (row[2]?.z ?? 0)) < 0.01 && take('sofa')) {
      this.add({ id: 'sofa', x: middle.x, z: middle.z, rot: middle.facing, room: area.id }, area);
    } else {
      for (const s of row) this.add({ id: take('visitor-chair') ? 'visitor-chair' : 'chair', x: s.x, z: s.z, rot: s.facing, room: area.id }, area);
    }
    seats.slice(3).forEach((s, i) => {
      if (i === 1 && seats.length === 6 && take('side-table')) this.add({ id: 'side-table', x: s.x, z: s.z, scale: 0.6, room: area.id }, area);
      else this.add({ id: take('visitor-chair') ? 'visitor-chair' : 'chair', x: s.x, z: s.z, rot: s.facing, room: area.id }, area);
    });
  }

  /** The meeting room: the long table and its chairs, the milestone board and the screen on the back wall. */
  private meetingRoom(area: Area, take: (id: string) => boolean) {
    const meeting = this.office.meeting;
    if (!meeting) return;
    const { table, board, screen } = meeting;
    const tx = table.x + table.w / 2;
    // The catalogue's long table, made to the floor plan's size.
    take('long-table');
    this.add({ id: 'meeting-table', x: tx, z: table.z + table.d / 2, w: table.w, d: table.d, room: area.id }, area);
    for (const dx of [-1.4, 0, 1.4]) {
      take('chair');
      take('chair');
      this.add({ id: 'chair', x: tx + dx, z: table.z - 0.32, rot: 0, room: area.id }, area);
      this.add({ id: 'chair', x: tx + dx, z: table.z + table.d + 0.32, rot: Math.PI, room: area.id }, area);
    }
    take('milestone-board');
    this.board(area, 'milestone-board', board, STAND_OUT.board);
    take('meeting-screen');
    const z = this.board(area, 'meeting-screen', screen, STAND_OUT.screen);
    // The screen's glowing face (props.ts: the glass sits 0.104 out, inset 0.06 all round).
    this.screen = { x: screen.x, y: screen.y + 0.06, z: z + 0.104, w: screen.w - 0.12, h: screen.h - 0.12 };
    this.lights.push({ x: screen.x, y: 0.02, z: z + 1.6, sx: screen.w + 1.4, sz: 2.6, colour: '#CFEFFF', strength: 0.08, desk: null, room: area.id });
  }

  /** Lounges, kitchens and games rooms, furnished round the floor plan's seats and blocks. */
  private restRoom(area: Area, take: (id: string) => boolean) {
    const room = this.office.rest.find((r) => r.id === area.id);
    if (!room) return;
    const [first, second] = room.blocks;
    if (area.kind === 'kitchen') {
      if (second) {
        // Counters along the back wall, squeezed to the floor plan's depth: fridge, counter, sink, counter, as many as
        // the run holds; what doesn't fit finds room elsewhere.
        const row: string[] = [];
        let width = 0;
        for (const id of ['fridge', 'kitchen-counter', 'kitchen-sink', 'kitchen-counter']) {
          const w = pieceOf(id)?.footprint[0] ?? 1.5;
          if (width + w > second.w + 0.2) continue;
          if (!take(id)) continue;
          row.push(id);
          width += w;
        }
        const widths = row.map((id) => pieceOf(id)?.footprint[0] ?? 1.5);
        let x = second.x + second.w / 2 - widths.reduce((s, w) => s + w, 0) / 2;
        row.forEach((id, i) => {
          const w = widths[i] ?? 1.5;
          const depth = pieceOf(id)?.footprint[1] ?? 1.6;
          const squash = Math.min(1, (second.d + 0.15) / depth);
          const placed = this.add({ id, x: x + w / 2, z: area.z + t + (depth * squash) / 2, scale: [1, 1, squash], room: area.id }, area);
          if (id === 'kitchen-counter') this.surfaces.push({ room: area.id, x: placed.x, y: 0.78, z: placed.z, w: w - 0.2, d: depth * squash - 0.2, used: false });
          x += w;
        });
      }
      if (first && take('cafe-table')) this.add({ id: 'cafe-table', x: first.x + first.w / 2, z: first.z + first.d / 2, room: area.id }, area);
      // A chair for every seat the floor plan has.
      for (const s of room.seats) {
        take('cafe-chair');
        this.add({ id: 'cafe-chair', x: s.x, z: s.z, rot: s.facing, room: area.id }, area);
      }
      return;
    }
    if (area.kind === 'games') {
      if (first) {
        const mid = first.x + first.w / 2;
        if (take('big-screen')) this.add({ id: 'big-screen', x: mid, z: area.z + t + 0.38, room: area.id }, area);
        for (const x of [first.x + 0.5, first.x + first.w - 0.5]) if (take('arcade-cabinet')) this.add({ id: 'arcade-cabinet', x, z: area.z + t + 0.55, room: area.id }, area);
      }
      const facing = room.seats.filter((s) => Math.abs(s.facing - Math.PI) < 0.01);
      const middle = facing[Math.floor(facing.length / 2)];
      if (facing.length >= 3 && middle && take('sofa')) this.add({ id: 'sofa', x: middle.x, z: middle.z, rot: Math.PI, room: area.id }, area);
      else for (const s of facing) this.add({ id: 'stool', x: s.x, z: s.z, rot: s.facing, room: area.id }, area);
      for (const s of room.seats.filter((x) => !facing.includes(x))) this.add({ id: 'stool', x: s.x, z: s.z, rot: s.facing, room: area.id }, area);
      const xs = facing.map((s) => s.x);
      if (xs.length && take('rug')) this.rug(area, 'rug', { x: (Math.min(...xs) + Math.max(...xs)) / 2 - 1.73, z: (middle?.z ?? area.z + 4) - 2.4, w: 3.45, d: 2.8 });
      return;
    }
    // A lounge: the sofa on its seats against the back wall, armchairs facing in, a low table and a rug.
    const sofaSeats = room.seats.filter((s) => Math.abs(s.facing) < 0.01);
    const middle = sofaSeats[Math.floor(sofaSeats.length / 2)];
    const onSofa = sofaSeats.length >= 3 && middle !== undefined && take('sofa');
    if (onSofa && middle) this.add({ id: 'sofa', x: middle.x, z: middle.z, room: area.id }, area);
    for (const s of room.seats.filter((x) => !onSofa || !sofaSeats.includes(x))) {
      take('armchair');
      this.add({ id: 'armchair', x: s.x, z: s.z, rot: s.facing, room: area.id }, area);
    }
    if (second && take('coffee-table')) {
      const placed = this.add({ id: 'coffee-table', x: second.x + second.w / 2, z: second.z + second.d / 2, scale: 0.6, room: area.id }, area);
      this.surfaces.push({ room: area.id, x: placed.x, y: 0.3, z: placed.z, w: 1.0, d: 0.6, used: false });
    }
    const xs = room.seats.map((s) => s.x);
    const zs = room.seats.map((s) => s.z);
    if (xs.length && take('oval-rug')) this.rug(area, 'oval-rug', { x: (Math.min(...xs) + Math.max(...xs)) / 2 - 2.4, z: (Math.min(...zs) + Math.max(...zs)) / 2 - 0.9, w: 4.8, d: 3.0 });
  }

  /** Puts a catalogue piece at a set spot if the floor there is free, else lets `loose` find it a place. */
  private place(area: Area, id: string, at: { x: number; z: number; rot: number }) {
    const piece = pieceOf(id);
    if (!piece) return;
    const [w, d] = Planner.turned(piece, at.rot);
    const rect = { x: at.x - w / 2, z: at.z - d / 2, w, d };
    if ((this.obstacles.get(area.id) ?? []).some((o) => overlaps(o, rect))) {
      this.loose(area, [id]);
      return;
    }
    this.add({ id, x: at.x, z: at.z, rot: at.rot, room: area.id }, area);
    this.block(area.id, rect);
  }

  /** Furniture that goes wherever it fits: along a wall, clear of desks, seats, doorways and everything placed. */
  private loose(area: Area, ids: readonly string[]) {
    for (const id of ids) this.fit(area, id);
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Finding room

  /** Places a catalogue piece in a room if one fits; returns whether it did. */
  private fit(area: Area, id: string): boolean {
    const piece = pieceOf(id);
    if (!piece) return false;
    if (piece.place === 'wall') return this.hang(area, piece);
    if (piece.place === 'surface') return this.onSurface(area, piece);
    const round = ROUND.has(id);
    // Along the back wall facing the camera, then the left wall facing right, then (things that look right from
    // any side) the front and right walls.
    const options: { side: Side; rot: number }[] = [
      { side: 'back', rot: 0 },
      { side: 'left', rot: Math.PI / 2 },
      ...(round ? [{ side: 'front' as const, rot: 0 }, { side: 'right' as const, rot: -Math.PI / 2 }] : [{ side: 'front' as const, rot: 0 }]),
    ];
    for (const { side, rot } of options) {
      const spot = this.alongWall(area, side, Planner.turned(piece, rot));
      if (!spot) continue;
      const [w, d] = Planner.turned(piece, rot);
      this.add({ id, x: spot.x, z: spot.z, rot, room: area.id }, area);
      this.block(area.id, { x: spot.x - w / 2 - 0.1, z: spot.z - d / 2 - 0.1, w: w + 0.2, d: d + 0.2 });
      return true;
    }
    return false;
  }

  /** The first free spot against one wall of a room for a footprint, scanning from the wall's left or back end. */
  private alongWall(area: Area, side: Side, [w, d]: [number, number]): Point | null {
    const gap = 0.06;
    const inside = { x: area.x + t, z: area.z + t, w: area.w - t * 2, d: area.d - t * 2 };
    const obstacles = this.obstacles.get(area.id) ?? [];
    const horizontal = side === 'back' || side === 'front';
    const length = horizontal ? inside.w : inside.d;
    const size = horizontal ? w : d;
    for (let along = 0.1; along + size <= length - 0.1 + 1e-6; along += 0.1) {
      const rect: Rect = side === 'back'
        ? { x: inside.x + along, z: inside.z + gap, w, d }
        : side === 'front'
          ? { x: inside.x + along, z: inside.z + inside.d - gap - d, w, d }
          : side === 'left'
            ? { x: inside.x + gap, z: inside.z + along, w, d }
            : { x: inside.x + inside.w - gap - w, z: inside.z + along, w, d };
      if (rect.z < inside.z || rect.z + rect.d > inside.z + inside.d || rect.x < inside.x || rect.x + rect.w > inside.x + inside.w) continue;
      if (obstacles.some((o) => overlaps(o, rect))) continue;
      return { x: rect.x + rect.w / 2, z: rect.z + rect.d / 2 };
    }
    return null;
  }

  /** Hangs a wall piece on a tall wall of the room, where windows, posters and other pictures leave room. */
  private hang(area: Area, piece: Piece): boolean {
    const width = piece.footprint[0];
    for (const span of this.spans.filter((s) => s.area.id === area.id)) {
      const at = freeAlong(span, width + 0.3);
      if (at === null) continue;
      span.taken.push([at - width / 2 - 0.15, at + width / 2 + 0.15]);
      const y = piece.id.includes('picture') ? 1.45 : piece.id.includes('shelf') ? 1.75 : piece.id === 'neon-sign' ? 1.55 : 1.0;
      if (span.side === 'back') this.add({ id: piece.id, x: at, z: span.face + 0.01, y, room: area.id }, area);
      else this.add({ id: piece.id, x: span.face + 0.01, z: at, y, rot: Math.PI / 2, room: area.id }, area);
      return true;
    }
    return false;
  }

  /** Stands a small piece on a free table, counter or cabinet top in the room. */
  private onSurface(area: Area, piece: Piece): boolean {
    const top = this.surfaces.find((s) => s.room === area.id && !s.used && s.w >= piece.footprint[0] && s.d >= piece.footprint[1]);
    if (!top) return false;
    top.used = true;
    this.add({ id: piece.id, x: top.x, z: top.z, y: top.y, room: area.id }, area);
    return true;
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Tall walls: windows of sky, the rules' posters, and room for pictures

  windowsAndPosters(areas: readonly Area[]) {
    for (const area of areas) {
      for (const side of ['back', 'left'] as const) {
        if (area.walls[side] !== 'full') continue;
        const segments = wallSegments(area, area.doors).filter((s) => s.side === side);
        for (const { rect } of segments) {
          const span: WallSpan = side === 'back'
            ? { area, side, from: rect.x + (rect.x <= area.x + 0.01 ? t : 0), to: rect.x + rect.w - (rect.x + rect.w >= area.x + area.w - 0.01 ? t : 0), face: rect.z + rect.d, taken: [] }
            : { area, side, from: rect.z, to: rect.z + rect.d, face: rect.x + rect.w, taken: [] };
          this.spans.push(span);
        }
      }
      // The rules' posters (v2) at the places the floor plan gives, on a tall back wall.
      const room = this.layout.rooms.find((r) => r.id === area.id);
      if (room && area.walls.back === 'full') {
        const face = area.z + t;
        for (const p of room.posters) {
          const span = this.spans.find((s) => s.area.id === area.id && s.side === 'back' && p.x >= s.from && p.x <= s.to);
          span?.taken.push([p.x - 0.55, p.x + 0.55]);
          this.add({ id: 'poster', x: p.x, z: face + 0.01, y: 1.1, room: area.id }, area);
        }
      }
      // The boards were hung while furnishing, before the spans existed: a window behind one shows through its chart.
      for (const b of this.hung.filter((h) => h.room === area.id)) {
        const span = this.spans.find((s) => s.area.id === area.id && s.side === 'back' && b.x >= s.from && b.x <= s.to);
        span?.taken.push([b.x - b.w / 2 - 0.15, b.x + b.w / 2 + 0.15]);
      }
    }
    // A window on every tall wall long enough, two on long ones, with a patch of daylight on the floor.
    for (const span of this.spans) {
      const length = span.to - span.from;
      const count = length >= 9 ? 2 : length >= 3.2 ? 1 : 0;
      for (let i = 0; i < count; i++) {
        const want = span.from + (length * (i + 1)) / (count + 1);
        const at = freeAlong(span, 2.5, want);
        if (at === null) continue;
        span.taken.push([at - 1.25, at + 1.25]);
        const w = 2.0;
        if (span.side === 'back') {
          this.add({ id: 'window', x: at, z: span.face + 0.04, y: 1.0, w, h: 1.5, room: span.area.id }, span.area);
          this.lights.push({ x: at, y: 0.03, z: span.face + 1.9, sx: w * 1.6, sz: 3.0, colour: '#FFE9C4', strength: 0.1, desk: null, room: span.area.id });
        } else {
          this.add({ id: 'window', x: span.face + 0.04, z: at, y: 1.0, rot: Math.PI / 2, w, h: 1.5, room: span.area.id }, span.area);
          this.lights.push({ x: span.face + 1.9, y: 0.03, z: at, sx: 3.0, sz: w * 1.6, colour: '#FFE9C4', strength: 0.1, desk: null, room: span.area.id });
        }
      }
    }
  }

  // -----------------------------------------------------------------------------------------------------------------
  // The theme's hero pieces and studio.yaml's decor

  /**
   * The theme's hero pieces go to reception first, nearest its door; then studio.yaml's decor, each piece to the room
   * with the least decor so far where it fits. A decor id that names a hero already standing is that hero. Ids the
   * catalogue doesn't have are skipped, as are pieces nothing has room for.
   */
  decorate(decor: readonly string[]) {
    const reception = this.areas.find((a) => a.kind === 'reception');
    const heroes = [...(reception ? THEME_LOOKS[reception.theme].hero : [])];
    const standing = new Map<string, number>();
    if (reception) {
      for (const id of heroes) {
        if (this.fitNearDoor(reception, id) || this.fitAnywhere(id)) standing.set(id, (standing.get(id) ?? 0) + 1);
      }
    }
    for (const id of decor.slice(0, MAX_DECOR)) {
      const left = standing.get(id) ?? 0;
      if (left > 0) {
        standing.set(id, left - 1);
        continue;
      }
      if (!pieceOf(id) || !this.fitAnywhere(id)) this.skipped.push(id);
    }
  }

  /** In reception, along the front wall nearest its front door, for the hero piece people see coming in. */
  private fitNearDoor(area: Area, id: string): boolean {
    const piece = pieceOf(id);
    if (!piece || piece.place !== 'floor') return this.fitAnywhere(id);
    const door = area.doors.find((d) => d.side === 'front');
    if (!door) return this.fit(area, id);
    const [w, d] = piece.footprint;
    const obstacles = this.obstacles.get(area.id) ?? [];
    const doorX = area.x + door.at;
    const z = area.z + area.d - t - 0.06 - d / 2;
    // Outward from the door, left first: that side faces the camera across the room.
    for (let off = door.width / 2 + 0.45; off < area.w; off += 0.1) {
      for (const dir of [-1, 1]) {
        const x = doorX + dir * (off + w / 2);
        const rect = { x: x - w / 2, z: z - d / 2, w, d };
        if (rect.x < area.x + t + 0.05 || rect.x + rect.w > area.x + area.w - t - 0.05) continue;
        if (obstacles.some((o) => overlaps(o, rect))) continue;
        this.add({ id, x, z, rot: 0, room: area.id }, area);
        this.block(area.id, grow(rect, 0.1));
        this.decorCount.set(area.id, (this.decorCount.get(area.id) ?? 0) + 1);
        return true;
      }
    }
    return this.fit(area, id);
  }

  private fitAnywhere(id: string): boolean {
    const order = [...this.areas].sort((a, b) => (this.decorCount.get(a.id) ?? 0) - (this.decorCount.get(b.id) ?? 0) || rank(a) - rank(b));
    for (const area of order) {
      if (this.fit(area, id)) {
        this.decorCount.set(area.id, (this.decorCount.get(area.id) ?? 0) + 1);
        return true;
      }
    }
    return false;
  }
}

/**
 * Restaurant Bits' loud teal and orange calmed in any theme the catalogue gives no colours for, as it does for the
 * office and the café: counters and chairs in the theme's accent, the fridge cream, a café table pale. The catalogue's
 * own colours, where it has them, win.
 */
function restaurantCalm(theme: Theme, id: string): BlockColours {
  const piece = pieceOf(id);
  if (piece?.draw.from !== 'pack' || piece.draw.pack !== 'restaurant-bits') return {};
  const { accent, wall } = THEME_LOOKS[theme];
  if (id === 'cafe-table') return { r3c6: tintHex(wall, 0.3) };
  if (id === 'cafe-chair') return { r3c6: '#B98A5E' };
  return { r3c6: accent, r1c2: '#F1EADC' };
}

/** Rooms decor goes to first when they have the same amount: places to rest and meet, then the departments. */
const RANK: Readonly<Record<Area['kind'], number>> = { reception: 0, lounge: 1, kitchen: 1, games: 1, meeting: 2, ceo: 3, department: 4 };
const rank = (a: Area) => RANK[a.kind];

/** Where along a wall span something `width` wide fits, nearest `want` (the span's middle by default). */
function freeAlong(span: WallSpan, width: number, want?: number): number | null {
  const lo = span.from + width / 2 + 0.1;
  const hi = span.to - width / 2 - 0.1;
  if (hi < lo) return null;
  const target = Math.min(hi, Math.max(lo, want ?? (span.from + span.to) / 2));
  const free = (at: number) => span.taken.every(([a, b]) => at + width / 2 <= a || at - width / 2 >= b);
  for (let off = 0; off <= hi - lo + 1e-6; off += 0.1) {
    for (const at of [target - off, target + off]) if (at >= lo - 1e-6 && at <= hi + 1e-6 && free(at)) return at;
  }
  return null;
}
