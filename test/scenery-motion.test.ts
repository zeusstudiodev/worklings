// The office's own parts in the moments (web/src/scene/office/motion.ts, build.ts's loose builds, pins.ts): a room
// building in floor first, then walls, then furniture; a desk dropping with a squash; a room lifting away; pins popping.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtPack } from '../src/core/themes.ts';
import { BUILD_FLOOR_MS, BUILD_WALLS_MS, DESK_DROP_MS, PIN_POP_MS, ROOM_OUT_MS } from '../web/src/scene/moments.ts';
import { buildLoose, buildOffice, type Element, type PackKit } from '../web/src/scene/office/build.ts';
import { builtBy, buildingPose, droppingDesks, dropPose, goingPose, pieceStart, pinMoving, pinScale } from '../web/src/scene/office/motion.ts';
import { BoardPins, pinsFrom, pinsKey } from '../web/src/scene/office/pins.ts';
import { planOffice } from '../web/src/scene/office/plan.ts';
import { companyLayout, readPacks } from './scenery-kit.ts';

let packs: Record<ArtPack, PackKit>;
beforeAll(async () => {
  packs = await readPacks();
});

const element = (kind: Element['kind'], order = 0): Element => ({ kind, room: 'design', key: `${kind}:${order}`, order, x: 0, z: 0 });
const AT = 10_000;

describe('a room building in', () => {
  it('lays its floor first, then raises its walls, then brings in its furniture', () => {
    const floor = (t: number) => buildingPose(element('floor'), AT, t, 10, null);
    const walls = (t: number) => buildingPose(element('walls'), AT, t, 10, null);
    const piece = (t: number) => buildingPose(element('piece', 0), AT, t, 10, null);
    expect(floor(AT - 1).visible).toBe(false);
    expect(floor(AT + BUILD_FLOOR_MS / 2).sy).toBeGreaterThan(0);
    expect(floor(AT + BUILD_FLOOR_MS / 2).sy).toBeLessThan(1);
    expect(walls(AT + BUILD_FLOOR_MS / 2).visible).toBe(false);
    expect(walls(AT + BUILD_FLOOR_MS + BUILD_WALLS_MS / 2).sy).toBeLessThan(1);
    expect(piece(AT + BUILD_FLOOR_MS + BUILD_WALLS_MS - 1).visible).toBe(false);
    for (const t of [AT + BUILD_FLOOR_MS, AT + 5000]) expect(floor(t)).toMatchObject({ visible: true, sy: 1 });
    expect(walls(AT + 5000)).toMatchObject({ visible: true, sy: 1, y: 0 });
    expect(piece(AT + 5000)).toMatchObject({ visible: true, sx: 1, sy: 1, sz: 1, y: 0 });
  });

  it('brings its furniture in one piece after another, all within the room’s time however much there is', () => {
    expect(pieceStart(AT, 1, 4)).toBeGreaterThan(pieceStart(AT, 0, 4));
    expect(pieceStart(AT, 39, 40)).toBeLessThan(builtBy(AT));
    expect(pieceStart(AT, 0, 40)).toBe(AT + BUILD_FLOOR_MS + BUILD_WALLS_MS);
  });

  it('drops a desk the moments drop: falling from above, landing with a squash, then still', () => {
    expect(dropPose(AT, AT - 1).visible).toBe(false);
    const falling = dropPose(AT, AT + DESK_DROP_MS / 2);
    expect(falling.y).toBeGreaterThan(0.5);
    const landed = dropPose(AT, AT + DESK_DROP_MS + 1);
    expect(landed.y).toBe(0);
    expect(landed.sy).toBeLessThan(1);
    expect(landed.sx).toBeGreaterThan(1);
    expect(dropPose(AT, AT + DESK_DROP_MS + 2000)).toMatchObject({ y: 0, sx: 1, sy: 1, sz: 1 });
    expect(buildingPose(element('desk'), AT, AT + DESK_DROP_MS / 2, 4, AT).y).toBeGreaterThan(0.5);
  });

  it('matches the moments’ drops to the desks standing there', () => {
    const plan = planOffice(companyLayout(25), { theme: 'office', decor: [] });
    const desk = plan?.desks[3];
    if (!plan || !desk) throw new Error('no desks');
    expect([...droppingDesks(plan.desks, [{ x: desk.x, z: desk.z, at: AT }])]).toEqual([[desk.key, AT]]);
    expect(droppingDesks(plan.desks, [{ x: 999, z: 999, at: AT }]).size).toBe(0);
  });
});

describe('a room taken out', () => {
  it('lifts its furniture away first, sinks its walls, lowers its floor last, and is gone after ROOM_OUT_MS', () => {
    const early = AT + ROOM_OUT_MS * 0.3;
    expect(goingPose(element('piece'), AT, early).y).toBeGreaterThan(0);
    expect(goingPose(element('floor'), AT, early)).toMatchObject({ y: 0, sy: 1 });
    expect(goingPose(element('walls'), AT, AT + ROOM_OUT_MS * 0.6).sy).toBeLessThan(1);
    expect(goingPose(element('floor'), AT, AT + ROOM_OUT_MS * 0.9).sy).toBeLessThan(1);
    for (const kind of ['floor', 'walls', 'desk', 'piece'] as const) expect(goingPose(element(kind), AT, AT + ROOM_OUT_MS).visible).toBe(false);
  });
});

