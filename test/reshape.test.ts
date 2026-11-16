import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { compose } from '../src/composer/compose.ts';
import { detect } from '../src/composer/detect.ts';
import { loadLibrary } from '../src/composer/library.ts';
import { writePlan } from '../src/composer/write.ts';
import { OrgRefusal } from '../src/core/company.ts';
import { parseFrontmatter } from '../src/core/frontmatter.ts';
import { parseStudio, serializeStudio, type Studio } from '../src/core/studio.ts';
import { orgOps } from '../src/org/index.ts';
import { reshape, ReshapeError } from '../src/server/reshape.ts';
import { tempDir, writeTree } from './library-kit.ts';
import { CAFE_PROMPT, cafeProposal } from './org-kit.ts';
import { project } from './projects.ts';

// Each case writes a whole studio (agents, rules, skills, the org) to disk and reads it back: about 2 s alone, much
// slower while the full suite saturates the machine.
vi.setConfig({ testTimeout: 120_000 });

const library = loadLibrary();

function studioProject() {
  const root = project('webApp');
  writePlan(root, compose({ library, domain: 'web-app', rigor: 'standard', detection: detect(root, library), version: '0.1.0' }));
  return root;
}

const studioOf = (root: string): Studio => {
  const parsed = parseStudio(readFileSync(join(root, '.claude/studio.yaml'), 'utf8'));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.studio;
};

