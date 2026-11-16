// Loads and lints the curated library (library/README.md documents the format).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { type BaseDepartment, isBaseDepartment } from '../core/departments.ts';
import { parseFrontmatter, stringList } from '../core/frontmatter.ts';
import { RIGOR_LEVELS, type Rigor, ROLE_ID, ROLE_MODELS, type RoleModel } from '../core/studio.ts';
import { LIBRARY_DIR } from '../paths.ts';

/** The library shipped with the package (see paths.ts for where that is in each layout). */
export const DEFAULT_LIBRARY = LIBRARY_DIR;

export const MODELS = ROLE_MODELS;
export type { RoleModel };

/**
 * The only frontmatter a library skill may carry into a project. Keys like `hooks` or `allowed-tools` would run
 * commands or skip permission prompts in every project the skill is written into, so a library can't set them.
 */
const SKILL_KEYS = new Set(['name', 'description', 'argument-hint']);

/** The frontmatter block with a skill's kind and rooms, removed when the skill is written into a project. */
const META_KEY = 'worklings';
/** The same block in libraries written while Worklings was called Headcount: read when META_KEY is absent. */
const LEGACY_META_KEY = 'headcount';

const KNOWN_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'Grep', 'Glob', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'NotebookEdit',
  'TodoWrite', 'Agent', 'Skill', 'AskUserQuestion', 'ToolSearch', 'LSP',
]);

export interface LibraryRole {
  id: string;
  title: string;
  department: BaseDepartment;
  description: string;
  model: RoleModel;
  tools: string[] | null;
  tags: string[];
  handoffs: Record<string, string>;
  body: string;
}

export interface LibraryRule {
  id: string;
  title: string;
  department: BaseDepartment;
  stacks: string[];
  paths: string[];
  body: string;
}

export interface LibrarySkill {
  id: string;
  description: string;
  kind: 'workflow' | 'gate';
  department: BaseDepartment;
  from: BaseDepartment | null;
  to: BaseDepartment | null;
  /** SKILL.md with the `worklings` block removed from its frontmatter, slots still in place. */
  body: string;
  frontmatter: Record<string, unknown>;
  /** Other files in the skill folder (references), copied as they are. */
  extraFiles: string[];
}

export interface DomainDetect {
  /** 0 general (API, CLI), 1 web, 2 specific (mobile, game, AI app...): a higher priority wins whenever both match. */
  priority: number;
  dependencies: string[];
  files: string[];
  python: string[];
  json: Record<string, string>;
}

export interface LibraryDomain {
  id: string;
  title: string;
  summary: string;
  detect: DomainDetect | null;
  roles: Record<Rigor, string[]>;
  rules: string[];
  skills: string[];
  gates: Record<Rigor, string[]>;
}

export interface Library {
  root: string;
  roles: Map<string, LibraryRole>;
  rules: Map<string, LibraryRule>;
  skills: Map<string, LibrarySkill>;
  domains: Map<string, LibraryDomain>;
  /** Problems found while loading; lintLibrary adds cross-reference checks. */
  problems: string[];
}

const ROLE_SECTIONS = ['## Mission', '## You own', '## How you work', '## Done means'];
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function files(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
}

