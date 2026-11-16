// The Dashboards board over the map (docs/design-v3.md, "Dashboards at full width"; docs/design-hud.md, "Dashboards"): a
// rail of Progress, Spend, Timeline and Decisions with the CEO's dashboards under "Made by the CEO" and "Ask the CEO for a
// dashboard" at its foot, then the board on a 12-column grid (8 under 1100 px of board; under 640 the rail is a picker).
// The decision log is the board's sub-view (`decisions`), each decision opening in the side panel. Asking the CEO is the
// talk bar's: its To becomes the CEO with the words started. Boards draw from src/core/boards.ts, so they agree with the
// rest of the office. BoardFrame gives the head, the way back and the row under it.
import { type MouseEvent, useEffect, useId, useRef, useState } from 'react';
import type { SpendRangeId } from '../../../../src/core/boards.ts';
import { type CompanyView, type PersonView } from '../../../../src/core/company.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute } from '../../lib/format.ts';
import { useMediaQuery } from '../../lib/hooks.ts';
import { Decisions } from '../decisions/Decisions.tsx';
import { useCompanyClock } from '../people/clock.ts';
import { companyHref, navigate, parseCompanyAddress, type PanelView, useLocation } from '../router.ts';
import { BoardFrame } from '../shell/BoardFrame.tsx';
import type { BoardProps } from '../types.ts';
import { UndoLine } from '../ui/UndoLine.tsx';
import { ASK_FOR_DASHBOARD, askToChange, atWords, type Board, boardChoices, chooseBoard, DEFAULT_FILTER, refusedNote, type TimelineFilter } from './boardsModel.ts';
import { CeoBoard } from './CeoBoard.tsx';
import { ProgressBoard } from './ProgressBoard.tsx';
import { clearRemoval, finishedIn, type Removal, startRemoval, undoRemoval, useFinishedRemoval, useRemoval } from './removal.ts';
import { SpendBoard } from './SpendBoard.tsx';
import { TimelineBoard } from './TimelineBoard.tsx';
import './dashboards.css';

const REMEMBER_KEY = 'worklings-dashboard';
const DECISIONS = 'decisions';

/** The board this browser viewed last in a company. */
function remembered(companyId: string): string | null {
  try {
    return localStorage.getItem(`${REMEMBER_KEY}:${companyId}`);
  } catch {
    // Storage can be switched off: the board opens on Progress.
    return null;
  }
}

function remember(companyId: string, board: string) {
  try {
    localStorage.setItem(`${REMEMBER_KEY}:${companyId}`, board);
  } catch {
    // Not remembered where storage is switched off; the board still shows while it is open.
  }
}

const ceoOf = (company: Pick<CompanyView, 'people'>): PersonView | undefined => company.people.find((p) => p.level === 'ceo');

/** The app's own navigation for a plain press on a link; the browser's for a new tab or window. */
function follow(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}

