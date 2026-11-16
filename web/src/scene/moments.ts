// The 3D moments of an office that runs a company (docs/game-feel.md): someone walking over with a note, waiting at
// the front desk with a paper, clapping for a milestone, walking in on a first day or out with their plant, off duty
// in the lounge, an all-hands gathering for your message to everyone, a room nodding to yours, and night while the
// company rests. Pure TypeScript on the snapshot's clock: castFrom (cast.ts) asks planCompany for each person's walks,
// pose and bubble, and MomentLayer draws the props. Every moment starts from a state change in the snapshot; the
// MomentLog remembers what this browser saw and when, so an office opened mid-session replays nothing and a plan, once
// made, doesn't change under the people walking it.
import { type CompanyPhase, type CompanyView, type DeskState, type Message, type PersonView, STAKEHOLDER, THE_OFFICE } from '../../../src/core/company.ts';
import { countWord } from '../../../src/core/now.ts';
import type { AgentState } from '../../../src/core/office.ts';
import { ALL_HANDS_MS } from '../../../src/core/steering.ts';
import { inSentence, type Level } from '../../../src/core/studio.ts';
import type { BubbleTone, Gaze } from './cast.ts';
import type { CompanyDesk, Layout, OfficeFloor, Point, Rect, Spot, WallPiece } from './layout.ts';
import { boardFaces } from './office/plan.ts';
import { DEPARTMENT_HUE, hash } from './palette.ts';
import type { Holding, Pose, SceneMoments, Tiredness, Tray } from './poses.ts';
import { type Leg, MAX_WALK_MS, paceMs, pathLength, placeOn, route, subPath, walked } from './walk.ts';

// ---------------------------------------------------------------------------------------------------------------
// Tuning (docs/game-feel.md, by section). Tests pin the rules, not these values; tune one at a time.

// Rules for every moment
/** An event the browser first sees later than this after it happened makes nobody walk. */
export const FRESH_MS = 5000;
/** A lower moment waits this long for someone busy with a higher one, then falls back to notes and bubbles. */
export const WAIT_FOR_PERSON_MS = 5000;
/** Moments older than this can no longer change who stands where. */
export const HORIZON_MS = 30_000;
/** People out on a walk at once on desktops and on phones; two of them are kept for carrying your words. */
export const WALK_BUDGET = 6;
export const WALK_BUDGET_PHONE = 3;
export const WALK_RESERVED = 2;
/** Standing up from a chair before a walk (Sit_Chair_StandUp); sitting down after one takes the same. */
export const STAND_UP_MS = 800;
/** Walkers who would set off together leave this far apart, and wait no longer than STAGGER_MAX_MS for it. */
export const DEPART_GAP_MS = 300;
const STAGGER_MAX_MS = 2000;

// 1. Relays: walking over to tell someone
/** The sender's stand at the receiver's desk (v2's STAND_MS), and when the note goes in the tray. */
export const TALK_MS = 2500;
export const NOTE_IN_MS = 1500;
/** The Head Nod when a note is taken. */
export const NOD_MS = 800;
/** A second sender waits a step behind at most this long. */
export const BEHIND_MAX_MS = 3000;
/** Someone passing on a note still on its way to them leaves when it lands, at most this late. */
export const LATE_MAX_MS = 6000;
/** Messages from one sender this close together go out as one round. */
export const BURST_MS = 2000;
/** A round's stops: how long at each, how many, and how long the round may take. */
export const ROUND_STOP_MS = 1500;
export const ROUND_STOPS = 4;
export const ROUND_MAX_MS = 15_000;
/** Without a walk: "Sent notes to five people" shows this long, a report's words this long (v2's DONE_SHOWN_MS). */
export const SENT_NOTES_MS = 2500;
export const REPORT_SHOWN_MS = 8000;
/** With reduced motion the receiver's bubble says "From Ada: …" this long. */
export const FROM_SHOWN_MS = 4000;
/** Papers a tray shows before they become a thicker stack. */
export const TRAY_PAPERS = 3;
/** How far a receiver turns to whoever stands at their desk: the head while working, the chair while idle. */
export const HEAD_TURN_MAX = Math.PI / 3;
export const CHAIR_TURN_MAX = Math.PI / 4;

// 2. The front desk
export const FRONT_DESK_PLACES = 6;
/** Bubbles show for the three at the counter, none for the row behind. */
export const COUNTER_BUBBLES = 3;
/** An answered paper flips to white this fast; the line steps up this long a place. */
export const PAPER_FLIP_MS = 250;
export const STEP_UP_MS = 500;

// 3. A milestone's small celebration
export const STREAMER_MS = 1600;
export const STREAMERS = 24;
export const LAST_STREAMERS = 48;
/** Clapping after standing up, or an idle CEO's Victory Fist Pump; they sit down after. */
export const CLAP_MS = 2000;
export const CHEER_MS = 2200;
export const CELEBRATION_GAP_MS = 20_000;
export const CARD_FLIP_MS = 400;
export const PHONE_CLAPPERS = 6;

// 4. Tiredness, and night
/** Context used at which a desk gets its first, second and third cup. */
export const TIRED_AT = [0.5, 0.75, 0.9] as const;
/** The takeaway cup drawn this much larger than its shape (0.12 wide, 0.17 tall), about 1.5 times life size. */
export const CUP_SCALE = 1.4;
export const NIGHT_FALL_MS = 2500;
/** Walks under way when night falls finish within this long. */
export const NIGHT_GRACE_MS = 6000;
/** Heads go down on folded arms (1.2 s) and come up again (0.8 s), staggered up to 1.5 s. */
export const HEAD_DOWN_MS = 1200;
export const HEAD_UP_MS = 800;
export const HEAD_STAGGER_MS = 1500;

// 6. Hiring and firing, the CEO's office, the meeting room
export const ARRIVE_GAP_MS = 700;
/** Setting the plant on the desk (Interact), picking it up (PickUp_Table), waving at the door, fading at the edge. */
export const INTERACT_MS = 1300;
export const PICKUP_MS = 1000;
export const WAVE_MS = 1200;
export const FADE_MS = 400;
/** Phones fade a starting company in room by room, this far apart. */
export const PHONE_FADE_GAP_MS = 150;
/** A meeting: listening this long from the last arrival, or from this long after the first if sooner. */
export const LISTEN_MS = 4000;
export const FIRST_WAIT_MS = 3000;
export const MEETING_MAX = 6;
/** The CEO draws a box on the board this often while drafting, up to eight. */
export const BOARD_BOX_MS = 3000;
export const BOARD_BOXES = 8;
export const PIN_POP_MS = 300;
/** A room builds in: its floor, then its walls, then its furniture a piece at a time; rooms start this far apart. */
export const BUILD_FLOOR_MS = 300;
export const BUILD_WALLS_MS = 300;
export const BUILD_PIECE_MS = 60;
export const BUILD_ROOM_GAP_MS = 150;
/** About this many pieces of furniture build in per room before people arrive. */
const BUILD_PIECES = 6;
/** A new desk drops in (with a squash on landing and six dust puffs); a room taken out lifts and lowers away. */
export const DESK_DROP_MS = 400;
export const ROOM_OUT_MS = 2000;
/** The office manager stands by a room being built this long. */
export const STAND_BY_MS = 2500;

// Steering (SPEC-v3.md): an all-hands gathers people for ALL_HANDS_MS (src/core/steering.ts); a room nods to your words
/** People stand up for an all-hands in this many waves this far apart, so a room doesn't rise as one. */
export const GATHER_WAVES = 3;
export const GATHER_WAVE_MS = 250;
/**
 * Walks to and from an all-hands last a whole number of these, and the waves leave on it, so arrivals fall together:
 * at 40 people the cast changes a few dozen times, not a few hundred.
 */
export const GATHER_GRID_MS = 250;
/** The most an all-hands takes to gather: standing up, the last wave, the longest walk. */
const GATHER_MAX_MS = STAND_UP_MS + (GATHER_WAVES - 1) * GATHER_WAVE_MS + MAX_WALK_MS;
/** People in a room your message went to nod in place, this far apart by a stable hash, in three steps. */
export const ROOM_NOD_STAGGER_MS = 150;

// 7. Idle and busy
/** A working person with no step running this long thinks, chin on hand. */
export const THINK_AFTER_MS = 4000;
/** After a Stop they sit back and look toward the camera this long. */
export const LOOK_MS = 1500;

/** How long the browser remembers people who left, desks they had and lounge seats given up. */
const MEMORY_MS = HORIZON_MS * 2;
/** v2's lead gold: the CEO's blazer, and the CEO's pin. */
const CEO_GOLD = '#C9B458';

// ---------------------------------------------------------------------------------------------------------------
// What the cast gets back

/** A moment's bubble, before the cast cuts it to one line. `sentence`: only its first sentence (a report). */
export interface BubbleSpec {
  tone: BubbleTone;
  lead: string | null;
  text: string;
  sentence?: boolean;
}

export interface PersonPlan {
  id: string;
  /** Their person: the latest the office saw, so someone leaving still has one. */
  view: PersonView;
  /** Where they are when not on one of `legs`. */
  home: Point;
  legs: Leg[];
  gaze: Gaze[];
  pose: Pose;
  holding: Holding;
  since: number;
  /** On a chair (a desk, a lounge seat), whatever the pose: a nod at the desk is seated, one at the front desk isn't. */
  seated: boolean;
  tired: Tiredness;
  /** A moment's words now, over whatever their state would say. */
  bubble: BubbleSpec | null;
  /** Part of a crowd that speaks with one voice (an all-hands): their state's words wait until they are back. */
  hushed: boolean;
  /** Shown from (fading in at the model's edge) and until (fading out there); null for always. */
  presence: { from: number | null; until: number | null };
  /** Their place in the front desk's line, 0 first: at a place below six, at their own desk from six. */
  inLine: number | null;
  /** Papers in hand at the front desk: one per open question or approval (a thicker stack for several). */
  papers: number;
  /** Out on a moment, or anywhere but their desk. */
  away: boolean;
  /** Where they belong for label stacking: their walk's stop, or home. */
  belongs: Point;
  /** Which way they face at rest where they are (a desk, a lounge seat, the board, a front desk place); `gaze` turns them while standing. */
  facing: number;
}

/** The light over the scene: from one level to another, starting `at`, over `ms` (0 with reduced motion). */
export interface NightRamp {
  from: number;
  to: number;
  at: number;
  ms: number;
}

/** What MomentLayer draws: the things the moments add that aren't people, already placed. */
export interface MomentProps {
  /** Notes in trays: a paper each up to three; the top one is a thicker stack when more wait. */
  papers: { person: string; x: number; z: number; yours: boolean; index: number; stack: boolean }[];
  /** Takeaway cups on a long day. */
  cups: { x: number; z: number; index: number }[];
  /** First-day plants on desks, in a pot of the room's hue, set down at `since`. */
  plants: { x: number; z: number; hue: string; since: number }[];
  /** The front desk's sign and lamp; the lamp is on while someone waits, and all night. */
  frontDesk: { sign: Point; lamp: Point; lit: boolean; waiting: number } | null;
  /**
   * Milestone cards on the meeting room's board, `z` its face; a card flips to done at `flippedAt` (null: shown done at
   * once).
   */
  cards: { x: number; y: number; z: number; w: number; h: number; done: boolean; flippedAt: number | null }[];
  /** A pin per person on the CEO's org board, in their room's hue, by level; popping in at `since`, out at `until`. */
  pins: { x: number; y: number; z: number; hue: string; since: number; until: number | null }[];
  /** The boxes the CEO draws on the board while drafting the org, each from `since`; `z` is the board's face. */
  boxes: { x: number; y: number; z: number; w: number; h: number; since: number }[];
  /** Paper streamers falling from the milestone board, whose face is at `face`, from `at` for STREAMER_MS. */
  streamers: { at: number; count: number; hues: string[]; from: WallPiece; face: number } | null;
  /** Rooms building in from `at`: the floor, the walls BUILD_FLOOR_MS later, the furniture BUILD_PIECE_MS apart after. */
  built: { room: string; at: number }[];
  /** Rooms taken out from `at`, where they stood: their furniture lifts and their floor lowers over ROOM_OUT_MS. */
  gone: { room: string; x: number; z: number; w: number; d: number; at: number }[];
  /** New desks landing at `at` after a DESK_DROP_MS fall: a squash, and six dust puffs. */
  drops: { x: number; z: number; at: number }[];
}

export interface CompanyPlan {
  people: PersonPlan[];
  moments: SceneMoments;
  props: MomentProps;
  night: NightRamp | null;
  /** Moments on the snapshot clock when something changes on its own. */
  changes: number[];
  /** Still: nothing animates. Ambient: people at work at their desks. Motion: walks, transitions, celebrations. */
  tier: 'still' | 'ambient' | 'motion';
}

/** The parts of a snapshot the moments read. */
export interface MomentSnapshot {
  company?: CompanyView | null;
  agents: readonly AgentState[];
  serverTime: number;
}

export interface MomentOptions {
  now: number;
  /** People may walk: no reduced motion, no replay faster than 4x. */
  motion: boolean;
  reduced: boolean;
  narrow: boolean;
  /** People out walking at once (the governor lowers it). */
  budget: number;
  /** A click on the stage, or Escape, at this moment seats everyone still arriving. */
  skipAt: number | null;
}

// ---------------------------------------------------------------------------------------------------------------
// What this browser saw, and when

interface Presence {
  /** When it happened as far as the office can tell: the hire's or the firing's line in the log, else when seen. */
  at: number;
  present: boolean;
  seen: number;
}

interface DeskSeen {
  state: DeskState;
  /** When this state began as far as the browser can tell: the desk's own `since`, unless older than the last look. */
  at: number;
  seen: number;
  worked: boolean;
}

interface PersonMemory {
  view: PersonView;
  desk: CompanyDesk | null;
  presence: Presence[];
  desks: DeskSeen[];
}

interface NightSeen {
  from: number;
  seen: number;
  until: number | null;
  untilSeen: number | null;
}

