// How the company bar gives way when it runs short of room (docs/design-v3.md, "The shell", "The company bar"; design-hud,
// "The bar gives way"). The bar measures each piece once, whole and folded, whenever its content changes; this works out
// the step from those widths and the room, so the bar never folds and measures again in a loop. Pure, for tests.
//
// v0.2, simpler: the bar holds Lobby, the name and the stage, the three views, the budget meter, Inbox, Preview while it
// runs and More. At work, the burn and Actions live in More, so there is less to give way.

/** Each piece's width in px, as drawn whole and as folded; a piece that isn't drawn (Preview while none runs) is 0. */
export interface BarPieces {
  /** Lobby with its word, and as its glyph and count. */
  lobby: number;
  lobbyFolded: number;
  /** The company's name at its natural width (it shows 220 px at most, 180 from step 2, and gives way last). */
  name: number;
  /** The stage pill with its word, and as its dot. */
  pill: number;
  pillFolded: number;
  /** The view switcher with its words, and as named glyphs. */
  views: number;
  viewsFolded: number;
  /** The budget meter ("$40 of $60"), which goes at step 3: More and the Spending view say it too. */
  meter: number;
  /** Inbox with its word and count, and as its glyph and count. */
  inbox: number;
  inboxFolded: number;
  /** Preview, shown while the app runs, which goes into More at step 2. */
  preview: number;
  /** More with its word, and as its glyph. */
  more: number;
  moreFolded: number;
  /** What doesn't change: the tiles' padding and the gaps between them. */
  fixed: number;
}

/**
 * The steps, in the order things give way: 1 the views' words; 2 Preview into More (which becomes its glyph) and Lobby's
 * word, the name capped at 180; 3 the budget meter, the stage pill's word and Inbox's word; 4 the name, cut down to 140
 * at the least.
 */
export type FoldStep = 0 | 1 | 2 | 3 | 4;

/** The steps the bar measures as whole rows; the last is worked out from the one before it. */
export const MEASURED_STEPS = [0, 1, 2, 3] as const;

export const NAME_MAX = 220;
export const NAME_MAX_FOLDED = 180;
export const NAME_MIN = 140;

/** The name's cap at a step. */
export const nameCap = (step: FoldStep): number => (step >= 2 ? NAME_MAX_FOLDED : NAME_MAX);

/** The bar's width at a step, with the name at its natural width up to that step's cap. */
export function barWidth(p: BarPieces, step: FoldStep): number {
  const name = Math.min(p.name, nameCap(step));
  const lobby = step >= 2 ? p.lobbyFolded : p.lobby;
  const pill = step >= 3 ? p.pillFolded : p.pill;
  const views = step >= 1 ? p.viewsFolded : p.views;
  const meter = step >= 3 ? 0 : p.meter;
  const inbox = step >= 3 ? p.inboxFolded : p.inbox;
  const tail = step >= 2 ? p.moreFolded : p.preview + p.more;
  return p.fixed + lobby + name + pill + views + meter + inbox + tail;
}

/**
 * The first step at which the bar fits its room, and the name's width there. At step 4 the name takes what is left,
 * never under 140 px (the whole of it stays in its `title`).
 */
export function foldStep(p: BarPieces, room: number): { step: FoldStep; name: number } {
  for (const step of MEASURED_STEPS) {
    if (barWidth(p, step) <= room) return { step, name: Math.min(p.name, nameCap(step)) };
  }
  const others = barWidth(p, 3) - Math.min(p.name, NAME_MAX_FOLDED);
  return { step: 4, name: Math.max(NAME_MIN, Math.min(p.name, NAME_MAX_FOLDED, room - others)) };
}
