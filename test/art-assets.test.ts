// The built art in web/public/art, read back the way the office's files are checked: through gltf-transform, and
// through the meshopt decoder three ships, which is the one the browser runs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Document, type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { MeshoptDecoder as BrowserDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodePng } from '../scripts/art/png.ts';
import { LOOK_BODIES } from '../src/core/looks.ts';
import { ART_PACKS, packPieces, PIECES } from '../src/core/themes.ts';
import { ADDITIVE_CLIPS, ART_BUDGET, ART_FILES, bodyFile, CLIP_NAMES, CLIPS_FILE, JOINT_PARENT, JOINTS, ROLES, sceneryFile } from '../web/src/scene/art/spec.ts';

const ART = fileURLToPath(new URL('../web/public/art/', import.meta.url));
let io: NodeIO;
const docs = new Map<string, Document>();
const read = (file: string) => {
  const doc = docs.get(file);
  if (!doc) throw new Error(`${file} was not read`);
  return doc;
};

beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const file of ART_FILES) docs.set(file, await io.read(join(ART, file)));
});

const sizeOf = (file: string) => statSync(join(ART, file)).size;
/** The made layers that move (scripts/art/made.ts); every other made layer is a still pose. */
const MOVING_LAYERS: ReadonlySet<string> = new Set(['Typing', 'Gesturing', 'Nodding']);
const triangles = (doc: Document) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
const extensions = (doc: Document) => doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
const jointsOf = (doc: Document) => doc.getRoot().listNodes().filter((n) => (JOINTS as readonly string[]).includes(n.getName()));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name)) : [join(dir, name)]));
}

describe('the built art files', () => {
  it('are exactly the files the contract lists, within the download budget', () => {
    const built = filesUnder(ART).map((path) => relative(ART, path).split(sep).join('/')).sort();
    expect(built).toEqual([...ART_FILES].sort());
    const total = ART_FILES.reduce((n, file) => n + sizeOf(file), 0);
    expect(total).toBeLessThanOrEqual(ART_BUDGET.totalBytes);
  });

  it('are meshopt compressed, and three’s own decoder reads every compressed view the same as meshoptimizer', async () => {
    await BrowserDecoder.ready;
    for (const file of ART_FILES) {
      const bytes = readFileSync(join(ART, file));
      expect(extensions(read(file)), file).toContain('EXT_meshopt_compression');
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getUint32(0, true), file).toBe(0x46546c67);
      const jsonLength = view.getUint32(12, true);
      const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
        bufferViews: { extensions?: { EXT_meshopt_compression?: { byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } } }[];
      };
      const bin = bytes.subarray(20 + jsonLength + 8);
      let compressed = 0;
      for (const bufferView of json.bufferViews) {
        const m = bufferView.extensions?.EXT_meshopt_compression;
        if (!m) continue;
        compressed++;
        const source = bin.subarray(m.byteOffset ?? 0, (m.byteOffset ?? 0) + m.byteLength);
        const ours = new Uint8Array(m.count * m.byteStride);
        const browsers = new Uint8Array(m.count * m.byteStride);
        MeshoptDecoder.decodeGltfBuffer(ours, m.count, m.byteStride, source, m.mode, m.filter ?? 'NONE');
        BrowserDecoder.decodeGltfBuffer(browsers, m.count, m.byteStride, source, m.mode, m.filter ?? 'NONE');
        expect(Buffer.from(browsers).equals(Buffer.from(ours)), `${file}: a buffer view decodes differently`).toBe(true);
      }
      expect(compressed, file).toBeGreaterThan(0);
    }
  });
});

