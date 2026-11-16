// Changes made from the office: hire, fire, rehire, move a role, change its model, edit a rule. Every change is a
// plain file edit inside the project's .claude folder, and firing is reversible (the agent file is archived).
// In a company (v3: a studio with a CEO) the same changes keep the org: a hire takes a manager, a name and a title, a
// fire hands the person's reports to their manager, a rehire puts them back under their old manager or the CEO, and a
// move can change their manager. Each change is planned on the studio first and checked before any file moves.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { agentFile } from '../composer/compose.ts';
import { detect } from '../composer/detect.ts';
import { type Library, type LibraryRole, MODELS, type RoleModel } from '../composer/library.ts';
import { introduce, OrgRefusal, peopleOf } from '../core/company.ts';
import { BASE_DEPARTMENT_INFO, isBaseDepartment } from '../core/departments.ts';
import { andList, checkWrittenRole, isDeviceName, managerProblem, PROPOSAL_LIMITS } from '../core/org.ts';
import type { ReshapeResult } from '../core/snapshot.ts';
import { type FiredRole, inSentence, LEVELS, type Level, parseStudio, PERSON_NAME, ROLE_ID, serializeStudio, type Studio, type StudioRole, titleFromId } from '../core/studio.ts';
import { capital } from '../core/words.ts';
import { backTo, lintNewRole, orgAgentFile, roleFromLibrary, roleFromProposal, staffOf } from '../org/agents.ts';
import { plainPath } from '../safe-fs.ts';
import { agentFileOf, loadProjectStudio, MANIFEST } from './project.ts';

/**
 * A change refused with a sentence saying why. It is an OrgRefusal, so the org tools and the office show it as it is;
 * `code` is "invalid" unless the role or room is unknown ("unknown") or the change clashes with what is there ("conflict").
 */
export class ReshapeError extends OrgRefusal {
  constructor(message: string, code = 'invalid') {
    super(code, message);
  }
}

export const FIRED_DIR = '.claude/studio/fired';
const MAX_RULE = 20_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const given = (v: unknown) => v !== undefined && v !== null;

function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ROLE_ID.test(value)) throw new ReshapeError(`${what} must be a lowercase id like "qa-engineer".`);
  return value;
}

/** Resolves a path inside the project's .claude folder, refusing anything outside it or reached through a link. */
export function inClaude(root: string, path: string): string {
  const base = resolve(root, '.claude');
  const target = resolve(root, path);
  if (target !== base && !target.startsWith(base + sep)) throw new ReshapeError('That path is outside the .claude folder.');
  return plainPath(root, target, ReshapeError);
}

/** Where fire puts a role's file (with -2, -3... when the name is taken). Rehire moves only these back, whatever
 * studio.yaml says. */
const archivedAs = (roleId: string, file: string) =>
  file === `${FIRED_DIR}/${roleId}.md` || (file.startsWith(`${FIRED_DIR}/${roleId}-`) && /^\d+\.md$/.test(file.slice(FIRED_DIR.length + roleId.length + 2)));

const rel = (root: string, path: string) => relative(root, path).replaceAll('\\', '/');

function setModel(markdown: string, model: RoleModel): string {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(markdown);
  if (!match) throw new ReshapeError('The agent file has no frontmatter to change.');
  const [whole, open = '', body = '', close = ''] = match;
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => /^model\s*:/.test(l));
  if (at >= 0) lines[at] = `model: ${model}`;
  else lines.splice(Math.max(1, lines.findIndex((l) => /^description\s*:/.test(l)) + 1), 0, `model: ${model}`);
  return open + lines.join('\n') + close + markdown.slice(whole.length);
}

function replaceBody(markdown: string, body: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/.exec(markdown);
  return `${match ? match[0] : ''}${body.trimEnd()}\n`;
}

export interface ReshapeContext {
  root: string;
  library: Library;
}

/**
 * The studio a change starts from. A broken studio.yaml falls back to a studio guessed from the agent files; saving
 * that guess would wipe the user's rooms and assignments, so nothing changes until the file is fixed. A studio
 * inferred from loose agent files (or none at all) gets a studio.yaml on its first change, so moves and fires stick.
 */
