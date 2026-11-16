// The office's progress view (SPEC-v0.2.md, "Simple, visible, proven", 2 and 4; docs/design-v3.md, "Progress"): one
// plain column beside the office where every entry point lands. Top to bottom: the goal in your words with how far along
// it is and what it has cost, what needs you, the checklist, the milestones with their tasks as status words, and what
// happened since you last looked. On desktops it is paper on the left of the stage and the office stands in what it
// leaves; on phones it fills the room between the bar and the talk bar. The words are progressModel.ts's.
import { type CSSProperties, type MouseEvent, useId, useState } from 'react';
import { countWord } from '../../../../src/core/now.ts';
import { capital } from '../../../../src/core/words.ts';
import { companyHref, type CompanyRoute, navigate } from '../router.ts';
import type { TabProps } from '../types.ts';
import { StatePill } from '../ui/StatePill.tsx';
import { checkRows, countsLine } from './checklistModel.ts';
import { ChecklistRows } from './ChecklistRows.tsx';
import { type MilestoneRow, progressView, type SinceView, waitingWords } from './progressModel.ts';

/** How many needs-you rows show before "Show all". */
const NEEDS_SHOWN = 3;

/** A link that moves inside the app: a plain press navigates, a modified one opens as the browser would. */
function follow(href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate(href);
  };
}

