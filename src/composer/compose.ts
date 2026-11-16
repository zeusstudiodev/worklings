// Turns a domain blueprint, a rigor tier and what was detected in the project into the files of a studio.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { type BaseDepartment, BASE_DEPARTMENT_INFO } from '../core/departments.ts';
import { DEPARTMENT_ORDER } from '../core/infer.ts';
import { type FiredRole, RIGOR_LEVELS, type Rigor, serializeStudio, type Studio } from '../core/studio.ts';
import type { Detection } from './detect.ts';
import type { Library, LibraryRole, LibraryRule } from './library.ts';

export interface ComposeOptions {
  library: Library;
  domain: string;
  rigor: Rigor;
  detection: Detection;
  /** Display name; defaults to the detected name. */
  name?: string;
  /** One or two sentences on what the project is, from the person or the /worklings:new skill. */
  idea?: string;
  /** Stacks the person intends to use, for a project with no code yet. */
  stacks?: string[];
  /** Extra roles to hire and roles to leave out, on top of the tier. */
  add?: string[];
  remove?: string[];
  /** Roles fired from this project's studio before: they stay fired (and archived) unless named in `add`. */
  fired?: FiredRole[];
  version: string;
}

export type FileKind = 'agent' | 'rule' | 'skill' | 'skill-file' | 'manifest' | 'claude-md';

export interface PlannedFile {
  /** Relative to the project root, with forward slashes. */
  path: string;
  content: string;
  kind: FileKind;
}

export interface Plan {
  studio: Studio;
  files: PlannedFile[];
  /** The text that goes between the markers in CLAUDE.md. */
  claudeBlock: string;
  notes: string[];
}

export const CLAUDE_START = '<!-- worklings:start -->';
export const CLAUDE_END = '<!-- worklings:end -->';
/** The studio block's markers in CLAUDE.md files written while Worklings was called Headcount; still replaced. */
export const LEGACY_CLAUDE_START = '<!-- headcount:start -->';
export const LEGACY_CLAUDE_END = '<!-- headcount:end -->';

const upTo = (rigor: Rigor) => RIGOR_LEVELS.slice(0, RIGOR_LEVELS.indexOf(rigor) + 1);

export function compose(o: ComposeOptions): Plan {
  const { library, detection } = o;
  const domain = library.domains.get(o.domain);
  if (!domain) throw new Error(`Unknown domain "${o.domain}". Known: ${[...library.domains.keys()].sort().join(', ')}`);
  const notes: string[] = [];

  const roleIds = new Set(upTo(o.rigor).flatMap((t) => domain.roles[t]));
  for (const id of o.add ?? []) {
    if (!library.roles.has(id)) throw new Error(`Unknown role "${id}"`);
    roleIds.add(id);
  }
  for (const id of o.remove ?? []) roleIds.delete(id);
  const added = new Set(o.add ?? []);
  const fired = (o.fired ?? []).filter((f) => !added.has(f.id));
  const leftOut = fired.filter((f) => roleIds.delete(f.id)).map((f) => f.id);
  if (leftOut.length > 0) notes.push(`Left out ${leftOut.join(', ')}: fired earlier. \`worklings rehire <role>\` brings one back.`);
  const roles = [...roleIds].map((id) => library.roles.get(id)).filter((r): r is LibraryRole => Boolean(r));

  const stacks = new Set([...detection.stacks, ...(o.stacks ?? [])]);
  const fresh = detection.isEmpty && (o.stacks ?? []).length === 0;
  const rules: { rule: LibraryRule; paths: string[] }[] = [];
  for (const id of domain.rules) {
    const rule = library.rules.get(id);
    if (!rule) continue;
    if (!fresh && !rule.stacks.some((s) => stacks.has(s))) continue;
    const paths = fresh ? rule.paths : rule.paths.filter((p) => appliesHere(p, detection.folders));
    if (paths.length === 0) {
      notes.push(`Skipped rule ${id}: none of its folders exist yet (${rule.paths.map((p) => p.split('/')[0]).join(', ')}).`);
      continue;
    }
    rules.push({ rule, paths });
  }
  if (fresh) notes.push('No code yet, so every rule this domain suggests was kept; re-run once the stack exists to trim them.');

  const skills = domain.skills.map((id) => library.skills.get(id)).filter((s) => s !== undefined);
  const gates = upTo(o.rigor).flatMap((t) => domain.gates[t]).map((id) => library.skills.get(id)).filter((s) => s !== undefined);

  const used = new Set<BaseDepartment>();
  for (const r of roles) used.add(r.department);
  for (const { rule } of rules) used.add(rule.department);
  for (const g of gates) {
    if (g.from) used.add(g.from);
    if (g.to) used.add(g.to);
  }
  const departments = DEPARTMENT_ORDER.filter((d) => used.has(d));

  const name = o.name?.trim() || detection.name;
  const studio: Studio = {
    version: 1,
    name,
    domain: domain.id,
    rigor: o.rigor,
    departments: departments.map((d) => ({ id: d, name: BASE_DEPARTMENT_INFO[d].name, style: d })),
    roles: roles.map((r) => ({ id: r.id, department: r.department, title: r.title, archetype: r.id })),
    rules: rules.map(({ rule }) => ({ id: rule.id, department: rule.department, title: rule.title })),
    gates: gates.map((g) => ({ id: g.id, title: titleOfSkill(g.id), from: g.from ?? 'quality', to: g.to ?? 'ops' })),
    skills: skills.map((s) => ({ id: s.id, title: titleOfSkill(s.id) })),
    fired,
    generator: { tool: 'worklings', version: o.version },
  };

  const files: PlannedFile[] = [];
  const hired = new Set(roles.map((r) => r.id));
  const context = { name, idea: o.idea?.trim() ?? '', detection, rules: rules.map(({ rule }) => rule.id), stacks: o.stacks ?? [] };
  for (const role of roles) files.push({ path: `.claude/agents/${role.id}.md`, content: agentFile(role, hired, library, context), kind: 'agent' });
  for (const { rule, paths } of rules) files.push({ path: `.claude/rules/${rule.id}.md`, content: ruleFile(rule, paths), kind: 'rule' });
  const team = teamList(roles);
  for (const skill of [...skills, ...gates]) {
    const frontmatter = stringify(skill.frontmatter, { lineWidth: 0 }).trimEnd();
    files.push({ path: `.claude/skills/${skill.id}/SKILL.md`, content: `---\n${frontmatter}\n---\n${skill.body.replaceAll('{{team}}', team)}\n`, kind: 'skill' });
    for (const extra of skill.extraFiles) {
      files.push({ path: `.claude/skills/${skill.id}/${extra}`, content: readFileSync(join(library.root, 'skills', skill.id, extra), 'utf8'), kind: 'skill-file' });
    }
  }
  files.push({ path: '.claude/studio.yaml', content: serializeStudio(studio), kind: 'manifest' });

  const claudeBlock = claudeSection(studio, domain.title, roles, skills.map((s) => s.id), gates.map((g) => g.id));
  return { studio, files, claudeBlock, notes };
}

