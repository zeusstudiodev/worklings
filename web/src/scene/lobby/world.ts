// A company's small world in the lobby (docs/game-feel.md, section 5, "Outside, in the lobby"): its building in its
// theme on a base board, in three parts so entering can lift the roof and lower the front walls, the windows left to
// an instanced mesh lit by instance colour. Made in KayKit's style from the office's builder, each world well under
// 2,000 triangles. Pure three.js.
import type { BufferGeometry } from 'three';
import type { Theme } from '../../../../src/core/looks.ts';
import { THEME_LOOKS } from '../../../../src/core/themes.ts';
import { CELL } from '../office/atlas.ts';
import { shadeHex, tintHex } from '../office/colour.ts';
import { trianglesOf } from '../office/merge.ts';
import { Glow, Shape } from '../office/shape.ts';
import { BASE } from '../office/style.ts';
import { floorsFor, LOBBY, windowPlaces } from './worlds.ts';

export interface WorldParts {
  /** The plot, the back and left walls, the floor inside and its desks: these never move. */
  body: BufferGeometry;
  /** The front and right walls the camera sees, with their sills, door and trims: they lower when you enter. */
  front: BufferGeometry;
  /** The roof and what stands on it: lifted off when you enter. */
  roof: BufferGeometry;
  /** What glows and never changes: the door lamp, signs, neon. */
  glow: BufferGeometry | null;
  /** The walls' height. */
  height: number;
  triangles: number;
}

interface Outside {
  wall: string;
  trim: string;
  ground: string;
}

/** Each theme's building from outside: brick, cream, slate, white, glass, stone. */
const OUTSIDE: Readonly<Record<Theme, Outside>> = {
  office: { wall: '#B86A4F', trim: '#EFE6D8', ground: '#D9D2C4' },
  cafe: { wall: '#F1EADC', trim: '#B98A5E', ground: '#DCCFBA' },
  'game-studio': { wall: '#5C6B8A', trim: '#E9E4DA', ground: '#D0CCC4' },
  shop: { wall: '#F6F1E7', trim: '#C9A27C', ground: '#DDD3C2' },
  lab: { wall: '#F4F5F2', trim: '#9DB8C2', ground: '#DADFDC' },
  garden: { wall: '#DDEFE9', trim: '#F4F5F2', ground: '#A9C48A' },
  city: { wall: '#C9C4BA', trim: '#8C8A84', ground: '#B9B5AD' },
  arcade: { wall: '#3A3448', trim: '#6C5A9E', ground: '#C9C2D4' },
  'music-studio': { wall: '#9A5A44', trim: '#E6DED2', ground: '#D3C8B8' },
};

const T = 0.14;
const WINDOW = { w: 0.62, h: 0.62 };

