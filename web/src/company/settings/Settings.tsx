// The company's settings (docs/design-v3.md, "Customize and Settings"): desks at once, plan approval, what people may do
// without asking and what always waits for you, the Claude account, the work branch, every room's and person's leash,
// and leaving the lobby.
import { useId, useRef, useState } from 'react';
import { countWord } from '../../../../src/core/now.ts';
import { capital } from '../../../../src/core/words.ts';
import type { HubActions } from '../api.ts';
import { LeashOverview } from '../leash/LeashControls.tsx';
import { CopyButton } from '../people/shared.tsx';
import { clearLobbyNotice, setLobbyNotice } from '../notice.ts';
import { PlanApprovalSetting } from '../plan/PlanApprovalSetting.tsx';
import { navigate } from '../router.ts';
import type { TabProps } from '../types.ts';
import { BudgetFields } from '../spending/BudgetFields.tsx';
import { modelsSentence } from '../spending/spendingModel.ts';
import { UndoLine } from '../ui/UndoLine.tsx';
import { useFollowedField } from '../ui/useFollowedField.ts';
import { inDemo } from '../demo.ts';
import { offersRemoval, ruleSentence } from './settingsModel.ts';
import './settings.css';

/** Where the office keeps the brief, in the project folder (src/company/brief.ts, BRIEF_REL: the view doesn't carry it). */
export const BRIEF_PATH = '.worklings-shared/brief.md';

/** Most desks one company may set; the hub caps every company together too. */
export const MAX_COMPANY_DESKS = 20;
const UNDO_SHOWN_MS = 10_000;
const undoUntil = () => Date.now() + UNDO_SHOWN_MS;

/** "Up to eight people work at once. More is faster and uses your plan faster." */
export const desksSentence = (n: number, billing: 'plan' | 'api-key'): string =>
  `Up to ${countWord(n)} ${n === 1 ? 'person works' : 'people work'} at once. More is faster and ${billing === 'plan' ? 'uses your plan faster' : 'spends faster'}.`;

/** Whether this tab is itself the demo: the static site, or one that opened at the demo (storage may be blocked). */
function ownDemoTab(): boolean {
  if (import.meta.env.MODE === 'site') return true;
  try {
    return inDemo();
  } catch {
    return false;
  }
}

