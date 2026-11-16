// The task board's columns on desktops and tablets (docs/design-v3.md, "The task board"; docs/design-hud.md): without
// lanes, a row of columns that scrolls sideways, each scrolling in itself under its head; with lanes, one grid whose
// column heads stay on top while the lanes stack under them, each starting with its ribbon. What lands where and every
// card's words come from the board (TaskBoard.tsx); this file only lays them out.
import type { KeyboardEvent, ReactNode } from 'react';
import { Face, type FaceOf } from '../../ui/Face.tsx';
import { type Card, type ColumnId, type ColumnView, moreLine } from './columns.ts';
import { Glyph } from './Glyph.tsx';
import type { LaneView } from './lanes.ts';
import { type ItemKey, moreKey, RAIL_KEY } from './nav.ts';

/** How a column (or a lane's cell) stands while a card is carried: it takes it (lit), refuses it (sunk), or neither. */
export type CellState = 'idle' | 'lit' | 'sunk';

/** One cell of the board: a column, or a column within a lane, as it is drawn now. */
export interface CellView {
  /** "<lane>|<column>". */
  key: string;
  /** The lane's key, "" without lanes. */
  lane: string;
  column: ColumnView;
  /** The cards shown: Done and Cancelled their newest few until "And 22 more" is pressed. */
  shown: Card[];
  hidden: number;
  state: CellState;
  /** Why it refuses the card carried, shown under its head. */
  reason: string | null;
  /** Where the landing line goes: before a card, or at the end (null); undefined for none. */
  landing?: string | null;
  /** A card dropped here, waiting for its form's button, with the form: drawn at the top. */
  pending: ReactNode;
}

interface ColumnsProps {
  /** The cells without lanes, one per column, in order. */
  cells: readonly CellView[];
  /** With lanes: each lane with its cells, in order; null without. */
  lanes: readonly { lane: LaneView; cells: readonly CellView[]; closed: boolean; face: FaceOf | null; hue: string | null; reason: string | null }[] | null;
  /** Each column's head, as the columns stand now (counts over every lane). */
  heads: readonly { column: ColumnView; count: number; state: CellState; reason: string | null; wide: boolean }[];
  railOpen: boolean;
  /** Cancelled's count, on the rail. */
  cancelled: number;
  tabStop: ItemKey | null;
  /** A card's note in its place, with its Move and key; `origin` while it is carried from there. */
  note: (card: Card, cell: CellView) => ReactNode;
  /** Whether a card is drawn as an outline where it came from (carried, or waiting for its form elsewhere). */
  origin: (id: string) => boolean;
  /** A form opened from Move, under its card where it is. */
  formUnder: (id: string) => ReactNode;
  onMore: (cell: CellView) => void;
  onRail: () => void;
  onLane: (lane: string) => void;
  onItemKey: (event: KeyboardEvent<HTMLElement>, key: ItemKey) => void;
  onItemFocus: (key: ItemKey) => void;
}

const MARK: Readonly<Record<ColumnId, string>> = {
  you: '',
  queued: 'tb-mark tb-mark--queued',
  working: 'tb-mark tb-mark--working',
  paused: 'tb-mark tb-mark--paused',
  blocked: 'tb-mark tb-mark--blocked',
  review: 'tb-mark tb-mark--review',
  done: 'tb-mark tb-mark--done',
  cancelled: 'tb-mark tb-mark--cancelled',
};

/** "Queued, 3 tasks": a column's name, its heading's and its list's. */
export const columnName = (title: string, count: number): string => `${title}, ${count} ${count === 1 ? 'task' : 'tasks'}`;

/** A column's sign and count, as its heading. */
function Head({ column, count, id }: { column: ColumnView; count: number; id: string }) {
  return (
    <h3 className="tb-col__head" id={id} tabIndex={-1} aria-label={columnName(column.title, count)}>
      <span className={`tb-sign${column.id === 'you' && count > 0 ? ' tb-sign--you' : ''}`}>
        {MARK[column.id] && <span className={MARK[column.id]} aria-hidden="true" />}
        {column.title}
      </span>
      <span className="tb-count">{count}</span>
    </h3>
  );
}

