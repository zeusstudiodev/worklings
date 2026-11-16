// What the office adds to a theme's look (src/core/themes.ts) to build with it: the hall's floor between the rooms, the
// walls' trims, and how much a department's hue tints a room's floor. Data and small lookups only.
import type { Theme } from '../../../../src/core/looks.ts';
import { type FloorPattern, THEME_LOOKS } from '../../../../src/core/themes.ts';
import { luminance, mixHex, shadeHex, tintHex } from './colour.ts';

/** A floor's pattern and its two colours; the hall may use a stone path the rooms don't. */
export type FloorKind = FloorPattern | 'flagstones';

export interface Floor {
  pattern: FloorKind;
  colour: string;
  second: string;
}

/** The hall: the floor between and around the rooms, quieter than the rooms' own. */
export const HALL_FLOORS: Readonly<Record<Theme, Floor>> = {
  office: { pattern: 'boards', colour: '#E6DED0', second: '#D6CBB8' },
  cafe: { pattern: 'boards', colour: '#DCC6A4', second: '#C9AE88' },
  'game-studio': { pattern: 'boards', colour: '#75645A', second: '#64544A' },
  shop: { pattern: 'oak', colour: '#E6D0AE', second: '#D4B994' },
  lab: { pattern: 'tiles', colour: '#E6EAE8', second: '#B4C6CC' },
  garden: { pattern: 'flagstones', colour: '#CFC2AF', second: '#AE9F8A' },
  city: { pattern: 'street', colour: '#A6A39C', second: '#8A867F' },
  arcade: { pattern: 'stars', colour: '#3B3452', second: '#5B4D8A' },
  'music-studio': { pattern: 'dark-wood', colour: '#5C4A3D', second: '#4B3B30' },
};

/** A floor's key, for the texture drawn for it and the bucket its rooms share. */
export const floorKey = (f: Floor): string => `${f.pattern}|${f.colour}|${f.second}`;

export function floorOf(theme: Theme): Floor {
  return THEME_LOOKS[theme].floor;
}

/** How a department's hue tints its room's floor: enough to find the room, not so much the theme's floor is lost. */
export function roomTint(hue: string, floorColour: string): string {
  return mixHex('#ffffff', hue, luminance(floorColour) > 0.35 ? 0.2 : 0.12);
}

export interface WallLook {
  wall: string;
  /** The lower part of a tall wall. */
  wainscot: string;
  /** The rail, the caps along the tops and the window frames' sills. */
  cap: string;
  skirting: string;
}

export function wallLook(theme: Theme): WallLook {
  const wall = THEME_LOOKS[theme].wall;
  const dark = luminance(wall) < 0.25;
  return {
    wall,
    wainscot: dark ? tintHex(wall, 0.08) : shadeHex(mixHex(wall, '#C9B79C', 0.25), 0.04),
    cap: dark ? tintHex(wall, 0.18) : shadeHex(wall, 0.12),
    skirting: dark ? shadeHex(wall, 0.3) : '#B8A58C',
  };
}

/** The base board the model stands on, like a cut sheet on a plinth (docs/design.md). */
export const BASE = { board: '#ECE7DD', edge: '#D6CFC2' } as const;
