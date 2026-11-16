// Changing the plan in the panel (SPEC-v3.md "Steering", 1): a task's form (title, owner, milestone, files, what it waits
// for, brief, done when), a milestone's, the goal's, and a comment for the CEO. A task's or milestone's form changes your
// draft at once, with Undo in place; only Save sends the plan to the office. A comment goes to the CEO as a message.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { PLAN_LIMITS, type Plan, type PlanComment, type PlanTask } from '../../../../src/core/steering.ts';
import { refusalOf } from '../people/shared.tsx';
import { choiceName, peopleByRoom } from '../tasks/boardModel.ts';
import { filesFrom, filesProblems, type MilestoneFields, named, type TaskFields } from './planEdit.ts';

/** A form takes focus on its heading when it opens, so a keyboard lands in it. */
function useHeadingFocus() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return heading;
}

/** Every task that waits for `id`, directly or through others: it can't wait for any of them. */
function waitersOf(plan: Plan, id: string): Set<string> {
  const out = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of plan.tasks) {
      if (!out.has(t.id) && t.after.some((a) => a === id || out.has(a))) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

interface TaskFormProps {
  company: CompanyView;
  /** A room's name, for grouping people in the owner's list. */
  roomName: (room: string) => string;
  plan: Plan;
  /** The task as it is, or a blank one in its milestone when adding. */
  task: PlanTask;
  adding: boolean;
  onSave: (fields: TaskFields) => void;
  onClose: () => void;
}

export function PlanTaskForm({ company, roomName, plan, task, adding, onSave, onClose }: TaskFormProps) {
  const id = useId();
  const heading = useHeadingFocus();
  const [title, setTitle] = useState(task.title);
  const [owner, setOwner] = useState(task.owner);
  const [milestone, setMilestone] = useState(task.milestone);
  const [files, setFiles] = useState(task.files.join('\n'));
  const [after, setAfter] = useState<string[]>(task.after);
  const [pick, setPick] = useState('');
  const [brief, setBrief] = useState(task.brief);
  const [doneWhen, setDoneWhen] = useState(task.doneWhen);
  const [tried, setTried] = useState(false);

  const blocked = waitersOf(plan, task.id);
  const choices = plan.tasks.filter((t) => t.id !== task.id && !after.includes(t.id) && !blocked.has(t.id));
  const groups = peopleByRoom(company, roomName);
  const ownerGone = !company.people.some((p) => p.id === owner);
  const fileList = filesFrom(files);
  const problems = {
    title: !title.trim() ? 'Give the task a title.' : null,
    owner: ownerGone ? (owner ? "Pick who does it: the plan named someone who isn't in the company." : 'Pick who does it.') : null,
    files: filesProblems(fileList, 'This task')[0] ?? null,
    doneWhen: !doneWhen.trim() ? "Say when it's done, so its owner knows when to stop." : null,
  };
  const valid = Object.values(problems).every((p) => p === null);
  const shownProblem = (field: keyof typeof problems) => (tried ? problems[field] : field === 'files' ? problems.files : null);
  const fields: TaskFields = { title: title.trim(), owner, milestone, files: fileList, after, brief: brief.trim(), doneWhen: doneWhen.trim() };
  const changed = adding || JSON.stringify(fields) !== JSON.stringify({ title: task.title, owner: task.owner, milestone: task.milestone, files: task.files, after: task.after, brief: task.brief, doneWhen: task.doneWhen });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!valid) {
      const first = (Object.keys(problems) as (keyof typeof problems)[]).find((k) => problems[k] !== null);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    if (changed) onSave(fields);
    else onClose();
  };
  const described = (field: keyof typeof problems, hint?: string) => [shownProblem(field) ? `${id}-${field}-why` : null, hint ?? null].filter(Boolean).join(' ') || undefined;
  const why = (field: keyof typeof problems) =>
    shownProblem(field) && (
      <span id={`${id}-${field}-why`} className="edit-form__problem">
        {shownProblem(field)}
      </span>
    );

  return (
    <form className="edit-form plan-form" aria-labelledby={`${id}-heading`} onSubmit={submit} noValidate>
      <h4 id={`${id}-heading`} className="edit-form__title" tabIndex={-1} ref={heading}>
        {adding ? 'Add a task' : `Change ${named(task.title)}`}
      </h4>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-title`}>
          Title
        </label>
        <input id={`${id}-title`} className="text-input" value={title} maxLength={PLAN_LIMITS.title} autoComplete="off" aria-invalid={shownProblem('title') ? true : undefined} aria-describedby={described('title')} onChange={(e) => setTitle(e.target.value)} />
        {why('title')}
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-owner`}>
          Who does it
        </label>
        <select id={`${id}-owner`} className="select-input" value={owner} aria-invalid={shownProblem('owner') ? true : undefined} aria-describedby={described('owner')} onChange={(e) => setOwner(e.target.value)}>
          {ownerGone && <option value={owner}>{owner ? 'Someone who left the company' : 'Pick who does it…'}</option>}
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
        {why('owner')}
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-milestone`}>
          Milestone
        </label>
        <select id={`${id}-milestone`} className="select-input" value={milestone} aria-describedby={milestone !== task.milestone && !adding ? `${id}-moves` : undefined} onChange={(e) => setMilestone(e.target.value)}>
          {plan.milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        {milestone !== task.milestone && !adding && (
          <span id={`${id}-moves`} className="edit-form__hint">
            It moves to the end of that milestone.
          </span>
        )}
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-files`}>
          Files it may change, one per line
        </label>
        <textarea id={`${id}-files`} className="prose-input plan-form__files" rows={3} value={files} spellCheck={false} aria-invalid={shownProblem('files') ? true : undefined} aria-describedby={described('files', `${id}-files-hint`)} onChange={(e) => setFiles(e.target.value)} />
        <span id={`${id}-files-hint`} className="edit-form__hint">
          Relative to the project, like src/cart/. Tasks that run at once never share one.
        </span>
        {why('files')}
      </div>
      <fieldset className="plan-form__waits">
        <legend className="edit-field__label">Waits for</legend>
        {after.length === 0 ? (
          <p className="edit-form__hint">Nothing: it can start as soon as its milestone does.</p>
        ) : (
          <ul className="plan-form__wait-list">
            {after.map((a) => (
              <li key={a}>
                <span>{plan.tasks.find((t) => t.id === a)?.title ?? 'A task no longer in the plan'}</span>
                <button type="button" className="link" onClick={() => setAfter(after.filter((x) => x !== a))}>
                  Remove<span className="visually-hidden"> {plan.tasks.find((t) => t.id === a)?.title ?? 'it'} from what it waits for</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {choices.length > 0 && after.length < PLAN_LIMITS.after && (
          <div className="plan-form__wait-add">
            <label className="visually-hidden" htmlFor={`${id}-pick`}>
              A task it waits for
            </label>
            <select id={`${id}-pick`} className="select-input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Pick a task…</option>
              {plan.milestones.map((m) => {
                const list = choices.filter((t) => t.milestone === m.id);
                return list.length === 0 ? null : (
                  <optgroup key={m.id} label={m.title}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <button
              type="button"
              className="button"
              aria-disabled={!pick || undefined}
              onClick={() => {
                if (!pick) return;
                setAfter([...after, pick]);
                setPick('');
              }}
            >
              Add
            </button>
          </div>
        )}
      </fieldset>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-brief`}>
          Brief
        </label>
        <textarea id={`${id}-brief`} className="prose-input" rows={4} maxLength={PLAN_LIMITS.brief} value={brief} aria-describedby={`${id}-brief-hint`} onChange={(e) => setBrief(e.target.value)} />
        <span id={`${id}-brief-hint`} className="edit-form__hint">
          What its owner starts from, with the files and when it's done.
        </span>
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-doneWhen`}>
          Done when
        </label>
        <textarea id={`${id}-doneWhen`} className="prose-input" rows={2} maxLength={PLAN_LIMITS.doneWhen} value={doneWhen} aria-invalid={shownProblem('doneWhen') ? true : undefined} aria-describedby={described('doneWhen')} onChange={(e) => setDoneWhen(e.target.value)} />
        {why('doneWhen')}
      </div>
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary">
          {adding ? 'Add the task' : 'Save changes'}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="edit-form__hint">This changes your draft. The plan changes when you save it.</p>
    </form>
  );
}

interface MilestoneFormProps {
  milestone: MilestoneFields;
  adding: boolean;
  onSave: (fields: MilestoneFields) => void;
  onClose: () => void;
}

export function PlanMilestoneForm({ milestone, adding, onSave, onClose }: MilestoneFormProps) {
  const id = useId();
  const heading = useHeadingFocus();
  const [title, setTitle] = useState(milestone.title);
  const [doneWhen, setDoneWhen] = useState(milestone.doneWhen);
  const [tried, setTried] = useState(false);
  const problems = { title: !title.trim() ? 'Give the milestone a title.' : null, doneWhen: !doneWhen.trim() ? "Say when it's done." : null };
  return (
    <form
      className="edit-form plan-form"
      aria-labelledby={`${id}-heading`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (problems.title || problems.doneWhen) {
          document.getElementById(problems.title ? `${id}-title` : `${id}-done`)?.focus();
          return;
        }
        if (adding || title.trim() !== milestone.title || doneWhen.trim() !== milestone.doneWhen) onSave({ title: title.trim(), doneWhen: doneWhen.trim() });
        else onClose();
      }}
    >
      <h4 id={`${id}-heading`} className="edit-form__title" tabIndex={-1} ref={heading}>
        {adding ? 'Add a milestone' : `Change the milestone ${named(milestone.title)}`}
      </h4>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-title`}>
          Title
        </label>
        <input id={`${id}-title`} className="text-input" value={title} maxLength={PLAN_LIMITS.title} autoComplete="off" aria-invalid={tried && problems.title ? true : undefined} aria-describedby={tried && problems.title ? `${id}-title-why` : undefined} onChange={(e) => setTitle(e.target.value)} />
        {tried && problems.title && (
          <span id={`${id}-title-why`} className="edit-form__problem">
            {problems.title}
          </span>
        )}
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-done`}>
          Done when
        </label>
        <textarea id={`${id}-done`} className="prose-input" rows={2} maxLength={PLAN_LIMITS.doneWhen} value={doneWhen} aria-invalid={tried && problems.doneWhen ? true : undefined} aria-describedby={tried && problems.doneWhen ? `${id}-done-why` : undefined} onChange={(e) => setDoneWhen(e.target.value)} />
        {tried && problems.doneWhen && (
          <span id={`${id}-done-why`} className="edit-form__problem">
            {problems.doneWhen}
          </span>
        )}
      </div>
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary">
          {adding ? 'Add the milestone' : 'Save changes'}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}

export function PlanGoalForm({ goal, onSave, onClose }: { goal: string; onSave: (goal: string) => void; onClose: () => void }) {
  const id = useId();
  const heading = useHeadingFocus();
  const [text, setText] = useState(goal);
  const [tried, setTried] = useState(false);
  const empty = !text.trim();
  return (
    <form
      className="edit-form plan-form"
      aria-labelledby={`${id}-heading`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (empty) {
          document.getElementById(`${id}-goal`)?.focus();
          return;
        }
        if (text.trim() !== goal) onSave(text.trim());
        else onClose();
      }}
    >
      <h4 id={`${id}-heading`} className="edit-form__title" tabIndex={-1} ref={heading}>
        Change the goal
      </h4>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-goal`}>
          Goal
        </label>
        <textarea id={`${id}-goal`} className="prose-input" rows={3} maxLength={PLAN_LIMITS.goal} value={text} aria-invalid={tried && empty ? true : undefined} aria-describedby={tried && empty ? `${id}-why` : undefined} onChange={(e) => setText(e.target.value)} />
        {tried && empty && (
          <span id={`${id}-why`} className="edit-form__problem">
            Say what the plan is for.
          </span>
        )}
      </div>
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary">
          Save changes
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}

interface CommentFormProps {
  /** "Comment on “Cart”". */
  title: string;
  on: PlanComment['on'];
  /** Why it can't be sent now (offline, an office that can't take it), or null. */
  unavailable: string | null;
  send: (on: PlanComment['on'], text: string) => Promise<void>;
  onSent: () => void;
  onClose: () => void;
}

/** A comment for the CEO on the plan, a milestone or a task: it reaches the CEO as a message, and the words stay if it fails. */
export function PlanCommentForm({ title, on, unavailable, send, onSent, onClose }: CommentFormProps) {
  const id = useId();
  const heading = useHeadingFocus();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const over = text.length > PLAN_LIMITS.comment;
  const blocked = unavailable ?? (busy ? 'Sending…' : null);
  return (
    <form
      className="edit-form plan-form"
      aria-labelledby={`${id}-heading`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const words = text.trim();
        if (!words || over || blocked) return;
        setBusy(true);
        setProblem(null);
        send(on, words).then(
          () => {
            setBusy(false);
            setText('');
            onSent();
          },
          (error: unknown) => {
            setBusy(false);
            setProblem(`Couldn't send your comment. ${refusalOf(error)}`);
          },
        );
      }}
    >
      <h4 id={`${id}-heading`} className="edit-form__title" tabIndex={-1} ref={heading}>
        {title}
      </h4>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-comment`}>
          Your comment
        </label>
        <textarea id={`${id}-comment`} className={`prose-input${over ? ' is-over' : ''}`} rows={3} value={text} aria-describedby={`${id}-hint`} onChange={(e) => setText(e.target.value)} />
      </div>
      <p id={`${id}-hint`} className="edit-form__hint">
        {over ? `${text.length.toLocaleString('en-US')} of 2,000. Shorten it by ${(text.length - PLAN_LIMITS.comment).toLocaleString('en-US')} to send.` : 'It reaches the CEO as a message, and the CEO answers with a new version or a reply.'}
      </p>
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={!text.trim() || over || blocked !== null || undefined}>
          {busy ? 'Sending…' : 'Send to the CEO'}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      {unavailable && <p className="edit-form__why">{unavailable}</p>}
      {problem && (
        <p className="edit-form__problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