const headId = (column: ColumnId) => `tb-head-${column}`;

/** The landing line, inside the item it lands before (or after the last). */
const Landing = ({ where }: { where: 'before' | 'after' | 'top' }) => <span className={`tb-landing tb-landing--${where}`} aria-hidden="true" />;

function CellCards({ cell, props, label, labelledBy }: { cell: CellView; props: ColumnsProps; label?: string; labelledBy?: string }) {
  const { note, origin, formUnder, tabStop, onMore, onItemKey, onItemFocus } = props;
  const last = cell.shown.at(-1);
  const more = moreKey(cell.lane, cell.column.id);
  return (
    <>
      {cell.landing !== undefined && cell.shown.length === 0 && <Landing where="top" />}
      {/* A column is a list under its heading even while empty (its sentence follows); a lane's empty cell stays empty. */}
      {(cell.shown.length > 0 || cell.pending || cell.lane === '') && (
        <ul className="tb-list" aria-label={label} aria-labelledby={labelledBy}>
          {cell.pending}
          {cell.shown.map((card) => (
            <li key={card.id} className={`tb-item${origin(card.id) ? ' is-origin' : ''}`} data-tb-card={card.id}>
              {cell.landing === card.id && <Landing where="before" />}
              {note(card, cell)}
              {card === last && cell.landing === null && <Landing where="after" />}
              {formUnder(card.id)}
            </li>
          ))}
        </ul>
      )}
      {cell.hidden > 0 && (
        <button
          type="button"
          className="tb-more"
          data-tb-key={more}
          tabIndex={tabStop === more ? 0 : -1}
          onClick={() => onMore(cell)}
          onKeyDown={(e) => onItemKey(e, more)}
          onFocus={() => onItemFocus(more)}
        >
          {moreLine(cell.hidden)}
        </button>
      )}
    </>
  );
}

/** The closed Cancelled column: a rail with its count, opened by a press, Enter or Right, or a card carried over it. */
function Rail({ props, count, head }: { props: ColumnsProps; count: number; head: { state: CellState } | undefined }) {
  return (
    <button
      type="button"
      className={`tb-rail${head?.state === 'lit' ? ' is-over' : ''}`}
      data-tb-cell=""
      data-tb-column="cancelled"
      data-tb-lane=""
      data-tb-rail=""
      data-tb-key={RAIL_KEY}
      tabIndex={props.tabStop === RAIL_KEY ? 0 : -1}
      aria-label={`Cancelled, ${count} ${count === 1 ? 'task' : 'tasks'}`}
      aria-expanded={false}
      onClick={props.onRail}
      onKeyDown={(e) => props.onItemKey(e, RAIL_KEY)}
      onFocus={() => props.onItemFocus(RAIL_KEY)}
    >
      <span className="tb-mark tb-mark--cancelled" aria-hidden="true" />
      <span className="tb-rail__count">{count}</span>
      <span className="tb-rail__word">Cancelled</span>
    </button>
  );
}

