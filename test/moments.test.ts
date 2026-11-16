// The 3D moments of an office that runs a company (docs/game-feel.md): the front desk, walk-overs and rounds, the
// meeting room, the walk budget, celebrations, first days and last ones, lounges, Stop and night. Every moment comes
// from a state change in a snapshot, watched the way the browser watches: noted as it arrives, cast in between.
import { defaultSettings } from '../src/core/company-state.ts';
import { describe, expect, it } from 'vitest';
import { type Approval, type CompanyView, type DeskView, type Message, type PersonView, type Question, STAKEHOLDER, UNDO_MS } from '../src/core/company.ts';
import { demoSnapshot, studioOf } from '../src/core/demo-company.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import type { Level, OfficeRoom } from '../src/core/studio.ts';
import { type Cast, type CastMember, castFrom, type CastOptions, SeenLog } from '../web/src/scene/cast.ts';
import { computeLayout, type Layout, type Point } from '../web/src/scene/layout.ts';
import {
  BUILD_FLOOR_MS, BUILD_WALLS_MS, CELEBRATION_GAP_MS, CLAP_MS, FROM_SHOWN_MS, HEAD_DOWN_MS, HEAD_STAGGER_MS, INTERACT_MS, LAST_STREAMERS, LISTEN_MS, NIGHT_FALL_MS,
  NIGHT_GRACE_MS, NOD_MS, NOTE_IN_MS, PICKUP_MS, ROOM_OUT_MS, ROUND_STOP_MS, STAND_BY_MS, STAND_UP_MS, STEP_UP_MS, STREAMER_MS, STREAMERS, TALK_MS,
} from '../web/src/scene/moments.ts';
import { planOffice } from '../web/src/scene/office/plan.ts';
import { MAX_WALK_MS, pathLength, PACE } from '../web/src/scene/walk.ts';

const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);
/** Seconds into the morning, on the snapshot clock. */
const at = (s: number) => T0 + Math.round(s * 1000);

const ROOMS: OfficeRoom[] = [
  { id: 'reception', title: 'Reception', kind: 'reception' },
  { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
  { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
  { id: 'kitchen', title: 'Kitchen', kind: 'kitchen' },
];

function person(id: string, name: string, title: string, level: Level, room: string, reportsTo: string | null, desk: Partial<DeskView> = {}): PersonView {
  return {
    id, name, title, level, room, reportsTo, look: {}, model: 'sonnet', task: null, status: null, agentKey: `s-${id}:lead`, cost: 0.4,
    desk: { person: id, state: 'idle', sessionId: `s-${id}`, since: at(-600), context: 0.2, problem: null, queue: null, ...desk },
  };
}

/** Café Lumen: the CEO, two heads and their people in three rooms, everyone idle at their desk. */
function cafe(): CompanyView {
  return {
    id: 'cafe', name: 'Café Lumen', phase: 'running', prompt: 'A café website', stakeholder: 'Alex', branch: null, theme: 'cafe', rooms: ROOMS, goal: null,
    people: [
      person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null),
      person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo'),
      person('ui-designer', 'Mina', 'UI designer', 'worker', 'design', 'head-of-design'),
      person('ux-designer', 'Jules', 'UX designer', 'worker', 'design', 'head-of-design'),
      person('head-of-engineering', 'Theo', 'Head of engineering', 'head', 'engineering', 'ceo'),
      person('frontend-engineer', 'Kai', 'Frontend engineer', 'worker', 'engineering', 'head-of-engineering'),
      person('backend-engineer', 'Noah', 'Backend engineer', 'worker', 'engineering', 'head-of-engineering'),
      person('devops-engineer', 'Marco', 'DevOps engineer', 'worker', 'engineering', 'head-of-engineering'),
      person('head-of-content', 'Clara', 'Head of content', 'head', 'content', 'ceo'),
      person('copywriter', 'Lena', 'Copywriter', 'worker', 'content', 'head-of-content'),
      person('qa-engineer', 'Ravi', 'QA engineer', 'worker', 'quality', 'head-of-engineering'),
    ],
    proposal: null, tasks: [], messages: [], questions: [], approvals: [], statuses: [], reports: [], dashboards: [], screenshots: [],
    spend: { samples: [], hourly: [], byPerson: [] }, log: [], pause: null,
    settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [] }, desks: { working: 0, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: null, problem: null }, inbox: 0, seen: {}, proposalEdited: false, problem: null,
  };
}

const message = (id: string, from: string, to: string, text: string, t: number, extra: Partial<Message> = {}): Message => ({
  id, from, to, text, origin: null, relayOf: null, note: null, at: at(t), deliveredAt: null, interrupt: false, ...extra,
});
const approval = (id: string, who: string, summary: string, t: number, extra: Partial<Approval> = {}): Approval => ({
  id, person: who, tool: 'Bash', summary, detail: 'git push origin main', kind: 'push', askedAt: at(t), expiresAt: at(t + 900), alwaysRule: null, answer: null, withdrawn: null, ...extra,
});
const question = (id: string, from: string, text: string, t: number, extra: Partial<Question> = {}): Question => ({
  id, from, text, options: ['Yes', 'No'], recommended: 0, taskId: null, askedAt: at(t), answer: null, withdrawn: null, ...extra,
});
const desk = (view: CompanyView, id: string, change: Partial<DeskView>) => {
  const p = view.people.find((x) => x.id === id);
  if (!p) throw new Error(`No ${id}`);
  p.desk = { ...p.desk, ...change };
};

/** An office watched from `t` seconds: each snapshot is noted as it arrives, the way useCast does. */
class Office {
  view: CompanyView;
  layout: Layout;
  snapshot: Snapshot;
  readonly seen = new SeenLog();

  constructor(view: CompanyView, t: number) {
    this.view = structuredClone(view);
    this.layout = computeLayout(studioOf(this.view));
    this.snapshot = demoSnapshot(this.view, 'C:\\cafe', at(t));
    this.seen.note(this.snapshot, this.layout);
  }

  /** The server sends a snapshot at `t` seconds, after `change`. */
  show(t: number, change: (view: CompanyView) => void = () => {}): this {
    const next = structuredClone(this.view);
    change(next);
    this.view = next;
    this.layout = computeLayout(studioOf(next), this.layout.office?.places ?? null);
    this.snapshot = demoSnapshot(next, 'C:\\cafe', at(t));
    this.seen.note(this.snapshot, this.layout);
    return this;
  }

  cast(t: number, options: CastOptions = {}): Cast {
    return castFrom(this.snapshot, this.layout, { now: at(t), seen: this.seen, ...options });
  }

  get office() {
    const o = this.layout.office;
    if (!o) throw new Error('Not a company layout');
    return o;
  }

  seatOf(id: string): Point {
    const d = this.office.byPerson.get(id);
    if (!d) throw new Error(`No desk for ${id}`);
    return d.seat;
  }
}

function member(cast: Cast, id: string): CastMember {
  const found = cast.members.find((m) => m.person === id);
  if (!found) throw new Error(`No ${id} among ${cast.members.map((m) => m.key).join(', ')}`);
  return found;
}
/**
 * The office watched the way useCast does from `t` seconds: cast again only at each next change, until the tier is
 * still or nothing more is scheduled. `steps` are the changes it was cast at.
 */
