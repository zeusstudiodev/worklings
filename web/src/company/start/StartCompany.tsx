// Start a company (docs/design-v3.md, "Start a company"): one form. The folder, with suggestions and a browser the
// hub reads a level at a time, and what detection found there; what to build; then Start. Nothing is created until
// the press succeeds, and a refusal keeps both fields.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { LIMITS, type LobbyView } from '../../../../src/core/company.ts';
import type { WorkChoice } from '../../../../src/core/plain.ts';
import type { FolderInfo, HubActions } from '../api.ts';
import { joinPath, parentOf } from '../paths.ts';
import { cutMiddle } from '../model.ts';
import { companyPath, navigate } from '../router.ts';
import { ActionError } from '../types.ts';
import { aboutFolder, type FolderReading, newFolderLine, readFolder } from './startModel.ts';

/** What the hub's create route takes (LIMITS.prompt). */
const PROMPT_MAX = LIMITS.prompt;
const RECENT_KEY = 'worklings-recent-folders';
/** How the work runs, as the form offers it: one session first, the team as an experiment with what it cost us. */
export const WORK_OPTIONS: readonly { value: WorkChoice; label: string; note: string }[] = [
  { value: 'plain', label: 'One Claude Code session', note: 'Your words go to your own Claude Code as you wrote them, with your own setup. The office shows and steers what it does.' },
  {
    value: 'team',
    label: 'A team (experimental)',
    note: 'A Lead plans, a Builder builds and a Reviewer checks and sends fixes back. In our tests it cost about twice as much and was not better than one session.',
  },
];

const EXAMPLES = [
  'A bilingual website for a café, with pickup orders paid by TWINT.',
  'A cozy iPhone game where you look after a houseplant.',
  'Swiss bookkeeping for Shopify shops that matches bank statements to orders.',
];

/** Folders this browser started companies in, newest first. */
export function recentFolders(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((f): f is string => typeof f === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

function remember(folder: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([folder, ...recentFolders().filter((f) => f !== folder)].slice(0, 5)));
  } catch {
    // Private windows may refuse storage: suggestions are a convenience.
  }
}

/** The suggestions under the folder field: recent folders, then the folders companies sit in. */
export function folderSuggestions(recent: readonly string[], lobby: LobbyView | null): string[] {
  const parents = (lobby?.companies ?? []).map((c) => parentOf(c.root)).filter((p): p is string => p !== null);
  return [...new Set([...recent, ...parents])].slice(0, 4);
}

interface StartProps {
  hub: HubActions;
  lobby: LobbyView | null;
  /** A problem every company shares (a usage limit): Start waits until it clears. */
  blocked: string | null;
  online: boolean;
  /** In the lobby's first run, the form sits under the welcome. */
  embedded?: boolean;
}

