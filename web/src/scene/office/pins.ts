// The org board's pins (docs/game-feel.md, section 6): one per person in their room's hue, by level, popping in with a
// hire and out with a firing. One instanced mesh; moments.ts says where and when, motion.ts how big.
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { MomentProps } from '../moments.ts';
import { pinMoving, pinScale } from './motion.ts';

type Pin = MomentProps['pins'][number];

/** The pins as a string that changes only when what they show does: moments.ts makes a new array with every snapshot. */
export const pinsKey = (pins: readonly Pin[]): string => pins.map((p) => [p.x, p.y, p.z, p.since, p.until ?? '', p.hue].join(' ')).join('\n');

/** The pins back from their key, as they were (a `since` of minus infinity too). */
export function pinsFrom(key: string): Pin[] {
  if (key === '') return [];
  return key.split('\n').map((line) => {
    const [x = '', y = '', z = '', since = '', until = '', ...hue] = line.split(' ');
    return { x: Number(x), y: Number(y), z: Number(z), since: Number(since), until: until === '' ? null : Number(until), hue: hue.join(' ') };
  });
}

export class BoardPins {
  readonly mesh: InstancedMesh;
  private readonly pins: readonly Pin[];
  private placed = false;
  private moving = false;

  /** `face`: the z of the board's face, where the pins stick. */
  constructor(pins: readonly Pin[], face: number) {
    this.pins = pins;
    const geometry = new BoxGeometry(0.15, 0.17, 0.02).translate(0, 0, face + 0.01);
    this.mesh = new InstancedMesh(geometry, new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0 }), Math.max(1, pins.length));
    this.mesh.count = pins.length;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    const c = new Color();
    pins.forEach((p, i) => this.mesh.setColorAt(i, c.set(p.hue)));
  }

  /**
   * Sizes each pin for `now` on the scene clock (null: no clock, every pin on staff shown). Does nothing once every
   * pin has settled; returns whether one is still popping, so the office asks for another frame.
   */
  place(now: number | null): boolean {
    if (this.placed && !this.moving) return false;
    const m = new Matrix4();
    const q = new Quaternion();
    let popping = false;
    this.pins.forEach((p, i) => {
      const s = now === null ? (p.until === null ? 1 : 0) : pinScale(p.since, p.until, now);
      m.compose(new Vector3(p.x, p.y, 0), q, new Vector3(Math.max(s, 1e-3), Math.max(s, 1e-3), 1));
      this.mesh.setMatrixAt(i, m);
      if (now !== null && pinMoving(p.since, p.until, now)) popping = true;
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.placed = true;
    this.moving = popping;
    return popping;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
