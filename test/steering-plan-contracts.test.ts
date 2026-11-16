// Plans for big one-shot jobs (SPEC-v0.2.md, "What makes big one-shot tasks work"): contracts between streams, an
// integration task where several people's work meets, an independent check against the stakeholder's words at the end,
// and the promise that a small plan is never asked for more.
import { describe, expect, it } from 'vitest';
import { applyEvents } from '../src/company/decisions.ts';
import { approvePlan, contractLines, editPlan, proposePlan, revertSteps, startTurnLines } from '../src/company/plan.ts';
import { BIG_PLAN, checkPlan, type PlanCheck, planChanges } from '../src/core/plan.ts';
import type { OrgProposal } from '../src/core/org.ts';
import type { Plan, PlanContract, PlanTask } from '../src/core/steering.ts';
import { NOW, PEOPLE, rawPlan, Sim, STAKEHOLDER } from './steering-core-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

const ok = (check: PlanCheck): Plan => {
  if (!check.ok) throw new Error(check.errors.join('\n'));
  return check.plan;
};
const errors = (check: PlanCheck): string[] => {
  if (check.ok) throw new Error('The plan was expected to be refused.');
  return check.errors;
};
const asCeo = (plan: unknown) => checkPlan(plan, PEOPLE, { structure: true });

const task = (id: string, title: string, owner: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id, title, owner, files: [], milestone: 'ms-1', after: [], brief: `Brief for ${title}.`, doneWhen: `${title} works.`, check: 'npm test', ...extra,
});
const contract = (extra: Partial<PlanContract> = {}): PlanContract => ({
  id: 'c-1', title: 'Orders API', file: 'docs/contracts/api.md', writer: 'p-1', dependents: ['p-2', 'p-3'], summary: 'Routes and shapes.', ...extra,
});

/** A big plan that is organised as one should be: a contract first, three streams, an integration task, a final check. */
function big(extra: Partial<Plan> = {}): Plan {
  return {
    goal: 'An orders app with sign-in, roles, an API, a phone UI and an export.',
    milestones: [
      { id: 'ms-1', title: 'Contracts agreed', doneWhen: 'The API contract is in the repo.' },
      { id: 'ms-2', title: 'Parts built', doneWhen: 'The parts run together.' },
      { id: 'ms-3', title: 'Checked', doneWhen: 'Every requirement was checked.' },
    ],
    tasks: [
      task('p-1', 'API contract', 'backend-engineer', { files: ['docs/contracts/'] }),
      task('p-2', 'Orders API', 'backend-engineer', { milestone: 'ms-2', files: ['api/'], after: ['p-1'] }),
      task('p-3', 'Phone UI', 'frontend-engineer', { milestone: 'ms-2', files: ['src/'], after: ['p-1'] }),
      task('p-4', 'Look', 'ui-designer', { milestone: 'ms-2', files: ['styles/'], after: ['p-1'] }),
      task('p-5', 'Sign-in', 'backend-engineer', { milestone: 'ms-2', files: ['auth/'], after: ['p-1'] }),
      task('p-6', 'Export', 'frontend-engineer', { milestone: 'ms-2', files: ['export/'], after: ['p-1'] }),
      task('p-7', 'Run the parts together', 'head-of-engineering', { milestone: 'ms-2', kind: 'integration', after: ['p-2', 'p-3', 'p-4', 'p-5', 'p-6'] }),
      task('p-8', 'Check against the stakeholder', 'qa-engineer', { milestone: 'ms-3', kind: 'verification', after: ['p-7'], doneWhen: 'Each requirement from stakeholder_words was run and has a result.' }),
    ],
    contracts: [contract()],
    ...extra,
  };
}
const withTasks = (tasks: PlanTask[], extra: Partial<Plan> = {}): Plan => big({ tasks, ...extra });
const edited = (change: (t: PlanTask[]) => PlanTask[]): PlanTask[] => change(big().tasks.map((t) => ({ ...t })));

