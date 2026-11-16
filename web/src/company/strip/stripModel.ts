// The live strip (docs/design-v3.md, "The live strip"): the feed's newest lines above the talk bar, three on the office
// and one on a board or a phone, each cut to one line with its age; nothing pins, a newer line shows at once (a short anti-flicker only), bursts
// fold as the feed folds them, and after five quiet minutes the lines fade (not on phones). Pure, so it can be tested.
import { type CompanyView, STAKEHOLDER } from '../../../../src/core/company.ts';
import { type FeedLine, foldBursts } from '../feed/feedModel.ts';

/** How many lines the strip shows. */
export const STRIP_SHOWN = { office: 3, board: 1, phone: 1 } as const;
/** With nothing new for this long the lines fade away, so a quiet office is clean. */
export const QUIET_MS = 5 * 60_000;
/** A line stays at least this long so a burst doesn't flicker; well under the second a relay is promised to show in. */
export const HOLD_MS = 250;

/** The strip's lines: the newest of the feed's, bursts folded, oldest first so the newest sits nearest the bar. */
export function stripLines(lines: readonly FeedLine[], count: number): FeedLine[] {
  return foldBursts(lines).slice(-count);
}

/** The lines the strip draws from: with the inbox open beside the office, what needs you is listed there once, so not here. */
export const stripFeedLines = (lines: readonly FeedLine[], inboxBeside: boolean): readonly FeedLine[] => (inboxBeside ? lines.filter((l) => l.tone !== 'needs') : lines);

/** A line's age on the right: "just now", "2 min", "3 h", "2 d". */
export function ageOf(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/** Nothing new for five minutes: the strip fades away (phones keep their line). */
export const isQuiet = (lines: readonly FeedLine[], now: number): boolean => {
  const newest = lines.at(-1);
  return newest === undefined || now - newest.at >= QUIET_MS;
};

/**
 * Which lines show now, so each stays a moment (HOLD_MS): a change within it waits, then the newest show
 * and the ones between are skipped. `shownAt` is when the lines on screen came; returns the lines to show and, when they
 * have to wait, when to look again.
 */
export function heldLines(onScreen: readonly FeedLine[], shownAt: number, newest: readonly FeedLine[], now: number): { lines: readonly FeedLine[]; wait: number | null } {
  const same = onScreen.length === newest.length && onScreen.every((l, i) => l.id === newest[i]?.id && l.words === newest[i]?.words);
  if (same) return { lines: onScreen, wait: null };
  if (onScreen.length === 0 || now - shownAt >= HOLD_MS) return { lines: newest, wait: null };
  return { lines: onScreen, wait: shownAt + HOLD_MS };
}

/** New replies to you and disagreements with your messages since you last looked (and not seen in their thread). */
export function newReplies(lines: readonly FeedLine[], since: number, seen: CompanyView['seen']): number {
  return lines.filter((l) => {
    if (l.at <= since) return false;
    if (l.kind === 'disagree') return true;
    if (l.kind !== 'reply') return false;
    const looked = Object.hasOwn(seen, l.from) ? (seen[l.from] ?? 0) : 0;
    return l.at > looked;
  }).length;
}

/** Anything new from anyone but you since you last looked: Feed's dot when no reply is. */
export const anythingNew = (lines: readonly FeedLine[], since: number): boolean => lines.some((l) => l.at > since && l.from !== STAKEHOLDER);

/** "2 new replies", "1 new reply". */
const repliesWords = (n: number): string => `${n} new ${n === 1 ? 'reply' : 'replies'}`;

/** The strip's button: "Open the feed", "Open the feed, 2 new replies". */
export const stripName = (replies: number): string => (replies > 0 ? `Open the feed, ${repliesWords(replies)}` : 'Open the feed');

/** The Feed key: "Feed", "Feed, 2 new replies", "Feed, new lines"; "Close the feed" while it is open. */
export function feedKeyName(open: boolean, replies: number, fresh: boolean): string {
  if (open) return 'Close the feed';
  if (replies > 0) return `Feed, ${repliesWords(replies)}`;
  return fresh ? 'Feed, new lines' : 'Feed';
}
