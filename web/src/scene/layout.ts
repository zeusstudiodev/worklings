// Turns a studio into a floor plan. v1 and v2: rooms on a grid behind a front strip with the lobby and the lead's
// office. v3, a company (docs/game-feel.md, section 6): the departments' rooms side by side behind a hall, growing only
// toward the back, and a front strip with the CEO's office, reception with the front desk, and the meeting room.
// Pure geometry, no React or Three.js, so it can be tested on its own. Units are roughly half a metre; x runs to the
// right and z toward the camera.
import type { BaseDepartment } from '../../../src/core/departments.ts';
import type { RoomKind, Theme } from '../../../src/core/looks.ts';
import type { Level, OfficeRoom, Studio, StudioRole } from '../../../src/core/studio.ts';

export interface Point {
  x: number;
  z: number;
}

export interface Rect extends Point {
  w: number;
  d: number;
}

export interface DeskSlot extends Point {
  roleId: string;
  title: string;
  room: string;
}

export interface PosterSlot extends Point {
  ruleId: string;
  title: string;
}

/** A door in one of a room's walls: its middle measured along the wall from the room's left edge (front and back walls) or back edge (left and right walls). */
export interface Door {
  side: 'front' | 'back' | 'left' | 'right';
  at: number;
  width: number;
}

/** Where someone sits or stands, and the way they face: radians about the vertical axis, 0 toward +z (the camera's side). */
export interface Spot extends Point {
  facing: number;
}

/** Something on a back wall, facing the camera: its middle and width along the wall, its bottom edge and height. */
export interface WallPiece {
  x: number;
  z: number;
  w: number;
  y: number;
  h: number;
}

/** v3: a desk in a company's office, with the places the moments use around it. */
export interface CompanyDesk extends DeskSlot {
  /** Whose desk it is; null for a free desk, drawn empty. */
  person: string | null;
  /** Its place in the room: 0 is nearest the door, and slots never move. */
  slot: number;
  w: number;
  d: number;
  /** The chair, where the person sits facing the camera. */
  seat: Point;
  /** The tray on the desk's right where notes wait (game-feel.md, section 1). */
  tray: Point;
  /** Beside the chair, where someone who walks over stands to talk. */
  visitor: Point;
  /** A step behind that, where a second one waits. */
  behind: Point;
  /** The first-day plant, at the desk's right end between the tray and the corner piece. */
  plant: Point;
  /**
   * A long day's takeaway cups in the order they come (game-feel.md, section 4): the front left corner, beside it, then
   * behind them, all where the default camera sees them past the monitor. The front right corner is the scenery's.
   */
  cups: Point[];
  /** The CEO's wider desk. */
  wide: boolean;
}

export interface RoomLayout extends Rect {
  id: string;
  name: string;
  style: BaseDepartment;
  desks: DeskSlot[];
  posters: PosterSlot[];
  /** Rules beyond what fits on the back wall. */
  morePosters: number;
  /** v3: the room's doors; without them a room has one in the middle of its front wall (v2). */
  doors?: Door[];
  /** v3: free desks, drawn empty: a company's room keeps one (two over six people). */
  spare?: CompanyDesk[];
  /** v3: the room's own theme, when it differs from the office's. */
  theme?: Theme;
}

/** v3: a room that isn't a department's. */
export interface OfficeRoomLayout extends Rect {
  id: string;
  name: string;
  kind: RoomKind;
  doors: Door[];
  /** Where people sit: lounge sofas, a kitchen table, the games room's stools, reception's visitors' chairs. */
  seats: Spot[];
  /** Furniture people walk around: a counter, a table, a sofa. */
  blocks: Rect[];
  theme?: Theme;
}

/** The front desk at reception's front edge, facing the camera (game-feel.md, section 2). */
export interface FrontDesk {
  counter: Rect;
  /** The six places in the order the line fills them: the counter's middle, its left and right, then the row behind. Waiters face the camera. */
  places: Spot[];
  /** The lamp on the counter that stays on at night. */
  lamp: Point;
  /** Its sign, on the counter's front: "Front desk, 3 need you". */
  sign: Point;
}

export interface CeoOffice extends OfficeRoomLayout {
  /** The CEO's desk. */
  desk: CompanyDesk;
  /** The CEO's department's other people, to the left of the CEO's corner; the office grows to the left. */
  desks: CompanyDesk[];
  spare: CompanyDesk[];
  /** The org board on the back wall, where the CEO drafts the org. */
  board: WallPiece;
  /** Where the CEO stands drawing on it. */
  boardSpot: Spot;
}

export interface Reception extends OfficeRoomLayout {
  frontDesk: FrontDesk;
}

export interface MeetingRoom extends OfficeRoomLayout {
  table: Rect;
  /** Where the one who calls a meeting stands. */
  head: Spot;
  /** Where listeners stand round the table, nearest the head first. */
  spots: Spot[];
  /** The milestone board and the screen, side by side on the back wall. */
  board: WallPiece;
  screen: WallPiece;
}

/**
 * What studio.yaml's office section would record so the floor plan is learned once (game-feel.md, section 6): each
 * room's left edge, columns and rows, reception's left edge, and each person's desk. Plain data, so it can be kept
 * between layouts and, once the contract has a place for it, written to studio.yaml.
 */