interface LoungeSeen {
  /** The rest room and the seat in it, and where that seat was, so someone in a room taken out walks back from it. */
  room: string;
  seat: number;
  spot: Spot;
  from: number;
  fromSeen: number;
  until: number | null;
  untilSeen: number | null;
}

/** The browser's memory as of one snapshot. Plain data, never changed once made. */
export interface Recall {
  company: string | null;
  /** The last snapshot noted; −∞ before the first. */
  latest: number;
  /** When the first snapshot was noted: what it showed was already so. */
  first: number;
  /** When each message, question, answer, withdrawal and finished milestone was first seen, by key. */
  seen: ReadonlyMap<string, number>;
  people: ReadonlyMap<string, PersonMemory>;
  /** Decisions held to what was so when something was first seen: who was idle for a meeting or a celebration. */
  facts: ReadonlyMap<string, readonly string[]>;
  /** Lounge seats, by person: taken, or given up within the memory. */
  lounge: ReadonlyMap<string, LoungeSeen>;
  /** Rooms by id: when first seen (−∞ when the office opened with them), where they stand, and when taken out. */
  rooms: ReadonlyMap<string, { first: number; rect: Rect; gone: number | null }>;
  /** Desks by room and slot: when first seen, and where. */
  desks: ReadonlyMap<string, { first: number; x: number; z: number; room: string }>;
  nights: readonly NightSeen[];
  phase: { phase: CompanyPhase; seen: number } | null;
  /** The CEO's proposal waiting for your OK: since when, and until when. */
  proposal: { since: number; seen: number; until: number | null; untilSeen: number | null } | null;
  /** While founding, the CEO's drafting at the board: drafts turned down and stops, as this browser saw them. */
  drafting: DraftingSeen;
}

interface DraftingSeen {
  /** Drafts turned down so far, and when the latest was seen (−∞ when the office opened on it: no wipe replayed). */
  refused: number;
  refusedAt: number;
  /** Turns that ended without a proposal: from the stop until a message reached the CEO (null while it waits). */
  stops: readonly { from: number; until: number | null }[];
}

const NO_DRAFTING: DraftingSeen = { refused: 0, refusedAt: Number.NEGATIVE_INFINITY, stops: [] };

const EMPTY: Recall = {
  company: null, latest: Number.NEGATIVE_INFINITY, first: Number.NEGATIVE_INFINITY, seen: new Map(), people: new Map(), facts: new Map(),
  lounge: new Map(), rooms: new Map(), desks: new Map(), nights: [], phase: null, proposal: null, drafting: NO_DRAFTING,
};

/** The pauses that are night: the company rests on a usage limit or an overload. Paused by you isn't. */
export const NIGHT_REASONS: ReadonlySet<string> = new Set(['usage-limit', 'overloaded']);
const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

/** The time of the newest log line of these kinds within 10 s before `seen`, else `seen`. */
function loggedAt(company: CompanyView, kinds: readonly string[], seen: number): number {
  let best: number | null = null;
  for (const e of company.log) if (kinds.includes(e.kind) && e.at <= seen && e.at >= seen - 10_000 && (best === null || e.at > best)) best = e.at;
  return best ?? seen;
}

/** Off duty after working: a desk closed with a session, seen closing or closed when the office opened. */
function offDuty(desks: readonly DeskSeen[], fromFirstLook: boolean): boolean {
  const now = last(desks);
  if (!now || now.state !== 'closed' || !now.worked) return false;
  return desks.length > 1 || fromFirstLook;
}

/** Every seat in the lounges, kitchens and games rooms, room by room. */
const loungeSeats = (office: OfficeFloor | undefined): { room: string; seat: number; spot: Spot }[] =>
  office?.rest.flatMap((r) => r.seats.map((spot, seat) => ({ room: r.id, seat, spot }))) ?? [];

/** The rooms of a company's floor, departments' and the office's own. */
const roomsOf = (layout: Layout, office: OfficeFloor): (Rect & { id: string })[] => [...layout.rooms, office.ceo, office.reception, ...(office.meeting ? [office.meeting] : []), ...office.rest];

/** Idle enough to stand up for a meeting or a celebration: no turn running. */
const idleDesk = (p: PersonView): boolean => p.desk.state === 'idle' || p.desk.state === 'closed';

/**
 * The way to a place at an all-hands: to the gathering room's door, then to the place. Both parts are shared (every
 * walker passes the door) and cached by `route`, so the office can work them out while idle (`gatheringRoutes`) and a
 * message to everyone costs a frame nothing to plan.
 */
export function gatheringPath(layout: Layout, from: Point, to: Point): Point[] | null {
  const door = layout.office?.gathering.door;
  if (!door) return route(layout, from, to);
  const toDoor = route(layout, from, door);
  const inside = route(layout, door, to);
  return toDoor && inside ? [...toDoor, ...inside.slice(1)] : null;
}

/** Every part of the ways an all-hands can take: each seat to the gathering room's door, the door to each place. */
export function gatheringRoutes(layout: Layout): [Point, Point][] {
  const office = layout.office;
  if (!office) return [];
  const { door, spots } = office.gathering;
  const seats = [...office.desks.map((d) => d.seat), ...office.rest.flatMap((r) => r.seats)];
  return [...seats.map((s): [Point, Point] => [s, door]), ...spots.map((s): [Point, Point] => [door, s])];
}

/** The group of the stakeholder's message to everyone this is a copy of: an all-hands. */
const allHandsOf = (m: Message): string | null => (m.from === STAKEHOLDER && m.audience?.kind === 'everyone' ? m.audience.group : null);
/** The group of the stakeholder's message to a room or a team this is a copy of: nobody gathers for it. */
const roomOf = (m: Message): string | null => (m.from === STAKEHOLDER && m.audience && m.audience.kind !== 'everyone' ? m.audience.group : null);

/**
 * Lounge seats: whoever has one keeps it while their room stands; newcomers in the order they came take the seat
 * their id hashes to, or the next free one. Nobody moves when someone else leaves.
 */
function seatLounge(before: ReadonlyMap<string, LoungeSeen>, off: readonly { id: string; at: number }[], seats: readonly { room: string; seat: number; spot: Spot }[], now: number): Map<string, LoungeSeen> {
  const out = new Map<string, LoungeSeen>();
  const going = new Map(off.map((o) => [o.id, o]));
  const key = (room: string, seat: number) => `${room}:${seat}`;
  const standing = new Set(seats.map((s) => key(s.room, s.seat)));
  const taken = new Set<string>();
  for (const [id, l] of before) {
    if (l.until === null && going.has(id) && standing.has(key(l.room, l.seat))) {
      out.set(id, l);
      taken.add(key(l.room, l.seat));
    } else if (l.until === null) {
      // Their desk reopened, or their room was taken out.
      out.set(id, { ...l, until: now, untilSeen: now });
    } else if (now - l.until < MEMORY_MS && !going.has(id)) out.set(id, l);
  }
  // Someone off duty again after leaving a lounge earlier takes a seat afresh; someone whose room just went walks back
  // to their desk first.
  for (const [id, l] of out) if (l.until !== null && l.untilSeen !== now && going.has(id)) out.delete(id);
  if (seats.length === 0) return out;
  for (const o of [...off].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
    const had = out.get(o.id);
    if (had && (had.until === null || had.untilSeen === now)) continue;
    const start = hash(o.id) % seats.length;
    for (let k = 0; k < seats.length; k++) {
      const seat = seats[(start + k) % seats.length];
      if (!seat || taken.has(key(seat.room, seat.seat))) continue;
      out.set(o.id, { room: seat.room, seat: seat.seat, spot: seat.spot, from: o.at, fromSeen: now, until: null, untilSeen: null });
      taken.add(key(seat.room, seat.seat));
      break;
    }
  }
  return out;
}

/** Keeps a history's entries within the memory, and the last one before. */
function trimmed<T extends { seen: number }>(list: readonly T[], now: number): T[] {
  const recent = list.findIndex((e) => now - e.seen < MEMORY_MS);
  if (recent <= 0) return [...list];
  return list.slice(recent - 1);
}

/** The memory after noting a snapshot: the same object back when that snapshot was noted already. */
function advance(prev: Recall, snapshot: MomentSnapshot, layout: Layout | null): Recall {
  const company = snapshot.company;
  if (!company) return prev;
  const now = snapshot.serverTime;
  const base = prev.company !== company.id || now < prev.latest ? EMPTY : prev;
  if (base.latest === now) return base;
  const looking = base.latest === Number.NEGATIVE_INFINITY;
  const first = looking ? now : base.first;

  const seen = new Map<string, number>();
  const keep = (key: string) => seen.set(key, base.seen.get(key) ?? now);
  const newMessages = new Set<string>();
  for (const m of company.messages) {
    if (!base.seen.has(`m:${m.id}`)) newMessages.add(m.id);
    keep(`m:${m.id}`);
  }
  for (const q of company.questions) {
    keep(`q:${q.id}`);
    if (q.answer) keep(`q:${q.id}:answer:${q.answer.at}`);
    if (q.withdrawn) keep(`q:${q.id}:withdrawn`);
  }
  for (const a of company.approvals) {
    keep(`a:${a.id}`);
    if (a.answer) keep(`a:${a.id}:answer:${a.answer.at}`);
    if (a.withdrawn) keep(`a:${a.id}:withdrawn`);
  }
  const doneNow = new Set<string>();
  for (const ms of company.goal?.milestones ?? []) {
    if (ms.doneAt === null) continue;
    if (!base.seen.has(`ms:${ms.id}`)) doneNow.add(ms.id);
    keep(`ms:${ms.id}`);
  }

  const people = new Map<string, PersonMemory>();
  const here = new Set(company.people.map((p) => p.id));
  for (const p of company.people) {
    const was = base.people.get(p.id);
    const desk = layout?.office?.byPerson.get(p.id) ?? was?.desk ?? null;
    let presence = was?.presence ?? [];
    if (!was) {
      presence = looking
        ? [{ at: Number.NEGATIVE_INFINITY, present: true, seen: Number.NEGATIVE_INFINITY }]
        : [{ at: loggedAt(company, ['hire', 'rehire', 'started', 'founded'], now), present: true, seen: now }];
    } else if (!last(was.presence)?.present) {
      presence = [...presence, { at: loggedAt(company, ['hire', 'rehire'], now), present: true, seen: now }];
    }
    const desks = [...(was?.desks ?? [])];
    const before = last(desks);
    if (!before || before.state !== p.desk.state) {
      // A desk's own time is right unless it is older than the last time this browser looked at that desk.
      const at = before && p.desk.since <= before.seen ? now : p.desk.since;
      desks.push({ state: p.desk.state, at, seen: now, worked: p.desk.sessionId !== null });
    }
    people.set(p.id, { view: p, desk, presence: trimmed(presence, now), desks: trimmed(desks, now) });
  }
  for (const [id, was] of base.people) {
    if (here.has(id)) continue;
    const latest = last(was.presence);
    if (latest?.present) people.set(id, { ...was, presence: trimmed([...was.presence, { at: loggedAt(company, ['fire'], now), present: false, seen: now }], now) });
    else if (latest && now - latest.seen < MEMORY_MS) people.set(id, was);
  }

  // Who was idle when each message, and each finished milestone, was first seen: meetings and claps hold to it.
  const facts = new Map<string, readonly string[]>();
  const byId = new Map(company.people.map((p) => [p.id, p]));
  for (const m of company.messages) {
    const key = `idle:${m.id}`;
    const had = base.facts.get(key);
    const to = byId.get(m.to);
    if (had) facts.set(key, had);
    else if (newMessages.has(m.id)) facts.set(key, to && idleDesk(to) ? ['idle'] : []);
  }
  for (const ms of company.goal?.milestones ?? []) {
    const key = `clap:${ms.id}`;
    const had = base.facts.get(key);
    if (had) facts.set(key, had);
    else if (doneNow.has(ms.id)) facts.set(key, company.people.filter(idleDesk).map((p) => p.id));
  }
  // Whom an all-hands reached, as first seen: a copy that shows up later doesn't move anyone already on their way.
  for (const m of company.messages) {
    const group = allHandsOf(m);
    const key = `allhands:${group}`;
    if (group === null || facts.has(key)) continue;
    const had = base.facts.get(key);
    if (had) facts.set(key, had);
    else if (newMessages.has(m.id)) facts.set(key, [...new Set(company.messages.filter((c) => allHandsOf(c) === group).map((c) => c.to))]);
  }

  const off = company.people.flatMap((p) => {
    const mem = people.get(p.id);
    const latest = mem ? last(mem.desks) : undefined;
    return mem && latest && offDuty(mem.desks, mem.presence[0]?.seen === Number.NEGATIVE_INFINITY) ? [{ id: p.id, at: latest.at }] : [];
  });
  // Without a floor plan to go by, what the office knew of rooms, desks and seats stands.
  const office = layout?.office;
  const lounge = office ? seatLounge(base.lounge, off, loungeSeats(office), now) : new Map(base.lounge);
  for (const [id, l] of lounge) {
    // Leaving the lounge happened when their desk reopened.
    if (l.until === now && base.lounge.get(id)?.until === null) {
      const reopened = last(people.get(id)?.desks ?? []);
      lounge.set(id, { ...l, until: reopened && reopened.state !== 'closed' ? reopened.at : now });
    }
  }

  const nights = [...base.nights];
  const open = last(nights);
  const resting = company.pause && NIGHT_REASONS.has(company.pause.reason) ? company.pause : null;
  if (resting && (!open || open.until !== null)) nights.push({ from: resting.since, seen: now, until: null, untilSeen: null });
  else if (!resting && open && open.until === null) nights[nights.length - 1] = { ...open, until: loggedAt(company, ['wake', 'resume'], now), untilSeen: now };

  let proposal = base.proposal;
  if (company.phase === 'proposed' && (!proposal || proposal.until !== null)) {
    const since = company.log.filter((e) => e.kind === 'proposal' || e.kind === 'proposal-edited').reduce((t, e) => Math.max(t, e.at), Number.NEGATIVE_INFINITY);
    proposal = { since: Number.isFinite(since) ? since : now, seen: now, until: null, untilSeen: null };
  } else if (company.phase !== 'proposed' && proposal && proposal.until === null) {
    proposal = { ...proposal, until: loggedAt(company, ['started', 'proposal-edited'], now), untilSeen: now };
  }

  // The drafting at the board: a draft turned down wipes it (seen now; one already turned down when the office opened
  // wipes nothing), a turn that ends without a proposal stops the pen until a message reaches the CEO.
  let drafting = base.drafting;
  const d = company.phase === 'founding' ? company.drafting : null;
  if (d) {
    const refused = d.refused > drafting.refused ? { refused: d.refused, refusedAt: looking ? Number.NEGATIVE_INFINITY : now } : {};
    const open = last(drafting.stops);
    let stops = drafting.stops;
    // A new stop while an older one looks open: the message that ended the older one came between two snapshots.
    if (d.stopped && (!open || open.until !== null || open.from !== d.stopped.at)) stops = [...stops.map((s) => (s.until === null ? { ...s, until: d.stopped?.at ?? now } : s)), { from: d.stopped.at, until: null }];
    else if (!d.stopped && open && open.until === null) stops = [...stops.slice(0, -1), { ...open, until: now }];
    if (Object.keys(refused).length > 0 || stops !== drafting.stops) drafting = { ...drafting, ...refused, stops };
  } else if (company.phase !== 'founding' && drafting !== NO_DRAFTING) drafting = NO_DRAFTING;

  let rooms = base.rooms;
  let desks = base.desks;
  if (layout && office) {
    const nextRooms = new Map<string, { first: number; rect: Rect; gone: number | null }>();
    for (const r of roomsOf(layout, office)) {
      const was = base.rooms.get(r.id);
      nextRooms.set(r.id, { first: was && was.gone === null ? was.first : looking ? Number.NEGATIVE_INFINITY : now, rect: { x: r.x, z: r.z, w: r.w, d: r.d }, gone: null });
    }
    for (const [id, was] of base.rooms) {
      if (nextRooms.has(id)) continue;
      const gone = was.gone ?? now;
      if (now - gone < MEMORY_MS) nextRooms.set(id, { ...was, gone });
    }
    rooms = nextRooms;
    const nextDesks = new Map<string, { first: number; x: number; z: number; room: string }>();
    for (const d of office.desks) {
      const key = `${d.room}:${d.slot}`;
      nextDesks.set(key, { first: base.desks.get(key)?.first ?? (looking ? Number.NEGATIVE_INFINITY : now), x: d.x, z: d.z, room: d.room });
    }
    desks = nextDesks;
  }

  return {
    company: company.id, latest: now, first, seen, people, facts, lounge, rooms, desks, nights: nights.filter((n) => n.until === null || now - n.until < MEMORY_MS),
    phase: base.phase?.phase === company.phase ? base.phase : { phase: company.phase, seen: now }, proposal, drafting,
  };
}

