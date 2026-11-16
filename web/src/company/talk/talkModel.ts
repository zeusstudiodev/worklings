// The talk bar's model (docs/design-v3.md, "Stage and dock", "The talk bar"): who can be named and how a typed `@`
// resolves, the lists the box opens (`@` at the start, `@` after the first word, `/` and a command's choices), the To in
// words, what the hint row says, the send plan (one copy per person a picked room or team doesn't already cover) and what
// a send that went partly says, history, and the bar's state as a reducer. Pure, so it can be tested; TalkBar draws it.
import type { CompanyView, Message, PersonView } from '../../../../src/core/company.ts';
import { countWord } from '../../../../src/core/now.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import type { Recipient } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { reachOf, recipientChoices, recipientKey, recipientTitle, sendHint } from '../compose/recipients.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { browse, findCommands, findOptions, type PaletteCommand, type PaletteStep, RESULTS_SHOWN, SECTIONS } from '../palette/paletteModel.ts';
import { called, inLine, isAtWork, roomName, taskOf, workOf } from '../people/peopleModel.ts';
import { boxHint, MESSAGE_MAX } from '../person/personModel.ts';

type Studio = Pick<Snapshot, 'studio'>;

// ---------------------------------------------------------------------------------------------------------------
// Words the bar says (docs/design-v3.md, "Copy")

export const TEACH = 'Type @ to choose who hears it, / for a command.';
export const RECONNECTING_HINT = 'Sending waits until the office is back. Your words stay.';
export const FOUNDING_MENTION = 'Until the start you talk to the CEO.';
export const FOUNDING_COMMAND = 'Commands work once the company starts. Until then, tell the CEO what you want.';
export const FOUNDING_PLACEHOLDER = 'Tell the CEO what to change';
/** While the CEO's scoping questions wait: the box is the way to answer them in your own words. */
export const SCOPING_PLACEHOLDER = 'Answer the CEO in your own words';
export const NO_COMMAND = 'No command matches. Enter sends it as a message.';
export const NO_CHOICE = 'No choice matches. Try another word.';
export const FOR_HEADING = "Who it's for. You'll see if it reaches them.";
export const ONCE = 'For this message only';
export const UNSENT_BACK = 'Unsent. Your words are back in the box.';
/** The counter shows from this many characters. */
export const COUNTER_FROM = 3_500;

// ---------------------------------------------------------------------------------------------------------------
// Folding: how typed words are compared with names

/** Lower case without accents, curly quotes straightened, spaces collapsed: "Léa" and "lea" are the same name. */
export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** Where a typed mention may end: the end of the text, a space or punctuation. */
const BOUNDARY = /[\s.,;:!?)\]}"'’”]/;

// ---------------------------------------------------------------------------------------------------------------
// Who can be named

export type ChoiceGroup = 'everyone' | 'rooms' | 'teams' | 'people';

export interface TalkChoice {
  /** recipientKey: "person:kai", "room:design", "team:head-of-design", "everyone". */
  key: string;
  recipient: Recipient;
  group: ChoiceGroup;
  /** As the lists show it: "All hands", "The design room", "Ada's team", "Ada, head of design". */
  label: string;
  /** Under it: who it reaches, or what they are doing. */
  detail: string;
  /** Inside a sentence: "everyone", "the design room", "Ada's team", "Ada", "the CEO". */
  title: string;
  /** Who gets a copy, in the org's order. */
  reach: string[];
  /** What a typed mention may be, folded: a first name, a title, an id, a room's or a team's name. */
  names: string[];
  /** What the lists' filter reads, folded: a person's first name, the phrases shown, and ids. */
  search: { first: string | null; phrases: string[]; ids: string[] };
  /** The person, for faces and ranking; null for a room, a team or everyone. */
  person: PersonView | null;
}

/** What `@` may resolve to at the start and in the To's picker: all hands only by these, so a slip never reaches everyone. */
export const ALL_HANDS_NAMES = ['all', 'everyone', 'all-hands', 'all hands'];

const countPeople = (n: number): string => `${countWord(n)} ${n === 1 ? 'person' : 'people'}`;

