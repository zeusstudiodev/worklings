// Where a company's office puts things (web/src/scene/office/plan.ts): walls and their heights, every desk's set, the
// theme's front desk and hero pieces, studio.yaml's decor, windows, light and the label anchors, all from the floor
// plan the people walk on.
import { describe, expect, it } from 'vitest';
import { MAX_DECOR, THEMES, type Theme } from '../src/core/looks.ts';
import { blockColours, pieceOf, THEME_LOOKS } from '../src/core/themes.ts';
import { computeLayout, type Rect, wallRects } from '../web/src/scene/layout.ts';
import { DEPARTMENT_HUE } from '../web/src/scene/palette.ts';
import { chartOf, type OfficePlan, planOffice, wallSegments } from '../web/src/scene/office/plan.ts';
import { companyLayout } from './scenery-kit.ts';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 && a.z < b.z + b.d - 1e-6 && a.z + a.d > b.z + 1e-6;
const inside = (p: { x: number; z: number }, r: Rect) => p.x >= r.x - 1e-6 && p.x <= r.x + r.w + 1e-6 && p.z >= r.z - 1e-6 && p.z <= r.z + r.d + 1e-6;

/** A colour's hue in degrees and its lightness, 0 to 1. */
function hsl(hex: string): [number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const hue = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, (max + min) / 2];
}
const hueOf = (hex: string) => hsl(hex)[0];
const lightnessOf = (hex: string) => hsl(hex)[1];

function plan(theme: Theme = 'office', decor: readonly string[] = [], people = 25): OfficePlan {
  const p = planOffice(companyLayout(people), { theme, decor });
  if (!p) throw new Error('a company layout has an office plan');
  return p;
}

/** The floor a placed piece covers: its own size or the catalogue's footprint, turned and scaled as placed. */
function footprint(p: OfficePlan['pieces'][number]): Rect | null {
  const piece = pieceOf(p.id);
  if (!piece || piece.place !== 'floor') return null;
  const [w0, d0] = p.w !== undefined && p.d !== undefined ? [p.w, p.d] : piece.footprint;
  const [sx, , sz] = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
  const quarter = Math.abs(Math.sin(p.rot)) > 0.7;
  const w = (quarter ? d0 : w0) * (quarter ? sz : sx);
  const d = (quarter ? w0 : d0) * (quarter ? sx : sz);
  return { x: p.x - w / 2, z: p.z - d / 2, w, d };
}

