// The Dashboards tab's words and choices (docs/design-v3.md, "Dashboards"): which board shows, the select's options,
// the note a refused dashboard leaves, the Timeline's headings, folds and filters, and the sentences beside the Progress
// and Spend charts. The numbers come from src/core/boards.ts, so the boards agree with the state; this file only says
// them. Pure, with no DOM, so the tests read the same words the tab shows.
import type { BlockedTask, MilestoneProgress, Series, SpendRangeId, TimelineEntry } from '../../../../src/core/boards.ts';
import { DAY_MS, HOUR_MS, startOfDay } from '../../../../src/core/boards.ts';
import { introduce, type LogEntry, type PersonView, STAKEHOLDER, THE_OFFICE } from '../../../../src/core/company.ts';
import type { Dashboard } from '../../../../src/core/dashboard.ts';
import { clip, coarseDuration, countWord, plainText } from '../../../../src/core/now.ts';
import { inSentence, titleFromId } from '../../../../src/core/studio.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute } from '../../lib/format.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Which board

export const BUILT_IN_BOARDS = ['progress', 'spend', 'timeline'] as const;
export type BuiltInBoard = (typeof BUILT_IN_BOARDS)[number];

const BUILT_IN_TITLES: Record<BuiltInBoard, string> = { progress: 'Progress', spend: 'Spend', timeline: 'Timeline' };

export const isBuiltIn = (id: string): id is BuiltInBoard => (BUILT_IN_BOARDS as readonly string[]).includes(id);

export type Board = { kind: 'built-in'; id: BuiltInBoard; title: string } | { kind: 'ceo'; id: string; title: string; dashboard: Dashboard };

const builtIn = (id: BuiltInBoard): Board => ({ kind: 'built-in', id, title: BUILT_IN_TITLES[id] });

/** A board by its id in the address: a built-in one first, then the CEO's. */
export function boardById(id: string | null, dashboards: readonly Dashboard[]): Board | null {
  if (id === null) return null;
  if (isBuiltIn(id)) return builtIn(id);
  const d = dashboards.find((x) => x.id === id);
  return d ? { kind: 'ceo', id: d.id, title: d.title, dashboard: d } : null;
}

/**
 * The board the tab shows: the one the address names, else the last one viewed, else Progress. `gone` when the
 * address named one that isn't there any more (the CEO's dashboards come and go): the tab shows Progress and says so.
 */
export function chooseBoard(requested: string | null, remembered: string | null, dashboards: readonly Dashboard[]): { board: Board; gone: boolean } {
  const asked = boardById(requested, dashboards);
  if (asked) return { board: asked, gone: false };
  if (requested !== null) return { board: builtIn('progress'), gone: true };
  return { board: boardById(remembered, dashboards) ?? builtIn('progress'), gone: false };
}

export interface Choice {
  value: string;
  label: string;
}

/** The select: Progress, Spend and Timeline, then the CEO's dashboards, newest first (left out while there are none). */
export function boardChoices(dashboards: readonly Dashboard[]): { builtIn: Choice[]; ceo: Choice[] } {
  return {
    builtIn: BUILT_IN_BOARDS.map((id) => ({ value: id, label: BUILT_IN_TITLES[id] })),
    ceo: [...dashboards].sort((a, b) => b.publishedAt - a.publishedAt).map((d) => ({ value: d.id, label: d.title })),
  };
}

/** What the CEO's box starts with when you ask for a dashboard, or to change one. */
export const ASK_FOR_DASHBOARD = 'Make a dashboard that shows ';
export const askToChange = (title: string): string => `Change the dashboard “${title}”: `;

/**
 * The office's sentence about the CEO's latest refused dashboard ("The office turned down the CEO's dashboard “Launch
 * checklist”: …"), which stands atop the tab until the CEO publishes again. Null when nothing was refused since.
 */
export function refusedNote(log: readonly LogEntry[], dashboards: readonly Dashboard[]): { text: string; at: number } | null {
  let refused: LogEntry | null = null;
  let published = Math.max(Number.NEGATIVE_INFINITY, ...dashboards.map((d) => d.publishedAt));
  for (const e of log) {
    if (e.kind === 'dashboard-refused' && (refused === null || e.at >= refused.at)) refused = e;
    if (e.kind === 'dashboard' && e.at > published) published = e.at;
  }
  if (refused === null || refused.at < published) return null;
  return { text: clip(plainText(refused.text), 320), at: refused.at };
}

