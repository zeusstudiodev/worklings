// What a desk's failures mean, in sentences the office shows: a turn that ended with an error, a desk that exited on
// its own, and the usage limits and overloads that make the company rest. Claude Code's own words are untrusted: only
// one cleaned line of them is ever quoted. No Node APIs.
import { oneLine } from '../core/events.ts';
import { redactSecrets } from '../core/redact.ts';
import type { LimitInfo, TurnEnd } from './protocol.ts';

/** An overload gives no reset time: the company rests this long, once, instead of retrying in a loop. */
export const OVERLOAD_REST_MS = 5 * 60_000;

export type FailureKind = 'limit' | 'overloaded' | 'not-signed-in' | 'too-long' | 'interrupted' | 'budget' | 'max-turns' | 'other';

export interface Failure {
  kind: FailureKind;
  /** Why the turn failed, in a sentence. */
  problem: string;
  /** For a limit or an overload: when work may start again; null when Claude Code didn't say. */
  until: number | null;
  /** For a limit or an overload: what the company is told (`DeskEvents.limited`). */
  message: string | null;
}

/** One line of Claude Code's own text, masked, without control characters or the "·" it separates parts with. */
export function quoted(text: string, max = 160): string {
  const plain = text.replace(/\p{Cc}\[[\d;?]*[A-Za-z]/gu, '');
  for (const line of plain.split(/\r?\n/)) {
    const clean = oneLine(redactSecrets(line.replace(/\p{Cc}/gu, ' ')).replace(/\s*·\s*/g, ', '), max);
    if (clean) return clean;
  }
  return '';
}

const twoDigits = (n: number) => String(n).padStart(2, '0');
/** 14:05 in the office's local time. */
export const clockTime = (at: number): string => {
  const d = new Date(at);
  return `${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}`;
};

/** The offset of a time zone from UTC at a moment, in milliseconds; null for a zone the platform doesn't know. */
function zoneOffset(zone: string, at: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(at);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
    const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    return Number.isFinite(wall) ? wall - Math.floor(at / 1000) * 1000 : null;
  } catch {
    return null; // not a time zone this platform knows: read the time as local
  }
}

/** The next moment after `now` whose wall-clock time is hour:minute, in `zone` or else in local time. */
function nextWallTime(hour: number, minute: number, zone: string | null, now: number): number {
  const offset = zone ? zoneOffset(zone, now) : null;
  if (offset === null) {
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // The zone's calendar day at `now`, then that day's hour:minute back in UTC, a day later when it has passed.
  const wallNow = new Date(now + offset);
  let candidate = Date.UTC(wallNow.getUTCFullYear(), wallNow.getUTCMonth(), wallNow.getUTCDate(), hour, minute) - offset;
  if (candidate <= now) candidate += 24 * 60 * 60_000;
  // Across a daylight-saving change the offset differs at the reset itself.
  const later = zone ? zoneOffset(zone, candidate) : null;
  return later !== null && later !== offset ? candidate + offset - later : candidate;
}

/**
 * When a limit resets, from Claude Code's words: "resets 3:45pm", "resets at 15:00 (Europe/Zurich)", "resets in 2
 * hours". Null when the text gives no time it can read.
 */
export function resetFromText(text: string, now: number): number | null {
  const relative = /\bresets?\s+in\s+(\d{1,3})\s*(minute|min|hour|hr)s?\b/i.exec(text);
  if (relative) {
    const n = Number(relative[1]);
    return now + n * (/^h/i.test(relative[2] ?? '') ? 60 : 1) * 60_000;
  }
  const at = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([A-Za-z_+\-/0-9]{1,64})\))?/i.exec(text);
  if (!at) return null;
  let hour = Number(at[1]);
  const minute = Number(at[2] ?? 0);
  const half = at[3]?.toLowerCase();
  if (minute > 59 || hour > 23 || (half && (hour < 1 || hour > 12))) return null;
  if (half === 'pm' && hour < 12) hour += 12;
  if (half === 'am' && hour === 12) hour = 0;
  return nextWallTime(hour, minute, at[4] ?? null, now);
}

const NOT_SIGNED_IN = /not logged in|please run \/login|invalid api key|oauth token|authentication[_ ]error/i;
const USAGE_LIMIT = /usage[ _]limit|session limit|weekly limit|hit your limit|rate[ _]limit|credit balance|out of (?:usage|credits)/i;
const OVERLOADED = /overloaded/i;
const TOO_LONG = /prompt is too long|context window|context length|too many tokens/i;

