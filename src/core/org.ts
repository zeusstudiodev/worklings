// The CEO's org proposal (`propose_org`): the shape every part reads. The office draws it as a chart, the
// stakeholder edits it, and starting the company writes it to .claude/agents/ and studio.yaml. Also the org rules more
// than one part applies (who may manage whom) and office changes. Pure, with no Node APIs: the web app checks edits
// and office changes with the same code the server writes them with.
import { introduce, LIMITS, type OfficeChange, peopleOf } from './company.ts';
import { dict } from './company-state.ts';
import { cutSentence, cutText } from './cut.ts';
import { BASE_DEPARTMENTS, type BaseDepartment } from './departments.ts';
import { checkLoads, estimateLoads, type LoadCost, type Loads } from './loads.ts';
import { MAX_DECOR, ROOM_KINDS, type RoomKind, THEMES, type Theme } from './looks.ts';
import { type ModelsByLevel, PRESETS, DEFAULT_PRESET, type PresetId } from './presets.ts';
import { harnessProposal } from './harness-shape.ts';
import { HEAD_BRIEFS, HEADS_OVER, isCheckerSeat, isSize, type Size, SIZE_RULES, SIZES } from './size.ts';
import {
  checkLook,
  checkTheme,
  importProblem,
  LEVELS,
  type Level,
  type Look,
  type OfficeRoom,
  PERSON_NAME,
  ROLE_ID,
  ROLE_MODELS,
  type RoleModel,
  type Studio,
  type StudioOffice,
  titleFromId,
  validateStudio,
} from './studio.ts';

/**
 * How many people an org holds at the most: the CEO and at least one person who does the work, up to 25. Within that the
 * CEO picks a `size` (src/core/size.ts: small, medium or large, each with its own shape), under what the stakeholder's
 * preset allows (src/core/presets.ts), and says why in `sizing`; the stakeholder's own edits aren't held to any of it.
 */
export const ORG_SIZE = { min: 2, max: 25 } as const;
/** A room with more people than this gets a team lead. */
export const TEAM_LEAD_OVER = 6;

/** A department's room in the proposal. `style` is the base department whose colour and furniture it borrows. */
export interface ProposedRoom {
  id: string;
  title: string;
  style: BaseDepartment;
  theme?: Theme;
}

/** A role written for this company because the library has none for its area, to the library's bar. */
export interface NewRole {
  /** What the role does and when to use it, 60 to 400 characters, as the library's descriptions are. */
  description: string;
  /** The role's instructions: mission, what it owns, how it works, handoffs and done, in markdown. */
  body: string;
  tags?: string[];
}

export interface ProposedPerson {
  /** The role id, which is also the agent's file name. */
  id: string;
  /** A first name ("Ada"). */
  name: string;
  title: string;
  level: Level;
  room: string;
  /** The person's manager; null only for the CEO. */
  reportsTo: string | null;
  model: RoleModel;
  look?: Look;
  /**
   * v0.2: what this person's desk loads, assigned by the CEO from what the user has installed and editable before the
   * start. Left out, it is the defaults of their level (src/core/loads.ts): a lean desk with nothing extra.
   */
  loads?: Loads;
  /** One sentence: the area this person owns. */
  owns: string;
  /** The library role this person is tailored from; absent when `role` is written for this company. */
  library?: string;
  /** Project notes that fit a library role to this company. */
  notes?: string[];
  role?: NewRole;
}

/** A decision the CEO needs from the stakeholder before the start, with two to four options and its pick. */
export interface ProposedQuestion {
  text: string;
  options: string[];
  recommended?: number;
}

export interface OrgProposal {
  company: string;
  goal: string;
  /**
   * v0.2: the CEO's one judgment of how big the company is, which code holds the people to (checkProposal) and the plan
   * to (checkPlan). Proposals kept from before it existed, and orgs the stakeholder edited, may not carry it.
   */
  size?: Size;
  /**
   * Why this size, in a sentence that starts with the reason rather than the count, which the summary shows already ("A single
   * small CLI: one engineer builds it and the CEO manages them directly."). The CEO's
   * proposals carry it; proposals kept from before it existed don't.
   */
  sizing?: string;
  theme: Theme;
  rooms: ProposedRoom[];
  people: ProposedPerson[];
  questions: ProposedQuestion[];
}

/** What a proposal's fields may hold, in characters (counts for lists). */
export const PROPOSAL_LIMITS = {
  company: 60,
  goal: 500,
  sizing: 300,
  rooms: 12,
  roomTitle: 40,
  title: 60,
  owns: 200,
  /** Notes per person: an agent file holds eight, and two of them say who the person is and what they own. */
  notes: 6,
  note: 300,
  description: { min: 60, max: 400 },
  body: 12_000,
  tags: 10,
  tag: 40,
  questions: 10,
  /** The most people in an org the stakeholder edited, which the CEO's 2 to 25 doesn't bind. */
  people: 60,
} as const;

/** At most this many sentences come back for a proposal that doesn't check out. */
export const MAX_PROPOSAL_ERRORS = 20;

