// The preview (docs/design-v3.md, "Preview"): the project's app in the wide view on desktops and full screen on phones,
// under a bar with the path (Enter goes), Reload, Phone, Tablet and Full width, Open in a new tab and Full screen
// (Close and Back are the wide view's), and the screenshots people shared beside it, newest first, each enlarging in
// place until Escape or Back. The app runs at its own origin in a sandboxed frame (AppFrame); what the dev server
// isn't doing yet is said in the states table's words.
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { Screenshot } from '../../../../src/core/company.ts';
import { enterFullscreen, leaveFullscreen } from '../../lib/fullscreen.ts';
import { useMediaQuery } from '../../lib/hooks.ts';
import { reconnectingLine } from '../model.ts';
import { useCompanyClock } from '../people/clock.ts';
import type { TabProps } from '../types.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { AppFrame, useFrameBlocked } from './AppFrame.tsx';
import {
  DEVICE_FRAMES,
  type Device,
  DEVICES,
  fitScale,
  frameWords,
  fullScreenWay,
  NO_SHOTS,
  pathHref,
  previewAddress,
  previewState,
  shotsButton,
  shotsNewestFirst,
  shotWho,
} from './previewModel.ts';
import './preview.css';

/** Room under a device frame for its words ("375 by 812, shown at 82%"). */
const CAPTION_SPACE = 28;

type FullScreen = 'native' | 'fill' | null;

