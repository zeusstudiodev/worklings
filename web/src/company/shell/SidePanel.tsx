// The side panel (docs/design-v3.md, "Stage and dock", "The side panel"; design-hud, "The side panel"): what you opened,
// beside the main view. Docked from 896 px, its left edge a separator you drag, press or key to resize, which collapses
// into a pull on the window's edge when hidden; floating over the main view's right from 721 to 895 px, with neither;
// a sheet on phones. Its head: Back (only when the entry before is another side panel view, or the feed), the inbox's
// title or a person's band, "Back to the inbox" and Hide. The views inside keep their own titles.
import { type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, useId, useLayoutEffect, useRef } from 'react';
import type { PersonView } from '../../../../src/core/company.ts';
import { Face } from '../ui/Face.tsx';
import { Count } from '../ui/Count.tsx';
import { Icon } from './Icon.tsx';
import { nextStop, type PanelBounds, type ShellLayout, widthByKey, widthFromDrag } from './sidePanelModel.ts';

/** How far a pointer moves before a press on the separator becomes a drag. */
const DRAG_SLOP = 4;
/** How far a finger moves down a sheet's grabber or head before the sheet follows it. */
const SWIPE_SLOP = 8;
/** A swipe up this far opens a peeking sheet. */
const PEEK_SWIPE = 24;
/** A swipe down this far closes the sheet; a quick one, a third of it. */
const SWIPE_CLOSE = 96;

export interface SidePanelProps {
  layout: ShellLayout;
  /** Desktops: whether it shows (not hidden). Phones: whether its sheet is up. */
  shown: boolean;
  /** Changes whenever what it shows changes (the address, an overlay), so a sheet swiped away comes back at rest. */
  place: string;
  /** Its committed width (docked). */
  width: number;
  bounds: PanelBounds;
  /** The inbox's count, on the pull. */
  inbox: number;
  /**
   * Whether a hidden docked panel leaves its pull on the window's edge: only before the start, for the proposal. Since v0.8
   * the panel closes after the start, and the inbox card over the talk bar is the way back to what needs you.
   */
  pull?: boolean;
  /** Phones: the sheet only peeks (its head and first line) over the office until it is opened, by a press or a swipe up. */
  peek?: boolean;
  onPeek?: () => void;
  head: SidePanelHead;
  children: ReactNode;
  /** Something opened over it (a phone's sheet over the feed), or the palette: its contents are out of reach. */
  inert?: boolean;
  /** Phones: the sheet's height, the grabber's press (half or most of the room), and what closes it (Close, a swipe down). */
  sheet?: { style: CSSProperties; half: boolean; onLower: () => void; onClose: (() => void) | null };
  onWidth: (width: number) => void;
  onHidden: (hidden: boolean) => void;
  /** Writes the live width while dragging, on the shell's root, so CSS reflows without a render per move. */
  onDrag: (width: number | null) => void;
}

export interface SidePanelHead {
  /** The browser's Back, offered only when it leads to another side panel view over the same main view, or to the feed. */
  onBack: (() => void) | null;
  /** "Back to the inbox" (the ×): to the side panel's home; null on the home itself. */
  onHome: (() => void) | null;
  homeLabel: string;
  /** The home's own title and its count sentence ("Inbox", "Four need you, oldest first."); null where the view brings its own. */
  title: { text: string; sentence: string | null; label: string; /** What the peek says it opens, where "the <title>" doesn't read right. */ opens?: string } | null;
  /** A person open: their band in their room's hue, with their face. */
  person: { person: PersonView; hue: string | null } | null;
}

