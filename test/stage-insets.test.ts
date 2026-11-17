// The stage's two insets for every layout in the shell's table (docs/design-v3.md, "The shell"; docs/design-hud.md, "How
// the HUD sits over the office"), and the mini-map's move: the transform that lays the whole stage on the mini-map's window.
import { describe, expect, it } from 'vitest';
import { cropInsets, FULL_FRAME, miniFrame, miniMove, type StageFrame, stageInsets } from '../web/src/company/insets.ts';

/** The shell at rest: a one-line talk bar, no caption or map keys measured, no safe area. */
const frame = (over: Partial<StageFrame>): StageFrame => ({
  layout: 'docked',
  side: null,
  talk: 56,
  caption: null,
  keys: null,
  sheet: null,
  safeBottom: 0,
  height: 900,
  ...over,
});

describe('the camera fit on desktops', () => {
  it('keeps the bar band, a docked side panel with its gutters, and the talk bar with one strip line at 1440', () => {
    const { fit } = stageInsets(frame({ side: 360 }));
    // 12 + 44 + 12 at the top; 360 + 24 on the right; 12 + 56 + 8 + 30 at the foot.
    expect(fit).toEqual({ top: 68, right: 384, bottom: 106, left: 0 });
  });

  // v0.8: a closed side panel leaves no pull after the start (the inbox card is the way back), so the office takes the width.
  it('takes the whole width when the docked side panel is closed', () => {
    expect(stageInsets(frame({ side: null })).fit.right).toBe(0);
  });

  it('keeps a fixed share for the inbox card, however tall it is, so answering never moves the office', () => {
    const short = stageInsets(frame({ side: null, card: 120 })).fit;
    const tall = stageInsets(frame({ side: null, card: 380 })).fit;
    expect(short).toEqual(tall);
    expect(short.bottom).toBe(12 + 56 + 8 + 220);
  });

  it('takes the 320 px side panel at 1024 x 768', () => {
    expect(stageInsets(frame({ side: 320, height: 768 })).fit).toEqual({ top: 68, right: 344, bottom: 106, left: 0 });
  });

  it('keeps a floating side panel out of the fit at 768 x 1024, so opening it never moves the office', () => {
    const open = stageInsets(frame({ layout: 'floating', side: 300, height: 1024 })).fit;
    const hidden = stageInsets(frame({ layout: 'floating', side: null, height: 1024 })).fit;
    expect(open).toEqual(hidden);
    expect(open.right).toBe(0);
  });

  it('never moves the camera while the talk bar grows or the caption and the map keys change', () => {
    const rest = stageInsets(frame({ side: 360 })).fit;
    expect(stageInsets(frame({ side: 360, talk: 176, caption: 170, keys: 120 })).fit).toEqual(rest);
  });
});

describe('beside the progress column (v0.2)', () => {
  it('stands the office and its labels right of the column, one gutter clear, at 1440 and 1024', () => {
    const wide = stageInsets(frame({ side: 360, progress: 572 }));
    expect(wide.fit).toEqual({ top: 68, right: 384, bottom: 106, left: 584 });
    expect(wide.labels.left).toBe(584);
    expect(stageInsets(frame({ side: 320, height: 768, progress: 442.4 })).fit.left).toBe(454);
  });

  it('keeps the left edge free without the column, and phones, where progress covers the stage, ignore it', () => {
    expect(stageInsets(frame({ progress: null })).fit.left).toBe(0);
    expect(stageInsets(frame({ progress: 0 })).labels.left).toBe(12);
    expect(stageInsets(frame({ layout: 'phone', progress: 360, height: 812 })).fit.left).toBe(0);
  });
});

