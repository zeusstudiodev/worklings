// Each theme's hero pieces (docs/game-feel.md, "Themes"), made here in KayKit's style because the free packs lack
// them. Floor pieces stand on y = 0 with their front to +z, sized to the catalogue's footprint (src/core/themes.ts);
// wall pieces have their back on z = 0 and their bottom edge on y = 0.
import { CELL } from './atlas.ts';
import { shadeHex, tintHex } from './colour.ts';
import type { Built } from './props.ts';
import { Glow, Shape, TILE } from './shape.ts';

/** Café: an A-frame chalkboard with the day's menu in chalk. */
export function chalkboardMenu(): Built {
  const s = new Shape(1.3, 0);
  const lean = 0.24;
  // A point on a board's face, from its own coordinates: across, up from its middle, and out of its face.
  const onBoard = (side: number, x: number, up: number, out: number): [number, number, number] => {
    const t = -side * lean;
    return [x, 0.6 + up * Math.cos(t) - side * out * Math.sin(t), side * 0.14 + up * Math.sin(t) + side * out * Math.cos(t)];
  };
  for (const side of [1, -1]) {
    const rot: [number, number, number] = [-side * lean, 0, 0];
    s.box(0.9, 1.2, 0.05, ...onBoard(side, 0, 0, 0), CELL.wood, { r: 0.02, rot });
    s.box(0.76, 1.02, 0.02, ...onBoard(side, 0, 0.02, 0.03), CELL.ink, { r: 0.004, span: 0.2, rot });
  }
  // Chalk on the front: a heading, lines and a little cup.
  const chalk = (w: number, up: number, x = 0) => s.box(w, 0.035, 0.012, ...onBoard(1, x, up, 0.045), CELL.white, { color: '#F1EEE6', span: 0, rot: [-lean, 0, 0] });
  chalk(0.5, 0.36);
  for (let i = 0; i < 4; i++) chalk(i % 2 ? 0.42 : 0.56, 0.16 - i * 0.12, -0.04);
  s.box(0.12, 0.12, 0.012, ...onBoard(1, 0.24, -0.32, 0.045), CELL.white, { color: '#E9A36B', span: 0, rot: [-lean, 0, 0] });
  return { solid: s.build() };
}

/** Café: a glass pastry case on a wooden base, croissants and cakes on two shelves. */
export function pastryCase(): Built {
  const s = new Shape(1.3, 0);
  s.box(1.6, 0.7, 1.0, 0, 0.35, 0, CELL.wood, { r: 0.05 });
  s.box(1.62, 0.06, 1.02, 0, 0.73, 0, CELL.white, { color: '#F1EADC', r: 0.02 });
  s.box(1.5, 0.5, 0.9, 0, 1.0, 0, CELL.sky, { r: 0.03, span: 0.2, color: '#E4F2F6' });
  s.box(1.56, 0.05, 0.96, 0, 1.27, 0, CELL.white, { color: '#F1EADC', r: 0.02 });
  const treats = ['#D9A25E', '#E58FA0', '#F1EADC', '#C9705B', '#D9A25E'];
  treats.forEach((c, i) => {
    s.ball(0.11, -0.56 + i * 0.28, 0.83, 0.18, CELL.white, { color: c, sx: 1.3, sy: 0.6, detail: 6 });
    s.ball(0.1, -0.5 + i * 0.25, 1.04, -0.05, CELL.white, { color: treats[(i + 2) % treats.length] ?? '#D9A25E', sx: 1.1, sy: 0.7, detail: 6 });
  });
  return { solid: s.build() };
}

