// The plan linter (v0.2, SPEC-v0.2.md "Better by design", 2): what the CEO's propose_plan is refused for, in code, each
// refusal naming its task and the fix, all together. The stakeholder's own edit and plans saved by 0.1.0 are untouched.
import { describe, expect, it } from 'vitest';
import { checkPlan, FINAL_REVIEW, type PlanCheck, type PlanPerson } from '../src/core/plan.ts';
import { areaOf, areasOf, commandProblem, isDocsOnly, isTestsOnly, requirementsIn, TASK_LIMITS } from '../src/core/plan-lint.ts';
import type { PresetId } from '../src/core/presets.ts';
import { makersIn, type Size, taskCap } from '../src/core/size.ts';
import type { Plan, PlanTask } from '../src/core/steering.ts';

const PEOPLE: PlanPerson[] = [
  { id: 'ceo', name: 'Noor', title: 'CEO', level: 'ceo' },
  { id: 'frontend-engineer', name: 'Sam', title: 'Frontend engineer', level: 'worker' },
  { id: 'backend-engineer', name: 'Ivo', title: 'Backend engineer', level: 'worker' },
  { id: 'ui-designer', name: 'Kai', title: 'UI designer', level: 'worker' },
];
/** A company with a checker seat, as a Thorough one has. */
const WITH_QA: PlanPerson[] = [...PEOPLE, { id: 'qa-engineer', name: 'Tom', title: 'QA engineer', level: 'worker' }];

const task = (id: string, title: string, owner: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id, title, owner, files: [`src/${id}/`], milestone: 'ms-1', after: [], brief: `Build ${title}, with its tests.`, doneWhen: `${title} works.`, check: 'npm test', ...extra,
});
const verification = (extra: Partial<PlanTask> = {}): PlanTask =>
  ({ id: 'p-9', title: 'Review the whole result', owner: 'ceo', files: [], milestone: 'ms-2', after: ['p-1', 'p-2'], brief: 'Review the whole diff.', doneWhen: 'Each requirement from stakeholder_words has a result.', kind: 'verification', ...extra });
const plan = (tasks: PlanTask[], extra: Partial<Plan> = {}): Plan => ({
  goal: 'A small app.',
  milestones: [
    { id: 'ms-1', title: 'Built', doneWhen: 'It works.' },
    { id: 'ms-2', title: 'Reviewed', doneWhen: 'It is reviewed.' },
  ],
  tasks,
  ...extra,
});
/** A plan as the linter likes it, for a medium company: two makers' tasks and the final review. */
const good = (): PlanTask[] => [task('p-1', 'The screens', 'frontend-engineer'), task('p-2', 'The data layer', 'backend-engineer'), verification()];

const ceoCheck = (raw: unknown, size?: Size, people = PEOPLE): PlanCheck => checkPlan(raw, people, { structure: true, ...(size ? { size } : {}) });
const errorsOf = (raw: unknown, size?: Size, people = PEOPLE): string[] => {
  const result = ceoCheck(raw, size, people);
  return result.ok ? [] : result.errors;
};
const anyOf = (list: string[], text: string): boolean => list.some((e) => e.includes(text));

describe('a plan that passes', () => {
  it('has checks on its makers’ tasks and, in a medium company, one final verification by the CEO', () => {
    expect(errorsOf(plan(good()), 'medium')).toEqual([]);
    expect(errorsOf(plan(good()), 'large')).toEqual([]);
  });

  it('keeps each task’s check in the plan, and the plan check without one', () => {
    const result = ceoCheck(plan(good()), 'medium');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.plan.tasks.map((t) => t.check)).toEqual(['npm test', 'npm test', undefined]);
  });
});

