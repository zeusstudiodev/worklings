// checkPlan (src/core/plan.ts): what every version of the plan passes, from the CEO's propose_plan or the stakeholder's
// edit, and the plan it gives back.
import { describe, expect, it } from 'vitest';
import { checkPlan, PLAN_BYTES, type PlanCheck } from '../src/core/plan.ts';
import { PLAN_LIMITS, type Plan, type PlanTask } from '../src/core/steering.ts';
import { PEOPLE, rawPlan } from './steering-core-kit.ts';

const ok = (check: PlanCheck): Plan => {
  if (!check.ok) throw new Error(check.errors.join('\n'));
  return check.plan;
};
const errors = (check: PlanCheck): string[] => {
  if (check.ok) throw new Error('The plan was expected to be refused.');
  return check.errors;
};
const task = (id: string, title: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id, title, owner: 'frontend-engineer', files: [], milestone: 'ms-1', after: [], brief: `Brief for ${title}.`, doneWhen: `${title} works.`, ...extra,
});
const withTasks = (tasks: PlanTask[], extra: Partial<Plan> = {}): Plan => rawPlan({ tasks, ...extra });
const fired = [{ id: 'social-media-manager', name: 'Sam', title: 'Social media manager' }];

describe('a plan that checks out', () => {
  it('comes back as it was sent, with folders written as task files are (no trailing slash)', () => {
    const sent = rawPlan();
    const kept = { ...sent, tasks: sent.tasks.map((t) => ({ ...t, files: t.files.map((f) => f.replace(/\/$/, '')) })) };
    expect(ok(checkPlan(sent, PEOPLE))).toEqual(kept);
  });

  it('gives ids to milestones and tasks sent without them, and resolves names to ids', () => {
    const plan = ok(
      checkPlan(
        {
          goal: 'A bilingual café site.',
          milestones: [{ title: 'Menu pages live', doneWhen: 'They read well.' }, { title: 'Launch', doneWhen: 'It is live.' }],
          tasks: [
            { title: 'Menu data', owner: 'Sam', milestone: 'Menu pages live', files: ['./src//menu\\'], brief: 'The menu.', doneWhen: 'Every item is in.' },
            { title: 'Go live', owner: 'ui designer', milestone: 'launch', after: ['menu data'], brief: '', doneWhen: 'It is live.' },
          ],
        },
        PEOPLE,
      ),
    );
    expect(plan.milestones.map((m) => m.id)).toEqual(['ms-1', 'ms-2']);
    expect(plan.tasks.map((t) => [t.id, t.owner, t.milestone, t.after, t.files])).toEqual([
      ['p-1', 'frontend-engineer', 'ms-1', [], ['src/menu']],
      ['p-2', 'ui-designer', 'ms-2', ['p-1'], []],
    ]);
  });

  it('masks secrets and strips control characters from what people wrote', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
    const plan = ok(checkPlan(rawPlan({ goal: `Ship it.\u0007 Use ${secret} for the menu.` }), PEOPLE));
    expect(plan.goal).not.toContain(secret);
    expect(plan.goal).not.toContain('\u0007');
  });

  it('holds 80 tasks and 12 milestones', () => {
    const milestones = Array.from({ length: PLAN_LIMITS.milestones }, (_, i) => ({ id: `ms-${i + 1}`, title: `Stage ${i + 1}`, doneWhen: 'Done.' }));
    const tasks = Array.from({ length: PLAN_LIMITS.tasks }, (_, i) => task(`p-${i + 1}`, `Task ${i + 1}`, { milestone: `ms-${(i % 12) + 1}`, files: [`src/part-${i + 1}/`] }));
    const plan = ok(checkPlan({ goal: 'Big.', milestones, tasks }, PEOPLE));
    expect(plan.tasks).toHaveLength(80);
    expect(plan.milestones).toHaveLength(12);
  });

  it('lets two tasks share files when one waits for the other, directly or through others', () => {
    const tasks = [
      task('p-1', 'Cart', { files: ['src/cart/'] }),
      task('p-2', 'Cart totals', { files: ['src/cart/Totals.tsx'], after: ['p-3'] }),
      task('p-3', 'Cart rows', { after: ['p-1'] }),
    ];
    expect(checkPlan(withTasks(tasks), PEOPLE).ok).toBe(true);
  });
});

