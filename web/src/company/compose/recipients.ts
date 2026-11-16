// Who a message goes to (SPEC-v3.md "Steering" 2): a person, a room, a team (a head or team lead and everyone under
// them) or everyone, and who it is for. The picker's choices, who each reaches, the box's label and hint, and the
// composer's address. Pure, so it can be tested; RecipientPicker and Composer only draw it.
import { below, type CompanyView, isManager, type PersonView, STAKEHOLDER } from '../../../../src/core/company.ts';
import { countWord } from '../../../../src/core/now.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import type { Recipient } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute } from '../../lib/format.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { waitsForWords } from '../pauseWords.ts';
import { called, flatten, orgOutline, roomName } from '../people/peopleModel.ts';
import { boxHint } from '../person/personModel.ts';
import { listOf } from '../trace/traceModel.ts';

type Studio = Pick<Snapshot, 'studio'>;
type People = Pick<CompanyView, 'people'>;

export interface RecipientChoice {
  /** The select's value: "person:kai", "room:design", "team:head-of-design", "everyone". */
  key: string;
  recipient: Recipient;
  /** As the list shows it: "Ada, head of design", "The design room, four people". */
  label: string;
  /** Inside a sentence: "Ada", "the design room", "Ada's team", "everyone". */
  title: string;
  /** Who gets a copy, in the org's order. */
  reach: string[];
}

export interface RecipientChoices {
  everyone: RecipientChoice;
  rooms: RecipientChoice[];
  teams: RecipientChoice[];
  people: RecipientChoice[];
}

export function recipientKey(r: Recipient): string {
  switch (r.kind) {
    case 'person':
      return `person:${r.id}`;
    case 'room':
      return `room:${r.id}`;
    case 'team':
      return `team:${r.head}`;
    case 'everyone':
      return 'everyone';
  }
}

/**
 * A room's name inside a sentence: "the design room", "the data & AI room" (words in capitals keep them), and "the games
 * room" for a room already named one, never "the games room room".
 */
export function roomTitle(snapshot: Studio, room: string): string {
  const name = roomName(snapshot, room)
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w) ? w : w.toLowerCase()))
    .join(' ');
  return /(^|\s)room$/.test(name) ? `the ${name}` : `the ${name} room`;
}

/** The people in the org's order: the CEO, then each head with their people, as People lists them. */
function inOrgOrder(snapshot: Studio, company: People): PersonView[] {
  return flatten(orgOutline(snapshot, company)).map((n) => n.person);
}

/** Who gets a copy: the person; everyone in the room; the head and everyone under them; everyone. */
export function reachOf(snapshot: Studio, company: People, r: Recipient): string[] {
  const ordered = inOrgOrder(snapshot, company);
  switch (r.kind) {
    case 'person':
      return ordered.some((p) => p.id === r.id) ? [r.id] : [];
    case 'room':
      return ordered.filter((p) => p.room === r.id).map((p) => p.id);
    case 'team': {
      if (!ordered.some((p) => p.id === r.head)) return [];
      const team = new Set([r.head, ...below(company.people, r.head).map((p) => p.id)]);
      return ordered.filter((p) => team.has(p.id)).map((p) => p.id);
    }
    case 'everyone':
      return ordered.map((p) => p.id);
  }
}

const countPeople = (n: number): string => `${countWord(n)} ${n === 1 ? 'person' : 'people'}`;

/** "Ada", "the design room", "Ada's team", "everyone". */
export function recipientTitle(snapshot: Studio, company: People, r: Recipient): string {
  switch (r.kind) {
    case 'person': {
      const p = company.people.find((x) => x.id === r.id);
      return p ? called(p) : 'them';
    }
    case 'room':
      return roomTitle(snapshot, r.id);
    case 'team': {
      const head = company.people.find((x) => x.id === r.head);
      return head ? `${called(head)}'s team` : 'their team';
    }
    case 'everyone':
      return 'everyone';
  }
}

/** Every choice the picker offers. Teams are the heads' and team leads': the CEO's is everyone. */
export function recipientChoices(snapshot: Studio, company: People): RecipientChoices {
  const ordered = inOrgOrder(snapshot, company);
  const choice = (recipient: Recipient, label: (title: string, reach: string[]) => string): RecipientChoice => {
    const title = recipientTitle(snapshot, company, recipient);
    const reach = reachOf(snapshot, company, recipient);
    return { key: recipientKey(recipient), recipient, label: label(title, reach), title, reach };
  };
  const rooms = [...new Set(ordered.map((p) => p.room))].map((id) => choice({ kind: 'room', id }, (title, reach) => `${capital(title)}, ${countPeople(reach.length)}`));
  const teams = ordered
    .filter((p) => isManager(p) && p.level !== 'ceo' && below(company.people, p.id).length > 0)
    .map((p) => choice({ kind: 'team', head: p.id }, (title, reach) => `${capital(title)}, ${countPeople(reach.length)}`));
  return {
    everyone: choice({ kind: 'everyone' }, (_, reach) => `Everyone, ${countPeople(reach.length)}`),
    rooms,
    teams,
    people: ordered.map((p) => choice({ kind: 'person', id: p.id }, () => personLabel(p))),
  };
}

/**
 * The choices that include one person, for the box in their panel: them, their room, the teams they are in and
 * everyone, so their copy lands in the thread the panel shows.
 */