export function studioForChange(root: string): Studio {
  const project = loadProjectStudio(root);
  if (project.errors.length > 0) {
    const more = project.errors.length > 1 ? ` (and ${project.errors.length - 1} more)` : '';
    throw new ReshapeError(`${MANIFEST} has a problem, so nothing was changed: ${project.errors[0]}${more}. Fix the file and try again.`, 'conflict');
  }
  return project.studio ?? { version: 1, name: detect(root).name, domain: 'custom', rigor: 'lean', departments: [], roles: [], rules: [], gates: [], skills: [], fired: [] };
}

/**
 * studio.yaml's text for a studio, refused before anything is written when it wouldn't read back. It is written as it
 * reads back (fields in the reader's order), so the same studio always gives the same file.
 */
export function manifestText(studio: Studio): string {
  const back = parseStudio(serializeStudio(studio));
  if (!back.ok) throw new ReshapeError(`That change would leave ${MANIFEST} with a mistake, so nothing was changed: ${back.errors[0] ?? ''}.`);
  return serializeStudio(back.studio);
}

export function writeManifest(root: string, text: string): string {
  writeFileSync(inClaude(root, MANIFEST), text);
  return MANIFEST;
}

/** A change worked out on the studio: what to say, and the file moves that make it real once the studio checks out. */
export interface ReshapePlan {
  message: string;
  /** Run in order after the studio is checked; each returns the files it changed. */
  files: (() => string[])[];
  /** Whether studio.yaml changes. */
  save: boolean;
}

/** What a change did, with the studio before and after it, for callers that keep more in step than the files. */
export interface Reshaped {
  result: ReshapeResult;
  before: Studio;
  after: Studio;
}

export function reshape(ctx: ReshapeContext, action: unknown): ReshapeResult {
  return applyReshape(ctx, action).result;
}

export function applyReshape(ctx: ReshapeContext, action: unknown): Reshaped {
  if (!isObj(action) || typeof action.action !== 'string') throw new ReshapeError('Send an action such as {"action": "fire", "role": "qa-engineer"}.');
  const studio = studioForChange(ctx.root);
  const before = structuredClone(studio);
  const plan = planChange(ctx, studio, action);
  const text = plan.save ? manifestText(studio) : '';
  const changed = plan.files.flatMap((run) => run());
  if (plan.save) changed.push(writeManifest(ctx.root, text));
  return { result: { ok: true, message: plan.message, changed }, before, after: studio };
}

/** Works out one change on `studio` (which it changes) without touching a file. */
export function planChange(ctx: ReshapeContext, studio: Studio, action: Obj): ReshapePlan {
  const plan = ((): ReshapePlan => {
    switch (action.action) {
      case 'hire':
        return planHire(ctx, studio, action);
      case 'fire':
        return planFire(ctx, studio, action);
      case 'rehire':
        return planRehire(ctx, studio, action);
      case 'move':
        return planMove(studio, action);
      case 'model':
        return planModel(ctx, studio, action);
      case 'rule':
        return planRule(ctx, studio, action);
      default:
        throw new ReshapeError(`Unknown action "${String(action.action)}".`);
    }
  })();
  // Fields in the order studio.yaml is read back, so a change and its undo write the same file.
  studio.roles = studio.roles.map(ordered);
  return plan;
}

function ordered(r: StudioRole): StudioRole {
  const out: StudioRole = { id: r.id, department: r.department, title: r.title };
  if (r.name !== undefined) out.name = r.name;
  if (r.level !== undefined) out.level = r.level;
  if (r.reportsTo !== undefined) out.reportsTo = r.reportsTo;
  if (r.look !== undefined) out.look = r.look;
  if (r.loads !== undefined) out.loads = r.loads;
  if (r.archetype !== undefined) out.archetype = r.archetype;
  if (r.agent !== undefined) out.agent = r.agent;
  return out;
}

const staffRole = (studio: Studio, roleId: string) => {
  const r = studio.roles.find((x) => x.id === roleId);
  if (!r) throw new ReshapeError(`"${roleId}" is not on the staff.`, 'unknown');
  return r;
};

function fileOf(root: string, r: StudioRole): string {
  const file = agentFileOf(root, r);
  if (!file) throw new ReshapeError(`No agent file for "${r.id}" in .claude/agents.`, 'conflict');
  return inClaude(root, file);
}

/** The company's CEO other than `except`: only a role with level ceo counts, so studios without an org don't change. */
export const ceoOf = (studio: Studio, except?: string): string | undefined => studio.roles.find((r) => r.level === 'ceo' && r.id !== except)?.id;

