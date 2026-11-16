// A company's floor plan (docs/game-feel.md, section 6): the departments' rooms behind the hall, the front strip with
// the CEO's office, reception and the meeting room, a desk per person and a free one per room, rooms that never move.
import { describe, expect, it } from 'vitest';
import type { OfficeRoom, Studio, StudioDepartment, StudioRole } from '../src/core/studio.ts';
import { type CompanyDesk, computeLayout, type Layout, type Point, type Rect, wallRects } from '../web/src/scene/layout.ts';
import { route } from '../web/src/scene/walk.ts';

const DEPARTMENTS: StudioDepartment[] = [
  { id: 'direction', name: 'Direction', style: 'direction' },
  { id: 'design', name: 'Design', style: 'design' },
  { id: 'engineering', name: 'Engineering', style: 'engineering' },
  { id: 'quality', name: 'Quality', style: 'quality' },
];
const ROOMS: OfficeRoom[] = [
  { id: 'reception', title: 'Reception', kind: 'reception' },
  { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
  { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
  { id: 'kitchen', title: 'Kitchen', kind: 'kitchen' },
];

const role = (id: string, department: string, level: StudioRole['level'] = 'worker', reportsTo?: string): StudioRole => ({
  id, department, title: id, level, ...(reportsTo ? { reportsTo } : {}),
});

/** A café's company: the CEO and the office manager in Direction, three rooms of people under their heads. */
function cafe(extra: StudioRole[] = [], rooms: OfficeRoom[] = ROOMS, departments: StudioDepartment[] = DEPARTMENTS): Studio {
  return {
    version: 1, name: 'Café Lumen', domain: 'web-app', rigor: 'standard',
    office: { theme: 'cafe', rooms, decor: [] },
    departments,
    roles: [
      role('ceo', 'direction', 'ceo'),
      role('office-manager', 'direction', 'worker', 'ceo'),
      role('ui-designer', 'design', 'worker', 'head-of-design'),
      role('head-of-design', 'design', 'head', 'ceo'),
      role('ux-designer', 'design', 'worker', 'head-of-design'),
      role('head-of-engineering', 'engineering', 'head', 'ceo'),
      role('frontend-engineer', 'engineering', 'worker', 'head-of-engineering'),
      role('backend-engineer', 'engineering', 'worker', 'head-of-engineering'),
      role('qa-engineer', 'quality', 'worker', 'head-of-engineering'),
      ...extra,
    ],
    rules: [], gates: [], skills: [], fired: [],
  };
}

const inside = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
function office(layout: Layout) {
  if (!layout.office) throw new Error('No office in this layout');
  return layout.office;
}
const deskOf = (layout: Layout, person: string): CompanyDesk => {
  const desk = office(layout).byPerson.get(person);
  if (!desk) throw new Error(`No desk for ${person}`);
  return desk;
};
const allRooms = (layout: Layout): Rect[] => {
  const o = office(layout);
  return [...layout.rooms, ...o.rest, o.ceo, o.reception, ...(o.meeting ? [o.meeting] : [])];
};

describe('a company floor plan', () => {
  it('seats the CEO and the rest of their department in the CEO office, everyone else in their room', () => {
    const layout = computeLayout(cafe());
    const o = office(layout);
    expect(o.ceo.desk.person).toBe('ceo');
    expect(o.ceo.desk.wide).toBe(true);
    expect(o.ceo.desks.map((d) => d.person)).toEqual(['office-manager']);
    expect(layout.rooms.map((r) => r.id)).toEqual(['design', 'engineering', 'quality']);
    const design = layout.rooms.find((r) => r.id === 'design');
    expect(design?.desks.map((d) => d.roleId).sort()).toEqual(['head-of-design', 'ui-designer', 'ux-designer']);
    for (const room of layout.rooms) for (const desk of [...room.desks, ...(room.spare ?? [])]) expect(inside(desk, room)).toBe(true);
    for (const desk of [o.ceo.desk, ...o.ceo.desks, ...o.ceo.spare]) expect(inside(desk, o.ceo)).toBe(true);
  });

  it('keeps one free desk in each room, two once a room has more than six people', () => {
    const big = Array.from({ length: 5 }, (_, i) => role(`engineer-${i}`, 'engineering', 'worker', 'head-of-engineering'));
    const layout = computeLayout(cafe(big));
    const spare = (id: string) => layout.rooms.find((r) => r.id === id)?.spare?.length;
    expect(spare('design')).toBe(1);
    expect(spare('quality')).toBe(1);
    expect(spare('engineering')).toBe(2);
    expect(office(layout).ceo.spare).toHaveLength(1);
  });

  it('lets no rooms overlap and keeps everything inside the bounds', () => {
    const layout = computeLayout(cafe());
    const rooms = allRooms(layout);
    rooms.forEach((a, i) => rooms.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    for (const r of rooms) {
      expect(r.x).toBeGreaterThanOrEqual(minX);
      expect(r.x + r.w).toBeLessThanOrEqual(maxX);
      expect(r.z).toBeGreaterThanOrEqual(minZ);
      expect(r.z + r.d).toBeLessThanOrEqual(maxZ);
    }
    expect(office(layout).edge.z).toBeLessThan(maxZ);
  });

  it('puts the front desk at the front of reception with six places behind the counter, the first in the middle', () => {
    const o = office(computeLayout(cafe()));
    const { counter, places } = o.reception.frontDesk;
    expect(places).toHaveLength(6);
    expect(counter.z + counter.d).toBeGreaterThan(o.reception.z + o.reception.d - 1.5);
    const [middle, left, right, ...behind] = places;
    expect(middle?.x).toBeCloseTo(counter.x + counter.w / 2);
    expect(left && middle && left.x < middle.x).toBe(true);
    expect(right && middle && right.x > middle.x).toBe(true);
    for (const p of behind) expect(middle && p.z < middle.z).toBe(true);
    for (const p of places) {
      expect(p.facing).toBe(0);
      expect(p.z).toBeLessThan(counter.z);
      expect(inside(p, o.reception)).toBe(true);
    }
  });

  it('seats heads nearest their door', () => {
    const layout = computeLayout(cafe());
    for (const [roomId, head] of [['design', 'head-of-design'], ['engineering', 'head-of-engineering']] as const) {
      const room = layout.rooms.find((r) => r.id === roomId);
      if (!room) throw new Error(roomId);
      const door = { x: room.x + room.w / 2, z: room.z + room.d };
      const nearest = [...room.desks].sort((a, b) => Math.hypot(a.x - door.x, a.z - door.z) - Math.hypot(b.x - door.x, b.z - door.z))[0];
      expect(nearest?.roleId).toBe(head);
      expect(deskOf(layout, head).slot).toBe(0);
    }
  });

  it('leaves every desk a way to the front desk, the meeting room, the kitchen and the street', () => {
    const layout = computeLayout(cafe());
    const o = office(layout);
    const goals: Point[] = [...o.reception.frontDesk.places, o.meeting?.head ?? o.edge, ...(o.meeting?.spots ?? []), ...o.rest.flatMap((r) => r.seats), o.edge, o.door];
    for (const desk of o.byPerson.values()) for (const goal of goals) expect(route(layout, desk.seat, goal)).not.toBeNull();
    for (const a of o.byPerson.values()) for (const b of o.byPerson.values()) if (a !== b) expect(route(layout, a.seat, b.visitor)).not.toBeNull();
  });

  it('cuts doors into the walls where people walk through: reception has one from the hall and one from the street', () => {
    const o = office(computeLayout(cafe()));
    const walls = wallRects(o.reception);
    const doorway = (at: Point) => walls.some((w) => at.x >= w.x && at.x <= w.x + w.w && at.z >= w.z && at.z <= w.z + w.d);
    expect(doorway({ x: o.door.x, z: o.reception.z + o.reception.d - 0.05 })).toBe(false);
    expect(doorway({ x: o.door.x - 0.8, z: o.reception.z + 0.05 })).toBe(false);
    expect(doorway({ x: o.reception.x + 4, z: o.reception.z + 0.05 })).toBe(true);
    expect(doorway({ x: o.reception.x + 4, z: o.reception.z + o.reception.d - 0.05 })).toBe(true);
  });

  it('lays out a company being founded: the CEO alone, the board, reception and the meeting room', () => {
    const founding: Studio = { ...cafe(), roles: [role('ceo', 'direction', 'ceo')], departments: [DEPARTMENTS[0] as StudioDepartment] };
    delete founding.office;
    const layout = computeLayout(founding);
    const o = office(layout);
    expect(layout.rooms).toEqual([]);
    expect(o.ceo.desk.person).toBe('ceo');
    expect(o.meeting).not.toBeNull();
    expect(inside(o.ceo.boardSpot, o.ceo)).toBe(true);
    expect(route(layout, o.edge, o.ceo.boardSpot)).not.toBeNull();
  });

  it('keeps v1 and v2 studios on their own floor plan', () => {
    const v2: Studio = { ...cafe(), roles: cafe().roles.map(({ level: _level, reportsTo: _to, ...r }) => r) };
    delete v2.office;
    const layout = computeLayout(v2);
    expect(layout.office).toBeUndefined();
    expect(layout.rooms.map((r) => r.id)).toEqual(['direction', 'design', 'engineering', 'quality']);
    expect(layout.rooms[0]?.z).toBe(0);
  });
});

describe('a floor plan learned once', () => {
  it('keeps rooms and desks where they were when someone is hired, and the hire takes the free desk', () => {
    const before = computeLayout(cafe());
    const free = before.rooms.find((r) => r.id === 'design')?.spare?.[0];
    const after = computeLayout(cafe([role('brand-designer', 'design', 'worker', 'head-of-design')]), office(before).places);
    for (const room of before.rooms) {
      const now = after.rooms.find((r) => r.id === room.id);
      expect(now?.x).toBe(room.x);
      expect(now && now.z + now.d).toBe(room.z + room.d);
    }
    for (const [person, desk] of office(before).byPerson) expect(deskOf(after, person)).toMatchObject({ x: desk.x, z: desk.z });
    expect(deskOf(after, 'brand-designer')).toMatchObject({ x: free?.x, z: free?.z });
    expect(after.rooms.find((r) => r.id === 'design')?.spare).toHaveLength(1);
  });

  it('grows a room toward the back when it has no free desk, and moves nothing else', () => {
    let layout = computeLayout(cafe());
    const first = layout;
    const hires: StudioRole[] = [];
    for (let i = 0; i < 6; i++) {
      hires.push(role(`designer-${i}`, 'design', 'worker', 'head-of-design'));
      layout = computeLayout(cafe(hires), office(layout).places);
    }
    const before = first.rooms.find((r) => r.id === 'design');
    const grown = layout.rooms.find((r) => r.id === 'design');
    expect(grown && before && grown.d > before.d).toBe(true);
    expect(grown && before && grown.z + grown.d).toBe(before && before.z + before.d);
    for (const room of first.rooms.filter((r) => r.id !== 'design')) expect(layout.rooms.find((r) => r.id === room.id)).toMatchObject({ x: room.x, z: room.z, w: room.w, d: room.d });
    expect(office(layout).reception).toMatchObject({ x: office(first).reception.x, z: office(first).reception.z });
    for (const [person, desk] of office(first).byPerson) expect(deskOf(layout, person)).toMatchObject({ x: desk.x, z: desk.z });
  });

  it('leaves a fired person their desk free, and gives it back when they are rehired', () => {
    const before = computeLayout(cafe());
    const desk = deskOf(before, 'ui-designer');
    const fired = cafe().roles.filter((r) => r.id !== 'ui-designer');
    const after = computeLayout({ ...cafe(), roles: fired }, office(before).places);
    expect(office(after).freed.get('ui-designer')).toMatchObject({ x: desk.x, z: desk.z, person: null });
    for (const [person, d] of office(after).byPerson) expect(d).toMatchObject({ x: deskOf(before, person).x, z: deskOf(before, person).z });
    const back = computeLayout(cafe(), office(after).places);
    expect(deskOf(back, 'ui-designer')).toMatchObject({ x: desk.x, z: desk.z });
  });

  it('adds a new department at the end of the rooms, and a new games room at the end of the front strip', () => {
    const before = computeLayout(cafe());
    const o = office(before);
    const rooms = Math.max(...before.rooms.map((r) => r.x + r.w));
    const strip = Math.max(...[o.ceo, o.reception, ...(o.meeting ? [o.meeting] : []), ...o.rest].map((r) => r.x + r.w));
    const departments = [...DEPARTMENTS, { id: 'content', name: 'Content', style: 'content' as const }];
    const after = computeLayout(cafe([role('copywriter', 'content')], [...ROOMS, { id: 'games', title: 'Games room', kind: 'games' }], departments), o.places);
    const content = after.rooms.find((r) => r.id === 'content');
    const games = office(after).rest.find((r) => r.id === 'games');
    expect(content && content.x >= rooms).toBe(true);
    expect(games && games.x >= strip).toBe(true);
    for (const room of before.rooms) expect(after.rooms.find((r) => r.id === room.id)).toMatchObject({ x: room.x, z: room.z });
    for (const room of [o.ceo, o.reception, ...o.rest]) expect([office(after).ceo, office(after).reception, ...office(after).rest].find((r) => r.id === room.id)).toMatchObject({ x: room.x, z: room.z });
  });

  it('starts a second row of rooms behind the first after four', () => {
    const departments = [...DEPARTMENTS, { id: 'content', name: 'Content', style: 'content' as const }, { id: 'data', name: 'Data', style: 'data' as const }];
    const layout = computeLayout(cafe([role('copywriter', 'content'), role('analyst', 'data')], ROOMS, departments));
    const fronts = new Set(layout.rooms.map((r) => r.z + r.d));
    expect(fronts.size).toBe(2);
    expect(layout.rooms.filter((r) => r.z + r.d === 0)).toHaveLength(4);
    for (const desk of office(layout).byPerson.values()) expect(route(layout, desk.seat, office(layout).reception.frontDesk.places[0] as Point)).not.toBeNull();
  });
});
