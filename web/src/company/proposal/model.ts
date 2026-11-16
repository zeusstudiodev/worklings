// The proposal in words and columns (docs/design-v3.md, "The proposal"): its state, the summary's sentences, the chart's
// columns with what changed since the last version, the check that blocks Start, and edits. Pure, for tests.
import { type CompanyView, introduce, type Message, type Question, STAKEHOLDER } from '../../../../src/core/company.ts';
import type { BaseDepartment } from '../../../../src/core/departments.ts';
import type { Loads } from '../../../../src/core/loads.ts';
import { countWord } from '../../../../src/core/now.ts';
import { managerProblem, ORG_SIZE, type OrgProposal, PROPOSAL_LIMITS, type ProposedPerson, type ProposedQuestion, type ProposedRoom, TEAM_LEAD_OVER } from '../../../../src/core/org.ts';
import type { CatalogRole } from '../../../../src/core/snapshot.ts';
import { inSentence, type Level, PERSON_NAME, type RoleModel, slugId } from '../../../../src/core/studio.ts';
import { capital } from '../../../../src/core/words.ts';

export const THEME_NAMES = {
  office: 'classic office',
  cafe: 'café',
  'game-studio': 'game studio',
  shop: 'shop',
  lab: 'lab',
  garden: 'garden',
  city: 'city',
  arcade: 'arcade',
  'music-studio': 'music studio',
} as const;

export const MODEL_NAMES: Record<RoleModel, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', inherit: 'Same as yours' };

