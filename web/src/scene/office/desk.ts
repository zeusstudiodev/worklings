// The desk set the free packs lack, made here in KayKit's style: desks (a person's and the CEO's wider one), the
// monitor with its screen, keyboard and mouse, the note tray, the office chair in the room's colour and a desk lamp.
// Local space: the person sits on the -z side facing +z (the camera's side); the monitor stands at +z facing them.
// The layout keeps the desk's front left corner for the first-day plant and its back left for cups (game-feel.md),
// so nothing here goes there.
import type { BufferGeometry } from 'three';
import { CELL } from './atlas.ts';
import { tintHex } from './colour.ts';
import { Glow, Shape, type Tile } from './shape.ts';

/** The desk top's height: the layout's COMPANY_DESK.top, where everything on a desk stands. */
export const DESK_TOP = 0.92;
/** Where things stand on a desk, in its local space. */
export const ON_DESK = {
  monitor: { x: 0, z: 0.28 },
  keyboard: { x: -0.08, z: -0.17 },
  /** The far right corner: books, a frame, a cactus or a lamp. */
  corner: { x: 0.72, z: 0.3 },
} as const;
/** How far the chair stands behind the desk's middle: the person's seat (1.02) and a little. */
export const CHAIR_BACK = 1.08;

/** A person's desk: a birch top on white slab legs, a modesty panel, a drawer pedestal in the room's tint. */
export function desk(w: number, d: number, hue: string, variant: number): BufferGeometry {
  const s = new Shape(0.98);
  s.box(w, 0.1, d, 0, 0.87, 0, CELL.birch, { r: 0.045 });
  const leg = w / 2 - 0.09;
  s.box(0.12, 0.82, d - 0.1, -leg, 0.41, 0, CELL.white, { r: 0.04 });
  s.box(0.12, 0.82, d - 0.1, leg, 0.41, 0, CELL.white, { r: 0.04 });
  s.box(w - 0.3, 0.42, 0.06, 0, 0.6, d / 2 - 0.1, CELL.white, { r: 0.02 });
  const side = variant % 2 === 0 ? 1 : -1;
  const px = side * (w / 2 - 0.43);
  s.box(0.46, 0.66, d - 0.22, px, 0.38, 0.02, CELL.white, { r: 0.04, color: tintHex(hue, 0.45) });
  for (const y of [0.56, 0.32]) s.box(0.36, 0.035, 0.02, px, y, -(d - 0.22) / 2 + 0.01, CELL.ink, { r: 0.008 });
  return s.build();
}

/** The CEO's desk: a walnut top over a panelled front and a pedestal at each end. */
export function leadDesk(w: number, d: number): BufferGeometry {
  const s = new Shape(0.98);
  s.box(w, 0.11, d, 0, 0.865, 0, CELL.wood, { r: 0.05 });
  for (const sx of [-1, 1]) {
    s.box(0.62, 0.8, d - 0.12, sx * (w / 2 - 0.36), 0.4, 0, CELL.birch, { r: 0.045 });
    for (const y of [0.62, 0.4, 0.18]) s.box(0.42, 0.03, 0.02, sx * (w / 2 - 0.36), y, -(d - 0.12) / 2 - 0.005, CELL.ink, { r: 0.008 });
  }
  s.box(w - 1.3, 0.5, 0.07, 0, 0.55, d / 2 - 0.12, CELL.birch, { r: 0.025 });
  return s.build();
}

/** A chunky monitor on a stand, its back to the camera; the screen is `monitorScreen`, in the glowing bucket. */
export function monitor(): BufferGeometry {
  const s = new Shape(0.84, 0);
  s.box(0.42, 0.04, 0.26, 0, 0.02, 0.0, CELL.ink, { r: 0.015, span: 0.4 });
  s.box(0.08, 0.34, 0.06, 0, 0.18, 0.04, CELL.ink, { r: 0.02, span: 0.4 });
  s.box(0.94, 0.6, 0.09, 0, 0.52, 0, CELL.ink, { r: 0.045, span: 0.5 });
  // A rounded back panel, so the side the camera sees isn't a flat slab.
  s.box(0.6, 0.36, 0.05, 0, 0.5, 0.06, CELL.ink, { r: 0.02, span: 0.3 });
  return s.build();
}