/** The rooms every company's office has besides its departments' rooms. A proposal's rooms can't take their ids. */
export const OFFICE_ROOMS: readonly OfficeRoom[] = [
  { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
  { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
];

/** At most this many rooms that aren't a department's, so the office stays small enough to draw. */
export const MAX_OFFICE_ROOMS = 12;

/** A role written for the company, as the library linter reads one (`lintNewRole` in src/org). */
export interface RoleDraft {
  id: string;
  title: string;
  department: BaseDepartment;
  description: string;
  model: RoleModel;
  body: string;
  tags: string[];
}

export interface ProposalKnown {
  /** The library's role ids, which `library` must name. */
  libraryRoles: ReadonlySet<string>;
  /**
   * The library linter's checks for a role written for the company, as sentences without a file name. The server
   * passes the linter's own (src/org); the browser can't run it, so without one a new role's body is only sized.
   */
  lintRole?: (role: RoleDraft) => string[];
  /**
   * The MCP servers the user has installed, by catalogue name, which a person's `loads.mcp` may name. Without it (the
   * browser) only the names' shape is checked; the server checks them against the catalogue when it writes the org.
   */
  mcpServers?: ReadonlySet<string> | null;
  /**
   * false for an org the stakeholder edited: the CEO's 2 to 25 and its sizing sentence never block their start
   * (docs/design-v3.md), and only PROPOSAL_LIMITS.people does. The CEO's proposals keep both (the default).
   */
  enforceSize?: boolean;
  /** v0.2: the stakeholder's preset, which caps the size the CEO may pick. Balanced when not given. */
  preset?: PresetId;
  /**
   * v0.2: what a person with no model gets, by level (the preset's, as the stakeholder set them; Balanced's when not
   * given): the CEO on Opus, everyone else on Sonnet. For the CEO's proposals (enforceSize left on) an `inherit` counts as
   * no model too, since the CEO writes it out of habit; the stakeholder's edit keeps `inherit`, their own model.
   */
  models?: ModelsByLevel;
  /**
   * v0.4 (SPEC-v0.4.md, H1): the company is harness-shaped, so the CEO's proposal is held to its seats (the Lead, Builders,
   * the Tester and the Reviewer) by harnessProposal, which fills in what it can, instead of to a size's shape. Only the
   * CEO's proposals; the stakeholder's own edit is never reshaped.
   */
  harness?: boolean;
  /** v0.5: with `harness`, the solo shape's seats (SPEC-v0.5.md): no Tester. */
  solo?: boolean;
}

/** `notes`: what code cut or dropped from the CEO's proposal instead of refusing it (v0.2): over-long text and extra notes. */
export type ProposalCheck = { ok: true; proposal: OrgProposal; notes?: string[] } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * What the proposal being checked cuts instead of refusing, and what it cut: set by checkProposal for the length of the
 * (synchronous) check, so every text field reads it without one more argument.
 */
let fitting: { cut: boolean; notes: string[] } | null = null;

/** One line of text from outside: runs of whitespace and control characters become one space. */
const oneLine = (v: string): string => v.replace(/[\s\p{Cc}]+/gu, ' ').trim();
/** Markdown from outside: Unix line ends, and no control characters but tabs and line ends. */
const markdown = (v: string): string =>
  v.replace(/\r\n?/g, '\n').replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : '')).trim();

/** A value inside an error: quoted as studio.ts does, and never the whole of a long text. */
function shown(v: unknown): string {
  if (v === undefined || v === null) return 'nothing';
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'an object';
  return String(v);
}

const fieldName = (key: string) => (/^[A-Za-z_$][\w$-]{0,39}$/.test(key) ? key : JSON.stringify(key.length > 40 ? `${key.slice(0, 40)}…` : key));

/** "a", "a and b", "a, b and c". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

const LEVEL_WORDS: Record<Level, string> = { ceo: 'the CEO', head: 'a head', lead: 'a team lead', worker: 'a worker' };

/**
 * Why a person at `level` can't report to `managerId` at `managerLevel`, or null when they can: heads report to the
 * CEO, team leads to a head or the CEO, workers to a team lead, a head or the CEO. Proposals, hires and moves apply it.
 */
export function managerProblem(level: Level, managerId: string, managerLevel: Level): string | null {
  if (level === 'ceo') return 'the CEO reports to the stakeholder, so it has no manager';
  if (managerLevel === 'worker') return `"${managerId}" is a worker; people report to the CEO, a head or a team lead`;
  if (level === 'head' && managerLevel !== 'ceo') return `heads report to the CEO, and "${managerId}" is ${LEVEL_WORDS[managerLevel]}`;
  if (level === 'lead' && managerLevel === 'lead') return `team leads report to a head or the CEO, and "${managerId}" is a team lead`;
  return null;
}

/** Device names Windows keeps in every folder: an agent file called nul.md can't be written there. */
const DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
export const isDeviceName = (id: string): boolean => DEVICE_NAMES.test(id);

const PROPOSAL_KEYS = ['company', 'goal', 'size', 'sizing', 'theme', 'rooms', 'people', 'questions'];
const ROOM_KEYS = ['id', 'title', 'style', 'theme'];
const PERSON_KEYS = ['id', 'name', 'title', 'level', 'room', 'reportsTo', 'model', 'look', 'loads', 'owns', 'library', 'notes', 'role'];
const ROLE_KEYS = ['description', 'body', 'tags'];
const QUESTION_KEYS = ['text', 'options', 'recommended'];

/**
 * Checks a proposal from the CEO (or an edit of one) against the org's schema: the shape, 2 to 25 people with a
 * sentence on why that many, one CEO,
 * a tree in which heads report to the CEO, team leads to a head or the CEO and workers to either or a team lead, a
 * team lead in any room of more than six, rooms and ids that exist and don't clash, names, looks, themes and models
 * the office knows, library roles that exist, and roles written for the company to the library's bar. Whether two
 * people's areas overlap is the CEO's judgment, not this check's. Errors name the field, as studio.ts does, up to
 * MAX_PROPOSAL_ERRORS of them; text comes back on one line, without control characters.
 */
export function checkProposal(raw: unknown, known: ProposalKnown): ProposalCheck {
  if (!isObj(raw)) return { ok: false, errors: ['the proposal: expected an object with company, goal, size, sizing, theme, rooms, people and questions'] };
  const errors: string[] = [];
  // The CEO's proposals (enforceSize left on) have over-long text cut; a person's own edit is refused for it, as before.
  const fit = { cut: known.enforceSize !== false, notes: [] as string[] };
  let input = raw;
  if (known.harness === true && known.enforceSize !== false) {
    const shaped = harnessProposal(raw, known.preset ?? DEFAULT_PRESET, known.solo === true ? 'solo' : 'harness');
    if (shaped.errors.length > 0) return { ok: false, errors: capped(shaped.errors) };
    input = shaped.raw;
    fit.notes.push(...shaped.notes);
  }
  fitting = fit;
  try {
    return checkWhole(input, known, errors, fit.notes);
  } finally {
    fitting = null;
  }
}

