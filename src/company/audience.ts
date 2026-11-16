// Messages to a person, a room, a team or everyone, and following them up (SPEC-v3.md "Steering" 2 and 3): who a
// Recipient reaches under the sender's authority; one copy per person, each naming the audience; whom the stakeholder
// means a message for; the words each turn carries; acknowledgements; the message ids a report, a status line or a task
// cites; and Remind and Escalate. Pure decisions over the org and the messages: the company cleans the words, makes each
// message with its next id (MakeMessage), commits and delivers them, and src/core/trace.ts reads what they store.
import {
  below,
  chainUp,
  introduce,
  isManager,
  managerOf,
  mayMessage,
  type Message,
  OrgRefusal,
  type Person,
  personById,
  STAKEHOLDER,
  THE_OFFICE,
  turnText,
} from '../core/company.ts';
import { oneLine } from '../core/events.ts';
import { clip } from '../core/now.ts';
import type { Ack, Audience, Recipient } from '../core/steering.ts';
import { inSentence, titleFromId } from '../core/studio.ts';
import { familyOf, type MessageFamily } from '../core/trace.ts';
import { ackIdFor, TRACE_LIMITS } from '../core/trace-state.ts';
import { capital } from '../core/words.ts';

/** What sending and following up need to know about the company. */
export interface AudienceOrg {
  people: readonly Person[];
  /** The stakeholder's name in messages ("Robin"); empty when the office doesn't know it. */
  stakeholder: string;
  /** A room's name as studio.yaml gives it ("Design"); null when the office has no such room. */
  roomName: (room: string) => string | null;
  /** Whether the stakeholder has written to this person, who may then write back. */
  wroteTo: (person: string) => boolean;
}

/** What steering adds to a message the company makes. */
export interface MessageExtra {
  for?: string[];
  cites?: string[];
  /** The stakeholder typed the words in a box (Message.typed). */
  typed?: boolean;
}

/** The company's own maker (Company.newMessage): its next id, its clock, and delivered at once for the stakeholder. */
export type MakeMessage = (from: string, to: string, text: string, extra: MessageExtra) => Message;

// ---------------------------------------------------------------------------------------------------------------
// Words

/** "Kai" inside a sentence, or "the QA engineer" for a role without a first name. */
const nameIn = (p: Pick<Person, 'name' | 'title'>): string => (p.name === p.title ? `the ${inSentence(p.title)}` : p.name);

const bossOf = (org: Pick<AudienceOrg, 'stakeholder'>): string => org.stakeholder || 'the stakeholder';

/** A person, the stakeholder or the office inside a sentence. */
function nameOf(org: Pick<AudienceOrg, 'people' | 'stakeholder'>, id: string): string {
  if (id === STAKEHOLDER) return bossOf(org);
  if (id === THE_OFFICE) return 'the office';
  const p = personById(org.people, id);
  return p ? nameIn(p) : id;
}

/** "Kai, UI designer"; several as the house rules list people: "Kai, UI designer; Lea, UX designer and Sam, frontend engineer". */
function introductions(people: readonly Person[], max = 8): string {
  const shown = people.slice(0, max).map(introduce);
  if (people.length > max) shown.push(`${people.length - max} more`);
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join('; ')} and ${shown[shown.length - 1]}`;
}

/** A room inside a sentence, as the composer says it: "the design room", "the data & AI room", "the games room". */
export function roomTitle(name: string): string {
  const words = name
    .trim()
    .replace(/^the\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w) ? w : w.toLowerCase()));
  if (words.length === 0) return 'the room';
  return `the ${words.join(' ')}${words[words.length - 1] === 'room' ? '' : ' room'}`;
}

/** "Ada's team", or "the head of design's team" for a head without a first name. */
export const teamTitle = (head: Pick<Person, 'name' | 'title'>): string => `${nameIn(head)}'s team`;

// ---------------------------------------------------------------------------------------------------------------
// Who a message reaches

