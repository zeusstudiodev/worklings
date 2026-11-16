// studio.yaml: the manifest that ties a project's Claude Code files to rooms in the office.
import { parse, stringify } from 'yaml';
import { type BaseDepartment, BASE_DEPARTMENT_INFO, isBaseDepartment } from './departments.ts';
import { checkLoads, type Loads } from './loads.ts';
import { HEX_COLOUR, LOOK_BODIES, LOOK_PROPS, type LookBody, type LookProp, MAX_DECOR, ROOM_KINDS, type RoomKind, SKIN_TONES, THEMES, type Theme } from './looks.ts';

export const RIGOR_LEVELS = ['lean', 'standard', 'full'] as const;
export type Rigor = (typeof RIGOR_LEVELS)[number];

/** Where a person sits in a company's org (v3). A role without a level is a worker. */
export const LEVELS = ['ceo', 'head', 'lead', 'worker'] as const;
export type Level = (typeof LEVELS)[number];

/** How a person looks in the office. Whatever is missing comes from their room's colour and a stable hash. */
export interface Look {
  body?: LookBody;
  /** The outfit's main colour; the rest of the outfit is shaded from it. */
  color?: string;
  hair?: string;
  /** Index into the skin tones, light to dark. */
  skin?: number;
  prop?: LookProp;
}

export interface StudioDepartment {
  id: string;
  name: string;
  /** Base department whose look and colour this room borrows. */
  style: BaseDepartment;
  /** v3: the room's own theme, when it differs from the office's. */
  theme?: Theme;
}

/** v3: a room that isn't a department's (the meeting room, the CEO's office, a games room). */
export interface OfficeRoom {
  id: string;
  title: string;
  kind: RoomKind;
  theme?: Theme;
}

/** v3: the office around the org: its theme, the extra rooms and the decor pieces placed in it. */
export interface StudioOffice {
  theme: Theme;
  rooms: OfficeRoom[];
  decor: string[];
}

export interface StudioRole {
  /** The subagent's `name`, which is also its file name in .claude/agents/. */
  id: string;
  department: string;
  title: string;
  /** v3: the person's first name in the company ("Ada"). Messages and the office use the title without one. */
  name?: string;
  /** v3: the role's place in the org. */
  level?: Level;
  /** v3: the role this one reports to. The CEO reports to the stakeholder and has none. */
  reportsTo?: string;
  look?: Look;
  /** v0.2: what the person's desk loads. Missing reads as the defaults of their level (src/core/loads.ts). */
  loads?: Loads;
  /** Library archetype the role was generated from, if any. */
  archetype?: string;
  /**
   * The subagent's `name` when it isn't an id (agency-agents style "Frontend Developer"): Claude Code reports that
   * name, while the role's id is a slug of it.
   */
  agent?: string;
}

export interface StudioRule {
  /** File name in .claude/rules/ without the extension. */
  id: string;
  department: string;
  title: string;
}

export interface StudioGate {
  /** Skill name in .claude/skills/. A gate runs when the Skill tool invokes it. */
  id: string;
  title: string;
  /** The rooms the gate's door connects: work passes from the first to the second. */
  from: string;
  to: string;
}

export interface StudioSkill {
  id: string;
  title: string;
}

export interface FiredRole {
  id: string;
  department: string;
  title: string;
  /** Path of the archived agent file, relative to the project root. */
  file: string;
  /** What the role had on staff, so a rehire puts it back exactly where it was. */
  archetype?: string;
  agent?: string;
  position?: number;
  name?: string;
  level?: Level;
  reportsTo?: string;
  look?: Look;
  loads?: Loads;
  /** v3: the people who reported to them when they were fired, so a rehire brings them back. */
  reports?: string[];
}

export interface Studio {
  version: 1;
  name: string;
  /** Domain blueprint id, or "custom" for studios Worklings did not generate. */
  domain: string;
  rigor: Rigor;
  /** v3: present once a company's org has an office of its own. */
  office?: StudioOffice;
  departments: StudioDepartment[];
  roles: StudioRole[];
  rules: StudioRule[];
  gates: StudioGate[];
  skills: StudioSkill[];
  fired: FiredRole[];
  generator?: { tool: string; version: string };
}

