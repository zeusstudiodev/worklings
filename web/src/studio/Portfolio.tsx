// Portfolios in the lobby (SPEC-v0.3.md, S1 and S3): each one a card rolled up from its companies (what is happening in
// one line, progress, spend against the shared budget, what waits on you), a page of its own with its companies' cards,
// its brief and its budget, and the form that makes or changes one. Undo, not confirm: a deleted portfolio comes back
// with Undo in the lobby.
import { type CSSProperties, type FormEvent, type ReactNode, useId, useState } from 'react';
import type { LobbyCompany } from '../../../src/core/company.ts';
import type { PortfolioView, StudioView } from '../../../src/studio/model.ts';
import type { LobbyRow } from '../company/model.ts';
import { Count } from '../company/ui/Count.tsx';
import { StatePill } from '../company/ui/StatePill.tsx';
import { needsLine } from '../company/lobby/lobbyModel.ts';
import type { StudioActions } from './studioApi.ts';
import { budgetShare, portfolioMoney, portfolioPill, portfolioProgress, readBudget, studioCardLine } from './studioModel.ts';
import './studio.css';

/** The studio chat's entry at the top of the lobby's list. */
export function StudioCard({ studio, onOpen }: { studio: StudioView | null; onOpen: () => void }) {
  return (
    <button type="button" className="row studio-card" data-focus="studio-chat" onClick={onOpen}>
      <span className="studio-card__mark" aria-hidden="true">
        ✦
      </span>
      <span className="row__main studio-card__main">
        <span className="row__title studio-card__title">Studio chat</span>
        <span className="studio-card__line">{studioCardLine(studio)}</span>
      </span>
    </button>
  );
}