/** A list in a sentence: "a, b and c". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** "two people", "a team lead", "13 workers". */
function counted(n: number, one: string, many: string, article = 'a'): string {
  if (n === 1) return `${article} ${one}`;
  return `${countWord(n)} ${many}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The state of the draft

/**
 * scoping: the CEO's scoping questions wait for your answers, before it drafts. stopped: you stopped the CEO. ended: the
 * CEO's turn ended without a proposal (it answered in words, or asked in plain text) and it waits for you.
 */
export type DraftState = 'scoping' | 'drafting' | 'fixing' | 'gave-up' | 'ready' | 'failed' | 'stopped' | 'ended';

/**
 * Where the CEO's draft stands. `draft` is what the office knows about refused attempts (proposeOrg's errors), when
 * the company view carries it.
 */
export function draftState(
  company: Pick<CompanyView, 'phase' | 'proposal' | 'people' | 'log'> & Partial<Pick<CompanyView, 'scoping' | 'questions' | 'drafting'>>,
  draft: { attempts: number; error: string | null } | null = null,
): DraftState {
  if (company.phase !== 'founding') return 'ready';
  const ceo = company.people.find((p) => p.level === 'ceo');
  if (ceo?.desk.state === 'failed') return 'failed';
  if (draft && draft.attempts >= 3) return 'gave-up';
  const lastStop = company.log.filter((e) => e.kind === 'stop' && e.by === STAKEHOLDER).at(-1);
  const busy = ceo?.desk.state === 'working' || ceo?.desk.state === 'starting' || ceo?.desk.state === 'stopping';
  if (lastStop && !busy && !company.log.some((e) => e.at > lastStop.at && (e.kind === 'proposal' || e.kind === 'founded'))) return 'stopped';
  if (scopingWaits(scopingOf(company))) return 'scoping';
  // The office null it while the CEO drafts and once a message reaches it, so it holds only for a CEO that is waiting.
  if (company.drafting?.stopped && !busy) return 'ended';
  if (draft && draft.attempts > 0 && draft.error) return 'fixing';
  return 'drafting';
}

/** The CEO as a sentence names them: their first name, or "the CEO" when the studio gave them none (name equals title). */
export const ceoLabel = (ceo: { name: string; title: string }): string => (ceo.name !== ceo.title ? ceo.name : 'the CEO');

/** The talk bar's suggestion chips change an org, so they show once there is a proposal and not while the CEO's questions wait. */
export const showsSuggestions = (company: Pick<CompanyView, 'proposal'> & Partial<Pick<CompanyView, 'scoping' | 'questions'>>): boolean =>
  company.proposal !== null && !scopingWaits(scopingOf(company));

// ---------------------------------------------------------------------------------------------------------------
// The CEO's scoping questions, asked before it drafts the org

/** One of the CEO's scoping questions, and where your answer to it stands. */
export interface ScopingItem {
  question: Question;
  /** The pressed option's words or your own, and when it reaches the CEO; null while it is open. */
  answer: { text: string; own: boolean; appliesAt: number } | null;
}

export interface ScopingState {
  /** In the order the CEO asked them; questions taken back (the CEO was stopped, or drafted early) are left out. */
  items: ScopingItem[];
  /** How many have no answer yet. */
  open: number;
  /** When your answers went to the CEO; null while it waits for them. */
  answeredAt: number | null;
}

/** The CEO's scoping round from the company's view; null when it asked no scoping questions. */
export function scopingOf(company: Partial<Pick<CompanyView, 'scoping' | 'questions'>>): ScopingState | null {
  const round = company.scoping;
  if (!round) return null;
  const questions = company.questions ?? [];
  const items = round.questions.flatMap((id): ScopingItem[] => {
    const question = questions.find((q) => q.id === id);
    if (!question || question.withdrawn) return [];
    const given = question.answer;
    if (!given) return [{ question, answer: null }];
    const own = given.option === null;
    const text = given.option === null ? given.text : (question.options[given.option] ?? given.text);
    return [{ question, answer: { text, own, appliesAt: given.appliesAt } }];
  });
  return { items, open: items.filter((i) => i.answer === null).length, answeredAt: round.answeredAt };
}

/** The CEO waits for your answers to its scoping questions before it drafts. */
export const scopingWaits = (s: ScopingState | null): boolean => s !== null && s.answeredAt === null && s.items.length > 0;

/**
 * The line under the scoping heading: "Juno has four questions before drafting your company. Answer each, or use the
 * CEO's picks." Then how many are still open, and once all are answered, what happens next.
 */
export function scopingLine(s: ScopingState, ceoName: string): string {
  const total = s.items.length;
  if (s.open === 0) return 'Your answers reach the CEO in a few seconds, and it drafts your company from them.';
  if (s.open === total) {
    const many = total === 1 ? 'a question' : `${countWord(total)} questions`;
    return `${ceoName} has ${many} before drafting your company. Answer ${total === 1 ? 'it' : 'each'}, or use the CEO's ${total === 1 ? 'pick' : 'picks'}.`;
  }
  return `${capital(countWord(s.open))} of ${countWord(total)} still open. Answer ${s.open === 1 ? 'it' : 'them'}, or use the CEO's ${s.open === 1 ? 'pick' : 'picks'} for the rest.`;
}

/** What "Use the CEO's picks" does: "Answers the three open questions with the pick marked on each." */
export const picksNote = (open: number): string =>
  open === 1 ? 'Answers the open question with the pick marked on it.' : `Answers the ${countWord(open)} open questions with the pick marked on each.`;

/** The CEO's reason for its pick, under the question: "Why the CEO picks “Just me”: a tool for one person ships sooner." */
export function whyLine(q: Pick<Question, 'options' | 'recommended' | 'why'>): string | null {
  const why = q.why?.trim();
  const pick = q.recommended === null ? undefined : q.options[q.recommended];
  if (!why || pick === undefined) return null;
  return `Why the CEO picks “${pick}”: ${/[.?!…]$/.test(why) ? why : `${why}.`}`;
}

/** Your answers, as the proposal and the drafting screen list them: the question and what you said. */
export function scopingAnswers(s: ScopingState | null): { question: string; answer: string }[] {
  return (s?.items ?? []).flatMap((i) => (i.answer ? [{ question: i.question.text, answer: i.answer.own ? `“${i.answer.text}”` : i.answer.text }] : []));
}

// ---------------------------------------------------------------------------------------------------------------
// The summary

