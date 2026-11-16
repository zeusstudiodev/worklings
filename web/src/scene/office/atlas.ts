// The KayKit gradient atlases as the office samples them: named cells of the Furniture Bits atlas for the pieces made
// here, and recolouring a pack piece by atlas block for a theme (src/core/themes.ts). Pure three.js, no DOM, so the
// tests run it as the scene does.
import { type BufferAttribute, type BufferGeometry, Color } from 'three';
import { type ArtPack, type Block, type BlockColours, PACK_ATLAS } from '../../../../src/core/themes.ts';

/** A place in an atlas: `u` across the whole atlas (chosen clear of the wood blocks' plank lines) and a block row. */
export interface Cell {
  u: number;
  row: number;
}

/** The Furniture Bits atlas, 8 by 4 blocks of vertical gradients, light at the top. */
export const CELL = {
  woodRed: { u: 0.05, row: 0 },
  wood: { u: 0.42, row: 0 },
  birch: { u: 0.69, row: 0 },
  steel: { u: 0.79, row: 0 },
  white: { u: 0.94, row: 0 },
  sun: { u: 0.12, row: 1 },
  sky: { u: 0.31, row: 1 },
  paper: { u: 0.68, row: 1 },
  rust: { u: 0.94, row: 1 },
  cream: { u: 0.19, row: 2 },
  ink: { u: 0.29, row: 2 },
  frost: { u: 0.44, row: 2 },
  tan: { u: 0.56, row: 2 },
  bark: { u: 0.66, row: 2 },
  leafLight: { u: 0.81, row: 2 },
  leaf: { u: 0.94, row: 2 },
} as const satisfies Record<string, Cell>;

/** The height of one block row in UV space, and the margin kept inside it so nothing samples the next block. */
export const ROW = 0.25;
const EDGE = 0.012;
const SPAN = ROW - EDGE * 2;

/** Where in a cell's gradient a point falls: 0 is the light top of the block, 1 the dark bottom. */
export const cellV = (cell: Cell, along: number): number => cell.row * ROW + EDGE + Math.min(1, Math.max(0, along)) * SPAN;

const BLOCK_PARTS = /^r(\d+)c(\d+)$/;

/** The block a UV falls in, for an atlas of so many columns and rows. */
export function blockAt(u: number, v: number, cols: number, rows: number): Block {
  const c = Math.min(cols - 1, Math.max(0, Math.floor(u * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(v * rows)));
  return `r${r}c${c}`;
}

/** A block's row and column. */
export function blockPlace(block: Block): { row: number; col: number } {
  const m = BLOCK_PARTS.exec(block);
  if (!m) throw new Error(`not an atlas block: ${block}`);
  return { row: Number(m[1]), col: Number(m[2]) };
}

/**
 * A pack piece in a theme's colours: every vertex whose block has a colour moves to the pack's white block, keeping
 * its place in the gradient so KayKit's shading stays, and takes that colour as its vertex colour, times the piece's baked occlusion. Other vertices keep
 * the pack's own colours. Returns a new geometry; the one given is left as it is.
 */
export function recolour(geometry: BufferGeometry, pack: ArtPack, colours: BlockColours): BufferGeometry {
  const out = geometry.clone();
  const entries = Object.entries(colours).filter((e): e is [Block, string] => typeof e[1] === 'string');
  if (entries.length === 0) return out;
  const { cols, rows, white } = PACK_ATLAS[pack];
  const target = blockPlace(white);
  const swap = new Map(entries.map(([block, hex]) => [block, new Color(hex)]));
  const uv = out.getAttribute('uv') as BufferAttribute;
  const colour = out.getAttribute('color') as BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const c = swap.get(blockAt(u, v, cols, rows));
    if (!c) continue;
    const within = v * rows - Math.min(rows - 1, Math.floor(v * rows));
    uv.setXY(i, (target.col + 0.5) / cols, (target.row + 0.04 + within * 0.92) / rows);
    colour.setXYZ(i, c.r * colour.getX(i), c.g * colour.getY(i), c.b * colour.getZ(i));
  }
  uv.needsUpdate = true;
  colour.needsUpdate = true;
  return out;
}

/** The atlas blocks a geometry samples, sorted: what a recolour can change. */
export function blocksOf(geometry: BufferGeometry, pack: ArtPack): Block[] {
  const { cols, rows } = PACK_ATLAS[pack];
  const uv = geometry.getAttribute('uv');
  const found = new Set<Block>();
  for (let i = 0; i < uv.count; i++) found.add(blockAt(uv.getX(i), uv.getY(i), cols, rows));
  return [...found].sort();
}
