import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import {
  approveChoices,
  boardTasksOf,
  boardWord,
  commentSign,
  commentsOn,
  commentTarget,
  diffView,
  doneMilestones,
  findInPlan,
  milestoneMarks,
  milestoneProgress,
  olderVersionsLine,
  planPath,
  planState,
  planSummary,
  planTaskView,
  planVersionPart,
  previousOf,
  versionRows,
} from '../web/src/company/plan/planModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { company, desk, min, NOW, report, task, update } from './panels-work-kit.ts';
import { comment, companyWithPlan, milestone, plan, planTask, planView, version } from './steering-plan-kit.ts';

// Times beside facts carry their day when it isn't today: the suite's clock sits on the day of its fixtures.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const three = () => plan({ milestones: [milestone('ms-1', 'Menu pages live'), milestone('ms-2', 'Pickup orders work'), milestone('ms-3', 'Launch')] });

describe('where the plan stands', () => {
  it('waits for the start while the org is proposed', () => {
    expect(planState(companyWithPlan(null, { phase: 'proposed' })).lines).toEqual(['The CEO proposes a plan once the company starts.']);
  });

  it('says there is no plan yet, and what that holds up', () => {
    const s = planState(companyWithPlan(null));
    expect(s.kind).toBe('none');
    expect(s.lines).toEqual(["The CEO hasn't proposed a plan yet.", 'Nobody starts a task until there is a plan and you approve it.']);
    expect(planState(companyWithPlan(null, {}, 'off')).lines[1]).toBe('With plan approval off, the heads assign work as they go.');
  });

  it('says nothing about approval in an office that has no plans', () => {
    expect(planState(company()).lines).toEqual(["The CEO hasn't proposed a plan yet."]);
  });

  it('says the CEO is at work before the first version, with what it says it does', () => {
    const c = update(companyWithPlan(null), 'ceo', { desk: desk('working'), status: { person: 'ceo', text: 'Splitting the goal into milestones.', taskId: null, at: NOW } });
    const s = planState(c);
    expect(s.kind).toBe('drafting');
    expect(s.lines.slice(0, 2)).toEqual(["The CEO is at work and hasn't proposed a plan yet.", 'The CEO: Splitting the goal into milestones.']);
  });

  it('waits for your approval, before work starts or milestone by milestone', () => {
    const v = version(2, plan());
    const before = planState(companyWithPlan(planView([version(1, plan()), v])));
    expect(before.kind).toBe('waiting');
    expect(before.pill).toEqual({ label: 'Waits for you', tone: 'needs' });
    expect(before.lines).toEqual([`Version 2, by the CEO at ${hourMinute(v.at)}, waits for your approval.`, 'Nobody starts a task of it until you approve it.']);
    expect(planState(companyWithPlan(planView([v]), {}, 'milestones')).lines[1]).toBe('Approve the first milestone to start work; each milestone after it waits for you too.');
  });

  it('says when the version you approved was changed since', () => {
    const v1 = version(1, plan());
    const approved = { version: 1, through: null, at: v1.at + min(1), by: STAKEHOLDER, cites: [] };
    const s = planState(companyWithPlan(planView([v1, version(2, plan())], { approved })));
    expect(s.kind).toBe('waiting');
    expect(s.lines.slice(1)).toEqual([`You approved version 1 at ${hourMinute(approved.at)}. Version 2 changes it.`, 'Its changes wait for your approval.']);
    expect(planState(companyWithPlan(planView([v1, version(2, plan())], { approved }), {}, 'milestones')).lines[2]).toBe('Its changes wait for your approval, a milestone at a time.');
  });

  it('says you asked for changes until a new version comes', () => {
    const v = version(1, plan());
    const asked = comment('c-1', { kind: 'plan' }, 'Fewer tasks, please.', { at: v.at + min(2) });
    const s = planState(companyWithPlan(planView([v], { comments: [asked] })));
    expect(s.kind).toBe('revising');
    expect(s.lines[0]).toBe(`You asked the CEO for changes at ${hourMinute(asked.at)}. The new version shows here with what changed.`);
    // An older comment, or the CEO's own, isn't a request for this version.
    expect(planState(companyWithPlan(planView([v], { comments: [{ ...asked, at: v.at - min(1) }, { ...asked, by: 'ceo' }] }))).kind).toBe('waiting');
  });

  it('is approved, by you or by the CEO on your word', () => {
    const v = version(1, plan());
    const mine = planState(companyWithPlan(planView([v], { approved: { version: 1, through: null, at: NOW, by: STAKEHOLDER, cites: [] } })));
    expect(mine.kind).toBe('approved');
    expect(mine.lines[0]).toBe(`You approved version 1 at ${hourMinute(NOW)}.`);
    const theirs = planState(companyWithPlan(planView([v], { approved: { version: 1, through: 'ms-2', at: NOW, by: 'ceo', cites: ['m-4'] } })));
    expect(theirs.lines[0]).toBe(`The CEO, as you asked, approved version 1 at ${hourMinute(NOW)}.`);
  });

  it('is approved in part through a milestone, and says what still waits', () => {
    const v = version(1, three());
    const s = planState(companyWithPlan(planView([v], { approved: { version: 1, through: 'ms-1', at: NOW, by: STAKEHOLDER, cites: [] } }), {}, 'milestones'));
    expect(s.kind).toBe('partly');
    expect(s.lines).toEqual([`You approved version 1 through “Menu pages live” at ${hourMinute(NOW)}.`, '“Pickup orders work” and the milestones after it wait for your approval.']);
  });

  it('holds the next milestone once one is done, with the report', () => {
    const v = version(1, plan());
    const r = report('r-9', 'ceo', STAKEHOLDER, 'Menu pages are live and tested. Photos next week.', { at: NOW - min(3) });
    const s = planState(
      companyWithPlan(planView([v], { approved: { version: 1, through: 'ms-1', at: NOW - min(30), by: STAKEHOLDER, cites: [] }, waiting: { milestone: 'ms-1', since: NOW - min(3), report: 'r-9' } }), { reports: [r] }, 'milestones'),
    );
    expect(s.kind).toBe('held');
    expect(s.lines).toEqual(['“Menu pages live” is done. “Pickup orders work” waits for your approval before it starts.', `The CEO reported at ${hourMinute(r.at)}: Menu pages are live and tested.`]);
  });

  it('applies as proposed with approval off', () => {
    const v = version(3, plan(), { by: STAKEHOLDER });
    const s = planState(companyWithPlan(planView([v]), {}, 'off'));
    expect(s.kind).toBe('off');
    expect(s.lines).toEqual([`Version 3, by you at ${hourMinute(v.at)}.`, 'Plan approval is off, so the plan applies as proposed and the heads assign work as they go.']);
  });
});