describe('bodies', () => {
  const restOf = (doc: Document) => new Map(jointsOf(doc).map((n) => [n.getName(), [...n.getTranslation(), ...n.getRotation(), ...n.getScale()]]));

  it.each(LOOK_BODIES.flatMap((body) => [bodyFile(body), bodyFile(body, 'low')]))('%s: one skinned mesh on the one skeleton, with roles and a lossless atlas', (file) => {
    const doc = read(file);
    const root = doc.getRoot();
    expect(sizeOf(file)).toBeLessThanOrEqual(ART_BUDGET.bodyBytes);
    expect(extensions(doc)).toContain('KHR_mesh_quantization');

    // One skeleton: KayKit's medium rig, its joints in the contract's order, and nothing else (no weapon slots,
    // no IK or control bones).
    expect(root.listSkins()).toHaveLength(1);
    const skin = root.listSkins()[0];
    expect(skin?.listJoints().map((j) => j.getName())).toEqual([...JOINTS]);
    for (const joint of skin?.listJoints() ?? []) {
      const parent = JOINT_PARENT[joint.getName() as (typeof JOINTS)[number]];
      if (parent) expect(joint.getParentNode()?.getName()).toBe(parent);
    }
    const others = root.listNodes().filter((n) => !(JOINTS as readonly string[]).includes(n.getName()) && !n.getMesh());
    expect(others.map((n) => n.getName())).toEqual([]);

    // One skinned mesh with one primitive: a person is one draw call.
    const meshNodes = root.listNodes().filter((n) => n.getMesh());
    expect(meshNodes).toHaveLength(1);
    expect(meshNodes[0]?.getSkin()).toBe(skin);
    const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
    expect(prims).toHaveLength(1);
    const prim = prims[0];
    expect(prim?.listSemantics().sort()).toEqual(['JOINTS_0', 'NORMAL', 'POSITION', 'TEXCOORD_0', 'WEIGHTS_0', '_ROLE']);

    // The outfit roles, one per vertex and so per triangle.
    const role = prim?.getAttribute('_ROLE');
    const values = new Set(Array.from(role?.getArray() ?? [], Number));
    expect([...values].every((v) => Number.isInteger(v) && v >= 0 && v < ROLES.length)).toBe(true);
    for (const needed of ['top', 'trousers', 'shoes'] as const) expect(values.has(ROLES.indexOf(needed)), needed).toBe(true);
    const index = prim?.getIndices()?.getArray() ?? [];
    const roles = role?.getArray() ?? [];
    for (let t = 0; t < index.length; t += 3) {
      const r = roles[index[t] ?? 0];
      expect(roles[index[t + 1] ?? 0] === r && roles[index[t + 2] ?? 0] === r, `a triangle with mixed roles in ${file}`).toBe(true);
    }

    const count = triangles(doc);
    expect(count).toBeLessThanOrEqual(file.endsWith('-low.glb') ? ART_BUDGET.lowTriangles : ART_BUDGET.bodyTriangles);

    // The atlas: one lossless PNG, small, sampled without mipmaps.
    expect(root.listTextures()).toHaveLength(1);
    const texture = root.listTextures()[0];
    expect(texture?.getMimeType()).toBe('image/png');
    const png = texture?.getImage() ?? new Uint8Array();
    expect(png.byteLength).toBeLessThanOrEqual(ART_BUDGET.atlasBytes);
    const atlas = decodePng(png);
    expect(atlas.width * atlas.height).toBeLessThanOrEqual(256 * 256);
    expect(root.listMaterials()[0]?.getBaseColorTextureInfo()?.getMinFilter()).toBe(9729);
  });

  it('every body and the clips rest in the same pose', () => {
    const reference = restOf(read(CLIPS_FILE));
    expect(reference.size).toBe(JOINTS.length);
    for (const body of LOOK_BODIES) {
      for (const file of [bodyFile(body), bodyFile(body, 'low')]) {
        const rest = restOf(read(file));
        for (const joint of JOINTS) {
          const a = reference.get(joint) ?? [];
          const b = rest.get(joint) ?? [];
          expect(Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0)))), `${file} ${joint}`).toBeLessThan(1e-5);
        }
      }
    }
  });

  it('the phones’ body is the full one simplified to about 3,000 triangles', () => {
    for (const body of LOOK_BODIES) {
      const full = triangles(read(bodyFile(body)));
      const low = triangles(read(bodyFile(body, 'low')));
      expect(low).toBeLessThan(full);
      expect(low).toBeGreaterThan(2_500);
    }
  });
});

