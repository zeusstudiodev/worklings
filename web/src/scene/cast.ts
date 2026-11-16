// Who stands where and what their bubble says. Turns the live agents into people at desks, extra copies of a role
// beside their desk and contractors in the lobby, and plans meetings at the lead's desk when the lead briefs someone
// and when someone reports back (docs/design.md, "Bubbles over people" and "Meetings: briefs and reports"). v3: an
// office that runs a company gets its people from the company, their moments from moments.ts, and visitors in
// reception's seats. Plain TypeScript on the snapshot's clock, so it can be tested without a browser.
import type { AsideAnswer, AsideCall } from '../../../src/core/aside.ts';
import { type CompanyView, introduce, type PersonView } from '../../../src/core/company.ts';
import type { BaseDepartment } from '../../../src/core/departments.ts';
import { coarseDuration, countWord, type PersonState, personState, STUCK_AFTER_MS } from '../../../src/core/now.ts';
import { type AgentState, type AgentStatus, agentCost, CONTRACTOR_LINGER_MS, DONE_SHOWN_MS, isActive, MEETING_MS } from '../../../src/core/office.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { inSentence, type Level } from '../../../src/core/studio.ts';
import { nameInSentence, severalLeads } from '../../../src/core/words.ts';
import { dollars } from '../lib/format.ts';
import { type Layout, type Point, seatOf } from './layout.ts';
import {
  type BubbleSpec, COUNTER_BUBBLES, firstLook, FRONT_DESK_PLACES, MomentLog, type MomentProps, type NightRamp, planCompany, WALK_BUDGET, WALK_BUDGET_PHONE,
} from './moments.ts';
import { DEPARTMENT_HUE, hash } from './palette.ts';
import type { BodyState, Pose, SceneMoments } from './poses.ts';
import { type Leg, pathLength, placeOn, route, subPath, walked, walkMs } from './walk.ts';

// Walks are geometry: they live in walk.ts, where the moments plan them too.
export { type Leg, type Placement, placeOn } from './walk.ts';

export type Accessory = 'none' | 'glasses' | 'headphones' | 'beret' | 'headset' | 'cap' | 'star';
export type PersonStatus = AgentStatus | 'off';

/** How long the two stand together at the lead's desk; without walking, how long the lead's brief bubble shows. */
export const STAND_MS = 2500;
/** At most this many meet at the lead's desk at once; beyond that nobody else walks. */
export const MEETING_SPOTS = 4;
/** A brief or report the browser first sees later than this after it happened makes nobody walk. */
export const FRESH_MS = 5000;
/** Replays faster than this play without walking. */
export const WALKING_SPEED_LIMIT = 4;
/** Bubbles are one line, cut at a word to about this many characters. */
export const BUBBLE_CHARS = 28;
export const BUBBLE_CHARS_NARROW = 22;
/** Briefs and reports older than this can no longer change who stands where. */
const HORIZON_MS = 30_000;
const LEAD_HUE = '#C9B458';
const CONTRACTOR_HUE = '#8C948F';
/** Where a role's extra copies stand, beside their own desk: in the aisle to its right, then in front of it. */
const EXTRA_SPOTS: readonly Point[] = [
  { x: 1.35, z: -0.15 },
  { x: -0.5, z: 1.05 },
  { x: 0.5, z: 1.05 },
];
/** The meeting arc in front of the lead's desk, middle spots first: angles from straight ahead, around the chair. */
const ARC = [-0.3, 0.3, -0.78, 0.78];
const ARC_RADIUS = 2.15;

/** How a bubble reads (docs/design.md, "Bubbles over people"). */
export type BubbleTone = 'needs-you' | 'answering' | 'stuck' | 'question' | 'report' | 'on-it' | 'meeting';

/** How long someone says "Answered you" after answering one of your questions, while their conversation is closed. */
export const ANSWERED_SHOWN_MS = 2 * 60_000;

export interface Bubble {
  tone: BubbleTone;
  /** Set in bold before the text: "Asks you:". */
  lead: string | null;
  text: string;
  /** On it: a dot that pulses while a step runs and stays still between steps. Reported back: an ink check mark. */
  dot: 'busy' | 'still' | 'check' | null;
}

/** While `from <= now < until` and standing still, the person turns toward `toward`. */
export interface Gaze {
  from: number;
  until: number;
  toward: Point;
}

export interface CastMember {
  key: string;
  /** Seed for how the person looks: the role id, so a role keeps its face across sessions. */
  look: string;
  title: string;
  /** How the office says who they are in a sentence: "the QA engineer", "the lead", "the Explore agent". */
  who: string;
  /** The role they fill (a desk and its extra copies), or null for leads and contractors. */
  roleId: string | null;
  hue: string;
  accessory: Accessory;
  /** Where the person is when not walking: a chair, a spot beside the desk or a lobby seat. */
  x: number;
  z: number;
  /** Stands there instead of sitting; everyone stands while walking. */
  standing: boolean;
  status: PersonStatus;
  bubble: Bubble | null;
  cost: string | null;
  /** What clicking selects. */
  target: { kind: 'role'; id: string } | { kind: 'agent'; key: string };
  agentKey: string | null;
  /** Walks to a meeting at the lead's desk and back, oldest first. Empty when nobody walks. */
  walk: Leg[];
  gaze: Gaze[];
  /** On the way to, at, or back from a meeting: the person keeps full colour while reporting. */
  meeting: boolean;
  /**
   * How near the camera the person belongs: their meeting spot while meeting, otherwise home. Nearer bubbles keep
   * their place when bubbles stack, and it holds still for a whole walk so nobody trades places on every step.
   */
  depth: number;
  /** v3: what the body does and holds now (poses.ts). */
  body: BodyState;
  /** v3: on a chair now, whatever the pose: a nod at the desk is seated, one at the front desk isn't. */
  seated: boolean;
  /** v3: the company's person this is, their level and room; null for visitors and in offices that only watch. */
  person: string | null;
  level: Level | null;
  room: string | null;
  /** v3: shown from (fading in at the model's edge on a first day) and until (fading out on the way out); null for always. */
  presence: { from: number | null; until: number | null };
  /** v3: papers in hand at the front desk, one per open item: more than one is a thicker stack. */
  papers: number;
  /**
   * v3: which way they face at rest, radians about the vertical axis with 0 toward the camera's side (+z): desks and
   * the front desk 0, a lounge seat its own way, the CEO's board away from the camera. While walking they face their way.
   */
  facing: number;
  /** v3: their place in the front desk's line, 0 first (from six on, at their own desk); null when nothing waits on you. */
  inLine: number | null;
  /**
   * v3: what their paper opens in the inbox: their oldest question or approval still waiting (answered ones count until
   * the answer applies), or `proposal` for the CEO's proposal; null when they wait on nothing.
   */
  item: string | null;
}