/** "Kai", "Kai and Mina", "Kai, Mina, Ada and Pia", then three and "and two more". */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${countWord(names.length - 3)} more`;
}

/**
 * What the list's active option would do, for the hint row while the list is open: "The design room hears it: Ada,
 * Mina, Jules and Pia get it.", "The CEO gets it and passes it on to Mina.", or a command's own line.
 */
export function optionLine(snapshot: Studio, company: Company, option: ListOption, to: readonly Recipient[], now?: number): string | null {
  const pick = option.pick;
  switch (pick.kind) {
    case 'pick':
    case 'instead':
      return `${capital(oneTo(snapshot, company, pick.choice.recipient))} hears it: ${whatHappens(snapshot, company, [pick.choice.recipient], [], false, now)}`;
    case 'for':
      return pick.choice.recipient.kind === 'person' ? whatHappens(snapshot, company, to, [pick.choice.recipient.id], to.length > 1, now) : null;
    case 'command':
      return pick.command.hint;
    case 'option':
      return option.detail;
  }
}

/**
 * Everyone, each room, each team and each person, as the To's picker and the `@` list offer them. Without steering only
 * people: a room, a team and all hands need steering's send.
 */
export function talkChoices(snapshot: Studio, company: CompanyView, now: number, options: { steering: boolean }): TalkChoice[] {
  const all = recipientChoices(snapshot, company);
  const byId = new Map(company.people.map((p) => [p.id, p]));
  const first = (id: string) => {
    const p = byId.get(id);
    return p ? (p.level === 'ceo' && p.name !== p.title ? p.name : called(p)) : id;
  };
  const out: TalkChoice[] = [];
  if (options.steering) {
    out.push({
      key: all.everyone.key,
      recipient: all.everyone.recipient,
      group: 'everyone',
      label: 'All hands',
      detail: `Everyone, ${countPeople(all.everyone.reach.length)}. They gather in the office for a moment.`,
      title: 'everyone',
      reach: all.everyone.reach,
      names: ALL_HANDS_NAMES,
      search: { first: null, phrases: ALL_HANDS_NAMES, ids: [] },
      person: null,
    });
    for (const r of all.rooms) {
      const id = r.recipient.kind === 'room' ? r.recipient.id : '';
      const name = roomName(snapshot, id);
      const names = unique([fold(name), fold(`${name} room`), fold(r.title), fold(id)]);
      out.push({
        key: r.key,
        recipient: r.recipient,
        group: 'rooms',
        label: capital(r.title),
        detail: `${capital(countPeople(r.reach.length))}: ${namesList(r.reach.map(first))}`,
        title: r.title,
        reach: r.reach,
        names,
        search: { first: null, phrases: unique([fold(capital(r.title)), fold(name), fold(`${name} room`)]), ids: [fold(id)] },
        person: null,
      });
    }
    for (const t of all.teams) {
      const head = t.recipient.kind === 'team' ? t.recipient.head : '';
      const others = t.reach.filter((id) => id !== head).map(first);
      out.push({
        key: t.key,
        recipient: t.recipient,
        group: 'teams',
        label: capital(t.title),
        detail: others.length > 0 ? `${namesList(others)}, and ${first(head)}` : first(head),
        title: t.title,
        reach: t.reach,
        names: unique([fold(t.title)]),
        search: { first: null, phrases: [fold(t.title)], ids: [fold(head)] },
        person: null,
      });
    }
  }
  for (const c of all.people) {
    const p = c.recipient.kind === 'person' ? byId.get(c.recipient.id) : undefined;
    if (!p) continue;
    const named = p.name !== p.title;
    out.push({
      key: c.key,
      recipient: c.recipient,
      group: 'people',
      label: personLabel(p),
      detail: doingOf(company, p, now),
      title: called(p),
      reach: c.reach,
      names: unique([fold(p.name), fold(p.title), fold(p.id)]),
      search: { first: named ? fold(p.name) : null, phrases: unique([fold(personLabel(p)), fold(p.title)]), ids: [fold(p.id)] },
      person: p,
    });
  }
  return out;
}

/** A person's line in the lists: "Working: wiring the slot picker", "Off duty", "With you in Claude Code since 14:40". */
function doingOf(company: CompanyView, p: PersonView, now: number): string {
  const work = workOf(company, p, now);
  if (work.kind === 'away') return capital(inLine(work.line));
  const doing = p.status?.text ?? taskOf(company, p.task)?.title ?? null;
  return isAtWork(work) && doing ? `${work.word}: ${inLine(doing)}` : work.word;
}

const unique = (list: readonly string[]): string[] => [...new Set(list.filter(Boolean))];

/** The choice a recipient names, if the company still has it. */
export const choiceFor = (choices: readonly TalkChoice[], r: Recipient): TalkChoice | null => choices.find((c) => c.key === recipientKey(r)) ?? null;

// ---------------------------------------------------------------------------------------------------------------
// Typed mentions

export type Resolution =
  | { kind: 'choice'; choice: TalkChoice }
  /** Several people (or a person and a room) answer to the same name. */
  | { kind: 'ambiguous'; count: number }
  | { kind: 'none' };

export interface Mention {
  /** Where its `@` is. */
  start: number;
  /** Just after it: after the name it matched, or after the word it is. */
  end: number;
  /** As typed: "@kai", "@head of design". */
  raw: string;
  /** Before the first word: it picks who hears the message. After it: who the message is for. */
  leading: boolean;
  resolved: Resolution;
}

/**
 * The longest exact name at `from` (the character after an `@`), case and accents ignored, ending at a space, punctuation
 * or the end. `bound` holds names a list pick wrote ("@kai" written for one of two Kais): they resolve first.
 */
function resolveAt(text: string, from: number, choices: readonly TalkChoice[], bound: Readonly<Record<string, string>>): { end: number; resolved: Resolution } | null {
  const rest = text.slice(from, from + 80);
  let best: { length: number; matches: TalkChoice[] } | null = null;
  for (let k = 1; k <= rest.length; k++) {
    const next = rest[k];
    if (next !== undefined && !BOUNDARY.test(next)) continue;
    const typed = fold(rest.slice(0, k));
    const boundKey = Object.hasOwn(bound, `@${typed}`) ? bound[`@${typed}`] : undefined;
    const pinned = boundKey ? choices.find((c) => c.key === boundKey) : undefined;
    const matches = pinned ? [pinned] : choices.filter((c) => c.names.includes(typed));
    if (matches.length > 0) best = { length: k, matches };
  }
  if (!best) return null;
  const distinct = [...new Map(best.matches.map((c) => [c.key, c])).values()];
  const [only] = distinct;
  return { end: from + best.length, resolved: distinct.length === 1 && only ? { kind: 'choice', choice: only } : { kind: 'ambiguous', count: distinct.length } };
}

/** The word an `@` that names nobody stays as: up to the next space, less the punctuation after it. */
function wordAt(text: string, from: number): number {
  let end = from;
  while (end < text.length && !/\s/.test(text[end] ?? '')) end += 1;
  while (end > from && /[.,;:!?)\]}"'’”]/.test(text[end - 1] ?? '')) end -= 1;
  return end;
}

/** Between leading mentions, and between them and the words: spaces, commas, a colon. */
const LEADING_GAP = /[\s,;:]/;

/** An `@` that starts a mention: at the start, or after a space or an opening mark; never inside a word ("a@b.c"). */
const opensMention = (text: string, at: number): boolean => text[at] === '@' && (at === 0 || /[\s(["“‘']/.test(text[at - 1] ?? ''));

/**
 * The mentions in the box: those before the first word (who hears it) and those after it (who it is for, people only),
 * each resolved by the exact rule. `wordsFrom` is where the words start, after the leading mentions and their gaps.
 */
export function mentionsIn(text: string, choices: readonly TalkChoice[], bound: Readonly<Record<string, string>> = {}): { mentions: Mention[]; wordsFrom: number } {
  const mentions: Mention[] = [];
  let at = 0;
  while (at < text.length && LEADING_GAP.test(text[at] ?? '')) at += 1;
  while (opensMention(text, at)) {
    const found = resolveAt(text, at + 1, choices, bound);
    const end = found ? found.end : wordAt(text, at + 1);
    mentions.push({ start: at, end, raw: text.slice(at, end), leading: true, resolved: found ? found.resolved : { kind: 'none' } });
    at = end;
    while (at < text.length && LEADING_GAP.test(text[at] ?? '')) at += 1;
  }
  const wordsFrom = at;
  const people = choices.filter((c) => c.group === 'people');
  for (let i = wordsFrom; i < text.length; i++) {
    if (!opensMention(text, i)) continue;
    const found = resolveAt(text, i + 1, people, bound);
    const end = found ? found.end : wordAt(text, i + 1);
    if (end === i + 1) continue;
    mentions.push({ start: i, end, raw: text.slice(i, end), leading: false, resolved: found ? found.resolved : { kind: 'none' } });
    i = end - 1;
  }
  return { mentions, wordsFrom };
}

/** What the hint row says about a mention that stays as words, before anything is sent. */
export function wordsLine(m: Mention, choices: readonly TalkChoice[]): string | null {
  if (m.resolved.kind === 'choice') return null;
  if (m.resolved.kind === 'ambiguous') {
    const name = m.raw.slice(1);
    const people = choices.filter((c) => c.group === 'people' && c.names.includes(fold(name)));
    const who = people.length === m.resolved.count ? `${capital(countWord(m.resolved.count))} people are called ${name}` : `${capital(countWord(m.resolved.count))} answer to ${name}`;
    return `${who}, so it stays as words. Pick one from the list.`;
  }
  return `${m.raw} isn't anyone's name, so it stays as words.`;
}

/**
 * The words that go: the leading mentions that pick someone leave the text with the gap after them, since the To says
 * who hears it; one that names nobody stays as the words it is.
 */
export function wordsToSend(text: string, mentions: readonly Mention[], wordsFrom: number): string {
  const leading = mentions.filter((m) => m.leading);
  let out = '';
  leading.forEach((m, i) => {
    const next = leading[i + 1]?.start ?? wordsFrom;
    if (m.resolved.kind !== 'choice') out += text.slice(m.start, next);
  });
  return `${out}${text.slice(wordsFrom)}`.trim();
}

/** Who the leading mentions pick, in their order. */
export function typedPicks(mentions: readonly Mention[]): Recipient[] {
  return mentions.flatMap((m) => (m.leading && m.resolved.kind === 'choice' ? [m.resolved.choice.recipient] : []));
}

/** Who the message is for: the people the mentions after the first word name, less those you said it isn't for. */
export function forPeopleOf(mentions: readonly Mention[], notFor: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of mentions) {
    if (m.leading || m.resolved.kind !== 'choice' || m.resolved.choice.recipient.kind !== 'person') continue;
    const id = m.resolved.choice.recipient.id;
    if (!notFor.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// What the caret is in: an `@` being typed, or a command

export type Trigger =
  /** `at`: the `@`'s index; `query`: what follows it up to the caret. */
  | { kind: 'mention'; at: number; query: string; leading: boolean }
  /** `/` at the very start; `query`: what follows it up to the caret. */
  | { kind: 'command'; query: string }
  | null;

/**
 * What the caret is typing. An `@` opens a list while what follows it, up to the caret, still matches someone or is one
 * word; a `/` at the very start opens the commands while the caret is on its first line.
 */
export function triggerAt(text: string, caret: number, choices: readonly TalkChoice[], bound: Readonly<Record<string, string>> = {}): Trigger {
  const before = text.slice(0, caret);
  if (before.startsWith('/') && !before.includes('\n')) return { kind: 'command', query: before.slice(1) };
  for (let at = caret - 1; at >= 0 && caret - at <= 60; at--) {
    const ch = text[at];
    if (ch === '\n') return null;
    if (ch !== '@' || !opensMention(text, at)) continue;
    const query = text.slice(at + 1, caret);
    const { mentions } = mentionsIn(text, choices, bound);
    const leading = mentions.some((m) => m.leading && m.start === at);
    const pool = leading ? choices : choices.filter((c) => c.group === 'people');
    if (/\s/.test(query) && rankChoices(pool, query, { allHands: leading }).length === 0) return null;
    return { kind: 'mention', at, query, leading };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Finding: the `@` lists filter by what follows the `@`

/** Whether a phrase has a word that starts what was typed: "of de" meets "head of design". */
const atWord = (phrase: string, q: string): boolean => phrase.split(/(?<=[\s'-])/).some((_, i, parts) => parts.slice(i).join('').startsWith(q));

/** How well a query meets a choice: 0 a person's first name, 1 the start of a name or title, 2 a word inside one, 3 an id; null for none. */
function rankOf(c: TalkChoice, q: string): number | null {
  if (!q) return 2;
  const { first, phrases, ids } = c.search;
  if (first !== null && first.startsWith(q)) return 0;
  if (phrases.some((p) => p.startsWith(q))) return 1;
  if (c.group !== 'everyone' && phrases.some((p) => atWord(p, q))) return 2;
  if (ids.some((id) => atWord(id, q))) return 3;
  return null;
}

/**
 * The choices a query finds, best first: people by their first name, then names and titles, then words inside them;
 * all hands only from "al" or "ev" (`@all`, `@everyone`, `@all-hands`).
 */
export function rankChoices(choices: readonly TalkChoice[], query: string, options: { allHands: boolean }): TalkChoice[] {
  const q = fold(query).trimStart();
  return choices
    .map((c, i) => ({ c, i, rank: c.group === 'everyone' && (!options.allHands || q.length < 2) ? null : rankOf(c, q) }))
    .filter((x): x is { c: TalkChoice; i: number; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.c);
}

/** The part of a label to underline: what was typed, where it starts a word. Null when it isn't in the label. */
export function matchIn(label: string, query: string): [number, number] | null {
  const q = fold(query).trim();
  const folded = fold(label);
  if (!q || folded.length !== label.length) return null;
  for (let at = folded.indexOf(q); at >= 0; at = folded.indexOf(q, at + 1)) {
    if (at === 0 || /[\s'-]/.test(folded[at - 1] ?? '')) return [at, at + q.length];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The lists: one pattern for `@` at the start, `@` after the first word, `/` and a command's choices

export type ListPick =
  /** Who hears it, for this message only. */
  | { kind: 'pick'; choice: TalkChoice; replaces: readonly Recipient[] }
  /** Who it's for. */
  | { kind: 'for'; choice: TalkChoice }
  /** "Send it to Kai instead": who hears it, from the list after the first word. */
  | { kind: 'instead'; choice: TalkChoice }
  | { kind: 'command'; command: PaletteCommand }
  | { kind: 'option'; value: string };

export interface ListOption {
  /** Unique within the list, for its element's id. */
  id: string;
  label: string;
  detail: string | null;
  /** What was typed, underlined in the label. */
  match: [number, number] | null;
  disabled: boolean;
  pick: ListPick;
  /** Whose face leads it; null for a command or a choice. */
  who: Recipient | null;
}

export interface ListGroup {
  title: string;
  options: ListOption[];
}

const GROUP_TITLES: Record<ChoiceGroup, string> = { everyone: 'All hands', rooms: 'Rooms', teams: 'Teams', people: 'People' };

/**
 * From the fourth person picked, the smallest room or team that holds them all, offered first ("Ada's team, all four of
 * them and Ada"), so one pick can stand for them.
 */
export function groupForPicks(choices: readonly TalkChoice[], picks: readonly Recipient[]): { choice: TalkChoice; label: string; replaces: Recipient[] } | null {
  const people = picks.filter((r): r is Extract<Recipient, { kind: 'person' }> => r.kind === 'person');
  if (people.length < 4 || people.length !== picks.length) return null;
  const ids = people.map((r) => r.id);
  const holding = choices.filter((c) => (c.group === 'rooms' || c.group === 'teams') && ids.every((id) => c.reach.includes(id))).sort((a, b) => a.reach.length - b.reach.length);
  const [group] = holding;
  if (!group) return null;
  const titleOf = (id: string) => choices.find((c) => c.key === `person:${id}`)?.title ?? id;
  const rest = group.reach.filter((id) => !ids.includes(id)).map(titleOf);
  return { choice: group, label: `${group.label}, all ${countWord(ids.length)} of them${rest.length > 0 ? ` and ${namesList(rest)}` : ''}`, replaces: people };
}

/** The `@` list at the start: who hears it, grouped, with the person whose first name you typed on top. */
export function pickList(choices: readonly TalkChoice[], query: string, picks: readonly Recipient[]): ListGroup[] {
  const found = rankChoices(choices, query, { allHands: true });
  const taken = new Set(picks.map(recipientKey));
  const option = (c: TalkChoice, label = c.label, replaces: readonly Recipient[] = []): ListOption => ({
    id: `pick-${c.key}`,
    label,
    detail: c.detail,
    match: matchIn(label, query),
    disabled: false,
    pick: { kind: 'pick', choice: c, replaces },
    who: c.recipient,
  });
  const groups: ListGroup[] = [];
  const offered = groupForPicks(choices, picks);
  if (offered) groups.push({ title: 'All of them', options: [option(offered.choice, offered.label, offered.replaces)] });
  const byGroup = (g: ChoiceGroup) => found.filter((c) => c.group === g && !taken.has(c.key));
  const q = fold(query).trim();
  const firstNames = q !== '' && found.some((c) => c.search.first?.startsWith(q) === true);
  const order: ChoiceGroup[] = firstNames ? ['everyone', 'people', 'rooms', 'teams'] : ['everyone', 'rooms', 'teams', 'people'];
  for (const g of order) {
    const options = byGroup(g).map((c) => option(c));
    if (options.length > 0) groups.push({ title: GROUP_TITLES[g], options });
  }
  return groups;
}

/** The `@` list after the first word: who it's for, people only, ending with "Send it to Kai instead" for the top one. */
export function forList(choices: readonly TalkChoice[], query: string): ListGroup[] {
  const found = rankChoices(
    choices.filter((c) => c.group === 'people'),
    query,
    { allHands: false },
  );
  const [top] = found;
  if (!top) return [];
  const options: ListOption[] = found.map((c) => ({ id: `for-${c.key}`, label: c.label, detail: c.detail, match: matchIn(c.label, query), disabled: false, pick: { kind: 'for', choice: c }, who: c.recipient }));
  options.push({ id: `instead-${top.key}`, label: `Send it to ${top.title} instead`, detail: null, match: null, disabled: false, pick: { kind: 'instead', choice: top }, who: null });
  return [{ title: FOR_HEADING, options }];
}

/** The `/` list: recent and suggested commands first, then by section; while typing, the best matches. */
export function commandList(commands: readonly PaletteCommand[], query: string, recents: readonly string[], online: boolean): ListGroup[] {
  const option = (c: PaletteCommand, group: string): ListOption => ({
    id: `cmd-${group}-${c.id}`,
    label: c.label,
    detail: c.sends && !online ? 'Waits until the office is back' : c.hint,
    match: matchIn(c.label, query.trim().split(/\s+/)[0] ?? ''),
    disabled: c.sends && !online,
    pick: { kind: 'command', command: c },
    who: null,
  });
  if (query.trim() !== '') {
    const found = findCommands(commands, query, recents).slice(0, RESULTS_SHOWN);
    return found.length > 0 ? [{ title: 'Commands', options: found.map((c) => option(c, 'found')) }] : [];
  }
  const groups: ListGroup[] = browse(commands, recents).map((g) => ({ title: g.title, options: g.commands.map((c) => option(c, g.title)) }));
  // Every section shows its first few, so the list shows what there is; typing narrows it to the rest.
  for (const section of SECTIONS) {
    const inSection = commands.filter((c) => c.section === section).slice(0, SECTION_SHOWN);
    if (inSection.length > 0) groups.push({ title: section, options: inSection.map((c) => option(c, section)) });
  }
  return groups;
}

/** How many of a section's commands the `/` list shows before anything is typed. */
const SECTION_SHOWN = 6;

/** A command's choice step: its options, narrowed by what is typed. */
export function choiceList(step: Extract<PaletteStep, { kind: 'choice' }>, query: string): ListGroup[] {
  const found = findOptions(step.options, query);
  return found.length > 0 ? [{ title: step.label, options: found.map((o) => ({ id: `opt-${o.value}`, label: o.label, detail: o.hint, match: matchIn(o.label, query), disabled: false, pick: { kind: 'option', value: o.value }, who: null })) }] : [];
}

export const optionsOf = (groups: readonly ListGroup[]): ListOption[] => groups.flatMap((g) => g.options);

/** What the status by the box says once typing pauses: "Five match. Up and Down choose, Enter picks.", or no match. */
export function listStatus(found: number, list: 'mention' | 'command' | 'choice', query: string): string {
  if (found === 0) return list === 'command' ? NO_COMMAND : list === 'choice' ? NO_CHOICE : noOneCalled(query);
  return `${capital(countWord(found))} ${found === 1 ? 'matches' : 'match'}. Up and Down choose, Enter picks.`;
}

/** "No one called “zo”." */
export const noOneCalled = (query: string): string => `No one called “${query.trim()}”.`;

// ---------------------------------------------------------------------------------------------------------------
// The To in words

type Company = Pick<CompanyView, 'people' | 'pause' | 'phase'>;

/** Its first words: "Mara, CEO", "the QA engineer", "the design room", "Ada's team", "all hands". */
function oneTo(snapshot: Studio, company: Pick<CompanyView, 'people'>, r: Recipient): string {
  if (r.kind === 'everyone') return 'all hands';
  if (r.kind !== 'person') return recipientTitle(snapshot, company, r);
  const p = company.people.find((x) => x.id === r.id);
  if (!p) return 'them';
  return p.name === p.title ? called(p) : personLabel(p);
}

/** One recipient inside a list of several: "Kai", "the CEO", "the design room". */
function shortTitle(snapshot: Studio, company: Pick<CompanyView, 'people'>, r: Recipient): string {
  if (r.kind !== 'person') return oneTo(snapshot, company, r);
  const p = company.people.find((x) => x.id === r.id);
  return p ? called(p) : 'them';
}

export interface ToWords {
  /** "To Mara, CEO", "To the design room", "To Kai and Mina": the To's words, and its name. */
  long: string;
  /** The compact To's words: a first name ("Mara"), a room ("Design"), "Ada's team", "All hands"; "" for several, which show faces. */
  short: string;
  /** The box's name: "Message to Mara, CEO". */
  box: string;
  /** "Say something to Mara". */
  placeholder: string;
  /** Picked for this message only. */
  once: boolean;
}

export function toWords(snapshot: Studio, company: Pick<CompanyView, 'people'>, to: readonly Recipient[], once: boolean): ToWords {
  const [first] = to;
  if (!first) return { long: 'To nobody yet', short: '', box: 'Message', placeholder: 'Say something', once };
  const several = to.length > 1;
  const words = several ? namesList(to.map((r) => shortTitle(snapshot, company, r))) : oneTo(snapshot, company, first);
  const person = !several && first.kind === 'person' ? company.people.find((p) => p.id === first.id) : undefined;
  const short = several
    ? ''
    : person
      ? person.name
      : first.kind === 'room'
        ? roomName(snapshot, first.id)
        : first.kind === 'everyone'
          ? 'All hands'
          : capital(words);
  const say = several ? words : person ? (person.name === person.title ? called(person) : person.name) : first.kind === 'everyone' ? 'everyone' : words;
  return { long: `To ${words}`, short, box: `Message to ${words}`, placeholder: `Say something to ${say}`, once };
}

// ---------------------------------------------------------------------------------------------------------------
// The hint row: what will happen

/** What a mention after the first word is: who it is for, reached through the org, not by a message of its own. "For Mia, through the org". */
export const forWords = (people: readonly PersonView[]): string => `For ${namesList(people.map(called))}, through the org`;

/** "Mara reads it at their next step.", "Mara gets it and passes it on to Kai.", "To Kai and Mina, for this message only: a copy each." */
export function whatHappens(snapshot: Studio, company: Company, to: readonly Recipient[], forPeople: readonly string[], once: boolean, now?: number): string {
  const [first] = to;
  if (!first) return 'Nobody is there yet, so there is nobody to send it to.';
  const forNames = forPeople.map((id) => company.people.find((p) => p.id === id)).filter((p): p is PersonView => p !== undefined);
  const forLine = forNames.length > 0 ? ` ${forWords(forNames)}: its trace flags anyone it doesn't reach.` : '';
  if (to.length > 1) return `${toWords(snapshot, company, to, true).long}, for this message only: a copy each.${forLine}`;
  let happens: string;
  if (first.kind === 'person') {
    const p = company.people.find((x) => x.id === first.id);
    const others = forNames.filter((f) => f.id !== first.id);
    happens = !p ? 'They have left the company.' : others.length > 0 ? `${capital(called(p))} gets it and passes it on to ${namesList(others.map(called))}.` : boxHint(company, p, now);
  } else happens = `${sendHint(snapshot, company, first, [])}${forLine}`;
  return once ? `${toWords(snapshot, company, to, true).long}, for this message only. ${happens}` : happens;
}