const MAX_ID = 200;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;

/** A recipient as the office's API and the org tools pass it, checked. */
export function recipientOf(raw: unknown): Recipient {
  if (isObj(raw)) {
    if (raw.kind === 'person' && isId(raw.id)) return { kind: 'person', id: raw.id };
    if (raw.kind === 'room' && isId(raw.id)) return { kind: 'room', id: raw.id };
    if (raw.kind === 'team' && isId(raw.head)) return { kind: 'team', head: raw.head };
    if (raw.kind === 'everyone') return { kind: 'everyone' };
  }
  throw new OrgRefusal('invalid', 'Send it to a person, a room, a team or everyone.');
}

function member(org: Pick<AudienceOrg, 'people'>, id: unknown): Person {
  const p = typeof id === 'string' ? personById(org.people, id) : undefined;
  if (!p) throw new OrgRefusal('unknown', `There's nobody called "${oneLine(String(id), 64)}" in the company.`);
  return p;
}

/** Why `sender` may not message `to` on their own, and who can pass it on instead. */
export function messageRefusal(org: Pick<AudienceOrg, 'people' | 'stakeholder'>, sender: Person, to: string): string {
  const name = capital(nameIn(sender));
  const manager = managerOf(org.people, sender.id);
  const boss = bossOf(org);
  if (to === STAKEHOLDER) {
    return `${name} can write to ${boss} once ${boss} has written to them; until then, ${manager ? `ask ${nameIn(manager)} to take it up, or ` : ''}use ask.`;
  }
  if (sender.level === 'ceo') {
    const head = chainUp(org.people, to).find((p) => p.reportsTo === sender.id);
    return `${name} can message ${boss} and their own reports; ask ${head ? nameIn(head) : 'a head'} to pass this on.`;
  }
  if (!manager) return `${name} has no manager in the org, so they can message only their own reports.`;
  return `${name} can message their manager, their own team and their reports; ask ${nameIn(manager)} to pass this on.`;
}

/** Who a message reaches: who gets a copy (never the sender), and the audience each copy names; null for one person. */
export interface Reach {
  to: string[];
  audience: Omit<Audience, 'group'> | null;
}

type GroupRecipient = Exclude<Recipient, { kind: 'person' }>;

/**
 * Who a recipient reaches under the sender's authority, or a refusal that says why not. The stakeholder reaches anyone.
 * The CEO reaches everyone, any room and any team; a head their own room, their own team and the teams inside it. Past
 * that, a room, a team or everyone goes only where the sender may message each person on their own (mayMessage), and a
 * message to one person always goes by mayMessage.
 */
export function reach(org: AudienceOrg, by: string, to: unknown): Reach {
  const sender = by === STAKEHOLDER ? null : member(org, by);
  const r = recipientOf(to);
  if (r.kind === 'person') return { to: [personTo(org, sender, r.id)], audience: null };
  const { members, audience } = groupOf(org, r);
  const others = members.filter((p) => p.id !== by);
  if (others.length === 0) throw new OrgRefusal('invalid', nobodyThere(org, r, audience.title, others.length < members.length));
  if (sender && !granted(org, sender, r)) {
    const outsider = others.find((p) => !mayMessage(org.people, sender.id, p.id));
    if (outsider) throw new OrgRefusal('not-allowed', groupRefusal(org, sender, r, audience.title, outsider));
  }
  return { to: others.map((p) => p.id), audience };
}

function personTo(org: AudienceOrg, sender: Person | null, id: string): string {
  if (sender === null) {
    if (id === STAKEHOLDER) throw new OrgRefusal('invalid', 'Pick someone in the company to send it to.');
    return member(org, id).id;
  }
  if (id === sender.id) throw new OrgRefusal('invalid', `${capital(nameIn(sender))} can't send a message to themselves.`);
  if (id !== STAKEHOLDER) member(org, id);
  if (!mayMessage(org.people, sender.id, id, org.wroteTo(sender.id))) throw new OrgRefusal('not-allowed', messageRefusal(org, sender, id));
  return id;
}

