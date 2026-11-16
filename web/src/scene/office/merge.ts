// Merging many small geometries into one: the office's static meshes are a handful of these, one per material, so
// the building costs about a dozen draw calls whatever its size. Pure three.js, so the tests measure what the scene draws.
import { BufferAttribute, BufferGeometry, Matrix3, type Matrix4, Vector3 } from 'three';

/** The attributes every static mesh of the office carries, so any part can join any bucket. */
export const ATTRIBUTES = ['position', 'normal', 'uv', 'color'] as const;
type Attribute = (typeof ATTRIBUTES)[number];
const SIZE: Readonly<Record<Attribute, number>> = { position: 3, normal: 3, uv: 2, color: 3 };

/** A geometry where it goes: moved by its matrix (none: as it is) and, optionally, its vertex colours multiplied. */
export interface Part {
  geometry: BufferGeometry;
  matrix?: Matrix4 | null;
  /** Linear RGB to multiply the part's vertex colours by. */
  tint?: readonly [number, number, number] | null;
}

/** Triangles in a geometry, indexed or not. */
export const trianglesOf = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/**
 * One indexed geometry from many parts, with positions and normals moved by each part's matrix. A part without UVs
 * samples the atlas's corner, one without colours is white, and an unindexed part counts its vertices in order, so
 * parts made any way merge. Indices are 16-bit while the vertices fit, which halves the index buffer.
 */
export function mergeParts(parts: readonly Part[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const { geometry } of parts) {
    const count = geometry.getAttribute('position').count;
    vertices += count;
    indices += geometry.index ? geometry.index.count : count;
  }
  const arrays: Record<Attribute, Float32Array> = {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    uv: new Float32Array(vertices * 2),
    color: new Float32Array(vertices * 3),
  };
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  const v = new Vector3();
  const turn = new Matrix3();
  let base = 0;
  let at = 0;
  for (const { geometry, matrix, tint } of parts) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const colour = geometry.getAttribute('color');
    if (!normal) throw new Error('a part to merge has no normals');
    if (matrix) turn.getNormalMatrix(matrix);
    const [tr, tg, tb] = tint ?? [1, 1, 1];
    const { position: p, normal: n, uv: t, color: c } = arrays;
    for (let i = 0; i < position.count; i++) {
      const o = base + i;
      v.fromBufferAttribute(position, i);
      if (matrix) v.applyMatrix4(matrix);
      p[o * 3] = v.x;
      p[o * 3 + 1] = v.y;
      p[o * 3 + 2] = v.z;
      v.fromBufferAttribute(normal, i);
      if (matrix) v.applyMatrix3(turn).normalize();
      n[o * 3] = v.x;
      n[o * 3 + 1] = v.y;
      n[o * 3 + 2] = v.z;
      if (uv) {
        t[o * 2] = uv.getX(i);
        t[o * 2 + 1] = uv.getY(i);
      }
      c[o * 3] = (colour ? colour.getX(i) : 1) * tr;
      c[o * 3 + 1] = (colour ? colour.getY(i) : 1) * tg;
      c[o * 3 + 2] = (colour ? colour.getZ(i) : 1) * tb;
    }
    const source = geometry.index;
    const count = source ? source.count : position.count;
    for (let k = 0; k < count; k++) index[at + k] = base + (source ? source.getX(k) : k);
    at += count;
    base += position.count;
  }
  const out = new BufferGeometry();
  for (const name of ATTRIBUTES) out.setAttribute(name, new BufferAttribute(arrays[name], SIZE[name]));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
