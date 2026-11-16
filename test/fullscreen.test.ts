// Full screen (web/src/lib/fullscreenCore.ts) against a fake document and element: the request goes out inside the press,
// what the bar says when the browser refuses or has none, and how the preview falls back to filling the window.
import { describe, expect, it } from 'vitest';
import { fullScreenWay } from '../web/src/company/preview/previewModel.ts';
import { canFullscreen, enterFullscreen, type FullscreenDocument, fullscreenProblem, leaveFullscreen, toggleFullscreen } from '../web/src/lib/fullscreenCore.ts';

/** A browser's document and an element, as the Fullscreen API has them; `answer` is what the browser does with a request. */
function browser(answer: 'grant' | 'refuse' | 'none', enabled = true) {
  const calls: string[] = [];
  const doc: FullscreenDocument & { fullscreenElement: object | null } = {
    fullscreenEnabled: enabled,
    fullscreenElement: null,
    exitFullscreen() {
      calls.push('exit');
      doc.fullscreenElement = null;
      return Promise.resolve();
    },
  };
  const el =
    answer === 'none'
      ? {}
      : {
          requestFullscreen() {
            calls.push('request');
            if (answer === 'refuse') return Promise.reject(new TypeError('Permissions check failed'));
            doc.fullscreenElement = this;
            return Promise.resolve();
          },
        };
  return { doc: doc as FullscreenDocument, el, calls, state: doc };
}

describe('full screen', () => {
  it('asks the browser before anything is awaited, so the press still counts as the gesture', async () => {
    const { doc, el, calls } = browser('grant');
    const pending = enterFullscreen(doc, el);
    // Nothing has been awaited yet, and the request is already out.
    expect(calls).toEqual(['request']);
    await expect(pending).resolves.toBe('entered');
  });

  it('says a refusal plainly, and offers nothing where the browser has no element full screen', async () => {
    const refused = browser('refuse');
    await expect(enterFullscreen(refused.doc, refused.el)).resolves.toBe('refused');
    expect(fullscreenProblem('refused')).toBe("The browser didn't allow full screen.");
    // iPhone Safari: no requestFullscreen on elements, and fullscreenEnabled isn't true.
    const iphone = browser('none', false);
    expect(canFullscreen(iphone.doc, iphone.el)).toBe(false);
    await expect(enterFullscreen(iphone.doc, iphone.el)).resolves.toBe('unsupported');
    expect(iphone.calls).toEqual([]);
    expect(fullscreenProblem('unsupported')).toBe("This browser can't show the office full screen.");
    // A browser that has the method but turned the feature off (a setting, a frame without permission) counts as none.
    const off = browser('grant', false);
    expect(canFullscreen(off.doc, off.el)).toBe(false);
    await expect(enterFullscreen(off.doc, off.el)).resolves.toBe('unsupported');
    expect(off.calls).toEqual([]);
    expect(fullscreenProblem('entered')).toBeNull();
    expect(fullscreenProblem('left')).toBeNull();
  });

  it("switches: in when nothing is full screen, out when something is, and out counts even if the browser's Escape got there first", async () => {
    const b = browser('grant');
    await expect(toggleFullscreen(b.doc, b.el)).resolves.toBe('entered');
    expect(b.state.fullscreenElement).toBe(b.el);
    await expect(toggleFullscreen(b.doc, b.el)).resolves.toBe('left');
    expect(b.calls).toEqual(['request', 'exit']);
    expect(b.state.fullscreenElement).toBeNull();
    const late: FullscreenDocument = { fullscreenEnabled: true, fullscreenElement: {}, exitFullscreen: () => Promise.reject(new TypeError('Document not active')) };
    await expect(leaveFullscreen(late)).resolves.toBe('left');
    await expect(leaveFullscreen({ fullscreenEnabled: true, fullscreenElement: null })).resolves.toBe('left');
  });

  it("lets the preview fill the window where the browser's own full screen didn't happen", () => {
    expect(fullScreenWay('entered')).toBe('native');
    expect(fullScreenWay('refused')).toBe('fill');
    expect(fullScreenWay('unsupported')).toBe('fill');
  });
});