/** "Made by the CEO at 14:02." */
export function madeByLine(d: Pick<Dashboard, 'by' | 'publishedAt'>, people: readonly PersonView[], now: number): string {
  const p = people.find((x) => x.id === d.by);
  const who = !p || p.level === 'ceo' ? 'the CEO' : `${introduce(p)},`;
  return `Made by ${who} ${atWords(d.publishedAt, now)}.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Days and times

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 3 Nov", with the year when it isn't this year's. */
export function dayLabel(at: number, now: number): string {
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${WEEKDAYS[d.getDay()] ?? ''} ${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}${year}`;
}

/** Which local day `at` falls on, counted back from today's: 0 today (or later), 1 yesterday. */
export function daysAgo(at: number, now: number): number {
  let day = startOfDay(now);
  let days = 0;
  // Whole local days one at a time, so a day with a clock change still counts as one.
  while (at < day && days < 400) {
    day = startOfDay(day - 1);
    days += 1;
  }
  return days;
}

/** When something happened, inside a sentence: "at 14:02", "yesterday at 14:02", "on Mon 3 Nov at 14:02". */
export function atWords(at: number, now: number): string {
  const days = daysAgo(at, now);
  if (days === 0) return `at ${hourMinute(at)}`;
  if (days === 1) return `yesterday at ${hourMinute(at)}`;
  return `on ${dayLabel(at, now)} at ${hourMinute(at)}`;
}

