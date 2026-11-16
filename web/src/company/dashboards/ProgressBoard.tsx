// The Progress dashboard (docs/design-v3.md, "Dashboards"): the counts, the goal, a bar per milestone, tasks done per
// room in room hues, what is blocked and why, and tasks done over time. Every number comes from progressBoard, which
// counts tasks the way the Tasks panel does, so the two never disagree.
import { useId, useMemo } from 'react';
import { progressBoard } from '../../../../src/core/boards.ts';
import { roomHue } from '../../hud/model.ts';
import type { TabProps } from '../types.ts';
import { blockedWords, bucketLabel, milestoneShare, milestoneWords, roomName, seriesSpan, tickLabel } from './boardsModel.ts';
import { Bars, ChartWords, Line, Meter, Numbers, Stat } from './charts.tsx';
import { formatNumber, lineWords } from './chartsModel.ts';
import { roomsOf } from './parts.tsx';

export function ProgressBoard({ props, now }: { props: TabProps; now: number }) {
  const { snapshot, company, navigate } = props;
  const board = useMemo(() => progressBoard(company, now), [company, now]);
  const rooms = roomsOf(snapshot);
  const id = useId();

  if (!board.goal && company.tasks.length === 0) return <p className="board-empty db-card">No goal yet. The CEO sets one when the company starts.</p>;

  const c = board.counts;
  const waiting = board.waitingForYou;
  const roomItems = board.rooms.map((r) => ({
    key: r.room ?? 'left',
    label: roomName(r.room, rooms),
    value: r.counts.done,
    shown: formatNumber(r.counts.done),
    hue: r.room === null ? '#8c948f' : roomHue(snapshot, r.room),
  }));
  const done = board.done;
  const span = seriesSpan(done);
  const linePoints = done.points.map((p) => ({ key: String(p.at), value: p.value, tick: tickLabel(p.at, done.step, now, span), label: bucketLabel(p.at, done.step, now) }));

  const stats = (
    <div className="board-stats">
      <Stat value={formatNumber(c.done)} unit={c.total > 0 ? `of ${formatNumber(c.total)}` : undefined} title="Tasks done" />
      <Stat value={formatNumber(c.working)} title="Working" />
      <Stat value={formatNumber(c.blocked)} title="Blocked" />
      <Stat
        value={formatNumber(waiting)}
        title="Waiting for you"
        needs={waiting > 0}
        note={
          waiting > 0 ? (
            <button type="button" className="link" data-focus="dashboards:inbox" onClick={() => navigate('inbox', { replace: true })}>
              Open the inbox
            </button>
          ) : undefined
        }
      />
    </div>
  );

  const goal = (
    <section className="board-section db-card db-c7" aria-labelledby={`${id}-goal`}>
      <h4 id={`${id}-goal`} className="board-section__title">
        The goal
      </h4>
      <p className="board-goal">{board.goal ? board.goal.text : 'No goal yet. The CEO sets one when the company starts.'}</p>
      {board.milestones.length === 0 ? (
        <p className="board-quiet">No milestones yet.</p>
      ) : (
        <ul className="board-milestones" aria-label="Milestones">
          {board.milestones.map((m) => (
            <li key={m.id} className="board-milestone">
              <span className="board-milestone__title">{m.title}</span>
              <Meter share={milestoneShare(m)} words={milestoneWords(m, now)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const byRoom = (
    <section className="board-section db-card db-c5" aria-labelledby={`${id}-rooms`}>
      <h4 id={`${id}-rooms`} className="board-section__title">
        Tasks done per room
      </h4>
      {roomItems.length === 0 ? (
        <p className="board-quiet">No tasks yet.</p>
      ) : (
        <>
          <Bars items={roomItems} />
          <Numbers
            table={{
              caption: 'Tasks per room',
              columns: ['Room', 'Done', 'Not done yet'],
              numeric: [false, true, true],
              rows: board.rooms.map((r) => ({ key: r.room ?? 'left', cells: [roomName(r.room, rooms), formatNumber(r.counts.done), formatNumber(r.counts.total - r.counts.done)] })),
            }}
          />
        </>
      )}
    </section>
  );

  const blocked = (
    <section className="board-section db-card db-c4" aria-labelledby={`${id}-blocked`}>
      <h4 id={`${id}-blocked`} className="board-section__title">
        Blocked, and why
      </h4>
      {board.blocked.length === 0 ? (
        <p className="board-quiet">Nothing is blocked.</p>
      ) : (
        <ul className="board-blocked">
          {board.blocked.map((b) => {
            const words = blockedWords(b, company.people, now);
            return (
              <li key={b.id} className="board-blocked__item">
                <button type="button" className="link board-blocked__title" data-focus={`dashboards:task:${b.id}`} onClick={() => navigate(`tasks/${encodeURIComponent(b.id)}`)}>
                  {b.title}
                </button>
                <span className="board-blocked__who">{words.who}</span>
                <span className="board-blocked__why">{words.why}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const overTime = linePoints.length > 0 && (
    <section className="board-section db-card db-c8" aria-labelledby={`${id}-over-time`}>
      <h4 id={`${id}-over-time`} className="board-section__title">
        Tasks done over time
      </h4>
      <Line points={linePoints} format={formatNumber} whole />
      <ChartWords>{lineWords(linePoints.map((p) => ({ label: p.tick, value: p.value })))}</ChartWords>
      <Numbers
        table={{
          caption: 'Tasks done over time',
          columns: ['Time', 'Done by then'],
          numeric: [false, true],
          rows: linePoints.map((p) => ({ key: p.key, cells: [p.label, formatNumber(p.value)] })),
        }}
      />
    </section>
  );

  return (
    <div className="board board--progress db-grid">
      <h3 className="visually-hidden">Progress</h3>
      {stats}
      {goal}
      {byRoom}
      {overTime}
      {blocked}
    </div>
  );
}
