// Keeps labels from covering each other: a running gate's caption moves clear of the room signs, and people's bubbles
// clear of the captions and of each other, each lifted just above what it would overlap. The most important keep their
// place, then those nearest the camera, so bubbles stack upward away from the people in front; nothing rises above the
// free area under the top bar, and a stack holds a few at most (three on phones, the least important drop first; on
// desktops routine bubbles drop and someone who needs you, is stuck or has a question never does). The order comes
// from where people belong rather than where they are this frame, so a walker never trades places on every step.
// Bubbles may pass over room signs; a sign whose words a bubble covers hides rather than show a fragment, and a sign
// gives way to a yellow bubble (someone who needs you, or is answering you) wherever they meet. Where two signs meet,
// the one farther from the camera (higher on screen) hides. A label near the side of the screen moves in until it
// fits, as far as it can while still over its anchor. v3: fixed labels (a company's front desk sign, the line over
// the door at night) never hide, stay above the foot of the free area (a phone's sheet), and everything else moves
// clear of them; a room sign they meet hides; where two meet, the lower rank moves up.
// Pure, so it can be tested; the label projector feeds it measured boxes on every frame.

export interface LabelBox {
  id: string;
  /** Screen position of the label's anchor. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** How it hangs from its anchor: centred above it, above and to its right (room signs), or centred below it (on a counter). */
  hang: 'above' | 'above-right' | 'below';
  /**
   * Room signs stay put; a gate's caption moves clear of them; people's labels move clear of both and each other. Fixed
   * labels never hide under a bubble, gates and people move clear of them, and of two that meet the higher rank stays.
   */
  kind: 'sign' | 'gate' | 'person' | 'fixed';
  /** Higher ranks keep their place: someone who needs you before someone at work. */
  rank: number;
  /** How near the camera the person belongs; nearer keeps its place. */
  depth: number;
  /**
   * The id of the label this one folds into: a crowd waiting at the front desk is said once by the desk's sign ("Front
   * desk, 4 need you"), so each waiter's own bubble shows only when the crowd opens (`StackRules.open`) or zoomed apart.
   */
  fold?: string;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const boxOf = (b: LabelBox, lift: number, shift = 0): Box => {
  const left = (b.hang === 'above-right' ? b.x : b.x - b.w / 2) + shift;
  const top = (b.hang === 'below' ? b.y : b.y - b.h) - lift;
  return { left, top, right: left + b.w, bottom: top + b.h };
};

/**
 * How far to move a label sideways to keep it between `bounds`: no further than keeps 12 px of it over its anchor, so
 * it still points at its person (a sign, hanging to the right of its corner, only moves left).
 */
function shiftInto(b: LabelBox, bounds: { left: number; right: number } | undefined): number {
  if (!bounds) return 0;
  const box = boxOf(b, 0);
  const want = box.right > bounds.right ? bounds.right - box.right : box.left < bounds.left ? bounds.left - box.left : 0;
  const reach = b.hang === 'above-right' ? { min: -(b.w - 12), max: 0 } : { min: -(b.w / 2 - 12), max: b.w / 2 - 12 };
  return Math.max(reach.min, Math.min(reach.max, want));
}

const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
/**
 * Where a sign's words are: its box less its padding and coloured edge, which grow with its type, so they are read
 * from its height (a quarter of it above and below the words, a third of it at each side).
 */
const wordsOf = (sign: Box): Box => {
  const h = sign.bottom - sign.top;
  return { left: sign.left + h / 3, top: sign.top + h / 4, right: sign.right - h / 3, bottom: sign.bottom - h / 4 };
};
/** A bubble cuts through a sign when it covers any of its words: a bubble over its edge or padding leaves it. */
const cuts = (bubble: Box, sign: Box) => overlap(bubble, wordsOf(sign));

/** A label placed so far, how many labels high its stack is at it, and whether it is a yellow bubble about you. */
interface Placed {
  box: Box;
  level: number;
  urgent?: boolean;
}

/**
 * Lifts a label, from `from` up, until it overlaps none of `under`: each step moves it strictly up past one box, so it
 * ends.
 */
function liftClear(label: LabelBox, under: Placed[], gap: number, shift: number, from = 0): { box: Box; lift: number; level: number } {
  let lift = from;
  let level = 1;
  let box = boxOf(label, lift, shift);
  for (let i = 0; i <= under.length; i++) {
    const hit = under.find((p) => overlap(box, p.box));
    if (!hit) break;
    lift += box.bottom - (hit.box.top - gap);
    level = Math.max(level, hit.level + 1);
    box = boxOf(label, lift, shift);
  }
  return { box, lift, level };
}

export interface StackRules {
  /**
   * Between stacked labels, 4 px unless given. A phone's waiter's bubble is a button that reaches 1.5 px past its box
   * to make a 24 px target (labels.css), so two of them stacked keep 1 px between their targets.
   */
  gap?: number;
  /**
   * Nothing rises above this line, the free area's top under the top bar: a bubble lifted past it is dropped, and one
   * that starts above it (its person near the top) is held down to it.
   */
  ceiling?: number;
  /** At most this many people's labels in one stack. */
  maxStack?: number;
  /** People's labels of this rank or higher never drop for `maxStack`: someone who needs you, is stuck or asks. */
  exempt?: number;
  /**
   * The free area's foot (a phone's sheet): a fixed label hanging below it is held up to it, so it shows whole, by at
   * most its own height.
   */
  floor?: number;
  /** The screen's sides: labels move in to stay between them. */
  bounds?: { left: number; right: number };
  /** Folds that are open (the pointer or focus is on them): their labels show. */
  open?: ReadonlySet<string>;
}

export interface Stacked {
  /** How far up to lift each gate caption, person's label and fixed label, in pixels; below zero, how far down it is held. */
  lifts: Map<string, number>;
  /** How far each label moves sideways to stay on screen, in pixels (+ is right); labels that fit aren't listed. */
  shifts: Map<string, number>;
  /** People's labels that don't fit: above the ceiling or too high in a stack. */
  dropped: Set<string>;
  /** Room signs someone's label cuts through, or a yellow one touches: they hide until it moves on. */
  covered: Set<string>;
  /** Labels folded into the label they name (`LabelBox.fold`): out of the stacking, shown again when the fold opens or spreads. */
  folded: Set<string>;
}

/** Anchors of a folded crowd closer than this (screen pixels) than any two of them are still one crowd: zoom in past it to see each. */
export const CROWD_PX = 40;

/**
 * Which labels fold into another: those naming a `fold` that isn't open and whose crowd still piles up, that is, a lone
 * one (the sign says it already) or some two whose anchors stand within `CROWD_PX` of each other. Zoom in until they
 * stand apart and each shows.
 */
export function foldCrowds(labels: readonly LabelBox[], open: ReadonlySet<string> = new Set()): Set<string> {
  const folded = new Set<string>();
  const groups = new Map<string, LabelBox[]>();
  for (const l of labels) {
    if (l.fold !== undefined && !open.has(l.fold)) groups.set(l.fold, [...(groups.get(l.fold) ?? []), l]);
  }
  for (const members of groups.values()) {
    const piled = members.length < 2 || members.some((a, i) => members.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < CROWD_PX));
    if (piled) for (const m of members) folded.add(m.id);
  }
  return folded;
}

