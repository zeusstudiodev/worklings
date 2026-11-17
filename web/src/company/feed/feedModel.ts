// The company's conversation as lines (docs/design-v3.md, "Stage and dock", "The live strip" and "The feed"): your
// messages, replies, your words passed on, acknowledgements, stalls, what needs you, someone stuck, work, talk between
// people, decisions and the company's own log, each as the strip says it and as the feed says it. Never status lines,
// tool calls or steps. Worked out from the view alone; pure, so it can be tested. The strip and the feed only draw it.
import { type CompanyView, type Message, type PersonView, STAKEHOLDER, THE_OFFICE } from '../../../../src/core/company.ts';
import { endsInQuestion, isTurnStopped } from '../../../../src/core/plain.ts';
import { clip, countWord, plainText } from '../../../../src/core/now.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import type { Decision } from '../../../../src/core/steering.ts';
import { traceOf } from '../../../../src/core/trace.ts';
import { capital } from '../../../../src/core/words.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { inboxItemPath } from '../inbox/inboxModel.ts';
import { called, endSentence, nameOf, STUCK_AFTER_MS, workOf } from '../people/peopleModel.ts';
import { answerSentence } from '../person/personModel.ts';
import { approveChoices, doneMilestones } from '../plan/planModel.ts';
import { decisionPath, isStalled, planPath, tracePath, TRANSIT_MS } from '../trace/traceModel.ts';

export type LineKind =
  | 'yours'
  | 'reply'
  | 'passed'
  | 'ack'
  | 'disagree'
  | 'stall'
  | 'asks'
  | 'approval'
  | 'plan'
  | 'stuck'
  | 'report'
  | 'assigned'
  | 'between'
  | 'decision'
  | 'company'
  /** Four or more acknowledgements of one message within a minute, folded into one. */
  | 'burst';

/** A sentence's pieces: words, and names that open the person. */
export type Seg = string | { person: string; text: string };

export interface FeedLine {
  /** Stable from one view to the next: the strip keeps a line by it, and the feed's New rule sits by it. */
  id: string;
  kind: LineKind;
  at: number;
  /** Who speaks (a person's id, STAKEHOLDER or THE_OFFICE), and who to for a hop, for the faces. */
  from: string;
  to: string | null;
  /** The strip's line: "You to Mara:" in 600, then the words. */
  lead: string;
  words: string;
  /** The feed's sentence over the words, names as people to open: "You wrote to Mara, CEO", "Mara replied". */
  sentence: Seg[];
  /** The words under it: theirs, a relay's note in quotes; null when the sentence says it all. */
  body: string | null;
  /** Your words travel in it: the paper mark. */
  yours: boolean;
  /** Needs you (the highlighter) or someone stuck (the danger tint). */
  tone: 'plain' | 'needs' | 'stuck';
  /** What it opens from the feed: a path under the company and its words. */
  link: { path: string; label: string } | null;
  /** The message it is about (the first of its family), so a burst folds by it. */
  about: string | null;
  /** In a burst: everyone in it, for the faces. */
  who?: string[];
  /** In a burst: the lines it folds, for "Show them". */
  members?: FeedLine[];
  /** The question or approval a line is about (its id), so the feed answers it in place. */
  item: string | null;
}

/** What a line says when it is added: the fields that have a plain default may be left out. */
type DefaultedField = 'yours' | 'tone' | 'link' | 'about' | 'to' | 'body' | 'item';
type LineInit = Omit<FeedLine, DefaultedField> & Partial<Pick<FeedLine, DefaultedField>>;

type Company = CompanyView;
type Studio = Pick<Snapshot, 'studio'>;

/** How much of someone's words a line keeps: the strip cuts it to its width, the feed shows six lines of it. */
const WORDS_MAX = 600;
/** Your messages the stall lines follow: the newest few; older ones are the trace's. */
const STALLS_FOLLOWED = 12;

const words = (text: string): string => clip(plainText(text), WORDS_MAX);

/** Short, as the strip names people: a first name, "the QA engineer", "you", "the office". */
function short(company: Pick<CompanyView, 'people'>, id: string): string {
  if (id === STAKEHOLDER) return 'you';
  const p = company.people.find((x) => x.id === id);
  if (!p) return nameOf(company, id).called;
  return p.name !== p.title ? p.name : called(p);
}