function untilStill(office: Office, t: number): { cast: Cast; steps: number[] } {
  let cast = office.cast(t);
  const steps: number[] = [];
  while (cast.tier !== 'still' && cast.nextChangeAt !== null && steps.length < 200) {
    steps.push(cast.nextChangeAt);
    cast = office.cast((cast.nextChangeAt - T0) / 1000);
  }
  return { cast, steps };
}
const ends = (m: CastMember): Point | undefined => m.walk[m.walk.length - 1]?.path.at(-1);
const near = (a: Point | undefined, b: Point, by = 1e-6) => a !== undefined && Math.hypot(a.x - b.x, a.z - b.z) < by;
const walking = (cast: Cast) => cast.members.filter((m) => m.walk.length > 0).map((m) => m.person);

describe('the front desk', () => {
  it('walks someone who needs your OK to the counter, paper up, and leaves them there', () => {
    const office = new Office(cafe(), 0).show(10, (v) => v.approvals.push(approval('a-1', 'frontend-engineer', 'Push the work branch to GitHub', 10)));
    const place = office.office.reception.frontDesk.places[0] as Point;
    const kai = member(office.cast(10), 'frontend-engineer');
    expect(kai.body.pose).toBe('stand');
    expect(kai.walk[0]?.at).toBe(at(10) + STAND_UP_MS);
    expect(near(ends(kai), place)).toBe(true);
    expect(member(office.cast(12), 'frontend-engineer').body).toMatchObject({ pose: 'walk', holding: 'note-yours' });
    const there = member(office.cast(30), 'frontend-engineer');
    expect(there.body).toMatchObject({ pose: 'wait', holding: 'note-yours' });
    expect(there.seated).toBe(false);
    expect(there.bubble).toEqual({ tone: 'needs-you', lead: null, text: 'Needs your OK to push…', dot: null });
    expect(office.cast(30).moments.frontDesk).toEqual(['frontend-engineer']);
  });

  it('drops to still once the waiter holds still at the counter, their settling being the change it waits for', () => {
    const office = new Office(cafe(), 0).show(10, (v) => v.approvals.push(approval('a-1', 'frontend-engineer', 'Push the work branch to GitHub', 10)));
    const { cast, steps } = untilStill(office, 10);
    const kai = member(cast, 'frontend-engineer');
    expect(cast.tier).toBe('still');
    expect(kai.body).toMatchObject({ pose: 'wait', holding: 'note-yours' });
    expect(near(kai, office.office.reception.frontDesk.places[0] as Point)).toBe(true);
    expect(steps.at(-1)).toBe(kai.body.since + HEAD_DOWN_MS);
  });

  it('fills the middle of the counter first, then its left and right, then the row behind', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      ['frontend-engineer', 'ui-designer', 'copywriter', 'qa-engineer'].forEach((id, i) => v.approvals.push(approval(`a-${i}`, id, 'Push the work branch', 2 + i)));
    });
    const places = office.office.reception.frontDesk.places;
    const cast = office.cast(40);
    expect(cast.moments.frontDesk).toEqual(['frontend-engineer', 'ui-designer', 'copywriter', 'qa-engineer']);
    ['frontend-engineer', 'ui-designer', 'copywriter', 'qa-engineer'].forEach((id, k) => expect(near(ends(member(cast, id)) ?? member(cast, id), places[k] as Point)).toBe(true));
    // Bubbles for the three at the counter, none for the row behind.
    expect(member(cast, 'copywriter').bubble?.tone).toBe('needs-you');
    expect(member(cast, 'qa-engineer').bubble).toBeNull();
  });

  it('keeps a seventh waiting at their own desk with the paper raised', () => {
    const ids = ['frontend-engineer', 'ui-designer', 'copywriter', 'qa-engineer', 'ux-designer', 'backend-engineer', 'devops-engineer'];
    const office = new Office(cafe(), 0).show(10, (v) => ids.forEach((id, i) => v.questions.push(question(`q-${i}`, id, 'Which one?', 1 + i))));
    const marco = member(office.cast(40), 'devops-engineer');
    expect(marco.walk).toEqual([]);
    expect(near(marco, office.seatOf('devops-engineer'))).toBe(true);
    expect(marco.body).toMatchObject({ pose: 'wait', holding: 'note-yours' });
    expect(marco.bubble).toMatchObject({ tone: 'needs-you', lead: 'Asks you:' });
  });

  it('gives several items from one person one place, with a thicker stack of papers', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 2), approval('a-2', 'frontend-engineer', 'Deploy', 3));
      v.questions.push(question('q-1', 'ui-designer', 'Darker?', 4));
    });
    const cast = office.cast(40);
    expect(cast.moments.frontDesk).toEqual(['frontend-engineer', 'ui-designer']);
    expect(member(cast, 'frontend-engineer').papers).toBe(2);
    expect(member(cast, 'ui-designer').papers).toBe(1);
    expect(member(cast, 'copywriter').papers).toBe(0);
  });

  it('flips an answered paper to white with a nod, and walks them back when the answer applies', () => {
    const office = new Office(cafe(), 0).show(1, (v) => v.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 1)));
    office.show(20, (v) => {
      const a = v.approvals[0] as Approval;
      a.answer = { decision: 'allow', always: false, at: at(20), appliesAt: at(20) + UNDO_MS, note: null };
    });
    const nodding = member(office.cast(20.2), 'frontend-engineer');
    expect(nodding.body).toMatchObject({ pose: 'nod', holding: 'note' });
    expect(nodding.bubble).toBeNull();
    expect(member(office.cast(21), 'frontend-engineer').body).toMatchObject({ pose: 'wait', holding: 'note' });
    const leaving = member(office.cast(25.5), 'frontend-engineer');
    expect(leaving.body.pose).toBe('walk');
    expect(near(ends(leaving), office.seatOf('frontend-engineer'))).toBe(true);
    expect(office.cast(25.5).moments.frontDesk).toEqual([]);
  });

  it('keeps the paper yellow when the answer is undone', () => {
    const office = new Office(cafe(), 0).show(1, (v) => v.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 1)));
    office.show(20, (v) => {
      (v.approvals[0] as Approval).answer = { decision: 'allow', always: false, at: at(20), appliesAt: at(25), note: null };
    });
    office.show(22, (v) => {
      (v.approvals[0] as Approval).answer = null;
    });
    const kai = member(office.cast(30), 'frontend-engineer');
    expect(kai.body).toMatchObject({ pose: 'wait', holding: 'note-yours' });
    expect(kai.walk).toEqual([]);
  });

  it('steps the line up half a second a place when the first leaves', () => {
    const office = new Office(cafe(), 0).show(1, (v) => {
      v.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 1));
      v.questions.push(question('q-1', 'ui-designer', 'Darker?', 2));
    });
    office.show(20, (v) => {
      (v.approvals[0] as Approval).withdrawn = { reason: 'Kai was stopped.', at: at(20) };
    });
    const mina = member(office.cast(20.1), 'ui-designer');
    const step = mina.walk.find((l) => l.at === at(20));
    expect(step?.ms).toBe(STEP_UP_MS);
    expect(near(step?.path.at(-1), office.office.reception.frontDesk.places[0] as Point)).toBe(true);
  });

  it('shows only the first waiter’s bubble on a phone', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 2), approval('a-2', 'ui-designer', 'Deploy', 3));
    });
    const cast = office.cast(40, { narrow: true });
    expect(member(cast, 'frontend-engineer').bubble).toMatchObject({ tone: 'needs-you', text: 'Needs your OK to push' });
    expect(member(cast, 'ui-designer').bubble).toBeNull();
  });

  it('walks to the front desk whatever the walk budget', () => {
    const office = new Office(cafe(), 0).show(10, (v) => v.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 10)));
    expect(member(office.cast(10, { budget: 0 }), 'frontend-engineer').walk).not.toEqual([]);
  });

  it('puts whoever was already waiting at the counter when the office opens, without replaying the walk', () => {
    const view = cafe();
    view.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 0));
    const kai = member(new Office(view, 20).cast(20), 'frontend-engineer');
    expect(kai.walk).toEqual([]);
    expect(near(kai, new Office(view, 20).office.reception.frontDesk.places[0] as Point)).toBe(true);
    expect(kai.body.pose).toBe('wait');
  });

  it('brings the CEO with the proposal while it waits for your OK', () => {
    const view = cafe();
    view.phase = 'proposed';
    view.proposal = { company: 'Café Lumen', goal: 'Coffee', theme: 'cafe', rooms: [], people: [], questions: [] };
    view.log.push({ at: at(0), kind: 'proposal', by: 'ceo', text: 'The CEO proposed an org.' });
    const ceo = member(new Office(view, 30).cast(30), 'ceo');
    expect(ceo.body).toMatchObject({ pose: 'wait', holding: 'note-yours' });
    expect(ceo.bubble).toEqual({ tone: 'needs-you', lead: null, text: 'Proposal ready for you', dot: null });
  });
});