describe('what you can approve', () => {
  it('before work starts: the plan, or only up to a milestone', () => {
    const view = planView([version(1, three())]);
    expect(approveChoices(view, 'before-work')).toEqual({
      version: 1,
      primary: { through: null, label: 'Approve the plan' },
      more: [
        { through: 'ms-1', label: 'Approve through “Menu pages live”' },
        { through: 'ms-2', label: 'Approve through “Pickup orders work”' },
      ],
    });
  });

  it('at every milestone: the next milestone, then the later ones and the whole plan', () => {
    const view = planView([version(1, three())]);
    expect(approveChoices(view, 'milestones')).toEqual({
      version: 1,
      primary: { through: 'ms-1', label: 'Approve “Menu pages live”' },
      more: [
        { through: 'ms-2', label: 'Approve through “Pickup orders work”' },
        { through: null, label: 'Approve the whole plan' },
      ],
    });
    const partly = planView([version(1, three())], { approved: { version: 1, through: 'ms-1', at: NOW, by: STAKEHOLDER, cites: [] } });
    expect(approveChoices(partly, 'milestones')).toEqual({ version: 1, primary: { through: 'ms-2', label: 'Approve “Pickup orders work”' }, more: [{ through: null, label: 'Approve the rest of the plan' }] });
  });

  it('offers the last milestone alone, without a whole-plan twin', () => {
    const view = planView([version(1, three())], { approved: { version: 1, through: 'ms-2', at: NOW, by: STAKEHOLDER, cites: [] } });
    expect(approveChoices(view, 'milestones')).toEqual({ version: 1, primary: { through: 'ms-3', label: 'Approve “Launch”' }, more: [] });
  });

  it('offers nothing once it is all approved, with approval off, or without a plan', () => {
    const approved = planView([version(1, plan())], { approved: { version: 1, through: null, at: NOW, by: STAKEHOLDER, cites: [] } });
    expect(approveChoices(approved, 'before-work')).toBeNull();
    expect(approveChoices(planView([version(1, plan())]), 'off')).toBeNull();
    expect(approveChoices(null, 'before-work')).toBeNull();
    expect(approveChoices(planView([]), 'before-work')).toBeNull();
  });

  it('passes over milestones already done on the board: approving the next one covers them', () => {
    const view = planView([version(1, three()), version(2, three())], { approved: { version: 1, through: 'ms-1', at: NOW, by: STAKEHOLDER, cites: [] } });
    const done = new Set(['ms-1']);
    expect(approveChoices(view, 'milestones', done)).toEqual({
      version: 2,
      primary: { through: 'ms-2', label: 'Approve “Pickup orders work”' },
      more: [{ through: null, label: 'Approve the rest of the plan' }],
    });
    expect(approveChoices(view, 'before-work', done)).toEqual({ version: 2, primary: { through: null, label: 'Approve the rest of the plan' }, more: [{ through: 'ms-2', label: 'Approve through “Pickup orders work”' }] });
  });

  it('finds the milestones done on the board or by the goal', () => {
    const c = company({
      goal: { text: 'g', setAt: NOW, milestones: [{ id: 'ms-2', title: 'Pickup orders work', doneWhen: '', doneAt: null }] },
      tasks: [task('t-1', 'frontend-engineer', 'Menu data', { planTask: 'p-1', status: 'done' }), task('t-2', 'ui-designer', 'Photos', { planTask: 'p-2', status: 'done' }), task('t-3', 'frontend-engineer', 'Slots', { planTask: 'p-3', status: 'working' })],
    });
    expect([...doneMilestones(c, plan())]).toEqual(['ms-1']);
    const byGoal = { ...c, goal: { text: 'g', setAt: NOW, milestones: [{ id: 'ms-2', title: 'Pickup orders work', doneWhen: '', doneAt: NOW }] } };
    expect([...doneMilestones(byGoal, plan())]).toEqual(['ms-1', 'ms-2']);
  });

  it('asks for the newest version, even when an older one was approved', () => {
    const view = planView([version(1, plan()), version(2, plan())], { approved: { version: 1, through: null, at: NOW, by: STAKEHOLDER, cites: [] } });
    expect(approveChoices(view, 'before-work')?.version).toBe(2);
    expect(approveChoices(view, 'before-work')?.primary.label).toBe('Approve the plan');
  });
});

