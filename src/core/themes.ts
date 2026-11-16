// What each theme looks like and what the office can put in a room: the decor catalogue the Customize panel offers,
// the pieces every kind of room is furnished with, and each theme's palette swap. Pure data and lookups: the art
// build (scripts/art/build.mjs) reads it to know which pack pieces to export, the scene to draw them.
//
// Sizes are in the art's units, KayKit's: a person stands 2.2 tall and a table is 1 high. A footprint is the floor a
// piece covers, width along x by depth along z, at its scale; a wall piece's depth is how far it stands out from the
// wall. Pack pieces face +z and stand on y = 0; wall pieces hang with their back on z = 0.
import type { RoomKind, Theme } from './looks.ts';

/** The CC0 packs pieces come from; each is built into `web/public/art/scenery/<pack>.glb` with its atlas. */
export const ART_PACKS = ['furniture-bits', 'restaurant-bits'] as const;
export type ArtPack = (typeof ART_PACKS)[number];

/** A colour block in a pack's atlas, row then column from the top left: "r1c0". */
export type Block = `r${number}c${number}`;
export const BLOCK = /^r[0-3]c[0-7]$/;

/** A theme's colour for each atlas block it changes; blocks not listed keep the pack's own colours. */
export type BlockColours = Readonly<Partial<Record<Block, string>>>;

export interface PackAtlas {
  /** The atlas is `cols` by `rows` blocks of vertical gradients, light at the top. */
  cols: number;
  rows: number;
  /**
   * The white block. Recolouring moves a block's vertices here, keeping their place in the gradient, and gives them
   * a vertex colour, so a piece keeps KayKit's shading in a new colour.
   */
  white: Block;
  /** Upholstery and rugs: in a department's room these take the department's hue instead of the theme's colour. */
  fabric: readonly Block[];
}

export const PACK_ATLAS: Readonly<Record<ArtPack, PackAtlas>> = {
  'furniture-bits': { cols: 8, rows: 4, white: 'r0c7', fabric: ['r1c0', 'r1c2'] },
  'restaurant-bits': { cols: 8, rows: 4, white: 'r0c4', fabric: [] },
};

export type Placement = 'floor' | 'wall' | 'surface';

/**
 * How a piece is drawn: a piece of a CC0 pack, at a scale, or a piece modelled here in KayKit's style (chunky
 * bevelled shapes sampling the Furniture Bits atlas), which the scene builds in code from the piece's id.
 */
export type PieceDraw = { from: 'pack'; pack: ArtPack; piece: string; scale: number } | { from: 'made' };

export interface Piece {
  /** Kebab case, as studio.yaml's `office.decor` and the CEO's office changes name it: "arcade-cabinet". */
  id: string;
  /** Sentence case, for the Customize panel: "Arcade cabinet". */
  title: string;
  /** Width along x and depth along z, in art units. */
  footprint: readonly [number, number];
  place: Placement;
  draw: PieceDraw;
}

const pack = (pack: ArtPack, piece: string, scale = 1): PieceDraw => ({ from: 'pack', pack, piece, scale });
const MADE: PieceDraw = { from: 'made' };
const piece = (id: string, title: string, footprint: readonly [number, number], place: Placement, draw: PieceDraw): Piece => ({ id, title, footprint, place, draw });