describe('the org board’s pins', () => {
  it('pop in from nothing at `since`, settle at full size, and pop out from `until`', () => {
    expect(pinScale(AT, null, AT - 1)).toBe(0);
    expect(pinScale(AT, null, AT + PIN_POP_MS / 2)).toBeGreaterThan(0);
    expect(pinScale(AT, null, AT + PIN_POP_MS)).toBe(1);
    expect(pinScale(AT, AT + 5000, AT + 5000 + PIN_POP_MS / 2)).toBeCloseTo(0.5);
    expect(pinScale(AT, AT + 5000, AT + 5000 + PIN_POP_MS)).toBe(0);
    expect(pinMoving(AT, null, AT + 10)).toBe(true);
    expect(pinMoving(AT, null, AT + PIN_POP_MS + 10)).toBe(false);
  });

  it('places every pin once and asks for frames only while one pops', () => {
    const pins = new BoardPins([{ x: 1, y: 2, z: 3, hue: '#5B8FC7', since: AT, until: null }, { x: 1.2, y: 2, z: 3, hue: '#E58FA0', since: AT - 5000, until: null }], 3.5);
    expect(pins.mesh.count).toBe(2);
    expect(pins.place(AT + 10)).toBe(true);
    expect(pins.place(AT + PIN_POP_MS + 10)).toBe(false);
    expect(pins.place(AT + PIN_POP_MS + 20)).toBe(false);
    pins.dispose();
  });

  it('keys the pins by what they show, so the same board in a new array keeps its mesh', () => {
    // The CEO's pin was there before the office remembers (since minus infinity); Mina is on her way out.
    const ceo = { x: 4.25, y: 2.62, z: -3.97, hue: '#C9B458', since: Number.NEGATIVE_INFINITY, until: null };
    const mina = { x: 4.1 + 0.2, y: 2.32, z: -3.97, hue: '#E58FA0', since: AT, until: AT + 5000 };
    const key = pinsKey([ceo, mina]);
    expect(pinsKey([{ ...ceo }, { ...mina }])).toBe(key);
    expect(pinsFrom(key)).toEqual([ceo, mina]);
    expect(pinsKey([ceo, { ...mina, until: null }])).not.toBe(key);
    expect(pinsFrom(pinsKey([]))).toEqual([]);
  });

  it('leaves the board blank for the pins when the moments pin the org, and draws the floor plan’s otherwise', () => {
    const layout = companyLayout(25);
    expect(planOffice(layout, { theme: 'office', decor: [], chart: false })?.chart).toBeNull();
    expect(planOffice(layout, { theme: 'office', decor: [] })?.chart?.rooms.length).toBe(layout.rooms.length);
  });
});

describe('building around what moves', () => {
  it('leaves a room building in out of the merged office and draws it loose, an element at a time', () => {
    const plan = planOffice(companyLayout(25), { theme: 'office', decor: [] });
    if (!plan) throw new Error('no plan');
    const room = plan.rooms.find((r) => r.department)?.id ?? '';
    const moving = (e: Element) => e.room === room;
    const whole = buildOffice(plan, { packs, textures: null });
    const without = buildOffice(plan, { packs, textures: null }, (e) => !moving(e));
    const loose = buildLoose(plan, { packs, textures: null }, moving);
    expect(without.stats.triangles).toBeLessThan(whole.stats.triangles);
    const kinds = new Set(loose.elements.map((e) => e.element.kind));
    expect([...kinds].sort()).toEqual(['desk', 'floor', 'piece', 'walls']);
    expect(loose.elements.every((e) => e.element.room === room)).toBe(true);
    // Each element stands at its own origin, so it can drop, rise or lower as a whole.
    for (const { element: el, group } of loose.elements) expect([group.position.x, group.position.z]).toEqual([el.x, el.z]);
    const desks = plan.desks.filter((d) => d.room === room).length;
    expect(loose.elements.filter((e) => e.element.kind === 'desk')).toHaveLength(desks);
    for (const b of [whole, without]) b.dispose();
    loose.dispose();
  });

  it('keeps a dropping desk’s lights with it, out of the merged office', () => {
    const plan = planOffice(companyLayout(25), { theme: 'office', decor: [] });
    const desk = plan?.desks.find((d) => d.person);
    if (!plan || !desk) throw new Error('no desk');
    const b = buildOffice(plan, { packs, textures: null }, (e) => e.key !== `desk:${desk.key}`);
    // Its screen is not among the lights the merged office switches.
    expect(b.setLights((k) => (k === desk.key ? 'on' : 'off'))).toBe(false);
    b.dispose();
  });
});
