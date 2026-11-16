// Reads a project's studio from disk: studio.yaml when there is one, otherwise inferred from .claude/agents.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseFrontmatter, stringList } from '../core/frontmatter.ts';
import { inferStudio } from '../core/infer.ts';
import type { StudioSource } from '../core/snapshot.ts';
import { parseStudio, type Studio, type StudioRole } from '../core/studio.ts';
import { isLink } from '../safe-fs.ts';

export type { StudioSource };

export interface ProjectStudio {
  studio: Studio | null;
  source: StudioSource;
  /** Problems with studio.yaml, shown in the office instead of failing. */
  errors: string[];
}

export const MANIFEST = '.claude/studio.yaml';

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

/**
 * Markdown files under `dir`, recursively. Folders reached through a link aren't walked: a link can point at the whole
 * disk, or back at itself. (Writes refuse links altogether; see safe-fs.ts.)
 */
function markdownFiles(dir: string): string[] {
  if (!existsSync(dir) || isLink(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(path));
    else if (entry.name.endsWith('.md') && isFile(path)) out.push(path);
  }
  return out.sort();
}

/** Skill folders in .claude/skills that hold a SKILL.md. */
function skillDirs(root: string): string[] {
  const dir = join(root, '.claude', 'skills');
  if (!existsSync(dir) || isLink(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isFile(join(dir, name, 'SKILL.md')))
    .sort();
}

export interface AgentDefinition {
  id: string;
  description: string;
  model: string;
  tools: string[];
  file: string;
}

/** The agent file (relative to the root) that a studio role stands for, matched on the name Claude Code reads. */
export function agentFileOf(root: string, role: StudioRole): string | undefined {
  return readAgents(root).find((a) => a.id === (role.agent ?? role.id))?.file;
}

/** Every subagent in .claude/agents (recursively, as Claude Code reads them). */
export function readAgents(root: string): AgentDefinition[] {
  const seen = new Set<string>();
  const agents: AgentDefinition[] = [];
  for (const file of markdownFiles(join(root, '.claude', 'agents'))) {
    const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
    const id = typeof data.name === 'string' ? data.name.trim() : basename(file, '.md');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    agents.push({
      id,
      description: typeof data.description === 'string' ? data.description.replace(/\s+/g, ' ').trim() : '',
      model: typeof data.model === 'string' ? data.model : 'inherit',
      tools: stringList(data.tools),
      file: relative(root, file).replaceAll('\\', '/'),
    });
  }
  return agents;
}

export function readRules(root: string): { id: string; description: string; paths: string[]; body: string }[] {
  const dir = join(root, '.claude', 'rules');
  return markdownFiles(dir).map((file) => {
    const doc = parseFrontmatter(readFileSync(file, 'utf8'));
    const firstLine = doc.body.split('\n').find((l) => l.trim()) ?? '';
    return { id: basename(file, '.md'), description: firstLine.replace(/^#+\s*/, ''), paths: stringList(doc.data.paths), body: doc.body.trim() };
  });
}

export function readSkills(root: string): { id: string; description: string }[] {
  return skillDirs(root).map((id) => {
    const { data } = parseFrontmatter(readFileSync(join(root, '.claude', 'skills', id, 'SKILL.md'), 'utf8'));
    return { id, description: typeof data.description === 'string' ? data.description.replace(/\s+/g, ' ').trim() : '' };
  });
}

export function loadProjectStudio(root: string): ProjectStudio {
  const manifest = join(root, MANIFEST);
  if (existsSync(manifest)) {
    const result = parseStudio(readFileSync(manifest, 'utf8'));
    if (result.ok) return { studio: result.studio, source: 'manifest', errors: [] };
    return { studio: inferred(root), source: 'inferred', errors: result.errors };
  }
  const studio = inferred(root);
  return { studio, source: studio ? 'inferred' : 'none', errors: [] };
}

function inferred(root: string): Studio | null {
  const agents = readAgents(root);
  if (agents.length === 0) return null;
  return inferStudio({ name: basename(root), agents, rules: readRules(root), skills: readSkills(root) }).studio;
}

/** A cheap fingerprint of the files the studio comes from, so the office can reload when they change. */
export function studioFingerprint(root: string): string {
  const parts: string[] = [];
  const add = (path: string) => {
    if (existsSync(path)) parts.push(`${path}:${statSync(path).mtimeMs}`);
  };
  add(join(root, MANIFEST));
  for (const dir of ['agents', 'rules']) for (const file of markdownFiles(join(root, '.claude', dir))) add(file);
  for (const d of skillDirs(root)) add(join(root, '.claude', 'skills', d, 'SKILL.md'));
  return parts.join('|');
}