describe('each milestone’s mark', () => {
  it('marks the approved part, the milestone that waits for you next, and what is not approved yet', () => {
    const v = version(1, three());
    const view = planView([v], { approved: { version: 1, through: 'ms-1', at: NOW, by: STAKEHOLDER, cites: [] } });
    expect(milestoneMarks(view, v, 'milestones')).toEqual({
      'ms-1': { label: 'Approved', tone: 'done' },
      'ms-2': { label: 'Waits for you', tone: 'needs' },
      'ms-3': { label: 'Not approved yet', tone: 'neutral' },
    });
    // Before work starts, the plan waits as a whole: no milestone is singled out.
    expect(milestoneMarks(planView([v]), v, 'before-work')['ms-1']).toEqual({ label: 'Not approved yet', tone: 'neutral' });
  });

  it('marks the milestone that waits for you after one is done', () => {
    const v = version(1, three());
    const view = planView([v], { approved: { version: 1, through: 'ms-1', at: NOW, by: STAKEHOLDER, cites: [] }, waiting: { milestone: 'ms-1', since: NOW, report: null } });
    expect(milestoneMarks(view, v, 'milestones')).toMatchObject({ 'ms-1': { label: 'Done' }, 'ms-2': { label: 'Waits for you', tone: 'needs' }, 'ms-3': { label: 'Not approved yet' } });
  });

  it('marks a milestone done on the board as done, on the latest version only', () => {
    const v1 = version(1, three());
    const v2 = version(2, three());
    const view = planView([v1, v2], { approved: { version: 1, through: 'ms-1', at: NOW, by: STAKEHOLDER, cites: [] } });
    expect(milestoneMarks(view, v2, 'milestones', new Set(['ms-1']))['ms-1']).toEqual({ label: 'Done', tone: 'done' });
    expect(milestoneMarks(view, v1, 'milestones', new Set(['ms-1']))['ms-1']).toEqual({ label: 'Approved', tone: 'done' });
  });

  it('marks nothing with approval off, and an older version by its own approval', () => {
    const v1 = version(1, plan());
    const v2 = version(2, plan());
    expect(milestoneMarks(planView([v1, v2]), v2, 'off')).toEqual({});
    const view = planView([v1, v2], { approved: { version: 1, through: null, at: NOW, by: STAKEHOLDER, cites: [] } });
    expect(milestoneMarks(view, v1, 'before-work')['ms-1']).toEqual({ label: 'Approved', tone: 'done' });
    expect(milestoneMarks(view, v2, 'before-work')['ms-1']).toEqual({ label: 'Not approved yet', tone: 'neutral' });
  });
});