describe('walking over to tell someone', () => {
  it('leaves your own words as a yellow note in the tray, with nobody walking', () => {
    const office = new Office(cafe(), 0).show(10, (v) => v.messages.push(message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker', 10)));
    const cast = office.cast(11);
    expect(walking(cast)).toEqual([]);
    expect(cast.moments.trays).toEqual([{ person: 'ceo', notes: 1, yours: true }]);
  });

  it('walks a relay of your words over at a walking pace, the note held up, and puts it in the tray while talking', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.messages.push(message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker', 2, { deliveredAt: at(3) }));
      v.messages.push(message('m-2', 'ceo', 'head-of-design', 'Make the palette darker', 10, { origin: STAKEHOLDER, relayOf: 'm-1' }));
    });
    const mara = member(office.cast(10), 'ceo');
    const [there, back] = mara.walk;
    if (!there || !back) throw new Error('The CEO should walk there and back');
    expect(there.at).toBe(at(10) + STAND_UP_MS);
    expect(near(there.path.at(-1), office.office.byPerson.get('head-of-design')?.visitor as Point)).toBe(true);
    expect(there.ms).toBe(Math.round(Math.min(MAX_WALK_MS, (pathLength(there.path) / PACE) * 1000)));
    const arrive = there.at + there.ms;
    const onTheWay = member(office.cast((there.at - T0) / 1000 + 0.5), 'ceo');
    expect(onTheWay.body).toMatchObject({ pose: 'walk', holding: 'note-yours' });
    expect(onTheWay.bubble).toEqual({ tone: 'meeting', lead: 'From you:', text: 'Make the palette…', dot: null });
    // Carried, the note is in no tray; it goes in the tray 1.5 s into the 2.5 s stand.
    expect(office.cast((there.at - T0) / 1000 + 0.5).moments.trays).toEqual([]);
    const talking = office.cast((arrive - T0) / 1000 + 0.2);
    expect(member(talking, 'ceo').body.pose).toBe('talk');
    expect(member(talking, 'head-of-design').gaze.some((g) => g.from === arrive && g.until === arrive + TALK_MS)).toBe(true);
    expect(office.cast((arrive + NOTE_IN_MS - T0) / 1000 + 0.1).moments.trays).toEqual([{ person: 'head-of-design', notes: 1, yours: true }]);
    expect(back.at).toBe(arrive + TALK_MS);
    expect(near(back.path.at(-1), office.seatOf('ceo'))).toBe(true);
  });

  it('drops to still once the walker has sat back down at their desk, their settling being a change it waits for', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.messages.push(message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker', 2, { deliveredAt: at(3) }));
      v.messages.push(message('m-2', 'ceo', 'head-of-design', 'Make the palette darker', 10, { origin: STAKEHOLDER, relayOf: 'm-1' }));
    });
    // Watched the way useCast does, from one change to the next, until nothing more is scheduled. Her talk at the
    // desk may run on the people renderer's own ambient frames; what matters is that sitting down settles.
    const steps: { at: number; cast: Cast }[] = [];
    let cast = office.cast(10);
    while (cast.nextChangeAt !== null && steps.length < 300) {
      const next = cast.nextChangeAt;
      cast = office.cast((next - T0) / 1000);
      steps.push({ at: next, cast });
    }
    const mara = member(cast, 'ceo');
    expect(mara.body.pose).toBe('rest');
    expect(near(mara, office.seatOf('ceo'))).toBe(true);
    expect(cast.tier).toBe('still');
    const settled = steps.findIndex((s) => s.at === mara.body.since + HEAD_DOWN_MS);
    expect(settled).toBeGreaterThan(0);
    expect(steps[settled - 1]?.cast.tier).toBe('motion');
    expect(steps[settled]?.cast.tier).toBe('still');
  });

  it('takes the note with a nod when it reaches them', () => {
    const office = new Office(cafe(), 0).show(10, (v) => v.messages.push(message('m-1', STAKEHOLDER, 'frontend-engineer', 'Use one thumb', 10)));
    office.show(14, (v) => {
      (v.messages[0] as Message).deliveredAt = at(14);
    });
    expect(member(office.cast(14.2), 'frontend-engineer').body).toMatchObject({ pose: 'nod', since: at(14) });
    expect(member(office.cast(14 + NOD_MS / 1000 + 0.1), 'frontend-engineer').body.pose).toBe('rest');
    expect(office.cast(14.2).moments.trays).toEqual([]);
  });

  it('carries your words down the org one hop at a time: the next leaves when the note lands', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.messages.push(message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker', 2, { deliveredAt: at(3) }));
      v.messages.push(message('m-2', 'ceo', 'head-of-design', 'Make the palette darker', 10, { origin: STAKEHOLDER, relayOf: 'm-1' }));
    });
    office.show(11, (v) => v.messages.push(message('m-3', 'head-of-design', 'ui-designer', 'Make the palette darker', 11, { origin: STAKEHOLDER, relayOf: 'm-2' })));
    const cast = office.cast(11);
    const [there] = member(cast, 'ceo').walk;
    if (!there) throw new Error('The CEO walks first');
    const lands = there.at + there.ms + NOTE_IN_MS;
    const ada = member(cast, 'head-of-design');
    const leaves = ada.walk[0]?.at ?? 0;
    expect(leaves - STAND_UP_MS).toBeGreaterThanOrEqual(Math.min(lands, at(11) + 6000) - 1);
    expect(leaves - STAND_UP_MS).toBeLessThanOrEqual(at(11) + 6000);
    expect(near(ends(ada) && ada.walk[0]?.path.at(-1), office.office.byPerson.get('ui-designer')?.visitor as Point)).toBe(true);
  });

  it('has a second sender wait a step behind while the first talks', () => {
    // Ada sits next to Mina and gets there first; Jules, a desk further, arrives while she talks.
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.messages.push(message('m-1', 'head-of-design', 'ui-designer', 'Darker palette', 10));
      v.messages.push(message('m-2', 'ux-designer', 'ui-designer', 'Swap the icons', 10));
    });
    const cast = office.cast(10);
    const visitor = office.office.byPerson.get('ui-designer')?.visitor as Point;
    const behind = office.office.byPerson.get('ui-designer')?.behind as Point;
    const first = member(cast, 'head-of-design');
    const second = member(cast, 'ux-designer');
    expect(near(first.walk[0]?.path.at(-1), visitor)).toBe(true);
    expect(near(second.walk[0]?.path.at(-1), behind)).toBe(true);
    const firstLeaves = first.walk[1]?.at ?? 0;
    expect(second.walk[1]?.at).toBe(firstLeaves);
    expect(near(second.walk[1]?.path.at(-1), visitor)).toBe(true);
  });

  it('makes a round of several desks, nearest next, a moment at each', () => {
    const office = new Office(cafe(), 0).show(11, (v) => {
      for (const [i, to] of ['frontend-engineer', 'backend-engineer', 'devops-engineer'].entries()) v.messages.push(message(`m-${i}`, 'head-of-engineering', to, `Task ${i}`, 10 + i * 0.5));
    });
    const theo = member(office.cast(11), 'head-of-engineering');
    const stops = theo.walk.slice(0, -1).map((l) => l.path.at(-1));
    expect(stops).toHaveLength(3);
    const order = stops.map((p) => [...office.office.byPerson].find(([, d]) => near(p, d.visitor))?.[0]);
    expect(new Set(order)).toEqual(new Set(['frontend-engineer', 'backend-engineer', 'devops-engineer']));
    // Nearest next: each stop is the nearest left from the one before.
    let here = office.seatOf('head-of-engineering');
    const left = new Set(order);
    for (const id of order) {
      const d = (p: string) => Math.hypot((office.office.byPerson.get(p)?.visitor.x ?? 0) - here.x, (office.office.byPerson.get(p)?.visitor.z ?? 0) - here.z);
      expect([...left].every((other) => d(id as string) <= d(other as string) + 1e-9)).toBe(true);
      left.delete(id);
      here = office.office.byPerson.get(id as string)?.visitor as Point;
    }
    const second = theo.walk[1];
    const first = theo.walk[0];
    expect(first && second && second.at - (first.at + first.ms)).toBe(ROUND_STOP_MS);
  });

  it('says "Sent notes to three people" when nobody can be visited', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      for (const [i, to] of ['frontend-engineer', 'backend-engineer', 'devops-engineer'].entries()) v.messages.push(message(`m-${i}`, 'head-of-engineering', to, `Task ${i}`, 10));
    });
    const cast = office.cast(10.5, { budget: 0 });
    expect(member(cast, 'head-of-engineering').walk).toEqual([]);
    expect(member(cast, 'head-of-engineering').bubble).toMatchObject({ text: 'Sent notes to three people' });
    expect(cast.moments.trays.map((t) => t.person).sort()).toEqual(['backend-engineer', 'devops-engineer', 'frontend-engineer']);
  });

  it('calls a meeting for one message to idle people in three rooms, and leaves busy ones a note', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      desk(v, 'head-of-content', { state: 'working', since: at(-60) });
      for (const [i, to] of ['head-of-design', 'head-of-engineering', 'head-of-content', 'qa-engineer'].entries()) {
        v.messages.push(message(`m-${i}`, 'ceo', to, 'The goal is pickup orders', 10));
      }
    });
    const cast = office.cast(10);
    const meeting = office.office.meeting;
    if (!meeting) throw new Error('A meeting room');
    expect(near(member(cast, 'ceo').walk[0]?.path.at(-1), meeting.head)).toBe(true);
    for (const id of ['head-of-design', 'head-of-engineering', 'qa-engineer']) expect(meeting.spots.some((s) => near(member(cast, id).walk[0]?.path.at(-1), s))).toBe(true);
    expect(member(cast, 'head-of-content').walk).toEqual([]);
    const listening = office.cast(19);
    expect(member(listening, 'head-of-design').body.pose).toBe('listen');
    expect(member(listening, 'ceo').body.pose).toBe('talk');
    const talk = member(cast, 'ceo');
    const back = talk.walk[1];
    const firstIn = Math.min(...['head-of-design', 'head-of-engineering', 'qa-engineer'].map((id) => {
      const leg = member(cast, id).walk[0];
      return leg ? leg.at + leg.ms : Number.POSITIVE_INFINITY;
    }));
    expect(back && back.at - firstIn).toBeLessThanOrEqual(3000 + LISTEN_MS);
    expect(office.cast(11).moments.trays).toEqual([{ person: 'head-of-content', notes: 1, yours: false }]);
  });
});