describe('(a) a task that is only tests of another task’s work', () => {
  it.each([
    ['by its title', task('p-3', 'Write tests for the screens', 'frontend-engineer', { files: ['src/p-3/'], after: ['p-1'] })],
    ['by a title that starts with the tests', task('p-3', 'Unit tests', 'frontend-engineer', { after: ['p-1'] })],
    ['by a title that ends in them', task('p-3', 'Cart tests', 'frontend-engineer', { after: ['p-1'] })],
    ['by a QA title', task('p-3', 'QA the checkout', 'frontend-engineer', { after: ['p-1'] })],
    ['by its files', task('p-3', 'Cart coverage', 'frontend-engineer', { files: ['test/cart/', 'src/cart.test.ts'], after: ['p-1'] })],
    ['by its brief, with no files', task('p-3', 'Cart coverage', 'frontend-engineer', { files: [], brief: 'Write unit tests for the cart and its totals.' })],
  ])('is refused %s, with the task it probably tests and the fix', (_how, t) => {
    const errors = errorsOf(plan([...good().slice(0, 2), t, verification({ after: ['p-1', 'p-2', 'p-3'] })]), 'medium');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`(p-3) is only tests of another task's work; fold it into the task it tests`);
    expect(errors[0]).toContain('so one owner builds and tests it together, and remove this task');
  });

  it('names the task it waits for as the one to fold into', () => {
    const errors = errorsOf(plan([...good().slice(0, 2), task('p-3', 'Write tests for the screens', 'frontend-engineer', { after: ['p-1'] }), verification({ after: ['p-1', 'p-2', 'p-3'] })]), 'medium');
    expect(errors[0]).toBe(
      '“Write tests for the screens” (p-3) is only tests of another task\'s work; fold it into the task it tests, probably “The screens” (p-1), so one owner builds and tests it together, and remove this task. A task that really integrates or verifies the whole has kind "integration" or "verification".',
    );
  });

  it('passes a task that builds and tests, whatever its title says about tests', () => {
    for (const title of ['The cart and its tests', 'Cart page with tests', 'Checkout flow, tested on a phone']) {
      expect(isTestsOnly({ title, brief: `Build ${title}.`, files: ['src/cart/'], kind: undefined })).toBe(false);
    }
    expect(isTestsOnly({ title: 'Write tests for the cart', brief: '', files: ['src/cart/'], kind: undefined })).toBe(true);
  });

  it('lets a verification or integration task be about the whole', () => {
    expect(isTestsOnly({ title: 'Run the tests for everything', brief: '', files: ['test/'], kind: 'verification' })).toBe(false);
    expect(isTestsOnly({ title: 'Test the parts together', brief: '', files: ['test/'], kind: 'integration' })).toBe(false);
  });
});

describe('(b) a task with no check', () => {
  it('is refused for a maker’s task, with the fix and an example', () => {
    const { check: _check, ...bare } = task('p-1', 'The screens', 'frontend-engineer');
    const errors = errorsOf(plan([bare, good()[1] as PlanTask, verification()]), 'medium');
    expect(errors).toEqual(['“The screens” (p-1) has no check; give it one command the office can run to see it is done, in check, like "npm test", "npm run typecheck && npm test" or "node --test".']);
  });

  it('is not asked for the CEO’s own task, a checker’s or the final verification', () => {
    const tasks = [...good().slice(0, 2), task('p-8', 'Review the usability', 'qa-engineer', { check: undefined, files: [] }), verification({ owner: 'qa-engineer', after: ['p-1', 'p-2', 'p-8'] })];
    expect(errorsOf(plan(tasks), 'medium', WITH_QA)).toEqual([]);
  });

  it.each([
    ['one over two lines', 'npm test\nnpm run lint', 'has more than one line'],
    ['a pipe', 'npm test | tail -5', 'has a pipe, a redirect, a substitution or a background marker'],
    ['a redirect', 'npm test > out.txt', 'has a pipe'],
    ['a substitution', 'echo $(whoami)', 'has a pipe'],
    ['a semicolon', 'npm test; rm -rf /', 'has a pipe'],
    ['a background marker', 'npm start &', 'has a pipe'],
    ['a first character that is no program', '--version', 'starts with "-"'],
    ['too many characters', `npm test ${'x'.repeat(200)}`, 'characters long, and a check holds 200'],
  ])('is refused when it is %s', (_what, check, why) => {
    const errors = errorsOf(plan([task('p-1', 'The screens', 'frontend-engineer', { check }), good()[1] as PlanTask, verification()]), 'medium');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('The check of “The screens”');
    expect(errors[0]).toContain(why);
    expect(errors[0]).toContain('give one command the office can run, like "npm test"');
  });

  it('takes chained plain commands, and is validated even where it is optional', () => {
    expect(commandProblem('npm run typecheck && npm test')).toBeNull();
    expect(commandProblem('node --test')).toBeNull();
    expect(commandProblem('./scripts/check.sh --fast')).toBeNull();
    // The stakeholder's own edit may leave it out, but a check it sends is still a plain command.
    const edit = checkPlan(plan([task('p-1', 'The screens', 'frontend-engineer', { check: 'npm test | cat' })]), PEOPLE);
    expect(edit.ok).toBe(false);
    expect(checkPlan(plan([{ ...task('p-1', 'The screens', 'frontend-engineer'), check: undefined }]), PEOPLE).ok).toBe(true);
  });
});

