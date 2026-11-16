// Worklings people from KayKit bodies: fantasy gear left off, the six skinned parts merged into one mesh on the one
// skeleton, every vertex tagged with the outfit role of its triangle (the `_ROLE` attribute), a small palette atlas,
// and a simplified copy for phones.
import { type Document, type Primitive } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { JOINTS, ROLES, type Role } from '../../web/src/scene/art/spec.ts';
import type { LookBody } from '../../src/core/looks.ts';
import { atlasSampler, floats, indicesOf, newDocument, threeName } from './gltf.ts';
import { decodePng, downscale, encodePng, type Image } from './png.ts';
import { addSkeleton, nodeOf, type Rest, restWorld } from './rig.ts';

type PartKind = 'Head' | 'Body' | 'Arm' | 'Leg';
type Cells = Readonly<Record<string, Role>>;

interface BodySpec {
  /** The file, under the raw folder. */
  file: string;
  /** Skinned parts left off: helmets, visors, hats, capes, quivers. */
  drop: RegExp;
  /** The atlas grid: KayKit atlases are blocks of vertical gradients. */
  cols: number;
  rows: number;
  /** Role per atlas block ("r0c3"), per part; blocks not listed take the part's default. */
  cells: Readonly<Partial<Record<PartKind, Cells>>>;
  /** In the bind pose (a T-pose): arm triangles further out than this are hands. */
  handX: number;
  /** Leg triangles below this height are shoes. */
  shoeY: number;
  /**
   * `blocks`: every block is a plain vertical gradient, so the atlas shrinks to a few pixels a block with UVs moved
   * to the blocks' middles. `detail`: the atlas has drawing in it (the mannequin's smiley and name sticker) and is
   * halved instead.
   */
  atlas: 'blocks' | 'detail';
}

const ANIMATIONS = 'kaykit-character-animations/extracted/KayKit_Character_Animations_1.1';
const ADVENTURERS = 'kaykit-adventurers/extracted/KayKit_Adventurers_2.0_FREE/Characters/gltf';

