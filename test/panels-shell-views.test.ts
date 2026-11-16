// The stage and dock's shell, its pure parts: the stage's mode for a main view, the side panel head's Back, the page's
// title, which layout a window gets, the side panel's widths, its separator's keys and presses and the preference it
// keeps (web/src/company/panelView.ts, shell/sidePanelModel.ts), and how the company bar gives way (shell/barFold.ts).
import { describe, expect, it } from 'vitest';
import type { CompanyRoute, MainView } from '../web/src/company/address.ts';
import { companyTitle } from '../web/src/company/model.ts';
import { headBackAt, isBoard, mainViewTitle, peeksAt, sideShownAt, stageModeOf } from '../web/src/company/panelView.ts';
import { type BarPieces, barWidth, foldStep } from '../web/src/company/shell/barFold.ts';
import { fitPanelWidth, layoutOf, nextStop, panelBounds, readPanelMemory, widthAtPointer, widthByKey, widthFromDrag, writePanelMemory } from '../web/src/company/shell/sidePanelModel.ts';

const office: MainView = { kind: 'office' };
const tasks: MainView = { kind: 'tasks' };

describe("the stage under a main view", () => {
  it('draws the whole office on the office, and in the mini-map on a board on desktops', () => {
    expect(stageModeOf({ main: office, phone: false, feedOpen: false })).toBe('office');
    expect(stageModeOf({ main: office, phone: false, feedOpen: true })).toBe('office');
    for (const main of [{ kind: 'org' }, tasks, { kind: 'plan', version: 2 }, { kind: 'dashboards', board: null }, { kind: 'decisions' }] as MainView[]) {
      expect(isBoard(main)).toBe(true);
      expect(stageModeOf({ main, phone: false, feedOpen: false })).toBe('mini');
    }
  });

  it('draws nothing under Preview, a diff, a board on a phone, or the feed open over a board or a phone', () => {
    expect(stageModeOf({ main: { kind: 'preview' }, phone: false, feedOpen: false })).toBe('covered');
    expect(stageModeOf({ main: { kind: 'diff', task: 't-1' }, phone: false, feedOpen: false })).toBe('covered');
    expect(stageModeOf({ main: tasks, phone: true, feedOpen: false })).toBe('covered');
    expect(stageModeOf({ main: tasks, phone: false, feedOpen: true })).toBe('covered');
    expect(stageModeOf({ main: office, phone: true, feedOpen: true })).toBe('covered');
    expect(stageModeOf({ main: office, phone: true, feedOpen: false })).toBe('office');
  });
});

describe('the side panel beside progress', () => {
  const progress: MainView = { kind: 'progress' };
  const at = (o: Partial<Parameters<typeof sideShownAt>[0]>) => sideShownAt({ phone: false, main: progress, panel: null, overlay: false, homeSheet: false, hidden: false, inboxBeside: false, ...o });

  it('opens progress with the panel closed on desktops, though you keep it open elsewhere', () => {
    expect(at({})).toBe(false);
    expect(at({ main: office })).toBe(true);
    expect(at({ main: tasks })).toBe(true);
    expect(at({ main: office, hidden: true })).toBe(false);
  });

  it('shows it for a view opened into it, an inbox item from a needs-you link, an overlay, or the inbox you asked for', () => {
    expect(at({ panel: { kind: 'inbox', item: 'q-1' } })).toBe(true);
    expect(at({ panel: { kind: 'task', task: 't-1' }, hidden: true })).toBe(true);
    expect(at({ overlay: true })).toBe(true);
    expect(at({ inboxBeside: true })).toBe(true);
    expect(at({ inboxBeside: true, hidden: true })).toBe(false);
  });

  it("leaves phones to their sheets", () => {
    expect(at({ phone: true })).toBe(false);
    expect(at({ phone: true, homeSheet: true })).toBe(true);
    expect(at({ phone: true, main: office, hidden: false })).toBe(false);
  });
});

describe("the side panel head's Back", () => {
  const kai: CompanyRoute = { main: tasks, panel: { kind: 'person', person: 'kai' } };
  const back = (prev: string | null, route = kai, feedOpen = false) => headBackAt({ prev, company: 'cafe', route, feedOpen });

  it('shows when the entry before is another side panel view over the same main view', () => {
    expect(back('/c/cafe/tasks?panel=people/ines')).toBe(true);
    expect(back('/c/cafe/tasks?panel=tasks/t-1')).toBe(true);
  });

  it('shows when the entry before is the same main view with the feed open, where the person opened it from a line', () => {
    expect(back('/c/cafe/tasks', kai, true)).toBe(true);
    expect(back('/c/cafe/tasks', kai, false)).toBe(false);
  });

  it('hides otherwise: opened from outside, over another main view, another company, an old address, or on the home', () => {
    expect(back(null)).toBe(false);
    expect(back('/c/cafe/org?panel=people/ines')).toBe(false);
    expect(back('/c/other/tasks?panel=people/ines')).toBe(false);
    expect(back('/c/cafe/people/ines')).toBe(false);
    expect(back('/c/cafe/tasks?panel=people/kai')).toBe(false);
    expect(back('/c/cafe/tasks?panel=people/ines', { main: tasks, panel: null })).toBe(false);
  });
});