describe('clips', () => {
  it('holds the office’s clips and only those, on the skeleton’s joints, without meshes', () => {
    const doc = read(CLIPS_FILE);
    const root = doc.getRoot();
    expect(sizeOf(CLIPS_FILE)).toBeLessThanOrEqual(ART_BUDGET.clipsBytes);
    expect(root.listMeshes()).toEqual([]);
    expect(root.listSkins()).toEqual([]);
    expect(root.listAnimations().map((a) => a.getName())).toEqual([...CLIP_NAMES]);
    for (const animation of root.listAnimations()) {
      expect(animation.listChannels().length, animation.getName()).toBeGreaterThan(0);
      for (const channel of animation.listChannels()) {
        expect(JOINTS as readonly string[], animation.getName()).toContain(channel.getTargetNode()?.getName());
        expect(['translation', 'rotation', 'scale']).toContain(channel.getTargetPath());
        expect(channel.getSampler()?.getInterpolation()).toBe('LINEAR');
        expect(channel.getSampler()?.getInput()?.getMax([])[0] ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('marks the made layers additive, names the clip they play over and says which are still poses', () => {
    const animations = read(CLIPS_FILE).getRoot().listAnimations();
    for (const animation of animations) {
      const name = animation.getName();
      const over = (ADDITIVE_CLIPS as Record<string, string>)[name];
      if (over) expect(animation.getExtras(), name).toEqual({ additive: true, over, still: !MOVING_LAYERS.has(name) });
      else expect(animation.getExtras(), name).toEqual({});
    }
  });

  it('makes each still pose two equal keys a second apart, so it holds one frame', () => {
    for (const animation of read(CLIPS_FILE).getRoot().listAnimations()) {
      if (!(animation.getExtras() as { still?: boolean }).still) continue;
      for (const channel of animation.listChannels()) {
        const sampler = channel.getSampler();
        expect(Array.from(sampler?.getInput()?.getArray() ?? []), animation.getName()).toEqual([0, 1]);
        const values = Array.from(sampler?.getOutput()?.getArray() ?? []);
        const half = values.length / 2;
        expect(values.slice(half), `${animation.getName()} ${channel.getTargetNode()?.getName()}`).toEqual(values.slice(0, half));
      }
    }
  });

  it('times the moving layers as the art proof did: typing 2.4 s, gesturing 2.4 s, a nod 0.8 s', () => {
    const seconds = (name: string) => {
      const animation = read(CLIPS_FILE).getRoot().listAnimations().find((a) => a.getName() === name);
      return Math.max(...(animation?.listChannels() ?? []).map((c) => c.getSampler()?.getInput()?.getMax([])[0] ?? 0));
    };
    expect(seconds('Typing')).toBeCloseTo(2.4, 3);
    expect(seconds('Gesturing')).toBeCloseTo(2.4, 3);
    expect(seconds('Nodding')).toBeCloseTo(0.8, 3);
  });
});

describe('scenery', () => {
  const worldBounds = (node: Node) => {
    const world = new Matrix4().fromArray(node.getWorldMatrix());
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const position = node.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION');
    const element: number[] = [];
    const v = new Vector3();
    for (let i = 0; i < (position?.getCount() ?? 0); i++) {
      position?.getElement(i, element);
      v.fromArray(element).applyMatrix4(world);
      min.min(v);
      max.max(v);
    }
    return { min, max };
  };

  it.each([...ART_PACKS])('%s: a node per catalogue piece, sharing one lossless atlas', (pack) => {
    const doc = read(sceneryFile(pack));
    const root = doc.getRoot();
    expect(sizeOf(sceneryFile(pack))).toBeLessThanOrEqual(ART_BUDGET.sceneryBytes);
    const named = root.listNodes().filter((n) => n.getMesh()).map((n) => n.getName()).sort();
    expect(named).toEqual(packPieces(pack));
    expect(root.listMaterials()).toHaveLength(1);
    expect(root.listTextures()).toHaveLength(1);
    const png = root.listTextures()[0]?.getImage() ?? new Uint8Array();
    expect(root.listTextures()[0]?.getMimeType()).toBe('image/png');
    expect(png.byteLength).toBeLessThanOrEqual(ART_BUDGET.atlasBytes);
    const atlas = decodePng(png);
    expect([atlas.width, atlas.height]).toEqual([512, 512]);
  });

  it('every pack piece covers the footprint the catalogue gives it, at its scale', () => {
    for (const piece of PIECES) {
      if (piece.draw.from !== 'pack') continue;
      const { pack, piece: name, scale } = piece.draw;
      const node = read(sceneryFile(pack)).getRoot().listNodes().find((n) => n.getName() === name);
      expect(node, `${piece.id}: ${name} is not in ${pack}`).toBeDefined();
      const { min, max } = worldBounds(node as Node);
      expect((max.x - min.x) * scale, `${piece.id} width`).toBeCloseTo(piece.footprint[0], 1);
      expect((max.z - min.z) * scale, `${piece.id} depth`).toBeCloseTo(piece.footprint[1], 1);
      if (piece.place === 'floor') expect(Math.abs(min.y), `${piece.id} stands on the floor`).toBeLessThan(0.02);
      if (piece.place === 'wall') expect(Math.abs(min.z), `${piece.id} hangs with its back on the wall`).toBeLessThan(0.02);
    }
  });
});
