// The company's messages as the office shows them: the newest a view carries, and pages of the earlier ones it keeps
// (GET /api/c/<id>/messages, the feed's "Show earlier lines"). The view (src/company/view.ts) and every page take their
// messages through `shownMessages`, so a page never carries what a view wouldn't. Pure, with no Node APIs: the demo
// company pages through its made-up history with it too.
import { type Message, MESSAGE_PAGE, type MessagePage, VIEW_LIMITS } from './company.ts';
import type { Ack } from './steering.ts';
import { acksInView } from './trace-state.ts';

/** What the office says when asked for the messages before one it doesn't keep. */
export const NOT_KEPT = "The office keeps no message with that id, so it can't show what came before it.";

/**
 * Messages `start` up to `end` of the list the company keeps (oldest first), as the office shows them, with the
 * acknowledgements of those messages that a view carries.
 */
export function shownMessages(kept: readonly Message[], acks: readonly Ack[], start: number, end: number): { messages: Message[]; acks: Ack[] } {
  const messages = kept.slice(start, end);
  return { messages, acks: acksInView(acks, messages) };
}

/** The newest VIEW_LIMITS.messages, as a view carries them. */
export const newestMessages = (kept: readonly Message[], acks: readonly Ack[]): { messages: Message[]; acks: Ack[] } =>
  shownMessages(kept, acks, Math.max(0, kept.length - VIEW_LIMITS.messages), kept.length);

/**
 * Up to `limit` of the messages kept before message `before`, newest first, with their acknowledgements and whether
 * older ones remain (MessagePage); null when no message `before` is kept. `limit` is 1 to MESSAGE_PAGE.max, which the
 * hub's route and the demo check before they ask.
 */
export function messagesBefore(kept: readonly Message[], acks: readonly Ack[], before: string, limit: number): MessagePage | null {
  if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGE_PAGE.max) {
    throw new RangeError(`messagesBefore: a page holds 1 to ${MESSAGE_PAGE.max} messages, not ${limit}.`);
  }
  const end = kept.findIndex((m) => m.id === before);
  if (end === -1) return null;
  const start = Math.max(0, end - limit);
  const shown = shownMessages(kept, acks, start, end);
  return { messages: shown.messages.reverse(), acks: shown.acks, more: start > 0 };
}