/** The head of a room, when the org lets a person of `level` report to them (a head hired into it goes to the CEO). */
function headOf(studio: Studio, roleId: string, room: string, level: Level): string | undefined {
  const head = peopleOf(studio).find((p) => p.id !== roleId && p.room === room && p.level === 'head');
  return head && managerProblem(level, head.id, head.level) === null ? head.id : undefined;
}

const levelIn = (studio: Studio, roleId: string): Level => peopleOf(studio).find((p) => p.id === roleId)?.level ?? 'worker';
/** "Sam", or "the frontend engineer" for someone without a name. */
const personName = (studio: Studio, roleId: string): string => {
  const p = peopleOf(studio).find((x) => x.id === roleId);
  return !p ? roleId : p.name === p.title ? `the ${inSentence(p.title)}` : p.name;
};

/**
 * The manager named for a role: on staff and someone who may manage them. Levels only point up, so this keeps the
 * tree free of loops; a studio edited by hand into one is caught when the change is checked before writing.
 */
function managerFor(studio: Studio, roleId: string, level: Level, value: unknown): string {
  const managerId = id(value, 'reportsTo');
  if (managerId === roleId) throw new ReshapeError(`"${roleId}" can't report to itself.`);
  const manager = peopleOf(studio).find((p) => p.id === managerId);
  if (!manager) {
    const gone = studio.fired.some((f) => f.id === managerId);
    throw new ReshapeError(gone ? `"${managerId}" was fired, so nobody can report to them; rehire them first.` : `"${managerId}" is not on the staff.`, 'unknown');
  }
  const problem = managerProblem(level, managerId, manager.level);
  if (problem) throw new ReshapeError(`${capital(problem)}.`);
  return managerId;
}

/** The org fields a hire may carry (title, name, level, manager); those left out stay as they are. */
function applyPlace(studio: Studio, role: StudioRole, action: Obj): void {
  if (given(action.title)) {
    const title = typeof action.title === 'string' ? action.title.replace(/[\s\p{Cc}]+/gu, ' ').trim() : '';
    if (!title || title.length > PROPOSAL_LIMITS.title) throw new ReshapeError(`A title is text of up to ${PROPOSAL_LIMITS.title} characters, like "German copywriter".`);
    role.title = title;
  }
  if (given(action.name)) {
    if (typeof action.name !== 'string' || !PERSON_NAME.test(action.name.trim())) throw new ReshapeError('A name is a first name of letters, up to 40 characters, like "Lena".');
    role.name = action.name.trim();
  }
  if (given(action.level)) {
    if (typeof action.level !== 'string' || !(LEVELS as readonly string[]).includes(action.level)) throw new ReshapeError(`A level is one of ${LEVELS.join(', ')}.`);
    role.level = action.level as Level;
  }
  const level = role.level ?? 'worker';
  if (given(action.reportsTo)) role.reportsTo = managerFor(studio, role.id, level, action.reportsTo);
  else if (role.reportsTo === undefined && level !== 'ceo') {
    // In a company everyone but the CEO has a manager: the head of the room they join, or else the CEO.
    const ceo = ceoOf(studio, role.id);
    if (ceo) role.reportsTo = headOf(studio, role.id, role.department, level) ?? ceo;
  }
}

const placeGiven = (action: Obj) => ['department', 'reportsTo', 'name', 'title', 'level'].some((key) => given(action[key]));

const contextOf = (ctx: ReshapeContext, studio: Studio) => ({ name: studio.name, idea: '', detection: detect(ctx.root, ctx.library), rules: studio.rules.map((r) => r.id), stacks: [] });
const roomStyle = (studio: Studio, role: StudioRole, fallback: LibraryRole['department']) => studio.departments.find((d) => d.id === role.department)?.style ?? fallback;
/** Whom a new person's work goes back to in a company: their manager, as the agent file's closing hand-off says. */
const backFor = (studio: Studio, role: StudioRole) => {
  const people = peopleOf(studio);
  const person = people.find((p) => p.id === role.id);
  return person ? backTo(people, person) : null;
};