/** The monitor's screen, facing the person (-z), in the monitor's space. */
export function monitorScreen(tile: Tile, color = '#ffffff'): BufferGeometry | null {
  return new Glow().quad(0.84, 0.5, 0, 0.52, -0.047, { tile, color, rot: [0, Math.PI, 0] }).build();
}

/** A keyboard with an inset key bed, and a mouse to its right. */
export function keyboard(): BufferGeometry {
  const s = new Shape(0.06, 0);
  s.box(0.7, 0.045, 0.24, 0, 0.0225, 0, CELL.paper, { r: 0.018 });
  s.box(0.62, 0.02, 0.16, 0, 0.047, 0.005, CELL.frost, { r: 0.006 });
  s.ball(0.055, 0.46, 0.028, 0.01, CELL.paper, { sy: 0.55, sz: 1.35, detail: 6 });
  return s.build();
}

/** The letter tray where notes wait (game-feel.md, section 1): low, open at the front, on the desk's right. */
export function tray(): BufferGeometry {
  const s = new Shape(0.08, 0);
  s.box(0.36, 0.02, 0.28, 0, 0.01, 0, CELL.steel, { r: 0.006, span: 0.3 });
  s.box(0.36, 0.07, 0.02, 0, 0.035, -0.13, CELL.steel, { r: 0.006, span: 0.3 });
  s.box(0.02, 0.06, 0.28, -0.17, 0.03, 0, CELL.steel, { r: 0.006, span: 0.3 });
  s.box(0.02, 0.06, 0.28, 0.17, 0.03, 0, CELL.steel, { r: 0.006, span: 0.3 });
  return s.build();
}

/** An office chair in the room's colour, facing +z: the person sits on it facing their desk. */
export function officeChair(hue: string): BufferGeometry {
  const s = new Shape(1.25);
  s.box(0.66, 0.13, 0.62, 0, 0.45, 0.02, CELL.white, { r: 0.055, color: hue });
  s.box(0.62, 0.6, 0.11, 0, 0.92, -0.32, CELL.white, { r: 0.05, color: hue, rot: [-0.14, 0, 0] });
  s.box(0.07, 0.34, 0.06, 0, 0.6, -0.31, CELL.ink, { r: 0.02 });
  s.cyl(0.045, 0.045, 0.3, 0, 0.25, 0, CELL.steel, { sides: 6 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    s.box(0.34, 0.05, 0.07, Math.cos(a) * 0.16, 0.09, Math.sin(a) * 0.16, CELL.ink, { r: 0.02, rot: [0, -a, 0] });
    s.ball(0.045, Math.cos(a) * 0.32, 0.045, Math.sin(a) * 0.32, CELL.ink, { detail: 4 });
  }
  return s.build();
}

/** A desk lamp leaning over the desk; its bulb is `lampBulb`, lit while its person works. */
export function deskLamp(shade: string): BufferGeometry {
  const s = new Shape(0.7);
  s.cyl(0.11, 0.13, 0.04, 0, 0.02, 0, CELL.ink, { sides: 10 });
  s.box(0.035, 0.4, 0.035, 0, 0.22, -0.02, CELL.steel, { r: 0.012, rot: [0.25, 0, 0] });
  s.box(0.035, 0.3, 0.035, 0, 0.47, 0.06, CELL.steel, { r: 0.012, rot: [-0.9, 0, 0] });
  s.cyl(0.06, 0.15, 0.16, 0, 0.5, 0.2, CELL.white, { color: shade, sides: 10, rot: [0.6, 0, 0] });
  return s.build();
}

/** The lamp's bulb under its shade, in the lamp's space. */
export function lampBulb(color: string): BufferGeometry | null {
  return new Glow().disc(0.075, 0, 0.44, 0.25, { color, rot: [Math.PI / 2 - 0.6, 0, 0] }).build();
}

/** Books, a standing frame or a small cactus in the desk's far corner come from Furniture Bits; this is the fallback. */
export function deskBooks(seed: number): BufferGeometry {
  const s = new Shape(0.3);
  const colours = ['#C9705B', '#5C6B8A', '#8FAE96', '#E2BF4F', '#9A5A44'];
  for (let i = 0; i < 4; i++) {
    const h = 0.2 + ((seed + i * 7) % 4) * 0.025;
    s.box(0.055, h, 0.2, -0.09 + i * 0.06, h / 2, 0, CELL.white, { r: 0.008, color: colours[(seed + i) % colours.length] ?? '#C9705B', span: 0.4 });
  }
  return s.build();
}