/** "18 people in five rooms: the CEO, three heads, a team lead and 13 workers." */
export function peopleSentence(p: Pick<OrgProposal, 'people' | 'rooms'>): string {
  const by = (level: Level) => p.people.filter((x) => x.level === level).length;
  const rooms = new Set(p.people.map((x) => x.room)).size;
  const parts = [
    by('ceo') === 1 ? 'the CEO' : by('ceo') > 1 ? `${countWord(by('ceo'))} CEOs` : '',
    by('head') > 0 ? counted(by('head'), 'head', 'heads') : '',
    by('lead') > 0 ? counted(by('lead'), 'team lead', 'team leads') : '',
    by('worker') > 0 ? counted(by('worker'), 'worker', 'workers') : '',
  ].filter(Boolean);
  const total = p.people.length;
  return `${capital(counted(total, 'person', 'people', 'One'))} in ${counted(rooms, 'room', 'rooms', 'one')}: ${listed(parts)}.`;
}

/** "Models: two on Opus, 13 on Sonnet, three on Haiku." */
export function modelsSentence(p: Pick<OrgProposal, 'people'>): string {
  const order: RoleModel[] = ['opus', 'sonnet', 'haiku', 'inherit'];
  const parts = order
    .map((m) => [m, p.people.filter((x) => x.model === m).length] as const)
    .filter(([, n]) => n > 0)
    .map(([m, n]) => (m === 'inherit' ? `${countWord(n)} on your own model` : `${countWord(n)} on ${MODEL_NAMES[m]}`));
  return `Models: ${parts.join(', ')}.`;
}

/** "Written for this company: TWINT payments engineer and local SEO specialist." Null when every role is a library one. */
export function newRolesSentence(p: Pick<OrgProposal, 'people'>): string | null {
  const titles = p.people.filter((x) => x.role !== undefined && x.library === undefined).map((x) => inSentence(x.title));
  return titles.length > 0 ? `Written for this company: ${listed(titles)}.` : null;
}

/** "Theme: café." */
export const themeSentence = (p: Pick<OrgProposal, 'theme'>): string => `Theme: ${THEME_NAMES[p.theme] ?? p.theme}.`;

/** The size guidance, which never blocks: "That's more than 25 people, the most an org usually needs." */
export function sizeNote(p: Pick<OrgProposal, 'people'>): string | null {
  const n = p.people.length;
  if (n < ORG_SIZE.min) return "That's only the CEO, who doesn't build anything: add someone to do the work.";
  if (n > ORG_SIZE.max) return `That's more than ${ORG_SIZE.max} people, the most an org usually needs.`;
  return null;
}

