// What the HUD covers at the 3D stage's edges, so the office and the lobby's worlds sit in the part left free. Pure, so
// every layout in the design's table is tested (test/stage-insets.test.ts).
//
// Stage and dock (docs/design-hud.md, "How the HUD sits over the office") gives the company's stage two insets: the
// camera's fit (the bar's band, a docked side panel, the talk bar and one strip line) and the labels' area (that, less
// any side panel, the caption, the map keys and all three strip lines). A floating side panel leaves the fit as if it
// were hidden, so opening it never moves the office; the labels still keep clear of it. The lobby and v2's watched office
// keep their own fixed insets below.

/** What the HUD covers at each edge of the stage, in pixels; `left` is 0 unless given. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left?: number;
}

/** A rectangle by its four edges, in window pixels. */
export interface Cover {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The camera's fit and the labels' area: the stage takes both. */
export interface StageInsets {
  fit: Insets;
  labels: Insets;
  /** A piece of HUD that stands over the office and so hides the labels beneath it (the feed on a desktop), in window pixels; null for none. */
  covered: Cover | null;
}

/** Which layout applies (docs/design-v3.md, "The shell"): docked from 896 px, floating from 721, the phone's and its short form. */
export type ShellLayout = 'docked' | 'floating' | 'phone' | 'short';

/** What the shell knows about its pieces, measured where they are drawn. */
export interface StageFrame {
  layout: ShellLayout;
  /** The side panel's committed width while it shows, docked or floating; null while hidden. Phones ignore it. */
  side: number | null;
  /** The talk bar's height now (`--talk-now`): 56 for one line, more while it grows. */
  talk: number;
  /** The caption's and the map keys' bottom edges, in px from the window's top; null when not drawn. */
  caption: number | null;
  keys: number | null;
  /** Phones: the top edge of the side panel's sheet while it is up over the office; null for none. */
  sheet: number | null;
  /**
   * Short windows: the bottom edge of the side panel's peek, which hangs from under the bar rather than rising from the
   * foot; the office is what lies between it and the talk bar. Null when the sheet is down or fully up (it covers the room).
   */
  sheetBottom?: number | null;
  /** Phones: the safe area at the window's foot. */
  safeBottom: number;
  /** The window's height. */
  height: number;
  /** Desktops: the open feed's rectangle, measured where it is drawn; null while it is closed (phones cover the stage instead). */
  feed?: Cover | null;
  /**
   * Desktops: the progress column's right edge, in px from the window's left, while the progress view shows; null or
   * absent otherwise. The office then stands in what the column leaves, as it does beside a docked side panel.
   */
  progress?: number | null;
}

const GUTTER = { desktop: 12, phone: 8 };
/** The bar's band: 12 + 44 + 12 on desktops; phones add the views row (8 + 44 + 8 + 56 + 8), short windows fold it in. */
const BAND = { desktop: 68, phone: 124, short: 60 };
/** A one-line talk bar. The fit always keeps this much, so a message growing to six lines never moves the camera. */
const TALK_ONE_LINE = 56;
const STRIP_LINE = { desktop: 30, phone: 36 };
const STRIP_GAP = 4;
/** Between the talk bar and the strip's first line. */
const ABOVE_TALK = 8;
/** The pull a hidden docked side panel leaves on the window's right edge, and its gutter. */
const PULL = 24;

/**
 * The two insets for a layout. The fit: the bar's band at the top; on the right a docked side panel and its two gutters
 * (the pull and a gutter while hidden; nothing while floating, as when hidden there); at the foot the talk bar with one
 * strip line (106 px on desktops, 116 and the safe area on phones; short windows have no strip). The labels: from 8 px
 * under the caption and the map keys, to 12 px left of the side panel whenever it shows, to above the strip's three
 * lines (one on phones); a phone's sheet ends both above it.
 */
export function stageInsets(frame: StageFrame): StageInsets {
  if (frame.layout === 'phone' || frame.layout === 'short') return phoneInsets(frame);
  const gutter = GUTTER.desktop;
  const docked = frame.layout === 'docked';
  const shows = frame.side !== null;
  const fitRight = docked ? (shows ? (frame.side as number) + 2 * gutter : PULL + gutter) : 0;
  // Beside the progress column the office takes what is right of it, one gutter clear.
  const column = frame.progress != null && frame.progress > 0 ? Math.round(frame.progress) + gutter : null;
  const fit: Insets = { top: BAND.desktop, right: fitRight, bottom: gutter + TALK_ONE_LINE + ABOVE_TALK + STRIP_LINE.desktop, left: column ?? 0 };
  const under = Math.max(frame.caption ?? 0, frame.keys ?? 0);
  const labels: Insets = {
    top: Math.max(BAND.desktop, under > 0 ? under + 8 : 0),
    right: shows ? (frame.side as number) + 2 * gutter : docked ? PULL + gutter : gutter,
    bottom: gutter + frame.talk + ABOVE_TALK + 3 * STRIP_LINE.desktop + 2 * STRIP_GAP,
    left: column ?? gutter,
  };
  return { fit, labels, covered: frame.feed ?? null };
}

function phoneInsets(frame: StageFrame): StageInsets {
  const gutter = GUTTER.phone;
  const short = frame.layout === 'short';
  const top = short ? BAND.short : BAND.phone;
  // Short windows hide the strip: the talk bar is all there is at the foot.
  const strip = short ? 0 : STRIP_LINE.phone + gutter;
  const foot = (talk: number) => gutter + talk + (short ? gutter : ABOVE_TALK + strip) + frame.safeBottom;
  // A sheet up over the office: what is left is the part above it, a gutter clear of its edge.
  // In short windows the sheet hangs from under the bar instead, so it moves the top edge, never the foot.
  const sheet = short || frame.sheet === null ? null : Math.max(0, frame.height - frame.sheet + gutter);
  const hung = short && frame.sheetBottom != null ? Math.max(top, frame.sheetBottom + gutter) : top;
  const fit: Insets = { top: hung, right: 0, bottom: sheet ?? foot(TALK_ONE_LINE), left: 0 };
  // A short window's sheet fully up covers the room: no label may show (or take focus) under it.
  if (short && frame.sheet !== null && frame.sheetBottom == null) return { fit, labels: { top: frame.height, right: gutter, bottom: 0, left: gutter }, covered: null };
  const labels: Insets = { top: hung, right: gutter, bottom: sheet ?? foot(frame.talk) - (short ? 0 : gutter), left: gutter };
  return { fit, labels, covered: null };
}

// ---------------------------------------------------------------------------------------------------------------
// The mini-map's move: the same canvas shrinks into the corner by a transform (FLIP), and its drawing buffer is resized
// once, at the end when it shrinks and at the start when it grows (docs/design-v3.md, "Boards over the map").

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How the whole stage maps onto the mini-map's window: one scale that covers the window (never stretching the office),
 * the part of the stage that shows in it (`crop`, centred), and the translation that lays that part on the window, for
 * `transform-origin: 0 0`. The camera frames the building inside `crop` while the stage moves, so the picture at the end
 * is the one the mini-map draws once resized.
 */
export interface MiniMove {
  crop: Rect;
  scale: number;
  x: number;
  y: number;
}

export function miniMove(stage: { width: number; height: number }, mini: Rect): MiniMove {
  const width = Math.max(1, stage.width);
  const height = Math.max(1, stage.height);
  const scale = Math.max(mini.width / width, mini.height / height);
  const crop = { width: mini.width / scale, height: mini.height / scale, left: 0, top: 0 };
  crop.left = (width - crop.width) / 2;
  crop.top = (height - crop.height) / 2;
  return { crop, scale, x: mini.left - scale * crop.left, y: mini.top - scale * crop.top };
}

/** The camera's insets that frame the building inside `crop` on the whole stage. */
export function cropInsets(stage: { width: number; height: number }, crop: Rect): Required<Insets> {
  return {
    top: crop.top,
    left: crop.left,
    right: Math.max(0, stage.width - crop.left - crop.width),
    bottom: Math.max(0, stage.height - crop.top - crop.height),
  };
}

/**
 * The move as CSS: the transform that lays the whole stage on the mini-map's window, and the clip to the crop that the
 * stage keeps while it moves. Only the transform animates, so the compositor runs the move even while the board mounts;
 * the clip stays put (outside the crop is the bar's band and the dock, mostly).
 */
export function miniFrame(move: MiniMove, stage: { width: number; height: number }): { transform: string; clipPath: string } {
  const { crop } = move;
  const right = Math.max(0, stage.width - crop.left - crop.width);
  const bottom = Math.max(0, stage.height - crop.top - crop.height);
  return {
    transform: `translate(${num(move.x)}px, ${num(move.y)}px) scale(${num(move.scale, 5)})`,
    clipPath: `inset(${num(crop.top)}px ${num(right)}px ${num(bottom)}px ${num(crop.left)}px)`,
  };
}

/** The whole stage, untransformed: the other end of the move. */
export const FULL_FRAME = { transform: 'translate(0px, 0px) scale(1)' } as const;

const num = (n: number, digits = 2) => Number(n.toFixed(digits)).toString();

// ---------------------------------------------------------------------------------------------------------------
// The lobby's worlds and v2's watched office keep their fixed insets.

/** The panel on the right of a desktop. */
export const PANEL_WIDTH = 384;

/** Desktops: the top bar, and the panel with its margins. One object, so a memoised stage keeps its props. */
export const DESKTOP_INSETS = { top: 84, right: PANEL_WIDTH + 24, bottom: 0 } as const;

/** Phones: the top bar; the sheet's height below is added where it is known. */
export const PHONE_TOP_INSET = 64;
