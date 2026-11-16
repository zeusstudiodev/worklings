// A message's trace in the office's words (SPEC-v3.md "Steering" 3, "See your message land"): the summary under each of
// your messages, who got it and through whom, each acknowledgement, what came of it, and where it stalls with Remind and
// Escalate. Pure, so it can be tested; TraceSummary and TraceView only draw it.
import { type CompanyView, managerOf, type Message, type PersonView, STAKEHOLDER, THE_OFFICE } from '../../../../src/core/company.ts';
import { clip, coarseDuration, countWord, plainText } from '../../../../src/core/now.ts';
import type { Ack, MessageTrace, TraceCite, TraceFlag, TraceStop } from '../../../../src/core/steering.ts';
import { familyOf, type MessageFamily } from '../../../../src/core/trace.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute } from '../../lib/format.ts';
import { atWords, daysAgo } from '../dashboards/boardsModel.ts';
import { endSentence, introduced, nameOf } from '../people/peopleModel.ts';
import { deliveryLine } from '../person/personModel.ts';
import type { StateTone } from '../ui/tone.ts';

/** What the trace's words read from the view. */
export type TraceCompany = Pick<CompanyView, 'people' | 'messages' | 'tasks' | 'reports' | 'statuses' | 'pause' | 'phase' | 'steering'>;

/**
 * A copy still on its way this long after it was sent counts as stalled: time for a busy person's next step, or for a
 * relay's two. Until then a flag reads as the message being on its way, without Remind or Escalate.
 */
export const TRANSIT_MS = 5 * 60_000;

/** The address of a message's trace under the company. */
export const tracePath = (message: string): string => `messages/${encodeURIComponent(message)}`;