describe('versions', () => {
  it('lists them newest first, with who made each and which is approved', () => {
    const v1 = version(1, plan(), { note: 'First draft.' });
    const v2 = version(2, plan(), { by: STAKEHOLDER, note: null });
    const rows = versionRows(planView([v1, v2], { approved: { version: 1, through: null, at: NOW, by: STAKEHOLDER, cites: [] } }), company());
    expect(rows).toEqual([
      { version: 2, line: `By you at ${hourMinute(v2.at)}.`, note: null, approved: false, latest: true },
      { version: 1, line: `By the CEO at ${hourMinute(v1.at)}.`, note: 'First draft.', approved: true, latest: false },
    ]);
  });

  it('says when older versions are no longer carried', () => {
    expect(olderVersionsLine(planView([version(4, plan()), version(5, plan())]))).toBe("Versions before 4 aren't kept here: the office keeps the latest ten.");
    expect(olderVersionsLine(planView([version(1, plan())]))).toBeNull();
  });

  it('finds the version before one, among those carried', () => {
    const view = planView([version(4, plan()), version(6, plan())]);
    expect(previousOf(view, 6)?.version).toBe(4);
    expect(previousOf(view, 4)).toBeNull();
  });

  it('has an address for each', () => {
    expect(planPath()).toBe('plan');
    expect(planPath(3)).toBe('plan/v3');
    expect(planVersionPart('v3')).toBe(3);
    for (const part of [undefined, null, '', 'v', 'v0', '3', 'v-1', 'v3x', 'v1234567']) expect(planVersionPart(part)).toBeNull();
  });
});

