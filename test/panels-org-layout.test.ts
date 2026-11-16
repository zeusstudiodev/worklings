import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { demoCompanies } from '../src/core/demo-company.ts';
import type { PersonView } from '../src/core/company.ts';
import type { Level } from '../src/core/studio.ts';
import {
  elbowPath,
  FIT_MARGIN,
  FIT_SLACK,
  FIT_TOP,
  floorZoom,
  formAt,
  type OrgLayout,
  orgLayout,
  type OrgMember,
  openingZoom,
  PITCH,
  relayRoute,
  stepZoom,
  YOU,
} from '../web/src/company/org/orgLayout.ts';
import { chartSentence, chipLabels, foldWords, membersOf, movedRoom, newRelays, nodeWords, relaySeen, startsFolded } from '../web/src/company/org/orgModel.ts';
import { callOf, doneLine, type PaletteCommand, paletteCommands } from '../web/src/company/palette/paletteModel.ts';
import { workOf } from '../web/src/company/people/peopleModel.ts';
import { company, desk, message, min, NOW, person, studio, task } from './panels-work-kit.ts';

const m = (id: string, level: Level, room: string, reportsTo: string | null): OrgMember => ({ id, level, room, reportsTo });

/**
 * An org of `n` people as the studios make them: the CEO, an office manager beside them, a head per room in turn, and
 * under engineering's head two team leads; everyone else a worker, dealt out to the heads and leads in turn.
 */
function orgOf(n: number): OrgMember[] {
  const rooms = ['engineering', 'data', 'design', 'quality', 'content', 'ops', 'security'];
  const out: OrgMember[] = [m('ceo', 'ceo', 'direction', null)];
  if (n === 1) return out;
  out.push(m('office-manager', 'worker', 'direction', 'ceo'));
  const heads = Math.min(rooms.length, Math.max(1, Math.floor((n - 2) / 5)));
  const managers: string[] = [];
  for (let i = 0; i < heads && out.length < n; i++) {
    out.push(m(`head-${rooms[i]}`, 'head', rooms[i]!, 'ceo'));
    managers.push(`head-${rooms[i]}`);
  }
  if (n >= 18 && out.length < n) {
    out.push(m('lead-a', 'lead', 'engineering', 'head-engineering'));
    managers.push('lead-a');
  }
  if (n >= 30 && out.length < n) {
    out.push(m('lead-b', 'lead', 'engineering', 'head-engineering'));
    managers.push('lead-b');
  }
  let i = 0;
  while (out.length < n) {
    const boss = managers[i % managers.length]!;
    const room = out.find((x) => x.id === boss)!.room;
    out.push(m(`w-${out.length}`, 'worker', room, boss));
    i += 1;
  }
  return out;
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether a straight segment passes through a node's box (its edge shrunk by a pixel, so touching doesn't count). */
function crosses(seg: [[number, number], [number, number]], n: { x: number; y: number; w: number; h: number }): boolean {
  const [[x1, y1], [x2, y2]] = seg;
  const box = { l: n.x + 1, r: n.x + n.w - 1, t: n.y + 1, b: n.y + n.h - 1 };
  if (x1 === x2) return x1 > box.l && x1 < box.r && Math.max(y1, y2) > box.t && Math.min(y1, y2) < box.b;
  if (y1 === y2) return y1 > box.t && y1 < box.b && Math.max(x1, x2) > box.l && Math.min(x1, x2) < box.r;
  return false;
}