/** Everyone in a room, a team (its head and everyone below them) or the company, in the org's order. */
function groupOf(org: AudienceOrg, r: GroupRecipient): { members: Person[]; audience: Omit<Audience, 'group'> } {
  switch (r.kind) {
    case 'room': {
      const members = org.people.filter((p) => p.room === r.id);
      const name = org.roomName(r.id);
      if (name === null && members.length === 0) throw new OrgRefusal('unknown', `There's no room called "${oneLine(r.id, 64)}" in the office.`);
      return { members, audience: { kind: 'room', id: r.id, title: roomTitle(name || titleFromId(r.id)) } };
    }
    case 'team': {
      const head = member(org, r.head);
      if (!isManager(head)) {
        const manager = managerOf(org.people, head.id);
        throw new OrgRefusal('invalid', `${capital(nameIn(head))} doesn't lead a team; send it to ${nameIn(head)}${manager ? ` or to ${teamTitle(manager)}` : ''}.`);
      }
      const team = new Set([head.id, ...below(org.people, head.id).map((p) => p.id)]);
      return { members: org.people.filter((p) => team.has(p.id)), audience: { kind: 'team', id: head.id, title: teamTitle(head) } };
    }
    case 'everyone':
      return { members: [...org.people], audience: { kind: 'everyone', id: null, title: 'everyone' } };
  }
}

/** Why a room, a team or everyone holds nobody to send to; a team always holds its head, so only the head meets it. */
function nobodyThere(org: AudienceOrg, r: GroupRecipient, title: string, senderInside: boolean): string {
  const nobody = senderInside ? 'nobody else' : 'nobody';
  if (r.kind === 'team') return `${capital(nameOf(org, r.head))} has nobody in their team yet, so there's nobody to send it to.`;
  if (r.kind === 'everyone') return `There's ${nobody} in the company yet.`;
  return `${capital(nobody)} works in ${title} yet, so there's nobody to send it to.`;
}

/** What the CEO and the heads reach beyond the people they may message one by one. */
function granted(org: AudienceOrg, sender: Person, r: GroupRecipient): boolean {
  if (sender.level === 'ceo') return true;
  if (sender.level !== 'head') return false;
  if (r.kind === 'room') return r.id === sender.room;
  if (r.kind === 'team') return r.head === sender.id || below(org.people, sender.id).some((p) => p.id === r.head);
  return false;
}

function groupRefusal(org: AudienceOrg, sender: Person, r: GroupRecipient, title: string, outsider: Person): string {
  const manager = managerOf(org.people, sender.id);
  const instead = manager ? `ask ${nameIn(manager)} to pass this on` : `nobody is above ${nameIn(sender)} to pass it on`;
  if (r.kind === 'everyone') return `Only the CEO messages everyone; ${instead}.`;
  const theirs =
    sender.level === 'head'
      ? `${roomTitle(org.roomName(sender.room) || titleFromId(sender.room))}, their own team and the people the org lets them message`
      : 'their manager, their own team and their reports';
  return `${capital(nameIn(sender))} can message ${theirs}, and ${nameIn(outsider)} in ${title} isn't one of them; ${instead}.`;
}

/** The people the stakeholder means a message for: each a person in the company, each once, in the order given. */
export function forOf(org: AudienceOrg, by: string, raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new OrgRefusal('invalid', 'Say who it is for as a list of people.');
  if (raw.length === 0) return [];
  if (by !== STAKEHOLDER) throw new OrgRefusal('not-allowed', `Only ${bossOf(org)} says who a message is for; name them in the words instead.`);
  const ids = [...new Set<unknown>(raw)];
  if (ids.length > TRACE_LIMITS.for) throw new OrgRefusal('invalid', `A message can be for up to ${TRACE_LIMITS.for} people; this one names ${ids.length}.`);
  return ids.map((id) => member(org, id).id);
}

