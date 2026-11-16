// Each theme's front desk (docs/game-feel.md, section 2 and "Themes"): the same place and six places for the people
// who wait there, a different form per theme. Built to the floor plan's counter, `w` along x and `d` deep, its front
// (+z) facing the camera and the people in line behind it (-z). Anything tall stands at the left end: from the
// camera's side, nothing there can come between you and someone waiting with a paper.
import { CELL } from './atlas.ts';
import { shadeHex, tintHex } from './colour.ts';
import type { Built } from './props.ts';
import { Glow, Shape, TILE } from './shape.ts';

/** How high the people in line hold their papers: nothing in front of the counter rises past this. */
export const COUNTER_TOP = 1.06;

function body(s: Shape, w: number, d: number, front: string, top: { cell: (typeof CELL)[keyof typeof CELL]; color?: string }) {
  s.box(w, 0.98, d - 0.08, 0, 0.49, -0.02, CELL.white, { r: 0.05, color: front });
  s.box(w + 0.08, 0.08, d + 0.04, 0, 1.02, 0, top.cell, { r: 0.035, ...(top.color ? { color: top.color } : {}) });
  s.box(w - 0.1, 0.08, 0.06, 0, 0.04, d / 2 - 0.08, CELL.ink, { r: 0.02, span: 0.3 });
}

/** Classic office: a white reception desk with a raised ledge, the theme's sage band and a little plant. */
export function receptionDesk(w: number, d: number, accent: string): Built {
  const s = new Shape(1.3, 0);
  body(s, w, d, '#F4F1EA', { cell: CELL.birch });
  s.box(w - 0.2, 0.12, 0.03, 0, 0.62, d / 2 - 0.04, CELL.white, { color: accent, r: 0.01, span: 0 });
  s.box(w * 0.7, 0.16, 0.3, 0.2, 1.14, d / 2 - 0.15, CELL.birch, { r: 0.03 });
  s.box(0.08, 0.16, 0.24, 0.2 - w * 0.35 + 0.04, 1.14, d / 2 - 0.2, CELL.white, { r: 0.02 });
  // A small plant at the left end and a bell.
  s.cyl(0.13, 0.1, 0.2, -w / 2 + 0.3, 1.16, 0, CELL.white, { color: accent, sides: 8 });
  for (let i = 0; i < 4; i++) s.ball(0.11, -w / 2 + 0.3 + Math.cos(i * 1.6) * 0.07, 1.36 + (i % 2) * 0.06, Math.sin(i * 1.6) * 0.07, i % 2 ? CELL.leaf : CELL.leafLight, { sx: 0.6, sy: 0.3, detail: 5, rot: [-0.6, -i * 1.6, 0] });
  s.cyl(0.06, 0.07, 0.07, w / 2 - 0.5, 1.255, d / 2 - 0.15, CELL.white, { color: '#E2BF4F', sides: 8 });
  return { solid: s.build() };
}

/** Café: the espresso counter, dark wood with slats, a pale stone top, the machine and cups at the left end. */
export function espressoCounter(w: number, d: number, accent: string): Built {
  const s = new Shape(1.6, 0);
  body(s, w, d, shadeHex(accent, 0.45), { cell: CELL.white, color: '#F3EEE4' });
  for (let x = -w / 2 + 0.25; x < w / 2 - 0.1; x += 0.3) s.box(0.12, 0.8, 0.03, x, 0.5, d / 2 - 0.035, CELL.white, { color: accent, r: 0.01, span: 0.4 });
  // The machine: two groups, a steam wand, cups warming on top.
  const mx = -w / 2 + 0.75;
  s.box(0.9, 0.5, 0.5, mx, 1.31, -0.08, CELL.steel, { r: 0.06, color: '#E1E5E6', span: 0.6 });
  s.box(0.92, 0.07, 0.52, mx, 1.6, -0.08, CELL.ink, { r: 0.03 });
  for (const gx of [-0.2, 0.2]) {
    s.box(0.12, 0.07, 0.16, mx + gx, 1.18, 0.2, CELL.ink, { r: 0.02 });
    s.cyl(0.05, 0.045, 0.08, mx + gx, 1.1, 0.23, CELL.white, { sides: 8 });
  }
  for (let i = 0; i < 3; i++) s.cyl(0.05, 0.045, 0.08, mx - 0.25 + i * 0.25, 1.68, -0.08, CELL.white, { sides: 8 });
  // A stack of saucers, a tip jar and a pastry under a dome on the right.
  s.cyl(0.1, 0.1, 0.06, -w / 2 + 1.5, 1.09, 0.1, CELL.white, { sides: 10 });
  s.cyl(0.08, 0.08, 0.16, w / 2 - 0.4, 1.14, 0.2, CELL.sky, { sides: 10, span: 0.4 });
  s.cyl(0.2, 0.2, 0.03, w / 2 - 1.0, 1.075, 0.05, CELL.white, { sides: 12 });
  s.ball(0.17, w / 2 - 1.0, 1.1, 0.05, CELL.sky, { sy: 0.9, detail: 8, span: 0.3 });
  s.ball(0.08, w / 2 - 1.0, 1.13, 0.05, CELL.tan, { sy: 0.6, detail: 6 });
  const glow = new Glow().disc(0.025, mx + 0.3, 1.45, 0.17, { color: '#7CF0B4' }).build();
  return { solid: s.build(), glow };
}

