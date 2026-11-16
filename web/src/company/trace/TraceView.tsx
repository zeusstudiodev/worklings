// A message's trace (SPEC-v3.md "Steering" 3, "See your message land"): where it stalls with Remind and Escalate, who
// got it, when and how, and through whom, each acknowledgement, who it is for, what came of it and the follow-ups. It
// takes the panel's place at `messages/<id>`, with Back to what opened it.
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { familyOf, traceOf } from '../../../../src/core/trace.ts';
import { countWord } from '../../../../src/core/now.ts';
import { capital } from '../../../../src/core/words.ts';
import { roomHue } from '../../hud/model.ts';
import { reconnectingLine } from '../model.ts';
import { useCompanyClock } from '../people/clock.ts';
import { Clamp, CompanyLink, refusalOf } from '../people/shared.tsx';
import type { TabProps } from '../types.ts';
import { StatePill } from '../ui/StatePill.tsx';
import { citeRows, type FlagRow, flagRows, followUpRows, forRows, messageHead, readTrace, stopRows, summaryOf } from './traceModel.ts';
import './trace.css';

type Props = TabProps & { message: string };

/** More stops than this and the acknowledged ones fold. */
const FOLD_AFTER = 6;

/** What a Remind or an Escalate press left on its flag. */
interface Pressed {
  state: 'busy' | 'sent' | 'failed';
  text: string;
}

