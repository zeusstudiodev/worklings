// "Watch an existing project" (SPEC-v3.md, "First run guides people"): a folder, then what watching it would write,
// then the hooks only on an explicit "Add the hooks". The hub's routes are setup-routes.ts's /api/watch.
import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { type HubActions, OFFLINE_SENTENCE } from '../api.ts';
import { CopyButton } from '../people/shared.tsx';
import { FolderBrowser } from '../start/StartCompany.tsx';
import { fetchWatchPlan, installWatch } from './setupApi.ts';
import { removeCommand, type WatchPlan, type WatchResult, watchLines } from './setupModel.ts';

type Step =
  | { kind: 'ask' }
  | { kind: 'reading' }
  | { kind: 'plan'; plan: WatchPlan }
  | { kind: 'writing'; plan: WatchPlan }
  | { kind: 'done'; result: WatchResult };

const sentence = (error: unknown) => (error instanceof Error && error.message.trim() ? error.message : OFFLINE_SENTENCE);

export function WatchProject({ hub, token, online, announce }: { hub: HubActions; token: string | null; online: boolean; announce: (text: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'ask' });
  const [problem, setProblem] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const folderBox = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const lead = useRef<HTMLParagraphElement>(null);
  // Only the latest press may answer, and a changed folder drops the plan: what is shown is always for the folder typed.
  const latest = useRef(0);

  const change = (path: string) => {
    latest.current++;
    setFolder(path);
    setStep({ kind: 'ask' });
    setProblem(null);
  };

  const close = () => {
    latest.current++;
    setOpen(false);
    setFolder('');
    setBrowsing(false);
    setStep({ kind: 'ask' });
    setProblem(null);
    // The link comes back on the next render: focus goes there rather than being lost with the form.
    window.setTimeout(() => opener.current?.focus(), 0);
  };

  const read = async () => {
    const typed = folder.trim();
    if (!online || step.kind === 'reading') return;
    if (!typed) {
      setProblem("Pick the project's folder: type its path or browse to it.");
      folderBox.current?.focus();
      return;
    }
    const mine = ++latest.current;
    setProblem(null);
    setStep({ kind: 'reading' });
    try {
      const plan = await fetchWatchPlan(token, typed);
      if (mine !== latest.current) return;
      // "Show what changes" goes with the form's actions: focus follows to what the folder would get, which is said in
      // one short line (the plan itself is not a live region, so its buttons aren't announced with it).
      flushSync(() => setStep({ kind: 'plan', plan }));
      lead.current?.focus();
      announce(plan.installed ? 'Read the folder. Its hooks are already there.' : `Read the folder. Watching it would add ${plan.events} hooks: review them before adding.`);
    } catch (error) {
      if (mine !== latest.current) return;
      setStep({ kind: 'ask' });
      setProblem(sentence(error));
      folderBox.current?.focus();
    }
  };

  const add = async (plan: WatchPlan) => {
    if (!online || step.kind === 'writing') return;
    const mine = ++latest.current;
    setProblem(null);
    setStep({ kind: 'writing', plan });
    try {
      const result = await installWatch(token, plan.folder, plan.port);
      if (mine === latest.current) setStep({ kind: 'done', result });
    } catch (error) {
      if (mine !== latest.current) return;
      setStep({ kind: 'plan', plan });
      setProblem(sentence(error));
    }
  };

  if (!open) {
    return (
      <p className="lobby-more">
        <button ref={opener} type="button" className="link" aria-expanded={false} aria-controls={`${id}-watch`} onClick={() => setOpen(true)}>
          Watch an existing project
        </button>
      </p>
    );
  }

  const plan = step.kind === 'plan' || step.kind === 'writing' ? step.plan : null;
  return (
    <section id={`${id}-watch`} className="settings__group watch" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="settings__legend">
        Watch an existing project
      </h2>
      <p className="settings__note">Shows the office what a project's Claude Code sessions do, without starting a company. Nothing is written until you say so.</p>
      {step.kind === 'done' ? (
        <Done result={step.result} onClose={close} announce={announce} />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void read();
          }}
        >
          <div className="start__field">
            <label className="start__label" htmlFor={`${id}-folder`}>
              Project folder
            </label>
            <div className="start__folder">
              <input
                ref={folderBox}
                id={`${id}-folder`}
                className="text-input start__path"
                value={folder}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                autoFocus
                placeholder="C:\Users\you\Projects\my-app"
                aria-invalid={problem && !plan ? true : undefined}
                aria-describedby={problem && !plan ? `${id}-problem` : undefined}
                onChange={(e) => change(e.target.value)}
              />
              <button type="button" className="button" aria-expanded={browsing} aria-controls={browsing ? `${id}-browser` : undefined} onClick={() => setBrowsing((b) => !b)}>
                Browse
              </button>
            </div>
            {browsing && <FolderBrowser id={`${id}-browser`} hub={hub} start={folder.trim() || null} onPick={change} />}
          </div>
          {!plan && (
            <div className="watch__actions">
              <button type="submit" className="button button--primary" aria-disabled={!online || step.kind === 'reading' || undefined}>
                {step.kind === 'reading' ? 'Reading…' : 'Show what changes'}
              </button>
              <button type="button" className="link" onClick={close}>
                Cancel
              </button>
            </div>
          )}
        </form>
      )}
      {plan && (
        <div className="watch__plan">
          <p ref={lead} tabIndex={-1} className="watch__lead">
            Watching this folder would do the following.
          </p>
          <ul className="watch__list">
            {watchLines(plan).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="watch__actions">
            {!plan.installed && (
              <button type="button" className="button button--primary" aria-disabled={!online || step.kind === 'writing' || undefined} onClick={() => void add(plan)}>
                {step.kind === 'writing' ? 'Adding…' : 'Add the hooks'}
              </button>
            )}
            <button type="button" className="link" onClick={close}>
              {plan.installed ? 'Close' : 'Cancel'}
            </button>
          </div>
          {plan.installed && <OpenLine command={plan.open} announce={announce} />}
        </div>
      )}
      {problem && (
        <p id={`${id}-problem`} className="settings__problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** A command to run in a terminal, with Copy beside it. */
function CommandRow({ command, what, announce }: { command: string; what: string; announce: (text: string) => void }) {
  return (
    <div className="watch__command">
      <code className="watch__code">{command}</code>
      <CopyButton text={command} what={what} announce={announce} />
    </div>
  );
}

function OpenLine({ command, announce }: { command: string; announce: (text: string) => void }) {
  return (
    <div className="watch__open">
      <p>Open the office for it with this command:</p>
      <CommandRow command={command} what="the command that opens the office" announce={announce} />
    </div>
  );
}

function Done({ result, onClose, announce }: { result: WatchResult; onClose: () => void; announce: (text: string) => void }) {
  const lead = useRef<HTMLParagraphElement>(null);
  useEffect(() => lead.current?.focus(), []);
  return (
    <div className="watch__done">
      <p ref={lead} tabIndex={-1} className="watch__lead">
        Hooks added to {result.file}
        {result.gitignoreUpdated ? ', and the .gitignore has its line' : ''}.
      </p>
      <OpenLine command={result.open} announce={announce} />
      <p className="settings__note">That office runs on its own, so this lobby doesn't list watched folders.</p>
      <p className="settings__note">To take the hooks out later, run this command:</p>
      <CommandRow command={removeCommand(result.folder)} what="the command that takes the hooks out" announce={announce} />
      <div className="watch__actions">
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