/** Game studio: a big screen on a low stand, showing the game being built. */
export function bigScreen(): Built {
  const s = new Shape(2.1, 0);
  s.box(2.6, 0.5, 0.56, 0, 0.25, 0, CELL.wood, { r: 0.05 });
  for (const x of [-0.65, 0.65]) s.box(1.1, 0.3, 0.02, x, 0.27, 0.285, CELL.wood, { r: 0.01, span: 0.4 });
  s.box(0.5, 0.06, 0.3, 0, 0.53, -0.05, CELL.ink, { r: 0.02 });
  s.box(0.12, 0.3, 0.08, 0, 0.7, -0.08, CELL.ink, { r: 0.03 });
  s.box(2.8, 1.5, 0.09, 0, 1.6, -0.05, CELL.ink, { r: 0.04, span: 0.4 });
  // A controller on the stand.
  s.box(0.3, 0.05, 0.16, 0.9, 0.525, 0.12, CELL.white, { color: '#E4E6E8', r: 0.02 });
  const glow = new Glow().quad(2.66, 1.36, 0, 1.6, 0.0, { tile: TILE.design }).build();
  return { solid: s.build(), glow, lights: [{ x: 0, y: 0.02, z: 1.2, sx: 3.6, sz: 2.2, colour: '#9AD8F0', strength: 0.08 }] };
}

/** Game studio: a pin board on legs with concept art for the game. */
export function conceptBoard(): Built {
  const s = new Shape(2.0, 0);
  for (const x of [-0.7, 0.7]) {
    s.box(0.06, 1.9, 0.06, x, 0.95, -0.05, CELL.wood, { r: 0.02 });
    s.box(0.08, 0.04, 0.5, x, 0.02, -0.05, CELL.wood, { r: 0.015 });
  }
  s.box(1.6, 1.1, 0.05, 0, 1.35, 0, CELL.tan, { r: 0.02, span: 0.3 });
  const art: [number, number, number, number, string][] = [
    [-0.45, 1.6, 0.5, 0.36, '#9EC3EA'],
    [0.15, 1.62, 0.5, 0.32, '#E9A36B'],
    [0.58, 1.55, 0.26, 0.42, '#E58FA0'],
    [-0.4, 1.12, 0.6, 0.4, '#A8D8A0'],
    [0.32, 1.1, 0.6, 0.4, '#F2EFE8'],
  ];
  for (const [x, y, w, h, c] of art) s.box(w, h, 0.012, x, y, 0.032, CELL.white, { color: c, span: 0, r: 0.004 });
  s.ball(0.09, 0.32, 1.13, 0.045, CELL.white, { color: '#E9A36B', detail: 6, sz: 0.2 });
  return { solid: s.build() };
}

/** Shop: steel shelving stacked with parcels. */
export function parcelShelves(): Built {
  const s = new Shape(2.0, 0);
  for (const x of [-0.96, 0.96]) for (const z of [-0.36, 0.36]) s.box(0.05, 1.9, 0.05, x, 0.95, z, CELL.steel, { r: 0.015 });
  const shelves = [0.12, 0.72, 1.32];
  for (const y of shelves) s.box(1.98, 0.04, 0.78, 0, y, 0, CELL.steel, { r: 0.01, span: 0.3 });
  s.box(1.98, 0.04, 0.78, 0, 1.88, 0, CELL.steel, { r: 0.01, span: 0.3 });
  const boxes: [number, number, number, number, number][] = [
    [-0.6, 0, 0.6, 0.42, 0.5], [0.1, 0, 0.5, 0.34, 0.56], [0.65, 0, 0.5, 0.5, 0.5],
    [-0.55, 1, 0.7, 0.36, 0.56], [0.25, 1, 0.5, 0.48, 0.5],
    [-0.3, 2, 0.6, 0.4, 0.5], [0.5, 2, 0.4, 0.3, 0.45],
  ];
  for (const [x, shelf, w, h, d] of boxes) {
    const y = (shelves[shelf] ?? 0) + 0.02 + h / 2;
    s.box(w, h, d, x, y, 0, CELL.tan, { r: 0.02, span: 0.6 });
    s.box(0.06, h + 0.004, d + 0.004, x, y, 0, CELL.white, { color: '#C9B79C', span: 0.3 });
  }
  return { solid: s.build() };
}