describe('what changed, in words', () => {
  it('says nothing changed for the same plan', () => {
    expect(diffView(plan(), plan(), company())).toEqual({ goal: null, sections: [], summary: 'Nothing changed.' });
  });

  it('lists what was added, cut, changed and moved in sentences', () => {
    const before = plan();
    const after = plan({
      goal: 'Order ahead and pay with TWINT.',
      milestones: [milestone('ms-2', 'Pickup orders work'), milestone('ms-1', 'Menu pages live'), milestone('ms-3', 'Launch', { doneWhen: 'The site is live.' })],
      tasks: [
        planTask('p-3', 'Slot picker', { owner: 'qa-engineer', milestone: 'ms-2', files: ['src/slots/', 'src/api/'], after: [] }),
        planTask('p-4', 'Cart', { milestone: 'ms-2', files: ['src/cart/'] }),
        planTask('p-1', 'Menu data', { files: ['src/menu/'] }),
        planTask('p-5', 'Order tests', { owner: 'qa-engineer', milestone: 'ms-2', files: ['test/orders/'], after: ['p-3', 'p-4'] }),
        planTask('p-6', 'Pay with TWINT', { milestone: 'ms-3' }),
      ],
    });
    const d = diffView(before, after, company());
    expect(d.goal).toEqual({ before: before.goal, after: 'Order ahead and pay with TWINT.' });
    expect(d.summary).toBe('The goal changed, two added, one cut, one changed and two moved.');
    const section = (kind: string) => d.sections.find((s) => s.kind === kind);
    expect(section('added')?.items.map((i) => i.text)).toEqual(['The milestone “Launch”, done when the site is live.', '“Pay with TWINT”, for Kai, in “Launch”.']);
    expect(section('cut')?.items.map((i) => i.text)).toEqual(['“Menu photos”, which was for Mina, in “Menu pages live”.']);
    expect(section('changed')?.items).toEqual([
      {
        key: 't:p-3',
        text: '“Slot picker”: owner, files and what it waits for.',
        parts: [
          { label: 'Owner', before: 'Kai', after: 'The QA engineer', long: false },
          { label: 'Files', before: 'src/slots/', after: 'src/slots/, src/api/', long: false },
          { label: 'Waits for', before: '“Menu data”', after: 'nothing', long: false },
        ],
      },
    ]);
    expect(section('moved')?.items.map((i) => i.text)).toEqual(['The milestone “Pickup orders work”: now first, was second.', '“Menu data”: now third in the order, was first.']);
  });

  it('shows a changed brief as long text, and a milestone’s new title', () => {
    const before = plan();
    const after = plan({ milestones: [milestone('ms-1', 'Menus live', { doneWhen: before.milestones[0]?.doneWhen ?? '' }), milestone('ms-2', 'Pickup orders work')], tasks: before.tasks.map((t) => (t.id === 'p-1' ? { ...t, brief: 'A much longer brief.' } : t)) });
    const changed = diffView(before, after, company()).sections.find((s) => s.kind === 'changed')?.items ?? [];
    expect(changed.map((i) => [i.text, i.parts.map((p) => [p.label, p.after, p.long])])).toEqual([
      ['The milestone “Menus live”.', [['Title', 'Menus live', false]]],
      ['“Menu data”: brief.', [['Brief', 'A much longer brief.', true]]],
    ]);
  });

  it('names a changed check and kind as what they are, not as the title', () => {
    const before = plan();
    const after = plan({ tasks: before.tasks.map((t) => (t.id === 'p-1' ? { ...t, check: 'npm test', kind: 'integration' as const } : t)) });
    const changed = diffView(before, after, company()).sections.find((s) => s.kind === 'changed')?.items ?? [];
    expect(changed.map((i) => [i.text, i.parts.map((p) => [p.label, p.before, p.after])])).toEqual([
      ['“Menu data”: check and kind.', [['Check', 'none', 'npm test'], ['Kind', 'a plain task', expect.any(String)]]],
    ]);
    expect(changed[0]?.parts[1]?.after).not.toBe('a plain task');
  });
});