describe('the walk budget', () => {
  // Seven senders, each writing to someone of their own who stays at their desk.
  const senders = ['head-of-design', 'head-of-engineering', 'head-of-content', 'ui-designer', 'frontend-engineer', 'copywriter', 'qa-engineer'];
  const helpers = senders.map((_, i) => person(`helper-${i}`, `Helper ${i}`, 'Helper', 'worker', i % 2 === 0 ? 'engineering' : 'quality', 'head-of-engineering'));
  const busy = () => {
    const view = cafe();
    view.people.push(...helpers);
    return view;
  };
  const burst = (yours: boolean) => (v: CompanyView) => {
    senders.forEach((from, i) => v.messages.push(message(`m-${i}`, from, `helper-${i}`, 'Note', 10, yours ? { origin: STAKEHOLDER } : {})));
  };

  it('lets four walk at once on a desktop and keeps two places for your words', () => {
    expect(walking(new Office(busy(), 0).show(10, burst(false)).cast(10))).toHaveLength(4);
    expect(walking(new Office(busy(), 0).show(10, burst(true)).cast(10))).toHaveLength(6);
  });

  it('lets one walk on a phone, three with your words', () => {
    expect(walking(new Office(busy(), 0).show(10, burst(false)).cast(10, { narrow: true }))).toHaveLength(1);
    expect(walking(new Office(busy(), 0).show(10, burst(true)).cast(10, { narrow: true }))).toHaveLength(3);
  });

  it('lowers to what the frame governor asks', () => {
    expect(walking(new Office(busy(), 0).show(10, burst(true)).cast(10, { budget: 2 }))).toHaveLength(2);
  });

  it("keeps the notes and a bubble for whoever doesn't walk", () => {
    const cast = new Office(busy(), 0).show(10, burst(false)).cast(10.5);
    const still = cast.members.filter((m) => m.person && senders.includes(m.person) && m.walk.length === 0);
    expect(still).toHaveLength(3);
    for (const m of still) expect(m.bubble).toMatchObject({ text: 'Note' });
    expect(cast.moments.trays.length).toBeGreaterThanOrEqual(3);
  });
});

