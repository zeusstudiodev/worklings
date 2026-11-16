// Pieces around the office the free packs lack, made here in KayKit's style: plants, boards, the meeting room's table
// and screen, the water cooler, a coat rack, the coffee machine, a printer, windows of sky, paintings for KayKit's
// empty frames and the rules' posters. Floor pieces stand on y = 0 facing +z; wall pieces have their back on z = 0
// and their bottom edge on y = 0.
import type { BufferGeometry } from 'three';
import { DEPARTMENT_HUE } from '../palette.ts';
import { CELL } from './atlas.ts';
import { shadeHex, tintHex } from './colour.ts';
import { Glow, Shape } from './shape.ts';

/** What a made piece adds to the buckets, in its own space. */
export interface Built {
  /** Sampling the Furniture Bits atlas. */
  solid: BufferGeometry | null;
  /** Glowing: the emissive bucket. */
  glow?: BufferGeometry | null;
  /** Soft light on the floor or a halo, at most 0.15 over pastel floors. */
  lights?: Light[];
}

export interface Light {
  x: number;
  y: number;
  z: number;
  /** Size on the floor (or of the halo). */
  sx: number;
  sz: number;
  colour: string;
  strength: number;
  /** Faces the camera instead of lying flat. */
  halo?: boolean;
  /** Stays on at night: the front desk's lamp (docs/game-feel.md, section 4). Every other light dims. */
  stays?: boolean;
}

const POTS = ['#E2DCCF', '#C97F5B', '#E9A36B', '#8E9AA0', '#F1EADC'];
export const potColour = (seed: number): string => POTS[Math.abs(seed) % POTS.length] ?? '#E2DCCF';

/** A big leafy plant in a pot: KayKit's free tier only has cacti. */
export function leafyPlant(pot: string, seed: number, scale = 1): Built {
  const s = new Shape(2.0 * scale, 0);
  s.cyl(0.36 * scale, 0.28 * scale, 0.6 * scale, 0, 0.3 * scale, 0, CELL.white, { color: pot, sides: 10, span: 0.7 });
  s.cyl(0.33 * scale, 0.33 * scale, 0.04 * scale, 0, 0.6 * scale, 0, CELL.bark, { sides: 10, span: 0.4 });
  s.box(0.06 * scale, 0.6 * scale, 0.06 * scale, 0, 0.9 * scale, 0, CELL.bark, { r: 0.02 });
  const leaves = 8;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + seed;
    const up = (0.95 + ((i * 37 + seed * 11) % 5) * 0.12) * scale;
    const out = (0.22 + ((i * 13) % 3) * 0.08) * scale;
    s.ball(0.26 * scale, Math.cos(a) * out, up, Math.sin(a) * out, i % 3 === 0 ? CELL.leafLight : CELL.leaf, {
      sx: 0.62,
      sy: 0.22,
      sz: 1.0,
      detail: 6,
      rot: [-0.5 - (i % 2) * 0.25, -a + Math.PI / 2, 0],
      span: 0.8,
    });
  }
  return { solid: s.build() };
}

/** A small plant in a pot, for desks, counters and shelves. */
export function smallPlant(pot: string, seed: number): Built {
  const s = new Shape(0.62, 0);
  s.cyl(0.14, 0.11, 0.2, 0, 0.1, 0, CELL.white, { color: pot, sides: 8, span: 0.6 });
  s.cyl(0.125, 0.125, 0.02, 0, 0.2, 0, CELL.bark, { sides: 8, span: 0.3 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + seed;
    s.ball(0.11, Math.cos(a) * 0.08, 0.32 + (i % 2) * 0.07, Math.sin(a) * 0.08, i % 2 ? CELL.leaf : CELL.leafLight, {
      sx: 0.6,
      sy: 0.25,
      sz: 1,
      detail: 5,
      rot: [-0.7, -a + Math.PI / 2, 0],
      span: 0.7,
    });
  }
  return { solid: s.build() };
}

/** Legs for a board that stands instead of hanging: two posts on feet. */
function standOn(s: Shape, w: number, bottom: number, h: number) {
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) {
    s.box(0.07, bottom + h * 0.85, 0.07, x, (bottom + h * 0.85) / 2, -0.06, CELL.steel, { r: 0.02 });
    s.box(0.1, 0.05, 0.6, x, 0.025, -0.06, CELL.steel, { r: 0.02 });
  }
}

