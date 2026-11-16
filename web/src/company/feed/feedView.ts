// What the feed does with its lines (docs/design-v3.md, "The feed"): filters by who and kind, threads and the rail,
// shared headers, the New rule, the dot on a reply until it is seen, and the earlier pages merged into the view. All
// pure, so each can be tested; Feed.tsx only draws them.
import { type CompanyView, type Message, type MessagePage, STAKEHOLDER } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import type { Ack } from '../../../../src/core/steering.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { roomName } from '../people/peopleModel.ts';
import { tracePath } from '../trace/traceModel.ts';
import { dayOf, type FeedLine, type LineKind } from './feedModel.ts';

// ---------------------------------------------------------------------------------------------------------------
// Filters

export const KINDS = ['all', 'yours', 'passed', 'needs', 'work', 'decisions', 'company', 'between'] as const;
export type KindFilter = (typeof KINDS)[number];

export const KIND_LABELS: Record<KindFilter, string> = {
  all: 'Everything',
  yours: 'Your messages and replies',
  passed: 'Passed on',
  needs: 'Needs you',
  work: 'Work',
  decisions: 'Decisions',
  company: 'Company',
  between: 'Between people',
};

const KIND_OF: Record<Exclude<LineKind, 'burst'>, Exclude<KindFilter, 'all'>> = {
  yours: 'yours',
  reply: 'yours',
  passed: 'passed',
  ack: 'passed',
  disagree: 'passed',
  stall: 'passed',
  asks: 'needs',
  approval: 'needs',
  plan: 'needs',
  stuck: 'work',
  report: 'work',
  assigned: 'work',
  decision: 'decisions',
  company: 'company',
  between: 'between',
};

/** Which of the Kind filter's entries a line is under (a burst of acknowledgements is "Passed on"). */
export const kindGroup = (kind: LineKind): Exclude<KindFilter, 'all'> => (kind === 'burst' ? 'passed' : KIND_OF[kind]);

/** `who` is "all", "room:<id>" or "person:<id>". */
export interface FeedFilter {
  who: string;
  kind: KindFilter;
}

export const NO_FILTER: FeedFilter = { who: 'all', kind: 'all' };
export const isFiltered = (f: FeedFilter): boolean => f.who !== 'all' || f.kind !== 'all';

/** A filter read back from storage: anything that isn't one is no filter. */
export function parseFilter(raw: unknown): FeedFilter {
  if (typeof raw !== 'object' || raw === null) return NO_FILTER;
  const { who, kind } = raw as Record<string, unknown>;
  return {
    who: typeof who === 'string' && (who === 'all' || /^(room|person):.{1,200}$/.test(who)) ? who : 'all',
    kind: typeof kind === 'string' && (KINDS as readonly string[]).includes(kind) ? (kind as KindFilter) : 'all',
  };
}

export interface WhoOptions {
  rooms: { value: string; label: string }[];
  /** The people, by room, in the company's order. */
  people: { room: string; people: { value: string; label: string }[] }[];
}

export function whoOptions(snapshot: Pick<Snapshot, 'studio'>, company: Pick<CompanyView, 'people'>): WhoOptions {
  const order: string[] = [];
  for (const p of company.people) if (!order.includes(p.room)) order.push(p.room);
  return {
    rooms: order.map((room) => ({ value: `room:${room}`, label: roomName(snapshot, room) })),
    people: order.map((room) => ({
      room: roomName(snapshot, room),
      people: company.people.filter((p) => p.room === room).map((p) => ({ value: `person:${p.id}`, label: personLabel(p) })),
    })),
  };
}

/** Who a filter names, as a sentence says it: "Kai", "the design room"; null for everyone or someone who left. */
export function whoCalled(snapshot: Pick<Snapshot, 'studio'>, company: Pick<CompanyView, 'people'>, who: string): string | null {
  if (who.startsWith('room:')) return `the ${roomName(snapshot, who.slice(5)).toLowerCase()} room`;
  if (who.startsWith('person:')) {
    const id = who.slice(7);
    return company.people.find((p) => p.id === id)?.name ?? null;
  }
  return null;
}

const involves = (line: FeedLine, ids: ReadonlySet<string>): boolean => ids.has(line.from) || (line.to !== null && ids.has(line.to)) || (line.who ?? []).some((w) => ids.has(w));