/** Whole, as the feed introduces someone: "Mara, CEO", "the QA engineer". */
function whole(company: Pick<CompanyView, 'people'>, id: string): string {
  const p = company.people.find((x) => x.id === id);
  if (!p) return nameOf(company, id).introduced;
  return p.name !== p.title ? personLabel(p) : called(p);
}

const Short = (company: Pick<CompanyView, 'people'>, id: string) => capital(short(company, id));

/** The comma that closes "Mina, UI designer," before a verb. */
const closing = (introduced: string): string => (introduced.includes(',') ? ',' : '');

/** A name that opens the person, or plain words for you, the office and someone who left. */
const named = (company: Pick<CompanyView, 'people'>, id: string, text: string, first = false): Seg => {
  const shown = first ? capital(text) : text;
  return company.people.some((p) => p.id === id) ? { person: id, text: shown } : shown;
};

/** The first message of a message's family: the one it passes on, and on back. */
function rootOf(byId: ReadonlyMap<string, Message>, m: Message): Message {
  const seen = new Set<string>();
  let at = m;
  while (at.relayOf && !seen.has(at.id)) {
    seen.add(at.id);
    const next = byId.get(at.relayOf);
    if (!next) break;
    at = next;
  }
  return at;
}

/** The same words, minus Markdown, spacing and case. */
const sameWords = (a: string, b: string) => plainText(a).replace(/\s+/g, ' ').trim().toLowerCase() === plainText(b).replace(/\s+/g, ' ').trim().toLowerCase();