// The role tables come from the art proof's body lab (`shots/bodies.png` shows each role in a debug colour).
export const BODIES: Readonly<Record<LookBody, BodySpec>> = {
  // The neutral toy, visitors' look: limbs and torso take the outfit, the smiley and "Hello, my name is" stay.
  mannequin: {
    file: `${ANIMATIONS}/Mannequin Character/characters/Mannequin_Medium.glb`,
    drop: /^$/,
    cols: 8,
    rows: 2,
    cells: {
      Head: { r1c0: 'keep', r1c1: 'keep', r1c2: 'keep', r1c3: 'keep', r0c1: 'hair', r0c2: 'hair', r0c4: 'hair', r0c7: 'hair' },
      Body: { r1c4: 'keep', r1c5: 'keep', r1c6: 'keep', r1c7: 'keep', r0c1: 'topDark', r0c2: 'topDark' },
      Arm: { r0c1: 'topDark', r0c2: 'topDark', r0c3: 'topDark' },
      Leg: { r0c1: 'trousers', r0c2: 'trousers' },
    },
    handX: 9,
    shoeY: 0.2,
    atlas: 'detail',
  },
  // Atlas row 0: skin, hair, eyes, armour, dark armour, -, leather, armour; row 1: red, white, greys, gold.
  knight: {
    file: `${ADVENTURERS}/Knight.glb`,
    drop: /Helmet|Visor|Cape/,
    cols: 8,
    rows: 4,
    cells: {
      Head: { r0c0: 'skin', r0c1: 'hair', r0c2: 'keep' },
      Body: { r0c7: 'topDark', r1c2: 'topDark', r0c6: 'shoes', r1c7: 'trousers', r1c0: 'accent', r1c1: 'keep' },
      Arm: { r0c7: 'topDark', r0c4: 'topDark', r0c6: 'topDark' },
    },
    handX: 0.8,
    shoeY: 0.27,
    atlas: 'blocks',
  },
  // Bare chest and fur: the chest takes the top, the fur collar and trims a darker top, straps and belt leather.
  barbarian: {
    file: `${ADVENTURERS}/Barbarian.glb`,
    drop: /BearHat/,
    cols: 8,
    rows: 4,
    cells: {
      Head: { r0c0: 'skin', r0c1: 'hair', r0c2: 'keep' },
      Body: { r0c0: 'top', r0c7: 'topDark', r3c1: 'topDark', r1c2: 'topDark', r0c6: 'shoes', r1c6: 'shoes', r1c7: 'shoes', r0c3: 'accent' },
      Arm: { r0c6: 'topDark', r2c7: 'topDark', r1c5: 'topDark', r1c2: 'topDark', r0c3: 'topDark' },
    },
    handX: 0.8,
    shoeY: 0.27,
    atlas: 'blocks',
  },
  // A robe: grey trims and buttons darker, the belt and the book on the hip leather.
  mage: {
    file: `${ADVENTURERS}/Mage.glb`,
    drop: /Hat|Cape/,
    cols: 8,
    rows: 4,
    cells: {
      Head: { r0c0: 'skin', r0c1: 'hair', r0c2: 'keep' },
      Body: { r0c3: 'topDark', r0c4: 'topDark', r2c0: 'topDark', r0c5: 'shoes', r2c2: 'shoes', r1c7: 'trousers' },
      Arm: { r0c3: 'topDark', r0c4: 'topDark', r2c7: 'topDark' },
    },
    handX: 0.8,
    shoeY: 0.27,
    atlas: 'blocks',
  },
  // A tunic: the scarf collar darker, belt and straps leather, the buckle a small metal accent.
  rogue: {
    file: `${ADVENTURERS}/Rogue.glb`,
    drop: /Cape/,
    cols: 8,
    rows: 4,
    cells: {
      Head: { r0c0: 'skin', r0c1: 'hair', r0c2: 'keep', r0c3: 'keep' },
      Body: { r1c1: 'topDark', r0c5: 'shoes', r0c6: 'shoes', r0c3: 'accent', r1c7: 'trousers' },
      Arm: { r0c5: 'topDark', r2c7: 'topDark', r1c1: 'topDark', r0c3: 'topDark' },
    },
    handX: 0.8,
    shoeY: 0.27,
    atlas: 'blocks',
  },
  // A shirt and scarf: the cream shirt takes the top, the scarf a darker top, the pouch belt leather.
  ranger: {
    file: `${ADVENTURERS}/Ranger.glb`,
    drop: /Cape|Quiver/,
    cols: 8,
    rows: 4,
    cells: {
      Head: { r0c0: 'skin', r0c1: 'hair', r0c2: 'keep' },
      Body: { r0c5: 'top', r0c6: 'top', r1c0: 'topDark', r0c7: 'shoes', r0c3: 'accent', r1c7: 'trousers' },
      Arm: { r2c7: 'topDark', r0c7: 'topDark', r1c1: 'topDark', r0c3: 'topDark' },
    },
    handX: 0.8,
    shoeY: 0.27,
    atlas: 'blocks',
  },
};

function partKind(name: string): PartKind | null {
  if (/Arm(Left|Right)$/.test(name)) return 'Arm';
  if (/Leg(Left|Right)$/.test(name)) return 'Leg';
  if (/Body$/.test(name)) return 'Body';
  if (/Head$/.test(name)) return 'Head';
  return null;
}

function roleOf(spec: BodySpec, kind: PartKind, cell: string, x: number, y: number): Role {
  const listed = spec.cells[kind]?.[cell];
  if (kind === 'Arm') {
    // Hands are bare whatever glove the adventurer wore; sleeves take the top.
    if (Math.abs(x) > spec.handX) return listed === 'keep' ? 'keep' : 'skin';
    return listed ?? 'top';
  }
  if (kind === 'Leg') return y < spec.shoeY || listed === 'shoes' ? 'shoes' : 'trousers';
  if (kind === 'Body') return listed ?? 'top';
  return listed ?? 'keep';
}

/** A body's merged mesh: plain arrays, before it goes into a glTF file. */
export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  joints: Uint8Array;
  weights: Float32Array;
  roles: Uint8Array;
  indices: Uint32Array;
}

export interface BodyResult {
  full: Document;
  low: Document;
  triangles: { full: number; low: number };
  parts: { kept: string[]; dropped: string[] };
  /** Triangles per role in the full mesh, in ROLES order. */
  roles: number[];
  atlas: { from: string; to: string; bytes: number };
}