export type ParseResult = { ok: true; studio: Studio } | { ok: false; errors: string[] };

export const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The models a role can run on: Claude Code's aliases, or `inherit` for the session's own model. */
export const ROLE_MODELS = ['inherit', 'sonnet', 'opus', 'haiku'] as const;
export type RoleModel = (typeof ROLE_MODELS)[number];

/** A person's first name: letters with spaces, hyphens, apostrophes or dots between, up to 40 characters. */
export const PERSON_NAME = /^\p{L}[\p{L}\p{M}' .-]{0,39}$/u;

/**
 * The first word in `text` that starts with "@" ("@~/.aws/credentials"), or null. Claude Code reads such a word in
 * CLAUDE.md as a file to import into every session, so the names, titles, areas and descriptions that end up there
 * can't hold one. An "@" inside a word, as in an email address, doesn't start one.
 */
export function importWord(text: string): string | null {
  return /(?<![\p{L}\p{M}\p{N}])@\S+/u.exec(text)?.[0] ?? null;
}

/** Why `text` is refused for holding a word that starts with "@", without the field's name; null when it holds none. */
export function importProblem(text: string): string | null {
  const word = importWord(text);
  if (word === null) return null;
  return `can't hold a word that starts with "@" (${JSON.stringify(word.length > 40 ? `${word.slice(0, 40)}…` : word)}), which Claude Code can take for a file to load`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Checks a look from studio.yaml, a proposal or an office change. Only the known keys are kept; errors name the field.
 */
export function checkLook(raw: unknown, where: string, errors: string[]): Look | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) {
    errors.push(`${where}: expected a mapping with body, color, hair, skin or prop`);
    return undefined;
  }
  const look: Look = {};
  if (raw.body !== undefined) {
    if (oneOf(LOOK_BODIES, raw.body)) look.body = raw.body;
    else errors.push(`${where}.body: expected one of ${LOOK_BODIES.join(', ')}, got ${JSON.stringify(raw.body)}`);
  }
  for (const key of ['color', 'hair'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v === 'string' && HEX_COLOUR.test(v)) look[key] = v.toLowerCase();
    else errors.push(`${where}.${key}: expected a colour like #3e5b4e, got ${JSON.stringify(v)}`);
  }
  if (raw.skin !== undefined) {
    if (Number.isInteger(raw.skin) && (raw.skin as number) >= 0 && (raw.skin as number) < SKIN_TONES) look.skin = raw.skin as number;
    else errors.push(`${where}.skin: expected a whole number from 0 to ${SKIN_TONES - 1}, got ${JSON.stringify(raw.skin)}`);
  }
  if (raw.prop !== undefined) {
    if (oneOf(LOOK_PROPS, raw.prop)) look.prop = raw.prop;
    else errors.push(`${where}.prop: expected one of ${LOOK_PROPS.join(', ')}, got ${JSON.stringify(raw.prop)}`);
  }
  return look;
}

/** Checks a theme name; `undefined` stays undefined. */
export function checkTheme(raw: unknown, where: string, errors: string[]): Theme | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (oneOf(THEMES, raw)) return raw;
  errors.push(`${where}: expected one of ${THEMES.join(', ')}, got ${JSON.stringify(raw)}`);
  return undefined;
}

/** Parses and validates studio.yaml text. Errors name the exact field, so a hand edit is easy to fix. */
export function parseStudio(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { ok: false, errors: [`studio.yaml is not valid YAML: ${(error as Error).message}`] };
  }
  return validateStudio(raw);
}

