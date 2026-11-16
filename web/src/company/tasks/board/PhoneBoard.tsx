// The task board on phones (docs/design-v3.md, "The task board", Phones): one column at a time. Chips name the columns
// with their counts, as a tablist; each column is a tabpanel, only the current one in the tab order and the others
// inert; a sideways swipe moves to the next (scroll snap) and makes its chip current. Grouped, the column shows a section
// per lane under its ribbon. No dragging: Move opens its action sheet.
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { useReducedMotion } from '../../../lib/hooks.ts';
import { Face, type FaceOf } from '../../ui/Face.tsx';
import { type Card, type ColumnId, type ColumnView, moreLine } from './columns.ts';
import { Glyph } from './Glyph.tsx';
import { columnName } from './Columns.tsx';
import type { LaneView } from './lanes.ts';

export interface PhoneLane {
  lane: LaneView;
  closed: boolean;
  face: FaceOf | null;
  hue: string | null;
}

interface PhoneBoardProps {
  columns: readonly ColumnView[];
  lanes: readonly PhoneLane[] | null;
  current: ColumnId;
  onCurrent: (column: ColumnId) => void;
  /** Done and Cancelled show their newest few until "And 22 more"; the board says how many. */
  shown: (cards: readonly Card[], column: ColumnId, lane: string) => { cards: readonly Card[]; hidden: number };
  onMore: (column: ColumnId, lane: string) => void;
  onLane: (lane: string) => void;
  note: (card: Card) => ReactNode;
  formUnder: (id: string) => ReactNode;
  /** Filter, Add a task and Plan, under the chips. */
  sub: ReactNode;
}

const KEYS: Readonly<Record<string, (i: number, n: number) => number>> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/** How long the panels keep still before a swipe counts as having landed. */
const SETTLE_MS = 120;

export function PhoneBoard({ columns, lanes, current, onCurrent, shown, onMore, onLane, note, formUnder, sub }: PhoneBoardProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const panels = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const at = Math.max(0, columns.findIndex((c) => c.id === current));

  // The chip picked brings its column into view; a swipe that landed there already leaves it be.
  const shownAt = useRef<number | null>(null);
  const byKey = useRef(false);
  useEffect(() => {
    const el = panels.current;
    if (!el || el.clientWidth === 0) return;
    if (Math.round(el.scrollLeft / el.clientWidth) !== at) el.scrollTo({ left: at * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    tabs.current?.querySelector<HTMLElement>(`[data-tb-tab="${current}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // On a short window the board scrolls as one (frame.css): a picked column scrolls up to the top of the sheet, chips and head going away, so its cards fill the view.
    if (!byKey.current && shownAt.current !== null && shownAt.current !== at && window.matchMedia('(max-height: 400px)').matches) {
      const scroller = el.closest<HTMLElement>('.bf__scroll');
      if (scroller) scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }
    shownAt.current = at;
    byKey.current = false;
  }, [at, current, reduced]);

  // A swipe: once the panels keep still, the column in view becomes the current one. The listener reads the columns as
  // they are when it runs, so it is added once.
  const latest = useRef({ columns, current, onCurrent });
  useEffect(() => {
    latest.current = { columns, current, onCurrent };
  });
  useEffect(() => {
    const el = panels.current;
    if (!el) return;
    let timer: number | null = null;
    const settle = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (el.clientWidth === 0) return;
        const now = latest.current;
        const column = now.columns[Math.round(el.scrollLeft / el.clientWidth)];
        if (column && column.id !== now.current) now.onCurrent(column.id);
      }, SETTLE_MS);
    };
    el.addEventListener('scroll', settle, { passive: true });
    return () => {
      el.removeEventListener('scroll', settle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = KEYS[event.key];
    if (!move) return;
    event.preventDefault();
    const next = columns[move(at, columns.length)];
    if (!next) return;
    byKey.current = true; // the arrows keep the chips in view
    onCurrent(next.id);
    tabs.current?.querySelector<HTMLElement>(`[data-tb-tab="${next.id}"]`)?.focus();
  };

  return (
    <div className="tb-phone">
      <div ref={tabs} className="tb-tabs" role="tablist" aria-label="Columns" onKeyDown={onTabKey}>
        {columns.map((c) => {
          const n = c.cards.length;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`${id}-tab-${c.id}`}
              data-tb-tab={c.id}
              aria-selected={c.id === current}
              aria-controls={`${id}-panel-${c.id}`}
              tabIndex={c.id === current ? 0 : -1}
              className="tb-tab"
              aria-label={columnName(c.title, n)}
              onClick={() => onCurrent(c.id)}
            >
              {c.title}
              <span className={`tb-tab__count${c.id === 'you' && n > 0 ? ' tb-tab__count--you' : ''}`}>{n}</span>
            </button>
          );
        })}
      </div>
      <div className="tb-sub">{sub}</div>
      <div ref={panels} className="tb-panels">
        {columns.map((c) => (
          <div key={c.id} id={`${id}-panel-${c.id}`} className="tb-panel" role="tabpanel" aria-labelledby={`${id}-tab-${c.id}`} inert={c.id !== current || undefined}>
            {lanes ? (
              lanes.map(({ lane, closed, face, hue }) => {
                const cell = lane.columns.find((x) => x.id === c.id);
                const cards = cell?.cards ?? [];
                const here = cards.length === 0 ? 'none here' : `${cards.length} here`;
                return (
                  <section key={lane.key} aria-labelledby={`${id}-${c.id}-${lane.key}`}>
                    <h3 className="tb-lanehead" id={`${id}-${c.id}-${lane.key}`}>
                      <button type="button" className="tb-ribbon" aria-expanded={!closed} onClick={() => onLane(lane.key)}>
                        <Glyph name="caret" className="tb-ribbon__caret" />
                        {face ? (
                          <Face of={face} size={28} />
                        ) : (
                          <span className="tb-roomsign" data-hue={hue ?? ''}>
                            {lane.name}
                          </span>
                        )}
                        <span className="tb-ribbon__words">{lane.heading}</span>
                        <span className="tb-ribbon__here">{here}</span>
                      </button>
                    </h3>
                    {!closed && <PanelCards cards={cards} column={c.id} lane={lane.key} props={{ shown, onMore, note, formUnder }} />}
                  </section>
                );
              })
            ) : (
              <>
                <PanelCards cards={c.cards} column={c.id} lane="" props={{ shown, onMore, note, formUnder }} />
                {c.cards.length === 0 && <p className="tb-col__empty">{c.empty}</p>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelCards({ cards, column, lane, props }: { cards: readonly Card[]; column: ColumnId; lane: string; props: Pick<PhoneBoardProps, 'shown' | 'onMore' | 'note' | 'formUnder'> }) {
  const view = props.shown(cards, column, lane);
  if (view.cards.length === 0) return null;
  return (
    <>
      <ul className="tb-list">
        {view.cards.map((card) => (
          <li key={card.id} className="tb-item" data-tb-card={card.id}>
            {props.note(card)}
            {props.formUnder(card.id)}
          </li>
        ))}
      </ul>
      {view.hidden > 0 && (
        <button type="button" className="tb-more" onClick={() => props.onMore(column, lane)}>
          {moreLine(view.hidden)}
        </button>
      )}
    </>
  );
}
