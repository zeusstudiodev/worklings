// A board over the map (docs/design-v3.md, "Boards over the map"; docs/design-hud.md, "Boards over the map"): the cutting
// mat seen from above, filling the main view under the bar and running on under the side panel to the window's edge;
// its head with the board's title, a sentence about it, its sub-views as links, its filters, its own keys and "Back to
// the office"; the row under the head saying what the last press did, with Undo; and the board's body. Every board
// renders it as its root; the shell renders it alone, with its title, while a board's code loads or when it failed.
//
// The head folds by its own measured room, as the company bar does: each piece is measured in each form it has shown
// (again when its content changes) and the step is worked out from those widths, again when the head resizes
// (frameModel.ts), never by folding and measuring in a loop. A board's own keys read the step with useBoardHead().
import { createContext, type CSSProperties, type MouseEvent, type ReactNode, type RefObject, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { navigate } from '../router.ts';
import { Count } from '../ui/Count.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';
import { type BoardHost, type BoardResult, useBoardHost } from './boardHost.ts';
import { type ActionsForm, dockClear, foldAt, type HeadFold, type HeadWidths, headStep, type MiniVariant, miniVariant } from './frameModel.ts';
import { Icon } from './Icon.tsx';
import './frame.css';

/** A sub-view of the board: a link to its address, the current one marked. */
export interface BoardViewLink {
  /** "Board", "Plan". */
  label: string;
  /** Its address (companyHref from router.ts), so it opens in a new tab too. */
  href: string;
  current: boolean;
  /** A count beside the word while something there needs you ("Plan" while the plan waits); 0 shows none. */
  count?: number;
  /** What the count means, for its name: "Plan, waits for your approval". Default: the label and the figure. */
  countLabel?: string;
}

export interface BoardFrameProps {
  /** The board's title, its `h2`: "Tasks", "Org chart", "Dashboards". It names the board's region and takes focus when it opens. */
  title: string;
  /** A sentence about the board ("51 tasks: 24 done, eight working, three wait for you."): the first to go when the head runs short. */
  summary?: string;
  /** The board's sub-views, as links. */
  views?: readonly BoardViewLink[];
  /** The sub-views' nav name. Default: "{title} views". */
  viewsLabel?: string;
  /**
   * The filters, as chips in a row: in the head while it has room, else behind one Filter key in a popover (the same
   * elements, so their state and focus stay). Anything that must be said while folded (a "12 of 51 tasks" status) is
   * better kept outside them.
   */
  filters?: ReactNode;
  /** How many filters are on: the folded Filter key says so ("Filter, 2 on"). */
  filtersOn?: number;
  /** The board's own keys before "Back to the office": Add a task, Hire someone, the zoom tile. useBoardHead() says their form. */
  actions?: ReactNode;
  /** A line in the result row's place while something is under way (a lifted card's steps); the board keeps it live. */
  status?: ReactNode;
  /** While the board's code loads: "Opening the task board…". The body shows blank paper in the shapes to come. */
  loading?: string;
  /** The shapes the loading paper takes. */
  shape?: 'columns' | 'chart' | 'cards';
  /** The board couldn't load or draw: its fallback sentence. The frame adds "This view couldn't load. Reload the page to try again." */
  error?: string;
  /** What the way back says when it isn't the office: a task's changes say "Back to the task". Default: "Back to the office". */
  backLabel?: string;
  /** The board's body: it fills the rest of the main view, down to the window's foot; scrollers in it keep `--dock-clear` free. */
  children?: ReactNode;
}

const HeadContext = createContext<HeadFold>(foldAt(0));

/** What the head shows now, for a board's own pieces: glyph keys at `glyphs`, a narrow search field at `narrowSearch`. */
export const useBoardHead = (): HeadFold => useContext(HeadContext);

/** How long the row under the head says what a press did. */
const RESULT_MS = 10_000;
/** A frame that takes over from the loading one doesn't rise again. */
const TAKE_OVER_MS = 600;
let lastOpened = Number.NEGATIVE_INFINITY;

export function BoardFrame({ title, summary, views, viewsLabel, filters, filtersOn = 0, actions, status, backLabel, loading, shape = 'cards', error, children }: BoardFrameProps) {
  const host = useBoardHost();
  const titleId = useId();
  const filtersId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const mini = useMiniPlace(rootRef);
  const hasFilters = filters !== undefined && filters !== null;
  const hasActions = actions !== undefined && actions !== null;
  const { fold, headRef, titleRef, summaryRef, viewsRef, filtersRef, filterKeyRef, actionsRef, backRef } = useHeadFold({
    summary: Boolean(summary),
    views: Boolean(views?.length),
    filters: hasFilters,
    actions: hasActions,
  });
  // Rising into place, unless it takes over from the loading frame a moment ago (the same board, now drawn).
  const [rises] = useState(() => performance.now() - lastOpened > TAKE_OVER_MS);
  useEffect(() => {
    lastOpened = performance.now();
  }, []);
  // Focus that was on nothing (the loading frame's title went with it) comes to the title; the shell puts it there when
  // a board opens.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) titleRef.current?.focus({ preventScroll: true });
  }, [titleRef]);

  const clear = dockClear(mini.variant, mini.inMain);
  const style = { '--dock-clear': clear.clear, '--dock-strip': clear.strip, '--dock-over': clear.over, '--mini-w': clear.miniWidth, '--mini-h': clear.miniHeight, '--mini-bottom': clear.miniBottom } as CSSProperties;
  const covered = host?.feedOpen === true;

  return (
    <section ref={rootRef} className={`bf${rises ? ' bf--rises' : ''}`} aria-labelledby={titleId} aria-busy={loading ? true : undefined} style={style}>
      <div className="bf__mat" aria-hidden="true" />
      <div className="bf__ruler" aria-hidden="true" />
      <div className="bf__scroll">
      <HeadContext.Provider value={fold}>
        <header ref={headRef} className="bf__head" data-step={fold.step}>
          <h2 ref={titleRef} id={titleId} className="bf__title" tabIndex={-1} data-board-title>
            {title}
          </h2>
          {summary && fold.summary && <p className="bf__sum">{summary}</p>}
          {summary && (
            <span ref={summaryRef} className="bf__sum bf__twin" aria-hidden="true">
              {summary}
            </span>
          )}
          <div className="bf__rest">
            {views && views.length > 0 && (
              <nav ref={viewsRef} className="bf__views" aria-label={viewsLabel ?? `${title} views`}>
                {views.map((v) => (
                  <ViewLink key={v.href} view={v} />
                ))}
              </nav>
            )}
            {hasFilters && (
              <>
                {fold.filtersFolded && <FilterKey target={filtersId} on={filtersOn} />}
                <span ref={filterKeyRef} className="bf__twin" aria-hidden="true">
                  <FilterKey target={null} on={filtersOn} />
                </span>
                <FilterBox id={filtersId} folded={fold.filtersFolded} boxRef={filtersRef}>
                  {filters}
                </FilterBox>
              </>
            )}
            {hasActions && (
              <div ref={actionsRef} className="bf__actions">
                {actions}
              </div>
            )}
          </div>
          {host && (
            <button ref={backRef} type="button" className="bf__back" onClick={host.close}>
              <Icon name={backLabel ? 'left' : 'office'} />
              {backLabel ?? 'Back to the office'}
            </button>
          )}
        </header>
      </HeadContext.Provider>
      {status ? (
        <div className="bf__row">{status}</div>
      ) : (
        host?.result && <ResultRow key={host.result.key} host={host} result={host.result} titleRef={titleRef} />
      )}
      <div className="bf__body" inert={covered || undefined}>
        {error !== undefined ? (
          <div className="bf__error">
            <div className="bf__callout">
              <p className="bf__callout-line">{error}</p>
              <p className="bf__callout-line">This view couldn&apos;t load. Reload the page to try again.</p>
            </div>
          </div>
        ) : loading !== undefined ? (
          <div className="bf__loading" data-shape={shape}>
            <p className="bf__loading-line">{loading}</p>
            <div className="bf__shapes" aria-hidden="true">
              {Array.from({ length: shape === 'columns' ? 5 : shape === 'chart' ? 7 : 6 }, (_, i) => (
                <span key={i} className="bf__shape" />
              ))}
            </div>
          </div>
        ) : (
          children
        )}
      </div>
      </div>
    </section>
  );
}