describe('contracts', () => {
  it('come back with their ids, the file as a project path and tasks named by id', () => {
    const plan = ok(
      asCeo(
        big({
          contracts: [{ title: 'Orders API', file: './docs//contracts/api.md', writer: 'API contract', dependents: ['Orders API', 'p-3'] } as PlanContract],
        }),
      ),
    );
    expect(plan.contracts).toEqual([{ id: 'c-1', title: 'Orders API', file: 'docs/contracts/api.md', writer: 'p-1', dependents: ['p-2', 'p-3'] }]);
  });

  it('keep their id when a later version sends the contract by its title only', () => {
    const first = ok(asCeo(big()));
    const next = ok(checkPlan(big({ contracts: [{ ...contract(), id: '' }] }), PEOPLE, { earlier: [first], structure: true }));
    expect(next.contracts?.[0]?.id).toBe('c-1');
  });

  it('are left out of a plan that has none, so an old plan reads the same', () => {
    const plan = ok(checkPlan(rawPlan({ tasks: rawPlan().tasks.map(({ kind: _kind, ...t }) => t) }), PEOPLE));
    expect(Object.hasOwn(plan, 'contracts')).toBe(false);
    expect(plan.tasks.every((t) => !Object.hasOwn(t, 'kind'))).toBe(true);
  });

  it('are refused when the tasks that build on one start before it is written', () => {
    const tasks = edited((t) => t.map((x) => (x.id === 'p-3' ? { ...x, after: [] } : x)));
    expect(errors(asCeo(withTasks(tasks)))).toEqual([
      '“Phone UI” (p-3) builds against The contract “Orders API” (c-1), which “API contract” (p-1) writes, but doesn\'t wait for it; add p-1 to its after, so the contract is written before anyone builds on it.',
    ]);
  });

  it('count a wait through other tasks as waiting', () => {
    const tasks = edited((t) => t.map((x) => (x.id === 'p-3' ? { ...x, after: ['p-2'] } : x)));
    expect(asCeo(withTasks(tasks)).ok).toBe(true);
  });

  it('are refused when the task that writes one does not have its file', () => {
    const tasks = edited((t) => t.map((x) => (x.id === 'p-1' ? { ...x, files: ['api/'] } : x)));
    const found = errors(checkPlan(withTasks(tasks, { contracts: [contract()] }), PEOPLE));
    expect(found).toContain('The contract “Orders API” (c-1) lives in docs/contracts/api.md, but “API contract” (p-1), which writes it, doesn\'t have that file; add docs/contracts/api.md to its files.');
  });

  it('say what is wrong with one that has no file, no dependents or names a task the plan lacks', () => {
    const found = errors(
      checkPlan(
        big({
          contracts: [
            { id: 'c-1', title: 'No file', writer: 'p-1', dependents: ['p-2'] } as PlanContract,
            { id: 'c-2', title: 'Nobody', file: 'docs/b.md', writer: 'p-1', dependents: [] },
            { id: 'c-3', title: 'Ghost', file: 'docs/c.md', writer: 'p-99', dependents: ['p-2'] },
          ],
        }),
        PEOPLE,
      ),
    );
    expect(found).toEqual([
      'The contract “No file” names no file; name the project file it lives in (a types module, an OpenAPI or markdown spec), like "docs/contracts/api.md".',
      'The contract “Nobody” has no dependents; list the tasks that build against it, or leave the contract out.',
      'The contract “Ghost” names "p-99" as the task that writes it, which isn\'t a task in the plan; name a task by its id.',
    ]);
  });

  it('are refused when two share a file, or a task is its own dependent', () => {
    const found = errors(
      checkPlan(big({ contracts: [contract(), contract({ id: 'c-2', title: 'Orders again', file: 'docs/contracts/api.md', dependents: ['p-1'] })] }), PEOPLE),
    );
    expect(found).toEqual([
      'The contract “Orders again” (c-2) and “Orders API” (c-1) both live in docs/contracts/api.md; one file holds one contract, so merge them or give each its own file.',
      'The contract “Orders again” (c-2) lists “API contract” as both its writer and a dependent; the tasks that build on it are other tasks.',
    ]);
  });

  it('are refused as duplicates by id, and when there are too many or not a list', () => {
    expect(errors(checkPlan(big({ contracts: [contract(), contract({ title: 'Other', file: 'docs/x.md' })] }), PEOPLE))).toEqual(['Two contracts have the id c-1; give each its own.']);
    const many = Array.from({ length: 25 }, (_, i) => contract({ id: `c-${i + 1}`, file: `docs/${i}.md` }));
    expect(errors(checkPlan(big({ contracts: many }), PEOPLE))).toEqual(['The plan has 25 contracts and holds 24; merge the ones that could live in one file.']);
    expect(errors(checkPlan(big({ contracts: 'one' as unknown as PlanContract[] }), PEOPLE))[0]).toContain('lists its contracts as something other than a list');
  });

  it('refuse a kind that is neither integration nor verification', () => {
    const tasks = edited((t) => t.map((x) => (x.id === 'p-2' ? ({ ...x, kind: 'qa' } as unknown as PlanTask) : x)));
    expect(errors(asCeo(withTasks(tasks)))).toEqual(['“Orders API” has the kind "qa"; a task\'s kind is "integration" or "verification", or left out for a task that builds a part.']);
  });
});

