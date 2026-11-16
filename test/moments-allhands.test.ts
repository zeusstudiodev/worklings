// The all-hands (SPEC-v3.md, "Steering", item 2 and AC17): your message to everyone gathers people in the meeting room,
// facing one point, for ALL_HANDS_MS, then they walk back; with reduced motion it's a cut. A message to a room gathers
// nobody: the room nods in place. Watched the way the browser watches: each snapshot noted as it arrives, cast between.
import { defaultSettings } from '../src/core/company-state.ts';
import { describe, expect, it } from 'vitest';
import { type Approval, type CompanyView, type DeskView, type Message, type PersonView, STAKEHOLDER } from '../src/core/company.ts';
import { demoSnapshot, studioOf } from '../src/core/demo-company.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import { ALL_HANDS_MS, type Audience } from '../src/core/steering.ts';
import type { Level, OfficeRoom } from '../src/core/studio.ts';
import { BUBBLE_CHARS, BUBBLE_CHARS_NARROW, type Cast, type CastMember, castFrom, type CastOptions, cut, gazeAt, SeenLog } from '../web/src/scene/cast.ts';
import { computeLayout, type Layout, type Point } from '../web/src/scene/layout.ts';
import { CLAP_MS, FIRST_WAIT_MS, FROM_SHOWN_MS, GATHER_WAVE_MS, GATHER_WAVES, NIGHT_GRACE_MS, NOD_MS, ROOM_NOD_STAGGER_MS, STAND_UP_MS } from '../web/src/scene/moments.ts';
import type { Leg } from '../web/src/scene/walk.ts';

const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);
/** Seconds into the morning, on the snapshot clock. */
const at = (s: number) => T0 + Math.round(s * 1000);
const secondsOf = (t: number) => (t - T0) / 1000;

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

/** Café Lumen grown to `size` people in four rooms under four heads, everyone idle at their desk. */
function cafe(size = 11): CompanyView {
  const people = [
    person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null),
    person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo'),
    person('head-of-engineering', 'Theo', 'Head of engineering', 'head', 'engineering', 'ceo'),
    person('head-of-content', 'Clara', 'Head of content', 'head', 'content', 'ceo'),
    person('head-of-quality', 'Ravi', 'Head of quality', 'head', 'quality', 'ceo'),
  ];
  const rooms = ['design', 'engineering', 'content', 'quality'];
  for (let i = 0; people.length < size; i++) {
    const room = rooms[i % rooms.length] ?? 'engineering';
    people.push(person(`${room}-${i}`, `Person ${i}`, `${room} worker ${i}`, 'worker', room, `head-of-${room}`));
  }
  return {
    id: 'cafe', name: 'Café Lumen', phase: 'running', prompt: 'A café website', stakeholder: 'Alex', branch: null, theme: 'cafe', rooms: ROOMS, goal: null, people,
    proposal: null, tasks: [], messages: [], questions: [], approvals: [], statuses: [], reports: [], dashboards: [], screenshots: [],
    spend: { samples: [], hourly: [], byPerson: [] }, log: [], pause: null,
    settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [] }, desks: { working: 0, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: null, problem: null }, inbox: 0, seen: {}, proposalEdited: false, problem: null,
  };
}

const EVERYONE = (group: string): Audience => ({ kind: 'everyone', id: null, title: 'everyone', group });
const message = (id: string, from: string, to: string, text: string, t: number, extra: Partial<Message> = {}): Message => ({
  id, from, to, text, origin: null, relayOf: null, note: null, at: at(t), deliveredAt: null, interrupt: false, ...extra,
});

