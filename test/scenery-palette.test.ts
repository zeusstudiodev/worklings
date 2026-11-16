// Themes as palette swaps (web/src/scene/office/atlas.ts) and the pieces made here in KayKit's style (shape.ts,
// made.ts): recolouring by atlas block keeps the gradient, and every made piece samples the atlas the same way.
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { THEMES } from '../src/core/looks.ts';
import { type ArtPack, PACK_ATLAS, PIECES, pieceOf, THEME_LOOKS } from '../src/core/themes.ts';
import { blockAt, blocksOf, CELL, recolour } from '../web/src/scene/office/atlas.ts';
import type { PackKit } from '../web/src/scene/office/build.ts';
import { FRONT_DESKS } from '../web/src/scene/office/fronts.ts';
import { MADE } from '../web/src/scene/office/made.ts';
import { trianglesOf } from '../web/src/scene/office/merge.ts';
import { Shape } from '../web/src/scene/office/shape.ts';
import { readPacks } from './scenery-kit.ts';

let packs: Record<ArtPack, PackKit>;
beforeAll(async () => {
  packs = await readPacks();
});

/** Two vertices in the yellow fabric block (r1c0), one in the white (r0c7), with their place in each gradient. */
function swatch(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0.1, 0.26, 0.1, 0.49, 0.94, 0.1], 2));
  g.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  return g;
}

const CHAIR = 'chair_A';
const chair = () => {
  const g = packs['furniture-bits'].pieces.get(CHAIR);
  if (!g) throw new Error(`Furniture Bits has no ${CHAIR}`);
  return g;
};

describe('recolouring by atlas block', () => {
  it('moves a listed block to the white block, keeps each vertex’s place in the gradient and gives it the colour', () => {
    const out = recolour(swatch(), 'furniture-bits', { r1c0: '#336699' });
    const uv = out.getAttribute('uv');
    const white = PACK_ATLAS['furniture-bits'].white;
    expect(blockAt(uv.getX(0), uv.getY(0), 8, 4)).toBe(white);
    expect(blockAt(uv.getX(1), uv.getY(1), 8, 4)).toBe(white);
    // Lighter at the top of the block stays lighter: the order down the gradient is kept.
    expect(uv.getY(0)).toBeLessThan(uv.getY(1));
    const c = new Color('#336699');
    const colour = out.getAttribute('color');
    expect(colour.getX(0)).toBeCloseTo(c.r, 6);
    expect(colour.getY(0)).toBeCloseTo(c.g, 6);
    expect(colour.getZ(0)).toBeCloseTo(c.b, 6);
  });

  it('multiplies the piece’s baked occlusion into the theme colour', () => {
    const source = swatch();
    source.getAttribute('color').setXYZ(0, 0.5, 0.5, 0.5);
    const out = recolour(source, 'furniture-bits', { r1c0: '#336699' });
    const c = new Color('#336699');
    const colour = out.getAttribute('color');
    expect(colour.getX(0)).toBeCloseTo(c.r * 0.5, 6);
    expect(colour.getY(0)).toBeCloseTo(c.g * 0.5, 6);
    expect(colour.getZ(0)).toBeCloseTo(c.b * 0.5, 6);
  });

  it('leaves blocks it wasn’t given, and the geometry it was given, as they were', () => {
    const source = swatch();
    const out = recolour(source, 'furniture-bits', { r1c0: '#336699' });
    expect(out.getAttribute('uv').getX(2)).toBeCloseTo(0.94, 6);
    expect(out.getAttribute('uv').getY(2)).toBeCloseTo(0.1, 6);
    expect(out.getAttribute('color').getX(2)).toBe(1);
    expect(source.getAttribute('uv').getY(0)).toBeCloseTo(0.26, 6);
    expect(source.getAttribute('color').getX(0)).toBe(1);
  });

  it('turns KayKit’s blue chair into a theme’s colour: nothing left in the blue block', () => {
    expect(blocksOf(chair(), 'furniture-bits')).toContain('r1c2');
    const out = recolour(chair(), 'furniture-bits', { r1c2: '#C9705B' });
    expect(blocksOf(out, 'furniture-bits')).not.toContain('r1c2');
  });

  it('recolours only blocks the theme lists, for every theme’s swap', () => {
    for (const theme of THEMES) {
      const swap = THEME_LOOKS[theme].recolour.packs['furniture-bits'] ?? {};
      const out = recolour(chair(), 'furniture-bits', swap);
      const left = new Set(blocksOf(out, 'furniture-bits'));
      for (const block of Object.keys(swap)) expect(left.has(block as `r${number}c${number}`), `${theme} ${block}`).toBe(false);
    }
  });
});