describe('(d) tasks per maker', () => {
  /** n tasks, each its own area, alternating between the first two makers; the office adds the verification itself. */
  const many = (n: number, owners = ['frontend-engineer', 'backend-engineer', 'ui-designer']): PlanTask[] =>
    Array.from({ length: n }, (_, i) => task(`p-${i + 1}`, `Part ${i + 1}`, owners[i % owners.length] ?? 'frontend-engineer', { files: [`area-${i + 1}/`] }));
  const holds = (preset: PresetId, size: Size, n: number, people = PEOPLE): string[] => {
    const result = checkPlan(plan(many(n)), people, { structure: true, size, preset });
    return result.ok ? [] : result.errors;
  };

  it('holds Balanced to 3 tasks for each maker, Lean to 2 and Thorough to 4', () => {
    expect(holds('balanced', 'medium', 9)).toEqual([]);
    expect(holds('balanced', 'medium', 10)).toEqual([
      'The plan has 10 tasks, and 3 makers hold 9 (Balanced: up to 3 each). Plan the fewest tasks that run in parallel, each a whole feature with its own tests that one person finishes in one sitting, and fold the rest into them.',
    ]);
    expect(holds('lean', 'medium', 6)).toEqual([]);
    expect(holds('lean', 'medium', 7)[0]).toContain('3 makers hold 6 (Lean: up to 2 each)');
    expect(holds('thorough', 'medium', 10)).toEqual([]);
    expect(holds('thorough', 'medium', 11)[0]).toContain('3 makers hold 10 (Thorough: up to 4 each)');
  });

  it('keeps the size’s own cap (small 4, medium 10, large 30) and a floor of one task', () => {
    expect(taskCap('small', 1, 4)).toBe(4);
    expect(taskCap('medium', 4, 4)).toBe(10);
    expect(taskCap('large', 12, 4)).toBe(30);
    expect(taskCap('medium', 0, 3)).toBe(1);
    expect(taskCap('large', 24, 4)).toBe(30);
  });

  it('counts makers, not the CEO, heads, leads or checker seats, and not the final review the office adds', () => {
    expect(makersIn(PEOPLE)).toBe(3);
    expect(makersIn(WITH_QA)).toBe(3);
    expect(makersIn([...PEOPLE, { id: 'head-eng', name: 'H', title: 'Head', level: 'head' }, { id: 'lead-eng', name: 'L', title: 'Lead', level: 'lead' }])).toBe(3);
    // Nine tasks and the office's review: ten in the plan, nine counted.
    const result = checkPlan(plan(many(9)), PEOPLE, { structure: true, size: 'medium', preset: 'balanced' });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.plan.tasks).toHaveLength(10);
  });

  it('refuses a task given to someone who isn’t in the company, naming them', () => {
    const errors = errorsOf(plan([task('p-1', 'The screens', 'ghost-engineer'), good()[1] as PlanTask, verification()]), 'medium');
    expect(errors).toEqual(['“The screens” is for "ghost-engineer", who isn\'t in the company; give it to someone who is.']);
  });
});