function agentFor(ctx: ReshapeContext, studio: Studio, role: StudioRole, archetype: LibraryRole): string {
  // A studio without an org gets the file the composer writes; a company's hand-offs point at its people.
  if (!ceoOf(studio)) return agentFile({ ...archetype, id: role.id }, new Set(studio.roles.map((r) => r.id)), ctx.library, contextOf(ctx, studio));
  const seat = { id: role.id, title: role.title, style: roomStyle(studio, role, archetype.department), model: archetype.model };
  return orgAgentFile(roleFromLibrary(archetype, seat), staffOf(studio), ctx.library, contextOf(ctx, studio), backFor(studio, role));
}

/** The agent file of a role written for the company, held to the library's bar by the library linter. */
function writtenAgentFor(ctx: ReshapeContext, studio: Studio, role: StudioRole, raw: unknown): string {
  const seat = { id: role.id, title: role.title, style: roomStyle(studio, role, 'engineering'), model: 'inherit' as const };
  const checked = checkWrittenRole(raw, 'written', { id: role.id, title: role.title, department: seat.style, model: seat.model }, { lintRole: (draft) => lintNewRole(ctx.library, draft) });
  if (!checked.ok) throw new ReshapeError(`That role isn't written to the library's bar, so nobody was hired: ${checked.errors.join('; ')}.`);
  return orgAgentFile(roleFromProposal(checked.role, seat), staffOf(studio), ctx.library, contextOf(ctx, studio), backFor(studio, role));
}

/**
 * A hire: a library role (`role`), a second person holding one under their own `id`, or, with `written`, a role written
 * for the company whose id is `role`. A title, name, level and manager can come with it (applyPlace).
 */
function planHire(ctx: ReshapeContext, studio: Studio, action: Obj): ReshapePlan {
  const { root, library } = ctx;
  const roleId = id(action.role, 'role');
  const writes = given(action.written);
  const personId = given(action.id) ? id(action.id, 'id') : roleId;
  const archetype = writes ? undefined : library.roles.get(roleId);
  if (writes) {
    if (personId !== roleId) throw new ReshapeError('A role written for the company takes its id from role; leave id out.');
    if (library.roles.has(roleId)) throw new ReshapeError(`"${roleId}" is a library role; hire it from the library, or give the role written for the company another id.`, 'conflict');
  } else if (!archetype) {
    throw new ReshapeError(`The library has no "${roleId}" role.`, 'unknown');
  } else if (personId !== roleId && library.roles.has(personId)) {
    throw new ReshapeError(`"${personId}" is another library role's id; give the second ${inSentence(archetype.title)} an id of their own, like "${roleId}-2".`, 'conflict');
  }
  if (isDeviceName(personId)) throw new ReshapeError(`"${personId}" is a name Windows keeps for devices; pick another id.`);
  if (studio.roles.some((r) => r.id === personId)) {
    // In a company a second person can hold the role under an id of their own (the CLI has no way to give one).
    const second = archetype && personId === roleId && ceoOf(studio) ? `; a second one needs an id of their own, like "${roleId}-2"` : '';
    throw new ReshapeError(`"${personId}" already works here${second}.`, 'conflict');
  }
  let department = action.department === undefined || action.department === null ? undefined : id(action.department, 'department');
  if (department && !studio.departments.some((d) => d.id === department)) throw new ReshapeError(`There is no "${department}" room.`, 'unknown');

  const fired = studio.fired.find((f) => f.id === personId);
  if (fired) {
    // Hiring a fired role brings its old file back; a place given with the hire puts it there.
    if (writes || (fired.archetype ?? fired.id) !== roleId) throw new ReshapeError(`"${personId}" is in the fired list; rehire them, or give the new hire another id.`, 'conflict');
    const back = planRehire(ctx, studio, { action: 'rehire', role: personId });
    if (!placeGiven(action)) return back;
    const role = staffRole(studio, personId);
    if (department) role.department = department;
    applyPlace(studio, role, action);
    return back;
  }

  if (!department) {
    const style = archetype?.department ?? 'engineering';
    department = studio.departments.find((d) => d.style === style)?.id ?? style;
    if (!studio.departments.some((d) => d.id === department) && isBaseDepartment(department)) {
      studio.departments.push({ id: department, name: BASE_DEPARTMENT_INFO[department].name, style: department });
    }
  }
  const target = inClaude(root, `.claude/agents/${personId}.md`);
  if (existsSync(target)) throw new ReshapeError(`.claude/agents/${personId}.md already exists; add it to studio.yaml instead of hiring.`, 'conflict');
  const role: StudioRole = { id: personId, department, title: archetype?.title ?? titleFromId(personId) };
  applyPlace(studio, role, action);
  if (archetype) role.archetype = roleId;
  studio.roles.push(role);
  const content = archetype ? agentFor(ctx, studio, role, archetype) : writtenAgentFor(ctx, studio, role, action.written);
  return {
    message: `Hired the ${inSentence(role.title)}. Claude Code can delegate to it from the next session.`,
    files: [
      () => {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        return [rel(root, target)];
      },
    ],
    save: true,
  };
}