export interface OfficePlaces {
  /** Rooms by id: the row they stand in (0 nearest the hall), their left edge, desk columns and rows, and desks drawn. */
  rooms: Record<string, { row: number; x: number; cols: number; rows: number; desks: number }>;
  reception: { x: number };
  desks: Record<string, { room: string; slot: number }>;
  /** Desks of people who left, kept free for them until a hire takes them. */
  freed: Record<string, { room: string; slot: number }>;
}

/**
 * v3: where an all-hands gathers (SPEC-v3.md, "Steering"): the meeting room's floor, or reception's when there is none.
 * Everyone faces one point out from the room's front, toward the camera, as the front desk's line faces you.
 */
export interface Gathering {
  room: string;
  /** Just inside the door people come in by: every way there passes it, so one search serves the whole office. */
  door: Point;
  focus: Point;
  /**
   * Standing places in the order they fill, from the middle of the front wall back, a step apart in staggered rows:
   * clear of walls and furniture, and in reception of the front desk's line and the visitors' chairs. Each faces the focus.
   */
  spots: Spot[];
}

export interface OfficeFloor {
  ceo: CeoOffice;
  reception: Reception;
  meeting: MeetingRoom | null;
  gathering: Gathering;
  /** Lounges, kitchens and games rooms, after the departments' rooms. */
  rest: OfficeRoomLayout[];
  /** Every desk, taken or free, the CEO's first. */
  desks: CompanyDesk[];
  /** Each person's desk. */
  byPerson: Map<string, CompanyDesk>;
  /** The desks of people who left, by person, while they stay free. */
  freed: Map<string, CompanyDesk>;
  /** Just outside reception's front door, where people wave on their way out. */
  door: Point;
  /** The model's edge beyond it, where people arrive and fade out. */
  edge: Point;
  places: OfficePlaces;
}

export interface GateSlot extends Point {
  id: string;
  title: string;
  from: string;
  to: string;
}

