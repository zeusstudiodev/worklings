// The talk bar's lists (docs/design-v3.md, "The lists"): `@` at the start, `@` after the first word, `/` and a
// command's choices, one pattern. A `listbox` of `group`s and `option`s in a manual popover (the top layer, so it opens
// over the feed and the side panel) above the box's left edge; the box keeps focus and points at the active option with
// aria-activedescendant. Eight rows on desktops, four on phones, then it scrolls.
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import type { ListGroup, ListOption } from './talkModel.ts';

interface Props {
  /** The listbox's id: the box's aria-controls. Each option's id is `${id}-${option.id}`. */
  id: string;
  open: boolean;
  /** What it opens above: the box. */
  anchor: RefObject<HTMLElement | null>;
  groups: readonly ListGroup[];
  active: number;
  phone: boolean;
  /** What it says when nothing matches. */
  empty: string | null;
  onActive: (index: number) => void;
  onPick: (option: ListOption) => void;
  /** The face or glyph that leads an option. */
  lead: (option: ListOption) => ReactNode;
}

/** Shows or hides a manual popover, where the browser has the Popover API (every one the office supports does). */
export function showPopover(el: HTMLElement | null, open: boolean): void {
  if (!el || typeof el.showPopover !== 'function') return;
  const shown = el.matches(':popover-open');
  if (open && !shown) el.showPopover();
  else if (!open && shown) el.hidePopover();
}

/** Places a popover above an anchor's left edge, inside the window: above it if there is room, else below it. */
export function placeAbove(pop: HTMLElement, anchor: HTMLElement, full: boolean): void {
  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const width = window.innerWidth;
  const left = full ? gap : Math.max(gap, Math.min(rect.left, width - pop.offsetWidth - gap));
  pop.style.left = `${left}px`;
  if (full) pop.style.right = `${gap}px`;
  const above = rect.top - pop.offsetHeight - gap;
  pop.style.top = `${above >= gap ? above : Math.min(rect.bottom + gap, window.innerHeight - pop.offsetHeight - gap)}px`;
}

export function TalkList({ id, open, anchor, groups, active, phone, empty, onActive, onPick, lead }: Props) {
  const pop = useRef<HTMLDivElement>(null);
  const options = groups.flatMap((g) => g.options);

  useLayoutEffect(() => {
    const el = pop.current;
    showPopover(el, open);
    if (!open || !el || !anchor.current) return;
    const place = () => {
      if (anchor.current) placeAbove(el, anchor.current, phone);
    };
    place();
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  });

  // The active option scrolls into view inside the list.
  const activeId = options[active] ? `${id}-${options[active].id}` : null;
  useLayoutEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

  // Where each group's options start in the flat list the keys move through.
  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.options.length, 0));
  return (
    <div ref={pop} popover="manual" className={`tpop tpop--list${phone ? ' tpop--phone' : ''}`}>
      <div id={id} role="listbox" aria-label={groups[0]?.title ?? 'Choices'} className="tpop__list">
        {groups.map((g, gi) => {
          const headingId = `${id}-group-${gi}`;
          return (
            <div key={`${gi}:${g.title}`} role="group" aria-labelledby={headingId}>
              <div id={headingId} role="presentation" className="tpop__group">
                {g.title}
              </div>
              {g.options.map((o, oi) => {
                const index = (starts[gi] ?? 0) + oi;
                return (
                  <div
                    key={o.id}
                    id={`${id}-${o.id}`}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={o.disabled || undefined}
                    className={`tpop__option${index === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
                    // The box keeps focus; a press picks.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => {
                      if (index !== active) onActive(index);
                    }}
                    onClick={() => onPick(o)}
                  >
                    {lead(o)}
                    <span className="tpop__main">
                      <span className="tpop__label">{marked(o.label, o.match)}</span>
                      {o.detail && <span className="tpop__detail">{o.detail}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {empty && <p className="tpop__empty">{empty}</p>}
    </div>
  );
}

/** The label with what was typed underlined. */
function marked(label: string, match: [number, number] | null) {
  if (!match) return label;
  const [from, to] = match;
  return (
    <>
      {label.slice(0, from)}
      <b>{label.slice(from, to)}</b>
      {label.slice(to)}
    </>
  );
}