export function validateStudio(raw: unknown): ParseResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['studio.yaml must be a mapping with version, name, departments and roles'] };

  const str = (o: Obj, key: string, where: string, fallback?: string): string => {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (fallback !== undefined && v === undefined) return fallback;
    errors.push(`${where}.${key}: expected text, got ${v === undefined ? 'nothing' : JSON.stringify(v)}`);
    return fallback ?? '';
  };
  const list = (key: string): Obj[] => {
    const v = raw[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      errors.push(`${key}: expected a list`);
      return [];
    }
    return v.filter((item, i) => {
      if (isObj(item)) return true;
      errors.push(`${key}[${i}]: expected a mapping`);
      return false;
    }) as Obj[];
  };

  /** The studio's, the rooms' and the people's names and titles reach CLAUDE.md's block, where "@path" loads a file. */
  const noImport = (value: string, where: string) => {
    const problem = importProblem(value);
    if (problem) errors.push(`${where}: ${problem}`);
  };

  if (raw.version !== 1) errors.push(`version: expected 1, got ${JSON.stringify(raw.version)}`);
  const name = str(raw, 'name', 'studio');
  noImport(name, 'studio.name');
  const domain = str(raw, 'domain', 'studio', 'custom');
  const rigorRaw = raw.rigor ?? 'lean';
  const rigor: Rigor = (RIGOR_LEVELS as readonly unknown[]).includes(rigorRaw) ? (rigorRaw as Rigor) : 'lean';
  if (rigor !== rigorRaw) errors.push(`rigor: expected one of ${RIGOR_LEVELS.join(', ')}, got ${JSON.stringify(rigorRaw)}`);

  const departments: StudioDepartment[] = list('departments').map((d, i) => {
    const id = str(d, 'id', `departments[${i}]`);
    const styleRaw = d.style ?? id;
    const style = typeof styleRaw === 'string' && isBaseDepartment(styleRaw) ? styleRaw : 'engineering';
    if (d.style !== undefined && style !== d.style) {
      errors.push(`departments[${i}].style: "${String(d.style)}" is not a base department (${Object.keys(BASE_DEPARTMENT_INFO).join(', ')})`);
    }
    const fallbackName = isBaseDepartment(id) ? BASE_DEPARTMENT_INFO[id].name : id;
    const department: StudioDepartment = { id, name: str(d, 'name', `departments[${i}]`, fallbackName), style };
    noImport(department.name, `departments[${i}].name`);
    const theme = checkTheme(d.theme, `departments[${i}].theme`, errors);
    if (theme) department.theme = theme;
    return department;
  });
  if (departments.length === 0) errors.push('departments: a studio needs at least one department');
  const deptIds = new Set<string>();
  departments.forEach((d, i) => {
    if (deptIds.has(d.id)) errors.push(`departments[${i}].id: "${d.id}" is listed twice`);
    deptIds.add(d.id);
  });
  const knownDept = (value: string, where: string) => {
    if (value && !deptIds.has(value)) errors.push(`${where}: unknown department "${value}" (known: ${[...deptIds].join(', ') || 'none'})`);
  };
  const checkId = (value: string, where: string) => {
    if (value && !ROLE_ID.test(value)) errors.push(`${where}: "${value}" must be lowercase letters, digits and hyphens`);
  };

  /** The v3 fields a role (or a fired role, to put back on rehire) carries: name, level, manager and look. */
  const orgFields = (r: Obj, where: string, role: Pick<StudioRole, 'name' | 'level' | 'reportsTo' | 'look' | 'loads'>) => {
    if (r.name !== undefined) {
      if (typeof r.name === 'string' && PERSON_NAME.test(r.name.trim())) role.name = r.name.trim();
      else errors.push(`${where}.name: expected a first name of letters, up to 40 characters, got ${JSON.stringify(r.name)}`);
    }
    if (r.level !== undefined) {
      if (oneOf(LEVELS, r.level)) role.level = r.level;
      else errors.push(`${where}.level: expected one of ${LEVELS.join(', ')}, got ${JSON.stringify(r.level)}`);
    }
    if (r.reportsTo !== undefined) {
      if (typeof r.reportsTo === 'string' && ROLE_ID.test(r.reportsTo)) role.reportsTo = r.reportsTo;
      else errors.push(`${where}.reportsTo: expected a role id, got ${JSON.stringify(r.reportsTo)}`);
    }
    const look = checkLook(r.look, `${where}.look`, errors);
    if (look) role.look = look;
    const loads = checkLoads(r.loads, `${where}.loads`, errors);
    if (loads) role.loads = loads;
  };

  const roleIds = new Set<string>();
  const roles: StudioRole[] = list('roles').map((r, i) => {
    const where = `roles[${i}]`;
    const id = str(r, 'id', where);
    checkId(id, `${where}.id`);
    if (roleIds.has(id)) errors.push(`${where}.id: "${id}" is listed twice`);
    roleIds.add(id);
    const department = str(r, 'department', where);
    knownDept(department, `${where}.department`);
    const role: StudioRole = { id, department, title: str(r, 'title', where, titleFromId(id)) };
    noImport(role.title, `${where}.title`);
    orgFields(r, where, role);
    if (typeof r.archetype === 'string') role.archetype = r.archetype;
    if (typeof r.agent === 'string' && r.agent.trim()) role.agent = r.agent.trim();
    return role;
  });
  errors.push(...orgErrors(roles));

  const rules: StudioRule[] = list('rules').map((r, i) => {
    const where = `rules[${i}]`;
    const id = str(r, 'id', where);
    checkId(id, `${where}.id`);
    const department = str(r, 'department', where);
    knownDept(department, `${where}.department`);
    return { id, department, title: str(r, 'title', where, titleFromId(id)) };
  });

  const gates: StudioGate[] = list('gates').map((g, i) => {
    const where = `gates[${i}]`;
    const id = str(g, 'id', where);
    checkId(id, `${where}.id`);
    const from = str(g, 'from', where);
    const to = str(g, 'to', where);
    knownDept(from, `${where}.from`);
    knownDept(to, `${where}.to`);
    return { id, title: str(g, 'title', where, titleFromId(id)), from, to };
  });

  const skills: StudioSkill[] = list('skills').map((s, i) => {
    const id = str(s, 'id', `skills[${i}]`);
    checkId(id, `skills[${i}].id`);
    return { id, title: str(s, 'title', `skills[${i}]`, titleFromId(id)) };
  });

  const fired: FiredRole[] = list('fired').map((f, i) => {
    const where = `fired[${i}]`;
    const id = str(f, 'id', where);
    checkId(id, `${where}.id`);
    if (roleIds.has(id)) errors.push(`${where}.id: "${id}" is both on staff and fired`);
    const role: FiredRole = { id, department: str(f, 'department', where), title: str(f, 'title', where, titleFromId(id)), file: str(f, 'file', where) };
    // A rehire puts the title back on staff.
    noImport(role.title, `${where}.title`);
    if (typeof f.archetype === 'string') role.archetype = f.archetype;
    if (typeof f.agent === 'string' && f.agent.trim()) role.agent = f.agent.trim();
    if (Number.isInteger(f.position) && (f.position as number) >= 0) role.position = f.position as number;
    orgFields(f, where, role);
    if (f.reports !== undefined) {
      if (Array.isArray(f.reports) && f.reports.every((r) => typeof r === 'string' && ROLE_ID.test(r))) role.reports = [...(f.reports as string[])];
      else errors.push(`${where}.reports: expected a list of role ids, got ${JSON.stringify(f.reports)}`);
    }
    return role;
  });

  const office = officeFrom(raw.office, deptIds, errors);

  if (errors.length > 0) return { ok: false, errors };
  const studio: Studio = { version: 1, name, domain, rigor, ...(office ? { office } : {}), departments, roles, rules, gates, skills, fired };
  if (isObj(raw.generator) && typeof raw.generator.tool === 'string' && typeof raw.generator.version === 'string') {
    studio.generator = { tool: raw.generator.tool, version: raw.generator.version };
  }
  return { ok: true, studio };
}

