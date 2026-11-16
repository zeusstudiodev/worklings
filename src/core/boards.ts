// The built-in dashboards, Progress, Spend and Timeline, as data the office draws (docs/design-v3.md, "Dashboards").
// Pure functions over a CompanyView and the time, with no Node APIs, so the browser and the tests agree. Tasks are
// counted the way the Tasks panel counts them (taskCounts, milestoneOf), spend adds up to what the people cost, and the
// timeline tells outcomes in sentences, never a tool call. What people wrote is masked and cut again here, as the story
// does (story.ts).
import { type CompanyView, type LogKind, type PersonView, type Report, STAKEHOLDER, type Task, TASK_STATUSES, THE_OFFICE } from './company.ts';
import { clip, LINE_CHARS, plainText, RESULT_CHARS } from './now.ts';
import { inSentence, titleFromId } from './studio.ts';
import { capital } from './words.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Series: values over time, in buckets sized to the span

/** The most points a series has, whatever its span. */
export const SERIES_POINTS = 48;

export interface SeriesPoint {
  /** The bucket's start. */
  at: number;
  value: number;
}

export interface Series {
  /** Each bucket's length in ms: an hour, a few hours, a day or more, so the span fits in SERIES_POINTS. */
  step: number;
  /** Oldest first, every bucket from the first to the one holding the end, empty ones included. */
  points: SeriesPoint[];
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** Bucket sizes, smallest first. Those under a day divide it, so buckets start on the hour counted from midnight. */
const STEPS = [1, 2, 3, 4, 6, 12, 24, 48, 72, 168, 336, 720].map((hours) => hours * HOUR_MS);

/** Local midnight at or before `t`: where "Today" and the buckets start. */
export function startOfDay(t: number): number {
  const day = new Date(t);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Buckets from `from` to `to`: the smallest step that keeps them within SERIES_POINTS, aligned to local midnight. */
function frame(from: number, to: number): { start: number; step: number; count: number } {
  const midnight = startOfDay(from);
  const end = Math.max(from, to);
  const fits = (step: number) => {
    const start = step < DAY_MS ? midnight + Math.floor((from - midnight) / step) * step : midnight;
    return { start, step, count: Math.floor((end - start) / step) + 1 };
  };
  for (const step of STEPS) {
    const f = fits(step);
    if (f.count <= SERIES_POINTS) return f;
  }
  return fits(Math.ceil((end - midnight) / SERIES_POINTS / DAY_MS + 1) * DAY_MS);
}

/** Sums values into buckets over [from, to]; values outside the span are left out. */
function bucketed(from: number, to: number, values: readonly SeriesPoint[]): Series {
  const { start, step, count } = frame(from, to);
  const sums = new Array<number>(count).fill(0);
  for (const v of values) {
    if (v.at < from || v.at > to) continue;
    const i = Math.floor((v.at - start) / step);
    sums[i] = (sums[i] ?? 0) + v.value;
  }
  return { step, points: sums.map((value, i) => ({ at: start + i * step, value })) };
}

const money = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

// ---------------------------------------------------------------------------------------------------------------------
// Words, as the story says them

/** Free text as the boards show it: Markdown's marks gone, masked again (a mark can hide a secret's shape), cut. */
const shown = (text: string, max: number) => clip(plainText(text), max);

/** A line as a sentence: a full stop unless it already ends like one. */
const sentence = (text: string) => (!text || /[.!?…]$/.test(text) ? text : `${text}.`);

const firstSentence = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
};

/** "Push the work branch to GitHub." -> "push the work branch to GitHub", leaving names and acronyms (GitHub, QA, npm) as they are. */
const deed = (summary: string) => {
  const text = shown(summary, LINE_CHARS).replace(/\.$/, '');
  return /^[A-Z][a-z]*(?:\s|$)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
};

/**
 * Someone inside a sentence: "you", "the office", a person's first name, or "the {title}" for a role without one
 * ("the CEO"). Someone no longer in the company goes by the title their id spells ("the SEO specialist").
 */
function namesOf(view: Pick<CompanyView, 'people'>): (id: string) => string {
  const people = new Map(view.people.map((p) => [p.id, p]));
  return (id) => {
    if (id === STAKEHOLDER) return 'you';
    if (id === THE_OFFICE) return 'the office';
    const p = people.get(id);
    if (p) return p.name === p.title ? `the ${inSentence(p.title)}` : p.name;
    return `the ${inSentence(titleFromId(id))}`;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Progress

export interface TaskCounts {
  queued: number;
  working: number;
  blocked: number;
  review: number;
  done: number;
  dropped: number;
  /** Every task but the dropped ones: what "8 of 10 done" counts against. */
  total: number;
}

/** Tasks by status, as the Tasks panel and the Progress board count them. */
export function taskCounts(tasks: readonly Task[]): TaskCounts {
  const counts: TaskCounts = { queued: 0, working: 0, blocked: 0, review: 0, done: 0, dropped: 0, total: 0 };
  for (const t of tasks) {
    if (!(TASK_STATUSES as readonly string[]).includes(t.status)) continue;
    counts[t.status] += 1;
    if (t.status !== 'dropped') counts.total += 1;
  }
  return counts;
}

/** The milestone a task counts toward: its own, else the nearest one up its parents (subtasks rarely name one). */
export function milestoneOf(task: Task, byId: ReadonlyMap<string, Task>): string | null {
  const seen = new Set<string>();
  for (let at: Task | undefined = task; at && !seen.has(at.id); at = at.parent === null ? undefined : byId.get(at.parent)) {
    if (at.milestone !== null) return at.milestone;
    seen.add(at.id);
  }
  return null;
}

/** Open questions and approvals: what waits for the stakeholder's answer, as the inbox counts it. */
export function waitingForYou(view: Pick<CompanyView, 'questions' | 'approvals'>): number {
  const open = (item: { answer: unknown; withdrawn: unknown }) => item.answer === null && item.withdrawn === null;
  return view.questions.filter(open).length + view.approvals.filter(open).length;
}

export interface MilestoneProgress {
  id: string;
  title: string;
  doneWhen: string;
  doneAt: number | null;
  done: boolean;
  /** Its tasks and their subtasks: done, of all but the dropped ones. */
  tasks: { done: number; total: number };
}

export interface RoomProgress {
  /** A department id; null for tasks whose owner is no longer in the company. */
  room: string | null;
  counts: TaskCounts;
}

export interface BlockedTask {
  id: string;
  title: string;
  owner: string;
  /** The first sentence of the latest report that said it was blocked, else of its outcome; null when nobody said. */
  why: string | null;
  /** When it last changed: since then it has been blocked. */
  since: number;
}

export interface ProgressBoard {
  goal: { text: string; setAt: number } | null;
  counts: TaskCounts;
  waitingForYou: number;
  milestones: MilestoneProgress[];
  /** Rooms in the order their people come, then (as null) tasks whose owner has left. */
  rooms: RoomProgress[];
  /** Blocked the longest first. */
  blocked: BlockedTask[];
  /**
   * Tasks done so far, cumulative, from the goal (or the first task) to now; a done task counts from its last update.
   * No points without tasks.
   */
  done: Series;
}

/** The Progress dashboard. `now` ends the done line; without it, the line ends at the latest change. */
export function progressBoard(view: CompanyView, now?: number): ProgressBoard {
  const tasks = view.tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const goal = view.goal;

  const milestones = (goal?.milestones ?? []).map((m): MilestoneProgress => {
    const counts = taskCounts(tasks.filter((t) => milestoneOf(t, byId) === m.id));
    return { id: m.id, title: m.title, doneWhen: m.doneWhen, doneAt: m.doneAt, done: m.doneAt !== null, tasks: { done: counts.done, total: counts.total } };
  });

  const roomOfOwner = new Map(view.people.map((p) => [p.id, p.room]));
  const roomOf = (t: Task) => roomOfOwner.get(t.owner) ?? null;
  const rooms = unique([...view.people.map((p) => p.room), ...tasks.map(roomOf)])
    .map((room) => ({ room, counts: taskCounts(tasks.filter((t) => roomOf(t) === room)) }))
    .filter((r) => r.counts.total + r.counts.dropped > 0);

  const blocked = tasks
    .filter((t) => t.status === 'blocked')
    .map((t): BlockedTask => {
      const report = view.reports.filter((r) => r.taskId === t.id && r.outcome === 'blocked').reduce<Report | null>((latest, r) => (latest && latest.at > r.at ? latest : r), null);
      const said = report?.text ?? t.outcome;
      return { id: t.id, title: shown(t.title, LINE_CHARS), owner: t.owner, why: said ? shown(firstSentence(said), LINE_CHARS) : null, since: t.updatedAt };
    })
    .sort((a, b) => a.since - b.since);

  const doneTimes = tasks.filter((t) => t.status === 'done').map((t) => t.updatedAt);
  let done: Series = { step: HOUR_MS, points: [] };
  if (tasks.length > 0) {
    const from = goal?.setAt ?? Math.min(...tasks.map((t) => t.createdAt));
    const to = now ?? Math.max(from, ...tasks.map((t) => t.updatedAt));
    done = bucketed(from, to, doneTimes.map((at) => ({ at, value: 1 })));
    let sum = doneTimes.filter((at) => at < from).length;
    for (const point of done.points) {
      sum += point.value;
      point.value = sum;
    }
  }

  return {
    goal: goal ? { text: shown(goal.text, RESULT_CHARS), setAt: goal.setAt } : null,
    counts: taskCounts(tasks),
    waitingForYou: waitingForYou(view),
    milestones,
    rooms,
    blocked,
    done,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Spend

export const SPEND_RANGES = ['today', 'week', 'all'] as const;
export type SpendRangeId = (typeof SPEND_RANGES)[number];

/** Someone who takes at least this share of a range's spend is worth a look, as in v2's payroll. */
const EXPENSIVE_SHARE = 0.25;
const EXPENSIVE_TURNS = 3;

export interface SpendLine {
  /** A person's id, or THE_OFFICE for the office's own questions and catch-ups. */
  person: string;
  /** As a row names them: their first name or title, the title their id spells once they have left, "The office". */
  name: string;
  /** Their room; null for the office and for people no longer in the company. */
  room: string | null;
  cost: number;
  /** Of the range's spend, 0 to 1. */
  share: number;
  /** Turns that ended in the range, counted from the newest turns the view keeps. */
  turns: number;
}

export interface SpendRoom {
  room: string;
  cost: number;
  share: number;
}

/** "Worth a look": the person, and what to try (the office shows their name before it, as v2 does). */
export interface SpendAdvice {
  person: string;
  message: string;
}

export interface SpendRange {
  id: SpendRangeId;
  /** Where it starts: local midnight, seven days ago, or the first spend the view holds. */
  from: number;
  spent: number;
  /** Who spent in it, most first, the office last. */
  people: SpendLine[];
  /** Rooms with spend, in the order their people come. The office and people who left count in `spent` only. */
  rooms: SpendRoom[];
  /** Spend per bucket: by the hour today, in a few hours over seven days, sized to the span for all of it. */
  series: Series;
  advice: SpendAdvice[];
}

export interface SpendBoard {
  billing: CompanyView['settings']['billing'];
  /** On a plan the figures are API-equivalent estimates; with an API key Claude Code reports what was billed. */
  estimate: boolean;
  /** The word v2 puts on money: "API-equivalent" for estimates, "Spend" for reported cost. */
  label: 'API-equivalent' | 'Spend';
  /** Dollars an hour over the last hour, from the turns that ended in it. */
  burn: { dollarsPerHour: number };
  today: SpendRange;
  week: SpendRange;
  all: SpendRange;
}

/**
 * The Spend dashboard. Today and 7 days take each person's totals from `spend.byPerson`; All takes each person's cost
 * from People, so it adds up to what the people's costs add up to, plus people who left and the office's own spend.
 */
export function spendBoard(view: CompanyView, now: number): SpendBoard {
  const { samples, hourly, byPerson } = view.spend;
  const people = new Map(view.people.map((p) => [p.id, p]));
  const totals = new Map(byPerson.map((p) => [p.person, p]));
  const spenders = unique([...view.people.map((p) => p.id), ...byPerson.map((p) => p.person)]).filter((id) => id !== THE_OFFICE && id !== STAKEHOLDER);
  const roomOrder = unique(view.people.map((p) => p.room));

  function range(id: SpendRangeId, from: number, costOf: (person: string) => number, series: Series): SpendRange {
    const turns = (person: string) => samples.filter((s) => s.person === person && s.at >= from && s.at <= now).length;
    const line = (person: string, p: PersonView | undefined): SpendLine => ({
      person,
      name: person === THE_OFFICE ? 'The office' : (p?.name ?? titleFromId(person)),
      room: p?.room ?? null,
      cost: money(costOf(person)),
      share: 0,
      turns: turns(person),
    });
    const lines = spenders
      .map((person) => line(person, people.get(person)))
      .filter((l) => l.cost > 0)
      .sort((a, b) => b.cost - a.cost);
    const office = line(THE_OFFICE, undefined);
    if (office.cost > 0) lines.push(office);
    const spent = lines.reduce((sum, l) => sum + l.cost, 0);
    for (const l of lines) l.share = spent > 0 ? l.cost / spent : 0;
    const rooms = roomOrder
      .map((room) => {
        const cost = lines.filter((l) => l.room === room).reduce((sum, l) => sum + l.cost, 0);
        return { room, cost, share: spent > 0 ? cost / spent : 0 };
      })
      .filter((r) => r.cost > 0);
    const named = lines.filter((l) => l.person !== THE_OFFICE);
    const advice =
      named.length < 2
        ? []
        : named
            .filter((l) => l.share >= EXPENSIVE_SHARE && l.turns >= EXPENSIVE_TURNS && canGoCheaper(people.get(l.person)))
            .map((l) => ({ person: l.person, message: `Takes ${Math.round(l.share * 100)}% of the spend. Try them on a cheaper model and keep it there if the work holds up.` }));
    return { id, from, spent, people: lines, rooms, series, advice };
  }

  // An hour's cost sits at the hour's start, or at the range's start for the hour the range begins in.
  const hours = (from: number): SeriesPoint[] => hourly.filter((h) => h.hour + HOUR_MS > from && h.hour <= now).map((h) => ({ at: Math.max(h.hour, from), value: money(h.cost) }));
  const today = startOfDay(now);
  const weekAgo = now - 7 * DAY_MS;
  // All of it: the hours the view keeps, and before them the turns it still holds from earlier.
  const hourlyFrom = hourly.length > 0 ? Math.min(...hourly.map((h) => h.hour)) : Number.POSITIVE_INFINITY;
  const earlier = samples.filter((s) => s.at < hourlyFrom).map((s) => ({ at: s.at, value: money(s.cost) }));
  const first = Math.min(now, hourlyFrom, ...samples.map((s) => s.at));

  const burn = samples.filter((s) => s.at > now - HOUR_MS && s.at <= now).reduce((sum, s) => sum + money(s.cost), 0);
  const estimate = view.settings.billing !== 'api-key';
  return {
    billing: view.settings.billing,
    estimate,
    label: estimate ? 'API-equivalent' : 'Spend',
    burn: { dollarsPerHour: burn },
    today: range('today', today, (p) => totals.get(p)?.today ?? 0, bucketed(today, now, hours(today))),
    week: range('week', weekAgo, (p) => totals.get(p)?.week ?? 0, bucketed(weekAgo, now, hours(weekAgo))),
    all: range('all', first, (p) => people.get(p)?.cost ?? totals.get(p)?.all ?? 0, bucketed(first, now, [...earlier, ...hours(first)])),
  };
}

/** Haiku is as cheap as models go; someone who has left can't be moved. */
const canGoCheaper = (p: PersonView | undefined) => p !== undefined && !/haiku/i.test(p.model);

// ---------------------------------------------------------------------------------------------------------------------
// Timeline

export type TimelineKind = 'status' | 'report' | 'question' | 'answer' | 'approval' | 'decision' | 'withdrawn' | 'message' | LogKind;

export interface TimelineEntry {
  /** The same from one snapshot to the next: "report:r-12", "status:kai:1762350000000". */
  id: string;
  at: number;
  /** Who the line starts with: a person's id, STAKEHOLDER or THE_OFFICE. */
  person: string;
  /** Everyone the line is about, its person first, for the "Who" filter. */
  people: string[];
  kind: TimelineKind;
  /** The line as one sentence, in outcome words: "You allowed Kai to push the work branch to GitHub, once." */
  text: string;
}

/** A log entry this close to a milestone done, or to a Stop you sent, tells that same event, which has its own line. */
const SAME_EVENT_MS = 5_000;

/**
 * The Timeline, newest first: status lines, reports, questions asked and answered (or withdrawn), approvals asked and
 * decided (or withdrawn), messages from you and to you and your messages passed on, milestones done, and the log of
 * what changed in the company. An approval tells its plain summary, never its command.
 */
export function timeline(view: CompanyView): TimelineEntry[] {
  const name = namesOf(view);
  const Name = (id: string) => capital(name(id));
  const entries: TimelineEntry[] = [];
  const used = new Map<string, number>();
  const add = (key: string, entry: Omit<TimelineEntry, 'id'>) => {
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    entries.push({ id: n === 0 ? key : `${key}:${n}`, ...entry });
  };

  for (const s of view.statuses) {
    add(`status:${s.person}:${s.at}`, { at: s.at, person: s.person, people: [s.person], kind: 'status', text: `${Name(s.person)}: ${sentence(shown(s.text, LINE_CHARS))}` });
  }

  for (const r of view.reports) {
    const to = name(r.to);
    const did = r.outcome === 'done' ? `finished and reported to ${to}` : r.outcome === 'blocked' ? `was blocked and told ${to}` : `reported progress to ${to}`;
    add(`report:${r.id}`, { at: r.at, person: r.person, people: unique([r.person, r.to]), kind: 'report', text: `${Name(r.person)} ${did}: ${shown(r.text, RESULT_CHARS)}` });
  }

  for (const q of view.questions) {
    add(`question:${q.id}`, { at: q.askedAt, person: q.from, people: [q.from], kind: 'question', text: `${Name(q.from)} asked you: ${shown(q.text, LINE_CHARS)}` });
    if (q.answer) {
      const option = q.answer.option;
      const choice = option !== null && Number.isInteger(option) && option >= 0 ? shown(q.options[option] ?? '', LINE_CHARS) : '';
      const words = shown(q.answer.text, LINE_CHARS);
      const what = choice && words ? `${choice} (${words})` : choice || words;
      add(`answer:${q.id}`, { at: q.answer.at, person: STAKEHOLDER, people: [STAKEHOLDER, q.from], kind: 'answer', text: `You answered ${name(q.from)}${what ? `: ${sentence(what)}` : '.'}` });
    } else if (q.withdrawn) {
      add(`withdrawn:${q.id}`, { at: q.withdrawn.at, person: q.from, people: [q.from], kind: 'withdrawn', text: `${Name(q.from)}'s question was withdrawn: ${sentence(shown(q.withdrawn.reason, LINE_CHARS))}` });
    }
  }

  for (const a of view.approvals) {
    const what = deed(a.summary) || 'go ahead';
    const who = name(a.person);
    add(`approval:${a.id}`, { at: a.askedAt, person: a.person, people: [a.person], kind: 'approval', text: `${Name(a.person)} asked for your OK to ${what}.` });
    if (a.answer) {
      const note = a.answer.note ? shown(a.answer.note, LINE_CHARS) : '';
      const text =
        a.answer.decision === 'allow'
          ? `You allowed ${who} to ${what}, ${a.answer.always ? 'and always from now on' : 'once'}.`
          : `You didn't allow ${who} to ${what}${note ? `: ${sentence(note)}` : '.'}`;
      add(`decision:${a.id}`, { at: a.answer.at, person: STAKEHOLDER, people: [STAKEHOLDER, a.person], kind: 'decision', text });
    } else if (a.withdrawn) {
      add(`withdrawn:${a.id}`, { at: a.withdrawn.at, person: a.person, people: [a.person], kind: 'withdrawn', text: `${Name(a.person)}'s request to ${what} was withdrawn: ${sentence(shown(a.withdrawn.reason, LINE_CHARS))}` });
    }
  }

  for (const m of view.messages) {
    const said = shown(m.text, RESULT_CHARS);
    if (m.from === STAKEHOLDER) {
      add(`message:${m.id}`, { at: m.at, person: STAKEHOLDER, people: [STAKEHOLDER, m.to], kind: 'message', text: `You ${m.interrupt ? 'stopped' : 'told'} ${name(m.to)}: ${said}` });
    } else if (m.to === STAKEHOLDER) {
      add(`message:${m.id}`, { at: m.at, person: m.from, people: [m.from, STAKEHOLDER], kind: 'message', text: `${Name(m.from)} told you: ${said}` });
    } else if (m.origin === STAKEHOLDER) {
      add(`message:${m.id}`, { at: m.at, person: m.from, people: unique([m.from, m.to, STAKEHOLDER]), kind: 'message', text: `${Name(m.from)} passed your message on to ${name(m.to)}.` });
    }
  }

  const milestonesDone = (view.goal?.milestones ?? []).flatMap((m) => (m.doneAt === null ? [] : [{ ...m, doneAt: m.doneAt }]));
  for (const m of milestonesDone) {
    add(`milestone:${m.id}`, { at: m.doneAt, person: THE_OFFICE, people: [THE_OFFICE], kind: 'milestone', text: `Milestone done: ${sentence(shown(m.title, LINE_CHARS))}` });
  }

  const stops = view.messages.filter((m) => m.from === STAKEHOLDER && m.interrupt).map((m) => m.at);
  const doneAt = milestonesDone.map((m) => m.doneAt);
  for (const e of view.log) {
    const told = e.kind === 'milestone' ? doneAt : e.kind === 'stop' ? stops : [];
    if (told.some((at) => Math.abs(at - e.at) <= SAME_EVENT_MS)) continue;
    add(`log:${e.kind}:${e.at}`, { at: e.at, person: e.by, people: [e.by], kind: e.kind, text: sentence(shown(e.text, RESULT_CHARS)) });
  }

  return entries.sort((a, b) => b.at - a.at);
}