/** Your message to everyone at `t` seconds: one copy per person, each naming the audience, one group. */
const toEveryone = (group: string, t: number, text = 'Thank you all: the menu is live') => (v: CompanyView) => {
  v.people.forEach((p, i) => v.messages.push(message(`m-${group}-${i}`, STAKEHOLDER, p.id, text, t, { audience: EVERYONE(group), deliveredHow: 'new-turn' })));
};
/** Your message to a room at `t` seconds: one copy for each of its people. */
const toRoom = (room: string, group: string, t: number, text = 'Keep the hand-drawn feel') => (v: CompanyView) => {
  v.people.filter((p) => p.room === room).forEach((p, i) => v.messages.push(message(`m-${group}-${i}`, STAKEHOLDER, p.id, text, t, { audience: { kind: 'room', id: room, title: `the ${room} room`, group } })));
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
const near = (a: Point | undefined, b: Point, by = 1e-6) => a !== undefined && Math.hypot(a.x - b.x, a.z - b.z) < by;
const end = (leg: Leg | undefined) => leg?.path.at(-1);
const arrival = (leg: Leg | undefined) => (leg ? leg.at + leg.ms : Number.NaN);
/** The cast at each moment it changes on its own, from `t` until it holds still or nothing more is scheduled. */
function watch(office: Office, t: number, options: CastOptions = {}): { at: number; cast: Cast }[] {
  const out = [{ at: at(t), cast: office.cast(t, options) }];
  for (let next = out[0]?.cast.nextChangeAt ?? null; next !== null && out.length < 400; ) {
    const cast = office.cast(secondsOf(next), options);
    out.push({ at: next, cast });
    next = cast.nextChangeAt;
  }
  return out;
}
const bubbles = (cast: Cast) => cast.members.filter((m) => m.bubble !== null);

describe('an all-hands', () => {
  it('starts with your message: everyone stands up, the CEO at once with your words, the rest in waves', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const cast = office.cast(10);
    const mara = member(cast, 'ceo');
    expect(mara.body.pose).toBe('stand');
    expect(mara.seated).toBe(false);
    expect(mara.walk[0]?.at).toBe(at(10) + STAND_UP_MS);
    expect(mara.bubble).toEqual({ tone: 'meeting', lead: 'From you:', text: cut('Thank you all: the menu is live', BUBBLE_CHARS - 'From you: '.length), dot: null });
    for (const m of cast.members) {
      const leaves = (m.walk[0]?.at ?? Number.NaN) - STAND_UP_MS - at(10);
      expect([...Array(GATHER_WAVES).keys()].map((k) => k * GATHER_WAVE_MS)).toContain(leaves);
    }
    expect(cast.tier).toBe('motion');
  });

  it('walks everyone to a place of their own in the meeting room, the CEO in front, all facing one point there', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const cast = office.cast(10);
    const meeting = office.office.meeting;
    const gathering = office.office.gathering;
    if (!meeting) throw new Error('A meeting room');
    expect(gathering.room).toBe('meeting');
    const places = cast.members.map((m) => end(m.walk[0]));
    for (const p of places) {
      expect(gathering.spots.some((s) => near(p, s))).toBe(true);
      expect(p && p.x > meeting.x && p.x < meeting.x + meeting.w && p.z > meeting.z && p.z < meeting.z + meeting.d).toBe(true);
    }
    expect(new Set(places.map((p) => `${p?.x},${p?.z}`)).size).toBe(cast.members.length);
    expect(near(end(member(cast, 'ceo').walk[0]), gathering.spots[0] as Point)).toBe(true);
    // Gathered: standing, listening, turned to the focus.
    const lastIn = Math.max(...cast.members.map((m) => arrival(m.walk[0])));
    const gathered = office.cast(secondsOf(lastIn) + 0.5);
    for (const m of gathered.members) {
      expect(m.body.pose).toBe('listen');
      expect(m.seated).toBe(false);
      expect(gazeAt(m.gaze, lastIn + 500)).toEqual(gathering.focus);
    }
  });

  it('holds them together for ALL_HANDS_MS, then walks each back to their own desk, all sitting down together', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const cast = office.cast(10);
    const arrivals = cast.members.map((m) => arrival(m.walk[0]));
    const together = Math.min(Math.max(...arrivals), Math.min(...arrivals) + FIRST_WAIT_MS);
    for (const m of cast.members) {
      const back = m.walk[1];
      expect(back?.at).toBeGreaterThanOrEqual(together + ALL_HANDS_MS);
      expect(near(end(back), office.seatOf(m.person ?? ''))).toBe(true);
    }
    // Whoever has furthest to go leaves as the gathering ends; everyone is back at the same moment.
    expect(Math.min(...cast.members.map((m) => m.walk[1]?.at ?? Number.NaN))).toBe(together + ALL_HANDS_MS);
    expect(new Set(cast.members.map((m) => arrival(m.walk[1]))).size).toBe(1);
    const lastBack = Math.max(...cast.members.map((m) => arrival(m.walk[1])));
    const home = office.cast(secondsOf(lastBack) + 0.1);
    for (const m of home.members) {
      expect(m.body.pose).toBe('rest');
      expect(m.seated).toBe(true);
      expect(near(m, office.seatOf(m.person ?? ''))).toBe(true);
    }
  });

  it('settles back to still once everyone sits again', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const steps = watch(office, 10);
    const final = steps.at(-1)?.cast;
    expect(final?.tier).toBe('still');
    expect(final?.nextChangeAt).toBeNull();
    for (const m of final?.members ?? []) expect(m.walk).toEqual([]);
  });

  it('gathers once per message, however many copies and snapshots it comes in', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const first = office.cast(10);
    // Copies delivered, the desks opening for the turns: later snapshots plan the same walks.
    office.show(12, (v) => {
      for (const m of v.messages) m.deliveredAt = at(11);
      for (const p of v.people) p.desk = { ...p.desk, state: 'working', since: at(11) };
    });
    const later = office.cast(12);
    for (const m of first.members) expect(member(later, m.person ?? '').walk).toEqual(m.walk);
    for (const m of first.members) expect(m.walk).toHaveLength(2);
  });

  it('keeps people gathered for a second message to everyone that comes while they are there, with its words', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const once = office.cast(10);
    const firstBack = member(once, 'head-of-design').walk[1]?.at ?? 0;
    const lastIn = Math.max(...once.members.map((m) => arrival(m.walk[0])));
    const second = secondsOf(lastIn) + 2;
    office.show(second, toEveryone('g-2', second, 'And the launch is on 17 November'));
    const twice = office.cast(second);
    const ada = member(twice, 'head-of-design');
    expect(ada.walk).toHaveLength(2);
    expect(ada.walk[0]).toEqual(member(once, 'head-of-design').walk[0]);
    expect(ada.walk[1]?.at).toBeGreaterThanOrEqual(at(second) + ALL_HANDS_MS);
    expect(ada.walk[1]?.at).toBeGreaterThan(firstBack);
    expect(member(office.cast(second + 0.5), 'ceo').bubble).toMatchObject({ lead: 'From you:', text: cut('And the launch is on 17 November', BUBBLE_CHARS - 'From you: '.length) });
  });

  it('gathers again for a message to everyone after the last one is over', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    office.show(30, toEveryone('g-2', 30, 'And the launch is on 17 November'));
    const ada = member(office.cast(30), 'head-of-design');
    expect(ada.walk).toHaveLength(2);
    expect(ada.walk[0]?.at).toBeGreaterThanOrEqual(at(30));
  });

  it('brings working people too, and their bubbles wait while they are in the crowd: one voice speaks', () => {
    const view = cafe(25);
    for (const p of view.people.filter((_, i) => i % 2 === 1)) p.desk = { ...p.desk, state: 'working', since: at(-30) };
    const office = new Office(view, 0);
    expect(bubbles(office.cast(5)).length).toBeGreaterThan(5);
    office.show(10, toEveryone('g-1', 10));
    const steps = watch(office, 10);
    // Anyone still out (on their way, in the crowd, or on the way back) says nothing but the one carrying your words.
    for (const s of steps) expect(bubbles(s.cast).filter((m) => m.walk.length > 0).map((m) => m.person).filter((id) => id !== 'ceo')).toEqual([]);
    // While they are all gathered, that one bubble is the only one in the office.
    const cast = office.cast(10);
    const lastIn = Math.max(...cast.members.map((m) => arrival(m.walk[0])));
    const firstBack = Math.min(...cast.members.map((m) => m.walk[1]?.at ?? Number.POSITIVE_INFINITY));
    for (const t of [10, 10.5, secondsOf(lastIn) + 0.1, secondsOf(firstBack) - 0.1]) expect(bubbles(office.cast(t)).map((m) => m.person)).toEqual(['ceo']);
    // Back at their desks, the working ones say what they are on again.
    expect(bubbles(steps.at(-1)?.cast as Cast).length).toBeGreaterThan(5);
  });

  it('keeps the front desk waiting: someone with a paper for you stays in line', () => {
    const approval: Approval = {
      id: 'a-1', person: 'engineering-1', tool: 'Bash', summary: 'Push the work branch', detail: 'git push', kind: 'push', askedAt: at(2), expiresAt: at(900), alwaysRule: null, answer: null, withdrawn: null,
    };
    const office = new Office(cafe(), 0).show(2, (v) => v.approvals.push(approval)).show(10, toEveryone('g-1', 10));
    const cast = office.cast(10.5);
    const waiter = member(cast, 'engineering-1');
    expect(waiter.walk.every((l) => l.at < at(10))).toBe(true);
    expect(near(waiter, office.office.reception.frontDesk.places[0] as Point)).toBe(true);
    expect(member(office.cast(15), 'engineering-1').body.pose).toBe('wait');
    expect(member(cast, 'engineering-5').walk.length).toBe(2);
  });

  it('lets a celebration finish: who is clapping claps on and stays', () => {
    const office = new Office(cafe(), 0).show(1, (v) => {
      v.goal = {
        text: 'Pickup orders', setAt: at(-3600), milestones: [
          { id: 'ms-1', title: 'Menu live', doneWhen: 'Menu reads well', doneAt: null },
          { id: 'ms-2', title: 'Pickup orders', doneWhen: 'Orders work', doneAt: null },
        ],
      };
      v.tasks.push({
        id: 't-1', title: 'Menu page', brief: '', owner: 'engineering-1', askedBy: 'head-of-engineering', files: [], doneWhen: '', status: 'done', outcome: null, parent: null,
        milestone: 'ms-1', worktree: null, commit: null, createdAt: at(-3000), updatedAt: at(-10),
      });
    });
    office.show(10, (v) => {
      const ms = v.goal?.milestones[0];
      if (ms) ms.doneAt = at(10);
    });
    office.show(11, toEveryone('g-1', 11));
    const cast = office.cast(11.2);
    const clapper = member(cast, 'engineering-1');
    expect(clapper.body.pose).toBe('clap');
    expect(clapper.walk).toEqual([]);
    expect(member(office.cast(10 + (STAND_UP_MS + CLAP_MS) / 1000 + 0.2), 'engineering-1').body.pose).toBe('rest');
    expect(member(cast, 'design-0').walk).toHaveLength(2);
  });

  it('lets someone on their first day finish walking in with their plant', () => {
    const office = new Office(cafe(), 0).show(9, (v) => {
      v.people.push(person('brand-designer', 'Pia', 'Brand designer', 'worker', 'design', 'head-of-design', { state: 'closed', sessionId: null }));
      v.log.push({ at: at(9), kind: 'hire', by: 'ceo', text: 'The CEO hired Pia, brand designer.' });
    });
    office.show(10, toEveryone('g-1', 10));
    const pia = member(office.cast(10), 'brand-designer');
    expect(pia.body.holding).toBe('plant');
    expect(near(end(pia.walk.at(-1)), office.seatOf('brand-designer'))).toBe(true);
    expect(pia.walk).toHaveLength(1);
  });

  it('stops someone walking a note over where they are, and takes them to the gathering from there', () => {
    const office = new Office(cafe(), 0).show(8, (v) => v.messages.push(message('m-1', 'head-of-design', 'design-0', 'Darker palette', 8)));
    const [there] = member(office.cast(8), 'head-of-design').walk;
    if (!there) throw new Error('Ada walks over');
    office.show(9.5, toEveryone('g-1', 9.5));
    const ada = member(office.cast(9.5), 'head-of-design');
    const toGathering = ada.walk.find((l) => office.office.gathering.spots.some((s) => near(end(l), s)));
    expect(toGathering).toBeDefined();
    expect(near(toGathering?.path[0], office.seatOf('head-of-design'))).toBe(false);
    expect(ada.walk.some((l) => near(end(l), office.office.byPerson.get('design-0')?.visitor as Point) && l.at + l.ms > at(9.5))).toBe(false);
    // The note lands in the tray when the walk stops.
    expect(office.cast(10).moments.trays.some((t) => t.person === 'design-0')).toBe(true);
  });

  it('is a cut with reduced motion: they are at their places at once, facing the point, then back', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const gathering = office.office.gathering;
    const cut = office.cast(10.2, { reducedMotion: true });
    expect(cut.tier).toBe('still');
    for (const m of cut.members) {
      expect(m.walk).toEqual([]);
      expect(gathering.spots.some((s) => near(m, s))).toBe(true);
      expect(m.body.pose).toBe('listen');
      expect(m.seated).toBe(false);
      expect(gazeAt(m.gaze, at(10.2))).toEqual(gathering.focus);
    }
    expect(near(member(cut, 'ceo'), gathering.spots[0] as Point)).toBe(true);
    expect(bubbles(cut).map((m) => m.person)).toEqual(['ceo']);
    // The browser casts again when the gathering ends, with nothing moving in between.
    const steps = watch(office, 10.2, { reducedMotion: true });
    expect(steps.map((s) => s.at)).toContain(at(10) + ALL_HANDS_MS);
    for (const s of steps) expect(s.cast.tier).toBe('still');
    const back = office.cast(10 + ALL_HANDS_MS / 1000, { reducedMotion: true });
    for (const m of back.members) {
      expect(m.walk).toEqual([]);
      expect(near(m, office.seatOf(m.person ?? ''))).toBe(true);
      expect(m.seated).toBe(true);
    }
    expect(bubbles(back)).toEqual([]);
  });

  it('replays nothing seen late: an office opened after the message shows people at their desks', () => {
    const view = cafe();
    toEveryone('g-1', 0)(view);
    const cast = new Office(view, 10).cast(10);
    for (const m of cast.members) {
      expect(m.walk).toEqual([]);
      expect(near(m, new Office(view, 10).seatOf(m.person ?? ''))).toBe(true);
    }
  });

  it('gathers in reception, clear of the front desk line, when there is no meeting room', () => {
    const view = cafe();
    view.rooms = ROOMS.filter((r) => r.kind !== 'meeting');
    const office = new Office(view, 0).show(10, toEveryone('g-1', 10));
    const reception = office.office.reception;
    expect(office.office.gathering.room).toBe(reception.id);
    for (const m of office.cast(10).members) {
      const p = end(m.walk[0]);
      expect(p && p.x > reception.x && p.x < reception.x + reception.w && p.z > reception.z && p.z < reception.z + reception.d).toBe(true);
      for (const place of reception.frontDesk.places) expect(near(p, place, 0.8)).toBe(false);
    }
  });
});

