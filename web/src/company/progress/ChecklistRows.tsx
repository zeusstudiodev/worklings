// The checklist's rows (SPEC-v0.2.md, "Simple, visible, proven", 3), shared by the progress view and the handover: each
// thing you asked for as a sentence with its state in a word and a mark, your own words under it, the tasks that build it
// (progress only), and what the final review saw one press away: the check it ran and its result, the files, and the
// page on the preview while the app runs.
import type { ChecklistState } from '../../../../src/core/steering.ts';
import type { CheckRow } from './checklistModel.ts';
import './progress.css';

/** The state's mark, drawn on a 20-unit grid like the shell's glyphs; the word beside it always says it too. */
function Mark({ state }: { state: ChecklistState }) {
  return (
    <svg className={`check__mark check__mark--${state}`} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {state === 'met' && (
        <>
          <circle cx="10" cy="10" r="9" />
          <path d="m5.8 10.4 2.8 2.8 5.6-6" />
        </>
      )}
      {state === 'partly' && (
        <>
          <circle cx="10" cy="10" r="8.2" />
          <path d="M10 1.8a8.2 8.2 0 0 1 0 16.4z" />
        </>
      )}
      {state === 'not-met' && (
        <>
          <circle cx="10" cy="10" r="8.2" />
          <path d="m6.8 6.8 6.4 6.4M13.2 6.8l-6.4 6.4" />
        </>
      )}
      {state === 'unchecked' && <circle cx="10" cy="10" r="8.2" />}
    </svg>
  );
}

interface ChecklistRowsProps {
  rows: CheckRow[];
  /** Shows the tasks that build each item; a task with a board task opens it. */
  onTask?: (task: string) => void;
  /** Open the evidence of every marked item that isn't met (the handover, where it is what to look at first). */
  openShortfalls?: boolean;
}

export function ChecklistRows({ rows, onTask, openShortfalls = false }: ChecklistRowsProps) {
  return (
    <ol className="checklist">
      {rows.map((r) => (
        <li key={r.id} className={`check check--${r.state}`}>
          <Mark state={r.state} />
          <div className="check__body">
            <p className="check__head">
              <span className="check__text">{r.text}</span>
              <span className={`check__word check__word--${r.state}`}>
                <span className="visually-hidden">. </span>
                {r.word}
              </span>
            </p>
            {r.quote && (
              <p className="check__quote">
                <span className="visually-hidden">Your words: </span>“{r.quote}”
              </p>
            )}
            {onTask &&
              (r.tasks.length > 0 ? (
                <ul className="check__tasks" aria-label="Built in">
                  {r.tasks.map((t) => (
                    <li key={t.key} className="check__task">
                      {t.task ? (
                        <button type="button" className="link check__task-link" onClick={() => onTask(t.task ?? '')}>
                          {t.title}
                        </button>
                      ) : (
                        <span>{t.title}</span>
                      )}
                      <span className={`task-word task-word--${t.tone}`}>{t.word}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="check__none">No task covers this yet.</p>
              ))}
            {r.evidence && (
              <details className="check__evidence" open={openShortfalls && r.state !== 'met' ? true : undefined}>
                <summary>What the review saw</summary>
                <div className="check__evidence-body">
                  {r.evidence.note && <p>{r.evidence.note}</p>}
                  {r.evidence.check && <p className={r.evidence.passed === false ? 'check__ran check__ran--failed' : 'check__ran'}>{r.evidence.check}</p>}
                  {r.evidence.files.length > 0 && (
                    <>
                      <p className="check__key">Files</p>
                      <ul className="check__files">
                        {r.evidence.files.map((f) => (
                          <li key={f}>
                            <code>{f}</code>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {r.evidence.page && (
                    <p>
                      <a className="link" href={r.evidence.page.href} target="_blank" rel="noopener noreferrer">
                        Open {r.evidence.page.path} on the preview<span className="visually-hidden"> (opens a new tab)</span>
                      </a>
                    </p>
                  )}
                  <p className="check__by">Checked by {r.evidence.by}.</p>
                </div>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