describe('reduced motion', () => {
  it('walks nobody: a waiter is at the counter at once and a relay is a note with the receiver saying who from', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.approvals.push(approval('a-1', 'frontend-engineer', 'Push', 10));
      v.messages.push(message('m-1', 'ceo', 'head-of-design', 'Darker palette, please', 10));
      v.messages.push(message('m-2', STAKEHOLDER, 'ui-designer', 'Try espresso brown', 10));
    });
    const cast = office.cast(10.5, { reducedMotion: true });
    expect(walking(cast)).toEqual([]);
    expect(near(member(cast, 'frontend-engineer'), office.office.reception.frontDesk.places[0] as Point)).toBe(true);
    expect(member(cast, 'head-of-design').bubble).toEqual({ tone: 'meeting', lead: 'From Mara:', text: 'Darker palette…', dot: null });
    expect(member(cast, 'ui-designer').bubble).toEqual({ tone: 'meeting', lead: 'From you:', text: 'Try espresso brown', dot: null });
    expect(member(office.cast(10 + FROM_SHOWN_MS / 1000 + 0.1, { reducedMotion: true }), 'head-of-design').bubble).toBeNull();
    expect(cast.tier).toBe('still');
  });
});

describe('a milestone celebration', () => {
  const withGoal = (v: CompanyView) => {
    v.goal = {
      text: 'Pickup orders', setAt: at(-3600), milestones: [
        { id: 'ms-1', title: 'Menu pages live', doneWhen: 'Menu reads well', doneAt: null },
        { id: 'ms-2', title: 'Pickup orders work', doneWhen: 'Orders work', doneAt: null },
      ],
    };
    v.tasks.push(
      { id: 't-1', title: 'Menu page', brief: '', owner: 'frontend-engineer', askedBy: 'head-of-engineering', files: [], doneWhen: '', status: 'done', outcome: null, parent: null, milestone: 'ms-1', worktree: null, commit: null, createdAt: at(-3000), updatedAt: at(-10) },
      { id: 't-2', title: 'Menu layout', brief: '', owner: 'ui-designer', askedBy: 'head-of-design', files: [], doneWhen: '', status: 'done', outcome: null, parent: null, milestone: 'ms-1', worktree: null, commit: null, createdAt: at(-3000), updatedAt: at(-10) },
    );
  };

  it('stands idle owners and their managers up to clap, the idle CEO cheers, streamers fall in their rooms\' hues', () => {
    const office = new Office(cafe(), 0).show(1, withGoal).show(10, (v) => {
      desk(v, 'ui-designer', { state: 'working', since: at(-30) });
      const ms = v.goal?.milestones[0];
      if (ms) ms.doneAt = at(10);
    });
    const cast = office.cast(10.5);
    expect(member(cast, 'frontend-engineer').body.pose).toBe('clap');
    expect(member(cast, 'head-of-engineering').body.pose).toBe('clap');
    expect(member(cast, 'head-of-design').body.pose).toBe('clap');
    expect(member(cast, 'ui-designer').body.pose).toBe('type');
    expect(member(cast, 'ceo').body.pose).toBe('cheer');
    expect(member(cast, 'copywriter').body.pose).toBe('rest');
    expect(cast.moments.celebration).toEqual({ until: at(10) + STREAMER_MS, rooms: ['engineering', 'design'], streamers: STREAMERS });
    expect(member(office.cast(10 + (STAND_UP_MS + CLAP_MS) / 1000 + 0.1), 'frontend-engineer').body.pose).toBe('rest');
    expect(office.cast(12).moments.celebration).toBeNull();
    expect(cast.props?.cards[0]).toMatchObject({ done: true, flippedAt: at(10) });
  });

  it("puts the cards and the streamers on the milestone board's face, out where the scenery stands it on legs", () => {
    const office = new Office(cafe(), 0).show(1, withGoal).show(10, (v) => {
      const ms = v.goal?.milestones[0];
      if (ms) ms.doneAt = at(10);
    });
    const board = planOffice(office.layout, { theme: 'cafe', decor: [] })?.pieces.find((p) => p.id === 'milestone-board');
    // Rooms stand behind the meeting room, so its back wall is low and the board stands out in front of it.
    expect(board?.stand).not.toBeNull();
    // The face of its sheet, 0.1 out from where the scenery puts the board (props.ts).
    const face = (board?.z ?? Number.NaN) + 0.1;
    const cast = office.cast(10.5);
    expect(cast.props?.cards).toHaveLength(2);
    for (const c of cast.props?.cards ?? []) expect(c.z).toBeCloseTo(face, 6);
    expect(cast.props?.streamers?.face).toBeCloseTo(face, 6);
  });

  it('flips a second milestone within 20 s quietly, and celebrates the last one with everyone idle and 48 streamers', () => {
    const office = new Office(cafe(), 0).show(1, withGoal).show(10, (v) => {
      const ms = v.goal?.milestones[0];
      if (ms) ms.doneAt = at(10);
    });
    office.show(15, (v) => {
      const ms = v.goal?.milestones[1];
      if (ms) ms.doneAt = at(15);
    });
    const quiet = office.cast(15.5);
    expect(quiet.moments.celebration).toBeNull();
    expect(quiet.props?.cards[1]).toMatchObject({ done: true, flippedAt: at(15) });
    const late = new Office(cafe(), 0).show(1, withGoal).show(10 + CELEBRATION_GAP_MS / 1000, (v) => {
      for (const ms of v.goal?.milestones ?? []) ms.doneAt = at(10 + CELEBRATION_GAP_MS / 1000);
    });
    const finale = late.cast(10.5 + CELEBRATION_GAP_MS / 1000);
    expect(finale.moments.celebration?.streamers).toBe(LAST_STREAMERS);
    expect(member(finale, 'copywriter').body.pose).toBe('clap');
  });

  it('replays nothing seen late, and shows the card done at once with reduced motion', () => {
    const view = cafe();
    withGoal(view);
    const ms = view.goal?.milestones[0];
    if (ms) ms.doneAt = at(0);
    const office = new Office(view, 20);
    expect(office.cast(20).moments.celebration).toBeNull();
    expect(member(office.cast(20), 'frontend-engineer').body.pose).toBe('rest');
    const reduced = new Office(cafe(), 0).show(1, withGoal).show(10, (v) => {
      const first = v.goal?.milestones[0];
      if (first) first.doneAt = at(10);
    });
    const cast = reduced.cast(10.5, { reducedMotion: true });
    expect(cast.moments.celebration).toBeNull();
    expect(member(cast, 'frontend-engineer').body.pose).toBe('rest');
    expect(cast.props?.cards[0]).toMatchObject({ done: true, flippedAt: null });
  });
});

