// Tasks in the side panel (docs/design-v3.md, "Tasks" and "Stage and dock"): a task's own page (`?panel=tasks/t-12`)
// with what changed and its diff, and Add a task (`?panel=tasks/new`). The tasks themselves are on the task board
// (board/TaskBoard.tsx). Steering (SPEC-v3.md "Steering", 4; Board.tsx) adds the plan task it came from, a task you add
// for anyone, and a task's place in line, pause, cancel and reassign.
import { type CSSProperties, useEffect, useEffectEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Task } from '../../../../src/core/company.ts';
import { inboxItemPath } from '../inbox/inboxModel.ts';
import { useCompanyClock } from '../people/clock.ts';
import { called, nameOf, roomName } from '../people/peopleModel.ts';
import { Clamp, CompanyLink } from '../people/shared.tsx';
import { planPath } from '../plan/planModel.ts';
import { companyHref, goBack, parseCompanyAddress, useLocation } from '../router.ts';
import type { TabProps } from '../types.ts';
import { StatePill } from '../ui/StatePill.tsx';
import { CreatedLine, NewTaskForm, NO_STEER, OFFLINE, TaskSteering } from './Board.tsx';
import { checkWords } from '../plan/checkModel.ts';
import { isOpenTask, originLine, steeredRow, steeredWord } from './boardModel.ts';
import { changedLine, diffFailedLine, fileCounts, fileCountsSaid } from './diffModel.ts';
import { diffKey, forgetDiff, loadDiff, useDiff } from './diffStore.ts';
import { taskPage } from './tasksModel.ts';
import './tasks.css';

type Props = TabProps & { task?: string; diff?: boolean };

/** A task's page, or, without one (`?panel=tasks/new`), Add a task. */
export function Tasks(props: Props) {
  if (props.task) return <TaskPageView key={props.task} {...props} taskId={props.task} />;
  return <NewTask {...props} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Add a task

/**
 * The new task form, opened by the board's Add a task. Adding it says who is told and offers the task, one press away;
 * closing goes back to what was open before, else to the side panel's home.
 */
function NewTask({ snapshot, company, companyId, navigate, online, steer }: Props) {
  const location = useLocation();
  const main = parseCompanyAddress(location.path, location.search)?.route.main ?? { kind: 'tasks' };
  const [created, setCreated] = useState<Task | null>(null);
  const close = () => goBack(companyHref(companyId, { main, panel: null }));
  if (!steer || company.phase !== 'running') {
    return (
      <div className="tasks__new">
        <p className="tasks__empty">{!steer ? NO_STEER : 'Tasks can be added once the company has started.'}</p>
      </div>
    );
  }
  return (
    <div className="tasks__new">
      {created ? (
        <>
          <CreatedLine company={company} companyId={companyId} navigate={navigate} task={created} />
          <button
            type="button"
            className="button tasks__add"
            data-focus="tasks:add"
            onClick={() => {
              flushSync(() => setCreated(null));
              document.querySelector<HTMLElement>('.board-new [tabindex="-1"]')?.focus();
            }}
          >
            Add another
          </button>
        </>
      ) : (
        <NewTaskForm
          company={company}
          steer={steer}
          online={online}
          roomName={(room) => roomName(snapshot, room)}
          onCreated={(task) => {
            flushSync(() => setCreated(task));
            document.querySelector<HTMLElement>('[data-focus="board:created-line"]')?.focus();
          }}
          onClose={close}
        />
      )}
      {!online && <p className="tasks__empty">{OFFLINE}</p>}
    </div>
  );
}

/** "Show the inbox": the side panel's home, over the main view that is open. */
function ShowTheInbox({ companyId }: { companyId: string }) {
  const location = useLocation();
  const main = parseCompanyAddress(location.path, location.search)?.route.main ?? { kind: 'tasks' };
  const href = companyHref(companyId, { main, panel: null });
  return (
    <a
      className="link"
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        goBack(href);
      }}
    >
      Show the inbox
    </a>
  );
}

/** Paused tasks are held whatever their status. */
const isPaused = (t: Task) => !!t.paused && isOpenTask(t);