/** Why the CEO sized the org so, as it said it, ending in a stop; null for a proposal that doesn't say. */
export function sizingSentence(p: Pick<OrgProposal, 'sizing'>): string | null {
  const text = p.sizing?.trim();
  if (!text) return null;
  return /[.?!…]$/.test(text) ? text : `${text}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The check that blocks Start: the schema, never the size

/**
 * What stops this proposal from starting, each with its fix, in the panel's words. The hub checks with the org's own
 * rules (checkProposal in src/core/org.ts) and its answer is the one that counts; these say the common cases the way
 * the stakeholder reads them, and the hub's sentences show for anything they don't cover.
 */
export function checkDraft(p: OrgProposal): string[] {
  const errors: string[] = [];
  const ids = new Map<string, number>();
  for (const x of p.people) ids.set(x.id, (ids.get(x.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) errors.push(`Two people have the id ${id}. Give one of them another.`);
  const rooms = new Map(p.rooms.map((r) => [r.id, r]));
  const byId = new Map(p.people.map((x) => [x.id, x]));
  const ceos = p.people.filter((x) => x.level === 'ceo');
  if (ceos.length !== 1) errors.push(ceos.length === 0 ? 'The proposal needs a CEO.' : 'The proposal has more than one CEO. Keep one.');
  const who = (x: ProposedPerson) => (x.name.trim() ? x.name.trim() : `Someone in ${rooms.get(x.room)?.title ?? 'a room'}`);
  for (const x of p.people) {
    if (!PERSON_NAME.test(x.name.trim())) errors.push(`${who(x)} needs a first name: letters, up to 40.`);
    if (!x.title.trim()) errors.push(`${who(x)} needs a title.`);
    else if (x.title.length > PROPOSAL_LIMITS.title) errors.push(tooLong(`${who(x)}'s title`, x.title.length, PROPOSAL_LIMITS.title));
    if (!x.owns.trim()) errors.push(`Say what ${who(x)} owns.`);
    else if (x.owns.length > PROPOSAL_LIMITS.owns) errors.push(tooLong(`What ${who(x)} owns`, x.owns.length, PROPOSAL_LIMITS.owns));
    if (!rooms.has(x.room)) errors.push(`${who(x)} is in a room the proposal doesn't have. Pick one of its rooms.`);
    if (x.level === 'ceo') {
      if (x.reportsTo !== null) errors.push('The CEO reports to you, so nobody else.');
      continue;
    }
    const manager = x.reportsTo ? byId.get(x.reportsTo) : undefined;
    if (!manager) errors.push(`${who(x)} reports to nobody in the proposal. Pick their manager.`);
    else if (manager.level === 'worker') errors.push(`${who(x)} reports to ${who(manager)}, who manages nobody. Pick a head or a team lead.`);
    else if (managerProblem(x.level, manager.id, manager.level)) {
      errors.push(x.level === 'head' ? `${who(x)} is a head, so they report to the CEO.` : `${who(x)} is a team lead, so they report to a head or the CEO.`);
    }
  }
  for (const room of p.rooms) {
    const inRoom = p.people.filter((x) => x.room === room.id);
    if (inRoom.length === 0) errors.push(`${room.title} has nobody in it yet. Add someone, or undo adding the room.`);
    else if (inRoom.length > TEAM_LEAD_OVER && !inRoom.some((x) => x.level === 'lead')) {
      errors.push(`${room.title} has ${countWord(inRoom.length)} people and no team lead. Add one, move someone, or ask the CEO.`);
    }
  }
  return [...new Set(errors)];
}

/** "Kai's title is 67 characters; the most is 60." */
const tooLong = (what: string, got: number | string, max: number | string) => `${what} is ${got} characters; the most is ${max}.`;

const withStop = (text: string) => (/[.?!…]$/.test(text) ? text : `${text}.`);

/** The fields the office names in its reasons, as a sentence calls them. */
const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  owns: 'area',
  room: 'room',
  reportsTo: 'manager',
  model: 'model',
  id: 'id',
  level: 'level',
  library: 'library role',
  role: 'role',
  notes: 'notes',
  look: 'look',
};

/**
 * One of the office's reasons for turning the proposal down, as a sentence about the person or room it names, the way
 * checkDraft says its own: "people[3].title: up to 60 characters, got 67" becomes "Kai's title is 67 characters; the
 * most is 60." A reason that names nobody stays in the office's words.
 */
export function officeSentence(error: string, p: Pick<OrgProposal, 'people' | 'rooms'>): string {
  const text = error.trim();
  const found = /^(people|rooms)\[(\d+)\](?:\.([A-Za-z]+))?(?:\[\d+\])?(?:\.[A-Za-z]+)?: (.+)$/.exec(text);
  if (!found) return withStop(capital(text));
  const [, list, index = '', field = '', reason = ''] = found;
  const long = /^up to (\d+) characters, got (\d+)$/.exec(reason);
  if (list === 'rooms') {
    const room = p.rooms[Number(index)]?.title.trim() || 'A room';
    if (field === 'title' && long) return tooLong(`The name of ${room}`, long[2] ?? '', long[1] ?? '');
    return withStop(`${room}: ${reason}`);
  }
  const person = p.people[Number(index)];
  const who = !person ? 'Someone' : person.name.trim() || `Someone in ${p.rooms.find((r) => r.id === person.room)?.title ?? 'a room'}`;
  if (field === 'name') return `${who} needs a first name: letters, up to 40.`;
  if (field === 'title' && long) return tooLong(`${who}'s title`, long[2] ?? '', long[1] ?? '');
  if (field === 'owns' && long) return tooLong(`What ${who} owns`, long[2] ?? '', long[1] ?? '');
  if (field === 'title' && reason.startsWith('expected')) return `${who} needs a title.`;
  if (field === 'owns' && reason.startsWith('expected')) return `Say what ${who} owns.`;
  return withStop(field ? `${who}'s ${FIELD_WORDS[field] ?? field}: ${reason}` : `${who}: ${reason}`);
}