export function stackLabels(all: readonly LabelBox[], rules: StackRules = {}): Stacked {
  const gap = rules.gap ?? 4;
  const ceiling = rules.ceiling ?? Number.NEGATIVE_INFINITY;
  const maxStack = rules.maxStack ?? Number.POSITIVE_INFINITY;
  const exempt = rules.exempt ?? Number.POSITIVE_INFINITY;
  const floor = rules.floor ?? Number.POSITIVE_INFINITY;
  const lifts = new Map<string, number>();
  const dropped = new Set<string>();
  const shifts = new Map<string, number>();
  const shiftOf = (label: LabelBox) => {
    const shift = Math.round(shiftInto(label, rules.bounds));
    if (shift !== 0) shifts.set(label.id, shift);
    return shift;
  };
  const folded = foldCrowds(all, rules.open);
  const labels = all.filter((l) => !folded.has(l.id));
  const signs: Placed[] = [];
  const signIds = new Map<Placed, string>();
  for (const sign of labels.filter((l) => l.kind === 'sign')) {
    const placed = { box: boxOf(sign, 0, shiftOf(sign)), level: 0 };
    signs.push(placed);
    signIds.set(placed, sign.id);
  }
  // Fixed labels keep their anchor and never hide; one hanging below the free area's foot is held up to it, by no more
  // than its own height so it never floats away from what it labels, and where two meet (the night line over the door,
  // the front desk's sign), the higher rank stays and the other moves up.
  const fixed: Placed[] = [];
  for (const label of labels.filter((l) => l.kind === 'fixed').sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const shift = shiftOf(label);
    const placed = liftClear(label, fixed, gap, shift, Math.min(label.h, Math.max(0, boxOf(label, 0, shift).bottom - floor)));
    fixed.push({ box: placed.box, level: 0 });
    lifts.set(label.id, Math.round(placed.lift));
  }
  const gates: Placed[] = [];
  for (const gate of labels.filter((l) => l.kind === 'gate')) {
    const placed = liftClear(gate, [...signs, ...fixed, ...gates], gap, shiftOf(gate));
    gates.push({ box: placed.box, level: 0 });
    lifts.set(gate.id, Math.round(placed.lift));
  }
  const order = labels.filter((l) => l.kind === 'person').sort((a, b) => b.rank - a.rank || b.depth - a.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const people: Placed[] = [];
  for (const label of order) {
    const placed = liftClear(label, [...fixed, ...gates, ...people], gap, shiftOf(label));
    if ((placed.level > maxStack && label.rank < exempt) || (placed.lift > 0 && placed.box.top < ceiling)) {
      dropped.add(label.id);
      continue;
    }
    // At its own person near the top of the free area: held down over them rather than lost under the top bar.
    const lift = placed.box.top < ceiling ? placed.lift - (ceiling - placed.box.top) : placed.lift;
    // Held down it may lie over a label already placed: it drops rather than cover it.
    if (lift !== placed.lift && [...fixed, ...gates, ...people].some((p) => overlap(boxOf(label, lift, shifts.get(label.id) ?? 0), p.box))) {
      dropped.add(label.id);
      continue;
    }
    people.push({ box: boxOf(label, lift, shifts.get(label.id) ?? 0), level: placed.level, urgent: label.rank >= 2 });
    lifts.set(label.id, Math.round(lift));
  }
  const covered = new Set<string>();
  for (const sign of signs) {
    const id = signIds.get(sign);
    // A room sign gives way to a fixed label wherever they meet, as it does to a yellow bubble.
    const under = people.some((p) => (p.urgent ? overlap(sign.box, p.box) : cuts(p.box, sign.box))) || fixed.some((f) => overlap(sign.box, f.box));
    if (id !== undefined && under) covered.add(id);
  }
  // Signs still showing that meet: the one nearer the camera (lower on screen) stays, the other hides.
  const showing: Placed[] = [];
  for (const sign of signs.filter((s) => !covered.has(signIds.get(s) ?? '')).sort((a, b) => b.box.bottom - a.box.bottom || a.box.left - b.box.left)) {
    const id = signIds.get(sign);
    if (id !== undefined && showing.some((s) => overlap(s.box, sign.box))) covered.add(id);
    else showing.push(sign);
  }
  return { lifts, dropped, shifts, covered, folded };
}

export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the conversation sits beside its person, which side it is on, and where its tail points. */
export interface Beside {
  left: number;
  top: number;
  side: 'right' | 'left';
  /** Where it would sit if nothing held it in. */
  want: Area;
  /** How far down its edge the tail points, or null when the person is out of its reach. */
  tail: number | null;
}

/**
 * Beside the person, never over their label: its top 4 px below the foot of their label, `gap` px to their right, or
 * to their left when only that side has room; then kept inside the free area. It changes sides only when the other
 * side has room and its own lacks 24 px, so it doesn't flicker while you pan. Held up by the free area's foot, it would
 * cover their label (`label`, their name tag and bubble), so it moves along the same side until it clears it, as far as
 * the free area allows. The tail points at their head, 20 px below the top, sliding along the edge when it is held in,
 * and goes when they are more than 20 px out of its span.
 */
export function placeBeside(
  foot: { x: number; y: number },
  size: { w: number; h: number },
  free: Area,
  side: 'right' | 'left' | null = null,
  gap = 28,
  label: Area | null = null,
): Beside {
  const room = { right: free.right - (foot.x + gap + size.w), left: foot.x - gap - size.w - free.left };
  let chosen: 'right' | 'left' = side ?? (room.right >= 0 || room.left < 0 ? 'right' : 'left');
  const other = chosen === 'right' ? 'left' : 'right';
  if (side !== null && room[chosen] < -24 && room[other] >= 0) chosen = other;
  const x = chosen === 'right' ? foot.x + gap : foot.x - gap - size.w;
  const y = foot.y + 4;
  let left = Math.max(free.left, Math.min(x, free.right - size.w));
  const top = Math.max(free.top, Math.min(y, free.bottom - size.h));
  if (label && overlap({ left, top, right: left + size.w, bottom: top + size.h }, label)) {
    left = chosen === 'right' ? Math.max(left, Math.min(label.right + 8, free.right - size.w)) : Math.min(left, Math.max(label.left - 8 - size.w, free.left));
  }
  const head = foot.y + 24 - top;
  const beside = chosen === 'right' ? foot.x <= left : foot.x >= left + size.w;
  const tail = beside && head >= -20 && head <= size.h + 20 ? Math.max(20, Math.min(head, size.h - 20)) : null;
  return { left, top, side: chosen, want: { left: x, top: y, right: x + size.w, bottom: y + size.h }, tail };
}

/**
 * How far to move the view (in pixels, + is right and down) so a box sits inside the free area: just far enough, and
 * when it can't fit, its top-left corner first.
 */
export function shiftToShow(box: Area, free: Area): { dx: number; dy: number } {
  const along = (lo: number, hi: number, min: number, max: number) => (hi - lo > max - min || lo < min ? min - lo : hi > max ? max - hi : 0);
  return { dx: along(box.left, box.right, free.left, free.right), dy: along(box.top, box.bottom, free.top, free.bottom) };
}
