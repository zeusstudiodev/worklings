// Colours of the model (see docs/design.md). Department hues double as wayfinding: floor tint, chairs, shirts.
import type { BaseDepartment } from '../../../src/core/departments.ts';

export const MAT = '#3E5B4E';
export const MAT_GRID = '#5E7D6F';
export const BASE_BOARD = '#ECE7DD';
export const BASE_EDGE = '#D6CFC2';
export const WALL = '#F3F0EA';
export const WALL_TOP = '#DCD5C8';
export const WOOD = '#C9A27C';
export const WOOD_DARK = '#9C7A58';
export const METAL = '#5D6661';
export const SCREEN_OFF = '#2E3833';
export const SCREEN_ON = '#BFF3E4';
export const PLANT = '#6F9E64';
export const PLANT_DARK = '#4E7A47';
export const POT = '#C7B9A6';
export const HIGHLIGHTER = '#F2D541';
export const INK = '#18241F';

export const DEPARTMENT_HUE: Record<BaseDepartment, string> = {
  direction: '#8E7CC3',
  design: '#E58FA0',
  art: '#E9A36B',
  engineering: '#5B8FC7',
  data: '#3FA5A0',
  quality: '#6FAE6A',
  security: '#D9625B',
  content: '#E2BF4F',
  ops: '#E07F3C',
};

/** Mixes a hex colour toward white: 0 keeps it, 1 is white. */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export const floorColor = (style: BaseDepartment) => tint(DEPARTMENT_HUE[style], 0.62);

const SKIN = ['#F2D3B8', '#E8B996', '#D19A73', '#A9714B', '#7B4E32', '#5A3826'];
const HAIR = ['#2B2420', '#4A3424', '#7A5232', '#B8854F', '#D9C27A', '#8B8F96', '#A8423A', '#1F2B3D'];

/** A stable small number from a string, so the same person always looks the same. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function looks(id: string) {
  const h = hash(id);
  return {
    skin: SKIN[h % SKIN.length] ?? '#E8B996',
    hair: HAIR[(h >> 3) % HAIR.length] ?? '#4A3424',
    hairStyle: (h >> 7) % 4, // 0 short, 1 bun, 2 long, 3 none
    phase: ((h >> 11) % 1000) / 1000,
  };
}