/** Every piece the office can draw. */
export const PIECES: readonly Piece[] = [
  // Seating and tables from Furniture Bits.
  piece('armchair', 'Armchair', [1.8, 1.6], 'floor', pack('furniture-bits', 'armchair_pillows')),
  piece('sofa', 'Sofa', [3, 1.6], 'floor', pack('furniture-bits', 'couch_pillows')),
  piece('chair', 'Chair', [0.76, 0.84], 'floor', pack('furniture-bits', 'chair_A')),
  piece('visitor-chair', 'Visitor chair', [0.75, 0.84], 'floor', pack('furniture-bits', 'chair_B')),
  piece('stool', 'Stool', [0.75, 0.75], 'floor', pack('furniture-bits', 'chair_stool')),
  piece('coffee-table', 'Coffee table', [2.4, 1.5], 'floor', pack('furniture-bits', 'table_low')),
  piece('side-table', 'Side table', [1, 1], 'floor', pack('furniture-bits', 'table_small')),
  piece('work-table', 'Work table', [2, 2], 'floor', pack('furniture-bits', 'table_medium')),
  piece('long-table', 'Long table', [3, 2], 'floor', pack('furniture-bits', 'table_medium_long')),
  // Storage, lamps, plants, rugs and pictures from Furniture Bits.
  piece('cabinet', 'Cabinet', [2, 1], 'floor', pack('furniture-bits', 'cabinet_medium')),
  piece('bookcase', 'Bookcase', [2.04, 1], 'floor', pack('furniture-bits', 'cabinet_medium_decorated')),
  piece('low-cabinet', 'Low cabinet', [1.04, 1.1], 'floor', pack('furniture-bits', 'cabinet_small_decorated')),
  piece('bookshelf', 'Bookshelf', [2, 0.5], 'wall', pack('furniture-bits', 'shelf_B_large_decorated')),
  piece('small-shelf', 'Small shelf', [1, 0.57], 'wall', pack('furniture-bits', 'shelf_B_small_decorated')),
  piece('standing-lamp', 'Standing lamp', [1, 1], 'floor', pack('furniture-bits', 'lamp_standing')),
  piece('cactus', 'Cactus', [0.88, 0.84], 'floor', pack('furniture-bits', 'cactus_medium_A')),
  piece('small-cactus', 'Small cactus', [0.5, 0.5], 'surface', pack('furniture-bits', 'cactus_small_A')),
  piece('rug', 'Rug', [3, 2], 'floor', pack('furniture-bits', 'rug_rectangle_A')),
  piece('striped-rug', 'Striped rug', [3, 2], 'floor', pack('furniture-bits', 'rug_rectangle_stripes_A')),
  piece('oval-rug', 'Oval rug', [3, 2], 'floor', pack('furniture-bits', 'rug_oval_A')),
  piece('picture', 'Picture', [1.01, 0.2], 'wall', pack('furniture-bits', 'pictureframe_large_A')),
  piece('wide-picture', 'Wide picture', [2, 0.2], 'wall', pack('furniture-bits', 'pictureframe_large_B')),
  piece('small-picture', 'Small picture', [0.7, 0.2], 'wall', pack('furniture-bits', 'pictureframe_small_B')),
  piece('photo-frame', 'Photo frame', [0.5, 0.38], 'surface', pack('furniture-bits', 'pictureframe_standing_A')),
  piece('books', 'Books', [0.43, 0.21], 'surface', pack('furniture-bits', 'book_set', 0.55)),
  // A kitchen and a café from Restaurant Bits, which is built on a 2-unit grid.
  piece('kitchen-counter', 'Kitchen counter', [1.56, 1.59], 'floor', pack('restaurant-bits', 'kitchencounter_straight_A', 0.78)),
  piece('kitchen-sink', 'Kitchen sink', [1.56, 1.59], 'floor', pack('restaurant-bits', 'kitchencounter_sink', 0.78)),
  piece('fridge', 'Fridge', [1.48, 1.66], 'floor', pack('restaurant-bits', 'fridge_A', 0.74)),
  piece('cafe-table', 'Café table', [1.5, 1.5], 'floor', pack('restaurant-bits', 'table_round_A_small')),
  piece('cafe-chair', 'Café chair', [0.75, 0.8], 'floor', pack('restaurant-bits', 'chair_A')),
  piece('crate', 'Crate', [1, 1], 'floor', pack('restaurant-bits', 'crate', 0.5)),
  // Modelled here: desks and what's on them (the free packs have none).
  piece('desk', 'Desk', [2, 1], 'floor', MADE),
  piece('lead-desk', 'Big desk', [2.6, 1.2], 'floor', MADE),
  piece('desk-chair', 'Desk chair', [0.8, 0.8], 'floor', MADE),
  piece('monitor', 'Monitor', [0.9, 0.3], 'surface', MADE),
  piece('keyboard', 'Keyboard', [0.7, 0.25], 'surface', MADE),
  // Modelled here: around the office.
  piece('leafy-plant', 'Leafy plant', [0.8, 0.8], 'floor', MADE),
  piece('small-plant', 'Small plant', [0.4, 0.4], 'surface', MADE),
  piece('whiteboard', 'Whiteboard', [2.4, 0.3], 'wall', MADE),
  piece('kanban-board', 'Kanban board', [2, 0.6], 'floor', MADE),
  piece('org-board', 'Org board', [3.6, 0.3], 'wall', MADE),
  piece('milestone-board', 'Milestone board', [2.4, 0.3], 'wall', MADE),
  piece('meeting-screen', 'Screen', [2.4, 0.3], 'wall', MADE),
  piece('water-cooler', 'Water cooler', [0.7, 0.7], 'floor', MADE),
  piece('coat-rack', 'Coat rack', [0.7, 0.7], 'floor', MADE),
  piece('coffee-machine', 'Coffee machine', [0.8, 0.6], 'surface', MADE),
  piece('printer', 'Printer', [1, 0.8], 'floor', MADE),
  piece('reception-desk', 'Reception desk', [3.6, 1.2], 'floor', MADE),
  // Modelled here: one theme's front desk and hero pieces each.
  piece('espresso-counter', 'Espresso counter', [3.6, 1.2], 'floor', MADE),
  piece('chalkboard-menu', 'Chalkboard menu', [1, 0.6], 'floor', MADE),
  piece('pastry-case', 'Pastry case', [1.6, 1], 'floor', MADE),
  piece('mascot-counter', 'Mascot counter', [3.6, 1.2], 'floor', MADE),
  piece('big-screen', 'Big screen', [3, 0.6], 'floor', MADE),
  piece('concept-board', 'Concept board', [1.6, 0.6], 'floor', MADE),
  piece('till', 'Till', [3.6, 1.2], 'floor', MADE),
  piece('parcel-shelves', 'Parcel shelves', [2, 0.8], 'floor', MADE),
  piece('packing-bench', 'Packing bench', [2.4, 1.2], 'floor', MADE),
  piece('badge-desk', 'Badge desk', [3.6, 1.2], 'floor', MADE),
  piece('server-rack', 'Server rack', [1, 1], 'floor', MADE),
  piece('potting-bench', 'Potting bench', [3.6, 1.2], 'floor', MADE),
  piece('greenhouse-arch', 'Greenhouse arch', [2.4, 1.2], 'floor', MADE),
  piece('planter', 'Planter', [1.6, 0.8], 'floor', MADE),
  piece('kiosk', 'Kiosk', [3.6, 1.2], 'floor', MADE),
  piece('bus-stop', 'Bus stop', [2.4, 1], 'floor', MADE),
  piece('street-lamp', 'Street lamp', [0.6, 0.6], 'floor', MADE),
  piece('bench', 'Bench', [2, 0.8], 'floor', MADE),
  piece('prize-counter', 'Prize counter', [3.6, 1.2], 'floor', MADE),
  piece('arcade-cabinet', 'Arcade cabinet', [1, 1], 'floor', MADE),
  piece('neon-sign', 'Neon sign', [1.6, 0.2], 'wall', MADE),
  piece('gear-counter', 'Gear counter', [3.6, 1.2], 'floor', MADE),
  piece('mixing-desk', 'Mixing desk', [2.4, 1.2], 'floor', MADE),
  piece('speaker', 'Speaker', [0.8, 0.8], 'floor', MADE),
  piece('vocal-booth', 'Vocal booth', [2, 2], 'floor', MADE),
];

