// Merging the office into a handful of meshes (web/src/scene/office/merge.ts, build.ts), built in Node from the real
// packs at 25 people's worth of desks: what the renderer will draw, and the lights that change in place.
import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, type InstancedMesh, Matrix4, type Mesh, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { THEMES } from '../src/core/looks.ts';
import type { ArtPack } from '../src/core/themes.ts';
import { buildOffice, LIGHT_LAYER, type OfficeBuild, type PackKit } from '../web/src/scene/office/build.ts';
import { ATTRIBUTES, mergeParts, trianglesOf } from '../web/src/scene/office/merge.ts';
import { planOffice } from '../web/src/scene/office/plan.ts';
import { companyLayout, readPacks } from './scenery-kit.ts';

let packs: Record<ArtPack, PackKit>;
beforeAll(async () => {
  packs = await readPacks();
});

function build(theme: (typeof THEMES)[number] = 'office', people = 25, decor: readonly string[] = []): OfficeBuild {
  const plan = planOffice(companyLayout(people), { theme, decor });
  if (!plan) throw new Error('no plan');
  return buildOffice(plan, { packs, textures: null });
}

const meshNamed = (b: OfficeBuild, name: string) => b.group.children.find((o) => o.name === name) as Mesh | undefined;

describe('merging parts', () => {
  it('moves positions and turns normals by each part’s matrix, in one indexed geometry', () => {
    const box = new BoxGeometry(1, 1, 1);
    const turn = new Matrix4().compose(new Vector3(10, 0, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(2, 2, 2));
    const merged = mergeParts([{ geometry: box }, { geometry: box, matrix: turn }]);
    const count = box.getAttribute('position').count;
    expect(merged.getAttribute('position').count).toBe(count * 2);
    expect(trianglesOf(merged)).toBe(24);
    merged.computeBoundingBox();
    expect(merged.boundingBox?.max.x).toBeCloseTo(11);
    // The box's +x face, turned a quarter, faces -z, and stays unit length.
    const n = new Vector3().fromBufferAttribute(merged.getAttribute('normal'), count);
    expect(n.length()).toBeCloseTo(1);
    expect(Math.abs(n.z)).toBeCloseTo(1);
    expect(merged.index?.getX(36)).toBe(box.index ? box.index.getX(0) + count : -1);
  });

  it('gives every part the four attributes the buckets share: white colours and corner UVs where missing', () => {
    const bare = new BufferGeometry();
    bare.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    bare.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const merged = mergeParts([{ geometry: bare, tint: [0.5, 0.25, 1] }]);
    expect(Object.keys(merged.attributes).sort()).toEqual([...ATTRIBUTES].sort());
    expect(Array.from(merged.getAttribute('color').array.slice(0, 3))).toEqual([0.5, 0.25, 1]);
    expect(Array.from(merged.getAttribute('uv').array)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(merged.index?.array ?? [])).toEqual([0, 1, 2]);
  });

  it('switches to 32-bit indices only past 65,535 vertices', () => {
    const small = mergeParts([{ geometry: new BoxGeometry() }]);
    expect(small.index?.array).toBeInstanceOf(Uint16Array);
    const many = Array.from({ length: 2800 }, () => ({ geometry: new BoxGeometry() }));
    expect(mergeParts(many).index?.array).toBeInstanceOf(Uint32Array);
  });

  it('refuses a part with no normals, by saying so', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    expect(() => mergeParts([{ geometry: g }])).toThrow('no normals');
  });
});