/** The counter from 3,500 characters: "3,620 of 4,000"; over: "4,120 of 4,000. Shorten it by 120 to send." */
export function counterLine(text: string, max = MESSAGE_MAX): { text: string | null; over: boolean } {
  const length = [...text].length;
  const n = (x: number) => x.toLocaleString('en-US');
  if (length > max) return { text: `${n(length)} of ${n(max)}. Shorten it by ${n(length - max)} to send.`, over: true };
  return { text: length >= COUNTER_FROM ? `${n(length)} of ${n(max)}` : null, over: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Sending: one copy per person a picked room or team doesn't already cover, one call at a time

export interface SendCall {
  to: Recipient;
  /** In "Sent to Kai." and "Couldn't send to the design room": "Kai", "the design room", "everyone". */
  title: string;
  /** Who it reaches, in the org's order. */
  reach: string[];
  /** A plain message to one person goes as it always has (and can be unsent); the rest through steering's send. */
  via: 'say' | 'send';
}

/**
 * The calls a send makes, in the To's order. All hands covers everyone; a room or team that the picked rooms and teams
 * already hold goes; a person they hold goes. Rooms and teams that only overlap each go whole: steering's send takes one
 * recipient and gives everyone in it a copy.
 */
export function sendPlan(snapshot: Studio, company: Pick<CompanyView, 'people'>, to: readonly Recipient[], forPeople: readonly string[]): SendCall[] {
  const unique = [...new Map(to.map((r) => [recipientKey(r), r])).values()];
  const call = (r: Recipient): SendCall => ({
    to: r,
    title: r.kind === 'everyone' ? 'everyone' : shortTitle(snapshot, company, r),
    reach: reachOf(snapshot, company, r),
    via: r.kind === 'person' && forPeople.length === 0 ? 'say' : 'send',
  });
  const everyone = unique.find((r) => r.kind === 'everyone');
  if (everyone) return [call(everyone)];
  const groups = unique.filter((r) => r.kind === 'room' || r.kind === 'team').map((r) => ({ r, reach: reachOf(snapshot, company, r) }));
  const kept = new Set<string>();
  const covered = new Set<string>();
  for (const g of [...groups].sort((a, b) => b.reach.length - a.reach.length)) {
    if (g.reach.length > 0 && g.reach.every((id) => covered.has(id))) continue;
    kept.add(recipientKey(g.r));
    for (const id of g.reach) covered.add(id);
  }
  return unique.filter((r) => (r.kind === 'person' ? !covered.has(r.id) : kept.has(recipientKey(r)))).map(call);
}

export type CallResult = { call: SendCall; ok: true; messages: Message[] } | { call: SendCall; ok: false; why: string };

export interface SendOutcome {
  state: 'sent' | 'partly' | 'refused';
  /** What the hint row and the live region say. */
  line: string;
  /** The calls Try again makes: only those that didn't go. */
  retry: SendCall[];
  /** Every copy that went, for Unsend. */
  sent: Message[];
  /** Refused because its one person left: "Send to the CEO instead" takes Try again's place. */
  gone: boolean;
}

const sentence = (text: string): string => {
  const t = text.trim();
  return /[.?!…]$/.test(t) ? t : `${t}.`;
};

/** What a send did, from each call's result, said with the company as it is now (someone may have left meanwhile). */
export function sendOutcome(snapshot: Studio, company: Company, results: readonly CallResult[], now?: number): SendOutcome {
  const went = results.filter((r): r is Extract<CallResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<CallResult, { ok: false }> => !r.ok);
  const sent = went.flatMap((r) => r.messages);
  const left = (call: SendCall): boolean => {
    const to = call.to;
    return to.kind === 'person' && !company.people.some((p) => p.id === to.id);
  };
  if (failed.length === 0) {
    const [only] = went;
    const line = went.length === 1 && only ? `Sent. ${whatHappens(snapshot, company, [only.call.to], [], false, now)}` : `Sent to ${namesList(went.map((r) => r.call.title))}: a copy each.`;
    return { state: 'sent', line, retry: [], sent, gone: false };
  }
  // The same reason for several is said once: "Couldn't send to Mina and Jules: Nobody works there yet."
  const byWhy = new Map<string, SendCall[]>();
  for (const f of failed) {
    const why = left(f.call) ? `${capital(f.call.title)} left the company` : f.why;
    byWhy.set(why, [...(byWhy.get(why) ?? []), f.call]);
  }
  const refusals = [...byWhy.entries()];
  const [onlyRefusal] = refusals;
  const [onlyFailed] = failed;
  const gone = failed.length === 1 && onlyFailed !== undefined && left(onlyFailed.call);
  if (went.length === 0) {
    const line = refusals.length === 1 && onlyRefusal ? `Couldn't send: ${sentence(onlyRefusal[0])}` : refusals.map(([why, calls]) => `Couldn't send to ${namesList(calls.map((c) => c.title))}: ${sentence(why)}`).join(' ');
    return { state: 'refused', line, retry: failed.map((f) => f.call), sent, gone };
  }
  const line = [`Sent to ${namesList(went.map((r) => r.call.title))}.`, ...refusals.map(([why, calls]) => `Couldn't send to ${namesList(calls.map((c) => c.title))}: ${sentence(why)}`)].join(' ');
  return { state: 'partly', line, retry: failed.map((f) => f.call), sent, gone: false };
}

// ---------------------------------------------------------------------------------------------------------------
// History: what you sent before, with its To, the last 50 per company in this browser

export interface Sent {
  text: string;
  to: Recipient[];
}

export const HISTORY_MAX = 50;
export const historyKey = (scope: string): string => `worklings-talk-history:${scope}`;

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** A recipient read back from storage, which anything may have written: its shape checked, or null. */
export function recipientFrom(raw: unknown): Recipient | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'everyone') return { kind: 'everyone' };
  if (r.kind === 'person' && isId(r.id)) return { kind: 'person', id: r.id };
  if (r.kind === 'room' && isId(r.id)) return { kind: 'room', id: r.id };
  if (r.kind === 'team' && isId(r.head)) return { kind: 'team', head: r.head };
  return null;
}

