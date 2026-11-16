import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compose } from '../src/composer/compose.ts';
import { detect } from '../src/composer/detect.ts';
import { loadLibrary } from '../src/composer/library.ts';
import { writePlan } from '../src/composer/write.ts';
import { parseFrontmatter } from '../src/core/frontmatter.ts';
import { parseStudio, RIGOR_LEVELS } from '../src/core/studio.ts';
import { tempDir } from './library-kit.ts';
import { project, PROJECTS } from './projects.ts';

const library = loadLibrary();
const domains = [...library.domains.keys()].sort();
const sample: Record<string, keyof typeof PROJECTS> = {
  'mobile-app': 'expo', 'web-app': 'webApp', website: 'website', 'web-game': 'webGame', 'engine-game': 'godot',
  'api-service': 'pythonApi', 'browser-extension': 'extension', 'cli-library': 'cli', 'data-ml': 'dataMl',
  'ai-app': 'aiApp', 'desktop-app': 'desktop', automation: 'automation', generic: 'cli',
};

describe.each(domains)('the %s studio', (domain) => {
  it.each([...RIGOR_LEVELS])('composes a valid %s studio for a new project and for an existing one', (rigor) => {
    for (const root of [tempDir(), project(sample[domain] ?? 'cli')]) {
      const plan = compose({ library, domain, rigor, detection: detect(root, library), version: '0.1.0', idea: 'A test project.' });
      const parsed = parseStudio(plan.files.find((f) => f.kind === 'manifest')?.content ?? '');
      expect(parsed.ok).toBe(true);
      if (rigor === 'lean') expect(plan.studio.roles.length).toBeGreaterThanOrEqual(3);
      for (const file of plan.files) {
        expect(file.content, file.path).not.toContain('{{');
        if (file.kind === 'agent') {
          const { data, body } = parseFrontmatter(file.content);
          expect(data.name).toBe(file.path.split('/').pop()?.replace('.md', ''));
          expect(String(data.description).length).toBeGreaterThan(50);
          expect(body).toContain('## Hand off');
          expect(body).toContain('## This project');
        }
        if (file.kind === 'rule') expect((parseFrontmatter(file.content).data.paths as string[]).length).toBeGreaterThan(0);
      }
      for (const role of plan.studio.roles) expect(plan.claudeBlock).toContain(`\`${role.id}\``);
      // Everything studio.yaml names is written, and every skill carries only the frontmatter a library may set.
      const paths = new Set(plan.files.map((f) => f.path));
      for (const r of plan.studio.roles) expect(paths, r.id).toContain(`.claude/agents/${r.id}.md`);
      for (const r of plan.studio.rules) expect(paths, r.id).toContain(`.claude/rules/${r.id}.md`);
      for (const s of [...plan.studio.skills, ...plan.studio.gates]) expect(paths, s.id).toContain(`.claude/skills/${s.id}/SKILL.md`);
      for (const file of plan.files.filter((f) => f.kind === 'skill')) {
        const { data } = parseFrontmatter(file.content);
        expect(data.name, file.path).toBe(file.path.split('/')[2]);
        expect(Object.keys(data).every((k) => ['name', 'description', 'argument-hint'].includes(k)), file.path).toBe(true);
      }
    }
  });

  it('writes once and then finds nothing to change', () => {
    const root = project(sample[domain] ?? 'cli');
    const make = () => compose({ library, domain, rigor: 'standard', detection: detect(root, library), version: '0.1.0' });
    const first = writePlan(root, make());
    expect(first.kept).toEqual([]);
    const second = writePlan(root, make());
    expect(second.written).toEqual([]);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('<!-- worklings:start -->');
  });
});

describe('studio rosters', () => {
  it('match the reviewed teams', () => {
    const rosters = Object.fromEntries(
      domains.map((d) => [d, Object.fromEntries(RIGOR_LEVELS.map((r) => [r, compose({ library, domain: d, rigor: r, detection: detect(tempDir(), library), version: '0' }).studio.roles.map((x) => x.id)]))]),
    );
    expect(rosters).toMatchSnapshot();
  });
});