function checkWhole(raw: Obj, known: ProposalKnown, errors: string[], notes: string[]): ProposalCheck {
  strangers(raw, PROPOSAL_KEYS, '', 'a proposal', errors);
  const company = textField(raw.company, 'company', "the company's name", PROPOSAL_LIMITS.company, errors, true);
  const goal = textField(raw.goal, 'goal', 'the goal', PROPOSAL_LIMITS.goal, errors);
  const size = checkSize(raw.size, known, errors);
  const hasSizing = raw.sizing !== undefined && raw.sizing !== null;
  const sizing = hasSizing || known.enforceSize !== false ? textField(raw.sizing, 'sizing', 'a sentence on why this many people', PROPOSAL_LIMITS.sizing, errors) : '';
  let theme: Theme = 'office';
  if (raw.theme === undefined || raw.theme === null) errors.push(`theme: expected one of ${THEMES.join(', ')}, got nothing`);
  else theme = checkTheme(raw.theme, 'theme', errors) ?? 'office';
  const rooms = checkRooms(raw.rooms, errors);
  const people = checkPeople(raw.people, rooms, known, errors);
  // The shape comes after the people are read, and in the same answer as what else is wrong, unless a mistyped id, level
  // or manager would make a head look short of people: one round for everything, not one for each kind of problem.
  if (known.enforceSize !== false && known.harness !== true && !errors.some((e) => STRUCTURE_ERROR.test(e))) checkShape(people, size, known.preset ?? DEFAULT_PRESET, errors);
  checkRoomsHold(rooms, people, known.enforceSize !== false, errors);
  const questions = checkQuestions(raw.questions, errors);
  if (errors.length > 0) return { ok: false, errors: capped(errors) };
  return { ok: true, proposal: { company, goal, ...(size ? { size } : {}), ...(sizing ? { sizing } : {}), theme, rooms, people, questions }, ...(notes.length > 0 ? { notes } : {}) };
}

/** Errors that leave who works for whom unsure: the shape rules wait for them to be put right. */
const STRUCTURE_ERROR = /^people(?:\[\d+\]\.(?:id|level|reportsTo))?:|^size:/;

/** The CEO's size: required for its proposals, and read but never required from the stakeholder's own edit. */
function checkSize(raw: unknown, known: ProposalKnown, errors: string[]): Size | undefined {
  if (isSize(raw)) return raw;
  if ((raw === undefined || raw === null) && known.enforceSize === false) return undefined;
  const { small, medium, large } = SIZE_RULES;
  errors.push(`size: expected one of ${SIZES.join(', ')}, got ${shown(raw)}; pick the one the goal needs: small is ${small.summary}, medium is ${medium.summary}, large is ${large.summary}`);
  return undefined;
}

const idList = (list: readonly ProposedPerson[]): string => andList(list.slice(0, 6).map((p) => `"${p.id}"`)) + (list.length > 6 ? ` and ${list.length - 6} more` : '');

/**
 * The shape a size means, held to the CEO's proposals only: makers, heads, leads and checker seats as the size and the
 * stakeholder's preset allow, and everyone reporting to the CEO unless a head exists. Each message names the person and
 * the exact change.
 */
function checkShape(people: readonly ProposedPerson[], size: Size | undefined, presetId: PresetId, errors: string[]): void {
  if (!size) return;
  const preset = PRESETS[presetId];
  const rule = SIZE_RULES[size];
  const at = (p: ProposedPerson): number => people.indexOf(p);
  const seat = (p: ProposedPerson): string => `people[${at(p)}] ("${p.id}")`;
  const heads = people.filter((p) => p.level === 'head');
  const leads = people.filter((p) => p.level === 'lead');
  const checkers = people.filter((p) => p.level === 'worker' && isCheckerSeat(p));
  const makers = people.filter((p) => p.level === 'worker' && !isCheckerSeat(p));
  const biggest = preset.sizes.at(-1) ?? 'large';

  if (!preset.sizes.includes(size)) {
    errors.push(`size: ${preset.label} allows ${preset.sizes.join(' or ')} companies, and you chose ${size}; set size to ${biggest} or smaller, whichever the goal needs`);
  }
  if (makers.length < rule.makers.min || makers.length > rule.makers.max) {
    const count = `${makers.length} maker${makers.length === 1 ? '' : 's'}${makers.length > 0 ? ` (${idList(makers)})` : ''}`;
    if (size === 'small') {
      errors.push(
        makers.length === 0
          ? 'people: a small company is the CEO plus exactly one maker, and this has none; add the one person who does the work, reporting to the CEO'
          : `people: a small company is the CEO plus exactly one maker, and this has ${count}; keep one and remove the rest, or set size to ${makers.length <= SIZE_RULES.medium.makers.max ? 'medium' : 'large'}`,
      );
    } else if (size === 'medium') {
      errors.push(
        makers.length < rule.makers.min
          ? `people: a medium company is the CEO plus 2 to 4 makers, and this has ${count}; add a maker, or set size to small`
          : `people: a medium company is the CEO plus 2 to 4 makers, and this has ${count}; cut it to 4, or set size to large`,
      );
    } else {
      errors.push(`people: a large company has 5 or more makers, and this has ${count}; set size to ${makers.length <= 1 ? 'small' : 'medium'}, or add the makers the goal needs`);
    }
  } else if (makers.length > preset.maxMakers) {
    errors.push(`people: ${preset.label} allows up to ${preset.maxMakers} makers, and this has ${makers.length} (${idList(makers)}); remove ${makers.length - preset.maxMakers}`);
  }

  // Layers: none below large, and in a large company heads only where more than six makers need briefing.
  const headsAllowed = size === 'large' && makers.length > HEADS_OVER;
  if (!headsAllowed) {
    for (const h of heads) {
      const why = size === 'large' ? `a large company has a head only when more than ${HEADS_OVER} makers work in it, and this has ${makers.length}` : `a ${size} company is flat`;
      errors.push(`${seat(h)} is a head, and ${why}; make them a worker who reports to the CEO, or remove them`);
    }
  } else {
    for (const h of heads) {
      const briefs = people.filter((p) => p.reportsTo === h.id).length;
      if (briefs < HEAD_BRIEFS) {
        errors.push(`${seat(h)} is a head who briefs ${briefs}; a head briefs ${HEAD_BRIEFS} or more: remove them and have their people report to the CEO, or move at least ${HEAD_BRIEFS - briefs} more under them`);
      }
    }
  }
  if (!(headsAllowed && heads.length > 0)) {
    for (const l of leads) errors.push(`${seat(l)} is a team lead, and leads sit only under a head in a large company; make them a worker who reports to the CEO`);
    // A head that was refused above already says where its people go; this is for orgs that never had one.
    for (const p of heads.length > 0 ? [] : people) {
      if (p.level === 'worker' && p.reportsTo !== null && p.reportsTo !== 'ceo' && !leads.some((l) => l.id === p.reportsTo)) {
        errors.push(`people[${at(p)}].reportsTo: with no head in the company everyone reports to the CEO; set it to "ceo"`);
      }
    }
  }

  // Checker seats: the stakeholder's preset allows them, and a size makes room for one or two.
  const room = size === 'small' ? 0 : size === 'medium' ? Math.min(1, preset.checkers) : preset.checkers;
  if (checkers.length > room) {
    const why =
      size === 'small'
        ? 'a small company has none: the maker tests their own work and you check the result yourself at the end'
        : preset.checkers === 0
          ? `${preset.label} has none: makers test their own work, the office runs each task's check, and one independent review comes at the end`
          : size === 'medium'
            ? 'a medium company has at most one'
            : `${preset.label} has at most ${preset.checkers}`;
    for (const c of checkers.slice(room)) errors.push(`${seat(c)} is a QA or reviewer seat, and ${why}; remove them`);
  }
}