describe('first days and last ones', () => {
  it('walks a hire in from the street with a plant, sets it on their desk and sits', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.people.push(person('brand-designer', 'Pia', 'Brand designer', 'worker', 'design', 'head-of-design', { state: 'closed', sessionId: null }));
      v.log.push({ at: at(10), kind: 'hire', by: 'ceo', text: 'The CEO hired Pia, brand designer.' });
    });
    const cast = office.cast(10);
    const pia = member(cast, 'brand-designer');
    expect(pia.presence.from).toBe(at(10));
    expect(near(pia.walk[0]?.path[0], office.office.edge)).toBe(true);
    expect(near(ends(pia), office.seatOf('brand-designer'))).toBe(true);
    expect(pia.body.holding).toBe('plant');
    expect(pia.bubble).toEqual({ tone: 'meeting', lead: 'New:', text: 'Brand designer', dot: null });
    const leg = pia.walk[0];
    if (!leg) throw new Error('Pia walks in');
    const arrive = leg.at + leg.ms;
    expect(member(office.cast((arrive - T0) / 1000 + 0.2), 'brand-designer').body.pose).toBe('interact');
    const desk = office.office.byPerson.get('brand-designer');
    const planted = office.cast((arrive + INTERACT_MS - T0) / 1000 + 0.1);
    expect(planted.props?.plants.some((p) => p.x === desk?.plant.x && p.z === desk?.plant.z)).toBe(true);
    expect(member(planted, 'brand-designer').body.pose).toBe('rest');
  });

  it('walks a company in at its start, heads first, 0.7 s apart within the walk budget', () => {
    const view = cafe();
    const ceoOnly = { ...view, people: view.people.filter((p) => p.level === 'ceo'), phase: 'proposed' as const };
    const office = new Office(ceoOnly, 0).show(10, (v) => {
      v.people = cafe().people.map((p) => (p.level === 'ceo' ? p : { ...p, desk: { ...p.desk, state: 'closed' as const, sessionId: null } }));
      v.phase = 'running';
      v.log.push({ at: at(10), kind: 'started', by: STAKEHOLDER, text: 'You started the company.' });
    });
    const cast = office.cast(10);
    const leaves = cast.members.filter((m) => m.level !== 'ceo').map((m) => ({ id: m.person, level: m.level, at: m.walk[0]?.at ?? Number.NaN }));
    expect(leaves.every((l) => Number.isFinite(l.at))).toBe(true);
    // The rooms build in first, 150 ms apart; then people walk in.
    const built = cast.props?.built ?? [];
    expect(built.map((b) => b.room).sort()).toEqual(['content', 'design', 'engineering', 'quality']);
    expect(Math.min(...leaves.map((l) => l.at))).toBeGreaterThanOrEqual(Math.max(...built.map((b) => b.at)) + BUILD_FLOOR_MS + BUILD_WALLS_MS);
    const sorted = [...leaves].sort((a, b) => a.at - b.at);
    expect(sorted.slice(0, 3).map((l) => l.level)).toEqual(['head', 'head', 'head']);
    for (let i = 1; i < sorted.length; i++) expect((sorted[i]?.at ?? 0) - (sorted[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(300 - 1e-6);
    for (let t = 10; t < 60; t += 0.25) {
      const out = office.cast(t).members.filter((m) => m.level !== 'ceo' && m.walk.some((l) => l.at <= at(t) && at(t) < l.at + l.ms));
      expect(out.length).toBeLessThanOrEqual(4);
    }
    // A click on the stage, or Escape, seats everyone at once.
    const seated = office.cast(12, { skipAt: at(11) });
    for (const m of seated.members) if (m.level !== 'ceo') expect(m.walk.every((l) => l.at + l.ms <= at(11) + 1)).toBe(true);
  });

  it('fades a starting company in on a phone, room by room', () => {
    const view = cafe();
    const office = new Office({ ...view, people: view.people.filter((p) => p.level === 'ceo') }, 0).show(10, (v) => {
      v.people = cafe().people;
      v.log.push({ at: at(10), kind: 'started', by: STAKEHOLDER, text: 'You started the company.' });
    });
    const cast = office.cast(10, { narrow: true });
    expect(walking(cast)).toEqual([]);
    const from = (id: string) => member(cast, id).presence.from ?? 0;
    expect(from('ui-designer')).toBe(from('head-of-design'));
    expect(from('frontend-engineer')).toBeGreaterThan(from('ui-designer'));
  });

  it('walks someone fired out with their plant: stand, pick it up, go, wave at the door, fade', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.people = v.people.filter((p) => p.id !== 'copywriter');
      v.log.push({ at: at(10), kind: 'fire', by: 'ceo', text: 'The CEO let Lena go.' });
    });
    const lena = member(office.cast(10), 'copywriter');
    expect(lena.body.pose).toBe('stand');
    expect(member(office.cast(10 + (STAND_UP_MS + 100) / 1000), 'copywriter').body.pose).toBe('pickup');
    const [toDoor, out] = lena.walk;
    if (!toDoor || !out) throw new Error('Lena walks out');
    expect(near(toDoor.path.at(-1), office.office.door)).toBe(true);
    expect(near(out.path.at(-1), office.office.edge)).toBe(true);
    const going = member(office.cast((toDoor.at - T0) / 1000 + 0.3), 'copywriter');
    expect(going.body.holding).toBe('plant');
    expect(going.bubble).toMatchObject({ text: 'Leaving' });
    expect(member(office.cast((toDoor.at + toDoor.ms - T0) / 1000 + 0.2), 'copywriter').body.pose).toBe('wave');
    expect(lena.presence.until).toBeGreaterThan(out.at + out.ms);
    expect(office.cast((lena.presence.until ?? 0) / 1000 - T0 / 1000 + 0.1).members.some((m) => m.person === 'copywriter')).toBe(false);
    // The desk stays free, her plant goes with her.
    expect(office.office.freed.get('copywriter')).toBeDefined();
    const plantAt = office.office.freed.get('copywriter')?.plant;
    expect(office.cast(10.5).props?.plants.some((p) => p.x === plantAt?.x && p.z === plantAt?.z)).toBe(true);
    expect(office.cast(10 + (STAND_UP_MS + PICKUP_MS) / 1000 + 0.1).props?.plants.some((p) => p.x === plantAt?.x && p.z === plantAt?.z)).toBe(false);
  });

  it('turns someone back from wherever they are when the firing is undone', () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.people = v.people.filter((p) => p.id !== 'copywriter');
      v.log.push({ at: at(10), kind: 'fire', by: 'ceo', text: 'The CEO let Lena go.' });
    });
    const [toDoor] = member(office.cast(10), 'copywriter').walk;
    const t = (toDoor?.at ?? 0) / 1000 - T0 / 1000 + 1;
    office.show(t, (v) => {
      v.people = cafe().people;
      v.log.push({ at: at(t), kind: 'rehire', by: STAKEHOLDER, text: 'You undid it.' });
    });
    const lena = member(office.cast(t), 'copywriter');
    expect(lena.presence.from).toBeNull();
    expect(near(ends(lena), office.seatOf('copywriter'))).toBe(true);
    expect(Math.hypot((lena.walk[0]?.path[0]?.x ?? 0) - office.office.edge.x, (lena.walk[0]?.path[0]?.z ?? 0) - office.office.edge.z)).toBeGreaterThan(1);
  });

  it('walks someone handed over to Claude Code out without the plant, and back in when brought back', () => {
    const office = new Office(cafe(), 0).show(10, (v) => desk(v, 'devops-engineer', { state: 'away', since: at(10) }));
    const marco = member(office.cast(10), 'devops-engineer');
    expect(marco.walk).toHaveLength(1);
    expect(near(ends(marco), office.office.edge)).toBe(true);
    expect(member(office.cast(12), 'devops-engineer').body.holding).toBe('none');
    expect(office.cast(30).members.some((m) => m.person === 'devops-engineer')).toBe(false);
    office.show(40, (v) => desk(v, 'devops-engineer', { state: 'starting', since: at(40) }));
    const back = member(office.cast(40), 'devops-engineer');
    expect(near(back.walk[0]?.path[0], office.office.edge)).toBe(true);
    expect(near(ends(back), office.seatOf('devops-engineer'))).toBe(true);
  });
});