function checkSound(layout: OrgLayout, people: readonly OrgMember[]) {
  // Everyone once, nobody on anyone else, every line clear of the nodes it doesn't join.
  expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(layout.nodes.length);
  expect(layout.nodes.map((n) => n.id).sort()).toEqual(people.map((p) => p.id).sort());
  for (const [i, a] of layout.nodes.entries()) for (const b of layout.nodes.slice(i + 1)) expect(overlaps(a, b), `${a.id} and ${b.id}`).toBe(false);
  for (const e of layout.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const seg: [[number, number], [number, number]] = [e.points[i - 1]!, e.points[i]!];
      for (const n of layout.nodes) if (n.id !== e.from && n.id !== e.to) expect(crosses(seg, n), `${e.from}->${e.to} through ${n.id}`).toBe(false);
    }
  }
  // Inside the world, from 0.
  for (const n of layout.nodes) {
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x + n.w).toBeLessThanOrEqual(layout.width);
    expect(n.y + n.h).toBeLessThanOrEqual(layout.height);
  }
  // Tree order: a manager before everyone under them; the levels follow.
  const at = new Map(layout.nodes.map((n, i) => [n.id, i]));
  for (const n of layout.nodes) {
    if (n.parent === null) continue;
    expect(at.get(n.parent)!).toBeLessThan(at.get(n.id)!);
    expect(n.level).toBe(layout.nodes[at.get(n.parent)!]!.level + 1);
    expect(n.posinset).toBeGreaterThanOrEqual(1);
    expect(n.posinset).toBeLessThanOrEqual(n.setsize);
  }
  // One line into everyone but the CEO, and one from You.
  expect(layout.edges.filter((e) => e.from !== YOU)).toHaveLength(layout.nodes.length - 1);
}

