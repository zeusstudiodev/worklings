// The org chart's layout (docs/design-v3.md, "The org chart"; docs/design-hud.md, "The org chart"): where each person's
// node, the lines between them, the room signs and the folded managers' marks stand, from who reports to whom, at a zoom.
// Pure, so it is tested from 1 to 60 people (test/panels-org-layout.test.ts); the org board and the proposal's chart
// both draw it.
//
// The CEO on top with "You" above; the CEO's reports who manage nobody beside the CEO on a dashed line; under the CEO the
// heads in a row, each with their room's sign; under a manager their workers in one column, then their team leads side
// by side, each with their own column, so the width grows with managers, not with people. Someone whose manager isn't in
// the company hangs under the CEO on a dashed line. Under 100% the zoom sets how far apart the columns are and the
// nodes' form, never the size of their words; from 100% up the whole chart scales, so it is laid out at 100%.
import type { Level } from '../../../../src/core/studio.ts';

/** Who reports to whom: what the layout reads of a person, in the company's (People's) order. */
export interface OrgMember {
  id: string;
  reportsTo: string | null;
  level: Level;
  room: string;
}

export type NodeForm = 'whole' | 'compact' | 'chip';

/** The column pitch at 100%: a 216 px node and 24 px between columns. */
export const PITCH = 240;
export const MAX_ZOOM = 1.5;
/** The lowest the floor goes; a chip's whole label sets it higher where names are longer. */
export const MIN_FLOOR = 0.4;
/** Where the forms change: whole from 88%, compact from 75%, chips below. */
export const WHOLE_FROM = 0.88;
export const COMPACT_FROM = 0.75;
/** Room left of the first column and right of the last when the chart opens fitted: 20 px of mat each side. */
export const FIT_MARGIN = 20;
/**
 * Height the fit forgives, so whole nodes win over compact ones when the free area is a little short (the static demo's
 * 32 px banner leaves the café 19 px under what it needs). The chart's top margin gives way first (`FIT_TOP` down to 0),
 * so what is left over dips into the gutter the dock keeps clear, by a pixel or two.
 */
export const FIT_SLACK = 20;

/** The stakeholder, as the chart draws them: the "You" tag over the CEO, where yours start. */
export const YOU = '@you';

export const formAt = (zoom: number): NodeForm => (zoom >= WHOLE_FROM ? 'whole' : zoom >= COMPACT_FROM ? 'compact' : 'chip');

/** Rows by the form's own height, never scaled: the node, between two in a column, under a manager, under the CEO. */
const SIZES: Record<NodeForm, { h: number; row: number; report: number; head: number }> = {
  whole: { h: 76, row: 8, report: 20, head: 52 },
  compact: { h: 48, row: 12, report: 22, head: 58 },
  chip: { h: 32, row: 8, report: 14, head: 52 },
};

export const nodeHeight = (form: NodeForm): number => SIZES[form].h;

/** The gap from a node of this height down to its reports' row, for centring a 24 px key on the stem between them. */
export const reportGapAt = (height: number): number => Object.values(SIZES).find((s) => s.h === height)?.report ?? SIZES.whole.report;

/** A node's width in its column: whole, the column less 12 up to 216; compact, the column less 12; a chip, less 8. */
export function nodeWidth(form: NodeForm, pitch: number): number {
  if (form === 'whole') return Math.min(216, pitch - 12);
  return form === 'compact' ? pitch - 12 : pitch - 8;
}

/** The You tag over the CEO and the line down from it. */
const YOU_H = 30;
const YOU_GAP = 16;
/** A room's sign over its head: its height and the room under it. */
export const SIGN_H = 24;
const SIGN_GAP = 8;
/** The CEO's bus, under the CEO's row. */
const CEO_BUS = 12;
/** A folded manager's mark on its line: the pill's height and the line above it. */
export const FOLD_H = 24;
const FOLD_GAP = 8;
/** "Reported to Lena, who left", under the node it is about. */
export const LOST_H = 18;
/** The dashed place for someone new at a column's foot (the proposal's "Add someone to Design"). */
export const ADD_H = 40;

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** In the tree, as aria-level: 1 for the CEO, one more per manager. */
  level: number;
  /** The node it hangs from as drawn: their manager, or the CEO for someone whose manager left; null for the CEO. */
  parent: string | null;
  /** Its place among its parent's children as drawn, from 1, and how many there are (aria-posinset, aria-setsize). */
  posinset: number;
  setsize: number;
  /** They have reports (aria-expanded), and whether those are folded away now. */
  manages: boolean;
  folded: boolean;
  /** Everyone under them, folded or not. */
  under: number;
  /** Beside the CEO, or under them because their own manager isn't in the company: on a dashed line. */
  dashed: boolean;
  /** The id their reportsTo names when that person isn't in the company: "Reported to Lena, who left". */
  lost: string | null;
}

