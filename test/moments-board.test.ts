// The CEO's board while a company is founding (docs/game-feel.md, section 6): the CEO sketches the org a box at a time,
// a draft the office turns down wipes the board, a turn that ends without a proposal rests the pen while the CEO turns
// to you, and the proposal puts the whole chart up (the CEO, a box per room, a mark per person). Reduced motion keeps
// the same board, still; once the company starts, the board pins its people.
import { defaultSettings } from '../src/core/company-state.ts';
import { describe, expect, it } from 'vitest';
import { type CompanyView, type DeskView, type PersonView, STAKEHOLDER } from '../src/core/company.ts';
import { demoSnapshot, studioOf } from '../src/core/demo-company.ts';
import type { OrgProposal } from '../src/core/org.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import type { Level } from '../src/core/studio.ts';
import { type Cast, type CastMember, castFrom, type CastOptions, SeenLog } from '../web/src/scene/cast.ts';
import { computeLayout, type Layout, type Point } from '../web/src/scene/layout.ts';
import { BOARD_BOX_MS, BOARD_BOXES } from '../web/src/scene/moments.ts';
import { planOffice } from '../web/src/scene/office/plan.ts';

const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);
/** A board's face, the front of its sheet, this far out from where the scenery puts the board (props.ts). */
const SHEET = 0.1;
const at = (s: number) => T0 + Math.round(s * 1000);

function person(id: string, level: Level, room: string, desk: Partial<DeskView> = {}): PersonView {
  return {
    id, name: id, title: id, level, room, reportsTo: level === 'ceo' ? null : 'ceo', look: {}, model: 'sonnet', task: null, status: null, agentKey: null, cost: 0,
    desk: { person: id, state: 'working', sessionId: `s-${id}`, since: at(0), context: 0.1, problem: null, queue: null, ...desk },
  };
}

/** A company the CEO is founding: the CEO alone, drafting since 0 s. */
function founding(): CompanyView {
  return {
    id: 'lumen', name: 'Café Lumen', phase: 'founding', prompt: 'A café website', stakeholder: 'Alex', branch: null, theme: 'cafe',
    rooms: [{ id: 'reception', title: 'Reception', kind: 'reception' }, { id: 'ceo-office', title: "CEO's office", kind: 'ceo' }, { id: 'meeting', title: 'Meeting room', kind: 'meeting' }],
    goal: null, people: [person('ceo', 'ceo', 'direction')], proposal: null, tasks: [], messages: [], questions: [], approvals: [], statuses: [], reports: [], dashboards: [],
    screenshots: [], spend: { samples: [], hourly: [], byPerson: [] }, log: [{ at: at(0), kind: 'founded', by: STAKEHOLDER, text: 'You started Café Lumen.' }], pause: null,
    settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [] }, desks: { working: 1, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: null, problem: null }, inbox: 0, seen: {}, proposalEdited: false, problem: null,
    drafting: { refused: 0, firstRefusal: null, stopped: null },
  };
}

const proposed = (who: string, level: Level, room: string) => ({ id: who, name: who, title: who, level, room, reportsTo: level === 'ceo' ? null : 'ceo', model: 'sonnet' as const, owns: `The ${who} work.` });
const PROPOSAL: OrgProposal = {
  company: 'Café Lumen', goal: 'Pickup orders', theme: 'cafe',
  rooms: [{ id: 'direction', title: 'Direction', style: 'direction' }, { id: 'design', title: 'Design', style: 'design' }, { id: 'engineering', title: 'Engineering', style: 'engineering' }],
  people: [
    proposed('ceo', 'ceo', 'direction'), proposed('product-manager', 'worker', 'direction'),
    proposed('head-of-design', 'head', 'design'), proposed('ui-designer', 'worker', 'design'),
    proposed('head-of-engineering', 'head', 'engineering'), proposed('frontend-engineer', 'worker', 'engineering'), proposed('backend-engineer', 'worker', 'engineering'),
  ],
  questions: [],
};

/** An office watched from `t` seconds, each snapshot noted as it arrives. */
class Office {
  view: CompanyView;
  layout: Layout;
  snapshot: Snapshot;
  readonly seen = new SeenLog();

  constructor(view: CompanyView, t: number) {
    this.view = structuredClone(view);
    this.layout = computeLayout(studioOf(this.view));
    this.snapshot = demoSnapshot(this.view, 'C:\\lumen', at(t));
    this.seen.note(this.snapshot, this.layout);
  }

