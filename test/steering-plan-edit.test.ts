import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/core/steering.ts';
import {
  applyOp,
  checkDraft,
  describeOp,
  draftFrom,
  EMPTY_DRAFT,
  filesFrom,
  filesProblems,
  MAX_OPS,
  milestoneMove,
  newItemId,
  newMilestoneId,
  newTaskId,
  outsideProject,
  type PlanOp,
  replay,
  sharePath,
  taskDrop,
  taskMove,
  taskPlace,
  tasksIn,
} from '../web/src/company/plan/planEdit.ts';
import { cafePeople } from './panels-work-kit.ts';
import { milestone, plan, planTask } from './steering-plan-kit.ts';

const order = (p: Plan) => p.tasks.map((t) => t.id);
const inMilestone = (p: Plan, m: string) => tasksIn(p, m).map((t) => t.id);
const apply = (p: Plan, op: PlanOp | null): Plan => {
  if (!op) throw new Error('expected a change');
  const result = applyOp(p, op);
  if (!result.ok) throw new Error(result.why);
  return result.plan;
};

describe('moving a task with the buttons', () => {
  it('moves it up and down within its milestone, and to its top and bottom', () => {
    const p = plan();
    expect(inMilestone(apply(p, taskMove(p, 'p-4', 'up')), 'ms-2')).toEqual(['p-4', 'p-3', 'p-5']);
    expect(inMilestone(apply(p, taskMove(p, 'p-3', 'down')), 'ms-2')).toEqual(['p-4', 'p-3', 'p-5']);
    expect(inMilestone(apply(p, taskMove(p, 'p-5', 'top')), 'ms-2')).toEqual(['p-5', 'p-3', 'p-4']);
    expect(inMilestone(apply(p, taskMove(p, 'p-3', 'bottom')), 'ms-2')).toEqual(['p-4', 'p-5', 'p-3']);
  });

  it('offers no move past the edge of its milestone', () => {
    const p = plan();
    expect(taskMove(p, 'p-3', 'up')).toBeNull();
    expect(taskMove(p, 'p-3', 'top')).toBeNull();
    expect(taskMove(p, 'p-5', 'down')).toBeNull();
    expect(taskMove(p, 'p-1', 'up')).toBeNull();
    expect(taskMove(p, 'p-9', 'down')).toBeNull();
  });

  it('keeps the rest of the order as it was', () => {
    const p = plan();
    expect(order(apply(p, taskMove(p, 'p-2', 'up')))).toEqual(['p-2', 'p-1', 'p-3', 'p-4', 'p-5']);
  });
});

describe('moving a task by dropping it', () => {
  it('moves it into another milestone, before a task there', () => {
    const p = plan();
    const after = apply(p, taskDrop(p, 'p-4', { milestone: 'ms-1', before: 'p-2' }));
    expect(order(after)).toEqual(['p-1', 'p-4', 'p-2', 'p-3', 'p-5']);
    expect(after.tasks.find((t) => t.id === 'p-4')?.milestone).toBe('ms-1');
  });

  it("moves it to the end of a milestone, before the next milestone's tasks", () => {
    const p = plan();
    expect(order(apply(p, taskDrop(p, 'p-5', { milestone: 'ms-1', before: null })))).toEqual(['p-1', 'p-2', 'p-5', 'p-3', 'p-4']);
  });

  it('puts a task in an empty milestone where that milestone falls in the order', () => {
    const p = plan({ milestones: [milestone('ms-1', 'Menu pages live'), milestone('ms-3', 'Photos'), milestone('ms-2', 'Pickup orders work')] });
    const after = apply(p, taskDrop(p, 'p-5', { milestone: 'ms-3', before: null }));
    expect(order(after)).toEqual(['p-1', 'p-2', 'p-5', 'p-3', 'p-4']);
  });

  it('is no change when it lands where it is', () => {
    const p = plan();
    expect(taskDrop(p, 'p-3', { milestone: 'ms-2', before: 'p-3' })).toBeNull();
    expect(taskDrop(p, 'p-3', { milestone: 'ms-2', before: 'p-4' })).toBeNull();
    expect(taskDrop(p, 'p-5', { milestone: 'ms-2', before: null })).toBeNull();
    expect(taskDrop(p, 'p-5', { milestone: 'ms-9', before: null })).toBeNull();
  });
});