/** A line from a manager to a report: elbows through these points, in world pixels. */
export interface OrgEdge {
  from: string;
  to: string;
  points: [number, number][];
  dashed: boolean;
}

export interface RoomSign {
  room: string;
  /** The node it stands over (the first of its room in the heads' row). */
  over: string;
  x: number;
  y: number;
}

export interface FoldMark {
  /** The folded manager. */
  id: string;
  /** The pill's centre top. */
  x: number;
  y: number;
  count: number;
}

export interface LostMark {
  id: string;
  manager: string;
  x: number;
  y: number;
}

export interface AddSlot {
  room: string;
  /** The head whose column it ends, or null for "Add a room" after the heads' row. */
  under: string | null;
  x: number;
  y: number;
  w: number;
}

export interface OrgLayout {
  form: NodeForm;
  /** The zoom the layout was made at: at most 100%, since above that the chart scales. */
  zoom: number;
  pitch: number;
  /** In tree order: the keyboard's order, a column top to bottom, then the next. Folded reports aren't here. */
  nodes: PlacedNode[];
  edges: OrgEdge[];
  signs: RoomSign[];
  folds: FoldMark[];
  lost: LostMark[];
  adds: AddSlot[];
  /** The You tag's centre top, over the CEO; null without a CEO. */
  you: { x: number; y: number; h: number } | null;
  width: number;
  height: number;
  /** The CEO, or the first root of an org without one. */
  root: string | null;
}

export interface LayoutOptions {
  /** The chart's zoom; the layout is made at min(zoom, 1). */
  zoom: number;
  /** Managers whose reports are folded away. */
  folded?: ReadonlySet<string>;
  /** Places for "Add someone to …" under each head and "Add a room" after the heads (the proposal). */
  adds?: boolean;
}

