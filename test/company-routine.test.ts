// Office work by code (v0.2): a routine report is recorded by the office and its manager hears in their next real turn
// instead of being woken. Code reads the report's form (done, a passed check, nothing open): a blocker, an open item, a
// failed check, a verdict, a legacy free-text report or, for a head, the last open task still wake the manager; the CEO
// sleeps through all of it until a milestone's end or the plan's. The notices that ask nothing ride along with the next turn.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AssignInput, STAKEHOLDER, type Task } from '../src/core/company.ts';
import { houseRules } from '../src/company/house-rules.ts';
import { crashCopy, ended, rig, type Rig } from './company-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T10:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const settled = () => vi.advanceTimersByTimeAsync(0);

const work = (to: string, files: string[], extra: Partial<AssignInput> = {}): AssignInput => ({
  to, title: 'Palette', brief: 'The palette.', files, doneWhen: 'The palette is in the styles.', parent: null, milestone: null, worktree: false, ...extra,
});

/** A clean form: the check passed, nothing is open. */
const clean = { files: [], open: [], check: { ran: 'npm test', passed: true } };

const taskIn = (r: Rig, id: string): Task => {
  const t = r.company.view().tasks.find((x) => x.id === id);
  if (!t) throw new Error(`No task ${id}.`);
  return t;
};
const turnsOf = (r: Rig, person: string) => r.desks().turns.filter((t) => t.plan.person.id === person);
/** The raw words of every turn Ada was handed. */
const adaTexts = (r: Rig): string[] => turnsOf(r, 'head-of-design').map((t) => t.turn.text);

/** Ada asked Kai for the palette and Lea for the flow; both turns went out. */
async function twoTasks(): Promise<{ r: Rig; palette: Task; flow: Task }> {
  const r = await rig({ running: true });
  const palette = r.company.assign('head-of-design', work('ui-designer', ['src/styles']));
  const flow = r.company.assign('head-of-design', work('ux-designer', ['docs/flow.md'], { title: 'Flow', doneWhen: 'The flow is mapped.' }));
  r.desks().deliverAll();
  await settled();
  return { r, palette, flow };
}

