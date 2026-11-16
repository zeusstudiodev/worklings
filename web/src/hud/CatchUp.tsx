// Catch me up, under the headline on Now (docs/design.md, "Catch me up"): on request, Haiku writes a few sentences on
// what happened since you last caught up, through your own Claude Code. Its state comes with each snapshot, so every
// browser tab shows the same; only what the office answered this tab's own press is kept here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { ApiError, catchUp } from '../lib/api.ts';
import { useWallClock } from '../lib/hooks.ts';
import { CANCELLING, refusalCopy } from './asideModel.ts';
import { CATCH_UP_FAILED, type CatchUpContext, catchUpView, type DigestText, nothingNewLine } from './catchUpModel.ts';

/** A request the office turned down, or that never reached it (status 0), as the failure copy reads it. */
const refusalOf = (error: unknown) =>
  error instanceof ApiError ? { status: error.status, code: error.code, message: error.message, retryAfter: error.retryAfter } : { status: 0, code: null, message: '', retryAfter: null };

/** How long the office's own "nothing new" stays before the next snapshot's word on it takes over. */
const NOTHING_NEW_SHOWN_MS = 4000;

/**
 * A digest's sentences and how it is signed. Phones clamp the sentences to three lines to keep the half sheet for the
 * rows; "Read all of it", on the signature's line, opens the rest in place, and focus moves onto the text rather than
 * dropping when the link goes.
 */
function Sentences({ text, signature }: { text: string; signature: string }) {
  const body = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = body.current;
    if (!el || open) return;
    // Only narrow screens clamp: measure whether this one does, now and whenever the width changes.
    const observer = new ResizeObserver(() => setClamped(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, text]);
  return (
    <>
      <p ref={body} className={`catch-up__text${open ? ' is-open' : ''}`} tabIndex={open ? -1 : undefined}>
        {text}
      </p>
      <div className="catch-up__foot">
        <p className="catch-up__signature">{signature}</p>
        {clamped && !open && (
          <button
            type="button"
            className="link catch-up__more"
            onClick={() => {
              flushSync(() => setOpen(true));
              body.current?.focus({ preventScroll: true });
            }}
          >
            Read all of it
          </button>
        )}
      </div>
    </>
  );
}

function Written({ digest, level }: { digest: DigestText; level: 3 | 4 }) {
  const Heading = level === 3 ? 'h3' : 'h4';
  return (
    <div className="catch-up__digest">
      <Heading className="catch-up__heading">{digest.heading}</Heading>
      <Sentences text={digest.text} signature={digest.signature} />
    </div>
  );
}

interface Props {
  snapshot: Snapshot;
  token: string | null;
  connected: boolean;
  /** The office's live region: what the office answers a press is said there, since focus stays on the button. */
  announce: (text: string) => void;
  /**
   * The call this tab is cancelling, from here or from a conversation: the office runs one call at a time, and both
   * show it, so both show it stopping.
   */
  cancelling: string | null;
  /** Cancels the running call; a cancel the office turns down is said the way the conversation's is. */
  onCancel: (id: string) => void;
}

export function CatchUp({ snapshot, token, connected, announce, cancelling, onCancel }: Props) {
  const realNow = useWallClock(snapshot.aside.running ? 1000 : 15_000);
  const [sending, setSending] = useState(false);
  // The office's answer to this tab's last press, with the newest digest at the time: another catch-up makes it stale.
  const [reply, setReply] = useState<{ value: NonNullable<CatchUpContext['reply']>; newest: string | null } | null>(null);
  const newest = snapshot.aside.digests[0]?.id ?? null;
  const view = catchUpView(snapshot, { locked: token === null, connected, sending, reply: reply && reply.newest === newest ? reply.value : null, realNow });

  useEffect(() => {
    if (reply?.value.kind !== 'nothing-new') return;
    const id = window.setTimeout(() => setReply(null), NOTHING_NEW_SHOWN_MS);
    return () => window.clearTimeout(id);
  }, [reply]);

  // Focus stays on the button while a call runs. Cancel goes away when it ends: if it had focus, the button gets it back.
  const button = useRef<HTMLButtonElement>(null);
  const cancelFocused = useRef(false);
  const runningId = view.running?.id ?? null;
  useLayoutEffect(() => {
    if (runningId !== null || !cancelFocused.current) return;
    cancelFocused.current = false;
    button.current?.focus();
  }, [runningId]);

  // Cancel pressed: stopping Claude Code takes a second or two, and the line says so at once.
  const call = view.running;
  const stopping = call !== null && cancelling === call.id;
  const line = stopping ? CANCELLING : view.line;

  // One request at a time, even when a double click lands before the next render.
  const pressing = useRef(false);
  const press = async () => {
    if (pressing.current || sending) return;
    // Unavailable, it still answers a press: the line under it says why, and a screen reader hears it then.
    if (view.unavailable) {
      announce(line);
      return;
    }
    pressing.current = true;
    setSending(true);
    setReply(null);
    try {
      const result = await catchUp(token);
      if ('source' in result) {
        setReply({ value: { kind: 'nothing-new', since: result.since }, newest });
        const lastWritten = snapshot.aside.digests.find((d) => d.text !== null);
        announce(nothingNewLine(result.since, lastWritten, snapshot.mode === 'replay' ? snapshot.replay : null));
      }
    } catch (error) {
      const refused = `${CATCH_UP_FAILED} ${refusalCopy(refusalOf(error))}`;
      setReply({ value: { kind: 'refused', line: refused }, newest });
      announce(refused);
    } finally {
      pressing.current = false;
      setSending(false);
    }
  };

  const earlier = view.earlier.length;
  return (
    <div className="catch-up">
      <button ref={button} type="button" className="button catch-up__button" aria-disabled={view.unavailable || undefined} aria-describedby="catch-up-line" onClick={() => void press()}>
        Catch me up
      </button>
      {/* The line describes the button; Cancel has its own line under it, outside the description. */}
      <div className={`catch-up__status${stopping ? ' is-stopping' : ''}`}>
        <p id="catch-up-line" className={`catch-up__line${view.failed ? ' catch-up__line--failed' : ''}`}>
          {call && <span className="catch-up__mark" aria-hidden="true" />}
          {line}
        </p>
        {call && (
          // Once pressed, Cancel stays where it is, unavailable, until the call is gone; a press then says why.
          <button
            type="button"
            className="link catch-up__cancel"
            aria-label={call.cancelLabel}
            aria-disabled={stopping || undefined}
            onFocus={() => {
              cancelFocused.current = true;
            }}
            onBlur={(e) => {
              // Taken out of the page as the call ends: that isn't the person moving on.
              if (e.target.isConnected) cancelFocused.current = false;
            }}
            onClick={() => (stopping ? announce(CANCELLING) : onCancel(call.id))}
          >
            Cancel
          </button>
        )}
      </div>
      {view.latest && <Written key={view.latest.id} digest={view.latest} level={3} />}
      {earlier > 0 && (
        <details className="catch-up__earlier">
          <summary>{earlier} earlier {earlier === 1 ? 'catch-up' : 'catch-ups'}</summary>
          {view.earlier.map((d) => <Written key={d.id} digest={d} level={4} />)}
        </details>
      )}
    </div>
  );
}
