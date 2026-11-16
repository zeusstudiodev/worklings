// The Now tab: what each person is trying to get done, for which request, whether they need you and what they
// reported (docs/design.md, "The Now tab"). Built by nowBoard from what the office already has, so it costs nothing.
import { type FocusEvent, type ReactNode, useLayoutEffect, useRef } from 'react';
import type { NowBoard, NowRow } from '../../../src/core/now.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { clock, dollars, hourMinute } from '../lib/format.ts';
import { personHue, STATE_TONE } from './model.ts';
import { WaitingForSessions } from './States.tsx';

/**
 * Focuses the name of a person's row, or the fold's summary if the row is folded away inside it. Returns false when
 * the row isn't on the tab.
 */
export function focusRow(root: ParentNode, key: string, scroll: boolean): boolean {
  const name = root.querySelector<HTMLElement>(`[data-now-key="${CSS.escape(key)}"]`);
  const fold = name?.closest('details');
  const target = fold && !fold.open ? fold.querySelector('summary') : name;
  target?.focus({ preventScroll: !scroll });
  return Boolean(target);
}

/** Opens the conversation with someone, from the Ask button that was pressed (focus goes back to it on close). */
type OnAsk = (key: string, opener: HTMLElement) => void;

/** A goal short enough for a button's name: its first eight words. */
const gist = (goal: string) => {
  const words = goal.split(' ');
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : goal;
};

/** Rows grouped by what `say` says of them. */
function alike(rows: NowRow[], say: (r: NowRow) => string): NowRow[][] {
  const groups = new Map<string, NowRow[]>();
  for (const r of rows) groups.set(say(r), [...(groups.get(say(r)) ?? []), r]);
  return [...groups.values()];
}

/**
 * When calls of one role have the same goal too, the time each started tells them apart: "2:02 PM", to the second when
 * two started in the same minute, and numbered in the order they started when even that ties (calls the lead made
 * together). Keyed by row.
 */
function startTimes(rows: NowRow[], snapshot: Snapshot): Map<string, string> {
  const startedAt = new Map(snapshot.agents.map((a) => [a.key, a.startedAt]));
  const at = (r: NowRow) => startedAt.get(r.key) ?? 0;
  const times = new Map<string, string>();
  for (const group of alike(rows, (r) => `${r.called}\n${r.goal ?? ''}`)) {
    if (group.length < 2) continue;
    const time = alike(group, (r) => hourMinute(at(r))).length < group.length ? clock : hourMinute;
    for (const same of alike(group, (r) => time(at(r)))) {
      same.sort((x, y) => at(x) - at(y) || x.key.localeCompare(y.key));
      same.forEach((r, i) => times.set(r.key, same.length > 1 ? `${time(at(r))}, ${i + 1} of ${same.length}` : time(at(r))));
    }
  }
  return times;
}

interface RowProps {
  row: NowRow;
  hue: string;
  shared: ReadonlySet<string>;
  /** When the call started, for calls that share their name and their goal. */
  started: string | undefined;
  onOpen: (key: string) => void;
  onAsk?: OnAsk;
}

function Row({ row, hue, shared, started, onOpen, onAsk }: RowProps) {
  const tone = STATE_TONE[row.state.kind];
  const waits = row.state.kind === 'needs-ok' || row.state.kind === 'needs-answer';
  // Calls of one role share a name: the goal tells them apart, and when that ties too, when each started; both go in
  // the name's description and in Ask's name.
  const goalId = `now-goal-${row.key}`;
  const stateId = `now-state-${row.key}`;
  const startedId = `now-started-${row.key}`;
  const about = shared.has(row.called) && row.goal ? ` about ${gist(row.goal)}` : '';
  const askName = `Ask ${row.called}${about}${started ? `, started ${started}` : ''}`;
  const described = [row.goal ? goalId : stateId, started ? startedId : null].filter(Boolean).join(' ');
  return (
    <li className="now-row" style={{ ['--hue' as string]: hue }}>
      <span className="now-row__marker" aria-hidden="true" />
      <div className="now-row__main">
        <div className="now-row__head">
          {/* The name is the row's one button; it stretches over the whole row, so the row is the click target. */}
          <button type="button" className="now-row__name" data-now-key={row.key} aria-describedby={described} onClick={() => onOpen(row.key)}>
            {row.name}
          </button>
          <span className="now-row__cost">{dollars(row.cost)}</span>
        </div>
        {started && (
          <span id={startedId} className="visually-hidden">
            Started {started}.
          </span>
        )}
        {row.goal && <p id={goalId} className="now-row__goal">{row.goal}</p>}
        {row.request && <p className="now-row__request">{row.request}</p>}
        {/* Waiting on you is marked like the headline's sentence, in ink: the words say it once. */}
        <p id={stateId} className={waits ? 'now-row__status now-row__status--needs' : `now-row__status status--${tone}`}>
          {waits ? <span className="now__needs">{row.status}</span> : row.status}
        </p>
        {row.result && <p className={row.state.kind === 'stuck' ? 'now-row__error' : 'now-row__result'}>{row.result}</p>}
        {row.facts.length > 0 && <p className="now-row__facts">{row.facts.map((f) => `${f}.`).join(' ')}</p>}
        {onAsk && (
          <button type="button" className="link now-row__ask" data-ask={`now:${row.key}`} aria-label={askName} onClick={(e) => onAsk(row.key, e.currentTarget)}>
            Ask
          </button>
        )}
      </div>
    </li>
  );
}

