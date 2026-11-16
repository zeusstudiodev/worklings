// The board frame's pure parts (docs/design-v3.md, "Boards over the map"; docs/design-hud.md): how far a board's head
// folds for its room, the mini-map's form for the main view's width, what the board keeps clear at its foot, and the
// mini-map's name and mark.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dockClear,
  foldAt,
  HEAD_STEPS,
  headNeed,
  headStep,
  type HeadWidths,
  MINI_GEOMETRY,
  miniMark,
  miniName,
  miniVariant,
} from '../web/src/company/shell/frameModel.ts';

/** The Tasks board's head as drawn at 1440 (05-tasks): title, Board and Plan, four filters, Add a task, Back to the office. */
const tasksHead = (over: Partial<HeadWidths> = {}): HeadWidths => ({
  title: 66,
  back: 146,
  summary: 330,
  views: 148,
  filters: 540,
  filterKey: 86,
  actions: { whole: 106, glyphs: 44, narrow: 44 },
  gap: 10,
  ...over,
});

describe("a board's head", () => {
  it('shows everything when it all fits', () => {
    const w = tasksHead();
    expect(headStep(w, 1400)).toBe(0);
  });

  it('lets the sentence go first', () => {
    const w = tasksHead();
    const all = headNeed(w, 0) as number;
    expect(headStep(w, all - 1)).toBe(1);
  });

  it('folds the filters into Filter next', () => {
    const w = tasksHead();
    expect(headStep(w, (headNeed(w, 1) as number) - 1)).toBe(2);
  });

  it('takes a step it has never measured, so the next pass can measure it', () => {
    const w = tasksHead({ actions: { whole: 106, glyphs: null, narrow: null } });
    expect(headStep(w, (headNeed(w, 2) as number) - 1)).toBe(3);
  });

  it('takes two rows when nothing else fits, the title and Back to the office over the rest', () => {
    const w = tasksHead();
    expect(headStep(w, 300)).toBe(HEAD_STEPS);
    // The wider of the two rows: the title and Back, or the views, Filter and the narrow keys.
    expect(headNeed(w, HEAD_STEPS)).toBe(Math.max(66 + 10 + 146, 148 + 10 + 86 + 10 + 44));
  });

  it('counts a gap only between pieces the board has', () => {
    const org = tasksHead({ summary: 0, views: 0, filters: 0, filterKey: 0, actions: { whole: 640, glyphs: 520, narrow: 440 } });
    expect(headNeed(org, 0)).toBe(66 + 10 + 640 + 10 + 146);
    // Without filters, folding them changes nothing.
    expect(headNeed(org, 2)).toBe(headNeed(org, 1));
  });

  it('fits the Org head at 768 px with the side panel open: 444 px of main view', () => {
    // Org chart, Find someone, Hire someone, the zoom tile and Fit the chart, Back to the office.
    const org = tasksHead({ summary: 230, views: 0, filters: 0, filterKey: 0, actions: { whole: 640, glyphs: 470, narrow: 390 } });
    const room = 444 - 20 - 12;
    const step = headStep(org, room);
    expect(step).toBe(HEAD_STEPS);
    expect(headNeed(org, step)).toBeLessThanOrEqual(room);
  });

  it('says what each step shows', () => {
    expect(foldAt(0)).toEqual({ step: 0, summary: true, filtersFolded: false, glyphs: false, narrowSearch: false, twoRows: false });
    expect(foldAt(2)).toMatchObject({ summary: false, filtersFolded: true, glyphs: false });
    expect(foldAt(4)).toMatchObject({ glyphs: true, narrowSearch: true, twoRows: false });
    expect(foldAt(HEAD_STEPS)).toMatchObject({ twoRows: true, narrowSearch: true });
  });
});

