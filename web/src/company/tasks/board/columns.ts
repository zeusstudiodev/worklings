// The task board's columns (docs/design-v3.md, "Stage and dock", "The task board"): what lands in which column and in
// what order, each card's words, the board's sentence, the filters and the lanes. Pure, so it can be tested; the
// board's components only draw it.
import { checkWords } from '../../plan/checkModel.ts';
import { kindOfTask } from '../../plan/contractsModel.ts';
import { type CompanyView, type PersonView, STAKEHOLDER, type Task } from '../../../../../src/core/company.ts';
import { clip, coarseDuration, countWord, plainText } from '../../../../../src/core/now.ts';
import { capital } from '../../../../../src/core/words.ts';
import { endSentence, firstSentence, inLine, latestReport, nameOf, openItems, ordinal, STUCK_AFTER_MS, waitPerson } from '../../people/peopleModel.ts';
import { latestOf, planOf, planWait } from '../../plan/planModel.ts';
import { placeWord } from '../../plan/planEdit.ts';
import { cancelDecision, cancelLine, clockAt, isOpenTask, pausedLine } from '../boardModel.ts';
import { foundTasksLine } from '../tasksModel.ts';

// ---------------------------------------------------------------------------------------------------------------
// Columns

export type ColumnId = 'you' | 'queued' | 'working' | 'paused' | 'blocked' | 'review' | 'done' | 'cancelled';

export interface ColumnSpec {
  id: ColumnId;
  title: string;
  /** What the column says while it has no cards. */
  empty: string;
}

export const COLUMNS: readonly ColumnSpec[] = [
  { id: 'you', title: 'Waiting for you', empty: 'Nothing waits for you.' },
  { id: 'queued', title: 'Queued', empty: 'Nothing queued.' },
  { id: 'working', title: 'Working', empty: 'Nobody is on a task.' },
  { id: 'paused', title: 'Paused', empty: 'Drop a task here to pause it.' },
  { id: 'blocked', title: 'Blocked', empty: 'Nothing is blocked.' },
  { id: 'review', title: 'In review', empty: 'Nothing waits for review.' },
  { id: 'done', title: 'Done', empty: 'Nothing done yet.' },
  { id: 'cancelled', title: 'Cancelled', empty: 'Drop a task here to cancel it.' },
];

export const columnTitle = (id: ColumnId): string => COLUMNS.find((c) => c.id === id)?.title ?? id;

/** Columns ordered by the order work is handed out in: a card's place there is its place in line. */
export const ORDERED: ReadonlySet<ColumnId> = new Set(['queued', 'working', 'paused', 'blocked', 'review']);

/** Done and Cancelled show this many of their newest, then "And 22 more"; in a lane, three. */
export const NEWEST_SHOWN = 10;
export const NEWEST_SHOWN_IN_LANE = 3;
/** Columns that show their newest few until "And 22 more" is pressed. */
export const CAPPED: ReadonlySet<ColumnId> = new Set(['done', 'cancelled']);

