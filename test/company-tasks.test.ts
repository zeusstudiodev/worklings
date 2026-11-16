import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type AssignInput, type DeskPlan, type DeskView, LIMITS, OrgRefusal } from '../src/core/company.ts';
import { FakeDesks, PNG, proposal, rig, type Turn } from './company-kit.ts';

function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

const work = (to: string, files: string[], extra: Partial<AssignInput> = {}): AssignInput => ({
  to, title: 'Menu pages', brief: 'Build the menu pages in both languages.', files, doneWhen: 'Both menus render.', parent: null, milestone: null, worktree: false, ...extra,
});

const deskOf = (person: string, state: DeskView['state']): DeskView => ({ person, state, sessionId: null, since: 1, context: null, problem: null, queue: null });

/**
 * Keeps the line as the real switchboard does while the company rests: a turn handed over waits and its person's desk
 * says so, resuming hands the waiting turns over, and closing a person's desk drops the turns that wait for them.
 */
class RestingDesks extends FakeDesks {
  private resting = false;
  private line: Turn[] = [];

  override deliver(plan: DeskPlan, turn: { text: string; messageId: string | null }): void {
    if (!this.resting) {
      super.deliver(plan, turn);
      return;
    }
    this.line.push({ plan: structuredClone(plan), turn: { ...turn } });
    this.events.desk(deskOf(plan.person.id, 'waiting'));
  }

  override pause(until: number | null): void {
    super.pause(until);
    this.resting = true;
  }

  override resume(): void {
    super.resume();
    this.resting = false;
    for (const t of this.line.splice(0)) super.deliver(t.plan, t.turn);
  }

  override close(person: string): Promise<void> {
    this.line = this.line.filter((t) => t.plan.person.id !== person);
    return super.close(person);
  }

  override desks(): DeskView[] {
    const waiting = new Set(this.line.map((t) => t.plan.person.id));
    return [...super.desks().filter((d) => !waiting.has(d.person)), ...[...waiting].map((person) => deskOf(person, 'waiting'))];
  }
}

