import { describe, expect, it } from 'vitest';
import {
  carryChecklist,
  type ChecklistReader,
  checklistCountsLine,
  checklistLines,
  checklistProblems,
  checklistView,
  readChecklist,
  unmarkedRecheckItems,
  verdictOpenLines,
} from '../src/core/checklist.ts';
import { REPORT_FORM, type Task } from '../src/core/company.ts';
import { cutText } from '../src/core/cut.ts';
import { CHECKLIST_LIMITS, type ChecklistItem, type ChecklistVerdict, type Plan, type PlanTask, type PlanVersion } from '../src/core/steering.ts';

const planTask = (id: string, title: string, over: Partial<PlanTask> = {}): PlanTask => ({ id, title, owner: 'lea', files: [`src/${id}`], milestone: 'ms-1', after: [], brief: '', doneWhen: 'Done.', ...over });

const TASKS: PlanTask[] = [
  planTask('p-1', 'Menu page'),
  planTask('p-2', 'Prices'),
  planTask('p-3', 'Wire it together', { kind: 'integration' }),
  planTask('p-4', 'Final review of the whole result', { kind: 'verification', files: [] }),
];

/** A reader over these tasks, as checkPlan would make it; `cut` makes it cut long text the way the CEO's plans are. */
function reader(earlier: Plan[] = [], over: Partial<ChecklistReader> & { cut?: boolean } = {}): { r: ChecklistReader; errors: string[] } {
  const errors: string[] = [];
  const ids = TASKS.map((t) => t.id);
  const r: ChecklistReader = {
    earlier,
    ids,
    taskByWord: (said) => {
      const byId = ids.indexOf(said);
      if (byId >= 0) return [byId];
      return TASKS.flatMap((t, i) => (t.title.toLowerCase() === said.toLowerCase() ? [i] : []));
    },
    kindOf: (i) => TASKS[i]?.kind,
    add: (p) => {
      if (p && !errors.includes(p)) errors.push(p);
    },
    fit: (what, text, max) => {
      if (text.length <= max) return text;
      const cut = over.cut ? cutText(text, max) : null;
      if (cut) return cut.text;
      errors.push(`${what} is too long.`);
      return text;
    },
    ...over,
  };
  return { r, errors };
}

const planWith = (checklist: ChecklistItem[]): Plan => ({ goal: 'A café site', milestones: [{ id: 'ms-1', title: 'Menu', doneWhen: 'Shows.' }], tasks: TASKS, checklist });

