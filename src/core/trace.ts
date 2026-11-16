// The trace of a message the stakeholder sent (SPEC-v3.md "Steering" 3, "See your message land"): every copy of it and
// every relay that passed it on, when and how each reached its person and through whom, each person's acknowledgement,
// what cites it, and flags where it stalls. Worked out from the view alone, with no state of its own, so the office,
// the core streams and the hub read the same trace. Pure, with no Node APIs.
import { chainUp, type CompanyView, isManager, type Message, type PersonView, STAKEHOLDER, THE_OFFICE } from './company.ts';
import { clip, plainText } from './now.ts';
import { ACK_WINDOW_MS, type Ack, type MessageTrace, type TraceCite, type TraceFlag, type TraceStop } from './steering.ts';
import { inSentence, titleFromId } from './studio.ts';
import { capital } from './words.ts';

/** What a trace reads from the view. */
export type TraceView = Pick<CompanyView, 'people' | 'messages' | 'tasks' | 'reports' | 'statuses' | 'pause' | 'phase' | 'steering'>;

/** A stakeholder message and everything that carries it on. */
export interface MessageFamily {
  /** The message the trace is of: the one asked for, or the message it passes on, back to the first. */
  root: Message | null;
  /** Every copy of it: one for a person, one per person for a room, a team or everyone. Oldest first. */
  copies: Message[];
  /** The relays that passed it on, oldest first. */
  relays: Message[];
  /** Messages that follow it up by citing it (a Remind, an Escalate, a reply), oldest first. */
  followUps: Message[];
  /** The copies' and the relays' ids. */
  ids: ReadonlySet<string>;
}

const byTime = <T extends { at: number }>(a: T, b: T): number => a.at - b.at;
const EMPTY: MessageFamily = { root: null, copies: [], relays: [], followUps: [], ids: new Set() };

/**
 * A message's family, from any of its ids: a copy, a relay, or the group id its copies share. A relay leads back to the
 * message it passes on, and on to the first; a copy for a room, a team or everyone brings its sister copies; relays are
 * followed down through `relayOf`, whether it names the message just before or the first one.
 */
export function familyOf(messages: readonly Message[], message: string): MessageFamily {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const anchor = byId.get(message) ?? messages.filter((m) => m.audience?.group === message).sort(byTime)[0];
  if (!anchor) return EMPTY;
  let root = anchor;
  for (const climbed = new Set([root.id]); root.relayOf; ) {
    const up = byId.get(root.relayOf);
    if (!up || climbed.has(up.id)) break;
    climbed.add(up.id);
    root = up;
  }
  const group = root.audience?.group;
  const copies = group ? messages.filter((m) => m.audience?.group === group && m.from === root.from && (m.relayOf ?? null) === (root.relayOf ?? null)).sort(byTime) : [root];
  if (!copies.includes(root)) copies.unshift(root);

  const passing = new Map<string, Message[]>();
  for (const m of messages) if (m.relayOf) passing.set(m.relayOf, [...(passing.get(m.relayOf) ?? []), m]);
  const ids = new Set(copies.map((m) => m.id));
  const relays: Message[] = [];
  for (let frontier = [...ids]; frontier.length > 0; ) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const relay of passing.get(id) ?? []) {
        if (ids.has(relay.id)) continue;
        ids.add(relay.id);
        relays.push(relay);
        next.push(relay.id);
      }
    }
    frontier = next;
  }
  const followUps = messages.filter((m) => !ids.has(m.id) && (m.cites ?? []).some((id) => ids.has(id) || id === group)).sort(byTime);
  return { root, copies, relays: relays.sort(byTime), followUps, ids };
}

// ---------------------------------------------------------------------------------------------------------------
// Words: the office's way of naming people (web/src/company/people/peopleModel.ts says it the same way)

function personOf(view: Pick<TraceView, 'people'>, id: string): PersonView | undefined {
  return view.people.find((p) => p.id === id);
}

/** Someone after the first mention: "Ada", "the QA engineer", "the CEO"; "you" for the stakeholder. */
function called(view: Pick<TraceView, 'people'>, id: string): string {
  if (id === STAKEHOLDER) return 'you';
  if (id === THE_OFFICE) return 'the office';
  const p = personOf(view, id);
  if (!p) return `the ${inSentence(titleFromId(id))}`;
  if (p.level === 'ceo') return 'the CEO';
  return p.name === p.title ? `the ${inSentence(p.title)}` : p.name;
}