/** The chart for these people at a zoom. Nobody is placed twice, whatever loops a broken org has. */
export function orgLayout(people: readonly OrgMember[], options: LayoutOptions): OrgLayout {
  const zoom = Math.min(Math.max(options.zoom, 0.01), 1);
  const form = formAt(zoom);
  const pitch = PITCH * zoom;
  const size = SIZES[form];
  const w = nodeWidth(form, pitch);
  const h = size.h;
  const gap = pitch - w;
  const folded = options.folded ?? new Set<string>();

  const byId = new Map<string, OrgMember>();
  for (const p of people) if (!byId.has(p.id)) byId.set(p.id, p);
  const members = [...byId.values()];
  const ceo = members.find((p) => p.level === 'ceo') ?? null;
  const managerOf = (p: OrgMember): string | null => (p.reportsTo !== null && p.reportsTo !== p.id && byId.has(p.reportsTo) ? p.reportsTo : null);

  // Reports by manager, in the company's order; then the tree from the CEO, so a loop can't place anyone twice.
  const reportsOf = new Map<string, OrgMember[]>();
  for (const p of members) {
    const m = managerOf(p);
    if (m === null) continue;
    reportsOf.set(m, [...(reportsOf.get(m) ?? []), p]);
  }
  const reached = new Set<string>();
  const reach = (id: string) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const r of reportsOf.get(id) ?? []) reach(r.id);
  };
  if (ceo) reach(ceo.id);
  // Everyone the CEO doesn't reach hangs under the CEO: no manager in the company, or a loop with nobody outside it.
  const loose: OrgMember[] = [];
  for (const p of members) {
    if (reached.has(p.id) || p === ceo) continue;
    const m = managerOf(p);
    if (m !== null && !reached.has(m) && !isInLoop(p, byId, managerOf)) continue;
    loose.push(p);
    reach(p.id);
  }
  // A loop: break it at its first member left.
  for (const p of members) {
    if (reached.has(p.id) || p === ceo) continue;
    loose.push(p);
    reach(p.id);
  }
  const looseIds = new Set(loose.map((p) => p.id));
  const placed = new Set<string>();
  const kidsOf = (id: string): OrgMember[] => (reportsOf.get(id) ?? []).filter((r) => !looseIds.has(r.id) && r.id !== ceo?.id);
  const countUnder = (id: string, seen = new Set<string>()): number => {
    let n = 0;
    for (const k of kidsOf(id)) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      n += 1 + countUnder(k.id, seen);
    }
    return n;
  };

  const nodes: PlacedNode[] = [];
  const edges: OrgEdge[] = [];
  const folds: FoldMark[] = [];
  const lostMarks: LostMark[] = [];
  const adds: AddSlot[] = [];

  const start = (member: OrgMember, level: number, parent: string | null, posinset: number, setsize: number, dashed: boolean): PlacedNode => {
    placed.add(member.id);
    const kids = kidsOf(member.id);
    const lost = member.reportsTo !== null && member.reportsTo !== member.id && !byId.has(member.reportsTo) ? member.reportsTo : null;
    const node: PlacedNode = {
      id: member.id,
      x: 0,
      y: 0,
      w,
      h,
      level,
      parent,
      posinset,
      setsize,
      manages: kids.length > 0,
      folded: kids.length > 0 && folded.has(member.id),
      under: countUnder(member.id),
      dashed,
      lost,
    };
    nodes.push(node);
    return node;
  };

  /** A manager's subtree from column left edge `x0` with its node's top at `y`: its width and its foot. */
  const subtree = (member: OrgMember, node: PlacedNode, x0: number, y: number, withAdd: boolean): { width: number; bottom: number } => {
    node.y = y;
    const below = y + h + (node.lost ? LOST_H : 0);
    const lostMark = node.lost ? { id: member.id, manager: node.lost, x: 0, y: y + h + 3 } : null;
    if (lostMark) lostMarks.push(lostMark);
    const kids = node.folded ? [] : kidsOf(member.id).filter((k) => !placed.has(k.id));
    const workers = kids.filter((k) => kidsOf(k.id).length === 0);
    const leads = kids.filter((k) => kidsOf(k.id).length > 0);
    const childY = below + size.report;
    let x = x0;
    let bottom = below;
    const order = [...workers, ...leads];
    const children: { member: OrgMember; node: PlacedNode }[] = order.map((k, i) => ({ member: k, node: start(k, node.level + 1, member.id, i + 1, order.length, false) }));
    // Workers, in one column under the manager's span.
    const workerNodes = children.slice(0, workers.length);
    if (workerNodes.length > 0 || withAdd) {
      let wy = childY;
      for (const c of workerNodes) {
        c.node.x = x;
        c.node.y = wy;
        bottom = wy + h;
        wy += h + size.row;
      }
      if (withAdd) {
        adds.push({ room: member.room, under: member.id, x, y: wy, w });
        bottom = wy + ADD_H;
      }
      x += pitch;
    }
    // Team leads, side by side, each with their own column(s). Their nodes were pushed already, so the order stays the
    // tree's; their reports follow them as they are laid out.
    const leadSpans: { node: PlacedNode; width: number }[] = [];
    for (const c of children.slice(workers.length)) {
      // A lead's reports come right after the lead in the keyboard's order: move them there.
      const at = nodes.indexOf(c.node);
      const tail = nodes.splice(at + 1);
      const span = subtree(c.member, c.node, x, childY, false);
      nodes.push(...tail);
      leadSpans.push({ node: c.node, width: span.width });
      x += span.width;
      bottom = Math.max(bottom, span.bottom);
    }
    const width = Math.max(pitch, x - x0);
    // The manager over the middle of their span.
    node.x = kids.length > 0 || withAdd ? x0 + (width - pitch) / 2 : x0;
    if (lostMark) lostMark.x = node.x;
    if (node.folded) {
      folds.push({ id: member.id, x: node.x + w / 2, y: below + FOLD_GAP, count: node.under });
      bottom = Math.max(bottom, below + FOLD_GAP + FOLD_H);
    }
    // Lines: down from the manager's foot to a bus, along it, then into each report.
    const px = node.x + w / 2;
    const busY = below + size.report / 2;
    const trunkX = x0 - gap / 2;
    for (const c of workerNodes) edges.push({ from: member.id, to: c.member.id, points: [[px, y + h], [px, busY], [trunkX, busY], [trunkX, c.node.y + h / 2], [c.node.x, c.node.y + h / 2]], dashed: false });
    for (const l of leadSpans) {
      const lx = l.node.x + w / 2;
      edges.push({ from: member.id, to: l.node.id, points: [[px, y + h], [px, busY], [lx, busY], [lx, l.node.y]], dashed: false });
    }
    return { width, bottom };
  };

  let you: OrgLayout['you'] = null;
  const signs: RoomSign[] = [];
  let root: string | null;

  if (ceo) {
    root = ceo.id;
    const ceoY = YOU_H + YOU_GAP;
    const ceoKids = kidsOf(ceo.id).filter((k) => k.id !== ceo.id);
    // Beside the CEO: their reports who manage nobody and aren't heads. In the heads' row: everyone else, and whoever
    // hangs under the CEO because their manager left, in the company's order.
    const beside = ceoKids.filter((k) => k.level !== 'head' && kidsOf(k.id).length === 0);
    const tops = members.filter((p) => (ceoKids.includes(p) && !beside.includes(p)) || looseIds.has(p.id));
    const ceoNode = start(ceo, 1, null, 1, 1, false);
    ceoNode.y = ceoY;
    const kids = folded.has(ceo.id) && ceoNode.manages ? [] : [...beside, ...tops];
    const setsize = kids.length;
    const besideNodes = kids.length > 0 ? beside.map((b, i) => start(b, 2, ceo.id, i + 1, setsize, true)) : [];
    const headsY = ceoY + h + size.head;
    let x = 0;
    let first = true;
    let lastRoom: string | null = null;
    const topNodes: PlacedNode[] = [];
    for (const [i, t] of (kids.length > 0 ? tops : []).entries()) {
      if (placed.has(t.id)) continue;
      if (!first) x += t.room === lastRoom ? 0 : pitch * 0.15;
      const node = start(t, 2, ceo.id, beside.length + i + 1, setsize, looseIds.has(t.id));
      const span = subtree(t, node, x, headsY, options.adds === true && t.level === 'head');
      if (t.room !== lastRoom) signs.push({ room: t.room, over: t.id, x: node.x, y: headsY - SIGN_H - SIGN_GAP });
      topNodes.push(node);
      x += span.width;
      lastRoom = t.room;
      first = false;
    }
    if (options.adds && kids.length > 0) adds.push({ room: '', under: null, x: x + (topNodes.length > 0 ? pitch * 0.15 : 0), y: headsY, w });
    const spanRight = topNodes.length > 0 ? x : 0;
    ceoNode.x = topNodes.length > 0 ? (spanRight - pitch) / 2 : 0;
    if (ceoNode.folded) {
      folds.push({ id: ceo.id, x: ceoNode.x + w / 2, y: ceoY + h + FOLD_GAP, count: ceoNode.under });
    }
    besideNodes.forEach((b, i) => {
      b.x = ceoNode.x + pitch * (i + 1);
      b.y = ceoY;
      edges.push({ from: ceo.id, to: b.id, points: [[ceoNode.x + w, ceoY + h / 2], [b.x, ceoY + h / 2]], dashed: true });
    });
    const cx = ceoNode.x + w / 2;
    const busY = ceoY + h + CEO_BUS;
    for (const t of topNodes) {
      const tx = t.x + w / 2;
      edges.push({ from: ceo.id, to: t.id, points: [[cx, ceoY + h], [cx, busY], [tx, busY], [tx, t.y]], dashed: t.dashed });
    }
    you = { x: cx, y: 0, h: YOU_H };
    edges.unshift({ from: YOU, to: ceo.id, points: [[cx, YOU_H], [cx, ceoY]], dashed: false });
  } else {
    // No CEO (a studio without an org): everyone the tree starts from, in a row.
    let x = 0;
    const roots = members.filter((p) => looseIds.has(p.id));
    roots.forEach((r, i) => {
      if (placed.has(r.id)) return;
      const node = start(r, 1, null, i + 1, roots.length, false);
      node.dashed = false;
      const span = subtree(r, node, x, SIGN_H + SIGN_GAP, false);
      if (i === 0 || roots[i - 1]?.room !== r.room) signs.push({ room: r.room, over: r.id, x: node.x, y: 0 });
      x += span.width;
    });
    root = roots[0]?.id ?? null;
  }

  // Into the world's own coordinates: everything from 0, 0.
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h + (n.lost ? LOST_H : 0));
  }
  for (const e of edges) for (const [px] of e.points) minX = Math.min(minX, px - 2);
  for (const f of folds) maxY = Math.max(maxY, f.y + FOLD_H);
  for (const a of adds) {
    maxX = Math.max(maxX, a.x + a.w);
    maxY = Math.max(maxY, a.y + ADD_H);
  }
  if (nodes.length === 0) {
    minX = 0;
    maxX = 0;
  }
  const dx = -minX;
  for (const n of nodes) n.x += dx;
  for (const e of edges) e.points = e.points.map(([px, py]) => [px + dx, py]);
  for (const s of signs) s.x += dx;
  for (const f of folds) f.x += dx;
  for (const l of lostMarks) l.x += dx;
  for (const a of adds) a.x += dx;
  if (you) you = { ...you, x: you.x + dx };

  return { form, zoom, pitch, nodes, edges, signs, folds, lost: lostMarks, adds, you, width: Math.ceil(maxX + dx), height: Math.ceil(maxY), root };
}