export function DashboardsBoard(props: BoardProps) {
  const { view, snapshot, company, companyId, actions, announce, online, talk } = props;
  const phone = useMediaQuery('(max-width: 720px), (max-height: 480px)');
  const location = useLocation();
  const panel = parseCompanyAddress(location.path, location.search)?.route.panel ?? null;
  const keep: PanelView | null = phone ? null : panel;
  const now = useCompanyClock(snapshot.serverTime, online);
  const selectId = useId();
  const groupId = useId();
  const [last] = useState(() => remembered(companyId));
  const inDecisions = view.kind === 'decisions';
  const requested = view.kind === 'dashboards' ? view.board : null;
  const { board, gone } = chooseBoard(requested, last, company.dashboards);
  const [range, setRange] = useState<SpendRangeId>('today');
  const [filter, setFilter] = useState<TimelineFilter>(DEFAULT_FILTER);
  const changeButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'undo' | 'remove' | 'rail' | null>(null);
  const announced = useRef<Removal | null>(null);
  const ceo = ceoOf(company);
  const choices = boardChoices(company.dashboards);
  const refused = refusedNote(company.log, company.dashboards);
  const removal = useRemoval(companyId, !inDecisions && board.kind === 'ceo' ? board.id : null);
  const finished = useFinishedRemoval(companyId);
  const holding = removal?.state ?? null;
  const failed = removal?.state === 'failed' ? removal : null;

  useEffect(() => {
    if (!inDecisions) remember(companyId, board.id);
  }, [companyId, board.id, inDecisions]);
  useEffect(
    () => () => {
      const done = finishedIn(companyId);
      if (done) clearRemoval(companyId, done.dashboard);
    },
    [companyId],
  );

  // Once the wait is over Undo goes, and focus with it: the board's list takes it, unless it went somewhere on purpose.
  useEffect(() => {
    if (holding !== 'sending' && holding !== 'done') return;
    const active = document.activeElement;
    if (!active || active === document.body || active === undoButton.current) focusNext.current = 'rail';
  }, [holding]);

  // A removed dashboard leaves the board on Progress, saying so, and the address follows.
  useEffect(() => {
    if (finished && requested === finished.dashboard) navigate(companyHref(companyId, { main: { kind: 'dashboards', board: 'progress' }, panel: keep }), { replace: true });
  }, [finished, requested, companyId, keep]);

  // A refused removal is said once through the live region; the board comes back with the reason under it.
  useEffect(() => {
    if (!failed || announced.current === failed) return;
    announced.current = failed;
    announce(`Couldn't remove “${failed.title}”. ${failed.problem ?? ''}`.trim());
  });

  // Focus moves once the view that holds its target is drawn: Undo after Remove, Remove after Undo, the list after.
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    const rail = [...document.querySelectorAll<HTMLElement>('[data-focus="dashboards:rail"], [data-focus="dashboards:select"]')].find((el) => el.checkVisibility());
    const el = want === 'undo' ? undoButton.current : want === 'remove' ? removeButton.current : (rail ?? null);
    if (!el) return;
    focusNext.current = null;
    el.focus();
  });

  const hrefOf = (id: string) =>
    id === DECISIONS ? companyHref(companyId, { main: { kind: 'decisions' }, panel: keep }) : companyHref(companyId, { main: { kind: 'dashboards', board: id }, panel: keep });

  const choose = (id: string) => {
    if (finished) clearRemoval(companyId, finished.dashboard);
    navigate(hrefOf(id));
  };

  const remove = () => {
    if (board.kind !== 'ceo' || !online) return;
    const id = board.id;
    if (startRemoval(companyId, { id, title: board.title }, () => actions.removeDashboard(id))) focusNext.current = 'undo';
  };

  const undo = () => {
    if (board.kind !== 'ceo' || !undoRemoval(companyId, board.id)) return;
    focusNext.current = 'remove';
  };

  const askCeo = (draft: string) => {
    if (ceo) talk.to({ kind: 'person', id: ceo.id }, { focus: true, draft });
  };

  const current = inDecisions ? DECISIONS : board.id;
  const title = inDecisions ? 'Decisions' : board.title;
  const summary = inDecisions || board.kind === 'built-in' ? `${title}, as of ${hourMinute(snapshot.serverTime)}.` : undefined;

  const key = (id: string, label: string) => (
    <a className="db-key" href={hrefOf(id)} aria-current={current === id ? 'page' : undefined} data-focus={current === id ? 'dashboards:rail' : undefined} onClick={(e) => follow(e, hrefOf(id))}>
      {label}
    </a>
  );

  const body = inDecisions ? (
    <Decisions {...props} inBoard decision={null} />
  ) : board.kind === 'ceo' && removal && removal.state !== 'failed' ? (
    <div className="board board--ceo board--removing">
      <h3 className="board-ceo__title">{board.title}</h3>
      <UndoLine ref={undoButton} text={removal.state === 'done' ? `Removed “${board.title}”.` : `Removing “${board.title}”.`} until={removal.state === 'waiting' ? removal.until : 0} onUndo={undo} />
    </div>
  ) : (
    <BoardView board={board} props={props} now={now} range={range} onRange={setRange} filter={filter} onFilter={setFilter} />
  );

  return (
    <BoardFrame title="Dashboards" {...(summary ? { summary } : {})}>
      <div className="db-scroll">
        <div className="db">
          <div className="db-side">
            <nav className="db-rail" aria-label="Dashboards">
              <ul className="db-rail__list">
                {choices.builtIn.map((c) => (
                  <li key={c.value}>{key(c.value, c.label)}</li>
                ))}
                <li>{key(DECISIONS, 'Decisions')}</li>
              </ul>
              {choices.ceo.length > 0 && (
                <>
                  <p id={groupId} className="db-rail__group">
                    Made by the CEO
                  </p>
                  <ul className="db-rail__list" aria-labelledby={groupId}>
                    {choices.ceo.map((c) => (
                      <li key={c.value}>{key(c.value, c.label)}</li>
                    ))}
                  </ul>
                </>
              )}
              {ceo && (
                <button type="button" className="db-key db-key--ask" data-focus="dashboards:ask" onClick={() => askCeo(ASK_FOR_DASHBOARD)}>
                  Ask the CEO for a dashboard
                </button>
              )}
            </nav>
            <div className="db-picker">
              <label className="db-picker__label" htmlFor={selectId}>
                Dashboard
              </label>
              <select id={selectId} className="db-picker__select" value={current} onChange={(e) => choose(e.target.value)} data-focus="dashboards:select">
                {choices.builtIn.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
                <option value={DECISIONS}>Decisions</option>
                {choices.ceo.length > 0 && (
                  <optgroup label="Made by the CEO">
                    {choices.ceo.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {ceo && (
                <button type="button" className="db-key db-key--ask" onClick={() => askCeo(ASK_FOR_DASHBOARD)}>
                  Ask the CEO for a dashboard
                </button>
              )}
            </div>
          </div>
          <div className="db-main">
            {refused && (
              <p className="board-refused db-note">
                {refused.text} <span className="board-refused__at">{capital(atWords(refused.at, now))}.</span>
              </p>
            )}
            {finished && current !== finished.dashboard ? (
              <p className="board-gone db-note">Removed “{finished.title}”.</p>
            ) : (
              gone && !inDecisions && <p className="board-gone db-note">That dashboard isn't here any more, so here is Progress.</p>
            )}
            {body}
            {!inDecisions && board.kind === 'ceo' && (!removal || removal.state === 'failed') && (
              <>
                <div className="board-ceo__foot">
                  {ceo && (
                    <button ref={changeButton} type="button" className="db-key db-key--line board-ceo__ask" onClick={() => askCeo(askToChange(board.title))}>
                      Ask the CEO to change it
                    </button>
                  )}
                  <button ref={removeButton} type="button" className="db-key db-key--line board-ceo__remove" aria-disabled={!online || undefined} onClick={remove}>
                    Remove this dashboard
                  </button>
                </div>
                {failed && (
                  <p className="board-ceo__problem">
                    Couldn't remove “{failed.title}”. {failed.problem}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </BoardFrame>
  );
}

interface BoardViewProps {
  board: Board;
  props: BoardProps;
  now: number;
  range: SpendRangeId;
  onRange: (range: SpendRangeId) => void;
  filter: TimelineFilter;
  onFilter: (filter: TimelineFilter) => void;
}

function BoardView({ board, props, now, range, onRange, filter, onFilter }: BoardViewProps) {
  if (board.kind === 'ceo') return <CeoBoard props={props} now={now} dashboard={board.dashboard} />;
  switch (board.id) {
    case 'spend':
      return <SpendBoard props={props} now={now} range={range} onRange={onRange} />;
    case 'timeline':
      return <TimelineBoard props={props} now={now} filter={filter} onFilter={onFilter} />;
    default:
      return <ProgressBoard props={props} now={now} />;
  }
}