describe('a routine report', () => {
  it('closes the task and lands its files, and wakes nobody', async () => {
    const { r, palette } = await twoTasks();
    const before = turnsOf(r, 'head-of-design').length;
    r.company.report('ui-designer', { taskId: palette.id, outcome: 'done', text: 'Palette is in src/styles; contrast passes AA.', form: clean });
    await r.company.idle();
    await settled();
    expect(taskIn(r, palette.id)).toMatchObject({ status: 'done', outcome: 'Palette is in src/styles; contrast passes AA.' });
    expect(r.git.calls.some((c) => c[0] === 'commitTask')).toBe(true);
    expect(turnsOf(r, 'head-of-design')).toHaveLength(before);
    // What the stakeholder reads is there: the report, and the task on the board.
    expect(r.company.view().reports.at(-1)).toMatchObject({ person: 'ui-designer', to: 'head-of-design', taskId: palette.id, outcome: 'done' });
  });

  it('reaches the manager with their next real turn, once, as a compact digest', async () => {
    const { r, palette } = await twoTasks();
    r.company.report('ui-designer', { taskId: palette.id, outcome: 'done', text: 'Palette is in src/styles; contrast passes AA.', form: clean });
    r.company.report('ux-designer', { taskId: taskIdOf(r, 'Flow'), outcome: 'progress', text: 'Two of four screens mapped.', form: { files: [], open: [] } });
    expect(turnsOf(r, 'head-of-design')).toHaveLength(0);

    r.company.message('ceo', 'head-of-design', 'How is design going?');
    const turn = adaTexts(r).at(-1) ?? '';
    expect(turn).toMatch(/^From Noor, CEO \(message m-\d+\), between the two wl\w+ lines:\n/);
    expect(turn).toContain('Since your last turn the office recorded this without waking you');
    expect(turn).toContain(`- ${palette.id} "Palette" done, Kai: Palette is in src/styles; contrast passes AA.`);
    expect(turn).toContain('"Flow" progress, Lea: Two of four screens mapped.');

    r.company.message('ceo', 'head-of-design', 'And the flow?');
    expect(adaTexts(r).at(-1)).not.toContain('Since your last turn');
  });

  it('survives a restart: the digest is rebuilt from the reports and messages the log kept', async () => {
    const { r, palette } = await twoTasks();
    r.company.report('ui-designer', { taskId: palette.id, outcome: 'done', text: 'Palette is in src/styles.', form: clean });
    const copy = crashCopy(r.root);
    await r.company.close();
    const again = r.reopen(copy);
    try {
      await again.idle();
      again.message('ceo', 'head-of-design', 'Where are we?');
      const turn = r.boards.at(-1)?.turns.filter((t) => t.plan.person.id === 'head-of-design').at(-1)?.turn.text ?? '';
      expect(turn).toContain(`- ${palette.id} "Palette" done, Kai: Palette is in src/styles.`);
    } finally {
      await again.close();
    }
  });

  it('is not taken in when the form has a blocker, an open item or a failed check, or the done-when asks for a review', async () => {
    const { r, palette, flow } = await twoTasks();
    r.company.report('ui-designer', { taskId: palette.id, outcome: 'blocked', text: 'The brand colours are missing.', form: { files: [], open: ['Brand colours'] } });
    expect(taskIn(r, palette.id).status).toBe('blocked');
    expect(adaTexts(r).at(-1)).toContain(`Report on task ${palette.id}, "Palette": blocked.`);

    const again = r.company.assign('head-of-design', work('ui-designer', ['src/icons'], { title: 'Icons' }));
    r.desks().deliverAll();
    r.company.report('ui-designer', { taskId: again.id, outcome: 'done', text: 'Icons drawn.', form: { files: ['src/icons'], open: ['Stroke width: 2px or 3px?'], check: { ran: 'npm test', passed: true } } });
    expect(taskIn(r, again.id).status).toBe('review');
    expect(adaTexts(r).at(-1)).toContain(`Report on task ${again.id}, "Icons": done.`);
    expect(adaTexts(r).at(-1)).toContain('Open: Stroke width: 2px or 3px?.');

    r.company.report('ux-designer', { taskId: flow.id, outcome: 'done', text: 'Two screens fail.', form: { files: [], open: [], check: { ran: 'npm test', passed: false, tail: '2 failed' } } });
    expect(taskIn(r, flow.id).status).toBe('review');

    const asked = r.company.assign('head-of-design', work('ux-designer', ['docs/review.md'], { title: 'Copy pass', doneWhen: 'Ada has reviewed the copy.' }));
    r.desks().deliverAll();
    r.company.report('ux-designer', { taskId: asked.id, outcome: 'done', text: 'Copy is in.', form: clean });
    expect(taskIn(r, asked.id).status).toBe('review');
  });

  it('does not read the words of a note: a clean form with "failed" or a question mark in its note is still routine', async () => {
    const { r, palette } = await twoTasks();
    r.company.report('ui-designer', { taskId: palette.id, outcome: 'done', text: 'An earlier run failed on the contrast helper; fixed. Should the stroke be 2px?', form: clean });
    expect(taskIn(r, palette.id).status).toBe('done');
  });

  it('is not taken in from the old free-text form, which says nothing code can read, and still works', async () => {
    const { r, palette } = await twoTasks();
    const report = r.company.report('ui-designer', { taskId: palette.id, outcome: 'done', text: 'Palette is in.' });
    expect(report).toMatchObject({ text: 'Palette is in.' });
    expect(report.check).toBeUndefined();
    expect(taskIn(r, palette.id).status).toBe('review');
    expect(adaTexts(r).at(-1)).toContain(`Report on task ${palette.id}, "Palette": done.`);
  });

  it('cuts a long note to 600 characters, an old summary the same, and never refuses for length', async () => {
    const { r, palette, flow } = await twoTasks();
    const long = r.company.report('ui-designer', { taskId: palette.id, outcome: 'progress', text: 'x'.repeat(5_000), form: { files: Array.from({ length: 40 }, (_, i) => `f${i}.css`), open: Array.from({ length: 12 }, (_, i) => `item ${i}`) } });
    expect(long.text.length).toBeLessThanOrEqual(600);
    expect(long.files).toHaveLength(30);
    expect(long.open).toHaveLength(8);
    const old = r.company.report('ux-designer', { taskId: flow.id, outcome: 'progress', text: 'y'.repeat(4_800) });
    expect(old.text.length).toBeLessThanOrEqual(600);
  });

  it('is taken in from a checker too when its form is clean; the form, not the role, says a person must look', async () => {
    const { r } = await twoTasks();
    r.company.hire('ceo', { role: 'qa-engineer', room: 'design', reportsTo: 'head-of-design', name: 'Quinn', title: 'QA engineer' });
    const check = r.company.assign('head-of-design', work('qa-engineer', ['test/palette'], { title: 'Check it', doneWhen: 'The checks ran.' }));
    r.desks().deliverAll();
    r.company.report('qa-engineer', { taskId: check.id, outcome: 'done', text: 'All checks ran and passed.', form: clean });
    expect(taskIn(r, check.id).status).toBe('done');
  });

  it("wakes the manager when it is the last task they asked for, and when it has parts still open", async () => {
    const { r, palette, flow } = await twoTasks();
    r.company.report('ui-designer', { taskId: palette.id, outcome: 'done', text: 'Palette is in.', form: clean });
    expect(taskIn(r, palette.id).status).toBe('done');
    r.company.report('ux-designer', { taskId: flow.id, outcome: 'done', text: 'Flow is mapped.', form: clean });
    expect(taskIn(r, flow.id).status).toBe('review');
    const last = adaTexts(r).at(-1) ?? '';
    expect(last).toContain(`Report on task ${flow.id}, "Flow": done.`);
    // The earlier one rides along with this turn.
    expect(last).toContain(`- ${palette.id} "Palette" done, Kai: Palette is in.`);

    const r2 = await rig({ running: true });
    const parent = r2.company.assign('ceo', work('head-of-design', ['src/styles'], { title: 'Look' }));
    r2.company.assign('ceo', work('head-of-engineering', ['src/app'], { title: 'App' }));
    const part = r2.company.assign('head-of-design', work('ui-designer', ['src/styles/a.css'], { title: 'Part', parent: parent.id }));
    r2.desks().deliverAll();
    r2.company.report('head-of-design', { taskId: parent.id, outcome: 'done', text: 'Look is done.', form: clean });
    expect(taskIn(r2, parent.id).status).toBe('review');
    expect(taskIn(r2, part.id).status).not.toBe('done');
  });
});

