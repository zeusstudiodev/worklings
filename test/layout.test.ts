import { describe, expect, it } from 'vitest';
import { inferStudio } from '../src/core/infer.ts';
import type { Studio } from '../src/core/studio.ts';
import { computeLayout, type Rect } from '../web/src/scene/layout.ts';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const inside = (p: { x: number; z: number }, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d;

function studioWith(rooms: Record<string, string[]>, rules: Record<string, string[]> = {}): Studio {
  return {
    version: 1, name: 'T', domain: 'custom', rigor: 'lean',
    departments: Object.keys(rooms).map((id) => ({ id, name: id, style: 'engineering' as const })),
    roles: Object.entries(rooms).flatMap(([dept, ids]) => ids.map((id) => ({ id, department: dept, title: id }))),
    rules: Object.entries(rules).flatMap(([dept, ids]) => ids.map((id) => ({ id, department: dept, title: id }))),
    gates: [{ id: 'code-gate', title: 'Code gate', from: 'b', to: 'a' }, { id: 'a11y-gate', title: 'A11y gate', from: 'b', to: 'a' }],
    skills: [], fired: [],
  };
}

describe('computeLayout', () => {
  it('gives every role a desk inside its room, with no rooms overlapping', () => {
    const layout = computeLayout(studioWith({ a: ['a1'], b: ['b1', 'b2', 'b3', 'b4'], c: ['c1', 'c2'] }, { b: ['r1', 'r2', 'r3', 'r4', 'r5'] }));
    expect(layout.rooms).toHaveLength(3);
    for (const room of layout.rooms) {
      for (const desk of room.desks) expect(inside(desk, room)).toBe(true);
      for (const other of layout.rooms) if (other !== room) expect(overlaps(room, other)).toBe(false);
      expect(overlaps(room, layout.lobby)).toBe(false);
      expect(overlaps(room, layout.lead)).toBe(false);
    }
    expect([...layout.desks.keys()].sort()).toEqual(['a1', 'b1', 'b2', 'b3', 'b4', 'c1', 'c2']);
    const b = layout.rooms.find((r) => r.id === 'b');
    expect(b?.posters).toHaveLength(3);
    expect(b?.morePosters).toBe(2);
  });

  it('puts gates in front of the room they check, side by side', () => {
    const layout = computeLayout(studioWith({ a: ['a1'], b: ['b1'] }));
    const b = layout.rooms.find((r) => r.id === 'b');
    expect(layout.gates.map((g) => g.id)).toEqual(['code-gate', 'a11y-gate']);
    expect(layout.gates[0]?.x).not.toBe(layout.gates[1]?.x);
    for (const g of layout.gates) expect(g.z).toBeGreaterThan((b?.z ?? 0) + (b?.d ?? 0));
  });

  it('fits a 49-person studio and keeps everything inside the bounds', () => {
    const names = Array.from({ length: 49 }, (_, i) => ({ id: `agent-${i}`, description: i % 2 ? 'gameplay programmer' : 'level designer' }));
    const studio = inferStudio({ name: 'big', agents: names, rules: [], skills: [] }).studio;
    const layout = computeLayout(studio);
    expect(layout.desks.size).toBe(49);
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    for (const r of [...layout.rooms, layout.lobby, layout.lead]) {
      expect(r.x).toBeGreaterThanOrEqual(minX);
      expect(r.x + r.w).toBeLessThanOrEqual(maxX);
      expect(r.z).toBeGreaterThanOrEqual(minZ);
      expect(r.z + r.d).toBeLessThanOrEqual(maxZ);
    }
  });

  it('still lays out a lobby and an office for a project without a studio', () => {
    const layout = computeLayout(null);
    expect(layout.rooms).toEqual([]);
    expect(layout.lobby.w).toBeGreaterThan(5);
    expect(layout.lead.desk.x).toBeGreaterThan(layout.lobby.x);
  });
});