describe("the page's title", () => {
  it('names the main view before the company, so Back and Forward say where they land', () => {
    expect(companyTitle('Café Lumen', 6, mainViewTitle({ kind: 'org' }))).toBe('(6) Org chart, Café Lumen in Worklings');
    expect(companyTitle('Café Lumen', 6, mainViewTitle(office))).toBe('(6) Café Lumen in Worklings');
    expect(companyTitle('Café Lumen', 0, mainViewTitle({ kind: 'plan', version: 2 }))).toBe('The plan, version 2, Café Lumen in Worklings');
    expect(mainViewTitle({ kind: 'decisions' })).toBe('Decision log');
    expect(companyTitle('Café Lumen', 2, mainViewTitle({ kind: 'progress' }))).toBe('(2) Progress, Café Lumen in Worklings');
  });
});

describe('the stage under progress (v0.2)', () => {
  it('draws the whole office beside the column on desktops and nothing under it on phones; progress is no board', () => {
    const progress: MainView = { kind: 'progress' };
    expect(isBoard(progress)).toBe(false);
    expect(stageModeOf({ main: progress, phone: false, feedOpen: false })).toBe('office');
    expect(stageModeOf({ main: progress, phone: false, feedOpen: true })).toBe('office');
    expect(stageModeOf({ main: progress, phone: true, feedOpen: false })).toBe('covered');
  });

  it("peeks the phone's inbox sheet only over the office, never over progress", () => {
    const at = (main: MainView) => peeksAt({ phone: true, main, panel: null, sheetUp: false, overlay: false, feedOpen: false, typing: false });
    expect(at(office)).toBe(true);
    expect(at({ kind: 'progress' })).toBe(false);
  });
});

describe('which layout a window gets', () => {
  it('docks from 896 px, floats from 721 to 895, and is a phone at 720 wide or 480 tall, short under 560 tall', () => {
    expect(layoutOf(1440, 900)).toBe('docked');
    expect(layoutOf(896, 900)).toBe('docked');
    expect(layoutOf(895, 1024)).toBe('floating');
    expect(layoutOf(721, 1024)).toBe('floating');
    expect(layoutOf(720, 1024)).toBe('phone');
    expect(layoutOf(375, 812)).toBe('phone');
    expect(layoutOf(844, 390)).toBe('short');
    expect(layoutOf(720, 450)).toBe('short');
    expect(layoutOf(1440, 480)).toBe('short');
    expect(layoutOf(375, 559)).toBe('short');
  });
});