describe('(e) a task too big for one context', () => {
  const scaffold = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', '.gitignore', 'index.html', 'README.md', 'docs/notes.md', '.github/workflows/ci.yml'];

  it('is refused for files in more than six areas, with the areas and the fix, which is by feature', () => {
    const wide = task('p-1', 'The whole app', 'frontend-engineer', { files: ['src/cart/', 'src/menu/', 'src/orders/', 'src/auth/', 'api/', 'web/', 'worker/'] });
    const errors = errorsOf(plan([wide, good()[1] as PlanTask, verification()]), 'medium');
    expect(errors).toEqual([
      '“The whole app” (p-1) is too big for one context: its files span 7 areas (src/cart, src/menu, src/orders, src/auth, api, web, worker). Narrow it to one feature, or split it by feature (a slice a user can see, with its own tests and check), never by file or into one task to build and another to test.',
    ]);
  });

  it('leaves root config, dot files, lockfiles, the README and docs out of the areas', () => {
    expect(areasOf(scaffold)).toEqual(['the project root']);
    expect(areasOf([...scaffold.filter((f) => f !== 'index.html'), 'src/lib', 'src/test', 'server/package.json', 'server/src/db'])).toEqual(['src/lib', 'src/test', 'server/src']);
    // A scaffold plus two features is three areas, not eleven.
    const task1 = task('p-1', 'Scaffold and the tip maths', 'frontend-engineer', { files: [...scaffold, 'src/core', 'src/ui', 'src/styles'] });
    expect(errorsOf(plan([task1, good()[1] as PlanTask]), 'medium')).toEqual([]);
  });

  it('is refused for a long brief and for a done-when with more than six requirements', () => {
    const long = task('p-1', 'The screens', 'frontend-engineer', { brief: 'x'.repeat(TASK_LIMITS.brief + 1) });
    expect(errorsOf(plan([long, good()[1] as PlanTask, verification()]), 'medium')[0]).toContain('its brief is 2401 characters');
    const many = task('p-1', 'The screens', 'frontend-engineer', { doneWhen: '1. Home. 2. Menu. 3. Cart. 4. Pay. 5. Orders. 6. History. 7. Settings.' });
    expect(errorsOf(plan([many, good()[1] as PlanTask, verification()]), 'medium')[0]).toContain('its doneWhen holds 7 separate requirements');
    const both = task('p-1', 'The screens', 'frontend-engineer', { brief: 'x'.repeat(2500), doneWhen: 'a; b; c; d; e; f; g' });
    expect(errorsOf(plan([both, good()[1] as PlanTask, verification()]), 'medium')[0]).toContain('its brief is 2500 characters and its doneWhen holds 7 separate requirements');
  });

  it('counts areas, requirements and the rest as documented', () => {
    expect(areaOf('src/cart/index.ts')).toBe('src/cart');
    expect(areaOf('src/index.ts')).toBe('src');
    expect(areaOf('api/orders.ts')).toBe('api');
    expect(areaOf('package.json')).toBe('the project root');
    expect(areaOf('.\\web\\src\\App.tsx')).toBe('web/src');
    expect(requirementsIn('It works.')).toBe(1);
    expect(requirementsIn('- a\n- b\n- c')).toBe(3);
    expect(requirementsIn('a; b; c; d')).toBe(4);
    expect(requirementsIn('One. Two. Three.')).toBe(3);
  });
});

describe('(e) a task that is only documentation', () => {
  const docs = (files: string[], extra: Partial<PlanTask> = {}): PlanTask => task('p-3', 'Write the README', 'frontend-engineer', { files, after: ['p-1'], ...extra });
  const run = (t: PlanTask): string[] => errorsOf(plan([...good().slice(0, 2), t]), 'medium');

  it.each([
    ['a README alone', ['README.md']],
    ['a README and a changelog', ['README.md', 'CHANGELOG.md']],
    ['markdown at the root', ['NOTES.md']],
    ['a README inside a folder', ['src/cart/README.md']],
  ])('is refused for %s, and folded into the task that builds what it documents', (_what, files) => {
    expect(run(docs(files))).toEqual([
      '“Write the README” (p-3) is only documentation; fold it into the task that builds what it documents, so its owner writes the README with the feature. A spec or a guide in docs/ is a task of its own.',
    ]);
  });

  it('is refused by its title when it names no files', () => {
    expect(run(docs([], { title: 'Add documentation' })).length).toBe(1);
    expect(isDocsOnly({ title: 'Update the README', files: [], kind: undefined })).toBe(true);
    expect(isDocsOnly({ title: 'The README parser', files: ['src/readme/'], kind: undefined })).toBe(false);
  });

  it('lets a spec, a design note or a guide in docs/ stand as a task of its own: others build against it', () => {
    expect(run(docs(['docs/flow.md'], { title: 'Map the pickup flow' }))).toEqual([]);
    expect(run(docs(['docs/guide.md', 'docs/api.md'], { title: 'The user guide and the API reference' }))).toEqual([]);
    expect(run(docs(['docs/'], { title: 'The user guide' }))).toEqual([]);
  });

  it('is no problem for a task that builds something and writes its README with it', () => {
    expect(isDocsOnly({ title: 'The CLI and its README', files: ['src/cli.ts', 'README.md'], kind: undefined })).toBe(false);
    expect(run(docs(['src/cli/', 'README.md'], { title: 'The CLI and its README' }))).toEqual([]);
  });
});