/** Shop: a packing bench with a roll of kraft paper, tape, boxes being packed and a scale. */
export function packingBench(): Built {
  const s = new Shape(1.3, 0);
  s.box(2.4, 0.08, 1.2, 0, 0.95, 0, CELL.birch, { r: 0.03 });
  for (const x of [-1.1, 1.1]) for (const z of [-0.5, 0.5]) s.box(0.08, 0.91, 0.08, x, 0.455, z, CELL.steel, { r: 0.02 });
  s.box(2.3, 0.04, 1.1, 0, 0.3, 0, CELL.steel, { r: 0.01, span: 0.3 });
  // The roll on its holder at the left end, a sheet pulled across.
  s.cyl(0.13, 0.13, 1.0, -0.95, 1.13, 0, CELL.tan, { sides: 10, rot: [Math.PI / 2, 0, 0] });
  s.box(0.6, 0.01, 0.9, -0.55, 0.995, 0, CELL.tan, { span: 0.2 });
  s.box(0.5, 0.36, 0.4, 0.25, 1.17, -0.15, CELL.tan, { r: 0.02, span: 0.6 });
  s.box(0.34, 0.24, 0.3, 0.75, 1.11, 0.2, CELL.tan, { r: 0.02, span: 0.6 });
  s.cyl(0.08, 0.08, 0.06, 0.6, 1.02, -0.3, CELL.white, { color: '#C9B79C', sides: 10, rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 3; i++) s.box(0.7, 0.05, 0.5, 0, 0.35 + i * 0.05, 0, CELL.tan, { r: 0.01 });
  return { solid: s.build() };
}

/** Lab: a small server rack, its status lights lit; they blink only while someone works (built separately). */
export function serverRack(): Built {
  const s = new Shape(1.9, 0);
  s.box(0.8, 1.75, 0.8, 0, 0.875, 0, CELL.paper, { r: 0.05, span: 0.9, color: '#C9D2D8' });
  s.box(0.68, 1.5, 0.03, 0, 0.92, 0.405, CELL.ink, { r: 0.01, span: 0.4 });
  for (let i = 0; i < 6; i++) s.box(0.6, 0.16, 0.025, 0, 0.32 + i * 0.235, 0.42, CELL.steel, { span: 0.2, color: '#B8C2C8' });
  s.box(0.84, 0.06, 0.84, 0, 1.78, 0, CELL.paper, { r: 0.02, span: 0.2, color: '#AEB9C0' });
  return { solid: s.build(), glow: rackLights() };
}

/** The rack's status lights, all on: one small quad each (four vertices), so the office can blink them in place. */
export function rackLights(): ReturnType<Glow['build']> {
  const g = new Glow();
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 3; k++) {
      const colour = k === 0 && i % 3 === 1 ? '#FFC65C' : i % 2 ? '#7CF0B4' : '#7CC8FF';
      g.quad(0.045, 0.045, 0.16 + k * 0.07, 0.32 + i * 0.235, 0.436, { color: colour });
    }
  }
  return g.build();
}

/** Which of a rack's lights are on at a step of their blinking: three in four, the gap moving along. */
export const rackLightOn = (light: number, step: number): boolean => (light * 7 + step) % 4 !== 0;