/**
 * What this browser has seen of a company: when each moment's cause first showed, who came and went, which desks
 * opened and closed, who was idle when. `note` keeps a snapshot; `recall` gives the memory as it would be after
 * noting one without keeping it, so the cast drawn before a snapshot is noted agrees with every cast after.
 */
export class MomentLog {
  private state: Recall = EMPTY;

  recall(snapshot: MomentSnapshot, layout: Layout | null): Recall {
    return advance(this.state, snapshot, layout);
  }

  note(snapshot: MomentSnapshot, layout: Layout | null): void {
    this.state = advance(this.state, snapshot, layout);
  }
}

/** The memory of a browser that opens the office on this snapshot. */
export const firstLook = (snapshot: MomentSnapshot, layout: Layout | null): Recall => advance(EMPTY, snapshot, layout);

// ---------------------------------------------------------------------------------------------------------------
// The plan

type HomeKind = 'desk' | 'front' | 'raised' | 'lounge' | 'board' | 'gone';

interface Home {
  kind: HomeKind;
  point: Point;
  seated: boolean;
  /** Which way they face there: radians about the vertical axis, 0 toward the camera's side (+z). */
  facing: number;
  /** The front desk place (0 first), or −1. */
  index: number;
}

/** Why someone's place changes, for the ladder (game-feel.md, "Rules for every moment"). */
type Change = 'front' | 'arrive' | 'leave' | 'away' | 'back' | 'lounge' | 'board';

interface HomeSpan {
  at: number;
  home: Home;
  /** When the browser first knew of the change: one seen more than FRESH_MS late makes nobody walk. */
  seen: number;
  change: Change;
}

interface Span {
  from: number;
  until: number;
  pose: Pose;
  seated: boolean;
}

interface Timed<T> {
  from: number;
  until: number;
  value: T;
}

interface Excursion {
  person: string;
  rank: number;
  start: number;
  end: number;
  origin: Point;
  legs: Leg[];
  spans: Span[];
  holds: Timed<Holding>[];
  bubbles: Timed<BubbleSpec>[];
  gaze: Gaze[];
  /** Notes carried: each lands in its tray when the walker puts it in, or when the walk is cut short. */
  notes: { message: string; lands: number }[];
  budget: boolean;
  reserved: boolean;
  /** The stop that matters for label stacking. */
  stop: Point | null;
  presenceFrom: number | null;
  presenceUntil: number | null;
  plantSet: number | null;
  plantUp: number | null;
  walked: boolean;
  /** Ended early by a higher moment or the night: they stand where it left them. */
  cutShort: boolean;
  /**
   * Its legs start and end without the cast changing: the renderer walks whoever moves and stands whoever stops, so only
   * its spans, bubbles, start and end ask for a new cast. An all-hands' crowd, where every change re-renders everyone.
   */
  quiet: boolean;
}

/** The ladder, highest first: 1 needs you, 2 your words, 3 reports, 4 other relays and meetings, 5 office changes, 6 celebrations, 7 ambient. */
const RANK = { front: 1, yours: 2, report: 3, relay: 4, office: 5, celebration: 6, ambient: 7 } as const;

const tiredness = (context: number | null): Tiredness => {
  const c = context ?? 0;
  return c >= TIRED_AT[2] ? 3 : c >= TIRED_AT[1] ? 2 : c >= TIRED_AT[0] ? 1 : 0;
};

const hash01 = (text: string) => (hash(text) % 1000) / 1000;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** "Ada", or "The head of design" for someone with no name: how bubbles name a sender. */
export function calledIn(p: Pick<PersonView, 'name' | 'title'>): string {
  return p.name === p.title ? `The ${inSentence(p.title)}` : p.name;
}

interface Item {
  person: string;
  asked: number;
  answered: number | null;
  /** When they leave the line for it: the answer applying, a withdrawal, the company starting; Infinity while open. */
  resolved: number;
  seenAsked: number;
  seenResolved: number;
}

/** The stakeholder's message to everyone, as one gathering: another that comes while people are gathered keeps them there. */
interface AllHands {
  /** The first copy's time: when people start for the gathering spot. */
  at: number;
  /** When this browser first saw it: seen late, nobody walks. */
  seen: number;
  /** Everyone the first message reached, as first seen. */
  people: readonly string[];
  /** The words of each message from when it was sent, the latest on show. */
  words: { at: number; text: string }[];
}

type Request =
  | { kind: 'home'; at: number; id: string; span: HomeSpan; before: Home; order: number }
  | { kind: 'burst'; at: number; from: string; messages: Message[] }
  | { kind: 'celebration'; at: number; milestone: string }
  | { kind: 'room'; at: number; room: string }
  | { kind: 'all-hands'; at: number; allHands: AllHands };