export interface Cast {
  members: CastMember[];
  /** The next moment on the snapshot clock when a bubble, a walk or a pose changes on its own; null if none. */
  nextChangeAt: number | null;
  /** The next moment in real time when an "Answered you" bubble goes; null if none. */
  nextRealChangeAt: number | null;
  /** v3: what the cast adds for the whole scene (poses.ts). */
  moments: SceneMoments;
  /** v3: the moments' props for MomentLayer; null in an office that only watches. */
  props: MomentProps | null;
  /** v3: the light easing between day and night, for the stage; null while it holds. */
  night: NightRamp | null;
  /** v3: still (nothing animates), ambient (people at work at their desks) or motion (walks, transitions). */
  tier: 'still' | 'ambient' | 'motion';
}

/** Questions put to people through Ask aside, as far as their bubbles go. Answers carry real time, not the snapshot's. */
export interface CastAsks {
  running: AsideCall | null;
  answers: readonly AsideAnswer[];
  /** The conversation that is open: a role's, or one agent's. */
  open: { roleId: string | null; agentKey: string | null } | null;
  realNow: number;
}

/** When the browser first saw an agent's brief and report, on the snapshot clock (see SeenLog). */
export interface Sightings {
  briefSeen(a: AgentState): number | undefined;
  reportSeen(a: AgentState): number | undefined;
  /** v3: what this browser saw of the company the office runs. */
  readonly moments?: MomentLog;
}

/** The parts of a snapshot the scene's people come from. */
export type SceneSnapshot = Pick<Snapshot, 'agents' | 'studio' | 'serverTime' | 'replay' | 'company'>;

export interface CastOptions {
  /** The snapshot clock now: the snapshot's time, or later while the scene waits for the next snapshot. */
  now?: number;
  seen?: Sightings;
  reducedMotion?: boolean;
  /** Phones cut bubbles shorter. */
  narrow?: boolean;
  asks?: CastAsks;
  /** v3: people out walking at once; phones and the frame governor lower it (docs/game-feel.md). */
  budget?: number;
  /** v3: when a click on the stage or Escape asked to seat everyone still walking in. */
  skipAt?: number | null;
}

/** A scene that holds still: no night, no trays, nobody at the front desk. */
const NO_MOMENTS: SceneMoments = { night: 0, trays: [], frontDesk: [], celebration: null };

/** When someone was last briefed: their start, or the lead's SendMessage that continued them. */
const briefedAt = (a: AgentState): number => a.briefedAt ?? a.startedAt;

/**
 * Remembers when this browser first saw each brief (a subagent's start, or the lead continuing it) and report (its end),
 * so an office opened mid-session doesn't replay old meetings. A replay that jumps back starts over, and an agent that
 * starts again (the demo loops) or is briefed again counts as new.
 */
export class SeenLog implements Sightings {
  private latest = Number.NEGATIVE_INFINITY;
  private readonly briefs = new Map<string, { at: number; seen: number }>();
  private readonly reports = new Map<string, { at: number; seen: number }>();
  /** v3: the company's moments (moments.ts), noted with the same snapshots. */
  readonly moments = new MomentLog();

  note(snapshot: SceneSnapshot, layout: Layout | null = null): void {
    this.moments.note(snapshot, layout);
    const now = snapshot.serverTime;
    if (now < this.latest) {
      this.briefs.clear();
      this.reports.clear();
    }
    this.latest = now;
    const present = new Set<string>();
    for (const a of snapshot.agents) {
      if (!a.agentId) continue;
      present.add(a.key);
      if (this.briefs.get(a.key)?.at !== briefedAt(a)) this.briefs.set(a.key, { at: briefedAt(a), seen: now });
      if (a.endedAt === null) this.reports.delete(a.key);
      else if (this.reports.get(a.key)?.at !== a.endedAt) this.reports.set(a.key, { at: a.endedAt, seen: now });
    }
    for (const key of this.briefs.keys()) if (!present.has(key)) this.briefs.delete(key);
    for (const key of this.reports.keys()) if (!present.has(key)) this.reports.delete(key);
  }

  briefSeen(a: AgentState): number | undefined {
    const b = this.briefs.get(a.key);
    return b && b.at === briefedAt(a) ? b.seen : undefined;
  }

  reportSeen(a: AgentState): number | undefined {
    const r = this.reports.get(a.key);
    return r && r.at === a.endedAt ? r.seen : undefined;
  }
}

/** How fast the snapshot clock runs in the browser: real time live and in the demo, the replay's speed while it plays. */
export const clockRate = (snapshot: SceneSnapshot): number => (snapshot.replay ? (snapshot.replay.playing ? snapshot.replay.speed : 0) : 1);

/** The snapshot clock between snapshots: the last snapshot's time, moved on at its rate since it arrived. */
export class SceneClock {
  private base = 0;
  private since = 0;
  private rate = 1;

  sync(snapshot: SceneSnapshot, at: number) {
    this.base = snapshot.serverTime;
    this.since = at;
    this.rate = clockRate(snapshot);
  }

  now(at: number): number {
    return this.base + Math.max(0, at - this.since) * this.rate;
  }
}

/** Where a standing person looks, if anywhere. */
export function gazeAt(gaze: readonly Gaze[], now: number): Point | null {
  for (const g of gaze) if (g.from <= now && now < g.until) return g.toward;
  return null;
}

/** A spot in the meeting arc in front of the lead's desk. */
export function meetingSpot(layout: Layout, slot: number): Point {
  const seat = seatOf(layout.lead.desk);
  const angle = ARC[slot] ?? 0;
  return { x: seat.x + ARC_RADIUS * Math.sin(angle), z: seat.z + ARC_RADIUS * Math.cos(angle) };
}

