// v0.5 (SPEC-v0.5.md): the solo shape. The Lead's proposal keeps no Tester and gains a Reviewer; the plan becomes one
// task for the whole request, checked by the project's tests and ended by the Reviewer's final review; the Builder's
// bar is a lone session's, with no acceptance tests as its target; the Lead's opening turn describes the shape.
import { describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { BUILDER_QUALITY_BAR, houseRules, SOLO_BUILDER_BAR, STRICT_REVIEWER_RULES } from '../src/company/house-rules.ts';
import type { Person } from '../src/core/company.ts';
import { COMPANY_SHAPES, severityOf, SOLO_REVIEWER, soloFixLines, soloPlan } from '../src/core/harness-shape.ts';
import { checkProposal } from '../src/core/org.ts';
import { checkPlan, FINAL_REVIEW } from '../src/core/plan.ts';
import { orgOps } from '../src/org/index.ts';

type Obj = Record<string, unknown>;
const library = loadLibrary();
const person = (id: string, name: string, title: string, level: string, room: string, reportsTo: string | null, library: string) => ({ id, name, title, level, room, reportsTo, model: 'sonnet', owns: 'Their part', library });
const rooms = [
  { id: 'direction', title: 'Direction', style: 'direction' },
  { id: 'engineering', title: 'Engineering', style: 'engineering' },
  { id: 'quality', title: 'Quality', style: 'quality' },
];
const proposal = (people: Obj[]): Obj => ({ company: 'Link Lint', goal: 'A CLI that finds dead links.', sizing: 'Balanced: one CLI.', theme: 'office', rooms, people, questions: [] });
const lead = person('ceo', 'Wren', 'CEO', 'ceo', 'direction', null, 'ceo');
const people = [
  { id: 'ceo', name: 'Wren', title: 'Lead', level: 'ceo' },
  { id: 'builder', name: 'Ines', title: 'Builder', level: 'worker' },
  { id: 'reviewer', name: 'Rae', title: 'Reviewer', level: 'worker' },
];

describe('the solo proposal', () => {
  it('is parked beside the plain default and keeps no Tester, adding a missing Reviewer', () => {
    expect(COMPANY_SHAPES[0]).toBe('plain');
    expect(COMPANY_SHAPES).toContain('solo');
    const raw = proposal([lead, person('fe', 'Ines', 'Frontend engineer', 'worker', 'engineering', 'ceo', 'frontend-engineer'), person('qa', 'Tal', 'QA engineer', 'worker', 'quality', 'ceo', 'qa-engineer')]);
    const checked = checkProposal(raw, { libraryRoles: new Set(library.roles.keys()), harness: true, solo: true });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.proposal.people.map((p) => `${p.id}:${p.title}`)).toEqual(['ceo:Lead', 'builder:Builder', 'reviewer:Reviewer']);
    expect(checked.notes?.join(' ')).toMatch(/no Tester seat/);
  });
});

describe('the solo plan', () => {
  const milestones = [
    { id: 'ms-1', title: 'Find dead links', doneWhen: 'mdlinks lists dead links.' },
    { id: 'ms-2', title: 'JSON output', doneWhen: '--json prints JSON.' },
  ];
  it('is one task for the whole request, with the milestones folded in as advice and the final review last', () => {
    const h = soloPlan({ goal: 'A link checker.', milestones, tasks: [], checklist: [{ id: 'k-1', text: 'Dead links listed', quote: null, covers: ['ms-2'] }] }, people, { topLevel: ['package.json'] });
    expect(h.errors).toEqual([]);
    const tasks = h.raw.tasks as Obj[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 'ms-1-build', owner: 'builder', milestone: 'ms-1', check: 'npm test' });
    expect(String(tasks[0]?.brief)).toMatch(/advice, not a ceiling.*Find dead links; JSON output/);
    expect((h.raw.milestones as Obj[]).length).toBe(1);
    expect(((h.raw.checklist as Obj[])[0] as Obj).covers).toEqual(['ms-1-build']);
    const plan = checkPlan(h.raw, people, { structure: true, checklist: true, size: 'small', preset: 'balanced', harness: true });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.tasks.map((t) => `${t.owner}:${t.kind ?? 'build'}`)).toEqual(['builder:build', 'reviewer:verification']);
    expect(plan.plan.tasks.at(-1)?.title).toBe(FINAL_REVIEW.title);
  });

  it("checks with the project's tests only for a Node project", () => {
    const python = soloPlan({ goal: 'g', milestones: [milestones[0]], tasks: [] }, people, { topLevel: [], prompt: 'A Python script that renames photos.' });
    expect((python.raw.tasks as Obj[])[0]?.check).toBeUndefined();
    const node = soloPlan({ goal: 'g', milestones: [milestones[0]], tasks: [] }, people, { topLevel: [], prompt: 'A Node CLI that checks links.' });
    expect((node.raw.tasks as Obj[])[0]?.check).toBe('npm test');
  });

  it('asks two Builders for their tasks and a contract', () => {
    const h = soloPlan({ goal: 'g', milestones, tasks: [] }, [...people, { id: 'builder-2', name: 'Oli', title: 'Builder', level: 'worker' }]);
    expect(h.errors.join(' ')).toMatch(/no contract/);
  });
});

