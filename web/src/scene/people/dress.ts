// How a person looks: their body and the colours of each outfit role (web/src/scene/art/spec.ts's ROLES), from their
// look in studio.yaml, their room's hue and a stable hash, so the same person always looks the same. Pure.
import { LOOK_BODIES, type LookBody, type LookProp, SKIN_TONES } from '../../../../src/core/looks.ts';
import type { Look } from '../../../../src/core/studio.ts';
import { hash } from '../palette.ts';

export interface Outfit {
  skin: string;
  hair: string;
  top: string;
  topDark: string;
  trousers: string;
  shoes: string;
  accent: string;
}

export interface Dress {
  body: LookBody;
  outfit: Outfit;
  prop: LookProp;
  /** 0 to 1, stable per person: where their loops start, so a room never types or breathes in unison. */
  phase: number;
  /** Their own pace for loops, 0.9 to 1.14. */
  pace: number;
}

/** Skin tones, light to dark (looks.ts's SKIN_TONES), a touch warmer so they sit with KayKit's gradients. */
export const SKIN = ['#F6D2B4', '#EDB98F', '#D59A6E', '#B07548', '#84532F', '#5F3B24'] as const;
/** Weighted: dark browns and black most often, a few fair, grey and red heads. */
const HAIR = ['#2E2622', '#2E2622', '#2E2622', '#4D3626', '#4D3626', '#4D3626', '#7C5333', '#7C5333', '#B8854F', '#DCC07A', '#8E9298', '#A8473A'];
/** Trousers and shoes stay quiet, so the room's colour reads first. */
const TROUSERS = ['#3B4A5C', '#4A4440', '#2F3A36', '#5B5550', '#34405A'];
const SHOES = ['#3A2C25', '#2A2624', '#5A3E2E'];
const ACCENT = '#C9B98F';
/**
 * Staff bodies when the look names none. The barbarian is left to looks that ask for it: bare-chested in fur, he
 * reads as an adventurer more than anyone at a desk (the art proof's README).
 */
const STAFF: readonly LookBody[] = ['rogue', 'ranger', 'knight', 'mage'];

export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1).toUpperCase()}`;
}

export interface DressFor {
  /** A stable key: the role id, or the agent's for someone without one. */
  key: string;
  look: Look;
  /** Their room's hue (a department's, the CEO's gold, a contractor's grey). */
  hue: string;
  /** Sessions the company didn't start wear the mannequin, name sticker and all. */
  visitor: boolean;
}

export function dressFor({ key, look, hue, visitor }: DressFor): Dress {
  const h = hash(key);
  const body: LookBody = visitor ? 'mannequin' : look.body && LOOK_BODIES.includes(look.body) ? look.body : (STAFF[h % STAFF.length] ?? 'rogue');
  // A little spread within a room, so it isn't a uniform: a lighter, a deeper or the room's own colour.
  const base = look.color ?? hue;
  const spread = (h >>> 4) % 3;
  const top = look.color ? base.toUpperCase() : spread === 0 ? mixHex(base, '#FFFFFF', 0.14) : spread === 1 ? mixHex(base, '#2B2F3A', 0.08) : base.toUpperCase();
  const skin = look.skin !== undefined && Number.isInteger(look.skin) && look.skin >= 0 && look.skin < SKIN_TONES ? look.skin : h % SKIN.length;
  return {
    body,
    outfit: {
      skin: SKIN[skin] ?? SKIN[1],
      hair: look.hair?.toUpperCase() ?? HAIR[(h >>> 7) % HAIR.length] ?? '#2E2622',
      top,
      topDark: mixHex(top, '#000000', 0.26),
      trousers: TROUSERS[(h >>> 11) % TROUSERS.length] ?? '#3B4A5C',
      shoes: SHOES[(h >>> 13) % SHOES.length] ?? '#3A2C25',
      accent: ACCENT,
    },
    prop: look.prop ?? 'none',
    phase: ((h >>> 17) % 1000) / 1000,
    pace: 0.9 + ((h >>> 5) % 5) * 0.06,
  };
}
