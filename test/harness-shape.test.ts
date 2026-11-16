// v0.4 (SPEC-v0.4.md): the harness-shaped company. The Lead's proposal held to the seats (H1), the loop's plan written
// from the Lead's milestones (H5), the effort each seat runs at (H4), the Builder's quality bar and the Tester's rules
// (H3, H5), the Tester's one writable record and a helper's write under .claude/ (H2), helpers drawn as their person's
// (H2) and a first prompt longer than a turn quotes (B1).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '../src/core/company.ts';
import { acceptanceCheck, BUILDER_TOOLS, harnessPlan, harnessProposal, seatOf } from '../src/core/harness-shape.ts';
import { apply, assignSession, emptyOffice, indexStudio } from '../src/core/office.ts';
import { checkProposal } from '../src/core/org.ts';
import { checkPlan, FINAL_REVIEW } from '../src/core/plan.ts';
import { PRESETS, seatEffort } from '../src/core/presets.ts';
import { BUILDER_QUALITY_BAR, houseRules, TESTER_RULES } from '../src/company/house-rules.ts';
import { classifyPermission, type PolicyOptions } from '../src/runtime/approvals.ts';
import { loadLibrary } from '../src/composer/library.ts';
import { orgOps } from '../src/org/index.ts';
import type { Person } from '../src/core/company.ts';
import { tempDir } from './library-kit.ts';

type Obj = Record<string, unknown>;
const person = (id: string, name: string, title: string, level: string, room: string, reportsTo: string | null, library: string, owns = 'Their part of the work') => ({
  id, name, title, level, room, reportsTo, model: 'sonnet', owns, library,
});
const rooms = [
  { id: 'direction', title: 'Direction', style: 'direction' },
  { id: 'engineering', title: 'Engineering', style: 'engineering' },
  { id: 'quality', title: 'Quality', style: 'quality' },
];
const proposal = (people: Obj[], extra: Obj = {}): Obj => ({ company: 'Link Lint', goal: 'A CLI that finds dead links.', sizing: 'Balanced: one CLI, one Builder.', theme: 'office', rooms, people, questions: [], ...extra });
const lead = person('ceo', 'Wren', 'CEO', 'ceo', 'direction', null, 'ceo', 'The company and the line to the stakeholder');
const library = loadLibrary();
const known = { libraryRoles: new Set(library.roles.keys()), harness: true } as const;