function planFire(ctx: ReshapeContext, studio: Studio, action: Obj): ReshapePlan {
  const { root } = ctx;
  const r = staffRole(studio, id(action.role, 'role'));
  if (r.level === 'ceo') throw new ReshapeError("The CEO can't be fired: the company needs one, and it answers to the stakeholder.");
  const from = fileOf(root, r);
  let to = inClaude(root, `${FIRED_DIR}/${r.id}.md`);
  for (let n = 2; existsSync(to); n++) to = inClaude(root, `${FIRED_DIR}/${r.id}-${n}.md`);
  const fired: FiredRole = { id: r.id, department: r.department, title: r.title, file: rel(root, to), position: studio.roles.indexOf(r) };
  if (r.archetype) fired.archetype = r.archetype;
  if (r.agent) fired.agent = r.agent;
  // Their place in the org, so a rehire puts them back.
  if (r.name) fired.name = r.name;
  if (r.level) fired.level = r.level;
  if (r.reportsTo) fired.reportsTo = r.reportsTo;
  if (r.look) fired.look = r.look;
  if (r.loads) fired.loads = r.loads;
  const reports = studio.roles.filter((x) => x.reportsTo === r.id).map((x) => x.id);
  if (reports.length > 0) fired.reports = reports;
  // The people who reported to them report to their manager now, or to the CEO, until a rehire brings them back.
  const heir = r.reportsTo ?? ceoOf(studio, r.id);
  for (const x of studio.roles) {
    if (x.reportsTo !== r.id) continue;
    if (heir) x.reportsTo = heir;
    else delete x.reportsTo;
  }
  studio.roles = studio.roles.filter((x) => x.id !== r.id);
  studio.fired.push(fired);
  return {
    message: `Fired the ${inSentence(r.title)}. Its file is in ${FIRED_DIR}/ if you want it back.`,
    files: [
      () => {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        return [rel(root, from), rel(root, to)];
      },
    ],
    save: true,
  };
}

/** Back under the manager they had while that manager is on staff and may manage them, or else under the CEO. */
function formerManager(studio: Studio, roleId: string, f: FiredRole): string | undefined {
  const level = f.level ?? 'worker';
  if (level === 'ceo') return undefined;
  const old = f.reportsTo ? peopleOf(studio).find((p) => p.id === f.reportsTo) : undefined;
  if (old && managerProblem(level, old.id, old.level) === null) return old.id;
  return ceoOf(studio, roleId);
}

function planRehire(ctx: ReshapeContext, studio: Studio, action: Obj): ReshapePlan {
  const { root } = ctx;
  const roleId = id(action.role, 'role');
  const f = studio.fired.find((x) => x.id === roleId);
  if (!f) throw new ReshapeError(`"${roleId}" isn't in the fired list.`, 'unknown');
  if (!archivedAs(roleId, f.file)) throw new ReshapeError(`${f.file} isn't where Worklings archives ${roleId}; move the file back by hand.`);
  const from = inClaude(root, f.file);
  const to = inClaude(root, `.claude/agents/${roleId}.md`);
  if (!existsSync(from)) throw new ReshapeError(`The archived file ${f.file} is gone; hire the role again instead.`, 'conflict');
  if (existsSync(to)) throw new ReshapeError(`.claude/agents/${roleId}.md already exists.`, 'conflict');
  studio.fired = studio.fired.filter((x) => x.id !== roleId);
  const department = studio.departments.some((d) => d.id === f.department) ? f.department : (studio.departments[0]?.id ?? f.department);
  const back: StudioRole = { id: roleId, department, title: f.title };
  if (f.name) back.name = f.name;
  if (f.level) back.level = f.level;
  const manager = formerManager(studio, roleId, f);
  if (manager) back.reportsTo = manager;
  if (f.look) back.look = f.look;
  if (f.loads) back.loads = f.loads;
  if (f.archetype) back.archetype = f.archetype;
  if (f.agent) back.agent = f.agent;
  // Back at its old place in the list, so it gets its old desk.
  studio.roles.splice(Math.min(f.position ?? studio.roles.length, studio.roles.length), 0, back);
  // The people fire handed up come back under them, unless they were moved since.
  const heir = f.reportsTo ?? ceoOf(studio, roleId);
  const returned: string[] = [];
  const stayed: string[] = [];
  for (const reportId of f.reports ?? []) {
    const x = studio.roles.find((r) => r.id === reportId);
    if (!x) continue;
    if (x.reportsTo === heir && managerProblem(levelIn(studio, x.id), roleId, back.level ?? 'worker') === null) {
      x.reportsTo = roleId;
      returned.push(x.id);
    } else {
      stayed.push(x.id);
    }
  }
  const named = (ids: string[]) => capital(andList(ids.map((x) => personName(studio, x))));
  const parts = [`Rehired the ${inSentence(f.title)}.`];
  if (returned.length > 0) parts.push(`${named(returned)} ${returned.length === 1 ? 'reports' : 'report'} to them again.`);
  if (stayed.length > 0) parts.push(`${named(stayed)} ${stayed.length === 1 ? 'was moved since and stays' : 'were moved since and stay'} where they are.`);
  return {
    message: parts.join(' '),
    files: [
      () => {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        return [rel(root, from), rel(root, to)];
      },
    ],
    save: true,
  };
}