export interface Layout {
  rooms: RoomLayout[];
  lobby: Rect & { entrance: Point; seats: Point[] };
  lead: Rect & { desk: Point };
  gates: GateSlot[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  desks: Map<string, DeskSlot>;
  /** v3: a company's floor. For one, `rooms` are the departments', `lobby` is reception and `lead` the CEO's office. */
  office?: OfficeFloor;
}

export const WALL_HEIGHT = 2.1;
/** Walls and the door in each room's front wall, as Building draws them; people walk through the doors. */
export const WALL_THICKNESS = 0.18;
export const DOOR_WIDTH = 1.7;
export const DESK_WIDTH = 1.7;
export const LEAD_DESK_WIDTH = 2.3;
export const DESK_DEPTH = 0.85;
/** Chairs (and the people on them) sit this far behind their desk. */
export const SEAT_BEHIND = 0.85;
const DESK_X = 2.7;
const DESK_Z = 2.9;
const PAD = 1.0;
const BACK = 0.5;
const FRONT = 1.7;
const CORRIDOR = 1.8;
const POSTERS_PER_WALL = 3;
const LOBBY_SEATS = 12;

/** Where a desk's person sits: a company desk says; a v2 desk's chair is behind it. */
export const seatOf = (desk: Point & { seat?: Point }): Point => desk.seat ?? { x: desk.x, z: desk.z - SEAT_BEHIND };

/** The footprint of a room's walls: back, left, right and front, each with gaps for its doors (v2: one in the front). */
export function wallRects(r: Rect & { doors?: readonly Door[] }): Rect[] {
  const t = WALL_THICKNESS;
  const doors = r.doors ?? [{ side: 'front', at: r.w / 2, width: DOOR_WIDTH }];
  const along = (side: Door['side'], length: number, piece: (from: number, to: number) => Rect): Rect[] => {
    const gaps = doors.filter((d) => d.side === side).map((d) => [d.at - d.width / 2, d.at + d.width / 2] as const).sort((a, b) => a[0] - b[0]);
    const out: Rect[] = [];
    let at = 0;
    for (const [a, b] of gaps) {
      if (a > at) out.push(piece(at, a));
      at = Math.max(at, b);
    }
    if (length > at) out.push(piece(at, length));
    return out;
  };
  return [
    ...along('back', r.w, (a, b) => ({ x: r.x + a, z: r.z, w: b - a, d: t })),
    ...along('left', r.d, (a, b) => ({ x: r.x, z: r.z + a, w: t, d: b - a })),
    ...along('right', r.d, (a, b) => ({ x: r.x + r.w - t, z: r.z + a, w: t, d: b - a })),
    ...along('front', r.w, (a, b) => ({ x: r.x + a, z: r.z + r.d - t, w: b - a, d: t })),
  ];
}

/** The tops of every desk, the lead's wider one included. */
export function deskRects(layout: Layout): Rect[] {
  if (layout.office) return layout.office.desks.map((d) => ({ x: d.x - d.w / 2, z: d.z - d.d / 2, w: d.w, d: d.d }));
  const rect = (p: Point, w: number): Rect => ({ x: p.x - w / 2, z: p.z - DESK_DEPTH / 2, w, d: DESK_DEPTH });
  return [...[...layout.desks.values()].map((d) => rect(d, DESK_WIDTH)), rect(layout.lead.desk, LEAD_DESK_WIDTH)];
}

/** The rooms whose walls stand in the way: a company's office rooms, or v2's lobby and lead's office. */
export function wallsOf(layout: Layout): (Rect & { doors?: readonly Door[] })[] {
  const office = layout.office;
  if (!office) return [...layout.rooms, layout.lobby, layout.lead];
  return [...layout.rooms, office.ceo, office.reception, ...(office.meeting ? [office.meeting] : []), ...office.rest];
}

/** Furniture people walk around besides the desks: the front desk's counter, the meeting table, sofas and counters. */
export function furnitureRects(layout: Layout): Rect[] {
  const office = layout.office;
  if (!office) return [];
  return [office.ceo, office.reception, ...(office.meeting ? [office.meeting] : []), ...office.rest].flatMap((r) => r.blocks);
}

/**
 * v1 and v2 studios get the grid of rooms behind the lobby and the lead's office. A company's studio (one with an
 * org or an office section) gets its office; `places` from the last layout keep its rooms and desks where they were.
 */
export function computeLayout(studio: Studio | null, places?: OfficePlaces | null): Layout {
  if (studio && isCompanyStudio(studio)) return companyLayout(studio, places ?? null);
  return studioLayout(studio);
}

/** A studio a company runs: its roles have levels, or it has an office section. */
export const isCompanyStudio = (studio: Studio): boolean => studio.office !== undefined || studio.roles.some((r) => r.level !== undefined);

function studioLayout(studio: Studio | null): Layout {
  const departments = studio?.departments ?? [];
  const rooms: RoomLayout[] = departments.map((d) => {
    const roles = studio?.roles.filter((r) => r.department === d.id) ?? [];
    const cols = Math.min(3, Math.max(2, roles.length));
    const rows = Math.max(1, Math.ceil(roles.length / cols));
    const w = cols * DESK_X + PAD * 2;
    const depth = BACK + rows * DESK_Z + FRONT;
    const rules = studio?.rules.filter((r) => r.department === d.id) ?? [];
    return {
      id: d.id, name: d.name, style: d.style, x: 0, z: 0, w, d: depth,
      desks: roles.map((r, i) => ({ roleId: r.id, title: r.title, room: d.id, x: PAD + DESK_X * ((i % cols) + 0.5), z: BACK + 1.25 + DESK_Z * Math.floor(i / cols) })),
      posters: rules.slice(0, POSTERS_PER_WALL).map((r, i, shown) => ({ ruleId: r.id, title: r.title, x: (w * (i + 1)) / (shown.length + 1), z: 0.12 })),
      morePosters: Math.max(0, rules.length - POSTERS_PER_WALL),
    };
  });

  const perRow = rooms.length <= 2 ? Math.max(1, rooms.length) : rooms.length <= 4 ? 2 : 3;
  const rows: RoomLayout[][] = [];
  for (let i = 0; i < rooms.length; i += perRow) rows.push(rooms.slice(i, i + perRow));
  const rowWidth = (row: RoomLayout[]) => row.reduce((s, r) => s + r.w, 0) + CORRIDOR * (row.length - 1);
  const width = Math.max(16, ...rows.map(rowWidth));
  const left = -width / 2;

  let z = 0;
  for (const row of rows) {
    // Spread the rooms of a short row so every row spans the same width.
    const gap = row.length > 1 ? (width - row.reduce((s, r) => s + r.w, 0)) / (row.length - 1) : 0;
    let x = left;
    // Rooms keep their own depth; a small room next to a big one leaves a courtyard instead of an empty hall.
    const depth = Math.max(...row.map((r) => r.d));
    for (const room of row) {
      room.x = x;
      room.z = z;
      x += room.w + gap;
    }
    z += depth + CORRIDOR;
  }

  // The front strip holds the lobby and the lead's office side by side, centred under the rooms.
  const front = z;
  const leadW = 7;
  const lobbyW = Math.min(12, Math.max(8, width * 0.32));
  const frontLeft = left + (width - lobbyW - CORRIDOR - leadW) / 2;
  const lobby = {
    x: frontLeft, z: front, w: lobbyW, d: 5.4,
    entrance: { x: frontLeft + lobbyW / 2, z: front + 5.4 + 1.2 },
    seats: Array.from({ length: LOBBY_SEATS }, (_, i) => {
      const perLine = Math.max(1, Math.floor((lobbyW - 2) / 1.9));
      return { x: frontLeft + 1.6 + (i % perLine) * 1.9, z: front + 1.4 + Math.floor(i / perLine) * 1.9 };
    }),
  };
  const leadX = frontLeft + lobbyW + CORRIDOR;
  const lead = { x: leadX, z: front, w: leadW, d: 5.4, desk: { x: leadX + leadW / 2, z: front + 2.2 } };

  const desks = new Map<string, DeskSlot>();
  for (const room of rooms) {
    for (const desk of room.desks) {
      desk.x += room.x;
      desk.z += room.z;
      desks.set(desk.roleId, desk);
    }
    for (const poster of room.posters) {
      poster.x += room.x;
      poster.z += room.z;
    }
  }

  const gates: GateSlot[] = [];
  const perRoom = new Map<string, number>();
  for (const g of studio?.gates ?? []) {
    const room = rooms.find((r) => r.id === g.from) ?? rooms[0];
    if (!room) continue;
    const n = perRoom.get(room.id) ?? 0;
    perRoom.set(room.id, n + 1);
    gates.push({ id: g.id, title: g.title, from: g.from, to: g.to, x: room.x + room.w / 2 + (n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * 1.4, z: room.z + room.d + 0.35 });
  }

  return {
    rooms,
    lobby,
    lead,
    gates,
    bounds: { minX: left - 1.2, maxX: left + width + 1.2, minZ: -1.2, maxZ: front + 5.4 + 2 },
    desks,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// v3: a company's office

/** A company's desks, as the art proof built them: wider and deeper than v2's, the top a little higher. */
export const COMPANY_DESK = { w: 1.9, d: 1.0, top: 0.92 } as const;
export const CEO_DESK = { w: 2.4, d: 1.05 } as const;
/** A person in a desk chair sits this far behind the desk's middle (the art proof's SEAT_BACK). */
export const COMPANY_SEAT_BEHIND = 1.02;
/** Desk columns and rows in a room. */
const SLOT_X = 2.8;
const SLOT_Z = 3.2;
/** A room's margins: at the sides, from the front wall to its first desks, and behind its last chairs. */
const ROOM_SIDE = 0.8;
const ROOM_FRONT = 1.4;
const ROOM_BACK = 1.6;
const ROOM_MIN_DEPTH = 6.4;
/** Between rooms side by side; the hall in front of each row of rooms; the front strip's depth and gaps. */
const ROOM_GAP = 1.0;
const HALL = 2.4;
const STRIP_DEPTH = 8;
const STRIP_GAP = 1.0;
const RECEPTION_W = 11;
const MEETING_W = 9.4;
/** The CEO's corner of the CEO's office: the door, the board and the desk. The office grows to its left. */
const CEO_CORNER = 6.4;
const REST_W = 8;
/**
 * Departments' rooms in a row before another row starts behind it: four keep every walk in the office within the
 * 6 s a walk may take (docs/game-feel.md, section 1).
 */
const ROW_ROOMS = 4;
const VISITOR_SEATS = 6;
/** The columns of a row in the order desks fill them: nearest the door, in the middle of the front wall, first. */
const COLUMN_ORDER: Readonly<Record<number, readonly number[]>> = { 1: [0], 2: [0, 1], 3: [1, 0, 2] };
/** The rooms every office has besides its departments', while studio.yaml has no office section yet (founding). */
const DEFAULT_ROOMS: readonly OfficeRoom[] = [
  { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
  { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
];

/** An all-hands' crowd: a step between people (a person is about 0.85 wide), kept this far from walls and furniture. */
const GATHER_STEP = 1.05;
const GATHER_WALL = 0.55;
const GATHER_FURNITURE = 0.5;
/** How far a crowd keeps from the front desk's places and the visitors' chairs. */
const GATHER_KEEP = 0.85;
/**
 * The point everyone faces: out from the middle of the room's front wall toward the camera (which looks from the front
 * right), so the crowd turns to you as the front desk's line does. Places fill from the front wall's middle.
 */
const GATHER_FOCUS = { x: 6, z: 6 };

/**
 * Standing places on a room's floor for an all-hands: staggered rows a step apart from the front wall back, centred,
 * skipping furniture and places that must stay clear, the front row's middle first.
 */
function gatheringIn(room: OfficeRoomLayout, keepClear: readonly Point[]): Gathering {
  const front0 = { x: room.x + room.w / 2, z: room.z + room.d };
  const focus = { x: front0.x + GATHER_FOCUS.x, z: front0.z + GATHER_FOCUS.z };
  const inner = { left: room.x + WALL_THICKNESS + GATHER_WALL, right: room.x + room.w - WALL_THICKNESS - GATHER_WALL };
  const front = room.z + room.d - WALL_THICKNESS - GATHER_WALL;
  const back = room.z + WALL_THICKNESS + GATHER_WALL;
  const clearOf = (p: Point, r: Rect) => p.x < r.x - GATHER_FURNITURE || p.x > r.x + r.w + GATHER_FURNITURE || p.z < r.z - GATHER_FURNITURE || p.z > r.z + r.d + GATHER_FURNITURE;
  const spots: Spot[] = [];
  for (let row = 0; front - row * GATHER_STEP >= back - 1e-9; row++) {
    const z = front - row * GATHER_STEP;
    const shift = row % 2 === 1 ? GATHER_STEP / 2 : 0;
    const cols = Math.floor((inner.right - inner.left - shift) / GATHER_STEP) + 1;
    const start = (inner.left + inner.right) / 2 - ((cols - 1) * GATHER_STEP) / 2;
    for (let c = 0; c < cols; c++) {
      const p = { x: start + c * GATHER_STEP, z };
      if (!room.blocks.every((b) => clearOf(p, b)) || keepClear.some((k) => Math.hypot(k.x - p.x, k.z - p.z) < GATHER_KEEP)) continue;
      spots.push({ ...p, facing: Math.atan2(focus.x - p.x, focus.z - p.z) });
    }
  }
  const away = (p: Point) => Math.hypot(p.x - front0.x, p.z - front0.z);
  spots.sort((a, b) => away(a) - away(b) || a.x - b.x || a.z - b.z);
  // The way in from the hall: the door in the back wall (reception's other door is the street's).
  const way = room.doors.find((d) => d.side === 'back') ?? room.doors[0];
  const inside = 0.5;
  const door = !way
    ? { x: room.x + room.w / 2, z: room.z + room.d / 2 }
    : way.side === 'back' ? { x: room.x + way.at, z: room.z + inside }
      : way.side === 'front' ? { x: room.x + way.at, z: room.z + room.d - inside }
        : way.side === 'left' ? { x: room.x + inside, z: room.z + way.at } : { x: room.x + room.w - inside, z: room.z + way.at };
  return { room: room.id, door, focus, spots };
}

const levelOf = (r: StudioRole): Level => r.level ?? (r.id === 'ceo' ? 'ceo' : 'worker');
const LEVEL_ORDER: Readonly<Record<Level, number>> = { ceo: 0, head: 1, lead: 2, worker: 3 };
const sparesFor = (people: number) => (people > 6 ? 2 : 1);
const keptRoom = (kept: OfficePlaces | null, id: string) => (kept && Object.hasOwn(kept.rooms, id) ? kept.rooms[id] : undefined);

function deskAt(x: number, z: number, owner: { person: string | null; title: string; room: string; slot: number }, wide = false): CompanyDesk {
  const size = wide ? CEO_DESK : COMPANY_DESK;
  const half = size.w / 2;
  const seat = { x, z: z - COMPANY_SEAT_BEHIND };
  // The camera looks from the front right, so the person's side of the desk hides behind the monitor: the cups stand in
  // the front left corner, where the monitor's left end hides nothing, and the plant between the tray and the scenery's
  // piece in the front right corner.
  const left = x - half;
  const front = z + size.d / 2;
  return {
    roleId: owner.person ?? '', title: owner.title, room: owner.room, person: owner.person, slot: owner.slot, x, z, w: size.w, d: size.d, seat,
    tray: { x: x + half - 0.33, z: z - 0.2 }, visitor: { x: x + half + 0.25, z: seat.z }, behind: { x: x + half + 0.75, z: seat.z - 0.6 },
    plant: { x: x + half - 0.15, z: z + 0.05 },
    cups: [{ x: left + 0.17, z: front - 0.1 }, { x: left + 0.34, z: front - 0.1 }, { x: left + 0.1, z: front - 0.265 }],
    wide,
  };
}

/**
 * Who sits where in one room: people keep the desk they had, someone rehired gets theirs back while it is free, and
 * everyone else takes the first free desk, heads first. `count` is how many desks the room needs: its people's, the
 * free ones a firing left between them, and one or two more.
 */
function seating(room: string, people: readonly StudioRole[], kept: OfficePlaces | null): { slots: Map<string, number>; count: number } {
  const slots = new Map<string, number>();
  const taken = new Set<number>();
  const take = (id: string, slot: number) => {
    slots.set(id, slot);
    taken.add(slot);
  };
  for (const p of people) {
    const had = kept && Object.hasOwn(kept.desks, p.id) ? kept.desks[p.id] : undefined;
    if (had && had.room === room && !taken.has(had.slot)) take(p.id, had.slot);
  }
  for (const p of people) {
    const freed = kept && !slots.has(p.id) && Object.hasOwn(kept.freed, p.id) ? kept.freed[p.id] : undefined;
    if (freed && freed.room === room && !taken.has(freed.slot)) take(p.id, freed.slot);
  }
  const order = [...people].sort((a, b) => LEVEL_ORDER[levelOf(a)] - LEVEL_ORDER[levelOf(b)]);
  for (const p of order) {
    if (slots.has(p.id)) continue;
    let s = 0;
    while (taken.has(s)) s += 1;
    take(p.id, s);
  }
  const highest = Math.max(-1, ...taken);
  let free = 0;
  let count = 0;
  for (let s = 0; s <= highest || free < sparesFor(people.length); s++) {
    if (!taken.has(s)) free += 1;
    count = s + 1;
  }
  return { slots, count };
}

/** A room's depth for so many rows of desks, from its front wall back. */
const depthFor = (rows: number) => Math.max(ROOM_MIN_DEPTH, ROOM_FRONT + COMPANY_DESK.d / 2 + (rows - 1) * SLOT_Z + COMPANY_SEAT_BEHIND + ROOM_BACK);

/** The seats and furniture of a lounge, kitchen or games room in the front strip, from its back-left corner (its door). */
function restFurniture(kind: RoomKind, x: number, z: number): { seats: Spot[]; blocks: Rect[] } {
  const at = (dx: number, dz: number, facing: number): Spot => ({ x: x + dx, z: z + dz, facing });
  const box = (dx: number, dz: number, w: number, d: number): Rect => ({ x: x + dx, z: z + dz, w, d });
  if (kind === 'kitchen') {
    return {
      seats: [at(4.4, 3.2, 0), at(4.4, 5.6, Math.PI), at(2.9, 4.4, Math.PI / 2), at(5.9, 4.4, -Math.PI / 2)],
      blocks: [box(3.6, 3.8, 1.6, 1.2), box(2.6, 0.2, 5.0, 0.8)],
    };
  }
  if (kind === 'games') {
    return {
      seats: [at(3.6, 3.4, Math.PI), at(4.8, 3.4, Math.PI), at(6.0, 3.4, Math.PI), at(6.8, 5.4, -Math.PI / 2)],
      blocks: [box(2.6, 0.2, 5.0, 0.8)],
    };
  }
  // A lounge, and any other room that isn't a department's: a sofa facing the camera, two armchairs, a low table.
  return {
    seats: [at(3.6, 3.0, 0), at(4.8, 3.0, 0), at(6.0, 3.0, 0), at(2.4, 5.4, Math.PI / 2), at(7.0, 5.4, -Math.PI / 2)],
    blocks: [box(3.0, 2.0, 3.6, 0.6), box(4.2, 4.8, 1.2, 0.8)],
  };
}

interface RowRoom {
  id: string;
  w: number;
  d: number;
  /** Where the last layout put it. */
  kept: { row: number; x: number } | null;
}

function companyLayout(studio: Studio, kept: OfficePlaces | null): Layout {
  const ceo = studio.roles.find((r) => levelOf(r) === 'ceo') ?? null;
  const ceoDepartment = ceo?.department ?? null;
  const officeRooms = studio.office?.rooms ?? DEFAULT_ROOMS;
  const receptionRoom: OfficeRoom = officeRooms.find((r) => r.kind === 'reception') ?? { id: 'reception', title: 'Reception', kind: 'reception' };
  const ceoRoom: OfficeRoom = officeRooms.find((r) => r.kind === 'ceo') ?? { id: 'ceo-office', title: "CEO's office", kind: 'ceo' };
  const meetingRoom = officeRooms.find((r) => r.kind === 'meeting') ?? null;
  const restRooms = officeRooms.filter((r) => r !== receptionRoom && r !== ceoRoom && r !== meetingRoom);
  const places: OfficePlaces = { rooms: {}, reception: { x: 0 }, desks: {}, freed: {} };

  // The departments' rooms: all but the CEO's own department, whose people sit with the CEO.
  const departments = studio.departments.filter((d) => d.id !== ceoDepartment);
  const shapes = new Map<string, { cols: number; rows: number; desks: number; slots: Map<string, number> }>();
  const rowRooms: RowRoom[] = [];
  for (const d of departments) {
    const people = studio.roles.filter((r) => r.department === d.id && r !== ceo);
    const { slots, count } = seating(d.id, people, kept);
    const had = keptRoom(kept, d.id);
    const desks = Math.max(count, had?.desks ?? 0);
    const cols = had?.cols || (desks <= 2 ? 2 : 3);
    const rows = Math.max(had?.rows ?? 1, Math.ceil(desks / cols));
    shapes.set(d.id, { cols, rows, desks, slots });
    rowRooms.push({ id: d.id, w: ROOM_SIDE * 2 + cols * SLOT_X, d: depthFor(rows), kept: had && had.row >= 0 ? { row: had.row, x: had.x } : null });
  }
  const placed = placeRows(rowRooms);

  // The front strip, left to right: the CEO's office, reception with the front desk, the meeting room, the rest rooms.
  const direction = studio.roles.filter((r) => r.department === ceoDepartment && r !== ceo);
  const directionSeats = seating(ceoDepartment ?? ceoRoom.id, direction, kept);
  const ceoHad = keptRoom(kept, ceoRoom.id);
  const directionDesks = Math.max(direction.length > 0 ? directionSeats.count : 0, ceoHad?.desks ?? 0);
  const directionCols = Math.max(Math.ceil(directionDesks / 2), ceoHad?.cols ?? 0);
  const ceoW = CEO_CORNER + directionCols * SLOT_X;
  const stripW = ceoW + STRIP_GAP + RECEPTION_W + (meetingRoom ? STRIP_GAP + MEETING_W : 0) + restRooms.length * (STRIP_GAP + REST_W);
  const rx = kept?.reception.x ?? -stripW / 2 + ceoW + STRIP_GAP;
  const top = HALL;
  const front = HALL + STRIP_DEPTH;
  places.reception = { x: rx };

  const ownersOf = (slots: Map<string, number>, people: readonly StudioRole[]) => {
    const owner = new Map<number, StudioRole>();
    for (const p of people) {
      const s = slots.get(p.id);
      if (s !== undefined) owner.set(s, p);
    }
    return owner;
  };

  const ceoRight = rx - STRIP_GAP;
  const ceoX = ceoRight - ceoW;
  const ceoDesk = deskAt(ceoRight - 3.0, top + 4.6, { person: ceo?.id ?? null, title: ceo?.title ?? 'CEO', room: ceoRoom.id, slot: 0 }, true);
  const directionOwners = ownersOf(directionSeats.slots, direction);
  const ceoTaken: CompanyDesk[] = [];
  const ceoSpare: CompanyDesk[] = [];
  for (let s = 0; s < directionCols * 2; s++) {
    const owner = directionOwners.get(s) ?? null;
    if (s >= directionDesks && !owner) continue;
    const desk = deskAt(ceoRight - CEO_CORNER - SLOT_X * (Math.floor(s / 2) + 0.5), front - ROOM_FRONT - COMPANY_DESK.d / 2 - (s % 2) * SLOT_Z, {
      person: owner?.id ?? null, title: owner?.title ?? '', room: ceoDepartment ?? ceoRoom.id, slot: s,
    });
    (owner ? ceoTaken : ceoSpare).push(desk);
  }
  places.rooms[ceoRoom.id] = { row: -1, x: ceoX, cols: directionCols, rows: 2, desks: directionDesks };
  const ceoOffice: CeoOffice = {
    id: ceoRoom.id, name: ceoRoom.title, kind: 'ceo', x: ceoX, z: top, w: ceoW, d: STRIP_DEPTH,
    doors: [{ side: 'back', at: ceoW - 5.6, width: 1.5 }], seats: [], blocks: [], ...(ceoRoom.theme ? { theme: ceoRoom.theme } : {}),
    desk: ceoDesk, desks: ceoTaken, spare: ceoSpare,
    board: { x: ceoRight - 3.0, z: top + WALL_THICKNESS, w: 3.6, y: 0.95, h: 1.25 },
    // A step back from the board's left end, turned to it: the camera looks from the front right, so whoever draws there
    // hides none of the chart (in front of its middle they hid most of it).
    boardSpot: { x: ceoRight - 3.0 - 1.6, z: top + 1.2, facing: Math.PI - 0.4 },
  };

  // Both of reception's doors are on its right, on the way from the street to the hall; its visitors sit on the left.
  const counter: Rect = { x: rx + 2.4, z: top + 6.15, w: 4.4, d: 0.9 };
  const cx = counter.x + counter.w / 2;
  const line1 = counter.z - 0.75;
  const line2 = line1 - 1.15;
  const reception: Reception = {
    id: receptionRoom.id, name: receptionRoom.title, kind: 'reception', x: rx, z: top, w: RECEPTION_W, d: STRIP_DEPTH,
    doors: [{ side: 'back', at: 8.6, width: DOOR_WIDTH }, { side: 'front', at: 9.4, width: DOOR_WIDTH }],
    seats: Array.from({ length: VISITOR_SEATS }, (_, i) => ({ x: rx + 1.0 + (i % 3) * 1.2, z: top + 1.4 + Math.floor(i / 3) * 1.5, facing: 0 })),
    blocks: [counter], ...(receptionRoom.theme ? { theme: receptionRoom.theme } : {}),
    frontDesk: {
      counter,
      places: [
        { x: cx, z: line1, facing: 0 }, { x: cx - 1.3, z: line1, facing: 0 }, { x: cx + 1.3, z: line1, facing: 0 },
        { x: cx, z: line2, facing: 0 }, { x: cx - 1.3, z: line2, facing: 0 }, { x: cx + 1.3, z: line2, facing: 0 },
      ],
      lamp: { x: cx + 1.6, z: counter.z + counter.d / 2 },
      sign: { x: cx, z: counter.z + counter.d },
    },
  };

  let meeting: MeetingRoom | null = null;
  let stripRight = rx + RECEPTION_W;
  if (meetingRoom) {
    const mx = rx + RECEPTION_W + STRIP_GAP;
    const table: Rect = { x: mx + 2.6, z: top + 4.0, w: 4.4, d: 1.6 };
    const tx = table.x + table.w / 2;
    const behind = table.z - 0.75;
    const before = table.z + table.d + 0.75;
    meeting = {
      id: meetingRoom.id, name: meetingRoom.title, kind: 'meeting', x: mx, z: top, w: MEETING_W, d: STRIP_DEPTH,
      doors: [{ side: 'back', at: 1.0, width: 1.6 }], seats: [], blocks: [table], ...(meetingRoom.theme ? { theme: meetingRoom.theme } : {}),
      table,
      head: { x: table.x + table.w + 0.85, z: table.z + table.d / 2, facing: -Math.PI / 2 },
      spots: [
        { x: tx, z: behind, facing: 0 }, { x: tx, z: before, facing: Math.PI }, { x: tx + 1.4, z: behind, facing: 0 },
        { x: tx + 1.4, z: before, facing: Math.PI }, { x: tx - 1.4, z: behind, facing: 0 }, { x: tx - 1.4, z: before, facing: Math.PI },
      ],
      board: { x: mx + 3.2, z: top + WALL_THICKNESS, w: 2.4, y: 1.0, h: 1.0 },
      screen: { x: mx + 6.6, z: top + WALL_THICKNESS, w: 3.0, y: 0.85, h: 1.4 },
    };
    stripRight = mx + MEETING_W;
  }

  // Lounges, kitchens and games rooms after it: kept where they were, new ones at the strip's right end.
  const rest: OfficeRoomLayout[] = [];
  const restX = new Map<string, number>();
  for (const r of restRooms) {
    const had = keptRoom(kept, r.id);
    if (had && had.row < 0) {
      restX.set(r.id, had.x);
      stripRight = Math.max(stripRight, had.x + REST_W);
    }
  }
  for (const r of restRooms) {
    if (restX.has(r.id)) continue;
    restX.set(r.id, stripRight + STRIP_GAP);
    stripRight += STRIP_GAP + REST_W;
  }
  for (const r of restRooms) {
    const x = restX.get(r.id) ?? stripRight;
    rest.push({
      id: r.id, name: r.title, kind: r.kind, x, z: top, w: REST_W, d: STRIP_DEPTH, doors: [{ side: 'back', at: 1.2, width: 1.6 }],
      ...restFurniture(r.kind, x, top), ...(r.theme ? { theme: r.theme } : {}),
    });
    places.rooms[r.id] = { row: -1, x, cols: 0, rows: 0, desks: 0 };
  }

  // The departments' rooms in their rows, desks in their slots.
  const rooms: RoomLayout[] = [];
  const all: CompanyDesk[] = [ceoDesk, ...ceoTaken, ...ceoSpare];
  for (const d of departments) {
    const spot = placed.get(d.id);
    const shape = shapes.get(d.id);
    if (!spot || !shape) continue;
    const { cols, rows } = shape;
    const w = ROOM_SIDE * 2 + cols * SLOT_X;
    const depth = depthFor(rows);
    const owners = ownersOf(shape.slots, studio.roles.filter((r) => r.department === d.id && r !== ceo));
    const desks: CompanyDesk[] = [];
    const spare: CompanyDesk[] = [];
    for (let s = 0; s < shape.desks; s++) {
      const col = COLUMN_ORDER[cols]?.[s % cols] ?? s % cols;
      const owner = owners.get(s) ?? null;
      const desk = deskAt(spot.x + ROOM_SIDE + SLOT_X * (col + 0.5), spot.front - ROOM_FRONT - COMPANY_DESK.d / 2 - Math.floor(s / cols) * SLOT_Z, {
        person: owner?.id ?? null, title: owner?.title ?? '', room: d.id, slot: s,
      });
      (owner ? desks : spare).push(desk);
    }
    all.push(...desks, ...spare);
    const back = spot.front - depth;
    const rules = studio.rules.filter((r) => r.department === d.id);
    rooms.push({
      id: d.id, name: d.name, style: d.style, x: spot.x, z: back, w, d: depth, desks, spare,
      doors: [{ side: 'front', at: w / 2, width: DOOR_WIDTH }], ...(d.theme ? { theme: d.theme } : {}),
      posters: rules.slice(0, POSTERS_PER_WALL).map((r, i, shown) => ({ ruleId: r.id, title: r.title, x: spot.x + (w * (i + 1)) / (shown.length + 1), z: back + 0.12 })),
      morePosters: Math.max(0, rules.length - POSTERS_PER_WALL),
    });
    places.rooms[d.id] = { row: spot.row, x: spot.x, cols, rows, desks: shape.desks };
  }

  const byPerson = new Map<string, CompanyDesk>();
  for (const desk of all) if (desk.person) byPerson.set(desk.person, desk);
  for (const [person, desk] of byPerson) places.desks[person] = { room: desk.room, slot: desk.slot };

  // People who left keep their desk free until a hire takes it, so a rehire comes back to it.
  const freed = new Map<string, CompanyDesk>();
  const left = kept ? [...Object.entries(kept.freed), ...Object.entries(kept.desks)] : [];
  for (const [person, at] of left) {
    if (byPerson.has(person) || freed.has(person)) continue;
    const desk = all.find((d) => d.person === null && d.room === at.room && d.slot === at.slot);
    if (!desk) continue;
    freed.set(person, desk);
    places.freed[person] = { room: at.room, slot: at.slot };
  }

  const gates: GateSlot[] = [];
  const perRoom = new Map<string, number>();
  for (const g of studio.gates) {
    const room = rooms.find((r) => r.id === g.from) ?? rooms[0];
    if (!room) continue;
    const n = perRoom.get(room.id) ?? 0;
    perRoom.set(room.id, n + 1);
    gates.push({ id: g.id, title: g.title, from: g.from, to: g.to, x: room.x + room.w / 2 + (n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * 1.4, z: room.z + room.d + 0.35 });
  }

  const door = { x: rx + 9.4, z: front + 0.9 };
  const edge = { x: rx + 9.4, z: front + 2.2 };
  const everything: Rect[] = [...rooms, ...rest, ceoOffice, reception, ...(meeting ? [meeting] : [])];
  // An all-hands takes the meeting room; without one it gathers in reception, clear of the front desk's line.
  const gathering = meeting ? gatheringIn(meeting, []) : gatheringIn(reception, [...reception.frontDesk.places, ...reception.seats]);
  return {
    rooms,
    lobby: { x: rx, z: top, w: RECEPTION_W, d: STRIP_DEPTH, entrance: door, seats: reception.seats.map(({ x, z }) => ({ x, z })) },
    lead: { x: ceoX, z: top, w: ceoW, d: STRIP_DEPTH, desk: { x: ceoDesk.x, z: ceoDesk.z } },
    gates,
    bounds: {
      minX: Math.min(...everything.map((r) => r.x)) - 1.2,
      maxX: Math.max(...everything.map((r) => r.x + r.w)) + 1.2,
      minZ: Math.min(...everything.map((r) => r.z)) - 1.2,
      maxZ: front + 2.8,
    },
    desks: new Map<string, DeskSlot>(byPerson),
    office: { ceo: ceoOffice, reception, meeting, gathering, rest, desks: all, byPerson, freed, door, edge, places },
  };
}

/**
 * The departments' rooms side by side in rows behind the hall, their fronts on it, growing only toward the back, so a
 * room that gains a row of desks moves nothing beside it (one in a row with another behind it pushes that row back).
 * Rooms the last layout placed keep their row and left edge; new ones join at the right end of the last row.
 */
function placeRows(rooms: readonly RowRoom[]): Map<string, { row: number; x: number; front: number }> {
  const rows: RowRoom[][] = [];
  if (rooms.some((r) => r.kept !== null)) {
    const keptRooms = rooms.filter((r) => r.kept !== null).sort((a, b) => (a.kept?.row ?? 0) - (b.kept?.row ?? 0) || (a.kept?.x ?? 0) - (b.kept?.x ?? 0));
    for (const r of keptRooms) (rows[r.kept?.row ?? 0] ??= []).push(r);
    for (const r of rooms.filter((r) => r.kept === null)) {
      const row = rows[rows.length - 1];
      if (row && row.length < ROW_ROOMS) row.push(r);
      else rows.push([r]);
    }
  } else {
    for (let i = 0; i < rooms.length; i += ROW_ROOMS) rows.push(rooms.slice(i, i + ROW_ROOMS));
  }
  const out = new Map<string, { row: number; x: number; front: number }>();
  let front = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? [];
    if (row.length === 0) continue;
    const width = row.reduce((s, r) => s + r.w, 0) + ROOM_GAP * (row.length - 1);
    let next = -width / 2;
    for (const r of row) {
      const x = r.kept ? r.kept.x : next;
      out.set(r.id, { row: index, x, front });
      next = Math.max(next, x + r.w + ROOM_GAP);
    }
    front -= Math.max(...row.map((r) => r.d)) + HALL;
  }
  return out;
}
