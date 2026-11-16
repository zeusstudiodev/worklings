import { describe, expect, it } from 'vitest';
import type { PreviewView } from '../src/core/company.ts';
import {
  appAddress,
  DEVICE_FRAMES,
  fitScale,
  frameWords,
  NO_SHOTS,
  onTailnet,
  pathHref,
  PREVIEW_SANDBOX,
  previewAddress,
  previewState,
  screenShows,
  shotsButton,
  shotsNewestFirst,
  shotWho,
} from '../web/src/company/preview/previewModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { at, NOW, PEOPLE } from './panels-boards-kit.ts';

const OFFICE = 'http://127.0.0.1:7421';
const view = (extra: Partial<PreviewView>): PreviewView => ({ state: 'off', url: null, command: null, problem: null, ...extra });

describe('the sandbox', () => {
  it('lets the app run its scripts at its own origin and never take the office’s tab anywhere', () => {
    const flags = PREVIEW_SANDBOX.split(' ');
    expect(flags).toEqual(['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups']);
    for (const never of ['allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-modals', 'allow-popups-to-escape-sandbox', 'allow-downloads']) {
      expect(flags).not.toContain(never);
    }
  });
});

describe("the app's address", () => {
  it('takes the proxy’s origin and the path the dev server printed', () => {
    expect(appAddress('http://127.0.0.1:5199/', OFFICE)).toEqual({ ok: true, origin: 'http://127.0.0.1:5199', path: '/' });
    expect(appAddress('http://127.0.0.1:5199/app/?lang=de', OFFICE)).toEqual({ ok: true, origin: 'http://127.0.0.1:5199', path: '/app/?lang=de' });
    expect(appAddress(null, OFFICE)).toBeNull();
  });

  it("never frames the office's own origin, which a sandbox that keeps its origin could reach", () => {
    expect(appAddress('http://127.0.0.1:7421/api/c/demo', OFFICE)).toMatchObject({ ok: false });
  });

  it('turns down what isn’t a web address', () => {
    expect(appAddress('javascript:alert(1)', OFFICE)).toMatchObject({ ok: false });
    expect(appAddress('data:text/html,<p>hi</p>', OFFICE)).toMatchObject({ ok: false });
    expect(appAddress('not a url', OFFICE)).toMatchObject({ ok: false });
  });
});

