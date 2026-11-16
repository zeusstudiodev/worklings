// Builds pieces in KayKit's style: chunky bevelled parts whose UVs sample the Furniture Bits atlas by height, so tops
// catch the light end of a colour block and feet the dark end, exactly like the pack's own pieces. Glowing parts
// (screens, bulbs, sky in a window, neon) are built the same way for the emissive bucket. Pure three.js.
import {
  type BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { type Cell, cellV } from './atlas.ts';
import { mergeParts } from './merge.ts';

type Vec = [number, number, number];

/**
 * A box with its edges bevelled once: flat faces, and bevel strips whose normals turn from one face to the next, so
 * edges read soft like KayKit's in 44 triangles (three's RoundedBoxGeometry takes 108 for one segment).
 */
export function bevelBox(w: number, h: number, d: number, r: number): BufferGeometry {
  const half = [w / 2, h / 2, d / 2] as const;
  const ext = (k: number) => half[k] ?? 0;
  const inner = (k: number) => ext(k) - r;
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const vert = (p: Vec, n: Vec) => {
    positions.push(...p);
    normals.push(...n);
    return positions.length / 3 - 1;
  };
  const at = (i: number) => new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const normalAt = (i: number) => new Vector3(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
  // Wound so the triangle faces the way its vertices' normals point: the shape is convex, so that is outward.
  const tri = (a: number, b: number, c: number) => {
    const pa = at(a);
    const face = at(b).sub(pa).cross(at(c).sub(pa));
    const outward = normalAt(a).add(normalAt(b)).add(normalAt(c));
    if (face.dot(outward) >= 0) index.push(a, b, c);
    else index.push(a, c, b);
  };
  const quad = (a: number, b: number, c: number, e: number) => {
    tri(a, b, c);
    tri(a, c, e);
  };
  const axis = (k: number, s: number): Vec => [k === 0 ? s : 0, k === 1 ? s : 0, k === 2 ? s : 0];
  // A point from its coordinate on each axis, given as [axis, value] pairs.
  const point = (values: readonly (readonly [number, number])[]): Vec => {
    const p: Vec = [0, 0, 0];
    for (const [k, value] of values) p[k] = value;
    return p;
  };
  // The six faces, inset by the bevel.
  for (let k = 0; k < 3; k++) {
    const u = (k + 1) % 3;
    const v = (k + 2) % 3;
    for (const s of [-1, 1]) {
      const corner = (su: number, sv: number) => vert(point([[k, s * ext(k)], [u, su * inner(u)], [v, sv * inner(v)]]), axis(k, s));
      quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
    }
  }
  // The twelve edges.
  for (let k = 0; k < 3; k++) {
    const m = (k + 1) % 3;
    const l = (k + 2) % 3;
    for (const sk of [-1, 1]) {
      for (const sm of [-1, 1]) {
        const onK = (sl: number) => vert(point([[k, sk * ext(k)], [m, sm * inner(m)], [l, sl * inner(l)]]), axis(k, sk));
        const onM = (sl: number) => vert(point([[k, sk * inner(k)], [m, sm * ext(m)], [l, sl * inner(l)]]), axis(m, sm));
        quad(onK(-1), onK(1), onM(1), onM(-1));
      }
    }
  }
  // The eight corners.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const signs = [sx, sy, sz] as const;
        const sign = (j: number) => signs[j] ?? 1;
        const onFace = (k: number) => vert(point([0, 1, 2].map((j) => [j, sign(j) * (j === k ? ext(j) : inner(j))] as const)), axis(k, sign(k)));
        tri(onFace(0), onFace(1), onFace(2));
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** A plain box: 12 triangles, for parts too thin for a bevel to show. */
export function plainBox(w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d);
}

/** A triangular prism along x: its base `d` deep on y = 0, its ridge `h` up, in the middle or over the back edge. */
export function prism(w: number, h: number, d: number, ridge: 'middle' | 'back' = 'middle'): BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const top = ridge === 'middle' ? 0 : -z;
  const faces: [Vec, Vec, Vec][] = [
    [[-x, 0, z], [x, 0, z], [x, h, top]],
    [[-x, 0, z], [x, h, top], [-x, h, top]],
    [[x, 0, -z], [-x, 0, -z], [-x, h, top]],
    [[x, 0, -z], [-x, h, top], [x, h, top]],
    [[-x, 0, -z], [x, 0, -z], [x, 0, z]],
    [[-x, 0, -z], [x, 0, z], [-x, 0, z]],
    [[-x, 0, -z], [-x, 0, z], [-x, h, top]],
    [[x, 0, z], [x, 0, -z], [x, h, top]],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  // The solid's centroid: every face of a convex prism faces away from it.
  const middle = new Vector3(0, h / 3, top / 3);
  for (const [p, q, r] of faces) {
    a.set(...p);
    b.set(...q);
    c.set(...r);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (n.dot(a.clone().add(b).add(c).divideScalar(3).sub(middle)) < 0) {
      positions.push(...p, ...r, ...q);
      n.negate();
    } else positions.push(...p, ...q, ...r);
    for (let i = 0; i < 3; i++) normals.push(n.x, n.y, n.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
  return g;
}

/** Turns about y, then x, then z, as the parts' `rot` options give them. */
function turn(rot: Vec | undefined): Quaternion {
  const q = new Quaternion();
  if (!rot) return q;
  const [rx, ry, rz] = rot;
  q.setFromAxisAngle(new Vector3(0, 1, 0), ry);
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rx));
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz));
  return q;
}

