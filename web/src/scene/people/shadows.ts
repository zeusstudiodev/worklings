// Soft blob shadows under people: one instanced quad for everyone, a radial gradient drawn here as data (no canvas).
import { Color, DataTexture, InstancedMesh, LinearFilter, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { PEOPLE_LAYER } from './rig.ts';

const SIZE = 64;
const position = new Vector3();
const scale = new Vector3();
const turn = new Quaternion();
const matrix = new Matrix4();

/** White in the middle to clear at the edge, with a soft falloff. */
export function radialTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) / (SIZE / 2);
      const a = d >= 1 ? 0 : (1 - d) ** 1.6;
      data.set([255, 255, 255, Math.round(a * 255)], (y * SIZE + x) * 4);
    }
  }
  const texture = new DataTexture(data, SIZE, SIZE);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class BlobShadows {
  readonly mesh: InstancedMesh;
  private readonly texture = radialTexture();

  constructor(capacity: number) {
    const material = new MeshBasicMaterial({ map: this.texture, color: new Color('#1A231E'), transparent: true, opacity: 0.42, depthWrite: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, capacity);
    this.mesh.name = 'people-shadows';
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(PEOPLE_LAYER);
    // Shadows only: they never take a click meant for someone.
    this.mesh.raycast = () => {};
  }

  get capacity(): number {
    return this.mesh.instanceMatrix.count;
  }

  /** Places shadow `i` under someone at (x, z), `size` across, just above the floor. */
  set(i: number, x: number, z: number, size: number): void {
    matrix.compose(position.set(x, 0.075, z), turn, scale.set(size, 1, size));
    this.mesh.setMatrixAt(i, matrix);
  }

  show(count: number): void {
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}
