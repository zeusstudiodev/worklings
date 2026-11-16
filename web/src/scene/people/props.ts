// What people hold and wear, modelled here in KayKit's style: chunky shapes with the pack's top-light, bottom-dark
// gradient baked into vertex colours, so one material draws them all. Papers and plants are 1.5 times life size
// (docs/game-feel.md: they have to read at the office's scale). Built once per kind and shared by everyone.
import { BoxGeometry, type BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Holding } from '../poses.ts';

const PAPER = '#F7F4EC';
const YELLOW = '#F2D541';
const INK = '#2E3833';
const STEEL = '#8C969B';
const STEEL_DARK = '#5D6661';
const SOIL = '#5A4030';
const LEAF = '#6F9E64';
const LEAF_LIGHT = '#8DBA73';
const BAND = '#2B2F3A';

/** One part: a geometry placed in the prop's space, coloured light at its top and darker at its foot, as KayKit shades. */
function part(geometry: BufferGeometry, colour: string, at: [number, number, number], turn: [number, number, number] = [0, 0, 0], light = 1.1, dark = 0.78): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.computeBoundingBox();
  const box = g.boundingBox;
  const lo = box?.min.y ?? 0;
  const span = Math.max(1e-3, (box?.max.y ?? 1) - lo);
  const c = new Color(colour);
  const position = g.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const shade = dark + (light - dark) * ((position.getY(i) - lo) / span);
    colours.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colours, 3));
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), turn[0]);
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn[1]));
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), turn[2]));
  return g.applyMatrix4(new Matrix4().compose(new Vector3(...at), q, new Vector3(1, 1, 1)));
}

const merge = (parts: BufferGeometry[]) => {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('could not merge a prop');
  return merged;
};

/** Papers in hand: one per open item at the front desk, drawn up to this many sheets. */
export const MAX_SHEETS = 4;

/**
 * A sheet held at its lower edge, as a hand slot holds a handle: it rises along +y from the grip and faces +z. A task
 * paper carries a few lines of writing. More than one is a stack, each sheet behind the last and a little askew.
 */
function paper(colour: string, lines: boolean, sheets: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < sheets; i++) {
    const askew = i === 0 ? 0 : (i % 2 ? 1 : -1) * (0.05 + 0.02 * i);
    parts.push(part(new BoxGeometry(0.34, 0.46, 0.014), colour, [askew * 0.3, 0.19 + i * 0.012, -i * 0.018], [0, 0, askew], 1.04, 0.9));
  }
  if (lines) for (let i = 0; i < 4; i++) parts.push(part(new BoxGeometry(i === 3 ? 0.14 : 0.24, 0.02, 0.006), INK, [i === 3 ? -0.05 : 0, 0.33 - i * 0.07, 0.009]));
  return merge(parts);
}

/** A first-day plant in a pot of the room's hue, upright, its base at the origin. */
function plant(hue: string): BufferGeometry {
  const parts = [part(new CylinderGeometry(0.14, 0.11, 0.2, 10), hue, [0, 0.1, 0]), part(new CylinderGeometry(0.125, 0.125, 0.02, 10), SOIL, [0, 0.195, 0])];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leaf = new SphereGeometry(0.09, 7, 5);
    leaf.scale(0.7, 0.35, 1.3);
    parts.push(part(leaf, i % 2 ? LEAF_LIGHT : LEAF, [Math.cos(a) * 0.08, 0.3 + (i % 3) * 0.03, Math.sin(a) * 0.08], [-0.45, -a + Math.PI / 2, 0]));
  }
  parts.push(part(new IcosahedronGeometry(0.07, 0), LEAF_LIGHT, [0, 0.36, 0]));
  return merge(parts);
}

/** A closed laptop, carried flat against the chest. */
function laptop(): BufferGeometry {
  return merge([part(new BoxGeometry(0.62, 0.035, 0.43), STEEL_DARK, [0, 0, 0]), part(new BoxGeometry(0.6, 0.03, 0.41), STEEL, [0, 0.03, 0])]);
}

/** A headset over the head, the mic toward the mouth. Its origin is the head bone. */
function headset(hue: string): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (i / 8);
    parts.push(part(new BoxGeometry(0.07, 0.07, 0.11), BAND, [Math.cos(a) * 0.42, 0.38 + Math.sin(a) * 0.42, -0.02]));
  }
  for (const s of [1, -1]) parts.push(part(new CylinderGeometry(0.12, 0.12, 0.08, 10), hue, [0.43 * s, 0.32, -0.02], [0, 0, Math.PI / 2]));
  parts.push(part(new BoxGeometry(0.03, 0.03, 0.3), BAND, [-0.4, 0.22, 0.16], [0, 0.35, 0]));
  return merge(parts);
}

export type PropKind = Exclude<Holding, 'none'> | 'headset';

/** Where a prop goes: the right hand's slot (KayKit's weapon slot, where its swords go) or in front of the chest. */
export const PROP_ANCHOR: Readonly<Record<PropKind, 'hand' | 'chest' | 'head'>> = {
  note: 'hand',
  'note-yours': 'hand',
  task: 'hand',
  plant: 'chest',
  laptop: 'chest',
  headset: 'head',
};

/** The props, built once each, and the material they share. */
export class PropKit {
  readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  private readonly built = new Map<string, BufferGeometry>();

  /** A prop's geometry; plants and headsets come in the person's room hue, papers as a stack of `sheets`. */
  geometry(kind: PropKind, hue: string, sheets = 1): BufferGeometry {
    const stack = Math.max(1, Math.min(MAX_SHEETS, Math.round(sheets)));
    const key = kind === 'plant' || kind === 'headset' ? `${kind}:${hue}` : PROP_ANCHOR[kind] === 'hand' ? `${kind}:${stack}` : kind;
    let g = this.built.get(key);
    if (!g) {
      g =
        kind === 'note' ? paper(PAPER, false, stack)
        : kind === 'note-yours' ? paper(YELLOW, false, stack)
        : kind === 'task' ? paper(PAPER, true, stack)
        : kind === 'plant' ? plant(hue)
        : kind === 'laptop' ? laptop()
        : headset(hue);
      g.computeBoundingSphere();
      this.built.set(key, g);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.built.values()) g.dispose();
    this.built.clear();
    this.material.dispose();
  }
}