export function loadLibrary(root: string = DEFAULT_LIBRARY): Library {
  const lib: Library = { root, roles: new Map(), rules: new Map(), skills: new Map(), domains: new Map(), problems: [] };
  const problem = (where: string, message: string) => lib.problems.push(`${where}: ${message}`);

  for (const file of files(join(root, 'roles'), '.md')) {
    const where = `roles/${file}`;
    const id = file.slice(0, -3);
    const doc = parseFrontmatter(readFileSync(join(root, 'roles', file), 'utf8'));
    if (doc.warning) problem(where, doc.warning);
    const d = doc.data;
    if (text(d.name) !== id) problem(where, `name must be "${id}" (the file name), got "${text(d.name)}"`);
    if (!ROLE_ID.test(id)) problem(where, 'file name must be lowercase letters, digits and hyphens');
    const department = text(d.department);
    if (!isBaseDepartment(department)) problem(where, `department "${department}" is not a base department`);
    const description = text(d.description).replace(/\s+/g, ' ');
    if (description.length < 60 || description.length > 400) problem(where, `description must be 60-400 characters, got ${description.length}`);
    const model = (text(d.model) || 'inherit') as RoleModel;
    if (!MODELS.includes(model)) problem(where, `model must be one of ${MODELS.join(', ')}`);
    const tools = d.tools === undefined ? null : stringList(d.tools);
    for (const t of tools ?? []) if (!KNOWN_TOOLS.has(t) && !t.startsWith('mcp__')) problem(where, `unknown tool "${t}"`);
    const handoffs: Record<string, string> = {};
    if (d.handoffs !== undefined) {
      if (typeof d.handoffs !== 'object' || d.handoffs === null || Array.isArray(d.handoffs)) problem(where, 'handoffs must be a mapping of role id to "when" text');
      else for (const [k, v] of Object.entries(d.handoffs)) handoffs[k] = text(v);
    }
    lib.roles.set(id, {
      id,
      title: text(d.title) || id,
      department: (isBaseDepartment(department) ? department : 'engineering'),
      description,
      model: MODELS.includes(model) ? model : 'inherit',
      tools,
      tags: stringList(d.tags),
      handoffs,
      body: doc.body.trim(),
    });
  }

  for (const file of files(join(root, 'rules'), '.md')) {
    const where = `rules/${file}`;
    const id = file.slice(0, -3);
    const doc = parseFrontmatter(readFileSync(join(root, 'rules', file), 'utf8'));
    if (doc.warning) problem(where, doc.warning);
    const d = doc.data;
    const department = text(d.department);
    if (!isBaseDepartment(department)) problem(where, `department "${department}" is not a base department`);
    lib.rules.set(id, {
      id,
      title: text(d.title) || id,
      department: isBaseDepartment(department) ? department : 'engineering',
      stacks: stringList(d.stacks),
      paths: stringList(d.paths),
      body: doc.body.trim(),
    });
  }

  const skillsDir = join(root, 'skills');
  const skillDirs = existsSync(skillsDir) ? readdirSync(skillsDir).filter((f) => statSync(join(skillsDir, f)).isDirectory()).sort() : [];
  for (const id of skillDirs) {
    const where = `skills/${id}/SKILL.md`;
    const path = join(skillsDir, id, 'SKILL.md');
    if (!existsSync(path)) {
      problem(`skills/${id}`, 'missing SKILL.md');
      continue;
    }
    const raw = readFileSync(path, 'utf8');
    const doc = parseFrontmatter(raw);
    if (doc.warning) problem(where, doc.warning);
    const d = { ...doc.data };
    const block = Object.hasOwn(d, META_KEY) ? d[META_KEY] : d[LEGACY_META_KEY];
    const meta = typeof block === 'object' && block !== null ? (block as Record<string, unknown>) : {};
    delete d[META_KEY];
    delete d[LEGACY_META_KEY];
    if (text(d.name) !== id) problem(where, `name must be "${id}" (the folder name), got "${text(d.name)}"`);
    const kind = text(meta.kind);
    if (kind !== 'workflow' && kind !== 'gate') problem(where, 'worklings.kind must be workflow or gate');
    const department = text(meta.department);
    if (!isBaseDepartment(department)) problem(where, `worklings.department "${department}" is not a base department`);
    const from = text(meta.from);
    const to = text(meta.to);
    for (const key of Object.keys(d)) {
      if (!SKILL_KEYS.has(key)) problem(where, `frontmatter "${key}" isn't allowed: a generated skill carries only ${[...SKILL_KEYS].join(', ')}`);
    }
    // Reference notes travel with a skill; scripts don't, since nothing here vets what they would run.
    const extras = readdirSync(join(skillsDir, id)).filter((f) => f !== 'SKILL.md').sort();
    for (const f of extras) if (!f.endsWith('.md')) problem(`skills/${id}/${f}`, 'only markdown files are copied with a skill');
    lib.skills.set(id, {
      id,
      description: text(d.description).replace(/\s+/g, ' '),
      kind: kind === 'gate' ? 'gate' : 'workflow',
      department: isBaseDepartment(department) ? department : 'direction',
      from: isBaseDepartment(from) ? from : null,
      to: isBaseDepartment(to) ? to : null,
      body: doc.body.trim(),
      frontmatter: Object.fromEntries(Object.entries(d).filter(([key]) => SKILL_KEYS.has(key))),
      extraFiles: extras.filter((f) => f.endsWith('.md') && statSync(join(skillsDir, id, f)).isFile()),
    });
  }

  for (const file of files(join(root, 'domains'), '.yaml')) {
    const where = `domains/${file}`;
    const id = file.slice(0, -5);
    let d: Record<string, unknown>;
    try {
      const parsed = parse(readFileSync(join(root, 'domains', file), 'utf8')) as unknown;
      d = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch (error) {
      problem(where, `not valid YAML: ${(error as Error).message.split('\n')[0]}`);
      continue;
    }
    if (text(d.id) !== id) problem(where, `id must be "${id}" (the file name)`);
    const tiers = (value: unknown, field: string): Record<Rigor, string[]> => {
      const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
      for (const k of Object.keys(o)) if (!(RIGOR_LEVELS as readonly string[]).includes(k)) problem(where, `${field}.${k} is not a rigor tier`);
      return { lean: stringList(o.lean), standard: stringList(o.standard), full: stringList(o.full) };
    };
    const det = typeof d.detect === 'object' && d.detect !== null ? (d.detect as Record<string, unknown>) : null;
    const json: Record<string, string> = {};
    if (det && typeof det.json === 'object' && det.json !== null) for (const [k, v] of Object.entries(det.json)) json[k] = text(v);
    lib.domains.set(id, {
      id,
      title: text(d.title) || id,
      summary: text(d.summary),
      detect: det
        ? { priority: typeof det.priority === 'number' ? det.priority : 0, dependencies: stringList(det.dependencies), files: stringList(det.files), python: stringList(det.python), json }
        : null,
      roles: tiers(d.roles, 'roles'),
      rules: stringList(d.rules),
      skills: stringList(d.skills),
      gates: tiers(d.gates, 'gates'),
    });
  }

  return lib;
}

/** Every problem in the library, loading and cross-references both. An empty list means the library is valid. */
export function lintLibrary(lib: Library): string[] {
  const problems = [...lib.problems];
  const problem = (where: string, message: string) => problems.push(`${where}: ${message}`);

  for (const role of lib.roles.values()) {
    const where = `roles/${role.id}.md`;
    let last = -1;
    for (const section of ROLE_SECTIONS) {
      const at = role.body.indexOf(`\n${section}\n`);
      if (at === -1) problem(where, `missing the "${section}" section`);
      else if (at < last) problem(where, `"${section}" is out of order (Mission, You own, How you work, Done means)`);
      else last = at;
    }
    for (const reserved of ['## Hand off', '## This project']) if (role.body.includes(reserved)) problem(where, `remove "${reserved}": the composer writes it`);
    if (role.body.includes('{{')) problem(where, 'roles take no {{slots}}; the composer appends project details itself');
    const lines = role.body.split('\n').length;
    if (lines < 25 || lines > 100) problem(where, `body should be 35-80 lines, got ${lines}`);
    for (const target of Object.keys(role.handoffs)) {
      if (target === role.id) problem(where, 'hands off to itself');
      else if (!lib.roles.has(target)) problem(where, `hands off to unknown role "${target}"`);
      if (!role.handoffs[target]) problem(where, `hand-off to "${target}" needs a "when" text`);
    }
  }

  for (const rule of lib.rules.values()) {
    const where = `rules/${rule.id}.md`;
    if (rule.stacks.length === 0) problem(where, 'stacks must list at least one stack');
    if (rule.paths.length === 0) problem(where, 'paths must list at least one glob');
    const bullets = rule.body.split('\n').filter((l) => /^\s*[-*] /.test(l)).length;
    if (bullets < 6 || bullets > 30) problem(where, `should have 6-30 bullet rules, got ${bullets}`);
  }

  for (const skill of lib.skills.values()) {
    const where = `skills/${skill.id}/SKILL.md`;
    if (skill.description.length < 60 || skill.description.length > 500) problem(where, `description must be 60-500 characters, got ${skill.description.length}`);
    if (skill.kind === 'gate') {
      if (!skill.id.endsWith('-gate')) problem(where, 'gate names end in "-gate"');
      if (!skill.from || !skill.to) problem(where, 'gates need worklings.from and worklings.to base departments');
    } else if (skill.id.endsWith('-gate')) {
      problem(where, 'only gates may end in "-gate"');
    }
    const slots = skill.body.match(/\{\{[^}]*\}\}/g) ?? [];
    for (const slot of slots) if (slot !== '{{team}}') problem(where, `unknown slot ${slot}; only {{team}} is filled in`);
    if (skill.body.length < 200) problem(where, 'body is too short to be useful');
  }

  for (const domain of lib.domains.values()) {
    const where = `domains/${domain.id}.yaml`;
    if (!domain.summary) problem(where, 'needs a summary');
    if (!domain.detect && domain.id !== 'generic') problem(where, 'needs detect signals (only generic may omit them)');
    if (domain.detect && ![0, 1, 2].includes(domain.detect.priority)) problem(where, 'detect.priority must be 0, 1 or 2');
    const lean = domain.roles.lean.length;
    if (lean < 3 || lean > 5) problem(where, `a lean team has 3-5 roles, got ${lean}`);
    const seen = new Set<string>();
    for (const tier of RIGOR_LEVELS) {
      for (const id of domain.roles[tier]) {
        if (!lib.roles.has(id)) problem(where, `roles.${tier}: unknown role "${id}"`);
        if (seen.has(id)) problem(where, `roles.${tier}: "${id}" is already in an earlier tier`);
        seen.add(id);
      }
      for (const id of domain.gates[tier]) {
        const skill = lib.skills.get(id);
        if (!skill) problem(where, `gates.${tier}: unknown gate "${id}"`);
        else if (skill.kind !== 'gate') problem(where, `gates.${tier}: "${id}" is a workflow, not a gate`);
      }
    }
    for (const id of domain.rules) if (!lib.rules.has(id)) problem(where, `unknown rule "${id}"`);
    for (const id of domain.skills) {
      const skill = lib.skills.get(id);
      if (!skill) problem(where, `unknown skill "${id}"`);
      else if (skill.kind !== 'workflow') problem(where, `skills: "${id}" is a gate; list it under gates`);
    }
  }
  return problems;
}