/** Every line the view holds, oldest first. */
export function feedLines(snapshot: Studio, company: Company, now: number): FeedLine[] {
  const lines: FeedLine[] = [];
  const byId = new Map(company.messages.map((m) => [m.id, m]));
  const groupsSeen = new Set<string>();
  const add = (line: LineInit) => lines.push({ yours: false, tone: 'plain', link: null, about: null, to: null, body: null, item: null, ...line });
  const yourIds = new Set(company.messages.filter((m) => m.from === STAKEHOLDER).map((m) => m.id));
  const keyOf = threadKeys(company);
  // The questions whose answer the feed also holds as a decision line (with its link): the message that carried the same
  // answer adds nothing, so the answer reads once.
  const decided = new Set((company.steering?.decisions ?? []).flatMap((d) => (d.kind === 'answer' && d.links.question ? [d.links.question] : [])));

  for (const m of company.messages) {
    if (m.from === STAKEHOLDER) {
      // A message to a room, a team or everyone is one line, however many copies it has.
      const group = m.audience?.group ?? null;
      if (group !== null) {
        if (groupsSeen.has(group)) continue;
        groupsSeen.add(group);
      }
      const to = m.audience ? m.audience.title : whole(company, m.to);
      const toShort = m.audience ? m.audience.title : short(company, m.to);
      // v0.3: the studio chat writes in the office's hand, never as you.
      if (m.fromStudio === true) {
        add({
          id: `m:${m.id}`, kind: 'company', at: m.at, from: STAKEHOLDER, to: m.to, lead: `Studio chat to ${toShort}:`, words: words(m.text),
          sentence: ['The studio chat wrote to ', named(company, m.to, to)], body: words(m.text), about: m.id,
        });
        continue;
      }
      const answered = answerSentence(company, m);
      if (answered !== null) {
        if (m.answers && decided.has(m.answers)) continue;
        add({ id: `m:${m.id}`, kind: 'yours', at: m.at, from: STAKEHOLDER, to: m.to, lead: `You to ${toShort}:`, words: answered, sentence: [answered], yours: true, about: m.id });
        continue;
      }
      const sentence: Seg[] = m.interrupt ? ['You stopped ', named(company, m.to, to)] : m.audience ? [`You wrote to ${to}`] : ['You wrote to ', named(company, m.to, to)];
      add({
        id: `m:${group ?? m.id}`,
        kind: 'yours',
        at: m.at,
        from: STAKEHOLDER,
        to: m.audience ? null : m.to,
        lead: m.interrupt ? `You stopped ${toShort}:` : `You to ${toShort}:`,
        words: words(m.text),
        sentence,
        body: words(m.text),
        yours: true,
        link: { path: tracePath(group ?? m.id), label: 'Where it went' },
        about: m.id,
      });
      continue;
    }
    if (m.from === THE_OFFICE) continue;
    if (m.to === STAKEHOLDER) {
      const citedId = (m.cites ?? []).find((id) => yourIds.has(id)) ?? null;
      const cited = m.turnReply === true || citedId !== null;
      add({
        id: `m:${m.id}`,
        kind: 'reply',
        at: m.at,
        from: m.from,
        to: STAKEHOLDER,
        lead: `${Short(company, m.from)} to you:`,
        words: words(m.text),
        sentence: [named(company, m.from, short(company, m.from), true), cited ? ' replied' : ' wrote to you'],
        body: words(m.text),
        link: { path: `people/${encodeURIComponent(m.from)}`, label: 'Reply' },
        about: citedId === null ? null : (keyOf.get(citedId) ?? citedId),
      });
      continue;
    }
    if (m.to === THE_OFFICE) continue;
    if (m.relayOf && m.origin === STAKEHOLDER) {
      const root = rootOf(byId, m);
      const first = root.from === STAKEHOLDER && m.relayOf === root.id;
      const note = m.note ? words(m.note) : root.from === STAKEHOLDER && !sameWords(root.text, m.text) ? words(m.text) : null;
      const passed = note ?? `“${words(root.from === STAKEHOLDER ? root.text : m.text)}”`;
      add({
        id: `m:${m.id}`,
        kind: 'passed',
        at: m.at,
        from: m.from,
        to: m.to,
        lead: `${Short(company, m.from)} to ${short(company, m.to)}:`,
        words: passed,
        sentence: first
          ? [named(company, m.from, short(company, m.from), true), ' passed your message on to ', named(company, m.to, whole(company, m.to))]
          : [named(company, m.from, short(company, m.from), true), ' passed it on to ', named(company, m.to, whole(company, m.to))],
        body: note ? `“${note}”` : null,
        yours: true,
        about: keyOf.get(root.id) ?? root.id,
      });
      continue;
    }
    add({
      id: `m:${m.id}`,
      kind: 'between',
      at: m.at,
      from: m.from,
      to: m.to,
      lead: `${Short(company, m.from)} to ${short(company, m.to)}:`,
      words: words(m.text),
      sentence: [named(company, m.from, short(company, m.from), true), ' wrote to ', named(company, m.to, short(company, m.to))],
      body: words(m.text),
    });
  }

  ackLines(company, byId, keyOf, add);
  stallLines(company, now, keyOf, add);
  needsLines(company, now, add);
  workLines(company, now, add);
  decisionLines(company, keyOf, add);
  logLines(company, add);
  return lines.map((l, i) => ({ l, i })).sort((a, b) => a.l.at - b.l.at || a.i - b.i).map((x) => x.l);
}

type Add = (line: LineInit) => void;

/** The message each copy of a room's message hangs under: the first copy, which is the one line the feed writes. */
function threadKeys(company: Company): Map<string, string> {
  const first = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const m of company.messages) {
    const group = m.from === STAKEHOLDER ? (m.audience?.group ?? null) : null;
    if (group === null) continue;
    const head = first.get(group) ?? m.id;
    first.set(group, head);
    keys.set(m.id, head);
  }
  return keys;
}

function ackLines(company: Company, byId: ReadonlyMap<string, Message>, keyOf: ReadonlyMap<string, string>, add: Add): void {
  for (const a of company.steering?.acks ?? []) {
    const m = byId.get(a.message);
    const root = m ? rootOf(byId, m) : null;
    const yours = root?.from === STAKEHOLDER;
    const whose = yours ? 'your message' : root ? `${possessiveOf(company, root.from)} message` : 'a message';
    add({
      id: `ack:${a.id}`,
      kind: a.agree ? 'ack' : 'disagree',
      at: a.at,
      from: a.by,
      lead: a.agree ? `${Short(company, a.by)} acknowledged:` : `${Short(company, a.by)} disagrees:`,
      words: words(a.text),
      sentence: [named(company, a.by, short(company, a.by), true), a.agree ? ` acknowledged ${whose}` : ` disagrees with ${whose}`],
      body: words(a.text),
      about: root ? (keyOf.get(root.id) ?? root.id) : a.message,
    });
  }
}