describe('moving a milestone', () => {
  it('takes its tasks along, so the order work is handed out in follows the milestones', () => {
    const p = plan();
    const after = apply(p, milestoneMove(p, 'ms-2', 'up'));
    expect(after.milestones.map((m) => m.id)).toEqual(['ms-2', 'ms-1']);
    expect(order(after)).toEqual(['p-3', 'p-4', 'p-5', 'p-1', 'p-2']);
    expect(order(apply(p, milestoneMove(p, 'ms-1', 'down')))).toEqual(['p-3', 'p-4', 'p-5', 'p-1', 'p-2']);
  });

  it('offers no move past the first or last', () => {
    const p = plan();
    expect(milestoneMove(p, 'ms-1', 'up')).toBeNull();
    expect(milestoneMove(p, 'ms-2', 'down')).toBeNull();
  });
});

describe('cutting', () => {
  it('cuts a task, and what waited for it no longer does', () => {
    const p = plan();
    const op: PlanOp = { op: 'cut-task', id: 'p-3', name: 'Slot picker' };
    const after = apply(p, op);
    expect(order(after)).toEqual(['p-1', 'p-2', 'p-4', 'p-5']);
    expect(after.tasks.find((t) => t.id === 'p-5')?.after).toEqual(['p-4']);
    expect(describeOp(p, after, op)).toBe('Cut “Slot picker”. “Order tests” no longer waits for it.');
  });

  it('cuts a milestone with its tasks', () => {
    const p = plan();
    const op: PlanOp = { op: 'cut-milestone', id: 'ms-1', name: 'Menu pages live' };
    const after = apply(p, op);
    expect(after.milestones.map((m) => m.id)).toEqual(['ms-2']);
    expect(order(after)).toEqual(['p-3', 'p-4', 'p-5']);
    expect(after.tasks.find((t) => t.id === 'p-3')?.after).toEqual([]);
    expect(describeOp(p, after, op)).toBe('Cut the milestone “Menu pages live” and its two tasks.');
  });
});

describe('editing and adding', () => {
  it('changes any field of a task', () => {
    const p = plan();
    const after = apply(p, { op: 'edit-task', id: 'p-4', name: 'Cart', set: { title: 'Cart and checkout', owner: 'qa-engineer', files: ['src/cart/', 'src/checkout/'], after: ['p-3'], brief: 'New brief', doneWhen: 'Checkout works.' } });
    expect(after.tasks.find((t) => t.id === 'p-4')).toEqual(planTask('p-4', 'Cart and checkout', { owner: 'qa-engineer', milestone: 'ms-2', files: ['src/cart/', 'src/checkout/'], after: ['p-3'], brief: 'New brief', doneWhen: 'Checkout works.' }));
  });

  it('moves a task to the end of the milestone you change it to', () => {
    const p = plan();
    const op: PlanOp = { op: 'edit-task', id: 'p-3', name: 'Slot picker', set: { milestone: 'ms-1' } };
    const after = apply(p, op);
    expect(order(after)).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
    expect(inMilestone(after, 'ms-1')).toEqual(['p-1', 'p-2', 'p-3']);
    expect(describeOp(p, after, op)).toBe('Changed “Slot picker”, now in “Menu pages live”.');
  });

  it('adds a task at the end of its milestone or before a task in it', () => {
    const p = plan();
    const task = planTask('p-s1', 'Pay with TWINT', { milestone: 'ms-2' });
    expect(order(apply(p, { op: 'add-task', task, before: null }))).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-s1']);
    expect(order(apply(p, { op: 'add-task', task, before: 'p-4' }))).toEqual(['p-1', 'p-2', 'p-3', 'p-s1', 'p-4', 'p-5']);
  });

  it('adds a milestone at the end or before another', () => {
    const p = plan();
    const m = milestone('ms-s1', 'Launch');
    expect(apply(p, { op: 'add-milestone', milestone: m, before: null }).milestones.map((x) => x.id)).toEqual(['ms-1', 'ms-2', 'ms-s1']);
    expect(apply(p, { op: 'add-milestone', milestone: m, before: 'ms-2' }).milestones.map((x) => x.id)).toEqual(['ms-1', 'ms-s1', 'ms-2']);
  });

  it('changes the goal and a milestone', () => {
    const p = plan();
    expect(apply(p, { op: 'goal', goal: 'Order ahead.' }).goal).toBe('Order ahead.');
    expect(apply(p, { op: 'edit-milestone', id: 'ms-2', name: 'Pickup orders work', set: { doneWhen: 'A test order is picked up.' } }).milestones[1]?.doneWhen).toBe('A test order is picked up.');
  });

  it('says where a moved task is now', () => {
    const p = plan();
    const op = taskMove(p, 'p-5', 'up');
    expect(op && describeOp(p, apply(p, op), op)).toBe('Moved “Order tests”: second of three in “Pickup orders work”.');
    expect(taskPlace(p, 'p-4')).toBe('Second of three in “Pickup orders work”.');
  });

  it('numbers your new tasks and milestones on their own, past any version that used the number', () => {
    expect(newTaskId([plan()])).toBe('p-s1');
    expect(newTaskId([plan(), plan({ tasks: [planTask('p-s2', 'Yours')] })])).toBe('p-s3');
    expect(newMilestoneId([plan({ milestones: [milestone('ms-s4', 'Yours')] })])).toBe('ms-s5');
  });
});

