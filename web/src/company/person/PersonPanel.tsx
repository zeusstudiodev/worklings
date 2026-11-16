// A person (docs/design-v3.md, "A person"; "Stage and dock", "The side panel"): who they are, what they are doing, the
// conversation with you, Stop and Details. The talk bar is the one box: "Message Kai" makes them its To, and Stop turns
// it into their Stop.
import { type CSSProperties, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { type CompanyView, type PersonView, STAKEHOLDER } from '../../../../src/core/company.ts';
import { clip, plainText } from '../../../../src/core/now.ts';
import type { FiredRole } from '../../../../src/core/studio.ts';
import { roomHue } from '../../hud/model.ts';
import { dollars, whenAt } from '../../lib/format.ts';
import { LeashBadge } from '../leash/LeashBadge.tsx';
import { useCompanyClock } from '../people/clock.ts';
import { called, isAtWork, workOf } from '../people/peopleModel.ts';
import { Clamp, CompanyLink, refusalOf } from '../people/shared.tsx';
import { companyHref, goBack, parseCompanyAddress, useLocation } from '../router.ts';
import { TraceSummary } from '../trace/TraceSummary.tsx';
import type { TabProps } from '../types.ts';
import { StatePill } from '../ui/StatePill.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';
import { useReached } from '../ui/useReached.ts';
import { allItems, inboxItemPath, itemId } from '../inbox/inboxModel.ts';
import { Details } from './Details.tsx';
import { canStop, emptyThread, latestReportOf, roleLine, statusOf, type ThreadEntry, threadOf } from './personModel.ts';
import './person.css';

type Props = TabProps & { person: string };

/** What someone fired from this panel was, so the panel can say so and offer Undo once they leave the company. */
export interface Fired {
  person: PersonView;
  text: string;
  /** When Undo goes, by this browser's clock. */
  until: number;
}

/** Undo stays in place this long after a firing, as office changes do. */
const FIRE_UNDO_MS = 10_000;

export function PersonPanel(props: Props) {
  const [fired, setFired] = useState<Fired | null>(null);
  const p = props.company.people.find((x) => x.id === props.person);
  // Someone just fired here stays on the page until the snapshot lets them go; then the page says so, with Undo.
  if (p) return <PersonPage key={p.id} {...props} p={p} onFired={setFired} />;
  return <Gone {...props} fired={fired?.person.id === props.person ? fired : null} onRehired={() => setFired(null)} />;
}

// ---------------------------------------------------------------------------------------------------------------

function PersonPage({ snapshot, company, companyId, actions, steer, navigate, announce, online, catchUp, openRoom, openVisitor, expandSheet, talk, p, onFired }: Props & { p: PersonView; onFired: (f: Fired) => void }) {
  const now = useCompanyClock(snapshot.serverTime, online);
  const titleId = useId();
  const [details, setDetails] = useState(false);
  const [unsent, setUnsent] = useState<ReadonlySet<string>>(() => new Set());
  const [unsendNote, setUnsendNote] = useState<{ id: string; text: string } | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const thread = useRef<HTMLElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const atEnd = useRef(true);
  // The messages whose Unsend is on its way: a second press waits for the first instead of asking again.
  const unsending = useRef(new Set<string>());

  const name = called(p);
  const hue = roomHue(snapshot, p.room);
  const work = workOf(company, p, now);
  const role = roleLine(snapshot, company, p);
  const status = statusOf(p, now);
  const report = latestReportOf(company, p.id, now);
  const task = p.task ? company.tasks.find((t) => t.id === p.task) : undefined;
  const entries = threadOf(company, p, now).filter((e) => !(e.kind === 'mine' && unsent.has(e.id)));
  const plan = company.settings.billing === 'plan';
  // Their question or request for your OK, as a row: the words it asks, and Answer, which opens the inbox on it.
  const waitingItem = work.item ? allItems(company).find((i) => itemId(i) === work.item) : undefined;
  const waiting = waitingItem ? waitingWords(waitingItem) : null;

  // Their name takes focus when the panel opens: a person's page is keyed by who it is. "Message Kai" puts it in the
  // talk bar's box, where the words go.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  // Opening their conversation, and anything new while it is open, counts as seen.
  const newest = company.messages.reduce((t, m) => (m.from === p.id && m.to === STAKEHOLDER ? Math.max(t, m.at) : t), 0);
  const markSeen = useEffectEvent(() => {
    actions.markSeen(p.id).catch((error: unknown) => console.warn(`Couldn't mark the conversation with ${p.id} as read: ${refusalOf(error)}`));
  });
  useEffect(() => {
    if (online) markSeen();
  }, [p.id, newest, online]);

  // New messages scroll into view only if the thread was at its end.
  useEffect(() => {
    const scroller = scrollerOf(thread.current);
    if (!scroller) return;
    const onScroll = () => {
      atEnd.current = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 32;
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [details]);
  const contentKey = `${entries.length}:${entries.at(-1)?.id ?? ''}`;
  const drawn = useRef<string | null>(null);
  useLayoutEffect(() => {
    // The first draw opens at the top, on their name; only what comes in later scrolls into view.
    const first = drawn.current === null;
    drawn.current = contentKey;
    if (first) return;
    const scroller = scrollerOf(thread.current);
    if (scroller && atEnd.current) scroller.scrollTop = scroller.scrollHeight;
  }, [contentKey]);

  const unsend = async (id: string, text: string) => {
    if (!online || unsending.current.has(id)) return;
    unsending.current.add(id);
    setUnsendNote(null);
    try {
      await actions.unsend(id);
      setUnsent((all) => new Set([...all, id]));
      // The words go back to the talk bar's box with them as its To, if the box is empty; focus goes there, since the
      // Unsend button is gone with the message.
      talk?.to({ kind: 'person', id: p.id }, { focus: true, draft: text });
      announce('Unsent.');
    } catch (error) {
      setUnsendNote({ id, text: `Couldn't unsend: ${refusalOf(error)}` });
      announce(`Couldn't unsend: ${refusalOf(error)}`);
    } finally {
      unsending.current.delete(id);
    }
  };

  const openDetails = (open: boolean) => {
    setDetails(open);
    // Back to the conversation puts focus on Details again; opening it puts focus on its heading (Details.tsx).
    if (!open) window.requestAnimationFrame(() => detailsButton.current?.focus({ preventScroll: true }));
  };

  const managerLink =
    role.manager === 'you' ? (
      'you'
    ) : role.manager ? (
      <CompanyLink companyId={companyId} to={`people/${encodeURIComponent(role.manager.id)}`} navigate={navigate} className="link" focusKey={`person:${p.id}:manager`}>
        {role.manager.name}
      </CompanyLink>
    ) : null;

  return (
    <article className="person" aria-labelledby={titleId} style={{ '--hue': hue } as CSSProperties}>
      <header className="person__head">
        <h2 id={titleId} ref={heading} className="person__name" tabIndex={-1} data-panel-heading>
          {p.name}
        </h2>
        <LeashBadge company={company} person={p.id} />
        <p className="person__role">
          {role.title} in {role.room}
          {managerLink && <>, reports to {managerLink}</>}.
        </p>
        <p className="person__cost">
          {dollars(p.cost)} spent{plan ? ', API-equivalent' : ''}.
        </p>
      </header>

      <section className="person__now" aria-label={`What ${name} is doing`}>
        <StatePill label={work.word} tone={work.tone} />
        {!isAtWork(work) && <p className="person__state">{work.line}</p>}
        {work.problem && <p className="person__problem">{work.problem}</p>}
        {waiting && (
          <div className="person__waiting">
            <p className="person__waiting-text">{waiting}</p>
            <CompanyLink companyId={companyId} to={inboxItemPath(work.item ?? '')} navigate={navigate} className="button person__answer" focusKey={`person:${p.id}:answer`} label={`Answer ${name} in the inbox`}>
              Answer
            </CompanyLink>
          </div>
        )}
        {(status || isAtWork(work)) && (
          <p className="person__status">
            {status ? (
              <>
                {status.text} <span className="person__age">{status.age}</span>
              </>
            ) : (
              work.line
            )}
          </p>
        )}
        {task && (
          <p className="person__task">
            Task:{' '}
            <CompanyLink companyId={companyId} to={`tasks/${encodeURIComponent(task.id)}`} navigate={navigate} className="link" focusKey={`person:${p.id}:task`}>
              {task.title}
            </CompanyLink>
          </p>
        )}
        {report && (
          <div className="person__report">
            <p className="person__report-label">{report.label}</p>
            <Clamp text={report.text} lines={2} className="person__report-text" />
          </div>
        )}
        <div className="person__actions">
          {talk && (
            // Their To even with words in the box: the words stay, and the box says its new To.
            <button type="button" className="button button--primary" onClick={() => talk.to({ kind: 'person', id: p.id }, { focus: true })}>
              Message {name}
            </button>
          )}
          {talk && canStop(p) && (
            <button
              type="button"
              className="button"
              aria-disabled={!online || undefined}
              onClick={() => {
                if (online) talk.stop(p.id);
              }}
            >
              Stop
            </button>
          )}
          <button ref={detailsButton} type="button" className="button" aria-expanded={details} onClick={() => openDetails(!details)}>
            Details
          </button>
        </div>
      </section>

      {details ? (
        <Details
          snapshot={snapshot}
          company={company}
          companyId={companyId}
          actions={actions}
          navigate={navigate}
          announce={announce}
          online={online}
          catchUp={catchUp}
          openRoom={openRoom}
          openVisitor={openVisitor}
          expandSheet={expandSheet}
          steer={steer}
          talk={talk}
          p={p}
          now={now}
          onBack={() => openDetails(false)}
          onFired={(text) => onFired({ person: p, text, until: Date.now() + FIRE_UNDO_MS })}
        />
      ) : (
        <section ref={thread} className="thread" aria-label={`Conversation with ${name}`}>
          {entries.length === 0 ? (
            <p className="thread__empty">{emptyThread(p)}</p>
          ) : (
            <ol className="thread__list">
              {entries.map((e) => (
                <Entry
                  key={e.id}
                  entry={e}
                  company={company}
                  companyId={companyId}
                  snapshot={snapshot}
                  who={p.name}
                  online={online}
                  now={now}
                  navigate={navigate}
                  note={unsendNote?.id === e.id ? unsendNote.text : null}
                  onUnsend={unsend}
                />
              ))}
            </ol>
          )}
        </section>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function Entry({ entry, company, companyId, snapshot, who, online, now, navigate, note, onUnsend }: {
  entry: ThreadEntry;
  company: CompanyView;
  companyId: string;
  snapshot: TabProps['snapshot'];
  who: string;
  online: boolean;
  /** The office's clock: a trace stalls by it. */
  now: number;
  navigate: TabProps['navigate'];
  note: string | null;
  onUnsend: (id: string, text: string) => void;
}) {
  switch (entry.kind) {
    case 'mine':
      return (
        <li className="msg msg--mine">
          <span className="visually-hidden">You: </span>
          <Clamp text={entry.text} lines={12} className="msg__bubble msg__bubble--mine" />
          <p className="msg__sign">
            {entry.delivery}
            {entry.unsend && (
              <>
                {' '}
                <button type="button" className="link msg__unsend" aria-disabled={!online || undefined} onClick={() => onUnsend(entry.id, entry.text)}>
                  Unsend
                </button>
              </>
            )}
          </p>
          {note && <p className="msg__failed">{note}</p>}
          <TraceSummary company={company} companyId={companyId} message={entry.id} now={now} navigate={navigate} about={`your message ${whenAt(entry.at, now)}`} />
        </li>
      );
    case 'answer':
      // The sentence says it was you; taking an answer back is the inbox's Undo, so no Unsend here.
      return (
        <li className="msg msg--mine msg--answer">
          <Clamp text={entry.text} lines={12} className="msg__bubble msg__bubble--mine" />
          <p className="msg__sign">{entry.delivery}</p>
        </li>
      );
    case 'theirs':
      return (
        <li className="msg msg--theirs">
          <span className="visually-hidden">{who}: </span>
          <Clamp text={entry.text} lines={12} className="msg__bubble msg__bubble--theirs" />
          <p className="msg__sign">
            <time dateTime={new Date(entry.at).toISOString()}>{whenAt(entry.at, now)}</time>
          </p>
        </li>
      );
    case 'passed': {
      const passer = company.people.find((x) => x.id === entry.passer);
      return (
        <li className="msg msg--theirs msg--passed" style={passer ? ({ '--hue': roomHue(snapshot, passer.room) } as CSSProperties) : undefined}>
          <p className="msg__heading">{entry.heading}</p>
          <Clamp text={entry.text} lines={12} className="msg__bubble msg__bubble--theirs" />
          <p className="msg__sign">{entry.through}</p>
          {entry.note && (
            <p className="msg__note">
              <span className="msg__note-who">{passer ? passer.name : 'Their note'}:</span> {entry.note}
            </p>
          )}
        </li>
      );
    }
    case 'office':
      return (
        <li className="msg-office">
          {entry.check && <span className="msg-office__check" aria-hidden="true" />}
          <span className="visually-hidden">The office: </span>
          <span className="msg-office__text">{entry.text}</span>{' '}
          <time className="msg-office__time" dateTime={new Date(entry.at).toISOString()}>
            {whenAt(entry.at, now)}
          </time>
          {entry.full && (
            <details className="msg-office__more">
              <summary>Show the full text</summary>
              <div className="msg-office__full" role="region" aria-label="What the office told them" tabIndex={0}>
                {entry.full}
              </div>
            </details>
          )}
        </li>
      );
  }
}

// ---------------------------------------------------------------------------------------------------------------

function Gone({ snapshot, companyId, actions, announce, online, person, fired, onRehired }: Props & { fired: Fired | null; onRehired: () => void }) {
  const record: FiredRole | undefined = snapshot.studio?.fired.find((f) => f.id === person);
  // Rehire takes Undo's place when Undo goes, on the clock the Undo line keeps: this browser's.
  const undoOver = useReached(fired?.until ?? null);
  const undoing = fired !== null && !undoOver;
  const [rehiring, setRehiring] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const name = fired?.person.name ?? record?.name ?? record?.title ?? null;
  const rehire = async () => {
    if (!online || rehiring) return;
    setRehiring(true);
    setNote(null);
    try {
      const result = await actions.reshape({ action: 'rehire', role: person });
      announce(result.message);
      if (result.ok) onRehired();
      else setNote(result.message);
    } catch (error) {
      setNote(`Couldn't rehire ${name ?? 'them'}: ${refusalOf(error)}`);
      announce(`Couldn't rehire ${name ?? 'them'}: ${refusalOf(error)}`);
    } finally {
      setRehiring(false);
    }
  };
  return (
    <article className="person person--gone" aria-labelledby="person-gone-title" style={fired ? ({ '--hue': roomHue(snapshot, fired.person.room) } as CSSProperties) : undefined}>
      <header className="person__head">
        <h2 id="person-gone-title" ref={heading} className="person__name" tabIndex={-1} data-panel-heading>
          {name ?? 'Not in this company'}
        </h2>
      </header>
      {fired ? (
        <UndoLine text={fired.text} until={fired.until} onUndo={() => void rehire()} unavailable={!online || rehiring} />
      ) : record ? (
        <p className="person__state">{name} was fired.</p>
      ) : (
        <p className="person__state">That person isn't in the company any more.</p>
      )}
      {(fired || record) && !undoing && (
        <p className="person__gone-more">
          <button type="button" className="button" aria-disabled={!online || rehiring || undefined} onClick={() => void rehire()}>
            {rehiring ? 'Rehiring…' : `Rehire ${name ?? 'them'}`}
          </button>
        </p>
      )}
      {note && <p className="person__problem">{note}</p>}
      <p>
        <ShowTheInbox companyId={companyId} />
      </p>
    </article>
  );
}

/** "Show the inbox": the side panel's home, over the main view that is open, going back when that is where it leads. */
function ShowTheInbox({ companyId }: { companyId: string }) {
  const location = useLocation();
  const main = parseCompanyAddress(location.path, location.search)?.route.main ?? { kind: 'office' };
  return (
    <button type="button" className="link" onClick={() => goBack(companyHref(companyId, { main, panel: null }))}>
      Show the inbox
    </button>
  );
}

/** What a waiting item asks, in a line or two: the question, or what the approval is for. */
function waitingWords(item: ReturnType<typeof allItems>[number]): string {
  return clip(plainText(item.kind === 'question' ? item.question.text : item.approval.summary), 140);
}

/** The nearest ancestor that scrolls: the panel the person sits in. */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let at = el?.parentElement ?? null; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return null;
}
