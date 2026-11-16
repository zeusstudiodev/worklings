// What keeps a company from stalling and overspending (benchmark run 1, 12 Nov 2026): a turn that ends with the work
// under way and no report reaches the person's manager; work that stops with tasks open is called stalled and the CEO
// is told once; and a plan whose every task and milestone is done marks the company done and asks the CEO to report.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AssignInput, type DeskView, STAKEHOLDER, type Task } from '../src/core/company.ts';
import { STALL_MS } from '../src/company/company.ts';
import { ended, rig, type Rig } from './company-kit.ts';

const START = new Date('2026-11-12T11:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Lets what a change brings due run: the company settles after every change, before anyone hears of it. */
const settled = () => vi.advanceTimersByTimeAsync(0);

const work = (to: string, files: string[], extra: Partial<AssignInput> = {}): AssignInput => ({
  to, title: 'Palette review', brief: 'Review the palette against the brand.', files, doneWhen: 'A verdict is in.', parent: null, milestone: null, worktree: false, ...extra,
});

const deskOf = (person: string, state: DeskView['state']): DeskView => ({ person, state, sessionId: null, since: 1, context: null, problem: null, queue: null });

/** The words of the turns a person was handed, as "From the office: ...". */
const told = (r: Rig, person: string): string[] => r.desks().textsFor(person);
const officeTo = (r: Rig, person: string): string[] => told(r, person).filter((t) => t.startsWith('From the office: '));
/** What the CEO heard about stalls. */
const stallsTold = (r: Rig): string[] => officeTo(r, 'ceo').filter((t) => t.startsWith('From the office: Work has stopped'));
const taskIn = (r: Rig, id: string): Task => {
  const t = r.company.view().tasks.find((x) => x.id === id);
  if (!t) throw new Error(`No task ${id}.`);
  return t;
};

/** Kai's palette review, handed to him by Ada and under way. */
async function underWay(): Promise<{ r: Rig; task: Task }> {
  const r = await rig({ running: true });
  const task = r.company.assign('head-of-design', work('ui-designer', ['src/styles']));
  r.desks().deliverAll();
  await settled();
  return { r, task };
}

describe('a turn that ends with the work under way and no report', () => {
  it("tells the manager with the turn's last words, keeps them on the task, and wakes a manager who stopped to wait", async () => {
    const { r, task } = await underWay();
    // Ada handed the work out and ended her turn waiting on it.
    r.desks().events.turn('head-of-design', ended('Kai has the palette review; I will wait for it.'));
    const before = r.desks().turns.filter((t) => t.plan.person.id === 'head-of-design').length;
    vi.advanceTimersByTime(5_000);
    r.desks().events.turn('ui-designer', ended('Verdict: approve, no blockers. Contrast passes AA on every pair.'));
    await settled();

    expect(taskIn(r, task.id)).toMatchObject({ status: 'working', note: { at: Date.now(), text: 'Verdict: approve, no blockers. Contrast passes AA on every pair.' } });
    expect(officeTo(r, 'head-of-design')).toEqual([
      `From the office: Kai's turn ended with task ${task.id}, "Palette review", still under way and no report on it. Their last words:\nVerdict: approve, no blockers. Contrast passes AA on every pair.\nAsk Kai to report on it, or act on what they said if that settles it.`,
    ]);
    expect(r.desks().turns.filter((t) => t.plan.person.id === 'head-of-design')).toHaveLength(before + 1);
  });

  it('tells the CEO when the person is a head, with only the first 400 characters', async () => {
    const r = await rig({ running: true });
    const task = r.company.assign('ceo', work('head-of-design', ['src/styles'], { title: 'Brand review' }));
    r.desks().deliverAll();
    r.desks().events.turn('head-of-design', ended(`Looked at it. ${'The palette holds up. '.repeat(40)}`));
    await settled();
    const note = taskIn(r, task.id).note;
    expect(note?.text.length).toBeLessThanOrEqual(400);
    expect(note?.text.startsWith('Looked at it. The palette holds up.')).toBe(true);
    expect(officeTo(r, 'ceo').at(-1)).toContain(`Ada's turn ended with task ${task.id}, "Brand review", still under way and no report on it.`);
    expect(officeTo(r, 'ceo').at(-1)).toContain(note?.text);
  });

  it('tells nobody when they reported in the turn', async () => {
    const { r, task } = await underWay();
    r.company.report('ui-designer', { taskId: task.id, outcome: 'progress', text: 'Half the pairs checked.' });
    r.desks().events.turn('ui-designer', ended('Half done.'));
    await settled();
    expect(officeTo(r, 'head-of-design')).toEqual([]);
    expect(taskIn(r, task.id).note).toBeUndefined();
  });

  it('tells nobody when they wrote to their manager or wait for the stakeholder', async () => {
    const { r } = await underWay();
    r.company.message('ui-designer', 'head-of-design', 'Should the accent stay orange?');
    r.desks().events.turn('ui-designer', ended('Asked Ada about the accent.'));
    await settled();
    r.desks().deliverAll();
    void r.company.requestApproval('ui-designer', { tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push', kind: 'push', expiresAt: Date.now() + 600_000, alwaysRule: null });
    vi.advanceTimersByTime(1_000);
    r.desks().events.turn('ui-designer', ended('Waiting for Robin.'));
    await settled();
    expect(officeTo(r, 'head-of-design')).toEqual([]);
  });

  it('tells the manager once while the task stays as it is, and again after it changes', async () => {
    const { r, task } = await underWay();
    r.desks().events.turn('ui-designer', ended('First pass done.'));
    await settled();
    r.desks().deliverAll();
    vi.advanceTimersByTime(1_000);
    r.desks().events.turn('ui-designer', ended('Second pass done.'));
    await settled();
    expect(officeTo(r, 'head-of-design')).toHaveLength(1);
    expect(taskIn(r, task.id).note?.text).toBe('Second pass done.');

    vi.advanceTimersByTime(1_000);
    r.company.report('ui-designer', { taskId: task.id, outcome: 'progress', text: 'Contrast fixed.' });
    r.desks().deliverAll();
    vi.advanceTimersByTime(1_000);
    r.desks().events.turn('ui-designer', ended('Fixed the contrast.'));
    vi.advanceTimersByTime(1_000);
    r.desks().events.turn('ui-designer', ended('Third pass done.'));
    await settled();
    expect(officeTo(r, 'head-of-design')).toHaveLength(2);
    expect(officeTo(r, 'head-of-design').at(-1)).toContain('Third pass done.');
  });

  it('keeps a failed turn to the desk, which says why', async () => {
    const { r, task } = await underWay();
    r.desks().events.turn('ui-designer', ended('API error', false));
    await settled();
    expect(officeTo(r, 'head-of-design')).toEqual([]);
    expect(taskIn(r, task.id).note).toBeUndefined();
  });
});

describe('work that stops with tasks open', () => {
  /** Kai's turn ended without a report, Ada heard and ended hers, and so did the CEO: nobody is at work and nothing waits. */
  async function stopped(): Promise<{ r: Rig; task: Task }> {
    const { r, task } = await underWay();
    r.desks().events.turn('ceo', ended('The heads have their parts.'));
    r.company.postStatus('ui-designer', 'Checking the contrast of every pair.', task.id);
    r.desks().events.turn('ui-designer', ended('Approve, no blockers.'));
    await settled();
    r.desks().deliverAll();
    r.desks().events.turn('head-of-design', ended('I will wait for Kai to report.'));
    await settled();
    return { r, task };
  }

  it('tells the CEO after a minute which tasks are open, whose and their last statuses', async () => {
    const { r, task } = await stopped();
    await vi.advanceTimersByTimeAsync(STALL_MS - 1_000);
    expect(stallsTold(r)).toEqual([]);
    expect(r.company.view().stalled).toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(stallsTold(r)).toEqual([
      [
        'From the office: Work has stopped: for a minute nobody has been at work and nothing has waited for Robin, but these tasks are still open:',
        `- ${task.id}, "Palette review": Kai, UI designer, working; last status "Checking the contrast of every pair."`,
        'Find out what each one waits on and get it moving: ask its owner or their manager, review what is ready, or drop what no longer matters with steer_task. If a decision only Robin can make is missing, ask Robin.',
      ].join('\n'),
    ]);
    expect(r.company.view().log.at(-1)).toMatchObject({ kind: 'stalled', text: `Stalled: ${task.id} waits on Kai.` });
  });

  it('shows the stall in the view once it has lasted a minute, and not while the CEO works on it', async () => {
    const { r, task } = await stopped();
    const since = Date.now();
    await vi.advanceTimersByTimeAsync(STALL_MS);
    // The CEO's turn is on its way: something moves, so the office no longer shows a stall.
    expect(r.company.view().stalled).toBeNull();
    r.desks().deliverAll();
    r.desks().events.turn('ceo', ended('Asked Ada to chase it.'));
    await settled();
    const again = Date.now();
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(r.company.view().stalled).toEqual({
      since: again,
      tasks: [{ id: task.id, title: 'Palette review', owner: 'ui-designer', status: 'working', lastStatus: 'Checking the contrast of every pair.' }],
      text: `Stalled: ${task.id} waits on Kai.`,
    });
    expect(since).toBeLessThan(again);
  });

  it('tells the CEO once per stall, not after every idle turn, and again when the open work changed', async () => {
    const { r, task } = await stopped();
    await vi.advanceTimersByTimeAsync(STALL_MS);
    for (let i = 0; i < 3; i += 1) {
      r.desks().deliverAll();
      r.desks().events.turn('ceo', ended('Nothing to add.'));
      await vi.advanceTimersByTimeAsync(STALL_MS * 2);
    }
    expect(stallsTold(r)).toHaveLength(1);

    // Kai reports progress: the task changed, so a later stop is a new stall.
    r.company.report('ui-designer', { taskId: task.id, outcome: 'progress', text: 'Half the pairs pass.' });
    r.desks().deliverAll();
    r.desks().events.turn('head-of-design', ended('Noted.'));
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(stallsTold(r)).toHaveLength(2);
  });

  it('calls nothing stalled while someone works, the inbox holds a question, or the company is paused', async () => {
    const { r } = await stopped();
    r.desks().views = [deskOf('ui-designer', 'working')];
    r.desks().events.desk(deskOf('ui-designer', 'working'));
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    expect(stallsTold(r)).toEqual([]);

    r.desks().views = [];
    r.company.askStakeholder('ceo', { text: 'Ship the palette as it is?', options: ['Yes', 'No'], recommended: 0, taskId: null });
    r.desks().events.desk(deskOf('ui-designer', 'idle'));
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    expect(stallsTold(r)).toEqual([]);
    expect(r.company.view().stalled).toBeNull();
  });

  it('calls nothing stalled while the stakeholder has paused work', async () => {
    const { r } = await stopped();
    r.company.pause();
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    expect(stallsTold(r)).toEqual([]);
    r.company.resume();
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(stallsTold(r)).toHaveLength(1);
  });

  it('counts a desk that failed as stopped', async () => {
    const { r, task } = await underWay();
    r.desks().events.turn('ceo', ended('The heads have their parts.'));
    r.desks().events.turn('head-of-design', ended('Kai has it.'));
    r.desks().views = [deskOf('ui-designer', 'failed')];
    r.desks().events.desk(deskOf('ui-designer', 'failed'));
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(stallsTold(r).at(-1)).toContain(`- ${task.id}, "Palette review": Kai, UI designer, working; last status "Started Palette review."`);
  });
});

describe('the end of the plan', () => {
  /** A goal of one milestone with Ada's task in it, which she reports done and the CEO accepts. */
  async function finishedPlan(): Promise<{ r: Rig; task: Task }> {
    const r = await rig({ running: true });
    const goal = r.company.setGoal('ceo', { text: 'A palette the brand can live with.', milestones: [{ title: 'Palette settled', doneWhen: 'The palette is in the styles.' }] });
    const task = r.company.assign('ceo', work('head-of-design', ['src/styles'], { title: 'Palette', milestone: goal.milestones[0]?.id ?? null }));
    r.desks().deliverAll();
    r.company.report('head-of-design', { taskId: task.id, outcome: 'done', text: 'The palette is in.' });
    expect(r.company.view().done).toBeNull();
    r.company.review('ceo', { taskId: task.id, verdict: 'accept', note: '' });
    await r.company.idle();
    await settled();
    return { r, task };
  }

  it('marks the company done once every task and milestone is, and asks the CEO to report to the stakeholder', async () => {
    const { r } = await finishedPlan();
    const view = r.company.view();
    expect(view.done).toBe(Date.now());
    expect(view.log.at(-1)).toMatchObject({ kind: 'finished', text: 'The plan is finished: every task and milestone is done.' });
    expect(officeTo(r, 'ceo').at(-1)).toBe(
      "From the office: Every task of the plan is done, and every milestone with it: the plan is finished. Report to Robin with report and no task, in the final handover's shape from your house rules: what was built, how to open or run it, what is not done, what it cost against the estimate. So far the company cost $0.00 (API-equivalent, not a bill); the estimate was $2.45 to $24.75. Then wait: nobody needs new work unless Robin asks for more.",
    );
    // The CEO's report reaches the stakeholder.
    const report = r.company.report('ceo', { taskId: null, outcome: 'done', text: 'The palette is settled and in the styles.' });
    expect(report.to).toBe(STAKEHOLDER);
  });

  it('waits while a commit is still being made, and tells the CEO once', async () => {
    const r = await rig({ running: true });
    r.git.hold = true;
    const goal = r.company.setGoal('ceo', { text: 'A palette.', milestones: [{ title: 'Palette settled', doneWhen: 'In the styles.' }] });
    const task = r.company.assign('ceo', work('head-of-design', ['src/styles'], { title: 'Palette', milestone: goal.milestones[0]?.id ?? null }));
    r.desks().deliverAll();
    r.company.report('head-of-design', { taskId: task.id, outcome: 'done', text: 'In.' });
    r.company.review('ceo', { taskId: task.id, verdict: 'accept', note: '' });
    await settled();
    expect(r.company.view().done).toBeNull();
    r.git.release();
    await r.company.idle();
    await settled();
    expect(r.company.view().done).toBe(Date.now());
    await vi.advanceTimersByTimeAsync(STALL_MS * 5);
    expect(officeTo(r, 'ceo').filter((t) => t.includes('the plan is finished'))).toHaveLength(1);
    expect(r.company.view().stalled).toBeNull();
  });

  it('opens again when new work comes in', async () => {
    const { r } = await finishedPlan();
    const milestone = r.company.view().goal?.milestones[0]?.id ?? null;
    r.company.assign('ceo', work('head-of-design', ['src/icons'], { title: 'Icons', milestone }));
    await settled();
    expect(r.company.view().done).toBeNull();
  });

  it("isn't done while a milestone has no tasks, or a task is still open", async () => {
    const r = await rig({ running: true });
    const goal = r.company.setGoal('ceo', {
      text: 'A palette and its icons.',
      milestones: [
        { title: 'Palette settled', doneWhen: 'In the styles.' },
        { title: 'Icons drawn', doneWhen: 'In the icons folder.' },
      ],
    });
    const task = r.company.assign('ceo', work('head-of-design', ['src/styles'], { title: 'Palette', milestone: goal.milestones[0]?.id ?? null }));
    r.company.assign('ceo', work('head-of-engineering', ['src/app.ts'], { title: 'Wire it in' }));
    r.desks().deliverAll();
    r.company.report('head-of-design', { taskId: task.id, outcome: 'done', text: 'In.' });
    r.company.review('ceo', { taskId: task.id, verdict: 'accept', note: '' });
    await r.company.idle();
    await settled();
    expect(r.company.view().goal?.milestones.map((m) => m.doneAt !== null)).toEqual([true, false]);
    expect(r.company.view().done).toBeNull();
    expect(officeTo(r, 'ceo').some((t) => t.includes('the plan is finished'))).toBe(false);
  });
});