export interface SendInput {
  to: unknown;
  /** Cleaned and capped by the company, as the words of every message are. */
  text: string;
  /** Whom the stakeholder means it for. */
  for?: unknown;
  /** The stakeholder typed the words in a box; it marks no one else's message. */
  typed?: boolean;
}

/**
 * The messages a send makes: one per person it reaches, and none for the sender. Copies for a room, a team or everyone
 * name the audience and share its group, the first copy's id, so the trace and the 3D view see one message. The people
 * the stakeholder means it for go on every copy.
 */
export function planSend(org: AudienceOrg, by: string, input: SendInput, make: MakeMessage): Message[] {
  const reached = reach(org, by, input.to);
  const meant = forOf(org, by, input.for);
  if (!input.text) throw new OrgRefusal('invalid', 'Say something to send.');
  const typed = by === STAKEHOLDER && input.typed === true;
  const copies = reached.to.map((to) => make(by, to, input.text, { ...(meant.length > 0 ? { for: [...meant] } : {}), ...(typed ? { typed: true } : {}) }));
  const audience = reached.audience;
  const group = copies[0]?.id;
  if (!audience || group === undefined) return copies;
  return copies.map((m) => ({ ...m, audience: { ...audience, group } }));
}

// ---------------------------------------------------------------------------------------------------------------
// The words a turn carries

function forSentence(m: Message, org: Pick<AudienceOrg, 'people' | 'stakeholder'>): string | null {
  const meant = (m.for ?? []).map((id) => personById(org.people, id)).filter((p): p is Person => p !== undefined);
  if (meant.length === 0) return null;
  const boss = capital(bossOf(org));
  const others = meant.filter((p) => p.id !== m.to);
  if (others.length === meant.length) return `${boss} means this for ${introductions(others)}.`;
  return others.length === 0 ? `${boss} means this for you.` : `${boss} means this for you and ${introductions(others)}.`;
}

/**
 * The words a person's turn carries for a message: its text, what a relayer added and whom the stakeholder means it
 * for. They all go between the turn's two marker lines, so none of it can pass for a message of its own.
 */
export function turnWords(m: Message, org: Pick<AudienceOrg, 'people' | 'stakeholder'>): string {
  const parts = [m.text];
  if (m.note) parts.push(`${capital(nameOf(org, m.from))} adds: ${m.note}`);
  const meant = forSentence(m, org);
  if (meant) parts.push(meant);
  return parts.join('\n\n');
}

/** The turn that carries a message to its person: who it is from and its audience, then its words inside the fence. */
export function messageTurn(m: Message, org: Pick<AudienceOrg, 'people' | 'stakeholder'>, fence: string): string {
  return turnText({ ...m, text: turnWords(m, org) }, org.people, org.stakeholder, fence);
}

// ---------------------------------------------------------------------------------------------------------------
// Acknowledgements and cites

export interface AckInput {
  message: unknown;
  agree: unknown;
  /** Cleaned by the company; kept to one line of TRACE_LIMITS.ackText characters here. */
  text: string;
}

/**
 * An acknowledgement of a message sent to `by`: whether they agree, and one sentence on what they will do with it or why
 * they disagree. Their own copy only. Acknowledging it again replaces the first: the id is the message's, and the
 * reducer keeps one per message.
 */