const endSentence = (text: string): string => (/[.?!…]$/.test(text) ? text : `${text}.`);
const said = (text: string, max: number): string => clip(plainText(text), max);
const firstSentence = (text: string): string => {
  const line = plainText(text).replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
};

/** Why a copy hasn't reached its person yet, in the words a flag uses. */
function notDeliveredSentence(view: TraceView, person: string): string {
  const name = called(view, person);
  const desk = personOf(view, person)?.desk.state;
  if (view.pause) return `Not delivered to ${name} yet: ${view.pause.reason === 'stakeholder' ? 'work is paused' : 'the company is resting'}.`;
  if (view.phase === 'stopped') return `Not delivered to ${name} yet: the company is stopped.`;
  switch (desk) {
    case 'away':
      return `Not delivered to ${name} yet: ${name} is in Claude Code.`;
    case 'waiting':
      return `Not delivered to ${name} yet: ${name} waits for a desk.`;
    case 'working':
    case 'starting':
    case 'stopping':
      return `Not delivered to ${name} yet: it waits for ${name}'s next step.`;
    default:
      return `Not delivered to ${name} yet.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------

/** Where one stakeholder message went, worked out from the view: its stops, what cites it and where it stalls. */
export function traceOf(view: TraceView, message: string, now: number): MessageTrace {
  const family = familyOf(view.messages, message);
  const followIds = new Set(family.followUps.map((m) => m.id));
  const group = family.root?.audience?.group ?? null;
  // What cites the message may name any copy, any relay, a follow-up or the group.
  const named = (list: readonly string[] | undefined): boolean =>
    (list ?? []).some((id) => family.ids.has(id) || followIds.has(id) || id === message || (group !== null && id === group));

  const acks = view.steering?.acks ?? [];
  /** Their acknowledgement of their own copy, else of any copy, relay or follow-up of it: the newest. */
  const ackOf = (m: Message): Ack | null => {
    let own: Ack | null = null;
    let other: Ack | null = null;
    for (const a of acks) {
      if (a.by !== m.to) continue;
      if (a.message === m.id) {
        if (!own || a.at >= own.at) own = a;
      } else if (family.ids.has(a.message) || followIds.has(a.message)) {
        if (!other || a.at >= other.at) other = a;
      }
    }
    return own ?? other;
  };

  const stop = (m: Message, via: string | null): TraceStop => ({ person: m.to, message: m.id, via, deliveredAt: m.deliveredAt, how: m.deliveredHow ?? null, ack: ackOf(m) });
  const stops: TraceStop[] = [
    ...family.copies.filter((m) => m.to !== STAKEHOLDER && m.to !== THE_OFFICE).map((m) => stop(m, null)),
    ...family.relays.filter((m) => m.to !== STAKEHOLDER && m.to !== THE_OFFICE).map((m) => stop(m, m.from)),
  ];

  return { message, stops, cites: citesOf(view, named), flags: flagsOf(view, family, stops, now) };
}

/** The tasks, reports, status lines, decisions, commits and plan versions that cite it, oldest first. */
function citesOf(view: TraceView, named: (list: readonly string[] | undefined) => boolean): TraceCite[] {
  const cites: TraceCite[] = [];
  const Name = (id: string) => capital(called(view, id));
  for (const t of view.tasks) {
    if (!named(t.cites)) continue;
    const title = said(t.title, 120);
    const handover = t.handovers?.at(-1);
    if (t.cancel) cites.push({ kind: 'task', id: t.id, by: t.cancel.by, at: t.cancel.at, text: `${Name(t.cancel.by)} cancelled “${title}”: ${endSentence(said(t.cancel.reason, 200))}` });
    else if (t.paused) cites.push({ kind: 'task', id: t.id, by: t.paused.by, at: t.paused.at, text: `${Name(t.paused.by)} paused “${title}”.` });
    else if (handover) cites.push({ kind: 'task', id: t.id, by: handover.by, at: handover.at, text: `${Name(handover.by)} handed “${title}” from ${called(view, handover.from)} to ${called(view, handover.to)}.` });
    else {
      const owner = t.owner === t.askedBy ? 'themselves' : called(view, t.owner);
      cites.push({ kind: 'task', id: t.id, by: t.askedBy, at: t.createdAt, text: `${Name(t.askedBy)} assigned ${owner}: ${endSentence(title)}` });
    }
    if (t.commit) cites.push({ kind: 'commit', id: t.commit, by: t.owner, at: t.updatedAt, text: `${Name(t.owner)} committed ${t.commit.slice(0, 7)}: ${endSentence(title)}` });
  }
  for (const r of view.reports) {
    if (!named(r.cites)) continue;
    cites.push({ kind: 'report', id: r.id, by: r.person, at: r.at, text: `${Name(r.person)} reported to ${called(view, r.to)}: ${endSentence(clip(firstSentence(r.text), 200))}` });
  }
  for (const s of view.statuses) {
    if (!named(s.cites)) continue;
    cites.push({ kind: 'status', id: `${s.person}@${s.at}`, by: s.person, at: s.at, text: `${Name(s.person)}: ${endSentence(said(s.text, 200))}` });
  }
  for (const d of view.steering?.decisions ?? []) {
    if (!named(d.links.message === undefined ? undefined : [d.links.message])) continue;
    cites.push({ kind: 'decision', id: d.id, by: d.by, at: d.at, text: endSentence(said(d.what, 300)) });
  }
  for (const v of view.steering?.plan?.versions ?? []) {
    if (!named(v.cites)) continue;
    const note = v.note ? `: ${endSentence(said(v.note, 200))}` : '.';
    cites.push({ kind: 'plan', id: String(v.version), by: v.by, at: v.at, text: `${Name(v.by)} wrote version ${v.version} of the plan${note}` });
  }
  return cites.sort(byTime);
}

/**
 * Where it stalls. One flag at most per person:
 * - not-delivered: no copy has reached them yet;
 * - no-ack: it reached them ACK_WINDOW_MS ago or more and they haven't acknowledged it;
 * - not-passed-on: the same for a manager who got it on their own (not as one of a room, a team or everyone) and
 *   hasn't passed it on either;
 * - not-reached: someone it is `for` has no copy at all; the holder is their nearest manager it reached, else whoever
 *   the stakeholder sent it to.
 * People who have left the company aren't flagged: nobody can nudge them.
 */
function flagsOf(view: TraceView, family: MessageFamily, stops: readonly TraceStop[], now: number): TraceFlag[] {
  const flags: TraceFlag[] = [];
  const byMessage = new Map([...family.copies, ...family.relays].map((m) => [m.id, m]));
  const byPerson = new Map<string, TraceStop[]>();
  for (const s of stops) byPerson.set(s.person, [...(byPerson.get(s.person) ?? []), s]);

  for (const [person, own] of byPerson) {
    const p = personOf(view, person);
    if (!p) continue;
    const delivered = own.filter((s) => s.deliveredAt !== null).sort((a, b) => (a.deliveredAt ?? 0) - (b.deliveredAt ?? 0))[0];
    if (!delivered || delivered.deliveredAt === null) {
      const since = Math.min(...own.map((s) => byMessage.get(s.message)?.at ?? now));
      flags.push({ kind: 'not-delivered', person, holder: person, since, sentence: notDeliveredSentence(view, person) });
      continue;
    }
    if (own.some((s) => s.ack !== null) || now - delivered.deliveredAt < ACK_WINDOW_MS) continue;
    const name = capital(called(view, person));
    const alone = own.some((s) => !byMessage.get(s.message)?.audience);
    const passedOn = family.relays.some((r) => r.from === person);
    if (isManager(p) && alone && !passedOn) {
      flags.push({ kind: 'not-passed-on', person, holder: person, since: delivered.deliveredAt, sentence: `${name} hasn't passed it on or acknowledged it yet.` });
    } else {
      flags.push({ kind: 'no-ack', person, holder: person, since: delivered.deliveredAt, sentence: `${name} hasn't acknowledged it yet.` });
    }
  }

  const root = family.root;
  if (root) {
    const wanted = [...new Set(family.copies.flatMap((m) => m.for ?? []))];
    for (const person of wanted) {
      if (byPerson.has(person) || !personOf(view, person) || person === root.from) continue;
      const holder = holderFor(view, person, stops);
      if (holder === null) continue;
      flags.push({ kind: 'not-reached', person, holder, since: root.at, sentence: `Not passed on to ${called(view, person)} yet.` });
    }
  }
  return flags.sort((a, b) => a.since - b.since || (a.person < b.person ? -1 : a.person > b.person ? 1 : 0));
}

/** Who holds a message on its way to someone it hasn't reached: their nearest manager with a copy, else a recipient. */
function holderFor(view: TraceView, person: string, stops: readonly TraceStop[]): string | null {
  const has = new Set(stops.map((s) => s.person));
  const manager = chainUp(view.people, person).find((m) => has.has(m.id));
  if (manager) return manager.id;
  const direct = stops.filter((s) => s.via === null);
  return (direct.find((s) => s.deliveredAt !== null) ?? direct[0] ?? stops[0])?.person ?? null;
}