export function PortfolioCard({ p, onOpen }: { p: PortfolioView; onOpen: () => void }) {
  const pill = portfolioPill(p);
  const progress = portfolioProgress(p);
  const share = budgetShare(p);
  return (
    <button type="button" className={`row lobby-card portfolio-card${p.held ? ' portfolio-card--held' : ''}`} data-focus={`portfolio-${p.id}`} onClick={onOpen}>
      <span className="row__marker lobby-row__marker portfolio-card__marker" aria-hidden="true" />
      <span className="row__main lobby-card__main">
        <span className="lobby-card__top">
          <span className="row__title lobby-row__name">
            {p.name}
            <span className="visually-hidden">, portfolio{p.needsYou > 0 ? `, ${p.needsYou} need you` : ''}. </span>
          </span>
          <StatePill label={pill.word} tone={pill.tone} />
        </span>
        <span className="portfolio-card__line">{p.line} </span>
        <span className="lobby-card__progress">
          <span className="lobby-card__figures">{progress.line}. </span>
          {progress.share !== null && (
            <span className="lobby-card__bar" aria-hidden="true">
              <span style={{ '--share': `${(progress.share * 100).toFixed(1)}%` } as CSSProperties} />
            </span>
          )}
        </span>
        {p.firstNeed && (
          <span className="lobby-card__needs">
            <Count n={p.needsYou} label="" />
            <span className="lobby-card__needs-text">{needsLine(p.firstNeed)} </span>
          </span>
        )}
        <span className={`portfolio-card__money portfolio-card__money--${p.level}`}>
          {portfolioMoney(p)}.{' '}
          {share !== null && (
            <span className="portfolio-card__meter" aria-hidden="true">
              <span style={{ '--share': `${(share * 100).toFixed(1)}%` } as CSSProperties} />
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

interface FormProps {
  /** The portfolio to change; null makes a new one. */
  p: PortfolioView | null;
  portfolios: readonly PortfolioView[];
  companies: readonly LobbyCompany[];
  names: ReadonlyMap<string, string>;
  actions: StudioActions;
  online: boolean;
  onDone: (id: string) => void;
  onCancel?: () => void;
}

export function PortfolioForm({ p, portfolios, companies, names, actions, online, onDone, onCancel }: FormProps) {
  const id = useId();
  const [name, setName] = useState(p?.name ?? '');
  const [budget, setBudget] = useState(p?.budget === null || p?.budget === undefined ? '' : String(p.budget));
  const [brief, setBrief] = useState(p?.brief ?? '');
  const [members, setMembers] = useState<string[]>(p?.companies ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const read = readBudget(budget);
  const elsewhere = (company: string) => portfolios.find((q) => q.id !== p?.id && q.companies.includes(company));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!online || saving) return;
    if (name.trim() === '') return setProblem('Give the portfolio a name.');
    if (!read.ok) return setProblem(read.why);
    setSaving(true);
    setProblem(null);
    try {
      // A company that left the lobby while the form was open leaves the list with it.
      const change = { name: name.trim(), companies: members.filter((m) => companies.some((c) => c.id === m)), budget: read.value, brief: brief.trim() || null };
      const saved = p ? await actions.updatePortfolio(p.id, change) : await actions.createPortfolio(change);
      onDone(saved.id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The office didn't answer. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="settings__group portfolio-form" onSubmit={(e) => void submit(e)} aria-labelledby={`${id}-legend`}>
      <p id={`${id}-legend`} className="settings__legend">
        {p ? 'Change the portfolio' : 'A new portfolio'}
      </p>
      <label className="portfolio-form__field">
        <span>Name</span>
        <input className="text-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Client work" />
      </label>
      <label className="portfolio-form__field">
        <span>Shared budget, in dollars</span>
        <input className="text-input text-input--number" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget" aria-invalid={!read.ok || undefined} />
        <span className="settings__note">A hard cap on what its companies spend together, API-equivalent. When it's reached, every one of them pauses until you raise it. Each company's own budget still holds.</span>
      </label>
      <label className="portfolio-form__field">
        <span>Shared brief</span>
        <textarea className="text-input" rows={3} maxLength={4000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Optional: what every company in it should know" />
        <span className="settings__note">Each CEO reads it in its company's brief file.</span>
      </label>
      <fieldset className="portfolio-form__members">
        <legend>Companies</legend>
        {companies.length === 0 && <p className="settings__note">No companies yet.</p>}
        {companies.map((c) => {
          const other = elsewhere(c.id);
          return (
            <label key={c.id} className="portfolio-form__member">
              <input
                type="checkbox"
                checked={members.includes(c.id)}
                disabled={other !== undefined}
                onChange={(e) => setMembers((m) => (e.target.checked ? [...m, c.id] : m.filter((x) => x !== c.id)))}
              />
              <span>
                {names.get(c.id) ?? c.name}
                {other && <span className="portfolio-form__other"> (in {other.name})</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {problem && <p className="settings__problem">{problem}</p>}
      <div className="portfolio-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={!online || saving || undefined}>
          {p ? 'Save' : 'Make the portfolio'}
        </button>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

interface PageProps {
  p: PortfolioView;
  members: { entry: LobbyCompany; row: LobbyRow }[];
  renderCompany: (entry: LobbyCompany, row: LobbyRow) => ReactNode;
  form: ReactNode;
  onBack: () => void;
  onStudio: () => void;
  onDelete: () => void;
  online: boolean;
  deleting: boolean;
}

/** One portfolio: its companies a click away, its brief, its budget and the form that changes them. */
export function PortfolioPage({ p, members, renderCompany, form, onBack, onStudio, onDelete, online, deleting }: PageProps) {
  const id = useId();
  const [editing, setEditing] = useState(p.held);
  const progress = portfolioProgress(p);
  return (
    <section className="portfolio" aria-labelledby={`${id}-title`}>
      <button type="button" className="panel-back" onClick={onBack}>
        Back to the lobby
      </button>
      <h2 id={`${id}-title`} className="panel-title" tabIndex={-1} data-panel-heading>
        {p.name}
      </h2>
      <p className="portfolio__line">{p.line}</p>
      <p className="portfolio__figures">
        {progress.line}. {portfolioMoney(p)}.
      </p>
      {p.held && (
        <section className="callout callout--warn" role="alert" aria-labelledby={`${id}-held`}>
          <h3 id={`${id}-held`} className="callout__title">
            Its budget is spent
          </h3>
          <p>Every company in it is paused: turns under way finished, and nothing new starts until you raise the budget or take it off below.</p>
        </section>
      )}
      {p.brief && (
        <div className="portfolio__brief">
          <p className="lobby-card__key">Shared brief</p>
          <p className="portfolio__brief-text">{p.brief}</p>
        </div>
      )}
      <div className="portfolio__actions">
        <button type="button" className="button" onClick={onStudio}>
          Ask its CEOs in the studio chat
        </button>
        <button type="button" className="link" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
          Change the portfolio
        </button>
      </div>
      {editing && form}
      <h3 className="group-title portfolio__companies-title">Its companies</h3>
      {members.length === 0 ? (
        <p className="settings__note">No companies in it yet. Add some with Change the portfolio.</p>
      ) : (
        <ul className="lobby-rows">{members.map(({ entry, row }) => renderCompany(entry, row))}</ul>
      )}
      <button type="button" className="link link--danger portfolio__delete" aria-disabled={!online || deleting || undefined} onClick={onDelete}>
        {deleting ? 'Deleting…' : 'Delete the portfolio'}
      </button>
      <p className="settings__note">Its companies stay in the lobby and keep running; only the group, its shared budget and its brief go.</p>
    </section>
  );
}