describe('H1: the Lead proposal is held to the seats', () => {
  it('turns job titles into seats, adds the missing Reviewer and gives the Builder the Agent tool', () => {
    const raw = proposal([lead, person('frontend-engineer', 'Ines', 'Frontend engineer', 'worker', 'engineering', 'ceo', 'frontend-engineer'), person('qa-engineer', 'Tal', 'QA engineer', 'worker', 'quality', 'ceo', 'qa-engineer')]);
    const checked = checkProposal(raw, known);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const byId = Object.fromEntries(checked.proposal.people.map((p) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual(['builder', 'ceo', 'reviewer', 'tester']);
    expect(byId.ceo?.title).toBe('Lead');
    expect(byId.builder).toMatchObject({ title: 'Builder', level: 'worker', reportsTo: 'ceo', library: 'frontend-engineer' });
    expect(byId.builder?.loads?.tools).toEqual(expect.arrayContaining([...BUILDER_TOOLS]));
    expect(byId.tester).toMatchObject({ title: 'Tester', library: 'qa-engineer' });
    expect(byId.reviewer).toMatchObject({ title: 'Reviewer', library: 'reviewer' });
    expect(byId.reviewer?.loads?.tools).not.toContain('Edit');
    expect(checked.notes?.some((n) => /added the Reviewer seat/.test(n))).toBe(true);
    expect(checked.proposal.size).toBe('small');
  });

  it('refuses heads and a second Tester, and needs a Builder', () => {
    const headed = harnessProposal(proposal([lead, person('head-of-eng', 'Bo', 'Head of engineering', 'head', 'engineering', 'ceo', 'head'), person('builder', 'Ines', 'Builder', 'worker', 'engineering', 'head-of-eng', 'builder')]), 'balanced');
    expect(headed.errors.join(' ')).toMatch(/no heads or team leads/);
    const twoTesters = harnessProposal(proposal([lead, person('builder', 'Ines', 'Builder', 'worker', 'engineering', 'ceo', 'builder'), person('tester', 'Tal', 'Tester', 'worker', 'quality', 'ceo', 'tester'), person('qa', 'Uma', 'QA engineer', 'worker', 'quality', 'ceo', 'qa-engineer')]), 'balanced');
    expect(twoTesters.errors.join(' ')).toMatch(/second Tester/);
    const none = harnessProposal(proposal([lead, person('tester', 'Tal', 'Tester', 'worker', 'quality', 'ceo', 'tester')]), 'balanced');
    expect(none.errors.join(' ')).toMatch(/needs a Builder/);
  });

  it('leaves a classic proposal and the stakeholder edit alone', () => {
    const raw = proposal([lead, person('frontend-engineer', 'Ines', 'Frontend engineer', 'worker', 'engineering', 'ceo', 'frontend-engineer')], { size: 'small', rooms: rooms.slice(0, 2) });
    const classic = checkProposal(raw, { libraryRoles: known.libraryRoles });
    expect(classic.ok && classic.proposal.people.map((p) => p.id)).toEqual(['ceo', 'frontend-engineer']);
    const edit = checkProposal(raw, { ...known, enforceSize: false });
    expect(edit.ok && edit.proposal.people.map((p) => p.title)).toEqual(['CEO', 'Frontend engineer']);
  });

  it('reads a seat from the library role before the title, and keeps to four Builders', () => {
    const quality = harnessProposal(proposal([lead, person('ui', 'Ines', 'Frontend engineer (quality UI)', 'worker', 'engineering', 'ceo', 'frontend-engineer')]), 'balanced');
    expect(quality.errors).toEqual([]);
    expect((quality.raw.people as Obj[]).map((p) => p.id)).toEqual(['ceo', 'builder', 'tester', 'reviewer']);
    const five = harnessProposal(proposal([lead, ...[1, 2, 3, 4, 5].map((n) => person(`b${n}`, `N${n}`, 'Engineer', 'worker', 'engineering', 'ceo', 'backend-engineer'))]), 'thorough');
    expect(five.errors.join(' ')).toMatch(/up to 4 Builders/);
  });

  it('knows each seat by id and level', () => {
    expect([seatOf({ id: 'ceo', level: 'ceo' }), seatOf({ id: 'builder-2' }), seatOf({ id: 'tester' }), seatOf({ id: 'reviewer' }), seatOf({ id: 'copywriter' })]).toEqual(['lead', 'builder', 'tester', 'reviewer', null]);
  });
});

const people = [
  { id: 'ceo', name: 'Wren', title: 'Lead', level: 'ceo' },
  { id: 'builder', name: 'Ines', title: 'Builder', level: 'worker' },
  { id: 'tester', name: 'Tal', title: 'Tester', level: 'worker' },
  { id: 'reviewer', name: 'Rae', title: 'Reviewer', level: 'worker' },
];
const milestones = [
  { id: 'ms-1', title: 'Find dead links in one file', doneWhen: 'mdlinks README.md lists each dead relative link with its line.' },
  { id: 'ms-2', title: 'Folders and JSON output', doneWhen: 'mdlinks docs/ walks the folder and --json prints the report as JSON.' },
];
const checklist = [
  { id: 'k-1', text: 'Dead relative links are listed with their line', quote: 'list each dead link with its line number', covers: ['ms-1'] },
  { id: 'k-2', text: 'JSON output', quote: '--json', covers: ['ms-2'] },
];

describe('H5: the loop is written from the Lead milestones', () => {
  it('puts the Tester first in each milestone and checks every build by running the acceptance tests', () => {
    const h = harnessPlan({ goal: 'A CLI that finds dead links.', milestones, tasks: [], checklist }, people);
    expect(h.errors).toEqual([]);
    const tasks = h.raw.tasks as Obj[];
    expect(tasks.map((t) => `${String(t.owner)}:${String(t.milestone)}`)).toEqual(['tester:ms-1', 'tester:ms-2', 'builder:ms-1', 'builder:ms-2']);
    const [t1, t2, b1, b2] = tasks;
    expect(b1?.check).toBe(acceptanceCheck('ms-1'));
    expect(b1?.after).toEqual([t1?.id]);
    expect(b2?.after).toEqual([b1?.id, t2?.id]);
    // The next milestone's tests wait only for the previous tests, so they are written while the Builder builds.
    expect(t2?.after).toEqual([t1?.id]);
    expect(t1?.files).toEqual(['.worklings-shared/acceptance/ms-1/']);
    const items = h.raw.checklist as Obj[];
    expect(items.map((k) => k.covers)).toEqual([[b1?.id], [b2?.id]]);

    const plan = checkPlan(h.raw, people, { structure: true, checklist: true, size: 'small', preset: 'balanced', harness: true });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const last = plan.plan.tasks.at(-1);
    expect(last).toMatchObject({ title: FINAL_REVIEW.title, owner: 'reviewer', kind: 'verification' });
  });

  it('keeps every task id when a revision adds a milestone, gives the Builder the project and checks the Tester wrote tests', () => {
    const two = harnessPlan({ goal: 'x', milestones, tasks: [] }, people, { topLevel: ['src/', 'package.json', '.git/', '.worklings/', 'node_modules/'] });
    const three = harnessPlan({ goal: 'x', milestones: [...milestones, { id: 'ms-3', title: 'Three', doneWhen: 'd3' }], tasks: [] }, people);
    const ids = (h: typeof two) => (h.raw.tasks as Obj[]).map((t) => t.id);
    expect(ids(two)).toEqual(['ms-1-tests', 'ms-2-tests', 'ms-1-build', 'ms-2-build']);
    expect(ids(three).filter((x) => ids(two).includes(x))).toEqual(ids(two));
    const build = (two.raw.tasks as Obj[]).find((t) => t.id === 'ms-1-build');
    expect(build?.files).toEqual(expect.arrayContaining(['src/', 'package.json', 'README.md']));
    expect((build?.files as string[]).some((f) => /^(?:\.git\/|\.worklings|node_modules)/.test(f))).toBe(false);
    expect((two.raw.tasks as Obj[]).find((t) => t.id === 'ms-1-tests')?.check).toBe('node --check .worklings-shared/acceptance/ms-1/main.accept.mjs');
  });

  it("replaces a milestone id a plan can't keep, and never cuts a check", () => {
    const h = harnessPlan({ goal: 'x', milestones: [{ id: 'ms 1', title: 'One', doneWhen: 'd' }], tasks: [] }, people);
    expect((h.raw.milestones as Obj[])[0]?.id).toBe('ms-1');
    const two = [...people, { id: 'builder-2', name: 'Oli', title: 'Builder', level: 'worker' }];
    const long = `npm run typecheck && npm run lint && npm test -- --reporter=verbose --coverage ${'x'.repeat(60)}`;
    const tasks = [
      { id: 'p-1', title: 'API', owner: 'builder', files: ['api/'], milestone: 'ms-1', after: [], brief: 'b', doneWhen: 'd', check: long },
      { id: 'p-2', title: 'Web', owner: 'builder-2', files: ['web/'], milestone: 'ms-1', after: ['p-1'], brief: 'b', doneWhen: 'd', check: 'npm test' },
    ];
    const h2 = harnessPlan({ goal: 'x', milestones, tasks, contracts: [{ id: 'c-1', title: 'API', file: 'api/routes.md', writer: 'p-1', dependents: ['p-2'] }] }, two);
    const byId = Object.fromEntries((h2.raw.tasks as Obj[]).map((t) => [t.id, t]));
    expect(byId['p-1']?.check).toBe(acceptanceCheck('ms-1'));
    expect(byId['p-2']?.check).toBe(`${acceptanceCheck('ms-1')} && npm test`);
    expect(h2.notes.join(' ')).toMatch(/own check was dropped/);
  });

  it('asks two Builders for a contract and their own tasks', () => {
    const two = [...people, { id: 'builder-2', name: 'Oli', title: 'Builder', level: 'worker' }];
    const h = harnessPlan({ goal: 'An app and its API.', milestones, tasks: [] }, two);
    expect(h.errors.join(' ')).toMatch(/names no contract/);
    expect(h.errors.join(' ')).toMatch(/give each Builder's tasks/);
  });

  it('keeps the classic plan rules for a classic company', () => {
    const h = harnessPlan({ goal: 'x', milestones, tasks: [] }, people);
    const classic = checkPlan(h.raw, people, { structure: true, checklist: true, size: 'small', preset: 'balanced' });
    expect(classic.ok).toBe(false);
  });
});

describe('H4: effort by seat', () => {
  it('runs the Builder at high under Balanced, medium under Lean and xhigh under Thorough', () => {
    expect(seatEffort('balanced', 'builder')).toBe('high');
    expect(seatEffort('lean', 'builder')).toBe('medium');
    expect(seatEffort('thorough', 'builder')).toBe('xhigh');
    for (const p of Object.values(PRESETS)) expect([p.efforts.lead, p.efforts.tester, p.efforts.reviewer]).toEqual(['high', 'medium', 'medium']);
  });
});

describe('H3: the quality bar travels with the Builder', () => {
  const team: Person[] = people.map((p) => ({ ...p, room: 'engineering', reportsTo: p.id === 'ceo' ? null : 'ceo', look: {}, level: p.level as Person['level'] }));
  const rules = (id: string, seat: 'builder' | 'tester' | 'reviewer' | 'lead') =>
    houseRules({ person: team.find((p) => p.id === id) as Person, people: team, company: 'Link Lint', stakeholder: 'Mo', goal: null, roomName: (r) => r, steering: { planApproval: 'before-work' }, brief: '/p/.worklings-shared/brief.md', platform: 'linux', seat });
  it('gives the Builder the bar and the helpers rule, byte for byte the same each time', () => {
    const a = rules('builder', 'builder');
    expect(a).toContain(BUILDER_QUALITY_BAR);
    expect(a).toContain('Agent tool');
    expect(a).not.toContain('no second test harness');
    expect(rules('builder', 'builder')).toBe(a);
  });
  it('gives the Tester the acceptance rules and nobody else', () => {
    expect(rules('tester', 'tester')).toContain(TESTER_RULES);
    expect(rules('reviewer', 'reviewer')).not.toContain(TESTER_RULES);
    expect(rules('reviewer', 'reviewer')).not.toContain(BUILDER_QUALITY_BAR);
  });
});

describe('H2 and H5: what the approvals policy lets a seat write', () => {
  let root = '';
  let home = '';
  let tmp = '';
  beforeAll(() => {
    const dir = tempDir('worklings-harness-');
    root = join(dir, 'proj');
    home = join(dir, 'home');
    tmp = join(dir, 'tmp');
    for (const d of [join(root, '.git'), join(root, '.worklings-shared'), home, tmp]) mkdirSync(d, { recursive: true });
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/worklings/x\n');
  });
  const policy = (o: Partial<PolicyOptions> = {}): PolicyOptions => ({ root, branch: 'worklings/x', rules: [], home, tmp, person: 'builder', ...o });
  const write = (path: string, o?: Partial<PolicyOptions>, extra: Obj = {}) =>
    classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: join(root, path), content: 'x' }, cwd: root, ...extra }, policy(o));

  it("asks for a helper's write under .claude/, as for the desk's own, with no Always allow", () => {
    // A subagent's PermissionRequest carries its agent id and type (test/fixtures/claude-2.1.312/hooks/009-PreToolUse.json).
    const helper = write('.claude/agents/x.md', {}, { agent_id: 'acc52a8892c7c742e', agent_type: 'general-purpose' });
    const own = write('.claude/agents/x.md');
    expect(helper).toMatchObject({ verdict: 'ask', alwaysRule: null });
    expect(helper).toEqual(own);
    expect(write('CLAUDE.md', {}, { agent_id: 'acc52a8892c7c742e', agent_type: 'Explore' })).toMatchObject({ verdict: 'ask', alwaysRule: null });
    expect(write('src/x.ts', {}, { agent_id: 'acc52a8892c7c742e', agent_type: 'Explore' })).toEqual({ verdict: 'allow' });
  });

  it('lets only the Tester write the acceptance tests, and nothing else the office shares', () => {
    expect(write('.worklings-shared/acceptance/ms-1/cli.accept.mjs', { person: 'tester', acceptance: true })).toEqual({ verdict: 'allow' });
    expect(write('.worklings-shared/brief.md', { person: 'tester', acceptance: true }).verdict).toBe('deny');
    expect(write('.worklings-shared/acceptance/ms-1/cli.accept.mjs').verdict).toBe('deny');
    expect(write('.worklings/state.json', { person: 'tester', acceptance: true }).verdict).toBe('deny');
  });
});