/** "Ada", "Ada and Mina", "Ada, Mina and Jules"; past `max`, "Ada, Mina and three others". */
export function listOf(names: readonly string[], max = 3): string {
  if (names.length === 0) return '';
  const shown = names.length > max ? [...names.slice(0, max - 1), `${countWord(names.length - max + 1)} others`] : [...names];
  return shown.length === 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** A time beside a fact, as the thread says it: "14:32" today, "yesterday at 14:32", "on Mon 3 Nov at 14:32". */
export function whenWords(at: number, now: number): string {
  return daysAgo(at, now) === 0 ? hourMinute(at) : atWords(at, now);
}

const said = (text: string, max: number): string => clip(plainText(text), max);
const called = (company: Pick<CompanyView, 'people'>, id: string): string => nameOf(company, id).called;
const Called = (company: Pick<CompanyView, 'people'>, id: string): string => capital(called(company, id));

// ---------------------------------------------------------------------------------------------------------------
// How far it got

export type TraceState = 'gone' | 'on-its-way' | 'landing' | 'reached' | 'acknowledged' | 'disagreement' | 'stalled';

export interface TraceRead {
  state: TraceState;
  /** Everyone with a copy and everyone it is for: the people it should reach. */
  expected: string[];
  reached: string[];
  agreed: string[];
  disagreed: string[];
  /** Flags past their settling time: these get Remind and Escalate. */
  stalled: TraceFlag[];
  /** Flags still settling: the message is on its way there. */
  settling: TraceFlag[];
  /** One person, sent to them directly and passed on to nobody: their conversation's own delivery line says the rest. */
  single: boolean;
}

/** A flag that waits for delivery stalls only after TRANSIT_MS; an acknowledgement's flags have waited their window. */
export const isStalled = (flag: TraceFlag, now: number): boolean => (flag.kind === 'not-delivered' || flag.kind === 'not-reached' ? now - flag.since >= TRANSIT_MS : true);

const newer = (a: Ack | null, b: Ack | null): Ack | null => (!a ? b : !b ? a : b.at >= a.at ? b : a);

export function readTrace(trace: MessageTrace, now: number): TraceRead {
  const people = new Map<string, { reached: boolean; ack: Ack | null }>();
  for (const s of trace.stops) {
    const at = people.get(s.person) ?? { reached: false, ack: null };
    people.set(s.person, { reached: at.reached || s.deliveredAt !== null, ack: newer(at.ack, s.ack) });
  }
  for (const f of trace.flags) if (f.kind === 'not-reached' && !people.has(f.person)) people.set(f.person, { reached: false, ack: null });
  const expected = [...people.keys()];
  const reached = expected.filter((id) => people.get(id)?.reached);
  const agreed = expected.filter((id) => people.get(id)?.ack?.agree === true);
  const disagreed = expected.filter((id) => people.get(id)?.ack?.agree === false);
  const stalled = trace.flags.filter((f) => isStalled(f, now));
  const settling = trace.flags.filter((f) => !isStalled(f, now));
  const single = trace.stops.length === 1 && trace.stops[0]?.via === null && expected.length === 1;
  const state: TraceState =
    expected.length === 0
      ? 'gone'
      : stalled.length > 0
        ? 'stalled'
        : disagreed.length > 0
          ? 'disagreement'
          : agreed.length === expected.length
            ? 'acknowledged'
            : reached.length === expected.length
              ? 'reached'
              : reached.length > 0
                ? 'landing'
                : 'on-its-way';
  return { state, expected, reached, agreed, disagreed, stalled, settling, single };
}

const people = (n: number): string => `${countWord(n)} ${n === 1 ? 'person' : 'people'}`;

/**
 * Where it stands in one to three short sentences: "Reached three of four people. Two acknowledged it. It stalls with
 * Ada." One person reads as them: "Kai acknowledged it.", "Mina disagrees.", "On its way to the CEO."
 */
export function summaryOf(company: Pick<CompanyView, 'people'>, trace: MessageTrace, read: TraceRead): string {
  const n = read.expected.length;
  if (n === 0) return "That message isn't in the office's view any more.";
  if (n === 1) {
    const id = read.expected[0] ?? '';
    const flag = read.stalled[0];
    if (flag) return flag.sentence;
    if (read.agreed.length === 1) return `${Called(company, id)} acknowledged it.`;
    if (read.disagreed.length === 1) return `${Called(company, id)} disagrees.`;
    return read.reached.length === 1 ? `Reached ${called(company, id)}. No acknowledgement yet.` : `On its way to ${called(company, id)}.`;
  }
  const parts: string[] = [];
  const k = read.reached.length;
  parts.push(k === 0 ? `On its way to ${people(n)}.` : k === n ? (n === 2 ? 'Reached both people.' : `Reached all ${people(n)}.`) : `Reached ${countWord(k)} of ${people(n)}.`);
  const agreed = read.agreed.length;
  const disagreed = read.disagreed.length;
  if (disagreed > 0) {
    const who = disagreed <= 2 ? listOf(read.disagreed.map((id) => called(company, id))) : countWord(disagreed);
    const verb = disagreed === 1 ? 'disagrees' : 'disagree';
    parts.push(capital(agreed > 0 ? `${countWord(agreed)} acknowledged it, and ${who} ${verb}.` : `${who} ${verb}.`));
  } else if (agreed > 0) {
    parts.push(agreed === n ? (n === 2 ? 'Both acknowledged it.' : `All ${countWord(n)} acknowledged it.`) : `${capital(countWord(agreed))} acknowledged it.`);
  } else if (k > 0) {
    parts.push('No acknowledgements yet.');
  }
  const holders = [...new Set(read.stalled.map((f) => f.holder))];
  if (holders.length > 0) parts.push(`It stalls with ${listOf(holders.map((id) => called(company, id)), 2)}.`);
  return parts.join(' ');
}

/** "Cited by a task and two reports." */
export function citedBy(cites: readonly TraceCite[]): string | null {
  if (cites.length === 0) return null;
  const NOUNS: Record<TraceCite['kind'], [string, string]> = {
    task: ['a task', 'tasks'],
    commit: ['a commit', 'commits'],
    report: ['a report', 'reports'],
    status: ['a status line', 'status lines'],
    decision: ['a decision', 'decisions'],
    plan: ['a plan version', 'plan versions'],
  };
  const counts = new Map<TraceCite['kind'], number>();
  for (const c of cites) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const words = [...counts].map(([kind, count]) => (count === 1 ? NOUNS[kind][0] : `${countWord(count)} ${NOUNS[kind][1]}`));
  return `Cited by ${listOf(words, 6)}.`;
}

export interface SummaryLine {
  text: string;
  tone: 'quiet' | 'disagree' | 'stalled';
  /** Offer "Where it went": there is more to see than the line says. */
  link: boolean;
}

/**
 * The line under one of your messages in a conversation, or null when the conversation's delivery line already says it
 * all (one person, sent to them directly, no acknowledgement, nothing stalled and nothing citing it yet).
 */
export function summaryLine(company: Pick<CompanyView, 'people'>, trace: MessageTrace, now: number): SummaryLine | null {
  const read = readTrace(trace, now);
  if (read.state === 'gone') return null;
  const tone: SummaryLine['tone'] = read.state === 'stalled' ? 'stalled' : read.state === 'disagreement' ? 'disagree' : 'quiet';
  const cites = citedBy(trace.cites);
  if (read.single) {
    const stop = trace.stops[0];
    if (read.state === 'stalled') return { text: summaryOf(company, trace, read), tone, link: true };
    if (stop?.ack) {
      const who = Called(company, stop.person);
      const words = said(stop.ack.text, 160);
      return { text: `${who} ${stop.ack.agree ? 'acknowledged it' : 'disagrees'}: “${words}”${cites ? ` ${cites}` : ''}`, tone, link: cites !== null };
    }
    return cites ? { text: cites, tone, link: true } : null;
  }
  return { text: summaryOf(company, trace, read), tone, link: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The trace's page

export interface MessageHead {
  /** "Your message" or "Ada's message". */
  whose: string;
  /** "To the design room at 14:32." */
  to: string;
  /** "For Mina and Jules." */
  for: string | null;
  text: string;
  /** Where Back goes when the page was opened from outside: the conversation it was sent in. */
  back: string;
}

export function messageHead(company: TraceCompany, family: MessageFamily, now: number): MessageHead | null {
  const root = family.root;
  if (!root) return null;
  // "To Kai, frontend engineer, at 13:30.": the title's closing comma before the time.
  const to = root.audience ? root.audience.title : nameOf(company, root.to).subject;
  const wanted = [...new Set(family.copies.flatMap((m) => m.for ?? []))];
  return {
    whose: root.from === STAKEHOLDER ? 'Your message' : `${Called(company, root.from)}'s message`,
    to: `To ${to} ${atWords(root.at, now)}.`,
    for: wanted.length > 0 ? `For ${listOf(wanted.map((id) => called(company, id)), 6)}.` : null,
    text: plainText(root.text),
    back: root.audience || root.to === STAKEHOLDER ? '' : `people/${encodeURIComponent(root.to)}`,
  };
}

export interface StopRow {
  key: string;
  person: string;
  /** "Ada, head of design". */
  name: string;
  /** In from the left, one step per relay. */
  depth: number;
  word: { text: string; tone: StateTone };
  /** "Delivered 14:33 at Ada's next step." or "Waits for a desk, second in line." */
  delivery: string;
  /** "Passed on by the CEO at 14:30." */
  via: string | null;
  /** What the person who passed it on added: "Ada added: “Try a deeper espresso brown.”" */
  note: string | null;
  ack: { agree: boolean; text: string; when: string } | null;
}

function deliveredWords(company: TraceCompany, stop: TraceStop, message: Message | undefined, now: number): string {
  const name = called(company, stop.person);
  if (stop.deliveredAt !== null) {
    const when = whenWords(stop.deliveredAt, now);
    if (stop.how === 'next-step') return `Delivered ${when} at ${name}'s next step.`;
    if (stop.how === 'new-turn') return `Delivered ${when}: ${name} started on it.`;
    return `Delivered ${when}.`;
  }
  const p: PersonView | undefined = company.people.find((x) => x.id === stop.person);
  if (!p) return `Not delivered: ${name} has left the company.`;
  return message ? deliveryLine(message, company, p).text : 'Not delivered yet.';
}

/** Who got it, in the order it travelled: each copy, with the relays it passed through under the person who passed them. */
export function stopRows(company: TraceCompany, trace: MessageTrace, now: number): StopRow[] {
  const messages = new Map(company.messages.map((m) => [m.id, m]));
  const holders = new Set(trace.stops.map((s) => s.person));
  const first = new Map<string, TraceStop>();
  for (const s of trace.stops) if (!first.has(s.person)) first.set(s.person, s);
  const passedBy = new Map<string, TraceStop[]>();
  const roots: TraceStop[] = [];
  for (const s of trace.stops) {
    if (s.via === null || !holders.has(s.via) || s.via === s.person) roots.push(s);
    else passedBy.set(s.via, [...(passedBy.get(s.via) ?? []), s]);
  }
  const rows: StopRow[] = [];
  const placed = new Set<string>();
  const place = (s: TraceStop, depth: number) => {
    if (placed.has(s.message)) return;
    placed.add(s.message);
    const m = messages.get(s.message);
    const stalled = s.deliveredAt === null && m !== undefined && now - m.at >= TRANSIT_MS;
    const word: StopRow['word'] = s.ack
      ? s.ack.agree
        ? { text: 'Acknowledged', tone: 'done' }
        : { text: 'Disagrees', tone: 'needs' }
      : s.deliveredAt !== null
        ? { text: 'Delivered', tone: 'neutral' }
        : stalled
          ? { text: 'Not delivered', tone: 'error' }
          : { text: 'On its way', tone: 'waiting' };
    const person = nameOf(company, s.person);
    rows.push({
      key: s.message,
      person: s.person,
      name: capital(person.person ? introduced(person.person) : person.called),
      depth,
      word,
      delivery: deliveredWords(company, s, m, now),
      via: s.via && m ? `Passed on by ${called(company, s.via)} ${atWords(m.at, now)}.` : null,
      note: s.via && m?.note ? `${Called(company, s.via)} added: “${said(m.note, 400)}”` : null,
      ack: s.ack ? { agree: s.ack.agree, text: said(s.ack.text, 300), when: whenWords(s.ack.at, now) } : null,
    });
    // A person's relays hang under their first copy only, so someone who got it twice doesn't repeat what they passed on.
    if (first.get(s.person) !== s) return;
    for (const next of passedBy.get(s.person) ?? []) place(next, depth + 1);
  };
  for (const s of roots) place(s, 0);
  for (const s of trace.stops) place(s, 0);
  return rows;
}

export interface FlagRow {
  /** One row per holder: everything stalled with them, so Remind and Escalate show once for each. */
  key: string;
  kinds: TraceFlag['kind'][];
  /** "Ada hasn't passed it on or acknowledged it yet.", "Not passed on to Mina yet." */
  sentences: string[];
  /** "For 24 min.", from the oldest. */
  age: string;
  /** Who Remind nudges. */
  holder: { id: string; name: string };
  /** "Ada has it." when only others' flags wait with them. */
  holds: string | null;
  /** Who Escalate tells: the holder's manager, or the CEO; nobody above the CEO. */
  escalateTo: { id: string; name: string } | null;
  /** "You reminded Ada at 14:40." */
  followed: string | null;
}

/** Who Escalate tells about someone: their manager, else the CEO; null for the CEO themselves. */
export function escalateTarget(company: Pick<CompanyView, 'people'>, holder: string): string | null {
  const manager = managerOf(company.people, holder);
  if (manager) return manager.id;
  const ceo = company.people.find((p) => p.level === 'ceo');
  return ceo && ceo.id !== holder ? ceo.id : null;
}

/** The newest follow-up that went to someone, in words: "You reminded Ada at 14:40." */
function followedWords(company: TraceCompany, family: MessageFamily, holder: string, escalateTo: string | null, now: number): string | null {
  let latest: Message | undefined;
  for (const m of family.followUps) {
    if (m.from !== STAKEHOLDER && m.from !== THE_OFFICE) continue;
    if (m.to !== holder && m.to !== escalateTo) continue;
    if (!latest || m.at >= latest.at) latest = m;
  }
  if (!latest) return null;
  const who = latest.from === STAKEHOLDER ? 'You' : 'The office';
  const what = latest.to === holder ? `reminded ${called(company, holder)}` : `escalated to ${called(company, latest.to)}`;
  return `${who} ${what} ${atWords(latest.at, now)}.`;
}

export function flagRows(company: TraceCompany, trace: MessageTrace, flags: readonly TraceFlag[], now: number): FlagRow[] {
  const family = familyOf(company.messages, trace.message);
  const byHolder = new Map<string, TraceFlag[]>();
  for (const f of flags) byHolder.set(f.holder, [...(byHolder.get(f.holder) ?? []), f]);
  return [...byHolder].map(([holder, held]) => {
    const escalateTo = escalateTarget(company, holder);
    // Their own flag first: it says what they haven't done; then who it hasn't reached through them.
    const ordered = [...held].sort((a, b) => Number(b.person === holder) - Number(a.person === holder) || a.since - b.since);
    const since = Math.min(...held.map((f) => f.since));
    return {
      key: `holder:${holder}`,
      kinds: ordered.map((f) => f.kind),
      sentences: ordered.map((f) => f.sentence),
      age: `For ${coarseDuration(now - since)}.`,
      holder: { id: holder, name: called(company, holder) },
      holds: held.some((f) => f.person === holder) ? null : `${Called(company, holder)} has it.`,
      escalateTo: escalateTo ? { id: escalateTo, name: called(company, escalateTo) } : null,
      followed: followedWords(company, family, holder, escalateTo, now),
    };
  });
}

export interface ForRow {
  person: string;
  name: string;
  line: string;
}

/** The people it is for, and whether it reached them. */
export function forRows(company: TraceCompany, trace: MessageTrace, now: number): ForRow[] {
  const family = familyOf(company.messages, trace.message);
  const wanted = [...new Set(family.copies.flatMap((m) => m.for ?? []))];
  return wanted.map((id) => {
    const name = Called(company, id);
    const reached = trace.stops.filter((s) => s.person === id && s.deliveredAt !== null).sort((a, b) => (a.deliveredAt ?? 0) - (b.deliveredAt ?? 0))[0];
    const flag = trace.flags.find((f) => f.person === id && f.kind === 'not-reached');
    let line: string;
    if (reached?.deliveredAt != null) line = `Reached ${whenWords(reached.deliveredAt, now)}.`;
    else if (trace.stops.some((s) => s.person === id)) line = 'On its way.';
    else if (flag) line = `Not reached yet. ${Called(company, flag.holder)} has it.`;
    else line = company.people.some((p) => p.id === id) ? 'Not reached yet.' : 'Has left the company.';
    return { person: id, name, line };
  });
}

export interface CiteRow {
  key: string;
  text: string;
  when: string;
  /** Where the thing it names opens; null when the office no longer shows it. */
  path: string | null;
}

/** The plan's address for a version: the plan's route, `plan/v3` (address.ts). */
export const planPath = (version: number): string => `plan/v${version}`;
/** A decision's place in the decision log. */
export const decisionPath = (decision: string): string => `decisions/${encodeURIComponent(decision)}`;

export function citeRows(company: TraceCompany, trace: MessageTrace, now: number): CiteRow[] {
  const enc = encodeURIComponent;
  return trace.cites.map((c) => {
    let path: string | null = null;
    switch (c.kind) {
      case 'task':
        path = company.tasks.some((t) => t.id === c.id) ? `tasks/${enc(c.id)}` : null;
        break;
      case 'commit': {
        const task = company.tasks.find((t) => t.commit === c.id);
        path = task ? `tasks/${enc(task.id)}` : null;
        break;
      }
      case 'report': {
        const r = company.reports.find((x) => x.id === c.id);
        path = r?.taskId && company.tasks.some((t) => t.id === r.taskId) ? `tasks/${enc(r.taskId)}` : company.people.some((p) => p.id === c.by) ? `people/${enc(c.by)}` : null;
        break;
      }
      case 'status':
        path = company.people.some((p) => p.id === c.by) ? `people/${enc(c.by)}` : null;
        break;
      case 'decision':
        path = decisionPath(c.id);
        break;
      case 'plan':
        path = planPath(Number(c.id));
        break;
    }
    return { key: `${c.kind}:${c.id}:${c.at}`, text: c.text, when: whenWords(c.at, now), path };
  });
}

/** Follow-ups that cite it: your reminders and escalations, and replies. */
export function followUpRows(company: TraceCompany, trace: MessageTrace, now: number): { key: string; text: string }[] {
  return familyOf(company.messages, trace.message).followUps.map((m) => {
    const when = atWords(m.at, now);
    let text: string;
    if (m.from === STAKEHOLDER) text = `You followed up with ${called(company, m.to)} ${when}.`;
    else if (m.from === THE_OFFICE) text = `The office followed up with ${called(company, m.to)} ${when}.`;
    else if (m.to === STAKEHOLDER) text = `${Called(company, m.from)} replied ${when}: ${endSentence(said(m.text, 200))}`;
    else text = `${Called(company, m.from)} wrote to ${called(company, m.to)} about it ${when}.`;
    return { key: m.id, text };
  });
}