export function planCompany(snapshot: MomentSnapshot & { company: CompanyView }, layout: Layout, recall: Recall, options: MomentOptions): CompanyPlan {
  const company = snapshot.company;
  const office = layout.office;
  // Where the scenery hangs the boards, or stands them out on legs: the cards and boxes go on their faces.
  const faces = boardFaces(layout);
  const { now } = options;
  const horizon = now - HORIZON_MS;
  const changes: number[] = [];
  const seenOf = (key: string) => recall.seen.get(key) ?? now;
  const fresh = (at: number, seen: number) => seen - at <= FRESH_MS;
  const styleOf = new Map(layout.rooms.map((r) => [r.id, r.style]));
  const hueOf = (p: Pick<PersonView, 'room'>) => DEPARTMENT_HUE[styleOf.get(p.room) ?? 'direction'];

  // Everyone the office knows: those here now, and those who just left.
  const views = new Map<string, PersonView>();
  for (const [id, mem] of recall.people) views.set(id, mem.view);
  for (const p of company.people) views.set(p.id, p);
  const here = new Set(company.people.map((p) => p.id));
  const ceo = [...views.values()].find((p) => p.level === 'ceo') ?? null;
  const founded = company.log.filter((e) => e.kind === 'founded').reduce((t, e) => Math.max(t, e.at), Number.NEGATIVE_INFINITY);
  const deskOf = (id: string): CompanyDesk | null => office?.byPerson.get(id) ?? office?.freed.get(id) ?? recall.people.get(id)?.desk ?? null;

  function presenceOf(id: string): Presence[] {
    const list = recall.people.get(id)?.presence ?? (here.has(id) ? [{ at: Number.NEGATIVE_INFINITY, present: true, seen: Number.NEGATIVE_INFINITY }] : []);
    // A company founded just now: its CEO walks in.
    if (ceo && id === ceo.id && founded > horizon && list[0]?.at === Number.NEGATIVE_INFINITY) return [{ at: founded, present: true, seen: Number.isFinite(recall.first) ? recall.first : now }, ...list.slice(1)];
    return list;
  }
  const presentAt = (id: string, t: number) => {
    let present = false;
    for (const p of presenceOf(id)) if (p.at <= t) present = p.present;
    return present;
  };
  const desksOf = (id: string): readonly DeskSeen[] => {
    const seen = recall.people.get(id)?.desks;
    if (seen && seen.length > 0) return seen;
    const view = views.get(id);
    return view ? [{ state: view.desk.state, at: view.desk.since, seen: now, worked: view.desk.sessionId !== null }] : [];
  };
  const deskStateAt = (id: string, t: number): DeskState | null => {
    let state: DeskState | null = null;
    for (const d of desksOf(id)) if (d.at <= t) state = d.state;
    return state ?? desksOf(id)[0]?.state ?? null;
  };
  const nights = recall.nights.map((n) => ({ from: n.from, until: n.until ?? Number.POSITIVE_INFINITY, seen: n.seen, untilSeen: n.untilSeen ?? now }));
  const nightAt = (t: number) => nights.some((n) => n.from <= t && t < n.until);

  // ----- The front desk's line: everyone with an open question or approval, or the CEO with the proposal. A gate (the
  // office asking you before someone on "check with me" starts their next task) isn't theirs to bring: they carry on
  // with what they are doing, and the inbox has it.
  const items: Item[] = [];
  const addItem = (person: string, key: string, asked: number, answer: { at: number; appliesAt: number } | null, withdrawn: { at: number } | null) => {
    const resolved = answer ? answer.appliesAt : withdrawn ? withdrawn.at : Number.POSITIVE_INFINITY;
    if (resolved <= horizon) return;
    const seenResolved = answer ? seenOf(`${key}:answer:${answer.at}`) : withdrawn ? seenOf(`${key}:withdrawn`) : now;
    items.push({ person, asked, answered: answer?.at ?? null, resolved, seenAsked: seenOf(key), seenResolved });
  };
  for (const q of company.questions) if (!q.gate) addItem(q.from, `q:${q.id}`, q.askedAt, q.answer, q.withdrawn);
  for (const a of company.approvals) addItem(a.person, `a:${a.id}`, a.askedAt, a.answer, a.withdrawn);
  const proposal = recall.proposal;
  if (ceo && proposal && (proposal.until === null || proposal.until > horizon)) {
    items.push({ person: ceo.id, asked: proposal.since, answered: null, resolved: proposal.until ?? Number.POSITIVE_INFINITY, seenAsked: proposal.seen, seenResolved: proposal.untilSeen ?? now });
  }
  const lineAt = (t: number): string[] => {
    const first = new Map<string, number>();
    for (const i of items) {
      if (i.asked > t || t >= i.resolved || !views.has(i.person) || !presentAt(i.person, t) || deskStateAt(i.person, t) === 'away') continue;
      first.set(i.person, Math.min(first.get(i.person) ?? Number.POSITIVE_INFINITY, i.asked));
    }
    return [...first.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
  };
  const yoursAt = (id: string, t: number) => items.some((i) => i.person === id && i.asked <= t && t < i.resolved && (i.answered === null || i.answered > t));

  // ----- Truth: where each person belongs over time, by priority: gone, the line, the CEO's board, a lounge, the desk.
  const reception = office?.reception ?? null;
  const places = reception?.frontDesk.places ?? [];
  const boardSpot = office?.ceo.boardSpot ?? null;
  const boardUntil = company.phase === 'founding' ? Number.POSITIVE_INFINITY : (proposal?.since ?? Number.NEGATIVE_INFINITY);
  const gone: Home = { kind: 'gone', point: office?.edge ?? { x: 0, z: 0 }, seated: false, facing: 0, index: -1 };

  function homeAt(id: string, t: number): Home {
    const desk = deskOf(id);
    if (!desk || !presentAt(id, t) || deskStateAt(id, t) === 'away') return gone;
    const k = lineAt(t).indexOf(id);
    if (k >= 0) {
      const place = places[k];
      return k < FRONT_DESK_PLACES && place ? { kind: 'front', point: place, seated: false, facing: place.facing, index: k } : { kind: 'raised', point: desk.seat, seated: false, facing: 0, index: k };
    }
    if (ceo && id === ceo.id && boardSpot && founded <= t && t < boardUntil) return { kind: 'board', point: boardSpot, seated: false, facing: boardSpot.facing, index: -1 };
    const l = recall.lounge.get(id);
    if (l && l.from <= t && t < (l.until ?? Number.POSITIVE_INFINITY)) return { kind: 'lounge', point: l.spot, seated: true, facing: l.spot.facing, index: -1 };
    // Desks face the camera's side: people sit behind them, facing their screen.
    return { kind: 'desk', point: desk.seat, seated: true, facing: 0, index: -1 };
  }

  /** When each person's place may have changed within the horizon, and since when the browser knew. */
  const marks = new Map<string, { at: number; seen: number; change: Change }[]>();
  const mark = (id: string, at: number, seen: number, change: Change) => {
    if (!Number.isFinite(at) || at <= horizon) return;
    const list = marks.get(id) ?? [];
    list.push({ at, seen, change });
    marks.set(id, list);
  };
  for (const i of items) {
    // A change in the line moves everyone behind it, so each item's times count for all in line then.
    for (const [t, seen] of [[i.asked, i.seenAsked], [i.resolved, i.seenResolved]] as const) {
      if (!Number.isFinite(t)) continue;
      for (const id of new Set([...lineAt(t - 1), ...lineAt(t)])) mark(id, t, seen, 'front');
    }
  }
  for (const [id] of views) {
    for (const p of presenceOf(id)) mark(id, p.at, p.seen, p.present ? 'arrive' : 'leave');
    const desks = desksOf(id);
    desks.forEach((d, k) => {
      if (d.state === 'away') mark(id, d.at, d.seen, 'away');
      else if (desks[k - 1]?.state === 'away') mark(id, d.at, d.seen, 'back');
    });
    const l = recall.lounge.get(id);
    if (l) {
      mark(id, l.from, l.fromSeen, 'lounge');
      if (l.until !== null) mark(id, l.until, l.untilSeen ?? now, 'lounge');
    }
  }

  /** Each person's homes over the horizon; the first is where they were when it began. */
  const homes = new Map<string, HomeSpan[]>();
  for (const [id] of views) {
    const list: HomeSpan[] = [{ at: Number.NEGATIVE_INFINITY, home: homeAt(id, horizon), seen: Number.NEGATIVE_INFINITY, change: 'front' }];
    for (const m of (marks.get(id) ?? []).sort((a, b) => a.at - b.at)) {
      const home = homeAt(id, m.at);
      const prev = last(list)?.home;
      if (!prev || sameHome(prev, home)) continue;
      list.push({ at: m.at, home, seen: m.seen, change: changeOf(prev, home, m.change) });
    }
    homes.set(id, list);
  }
  const truthAt = (id: string, t: number): Home => {
    let home = gone;
    for (const h of homes.get(id) ?? []) if (h.at <= t) home = h.home;
    return home;
  };

  // ----- The engine: moments in time order, each taking the people it needs by the ladder and the walk budget.
  const excursions = new Map<string, Excursion[]>();
  const budgetUse: Excursion[] = [];
  const departures: number[] = [];
  const freeSpans = new Map<string, Span[]>();
  const freeBubbles = new Map<string, Timed<BubbleSpec>[]>();
  const gazes = new Map<string, Gaze[]>();
  const stands = new Map<string, { from: number; until: number }[]>();
  /** While someone is part of an all-hands' crowd, from the message until they are back. */
  const hushes = new Map<string, { from: number; until: number }[]>();
  const carried: { message: string; to: string; from: number; lands: number }[] = [];
  const flips = new Map<string, number | null>();
  const budget = Math.max(0, options.budget);
  let lastCelebration = Number.NEGATIVE_INFINITY;
  let celebration: SceneMoments['celebration'] = null;
  let streamers: MomentProps['streamers'] = null;

  const listOf = (id: string): Excursion[] => {
    let list = excursions.get(id);
    if (!list) {
      list = [];
      excursions.set(id, list);
    }
    return list;
  };
  /** The excursion that has someone at `t`, or the next one that will. */
  const busyAt = (id: string, t: number): Excursion | undefined => listOf(id).find((e) => e.end > t);
  const inExcursion = (id: string, t: number): Excursion | undefined => listOf(id).find((e) => e.start <= t && t < e.end);
  const position = (id: string, t: number): Point => {
    const e = inExcursion(id, t);
    if (e) {
      const p = placeOn(e.legs, e.origin, t);
      return { x: p.x, z: p.z };
    }
    return truthAt(id, t).point;
  };
  /** On a chair at `t`: at home in a seat, and not on (or just cut out of) a walk. */
  const seatedAt = (id: string, t: number, before: Home) => {
    if (inExcursion(id, t)) return false;
    if (listOf(id).some((e) => e.end === t && e.cutShort)) return false;
    return before.seated;
  };
  /** At their desk and free at `t`: nobody walks over to an empty chair. */
  const atDesk = (id: string, t: number) => truthAt(id, t).kind === 'desk' && !inExcursion(id, t);

  /** Ends an excursion at `t`: whatever it carried lands now, and nothing after `t` happens. */
  function truncate(e: Excursion, t: number) {
    if (e.end <= t) return;
    for (const n of e.notes) {
      n.lands = Math.min(n.lands, t);
      for (const c of carried) if (c.message === n.message) c.lands = Math.min(c.lands, t);
    }
    if (e.start >= t) {
      const list = listOf(e.person);
      const at = list.indexOf(e);
      if (at >= 0) list.splice(at, 1);
      const used = budgetUse.indexOf(e);
      if (used >= 0) budgetUse.splice(used, 1);
      return;
    }
    e.end = t;
    e.cutShort = true;
    e.legs = e.legs.filter((l) => l.at <= t);
    const clip = <T extends { from: number; until: number }>(list: T[]): T[] => list.filter((s) => s.from < t).map((s) => ({ ...s, until: Math.min(s.until, t) }));
    e.spans = clip(e.spans);
    e.holds = clip(e.holds);
    e.bubbles = clip(e.bubbles);
    e.gaze = clip(e.gaze);
    if (e.presenceUntil !== null && e.presenceUntil > t) e.presenceUntil = null;
  }

  /** The earliest start at or after `t` when someone is free for a moment at `rank`; null when that's more than `wait` away. */
  function claim(id: string, t: number, rank: number, overrides: boolean): number | null {
    let at = t;
    for (let guard = 0; guard < 8; guard++) {
      const e = busyAt(id, at);
      if (!e) return at;
      if (e.start > at) {
        // Planned to start later: a lower one gives way; a higher one goes first if it starts within the wait.
        if (overrides || e.rank > rank) {
          truncate(e, at);
          continue;
        }
        return at;
      }
      if (overrides || e.rank > rank) {
        truncate(e, at);
        return at;
      }
      if (e.end - t > WAIT_FOR_PERSON_MS) return null;
      at = e.end;
    }
    return null;
  }

  const limitFor = (reserved: boolean) => (reserved ? budget : Math.max(0, budget - WALK_RESERVED));
  function budgetFree(start: number, end: number, reserved: boolean): boolean {
    const limit = limitFor(reserved);
    if (limit <= 0) return false;
    const over = budgetUse.filter((e) => e.start < end && start < e.end);
    const points = [start, ...over.map((e) => e.start).filter((s) => s > start && s < end)];
    return points.every((p) => over.filter((e) => e.start <= p && p < e.end).length < limit);
  }
  /** When a walk this long can leave: on time, or when a budget place frees within `wait`; 300 ms after others leave. */
  function departure(t: number, ms: number, reserved: boolean, wait: number, counts: boolean): number | null {
    const candidates = [t, ...budgetUse.map((e) => e.end).filter((e) => e > t && e <= t + wait)].sort((a, b) => a - b);
    for (const c of candidates) {
      let s = c;
      for (let guard = 0; guard < 40; guard++) {
        const clash = departures.find((d) => Math.abs(d - s) < DEPART_GAP_MS - 1e-6);
        if (clash === undefined) break;
        s = clash + DEPART_GAP_MS;
      }
      if (s > t + Math.max(wait, STAGGER_MAX_MS)) continue;
      if (!counts || budgetFree(s, s + ms, reserved)) return s;
    }
    return null;
  }

  function legFrom(from: Point, to: Point, at: number, ms?: number): Leg | null {
    const path = route(layout, from, to);
    if (!path) return null;
    const time = ms ?? paceMs(pathLength(path));
    if (time === null) return null;
    return { at, ms: time, path };
  }

  function blank(id: string, rank: number, start: number, origin: Point): Excursion {
    return {
      person: id, rank, start, end: start, origin, legs: [], spans: [], holds: [], bubbles: [], gaze: [], notes: [], budget: false, reserved: false,
      stop: null, presenceFrom: null, presenceUntil: null, plantSet: null, plantUp: null, walked: false, cutShort: false, quiet: false,
    };
  }

  function commit(e: Excursion) {
    const list = listOf(e.person);
    list.push(e);
    list.sort((a, b) => a.start - b.start);
    if (e.budget) budgetUse.push(e);
    if (e.walked) departures.push(e.start);
  }

  function addFree(id: string, span: Span) {
    const list = freeSpans.get(id) ?? [];
    list.push(span);
    freeSpans.set(id, list);
  }
  function addBubble(id: string, b: Timed<BubbleSpec>) {
    const list = freeBubbles.get(id) ?? [];
    list.push(b);
    freeBubbles.set(id, list);
  }
  function addGaze(id: string, g: Gaze) {
    const list = gazes.get(id) ?? [];
    list.push(g);
    gazes.set(id, list);
  }

  // ----- Rooms that appeared since the office opened, building in 150 ms apart in the order they came (at once with
  // reduced motion).
  const appeared = new Map<string, number>();
  const newRooms = [...recall.rooms].filter(([, r]) => r.gone === null && Number.isFinite(r.first) && r.first > horizon).sort((a, b) => a[1].first - b[1].first || a[1].rect.x - b[1].rect.x);
  let previous = Number.NEGATIVE_INFINITY;
  let k = 0;
  for (const [id, r] of newRooms) {
    k = r.first === previous ? k + 1 : 0;
    previous = r.first;
    appeared.set(id, r.first + k * BUILD_ROOM_GAP_MS);
  }
  const built = options.reduced ? new Map<string, number>() : appeared;
  const builtBy = (at: number) => at + BUILD_FLOOR_MS + BUILD_WALLS_MS + BUILD_PIECES * BUILD_PIECE_MS;

  // ----- Requests, in time order: changes of place, rounds of notes, celebrations, office changes.
  const requests: Request[] = [];
  const startOrder = companyStart();
  for (const [id, list] of homes) {
    for (let k = 1; k < list.length; k++) {
      const span = list[k];
      const before = list[k - 1]?.home;
      if (!span || !before) continue;
      const order = span.change === 'arrive' ? startOrder.get(id) : undefined;
      requests.push({ kind: 'home', at: order?.at ?? span.at, id, span, before, order: order?.index ?? -1 });
    }
  }
  requests.push(...bursts());
  for (const ms of company.goal?.milestones ?? []) if (ms.doneAt !== null && ms.doneAt > horizon) requests.push({ kind: 'celebration', at: ms.doneAt, milestone: ms.id });
  // An office change: the office manager walks over to stand by each room it builds (not a starting company's).
  for (const [room, at] of appeared) if (startOrder.size === 0 || ![...startOrder.values()].some((o) => Math.abs(o.started - at) <= 2000)) requests.push({ kind: 'room', at, room });
  for (const allHands of allHandsOver()) requests.push({ kind: 'all-hands', at: allHands.at, allHands });
  const rankOf = (r: Request) =>
    r.kind === 'home'
      ? r.span.change === 'front' ? RANK.front : r.span.change === 'lounge' ? RANK.ambient : RANK.office
      : r.kind === 'burst' ? burstRank(r.messages) : r.kind === 'room' ? RANK.office : r.kind === 'all-hands' ? RANK.yours : RANK.celebration;
  requests.sort((a, b) => a.at - b.at || rankOf(a) - rankOf(b) || (a.kind === 'home' && b.kind === 'home' ? a.order - b.order : 0));
  for (const r of requests) {
    if (r.kind === 'home') planHome(r.id, r.span, r.before, r.at, r.order >= 0);
    else if (r.kind === 'burst') planBurst(r.from, r.messages, r.at);
    else if (r.kind === 'room') planStandBy(r.room, r.at);
    else if (r.kind === 'all-hands') planAllHands(r.allHands);
    else planCelebration(r.milestone, r.at);
  }

  // Night: walks under way finish within the grace, and celebrations stop.
  for (const n of nights) {
    for (const list of excursions.values()) for (const e of [...list]) if (e.start < n.from && e.end > n.from + NIGHT_GRACE_MS) truncate(e, n.from + NIGHT_GRACE_MS);
    for (const spans of freeSpans.values()) for (const s of spans) if ((s.pose === 'clap' || s.pose === 'cheer') && s.from < n.until && s.until > n.from) s.until = Math.max(s.from, n.from);
  }

  // Nods: a note taken at the desk, an answered paper at the front desk. Reduced motion: the receiver's words instead.
  // Your message to a room, a team or everyone is one moment for all its copies: the room nods together, the all-hands
  // gathers, and with reduced motion one of them says it.
  roomNods();
  for (const m of company.messages) {
    if (m.to === STAKEHOLDER || m.to === THE_OFFICE || allHandsOf(m) !== null || roomOf(m) !== null) continue;
    if (options.reduced) {
      if (m.at > horizon && fresh(m.at, seenOf(`m:${m.id}`))) addBubble(m.to, { from: m.at, until: m.at + FROM_SHOWN_MS, value: fromBubble(m) });
      continue;
    }
    if (m.deliveredAt === null || m.deliveredAt <= horizon) continue;
    const handed = carried.find((c) => c.message === m.id);
    const at = handed && handed.lands > m.deliveredAt ? handed.lands : m.deliveredAt;
    if (atDesk(m.to, at) && !nightAt(at)) addFree(m.to, { from: at, until: at + NOD_MS, pose: 'nod', seated: true });
  }
  if (!options.reduced) {
    for (const i of items) {
      const answered = i.answered;
      if (answered === null || answered <= horizon) continue;
      if (truthAt(i.person, answered).kind === 'front' && !inExcursion(i.person, answered)) addFree(i.person, { from: answered, until: answered + NOD_MS, pose: 'nod', seated: false });
    }
  }

  // Drafting, the CEO's turn ended without a proposal: they turn from the board to you, saying what they ended with,
  // and the pen rests until a message reaches them.
  const drafted = company.phase === 'founding' ? (company.drafting?.stopped ?? null) : null;
  if (ceo && drafted && drafted.words.trim()) addBubble(ceo.id, { from: drafted.at, until: Number.POSITIVE_INFINITY, value: { tone: 'question', lead: null, text: drafted.words, sentence: true } });

  // ----- Planning each kind of moment

  /** A company starting: its people walk in 0.7 s apart, heads first, room by room; phones fade them in by room. */
  function companyStart(): Map<string, { at: number; index: number; started: number }> {
    const out = new Map<string, { at: number; index: number; started: number }>();
    const started = company.log.filter((e) => e.kind === 'started' && e.at > horizon).reduce((t, e) => Math.max(t, e.at), Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(started)) return out;
    // The rooms build in first; then people arrive.
    const building = [...built.values()].filter((at) => Math.abs(at - started) <= 2000 + built.size * BUILD_ROOM_GAP_MS);
    const begin = Math.max(started, ...building.map(builtBy));
    const roomOrder = new Map(layout.rooms.map((r, i) => [r.id, i + 1]));
    const level = { ceo: 0, head: 1, lead: 2, worker: 3 } as const;
    const arriving = [...views.values()].filter((p) => presenceOf(p.id).some((e) => e.present && Math.abs(e.at - started) <= 2000));
    arriving.sort((a, b) => level[a.level] - level[b.level] || (roomOrder.get(a.room) ?? 0) - (roomOrder.get(b.room) ?? 0));
    // With reduced motion everyone is just there at the start.
    const when = (p: PersonView, index: number) =>
      options.reduced ? started : options.narrow ? begin + (roomOrder.get(p.room) ?? 0) * PHONE_FADE_GAP_MS : begin + index * ARRIVE_GAP_MS;
    arriving.forEach((p, index) => out.set(p.id, { at: when(p, index), index, started }));
    return out;
  }

  /**
   * The office manager, if there is one, walks over to a room being built and stands by it, then goes back; when the
   * walk can't be made, their bubble says what they are setting up.
   */
  function planStandBy(roomId: string, at: number) {
    const manager = views.get('office-manager');
    const room = recall.rooms.get(roomId)?.rect;
    if (!manager || !room || !here.has(manager.id) || !atDesk(manager.id, at)) return;
    const name = office ? [...layout.rooms, ...office.rest].find((r) => r.id === roomId)?.name : undefined;
    const fallback = () => {
      if (name) addBubble(manager.id, { from: at, until: at + SENT_NOTES_MS, value: { tone: 'meeting', lead: null, text: `Setting up the ${inSentence(name)}` } });
    };
    if (!options.motion || nightAt(at)) return fallback();
    const start = claim(manager.id, at, RANK.office, false);
    if (start === null) return fallback();
    const e = blank(manager.id, RANK.office, start, position(manager.id, start));
    const spot = { x: room.x + room.w / 2, z: room.z + room.d / 2 };
    const there = legFrom(e.origin, spot, start + STAND_UP_MS);
    if (!there) return fallback();
    const back = legFrom(spot, truthAt(manager.id, there.at + there.ms + STAND_BY_MS).point, there.at + there.ms + STAND_BY_MS);
    e.spans.push({ from: start, until: start + STAND_UP_MS, pose: 'stand', seated: false });
    e.legs = [there, ...(back ? [back] : [])];
    e.gaze.push({ from: there.at + there.ms, until: there.at + there.ms + STAND_BY_MS, toward: spot });
    e.end = back ? back.at + back.ms : there.at + there.ms + STAND_BY_MS;
    const leave = departure(start, e.end - start, false, WAIT_FOR_PERSON_MS, true);
    if (leave === null) return fallback();
    Object.assign(e, { walked: true, budget: true, stop: spot });
    shiftExcursion(e, leave - start);
    commit(e);
  }

  /** Whether someone can be seen at `t`: arrived, and not yet faded out on the way out. */
  function visibleAt(id: string, t: number): boolean {
    for (const e of listOf(id)) if (e.presenceUntil !== null && e.start <= t) return t < e.presenceUntil;
    return truthAt(id, t).kind !== 'gone';
  }

  function planHome(id: string, span: HomeSpan, before: Home, at: number, batch: boolean) {
    const view = views.get(id);
    const to = span.home;
    const change = span.change;
    const rank = change === 'front' ? RANK.front : change === 'lounge' ? RANK.ambient : RANK.office;
    const overrides = change === 'leave' || change === 'away' || change === 'arrive' || change === 'back';
    // Where they are just before the change, before anything gives way: an undone firing turns them back from there.
    // (A starting company's arrivals are planned later than the change itself, which is what counts.)
    const wasVisible = visibleAt(id, span.at - 1);
    const wasAt = position(id, Math.min(at, span.at) - 1);
    let start = claim(id, at, rank, overrides);
    const blocked = start === null;
    if (start === null) start = busyAt(id, at)?.end ?? at;
    // A click or Escape before their turn to walk in seats them at once.
    const skipped = batch && options.skipAt !== null && options.skipAt <= start;
    if (skipped && options.skipAt !== null) start = Math.max(span.at, options.skipAt);
    const e = blank(id, rank, start, wasVisible ? (blocked ? position(id, start - 1) : wasAt) : (office?.edge ?? wasAt));
    const knew = fresh(span.at, span.seen);
    // Phones fade a starting company in instead of walking it in.
    const walkable = !blocked && options.motion && knew && !nightAt(start) && !skipped && !(batch && options.narrow);
    const plant = view !== undefined && view.level !== 'ceo';
    const title = view ? inSentence(view.title) : '';
    const newBubble: BubbleSpec = { tone: 'meeting', lead: 'New:', text: title.charAt(0).toUpperCase() + title.slice(1) };
    const fromSeat = wasVisible && seatedAt(id, start, before);

    if (change === 'arrive' || change === 'back' || (change === 'board' && before.kind === 'gone')) {
      const withPlant = change === 'arrive' && plant;
      const leg = walkable ? legFrom(e.origin, to.point, start) : null;
      const leave = leg ? departure(start, leg.ms + (withPlant ? INTERACT_MS : 0), false, batch ? 60_000 : WAIT_FOR_PERSON_MS, true) : null;
      if (leg && leave !== null) {
        leg.at = leave;
        const arrive = leave + leg.ms;
        Object.assign(e, { start: leave, end: arrive + (withPlant ? INTERACT_MS : 0), legs: [leg], walked: true, budget: true, stop: to.point, presenceFrom: wasVisible ? null : leave });
        if (withPlant) {
          e.spans.push({ from: arrive, until: arrive + INTERACT_MS, pose: 'interact', seated: false });
          e.holds.push({ from: leave, until: arrive + INTERACT_MS / 2, value: 'plant' });
          e.plantSet = arrive + INTERACT_MS / 2;
          e.bubbles.push({ from: leave, until: e.end, value: newBubble });
        }
        commit(e);
        // A click or Escape seats everyone still on their way in.
        if (batch && options.skipAt !== null && options.skipAt < e.end) {
          if (e.plantSet !== null) e.plantSet = Math.min(e.plantSet, options.skipAt);
          truncate(e, Math.max(e.start + 1, options.skipAt));
        }
        return;
      }
      // Over the budget, with reduced motion, seen late or at night: they are just there.
      e.presenceFrom = wasVisible ? null : start;
      e.plantSet = withPlant ? start : null;
      if (withPlant && knew && !options.narrow) e.bubbles.push({ from: start, until: start + FROM_SHOWN_MS, value: newBubble });
      e.end = withPlant && knew && !options.narrow ? start + FROM_SHOWN_MS : start;
      e.rank = RANK.ambient;
      commit(e);
      return;
    }

    if (change === 'leave' || change === 'away') {
      const fired = change === 'leave';
      const withPlant = fired && plant;
      const door = office?.door ?? e.origin;
      const edge = office?.edge ?? e.origin;
      let t = start;
      if (fromSeat) {
        e.spans.push({ from: t, until: t + STAND_UP_MS, pose: 'stand', seated: false });
        t += STAND_UP_MS;
      }
      if (withPlant && wasVisible) {
        e.spans.push({ from: t, until: t + PICKUP_MS, pose: 'pickup', seated: false });
        e.plantUp = t + PICKUP_MS / 2;
        t += PICKUP_MS;
      }
      const toDoor = walkable && wasVisible ? legFrom(e.origin, fired ? door : edge, t) : null;
      const out = toDoor && fired ? legFrom(door, edge, t + toDoor.ms + WAVE_MS) : null;
      const lastLeg = out ?? toDoor;
      const end = lastLeg ? lastLeg.at + lastLeg.ms + FADE_MS : start;
      const leave = toDoor && (!fired || out) ? departure(start, end - start, false, WAIT_FOR_PERSON_MS, true) : null;
      if (toDoor && lastLeg && leave !== null) {
        const shift = leave - start;
        e.legs = [toDoor, ...(out ? [out] : [])];
        if (fired) e.spans.push({ from: toDoor.at + toDoor.ms, until: toDoor.at + toDoor.ms + WAVE_MS, pose: 'wave', seated: false });
        if (withPlant && e.plantUp !== null) e.holds.push({ from: e.plantUp, until: end, value: 'plant' });
        if (fired) e.bubbles.push({ from: start, until: end - FADE_MS, value: { tone: 'meeting', lead: null, text: 'Leaving' } });
        e.end = end;
        e.presenceUntil = end;
        Object.assign(e, { walked: true, budget: true, stop: door });
        shiftExcursion(e, shift);
        commit(e);
        return;
      }
      e.spans = [];
      e.presenceUntil = start;
      e.plantUp = start;
      commit(e);
      return;
    }

    // To the front desk and back, a step up in the line, to the CEO's board, to a lounge and back.
    if (to.kind === 'raised' || (before.kind === 'raised' && to.kind === 'desk')) {
      // Raising the paper at their own desk, or sitting back down: no walk.
      commit(e);
      return;
    }
    const counts = change === 'lounge' || change === 'board';
    const standing = fromSeat ? STAND_UP_MS : 0;
    const steps = before.kind === 'front' && to.kind === 'front' ? Math.abs(before.index - to.index) * STEP_UP_MS : undefined;
    const leg = walkable ? legFrom(e.origin, to.point, start + standing, steps) : null;
    const leave = leg ? departure(start, standing + leg.ms, false, counts ? WAIT_FOR_PERSON_MS : 0, counts) : null;
    if (leg && leave !== null) {
      if (standing > 0) e.spans.push({ from: start, until: start + standing, pose: 'stand', seated: false });
      e.legs = [leg];
      e.end = leg.at + leg.ms;
      const holding: Holding = to.kind === 'front' ? (yoursAt(id, e.end) ? 'note-yours' : 'note') : before.kind === 'front' ? 'note' : 'none';
      if (holding !== 'none') e.holds.push({ from: start, until: e.end, value: holding });
      Object.assign(e, { walked: true, budget: counts, stop: to.point });
      shiftExcursion(e, leave - start);
      commit(e);
      return;
    }
    commit(e);
  }

  function bursts(): Request[] {
    const out: Request[] = [];
    const bySender = new Map<string, Message[]>();
    for (const m of company.messages) {
      if (m.at <= horizon || m.at > now) continue;
      if (m.from === STAKEHOLDER || m.from === THE_OFFICE || m.to === STAKEHOLDER || m.to === THE_OFFICE) continue;
      const list = bySender.get(m.from) ?? [];
      list.push(m);
      bySender.set(m.from, list);
    }
    for (const [from, list] of bySender) {
      list.sort((a, b) => a.at - b.at);
      let group: Message[] = [];
      const flush = () => {
        const head = group[0];
        if (head) out.push({ kind: 'burst', at: head.at, from, messages: group });
        group = [];
      };
      for (const m of list) {
        const head = group[0];
        if (head && m.at - head.at > BURST_MS) flush();
        group.push(m);
      }
      flush();
    }
    return out;
  }

  function reportOf(m: Message) {
    return company.reports.find((r) => r.person === m.from && r.to === m.to && Math.abs(r.at - m.at) <= 1000);
  }
  function passesYours(m: Message): boolean {
    return m.origin === STAKEHOLDER;
  }
  function burstRank(messages: readonly Message[]): number {
    if (messages.some(passesYours)) return RANK.yours;
    if (messages.some((m) => reportOf(m) !== undefined)) return RANK.report;
    return RANK.relay;
  }

  /** What a walker's bubble says on the way with a note. */
  function carryBubble(m: Message): BubbleSpec {
    if (passesYours(m)) return { tone: 'meeting', lead: 'From you:', text: m.text };
    const report = reportOf(m);
    if (report) return { tone: 'report', lead: null, text: report.text, sentence: true };
    const task = company.tasks.find((t) => t.owner === m.to && t.askedBy === m.from && Math.abs(t.createdAt - m.at) <= 1000);
    if (task) return { tone: 'meeting', lead: null, text: task.title };
    return { tone: 'meeting', lead: null, text: m.text };
  }

  /** Whose words reach them: the receiver's bubble with reduced motion. */
  function fromBubble(m: Message): BubbleSpec {
    const sender = views.get(m.from);
    return { tone: 'meeting', lead: m.from === STAKEHOLDER ? 'From you:' : `From ${sender ? calledIn(sender) : 'the office'}:`, text: m.text };
  }

  function planBurst(from: string, messages: Message[], at: number) {
    const sender = views.get(from);
    const first = messages[0];
    if (!sender || !first || options.reduced) return;
    const rank = burstRank(messages);
    const knew = fresh(at, seenOf(`m:${first.id}`));
    const receivers = [...new Set(messages.map((m) => m.to))].filter((id) => views.has(id) && deskOf(id) !== null);
    const fallback = () => {
      if (!knew || !atDesk(from, at) || receivers.length === 0) return;
      const bubble: BubbleSpec = receivers.length > 1 ? { tone: 'meeting', lead: null, text: `Sent notes to ${countWord(receivers.length)} people` } : carryBubble(first);
      addBubble(from, { from: at, until: at + (bubble.tone === 'report' ? REPORT_SHOWN_MS : SENT_NOTES_MS), value: bubble });
    };
    if (!options.motion || !knew || receivers.length === 0 || truthAt(from, at).kind !== 'desk') return fallback();
    let start = claim(from, at, rank, false);
    if (start === null || nightAt(start)) return fallback();
    // Passing on a note still on its way to them: they leave when it lands, at most 6 s late.
    const incoming = carried.filter((c) => c.to === from && c.lands > (start ?? at) && messages.some((m) => m.relayOf === c.message)).reduce((t, c) => Math.max(t, c.lands), 0);
    if (incoming > 0) start = Math.min(Math.max(start, incoming), at + LATE_MAX_MS);
    const idleAt = (id: string) => {
      const fact = recall.facts.get(`idle:${messages.find((m) => m.to === id)?.id ?? ''}`);
      const view = views.get(id);
      return fact ? fact.length > 0 : view !== undefined && idleDesk(view);
    };
    const idle = receivers.filter(idleAt);
    const roomsOf = new Set(receivers.map((id) => views.get(id)?.room));
    if (office?.meeting && receivers.length >= 3 && roomsOf.size >= 3 && idle.length >= 2 && planMeeting(from, messages, first, start, rank, idle)) return;
    if (!planRound(from, messages, start, rank, receivers)) fallback();
  }

  interface Stop {
    id: string;
    message: Message;
    from: number;
    until: number;
    lands: number;
  }

  /** A round from `start`: the sender's walk past each receiver's desk, nearest next, without booking anything yet. */
  function round(from: string, messages: Message[], start: number, rank: number, receivers: string[]): { e: Excursion; stops: Stop[] } | null {
    const e = blank(from, rank, start, position(from, start));
    e.spans.push({ from: start, until: start + STAND_UP_MS, pose: 'stand', seated: false });
    let t = start + STAND_UP_MS;
    let here = e.origin;
    const left = receivers.filter((id) => atDesk(id, start));
    const stay = left.length === 1 ? TALK_MS : ROUND_STOP_MS;
    const stops: Stop[] = [];
    while (left.length > 0 && stops.length < ROUND_STOPS) {
      left.sort((a, b) => dist(here, deskOf(a)?.visitor ?? here) - dist(here, deskOf(b)?.visitor ?? here));
      const id = left.shift();
      const desk = id === undefined ? null : deskOf(id);
      const message = messages.find((m) => m.to === id);
      if (id === undefined || !desk || !message) continue;
      const leg = legFrom(here, desk.visitor, t);
      if (!leg) continue;
      let arrive = t + leg.ms;
      let legs = [leg];
      // Someone else talking at that desk: wait a step behind, 3 s at most.
      const busy = (stands.get(id) ?? []).filter((s) => s.until > arrive && s.from < arrive + stay).reduce((u, s) => Math.max(u, s.until), 0);
      if (busy > 0) {
        if (busy - arrive > BEHIND_MAX_MS) continue;
        const behind = legFrom(here, desk.behind, t);
        const step = behind ? legFrom(desk.behind, desk.visitor, Math.max(busy, t + behind.ms), 400) : null;
        if (!behind || !step) continue;
        legs = [behind, step];
        arrive = step.at + step.ms;
      }
      if (arrive + stay - start > ROUND_MAX_MS) break;
      e.legs.push(...legs);
      const lands = arrive + Math.min(NOTE_IN_MS, stay);
      e.spans.push({ from: arrive, until: arrive + stay, pose: 'talk', seated: false });
      e.bubbles.push({ from: t, until: arrive + stay, value: carryBubble(message) });
      e.holds.push({ from: start, until: lands, value: passesYours(message) ? 'note-yours' : 'note' });
      e.gaze.push({ from: arrive, until: arrive + stay, toward: desk.seat });
      e.notes.push({ message: message.id, lands });
      stops.push({ id, message, from: arrive, until: arrive + stay, lands });
      here = desk.visitor;
      t = arrive + stay;
    }
    if (stops.length === 0) return null;
    const back = legFrom(here, truthAt(from, t).point, t);
    if (back) e.legs.push(back);
    e.end = back ? back.at + back.ms : t;
    e.stop = deskOf(stops[0]?.id ?? '')?.visitor ?? null;
    return { e, stops };
  }

  function planRound(from: string, messages: Message[], start: number, rank: number, receivers: string[]): boolean {
    const reserved = rank === RANK.yours;
    let planned = round(from, messages, start, rank, receivers);
    if (!planned) return false;
    const leave = departure(start, planned.e.end - start, reserved, WAIT_FOR_PERSON_MS, true);
    if (leave === null) return false;
    if (leave !== start) {
      planned = round(from, messages, leave, rank, receivers);
      if (!planned || !budgetFree(leave, planned.e.end, reserved)) return false;
    }
    const { e, stops } = planned;
    Object.assign(e, { walked: true, budget: true, reserved });
    for (const s of stops) {
      carried.push({ message: s.message.id, to: s.id, from: e.start, lands: s.lands });
      const list = stands.get(s.id) ?? [];
      list.push({ from: s.from, until: s.until });
      stands.set(s.id, list);
      // A working receiver turns their head to whoever stands there, an idle one the chair.
      const desk = deskOf(s.id);
      if (desk) addGaze(s.id, { from: s.from, until: s.until, toward: desk.visitor });
    }
    commit(e);
    return true;
  }

  function planMeeting(from: string, messages: Message[], first: Message, start: number, rank: number, idle: string[]): boolean {
    const room = office?.meeting;
    if (!room) return false;
    const reserved = rank === RANK.yours;
    const door = { x: room.x + 1.2, z: room.z };
    const sender = blank(from, rank, start, position(from, start));
    const there = legFrom(sender.origin, room.head, start + STAND_UP_MS);
    if (!there) return false;
    const attendees = idle
      .filter((id) => atDesk(id, start) || truthAt(id, start).kind === 'lounge')
      .sort((a, b) => dist(position(a, start), door) - dist(position(b, start), door))
      .slice(0, MEETING_MAX);
    const plans: { id: string; e: Excursion; leg: Leg; spot: Spot }[] = [];
    let leaving = start;
    for (const id of attendees) {
      const spot = room.spots[plans.length];
      if (!spot) break;
      leaving += DEPART_GAP_MS;
      const home = truthAt(id, leaving);
      const leg = legFrom(position(id, leaving), spot, leaving + (home.seated ? STAND_UP_MS : 0));
      if (!leg) continue;
      const e = blank(id, rank, leaving, position(id, leaving));
      if (home.seated) e.spans.push({ from: leaving, until: leaving + STAND_UP_MS, pose: 'stand', seated: false });
      plans.push({ id, e, leg, spot });
    }
    if (plans.length < 2) return false;
    const arrivals = plans.map((p) => p.leg.at + p.leg.ms);
    const senderIn = there.at + there.ms;
    const end = Math.max(Math.min(Math.max(...arrivals), Math.min(...arrivals) + FIRST_WAIT_MS), senderIn) + LISTEN_MS;
    const coming = plans.filter((p) => p.leg.at + p.leg.ms < end - 1000);
    if (coming.length < 2) return false;
    const backs = new Map(coming.map((p) => [p.id, legFrom(p.spot, truthAt(p.id, end).point, end)]));
    const senderBack = legFrom(room.head, truthAt(from, end).point, end);
    const finish = (leg: Leg | null | undefined) => (leg ? leg.at + leg.ms : end);
    // The sender and everyone who comes need a budget place each, or there is no meeting.
    const until = Math.max(finish(senderBack), ...coming.map((p) => finish(backs.get(p.id))));
    const using = budgetUse.filter((e) => e.start < until && start < e.end).length;
    if (using + 1 + coming.length > limitFor(reserved)) return false;
    sender.spans.push({ from: start, until: start + STAND_UP_MS, pose: 'stand', seated: false }, { from: senderIn, until: end, pose: 'talk', seated: false });
    sender.legs = [there, ...(senderBack ? [senderBack] : [])];
    sender.gaze.push({ from: senderIn, until: end, toward: { x: room.table.x + room.table.w / 2, z: room.table.z + room.table.d / 2 } });
    sender.bubbles.push({ from: start, until: end, value: carryBubble(first) });
    sender.holds.push({ from: start, until: end, value: messages.some(passesYours) ? 'note-yours' : 'note' });
    Object.assign(sender, { end: finish(senderBack), walked: true, budget: true, reserved, stop: room.head });
    for (const m of messages) {
      if (!coming.some((p) => p.id === m.to)) continue;
      sender.notes.push({ message: m.id, lands: end });
      carried.push({ message: m.id, to: m.to, from: start, lands: end });
    }
    commit(sender);
    for (const p of coming) {
      const back = backs.get(p.id) ?? null;
      p.e.legs = [p.leg, ...(back ? [back] : [])];
      p.e.spans.push({ from: p.leg.at + p.leg.ms, until: end, pose: 'listen', seated: false });
      p.e.gaze.push({ from: p.leg.at + p.leg.ms, until: end, toward: room.head });
      Object.assign(p.e, { end: finish(back), walked: true, budget: true, reserved, stop: p.spot });
      commit(p.e);
    }
    return true;
  }

  /** Your messages to everyone, a gathering each in time order; one sent before the last could have gone back joins it. */
  function allHandsOver(): AllHands[] {
    const groups = new Map<string, Message[]>();
    for (const m of company.messages) {
      const group = allHandsOf(m);
      if (group === null) continue;
      const list = groups.get(group) ?? [];
      list.push(m);
      groups.set(group, list);
    }
    const found: AllHands[] = [];
    for (const [group, copies] of groups) {
      const first = [...copies].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))[0];
      if (!first || first.at <= horizon || first.at > now) continue;
      const people = recall.facts.get(`allhands:${group}`) ?? [...new Set(copies.map((m) => m.to))];
      found.push({ at: first.at, seen: seenOf(`m:${first.id}`), people, words: [{ at: first.at, text: first.text }] });
    }
    found.sort((a, b) => a.at - b.at);
    const out: AllHands[] = [];
    for (const g of found) {
      const open = last(out);
      const latest = open ? Math.max(...open.words.map((w) => w.at)) : Number.NEGATIVE_INFINITY;
      if (open && g.at < Math.max(open.at + GATHER_MAX_MS, latest) + ALL_HANDS_MS) open.words.push(...g.words);
      else out.push(g);
    }
    return out;
  }

  /** Something an all-hands doesn't break: needing you at the front desk, or arriving or leaving. */
  function unbreakable(e: Excursion): boolean {
    return e.rank === RANK.front || e.presenceFrom !== null || e.presenceUntil !== null || e.plantSet !== null || e.plantUp !== null;
  }
  function onGrid(ms: number): number {
    return Math.ceil(ms / GATHER_GRID_MS) * GATHER_GRID_MS;
  }

  /**
   * An all-hands (SPEC-v3.md, "Steering"): everyone it reached who is at their desk or in a lounge stands up in waves,
   * walks to the gathering place and faces its focus, listening, while the first of them (the CEO when there) carries
   * your words; ALL_HANDS_MS after they are together they walk back. It outranks walks under way, which stop where they
   * are, but whoever waits at the front desk or walks to it or back, arrives or leaves, or celebrates carries on. With
   * reduced motion it is a cut: they are there, then back. Seen late or at night, nobody moves: the notes are in the
   * trays. Night falling sends them back at once. Their own bubbles wait while they are part of the crowd.
   */
  function planAllHands(g: AllHands) {
    const place = office?.gathering;
    const s = g.at;
    if (!office || !place || place.spots.length === 0 || !fresh(s, g.seen) || nightAt(s)) return;
    const room = [office.meeting, office.reception].find((r) => r?.id === place.room) ?? null;
    const middle = room ? { x: room.x + room.w / 2, z: room.z + room.d / 2 } : place.focus;
    const levels: Record<Level, number> = { ceo: 0, head: 1, lead: 2, worker: 3 };
    const celebrating = (id: string) => (freeSpans.get(id) ?? []).some((sp) => (sp.pose === 'clap' || sp.pose === 'cheer') && sp.from <= s && s < sp.until);
    const coming = g.people
      .filter((id) => {
        const kind = truthAt(id, s).kind;
        return views.has(id) && presentAt(id, s) && deskOf(id) !== null && (kind === 'desk' || kind === 'lounge') && !celebrating(id) && !listOf(id).some((e) => e.start <= s && s < e.end && unbreakable(e));
      })
      // Where they are now, and whether on a chair, before the walks they were on stop.
      .map((id) => ({ id, from: position(id, s), seated: seatedAt(id, s, truthAt(id, s)), level: levels[views.get(id)?.level ?? 'worker'] }))
      // The CEO first, then heads and leads, each nearest the room first: the front of the crowd fills first.
      .sort((a, b) => a.level - b.level || dist(a.from, middle) - dist(b.from, middle) || (a.id < b.id ? -1 : 1));
    for (const { id } of coming) for (const e of [...listOf(id)]) if (e.end > s) truncate(e, s);

    const reduced = options.reduced || !options.motion;
    // The way back is the way there reversed: the moves are the same both ways, and it is one search fewer.
    const walk = (from: Point, spot: Point, at: number, back = false): Leg | null => {
      const path = gatheringPath(layout, from, spot);
      const ms = path ? paceMs(pathLength(path)) : null;
      return path && ms !== null ? { at, ms: onGrid(ms), path: back ? [...path].reverse() : path } : null;
    };
    const plans: { id: string; from: Point; seated: boolean; spot: Spot; depart: number; there: Leg | null }[] = [];
    for (const c of coming) {
      const spot = place.spots[plans.length];
      if (!spot) break;
      // The first leaves at once: their bubble carries your words from the start.
      const depart = reduced || plans.length === 0 ? s : s + (hash(c.id) % GATHER_WAVES) * GATHER_WAVE_MS;
      let there: Leg | null = null;
      if (!reduced) {
        there = walk(c.from, spot, depart + (c.seated ? STAND_UP_MS : 0));
        // Too far to walk in time: they stay, and the note is in their tray.
        if (!there) continue;
      }
      plans.push({ ...c, spot, depart, there });
    }
    if (plans.length === 0) return;

    const arrivals = plans.map((p) => (p.there ? p.there.at + p.there.ms : s));
    const together = reduced ? s : Math.min(Math.max(...arrivals), Math.min(...arrivals) + FIRST_WAIT_MS);
    const latest = Math.max(...g.words.map((w) => w.at));
    const night = nights.find((n) => n.from > s)?.from ?? Number.POSITIVE_INFINITY;
    const release = Math.min(Math.max(together, latest) + ALL_HANDS_MS, night);
    const host = plans[0]?.id;
    // The way back: whoever has furthest to go leaves first, so everyone sits down at the same moment, one change for
    // the whole office. Night sends them all at once, and turns round anyone who isn't there yet where they are.
    const backs = new Map<string, Leg | null>();
    for (const p of plans) {
      const there = p.there;
      if (!there) continue;
      if (release < there.at + there.ms) {
        const path = subPath(there.path, walked(there, release), 0);
        const ms = paceMs(pathLength(path));
        backs.set(p.id, ms === null ? null : { at: release, ms: onGrid(ms), path });
        continue;
      }
      backs.set(p.id, walk(truthAt(p.id, release).point, p.spot, release, true));
    }
    const seated = release + Math.max(0, ...[...backs.values()].map((l) => l?.ms ?? 0));
    if (release !== night) for (const l of backs.values()) if (l) l.at = seated - l.ms;
    for (const p of plans) {
      const e = blank(p.id, RANK.yours, p.depart, reduced ? p.spot : p.from);
      e.quiet = true;
      if (!p.there) {
        e.spans.push({ from: s, until: release, pose: 'listen', seated: false });
        e.gaze.push({ from: s, until: release, toward: place.focus });
        e.end = release;
      } else {
        const there = p.there;
        const arrive = there.at + there.ms;
        if (p.seated) e.spans.push({ from: p.depart, until: p.depart + STAND_UP_MS, pose: 'stand', seated: false });
        const back = backs.get(p.id) ?? null;
        const leave = back?.at ?? release;
        const listening = Math.max(arrive, together);
        if (listening < release) e.spans.push({ from: listening, until: release, pose: 'listen', seated: false });
        if (arrive < leave) e.gaze.push({ from: arrive, until: leave, toward: place.focus });
        e.legs = [there, ...(back ? [back] : [])];
        e.end = back ? back.at + back.ms : Math.max(arrive, leave);
        e.walked = true;
      }
      if (p.id === host) {
        g.words.forEach((w, i) => {
          const until = Math.min(g.words[i + 1]?.at ?? release, release);
          if (until > w.at) e.bubbles.push({ from: w.at, until, value: { tone: 'meeting', lead: 'From you:', text: w.text } });
        });
      }
      e.stop = p.spot;
      commit(e);
      const hush = hushes.get(p.id) ?? [];
      hush.push({ from: s, until: e.end });
      hushes.set(p.id, hush);
    }
  }

  /**
   * Your message to a room or a team gathers nobody: the people it reached who are at their desks look up and nod in
   * place, a step apart. With reduced motion one of them, the most senior, says whose words they are instead, so the
   * room's labels don't pile up.
   */
  function roomNods() {
    const groups = new Map<string, Message[]>();
    for (const m of company.messages) {
      const group = roomOf(m);
      if (group === null) continue;
      const list = groups.get(group) ?? [];
      list.push(m);
      groups.set(group, list);
    }
    const levels: Record<Level, number> = { ceo: 0, head: 1, lead: 2, worker: 3 };
    for (const copies of groups.values()) {
      const first = [...copies].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))[0];
      if (!first || first.at <= horizon || first.at > now || !fresh(first.at, seenOf(`m:${first.id}`))) continue;
      const s = first.at;
      const there = [...new Set(copies.map((m) => m.to))].filter((id) => views.has(id) && atDesk(id, s));
      if (options.reduced) {
        const voice = there.sort((a, b) => levels[views.get(a)?.level ?? 'worker'] - levels[views.get(b)?.level ?? 'worker'] || (a < b ? -1 : 1))[0];
        if (voice) addBubble(voice, { from: s, until: s + FROM_SHOWN_MS, value: fromBubble(first) });
        continue;
      }
      if (nightAt(s)) continue;
      for (const id of there) {
        const at = s + (hash(id) % 3) * ROOM_NOD_STAGGER_MS;
        addFree(id, { from: at, until: at + NOD_MS, pose: 'nod', seated: true });
      }
    }
  }

  function planCelebration(milestone: string, at: number) {
    const knew = fresh(at, seenOf(`ms:${milestone}`));
    flips.set(milestone, knew && !options.reduced ? at : null);
    if (!knew || options.reduced || nightAt(at) || at - lastCelebration < CELEBRATION_GAP_MS) return;
    lastCelebration = at;
    const goal = company.goal;
    const finale = goal !== null && goal.milestones.every((m) => m.doneAt !== null) && Math.max(...goal.milestones.map((m) => m.doneAt ?? 0)) === at;
    const owners = new Set(company.tasks.filter((t) => t.milestone === milestone).map((t) => t.owner));
    const managers = new Set([...owners].map((id) => views.get(id)?.reportsTo).filter((id): id is string => typeof id === 'string'));
    const idle = new Set(recall.facts.get(`clap:${milestone}`) ?? company.people.filter(idleDesk).map((p) => p.id));
    const clappers = [...views.values()]
      .filter((p) => p.level !== 'ceo' && idle.has(p.id) && (finale || owners.has(p.id) || managers.has(p.id)) && atDesk(p.id, at))
      .slice(0, options.narrow ? PHONE_CLAPPERS : undefined);
    for (const p of clappers) addFree(p.id, { from: at, until: at + STAND_UP_MS + CLAP_MS, pose: 'clap', seated: false });
    if (ceo && idle.has(ceo.id) && atDesk(ceo.id, at)) addFree(ceo.id, { from: at, until: at + STAND_UP_MS + CHEER_MS, pose: 'cheer', seated: false });
    const worked = [...owners].map((id) => views.get(id)).filter((p): p is PersonView => p !== undefined);
    const count = Math.round((finale ? LAST_STREAMERS : STREAMERS) / (options.narrow ? 2 : 1));
    if (now >= at && now < at + STREAMER_MS) celebration = { until: at + STREAMER_MS, rooms: [...new Set(worked.map((p) => p.room))], streamers: count };
    if (office?.meeting && now < at + STREAMER_MS) {
      const hues = [...new Set(worked.map(hueOf))];
      streamers = { at, count, hues: hues.length > 0 ? hues : [DEPARTMENT_HUE.direction], from: office.meeting.board, face: faces.milestone ?? office.meeting.board.z };
    }
    changes.push(at, at + STREAMER_MS);
  }

  // ----- Each person now
  const lineNow = lineAt(now);
  const people: PersonPlan[] = [];
  for (const [id, view] of views) {
    const list = listOf(id);
    const home = truthAt(id, now);
    const current = inExcursion(id, now);
    const upcoming = list.filter((e) => e.end > now);
    const arrival = [...list].reverse().find((e) => e.presenceFrom !== null);
    const leaving = list.find((e) => e.presenceUntil !== null && e.start <= now + HORIZON_MS);
    const presence = { from: arrival?.presenceFrom ?? null, until: leaving?.presenceUntil ?? null };
    const shown = home.kind !== 'gone' || (presence.until !== null && presence.until > now);
    if (!shown || (presence.until !== null && presence.until <= now && home.kind === 'gone')) continue;
    for (const e of list) changes.push(e.start, e.end);

    const spans = current ? current.spans : (freeSpans.get(id) ?? []);
    const span = spans.find((s) => s.from <= now && now < s.until);
    const leg = current?.legs.find((l) => l.at <= now && now < l.at + l.ms);
    const base = basePose(view, home);
    let { pose, seated, since } = base;
    if (span) {
      ({ pose, seated } = span);
      since = span.from;
    } else if (leg) {
      pose = 'walk';
      seated = false;
      since = leg.at;
    } else if (current && current.legs.length > 0) {
      // Between legs: standing at a stop.
      pose = 'stand';
      seated = false;
      since = Math.max(current.start, ...current.legs.filter((l) => l.at + l.ms <= now).map((l) => l.at + l.ms));
    } else {
      // Back from a moment: the pose they settled into began when they got back.
      const back = Math.max(Number.NEGATIVE_INFINITY, ...list.filter((e) => e.end <= now && e.start < e.end).map((e) => e.end), ...(freeSpans.get(id) ?? []).filter((s) => s.until <= now).map((s) => s.until));
      since = Math.max(since, back);
    }
    const holding: Holding = current ? (current.holds.find((h) => h.from <= now && now < h.until)?.value ?? 'none') : base.holding;
    const bubble = (current?.bubbles ?? []).find((b) => b.from <= now && now < b.until)?.value ?? (freeBubbles.get(id) ?? []).find((b) => b.from <= now && now < b.until)?.value ?? null;
    const k = lineNow.indexOf(id);
    people.push({
      id, view, home: upcoming[0]?.origin ?? position(id, now), legs: upcoming.flatMap((e) => e.legs), gaze: [...upcoming.flatMap((e) => e.gaze), ...(gazes.get(id) ?? []).filter((g) => g.until > now)],
      pose, holding, since, seated, tired: tiredness(view.desk.context), bubble, presence, inLine: k >= 0 ? k : null,
      hushed: (hushes.get(id) ?? []).some((h) => h.from <= now && now < h.until),
      papers: k >= 0 ? Math.max(1, items.filter((i) => i.person === id && i.asked <= now && now < i.resolved).length) : 0,
      away: current !== undefined || home.kind !== 'desk', belongs: current?.stop ?? home.point, facing: home.kind === 'board' && drafted ? 0 : home.facing,
    });
    // Heads going down at night, sitting back after a walk, the still frame at the counter: the motion tier holds until
    // the pose has settled, so the cast changes again then and the tier can drop.
    if (settles(pose)) changes.push(since + SETTLE_MS);
    for (const s of spans) changes.push(s.from, s.until);
    for (const h of current?.holds ?? []) changes.push(h.from, h.until);
    for (const b of [...(current?.bubbles ?? []), ...(freeBubbles.get(id) ?? [])]) changes.push(b.from, b.until);
    for (const l of upcoming.flatMap((e) => (e.quiet ? [] : e.legs))) changes.push(l.at, l.at + l.ms);
    if (presence.from !== null) changes.push(presence.from);
    if (presence.until !== null) changes.push(presence.until);
    changes.push(...base.changes);
  }

  /** The pose of someone at rest wherever they belong (game-feel.md, section 7), and when it changes on its own. */
  function basePose(view: PersonView, home: Home): { pose: Pose; seated: boolean; since: number; holding: Holding; changes: number[] } {
    const d = view.desk;
    const stagger = hash01(view.id) * HEAD_STAGGER_MS;
    const landed = Math.max(Number.NEGATIVE_INFINITY, ...(homes.get(view.id) ?? []).filter((h) => h.at <= now).map((h) => h.at));
    if (home.kind === 'front' || home.kind === 'raised') return { pose: 'wait', seated: false, since: landed, holding: yoursAt(view.id, now) ? 'note-yours' : 'note', changes: [] };
    if (home.kind === 'board') {
      return drafted ? { pose: 'stand', seated: false, since: Math.max(drafted.at, landed), holding: 'none', changes: [] } : { pose: 'interact', seated: false, since: landed, holding: 'none', changes: [] };
    }
    if (home.kind === 'lounge') return { pose: 'lounge', seated: true, since: landed, holding: 'none', changes: [] };
    const night = nights.find((n) => n.from <= now && now < n.until);
    if (night) return { pose: 'sleep', seated: true, since: Math.max(night.from + stagger, landed), holding: 'none', changes: [] };
    const woke = nights.filter((n) => n.until <= now).reduce((t, n) => Math.max(t, n.until + stagger), Number.NEGATIVE_INFINITY);
    const after = (t: number) => Math.max(t, woke, landed);
    switch (d.state) {
      case 'working': {
        const agent = agentOf(view);
        const quiet = agent && agent.status === 'thinking' ? agent.lastEventAt + THINK_AFTER_MS : null;
        if (quiet !== null && now >= quiet) return { pose: 'think', seated: true, since: after(quiet), holding: 'none', changes: [] };
        return { pose: 'type', seated: true, since: after(d.since), holding: 'none', changes: quiet === null ? [] : [quiet] };
      }
      case 'starting':
        return { pose: 'think', seated: true, since: after(d.since), holding: 'none', changes: [] };
      case 'stopping':
        return now < d.since + LOOK_MS
          ? { pose: 'look', seated: true, since: after(d.since), holding: 'none', changes: [d.since + LOOK_MS] }
          : { pose: 'rest', seated: true, since: after(d.since + LOOK_MS), holding: 'none', changes: [] };
      case 'failed':
        return { pose: 'stuck', seated: true, since: after(d.since), holding: 'none', changes: [] };
      case 'waiting':
        return { pose: 'read', seated: true, since: after(d.since), holding: 'task', changes: [] };
      default:
        return { pose: 'rest', seated: true, since: after(d.since), holding: 'none', changes: woke > now ? [woke] : [] };
    }
  }

  function agentOf(view: PersonView): AgentState | undefined {
    return snapshot.agents.find((a) => (view.agentKey !== null && a.key === view.agentKey) || (view.desk.sessionId !== null && a.sessionId === view.desk.sessionId && a.agentId === null));
  }

  // ----- The scene
  const nightNow = nights.find((n) => n.from <= now && now < n.until) ?? null;
  const morning = nights.filter((n) => n.until <= now).sort((a, b) => b.until - a.until)[0] ?? null;
  let night: NightRamp | null = null;
  if (nightNow) night = { from: 0, to: 1, at: fresh(nightNow.from, nightNow.seen) ? nightNow.from : nightNow.from - NIGHT_FALL_MS, ms: options.reduced ? 0 : NIGHT_FALL_MS };
  else if (morning && now - morning.until < NIGHT_FALL_MS) night = { from: 1, to: 0, at: fresh(morning.until, morning.untilSeen) ? morning.until : morning.until - NIGHT_FALL_MS, ms: options.reduced ? 0 : NIGHT_FALL_MS };
  const level = night ? night.from + (night.to - night.from) * (night.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - night.at) / night.ms))) : 0;
  if (night) changes.push(night.at + night.ms);

  const trays: Tray[] = [];
  const papers: MomentProps['papers'] = [];
  for (const p of company.people) {
    const desk = deskOf(p.id);
    if (!desk) continue;
    const waiting = company.messages.filter((m) => m.to === p.id && m.at <= now && (m.deliveredAt === null || m.deliveredAt > now) && !carried.some((c) => c.message === m.id && c.from <= now && now < c.lands));
    if (waiting.length === 0) continue;
    const yours = waiting.some((m) => m.from === STAKEHOLDER || m.origin === STAKEHOLDER);
    trays.push({ person: p.id, notes: waiting.length, yours });
    const shown = Math.min(waiting.length, TRAY_PAPERS);
    for (let k = 0; k < shown; k++) papers.push({ person: p.id, x: desk.tray.x, z: desk.tray.z, yours: yours && k === shown - 1, index: k, stack: waiting.length > TRAY_PAPERS && k === shown - 1 });
  }
  for (const c of carried) changes.push(c.lands);
  for (const m of company.messages) if (m.deliveredAt !== null) changes.push(m.deliveredAt);
  for (const i of items) {
    changes.push(i.resolved);
    if (i.answered !== null) changes.push(i.answered);
  }

  // Desks keep what is on them while their person is away in Claude Code: cups, the plant, the notes.
  const cups: MomentProps['cups'] = [];
  const plants: MomentProps['plants'] = [];
  for (const p of company.people) {
    const desk = deskOf(p.id);
    if (!desk) continue;
    for (let k = 0; k < tiredness(p.desk.context); k++) {
      const spot = desk.cups[k];
      if (spot) cups.push({ x: spot.x, z: spot.z, index: k });
    }
    if (p.level === 'ceo') continue;
    const set = [...listOf(p.id)].reverse().find((e) => e.plantSet !== null)?.plantSet ?? Number.NEGATIVE_INFINITY;
    if (set <= now) plants.push({ x: desk.plant.x, z: desk.plant.z, hue: hueOf(p), since: set });
    else changes.push(set);
  }
  for (const person of people) {
    if (here.has(person.id) || person.view.level === 'ceo') continue;
    // Someone leaving keeps their plant on the desk until they pick it up.
    const desk = deskOf(person.id);
    const up = listOf(person.id).find((e) => e.plantUp !== null)?.plantUp ?? null;
    if (desk && up !== null && now < up) plants.push({ x: desk.plant.x, z: desk.plant.z, hue: hueOf(person.view), since: Number.NEGATIVE_INFINITY });
  }

  const frontDesk: MomentProps['frontDesk'] = reception
    ? { sign: reception.frontDesk.sign, lamp: reception.frontDesk.lamp, lit: lineNow.length > 0 || nightNow !== null, waiting: lineNow.length }
    : null;

  const cards: MomentProps['cards'] = [];
  const board = office?.meeting?.board;
  const milestones = (company.goal?.milestones ?? []).slice(0, 8);
  if (board && milestones.length > 0) {
    const cols = Math.min(milestones.length, 4);
    const w = Math.min(0.56, (board.w - 0.2) / cols - 0.08);
    milestones.forEach((m, i) => {
      const flip = flips.get(m.id);
      cards.push({
        x: board.x + ((i % 4) - (cols - 1) / 2) * (w + 0.08), y: board.y + board.h - 0.3 - Math.floor(i / 4) * 0.46, z: faces.milestone ?? board.z, w, h: 0.36,
        done: m.doneAt !== null && m.doneAt <= now, flippedAt: flip ?? null,
      });
    });
  }

  const pins: MomentProps['pins'] = [];
  const boxes: MomentProps['boxes'] = [];
  const orgBoard = office?.ceo.board;
  const orgFace = faces.org ?? orgBoard?.z ?? 0;
  /** The sketch while drafting, in three rows: one box, then three, then four. */
  const sketch = (board: WallPiece, k: number, since: number) => {
    const [row, inRow, at] = k === 0 ? [0, 1, 0] : k < 4 ? [1, 3, k - 1] : [2, 4, k - 4];
    boxes.push({ x: board.x + (at - (inRow - 1) / 2) * 0.82, y: board.y + board.h - 0.3 - row * 0.38, z: orgFace, w: 0.6, h: 0.24, since });
  };
  if (orgBoard && company.phase === 'founding') {
    // A box for every BOARD_BOX_MS of drawing since the founding, or since a draft turned down wiped the board; the pen
    // rests while the CEO waits for you.
    const started = Number.isFinite(founded) ? founded : (ceo?.desk.since ?? now);
    const restart = Math.max(started, recall.drafting.refusedAt);
    const stops = recall.drafting.stops.map((s) => ({ from: Math.max(s.from, restart), until: s.until ?? Number.POSITIVE_INFINITY })).filter((s) => s.until > s.from);
    for (let k = 0; k < BOARD_BOXES; k++) {
      const at = drawnBy(restart, stops, (k + 1) * BOARD_BOX_MS);
      if (at > now) {
        changes.push(at);
        break;
      }
      sketch(orgBoard, k, at);
    }
  } else if (orgBoard && company.phase === 'proposed') {
    // The proposal: the whole chart at once, the CEO over a box per room and a mark per person under their room.
    const since = proposal?.since ?? now;
    if (company.proposal) boxes.push(...chartOf(company.proposal, orgBoard, orgFace, since));
    else for (let k = 0; k < BOARD_BOXES; k++) sketch(orgBoard, k, since);
  } else if (orgBoard) {
    // Everyone on staff, away in Claude Code too, and whoever is on their way out until they are gone.
    const onStaff = [...company.people, ...people.filter((p) => !here.has(p.id)).map((p) => p.view)];
    (['ceo', 'head', 'lead', 'worker'] as const).forEach((lv, row) => {
      const level = onStaff.filter((p) => p.level === lv).sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : 0));
      const spread = Math.min(0.22, (orgBoard.w - 0.3) / Math.max(1, level.length));
      level.forEach((p, i) => {
        const arrival = listOf(p.id).find((e) => e.presenceFrom !== null);
        const leaving = here.has(p.id) ? null : (people.find((x) => x.id === p.id)?.presence.until ?? null);
        pins.push({
          x: orgBoard.x + (i - (level.length - 1) / 2) * spread, y: orgBoard.y + orgBoard.h - 0.18 - row * 0.3, z: orgBoard.z + 0.03,
          hue: lv === 'ceo' ? CEO_GOLD : hueOf(p), since: arrival?.presenceFrom ?? Number.NEGATIVE_INFINITY, until: leaving,
        });
      });
    });
  }

  // Office changes: rooms building in and taken out, new desks dropping in. Reduced motion cuts all three.
  const builtNow = [...built].filter(([, at]) => now < builtBy(at) + DESK_DROP_MS).map(([room, at]) => ({ room, at }));
  const takenOut = options.reduced
    ? []
    : [...recall.rooms].flatMap(([room, r]) => (r.gone !== null && r.gone > horizon && now < r.gone + ROOM_OUT_MS ? [{ room, ...r.rect, at: r.gone }] : []));
  const drops = options.reduced
    ? []
    : [...recall.desks.values()].flatMap((d) => {
      if (!Number.isFinite(d.first) || d.first <= horizon) return [];
      const room = built.get(d.room);
      const at = room === undefined ? d.first : room + BUILD_FLOOR_MS + BUILD_WALLS_MS;
      return now < at + DESK_DROP_MS + 600 ? [{ x: d.x, z: d.z, at }] : [];
    });
  for (const b of builtNow) changes.push(b.at, builtBy(b.at) + DESK_DROP_MS);
  for (const g of takenOut) changes.push(g.at + ROOM_OUT_MS);
  for (const d of drops) changes.push(d.at, d.at + DESK_DROP_MS + 600);
  const building = builtNow.some((b) => b.at <= now) || takenOut.length > 0 || drops.some((d) => d.at <= now);

  const moving = people.some((p) => p.legs.some((l) => l.at <= now && now < l.at + l.ms) || (settles(p.pose) && now - p.since < SETTLE_MS));
  const tier: CompanyPlan['tier'] = options.reduced
    ? 'still'
    : moving || building || celebration !== null || (night !== null && now < night.at + night.ms)
      ? 'motion'
      : people.some((p) => p.pose === 'type' || p.pose === 'think' || p.pose === 'interact')
        ? 'ambient'
        : 'still';

  return {
    people,
    moments: { night: level, trays, frontDesk: lineNow, celebration },
    props: { papers, cups, plants, frontDesk, cards, pins, boxes, streamers, built: builtNow, gone: takenOut, drops },
    night,
    changes: changes.filter((t) => Number.isFinite(t) && t > now),
    tier,
  };
}

