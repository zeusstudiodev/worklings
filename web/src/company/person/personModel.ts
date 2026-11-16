// A person's panel (docs/design-v3.md, "A person"): the lines under their name, the thread with you, what each of your
// messages is waiting for, the box's hint and what Details holds. Pure, so it can be tested.
import { type CompanyView, isManager, type Message, type PersonView, type Report, STAKEHOLDER, THE_OFFICE } from '../../../../src/core/company.ts';
import { clip, coarseAge, plainText } from '../../../../src/core/now.ts';
import { modelLabel } from '../../../../src/core/pricing.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { capital } from '../../../../src/core/words.ts';
import { whenAt } from '../../lib/format.ts';
import { waitsForWords } from '../pauseWords.ts';
import { called, endSentence, introduced, nameOf, ordinal, possessive, roomName, taskOf } from '../people/peopleModel.ts';

/** People's messages are capped at 4,000 characters; so is the box. */
export const MESSAGE_MAX = 4_000;
/** What Stop and wait sends. */
export const STOP_AND_WAIT = 'Stop here and wait for my next message.';
/** Details lists this many messages with colleagues, then counts the rest. */
export const OTHERS_SHOWN = 20;

const MODEL_WORDS: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', inherit: 'Same as yours' };

/** A role's model in a word: "Opus", "Sonnet", or a full model id as Claude Code names it ("Sonnet 4.5"). */
export const modelName = (model: string): string => (Object.hasOwn(MODEL_WORDS, model) ? (MODEL_WORDS[model] ?? model) : modelLabel(model));

/** Text a person wrote, whole: Markdown marks gone and masked again, line breaks kept. */
export const said = (text: string): string => plainText(text);

// ---------------------------------------------------------------------------------------------------------------
// The lines under the name

export interface RoleLine {
  title: string;
  room: string;
  /** Their manager, a link; `you` for the CEO; null when the org doesn't say. */
  manager: { id: string; name: string } | 'you' | null;
}

export function roleLine(snapshot: Pick<Snapshot, 'studio'>, company: Pick<CompanyView, 'people'>, p: PersonView): RoleLine {
  const manager = p.reportsTo ? company.people.find((m) => m.id === p.reportsTo) : undefined;
  return {
    title: p.title,
    room: roomName(snapshot, p.room),
    manager: p.level === 'ceo' ? 'you' : manager ? { id: manager.id, name: called(manager) } : null,
  };
}

/** "Wiring the slot picker to the order store." and how old it is: "31 min ago." */
export function statusOf(p: PersonView, now: number): { text: string; age: string } | null {
  if (!p.status) return null;
  return { text: endSentence(clip(said(p.status.text), 200)), age: `${capital(coarseAge(now - p.status.at))}.` };
}

/** Their newest report: "Latest report at 14:20:" (with its day when it isn't today) and the whole text, which the panel clamps to two lines. */
export function latestReportOf(company: Pick<CompanyView, 'reports'>, person: string, now?: number): { label: string; text: string } | null {
  let latest: Report | undefined;
  for (const r of company.reports) if (r.person === person && (!latest || r.at >= latest.at)) latest = r;
  return latest ? { label: `Latest report ${whenAt(latest.at, now)}:`, text: said(latest.text) } : null;
}

/** Stop shows while someone is at work. */
export const canStop = (p: PersonView): boolean => p.desk.state === 'working' || p.desk.state === 'starting';

// ---------------------------------------------------------------------------------------------------------------
// The thread

export type ThreadEntry =
  /** Yours, with what it waits for until it reaches them, and whether it can still be unsent. */
  | { kind: 'mine'; id: string; at: number; text: string; delivery: string; unsend: boolean }
  /**
   * Your answer to their question, as the message that carried it: "You answered “Pickup slots…”: 15-minute windows."
   * Taken back with the inbox's Undo while it can be, so never unsent here.
   */
  | { kind: 'answer'; id: string; at: number; text: string; delivery: string }
  /** Theirs to you; the CEO's reports to you too. */
  | { kind: 'theirs'; id: string; at: number; text: string }
  /** Your words, passed on to them by someone: who passed it, the way it came and the passer's own note. */
  | { kind: 'passed'; id: string; at: number; text: string; passer: string; heading: string; through: string; note: string | null }
  /**
   * The office's own lines: relays, assignments, reports to their manager, restarts, and what the office told them (a
   * briefing speaks to them and names tools, so the thread shows one line and `full` holds the words, for a disclosure).
   */
  | { kind: 'office'; id: string; at: number; text: string; check: boolean; full: string | null };