describe("the labels' area on desktops", () => {
  it('starts 8 px under the lower of the caption and the map keys, and ends above the three strip lines', () => {
    const { labels } = stageInsets(frame({ side: 360, caption: 152, keys: 120 }));
    // 12 + 56 + 8 + 3 x 30 + 2 x 4 = 174 at the foot; 12 px left of the side panel, which sits a gutter in.
    expect(labels).toEqual({ top: 160, right: 384, bottom: 174, left: 12 });
  });

  it('keeps under the bar band when neither the caption nor the map keys are drawn', () => {
    expect(stageInsets(frame({})).labels.top).toBe(68);
  });

  it('grows with the talk bar', () => {
    expect(stageInsets(frame({ talk: 116 })).labels.bottom).toBe(234);
  });

  it('keeps clear of a floating side panel while it shows, though the camera does not', () => {
    const open = stageInsets(frame({ layout: 'floating', side: 300, height: 1024 }));
    expect(open.labels.right).toBe(324);
    expect(stageInsets(frame({ layout: 'floating', side: null, height: 1024 })).labels.right).toBe(12);
  });

  it('keeps a gutter from the edge while the docked side panel is closed', () => {
    expect(stageInsets(frame({ side: null })).labels.right).toBe(12);
  });

  it('ends above the inbox card as it measures', () => {
    expect(stageInsets(frame({ side: null, card: 300 })).labels.bottom).toBe(12 + 56 + 8 + 300 + 8);
  });
});

describe('phones', () => {
  // v0.8: the views row moved into More, so the bar alone is at the top.
  it('keeps the bar at the top and the talk bar with its strip line at the foot, at 375 x 812', () => {
    const { fit, labels } = stageInsets(frame({ layout: 'phone', height: 812 }));
    // 8 + 44 + 8 at the top; 8 + 56 + 8 + 36 + 8 at the foot for the camera.
    expect(fit).toEqual({ top: 60, right: 0, bottom: 116, left: 0 });
    // The labels end at the strip line's top edge and keep a gutter from the sides.
    expect(labels).toEqual({ top: 60, right: 8, bottom: 108, left: 8 });
  });

  it('keeps the inbox card clear in a short window too, where there is no strip', () => {
    const { labels } = stageInsets(frame({ layout: 'short', height: 375, card: 150 }));
    expect(labels.bottom).toBe(8 + 56 + 8 + 150 + 8);
  });

  it('keeps the inbox card clear at the foot: a fixed share for the camera, its measure for the labels', () => {
    const { fit, labels } = stageInsets(frame({ layout: 'phone', height: 812, card: 200 }));
    expect(fit.bottom).toBe(8 + 56 + 8 + 96 + 8);
    expect(labels.bottom).toBe(8 + 56 + 8 + 200 + 8 - 8);
  });

  it('adds the safe area at the foot', () => {
    const { fit, labels } = stageInsets(frame({ layout: 'phone', height: 812, safeBottom: 34 }));
    expect(fit.bottom).toBe(150);
    expect(labels.bottom).toBe(142);
  });

  it('frames the office above the side panel sheet while it is up', () => {
    // The sheet's top edge at 560 px of an 812 px window: the office is the strip above it, a gutter clear.
    const { fit, labels } = stageInsets(frame({ layout: 'phone', height: 812, sheet: 560 }));
    expect(fit.bottom).toBe(260);
    expect(labels.bottom).toBe(260);
  });

  it('folds the views into the bar and hides the strip in short windows: 720 x 450, a 1440 laptop at 200%', () => {
    const { fit, labels } = stageInsets(frame({ layout: 'short', height: 450 }));
    // 8 + 44 + 8 at the top; 8 + 56 + 8 at the foot.
    expect(fit).toEqual({ top: 60, right: 0, bottom: 72, left: 0 });
    expect(labels).toEqual({ top: 60, right: 8, bottom: 72, left: 8 });
  });

  it('keeps the office in view beside the peek that hangs under the bar in short windows: 812 x 375', () => {
    // The peek runs from 60 to 136 px; its top edge must not read as a sheet rising from the foot (which left no room).
    const { fit, labels } = stageInsets(frame({ layout: 'short', height: 375, sheet: 60, sheetBottom: 136 }));
    expect(fit).toEqual({ top: 144, right: 0, bottom: 72, left: 0 });
    expect(labels).toEqual({ top: 144, right: 8, bottom: 72, left: 8 });
    expect(375 - fit.top - fit.bottom).toBeGreaterThan(100);
  });

  it('frames the office as at rest in short windows while the sheet covers it, so closing it moves nothing', () => {
    expect(stageInsets(frame({ layout: 'short', height: 450, sheet: 60, sheetBottom: null })).fit).toEqual(stageInsets(frame({ layout: 'short', height: 450 })).fit);
  });

  it('leaves the labels no area in short windows while the sheet is fully up, so none takes focus under it (2.4.11)', () => {
    const { labels } = stageInsets(frame({ layout: 'short', height: 375, sheet: 60, sheetBottom: null }));
    expect(375 - labels.top - labels.bottom).toBeLessThanOrEqual(0);
    // Down or peeking, the labels keep their room.
    expect(stageInsets(frame({ layout: 'short', height: 375 })).labels.top).toBeLessThan(375 / 2);
  });

  it('ignores the side panel, which is a sheet there', () => {
    expect(stageInsets(frame({ layout: 'phone', side: 300, height: 812 }))).toEqual(stageInsets(frame({ layout: 'phone', side: null, height: 812 })));
  });
});