function capped(errors: string[]): string[] {
  if (errors.length <= MAX_PROPOSAL_ERRORS) return errors;
  const kept = errors.slice(0, MAX_PROPOSAL_ERRORS - 1);
  return [...kept, `and ${errors.length - kept.length} more problems after these`];
}

/** Fields a shape doesn't have: usually a typo, so they are named instead of dropped. */
function strangers(o: Obj, keys: readonly string[], where: string, what: string, errors: string[]): void {
  for (const key of Object.keys(o)) {
    if (!keys.includes(key)) errors.push(`${where ? `${where}.` : ''}${fieldName(key)}: not part of ${what} (${keys.join(', ')})`);
  }
}

/** HTML comments mark the blocks Worklings rewrites in agent files and CLAUDE.md, so text from people can't hold one. */
const MARKER = '<!--';
const markerError = (where: string) => `${where}: can't hold "${MARKER}", which marks the blocks the office rewrites in agent files and CLAUDE.md`;

/**
 * A text field, on one line. `named` is for the company's name, room names, titles and areas, which reach agent files
 * and CLAUDE.md's block, where Claude Code can take a word that starts with "@" for a file to load.
 */
function textField(v: unknown, where: string, what: string, max: number, errors: string[], named = false): string {
  let text = typeof v === 'string' ? oneLine(v) : '';
  // Over-long free text is cut and accepted, not sent back: a refusal costs the CEO a whole turn to fix a few characters.
  const cut = fitting?.cut === true ? cutText(text, max) : null;
  if (cut) {
    fitting?.notes.push(`${where} was ${cutSentence(text.length, cut)}.`);
    text = cut.text;
  }
  const loads = named ? importProblem(text) : null;
  if (!text) errors.push(`${where}: expected ${what} as text, got ${shown(v)}`);
  else if (text.length > max) errors.push(`${where}: up to ${max} characters, got ${text.length}`);
  else if (text.includes(MARKER)) errors.push(markerError(where));
  else if (loads) errors.push(`${where}: ${loads}`);
  return text;
}

function idField(v: unknown, where: string, errors: string[]): string {
  if (typeof v === 'string' && ROLE_ID.test(v)) return v;
  errors.push(`${where}: expected lowercase letters, digits and hyphens, got ${shown(v)}`);
  return '';
}

function checkRooms(raw: unknown, errors: string[]): ProposedRoom[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('rooms: expected a list of one or more rooms');
    return [];
  }
  if (raw.length > PROPOSAL_LIMITS.rooms) errors.push(`rooms: up to ${PROPOSAL_LIMITS.rooms} rooms, got ${raw.length}`);
  const seen = new Set<string>();
  const rooms: ProposedRoom[] = [];
  raw.forEach((r: unknown, i) => {
    const where = `rooms[${i}]`;
    if (!isObj(r)) {
      errors.push(`${where}: expected an object with id, title and style`);
      return;
    }
    strangers(r, ROOM_KEYS, where, 'a room', errors);
    let id = idField(r.id, `${where}.id`, errors);
    const office = OFFICE_ROOMS.find((o) => o.id === id);
    if (id && seen.has(id)) {
      errors.push(`${where}.id: "${id}" is listed twice`);
      id = '';
    } else if (office) {
      errors.push(`${where}.id: "${id}" is taken by the office's own ${office.kind === 'ceo' ? "CEO's office" : 'meeting room'}`);
      id = '';
    }
    if (id) seen.add(id);
    const title = textField(r.title, `${where}.title`, "the room's name", PROPOSAL_LIMITS.roomTitle, errors, true);
    let style: BaseDepartment = 'engineering';
    if (oneOf(BASE_DEPARTMENTS, r.style)) style = r.style;
    else errors.push(`${where}.style: expected one of ${BASE_DEPARTMENTS.join(', ')}, got ${shown(r.style)}`);
    const room: ProposedRoom = { id, title, style };
    const theme = checkTheme(r.theme, `${where}.theme`, errors);
    if (theme) room.theme = theme;
    rooms.push(room);
  });
  return rooms;
}

function checkPeople(raw: unknown, rooms: readonly ProposedRoom[], known: ProposalKnown, errors: string[]): ProposedPerson[] {
  if (!Array.isArray(raw)) {
    errors.push('people: expected a list of people');
    return [];
  }
  if (known.enforceSize === false) {
    if (raw.length === 0 || raw.length > PROPOSAL_LIMITS.people) errors.push(`people: expected 1 to ${PROPOSAL_LIMITS.people} people, got ${raw.length}`);
  } else if (raw.length < ORG_SIZE.min || raw.length > ORG_SIZE.max) {
    errors.push(`people: expected ${ORG_SIZE.min} to ${ORG_SIZE.max} people, got ${raw.length}`);
  }
  const roomIds = rooms.map((r) => r.id).filter(Boolean);
  const seen = new Set<string>();
  /** Each checked person with where it sat in the list and the manager it named. */
  const checked: { person: ProposedPerson; at: number; manager: unknown }[] = [];
  raw.forEach((p: unknown, at) => {
    if (!isObj(p)) {
      errors.push(`people[${at}]: expected an object with id, name, title, level, room, reportsTo, model and owns`);
      return;
    }
    const person = checkPerson(p, `people[${at}]`, roomIds, rooms, known, errors);
    if (person.id && seen.has(person.id)) {
      errors.push(`people[${at}].id: "${person.id}" is listed twice`);
      person.id = '';
    }
    if (person.id) seen.add(person.id);
    checked.push({ person, at, manager: p.reportsTo });
  });

  // Managers once every id is known. Levels only ever point up, so a tree that passes has no loops.
  const levels = new Map(checked.filter((c) => c.person.id).map((c) => [c.person.id, c.person.level]));
  for (const { person, at, manager } of checked) {
    const where = `people[${at}].reportsTo`;
    if (person.level === 'ceo') {
      if (manager !== null && manager !== undefined) errors.push(`${where}: the CEO reports to the stakeholder, so it is null`);
      continue;
    }
    if (typeof manager !== 'string' || !ROLE_ID.test(manager)) {
      errors.push(`${where}: expected their manager's id, got ${shown(manager)}`);
      continue;
    }
    const managerLevel = levels.get(manager);
    const problem =
      manager === person.id
        ? `"${manager}" can't report to itself`
        : managerLevel === undefined
          ? `"${manager}" is not in the proposal`
          : managerProblem(person.level, manager, managerLevel);
    if (problem) errors.push(`${where}: ${problem}`);
    else person.reportsTo = manager;
  }

  const people = checked.map((c) => c.person);
  const ceos = people.filter((p) => p.level === 'ceo');
  if (raw.length > 0 && ceos.length === 0) errors.push('people: nobody has level ceo; the org needs one CEO');
  if (ceos.length > 1) errors.push(`people: only one person can be the CEO, found ${ceos.map((p) => p.id || '(no id)').join(', ')}`);
  return people;
}