describe('H2: a desk helper is drawn as its person', () => {
  it('classifies a subagent of a desk session as that person, titled their helper', () => {
    const index = indexStudio({ version: 1, name: 'x', departments: [{ id: 'engineering', name: 'Engineering', style: 'engineering' }], roles: [{ id: 'builder', department: 'engineering', title: 'Builder' }], rules: [], skills: [], gates: [], fired: [] } as never);
    const state = emptyOffice();
    assignSession(state, 's-1', 'builder', index);
    apply(state, { kind: 'subagent-start', at: 1, sessionId: 's-1', agentId: 'a1', agentType: 'Explore' }, index);
    const helper = state.agents['s-1:a1'];
    expect(helper).toMatchObject({ kind: 'role', roleId: 'builder', helperOf: 'builder', name: "Builder's helper" });
    // A visitor's subagent stays a contractor.
    apply(state, { kind: 'subagent-start', at: 2, sessionId: 's-2', agentId: 'a2', agentType: 'Explore' }, index);
    expect(state.agents['s-2:a2']).toMatchObject({ kind: 'contractor' });
    expect(state.agents['s-2:a2']?.helperOf).toBeUndefined();
  });
});

describe('B1: a first prompt of any length', () => {
  const ops = orgOps(library);
  it('takes up to the whole limit and points the opening turn at the brief past what a turn quotes', () => {
    expect(LIMITS.prompt).toBeGreaterThanOrEqual(10_900);
    const long = `Build a household budget app. ${'Every rule matters. '.repeat(600)}`;
    const turn = ops.openingTurn({ prompt: long, detected: 'nothing', studio: null, shape: 'harness', brief: '/p/.worklings-shared/brief.md' });
    expect(turn).toContain('/p/.worklings-shared/brief.md');
    expect(turn).not.toContain('Every rule matters. Every rule matters. Every rule matters.');
    expect(turn).toContain('Lead');
    const short = ops.openingTurn({ prompt: 'A tip calculator.', detected: 'nothing', studio: null, brief: '/p/.worklings-shared/brief.md' });
    expect(short).toContain('> A tip calculator.');
  });
});