/** What every person's desk carries, in a department's room. */
export const DESK_SET: readonly string[] = ['desk', 'desk-chair', 'monitor', 'keyboard'];

export type FloorPattern = 'carpet-tiles' | 'checks' | 'boards' | 'oak' | 'tiles' | 'grass' | 'street' | 'stars' | 'dark-wood';

export interface ThemeLook {
  id: Theme;
  /** Sentence case: "Classic office". */
  name: string;
  /** One sentence for the Customize panel: what it looks like and what it suits. */
  sentence: string;
  /** The pattern and its two colours: the main one and the lines, checks or path. */
  floor: { pattern: FloorPattern; colour: string; second: string };
  wall: string;
  /** The theme's own colour on its decor. Never the highlighter yellow, which means "needs you" and selection. */
  accent: string;
  /** Reception's front desk, where people who need the stakeholder wait. Always six places. */
  frontDesk: string;
  /** What stands by the door, the main piece first. */
  hero: readonly string[];
  /** What Customize offers for this theme, the hero pieces included. */
  decor: readonly string[];
  /** The palette swap: block colours per pack, and per piece where one piece needs its own. */
  recolour: { packs: Readonly<Partial<Record<ArtPack, BlockColours>>>; pieces?: Readonly<Record<string, BlockColours>> };
}

// Pieces most themes offer besides their own.
const COMMON = ['leafy-plant', 'small-plant', 'standing-lamp', 'rug', 'oval-rug', 'picture', 'small-picture', 'bookshelf', 'side-table', 'whiteboard'];