describe('the org chart layout', () => {
  it('puts the CEO alone under You', () => {
    const layout = orgLayout(orgOf(1), { zoom: 1 });
    checkSound(layout, orgOf(1));
    expect(layout.nodes).toHaveLength(1);
    const ceo = layout.nodes[0]!;
    expect(ceo).toMatchObject({ id: 'ceo', level: 1, parent: null, manages: false });
    expect(layout.you!.x).toBe(ceo.x + ceo.w / 2);
    expect(layout.you!.y + layout.you!.h).toBeLessThan(ceo.y);
    expect(layout.edges).toEqual([expect.objectContaining({ from: YOU, to: 'ceo' })]);
  });

  it.each([8, 18, 40, 60])('lays out %i people without overlaps or lines through nodes, at every form', (n) => {
    const people = orgOf(n);
    for (const zoom of [1, 0.9, 0.8, 0.6, 0.4]) checkSound(orgLayout(people, { zoom }), people);
  });

  it('puts the office manager beside the CEO on a dashed line and the heads in a row under the CEO, each under a sign', () => {
    const people = orgOf(18);
    const layout = orgLayout(people, { zoom: 1 });
    const node = (id: string) => layout.nodes.find((x) => x.id === id)!;
    const ceo = node('ceo');
    expect(node('office-manager')).toMatchObject({ y: ceo.y, dashed: true, level: 2 });
    expect(node('office-manager').x).toBeGreaterThan(ceo.x);
    const heads = layout.nodes.filter((x) => x.id.startsWith('head-'));
    expect(new Set(heads.map((h) => h.y)).size).toBe(1);
    expect(heads[0]!.y).toBeGreaterThan(ceo.y + ceo.h);
    expect(layout.signs.map((s) => s.room)).toEqual(['engineering', 'data', 'design']);
    // The CEO over the middle of the heads' row.
    const left = Math.min(...heads.map((h) => h.x));
    const right = Math.max(...heads.map((h) => h.x + h.w));
    expect(Math.abs(ceo.x + ceo.w / 2 - (left + right) / 2)).toBeLessThan(PITCH);
  });

  it('puts workers in a column under their manager and team leads side by side, so width grows with managers, not people', () => {
    const base = [m('ceo', 'ceo', 'direction', null), m('head', 'head', 'engineering', 'ceo'), m('w1', 'worker', 'engineering', 'head'), m('lead', 'lead', 'engineering', 'head'), m('k1', 'worker', 'engineering', 'lead')];
    const layout = orgLayout(base, { zoom: 1 });
    const node = (l: OrgLayout, id: string) => l.nodes.find((x) => x.id === id)!;
    expect(node(layout, 'w1').y).toBe(node(layout, 'lead').y);
    expect(node(layout, 'lead').x - node(layout, 'w1').x).toBe(PITCH);
    expect(node(layout, 'k1').x).toBe(node(layout, 'lead').x);
    // The keyboard's order: a column top to bottom, then the next.
    expect(layout.nodes.map((x) => x.id)).toEqual(['ceo', 'head', 'w1', 'lead', 'k1']);
    const more = orgLayout([...base, m('w2', 'worker', 'engineering', 'head'), m('w3', 'worker', 'engineering', 'head'), m('k2', 'worker', 'engineering', 'lead')], { zoom: 1 });
    expect(more.width).toBe(layout.width);
    expect(more.height).toBeGreaterThan(layout.height);
    const wider = orgLayout([...base, m('lead2', 'lead', 'engineering', 'head'), m('j1', 'worker', 'engineering', 'lead2')], { zoom: 1 });
    expect(wider.width).toBe(layout.width + PITCH);
  });

  it('hangs someone whose manager left under the CEO on a dashed line, with who it was', () => {
    const people = [m('ceo', 'ceo', 'direction', null), m('head', 'head', 'content', 'ceo'), m('kai', 'worker', 'content', 'lena')];
    const layout = orgLayout(people, { zoom: 1 });
    checkSound(layout, people);
    expect(layout.nodes.find((x) => x.id === 'kai')).toMatchObject({ parent: 'ceo', dashed: true, lost: 'lena', level: 2 });
    expect(layout.lost).toEqual([expect.objectContaining({ id: 'kai', manager: 'lena' })]);
    expect(layout.edges.find((e) => e.to === 'kai')!.dashed).toBe(true);
  });

  it('survives a loop in a broken org, placing everyone once', () => {
    const people = [m('ceo', 'ceo', 'direction', null), m('a', 'lead', 'design', 'b'), m('b', 'lead', 'design', 'a'), m('c', 'worker', 'design', 'a')];
    checkSound(orgLayout(people, { zoom: 1 }), people);
  });

  it('folds a manager: their reports leave the tree and a mark counts them', () => {
    const people = orgOf(18);
    const layout = orgLayout(people, { zoom: 1, folded: new Set(['head-engineering']) });
    const head = layout.nodes.find((x) => x.id === 'head-engineering')!;
    expect(head).toMatchObject({ manages: true, folded: true });
    expect(layout.nodes.some((x) => x.parent === 'head-engineering')).toBe(false);
    expect(layout.folds).toEqual([expect.objectContaining({ id: 'head-engineering', count: head.under })]);
    expect(head.under).toBe(people.filter((p) => p.room === 'engineering' && p.id !== 'head-engineering').length);
  });

  it('reserves the proposal’s places for someone new under each head and for a new room', () => {
    const people = orgOf(8);
    const layout = orgLayout(people, { zoom: 1, adds: true });
    expect(layout.adds.filter((a) => a.under !== null).map((a) => a.under)).toEqual(people.filter((p) => p.level === 'head').map((p) => p.id));
    expect(layout.adds.at(-1)).toMatchObject({ under: null });
    for (const a of layout.adds) for (const n of layout.nodes) expect(overlaps({ ...a, h: 40 }, n)).toBe(false);
  });

  it('changes form with the zoom instead of shrinking words: whole from 88%, compact from 75%, chips below', () => {
    expect([1, 0.88, 0.87, 0.75, 0.74, 0.4].map(formAt)).toEqual(['whole', 'whole', 'compact', 'compact', 'chip', 'chip']);
    const people = orgOf(18);
    const whole = orgLayout(people, { zoom: 1 }).nodes[0]!;
    expect([whole.w, whole.h]).toEqual([216, 76]);
    const narrow = orgLayout(people, { zoom: 0.88 }).nodes[0]!;
    expect(Math.round(narrow.w)).toBe(199);
    const chip = orgLayout(people, { zoom: 0.4 }).nodes[0]!;
    expect([chip.w, chip.h]).toEqual([88, 32]);
    // Above 100% the chart scales: it is laid out as at 100%.
    expect(orgLayout(people, { zoom: 1.5 }).width).toBe(orgLayout(people, { zoom: 1 }).width);
  });

  it('opens fitted to the width at 100% at most, down to the floor, else at the floor', () => {
    const people = orgOf(40);
    const widthAt = (zoom: number) => orgLayout(people, { zoom }).width;
    const sizeAt = (zoom: number) => ({ width: widthAt(zoom), height: orgLayout(people, { zoom }).height });
    expect(openingZoom(sizeAt, { width: 5000, height: 5000 }, 0.4)).toEqual({ zoom: 1, fits: true });
    const fitted = openingZoom(sizeAt, { width: 1100, height: 5000 }, 0.4);
    expect(fitted.fits).toBe(true);
    expect(fitted.zoom).toBeLessThan(1);
    expect(widthAt(fitted.zoom) + 40).toBeLessThanOrEqual(1100);
    expect(widthAt(fitted.zoom + 0.01) + 40).toBeGreaterThan(1100);
    expect(openingZoom(sizeAt, { width: 300, height: 5000 }, 0.4)).toEqual({ zoom: 0.4, fits: false });
  });

  it('lets whole nodes win when the free area is a little short (the static demo’s banner)', () => {
    const people = [m('ceo', 'ceo', 'lead', null), m('a', 'head', 'x', 'ceo'), m('b', 'head', 'y', 'ceo'), m('c', 'worker', 'x', 'a')];
    const sizeAt = (zoom: number) => ({ width: orgLayout(people, { zoom }).width, height: orgLayout(people, { zoom }).height });
    const need = sizeAt(1).height + FIT_TOP;
    expect(openingZoom(sizeAt, { width: 5000, height: need }, 0.4).zoom).toBe(1);
    expect(openingZoom(sizeAt, { width: 5000, height: need - 1 }, 0.4).zoom).toBe(1);
    expect(openingZoom(sizeAt, { width: 5000, height: need - FIT_SLACK - 1 }, 0.4).zoom).toBeLessThan(1);
  });

  it('sets the floor where every chip keeps its whole label, 40% at the least', () => {
    expect(floorZoom(30)).toBe(0.4);
    // A first name sets it, not the title's word that tells two Nils apart: Ledger's "Sabine" is about 44 px.
    expect(floorZoom(44)).toBe(0.44);
    // "Alexandra" at 12 px is about 58 px: 45 + 58 + 16 over 240.
    expect(floorZoom(58)).toBe(0.5);
    expect(stepZoom(0.9, 1, 0.4)).toBe(1);
    expect(stepZoom(1, 1, 0.4)).toBe(1.25);
    expect(stepZoom(1.5, 1, 0.4)).toBe(1.5);
    expect(stepZoom(0.45, -1, 0.4)).toBe(0.4);
  });

  // The free area the board gives the chart (view width, and view height less --dock-clear) in the sizes that matter:
  // 1440 x 900 with the side panel open and hidden, 1024 x 768 the same, and 768 x 1024 with it floating beside.
  const ROOMS = {
    '1440 with the side panel': { width: 1056, height: 641 },
    '1440 hidden': { width: 1440, height: 548 },
    '1024 with the side panel': { width: 680, height: 468 },
    '1024 hidden': { width: 1024, height: 509 },
    '768': { width: 444, height: 729 },
  } as const;
  const SABINE = 44;

  it.each(Object.entries(ROOMS))('opens the chart of 8, 18 and 40 people in the largest form that fits the free area: %s', (_name, room) => {
    for (const people of [orgOf(8), orgOf(18), orgOf(40)]) {
      const sizeAt = (zoom: number) => {
        const l = orgLayout(people, { zoom });
        return { width: l.width, height: l.height };
      };
      const floor = floorZoom(SABINE);
      const open = openingZoom(sizeAt, room, floor);
      const size = sizeAt(open.zoom);
      if (open.fits) {
        expect(size.width + 2 * FIT_MARGIN, `${people.length} people fit the width`).toBeLessThanOrEqual(room.width);
        expect(size.height + FIT_TOP, `${people.length} people fit the height, clear of the dock`).toBeLessThanOrEqual(room.height + FIT_SLACK);
        // The largest: one step up (still at most 100%) doesn't fit in one of the two.
        if (open.zoom < 1) {
          const up = sizeAt(open.zoom + 0.01);
          expect(up.width + 2 * FIT_MARGIN > room.width || up.height + FIT_TOP > room.height + FIT_SLACK).toBe(true);
        }
      } else expect(open.zoom).toBe(floor);
    }
  });

  it("opens Café Lumen's 18 whole at 1440 x 900 with the side panel open, clear of the dock", () => {
    const people = demoCompanies(Date.now()).find((c) => c.id === 'demo')!.people;
    expect(people).toHaveLength(18);
    const sizeAt = (zoom: number) => {
      const l = orgLayout(people, { zoom });
      return { width: l.width, height: l.height };
    };
    // 610 px tall in whole nodes, plus the 18 px of mat above, in the 641 px free area.
    expect(sizeAt(1).height + FIT_TOP).toBeLessThanOrEqual(ROOMS['1440 with the side panel'].height);
    expect(formAt(openingZoom(sizeAt, ROOMS['1440 with the side panel'], 0.4).zoom)).toBe('whole');
    // Where the free area is shorter (the side panel hidden brings the mini-map's clearance), compact nodes open, not cut ones.
    const shorter = openingZoom(sizeAt, ROOMS['1440 hidden'], 0.4);
    expect(shorter.fits).toBe(true);
    expect(formAt(shorter.zoom)).not.toBe('whole');
  });

  it('opens Ledger with all 40 in view at 1440 and falls back to the floor, centred on the CEO, only where even that is too wide', () => {
    const people = orgOf(40);
    const sizeAt = (zoom: number) => {
      const l = orgLayout(people, { zoom });
      return { width: l.width, height: l.height };
    };
    expect(openingZoom(sizeAt, { width: 1440, height: 548 }, floorZoom(SABINE)).fits).toBe(true);
    expect(openingZoom(sizeAt, ROOMS['768'], floorZoom(SABINE))).toEqual({ zoom: floorZoom(SABINE), fits: false });
  });

  it('routes a paper up to the shared manager and down to the receiver, and yours from You', () => {
    const people = [m('ceo', 'ceo', 'direction', null), m('head', 'head', 'engineering', 'ceo'), m('w1', 'worker', 'engineering', 'head'), m('lead', 'lead', 'engineering', 'head'), m('k1', 'worker', 'engineering', 'lead')];
    const layout = orgLayout(people, { zoom: 1 });
    expect(relayRoute(layout, 'k1', 'w1')!.hops).toBe(3);
    expect(relayRoute(layout, 'head', 'k1')!.hops).toBe(2);
    expect(relayRoute(layout, YOU, 'head')!.hops).toBe(2);
    expect(relayRoute(layout, 'ghost', 'head')).toBeNull();
    const route = relayRoute(layout, 'w1', 'k1')!;
    const w1 = layout.nodes.find((x) => x.id === 'w1')!;
    const k1 = layout.nodes.find((x) => x.id === 'k1')!;
    expect(route.points[0]).toEqual([w1.x, w1.y + w1.h / 2]);
    expect(route.points.at(-1)).toEqual([k1.x, k1.y + k1.h / 2]);
  });

  it('draws elbows with rounded corners', () => {
    expect(elbowPath([[0, 0], [0, 20], [40, 20]])).toBe('M0 0 L0 14 Q0 20 6 20 L40 20');
  });
});