export function Settings(props: TabProps & { hub: HubActions; demo: boolean }) {
  const { company, companyId, actions, online, snapshot, hub } = props;
  const id = useId();
  const [demoTab] = useState(ownDemoTab);
  const removable = offersRemoval(props.demo, demoTab);
  const offline = online ? null : 'The office is reconnecting, so changes wait.';
  // Another tab may change the desks: the field follows the stream until you type in it.
  const desksField = useFollowedField(company.settings.maxDesks);
  const desks = desksField.text;
  const [desksDone, setDesksDone] = useState<{ before: number; until: number } | null>(null);
  const [problem, setProblem] = useState<{ where: 'desks' | 'rules' | 'remove'; text: string } | null>(null);
  const [busy, setBusy] = useState<'desks' | 'rules' | 'remove' | null>(null);
  // One change at a time, so answers can't come back out of order.
  const changing = useRef(false);
  const undoRef = useRef<HTMLButtonElement>(null);

  const wanted = Number(desks);
  const validDesks = Number.isInteger(wanted) && wanted >= 1 && wanted <= MAX_COMPANY_DESKS;

  const failed = (where: 'desks' | 'rules' | 'remove', error: unknown) => setProblem({ where, text: error instanceof Error ? error.message : "The office didn't answer. Try again." });

  const saveDesks = async (n: number, undoable: boolean) => {
    if (!online || changing.current) return;
    changing.current = true;
    const before = company.settings.maxDesks;
    setBusy('desks');
    setProblem(null);
    try {
      const settings = await actions.updateSettings({ maxDesks: n });
      desksField.saved(settings.maxDesks);
      setDesksDone(undoable ? { before, until: undoUntil() } : null);
      if (undoable) window.setTimeout(() => undoRef.current?.focus(), 0);
    } catch (error) {
      failed('desks', error);
    } finally {
      changing.current = false;
      setBusy(null);
    }
  };

  const removeRule = async (rule: string) => {
    if (!online || changing.current) return;
    changing.current = true;
    setBusy('rules');
    setProblem(null);
    try {
      await actions.updateSettings({ removeRule: rule });
    } catch (error) {
      failed('rules', error);
    } finally {
      changing.current = false;
      setBusy(null);
    }
  };

  const leave = async () => {
    if (!online || changing.current) return;
    changing.current = true;
    setBusy('remove');
    setProblem(null);
    // Said before the removal: the company's own view goes the moment it leaves, and sends the tab to the lobby.
    setLobbyNotice({ text: `${company.name} left the lobby. Its folder and .worklings/ stay, so adding the folder again reopens it.`, undo: { folder: snapshot.project.root } });
    try {
      await hub.removeCompany(companyId);
      // The lobby takes Settings' place: an entry pushed here would be one more that Back leads into a company gone.
      navigate('/', { replace: true });
    } catch (error) {
      clearLobbyNotice();
      failed('remove', error);
      changing.current = false;
      setBusy(null);
    }
  };

  const problemFor = (where: 'desks' | 'rules' | 'remove') =>
    problem?.where === where && (
      <p className="settings__problem" role="alert">
        {problem.text}
      </p>
    );

  return (
    <div className="settings">
      <h2 className="panel-title" tabIndex={-1} data-panel-heading>
        Settings
      </h2>
      {offline && <p className="muted">{offline}</p>}

      <form
        className="settings__group"
        aria-labelledby={`${id}-desks`}
        onSubmit={(event) => {
          event.preventDefault();
          if (validDesks && wanted !== company.settings.maxDesks && !busy) void saveDesks(wanted, true);
        }}
      >
        <h3 id={`${id}-desks`} className="settings__legend">
          Desks at once
        </h3>
        <p className="settings__note">{desksSentence(company.settings.maxDesks, company.settings.billing)}</p>
        <div className="settings__inline">
          <label className="visually-hidden" htmlFor={`${id}-desks-input`}>
            Desks at once, 1 to {MAX_COMPANY_DESKS}
          </label>
          <input
            id={`${id}-desks-input`}
            className="text-input text-input--number"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_COMPANY_DESKS}
            value={desks}
            onChange={(e) => desksField.type(e.target.value)}
            aria-describedby={!validDesks ? `${id}-desks-why` : undefined}
          />
          <button type="submit" className="button" aria-disabled={!online || !validDesks || wanted === company.settings.maxDesks || busy !== null || undefined}>
            Save
          </button>
        </div>
        {!validDesks && (
          <p id={`${id}-desks-why`} className="settings__problem">
            Pick 1 to {MAX_COMPANY_DESKS} desks.
          </p>
        )}
        {desksDone && <UndoLine ref={undoRef} text="Changed." until={desksDone.until} onUndo={() => void saveDesks(desksDone.before, false)} unavailable={!online || busy !== null} />}
        {problemFor('desks')}
        <p className="settings__note">The lobby's Settings hold the limit across all your companies.</p>
      </form>

      <section className="settings__group" aria-labelledby={`${id}-budget`}>
        <h3 id={`${id}-budget`} className="settings__legend">
          Budget
        </h3>
        {company.pause?.reason === 'budget' && (
          <div className="spend-paused" role="status">
            <p>{company.pause.message}</p>
          </div>
        )}
        <BudgetFields company={company} actions={actions} online={online} focusCompany={company.pause?.reason === 'budget'} />
      </section>

      {company.spending && (
        <section className="settings__group" aria-labelledby={`${id}-plan`}>
          <h3 id={`${id}-plan`} className="settings__legend">
            Spending plan
          </h3>
          <p className="spend-preset-readout">
            <strong>{company.spending.presets.find((p) => p.id === company.spending?.preset)?.label ?? company.spending.preset}</strong>, chosen at the start.
          </p>
          <p className="settings__note">
            {modelsSentence(company.spending.models)} The preset and the models are set when the company starts; change a person's model from the org chart and the desks at once above.
          </p>
        </section>
      )}

      {/* Plan approval: before work starts, at every milestone, or off. It draws nothing until the company has steering. */}
      <PlanApprovalSetting company={company} steer={props.steer} online={online} announce={props.announce} />

      <section className="settings__group" aria-labelledby={`${id}-allowed`}>
        <h3 id={`${id}-allowed`} className="settings__legend">
          Allowed without asking
        </h3>
        <p className="settings__note">
          Routine work goes ahead by itself: reading and editing the project, its own commands such as tests and the dev server, adding dependencies, and commits on the work branch.
        </p>
        {company.settings.alwaysAllow.length > 0 ? (
          <>
            <p className="settings__note">{capital(countWord(company.settings.alwaysAllow.length))} {company.settings.alwaysAllow.length === 1 ? 'rule' : 'rules'} you added with Always allow:</p>
            <ul className="rule-list">
              {company.settings.alwaysAllow.map((rule) => {
                // The inbox's words for it when an approval still carries them, with the rule Claude Code matches under.
                const sentence = ruleSentence(rule, company.approvals);
                return (
                  <li key={rule} className="rule-list__item">
                    {sentence ? (
                      <span className="rule-list__rule">
                        {capital(sentence)}
                        <code className="rule-list__code">{rule}</code>
                      </span>
                    ) : (
                      <code className="rule-list__rule">{rule}</code>
                    )}
                    <button type="button" className="link" aria-disabled={!online || busy !== null || undefined} onClick={() => void removeRule(rule)}>
                      Remove<span className="visually-hidden"> the rule for {sentence ?? rule}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="settings__note">No Always allow rules yet: they appear here when you press Always allow on a request.</p>
        )}
        {problemFor('rules')}
      </section>

      <section className="settings__group" aria-labelledby={`${id}-asked`}>
        <h3 id={`${id}-asked`} className="settings__legend">
          Always asked
        </h3>
        <p className="settings__note">
          Pushing, deploying, publishing, anything outside the project, deleting branches, paid APIs, messages to people outside the company and changes to global config always wait for your answer in the inbox.
        </p>
      </section>

      <section className="settings__group" aria-labelledby={`${id}-account`}>
        <h3 id={`${id}-account`} className="settings__legend">
          Your Claude account
        </h3>
        <p className="settings__note">
          {company.settings.billing === 'plan'
            ? 'Runs your own Claude Code. On a plan, costs are API-equivalent estimates.'
            : 'Claude Code uses an API key, so costs are real.'}{' '}
          Worklings never reads, stores or asks for your sign-in.
        </p>
      </section>

      {company.phase !== 'founding' && company.phase !== 'proposed' && (
        <section className="settings__group" aria-labelledby={`${id}-brief`}>
          <h3 id={`${id}-brief`} className="settings__legend">
            The brief every person reads
          </h3>
          <p className="settings__note">
            Your first request word for word, your answers, the decisions since and the plan's milestones, in one small file the office keeps current. Everyone reads it instead of being told again in every message.
          </p>
          <p className="settings__note">
            <code>{BRIEF_PATH}</code> in the project folder.
          </p>
          <CopyButton text={`${snapshot.project.root.replace(/[/\\]+$/, '')}/${BRIEF_PATH}`} what="the brief's path" announce={props.announce} />
        </section>
      )}

      <section className="settings__group" aria-labelledby={`${id}-branch`}>
        <h3 id={`${id}-branch`} className="settings__legend">
          Work branch
        </h3>
        <p className="settings__note">
          {company.branch ? (
            <>
              <code>{company.branch}</code>. The company commits there and never pushes.
            </>
          ) : (
            "This folder isn't a git repository, so finished tasks aren't committed until it is one."
          )}
        </p>
      </section>

      {props.steer && (
        <div className="settings__group">
          <LeashOverview
            snapshot={snapshot}
            company={company}
            companyId={companyId}
            navigate={props.navigate}
            online={online}
            announce={props.announce}
            steer={props.steer}
            headingClass="settings__legend"
          />
        </div>
      )}

      <section className="settings__group settings__group--last" aria-labelledby={`${id}-remove`}>
        <h3 id={`${id}-remove`} className="settings__legend">
          Remove from the lobby
        </h3>
        {removable ? (
          <>
            <p className="settings__note">Closes every desk and keeps the folder and .worklings/, so the company reopens when you add the folder again.</p>
            <button type="button" className="button button--danger" aria-disabled={!online || busy !== null || undefined} onClick={() => void leave()}>
              {busy === 'remove' ? 'Removing…' : `Remove ${company.name} from the lobby`}
            </button>
            {problemFor('remove')}
          </>
        ) : (
          <p className="settings__note">This demo company is made up and isn't in your lobby, so there is nothing to remove.</p>
        )}
      </section>
    </div>
  );
}
