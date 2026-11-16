// Steering the task board (SPEC-v3.md "Steering", 4): the order work is handed out in as you change it, a task's own
// controls on its page (its place in line, pause and resume, cancel with a reason, reassign with a handover note), the
// cancel and reassign forms the board's drops open, and a task you create for anyone. Each acts through the steering
// actions; a refusal shows its sentence where you pressed.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CompanyView, Task } from '../../../../src/core/company.ts';
import { PLAN_LIMITS } from '../../../../src/core/steering.ts';
import { nameOf } from '../people/peopleModel.ts';
import { CompanyLink, CopyButton, refusalOf } from '../people/shared.tsx';
import type { SteeringActions, TabProps } from '../types.ts';
import { useFocusSoon } from '../ui/useFocusSoon.ts';
import {
  blankTask,
  branchLine,
  cancelDecision,
  cancelHint,
  cancelLine,
  checkNewTask,
  choiceName,
  createdLine,
  handoverHint,
  handoverLines,
  moveInOrder,
  movedLine,
  type NewTaskDraft,
  type NewTaskField,
  newTaskInput,
  OrderQueue,
  pausedLine,
  pendingSettled,
  peopleByRoom,
  placeLine,
  priorityOrder,
  reachesLine,
  reassignChoices,
  steerable,
  steerSaid,
  toldLine,
  withPending,
} from './boardModel.ts';

export const OFFLINE = 'The office is reconnecting, so this waits.';
export const NO_STEER = "This office can't steer tasks from here yet.";

type Navigate = TabProps['navigate'];

// ---------------------------------------------------------------------------------------------------------------
// The order, sent as you change it

/**
 * The priority order as you change it: yours shows at once and goes to the office one request at a time (the latest
 * waits for the one on its way), until the stream shows the office's. A refusal puts the office's order back and says
 * so through `failed`. `moveSettled` does the same and settles once the office took it (or a later order that replaced
 * it), rejecting with the office's refusal, for a caller that says the outcome itself (the task board's result row).
 */
export function useTaskOrder(server: readonly string[], steer: SteeringActions | null, failed: ((text: string) => void) | null) {
  const [pending, setPending] = useState<string[] | null>(null);
  // The office's order when it took yours: once the stream moves on from it (or shows yours), the stream leads again.
  const [settledOn, setSettledOn] = useState<string | null>(null);
  const order = withPending(server, pending);
  if (pendingSettled(server, pending, settledOn)) {
    setPending(null);
    setSettledOn(null);
  }
  // The office's order as the stream last drew it, for the answer that arrives later.
  const serverNow = useRef(server);
  useEffect(() => {
    serverNow.current = server;
  });
  // The queue lives as long as the list, so what it calls is read as it is when it runs.
  const latest = useRef({ steer, failed });
  useEffect(() => {
    latest.current = { steer, failed };
  });
  const queue = useRef<OrderQueue | null>(null);
  // Those waiting to hear how their order went: an order replaced while it waited is answered with the one that went.
  const waiters = useRef<{ resolve: () => void; reject: (error: unknown) => void }[]>([]);
  const move = (next: string[]) => {
    if (!steer) return;
    setPending(next);
    queue.current ??= new OrderQueue((order) => latest.current.steer?.orderTasks(order) ?? Promise.resolve(), {
      started: () => setSettledOn(null),
      settled: () => {
        setSettledOn(serverNow.current.join('\n'));
        for (const w of waiters.current.splice(0)) w.resolve();
      },
      refused: (error) => {
        setPending(null);
        setSettledOn(null);
        for (const w of waiters.current.splice(0)) w.reject(error);
        latest.current.failed?.(`Couldn't change the order. ${refusalOf(error)}`);
      },
    });
    queue.current.push(next);
  };
  const moveSettled = (next: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!steer) {
        reject(new Error(NO_STEER));
        return;
      }
      waiters.current.push({ resolve, reject });
      move(next);
    });
  return { order, move, moveSettled };
}

// ---------------------------------------------------------------------------------------------------------------
// A task's own controls, on its page

type Busy = 'pause' | 'resume' | 'cancel' | 'reassign' | 'order' | 'undo' | null;

interface TaskSteeringProps {
  company: CompanyView;
  task: Task;
  steer: SteeringActions | null;
  online: boolean;
  announce: (text: string) => void;
  /** A room's name, for grouping people in the reassign form. */
  roomName: (room: string) => string;
}