const taskIdOf = (r: Rig, title: string): string => {
  const t = r.company.view().tasks.find((x) => x.title === title);
  if (!t) throw new Error(`No task ${title}.`);
  return t.id;
};

describe('the plan with routine reports', () => {
  it('lets the CEO sleep: a milestone brings one digest, the last task nothing, and the plan its final handover', async () => {
    const r = await rig({ running: true });
    const goal = r.company.setGoal('ceo', {
      text: 'A palette and a flow.',
      milestones: [{ title: 'Design', doneWhen: 'Both are in.' }, { title: 'Wire', doneWhen: 'It is wired.' }],
    });
    const [design, wire] = goal.milestones.map((m) => m.id);
    const a = r.company.assign('ceo', work('head-of-design', ['src/styles'], { title: 'Palette', milestone: design ?? null }));
    const b = r.company.assign('ceo', work('head-of-design', ['docs/flow.md'], { title: 'Flow', milestone: design ?? null }));
    const c = r.company.assign('ceo', work('head-of-engineering', ['src/app'], { title: 'Wire', milestone: wire ?? null }));
    r.desks().deliverAll();
    await settled();
    const ceoBefore = turnsOf(r, 'ceo').length;

    // The first done is routine: the CEO sleeps.
    r.company.report('head-of-design', { taskId: a.id, outcome: 'done', text: 'Palette is in.', form: clean });
    expect(taskIn(r, a.id).status).toBe('done');
    expect(turnsOf(r, 'ceo')).toHaveLength(ceoBefore);
    // The second finishes the milestone: still no report turn, but the milestone's one digest, with both reports in it.
    r.company.report('head-of-design', { taskId: b.id, outcome: 'done', text: 'Flow is mapped.', form: clean });
    expect(taskIn(r, b.id).status).toBe('done');
    await settled();
    expect(turnsOf(r, 'ceo')).toHaveLength(ceoBefore + 1);
    const digest = turnsOf(r, 'ceo').at(-1)?.turn.text ?? '';
    expect(digest).toContain(`Milestone ${design} "Design" is done.`);
    expect(digest).toContain(`- ${a.id} "Palette" done, Ada: Palette is in.`);
    expect(digest).toContain(`- ${b.id} "Flow" done, Ada: Flow is mapped.`);

    // The last task of the last milestone is routine too; the plan's end is what wakes the CEO, once.
    r.company.report('head-of-engineering', { taskId: c.id, outcome: 'done', text: 'Wired.', form: clean });
    expect(taskIn(r, c.id).status).toBe('done');
    await r.company.idle();
    await settled();
    expect(r.company.view().done).toBe(Date.now());
    const finish = turnsOf(r, 'ceo').at(-1)?.turn.text ?? '';
    expect(finish).toContain('the plan is finished. Report to Robin with report and no task');
    expect(finish).toContain('what was built, how to open or run it, what is not done, what it cost against the estimate');
    expect(turnsOf(r, 'ceo')).toHaveLength(ceoBefore + 2);
    // And the CEO's final report still reaches the stakeholder.
    expect(r.company.report('ceo', { taskId: null, outcome: 'done', text: 'Built and checked.' }).to).toBe(STAKEHOLDER);
  });
});