describe('two tasks that change the same files', () => {
  const clash = (extra: Partial<PlanTask> = {}): Plan =>
    rawPlan({
      tasks: [
        { ...rawPlan().tasks[0], files: ['src/shared/'] } as PlanTask,
        { ...rawPlan().tasks[1], owner: 'backend-engineer', files: ['src/shared/types.ts'], ...extra } as PlanTask,
      ],
    });

  it('are refused without a dependency, and the message points to a contract when two people share it', () => {
    expect(errors(checkPlan(clash(), PEOPLE))).toEqual([
      '“Menu data” and “Menu look” both change src/shared and could run at the same time; make one wait for the other, or split the files. If they build against the same interface, write it first as a contract (a file one of them writes, with the other waiting for it) instead of both editing it.',
    ]);
  });

  it('are fine when one waits for the other', () => {
    expect(checkPlan(clash({ after: ['p-1'] }), PEOPLE).ok).toBe(true);
  });

  it('are refused for one person too, without the contract hint', () => {
    const same = clash({ owner: 'frontend-engineer' });
    expect(errors(checkPlan(same, PEOPLE))[0]).toBe('“Menu data” and “Menu look” both change src/shared and could run at the same time; make one wait for the other, or split the files.');
  });
});

describe('a big plan', () => {
  it('is three people building parts in six tasks or more', () => {
    expect(BIG_PLAN).toEqual({ streams: 3, tasks: 6 });
  });

  it('that is organised as asked passes', () => {
    expect(asCeo(big()).ok).toBe(true);
  });

  it('without contracts is told what to write, in the shape to add, when streams build on each other', () => {
    const found = errors(asCeo(big({ contracts: [] })));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^3 people build parts of this plan and some tasks build on Noah's work, but it has no contracts\. Add to contracts one for each interface they share, like /);
    expect(found[0]).toContain('"file":"docs/contracts/backend-engineer.md","writer":"p-1","dependents":["p-3","p-4","p-6"]}');
    expect(found[0]).toContain("its file is written by the first task of the stream that owns it");
  });

  it('is asked for no contract when no two makers\' tasks wait for each other', () => {
    const apart = edited((t) => t.map((x) => ({ ...x, after: x.kind === undefined ? [] : x.after })));
    expect(asCeo(withTasks(apart, { contracts: [] })).ok).toBe(true);
  });

  it('without an integration task where several people\'s work meets is told which milestone and what to add', () => {
    const tasks = edited((t) => t.filter((x) => x.id !== 'p-7').map((x) => (x.id === 'p-8' ? { ...x, after: ['p-2', 'p-3', 'p-4', 'p-5', 'p-6'] } : x)));
    expect(errors(asCeo(withTasks(tasks)))).toEqual([
      'The milestone “Parts built” has work from Noah, Sam, Kai but no integration task. Add a task in it with kind "integration", owned by one person, waiting for p-2, p-3, p-4, p-5, p-6, that builds and runs the whole thing together and fixes or reports each mismatch against the contracts.',
    ]);
  });

  it('whose integration task skips a stream is told which task to add to its waits', () => {
    const tasks = edited((t) => t.map((x) => (x.id === 'p-7' ? { ...x, after: ['p-2', 'p-3', 'p-5', 'p-6'] } : x.id === 'p-8' ? { ...x, after: ['p-7', 'p-4'] } : x)));
    expect(errors(asCeo(withTasks(tasks)))).toEqual([
      '“Run the parts together” (p-7) integrates “Parts built” but doesn\'t wait for p-4; add them to its after, so it runs the whole milestone together.',
    ]);
  });

  it('needs no integration task in a milestone where one person builds', () => {
    // ms-1 holds only the contract's writer, and the plan above passes without one there.
    expect(asCeo(big()).ok).toBe(true);
  });

  it('has its final verification added by the office, to the QA engineer, whatever the CEO wrote', () => {
    const large = { structure: true, size: 'large' } as const;
    const tasks = edited((t) => t.map((x) => (x.id === 'p-8' ? { ...x, owner: 'frontend-engineer', doneWhen: 'It all works.', after: ['p-2'] } : x)));
    const plan = ok(checkPlan(withTasks(tasks), PEOPLE, large));
    const finals = plan.tasks.filter((t) => t.kind === 'verification');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ id: 'p-8', owner: 'qa-engineer', milestone: 'ms-3', files: [], after: ['p-7'] });
    expect(finals[0]?.doneWhen).toContain('stakeholder_words');
    const without = ok(checkPlan(withTasks(edited((t) => t.filter((x) => x.id !== 'p-8'))), PEOPLE, large));
    expect(without.tasks.at(-1)).toMatchObject({ kind: 'verification', owner: 'qa-engineer', after: ['p-7'] });
  });

  it('keeps the CEO\'s own verification as written when the plan is checked with no size, as before sizes existed', () => {
    expect(asCeo(big()).ok).toBe(true);
    expect(asCeo(withTasks(edited((t) => t.filter((x) => x.id !== 'p-8')))).ok).toBe(true);
  });

  it("isn't asked for any of this when the stakeholder edits it", () => {
    const bare: Plan = { ...big(), contracts: undefined, tasks: big().tasks.filter((t) => t.kind === undefined) };
    expect(asCeo(bare).ok).toBe(false);
    expect(checkPlan(bare, PEOPLE).ok).toBe(true);
  });

  it('still has the file rule: no clashing files, contract or not', () => {
    const tasks = edited((t) => t.map((x) => (x.id === 'p-4' ? { ...x, files: ['src/Look.css'] } : x)));
    expect(errors(asCeo(withTasks(tasks)))[0]).toContain('both change src and');
  });
});