describe('a task in the plan', () => {
  it('has its place in the order, its owner, files and what it waits for', () => {
    const p = plan();
    const v = planTaskView(company(), p, p.tasks[4]!);
    expect(v).toMatchObject({ number: 5, owner: { text: 'The QA engineer', missing: false }, files: ['test/orders/'], waits: ['Slot picker', 'Cart'] });
  });

  it('says when its owner left the company', () => {
    const p = plan({ tasks: [planTask('p-1', 'Menu data', { owner: 'payments-engineer' })] });
    expect(planTaskView(company(), p, p.tasks[0]!).owner).toEqual({ text: 'The payments engineer', missing: true });
  });

  it('is found by its title, its owner or a file', () => {
    const p = plan();
    expect([...(findInPlan(company(), p, 'mina') ?? [])]).toEqual(['p-2']);
    expect([...(findInPlan(company(), p, 'src/cart') ?? [])]).toEqual(['p-4']);
    expect([...(findInPlan(company(), p, 'MENÚ') ?? [])]).toEqual(['p-1', 'p-2']);
    expect(findInPlan(company(), p, '  ')).toBeNull();
  });

  it('links to what the board made of it, with steering in its word', () => {
    const c = company({
      tasks: [
        task('t-2', 'frontend-engineer', 'Slot picker: API', { planTask: 'p-3', parent: 't-1', createdAt: NOW - min(10) }),
        task('t-1', 'frontend-engineer', 'Slot picker', { planTask: 'p-3', status: 'working', paused: { at: NOW, by: STAKEHOLDER }, createdAt: NOW - min(20) }),
      ],
    });
    const tasks = boardTasksOf(c, 'p-3');
    expect(tasks.map((t) => t.id)).toEqual(['t-1', 't-2']);
    expect(boardWord(tasks[0]!)).toBe('Paused');
    expect(boardWord({ ...tasks[0]!, status: 'dropped', cancel: { at: NOW, by: STAKEHOLDER, reason: 'Not now', branch: null } })).toBe('Cancelled');
  });

  it('counts a milestone’s top-level tasks done on the board', () => {
    const c = company({
      tasks: [
        task('t-1', 'frontend-engineer', 'Slot picker', { planTask: 'p-3', status: 'done' }),
        task('t-2', 'frontend-engineer', 'Cart', { planTask: 'p-4', status: 'working' }),
        task('t-3', 'frontend-engineer', 'Cart: part', { planTask: 'p-4', parent: 't-2', status: 'done' }),
        task('t-4', 'qa-engineer', 'Order tests', { planTask: 'p-5', status: 'dropped' }),
      ],
    });
    expect(milestoneProgress(c, plan(), 'ms-2')).toEqual({ done: 1, total: 2, line: 'One of two tasks done.' });
    expect(milestoneProgress(c, plan(), 'ms-1')).toBeNull();
    const none = company({ tasks: [task('t-1', 'frontend-engineer', 'Menu data', { planTask: 'p-1' }), task('t-2', 'ui-designer', 'Photos', { planTask: 'p-2', status: 'working' })] });
    expect(milestoneProgress(none, plan(), 'ms-1')?.line).toBe('None of its two tasks done yet.');
  });
});

describe('comments', () => {
  it('belong to the plan, a milestone or a task, oldest first', () => {
    const view = planView([version(2, plan())], {
      comments: [
        comment('c-2', { kind: 'task', id: 'p-4' }, 'Cart before slots.', { at: NOW - min(1) }),
        comment('c-1', { kind: 'task', id: 'p-4' }, 'Smaller, please.', { at: NOW - min(9) }),
        comment('c-3', { kind: 'milestone', id: 'p-4' }, 'Not the task.'),
        comment('c-4', { kind: 'plan' }, 'Looks good.'),
      ],
    });
    expect(commentsOn(view, { kind: 'task', id: 'p-4' }).map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(commentsOn(view, { kind: 'plan' }).map((c) => c.id)).toEqual(['c-4']);
  });

  it('are signed by who wrote them, with the version when it isn’t the one shown', () => {
    const c = comment('c-1', { kind: 'plan' }, 'Hi', { version: 1, at: NOW });
    expect(commentSign(company(), c, 2)).toBe(`You at ${hourMinute(NOW)}, on version 1`);
    expect(commentSign(company(), { ...c, by: 'ceo' }, 1)).toBe(`The CEO at ${hourMinute(NOW)}`);
  });

  it('say what they are about', () => {
    expect(commentTarget(plan(), { kind: 'task', id: 'p-4' })).toBe('On “Cart”');
    expect(commentTarget(plan(), { kind: 'milestone', id: 'ms-2' })).toBe('On the milestone “Pickup orders work”');
    expect(commentTarget(plan(), { kind: 'task', id: 'p-9' })).toBe('On a task no longer in the plan');
  });
});

describe('the plan on the Tasks tab', () => {
  it('says where the plan stands', () => {
    expect(planSummary(companyWithPlan(planView([version(1, plan())])))).toMatchObject({ label: 'Waits for you', tone: 'needs' });
    expect(planSummary(companyWithPlan(null))?.line).toBe("The CEO hasn't proposed a plan yet.");
  });

  it('says nothing without plans, or with no plan and approval off', () => {
    expect(planSummary(company())).toBeNull();
    expect(planSummary(companyWithPlan(null, {}, 'off'))).toBeNull();
    expect(planSummary(companyWithPlan(planView([version(1, plan())]), {}, 'off'))?.label).toBe('Approval off');
  });
});
