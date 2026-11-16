// The Spend dashboard (docs/design-v3.md, "Dashboards"): Today, 7 days or All; what was spent and the burn; spend over
// time in columns, by room in room hues, and by person as v2's payroll with "Worth a look" and the office last.
// Money is labelled as v2 labels it, API-equivalent on a plan and Spend with an API key; every figure comes from
// spendBoard, which adds up to what the people cost.
import { useId, useMemo } from 'react';
import { type SpendRangeId, spendBoard, SPEND_RANGES } from '../../../../src/core/boards.ts';
import { THE_OFFICE } from '../../../../src/core/company.ts';
import { roomHue, officeCalls } from '../../hud/model.ts';
import { dollars, percent, rate } from '../../lib/format.ts';
import type { TabProps } from '../types.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { bucketLabel, nothingSpent, peakWords, RANGE_LABELS, roomName, seriesSpan, spentNote, spentTitle, stepWords, tickLabel } from './boardsModel.ts';
import { Bars, ChartWords, Columns, Numbers, Stat } from './charts.tsx';
import { moneyTick } from './chartsModel.ts';
import { roomsOf } from './parts.tsx';
import { BudgetCard } from '../spending/BudgetCard.tsx';

interface Props {
  props: TabProps;
  now: number;
  range: SpendRangeId;
  onRange: (range: SpendRangeId) => void;
}

export function SpendBoard({ props, now, range, onRange }: Props) {
  const { snapshot, company, navigate } = props;
  const board = useMemo(() => spendBoard(company, now), [company, now]);
  const id = useId();
  const rooms = roomsOf(snapshot);

  if (board.all.spent <= 0) {
    return (
      <div className="board board--spend db-grid">
        <h3 className="visually-hidden">Spend</h3>
        <p className="board-empty db-card">Nothing spent yet.</p>
        <BudgetCard company={company} />
      </div>
    );
  }

  const r = board[range];
  const people = new Map(company.people.map((p) => [p.id, p]));
  const series = r.series;
  const span = seriesSpan(series);
  const columns = series.points.map((p) => ({ key: String(p.at), value: p.value, tick: tickLabel(p.at, series.step, now, span), label: bucketLabel(p.at, series.step, now) }));
  const when = range === 'today' ? 'today' : range === 'week' ? 'over 7 days' : 'so far';

  const rangeSwitch = (
    <Segmented className="board-range" label="Spend over" options={SPEND_RANGES.map((option) => ({ value: option, label: RANGE_LABELS[option] }))} value={range} onChange={onRange} />
  );

  if (r.spent <= 0) {
    return (
      <div className="board board--spend db-grid">
        <h3 className="visually-hidden">Spend</h3>
        {rangeSwitch}
        <p className="board-empty db-card">{nothingSpent(range)}</p>
        <div className="board-stats">
          <Stat value={rate(board.burn.dollarsPerHour)} title="Burn" note="Over the last hour." />
        </div>
        <BudgetCard company={company} />
      </div>
    );
  }

  const stats = (
    <div className="board-stats">
      <Stat value={dollars(r.spent)} title={spentTitle(board.label, range)} note={spentNote(board.estimate)} />
      <Stat value={rate(board.burn.dollarsPerHour)} title="Burn" note="Over the last hour." />
    </div>
  );

  const overTime = (
    <section className="board-section db-card db-c8" aria-labelledby={`${id}-time`}>
      <h4 id={`${id}-time`} className="board-section__title">
        {stepWords(series.step)}
      </h4>
      <Columns points={columns} format={dollars} tickFormat={moneyTick} cents />
      <ChartWords>{peakWords(series, now, dollars)}</ChartWords>
      <Numbers
        table={{
          caption: `Spend ${when}, ${stepWords(series.step).toLowerCase()}`,
          columns: ['Time', 'Spent'],
          numeric: [false, true],
          rows: columns.filter((p) => p.value > 0).map((p) => ({ key: p.key, cells: [p.label, dollars(p.value)] })),
        }}
      />
    </section>
  );

  const byRoom = r.rooms.length > 0 && (
    <section className="board-section db-card db-c4" aria-labelledby={`${id}-rooms`}>
      <h4 id={`${id}-rooms`} className="board-section__title">
        By room
      </h4>
      <Bars items={r.rooms.map((x) => ({ key: x.room, label: roomName(x.room, rooms), value: x.cost, shown: dollars(x.cost), hue: roomHue(snapshot, x.room) }))} />
      <Numbers
        table={{
          caption: `Spend by room ${when}`,
          columns: ['Room', 'Spent', 'Share'],
          numeric: [false, true, true],
          rows: r.rooms.map((x) => ({ key: x.room, cells: [roomName(x.room, rooms), dollars(x.cost), percent(x.share)] })),
        }}
      />
    </section>
  );

  const byPerson = (
    <section className="board-section db-card db-c12" aria-labelledby={`${id}-people`}>
      <h4 id={`${id}-people`} className="board-section__title">
        By person
      </h4>
      <table className="ledger-table board-payroll">
        <caption className="visually-hidden">Spend by person {when}</caption>
        <thead>
          <tr>
            <th scope="col">Who</th>
            <th scope="col" className="num">
              Share
            </th>
            <th scope="col" className="num">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {r.people.map((l) => {
            const p = people.get(l.person);
            if (l.person === THE_OFFICE) {
              const calls = officeCalls(snapshot.aside.spend);
              return (
                <tr key={l.person} className="ledger-table__office">
                  <th scope="row">
                    The office
                    {calls && <span className="ledger-table__sub">{calls}</span>}
                  </th>
                  <td className="num">
                    <span className="share" style={{ ['--share' as string]: `${Math.round(l.share * 100)}%`, ['--hue' as string]: '#8c948f' }}>
                      {percent(l.share)}
                    </span>
                  </td>
                  <td className="num">{dollars(l.cost)}</td>
                </tr>
              );
            }
            return (
              <tr key={l.person}>
                <th scope="row">
                  {p ? (
                    <button type="button" className="link" data-focus={`dashboards:person:${l.person}`} onClick={() => navigate(`people/${encodeURIComponent(l.person)}`)}>
                      {l.name}
                    </button>
                  ) : (
                    l.name
                  )}
                  {!p ? <span className="ledger-table__sub">No longer in the company</span> : p.name !== p.title && <span className="ledger-table__sub">{p.title}</span>}
                </th>
                <td className="num">
                  <span className="share" style={{ ['--share' as string]: `${Math.round(l.share * 100)}%`, ['--hue' as string]: p ? roomHue(snapshot, p.room) : '#8c948f' }}>
                    {percent(l.share)}
                  </span>
                </td>
                <td className="num">{dollars(l.cost)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );

  const advice = r.advice.length > 0 && (
    <section className="board-section db-card db-c12" aria-labelledby={`${id}-advice`}>
      <h4 id={`${id}-advice`} className="board-section__title">
        Worth a look
      </h4>
      <ul className="advice">
        {r.advice.map((a) => {
          const p = people.get(a.person);
          return (
            <li key={a.person} className="advice__item advice__item--expensive">
              <span className="advice__who">
                {p ? (
                  <button type="button" className="link" onClick={() => navigate(`people/${encodeURIComponent(a.person)}`)}>
                    {p.name}
                  </button>
                ) : (
                  a.person
                )}
              </span>
              <span>{a.message}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <div className="board board--spend db-grid">
      <h3 className="visually-hidden">Spend</h3>
      {rangeSwitch}
      {stats}
      <BudgetCard company={company} />
      {overTime}
      {byRoom}
      {byPerson}
      {advice}
    </div>
  );
}