/** The start of the local hour `at` is in. */
function hourStart(at: number): number {
  const d = new Date(at);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/** A Timeline heading: the hour today ("14:00"), then "Yesterday", then the day ("Mon 3 Nov"). */
export function timelineHeading(at: number, now: number): string {
  const days = daysAgo(at, now);
  if (days === 0) return hourMinute(hourStart(at));
  return days === 1 ? 'Yesterday' : dayLabel(at, now);
}

// ---------------------------------------------------------------------------------------------------------------------
// Timeline

export const EVERYONE = 'everyone';

/** "Who" and "Status lines": everyone, a room ("room:design") or a person ("person:kai"); status lines on or off. */
export interface TimelineFilter {
  who: string;
  status: boolean;
}

export const DEFAULT_FILTER: TimelineFilter = { who: EVERYONE, status: true };

/** A person in a list of choices: "Ada, head of design", or the title alone for a role without a name. */
export const personLabel = (p: Pick<PersonView, 'name' | 'title'>): string => (p.name === p.title ? p.title : `${p.name}, ${inSentence(p.title)}`);

/** The "Who" filter's choices: rooms that have people, then you, everyone in the company and the office. */
export function whoChoices(people: readonly PersonView[], rooms: readonly { id: string; name: string }[]): { rooms: Choice[]; people: Choice[] } {
  const used = new Set(people.map((p) => p.room));
  return {
    rooms: rooms.filter((r) => used.has(r.id)).map((r) => ({ value: `room:${r.id}`, label: r.name })),
    people: [
      { value: `person:${STAKEHOLDER}`, label: 'You' },
      ...people.map((p) => ({ value: `person:${p.id}`, label: personLabel(p) })),
      { value: `person:${THE_OFFICE}`, label: 'The office' },
    ],
  };
}

/** Who a filter names, inside a sentence: "you", "the office", "Design", "Ada"; null for everyone. */
export function whoInSentence(who: string, people: readonly PersonView[], rooms: readonly { id: string; name: string }[]): string | null {
  if (who.startsWith('room:')) return roomName(who.slice('room:'.length), rooms);
  if (!who.startsWith('person:')) return null;
  const id = who.slice('person:'.length);
  if (id === STAKEHOLDER) return 'you';
  if (id === THE_OFFICE) return 'the office';
  const p = people.find((x) => x.id === id);
  return p ? (p.name === p.title ? `the ${inSentence(p.title)}` : p.name) : `the ${inSentence(titleFromId(id))}`;
}

/** The lines the filters keep: everyone's, or those about a room's people or one person; with or without status lines. */
export function filterTimeline(entries: readonly TimelineEntry[], filter: TimelineFilter, people: readonly PersonView[]): TimelineEntry[] {
  const roomOf = new Map(people.map((p) => [p.id, p.room]));
  const about = (e: TimelineEntry): boolean => {
    if (filter.who.startsWith('person:')) return e.people.includes(filter.who.slice('person:'.length));
    if (filter.who.startsWith('room:')) {
      const room = filter.who.slice('room:'.length);
      return e.people.some((id) => roomOf.get(id) === room);
    }
    return true;
  };
  return entries.filter((e) => (filter.status || e.kind !== 'status') && about(e));
}

/** A line, and the same person's earlier status lines in that hour, folded under it ("and 5 earlier updates"). */
export interface TimelineLine {
  entry: TimelineEntry;
  earlier: TimelineEntry[];
}

export interface TimelineGroup {
  key: string;
  heading: string;
  lines: TimelineLine[];
}

/**
 * The Timeline under its headings, newest first: an hour at a time today, a day at a time before. One person's status
 * lines in an hour fold into the latest of them; every other line stands on its own.
 */
export function timelineGroups(entries: readonly TimelineEntry[], now: number): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  const byKey = new Map<string, TimelineGroup>();
  const folds = new Map<string, TimelineLine>();
  for (const entry of [...entries].sort((a, b) => b.at - a.at)) {
    const key = daysAgo(entry.at, now) === 0 ? `h:${hourStart(entry.at)}` : `d:${startOfDay(entry.at)}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, heading: timelineHeading(entry.at, now), lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    if (entry.kind !== 'status') {
      group.lines.push({ entry, earlier: [] });
      continue;
    }
    const fold = `${entry.person}|${hourStart(entry.at)}`;
    const latest = folds.get(fold);
    if (latest) {
      latest.earlier.push(entry);
      continue;
    }
    const line: TimelineLine = { entry, earlier: [] };
    folds.set(fold, line);
    group.lines.push(line);
  }
  return groups;
}

/** How many lines the Timeline draws before "Show earlier lines". */
export const TIMELINE_PAGE = 120;

/** The first `limit` lines under their headings (a fold counts as one line), and how many lines are left. */
export function pageGroups(groups: readonly TimelineGroup[], limit: number): { groups: TimelineGroup[]; more: number } {
  const out: TimelineGroup[] = [];
  let left = limit;
  let more = 0;
  for (const g of groups) {
    const lines = g.lines.slice(0, Math.max(0, left));
    more += g.lines.length - lines.length;
    left -= lines.length;
    if (lines.length > 0) out.push({ ...g, lines });
  }
  return { groups: out, more };
}

/** "and 5 earlier updates", "and one earlier update". */
export const earlierWords = (n: number): string => `and ${countWord(n)} earlier ${n === 1 ? 'update' : 'updates'}`;

/** What an empty Timeline says, for nothing at all and for filters that leave nothing (`who` in a sentence). */
export function timelineEmpty(total: number, filter: TimelineFilter, who: string | null): string {
  if (total === 0) return 'Nothing to tell yet. Status lines, reports and decisions show up here as they happen.';
  if (who !== null) return `Nothing about ${who} yet.${filter.status ? '' : ' Status lines are hidden.'}`;
  return 'Only status lines so far. Turn on Status lines to see them.';
}

// ---------------------------------------------------------------------------------------------------------------------
// Progress

/** Beside a milestone's bar: "Done at 13:40", "8 of 10 tasks done", "No tasks yet". */
export function milestoneWords(m: Pick<MilestoneProgress, 'done' | 'doneAt' | 'tasks'>, now: number): string {
  if (m.done && m.doneAt !== null) return capital(`done ${atWords(m.doneAt, now)}`);
  if (m.tasks.total === 0) return 'No tasks yet';
  return `${m.tasks.done} of ${m.tasks.total} tasks done`;
}

/** A milestone's share for its bar: whole once it's done, else its done tasks of all but the dropped. */
export const milestoneShare = (m: Pick<MilestoneProgress, 'done' | 'tasks'>): number => (m.done ? 1 : m.tasks.total === 0 ? 0 : m.tasks.done / m.tasks.total);

/** A blocked task's who and why: "Ravi, QA engineer, blocked for 15 min" and the first sentence of why. */
export function blockedWords(b: Pick<BlockedTask, 'owner' | 'why' | 'since'>, people: readonly PersonView[], now: number): { who: string; why: string } {
  const p = people.find((x) => x.id === b.owner);
  const who = p ? capital(introduce(p)) : titleFromId(b.owner);
  return { who: `${who}, blocked for ${coarseDuration(now - b.since)}`, why: b.why ?? 'Nobody said why yet.' };
}

/** A room's name for a chart's label, or "People who left" for tasks and spend no current room holds. */
export function roomName(room: string | null, rooms: readonly { id: string; name: string }[]): string {
  if (room === null) return 'People who left';
  return rooms.find((r) => r.id === room)?.name ?? titleFromId(room);
}

/** The room each bar names when every label of a CEO's bars widget is a room's name; else null, and the bars are ink. */
export function roomsOfBars(labels: readonly string[], rooms: readonly { id: string; name: string }[]): string[] | null {
  if (labels.length === 0) return null;
  const ids: string[] = [];
  for (const label of labels) {
    const key = label.trim().toLowerCase();
    const room = rooms.find((r) => r.name.toLowerCase() === key || r.id.toLowerCase() === key);
    if (!room) return null;
    ids.push(room.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------------
// Spend

export const RANGE_LABELS: Record<SpendRangeId, string> = { today: 'Today', week: '7 days', all: 'All' };

/** The spent figure's title, labelled as v2 labels money: "API-equivalent today", "Spent over 7 days". */
export function spentTitle(label: 'API-equivalent' | 'Spend', range: SpendRangeId): string {
  const when = range === 'today' ? 'today' : range === 'week' ? 'over 7 days' : 'so far';
  return label === 'Spend' ? `Spent ${when}` : `API-equivalent ${when}`;
}

export const spentNote = (estimate: boolean): string =>
  estimate ? 'What the same tokens would cost on the Claude API.' : 'What Claude Code reported for your API key.';

export function nothingSpent(range: SpendRangeId): string {
  if (range === 'today') return 'Nothing spent today.';
  return range === 'week' ? 'Nothing spent in the last 7 days.' : 'Nothing spent yet.';
}

/** The over-time chart's title from its bucket size: "By the hour", "Every four hours", "By the day". */
export function stepWords(step: number): string {
  const hours = Math.round(step / HOUR_MS);
  if (hours <= 1) return 'By the hour';
  if (hours < 24) return `Every ${countWord(hours)} hours`;
  if (hours === 24) return 'By the day';
  if (hours === 168) return 'By the week';
  if (hours % 168 === 0) return `Every ${countWord(hours / 168)} weeks`;
  return `Every ${countWord(Math.round(hours / 24))} days`;
}

/** A bucket in words, for the table and the readout: "13:00 to 14:00", "Tue 4 Nov, 13:00 to 17:00", "Tue 4 Nov". */
export function bucketLabel(at: number, step: number, now: number): string {
  if (step >= DAY_MS) return step === DAY_MS ? dayLabel(at, now) : `${dayLabel(at, now)} to ${dayLabel(at + step - DAY_MS, now)}`;
  const span = `${hourMinute(at)} to ${hourMinute(at + step)}`;
  return daysAgo(at, now) === 0 ? span : `${dayLabel(at, now)}, ${span}`;
}

/**
 * A tick under an over-time chart, short: "13:00" today and "Tue 13:00" before it, or the date ("29 Oct") for day-sized
 * buckets and for charts that span six days or more, where a weekday alone could be this week's or last week's.
 */
export function tickLabel(at: number, step: number, now: number, span = 0): string {
  const d = new Date(at);
  if (step >= DAY_MS || span >= 6 * DAY_MS) return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`;
  return daysAgo(at, now) === 0 ? hourMinute(at) : `${WEEKDAYS[d.getDay()] ?? ''} ${hourMinute(at)}`;
}

/** How long a series spans from its first bucket to its last, for its ticks. */
export const seriesSpan = (series: Pick<Series, 'points'>): number => (series.points.at(-1)?.at ?? 0) - (series.points[0]?.at ?? 0);

/**
 * The over-time chart in a sentence: when the most was spent ("from 10:00 to 11:00" on today's chart, "today, from
 * 00:00 to 04:00" or "on Tue 4 Nov, from …" on one that starts before today). Null when nothing was.
 */
export function peakWords(series: Series, now: number, money: (n: number) => string): string | null {
  const peak = series.points.reduce<{ at: number; value: number } | null>((best, p) => (p.value > 0 && (!best || p.value > best.value) ? p : best), null);
  if (!peak) return null;
  const span = `from ${hourMinute(peak.at)} to ${hourMinute(peak.at + series.step)}`;
  let when: string;
  if (series.step >= DAY_MS) when = series.step === DAY_MS ? `on ${dayLabel(peak.at, now)}` : `from ${bucketLabel(peak.at, series.step, now)}`;
  else if (daysAgo(peak.at, now) > 0) when = `on ${dayLabel(peak.at, now)}, ${span}`;
  else when = daysAgo(series.points[0]?.at ?? peak.at, now) > 0 ? `today, ${span}` : span;
  return `Most was spent ${when}: ${money(peak.value)}.`;
}