export function TaskSteering({ company, task, steer, online, announce, roomName }: TaskSteeringProps) {
  const id = useId();
  const can = steerable(task);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [form, setForm] = useState<'cancel' | 'reassign' | null>(null);
  const section = useRef<HTMLElement>(null);
  const focusSoon = useFocusSoon();
  const inSection = (selector: string) => section.current?.querySelector<HTMLElement>(selector) ?? null;
  const unavailable = !steer ? NO_STEER : !online ? OFFLINE : null;
  const order = priorityOrder(company.tasks).map((t) => t.id);
  const place = can.order ? placeLine(order, task.id) : null;
  const paused = pausedLine(company, task);
  const cancelled = cancelLine(company, task);
  const branch = branchLine(company, task);
  const handovers = handoverLines(company, task);
  const undoable = cancelDecision(company, task);
  const owner = nameOf(company, task.owner).called;

  const controls = steer !== null && (can.pause || can.resume || can.cancel || can.reassign);
  if (!paused && !cancelled && handovers.length === 0 && !place && !controls && !problem) return null;

  const run = async (what: Busy, action: () => Promise<unknown>, said: string, failedWords: string) => {
    if (!steer || !online || busy) return false;
    setBusy(what);
    setProblem(null);
    try {
      await action();
      announce(said);
      return true;
    } catch (error) {
      const text = `${failedWords} ${refusalOf(error)}`;
      setProblem(text);
      announce(text);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const moveTo = (where: 'top' | 'up' | 'down' | 'bottom') => {
    const next = moveInOrder(order, task.id, where);
    if (!next || !steer) return;
    void run('order', () => steer.orderTasks(next), movedLine(next, task), "Couldn't change its place.");
  };
  const closeForm = (back: string) => {
    flushSync(() => setForm(null));
    document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(back)}"]`)?.focus();
  };

  return (
    <section ref={section} className="task-steer" aria-labelledby={steer ? `${id}-title` : undefined} aria-label={steer ? undefined : 'Its course'}>
      {steer && (
        <h3 id={`${id}-title`} className="task-page__sub" tabIndex={-1} data-steer="title">
          Steer it
        </h3>
      )}
      {paused && (
        <p className="task-steer__state" tabIndex={-1} data-undo-focus data-steer="paused">
          {paused} {can.resume ? `Its turns are held until it resumes.` : ''}
        </p>
      )}
      {cancelled && (
        <div className="task-steer__state" tabIndex={-1} data-undo-focus data-steer="cancelled">
          <p>{cancelled}</p>
          {branch && (
            <p>
              {branch.text}{' '}
              {branch.branch && (
                <>
                  <code className="task-steer__branch">{branch.branch}</code> <CopyButton text={branch.branch} what="the branch name" announce={announce} />
                </>
              )}
            </p>
          )}
          {undoable && steer && (
            <button
              type="button"
              className="link"
              aria-disabled={unavailable !== null || busy !== null || undefined}
              onClick={() => {
                // Its Undo goes with the cancelled line: focus follows to the controls that come back.
                focusSoon(() => (inSection('[data-steer="cancelled"]') ? null : (inSection('.task-steer__actions button') ?? inSection('[data-steer="title"]'))));
                void run('undo', () => steer.undoDecision(undoable), `${task.title} is back on the board.`, "Couldn't undo the cancel.");
              }}
            >
              {busy === 'undo' ? 'Undoing…' : 'Undo the cancel'}
            </button>
          )}
        </div>
      )}
      {handovers.length > 0 && (
        <>
          <h4 className="task-steer__sub">Handovers</h4>
          <ul className="task-steer__list">
            {handovers.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </>
      )}
      {place && (
        <div className="task-steer__place">
          <p className="task-steer__line">{place}</p>
          {steer && (
            <div className="task-steer__moves" role="group" aria-label="Its place in line">
              {(['top', 'up', 'down', 'bottom'] as const).map((where) => {
                const next = moveInOrder(order, task.id, where);
                return (
                  <button key={where} type="button" className="link" aria-disabled={!next || unavailable !== null || busy !== null || undefined} onClick={() => moveTo(where)}>
                    {where === 'top' ? 'Move to the top' : where === 'up' ? 'Up' : where === 'down' ? 'Down' : 'Move to the bottom'}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {controls && steer && (
        <>
          <div className="task-steer__actions">
            {can.resume && (
              <button
                type="button"
                className="button button--primary"
                aria-disabled={unavailable !== null || busy !== null || undefined}
                onClick={() => {
                  // Resume and Pause swap: focus goes to the one that replaces it.
                  focusSoon(() => (inSection('[data-steer="paused"]') ? null : (inSection('[data-steer-action="pause"]') ?? inSection('[data-steer="title"]'))));
                  void run('resume', () => steer.resumeTask(task.id), steerSaid.resumed(company, task), "Couldn't resume it.");
                }}
              >
                {busy === 'resume' ? 'Resuming…' : 'Resume'}
              </button>
            )}
            {can.pause && (
              <button
                type="button"
                className="button"
                aria-disabled={unavailable !== null || busy !== null || undefined}
                aria-describedby={`${id}-pause`}
                data-steer-action="pause"
                onClick={() => {
                  focusSoon(() => inSection('[data-steer="paused"]'));
                  void run('pause', () => steer.pauseTask(task.id), steerSaid.paused(company, task), "Couldn't pause it.");
                }}
              >
                {busy === 'pause' ? 'Pausing…' : 'Pause'}
              </button>
            )}
            {can.reassign && form !== 'reassign' && (
              <button type="button" className="button" data-focus={`steer-reassign:${task.id}`} onClick={() => setForm('reassign')}>
                Reassign
              </button>
            )}
            {can.cancel && form !== 'cancel' && (
              <button type="button" className="button button--danger" data-focus={`steer-cancel:${task.id}`} onClick={() => setForm('cancel')}>
                Cancel the task
              </button>
            )}
          </div>
          {can.pause && (
            <p id={`${id}-pause`} className="task-steer__hint">
              Pause stops {owner} and holds the task until you resume it.
            </p>
          )}
        </>
      )}
      {unavailable && can.cancel && <p className="task-steer__hint">{unavailable}</p>}
      {form === 'cancel' && steer && (
        <CancelForm
          company={company}
          task={task}
          unavailable={unavailable ?? (busy === 'cancel' ? 'Cancelling…' : null)}
          onCancel={async (reason) => {
            focusSoon(() => inSection('[data-steer="cancelled"]'));
            const ok = await run('cancel', () => steer.cancelTask(task.id, reason), steerSaid.cancelled(task), "Couldn't cancel it.");
            if (ok) setForm(null);
            return ok;
          }}
          onClose={() => closeForm(`steer-cancel:${task.id}`)}
        />
      )}
      {form === 'reassign' && steer && (
        <ReassignForm
          company={company}
          task={task}
          roomName={roomName}
          unavailable={unavailable ?? (busy === 'reassign' ? 'Reassigning…' : null)}
          onReassign={async (to, note) => {
            const ok = await run('reassign', () => steer.reassignTask(task.id, to, note), steerSaid.reassigned(company, task, to), "Couldn't reassign it.");
            if (ok) setForm(null);
            return ok;
          }}
          onClose={() => closeForm(`steer-reassign:${task.id}`)}
        />
      )}
      {problem && (
        <p className="board__problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** Focus goes to a form's heading when it opens, so a keyboard lands in it; or, given its id, to the field to fill in. */
function useHeadingFocus(field: string | null = null) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const target = field ? document.getElementById(field) : null;
    (target ?? heading.current)?.focus();
  }, [field]);
  return heading;
}

/** Where focus goes when a steering form opens: its heading (a task's page), or its first field (a card dropped on the board). */
export type FormFocus = 'heading' | 'field';

export interface CancelFormProps {
  company: CompanyView;
  task: Task;
  unavailable: string | null;
  onCancel: (reason: string) => Promise<boolean>;
  onClose: () => void;
  focus?: FormFocus;
}

export function CancelForm({ company, task, unavailable, onCancel, onClose, focus = 'heading' }: CancelFormProps) {
  const id = useId();
  const heading = useHeadingFocus(focus === 'field' ? `${id}-why` : null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const empty = !reason.trim();
  return (
    <form
      className="edit-form task-steer__form"
      aria-labelledby={`${id}-title`}
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setTried(true);
        if (empty) {
          document.getElementById(`${id}-why`)?.focus();
          return;
        }
        if (!unavailable) void onCancel(reason.trim());
      }}
    >
      <h4 id={`${id}-title`} className="edit-form__title" tabIndex={-1} ref={heading}>
        Cancel “{task.title}”
      </h4>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-why`}>
          Why (they read it)
        </label>
        <textarea id={`${id}-why`} className="prose-input" rows={2} maxLength={PLAN_LIMITS.note} value={reason} aria-required="true" aria-invalid={tried && empty ? true : undefined} aria-describedby={`${id}-hint${tried && empty ? ` ${id}-empty` : ''}`} onChange={(e) => setReason(e.target.value)} />
        {tried && empty && (
          <span id={`${id}-empty`} className="edit-form__problem">
            Say why, so {nameOf(company, task.owner).called} and their head know.
          </span>
        )}
      </div>
      <p id={`${id}-hint`} className="edit-form__hint">
        {cancelHint(company, task)}
      </p>
      <div className="edit-form__actions">
        <button type="submit" className="button button--danger" aria-disabled={unavailable !== null || undefined}>
          {unavailable === 'Cancelling…' ? 'Cancelling…' : 'Cancel the task'}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Keep it
        </button>
      </div>
      {unavailable && unavailable !== 'Cancelling…' && <p className="edit-form__why">{unavailable}</p>}
    </form>
  );
}

export interface ReassignFormProps {
  company: CompanyView;
  task: Task;
  roomName: (room: string) => string;
  unavailable: string | null;
  onReassign: (to: string, note: string) => Promise<boolean>;
  onClose: () => void;
  focus?: FormFocus;
  /** Who is chosen when it opens: the person whose lane the card was dropped in. */
  to?: string;
}

export function ReassignForm({ company, task, roomName, unavailable, onReassign, onClose, focus = 'heading', to: chosen }: ReassignFormProps) {
  const id = useId();
  const heading = useHeadingFocus(focus === 'field' ? `${id}-note` : null);
  const choices = reassignChoices(company, task);
  const groups = peopleByRoom(company, roomName, { except: task.owner, first: company.people.find((p) => p.id === task.owner)?.room ?? null });
  const [to, setTo] = useState(() => (chosen !== undefined && choices.some((p) => p.id === chosen) ? chosen : (choices[0]?.id ?? '')));
  const [note, setNote] = useState('');
  const owner = nameOf(company, task.owner).called;
  return (
    <form
      className="edit-form task-steer__form"
      aria-labelledby={`${id}-title`}
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!unavailable && to) void onReassign(to, note.trim());
      }}
    >
      <h4 id={`${id}-title`} className="edit-form__title" tabIndex={-1} ref={heading}>
        Reassign “{task.title}”
      </h4>
      {choices.length === 0 ? (
        <p className="edit-form__hint">Nobody else is in the company to take it over.</p>
      ) : (
        <>
          <label className="edit-field">
            <span className="edit-field__label">Who takes it over</span>
            <select className="select-input" value={to} onChange={(e) => setTo(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g.room} label={g.name}>
                  {g.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {choiceName(p)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="edit-field">
            <span className="edit-field__label">A handover note (optional)</span>
            <textarea id={`${id}-note`} className="prose-input" rows={3} maxLength={PLAN_LIMITS.note} value={note} aria-describedby={`${id}-hint`} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p id={`${id}-hint`} className="edit-form__hint">
            {to ? handoverHint(company, task, to) : ''}
          </p>
        </>
      )}
      <div className="edit-form__actions">
        {choices.length > 0 && (
          <button type="submit" className="button button--primary" aria-disabled={unavailable !== null || !to || undefined}>
            {unavailable === 'Reassigning…' ? 'Reassigning…' : `Reassign to ${to ? nameOf(company, to).called : 'them'}`}
          </button>
        )}
        <button type="button" className="button" onClick={onClose}>
          Keep it with {owner}
        </button>
      </div>
      {unavailable && unavailable !== 'Reassigning…' && <p className="edit-form__why">{unavailable}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A task you create

interface NewTaskFormProps {
  company: CompanyView;
  steer: SteeringActions;
  online: boolean;
  roomName: (room: string) => string;
  onCreated: (task: Task) => void;
  onClose: () => void;
}

export function NewTaskForm({ company, steer, online, roomName, onCreated, onClose }: NewTaskFormProps) {
  const id = useId();
  const heading = useHeadingFocus();
  const groups = peopleByRoom(company, roomName);
  // Nobody until you pick: a task meant for one person shouldn't go to whoever sorts first.
  const [d, setD] = useState<NewTaskDraft>(() => blankTask(''));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const problems = checkNewTask(d, company);
  const problemOf = (field: NewTaskField) => (tried || field === 'files' ? (problems.find((p) => p.field === field)?.text ?? null) : null);
  const unavailable = !online ? OFFLINE : busy ? 'Adding…' : null;
  const milestones = company.goal?.milestones ?? [];
  const told = toldLine(company, d.owner);
  const set = (change: Partial<NewTaskDraft>) => setD((x) => ({ ...x, ...change }));
  const describedBy = (field: NewTaskField, hint?: string) => [problemOf(field) ? `${id}-${field}-why` : null, hint ?? null].filter(Boolean).join(' ') || undefined;
  const why = (field: NewTaskField) =>
    problemOf(field) && (
      <span id={`${id}-${field}-why`} className="edit-form__problem">
        {problemOf(field)}
      </span>
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const first = problems[0];
    if (first) {
      document.getElementById(`${id}-${first.field}`)?.focus();
      return;
    }
    if (unavailable) return;
    setBusy(true);
    setProblem(null);
    steer.createTask(newTaskInput(d)).then(
      (task) => {
        setBusy(false);
        onCreated(task);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(`Couldn't add the task. ${refusalOf(error)}`);
      },
    );
  };

  return (
    <form className="edit-form board-new" aria-labelledby={`${id}-heading`} noValidate onSubmit={submit}>
      <h2 id={`${id}-heading`} className="edit-form__title" tabIndex={-1} ref={heading} data-panel-heading>
        Add a task
      </h2>
      <p className="edit-form__hint">
        Everything marked required has to be filled in.
      </p>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-title`}>
          Title (required)
        </label>
        <input id={`${id}-title`} className="text-input" value={d.title} maxLength={140} autoComplete="off" aria-required="true" aria-invalid={problemOf('title') ? true : undefined} aria-describedby={describedBy('title')} onChange={(e) => set({ title: e.target.value })} />
        {why('title')}
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-owner`}>
          Who does it (required)
        </label>
        <select id={`${id}-owner`} className="select-input" value={d.owner} aria-required="true" aria-invalid={problemOf('owner') ? true : undefined} aria-describedby={describedBy('owner', d.owner ? `${id}-owner-hint` : undefined)} onChange={(e) => set({ owner: e.target.value })}>
          <option value="">Pick who does it…</option>
          {groups.map((g) => (
            <optgroup key={g.room} label={g.name}>
              {g.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {choiceName(p)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {d.owner && (
          <span id={`${id}-owner-hint`} className="edit-form__hint">
            {reachesLine(company, d.owner)}
            {told ? ` ${told}` : ''}
          </span>
        )}
        {why('owner')}
      </div>
      {milestones.length > 0 && (
        <div className="edit-field">
          <label className="edit-field__label" htmlFor={`${id}-milestone`}>
            Milestone (optional)
          </label>
          <select id={`${id}-milestone`} className="select-input" value={d.milestone ?? ''} onChange={(e) => set({ milestone: e.target.value || null })}>
            <option value="">None</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-brief`}>
          Brief (required)
        </label>
        <textarea id={`${id}-brief`} className="prose-input" rows={3} value={d.brief} aria-required="true" aria-invalid={problemOf('brief') ? true : undefined} aria-describedby={describedBy('brief')} onChange={(e) => set({ brief: e.target.value })} />
        {why('brief')}
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-files`}>
          Files it may change, one per line (optional)
        </label>
        <textarea id={`${id}-files`} className="prose-input board-new__files" rows={2} spellCheck={false} value={d.files} aria-invalid={problemOf('files') ? true : undefined} aria-describedby={describedBy('files', `${id}-files-hint`)} onChange={(e) => set({ files: e.target.value })} />
        <span id={`${id}-files-hint`} className="edit-form__hint">
          Relative to the project, like src/footer/. Leave it empty for work that changes no file.
        </span>
        {why('files')}
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-doneWhen`}>
          Done when (required)
        </label>
        <textarea id={`${id}-doneWhen`} className="prose-input" rows={2} value={d.doneWhen} aria-required="true" aria-invalid={problemOf('doneWhen') ? true : undefined} aria-describedby={describedBy('doneWhen')} onChange={(e) => set({ doneWhen: e.target.value })} />
        {why('doneWhen')}
      </div>
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={unavailable !== null || undefined}>
          {busy ? 'Adding…' : 'Add the task'}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      {unavailable && !busy && <p className="edit-form__why">{unavailable}</p>}
      {problem && (
        <p className="edit-form__problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/** What adding a task leaves in place: the sentence, and the task one press away. */
export function CreatedLine({ company, companyId, navigate, task }: { company: CompanyView; companyId: string; navigate: Navigate; task: Task }) {
  return (
    <p className="board-created" tabIndex={-1} data-focus="board:created-line">
      {createdLine(company, task)}{' '}
      <CompanyLink companyId={companyId} to={`tasks/${encodeURIComponent(task.id)}`} navigate={navigate} className="link" focusKey="board:created">
        Open it
      </CompanyLink>
    </p>
  );
}