describe('an all-hands and night', () => {
  const rest = (t: number) => (v: CompanyView) => {
    v.pause = { reason: 'usage-limit', since: at(t), until: at(t + 3600), message: 'Resting until 10:00, when your plan’s limit resets.' };
  };

  it('gathers nobody at night: they sleep on, and the notes wait in their trays', () => {
    const office = new Office(cafe(), 0).show(5, rest(5)).show(10, toEveryone('g-1', 10));
    const cast = office.cast(10.5);
    for (const m of cast.members) {
      expect(m.walk).toEqual([]);
      expect(m.body.pose).toBe('sleep');
    }
    expect(cast.moments.trays.length).toBe(cast.members.length);
  });

  it('sends everyone back at once when night falls during the gathering, all seated within the grace', () => {
    const office = new Office(cafe(), 0).show(10, toEveryone('g-1', 10));
    const lastIn = Math.max(...office.cast(10).members.map((m) => arrival(m.walk[0])));
    const dusk = secondsOf(lastIn) + 1;
    office.show(dusk, rest(dusk));
    const cast = office.cast(dusk);
    for (const m of cast.members) {
      const back = m.walk[1];
      expect(back?.at).toBe(at(dusk));
      expect(arrival(back)).toBeLessThanOrEqual(at(dusk) + NIGHT_GRACE_MS);
      expect(near(end(back), office.seatOf(m.person ?? ''))).toBe(true);
    }
    const asleep = office.cast(dusk + NIGHT_GRACE_MS / 1000 + 2);
    for (const m of asleep.members) {
      expect(m.body.pose).toBe('sleep');
      expect(m.seated).toBe(true);
    }
  });
});