describe('what the chart says', () => {
  it('says the state and the work on a node, and puts the ticking figures in its description', () => {
    const c = company({ tasks: [task('t-1', 'kai', 'Build the slot picker', { status: 'working' })] });
    const kai = person('kai', 'Kai', 'Frontend engineer', 'engineering', { desk: desk('working', { since: NOW - min(12) }), task: 't-1', model: 'sonnet', cost: 4.66 });
    const words = nodeWords({ ...c, people: [...c.people, kai] }, kai, NOW, () => 'Engineering');
    expect(words).toMatchObject({ chip: 'Working', kind: 'working', line: 'Build the slot picker, for 12 min', model: 'Sonnet', cost: '$4.66' });
    expect(words.label).toBe('Kai, frontend engineer, Engineering. Working: build the slot picker.');
    expect(words.description).toBe('For 12 min. Sonnet, $4.66. Shift+F10 for more.');
  });

  it('keeps every ticking duration out of a node’s name, so a screen reader does not re-read it as minutes pass', () => {
    const c = company();
    const kai = person('kai', 'Kai', 'Frontend engineer', 'engineering', { desk: desk('working', { since: NOW - min(12) }), model: 'sonnet', cost: 1 });
    const at = (later: number) => nodeWords({ ...c, people: [...c.people, kai] }, kai, NOW + later, () => 'Engineering');
    expect(at(0).label).toBe(at(min(5)).label);
    expect(at(0).label).not.toMatch(/\d+ min|\d{1,2}:\d{2}/);
    expect(at(0).description).toMatch(/^For 12 min\./);
    const stuck = person('sam', 'Sam', 'Backend engineer', 'engineering', { desk: desk('failed', { since: NOW - min(30) }) });
    const words = nodeWords({ ...c, people: [...c.people, stuck] }, stuck, NOW, () => 'Engineering');
    expect(words.kind).toBe('stuck');
    expect(words.chip).toBe('Stuck for 30 min');
    expect(words.label).not.toMatch(/\d+ min/);
    expect(words.description).toMatch(/^Stuck for 30 min\./);
  });

  it('says a paused task as Paused, with the task', () => {
    const c = company({ tasks: [task('t-2', 'kai', 'Cart summary', { status: 'queued', paused: { at: NOW - min(3), by: STAKEHOLDER } })] });
    const kai = person('kai', 'Kai', 'Frontend engineer', 'engineering', { desk: desk('idle', { since: NOW - min(5) }), task: 't-2' });
    const all = { ...c, people: [...c.people, kai] };
    expect(workOf(all, kai, NOW)).toMatchObject({ kind: 'paused', word: 'Paused' });
    expect(nodeWords(all, kai, NOW, () => 'Engineering')).toMatchObject({ chip: 'Paused', kind: 'paused', line: 'Cart summary' });
  });

  it('labels chips by first name, adding the title’s first word where two share one', () => {
    const labels = chipLabels([
      { id: 'a', name: 'Sam', title: 'QA engineer' },
      { id: 'b', name: 'Sam', title: 'SEO specialist' },
      { id: 'c', name: 'Kai', title: 'Frontend engineer' },
    ]);
    expect([...labels.values()]).toEqual(['Sam, QA', 'Sam, SEO', 'Kai']);
  });

  it('says what a folded manager holds, the people who need you first', () => {
    const c = company();
    const head = c.people.find((p) => p.id === 'head-of-engineering')!;
    const fold = foldWords(c, head, NOW);
    expect(fold.pill).toMatch(/^\+\d+$/);
    expect(fold.line).toMatch(/^\w+ more under Ben/);
  });

  it('says the board’s sentence and starts quiet rooms closed only over 25 people', () => {
    const c = company();
    expect(chartSentence(c, NOW)).toMatch(/^\w+ people in \w+ rooms\. Nobody at work\.$/);
    expect(startsFolded(c, NOW).size).toBe(0);
    const big = { ...c, people: [...c.people, ...Array.from({ length: 25 }, (_, i) => person(`w${i}`, `W${i}`, 'Worker', 'engineering', { reportsTo: 'head-of-engineering' }))] };
    expect(startsFolded(big, NOW).has('head-of-engineering')).toBe(true);
  });

  it('marks someone moved to another room without a new manager', () => {
    const c = company();
    const lead = c.people.find((p) => p.id === 'frontend-lead')!;
    expect(movedRoom(c, lead)).toBeNull();
    expect(movedRoom(c, { ...lead, room: 'design' })).toBe('design');
  });

  it('doesn’t mark someone in a room without a head of its own: that room is run from another by design', () => {
    const c = company();
    const lead = c.people.find((p) => p.id === 'frontend-lead')!;
    expect(c.people.some((p) => p.level === 'head' && p.room === 'quality')).toBe(false);
    expect(movedRoom(c, { ...lead, room: 'quality' })).toBeNull();
  });

  it('sends a paper for each new message between people, yours from You, and one to each head for all hands', () => {
    const c = company({ messages: [message('m-1', STAKEHOLDER, 'ceo', 'Hello')] });
    const seen = relaySeen(c);
    const next = {
      ...c,
      messages: [
        ...c.messages,
        message('m-2', 'ceo', 'head-of-engineering', 'Pickup orders first', { origin: STAKEHOLDER }),
        message('m-3', 'ghost', 'ceo', 'From nowhere'),
        message('m-4', STAKEHOLDER, 'head-of-engineering', 'All of you', { audience: { kind: 'everyone', id: null, title: 'everyone', group: 'g-1' } }),
        message('m-5', STAKEHOLDER, 'frontend-lead', 'All of you', { audience: { kind: 'everyone', id: null, title: 'everyone', group: 'g-1' } }),
      ],
    };
    const { relays, rings } = newRelays(next, seen);
    expect(relays[0]).toEqual({ key: 'm-2', from: 'ceo', to: 'head-of-engineering', yours: true });
    expect(relays.filter((r) => r.key.startsWith('m-4')).every((r) => r.from === YOU)).toBe(true);
    expect(relays.some((r) => r.key.startsWith('m-5') || r.key === 'm-3')).toBe(false);
    expect(rings).toHaveLength(c.people.length);
  });

  it('reads members from the people', () => {
    const p: PersonView = person('x', 'X', 'Worker', 'design', { reportsTo: 'ceo' });
    expect(membersOf([p])).toEqual([{ id: 'x', reportsTo: 'ceo', level: 'worker', room: 'design' }]);
  });
});

