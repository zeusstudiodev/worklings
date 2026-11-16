// The budget fields (v0.2's spending plan): a cap for the company and one for each person, in dollars. Each saves on its
// own with its own Save and Clear, validates as the office does (to the cent, $0.01 to $1,000,000, empty for none) and
// shows the office's sentence when it refuses. The proposal's Spending plan and Settings both draw them, and while the
// company runs they are how the budget is raised.
import { useEffect, useId, useRef, useState } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { refusalOf } from '../people/shared.tsx';
import type { CompanyActions } from '../types.ts';
import { capField, capWords, parseDollars } from './spendingModel.ts';
import './spending.css';

type Scope = 'company' | 'person';

interface FieldProps {
  scope: Scope;
  label: string;
  note: string;
  /** The office's cap, null when none. */
  current: number | null;
  online: boolean;
  /** Saves the cap (null clears it); rejects with the office's sentence. */
  save: (value: number | null) => Promise<void>;
  /** Focus goes to the field when it mounts: Settings opened to raise a spent budget. */
  autoFocus?: boolean;
}

/** One cap: its label, a dollar field, Save, and Clear while a cap is set. */
function BudgetField({ scope, label, note, current, online, save, autoFocus = false }: FieldProps) {
  const id = useId();
  const [text, setText] = useState(capField(current));
  const [from, setFrom] = useState(current);
  const [typed, setTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const changing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // It follows the office's cap (another tab may change it) until something is typed in it.
  if (!typed && from !== current) {
    setFrom(current);
    setText(capField(current));
  }
  // The shell puts focus on a panel's heading as it opens; the field takes it a moment after, unless the person already
  // went somewhere else.
  useEffect(() => {
    if (!autoFocus) return;
    const wait = window.setTimeout(() => {
      const at = document.activeElement;
      if (!at || at === document.body || at.hasAttribute('data-panel-heading') || at.id === 'company-panel') input.current?.focus();
    }, 300);
    return () => window.clearTimeout(wait);
  }, [autoFocus]);
  const parsed = parseDollars(text);
  const invalid = typed && !parsed.ok;
  const unchanged = parsed.ok && parsed.value === current;
  const why = !online ? 'The office is reconnecting, so this waits.' : null;

  const run = async (value: number | null) => {
    if (!online || changing.current) return;
    changing.current = true;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      await save(value);
      setTyped(false);
      setText(capField(value));
      setFrom(value);
      // Clear goes with the cap it cleared: focus waits in the field, never on the page.
      if (value === null) input.current?.focus();
      setDone(value === null ? `No ${scope === 'company' ? 'company' : 'per-person'} budget.` : `${scope === 'company' ? 'Company' : 'Per-person'} budget is ${capWords(value)}.`);
    } catch (error) {
      setProblem(refusalOf(error));
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };

  return (
    <form
      className="spend-field"
      onSubmit={(event) => {
        event.preventDefault();
        setTyped(true);
        if (parsed.ok && !unchanged && !busy) void run(parsed.value);
      }}
    >
      <label className="edit-field__label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <div className="spend-field__row">
        <span className="spend-field__box">
          <span className="spend-field__sign" aria-hidden="true">
            $
          </span>
          <input
            id={`${id}-input`}
            ref={input}
            className="text-input spend-field__input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="No budget"
            value={text}
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-note${invalid ? ` ${id}-bad` : ''}${why ? ` ${id}-why` : ''}`}
            onChange={(e) => {
              setText(e.target.value);
              setTyped(true);
              setDone(null);
            }}
          />
        </span>
        <button type="submit" className="button" aria-disabled={!online || busy || unchanged || !parsed.ok || undefined}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {current !== null && (
          <button type="button" className="link" aria-disabled={!online || busy || undefined} onClick={() => void run(null)}>
            Clear<span className="visually-hidden"> the {scope === 'company' ? 'company' : 'per-person'} budget</span>
          </button>
        )}
      </div>
      <p id={`${id}-note`} className="spend-field__note">
        {note}
      </p>
      {invalid && !parsed.ok && (
        <p id={`${id}-bad`} className="spend-field__problem">
          {parsed.message}
        </p>
      )}
      {why && (
        <p id={`${id}-why`} className="spend-field__note">
          {why}
        </p>
      )}
      {problem && (
        <p className="spend-field__problem" role="alert">
          Couldn't save it. {problem}
        </p>
      )}
      {done && (
        <p className="spend-field__done" role="status">
          {done}
        </p>
      )}
    </form>
  );
}

interface SectionProps {
  company: Pick<CompanyView, 'settings'>;
  actions: Pick<CompanyActions, 'setBudget'>;
  online: boolean;
  /** Focus goes to the company's field when it mounts. */
  focusCompany?: boolean;
}

/** The two caps, with what each does. */
export function BudgetFields({ company, actions, online, focusCompany = false }: SectionProps) {
  const plan = company.settings.billing === 'plan';
  return (
    <div className="spend-fields">
      <BudgetField
        scope="company"
        label="Company budget"
        note="The office asks you in the inbox at 80%. At the full amount nobody starts another step until you raise it; steps under way finish first."
        current={company.settings.budget.company}
        online={online}
        save={async (value) => void (await actions.setBudget({ company: value }))}
        autoFocus={focusCompany}
      />
      <BudgetField
        scope="person"
        label="Budget for each person"
        note="Applies to every person separately. At the full amount that person stops and their manager is told."
        current={company.settings.budget.person}
        online={online}
        save={async (value) => void (await actions.setBudget({ person: value }))}
      />
      <p className="spend-field__note">{plan ? 'Dollars are API-equivalent: on your plan they are estimates, not charges.' : 'Dollars are what Claude Code reports for your API key.'}</p>
    </div>
  );
}