/** A whiteboard: frame, board and marker tray. `bottom` is how high its lower edge stands when it has legs. */
export function whiteboard(w: number, h: number, stand: number | null = null): Built {
  const lift = stand ?? 0;
  const s = new Shape(lift + h, 0);
  if (stand !== null) standOn(s, w, stand, h);
  s.box(w, h, 0.08, 0, lift + h / 2, 0.04, CELL.steel, { r: 0.03, span: 0.5 });
  s.box(w - 0.12, h - 0.12, 0.02, 0, lift + h / 2, 0.085, CELL.paper, { r: 0.004, span: 0.25 });
  s.box(w * 0.42, 0.05, 0.14, 0, lift + 0.04, 0.12, CELL.steel, { r: 0.015 });
  ['#D9625B', '#5B8FC7', '#2E3833'].forEach((c, i) => s.box(0.14, 0.035, 0.035, -0.3 + i * 0.22, lift + 0.085, 0.13, CELL.white, { color: c, r: 0.01 }));
  return { solid: s.build() };
}

/** The org as the CEO's board shows it: a card per room's head in its hue, a pin per person under it. */
export interface Chart {
  /** The CEO's own colour on the board. */
  top: string;
  /** Rooms left to right: their hue, whether a head sits there, and how many more people. */
  rooms: { hue: string; head: boolean; people: number }[];
}

/** The CEO's org board, with the org drawn on it from the floor plan, or blank for the moments to pin it on. */
export function orgBoard(w: number, h: number, chart: Chart | null, stand: number | null): Built {
  const lift = stand ?? 0;
  const s = new Shape(lift + h, 0);
  if (stand !== null) standOn(s, w, stand, h);
  s.box(w, h, 0.08, 0, lift + h / 2, 0.04, CELL.steel, { r: 0.03, span: 0.5 });
  s.box(w - 0.12, h - 0.12, 0.02, 0, lift + h / 2, 0.085, CELL.paper, { r: 0.004, span: 0.25 });
  s.box(w * 0.42, 0.05, 0.14, 0, lift + 0.04, 0.12, CELL.steel, { r: 0.015 });
  if (!chart) return { solid: s.build() };
  const ink = '#36424A';
  const z = 0.098;
  const card = (x: number, y: number, cw: number, color: string) => {
    s.box(cw, 0.2, 0.012, x, y, z, CELL.white, { color: tintHex(color, 0.35), r: 0.004, span: 0 });
    s.box(cw, 0.025, 0.014, x, y + 0.1, z + 0.002, CELL.white, { color: shadeHex(color, 0.15), span: 0 });
  };
  const top = lift + h * 0.78;
  const mid = lift + h * 0.47;
  card(0, top, 0.46, chart.top);
  const rooms = chart.rooms.slice(0, 8);
  if (rooms.length > 0) {
    const room = Math.min(0.62, (w - 0.4) / rooms.length);
    const cw = Math.min(0.42, room - 0.08);
    const first = -((rooms.length - 1) * room) / 2;
    s.box(0.02, (top - mid) / 2 - 0.06, 0.012, 0, (top + mid) / 2 + (top - mid) / 4 - 0.07, z, CELL.white, { color: ink, span: 0 });
    if (rooms.length > 1) s.box((rooms.length - 1) * room + 0.02, 0.02, 0.012, 0, (top + mid) / 2, z, CELL.white, { color: ink, span: 0 });
    rooms.forEach((r, i) => {
      const x = first + i * room;
      s.box(0.02, (top - mid) / 2 - 0.08, 0.012, x, (top + mid) / 2 - (top - mid) / 4 + 0.03, z, CELL.white, { color: ink, span: 0 });
      if (r.head) card(x, mid, cw, r.hue);
      else s.box(cw, 0.03, 0.012, x, mid, z, CELL.white, { color: r.hue, span: 0 });
      // A pin per person, in rows of four under the head's card.
      for (let p = 0; p < Math.min(12, r.people); p++) {
        const col = p % 4;
        const row = Math.floor(p / 4);
        s.box(0.07, 0.07, 0.014, x - 0.135 + col * 0.09, mid - 0.2 - row * 0.1, z, CELL.white, { color: r.hue, r: 0.005, span: 0 });
      }
    });
  }
  return { solid: s.build() };
}