/** The column a paused task came from, and goes back to when it resumes: its status's. */
export function homeOf(t: Task): ColumnId {
  switch (t.status) {
    case 'queued':
      return 'queued';
    case 'working':
      return 'working';
    case 'blocked':
      return 'blocked';
    case 'review':
      return 'review';
    case 'done':
      return 'done';
    case 'dropped':
      return 'cancelled';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What waits for you

/** What a task's owner waits on you for. `item` is the inbox item that answers it. */
export type WaitFor = { kind: 'ok'; item: string; at: number; what: string } | { kind: 'answer'; item: string; at: number; what: string } | { kind: 'start'; item: string; at: number };

/**
 * The tasks something waits on you for, oldest wait first: a question about a task waits on it, an office's "start
 * it?" (`gate`) holds the task it names, and an approval or a question about nothing in particular waits on the
 * person's current task. One whose task is closed, or whose person has no task, stays in the inbox and the feed.
 */
export function waitsOnTasks(company: Pick<CompanyView, 'tasks' | 'people' | 'questions' | 'approvals'>, now: number): Map<string, WaitFor> {
  const open = new Set(company.tasks.filter(isOpenTask).map((t) => t.id));
  const out = new Map<string, WaitFor>();
  const put = (task: string | null | undefined, wait: WaitFor) => {
    if (task && open.has(task) && !out.has(task)) out.set(task, wait);
  };
  for (const w of openItems(company, now)) {
    if (w.kind === 'question') {
      const q = w.question;
      if (q.gate) {
        put(q.gate.task, { kind: 'start', item: q.id, at: q.askedAt });
        continue;
      }
      // The question's first sentence, as a row says it: the whole question is in the inbox, one press away.
      const wait: WaitFor = { kind: 'answer', item: q.id, at: q.askedAt, what: endSentence(firstSentence(q.text, 120)) };
      if (q.taskId !== null) put(q.taskId, wait);
      else put(company.people.find((p) => p.id === waitPerson(w))?.task, wait);
    } else {
      const a = w.approval;
      put(company.people.find((p) => p.id === a.person)?.task, { kind: 'ok', item: a.id, at: a.askedAt, what: `${clip(inLine(a.summary), 120)}.` });
    }
  }
  return out;
}

const WAIT_BAND: Record<WaitFor['kind'], string> = { ok: 'Waits for your OK', answer: 'Waits for your answer', start: 'Waits for you to start it' };

function waitLine(w: WaitFor): string {
  switch (w.kind) {
    case 'ok':
      return `Waits for your OK: ${w.what}`;
    case 'answer':
      return `Waits for your answer: ${w.what}`;
    case 'start':
      return 'Waits for you to start it.';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cards and the board

export interface TaskCard {
  kind: 'task';
  /** The task's id: the card's key, its link and its place in the order. */
  id: string;
  task: Task;
  column: ColumnId;
  /** Its place among every open task, from 1: the switchboard's order. Null once it is closed. */
  place: number | null;
  waits: WaitFor | null;
}

/** The plan while it waits for your approval: first in Waiting for you, as a card. It isn't a task, so it never lifts. */
export interface PlanCard {
  kind: 'plan';
  id: 'plan';
  version: number;
  /** "The CEO's plan, version 3", or what of it waits. */
  title: string;
  /** The inbox's sentence: "The CEO's plan waits for your approval." */
  line: string;
  at: number;
}

export type Card = TaskCard | PlanCard;

export interface ColumnView extends ColumnSpec {
  cards: Card[];
}

export interface BoardView {
  columns: ColumnView[];
  /** Tasks on the board, whatever the filters. */
  total: number;
  /** Tasks the filters let through. */
  matching: number;
}

/** The column a task shows in: Waiting for you wins over Paused, and Paused over its status. */
export function columnOf(t: Task, waits: WaitFor | null): ColumnId {
  if (t.status === 'done') return 'done';
  if (t.status === 'dropped') return 'cancelled';
  if (waits) return 'you';
  if (t.paused) return 'paused';
  return homeOf(t);
}

/** The plan's card, while the plan waits for your approval; null otherwise. */
export function planCard(company: CompanyView): PlanCard | null {
  const wait = planWait(company);
  const latest = latestOf(planOf(company));
  if (!wait || !latest) return null;
  const title = wait.kind === 'plan' ? `The CEO's plan, version ${latest.version}` : `The CEO's plan: the next milestone`;
  return { kind: 'plan', id: 'plan', version: latest.version, title, line: wait.sentence, at: company.steering?.plan?.waiting?.since ?? latest.at };
}

const doneFirst = (a: Task, b: Task) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Every column with its cards, filtered. `order` is the open tasks in the order work is handed out in, yours while it is
 * on its way to the office (withPending): the ordered columns follow it, and each open card's place comes from it.
 */
export function boardOf(company: CompanyView, order: readonly string[], now: number, filters: BoardFilters = NO_FILTERS): BoardView {
  const waits = waitsOnTasks(company, now);
  const places = new Map(order.map((id, i) => [id, i + 1]));
  const rank = (t: Task) => places.get(t.id) ?? Number.POSITIVE_INFINITY;
  const byColumn = new Map<ColumnId, TaskCard[]>(COLUMNS.map((c) => [c.id, []]));
  let matching = 0;
  for (const t of company.tasks) {
    if (!matches(company, filters, t)) continue;
    matching += 1;
    const wait = isOpenTask(t) ? (waits.get(t.id) ?? null) : null;
    const column = columnOf(t, wait);
    byColumn.get(column)?.push({ kind: 'task', id: t.id, task: t, column, place: isOpenTask(t) ? (places.get(t.id) ?? null) : null, waits: wait });
  }
  const plan = planCard(company);
  const columns = COLUMNS.map((spec): ColumnView => {
    const cards = byColumn.get(spec.id) ?? [];
    if (spec.id === 'you') {
      cards.sort((a, b) => (a.waits?.at ?? 0) - (b.waits?.at ?? 0) || rank(a.task) - rank(b.task));
      return { ...spec, cards: plan && showsPlan(company, filters) ? [plan, ...cards] : cards };
    }
    if (CAPPED.has(spec.id)) cards.sort((a, b) => doneFirst(a.task, b.task));
    else cards.sort((a, b) => rank(a.task) - rank(b.task) || a.task.createdAt - b.task.createdAt);
    return { ...spec, cards };
  });
  return { columns, total: company.tasks.length, matching };
}

/** "51 tasks: 24 done, eight working, three wait for you." Null without tasks. */
export function boardSentence(company: CompanyView, board: Pick<BoardView, 'columns'>): string | null {
  const total = company.tasks.length;
  if (total === 0) return null;
  const done = company.tasks.filter((t) => t.status === 'done').length;
  const count = (id: ColumnId) => board.columns.find((c) => c.id === id)?.cards.filter((c) => c.kind === 'task').length ?? 0;
  const working = count('working');
  const you = count('you');
  const parts = [done > 0 ? `${countWord(done)} done` : null, working > 0 ? `${countWord(working)} working` : null, you > 0 ? `${countWord(you)} ${you === 1 ? 'waits' : 'wait'} for you` : null].filter(Boolean);
  const head = `${capital(countWord(total))} ${total === 1 ? 'task' : 'tasks'}`;
  return parts.length > 0 ? `${head}: ${parts.join(', ')}.` : `${head}, none done yet.`;
}

// ---------------------------------------------------------------------------------------------------------------
// A card's words

/** "4th": a place in line on a note. */
export function shortPlace(n: number): string {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** The one key a note holds, if any. */
export type CardKey = { kind: 'answer'; item: string } | { kind: 'resume' } | { kind: 'undo-cancel'; decision: string } | { kind: 'open-plan' } | null;

export interface CardWords {
  /** The glue band: the room's name; what it waits on you for; "Done"; "Cancelled". */
  band: string;
  /** "4th", for open tasks. */
  place: string | null;
  title: string;
  /** A subtask's "Part of: Pickup orders". */
  part: string | null;
  /** The tag of an integration or verification task: "Integration", "Check"; null for the rest. */
  kind: string | null;
  /** The result of the check the office ran (v0.2): its tag and state; null before there is one. */
  check: { tag: string; state: string } | null;
  /** A parent's parts: how many are done. */
  parts: { done: number; total: number; line: string } | null;
  /** The line in the task rows' words. */
  line: string;
  /** Its owner's trouble: "Stuck for 4 min". */
  stuck: string | null;
  /** The owner's first name, as the foot shows it. */
  owner: string;
  /** The milestone, cut at 24 characters for the note; whole in the description. */
  milestone: string | null;
  key: CardKey;
  /** What the link says after its name: "Noah. Working for 22 min. Pickup orders work. Fourth of 14 in line." */
  description: string;
}

/**
 * What every card's words look up, made once per drawing, so a board of a hundred cards reads each list once instead of
 * once per card.
 */
export interface BoardIndex {
  people: ReadonlyMap<string, PersonView>;
  tasks: ReadonlyMap<string, Task>;
  /** Each owner's queued tasks that aren't paused, in the order work is handed out in. */
  queues: ReadonlyMap<string, readonly string[]>;
  /** Each task's subtasks, the dropped ones left out. */
  parts: ReadonlyMap<string, readonly Task[]>;
  milestones: ReadonlyMap<string, string>;
  /** How many open tasks are in line. */
  inLine: number;
}

export function boardIndex(company: Pick<CompanyView, 'tasks' | 'people' | 'goal'>, order: readonly string[]): BoardIndex {
  const tasks = new Map(company.tasks.map((t) => [t.id, t]));
  const queues = new Map<string, string[]>();
  for (const id of order) {
    const t = tasks.get(id);
    if (!t || t.status !== 'queued' || t.paused) continue;
    queues.set(t.owner, [...(queues.get(t.owner) ?? []), id]);
  }
  const parts = new Map<string, Task[]>();
  for (const t of company.tasks) if (t.parent !== null && t.status !== 'dropped') parts.set(t.parent, [...(parts.get(t.parent) ?? []), t]);
  return {
    people: new Map(company.people.map((p) => [p.id, p])),
    tasks,
    queues,
    parts,
    milestones: new Map((company.goal?.milestones ?? []).map((m) => [m.id, plainText(m.title)])),
    inLine: order.length,
  };
}

/** A person's first name on a note: "Noah"; a role without a name keeps its title ("QA engineer"). */
export function firstName(company: Pick<CompanyView, 'people'>, id: string, index?: BoardIndex): string {
  if (id === STAKEHOLDER) return 'You';
  const p = index ? index.people.get(id) : company.people.find((x) => x.id === id);
  return p ? p.name : capital(nameOf(company, id).called);
}

/** "Next for Noah.", "Third for Lena.": where it stands among its owner's queued tasks. */
export function queuedLine(company: Pick<CompanyView, 'people'>, index: BoardIndex, t: Task): string {
  const at = index.queues.get(t.owner)?.indexOf(t.id) ?? -1;
  const who = nameOf(company, t.owner).called;
  return at <= 0 ? `Next for ${who}.` : `${capital(ordinal(at + 1))} for ${who}.`;
}

/** "Fourth of 14 in line.", to screen readers. */
export const placeSaid = (place: number, inLine: number): string => (inLine <= 1 ? 'The only task in line.' : `${capital(placeWord(place))} of ${countWord(inLine)} in line.`);

/** A report's first sentence without the "Blocked:" it may start with, since the line says so. */
const why = (text: string) => firstSentence(text).replace(/^(blocked|stuck)\b[\s:,.-]*/i, '');

function columnLine(company: CompanyView, index: BoardIndex, card: TaskCard, now: number, filesChanged?: number): string {
  const t = card.task;
  if (card.waits) return waitLine(card.waits);
  switch (card.column) {
    case 'queued':
      return queuedLine(company, index, t);
    case 'working': {
      const owner = index.people.get(t.owner);
      if (owner?.desk.state === 'waiting' && owner.task === t.id) return owner.desk.queue ? `Waits for a desk, ${ordinal(owner.desk.queue)} in line.` : 'Waits for a desk.';
      return `Working for ${coarseDuration(now - t.updatedAt)}.`;
    }
    case 'paused':
      return pausedLine(company, t) ?? 'Paused.';
    case 'blocked': {
      const report = latestReport(company, t.owner, t.id);
      return report?.outcome === 'blocked' && why(report.text) ? `Blocked: ${endSentence(why(report.text))}` : 'Blocked.';
    }
    case 'review': {
      const asker = t.askedBy === STAKEHOLDER ? 'you' : t.askedBy === t.owner ? null : nameOf(company, t.askedBy).called;
      return asker ? `In review with ${asker}.` : 'In review.';
    }
    case 'done':
      return `Done at ${clockAt(t.updatedAt)}.${filesChanged !== undefined && filesChanged > 0 ? ` ${filesChanged} ${filesChanged === 1 ? 'file' : 'files'} changed.` : ''}`;
    case 'cancelled':
      return cancelLine(company, t) ?? `Dropped at ${clockAt(t.updatedAt)}.`;
    case 'you':
      return 'Waits for you.';
  }
}

/** Its owner's trouble tag: their desk failed and stayed down (v2's 30 s), as the face's danger mark says too. */
export function stuckOf(owner: PersonView | undefined, t: Task, now: number): string | null {
  if (!owner || owner.task !== t.id || owner.desk.state !== 'failed' || !isOpenTask(t)) return null;
  const failedFor = now - owner.desk.since;
  return failedFor >= STUCK_AFTER_MS ? `Stuck for ${coarseDuration(failedFor)}` : null;
}

const MILESTONE_CHARS = 24;

/**
 * Text as a note shows it (Markdown marks gone, one line, cut at a word), worked out once per text: a board draws its
 * notes again on every snapshot, with the same titles. Kept small; past the cap it starts again.
 */
const shown = new Map<string, string>();
const SHOWN_KEPT = 2_000;
function shownOnce(text: string, max: number): string {
  const key = `${max}:${text}`;
  const kept = shown.get(key);
  if (kept !== undefined) return kept;
  if (shown.size >= SHOWN_KEPT) shown.clear();
  const line = clip(plainText(text), max);
  shown.set(key, line);
  return line;
}

/** What a card's words depend on besides the card: the index, the time, and how a room is named. */
export interface WordsContext {
  index: BoardIndex;
  now: number;
  roomName: (room: string) => string;
}

/**
 * Everything a task's note says. `filesChanged` is how many files its commit changed, once its diff has been read
 * (today's rule: a board never reads every done task's diff to say so).
 */
export function cardWords(company: CompanyView, card: TaskCard, { index, now, roomName }: WordsContext, filesChanged?: number): CardWords {
  const t = card.task;
  const owner = index.people.get(t.owner);
  const milestone = t.milestone ? (index.milestones.get(t.milestone) ?? null) : null;
  const parent = t.parent ? index.tasks.get(t.parent) : undefined;
  const children = index.parts.get(t.id) ?? [];
  const doneChildren = children.filter((k) => k.status === 'done').length;
  const band =
    card.column === 'done'
      ? 'Done'
      : card.column === 'cancelled'
        ? t.cancel
          ? 'Cancelled'
          : 'Dropped'
        : card.waits
          ? WAIT_BAND[card.waits.kind]
          : owner
            ? roomName(owner.room)
            : 'No room';
  const line = columnLine(company, index, card, now, filesChanged);
  const undo = card.column === 'cancelled' ? cancelDecision(company, t) : null;
  const key: CardKey = card.waits ? { kind: 'answer', item: card.waits.item } : card.column === 'paused' ? { kind: 'resume' } : undo ? { kind: 'undo-cancel', decision: undo } : null;
  const ownerName = firstName(company, t.owner, index);
  const stuck = stuckOf(owner, t, now);
  const kindWord = kindOfTask(company, t);
  const checked = checkWords(t, owner);
  const description = [`${ownerName}.`, kindWord ? `${kindWord.label} task.` : null, checked ? `${checked.tag}.` : null, line, stuck ? `${stuck}.` : null, milestone ? endSentence(milestone) : null, card.place !== null ? placeSaid(card.place, index.inLine) : null].filter(Boolean).join(' ');
  return {
    band,
    place: card.place !== null ? shortPlace(card.place) : null,
    title: shownOnce(t.title, 200),
    kind: kindOfTask(company, t)?.label ?? null,
    check: checked ? { tag: checked.tag, state: checked.state } : null,
    part: parent ? `Part of: ${shownOnce(parent.title, 60)}` : null,
    parts: children.length > 0 ? { done: doneChildren, total: children.length, line: `${doneChildren} of ${children.length} ${children.length === 1 ? 'subtask' : 'subtasks'} done` } : null,
    line,
    stuck,
    owner: ownerName,
    milestone: milestone ? clip(milestone, MILESTONE_CHARS) : null,
    key,
    description,
  };
}

/** The plan's note: what waits, and Open the plan. */
export function planWords(company: CompanyView, card: PlanCard): Pick<CardWords, 'band' | 'title' | 'line' | 'owner' | 'description'> {
  const ceo = company.people.find((p) => p.level === 'ceo');
  const owner = ceo ? ceo.name : 'The CEO';
  return { band: 'Waits for your approval', title: card.title, line: card.line, owner, description: `${owner}. ${card.line}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Filters

export type Grouping = 'none' | 'person' | 'room';

/**
 * The board's filters, as their fields hold them: `who` is "" (everyone), "room:<id>" or "person:<id>"; `milestone`
 * "" (all) or a milestone's id; `find` what is typed.
 */
export interface BoardFilters {
  who: string;
  milestone: string;
  find: string;
  group: Grouping;
}

export const NO_FILTERS: BoardFilters = { who: '', milestone: '', find: '', group: 'none' };

/** A filter that hides tasks is on (grouping hides nothing). */
export const filtering = (f: BoardFilters): boolean => f.who !== '' || f.milestone !== '' || f.find.trim() !== '';

const searchable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Whether a task passes the filters: its owner or their room, its milestone, and Find on its title or owner. */
export function matches(company: Pick<CompanyView, 'people'>, f: BoardFilters, t: Task): boolean {
  const owner = company.people.find((p) => p.id === t.owner);
  if (f.who.startsWith('person:') && t.owner !== f.who.slice('person:'.length)) return false;
  if (f.who.startsWith('room:') && owner?.room !== f.who.slice('room:'.length)) return false;
  if (f.milestone !== '' && t.milestone !== f.milestone) return false;
  const q = searchable(f.find.trim());
  if (q && ![t.title, owner?.name ?? '', owner?.title ?? ''].some((field) => searchable(field).includes(q))) return false;
  return true;
}

/** The plan's card shows unless a filter leaves the CEO out. */
function showsPlan(company: Pick<CompanyView, 'people'>, f: BoardFilters): boolean {
  if (f.milestone !== '' || f.find.trim() !== '') return false;
  if (f.who === '') return true;
  const ceo = company.people.find((p) => p.level === 'ceo');
  return ceo !== undefined && (f.who === `person:${ceo.id}` || f.who === `room:${ceo.room}`);
}

/** "12 of 51 tasks", while a filter is on. */
export const filteredLine = (board: Pick<BoardView, 'matching' | 'total'>): string => foundTasksLine(board.matching, board.total);

/** Reads filters kept for the tab, as untrusted text: anything malformed is no filter. */
export function filtersFrom(raw: unknown): BoardFilters {
  if (typeof raw !== 'object' || raw === null) return NO_FILTERS;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : '');
  const group = r.group === 'person' || r.group === 'room' ? r.group : 'none';
  return { who: text(r.who, 220), milestone: text(r.milestone, 200), find: text(r.find, 200), group };
}

// ---------------------------------------------------------------------------------------------------------------
// Done and Cancelled: the newest few, then the rest

/** How many cards of a column show: Done and Cancelled their newest few until opened, the rest every card. */
export function shownCount(column: ColumnId, cards: number, opened: boolean, inLane = false): number {
  if (!CAPPED.has(column) || opened) return cards;
  return Math.min(cards, inLane ? NEWEST_SHOWN_IN_LANE : NEWEST_SHOWN);
}

/** "And 22 more". */
export const moreLine = (hidden: number): string => `And ${hidden} more`;

// ---------------------------------------------------------------------------------------------------------------
// New since you looked

/** What a card was when you last left the board: its column and its owner, by task id. */
export type Seen = Record<string, string>;

export function seenOf(board: Pick<BoardView, 'columns'>): Seen {
  const out: Seen = Object.create(null) as Seen;
  for (const c of board.columns) for (const card of c.cards) if (card.kind === 'task') out[card.id] = `${card.column}|${card.task.owner}`;
  return out;
}

/**
 * Cards that are new, or changed column or owner, since you last left the board. `before` is what this browser kept
 * then (untrusted: it comes from storage); a first visit (null) marks nothing.
 */
export function changedSince(before: Seen | null, now: Seen): Set<string> {
  const out = new Set<string>();
  if (!before) return out;
  for (const id of Object.keys(now)) if (!Object.hasOwn(before, id) || before[id] !== now[id]) out.add(id);
  return out;
}

/** Reads what was kept, as untrusted text: anything malformed counts as a first visit. */
export function seenFrom(raw: unknown): Seen | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: Seen = Object.create(null) as Seen;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string' && k.length <= 200 && v.length <= 400) out[k] = v;
  return out;
}