describe('the final verification is the office’s', () => {
  const built = (tasks: PlanTask[], size: Size = 'medium', people = PEOPLE) => {
    const result = ceoCheck(plan(tasks), size, people);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    return result;
  };
  const makers = (): PlanTask[] => good().slice(0, 2);

  it('is added to a medium or large plan: a fixed title, the CEO, the tasks nothing else waits for, the last milestone, no check', () => {
    for (const size of ['medium', 'large'] as const) {
      const result = built(makers(), size);
      const last = result.plan.tasks.at(-1) as PlanTask;
      expect(result.plan.tasks).toHaveLength(3);
      expect(last).toMatchObject({ title: FINAL_REVIEW.title, owner: 'ceo', files: [], milestone: 'ms-2', kind: 'verification', after: ['p-1', 'p-2'] });
      expect(last.check).toBeUndefined();
      expect(last.doneWhen).toContain('stakeholder_words');
      expect(last.id).toBe('p-3');
      expect(result.notes).toBeUndefined();
    }
  });

  it('waits for the end of every chain, not for every task, so that it fits the 12 a task can wait for', () => {
    const chain = [task('p-1', 'Data', 'backend-engineer'), task('p-2', 'More data', 'backend-engineer', { after: ['p-1'] }), task('p-3', 'Look', 'ui-designer')];
    expect((built(chain).plan.tasks.at(-1) as PlanTask).after).toEqual(['p-2', 'p-3']);
  });

  it('goes to the QA engineer when the company has a checker seat', () => {
    expect((built(makers(), 'large', WITH_QA).plan.tasks.at(-1) as PlanTask).owner).toBe('qa-engineer');
  });

  it('replaces the CEO’s own, wherever it is and whatever it says, with one note and its id kept', () => {
    const own = verification({ id: 'p-7', title: 'Check it', doneWhen: 'It all works.', after: ['p-1'], milestone: 'ms-1' });
    const result = built([makers()[0] as PlanTask, own, task('p-2', 'The data layer', 'backend-engineer', { after: ['p-7'] })]);
    const reviews = result.plan.tasks.filter((t) => t.kind === 'verification');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ id: 'p-7', title: FINAL_REVIEW.title, milestone: 'ms-2', owner: 'ceo' });
    expect(result.plan.tasks.at(-1)?.id).toBe('p-7');
    expect(result.plan.tasks.find((t) => t.id === 'p-2')?.after).toEqual([]);
    expect(result.notes).toEqual([`The final review is added by the office, so “Check it” (p-7) was replaced by "${FINAL_REVIEW.title}" (p-7).`]);
  });

  it('keeps one when the CEO wrote two, and is not refused for a wrong owner, wait or wording', () => {
    const two = [...makers(), verification({ id: 'p-8', owner: 'frontend-engineer', after: [], doneWhen: 'Fine.' }), verification({ id: 'p-9', owner: 'backend-engineer', after: ['p-1'] })];
    const result = built(two);
    expect(result.plan.tasks.filter((t) => t.kind === 'verification')).toHaveLength(1);
    expect(result.plan.tasks.at(-1)).toMatchObject({ owner: 'ceo', after: ['p-1', 'p-2'] });
  });

  it('is never in a small plan, and the CEO’s own is dropped with a note instead of a refusal', () => {
    const one = task('p-1', 'The screens', 'frontend-engineer');
    expect(built([one], 'small').plan.tasks).toHaveLength(1);
    const result = built([one, verification({ after: ['p-1'] })], 'small');
    expect(result.plan.tasks.map((t) => t.id)).toEqual(['p-1']);
    expect(result.notes).toEqual(['“Review the whole result” (p-9) was dropped: a small plan has no verification task, since you check the result against stakeholder_words yourself at the end.']);
  });

  it('is left alone in a person’s own edit and in a plan checked with no size', () => {
    expect(checkPlan(plan(makers()), PEOPLE).ok).toBe(true);
    const edited = checkPlan(plan(makers()), PEOPLE);
    if (edited.ok) expect(edited.plan.tasks).toHaveLength(2);
    const sizeless = ceoCheck(plan([...makers(), verification()]));
    if (!sizeless.ok) throw new Error(sizeless.errors.join('\n'));
    expect(sizeless.plan.tasks).toHaveLength(3);
  });
});