describe('readChecklist', () => {
  it('reads nothing when none is sent', () => {
    const { r, errors } = reader();
    expect(readChecklist(undefined, r)).toEqual([]);
    expect(readChecklist(null, r)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('gives new items k- ids, keeps the ids given, and names covers by id or title', () => {
    const { r, errors } = reader();
    const items = readChecklist(
      [
        { text: 'The menu shows every dish', quote: 'show the menu', covers: ['p-1'] },
        { id: 'k-7', text: 'Prices are in francs', quote: null, covers: ['prices', 'Menu page', 'p-2'] },
        { text: 'It works on a phone', covers: ['p-1'] },
      ],
      r,
    );
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { id: 'k-8', text: 'The menu shows every dish', quote: 'show the menu', covers: ['p-1'] },
      { id: 'k-7', text: 'Prices are in francs', quote: null, covers: ['p-2', 'p-1'] },
      { id: 'k-9', text: 'It works on a phone', quote: null, covers: ['p-1'] },
    ]);
  });

  it('keeps an item’s id from the latest version by its text, and never reuses an earlier one', () => {
    const v1 = planWith([
      { id: 'k-1', text: 'The menu shows every dish', quote: null, covers: ['p-1'] },
      { id: 'k-2', text: 'Prices are in francs', quote: null, covers: ['p-2'] },
    ]);
    const v2 = planWith([{ id: 'k-2', text: 'Prices are in francs', quote: null, covers: ['p-2'] }]);
    const { r } = reader([v1, v2]);
    const items = readChecklist([{ text: 'prices are  in francs', covers: ['p-2'] }, { text: 'The menu shows every dish', covers: ['p-1'] }], r);
    expect(items.map((k) => k.id)).toEqual(['k-2', 'k-3']);
  });

  it('gives the stakeholder’s new items k-s ids', () => {
    const { r } = reader([planWith([{ id: 'k-s1', text: 'Opening hours', quote: null, covers: [] }])], { stakeholder: true });
    expect(readChecklist([{ text: 'A map to the café', covers: [] }], r)[0]?.id).toBe('k-s2');
  });

  it('refuses covers the plan doesn’t have or can’t tell apart, and drops repeats and the final review', () => {
    const { r, errors } = reader();
    const items = readChecklist([{ text: 'The menu shows', covers: ['p-1', 'p-1', 'p-4', 'Cart'] }], r);
    expect(items[0]?.covers).toEqual(['p-1']);
    expect(errors).toEqual(['The checklist item “The menu shows” names "Cart" as a task that covers it, which isn\'t a task in the plan; name a task by its id.']);
  });

  it('refuses a checklist that isn’t a list, too many items, items without text and repeated ids', () => {
    expect(readChecklist('all of it', reader().r)).toEqual([]);
    const notList = reader();
    readChecklist({ text: 'x' }, notList.r);
    expect(notList.errors[0]).toMatch(/as something other than a list/);
    const many = reader();
    readChecklist(Array.from({ length: CHECKLIST_LIMITS.items + 1 }, (_, n) => ({ text: `Item ${n}`, covers: ['p-1'] })), many.r);
    expect(many.errors).toEqual([`The checklist has ${CHECKLIST_LIMITS.items + 1} items and holds ${CHECKLIST_LIMITS.items}; merge the ones that are checked together.`]);
    const bad = reader();
    const items = readChecklist([{ text: '  ', covers: ['p-1'] }, 'text', { id: 'k-1', text: 'A', covers: ['p-1'] }, { id: 'k-1', text: 'B', covers: ['p-2'], quote: 4 }], bad.r);
    expect(bad.errors).toEqual([
      'Two checklist items have the id k-1; give each its own.',
      'Checklist item 1 has no text; say what the stakeholder asked for as a short sentence that can be checked.',
      "Checklist item 2 isn't an object with its text, the stakeholder's words in quote and the tasks that cover it.",
      "The checklist item “B” has a quote that isn't text; give the stakeholder's words as they wrote them, or null.",
    ]);
    expect(new Set(items.map((k) => k.id)).size).toBe(items.length);
  });

  it('cuts long text for the CEO, refuses it for a person, and masks secrets', () => {
    const long = `${'The menu page shows every dish with its price. '.repeat(8)}`;
    const cut = reader([], { cut: true });
    const [item] = readChecklist([{ text: long, quote: `Use token ghp_abcdefghijklmnopqrstuvwxyz0123456789 ${'x'.repeat(500)}`, covers: ['p-1'] }], cut.r);
    expect(cut.errors).toEqual([]);
    expect(item?.text.length).toBeLessThanOrEqual(CHECKLIST_LIMITS.text);
    expect(item?.quote?.length).toBeLessThanOrEqual(CHECKLIST_LIMITS.quote);
    expect(item?.quote).not.toContain('ghp_abcdefghij');
    const strict = reader();
    readChecklist([{ text: long, covers: ['p-1'] }], strict.r);
    expect(strict.errors[0]).toMatch(/is too long/);
  });
});

describe('checklistProblems', () => {
  const nameAt = (i: number) => `“${TASKS[i]?.title ?? ''}”`;
  const run = (items: ChecklistItem[], tasks: PlanTask[] = TASKS) => {
    const errors: string[] = [];
    checklistProblems(items, tasks, nameAt, (p) => p && errors.push(p));
    return errors;
  };

  it('refuses a plan without a checklist', () => {
    expect(run([])).toEqual(["The plan has no checklist; list each thing the stakeholder asked for as a short checkable sentence, quoting their words, with the tasks that cover it."]);
  });

  it('refuses an item no task covers, and one covered only by the final review', () => {
    expect(run([{ id: 'k-1', text: 'Menu', quote: null, covers: ['p-1', 'p-2'] }, { id: 'k-2', text: 'Opening hours', quote: null, covers: [] }, { id: 'k-3', text: 'Checked', quote: null, covers: ['p-4'] }])).toEqual([
      'The checklist item “Opening hours” (k-2) has no task that covers it; name the task that builds it in covers, or add one.',
      'The checklist item “Checked” (k-3) has no task that covers it; name the task that builds it in covers, or add one.',
    ]);
  });

  it('refuses a task that builds a part and covers nothing, and exempts integration and verification', () => {
    expect(run([{ id: 'k-1', text: 'Menu', quote: null, covers: ['p-1'] }])).toEqual([
      '“Prices” (p-2) covers no checklist item; add it to the covers of the item it builds, or remove the task.',
    ]);
    expect(run([{ id: 'k-1', text: 'Menu', quote: null, covers: ['p-1', 'p-2'] }])).toEqual([]);
  });
});

describe('carryChecklist', () => {
  const earlier = planWith([
    { id: 'k-1', text: 'Menu', quote: 'the menu', covers: ['p-1', 'p-2'] },
    { id: 'k-2', text: 'Prices', quote: null, covers: ['p-2'] },
  ]);

  it('carries the earlier checklist into an edit that doesn’t send one, pruning covers of cut tasks', () => {
    const raw = { goal: 'x', milestones: [], tasks: [{ id: 'p-1', title: 'Menu page' }, { title: 'New task' }] };
    expect(carryChecklist(raw, earlier)).toEqual({
      ...raw,
      checklist: [
        { id: 'k-1', text: 'Menu', quote: 'the menu', covers: ['p-1'] },
        { id: 'k-2', text: 'Prices', quote: null, covers: [] },
      ],
    });
  });

  it('leaves an edit that sends a checklist, even an empty one, and plans without one, as they are', () => {
    const sent = { goal: 'x', tasks: [], checklist: [] };
    expect(carryChecklist(sent, earlier)).toBe(sent);
    const raw = { goal: 'x', tasks: [] };
    expect(carryChecklist(raw, planWith([]))).toBe(raw);
    expect(carryChecklist('nonsense', earlier)).toBe('nonsense');
  });
});

describe('checklistView', () => {
  const items: ChecklistItem[] = [
    { id: 'k-1', text: 'The menu shows every dish', quote: 'show the menu', covers: ['p-1'] },
    { id: 'k-2', text: 'Prices are in francs', quote: null, covers: ['p-2', 'p-1'] },
    { id: 'k-3', text: 'Opening hours', quote: null, covers: [] },
  ];
  const version: PlanVersion = { version: 2, by: 'ceo', at: 0, plan: planWith(items), note: null, cites: [] };
  const board = (id: string, plan: string, status: Task['status']): Task => ({
    id,
    title: `Board ${plan}`,
    brief: '',
    owner: 'lea',
    askedBy: 'ceo',
    files: [],
    doneWhen: '',
    status,
    outcome: null,
    parent: null,
    milestone: null,
    worktree: null,
    commit: null,
    createdAt: 0,
    updatedAt: 0,
    planTask: plan,
  });
  const verdict = (item: string, v: ChecklistVerdict['verdict'], at: number, over: Partial<ChecklistVerdict> = {}): ChecklistVerdict => ({
    item,
    version: 2,
    verdict: v,
    evidence: { note: `Saw ${item}.`, check: { ran: 'npm test', passed: v === 'met' }, files: ['src/menu/page.tsx'], page: '/menu' },
    by: 'qa',
    task: 't-9',
    at,
    ...over,
  });

  it('is null without a version or a checklist', () => {
    expect(checklistView(null, [], [])).toBeNull();
    expect(checklistView({ ...version, plan: { ...version.plan, checklist: undefined } }, [], [])).toBeNull();
  });

  it('takes each item’s newest verdict on this version, counts the states and leaves the rest unchecked', () => {
    const view = checklistView(version, [verdict('k-1', 'not-met', 10), verdict('k-1', 'met', 20), verdict('k-2', 'partly', 15), verdict('k-3', 'met', 30, { version: 1 })], []);
    expect(view?.rows.map((r) => [r.id, r.state])).toEqual([
      ['k-1', 'met'],
      ['k-2', 'partly'],
      ['k-3', 'unchecked'],
    ]);
    expect(view?.counts).toEqual({ met: 1, partly: 1, 'not-met': 0, unchecked: 1 });
    expect(view?.reviewedAt).toBe(20);
    expect(view?.version).toBe(2);
  });

  it('carries a verdict from an earlier version to an item it left alone, and not to one it rewrote or a later one', () => {
    const v1: PlanVersion = {
      ...version,
      version: 1,
      plan: planWith([
        { id: 'k-1', text: 'The menu  shows every dish', quote: null, covers: ['p-1'] },
        { id: 'k-2', text: 'Prices in euros', quote: null, covers: ['p-2'] },
      ]),
    };
    const v3: PlanVersion = { ...version, version: 3 };
    const verdicts = [verdict('k-1', 'not-met', 10, { version: 1 }), verdict('k-2', 'met', 11, { version: 1 }), verdict('k-3', 'met', 12, { version: 3 })];
    const view = checklistView(version, verdicts, [], undefined, [v1, version, v3]);
    expect(view?.rows.map((r) => [r.id, r.state])).toEqual([
      ['k-1', 'not-met'],
      ['k-2', 'unchecked'],
      ['k-3', 'unchecked'],
    ]);
    // A newer verdict on this version wins over the carried one; without the versions nothing carries.
    expect(checklistView(version, [...verdicts, verdict('k-1', 'met', 20)], [], undefined, [v1, version])?.rows[0]?.state).toBe('met');
    expect(checklistView(version, verdicts, [])?.rows[0]?.state).toBe('unchecked');
  });

  it('lists the covering tasks with the board task made from each, by the state’s map or the tasks’ own', () => {
    const tasks = [board('t-1', 'p-1', 'done'), board('t-5', 'p-1', 'working')];
    const own = checklistView(version, [], tasks);
    expect(own?.rows[1]?.tasks).toEqual([
      { planTask: 'p-2', task: null, title: 'Prices', status: 'planned' },
      { planTask: 'p-1', task: 't-5', title: 'Menu page', status: 'working' },
    ]);
    const mapped = checklistView(version, [], tasks, { 'p-1': 't-1' });
    expect(mapped?.rows[0]?.tasks).toEqual([{ planTask: 'p-1', task: 't-1', title: 'Menu page', status: 'done' }]);
    expect(own?.rows[2]?.tasks).toEqual([]);
  });

  it('writes plain lines for the brief and the counts for the CEO', () => {
    const view = checklistView(version, [verdict('k-2', 'partly', 15)], []);
    if (!view) throw new Error('no view');
    expect(checklistLines(view)).toEqual([
      'k-1: The menu shows every dish. Their words: “show the menu”. Covered by “Menu page”.',
      'k-2: Prices are in francs. Covered by “Prices” and “Menu page”. Marked partly met.',
      'k-3: Opening hours. No task covers it yet.',
    ]);
    expect(checklistCountsLine(view)).toBe('The checklist: 0 met, 1 partly met, 0 not met, 2 not checked.');
    expect(checklistCountsLine({ counts: { met: 6, partly: 1, 'not-met': 0, unchecked: 0 } })).toBe('The checklist: 6 met, 1 partly met, 0 not met.');
  });

  describe('verdictOpenLines', () => {
    const tasks = [board('t-1', 'p-1', 'done'), board('t-2', 'p-2', 'done')];
    const view = checklistView(
      version,
      [verdict('k-1', 'not-met', 10), verdict('k-2', 'partly', 11), verdict('k-3', 'not-met', 12), verdict('k-1', 'met', 5, { task: 't-8', version: 2, item: 'k-9' })],
      tasks,
    );
    if (!view) throw new Error('no view');

    it('adds a line for each failed item of this review, led by its first covering plan task', () => {
      expect(verdictOpenLines(view, 't-9', [])).toEqual(['p-1 The menu shows every dish: Saw k-1.', 'p-2 Prices are in francs: Saw k-2.', 'k-3 Opening hours: Saw k-3.']);
    });

    it('skips items an open line already names by plan or board task, and other reviews’ verdicts', () => {
      expect(verdictOpenLines(view, 't-9', ['t-1 the dishes are missing', 'p-2: prices in euros'])).toEqual(['k-3 Opening hours: Saw k-3.']);
      expect(verdictOpenLines(view, 't-8', [])).toEqual([]);
      expect(verdictOpenLines(view, 't-9', ['p-10 something else'])).toHaveLength(3);
    });

    it('names the items a re-check looks at that still carry the earlier review’s failure', () => {
      // The re-check t-20 looks again at the line about p-1 (k-1, and k-2, which p-1 also covers) and at k-3 by its id.
      expect(unmarkedRecheckItems(view, 't-20', ['p-1 The menu shows every dish: Saw k-1.'])).toEqual(['k-1', 'k-2']);
      expect(unmarkedRecheckItems(view, 't-20', ['k-3 Opening hours: Saw k-3.'])).toEqual(['k-3']);
      expect(unmarkedRecheckItems(view, 't-20', ['p-10 something else'])).toEqual([]);
      // Marked again by the re-check itself: nothing left.
      const remarked = checklistView(version, [verdict('k-1', 'not-met', 10), verdict('k-1', 'met', 30, { task: 't-20' })], tasks);
      if (!remarked) throw new Error('no view');
      expect(unmarkedRecheckItems(remarked, 't-20', ['p-1 The menu shows every dish'])).toEqual([]);
    });

    it('cuts each line to what a report keeps', () => {
      const long = checklistView(version, [verdict('k-1', 'not-met', 10, { evidence: { note: 'x '.repeat(400), check: null, files: [], page: null } })], tasks);
      if (!long) throw new Error('no view');
      expect(verdictOpenLines(long, 't-9', [])[0]?.length).toBeLessThanOrEqual(REPORT_FORM.openItem);
    });
  });
});
