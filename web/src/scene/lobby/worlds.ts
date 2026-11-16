// The lobby's small worlds (docs/game-feel.md, section 5) as plain numbers: where each company's world stands on the
// mat and keeps standing, how tall its building is, and which windows are lit. One window per person, up to 24, lit
// while they work; a figure with a yellow paper at the door when the company needs you; dark but for the door lamp
// while it rests on a usage limit. No three.js here, so the tests check it on its own.
import type { DeskState, LobbyCompany } from '../../../../src/core/company.ts';
import { dict, own } from '../../../../src/core/company-state.ts';
import type { Theme } from '../../../../src/core/looks.ts';

export const LOBBY = {
  /** A world's base board on the mat. */
  plot: { w: 9.2, d: 7.6 },
  /** Between the middles of neighbouring worlds. */
  spacing: { x: 12.5, z: 11 },
  /** Worlds in a row before the next row starts behind it. */
  columns: 3,
  maxWindows: 24,
  floorHeight: 1.3,
  /** The building on its plot, in the plot's own space: front at +z, the camera's side. */
  building: { x0: -3.4, x1: 2.2, z0: -2.7, z1: 0.9 },
  /** The door's middle along the front wall, on the ground floor. */
  doorX: -2.7,
} as const;

/** Window columns on each face: five along the front (the first is the door on the ground floor), four on the right. */
const FRONT = [0, 1, 2, 3, 4];
const RIGHT = [0, 1, 2, 3];
const PER_GROUND = FRONT.length - 1 + RIGHT.length;
const PER_FLOOR = FRONT.length + RIGHT.length;

/**
 * Each company's place on the mat, as slot numbers. A company keeps the slot it had; a new one takes the first slot no
 * company on the mat holds, so worlds never shuffle when one is added or removed.
 */
export function lobbySlots(ids: readonly string[], kept: Readonly<Record<string, number>>): Record<string, number> {
  const out = dict<number>();
  const taken = new Set<number>();
  for (const id of ids) {
    const slot = own(kept, id);
    if (slot !== undefined && Number.isInteger(slot) && slot >= 0 && !taken.has(slot)) {
      out[id] = slot;
      taken.add(slot);
    }
  }
  for (const id of ids) {
    if (Object.hasOwn(out, id)) continue;
    let slot = 0;
    while (taken.has(slot)) slot += 1;
    out[id] = slot;
    taken.add(slot);
  }
  return out;
}

/** The middle of a slot's plot on the mat: rows of three, the next row behind. */
export function slotPoint(slot: number): { x: number; z: number } {
  const col = slot % LOBBY.columns;
  const row = Math.floor(slot / LOBBY.columns);
  return { x: (col - (LOBBY.columns - 1) / 2) * LOBBY.spacing.x, z: row === 0 ? 0 : -row * LOBBY.spacing.z };
}

/** Floors for so many people: one up to eight, two up to seventeen, three for more. */
export function floorsFor(people: number): 1 | 2 | 3 {
  const n = Math.min(LOBBY.maxWindows, Math.max(0, people));
  return n <= PER_GROUND ? 1 : n <= PER_GROUND + PER_FLOOR ? 2 : 3;
}

export interface WindowPlace {
  /** In the plot's space: the window's middle on its wall. */
  x: number;
  y: number;
  z: number;
  face: 'front' | 'right';
}

/** Where a building's windows go, in the order people fill them: the ground floor first, the front before the side. */
export function windowPlaces(people: number): WindowPlace[] {
  const n = Math.min(LOBBY.maxWindows, Math.max(0, people));
  const { x0, x1, z0, z1 } = LOBBY.building;
  const out: WindowPlace[] = [];
  for (let floor = 0; out.length < n; floor++) {
    const y = floor * LOBBY.floorHeight + 0.74;
    for (const i of FRONT) {
      if (floor === 0 && i === 0) continue;
      out.push({ x: x0 + 0.7 + (i * (x1 - x0 - 1.4)) / (FRONT.length - 1), y, z: z1, face: 'front' });
    }
    for (const i of RIGHT) out.push({ x: x1, y, z: z0 + 0.62 + (i * (z1 - z0 - 1.24)) / (RIGHT.length - 1), face: 'right' });
  }
  return out.slice(0, n);
}

/** Desk states that mean someone is working right now. */
const AT_WORK: ReadonlySet<DeskState> = new Set(['working', 'starting', 'stopping']);

export interface WorldState {
  id: string;
  theme: Theme;
  floors: 1 | 2 | 3;
  /** One per person shown, lit while they work: never more than 24. */
  windows: boolean[];
  /** Someone needs the stakeholder: a figure with a yellow paper waits at the door. */
  waiting: boolean;
  /** Resting on a usage limit or an overload: dark but for the door lamp. */
  resting: boolean;
}

export function worldState(c: LobbyCompany): WorldState {
  const people = c.people.slice(0, LOBBY.maxWindows);
  const resting = c.pause?.reason === 'usage-limit' || c.pause?.reason === 'overloaded';
  return {
    id: c.id,
    theme: c.theme,
    floors: floorsFor(people.length),
    windows: people.map((p) => !resting && AT_WORK.has(p.state)),
    waiting: c.needsYou > 0,
    resting,
  };
}

/** The mat's extent the worlds cover, for the camera's fit. */
export function lobbyBounds(slots: readonly number[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const points = (slots.length ? slots : [0]).map(slotPoint);
  const { w, d } = LOBBY.plot;
  return {
    minX: Math.min(...points.map((p) => p.x)) - w / 2,
    maxX: Math.max(...points.map((p) => p.x)) + w / 2,
    minZ: Math.min(...points.map((p) => p.z)) - d / 2,
    maxZ: Math.max(...points.map((p) => p.z)) + d / 2,
  };
}