/**
 * The figure a conversation belongs to: whoever shows the call asked, else the role's desk. Null for someone with no
 * figure (a fifth copy of a role, a contractor beyond the lobby's seats).
 */
export function figureFor(members: readonly CastMember[], target: { roleId: string | null; agentKey: string | null }): string | null {
  const shown = target.agentKey !== null ? members.find((m) => m.agentKey === target.agentKey) : undefined;
  if (shown) return shown.key;
  return target.roleId !== null ? (members.find((m) => m.key === `desk:${target.roleId}`)?.key ?? null) : null;
}

export function accessoryFor(roleId: string, style: BaseDepartment | null): Accessory {
  if (roleId === 'sound-designer') return 'headphones';
  switch (style) {
    case 'quality':
    case 'data':
      return 'glasses';
    case 'design':
    case 'art':
      return 'beret';
    case 'ops':
      return 'headset';
    case 'security':
      return 'cap';
    default:
      return 'none';
  }
}

/** Words a cut line shouldn't end on: "Design the streak card…", not "Design the streak card and…". */
const LITTLE_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'for', 'with', 'in', 'on', 'at', 'by', 'from', 'into', 'as', 'is', 'are', 'that', 'so']);

/** One line of at most `max` characters, cut at a word with "…"; a long path or command is cut where it must. */
export function cut(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const kept: string[] = [];
  let length = 0;
  for (const word of line.split(' ')) {
    const next = length === 0 ? word.length : length + 1 + word.length;
    if (next > max) break;
    kept.push(word);
    length = next;
  }
  if (length < max * 0.6) return `${line.slice(0, max - 1).trimEnd()}…`;
  while (kept.length > 1 && LITTLE_WORDS.has((kept[kept.length - 1] ?? '').toLowerCase())) kept.pop();
  return `${kept.join(' ').replace(/[\s,;:.!?–-]+$/, '')}…`;
}

