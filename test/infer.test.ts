import { describe, expect, it } from 'vitest';
import { parseFrontmatter, stringList } from '../src/core/frontmatter.ts';
import { classify, inferStudio } from '../src/core/infer.ts';
import { validateStudio } from '../src/core/studio.ts';

// The agent roster of Claude Code Game Studios (MIT), a real studio with no studio.yaml.
const GAME_STUDIOS = [
  'accessibility-specialist', 'ai-programmer', 'analytics-engineer', 'art-director', 'audio-director',
  'community-manager', 'creative-director', 'devops-engineer', 'economy-designer', 'engine-programmer',
  'game-designer', 'gameplay-programmer', 'godot-csharp-specialist', 'godot-gdextension-specialist',
  'godot-gdscript-specialist', 'godot-shader-specialist', 'godot-specialist', 'lead-programmer', 'level-designer',
  'live-ops-designer', 'localization-lead', 'narrative-director', 'network-programmer', 'performance-analyst',
  'producer', 'prototyper', 'qa-lead', 'qa-tester', 'release-manager', 'security-engineer', 'sound-designer',
  'systems-designer', 'technical-artist', 'technical-director', 'tools-programmer', 'ue-blueprint-specialist',
  'ue-gas-specialist', 'ue-replication-specialist', 'ue-umg-specialist', 'ui-programmer',
  'unity-addressables-specialist', 'unity-dots-specialist', 'unity-shader-specialist', 'unity-specialist',
  'unity-ui-specialist', 'unreal-specialist', 'ux-designer', 'world-builder', 'writer',
];

describe('classify', () => {
  it.each([
    ['producer', 'direction'],
    ['creative-director', 'direction'],
    ['technical-director', 'direction'],
    ['art-director', 'art'],
    ['audio-director', 'art'],
    ['sound-designer', 'art'],
    ['narrative-director', 'content'],
    ['lead-programmer', 'engineering'],
    ['ui-programmer', 'engineering'],
    ['ai-programmer', 'engineering'],
    ['ux-designer', 'design'],
    ['live-ops-designer', 'design'],
    ['qa-lead', 'quality'],
    ['performance-analyst', 'quality'],
    ['security-engineer', 'security'],
    ['devops-engineer', 'ops'],
    ['release-manager', 'ops'],
    ['analytics-engineer', 'data'],
    ['writer', 'content'],
  ])('puts %s in %s', (id, department) => {
    expect(classify(id).department).toBe(department);
  });

  it('lets the name outweigh a long description', () => {
    const description = 'Writes data pipelines, reviews tests, documents APIs and talks to the design team every day.';
    expect(classify('mobile-engineer', description).department).toBe('engineering');
  });

  it('returns null when nothing matches', () => {
    expect(classify('zorblax').department).toBeNull();
  });
});

describe('inferStudio', () => {
  it('seats the whole Game Studios roster with at most 10% left in the open space', () => {
    const { studio, unassigned } = inferStudio({
      name: 'Game Studios',
      agents: GAME_STUDIOS.map((id) => ({ id, description: '' })),
      rules: [],
      skills: [],
    });
    expect(unassigned.length / GAME_STUDIOS.length).toBeLessThanOrEqual(0.1);
    expect(validateStudio(studio).ok).toBe(true);
    const rooms = new Set(studio.roles.map((r) => r.department));
    expect([...rooms].sort()).toEqual(['art', 'content', 'data', 'design', 'direction', 'engineering', 'ops', 'quality', 'security']);
  });

  it('turns review and check skills into gates and keeps the rest as skills', () => {
    const { studio } = inferStudio({
      name: 'x',
      agents: [{ id: 'producer', description: '' }],
      rules: [{ id: 'ui-code', description: 'No game state in UI code' }],
      skills: [
        { id: 'design-review', description: '' },
        { id: 'security-audit', description: '' },
        { id: 'brainstorm', description: '' },
      ],
    });
    expect(studio.gates).toEqual([
      { id: 'design-review', title: 'Design review', from: 'design', to: 'engineering' },
      { id: 'security-audit', title: 'Security audit', from: 'security', to: 'ops' },
    ]);
    expect(studio.skills.map((s) => s.id)).toEqual(['brainstorm']);
    expect(studio.rules[0]?.department).toBe('design');
    expect(validateStudio(studio).ok).toBe(true);
  });

  it('opens an open-space room for agents it cannot place', () => {
    const { studio, unassigned } = inferStudio({ name: 'x', agents: [{ id: 'zorblax', description: '' }], rules: [], skills: [] });
    expect(unassigned).toEqual(['zorblax']);
    expect(studio.departments).toContainEqual({ id: 'commons', name: 'Open space', style: 'engineering' });
    expect(validateStudio(studio).ok).toBe(true);
  });

  it('gives agents named like "Frontend Developer" a slug id and keeps the name Claude Code reports', () => {
    const agents = [
      { id: 'Frontend Developer', description: 'Builds the UI.' },
      { id: 'frontend-developer', description: 'Also builds the UI.' },
      { id: '🎨 ✨', description: '' },
      { id: 'senior-principal-distinguished-gameplay-systems-and-tooling-programmer', description: '' },
    ];
    const { studio } = inferStudio({ name: 'x', agents, rules: [], skills: [] });
    expect(studio.roles.map((r) => [r.id, r.agent, r.title])).toEqual([
      ['frontend-developer', 'Frontend Developer', 'Frontend developer'],
      ['frontend-developer-2', 'frontend-developer', 'Frontend developer 2'],
      ['agent-3', '🎨 ✨', 'Agent 3'],
      ['senior-principal-distinguished-gameplay-systems-and-tooling-pro', 'senior-principal-distinguished-gameplay-systems-and-tooling-programmer', 'Senior principal distinguished gameplay systems and tooling programmer'],
    ]);
    expect(validateStudio(studio).ok).toBe(true);
  });

  it("isn't fooled by words that are also names on Object.prototype", () => {
    expect(classify('constructor', 'toString valueOf __proto__ hasOwnProperty')).toEqual({ department: null, score: 0 });
  });
});

describe('parseFrontmatter', () => {
  it('reads multi-line descriptions and list fields', () => {
    const doc = parseFrontmatter(
      '---\r\nname: qa-lead\r\ndescription: >\r\n  Owns the test plan.\r\n  Signs off releases.\r\ntools: [Read, Grep]\r\n---\r\nBody text\r\n',
    );
    expect(doc.data.name).toBe('qa-lead');
    expect(doc.data.description).toBe('Owns the test plan. Signs off releases.\n');
    expect(stringList(doc.data.tools)).toEqual(['Read', 'Grep']);
    expect(doc.body).toBe('Body text\r\n');
    expect(doc.warning).toBeUndefined();
  });

  it('falls back to line-by-line reading when the YAML is invalid', () => {
    const doc = parseFrontmatter('﻿---\nname: reviewer\ndescription: Use when: the code changed: always\ntools: Read, Grep\n---\nBody');
    expect(doc.data).toEqual({ name: 'reviewer', description: 'Use when: the code changed: always', tools: 'Read, Grep' });
    expect(stringList(doc.data.tools)).toEqual(['Read', 'Grep']);
    expect(doc.warning).toMatch(/not valid YAML/);
  });

  it('treats a file without frontmatter as all body', () => {
    expect(parseFrontmatter('# Title\n')).toEqual({ data: {}, body: '# Title\n' });
  });
});
