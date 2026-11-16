// The feed (docs/design-v3.md, "The feed"; build step 5): the company's conversation in order, oldest at the top, in a
// drawer the talk bar opens upward into (a sheet on phones). Your message and what follows from it hang on a rail,
// bursts fold, Who and Kind filter, a reply keeps its dot until it has been seen, what needs you is answered in place
// through the same store as the inbox, and "Show earlier lines" reaches back past the view. Its heading takes focus as
// it opens and "Jump to the new lines" leads to the New rule.
import { type KeyboardEvent, memo, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type CompanyView, STAKEHOLDER } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { hourMinute } from '../../lib/format.ts';
import { type AnswersState, type AnswerStore, useAnswers } from '../inbox/answers.ts';
import { InboxItem, type ItemFocus, useFocusGoal } from '../inbox/InboxItem.tsx';
import { allItems, type Item, itemId, itemView, type ItemView, undoUntil } from '../inbox/inboxModel.ts';
import { useCompanyClock, useSkew } from '../people/clock.ts';
import { Clamp } from '../people/shared.tsx';
import { faceOfId, Glyph, Paper } from '../talk/bits.tsx';
import type { CompanyActions, TabProps, TalkControl } from '../types.ts';
import { draftScope } from '../ui/draftScope.ts';
import { Face } from '../ui/Face.tsx';
import { type FeedLine, facesOf, foldBursts, NOTHING_SAID_FEED, EARLIER_NOT_KEPT, type Seg } from './feedModel.ts';
import {
  type FeedFilter,
  type FeedRow,
  filterLines,
  filterSentence,
  firstNewRow,
  isFiltered,
  KIND_LABELS,
  KINDS,
  NO_FILTER,
  parseFilter,
  rowsOf,
  unreadReply,
  whoCalled,
  whoOptions,
} from './feedView.ts';
import type { EarlierControl } from './useEarlier.ts';
import './feed.css';

interface Props {
  id: string;
  companyId: string;
  snapshot: Snapshot;
  /** The view, with the earlier pages in front of its messages. */
  company: CompanyView;
  actions: CompanyActions;
  /** Every line, bursts not yet folded, oldest first. */
  lines: readonly FeedLine[];
  /** Lines after this are new: the time you last closed the feed, as it was when it opened. */
  newFrom: number;
  /** A line to open at (a press on the strip). */
  at: string | null;
  now: number;
  online: boolean;
  phone: boolean;
  /** Under the side panel's sheet on a phone: out of reach until it goes. */
  covered: boolean;
  /** v2's Catch me up, in live offices. */
  catchUp: ReactNode;
  /** Asks for the digest when it changes: the "Catch me up" command. */
  catchUpAsk: number;
  earlier: Pick<EarlierControl, 'canAsk' | 'loading' | 'error' | 'ended' | 'added' | 'show'>;
  announce: TabProps['announce'];
  navigate: TabProps['navigate'];
  talk: TalkControl;
  onClose: () => void;
}

/** How near the foot counts as being at the foot, for new lines to scroll in by themselves. */
const AT_END_PX = 48;
/** A reply counts as seen once it has been on screen in the open feed this long. */
const SEEN_AFTER_MS = 1_000;

const filterKey = (scope: string) => `worklings-feed-filter:${scope}`;

function readFilter(scope: string): FeedFilter {
  try {
    const raw = window.sessionStorage.getItem(filterKey(scope));
    return raw ? parseFilter(JSON.parse(raw)) : NO_FILTER;
  } catch {
    return NO_FILTER;
  }
}

function writeFilter(scope: string, filter: FeedFilter): void {
  try {
    window.sessionStorage.setItem(filterKey(scope), JSON.stringify(filter));
  } catch {
    // Kept for this page where storage is switched off.
  }
}