describe('a message to a room', () => {
  it('gathers nobody: the room nods in place, together, and the other rooms carry on', () => {
    const office = new Office(cafe(), 0).show(10, toRoom('design', 'g-1', 10));
    const cast = office.cast(10.05);
    expect(cast.members.every((m) => m.walk.length === 0)).toBe(true);
    const design = cast.members.filter((m) => m.room === 'design').map((m) => m.person ?? '');
    expect(design.length).toBeGreaterThan(1);
    for (const id of design) {
      const nods = [0, 1, 2].some((k) => {
        const t = 10 + (k * ROOM_NOD_STAGGER_MS) / 1000 + 0.05;
        const m = member(office.cast(t), id);
        return m.body.pose === 'nod' && m.seated;
      });
      expect(nods).toBe(true);
    }
    expect(member(cast, 'engineering-1').body.pose).toBe('rest');
    for (const id of design) expect(member(office.cast(10 + (2 * ROOM_NOD_STAGGER_MS + NOD_MS) / 1000 + 0.1), id).body.pose).toBe('rest');
  });

  it('nods once: taking the note later is not a second nod', () => {
    const office = new Office(cafe(), 0).show(10, toRoom('design', 'g-1', 10));
    office.show(20, (v) => {
      for (const m of v.messages) m.deliveredAt = at(20);
    });
    for (const m of office.cast(20.2).members) expect(m.body.pose).not.toBe('nod');
  });

  it('says it once with reduced motion: one of the room carries your words, not each of them', () => {
    const office = new Office(cafe(), 0).show(10, toRoom('design', 'g-1', 10));
    const cast = office.cast(10.2, { reducedMotion: true });
    expect(bubbles(cast).map((m) => m.person)).toEqual(['head-of-design']);
    expect(member(cast, 'head-of-design').bubble).toEqual({ tone: 'meeting', lead: 'From you:', text: cut('Keep the hand-drawn feel', BUBBLE_CHARS - 'From you: '.length), dot: null });
    expect(bubbles(office.cast(10 + FROM_SHOWN_MS / 1000 + 0.1, { reducedMotion: true }))).toEqual([]);
  });
});