describe('a small plan', () => {
  const small = (n: number, owners: string[]): Plan =>
    rawPlan({
      milestones: [{ id: 'ms-1', title: 'Done', doneWhen: 'It works.' }],
      tasks: Array.from({ length: n }, (_, i) => task(`p-${i + 1}`, `Part ${i + 1}`, owners[i % owners.length] ?? 'frontend-engineer', { files: [`src/part-${i + 1}/`] })),
    });

  it('of one to three tasks needs no contract, integration or verification, whoever does them', () => {
    for (const n of [1, 2, 3]) {
      const plan = ok(asCeo(small(n, ['frontend-engineer', 'backend-engineer', 'ui-designer'])));
      expect(plan.tasks).toHaveLength(n);
      expect(Object.hasOwn(plan, 'contracts')).toBe(false);
    }
  });

  it('of up to five tasks across four people is left as it is', () => {
    expect(asCeo(rawPlan()).ok).toBe(true);
  });

  it('with only two people building needs none of it however long it is', () => {
    expect(asCeo(small(12, ['frontend-engineer', 'backend-engineer'])).ok).toBe(true);
  });

  it('hands its owners the same assignments as before: no contract lines for any task', () => {
    const plan = rawPlan({ tasks: rawPlan().tasks.map(({ kind: _kind, check: _check, ...t }) => t) });
    expect(plan.tasks.flatMap((t) => contractLines(plan, t, 'the CEO'))).toEqual([]);
  });

  it('is not asked to add tasks: three streams in six tasks that all build still need the structure, five do not', () => {
    const six = small(6, ['frontend-engineer', 'backend-engineer', 'ui-designer']);
    expect(asCeo(six).ok).toBe(false);
    expect(asCeo(small(5, ['frontend-engineer', 'backend-engineer', 'ui-designer'])).ok).toBe(true);
  });
});

