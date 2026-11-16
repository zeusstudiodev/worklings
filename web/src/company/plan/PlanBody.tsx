// The plan itself (SPEC-v3.md "Steering", 1): the goal, then each milestone with its tasks in the order work is handed
// out in, each task with its owner, files, what it waits for and when it's done. On the latest version you change it in
// place: drag a task by its handle (across milestones too) or use Move up and Move down, cut, edit any field, add a task
// or a milestone. Each change goes into your draft with Undo in place; the page saves the draft as a new version.
import { type CSSProperties, Fragment, type Ref, useId, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CompanyView } from '../../../../src/core/company.ts';
import { countWord } from '../../../../src/core/now.ts';
import { PLAN_LIMITS, type Plan, type PlanComment, type PlanView } from '../../../../src/core/steering.ts';
import { Clamp, CompanyLink } from '../people/shared.tsx';
import type { TabProps } from '../types.ts';
import { StatePill } from '../ui/StatePill.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';
import { type DropLine } from './drag.ts';
import { milestoneMove, named, type PlanOp, taskDrop, taskMove, tasksIn, type TaskSlot } from './planEdit.ts';
import { PlanCommentForm, PlanGoalForm, PlanMilestoneForm, PlanTaskForm } from './PlanForms.tsx';
import { checkWords } from './checkModel.ts';
import { Checklist } from './Checklist.tsx';
import { contractsNote, contractViews, kindWords } from './contractsModel.ts';
import { boardTasksOf, boardWord, commentSign, commentsOn, latestOf, type MilestoneMark, milestoneProgress, planTaskView } from './planModel.ts';
import { useDragMove } from './useDragMove.ts';

/** Where a change shows its Undo: on the task or milestone it changed, or where the one it cut was. */
export type Where =
  | { kind: 'goal' }
  | { kind: 'task'; id: string }
  | { kind: 'gone-task'; milestone: string; before: string | null }
  | { kind: 'milestone'; id: string }
  | { kind: 'gone-milestone'; before: string | null }
  | { kind: 'item'; id: string }
  | { kind: 'gone-item'; before: string | null };

export interface LastChange {
  text: string;
  until: number;
  where: Where;
}

export type Editing = { kind: 'goal' } | { kind: 'task'; id: string } | { kind: 'add-task'; milestone: string } | { kind: 'milestone'; id: string } | { kind: 'add-milestone' } | null;

interface PlanBodyProps {
  company: CompanyView;
  /** A room's name, for grouping people in a task's form. */
  roomName: (room: string) => string;
  companyId: string;
  navigate: TabProps['navigate'];
  plan: Plan;
  /** The version shown, which a comment's version is compared with. */
  shownVersion: number;
  view: PlanView | null;
  marks: Record<string, MilestoneMark>;
  /** The latest version with steering bound: you can change it. */
  editable: boolean;
  /** Why a comment can't be sent now, or null when it can; undefined offers no comments (an older version). */
  commentUnavailable: string | null | undefined;
  onComment: (on: PlanComment['on'], text: string) => Promise<void>;
  onChange: (op: PlanOp, where: Where, focusUndo: boolean) => void;
  last: LastChange | null;
  onUndoLast: () => void;
  undoRef: Ref<HTMLButtonElement>;
  /** New ids for what you add. */
  newTaskId: () => string;
  newMilestoneId: () => string;
  newItemId: () => string;
  /** A search's matches; null shows everything. */
  found: Set<string> | null;
  announce: (text: string) => void;
}

const readSlots = (area: HTMLElement, yOf: (el: Element) => number): DropLine<TaskSlot>[] =>
  Array.from(area.querySelectorAll<HTMLElement>('[data-drop-milestone]')).map((el) => ({ y: yOf(el), slot: { milestone: el.dataset.dropMilestone ?? '', before: el.dataset.dropBefore || null } }));