function checkPerson(p: Obj, where: string, roomIds: readonly string[], rooms: readonly ProposedRoom[], known: ProposalKnown, errors: string[]): ProposedPerson {
  strangers(p, PERSON_KEYS, where, 'a person', errors);
  const levelKnown = oneOf(LEVELS, p.level);
  const level: Level = levelKnown ? (p.level as Level) : 'worker';
  if (!levelKnown) errors.push(`${where}.level: expected one of ${LEVELS.join(', ')}, got ${shown(p.level)}`);
  const hasLibrary = p.library !== undefined && p.library !== null;
  const hasRole = p.role !== undefined && p.role !== null;

  let id = idField(p.id, `${where}.id`, errors);
  if (id) {
    let clash: string | null = null;
    if (roomIds.includes(id)) clash = `"${id}" is also a room's id`;
    else if (DEVICE_NAMES.test(id)) clash = `"${id}" is a name Windows keeps for devices; pick another`;
    else if (levelKnown && level === 'ceo' && id !== 'ceo') clash = `the CEO's id is "ceo", got "${id}"`;
    else if (levelKnown && level !== 'ceo' && id === 'ceo') clash = '"ceo" is kept for the CEO';
    else if (hasRole && !hasLibrary && known.libraryRoles.has(id)) clash = `"${id}" is a library role; set library to it, or give the role written for this company another id`;
    if (clash) {
      errors.push(`${where}.id: ${clash}`);
      id = '';
    }
  }

  let name = '';
  if (typeof p.name === 'string' && PERSON_NAME.test(p.name.trim())) name = p.name.trim();
  else errors.push(`${where}.name: expected a first name of letters, up to 40 characters, got ${shown(p.name)}`);
  const title = textField(p.title, `${where}.title`, 'their title', PROPOSAL_LIMITS.title, errors, true);

  let room = '';
  if (typeof p.room === 'string' && roomIds.includes(p.room)) room = p.room;
  else if (typeof p.room === 'string' && p.room) errors.push(`${where}.room: "${p.room}" is not one of the proposal's rooms (${roomIds.join(', ')})`);
  else errors.push(`${where}.room: expected one of the proposal's rooms (${roomIds.join(', ')}), got ${shown(p.room)}`);

  const fallback: RoleModel = (known.models ?? PRESETS[DEFAULT_PRESET].models)[level];
  let model: RoleModel = fallback;
  if (p.model === undefined || p.model === null || (p.model === 'inherit' && known.enforceSize !== false)) model = fallback;
  else if (oneOf(ROLE_MODELS, p.model)) model = p.model;
  else errors.push(`${where}.model: expected one of ${ROLE_MODELS.join(', ')} or left out, got ${shown(p.model)}`);
  const look = checkLook(p.look, `${where}.look`, errors);
  const owns = textField(p.owns, `${where}.owns`, 'one sentence on what they own', PROPOSAL_LIMITS.owns, errors, true);
  const loads = checkLoads(p.loads, `${where}.loads`, errors, { mcp: known.mcpServers ?? null });

  const person: ProposedPerson = { id, name, title, level, room, reportsTo: null, model, owns };
  if (look) person.look = look;
  if (loads) person.loads = loads;
  const ceoRole = (got: unknown) => `${where}.library: the CEO is the library's ceo role, tailored with notes; got ${shown(got)}`;
  if (hasLibrary && hasRole) errors.push(`${where}: give library or role, not both`);
  // Every first proposal left this out for the CEO itself (the plan-only runs, 13 Nov 2026): the CEO is the library's ceo role.
  else if (!hasLibrary && !hasRole && level === 'ceo' && known.libraryRoles.has('ceo')) person.library = 'ceo';
  else if (!hasLibrary && !hasRole) errors.push(`${where}: needs library, a library role to tailor, or role, one written for this company`);
  else if (hasLibrary) {
    if (level === 'ceo' && p.library !== 'ceo') errors.push(ceoRole(p.library));
    else if (typeof p.library === 'string' && known.libraryRoles.has(p.library)) person.library = p.library;
    else errors.push(`${where}.library: ${shown(p.library)} is not a library role`);
  } else if (level === 'ceo') {
    errors.push(ceoRole(undefined));
  } else {
    const style = rooms.find((r) => r.id === room)?.style ?? 'engineering';
    const role = checkNewRole(p.role, `${where}.role`, { id: id || 'new-role', title, department: style, model }, known, errors);
    if (role) person.role = role;
  }

  if (p.notes !== undefined && p.notes !== null) {
    if (!Array.isArray(p.notes)) errors.push(`${where}.notes: expected a list of short notes`);
    else {
      let notes: unknown[] = p.notes;
      if (notes.length > PROPOSAL_LIMITS.notes) {
        if (fitting?.cut === true) {
          fitting.notes.push(`${where}.notes had ${notes.length} notes, and the last ${notes.length - PROPOSAL_LIMITS.notes} were dropped.`);
          notes = notes.slice(0, PROPOSAL_LIMITS.notes);
        } else errors.push(`${where}.notes: up to ${PROPOSAL_LIMITS.notes} notes, got ${notes.length}`);
      }
      person.notes = notes.map((n: unknown, j) => textField(n, `${where}.notes[${j}]`, 'a note', PROPOSAL_LIMITS.note, errors));
    }
  }
  return person;
}