/** The body for one look, from its pack file, as a full and a low glTF document. */
export function buildBody(id: LookBody, source: Document, rest: Rest): BodyResult {
  const spec = BODIES[id];
  const root = source.getRoot();
  const parts = root.listMeshes().flatMap((mesh) => mesh.listPrimitives().map((prim) => ({ name: mesh.getName(), prim })));
  const kept = parts.filter((p) => !spec.drop.test(p.name) && partKind(p.name) !== null);
  const dropped = parts.filter((p) => !kept.includes(p)).map((p) => p.name);
  if (kept.length !== 6) throw new Error(`${id}: expected 6 body parts after leaving off ${dropped.join(', ') || 'nothing'}, found ${kept.map((p) => p.name).join(', ')}`);

  // Joint indices in the pack's skin, mapped to the one skeleton's order.
  const skin = root.listSkins()[0];
  if (!skin) throw new Error(`${id}: no skin`);
  const remap = skin.listJoints().map((node) => (JOINTS as readonly string[]).indexOf(threeName(node.getName())));
  checkBind(id, skin.getInverseBindMatrices()?.getArray(), remap, rest);

  const material = kept[0]?.prim.getMaterial();
  const image = material?.getBaseColorTexture()?.getImage();
  if (!material || !image) throw new Error(`${id}: the body has no atlas`);
  const atlas = decodePng(image, `${id} atlas`);
  const cellOf = (u: number, v: number) => `r${clamp(Math.floor(v * spec.rows), 0, spec.rows - 1)}c${clamp(Math.floor(u * spec.cols), 0, spec.cols - 1)}`;

  const mesh = mergeParts(id, kept, (kind, uv, p) => roleOf(spec, kind, cellOf(uv[0], uv[1]), p[0], p[1]), remap, cellOf);
  const small = spec.atlas === 'blocks' && gradientBlocks(atlas, spec) ? paletteAtlas(atlas, spec, mesh) : downscale(atlas, 2, 2);
  const png = encodePng(small);

  const roles = ROLES.map(() => 0);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const role = mesh.roles[mesh.indices[t] ?? 0] ?? 0;
    roles[role] = (roles[role] ?? 0) + 1;
  }
  const low = simplified(id, mesh);
  return {
    full: bodyDocument(id, mesh, png, rest, material.getRoughnessFactor()),
    low: bodyDocument(id, low, png, rest, material.getRoughnessFactor()),
    triangles: { full: mesh.indices.length / 3, low: low.indices.length / 3 },
    parts: { kept: kept.map((p) => p.name), dropped },
    roles,
    atlas: { from: `${atlas.width}x${atlas.height}, ${image.byteLength} B`, to: `${small.width}x${small.height}`, bytes: png.byteLength },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The pack's bind pose must be the rest pose: then every body binds to the one skeleton the same way. */
function checkBind(id: string, ibms: ArrayLike<number> | null | undefined, remap: number[], rest: Rest) {
  if (!ibms) throw new Error(`${id}: the skin has no inverse bind matrices`);
  const world = restWorld(rest);
  let worst = 0;
  remap.forEach((joint, i) => {
    if (joint < 0) return;
    const expected = world[joint]?.clone().invert().elements ?? [];
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs((ibms[i * 16 + k] ?? 0) - (expected[k] ?? 0)));
  });
  if (worst > 1e-3) throw new Error(`${id}: bound in a different pose from the rig's rest pose (off by ${worst.toFixed(4)})`);
}

/**
 * Merges the parts into one mesh. A vertex whose triangles disagree on role or atlas block is split, so every
 * triangle has exactly one role and block and the per-vertex tag is a per-triangle tag. Joints are remapped to the
 * skeleton; a part weighted to a joint the skeleton doesn't have (the weapon slots) is refused.
 */