export function TraceView({ snapshot, company, companyId, navigate, announce, online, steer, message }: Props) {
  const now = useCompanyClock(snapshot.serverTime, online);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // A flag's press on its way: a second press waits for the first.
  const busy = useRef(new Set<string>());
  const [pressed, setPressed] = useState<Record<string, Pressed>>({});
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  const trace = traceOf(company, message, now);
  const family = familyOf(company.messages, message);
  const head = messageHead(company, family, now);
  const read = readTrace(trace, now);
  const flags = flagRows(company, trace, read.stalled, now);
  const stops = stopRows(company, trace, now);
  const wanted = forRows(company, trace, now);
  const cites = citeRows(company, trace, now);
  const followUps = followUpRows(company, trace, now);
  const offline = online ? null : reconnectingLine(snapshot.serverTime);
  const enc = encodeURIComponent;
  const inCompany = (id: string) => company.people.some((p) => p.id === id);

  // A trace to many people (everyone) is long: those who acknowledged, with nobody hanging under them, fold into one line.
  const foldable = (row: (typeof stops)[number], i: number) => stops.length > FOLD_AFTER && row.ack?.agree === true && row.depth === 0 && (stops[i + 1]?.depth ?? 0) === 0;
  const folded = stops.filter(foldable);
  const shown = stops.filter((row, i) => !foldable(row, i));
  const stopRow = (row: (typeof stops)[number]) => {
              const person = company.people.find((p) => p.id === row.person);
              return (
                <li key={row.key} className="trace-stop" style={{ '--depth': Math.min(row.depth, 4), '--hue': roomHue(snapshot, person?.room) } as CSSProperties}>
                  <span className="trace-stop__marker" aria-hidden="true" />
                  <div className="trace-stop__main">
                    <div className="trace-stop__head">
                      {inCompany(row.person) ? (
                        <CompanyLink companyId={companyId} to={`people/${enc(row.person)}`} navigate={navigate} className="trace-stop__name" focusKey={`trace:${message}:stop:${row.key}`}>
                          {row.name}
                        </CompanyLink>
                      ) : (
                        <span className="trace-stop__name">{row.name}</span>
                      )}
                      <StatePill label={row.word.text} tone={row.word.tone} />
                    </div>
                    {row.via && <p className="trace-stop__line">{row.via}</p>}
                    {row.note && <p className="trace-stop__note">{row.note}</p>}
                    <p className="trace-stop__line">{row.delivery}</p>
                    {row.ack && (
                      <p className={`trace-stop__ack${row.ack.agree ? '' : ' is-disagree'}`}>
                        <span className="trace-stop__ack-word">{row.ack.agree ? 'Acknowledged' : 'Disagrees'}</span> {row.ack.when}: “{row.ack.text}”
                      </p>
                    )}
                  </div>
                </li>
              );
  };

  const press = async (row: FlagRow, what: 'remind' | 'escalate') => {
    if (!steer || !online || busy.current.has(row.key)) return;
    const to = what === 'remind' ? row.holder.name : (row.escalateTo?.name ?? '');
    busy.current.add(row.key);
    setPressed((all) => ({ ...all, [row.key]: { state: 'busy', text: what === 'remind' ? `Reminding ${to}…` : `Escalating to ${to}…` } }));
    try {
      // The stakeholder's own message is what everyone on the way knows; the company finds the holder's copy from it.
      const root = family.root?.id ?? message;
      if (what === 'remind') await steer.remind(root, row.holder.id);
      else await steer.escalate(root, row.holder.id);
      const text = what === 'remind' ? `Reminded ${to}.` : `Escalated to ${to}.`;
      setPressed((all) => ({ ...all, [row.key]: { state: 'sent', text: capital(text) } }));
      announce(capital(text));
    } catch (error) {
      const text = `Couldn't ${what === 'remind' ? `remind ${to}` : `escalate to ${to}`}: ${refusalOf(error)}`;
      setPressed((all) => ({ ...all, [row.key]: { state: 'failed', text } }));
      announce(text);
    } finally {
      busy.current.delete(row.key);
    }
  };

  return (
    <article className="trace" aria-labelledby={titleId}>
      <header className="trace__head">
        <h2 id={titleId} ref={heading} className="panel-title" tabIndex={-1} data-panel-heading>
          Where your message went
        </h2>
      </header>

      {head ? (
        <section className="trace__message" aria-label={head.whose}>
          <p className="trace__to">
            {head.to}
            {head.for && <> {head.for}</>}
          </p>
          <Clamp text={head.text} lines={6} className="trace__quote" />
        </section>
      ) : (
        <p className="trace__gone">That message isn't in the office's view any more: it keeps the latest 200 messages.</p>
      )}

      {head && <p className={`trace__summary trace__summary--${read.state}`}>{summaryOf(company, trace, read)}</p>}

      {flags.length > 0 && (
        <section className="trace__section" aria-labelledby={`${titleId}-stalls`}>
          <h3 id={`${titleId}-stalls`} className="group-title">
            Where it stalls
          </h3>
          <ul className="trace-flags">
            {flags.map((row) => {
              const note = pressed[row.key];
              const waiting = !online || note?.state === 'busy';
              return (
                <li key={row.key} className="trace-flag">
                  {row.sentences.map((sentence) => (
                    <p key={sentence} className="trace-flag__sentence">
                      {sentence}
                    </p>
                  ))}
                  <p className="trace-flag__meta">
                    {row.age}
                    {row.holds && <> {row.holds}</>}
                    {row.followed && <> {row.followed}</>}
                  </p>
                  {steer && (
                    <div className="trace-flag__actions">
                      <button type="button" className="button" aria-disabled={waiting || undefined} aria-describedby={offline ? `${titleId}-offline` : undefined} onClick={() => void press(row, 'remind')}>
                        Remind {row.holder.name}
                      </button>
                      {row.escalateTo && (
                        <button type="button" className="button" aria-disabled={waiting || undefined} aria-describedby={offline ? `${titleId}-offline` : undefined} onClick={() => void press(row, 'escalate')}>
                          Escalate to {row.escalateTo.name}
                        </button>
                      )}
                    </div>
                  )}
                  {note && <p className={`trace-flag__note trace-flag__note--${note.state}`}>{note.text}</p>}
                </li>
              );
            })}
          </ul>
          {offline && (
            <p id={`${titleId}-offline`} className="trace__offline">
              {offline}
            </p>
          )}
        </section>
      )}

      {stops.length > 0 && (
        <section className="trace__section" aria-labelledby={`${titleId}-stops`}>
          <h3 id={`${titleId}-stops`} className="group-title">
            Who got it
          </h3>
          <ol className="trace-stops">{shown.map(stopRow)}</ol>
          {folded.length > 0 && (
            <details className="trace-stops__folded">
              <summary>{capital(countWord(folded.length))} acknowledged</summary>
              <ol className="trace-stops">{folded.map(stopRow)}</ol>
            </details>
          )}
        </section>
      )}

      {wanted.length > 0 && (
        <section className="trace__section" aria-labelledby={`${titleId}-for`}>
          <h3 id={`${titleId}-for`} className="group-title">
            Who it's for
          </h3>
          <ul className="trace-list">
            {wanted.map((row) => (
              <li key={row.person} className="trace-list__item">
                <span className="trace-list__who">{row.name}:</span> {row.line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(head || cites.length > 0) && (
        <section className="trace__section" aria-labelledby={`${titleId}-cites`}>
          <h3 id={`${titleId}-cites`} className="group-title">
            What came of it
          </h3>
          {cites.length === 0 ? (
            <p className="trace__empty">Nothing cites it yet. Tasks, reports, decisions and commits that answer it show up here.</p>
          ) : (
            <ul className="trace-list">
              {cites.map((row) => (
                <li key={row.key} className="trace-list__item">
                  {row.path ? (
                    <CompanyLink companyId={companyId} to={row.path} navigate={navigate} className="link" focusKey={`trace:${message}:cite:${row.key}`}>
                      {row.text}
                    </CompanyLink>
                  ) : (
                    row.text
                  )}{' '}
                  <span className="trace-list__when">{row.when}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {followUps.length > 0 && (
        <section className="trace__section" aria-labelledby={`${titleId}-follow`}>
          <h3 id={`${titleId}-follow`} className="group-title">
            Follow-ups
          </h3>
          <ul className="trace-list">
            {followUps.map((row) => (
              <li key={row.key} className="trace-list__item">
                {row.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!head && cites.length === 0 && (
        <p>
          <CompanyLink companyId={companyId} to="inbox" navigate={navigate} className="link" focusKey="trace:gone:inbox">
            Your conversations
          </CompanyLink>
        </p>
      )}
    </article>
  );
}