/** Game studio: a slate counter under the studio's mascot, a round friendly blob waving from the left end. */
export function mascotCounter(w: number, d: number, accent: string): Built {
  const s = new Shape(2.6, 0);
  body(s, w, d, accent, { cell: CELL.white, color: '#EEF0F2' });
  // Pixel stripes along the front.
  ['#E9A36B', '#E58FA0', '#6FAE6A', '#E2BF4F'].forEach((c, i) => s.box(0.22, 0.22, 0.03, -w / 2 + 0.5 + i * 0.26, 0.5, d / 2 - 0.035, CELL.white, { color: c, r: 0.01, span: 0 }));
  // The mascot on its plinth: a round body, eyes, little feet and an antenna with a star.
  const mx = -w / 2 + 0.55;
  const body2 = '#E9A36B';
  s.box(0.5, 0.18, 0.5, mx, 1.15, -0.05, CELL.ink, { r: 0.04 });
  s.ball(0.42, mx, 1.62, -0.05, CELL.white, { color: body2, detail: 10, sy: 0.92 });
  for (const ex of [-0.13, 0.13]) {
    s.ball(0.085, mx + ex, 1.72, 0.3, CELL.white, { detail: 6 });
    s.ball(0.045, mx + ex, 1.72, 0.37, CELL.ink, { detail: 5 });
  }
  s.box(0.16, 0.04, 0.04, mx, 1.52, 0.35, CELL.ink, { r: 0.015 });
  s.ball(0.1, mx + 0.36, 1.66, 0.1, CELL.white, { color: body2, detail: 6, sx: 1.4 });
  s.cyl(0.015, 0.015, 0.3, mx, 2.15, -0.05, CELL.ink, { sides: 5 });
  const glow = new Glow().box(0.14, 0.14, 0.04, mx, 2.34, -0.05, { color: '#F2D27A', rot: [0, 0, Math.PI / 4] }).build();
  return { solid: s.build(), glow };
}

/** Shop: light oak with the till, a card reader, paper bags and a small scale. */
export function till(w: number, d: number, accent: string): Built {
  const s = new Shape(1.6, 0);
  body(s, w, d, tintHex(accent, 0.2), { cell: CELL.birch });
  s.box(w - 0.3, 0.5, 0.03, 0, 0.55, d / 2 - 0.035, CELL.birch, { r: 0.01, span: 0.5 });
  // The till at the left end: a drawer, keys and a screen turned to the staff.
  const tx = -w / 2 + 0.6;
  s.box(0.6, 0.16, 0.5, tx, 1.14, -0.05, CELL.white, { color: '#E4E6E2', r: 0.04 });
  s.box(0.4, 0.08, 0.26, tx, 1.25, 0.05, CELL.ink, { r: 0.02, rot: [0.3, 0, 0] });
  s.box(0.42, 0.3, 0.05, tx, 1.43, -0.2, CELL.ink, { r: 0.02, rot: [-0.2, 0, 0] });
  s.box(0.14, 0.04, 0.22, tx + 0.5, 1.08, 0.12, CELL.ink, { r: 0.015 });
  // Paper bags and a scale on the right.
  for (let i = 0; i < 3; i++) s.box(0.3, 0.04, 0.22, w / 2 - 0.5, 1.08 + i * 0.04, -0.05, CELL.tan, { r: 0.01 });
  s.box(0.32, 0.06, 0.3, w / 2 - 1.15, 1.09, 0.05, CELL.steel, { r: 0.02 });
  s.box(0.36, 0.015, 0.34, w / 2 - 1.15, 1.13, 0.05, CELL.white, { r: 0.005 });
  const glow = new Glow().quad(0.36, 0.24, tx, 1.43, -0.172, { tile: TILE.charts, rot: [-0.2, Math.PI, 0] }).build();
  return { solid: s.build(), glow };
}

