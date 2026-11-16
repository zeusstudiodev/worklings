// The lobby's first-run callout: Claude Code missing or signed out (docs/design-v3.md, "Lobby"). It says the status's
// sentence, the one fix and its page, and "Check again" asks the hub afresh. Missing and signed out stop Start.
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fetchSetup } from './setupApi.ts';
import { type ClaudeNotice, claudeNotice, noticeSpeech, type SetupView } from './setupModel.ts';

export interface SetupState {
  notice: ClaudeNotice | null;
  /** A check is out, so the button says so. */
  checking: boolean;
  /** Why the last "Check again" got no answer; null otherwise. */
  problem: string | null;
  checkAgain: () => void;
}

/**
 * Asks the hub about Claude Code when the lobby opens, and again when the tab comes back while it isn't ready. The
 * result is said once, through `announce`, and `onReady` runs when a "Check again" finds it ready: the callout, and the
 * button that was pressed, are gone by then, so the caller puts focus somewhere sensible.
 */
export function useSetup(token: string | null, enabled: boolean, announce: (text: string) => void, onReady?: () => void): SetupState {
  const [view, setView] = useState<SetupView | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Only the latest check may answer: a slow first answer never overwrites a newer one.
  const latest = useRef(0);
  // What the lookups call is read as it is when they answer, so a new function from the lobby never restarts a check.
  const calls = useRef({ announce, onReady });
  useEffect(() => {
    calls.current = { announce, onReady };
  });

  const run = useCallback(
    async (fresh: boolean, said: boolean) => {
      const mine = ++latest.current;
      try {
        const next = await fetchSetup(token, fresh);
        if (mine !== latest.current) return;
        const notice = claudeNotice(next.claude);
        // The callout leaves with the check: its button goes in the same step, so focus can be handed on at once.
        flushSync(() => {
          setView(next);
          setProblem(null);
        });
        if (said) calls.current.announce(notice ? noticeSpeech(notice) : 'Claude Code is ready.');
        if (said && !notice) calls.current.onReady?.();
      } catch (error) {
        if (mine !== latest.current) return;
        // A first look that fails says nothing (the lobby works without it); a button press says why.
        if (said) {
          const text = `Couldn't check Claude Code. ${error instanceof Error ? error.message : ''}`.trim();
          setProblem(text);
          calls.current.announce(text);
        }
      } finally {
        if (mine === latest.current) setChecking(false);
      }
    },
    [token],
  );

  // The first look, from the hub's memory. A failure says nothing: the lobby works without it.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchSetup(token, false).then(
      (next) => {
        if (cancelled || latest.current !== 0) return;
        setView(next);
        // A callout that appears by itself is said once, as it appears (it has no live region of its own).
        const notice = claudeNotice(next.claude);
        if (notice) calls.current.announce(noticeSpeech(notice));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, token]);

  const notice = enabled && view ? claudeNotice(view.claude) : null;
  const waiting = notice !== null;
  // Signing in happens in a terminal: coming back to this tab looks again.
  useEffect(() => {
    if (!enabled || !waiting) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run(true, false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, waiting, run]);

  const checkAgain = () => {
    if (checking) return;
    setChecking(true);
    void run(true, true);
  };
  return { notice, checking, problem, checkAgain };
}

export const CLAUDE_PROBLEM_ID = 'claude-problem';

export function SetupCallout({ state }: { state: SetupState }) {
  const { notice, checking, problem, checkAgain } = state;
  if (!notice) return null;
  return (
    // No live role here: it would read "Check again" with the rest, and the result is announced once, by the lobby.
    <section className="callout callout--warn setup-callout" aria-labelledby={CLAUDE_PROBLEM_ID}>
      <h2 id={CLAUDE_PROBLEM_ID} className="callout__title">
        {notice.title}
      </h2>
      {notice.shown && <p>{notice.shown}</p>}
      {notice.fix && <p>{commandWords(notice.fix)}</p>}
      <div className="setup-callout__actions">
        {notice.link && (
          <a className="button" href={notice.link.href} target="_blank" rel="noreferrer noopener">
            {notice.link.label}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        )}
        <button type="button" className="button" aria-disabled={checking || undefined} onClick={checkAgain}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {problem && <p className="settings__problem">{problem}</p>}
    </section>
  );
}

/** "Run claude once": the command in code, so it reads (and copies) as one. */
function commandWords(text: string): ReactNode {
  return text.split(/(\brun )(claude)(?![\w-])/gi).map((part, i, all) => (all[i - 1]?.toLowerCase() === 'run ' && part.toLowerCase() === 'claude' ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>));
}
