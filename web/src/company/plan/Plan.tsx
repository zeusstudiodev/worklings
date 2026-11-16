// The plan (SPEC-v3.md "Steering", 1; the address `plan`, and `plan/v3` for an older version). Where it stands and what
// you can approve; your changes, kept as a draft until you save them as one new version (with Undo); what the latest
// version changed from the one before; the plan itself, changed in place; comments for the CEO; the versions; and the
// Plan approval setting. Every action goes through the steering actions and says why when it is refused.
import { PlanSummaryCard } from './PlanSummaryCard.tsx';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { type CompanyView, STAKEHOLDER } from '../../../../src/core/company.ts';
import { countWord, plainText } from '../../../../src/core/now.ts';
import type { Plan as PlanShape, PlanComment, PlanVersion } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { whenAt } from '../../lib/format.ts';
import { roomName } from '../people/peopleModel.ts';
import { Clamp, CompanyLink, refusalOf } from '../people/shared.tsx';
import { backToOpener, companyPath } from '../router.ts';
import type { SteeringActions, TabProps } from '../types.ts';
import { draftScope } from '../ui/draftScope.ts';
import { keepClear } from '../ui/keepClear.ts';
import { StatePill } from '../ui/StatePill.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';
import { PlanApprovalSetting } from './PlanApprovalSetting.tsx';
import { type LastChange, PlanBody, type Where } from './PlanBody.tsx';
import { PlanCommentForm } from './PlanForms.tsx';
import { PlanDiffView } from './PlanDiffView.tsx';
import { applyOp, checkDraft, describeOp, type Draft, EMPTY_DRAFT, MAX_OPS, newItemId, newMilestoneId, newTaskId, type PlanOp, replay, withOp } from './planEdit.ts';
import {
  type ApproveChoice,
  approveChoices,
  approvalOf,
  approvedLine,
  commentSign,
  commentsOn,
  commentTarget,
  diffView,
  doneMilestones,
  FIND_PLAN_OVER,
  findInPlan,
  latestOf,
  milestoneMarks,
  olderVersionsLine,
  planOf,
  planPath,
  planState,
  previousOf,
  versionIn,
  versionRows,
  whoIn,
} from './planModel.ts';
import { useDraft } from './useDraft.ts';
import './plan.css';

const UNDO_SHOWN_MS = 10_000;
/** When Undo goes, for a change made now (called from handlers, never while drawing). */
const undoUntil = () => Date.now() + UNDO_SHOWN_MS;
const OFFLINE = 'The office is reconnecting, so this waits.';
const NO_STEER = "This office shows the plan but can't change it from here yet.";

type Props = TabProps & {
  /** An older version to show (`plan/v3`); null or absent for the latest. */
  version?: number | null;
  /**
   * The task board's sub-view (docs/design-v3.md, "The task board"): the board's frame has the title, the way back and
   * Board beside Plan, so the plan has no Back of its own and its title is the frame's next heading. It reads in an
   * 880 px column, the versions, the comments and the Plan approval setting beside it where the board is wide.
   */
  inBoard?: boolean;
};

export function Plan(props: Props) {
  const { company, companyId, inBoard = false } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  // Opening the plan puts focus on its title, as a task's page does.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const view = planOf(company);
  const latest = latestOf(view);
  const older = props.version !== undefined && props.version !== null && props.version !== latest?.version ? props.version : null;
  const title = older === null ? 'The plan' : `Version ${older} of the plan`;
  return (
    <article className={`plan${inBoard ? ' plan--board' : ''}`} aria-labelledby={`${id}-title`}>
      {!inBoard && (
        <button type="button" className="work-back" onClick={() => backToOpener(companyPath(companyId, older === null ? 'tasks' : planPath()))}>
          Back
        </button>
      )}
      {inBoard ? (
        <h3 id={`${id}-title`} ref={heading} className="plan__title" tabIndex={-1}>
          {title}
        </h3>
      ) : (
        <h2 id={`${id}-title`} ref={heading} className="plan__title" tabIndex={-1} data-panel-heading>
          {title}
        </h2>
      )}
      {older !== null ? <OlderVersion {...props} version={older} /> : latest ? <LatestPlan {...props} latest={latest} /> : <NoPlan {...props} />}
    </article>
  );
}

/**
 * The plan's parts: in the side panel one after the other; on the board the plan in its reading column and, beside it
 * where there is room, the versions, the comments and the setting. `foot` follows the plan's own column (its bar).
 */