export function Preview({ snapshot, company, actions, online, announce }: TabProps) {
  const phone = useMediaQuery('(max-width: 720px)');
  const now = useCompanyClock(snapshot.serverTime, online);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const [device, setDevice] = useState<Device>('full');
  const [target, setTarget] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [pathProblem, setPathProblem] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const [full, setFull] = useState<FullScreen>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [startProblem, setStartProblem] = useState<string | null>(null);

  const preview = company.preview;
  const address = previewAddress(preview, window.location);
  const origin = address?.ok ? address.origin : null;
  const blocked = useFrameBlocked(origin);
  const state = previewState(preview, address);
  const path = target ?? (address?.ok ? address.path : '/');
  const href = origin ? `${origin}${path}` : null;
  const showApp = state.showApp && href !== null && !blocked;
  const shots = shotsNewestFirst(company.screenshots);
  const shot = enlarged ? shots.find((s) => s.id === enlarged) : undefined;
  const size = DEVICE_FRAMES[phone ? 'full' : device].size;
  const scale = size ? fitScale({ width: space.width, height: space.height - CAPTION_SPACE }, size) : 1;
  const frameTitle = `${company.name}'s app`;
  const frameId = `${href ?? ''}#${frameKey}`;

  // The stage's size, for fitting a phone or tablet frame into it.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSpace({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Native full screen ends by Exit full screen or by the browser's own Escape: either way, follow it and put focus
  // back on Full screen when it was left inside the frame or nowhere. The office itself may stay full screen (the bar's
  // Full screen), so what counts is whether the stage still is.
  useEffect(() => {
    const onChange = () => {
      if (stage.current !== null && document.fullscreenElement === stage.current) return;
      setFull((f) => (f === 'native' ? null : f));
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && !stage.current?.contains(active)) return;
        root.current?.querySelector<HTMLElement>('[data-focus="preview:full"]')?.focus();
      });
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const focusIn = (selector: string) => window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());

  const go = (event: FormEvent) => {
    event.preventDefault();
    if (!origin) return;
    const next = pathHref(typed ?? path, origin);
    if (!next.ok) {
      setPathProblem(next.problem);
      return;
    }
    setPathProblem(null);
    setTyped(null);
    setTarget(next.path);
    setLoaded(null);
    setFrameKey((k) => k + 1);
  };

  const reload = () => {
    if (!showApp) return;
    setLoaded(null);
    setFrameKey((k) => k + 1);
  };

  const start = () => {
    if (!online || pressing) return;
    setPressing(true);
    setStartProblem(null);
    actions.preview('start').then(
      () => setPressing(false),
      (error: unknown) => {
        const line = `Couldn't start the app. ${error instanceof Error ? error.message : ''}`.trim();
        setPressing(false);
        setStartProblem(line);
        announce(line);
      },
    );
  };

  const enterFull = () => {
    const el = stage.current;
    if (!el || !showApp) return;
    // Asked for inside the press. Refused (a browser setting, a page in a frame without permission) or not there
    // (iPhones): the stage fills the window instead, with the same Exit full screen.
    void enterFullscreen(document, el).then((result) => {
      setFull(fullScreenWay(result));
      focusIn('.preview__exit');
    });
  };

  const exitFull = () => {
    if (full === 'native' && document.fullscreenElement === stage.current) {
      // The fullscreenchange listener takes it from here once the browser has left full screen.
      void leaveFullscreen(document);
      return;
    }
    setFull(null);
    focusIn('[data-focus="preview:full"]');
  };

  const enlarge = (s: Screenshot) => {
    focusNext.current = '.preview-large__back';
    setEnlarged(s.id);
  };

  const shrink = () => {
    if (enlarged) focusNext.current = `[data-focus="preview:shot:${CSS.escape(enlarged)}"]`;
    setEnlarged(null);
  };

  // A screenshot enlarging or going back moves focus once the view that holds it is drawn.
  useEffect(() => {
    const selector = focusNext.current;
    if (!selector) return;
    focusNext.current = null;
    root.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [enlarged]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Escape returns from what opened inside the preview first; the wide view's own Escape then closes it.
    if (enlarged) {
      event.preventDefault();
      shrink();
    } else if (full === 'fill') {
      event.preventDefault();
      exitFull();
    }
  };

  const offline = !online ? reconnectingLine(snapshot.serverTime) : null;

  /** What the frame says while there is no app to show: the states table, or the page's refusal to frame it. */
  const stateBox = () => {
    if (blocked) {
      return (
        <div className="preview__state">
          <p className="preview__line">The office's page opened before the app started, so the browser won't show the app here yet. Reload the page to show it.</p>
          <div className="preview__actions">
            <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className={`preview__state${state.starting ? ' is-starting' : ''}`}>
        <p className="preview__line">
          {state.starting && <span className="preview__mark" aria-hidden="true" />}
          {state.line}
        </p>
        {state.start && (
          <div className="preview__actions">
            <button type="button" className="button button--primary" aria-disabled={!online || pressing || undefined} onClick={start}>
              {pressing ? 'Starting the app…' : 'Start the app'}
            </button>
          </div>
        )}
        {state.start && state.command && (
          <p className="preview__command">
            Runs <code>{state.command}</code> in the project folder.
          </p>
        )}
        {startProblem && <p className="preview__problem">{startProblem}</p>}
        {offline && state.start && <p className="preview__quiet">{offline}</p>}
      </div>
    );
  };

  /** The frame keeps its place and size in every state, so nothing jumps when the app comes up. */
  const frame = () => {
    const app = showApp && href && (
      <>
        <AppFrame key={frameId} href={href} title={frameTitle} onLoad={() => setLoaded(frameId)} />
        {loaded !== frameId && (
          <p className="preview__opening" aria-hidden="true">
            Opening the app…
          </p>
        )}
      </>
    );
    if (!size) return <div className="preview__full">{app || stateBox()}</div>;
    return (
      <div className="preview__device-wrap">
        <div className="preview__device" style={{ width: size.width * scale, height: size.height * scale }}>
          {app ? (
            <div className="preview__device-inner" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
              {app}
            </div>
          ) : (
            stateBox()
          )}
        </div>
        <p className="preview__frame-words">{frameWords(size, scale)}</p>
      </div>
    );
  };

  const shotList = (
    <section className="preview__shots" aria-labelledby={`${id}-shots`}>
      <h3 id={`${id}-shots`} className="preview__shots-title">
        Screenshots
      </h3>
      {shots.length === 0 ? (
        <p className="preview__quiet">{NO_SHOTS}</p>
      ) : (
        <ul className="preview__shot-list">
          {shots.map((s) => (
            <li key={s.id}>
              <button type="button" className={`preview-shot${enlarged === s.id ? ' is-open' : ''}`} data-focus={`preview:shot:${s.id}`} onClick={() => enlarge(s)}>
                <img className="preview-shot__img" src={actions.screenshotUrl(s.id)} alt="" loading="lazy" decoding="async" />
                <span className="preview-shot__who">{shotWho(s, company.people, now)}</span>
                <span className="preview-shot__caption">{s.caption}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const large = shot && (
    <figure className="preview-large" aria-labelledby={`${id}-large`}>
      <div className="preview-large__head">
        <button type="button" className="button preview-large__back" onClick={shrink}>
          {phone ? 'All screenshots' : 'Back to the app'}
        </button>
        <h3 id={`${id}-large`} className="preview-large__who">
          {shotWho(shot, company.people, now)}
        </h3>
      </div>
      <div className="preview-large__picture">
        <img className="preview-large__img" src={actions.screenshotUrl(shot.id)} alt="" />
      </div>
      <figcaption className="preview-large__caption">{shot.caption}</figcaption>
    </figure>
  );

  const unavailable = !showApp;
  return (
    <div ref={root} className={`preview${phone ? ' preview--phone' : ''}`} onKeyDown={onKeyDown}>
      <div className="preview__bar">
        <form className="preview__path" onSubmit={go}>
          <label className="visually-hidden" htmlFor={`${id}-path`}>
            Path in the app
          </label>
          <input
            id={`${id}-path`}
            className="preview__path-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={typed ?? path}
            disabled={unavailable}
            aria-describedby={pathProblem ? `${id}-path-problem` : undefined}
            onChange={(e) => {
              setTyped(e.target.value);
              setPathProblem(null);
            }}
          />
        </form>
        <button type="button" className="button preview__tool" aria-disabled={unavailable || undefined} onClick={reload}>
          Reload
        </button>
        {phone ? (
          <button type="button" className="button preview__tool" aria-pressed={listing} onClick={() => setListing((l) => !l)}>
            {shotsButton(shots.length)}
          </button>
        ) : (
          <>
            <Segmented label="Frame the app as" options={DEVICES.map((d) => ({ value: d, label: DEVICE_FRAMES[d].label }))} value={device} onChange={setDevice} />
            {showApp && href ? (
              <a className="button preview__tool" href={href} target="_blank" rel="noopener noreferrer">
                Open in a new tab
              </a>
            ) : (
              <button type="button" className="button preview__tool" aria-disabled="true">
                Open in a new tab
              </button>
            )}
            <button type="button" className="button preview__tool" aria-disabled={unavailable || undefined} data-focus="preview:full" onClick={enterFull}>
              Full screen
            </button>
          </>
        )}
      </div>
      {pathProblem && (
        <p id={`${id}-path-problem`} className="preview__problem">
          {pathProblem}
        </p>
      )}
      {offline && <p className="preview__quiet preview__offline">{offline}</p>}
      <div className="preview__main">
        <div ref={stage} className={`preview__stage${full === 'fill' ? ' is-filling' : ''}${size ? ' has-device' : ''}`} hidden={Boolean(large) || (phone && listing)}>
          {frame()}
          {full && (
            <button type="button" className="button preview__exit" onClick={exitFull}>
              Exit full screen
            </button>
          )}
        </div>
        {large}
        {phone ? listing && !large && shotList : shotList}
      </div>
    </div>
  );
}