function mergeParts(
  id: string,
  parts: { name: string; prim: Primitive }[],
  classify: (kind: PartKind, uv: [number, number], centre: [number, number, number]) => Role,
  remap: number[],
  cellOf: (u: number, v: number) => string,
): BodyMesh {
  const out = { positions: [] as number[], normals: [] as number[], uvs: [] as number[], joints: [] as number[], weights: [] as number[], roles: [] as number[], indices: [] as number[] };
  for (const { name, prim } of parts) {
    const kind = partKind(name) as PartKind;
    const attr = (semantic: string) => {
      const a = prim.getAttribute(semantic);
      if (!a) throw new Error(`${id}: ${name} has no ${semantic}`);
      return a;
    };
    const pos = floats(attr('POSITION'));
    const nor = floats(attr('NORMAL'));
    const uv = floats(attr('TEXCOORD_0'));
    const joints = floats(attr('JOINTS_0'));
    const weights = floats(attr('WEIGHTS_0'));
    const count = pos.length / 3;
    const index = indicesOf(prim.getIndices(), count);
    const made = new Map<string, number>();
    for (let t = 0; t < index.length; t += 3) {
      const corners = [index[t] ?? 0, index[t + 1] ?? 0, index[t + 2] ?? 0];
      const mean = (array: Float32Array, size: number, k: number) => corners.reduce((s, v) => s + (array[v * size + k] ?? 0), 0) / 3;
      const centreUv: [number, number] = [mean(uv, 2, 0), mean(uv, 2, 1)];
      const role = ROLES.indexOf(classify(kind, centreUv, [mean(pos, 3, 0), mean(pos, 3, 1), mean(pos, 3, 2)]));
      const cell = cellOf(centreUv[0], centreUv[1]);
      for (const v of corners) {
        const key = `${v}/${role}/${cell}`;
        let at = made.get(key);
        if (at === undefined) {
          at = out.roles.length;
          made.set(key, at);
          out.positions.push(pos[v * 3] ?? 0, pos[v * 3 + 1] ?? 0, pos[v * 3 + 2] ?? 0);
          out.normals.push(nor[v * 3] ?? 0, nor[v * 3 + 1] ?? 0, nor[v * 3 + 2] ?? 0);
          out.uvs.push(uv[v * 2] ?? 0, uv[v * 2 + 1] ?? 0);
          for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k] ?? 0;
            const j = remap[joints[v * 4 + k] ?? 0] ?? -1;
            if (j < 0 && w > 0) throw new Error(`${id}: ${name} is weighted to a joint outside the skeleton`);
            out.joints.push(j < 0 ? 0 : j);
            out.weights.push(j < 0 ? 0 : w);
          }
          out.roles.push(role);
        }
        out.indices.push(at);
      }
    }
  }
  return {
    positions: Float32Array.from(out.positions),
    normals: Float32Array.from(out.normals),
    uvs: Float32Array.from(out.uvs),
    joints: Uint8Array.from(out.joints),
    weights: Float32Array.from(out.weights),
    roles: Uint8Array.from(out.roles),
    indices: Uint32Array.from(out.indices),
  };
}

/** Pixels across and down each block in the palette atlas. */
const PALETTE_BLOCK = { width: 4, height: 32 };

/** True when every block of the atlas is the same colour across each of its rows: a pure vertical gradient. */
function gradientBlocks(atlas: Image, spec: BodySpec): boolean {
  const bw = atlas.width / spec.cols;
  const bh = atlas.height / spec.rows;
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      for (let y = r * bh; y < (r + 1) * bh; y++) {
        const at = (x: number, k: number) => atlas.data[(y * atlas.width + x) * 4 + k] ?? 0;
        const middle = Math.floor(c * bw + bw / 2);
        for (let x = c * bw + 2; x < (c + 1) * bw - 2; x++) {
          for (let k = 0; k < 3; k++) if (Math.abs(at(x, k) - at(middle, k)) > 6) return false;
        }
      }
    }
  }
  return true;
}

/**
 * Shrinks a gradient atlas to a few pixels a block and moves the UVs to match: across a block to its middle
 * column, down it to at least half a texel from its edges, so bilinear filtering never reaches the next block.
 */
function paletteAtlas(atlas: Image, spec: BodySpec, mesh: BodyMesh): Image {
  const { width: w, height: h } = PALETTE_BLOCK;
  const bw = atlas.width / spec.cols;
  const bh = atlas.height / spec.rows;
  const out: Image = { width: spec.cols * w, height: spec.rows * h, data: new Uint8Array(spec.cols * w * spec.rows * h * 4) };
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      for (let j = 0; j < h; j++) {
        const sum = [0, 0, 0, 0];
        let n = 0;
        for (let y = Math.floor(r * bh + (j * bh) / h); y < r * bh + ((j + 1) * bh) / h; y++) {
          for (let x = c * bw + 2; x < (c + 1) * bw - 2; x++) {
            for (let k = 0; k < 4; k++) sum[k] = (sum[k] ?? 0) + (atlas.data[(y * atlas.width + x) * 4 + k] ?? 0);
            n++;
          }
        }
        for (let i = 0; i < w; i++) for (let k = 0; k < 4; k++) out.data[(((r * h + j) * out.width) + c * w + i) * 4 + k] = Math.round((sum[k] ?? 0) / n);
      }
    }
  }
  const inset = 0.5 / h;
  for (let v = 0; v < mesh.uvs.length / 2; v++) {
    const u = mesh.uvs[v * 2] ?? 0;
    const t = mesh.uvs[v * 2 + 1] ?? 0;
    const c = clamp(Math.floor(u * spec.cols), 0, spec.cols - 1);
    const r = clamp(Math.floor(t * spec.rows), 0, spec.rows - 1);
    mesh.uvs[v * 2] = (c + 0.5) / spec.cols;
    mesh.uvs[v * 2 + 1] = (r + clamp(t * spec.rows - r, inset, 1 - inset)) / spec.rows;
  }
  return out;
}