describe('hiring, firing, moving and rehiring from the palette and the talk bar', () => {
  const c = company();
  const snap = { studio: { ...studio, fired: [{ id: 'brand-designer', department: 'design', title: 'Brand designer', file: '.claude/agents/.fired/brand-designer.md', name: 'Pia' }] } };
  const find = (commands: PaletteCommand[], id: string) => commands.find((x) => x.id === id)!;

  it('asks the CEO to hire where there is no library, naming the room', () => {
    const hire = find(paletteCommands(snap, c, { steering: false }), 'hire');
    expect(hire.steps.map((s) => s.key)).toEqual(['room', 'text']);
    expect(callOf(hire.action, { room: 'design', text: 'A motion designer' })).toEqual({ on: 'actions', method: 'say', args: ['ceo', 'Please hire someone for Design: A motion designer', {}] });
  });

  it('hires a library role into a room, reporting to its head, or the CEO where it has none', () => {
    const library = [{ id: 'ui-designer', title: 'UI designer', department: 'design' as const, description: '', model: 'sonnet' }];
    const hire = find(paletteCommands(snap, c, { steering: false, library }), 'hire');
    expect(hire.steps.map((s) => s.key)).toEqual(['room', 'role']);
    expect(callOf(hire.action, { room: 'engineering', role: 'ui-designer' })).toEqual({ on: 'actions', method: 'reshape', args: [{ action: 'hire', role: 'ui-designer', department: 'engineering', reportsTo: 'head-of-engineering' }] });
    expect(callOf(hire.action, { room: 'design', role: 'ui-designer' })).toMatchObject({ args: [{ reportsTo: c.people.some((p) => p.level === 'head' && p.room === 'design') ? expect.any(String) : 'ceo' }] });
  });

  it('still offers to ask the CEO beside hiring from the library', () => {
    const library = [{ id: 'ui-designer', title: 'UI designer', department: 'design' as const, description: '', model: 'sonnet' }];
    const ask = find(paletteCommands(snap, c, { steering: false, library }), 'hire:ask');
    expect(ask.label).toBe('Ask the CEO to hire someone');
    expect(callOf(ask.action, { room: 'design', text: 'A motion designer' })).toEqual({ on: 'actions', method: 'say', args: ['ceo', 'Please hire someone for Design: A motion designer', {}] });
    expect(paletteCommands(snap, c, { steering: false }).some((x) => x.id === 'hire:ask')).toBe(false);
  });

  it('fires, moves and rehires through the reshape, and never offers to fire or move the CEO', () => {
    const commands = paletteCommands(snap, c, { steering: false });
    expect(commands.some((x) => x.id === 'fire:ceo' || x.id === 'move:ceo')).toBe(false);
    const fire = find(commands, 'fire:frontend-lead');
    expect(callOf(fire.action, {})).toEqual({ on: 'actions', method: 'reshape', args: [{ action: 'fire', role: 'frontend-lead' }] });
    expect(doneLine(snap, c, fire, {})).toMatch(/was fired\. Their work goes back to Ben\.$/);
    const move = find(commands, 'move:frontend-lead');
    expect(move.steps[0]).toMatchObject({ kind: 'choice', key: 'room' });
    expect(callOf(move.action, { room: 'design' })).toEqual({ on: 'actions', method: 'reshape', args: [{ action: 'move', role: 'frontend-lead', department: 'design' }] });
    expect(doneLine(snap, c, move, { room: 'design' })).toMatch(/moved to Design and still reports to Ben\.$/);
    const rehire = find(commands, 'rehire:brand-designer');
    expect(rehire.label).toBe('Rehire Pia');
    expect(callOf(rehire.action, {})).toEqual({ on: 'actions', method: 'reshape', args: [{ action: 'rehire', role: 'brand-designer' }] });
  });

  it('offers none of them before the start', () => {
    expect(paletteCommands(snap, { ...c, phase: 'proposed' }, { steering: false }).some((x) => ['hire', 'fire', 'move', 'rehire'].includes(x.action.kind))).toBe(false);
  });
});