describe('your changes on a new version', () => {
  it('applies them on top of the CEO’s new version', () => {
    const p = plan();
    const ops: PlanOp[] = [taskMove(p, 'p-4', 'up')!, { op: 'cut-task', id: 'p-2', name: 'Menu photos' }];
    const newer = plan({ tasks: [...p.tasks, planTask('p-6', 'Receipts', { milestone: 'ms-2' })] });
    const result = replay(newer, ops);
    expect(result.dropped).toEqual([]);
    expect(order(result.plan)).toEqual(['p-1', 'p-4', 'p-3', 'p-5', 'p-6']);
  });

  it('drops a change to a task the new version cut, saying which', () => {
    const p = plan();
    const ops: PlanOp[] = [taskMove(p, 'p-4', 'up')!, taskMove(p, 'p-2', 'up')!];
    const newer = plan({ tasks: p.tasks.filter((t) => t.id !== 'p-4') });
    const result = replay(newer, ops);
    expect(result.dropped.map((d) => d.why)).toEqual(["“Cart” isn't in the plan any more."]);
    expect(order(result.plan)).toEqual(['p-2', 'p-1', 'p-3', 'p-5']);
  });

  it('drops a task you added whose id the new version took, and every later change to it', () => {
    const p = plan();
    const yours = planTask('p-s1', 'Pay with TWINT', { milestone: 'ms-2' });
    const ops: PlanOp[] = [
      { op: 'add-task', task: yours, before: null },
      { op: 'edit-task', id: 'p-s1', name: 'Pay with TWINT', set: { title: 'Pay with TWINT or card' } },
      { op: 'cut-task', id: 'p-s1', name: 'Pay with TWINT or card' },
    ];
    const theirs = planTask('p-s1', 'The CEO’s own task', { milestone: 'ms-2' });
    const newer = plan({ tasks: [...p.tasks, theirs] });
    const result = replay(newer, ops);
    expect(result.dropped).toHaveLength(3);
    expect(result.plan.tasks.find((t) => t.id === 'p-s1')).toEqual(theirs);
  });

  it('changes nothing with no changes', () => {
    const p = plan();
    expect(replay(p, [])).toEqual({ plan: p, dropped: [] });
  });
});