export interface PartOptions {
  /** Bevel radius; KayKit's pieces are soft-cornered. */
  r?: number;
  /** Vertex colour multiplying the atlas: white keeps it, a hue tints a light block. */
  color?: string;
  /** Turn about y, then x, then z. */
  rot?: Vec;
  /** How much of the block's gradient this part spans: 0 is flat at the light end, 1 the whole block. */
  span?: number;
}

interface ShapePart {
  geometry: BufferGeometry;
  cell: Cell;
  colour: Color;
  span: number;
}

/** A piece made of parts, merged into one geometry with atlas UVs and vertex colours. */
export class Shape {
  private readonly parts: ShapePart[] = [];
  private readonly top: number;
  private readonly bottom: number;

  /** The gradient runs from `top` (the light end) down to `bottom`. */
  constructor(top: number, bottom = 0) {
    this.top = top;
    this.bottom = bottom;
  }

  private add(geometry: BufferGeometry, x: number, y: number, z: number, cell: Cell, o: PartOptions): this {
    geometry.applyMatrix4(new Matrix4().compose(new Vector3(x, y, z), turn(o.rot), new Vector3(1, 1, 1)));
    this.parts.push({ geometry, cell, colour: new Color(o.color ?? '#ffffff'), span: o.span ?? 1 });
    return this;
  }

  /** A box, bevelled when it is big enough for the bevel to show. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, cell: Cell, o: PartOptions = {}): this {
    const r = Math.min(o.r ?? 0.04, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const g = r > 0.012 && Math.min(w, h, d) >= 0.07 ? bevelBox(w, h, d, r) : plainBox(w, h, d);
    return this.add(g, x, y, z, cell, o);
  }

  cyl(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, cell: Cell, o: PartOptions & { sides?: number; open?: boolean } = {}): this {
    return this.add(new CylinderGeometry(rTop, rBottom, h, o.sides ?? 10, 1, o.open ?? false), x, y, z, cell, o);
  }

  ball(r: number, x: number, y: number, z: number, cell: Cell, o: PartOptions & { sx?: number; sy?: number; sz?: number; detail?: number } = {}): this {
    const detail = o.detail ?? 8;
    const g = new SphereGeometry(r, detail, Math.max(3, Math.round(detail * 0.75)));
    g.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    return this.add(g, x, y, z, cell, o);
  }

  ring(radius: number, tube: number, x: number, y: number, z: number, cell: Cell, o: PartOptions & { arc?: number; sides?: number; radial?: number } = {}): this {
    return this.add(new TorusGeometry(radius, tube, o.radial ?? 6, o.sides ?? 12, o.arc ?? Math.PI * 2), x, y, z, cell, o);
  }

  /** A triangular prism along x (a roof, an awning, an A-frame), standing on y. */
  prism(w: number, h: number, d: number, x: number, y: number, z: number, cell: Cell, o: PartOptions & { ridge?: 'middle' | 'back' } = {}): this {
    return this.add(prism(w, h, d, o.ridge), x, y, z, cell, o);
  }