export function ackFor(org: AudienceOrg, messages: readonly Message[], by: string, input: AckInput, at: number): Ack {
  if (by === STAKEHOLDER) throw new OrgRefusal('not-allowed', 'People in the company acknowledge the messages they get; yours need no acknowledgement.');
  const person = member(org, by);
  const id = typeof input.message === 'string' ? input.message.trim() : '';
  if (!id) throw new OrgRefusal('invalid', 'Say which message you acknowledge: the id its turn names, like m-12.');
  const m = messages.find((x) => x.id === id);
  if (!m) throw new OrgRefusal('unknown', `There's no message ${oneLine(id, 40)}.`);
  if (m.to !== by) {
    const mine = heldBy(familyOf(messages, m.id), by)[0];
    throw new OrgRefusal(
      'not-allowed',
      mine
        ? `Message ${m.id} went to ${nameOf(org, m.to)}; ${nameIn(person)}'s own copy is message ${mine.id}, so acknowledge that one.`
        : `Message ${m.id} went to ${nameOf(org, m.to)}, and ${nameIn(person)} can acknowledge only messages sent to them.`,
    );
  }
  if (typeof input.agree !== 'boolean') throw new OrgRefusal('invalid', 'Say whether you agree with it: agree is true or false.');
  const text = oneLine(typeof input.text === 'string' ? input.text : '', TRACE_LIMITS.ackText);
  if (!text) throw new OrgRefusal('invalid', input.agree ? 'Say in one sentence what you will do with it.' : 'Say in one sentence why you disagree.');
  return { id: ackIdFor(m.id), message: m.id, by, agree: input.agree, text, at };
}

/**
 * The messages a report, a status line or a task by `by` answers: each once, TRACE_LIMITS.cites at most, and each one
 * they can see, sent to them or by them (their copies, and the relays they made). A desk can't put its words into the
 * trace of a message it never had.
 */
export function citesOf(org: Pick<AudienceOrg, 'people' | 'stakeholder'>, messages: readonly Message[], by: string, raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new OrgRefusal('invalid', 'Cite messages as a list of their ids, like ["m-12"].');
  const ids = [...new Set<unknown>(raw.map((id: unknown) => (typeof id === 'string' ? id.trim() : id)))];
  if (ids.length > TRACE_LIMITS.cites) throw new OrgRefusal('invalid', `Cite up to ${TRACE_LIMITS.cites} messages; this names ${ids.length}.`);
  const byId = new Map(messages.map((m) => [m.id, m]));
  return ids.map((id) => {
    if (typeof id !== 'string' || id === '') throw new OrgRefusal('invalid', 'Cite a message by its id, like "m-12".');
    const m = byId.get(id);
    if (!m) throw new OrgRefusal('unknown', `There's no message ${oneLine(id, 40)} to cite.`);
    if (m.to !== by && m.from !== by) {
      const who = capital(nameOf(org, by));
      const mine = heldBy(familyOf(messages, m.id), by)[0];
      throw new OrgRefusal(
        'not-allowed',
        mine
          ? `${who} can cite only messages sent to them or by them; their own copy of message ${m.id} is message ${mine.id}, so cite that one.`
          : `${who} can cite only messages sent to them or by them, and message ${m.id} is neither.`,
      );
    }
    return id;
  });
}

/**
 * A send's copies in groups whose message events each fit one line of the company's log (`budget` bytes, under
 * store.ts's MAX_LINE_BYTES), in order, so a long message to everyone is kept whole over several lines. Null when one
 * copy alone can't fit a line.
 */