describe('contracts when streams share an interface (3 or more makers)', () => {
  const streams = (extra: Partial<PlanTask> = {}): PlanTask[] => [
    task('p-1', 'API', 'backend-engineer', { files: ['server/', 'docs/api.md'] }),
    task('p-2', 'Look', 'ui-designer', { files: ['web/src/ui/'] }),
    task('p-3', 'Screens', 'frontend-engineer', { files: ['web/src/app/'], after: ['p-1', 'p-2'], ...extra }),
  ];
  const contract = { id: 'c-1', title: 'Orders API', file: 'docs/api.md', writer: 'p-1', dependents: ['p-3'], summary: 'The routes.' };

  it('are asked for when two makers’ tasks wait for each other and there is none, in the exact shape to add, at any size', () => {
    for (const size of ['medium', 'large'] as const) {
      const errors = errorsOf(plan(streams()), size);
      expect(errors).toEqual([
        '3 people build parts of this plan and one task builds on Ivo\'s work, but it has no contracts.' +
          ' Add to contracts one for each interface they share, like {"title":"<what they share, like Orders API>","file":"docs/contracts/backend-engineer.md","writer":"p-1","dependents":["p-3"]}: its file is written by the first task of the stream that owns it (add the file to that task\'s files), and every task that builds on it waits for that task. Put the stakeholder\'s requirements for it in the file word for word.',
      ]);
    }
  });

  it('are not asked for when no two makers’ tasks wait for each other', () => {
    const apart = [task('p-1', 'API', 'backend-engineer'), task('p-2', 'Look', 'ui-designer'), task('p-3', 'Screens', 'frontend-engineer')];
    expect(errorsOf(plan(apart), 'medium')).toEqual([]);
  });

  it('are not asked for below three makers', () => {
    expect(errorsOf(plan([task('p-1', 'API', 'backend-engineer'), task('p-2', 'Screens', 'frontend-engineer', { after: ['p-1'] })]), 'medium')).toEqual([]);
  });

  it('pass with one, written by the first task of the stream that owns it', () => {
    expect(errorsOf(plan(streams(), { contracts: [contract] }), 'medium')).toEqual([]);
  });
});

describe('with the big-plan rules, which stay for a large plan', () => {
  /** Three makers' parts, each stream building on the one before, with the contract between them written. */
  const bigPlan = (): Plan =>
    plan(
      [
        task('p-1', 'API', 'backend-engineer', { files: ['server/', 'docs/api.md'] }),
        task('p-2', 'Screens', 'frontend-engineer', { after: ['p-1'] }),
        task('p-3', 'Look', 'ui-designer'),
        task('p-4', 'Sign-in', 'backend-engineer', { files: ['auth/'], after: ['p-1'] }),
        task('p-5', 'Export', 'frontend-engineer', { files: ['export/'], after: ['p-2'] }),
        task('p-6', 'Admin', 'ui-designer', { files: ['admin/'], after: ['p-3'] }),
      ],
      { contracts: [{ id: 'c-1', title: 'API', file: 'docs/api.md', writer: 'p-1', dependents: ['p-2', 'p-4', 'p-5'] }] },
    );

  it('ask a large plan for an integration task where several people’s work meets, and not a medium one, which is flat', () => {
    expect(errorsOf(bigPlan(), 'medium')).toEqual([]);
    const errors = errorsOf(bigPlan(), 'large');
    expect(anyOf(errors, 'but no integration task')).toBe(true);
    expect(anyOf(errors, 'no final verification')).toBe(false);
    expect(anyOf(errors, 'no contracts')).toBe(false);
  });

  it('ask the old way when the plan has no size, as for plans checked before sizes existed', () => {
    expect(anyOf(errorsOf(bigPlan()), 'but no integration task')).toBe(true);
    expect(errorsOf(plan(good().slice(0, 2)))).toEqual([]);
  });
});

describe('every refusal at once', () => {
  it('comes back together, each naming its task and fix, when a plan breaks several rules', () => {
    const bad = plan([
      { ...task('p-1', 'The screens', 'frontend-engineer'), check: undefined },
      task('p-2', 'Write tests for the screens', 'backend-engineer', { after: ['p-1'], files: ['test/'] }),
      task('p-3', 'Everything else', 'ui-designer', { files: ['a/', 'b/', 'c/', 'd/', 'e/', 'f/', 'g/'] }),
      task('p-4', 'Write the README', 'ui-designer', { files: ['README.md'] }),
    ]);
    const errors = errorsOf(bad, 'medium');
    expect(errors).toHaveLength(5);
    expect(anyOf(errors, 'but it has no contracts')).toBe(true);
    expect(anyOf(errors, '“The screens” (p-1) has no check')).toBe(true);
    expect(anyOf(errors, '“Write tests for the screens” (p-2) is only tests')).toBe(true);
    expect(anyOf(errors, '“Everything else” (p-3) is too big for one context')).toBe(true);
    expect(anyOf(errors, '“Write the README” (p-4) is only documentation')).toBe(true);
  });

  it('comes back with a clash of files in the same answer', () => {
    const bad = plan([task('p-1', 'The screens', 'frontend-engineer', { files: ['src/'] }), task('p-2', 'The data layer', 'backend-engineer', { files: ['src/data/'] }), verification()]);
    const errors = errorsOf(bad, 'medium');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('both change');
    // And with a no-check, which is only found by the linter.
    const worse = plan([{ ...task('p-1', 'The screens', 'frontend-engineer', { files: ['src/'] }), check: undefined }, task('p-2', 'The data layer', 'backend-engineer', { files: ['src/data/'] }), verification()]);
    expect(errorsOf(worse, 'medium')).toHaveLength(2);
  });
});

