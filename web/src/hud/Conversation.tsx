// A conversation with someone in the office (docs/design.md, "Ask aside: a conversation in the scene"): their last
// answers, the question running, suggestions that ask at once and a box for your own. On desktops it sits by the person
// in the scene; on phones, without WebGL and for someone with no figure, it takes the panel's place.
import { type FocusEvent, type KeyboardEvent, useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { type AsideAnswer, type AsideView, cleanQuestion, QUESTION_MAX_CHARS, SUGGESTED_QUESTIONS } from '../../../src/core/aside.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { capital, nameInSentence, severalLeads } from '../../../src/core/words.ts';
import { ApiError, ask, cancelAside } from '../lib/api.ts';
import { ASK_FAILED, blockedReason, CANCELLING, counter, failureCopy, headerLines, refusalCopy, runningLine, runningWho, shownQuestion, signature, type Talk, threadView, withTyped } from './asideModel.ts';

/** A question this browser put that the snapshot doesn't show yet, or that the office turned down. */
export type Attempt =
  | { question: string; state: 'sending'; at: number }
  | { question: string; state: 'sent'; at: number; id: string }
  | { question: string; state: 'refused'; at: number; copy: string };

/** What the office's refusal said, from the request's error: an unreachable office has no status at all. */
function refusalOf(error: unknown) {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message, retryAfter: error.retryAfter };
  return { status: 0, code: null, message: error instanceof Error ? error.message : String(error), retryAfter: null };
}

/**
 * Drafts and attempts, one per conversation, kept while the office is open so closing loses nothing; the words of the
 * questions this tab asked, by their call's id, since the demo doesn't keep the words of free-text ones (as many as the
 * office keeps answers); and the call this tab is cancelling. What the office answers a press is said through
 * `announce`, since focus stays where it was; a failed cancel goes to `onError`.
 */
export function useAskAside(token: string | null, announce: (text: string) => void, onError: (text: string) => void) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  // The office runs one call at a time, so one id is enough; it is new for every call, so it never needs clearing.
  const [cancelling, setCancelling] = useState<string | null>(null);
  const setDraft = useCallback((thread: string, text: string) => setDrafts((d) => ({ ...d, [thread]: text })), []);
  const send = useCallback(
    async (thread: string, agentKey: string, question: string, who: string) => {
      const at = Date.now();
      setAttempts((a) => ({ ...a, [thread]: { question, state: 'sending', at } }));
      try {
        const { id } = await ask(token, agentKey, question);
        setTyped((t) => withTyped(t, id, question));
        setAttempts((a) => ({ ...a, [thread]: { question, state: 'sent', at, id } }));
        // The answer can take a minute: say the question went.
        announce(`Question sent to ${who}.`);
      } catch (error) {
        const copy = refusalCopy(refusalOf(error));
        setAttempts((a) => ({ ...a, [thread]: { question, state: 'refused', at, copy } }));
        announce(`${ASK_FAILED} ${copy}`);
      }
    },
    [token, announce],
  );
  const cancel = useCallback(
    async (id: string) => {
      setCancelling(id);
      try {
        await cancelAside(token, id);
      } catch (error) {
        setCancelling((c) => (c === id ? null : c));
        onError(`Couldn't cancel. ${refusalCopy(refusalOf(error))}`);
      }
    },
    [token, onError],
  );
  return { drafts, attempts, typed, cancelling, setDraft, send, cancel };
}

/** Says each answer and failure as it arrives, through the office's one live region; what was there on opening isn't news. */
export function useAnswerAnnouncements(snapshot: Snapshot | null, announce: (text: string) => void) {
  const known = useRef<Set<string> | null>(null);
  const answers: AsideView['answers'] | null = snapshot?.aside.answers ?? null;
  useEffect(() => {
    if (!answers || !snapshot) return;
    const before = known.current;
    known.current = new Set(answers.map((a) => a.id));
    if (!before) return;
    const fresh = answers.filter((a) => !before.has(a.id) && a.failure?.code !== 'cancelled');
    const last = fresh[fresh.length - 1];
    if (!last) return;
    const agent = snapshot.agents.find((a) => a.key === last.agentKey);
    const who = agent ? nameInSentence(agent, severalLeads(snapshot.agents)) : `the ${last.who}`;
    announce(last.text !== null ? `${capital(who)} answers: ${last.text}` : `${ASK_FAILED} ${last.failure ? failureCopy(last.failure, who) : ''}`.trim());
  }, [answers, snapshot, announce]);
}