/** The first sentence of a report, without Markdown: headings are skipped, list marks and emphasis dropped. */
export function firstSentence(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const line = (lines.find((l) => !/^#{1,6}\s/.test(l)) ?? lines[0] ?? '')
    .replace(/^#{1,6}\s+|^[-*+]\s+|^\d+[.)]\s+|^>\s*/, '')
    .replace(/[*_`]+/g, '')
    .trim();
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(line);
  return (sentence?.[1] ?? line).trim();
}

const byStart = (a: AgentState, b: AgentState) => a.startedAt - b.startedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const lastSeen = (a: AgentState) => a.endedAt ?? a.lastEventAt;
const latestOf = (agents: readonly AgentState[]) => agents.reduce<AgentState | undefined>((best, a) => (!best || lastSeen(a) > lastSeen(best) ? a : best), undefined);

/** Its stop came with a report, so there is something to bring to the lead. */
const reported = (a: AgentState): boolean => a.endedAt !== null && a.reportedAt === a.endedAt;

/** The person a figure stands for, and how it moves: from where its brief starts, and whether it leaves after. */
interface Figure {
  key: string;
  home: Point;
  /** Desk people start from their desk; extra copies and contractors at the lobby door. */
  entry: Point;
  /** Contractors leave through the lobby door after reporting. */
  leaves: boolean;
}

interface Plan {
  agent: AgentState;
  kind: 'brief' | 'report';
  /** When the brief or report happened. */
  at: number;
  walked: boolean;
  slot: number;
  spot: Point | null;
  legs: Leg[];
  arriveAt: number;
  returnAt: number;
  backAt: number;
}

interface Draft {
  member: CastMember;
  agent: AgentState | undefined;
  lead: boolean;
}

/** On the way back from a meeting, or still on the way to it: the way back to the spot from where they are at `at`. */
function backToSpot(plan: Plan, at: number): Point[] | null {
  const [there, back] = plan.legs;
  if (!there || !back || !plan.spot) return null;
  if (at < there.at + there.ms) return subPath(there.path, walked(there, at), pathLength(there.path));
  if (at < back.at) return [plan.spot, plan.spot];
  return subPath(back.path, walked(back, at), 0);
}

export function castFrom(snapshot: SceneSnapshot, layout: Layout, options: CastOptions = {}): Cast {
  const company = snapshot.company;
  if (company && layout.office) return companyCast({ ...snapshot, company }, layout, options);
  return studioCast(snapshot, layout, options);
}

function studioCast(snapshot: SceneSnapshot, layout: Layout, options: CastOptions): Cast {
  const now = options.now ?? snapshot.serverTime;
  const max = options.narrow ? BUBBLE_CHARS_NARROW : BUBBLE_CHARS;
  const canWalk = !options.reducedMotion && (snapshot.replay?.speed ?? 1) <= WALKING_SPEED_LIMIT;
  const fresh = (a: AgentState, kind: Plan['kind'], at: number) => ((kind === 'brief' ? options.seen?.briefSeen(a) : options.seen?.reportSeen(a)) ?? now) - at <= FRESH_MS;
  // Someone who reported back stays on show through the meeting and the report's bubble after it.
  const shownUntil = (a: AgentState) => {
    if (a.endedAt === null) return Number.POSITIVE_INFINITY;
    const meets = reported(a) && canWalk && fresh(a, 'report', a.endedAt);
    return a.endedAt + (meets ? MEETING_MS : 0) + DONE_SHOWN_MS;
  };
  const statusOf = (a: AgentState | undefined): PersonStatus => {
    if (!a) return 'off';
    if (isActive(a.status)) return a.status;
    return a.status === 'done' && now < shownUntil(a) ? 'done' : 'off';
  };

  const studio = snapshot.studio;
  const styleOf = new Map(studio?.departments.map((d) => [d.id, d.style]) ?? []);
  const deptOf = new Map(studio?.roles.map((r) => [r.id, r.department]) ?? []);
  const byRole = new Map<string, AgentState[]>();
  const leads: AgentState[] = [];
  const several = severalLeads(snapshot.agents);
  const contractors: AgentState[] = [];
  for (const a of snapshot.agents) {
    const copies = a.roleId && layout.desks.has(a.roleId) ? (byRole.get(a.roleId) ?? byRole.set(a.roleId, []).get(a.roleId)) : undefined;
    if (a.kind === 'lead') leads.push(a);
    else if (copies) copies.push(a);
    else contractors.push(a);
  }

  const drafts: Draft[] = [];
  const figures = new Map<string, Figure>();
  const blank = () => ({ bubble: null, walk: [], gaze: [], meeting: false, depth: 0, body: STILL_BODY, seated: true, person: null, level: null, room: null, presence: ALWAYS, papers: 0, facing: 0, inLine: null, item: null });

  for (const [roleId, desk] of layout.desks) {
    const style = styleOf.get(deptOf.get(roleId) ?? '') ?? 'engineering';
    const hue = DEPARTMENT_HUE[style];
    const agents = byRole.get(roleId) ?? [];
    // Copies of a role keep their places in the order they started, so nobody swaps places on every tool call.
    const shown = agents.filter((a) => statusOf(a) !== 'off').sort(byStart);
    const primary = shown[0] ?? latestOf(agents);
    const seat = seatOf(desk);
    drafts.push({
      agent: primary,
      lead: false,
      member: {
        key: `desk:${roleId}`, look: roleId, title: desk.title, who: nameInSentence({ kind: 'role', name: desk.title, agentType: roleId, sessionId: '' }), roleId, hue, accessory: accessoryFor(roleId, style), x: seat.x, z: seat.z, standing: false,
        status: statusOf(primary), cost: agents.length > 0 ? dollars(agents.reduce((s, a) => s + agentCost(a), 0)) : null,
        target: { kind: 'role', id: roleId }, agentKey: primary?.key ?? null, ...blank(),
      },
    });
    if (primary) figures.set(primary.key, { key: `desk:${roleId}`, home: seat, entry: seat, leaves: false });
    // More than one copy of a role at once: the others stand beside the desk, inside the room.
    shown.slice(1, 1 + EXTRA_SPOTS.length).forEach((a, i) => {
      const offset = EXTRA_SPOTS[i] ?? { x: 0, z: 0 };
      const home = { x: desk.x + offset.x, z: desk.z + offset.z };
      drafts.push({
        agent: a,
        lead: false,
        member: {
          key: a.key, look: `${roleId}#${i + 1}`, title: a.helperOf ? a.name : desk.title, who: nameInSentence(a), roleId, hue, accessory: accessoryFor(roleId, style), x: home.x, z: home.z, standing: true,
          status: statusOf(a), cost: dollars(agentCost(a)), target: { kind: 'agent', key: a.key }, agentKey: a.key, ...blank(),
        },
      });
      figures.set(a.key, { key: a.key, home, entry: layout.lobby.entrance, leaves: false });
    });
  }

  // The lead who has been at work longest keeps the desk; other sessions' leads stand beside it.
  const activeLeads = leads.filter((a) => isActive(a.status)).sort(byStart);
  const mainLead = activeLeads[0] ?? latestOf(leads);
  const leadDesk = layout.lead.desk;
  const leadSeat = seatOf(leadDesk);
  drafts.push({
    agent: mainLead,
    lead: true,
    member: {
      key: 'lead', look: 'lead', title: 'Lead', who: mainLead ? nameInSentence(mainLead, several) : 'the lead', roleId: null, hue: LEAD_HUE, accessory: 'star', x: leadSeat.x, z: leadSeat.z, standing: false,
      status: mainLead ? (isActive(mainLead.status) ? mainLead.status : 'idle') : 'off',
      cost: mainLead ? dollars(leads.reduce((s, a) => s + agentCost(a), 0)) : null,
      target: mainLead ? { kind: 'agent', key: mainLead.key } : { kind: 'role', id: 'lead' }, agentKey: mainLead?.key ?? null, ...blank(),
    },
  });
  activeLeads
    .filter((a) => a !== mainLead)
    .slice(0, 2)
    .forEach((a, i) => {
      drafts.push({
        agent: a,
        lead: true,
        member: {
          key: a.key, look: `lead#${i + 1}`, title: 'Lead (another session)', who: nameInSentence(a, several), roleId: null, hue: LEAD_HUE, accessory: 'star', x: leadDesk.x - 1.6 - i * 0.8,
          z: leadDesk.z - 0.3, standing: true, status: a.status, cost: dollars(agentCost(a)), target: { kind: 'agent', key: a.key }, agentKey: a.key, ...blank(),
        },
      });
    });

  contractors
    .filter((a) => isActive(a.status) || a.status === 'idle' || (a.endedAt !== null && now - a.endedAt < CONTRACTOR_LINGER_MS))
    .sort(byStart)
    .slice(-layout.lobby.seats.length)
    .forEach((a, i) => {
      const seat = layout.lobby.seats[i];
      if (!seat) return;
      const status = statusOf(a);
      drafts.push({
        agent: a,
        lead: false,
        member: {
          key: a.key, look: a.agentType, title: a.name, who: nameInSentence(a), roleId: null, hue: CONTRACTOR_HUE, accessory: 'none', x: seat.x, z: seat.z, standing: true,
          status: status === 'off' ? 'done' : status, cost: dollars(agentCost(a)), target: { kind: 'agent', key: a.key }, agentKey: a.key, ...blank(),
        },
      });
      figures.set(a.key, { key: a.key, home: seat, entry: layout.lobby.entrance, leaves: true });
    });

  // Meetings, oldest first, so each one knows who already stands at the desk and where everyone is.
  const plans = new Map<string, Plan[]>();
  const walking: Plan[] = [];
  if (mainLead) {
    const requests: { agent: AgentState; kind: Plan['kind']; at: number }[] = [];
    for (const a of snapshot.agents) {
      if (!a.agentId || a.sessionId !== mainLead.sessionId) continue;
      if (briefedAt(a) > now - HORIZON_MS) requests.push({ agent: a, kind: 'brief', at: Math.min(briefedAt(a), now) });
      if (a.endedAt !== null && reported(a) && a.endedAt > now - HORIZON_MS) requests.push({ agent: a, kind: 'report', at: Math.min(a.endedAt, now) });
    }
    requests.sort((x, y) => x.at - y.at || (x.kind === y.kind ? 0 : x.kind === 'brief' ? -1 : 1) || (x.agent.key < y.agent.key ? -1 : 1));
    for (const r of requests) {
      const own = plans.get(r.agent.key) ?? [];
      const last = own[own.length - 1];
      // A new meeting while still on the way back from the last one turns them around, in the same spot.
      const ongoing = last?.walked && r.at < last.backAt ? last : undefined;
      let plan: Plan = { ...r, walked: false, slot: -1, spot: null, legs: [], arriveAt: r.at, returnAt: r.at, backAt: r.at };
      const figure = figures.get(r.agent.key);
      if (canWalk && figure && fresh(r.agent, r.kind, r.at)) {
        const taken = new Set(walking.filter((p) => p !== ongoing && p.at <= r.at && r.at < p.backAt).map((p) => p.slot));
        const slot = ongoing ? ongoing.slot : Array.from({ length: MEETING_SPOTS }, (_, i) => i).find((s) => !taken.has(s));
        if (slot !== undefined) {
          const spot = meetingSpot(layout, slot);
          const there = ongoing ? backToSpot(ongoing, r.at) : route(layout, r.kind === 'brief' ? figure.entry : figure.home, spot);
          const back = route(layout, spot, r.kind === 'report' && figure.leaves ? layout.lobby.entrance : figure.home);
          if (there && back) {
            const arriveAt = r.at + walkMs(pathLength(there));
            const returnAt = arriveAt + STAND_MS;
            const backAt = returnAt + walkMs(pathLength(back));
            plan = { ...r, walked: true, slot, spot, legs: [{ at: r.at, ms: arriveAt - r.at, path: there }, { at: returnAt, ms: backAt - returnAt, path: back }], arriveAt, returnAt, backAt };
            if (ongoing) ongoing.backAt = r.at;
            walking.push(plan);
          }
        }
      }
      own.push(plan);
      plans.set(r.agent.key, own);
    }
  }

  // The lead's briefs on show right now: while the person briefed is there, or 2.5 s by bubble alone, stretched while
  // others briefed with it still stand at the desk ("Briefs five people" while four of them are there).
  const leadUntil = (p: Plan) =>
    p.walked ? p.returnAt : Math.max(p.at + STAND_MS, ...walking.filter((w) => w.kind === 'brief' && w.at <= p.at && p.at < w.returnAt).map((w) => w.returnAt));
  const briefing = [...plans.values()].flat().filter((p) => p.kind === 'brief' && p.at <= now && now < leadUntil(p));
  const changes: number[] = [];
  const members: CastMember[] = [];

  // Ask aside: a question goes to the figure that shows the call asked, or, for a role's call without a figure of its
  // own, to the role's desk.
  const figureOf = new Map(drafts.flatMap((d) => (d.agent ? [[d.agent.key, d.member.key] as const] : [])));
  const figureFor = (agentKey: string | null, roleId: string | null) =>
    (agentKey !== null ? figureOf.get(agentKey) : undefined) ?? (roleId !== null && layout.desks.has(roleId) ? `desk:${roleId}` : null);
  const asked = options.asks;
  const answering = asked?.running?.kind === 'ask' ? figureFor(asked.running.agentKey, asked.running.roleId) : null;
  const isOpen = (a: AsideAnswer) => {
    const open = asked?.open;
    return Boolean(open && (open.roleId !== null ? open.roleId === a.roleId : open.agentKey === a.agentKey));
  };
  // Who has answered you in the last two minutes, while their conversation is closed, and when the bubble goes.
  const answered = new Map<string, number>();
  for (const a of asked?.answers ?? []) {
    if (!asked || a.text === null || asked.realNow - a.answeredAt >= ANSWERED_SHOWN_MS || isOpen(a)) continue;
    const key = figureFor(a.agentKey, a.roleId);
    if (key !== null) answered.set(key, Math.max(answered.get(key) ?? 0, a.answeredAt + ANSWERED_SHOWN_MS));
  }

  for (const { member, agent, lead } of drafts) {
    const own = agent && figures.get(agent.key)?.key === member.key ? (plans.get(agent.key) ?? []) : [];
    const current = own.filter((p) => p.walked && now < p.backAt);
    // Contractors leave through the lobby door after reporting.
    if (agent && figures.get(agent.key)?.leaves && own.some((p) => p.kind === 'report' && p.walked && now >= p.backAt)) continue;
    member.walk = current.flatMap((p) => p.legs);
    member.gaze = current.map((p) => ({ from: p.arriveAt, until: p.returnAt, toward: leadSeat }));
    member.meeting = current.length > 0;
    // The camera looks from +x and +z, so x + z grows toward it.
    const belongs = current[0]?.spot ?? member;
    member.depth = belongs.x + belongs.z;
    if (member.key === 'lead') member.gaze = walking.filter((p) => now < p.returnAt && p.spot).map((p) => ({ from: p.arriveAt - 400, until: p.returnAt, toward: p.spot ?? leadSeat }));
    if (member.meeting && member.status === 'off') member.status = 'done';
    member.bubble = agent ? bubbleFor(member.key, agent, lead, member.key === 'lead' ? briefing : [], own) : null;
    // On a phone, while people stand together at the lead's desk, only the lead's bubble shows there (anyone who needs
    // you still does); on their way over and back their own bubbles show.
    const standing = current.some((p) => p.arriveAt <= now && now < p.returnAt);
    if (options.narrow && standing && member.bubble && member.bubble.tone !== 'needs-you' && member.bubble.tone !== 'answering') member.bubble = null;
    if (member.bubble?.tone === 'stuck' && agent) changes.push(agent.statusSince + 60_000 * (Math.floor((now - agent.statusSince) / 60_000) + 1));
    const { body, seated } = studioBody(member, agent, now);
    member.body = body;
    member.seated = seated;
    members.push(member);
  }

  function bubbleFor(key: string, a: AgentState, isLead: boolean, briefs: Plan[], own: Plan[]): Bubble | null {
    const state = personState(a, now);
    if (state.kind === 'needs-ok') return line('needs-you', `Needs your OK to ${state.what}`);
    if (state.kind === 'needs-answer') return state.question ? question('needs-you', 'Asks you:', state.question) : line('needs-you', 'Needs your answer');
    // During a meeting its lines take over.
    if (isLead && briefs.length > 1) return line('meeting', `Briefs ${countWord(briefs.length)} people`);
    const briefed = briefs[0]?.agent;
    if (isLead && briefed) return line('meeting', briefed.task ?? `Briefs ${nameInSentence(briefed, several)}`);
    const report = own.find((p) => p.kind === 'report' && p.at <= now && now < (p.walked ? p.backAt : p.at + DONE_SHOWN_MS));
    if (report) return said(firstSentence(a.lastMessage ?? '') || 'Done');
    const brief = own.find((p) => p.kind === 'brief' && p.at <= now && now < (p.walked ? p.backAt : p.at + STAND_MS));
    if (brief) return briefing.length > 1 ? onIt(a, isLead) : line('meeting', 'On it');
    if (key === answering) return line('answering', 'Answering you…');
    if (answered.has(key)) return line('answering', 'Answered you');
    return plain(a, state, isLead, own);
  }

  function plain(a: AgentState, state: PersonState, isLead: boolean, own: Plan[]): Bubble | null {
    switch (state.kind) {
      case 'stuck':
        return line('stuck', `Stuck for ${coarseDuration(now - state.since)}`);
      case 'has-question':
        return question('question', isLead ? 'Asks you:' : 'Asks the lead:', state.question);
      case 'on-it':
        return onIt(a, isLead);
      case 'done': {
        if (isLead) return state.result ? said(firstSentence(state.result)) : null;
        // A subagent's report stays up 8 s after its meeting; one that stopped without a report just says so.
        const met = own.find((p) => p.kind === 'report' && p.walked);
        if (met) return now < met.backAt + DONE_SHOWN_MS ? said(firstSentence(a.lastMessage ?? '') || 'Done') : null;
        return !reported(a) && a.endedAt !== null && now < a.endedAt + DONE_SHOWN_MS ? said('Done') : null;
      }
      default:
        return null;
    }
  }

  function onIt(a: AgentState, isLead: boolean): Bubble {
    const goal = isLead ? a.purpose : a.task;
    // The dot takes about two characters' room.
    return { tone: 'on-it', lead: null, text: goal ? cut(goal, max - 2) : 'On it', dot: a.tool ? 'busy' : 'still' };
  }

  /** What someone reported, or the lead's last word, after a check mark: sentence case whatever the agent wrote. */
  function said(text: string): Bubble {
    return { tone: 'report', lead: null, text: cut(text.charAt(0).toUpperCase() + text.slice(1), max), dot: 'check' };
  }

  function line(tone: BubbleTone, text: string): Bubble {
    return { tone, lead: null, text: cut(text, max), dot: null };
  }

  function question(tone: BubbleTone, lead: string, text: string): Bubble {
    return { tone, lead, text: cut(text, max - lead.length - 1), dot: null };
  }

  for (const p of [...plans.values()].flat()) changes.push(p.at + STAND_MS, p.at + DONE_SHOWN_MS, p.arriveAt, p.returnAt, p.backAt, p.backAt + DONE_SHOWN_MS);
  for (const a of snapshot.agents) {
    if (a.endedAt !== null) changes.push(a.endedAt + DONE_SHOWN_MS, shownUntil(a), a.endedAt + CONTRACTOR_LINGER_MS);
    if (a.status === 'error' && a.errorFrom === 'tool') changes.push(a.statusSince + STUCK_AFTER_MS);
  }
  const upcoming = changes.filter((t) => t > now);
  const goes = [...answered.values()];
  const walkingNow = members.some((m) => m.walk.some((l) => l.at <= now && now < l.at + l.ms));
  const tier = options.reducedMotion ? 'still' : walkingNow ? 'motion' : members.some((m) => m.status === 'working' || m.status === 'thinking') ? 'ambient' : 'still';
  return {
    members, nextChangeAt: upcoming.length > 0 ? Math.min(...upcoming) : null, nextRealChangeAt: goes.length > 0 ? Math.min(...goes) : null,
    moments: NO_MOMENTS, props: null, night: null, tier,
  };
}

