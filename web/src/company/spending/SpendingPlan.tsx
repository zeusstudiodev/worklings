// The spending plan (v0.2; SPEC-v0.2.md, "the maintainer's decisions"), the proposal's own section before the start: how thorough
// the company is (Lean, Balanced or Thorough, with what each costs), which model each level runs on, how many desks work
// at once, a budget, what it will cost and what each person's desk loads. While the CEO still asks its scoping questions
// the office's "How thorough?" is only the first part. Every change goes to the office at once and says what happened.
import { useId, useRef, useState } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { aboutDollars } from '../../../../src/core/cost-estimate.ts';
import { DEFAULT_PRESET, MODEL_LEVELS, type PresetId } from '../../../../src/core/presets.ts';
import type { PresetInfo, SpendingView } from '../../../../src/core/spending.ts';
import { ROLE_MODELS, type Level, type RoleModel } from '../../../../src/core/studio.ts';
import { MAX_COMPANY_DESKS, desksSentence } from '../settings/Settings.tsx';
import { refusalOf } from '../people/shared.tsx';
import type { CompanyActions } from '../types.ts';
import { useFollowedField } from '../ui/useFollowedField.ts';
import { BudgetFields } from './BudgetFields.tsx';
import {
  fixedPromptLine,
  isDefaultPreset,
  LEVEL_NAMES,
  loadsSummary,
  modelChangedLine,
  modelName,
  modelsSentence,
  outsideSentence,
  presetChangedLine,
  presetFacts,
  rangeWords,
  sizeWords,
} from './spendingModel.ts';
import './spending.css';

type Mode = 'scoping' | 'drafting' | 'proposal';

interface Props {
  company: CompanyView;
  actions: CompanyActions;
  online: boolean;
  announce: (text: string) => void;
  mode: Mode;
  /** Whether the CEO's scoping answers are still out, which decides what a preset change tells the CEO. */
  scopingOpen?: boolean;
}

const OFFLINE = 'The office is reconnecting, so this waits.';