describe('the app on the tailnet', () => {
  const tailnet = { hostname: 'office.tail1234.ts.net', origin: 'https://office.tail1234.ts.net' };
  const here = { hostname: '127.0.0.1', origin: OFFICE };
  const both = { url: 'http://127.0.0.1:5199/', tailnetUrl: 'https://office.tail1234.ts.net:8443/' };

  it('opens the app at its tailnet address when the office was opened on the ts.net name', () => {
    expect(previewAddress(both, tailnet)).toEqual({ ok: true, origin: 'https://office.tail1234.ts.net:8443', path: '/' });
    expect(previewAddress(both, { ...tailnet, hostname: 'office.tail1234.ts.net.' })).toMatchObject({ ok: true, origin: 'https://office.tail1234.ts.net:8443' });
  });

  it('opens the proxy on this machine everywhere else, whatever the tailnet address', () => {
    expect(previewAddress(both, here)).toEqual({ ok: true, origin: 'http://127.0.0.1:5199', path: '/' });
    expect(previewAddress(both, { hostname: 'ts.net.example.com', origin: 'https://ts.net.example.com' })).toMatchObject({ ok: true, origin: 'http://127.0.0.1:5199' });
    expect(previewAddress({ url: 'http://127.0.0.1:5199/' }, here)).toMatchObject({ ok: true });
  });

  it('says why when the app is up on the computer but not on the tailnet', () => {
    expect(previewAddress({ url: 'http://127.0.0.1:5199/', tailnetUrl: null }, tailnet)).toEqual({
      ok: false,
      problem: "The app runs on the office's computer but isn't on the tailnet, so it can't show here.",
    });
    expect(previewAddress({ url: null, tailnetUrl: null }, tailnet)).toBeNull();
  });

  it("refuses a tailnet address that is the office's own origin", () => {
    expect(previewAddress({ url: 'http://127.0.0.1:5199/', tailnetUrl: 'https://office.tail1234.ts.net/' }, tailnet)).toMatchObject({ ok: false });
  });

  it('tells the ts.net name apart from look-alikes', () => {
    expect([onTailnet('office.tail1234.ts.net'), onTailnet('OFFICE.TAIL1234.TS.NET'), onTailnet('ts.net.example.com'), onTailnet('notts.net.evil'), onTailnet('127.0.0.1')]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('the path in the bar', () => {
  const origin = 'http://127.0.0.1:5199';

  it('goes to a path inside the app', () => {
    expect(pathHref('/menu', origin)).toEqual({ ok: true, path: '/menu', href: 'http://127.0.0.1:5199/menu' });
    expect(pathHref('menu?lang=de#top', origin)).toEqual({ ok: true, path: '/menu?lang=de#top', href: 'http://127.0.0.1:5199/menu?lang=de#top' });
    expect(pathHref('', origin)).toEqual({ ok: true, path: '/', href: 'http://127.0.0.1:5199/' });
  });

  it('keeps a slash pair or a backslash from leaving the app', () => {
    expect(pathHref('//example.com/x', origin)).toEqual({ ok: true, path: '/example.com/x', href: 'http://127.0.0.1:5199/example.com/x' });
    expect(pathHref('\\\\example.com', origin)).toMatchObject({ ok: true, href: 'http://127.0.0.1:5199/example.com' });
  });

  it('takes a full address of the app, and turns down any other site', () => {
    expect(pathHref('http://127.0.0.1:5199/cart', origin)).toMatchObject({ ok: true, path: '/cart' });
    expect(pathHref('https://example.com/', origin)).toEqual({ ok: false, problem: 'Only pages of the app open here. Type a path in it, like /menu.' });
    expect(pathHref('javascript:alert(1)', origin)).toMatchObject({ ok: false });
  });
});

describe('the states table', () => {
  const up = appAddress('http://127.0.0.1:5199/', OFFICE);

  it('says the app isn’t running and offers to start it with the command shown', () => {
    expect(previewState(view({ command: 'npm run dev' }), null)).toMatchObject({ line: "The app isn't running.", start: true, command: 'npm run dev', showApp: false });
  });

  it('says there is no app to preview when the project has no command', () => {
    expect(previewState(view({}), null)).toMatchObject({ line: 'This project has no app to preview. Screenshots people share still show here.', start: false });
  });

  it('says it is starting, over an empty frame', () => {
    expect(previewState(view({ state: 'starting', command: 'npm run dev' }), null)).toMatchObject({ line: 'Starting the app…', starting: true, start: false });
  });

  it('shows the app when it is up', () => {
    expect(previewState(view({ state: 'up', url: 'http://127.0.0.1:5199/', command: 'npm run dev' }), up)).toMatchObject({ line: null, showApp: true, reload: true });
  });

  it('says why when it is down, and offers to start it again', () => {
    expect(previewState(view({ state: 'down', command: 'npm run dev', problem: 'npm run dev exited with code 1.' }), null)).toMatchObject({
      line: "The app didn't answer. npm run dev exited with code 1.",
      start: true,
      reload: false,
    });
  });

  it('refuses to show an app at an address it turned down', () => {
    const own = appAddress(`${OFFICE}/`, OFFICE);
    expect(previewState(view({ state: 'up', url: `${OFFICE}/`, command: 'npm run dev' }), own)).toMatchObject({
      showApp: false,
      start: false,
      line: "The app's address is the office's own, so the office doesn't show it here.",
    });
  });

  it("doesn't offer to start an app that runs but isn't on the tailnet", () => {
    const tailnet = { hostname: 'office.tail1234.ts.net', origin: 'https://office.tail1234.ts.net' };
    const p = view({ state: 'up', url: 'http://127.0.0.1:5199/', tailnetUrl: null, command: 'npm run dev' });
    expect(previewState(p, previewAddress(p, tailnet))).toMatchObject({ showApp: false, start: false, line: "The app runs on the office's computer but isn't on the tailnet, so it can't show here." });
  });
});

describe('device frames', () => {
  it('frames a phone at 375 by 812 and a tablet at 768 by 1024', () => {
    expect(DEVICE_FRAMES.phone.size).toEqual({ width: 375, height: 812 });
    expect(DEVICE_FRAMES.tablet.size).toEqual({ width: 768, height: 1024 });
    expect(DEVICE_FRAMES.full.size).toBeNull();
  });

  it('shrinks a frame to fit, never grows it, and says so', () => {
    expect(fitScale({ width: 1000, height: 900 }, { width: 375, height: 812 })).toBe(1);
    expect(fitScale({ width: 700, height: 512 }, { width: 768, height: 1024 })).toBe(0.5);
    expect(fitScale({ width: 0, height: 0 }, { width: 375, height: 812 })).toBe(1);
    expect(frameWords({ width: 375, height: 812 }, 1)).toBe('375 by 812');
    expect(frameWords({ width: 768, height: 1024 }, 0.5)).toBe('768 by 1024, shown at 50%');
  });
});

describe('screenshots', () => {
  const shots = [
    { id: 's-1', person: 'frontend-engineer', caption: 'The slot picker.', at: at(14, 10) },
    { id: 's-2', person: 'ui-designer', caption: 'Darker palette.', at: at(14, 25) },
    { id: 's-3', person: 'seo-specialist', caption: 'Search result.', at: at(9, 0, 4) },
  ];

  it('lists them newest first, with who shared each and when', () => {
    expect(shotsNewestFirst(shots).map((s) => s.id)).toEqual(['s-2', 's-1', 's-3']);
    expect(shotWho(shots[0] ?? shots[1]!, PEOPLE, NOW)).toBe(`Kai, ${hourMinute(at(14, 10))}`);
    expect(shotWho(shots[2]!, PEOPLE, NOW)).toBe(`SEO specialist, yesterday at ${hourMinute(at(9, 0, 4))}`);
    expect(shotWho({ person: 'ui-designer', at: at(9, 0, 2) }, PEOPLE, NOW)).toBe(`Mina, Mon 2 Nov at ${hourMinute(at(9, 0, 2))}`);
  });

  it('counts them on the phone’s button and says when there are none', () => {
    expect([shotsButton(4), shotsButton(0)]).toEqual(['Screenshots (4)', 'Screenshots']);
    expect(NO_SHOTS).toBe('No screenshots yet. People share one when they want you to see something.');
  });

  it('puts the live app on the office’s screen only on camera, else the latest screenshot', () => {
    const upView = view({ state: 'up', url: 'http://127.0.0.1:5199/', command: 'npm run dev' });
    const address = appAddress(upView.url, OFFICE);
    expect(screenShows(upView, address, true, shots)).toEqual({ kind: 'app', href: 'http://127.0.0.1:5199/' });
    expect(screenShows(upView, address, false, shots)).toMatchObject({ kind: 'shot', shot: { id: 's-2' } });
    expect(screenShows(view({ command: 'npm run dev' }), null, true, shots)).toMatchObject({ kind: 'shot', shot: { id: 's-2' } });
    expect(screenShows(view({ command: 'npm run dev' }), null, true, [])).toEqual({ kind: 'idle', line: "The app isn't running." });
    expect(screenShows(view({ state: 'starting' }), null, true, [])).toEqual({ kind: 'idle', line: 'Starting the app…' });
  });
});