/** Garden: a greenhouse arch over a raised bed, glass between the ribs. */
export function greenhouseArch(): Built {
  const s = new Shape(1.9, 0);
  s.box(2.4, 0.4, 1.2, 0, 0.2, 0, CELL.wood, { r: 0.04 });
  s.box(2.3, 0.04, 1.1, 0, 0.41, 0, CELL.bark, { span: 0.3 });
  for (const x of [-1.1, -0.37, 0.37, 1.1]) s.ring(0.56, 0.03, x, 0.42, 0, CELL.white, { arc: Math.PI, rot: [0, Math.PI / 2, 0], sides: 10 });
  s.cyl(0.56, 0.56, 2.2, 0, 0.42, 0, CELL.sky, { sides: 10, open: true, span: 0.2, color: '#E8F4F2', rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 5; i++) s.ball(0.17, -0.8 + i * 0.4, 0.58, (i % 2) * 0.2 - 0.1, i % 2 ? CELL.leaf : CELL.leafLight, { sy: 0.8, detail: 6 });
  return { solid: s.build() };
}

/** Garden: a raised planter with greens and a few flowers. */
export function planter(accent: string): Built {
  const s = new Shape(1.1, 0);
  s.box(1.6, 0.55, 0.8, 0, 0.275, 0, CELL.wood, { r: 0.04 });
  for (let x = -0.6; x <= 0.61; x += 0.4) s.box(0.02, 0.5, 0.02, x, 0.28, 0.405, CELL.bark, { span: 0.4 });
  s.box(1.5, 0.04, 0.7, 0, 0.54, 0, CELL.bark, { span: 0.3 });
  const flowers = ['#E58FA0', '#E2BF4F', '#F2EFE8', accent];
  for (let i = 0; i < 6; i++) {
    const x = -0.6 + i * 0.24;
    s.ball(0.15, x, 0.68, (i % 2) * 0.16 - 0.08, i % 2 ? CELL.leafLight : CELL.leaf, { sy: 0.75, detail: 6 });
    if (i % 2 === 0) s.ball(0.06, x + 0.05, 0.84, (i % 2) * 0.16 - 0.04, CELL.white, { color: flowers[i % flowers.length] ?? '#E58FA0', detail: 5 });
  }
  return { solid: s.build() };
}

/** City: a bus stop shelter, open to the front, with a bench and a round sign on a pole. */
export function busStop(accent: string): Built {
  const s = new Shape(2.6, 0);
  s.box(2.3, 1.9, 0.05, 0, 1.05, -0.42, CELL.sky, { r: 0.015, span: 0.2, color: '#E4F2F6' });
  for (const x of [-1.15, 1.15]) s.box(0.07, 2.3, 0.07, x, 1.15, -0.42, CELL.steel, { r: 0.02 });
  s.box(2.5, 0.08, 0.95, 0, 2.32, -0.05, CELL.white, { color: accent, r: 0.03 });
  s.box(1.6, 0.06, 0.32, 0, 0.5, -0.24, CELL.wood, { r: 0.02 });
  for (const x of [-0.7, 0.7]) s.box(0.05, 0.47, 0.05, x, 0.235, -0.24, CELL.steel, { r: 0.015 });
  s.box(0.6, 0.9, 0.03, 0.75, 1.3, -0.39, CELL.white, { color: '#F2EFE8', r: 0.01, span: 0 });
  s.box(0.45, 0.2, 0.032, 0.75, 1.55, -0.385, CELL.white, { color: tintHex(accent, 0.3), span: 0 });
  // The sign on its pole beside the shelter.
  s.cyl(0.035, 0.035, 2.5, 1.45, 1.25, 0.2, CELL.steel, { sides: 6 });
  s.cyl(0.22, 0.22, 0.04, 1.45, 2.35, 0.2, CELL.white, { color: '#F2EFE8', sides: 14, rot: [Math.PI / 2, 0, 0] });
  s.cyl(0.18, 0.18, 0.045, 1.45, 2.35, 0.2, CELL.white, { color: accent, sides: 14, rot: [Math.PI / 2, 0, 0] });
  return { solid: s.build() };
}

/** City: a street lamp, lit. */
export function streetLamp(): Built {
  const s = new Shape(2.9, 0);
  s.cyl(0.16, 0.2, 0.2, 0, 0.1, 0, CELL.ink, { sides: 8 });
  s.cyl(0.05, 0.065, 2.5, 0, 1.35, 0, CELL.ink, { sides: 8 });
  s.cyl(0.08, 0.18, 0.22, 0, 2.72, 0, CELL.ink, { sides: 8 });
  s.cyl(0.2, 0.06, 0.08, 0, 2.86, 0, CELL.ink, { sides: 8 });
  const glow = new Glow().tube(0.11, 0.18, 0, 2.56, 0, { color: '#FFE4A8', sides: 8 }).build();
  return {
    solid: s.build(),
    glow,
    lights: [
      { x: 0, y: 0.02, z: 0, sx: 3.6, sz: 3.6, colour: '#FFB25C', strength: 0.13 },
      { x: 0, y: 2.56, z: 0, sx: 1.0, sz: 1.0, colour: '#FFCF7A', strength: 0.3, halo: true },
    ],
  };
}

/** A park bench: wooden slats on cast legs. */
export function bench(): Built {
  const s = new Shape(1.0, 0);
  for (let i = 0; i < 3; i++) s.box(1.9, 0.05, 0.13, 0, 0.46, -0.18 + i * 0.16, CELL.wood, { r: 0.015 });
  for (let i = 0; i < 2; i++) s.box(1.9, 0.12, 0.04, 0, 0.66 + i * 0.16, -0.32, CELL.wood, { r: 0.015, rot: [-0.15, 0, 0] });
  for (const x of [-0.8, 0.8]) {
    s.box(0.06, 0.44, 0.5, x, 0.22, -0.05, CELL.ink, { r: 0.02 });
    s.box(0.06, 0.5, 0.06, x, 0.7, -0.33, CELL.ink, { r: 0.02 });
  }
  return { solid: s.build() };
}

const CABINETS = ['#5C6B8A', '#D65DB1', '#4FA3B8', '#E9A36B', '#6FAE6A'];

/** Arcade: a cabinet with a lit screen, a marquee, a stick and three buttons. */
export function arcadeCabinet(seed: number): Built {
  const colour = CABINETS[Math.abs(seed) % CABINETS.length] ?? '#5C6B8A';
  const s = new Shape(2.1, 0);
  s.box(0.86, 0.95, 0.8, 0, 0.475, 0, CELL.white, { color: colour, r: 0.04 });
  s.box(0.86, 0.9, 0.5, 0, 1.4, -0.15, CELL.white, { color: colour, r: 0.04 });
  s.box(0.9, 0.12, 0.42, 0, 1.0, 0.2, CELL.ink, { r: 0.03, rot: [0.25, 0, 0] });
  s.box(0.86, 0.26, 0.58, 0, 1.97, -0.06, CELL.white, { color: shadeHex(colour, 0.3), r: 0.04 });
  s.box(0.66, 0.6, 0.04, 0, 1.45, 0.11, CELL.ink, { r: 0.02, rot: [-0.12, 0, 0] });
  s.cyl(0.02, 0.02, 0.12, -0.2, 1.11, 0.22, CELL.ink, { sides: 5 });
  s.ball(0.045, -0.2, 1.18, 0.22, CELL.white, { color: '#D9625B', detail: 5 });
  ['#E2BF4F', '#4FA3B8', '#E58FA0'].forEach((c, i) => s.cyl(0.035, 0.035, 0.03, 0.05 + i * 0.1, 1.08, 0.24 - i * 0.02, CELL.white, { color: c, sides: 6, rot: [0.25, 0, 0] }));
  const glow = new Glow()
    .quad(0.58, 0.5, 0, 1.45, 0.135, { tile: (seed % 2 ? TILE.design : TILE.layout) as typeof TILE.design, rot: [-0.12, 0, 0] })
    .quad(0.74, 0.16, 0, 1.98, 0.236, { color: tintHex(colour, 0.5) })
    .build();
  return { solid: s.build(), glow };
}

/** Arcade: a neon sign for a wall, a star and a wave in glowing tubes on a dark backing. */
export function neonSign(accent: string): Built {
  const s = new Shape(0.7, 0);
  s.box(1.6, 0.7, 0.04, 0, 0.35, 0.02, CELL.ink, { r: 0.02, span: 0.2 });
  const g = new Glow();
  // A five-pointed star.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    g.box(0.24, 0.035, 0.03, -0.5 + Math.cos(a) * 0.08, 0.36 + Math.sin(a) * 0.08, 0.06, { color: '#F2D27A', rot: [0, 0, a + Math.PI / 2] });
  }
  // A wave.
  for (let i = 0; i < 6; i++) g.box(0.15, 0.035, 0.03, -0.12 + i * 0.13, 0.36 + (i % 2 ? 0.06 : -0.06), 0.06, { color: accent, rot: [0, 0, i % 2 ? -0.75 : 0.75] });
  return { solid: s.build(), glow: g.build(), lights: [{ x: 0, y: 0.35, z: 0.25, sx: 2.2, sz: 1.2, colour: accent, strength: 0.18, halo: true }] };
}

