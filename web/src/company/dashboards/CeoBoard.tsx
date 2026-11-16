// A dashboard the CEO published (docs/design-v3.md, "Dashboards" and its widget table): the title, who made it and
// when, then each widget drawn by the office. People send data, never HTML: every label, cell and note is text.
import { useId, useRef, useState } from 'react';
import type { Dashboard, Widget } from '../../../../src/core/dashboard.ts';
import { roomHue } from '../../hud/model.ts';
import type { TabProps } from '../types.ts';
import { madeByLine, roomsOfBars } from './boardsModel.ts';
import { Bars, ChartWords, Line, Meter, Numbers, Stat } from './charts.tsx';
import { formatNumber, lineWords, withUnit } from './chartsModel.ts';
import { roomsOf, useScrollsSideways } from './parts.tsx';

/** How many entries a list shows, and rows a table, before the rest fold. */
export const LIST_SHOWN = 20;
export const TABLE_SHOWN = 50;

interface Props {
  props: TabProps;
  now: number;
  dashboard: Dashboard;
}

export function CeoBoard({ props, now, dashboard }: Props) {
  const { snapshot, company } = props;
  const id = useId();
  return (
    <article className="board board--ceo" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="board-ceo__title">
        {dashboard.title}
      </h3>
      <p className="board-ceo__made">{madeByLine(dashboard, company.people, now)}</p>
      <div className="board-widgets db-grid">
        {dashboard.widgets.map((w, i) => (
          <WidgetView key={`${i}:${w.kind}:${w.title}`} widget={w} snapshot={snapshot} />
        ))}
      </div>
    </article>
  );
}

const numberCell = (cell: string | number) => (typeof cell === 'number' ? formatNumber(cell) : cell);

function WidgetView({ widget: w, snapshot }: { widget: Widget; snapshot: TabProps['snapshot'] }) {
  switch (w.kind) {
    case 'stat':
      return (
        <div className="board-widget board-widget--stat db-card">
          <Stat heading value={typeof w.value === 'number' ? formatNumber(w.value) : w.value} unit={w.unit} title={w.title} note={w.note} />
        </div>
      );
    case 'progress':
      return (
        <section className="board-widget board-widget--progress db-card">
          <h4 className="board-widget__title">{w.title}</h4>
          <Meter share={w.max > 0 ? w.value / w.max : 0} words={`${formatNumber(w.value)} of ${formatNumber(w.max)}`} />
          {w.note && <p className="board-widget__note">{w.note}</p>}
        </section>
      );
    case 'bars':
      return <BarsWidget widget={w} snapshot={snapshot} />;
    case 'line':
      return <LineWidget widget={w} />;
    case 'list':
      return <ListWidget widget={w} />;
    default:
      return <TableWidget widget={w} />;
  }
}

function BarsWidget({ widget: w, snapshot }: { widget: Extract<Widget, { kind: 'bars' }>; snapshot: TabProps['snapshot'] }) {
  const rooms = roomsOfBars(
    w.bars.map((b) => b.label),
    roomsOf(snapshot),
  );
  const items = w.bars.map((b, i) => {
    const room = rooms?.[i];
    return { key: `${i}:${b.label}`, label: b.label, value: b.value, shown: withUnit(formatNumber(b.value), w.unit), ...(room ? { hue: roomHue(snapshot, room) } : {}) };
  });
  return (
    <section className="board-widget board-widget--bars db-card">
      <h4 className="board-widget__title">{w.title}</h4>
      <Bars items={items} />
      <Numbers
        table={{
          caption: w.title,
          columns: ['Label', w.unit ? `Value (${w.unit})` : 'Value'],
          numeric: [false, true],
          rows: w.bars.map((b, i) => ({ key: `${i}:${b.label}`, cells: [b.label, formatNumber(b.value)] })),
        }}
      />
    </section>
  );
}

function LineWidget({ widget: w }: { widget: Extract<Widget, { kind: 'line' }> }) {
  const points = w.points.map((p, i) => ({ key: `${i}:${p.label}`, value: p.value, tick: p.label, label: p.label }));
  return (
    <section className="board-widget board-widget--line db-card">
      <h4 className="board-widget__title">{w.title}</h4>
      <Line points={points} format={(n) => withUnit(formatNumber(n), w.unit)} tickFormat={formatNumber} whole={w.points.every((p) => Number.isInteger(p.value))} />
      <ChartWords>{lineWords(w.points, w.unit)}</ChartWords>
      <Numbers
        table={{
          caption: w.title,
          columns: ['Label', w.unit ? `Value (${w.unit})` : 'Value'],
          numeric: [false, true],
          rows: w.points.map((p, i) => ({ key: `${i}:${p.label}`, cells: [p.label, formatNumber(p.value)] })),
        }}
      />
    </section>
  );
}

function ListWidget({ widget: w }: { widget: Extract<Widget, { kind: 'list' }> }) {
  const [all, setAll] = useState(false);
  const shown = all ? w.items : w.items.slice(0, LIST_SHOWN);
  const more = w.items.length - LIST_SHOWN;
  return (
    <section className="board-widget board-widget--list db-card">
      <h4 className="board-widget__title">{w.title}</h4>
      <ul className="board-widget__list">
        {shown.map((item, i) => (
          <li key={`${i}:${item}`}>{item}</li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" className="link board-widget__more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `and ${more} more`}
        </button>
      )}
    </section>
  );
}

function TableWidget({ widget: w }: { widget: Extract<Widget, { kind: 'table' }> }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const scrolls = useScrollsSideways(box);
  const [all, setAll] = useState(false);
  const rows = all ? w.rows : w.rows.slice(0, TABLE_SHOWN);
  const more = w.rows.length - TABLE_SHOWN;
  // A column of numbers lines up on the right; one of words stays left.
  const numeric = w.columns.map((_, c) => w.rows.length > 0 && w.rows.every((r) => typeof r[c] === 'number'));
  return (
    <section className="board-widget board-widget--table db-card">
      <h4 id={`${id}-title`} className="board-widget__title">
        {w.title}
      </h4>
      <div
        ref={box}
        className="board-widget__scroll"
        {...(scrolls ? { role: 'region', 'aria-labelledby': `${id}-title`, tabIndex: 0 } : {})}
      >
        <table className="ledger-table board-widget__table">
          <thead>
            <tr>
              {w.columns.map((c, i) => (
                <th key={`${i}:${c}`} scope="col" className={numeric[i] ? 'num' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) =>
                  c === 0 ? (
                    <th key={c} scope="row">
                      {numberCell(cell)}
                    </th>
                  ) : (
                    <td key={c} className={numeric[c] ? 'num' : undefined}>
                      {numberCell(cell)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {w.rows.length === 0 && <p className="board-quiet">No rows yet.</p>}
      {more > 0 && (
        <button type="button" className="link board-widget__more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `and ${more} more rows`}
        </button>
      )}
    </section>
  );
}
