// glTF reading and writing for the art build: gltf-transform with meshoptimizer's codec, and the few accessor
// helpers the steps share.
import { type Accessor, Document, Logger, NodeIO, type TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

let io: NodeIO | null = null;

// gltf-transform reports every step at INFO; the build prints its own table, so only warnings come through.
const quiet = new Logger(Logger.Verbosity.WARN);

/** A new, empty glTF document that only logs warnings. */
export function newDocument(): Document {
  return new Document().setLogger(quiet);
}

/** One reader and writer for the run, able to read the packs' meshopt files and write compressed ones. */
export async function gltfIO(): Promise<NodeIO> {
  if (io) return io;
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  io = new NodeIO()
    .setLogger(quiet)
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  return io;
}

/**
 * Prunes what nothing uses, then reorders, quantizes and compresses with meshopt (EXT_meshopt_compression and
 * KHR_mesh_quantization): positions on a 14-bit grid, normals and quaternions with meshopt's filters, animation
 * outputs filtered too. Returns the GLB's bytes.
 */
export async function compressedGlb(doc: Document): Promise<Uint8Array> {
  await doc.transform(prune(), dedup());
  if (doc.getRoot().listMeshes().length > 0) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  // Animation alone: nothing to reorder or quantize, but the same filtered compression on write.
  else doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  return (await gltfIO()).writeBinary(doc);
}

/** An accessor's elements as plain floats, normalized integers scaled back to their range. */
export function floats(accessor: Accessor): Float32Array {
  const size = accessor.getElementSize();
  const out = new Float32Array(accessor.getCount() * size);
  const element: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.getElement(i, element);
    for (let k = 0; k < size; k++) out[i * size + k] = element[k] ?? 0;
  }
  return out;
}

/** An index accessor's values, or 0..count-1 for a primitive without one. */
export function indicesOf(indices: Accessor | null, count: number): Uint32Array {
  if (!indices) return Uint32Array.from({ length: count }, (_, i) => i);
  return Uint32Array.from(indices.getArray() ?? []);
}

/** What three.js calls a node: GLTFLoader drops dots, brackets, colons and slashes and turns spaces into `_`. */
export function threeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
}

/**
 * Atlases are sampled without mipmaps (LINEAR, 9729) and clamped (CLAMP_TO_EDGE, 33071): their colour blocks sit side
 * by side, and mipmaps would blend them into each other on small people and far furniture.
 */
export function atlasSampler(info: TextureInfo | null): void {
  info?.setMinFilter(9729).setMagFilter(9729).setWrapS(33071).setWrapT(33071);
}