export const THEME_LOOKS: Readonly<Record<Theme, ThemeLook>> = {
  office: {
    id: 'office',
    name: 'Classic office',
    sentence: 'Pale carpet tiles, a reception desk and a water cooler by the door: the default for any project.',
    floor: { pattern: 'carpet-tiles', colour: '#E3DCCF', second: '#D3CABB' },
    wall: '#F3F0EA',
    accent: '#8FAE96',
    frontDesk: 'reception-desk',
    hero: ['water-cooler', 'coat-rack'],
    decor: ['water-cooler', 'coat-rack', ...COMMON, 'armchair', 'sofa', 'coffee-table', 'bookcase', 'cabinet', 'kanban-board', 'printer', 'cactus', 'wide-picture'],
    recolour: {
      packs: {
        'furniture-bits': { r1c0: '#D5C6AE', r1c2: '#9FB4C7' },
        'restaurant-bits': { r3c6: '#8FAE96', r1c2: '#F1EADC' },
      },
      pieces: { 'cafe-chair': { r3c6: '#B98A5E' }, 'cafe-table': { r3c6: '#F2EBDD' } },
    },
  },
  cafe: {
    id: 'cafe',
    name: 'Café',
    sentence: 'Black and white checks, an espresso counter and a chalkboard menu, for food and drink.',
    floor: { pattern: 'checks', colour: '#F1EADC', second: '#2E3833' },
    wall: '#F1EADC',
    accent: '#B98A5E',
    frontDesk: 'espresso-counter',
    hero: ['chalkboard-menu', 'pastry-case'],
    decor: ['chalkboard-menu', 'pastry-case', ...COMMON, 'cafe-table', 'cafe-chair', 'stool', 'kitchen-counter', 'kitchen-sink', 'fridge', 'coffee-machine', 'sofa', 'armchair'],
    recolour: {
      packs: {
        'furniture-bits': { r1c0: '#C98E6B', r1c2: '#7C9A8A' },
        'restaurant-bits': { r3c6: '#B98A5E', r1c2: '#E9DCC4' },
      },
      pieces: { 'cafe-table': { r3c6: '#2E3833' } },
    },
  },
  'game-studio': {
    id: 'game-studio',
    name: 'Game studio',
    sentence: 'Dark boards, a counter under the studio mascot and a playtest sofa before a big screen, for games.',
    floor: { pattern: 'boards', colour: '#5A4A40', second: '#4A3C34' },
    wall: '#E9E4DA',
    accent: '#5C6B8A',
    frontDesk: 'mascot-counter',
    hero: ['big-screen', 'sofa', 'concept-board'],
    decor: ['big-screen', 'concept-board', ...COMMON, 'sofa', 'armchair', 'coffee-table', 'arcade-cabinet', 'small-shelf', 'kanban-board', 'wide-picture'],
    recolour: {
      packs: { 'furniture-bits': { r1c0: '#C9705B', r1c2: '#5C6B8A' }, 'restaurant-bits': { r3c6: '#5C6B8A', r1c2: '#E4DED3' } },
      pieces: { 'cafe-chair': { r3c6: '#C9705B' }, 'cafe-table': { r3c6: '#E9E4DA' } },
    },
  },
  shop: {
    id: 'shop',
    name: 'Shop',
    sentence: 'Light oak, a till at the front and parcel shelves by a packing bench, for stores and marketplaces.',
    floor: { pattern: 'oak', colour: '#D9B98F', second: '#C9A27C' },
    wall: '#F6F1E7',
    accent: '#C9B79C',
    frontDesk: 'till',
    hero: ['parcel-shelves', 'packing-bench'],
    decor: ['parcel-shelves', 'packing-bench', ...COMMON, 'crate', 'cabinet', 'low-cabinet', 'work-table', 'stool', 'printer'],
    recolour: {
      packs: { 'furniture-bits': { r1c0: '#C9B79C', r1c2: '#8FA7A0' }, 'restaurant-bits': { r0c6: '#C9B79C', r3c6: '#8FA7A0', r1c2: '#F1EADC' } },
      pieces: { 'cafe-table': { r3c6: '#E3C9A2' } },
    },
  },
  lab: {
    id: 'lab',
    name: 'Lab',
    sentence: 'White tiles with blue lines, a badge desk and a server rack that blinks while people work, for AI and data.',
    floor: { pattern: 'tiles', colour: '#F4F5F2', second: '#9DB8C2' },
    wall: '#F4F5F2',
    accent: '#9DB8C2',
    frontDesk: 'badge-desk',
    hero: ['server-rack'],
    decor: ['server-rack', ...COMMON, 'work-table', 'long-table', 'stool', 'cabinet', 'kanban-board', 'printer', 'cactus'],
    recolour: {
      packs: { 'furniture-bits': { r1c0: '#C5D3D8', r1c2: '#9DB8C2', r0c0: '#B8C2C4' }, 'restaurant-bits': { r3c6: '#9DB8C2', r1c2: '#E6EBEA' } },
      pieces: { 'cafe-table': { r3c6: '#F4F5F2' } },
    },
  },
  garden: {
    id: 'garden',
    name: 'Garden',
    sentence: 'Grass with a stone path, a potting bench and planters under a greenhouse arch, for plants and the outdoors.',
    floor: { pattern: 'grass', colour: '#A9C48A', second: '#C7B9A6' },
    wall: '#EFEADF',
    accent: '#7E9A5E',
    frontDesk: 'potting-bench',
    hero: ['greenhouse-arch', 'planter'],
    decor: ['greenhouse-arch', 'planter', ...COMMON, 'cactus', 'small-cactus', 'bench', 'crate', 'stool'],
    recolour: {
      packs: { 'furniture-bits': { r1c0: '#D9C9A0', r1c2: '#7E9A5E' }, 'restaurant-bits': { r0c6: '#A8865E', r3c6: '#7E9A5E', r1c2: '#EFEADF' } },
      pieces: { 'cafe-table': { r3c6: '#D9C9A0' } },
    },
  },
  city: {
    id: 'city',
    name: 'City',
    sentence: 'Street tiles round the rooms, a kiosk, a bus stop and street lamps, for travel, maps and local services.',
    floor: { pattern: 'street', colour: '#C9C4BA', second: '#A8A39A' },
    wall: '#E9E2D6',
    accent: '#5E7D8C',
    frontDesk: 'kiosk',
    hero: ['bus-stop', 'street-lamp'],
    decor: ['bus-stop', 'street-lamp', 'bench', ...COMMON, 'cactus', 'planter', 'kanban-board'],
    recolour: {
      packs: { 'furniture-bits': { r1c0: '#C9B79C', r1c2: '#5E7D8C' }, 'restaurant-bits': { r3c6: '#5E7D8C', r1c2: '#E9E2D6' } },
      pieces: { 'cafe-table': { r3c6: '#C9C4BA' } },
    },
  },
  arcade: {
    id: 'arcade',
    name: 'Arcade',
    sentence: 'Dark star carpet, a prize counter and a row of arcade cabinets under neon, for games rooms and retro games.',
    floor: { pattern: 'stars', colour: '#2F2A3D', second: '#6C5A9E' },
    wall: '#3A3448',
    accent: '#D65DB1',
    frontDesk: 'prize-counter',
    hero: ['arcade-cabinet', 'neon-sign'],
    decor: ['arcade-cabinet', 'neon-sign', 'big-screen', 'sofa', 'coffee-table', 'stool', 'leafy-plant', 'rug', 'small-picture'],
    recolour: {
      packs: { 'furniture-bits': { r1c0: '#D65DB1', r1c2: '#4FA3B8' }, 'restaurant-bits': { r3c6: '#6C5A9E', r1c2: '#4FA3B8' } },
      pieces: { 'cafe-chair': { r3c6: '#D65DB1' } },
    },
  },
  'music-studio': {
    id: 'music-studio',
    name: 'Music studio',
    sentence: 'Dark wood and rugs, a gear counter, a mixing desk between speakers and a vocal booth, for music and audio.',
    floor: { pattern: 'dark-wood', colour: '#4A3A30', second: '#3A2D25' },
    wall: '#E6DED2',
    accent: '#9A5A44',
    frontDesk: 'gear-counter',
    hero: ['mixing-desk', 'speaker', 'vocal-booth'],
    decor: ['mixing-desk', 'speaker', 'vocal-booth', ...COMMON, 'sofa', 'armchair', 'striped-rug', 'small-shelf', 'stool'],
    recolour: {
      packs: { 'furniture-bits': { r1c0: '#9A5A44', r1c2: '#5C6B8A' }, 'restaurant-bits': { r3c6: '#9A5A44', r1c2: '#E6DED2' } },
      pieces: { 'cafe-table': { r3c6: '#C9B79C' } },
    },
  },
};

