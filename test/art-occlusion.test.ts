// The occlusion bake (scripts/art/occlusion.ts): corners darker than open surfaces, the same numbers every run, and
// the built scenery files carrying them.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { ART_PACKS } from '../src/core/themes.ts';
import { sceneryFile } from '../web/src/scene/art/spec.ts';
import { bakeOcclusion, type OcclusionInput } from '../scripts/art/occlusion.ts';

/** A box as the packs draw them: a vertex per face corner, so every vertex has its face's normal. */
function box(w: number, h: number, d: number, at: [number, number, number] = [0, 0, 0]): OcclusionInput & { count: number } {
  const g = new BoxGeometry(w, h, d).toNonIndexed();
  g.translate(...at);
  const positions = Array.from(g.getAttribute('position').array);
  const normals = Array.from(g.getAttribute('normal').array);
  return { positions, normals, indices: Array.from({ length: positions.length / 3 }, (_, i) => i), count: positions.length / 3 };
}

/** Two inputs as one piece. */
function join2(a: OcclusionInput, b: OcclusionInput): OcclusionInput {
  const offset = a.positions.length / 3;
  return {
    positions: [...Array.from(a.positions), ...Array.from(b.positions)],
    normals: [...Array.from(a.normals), ...Array.from(b.normals)],
    indices: [...Array.from(a.indices), ...Array.from(b.indices, (i) => i + offset)],
  };
}

describe('occlusion bake', () => {
  it('leaves the top of a box open and darkens the sides where they meet the floor', () => {
    const piece = box(1, 1, 1, [0, 0.5, 0]);
    const shade = bakeOcclusion(piece);
    let top = Infinity;
    let bottom = -Infinity; // the lightest side vertex on the floor
    for (let i = 0; i < piece.count; i++) {
      const y = piece.positions[i * 3 + 1] ?? 0;
      const ny = piece.normals[i * 3 + 1] ?? 0;
      if (ny > 0.9) top = Math.min(top, shade[i] ?? 1);
      if (Math.abs(ny) < 0.1 && y < 0.01) bottom = Math.max(bottom, shade[i] ?? 1);
    }
    expect(top).toBeCloseTo(1, 5);
    expect(bottom).toBeLessThan(0.85);
  });

  it('darkens a corner where two surfaces meet more than the same surface in the open', () => {
    // A slab with a wall rising at one end: the slab's top near the wall against its far end.
    const slab = box(4, 0.2, 1, [0, 0.1, 0]);
    const wall = box(0.2, 2, 1, [-1.9, 1, 0]);
    const piece = join2(slab, wall);
    const shade = bakeOcclusion(piece);
    let nearWall = Infinity;
    let farEnd = -Infinity;
    for (let i = 0; i < slab.count; i++) {
      if ((slab.normals[i * 3 + 1] ?? 0) < 0.9) continue;
      const x = slab.positions[i * 3] ?? 0;
      if (x < -1.5) nearWall = Math.min(nearWall, shade[i] ?? 1);
      if (x > 1.5) farEnd = Math.max(farEnd, shade[i] ?? 1);
    }
    expect(nearWall).toBeLessThan(farEnd - 0.05);
  });

  it('gives the same numbers every time and keeps them inside the strength', () => {
    const piece = join2(box(2, 0.1, 1, [0, 0.8, 0]), box(0.1, 0.8, 0.1, [-0.9, 0.4, 0]));
    const a = bakeOcclusion(piece, { strength: 0.5 });
    const b = bakeOcclusion(piece, { strength: 0.5 });
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('does nothing with strength 0', () => {
    const shade = bakeOcclusion(box(1, 1, 1, [0, 0.5, 0]), { strength: 0 });
    expect(Array.from(shade).every((v) => v === 1)).toBe(true);
  });
});

describe('built scenery', () => {
  it.each([...ART_PACKS])('%s: every piece carries baked occlusion, some of it dark, none black', async (pack) => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(join(fileURLToPath(new URL('../web/public/art/', import.meta.url)), sceneryFile(pack)));
    for (const mesh of doc.getRoot().listMeshes()) {
      const shade = mesh.listPrimitives()[0]?.getAttribute('_OCCLUSION');
      expect(shade, `${mesh.getName()} has no occlusion`).toBeTruthy();
      const e: number[] = [];
      let min = 1;
      let max = 0;
      for (let i = 0; i < (shade?.getCount() ?? 0); i++) {
        const v = shade?.getElement(i, e)[0] ?? 1;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(min, `${mesh.getName()} is too dark`).toBeGreaterThanOrEqual(0.45);
      expect(max, `${mesh.getName()} has no open surface`).toBeGreaterThan(0.95);
    }
  });
});
