// Catch me up as the Now tab shows it (docs/design.md, "Catch me up"): the line under the button, the digests and when
// the button can be pressed. Pure, so it can be tested; the failure and running lines are Ask aside's (asideModel.ts).
import type { AsideView, Digest } from '../../../src/core/aside.ts';
import { coarseAge, plainText } from '../../../src/core/now.ts';
import type { ReplayInfo, Snapshot } from '../../../src/core/snapshot.ts';
import { aboutCost, duration, hourMinute, spent } from '../lib/format.ts';
import { failureCopy, LOCKED, runningLine, runningWho } from './asideModel.ts';

export const CATCH_UP_FAILED = "Couldn't write your catch-up.";

/** A moment of the period a catch-up covers: a time of day, or in a replay how far into it ("3m 20s"). */
const point = (time: number, replay: ReplayInfo | null) => (replay ? duration(Math.max(0, time - replay.startedAt)) : hourMinute(time));
/** A replay's first catch-up starts just before its first event. */
const fromStart = (since: number, replay: ReplayInfo) => since <= replay.startedAt;

/** What the next catch-up covers: "Covers 13:32 to now.", "Covers the replay from the start to 3m 20s." */
export function coversLine(since: number, replay: ReplayInfo | null): string {
  if (!replay) return `Covers ${hourMinute(since)} to now.`;
  const to = point(replay.position, replay);
  return fromStart(since, replay) ? `Covers the replay from the start to ${to}.` : `Covers the replay from ${point(since, replay)} to ${to}.`;
}

export function digestHeading(digest: Digest, replay: ReplayInfo | null): string {
  if (digest.source === 'sample') return 'Sample catch-up';
  if (!replay) {
    const [from, to] = [hourMinute(digest.since), hourMinute(digest.until)];
    // Both ends in the same minute would read "from 10:00 to 10:00".
    return from === to ? `Your catch-up from ${from}` : `Your catch-up from ${from} to ${to}`;
  }
  const until = point(digest.until, replay);
  return fromStart(digest.since, replay) ? `Your catch-up on the replay up to ${until}` : `Your catch-up on the replay from ${point(digest.since, replay)} to ${until}`;
}

/**
 * "Written 12 min ago for 0.4¢ on Haiku.", or how a demo sample is signed. `at` is real time, also in a replay. A cost
 * the office only estimated says so, so it never passes for one Claude Code reported.
 */
export function digestSignature(digest: Digest, realNow: number): string {
  if (digest.source === 'sample') return 'Made up for the demo. No call to Claude Code.';
  const cost = digest.cost > 0 ? (digest.estimated ? ` for about ${spent(digest.cost)}` : ` for ${spent(digest.cost)}`) : '';
  return `Written ${coarseAge(realNow - digest.at)}${cost} on Haiku${digest.estimated && digest.cost > 0 ? ', by its estimate' : ''}.`;
}

/** What a stopped catch-up still costs the office: Claude Code reports nothing, so it counts at its estimate. */
const chargedAtEstimate = (digest: Digest) => (digest.estimated && digest.cost > 0 ? ` The office counts it at its estimate, about ${spent(digest.cost)}.` : '');

/** Nothing to catch up on: since the last catch-up when that is where the period starts, else in the last hour. */
export function nothingNewLine(since: number, lastWritten: Digest | undefined, replay: ReplayInfo | null): string {
  const sinceLast = lastWritten !== undefined && lastWritten.until === since;
  if (!replay) return sinceLast ? `Nothing new since your last catch-up at ${hourMinute(since)}.` : 'Nothing happened in the last hour.';
  return sinceLast ? `Nothing new since your last catch-up at ${point(since, replay)} into the replay.` : 'Nothing happened in the last hour of the replay.';
}

export interface DigestText {
  id: string;
  heading: string;
  text: string;
  signature: string;
}

export interface CatchUpView {
  /** The button can't be pressed now (it stays focusable, and the line says why). */
  unavailable: boolean;
  /** The one line under the button. */
  line: string;
  /** The line says why the last press or catch-up failed (a cancel isn't a failure). */
  failed: boolean;
  /** While a catch-up or a question runs: the line carries the yellow mark and a Cancel for that call. */
  running: { id: string; cancelLabel: string } | null;
  /** The newest digest written, then the ones before it (at most two), newest first. */
  latest: DigestText | null;
  earlier: DigestText[];
}

export interface CatchUpContext {
  /** No access token: a demo opened without its link. */
  locked: boolean;
  connected: boolean;
  /** The request is on its way. */
  sending: boolean;
  /** What the office answered the last press, while it still applies: nothing new, or why it turned it down. */
  reply: { kind: 'nothing-new'; since: number } | { kind: 'refused'; line: string } | null;
  /** Real time, for "12s so far" and "Written 2 min ago". */
  realNow: number;
}

export function catchUpView(snapshot: Pick<Snapshot, 'mode' | 'replay' | 'agents'> & { aside: AsideView }, ctx: CatchUpContext): CatchUpView {
  const { aside } = snapshot;
  const replay = snapshot.mode === 'replay' ? snapshot.replay : null;
  const written = aside.digests.filter((d): d is Digest & { text: string } => d.text !== null);
  // A failed catch-up stays on top until the next one starts.
  const top = aside.digests[0];
  const failed = top?.failure ?? null;
  const running = aside.running;
  const nothingNew = aside.catchUp.nothingNew || ctx.reply?.kind === 'nothing-new';

  // The line shows a failure only when nothing above it in this order takes its place.
  const shown = !ctx.locked && ctx.connected && !running;
  let line: string;
  if (ctx.locked) line = LOCKED;
  else if (!ctx.connected) line = 'Catch me up waits until the office reconnects.';
  else if (running) line = runningLine(running, runningWho(running, snapshot), ctx.realNow, snapshot.mode === 'demo');
  else if (ctx.reply?.kind === 'refused') line = ctx.reply.line;
  else if (failed && top) line = `${failed.code === 'cancelled' ? 'Cancelled.' : `${CATCH_UP_FAILED} ${failureCopy(failed, 'the studio')}`}${chargedAtEstimate(top)}`;
  else if (nothingNew) line = nothingNewLine(ctx.reply?.kind === 'nothing-new' ? ctx.reply.since : aside.catchUp.since, written[0], replay);
  else if (snapshot.mode === 'demo') line = "The demo makes up its catch-ups, so they're free.";
  else line = aside.catchUp.estimate ? `${coversLine(aside.catchUp.since, replay)} ${aboutCost(aside.catchUp.estimate.cost)} on Haiku.` : coversLine(aside.catchUp.since, replay);

  const text = (d: Digest & { text: string }): DigestText => ({ id: d.id, heading: digestHeading(d, replay), text: plainText(d.text), signature: digestSignature(d, ctx.realNow) });
  const [latest, ...earlier] = written.map(text);
  return {
    unavailable: ctx.locked || !ctx.connected || ctx.sending || running !== null || nothingNew,
    line,
    failed: shown && (ctx.reply?.kind === 'refused' || (failed !== null && failed.code !== 'cancelled')),
    running: running && ctx.connected && !ctx.locked ? { id: running.id, cancelLabel: running.kind === 'ask' ? 'Cancel the question' : 'Cancel the catch-up' } : null,
    latest: latest ?? null,
    earlier: earlier.slice(0, 2),
  };
}