/** A sub-view's link: the app's own navigation for a plain press, the browser's for a new tab. */
function ViewLink({ view }: { view: BoardViewLink }) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!view.current) navigate(view.href);
  };
  const count = view.count ?? 0;
  return (
    <a className="bf__view" href={view.href} aria-current={view.current ? 'page' : undefined} onClick={open}>
      {view.label}
      {count > 0 && <Count n={count} label={view.countLabel ? `, ${view.countLabel}` : `, ${count}`} />}
    </a>
  );
}

/** The Filter key the filters fold into; `target` null for the measuring copy, which opens nothing. */
function FilterKey({ target, on }: { target: string | null; on: number }) {
  return (
    <button
      type="button"
      className="bf__key bf__filter-key"
      {...(target ? { popoverTarget: target } : { tabIndex: -1 })}
      aria-label={on > 0 ? `Filter, ${on} on` : undefined}
    >
      <Icon name="filter" />
      Filter
      {on > 0 && (
        <span className="bf__on" aria-hidden="true">
          {on}
        </span>
      )}
    </button>
  );
}

/**
 * The filters' one element: a row in the head, or a popover under the Filter key once folded. Keeping the element and
 * only turning the popover on keeps the board's chips mounted, with their state.
 */
function FilterBox({ id, folded, boxRef, children }: { id: string; folded: boolean; boxRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !folded) return;
    // Placed under its key when it opens, kept inside the window; anchor positioning would do it, where it exists.
    const place = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const key = document.querySelector<HTMLElement>(`[popovertarget="${CSS.escape(id)}"]`);
      if (!key) return;
      const at = key.getBoundingClientRect();
      const width = el.offsetWidth;
      el.style.top = `${Math.round(at.bottom + 8)}px`;
      el.style.left = `${Math.round(Math.max(8, Math.min(at.left, window.innerWidth - width - 8)))}px`;
    };
    el.addEventListener('toggle', place);
    return () => el.removeEventListener('toggle', place);
  }, [folded, id, boxRef]);
  return (
    <div
      ref={boxRef}
      id={id}
      className={folded ? 'bf__filters bf__filters--pop' : 'bf__filters'}
      popover={folded ? 'auto' : undefined}
    >
      {children}
    </div>
  );
}

