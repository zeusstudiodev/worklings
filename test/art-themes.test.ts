import { describe, expect, it } from 'vitest';
import { HEX_COLOUR, MAX_DECOR, ROOM_KINDS, THEMES } from '../src/core/looks.ts';
import { ROLE_ID } from '../src/core/studio.ts';
import { ART_PACKS, BLOCK, blockColours, DESK_SET, decorOf, furnitureOf, PACK_ATLAS, packPieces, pieceOf, PIECES, pieceTitle, ROOM_FURNITURE, THEME_LOOKS, themeLook } from '../src/core/themes.ts';

const HIGHLIGHTER = '#F2D541';
const sentenceCase = (text: string) => /^[A-Z][^A-Z]*$/.test(text.replace(/CEO/g, 'Ceo'));

describe('the piece catalogue', () => {
  it('gives every piece a unique id studio.yaml accepts and a unique sentence-case title', () => {
    const ids = PIECES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(ROLE_ID.test(id), id).toBe(true);
    const titles = PIECES.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) expect(sentenceCase(title), title).toBe(true);
  });

  it('gives every piece a footprint and a place, and every pack piece a scale', () => {
    for (const piece of PIECES) {
      expect(piece.footprint.every((n) => n > 0 && n < 6), piece.id).toBe(true);
      expect(['floor', 'wall', 'surface']).toContain(piece.place);
      if (piece.draw.from === 'pack') {
        expect(ART_PACKS).toContain(piece.draw.pack);
        expect(piece.draw.scale).toBeGreaterThan(0);
      }
    }
  });

  it('draws each pack piece once, so one name in a pack is one piece', () => {
    const names = PIECES.flatMap((p) => (p.draw.from === 'pack' ? [`${p.draw.pack}/${p.draw.piece}`] : []));
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists the pack pieces the art build exports, sorted and without repeats', () => {
    for (const pack of ART_PACKS) {
      const names = packPieces(pack);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toEqual([...new Set(names)].sort());
    }
  });

  it('looks pieces up by id, and has no title for one the office can’t draw', () => {
    expect(pieceOf('arcade-cabinet')?.title).toBe('Arcade cabinet');
    expect(pieceTitle('water-cooler')).toBe('Water cooler');
    expect(pieceOf('dragon-hoard')).toBeUndefined();
    expect(pieceTitle('dragon-hoard')).toBeNull();
    expect(pieceTitle('__proto__')).toBeNull();
  });
});