/**
 * Checks a role written for the company outside a proposal (a hire's `written`) to the same bar as a proposal's `role`,
 * with the library linter's sentences when `lintRole` is given. `where` names the field in the errors.
 */
export function checkWrittenRole(
  raw: unknown,
  where: string,
  draft: Omit<RoleDraft, 'description' | 'body' | 'tags'>,
  known: Pick<ProposalKnown, 'lintRole'>,
): { ok: true; role: NewRole } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const role = checkNewRole(raw, where, draft, known, errors);
  return role && errors.length === 0 ? { ok: true, role } : { ok: false, errors: capped(errors) };
}

function checkNewRole(raw: unknown, where: string, draft: Omit<RoleDraft, 'description' | 'body' | 'tags'>, known: Pick<ProposalKnown, 'lintRole'>, errors: string[]): NewRole | null {
  if (!isObj(raw)) {
    errors.push(`${where}: expected an object with description and body`);
    return null;
  }
  strangers(raw, ROLE_KEYS, where, 'a role', errors);
  const { min, max } = PROPOSAL_LIMITS.description;
  const description = typeof raw.description === 'string' ? oneLine(raw.description) : '';
  // Its first sentence is the role's row in CLAUDE.md's block.
  const loads = importProblem(description);
  if (!description) errors.push(`${where}.description: expected what the role does and when to use it as text, got ${shown(raw.description)}`);
  else if (description.length < min || description.length > max) errors.push(`${where}.description: ${min} to ${max} characters, got ${description.length}`);
  else if (description.includes(MARKER)) errors.push(markerError(`${where}.description`));
  else if (loads) errors.push(`${where}.description: ${loads}`);

  let tags: string[] | undefined;
  if (raw.tags !== undefined && raw.tags !== null) {
    if (!Array.isArray(raw.tags) || raw.tags.length > PROPOSAL_LIMITS.tags) errors.push(`${where}.tags: expected a list of up to ${PROPOSAL_LIMITS.tags} short tags`);
    else tags = raw.tags.map((t: unknown, j) => textField(t, `${where}.tags[${j}]`, 'a tag', PROPOSAL_LIMITS.tag, errors));
  }

  const body = typeof raw.body === 'string' ? markdown(raw.body) : '';
  if (!body) errors.push(`${where}.body: expected the role's instructions as markdown, got ${shown(raw.body)}`);
  else if (body.length > PROPOSAL_LIMITS.body) errors.push(`${where}.body: up to ${PROPOSAL_LIMITS.body} characters, got ${body.length}`);
  else if (body.includes(MARKER)) errors.push(markerError(`${where}.body`));
  else if (known.lintRole) {
    for (const problem of known.lintRole({ ...draft, description, body, tags: tags ?? [] })) errors.push(`${where}: ${problem}`);
  }
  const role: NewRole = { description, body };
  if (tags) role.tags = tags;
  return role;
}

/**
 * Rooms need people, and a team lead once they hold more than TEAM_LEAD_OVER, except in the CEO's proposals (`flat`),
 * where leads are a layer the size rules mostly keep out.
 */
function checkRoomsHold(rooms: readonly ProposedRoom[], people: readonly ProposedPerson[], flat: boolean, errors: string[]): void {
  if (people.length === 0) return;
  rooms.forEach((room, i) => {
    if (!room.id) return;
    const inside = people.filter((p) => p.room === room.id);
    if (inside.length === 0) errors.push(`rooms[${i}]: nobody works in "${room.id}"; give it a person or leave it out`);
    else if (!flat && inside.length > TEAM_LEAD_OVER && !inside.some((p) => p.level === 'lead')) {
      errors.push(`rooms[${i}]: "${room.id}" has ${inside.length} people and no team lead; make one of them level lead`);
    }
  });
}

function checkQuestions(raw: unknown, errors: string[]): ProposedQuestion[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push('questions: expected a list, empty when there is nothing to ask');
    return [];
  }
  if (raw.length > PROPOSAL_LIMITS.questions) errors.push(`questions: up to ${PROPOSAL_LIMITS.questions} questions, got ${raw.length}`);
  const questions: ProposedQuestion[] = [];
  raw.forEach((q: unknown, i) => {
    const where = `questions[${i}]`;
    if (!isObj(q)) {
      errors.push(`${where}: expected an object with text, options and recommended`);
      return;
    }
    strangers(q, QUESTION_KEYS, where, 'a question', errors);
    const text = textField(q.text, `${where}.text`, 'the question', LIMITS.question, errors);
    const { min, max } = LIMITS.options;
    let options: string[] = [];
    if (!Array.isArray(q.options) || q.options.length < min || q.options.length > max) {
      errors.push(`${where}.options: expected ${min} to ${max} options, got ${Array.isArray(q.options) ? q.options.length : shown(q.options)}`);
    } else {
      options = q.options.map((o: unknown, j) => textField(o, `${where}.options[${j}]`, 'an option', LIMITS.option, errors));
      options.forEach((o, j) => {
        if (o && options.indexOf(o) !== j) errors.push(`${where}.options[${j}]: "${o}" is listed twice`);
      });
    }
    const pick = q.recommended;
    const question: ProposedQuestion = { text, options };
    if (typeof pick === 'number' && Number.isInteger(pick) && pick >= 0 && pick < options.length) question.recommended = pick;
    else if (options.length > 0) errors.push(`${where}.recommended: expected the index of your pick, 0 to ${options.length - 1}, got ${shown(pick)}`);
    questions.push(question);
  });
  return questions;
}

// ---------------------------------------------------------------------------------------------------------------
// The CEO's scoping questions (`ask_scoping`), asked before it drafts the org

/** A question the CEO asks before it drafts the org: two to four options, its pick, and why it picks that one. */
export interface ScopingQuestion {
  text: string;
  options: string[];
  recommended: number;
  why: string;
}

const SCOPING_KEYS = ['text', 'options', 'recommended', 'why'];

/**
 * Checks the CEO's scoping questions: one to five (LIMITS.scoping), each a question with two to four distinct options,
 * the index of its pick and a line on why. Errors name the field, as the proposal's do; text comes back on one line.
 */