export function readHistory(storage: Pick<Storage, 'getItem'>, scope: string): Sent[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(historyKey(scope)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const out: Sent[] = [];
    for (const item of raw.slice(0, HISTORY_MAX)) {
      if (typeof item !== 'object' || item === null) continue;
      const { text, to } = item as Record<string, unknown>;
      if (typeof text !== 'string' || text.length > MESSAGE_MAX * 2 || !Array.isArray(to)) continue;
      const recipients = to.map(recipientFrom).filter((r): r is Recipient => r !== null);
      if (recipients.length > 0) out.push({ text, to: recipients });
    }
    return out;
  } catch {
    // Storage switched off, or a value from elsewhere: no history; sending still works.
    return [];
  }
}

export function keepSent(storage: Pick<Storage, 'getItem' | 'setItem'>, scope: string, entry: Sent): Sent[] {
  const next = [entry, ...readHistory(storage, scope).filter((s) => s.text !== entry.text || JSON.stringify(s.to) !== JSON.stringify(entry.to))].slice(0, HISTORY_MAX);
  try {
    storage.setItem(historyKey(scope), JSON.stringify(next));
  } catch {
    // Not remembered where storage is switched off.
  }
  return next;
}

/** The To and the draft, kept per company for the tab (sessionStorage). */
export interface Kept {
  to: Recipient | null;
  draft: string;
}

