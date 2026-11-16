// Ambient occlusion baked per vertex for the static scenery (SPEC-v3.md, "Light"): from each vertex a fixed fan of
// cosine-weighted rays leaves over the hemisphere of its normal; the ones that meet the piece itself, or the floor it
// stands on, within `reach` darken it, the nearer the hit the more. No randomness: the same piece gives the same
// numbers on every build. Pure maths on arrays (no Node APIs), so the tests run it directly.

export interface OcclusionInput {
  /** x, y, z per vertex. */
  positions: ArrayLike<number>;
  /** Unit normals, one per vertex. */
  normals: ArrayLike<number>;
  /** Three per triangle. */
  indices: ArrayLike<number>;
}

export interface OcclusionOptions {
  /** Rays per vertex. */
  rays?: number;
  /** How dark a fully occluded vertex gets: 0 leaves everything white, 1 black. */
  strength?: number;
  /** Hits farther than this count for nothing, as a fraction of the piece's largest extent. */
  reach?: number;
  /** The piece stands on a floor at its lowest point, which occludes rays that go down. */
  floor?: boolean;
}

export const OCCLUSION_DEFAULTS = { rays: 48, strength: 0.5, reach: 0.45, floor: true } as const;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** The fan in a frame where +z is the normal: cosine-weighted, so rays near the surface count for less. */
function fan(count: number): Float64Array {
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const r = Math.sqrt(u);
    const phi = i * GOLDEN;
    out[i * 3] = r * Math.cos(phi);
    out[i * 3 + 1] = r * Math.sin(phi);
    out[i * 3 + 2] = Math.sqrt(1 - u);
  }
  return out;
}

/**
 * One brightness per vertex, 1 for a vertex that sees the whole hemisphere and down to `1 - strength` for one
 * that is closed in. Triangles are tested both ways round: thin pieces (frames, rugs) have no inside.
 */
export function bakeOcclusion(input: OcclusionInput, options: OcclusionOptions = {}): Float32Array {
  const { rays, strength, reach: reachFraction, floor } = { ...OCCLUSION_DEFAULTS, ...options };
  const { positions: p, normals: n, indices } = input;
  const vertices = Math.floor(p.length / 3);
  const triangles = Math.floor(indices.length / 3);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices; i++) {
    for (let k = 0; k < 3; k++) {
      const x = p[i * 3 + k] ?? 0;
      lo[k] = Math.min(lo[k] ?? x, x);
      hi[k] = Math.max(hi[k] ?? x, x);
    }
  }
  const extent = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!, 1e-6);
  const reach = extent * reachFraction;
  const bias = extent * 0.003;
  const ground = lo[1] ?? 0;

  // Each triangle once: a corner, two edges and a box, so a ray skips most of them cheaply.
  const tri = new Float64Array(triangles * 9);
  const box = new Float64Array(triangles * 6);
  for (let t = 0; t < triangles; t++) {
    const a = (indices[t * 3] ?? 0) * 3;
    const b = (indices[t * 3 + 1] ?? 0) * 3;
    const c = (indices[t * 3 + 2] ?? 0) * 3;
    for (let k = 0; k < 3; k++) {
      const pa = p[a + k] ?? 0;
      const pb = p[b + k] ?? 0;
      const pc = p[c + k] ?? 0;
      tri[t * 9 + k] = pa;
      tri[t * 9 + 3 + k] = pb - pa;
      tri[t * 9 + 6 + k] = pc - pa;
      box[t * 6 + k] = Math.min(pa, pb, pc) - bias;
      box[t * 6 + 3 + k] = Math.max(pa, pb, pc) + bias;
    }
  }

  const local = fan(rays);
  const out = new Float32Array(vertices);
  for (let v = 0; v < vertices; v++) {
    const nx = n[v * 3] ?? 0;
    const ny = n[v * 3 + 1] ?? 1;
    const nz = n[v * 3 + 2] ?? 0;
    // A tangent frame from the axis the normal points along least.
    const ax = Math.abs(nx) < 0.6 ? [1, 0, 0] : [0, 1, 0];
    let tx = ax[1]! * nz - ax[2]! * ny;
    let ty = ax[2]! * nx - ax[0]! * nz;
    let tz = ax[0]! * ny - ax[1]! * nx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    const ox = (p[v * 3] ?? 0) + nx * bias;
    const oy = (p[v * 3 + 1] ?? 0) + ny * bias;
    const oz = (p[v * 3 + 2] ?? 0) + nz * bias;
    let shut = 0;
    for (let r = 0; r < rays; r++) {
      const lx = local[r * 3] ?? 0;
      const ly = local[r * 3 + 1] ?? 0;
      const lz = local[r * 3 + 2] ?? 0;
      const dx = tx * lx + bx * ly + nx * lz;
      const dy = ty * lx + by * ly + ny * lz;
      const dz = tz * lx + bz * ly + nz * lz;
      let nearest = reach;
      if (floor && dy < -1e-6) {
        const t = (ground - oy) / dy;
        if (t >= 0 && t < nearest) nearest = t;
      }
      for (let t = 0; t < triangles; t++) {
        const o = t * 6;
        // The ray's segment up to `nearest` against the triangle's box (slab test).
        let t0 = 0;
        let t1 = nearest;
        let miss = false;
        for (let k = 0; k < 3 && !miss; k++) {
          const d = k === 0 ? dx : k === 1 ? dy : dz;
          const s = k === 0 ? ox : k === 1 ? oy : oz;
          const min = box[o + k] ?? 0;
          const max = box[o + 3 + k] ?? 0;
          if (Math.abs(d) < 1e-12) {
            if (s < min || s > max) miss = true;
          } else {
            let a = (min - s) / d;
            let b = (max - s) / d;
            if (a > b) [a, b] = [b, a];
            t0 = Math.max(t0, a);
            t1 = Math.min(t1, b);
            if (t0 > t1) miss = true;
          }
        }
        if (miss) continue;
        // Möller-Trumbore.
        const q = t * 9;
        const e1x = tri[q + 3] ?? 0, e1y = tri[q + 4] ?? 0, e1z = tri[q + 5] ?? 0;
        const e2x = tri[q + 6] ?? 0, e2y = tri[q + 7] ?? 0, e2z = tri[q + 8] ?? 0;
        const hx = dy * e2z - dz * e2y;
        const hy = dz * e2x - dx * e2z;
        const hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const sx = ox - (tri[q] ?? 0);
        const sy = oy - (tri[q + 1] ?? 0);
        const sz = oz - (tri[q + 2] ?? 0);
        const u = inv * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;
        const w = inv * (dx * qx + dy * qy + dz * qz);
        if (w < 0 || u + w > 1) continue;
        const hit = inv * (e2x * qx + e2y * qy + e2z * qz);
        if (hit > 0 && hit < nearest) nearest = hit;
      }
      if (nearest < reach) shut += 1 - nearest / reach;
    }
    out[v] = 1 - strength * (shut / rays);
  }
  return out;
}