describe('what the CEO is told', () => {
  it("is refused through propose_plan with every fix at once, so it can put them right in one go", () => {
    const sim = new Sim();
    const bare: Plan = { ...big(), contracts: undefined, tasks: big().tasks.filter((t) => t.kind === undefined) };
    const result = sim.run((c) => proposePlan(c, 'ceo', withChecklist(bare)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join('\n')).toMatch(/no contracts[\s\S]*no integration task/);
    expect(sim.steering.versions).toEqual([]);
  });

  it('is told to write contracts first, and about integration and verification, in the plan turn', () => {
    const lines = startTurnLines(new Sim().ctx())?.join('\n') ?? '';
    expect(lines).toContain('word for word');
    expect(lines).toContain('contracts');
    expect(lines).toContain('kind "integration"');
    expect(lines).toContain('stakeholder_words');
    // The final review is the office's: the CEO is told not to write it, and that a small plan ends with its own check.
    expect(lines).toContain("You don't write the final verification task");
    expect(lines).toContain('A maker holds up to 2 tasks under Lean, 3 under Balanced and 4 under Thorough');
    expect(lines).toContain('3 or more makers build parts');
    expect(lines).toContain('the fewest tasks that run in parallel');
  });
});

describe('the plan in the company', () => {
  const propose = (sim: Sim, plan: unknown) => sim.run((c) => proposePlan(c, 'ceo', withChecklist(plan)));
  const approve = (sim: Sim, version: number) => sim.run((c) => approvePlan(c, STAKEHOLDER, { version, through: null, cites: [] }));

  it('keeps the contracts and kinds in the version, and tells each owner about theirs when their turn comes', () => {
    const sim = new Sim();
    const result = propose(sim, big());
    expect(result.ok).toBe(true);
    expect(sim.steering.versions[0]?.plan.contracts).toEqual([contract()]);
    approve(sim, 1);
    const writer = sim.assignmentOf(sim.planned('p-1').id);
    expect(writer?.text).toContain('You write the contract “Orders API” in docs/contracts/api.md, first: “Orders API”, “Phone UI” wait for it');
    expect(writer?.text).toContain('word for word from stakeholder_words');
    expect(writer?.text).toContain('It settles: Routes and shapes.');
    // The builders and the rest wait for the contract's task.
    expect(sim.assignmentOf(sim.planned('p-2').id)).toBeUndefined();
  });

  it("tells a builder which contract to keep to, and the integration and verification tasks what they are for", () => {
    const plan = big();
    const checkLine = "Its check is `npm test`: run it yourself before you report the task done and put its result in the report's check; the office runs it again itself, and sends the task back with the output if it fails.";
    expect(contractLines(plan, plan.tasks[2], 'Ben')).toEqual([
      'You build against the contract “Orders API” in docs/contracts/api.md, which “API contract” wrote. Read it before you start and keep to it; if it is wrong or leaves something out, report that as blocked instead of working around it.',
      checkLine,
    ]);
    expect(contractLines(plan, plan.tasks[6], 'Ben')).toEqual([
      "This is an integration task: build and run everything the tasks before it made, together, and fix or report each mismatch against the contracts (docs/contracts/api.md). Say what ran and what didn't.",
      checkLine,
    ]);
    expect(contractLines(plan, plan.tasks[7], 'Ben')[0]).toBe(
      "This is the final check, and you didn't build the parts: you list each requirement of the stakeholder's words as pass or fail with the evidence, and fix nothing. The steps are below; a failed requirement goes back to its maker through the office, and Ben hears only if that can't settle it.",
    );
  });

  it('hands out nothing about contracts for a small plan', () => {
    const sim = new Sim();
    sim.world = { ...sim.world, state: { ...sim.world.state, proposal: { size: 'small' } as OrgProposal } };
    propose(sim, rawPlan({ tasks: rawPlan().tasks.slice(0, 4) }));
    approve(sim, 1);
    const texts = sim.handed.map((id) => sim.message(id).text).join('\n');
    expect(texts).not.toMatch(/contract|integration task|final check/);
  });

  it("carries the contracts through the stakeholder's edit when the editor doesn't send them", () => {
    const sim = new Sim();
    propose(sim, big());
    const sent = { ...big(), tasks: big().tasks.map((t) => (t.id === 'p-4' ? { ...t, title: 'Look and feel' } : t)) } as Plan;
    delete sent.contracts;
    const result = sim.run((c) => editPlan(c, STAKEHOLDER, { plan: sent, note: null }));
    expect(result.ok).toBe(true);
    expect(sim.steering.versions.at(-1)?.plan.contracts).toEqual([contract()]);
  });

  it("drops contracts that no longer fit a stakeholder's edit instead of refusing it, and tells the CEO", () => {
    const sim = new Sim();
    propose(sim, big());
    const sent = { ...big(), tasks: big().tasks.map((t) => (t.id === 'p-3' ? { ...t, after: [] } : t)) } as Plan;
    delete sent.contracts;
    const result = sim.run((c) => editPlan(c, STAKEHOLDER, { plan: sent, note: null }));
    expect(result.ok).toBe(true);
    expect(sim.steering.versions.at(-1)?.plan.contracts).toBeUndefined();
    expect(sim.lastTo('ceo').text).toContain('The contracts of the version before no longer fit the edit, so this version has none');
  });

  it('refuses an edit that sends contracts which do not hold, saying what to fix', () => {
    const sim = new Sim();
    propose(sim, big());
    const sent = { ...big(), tasks: big().tasks.map((t) => (t.id === 'p-3' ? { ...t, after: [] } : t)) };
    const result = sim.run((c) => editPlan(c, STAKEHOLDER, { plan: sent, note: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('builds against The contract “Orders API” (c-1)');
  });

  it("brings an older version back with its contracts when an edit is undone", () => {
    const sim = new Sim();
    propose(sim, big());
    const sent = { ...big(), tasks: big().tasks.map((t) => (t.id === 'p-4' ? { ...t, title: 'Look and feel' } : t)) } as Plan;
    sim.run((c) => editPlan(c, STAKEHOLDER, { plan: sent, note: null }));
    sim.apply(revertSteps(sim.ctx(), 1));
    expect(sim.steering.versions.at(-1)?.plan.contracts).toEqual([contract()]);
  });

  it('names a changed contract in the version\'s changes', () => {
    const before = big();
    const after = big({ contracts: [contract({ file: 'docs/contracts/orders.md' }), contract({ id: 'c-2', title: 'Export', file: 'docs/contracts/export.md' })] });
    expect(planChanges(before, after)).toEqual(['changed the contract “Orders API”', 'added the contract “Export”']);
    expect(planChanges(after, before)).toEqual(['changed the contract “Orders API”', 'cut the contract “Export”']);
  });
});

describe('plans saved by 0.1.0', () => {
  /** A 0.1.0 state is plain JSON: plans with no contracts and no kinds. */
  const saved = (plan: Plan): Sim => {
    const sim = new Sim();
    sim.world = applyEvents(sim.world, [{ type: 'plan-version', version: { version: 1, by: 'ceo', at: NOW, plan, note: null, cites: [] } }]);
    const json = JSON.parse(JSON.stringify(sim.steering.versions)) as typeof sim.steering.versions;
    expect(JSON.stringify(json)).not.toMatch(/"contracts"|"kind"/);
    return sim;
  };

  it('load, approve, hand out and edit as they did', () => {
    const sim = saved(rawPlan({ tasks: rawPlan().tasks.map(({ kind: _kind, check: _check, ...t }) => t) }));
    sim.run((c) => approvePlan(c, STAKEHOLDER, { version: 1, through: null, cites: [] }));
    expect(sim.handed.length).toBeGreaterThan(0);
    const sent = { ...rawPlan({ tasks: rawPlan().tasks.map(({ kind: _kind, check: _check, ...t }) => t) }), goal: 'Customers order ahead.' };
    expect(sim.run((c) => editPlan(c, STAKEHOLDER, { plan: sent, note: null })).ok).toBe(true);
    expect(sim.steering.versions.at(-1)?.plan.contracts).toBeUndefined();
  });

  it("a big one still loads, runs and takes the stakeholder's edit, and is asked for the structure only when the CEO revises it", () => {
    const old: Plan = { ...big(), contracts: undefined, tasks: big().tasks.filter((t) => t.kind === undefined) };
    delete old.contracts;
    const sim = new Sim();
    sim.world = applyEvents(sim.world, [{ type: 'plan-version', version: { version: 1, by: 'ceo', at: NOW, plan: old, note: null, cites: [] } }]);
    sim.run((c) => approvePlan(c, STAKEHOLDER, { version: 1, through: null, cites: [] }));
    expect(sim.handed.length).toBeGreaterThan(0);
    expect(sim.run((c) => editPlan(c, STAKEHOLDER, { plan: { ...old, goal: 'An orders app, edited.' }, note: null })).ok).toBe(true);
    const revised = sim.run((c) => proposePlan(c, 'ceo', withChecklist({ ...old, goal: 'An orders app, revised.' })));
    expect(revised.ok).toBe(false);
    if (!revised.ok) expect(revised.errors.join('\n')).toContain('has no contracts');
  });
});