export function SidePanel(props: SidePanelProps) {
  const { layout, head, children } = props;
  const docked = layout === 'docked';
  const phone = layout === 'phone' || layout === 'short';
  const peeking = phone && props.peek === true && !props.shown;
  const shown = props.shown || peeking;
  const titleId = useId();
  // Docked, its width is the shell root's --side-w, which a drag writes live.
  const style = phone ? props.sheet?.style : undefined;

  // A phone sheet's swipe down, on its grabber or head (design-v3, "Closing a sheet"): the sheet follows the finger, and
  // closes past SWIPE_CLOSE, or a third of it when quick; short of that it settles back. Close does the same by a press,
  // and the press a swipe ends with doesn't also press what it started on.
  const onClose = phone ? (props.sheet?.onClose ?? null) : null;
  const paper = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ id: number; y: number; at: number; dy: number; on: boolean } | null>(null);
  const swiped = useRef(false);
  // What the sheet shows next starts at rest: a closing swipe leaves it below the window until then.
  useLayoutEffect(() => {
    if (paper.current) rest(paper.current);
  }, [props.place]);
  const gesture = {
    onPointerDownCapture: () => {
      swiped.current = false;
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      const from = event.target instanceof Element ? event.target.closest('.side-panel__grabber, .side-panel__head') : null;
      if (onClose === null || from === null || !event.isPrimary || event.button !== 0) return;
      swipe.current = { id: event.pointerId, y: event.clientY, at: event.timeStamp, dy: 0, on: false };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const s = swipe.current;
      const el = paper.current;
      if (!s || !el || s.id !== event.pointerId) return;
      const dy = Math.max(0, event.clientY - s.y);
      if (!s.on) {
        if (dy < SWIPE_SLOP) return;
        s.on = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        el.style.transition = 'none';
      }
      s.dy = dy;
      el.style.transform = `translateY(${dy}px)`;
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const s = swipe.current;
      swipe.current = null;
      const el = paper.current;
      if (!s?.on || !el) return;
      swiped.current = true;
      const quick = s.dy / Math.max(1, event.timeStamp - s.at) > 0.5;
      if (onClose !== null && (s.dy > SWIPE_CLOSE || (s.dy > SWIPE_CLOSE / 3 && quick))) {
        glide(el, 'translateY(110%)');
        onClose();
        // Should nothing change (nothing was left to close), the sheet comes back rather than staying out of sight.
        window.setTimeout(() => {
          if (swipe.current === null) rest(el);
        }, 700);
      } else glide(el, '');
    },
    onPointerCancel: () => {
      const s = swipe.current;
      swipe.current = null;
      if (s?.on && paper.current) glide(paper.current, '');
    },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (!swiped.current) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
  return (
    <aside
      id="company-panel"
      className={`side-panel side-panel--${layout}${shown ? '' : ' is-hidden'}${props.sheet?.half ? ' side-panel--half' : ''}${peeking ? ' side-panel--peek' : ''}`}
      aria-label="Side panel"
      style={style}
      tabIndex={-1}
      inert={props.inert || (!shown && !docked) || undefined}
    >
      {docked && (props.shown || props.pull === true) && <Separator {...props} />}
      {(shown || !docked) && (
        <div ref={paper} className="side-panel__paper" hidden={!shown} {...(phone ? gesture : {})}>
          {peeking && <Peek name={head.title ? `Open ${head.title.opens ?? `the ${head.title.text.toLowerCase()}`}${head.title.sentence ? `. ${head.title.sentence}` : ''}` : 'Open the side panel'} onOpen={props.onPeek} />}
          {phone && props.sheet && !peeking && (
            <button type="button" className="side-panel__grabber" onClick={props.sheet.onLower} aria-expanded={!props.sheet.half}>
              <span className="side-panel__grip" aria-hidden="true" />
              <span className="visually-hidden">{props.sheet.half ? 'Show more' : 'Show less'}</span>
            </button>
          )}
          <header className={`side-panel__head${head.person ? ' side-panel__head--band' : ''}`} data-hue={head.person?.hue ?? undefined} aria-hidden={peeking || undefined}>
            {head.onBack && (
              <button type="button" className="side-panel__key side-panel__back" onClick={head.onBack}>
                <Icon name="left" size={16} />
                Back
              </button>
            )}
            {head.title && (
              <div className="side-panel__title">
                <h2 id={titleId} className="side-panel__h2" tabIndex={-1} data-panel-heading aria-label={head.title.label}>
                  {head.title.text}
                </h2>
                {head.title.sentence && <p className="side-panel__sentence">{head.title.sentence}</p>}
              </div>
            )}
            <span className="side-panel__gap" aria-hidden="true" />
            {head.onHome && (
              <button type="button" className="side-panel__key side-panel__key--icon" aria-label={head.homeLabel} title={head.homeLabel} onClick={head.onHome}>
                <Icon name="close" />
              </button>
            )}
            {/* v0.8: after the start, hiding is closing, so Hide shows only where there is no × to do it. */}
            {!phone && (head.onHome === null || props.pull === true) && (
              <button type="button" className="side-panel__key side-panel__key--icon" aria-label="Hide the side panel" title="Hide the side panel" onClick={() => props.onHidden(true)}>
                <Icon name="hide" />
              </button>
            )}
            {head.person && (
              <span className="side-panel__face">
                <Face of={{ kind: 'person', person: head.person.person, hue: head.person.hue }} size={64} />
              </span>
            )}
          </header>
          {!peeking && <div className="side-panel__body">{children}</div>}
        </div>
      )}
    </aside>
  );
}