const LOW_TRIANGLES = 3000;

/**
 * The phones' body: meshoptimizer's simplifier down to about 3,000 triangles. Role and block splits are seams it
 * keeps, so the outfit stays where it was; the target error grows until the count is reached.
 */
function simplified(id: string, mesh: BodyMesh): BodyMesh {
  if (mesh.indices.length / 3 <= LOW_TRIANGLES) return mesh;
  let indices = mesh.indices;
  for (const error of [0.01, 0.02, 0.04, 0.08]) {
    [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, LOW_TRIANGLES * 3, error);
    if (indices.length / 3 <= LOW_TRIANGLES * 1.1) break;
  }
  if (indices.length / 3 > LOW_TRIANGLES * 1.1) throw new Error(`${id}: could not simplify below ${indices.length / 3} triangles`);
  // Keep only the vertices the simplified triangles use, in first-use order.
  const remap = new Map<number, number>();
  const used: number[] = [];
  const compact = Uint32Array.from(indices, (v) => {
    let at = remap.get(v);
    if (at === undefined) {
      at = used.length;
      remap.set(v, at);
      used.push(v);
    }
    return at;
  });
  const pick = <T extends Float32Array | Uint8Array>(array: T, size: number, make: (n: number) => T): T => {
    const out = make(used.length * size);
    used.forEach((v, i) => {
      for (let k = 0; k < size; k++) out[i * size + k] = array[v * size + k] ?? 0;
    });
    return out;
  };
  return {
    positions: pick(mesh.positions, 3, (n) => new Float32Array(n)),
    normals: pick(mesh.normals, 3, (n) => new Float32Array(n)),
    uvs: pick(mesh.uvs, 2, (n) => new Float32Array(n)),
    joints: pick(mesh.joints, 4, (n) => new Uint8Array(n)),
    weights: pick(mesh.weights, 4, (n) => new Float32Array(n)),
    roles: pick(mesh.roles, 1, (n) => new Uint8Array(n)),
    indices: compact,
  };
}

/** A body file: the skeleton, one skinned mesh with its roles, and the atlas, lossless, without mipmaps. */
function bodyDocument(id: LookBody, mesh: BodyMesh, png: Uint8Array, rest: Rest, roughness: number): Document {
  const doc = newDocument();
  const buffer = doc.createBuffer();
  const accessor = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', array: Float32Array | Uint8Array | Uint32Array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const texture = doc.createTexture(`${id}-atlas`).setImage(png).setMimeType('image/png');
  const material = doc.createMaterial(id).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(roughness);
  atlasSampler(material.getBaseColorTextureInfo());
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setIndices(accessor('SCALAR', mesh.indices))
    .setAttribute('POSITION', accessor('VEC3', mesh.positions))
    .setAttribute('NORMAL', accessor('VEC3', mesh.normals))
    .setAttribute('TEXCOORD_0', accessor('VEC2', mesh.uvs))
    .setAttribute('JOINTS_0', accessor('VEC4', mesh.joints))
    .setAttribute('WEIGHTS_0', accessor('VEC4', mesh.weights))
    .setAttribute('_ROLE', accessor('SCALAR', mesh.roles));
  const nodes = addSkeleton(doc, rest);
  const ibms = new Float32Array(JOINTS.length * 16);
  restWorld(rest).forEach((m, i) => ibms.set(m.clone().invert().elements, i * 16));
  const skin = doc.createSkin('rig').setSkeleton(nodeOf(nodes, 'root')).setInverseBindMatrices(accessor('MAT4', ibms));
  for (const joint of JOINTS) skin.addJoint(nodeOf(nodes, joint));
  const body = doc.createNode(`${id}-body`).setMesh(doc.createMesh(`${id}-body`).addPrimitive(prim)).setSkin(skin);
  doc.getRoot().setDefaultScene(doc.createScene(id).addChild(body).addChild(nodeOf(nodes, 'root')));
  return doc;
}