describe("the mini-map's form", () => {
  it('is whole from a 1288 px main view: 264 px beside a 760 px talk bar', () => {
    expect(miniVariant(1288)).toBe('whole');
    expect(miniVariant(1440)).toBe('whole');
  });

  it('is the thumbnail under 1288 px', () => {
    expect(miniVariant(1287)).toBe('thumb');
    expect(miniVariant(1056)).toBe('thumb');
    expect(miniVariant(900)).toBe('thumb');
  });

  it('rises above the talk bar under a 900 px main view, as at 1024 with the side panel open', () => {
    expect(miniVariant(899)).toBe('above');
    expect(miniVariant(680)).toBe('above');
  });

  it('follows the browser text size, as zoom does', () => {
    expect(miniVariant(1440, 20)).toBe('thumb');
    expect(miniVariant(1610, 20)).toBe('whole');
    expect(miniVariant(1124, 20)).toBe('above');
  });

  it("keeps the mini-map's CSS frame the same as the window the stage lies over", () => {
    const css = readFileSync(new URL('../web/src/company/shell/frame.css', import.meta.url), 'utf8');
    const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
    const whole = MINI_GEOMETRY.whole;
    const thumb = MINI_GEOMETRY.thumb;
    expect(block('.minimap')).toContain(`width: ${whole.width + 2 * whole.side}px;`);
    expect(block('.minimap')).toContain(`padding: ${whole.top}px ${whole.side}px ${whole.below}`);
    expect(block('.minimap__view')).toContain(`height: ${whole.height}px;`);
    expect(block('.minimap__caption')).toContain(`height: ${whole.captionRem}rem;`);
    expect(block('.minimap--above')).toContain(`width: ${thumb.width + 2 * thumb.side}px;`);
    expect(block('.minimap--above')).toContain(`padding: ${thumb.top}px ${thumb.side}px ${thumb.below}px;`);
    expect(block('.minimap--above .minimap__view')).toContain(`height: ${thumb.height}px;`);
  });
});

describe('what a board keeps clear at its foot', () => {
  it('is the talk bar with one strip line, or the whole mini-map beside it, whichever is taller', () => {
    const clear = dockClear('whole');
    expect(clear.clear).toBe('calc(var(--gutter, 12px) * 2 + max(calc(var(--talk-now, 56px) + 38px), calc(156px + 2.125rem)))');
    expect(clear.miniWidth).toBe('252px');
  });

  it('beside the thumbnail, the talk bar wins: 118 px with a one-line talk bar', () => {
    const clear = dockClear('thumb');
    expect(clear.miniHeight).toBe('67px');
    expect(clear.clear).toBe('calc(var(--gutter, 12px) * 2 + max(calc(var(--talk-now, 56px) + 38px), 67px))');
  });

  it('counts only the talk bar beside a floating side panel, where the mini-map stands in the window corner', () => {
    expect(dockClear('above', false).clear).toBe('calc(var(--gutter, 12px) * 2 + calc(var(--talk-now, 56px) + 38px))');
  });

  it('lets a board end a gutter over the strip and the talk bar, and keeps the extra height of the mini-map as scroll padding', () => {
    const whole = dockClear('whole');
    expect(whole.strip).toBe('calc(var(--gutter, 12px) * 2 + calc(var(--talk-now, 56px) + 38px))');
    expect(whole.over).toBe(`max(0px, calc(${whole.clear} - ${whole.strip}))`);
    expect(dockClear('above', false).over).toBe('0px');
    expect(dockClear('above', false).strip).toBe(dockClear('above', false).clear);
  });

  it('stacks the thumbnail on the talk bar where it rises above it', () => {
    const clear = dockClear('above');
    expect(clear.miniBottom).toBe('calc(var(--gutter, 12px) * 2 + var(--talk-now, 56px))');
    expect(clear.clear).toBe('calc(calc(var(--gutter, 12px) * 2 + var(--talk-now, 56px)) + 67px + var(--gutter, 12px))');
  });
});

describe("the mini-map's name and mark", () => {
  it("says the company's state in the bar pill's word and what needs you", () => {
    expect(miniName('Working', 4)).toBe('Back to the office. Working, 4 need you.');
    expect(miniName('Resting until 14:00', 1)).toBe('Back to the office. Resting until 14:00, 1 needs you.');
    expect(miniName('Idle', 0)).toBe('Back to the office. Idle.');
  });

  it("takes the bar pill's mark, with a shape for each state", () => {
    expect(miniMark('Working', 'working')).toBe('ok');
    expect(miniMark('Resting until 14:00', 'rest')).toBe('rest');
    expect(miniMark('Paused by you', 'rest')).toBe('paused');
    expect(miniMark('Stopped', 'neutral')).toBe('stopped');
    expect(miniMark('Idle', 'neutral')).toBe('idle');
    expect(miniMark('Waiting for you', 'needs')).toBe('needs');
    expect(miniMark("Can't run", 'error')).toBe('error');
  });
});