/** The meeting room's milestone board: a cork board with a header in the theme's accent. The cards are the moments'. */
export function milestoneBoard(w: number, h: number, accent: string, stand: number | null): Built {
  const lift = stand ?? 0;
  const s = new Shape(lift + h, 0);
  if (stand !== null) standOn(s, w, stand, h);
  s.box(w, h, 0.08, 0, lift + h / 2, 0.04, CELL.wood, { r: 0.03, span: 0.5 });
  s.box(w - 0.12, h - 0.12, 0.02, 0, lift + h / 2, 0.085, CELL.tan, { r: 0.004, span: 0.3 });
  s.box(w - 0.12, 0.12, 0.024, 0, lift + h - 0.12, 0.088, CELL.white, { color: accent, r: 0.004, span: 0 });
  return { solid: s.build() };
}

/**
 * The office screen on the meeting room's back wall: a slim black frame on a stand, its face glowing so it is the
 * brightest thing in the office. The label layer lays the app's screenshot or name over the face (screen.ts).
 */
export function meetingScreen(w: number, h: number, stand: number | null): Built {
  const lift = stand ?? 0;
  const s = new Shape(lift + h, 0);
  if (stand !== null) {
    s.box(0.14, lift + h * 0.4, 0.1, 0, (lift + h * 0.4) / 2, -0.05, CELL.ink, { r: 0.03, span: 0.4 });
    s.box(1.0, 0.06, 0.5, 0, 0.03, -0.05, CELL.ink, { r: 0.02, span: 0.4 });
  }
  s.box(w, h, 0.1, 0, lift + h / 2, 0.05, CELL.ink, { r: 0.03, span: 0.35 });
  const glow = new Glow().quad(w - 0.12, h - 0.12, 0, lift + h / 2, 0.104, { color: '#F4F8F6', bottom: '#E3ECEA' }).build();
  return { solid: s.build(), glow };
}

/** A kanban board on legs: to do, doing, done. */
export function kanbanBoard(): Built {
  const s = new Shape(2.1, 0);
  for (const x of [-0.9, 0.9]) s.box(0.07, 1.9, 0.07, x, 0.95, 0, CELL.steel, { r: 0.02 });
  s.box(2.0, 1.2, 0.06, 0, 1.45, 0, CELL.paper, { r: 0.03, span: 0.3 });
  for (const x of [-0.33, 0.33]) s.box(0.015, 1.08, 0.01, x, 1.45, 0.035, CELL.white, { color: '#B7C0BC', span: 0 });
  const notes: [number, string[]][] = [
    [-0.66, ['#F6B3C1', '#9EC3EA', '#F6B3C1']],
    [0, ['#9EC3EA', '#F6B3C1']],
    [0.66, ['#A8D8A0', '#A8D8A0', '#A8D8A0', '#A8D8A0']],
  ];
  for (const [x, colors] of notes) {
    colors.forEach((c, i) => {
      const nx = colors.length > 2 ? x + ((i % 2) - 0.5) * 0.26 : x;
      const ny = 1.86 - Math.floor(i / (colors.length > 2 ? 2 : 1)) * 0.25;
      s.box(0.24, 0.2, 0.012, nx, ny, 0.04, CELL.white, { color: c, r: 0.004, span: 0 });
    });
  }
  return { solid: s.build() };
}

export function waterCooler(): Built {
  const s = new Shape(1.6, 0);
  s.box(0.56, 0.95, 0.52, 0, 0.475, 0, CELL.white, { r: 0.05 });
  s.box(0.2, 0.08, 0.06, 0, 0.72, 0.28, CELL.ink, { r: 0.02 });
  s.box(0.28, 0.04, 0.12, 0, 0.5, 0.29, CELL.steel, { r: 0.01 });
  s.cyl(0.21, 0.21, 0.5, 0, 1.22, 0, CELL.sky, { sides: 12, span: 0.6 });
  s.cyl(0.1, 0.16, 0.1, 0, 1.0, 0, CELL.sky, { sides: 12, span: 0.6 });
  // A stack of paper cups beside the tap.
  s.cyl(0.05, 0.04, 0.16, 0.2, 1.03, 0.16, CELL.paper, { sides: 8 });
  return { solid: s.build() };
}