describe('what the office writes itself', () => {
  it('posts the start status line from the task, and no longer asks people for one', async () => {
    const { r, palette } = await twoTasks();
    expect(r.company.view().statuses.find((s) => s.taskId === palette.id)).toMatchObject({ person: 'ui-designer', text: 'Started Palette.' });
    expect(turnsOf(r, 'ui-designer')[0]?.turn.text).not.toContain('status line');
    expect(turnsOf(r, 'ui-designer')[0]?.turn.text).toContain("Report with report when it's done or blocked.");
  });

  it('house rules keep reports short and leave status lines to the office', async () => {
    const r = await rig({ running: true });
    const plan = turnsOf(r, 'ceo')[0]?.plan ?? r.desks().turns[0]?.plan;
    const rules = plan?.systemPrompt ?? houseRules({ person: r.company.people()[0]!, people: r.company.people(), company: 'X', stakeholder: 'Robin', goal: null, roomName: (x) => x });
    expect(rules).toContain('a few lines, outcome first');
    expect(rules).toContain("Status lines are the office's");
    expect(rules).not.toContain('Post a status line');
  });

  it('keeps the notice of an approved plan out of a turn of its own, and carries it with the next one', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    const plan = {
      goal: 'A palette.',
      milestones: [{ id: 'ms-1', title: 'Palette', doneWhen: 'In.' }],
      tasks: [{ id: 'p-1', title: 'Palette', owner: 'ui-designer', files: ['src/styles'], milestone: 'ms-1', after: [], brief: 'The palette.', doneWhen: 'In.', check: 'npm test' }],
      note: null,
      cites: [] as string[],
    };
    const proposed = r.company.proposePlan('ceo', withChecklist(plan));
    expect(proposed.ok).toBe(true);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    await settled();
    expect(turnsOf(r, 'ceo').filter((t) => t.turn.text.includes('approved version 1'))).toHaveLength(0);
    expect(r.company.view().stalled).toBeNull();
    r.company.say('ceo', 'Any questions?');
    expect(turnsOf(r, 'ceo').at(-1)?.turn.text).toContain('- Robin approved version 1 of the plan.');
    r.desks().events.turn('ceo', ended('Nothing.'));
  });
});
