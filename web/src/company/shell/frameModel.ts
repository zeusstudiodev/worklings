// The board frame's pure parts (docs/design-v3.md, "Boards over the map"; docs/design-hud.md, "Boards over the map"):
// how far a board's head folds for the room it has, which form the mini-map takes in the main view, and what it is named.
// Tested in test/board-frame.test.ts; BoardFrame.tsx and MiniMap.tsx measure and draw.
import type { StateTone } from '../ui/tone.ts';

// ---------------------------------------------------------------------------------------------------------------
// The head folds by its own measured room, as the company bar does: each piece is measured once in each form it has
// taken (again when its content changes), and the step is worked out from those widths, again whenever the head resizes.

/**
 * The steps, in the order things give way: 0 everything; 1 the summary goes; 2 the filters go into Filter; 3 the actions
 * take their glyph forms ("Fit the chart" becomes "Fit"); 4 the search field narrows to 120 px; 5 two rows, the title and
 * "Back to the office" over the rest. "Back to the office" keeps its words at every step.
 */
export const HEAD_STEPS = 5;

/** The actions' forms, by step: whole up to 2, glyph keys at 3, the search narrowed too from 4. */
export type ActionsForm = 'whole' | 'glyphs' | 'narrow';

/** The head's pieces, measured. 0 for a piece the board doesn't have; null for a form not yet measured. */
export interface HeadWidths {
  title: number;
  back: number;
  summary: number;
  views: number;
  /** The filters in a row, as they sit in the head. */
  filters: number | null;
  /** The Filter key they fold into; 0 when the board has no filters. */
  filterKey: number;
  actions: Record<ActionsForm, number | null>;
  /** Between two pieces in a row. */
  gap: number;
}

const sum = (gap: number, pieces: readonly number[]) => {
  const shown = pieces.filter((w) => w > 0);
  return shown.reduce((a, b) => a + b, 0) + gap * Math.max(0, shown.length - 1);
};

const actionsAt = (step: number): ActionsForm => (step >= 4 ? 'narrow' : step >= 3 ? 'glyphs' : 'whole');

/** The width a step needs, or null while a form it shows hasn't been measured yet. */
export function headNeed(w: HeadWidths, step: number): number | null {
  const filters = step >= 2 ? w.filterKey : w.filters;
  const actions = w.actions[actionsAt(step)];
  if (filters === null || actions === null) return null;
  if (step >= HEAD_STEPS) return Math.max(sum(w.gap, [w.title, w.back]), sum(w.gap, [w.views, filters, actions]));
  return sum(w.gap, [w.title, step === 0 ? w.summary : 0, w.views, filters, actions, w.back]);
}

/**
 * The step the head takes in `room` px: the first that fits. A step whose forms haven't been measured is taken as it
 * comes, so it can be measured; the next pass goes on from there. Past the last step the head takes two rows anyway.
 */
export function headStep(w: HeadWidths, room: number): number {
  for (let step = 0; step < HEAD_STEPS; step++) {
    const need = headNeed(w, step);
    if (need === null || need <= room) return step;
  }
  return HEAD_STEPS;
}

/** What a board shows at a step, for its own pieces (BoardFrame's useBoardHead). */
export interface HeadFold {
  step: number;
  /** The summary shows (step 0). */
  summary: boolean;
  /** The filters sit behind one Filter key (step 2 on). */
  filtersFolded: boolean;
  /** The actions take their named glyph forms and "Fit the chart" becomes "Fit" (step 3 on). */
  glyphs: boolean;
  /** A search field in the head narrows to 120 px, cutting its placeholder (step 4 on). */
  narrowSearch: boolean;
  /** The head takes two rows (step 5). */
  twoRows: boolean;
}

export const foldAt = (step: number): HeadFold => ({
  step,
  summary: step === 0,
  filtersFolded: step >= 2,
  glyphs: step >= 3,
  narrowSearch: step >= 4,
  twoRows: step >= HEAD_STEPS,
});

// ---------------------------------------------------------------------------------------------------------------
// The mini-map: whole where the main view has room for it beside a 760 px talk bar, else a thumbnail, which rises one
// gutter above the talk bar where even it has no room beside it (docs/design-hud.md, "Layouts").