const LIMIT_NAMES: Record<string, string> = {
  five_hour: "plan's five-hour limit",
  seven_day: "plan's weekly limit",
  seven_day_opus: "plan's weekly Opus limit",
  seven_day_sonnet: "plan's weekly Sonnet limit",
};
const limitName = (type: string | null) => (type && Object.hasOwn(LIMIT_NAMES, type) ? LIMIT_NAMES[type] : null) ?? "plan's usage limit";

/** A rate_limit_event that says the plan is used up: the company rests until it resets. */
export function limitFromEvent(info: LimitInfo, now: number): Failure | null {
  if (info.status !== 'rejected') return null;
  const until = info.resetsAt !== null && info.resetsAt > now ? info.resetsAt : null;
  const name = limitName(info.type);
  return {
    kind: 'limit',
    until,
    problem: until === null ? `Claude Code reached the ${name}.` : `Claude Code reached the ${name}, which resets at ${clockTime(until)}.`,
    message: `Claude Code reports the ${name} is used up.`,
  };
}

/**
 * Why a turn failed, from its result. `interrupted` says the switchboard stopped it (Stop, or a desk that stopped
 * responding); `limit` is the latest rate_limit_event, whose reset time beats the one in the text.
 */
export function turnFailure(end: TurnEnd, o: { interrupted: boolean; now: number; limit: LimitInfo | null }): Failure {
  const words = end.errorText;
  const status = end.apiStatus;
  const line = quoted(words);
  if (o.interrupted && (end.terminalReason === 'aborted_tools' || end.subtype === 'error_during_execution' || end.terminalReason === 'interrupted')) {
    return { kind: 'interrupted', problem: 'Stopped before the turn finished.', until: null, message: null };
  }
  if (status === 401 || NOT_SIGNED_IN.test(words)) {
    return { kind: 'not-signed-in', problem: "Claude Code isn't signed in. Run claude in a terminal and sign in, then send them a message to carry on.", until: null, message: null };
  }
  if (status === 529 || (OVERLOADED.test(words) && !USAGE_LIMIT.test(words))) {
    const until = o.now + OVERLOAD_REST_MS;
    return { kind: 'overloaded', problem: `Claude was overloaded, so the turn stopped; work rests until ${clockTime(until)}.`, until, message: 'Claude is overloaded right now.' };
  }
  if (status === 429 || USAGE_LIMIT.test(words)) {
    const fromEvent = o.limit && o.limit.status === 'rejected' && o.limit.resetsAt !== null && o.limit.resetsAt > o.now ? o.limit.resetsAt : null;
    const until = fromEvent ?? resetFromText(words, o.now);
    return {
      kind: 'limit',
      until,
      problem: until === null ? 'Claude Code hit a usage limit, so the turn stopped.' : `Claude Code hit a usage limit, so the turn stopped; it resets at ${clockTime(until)}.`,
      message: line ? `Claude Code hit a usage limit: ${line}` : 'Claude Code hit a usage limit.',
    };
  }
  if (status === 413 || TOO_LONG.test(words)) {
    return { kind: 'too-long', problem: 'Their conversation is too long for the model, so the turn stopped.', until: null, message: null };
  }
  if (end.subtype === 'error_max_budget_usd') return { kind: 'budget', problem: 'The turn reached its spending cap and stopped.', until: null, message: null };
  if (end.subtype === 'error_max_turns') return { kind: 'max-turns', problem: 'The turn ran out of steps before it finished.', until: null, message: null };
  return { kind: 'other', problem: line ? `The turn failed: ${line}` : "The turn failed and Claude Code didn't say why.", until: null, message: null };
}

/** Why a desk exited on its own, from its exit and the tail of its standard error. */
export function exitProblem(code: number | null, signal: string | null, stderr: string): string {
  if (NOT_SIGNED_IN.test(stderr)) return "Claude Code isn't signed in. Run claude in a terminal and sign in, then send them a message to carry on.";
  const how = code === null ? `unexpectedly (${signal ?? 'no exit code'})` : `unexpectedly (exit code ${code})`;
  // The last words are the error (earlier lines are often the person's own hooks talking), past any stack frames.
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim() !== '' && !/^\s+at\s/.test(l));
  const line = quoted(lines.at(-1) ?? '');
  return line ? `Claude Code stopped ${how}: ${line}` : `Claude Code stopped ${how} and didn't say why.`;
}

/** A resumed session Claude Code can't find, so the desk starts a new one instead. */
export const isMissingSession = (stderr: string): boolean => /no conversation found|session .{0,80}not found|could not find session/i.test(stderr);