const possessiveOf = (company: Pick<CompanyView, 'people'>, id: string): string => `${short(company, id)}'s`;

/** "Your message hasn't reached Mina yet. Ada has it.": once a copy has been on its way too long. */
function stallLines(company: Company, now: number, keyOf: ReadonlyMap<string, string>, add: Add): void {
  const roots = company.messages.filter((m) => m.from === STAKEHOLDER && !m.answers && !m.fromOffice);
  const followed = new Map<string, Message>();
  for (const m of [...roots].reverse()) {
    const key = m.audience?.group ?? m.id;
    if (!followed.has(key)) followed.set(key, m);
    if (followed.size >= STALLS_FOLLOWED) break;
  }
  for (const [key, m] of followed) {
    const trace = traceOf(company, m.id, now);
    for (const flag of trace.flags) {
      if (!isStalled(flag, now) || flag.kind === 'no-ack') continue;
      // Someone else holds it (it hasn't been passed on to them), or it waits with them, or they haven't passed it on.
      const holder = flag.holder !== flag.person && flag.holder !== STAKEHOLDER ? flag.holder : null;
      const person = short(company, flag.person);
      const said =
        flag.kind === 'not-passed-on'
          ? `${capital(person)} hasn't passed your message on yet.`
          : `Your message hasn't reached ${person} yet.${holder ? ` ${Short(company, holder)} has it.` : ''}`;
      add({
        id: `stall:${key}:${flag.person}`,
        kind: 'stall',
        at: flag.since + TRANSIT_MS,
        from: holder ?? flag.person,
        lead: '',
        words: said,
        sentence:
          flag.kind === 'not-passed-on'
            ? [named(company, flag.person, person, true), " hasn't passed your message on yet."]
            : [`Your message to ${m.audience ? m.audience.title : short(company, m.to)} hasn't reached `, named(company, flag.person, person), ' yet.'],
        body: holder ? `${capital(minutes(now - flag.since))}. ${Short(company, holder)} has it.` : `${capital(minutes(now - flag.since))}. ${flag.sentence}`,
        yours: true,
        link: { path: tracePath(key), label: 'Where it went' },
        about: keyOf.get(m.id) ?? m.id,
      });
    }
  }
}