describe('a company office plan', () => {
  it('has none for a v2 studio, which keeps the old model', () => {
    expect(planOffice(computeLayout(null), { theme: 'office', decor: [] })).toBeNull();
  });

  it('gives every desk of the floor plan its set, keyed by its person or as a free desk', () => {
    const layout = companyLayout(25);
    const p = plan();
    const desks = layout.office?.desks ?? [];
    expect(desks.length).toBeGreaterThanOrEqual(25);
    expect(p.desks).toHaveLength(desks.length);
    const keys = p.desks.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of desks) {
      const set = p.desks.find((x) => x.x === d.x && x.z === d.z);
      expect(set?.key).toBe(d.person ?? `free:${d.room}:${d.slot}`);
      expect(set?.tray).toEqual(d.tray);
    }
  });

  it('builds walls on exactly the footprint people walk around, doors left open', () => {
    const layout = companyLayout(25);
    const p = plan();
    const office = layout.office;
    if (!office) throw new Error('no office');
    const covered = (rects: readonly Rect[], x: number, z: number) => rects.some((r) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d);
    for (const room of [...layout.rooms, office.ceo, office.reception, ...(office.meeting ? [office.meeting] : []), ...office.rest]) {
      const walked = wallRects(room);
      const drawn = p.walls.filter((w) => w.room === room.id);
      // Sample the room's edges finely: a point is wall in one exactly when it is wall in the other.
      for (let x = room.x + 0.025; x < room.x + room.w; x += 0.05) {
        for (let z = room.z + 0.025; z < room.z + room.d; z += 0.05) {
          const edge = x < room.x + 0.25 || x > room.x + room.w - 0.25 || z < room.z + 0.25 || z > room.z + room.d - 0.25;
          if (edge) expect(covered(drawn, x, z), `${room.id} at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(covered(walked, x, z));
        }
      }
    }
  });

  it('cuts door gaps out of a wall and keeps the corners on the back and front walls', () => {
    const segments = wallSegments({ x: 0, z: 0, w: 10, d: 6 }, [{ side: 'front', at: 5, width: 2 }]);
    const front = segments.filter((s) => s.side === 'front').map((s) => s.rect);
    expect(front).toEqual([{ x: 0, z: 6 - 0.18, w: 4, d: 0.18 }, { x: 6, z: 6 - 0.18, w: 4, d: 0.18 }]);
    const left = segments.find((s) => s.side === 'left')?.rect;
    expect(left).toMatchObject({ x: 0, z: 0.18, w: 0.18 });
    expect(left?.d).toBeCloseTo(6 - 0.36, 9);
  });

  it('stands a back wall tall only where no room stands behind it, so nobody in the halls is hidden', () => {
    const p = plan();
    const rooms = new Map(p.rooms.map((r) => [r.id, r]));
    for (const w of p.walls.filter((x) => x.side === 'back')) {
      const room = rooms.get(w.room);
      if (!room) throw new Error(`no room ${w.room}`);
      const behind = p.rooms.some((o) => o !== room && o.z + o.d <= room.z + 0.01 && o.x < room.x + room.w && o.x + o.w > room.x);
      expect(w.kind, `${w.room} back wall`).toBe(behind ? 'low' : 'full');
    }
    for (const w of p.walls.filter((x) => x.side === 'front')) expect(w.kind, `${w.room} front wall`).toBe('knee');
    expect(p.walls.some((w) => w.kind === 'full')).toBe(true);
  });

  it('hangs windows of sky only on tall walls', () => {
    const p = plan();
    const windows = p.pieces.filter((x) => x.id === 'window');
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      const wall = p.walls.find((x) => x.kind === 'full' && (x.side === 'back' ? Math.abs(x.z + x.d - w.z) < 0.1 && w.x >= x.x && w.x <= x.x + x.w : Math.abs(x.x + x.w - w.x) < 0.1 && w.z >= x.z && w.z <= x.z + x.d));
      expect(wall, `window at ${w.x.toFixed(1)}, ${w.z.toFixed(1)}`).toBeDefined();
    }
  });

  it.each([3, 8, 25, 40])('opens no window behind a board hung on the back wall, %i people', (people) => {
    const p = plan('office', [], people);
    const hung = p.pieces.filter((x) => ['org-board', 'milestone-board', 'meeting-screen'].includes(x.id) && x.stand === null);
    // A small company's CEO's office has a tall back wall, so its org board hangs there with a window's room beside it.
    if (people <= 8) expect(hung.map((b) => b.id)).toContain('org-board');
    const windows = p.pieces.filter((x) => x.id === 'window' && Math.abs(Math.sin(x.rot)) < 0.5);
    for (const b of hung) {
      for (const w of windows.filter((x) => x.room === b.room && Math.abs(x.z - b.z) < 0.3)) {
        const apart = Math.abs(w.x - b.x) - ((w.w ?? 0) + (b.w ?? 0)) / 2;
        expect(apart, `${b.id} and the window at ${w.x.toFixed(2)} in ${b.room}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it.each([...THEMES])('puts the %s front desk on the floor plan’s counter with its lamp', (theme) => {
    const layout = companyLayout(25);
    const p = plan(theme);
    const { counter, lamp } = layout.office?.reception.frontDesk ?? { counter: null, lamp: null };
    if (!counter || !lamp) throw new Error('no front desk');
    const desk = p.pieces.find((x) => x.id === THEME_LOOKS[theme].frontDesk);
    expect(desk).toMatchObject({ x: counter.x + counter.w / 2, z: counter.z + counter.d / 2, w: counter.w, d: counter.d, rot: 0 });
    expect(p.pieces.find((x) => x.id === 'front-lamp')).toMatchObject({ x: lamp.x, z: lamp.z });
  });

  it.each([...THEMES])('stands the %s theme’s main hero piece in reception', (theme) => {
    const layout = companyLayout(25);
    const p = plan(theme);
    const reception = layout.office?.reception;
    if (!reception) throw new Error('no reception');
    const [hero] = THEME_LOOKS[theme].hero;
    const placed = p.pieces.find((x) => x.id === hero);
    expect(placed, `${hero}`).toBeDefined();
    if (pieceOf(hero ?? '')?.place === 'floor' && placed) expect(inside(placed, reception), `${hero} in reception`).toBe(true);
  });

  it('places the decor the catalogue has and skips ids it doesn’t, without doubling a hero already there', () => {
    const p = plan('cafe', ['chalkboard-menu', 'pastry-case', 'espresso-machine', 'plant', 'plant', 'coat-rack', 'bistro-table', 'leafy-plant']);
    expect(p.skipped).toEqual(['espresso-machine', 'plant', 'plant', 'bistro-table']);
    expect(p.pieces.filter((x) => x.id === 'chalkboard-menu')).toHaveLength(1);
    expect(p.pieces.filter((x) => x.id === 'pastry-case')).toHaveLength(1);
    expect(p.pieces.filter((x) => x.id === 'coat-rack')).toHaveLength(1);
  });

  it('reads no more decor than the office holds', () => {
    const many = Array.from({ length: MAX_DECOR + 10 }, () => 'not-a-piece');
    expect(plan('office', many).skipped).toHaveLength(MAX_DECOR);
  });

  it('keeps every piece on the floor inside its room and off desks, chairs, seats, places in line and doorways', () => {
    const layout = companyLayout(25);
    const office = layout.office;
    if (!office) throw new Error('no office');
    const p = plan('office', ['leafy-plant', 'leafy-plant', 'water-cooler', 'kanban-board', 'printer', 'cactus', 'armchair', 'standing-lamp']);
    const rooms = new Map(p.rooms.map((r) => [r.id, r]));
    const keepClear: Rect[] = [
      ...office.desks.map((d) => ({ x: d.x - d.w / 2, z: d.seat.z - 0.4, w: d.w, d: d.z + d.d / 2 - d.seat.z + 0.4 })),
      ...office.reception.frontDesk.places.map((s) => ({ x: s.x - 0.3, z: s.z - 0.3, w: 0.6, d: 0.6 })),
      ...(office.meeting ? [office.meeting.head, ...office.meeting.spots].map((s) => ({ x: s.x - 0.3, z: s.z - 0.3, w: 0.6, d: 0.6 })) : []),
      ...office.reception.seats.map((s) => ({ x: s.x - 0.3, z: s.z - 0.3, w: 0.6, d: 0.6 })),
    ];
    const designed = new Set(['sofa', 'visitor-chair', 'chair', 'side-table', 'rug', 'striped-rug', 'oval-rug', 'cafe-chair', 'cafe-table', 'armchair', 'stool', 'coffee-table', 'kitchen-counter', 'kitchen-sink', 'fridge']);
    for (const piece of p.pieces) {
      const rect = footprint(piece);
      if (!rect || !piece.room) continue;
      const room = rooms.get(piece.room);
      if (!room) throw new Error(`no room ${piece.room}`);
      expect(rect.x >= room.x - 0.05 && rect.x + rect.w <= room.x + room.w + 0.05 && rect.z >= room.z - 0.05 && rect.z + rect.d <= room.z + room.d + 0.05, `${piece.id} in ${piece.room}`).toBe(true);
      // Seats and rugs are drawn where people sit; everything else stays out of the way.
      if (designed.has(piece.id)) continue;
      for (const clear of keepClear) expect(overlaps(rect, clear), `${piece.id} at ${piece.x.toFixed(1)}, ${piece.z.toFixed(1)}`).toBe(false);
    }
  });

  it('furnishes a games room in its own theme while the rest keeps the office’s', () => {
    const layout = companyLayout(25, [{ id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' }]);
    const p = planOffice(layout, { theme: 'cafe', decor: [] });
    if (!p) throw new Error('no plan');
    const games = p.floors.find((f) => f.room === 'games');
    expect(games?.floor).toEqual(THEME_LOOKS.arcade.floor);
    const reception = p.floors.find((f) => f.room === layout.office?.reception.id);
    expect(reception?.floor).toEqual(THEME_LOOKS.cafe.floor);
    expect(p.pieces.filter((x) => x.room === 'games' && x.id === 'arcade-cabinet').length).toBeGreaterThanOrEqual(2);
  });

  it('gives each department’s rug its hue, lightened, and other rooms the theme’s colours', () => {
    const layout = companyLayout(25);
    const p = plan('office');
    const rug = p.pieces.find((x) => x.id === 'rug' && x.room === 'engineering')?.colours?.r1c0;
    if (!rug) throw new Error('engineering has no rug');
    expect(Math.abs(hueOf(rug) - hueOf(DEPARTMENT_HUE.engineering))).toBeLessThan(4);
    expect(lightnessOf(rug)).toBeGreaterThan(lightnessOf(DEPARTMENT_HUE.engineering));
    const sofa = p.pieces.find((x) => x.id === 'sofa' && x.room === layout.office?.reception.id);
    expect(sofa?.colours?.r1c0).toBe(THEME_LOOKS.office.recolour.packs['furniture-bits']?.r1c0);
  });

  // Every theme now gives Restaurant Bits its own kitchen colours (themes.ts); the calmed stand-in only fills blocks the
  // catalogue leaves out.
  it("dresses Restaurant Bits in each theme's own kitchen colours from the catalogue", () => {
    const fridge = (p: OfficePlan | null) => p?.pieces.find((x) => x.id === 'fridge')?.colours;
    for (const theme of ['garden', 'office'] as const) {
      expect(fridge(planOffice(companyLayout(25), { theme, decor: [] }))).toMatchObject(blockColours(theme, 'fridge'));
    }
    expect(fridge(planOffice(companyLayout(25), { theme: 'office', decor: [] }))).toMatchObject({ r1c2: '#F1EADC', r3c6: '#8FAE96' });
  });

  it('lights each desk with its screen while its person works, and the front desk always', () => {
    const p = plan();
    for (const d of p.desks) expect(p.lights.filter((l) => l.desk === d.key && l.part === 'screen').length).toBeGreaterThanOrEqual(1);
    expect(p.lights.filter((l) => l.desk === null && l.halo).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps every light pool on a pastel floor at 0.15 or below', () => {
    for (const l of plan().lights) if (!l.halo) expect(l.strength, `pool at ${l.x.toFixed(1)}, ${l.z.toFixed(1)}`).toBeLessThanOrEqual(0.15);
  });

  it('anchors a sign over every room, the old lobby and lead names, and the screen’s four corners', () => {
    const layout = companyLayout(25);
    const p = plan();
    const ids = new Set(p.anchors.map((a) => a.id));
    for (const r of p.rooms) expect(ids.has(`room:${r.id}`), r.id).toBe(true);
    for (const id of ['room:lobby', 'room:lead', 'screen:top-left', 'screen:top-right', 'screen:bottom-right', 'screen:bottom-left']) expect(ids.has(id), id).toBe(true);
    for (const room of layout.rooms) for (const poster of room.posters) expect(ids.has(`poster:${poster.ruleId}`)).toBe(true);
  });

  it('draws the org on the CEO’s board: a room per department, a card for each head, a pin per person', () => {
    const layout = companyLayout(25);
    const chart = chartOf(layout);
    expect(chart.rooms).toHaveLength(layout.rooms.length);
    const people = (layout.office?.desks ?? []).filter((d) => d.person !== null && layout.rooms.some((r) => r.id === d.room)).length;
    expect(chart.rooms.reduce((s, r) => s + r.people + (r.head ? 1 : 0), 0)).toBe(people);
  });

  it('plans the same office twice from the same floor plan', () => {
    expect(plan('lab', ['server-rack', 'leafy-plant'])).toEqual(plan('lab', ['server-rack', 'leafy-plant']));
  });
});