/** Why the office turned the proposal down, in sentences: the panel's own where it knows the rule, else the office's, each naming who. */
export function reasonsOf(p: OrgProposal, officeErrors: readonly string[]): string[] {
  const own = checkDraft(p);
  return own.length > 0 ? own : [...new Set(officeErrors.map((e) => officeSentence(e, p)))];
}

/** The line after an edit the office turned down: "Not saved. Kai's title is 67 characters; the most is 60." */
export const notSavedLine = (reasons: readonly string[]): string => `Not saved. ${reasons[0] ?? 'The office turned it down.'}`;

/** What a library role owns, for "Add someone": its description's first sentence, cut to what the office takes. */
export function ownsOf(description: string): string {
  const text = description.trim().replace(/\s+/g, ' ');
  const first = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  if (first.length <= PROPOSAL_LIMITS.owns) return first;
  const cut = first.slice(0, PROPOSAL_LIMITS.owns - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
}

/** "54 of 60" under a field the office limits, once it is three quarters full; null before. */
export function fieldCount(text: string, max: number): string | null {
  return text.length >= max * 0.75 ? `${text.length} of ${max}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The chart

export interface ChartCard {
  person: ProposedPerson;
  /** "New role", "Added", "Changed: moved from Design". */
  tag: string | null;
}

export interface ChartColumn {
  room: ProposedRoom;
  /** Heads, then team leads, then workers, each in the proposal's order. */
  cards: ChartCard[];
}

export interface Chart {
  /** The CEO and the office manager, above the rooms. */
  top: ChartCard[];
  columns: ChartColumn[];
  /** People the last revision took out. */
  removed: ProposedPerson[];
}

const LEVEL_ORDER: Record<Level, number> = { ceo: 0, head: 1, lead: 2, worker: 3 };

/** Who sits above the rooms: the CEO and anyone in the CEO's room who reports to them and manages nobody. */
const isTop = (x: ProposedPerson, p: OrgProposal) => x.level === 'ceo' || (x.id === 'office-manager' && x.reportsTo !== null && p.people.find((c) => c.id === x.reportsTo)?.level === 'ceo');

/** What changed for a person since the version before: added, or moved, retitled or given another manager or model. */
function changeTag(x: ProposedPerson, before: OrgProposal | null): string | null {
  if (!before) return null;
  const was = before.people.find((b) => b.id === x.id);
  if (!was) return 'Added';
  if (was.room !== x.room) return `Changed: moved from ${before.rooms.find((r) => r.id === was.room)?.title ?? was.room}`;
  if (was.title !== x.title) return `Changed: was ${was.title}`;
  if (was.reportsTo !== x.reportsTo) return 'Changed: new manager';
  if (was.level !== x.level) return 'Changed: new level';
  if (was.model !== x.model) return `Changed: now on ${MODEL_NAMES[x.model] ?? x.model}`;
  if (was.name !== x.name) return `Changed: was ${was.name}`;
  return null;
}

export function chartOf(p: OrgProposal, before: OrgProposal | null = null): Chart {
  const card = (x: ProposedPerson): ChartCard => ({ person: x, tag: changeTag(x, before) ?? (x.role !== undefined && x.library === undefined ? 'New role' : null) });
  const sort = (a: ProposedPerson, b: ProposedPerson) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  const top = p.people.filter((x) => isTop(x, p)).sort(sort).map(card);
  const columns = p.rooms
    .map((room) => ({ room, cards: p.people.filter((x) => x.room === room.id && !isTop(x, p)).sort(sort).map(card) }))
    .filter((c) => c.cards.length > 0 || !p.people.some((x) => x.room === c.room.id));
  const removed = before ? before.people.filter((b) => !p.people.some((x) => x.id === b.id)) : [];
  return { top, columns, removed };
}

/** The chart as People's outline (phones): everyone under their manager, a level deeper per step. */
export function outlineOf(p: Pick<OrgProposal, 'people'>): { person: ProposedPerson; depth: number }[] {
  const out: { person: ProposedPerson; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (manager: string | null, depth: number) => {
    for (const x of p.people.filter((y) => y.reportsTo === manager)) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      out.push({ person: x, depth });
      walk(x.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const x of p.people) if (!seen.has(x.id)) out.push({ person: x, depth: 0 });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Edits: each is a whole proposal, so Undo puts the one before back

export interface PersonEdit {
  name: string;
  title: string;
  room: string;
  reportsTo: string | null;
  model: RoleModel;
  owns: string;
  /**
   * What their desk loads (v0.2). Left out, their loads stay as they are; present as undefined, they go back to the
   * defaults of their level and the proposal carries none.
   */
  loads?: Loads | undefined;
}

export function editPerson(p: OrgProposal, id: string, edit: PersonEdit): OrgProposal {
  const { loads, ...rest } = edit;
  const touchesLoads = Object.hasOwn(edit, 'loads');
  return {
    ...p,
    people: p.people.map((x) => {
      if (x.id !== id) return x;
      const next: ProposedPerson = { ...x, ...rest, name: edit.name.trim(), title: edit.title.trim(), owns: edit.owns.trim() };
      if (touchesLoads) {
        if (loads) next.loads = loads;
        else delete next.loads;
      }
      return next;
    }),
  };
}

/** Takes someone out; whoever reported to them reports to their manager instead. */
export function removePerson(p: OrgProposal, id: string): OrgProposal {
  const gone = p.people.find((x) => x.id === id);
  if (!gone) return p;
  return { ...p, people: p.people.filter((x) => x.id !== id).map((x) => (x.reportsTo === id ? { ...x, reportsTo: gone.reportsTo } : x)) };
}

/** A role id the proposal doesn't use yet: "frontend-engineer", then "frontend-engineer-2". */
export function freeId(p: Pick<OrgProposal, 'people' | 'rooms'>, wanted: string): string {
  const base = slugId(wanted) || 'person';
  const taken = new Set([...p.people.map((x) => x.id), ...p.rooms.map((r) => r.id)]);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** The manager a newcomer to a room reports to: its team lead, else its head, else the CEO. */
export function defaultManager(p: OrgProposal, room: string): string | null {
  const inRoom = p.people.filter((x) => x.room === room);
  return inRoom.find((x) => x.level === 'lead')?.id ?? inRoom.find((x) => x.level === 'head')?.id ?? p.people.find((x) => x.level === 'ceo')?.id ?? null;
}

export function addPerson(p: OrgProposal, input: { room: string; name: string; title: string; model: RoleModel; owns: string; library: string | null }): { proposal: OrgProposal; id: string } {
  const id = freeId(p, input.library ?? input.title);
  const person: ProposedPerson = {
    id, name: input.name.trim(), title: input.title.trim(), level: 'worker', room: input.room, reportsTo: defaultManager(p, input.room), model: input.model, owns: input.owns.trim(),
    ...(input.library ? { library: input.library } : {}),
  };
  return { proposal: { ...p, people: [...p.people, person] }, id };
}

export function addRoom(p: OrgProposal, input: { title: string; style: BaseDepartment }): { proposal: OrgProposal; id: string } {
  const id = freeId(p, input.title);
  return { proposal: { ...p, rooms: [...p.rooms, { id, title: input.title.trim(), style: input.style }] }, id };
}

/** Managers someone may report to, by the org's rules for their level (managerProblem), never anyone under them. */
export function managerChoices(p: OrgProposal, id: string | null): ProposedPerson[] {
  const under = new Set<string>();
  if (id) {
    for (let queue = [id]; queue.length > 0; ) {
      const next: string[] = [];
      for (const at of queue) {
        for (const x of p.people) {
          if (x.reportsTo !== at || under.has(x.id)) continue;
          under.add(x.id);
          next.push(x.id);
        }
      }
      queue = next;
    }
  }
  const level = p.people.find((x) => x.id === id)?.level ?? 'worker';
  return p.people
    .filter((x) => x.id !== id && !under.has(x.id) && x.level !== 'worker' && managerProblem(level, x.id, x.level) === null)
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** "Ada, head of design" for a select's option and a sentence's first mention. */
export const named = (x: Pick<ProposedPerson, 'name' | 'title'>): string => introduce({ name: x.name || x.title, title: x.title });

// ---------------------------------------------------------------------------------------------------------------
// The CEO's questions: an answer goes to the CEO as a message, which is also how the panel knows it was answered

/** The message an answer to one of the proposal's questions sends the CEO. */
export const answerText = (q: ProposedQuestion, answer: string): string => `About “${q.text}”: ${answer}`;

/** Your latest answer to a proposal question, from the messages you sent the CEO since the proposal came. */
export function answerOf(q: ProposedQuestion, messages: readonly Message[], ceo: string | undefined, since: number): string | null {
  const opening = `About “${q.text}”: `;
  const sent = messages.filter((m) => m.from === STAKEHOLDER && m.to === ceo && m.at >= since && m.text.startsWith(opening));
  const last = sent.at(-1);
  return last ? last.text.slice(opening.length) : null;
}

/** The inbox's question for one of the proposal's: the hub asks each as a question of the CEO's (the newest still standing). */
export function questionRecord(q: ProposedQuestion, questions: readonly Question[], ceo: string | undefined): Question | null {
  return questions.filter((x) => x.from === ceo && x.text === q.text && x.withdrawn === null).at(-1) ?? null;
}

/** Where your answer to one of the proposal's questions stands: in the inbox's undo window, given, or not yet. */
export function proposalAnswer(q: ProposedQuestion, record: Question | null, messages: readonly Message[], ceo: string | undefined, since: number): { text: string; appliesAt: number | null } | null {
  if (record) {
    const given = record.answer;
    if (!given) return null;
    // A pressed option comes back as its index, with no words of its own.
    return { text: given.option !== null ? (record.options[given.option] ?? given.text) : given.text, appliesAt: given.appliesAt };
  }
  const sent = answerOf(q, messages, ceo, since);
  return sent === null ? null : { text: sent, appliesAt: null };
}

/** "Two questions are open. Starting uses the CEO's picks for them." Null when none is. */
export function openQuestionsNote(open: number): string | null {
  if (open === 0) return null;
  return open === 1 ? "One question is open. Starting uses the CEO's pick for it." : `${capital(countWord(open))} questions are open. Starting uses the CEO's picks for them.`;
}

/** When the proposal now on show arrived: the latest proposal entry in the company's log. */
export function proposedAt(company: Pick<CompanyView, 'log'>): number {
  return company.log.filter((e) => e.kind === 'proposal').at(-1)?.at ?? 0;
}

/** The library for "Add someone": being read, read, or not, with the office's sentence for why. */
export type Catalogue = { state: 'reading' } | { state: 'read'; roles: CatalogRole[] } | { state: 'failed'; problem: string };

/**
 * "Couldn't read the library. The office didn't answer." The office's sentence for why comes without its "Try again",
 * which the button beside the line says.
 */
export function libraryProblem(problem: string): string {
  const why = problem.trim().replace(/\s*Try again\.?$/i, '').trim() || "The office didn't answer";
  return `Couldn't read the library. ${/[.?!…]$/.test(why) ? why : `${why}.`}`;
}