export function choicesAround(choices: RecipientChoices, person: string): RecipientChoices {
  const has = (c: RecipientChoice) => c.reach.includes(person);
  return { everyone: choices.everyone, rooms: choices.rooms.filter(has), teams: choices.teams.filter(has), people: choices.people.filter(has) };
}

/** The choice a key names, if the company still has it. */
export function choiceOf(choices: RecipientChoices, key: string): RecipientChoice | null {
  if (key === choices.everyone.key) return choices.everyone;
  return [...choices.rooms, ...choices.teams, ...choices.people].find((c) => c.key === key) ?? null;
}

/** The box's label: "Message the design room", "Message Ada's team", "Message everyone", "Message Ada". */
export const boxLabelFor = (snapshot: Studio, company: People, r: Recipient): string => `Message ${recipientTitle(snapshot, company, r)}`;

/** A plain message to one person goes the way it always has (and can be unsent); the rest need steering's send. */
export const usesSay = (r: Recipient, forPeople: readonly string[]): boolean => r.kind === 'person' && forPeople.length === 0;

/** Who it can be for: anyone in the company it isn't already for, in the org's order. */
export function forChoices(snapshot: Studio, company: People, forPeople: readonly string[]): PersonView[] {
  return inOrgOrder(snapshot, company).filter((p) => !forPeople.includes(p.id));
}

/**
 * What will happen to it, by who it goes to and who it is for, in the words the person panel's box uses: "Ada passes it
 * on to whoever it concerns.", "Ada, Mina, Jules and Pia get it. Busy people read it at their next step."
 */
export function sendHint(snapshot: Studio, company: Pick<CompanyView, 'people' | 'pause' | 'phase'>, r: Recipient, forPeople: readonly string[]): string {
  const forNames = listOf(forPeople.map((id) => company.people.find((p) => p.id === id)).filter((p): p is PersonView => p !== undefined).map(called), 4);
  const forLine = forNames ? ` It's for ${forNames}: its trace flags anyone it doesn't reach.` : '';
  if (r.kind === 'person') {
    const p = company.people.find((x) => x.id === r.id);
    if (!p) return 'They have left the company.';
    if (forPeople.length > 0) return `${capital(called(p))} passes it on.${forLine}`;
    return boxHint(company, p);
  }
  const reach = reachOf(snapshot, company, r).map((id) => company.people.find((p) => p.id === id)).filter((p): p is PersonView => p !== undefined);
  if (reach.length === 0) return 'Nobody is there yet, so there is nobody to send it to.';
  const when = company.pause
    ? company.pause.until !== null
      ? ` They read it when the company wakes at ${hourMinute(company.pause.until)}.`
      : ` They read it when ${waitsForWords(company.pause)}.`
    : company.phase === 'stopped'
      ? ' They read it when you resume the company.'
      : ' Busy people read it at their next step; the others start on it now.';
  const who = r.kind === 'everyone' ? `All ${countPeople(reach.length)} get it, and gather in the office for a moment.` : `${capital(listOf(reach.map(called), 5))} ${reach.length === 1 ? 'gets' : 'get'} it.`;
  return `${who}${when}${forLine}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The composer's address: `send`, `send/everyone`, `send/room/design`, `send/team/head-of-design`, `send/person/kai`

export function sendPath(r: Recipient | null): string {
  if (!r) return 'send';
  const enc = encodeURIComponent;
  switch (r.kind) {
    case 'person':
      return `send/person/${enc(r.id)}`;
    case 'room':
      return `send/room/${enc(r.id)}`;
    case 'team':
      return `send/team/${enc(r.head)}`;
    case 'everyone':
      return 'send/everyone';
  }
}

/** The recipient a composer address names (the parts after `send`), or null. */
export function recipientFromPath(parts: readonly string[]): Recipient | null {
  const [kind, raw] = parts;
  const decoded = (): string | null => {
    try {
      return raw ? decodeURIComponent(raw) : null;
    } catch {
      // A malformed escape names nobody.
      return null;
    }
  };
  if (kind === 'everyone') return { kind: 'everyone' };
  const id = decoded();
  if (!id || id.length > 200) return null;
  if (kind === 'person') return { kind: 'person', id };
  if (kind === 'room') return { kind: 'room', id };
  if (kind === 'team') return { kind: 'team', head: id };
  return null;
}

/** "Sent to the design room." */
export const sentLine = (snapshot: Studio, company: People, r: Recipient): string => `Sent to ${recipientTitle(snapshot, company, r)}.`;

export interface GroupSend {
  /** The group id its copies share, which its trace takes. */
  group: string;
  /** "The design room", "Ada's team", "Everyone". */
  to: string;
  /** Inside a sentence: "the design room". */
  title: string;
  text: string;
  at: number;
  copies: number;
}

/** Your messages to rooms, teams and everyone, newest first: one per group, however many copies it has. */
export function groupSends(company: Pick<CompanyView, 'messages'>, limit = 8): GroupSend[] {
  const byGroup = new Map<string, GroupSend>();
  for (const m of company.messages) {
    if (m.from !== STAKEHOLDER || !m.audience || m.relayOf) continue;
    const seen = byGroup.get(m.audience.group);
    if (seen) seen.copies += 1;
    else byGroup.set(m.audience.group, { group: m.audience.group, to: capital(m.audience.title), title: m.audience.title, text: m.text, at: m.at, copies: 1 });
  }
  return [...byGroup.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}