/** Lab: a white badge desk with a light strip in the theme's blue, a badge printer and a rack of lanyards. */
export function badgeDesk(w: number, d: number, accent: string): Built {
  const s = new Shape(1.5, 0);
  body(s, w, d, '#F7F8F6', { cell: CELL.white, color: '#E9EEF0' });
  s.box(w - 0.4, 0.06, 0.03, 0, 0.82, d / 2 - 0.03, CELL.ink, { r: 0.01 });
  // The printer at the left end and a stand of badges on lanyards.
  const px = -w / 2 + 0.5;
  s.box(0.46, 0.26, 0.36, px, 1.19, -0.06, CELL.white, { color: '#DDE3E6', r: 0.04 });
  s.box(0.3, 0.02, 0.16, px, 1.33, 0.06, CELL.ink, { r: 0.005 });
  s.box(0.06, 0.4, 0.06, w / 2 - 0.45, 1.26, 0.1, CELL.steel, { r: 0.02 });
  s.box(0.5, 0.04, 0.04, w / 2 - 0.45, 1.45, 0.1, CELL.steel, { r: 0.01 });
  ['#5B8FC7', '#3FA5A0', '#E58FA0'].forEach((c, i) => {
    s.box(0.02, 0.2, 0.02, w / 2 - 0.62 + i * 0.17, 1.34, 0.12, CELL.white, { color: c });
    s.box(0.1, 0.13, 0.015, w / 2 - 0.62 + i * 0.17, 1.2, 0.13, CELL.white, { color: '#FCFBF7', r: 0.005 });
  });
  const glow = new Glow().box(w - 0.42, 0.035, 0.02, 0, 0.82, d / 2 - 0.01, { color: tintHex(accent, 0.25) }).build();
  return { solid: s.build(), glow };
}

/** Garden: a potting bench of slatted wood, pots and seedlings, a watering can at the left end. */
export function pottingBench(w: number, d: number, accent: string): Built {
  const s = new Shape(1.5, 0);
  s.box(w, 0.08, d, 0, 1.02, 0, CELL.wood, { r: 0.03 });
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) s.box(0.1, 0.98, 0.1, x, 0.49, z, CELL.wood, { r: 0.03 });
  s.box(w - 0.1, 0.06, d - 0.1, 0, 0.3, 0, CELL.wood, { r: 0.02 });
  // Slats on the front and a sack of soil on the lower shelf.
  for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.34) s.box(0.24, 0.6, 0.03, x, 0.66, d / 2 - 0.04, CELL.birch, { r: 0.01, span: 0.6 });
  s.box(0.6, 0.3, 0.4, w / 2 - 0.6, 0.48, -0.1, CELL.tan, { r: 0.08 });
  const pots = ['#C97F5B', '#E2DCCF', '#C97F5B', accent];
  pots.forEach((c, i) => {
    const x = -w / 2 + 1.2 + i * 0.55;
    s.cyl(0.13, 0.1, 0.18, x, 1.15, 0.05, CELL.white, { color: c, sides: 8 });
    s.ball(0.12, x, 1.32, 0.05, i % 2 ? CELL.leaf : CELL.leafLight, { sy: 0.7, detail: 6 });
  });
  // The watering can.
  const cx = -w / 2 + 0.4;
  s.cyl(0.16, 0.16, 0.28, cx, 1.2, -0.05, CELL.white, { color: accent, sides: 10 });
  s.box(0.04, 0.04, 0.34, cx + 0.16, 1.28, -0.05, CELL.white, { color: accent, rot: [0, Math.PI / 2, -0.7] });
  s.ring(0.11, 0.02, cx - 0.04, 1.38, -0.05, CELL.white, { color: accent, arc: Math.PI, sides: 8 });
  return { solid: s.build() };
}