/** Before a pose is known: seated at rest. */
const STILL_BODY: BodyState = { pose: 'rest', holding: 'none', tired: 0, restPose: 0, outfit: {}, since: 0, visitor: false };
const ALWAYS = { from: null, until: null };

/** What a person in an office that only watches does: v2's walks and statuses as poses, for the people renderer. */
function studioBody(m: CastMember, agent: AgentState | undefined, now: number): { body: BodyState; seated: boolean } {
  const at = placeOn(m.walk, m, now);
  const leg = [...m.walk].reverse().find((l) => l.at <= now);
  let pose: Pose;
  let since = agent?.statusSince ?? now;
  if (at.heading !== null && leg) {
    pose = 'walk';
    since = leg.at;
  } else if (at.away) {
    pose = gazeAt(m.gaze, now) ? 'talk' : 'stand';
    since = leg ? leg.at + leg.ms : since;
  } else if (m.standing) {
    pose = 'stand';
  } else {
    // Postures never change per tool call: working and thinking both type.
    pose = m.status === 'working' || m.status === 'thinking' ? 'type' : m.status === 'waiting' ? 'look' : m.status === 'error' ? 'stuck' : 'rest';
    if (leg) since = Math.max(since, leg.at + leg.ms);
  }
  const seated = pose === 'type' || pose === 'look' || pose === 'stuck' || pose === 'rest';
  return { body: { pose, holding: 'none', tired: 0, restPose: restPoseOf(m.look), outfit: {}, since, visitor: false }, seated };
}