export type MiniVariant = 'whole' | 'thumb' | 'above';

/** The main view's widths where it changes form, in rem so a larger text size reaches them as zoom does: 1288 and 900 px. */
export const MINI_WHOLE_REM = 80.5;
export const MINI_ABOVE_REM = 56.25;

export function miniVariant(main: number, rem = 16): MiniVariant {
  if (main >= MINI_WHOLE_REM * rem) return 'whole';
  return main >= MINI_ABOVE_REM * rem ? 'thumb' : 'above';
}

/**
 * The mini-map's geometry, from its frame's padding and its window: whole, a 6 px frame round 240 x 150 and a caption
 * of 2.125rem (34 px) under it; the thumbnail, 4 px round 96 x 56 and 7 px under it. Both sit one gutter from the main
 * view's right and foot, the thumbnail above the talk bar where it rises.
 */
export const MINI_GEOMETRY = {
  whole: { width: 240, height: 150, side: 6, top: 6, below: 0, captionRem: 2.125 },
  thumb: { width: 96, height: 56, side: 4, top: 4, below: 7, captionRem: 0 },
} as const;

export const miniGeometry = (variant: MiniVariant) => (variant === 'whole' ? MINI_GEOMETRY.whole : MINI_GEOMETRY.thumb);

/**
 * What a board keeps clear at its foot (`--dock-clear`): a gutter over the highest thing at the window's foot, the talk
 * bar with one strip line or the mini-map where it stands higher (stacked on the talk bar where it rises above it). Beside
 * a floating side panel the mini-map stands in the window's corner, out of the main view, so only the talk bar counts.
 * As CSS, since the talk bar's height is a variable the talk bar writes.
 */
export function dockClear(variant: MiniVariant, inMain = true): { clear: string; strip: string; over: string; miniWidth: string; miniHeight: string; miniBottom: string } {
  const g = miniGeometry(variant);
  const miniWidth = `${g.width + 2 * g.side}px`;
  const miniHeight = g.captionRem > 0 ? `calc(${g.height + g.top + g.below}px + ${g.captionRem}rem)` : `${g.height + g.top + g.below}px`;
  const stripLine = 'calc(var(--talk-now, 56px) + 38px)';
  // Where a board's scrollers end: a gutter over the strip's line and the talk bar, never under them. What the mini-map
  // stands higher than that (`over`) is scroll padding inside them, so the last card still scrolls clear of its corner.
  const strip = `calc(var(--gutter, 12px) * 2 + ${stripLine})`;
  const over = (clear: string) => `max(0px, calc(${clear} - ${strip}))`;
  if (!inMain) return { clear: strip, strip, over: '0px', miniWidth: '0px', miniHeight: '0px', miniBottom: '0px' };
  if (variant === 'above') {
    const miniBottom = 'calc(var(--gutter, 12px) * 2 + var(--talk-now, 56px))';
    const clear = `calc(${miniBottom} + ${miniHeight} + var(--gutter, 12px))`;
    return { clear, strip, over: over(clear), miniWidth, miniHeight, miniBottom };
  }
  const clear = `calc(var(--gutter, 12px) * 2 + max(${stripLine}, ${miniHeight}))`;
  return { clear, strip, over: over(clear), miniWidth, miniHeight, miniBottom: 'var(--gutter, 12px)' };
}

/** The mini-map's name: "Back to the office. Working, 4 need you." (design-v3, "Boards over the map"). */
export function miniName(pill: string, needs: number): string {
  const need = needs > 0 ? `, ${needs} ${needs === 1 ? 'needs' : 'need'} you` : '';
  return `Back to the office. ${pill}${need}.`;
}

/** The mark beside the state's word, as the bar pill's: working the ok disc, resting the rest dot, paused two bars, stopped a square. */
export type MiniMark = 'ok' | 'rest' | 'paused' | 'stopped' | 'needs' | 'error' | 'idle';

export function miniMark(pill: string, tone: StateTone): MiniMark {
  if (tone === 'working') return 'ok';
  if (tone === 'needs') return 'needs';
  if (tone === 'error') return 'error';
  if (tone === 'rest') return /^paused\b/i.test(pill) ? 'paused' : 'rest';
  return /^stopped\b/i.test(pill) ? 'stopped' : 'idle';
}