/** A pose takes this long to settle (standing up, sitting down, heads on arms): the motion tier holds while it does. */
const SETTLE_MS = HEAD_DOWN_MS;
/** Every pose settles once, SETTLE_MS after it begins, except typing and thinking, which go on (the ambient tier). */
const settles = (pose: Pose): boolean => pose !== 'type' && pose !== 'think';

function sameHome(a: Home, b: Home): boolean {
  return a.kind === b.kind && a.index === b.index && Math.abs(a.point.x - b.point.x) < 1e-6 && Math.abs(a.point.z - b.point.z) < 1e-6;
}

/** What kind of moment a change of place is, from where they were and where they belong now. */
function changeOf(before: Home, after: Home, cause: Change): Change {
  if (after.kind === 'gone') return cause === 'away' ? 'away' : 'leave';
  if (before.kind === 'gone') return cause === 'back' ? 'back' : after.kind === 'board' ? 'board' : 'arrive';
  if (after.kind === 'front' || after.kind === 'raised' || before.kind === 'front' || before.kind === 'raised') return 'front';
  if (after.kind === 'board' || before.kind === 'board') return 'board';
  return 'lounge';
}

/** When `ms` of drawing is done counting from `from`, the pen resting through each stop; Infinity while one is open. */
function drawnBy(from: number, stops: readonly { from: number; until: number }[], ms: number): number {
  let t = from;
  let left = ms;
  for (const s of [...stops].sort((a, b) => a.from - b.from)) {
    if (s.until <= t) continue;
    const before = Math.max(0, s.from - t);
    if (before >= left) return t + left;
    left -= before;
    t = Math.max(t, s.until);
    if (!Number.isFinite(t)) return t;
  }
  return t + left;
}