export function checkScoping(raw: unknown): { ok: true; questions: ScopingQuestion[] } | { ok: false; errors: string[] } {
  const { min, max } = LIMITS.scoping;
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    return { ok: false, errors: [`questions: expected ${min} to ${max} questions, got ${Array.isArray(raw) ? raw.length : shown(raw)}`] };
  }
  const errors: string[] = [];
  const questions: ScopingQuestion[] = [];
  const texts = new Set<string>();
  raw.forEach((q: unknown, i) => {
    const where = `questions[${i}]`;
    if (!isObj(q)) {
      errors.push(`${where}: expected an object with text, options, recommended and why`);
      return;
    }
    strangers(q, SCOPING_KEYS, where, 'a scoping question', errors);
    const text = textField(q.text, `${where}.text`, 'the question', LIMITS.question, errors);
    if (text && texts.has(text.toLowerCase())) errors.push(`${where}.text: "${text.slice(0, 40)}" is asked twice`);
    if (text) texts.add(text.toLowerCase());
    const { min: fewest, max: most } = LIMITS.options;
    let options: string[] = [];
    if (!Array.isArray(q.options) || q.options.length < fewest || q.options.length > most) {
      errors.push(`${where}.options: expected ${fewest} to ${most} options, got ${Array.isArray(q.options) ? q.options.length : shown(q.options)}`);
    } else {
      options = q.options.map((o: unknown, j) => textField(o, `${where}.options[${j}]`, 'an option', LIMITS.option, errors));
      const lower = options.map((o) => o.toLowerCase());
      options.forEach((o, j) => {
        if (o && lower.indexOf(o.toLowerCase()) !== j) errors.push(`${where}.options[${j}]: "${o}" is listed twice`);
      });
    }
    const pick = q.recommended;
    const recommended = typeof pick === 'number' && Number.isInteger(pick) && pick >= 0 && pick < options.length ? pick : -1;
    if (recommended === -1 && options.length > 0) errors.push(`${where}.recommended: expected the index of your pick, 0 to ${options.length - 1}, got ${shown(pick)}`);
    const why = textField(q.why, `${where}.why`, 'a line on why you pick it', LIMITS.why, errors);
    questions.push({ text, options, recommended: Math.max(0, recommended), why });
  });
  return errors.length > 0 ? { ok: false, errors: capped(errors) } : { ok: true, questions };
}

// ---------------------------------------------------------------------------------------------------------------
// Office changes (`change_office` and the Customize panel)

const THEME_WORDS: Partial<Record<Theme, string>> = { cafe: 'café', 'game-studio': 'game studio', 'music-studio': 'music studio' };
/** A theme in a sentence: "café", "game studio". */
export const themeWord = (theme: Theme): string => THEME_WORDS[theme] ?? theme.replaceAll('-', ' ');

const KIND_WORDS: Record<RoomKind, string> = {
  meeting: 'meeting room',
  ceo: "CEO's office",
  reception: 'front desk',
  lounge: 'lounge',
  games: 'games room',
  kitchen: 'kitchen',
};

export type OfficeChangeResult =
  | {
      ok: true;
      studio: Studio;
      /** False when the office already looked like that: there is nothing to write. */
      changed: boolean;
      /** What changed and how to undo it, in sentences. */
      message: string;
      /** The change that puts the office back as it was, for an Undo button. */
      undo: OfficeChange;
    }
  | { ok: false; code: 'invalid' | 'unknown'; error: string };

const refuse = (error: string, code: 'invalid' | 'unknown' = 'invalid'): OfficeChangeResult => ({ ok: false, code, error });
const them = (n: number) => (n === 1 ? 'it' : 'them');
const pieceWords = (ids: readonly string[]) => andList(ids.map((id) => id.replaceAll('-', ' ')));

/**
 * Applies an office change to a studio, or refuses it with a sentence saying why. It changes the office section
 * (created when a studio has none yet), a room's theme and people's looks, never departments or people, and keeps a
 * studio that validateStudio accepts.
 */