/** Whether someone's chain of managers comes back round to someone in it. */
function isInLoop(p: OrgMember, byId: ReadonlyMap<string, OrgMember>, managerOf: (p: OrgMember) => string | null): boolean {
  const seen = new Set<string>([p.id]);
  let m = managerOf(p);
  while (m !== null) {
    if (seen.has(m)) return true;
    seen.add(m);
    const next = byId.get(m);
    m = next ? managerOf(next) : null;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Zoom

/**
 * The floor: the zoom where every chip still shows its whole first name (the face with its padding and gap, 45 px, the
 * longest first name, 8 px of padding and the 8 px gap, over the 240 px pitch), 40% at the least. The title's word that
 * tells two Nils apart ("Nils, Backend") is the label's tail and is cut with "..." there rather than raising the floor
 * for everyone; the node's name and tooltip always carry it.
 */
export function floorZoom(longestName: number): number {
  return Math.min(1, Math.max(MIN_FLOOR, Math.ceil(((45 + longestName + 16) / PITCH) * 100) / 100));
}

/** The room the chart opens in: the free area of the view, in px, clear of the talk bar and the strip at its foot. */
export interface FitRoom {
  width: number;
  height: number;
}

/** Mat left above the chart when it opens. */
export const FIT_TOP = 18;

/**
 * The zoom the chart opens at: the largest, at 100% at most, down to the floor, in which the whole chart is in the free
 * area (20 px of mat each side, `FIT_TOP` above); `fits` false when even the floor doesn't fit (it then opens at the
 * floor, centred on the CEO).
 */
export function openingZoom(sizeAt: (zoom: number) => { width: number; height: number }, room: FitRoom, floor: number): { zoom: number; fits: boolean } {
  for (let pct = 100; pct >= Math.round(floor * 100); pct -= 1) {
    const zoom = pct / 100;
    const size = sizeAt(zoom);
    if (size.width + 2 * FIT_MARGIN <= room.width && size.height + FIT_TOP <= room.height + FIT_SLACK) return { zoom, fits: true };
  }
  return { zoom: floor, fits: false };
}

/** Zoom out or in a step (about 1.25 times), within the floor and 150%, landing on 100% on the way. */
export function stepZoom(zoom: number, direction: 1 | -1, floor: number): number {
  const next = direction > 0 ? zoom * 1.25 : zoom / 1.25;
  const landed = (zoom < 1 && next > 1) || (zoom > 1 && next < 1) ? 1 : next;
  return clampZoom(Math.round(landed * 100) / 100, floor);
}

export const clampZoom = (zoom: number, floor: number): number => Math.min(MAX_ZOOM, Math.max(floor, zoom));

// ---------------------------------------------------------------------------------------------------------------
// Lines

/** An elbow line through points, its corners rounded by up to 6 px: an SVG path's `d`. */
export function elbowPath(points: readonly (readonly [number, number])[], radius = 6): string {
  const pts = simplify(points);
  if (pts.length === 0) return '';
  const [x0, y0] = pts[0]!;
  let d = `M${r(x0)} ${r(y0)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i]!;
    const next = pts[i + 1];
    if (!next) {
      d += ` L${r(x)} ${r(y)}`;
      break;
    }
    const [px, py] = pts[i - 1]!;
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(next[0] - x, next[1] - y);
    const k = Math.min(radius, inLen / 2, outLen / 2);
    const ax = x - ((x - px) / inLen) * k;
    const ay = y - ((y - py) / inLen) * k;
    const bx = x + ((next[0] - x) / outLen) * k;
    const by = y + ((next[1] - y) / outLen) * k;
    d += ` L${r(ax)} ${r(ay)} Q${r(x)} ${r(y)} ${r(bx)} ${r(by)}`;
  }
  return d;
}

const r = (n: number) => Math.round(n * 10) / 10;

/** Points without repeats or straight-through corners. */
export function simplify(points: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of points) {
    const last = out.at(-1);
    if (last && Math.abs(last[0] - x) < 0.01 && Math.abs(last[1] - y) < 0.01) continue;
    const before = out.at(-2);
    if (last && before && ((Math.abs(before[0] - last[0]) < 0.01 && Math.abs(last[0] - x) < 0.01) || (Math.abs(before[1] - last[1]) < 0.01 && Math.abs(last[1] - y) < 0.01))) {
      out[out.length - 1] = [x, y];
      // Back along the same line (up to a manager and down again): the turn point goes, and so does a repeat.
      if (Math.abs(before[0] - x) < 0.01 && Math.abs(before[1] - y) < 0.01) out.pop();
      continue;
    }
    out.push([x, y]);
  }
  return out;
}

/**
 * The way a paper goes from one person to another along the lines, through their shared manager: the edges' points,
 * up from the sender then down to the receiver, and the hops it takes. Null when either isn't on the chart.
 */
export function relayRoute(layout: Pick<OrgLayout, 'nodes' | 'edges' | 'you'>, from: string, to: string): { points: [number, number][]; hops: number } | null {
  const parentOf = new Map(layout.nodes.map((n) => [n.id, n.parent]));
  if (!parentOf.has(to) || (from !== YOU && !parentOf.has(from)) || from === to) return null;
  const edgeTo = new Map(layout.edges.map((e) => [e.to, e]));
  const chain = (id: string): string[] => {
    const out: string[] = [];
    let at: string | null = id;
    const seen = new Set<string>();
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      out.push(at);
      at = parentOf.get(at) ?? null;
    }
    return out;
  };
  const down = chain(to);
  const up = from === YOU ? [YOU] : chain(from);
  // From "You", the way is the CEO's chain from the top.
  let meet = -1;
  let upTo = up.length;
  if (from === YOU) {
    meet = down.length - 1;
    upTo = 0;
  } else {
    for (let i = 0; i < up.length; i++) {
      const j = down.indexOf(up[i]!);
      if (j >= 0) {
        meet = j;
        upTo = i;
        break;
      }
    }
    if (meet < 0) return null;
  }
  const points: [number, number][] = [];
  let hops = 0;
  // Up: each edge into a person on the way, walked backwards.
  for (let i = 0; i < upTo; i++) {
    const e = edgeTo.get(up[i]!);
    if (!e) return null;
    points.push(...[...e.points].reverse());
    hops += 1;
  }
  if (from === YOU) {
    const e = edgeTo.get(down[down.length - 1]!);
    if (e && e.from === YOU) {
      points.push(...e.points);
      hops += 1;
    }
  }
  // Down: from the shared manager to the receiver.
  for (let j = meet - 1; j >= 0; j--) {
    const e = edgeTo.get(down[j]!);
    if (!e) return null;
    points.push(...e.points);
    hops += 1;
  }
  return { points: simplify(points), hops };
}