describe('a brief that reads a file another task owns', () => {
  const reads = (second: Partial<PlanTask> = {}, first: Partial<PlanTask> = {}): PlanTask[] => [
    task('p-1', 'The data layer', 'backend-engineer', { files: ['src/data/', 'src/types.ts'], ...first }),
    task('p-2', 'The screens', 'frontend-engineer', { brief: 'Build the screens on the types in src/types.ts and the store in src/data/store.ts.', ...second }),
  ];
  const afters = (tasks: PlanTask[]): string[][] => {
    const result = ceoCheck(plan(tasks), 'medium');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    return result.plan.tasks.map((t) => t.after);
  };

  it('is no refusal: the task waits for the owner, and a note says so', () => {
    const result = ceoCheck(plan(reads()), 'medium');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.plan.tasks.find((t) => t.id === 'p-2')?.after).toEqual(['p-1']);
    expect(result.notes).toEqual(['A brief reads a file another task owns, so the office made p-2 wait for p-1.']);
  });

  it('changes nothing when the task already waits for the owner', () => {
    const result = ceoCheck(plan(reads({ after: ['p-1'] })), 'medium');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.notes).toBeUndefined();
  });

  it('leaves it alone when the owner waits for the task, since an order exists and a loop must not follow', () => {
    expect(afters(reads({}, { after: ['p-2'] }))).toEqual([['p-2'], [], ['p-1']]);
  });

  it('leaves it alone for a file nobody owns, or a name that is no file', () => {
    expect(afters(reads({ brief: 'See SPEC.md, Node.js and docs/spec.pdf.' }))).toEqual([[], [], ['p-1', 'p-2']]);
  });

  it('makes no wait for a task in a later milestone', () => {
    expect(afters(reads({ milestone: 'ms-1' }, { milestone: 'ms-2' }))).toEqual([[], [], ['p-1', 'p-2']]);
  });

  it('is not made for a person’s own edit, which keeps the plan as written', () => {
    const edit = checkPlan(plan(reads()), PEOPLE);
    if (!edit.ok) throw new Error(edit.errors.join('\n'));
    expect(edit.plan.tasks[1]?.after).toEqual([]);
  });
});