describe('tasks in a company', () => {
  it('hands the owner a turn with the title, brief, files and done-when, and starts the task when it arrives', async () => {
    const { company, desks } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu/', './src//pages\\menu.tsx']));
    expect(task).toMatchObject({ owner: 'frontend-engineer', askedBy: 'head-of-engineering', status: 'queued', files: ['src/menu', 'src/pages/menu.tsx'] });
    const turn = desks().turns.at(-1);
    expect(desks().textsFor('frontend-engineer').at(-1)).toBe(
      [
        `From Ben, head of engineering: New task ${task.id}: Menu pages`,
        '',
        'Build the menu pages in both languages.',
        '',
        'Files you may change: src/menu, src/pages/menu.tsx.',
        'Done when: Both menus render.',
        "Report with report when it's done or blocked.",
      ].join('\n'),
    );
    desks().events.delivered(turn?.turn.messageId ?? '', Date.now());
    expect(company.view().tasks.find((t) => t.id === task.id)?.status).toBe('working');
    expect(company.view().people.find((p) => p.id === 'frontend-engineer')?.task).toBe(task.id);
  });

  it('lets managers assign only to people below them', async () => {
    const { company } = await rig({ running: true });
    expect(refusal(() => company.assign('head-of-design', work('frontend-engineer', [])))).toMatchObject({
      code: 'not-allowed',
      message: 'Ada can assign work only to people below them in the org; ask Ola to give this to Sam.',
    });
    expect(refusal(() => company.assign('ui-designer', work('ux-designer', []))).code).toBe('not-allowed');
    expect(company.assign('ceo', work('frontend-engineer', ['src/menu'])).owner).toBe('frontend-engineer');
  });

  it.each([
    ['/etc/passwd', 'is an absolute path'],
    ['C:\\Users\\jamie\\notes.txt', 'is an absolute path'],
    ['../outside.ts', 'leaves the project'],
    ['src/../../outside.ts', 'leaves the project'],
    ['src/a:b.ts', "has a character a project path can't have"],
    ['.git/config', "is git's or Worklings' own folder"],
    ['.worklings/events.jsonl', "is git's or Worklings' own folder"],
    [`src/${'a'.repeat(LIMITS.path)}.ts`, `can be up to ${LIMITS.path} characters`],
  ])('refuses %s as a file a task owns', async (path, words) => {
    const { company } = await rig({ running: true });
    const refused = refusal(() => company.assign('head-of-engineering', work('frontend-engineer', [path])));
    expect(refused.code).toBe('invalid');
    expect(refused.message).toContain(words);
  });

  it('refuses more files than a task may own', async () => {
    const { company } = await rig({ running: true });
    const files = Array.from({ length: LIMITS.files + 1 }, (_, i) => `src/f${i}.ts`);
    expect(refusal(() => company.assign('head-of-engineering', work('frontend-engineer', files))).message).toContain(`up to ${LIMITS.files} files`);
  });

  it("refuses a file that already belongs to another open task, a folder's contents included, whatever the case", async () => {
    const { company, desks } = await rig({ running: true });
    const menu = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    expect(refusal(() => company.assign('head-of-design', work('ui-designer', ['src/menu/Card.tsx'], { title: 'Card styles' })))).toMatchObject({
      code: 'conflict',
      message: 'src/menu/Card.tsx already belongs to Sam\'s task "Menu pages".',
    });
    expect(refusal(() => company.assign('head-of-design', work('ui-designer', ['SRC/Menu']))).code).toBe('conflict');
    expect(refusal(() => company.assign('head-of-design', work('ui-designer', ['src']))).message).toBe('src/menu (in src) already belongs to Sam\'s task "Menu pages".');
    // Once the task is done, its files are free again.
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: menu.id, outcome: 'done', text: 'Both menus render.' });
    company.review('head-of-engineering', { taskId: menu.id, verdict: 'accept', note: '' });
    expect(company.assign('head-of-design', work('ui-designer', ['src/menu/Card.tsx'])).files).toEqual(['src/menu/Card.tsx']);
  });

  it('lets a subtask take part of the files of the task it belongs to', async () => {
    const { company } = await rig({ running: true });
    const checkout = company.assign('head-of-engineering', work('frontend-lead', ['src/checkout'], { title: 'Checkout' }));
    const pay = company.assign('frontend-lead', work('frontend-engineer', ['src/checkout/Pay.tsx'], { title: 'Pay with TWINT', parent: checkout.id }));
    expect(pay.parent).toBe(checkout.id);
    // A sibling still can't take the same file.
    expect(refusal(() => company.assign('frontend-lead', work('frontend-engineer', ['src/checkout/Pay.tsx'], { parent: checkout.id }))).code).toBe('conflict');
  });

  it('runs long work in its own worktree, handed over once git has made it, and merges it when accepted', async () => {
    const { company, desks, git, root } = await rig({ running: true });
    git.hold = true;
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { worktree: true }));
    expect(task.worktree).toBeNull();
    // Nothing reaches the owner before the worktree exists.
    await vi.waitFor(() => expect(git.calls.at(-1)?.[0]).toBe('addWorktree'));
    expect(desks().textsFor('frontend-engineer')).toEqual([]);
    git.hold = false;
    git.release();
    await company.idle();
    const worktree = join(root, '..', `worktree-${task.id}`);
    expect(company.view().tasks.find((t) => t.id === task.id)?.worktree).toEqual({ path: worktree, branch: `worklings/${company.id}--${task.id}` });
    expect(desks().turns.at(-1)?.plan.cwd).toBe(worktree);
    expect(desks().textsFor('frontend-engineer').at(-1)).toContain('It has its own worktree and branch: your desk opens there');
    desks().deliverAll();
    // Later turns for the owner run in the worktree too.
    company.say('frontend-engineer', 'How is it going?');
    expect(desks().turns.at(-1)?.plan.cwd).toBe(worktree);
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Both menus render.' });
    expect(company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' })).toMatchObject({ status: 'done', commit: null });
    await company.idle();
    expect(company.view().tasks.find((t) => t.id === task.id)?.commit).toMatch(/^bead/);
    // The worktree goes once the owner's desk is closed: Windows keeps a folder a process works in.
    expect(desks().closed).toEqual(['frontend-engineer']);
    expect(git.calls.map((c) => c[0])).toEqual(['prepareBranch', 'addWorktree', 'mergeWorktree', 'removeWorktree']);
  });

  it('waits to remove a merged worktree until its owner is off work', async () => {
    const { company, desks, git } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { worktree: true }));
    await company.idle();
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Done.' });
    const working = { person: 'frontend-engineer', state: 'working' as const, sessionId: null, since: 1, context: null, problem: null, queue: null };
    desks().views = [working];
    company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' });
    await company.idle();
    expect(git.calls.some((c) => c[0] === 'removeWorktree')).toBe(false);
    desks().views = [{ ...working, state: 'idle' }];
    desks().events.desk({ ...working, state: 'idle' });
    await company.idle();
    expect(git.calls.at(-1)?.[0]).toBe('removeWorktree');
  });

  it("keeps a message waiting for a merged worktree's owner while the company rests, and removes the worktree once they are idle", async () => {
    const { company, desks, git } = await rig({ running: true, board: RestingDesks });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { worktree: true }));
    await company.idle();
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Both menus render.' });
    // The company rests, so the stakeholder's message waits at Sam's desk while Ben accepts the work.
    company.pause();
    const held = company.say('frontend-engineer', 'Before you go on: the menu needs prices.');
    company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' });
    await company.idle();
    expect(company.view().tasks.find((t) => t.id === task.id)?.commit).toMatch(/^bead/);
    expect(git.calls.some((c) => c[0] === 'removeWorktree')).toBe(false);
    company.resume();
    expect(desks().textsFor('frontend-engineer').at(-1)).toBe('From Robin, the stakeholder: Before you go on: the menu needs prices.');
    desks().deliverAll();
    expect(company.view().messages.find((m) => m.id === held.id)?.deliveredAt).toEqual(expect.any(Number));
    // His turn over, Sam's desk idles, and the merged worktree goes.
    desks().views = [deskOf('frontend-engineer', 'idle')];
    desks().events.desk(deskOf('frontend-engineer', 'idle'));
    await company.idle();
    expect(git.calls.at(-1)?.[0]).toBe('removeWorktree');
    expect(desks().closed).toEqual(['frontend-engineer']);
  });

  it('puts a task back in review when its merge conflicts, and tells the reviewer why', async () => {
    const { company, desks, git } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { worktree: true }));
    await company.idle();
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Done.' });
    git.conflict = true;
    company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' });
    await company.idle();
    expect(company.view().tasks.find((t) => t.id === task.id)).toMatchObject({ status: 'review', commit: null });
    expect(desks().textsFor('head-of-engineering').at(-1)).toBe(
      `From the office: Task ${task.id}, "Menu pages", couldn't be committed, so it is back in review: Merging worklings/${company.id}--${task.id} conflicts in src/menu/Card.tsx; the merge was undone.`,
    );
  });

  it("surfaces git's sentence when a commit fails, such as a missing name and email", async () => {
    const { company, desks, git } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Done.' });
    git.fail = 'commitTask';
    company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' });
    await company.idle();
    expect(company.view().tasks.find((t) => t.id === task.id)?.status).toBe('review');
    expect(desks().textsFor('head-of-engineering').at(-1)).toContain('back in review: Git refused to commitTask: it has no name and email for you.');
  });

  it('holds a worktree task until the branch has its first commit, then hands it over', async () => {
    const { company, desks, git } = await rig({ running: true });
    git.fail = 'addWorktree';
    const long = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { worktree: true }));
    await company.idle();
    expect(company.view().tasks.find((t) => t.id === long.id)).toMatchObject({ status: 'queued', worktree: null });
    expect(desks().textsFor('frontend-engineer')).toEqual([]);
    const told = desks().textsFor('head-of-engineering').at(-1) ?? '';
    expect(told).toMatch(new RegExp(`^From the office: Task ${long.id}, "Menu pages", waits for its worktree: `));
    expect(told.endsWith('It goes to Sam once a task without a worktree has been committed.')).toBe(true);
    // The first commit, from a task in the checkout, lets git make the worktree.
    git.fail = null;
    const first = company.assign('head-of-design', work('ui-designer', ['src/theme'], { title: 'Palette' }));
    desks().deliverAll();
    company.report('ui-designer', { taskId: first.id, outcome: 'done', text: 'Darker.' });
    company.review('head-of-design', { taskId: first.id, verdict: 'accept', note: '' });
    await company.idle();
    expect(company.view().tasks.find((t) => t.id === long.id)?.worktree).not.toBeNull();
    expect(desks().textsFor('frontend-engineer').at(-1)).toMatch(new RegExp(`^From Ben, head of engineering: New task ${long.id}: Menu pages`));
  });

  it("drops a worktree task when git can't make its worktree on a branch with commits, and tells the asker", async () => {
    const { company, desks, git } = await rig({ running: true });
    const first = company.assign('head-of-design', work('ui-designer', ['src/theme'], { title: 'Palette' }));
    desks().deliverAll();
    company.report('ui-designer', { taskId: first.id, outcome: 'done', text: 'Darker.' });
    company.review('head-of-design', { taskId: first.id, verdict: 'accept', note: '' });
    await company.idle();
    git.fail = 'addWorktree';
    const long = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { worktree: true }));
    await company.idle();
    expect(company.view().tasks.find((t) => t.id === long.id)?.status).toBe('dropped');
    const told = desks().textsFor('head-of-engineering').at(-1) ?? '';
    expect(told).toContain(`couldn't start, so it was dropped: Git refused to addWorktree`);
    expect(told.endsWith('Assign it again, without a worktree if need be.')).toBe(true);
    // Its files are free again.
    expect(company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'])).files).toEqual(['src/menu']);
  });

  it("shows a task's diff from git, masked and capped, and refuses an unknown task", async () => {
    const { company, git } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    git.diff = `diff --git a/src/menu/api.ts b/src/menu/api.ts\n+const key = "sk-ant-api03-abcdefghijklmnop1234";\n${'+// more\n'.repeat(40_000)}`;
    const shown = await company.diff(task.id);
    expect(git.calls.at(-1)).toEqual(['taskDiff', expect.any(String), task.id]);
    expect(shown).toContain('diff --git a/src/menu/api.ts');
    expect(shown).not.toContain('sk-ant-');
    expect(shown.length).toBeLessThanOrEqual(256 * 1024);
    await expect(company.diff('t-999')).rejects.toMatchObject({ code: 'unknown' });
    git.fail = 'taskDiff';
    await expect(company.diff(task.id)).rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/^Couldn't read the diff of task t-\d+: Git refused/) });
  });

  it('refuses a worktree in a project without a work branch', async () => {
    const { company, git } = await rig();
    git.branch = null;
    company.proposeOrg('ceo', proposal());
    company.start();
    await company.idle();
    expect(company.view()).toMatchObject({ phase: 'running', branch: null });
    expect(refusal(() => company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { worktree: true }))).message).toContain('no work branch');
  });

  it('moves a done task to review, gives the asker the report, and commits the files once accepted', async () => {
    const { company, desks, git, root } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu', 'src/pages/menu.tsx']));
    desks().deliverAll();
    const report = company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Both menus render; the German one needs a proofread.' });
    expect(report).toMatchObject({ person: 'frontend-engineer', to: 'head-of-engineering', outcome: 'done' });
    expect(company.view().tasks.find((t) => t.id === task.id)).toMatchObject({ status: 'review', outcome: 'Both menus render; the German one needs a proofread.' });
    expect(desks().textsFor('head-of-engineering').at(-1)).toBe(
      `From Sam, frontend engineer: Report on task ${task.id}, "Menu pages": done. Both menus render; the German one needs a proofread.\nReview it with review: accept it, or return it with a note.`,
    );
    expect(company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' })).toMatchObject({ status: 'done', commit: null });
    await company.idle();
    const commit = git.calls.find((c) => c[0] === 'commitTask');
    expect(commit?.slice(1, 3)).toEqual([root, 'src/menu,src/pages/menu.tsx']);
    expect(commit?.[3]).toMatch(/^Menu pages\n\nBoth menus render/);
    expect(company.view().tasks.find((t) => t.id === task.id)).toMatchObject({ status: 'done', commit: expect.stringMatching(/^c0ffee/) });
  });

  it("commits what the owner changed outside the task's files too, except what other open tasks hold", async () => {
    const { company, desks, git } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    company.assign('head-of-design', work('ui-designer', ['src/styles', 'public/fonts'], { title: 'Type' }));
    const done = company.assign('head-of-design', work('ux-designer', ['docs/flow.md'], { title: 'Flow' }));
    desks().deliverAll();
    // A plain done with other work still open is accepted by the office itself.
    company.report('ux-designer', { taskId: done.id, outcome: 'done', text: 'Mapped.', form: { files: ['docs/flow.md'], open: [], check: { ran: 'npm test', passed: true } } });
    await company.idle();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Both menus render.' });
    company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' });
    await company.idle();
    const commit = git.calls.filter((c) => c[0] === 'commitTask').at(-1);
    // The open task's files stay out; the finished one's are committed already, so they are anyone's again.
    expect(commit?.slice(2, 3)).toEqual(['src/menu']);
    expect(commit?.[4]).toBe('src/styles,public/fonts');
  });

  it("leaves out the files of a finished task whose own commit hasn't been made yet", async () => {
    const { company, desks, git } = await rig({ running: true });
    git.hold = true;
    const menu = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    const type = company.assign('head-of-design', work('ui-designer', ['src/styles'], { title: 'Type' }));
    desks().deliverAll();
    for (const [t, by] of [[menu, 'head-of-engineering'], [type, 'head-of-design']] as const) {
      company.report(t.owner, { taskId: t.id, outcome: 'done', text: 'Done.' });
      company.review(by, { taskId: t.id, verdict: 'accept', note: '' });
    }
    await vi.waitFor(() => expect(git.calls.some((c) => c[0] === 'commitTask')).toBe(true));
    git.release();
    await vi.waitFor(() => expect(git.calls.filter((c) => c[0] === 'commitTask')).toHaveLength(2));
    git.release();
    await company.idle();
    const [first, second] = git.calls.filter((c) => c[0] === 'commitTask');
    expect([first?.[2], first?.[4]]).toEqual(['src/menu', 'src/styles']);
    expect([second?.[2], second?.[4]]).toEqual(['src/styles', '']);
  });

  it('returns work with a note to the owner, and blocks a task the owner reports blocked', async () => {
    const { company, desks } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'blocked', text: 'The menu data has no prices.' });
    expect(company.view().tasks.find((t) => t.id === task.id)?.status).toBe('blocked');
    company.review('head-of-engineering', { taskId: task.id, verdict: 'return', note: 'Use the prices in data/menu.json.' });
    expect(company.view().tasks.find((t) => t.id === task.id)?.status).toBe('working');
    expect(desks().textsFor('frontend-engineer').at(-1)).toBe(`From Ben, head of engineering: Task ${task.id}, "Menu pages", came back from review: Use the prices in data/menu.json.`);
    expect(refusal(() => company.review('head-of-engineering', { taskId: task.id, verdict: 'return', note: '' })).code).toBe('closed');
  });

  it("keeps the CEO's reports for the stakeholder's timeline, without waking anyone", async () => {
    const { company, desks } = await rig({ running: true });
    const before = desks().turns.length;
    const report = company.report('ceo', { taskId: null, outcome: 'progress', text: 'Both heads have their parts.' });
    expect(report).toMatchObject({ person: 'ceo', to: '@stakeholder', taskId: null });
    expect(desks().turns.length).toBe(before);
    expect(company.view().reports.at(-1)).toEqual(report);
  });

  it('lists tasks by owner and status for anyone in the company', async () => {
    const { company } = await rig({ running: true });
    const menu = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    company.assign('head-of-design', work('ui-designer', ['src/theme'], { title: 'Palette' }));
    expect(company.tasks('ux-designer', { owner: 'frontend-engineer' }).map((t) => t.id)).toEqual([menu.id]);
    expect(company.tasks('ux-designer', { status: 'queued' })).toHaveLength(2);
    expect(company.tasks('ux-designer', { status: 'done' })).toEqual([]);
    expect(refusal(() => company.tasks('nobody', {})).code).toBe('unknown');
  });

  it('lets only the asker or someone above the owner review', async () => {
    const { company, desks } = await rig({ running: true });
    const task = company.assign('frontend-lead', work('frontend-engineer', ['src/menu']));
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Done.' });
    expect(refusal(() => company.review('head-of-design', { taskId: task.id, verdict: 'accept', note: '' })).code).toBe('not-allowed');
    expect(company.review('ceo', { taskId: task.id, verdict: 'accept', note: '' }).status).toBe('done');
  });

  it('marks a milestone done when all of its tasks are', async () => {
    const { company, desks } = await rig({ running: true });
    const goal = company.setGoal('ceo', { text: 'Pickup orders work.', milestones: [{ title: 'Menu pages live', doneWhen: 'Both menus load.' }] });
    const milestone = goal.milestones[0]?.id ?? null;
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu'], { milestone }));
    desks().deliverAll();
    company.report('frontend-engineer', { taskId: task.id, outcome: 'done', text: 'Done.' });
    expect(company.view().goal?.milestones[0]?.doneAt).toBeNull();
    company.review('head-of-engineering', { taskId: task.id, verdict: 'accept', note: '' });
    expect(company.view().goal?.milestones[0]?.doneAt).not.toBeNull();
    expect(company.view().log.at(-1)).toMatchObject({ kind: 'milestone', text: 'Milestone done: Menu pages live.' });
  });

  it('posts status lines as one masked sentence, and starts a queued task', async () => {
    const { company } = await rig({ running: true });
    const task = company.assign('head-of-engineering', work('frontend-engineer', ['src/menu']));
    const status = company.postStatus('frontend-engineer', '  Wiring the menu\n to the API with token=ab12cd34ef56   ', task.id);
    expect(status.text).toBe('Wiring the menu to the API with token=[redacted]');
    expect(company.view().tasks.find((t) => t.id === task.id)?.status).toBe('working');
    expect(company.view().people.find((p) => p.id === 'frontend-engineer')?.status?.text).toBe(status.text);
    expect(company.postStatus('frontend-engineer', 'x'.repeat(500), null).text).toHaveLength(LIMITS.status);
    expect(refusal(() => company.postStatus('ui-designer', 'On the menu.', task.id)).code).toBe('not-allowed');
    expect(refusal(() => company.postStatus('ui-designer', '   ', null)).code).toBe('invalid');
  });

  it('keeps shared screenshots as PNG files and refuses anything else', async () => {
    const { company, root } = await rig({ running: true });
    const shot = company.shareScreenshot('ui-designer', { png: PNG, caption: 'The darker palette.' });
    const file = join(root, '.worklings', 'shots', `${shot.id}.png`);
    expect(existsSync(file) && readFileSync(file).equals(Buffer.from(PNG))).toBe(true);
    expect(company.view().screenshots).toEqual([shot]);
    expect(refusal(() => company.shareScreenshot('ui-designer', { png: new TextEncoder().encode('<svg onload=alert(1)>'), caption: '' })).code).toBe('invalid');
    const big = new Uint8Array(LIMITS.screenshot + 1);
    big.set(PNG);
    expect(refusal(() => company.shareScreenshot('ui-designer', { png: big, caption: '' })).message).toContain('up to 4 MB');
  });
});