export const keptKey = (scope: string): string => `worklings-talk:${scope}`;

export function readKept(storage: Pick<Storage, 'getItem'>, scope: string): Kept {
  try {
    const raw: unknown = JSON.parse(storage.getItem(keptKey(scope)) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { to: null, draft: '' };
    const { to, draft } = raw as Record<string, unknown>;
    return { to: recipientFrom(to), draft: typeof draft === 'string' && draft.length <= MESSAGE_MAX * 2 ? draft : '' };
  } catch {
    return { to: null, draft: '' };
  }
}

export function keep(storage: Pick<Storage, 'setItem'>, scope: string, kept: Kept): void {
  try {
    storage.setItem(keptKey(scope), JSON.stringify(kept));
  } catch {
    // The draft lives as long as the page where storage is switched off.
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The To when someone leaves

/** The CEO, the To a company starts on and falls back to. */
export const ceoOf = (company: Pick<CompanyView, 'people'>): PersonView | null => company.people.find((p) => p.level === 'ceo') ?? company.people[0] ?? null;

/** Whether the company still has who a recipient names: the person, someone in the room, the team's head. */
export function stillThere(snapshot: Studio, company: Pick<CompanyView, 'people'>, r: Recipient): boolean {
  if (r.kind === 'everyone') return true;
  if (r.kind === 'person') return company.people.some((p) => p.id === r.id);
  return reachOf(snapshot, company, r).length > (r.kind === 'team' ? 1 : 0);
}

/**
 * "Kai left the company. To the CEO now.", "Ada's team is gone. To the CEO now." Null for someone the office never knew
 * (an id nobody has), who can't have left: the To falls back without a word.
 */
export function goneLine(snapshot: Studio, before: Pick<CompanyView, 'people'>, r: Recipient): string | null {
  if (r.kind === 'person') {
    const p = before.people.find((x) => x.id === r.id);
    const fired = snapshot.studio?.fired.find((f) => f.id === r.id);
    const name = p ? capital(called(p)) : fired ? (fired.name ?? fired.title) : null;
    return name ? `${name} left the company. To the CEO now.` : null;
  }
  if (r.kind === 'team' && !before.people.some((p) => p.id === r.head)) return null;
  return `${capital(oneTo(snapshot, before, r))} is gone. To the CEO now.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The bar's state

export interface CommandState {
  command: PaletteCommand;
  /** The step being asked. */
  at: number;
  values: Record<string, string>;
  /** What was typed to find it ("/cancel cart"), back in the box when Escape leaves the first step. */
  typed: string;
}

export interface TalkState {
  /** The words in the box; one draft per company whatever the To. */
  draft: string;
  /** The To you set: the CEO at first, a person you opened, a pick in the To's picker. */
  base: Recipient | null;
  /** Picked with a leading `@` for this message only, in order. */
  picks: Recipient[];
  /** Names a pick from the list after the first word wrote ("@kai"), to the choice they name, so one of two Kais stays himself. */
  bound: Record<string, string>;
  /** People you said it isn't for ("Not for Kai"). */
  notFor: string[];
  /** Stop for a person: the draft is the instruction. */
  stop: string | null;
  command: CommandState | null;
  /** A command step's words. */
  step: string;
  /** Which sent message Up brought back, 0 the newest; null while the box holds the draft. */
  recall: number | null;
}

export const initialTalk = (base: Recipient | null, draft = ''): TalkState => ({ draft, base, picks: [], bound: {}, notFor: [], stop: null, command: null, step: '', recall: null });

export type TalkAction =
  | { type: 'type'; text: string; history: readonly Sent[] }
  /** Opening someone: the To changes only while the box is empty; someone else ends Stop. */
  | { type: 'offer'; to: Recipient }
  /** "Message Kai", Reply: the To changes even with words in the box; suggested words fill an empty box. */
  | { type: 'to'; to: Recipient; draft?: string }
  | { type: 'stop'; person: string }
  | { type: 'end-stop' }
  /** A pick from the `@` list at the start: the typed `@…` (from `start` to `end`) leaves the box. */
  | { type: 'pick'; to: Recipient; start: number; end: number; replaces: readonly Recipient[] }
  /** A pick from the list after the first word: `@Kai` takes the typed `@ka`'s place. */
  | { type: 'pick-for'; key: string; name: string; start: number; end: number }
  /** "Send it to Kai instead": the typed `@ka` leaves the box and Kai hears it. */
  | { type: 'instead'; to: Recipient; start: number; end: number }
  | { type: 'not-for'; person: string }
  /** Backspace in an empty box: the last pick goes. */
  | { type: 'drop-pick' }
  | { type: 'command'; command: PaletteCommand; typed: string }
  /** A step answered: the next one, or the command is ready to run. */
  | { type: 'answer'; key: string; value: string }
  | { type: 'step-back' }
  | { type: 'end-command' }
  | { type: 'sent' }
  /** Refused: the words come back unless you've started something new. */
  | { type: 'refused'; text: string; to: readonly Recipient[] }
  | { type: 'recall'; dir: 'older' | 'newer'; history: readonly Sent[] }
  | { type: 'unrecall' }
  /** The To's person left, or its room or team is gone. */
  | { type: 'fallback'; to: Recipient | null; drop: readonly string[] };

/** Nothing is being written: no words, no picks, no Stop, no command, nothing recalled. */
export const isEmpty = (s: TalkState): boolean => s.draft.trim() === '' && s.picks.length === 0 && s.stop === null && s.command === null && s.recall === null;

const sameRecipient = (a: Recipient | null, b: Recipient | null): boolean => (a === null || b === null ? a === b : recipientKey(a) === recipientKey(b));

/** The To a recalled message brings back: its picks, unless they are the To you set anyway. */
const recalledPicks = (s: TalkState, entry: Sent): Recipient[] => (entry.to.length === 1 && entry.to[0] && sameRecipient(entry.to[0], s.base) ? [] : [...entry.to]);

export function talkReducer(s: TalkState, a: TalkAction): TalkState {
  switch (a.type) {
    case 'type': {
      if (s.command) return { ...s, step: a.text };
      if (s.recall !== null) {
        // Changing what Up brought back makes it the draft, with its To for this message.
        const entry = a.history[s.recall];
        return entry ? { ...s, draft: a.text, picks: recalledPicks(s, entry), recall: null } : { ...s, draft: a.text, recall: null };
      }
      return { ...s, draft: a.text };
    }
    case 'offer': {
      const endsStop = s.stop !== null && !(a.to.kind === 'person' && a.to.id === s.stop);
      const next = endsStop ? { ...s, stop: null } : s;
      if (!isEmpty(next)) return next;
      return sameRecipient(next.base, a.to) ? next : { ...next, base: a.to };
    }
    case 'to': {
      // A command or a recalled message being looked at is left; the draft stays.
      const draft = s.command || s.recall !== null ? '' : s.draft;
      return { ...s, base: a.to, picks: [], stop: null, command: null, step: '', recall: null, draft: draft.trim() === '' && a.draft ? a.draft : draft };
    }
    case 'stop':
      return { ...s, stop: a.person, command: null, step: '', recall: null };
    case 'end-stop':
      return { ...s, stop: null };
    case 'pick': {
      const text = removeToken(s.draft, a.start, a.end);
      const replaced = new Set(a.replaces.map(recipientKey));
      const picks = [...s.picks.filter((r) => !replaced.has(recipientKey(r)) && !sameRecipient(r, a.to)), a.to];
      return { ...s, draft: text, picks };
    }
    case 'pick-for': {
      const written = `@${a.name}`;
      const after = s.draft.slice(a.end);
      const text = `${s.draft.slice(0, a.start)}${written}${after.startsWith(' ') ? '' : ' '}${after}`;
      return { ...s, draft: text, bound: { ...s.bound, [fold(written)]: a.key }, notFor: s.notFor.filter((id) => `person:${id}` !== a.key) };
    }
    case 'instead':
      return { ...s, draft: removeToken(s.draft, a.start, a.end), picks: [...s.picks.filter((r) => !sameRecipient(r, a.to)), a.to] };
    case 'not-for':
      return s.notFor.includes(a.person) ? s : { ...s, notFor: [...s.notFor, a.person] };
    case 'drop-pick':
      return s.picks.length === 0 ? s : { ...s, picks: s.picks.slice(0, -1) };
    case 'command':
      return { ...s, command: { command: a.command, at: 0, values: {}, typed: a.typed }, step: '', recall: null };
    case 'answer': {
      if (!s.command) return s;
      const values = { ...s.command.values, [a.key]: a.value };
      const at = s.command.at + 1;
      const nextStep = s.command.command.steps[at];
      return { ...s, command: { ...s.command, values, at: Math.min(at, s.command.command.steps.length) }, step: nextStep?.kind === 'text' ? (values[nextStep.key] ?? '') : '' };
    }
    case 'step-back': {
      if (!s.command) return s;
      if (s.command.at === 0) return { ...s, command: null, step: '', draft: s.command.typed };
      const at = s.command.at - 1;
      const before = s.command.command.steps[at];
      return { ...s, command: { ...s.command, at }, step: before?.kind === 'text' ? (s.command.values[before.key] ?? '') : '' };
    }
    case 'end-command':
      return { ...s, command: null, step: '', draft: '' };
    case 'sent':
      return { ...s, draft: '', picks: [], bound: {}, notFor: [], stop: null, recall: null };
    case 'refused': {
      if (s.draft.trim() !== '' || s.recall !== null) return s;
      return { ...s, draft: a.text, picks: a.to.length === 1 && a.to[0] && sameRecipient(a.to[0], s.base) ? [] : [...a.to] };
    }
    case 'recall': {
      if (a.dir === 'older') {
        const at = s.recall === null ? 0 : s.recall + 1;
        return at < a.history.length ? { ...s, recall: at } : s;
      }
      if (s.recall === null) return s;
      return { ...s, recall: s.recall === 0 ? null : s.recall - 1 };
    }
    case 'unrecall':
      return s.recall === null ? s : { ...s, recall: null };
    case 'fallback': {
      const dropped = new Set(a.drop);
      return { ...s, base: a.to, picks: s.picks.filter((r) => !dropped.has(recipientKey(r))), stop: s.stop !== null && dropped.has(`person:${s.stop}`) ? null : s.stop };
    }
  }
}

/** Takes a typed `@…` out of the box, with one space after it, so "@de darker cards" leaves "darker cards". */
function removeToken(text: string, start: number, end: number): string {
  const after = text.slice(end);
  return `${text.slice(0, start)}${start === 0 || /\s$/.test(text.slice(0, start)) ? after.replace(/^[ \t]+/, '') : after}`;
}

/** Who hears what the box holds now: its picks (made or typed), else the To you set. */
export function effectiveTo(s: TalkState, typed: readonly Recipient[], recalled: Sent | null): { to: Recipient[]; once: boolean } {
  if (recalled) {
    const picks = recalledPicks(s, recalled);
    return picks.length > 0 ? { to: picks, once: true } : { to: s.base ? [s.base] : [], once: false };
  }
  const picks = [...new Map([...s.picks, ...typed].map((r) => [recipientKey(r), r])).values()];
  if (picks.length > 0) return { to: picks, once: true };
  return { to: s.base ? [s.base] : [], once: false };
}
