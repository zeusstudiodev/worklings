// What the label layer shows over a company's office (docs/design-v3.md; docs/game-feel.md, sections 2, 4 and 6): the
// rooms' signs, the front desk's sign, the line over the door while the company rests, and whether the office screen
// may run the app live. Pure, so it is tested without a browser; LabelLayer.tsx draws it and labels.tsx places it.
import type { CompanyView } from '../../../src/core/company.ts';
import type { BaseDepartment } from '../../../src/core/departments.ts';
import { routePath } from '../company/address.ts';
import { companyState, stateOfCompany } from '../company/model.ts';
import { hourMinute } from '../lib/format.ts';
import type { BubbleTone, CastMember } from './cast.ts';
import type { Layout } from './layout.ts';
import { NIGHT_REASONS } from './moments.ts';
import type { Area } from './stack.ts';

/** Bubbles quiet labels keep (a phone's thumbnail, progress beside the office): whoever needs you, is stuck or asks. */
export const URGENT_BUBBLES: ReadonlySet<BubbleTone> = new Set<BubbleTone>(['needs-you', 'stuck', 'question']);

/** Whether a person's bubble shows: the person picked or asked always, else every bubble, or only urgent ones when quiet. */
export const bubbleShown = (tone: BubbleTone, quiet: boolean, picked: boolean): boolean => picked || !quiet || URGENT_BUBBLES.has(tone);

/**
 * v0.8 (SPEC-v0.8.md, "office first"): a company's office labels only what happens now. A bubble shows for someone at
 * work on a step, stuck, in a meeting or answering you; the rest (done, "Next for a desk", waiting on you, which the
 * inbox card says) stays quiet. The person picked or asked always shows.
 */
const NOW_BUBBLES: ReadonlySet<BubbleTone> = new Set<BubbleTone>(['stuck', 'meeting', 'answering']);
export const happensNow = (m: { bubble: { tone: BubbleTone } | null; status: string; inLine: number | null }): boolean =>
  m.bubble !== null && m.inLine === null && (NOW_BUBBLES.has(m.bubble.tone) || (m.bubble.tone === 'on-it' && (m.status === 'working' || m.status === 'thinking')));

/** The rooms where someone works now, whose signs a company's office shows (v0.8). */
export const roomsAtWork = (cast: readonly { room: string | null; status: string }[]): Set<string> =>
  new Set(cast.flatMap((m) => (m.room !== null && (m.status === 'working' || m.status === 'thinking') ? [m.room] : [])));

export interface OfficeSign {
  /** The label's id, which is also its anchor's (the scenery registers `room:<id>` over every room). */
  id: string;
  room: string;
  name: string;
  /** A department's room is a button that opens its card, in its hue; the office's own rooms are plain signs. */
  department: BaseDepartment | null;
}

/** Every room's sign in a company's office: the departments' rooms, then the CEO's office, reception, the meeting room and the rest. */
export function officeSigns(layout: Layout): OfficeSign[] {
  const office = layout.office;
  if (!office) return [];
  const own = [office.ceo, office.reception, ...(office.meeting ? [office.meeting] : []), ...office.rest];
  return [
    ...layout.rooms.map((r) => ({ id: `room:${r.id}`, room: r.id, name: r.name, department: r.style })),
    ...own.map((r) => ({ id: `room:${r.id}`, room: r.id, name: r.name, department: null })),
  ];
}

/** Where an inbox item opens under the company: the inbox on it, or the proposal for the CEO's. */
export const itemPath = (item: string): string => (item === 'proposal' ? routePath({ view: 'proposal' }) : routePath({ view: 'inbox', item }));

export interface FrontDeskSign {
  /** Everyone in line: at the counter's six places and, past them, at their own desks. */
  waiting: number;
  /** "Front desk, 3 need you". */
  text: string;
  /** The oldest item's address, which the sign opens. */
  opens: string;
}

/**
 * The front desk's sign while anyone waits on you, from the cast's line (the moments' `frontDesk`): it counts everyone in
 * line and opens the first one's item, the oldest. Null when nobody waits.
 */
export function frontDeskSign(cast: readonly CastMember[]): FrontDeskSign | null {
  const line = cast.filter((m) => m.inLine !== null).sort((a, b) => (a.inLine ?? 0) - (b.inLine ?? 0));
  const first = line.find((m) => m.item !== null)?.item;
  if (!first) return null;
  return { waiting: line.length, text: `Front desk, ${line.length} ${line.length === 1 ? 'needs' : 'need'} you`, opens: itemPath(first) };
}

/**
 * The line over the door while the company rests on a usage limit or an overload: what the top bar says ("Resting until
 * 14:00"). Null by day, and while you paused it yourself, which isn't night.
 */
export function nightLine(company: CompanyView, clock: (at: number) => string = hourMinute): string | null {
  const pause = company.pause;
  if (!pause || !NIGHT_REASONS.has(pause.reason)) return null;
  // A pause's pill says when it ends, so the time it is read at doesn't change it.
  return companyState(stateOfCompany(company, pause.since), pause.since, clock).pill;
}

/** The office screen runs the live app only when it shows at least this wide, in CSS pixels; smaller, a screenshot. */
export const LIVE_SCREEN_MIN_PX = 240;

export interface ScreenCorners {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

/** Whether the screen's face, as drawn, faces the camera: its top runs left to right and its side downward on the stage. */
export function facesCamera(c: Pick<ScreenCorners, 'topLeft' | 'topRight' | 'bottomLeft'>): boolean {
  return (c.topRight.x - c.topLeft.x) * (c.bottomLeft.y - c.topLeft.y) - (c.topRight.y - c.topLeft.y) * (c.bottomLeft.x - c.topLeft.x) > 0;
}

/**
 * Whether a point on the stage is on the office screen as drawn. The overlay lets the pointer through to the canvas, so
 * the camera pans and zooms over it as anywhere; a press is matched to the screen with this.
 */
export function onScreen(p: { x: number; y: number }, c: ScreenCorners): boolean {
  const ring = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) return false;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return sign !== 0;
}

/**
 * Whether the office screen may run the app live: on desktops, with the whole screen inside the part of the stage the
 * HUD leaves free, and big enough to read. Otherwise, and on phones, it shows the latest screenshot.
 */
export function screenLive(corners: ScreenCorners, free: Area, narrow: boolean): boolean {
  if (narrow) return false;
  const inside = Object.values(corners).every((p) => p.x >= free.left && p.x <= free.right && p.y >= free.top && p.y <= free.bottom);
  const width = Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y);
  return inside && width >= LIVE_SCREEN_MIN_PX;
}