describe("the CEO's office", () => {
  it('walks a new company’s CEO in to draft the org on the board, a box every 3 s, then to you with the proposal', () => {
    const view = cafe();
    view.phase = 'founding';
    view.people = [person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null, { state: 'working', since: at(0) })];
    view.log.push({ at: at(0), kind: 'founded', by: STAKEHOLDER, text: 'You started Café Lumen.' });
    const office = new Office(view, 1);
    const board = office.office.ceo.boardSpot;
    const mara = member(office.cast(1), 'ceo');
    expect(near(mara.walk[0]?.path[0], office.office.edge)).toBe(true);
    expect(near(ends(mara), board)).toBe(true);
    const drafting = office.cast(20);
    expect(member(drafting, 'ceo').body).toMatchObject({ pose: 'interact', holding: 'none' });
    // Turned to the board: away from the camera's side.
    expect(member(drafting, 'ceo').facing).toBe(board.facing);
    expect(Math.cos(board.facing)).toBeLessThan(0);
    expect(drafting.props?.boxes).toHaveLength(6);
    expect(office.cast(40).props?.boxes).toHaveLength(8);
    office.show(45, (v) => {
      v.phase = 'proposed';
      v.proposal = { company: 'Café Lumen', goal: 'Coffee', theme: 'cafe', rooms: [], people: [], questions: [] };
      v.log.push({ at: at(45), kind: 'proposal', by: 'ceo', text: 'The CEO proposed an org.' });
    });
    expect(near(ends(member(office.cast(45), 'ceo')), office.office.reception.frontDesk.places[0] as Point)).toBe(true);
  });
});

describe('office changes', () => {
  const withManager = () => {
    const view = cafe();
    view.people.push(person('office-manager', 'Otto', 'Office manager', 'worker', 'direction', 'ceo'));
    return view;
  };

  it('builds a new room in, the office manager walking over to stand by it', () => {
    // A small front strip, so the new room is within a walk of the CEO's office.
    const small = withManager();
    small.rooms = small.rooms.filter((r) => r.kind === 'reception' || r.kind === 'ceo');
    const office = new Office(small, 0).show(10, (v) => {
      v.rooms = [...v.rooms, { id: 'games', title: 'Games room', kind: 'games' }];
      v.log.push({ at: at(10), kind: 'office', by: 'office-manager', text: 'Otto added a games room.' });
    });
    const cast = office.cast(10);
    expect(cast.props?.built).toEqual([{ room: 'games', at: at(10) }]);
    const games = office.office.rest.find((r) => r.id === 'games');
    if (!games) throw new Error('A games room');
    const otto = member(cast, 'office-manager');
    expect(near(otto.walk[0]?.path.at(-1), { x: games.x + games.w / 2, z: games.z + games.d / 2 })).toBe(true);
    const [there, back] = otto.walk;
    if (!there || !back) throw new Error('Otto walks there and back');
    expect(back.at - (there.at + there.ms)).toBe(STAND_BY_MS);
    expect(cast.tier).toBe('motion');
    expect(office.cast(10, { reducedMotion: true }).props?.built).toEqual([]);
  });

  it('says what the office manager is setting up when the new room is too far to walk to', () => {
    const office = new Office(withManager(), 0).show(10, (v) => {
      v.rooms = [...v.rooms, { id: 'games', title: 'Games room', kind: 'games' }];
    });
    const otto = member(office.cast(10.5), 'office-manager');
    if (otto.walk.length === 0) expect(otto.bubble).toMatchObject({ text: 'Setting up the games room' });
    else expect(otto.walk[0]?.path.at(-1)).toBeDefined();
    expect(member(office.cast(10.5, { reducedMotion: true }), 'office-manager').bubble).toMatchObject({ text: 'Setting up the games room' });
  });

  it('takes a room out with its people walking back to their desks', () => {
    const office = new Office(cafe(), 0).show(5, (v) => desk(v, 'copywriter', { state: 'working', since: at(5) }));
    office.show(6, (v) => desk(v, 'copywriter', { state: 'closed', since: at(5) }));
    expect(member(office.cast(30), 'copywriter').body.pose).toBe('lounge');
    office.show(40, (v) => {
      v.rooms = v.rooms.filter((r) => r.kind !== 'kitchen');
    });
    const cast = office.cast(40);
    expect(cast.props?.gone.map((g) => g.room)).toEqual(['kitchen']);
    expect(near(ends(member(cast, 'copywriter')), office.seatOf('copywriter'))).toBe(true);
    expect(office.cast(40 + ROOM_OUT_MS / 1000 + 0.1).props?.gone).toEqual([]);
  });

  it("drops a new desk in when a hire takes a room's free one", () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.people.push(person('brand-designer', 'Pia', 'Brand designer', 'worker', 'design', 'head-of-design', { state: 'closed', sessionId: null }));
      v.log.push({ at: at(10), kind: 'hire', by: 'ceo', text: 'The CEO hired Pia, brand designer.' });
    });
    const design = office.layout.rooms.find((r) => r.id === 'design');
    const fresh = design?.spare?.[0];
    expect(office.cast(10).props?.drops).toEqual([{ x: fresh?.x, z: fresh?.z, at: at(10) }]);
  });
});

describe('off duty and back', () => {
  it('walks someone whose desk closes after work to the kitchen, and back when it reopens', () => {
    const office = new Office(cafe(), 0).show(5, (v) => desk(v, 'copywriter', { state: 'working', since: at(5) }));
    office.show(10, (v) => desk(v, 'copywriter', { state: 'closed', since: at(5) }));
    const lena = member(office.cast(10), 'copywriter');
    const seats = office.office.rest.flatMap((r) => r.seats);
    expect(seats.some((s) => near(ends(lena), s))).toBe(true);
    const sitting = member(office.cast(30), 'copywriter');
    expect(sitting.body.pose).toBe('lounge');
    expect(sitting.seated).toBe(true);
    expect(sitting.facing).toBe(seats.find((s) => near(ends(lena), s))?.facing);
    office.show(40, (v) => desk(v, 'copywriter', { state: 'starting', since: at(40) }));
    expect(near(ends(member(office.cast(40), 'copywriter')), office.seatOf('copywriter'))).toBe(true);
  });

  it('keeps people who never worked at their desks', () => {
    const office = new Office(cafe(), 0).show(10, (v) => desk(v, 'copywriter', { state: 'closed', sessionId: null }));
    expect(member(office.cast(10), 'copywriter').walk).toEqual([]);
    expect(member(office.cast(10), 'copywriter').body.pose).toBe('rest');
  });
});