function Layout({ inBoard, main, side, foot = null }: { inBoard: boolean; main: ReactNode; side: ReactNode; foot?: ReactNode }) {
  if (!inBoard) {
    return (
      <>
        {main}
        {side}
        {foot}
      </>
    );
  }
  return (
    <div className="plan-cols">
      <div className="plan-main">
        {main}
        {foot}
      </div>
      <div className="plan-side">{side}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Before the first version

function NoPlan(props: Props) {
  const { company, actions, online, announce } = props;
  const state = planState(company);
  const ceo = company.people.find((p) => p.level === 'ceo');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = state.kind === 'none' || state.kind === 'drafting';
  const ask = () => {
    if (!ceo || !online || busy) return;
    setBusy(true);
    setProblem(null);
    actions.say(ceo.id, 'Please propose a plan for my approval: the goal, the milestones and the tasks, with who does each.').then(
      () => {
        setBusy(false);
        setSent(true);
        announce('Sent to the CEO.');
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(`Couldn't send it to the CEO. ${refusalOf(error)}`);
      },
    );
  };
  return (
    <Layout
      inBoard={props.inBoard ?? false}
      main={
        <>
          <PlanStateLines company={company} />
          {running && ceo && (
            <div className="plan-actions">
              <button type="button" className="button" aria-disabled={!online || busy || undefined} aria-describedby={!online ? 'plan-ask-why' : undefined} onClick={ask}>
                {busy ? 'Sending…' : 'Ask the CEO for a plan'}
              </button>
              {!online && (
                <p id="plan-ask-why" className="plan-note">
                  {OFFLINE}
                </p>
              )}
              {sent && <p className="plan-note">Sent. The CEO reads it at their next step.</p>}
              {problem && (
                <p className="plan-problem" role="alert">
                  {problem}
                </p>
              )}
            </div>
          )}
        </>
      }
      side={<PlanApprovalSetting company={company} steer={props.steer} online={online} announce={announce} variant="plan" />}
    />
  );
}

/** The state pill and sentences; focusable, so focus has somewhere to land when what was pressed goes away. */
function PlanStateLines({ company }: { company: CompanyView }) {
  const state = planState(company);
  return (
    <div className="plan-state" tabIndex={-1} data-undo-focus>
      {state.pill && <StatePill label={state.pill.label} tone={state.pill.tone} />}
      {state.lines.map((line) => (
        <p key={line} className="plan-state__line">
          {line}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The latest version, which you approve and change

type Busy = 'save' | 'approve' | null;

function LatestPlan(props: Props & { latest: PlanVersion }) {
  const { company, companyId, navigate, announce, online, latest } = props;
  const steer: SteeringActions | null = props.steer ?? null;
  const id = useId();
  const view = planOf(company);
  const setting = approvalOf(company);
  const [draft, setDraft] = useDraft(draftScope(company));
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<{ where: 'change' | 'save' | 'approve'; text: string } | null>(null);
  // The office's own sentences when it turned your version down; the draft stays so you can fix it.
  const [refused, setRefused] = useState<string[] | null>(null);
  const [last, setLast] = useState<(LastChange & { back: string }) | null>(null);
  // A saved draft shows as it was saved until the office's new version reaches this view.
  const [sent, setSent] = useState<{ plan: PlanShape; base: number } | null>(null);
  if (sent && latest.version !== sent.base) setSent(null);
  const [saved, setSaved] = useState<{ until: number; before: PlanShape; base: number } | null>(null);
  const [discarded, setDiscarded] = useState<{ draft: Draft; until: number } | null>(null);
  const [query, setQuery] = useState('');
  const [commenting, setCommenting] = useState(false);
  const undoRef = useRef<HTMLButtonElement>(null);
  const savedRef = useRef<HTMLButtonElement>(null);
  const changesRef = useRef<HTMLHeadingElement>(null);
  // One save or approval at a time.
  const pressing = useRef(false);

  const replayed = replay(latest.plan, draft.ops);
  const shown = sent ? sent.plan : replayed.plan;
  const changes = diffView(latest.plan, shown, company);
  const changed = !sent && (changes.sections.length > 0 || changes.goal !== null);
  const versions = view?.versions.map((v) => v.plan) ?? [];
  const problems = changed ? checkDraft(shown, company.people, versions) : [];
  const done = doneMilestones(company, latest.plan);
  const choices = approveChoices(view, setting, done);
  const marks = milestoneMarks(view, latest, setting, done);
  const finding = shown.tasks.length > FIND_PLAN_OVER && query.trim() !== '';
  const found = finding ? findInPlan(company, shown, query) : null;
  const previous = previousOf(view, latest.version);
  const revision = previous ? diffView(previous.plan, latest.plan, company) : null;
  const planComments = commentsOn(view, { kind: 'plan' });
  const allComments = view?.comments ?? [];
  const unavailable = !steer ? NO_STEER : !online ? OFFLINE : null;
  const editable = steer !== null;
  const approveWhy = unavailable ?? (changed ? 'Save or discard your changes first: approval is for a saved version.' : busy === 'approve' ? 'Approving…' : null);
  const saveWhy = unavailable ?? (problems.length > 0 ? 'Fix what stops the save first.' : busy === 'save' ? 'Saving…' : null);

  const backOf = (op: PlanOp): string => {
    switch (op.op) {
      case 'goal':
        return 'plan-goal-edit';
      case 'edit-task':
      case 'move-task':
      case 'cut-task':
        return `plan-task:${op.id}`;
      case 'edit-milestone':
      case 'move-milestone':
      case 'cut-milestone':
        return `plan-ms:${op.id}`;
      case 'add-task':
        return `plan-add:${op.task.milestone}`;
      case 'add-milestone':
        return 'plan-add-milestone';
      case 'add-item':
        return 'plan-checklist-add';
      case 'edit-item':
      case 'cut-item':
        return `plan-item:${op.id}`;
    }
  };

  const change = (op: PlanOp, where: Where, focusUndo: boolean) => {
    const result = applyOp(shown, op);
    if (!result.ok) {
      setProblem({ where: 'change', text: result.why });
      return;
    }
    // The draft holds a fixed number of changes and never drops the oldest: past it, save first.
    if (withOp(draft, op) === null) {
      const text = `A draft holds ${MAX_OPS} changes. Save these first, then carry on.`;
      setProblem({ where: 'change', text });
      announce(text);
      return;
    }
    const text = describeOp(shown, result.plan, op);
    setDraft((d) => withOp(d, op) ?? d);
    setLast({ text, until: undoUntil(), where, back: backOf(op) });
    setSaved(null);
    setDiscarded(null);
    setRefused(null);
    setProblem(null);
    announce(text);
    if (focusUndo) window.setTimeout(() => undoRef.current?.focus(), 0);
  };

  /** Takes back your latest change; focus goes to what it changed, or to the plan's state when nothing is left. */
  const undoLast = () => {
    const op = draft.ops.at(-1);
    if (!op) return;
    const before = replay(latest.plan, draft.ops.slice(0, -1)).plan;
    const text = describeOp(before, shown, op);
    const back = last?.back ?? backOf(op);
    flushSync(() => {
      setDraft((d) => ({ ...d, ops: d.ops.slice(0, -1) }));
      setLast(null);
      setRefused(null);
    });
    announce(`Took back: ${text}`);
    const target = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(back)}"]`) ?? document.querySelector<HTMLElement>('.plan [data-undo-focus]');
    target?.focus();
  };

  const discard = () => {
    const was = draft;
    flushSync(() => {
      setDraft(() => EMPTY_DRAFT);
      setLast(null);
      setRefused(null);
      setDiscarded({ draft: was, until: undoUntil() });
    });
    announce('Discarded your changes.');
    undoRef.current?.focus();
  };

  const save = async () => {
    if (!steer || !online || pressing.current || !changed || problems.length > 0) return;
    pressing.current = true;
    setBusy('save');
    setProblem(null);
    setRefused(null);
    const base = latest;
    const plan = shown;
    try {
      const result = await steer.editPlan(plan, draft.note.trim() || null);
      if (!result.ok) {
        setRefused(result.errors);
        return;
      }
      flushSync(() => {
        setSent({ plan, base: base.version });
        setDraft(() => EMPTY_DRAFT);
        setLast(null);
        setSaved({ until: undoUntil(), before: base.plan, base: base.version });
      });
      announce('Saved your changes as a new version of the plan.');
      savedRef.current?.focus();
    } catch (error) {
      setProblem({ where: 'save', text: `Couldn't save your changes. ${refusalOf(error)}` });
    } finally {
      pressing.current = false;
      setBusy(null);
    }
  };

  /** Saving made a version; Undo makes another with the plan as it was before. */
  const undoSave = async () => {
    if (!saved || !steer || !online || pressing.current) return;
    const { before, base } = saved;
    pressing.current = true;
    setSaved(null);
    setBusy('save');
    setProblem(null);
    try {
      const result = await steer.editPlan(before, `Back to version ${base}.`);
      if (result.ok) announce(`The plan is back as version ${base} had it, as a new version.`);
      else setRefused(result.errors);
    } catch (error) {
      setProblem({ where: 'save', text: `Couldn't undo it. ${refusalOf(error)}` });
    } finally {
      pressing.current = false;
      setBusy(null);
    }
  };

  const approve = async (choice: ApproveChoice) => {
    if (!steer || !online || pressing.current || changed || !choices) return;
    pressing.current = true;
    setBusy('approve');
    setProblem(null);
    try {
      await steer.approvePlan(choices.version, choice.through);
      announce(approvedLine(latest.plan, choices.version, choice.through));
      // The button may stay and offer the next milestone: focus leaves it, so a second press can't approve that too.
      document.querySelector<HTMLElement>('.plan [data-undo-focus]')?.focus();
    } catch (error) {
      setProblem({ where: 'approve', text: `Couldn't approve the plan. ${refusalOf(error)}` });
    } finally {
      pressing.current = false;
      setBusy(null);
    }
  };

  const comment = async (on: PlanComment['on'], text: string) => {
    if (!steer) throw new Error(NO_STEER);
    await steer.commentPlan(on, text);
  };

  const problemAt = (where: 'change' | 'save' | 'approve') =>
    problem?.where === where && (
      <p className="plan-problem" role="alert">
        {problem.text}
      </p>
    );

  return (
    <Layout
      inBoard={props.inBoard ?? false}
      main={
        <>
          <PlanStateLines company={company} />
          {!steer && <p className="plan-note">{NO_STEER}</p>}

          {choices && company.planSummary && company.planSummary.version === latest?.version && <PlanSummaryCard summary={company.planSummary} id={id} checklist={latest.plan.checklist?.length ?? 0} />}
          {choices && (
            <section className="plan-approve" aria-label="Approve">
              <div className="plan-actions">
                <button type="button" className="button button--primary button--large" aria-disabled={approveWhy !== null || undefined} aria-describedby={approveWhy ? `${id}-approve-why` : undefined} onClick={() => void approve(choices.primary)}>
                  {busy === 'approve' ? 'Approving…' : choices.primary.label}
                </button>
                {choices.more.length > 0 && (
                  <details className="plan-approve__more">
                    <summary>{setting === 'milestones' ? 'Approve more at once' : 'Approve only part of it'}</summary>
                    <div className="plan-approve__choices">
                      {choices.more.map((c) => (
                        <div key={c.through ?? 'all'} className="plan-approve__choice">
                          <button type="button" className="button" aria-disabled={approveWhy !== null || undefined} aria-describedby={c.through !== null ? `${id}-stops-${c.through}` : undefined} onClick={() => void approve(c)}>
                            {c.label}
                          </button>
                          {/* The note belongs to the choice that stops at a milestone; the whole plan doesn't. */}
                          {c.through !== null && (
                            <p id={`${id}-stops-${c.through}`} className="plan-note">
                              Work stops after that milestone until you approve the next.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              {approveWhy && approveWhy !== 'Approving…' && (
                <p id={`${id}-approve-why`} className="plan-note">
                  {approveWhy}
                </p>
              )}
              {problemAt('approve')}
            </section>
          )}

          {saved && (
            <UndoLine ref={savedRef} text="Saved as a new version." until={saved.until} onUndo={() => void undoSave()} unavailable={unavailable !== null || busy !== null} />
          )}
          {discarded && (
            <UndoLine
              ref={undoRef}
              text="Discarded your changes."
              until={discarded.until}
              onUndo={() => {
                const back = discarded.draft;
                setDiscarded(null);
                setDraft(() => back);
                announce('Your changes are back.');
              }}
            />
          )}
          {problemAt('save')}
          {problemAt('change')}

          {(changed || replayed.dropped.length > 0 || refused) && !sent && (
            <section className="plan-changes callout callout--inline" aria-labelledby={`${id}-changes`}>
              <h3 id={`${id}-changes`} ref={changesRef} className="callout__title" tabIndex={-1}>
                Your changes
              </h3>
              {changed ? <p>{changes.summary} Not saved yet: the plan changes when you save it.</p> : <p>None of your changes are left.</p>}
              {replayed.dropped.length > 0 && (
                <div className="plan-changes__dropped">
                  <p>
                    {replayed.dropped.length === 1 ? 'One of your changes no longer applies' : `${capital(countWord(replayed.dropped.length))} of your changes no longer apply`}, since version {latest.version} changed the same part:
                  </p>
                  <ul className="plain-list">
                    {replayed.dropped.map((d, i) => (
                      <li key={`${i}:${d.why}`}>{d.why}</li>
                    ))}
                  </ul>
                </div>
              )}
              {changed && (
                <details className="plan-changes__diff">
                  <summary>See what changes</summary>
                  <PlanDiffView diff={changes} />
                </details>
              )}
              {problems.length > 0 && (
                <div className="plan-changes__problems" role="status">
                  <p className="plan-changes__problems-title">{problems.length === 1 ? 'One thing stops the save' : `${capital(countWord(problems.length))} things stop the save`}</p>
                  <ul className="plain-list">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {refused && (
                <div className="plan-changes__problems" role="alert">
                  <p className="plan-changes__problems-title">The office turned the new version down</p>
                  <ul className="plain-list">
                    {refused.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p>Your changes are kept, so you can fix them and save again.</p>
                </div>
              )}
              {changed && (
                <label className="edit-field plan-changes__note">
                  <span className="edit-field__label">A note for the CEO (optional)</span>
                  <input className="text-input" value={draft.note} maxLength={1000} autoComplete="off" placeholder="Why you changed it" onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
                </label>
              )}
              <div className="plan-actions">
                {changed && (
                  <button type="button" className="button button--primary" aria-disabled={saveWhy !== null || undefined} aria-describedby={saveWhy ? `${id}-save-why` : undefined} onClick={() => void save()}>
                    {busy === 'save' ? 'Saving…' : 'Save as a new version'}
                  </button>
                )}
                {draft.ops.length > 0 && (
                  <button type="button" className="button" onClick={undoLast}>
                    Undo the last change
                  </button>
                )}
                {draft.ops.length > 0 && (
                  <button type="button" className="link link--danger" onClick={discard}>
                    Discard your changes
                  </button>
                )}
              </div>
              {saveWhy && changed && saveWhy !== 'Saving…' && (
                <p id={`${id}-save-why`} className="plan-note">
                  {saveWhy}
                </p>
              )}
              {changed && setting !== 'off' && setting !== null && <p className="plan-note">The new version waits for your approval like any other.</p>}
            </section>
          )}

          {revision && previous && (
            <details className="plan-section plan-revision" open={!milestonesApproved(view, latest) || undefined}>
              <summary className="plan-revision__summary">What changed from version {previous.version}</summary>
              {latest.note && (
                <p className="plan-note">
                  {latest.by === STAKEHOLDER ? 'Your note' : `${capital(whoIn(company, latest.by))}'s note`}: {plainText(latest.note)}
                </p>
              )}
              <PlanDiffView diff={revision} />
            </details>
          )}

          {shown.tasks.length > FIND_PLAN_OVER && (
            <div className="find plan-find">
              <label className="find__label" htmlFor={`${id}-find`}>
                Find a task
              </label>
              <input id={`${id}-find`} className="find__box" type="search" autoComplete="off" enterKeyHint="search" value={query} aria-describedby={`${id}-found`} onChange={(e) => setQuery(e.target.value)} />
              {/* Always in the page, so a screen reader announces the count as it changes. */}
              <p id={`${id}-found`} className="find__count" role="status">
                {finding ? `${found?.size ?? 0} of ${shown.tasks.length} tasks` : ''}
              </p>
            </div>
          )}
          {finding && found?.size === 0 && <p className="rows__empty">No task matches. Try a word from its title, its owner's name or a file.</p>}

          <PlanBody
            company={company}
            roomName={(room) => roomName(props.snapshot, room)}
            companyId={companyId}
            navigate={navigate}
            plan={shown}
            shownVersion={latest.version}
            view={view}
            marks={marks}
            editable={editable && !sent}
            commentUnavailable={unavailable}
            onComment={comment}
            onChange={change}
            last={last}
            onUndoLast={undoLast}
            undoRef={undoRef}
            newTaskId={() => newTaskId([...versions, shown])}
            newMilestoneId={() => newMilestoneId([...versions, shown])}
            newItemId={() => newItemId([...versions, shown])}
            found={found}
            announce={announce}
          />
        </>
      }
      side={
        <>
          <section className="plan-section" aria-labelledby={`${id}-talk`}>
            <h3 id={`${id}-talk`} className="group-title">
              Comments on the plan
            </h3>
            {planComments.length === 0 ? (
              <p className="plan-note">None yet. A comment reaches the CEO as a message; ask for a change and a new version shows here with what changed.</p>
            ) : (
              <ul className="plan-comments">
                {planComments.map((c) => (
                  <li key={c.id} className="plan-comment">
                    <p className="plan-comment__sign">{commentSign(company, c, latest.version)}</p>
                    <Clamp text={c.text} lines={4} className="plan-comment__text" />
                  </li>
                ))}
              </ul>
            )}
            {commenting ? (
              <PlanCommentForm
                title="Comment on the plan"
                on={{ kind: 'plan' }}
                unavailable={unavailable}
                send={comment}
                onSent={() => {
                  announce('Comment sent to the CEO.');
                  flushSync(() => setCommenting(false));
                  document.querySelector<HTMLElement>('[data-focus="plan-comment:plan"]')?.focus();
                }}
                onClose={() => {
                  flushSync(() => setCommenting(false));
                  document.querySelector<HTMLElement>('[data-focus="plan-comment:plan"]')?.focus();
                }}
              />
            ) : (
              <button type="button" className="button" data-focus="plan-comment:plan" onClick={() => setCommenting(true)}>
                Comment on the plan
              </button>
            )}
            {allComments.length > planComments.length && (
              <details className="fold plan-all-comments">
                <summary>Every comment ({allComments.length})</summary>
                <ul className="plan-comments">
                  {[...allComments]
                    .sort((a, b) => b.at - a.at)
                    .map((c) => (
                      <li key={c.id} className="plan-comment">
                        <p className="plan-comment__sign">
                          {commentTarget(shown, c.on)}. {commentSign(company, c, latest.version)}
                        </p>
                        <Clamp text={c.text} lines={3} className="plan-comment__text" />
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </section>

          <Versions company={company} companyId={companyId} navigate={navigate} shown={latest.version} />
          <PlanApprovalSetting company={company} steer={props.steer} online={online} announce={announce} variant="plan" />
        </>
      }
      foot={
        changed && (
          <div className="plan-bar" role="region" aria-label="Your changes" ref={keepClear}>
            <p className="plan-bar__line">
              {changes.summary} <span className="plan-bar__not">Not saved.</span>
            </p>
            <button type="button" className="button button--primary" aria-disabled={saveWhy !== null || undefined} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="link" onClick={() => changesRef.current?.focus()}>
              Review
            </button>
          </div>
        )
      }
    />
  );
}

/** Whether every milestone of the latest version is approved: the revision folds once it is. */
function milestonesApproved(view: ReturnType<typeof planOf>, latest: PlanVersion): boolean {
  const a = view?.approved;
  return !!a && a.version === latest.version && a.through === null;
}

// ---------------------------------------------------------------------------------------------------------------
// The versions

function Versions({ company, companyId, navigate, shown }: { company: CompanyView; companyId: string; navigate: TabProps['navigate']; shown: number }) {
  const id = useId();
  const view = planOf(company);
  const rows = versionRows(view, company);
  const older = olderVersionsLine(view);
  if (rows.length === 0) return null;
  return (
    <section className="plan-section" aria-labelledby={`${id}-versions`}>
      <h3 id={`${id}-versions`} className="group-title">
        Versions
      </h3>
      <ol className="plan-versions" reversed>
        {rows.map((r) => (
          <li key={r.version} className={`plan-version${r.version === shown ? ' is-shown' : ''}`}>
            <p className="plan-version__head">
              {r.version === shown ? (
                <span className="plan-version__name">
                  Version {r.version}
                  <span className="visually-hidden">, shown</span>
                </span>
              ) : (
                <CompanyLink companyId={companyId} to={planPath(r.latest ? null : r.version)} navigate={navigate} className="link plan-version__name" focusKey={`plan-version:${r.version}`}>
                  Version {r.version}
                </CompanyLink>
              )}
              {r.latest && <span className="plan-version__tag">Latest</span>}
              {r.approved && <span className="plan-version__tag">Approved</span>}
            </p>
            <p className="plan-version__line">
              {r.line}
              {r.note ? ` ${r.note}` : ''}
            </p>
          </li>
        ))}
      </ol>
      {older && <p className="plan-note">{older}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// An older version

function OlderVersion(props: Props & { version: number }) {
  const { company, companyId, navigate, online, announce, version } = props;
  const steer = props.steer ?? null;
  const view = planOf(company);
  const latest = latestOf(view);
  const shown = versionIn(view, version);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[] | null>(null);
  const setting = approvalOf(company);
  if (!shown || !latest) {
    return (
      <>
        <p className="plan-state__line">
          {latest && version > latest.version ? `There's no version ${version} of the plan.` : `Version ${version} isn't kept any more: the office keeps the latest ten.`}
        </p>
        <CompanyLink companyId={companyId} to={planPath()} navigate={navigate} className="button" focusKey="plan:latest">
          See the plan
        </CompanyLink>
      </>
    );
  }
  const previous = previousOf(view, version);
  const diff = previous ? diffView(previous.plan, shown.plan, company) : null;
  const unavailable = !steer ? NO_STEER : !online ? OFFLINE : busy ? 'Saving…' : null;
  const restore = async () => {
    if (!steer || !online || busy) return;
    setBusy(true);
    setProblem(null);
    setRefused(null);
    try {
      const result = await steer.editPlan(shown.plan, `Back to version ${version}.`);
      if (!result.ok) {
        setRefused(result.errors);
        return;
      }
      announce(`The plan is back as version ${version} had it, as a new version.`);
      navigate(planPath());
    } catch (error) {
      setProblem(`Couldn't make it the plan again. ${refusalOf(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout
      inBoard={props.inBoard ?? false}
      main={
        <>
          <div className="plan-state" tabIndex={-1} data-undo-focus>
            {view?.approved?.version === version && <StatePill label="Was approved" tone="done" />}
            <p className="plan-state__line">
              By {whoIn(company, shown.by)} {whenAt(shown.at)}
              {shown.note ? `: ${plainText(shown.note)}` : '.'}
            </p>
            <p className="plan-state__line">
              This is an older version. The latest is version {latest.version}.{' '}
              <CompanyLink companyId={companyId} to={planPath()} navigate={navigate} className="link" focusKey="plan:latest">
                See the latest
              </CompanyLink>
            </p>
          </div>
          {diff && previous && (
            <details className="plan-section plan-revision" open>
              <summary className="plan-revision__summary">What changed from version {previous.version}</summary>
              <PlanDiffView diff={diff} />
            </details>
          )}
          <PlanBody
            company={company}
            roomName={(room) => roomName(props.snapshot, room)}
            companyId={companyId}
            navigate={navigate}
            plan={shown.plan}
            shownVersion={version}
            view={view}
            marks={milestoneMarks(view, shown, setting)}
            editable={false}
            commentUnavailable={undefined}
            onComment={async () => undefined}
            onChange={() => undefined}
            last={null}
            onUndoLast={() => undefined}
            undoRef={null}
            newTaskId={() => ''}
            newMilestoneId={() => ''}
            newItemId={() => ''}
            found={null}
            announce={announce}
          />
          <section className="plan-section" aria-labelledby="plan-restore">
            <h3 id="plan-restore" className="group-title">
              Go back to this version
            </h3>
            <p className="plan-note">Saves version {version} again as a new version, version {latest.version + 1} or later. Nothing else changes until then.</p>
            <button type="button" className="button" aria-disabled={unavailable !== null || undefined} aria-describedby={unavailable ? 'plan-restore-why' : undefined} onClick={() => void restore()}>
              {busy ? 'Saving…' : 'Make this the plan again'}
            </button>
            {unavailable && unavailable !== 'Saving…' && (
              <p id="plan-restore-why" className="plan-note">
                {unavailable}
              </p>
            )}
            {problem && (
              <p className="plan-problem" role="alert">
                {problem}
              </p>
            )}
            {refused && (
              <div className="plan-changes__problems" role="alert">
                <p className="plan-changes__problems-title">The office turned it down</p>
                <ul className="plain-list">
                  {refused.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      }
      side={<Versions company={company} companyId={companyId} navigate={navigate} shown={version} />}
    />
  );
}
