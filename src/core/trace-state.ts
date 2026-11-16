// The trace's own state (SPEC-v3.md "Steering" 3, "See your message land"): each person's acknowledgement of a message
// sent to them, and how each message reached its person. Everything else src/core/trace.ts reads rides on records the
// company keeps anyway, stored by the events that make them: a copy's audience and `for` (a message event), a Remind's
// or an Escalate's `cites` (a message from the office) and the `cites` of tasks, reports and status lines.
// company-state.ts folds these into the company's state. Pure, with no Node APIs, like the rest of src/core.
import type { Message } from './company.ts';
import { type Ack, STEERING_VIEW_LIMITS } from './steering.ts';

/** Caps on acknowledgements and on what a record names, in entries and characters. */
export const TRACE_LIMITS = {
  /** Acknowledgements the state keeps, oldest dropped first. */
  acks: 2_000,
  /** An acknowledgement is one sentence. */
  ackText: 300,
  /** Messages one report, status line, task or follow-up cites. */
  cites: 10,
  /** People the stakeholder names one message for. */
  for: 50,
} as const;

/** How a message reached its person: joining the turn under way at its next step, or opening a turn of its own. */
export const DELIVERED_HOW = ['next-step', 'new-turn'] as const;
export type DeliveredHow = (typeof DELIVERED_HOW)[number];
export const isDeliveredHow = (v: unknown): v is DeliveredHow => DELIVERED_HOW.some((how) => how === v);

/** The events the trace adds to the company's log. */
export type TraceEvent = { type: 'ack'; ack: Ack };
export const TRACE_EVENT_TYPES: readonly TraceEvent['type'][] = ['ack'];

export interface TraceState {
  /** Oldest first, and one per message: only its recipient acknowledges it, and a second acknowledgement replaces the first. */
  acks: Ack[];
}

/**
 * The id of the acknowledgement of a message: "k-12" for "m-12". Only a message's own recipient acknowledges it, so it
 * has one at most, and acknowledging it again keeps the id.
 */
export function ackIdFor(message: string): string {
  const n = /^m-(\d{1,12})$/.exec(message)?.[1];
  return n === undefined ? `k-${message}` : `k-${n}`;
}

/** The acknowledgements with one more: it replaces any earlier one by the same person of the same message. */
export function withAck(acks: readonly Ack[], ack: Ack): Ack[] {
  const next = [...acks.filter((a) => a.message !== ack.message || a.by !== ack.by), ack];
  return next.length > TRACE_LIMITS.acks ? next.slice(next.length - TRACE_LIMITS.acks) : next;
}

/** Folds one of the trace's events into a state that carries it. Pure: the state passed in is never changed. */
export function foldTrace<S extends TraceState>(state: S, event: TraceEvent): S {
  switch (event.type) {
    case 'ack':
      return { ...state, acks: withAck(state.acks, event.ack) };
    default:
      return state;
  }
}

/**
 * The messages once one has reached its person: when, and how when the desk said so. The first delivery stands, so a
 * repeated report changes nothing; anything but 'next-step' or 'new-turn' leaves `deliveredHow` out, as a desk that
 * doesn't say does.
 */
export function withDelivery(messages: readonly Message[], id: string, at: number, how?: unknown): Message[] {
  return messages.map((m) => (m.id === id && m.deliveredAt === null ? { ...m, deliveredAt: at, ...(isDeliveredHow(how) ? { deliveredHow: how } : {}) } : m));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The acknowledgements from company.json, oldest first. The store checked the file's MAC, so this keeps the entries
 * shaped like one and drops the rest; a state written before acknowledgements existed has none.
 */
export function reviveAcks(raw: unknown): Ack[] {
  if (!Array.isArray(raw)) return [];
  const acks = raw.flatMap((a: unknown): Ack[] =>
    isObj(a) &&
    typeof a.id === 'string' &&
    typeof a.message === 'string' &&
    typeof a.by === 'string' &&
    typeof a.agree === 'boolean' &&
    typeof a.text === 'string' &&
    typeof a.at === 'number' &&
    Number.isFinite(a.at)
      ? [{ id: a.id, message: a.message, by: a.by, agree: a.agree, text: a.text, at: a.at }]
      : [],
  );
  return acks.length > TRACE_LIMITS.acks ? acks.slice(acks.length - TRACE_LIMITS.acks) : acks;
}

/**
 * The acknowledgements a view carries (`SteeringView.acks`): those of the messages the view holds, since a trace works
 * from those alone, and at most STEERING_VIEW_LIMITS.acks of them, newest kept, oldest first.
 */
export function acksInView(acks: readonly Ack[], messages: readonly Pick<Message, 'id'>[]): Ack[] {
  const shown = new Set(messages.map((m) => m.id));
  const kept = acks.filter((a) => shown.has(a.message));
  return kept.slice(Math.max(0, kept.length - STEERING_VIEW_LIMITS.acks));
}