describe("the side panel's width", () => {
  it('is 300 to min(560, window − 596), 320 by default below 1280 and 360 from 1280', () => {
    expect(panelBounds(1440)).toEqual({ min: 300, max: 560, preferred: 360 });
    expect(panelBounds(1280)).toEqual({ min: 300, max: 560, preferred: 360 });
    expect(panelBounds(1024)).toEqual({ min: 300, max: 428, preferred: 320 });
    expect(panelBounds(896)).toEqual({ min: 300, max: 300, preferred: 300 });
  });

  it('fits a kept width to the window, and takes the default when none is kept', () => {
    expect(fitPanelWidth(null, panelBounds(1440))).toBe(360);
    expect(fitPanelWidth(500, panelBounds(1024))).toBe(428);
    expect(fitPanelWidth(120, panelBounds(1440))).toBe(300);
    expect(fitPanelWidth(410.6, panelBounds(1440))).toBe(411);
  });

  it('opens to the pointer, between the narrowest and the widest, when pulled out from hidden', () => {
    const bounds = panelBounds(1440);
    expect(widthAtPointer(1440 - 12 - 400, 1440, bounds)).toBe(400);
    expect(widthFromDrag({ startX: 1436, startWidth: null }, 1440 - 12 - 400, 1440, bounds)).toBe(400);
    expect(widthFromDrag({ startX: 1436, startWidth: null }, 100, 1440, bounds)).toBe(560);
    expect(widthFromDrag({ startX: 1436, startWidth: null }, 1400, 1440, bounds)).toBe(300);
  });

  it('moves its edge as far as the pointer moves while shown, wherever across the separator it was grabbed', () => {
    const bounds = panelBounds(1440);
    // At 300, the separator's 8 px band lies over 1120 to 1128; grabbed at its middle and taken 60 px left: 360, not 366.
    const grabbed = { startX: 1124, startWidth: 300 };
    expect(widthFromDrag(grabbed, 1124, 1440, bounds)).toBe(300);
    expect(widthFromDrag(grabbed, 1064, 1440, bounds)).toBe(360);
    expect(widthFromDrag({ startX: 1121, startWidth: 300 }, 1061, 1440, bounds)).toBe(360);
    expect(widthFromDrag(grabbed, 600, 1440, bounds)).toBe(560);
    expect(widthFromDrag(grabbed, 1300, 1440, bounds)).toBe(300);
  });

  it("moves by the separator's keys: Left widens, Right narrows, 16 px or 64 with Shift; Home narrowest, End widest", () => {
    const bounds = panelBounds(1440);
    expect(widthByKey('ArrowLeft', false, 360, bounds)).toBe(376);
    expect(widthByKey('ArrowRight', false, 360, bounds)).toBe(344);
    expect(widthByKey('ArrowLeft', true, 360, bounds)).toBe(424);
    expect(widthByKey('ArrowLeft', true, 520, bounds)).toBe(560);
    expect(widthByKey('ArrowRight', true, 320, bounds)).toBe(300);
    expect(widthByKey('Home', false, 400, bounds)).toBe(300);
    expect(widthByKey('End', false, 400, bounds)).toBe(560);
    expect(widthByKey('Enter', false, 400, bounds)).toBeNull();
  });

  it('steps through narrow, the default and wide on a press, then narrow again', () => {
    const bounds = panelBounds(1440);
    expect(nextStop(300, bounds)).toBe(360);
    expect(nextStop(360, bounds)).toBe(560);
    expect(nextStop(560, bounds)).toBe(300);
    expect(nextStop(400, bounds)).toBe(560);
  });
});

describe("the side panel's memory", () => {
  it('reads what it wrote, and the defaults from anything else', () => {
    expect(readPanelMemory(writePanelMemory({ width: 420, hidden: true }))).toEqual({ width: 420, hidden: true });
    expect(readPanelMemory(null)).toEqual({ width: null, hidden: false });
    for (const raw of ['', 'not json', '42', 'null', '{"width":"wide","hidden":"yes"}', '{"width":1e999}']) {
      expect(readPanelMemory(raw), raw).toEqual({ width: null, hidden: false });
    }
    expect(readPanelMemory('{"hidden":true}')).toEqual({ width: null, hidden: true });
  });
});

describe('the company bar giving way', () => {
  // Widths as measured at 1440 with a long name: the bar fits whole from 1240 px of room.
  const pieces: BarPieces = {
    lobby: 104,
    lobbyFolded: 64,
    name: 240,
    pill: 96,
    pillFolded: 20,
    views: 330,
    viewsFolded: 156,
    meter: 96,
    inbox: 104,
    inboxFolded: 60,
    preview: 92,
    more: 84,
    moreFolded: 44,
    fixed: 140,
  };

  it('keeps everything while it fits, the name at 220 at most', () => {
    expect(barWidth(pieces, 0)).toBe(1266);
    expect(foldStep(pieces, 1266)).toEqual({ step: 0, name: 220 });
  });

  it("gives way in order: the views' words, Preview and Lobby's word, then the meter, the pill's word and Inbox's", () => {
    expect(foldStep(pieces, 1265).step).toBe(1);
    expect(foldStep(pieces, barWidth(pieces, 2))).toEqual({ step: 2, name: 180 });
    expect(foldStep(pieces, barWidth(pieces, 3)).step).toBe(3);
    // Step 3 has no meter: More and the Spending view say it.
    expect(barWidth(pieces, 2) - barWidth(pieces, 3)).toBe(pieces.meter + pieces.pill - pieces.pillFolded + pieces.inbox - pieces.inboxFolded);
  });

  it('needs less room without a preview running', () => {
    expect(foldStep({ ...pieces, preview: 0 }, 1180).step).toBe(0);
    expect(foldStep(pieces, 1180).step).toBe(1);
  });

  it('cuts the name last, never under 140 px', () => {
    const step3 = barWidth(pieces, 3);
    expect(foldStep(pieces, step3 - 20)).toEqual({ step: 4, name: 160 });
    expect(foldStep(pieces, 300)).toEqual({ step: 4, name: 140 });
  });
});
