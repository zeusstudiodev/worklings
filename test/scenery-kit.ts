// What the scenery tests share: the built packs read in Node the way the office's loader hands them over (plain
// geometry, node transforms baked in, baked occlusion as vertex colours), and company floor plans of a given size.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, Uint32BufferAttribute, Vector3 } from 'three';
import type { CompanyView, PersonView } from '../src/core/company.ts';
import { demoCompanyView, studioOf } from '../src/core/demo-company.ts';
import type { OfficeRoom } from '../src/core/studio.ts';
import { ART_PACKS, type ArtPack } from '../src/core/themes.ts';
import { sceneryFile } from '../web/src/scene/art/spec.ts';
import { computeLayout, type Layout } from '../web/src/scene/layout.ts';
import type { PackKit } from '../web/src/scene/office/build.ts';

const ART = fileURLToPath(new URL('../web/public/art/', import.meta.url));

/** Every pack's pieces from web/public/art, by their names in the pack. */
export async function readPacks(): Promise<Record<ArtPack, PackKit>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const out: Partial<Record<ArtPack, PackKit>> = {};
  for (const pack of ART_PACKS) {
    const doc = await io.read(join(ART, sceneryFile(pack)));
    const pieces = new Map<string, BufferGeometry>();
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const world = new Matrix4().fromArray(node.getWorldMatrix());
      const turn = new Matrix3().getNormalMatrix(world);
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const shades: number[] = [];
      const indices: number[] = [];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const nor = prim.getAttribute('NORMAL');
        const uv = prim.getAttribute('TEXCOORD_0');
        if (!pos || !nor || !uv) throw new Error(`${pack}: ${node.getName()} lacks an attribute`);
        const base = positions.length / 3;
        const v = new Vector3();
        const e: number[] = [];
        for (let i = 0; i < pos.getCount(); i++) {
          v.fromArray(pos.getElement(i, e)).applyMatrix4(world);
          positions.push(v.x, v.y, v.z);
          v.fromArray(nor.getElement(i, e)).applyMatrix3(turn).normalize();
          normals.push(v.x, v.y, v.z);
          const [u = 0, t = 0] = uv.getElement(i, e);
          uvs.push(u, t);
          const shade = prim.getAttribute('_OCCLUSION')?.getElement(i, e)[0] ?? 1;
          shades.push(shade, shade, shade);
        }
        const index = prim.getIndices();
        const count = index ? index.getCount() : pos.getCount();
        for (let i = 0; i < count; i++) indices.push(base + (index ? (index.getScalar(i)) : i));
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(positions, 3));
      g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
      g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
      g.setAttribute('color', new Float32BufferAttribute(shades, 3));
      g.setIndex(new Uint32BufferAttribute(indices, 1));
      g.computeBoundingBox();
      pieces.set(node.getName(), g);
    }
    out[pack] = { pieces };
  }
  return out as Record<ArtPack, PackKit>;
}

const NOW = Date.parse('2026-11-05T10:00:00Z');

/** The demo café grown to `people` (extra people in its departments, every other one at work), with extra rooms. */
export function companyView(people: number, rooms: readonly OfficeRoom[] = []): CompanyView {
  const base = demoCompanyView(NOW);
  const all: PersonView[] = [...base.people];
  const departments = ['engineering', 'design', 'engineering', 'quality', 'content'];
  for (let i = 0; all.length < people; i++) {
    const room = departments[i % departments.length] ?? 'engineering';
    const model = base.people.find((p) => p.room === room && p.level === 'worker');
    if (!model) throw new Error(`the demo has no worker in ${room}`);
    all.push({ ...model, id: `${room}-extra-${i}`, name: `Extra ${i}`, title: `${model.title} ${i + 2}`, agentKey: null, desk: { ...model.desk, state: i % 2 ? 'idle' : 'working' } });
  }
  return { ...base, people: all.slice(0, people), rooms: [...base.rooms, ...rooms] };
}

/** A company's floor plan for so many people. */
export function companyLayout(people = 25, rooms: readonly OfficeRoom[] = []): Layout {
  return computeLayout(studioOf(companyView(people, rooms)));
}