  show(t: number, change: (view: CompanyView) => void = () => {}): this {
    const next = structuredClone(this.view);
    change(next);
    this.view = next;
    this.layout = computeLayout(studioOf(next), this.layout.office?.places ?? null);
    this.snapshot = demoSnapshot(next, 'C:\\lumen', at(t));
    this.seen.note(this.snapshot, this.layout);
    return this;
  }

  cast(t: number, options: CastOptions = {}): Cast {
    return castFrom(this.snapshot, this.layout, { now: at(t), seen: this.seen, ...options });
  }

  get board() {
    const board = this.layout.office?.ceo.board;
    if (!board) throw new Error('A CEO board');
    return board;
  }
}

const ceoOf = (cast: Cast): CastMember => {
  const found = cast.members.find((m) => m.person === 'ceo');
  if (!found) throw new Error('No CEO');
  return found;
};
const boxes = (cast: Cast) => cast.props?.boxes ?? [];
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;

describe("the CEO's board while founding", () => {
  it('fills in a box at a time while the CEO draws at it', () => {
    const office = new Office(founding(), 1);
    expect(boxes(office.cast(3 * BOARD_BOX_MS / 1000 + 0.1))).toHaveLength(3);
    const drawing = office.cast(20);
    expect(ceoOf(drawing).body.pose).toBe('interact');
    expect(boxes(drawing).map((b) => b.since)).toEqual([1, 2, 3, 4, 5, 6].map((k) => at(0) + k * BOARD_BOX_MS));
    expect(drawing.nextChangeAt).toBe(at(0) + 7 * BOARD_BOX_MS);
    expect(boxes(office.cast(60))).toHaveLength(BOARD_BOXES);
  });

  it('wipes the board when the office turns a draft down, and draws again from there', () => {
    const office = new Office(founding(), 1).show(10, (v) => {
      v.drafting = { refused: 1, firstRefusal: 'people[3].reportsTo: "cto" is not in the proposal', stopped: null };
    });
    expect(boxes(office.cast(10))).toEqual([]);
    expect(ceoOf(office.cast(10)).body.pose).toBe('interact');
    expect(boxes(office.cast(10 + (2 * BOARD_BOX_MS) / 1000 + 0.1)).map((b) => b.since)).toEqual([at(10) + BOARD_BOX_MS, at(10) + 2 * BOARD_BOX_MS]);
  });

  it('replays no wipe for a draft turned down before the office opened', () => {
    const view = founding();
    view.drafting = { refused: 2, firstRefusal: 'Too few people', stopped: null };
    expect(boxes(new Office(view, 20).cast(20))).toHaveLength(6);
  });

  it('rests the pen while the CEO waits for you, turned to you with their words, and draws on once you write', () => {
    const office = new Office(founding(), 1).show(10, (v) => {
      v.drafting = { refused: 0, firstRefusal: null, stopped: { at: at(10), words: 'Should the site be in German only? I can draft both ways.' } };
      const ceo = v.people[0];
      if (ceo) ceo.desk = { ...ceo.desk, state: 'idle', since: at(10) };
    });
    const waiting = office.cast(30);
    expect(boxes(waiting)).toHaveLength(3);
    expect(waiting.nextChangeAt).toBeNull();
    const mara = ceoOf(waiting);
    expect(mara.body.pose).toBe('stand');
    expect(mara.facing).toBe(0);
    expect(near(mara, office.layout.office?.ceo.boardSpot as Point)).toBe(true);
    expect(mara.bubble).toEqual({ tone: 'question', lead: null, text: 'Should the site be in German…', dot: null });
    // Your reply reached the CEO at 30 s: the drawing carries on where it stopped, 10 s in, so the fourth box (due at
    // 12 s of drawing) comes 2 s later.
    office.show(30, (v) => {
      v.drafting = { refused: 0, firstRefusal: null, stopped: null };
      const ceo = v.people[0];
      if (ceo) ceo.desk = { ...ceo.desk, state: 'working', since: at(30) };
    });
    const again = office.cast(30 + BOARD_BOX_MS / 1000 + 0.1);
    expect(boxes(again)).toHaveLength(4);
    expect(boxes(again)[3]?.since).toBe(at(30) + 4 * BOARD_BOX_MS - 10_000);
    expect(ceoOf(again).body.pose).toBe('interact');
    expect(ceoOf(again).facing).toBe(office.layout.office?.ceo.boardSpot.facing);
    expect(ceoOf(again).bubble?.tone).not.toBe('question');
  });

  it('puts the whole chart up when the proposal arrives: the CEO, a box per room, a mark per person, all on the board', () => {
    const office = new Office(founding(), 1).show(14, (v) => {
      v.phase = 'proposed';
      v.proposal = PROPOSAL;
      v.drafting = null;
      v.log.push({ at: at(14), kind: 'proposal', by: 'ceo', text: 'The CEO proposed an org.' });
    });
    const chart = boxes(office.cast(14.2));
    expect(chart).toHaveLength(1 + 3 + 6);
    for (const b of chart) {
      expect(b.since).toBe(at(14));
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(office.board.x - office.board.w / 2);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(office.board.x + office.board.w / 2);
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(office.board.y);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(office.board.y + office.board.h);
    }
    for (const [i, a] of chart.entries()) {
      for (const b of chart.slice(i + 1)) {
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart).toBe(true);
      }
    }
    // The CEO at the top, rooms in a row below, people below their room.
    const [top, ...rest] = [...chart].sort((a, b) => b.y - a.y);
    expect(rest.every((b) => b.y < (top?.y ?? 0))).toBe(true);
    // And the CEO goes to you with it.
    expect(ceoOf(office.cast(14.2)).walk.length).toBeGreaterThan(0);
  });

  it('draws from the end of the board, so the default camera sees every box past the CEO', () => {
    // Stage.tsx's VIEW, the camera looking from the front right; the CEO a body about 0.9 wide and 2.3 tall.
    const view = { x: 1, y: 1.18, z: 1 };
    const office = new Office(founding(), 1).show(14, (v) => {
      v.phase = 'proposed';
      v.proposal = PROPOSAL;
      v.drafting = null;
      v.log.push({ at: at(14), kind: 'proposal', by: 'ceo', text: 'The CEO proposed an org.' });
    });
    const spot = office.layout.office?.ceo.boardSpot as Point;
    const hidden = (b: { x: number; y: number; z: number }) => {
      // Along the ray toward the camera, the point nearest the CEO's middle across the floor, and how high the ray is there.
      const t = (spot.x - b.x + (spot.z - b.z)) / (view.x + view.z);
      const across = Math.hypot(b.x + t * view.x - spot.x, b.z + t * view.z - spot.z);
      const height = b.y + t * view.y;
      return t > 0 && across < 0.45 && height >= 0 && height <= 2.3;
    };
    const drawn = [...boxes(new Office(founding(), 1).cast(30)), ...boxes(office.cast(14.5))];
    expect(drawn.length).toBeGreaterThan(BOARD_BOXES);
    for (const b of drawn) for (const dx of [-0.5, 0, 0.5]) for (const dy of [-0.5, 0, 0.5]) expect(hidden({ x: b.x + dx * b.w, y: b.y + dy * b.h, z: b.z })).toBe(false);
  });

  it("draws on the face of the board the scenery hangs on the CEO's tall back wall, not out where one on legs stands", () => {
    const office = new Office(founding(), 1);
    const board = planOffice(office.layout, { theme: 'cafe', decor: [] })?.pieces.find((p) => p.id === 'org-board');
    // The CEO alone: nothing stands behind their office, so its back wall is tall and the board hangs on it.
    expect(board?.stand).toBeNull();
    const drawn = [...boxes(office.cast(30)), ...boxes(office.show(31, (v) => {
      v.phase = 'proposed';
      v.proposal = PROPOSAL;
      v.drafting = null;
    }).cast(31.5))];
    expect(drawn.length).toBeGreaterThan(BOARD_BOXES);
    for (const b of drawn) expect(b.z).toBeCloseTo((board?.z ?? Number.NaN) + SHEET, 6);
  });

  it('keeps the same board with reduced motion, nobody walking to it', () => {
    const office = new Office(founding(), 1);
    const still = office.cast(20, { reducedMotion: true });
    expect(boxes(still)).toEqual(boxes(office.cast(20)));
    expect(ceoOf(still).walk).toEqual([]);
    expect(still.tier).toBe('still');
  });

  it('pins its people once the company starts, the sketch gone', () => {
    const office = new Office(founding(), 1).show(14, (v) => {
      v.phase = 'proposed';
      v.proposal = PROPOSAL;
      v.drafting = null;
      v.log.push({ at: at(14), kind: 'proposal', by: 'ceo', text: 'The CEO proposed an org.' });
    }).show(20, (v) => {
      v.phase = 'running';
      v.people = PROPOSAL.people.map((p) => person(p.id, p.level, p.room, { state: 'closed', sessionId: null }));
      v.log.push({ at: at(20), kind: 'started', by: STAKEHOLDER, text: 'You started the company.' });
    });
    const started = office.cast(20.5);
    expect(boxes(started)).toEqual([]);
    expect(started.props?.pins).toHaveLength(PROPOSAL.people.length);
  });
});
