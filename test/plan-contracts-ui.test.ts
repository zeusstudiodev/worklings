// v0.2's plan in the browser: the contracts a plan lists and the kind tags of integration and check tasks, by the plan view
// and the task board. Pure view models, so every state is a plain object here.
import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/core/steering.ts';
import { contractsNote, contractViews, kindOfTask, kindWords } from '../web/src/company/plan/contractsModel.ts';

const people = [
  { id: 'lea', name: 'Lea', title: 'UX designer', level: 'worker' as const },
  { id: 'sam', name: 'Sam', title: 'Frontend engineer', level: 'worker' as const },
];
const company = { people } as unknown as Parameters<typeof contractViews>[0];

const plan: Plan = {
  goal: 'Ship it.',
  milestones: [{ id: 'ms-1', title: 'Flow', doneWhen: 'Done.' }],
  tasks: [
    { id: 'p-1', title: 'Write the flow', owner: 'lea', files: ['design/flow.md'], milestone: 'ms-1', after: [], brief: '', doneWhen: 'Written.' },
    { id: 'p-2', title: 'Build the card', owner: 'sam', files: ['src/card/'], milestone: 'ms-1', after: ['p-1'], brief: '', doneWhen: 'Built.' },
    { id: 'p-3', title: 'Run it together', owner: 'sam', files: [], milestone: 'ms-1', after: ['p-1', 'p-2'], brief: '', doneWhen: 'Runs.', kind: 'integration' },
    { id: 'p-4', title: 'Check the words', owner: 'lea', files: [], milestone: 'ms-1', after: ['p-3'], brief: '', doneWhen: 'Checked.', kind: 'verification' },
  ],
  contracts: [{ id: 'c-1', title: 'Flow screens', file: 'design/flow.md', writer: 'p-1', dependents: ['p-2', 'p-9'], summary: 'Plant, water, streak.' }],
};

describe('contracts', () => {
  it('names who writes each and who builds against it, with tasks that left the plan said so', () => {
    const [c] = contractViews(company, plan);
    expect(c).toMatchObject({ id: 'c-1', title: 'Flow screens', file: 'design/flow.md', summary: 'Plant, water, streak.' });
    expect(c?.writer).toMatchObject({ title: 'Write the flow', missing: false });
    expect(c?.writer.owner).toContain('Lea');
    expect(c?.dependents).toEqual(['Build the card', 'a task that is no longer in the plan']);
  });

  it('says a writer that is gone, and a contract with no summary', () => {
    const odd: Plan = { ...plan, contracts: [{ id: 'c-2', title: 'Schema', file: 'db/schema.sql', writer: 'p-0', dependents: [] }] };
    const [c] = contractViews(company, odd);
    expect(c?.writer).toEqual({ title: 'a task that is no longer in the plan', owner: null, missing: true });
    expect(c?.summary).toBeNull();
    expect(c?.dependents).toEqual([]);
  });

  it('has nothing to list for a plan that names none, including one saved before 0.2', () => {
    expect(contractViews(company, { ...plan, contracts: undefined })).toEqual([]);
    expect(contractViews(company, { goal: 'x', milestones: [], tasks: [] })).toEqual([]);
  });

  it('counts them in its note', () => {
    expect(contractsNote(1)).toMatch(/^One interface is agreed first/);
    expect(contractsNote(3)).toMatch(/^3 interfaces are agreed first/);
  });
});

describe('task kinds', () => {
  it('words the two kinds and ignores the rest, as a newer office may send one this page does not know', () => {
    expect(kindWords('integration')?.label).toBe('Integration');
    expect(kindWords('verification')?.label).toBe('Check');
    expect(kindWords(undefined)).toBeNull();
    expect(kindWords('toString')).toBeNull();
    expect(kindWords('demolition')).toBeNull();
  });

  it('finds the kind of a board task from the newest plan version that has its plan task', () => {
    const steering = { plan: { versions: [{ version: 1, plan: { ...plan, tasks: plan.tasks.map((t) => ({ ...t, kind: undefined })) } }, { version: 2, plan }] } };
    const view = { steering } as unknown as Parameters<typeof kindOfTask>[0];
    expect(kindOfTask(view, { planTask: 'p-3' })?.label).toBe('Integration');
    expect(kindOfTask(view, { planTask: 'p-4' })?.label).toBe('Check');
    expect(kindOfTask(view, { planTask: 'p-2' })).toBeNull();
    expect(kindOfTask(view, { planTask: null })).toBeNull();
    expect(kindOfTask({} as never, { planTask: 'p-3' })).toBeNull();
  });
});