/** A world's three parts for a theme and so many people. */
export function worldParts(theme: Theme, people: number): WorldParts {
  const look = OUTSIDE[theme];
  const accent = THEME_LOOKS[theme].accent;
  const floors = floorsFor(people);
  const height = floors * LOBBY.floorHeight + 0.18;
  const { x0, x1, z0, z1 } = LOBBY.building;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const { w: pw, d: pd } = LOBBY.plot;
  const glass = theme === 'garden';

  // The plot: a base board on the mat, the ground, and a path to the door.
  const body = new Shape(height + 1, -0.2);
  body.box(pw + 0.3, 0.1, pd + 0.3, 0, -0.17, 0, CELL.white, { color: BASE.edge, r: 0.04 });
  body.box(pw, 0.16, pd, 0, -0.08, 0, CELL.white, { color: BASE.board, r: 0.05, span: 0.2 });
  body.box(pw - 0.4, 0.03, pd - 0.4, 0, 0.015, 0, CELL.white, { color: look.ground, span: 0 });
  body.box(0.9, 0.035, pd / 2 - z1 - 0.2, LOBBY.doorX, 0.02, (z1 + pd / 2 - 0.2) / 2, CELL.white, { color: tintHex(look.ground, 0.35), span: 0 });
  // The back and left walls, the floor inside and a desk per person on it (seen when the roof lifts).
  body.box(w, height, T, cx, height / 2, z0 + T / 2, glass ? CELL.sky : CELL.white, { color: look.wall, r: 0.03, span: 0.5 });
  body.box(T, height, d - T, x0 + T / 2, height / 2, cz + T / 2, glass ? CELL.sky : CELL.white, { color: look.wall, r: 0.03, span: 0.5 });
  body.box(w - T * 2, 0.04, d - T * 2, cx, 0.04, cz, CELL.white, { color: THEME_LOOKS[theme].floor.colour, span: 0 });
  const desks = Math.min(12, people);
  for (let i = 0; i < desks; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    body.box(0.62, 0.36, 0.34, x0 + 0.9 + col * 1.25, 0.24, z0 + 0.7 + row * 0.95, CELL.birch, { r: 0 });
  }

  // The front and right walls with the floors' trims, window sills, the door and its frame.
  const front = new Shape(height + 1, -0.2);
  front.box(w, height, T, cx, height / 2, z1 - T / 2, glass ? CELL.sky : CELL.white, { color: look.wall, r: 0.03, span: 0.5 });
  front.box(T, height, d - T, x1 - T / 2, height / 2, cz - T / 2, glass ? CELL.sky : CELL.white, { color: look.wall, r: 0.03, span: 0.5 });
  for (let f = 1; f < floors; f++) {
    const y = f * LOBBY.floorHeight + 0.02;
    front.box(w + 0.06, 0.07, 0.06, cx, y, z1 + 0.02, CELL.white, { color: look.trim, span: 0 });
    front.box(0.06, 0.07, d + 0.06, x1 + 0.02, y, cz, CELL.white, { color: look.trim, span: 0 });
  }
  front.box(w + 0.08, 0.1, 0.08, cx, 0.05, z1 + 0.03, CELL.white, { color: shadeHex(look.wall, 0.2), span: 0 });
  front.box(0.08, 0.1, d + 0.08, x1 + 0.03, 0.05, cz, CELL.white, { color: shadeHex(look.wall, 0.2), span: 0 });
  for (const p of windowPlaces(people)) {
    if (p.face === 'front') front.box(WINDOW.w + 0.12, 0.06, 0.1, p.x, p.y - WINDOW.h / 2 - 0.03, z1 + 0.04, CELL.white, { color: look.trim, span: 0 });
    else front.box(0.1, 0.06, WINDOW.w + 0.12, x1 + 0.04, p.y - WINDOW.h / 2 - 0.03, p.z, CELL.white, { color: look.trim, span: 0 });
  }
  front.box(0.84, 1.16, 0.06, LOBBY.doorX, 0.58, z1 + 0.02, CELL.white, { color: look.trim, span: 0 });
  front.box(0.68, 1.04, 0.08, LOBBY.doorX, 0.52, z1 + 0.035, CELL.wood, { r: 0.015 });
  front.ball(0.035, LOBBY.doorX + 0.24, 0.52, z1 + 0.09, CELL.steel, { detail: 4 });

  // The roof with its parapet; garden worlds are a greenhouse under an arch of glass.
  const roof = new Shape(height + 2, height - 0.2);
  const glow = new Glow();
  if (glass) {
    roof.cyl(d / 2 + 0.05, d / 2 + 0.05, w + 0.1, cx, height, cz, CELL.sky, { sides: 12, open: true, color: '#E4F4EE', span: 0.3, rot: [0, 0, Math.PI / 2] });
    for (const x of [x0, cx, x1]) roof.ring(d / 2 + 0.06, 0.04, x, height, cz, CELL.white, { arc: Math.PI, rot: [0, Math.PI / 2, 0], sides: 8, radial: 4, color: look.trim });
    for (let x = x0 + 0.5; x < x1; x += 0.7) {
      front.box(0.05, height, 0.05, x, height / 2, z1 + 0.03, CELL.white, { color: look.trim, span: 0 });
    }
  } else {
    roof.box(w + 0.24, 0.16, d + 0.24, cx, height + 0.08, cz, CELL.white, { color: shadeHex(look.wall, 0.12), r: 0.03 });
    roof.box(w + 0.24, 0.16, 0.1, cx, height + 0.24, z1 + 0.07, CELL.white, { color: look.trim, r: 0 });
    roof.box(w + 0.24, 0.16, 0.1, cx, height + 0.24, z0 - 0.07, CELL.white, { color: look.trim, r: 0 });
    roof.box(0.1, 0.16, d + 0.04, x0 - 0.07, height + 0.24, cz, CELL.white, { color: look.trim, r: 0 });
    roof.box(0.1, 0.16, d + 0.04, x1 + 0.07, height + 0.24, cz, CELL.white, { color: look.trim, r: 0 });
  }
  const top = height + 0.16;

  // The door lamp: warm, always on, the one light a resting world keeps.
  glow.box(0.12, 0.16, 0.1, LOBBY.doorX + 0.56, 1.22, z1 + 0.08, { color: '#FFD98A' });
  front.box(0.18, 0.06, 0.16, LOBBY.doorX + 0.56, 1.33, z1 + 0.06, CELL.ink, { r: 0.015 });

  switch (theme) {
    case 'office': {
      // A rooftop unit with its fan, and a small tree by the door.
      roof.box(1.3, 0.6, 1.0, x1 - 1.1, top + 0.3, z0 + 0.9, CELL.white, { color: '#C9CDCB', r: 0.05 });
      roof.cyl(0.32, 0.32, 0.06, x1 - 1.1, top + 0.62, z0 + 0.9, CELL.steel, { sides: 10 });
      tree(body, LOBBY.doorX - 0.95, z1 + 0.9, 0);
      break;
    }
    case 'cafe': {
      // A striped awning over the ground floor's front, and two tables outside.
      for (let i = 0; i < 9; i++) {
        const x = x0 + 0.2 + i * ((w - 0.4) / 9) + (w - 0.4) / 18;
        front.box((w - 0.4) / 9 + 0.01, 0.06, 0.8, x, 1.28, z1 + 0.4, CELL.white, { color: i % 2 ? '#FBF7F0' : accent, rot: [0.38, 0, 0], span: 0 });
      }
      for (const [x, z] of [[0.6, 2.4], [1.9, 1.7]] as const) {
        body.cyl(0.32, 0.32, 0.05, x, 0.62, z, CELL.white, { color: '#F4F0E8', sides: 10 });
        body.cyl(0.04, 0.04, 0.6, x, 0.31, z, CELL.ink, { sides: 6 });
        for (const dx of [-0.42, 0.42]) body.cyl(0.13, 0.13, 0.36, x + dx, 0.18, z, CELL.white, { color: accent, sides: 8 });
      }
      break;
    }
    case 'game-studio': {
      // A big controller on the roof.
      const sx = cx + 0.4;
      const sz = cz + 0.3;
      roof.box(0.12, 0.7, 0.12, sx - 0.8, top + 0.35, sz, CELL.steel, { r: 0.03 });
      roof.box(0.12, 0.7, 0.12, sx + 0.8, top + 0.35, sz, CELL.steel, { r: 0.03 });
      roof.box(2.6, 1.0, 0.26, sx, top + 1.2, sz, CELL.white, { color: '#E9E4DA', r: 0.12 });
      roof.box(0.62, 0.16, 0.06, sx - 0.65, top + 1.2, sz + 0.15, CELL.ink, { r: 0.02 });
      roof.box(0.16, 0.62, 0.06, sx - 0.65, top + 1.2, sz + 0.15, CELL.ink, { r: 0.02 });
      ['#E58FA0', '#6FAE6A', '#E2BF4F', '#5B8FC7'].forEach((c, i) => roof.ball(0.1, sx + 0.6 + (i % 2 ? 0.22 : -0.22) * (i < 2 ? 1 : 0), top + 1.2 + (i >= 2 ? (i === 2 ? 0.22 : -0.22) : 0), sz + 0.15, CELL.white, { color: c, detail: 5 }));
      break;
    }
    case 'shop': {
      // An awning over the shop window and an Open sign hanging by the door.
      front.box(w - 1.6, 0.08, 0.6, cx + 0.5, 1.3, z1 + 0.3, CELL.white, { color: accent, rot: [0.3, 0, 0], r: 0.02 });
      front.box(0.05, 0.4, 0.05, LOBBY.doorX - 0.6, 1.25, z1 + 0.25, CELL.ink);
      front.box(0.56, 0.3, 0.05, LOBBY.doorX - 0.6, 1.0, z1 + 0.28, CELL.ink, { r: 0.02 });
      glow.box(0.46, 0.2, 0.02, LOBBY.doorX - 0.6, 1.0, z1 + 0.31, { color: '#9FE0B0' });
      break;
    }
    case 'lab': {
      // A dish and an aerial on the roof.
      roof.box(0.16, 0.5, 0.16, x1 - 1.2, top + 0.25, z0 + 1.1, CELL.steel, { r: 0.04 });
      roof.ball(0.62, x1 - 1.2, top + 0.85, z0 + 1.1, CELL.white, { color: '#F4F5F2', sy: 0.35, detail: 10, rot: [0.7, Math.PI / 4, 0] });
      roof.cyl(0.03, 0.03, 1.2, x0 + 0.8, top + 0.6, z0 + 0.6, CELL.steel, { sides: 5 });
      glow.box(0.08, 0.08, 0.08, x0 + 0.8, top + 1.22, z0 + 0.6, { color: '#7CC8FF' });
      break;
    }
    case 'garden': {
      // Plants inside the glass and planters outside.
      for (let i = 0; i < 3; i++) body.ball(0.5, x0 + 1.1 + i * 1.7, 0.42, cz, i % 2 ? CELL.leaf : CELL.leafLight, { sy: 0.9, detail: 5 });
      for (const x of [0.4, 2.2]) {
        body.box(1.2, 0.36, 0.5, x, 0.18, 2.4, CELL.wood, { r: 0.03 });
        for (let k = 0; k < 3; k++) body.ball(0.2, x - 0.38 + k * 0.38, 0.46, 2.4, k % 2 ? CELL.leaf : CELL.leafLight, { detail: 4 });
      }
      break;
    }
    case 'city': {
      // The street along the front, with its kerb, dashes and a street lamp on the corner.
      body.box(pw - 0.4, 0.035, 1.3, 0, 0.03, pd / 2 - 0.85, CELL.white, { color: '#5E615F', span: 0 });
      body.box(pw - 0.4, 0.07, 0.16, 0, 0.05, pd / 2 - 1.58, CELL.white, { color: '#D4D0C8', span: 0 });
      for (let x = -pw / 2 + 0.7; x < pw / 2 - 0.4; x += 1.2) body.box(0.6, 0.04, 0.08, x, 0.05, pd / 2 - 0.85, CELL.white, { color: '#F4F1EA', span: 0 });
      body.cyl(0.05, 0.06, 2.4, x1 + 0.9, 1.2, z1 + 1.0, CELL.ink, { sides: 6 });
      body.box(0.4, 0.08, 0.16, x1 + 0.75, 2.4, z1 + 1.0, CELL.ink, { r: 0.02 });
      glow.box(0.22, 0.06, 0.12, x1 + 0.62, 2.34, z1 + 1.0, { color: '#FFE4A8' });
      break;
    }
    case 'arcade': {
      // Neon over the door and along the roof's edge.
      glow.box(1.4, 0.08, 0.04, LOBBY.doorX + 0.3, 1.5, z1 + 0.06, { color: accent });
      glow.box(1.4, 0.08, 0.04, LOBBY.doorX + 0.3, 1.74, z1 + 0.06, { color: '#4FA3B8' });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
        glow.box(0.22, 0.04, 0.03, LOBBY.doorX + 1.3 + Math.cos(a) * 0.08, 1.62 + Math.sin(a) * 0.08, z1 + 0.07, { color: '#F2D27A', rot: [0, 0, a + Math.PI / 2] });
      }
      glow.box(w + 0.2, 0.05, 0.04, cx, height + 0.33, z1 + 0.13, { color: accent });
      break;
    }
    case 'music-studio': {
      // A big record on the roof.
      roof.box(0.12, 0.6, 0.12, cx, top + 0.3, cz, CELL.steel, { r: 0.03 });
      roof.cyl(0.95, 0.95, 0.08, cx, top + 1.5, cz, CELL.ink, { sides: 18, rot: [Math.PI / 2, Math.PI / 4, 0] });
      roof.cyl(0.36, 0.36, 0.1, cx, top + 1.5, cz, CELL.white, { color: accent, sides: 14, rot: [Math.PI / 2, Math.PI / 4, 0] });
      roof.cyl(0.05, 0.05, 0.12, cx, top + 1.5, cz, CELL.ink, { sides: 6, rot: [Math.PI / 2, Math.PI / 4, 0] });
      break;
    }
  }

  const parts = { body: body.build(), front: front.build(), roof: roof.build(), glow: glow.build() };
  const triangles = trianglesOf(parts.body) + trianglesOf(parts.front) + trianglesOf(parts.roof) + (parts.glow ? trianglesOf(parts.glow) : 0);
  return { ...parts, height, triangles };
}