/** Scrolls `scroller` (the conversation, never the stage or the page around it) until `el` shows. */
function reveal(scroller: HTMLElement | null, el: HTMLElement) {
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;
  const shown = scroller.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  if (box.bottom > shown.bottom) scroller.scrollTop += box.bottom - shown.bottom + 8;
  else if (box.top < shown.top) scroller.scrollTop -= shown.top - box.top + 8;
}

/** Real time, for "6s so far" and "2 min ago": every second while a call runs, every half minute otherwise. */
function useRealTime(fast: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), fast ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [fast]);
  return now;
}

interface Props {
  snapshot: Snapshot;
  talk: Talk;
  /** Their wayfinding colour, for their bubbles. */
  hue: string;
  /** By the person in the scene, or in the panel's place. */
  variant: 'popover' | 'sheet';
  /** Where focus goes when it opens: the box on desktops, the heading on phones (the keyboard would cover the thread). */
  focusOnOpen: 'box' | 'heading';
  /**
   * Just opened, so focus moves in. When it moves between the scene and the panel (its person left the scene, say),
   * it mounts again without this, and takes focus only if focus went with its old place.
   */
  opening: boolean;
  onOpened: () => void;
  /** Opened without the office's link: asking needs the token. */
  locked: boolean;
  /** While the connection is down: the office time the view stopped at. */
  stoppedAt: number | null;
  draft: string;
  onDraft: (text: string) => void;
  attempt: Attempt | null;
  /** The words of the questions this tab asked, by call id. */
  typed: Readonly<Record<string, string>>;
  /** The call this tab pressed Cancel on: its line says so until the call is gone. */
  cancelling: string | null;
  onAsk: (question: string) => void;
  onCancel: (id: string) => void;
  onClose: () => void;
  /** Phones: the box has focus (the keyboard is up), so the sheet can take the full height. */
  onTyping?: (typing: boolean) => void;
}