/** The column's content; the shell draws its paper (the `.progress` section), so the shape stands while this loads. */
export function Progress(props: TabProps & { now: number; onInbox: () => void }) {
  const { company, companyId, now, onInbox } = props;
  const id = useId();
  const [allNeeds, setAllNeeds] = useState(false);
  const view = progressView(company, now);
  // The oldest few lead; the rest are a press away, so the checklist and the milestones stay in reach.
  const needs = allNeeds ? view.needs : view.needs.slice(0, NEEDS_SHOWN);
  const here = (panel: CompanyRoute['panel']): string => companyHref(companyId, { main: { kind: 'progress' }, panel });
  const openTask = (task: string) => navigate(here({ kind: 'task', task }));
  const nameOf = (person: string) => company.people.find((p) => p.id === person)?.name ?? 'Someone who left';
  const preview = company.preview.state === 'up' ? company.preview.url : null;
  const checklist = company.checklist ?? null;
  const rows = checklist ? checkRows(checklist, { now, preview, nameOf }) : [];
  const share = view.progress.share;

  return (
    <div className="progress__scroll">
        <header className="progress__head">
          <div className="progress__title-row">
            <h2 id="progress-heading" className="progress__title" tabIndex={-1}>
              Progress
            </h2>
            <StatePill label={view.stage.word} tone={view.stage.tone} />
          </div>
          {view.goal ? (
            <figure className="progress__goal">
              <figcaption className="progress__goal-label">You asked for</figcaption>
              <blockquote className="progress__goal-words">
                <p>
                  {view.goal.lead}
                  {view.goal.rest && view.goal.rest.length <= 200 && ` ${view.goal.rest}`}
                </p>
                {view.goal.rest.length > 200 && (
                  <details className="progress__goal-more">
                    <summary>Read all of it</summary>
                    <p>{view.goal.rest}</p>
                  </details>
                )}
              </blockquote>
            </figure>
          ) : (
            <p className="progress__muted">No goal yet. Your words show here once you start the company.</p>
          )}
          <div className="progress__meter">
            <p className="progress__figures">{view.progress.line}</p>
            {share !== null && (
              <div className="meter" role="img" aria-label={`${Math.round(share * 100)}% of the tasks done`}>
                <span className="meter__fill" style={{ '--share': `${(share * 100).toFixed(1)}%` } as CSSProperties} />
              </div>
            )}
            <p className="progress__spend">{view.spend}</p>
          </div>
          {view.since.kind === 'since' && (
            <p className="progress__since-lead">
              Since you last looked, {view.since.ago}: {view.since.summary.charAt(0).toLowerCase() + view.since.summary.slice(1)}{' '}
              <a className="link" href={`#${id}-since`}>
                See what
              </a>
            </p>
          )}
        </header>

        <section className="progress__section" aria-labelledby={`${id}-needs`}>
          <h3 id={`${id}-needs`} className="progress__h3">
            Needs you
            {view.needs.length > 0 && <span className="progress__h3-count">{view.needs.length}</span>}
          </h3>
          {view.needs.length === 0 ? (
            <p className="progress__muted">
              {(company.done ?? null) !== null ? "Nothing needs you. The work is done, and the CEO's handover is in the inbox." : 'Nothing needs you. The company carries on by itself and asks here when it needs you.'}
            </p>
          ) : (
            <ul className="needs-rows">
              {needs.map((n) => {
                const href = n.open ? companyHref(companyId, n.open.route) : null;
                return (
                  <li key={n.key} className={`needs-row${n.open ? '' : ' needs-row--stuck'}`}>
                    <p className="needs-row__kind">{n.kind}</p>
                    <p className="needs-row__text">{n.text}</p>
                    <p className="needs-row__meta">
                      <span>{n.meta}</span>
                      {href && n.open && (
                        // Named with what it opens ("Answer: Which pickup window…"): a hidden span read "Answer : …".
                        <a className="needs-row__open" href={href} aria-label={`${n.open.label}: ${n.text}`} onClick={follow(href)}>
                          {n.open.label}
                        </a>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {view.needs.length > NEEDS_SHOWN && (
            <button type="button" className="link progress__more" aria-expanded={allNeeds} onClick={() => setAllNeeds((a) => !a)}>
              {allNeeds ? 'Show fewer' : `Show all ${countWord(view.needs.length)}`}
            </button>
          )}
        </section>

        <section className="progress__section" aria-labelledby={`${id}-checklist`}>
          <h3 id={`${id}-checklist`} className="progress__h3">
            Checklist
          </h3>
          {view.fixing && (
            <p className="progress__fixing" role="status">
              <span className="task-word task-word--working">Fixing</span> {view.fixing.line}
            </p>
          )}
          {view.seen && (
            <div className={`progress__seen progress__seen--${view.seen.tone}`}>
              <p className="progress__seen-line">{view.seen.line}</p>
              {view.seen.detail && <p className="progress__seen-detail">{view.seen.detail}</p>}
            </div>
          )}
          {checklist && rows.length > 0 ? (
            <>
              <p className="progress__note">{countsLine(checklist)}</p>
              <ChecklistRows rows={rows} onTask={openTask} />
            </>
          ) : (
            <p className="progress__muted">No checklist yet. The CEO writes one with the plan: each thing you asked for, as a sentence that can be checked, and the tasks that build it.</p>
          )}
        </section>

        <section className="progress__section" aria-labelledby={`${id}-milestones`}>
          <h3 id={`${id}-milestones`} className="progress__h3">
            Milestones
          </h3>
          {view.milestones.length === 0 ? (
            <p className="progress__muted">{view.noPlan}</p>
          ) : (
            <ol className="milestones">
              {view.milestones.map((m, i) => (
                <Milestone key={m.id} m={m} n={i + 1} companyId={companyId} onTask={openTask} />
              ))}
            </ol>
          )}
        </section>

        <Since since={view.since} id={`${id}-since`} onInbox={onInbox} />
    </div>
  );
}

function Milestone({ m, n, companyId, onTask }: { m: MilestoneRow; n: number; companyId: string; onTask: (task: string) => void }) {
  const share = m.total > 0 ? m.done / m.total : 0;
  const tasksHref = companyHref(companyId, { main: { kind: 'tasks' }, panel: null });
  return (
    <li className={`milestone milestone--${m.state}`}>
      <details className="milestone__fold" open={m.state !== 'done' ? true : undefined}>
        <summary className="milestone__head">
          <span className="milestone__number" aria-hidden="true">
            {n}
          </span>
          <span className="milestone__title">
            <span className="visually-hidden">Milestone {n}: </span>
            {m.title}
          </span>
          <span className="milestone__line">
            <span className="visually-hidden">. </span>
            {m.line}
          </span>
          {m.total > 0 && (
            <span className="milestone__bar" aria-hidden="true">
              <span style={{ '--share': `${(share * 100).toFixed(1)}%` } as CSSProperties} />
            </span>
          )}
        </summary>
        {m.tasks.length > 0 && (
          <ul className="milestone__tasks">
            {m.tasks.map((t) => (
              <li key={t.key} className={`ptask${t.word === 'Dropped' ? ' ptask--dropped' : ''}`}>
                <span className="ptask__main">
                  {t.task ? (
                    <button type="button" className="ptask__title ptask__title--button" onClick={() => onTask(t.task ?? '')}>
                      {t.title}
                    </button>
                  ) : (
                    <span className="ptask__title">{t.title}</span>
                  )}
                  <span className="ptask__owner">{t.owner}</span>
                </span>
                <span className={`task-word task-word--${t.tone}`}>{t.word}</span>
              </li>
            ))}
          </ul>
        )}
        {m.extra > 0 && (
          <p className="milestone__extra">
            Plus {m.extra === 1 ? 'one smaller task' : `${m.extra} smaller tasks`} the team split off.{' '}
            <a className="link" href={tasksHref} onClick={follow(tasksHref)}>
              Open the task board
            </a>
          </p>
        )}
      </details>
    </li>
  );
}

function Since({ since, id, onInbox }: { since: SinceView; id: string; onInbox: () => void }) {
  if (since.kind === 'unknown') return null;
  return (
    <section id={id} className="progress__section progress__section--since" aria-labelledby={`${id}-title`} tabIndex={-1}>
      <h3 id={`${id}-title`} className="progress__h3">
        Since you last looked
      </h3>
      {since.kind === 'first' ? (
        <p className="progress__muted">This is your first look. Next time, what happened while you were away shows here.</p>
      ) : (
        <>
          <p className="progress__note">
            You last looked {since.ago}. {since.summary}
          </p>
          {since.finishedCount > 0 && (
            <div className="since__group">
              <h4 className="since__h4">
                {capital(countWord(since.finishedCount))} {since.finishedCount === 1 ? 'task' : 'tasks'} finished
              </h4>
              <ul className="since__list">
                {since.finished.map((f) => (
                  <li key={f.key} className="since__item">
                    {f.files.length > 0 ? (
                      <details>
                        <summary>
                          <span className="since__what">{f.title}</span>
                          <span className="since__meta">
                            {f.by}, {f.ago}, {f.files.length === 1 ? 'one file' : `${countWord(f.files.length)} files`}
                          </span>
                        </summary>
                        <p className="check__key">{f.files.length === 1 ? 'The file it changed' : `The ${f.files.length} files it changed`}</p>
                        <ul className="check__files">
                          {f.files.map((file) => (
                            <li key={file}>
                              <code>{file}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <p className="since__row">
                        <span className="since__what">{f.title}</span>
                        <span className="since__meta">
                          {f.by}, {f.ago}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {since.finishedCount > since.finished.length && <p className="progress__muted">And {since.finishedCount - since.finished.length} more on the task board.</p>}
            </div>
          )}
          {since.decisionCount > 0 && (
            <div className="since__group">
              <h4 className="since__h4">
                {capital(countWord(since.decisionCount))} {since.decisionCount === 1 ? 'decision' : 'decisions'}
              </h4>
              <ul className="since__list">
                {since.decisions.map((d) => (
                  <li key={d.key} className="since__item">
                    <p className="since__row">
                      <span className="since__what">{d.what}</span>
                      <span className="since__meta">
                        {d.by}, {d.ago}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(since.spent !== null || since.waiting > 0) && (
            <dl className="since__facts">
              {since.spent !== null && (
                <div>
                  <dt>Spent</dt>
                  <dd>{since.spent}</dd>
                </div>
              )}
              {since.waiting > 0 && (
                <div>
                  <dt>Waiting for you</dt>
                  <dd>
                    <button type="button" className="link" onClick={onInbox}>
                      {waitingWords(since.waiting)}
                    </button>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </>
      )}
    </section>
  );
}
