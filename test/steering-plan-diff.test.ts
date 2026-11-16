import { describe, expect, it } from 'vitest';
import { planChanges } from '../src/core/plan.ts';
import { planSummaryOf } from '../src/core/plan-summary.ts';
import { movedInOrder, planDiff } from '../src/core/planDiff.ts';
import type { Plan } from '../src/core/steering.ts';
import { milestone, plan, planTask } from './steering-plan-kit.ts';

const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);
const withTasks = (p: Plan, order: string[]): Plan => ({ ...p, tasks: order.map((id) => p.tasks.find((t) => t.id === id) ?? planTask(id, id)) });

describe('the diff between two versions of a plan', () => {
  it('is empty when nothing changed', () => {
    expect(planDiff(plan(), plan())).toEqual({
      goal: null,
      milestones: { added: [], removed: [], changed: [], moved: [] },
      tasks: { added: [], removed: [], changed: [], moved: [] },
    });
  });

  it('says when the goal changed, with both texts', () => {
    const after = plan({ goal: 'Customers order ahead, pay with TWINT and pick up.' });
    expect(planDiff(plan(), after).goal).toEqual({ before: plan().goal, after: after.goal });
  });

  it('lists milestones added, removed and changed, by id', () => {
    const before = plan();
    const after = plan({
      milestones: [milestone('ms-1', 'Menu pages are live'), milestone('ms-3', 'Launch')],
      tasks: before.tasks.filter((t) => t.milestone === 'ms-1'),
    });
    const d = planDiff(before, after);
    expect(ids(d.milestones.added)).toEqual(['ms-3']);
    expect(ids(d.milestones.removed)).toEqual(['ms-2']);
    expect(d.milestones.changed).toEqual([{ before: milestone('ms-1', 'Menu pages live'), after: milestone('ms-1', 'Menu pages are live') }]);
  });

  it('marks only the milestone that moved, and the one that moved up in a swap', () => {
    const four = plan({ milestones: [milestone('ms-1', 'Menu'), milestone('ms-2', 'Pickup'), milestone('ms-3', 'Launch'), milestone('ms-4', 'Stamps')] });
    const order = (ids: string[]) => plan({ milestones: ids.map((id) => four.milestones.find((m) => m.id === id) ?? milestone(id, id)) });
    expect(planDiff(four, order(['ms-4', 'ms-1', 'ms-2', 'ms-3'])).milestones.moved).toEqual(['ms-4']);
    expect(planDiff(four, order(['ms-2', 'ms-3', 'ms-4', 'ms-1'])).milestones.moved).toEqual(['ms-1']);
    expect(planDiff(four, order(['ms-2', 'ms-1', 'ms-3', 'ms-4'])).milestones.moved).toEqual(['ms-2']);
    // A milestone that moves only changes its place: it isn't changed, added or removed.
    const d = planDiff(four, order(['ms-4', 'ms-1', 'ms-2', 'ms-3']));
    expect([d.milestones.added, d.milestones.removed, d.milestones.changed]).toEqual([[], [], []]);
  });

  it("doesn't count milestones as moved when one is added or removed around them", () => {
    const before = plan();
    expect(planDiff(before, plan({ milestones: [milestone('ms-0', 'Research'), ...before.milestones] })).milestones.moved).toEqual([]);
    expect(planDiff(before, plan({ milestones: [before.milestones[1]!] })).milestones.moved).toEqual([]);
  });

  it('counts a milestone whose done-when changed as changed', () => {
    const after = plan({ milestones: [milestone('ms-1', 'Menu pages live', { doneWhen: 'Every dish has a photo.' }), milestone('ms-2', 'Pickup orders work')] });
    expect(planDiff(plan(), after).milestones.changed.map((c) => c.after.doneWhen)).toEqual(['Every dish has a photo.']);
  });

  it('lists tasks added and removed, keeping their order', () => {
    const before = plan();
    const after = plan({ tasks: [...before.tasks.filter((t) => t.id !== 'p-2'), planTask('p-6', 'Pay with TWINT', { milestone: 'ms-2' }), planTask('p-7', 'Receipts', { milestone: 'ms-2' })] });
    const d = planDiff(before, after);
    expect(ids(d.tasks.added)).toEqual(['p-6', 'p-7']);
    expect(ids(d.tasks.removed)).toEqual(['p-2']);
    expect(d.tasks.moved).toEqual([]);
  });

  it('names the fields that changed on a task, in the order a task has them', () => {
    const before = plan();
    const after = plan({
      tasks: before.tasks.map((t) => (t.id === 'p-3' ? { ...t, doneWhen: 'A customer picks a slot.', title: 'Pickup slot picker', owner: 'qa-engineer' } : t)),
    });
    expect(planDiff(before, after).tasks.changed).toEqual([
      { before: before.tasks[2], after: after.tasks[2], fields: ['title', 'owner', 'doneWhen'] },
    ]);
  });

  it('treats files and what a task waits for as sets: a new order is no change, a new member is', () => {
    const before = plan({ tasks: [planTask('p-1', 'One', { files: ['a/', 'b/'], after: [] }), planTask('p-2', 'Two', { after: ['p-1'] }), planTask('p-3', 'Three', { after: ['p-1', 'p-2'] })] });
    const reordered = plan({ tasks: [planTask('p-1', 'One', { files: ['b/', 'a/'], after: [] }), planTask('p-2', 'Two', { after: ['p-1'] }), planTask('p-3', 'Three', { after: ['p-2', 'p-1'] })] });
    expect(planDiff(before, reordered).tasks.changed).toEqual([]);
    const grown = plan({ tasks: [planTask('p-1', 'One', { files: ['a/', 'b/', 'c/'] }), planTask('p-2', 'Two', { after: [] }), planTask('p-3', 'Three', { after: ['p-1', 'p-2'] })] });
    expect(planDiff(before, grown).tasks.changed.map((c) => [c.after.id, c.fields])).toEqual([
      ['p-1', ['files']],
      ['p-2', ['after']],
    ]);
  });

  it('counts a task moved to another milestone as a change of milestone', () => {
    const before = plan();
    const after = plan({ tasks: before.tasks.map((t) => (t.id === 'p-4' ? { ...t, milestone: 'ms-1' } : t)) });
    expect(planDiff(before, after).tasks.changed.map((c) => [c.after.id, c.fields])).toEqual([['p-4', ['milestone']]]);
  });

  it('keeps a task with the same id as the same task, however much it changed', () => {
    const before = plan();
    const after = plan({ tasks: before.tasks.map((t) => (t.id === 'p-2' ? planTask('p-2', 'Brand new', { owner: 'qa-engineer', files: ['x/'], brief: 'Other', doneWhen: 'Other' }) : t)) });
    const d = planDiff(before, after);
    expect(d.tasks.added).toEqual([]);
    expect(d.tasks.removed).toEqual([]);
    expect(d.tasks.changed[0]?.fields).toEqual(['title', 'owner', 'files', 'brief', 'doneWhen']);
  });

  it('sees a task with a new id as one removed and one added, even with the same title', () => {
    const before = plan();
    const after = plan({ tasks: before.tasks.map((t) => (t.id === 'p-2' ? { ...t, id: 'p-9' } : t)) });
    const d = planDiff(before, after);
    expect(ids(d.tasks.added)).toEqual(['p-9']);
    expect(ids(d.tasks.removed)).toEqual(['p-2']);
  });

  it('marks only the task that moved, not the ones it passed', () => {
    const before = plan();
    expect(planDiff(before, withTasks(before, ['p-5', 'p-1', 'p-2', 'p-3', 'p-4'])).tasks.moved).toEqual(['p-5']);
    expect(planDiff(before, withTasks(before, ['p-2', 'p-3', 'p-4', 'p-5', 'p-1'])).tasks.moved).toEqual(['p-1']);
    expect(planDiff(before, withTasks(before, ['p-1', 'p-4', 'p-2', 'p-3', 'p-5'])).tasks.moved).toEqual(['p-4']);
  });

  it('marks the one of two swapped tasks that moved up, and all but one of a reversed run', () => {
    const before = plan();
    expect(planDiff(before, withTasks(before, ['p-2', 'p-1', 'p-3', 'p-4', 'p-5'])).tasks.moved).toEqual(['p-2']);
    expect(planDiff(before, withTasks(before, ['p-1', 'p-2', 'p-3', 'p-5', 'p-4'])).tasks.moved).toEqual(['p-5']);
    expect(planDiff(before, withTasks(before, ['p-3', 'p-2', 'p-1', 'p-4', 'p-5'])).tasks.moved).toEqual(['p-3', 'p-2']);
  });

  it("doesn't count tasks as moved when one is added or removed around them", () => {
    const before = plan();
    expect(planDiff(before, withTasks(before, ['p-1', 'p-3', 'p-4', 'p-5'])).tasks.moved).toEqual([]);
    expect(planDiff(before, withTasks(before, ['p-9', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5'])).tasks.moved).toEqual([]);
  });

  it('lists moved tasks in their new order', () => {
    const before = plan();
    expect(planDiff(before, withTasks(before, ['p-4', 'p-5', 'p-1', 'p-2', 'p-3'])).tasks.moved).toEqual(['p-4', 'p-5']);
  });

  it('reads a plan with a repeated id by its first copy, without failing', () => {
    const before = plan();
    const twice = plan({ tasks: [...before.tasks, { ...before.tasks[0]!, title: 'A copy' }] });
    const d = planDiff(before, twice);
    expect(d.tasks.added).toEqual([]);
    expect(d.tasks.changed).toEqual([]);
  });

  it("leaves both plans as they were", () => {
    const before = plan();
    const after = withTasks(plan({ goal: 'Other' }), ['p-5', 'p-4', 'p-3', 'p-2', 'p-1']);
    const copies = [structuredClone(before), structuredClone(after)];
    planDiff(before, after);
    expect([before, after]).toEqual(copies);
  });

  it('handles an empty plan on either side', () => {
    const empty: Plan = { goal: '', milestones: [], tasks: [] };
    const d = planDiff(empty, plan());
    expect(ids(d.tasks.added)).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
    expect(ids(d.milestones.added)).toEqual(['ms-1', 'ms-2']);
    expect(planDiff(plan(), empty).tasks.removed).toHaveLength(5);
  });
});

describe('what moved in an order', () => {
  it('finds the fewest moves that turn one order into the other', () => {
    expect(movedInOrder(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toEqual([]);
    expect(movedInOrder(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c'])).toEqual(['d']);
    expect(movedInOrder(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'])).toEqual(['a']);
    expect(movedInOrder(['a', 'b', 'c', 'd', 'e', 'f'], ['d', 'e', 'f', 'a', 'b', 'c'])).toHaveLength(3);
  });

  it('only looks at what both orders hold', () => {
    expect(movedInOrder(['a', 'b', 'x', 'c'], ['y', 'a', 'c', 'b'])).toHaveLength(1);
  });
});

describe('the checklist in the diff (v0.2)', () => {
  const item = (id: string, text: string, covers: string[], quote: string | null = null) => ({ id, text, quote, covers });

  it('is left out when neither version has one, and empty when nothing changed', () => {
    expect(planDiff(plan(), plan())).not.toHaveProperty('checklist');
    const list = [item('k-1', 'Prices show.', ['p-1'])];
    expect(planDiff(plan({ checklist: list }), plan({ checklist: list })).checklist).toEqual({ added: [], removed: [], changed: [] });
  });

  it('lists items added, removed and changed by id, with covers as a set', () => {
    const before = plan({ checklist: [item('k-1', 'Prices show.', ['p-1', 'p-2']), item('k-2', 'Pickup slots.', ['p-3'])] });
    const after = plan({ checklist: [item('k-1', 'Prices show.', ['p-2', 'p-1']), item('k-2', 'Pickup slots of 15 minutes.', ['p-3']), item('k-s1', 'Printable cards.', [])] });
    const d = planDiff(before, after).checklist;
    expect(d?.added.map((k) => k.id)).toEqual(['k-s1']);
    expect(d?.removed).toEqual([]);
    expect(d?.changed.map((c) => [c.before.text, c.after.text])).toEqual([['Pickup slots.', 'Pickup slots of 15 minutes.']]);
    expect(planDiff(after, plan()).checklist?.removed.map((k) => k.id)).toEqual(['k-1', 'k-2', 'k-s1']);
  });

  it('says what changed in clauses, and a cover that went only with its cut task is part of the cut', () => {
    const before = plan({ checklist: [item('k-1', 'Prices show.', ['p-1', 'p-2']), item('k-2', 'Pickup slots.', ['p-3'])] });
    const cut: Plan = { ...before, tasks: before.tasks.filter((t) => t.id !== 'p-2'), checklist: [item('k-1', 'Prices show.', ['p-1']), item('k-2', 'Pickup slots.', ['p-3']), item('k-s1', 'Printable cards.', ['p-1'])] };
    expect(planChanges(before, cut)).toEqual(['cut “Menu photos”', 'added the checklist item “Printable cards.”']);
    const moved: Plan = { ...before, checklist: [item('k-1', 'Prices show.', ['p-1']), item('k-2', 'Pickup slots.', ['p-3', 'p-4'])] };
    expect(planChanges(before, moved)).toEqual(['changed the checklist item “Prices show.”', 'changed the checklist item “Pickup slots.”']);
    expect(planChanges(before, plan())).toEqual(['cut the checklist item “Prices show.”', 'cut the checklist item “Pickup slots.”']);
  });

  it('counts the things the stakeholder asked for in the plan’s summary', () => {
    const version = { version: 2, by: 'ceo', at: 0, plan: plan({ checklist: [item('k-1', 'Prices show.', ['p-1']), item('k-2', 'Pickup slots.', ['p-3'])] }), note: null, cites: [] };
    const summary = planSummaryOf({ version, people: [], size: 'medium', job: null });
    expect(summary.checks).toBe(2);
    expect(summary.words).toContain('It checks 2 things you asked for.');
    const without = planSummaryOf({ version: { ...version, plan: plan() }, people: [], size: 'medium', job: null });
    expect(without.checks).toBe(0);
    expect(without.words).not.toContain('It checks');
  });
});