describe('themes', () => {
  it('covers every theme the office can draw', () => {
    expect(Object.keys(THEME_LOOKS).sort()).toEqual([...THEMES].sort());
    for (const theme of THEMES) expect(themeLook(theme).id).toBe(theme);
  });

  it.each([...THEMES])('%s has a name, one sentence and palette colours, never the highlighter', (theme) => {
    const look = themeLook(theme);
    expect(sentenceCase(look.name), look.name).toBe(true);
    expect(look.sentence).toMatch(/^[A-Z].{20,140}\.$/);
    expect(look.sentence.split('. ')).toHaveLength(1);
    const colours = [look.floor.colour, look.floor.second, look.wall, look.accent];
    for (const colour of colours) {
      expect(HEX_COLOUR.test(colour), colour).toBe(true);
      expect(colour.toUpperCase()).not.toBe(HIGHLIGHTER);
    }
  });

  it.each([...THEMES])('%s has its own front desk, hero pieces by the door and decor from the catalogue', (theme) => {
    const look = themeLook(theme);
    expect(pieceOf(look.frontDesk)?.place).toBe('floor');
    expect(look.hero.length).toBeGreaterThan(0);
    for (const hero of look.hero) {
      expect(pieceOf(hero), hero).toBeDefined();
      expect(look.decor).toContain(hero);
    }
    expect(look.decor.every((id) => pieceOf(id) !== undefined), `unknown decor in ${theme}`).toBe(true);
    expect(new Set(look.decor).size).toBe(look.decor.length);
    expect(look.decor.length).toBeLessThanOrEqual(MAX_DECOR);
    expect(decorOf(theme).map((p) => p.id)).toEqual(look.decor);
  });

  it('gives every theme a different front desk', () => {
    const desks = THEMES.map((t) => themeLook(t).frontDesk);
    expect(new Set(desks).size).toBe(THEMES.length);
  });

  it.each([...THEMES])('%s swaps palette colours on real atlas blocks only', (theme) => {
    const { packs, pieces = {} } = themeLook(theme).recolour;
    for (const [pack, blocks] of Object.entries(packs)) {
      expect(ART_PACKS).toContain(pack);
      for (const [block, colour] of Object.entries(blocks ?? {})) {
        expect(BLOCK.test(block), block).toBe(true);
        expect(HEX_COLOUR.test(colour ?? ''), colour).toBe(true);
      }
    }
    for (const [id, blocks] of Object.entries(pieces)) {
      expect(pieceOf(id)?.draw.from, `${id} recoloured but not a pack piece`).toBe('pack');
      for (const block of Object.keys(blocks)) expect(BLOCK.test(block), block).toBe(true);
    }
  });

  it.each([...THEMES])('%s gives Restaurant Bits’ orange and teal its own colours, never the highlighter', (theme) => {
    // The orange block is the counters', chairs' and table's; the teal is the fridge's (the pack's own colours clash).
    const blocks = themeLook(theme).recolour.packs['restaurant-bits'] ?? {};
    for (const block of ['r3c6', 'r1c2'] as const) {
      expect(HEX_COLOUR.test(blocks[block] ?? ''), `${theme} ${block}`).toBe(true);
      expect(blocks[block]?.toUpperCase(), `${theme} ${block}`).not.toBe(HIGHLIGHTER);
    }
  });

  it('recolours a piece with its pack’s swap, its own colours winning', () => {
    expect(blockColours('office', 'cafe-chair')).toEqual({ r3c6: '#B98A5E', r1c2: '#F1EADC' });
    expect(blockColours('office', 'fridge')).toEqual({ r3c6: '#8FAE96', r1c2: '#F1EADC' });
    expect(blockColours('cafe', 'sofa')).toEqual({ r1c0: '#C98E6B', r1c2: '#7C9A8A' });
    expect(blockColours('arcade', 'fridge')).toEqual({ r3c6: '#6C5A9E', r1c2: '#4FA3B8' });
    expect(blockColours('arcade', 'cafe-chair')).toEqual({ r3c6: '#D65DB1', r1c2: '#4FA3B8' });
    expect(blockColours('office', 'water-cooler')).toEqual({});
    expect(blockColours('office', 'no-such-piece')).toEqual({});
  });
});

describe('packs', () => {
  it('names each atlas’s white block and fabric blocks inside its grid', () => {
    for (const pack of ART_PACKS) {
      const atlas = PACK_ATLAS[pack];
      for (const block of [atlas.white, ...atlas.fabric]) {
        expect(BLOCK.test(block), block).toBe(true);
        const [, row, col] = /^r(\d)c(\d)$/.exec(block) ?? [];
        expect(Number(row)).toBeLessThan(atlas.rows);
        expect(Number(col)).toBeLessThan(atlas.cols);
      }
    }
  });
});

describe('rooms', () => {
  it('furnishes every room kind from the catalogue', () => {
    expect(Object.keys(ROOM_FURNITURE).sort()).toEqual([...ROOM_KINDS].sort());
    for (const kind of ROOM_KINDS) {
      const room = ROOM_FURNITURE[kind];
      expect(room.kind).toBe(kind);
      expect(sentenceCase(room.title.replace(/'s\b/, 's')), room.title).toBe(true);
      expect(room.furniture.length).toBeGreaterThan(0);
      for (const { piece, count } of room.furniture) {
        expect(pieceOf(piece), `${kind}: ${piece}`).toBeDefined();
        expect(Number.isInteger(count) && count >= 1).toBe(true);
      }
      expect(new Set(room.furniture.map((f) => f.piece)).size).toBe(room.furniture.length);
    }
  });

  it('sets every desk in a department’s room with pieces from the catalogue', () => {
    expect(DESK_SET.length).toBeGreaterThan(0);
    for (const id of DESK_SET) expect(pieceOf(id)?.draw.from, id).toBe('made');
  });

  it('puts the theme’s front desk first in reception, and nowhere else', () => {
    for (const theme of THEMES) {
      const desk = themeLook(theme).frontDesk;
      expect(furnitureOf('reception', theme)[0]).toEqual({ piece: desk, count: 1 });
      expect(furnitureOf('meeting', theme).some((f) => f.piece === desk)).toBe(false);
    }
  });
});