describe("the mini-map's move", () => {
  it('lays the whole stage on the window at 1440 x 900, where both have the same shape', () => {
    const move = miniMove({ width: 1440, height: 900 }, { left: 1176, top: 698, width: 240, height: 150 });
    expect(move.scale).toBeCloseTo(1 / 6, 6);
    expect(move.crop).toEqual({ left: 0, top: 0, width: 1440, height: 900 });
    expect(move.x).toBeCloseTo(1176, 6);
    expect(move.y).toBeCloseTo(698, 6);
  });

  it('covers a window of another shape without stretching: the middle of the stage, cut to the window', () => {
    const mini = { left: 912, top: 700, width: 96, height: 56 };
    const move = miniMove({ width: 1024, height: 768 }, mini);
    expect(move.scale).toBeCloseTo(96 / 1024, 6);
    // The crop has the window's shape and sits in the middle of the stage.
    expect(move.crop.width / move.crop.height).toBeCloseTo(96 / 56, 6);
    expect(move.crop.left).toBeCloseTo(0, 6);
    expect(move.crop.top + move.crop.height / 2).toBeCloseTo(384, 6);
    // And it lands exactly on the window.
    expect(move.scale * move.crop.left + move.x).toBeCloseTo(mini.left, 6);
    expect(move.scale * (move.crop.left + move.crop.width) + move.x).toBeCloseTo(mini.left + mini.width, 6);
    expect(move.scale * move.crop.top + move.y).toBeCloseTo(mini.top, 6);
    expect(move.scale * (move.crop.top + move.crop.height) + move.y).toBeCloseTo(mini.top + mini.height, 6);
  });

  it('crops a tall stage across: 768 x 1024 with the thumbnail', () => {
    const move = miniMove({ width: 768, height: 1024 }, { left: 340, top: 860, width: 96, height: 56 });
    expect(move.crop.width).toBeCloseTo(768, 6);
    expect(move.crop.height).toBeLessThan(1024);
    expect(move.crop.top).toBeGreaterThan(0);
  });

  it("gives the camera the crop's insets, which add back up to the stage", () => {
    const stage = { width: 1024, height: 768 };
    const move = miniMove(stage, { left: 912, top: 700, width: 96, height: 56 });
    const insets = cropInsets(stage, move.crop);
    expect(insets.left + move.crop.width + insets.right).toBeCloseTo(1024, 6);
    expect(insets.top + move.crop.height + insets.bottom).toBeCloseTo(768, 6);
    expect(insets.top).toBeCloseTo(insets.bottom, 6);
  });

  it('writes the transform the stage animates to, a translate and one scale, and the clip to the crop it keeps', () => {
    const stage = { width: 1024, height: 768 };
    const move = miniMove(stage, { left: 912, top: 700, width: 96, height: 56 });
    const at = miniFrame(move, stage);
    expect(at.transform).toBe('translate(912px, 692px) scale(0.09375)');
    expect(at.clipPath).toBe('inset(85.33px 0px 85.33px 0px)');
    expect(FULL_FRAME.transform).toBe('translate(0px, 0px) scale(1)');
  });
});

describe('what the open feed covers', () => {
  const feed = { left: 300, top: 300, right: 1000, bottom: 840 };

  it('hands the open feed on to the labels so what lies under it leaves the page, and leaves the fit alone', () => {
    const open = stageInsets(frame({ side: 360, feed }));
    expect(open.covered).toEqual(feed);
    expect(open.fit).toEqual(stageInsets(frame({ side: 360 })).fit);
    expect(open.labels).toEqual(stageInsets(frame({ side: 360 })).labels);
  });

  it('covers nothing while the feed is closed, and on phones, where the feed covers the whole stage', () => {
    expect(stageInsets(frame({ side: 360 })).covered).toBeNull();
    expect(stageInsets(frame({ layout: 'phone', feed })).covered).toBeNull();
  });
});