export function Columns(props: ColumnsProps) {
  if (props.lanes) return <LaneGrid {...props} lanes={props.lanes} />;
  return (
    <div className="tb-scroll" data-tb-hscroll role="group" aria-label="Columns by status" tabIndex={-1}>
      {props.cells.map((cell) => {
        const id = cell.column.id;
        if (id === 'cancelled' && !props.railOpen) return <Rail key={id} props={props} count={props.cancelled} head={props.heads.find((h) => h.column.id === id)} />;
        const wide = cell.shown.length > 0 || cell.pending !== null;
        return (
          <section
            key={id}
            className={`tb-col${wide ? '' : ' tb-col--narrow'}${cell.state === 'lit' ? ' tb-col--lit' : cell.state === 'sunk' ? ' tb-col--sunk' : ''}`}
            aria-labelledby={headId(id)}
            data-tb-cell=""
            data-tb-column={id}
            data-tb-lane=""
          >
            <Head column={cell.column} count={cell.column.cards.length} id={headId(id)} />
            {cell.reason && <p className="tb-why">{cell.reason}</p>}
            {/* A scroller with no tab stop of its own: the arrow keys move between the cards and bring them into view. */}
            <div className="tb-col__body" data-tb-vscroll tabIndex={-1}>
              <CellCards cell={cell} props={props} labelledBy={headId(id)} />
              {cell.column.cards.length === 0 && !cell.pending && <p className="tb-col__empty">{cell.column.empty}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Lanes: one grid, the column heads sticky on its top row, the trays behind every lane. */
function LaneGrid(props: ColumnsProps & { lanes: NonNullable<ColumnsProps['lanes']> }) {
  const { heads, lanes, railOpen } = props;
  const widths = heads.map((h) => (h.column.id === 'cancelled' && !railOpen ? '52px' : h.wide ? '248px' : '168px'));
  // The trays run behind every lane: from the heads' row to after the last lane's cells.
  const rows = `1 / ${2 + lanes.length * 2}`;
  return (
    <div className="tb-grid" style={{ gridTemplateColumns: widths.join(' ') }} data-tb-hscroll data-tb-vscroll role="group" aria-label="Lanes" tabIndex={-1}>
      {/* Behind the sticky heads, across the gaps too, so a lane scrolled up never shows between them. */}
      <div className="tb-headband" aria-hidden="true" />
      {heads.map((h, i) => (
        <div key={`tray-${h.column.id}`} className={`tb-tray${h.state === 'lit' ? ' tb-tray--lit' : h.state === 'sunk' ? ' tb-tray--sunk' : ''}`} style={{ gridColumn: i + 1, gridRow: rows }} aria-hidden="true" />
      ))}
      {heads.map((h, i) =>
        h.column.id === 'cancelled' && !railOpen ? (
          <div key={`head-${h.column.id}`} className="tb-colhead" style={{ gridColumn: i + 1, gridRow: rows }}>
            <Rail props={props} count={props.cancelled} head={h} />
          </div>
        ) : (
          <div key={`head-${h.column.id}`} className={`tb-colhead${h.state === 'lit' ? ' tb-colhead--lit' : h.state === 'sunk' ? ' tb-colhead--sunk' : ''}`} style={{ gridColumn: i + 1 }}>
            <Head column={h.column} count={h.count} id={headId(h.column.id)} />
            {h.reason && <p className="tb-why">{h.reason}</p>}
          </div>
        ),
      )}
      {lanes.map(({ lane, cells, closed, face, hue, reason }, li) => {
        const row = 2 + li * 2;
        return [
          <h3 key={`${lane.key}-head`} className="tb-lanehead" style={{ gridRow: row }}>
            <button type="button" className="tb-ribbon" aria-expanded={!closed} aria-describedby={closed ? `tb-lane-${li}-closed` : undefined} onClick={() => props.onLane(lane.key)}>
              <Glyph name="caret" className="tb-ribbon__caret" />
              {face ? (
                <Face of={face} size={28} />
              ) : (
                <span className="tb-roomsign" data-hue={hue ?? ''}>
                  {lane.name}
                </span>
              )}
              <span className="tb-ribbon__words">{lane.heading}</span>
              {reason && <span className="tb-ribbon__why">{reason}</span>}
            </button>
            {closed && (
              <span id={`tb-lane-${li}-closed`} hidden>
                {lane.closedLine}
              </span>
            )}
          </h3>,
          ...cells.map((cell, ci) => {
            const id = cell.column.id;
            const style = { gridColumn: ci + 1, gridRow: row + 1 };
            if (id === 'cancelled' && !railOpen) return <div key={cell.key} style={style} aria-hidden="true" />;
            if (closed) {
              const n = cell.column.cards.length;
              return (
                <div key={cell.key} className="tb-cell tb-cell--counts" style={style} aria-hidden="true">
                  {n > 0 && <span className="tb-cellcount">{n}</span>}
                </div>
              );
            }
            return (
              <div
                key={cell.key}
                className={`tb-cell${cell.state === 'sunk' ? ' tb-cell--sunk' : ''}`}
                style={style}
                data-tb-cell=""
                data-tb-column={id}
                data-tb-lane={cell.lane}
              >
                <CellCards cell={cell} props={props} label={`${cell.column.title}, ${lane.name}`} />
              </div>
            );
          }),
        ];
      })}
    </div>
  );
}
