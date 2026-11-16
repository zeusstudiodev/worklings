// What waits for the stakeholder's approval is said the same way in the inbox, on Now, in the pill and on Tasks; times
// beside facts carry their day; a draft never drops its oldest change; Tasks and the plan count a milestone alike.
import { describe, expect, it } from 'vitest';
import { type CompanyView, STAKEHOLDER } from '../src/core/company.ts';
import { planInbox, planWaitingFor } from '../src/core/plan.ts';
import { companyState, stateOfCompany } from '../web/src/company/model.ts';
import { headline, inboxSentence } from '../web/src/company/now/nowModel.ts';
import { MAX_OPS, type PlanOp, withOp } from '../web/src/company/plan/planEdit.ts';
import { milestoneProgress, noTasksLine, planWait } from '../web/src/company/plan/planModel.ts';
import { milestonesOf } from '../web/src/company/tasks/tasksModel.ts';
import { whenAt } from '../web/src/lib/format.ts';
import { planVersion, steered } from './panels-steering-kit.ts';
import { min, NOW, task } from './panels-work-kit.ts';

const plan = {
  goal: 'Pickup orders',
  milestones: [
    { id: 'ms-1', title: 'Menu pages live', doneWhen: 'x' },
    { id: 'ms-2', title: 'Pickup orders work', doneWhen: 'y' },
  ],
  tasks: [],
};
const none = { versions: [], approved: null, waiting: null };
const waiting = (setting: 'before-work' | 'milestones' | 'off' = 'before-work', approved: null | { version: number; through: string | null } = null, hold: null | string = null) =>
  steered(
    { phase: 'running' },
    {
      plan: { versions: [planVersion(1, 'ceo', { plan })], approved: approved && { ...approved, at: NOW, by: STAKEHOLDER, cites: [] }, comments: [], waiting: hold ? { milestone: hold, since: NOW, report: null } : null },
      settings: { planApproval: setting, leash: { people: {}, rooms: {} }, effort: {} },
    },
  );

describe('a plan that waits for approval', () => {
  it('says so for a whole version and for a milestone on hold, and counts as one thing in the inbox', () => {
    const c = waiting();
    expect(planWait(c)).toEqual({ kind: 'plan', sentence: "The CEO's plan waits for your approval." });
    expect(planInbox(c.steering?.plan ?? none, { planApproval: 'before-work' })).toBe(1);
    const held = waiting('milestones', { version: 1, through: 'ms-1' }, 'ms-1');
    expect(planWaitingFor(held.steering?.plan ?? none, { planApproval: 'milestones' })).toEqual({
      kind: 'milestone',
      sentence: '“Pickup orders work” waits for your approval before it starts.',
    });
  });

  it('says nothing once approved, with approval off, or before the company has a plan', () => {
    expect(planWait(waiting('before-work', { version: 1, through: null }))).toBeNull();
    expect(planWait(waiting('off'))).toBeNull();
    expect(planWait({ ...waiting(), phase: 'proposed' })).toBeNull();
  });

  it('is said once on Now while people work or wait for a desk, though the state the bar shows names it too', () => {
    const plain = "The CEO's plan waits for your approval.";
    const timesSaid = (head: { needs: string | null; rest: string[] }, sentence: string) => [head.needs, ...head.rest].join(' ').split(sentence).length - 1;
    const at = (desks: CompanyView['desks'], view: CompanyView = waiting()) => {
      const c = { ...view, desks };
      return { c, state: companyState(stateOfCompany(c, NOW), NOW).sentence };
    };

    const working = at({ working: 2, waiting: 1, max: 8 });
    expect(working.state).toContain(plain);
    expect(headline(working.c, NOW, working.state)).toEqual({ needs: plain, rest: ['Two at work. One waits for a desk.'] });

    const queued = at({ working: 0, waiting: 1, max: 8 });
    expect(queued.state).toBe(`${plain} One waits for a desk.`);
    expect(headline(queued.c, NOW, queued.state)).toEqual({ needs: plain, rest: ['One waits for a desk.'] });

    const alone = at({ working: 0, waiting: 0, max: 8 });
    expect(headline(alone.c, NOW, alone.state)).toEqual({ needs: plain, rest: [] });

    // A milestone on hold, whose title holds a full stop of its own, is taken out whole.
    const titled = { ...plan, milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'x' }, { id: 'ms-2', title: 'Pickup. Then stamps', doneWhen: 'y' }] };
    const held = steered(
      { phase: 'running' },
      {
        plan: { versions: [planVersion(1, 'ceo', { plan: titled })], approved: { version: 1, through: 'ms-1', at: NOW, by: STAKEHOLDER, cites: [] }, comments: [], waiting: { milestone: 'ms-1', since: NOW, report: null } },
        settings: { planApproval: 'milestones', leash: { people: {}, rooms: {} }, effort: {} },
      },
    );
    const onHold = at({ working: 1, waiting: 0, max: 8 }, held);
    const sentence = '“Pickup. Then stamps” waits for your approval before it starts.';
    expect(onHold.state).toContain(sentence);
    const head = headline(onHold.c, NOW, onHold.state);
    expect(head.needs).toBe(sentence);
    expect(timesSaid(head, sentence)).toBe(1);
    expect(head.rest).toEqual(['One at work.']);
  });

  it("is Now's first sentence, the pill, and what Tasks says while no task exists", () => {
    const c = waiting();
    expect(inboxSentence(c, NOW)?.text).toBe("The CEO's plan waits for your approval.");
    expect(companyState(stateOfCompany(c, NOW), NOW)).toMatchObject({ pill: 'Waiting for you', tone: 'needs' });
    expect(noTasksLine(c)).not.toContain('once the company starts');
    expect(noTasksLine(waiting('before-work', { version: 1, through: null }))).toContain('once the company starts');
  });
});

