// The decision log (SPEC-v3.md "Steering" 5) at `decisions`, or `decisions/<id>` opened on one entry: filters by person,
// room and kind; each decision with who, when, what, why, the alternatives and its links; Undo where it can be taken
// back, in the office's undo pattern (at once, then "Undone. Undo" in place); Reconsider with a note to whoever made it.
// Over the map it is the Dashboards board's Decisions (`inBoard`): a list of what was decided with its filters in a column
// beside it, each decision opening in the side panel, where the whole entry is (docs/design-v3.md, "Dashboards at full width").
import { type FormEvent, type KeyboardEvent, type MouseEvent, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { type Decision, DECISION_LIMITS } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { reconnectingLine } from '../model.ts';
import { useCompanyClock } from '../people/clock.ts';
import { companyHref, navigate as goTo, parseCompanyAddress, useLocation } from '../router.ts';
import { Clamp, CompanyLink, refusalOf } from '../people/shared.tsx';
import { boxCount } from '../person/personModel.ts';
import type { TabProps } from '../types.ts';
import { focusAfterLeaving } from '../ui/handOn.ts';
import { UndoLine } from '../ui/UndoLine.tsx';
import { useReached } from '../ui/useReached.ts';
import {
  byDay,
  countLine,
  DECISION_PAGE,
  type DecisionEntry,
  decisionEntry,
  type DecisionFilter,
  type DecisionNote as Note,
  filterChoices,
  filterDecisions,
  isFiltered,
  moreLine,
  NO_DECISIONS,
  NO_FILTER,
  NONE_MATCH,
  noteEnds,
  noteView,
  redoOf,
  shownCount,
  validFilter,
} from './decisionsModel.ts';
import './decisions.css';

type Props = TabProps & { decision?: string | null; inBoard?: boolean };

/** "Undone. Undo" stays this long, as office changes do. */
const UNDO_WINDOW_MS = 10_000;

export function Decisions(props: Props) {
  if (!props.company.steering) return <NoLog inBoard={props.inBoard === true} />;
  return <DecisionLog {...props} decisions={props.company.steering.decisions} />;
}

function NoLog({ inBoard }: { inBoard: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!inBoard) heading.current?.focus({ preventScroll: true });
  }, [inBoard]);
  if (inBoard) return <p className="decisions__empty db-card">This office doesn't keep a decision log yet.</p>;
  return (
    <article className="decisions">
      <h2 ref={heading} className="panel-title" tabIndex={-1} data-panel-heading>
        Decisions
      </h2>
      <p className="decisions__empty">This office doesn't keep a decision log yet.</p>
    </article>
  );
}

