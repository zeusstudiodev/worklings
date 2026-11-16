// The company's Plan approval setting (SPEC-v3.md "Steering", 1): before work starts (new companies), at every
// milestone, or off. Three choices that each apply at once, with Undo in place for ten seconds, as Settings does; the
// office's refusal shows under them. It sits in Settings and at the foot of the plan.
import { useId, useRef, useState } from 'react';
import { PLAN_APPROVALS, type PlanApproval } from '../../../../src/core/steering.ts';
import type { CompanyView } from '../../../../src/core/company.ts';
import { refusalOf } from '../people/shared.tsx';
import type { SteeringActions } from '../types.ts';
import { UndoLine } from '../ui/UndoLine.tsx';
import { approvalOf, offWarning, PLAN_APPROVAL_WORDS, planApprovalChanged } from './planModel.ts';
import './planApproval.css';

const UNDO_SHOWN_MS = 10_000;
/** When Undo goes, for a change made now (called from handlers, never while drawing). */
const undoUntil = () => Date.now() + UNDO_SHOWN_MS;

interface Props {
  company: CompanyView;
  steer: SteeringActions | null | undefined;
  online: boolean;
  announce: (text: string) => void;
  /** Settings' look (a group with a rule under it) or the plan's (a section of the page). */
  variant?: 'settings' | 'plan';
}

export function PlanApprovalSetting({ company, steer, online, announce, variant = 'settings' }: Props) {
  const id = useId();
  const current = approvalOf(company);
  // What you pressed, shown until the office's answer and then until the stream brings it.
  const [pending, setPending] = useState<PlanApproval | null>(null);
  // What was saved shows until the stream moves from the value it had then: it brings our change, or somebody else's after it.
  const [saved, setSaved] = useState<{ value: PlanApproval; from: PlanApproval | null } | null>(null);
  if (saved !== null && pending === null && current !== saved.from) setSaved(null);
  const [done, setDone] = useState<{ before: PlanApproval; until: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // One change at a time, so answers can't come back out of order.
  const changing = useRef(false);
  const undoRef = useRef<HTMLButtonElement>(null);

  if (current === null) return null;
  const shown = pending ?? saved?.value ?? current;
  const why = !steer ? "This office can't change the setting from here yet." : !online ? 'The office is reconnecting, so changes wait.' : null;
  const warning = shown !== 'off' ? offWarning(company) : null;

  const change = async (to: PlanApproval, undoable: boolean) => {
    if (!steer || !online || changing.current || to === shown) return;
    changing.current = true;
    const before = shown;
    setPending(to);
    setProblem(null);
    try {
      const settings = await steer.changeSettings({ planApproval: to });
      setSaved({ value: settings.planApproval, from: current });
      setDone(undoable ? { before, until: undoUntil() } : null);
      announce(planApprovalChanged(settings.planApproval));
      if (undoable) window.setTimeout(() => undoRef.current?.focus(), 0);
    } catch (error) {
      setProblem(`Couldn't change it. ${refusalOf(error)}`);
    } finally {
      changing.current = false;
      setPending(null);
    }
  };

  return (
    <section className={variant === 'settings' ? 'settings__group plan-approval' : 'plan-section plan-approval'} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className={variant === 'settings' ? 'settings__legend' : 'group-title'}>
        Plan approval
      </h3>
      <div className="plan-approval__options" role="group" aria-labelledby={`${id}-title`} aria-describedby={why ? `${id}-why` : undefined}>
        {PLAN_APPROVALS.map((option) => (
          <button
            key={option}
            type="button"
            className="plan-approval__option"
            aria-pressed={shown === option}
            aria-disabled={why !== null || pending !== null || undefined}
            aria-describedby={`${id}-${option}`}
            onClick={() => void change(option, true)}
          >
            <span className="plan-approval__label">{PLAN_APPROVAL_WORDS[option].label}</span>
            <span id={`${id}-${option}`} className="plan-approval__sentence">
              {PLAN_APPROVAL_WORDS[option].sentence}
              {option === 'off' && warning ? ` ${warning}` : ''}
            </span>
          </button>
        ))}
      </div>
      {why && (
        <p id={`${id}-why`} className="settings__note">
          {why}
        </p>
      )}
      {pending !== null && (
        <p className="settings__note" role="status">
          Changing it…
        </p>
      )}
      {done && <UndoLine ref={undoRef} text="Changed." until={done.until} onUndo={() => void change(done.before, false)} unavailable={why !== null || pending !== null} />}
      {problem && (
        <p className="settings__problem" role="alert">
          {problem}
        </p>
      )}
      <p className="settings__note">You can also tell the CEO, as in “Check the plan with me at every milestone.”</p>
    </section>
  );
}