  /** How many parts so far: a piece that adds none builds to nothing. */
  get size(): number {
    return this.parts.length;
  }

  /** Merges the parts; each vertex's UV follows its height between the gradient's top and bottom. */
  build(): BufferGeometry {
    const range = Math.max(1e-3, this.top - this.bottom);
    const ready = this.parts.map(({ geometry, cell, colour, span }) => {
      const pos = geometry.getAttribute('position') as BufferAttribute;
      const uv = new Float32Array(pos.count * 2);
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = Math.min(1, Math.max(0, (pos.getY(i) - this.bottom) / range));
        uv[i * 2] = cell.u;
        uv[i * 2 + 1] = cellV(cell, (1 - t) * span);
        col[i * 3] = colour.r;
        col[i * 3 + 1] = colour.g;
        col[i * 3 + 2] = colour.b;
      }
      geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
      return { geometry };
    });
    return mergeParts(ready);
  }
}

/** The screens atlas (textures.ts): eight square tiles in a row. */
export const TILE = { code: 0, terminal: 1, design: 2, layout: 3, tests: 4, progress: 5, charts: 6, white: 7 } as const;
export type Tile = (typeof TILE)[keyof typeof TILE];
const TILES = 8;

export interface GlowOptions {
  tile?: Tile;
  color?: string;
  /** A second colour for the lower edge: sky in a window, light from a sign. */
  bottom?: string;
  rot?: Vec;
}

/**
 * Glowing parts for the emissive bucket: screens show a tile of the screens atlas, everything else the white tile
 * times its colour. Their colours can be changed in place later (a monitor turning on), so each part keeps its range.
 */
export class Glow {
  private readonly parts: BufferGeometry[] = [];

  private add(geometry: BufferGeometry, x: number, y: number, z: number, o: GlowOptions, mapUv: boolean): this {
    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const top = new Color(o.color ?? '#ffffff');
    const bottom = new Color(o.bottom ?? o.color ?? '#ffffff');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const low = box?.min.y ?? 0;
    const high = box?.max.y ?? 0;
    const tile = o.tile ?? TILE.white;
    const col = new Float32Array(pos.count * 3);
    const out = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const t = high > low ? (pos.getY(i) - low) / (high - low) : 1;
      const c = bottom.clone().lerp(top, t);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      if (mapUv && tile !== TILE.white && uv) {
        const inset = 0.02;
        out[i * 2] = (tile + inset + uv.getX(i) * (1 - inset * 2)) / TILES;
        out[i * 2 + 1] = inset + (1 - uv.getY(i)) * (1 - inset * 2);
      } else {
        out[i * 2] = (TILE.white + 0.5) / TILES;
        out[i * 2 + 1] = 0.5;
      }
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(out, 2));
    geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
    geometry.applyMatrix4(new Matrix4().compose(new Vector3(x, y, z), turn(o.rot), new Vector3(1, 1, 1)));
    this.parts.push(geometry);
    return this;
  }

  /** A flat rectangle facing +z (turn it with `rot`). */
  quad(w: number, h: number, x: number, y: number, z: number, o: GlowOptions = {}): this {
    const g = new BufferGeometry();
    const [a, b] = [w / 2, h / 2];
    g.setAttribute('position', new Float32BufferAttribute([-a, -b, 0, a, -b, 0, a, b, 0, -a, b, 0], 3));
    g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return this.add(g, x, y, z, o, true);
  }

  /** A solid glowing block: a neon tube, an LED, a lit sign's letters. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, o: GlowOptions = {}): this {
    return this.add(plainBox(w, h, d), x, y, z, { ...o, tile: TILE.white }, false);
  }

  disc(r: number, x: number, y: number, z: number, o: GlowOptions & { sides?: number } = {}): this {
    return this.add(new CircleGeometry(r, o.sides ?? 12), x, y, z, { ...o, tile: TILE.white }, false);
  }

  tube(r: number, h: number, x: number, y: number, z: number, o: GlowOptions & { sides?: number } = {}): this {
    return this.add(new CylinderGeometry(r, r, h, o.sides ?? 8), x, y, z, { ...o, tile: TILE.white }, false);
  }

  get size(): number {
    return this.parts.length;
  }

  build(): BufferGeometry | null {
    return this.parts.length ? mergeParts(this.parts.map((geometry) => ({ geometry }))) : null;
  }
}