export interface RoomFurniture {
  kind: RoomKind;
  /** Sentence case: "Meeting room". */
  title: string;
  furniture: readonly { piece: string; count: number }[];
}

export const ROOM_FURNITURE: Readonly<Record<RoomKind, RoomFurniture>> = {
  meeting: {
    kind: 'meeting',
    title: 'Meeting room',
    furniture: [
      { piece: 'long-table', count: 1 },
      { piece: 'chair', count: 6 },
      { piece: 'meeting-screen', count: 1 },
      { piece: 'milestone-board', count: 1 },
      { piece: 'leafy-plant', count: 1 },
    ],
  },
  ceo: {
    kind: 'ceo',
    title: "CEO's office",
    furniture: [
      { piece: 'lead-desk', count: 1 },
      { piece: 'desk-chair', count: 1 },
      { piece: 'monitor', count: 1 },
      { piece: 'keyboard', count: 1 },
      { piece: 'org-board', count: 1 },
      { piece: 'visitor-chair', count: 1 },
      { piece: 'armchair', count: 1 },
      { piece: 'standing-lamp', count: 1 },
      { piece: 'bookcase', count: 1 },
      { piece: 'striped-rug', count: 1 },
      { piece: 'small-picture', count: 1 },
    ],
  },
  reception: {
    kind: 'reception',
    title: 'Reception',
    furniture: [
      { piece: 'sofa', count: 1 },
      { piece: 'visitor-chair', count: 2 },
      { piece: 'side-table', count: 1 },
      { piece: 'rug', count: 1 },
      { piece: 'leafy-plant', count: 2 },
    ],
  },
  lounge: {
    kind: 'lounge',
    title: 'Lounge',
    furniture: [
      { piece: 'sofa', count: 1 },
      { piece: 'armchair', count: 2 },
      { piece: 'coffee-table', count: 1 },
      { piece: 'oval-rug', count: 1 },
      { piece: 'standing-lamp', count: 1 },
      { piece: 'bookshelf', count: 1 },
      { piece: 'leafy-plant', count: 1 },
    ],
  },
  games: {
    kind: 'games',
    title: 'Games room',
    furniture: [
      { piece: 'arcade-cabinet', count: 3 },
      { piece: 'big-screen', count: 1 },
      { piece: 'sofa', count: 1 },
      { piece: 'coffee-table', count: 1 },
      { piece: 'rug', count: 1 },
    ],
  },
  kitchen: {
    kind: 'kitchen',
    title: 'Kitchen',
    furniture: [
      { piece: 'kitchen-counter', count: 2 },
      { piece: 'kitchen-sink', count: 1 },
      { piece: 'fridge', count: 1 },
      { piece: 'coffee-machine', count: 1 },
      { piece: 'cafe-table', count: 1 },
      { piece: 'cafe-chair', count: 3 },
    ],
  },
};

