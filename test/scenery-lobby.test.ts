// The lobby's small worlds (web/src/scene/lobby/): places that stay put, a window per person lit while they work, the
// figure at the door, rest, and each world within its triangle budget.
import { describe, expect, it } from 'vitest';
import type { DeskState, LobbyCompany } from '../src/core/company.ts';
import { demoLobby } from '../src/core/demo-company.ts';
import { THEMES } from '../src/core/looks.ts';
import { WorldView } from '../web/src/scene/lobby/view.ts';
import { doorFigure, worldParts } from '../web/src/scene/lobby/world.ts';
import { floorsFor, LOBBY, lobbyBounds, lobbySlots, slotPoint, windowPlaces, worldState } from '../web/src/scene/lobby/worlds.ts';
import { trianglesOf } from '../web/src/scene/office/merge.ts';

const NOW = Date.parse('2026-11-05T10:00:00Z');

function company(states: DeskState[], extra: Partial<LobbyCompany> = {}): LobbyCompany {
  const base = demoLobby(NOW).companies[0];
  if (!base) throw new Error('the demo lobby has no company');
  const look = base.people[0]?.look ?? {};
  return { ...base, people: states.map((state, i) => ({ id: `p${i}`, room: 'engineering', state, look })), needsYou: 0, pause: null, ...extra };
}

describe('places on the mat', () => {
  it('gives new companies the first free places, in order', () => {
    expect(lobbySlots(['a', 'b', 'c'], {})).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('keeps each company where it was when others come and go', () => {
    const first = lobbySlots(['a', 'b', 'c'], {});
    const later = lobbySlots(['c', 'd', 'a'], first);
    expect(later.a).toBe(0);
    expect(later.c).toBe(2);
    expect(later.d).toBe(1);
  });

  it('ignores kept places that can’t be right: negative, fractional, shared, or keys like __proto__', () => {
    const kept = JSON.parse('{"a": -1, "b": 1.5, "c": 3, "d": 3, "__proto__": 7}') as Record<string, number>;
    const slots = lobbySlots(['a', 'b', 'c', 'd', '__proto__'], kept);
    expect(slots.c).toBe(3);
    expect(new Set(Object.values(slots)).size).toBe(5);
    expect(Object.values(slots).every((s) => Number.isInteger(s) && s >= 0)).toBe(true);
    expect(Object.getPrototypeOf(slots)).toBeNull();
  });

  it('lays places out in rows of three, each row behind the last, and frames them all', () => {
    expect(slotPoint(0).z).toBe(0);
    expect(slotPoint(LOBBY.columns).z).toBeLessThan(0);
    expect(slotPoint(1).x).toBeGreaterThan(slotPoint(0).x);
    const bounds = lobbyBounds([0, 4]);
    expect(bounds.maxZ - bounds.minZ).toBeGreaterThan(LOBBY.spacing.z);
  });
});

describe('a world’s windows', () => {
  it('has a window per person, up to 24, the ground floor first, never where the door is', () => {
    expect(windowPlaces(0)).toEqual([]);
    expect(windowPlaces(5)).toHaveLength(5);
    expect(windowPlaces(40)).toHaveLength(24);
    const ground = windowPlaces(8);
    expect(ground.every((w) => w.y < LOBBY.floorHeight)).toBe(true);
    expect(ground.some((w) => w.face === 'front' && Math.abs(w.x - LOBBY.doorX) < 0.5)).toBe(false);
    expect(new Set(windowPlaces(24).map((w) => `${w.face}:${w.x.toFixed(2)}:${w.y.toFixed(2)}:${w.z.toFixed(2)}`)).size).toBe(24);
  });

  it('grows a floor at a time with its people, to three', () => {
    expect(floorsFor(1)).toBe(1);
    expect(floorsFor(8)).toBe(1);
    expect(floorsFor(9)).toBe(2);
    expect(floorsFor(24)).toBe(3);
    expect(floorsFor(60)).toBe(3);
    for (const n of [1, 8, 9, 17, 18, 24]) expect(Math.max(...windowPlaces(n).map((w) => w.y))).toBeLessThan(floorsFor(n) * LOBBY.floorHeight);
  });

  it('lights the windows of people at work and nobody else’s', () => {
    expect(worldState(company(['working', 'idle', 'starting', 'closed', 'waiting', 'stopping', 'failed', 'away'])).windows).toEqual([true, false, true, false, false, true, false, false]);
  });

  it('puts a figure at the door when the company needs you', () => {
    expect(worldState(company(['idle'])).waiting).toBe(false);
    expect(worldState(company(['idle'], { needsYou: 2 })).waiting).toBe(true);
  });

  it('goes dark while it rests on a usage limit or an overload, but not when you paused it', () => {
    const limit = { reason: 'usage-limit' as const, since: NOW, until: NOW + 3_600_000, message: 'Resting until 11:00.' };
    const rests = worldState(company(['working', 'working'], { pause: limit }));
    expect(rests.resting).toBe(true);
    expect(rests.windows).toEqual([false, false]);
    expect(worldState(company(['working'], { pause: { ...limit, reason: 'overloaded' } })).resting).toBe(true);
    expect(worldState(company(['idle'], { pause: { ...limit, reason: 'stakeholder', until: null } })).resting).toBe(false);
  });
});

describe('a world’s building', () => {
  it.each([...THEMES])('stays under 2,000 triangles in the %s theme, with 24 people and the figure at the door', (theme) => {
    const parts = worldParts(theme, 24);
    const figure = doorFigure();
    const windows = 24 * 2;
    expect(parts.triangles + trianglesOf(figure.solid) + (figure.glow ? trianglesOf(figure.glow) : 0) + windows).toBeLessThanOrEqual(2000);
    expect(parts.height).toBeGreaterThanOrEqual(3 * LOBBY.floorHeight);
  });

  it('opens on the way in: the roof lifts and the front walls drop to knee height, then closes again', () => {
    const view = new WorldView(worldParts('office', 12), 12, null);
    const roof = view.group.children[2];
    const front = view.group.children[1];
    view.open(1);
    expect(roof?.position.y).toBeGreaterThan(2);
    expect((front?.scale.y ?? 1) * view.height).toBeCloseTo(0.48, 5);
    view.open(0);
    expect(roof?.position.y).toBe(0);
    expect(front?.scale.y).toBe(1);
    view.dispose();
  });

  it('fades a window to its new light over a second, then is still', () => {
    const view = new WorldView(worldParts('office', 3), 3, null);
    view.setWindows([true, false, false], false, 0);
    expect(view.step(500)).toBe(true);
    expect(view.step(1000)).toBe(false);
    expect(view.step(1500)).toBe(false);
    // The same light again starts nothing.
    view.setWindows([true, false, false], false, 2000);
    expect(view.step(2100)).toBe(false);
    view.dispose();
  });
});