/** The row under the head: what a press did, for 10 s, with its Undo; a refused Undo says why there, with focus on it. */
function ResultRow({ host, result, titleRef }: { host: BoardHost; result: BoardResult; titleRef: RefObject<HTMLElement | null> }) {
  const [until, setUntil] = useState(() => Date.now() + RESULT_MS);
  const [refused, setRefused] = useState<string | null>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const { dismiss } = host;
  useEffect(() => {
    const id = window.setTimeout(dismiss, Math.max(0, until - Date.now()));
    return () => window.clearTimeout(id);
  }, [until, dismiss]);
  useEffect(() => {
    if (refused !== null) lineRef.current?.focus({ preventScroll: true });
  }, [refused]);
  const undo = result.undo;
  const press = () => {
    if (!undo) return;
    undo().then(
      () => {
        dismiss();
        // The board puts focus where the change took it; if nothing did, the title has it rather than the page.
        queueMicrotask(() => {
          const active = document.activeElement;
          if (active === null || active === document.body) titleRef.current?.focus({ preventScroll: true });
        });
      },
      (error: unknown) => {
        setRefused(error instanceof Error && error.message ? error.message : "Couldn't undo it. Try again.");
        setUntil(Date.now() + RESULT_MS);
      },
    );
  };
  return (
    <div className="bf__row">
      {refused !== null ? (
        <p ref={lineRef} className="undo-line bf__refused" tabIndex={-1}>
          <span className="undo-line__text">{refused}</span>
        </p>
      ) : (
        <UndoLine text={result.text} onUndo={press} until={undo ? until : null} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Measuring

/**
 * The mini-map's form for the frame's own width (the main view's), and whether it stands in the main view at all (beside
 * a floating side panel it stands in the window's corner), so the board's foot keeps the right room clear.
 */
function useMiniPlace(rootRef: RefObject<HTMLElement | null>): { variant: MiniVariant; inMain: boolean } {
  const [place, setPlace] = useState<{ variant: MiniVariant; inMain: boolean }>({ variant: 'whole', inMain: true });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const variant = miniVariant(el.clientWidth, rem);
      const inMain = !(parseFloat(getComputedStyle(el).getPropertyValue('--float-clear')) > 0);
      setPlace((was) => (was.variant === variant && was.inMain === inMain ? was : { variant, inMain }));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef]);
  return place;
}

interface Has {
  summary: boolean;
  views: boolean;
  filters: boolean;
  actions: boolean;
}

/**
 * The head's step from its pieces' widths: measured after every render and whenever the head or a piece resizes; the
 * step changes only when the widths say so, so it settles in a pass or two before anything is painted.
 */
function useHeadFold(has: Has) {
  const [step, setStep] = useState(0);
  const headRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLSpanElement>(null);
  const viewsRef = useRef<HTMLElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filterKeyRef = useRef<HTMLSpanElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const widthsRef = useRef<HeadWidths>({ title: 0, back: 0, summary: 0, views: 0, filters: null, filterKey: 0, actions: { whole: null, glyphs: null, narrow: null }, gap: 10 });
  const latestRef = useRef({ step, has });
  const observerRef = useRef<{ ro: ResizeObserver; watched: Set<Element> } | null>(null);

  const [measure] = useState(() => () => {
    const { step: at, has: now } = latestRef.current;
    const head = headRef.current;
    if (!head) return;
    const width = (el: Element | null) => el?.getBoundingClientRect().width ?? 0;
    const w = widthsRef.current;
    const style = getComputedStyle(head);
    w.gap = parseFloat(style.columnGap) || 10;
    w.title = width(titleRef.current);
    w.back = width(backRef.current);
    w.summary = now.summary ? width(summaryRef.current) : 0;
    w.views = now.views ? width(viewsRef.current) : 0;
    if (now.filters) {
      if (at < 2) w.filters = width(filtersRef.current);
      w.filterKey = width(filterKeyRef.current);
    } else {
      w.filters = 0;
      w.filterKey = 0;
    }
    const form: ActionsForm = at >= 4 ? 'narrow' : at >= 3 ? 'glyphs' : 'whole';
    if (now.actions) w.actions[form] = width(actionsRef.current);
    else w.actions = { whole: 0, glyphs: 0, narrow: 0 };
    const room = head.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const next = headStep(w, room);
    if (next !== at) setStep(next);
    // The head's height for what places itself under it (the org chart's free rectangle): two rows at the last step.
    const tall = `${Math.round(head.getBoundingClientRect().height)}px`;
    const frame = head.parentElement;
    if (frame && frame.style.getPropertyValue('--head-h') !== tall) frame.style.setProperty('--head-h', tall);
  });

  useLayoutEffect(() => {
    latestRef.current = { step, has };
  });
  // After every render: the board's pieces may have changed with it. The head and each piece are watched as they
  // resize (the window, the side panel, a filter's words), whichever of them are there now.
  useLayoutEffect(() => {
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current ??= { ro: new ResizeObserver(() => measure()), watched: new Set() };
      const { ro, watched } = observerRef.current;
      const now = new Set<Element>([headRef, titleRef, summaryRef, viewsRef, filtersRef, filterKeyRef, actionsRef, backRef].flatMap((r) => (r.current ? [r.current] : [])));
      for (const el of watched) if (!now.has(el)) ro.unobserve(el);
      for (const el of now) if (!watched.has(el)) ro.observe(el);
      observerRef.current.watched = now;
    }
    measure();
  });
  useEffect(() => () => observerRef.current?.ro.disconnect(), []);

  return { fold: foldAt(step), headRef, titleRef, summaryRef, viewsRef, filtersRef, filterKeyRef, actionsRef, backRef };
}