interface RowsProps {
  snapshot: Snapshot;
  rows: NowRow[];
  /** Names more than one row has: those rows' Ask buttons add the goal. */
  shared: ReadonlySet<string>;
  /** Start times of calls whose name and goal both tie (see startTimes). */
  started: ReadonlyMap<string, string>;
  onOpen: (key: string) => void;
  onAsk?: OnAsk;
}

function Rows({ snapshot, rows, shared, started, onOpen, onAsk }: RowsProps) {
  return (
    <ul className="now-rows">
      {rows.map((r) => <Row key={r.key} row={r} hue={personHue(snapshot, r)} shared={shared} started={started.get(r.key)} onOpen={onOpen} onAsk={onAsk} />)}
    </ul>
  );
}

function Group({ id, title, ...list }: RowsProps & { id: string; title: string }) {
  if (list.rows.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="group-title">{title}</h3>
      <Rows {...list} />
    </section>
  );
}

interface Props {
  snapshot: Snapshot;
  board: NowBoard;
  /** While the connection is down: the office time the view stopped at. */
  stoppedAt: number | null;
  onOpen: (key: string) => void;
  onAsk?: OnAsk;
  /** Catch me up, which sits under the headline once a session has reported in. */
  catchUp?: ReactNode;
}

export function NowTab({ snapshot, board, stoppedAt, onOpen, onAsk, catchUp }: Props) {
  const root = useRef<HTMLDivElement>(null);
  // The row whose name has focus. A row that changes group is a new element to React, so focus would drop to the page.
  const focused = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = focused.current;
    if (!key || !root.current || (document.activeElement && document.activeElement !== document.body)) return;
    if (!focusRow(root.current, key, false)) focused.current = null;
  });
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    focused.current = e.target instanceof HTMLElement ? (e.target.dataset.nowKey ?? null) : null;
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    // A row taken out of the page blurs while detached: keep it, to put focus back once it is drawn again.
    const within = e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget);
    if (e.target.isConnected && !within) focused.current = null;
  };

  const noSessions = snapshot.mode === 'live' && snapshot.sessions.length === 0;
  const [first, ...rest] = board.headline;
  const earlier = board.earlier.rows.length + board.earlier.more;
  const all = [...board.needsYou, ...board.onIt, ...board.done, ...board.earlier.rows];
  const shared = new Set(alike(all, (r) => r.called).filter((group) => group.length > 1).flat().map((r) => r.called));
  const common = { snapshot, shared, started: startTimes(all, snapshot), onOpen, onAsk };
  return (
    <div className="now" ref={root} onFocus={onFocus} onBlur={onBlur}>
      {stoppedAt !== null && <p className="note now__stopped">Reconnecting to the office. This is how things stood at {hourMinute(stoppedAt)}.</p>}
      <p className="now__headline">
        {board.needsYou.length > 0 ? (
          <>
            <span className="now__needs">{first}</span> {rest.join(' ')}
          </>
        ) : (
          board.headline.join(' ')
        )}
      </p>
      {noSessions ? <WaitingForSessions snapshot={snapshot} /> : catchUp}
      <Group id="now-needs" title="Needs you" {...common} rows={board.needsYou} />
      <Group id="now-on-it" title="On it" {...common} rows={board.onIt} />
      <Group id="now-done" title="Done in the last 15 minutes" {...common} rows={board.done} />
      {earlier > 0 && (
        <details className="now-fold">
          <summary>{earlier} {earlier === 1 ? 'person' : 'people'} worked earlier</summary>
          <Rows {...common} rows={board.earlier.rows} />
          {board.earlier.more > 0 && <p className="rows__more">{board.earlier.more} more. The payroll counts them all.</p>}
        </details>
      )}
    </div>
  );
}
