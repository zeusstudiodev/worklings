// Scenery from the KayKit Bits packs: the pieces the theme catalogue (src/core/themes.ts) draws from a pack, one
// node and mesh each in one file per pack, sharing the pack's atlas. Pieces keep the pack's own colours and scale;
// the office recolours them by atlas block for a theme and scales them as the catalogue says. Each piece carries
// baked ambient occlusion in its vertex colours (occlusion.ts).
import { type Document, type NodeIO } from '@gltf-transform/core';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { type ArtPack, packPieces } from '../../src/core/themes.ts';
import { atlasSampler, floats, indicesOf, newDocument } from './gltf.ts';
import { bakeOcclusion } from './occlusion.ts';
import { decodePng, downscale, encodePng } from './png.ts';

export const PACK_FILES: Readonly<Record<ArtPack, { folder: string; licence: string; atlas: string }>> = {
  'furniture-bits': {
    folder: 'furniture-bits/extracted/KayKit_Furniture_Bits_1.0_FREE/Assets/gltf',
    licence: 'furniture-bits/extracted/KayKit_Furniture_Bits_1.0_FREE/License.txt',
    atlas: 'furniturebits_texture',
  },
  'restaurant-bits': {
    folder: 'restaurant-bits/extracted/KayKit_Restaurant_Bits_1.0_FREE/Assets/gltf',
    licence: 'restaurant-bits/extracted/KayKit_Restaurant_Bits_1.0_FREE/License.txt',
    atlas: 'restaurantbits_texture',
  },
};

export interface PieceReport {
  name: string;
  triangles: number;
  /** Lowest and mean baked brightness (1 is open). */
  shade: { min: number; mean: number };
  min: [number, number, number];
  max: [number, number, number];
}

export interface SceneryResult {
  doc: Document;
  pieces: PieceReport[];
  atlas: { from: string; to: string; bytes: number };
}

/** One pack's pieces, each with its nodes' transforms baked in, and the pack's atlas halved, lossless. */
export async function buildScenery(pack: ArtPack, raw: string, io: NodeIO): Promise<SceneryResult> {
  const { folder, atlas: atlasName } = PACK_FILES[pack];
  const doc = newDocument();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(pack);
  doc.getRoot().setDefaultScene(scene);
  const pieces: PieceReport[] = [];
  let atlas: Uint8Array | null = null;
  const names = packPieces(pack);
  if (names.length === 0) throw new Error(`${pack}: the catalogue uses none of its pieces`);
  for (const name of names) {
    const source = await io.read(`${raw}/${folder}/${name}.gltf`);
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const node of source.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const world = new Matrix4().fromArray(node.getWorldMatrix());
      const turn = new Matrix3().getNormalMatrix(world);
      for (const prim of mesh.listPrimitives()) {
        const image = prim.getMaterial()?.getBaseColorTexture();
        if (!image?.getURI().includes(atlasName)) throw new Error(`${pack}: ${name} doesn't draw from ${atlasName}`);
        atlas ??= image.getImage();
        const pos = prim.getAttribute('POSITION');
        const nor = prim.getAttribute('NORMAL');
        const uv = prim.getAttribute('TEXCOORD_0');
        if (!pos || !nor || !uv) throw new Error(`${pack}: ${name} lacks positions, normals or UVs`);
        const p = floats(pos);
        const n = floats(nor);
        const base = positions.length / 3;
        const v = new Vector3();
        for (let i = 0; i < p.length / 3; i++) {
          v.set(p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0).applyMatrix4(world);
          positions.push(v.x, v.y, v.z);
          v.set(n[i * 3] ?? 0, n[i * 3 + 1] ?? 0, n[i * 3 + 2] ?? 0).applyMatrix3(turn).normalize();
          normals.push(v.x, v.y, v.z);
        }
        uvs.push(...floats(uv));
        for (const index of indicesOf(prim.getIndices(), p.length / 3)) indices.push(base + index);
      }
    }
    if (indices.length === 0) throw new Error(`${pack}: ${name} has no triangles`);
    const accessor = (type: 'SCALAR' | 'VEC2' | 'VEC3', array: Float32Array | Uint32Array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    // Occlusion baked into one byte per vertex, 255 for open (the office multiplies it into the theme's colours).
    const shade = bakeOcclusion({ positions, normals, indices });
    const bytes = Uint8Array.from(shade, (value) => Math.round((Math.round(value * 32) / 32) * 255));
    const prim = doc
      .createPrimitive()
      .setIndices(accessor('SCALAR', Uint32Array.from(indices)))
      .setAttribute('POSITION', accessor('VEC3', Float32Array.from(positions)))
      .setAttribute('NORMAL', accessor('VEC3', Float32Array.from(normals)))
      .setAttribute('TEXCOORD_0', accessor('VEC2', Float32Array.from(uvs)))
      .setAttribute('_OCCLUSION', doc.createAccessor().setType('SCALAR').setArray(bytes).setNormalized(true).setBuffer(buffer));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
    const axis = (k: number) => positions.filter((_, i) => i % 3 === k);
    const [xs, ys, zs] = [axis(0), axis(1), axis(2)];
    pieces.push({
      name,
      triangles: indices.length / 3,
      shade: { min: Math.min(...shade), mean: shade.reduce((a, b) => a + b, 0) / shade.length },
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    });
  }
  if (!atlas) throw new Error(`${pack}: no atlas`);
  const decoded = decodePng(atlas, `${pack} atlas`);
  const halved = downscale(decoded, 2, 2);
  const png = encodePng(halved);
  const texture = doc.createTexture(`${pack}-atlas`).setImage(png).setMimeType('image/png');
  const material = doc.createMaterial(pack).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(0.78);
  atlasSampler(material.getBaseColorTextureInfo());
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(material);
  return { doc, pieces, atlas: { from: `${decoded.width}x${decoded.height}, ${atlas.byteLength} B`, to: `${halved.width}x${halved.height}`, bytes: png.byteLength } };
}
