// The marks every dashboard is drawn with (docs/design-v3.md, the widget table): a stat, a progress bar, horizontal
// bars, columns over time and a line. Marks are ink, room hues only for bars that are rooms; gridlines are hairlines
// one step off the badge; every chart has its words beside it and its numbers one press away, so no value is behind a
// hover. Labels are text, never HTML: what people wrote goes in as it is and React escapes it.
import { type PointerEvent, type ReactNode, useState } from 'react';
import { barExtents, centTicks, linePoints, nearestIndex, niceTicks } from './chartsModel.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Figures

interface StatProps {
  /** The figure, already in words ("24", "$12.30", "$1.20/h"). */
  value: string;
  unit?: string;
  title: string;
  note?: ReactNode;
  /** It waits on you: the inbox's highlighter rule down its edge. */
  needs?: boolean;
  /** The title's element: h4 under a dashboard's title, a plain line among a board's stats. */
  heading?: boolean;
}

/** A 28 px figure with its unit, the title under it and the note under that; the title comes first for screen readers. */
export function Stat({ value, unit, title, note, needs = false, heading = false }: StatProps) {
  const Title = heading ? 'h4' : 'p';
  return (
    <div className={`board-stat${needs ? ' board-stat--needs' : ''}`}>
      <Title className="board-stat__title">{title}</Title>
      <p className="board-stat__figure">
        {value}
        {unit && <span className="board-stat__unit"> {unit}</span>}
      </p>
      {note && <p className="board-stat__note">{note}</p>}
    </div>
  );
}