function tree(s: Shape, x: number, z: number, seed: number) {
  s.cyl(0.07, 0.09, 0.7, x, 0.35, z, CELL.bark, { sides: 6 });
  for (let i = 0; i < 3; i++) s.ball(0.42 - i * 0.08, x + (i - 1) * 0.12, 0.9 + i * 0.28, z + ((seed + i) % 2) * 0.1, i % 2 ? CELL.leaf : CELL.leafLight, { detail: 6 });
}

/** The figure who waits at the door with a yellow paper when the company needs you: a posed, still little person. */
export function doorFigure(): { solid: BufferGeometry; glow: BufferGeometry | null } {
  const s = new Shape(1.25, 0);
  for (const x of [-0.09, 0.09]) s.box(0.13, 0.42, 0.14, x, 0.21, 0, CELL.white, { color: '#3B4A5C', r: 0.04 });
  s.box(0.42, 0.42, 0.26, 0, 0.62, 0, CELL.white, { color: '#8E7CC3', r: 0.09 });
  s.ball(0.2, 0, 0.98, 0.0, CELL.white, { color: '#E8B996', detail: 7 });
  s.ball(0.21, 0, 1.04, -0.04, CELL.white, { color: '#4A3424', sy: 0.75, detail: 6 });
  for (const x of [-0.17, 0.17]) s.box(0.1, 0.1, 0.3, x, 0.66, 0.15, CELL.white, { color: '#8E7CC3', r: 0 });
  const glow = new Glow().quad(0.32, 0.4, 0, 0.74, 0.31, { color: '#F2D541', rot: [-0.25, 0, 0] }).build();
  return { solid: s.build(), glow };
}