describe('Stop', () => {
  it('sits them back to look at you for 1.5 s, with your instruction a yellow note taken with a nod', () => {
    const office = new Office(cafe(), 0).show(5, (v) => desk(v, 'frontend-engineer', { state: 'working', since: at(0) }));
    office.show(10, (v) => {
      desk(v, 'frontend-engineer', { state: 'stopping', since: at(10) });
      v.messages.push(message('m-1', STAKEHOLDER, 'frontend-engineer', 'Stop and use the design tokens', 10, { interrupt: true }));
    });
    expect(member(office.cast(10.5), 'frontend-engineer').body.pose).toBe('look');
    expect(office.cast(10.5).moments.trays).toEqual([{ person: 'frontend-engineer', notes: 1, yours: true }]);
    expect(member(office.cast(11.6), 'frontend-engineer').body.pose).toBe('rest');
    office.show(12, (v) => {
      desk(v, 'frontend-engineer', { state: 'working', since: at(12) });
      (v.messages[0] as Message).deliveredAt = at(12);
    });
    expect(member(office.cast(12.2), 'frontend-engineer').body.pose).toBe('nod');
  });
});

describe('night', () => {
  const rest = (t: number) => (v: CompanyView) => {
    v.pause = { reason: 'usage-limit', since: at(t), until: at(t + 3600), message: 'Resting until 10:00, when your plan’s limit resets.' };
  };

  it('dims the light over 2.5 s and lays heads on arms, staggered, with the front desk lamp on', () => {
    const office = new Office(cafe(), 0).show(10, rest(10));
    const falling = office.cast(10 + NIGHT_FALL_MS / 2000);
    expect(falling.moments.night).toBeCloseTo(0.5, 2);
    expect(falling.night).toEqual({ from: 0, to: 1, at: at(10), ms: NIGHT_FALL_MS });
    const dark = office.cast(20);
    expect(dark.moments.night).toBe(1);
    for (const m of dark.members) {
      expect(m.body.pose).toBe('sleep');
      expect(m.body.since).toBeGreaterThanOrEqual(at(10));
      expect(m.body.since).toBeLessThanOrEqual(at(10) + HEAD_STAGGER_MS);
    }
    expect(dark.props?.frontDesk?.lit).toBe(true);
    expect(dark.tier).toBe('still');
  });

  it('lets walks under way finish within 6 s and starts none at night, though notes still land', () => {
    const office = new Office(cafe(), 0).show(9, (v) => v.messages.push(message('m-1', 'head-of-engineering', 'qa-engineer', 'Check the cart', 9)));
    office.show(10, rest(10));
    for (const m of office.cast(10).members) for (const l of m.walk) expect(l.at + l.ms).toBeLessThanOrEqual(at(10) + NIGHT_GRACE_MS);
    office.show(12, (v) => v.messages.push(message('m-2', 'head-of-design', 'ui-designer', 'Darker', 12)));
    const cast = office.cast(12);
    expect(member(cast, 'head-of-design').walk).toEqual([]);
    expect(cast.moments.trays.some((t) => t.person === 'ui-designer')).toBe(true);
  });

  it('falls at once with reduced motion, and isn\'t replayed for an office opened at night', () => {
    expect(new Office(cafe(), 0).show(10, rest(10)).cast(10, { reducedMotion: true }).moments.night).toBe(1);
    const view = cafe();
    rest(0)(view);
    const opened = new Office(view, 10).cast(10);
    expect(opened.moments.night).toBe(1);
    expect(opened.night?.at).toBeLessThanOrEqual(at(0) - NIGHT_FALL_MS);
  });

  it('brings the morning when the company resumes, not at a time of day: the light rises and heads lift', () => {
    const office = new Office(cafe(), 0).show(10, rest(10));
    office.show(40, (v) => {
      v.pause = null;
      v.log.push({ at: at(40), kind: 'wake', by: 'office', text: 'The company woke up.' });
    });
    const morning = office.cast(41);
    expect(morning.night).toEqual({ from: 1, to: 0, at: at(40), ms: NIGHT_FALL_MS });
    expect(morning.moments.night).toBeCloseTo(1 - 1 / 2.5, 2);
    const ada = member(morning, 'head-of-design');
    expect(ada.body.pose).toBe('rest');
    expect(ada.body.since).toBeGreaterThanOrEqual(at(40));
  });

  it('drops to still once every head is down, the last head settling being the next change it waits for', () => {
    const office = new Office(cafe(), 0).show(10, rest(10));
    const lastHead = Math.max(...office.cast(10).members.map((m) => m.body.since)) + HEAD_DOWN_MS;
    expect(lastHead).toBeGreaterThan(at(10) + NIGHT_FALL_MS);
    const { cast, steps } = untilStill(office, 10);
    expect(cast.tier).toBe('still');
    expect(steps.at(-1)).toBe(lastHead);
    expect(cast.nextChangeAt).toBeNull();
  });

  it("doesn't fall for a pause you made: people just rest at their desks", () => {
    const office = new Office(cafe(), 0).show(10, (v) => {
      v.pause = { reason: 'stakeholder', since: at(10), until: null, message: 'You paused work.' };
    });
    expect(office.cast(20).moments.night).toBe(0);
    expect(member(office.cast(20), 'head-of-design').body.pose).toBe('rest');
  });
});

describe('an office opened mid-session', () => {
  it('replays no walk for a relay seen more than 5 s late', () => {
    const view = cafe();
    view.messages.push(message('m-1', 'head-of-design', 'ui-designer', 'Darker', 0));
    const cast = new Office(view, 10).cast(10);
    expect(walking(cast)).toEqual([]);
    expect(cast.moments.trays).toEqual([{ person: 'ui-designer', notes: 1, yours: false }]);
  });

  it('casts the same before and after the snapshot is noted, so nothing jumps', () => {
    const office = new Office(cafe(), 0);
    const next = structuredClone(office.view);
    next.messages.push(message('m-1', 'ceo', 'head-of-design', 'Darker', 10, { origin: STAKEHOLDER }));
    const layout = computeLayout(studioOf(next), office.layout.office?.places ?? null);
    const snapshot = demoSnapshot(next, 'C:\\cafe', at(10));
    const before = castFrom(snapshot, layout, { now: at(10), seen: office.seen });
    office.seen.note(snapshot, layout);
    const after = castFrom(snapshot, layout, { now: at(10), seen: office.seen });
    expect(member(after, 'ceo').walk).toEqual(member(before, 'ceo').walk);
    expect(member(after, 'ceo').walk).not.toEqual([]);
    expect(castFrom(snapshot, layout, { now: at(12), seen: office.seen }).members.map((m) => m.walk)).toEqual(
      castFrom(snapshot, layout, { now: at(12), seen: office.seen }).members.map((m) => m.walk),
    );
  });
});