/** The lines the filter lets through. A room matches anyone in it, as the speaker or the one spoken to. */
export function filterLines(lines: readonly FeedLine[], filter: FeedFilter, company: Pick<CompanyView, 'people'>): FeedLine[] {
  if (!isFiltered(filter)) return [...lines];
  const ids = new Set<string>();
  if (filter.who.startsWith('person:')) ids.add(filter.who.slice(7));
  else if (filter.who.startsWith('room:')) for (const p of company.people) if (p.room === filter.who.slice(5)) ids.add(p.id);
  return lines.filter((l) => (filter.kind === 'all' || kindGroup(l.kind) === filter.kind) && (filter.who === 'all' || involves(l, ids)));
}

/** "Showing lines with Kai.", "Nothing with Kai yet.": said once by the filters. Null with no filter. */
export function filterSentence(filter: FeedFilter, who: string | null, shown: number): string | null {
  if (!isFiltered(filter)) return null;
  const kind = KIND_LABELS[filter.kind].toLowerCase();
  const withWho = who !== null && filter.who !== 'all' ? who : null;
  const subject = filter.kind === 'all' ? 'lines' : kind;
  if (shown === 0) return withWho ? `Nothing ${filter.kind === 'all' ? '' : `in ${kind} `}with ${withWho} yet.`.replace(/\s+/g, ' ') : `Nothing in ${kind} yet.`;
  return withWho ? `Showing ${subject} with ${withWho}.` : `Showing ${subject}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Threads, shared headers and the day

/** Lines of one speaker and kind within this long share a header. */
export const HEADER_MS = 2 * 60_000;
/** Kinds that have a speaker's header worth sharing. */
const JOINS = new Set<LineKind>(['yours', 'reply', 'between', 'report', 'ack', 'disagree', 'passed']);

export interface FeedRow {
  line: FeedLine;
  /** Hangs on a thread's rail: it follows its message, or another line of the thread, with nothing between. */
  rail: boolean;
  /** Comes after other lines: "On your message: “Make the palette darker”", a link to where it went. */
  onYours: { words: string; path: string } | null;
  /** Shares the header of the line before it. */
  joined: boolean;
  /** A day's heading above it. */
  day: string | null;
}

/** Kinds that follow from a message of yours; a reply or a decision only does when the message is on the page. */
const FOLLOWS = new Set<LineKind>(['passed', 'ack', 'disagree', 'stall', 'burst', 'reply', 'decision']);
const ALWAYS = new Set<LineKind>(['passed', 'ack', 'disagree', 'stall', 'burst']);

/** The rows to draw for `lines` (already filtered and folded); `all` is every line, so a thread knows its message. */
export function rowsOf(lines: readonly FeedLine[], all: readonly FeedLine[], now: number): FeedRow[] {
  const roots = new Map<string, FeedLine>();
  for (const l of all) if (l.kind === 'yours' && l.about !== null && l.link?.label === 'Where it went') roots.set(l.about, l);
  const rows: FeedRow[] = [];
  let day: string | null = null;
  for (const line of lines) {
    const prev = rows.at(-1)?.line;
    const thread = line.about !== null && FOLLOWS.has(line.kind) && (ALWAYS.has(line.kind) || roots.has(line.about)) ? line.about : null;
    const inRow = thread !== null && prev !== undefined && prev.about === thread;
    const root = thread !== null ? roots.get(thread) : undefined;
    const onYours =
      thread !== null && !inRow
        ? { words: root ? root.words : line.words, path: root?.link?.path ?? tracePath(thread) }
        : null;
    const joined =
      prev !== undefined &&
      !onYours &&
      JOINS.has(line.kind) &&
      prev.kind === line.kind &&
      prev.from === line.from &&
      line.at - prev.at <= HEADER_MS &&
      (rows.at(-1)?.rail ?? false) === inRow;
    const heading = dayOf(line.at, now);
    rows.push({ line, rail: inRow, onYours, joined, day: heading === day ? null : heading });
    day = heading;
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Unread

/** The row the New rule sits above: the first line from anyone but you since `newFrom`. -1 when nothing is new. */
export const firstNewRow = (rows: readonly FeedRow[], newFrom: number): number => rows.findIndex((r) => r.line.at > newFrom && r.line.from !== STAKEHOLDER);

/** A reply to you keeps its dot until you have seen their conversation. */
export function unreadReply(line: FeedLine, seen: CompanyView['seen']): boolean {
  if (line.kind !== 'reply') return false;
  const looked = Object.hasOwn(seen, line.from) ? (seen[line.from] ?? 0) : 0;
  return line.at > looked;
}

// ---------------------------------------------------------------------------------------------------------------
// Older lines

/** The messages and acknowledgements fetched from before the view, and what the office said about more. */
export interface Earlier {
  /** Oldest first, as the company keeps them. */
  messages: Message[];
  acks: Ack[];
  /** The oldest message held, which the next page is asked before; null until a page came. */
  cursor: string | null;
  /** True: the office has more. False: nothing older is kept. Null: not asked yet. */
  more: boolean | null;
}

export const NO_EARLIER: Earlier = { messages: [], acks: [], cursor: null, more: null };

/** What a one-message ask before `cursor` found: whether the office keeps anything older than it. */
export interface Probe {
  cursor: string;
  has: boolean;
}

/**
 * Whether to offer "Show earlier lines": not before the office has said something older is kept (a probe of one
 * message), then for as long as it has more. Once something older was found there always is: the view only moves on.
 */
export const offersEarlier = (earlier: Earlier, probe: Probe | null): boolean => earlier.more === true || (earlier.more === null && probe?.has === true);

/** Whether to ask the office for that probe: there is a cursor, no page came and nothing is known for this cursor yet. */
export const needsProbe = (cursor: string | null, earlier: Earlier, probe: Probe | null): boolean =>
  cursor !== null && earlier.more === null && !(probe !== null && (probe.has || probe.cursor === cursor));

/** Where the next page starts: the oldest message held, then the last message of the page before. */
export const cursorOf = (company: Pick<CompanyView, 'messages'>, earlier: Earlier): string | null => earlier.cursor ?? company.messages[0]?.id ?? null;

/** A page added: its messages (newest first) go in front, anything already held is kept once, and the page says if more is kept. */
export function applyPage(earlier: Earlier, page: MessagePage): Earlier {
  const have = new Set(earlier.messages.map((m) => m.id));
  const fresh = [...page.messages].reverse().filter((m) => !have.has(m.id));
  const haveAcks = new Set(earlier.acks.map((a) => a.id));
  const acks = [...earlier.acks, ...page.acks.filter((a) => !haveAcks.has(a.id))].sort((a, b) => a.at - b.at);
  const last = page.messages.at(-1);
  // An empty page that claims more would be asked again for ever.
  return { messages: [...fresh, ...earlier.messages], acks, cursor: last?.id ?? earlier.cursor, more: page.more && last !== undefined };
}

/**
 * The view moved on from `prev` to `next`: a live view carries only the newest messages, so the ones that slid out of its
 * front would be in neither the view nor the pages. They join the earlier lines, after the pages (they are newer).
 */
export function slideOut(earlier: Earlier, prev: CompanyView, next: CompanyView): Earlier {
  const kept = new Set(next.messages.map((m) => m.id));
  // Only the window's front slides out (the view keeps the newest). A message gone from anywhere else was unsent or
  // withdrawn, and leaves the feed with its acknowledgements.
  const firstKept = prev.messages.findIndex((m) => kept.has(m.id));
  const left = (firstKept === -1 ? prev.messages : prev.messages.slice(0, firstKept)).filter((m) => !kept.has(m.id));
  const leftIds = new Set(left.map((m) => m.id));
  const keptAcks = new Set((next.steering?.acks ?? []).map((a) => a.id));
  const leftAcks = (prev.steering?.acks ?? []).filter((a) => !keptAcks.has(a.id) && leftIds.has(a.message));
  if (left.length === 0 && leftAcks.length === 0) return earlier;
  const have = new Set(earlier.messages.map((m) => m.id));
  const haveAcks = new Set(earlier.acks.map((a) => a.id));
  return {
    ...earlier,
    messages: [...earlier.messages, ...left.filter((m) => !have.has(m.id))],
    acks: [...earlier.acks, ...leftAcks.filter((a) => !haveAcks.has(a.id))].sort((a, b) => a.at - b.at),
  };
}

/** The view with the earlier pages in front of its own messages, by id; the same object when there are none. */
export function withEarlier(company: CompanyView, earlier: Earlier): CompanyView {
  if (earlier.messages.length === 0 && earlier.acks.length === 0) return company;
  const held = new Set(company.messages.map((m) => m.id));
  const messages = [...earlier.messages.filter((m) => !held.has(m.id)), ...company.messages];
  if (!company.steering) return { ...company, messages };
  const heldAcks = new Set(company.steering.acks.map((a) => a.id));
  const acks = [...earlier.acks.filter((a) => !heldAcks.has(a.id)), ...company.steering.acks].sort((a, b) => a.at - b.at);
  return { ...company, messages, steering: { ...company.steering, acks } };
}
