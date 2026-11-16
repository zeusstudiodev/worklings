// Full screen through the Fullscreen API, for the company bar's Full screen and the preview's, without the browser: the
// functions take the document and the element, so tests drive them without a DOM. fullscreen.ts binds them to the page.
// A browser grants full screen only to the press that asks for it, so the request is made before anything is awaited;
// when the browser refuses or has no element full screen (iPhone Safari shows only its videos full screen), the caller
// says so or falls back where it can.

/** The part of `document` full screen uses. */
export interface FullscreenDocument {
  readonly fullscreenEnabled?: boolean;
  readonly fullscreenElement?: object | null;
  exitFullscreen?: () => Promise<void>;
}

/** The part of an element full screen uses. */
export interface FullscreenTarget {
  requestFullscreen?: () => Promise<void>;
}

export type FullscreenResult = 'entered' | 'left' | 'refused' | 'unsupported';

/** True when this browser can show an element full screen. */
export const canFullscreen = (doc: FullscreenDocument, el: FullscreenTarget): boolean => doc.fullscreenEnabled === true && typeof el.requestFullscreen === 'function';

/** Shows `el` full screen. The request goes out before this returns, inside the press that asked for it. */
export function enterFullscreen(doc: FullscreenDocument, el: FullscreenTarget): Promise<FullscreenResult> {
  const request = el.requestFullscreen;
  if (doc.fullscreenEnabled !== true || typeof request !== 'function') return Promise.resolve('unsupported');
  return request.call(el).then(
    (): FullscreenResult => 'entered',
    (): FullscreenResult => 'refused',
  );
}

/** Leaves full screen. Already left (the browser's own Escape got there first) counts as left. */
export function leaveFullscreen(doc: FullscreenDocument): Promise<FullscreenResult> {
  const exit = doc.exitFullscreen;
  if (!doc.fullscreenElement || typeof exit !== 'function') return Promise.resolve('left');
  return exit.call(doc).then(
    (): FullscreenResult => 'left',
    (): FullscreenResult => 'left',
  );
}

/** Full screen for `el`, or out of it when anything is full screen: the bar's switch. */
export const toggleFullscreen = (doc: FullscreenDocument, el: FullscreenTarget): Promise<FullscreenResult> => (doc.fullscreenElement ? leaveFullscreen(doc) : enterFullscreen(doc, el));

/** What the office says when full screen didn't happen; null when it did, or was left. */
export function fullscreenProblem(result: FullscreenResult): string | null {
  if (result === 'refused') return "The browser didn't allow full screen.";
  if (result === 'unsupported') return "This browser can't show the office full screen.";
  return null;
}