function DecisionLog({ snapshot, company, companyId, navigate, announce, online, steer, decision = null, inBoard = false, decisions }: Props & { decisions: readonly Decision[] }) {
  const now = useCompanyClock(snapshot.serverTime, online);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const busy = useRef(new Set<string>());
  const [rawFilter, setFilter] = useState<DecisionFilter>(NO_FILTER);
  const [pages, setPages] = useState(1);
  const [reconsidering, setReconsidering] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const location = useLocation();
  const panel = parseCompanyAddress(location.path, location.search)?.route.panel ?? null;
  const openDecision = panel?.kind === 'decision' ? panel.decision : null;

  const choices = filterChoices(snapshot, company, decisions);
  const filter = validFilter(rawFilter, choices);
  const filtered = filterDecisions(decisions, filter);
  const shown = filtered.slice(0, shownCount(filtered, pages, decision));
  const left = filtered.length - shown.length;
  const offline = online ? null : reconnectingLine(snapshot.serverTime);

  // Opened on one decision: it scrolls into view and takes focus; otherwise the heading does.
  useEffect(() => {
    const target = decision ? list.current?.querySelector<HTMLElement>(`[data-decision="${CSS.escape(decision)}"] .decision__what`) : null;
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
    } else if (!inBoard) heading.current?.focus({ preventScroll: true });
  }, [decision, inBoard]);

  const choose = (change: Partial<DecisionFilter>) => {
    const next = { ...filter, ...change };
    setFilter(next);
    setPages(1);
    const matched = filterDecisions(decisions, next).length;
    announce(matched === 0 ? NONE_MATCH : countLine(matched, decisions.length, isFiltered(next)));
  };

  const more = () => {
    const firstNew = filtered[shown.length]?.id;
    flushSync(() => setPages((p) => Math.max(p, Math.ceil(shown.length / DECISION_PAGE)) + 1));
    if (firstNew) list.current?.querySelector<HTMLElement>(`[data-decision="${CSS.escape(firstNew)}"] .decision__what`)?.focus();
  };

  const note = (decisionId: string, value: Note | null) =>
    setNotes((all) => {
      const next = { ...all };
      if (value) next[decisionId] = value;
      else delete next[decisionId];
      return next;
    });

  const undo = async (entry: DecisionEntry) => {
    if (!steer || !online || busy.current.has(entry.id)) return;
    busy.current.add(entry.id);
    note(entry.id, { kind: 'busy', text: 'Undoing…' });
    try {
      await steer.undoDecision(entry.id);
      note(entry.id, { kind: 'undone', text: 'Undone.', until: Date.now() + UNDO_WINDOW_MS });
      announce(`Undone: ${entry.what}`);
    } catch (error) {
      const text = `Couldn't undo it: ${refusalOf(error)}`;
      note(entry.id, { kind: 'failed', text });
      announce(text);
    } finally {
      busy.current.delete(entry.id);
    }
  };

  // Undo under "Undone." takes the undo back, once the stream says which decision it was.
  const redo = async (entry: DecisionEntry) => {
    const undoId = redoOf(decisions, entry.id);
    if (!steer || !online || !undoId || busy.current.has(entry.id)) return;
    busy.current.add(entry.id);
    try {
      await steer.undoDecision(undoId);
      note(entry.id, { kind: 'redone', text: 'Put back as it was.' });
      announce(`Put back: ${entry.what}`);
    } catch (error) {
      const text = `Couldn't put it back: ${refusalOf(error)}`;
      note(entry.id, { kind: 'failed', text });
      announce(text);
    } finally {
      busy.current.delete(entry.id);
    }
  };

  const reconsider = async (entry: DecisionEntry, text: string): Promise<boolean> => {
    if (!steer || !online || !entry.reconsiderTo || busy.current.has(entry.id)) return false;
    busy.current.add(entry.id);
    try {
      await steer.reconsider(entry.id, text);
      const sent = `Sent to ${entry.reconsiderTo.name}, citing this decision.`;
      note(entry.id, { kind: 'sent', text: sent });
      announce(sent);
      return true;
    } catch (error) {
      const why = `Couldn't send it: ${refusalOf(error)}`;
      note(entry.id, { kind: 'failed', text: why });
      announce(why);
      return false;
    } finally {
      busy.current.delete(entry.id);
    }
  };

  const filtering = isFiltered(filter);
  const clear = (
    <>
      {filtering && (
        <>
          {' '}
          <button type="button" className="link decisions__clear" onClick={() => choose(NO_FILTER)}>
            Clear the filters
          </button>
        </>
      )}
    </>
  );

  if (inBoard) {
    return (
      <div className="board board--decisions db-split">
        <h3 className="visually-hidden">Decisions</h3>
        {decisions.length > 0 && (
          <div className="decisions__filters db-card db-split__side" role="group" aria-label="Filter the decisions">
            <FilterSelect id={`${id}-who`} label="Who" any="Anyone" value={filter.who} choices={choices.who} onChange={(who) => choose({ who })} />
            <FilterSelect id={`${id}-room`} label="Room" any="Every room" value={filter.room} choices={choices.rooms} onChange={(room) => choose({ room })} />
            <FilterSelect id={`${id}-kind`} label="Kind" any="Every kind" value={filter.kind} choices={choices.kinds} onChange={(kind) => choose({ kind })} />
            <p className="decisions__count">
              {filtered.length === 0 ? NONE_MATCH : countLine(filtered.length, decisions.length, filtering)}
              {clear}
            </p>
          </div>
        )}
        <div ref={list} className="db-card db-split__list">
          {decisions.length === 0 ? (
            <p className="decisions__empty">{NO_DECISIONS}</p>
          ) : (
            <>
              {offline && steer && <p className="decisions__offline">{offline} Undo and Reconsider wait until it's back.</p>}
              {byDay(shown, now).map((day) => (
                <section key={day.heading} className="decisions__day" aria-label={day.heading}>
                  <h4 className="group-title">{day.heading}</h4>
                  <ol className="decision-list">
                    {day.decisions.map((d) => (
                      <BoardEntry key={d.id} entry={decisionEntry(company, d, now)} href={companyHref(companyId, { main: { kind: 'decisions' }, panel: { kind: 'decision', decision: d.id } })} open={openDecision === d.id} />
                    ))}
                  </ol>
                </section>
              ))}
              {left > 0 && (
                <button type="button" className="button decisions__more" onClick={more}>
                  {moreLine(left)}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <article className="decisions" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={heading} className="panel-title" tabIndex={-1} data-panel-heading>
        Decisions
      </h2>
      <p className="decisions__intro">Who decided what in the company, when and why.</p>
      {decision && !decisions.some((d) => d.id === decision) && <p className="decisions__gone">That decision isn't in the log any more: it keeps the latest 300.</p>}

      {decisions.length === 0 ? (
        <p className="decisions__empty">{NO_DECISIONS}</p>
      ) : (
        <>
          <div className="decisions__filters" role="group" aria-label="Filter the decisions">
            <FilterSelect id={`${id}-who`} label="Who" any="Anyone" value={filter.who} choices={choices.who} onChange={(who) => choose({ who })} />
            <FilterSelect id={`${id}-room`} label="Room" any="Every room" value={filter.room} choices={choices.rooms} onChange={(room) => choose({ room })} />
            <FilterSelect id={`${id}-kind`} label="Kind" any="Every kind" value={filter.kind} choices={choices.kinds} onChange={(kind) => choose({ kind })} />
          </div>
          <p className="decisions__count">
            {filtered.length === 0 ? NONE_MATCH : countLine(filtered.length, decisions.length, filtering)}
            {clear}
          </p>
          {offline && steer && <p className="decisions__offline">{offline} Undo and Reconsider wait until it's back.</p>}

          <div ref={list}>
            {byDay(shown, now).map((day) => (
              <section key={day.heading} className="decisions__day" aria-label={day.heading}>
                <h3 className="group-title">{day.heading}</h3>
                <ol className="decision-list">
                  {day.decisions.map((d) => (
                    <Entry
                      key={d.id}
                      entry={decisionEntry(company, d, now)}
                      focused={d.id === decision}
                      companyId={companyId}
                      navigate={navigate}
                      steering={steer !== undefined}
                      online={online}
                      note={notes[d.id] ?? null}
                      canRedo={redoOf(decisions, d.id) !== null}
                      reconsidering={reconsidering === d.id}
                      onUndo={(entry) => void undo(entry)}
                      onRedo={(entry) => void redo(entry)}
                      onReconsider={(open) => setReconsidering(open ? d.id : null)}
                      onSendReconsider={reconsider}
                      onNoteGone={() => note(d.id, null)}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
          {left > 0 && (
            <button type="button" className="button decisions__more" onClick={more}>
              {moreLine(left)}
            </button>
          )}
        </>
      )}
    </article>
  );
}

/** A decision as a row of the board: what, who and when, the first of its why; it opens in the side panel, whole. */
function BoardEntry({ entry, href, open }: { entry: DecisionEntry; href: string; open: boolean }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goTo(href);
  };
  return (
    <li className={`decision decision--row${open ? ' is-open' : ''}${entry.undone ? ' is-undone' : ''}`} data-decision={entry.id}>
      <h5 className="decision__what" tabIndex={-1}>
        <a className="decision__open" href={href} aria-current={open ? 'true' : undefined} onClick={follow}>
          {entry.what}
        </a>
      </h5>
      <p className="decision__meta">
        <span className="decision__tag">{entry.tag}</span> {entry.by}
      </p>
      {entry.why && <Clamp text={entry.why} lines={2} className="decision__why-text" />}
      {entry.undone && <p className="decision__state">{entry.undone.text}</p>}
    </li>
  );
}

function FilterSelect({ id, label, any, value, choices, onChange }: { id: string; label: string; any: string; value: string; choices: readonly { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="decisions__filter">
      <label className="decisions__filter-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="select-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{any}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface EntryProps {
  entry: DecisionEntry;
  focused: boolean;
  companyId: string;
  navigate: TabProps['navigate'];
  steering: boolean;
  online: boolean;
  note: Note | null;
  canRedo: boolean;
  reconsidering: boolean;
  onUndo: (entry: DecisionEntry) => void;
  onRedo: (entry: DecisionEntry) => void;
  onReconsider: (open: boolean) => void;
  onSendReconsider: (entry: DecisionEntry, text: string) => Promise<boolean>;
  onNoteGone: () => void;
}

function Entry({ entry, focused, companyId, navigate, steering, online, note, canRedo, reconsidering, onUndo, onRedo, onReconsider, onSendReconsider, onNoteGone }: EntryProps) {
  const id = useId();
  const reconsiderButton = useRef<HTMLButtonElement>(null);
  const noteLine = useRef<HTMLParagraphElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const busy = note?.kind === 'busy';
  const showUndo = steering && entry.canUndo && note?.kind !== 'undone';
  const showReconsider = steering && entry.reconsiderTo !== null && !reconsidering;
  // "Undone." ends with its undo window, whether or not the undo can itself be undone; then the entry's own "Undone by
  // you at 14:40." says it, and the note leaves the log's state too.
  const ends = noteEnds(note);
  const reached = useReached(ends);
  const shown = noteView(note, canRedo, ends !== null && reached);
  const dropNote = useEffectEvent(onNoteGone);
  useEffect(() => {
    if (ends === null || !reached) return;
    const id = window.setTimeout(dropNote, 0);
    return () => window.clearTimeout(id);
  }, [ends, reached]);
  // The plain line can have focus as it leaves: focus moves on to the entry, never to the page (as an UndoLine's does).
  const lineRef = (el: HTMLParagraphElement | null) => {
    noteLine.current = el;
    if (!el) return undefined;
    return () => {
      noteLine.current = null;
      if (document.activeElement === el) queueMicrotask(focusAfterLeaving(el));
    };
  };

  // A press's result takes focus where the button it came from went away.
  useEffect(() => {
    if (note?.kind === 'undone') {
      // "Undone." has no Undo until the stream says which decision it was (no disabled Undo waits out its window): the
      // line takes focus, and the Undo does once it comes, if focus hasn't gone elsewhere.
      const at = document.activeElement;
      const free = !at || at === document.body || at === noteLine.current || !at.isConnected;
      if (canRedo && free) undoButton.current?.focus({ preventScroll: true });
      else if (!canRedo) noteLine.current?.focus({ preventScroll: true });
    } else if (note?.kind === 'sent' || note?.kind === 'redone') noteLine.current?.focus({ preventScroll: true });
  }, [note?.kind, canRedo]);

  return (
    <li className={`decision${focused ? ' is-focused' : ''}${entry.undone ? ' is-undone' : ''}`} data-decision={entry.id} data-undo-item>
      <h4 id={`${id}-what`} className="decision__what" tabIndex={-1}>
        {entry.what}
      </h4>
      <p className="decision__meta">
        <span className="decision__tag">{entry.tag}</span> {entry.by}
      </p>
      {entry.why && (
        <div className="decision__why">
          <p className="decision__label">Why</p>
          <Clamp text={entry.why} lines={3} className="decision__why-text" />
        </div>
      )}
      {entry.alternatives.length > 0 && (
        <div className="decision__alts">
          <p className="decision__label">Other options weighed</p>
          <ul className="decision__alt-list">
            {/* The alternatives are a fixed list the decider wrote, never reordered: place and words name each. */}
            {entry.alternatives.map((a, i) => (
              <li key={`${i}:${a}`}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {entry.links.length > 0 && (
        <ul className="decision__links" aria-label="What it links to">
          {entry.links.map((l) => (
            <li key={l.key}>
              <CompanyLink companyId={companyId} to={l.path} navigate={navigate} className="link" focusKey={`decision:${entry.id}:${l.key}`}>
                {l.label}
              </CompanyLink>
            </li>
          ))}
        </ul>
      )}
      {entry.undone && (
        <p className="decision__state">
          {entry.undone.text}{' '}
          <CompanyLink companyId={companyId} to={entry.undone.path} navigate={navigate} className="link" focusKey={`decision:${entry.id}:undo`}>
            The undo
          </CompanyLink>
        </p>
      )}
      {entry.reconsidered && (
        <p className="decision__state">
          {entry.reconsidered.text}{' '}
          <CompanyLink companyId={companyId} to={entry.reconsidered.path} navigate={navigate} className="link" focusKey={`decision:${entry.id}:reconsider`}>
            Where it went
          </CompanyLink>
        </p>
      )}

      {(showUndo || showReconsider) && (
        <div className="decision__actions">
          {showUndo && (
            <button type="button" className="button" aria-describedby={`${id}-what`} aria-disabled={!online || busy || undefined} onClick={() => onUndo(entry)}>
              {busy ? 'Undoing…' : 'Undo'}
            </button>
          )}
          {showReconsider && (
            <button
              ref={reconsiderButton}
              type="button"
              className="button"
              aria-describedby={`${id}-what`}
              aria-disabled={!online || busy || undefined}
              onClick={() => {
                if (online && !busy) onReconsider(true);
              }}
            >
              Reconsider
            </button>
          )}
        </div>
      )}

      {reconsidering && entry.reconsiderTo && (
        <ReconsiderForm
          entry={entry}
          online={online}
          onSend={async (text) => {
            const ok = await onSendReconsider(entry, text);
            if (ok) onReconsider(false);
            return ok;
          }}
          onCancel={() => {
            flushSync(() => onReconsider(false));
            reconsiderButton.current?.focus();
          }}
        />
      )}

      {shown === 'undo-line' && note?.kind === 'undone' ? (
        <UndoLine text={note.text} until={note.until} onUndo={() => onRedo(entry)} unavailable={!online} ref={undoButton} />
      ) : (
        shown === 'line' &&
        note && (
          <p ref={lineRef} className={`decision__note decision__note--${note.kind}`} tabIndex={-1}>
            {note.text}
          </p>
        )
      )}
    </li>
  );
}

function ReconsiderForm({ entry, online, onSend, onCancel }: { entry: DecisionEntry; online: boolean; onSend: (text: string) => Promise<boolean>; onCancel: () => void }) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const count = boxCount(text, DECISION_LIMITS.note);
  const words = text.trim();
  const name = entry.reconsiderTo?.name ?? 'them';
  useEffect(() => box.current?.focus(), []);

  const send = async () => {
    if (!online || !words || count.over || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await onSend(words);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <form className="decision__reconsider" onSubmit={submit}>
      <label className="decision__label" htmlFor={`${id}-note`}>
        What should {name} reconsider?
      </label>
      <textarea
        id={`${id}-note`}
        ref={box}
        className={`prose-input decision__box${count.over ? ' is-over' : ''}`}
        rows={3}
        value={text}
        aria-describedby={`${id}-hint`}
        aria-invalid={count.over || undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <p id={`${id}-hint`} className="decision__hint">
        {capital(name)} gets it as a message that cites this decision.
        {count.text && <span className={count.over ? ' is-over' : ''}> {count.text}</span>}
      </p>
      <div className="decision__form-buttons">
        <button type="submit" className="button button--primary" aria-disabled={!online || !words || count.over || busy || undefined}>
          {busy ? 'Sending…' : `Send to ${name}`}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