/** A coat rack with a coat and a scarf on it. */
export function coatRack(seed: number): Built {
  const s = new Shape(2.0, 0);
  s.cyl(0.26, 0.3, 0.06, 0, 0.03, 0, CELL.wood, { sides: 10 });
  s.cyl(0.04, 0.05, 1.9, 0, 0.98, 0, CELL.wood, { sides: 8 });
  s.ball(0.07, 0, 1.95, 0, CELL.wood, { detail: 6 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    s.box(0.24, 0.04, 0.04, Math.cos(a) * 0.1, 1.76, Math.sin(a) * 0.1, CELL.wood, { r: 0.012, rot: [0, -a, 0.5] });
  }
  const coats = ['#5C6B8A', '#C9705B', '#8FAE96', '#E2BF4F'];
  const coat = coats[seed % coats.length] ?? '#5C6B8A';
  s.box(0.46, 0.86, 0.22, 0.05, 1.3, 0.16, CELL.white, { color: coat, r: 0.08, rot: [0.08, 0.3, 0] });
  s.box(0.1, 0.62, 0.08, -0.16, 1.4, -0.12, CELL.white, { color: coats[(seed + 1) % coats.length] ?? '#C9705B', r: 0.03 });
  return { solid: s.build() };
}

/** An espresso machine: brushed steel and black, a cup under the spout, a green ready light. */
export function coffeeMachine(): Built {
  const s = new Shape(0.75, 0);
  s.box(0.56, 0.6, 0.46, 0, 0.3, 0, CELL.steel, { r: 0.06, span: 0.7, color: '#D9DEE0' });
  s.box(0.58, 0.1, 0.48, 0, 0.62, 0, CELL.ink, { r: 0.03, span: 0.3 });
  s.box(0.44, 0.2, 0.06, 0, 0.42, 0.235, CELL.ink, { r: 0.02, span: 0.3 });
  s.box(0.36, 0.04, 0.2, 0, 0.04, 0.3, CELL.ink, { r: 0.015, span: 0.3 });
  s.box(0.1, 0.07, 0.1, 0, 0.27, 0.27, CELL.ink, { r: 0.02, span: 0.3 });
  s.cyl(0.055, 0.05, 0.11, 0, 0.115, 0.3, CELL.white, { sides: 10 });
  const glow = new Glow().disc(0.026, 0.15, 0.45, 0.267, { color: '#7CF0B4' }).build();
  return { solid: s.build(), glow };
}

/** A floor printer on its cabinet: paper in the tray, a ready light. */
export function printer(): Built {
  const s = new Shape(1.25, 0);
  s.box(0.92, 0.66, 0.72, 0, 0.33, 0, CELL.white, { r: 0.05, color: '#E8ECEA' });
  s.box(0.96, 0.46, 0.76, 0, 0.9, 0, CELL.white, { r: 0.06, color: '#F4F6F4' });
  s.box(0.6, 0.06, 0.3, -0.06, 1.16, 0.04, CELL.ink, { r: 0.02 });
  s.box(0.5, 0.025, 0.36, -0.06, 0.74, 0.42, CELL.paper, { r: 0.006, span: 0.2 });
  s.box(0.22, 0.12, 0.03, 0.3, 1.0, 0.385, CELL.ink, { r: 0.015 });
  for (const y of [0.48, 0.22]) s.box(0.5, 0.03, 0.02, 0, y, 0.365, CELL.steel, { r: 0.008 });
  const glow = new Glow().quad(0.16, 0.07, 0.3, 1.0, 0.402, { color: '#7FE0C8' }).build();
  return { solid: s.build(), glow };
}

/** A window on an outer wall: frame, sill and panes of sky, glowing so the room reads as daylit. */
export function windowPiece(w: number, h: number): Built {
  const s = new Shape(h, 0);
  s.box(w + 0.16, 0.12, 0.26, 0, -0.04, 0.1, CELL.white, { r: 0.03 });
  s.box(w, 0.1, 0.1, 0, h - 0.05, 0.03, CELL.white, { r: 0.02 });
  s.box(0.1, h, 0.1, -w / 2 + 0.05, h / 2, 0.03, CELL.white, { r: 0.02 });
  s.box(0.1, h, 0.1, w / 2 - 0.05, h / 2, 0.03, CELL.white, { r: 0.02 });
  s.box(0.06, h, 0.06, 0, h / 2, 0.035, CELL.white, { r: 0.015 });
  s.box(w, 0.06, 0.06, 0, h * 0.55, 0.035, CELL.white, { r: 0.015 });
  const glow = new Glow().quad(w - 0.12, h - 0.1, 0, h / 2, 0.012, { color: '#9CCBEA', bottom: '#EAF0E6' }).build();
  return { solid: s.build(), glow };
}

/** A small abstract painting for one of KayKit's empty frames, in the office's colours. */
export function artwork(w: number, h: number, seed: number): BufferGeometry {
  const s = new Shape(1, 0);
  const pick = (xs: readonly string[], k: number) => xs[(seed + k) % xs.length] ?? xs[0] ?? '#F3EDE2';
  s.box(w, h, 0.012, 0, 0, 0, CELL.white, { color: pick(['#F3EDE2', '#E9F0F4', '#F6E7DF', '#ECEFE6'], 0), span: 0 });
  const kind = seed % 3;
  if (kind === 0) {
    s.box(w, h * 0.42, 0.014, 0, -h * 0.29, 0.003, CELL.white, { color: pick(['#8DBF84', '#7FAE8F', '#A7C77A'], 1), span: 0 });
    s.box(w, h * 0.3, 0.013, 0, h * 0.35, 0.002, CELL.white, { color: '#BFDCEC', span: 0 });
    s.cyl(Math.min(w, h) * 0.13, Math.min(w, h) * 0.13, 0.016, w * 0.22, h * 0.12, 0.004, CELL.white, { color: '#F2C14E', rot: [Math.PI / 2, 0, 0], sides: 10, span: 0 });
  } else if (kind === 1) {
    s.box(w * 0.8, h * 0.4, 0.014, 0, h * 0.2, 0.003, CELL.white, { color: pick([DEPARTMENT_HUE.design, DEPARTMENT_HUE.art, DEPARTMENT_HUE.direction, DEPARTMENT_HUE.engineering], 2), span: 0 });
    s.box(w * 0.8, h * 0.28, 0.014, 0, -h * 0.22, 0.003, CELL.white, { color: pick(['#2F3A36', '#3B4A5C', '#6FAE6A'], 3), span: 0 });
  } else {
    s.cyl(Math.min(w, h) * 0.26, Math.min(w, h) * 0.26, 0.016, -w * 0.14, h * 0.08, 0.004, CELL.white, { color: pick(['#E58FA0', '#5B8FC7', '#F2C14E'], 4), rot: [Math.PI / 2, 0, 0], sides: 12, span: 0 });
    s.box(w * 0.34, h * 0.5, 0.015, w * 0.2, -h * 0.12, 0.005, CELL.white, { color: pick(['#3B4A5C', '#6FAE6A', '#8E7CC3'], 5), span: 0 });
  }
  return s.build();
}

/** A rule's poster on a room's back wall (v2's posters): a sheet with a band in the room's hue and lines of text. */
export function poster(hue: string): Built {
  const s = new Shape(1.15, 0);
  s.box(0.9, 1.15, 0.03, 0, 0.575, 0.015, CELL.paper, { r: 0.01, span: 0.15 });
  s.box(0.7, 0.16, 0.012, 0, 0.98, 0.034, CELL.white, { color: hue, span: 0 });
  [0.72, 0.56, 0.4, 0.24].forEach((y, i) => s.box(i === 3 ? 0.4 : 0.66, 0.045, 0.01, i === 3 ? -0.13 : 0, y, 0.034, CELL.white, { color: '#B9B4AA', span: 0 }));
  return { solid: s.build() };
}

/** The meeting room's long table, sized to the floor plan's: a birch top on two slab legs, like the desks. */
export function meetingTable(w: number, d: number): Built {
  const s = new Shape(0.98);
  s.box(w, 0.1, d, 0, 0.87, 0, CELL.birch, { r: 0.05 });
  for (const x of [-w / 2 + 0.5, w / 2 - 0.5]) {
    s.box(0.14, 0.82, d - 0.5, x, 0.41, 0, CELL.white, { r: 0.04 });
    s.box(0.3, 0.06, d - 0.3, x, 0.03, 0, CELL.white, { r: 0.02 });
  }
  s.box(w - 1.1, 0.08, 0.1, 0, 0.62, 0, CELL.white, { r: 0.02 });
  // Something on the table: a laptop closed, two mugs, a notepad.
  s.box(0.56, 0.05, 0.4, -w / 4, 0.945, 0.1, CELL.steel, { r: 0.015 });
  s.cyl(0.07, 0.065, 0.14, w / 5, 0.99, -0.2, CELL.white, { color: '#F4F0E8', sides: 10 });
  s.cyl(0.07, 0.065, 0.14, w / 5 + 0.3, 0.99, 0.25, CELL.white, { color: '#5B8FC7', sides: 10 });
  s.box(0.3, 0.02, 0.4, w / 3, 0.93, 0.05, CELL.paper, { r: 0.004, span: 0.1 });
  return { solid: s.build() };
}