const BY_ID: ReadonlyMap<string, Piece> = new Map(PIECES.map((p) => [p.id, p]));

/** The piece with this id, or undefined for an id the office can't draw. */
export function pieceOf(id: string): Piece | undefined {
  return BY_ID.get(id);
}

/** A piece's title for the panels, or null for an id the office can't draw. */
export function pieceTitle(id: string): string | null {
  return BY_ID.get(id)?.title ?? null;
}

export function themeLook(theme: Theme): ThemeLook {
  return THEME_LOOKS[theme];
}

/** The decor Customize offers for a theme, in its order. */
export function decorOf(theme: Theme): Piece[] {
  return THEME_LOOKS[theme].decor.flatMap((id) => BY_ID.get(id) ?? []);
}

/** A room's furniture; reception also gets its theme's front desk, first. */
export function furnitureOf(kind: RoomKind, theme: Theme): RoomFurniture['furniture'] {
  const { furniture } = ROOM_FURNITURE[kind];
  return kind === 'reception' ? [{ piece: THEME_LOOKS[theme].frontDesk, count: 1 }, ...furniture] : furniture;
}

/** The block colours a theme gives one piece: its pack's swap, then the piece's own, which wins. */
export function blockColours(theme: Theme, pieceId: string): BlockColours {
  const p = BY_ID.get(pieceId);
  if (!p || p.draw.from !== 'pack') return {};
  const { packs, pieces } = THEME_LOOKS[theme].recolour;
  return { ...packs[p.draw.pack], ...pieces?.[pieceId] };
}

/** The pieces of a pack anything in the office uses, by their names in the pack, sorted: what the art build exports. */
export function packPieces(of: ArtPack): string[] {
  const names = PIECES.flatMap((p) => (p.draw.from === 'pack' && p.draw.pack === of ? [p.draw.piece] : []));
  return [...new Set(names)].sort();
}