describe('free text over its limit in a plan (v0.2: code cuts what code can fix)', () => {
  const sentences = (n: number): string => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} says one thing.`).join(' ');
  const clauses = (n: number): string => `${'The total is right, '.repeat(n)}and that is it`;

  it('cuts a goal at a sentence end and a done-when at a word, and says what it cut', () => {
    const goal = sentences(40);
    const done = clauses(60);
    expect(goal.length).toBeGreaterThan(1000);
    expect(done.length).toBeGreaterThan(1000);
    const result = ceoCheck(plan([task('p-1', 'The screens', 'frontend-engineer', { doneWhen: done }), good()[1] as PlanTask], { goal }), 'medium');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.plan.goal.length).toBeLessThanOrEqual(1000);
    expect(result.plan.goal.endsWith('says one thing.')).toBe(true);
    const cut = result.plan.tasks[0]?.doneWhen ?? '';
    expect(cut.length).toBeLessThanOrEqual(1000);
    expect(cut.endsWith('…')).toBe(true);
    expect(result.notes).toEqual([
      `The goal was cut from ${goal.length.toLocaleString('en-US')} to ${result.plan.goal.length} characters at a sentence end.`,
      `What marks “The screens” done was cut from ${done.length.toLocaleString('en-US')} to ${cut.length} characters at a word.`,
    ]);
  });

  it('is still refused in a person’s own edit, as before', () => {
    const edit = checkPlan(plan([task('p-1', 'The screens', 'frontend-engineer')], { goal: sentences(40) }), PEOPLE);
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.errors[0]).toMatch(/^The goal is [\d,]+ characters; the limit is 1,000/);
  });
});

describe('plans the linter leaves alone', () => {
  const legacy = (): Plan => plan([task('p-1', 'Write tests for the app', 'frontend-engineer', { check: undefined, files: ['test/'] })]);

  it('include the stakeholder’s own edit, which no CEO rule binds', () => {
    expect(checkPlan(legacy(), PEOPLE).ok).toBe(true);
    expect(checkPlan(legacy(), PEOPLE, { size: 'small' }).ok).toBe(true);
  });

  it('and a plan saved by 0.1.0, with no checks, kinds or size, which still checks as before', () => {
    const old = plan(Array.from({ length: 12 }, (_, i) => task(`p-${i + 1}`, `Part ${i + 1}`, 'frontend-engineer', { check: undefined, files: [`area-${i + 1}/`] })));
    expect(checkPlan(old, PEOPLE).ok).toBe(true);
  });

  it('but ask the CEO to meet the rules when it revises one', () => {
    expect(errorsOf(legacy(), 'small').length).toBeGreaterThan(0);
  });
});

describe('the checklist on the CEO’s plans (checklist: true)', () => {
  const listed = (raw: unknown, people = PEOPLE): PlanCheck => checkPlan(raw, people, { structure: true, checklist: true, size: 'medium' });
  const listErrors = (raw: unknown, people = PEOPLE): string[] => {
    const result = listed(raw, people);
    return result.ok ? [] : result.errors;
  };
  const LIST = [
    { id: 'k-1', text: 'The screens show every plant.', quote: 'show all my plants', covers: ['p-1'] },
    { id: 'k-2', text: 'Each watering is saved.', quote: null, covers: ['The data layer', 'p-9'] },
  ];

  it('passes with every item covered and every task that builds covering one; the final review covers none', () => {
    const result = listed(plan(good(), { checklist: LIST }));
    if (!result.ok) throw new Error(result.errors.join('\n'));
    // Covers by title become ids, and a cover of the CEO's own verification task goes with it: the final review checks every item.
    expect(result.plan.checklist).toEqual([LIST[0], { ...LIST[1], covers: ['p-2'] }]);
    expect(result.plan.tasks.at(-1)).toMatchObject({ title: FINAL_REVIEW.title, kind: 'verification' });
  });

  it('is asked for only with checklist: true, so plans saved before it and the replays keep passing', () => {
    expect(errorsOf(plan(good()), 'medium')).toEqual([]);
    expect(checkPlan(plan(good()), PEOPLE).ok).toBe(true);
    expect(listErrors(plan(good()))).toEqual([
      'The plan has no checklist; list each thing the stakeholder asked for as a short checkable sentence, quoting their words, with the tasks that cover it.',
    ]);
  });

  it('refuses an item no task covers and a task that covers none, with the linter’s own problems in the same answer', () => {
    const tasks = good().map((t) => (t.id === 'p-1' ? { ...t, check: undefined } : t));
    const checklist = [
      { id: 'k-1', text: 'Each watering is saved.', quote: null, covers: ['p-2'] },
      { id: 'k-2', text: 'It works offline.', quote: 'offline too', covers: [] },
    ];
    expect(listErrors(plan(tasks, { checklist }))).toEqual([
      expect.stringContaining('“The screens” (p-1) has no check'),
      'The checklist item “It works offline.” (k-2) has no task that covers it; name the task that builds it in covers, or add one.',
      '“The screens” (p-1) covers no checklist item; add it to the covers of the item it builds, or remove the task.',
    ]);
  });

  it('never asks an integration task to cover an item', () => {
    const tasks = [...good().slice(0, 2), task('p-3', 'Run it together', 'frontend-engineer', { kind: 'integration', after: ['p-1', 'p-2'], files: ['src/p-3/'] })];
    expect(listErrors(plan(tasks, { checklist: [{ id: 'k-1', text: 'It all works.', quote: null, covers: ['p-1', 'p-2'] }] }))).toEqual([]);
  });

  it('keeps a checklist a person sends, with the stakeholder’s ids for new items, and never refuses it over covers', () => {
    const result = checkPlan({ ...plan(good()), checklist: [{ text: 'Printable cards.', quote: null, covers: [] }] }, PEOPLE);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.plan.checklist).toEqual([{ id: 'k-s1', text: 'Printable cards.', quote: null, covers: [] }]);
  });
});