describe('times beside facts', () => {
  it('carry their day when it is not today', () => {
    const at = new Date(2026, 10, 3, 14, 32).getTime();
    const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(whenAt(at, at + min(5))).toBe(`at ${time}`);
    expect(whenAt(at, new Date(2026, 10, 4, 9, 0).getTime())).toBe(`yesterday at ${time}`);
    expect(whenAt(at, new Date(2026, 10, 9, 9, 0).getTime())).toBe(`on Tue 3 Nov at ${time}`);
    expect(whenAt(at, new Date(2027, 0, 9, 9, 0).getTime())).toBe(`on Tue 3 Nov 2026 at ${time}`);
  });
});

describe('a draft', () => {
  it('refuses the change past the limit rather than dropping the oldest', () => {
    const op: PlanOp = { op: 'goal', goal: 'x' };
    const full = { ops: Array.from({ length: MAX_OPS }, () => op), note: '' };
    expect(withOp(full, { op: 'goal', goal: 'y' })).toBeNull();
    expect(withOp({ ops: full.ops.slice(1), note: '' }, op)?.ops).toHaveLength(MAX_OPS);
  });
});

describe("a milestone's tasks", () => {
  it('are counted alike on Tasks and on the plan: top-level, not dropped, whoever made them', () => {
    const planned = { ...plan, tasks: [{ id: 'p-1', title: 'A', owner: 'x', files: [], milestone: 'ms-1', after: [], brief: '', doneWhen: '' }] };
    const c = steered({
      tasks: [
        task('t-1', 'ui-designer', 'A', { planTask: 'p-1', milestone: 'ms-1', status: 'done' }),
        task('t-2', 'ui-designer', 'A sub', { planTask: 'p-1', milestone: 'ms-1', parent: 't-1', status: 'working' }),
        task('t-3', 'ui-designer', 'Own', { milestone: 'ms-1', status: 'working' }),
        task('t-4', 'ui-designer', 'Gone', { milestone: 'ms-1', status: 'dropped' }),
      ],
      goal: { text: 'g', setAt: NOW, milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'x', doneAt: null }] },
    });
    const board = milestonesOf(c)[0];
    const there = milestoneProgress(c, planned, 'ms-1');
    expect([board?.done, board?.total]).toEqual([there?.done, there?.total]);
    expect(there).toMatchObject({ done: 1, total: 2 });
  });
});