/** A company's org must be a tree under one CEO: managers who exist, are managers, and no loops. */
function orgErrors(roles: readonly StudioRole[]): string[] {
  const errors: string[] = [];
  const byId = new Map(roles.map((r) => [r.id, r]));
  const ceos = roles.filter((r) => r.level === 'ceo');
  if (ceos.length > 1) errors.push(`roles: only one role can be the CEO, found ${ceos.map((r) => r.id).join(', ')}`);
  roles.forEach((r, i) => {
    if (r.reportsTo === undefined) return;
    const where = `roles[${i}].reportsTo`;
    const manager = byId.get(r.reportsTo);
    if (r.level === 'ceo') errors.push(`${where}: the CEO reports to the stakeholder, so it has no manager`);
    else if (r.reportsTo === r.id) errors.push(`${where}: "${r.id}" can't report to itself`);
    else if (!manager) errors.push(`${where}: "${r.reportsTo}" is not on staff`);
    else if (manager.level !== 'ceo' && manager.level !== 'head' && manager.level !== 'lead') {
      errors.push(`${where}: "${r.reportsTo}" is a worker; people report to the CEO, a head or a team lead`);
    }
  });
  const loop = firstLoop(roles, byId);
  if (loop) errors.push(`roles: ${loop.join(' → ')} report to each other in a loop`);
  return errors;
}

