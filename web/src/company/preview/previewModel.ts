// The preview's words and checks (docs/design-v3.md, "Preview"): what each state of the project's dev server says, the
// app's address checked before anything frames it, where a path typed in the bar goes, the device frames, and the
// screenshots people shared. Pure, with no DOM, so the tests read what the preview shows.
import type { PersonView, PreviewView, Screenshot } from '../../../../src/core/company.ts';
import { titleFromId } from '../../../../src/core/studio.ts';
import { hourMinute } from '../../lib/format.ts';
import type { FullscreenResult } from '../../lib/fullscreenCore.ts';
import { dayLabel, daysAgo } from '../dashboards/boardsModel.ts';

/**
 * The sandbox every frame of the app gets. The app runs its own scripts (`allow-scripts`) at its own origin
 * (`allow-same-origin`: the proxy's port, never the office's, so it can't read the office's page, storage or token, and
 * Vite's module scripts and hot reload keep working), submits its own forms (`allow-forms`) and opens links in new tabs
 * (`allow-popups`; those tabs keep this same sandbox). Left out on purpose: top navigation in both forms (it can never
 * take the office's tab elsewhere), modals (an alert would block the whole office), downloads, pointer and orientation
 * lock, presentation, and escaping the sandbox from a popup.
 */
export const PREVIEW_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

export type Device = 'phone' | 'tablet' | 'full';
export const DEVICES: readonly Device[] = ['phone', 'tablet', 'full'];

/** The device frames: a phone is 375 by 812 (the design), a tablet 768 by 1024; full width takes what there is. */
export const DEVICE_FRAMES: Record<Device, { label: string; size: { width: number; height: number } | null }> = {
  phone: { label: 'Phone', size: { width: 375, height: 812 } },
  tablet: { label: 'Tablet', size: { width: 768, height: 1024 } },
  full: { label: 'Full width', size: null },
};

/** The app's address, checked: http or https, and never the office's own origin, which a sandboxed frame could reach. */
export type AppAddress = { ok: true; origin: string; path: string } | { ok: false; problem: string };

export function appAddress(url: string | null, officeOrigin: string): AppAddress | null {
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problem: "The office got an address for the app it can't read, so it doesn't show it." };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, problem: "The app's address isn't a web address, so the office doesn't show it." };
  if (parsed.origin === officeOrigin) return { ok: false, problem: "The app's address is the office's own, so the office doesn't show it here." };
  return { ok: true, origin: parsed.origin, path: `${parsed.pathname}${parsed.search}${parsed.hash}` || '/' };
}

/** The office opened on the tailnet: its host is the machine's ts.net name. */
export const onTailnet = (hostname: string): boolean => /\.ts\.net\.?$/i.test(hostname);

/**
 * The app's address for where the office was opened: the proxy's own origin on this machine, or on the tailnet
 * (a phone over Tailscale) the same app on its own https port of the ts.net name. Either is checked like appAddress.
 */
export function previewAddress(p: Pick<PreviewView, 'url' | 'tailnetUrl'>, office: { hostname: string; origin: string }): AppAddress | null {
  if (!onTailnet(office.hostname)) return appAddress(p.url, office.origin);
  if (p.tailnetUrl) return appAddress(p.tailnetUrl, office.origin);
  return p.url === null ? null : { ok: false, problem: "The app runs on the office's computer but isn't on the tailnet, so it can't show here." };
}

/**
 * Where a path typed in the bar goes: always inside the app. "menu" and "//menu" become "/menu"; a full address on
 * the app's own origin keeps its path; any other site is turned down with the reason.
 */
export function pathHref(input: string, origin: string): { ok: true; path: string; href: string } | { ok: false; problem: string } {
  const text = input.trim();
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return { ok: false, problem: 'That isn’t an address. Type a path in the app, like /menu.' };
    }
    if (parsed.origin !== origin) return { ok: false, problem: 'Only pages of the app open here. Type a path in it, like /menu.' };
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } else {
    path = `/${text.replace(/^[/\\]+/, '')}`;
  }
  const href = new URL(path, origin);
  if (href.origin !== origin) return { ok: false, problem: 'Only pages of the app open here. Type a path in it, like /menu.' };
  return { ok: true, path: `${href.pathname}${href.search}${href.hash}`, href: href.href };
}

