import { describe, expect, it } from 'vitest';
import { parseStudio, serializeStudio, titleFromId } from '../src/core/studio.ts';

const valid = `
version: 1
name: Plant Pal
domain: mobile-app
rigor: lean
departments:
  - id: direction
  - id: engineering
  - id: sound-booth
    name: Sound booth
    style: art
roles:
  - id: producer
    department: direction
  - id: mobile-engineer
    department: engineering
    title: Mobile engineer
    archetype: mobile-engineer
rules:
  - id: react-native
    department: engineering
gates:
  - id: design-review
    from: direction
    to: engineering
skills:
  - id: plan-feature
`;

describe('parseStudio', () => {
  it('parses a valid manifest and fills defaults', () => {
    const result = parseStudio(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { studio } = result;
    expect(studio.departments.map((d) => [d.id, d.name, d.style])).toEqual([
      ['direction', 'Direction', 'direction'],
      ['engineering', 'Engineering', 'engineering'],
      ['sound-booth', 'Sound booth', 'art'],
    ]);
    expect(studio.roles[0]).toEqual({ id: 'producer', department: 'direction', title: 'Producer' });
    expect(studio.roles[1]?.archetype).toBe('mobile-engineer');
    expect(studio.gates[0]).toMatchObject({ id: 'design-review', from: 'direction', to: 'engineering' });
    expect(studio.fired).toEqual([]);
  });

  it('round-trips through serializeStudio', () => {
    const first = parseStudio(valid);
    if (!first.ok) throw new Error(first.errors.join('\n'));
    const again = parseStudio(serializeStudio(first.studio));
    expect(again).toEqual(first);
  });

  it('reads a manifest an earlier version wrote and writes it back under the current header', () => {
    const old = `# Headcount studio manifest: which room each Claude Code role, rule and gate lives in.\n${valid}generator:\n  tool: headcount\n  version: 0.1.0\n`;
    const first = parseStudio(old);
    if (!first.ok) throw new Error(first.errors.join('\n'));
    expect(first.studio.generator).toEqual({ tool: 'headcount', version: '0.1.0' });
    const text = serializeStudio(first.studio);
    expect(text.split('\n')[0]).toBe('# Worklings studio manifest: which room each Claude Code role, rule and gate lives in.');
    expect(parseStudio(text)).toEqual(first);
  });

  it('names the exact field for an unknown department', () => {
    const result = parseStudio(valid.replace('department: engineering\n    title', 'department: enginering\n    title'));
    expect(result).toEqual({
      ok: false,
      errors: ['roles[1].department: unknown department "enginering" (known: direction, engineering, sound-booth)'],
    });
  });

  it('rejects duplicate roles, bad ids and an unknown style', () => {
    const text = `
version: 1
name: X
departments:
  - id: design
    style: painting
roles:
  - id: Designer
    department: design
  - id: Designer
    department: design
`;
    const result = parseStudio(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('departments[0].style: "painting" is not a base department (direction, design, engineering, quality, security, content, data, ops, art)');
    expect(result.errors).toContain('roles[0].id: "Designer" must be lowercase letters, digits and hyphens');
    expect(result.errors).toContain('roles[1].id: "Designer" is listed twice');
  });

  it('reports wrong shapes instead of throwing', () => {
    expect(parseStudio('just text')).toEqual({ ok: false, errors: ['studio.yaml must be a mapping with version, name, departments and roles'] });
    expect(parseStudio('version: 2\nname: X\ndepartments: nope')).toEqual({
      ok: false,
      errors: ['version: expected 1, got 2', 'departments: expected a list', 'departments: a studio needs at least one department'],
    });
    const broken = parseStudio('version: 1\nname: [unclosed');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toMatch(/^studio.yaml is not valid YAML/);
  });

  it('rejects a role that is both on staff and fired', () => {
    const text = `${valid}fired:\n  - id: producer\n    department: direction\n    file: .claude/studio/fired/producer.md\n`;
    const result = parseStudio(text);
    expect(result).toEqual({ ok: false, errors: ['fired[0].id: "producer" is both on staff and fired'] });
  });
});

describe('titleFromId', () => {
  it('turns ids into sentence-case titles', () => {
    expect(titleFromId('qa-engineer')).toBe('QA engineer');
    expect(titleFromId('ux-designer')).toBe('UX designer');
    expect(titleFromId('producer')).toBe('Producer');
  });
});