describe('a plan that is refused', () => {
  it('refuses something that is no plan at all', () => {
    expect(errors(checkPlan('make it nice', PEOPLE))).toEqual(['A plan is an object with a goal, its milestones and its tasks.']);
  });

  it('refuses an empty plan, saying what it lacks', () => {
    expect(errors(checkPlan({}, PEOPLE))).toEqual([
      'The plan has no goal; say what the company is building.',
      'The plan has no list of milestones; give it at least one, each with a title and when it is done.',
      'The plan has no list of tasks; give each milestone the tasks that finish it.',
    ]);
    expect(errors(checkPlan({ goal: 'x', milestones: [], tasks: [] }, PEOPLE))).toEqual([
      'The plan has no milestones; give it at least one, each with a title and when it is done.',
      'The plan has no tasks; give each milestone the tasks that finish it.',
    ]);
  });

  it('refuses 81 tasks and 13 milestones', () => {
    const tasks = Array.from({ length: 81 }, (_, i) => task(`p-${i + 1}`, `Task ${i + 1}`));
    expect(errors(checkPlan(withTasks(tasks), PEOPLE))).toEqual(['The plan has 81 tasks and holds 80; merge or cut some.']);
    const milestones = Array.from({ length: 13 }, (_, i) => ({ id: `ms-${i + 1}`, title: `Stage ${i + 1}`, doneWhen: 'Done.' }));
    expect(errors(checkPlan(rawPlan({ milestones }), PEOPLE))).toEqual(['The plan has 13 milestones and holds 12; merge some.']);
  });

  it('refuses two tasks that wait for each other, and a longer loop', () => {
    const two = [task('p-1', 'Cart', { after: ['p-2'] }), task('p-2', 'Checkout', { after: ['p-1'] })];
    expect(errors(checkPlan(withTasks(two), PEOPLE))).toEqual(['“Cart” and “Checkout” wait for each other; take one out of the other\'s list.']);
    const three = [task('p-1', 'Cart', { after: ['p-3'] }), task('p-2', 'Checkout', { after: ['p-1'] }), task('p-3', 'Receipt', { after: ['p-2'] })];
    expect(errors(checkPlan(withTasks(three), PEOPLE))).toEqual(['“Cart” waits for itself through “Receipt”, “Checkout”; break the loop.']);
  });

  it('refuses a task that waits for itself or for a task the plan lacks', () => {
    const tasks = [task('p-1', 'Cart', { after: ['p-1', 'p-9'] })];
    expect(errors(checkPlan(withTasks(tasks), PEOPLE))).toEqual([
      '“Cart” waits for itself; take it out of what it waits for.',
      '“Cart” waits for "p-9", which isn\'t a task in the plan; take it out of what it waits for.',
    ]);
  });

  it('refuses a task that waits for one in a later milestone', () => {
    const tasks = [task('p-1', 'Menu', { after: ['p-2'] }), task('p-2', 'Payments', { milestone: 'ms-2' })];
    expect(errors(checkPlan(withTasks(tasks), PEOPLE))).toEqual([
      '“Menu” waits for “Payments”, which comes later, in “Pickup orders work”; move one of them, since a milestone approved on its own would wait for ever.',
    ]);
  });

  it('refuses two tasks that could run at once and change the same files', () => {
    const tasks = [task('p-1', 'Cart', { files: ['src/cart/'] }), task('p-2', 'Cart totals', { files: ['src/Cart/Totals.tsx'], milestone: 'ms-2' })];
    expect(errors(checkPlan(withTasks(tasks), PEOPLE))).toEqual([
      '“Cart” and “Cart totals” both change src/cart and could run at the same time; make one wait for the other, or split the files.',
    ]);
  });

  it('refuses a task for someone who was let go, someone unknown, or a name two people share', () => {
    const kai = PEOPLE.find((p) => p.id === 'ui-designer');
    const people = kai ? [...PEOPLE, { ...kai, id: 'ui-designer-2' }] : PEOPLE;
    const tasks = [
      task('p-1', 'Posts', { owner: 'social-media-manager' }),
      task('p-2', 'Wiring', { owner: 'electrician' }),
      task('p-3', 'Icons', { owner: 'Kai' }),
      task('p-4', 'Nobody', { owner: '' }),
    ];
    expect(errors(checkPlan(withTasks(tasks), people, { fired }))).toEqual([
      '“Posts” is for Sam, who was let go; give it to someone in the company.',
      '“Wiring” is for "electrician", who isn\'t in the company; give it to someone who is.',
      '“Icons” is for "Kai", and 2 people go by that; name one of them by id (ui-designer, ui-designer-2).',
      '“Nobody” has no owner; say who does it.',
    ]);
  });

  it('refuses paths outside the project, in git or Worklings folders, and too many of them', () => {
    const tasks = [
      task('p-1', 'A', { files: ['C:\\Users\\jamie\\notes.txt'] }),
      task('p-2', 'B', { files: ['../other/app.ts'] }),
      task('p-3', 'C', { files: ['.git/hooks/pre-commit'] }),
      task('p-4', 'D', { files: ['.worklings/events.jsonl'] }),
      task('p-5', 'E', { files: Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`) }),
      task('p-6', 'F', { files: ['src/a:b.ts'] }),
    ];
    expect(errors(checkPlan(withTasks(tasks), PEOPLE))).toEqual([
      '“A” names "C:\\Users\\jamie\\notes.txt", an absolute path; name files relative to the project, like src/app.ts.',
      '“B” names "../other/app.ts", which leaves the project; name files inside it.',
      '“C” names ".git/hooks/pre-commit", git\'s or Worklings\' own folder, which no task owns.',
      '“D” names ".worklings/events.jsonl", git\'s or Worklings\' own folder, which no task owns.',
      '“E” names 51 files; keep it to 50, since a folder covers what\'s in it.',
      '“F” names "src/a:b.ts", which has a character a project path can\'t have.',
    ]);
  });

  it('refuses text over its limits, naming what to shorten', () => {
    const tasks = [task('p-1', 'x'.repeat(121), { brief: 'b'.repeat(4001), doneWhen: 'd'.repeat(1001), after: Array.from({ length: 13 }, () => 'p-1') })];
    const found = errors(checkPlan(withTasks(tasks, { goal: 'g'.repeat(1001) }), PEOPLE));
    expect(found).toContain('The goal is 1,001 characters; the limit is 1,000: cut about 30.');
    expect(found.some((e) => /The title of “x+…” is 121 characters; the limit is 120: cut about 10\./.test(e))).toBe(true);
    expect(found.some((e) => /The brief of .* is 4,001 characters; the limit is 4,000: cut about 40\./.test(e))).toBe(true);
    expect(found.some((e) => /What marks .* done is 1,001 characters; the limit is 1,000: cut about 30\./.test(e))).toBe(true);
    expect(found.some((e) => e.endsWith('waits for 13 tasks; it can wait for 12 at most.'))).toBe(true);
  });

  it('refuses a plan too big for one line of the log', () => {
    const tasks = Array.from({ length: 40 }, (_, i) => task(`p-${i + 1}`, `Task ${i + 1}`, { brief: 'ö'.repeat(1800), doneWhen: 'é'.repeat(900) }));
    const found = errors(checkPlan(withTasks(tasks), PEOPLE));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(new RegExp(`^The plan is \\d+ KB, and a plan holds ${PLAN_BYTES / 1024} KB; shorten the briefs\\.$`));
  });

  it('refuses a task in a milestone the plan lacks, and one without a done-when', () => {
    const tasks = [task('p-1', 'Menu', { milestone: 'ms-9' }), task('p-2', 'Cart', { doneWhen: '  ' })];
    expect(errors(checkPlan(withTasks(tasks), PEOPLE))).toEqual([
      '“Menu” is in the milestone "ms-9", which the plan doesn\'t have; put it in one it does.',
      '“Cart” doesn\'t say when it is done; say when, so its owner knows when to stop.',
    ]);
  });

  it('refuses two tasks or milestones with the same id', () => {
    const tasks = [task('p-1', 'Menu'), task('p-1', 'Cart')];
    expect(errors(checkPlan(withTasks(tasks), PEOPLE))).toEqual(['Two tasks have the id p-1; give each its own.']);
    const milestones = [{ id: 'ms-1', title: 'A', doneWhen: 'a' }, { id: 'ms-1', title: 'B', doneWhen: 'b' }];
    expect(errors(checkPlan(rawPlan({ milestones, tasks: [task('p-1', 'Menu')] }), PEOPLE))).toEqual(['Two milestones have the id ms-1; give each its own.']);
  });
});

describe('ids across versions', () => {
  it('keeps the id a title had in the latest version when a task comes without one', () => {
    const earlier = [rawPlan()];
    const next = ok(
      checkPlan(
        {
          ...rawPlan(),
          tasks: rawPlan().tasks.map(({ id: _id, ...rest }) => rest).concat([{ title: 'Receipt', owner: 'backend-engineer', files: ['api/receipts/'], milestone: 'ms-2', after: [], brief: '', doneWhen: 'Sent.' }]),
        },
        PEOPLE,
        { earlier },
      ),
    );
    expect(next.tasks.map((t) => t.id)).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6']);
  });

  it('never gives a new task an id an earlier version used', () => {
    const earlier = [rawPlan(), rawPlan({ tasks: rawPlan().tasks.slice(0, 2) })];
    const next = ok(checkPlan(withTasks([task('p-1', 'Menu data'), { ...task('', 'Brand new'), id: '' }]), PEOPLE, { earlier }));
    expect(next.tasks.map((t) => t.id)).toEqual(['p-1', 'p-6']);
  });

  it('keeps any id the propose_plan tool takes, up to 64 letters, digits, hyphens and underscores', () => {
    const long = `p_${'x'.repeat(62)}`;
    const plan = ok(checkPlan(withTasks([task(long, 'Menu'), task('p-2-', 'Cart', { after: [long] })]), PEOPLE));
    expect(plan.tasks.map((t) => [t.id, t.after])).toEqual([[long, []], ['p-2-', [long]]]);
  });

  it("keeps the stakeholder's own ids, like p-s1 and ms-launch", () => {
    const plan = ok(checkPlan(rawPlan({ milestones: [{ id: 'ms-launch', title: 'Launch', doneWhen: 'Live.' }], tasks: [task('p-s1', 'Go live', { milestone: 'ms-launch' })] }), PEOPLE));
    expect([plan.milestones[0]?.id, plan.tasks[0]?.id]).toEqual(['ms-launch', 'p-s1']);
  });
});