/**
 * A peeking sheet's one control, over its head: a press opens the sheet, and so does a swipe up (the grip on top says it
 * can be pulled). Its name is the sheet's title and first line.
 */
function Peek({ name, onOpen }: { name: string; onOpen?: () => void }) {
  const from = useRef<{ id: number; y: number } | null>(null);
  return (
    <button
      type="button"
      className="side-panel__peek-key"
      aria-label={name}
      onClick={() => onOpen?.()}
      onPointerDown={(event) => {
        if (event.isPrimary) from.current = { id: event.pointerId, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const start = from.current;
        if (!start || start.id !== event.pointerId || start.y - event.clientY < PEEK_SWIPE) return;
        from.current = null;
        onOpen?.();
      }}
      onPointerUp={() => {
        from.current = null;
      }}
      onPointerCancel={() => {
        from.current = null;
      }}
    >
      <span className="side-panel__grip" aria-hidden="true" />
    </button>
  );
}

/** A sheet back at rest, or gliding to where a swipe left it. */
function rest(el: HTMLElement) {
  el.style.removeProperty('transform');
  el.style.removeProperty('transition');
}

function glide(el: HTMLElement, transform: string) {
  el.style.transition = 'transform var(--t-move) var(--ease-out)';
  el.style.transform = transform;
}

/**
 * The side panel's left edge, the window splitter pattern: drag it (the panel and what lies over the main view follow by
 * CSS, the camera refits once on release), press it to step through narrow, the default and wide, or use its keys.
 * Hidden, the same control is the pull on the window's right edge with the inbox's count.
 */
function Separator({ shown, width, bounds, inbox, onWidth, onHidden, onDrag }: SidePanelProps) {
  const describe = useId();
  // The window's width is read once, at the press: reading it on every move forces layout.
  const drag = useRef<{ startX: number; startWidth: number | null; moved: boolean; width: number; winWidth: number; frame: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: shown ? width : null, moved: false, width: shown ? width : 0, winWidth: window.innerWidth, frame: 0 };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(event.clientX - d.startX) < DRAG_SLOP) return;
    d.moved = true;
    d.width = widthFromDrag(d, event.clientX, d.winWidth, bounds);
    // One write of the variable a frame, however many moves came.
    if (!d.frame) {
      d.frame = window.requestAnimationFrame(() => {
        d.frame = 0;
        onDrag(d.width);
      });
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    window.cancelAnimationFrame(d.frame);
    event.currentTarget.releasePointerCapture(event.pointerId);
    onDrag(null);
    if (d.moved) {
      // Pulled out as a drag, it opens at the width you let go at.
      onWidth(d.width);
      if (!shown) onHidden(false);
    } else if (!shown) {
      onHidden(false);
    } else {
      onWidth(nextStop(width, bounds));
    }
  };
  const onPointerCancel = () => {
    if (drag.current) window.cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    onDrag(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      // Enter hides it, or shows it again at its last width; focus stays on the separator.
      onHidden(shown);
      return;
    }
    if (!shown) return;
    const next = widthByKey(event.key, event.shiftKey, width, bounds);
    if (next === null) return;
    event.preventDefault();
    onWidth(next);
  };

  return (
    <div
      className={`side-panel__separator${shown ? '' : ' side-panel__separator--pull'}`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-controls="company-panel"
      aria-label="Resize the side panel"
      aria-describedby={describe}
      aria-valuemin={0}
      aria-valuemax={bounds.max}
      aria-valuenow={shown ? width : 0}
      aria-valuetext={shown ? `${width} pixels wide` : 'Hidden'}
      title={shown ? 'Drag to resize it, or press to switch between narrow, default and wide.' : 'Press to show the side panel, or drag it out.'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
    >
      <span className="side-panel__handle" aria-hidden="true">
        {!shown && (
          <>
            <Icon name="left" size={16} />
            <Count n={inbox} />
          </>
        )}
      </span>
      <span id={describe} className="visually-hidden">
        {shown ? 'Left and Right resize it, Enter hides it.' : 'Enter or a press shows it again.'}
      </span>
    </div>
  );
}