/** A glob applies when it is a root-level pattern, starts with a wildcard folder, or its top folder exists. */
function appliesHere(glob: string, folders: string[]): boolean {
  const top = glob.split('/')[0] ?? '';
  return !glob.includes('/') || /[*?{[]/.test(top) || folders.includes(top);
}

function titleOfSkill(id: string): string {
  const words = id.split('-');
  const text = words.join(' ').replace(/\ba11y\b/, 'accessibility').replace(/\bperf\b/, 'performance');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface AgentContext {
  name: string;
  idea: string;
  detection: Detection;
  rules: string[];
  stacks: string[];
}

/** One role as a Claude Code subagent file, with hand-offs to the roles in `hired` and a section about the project. */
export function agentFile(role: LibraryRole, hired: Set<string>, library: Library, ctx: AgentContext): string {
  const fm: Record<string, unknown> = { name: role.id, description: role.description, model: role.model };
  if (role.tools) fm.tools = role.tools.join(', ');
  fm.color = BASE_DEPARTMENT_INFO[role.department].agentColor;

  const handoffs = Object.entries(role.handoffs).filter(([id]) => hired.has(id));
  const handOff = [
    ...handoffs.map(([id, when]) => `- To \`${id}\` (${library.roles.get(id)?.title ?? id}) when ${when.replace(/\.$/, '')}.`),
    '- Everything else goes back to the lead (the main session) with what you did, how you checked it and what is left.',
  ];

  const d = ctx.detection;
  const lines = [`- **Project:** ${ctx.name}`];
  if (ctx.idea) lines.push(`- **What it is:** ${ctx.idea}`);
  const stack = d.frameworks.length > 0 ? d.frameworks.join(', ') : ctx.stacks.join(', ');
  if (stack) lines.push(`- **Stack:** ${stack}${d.packageManager ? ` (${d.packageManager})` : ''}`);
  const commands = Object.entries(d.commands).map(([k, v]) => `${k} \`${v}\``);
  if (commands.length > 0) lines.push(`- **Commands:** ${commands.join(' · ')}`);
  const folders = d.folders.filter((f) => f !== '.claude').slice(0, 10);
  if (folders.length > 0) lines.push(`- **Where things are:** ${folders.map((f) => `\`${f}/\``).join(', ')}`);
  if (ctx.rules.length > 0) lines.push(`- **Rules for your paths:** ${ctx.rules.map((r) => `\`${r}\``).join(', ')} in \`.claude/rules/\``);
  const others = [...hired].filter((id) => id !== role.id);
  lines.push(`- **Your studio:** ${others.length > 0 ? others.map((id) => `\`${id}\``).join(', ') : 'just you'} and the lead. See the Studio section of CLAUDE.md.`);

  return `---\n${stringify(fm, { lineWidth: 0 }).trimEnd()}\n---\n${role.body}\n\n## Hand off\n${handOff.join('\n')}\n\n## This project\n${lines.join('\n')}\n`;
}