const LEVEL_ORDER: Readonly<Record<Level, number>> = { ceo: 0, head: 1, lead: 2, worker: 3 };

/**
 * The org a proposal draws on the CEO's board: the CEO at the top, a box per room below, and under each a mark per
 * person in it, heads first, in a block that fits the board (beyond that a room's marks stop). `z` is the board's face.
 */
function chartOf(proposal: Pick<NonNullable<CompanyView['proposal']>, 'rooms' | 'people'>, board: WallPiece, z: number, since: number): MomentProps['boxes'] {
  const top = board.y + board.h;
  const out: MomentProps['boxes'] = [{ x: board.x, y: top - 0.17, z, w: 0.5, h: 0.14, since }];
  const rooms = proposal.rooms.filter((r) => proposal.people.some((p) => p.room === r.id && p.level !== 'ceo'));
  if (rooms.length === 0) return out;
  const w = Math.min(0.62, (board.w - 0.2) / rooms.length - 0.08);
  const mark = 0.07;
  const gap = 0.025;
  const cols = Math.max(1, Math.floor((w + gap) / (mark + gap)));
  const rows = Math.max(1, Math.floor((board.h - 0.64) / (mark + gap)));
  rooms.forEach((room, i) => {
    const x = board.x + (i - (rooms.length - 1) / 2) * (w + 0.08);
    out.push({ x, y: top - 0.42, z, w, h: 0.12, since });
    const people = proposal.people.filter((p) => p.room === room.id && p.level !== 'ceo').sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.id < b.id ? -1 : 1));
    const shown = people.slice(0, cols * rows);
    const across = Math.min(cols, shown.length);
    shown.forEach((_, k) => {
      out.push({ x: x + ((k % cols) - (across - 1) / 2) * (mark + gap), y: top - 0.6 - Math.floor(k / cols) * (mark + gap), z, w: mark, h: mark, since });
    });
  });
  return out;
}

function shiftExcursion(e: Excursion, shift: number) {
  if (shift === 0) return;
  e.start += shift;
  e.end += shift;
  const later = (t: number | null) => (t === null ? null : t + shift);
  e.presenceFrom = later(e.presenceFrom);
  e.presenceUntil = later(e.presenceUntil);
  e.plantSet = later(e.plantSet);
  e.plantUp = later(e.plantUp);
  e.legs = e.legs.map((l) => ({ ...l, at: l.at + shift }));
  const move = <T extends { from: number; until: number }>(list: T[]): T[] => list.map((s) => ({ ...s, from: s.from + shift, until: s.until + shift }));
  e.spans = move(e.spans);
  e.holds = move(e.holds);
  e.bubbles = move(e.bubbles);
  e.gaze = move(e.gaze);
  e.notes = e.notes.map((n) => ({ ...n, lands: n.lands + shift }));
}