/** City: a kiosk counter with a news stand at the left end, its domed roof and posters, and a map on the counter. */
export function kiosk(w: number, d: number, accent: string): Built {
  const s = new Shape(2.8, 0);
  body(s, w, d, accent, { cell: CELL.white, color: '#EDEAE4' });
  s.box(w - 0.3, 0.1, 0.03, 0, 0.86, d / 2 - 0.035, CELL.white, { color: '#F4F1EA', span: 0 });
  // The stand: a round column with posters and a dome.
  const kx = -w / 2 + 0.45;
  s.cyl(0.36, 0.36, 2.1, kx, 1.05, -0.12, CELL.white, { color: tintHex(accent, 0.15), sides: 12 });
  s.cyl(0.46, 0.4, 0.12, kx, 2.16, -0.12, CELL.white, { color: shadeHex(accent, 0.25), sides: 12 });
  s.ball(0.36, kx, 2.22, -0.12, CELL.white, { color: tintHex(accent, 0.1), sy: 0.6, detail: 10 });
  s.ball(0.06, kx, 2.47, -0.12, CELL.white, { color: '#E2BF4F', detail: 6 });
  ['#E58FA0', '#F2EFE8', '#E2BF4F'].forEach((c, i) => {
    const a = 0.4 + i * 0.55;
    s.box(0.3, 0.44, 0.02, kx + Math.sin(a) * 0.37, 1.45 - (i % 2) * 0.5, -0.12 + Math.cos(a) * 0.37, CELL.white, { color: c, span: 0, rot: [0, a, 0] });
  });
  // A map spread on the counter and a stack of papers.
  s.box(0.8, 0.012, 0.5, 0.2, 1.067, 0.05, CELL.white, { color: '#E9F0E4', span: 0 });
  s.box(0.5, 0.014, 0.05, 0.1, 1.07, 0.0, CELL.white, { color: '#9DB8C2', span: 0, rot: [0, 0.4, 0] });
  s.box(0.36, 0.1, 0.26, w / 2 - 0.45, 1.11, 0.0, CELL.paper, { r: 0.01, span: 0.2 });
  return { solid: s.build() };
}

/** Arcade: the prize counter, a glass case of plush prizes with neon along its top in the theme's pink. */
export function prizeCounter(w: number, d: number, accent: string): Built {
  const s = new Shape(1.3, 0);
  s.box(w, 0.36, d - 0.08, 0, 0.18, -0.02, CELL.white, { color: '#3A3448', r: 0.04 });
  s.box(w, 0.62, d - 0.08, 0, 0.67, -0.02, CELL.sky, { r: 0.03, span: 0.25, color: '#DCEFF6' });
  s.box(w + 0.06, 0.08, d + 0.02, 0, 1.02, 0, CELL.white, { color: '#2F2A3D', r: 0.03 });
  const prizes = ['#E58FA0', '#E2BF4F', '#4FA3B8', '#6FAE6A', '#D65DB1', '#E9A36B'];
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 + 0.35 + i * ((w - 0.7) / 8);
    s.ball(0.15, x, 0.55, 0.05, CELL.white, { color: prizes[i % prizes.length] ?? '#E58FA0', detail: 6 });
    s.ball(0.06, x - 0.07, 0.68, 0.12, CELL.white, { color: prizes[(i + 2) % prizes.length] ?? '#E2BF4F', detail: 5 });
  }
  // A big plush bear on the left end of the top, and a bell.
  const bx = -w / 2 + 0.4;
  s.ball(0.24, bx, 1.28, -0.1, CELL.white, { color: '#C98E6B', detail: 8 });
  s.ball(0.18, bx, 1.62, -0.1, CELL.white, { color: '#C98E6B', detail: 8 });
  for (const ex of [-0.12, 0.12]) s.ball(0.07, bx + ex, 1.77, -0.1, CELL.white, { color: '#C98E6B', detail: 5 });
  s.cyl(0.07, 0.08, 0.07, w / 2 - 0.4, 1.095, 0.1, CELL.white, { color: '#E2BF4F', sides: 8 });
  const glow = new Glow().box(w - 0.1, 0.035, 0.035, 0, 0.99, d / 2 - 0.01, { color: accent }).box(w - 0.1, 0.035, 0.035, 0, 0.36, d / 2 - 0.01, { color: '#4FA3B8' }).build();
  return { solid: s.build(), glow };
}

