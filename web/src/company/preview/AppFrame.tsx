// The project's app in a frame: its own origin (the preview proxy's port), sandboxed so it runs its scripts but can
// never reach or navigate the office's page (PREVIEW_SANDBOX says which flags and why), with no referrer and no
// powerful features. The full preview and the office's screen both draw it through here.
import { type Ref, useSyncExternalStore } from 'react';
import { PREVIEW_SANDBOX } from './previewModel.ts';

interface AppFrameProps {
  href: string;
  /** The frame's accessible name: "Café Lumen's app". */
  title: string;
  /** The office's screen: no pointer, no focus, nothing for a screen reader; the button over it opens the preview. */
  still?: boolean;
  onLoad?: () => void;
  ref?: Ref<HTMLIFrameElement>;
}

export function AppFrame({ href, title, still = false, onLoad, ref }: AppFrameProps) {
  return (
    <iframe
      ref={ref}
      className="app-frame"
      src={href}
      title={title}
      sandbox={PREVIEW_SANDBOX}
      referrerPolicy="no-referrer"
      onLoad={onLoad}
      {...(still ? { inert: true, tabIndex: -1, 'aria-hidden': true } : {})}
    />
  );
}

// The hub names the preview proxies in its page's frame-src when it serves the page, so an app started after the page
// loaded is refused until the page reloads. The browser reports the refusal as the frame is inserted, before any effect
// of the component that drew it runs, so one listener for the page notes every origin it refused.
const refused = new Set<string>();
const listeners = new Set<() => void>();

document.addEventListener('securitypolicyviolation', (event) => {
  const directive = event.effectiveDirective || event.violatedDirective;
  if (!/^(frame-src|child-src|default-src)\b/.test(directive)) return;
  let origin: string;
  try {
    origin = new URL(event.blockedURI).origin;
  } catch {
    // "inline", "eval" and the like name no address: not a frame this file drew.
    return;
  }
  if (refused.has(origin)) return;
  refused.add(origin);
  for (const listener of listeners) listener();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True once the office's page has refused to frame this origin. */
export function useFrameBlocked(origin: string | null): boolean {
  return useSyncExternalStore(subscribe, () => origin !== null && refused.has(origin));
}