const minutes = (ms: number): string => {
  const m = Math.max(1, Math.floor(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
};

/** Questions, approvals and the plan waiting: on the highlighter while they wait. */
function needsLines(company: Company, now: number, add: Add): void {
  for (const q of company.questions) {
    const open = q.answer === null && q.withdrawn === null;
    const gate = q.gate ? company.tasks.find((t) => t.id === q.gate?.task) : undefined;
    // v0.8: a plain session's last words ask you only when they end in a question.
    const verb = q.plainTurn !== true || endsInQuestion(q.text) ? 'asks you' : isTurnStopped(q.text) ? 'stopped its turn' : 'finished its turn';
    add({
      id: `q:${q.id}`,
      kind: 'asks',
      at: q.askedAt,
      from: gate ? THE_OFFICE : q.from,
      lead: gate ? `The office asks before ${short(company, q.from)} starts:` : `${Short(company, q.from)} ${verb}:`,
      words: gate ? `“${clip(plainText(gate.title), 80)}”` : words(q.text),
      sentence: gate
        ? ['The office asks before ', named(company, q.from, short(company, q.from)), ` starts “${clip(plainText(gate.title), 80)}”`]
        : [named(company, q.from, whole(company, q.from), true), `${closing(whole(company, q.from))} ${verb}`],
      body: words(q.text),
      tone: open ? 'needs' : 'plain',
      link: open ? { path: inboxItemPath(q.id), label: verb === 'asks you' ? 'Answer' : 'Reply' } : null,
      item: q.id,
    });
  }
  for (const a of company.approvals) {
    const open = a.answer === null && a.withdrawn === null && now < a.expiresAt;
    add({
      id: `a:${a.id}`,
      kind: 'approval',
      at: a.askedAt,
      from: a.person,
      lead: `${Short(company, a.person)} needs your OK:`,
      words: words(a.summary).replace(/^./, (c) => c.toLowerCase()),
      sentence: [named(company, a.person, whole(company, a.person), true), `${closing(whole(company, a.person))} wants your OK`],
      body: words(a.summary),
      tone: open ? 'needs' : 'plain',
      link: open ? { path: inboxItemPath(a.id), label: 'Answer' } : null,
      item: a.id,
    });
  }
  const plan = company.steering?.plan ?? null;
  const latest = plan?.versions.at(-1) ?? null;
  if (plan && latest && latest.by !== STAKEHOLDER) {
    const waits = approveChoices(plan, company.steering?.settings.planApproval ?? null, doneMilestones(company, latest.plan)) !== null;
    if (waits) {
      add({
        id: `plan:${latest.version}`,
        kind: 'plan',
        at: latest.at,
        from: latest.by,
        lead: `${Short(company, latest.by)}:`,
        words: 'the plan waits for your OK',
        sentence: [`The CEO's plan, version ${latest.version}, waits for your approval`],
        body: latest.note ? words(latest.note) : null,
        tone: 'needs',
        link: { path: planPath(latest.version), label: 'Open the plan' },
      });
    }
  }
}

/** Reports, assignments and someone stuck. A report to you is a reply in all but name, so it reads as one. */
function workLines(company: Company, now: number, add: Add): void {
  const theirs = company.messages.filter((m) => m.to === STAKEHOLDER);
  for (const r of company.reports) {
    const toYou = r.to === STAKEHOLDER;
    if (toYou && theirs.some((m) => m.from === r.person && Math.abs(m.at - r.at) < 60_000 && sameWords(m.text, r.text))) continue;
    const firstTwo = plainText(r.text)
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 2)
      .join('\n');
    add({
      id: `r:${r.id}`,
      kind: 'report',
      at: r.at,
      from: r.person,
      to: r.to,
      lead: `${Short(company, r.person)} reported to ${short(company, r.to)}:`,
      words: words(r.text),
      sentence: [named(company, r.person, short(company, r.person), true), ' reported to ', toYou ? 'you' : named(company, r.to, short(company, r.to))],
      body: firstTwo.length > WORDS_MAX ? clip(firstTwo, WORDS_MAX) : firstTwo,
      link: r.taskId ? { path: `tasks/${encodeURIComponent(r.taskId)}`, label: taskTitle(company, r.taskId) } : null,
    });
  }
  for (const t of company.tasks) {
    if (t.askedBy === STAKEHOLDER || t.askedBy === THE_OFFICE) continue;
    add({
      id: `t:${t.id}`,
      kind: 'assigned',
      at: t.createdAt,
      from: t.askedBy,
      to: t.owner,
      lead: `${Short(company, t.askedBy)} assigned ${short(company, t.owner)}:`,
      words: endSentence(clip(plainText(t.title), 120)),
      sentence: [named(company, t.askedBy, short(company, t.askedBy), true), ' assigned ', named(company, t.owner, short(company, t.owner)), `: ${endSentence(clip(plainText(t.title), 120))}`],
      body: null,
      link: { path: `tasks/${encodeURIComponent(t.id)}`, label: 'Open the task' },
    });
  }
  for (const p of company.people) {
    const work = workOf(company, p, now);
    if (work.kind !== 'stuck') continue;
    const why = p.desk.problem ? clip(plainText(p.desk.problem), 240).replace(/\.$/, '') : 'their last step failed';
    add({
      id: `stuck:${p.id}:${p.desk.since}`,
      kind: 'stuck',
      at: p.desk.since + STUCK_AFTER_MS,
      from: p.id,
      lead: `${Short(company, p.id)} is stuck:`,
      words: why.replace(/^./, (c) => c.toLowerCase()),
      sentence: [named(company, p.id, short(company, p.id), true), ` is stuck: ${why.replace(/^./, (c) => c.toLowerCase())}`],
      body: null,
      tone: 'stuck',
      link: { path: `people/${encodeURIComponent(p.id)}`, label: `Open ${short(company, p.id)}` },
    });
  }
}

const taskTitle = (company: Pick<CompanyView, 'tasks'>, id: string): string => {
  const t = company.tasks.find((x) => x.id === id);
  return t ? `“${clip(plainText(t.title), 60)}”` : 'The task';
};

function decisionLines(company: Company, keyOf: ReadonlyMap<string, string>, add: Add): void {
  for (const d of company.steering?.decisions ?? []) {
    const person = d.by !== STAKEHOLDER && d.by !== THE_OFFICE;
    const own = d.kind === 'decide' && person;
    const what = endSentence(clip(plainText(d.what), 300));
    add({
      id: `d:${d.id}`,
      kind: 'decision',
      at: d.at,
      from: d.by,
      lead: own ? `${Short(company, d.by)} decided:` : '',
      words: what,
      sentence: own ? [named(company, d.by, short(company, d.by), true), ' decided'] : [what],
      body: own ? whyLine(d, what) : d.why ? clip(plainText(d.why), 300) : null,
      link: { path: decisionPath(d.id), label: 'Open the decision' },
      yours: d.by === STAKEHOLDER,
      about: d.links.message ? (keyOf.get(d.links.message) ?? d.links.message) : null,
    });
  }
}

const whyLine = (d: Decision, what: string): string => (d.why ? `${what} ${endSentence(clip(plainText(d.why), 200))}` : what);

/** The company's own sentences, less what a decision by the same person said at the same moment. */
function logLines(company: Company, add: Add): void {
  const decisions = company.steering?.decisions ?? [];
  company.log.forEach((e, i) => {
    if (e.kind === 'stop' && e.by === STAKEHOLDER) return;
    if (decisions.some((d) => d.by === e.by && Math.abs(d.at - e.at) < 2_000)) return;
    const text = endSentence(clip(plainText(e.text), 300));
    add({ id: `log:${i}:${e.at}`, kind: 'company', at: e.at, from: e.by, lead: '', words: text, sentence: [text], body: null, yours: e.by === STAKEHOLDER });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Bursts

/** How close in time lines of a burst come. */
export const BURST_MS = 60_000;
/** A burst folds from this many lines. */
export const BURST_FROM = 4;

/**
 * Four or more acknowledgements of one message, each within a minute of the one before, fold into one line in place of
 * the first: "18 people acknowledged your message." It keeps the first one's id, so its count grows in place.
 */
export function foldBursts(lines: readonly FeedLine[]): FeedLine[] {
  const runs = new Map<string, FeedLine[][]>();
  for (const l of lines) {
    if (l.kind !== 'ack' || l.about === null) continue;
    const forThread = runs.get(l.about) ?? [];
    const run = forThread.at(-1);
    const last = run?.at(-1);
    if (run && last && l.at - last.at <= BURST_MS) run.push(l);
    else forThread.push([l]);
    runs.set(l.about, forThread);
  }
  const folded = new Map<string, FeedLine>();
  const gone = new Set<string>();
  for (const forThread of runs.values()) {
    for (const run of forThread) {
      const [first] = run;
      const last = run.at(-1);
      if (!first || !last || run.length < BURST_FROM) continue;
      const yours = first.sentence.some((s) => typeof s === 'string' && s.includes('your message'));
      const sentence = `${capital(countWord(run.length))} people acknowledged ${yours ? 'your message' : 'the message'}`;
      folded.set(first.id, {
        ...first,
        id: `burst:${first.id}`,
        kind: 'burst',
        at: last.at,
        lead: '',
        words: `${sentence}.`,
        sentence: [sentence],
        body: null,
        who: run.map((l) => l.from),
        members: run,
      });
      for (const l of run) gone.add(l.id);
    }
  }
  const out: FeedLine[] = [];
  for (const l of lines) {
    const burst = folded.get(l.id);
    if (burst) out.push(burst);
    else if (!gone.has(l.id)) out.push(l);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Before anything is said. */
export const NOTHING_SAID = 'Nothing said yet';
export const NOTHING_SAID_FEED = 'Nothing said yet. What you say, the replies and how your words travel down the org show up here.';
export const EARLIER_NOT_KEPT = "Earlier lines aren't kept in the office.";

/** A day's heading in the feed: "Today", "Yesterday", "Mon 3 Nov". */
export function dayOf(at: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

/** Who a line's faces show: the speaker, and who they spoke to on a hop. */
export const facesOf = (line: FeedLine): string[] => (line.who ? line.who.slice(0, 3) : line.to && (line.kind === 'passed' || line.kind === 'between') ? [line.from, line.to] : [line.from]);

/** Someone by id, for a face: the person, or null for you, the office and anyone who left. */
export const personOf = (company: Pick<CompanyView, 'people'>, id: string): PersonView | null => company.people.find((p) => p.id === id) ?? null;