export function linesOf(copies: readonly Message[], budget: number): Message[][] | null {
  const encoder = new TextEncoder();
  const lines: Message[][] = [];
  let line: Message[] = [];
  let used = 0;
  for (const m of copies) {
    // The event as the log writes it, and the comma between events in a batch.
    const size = encoder.encode(JSON.stringify({ type: 'message', message: m })).byteLength + 1;
    if (size > budget) return null;
    if (line.length > 0 && used + size > budget) {
      lines.push(line);
      line = [];
      used = 0;
    }
    line.push(m);
    used += size;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Remind and Escalate

export interface FollowUpInput {
  /** Any id of the stakeholder's message: the one they sent, a copy, a relay of it, or the group its copies share. */
  message: unknown;
  person: unknown;
}

/** A follow-up from the office; `fresh` is false when the same one still waits for its person and nothing new was made. */
export interface FollowUp {
  message: Message;
  fresh: boolean;
}

/** What waits on someone a message reached, by the trace's own rules but without its ten minutes' grace. */
interface Waiting {
  /** Their copies and relays of it: the first delivered first, then the rest oldest first. */
  held: Message[];
  /** People the stakeholder means it for who haven't got it, for whom the trace names this person as its holder. */
  passOn: Person[];
  /** A manager who got it on their own (not as one of a room, a team or everyone) and passed it on to nobody. */
  unpassed: boolean;
  /** Their newest acknowledgement of it: of their copy, of any copy or relay of it, or of a follow-up. */
  ack: Ack | null;
}

/** A message's copies and relays that went to people, in the trace's order of stops. */
const stopsOf = (family: MessageFamily): Message[] => [...family.copies, ...family.relays].filter((m) => m.to !== STAKEHOLDER && m.to !== THE_OFFICE);

/** Everyone the stakeholder means it for, each once: what its copies name. */
const meantFor = (family: MessageFamily): string[] => [...new Set(family.copies.flatMap((m) => m.for ?? []))];

function heldBy(family: MessageFamily, person: string): Message[] {
  return [...family.copies, ...family.relays]
    .filter((m) => m.to === person)
    .sort((a, b) => {
      if (a.deliveredAt !== null && b.deliveredAt !== null) return a.deliveredAt - b.deliveredAt;
      if (a.deliveredAt !== null) return -1;
      if (b.deliveredAt !== null) return 1;
      return a.at - b.at;
    });
}

/** Who holds a message on its way to someone it hasn't reached, as the trace's not-reached flag names them. */
function holderOf(people: readonly Person[], person: string, family: MessageFamily): string | null {
  const stops = stopsOf(family);
  const has = new Set(stops.map((m) => m.to));
  const manager = chainUp(people, person).find((p) => has.has(p.id));
  if (manager) return manager.id;
  const direct = family.copies.filter((m) => m.to !== STAKEHOLDER && m.to !== THE_OFFICE);
  return (direct.find((m) => m.deliveredAt !== null) ?? direct[0] ?? stops[0])?.to ?? null;
}

function waitingOn(org: AudienceOrg, family: MessageFamily, acks: readonly Ack[], person: Person): Waiting {
  const held = heldBy(family, person.id);
  const reached = new Set(stopsOf(family).map((m) => m.to));
  const passOn = meantFor(family)
    .filter((id) => !reached.has(id))
    .map((id) => personById(org.people, id))
    .filter((p): p is Person => p !== undefined && holderOf(org.people, p.id, family) === person.id);
  const unpassed = isManager(person) && held.some((m) => !m.audience) && !family.relays.some((r) => r.from === person.id);
  const followUps = new Set(family.followUps.map((m) => m.id));
  let ack: Ack | null = null;
  for (const a of acks) {
    if (a.by === person.id && (family.ids.has(a.message) || followUps.has(a.message)) && (!ack || a.at >= ack.at)) ack = a;
  }
  return { held, passOn, unpassed, ack };
}

function stakeholderOnly(org: AudienceOrg, by: string, what: string): void {
  if (by !== STAKEHOLDER) throw new OrgRefusal('not-allowed', `Only ${bossOf(org)} can ${what}.`);
}

/**
 * The stakeholder's message any of its ids names, with `sent`, the id it goes by as they sent it: its group for a room,
 * a team or everyone (which copy the id named makes no difference), else the message itself.
 */
function stakeholderFamily(messages: readonly Message[], raw: unknown): { family: MessageFamily; root: Message; sent: string } {
  const id = typeof raw === 'string' ? raw.trim() : '';
  const family = id ? familyOf(messages, id) : undefined;
  const root = family?.root;
  if (!family || !root) throw new OrgRefusal('unknown', "There's no message of yours with that id.");
  if (root.from !== STAKEHOLDER) throw new OrgRefusal('not-allowed', 'Only your own messages have a trace to follow up.');
  return { family, root, sent: root.audience?.group ?? root.id };
}

/** A follow-up cites the stakeholder's message as they sent it, and the copy it is about. */
const citesFor = (sent: string, own: Message | undefined): string[] => [...new Set([sent, ...(own ? [own.id] : [])])];

/** The same follow-up still waiting for its person is the one to give back, so pressing twice sends it once. */
function followUp(messages: readonly Message[], make: MakeMessage, to: string, text: string, cites: string[]): FollowUp {
  const waiting = messages.find((m) => m.from === THE_OFFICE && m.to === to && m.deliveredAt === null && m.text === text);
  return waiting ? { message: waiting, fresh: false } : { message: make(THE_OFFICE, to, text, { cites }), fresh: true };
}

/** "message m-13, from Robin to the design room", or "message m-15, which Ada passed on from Robin"; "you" for its reader. */
function aboutPhrase(org: AudienceOrg, m: Message, reader: string): string {
  const name = (id: string) => (id === reader ? 'you' : nameOf(org, id));
  if (m.relayOf) return `message ${m.id}, which ${name(m.from)} passed on from ${name(m.origin ?? STAKEHOLDER)}`;
  return `message ${m.id}, from ${name(m.from)}${m.audience ? ` to ${m.audience.title}` : ''}`;
}

const quote = (text: string): string => `“${clip(text, 200)}”`;

function passOnSentence(org: AudienceOrg, own: Message, w: Waiting, person: Person): string {
  const under = new Set(below(org.people, person.id).map((p) => p.id));
  const can = w.passOn.filter((p) => under.has(p.id));
  const how = can.length === 0 ? '' : can.length === w.passOn.length ? `: pass it on with relay (message ${own.id})` : `: pass it on to ${introductions(can)} with relay (message ${own.id})`;
  return `${capital(bossOf(org))} means it for ${introductions(w.passOn)}, who ${w.passOn.length === 1 ? "hasn't" : "haven't"} got it yet${how}.`;
}

function reminderText(org: AudienceOrg, own: Message, w: Waiting, person: Person): string {
  const lines = [`A reminder about ${aboutPhrase(org, own, person.id)}: ${quote(own.text)}`];
  if (w.passOn.length > 0) lines.push(passOnSentence(org, own, w, person));
  if (!w.ack) {
    lines.push(
      w.unpassed && w.passOn.length === 0
        ? `Pass it on with relay (message ${own.id}) to whoever it concerns below you, or say why not with ack.`
        : `Acknowledge it with ack (message ${own.id}): one sentence on what you will do with it, or why you disagree.`,
    );
  } else if (w.passOn.length === 0) {
    lines.push(`You acknowledged it: ${quote(w.ack.text)} ${capital(bossOf(org))} would like to know where it stands: post a status line, or report when it's done.`);
  }
  return lines.join('\n\n');
}

/**
 * Remind: a message from the office to someone who holds one of the stakeholder's messages, citing it and saying plainly
 * what waits on them: passing it on to the people it is for, passing it on at all, or acknowledging it. Only from the
 * stakeholder, and only to someone it has reached, since a reminder to anyone else would wait with the message.
 */
export function remindOf(org: AudienceOrg, messages: readonly Message[], acks: readonly Ack[], by: string, input: FollowUpInput, make: MakeMessage): FollowUp {
  stakeholderOnly(org, by, 'remind someone of a message');
  const { family, sent } = stakeholderFamily(messages, input.message);
  const person = member(org, input.person);
  const name = nameIn(person);
  const w = waitingOn(org, family, acks, person);
  const own = w.held[0];
  if (!own) {
    if (!meantFor(family).includes(person.id)) throw new OrgRefusal('conflict', `Message ${sent} didn't go to ${name}, so there's nothing to remind them of.`);
    const holder = holderOf(org.people, person.id, family);
    throw new OrgRefusal('conflict', `${capital(name)} hasn't had message ${sent} yet; ${holder ? `${nameOf(org, holder)} has it, so remind them` : 'remind whoever has it'}.`);
  }
  if (own.deliveredAt === null) throw new OrgRefusal('conflict', `${capital(name)} hasn't got message ${own.id} yet, so a reminder would only wait with it; escalate it instead.`);
  return followUp(messages, make, person.id, reminderText(org, own, w, person), citesFor(sent, own));
}

function escalationText(org: AudienceOrg, family: MessageFamily, root: Message, sent: string, person: Person, to: Person, w: Waiting): string {
  const boss = capital(bossOf(org));
  const name = nameIn(person);
  const own = w.held[0];
  const first: string[] = [];
  if (!own) {
    first.push(`${boss} escalated this to you: message ${sent} hasn't reached ${introduce(person)}, and ${bossOf(org)} means it for them.`);
    const holder = holderOf(org.people, person.id, family);
    const theirs = holder === null ? undefined : heldBy(family, holder)[0];
    if (holder === to.id) first.push(`You have it as message ${theirs?.id ?? sent}: pass it on with relay.`);
    else if (holder !== null) first.push(`${capital(nameOf(org, holder))} has it.`);
  } else {
    first.push(`${boss} escalated this to you: ${aboutPhrase(org, own, to.id)}, is waiting on ${introduce(person)}.`);
    if (own.deliveredAt === null) first.push(`It hasn't reached ${name} yet.`);
    else {
      if (w.passOn.length > 0) first.push(`${boss} means it for ${introductions(w.passOn)}, and ${name} hasn't passed it on yet.`);
      if (!w.ack) first.push(w.unpassed && w.passOn.length === 0 ? `${capital(name)} hasn't passed it on or acknowledged it yet.` : `${capital(name)} hasn't acknowledged it yet.`);
      else if (w.passOn.length === 0) first.push(`${capital(name)} acknowledged it${w.ack.agree ? '' : ' and disagrees'}: ${quote(w.ack.text)}`);
    }
  }
  return [first.join(' '), `The message: ${quote((own ?? root).text)}`, 'See that it gets where it should, and acknowledge this with ack: one sentence on what you will do.'].join('\n\n');
}

/**
 * Escalate: a message from the office to the manager of someone a stakeholder's message waits on (or the CEO when they
 * have none), citing it and saying what is stuck. Only from the stakeholder; never about the CEO, who answers to them.
 * It concerns someone the message reached, or someone it is meant for and hasn't reached.
 */
export function escalateOf(org: AudienceOrg, messages: readonly Message[], acks: readonly Ack[], by: string, input: FollowUpInput, make: MakeMessage): FollowUp {
  stakeholderOnly(org, by, 'escalate a message');
  const { family, root, sent } = stakeholderFamily(messages, input.message);
  const person = member(org, input.person);
  if (person.level === 'ceo') {
    throw new OrgRefusal('invalid', `${person.name === person.title ? 'The CEO' : `${person.name}, the CEO,`} answers only to you; remind them instead.`);
  }
  const to = managerOf(org.people, person.id) ?? org.people.find((p) => p.level === 'ceo');
  if (!to || to.id === person.id) throw new OrgRefusal('unknown', `Nobody is above ${nameIn(person)} in the org to tell; remind them instead.`);
  const w = waitingOn(org, family, acks, person);
  if (w.held.length === 0 && !meantFor(family).includes(person.id)) {
    throw new OrgRefusal('conflict', `Message ${sent} didn't go to ${nameIn(person)} and isn't meant for them, so there's nothing to escalate about them.`);
  }
  return followUp(messages, make, to.id, escalationText(org, family, root, sent, person, to, w), citesFor(sent, w.held[0]));
}