describe('pieces made here', () => {
  it('sample the atlas like KayKit’s own: a part’s UVs stay in its colour block, lighter at the top', () => {
    const s = new Shape(1, 0);
    s.box(1, 1, 1, 0, 0.5, 0, CELL.birch);
    const g = s.build();
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    let top = -1;
    let bottom = -1;
    for (let i = 0; i < uv.count; i++) {
      expect(blockAt(uv.getX(i), uv.getY(i), 8, 4)).toBe(blockAt(CELL.birch.u, CELL.birch.row * 0.25 + 0.1, 8, 4));
      if (pos.getY(i) > 0.99) top = uv.getY(i);
      if (pos.getY(i) < 0.01) bottom = uv.getY(i);
    }
    expect(top).toBeLessThan(bottom);
  });

  it('cover every piece the catalogue marks as made here', () => {
    const made = PIECES.filter((p) => p.draw.from === 'made').map((p) => p.id);
    expect(made.filter((id) => !(id in MADE))).toEqual([]);
  });

  it.each(PIECES.filter((p) => p.draw.from === 'made').map((p) => p.id))('builds %s on the floor (or its wall), in KayKit’s chunky budget', (id) => {
    const make = MADE[id];
    if (!make) throw new Error(`no ${id}`);
    const built = make({ accent: '#8FAE96', hue: '#5B8FC7', seed: 3, chart: { top: '#C9B458', rooms: [{ hue: '#5B8FC7', head: true, people: 5 }] } });
    expect(built.solid, id).not.toBeNull();
    const solid = built.solid;
    if (!solid) return;
    solid.computeBoundingBox();
    const box = solid.boundingBox;
    expect(box?.min.y, `${id} stands on the floor`).toBeGreaterThanOrEqual(-0.15);
    const uv = solid.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
    const triangles = trianglesOf(solid) + (built.glow ? trianglesOf(built.glow) : 0);
    expect(triangles, id).toBeLessThan(4000);
    // Its footprint is about the catalogue's (front desks are made to the floor plan's counter).
    const piece = pieceOf(id);
    if (piece?.place === 'floor' && box && !(id in FRONT_DESKS)) {
      expect(box.max.x - box.min.x, `${id} width`).toBeLessThan(piece.footprint[0] * 1.5 + 0.3);
      expect(box.max.z - box.min.z, `${id} depth`).toBeLessThan(piece.footprint[1] * 1.6 + 0.4);
    }
  });

  it.each(Object.keys(FRONT_DESKS))('makes the %s front desk to the counter’s size, low enough to see the people waiting', (id) => {
    const make = FRONT_DESKS[id];
    if (!make) throw new Error(`no ${id}`);
    const { solid } = make(4.4, 0.9, '#8FAE96');
    solid?.computeBoundingBox();
    const box = solid?.boundingBox;
    if (!box) throw new Error(`${id} has no geometry`);
    // Tall dressing only past the left half, which never stands between the camera and anyone in line.
    const tall = solid.getAttribute('position');
    for (let i = 0; i < tall.count; i++) if (tall.getY(i) > 1.5) expect(tall.getX(i), `${id} tall at x ${tall.getX(i).toFixed(2)}`).toBeLessThan(-0.9);
    expect(box.max.z - box.min.z).toBeLessThan(1.2);
  });
});