export function StartCompany({ hub, lobby, blocked, online, embedded = false }: StartProps) {
  const id = useId();
  const [folder, setFolder] = useState('');
  const [prompt, setPrompt] = useState('');
  const [work, setWork] = useState<WorkChoice>('plain');
  const [info, setInfo] = useState<{ path: string; reading: FolderReading } | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [promptProblem, setPromptProblem] = useState<string | null>(null);
  // A refused start: about the folder it shows by the folder field, anything else under Start.
  const [startProblem, setStartProblem] = useState<{ where: 'folder' | 'form'; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [recent] = useState(recentFolders);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  const folderBox = useRef<HTMLInputElement>(null);
  const suggestions = folderSuggestions(recent, lobby);

  // A refused start no longer holds once either field changes.
  const changeFolder = (path: string) => {
    setFolder(path);
    setStartProblem(null);
  };
  const changePrompt = (words: string) => {
    setPrompt(words);
    setPromptProblem(null);
    setStartProblem(null);
  };

  // What's in the folder, read a moment after the typing stops.
  const typed = folder.trim();
  useEffect(() => {
    if (!typed) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setReading(typed);
      void readFolder(hub, typed).then((read) => {
        if (cancelled) return;
        setInfo({ path: typed, reading: read });
        setReading(null);
      });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // A read given up on says nothing more: "Reading" belongs to the path it was for.
      setReading(null);
    };
  }, [typed, hub]);

  const shown = info && info.path === typed ? info.reading : null;
  // Why a company can't start in this folder, once: a refused start, else what the reading found.
  const folderRefusal = startProblem?.where === 'folder' ? startProblem.text : shown?.kind === 'refused' ? shown.refusal : shown?.kind === 'folder' ? shown.folder.refusal : null;
  const unavailable = blocked ?? (online ? null : 'The office is reconnecting, so starting waits.');

  const start = async () => {
    if (unavailable || starting) return;
    const words = prompt.trim();
    setStartProblem(null);
    if (!words) {
      setPromptProblem('Say what to build.');
      promptBox.current?.focus();
      return;
    }
    if (words.length > PROMPT_MAX) {
      setPromptProblem(`Keep it to ${PROMPT_MAX.toLocaleString('en-US')} characters: shorten it by ${(words.length - PROMPT_MAX).toLocaleString('en-US')}.`);
      return;
    }
    if (!typed) {
      setStartProblem({ where: 'folder', text: 'Pick a folder for the company: type its path or browse to it.' });
      folderBox.current?.focus();
      return;
    }
    setStarting(true);
    try {
      const { id: company } = await hub.createCompany(typed, words, work);
      remember(typed);
      // The company takes the start form's place, so Back goes to the lobby rather than to a form already sent; the
      // first run's form is part of the lobby, which stays. A session goes straight to work; the team's CEO drafts first.
      navigate(companyPath(company, work === 'team' ? 'proposal' : ''), { replace: !embedded });
    } catch (error) {
      const text = error instanceof Error ? error.message : "The office didn't answer. Try again.";
      if (aboutFolder(error)) {
        setStartProblem({ where: 'folder', text });
        folderBox.current?.focus();
      } else if (error instanceof ActionError && error.code === 'bad-input') {
        setPromptProblem(text);
        promptBox.current?.focus();
      } else setStartProblem({ where: 'form', text });
      setStarting(false);
    }
  };

  const onPromptKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void start();
    }
  };

  return (
    <form
      className={`start${embedded ? ' start--embedded' : ''}`}
      aria-labelledby={embedded ? undefined : `${id}-title`}
      aria-label={embedded ? 'Start a company' : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      {!embedded && (
        <h2 id={`${id}-title`} className="panel-title" tabIndex={-1} data-panel-heading>
          Start a company
        </h2>
      )}

      <div className="start__field">
        <label className="start__label" htmlFor={`${id}-folder`}>
          Folder
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
            placeholder="C:\Users\you\Projects\my-app"
            aria-invalid={folderRefusal ? true : undefined}
            aria-describedby={folderRefusal ? `${id}-folder-refusal` : `${id}-folder-about`}
            onChange={(e) => changeFolder(e.target.value)}
          />
          <button type="button" className="button" aria-expanded={browsing} aria-controls={browsing ? `${id}-browser` : undefined} onClick={() => setBrowsing((b) => !b)}>
            Browse
          </button>
        </div>
        {suggestions.length > 0 && !typed && (
          <div className="start__suggestions" role="group" aria-label="Suggested folders">
            {suggestions.map((s) => (
              <button key={s} type="button" className="talk__suggestion start__suggestion" title={s} onClick={() => changeFolder(joinPath(s, ''))}>
                {cutMiddle(s, 30)}
              </button>
            ))}
          </div>
        )}
        <div id={`${id}-folder-about`} className="start__about" aria-live="polite">
          {reading && typed && <p className="start__reading">Reading {cutMiddle(reading, 40)}…</p>}
          {!reading && shown?.kind === 'folder' && shown.folder.detected && <p className="start__detected">{shown.folder.detected}</p>}
          {(!reading || startProblem?.where === 'folder') && folderRefusal && (
            <p id={`${id}-folder-refusal`} className="start__refusal">
              {folderRefusal}
            </p>
          )}
          {!reading && !folderRefusal && shown?.kind === 'new' && <p className="start__note">{newFolderLine(shown.parent)}</p>}
          {!reading &&
            shown?.kind === 'folder' &&
            shown.folder.notes.map((n) => (
              <p key={n} className="start__note">
                {n}
              </p>
            ))}
        </div>
        {browsing && <FolderBrowser id={`${id}-browser`} hub={hub} start={typed || null} onPick={changeFolder} />}
      </div>

      <div className="start__field">
        <label className="start__label" htmlFor={`${id}-prompt`}>
          What should the company build?
        </label>
        <textarea
          ref={promptBox}
          id={`${id}-prompt`}
          className={`prose-input start__prompt${promptProblem ? ' is-over' : ''}`}
          rows={4}
          value={prompt}
          aria-describedby={`${id}-prompt-hint`}
          aria-invalid={promptProblem ? true : undefined}
          onKeyDown={onPromptKey}
          onChange={(e) => changePrompt(e.target.value)}
        />
        <p id={`${id}-prompt-hint`} className="start__hint">
          {promptProblem ?? (work === 'team' ? 'One sentence is enough. The CEO asks about the rest.' : 'Write it as you would to Claude Code. It asks if it needs to.')}
          {prompt.length > PROMPT_MAX * 0.8 && (
            <span className="start__count">
              {' '}
              {prompt.length.toLocaleString('en-US')} of {PROMPT_MAX.toLocaleString('en-US')}
            </span>
          )}
        </p>
        <div className="start__examples" role="group" aria-label="Examples, which fill the box">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              className="talk__suggestion"
              onClick={() => {
                changePrompt(e);
                promptBox.current?.focus();
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="start__field start__work">
        <legend className="start__label">How the work runs</legend>
        {WORK_OPTIONS.map((o) => (
          <label key={o.value} className={`start__choice${work === o.value ? ' is-chosen' : ''}`}>
            <input type="radio" name={`${id}-work`} value={o.value} checked={work === o.value} aria-describedby={`${id}-work-${o.value}`} onChange={() => setWork(o.value)} />
            <span className="start__choice-text">
              <span className="start__choice-label">{o.label}</span>
              <span id={`${id}-work-${o.value}`} className="start__choice-note">
                {o.note}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="start-block">
        <button type="submit" className="button button--primary button--large" aria-disabled={unavailable !== null || starting || undefined} aria-describedby={`${id}-cost`}>
          {starting ? 'Starting…' : 'Start the company'}
        </button>
        <p id={`${id}-cost`} className="start-block__note">
          {unavailable ?? (work === 'team' ? 'The CEO drafts your org on your Claude Code model: about 15¢ on Opus, less on Sonnet.' : 'It runs on your own Claude Code and starts at once. You see what it costs as it works.')}
        </p>
        {startProblem?.where === 'form' && (
          <p className="start-block__problem" role="alert">
            {startProblem.text}
          </p>
        )}
      </div>
    </form>
  );
}

export function FolderBrowser({ id, hub, start, onPick }: { id: string; hub: HubActions; start: string | null; onPick: (path: string) => void }) {
  const [at, setAt] = useState<string>(start ?? '');
  const [listing, setListing] = useState<{ for: string; folder: FolderInfo | null; problem: string | null } | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [makeProblem, setMakeProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    hub.folders(at).then(
      (folder) => !cancelled && setListing({ for: at, folder, problem: null }),
      (error: unknown) => !cancelled && setListing({ for: at, folder: null, problem: error instanceof Error ? error.message : "The office didn't answer. Try again." }),
    );
    return () => {
      cancelled = true;
    };
  }, [at, hub]);

  const current = listing?.for === at ? listing : null;
  const here = current?.folder?.path ?? at;

  return (
    <div id={id} className="browser" role="group" aria-label="Browse folders">
      {!current ? (
        <p className="start__reading">Reading {cutMiddle(at || 'your home folder', 40)}…</p>
      ) : current.problem ? (
        <p className="start__refusal">{current.problem}</p>
      ) : (
        <>
          <p className="browser__here" title={here}>
            {cutMiddle(here, 44)}
          </p>
          <ul className="browser__list">
            {current.folder?.parent && (
              <li>
                <button type="button" className="browser__item browser__item--up" onClick={() => setAt(current.folder?.parent ?? '')}>
                  Up to {cutMiddle(current.folder.parent, 30)}
                </button>
              </li>
            )}
            {current.folder?.folders.map((f) => (
              <li key={f}>
                <button type="button" className="browser__item" onClick={() => setAt(joinPath(here, f))}>
                  {f}
                </button>
              </li>
            ))}
            {current.folder?.folders.length === 0 && <li className="browser__empty">No folders in here.</li>}
          </ul>
          {current.folder?.detected && <p className="start__detected">{current.folder.detected}</p>}
          <div className="browser__actions">
            <button type="button" className="button button--primary" onClick={() => onPick(here)}>
              Use this folder
            </button>
            {!naming ? (
              <button type="button" className="button" onClick={() => setNaming(true)}>
                New folder here
              </button>
            ) : (
              <span className="browser__new">
                <label className="visually-hidden" htmlFor={`${id}-new`}>
                  New folder's name
                </label>
                <input id={`${id}-new`} className="text-input" value={name} autoComplete="off" spellCheck={false} autoFocus onChange={(e) => {
                    setName(e.target.value);
                    setMakeProblem(null);
                  }}
                />
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    hub.newFolder(here, name).then(
                      (path) => {
                        setNaming(false);
                        setName('');
                        setAt(path);
                        onPick(path);
                      },
                      (error: unknown) => setMakeProblem(error instanceof Error ? error.message : "The office didn't answer. Try again."),
                    );
                  }}
                >
                  Make it
                </button>
              </span>
            )}
          </div>
          {makeProblem && <p className="start__refusal">{makeProblem}</p>}
        </>
      )}
    </div>
  );
}