describe("the solo Builder's prompt and the Lead's opening", () => {
  const team: Person[] = people.map((p) => ({ ...p, room: 'engineering', reportsTo: p.id === 'ceo' ? null : 'ceo', look: {}, level: p.level as Person['level'] }));
  const rules = (shape: 'solo' | 'harness') =>
    houseRules({ person: team[1] as Person, people: team, company: 'Link Lint', stakeholder: 'Mo', goal: null, roomName: (r) => r, steering: { planApproval: 'before-work' }, brief: '/p/brief.md', platform: 'linux', seat: 'builder', shape });
  it('carries a lone session bar with no acceptance tests, byte for byte the same each time', () => {
    const solo = rules('solo');
    expect(solo).toContain(SOLO_BUILDER_BAR);
    expect(solo).not.toContain(BUILDER_QUALITY_BAR);
    expect(solo).not.toMatch(/acceptance tests/);
    expect(rules('solo')).toBe(solo);
    expect(rules('harness')).toContain(BUILDER_QUALITY_BAR);
  });
  it("tells the Lead the shape: a Builder and a Reviewer, no Tester", () => {
    const turn = orgOps(library).openingTurn({ prompt: 'A link checker CLI.', detected: 'nothing', studio: null, shape: 'solo' });
    expect(turn).toMatch(/one Builder \(library "builder"/);
    expect(turn).toMatch(/No heads and no tester/);
  });
});

describe('v0.6 (E1): the strict Reviewer', () => {
  it('runs on Opus in a solo company', () => {
    const raw = proposal([lead, person('fe', 'Ines', 'Frontend engineer', 'worker', 'engineering', 'ceo', 'frontend-engineer'), person('rv', 'Rae', 'Code reviewer', 'worker', 'quality', 'ceo', 'code-reviewer')]);
    const checked = checkProposal(raw, { libraryRoles: new Set(library.roles.keys()), harness: true, solo: true });
    expect(checked.ok && checked.proposal.people.find((p) => p.id === 'reviewer')?.model).toBe(SOLO_REVIEWER.model);
  });

  it('reads each finding by its severity, and an unmarked one as major', () => {
    expect(['ms-1-build blocker: crashes on an empty file', 'ms-1-build major: dead anchors in blockquotes', 'ms-1-build minor: the help text has a typo', 'nit: spacing', 'the README misses the --json flag'].map(severityOf)).toEqual(['blocker', 'major', 'minor', 'minor', 'major']);
  });

  it('sends blockers and majors back in the first round, and only blockers after it', () => {
    const open = ['ms-1-build blocker: a', 'ms-1-build major: b', 'ms-1-build minor: c'];
    expect(soloFixLines(open, 1)).toEqual(['ms-1-build blocker: a', 'ms-1-build major: b']);
    expect(soloFixLines(open, 2)).toEqual(['ms-1-build blocker: a']);
    expect(soloFixLines(['ms-1-build minor: c'], 1)).toEqual([]);
  });

  it('is told to hunt, rank and give evidence, in a byte-stable prompt', () => {
    const team: Person[] = people.map((p) => ({ ...p, room: 'quality', reportsTo: p.id === 'ceo' ? null : 'ceo', look: {}, level: p.level as Person['level'] }));
    const rules = () => houseRules({ person: team[2] as Person, people: team, company: 'Link Lint', stakeholder: 'Mo', goal: null, roomName: (r) => r, steering: { planApproval: 'before-work' }, brief: '/p/brief.md', platform: 'linux', seat: 'reviewer', shape: 'solo' });
    expect(rules()).toContain(STRICT_REVIEWER_RULES);
    expect(rules()).toBe(rules());
  });
});
