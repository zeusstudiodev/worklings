// Geometry from the built art files, ready to merge into the office's static meshes. Pure three.js, no DOM.
import { BufferGeometry, Float32BufferAttribute, type Mesh, Uint16BufferAttribute, Uint32BufferAttribute } from 'three';

/** The attributes every static mesh of the office shares, so pieces from any pack merge into one draw call. */
export const STATIC_ATTRIBUTES = ['position', 'normal', 'uv', 'color'] as const;

/** The scenery files' baked occlusion, one normalized byte per vertex. */
export const OCCLUSION_ATTRIBUTE = '_occlusion';

const SIZES = { position: 3, normal: 3, uv: 2 } as const;

/**
 * A scenery piece as plain geometry: float attributes (the files are quantized, and three's applyMatrix4 can't write
 * values outside a normalized attribute's range), the piece's node transform baked in (that includes the scale and
 * offset that undo the quantization), a vertex colour to recolour by atlas block (the baked occlusion as grey, white where a piece has none), and an index.
 */
export function bakedGeometry(mesh: Mesh): BufferGeometry {
  mesh.updateWorldMatrix(true, false);
  const source = mesh.geometry;
  const out = new BufferGeometry();
  for (const [name, size] of Object.entries(SIZES)) {
    const attribute = source.getAttribute(name);
    if (!attribute) throw new Error(`${mesh.name}: no ${name} attribute`);
    const array = new Float32Array(attribute.count * size);
    for (let i = 0; i < attribute.count; i++) for (let k = 0; k < size; k++) array[i * size + k] = attribute.getComponent(i, k);
    out.setAttribute(name, new Float32BufferAttribute(array, size));
  }
  const count = out.getAttribute('position').count;
  // The baked occlusion (build: scripts/art/occlusion.ts) is the colour's grey; GLTFLoader lower-cases `_OCCLUSION`.
  const shade = source.getAttribute(OCCLUSION_ATTRIBUTE);
  const colour = new Float32Array(count * 3).fill(1);
  if (shade) for (let i = 0; i < count; i++) colour.fill(shade.getX(i), i * 3, i * 3 + 3);
  out.setAttribute('color', new Float32BufferAttribute(colour, 3));
  const index = source.getIndex();
  const indices = index ? Array.from({ length: index.count }, (_, i) => index.getX(i)) : Array.from({ length: count }, (_, i) => i);
  out.setIndex(count > 65535 ? new Uint32BufferAttribute(indices, 1) : new Uint16BufferAttribute(indices, 1));
  out.applyMatrix4(mesh.matrixWorld);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