const restPoseOf = (look: string): 0 | 1 | 2 => (hash(look) % 3 === 0 ? 0 : hash(look) % 3 === 1 ? 1 : 2);

// ---------------------------------------------------------------------------------------------------------------
// v3: an office that runs a company

/**
 * Words for an approval or question waiting at the front desk, and the CEO's proposal. A gate (the office asking before
 * someone on "check with me" starts a task) is the inbox's, not something they bring to the desk.
 */
function needsYouBubble(company: CompanyView, id: string, max: number): Bubble | null {
  const open = [
    ...company.approvals.filter((a) => a.person === id && !a.answer && !a.withdrawn).map((a) => ({ at: a.askedAt, bubble: lineOf('needs-you', `Needs your OK to ${inSentence(a.summary)}`, max) })),
    ...company.questions.filter((q) => q.from === id && !q.gate && !q.answer && !q.withdrawn).map((q) => ({ at: q.askedAt, bubble: questionOf('needs-you', 'Asks you:', q.text, max) })),
  ].sort((a, b) => a.at - b.at);
  const first = open[0];
  if (first) return first.bubble;
  const ceo = company.people.find((p) => p.id === id && p.level === 'ceo');
  return ceo && company.phase === 'proposed' && company.proposal ? lineOf('needs-you', 'Proposal ready for you', max) : null;
}

