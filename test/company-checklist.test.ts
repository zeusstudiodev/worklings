// v0.2, "Simple, visible, proven" (SPEC-v0.2.md): the checklist of what the stakeholder asked for, proposed with the CEO's
// plan, judged item by item by the final review with mark_checklist, and carried into the fix and re-check path and the
// CEO's finish. An item nobody marks stays unchecked, never passed.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { briefFile } from '../src/company/brief.ts';
import { OrgRefusal, STAKEHOLDER, type Task } from '../src/core/company.ts';
import type { VerdictInput } from '../src/core/steering.ts';
import { crashCopy, ended, rig, type Rig } from './company-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T10:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const settled = () => vi.advanceTimersByTimeAsync(0);
const flush = async (r: Rig): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await r.company.idle();
    await settled();
  }
};
const CLEAN = { files: [], open: [], check: { ran: 'npm test', passed: true } };

const CHECKLIST = [
  { id: 'k-1', text: 'Every drink has a price.', quote: 'every drink with its price', covers: ['p-1'] },
  { id: 'k-2', text: 'The menu lists a flat white.', quote: null, covers: ['Menu data'] },
];
const PLAN = {
  goal: 'A menu.',
  milestones: [{ id: 'ms-1', title: 'Menu', doneWhen: 'The menu is in.' }],
  tasks: [{ id: 'p-1', title: 'Menu data', owner: 'office-manager', files: ['src/menu'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' }],
  checklist: CHECKLIST,
  note: null,
  cites: [] as string[],
};

/** A medium company, whose plan gets the office's final review (the CEO's, with no checker seat), approved and handed out. */
async function started(plan: unknown = PLAN): Promise<Rig> {
  const r = await rig({ running: true, planApproval: 'before-work', org: { size: 'medium' } });
  const proposed = r.company.proposePlan('ceo', plan);
  if (!proposed.ok) throw new Error(proposed.errors.join('\n'));
  r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
  r.desks().deliverAll();
  await settled();
  r.desks().events.turn('ceo', ended('The plan is proposed.'));
  return r;
}

const taskBy = (r: Rig, planTask: string): Task => {
  const t = r.company.view().tasks.find((x) => x.planTask === planTask);
  if (!t) throw new Error(`No task for ${planTask}.`);
  return t;
};
const taskIn = (r: Rig, id: string): Task | undefined => r.company.view().tasks.find((x) => x.id === id);
const followUps = (r: Rig, kind: string): Task[] => r.company.view().tasks.filter((t) => t.followUp?.kind === kind);
const turnsOf = (r: Rig, person: string) => r.desks().turns.filter((t) => t.plan.person.id === person);
const lastTurn = (r: Rig, person: string): string => turnsOf(r, person).at(-1)?.turn.text ?? '';

/** The maker's task done, so the final review is the one open task. */
async function built(r: Rig): Promise<Task> {
  r.company.report('office-manager', { taskId: taskBy(r, 'p-1').id, outcome: 'done', text: '', form: CLEAN });
  await flush(r);
  r.desks().deliverAll();
  return taskBy(r, 'p-2');
}

const verdict = (item: string, v: VerdictInput['verdict'], evidence: string, extra: Partial<VerdictInput> = {}): VerdictInput => ({ item, verdict: v, evidence, files: [], check: null, page: null, ...extra });

function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('It was not refused.');
}

describe('the checklist in the plan', () => {
  it('is kept on the CEO’s plan with covers by id, shown unchecked on the view, and in the company brief', async () => {
    const r = await started();
    const version = r.company.view().steering?.plan?.versions.at(-1);
    expect(version?.plan.checklist).toEqual([CHECKLIST[0], { ...CHECKLIST[1], covers: ['p-1'] }]);
    const view = r.company.view().checklist;
    expect(view?.version).toBe(1);
    expect(view?.counts).toEqual({ met: 0, partly: 0, 'not-met': 0, unchecked: 2 });
    expect(view?.rows.map((row) => [row.id, row.state, row.tasks.map((t) => [t.planTask, t.status])])).toEqual([
      ['k-1', 'unchecked', [['p-1', 'working']]],
      ['k-2', 'unchecked', [['p-1', 'working']]],
    ]);
    const brief = readFileSync(briefFile(r.root), 'utf8');
    expect(brief).toContain('## Checklist');
    expect(brief).toContain('- k-1: Every drink has a price. Their words: “every drink with its price”. Covered by “Menu data”.');
  });

  it('is refused when the CEO sends none, with the fix', async () => {
    const r = await rig({ running: true, planApproval: 'before-work', org: { size: 'medium' } });
    const { checklist: _, ...bare } = PLAN;
    expect(r.company.proposePlan('ceo', bare)).toEqual({
      ok: false,
      errors: ['The plan has no checklist; list each thing the stakeholder asked for as a short checkable sentence, quoting their words, with the tasks that cover it.'],
    });
  });

  it('is carried through the stakeholder’s edit that doesn’t send it, and the CEO hears of an item left uncovered', async () => {
    const r = await started();
    const { checklist: _, ...sent } = PLAN;
    const edit = r.company.editPlan(STAKEHOLDER, { plan: { ...sent, tasks: [...PLAN.tasks, { id: 'p-s1', title: 'Opening hours', owner: 'office-manager', files: ['src/hours'], milestone: 'ms-1', after: [], brief: 'Add them.', doneWhen: 'They show.' }] }, note: null });
    if (!edit.ok) throw new Error(edit.errors.join('\n'));
    expect(edit.version.plan.checklist?.map((k) => k.id)).toEqual(['k-1', 'k-2']);
    const cut = r.company.editPlan(STAKEHOLDER, { plan: { ...sent, tasks: [{ id: 'p-s1', title: 'Opening hours', owner: 'office-manager', files: ['src/hours'], milestone: 'ms-1', after: [], brief: 'Add them.', doneWhen: 'They show.' }] }, note: null });
    if (!cut.ok) throw new Error(cut.errors.join('\n'));
    expect(cut.version.plan.checklist?.map((k) => k.covers)).toEqual([[], []]);
    expect(lastTurn(r, 'ceo')).toContain('No task covers the checklist items “Every drink has a price.” (k-1), “The menu lists a flat white.” (k-2) yet; cover them if you revise the plan.');
  });
});

describe('mark_checklist', () => {
  it('asks the final review for a verdict on every item, in its steps', async () => {
    const r = await started();
    const review = await built(r);
    const turn = turnsOf(r, 'ceo').find((t) => t.turn.text.includes(`New task ${review.id}`))?.turn.text ?? '';
    expect(turn).toContain('3. Judge every item of the checklist in the company brief with mark_checklist: met, partly or not met, with its evidence.');
    expect(turn).not.toContain("List every requirement of Robin's request");
  });

  it('keeps the verdicts with their evidence, newest per item, and logs one decision', async () => {
    const r = await started();
    const review = await built(r);
    const first = r.company.markChecklist('ceo', {
      task: review.id,
      items: [verdict('k-1', 'met', 'Each drink shows its price.', { files: ['src/menu/items.ts'], check: { ran: 'npm test', passed: true }, page: '/menu' }), verdict('k-2', 'not-met', 'No flat white in src/menu/items.ts.')],
    });
    expect(first).toEqual([
      { item: 'k-1', version: 1, verdict: 'met', evidence: { note: 'Each drink shows its price.', check: { ran: 'npm test', passed: true }, files: ['src/menu/items.ts'], page: '/menu' }, by: 'ceo', task: review.id, at: Date.now() },
      { item: 'k-2', version: 1, verdict: 'not-met', evidence: { note: 'No flat white in src/menu/items.ts.', check: null, files: [], page: null }, by: 'ceo', task: review.id, at: Date.now() },
    ]);
    expect(r.company.view().steering?.decisions.at(-1)).toMatchObject({ kind: 'decide', by: 'ceo', what: 'Noor judged two checklist items in the final review: 1 met and 1 not met.', links: { task: review.id, planVersion: 1 } });
    vi.advanceTimersByTime(1_000);
    r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-2', 'partly', 'A flat white, but no price.')] });
    expect(r.company.view().checklist?.counts).toEqual({ met: 1, partly: 1, 'not-met': 0, unchecked: 0 });
    await settled();
    expect(readFileSync(briefFile(r.root), 'utf8')).toContain('k-2: The menu lists a flat white. Covered by “Menu data”. Marked partly met.');
  });

  it('refuses anyone but the review’s owner, a task that isn’t a review, a closed one, and items the checklist hasn’t', async () => {
    const r = await started();
    const make = taskBy(r, 'p-1');
    expect(refusal(() => r.company.markChecklist('office-manager', { task: make.id, items: [verdict('k-1', 'met', 'Seen.')] })).message).toBe(
      `Task ${make.id} isn't the final review or a re-check; only the final review marks the checklist, on its own task.`,
    );
    const review = await built(r);
    const other = refusal(() => r.company.markChecklist('office-manager', { task: review.id, items: [verdict('k-1', 'met', 'Seen.')] }));
    expect(other).toMatchObject({ code: 'not-allowed', message: `Task ${review.id} is Noor's; Tia can mark the checklist on only their own tasks.` });
    expect(refusal(() => r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-9', 'met', 'Seen.')] })).message).toBe(
      'The checklist of version 1 has no item "k-9"; its items are k-1 and k-2, as the company brief lists them.',
    );
    expect(refusal(() => r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Seen.'), verdict('k-1', 'partly', 'Again.')] })).message).toBe('k-1 is marked twice; mark each item once.');
    expect(refusal(() => r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', '  ')] })).message).toBe('Say in evidence what you saw for k-1: what you ran or opened, and what it showed.');
    expect(refusal(() => r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Seen.', { page: 'https://evil.example/' })] })).message).toBe(
      'The page for k-1 is a path on the preview, like "/menu", of up to 200 characters.',
    );
    expect(refusal(() => r.company.markChecklist('ceo', { task: review.id, items: [] })).message).toBe('Mark at least one checklist item.');
    // Nothing of the refused calls was kept.
    expect(r.company.view().checklist?.counts.unchecked).toBe(2);
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    await flush(r);
    expect(refusal(() => r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Seen.')] })).message).toBe(
      `Task ${review.id} is already done; mark the checklist before you report the review.`,
    );
  });

  it('is refused on a plan without a checklist, whose review keeps the old steps', async () => {
    const r = await started();
    // The stakeholder's edit that sends an empty checklist leaves the plan, final review and all, without one.
    const first = r.company.view().steering?.plan?.versions[0]?.plan;
    const edit = r.company.editPlan(STAKEHOLDER, { plan: { ...first, checklist: [] }, note: null });
    if (!edit.ok) throw new Error(edit.errors.join('\n'));
    r.company.approvePlan(STAKEHOLDER, { version: 2, through: null, cites: [] });
    const review = await built(r);
    expect(r.company.view().checklist).toBeNull();
    expect(refusal(() => r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Seen.')] })).message).toBe(
      'The plan has no checklist to mark; report each requirement as an open line instead.',
    );
    expect(lastTurn(r, 'ceo')).toContain("3. List every requirement of Robin's request, one by one, as pass or fail");
  });
});

describe('the verdicts in the final review', () => {
  it('send an item not met back to its maker as a fix, then a re-check, and the CEO hears the counts at the finish', async () => {
    const r = await started();
    const review = await built(r);
    r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Each drink shows its price.'), verdict('k-2', 'not-met', 'No flat white in src/menu/items.ts.')] });
    // The report says nothing open: the office adds the line from the verdict, so the verdict counts.
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read the diff', passed: true } } });
    await flush(r);
    const line = 'p-1 The menu lists a flat white: No flat white in src/menu/items.ts.';
    expect(r.company.view().reports.at(-1)?.open).toEqual([line]);
    expect(taskIn(r, review.id)).toMatchObject({ status: 'done', outcome: '1 requirement failed and went back to their makers.' });
    const [fix] = followUps(r, 'fix');
    expect(fix?.followUp).toEqual({ kind: 'fix', verification: review.id, items: [line], round: 1, maker: fix?.followUp?.maker, batch: review.id });
    expect(fix?.followUp?.maker).toMatch(/^t-\d+$/);
    expect(fix?.owner).toBe('office-manager');
    expect(r.company.view().done).toBeNull();

    r.desks().deliverAll();
    r.company.report('office-manager', { taskId: fix?.id ?? '', outcome: 'done', text: '', form: CLEAN });
    await flush(r);
    const [recheck] = followUps(r, 'recheck');
    expect(lastTurn(r, 'ceo')).toContain('Mark the checklist items they belong to again with mark_checklist.');
    r.company.markChecklist('ceo', { task: recheck?.id ?? '', items: [verdict('k-2', 'met', 'The flat white is on the menu now.')] });
    r.company.report('ceo', { taskId: recheck?.id ?? '', outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read the fix', passed: true } } });
    r.desks().events.turn('ceo', ended('Re-checked.'));
    await flush(r);
    expect(r.company.view().done).not.toBeNull();
    expect(r.company.view().checklist?.counts).toEqual({ met: 2, partly: 0, 'not-met': 0, unchecked: 0 });
    expect(lastTurn(r, 'ceo')).toContain('the final review passed. The checklist: 2 met, 0 partly met, 0 not met. Report to Robin');
  });

  it('add nothing for an item an open line already names, and leave an unmarked item unchecked, never passed', async () => {
    const r = await started();
    const review = await built(r);
    r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-2', 'partly', 'A flat white, but no price.')] });
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: ['p-1: the flat white has no price'], check: { ran: 'read', passed: false } } });
    await flush(r);
    expect(r.company.view().reports.at(-1)?.open).toEqual(['p-1: the flat white has no price']);
    expect(followUps(r, 'fix')).toHaveLength(1);
    expect(r.company.view().checklist?.counts).toEqual({ met: 0, partly: 1, 'not-met': 0, unchecked: 1 });
  });

  it('counts an item nobody marked as not checked in the CEO’s finish', async () => {
    const r = await started();
    const review = await built(r);
    r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Each drink shows its price.')] });
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    r.desks().events.turn('ceo', ended('Reviewed.'));
    await flush(r);
    expect(r.company.view().done).not.toBeNull();
    expect(lastTurn(r, 'ceo')).toContain('The checklist: 1 met, 0 partly met, 0 not met, 1 not checked.');
  });

  it('survive a new version of the plan: unchanged items keep theirs, and an open review keeps judging its own version', async () => {
    const r = await started();
    const review = await built(r);
    r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Each drink shows its price.'), verdict('k-2', 'not-met', 'No flat white in src/menu/items.ts.')] });
    // The stakeholder rewrites k-1 while the review is open, and approves the new version.
    const first = r.company.view().steering?.plan?.versions[0]?.plan;
    if (!first?.checklist) throw new Error('no checklist');
    const checklist = first.checklist.map((k) => (k.id === 'k-1' ? { ...k, text: 'Every drink has a price in francs.' } : k));
    const edit = r.company.editPlan(STAKEHOLDER, { plan: { ...first, checklist }, note: null });
    if (!edit.ok) throw new Error(edit.errors.join('\n'));
    r.company.approvePlan(STAKEHOLDER, { version: 2, through: null, cites: [] });
    await flush(r);
    // k-2 is unchanged, so its "not met" stands on version 2; the rewritten k-1 starts unchecked.
    expect(r.company.view().checklist?.version).toBe(2);
    expect(r.company.view().checklist?.rows.map((row) => [row.id, row.state])).toEqual([
      ['k-1', 'unchecked'],
      ['k-2', 'not-met'],
    ]);
    // The review marks on the version it began on, and its "not met" still sends the item back.
    expect(r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Still priced.')] })[0]?.version).toBe(1);
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read the diff', passed: true } } });
    await flush(r);
    expect(r.company.view().reports.at(-1)?.open).toEqual(['p-1 The menu lists a flat white: No flat white in src/menu/items.ts.']);
    expect(followUps(r, 'fix')).toHaveLength(1);
    expect(r.company.view().done).toBeNull();
  });

  it('refuse a clean re-check that left an item it re-checks marked not met', async () => {
    const r = await started();
    const review = await built(r);
    r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Each drink shows its price.'), verdict('k-2', 'not-met', 'No flat white.')] });
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    await flush(r);
    const [fix] = followUps(r, 'fix');
    r.desks().deliverAll();
    r.company.report('office-manager', { taskId: fix?.id ?? '', outcome: 'done', text: '', form: CLEAN });
    await flush(r);
    const [recheck] = followUps(r, 'recheck');
    const id = recheck?.id ?? '';
    const clean = () => r.company.report('ceo', { taskId: id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read the fix', passed: true } } });
    expect(refusal(clean).message).toBe(`The checklist still has k-2 marked not met or partly met from the final review. Mark it again with mark_checklist on task ${id}, then report.`);
    expect(taskIn(r, id)?.status).not.toBe('done');
    r.company.markChecklist('ceo', { task: id, items: [verdict('k-2', 'met', 'The flat white is on the menu now.')] });
    clean();
    r.desks().events.turn('ceo', ended('Re-checked.'));
    await flush(r);
    expect(r.company.view().done).not.toBeNull();
    expect(r.company.view().checklist?.counts['not-met']).toBe(0);
  });

  it('send more failures than a report holds to a person whole, rather than fixing the ones that fit', async () => {
    const many = Array.from({ length: 9 }, (_, n) => ({ id: `k-${n + 1}`, text: `Drink ${n + 1} is on the menu.`, quote: null, covers: ['p-1'] }));
    const r = await started({ ...PLAN, checklist: many });
    const review = await built(r);
    r.company.markChecklist('ceo', { task: review.id, items: many.map((k) => verdict(k.id, 'not-met', `${k.text} It isn't.`)) });
    r.company.report('ceo', { taskId: review.id, outcome: 'done', text: '', form: { files: [], open: [], check: { ran: 'read', passed: true } } });
    await flush(r);
    const open = r.company.view().reports.at(-1)?.open ?? [];
    expect(open).toHaveLength(8);
    expect(open.at(-1)).toBe('And 2 more requirements not met or partly met: the checklist lists each one.');
    expect(followUps(r, 'fix')).toHaveLength(0);
    expect(taskIn(r, review.id)?.status).not.toBe('done');
    expect(r.company.view().checklist?.counts['not-met']).toBe(9);
  });

  it('survive a restart', async () => {
    const r = await started();
    const review = await built(r);
    r.company.markChecklist('ceo', { task: review.id, items: [verdict('k-1', 'met', 'Each drink shows its price.'), verdict('k-2', 'partly', 'No price on it.')] });
    const copy = crashCopy(r.root);
    await r.company.close();
    const again = r.reopen(copy);
    try {
      await again.idle();
      expect(again.view().checklist?.rows.map((row) => [row.id, row.state, row.verdict?.evidence.note])).toEqual([
        ['k-1', 'met', 'Each drink shows its price.'],
        ['k-2', 'partly', 'No price on it.'],
      ]);
    } finally {
      await again.close();
    }
  });
});