/** An 8 px bar, ink on the badge's line colour, with its words beside it ("8 of 10"). */
export function Meter({ share, words }: { share: number; words: string }) {
  const fill = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  return (
    <div className="board-meter">
      <span className="board-meter__track" aria-hidden="true">
        <span className="board-meter__fill" style={{ ['--fill' as string]: `${fill * 100}%` }} />
      </span>
      <span className="board-meter__words">{words}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The numbers behind a chart

export interface NumbersTable {
  caption: string;
  columns: string[];
  /** Which columns hold figures: right-aligned, tabular. */
  numeric: boolean[];
  rows: { key: string; cells: string[] }[];
}

/** "Show the numbers": the chart as a table, the way a screen reader or anyone who wants the figures reads it. */
export function Numbers({ table }: { table: NumbersTable }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="board-numbers" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="board-numbers__toggle">{open ? 'Hide the numbers' : 'Show the numbers'}</summary>
      <table className="ledger-table board-numbers__table">
        <caption className="visually-hidden">{table.caption}</caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={table.numeric[i] ? 'num' : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className={table.numeric[i] ? 'num' : undefined}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Horizontal bars

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** The value in words, at the bar's right: "7", "$4.66". */
  shown: string;
  /** A room's hue; ink otherwise. */
  hue?: string;
}

/** Horizontal bars, label left and value right; `limit` of them, then "and 4 more". Each row reads as its words. */
export function Bars({ items, limit = 12 }: { items: readonly BarItem[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const { bars } = barExtents(items.map((i) => i.value));
  const shown = all ? items : items.slice(0, limit);
  const more = items.length - shown.length;
  return (
    <div className="board-bars">
      <ul className="board-bars__list">
        {shown.map((item, i) => {
          const extent = bars[i] ?? { start: 0, size: 0 };
          return (
            <li key={item.key} className="board-bars__row">
              <span className="board-bars__label">{item.label}</span>
              <span className="board-bars__track" aria-hidden="true">
                <span
                  className={`board-bars__bar${item.value < 0 ? ' is-negative' : ''}${item.value !== 0 ? ' has-value' : ''}`}
                  style={{ ['--start' as string]: `${extent.start * 100}%`, ['--size' as string]: `${extent.size * 100}%`, ['--hue' as string]: item.hue ?? 'var(--ink)' }}
                />
              </span>
              <span className="board-bars__value">{item.shown}</span>
            </li>
          );
        })}
      </ul>
      {(more > 0 || all) && items.length > limit && (
        <button type="button" className="link board-bars__more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `and ${more} more`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Over time: columns and a line share an axis

interface Axis {
  ticks: number[];
  format: (n: number) => string;
}

function YAxis({ ticks, format }: Axis) {
  const top = ticks[ticks.length - 1] ?? 1;
  const bottom = ticks[0] ?? 0;
  const span = top - bottom || 1;
  return (
    <>
      <div className="board-chart__ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="board-chart__tick">
            {format(t)}
          </span>
        ))}
      </div>
      <svg className="board-chart__grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {ticks.map((t) => {
          const y = (1 - (t - bottom) / span) * 100;
          return <line key={t} x1="0" x2="100" y1={y} y2={y} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
    </>
  );
}

/** Under the plot: the first, middle and last points' labels, the ends kept inside the chart. */
function XAxis({ labels }: { labels: readonly string[] }) {
  const last = labels.length - 1;
  const picks = last <= 0 ? [0] : last === 1 ? [0, 1] : [0, Math.round(last / 2), last];
  return (
    <div className="board-chart__x" aria-hidden="true">
      {[...new Set(picks)].map((i) => {
        const x = last <= 0 ? 50 : (i / last) * 100;
        return (
          <span key={i} className="board-chart__xlabel" style={{ ['--x' as string]: `${x}%` }}>
            {labels[i]}
          </span>
        );
      })}
    </div>
  );
}

/** Which point the pointer is over: the crosshair snaps to the nearest one. Pointer only; the table has every value. */
function useHover(count: number, columns: boolean) {
  const [index, setIndex] = useState<number | null>(null);
  const track = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const x = (e.clientX - box.left) / box.width;
    setIndex(columns ? Math.min(count - 1, Math.max(0, Math.floor(x * count))) : nearestIndex(x, count));
  };
  return { index, handlers: { onPointerMove: track, onPointerDown: track, onPointerLeave: () => setIndex(null) } };
}

export interface TimePoint {
  key: string;
  value: number;
  /** Under the axis, short: "13:00". */
  tick: string;
  /** In the readout: "13:00 to 14:00". */
  label: string;
}

/**
 * Columns over time (spend by the hour): ink, at most 24 px wide, 2 px apart; the highest one carries its value. With
 * `cents`, the values are dollars and the ticks fall on whole cents.
 */
export function Columns({ points, format, tickFormat = format, cents = false }: { points: readonly TimePoint[]; format: (n: number) => string; tickFormat?: (n: number) => string; cents?: boolean }) {
  const values = points.map((p) => p.value);
  const ticks = (cents ? centTicks : niceTicks)(0, Math.max(0, ...values));
  const top = ticks[ticks.length - 1] ?? 1;
  const peak = values.reduce((best, v, i) => (v > (values[best] ?? 0) ? i : best), 0);
  const { index, handlers } = useHover(points.length, true);
  const hovered = index === null ? null : points[index];
  const x = (i: number) => ((i + 0.5) / Math.max(1, points.length)) * 100;
  return (
    <div className="board-chart board-chart--columns" aria-hidden="true">
      <YAxis ticks={ticks} format={tickFormat} />
      <div className="board-chart__plot" {...handlers}>
        <div className={`board-chart__cols${index !== null ? ' is-hovering' : ''}`}>
          {points.map((p, i) => (
            <span key={p.key} className={`board-chart__col${i === index ? ' is-hovered' : ''}`} style={{ ['--h' as string]: `${(p.value / top) * 100}%` }} />
          ))}
        </div>
        {index === null && (values[peak] ?? 0) > 0 && (
          <span className="board-chart__peak" style={{ ['--x' as string]: `${x(peak)}%`, ['--y' as string]: `${(1 - (values[peak] ?? 0) / top) * 100}%` }}>
            {format(values[peak] ?? 0)}
          </span>
        )}
        {hovered && index !== null && (
          <span className="board-chart__readout" style={{ ['--x' as string]: `${x(index)}%` }}>
            <strong>{format(hovered.value)}</strong>, {hovered.label}
          </span>
        )}
      </div>
      <XAxis labels={points.map((p) => p.tick)} />
    </div>
  );
}

/** An ink line on light gridlines, 3 to 5 ticks, the last value labelled; a crosshair follows the pointer. */
export function Line({ points, format, tickFormat = format, whole = false }: { points: readonly TimePoint[]; format: (n: number) => string; tickFormat?: (n: number) => string; whole?: boolean }) {
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), whole);
  const at = linePoints(values, ticks);
  const { index, handlers } = useHover(points.length, false);
  const last = at[at.length - 1];
  const lastValue = values[values.length - 1] ?? 0;
  const hovered = index === null ? null : { point: points[index], at: at[index] };
  return (
    <div className="board-chart board-chart--line" aria-hidden="true">
      <YAxis ticks={ticks} format={tickFormat} />
      <div className="board-chart__plot" {...handlers}>
        <svg className="board-chart__line" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <polyline points={at.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')} vectorEffect="non-scaling-stroke" />
          {hovered?.at && <line className="board-chart__cross" x1={hovered.at.x * 100} x2={hovered.at.x * 100} y1="0" y2="100" vectorEffect="non-scaling-stroke" />}
        </svg>
        {last && (
          <>
            <span className="board-chart__marker" style={{ ['--x' as string]: `${last.x * 100}%`, ['--y' as string]: `${last.y * 100}%` }} />
            {index === null && (
              <span className={`board-chart__end${last.y < 0.2 ? ' is-high' : ''}`} style={{ ['--x' as string]: `${last.x * 100}%`, ['--y' as string]: `${last.y * 100}%` }}>
                {format(lastValue)}
              </span>
            )}
          </>
        )}
        {hovered?.at && hovered.point && (
          <>
            <span className="board-chart__marker is-hovered" style={{ ['--x' as string]: `${hovered.at.x * 100}%`, ['--y' as string]: `${hovered.at.y * 100}%` }} />
            <span className="board-chart__readout" style={{ ['--x' as string]: `${hovered.at.x * 100}%` }}>
              <strong>{format(hovered.point.value)}</strong>, {hovered.point.label}
            </span>
          </>
        )}
      </div>
      <XAxis labels={points.map((p) => p.tick)} />
    </div>
  );
}

/** A chart's sentence, under it: what a screen reader and a glance both get. */
export function ChartWords({ children }: { children: ReactNode }) {
  return <p className="board-chart__words">{children}</p>;
}
