// v2's watching office merged (web/src/scene/office/studio.ts) and night in a company's office (build.ts): a handful
// of meshes at any size, desks that light as before, the selected room's floor, what a click lands on, and light that
// dims at night but for the front desk's lamp.
import { BufferAttribute, Color, type InstancedMesh, type Mesh } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BaseDepartment } from '../src/core/departments.ts';
import type { Studio } from '../src/core/studio.ts';
import type { ArtPack } from '../src/core/themes.ts';
import { computeLayout } from '../web/src/scene/layout.ts';
import { buildOffice, type PackKit } from '../web/src/scene/office/build.ts';
import { planOffice } from '../web/src/scene/office/plan.ts';
import { buildStudio } from '../web/src/scene/office/studio.ts';
import { companyLayout, readPacks } from './scenery-kit.ts';

const STYLES: BaseDepartment[] = ['engineering', 'design', 'quality', 'content', 'data', 'ops'];

/** A v2 studio the office only watches: no office section and no levels, `roles` roles in six rooms. */
function watched(roles: number): Studio {
  return {
    version: 1,
    name: 'Watched',
    domain: 'custom',
    rigor: 'standard',
    departments: STYLES.map((style) => ({ id: style, name: style, style })),
    roles: Array.from({ length: roles }, (_, i) => ({ id: `role-${i + 1}`, department: STYLES[i % STYLES.length] ?? 'engineering', title: `Role ${i + 1}` })),
    rules: STYLES.flatMap((d, k) => Array.from({ length: (k % 3) + 1 }, (_, j) => ({ id: `${d}-rule-${j}`, department: d, title: `${d} rule ${j}` }))),
    gates: [{ id: 'code-gate', title: 'Code gate', from: 'engineering', to: 'quality' }],
    skills: [],
    fired: [],
  };
}

const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0);
const named = (group: { children: readonly unknown[] }, name: string) => group.children.find((o) => (o as Mesh).name === name) as Mesh | undefined;

describe('v2’s watching office, merged', () => {
  it.each([1, 25, 40])('draws %i roles in three meshes, whatever the size', (n) => {
    const layout = computeLayout(watched(n));
    expect(layout.office).toBeUndefined();
    const b = buildStudio(layout);
    expect(b.stats.meshes).toBe(3);
    expect(b.group.children.map((o) => o.name).sort()).toEqual(['studio', 'studio-floors', 'studio-glow']);
    b.dispose();
  });

  it('grows in triangles with its desks, not in meshes', () => {
    const small = buildStudio(computeLayout(watched(10)));
    const big = buildStudio(computeLayout(watched(40)));
    expect(big.stats.triangles).toBeGreaterThan(small.stats.triangles);
    expect(big.stats.meshes).toBe(small.stats.meshes);
    small.dispose();
    big.dispose();
  });

  it('lights a working role’s laptop and lamp, and only theirs, and says when nothing changed', () => {
    const b = buildStudio(computeLayout(watched(12)));
    const glow = named(b.group, 'studio-glow');
    if (!glow) throw new Error('no glow');
    const emission = () => sum(glow.geometry.getAttribute('emission').array as Float32Array);
    expect(emission()).toBe(0);
    expect(b.setLit((d) => d === 'role-1')).toBe(true);
    const one = emission();
    expect(one).toBeGreaterThan(0);
    expect(b.setLit((d) => d === 'role-1')).toBe(false);
    b.setLit((d) => d === 'role-1' || d === 'lead');
    expect(emission()).toBeGreaterThan(one);
    b.setLit(() => false);
    expect(emission()).toBe(0);
    b.dispose();
  });

  it('tints the selected room’s floor and puts it back when another is picked', () => {
    const layout = computeLayout(watched(12));
    const b = buildStudio(layout);
    const floors = named(b.group, 'studio-floors');
    if (!floors) throw new Error('no floors');
    const colours = () => Array.from(floors.geometry.getAttribute('color').array as Float32Array);
    const before = colours();
    expect(b.select('design')).toBe(true);
    expect(colours()).not.toEqual(before);
    expect(b.select('design')).toBe(false);
    b.select(null);
    expect(colours()).toEqual(before);
    b.dispose();
  });

  it('tells a click on a rule’s poster from one in a room, the lobby or outside', () => {
    const layout = computeLayout(watched(12));
    const b = buildStudio(layout);
    const room = layout.rooms.find((r) => r.posters.length > 0);
    const poster = room?.posters[0];
    if (!room || !poster) throw new Error('no poster');
    expect(b.pick({ x: poster.x, y: 1.3, z: poster.z + 0.13 })).toEqual({ kind: 'poster', room: room.id, rule: poster.ruleId });
    expect(b.pick({ x: room.x + room.w / 2, y: 0.06, z: room.z + room.d / 2 })).toEqual({ kind: 'room', room: room.id });
    expect(b.pick({ x: layout.lobby.x + 1, y: 0.06, z: layout.lobby.z + 1 })).toEqual({ kind: 'floor' });
    expect(b.pick({ x: layout.bounds.minX - 50, y: 0, z: 0 })).toBeNull();
    b.dispose();
  });
});