/**
 * Walks up from each role; the first id met twice closes a loop. The CEO is the top even when it names a manager, and
 * reporting to oneself: both are reported on their own.
 */
function firstLoop(roles: readonly StudioRole[], byId: ReadonlyMap<string, StudioRole>): string[] | null {
  for (const start of roles) {
    const path: string[] = [];
    let at: StudioRole | undefined = start;
    while (at) {
      const i = path.indexOf(at.id);
      if (i >= 0) return [...path.slice(i), at.id];
      path.push(at.id);
      at = at.level === 'ceo' || at.reportsTo === undefined || at.reportsTo === at.id ? undefined : byId.get(at.reportsTo);
    }
  }
  return null;
}

/** The office section: a theme, the rooms that aren't a department's, and decor by id. */
function officeFrom(raw: unknown, deptIds: ReadonlySet<string>, errors: string[]): StudioOffice | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) {
    errors.push('office: expected a mapping with theme, rooms and decor');
    return undefined;
  }
  const theme = checkTheme(raw.theme, 'office.theme', errors) ?? 'office';
  const rooms: OfficeRoom[] = [];
  if (raw.rooms !== undefined && raw.rooms !== null && !Array.isArray(raw.rooms)) errors.push('office.rooms: expected a list');
  const roomIds = new Set<string>();
  (Array.isArray(raw.rooms) ? raw.rooms : []).forEach((r: unknown, i: number) => {
    const where = `office.rooms[${i}]`;
    if (!isObj(r)) {
      errors.push(`${where}: expected a mapping with id, title and kind`);
      return;
    }
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!ROLE_ID.test(id)) errors.push(`${where}.id: expected lowercase letters, digits and hyphens, got ${JSON.stringify(r.id)}`);
    else if (roomIds.has(id) || deptIds.has(id)) errors.push(`${where}.id: "${id}" is already a room`);
    roomIds.add(id);
    if (!oneOf(ROOM_KINDS, r.kind)) {
      errors.push(`${where}.kind: expected one of ${ROOM_KINDS.join(', ')}, got ${JSON.stringify(r.kind)}`);
      return;
    }
    const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : titleFromId(id);
    if (title.length > 40) errors.push(`${where}.title: up to 40 characters, got ${title.length}`);
    const room: OfficeRoom = { id, title, kind: r.kind };
    const roomTheme = checkTheme(r.theme, `${where}.theme`, errors);
    if (roomTheme) room.theme = roomTheme;
    rooms.push(room);
  });
  if (raw.decor !== undefined && raw.decor !== null && !Array.isArray(raw.decor)) errors.push('office.decor: expected a list');
  const decorRaw: unknown[] = Array.isArray(raw.decor) ? raw.decor : [];
  if (decorRaw.length > MAX_DECOR) errors.push(`office.decor: up to ${MAX_DECOR} pieces, got ${decorRaw.length}`);
  const decor = decorRaw.slice(0, MAX_DECOR).filter((d, i): d is string => {
    if (typeof d === 'string' && ROLE_ID.test(d)) return true;
    errors.push(`office.decor[${i}]: expected an id like "plants", got ${JSON.stringify(d)}`);
    return false;
  });
  return { theme, rooms, decor };
}