function TaskRow({ task, depth, company, companyId, navigate, now }: { task: Task; depth: number; company: TabProps['company']; companyId: string; navigate: TabProps['navigate']; now: number }) {
  const read = useDiff(task.commit ? diffKey(companyId, task.id, task.commit) : null);
  const row = steeredRow(company, task, now, read?.state === 'done' ? read.diff.files.length : undefined);
  const lineId = `task-row-${task.id}`;
  const owner = nameOf(company, task.owner);
  return (
    <li className={`task-row task-row--${task.status}${isPaused(task) ? ' task-row--paused' : ''}`} style={{ '--depth': depth } as CSSProperties}>
      <CompanyLink companyId={companyId} to={`tasks/${encodeURIComponent(task.id)}`} navigate={navigate} className="task-row__link" focusKey={`tasks:${task.id}`} describedBy={lineId}>
        {row.title}
      </CompanyLink>
      <p id={lineId} className="task-row__line">
        <span className="visually-hidden">{steeredWord(task).word}. </span>
        {row.line}
      </p>
      {row.answer && (
        <CompanyLink companyId={companyId} to={inboxItemPath(row.answer)} navigate={navigate} className="link task-row__answer" label={`Answer ${owner.called}`}>
          Answer
        </CompanyLink>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A task's page

function TaskPageView({ snapshot, company, companyId, actions, navigate, announce, online, steer, taskId }: Props & { taskId: string }) {
  const task = company.tasks.find((t) => t.id === taskId);
  const heading = useRef<HTMLHeadingElement>(null);
  const now = useCompanyClock(snapshot.serverTime, online);
  const key = task?.commit ? diffKey(companyId, task.id, task.commit) : null;
  const read = useDiff(key);

  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const load = useEffectEvent(() => {
    if (key && task) loadDiff(key, () => actions.taskDiff(task.id));
  });
  useEffect(() => load(), [key]);

  const commit = task?.commit ?? null;

  if (!task) {
    return (
      <article className="task-page" aria-labelledby="task-gone">
        <h2 id="task-gone" ref={heading} className="task-page__title" tabIndex={-1}>
          That task isn't on the board any more.
        </h2>
        <ShowTheInbox companyId={companyId} />
      </article>
    );
  }

  const page = taskPage(company, task);
  const owner = company.people.find((p) => p.id === task.owner);
  const subtasks = page.subtasks;
  const word = steeredWord(task);
  const origin = originLine(company, task);
  const checked = checkWords(task, owner);
  return (
    <article className="task-page" aria-labelledby={`task-${task.id}`}>
      <h2 id={`task-${task.id}`} ref={heading} className="task-page__title" tabIndex={-1} data-panel-heading>
        {task.title}
      </h2>
      <StatePill label={word.word} tone={word.tone} />
      <p className="task-page__who">
        {page.owns} {page.asked}
      </p>
      {page.partOf && (
        <p className="task-page__part">
          Part of:{' '}
          {page.partOf.kind === 'task' ? (
            <CompanyLink companyId={companyId} to={`tasks/${encodeURIComponent(page.partOf.id)}`} navigate={navigate} className="link" focusKey={`task:${task.id}:parent`}>
              {page.partOf.title}
            </CompanyLink>
          ) : (
            page.partOf.title
          )}
        </p>
      )}
      {origin && (
        <p className="task-page__part">
          {origin}{' '}
          <CompanyLink companyId={companyId} to={planPath()} navigate={navigate} className="link" focusKey={`task:${task.id}:plan`}>
            See the plan
          </CompanyLink>
        </p>
      )}
      <TaskSteering company={company} task={task} steer={steer ?? null} online={online} announce={announce} roomName={(room) => roomName(snapshot, room)} />

      <h3 className="task-page__sub">Brief</h3>
      <Clamp text={page.brief} lines={6} className="task-page__brief" />
      <h3 className="task-page__sub">Done when</h3>
      <p className="task-page__text">{page.doneWhen}</p>
      {checked && (
        <>
          <h3 className="task-page__sub">Check</h3>
          <p className="task-page__text">
            <code>{checked.command}</code> <span className={`kind-tag kind-tag--${checked.state}`}>{checked.tag}</span>
          </p>
          <p className="task-page__text">{checked.sentence}</p>
          {checked.tail && (
            <details className="task-page__text">
              <summary>What it printed</summary>
              <pre className="task-page__tail">{checked.tail}</pre>
            </details>
          )}
        </>
      )}
      {task.followUp && (
        <>
          <h3 className="task-page__sub">{task.followUp.kind === 'fix' ? 'Sent back by the final review' : task.followUp.kind === 'recheck' ? 'Looking again after the fixes' : 'The end check'}</h3>
          {task.followUp.items.length > 0 && (
            <ul className="task-page__files">
              {task.followUp.items.map((item, i) => (
                <li key={`${i}:${item}`}>{item}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {page.files.length > 0 && (
        <>
          <h3 className="task-page__sub">Files it owns</h3>
          <ul className="task-page__files">
            {page.files.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {subtasks.length > 0 && (
        <>
          <h3 className="task-page__sub">Subtasks</h3>
          <ul className="task-rows">
            {subtasks.map((t) => (
              <TaskRow key={t.id} task={t} depth={0} {...{ company, companyId, navigate, now }} />
            ))}
          </ul>
        </>
      )}
      {page.outcome && (
        <>
          <h3 className="task-page__sub">Outcome</h3>
          <p className="task-page__text">{page.outcome}</p>
        </>
      )}
      {task.status !== 'dropped' && (
        <>
          <h3 className="task-page__sub">What changed</h3>
          {page.changes ? (
            <p className="task-page__text">{page.changes}</p>
          ) : !read || read.state === 'loading' ? (
            <p className="task-page__text" role="status">
              Reading the diff…
            </p>
          ) : read.state === 'failed' ? (
            <div className="task-page__text">
              <p>{diffFailedLine(read.error)}</p>
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (!key) return;
                  forgetDiff(key);
                  loadDiff(key, () => actions.taskDiff(task.id));
                }}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <p className="task-page__text">{changedLine(read.diff, commit ?? '', company.branch)}</p>
              <ul className="task-page__changed">
                {read.diff.files.map((f, i) => (
                  <li key={`${i}:${f.path}`}>
                    <code>{f.path}</code> <span className="task-page__counts" aria-hidden="true">{fileCounts(f)}</span>
                    <span className="visually-hidden">, {fileCountsSaid(f)}</span>
                  </li>
                ))}
              </ul>
              <CompanyLink companyId={companyId} to={`tasks/${encodeURIComponent(task.id)}/diff`} navigate={navigate} className="button" focusKey={`task:${task.id}:diff`}>
                Show the diff
              </CompanyLink>
            </>
          )}
        </>
      )}
      {owner && (
        <p className="task-page__message">
          <CompanyLink companyId={companyId} to={`people/${encodeURIComponent(owner.id)}/message`} navigate={navigate} className="button" focusKey={`task:${task.id}:message`}>
            Message {called(owner)}
          </CompanyLink>
        </p>
      )}
    </article>
  );
}