/**
 * The inbox item someone's paper stands for: their oldest question or approval not yet settled (an answer counts as
 * settled once it applies), or the CEO's proposal while it waits for your OK. Gates are nobody's paper.
 */
export function itemOf(company: CompanyView, id: string, now: number): string | null {
  const unsettled = (answer: { appliesAt: number } | null, withdrawn: unknown) => !withdrawn && (answer === null || answer.appliesAt > now);
  const waiting = [
    ...company.approvals.filter((a) => a.person === id && unsettled(a.answer, a.withdrawn)).map((a) => ({ id: a.id, at: a.askedAt })),
    ...company.questions.filter((q) => q.from === id && !q.gate && unsettled(q.answer, q.withdrawn)).map((q) => ({ id: q.id, at: q.askedAt })),
  ].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const first = waiting[0];
  if (first) return first.id;
  const ceo = company.people.some((p) => p.id === id && p.level === 'ceo');
  return ceo && company.phase === 'proposed' && company.proposal ? 'proposal' : null;
}

const lineOf = (tone: BubbleTone, text: string, max: number): Bubble => ({ tone, lead: null, text: cut(text, max), dot: null });
const questionOf = (tone: BubbleTone, lead: string, text: string, max: number): Bubble => ({ tone, lead, text: cut(text, max - lead.length - 1), dot: null });

/** A moment's words cut to one line. */
function cutSpec(spec: BubbleSpec, max: number): Bubble {
  const raw = spec.sentence ? firstSentence(spec.text) : spec.text;
  const text = spec.tone === 'report' ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
  return { tone: spec.tone, lead: spec.lead, text: cut(text, spec.lead ? max - spec.lead.length - 1 : max), dot: spec.tone === 'report' ? 'check' : null };
}

/** "Ada, Head of design", or the title alone for someone with no name: the name tag. */
const titleOf = (p: Pick<PersonView, 'name' | 'title'>) => (p.name === p.title ? p.title : `${p.name}, ${inSentence(p.title)}`);