/** Music studio: a mixing desk on its stand, rows of faders and knobs, two small monitors and a level meter. */
export function mixingDesk(): Built {
  const s = new Shape(1.6, 0);
  s.box(2.3, 0.7, 0.9, 0, 0.35, -0.1, CELL.wood, { r: 0.05 });
  s.box(2.4, 0.12, 1.1, 0, 0.82, 0.0, CELL.ink, { r: 0.04, rot: [0.18, 0, 0] });
  for (let i = 0; i < 12; i++) {
    const x = -1.0 + i * 0.18;
    s.box(0.03, 0.02, 0.24, x, 0.9, 0.22, CELL.steel, { rot: [0.18, 0, 0] });
    s.box(0.07, 0.05, 0.05, x, 0.92, 0.18 + (i % 3) * 0.05, CELL.white, { color: '#E9E6DF', r: 0.01, rot: [0.18, 0, 0] });
    for (let k = 0; k < 2; k++) s.cyl(0.025, 0.025, 0.03, x, 0.92 - k * 0.04, -0.12 - k * 0.14, CELL.white, { color: k ? '#E2BF4F' : '#E9E6DF', sides: 6, rot: [0.18, 0, 0] });
  }
  for (const x of [-0.95, 0.95]) {
    s.box(0.36, 0.5, 0.34, x, 1.15, -0.4, CELL.ink, { r: 0.04 });
    s.cyl(0.11, 0.11, 0.02, x, 1.2, -0.225, CELL.steel, { sides: 10, rot: [Math.PI / 2, 0, 0] });
  }
  const glow = new Glow().quad(0.5, 0.12, 0, 0.98, -0.32, { tile: TILE.progress, rot: [-0.3, 0, 0] }).build();
  return { solid: s.build(), glow };
}