describe('night in a company’s office', () => {
  let packs: Record<ArtPack, PackKit>;
  beforeAll(async () => {
    packs = await readPacks();
  });

  function office() {
    const plan = planOffice(companyLayout(25), { theme: 'office', decor: [] });
    if (!plan) throw new Error('no plan');
    return { plan, build: buildOffice(plan, { packs, textures: null }) };
  }

  it('fades every light pool but the front desk lamp’s, and brings them back with the morning', () => {
    const { plan, build } = office();
    const pools = named(build.group, 'pools') as InstancedMesh | undefined;
    if (!pools) throw new Error('no pools');
    const day = Array.from({ length: pools.count }, (_, i) => pools.getColorAt(i, new Color()).clone());
    expect(build.setNight(1)).toBe(true);
    const staying = plan.lights.filter((l) => l.stays).length;
    expect(staying).toBeGreaterThan(0);
    let lit = 0;
    for (let i = 0; i < pools.count; i++) {
      const c = pools.getColorAt(i, new Color());
      if (c.r + c.g + c.b > 1e-6) {
        lit++;
        expect(c.equals(day[i] ?? new Color())).toBe(true);
      }
    }
    // The front desk's lamp: its pool and halo in the plan, and the pool under the lamp itself.
    expect(lit).toBe(staying + 1);
    build.setNight(0);
    for (let i = 0; i < pools.count; i++) expect(pools.getColorAt(i, new Color()).equals(day[i] ?? new Color())).toBe(true);
    build.dispose();
  });

  it('puts the meeting room’s screen out at night and leaves the front desk lamp’s bulb on', () => {
    const { plan, build } = office();
    const glow = named(build.group, 'glow');
    const screen = plan.pieces.find((p) => p.id === 'meeting-screen');
    const lamp = plan.pieces.find((p) => p.id === 'front-lamp');
    if (!glow || !screen || !lamp) throw new Error('no glow, meeting screen or front desk lamp');
    const position = glow.geometry.getAttribute('position');
    const colour = glow.geometry.getAttribute('color');
    const near = (x: number, z: number, reach: number) => Array.from({ length: position.count }, (_, i) => i).filter((i) => Math.hypot(position.getX(i) - x, position.getZ(i) - z) <= reach);
    const brightness = (i: number) => colour.getX(i) + colour.getY(i) + colour.getZ(i);
    const onScreen = near(screen.x, screen.z, (screen.w ?? 2.4) / 2 + 0.2);
    const bulb = near(lamp.x, lamp.z, 0.3);
    expect(Math.max(...onScreen.map(brightness))).toBeGreaterThan(2);
    expect(bulb.length).toBeGreaterThan(0);
    const bulbByDay = bulb.map(brightness);
    build.setNight(1);
    expect(Math.max(...onScreen.map(brightness))).toBeLessThan(0.1);
    expect(bulb.map(brightness)).toEqual(bulbByDay);
    build.dispose();
  });

  it('turns the windows’ sky to night, and changes nothing when the level hasn’t moved', () => {
    const { build } = office();
    const glow = named(build.group, 'glow');
    if (!glow) throw new Error('no glow');
    const brightness = () => sum((glow.geometry.getAttribute('color') as BufferAttribute).array as Float32Array);
    const day = brightness();
    expect(build.setNight(0.5)).toBe(true);
    const dusk = brightness();
    expect(dusk).toBeLessThan(day);
    expect(build.setNight(0.5)).toBe(false);
    build.setNight(1);
    expect(brightness()).toBeLessThan(dusk);
    build.dispose();
  });
});