function companyCast(snapshot: SceneSnapshot & { company: CompanyView }, layout: Layout, options: CastOptions): Cast {
  const company = snapshot.company;
  const now = options.now ?? snapshot.serverTime;
  const max = options.narrow ? BUBBLE_CHARS_NARROW : BUBBLE_CHARS;
  const reduced = Boolean(options.reducedMotion);
  const recall = options.seen?.moments?.recall(snapshot, layout) ?? firstLook(snapshot, layout);
  const plan = planCompany(snapshot, layout, recall, {
    now, reduced, narrow: Boolean(options.narrow), skipAt: options.skipAt ?? null,
    motion: !reduced && (snapshot.replay?.speed ?? 1) <= WALKING_SPEED_LIMIT,
    budget: options.budget ?? (options.narrow ? WALK_BUDGET_PHONE : WALK_BUDGET),
  });
  const changes = [...plan.changes];
  const styleOf = new Map(layout.rooms.map((r) => [r.id, r.style]));
  const agentFor = (p: PersonView) =>
    snapshot.agents.find((a) => (p.agentKey !== null && a.key === p.agentKey) || (p.desk.sessionId !== null && a.sessionId === p.desk.sessionId && a.agentId === null));

  const members: CastMember[] = [];
  for (const person of plan.people) {
    const p = person.view;
    const style = styleOf.get(p.room) ?? 'direction';
    const agent = agentFor(p);
    // In an all-hands' crowd one voice speaks: everyone else's words wait until they are back.
    const bubble = person.bubble ? cutSpec(person.bubble, max) : person.hushed ? null : stateBubble(p, person.inLine, agent);
    members.push({
      key: `desk:${p.id}`, look: p.id, title: titleOf(p), who: introduce(p), roleId: p.id, hue: p.level === 'ceo' ? LEAD_HUE : DEPARTMENT_HUE[style],
      accessory: accessoryFor(p.id, style), x: person.home.x, z: person.home.z, standing: !person.seated,
      status: person.inLine !== null ? 'waiting' : statusOf(p, agent), bubble, cost: dollars(p.cost), target: { kind: 'role', id: p.id }, agentKey: p.agentKey,
      walk: person.legs, gaze: person.gaze, meeting: person.legs.length > 0, depth: person.belongs.x + person.belongs.z,
      body: { pose: person.pose, holding: person.holding, tired: person.tired, restPose: restPoseOf(p.id), outfit: { ...p.look }, since: person.since, visitor: false },
      seated: person.seated, person: p.id, level: p.level, room: p.room, presence: person.presence, papers: person.papers, facing: person.facing,
      inLine: person.inLine, item: person.inLine === null ? null : itemOf(company, p.id, now),
    });
  }

  // v0.4 (SPEC-v0.4.md, H2): the helpers a person's desk started (Claude Code subagents) stand beside their desk while
  // they work, and a little after, saying what they were asked to do.
  for (const person of plan.people) {
    const p = person.view;
    const style = styleOf.get(p.room) ?? 'engineering';
    const helpers = snapshot.agents
      .filter((a) => a.helperOf === p.id && a.agentId !== null && (isActive(a.status) || (a.endedAt !== null && now - a.endedAt < DONE_SHOWN_MS)))
      .sort((a, b) => a.startedAt - b.startedAt || (a.key < b.key ? -1 : 1))
      .slice(0, EXTRA_SPOTS.length);
    helpers.forEach((a, i) => {
      const offset = EXTRA_SPOTS[i] ?? { x: 0, z: 0 };
      const home = { x: person.home.x + offset.x, z: person.home.z + offset.z };
      const state = personState(a, now);
      members.push({
        key: a.key, look: `${p.id}#${i + 1}`, title: a.name, who: nameInSentence(a), roleId: p.id, hue: DEPARTMENT_HUE[style], accessory: accessoryFor(p.id, style),
        x: home.x, z: home.z, standing: true, status: isActive(a.status) ? a.status : 'done', bubble: visitorBubble(a, state), cost: dollars(agentCost(a)),
        target: { kind: 'agent', key: a.key }, agentKey: a.key, walk: [], gaze: [], meeting: false, depth: home.x + home.z,
        body: { pose: state.kind === 'on-it' ? 'type' : 'rest', holding: 'none', tired: 0, restPose: restPoseOf(p.id), outfit: { ...p.look }, since: a.statusSince, visitor: false },
        seated: false, person: null, level: null, room: p.room, presence: ALWAYS, papers: 0, facing: person.facing, inLine: null, item: null,
      });
      if (a.endedAt !== null) changes.push(a.endedAt + DONE_SHOWN_MS);
    });
  }

  // Visitors: sessions the company didn't start, in reception's seats with v2's bubbles. They never queue.
  const ours = new Set(company.people.flatMap((p) => [...(p.agentKey ? [`key:${p.agentKey}`] : []), ...(p.desk.sessionId ? [`session:${p.desk.sessionId}`] : [])]));
  const seats = layout.office?.reception.seats ?? [];
  const visitors = snapshot.agents
    .filter((a) => !ours.has(`key:${a.key}`) && !ours.has(`session:${a.sessionId}`))
    .filter((a) => isActive(a.status) || a.status === 'idle' || (a.endedAt !== null && now - a.endedAt < CONTRACTOR_LINGER_MS))
    .sort((a, b) => a.startedAt - b.startedAt || (a.key < b.key ? -1 : 1))
    .slice(-seats.length);
  visitors.forEach((a, i) => {
    const seat = seats[i];
    if (!seat) return;
    const state = personState(a, now);
    const pose: Pose = state.kind === 'needs-ok' || state.kind === 'needs-answer' ? 'look' : state.kind === 'stuck' ? 'stuck' : state.kind === 'on-it' ? 'type' : 'rest';
    members.push({
      key: a.key, look: a.agentType, title: a.name, who: nameInSentence(a), roleId: null, hue: CONTRACTOR_HUE, accessory: 'none', x: seat.x, z: seat.z, standing: false,
      status: isActive(a.status) ? a.status : a.status === 'idle' ? 'idle' : 'done', bubble: visitorBubble(a, state), cost: dollars(agentCost(a)),
      target: { kind: 'agent', key: a.key }, agentKey: a.key, walk: [], gaze: [], meeting: false, depth: seat.x + seat.z,
      body: { pose, holding: 'none', tired: 0, restPose: restPoseOf(a.agentType), outfit: {}, since: a.statusSince, visitor: true },
      seated: true, person: null, level: null, room: null, presence: ALWAYS, papers: 0, facing: seat.facing, inLine: null, item: null,
    });
    if (state.kind === 'stuck') changes.push(state.since + 60_000 * (Math.floor((now - state.since) / 60_000) + 1));
    if (a.status === 'error' && a.errorFrom === 'tool') changes.push(a.statusSince + STUCK_AFTER_MS);
    if (a.endedAt !== null) changes.push(a.endedAt + DONE_SHOWN_MS, a.endedAt + CONTRACTOR_LINGER_MS);
  });

  /** What someone's state says when no moment speaks for them: the front desk, stuck, the line for a desk, their work. */
  function stateBubble(p: PersonView, inLine: number | null, agent: AgentState | undefined): Bubble | null {
    if (inLine !== null) {
      // At the counter, or with the paper raised at their own desk; the row behind says nothing. Phones: the first only.
      const shows = options.narrow ? inLine === 0 : inLine < COUNTER_BUBBLES || inLine >= FRONT_DESK_PLACES;
      return shows ? needsYouBubble(company, p.id, max) : null;
    }
    const d = p.desk;
    if (d.state === 'failed') {
      if (now - d.since < STUCK_AFTER_MS) {
        changes.push(d.since + STUCK_AFTER_MS);
        return null;
      }
      changes.push(d.since + 60_000 * (Math.floor((now - d.since) / 60_000) + 1));
      return lineOf('stuck', `Stuck for ${coarseDuration(now - d.since)}`, max);
    }
    if (d.state === 'waiting') return d.queue === 1 ? lineOf('on-it', 'Next for a desk', max) : null;
    if (d.state !== 'working' && d.state !== 'starting' && d.state !== 'stopping') return null;
    const task = p.task ? company.tasks.find((t) => t.id === p.task) : undefined;
    const status = p.status && (p.status.taskId === p.task || (p.status.taskId === null && p.status.at >= d.since)) ? p.status.text : null;
    const text = status ?? task?.title ?? 'On it';
    // The dot takes about two characters' room.
    return { tone: 'on-it', lead: null, text: cut(text, max - 2), dot: agent?.tool ? 'busy' : 'still' };
  }

  function visitorBubble(a: AgentState, state: PersonState): Bubble | null {
    switch (state.kind) {
      case 'needs-ok':
        return lineOf('needs-you', `Needs your OK to ${state.what}`, max);
      case 'needs-answer':
        return state.question ? questionOf('needs-you', 'Asks you:', state.question, max) : lineOf('needs-you', 'Needs your answer', max);
      case 'stuck':
        return lineOf('stuck', `Stuck for ${coarseDuration(now - state.since)}`, max);
      case 'has-question':
        return questionOf('question', 'Asks you:', state.question, max);
      case 'on-it': {
        const goal = a.agentId ? a.task : a.purpose;
        return { tone: 'on-it', lead: null, text: goal ? cut(goal, max - 2) : 'On it', dot: a.tool ? 'busy' : 'still' };
      }
      case 'done':
        return a.endedAt !== null && now < a.endedAt + DONE_SHOWN_MS ? { tone: 'report', lead: null, text: cut(firstSentence(state.result ?? '') || 'Done', max), dot: 'check' } : null;
      default:
        return null;
    }
  }

  const upcoming = changes.filter((t) => t > now);
  return {
    members, nextChangeAt: upcoming.length > 0 ? Math.min(...upcoming) : null, nextRealChangeAt: null,
    moments: plan.moments, props: plan.props, night: plan.night, tier: plan.tier,
  };
}

/** A company person's status in v2's words, for what still reads it (lit desks, the label layer). */
function statusOf(p: PersonView, agent: AgentState | undefined): PersonStatus {
  switch (p.desk.state) {
    case 'working':
      return agent?.status === 'thinking' ? 'thinking' : 'working';
    case 'starting':
      return 'thinking';
    case 'stopping':
      return 'working';
    case 'failed':
      return 'error';
    case 'idle':
    case 'waiting':
      return 'idle';
    default:
      return 'off';
  }
}