export function serializeStudio(studio: Studio): string {
  const header = '# Worklings studio manifest: which room each Claude Code role, rule and gate lives in.\n';
  return header + stringify(studio, { lineWidth: 0 });
}

const ACRONYMS = new Set(['qa', 'ux', 'ui', 'ai', 'ml', 'seo', 'api', 'cli', 'sre', 'ci', 'cd', 'vfx', 'llm', 'ue', 'gdd', 'adr', 'mv3', 'sdk', 'ios', 'gpu']);

/**
 * First words of titles that keep their capital inside a sentence: languages and nationalities ("German copywriter")
 * and platforms ("Shopify expert"). Mixed-case words ("DevOps", "WordPress") and acronyms keep theirs anyway.
 */
const PROPER_FIRST_WORDS = new Set([
  'Afrikaans', 'Albanian', 'American', 'Arabic', 'Armenian', 'Asian', 'Australian', 'Austrian', 'Belgian', 'Bengali',
  'Brazilian', 'British', 'Bulgarian', 'Canadian', 'Cantonese', 'Catalan', 'Chinese', 'Croatian', 'Czech', 'Danish',
  'Dutch', 'English', 'Estonian', 'European', 'Filipino', 'Finnish', 'French', 'Georgian', 'German', 'Greek', 'Hebrew',
  'Hindi', 'Hungarian', 'Icelandic', 'Indian', 'Indonesian', 'Irish', 'Italian', 'Japanese', 'Korean', 'Latin',
  'Latvian', 'Lithuanian', 'Malay', 'Mandarin', 'Mexican', 'Norwegian', 'Persian', 'Polish', 'Portuguese', 'Romanian',
  'Romansh', 'Russian', 'Scottish', 'Serbian', 'Slovak', 'Slovenian', 'Spanish', 'Swahili', 'Swedish', 'Swiss',
  'Taiwanese', 'Tamil', 'Thai', 'Turkish', 'Ukrainian', 'Urdu', 'Vietnamese', 'Welsh',
  'Amazon', 'Android', 'Apple', 'Azure', 'Cloudflare', 'Django', 'Etsy', 'Excel', 'Expo', 'Figma', 'Firebase',
  'Flutter', 'Framer', 'Godot', 'Google', 'Instagram', 'Java', 'Kotlin', 'Laravel', 'Linux', 'Magento', 'Microsoft',
  'Notion', 'Python', 'Rails', 'React', 'Roblox', 'Ruby', 'Rust', 'Salesforce', 'Shopify', 'Steam', 'Stripe',
  'Supabase', 'Swift', 'Tailwind', 'Twitch', 'Unity', 'Unreal', 'Vercel', 'Vue', 'Webflow', 'Windows', 'Xbox', 'Zapier',
]);

/**
 * A title inside a sentence: "Mobile engineer" -> "mobile engineer", but "QA engineer", "DevOps engineer" and "German
 * copywriter" keep their first word as it is.
 */
export function inSentence(title: string): string {
  const first = title.split(' ')[0] ?? '';
  const keeps = (first.length > 1 && first === first.toUpperCase()) || /\p{Lu}/u.test(first.slice(1)) || PROPER_FIRST_WORDS.has(first);
  return keeps ? title : title.charAt(0).toLowerCase() + title.slice(1);
}

/** A role id made from any agent name: "Frontend Developer" -> "frontend-developer". Empty when nothing is left. */
export function slugId(name: string, max = 63): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

/** "mobile-engineer" -> "Mobile engineer", "qa-lead" -> "QA lead". */
export function titleFromId(id: string): string {
  const words = id.split('-').filter(Boolean).map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  if (words.length === 0) return id;
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