/** Puts focus on the element marked with a data-focus key, once it is on the page. */
function focusKey(key: string) {
  document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`)?.focus();
}

export function PlanBody(props: PlanBodyProps) {
  const { company, roomName, companyId, navigate, plan, shownVersion, view, marks, editable, commentUnavailable, onComment, onChange, last, onUndoLast, undoRef, found, announce } = props;
  const id = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [commenting, setCommenting] = useState<PlanComment['on'] | null>(null);
  const finding = found !== null;
  const contracts = contractViews(company, plan);
  const boardCheck = (task: (typeof company.tasks)[number] | undefined) => (task ? checkWords(task, company.people.find((p) => p.id === task.owner)) : null);
  const draggable = editable && !finding;
  const commentable = commentUnavailable !== undefined;
  const full = plan.tasks.length >= PLAN_LIMITS.tasks;

  const drag = useDragMove<TaskSlot>(readSlots, (task, slot) => {
    const op = taskDrop(plan, task, slot);
    if (op) onChange(op, { kind: 'task', id: task }, false);
  });
  const dropNowhere = drag.dragging !== null && drag.over !== null && taskDrop(plan, drag.dragging, drag.over) === null;
  const isOver = (milestone: string, before: string | null) => !dropNowhere && drag.over !== null && drag.over.milestone === milestone && drag.over.before === before;

  const toggle = (task: string) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(task)) next.delete(task);
    else next.add(task);
    return next;
  });

  /** Closes a form; focus goes back to what opened it. */
  const close = (back: string) => {
    flushSync(() => {
      setEditing(null);
      setCommenting(null);
    });
    focusKey(back);
  };
  const save = (op: PlanOp, where: Where) => {
    flushSync(() => setEditing(null));
    onChange(op, where, true);
  };
  const move = (op: PlanOp | null, task: string) => {
    if (op) onChange(op, { kind: 'task', id: task }, false);
  };

  const undoLine = (where: Where['kind'], key: string | null) =>
    last && last.where.kind === where && ('id' in last.where ? last.where.id === key : true) ? <UndoLine ref={undoRef} text={last.text} until={last.until} onUndo={onUndoLast} /> : null;

  const comments = (on: PlanComment['on']) => {
    const list = commentsOn(view, on);
    if (list.length === 0) return null;
    return (
      <ul className="plan-comments" aria-label={`${list.length === 1 ? 'One comment' : `${countWord(list.length)} comments`}`}>
        {list.map((c) => (
          <li key={c.id} className="plan-comment">
            <p className="plan-comment__sign">{commentSign(company, c, shownVersion)}</p>
            <Clamp text={c.text} lines={4} className="plan-comment__text" />
          </li>
        ))}
      </ul>
    );
  };
  const commentForm = (on: PlanComment['on'], title: string, back: string) =>
    commenting && commenting.kind === on.kind && (on.kind === 'plan' || (commenting.kind !== 'plan' && commenting.id === on.id)) ? (
      <PlanCommentForm
        title={title}
        on={on}
        unavailable={commentUnavailable ?? null}
        send={onComment}
        onSent={() => {
          announce('Comment sent to the CEO.');
          close(back);
        }}
        onClose={() => close(back)}
      />
    ) : null;

  const goneTask = (milestone: string, before: string | null) =>
    last && last.where.kind === 'gone-task' && last.where.milestone === milestone && last.where.before === before ? (
      <li key={`gone:${before ?? 'end'}`} className="plan-task plan-task--gone" data-undo-item>
        <UndoLine ref={undoRef} text={last.text} until={last.until} onUndo={onUndoLast} />
      </li>
    ) : null;

  return (
    <>
      <section className="plan-section plan-goal" aria-labelledby={`${id}-goal`}>
        <h3 id={`${id}-goal`} className="group-title">
          The goal
        </h3>
        <p className="plan-goal__text">{plan.goal || 'No goal yet.'}</p>
        {editable && editing?.kind !== 'goal' && (
          <button type="button" className="link plan-link" data-focus="plan-goal-edit" onClick={() => setEditing({ kind: 'goal' })}>
            Change the goal
          </button>
        )}
        {editing?.kind === 'goal' && <PlanGoalForm goal={plan.goal} onSave={(goal) => save({ op: 'goal', goal }, { kind: 'goal' })} onClose={() => close('plan-goal-edit')} />}
        {undoLine('goal', null)}
      </section>

      {!finding && (editable || (plan.checklist?.length ?? 0) > 0) && (
        <Checklist plan={plan} editable={editable} onChange={onChange} last={last} onUndoLast={onUndoLast} undoRef={undoRef} newItemId={props.newItemId} />
      )}

      <div className={`plan-milestones${drag.dragging ? ' is-dragging' : ''}`} data-drag-area>
        {plan.milestones.map((m, mi) => {
          const all = tasksIn(plan, m.id);
          const tasks = found ? all.filter((t) => found.has(t.id)) : all;
          if (finding && tasks.length === 0) return null;
          const mark = marks[m.id];
          // The board's progress belongs to the latest version: an older one says "Not approved" and nothing about the work.
          const progress = latestOf(view)?.version === shownVersion ? milestoneProgress(company, plan, m.id) : null;
          const folded = !finding && progress !== null && progress.done === progress.total && progress.total > 0;
          const up = milestoneMove(plan, m.id, 'up');
          const down = milestoneMove(plan, m.id, 'down');
          const goneBefore = last?.where.kind === 'gone-milestone' && last.where.before === m.id;
          const rows = (
            <ol className="plan-tasks">
              {tasks.map((t) => {
                const v = planTaskView(company, plan, t);
                const isOpen = open.has(t.id) || (editing?.kind === 'task' && editing.id === t.id);
                const board = boardTasksOf(company, t.id)[0];
                const said = commentsOn(view, { kind: 'task', id: t.id }).length;
                const tUp = taskMove(plan, t.id, 'up');
                const tDown = taskMove(plan, t.id, 'down');
                const detailsId = `${id}-task-${t.id}`;
                return (
                  <Fragment key={t.id}>
                    {goneTask(m.id, t.id)}
                    <li
                    className={`plan-task${drag.dragging === t.id ? ' is-lifted' : ''}${isOver(m.id, t.id) ? ' is-drop-before' : ''}`}
                    data-drag-row
                    data-drop-milestone={m.id}
                    data-drop-before={t.id}
                    data-undo-item
                  >
                    {draggable && (
                      <span className="plan-task__grip" aria-hidden="true" title="Drag to move it" onPointerDown={(e) => drag.start(t.id, e)}>
                        <span className="plan-task__dots" />
                      </span>
                    )}
                    <div className="plan-task__main">
                      <p className="plan-task__head">
                        <span className="plan-task__number" aria-hidden="true">
                          {v.number}
                        </span>
                        <button type="button" className="plan-task__toggle" aria-expanded={isOpen} aria-controls={isOpen ? detailsId : undefined} data-focus={`plan-task:${t.id}`} onClick={() => toggle(t.id)}>
                          {v.title}
                        </button>
                        {kindWords(t.kind) && (
                          <span className="kind-tag" title={kindWords(t.kind)?.means}>
                            {kindWords(t.kind)?.label}
                            <span className="visually-hidden">. {kindWords(t.kind)?.means}</span>
                          </span>
                        )}
                      </p>
                      <p className={`plan-task__owner${v.owner.missing ? ' is-missing' : ''}`}>
                        {v.owner.text}
                        {v.owner.missing ? ", who isn't in the company" : ''}
                      </p>
                      {v.files.length > 0 && (
                        <p className="plan-task__meta">
                          <span className="plan-task__key">Files</span> <span className="plan-task__files">{v.files.join(', ')}</span>
                        </p>
                      )}
                      {v.waits.length > 0 && (
                        <p className="plan-task__meta">
                          <span className="plan-task__key">Waits for</span> {v.waits.map((w) => `“${w}”`).join(', ')}
                        </p>
                      )}
                      <p className="plan-task__meta plan-task__done">
                        <span className="plan-task__key">Done when</span> {v.doneWhen || 'not said yet'}
                      </p>
                      {v.check && (
                        <p className="plan-task__meta">
                          <span className="plan-task__key">Check</span> <code className="plan-task__code">{v.check}</code>
                          {boardCheck(board) && <span className={`kind-tag kind-tag--${boardCheck(board)?.state}`}>{boardCheck(board)?.tag}</span>}
                        </p>
                      )}
                      {board && (
                        <p className="plan-task__meta">
                          On the board:{' '}
                          <CompanyLink companyId={companyId} to={`tasks/${encodeURIComponent(board.id)}`} navigate={navigate} className="link" focusKey={`plan-board:${t.id}`} label={`${boardWord(board)}: ${v.title}, on the board`}>
                            {boardWord(board)}
                          </CompanyLink>
                        </p>
                      )}
                      {said > 0 && !isOpen && <p className="plan-task__meta">{said === 1 ? 'One comment' : `${countWord(said)} comments`}</p>}
                      {isOpen && (
                        <div id={detailsId} className="plan-task__details">
                          <h4 className="plan-task__sub">Brief</h4>
                          {v.brief ? <Clamp text={v.brief} lines={6} className="plan-task__brief" /> : <p className="plan-task__brief muted">No brief yet.</p>}
                          {comments({ kind: 'task', id: t.id })}
                          {(editable || commentable) && (
                            <div className="plan-task__actions">
                              {editable && !finding && (
                                <>
                                  <button type="button" className="link" aria-label={`Move up: ${v.title}`} aria-disabled={!tUp || undefined} onClick={() => move(tUp, t.id)}>
                                    Move up
                                  </button>
                                  <button type="button" className="link" aria-label={`Move down: ${v.title}`} aria-disabled={!tDown || undefined} onClick={() => move(tDown, t.id)}>
                                    Move down
                                  </button>
                                </>
                              )}
                              {editable && (
                                <button type="button" className="link" data-focus={`plan-edit:${t.id}`} onClick={() => setEditing({ kind: 'task', id: t.id })}>
                                  Edit<span className="visually-hidden"> {v.title}</span>
                                </button>
                              )}
                              {commentable && (
                                <button type="button" className="link" data-focus={`plan-comment:${t.id}`} onClick={() => setCommenting({ kind: 'task', id: t.id })}>
                                  Comment<span className="visually-hidden"> on {v.title}</span>
                                </button>
                              )}
                              {editable && (
                                <button
                                  type="button"
                                  className="link link--danger"
                                  onClick={() => {
                                    const next = all[all.findIndex((x) => x.id === t.id) + 1]?.id ?? null;
                                    onChange({ op: 'cut-task', id: t.id, name: t.title }, { kind: 'gone-task', milestone: m.id, before: next }, true);
                                  }}
                                >
                                  Cut<span className="visually-hidden"> {v.title}</span>
                                </button>
                              )}
                            </div>
                          )}
                          {finding && editable && <p className="plan-task__meta">Clear the search to move tasks.</p>}
                          {editing?.kind === 'task' && editing.id === t.id && (
                            <PlanTaskForm
                              company={company}
                              roomName={roomName}
                              plan={plan}
                              task={t}
                              adding={false}
                              onSave={(set) => save({ op: 'edit-task', id: t.id, name: t.title, set }, { kind: 'task', id: t.id })}
                              onClose={() => close(`plan-edit:${t.id}`)}
                            />
                          )}
                          {commentForm({ kind: 'task', id: t.id }, `Comment on ${named(t.title)}`, `plan-comment:${t.id}`)}
                        </div>
                      )}
                      {undoLine('task', t.id)}
                    </div>
                  </li>
                  </Fragment>
                );
              })}
              {goneTask(m.id, null)}
            </ol>
          );
          return (
            <Fragment key={m.id}>
            {goneBefore && last ? (
              <div className="plan-ms plan-ms--gone" data-undo-item>
                <UndoLine ref={undoRef} text={last.text} until={last.until} onUndo={onUndoLast} />
              </div>
            ) : null}
            <section className="plan-ms" aria-labelledby={`${id}-ms-${m.id}`} style={{ '--ms': mi } as CSSProperties}>
              <div className="plan-ms__head">
                <h3 id={`${id}-ms-${m.id}`} className="plan-ms__title" tabIndex={-1} data-focus={`plan-ms:${m.id}`}>
                  <span className="plan-ms__number" aria-hidden="true">
                    {mi + 1}
                  </span>
                  <span className="visually-hidden">Milestone {mi + 1}: </span>
                  {m.title}
                </h3>
                {mark && <StatePill label={mark.label} tone={mark.tone} />}
              </div>
              <p className="plan-ms__done">
                <span className="plan-task__key">Done when</span> {m.doneWhen || 'not said yet'}
              </p>
              {progress && <p className="plan-ms__progress">{progress.line}</p>}
              {(editable || commentable) && (
                <div className="plan-ms__actions">
                  {editable && (
                    <button type="button" className="link" data-focus={`plan-ms-edit:${m.id}`} onClick={() => setEditing({ kind: 'milestone', id: m.id })}>
                      Edit<span className="visually-hidden"> the milestone {m.title}</span>
                    </button>
                  )}
                  {editable && !finding && (
                    <>
                      <button type="button" className="link" aria-label={`Move up: the milestone ${m.title}`} aria-disabled={!up || undefined} onClick={() => up && onChange(up, { kind: 'milestone', id: m.id }, false)}>
                        Move up
                      </button>
                      <button type="button" className="link" aria-label={`Move down: the milestone ${m.title}`} aria-disabled={!down || undefined} onClick={() => down && onChange(down, { kind: 'milestone', id: m.id }, false)}>
                        Move down
                      </button>
                    </>
                  )}
                  {commentable && (
                    <button type="button" className="link" data-focus={`plan-ms-comment:${m.id}`} onClick={() => setCommenting({ kind: 'milestone', id: m.id })}>
                      Comment<span className="visually-hidden"> on the milestone {m.title}</span>
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      className="link link--danger"
                      onClick={() => onChange({ op: 'cut-milestone', id: m.id, name: m.title }, { kind: 'gone-milestone', before: plan.milestones[mi + 1]?.id ?? null }, true)}
                    >
                      Cut<span className="visually-hidden"> the milestone {m.title}</span>
                    </button>
                  )}
                </div>
              )}
              {comments({ kind: 'milestone', id: m.id })}
              {editing?.kind === 'milestone' && editing.id === m.id && (
                <PlanMilestoneForm milestone={m} adding={false} onSave={(set) => save({ op: 'edit-milestone', id: m.id, name: m.title, set }, { kind: 'milestone', id: m.id })} onClose={() => close(`plan-ms-edit:${m.id}`)} />
              )}
              {commentForm({ kind: 'milestone', id: m.id }, `Comment on the milestone ${named(m.title)}`, `plan-ms-comment:${m.id}`)}
              {undoLine('milestone', m.id)}
              {all.length === 0 && !goneTask(m.id, null) ? (
                <p className="plan-ms__empty">No tasks in this milestone yet.</p>
              ) : folded ? (
                <details className="plan-ms__fold">
                  <summary>Show its tasks</summary>
                  {rows}
                </details>
              ) : (
                rows
              )}
              <div className={`plan-tasks__end${isOver(m.id, null) ? ' is-drop-end' : ''}`} data-drop-milestone={m.id} data-drop-before="" />
              {editable && !finding && editing?.kind !== 'add-task' && (
                <button
                  type="button"
                  className="link plan-link plan-ms__add"
                  aria-disabled={full || undefined}
                  aria-describedby={full ? `${id}-full` : undefined}
                  data-focus={`plan-add:${m.id}`}
                  onClick={() => !full && setEditing({ kind: 'add-task', milestone: m.id })}
                >
                  Add a task to {named(m.title)}
                </button>
              )}
              {editing?.kind === 'add-task' && editing.milestone === m.id && (
                <PlanTaskForm
                  company={company}
                  roomName={roomName}
                  plan={plan}
                  task={{ id: props.newTaskId(), title: '', owner: '', files: [], milestone: m.id, after: [], brief: '', doneWhen: '' }}
                  adding
                  onSave={(fields) => {
                    const task = { id: props.newTaskId(), ...fields };
                    save({ op: 'add-task', task, before: null }, { kind: 'task', id: task.id });
                  }}
                  onClose={() => close(`plan-add:${m.id}`)}
                />
              )}
            </section>
            </Fragment>
          );
        })}
        {last?.where.kind === 'gone-milestone' && last.where.before === null && (
          <div className="plan-ms plan-ms--gone" data-undo-item>
            <UndoLine ref={undoRef} text={last.text} until={last.until} onUndo={onUndoLast} />
          </div>
        )}
      </div>
      {!finding && contracts.length > 0 && (
        <section className="plan-contracts" aria-labelledby={`${id}-contracts`}>
          <h3 id={`${id}-contracts`} className="group-title">
            Contracts
          </h3>
          <p className="group-note">{contractsNote(contracts.length)}</p>
          <ul className="plan-contracts__list">
            {contracts.map((c) => (
              <li key={c.id} className="plan-contract">
                <p className="plan-contract__title">{c.title}</p>
                <p className="plan-contract__file">
                  <code>{c.file}</code>
                </p>
                <p className={`plan-task__meta${c.writer.missing ? ' is-missing' : ''}`}>
                  <span className="plan-task__key">Written by</span> {c.writer.owner ? `${c.writer.owner}, in ` : ''}“{c.writer.title}”
                </p>
                <p className="plan-task__meta">
                  <span className="plan-task__key">Built against by</span> {c.dependents.length > 0 ? c.dependents.map((d) => `“${d}”`).join(', ') : 'nothing yet'}
                </p>
                {c.summary && <Clamp text={c.summary} lines={4} className="plan-contract__summary" />}
              </li>
            ))}
          </ul>
        </section>
      )}
      {full && editable && (
        <p id={`${id}-full`} className="plan-note">
          The plan holds {PLAN_LIMITS.tasks} tasks. Cut one to add another.
        </p>
      )}
      {editable && !finding && editing?.kind !== 'add-milestone' && (
        <button
          type="button"
          className="button plan-add-milestone"
          aria-disabled={plan.milestones.length >= PLAN_LIMITS.milestones || undefined}
          data-focus="plan-add-milestone"
          onClick={() => plan.milestones.length < PLAN_LIMITS.milestones && setEditing({ kind: 'add-milestone' })}
        >
          Add a milestone
        </button>
      )}
      {editable && plan.milestones.length >= PLAN_LIMITS.milestones && <p className="plan-note">The plan holds {PLAN_LIMITS.milestones} milestones. Cut one to add another.</p>}
      {editing?.kind === 'add-milestone' && (
        <PlanMilestoneForm
          milestone={{ title: '', doneWhen: '' }}
          adding
          onSave={(fields) => {
            const milestone = { id: props.newMilestoneId(), ...fields };
            save({ op: 'add-milestone', milestone, before: null }, { kind: 'milestone', id: milestone.id });
          }}
          onClose={() => close('plan-add-milestone')}
        />
      )}
    </>
  );
}