function ruleFile(rule: LibraryRule, paths: string[]): string {
  return `---\n${stringify({ paths }, { lineWidth: 0 }).trimEnd()}\n---\n# ${rule.title}\n\n${rule.body}\n`;
}

function teamList(roles: LibraryRole[]): string {
  if (roles.length === 0) return '- (no roles hired: the lead does everything)';
  return roles
    .map((r) => `- \`${r.id}\` (${r.title}, ${BASE_DEPARTMENT_INFO[r.department].name}): ${firstSentence(r.description)}`)
    .join('\n');
}

function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  return (m?.[1] ?? text).trim();
}

/** `text` as a code span, fenced with more backticks than it holds. */
function codeSpan(text: string): string {
  const fence = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Text from the library as one cell of CLAUDE.md's table. A --library folder is untrusted, and Claude Code reads the
 * block in every session: the cell stays on one line, can't close the block (its markers are HTML comments) or the cell
 * (a pipe), and sets every word holding an "@" in a code span, since outside one "@path" makes Claude Code load a file.
 */
export function claudeCell(text: string): string {
  return text.replace(/\s+/g, ' ').replaceAll('<!--', '&lt;!--').trim().replace(/\S*@\S*/g, codeSpan).replaceAll('|', '\\|');
}

function claudeSection(studio: Studio, domainTitle: string, roles: LibraryRole[], skills: string[], gates: string[]): string {
  const rows = roles.map((r) => `| ${BASE_DEPARTMENT_INFO[r.department].name} | ${claudeCell(codeSpan(r.id))} | ${claudeCell(firstSentence(r.description))} |`);
  const gateLine =
    gates.length === 0
      ? ''
      : studio.rigor === 'lean'
        ? `Gates (run when the change is risky or about to ship): ${gates.map((g) => `\`/${g}\``).join(', ')}.`
        : `Gates (required before a change ships, in this order): ${gates.map((g) => `\`/${g}\``).join(', ')}.`;
  return [
    '## Studio',
    '',
    `This project is staffed by a Worklings studio for a ${domainTitle.toLowerCase()} (${studio.rigor}). The manifest is`,
    '`.claude/studio.yaml`; `/worklings:office` (or `worklings` in a terminal) opens an office that shows the studio at work',
    'and what each role costs.',
    '',
    'You are the lead: you talk to the person, plan, and do small work yourself. Delegate to a role when the work is',
    'substantial, needs an independent view or a fresh context, or can run in parallel. Every delegation costs tokens,',
    "so don't delegate one-line changes, and give each role a brief with the goal, the files and what done means.",
    '',
    '| Room | Role | Use it for |',
    '|---|---|---|',
    ...rows,
    '',
    skills.length > 0 ? `Workflows: ${skills.map((s) => `\`/${s}\``).join(', ')}.` : '',
    gateLine,
    'Rules for specific paths are in `.claude/rules/` and load when matching files are read.',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n')
    .trim();
}

/** Inserts or replaces the studio block in CLAUDE.md text, leaving everything else as it was. */
export function withClaudeBlock(existing: string | null, block: string): string {
  const section = `${CLAUDE_START}\n${block}\n${CLAUDE_END}`;
  if (existing === null || existing.trim() === '') return `${section}\n`;
  const replaced = replaceMarkedBlock(existing, section, [CLAUDE_START, CLAUDE_END], [LEGACY_CLAUDE_START, LEGACY_CLAUDE_END]);
  return replaced ?? `${existing.trimEnd()}\n\n${section}\n`;
}

type Markers = readonly [start: string, end: string];

/**
 * Puts `section` in place of the block between `markers`, or else of the block between `legacy` ones, and returns null
 * when the text has neither. A legacy block left beside a current one goes with the blank space before it, so the text
 * keeps one block.
 */
export function replaceMarkedBlock(text: string, section: string, markers: Markers, legacy: Markers): string | null {
  const current = blockIn(text, markers);
  const at = current ?? blockIn(text, legacy);
  if (!at) return null;
  const next = text.slice(0, at.start) + section + text.slice(at.end);
  const stale = current && blockIn(next, legacy);
  // A legacy pair wrapped around the new block (a hand edit) stays: dropping it would drop that block too.
  if (!stale || (stale.start < at.start && stale.end > at.start + section.length)) return next;
  const before = next.slice(0, stale.start).trimEnd();
  return before ? before + next.slice(stale.end) : next.slice(stale.end).trimStart();
}

/** Where the first block between the markers sits in `text`, markers included. */
function blockIn(text: string, [open, close]: Markers): { start: number; end: number } | null {
  const start = text.indexOf(open);
  const end = start === -1 ? -1 : text.indexOf(close, start + open.length);
  return end === -1 ? null : { start, end: end + close.length };
}