describe('reshape', () => {
  it('hires a library role into the room that matches it', () => {
    const root = studioProject();
    const result = reshape({ root, library }, { action: 'hire', role: 'performance-engineer' });
    expect(result).toMatchObject({ ok: true, changed: ['.claude/agents/performance-engineer.md', '.claude/studio.yaml'] });
    const agent = parseFrontmatter(readFileSync(join(root, '.claude/agents/performance-engineer.md'), 'utf8'));
    expect(agent.data).toMatchObject({ name: 'performance-engineer', color: 'green' });
    expect(agent.body).toContain('- To `backend-engineer` (Backend engineer) when the bottleneck is a slow query');
    // The architect isn't hired in a standard web-app studio, so that hand-off is left out.
    expect(agent.body).not.toContain('`architect`');
    expect(studioOf(root).roles.find((r) => r.id === 'performance-engineer')?.department).toBe('quality');
    expect(() => reshape({ root, library }, { action: 'hire', role: 'performance-engineer' })).toThrow('"performance-engineer" already works here.');
  });

  it('fires to an archive and rehires from it', () => {
    const root = studioProject();
    const manifest = join(root, '.claude/studio.yaml');
    const before = readFileSync(manifest, 'utf8');
    const position = studioOf(root).roles.findIndex((r) => r.id === 'code-reviewer');
    expect(position).toBeLessThan(studioOf(root).roles.length - 1);
    expect(reshape({ root, library }, { action: 'fire', role: 'code-reviewer' }).ok).toBe(true);
    expect(existsSync(join(root, '.claude/agents/code-reviewer.md'))).toBe(false);
    expect(existsSync(join(root, '.claude/studio/fired/code-reviewer.md'))).toBe(true);
    expect(studioOf(root).fired).toEqual([
      { id: 'code-reviewer', department: 'quality', title: 'Code reviewer', file: '.claude/studio/fired/code-reviewer.md', archetype: 'code-reviewer', position },
    ]);
    expect(studioOf(root).roles.some((r) => r.id === 'code-reviewer')).toBe(false);
    reshape({ root, library }, { action: 'rehire', role: 'code-reviewer' });
    expect(existsSync(join(root, '.claude/agents/code-reviewer.md'))).toBe(true);
    // An exact undo: the same manifest, so the role is back at its old desk with its archetype.
    expect(readFileSync(manifest, 'utf8')).toBe(before);
    // Hiring a fired role brings the old file back instead of writing a new one.
    reshape({ root, library }, { action: 'fire', role: 'code-reviewer' });
    expect(reshape({ root, library }, { action: 'hire', role: 'code-reviewer' }).message).toBe('Rehired the code reviewer.');
  });

  it('moves a role between rooms and changes its model without touching the body', () => {
    const root = studioProject();
    const before = parseFrontmatter(readFileSync(join(root, '.claude/agents/ux-designer.md'), 'utf8')).body;
    reshape({ root, library }, { action: 'move', role: 'ux-designer', department: 'engineering' });
    expect(studioOf(root).roles.find((r) => r.id === 'ux-designer')?.department).toBe('engineering');
    reshape({ root, library }, { action: 'model', role: 'ux-designer', model: 'haiku' });
    const after = parseFrontmatter(readFileSync(join(root, '.claude/agents/ux-designer.md'), 'utf8'));
    expect(after.data.model).toBe('haiku');
    expect(after.body).toBe(before);
    expect(() => reshape({ root, library }, { action: 'model', role: 'ux-designer', model: 'gpt-9' })).toThrow('Model must be one of');
    expect(() => reshape({ root, library }, { action: 'move', role: 'ux-designer', department: 'basement' })).toThrow('There is no "basement" room.');
  });

  it('rewrites a rule body and keeps its paths', () => {
    const root = studioProject();
    const path = join(root, '.claude/rules/typescript.md');
    const paths = parseFrontmatter(readFileSync(path, 'utf8')).data.paths;
    reshape({ root, library }, { action: 'rule', rule: 'typescript', body: '- Use strict mode.\n- No any.' });
    const doc = parseFrontmatter(readFileSync(path, 'utf8'));
    expect(doc.data.paths).toEqual(paths);
    expect(doc.body).toBe('- Use strict mode.\n- No any.\n');
    expect(() => reshape({ root, library }, { action: 'rule', rule: 'typescript', body: '   ' })).toThrow('A rule needs some text.');
  });

  it('refuses bad input and anything outside .claude', () => {
    const root = studioProject();
    const bad = [
      [null, 'Send an action'],
      [{ action: 'promote', role: 'x' }, 'Unknown action "promote".'],
      [{ action: 'fire', role: '../../etc/passwd' }, 'role must be a lowercase id'],
      [{ action: 'hire', role: 'wizard' }, 'The library has no "wizard" role.'],
      [{ action: 'fire', role: 'nobody' }, '"nobody" is not on the staff.'],
      [{ action: 'rule', rule: 'not-a-rule', body: 'x' }, '"not-a-rule" is not one of the studio\'s rules.'],
    ] as const;
    for (const [action] of bad) expect(() => reshape({ root, library }, action)).toThrow(ReshapeError);
    for (const [action, message] of bad) expect(() => reshape({ root, library }, action)).toThrow(message);
  });

  it('writes studio.yaml on the first change to a studio that was only inferred', () => {
    const root = writeTree(tempDir(), {
      '.claude/agents/qa-lead.md': '---\nname: qa-lead\ndescription: Owns testing.\n---\nBody\n',
      '.claude/agents/game-designer.md': '---\nname: game-designer\ndescription: Designs the game.\n---\nBody\n',
    });
    reshape({ root, library }, { action: 'move', role: 'qa-lead', department: 'design' });
    const studio = studioOf(root);
    expect(studio.roles.find((r) => r.id === 'qa-lead')?.department).toBe('design');
  });

  it('changes nothing while studio.yaml has a mistake in it', () => {
    const root = studioProject();
    const manifest = join(root, '.claude/studio.yaml');
    const broken = readFileSync(manifest, 'utf8').replace('department: design', 'department: desgin');
    writeFileSync(manifest, broken);
    for (const action of [
      { action: 'move', role: 'qa-engineer', department: 'design' },
      { action: 'fire', role: 'code-reviewer' },
      { action: 'hire', role: 'performance-engineer' },
    ]) {
      expect(() => reshape({ root, library }, action)).toThrow('.claude/studio.yaml has a problem, so nothing was changed: roles[');
    }
    expect(readFileSync(manifest, 'utf8')).toBe(broken);
    expect(existsSync(join(root, '.claude/agents/code-reviewer.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/agents/performance-engineer.md'))).toBe(false);
  });

  it('works with agents named like "Frontend Developer" and writes a studio.yaml that parses', () => {
    const root = writeTree(tempDir(), {
      '.claude/agents/engineering/frontend-developer.md': '---\nname: Frontend Developer\ndescription: Builds the UI.\n---\nBody\n',
      '.claude/agents/testing/reality-checker.md': '---\nname: Reality Checker\ndescription: Tests releases.\n---\nBody\n',
    });
    reshape({ root, library }, { action: 'hire', role: 'security-reviewer' });
    expect(studioOf(root).roles.find((r) => r.id === 'frontend-developer')).toMatchObject({ agent: 'Frontend Developer', title: 'Frontend developer' });
    reshape({ root, library }, { action: 'move', role: 'frontend-developer', department: 'security' });
    reshape({ root, library }, { action: 'model', role: 'frontend-developer', model: 'haiku' });
    expect(parseFrontmatter(readFileSync(join(root, '.claude/agents/engineering/frontend-developer.md'), 'utf8')).data.model).toBe('haiku');
    reshape({ root, library }, { action: 'fire', role: 'reality-checker' });
    reshape({ root, library }, { action: 'rehire', role: 'reality-checker' });
    expect(studioOf(root).roles.find((r) => r.id === 'reality-checker')).toMatchObject({ agent: 'Reality Checker' });
    expect(existsSync(join(root, '.claude/agents/reality-checker.md'))).toBe(true);
  });

  it('rehires only from the archive folder that fire uses', () => {
    const root = studioProject();
    const manifest = join(root, '.claude/studio.yaml');
    writeFileSync(join(root, '.claude/settings.local.json'), '{"permissions":{"deny":["Bash(rm *)"]}}');
    const text = readFileSync(manifest, 'utf8').replace('fired: []', 'fired:\n  - id: helper\n    department: quality\n    title: Helper\n    file: .claude/settings.local.json');
    writeFileSync(manifest, text);
    expect(() => reshape({ root, library }, { action: 'rehire', role: 'helper' })).toThrow("isn't where Worklings archives helper");
    expect(existsSync(join(root, '.claude/settings.local.json'))).toBe(true);
  });

  it('hires and fires in a studio an earlier version wrote, keeping the generator it names', () => {
    const root = studioProject();
    const manifest = join(root, '.claude/studio.yaml');
    const old = readFileSync(manifest, 'utf8')
      .replace(/^# .*\n/, '# Headcount studio manifest: which room each Claude Code role, rule and gate lives in.\n')
      .replace('  tool: worklings\n', '  tool: headcount\n');
    expect(old).toMatch(/^# Headcount studio manifest: [\s\S]*\n {2}tool: headcount\n/);
    writeFileSync(manifest, old);
    expect(studioOf(root).generator).toEqual({ tool: 'headcount', version: '0.1.0' });
    expect(reshape({ root, library }, { action: 'hire', role: 'performance-engineer' }).ok).toBe(true);
    expect(reshape({ root, library }, { action: 'fire', role: 'code-reviewer' }).ok).toBe(true);
    const text = readFileSync(manifest, 'utf8');
    expect(text.split('\n')[0]).toBe('# Worklings studio manifest: which room each Claude Code role, rule and gate lives in.');
    expect(studioOf(root)).toMatchObject({ generator: { tool: 'headcount', version: '0.1.0' }, fired: [{ id: 'code-reviewer', file: '.claude/studio/fired/code-reviewer.md' }] });
    expect(studioOf(root).roles.map((r) => r.id)).toContain('performance-engineer');
  });

  it('refuses to write through a link out of the project', () => {
    const root = studioProject();
    const outside = writeTree(tempDir(), { 'typescript.md': '---\npaths: ["**/*.ts"]\n---\nOutside\n' });
    rmSync(join(root, '.claude/rules'), { recursive: true });
    symlinkSync(outside, join(root, '.claude/rules'), 'junction');
    expect(() => reshape({ root, library }, { action: 'rule', rule: 'typescript', body: 'Overwritten' })).toThrow('.claude/rules is a symlink or junction');
    expect(readFileSync(join(outside, 'typescript.md'), 'utf8')).toContain('Outside');
  });
});

// v3: the same changes, made from the CLI or v1's office in a project that runs a company, keep its org.
describe('reshape in a company', () => {
  const ops = orgOps(library);
  function company() {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    const checked = ops.check(cafeProposal(), { preset: 'thorough' });
    if (!checked.ok) throw new Error(checked.errors.join('\n'));
    ops.write(root, checked.proposal);
    return root;
  }

  it('fires a manager with their place kept, hands their people up, and rehires them there', () => {
    const root = company();
    expect(reshape({ root, library }, { action: 'fire', role: 'head-of-content' }).message).toBe('Fired the head of content. Its file is in .claude/studio/fired/ if you want it back.');
    const studio = studioOf(root);
    const team = ['copywriter', 'localization-specialist', 'local-seo-specialist'];
    expect(studio.fired).toEqual([
      {
        id: 'head-of-content',
        department: 'content',
        title: 'Head of content',
        file: '.claude/studio/fired/head-of-content.md',
        archetype: 'head',
        position: 14,
        name: 'Eva',
        level: 'head',
        reportsTo: 'ceo',
        reports: team,
      },
    ]);
    expect(studio.roles.filter((r) => team.includes(r.id)).map((r) => r.reportsTo)).toEqual(['ceo', 'ceo', 'ceo']);
    expect(reshape({ root, library }, { action: 'rehire', role: 'head-of-content' }).message).toBe('Rehired the head of content. Lena, Jon and Pia report to them again.');
    const back = studioOf(root);
    expect(back.roles[14]).toEqual({ id: 'head-of-content', department: 'content', title: 'Head of content', name: 'Eva', level: 'head', reportsTo: 'ceo', archetype: 'head' });
    expect(back.roles.filter((r) => team.includes(r.id)).map((r) => r.reportsTo)).toEqual(['head-of-content', 'head-of-content', 'head-of-content']);
  });

  it('hires under the CEO when no manager is named, with hand-offs to the people who hold the roles', () => {
    const root = company();
    reshape({ root, library }, { action: 'hire', role: 'release-manager' });
    expect(studioOf(root).roles.at(-1)).toEqual({ id: 'release-manager', department: 'ops', title: 'Release manager', reportsTo: 'ceo', archetype: 'release-manager' });
    const agent = parseFrontmatter(readFileSync(join(root, '.claude/agents/release-manager.md'), 'utf8'));
    expect(agent.data).toMatchObject({ name: 'release-manager', color: 'orange' });
    const when = library.roles.get('release-manager')?.handoffs['devops-engineer'] ?? '';
    expect(when).not.toBe('');
    expect(agent.body).toContain(`- To \`devops-engineer\` (DevOps engineer) when ${when.replace(/\.$/, '')}.`);
  });

  it('hires into a room under its head, and under the CEO when the room has none', () => {
    const root = company();
    reshape({ root, library }, { action: 'hire', role: 'copywriter', id: 'copywriter-2', department: 'content' });
    expect(studioOf(root).roles.find((r) => r.id === 'copywriter-2')?.reportsTo).toBe('head-of-content');
    reshape({ root, library }, { action: 'hire', role: 'release-manager', id: 'release-manager-2' });
    expect(studioOf(root).roles.find((r) => r.id === 'release-manager-2')?.reportsTo).toBe('ceo');
  });

  it('hires under the person named in reportsTo, and refuses one who cannot manage them', () => {
    const root = company();
    reshape({ root, library }, { action: 'hire', role: 'copywriter', id: 'copywriter-2', department: 'content', reportsTo: 'ceo' });
    expect(studioOf(root).roles.find((r) => r.id === 'copywriter-2')?.reportsTo).toBe('ceo');
    const hire = (reportsTo: unknown) => () => reshape({ root, library }, { action: 'hire', role: 'release-manager', reportsTo });
    expect(hire('nobody-here')).toThrow('"nobody-here" is not on the staff.');
    expect(hire('copywriter')).toThrow('"copywriter" is a worker; people report to the CEO, a head or a team lead.');
    expect(hire(7)).toThrow(ReshapeError);
    expect(hire('release-manager')).toThrow("\"release-manager\" can't report to itself.");
    reshape({ root, library }, { action: 'fire', role: 'head-of-content' });
    expect(hire('head-of-content')).toThrow('"head-of-content" was fired, so nobody can report to them; rehire them first.');
    expect(hire('head-of-content')).toThrow(OrgRefusal);
    expect(studioOf(root).roles.some((r) => r.id === 'release-manager')).toBe(false);
  });

  it('refuses to fire the CEO or to give someone a manager the org does not allow', () => {
    const root = company();
    const before = readFileSync(join(root, '.claude/studio.yaml'), 'utf8');
    expect(() => reshape({ root, library }, { action: 'fire', role: 'ceo' })).toThrow("The CEO can't be fired: the company needs one, and it answers to the stakeholder.");
    const move = () => reshape({ root, library }, { action: 'move', role: 'copywriter', department: 'content', reportsTo: 'localization-specialist' });
    expect(move).toThrow('"localization-specialist" is a worker; people report to the CEO, a head or a team lead.');
    expect(move).toThrow(ReshapeError);
    expect(move).toThrow(OrgRefusal);
    expect(readFileSync(join(root, '.claude/studio.yaml'), 'utf8')).toBe(before);
  });

  it('refuses a change that would leave studio.yaml with a mistake, before any file moves', () => {
    const root = company();
    const manifest = join(root, '.claude/studio.yaml');
    const studio = studioOf(root);
    studio.fired.push({ id: 'old-ceo', department: 'direction', title: 'CEO', file: '.claude/studio/fired/old-ceo.md', level: 'ceo' });
    writeFileSync(manifest, serializeStudio(studio));
    writeTree(root, { '.claude/studio/fired/old-ceo.md': '---\nname: old-ceo\ndescription: The CEO before.\n---\nBody\n' });
    expect(() => reshape({ root, library }, { action: 'rehire', role: 'old-ceo' })).toThrow(
      'That change would leave .claude/studio.yaml with a mistake, so nothing was changed: roles: only one role can be the CEO, found ceo, old-ceo.',
    );
    expect(existsSync(join(root, '.claude/studio/fired/old-ceo.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/agents/old-ceo.md'))).toBe(false);
  });
});