export function Conversation({ snapshot, talk, hue, variant, focusOnOpen, opening, onOpened, locked, stoppedAt, draft, onDraft, attempt, typed, cancelling, onAsk, onCancel, onClose, onTyping }: Props) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  // Whether the newest exchange was in view before this render: only then does something new scroll into view.
  const atEnd = useRef(true);
  // What the thread held when it last scrolled, so a ticking "6s so far" doesn't pull it back on every second.
  const shown = useRef('');
  // Cancel or Ask again, while it has focus: when it goes, focus moves to the box rather than dropping to the page.
  const transient = useRef<HTMLElement | null>(null);

  const view = threadView(snapshot.aside, talk);
  const inSnapshot = attempt?.state === 'sent' && (view.running?.id === attempt.id || snapshot.aside.answers.some((a) => a.id === attempt.id));
  const own = attempt && !inSnapshot ? attempt : null;
  const pending = own !== null && own.state !== 'refused';
  const busy = view.running !== null || view.elsewhere !== null || pending;
  const realNow = useRealTime(busy);
  const replayStart = snapshot.mode === 'replay' && snapshot.replay ? snapshot.replay.startedAt : null;
  const demo = snapshot.mode === 'demo';
  const last = view.answers[view.answers.length - 1];
  const lastFailed = !view.running && !own && last?.failure && last.failure.code !== 'cancelled' ? last : null;
  const noTranscript = lastFailed?.failure?.code === 'no-transcript';
  // Asking again needs the question's words: the office's, or this tab's.
  const retry = lastFailed ? shownQuestion(lastFailed, typed).text : null;
  const blocked = blockedReason(talk, { locked, stoppedAt }) ?? (noTranscript && lastFailed?.failure ? failureCopy(lastFailed.failure, talk.who) : null);
  const count = counter(draft, QUESTION_MAX_CHARS);
  const question = cleanQuestion(draft);
  const canAsk = !busy && !blocked && 'question' in question;
  const lines = headerLines(snapshot, talk);

  const submit = (text: string) => {
    if (busy || blocked) return;
    const cleaned = cleanQuestion(text);
    if ('error' in cleaned) return;
    // You just asked: your question comes into view whatever you were reading.
    atEnd.current = true;
    onDraft('');
    onAsk(cleaned.question);
  };

  /** What scrolls the thread: the thread itself, or on short screens, where it keeps its height, the whole conversation. */
  const scroller = () => {
    const el = thread.current;
    return el && el.scrollHeight > el.clientHeight + 1 ? el : root.current;
  };
  /** How far down its scroller the newest exchange starts. */
  const newestTop = (s: HTMLElement) => {
    const last = thread.current?.querySelector<HTMLElement>('.talk__exchange:last-child');
    return last ? last.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop : s.scrollHeight;
  };

  // Opening: the box on a desktop; the heading on a phone, so the keyboard doesn't cover the thread until you tap the box.
  const placeFocus = useEffectEvent(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!opening && !lost) return;
    if (focusOnOpen === 'box' && box.current) {
      box.current.focus({ preventScroll: true });
      reveal(root.current, box.current);
    } else heading.current?.focus({ preventScroll: true });
    if (opening) onOpened();
  });
  // Only when it mounts, or opens for someone else.
  useEffect(() => placeFocus(), [talk.threadKey]);

  // Its size can change after it opens (the label layer fits it to the free area on its first frame, a window
  // resize): on short screens, where it scrolls as one, the box keeps its place in view while it has focus.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (box.current && document.activeElement === box.current) reveal(el, box.current);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The box grows from two rows to five with what is typed.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Number.parseFloat(getComputedStyle(el).lineHeight) * 5 + 16)}px`;
  }, [draft]);

  const contents = `${view.answers.map((a) => a.id).join(',')}|${view.running?.id ?? ''}|${own ? `${own.state}:${own.at}` : ''}`;
  useLayoutEffect(() => {
    const s = scroller();
    if (s && thread.current && contents !== shown.current && atEnd.current) {
      // The newest exchange from its start: your question and the beginning of the answer, rather than its last lines.
      s.scrollTop = Math.min(newestTop(s) - 6, s.scrollHeight - s.clientHeight);
    }
    shown.current = contents;
    // A Cancel or Ask again that had focus and is gone: focus goes to the box.
    if (transient.current && !transient.current.isConnected) {
      transient.current = null;
      (box.current ?? heading.current)?.focus({ preventScroll: true });
    }
  });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  };
  const onBoxKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(draft);
  };
  const onScroll = () => {
    const s = scroller();
    if (s && thread.current) atEnd.current = s.scrollTop + s.clientHeight >= newestTop(s) + 24;
  };
  const remember = (e: FocusEvent<HTMLElement>) => {
    transient.current = e.target instanceof HTMLElement && e.target.dataset.transient ? e.target : null;
  };

  const mine = (text: string) => (
    <li className="talk__line talk__line--mine">
      <div className="talk__said talk__said--mine">
        <span className="visually-hidden">You: </span>
        {text}
      </div>
    </li>
  );
  /** The office's own line: a cancellation as a plain note, a failure in ink with its first sentence in bold. */
  const officeLine = (failure: string | null, again: string | null) => (
    <li className={`talk__office${failure !== null ? ' talk__office--failed' : ''}`}>
      <span className="visually-hidden">The office: </span>
      {failure === null ? (
        'Cancelled.'
      ) : (
        <>
          <strong>{ASK_FAILED}</strong> {failure}
        </>
      )}
      {again !== null && !blocked && (
        <button type="button" className="link talk__again" data-transient="again" aria-disabled={busy || undefined} onClick={() => !busy && onAsk(again)}>
          Ask again
        </button>
      )}
    </li>
  );
  /** Cancel for a running call; once pressed it stays where it is, unavailable, until the call is gone. */
  const cancelButton = (callId: string) => (
    <button
      type="button"
      className="link talk__cancel"
      data-transient="cancel"
      aria-disabled={cancelling === callId || undefined}
      onClick={() => cancelling !== callId && onCancel(callId)}
    >
      Cancel
    </button>
  );
  const pendingLine = (text: string, callId: string | null) => (
    <li className="talk__line talk__line--theirs" style={{ ['--hue' as string]: hue }}>
      <div className={`talk__said talk__said--theirs talk__said--pending${callId !== null && cancelling === callId ? ' is-stopping' : ''}`}>
        <span className="visually-hidden">The office: </span>
        <span className="talk__mark" aria-hidden="true" />
        {callId !== null && cancelling === callId ? CANCELLING : text}
        {callId !== null && cancelButton(callId)}
      </div>
    </li>
  );
  const exchange = (a: AsideAnswer) => (
    <li key={a.id} className="talk__exchange">
      <ol className="talk__lines-list">
        {mine(shownQuestion(a, typed).shown)}
        {a.text !== null ? (
          <li className="talk__line talk__line--theirs" style={{ ['--hue' as string]: hue }}>
            <div className="talk__said talk__said--theirs">
              <span className="visually-hidden">{talk.title}: </span>
              {a.text}
            </div>
            <p className="talk__sign">{signature(a, realNow, replayStart)}</p>
          </li>
        ) : (
          officeLine(a.failure && a.failure.code !== 'cancelled' ? failureCopy(a.failure, talk.who) : null, a === lastFailed && !noTranscript ? shownQuestion(a, typed).text : null)
        )}
      </ol>
    </li>
  );

  return (
    <section
      ref={root}
      className={`talk talk--${variant}`}
      role={variant === 'popover' ? 'dialog' : undefined}
      aria-labelledby={`${id}-title`}
      onKeyDown={onKeyDown}
      onFocus={remember}
      onScroll={onScroll}
    >
      <header className="talk__head">
        {variant === 'sheet' && (
          <button type="button" className="talk__back" onClick={onClose}>
            Back
          </button>
        )}
        <h2 id={`${id}-title`} className="talk__title" tabIndex={-1} ref={heading}>
          Ask {talk.who}
        </h2>
        {variant === 'popover' && (
          <button type="button" className="talk__close" onClick={onClose}>
            Close
          </button>
        )}
        {lines.length > 0 && <p className="talk__about">{lines.join(' ')}</p>}
      </header>

      {(view.answers.length > 0 || view.running || own) && (
      // A tab stop of its own, so the thread can be scrolled from the keyboard (Safari skips unnamed scrollers).
      <div className="talk__thread" ref={thread} onScroll={onScroll} role="region" aria-label={`Conversation with ${talk.who}`} tabIndex={0}>
        <ol className="talk__exchanges">
          {view.answers.map(exchange)}
          {view.running && (
            <li className="talk__exchange">
              <ol className="talk__lines-list">
                {mine(shownQuestion(view.running, typed).shown)}
                {pendingLine(runningLine(view.running, talk.who, realNow, demo), view.running.id)}
              </ol>
            </li>
          )}
          {!view.running && own && (
            <li className="talk__exchange">
              <ol className="talk__lines-list">
                {mine(own.question)}
                {own.state === 'refused'
                  ? officeLine(own.copy, own.question)
                  : pendingLine(runningLine({ kind: 'ask', startedAt: own.at }, talk.who, realNow, demo), own.state === 'sent' ? own.id : null)}
              </ol>
            </li>
          )}
        </ol>
      </div>
      )}

      {view.elsewhere && (
        <p className={`talk__elsewhere${cancelling === view.elsewhere.id ? ' is-stopping' : ''}`}>
          <span className="talk__mark" aria-hidden="true" />
          {cancelling === view.elsewhere.id ? CANCELLING : runningLine(view.elsewhere, runningWho(view.elsewhere, snapshot), realNow, demo)}
          {cancelButton(view.elsewhere.id)}
        </p>
      )}

      {blocked ? (
        <div className="talk__blocked">
          <p>{blocked}</p>
          {noTranscript && retry !== null && !locked && stoppedAt === null && (
            <button type="button" className="button talk__retry" aria-disabled={busy || undefined} onClick={() => !busy && onAsk(retry)}>
              Ask again
            </button>
          )}
        </div>
      ) : (
        <div className="talk__controls">
          <div className="talk__suggestions" role="group" aria-label="Suggested questions">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} type="button" className="talk__suggestion" aria-disabled={busy || undefined} onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
          <label className="talk__label" htmlFor={`${id}-box`}>
            Or ask your own question
          </label>
          <textarea
            id={`${id}-box`}
            ref={box}
            className={`talk__box${count.over ? ' is-over' : ''}`}
            rows={2}
            value={draft}
            aria-describedby={`${id}-note ${id}-count`}
            aria-invalid={count.over || undefined}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onBoxKey}
            onFocus={() => onTyping?.(true)}
            onBlur={() => onTyping?.(false)}
          />
          <div className="talk__foot">
            <p className="talk__hint">
              <span id={`${id}-note`}>Answers come from a read-only copy of the session and never interrupt it.</span>{' '}
              <span id={`${id}-count`} className={`talk__count${count.over ? ' is-over' : ''}`}>
                {count.text}
              </span>
            </p>
            <button type="button" className="button button--primary talk__ask" aria-disabled={!canAsk || undefined} onClick={() => submit(draft)}>
              Ask
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
