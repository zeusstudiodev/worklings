// How the shell reaches the talk bar (docs/design-v3.md, "Stage and dock", "Who hears it"): the shell makes one link per
// company and hands its `control` to every view as `talk`; the talk bar attaches to it when it mounts. A call made
// before then (a deep link to someone's panel on load, an old `send/…` address) waits and runs once the bar is there.
import type { Recipient } from '../../../../src/core/steering.ts';
import type { TalkControl } from '../types.ts';

/** How the feed opens: `catchUp` asks for v2's digest too, as the "Catch me up" command does. */
export interface FeedOpening {
  catchUp?: boolean;
}

/** What the talk bar does for the link: TalkControl's calls, and opening and closing the feed. */
export interface TalkHandler extends TalkControl {
  openFeed(options: FeedOpening): void;
  closeFeed(): void;
}

export interface TalkLink {
  /** For every view: `TabProps.talk`. */
  readonly control: TalkControl;
  /** Opens the feed over the talk bar, as the palette's "Open the feed" does. */
  openFeed(options?: FeedOpening): void;
  /** Closes it without moving focus: the phone's Back over the feed's history entry. */
  closeFeed(): void;
  /** The talk bar attaches when it mounts; the calls made before then run in order. Returns the detach. */
  attach(handler: TalkHandler): () => void;
}

type Call =
  | { kind: 'offer'; to: Recipient }
  | { kind: 'to'; to: Recipient; options: { focus?: boolean; draft?: string } }
  | { kind: 'stop'; person: string }
  | { kind: 'focus' }
  | { kind: 'feed'; open: boolean; options: FeedOpening };

/** Calls kept while no bar is attached: a page load makes one or two; anything more is a loop, not intent. */
const QUEUE_MAX = 8;

function apply(handler: TalkHandler, call: Call): void {
  switch (call.kind) {
    case 'offer':
      handler.offer(call.to);
      return;
    case 'to':
      handler.to(call.to, call.options);
      return;
    case 'stop':
      handler.stop(call.person);
      return;
    case 'focus':
      handler.focus();
      return;
    case 'feed':
      if (call.open) handler.openFeed(call.options);
      else handler.closeFeed();
      return;
  }
}

/** The link each `talk` control belongs to, so the palette can open the feed through the control it is given. */
const links = new WeakMap<TalkControl, TalkLink>();

export function createTalkLink(): TalkLink {
  let handler: TalkHandler | null = null;
  const queue: Call[] = [];
  const send = (call: Call) => {
    if (handler) {
      apply(handler, call);
      return;
    }
    queue.push(call);
    if (queue.length > QUEUE_MAX) queue.shift();
  };
  const control: TalkControl = {
    offer: (to) => send({ kind: 'offer', to }),
    to: (to, options) => send({ kind: 'to', to, options: { ...options } }),
    stop: (person) => send({ kind: 'stop', person }),
    focus: () => send({ kind: 'focus' }),
  };
  const link: TalkLink = {
    control,
    openFeed: (options = {}) => send({ kind: 'feed', open: true, options }),
    closeFeed: () => send({ kind: 'feed', open: false, options: {} }),
    attach(next) {
      handler = next;
      for (const call of queue.splice(0)) apply(next, call);
      return () => {
        if (handler === next) handler = null;
      };
    },
  };
  links.set(control, link);
  return link;
}

/** Opens the feed through a view's `talk`; false where there is no talk bar to open it (an office without one). */
export function openFeedThrough(talk: TalkControl | undefined, options: FeedOpening = {}): boolean {
  const link = talk ? links.get(talk) : undefined;
  if (!link) return false;
  link.openFeed(options);
  return true;
}