export function SpendingPlan({ company, actions, online, announce, mode, scopingOpen = false }: Props) {
  const id = useId();
  const spending = company.spending;
  if (!spending) return null;
  const offline = online ? null : OFFLINE;
  const phase = company.phase;
  const label = spending.presets.find((p) => p.id === spending.preset)?.label ?? 'This preset';
  const full = mode === 'proposal';
  return (
    <section className="spend-plan" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="group-title">
        {mode === 'scoping' ? 'How thorough?' : 'Spending plan'}
      </h3>
      <p className="group-note">
        {mode === 'scoping'
          ? `More people and more checks cost more. ${spending.presetQuestion !== null ? 'Balanced stands until you choose.' : 'You can change it until you start.'}`
          : 'Choose how big the company is and what to spend. Everything here can change until you start; the budget can change after.'}
      </p>
      <PresetChoice spending={spending} phase={phase} scopingOpen={scopingOpen} compact={mode === 'scoping'} actions={actions} online={online} announce={announce} />
      {full && sizeWords(company.proposal?.size) && <p className="spend-note">The CEO sized this proposal as follows. {sizeWords(company.proposal?.size)}</p>}
      {full && spending.outside && (
        <p className="spend-note" role="note">
          {outsideSentence(spending.outside, label)}
        </p>
      )}
      {full && (
        <>
          <ModelRows spending={spending} actions={actions} online={online} announce={announce} />
          <DeskField company={company} actions={actions} online={online} announce={announce} />
          <div className="spend-sub">
            <h4 className="spend-sub__title">Budget</h4>
            <BudgetFields company={company} actions={actions} online={online} />
          </div>
          <Estimate company={company} spending={spending} />
          <LoadsOverview company={company} spending={spending} />
        </>
      )}
      {offline && mode !== 'proposal' && <p className="spend-note">{offline}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** The three presets as a radio group of cards: the selected one is plain to see, and Balanced says it is the default. */
function PresetChoice({ spending, phase, scopingOpen, compact, actions, online, announce }: { spending: SpendingView; phase: CompanyView['phase']; scopingOpen: boolean; compact: boolean } & Pick<Props, 'actions' | 'online' | 'announce'>) {
  const id = useId();
  const [pending, setPending] = useState<PresetId | null>(null);
  // Presses in flight: arrowing through the radios presses several in a row, each sent, the last one standing.
  const [inflight, setInflight] = useState(0);
  const busy = inflight > 0;
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A press shows at once and stays until the stream says the same, so the card doesn't flick back in between.
  if (pending !== null && !busy && spending.preset === pending) setPending(null);
  const shown = pending ?? spending.preset;
  const waiting = spending.presetQuestion !== null && pending === null && spending.preset === DEFAULT_PRESET;

  const choose = async (info: PresetInfo) => {
    if (!online || info.id === shown) return;
    setInflight((n) => n + 1);
    setPending(info.id);
    setProblem(null);
    setSaid(null);
    try {
      await actions.setPreset(info.id);
      const line = presetChangedLine(info.label, phase, scopingOpen);
      setSaid(line);
      announce(line);
    } catch (error) {
      setPending(null);
      setProblem(`Couldn't change it. ${refusalOf(error)}`);
    } finally {
      setInflight((n) => n - 1);
    }
  };

  return (
    <fieldset className="spend-presets" aria-describedby={`${id}-help`}>
      <legend className="visually-hidden">How thorough the company is</legend>
      <div className="spend-presets__cards">
        {spending.presets.map((info) => {
          const on = shown === info.id;
          const inputId = `${id}-${info.id}`;
          return (
            <div key={info.id} className={`preset-card${on ? ' preset-card--on' : ''}`}>
              <input
                id={inputId}
                className="preset-card__input"
                type="radio"
                name={`${id}-preset`}
                value={info.id}
                checked={on}
                aria-disabled={!online || undefined}
                aria-describedby={`${inputId}-summary ${inputId}-facts`}
                onChange={() => void choose(info)}
              />
              <label className="preset-card__name" htmlFor={inputId}>
                {info.label}
              </label>
              {isDefaultPreset(info.id) && <span className="preset-card__tag">Default</span>}
              <p id={`${inputId}-summary`} className="preset-card__summary">
                {info.summary}
              </p>
              <dl id={`${inputId}-facts`} className="preset-card__facts">
                {presetFacts(info, compact).map((fact) => (
                  <div key={fact.label} className="preset-card__fact">
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      <p id={`${id}-help`} className="spend-note">
        {!online
          ? OFFLINE
          : waiting
            ? "You haven't chosen yet, so Balanced stands. Costs are rough: API-equivalent dollars for a typical team of that size."
            : 'Costs are rough: API-equivalent dollars for a typical team of that size. The CEO sizes the real team to your goal.'}
      </p>
      {busy && (
        <p className="spend-note" role="status">
          Changing it…
        </p>
      )}
      {said && !busy && (
        <p className="spend-done" role="status">
          {said}
        </p>
      )}
      {problem && (
        <p className="spend-problem" role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** The model of each level: four selects, or, when ANTHROPIC_MODEL runs everyone, the same four as plain words with why. */
function ModelRows({ spending, actions, online, announce }: { spending: SpendingView } & Pick<Props, 'actions' | 'online' | 'announce'>) {
  const id = useId();
  const [pending, setPending] = useState<Partial<Record<Level, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // A choice shows until the stream says the same.
  const stale = MODEL_LEVELS.filter((l) => pending[l] !== undefined && pending[l] === spending.models[l]);
  if (stale.length > 0) setPending((p) => Object.fromEntries(Object.entries(p).filter(([l]) => !stale.includes(l as Level))));

  const choose = async (level: Level, model: RoleModel) => {
    if (!online) return;
    setPending((p) => ({ ...p, [level]: model }));
    setProblem(null);
    setSaid(null);
    try {
      await actions.setModels({ [level]: model });
      const line = modelChangedLine(level, model);
      setSaid(line);
      announce(line);
    } catch (error) {
      setPending((p) => Object.fromEntries(Object.entries(p).filter(([l]) => l !== level)));
      setProblem(`Couldn't change it. ${refusalOf(error)}`);
    }
  };

  const override = spending.modelOverride;
  return (
    <div className="spend-sub">
      <h4 className="spend-sub__title">Models</h4>
      {override !== null ? (
        <>
          <p className="spend-note" role="note">
            Your ANTHROPIC_MODEL is set to {override}, so everyone runs on it whatever is chosen here. Unset it and restart the office to choose a model for each level.
          </p>
          <dl className="spend-models spend-models--fixed">
            {MODEL_LEVELS.map((level) => (
              <div key={level} className="spend-models__row">
                <dt>{LEVEL_NAMES[level].label}</dt>
                <dd>{override}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          <div className="spend-models">
            {MODEL_LEVELS.map((level) => (
              <div key={level} className="edit-field">
                <label className="edit-field__label" htmlFor={`${id}-${level}`}>
                  {LEVEL_NAMES[level].label}
                </label>
                <select
                  id={`${id}-${level}`}
                  className="select-input"
                  value={pending[level] ?? spending.models[level]}
                  aria-disabled={!online || undefined}
                  onChange={(e) => {
                    const next = ROLE_MODELS.find((m) => m === e.target.value);
                    if (next) void choose(level, next);
                  }}
                >
                  {ROLE_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {modelName(m)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="spend-note">{modelsSentence(spending.models)} A change applies to everyone at that level in the proposal; open a person on the chart to set theirs.</p>
        </>
      )}
      {said && (
        <p className="spend-done" role="status">
          {said}
        </p>
      )}
      {problem && (
        <p className="spend-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** How many people work at once: the preset's number, which you can set by hand. */
function DeskField({ company, actions, online }: { company: CompanyView } & Pick<Props, 'actions' | 'online' | 'announce'>) {
  const id = useId();
  const field = useFollowedField(company.settings.maxDesks);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const changing = useRef(false);
  const wanted = Number(field.text);
  const valid = field.text.trim() !== '' && Number.isInteger(wanted) && wanted >= 1 && wanted <= MAX_COMPANY_DESKS;
  const same = valid && wanted === company.settings.maxDesks;
  const save = async () => {
    if (!online || !valid || same || changing.current) return;
    changing.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const settings = await actions.updateSettings({ maxDesks: wanted });
      field.saved(settings.maxDesks);
    } catch (error) {
      setProblem(`Couldn't save it. ${refusalOf(error)}`);
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      className="spend-sub"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h4 className="spend-sub__title">Desks at work</h4>
      <div className="spend-field__row">
        <label className="visually-hidden" htmlFor={`${id}-desks`}>
          Desks at work, 1 to {MAX_COMPANY_DESKS}
        </label>
        <input
          id={`${id}-desks`}
          className="text-input text-input--number"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_COMPANY_DESKS}
          value={field.text}
          aria-invalid={!valid || undefined}
          aria-describedby={`${id}-note`}
          onChange={(e) => field.type(e.target.value)}
        />
        <button type="submit" className="button" aria-disabled={!online || !valid || same || busy || undefined}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p id={`${id}-note`} className={valid ? 'spend-note' : 'spend-problem'}>
        {valid ? desksSentence(company.settings.maxDesks, company.settings.billing) : `Pick 1 to ${MAX_COMPANY_DESKS} desks.`}
      </p>
      {problem && (
        <p className="spend-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** What it will cost: an hour while it works and the whole job as a range, said plainly as rough. */
function Estimate({ company, spending }: { company: CompanyView; spending: SpendingView }) {
  const hour = company.estimate?.perHour ?? null;
  const job = spending.job;
  const plan = company.settings.billing === 'plan';
  const lines = [...(job?.lines ?? []), ...(company.estimate?.lines ?? [])];
  return (
    <div className="spend-sub">
      <h4 className="spend-sub__title">What it will cost</h4>
      {hour === null && job === null ? (
        <p className="spend-note">There is nobody to price yet. The estimate appears with the proposal.</p>
      ) : (
        <>
          <dl className="spend-estimate">
            {hour !== null && (
              <div className="spend-estimate__row">
                <dt>While it works</dt>
                <dd>about {aboutDollars(hour)} an hour</dd>
              </div>
            )}
            {job && (
              <div className="spend-estimate__row">
                <dt>The whole job</dt>
                <dd>about {rangeWords(job.low, job.high)}</dd>
              </div>
            )}
          </dl>
          <p className="spend-note">
            {plan ? 'API-equivalent dollars: on a plan they count against your limits and are not charged.' : 'Billed per token to your API key.'} This is a rough guide, not a quote: real jobs vary a lot, and the Spend dashboard shows what the company really spends.
          </p>
          {lines.length > 0 && (
            <details className="spend-details">
              <summary>How it adds up</summary>
              {lines.map((line) => (
                <p key={line} className="spend-note">
                  {line}
                </p>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** What each person's desk loads before any work, with the company's total; open a person on the chart to change theirs. */
function LoadsOverview({ company, spending }: { company: CompanyView; spending: SpendingView }) {
  const loads = spending.loads;
  const people = company.proposal?.people ?? [];
  if (!loads || people.length === 0) return null;
  const measured = people.every((p) => loads.byPerson[p.id]?.measured !== false);
  return (
    <div className="spend-sub">
      <h4 className="spend-sub__title">What each person loads</h4>
      <p className="spend-note">
        Every desk starts each conversation with its fixed prompt. Together that is {fixedPromptLine({ tokens: loads.tokens, measured }).replace(' before any work', '')} for the {people.length} people. Open a person on the chart to change what they load.
      </p>
      <details className="spend-details">
        <summary>Each person</summary>
        <ul className="spend-loads">
          {people.map((p) => {
            const cost = loads.byPerson[p.id];
            const extra = loadsSummary(p);
            return (
              <li key={p.id} className="spend-loads__row">
                <span className="spend-loads__who">
                  {p.name || p.title}
                  <span className="spend-loads__title">{p.name && p.name !== p.title ? `, ${p.title}` : ''}</span>
                </span>
                <span className="spend-loads__tokens">{cost ? fixedPromptLine(cost) : 'not measured'}</span>
                <span className="spend-loads__extra">{extra ?? 'Default tools, no skills, no MCP servers.'}</span>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