/** Music studio: a dark wood gear counter, pedals in a row, a little amp and a guitar on its stand at the left end. */
export function gearCounter(w: number, d: number, accent: string): Built {
  const s = new Shape(2.2, 0);
  body(s, w, d, '#4A3A30', { cell: CELL.wood });
  s.box(w - 0.3, 0.5, 0.03, 0, 0.55, d / 2 - 0.035, CELL.white, { color: accent, r: 0.01, span: 0.5 });
  ['#E2BF4F', '#5B8FC7', '#D9625B', '#6FAE6A'].forEach((c, i) => {
    const x = 0.1 + i * 0.32;
    s.box(0.2, 0.07, 0.26, x, 1.095, 0.05, CELL.white, { color: c, r: 0.02 });
    s.ball(0.03, x, 1.14, 0.12, CELL.steel, { detail: 4 });
  });
  // The amp on the counter's left end, the guitar standing beside it.
  const ax = -w / 2 + 0.45;
  s.box(0.56, 0.44, 0.34, ax, 1.28, -0.1, CELL.ink, { r: 0.04 });
  s.box(0.46, 0.3, 0.02, ax, 1.25, 0.075, CELL.white, { color: '#8A7A6A', span: 0.3 });
  s.box(0.46, 0.06, 0.02, ax, 1.46, 0.075, CELL.white, { color: '#D9C9A0', span: 0 });
  // The guitar on its floor stand, just off the counter's left end.
  const gx = -w / 2 - 0.32;
  for (const a of [-0.5, 0.5]) s.box(0.03, 0.5, 0.03, gx + a * 0.25, 0.24, -0.12, CELL.ink, { rot: [0.3, 0, a * 0.4] });
  s.ball(0.22, gx, 0.48, 0.0, CELL.white, { color: shadeHex(accent, 0.1), sz: 0.35, detail: 8 });
  s.ball(0.17, gx, 0.76, 0.0, CELL.white, { color: shadeHex(accent, 0.1), sz: 0.35, detail: 8 });
  s.box(0.07, 0.66, 0.04, gx, 1.2, 0.0, CELL.wood, { r: 0.015 });
  s.box(0.12, 0.17, 0.05, gx, 1.6, 0.0, CELL.ink, { r: 0.02 });
  s.box(0.08, 0.1, 0.03, gx, 0.48, 0.08, CELL.ink, { r: 0.015 });
  return { solid: s.build() };
}

/** The front desk of each theme, by its catalogue id. */
export const FRONT_DESKS: Readonly<Record<string, (w: number, d: number, accent: string) => Built>> = {
  'reception-desk': receptionDesk,
  'espresso-counter': espressoCounter,
  'mascot-counter': mascotCounter,
  till,
  'badge-desk': badgeDesk,
  'potting-bench': pottingBench,
  kiosk,
  'prize-counter': prizeCounter,
  'gear-counter': gearCounter,
};

/** The lamp on the front desk that stays on at night (game-feel.md, section 4): a brass lamp with a warm shade. */
export function frontLamp(): Built {
  const s = new Shape(0.75, 0);
  s.cyl(0.12, 0.14, 0.05, 0, 0.025, 0, CELL.white, { color: '#C9A45A', sides: 10 });
  s.cyl(0.025, 0.025, 0.5, 0, 0.3, 0, CELL.white, { color: '#C9A45A', sides: 6 });
  s.cyl(0.13, 0.2, 0.2, 0, 0.6, 0, CELL.white, { color: '#F2E3C4', sides: 12, open: true });
  const glow = new Glow().disc(0.12, 0, 0.51, 0, { color: '#FFE2A8', rot: [Math.PI / 2, 0, 0] }).build();
  return { solid: s.build(), glow, lights: [{ x: 0, y: 0.02, z: 0.6, sx: 3.2, sz: 3.2, colour: '#FFB25C', strength: 0.13, stays: true }] };
}