describe('a built office at 25 people', () => {
  it.each([...THEMES])('draws %s’s building in at most twelve meshes, every piece found', (theme) => {
    const b = build(theme);
    expect(b.missing).toEqual([]);
    expect(b.stats.meshes).toBeLessThanOrEqual(12);
    for (const name of ['furniture', 'structure', 'glow', 'pools']) expect(meshNamed(b, name), name).toBeDefined();
    b.dispose();
  });

  it('stays within the triangle budget for the static building', () => {
    for (const theme of THEMES) {
      const b = build(theme);
      expect(b.stats.triangles, theme).toBeLessThan(70_000);
      b.dispose();
    }
  });

  it('keeps rugs and Restaurant Bits in their own meshes, and only furniture and walls cast contact shadows', () => {
    const b = build('office');
    expect(meshNamed(b, 'rugs')).toBeDefined();
    expect(meshNamed(b, 'restaurant')).toBeDefined();
    expect(b.casters.map((m) => m.name).sort()).toEqual(['furniture', 'restaurant', 'structure']);
    expect(meshNamed(b, 'rugs')?.castShadow).toBe(false);
    b.dispose();
  });

  it('draws one floor mesh per pattern: the rooms’ and the hall’s', () => {
    const b = build('garden');
    expect(b.group.children.filter((o) => o.name.startsWith('floor:')).map((o) => o.name.split('|')[0]).sort()).toEqual(['floor:flagstones', 'floor:grass']);
    b.dispose();
  });

  it('starts dark, lights a desk’s screen while its person works, dims it between steps and darkens it again', () => {
    const plan = planOffice(companyLayout(25), { theme: 'office', decor: [] });
    if (!plan) throw new Error('no plan');
    const b = buildOffice(plan, { packs, textures: null });
    const person = plan.desks.find((d) => d.person)?.key ?? '';
    const glow = meshNamed(b, 'glow');
    const pools = meshNamed(b, 'pools') as InstancedMesh | undefined;
    if (!glow || !pools?.instanceColor) throw new Error('no glow');
    const brightness = () => Array.from(glow.geometry.getAttribute('color').array).reduce((s, v) => s + v, 0);
    const lit = () => {
      const c = new Color();
      let n = 0;
      for (let i = 0; i < pools.count; i++) if ((pools.getColorAt(i, c), c.r + c.g + c.b) > 1e-4) n++;
      return n;
    };
    const dark = brightness();
    const poolsDark = lit();
    expect(b.setLights((k) => (k === person ? 'on' : 'off'))).toBe(true);
    const on = brightness();
    expect(on).toBeGreaterThan(dark);
    expect(lit()).toBeGreaterThan(poolsDark);
    expect(b.setLights((k) => (k === person ? 'on' : 'off'))).toBe(false);
    b.setLights((k) => (k === person ? 'dim' : 'off'));
    expect(brightness()).toBeGreaterThan(dark);
    expect(brightness()).toBeLessThan(on);
    b.setLights(() => 'off');
    expect(brightness()).toBeCloseTo(dark, 3);
    expect(lit()).toBe(poolsDark);
    b.dispose();
  });

  it('blinks the lab’s rack lights in steps, and says when nothing changed', () => {
    const b = build('lab', 25, ['server-rack']);
    const glow = meshNamed(b, 'glow');
    if (!glow) throw new Error('no glow');
    const colours = () => Array.from(glow.geometry.getAttribute('color').array);
    const first = colours();
    expect(b.blink(1)).toBe(true);
    expect(colours()).not.toEqual(first);
    expect(b.blink(1)).toBe(false);
    b.dispose();
  });

  it('keeps light pools off the contact shadows’ layer and out of picking', () => {
    const b = build('office');
    const pools = meshNamed(b, 'pools');
    expect(pools?.layers.mask).toBe(1 << LIGHT_LAYER);
    expect(pools?.raycast({} as never, [])).toBeUndefined();
    b.dispose();
  });

  it('leaves out the pieces of a pack that hasn’t loaded, by name, and draws the rest', () => {
    const plan = planOffice(companyLayout(25), { theme: 'office', decor: [] });
    if (!plan) throw new Error('no plan');
    const b = buildOffice(plan, { packs: { 'furniture-bits': packs['furniture-bits'] }, textures: null });
    expect(b.missing.length).toBeGreaterThan(0);
    expect(b.missing.every((id) => ['kitchen-counter', 'kitchen-sink', 'fridge', 'cafe-table', 'cafe-chair'].includes(id))).toBe(true);
    expect(meshNamed(b, 'restaurant')).toBeUndefined();
    expect(meshNamed(b, 'furniture')).toBeDefined();
    b.dispose();
  });
});