describe('an all-hands at scale', () => {
  for (const size of [25, 40]) {
    it(`gathers ${size} people with one bubble and a few dozen changes, on desktops and phones`, () => {
      const view = cafe(size);
      for (const p of view.people.filter((_, i) => i % 3 === 0)) p.desk = { ...p.desk, state: 'working', since: at(-30) };
      for (const narrow of [false, true]) {
        const office = new Office(view, 0).show(10, toEveryone('g-1', 10));
        const cast = office.cast(10, { narrow });
        const walking = cast.members.filter((m) => m.walk.length === 2);
        expect(walking.length).toBe(size);
        expect(new Set(walking.map((m) => `${end(m.walk[0])?.x},${end(m.walk[0])?.z}`)).size).toBe(size);
        const steps = watch(office, 10, { narrow });
        for (const s of steps) expect(bubbles(s.cast).filter((m) => m.walk.length > 0).length).toBeLessThanOrEqual(1);
        expect(member(cast, 'ceo').bubble?.text.length).toBeLessThanOrEqual((narrow ? BUBBLE_CHARS_NARROW : BUBBLE_CHARS) - 'From you: '.length);
        // Walks on a quarter-second grid: the cast changes at far fewer moments than there are people's legs.
        expect(steps.length).toBeLessThan(size * 2);
        // Back to typing at the desks: the motion tier is over.
        expect(steps.at(-1)?.cast.tier).toBe('ambient');
        for (const m of steps.at(-1)?.cast.members ?? []) expect(m.walk).toEqual([]);
      }
    });
  }

  it('cuts at 40 people too with reduced motion, every place its own', () => {
    const office = new Office(cafe(40), 0).show(10, toEveryone('g-1', 10));
    const cast = office.cast(10.1, { reducedMotion: true });
    const places = cast.members.map((m) => `${m.x},${m.z}`);
    expect(new Set(places).size).toBe(40);
    expect(bubbles(cast)).toHaveLength(1);
  });
});