describe('what stops a save', () => {
  // The rules are the office's own check (src/core/plan.ts, tested in steering-plan-check): these show the panel asks it.
  it('passes the café plan', () => {
    expect(checkDraft(plan(), cafePeople())).toEqual([]);
  });

  it("says what is wrong in the office's own words", () => {
    expect(checkDraft(plan({ goal: '  ' }), cafePeople())).toEqual(['The plan has no goal; say what the company is building.']);
    const later = plan({ tasks: [planTask('p-1', 'Menu data', { after: ['p-3'] }), planTask('p-3', 'Slot picker', { milestone: 'ms-2' })] });
    expect(checkDraft(later, cafePeople())[0]).toMatch(/^“Menu data” waits for “Slot picker”, which comes later, in “Pickup orders work”/);
    const stranger = plan({ tasks: [planTask('p-1', 'Menu data', { owner: 'payments-engineer' })] });
    expect(checkDraft(stranger, cafePeople())[0]).toMatch(/^“Menu data” is for "payments-engineer", who isn't in the company/);
  });

  it('lets two tasks name the same file only when one waits for the other', () => {
    const apart = plan({ tasks: [planTask('p-1', 'Menu data', { files: ['src/menu/'] }), planTask('p-2', 'Menu photos', { files: ['SRC\\Menu\\photos.ts'] })] });
    expect(checkDraft(apart, cafePeople())[0]).toMatch(/^“Menu data” and “Menu photos” both change/);
    const inTurn = plan({ tasks: [planTask('p-1', 'Menu data', { files: ['src/menu/'] }), planTask('p-2', 'Menu photos', { files: ['src/menu/photos.ts'], after: ['p-1'] })] });
    expect(checkDraft(inTurn, cafePeople())).toEqual([]);
  });

  it('counts the versions before as taken ids, so your new task keeps its own', () => {
    const before = plan();
    const yours = plan({ tasks: [...before.tasks, planTask('p-s1', 'Pay with TWINT', { milestone: 'ms-2' })] });
    expect(checkDraft(yours, cafePeople(), [before])).toEqual([]);
  });
});

describe("a form's own file checks", () => {
  it('keeps files inside the project', () => {
    for (const path of ['/etc/passwd', 'C:\\Windows', 'c:/x', '..\\up', 'src/../../x', '~/notes', 'D:relative']) expect(outsideProject(path)).toBe(true);
    for (const path of ['src/cart/', 'public\\photos', '.github/workflows/ci.yml', 'a..b/file']) expect(outsideProject(path)).toBe(false);
    expect(filesProblems(['../secrets'], 'This task')).toEqual(['This task names ../secrets. Files are relative to the project, like src/cart/.']);
  });

  it("keeps files out of git's and Worklings' own folders, and away from odd characters", () => {
    expect(filesProblems(['./.git/hooks/'], 'This task')).toEqual(["This task names ./.git/hooks/: that is git's or Worklings' own folder, which no task owns."]);
    expect(filesProblems(['src/.git/x'], 'This task')).toHaveLength(1);
    expect(filesProblems(['src/a:b.ts'], 'This task')).toEqual(["This task names src/a:b.ts, which has a character a project path can't have."]);
    expect(filesProblems(['src/.github/'], 'This task')).toEqual([]);
  });

  it('holds a task to its number of files and the length of a path', () => {
    expect(filesProblems(Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`), 'This task')).toEqual(["This task names 51 files. Keep it to 50; a folder covers what's in it."]);
    expect(filesProblems([`src/${'x'.repeat(300)}`], 'This task')).toEqual(['This task names a path of 304 characters. Keep paths to 300.']);
  });

  it('sees the same file through Windows separators and case', () => {
    expect(sharePath('src/cart/', 'SRC\\Cart\\Cart.tsx')).toBe(true);
    expect(sharePath('./src/a.ts', 'src/a.ts')).toBe(true);
    expect(sharePath('src/cart', 'src/cartography')).toBe(false);
  });
});

describe('files as typed', () => {
  it('takes one per line, trimmed, without blanks or repeats', () => {
    expect(filesFrom(' src/cart/ \r\n\nsrc/cart/\npublic/photos/\n  ')).toEqual(['src/cart/', 'public/photos/']);
    expect(filesFrom('')).toEqual([]);
  });
});

describe('a draft kept in the tab', () => {
  it('reads back what it wrote', () => {
    const p = plan();
    const draft = { ops: [taskMove(p, 'p-4', 'up')!, { op: 'cut-task', id: 'p-2', name: 'Menu photos' } as PlanOp, { op: 'add-task', task: planTask('p-s1', 'New'), before: null } as PlanOp], note: 'Cart first.' };
    expect(draftFrom(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it('is no draft when what it finds is something else, and drops changes it can’t read', () => {
    for (const junk of [null, 'ops', 42, [], { ops: 'x', note: '' }, { ops: [] }]) expect(draftFrom(junk)).toEqual(EMPTY_DRAFT);
    const mixed = { ops: [{ op: 'cut-task', id: 'p-1', name: 'Menu data' }, { op: 'cut-task', id: 3 }, { op: 'explode' }, { op: 'edit-task', id: 'p-1', name: 'x', set: { __proto__: 'x', owner: 'kai' } }, { op: 'edit-task', id: 'p-1', name: 'x', set: { evil: true } }], note: 'n' };
    expect(draftFrom(mixed).ops).toEqual([{ op: 'cut-task', id: 'p-1', name: 'Menu data' }, { op: 'edit-task', id: 'p-1', name: 'x', set: { owner: 'kai' } }]);
  });

  it(`keeps the last ${MAX_OPS} changes`, () => {
    const ops = Array.from({ length: MAX_OPS + 5 }, (_, i) => ({ op: 'goal', goal: `Goal ${i}` }));
    const read = draftFrom({ ops, note: '' });
    expect(read.ops).toHaveLength(MAX_OPS);
    expect(read.ops[0]).toEqual({ op: 'goal', goal: 'Goal 5' });
  });
});

describe('the checklist in the plan (v0.2)', () => {
  const withList = (): Plan =>
    plan({
      checklist: [
        { id: 'k-1', text: 'Guests read the menu.', quote: 'read the menu', covers: ['p-1', 'p-2'] },
        { id: 'k-2', text: 'Guests order for pickup.', quote: null, covers: ['p-3', 'p-4'] },
      ],
    });
  const items = (p: Plan) => (p.checklist ?? []).map((k) => [k.id, k.covers]);

  it('adds your own item with a k-s id, keeping only covers that are tasks of the plan', () => {
    const p = withList();
    const id = newItemId([p]);
    expect(id).toBe('k-s1');
    const after = apply(p, { op: 'add-item', item: { id, text: 'Pay with TWINT.', quote: null, covers: ['p-4', 'p-99'] }, before: 'k-2' });
    expect(items(after)).toEqual([['k-1', ['p-1', 'p-2']], ['k-s1', ['p-4']], ['k-2', ['p-3', 'p-4']]]);
    expect(newItemId([p, after])).toBe('k-s2');
    expect(describeOp(p, after, { op: 'add-item', item: { id, text: 'Pay with TWINT.', quote: null, covers: [] }, before: null })).toBe('Added “Pay with TWINT.” to the checklist; no task covers it yet.');
  });

  it('edits the sentence and what covers it, leaves the quote as written, and removes an item', () => {
    const p = withList();
    const edited = apply(p, { op: 'edit-item', id: 'k-1', name: 'Guests read the menu.', set: { text: 'Guests read the menu on a phone.', covers: ['p-1'] } });
    expect(edited.checklist?.[0]).toEqual({ id: 'k-1', text: 'Guests read the menu on a phone.', quote: 'read the menu', covers: ['p-1'] });
    const cut = apply(p, { op: 'cut-item', id: 'k-2', name: 'Guests order for pickup.' });
    expect(items(cut)).toEqual([['k-1', ['p-1', 'p-2']]]);
    expect(describeOp(p, cut, { op: 'cut-item', id: 'k-2', name: 'Guests order for pickup.' })).toBe('Took “Guests order for pickup.” off the checklist.');
    expect(applyOp(cut, { op: 'cut-item', id: 'k-2', name: 'Guests order for pickup.' })).toEqual({ ok: false, why: 'The checklist item “Guests order for pickup.” isn\'t in the plan any more.' });
  });

  it('drops a cut task from every item it covered, and a cut milestone’s tasks too', () => {
    const p = withList();
    expect(items(apply(p, { op: 'cut-task', id: 'p-2', name: 'Menu photos' }))).toEqual([['k-1', ['p-1']], ['k-2', ['p-3', 'p-4']]]);
    const noPickup = apply(p, { op: 'cut-milestone', id: 'ms-2', name: 'Pickup orders work' });
    expect(items(noPickup)).toEqual([['k-1', ['p-1', 'p-2']], ['k-2', []]]);
    expect(describeOp(noPickup, apply(noPickup, { op: 'edit-item', id: 'k-2', name: 'Guests order for pickup.', set: { text: 'Guests order ahead.' } }), { op: 'edit-item', id: 'k-2', name: 'Guests order for pickup.', set: { text: 'Guests order ahead.' } })).toBe(
      'Changed the checklist item “Guests order ahead.”; no task covers it now.',
    );
    // A plan saved before the checklist keeps none when a task goes.
    expect(apply(plan(), { op: 'cut-task', id: 'p-2', name: 'Menu photos' }).checklist).toBeUndefined();
  });

  it('drops a change to an item an earlier change added once that addition no longer applies', () => {
    const p = withList();
    const ops: PlanOp[] = [
      { op: 'add-item', item: { id: 'k-1', text: 'Twice.', quote: null, covers: [] }, before: null },
      { op: 'edit-item', id: 'k-1', name: 'Guests read the menu.', set: { text: 'Still applies.' } },
    ];
    const { plan: after, dropped } = replay(p, ops);
    expect(dropped.map((d) => d.op.op)).toEqual(['add-item', 'edit-item']);
    expect(after.checklist?.[0]?.text).toBe('Guests read the menu.');
  });

  it('reads the checklist changes back from a kept draft, and nothing malformed', () => {
    const draft = {
      ops: [
        { op: 'add-item', item: { id: 'k-s1', text: 'Pay with TWINT.', quote: null, covers: ['p-4'] }, before: null },
        { op: 'edit-item', id: 'k-1', name: 'Guests read the menu.', set: { covers: ['p-1'] } },
        { op: 'cut-item', id: 'k-2', name: 'Guests order for pickup.' },
      ] as PlanOp[],
      note: '',
    };
    expect(draftFrom(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    const junk = [{ op: 'add-item', item: { id: 'k-s1', text: 'x' } }, { op: 'edit-item', id: 'k-1', name: 'x', set: { quote: 'changed' } }, { op: 'cut-item', id: 3 }];
    expect(draftFrom({ ops: junk, note: '' }).ops).toEqual([]);
  });
});