export function Feed({ id, companyId, snapshot, company, actions, lines, newFrom, at, now: dockNow, online, phone, covered, catchUp, catchUpAsk, earlier, announce, navigate, talk, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const newRule = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const scope = draftScope(company);
  // Where it opened: the feed mounts each time it opens, and a later press doesn't move it.
  const [openedAt] = useState(at);
  const [filter, setFilterState] = useState<FeedFilter>(() => readFilter(scope));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const [waiting, setWaiting] = useState<string | null>(null);

  const skew = useSkew();
  const { store, state } = useAnswers(companyId, { company, actions, announce, online, skew });
  const setGoal = useFocusGoal(body);

  // Pressed items change by themselves when their undo window closes: the feed's own clock wakes then.
  const items = useMemo(() => new Map(allItems(company).map((i) => [itemId(i), i])), [company]);
  const wake = Object.entries(state.presses).flatMap(([key, p]) => {
    const item = items.get(key);
    return item && (p.state === 'sending' || p.state === 'sent' || p.state === 'undoing') ? [undoUntil(item, p, skew)] : [];
  });
  const clock = useCompanyClock(snapshot.serverTime, online, wake);
  const now = Math.max(clock, dockNow);

  const rows = useMemo(() => {
    const shown = foldBursts(filterLines(lines, filter, company));
    return rowsOf(shown, lines, now);
  }, [lines, filter, company, now]);
  const firstNew = firstNewRow(rows, newFrom);
  const who = whoCalled(snapshot, company, filter.who);
  const said = filterSentence(filter, who, rows.length);

  const setFilter = (next: FeedFilter) => {
    setFilterState(next);
    writeFilter(scope, next);
  };

  // What each needs-you line shows: the item to answer, or after a press the line with Undo; else the line as it is.
  const viewOf = (line: FeedLine): { item: Item; view: Exclude<ItemView, { kind: 'answered' } | { kind: 'hidden' }> } | null => {
    if (line.item === null || !items.has(line.item)) return null;
    const item = items.get(line.item);
    if (!item) return null;
    const press = Object.hasOwn(state.presses, line.item) ? state.presses[line.item] : undefined;
    const view = itemView(company, item, press, { now, openedAt: snapshot.serverTime, skew });
    if (view.kind === 'open' || view.kind === 'pending' || (view.kind === 'done' && press !== undefined)) return { item, view };
    return null;
  };

  // Once an answer of yours reaches them, the live region says so; the store says each once, for the inbox too.
  const doneKey = rows.flatMap((r) => (viewOf(r.line)?.view.kind === 'done' ? [r.line.item ?? ''] : [])).join(',');
  useEffect(() => {
    if (doneKey) store.announceApplied(doneKey.split(','));
  }, [doneKey, store]);

  const focus: ItemFocus = {
    // A pressed answer's Undo takes focus, so the keyboard can take it back at once.
    pressed: (itemKey) => store.wantUndoFocus(itemKey),
    refused: (itemKey) => setGoal({ kind: 'line', id: itemKey }),
    undone: (itemKey) => setGoal({ kind: 'first', id: itemKey }),
    box: (itemKey) => setGoal({ kind: 'box', id: itemKey }),
  };

  // Opening: focus on the heading; the lines open on the New rule, at the line pressed, or at the foot.
  // Under the side panel's sheet the feed is inert and can't take focus: the heading gets it once the sheet goes.
  const headingWaits = useRef(false);
  useLayoutEffect(() => {
    if (covered) headingWaits.current = true;
    else heading.current?.focus({ preventScroll: true });
    const scroller = body.current;
    if (!scroller) return;
    const target = openedAt ? scroller.querySelector<HTMLElement>(`[data-line="${CSS.escape(openedAt)}"]`) : newRule.current;
    if (target) target.scrollIntoView({ block: openedAt ? 'center' : 'start' });
    else scroller.scrollTop = scroller.scrollHeight;
    atEnd.current = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - AT_END_PX;
  }, [openedAt]); // eslint-disable-line react-hooks/exhaustive-deps -- `covered` at the moment it opens
  useEffect(() => {
    if (covered || !headingWaits.current) return;
    headingWaits.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [covered]);

  // Lines that come in at the foot scroll in only if you were at the foot; otherwise "3 new lines" waits there.
  const lastId = rows.at(-1)?.line.id ?? null;
  const drawnLast = useRef<string | null>(lastId);
  useLayoutEffect(() => {
    const scroller = body.current;
    const before = drawnLast.current;
    drawnLast.current = lastId;
    if (!scroller || before === lastId || before === null) return;
    if (atEnd.current) scroller.scrollTop = scroller.scrollHeight;
    else {
      const at = rows.findIndex((r) => r.line.id === before);
      const first = rows[at + 1];
      if (at >= 0 && first) setWaiting((w) => w ?? first.line.id);
    }
  }, [lastId, rows]);
  const waitingFrom = waiting === null ? -1 : rows.findIndex((r) => r.line.id === waiting);
  const waitingCount = waitingFrom < 0 ? 0 : rows.length - waitingFrom;

  // "Catch me up" from the palette or the bar asks for the digest: its own button, pressed.
  useEffect(() => {
    if (catchUpAsk === 0) return;
    const button = body.current?.querySelector<HTMLButtonElement>('.catch-up__button');
    if (!button) return;
    button.focus({ preventScroll: true });
    button.click();
  }, [catchUpAsk]);

  // Earlier lines came in above: focus goes to the first line they add, or to the sentence that says there are no more.
  const asking = useRef<number | null>(null);
  useLayoutEffect(() => {
    const before = asking.current;
    if (before === null || earlier.loading) return;
    asking.current = null;
    const scroller = body.current;
    const first = rows[0];
    if (!scroller) return;
    if (earlier.added > before && first) {
      const el = scroller.querySelector<HTMLElement>(`[data-line="${CSS.escape(first.line.id)}"]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'start' });
    } else if (earlier.ended) scroller.querySelector<HTMLElement>('[data-earlier-note]')?.focus({ preventScroll: true });
  }, [earlier.loading, earlier.added, earlier.ended, rows]);
  const showEarlier = () => {
    if (!online || earlier.loading) return;
    asking.current = earlier.added;
    earlier.show();
  };

  // A reply keeps its dot until it has been on screen in the open feed for a second: then they are marked seen, so the
  // inbox's Conversations agree. Their panel marks them too when you open it.
  const unread = rows.flatMap((r) => (unreadReply(r.line, company.seen) ? [r.line.from] : []));
  const unreadKey = [...new Set(unread)].sort().join(',');
  const marking = useRef(new Set<string>());
  useEffect(() => {
    const scroller = body.current;
    if (!scroller || !unreadKey || !online || covered || typeof IntersectionObserver === 'undefined') return;
    const timers = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const person = (entry.target as HTMLElement).dataset.unreadFrom;
          const running = timers.get(entry.target);
          if (running !== undefined) window.clearTimeout(running);
          timers.delete(entry.target);
          if (!entry.isIntersecting || !person) continue;
          timers.set(
            entry.target,
            window.setTimeout(() => {
              if (document.visibilityState !== 'visible' || marking.current.has(person)) return;
              marking.current.add(person);
              // Let go once it is done, so their next reply in this same opening can be marked too.
              actions.markSeen(person).then(() => marking.current.delete(person), (error: unknown) => {
                marking.current.delete(person);
                console.warn(`Couldn't mark the conversation with ${person} as read: ${error instanceof Error ? error.message : 'unknown'}`);
              });
            }, SEEN_AFTER_MS),
          );
        }
      },
      { root: scroller, threshold: 0.6 },
    );
    for (const el of scroller.querySelectorAll('[data-unread-from]')) observer.observe(el);
    return () => {
      observer.disconnect();
      for (const t of timers.values()) window.clearTimeout(t);
    };
  }, [unreadKey, rows.length, online, covered, actions]);
  // What marking has done is in `company.seen` by now; a person who has new replies again can be marked again.
  useEffect(() => {
    marking.current.clear();
  }, [company.seen]);

  const onScroll = () => {
    const scroller = body.current;
    if (!scroller) return;
    atEnd.current = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - AT_END_PX;
    if (atEnd.current && waiting !== null) setWaiting(null);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };

  const jumpToNew = () => {
    const target = newRule.current ?? body.current?.querySelector<HTMLElement>('[data-line]:last-of-type');
    target?.focus({ preventScroll: false });
    target?.scrollIntoView({ block: 'start' });
  };

  const showWaiting = () => {
    const scroller = body.current;
    if (!scroller || waiting === null) return;
    const el = scroller.querySelector<HTMLElement>(`[data-line="${CSS.escape(waiting)}"]`);
    setWaiting(null);
    scroller.scrollTop = scroller.scrollHeight;
    el?.focus({ preventScroll: true });
  };

  const openPerson = (person: string) => navigate(`people/${encodeURIComponent(person)}`);
  const toggleBurst = (burst: string) =>
    setUnfolded((all) => {
      const next = new Set(all);
      if (!next.delete(burst)) next.add(burst);
      return next;
    });

  const options = useMemo(() => whoOptions(snapshot, company), [snapshot, company]);
  const known = filter.who === 'all' || options.rooms.some((o) => o.value === filter.who) || options.people.some((g) => g.people.some((o) => o.value === filter.who));
  const filterPanel = (
    <div className={`feed__filters${filtersOpen ? ' is-open' : ''}`} id={`${id}-filters`}>
      <label className="feed__chip">
        <span className="feed__chip-name">Who</span>
        <select value={filter.who} onChange={(e) => setFilter({ ...filter, who: e.target.value })}>
          <option value="all">Everyone</option>
          {!known && <option value={filter.who}>Someone who left</option>}
          {options.rooms.length > 0 && (
            <optgroup label="Rooms">
              {options.rooms.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {options.people.map((g) => (
            <optgroup key={g.room} label={g.room}>
              {g.people.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="feed__chip">
        <span className="feed__chip-name">Kind</span>
        <select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: parseFilter({ who: 'all', kind: e.target.value }).kind })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <section id={id} className={`feed${phone ? ' feed--phone' : ''}`} aria-labelledby={`${id}-title`} onKeyDown={onKey} inert={covered || undefined}>
      <header className="feed__head">
        <h2 id={`${id}-title`} ref={heading} className="feed__title" tabIndex={-1}>
          Feed
        </h2>
        <button type="button" className="feed__jump" onClick={jumpToNew}>
          Jump to the new lines
        </button>
        {phone ? (
          <button type="button" className={`feed__filter-key${isFiltered(filter) ? ' is-on' : ''}`} aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen((o) => !o)}>
            Filter
          </button>
        ) : null}
        {!phone && filterPanel}
        <button type="button" className="feed__close" aria-label="Close the feed" title="Close the feed" onClick={onClose}>
          <Glyph name="close" />
        </button>
        {phone && filtersOpen && filterPanel}
        <div className="feed__filtered-row">
          <p role="status" className="feed__filtered">
            {said}
          </p>
          {isFiltered(filter) && (
            <button
              type="button"
              className="feed__link"
              onClick={(e) => {
                // The key goes with the filter: focus moves to the Who box (or the Filter key when the phone folds it away).
                const head = e.currentTarget.closest('.feed__head');
                const select = head?.querySelector<HTMLSelectElement>('.feed__filters select');
                const target = select && select.offsetParent !== null ? select : head?.querySelector<HTMLElement>('.feed__filter-key');
                setFilter(NO_FILTER);
                target?.focus();
              }}
            >
              Show everything
            </button>
          )}
        </div>
      </header>
      <div ref={body} className="feed__body" onScroll={onScroll}>
        {catchUp && <div className="feed__catch-up">{catchUp}</div>}
        <div className="feed__earlier">
          {earlier.ended ? (
            <p className="feed__earlier-note" tabIndex={-1} data-earlier-note>
              {EARLIER_NOT_KEPT}
            </p>
          ) : (
            earlier.canAsk && (
              <>
                <button type="button" className="feed__earlier-key" aria-disabled={!online || earlier.loading || undefined} aria-busy={earlier.loading || undefined} onClick={showEarlier}>
                  {earlier.loading ? 'Loading earlier lines…' : earlier.error ? 'Try again' : 'Show earlier lines'}
                </button>
                {earlier.error && (
                  <p role="alert" className="feed__earlier-error">
                    Couldn't load earlier lines. {earlier.error}
                  </p>
                )}
              </>
            )
          )}
        </div>
        {lines.length === 0 ? (
          <p className="feed__empty">{NOTHING_SAID_FEED}</p>
        ) : rows.length === 0 ? (
          <p className="feed__empty" aria-hidden="true">
            {said}
          </p>
        ) : (
          <ol className="feed__lines">
            {rows.map((r, i) => (
              <FeedItem
                key={r.line.id}
                row={r}
                isNew={i === firstNew}
                newRule={newRule}
                snapshot={snapshot}
                company={company}
                companyId={companyId}
                online={online}
                now={now}
                navigate={navigate}
                talk={talk}
                onPerson={openPerson}
                unread={unreadReply(r.line, company.seen)}
                answer={viewOf(r.line)}
                store={store}
                state={state}
                announce={announce}
                focus={focus}
                open={unfolded.has(r.line.id)}
                onToggle={toggleBurst}
              />
            ))}
          </ol>
        )}
        {!online && <p className="feed__offline">Reconnecting to the office.</p>}
      </div>
      {waitingCount > 0 && (
        <button type="button" className="feed__more" onClick={showWaiting}>
          {waitingCount === 1 ? '1 new line' : `${waitingCount} new lines`}
        </button>
      )}
    </section>
  );
}

interface ItemProps {
  row: FeedRow;
  isNew: boolean;
  newRule: RefObject<HTMLDivElement | null>;
  snapshot: Snapshot;
  company: CompanyView;
  companyId: string;
  online: boolean;
  now: number;
  navigate: TabProps['navigate'];
  talk: TalkControl;
  onPerson: (person: string) => void;
  unread: boolean;
  answer: { item: Item; view: Exclude<ItemView, { kind: 'answered' } | { kind: 'hidden' }> } | null;
  store: AnswerStore;
  state: AnswersState;
  announce: TabProps['announce'];
  focus: ItemFocus;
  open: boolean;
  onToggle: (burst: string) => void;
}

const FeedItem = memo(function FeedItem({ row, isNew, newRule, snapshot, company, companyId, online, now, navigate, talk, onPerson, unread, answer, store, state, announce, focus, open, onToggle }: ItemProps) {
  return (
    <li className={`feed__item${row.rail ? ' feed__item--rail' : ''}`}>
      {row.day && <h3 className="feed__day">{row.day}</h3>}
      {isNew && (
        <div ref={newRule} className="feed__new" tabIndex={-1}>
          <span aria-hidden="true">New</span>
          <span className="visually-hidden">New lines start here</span>
        </div>
      )}
      {row.onYours && (
        <p className="feed__on">
          On your message:{' '}
          <button type="button" className="feed__link" onClick={() => navigate(row.onYours?.path ?? '')}>
            “{row.onYours.words.length > 70 ? `${row.onYours.words.slice(0, 69).trimEnd()}…` : row.onYours.words}”
          </button>
        </p>
      )}
      <Line row={row} snapshot={snapshot} company={company} companyId={companyId} online={online} now={now} navigate={navigate} talk={talk} onPerson={onPerson} unread={unread} answer={answer} store={store} state={state} announce={announce} focus={focus} open={open} onToggle={onToggle} />
    </li>
  );
});

function Line({ row, snapshot, company, companyId, online, now, navigate, talk, onPerson, unread, answer, store, state, announce, focus, open, onToggle }: Omit<ItemProps, 'isNew' | 'newRule'>) {
  const { line, joined } = row;
  const faces = facesOf(line);
  const tone = line.tone === 'needs' ? ' feed__line--needs' : line.tone === 'stuck' ? ' feed__line--stuck' : '';
  const replyTo = line.kind === 'reply' && company.people.some((p) => p.id === line.from) ? line.from : null;
  const burst = line.kind === 'burst';
  return (
    <article
      className={`feed__line${tone}${line.from === STAKEHOLDER ? ' feed__line--yours' : ''}${joined ? ' feed__line--joined' : ''}${row.rail ? ' feed__line--rail' : ''}`}
      data-line={line.id}
      data-item-line={line.item ?? undefined}
      data-unread-from={unread ? line.from : undefined}
      tabIndex={-1}
    >
      <span className="feed__face" aria-hidden="true">
        {burst ? (
          <span className="feed__faces">
            {faces.map((f, i) => (
              <Face key={`${f}:${i}`} of={faceOfId(snapshot, company, f)} size={20} />
            ))}
          </span>
        ) : (
          <Face of={faceOfId(snapshot, company, line.from)} size={28} needsYou={line.tone === 'needs'} />
        )}
      </span>
      <p className={`feed__say${joined ? ' visually-hidden' : ''}`}>
        {unread && (
          <>
            <span className="feed__dot" aria-hidden="true" />
            <span className="visually-hidden">New. </span>
          </>
        )}
        {line.yours && line.kind === 'passed' && <Paper />}
        <Sentence segs={line.sentence} onPerson={onPerson} plain={joined} />
      </p>
      <time className={`feed__time${joined ? ' visually-hidden' : ''}`} dateTime={new Date(line.at).toISOString()}>
        {hourMinute(line.at)}
      </time>
      {answer ? (
        <div className="feed__card">
          <InboxItem item={answer.item} view={answer.view} company={company} companyId={companyId} now={now} online={online} navigate={navigate} announce={announce} store={store} state={state} focus={focus} surface="feed" />
        </div>
      ) : (
        <>
          {line.body && <Words text={line.body} yours={line.from === STAKEHOLDER && line.kind === 'yours'} />}
          {burst && line.members && (
            <p className="feed__keys">
              <button type="button" className="feed__link" aria-expanded={open} onClick={() => onToggle(line.id)}>
                {open ? 'Hide them' : 'Show them'}
              </button>
            </p>
          )}
          {burst && open && line.members && (
            <ul className="feed__members">
              {line.members.map((m) => (
                <li key={m.id} className="feed__member">
                  <Face of={faceOfId(snapshot, company, m.from)} size={20} />
                  <span>
                    <Sentence segs={m.sentence} onPerson={onPerson} />
                    {m.body ? <span className="feed__member-words">: {m.body}</span> : null}
                  </span>
                  <time dateTime={new Date(m.at).toISOString()}>{hourMinute(m.at)}</time>
                </li>
              ))}
            </ul>
          )}
          {(line.link || replyTo) && (
            <p className="feed__keys">
              {replyTo ? (
                <button type="button" className="feed__link" onClick={() => talk.to({ kind: 'person', id: replyTo }, { focus: true })}>
                  Reply
                </button>
              ) : line.link ? (
                <button type="button" className="feed__link" aria-disabled={(!online && line.link.label === 'Answer') || undefined} onClick={() => line.link && navigate(line.link.path)}>
                  {line.link.label}
                </button>
              ) : null}
            </p>
          )}
        </>
      )}
    </article>
  );
}

/** Their words under a line: six lines, then "Read all of it"; yours in an ink bubble. */
function Words({ text, yours }: { text: string; yours: boolean }) {
  return (
    <div className={`feed__words${yours ? ' feed__words--yours' : ''}`}>
      <Clamp text={text} lines={6} />
    </div>
  );
}

/** `plain`: the names are text, not keys, for a line whose header is hidden (they would be unseen stops in the Tab order). */
function Sentence({ segs, onPerson, plain = false }: { segs: readonly Seg[]; onPerson: (person: string) => void; plain?: boolean }) {
  return segs.map((s, i) =>
    typeof s === 'string' || plain ? (
      <span key={i}>{typeof s === 'string' ? s : s.text}</span>
    ) : (
      <button key={i} type="button" className="feed__name" onClick={() => onPerson(s.person)}>
        {s.text}
      </button>
    ),
  );
}