/** Music studio: a tall floor speaker. */
export function speaker(): Built {
  const s = new Shape(1.7, 0);
  s.box(0.7, 1.6, 0.66, 0, 0.8, 0, CELL.ink, { r: 0.05, span: 0.5 });
  s.box(0.58, 1.46, 0.02, 0, 0.8, 0.33, CELL.white, { color: '#3A3530', span: 0.3 });
  for (const [y, r] of [[1.25, 0.14], [0.62, 0.24]] as const) {
    s.cyl(r, r, 0.04, 0, y, 0.34, CELL.steel, { sides: 14, rot: [Math.PI / 2, 0, 0] });
    s.cyl(r * 0.45, r * 0.45, 0.06, 0, y, 0.35, CELL.ink, { sides: 10, rot: [Math.PI / 2, 0, 0] });
  }
  return { solid: s.build() };
}

/** Music studio: a small vocal booth, padded on three sides, open to the front, a microphone on its stand inside. */
export function vocalBooth(accent: string): Built {
  const s = new Shape(2.3, 0);
  const pad = tintHex(accent, 0.15);
  s.box(2.0, 2.2, 0.12, 0, 1.1, -0.94, CELL.white, { color: pad, r: 0.04 });
  for (const x of [-0.94, 0.94]) s.box(0.12, 2.2, 1.9, x, 1.1, 0, CELL.white, { color: pad, r: 0.04 });
  s.box(2.06, 0.1, 2.0, 0, 2.25, 0, CELL.wood, { r: 0.03 });
  for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) s.box(0.36, 0.42, 0.03, -0.6 + i * 0.4, 0.6 + k * 0.9, -0.87, CELL.white, { color: shadeHex(accent, 0.15), r: 0.03, span: 0.4 });
  s.box(1.86, 0.03, 1.8, 0, 0.015, 0, CELL.white, { color: '#3A3530', span: 0.2 });
  // The microphone: a stand, a pop filter and the mic.
  s.cyl(0.18, 0.2, 0.03, 0.1, 0.03, 0.1, CELL.ink, { sides: 10 });
  s.cyl(0.02, 0.02, 1.5, 0.1, 0.78, 0.1, CELL.steel, { sides: 6 });
  s.cyl(0.05, 0.04, 0.2, 0.1, 1.6, 0.18, CELL.steel, { sides: 8, rot: [0.4, 0, 0] });
  s.ring(0.1, 0.012, 0.1, 1.6, 0.34, CELL.ink, { sides: 10 });
  const glow = new Glow().box(0.32, 0.1, 0.03, 0, 2.12, 0.98, { color: '#F07070' }).build();
  return { solid: s.build(), glow };
}