export function applyOfficeChange(studio: Studio, raw: unknown): OfficeChangeResult {
  const kinds = 'An office change is one of theme, add-room, remove-room, room-theme, decor or look.';
  if (!isObj(raw) || typeof raw.change !== 'string') return refuse(kinds);
  const next = structuredClone(studio);
  const office: StudioOffice = next.office ?? { theme: 'office', rooms: [], decor: [] };
  next.office = office;
  const done = (changed: boolean, message: string, undo: OfficeChange): OfficeChangeResult => {
    if (!changed) return { ok: true, studio, changed, message, undo };
    const valid = validateStudio(next);
    if (!valid.ok) return refuse(`That change would leave studio.yaml with a mistake, so nothing changed: ${valid.errors[0] ?? ''}.`);
    return { ok: true, studio: next, changed, message, undo };
  };
  const roomById = (id: string) => next.departments.find((d) => d.id === id) ?? office.rooms.find((r) => r.id === id);
  const themes = THEMES.join(', ');

  switch (raw.change) {
    case 'theme': {
      if (!oneOf(THEMES, raw.theme)) return refuse(`The office's theme is one of ${themes}, not ${shown(raw.theme)}.`);
      const before = office.theme;
      const undo: OfficeChange = { change: 'theme', theme: before };
      if (before === raw.theme) return done(false, `The office's theme is ${themeWord(before)} already.`, undo);
      office.theme = raw.theme;
      return done(true, `The office's theme is ${themeWord(raw.theme)} now (it was ${themeWord(before)}). Set it back to ${themeWord(before)} to undo it.`, undo);
    }

    case 'add-room': {
      const r = raw.room;
      if (!isObj(r)) return refuse('A new room needs an id, a title and a kind.');
      if (typeof r.id !== 'string' || !ROLE_ID.test(r.id)) return refuse(`A room's id is lowercase letters, digits and hyphens, like "games-room"; got ${shown(r.id)}.`);
      const id = r.id;
      if (roomById(id)) return refuse(`There is a room called "${id}" already.`);
      if (next.roles.some((p) => p.id === id)) return refuse(`"${id}" is someone's id; give the room another one.`);
      if (!oneOf(ROOM_KINDS, r.kind)) return refuse(`A room's kind is one of ${ROOM_KINDS.join(', ')}, not ${shown(r.kind)}.`);
      const title = typeof r.title === 'string' && oneLine(r.title) ? oneLine(r.title) : titleFromId(id);
      if (title.length > 40) return refuse(`A room's title is up to 40 characters; this one has ${title.length}.`);
      const hasTheme = r.theme !== undefined && r.theme !== null;
      if (hasTheme && !oneOf(THEMES, r.theme)) return refuse(`A room's theme is one of ${themes}, not ${shown(r.theme)}.`);
      if (office.rooms.length >= MAX_OFFICE_ROOMS) return refuse(`The office has ${MAX_OFFICE_ROOMS} rooms besides the departments'. Remove one to add another.`);
      const room: OfficeRoom = { id, title, kind: r.kind };
      if (oneOf(THEMES, r.theme)) room.theme = r.theme;
      // In kind order, then by id: a room taken out and added back returns to its place, so undo is exact.
      const after = (x: OfficeRoom) => ROOM_KINDS.indexOf(x.kind) > ROOM_KINDS.indexOf(room.kind) || (x.kind === room.kind && x.id > room.id);
      const at = office.rooms.findIndex(after);
      office.rooms.splice(at === -1 ? office.rooms.length : at, 0, room);
      const kind = KIND_WORDS[room.kind];
      const what = `${title}${title.toLowerCase() === kind.toLowerCase() ? '' : `, a ${kind}`}${room.theme ? ` with the ${themeWord(room.theme)} theme` : ''}`;
      return done(true, `Added ${what}. Remove the room to undo it.`, { change: 'remove-room', room: id });
    }

    case 'remove-room': {
      if (typeof raw.room !== 'string') return refuse('Say which room to remove, by its id.');
      const department = next.departments.find((d) => d.id === raw.room);
      if (department) return refuse(`${department.name} is a department's room; only rooms that aren't a department's, like the meeting room, can be removed.`);
      const room = office.rooms.find((r) => r.id === raw.room);
      if (!room) return refuse(`There is no "${raw.room}" room to remove.`, 'unknown');
      office.rooms = office.rooms.filter((r) => r !== room);
      return done(true, `Removed ${room.title}. Adding it back undoes it.`, { change: 'add-room', room });
    }

    case 'room-theme': {
      if (typeof raw.room !== 'string') return refuse('Say which room, by its id.');
      const room = roomById(raw.room);
      if (!room) return refuse(`There is no "${raw.room}" room.`, 'unknown');
      const theme = raw.theme;
      if (theme !== null && !oneOf(THEMES, theme)) return refuse(`A room's theme is one of ${themes}, or null for the office's own; not ${shown(theme)}.`);
      const before = room.theme ?? null;
      const undo: OfficeChange = { change: 'room-theme', room: room.id, theme: before };
      const name = 'name' in room ? room.name : room.title;
      if (before === theme) return done(false, `${name} has that theme already.`, undo);
      if (theme === null) delete room.theme;
      else room.theme = theme;
      const now = theme === null ? `${name} follows the office's theme now.` : `${name} has the ${themeWord(theme)} theme now.`;
      return done(true, `${now} ${before ? `Set it back to ${themeWord(before)}` : "Set it back to the office's theme"} to undo it.`, undo);
    }

    case 'decor': {
      const { add, remove } = raw;
      if (!Array.isArray(add) || !Array.isArray(remove) || add.length > MAX_DECOR || remove.length > MAX_DECOR) {
        return refuse(`A decor change lists the pieces to add and to remove, up to ${MAX_DECOR} each.`);
      }
      const bad = [...add, ...remove].find((d: unknown) => typeof d !== 'string' || !ROLE_ID.test(d));
      if (bad !== undefined) return refuse(`A decor piece is an id like "plants"; got ${shown(bad)}.`);
      const adding = add as string[];
      const removing = remove as string[];
      if (adding.length === 0 && removing.length === 0) return refuse('Name a piece to add or remove.');
      const decor = [...office.decor];
      // The last of a piece goes first, so undoing an add takes away the one it added.
      for (const piece of removing) {
        const at = decor.lastIndexOf(piece);
        if (at === -1) return refuse(`There is no "${piece}" in the office to remove.`, 'unknown');
        decor.splice(at, 1);
      }
      decor.push(...adding);
      if (decor.length > MAX_DECOR) return refuse(`The office holds ${MAX_DECOR} pieces. Remove one to add another.`);
      office.decor = decor;
      const message =
        removing.length === 0
          ? `Added ${pieceWords(adding)} to the office. Removing ${them(adding.length)} undoes it.`
          : adding.length === 0
            ? `Removed ${pieceWords(removing)} from the office. Adding ${them(removing.length)} back undoes it.`
            : `Added ${pieceWords(adding)} and removed ${pieceWords(removing)}. Swapping them back undoes it.`;
      return done(true, message, { change: 'decor', add: [...removing], remove: [...adding] });
    }

    case 'look': {
      if (typeof raw.person !== 'string') return refuse('Say whose look to change, by their id.');
      const role = next.roles.find((r) => r.id === raw.person);
      if (!role) return refuse(`"${raw.person}" is not on the staff.`, 'unknown');
      if (!isObj(raw.look)) return refuse('A look is an object with body, color, hair, skin or prop.');
      const errors: string[] = [];
      const look = checkLook(raw.look, 'look', errors) ?? {};
      if (errors.length > 0) return refuse(`That look doesn't fit: ${errors[0] ?? ''}.`);
      const before = role.look ?? {};
      const person = peopleOf(next).find((p) => p.id === role.id);
      const who = person ? introduce(person) : role.id;
      const undo: OfficeChange = { change: 'look', person: role.id, look: before };
      if (JSON.stringify(before) === JSON.stringify(look)) return done(false, `That is the look of ${who} already.`, undo);
      if (Object.keys(look).length === 0) delete role.look;
      else role.look = look;
      return done(true, `Changed the look of ${who}. Setting it back undoes it.`, undo);
    }

    default:
      return refuse(kinds);
  }
}

/** What each person's desk adds up to in fixed-prompt tokens (estimateLoads), for the proposal's chart and summary. */
export function proposalLoadCosts(proposal: Pick<OrgProposal, 'people'>): { byPerson: Record<string, LoadCost>; tokens: number } {
  const byPerson: Record<string, LoadCost> = dict<LoadCost>();
  let tokens = 0;
  for (const p of proposal.people) {
    const cost = estimateLoads(p.loads, p.level);
    byPerson[p.id] = cost;
    tokens += cost.tokens;
  }
  return { byPerson, tokens };
}
