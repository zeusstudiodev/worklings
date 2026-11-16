// One world on the lobby's mat as three.js objects, and what changes on it: windows fading to their light, the world
// darkening while it rests, the roof lifting and the front walls dropping on the way in. The lobby calls its methods
// from effects and frames; nothing here asks for frames itself.
import {
  type BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from 'three';
import type { WorldParts } from './world.ts';
import { windowPlaces } from './worlds.ts';

/** Lit while someone works, unlit glass otherwise, darker still while the company rests. */
export const WINDOW_LIGHT = { lit: '#FFD98A', unlit: '#46534F', resting: '#2A3330' } as const;
/** How a resting world dims, and how long a window takes to change its light. */
const RESTING = '#6F7A86';
const FADE_MS = 1000;
/** On the way in: how far the roof lifts, and the front walls' knee height. */
const LIFT = 2.8;
const KNEE = 0.48;

function meshOf(geometry: BufferGeometry, material: Material, cast: boolean): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

export class WorldView {
  readonly group = new Group();
  readonly height: number;
  private readonly roof: Mesh;
  private readonly front: Mesh;
  private readonly windows: InstancedMesh;
  private readonly material: MeshStandardMaterial;
  private readonly glowMaterial = new MeshBasicMaterial({ vertexColors: true });
  private shown: Color[] = [];
  private fade: { from: Color[]; to: Color[]; at: number } | null = null;

  /** `parts` are shared between worlds of the same theme and size; the materials and windows are this world's own. */
  constructor(parts: WorldParts, people: number, atlas: Texture | null) {
    this.height = parts.height;
    this.material = new MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.82, metalness: 0 });
    const body = meshOf(parts.body, this.material, true);
    this.front = meshOf(parts.front, this.material, true);
    this.roof = meshOf(parts.roof, this.material, true);
    if (parts.glow) this.front.add(meshOf(parts.glow, this.glowMaterial, false));
    const places = windowPlaces(people);
    this.windows = new InstancedMesh(new PlaneGeometry(0.62, 0.62), new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide }), Math.max(1, places.length));
    const m = new Matrix4();
    const facing = { front: new Quaternion(), right: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2) };
    const unlit = new Color(WINDOW_LIGHT.unlit);
    places.forEach((p, i) => {
      m.compose(new Vector3(p.x + (p.face === 'right' ? 0.012 : 0), p.y, p.z + (p.face === 'front' ? 0.012 : 0)), facing[p.face], new Vector3(1, 1, 1));
      this.windows.setMatrixAt(i, m);
      this.windows.setColorAt(i, unlit);
      this.shown.push(unlit.clone());
    });
    this.windows.count = places.length;
    this.group.add(body, this.front, this.roof, this.windows);
  }

  /** A resting company's world is dark but for its door lamp. */
  setResting(resting: boolean) {
    this.material.color.set(resting ? RESTING : '#ffffff');
  }

  /** Each window fades to its light over a second from `now`; `step` moves the fade on. */
  setWindows(lit: readonly boolean[], resting: boolean, now: number) {
    const to = lit.map((on) => new Color(on ? WINDOW_LIGHT.lit : resting ? WINDOW_LIGHT.resting : WINDOW_LIGHT.unlit));
    if (to.length === this.shown.length && to.every((c, i) => this.shown[i]?.equals(c))) return;
    this.fade = { from: this.shown.map((c) => c.clone()), to, at: now };
  }

  /** Moves the windows' fade on; true while it is still going, so the lobby asks for another frame. */
  step(now: number): boolean {
    const f = this.fade;
    if (!f) return false;
    const t = Math.min(1, (now - f.at) / FADE_MS);
    this.shown = f.to.map((to, i) => (f.from[i] ?? to).clone().lerp(to, t));
    this.shown.forEach((c, i) => this.windows.setColorAt(i, c));
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    if (t >= 1) this.fade = null;
    return t < 1;
  }

  /** How far open: 0 has the roof on, 1 has it lifted and the front walls at knee height. */
  open(e: number) {
    this.roof.position.y = LIFT * e;
    const low = 1 - (1 - KNEE / this.height) * e;
    this.front.scale.y = low;
    this.windows.scale.y = low;
  }

  dispose() {
    this.material.dispose();
    this.glowMaterial.dispose();
    this.windows.geometry.dispose();
    (this.windows.material as Material).dispose();
  }
}
