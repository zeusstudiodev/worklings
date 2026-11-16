// A desk runs as its person's agent file (--agent), and a `tools:` line there hides every tool it doesn't name, the
// org tools included: a code reviewer limited to Read, Grep, Glob and Bash couldn't report, message or post a status
// (benchmark run 1, 12 Nov 2026). Every agent file a company writes keeps them.
import { describe, expect, it, vi } from 'vitest';
import { detect } from '../src/composer/detect.ts';
import { loadLibrary } from '../src/composer/library.ts';
import { parseFrontmatter } from '../src/core/frontmatter.ts';
import { orgAgentFile, roleFromLibrary, withOrgTools } from '../src/org/agents.ts';
import { orgOps } from '../src/org/index.ts';
import { tempDir } from './library-kit.ts';
import { CAFE_PROMPT, cafeProposal, read } from './org-kit.ts';

// Each case writes a whole studio (agents, rules, skills, the org) to disk and reads it back: about 2 s alone, much
// slower while the full suite saturates the machine.
vi.setConfig({ testTimeout: 120_000 });

const library = loadLibrary();
const ops = orgOps(library);

const toolsOf = (text: string): string[] | null => {
  const tools = parseFrontmatter(text).data.tools;
  return typeof tools === 'string' ? tools.split(',').map((t) => t.trim()) : null;
};

/** The café org with the three library roles that limit their tools, under the head of engineering. */
function reviewedCafe(): string {
  const root = tempDir();
  ops.found(root, CAFE_PROMPT);
  const raw = cafeProposal();
  for (const [id, name] of [['code-reviewer', 'Rae'], ['security-reviewer', 'Sol'], ['privacy-officer', 'Mo']] as const) {
    raw.people.push({ id, name, title: library.roles.get(id)?.title ?? id, level: 'worker', room: 'engineering', reportsTo: 'head-of-engineering', model: 'sonnet', owns: `The ${id.replace('-', ' ')}'s checks`, library: id });
  }
  const checked = ops.check(raw, { enforceSize: false });
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  const written = ops.write(root, checked.proposal);
  if (!written.ok) throw new Error(written.message);
  return root;
}

describe('the org tools in a company’s agent files', () => {
  it('keeps them for every library role that limits its tools, and leaves the others to inherit every tool', () => {
    const limited = [...library.roles.values()].filter((r) => r.tools !== null).map((r) => r.id);
    expect(limited).toEqual(expect.arrayContaining(['code-reviewer', 'security-reviewer', 'privacy-officer']));
    const ctx = { name: 'Café Lumen', idea: '', detection: detect(tempDir(), library), rules: [], stacks: [] };
    for (const role of library.roles.values()) {
      const seat = { id: role.id, title: role.title, style: role.department, model: role.model };
      const text = orgAgentFile(roleFromLibrary(role, seat), [{ id: role.id, title: role.title, archetype: role.id }], library, ctx, 'Noor, CEO,');
      expect(toolsOf(text), role.id).toEqual(role.tools === null ? null : [...role.tools, 'mcp__org']);
    }
  });

  it('writes the reviewers of an accepted proposal with their own tools and the org tools', () => {
    const root = reviewedCafe();
    expect(toolsOf(read(root, '.claude/agents/code-reviewer.md'))).toEqual(['Read', 'Grep', 'Glob', 'Bash', 'mcp__org']);
    for (const id of ['security-reviewer', 'privacy-officer']) expect(toolsOf(read(root, `.claude/agents/${id}.md`)), id).toContain('mcp__org');
    // A role without a tools line inherits every tool, the org tools among them, and gets none written for it.
    expect(toolsOf(read(root, '.claude/agents/backend-engineer.md'))).toBeNull();
  });

  it('hires a reviewer after the start with the org tools', () => {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    const checked = ops.check(cafeProposal(), { preset: 'thorough' });
    if (!checked.ok) throw new Error(checked.errors.join('\n'));
    ops.write(root, checked.proposal);
    expect(ops.hire(root, { role: 'code-reviewer', room: 'engineering', reportsTo: 'head-of-engineering', name: 'Rae', title: null }).ok).toBe(true);
    expect(toolsOf(read(root, '.claude/agents/code-reviewer.md'))).toEqual(['Read', 'Grep', 'Glob', 'Bash', 'mcp__org']);
  });

  it('adds the server once, and keeps a list that names it already as it is', () => {
    expect(withOrgTools(null)).toBeNull();
    expect(withOrgTools(['Read'])).toEqual(['Read', 'mcp__org']);
    expect(withOrgTools(['Read', 'mcp__org'])).toEqual(['Read', 'mcp__org']);
    expect(withOrgTools(['Read', 'mcp__org__*'])).toEqual(['Read', 'mcp__org__*']);
    // One org tool by name would still hide the rest, so the server goes in beside it.
    expect(withOrgTools(['Read', 'mcp__org__report'])).toEqual(['Read', 'mcp__org__report', 'mcp__org']);
  });
});