export interface PreviewState {
  /** What the frame says instead of the app; null while the app shows. */
  line: string | null;
  showApp: boolean;
  starting: boolean;
  /** "Start the app", with the command shown under it. */
  start: boolean;
  command: string | null;
  /** Reload the frame: only while there is an app to reload. */
  reload: boolean;
}

/** The design's states table: off with or without a command, starting, up, and down with its problem. */
export function previewState(p: PreviewView, address: AppAddress | null): PreviewState {
  const base = { showApp: false, starting: false, start: false, command: p.command, reload: false };
  switch (p.state) {
    case 'up':
      if (address?.ok) return { ...base, line: null, showApp: true, reload: true };
      // It is running: starting it again would change nothing, so the line alone says why it doesn't show.
      return { ...base, line: address?.problem ?? "The app is running, but the office didn't get its address." };
    case 'starting':
      return { ...base, line: 'Starting the app…', starting: true };
    case 'down':
      return { ...base, line: `The app didn't answer. ${p.problem ?? ''}`.trim(), start: p.command !== null };
    default:
      return p.command !== null
        ? { ...base, line: "The app isn't running.", start: true }
        : { ...base, line: 'This project has no app to preview. Screenshots people share still show here.' };
  }
}

/** How much a device frame shrinks to fit the space it has: never more than its own size, never under a tenth. */
export function fitScale(space: { width: number; height: number }, size: { width: number; height: number }): number {
  if (space.width <= 0 || space.height <= 0) return 1;
  return Math.max(0.1, Math.min(1, space.width / size.width, space.height / size.height));
}

/** How the stage goes full screen: the browser's own, or filling the window where the browser refused or has none (iPhones). */
export const fullScreenWay = (result: FullscreenResult): 'native' | 'fill' => (result === 'entered' ? 'native' : 'fill');

/** Under a device frame: "375 by 812", and "shown at 82%" when it had to shrink. */
export function frameWords(size: { width: number; height: number }, scale: number): string {
  const shown = scale < 0.995 ? `, shown at ${Math.round(scale * 100)}%` : '';
  return `${size.width} by ${size.height}${shown}`;
}

/** Screenshots newest first. */
export const shotsNewestFirst = (shots: readonly Screenshot[]): Screenshot[] => [...shots].sort((a, b) => b.at - a.at);

/** Who shared a screenshot and when: "Kai, 14:20", "Kai, yesterday at 14:20", "Kai, Mon 3 Nov at 14:20". */
export function shotWho(shot: Pick<Screenshot, 'person' | 'at'>, people: readonly PersonView[], now: number): string {
  const p = people.find((x) => x.id === shot.person);
  const name = p ? p.name : titleFromId(shot.person);
  const days = daysAgo(shot.at, now);
  const when = days === 0 ? hourMinute(shot.at) : `${days === 1 ? 'yesterday' : dayLabel(shot.at, now)} at ${hourMinute(shot.at)}`;
  return `${name}, ${when}`;
}

/** "Screenshots (4)", the phones' toggle. */
export const shotsButton = (n: number): string => (n > 0 ? `Screenshots (${n})` : 'Screenshots');

export const NO_SHOTS = 'No screenshots yet. People share one when they want you to see something.';

/** What the office's screen shows: the live app on camera on a desktop, else the latest screenshot, else a still line. */
export type ScreenShows = { kind: 'app'; href: string } | { kind: 'shot'; shot: Screenshot } | { kind: 'idle'; line: string };

export function screenShows(p: PreviewView, address: AppAddress | null, live: boolean, shots: readonly Screenshot[]): ScreenShows {
  if (live && p.state === 'up' && address?.ok) return { kind: 'app', href: `${address.origin}${address.path}` };
  const latest = shotsNewestFirst(shots)[0];
  if (latest) return { kind: 'shot', shot: latest };
  if (p.state === 'up') return { kind: 'idle', line: 'The app is running.' };
  if (p.state === 'starting') return { kind: 'idle', line: 'Starting the app…' };
  return { kind: 'idle', line: p.command !== null ? "The app isn't running." : 'No app to preview yet.' };
}