function planMove(studio: Studio, action: Obj): ReshapePlan {
  const r = staffRole(studio, id(action.role, 'role'));
  const department = id(action.department, 'department');
  const room = studio.departments.find((d) => d.id === department);
  if (!room) throw new ReshapeError(`There is no "${department}" room.`, 'unknown');
  const manager = given(action.reportsTo) ? managerFor(studio, r.id, levelIn(studio, r.id), action.reportsTo) : r.reportsTo;
  const moves = r.department !== department;
  const newManager = manager !== r.reportsTo;
  if (!moves && !newManager) return { message: `The ${inSentence(r.title)} already sits in ${room.name}.`, files: [], save: false };
  r.department = department;
  if (manager) r.reportsTo = manager;
  const boss = newManager ? peopleOf(studio).find((p) => p.id === manager) : undefined;
  const parts = [moves ? `Moved the ${inSentence(r.title)} to ${room.name}.` : '', boss ? `The ${inSentence(r.title)} reports to ${introduce(boss)} now.` : ''];
  return { message: parts.filter(Boolean).join(' '), files: [], save: true };
}

function planModel(ctx: ReshapeContext, studio: Studio, action: Obj): ReshapePlan {
  const r = staffRole(studio, id(action.role, 'role'));
  const model = action.model;
  if (typeof model !== 'string' || !(MODELS as readonly string[]).includes(model)) throw new ReshapeError(`Model must be one of ${MODELS.join(', ')}.`);
  const path = fileOf(ctx.root, r);
  const next = setModel(readFileSync(path, 'utf8'), model as RoleModel);
  const label = model === 'inherit' ? 'the same model as the session' : model.charAt(0).toUpperCase() + model.slice(1);
  return {
    message: `The ${inSentence(r.title)} now runs on ${label}.`,
    files: [
      () => {
        writeFileSync(path, next);
        return [rel(ctx.root, path)];
      },
    ],
    save: false,
  };
}

function planRule(ctx: ReshapeContext, studio: Studio, action: Obj): ReshapePlan {
  const ruleId = id(action.rule, 'rule');
  if (!studio.rules.some((r) => r.id === ruleId)) throw new ReshapeError(`"${ruleId}" is not one of the studio's rules.`, 'unknown');
  if (typeof action.body !== 'string' || !action.body.trim()) throw new ReshapeError('A rule needs some text.');
  if (action.body.length > MAX_RULE) throw new ReshapeError(`Keep a rule under ${MAX_RULE} characters; it loads into every matching session.`);
  const path = inClaude(ctx.root, `.claude/rules/${ruleId}.md`);
  if (!existsSync(path)) throw new ReshapeError(`.claude/rules/${ruleId}.md doesn't exist.`, 'conflict');
  const next = replaceBody(readFileSync(path, 'utf8'), action.body);
  return {
    message: `Saved the ${ruleId} rule.`,
    files: [
      () => {
        writeFileSync(path, next);
        return [rel(ctx.root, path)];
      },
    ],
    save: false,
  };
}