/** The most of the office's own words to a person a disclosure holds. */
const OFFICE_FULL_MAX = 6_000;

/**
 * What the office told someone, as the line the thread shows: "The office briefed the CEO on your prompt." A briefing is
 * written to them ("You are founding…", "First set the goal with set_goal…"), so it never reads as a sentence to you; a
 * note the office doesn't recognise stays as it is, cut short. `full` is the whole text when the line leaves some out.
 */
export function officeLine(text: string, p: PersonView): { text: string; full: string | null } {
  const them = called(p);
  const full = clip(said(text), OFFICE_FULL_MAX);
  const line = (sentence: string) => ({ text: sentence, full });
  if (/^You are founding a new company/.test(text)) return line(`The office briefed ${them} on your prompt.`);
  if (/ started the company\. Everyone in the proposal is hired/.test(text)) return line(`The office told ${them} the company has started.`);
  if (/ edited your proposal: /.test(text)) return line(`The office told ${them} you changed the proposal.`);
  if (/ went back to your own version of the proposal/.test(text)) return line(`The office told ${them} you went back to their version of the proposal.`);
  if (/^You're back at your desk in the office/.test(text)) return line(`The office put ${them} back at their desk.`);
  const short = endSentence(clip(said(text), 240));
  return { text: short, full: full.length > short.length + 1 ? full : null };
}

/** What a message of yours waits for, in the words the box's hint used. */
export function deliveryLine(m: Message, company: Pick<CompanyView, 'pause' | 'phase'>, p: PersonView, now?: number): { text: string; unsend: boolean } {
  const name = called(p);
  if (m.deliveredAt !== null) {
    return { text: m.interrupt ? `Stopped ${name} and delivered ${whenAt(m.deliveredAt, now)}.` : `Delivered ${whenAt(m.deliveredAt, now)}.`, unsend: false };
  }
  const waits = (text: string) => ({ text, unsend: true });
  if (company.pause) return waits(company.pause.until !== null ? `Waits until the company wakes ${whenAt(company.pause.until, now)}.` : `Waits until ${waitsForWords(company.pause)}.`);
  if (company.phase === 'stopped') return waits('Waits until you resume the company.');
  switch (p.desk.state) {
    case 'away':
      return waits(`Waits until you bring ${name} back.`);
    case 'waiting':
      return waits(`Waits for a desk${p.desk.queue ? `, ${ordinal(p.desk.queue)} in line` : ''}.`);
    case 'closed':
    case 'failed':
      return waits(`Waits for ${possessive(name)} desk to open.`);
    default:
      return waits(`Waits for ${possessive(name)} next step.`);
  }
}

/** A question as an answer quotes it: its first words, cut at a word. */
const QUESTION_QUOTED = 60;

/** How the company words the message an answer travels in, for an answer whose question has left the view. */
const ANSWER_TEXT = /^on "([\s\S]*?)": ([\s\S]*)$/;

/**
 * A message that carries your answer (`answers` names the question): "You answered “Pickup slots: should guests pick
 * from…”: 15-minute windows." Null for any other message.
 */
export function answerSentence(company: Pick<CompanyView, 'questions'>, m: Pick<Message, 'answers' | 'text'>): string | null {
  if (!m.answers) return null;
  const q = company.questions.find((x) => x.id === m.answers);
  const raw = ANSWER_TEXT.exec(m.text);
  const option = q?.answer && q.answer.option !== null ? (q.options[q.answer.option] ?? '') : '';
  const own = q?.answer?.text.trim() ?? '';
  // An option's words, then anything you added that isn't the same words again.
  const fromQuestion = [option.replace(/[.!?]+$/, ''), own && own !== option ? own : ''].filter(Boolean).join('. ');
  const answer = fromQuestion || raw?.[2] || m.text;
  const question = q?.text ?? raw?.[1] ?? '';
  const quoted = question ? `“${clip(plainText(question), QUESTION_QUOTED)}”` : 'their question';
  return `You answered ${quoted}: ${endSentence(clip(plainText(answer), 240))}`;
}

/** The first message a relay passes on: the one it relays, and on back until a message that relays nothing. */
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

/**
 * Who your words passed through before they reached this message's sender: "the CEO and Ada". Walks back through the
 * messages of the same relay, each time to the one that reached the sender, so it works whether `relayOf` names the
 * message just before or the first one.
 */
function throughOf(company: Pick<CompanyView, 'people'>, family: readonly Message[], m: Message): string[] {
  const names: string[] = [];
  const seen = new Set<string>([m.id]);
  for (let at: Message | undefined = m; at && at.from !== STAKEHOLDER; ) {
    names.unshift(nameOf(company, at.from).called);
    const sender: string = at.from;
    const before: number = at.at;
    at = family.filter((x) => x.to === sender && x.at <= before && !seen.has(x.id)).sort((x, y) => y.at - x.at)[0];
    if (at) seen.add(at.id);
  }
  return names;
}

const listed = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The same words, minus Markdown, spacing and case, for telling a passed-on note from the words it passes on. */
const sameWords = (a: string, b: string) => plainText(a).replace(/\s+/g, ' ').trim().toLowerCase() === plainText(b).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Everything between you and this person, oldest first: your messages and theirs, your words passed on to them, and the
 * office's lines about them (passing your words on, being assigned work, reporting to their manager, restarts).
 * Messages with colleagues are left to Details.
 */
export function threadOf(company: CompanyView, p: PersonView, now?: number): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  const byId = new Map(company.messages.map((m) => [m.id, m]));
  const families = new Map<string, Message[]>();
  for (const m of company.messages) {
    const root = rootOf(byId, m).id;
    families.set(root, [...(families.get(root) ?? []), m]);
  }
  const name = capital(called(p));
  for (const m of company.messages) {
    if (m.from === STAKEHOLDER && m.to === p.id) {
      const d = deliveryLine(m, company, p, now);
      const answered = answerSentence(company, m);
      if (answered !== null) entries.push({ kind: 'answer', id: m.id, at: m.at, text: answered, delivery: d.text });
      else entries.push({ kind: 'mine', id: m.id, at: m.at, text: m.text, delivery: d.text, unsend: d.unsend });
    } else if (m.from === p.id && m.to === STAKEHOLDER) {
      entries.push({ kind: 'theirs', id: m.id, at: m.at, text: said(m.text) });
    } else if (m.to === p.id && m.origin === STAKEHOLDER && m.from !== STAKEHOLDER) {
      const root = rootOf(byId, m);
      const fromYou = root.from === STAKEHOLDER;
      const through = throughOf(company, families.get(root.id) ?? [m], m);
      entries.push({
        kind: 'passed',
        id: m.id,
        at: m.at,
        text: said(fromYou ? root.text : m.text),
        passer: m.from,
        heading: `${capital(nameOf(company, m.from).called)} passed on your message`,
        through: `From you, through ${listed(through.length > 0 ? through : [nameOf(company, m.from).called])}.`,
        // What the relayer added; messages from before notes had their own field carry it as their text instead.
        note: m.note ? said(m.note) : fromYou && !sameWords(root.text, m.text) ? said(m.text) : null,
      });
    } else if (m.from === p.id && m.origin === STAKEHOLDER && m.to !== STAKEHOLDER) {
      entries.push({ kind: 'office', id: m.id, at: m.at, text: `${name} passed it on to ${nameOf(company, m.to).introduced}.`, check: false, full: null });
    } else if (m.from === THE_OFFICE && m.to === p.id) {
      entries.push({ kind: 'office', id: m.id, at: m.at, ...officeLine(m.text, p), check: false });
    }
  }
  for (const t of company.tasks) {
    if (t.owner !== p.id) continue;
    const by = t.askedBy === STAKEHOLDER ? 'You' : capital(nameOf(company, t.askedBy).called);
    entries.push({ kind: 'office', id: `task:${t.id}`, at: t.createdAt, text: `${by} assigned ${called(p)}: ${endSentence(clip(said(t.title), 120))}`, check: false, full: null });
  }
  const theirs = company.messages.filter((m) => m.from === p.id && m.to === STAKEHOLDER);
  for (const r of company.reports) {
    if (r.person !== p.id) continue;
    if (r.to === STAKEHOLDER) {
      // A report to you that also came as a message is said once.
      if (theirs.some((m) => Math.abs(m.at - r.at) < 60_000 && sameWords(m.text, r.text))) continue;
      entries.push({ kind: 'theirs', id: `report:${r.id}`, at: r.at, text: said(r.text) });
    } else {
      entries.push({ kind: 'office', id: `report:${r.id}`, at: r.at, text: `${name} reported to ${nameOf(company, r.to).called}: ${clip(said(r.text), 120)}`, check: true, full: null });
    }
  }
  for (const [i, e] of company.log.entries()) {
    if (e.kind === 'restart') entries.push({ kind: 'office', id: `log:${i}:${e.at}`, at: e.at, text: endSentence(clip(said(e.text), 240)), check: false, full: null });
  }
  const order: Record<ThreadEntry['kind'], number> = { office: 0, mine: 1, answer: 1, passed: 1, theirs: 2 };
  return entries.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/** A message this tab sent, until the snapshot carries it. */
export interface Outgoing {
  id: string;
  text: string;
  state: 'sending' | 'sent' | 'refused';
  message: Message | null;
  error: string | null;
  /** Your messages to them when it was sent: a new one with the same words is this one, arrived before the answer. */
  before: ReadonlySet<string>;
}

/**
 * The sends still to show beside the thread: by id once the office answered, by their words while it hasn't (the
 * snapshot can arrive first), and never one you unsent since.
 */
export function pendingSends(outbox: readonly Outgoing[], company: Pick<CompanyView, 'messages'>, person: string, unsent: ReadonlySet<string>): Outgoing[] {
  const known = new Set(company.messages.map((m) => m.id));
  const mine = company.messages.filter((m) => m.from === STAKEHOLDER && m.to === person);
  return outbox.filter((o) => {
    if (o.message) return !known.has(o.message.id) && !unsent.has(o.message.id);
    return !mine.some((m) => !o.before.has(m.id) && m.text === o.text);
  });
}

/** Someone whose desk is at work, or has been, has a turn behind them even when no figures or session id have arrived. */
const hasWorked = (p: PersonView): boolean => p.desk.sessionId !== null || ['working', 'stopping', 'idle', 'failed', 'away'].includes(p.desk.state);

/** What Details says in place of figures that haven't come in: true to what the desk is doing. */
export function noFiguresLine(p: PersonView): string {
  const name = capital(called(p));
  return hasWorked(p) ? `${name}'s figures haven't come in yet. They show here once the first step has finished.` : `${name} hasn't worked yet, so there are no figures.`;
}

/** What "Open in Claude Code" says when there is no session id to hand over. */
export function noSessionLine(p: PersonView): string {
  const name = capital(called(p));
  return hasWorked(p) ? `${name}'s session isn't ready to open yet. Try again in a moment.` : `${name} hasn't worked yet, so there's no session to open.`;
}

/** Before anything is said: "No messages yet. Kai reads what you send here at their next step." */
export const emptyThread = (p: PersonView): string => `No messages yet. ${capital(called(p))} reads what you send here at their next step.`;

// ---------------------------------------------------------------------------------------------------------------
// The box

export function boxLabel(p: PersonView, stopping: boolean): string {
  return stopping ? `Stop ${called(p)} and say what to do instead` : `Message ${called(p)}`;
}

/** What will happen to what you send, by their desk and the company's state. */
export function boxHint(company: Pick<CompanyView, 'pause' | 'phase'>, p: PersonView, now?: number): string {
  const name = capital(called(p));
  if (company.pause) return company.pause.until !== null ? `${name} reads it when the company wakes ${whenAt(company.pause.until, now)}.` : `${name} reads it when ${waitsForWords(company.pause)}.`;
  if (company.phase === 'stopped') return `${name} reads it when you resume the company.`;
  switch (p.desk.state) {
    case 'away':
      return `${name} is with you in Claude Code. It waits until you bring them back.`;
    case 'waiting':
      return `${name} gets it when a desk is free${p.desk.queue ? `, ${ordinal(p.desk.queue)} in line` : ''}.`;
    default:
      break;
  }
  if (isManager(p)) return `${name} passes it on to whoever it concerns.`;
  return p.desk.state === 'working' || p.desk.state === 'starting' || p.desk.state === 'stopping' ? `${name} reads it at their next step.` : `${name} starts on it now.`;
}

/** Counted as Unicode characters, as the office counts them: "3,950 of 4,000", shown from 3,000. */
export function boxCount(text: string, max = MESSAGE_MAX): { text: string | null; over: boolean } {
  const length = [...text].length;
  const n = (x: number) => x.toLocaleString('en-US');
  if (length > max) return { text: `${n(length)} of ${n(max)}. Shorten it by ${n(length - max)} to send.`, over: true };
  return { text: length >= max * 0.75 ? `${n(length)} of ${n(max)}` : null, over: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Details

/** "Context used: 64%." with what it means for them (game-feel's tiredness), never as an alarm. */
export function contextLine(context: number | null): string | null {
  if (context === null || !Number.isFinite(context)) return null;
  const share = Math.min(1, Math.max(0, context));
  const used = `Context used: ${Math.round(share * 100)}%.`;
  if (share >= 0.9) return `${used} Soon they summarise their notes and may lose detail.`;
  if (share >= 0.75) return `${used} A long stretch: each step re-reads more and costs more.`;
  if (share >= 0.5) return `${used} Busy, with room to go.`;
  return used;
}

/**
 * The v0.2 words about a person's pages: how big the current one has grown and, when they have had fresh ones, since when.
 * The view carries the count and the size, not the time, so the time is the newest handover line in the timeline that
 * starts with their name; without one the count alone is said.
 */
export function pageLine(p: Pick<PersonView, 'name' | 'context'>, log: readonly { at: number; kind: string; text: string }[], clock: (at: number) => string): string | null {
  const c = p.context;
  if (!c) return null;
  const parts: string[] = [];
  if (c.tokens !== null && c.tokens > 0) parts.push(`This page holds about ${c.tokens >= 1000 ? `${Math.round(c.tokens / 100) / 10}k` : c.tokens} tokens.`);
  if (c.fresh > 0) {
    const since = [...log].reverse().find((e) => e.kind === 'handover' && p.name !== '' && e.text.startsWith(`${p.name} started a fresh`));
    const nth = c.fresh === 1 ? 'a fresh page' : `their ${c.fresh}${c.fresh === 2 ? 'nd' : c.fresh === 3 ? 'rd' : 'th'} fresh page`;
    parts.push(since ? `On ${nth} since ${clock(since.at)}: the old one's notes carry over.` : `On ${nth}: the old one's notes carry over.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

export interface OtherMessage {
  id: string;
  at: number;
  /** "To Ines" or "From Ines". */
  with: string;
  text: string;
}

/** Their messages with colleagues, newest first: OTHERS_SHOWN of them, then how many more. */
export function othersOf(company: CompanyView, p: PersonView): { shown: OtherMessage[]; more: number } {
  const others = company.messages
    .filter((m) => (m.from === p.id || m.to === p.id) && m.from !== STAKEHOLDER && m.to !== STAKEHOLDER && m.from !== THE_OFFICE && m.to !== THE_OFFICE)
    .sort((a, b) => b.at - a.at);
  return {
    shown: others.slice(0, OTHERS_SHOWN).map((m) => ({
      id: m.id,
      at: m.at,
      with: m.from === p.id ? `To ${nameOf(company, m.to).called}` : `From ${nameOf(company, m.from).called}`,
      text: clip(said(m.text), 240),
    })),
    more: Math.max(0, others.length - OTHERS_SHOWN),
  };
}

/** Where "Open in Claude Code" runs: their task's worktree when it has one, else the project's folder. */
export function folderOf(snapshot: Pick<Snapshot, 'project'>, company: Pick<CompanyView, 'tasks'>, p: PersonView): string {
  return taskOf(company, p.task)?.worktree?.path ?? snapshot.project.root;
}

/** The command that opens their session in your own Claude Code. */
export const resumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`;

/** Their messages with you that arrived since you last opened their conversation. */
export function unreadFrom(company: Pick<CompanyView, 'messages' | 'seen' | 'reports'>, person: string): number {
  const seen = Object.hasOwn(company.seen, person) ? (company.seen[person] ?? 0) : 0;
  return (
    company.messages.filter((m) => m.from === person && m.to === STAKEHOLDER && m.at > seen).length +
    company.reports.filter((r) => r.person === person && r.to === STAKEHOLDER && r.at > seen && !company.messages.some((m) => m.from === person && m.to === STAKEHOLDER && Math.abs(m.at - r.at) < 60_000 && sameWords(m.text, r.text))).length
  );
}

/** Introduced, for the panel's live announcements: "Kai, frontend engineer". */
export const introduction = (p: PersonView): string => capital(introduced(p));
