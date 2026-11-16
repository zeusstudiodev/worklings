// The plan in the company (src/company/plan.ts): versions, approval and the gate the setting puts on work, the plan made
// into the task tree, each task's turn, the hold at a milestone, and assign limited while a plan governs.
import { describe, expect, it } from 'vitest';
import { applyEvents } from '../src/company/decisions.ts';
import { changeSettings } from '../src/company/leash.ts';
import {
  approvePlan,
  assignCheck,
  commentPlan,
  editPlan,
  laterThan,
  mergePlanOrder,
  onReport,
  proposePlan,
  refuseSetGoal,
  revertSteps,
  startTurnLines,
} from '../src/company/plan.ts';
import { planWaits } from '../src/core/plan.ts';
import type { Plan } from '../src/core/steering.ts';
import { MIN, rawPlan, refusal, Sim, STAKEHOLDER, THE_OFFICE } from './steering-core-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

const propose = (sim: Sim, plan: unknown = rawPlan(), by = 'ceo') => sim.run((c) => proposePlan(c, by, withChecklist(plan)));
const approve = (sim: Sim, version: number, through: string | null = null, by = STAKEHOLDER, cites: string[] = []) => sim.run((c) => approvePlan(c, by, { version, through, cites }));
const waits = (sim: Sim) => planWaits({ versions: sim.steering.versions, approved: sim.steering.approved, waiting: sim.steering.waiting }, sim.steering.settings);

/** A running plan: version 1 proposed and approved whole, its first turns handed out and delivered. */
function running(o: { planApproval?: 'before-work' | 'milestones' } = {}): Sim {
  const sim = new Sim(o);
  propose(sim);
  sim.tick();
  approve(sim, 1);
  sim.land();
  return sim;
}

describe('proposing the plan', () => {
  it('makes version 1 for the CEO, which waits for approval and starts nothing', () => {
    const sim = new Sim();
    const result = propose(sim);
    expect(result).toMatchObject({ ok: true, version: { version: 1, by: 'ceo', note: null } });
    expect(sim.state.tasks).toEqual([]);
    expect(waits(sim)).toBe(true);
    expect(sim.lastDecision()).toMatchObject({ kind: 'plan', by: 'ceo', what: 'The CEO proposed version 1 of the plan: two milestones and five tasks.', links: { planVersion: 1 }, reversible: false });
  });

  it("gives back the check's sentences for a plan that doesn't check out, and keeps no version", () => {
    const sim = new Sim();
    const result = propose(sim, { goal: '', milestones: [], tasks: [] });
    expect(result.ok).toBe(false);
    expect(sim.steering.versions).toEqual([]);
  });

  it('is the CEO\'s alone, and only once the company runs', () => {
    expect(refusal(() => propose(new Sim(), rawPlan(), 'head-of-design')).message).toBe('Only the CEO proposes the plan; tell the CEO what it should hold.');
    const founding = new Sim();
    founding.world = applyEvents(founding.world, [{ type: 'phase', phase: 'proposed' }]);
    expect(refusal(() => propose(founding)).code).toBe('closed');
  });

  it('makes no new version when the CEO sends the same plan again', () => {
    const sim = new Sim();
    propose(sim);
    expect(propose(sim)).toMatchObject({ ok: true, version: { version: 1 } });
    expect(sim.steering.versions).toHaveLength(1);
  });

  it('records the stakeholder\'s messages a revision answers, and only those', () => {
    const sim = new Sim();
    propose(sim);
    const ask = sim.say('ceo', 'Revise it: stamps after the launch.');
    const fromAda = sim.post('head-of-design', 'ceo', 'Me too.');
    sim.tick();
    const result = propose(sim, { ...rawPlan({ goal: 'Order ahead, then stamps.' }), note: 'Stamps after the launch.', cites: [ask.id, fromAda.id, 'm-999'] });
    expect(result).toMatchObject({ ok: true, version: { version: 2, cites: [ask.id], note: 'Stamps after the launch.' } });
    expect(sim.lastDecision()).toMatchObject({ what: 'The CEO revised the plan as you asked: version 2.', links: { planVersion: 2, message: ask.id } });
  });
});

describe('approving the plan before work starts', () => {
  it('makes the task tree in order, with priorities and the plan task each came from', () => {
    const sim = new Sim();
    propose(sim);
    approve(sim, 1);
    expect(sim.state.tasks.map((t) => [t.title, t.planTask, t.priority, t.status, t.askedBy])).toEqual([
      ['Menu data', 'p-1', 1, 'queued', 'frontend-lead'],
      ['Menu look', 'p-2', 2, 'queued', 'head-of-design'],
      ['Slot picker', 'p-3', 3, 'queued', 'frontend-lead'],
      ['Order API', 'p-4', 4, 'queued', 'frontend-lead'],
      ['Final review of the whole result', 'p-5', 5, 'queued', 'head-of-engineering'],
    ]);
    expect(sim.state.goal?.milestones.map((m) => m.id)).toEqual(['ms-1', 'ms-2']);
    expect(waits(sim)).toBe(false);
  });

  it('hands out the tasks whose turn has come, and holds the ones that wait', () => {
    const sim = new Sim();
    propose(sim);
    approve(sim, 1);
    const handedTo = sim.handed.map((id) => sim.message(id).to);
    expect(handedTo).toEqual(expect.arrayContaining(['frontend-engineer', 'ui-designer', 'backend-engineer', 'ceo']));
    expect(sim.assignmentOf(sim.planned('p-3').id)).toBeUndefined();
    expect(sim.assignmentOf(sim.planned('p-5').id)).toBeUndefined();
    const assignment = sim.assignmentOf(sim.planned('p-1').id);
    expect(assignment?.from).toBe(THE_OFFICE);
    expect(assignment?.text).toContain('New task t-1, from the plan: Menu data');
    expect(assignment?.text).toContain('Files you may change: src/menu.');
    expect(sim.lastTo('ceo').text).toContain('Robin approved version 1 of the plan.');
  });

  it("starts a task once what it waits for is done, and the last one once both are", () => {
    const sim = running();
    sim.done(sim.planned('p-1').id);
    sim.settle();
    expect(sim.assignmentOf(sim.planned('p-3').id)?.to).toBe('frontend-engineer');
    expect(sim.assignmentOf(sim.planned('p-5').id)).toBeUndefined();
    sim.done(sim.planned('p-2').id);
    sim.done(sim.planned('p-3').id);
    sim.done(sim.planned('p-4').id);
    sim.settle();
    expect(sim.assignmentOf(sim.planned('p-5').id)?.to).toBe('qa-engineer');
  });

  it('counts a dropped task as over for those waiting on it', () => {
    const sim = running();
    sim.world = applyEvents(sim.world, [{ type: 'task-status', id: sim.planned('p-1').id, status: 'dropped', at: sim.now }]);
    sim.settle();
    expect(sim.assignmentOf(sim.planned('p-3').id)).toBeDefined();
  });

  it('records the approval as a decision, and does nothing for the same approval twice', () => {
    const sim = running();
    expect(sim.decisions().filter((d) => d.what === 'You approved version 1 of the plan.')).toHaveLength(1);
    approve(sim, 1);
    expect(sim.decisions().filter((d) => d.what === 'You approved version 1 of the plan.')).toHaveLength(1);
  });

  it('refuses an old version, naming the latest', () => {
    const sim = new Sim();
    propose(sim);
    propose(sim, rawPlan({ goal: 'Order ahead and pay with TWINT.' }));
    const refused = refusal(() => approve(sim, 1));
    expect(refused).toEqual({ code: 'conflict', message: "Version 1 isn't the latest: version 2 is. Look at it, then approve that one." });
  });

  it("refuses a version that gives work to someone who has left since it was proposed", () => {
    const sim = new Sim();
    propose(sim, rawPlan({ tasks: rawPlan().tasks.map((t) => (t.id === 'p-1' || t.id === 'p-3' ? { ...t, owner: 'german-copywriter' } : t)) }));
    const lena = sim.people.find((p) => p.id === 'german-copywriter');
    sim.people = sim.people.filter((p) => p.id !== 'german-copywriter');
    if (lena) sim.fired.push(lena);
    expect(refusal(() => approve(sim, 1)).message).toBe("Version 1 gives “Menu data” to Lena, who isn't in the company any more; edit the plan, or ask the CEO to revise it.");
  });

  it('refuses an approval while plan approval is off, and before any plan', () => {
    expect(refusal(() => approve(new Sim(), 1)).message).toBe("There's no plan to approve yet; the CEO proposes it first.");
    const off = new Sim({ planApproval: 'off' });
    expect(refusal(() => approve(off, 1)).message).toBe("Plan approval is off, so the plan applies as proposed; there's nothing to approve.");
  });
});

describe('the CEO approving on the stakeholder\'s word', () => {
  function proposed(): Sim {
    const sim = new Sim();
    propose(sim);
    sim.tick();
    return sim;
  }

  it('is refused without a cite', () => {
    const sim = proposed();
    expect(refusal(() => approve(sim, 1, null, 'ceo'))).toEqual({
      code: 'not-allowed',
      message: "The CEO acts for Robin only on Robin's word: cite the message where Robin asked for this (the plan's approval).",
    });
  });

  it("is refused citing someone else's message, a message to someone else, or one older than the version", () => {
    const sim = new Sim();
    const early = sim.say('ceo', 'Approve it.');
    sim.tick();
    propose(sim);
    sim.tick();
    const ada = sim.post('head-of-design', 'ceo', 'Approve it, Robin said.');
    const toAda = sim.say('head-of-design', 'Approve it.');
    expect(refusal(() => approve(sim, 1, null, 'ceo', [ada.id])).message).toBe(`Message ${ada.id} is from Ada, not Robin; cite Robin's own message.`);
    expect(refusal(() => approve(sim, 1, null, 'ceo', [toAda.id])).message).toBe(`Message ${toAda.id} went to Ada; cite a message Robin sent Noor.`);
    expect(refusal(() => approve(sim, 1, null, 'ceo', [early.id])).message).toMatch(new RegExp(`^Message ${early.id} is older than the last change to the plan's approval \\(at \\d\\d:\\d\\d\\); cite what Robin said since\\.$`));
  });

  it('goes through with a fresh cite, which the approval and its decision carry', () => {
    const sim = proposed();
    const word = sim.say('ceo', 'Looks good, approve it.');
    const approval = approve(sim, 1, null, 'ceo', [word.id]);
    expect(approval).toMatchObject({ version: 1, through: null, by: 'ceo', cites: [word.id] });
    expect(sim.decisions().at(-1)).toMatchObject({ by: 'ceo', what: 'The CEO approved version 1 of the plan, as you asked.', links: { planVersion: 1, message: word.id } });
  });

  it('is refused for anyone but the CEO', () => {
    const sim = proposed();
    const word = sim.say('head-of-design', 'Approve it.');
    expect(refusal(() => approve(sim, 1, null, 'head-of-design', [word.id])).message).toBe("Only Robin approves the plan; the CEO can, citing Robin's word.");
  });
});

describe('at every milestone', () => {
  it('approves through a milestone, making only its tasks', () => {
    const sim = new Sim({ planApproval: 'milestones' });
    propose(sim);
    approve(sim, 1, 'ms-1');
    expect(sim.state.tasks.map((t) => t.planTask)).toEqual(['p-1', 'p-2']);
    expect(sim.lastTo('ceo').text).toContain('Once “Menu pages live” is done, the next milestone waits for Robin\'s approval.');
  });

  it("holds the next milestone once the approved one is done, and tells the CEO to report", () => {
    const sim = new Sim({ planApproval: 'milestones' });
    propose(sim);
    approve(sim, 1, 'ms-1');
    sim.land();
    sim.done(sim.planned('p-1').id);
    sim.settle();
    expect(sim.steering.waiting).toBeNull();
    sim.tick();
    sim.done(sim.planned('p-2').id);
    sim.settle();
    expect(sim.steering.waiting).toEqual({ milestone: 'ms-1', since: sim.now, report: null });
    expect(waits(sim)).toBe(true);
    expect(sim.lastTo('ceo').text).toMatch(/^“Menu pages live” is done: every task of the plan up to it is finished\. Report to Robin with report/);
  });

  it("links the CEO's report to the hold, once", () => {
    const sim = new Sim({ planApproval: 'milestones' });
    propose(sim);
    approve(sim, 1, 'ms-1');
    for (const pt of ['p-1', 'p-2']) sim.done(sim.planned(pt).id);
    sim.settle();
    const report = { id: 'r-1', person: 'ceo', to: STAKEHOLDER, taskId: null, outcome: 'progress' as const, text: 'Menu pages are live.', at: sim.now };
    sim.apply([{ events: onReport(sim.ctx(), report), effects: [] }]);
    expect(sim.steering.waiting?.report).toBe('r-1');
    expect(onReport(sim.ctx(), { ...report, id: 'r-2' })).toEqual([]);
    expect(onReport(sim.ctx(), { ...report, id: 'r-3', person: 'head-of-design' })).toEqual([]);
  });

  it('starts the next milestone when it is approved', () => {
    const sim = new Sim({ planApproval: 'milestones' });
    propose(sim);
    approve(sim, 1, 'ms-1');
    for (const pt of ['p-1', 'p-2']) sim.done(sim.planned(pt).id);
    sim.settle();
    approve(sim, 1, 'ms-2');
    expect(sim.steering.waiting).toBeNull();
    expect(sim.state.tasks.map((t) => t.planTask)).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
    expect(sim.assignmentOf(sim.planned('p-3').id)).toBeDefined();
    expect(sim.assignmentOf(sim.planned('p-5').id)).toBeUndefined();
  });

  it('never holds a plan approved whole, and refuses an approval that covers less than before', () => {
    const sim = running({ planApproval: 'milestones' });
    for (const pt of ['p-1', 'p-2']) sim.done(sim.planned(pt).id);
    sim.settle();
    expect(sim.steering.waiting).toBeNull();
    expect(refusal(() => approve(sim, 1, 'ms-1')).message).toBe("Version 1 is approved through a later milestone already; an approval can't take work back. Edit the plan instead.");
  });
});

describe('with plan approval off', () => {
  it('applies the CEO\'s plan as proposed and hands out its turns', () => {
    const sim = new Sim({ planApproval: 'off' });
    propose(sim);
    expect(sim.steering.approved).toMatchObject({ version: 1, through: null, by: THE_OFFICE });
    expect(sim.state.tasks).toHaveLength(5);
    expect(sim.assignmentOf(sim.planned('p-1').id)).toBeDefined();
    expect(waits(sim)).toBe(false);
    expect(sim.lastDecision().what).toBe('The CEO proposed version 1 of the plan: two milestones and five tasks. It applies as proposed, since plan approval is off.');
  });

  it('applies the latest version when the setting goes off', () => {
    const sim = new Sim();
    propose(sim);
    sim.run((c) => changeSettings(c, STAKEHOLDER, { planApproval: 'off', cites: [] }));
    expect(sim.steering.approved).toMatchObject({ version: 1, through: null });
    expect(sim.state.tasks).toHaveLength(5);
  });

  it('lets managers assign freely', () => {
    const sim = new Sim({ planApproval: 'off' });
    expect(() => assignCheck(sim.ctx(), 'head-of-design', { parent: null, files: ['anything/'] })).not.toThrow();
  });
});

describe('a new version of an approved plan', () => {
  it('cuts, adds, changes and reorders the task tree to match', () => {
    const sim = running();
    sim.desks['ui-designer'] = 'working';
    const v1 = rawPlan();
    const [p1, p2, p3, p4, p5] = v1.tasks;
    if (!p1 || !p2 || !p3 || !p4 || !p5) throw new Error('The kit plan changed.');
    const v2: Plan = {
      ...v1,
      tasks: [
        { ...p4, owner: 'frontend-engineer' },
        p1,
        { ...p3, brief: 'Pick a slot of ten minutes.' },
        { id: 'p-6', title: 'Receipt', owner: 'backend-engineer', files: ['api/receipts/'], milestone: 'ms-2', after: [], brief: 'Send one.', doneWhen: 'It arrives.', check: 'npm test' },
        { ...p5, after: ['p-1', 'p-3', 'p-4', 'p-6'] },
      ],
    };
    propose(sim, v2);
    sim.tick();
    approve(sim, 2);
    const menuLook = sim.task('t-2');
    expect(menuLook).toMatchObject({ status: 'dropped', cancel: { reason: 'Cut from the plan in version 2', branch: null } });
    expect(sim.stops.some((id) => sim.message(id).to === 'ui-designer')).toBe(true);
    expect(Object.keys(sim.steering.saving)).toEqual(['t-2']);
    expect(sim.planned('p-3').brief).toBe('Pick a slot of ten minutes.');
    expect(sim.planned('p-4')).toMatchObject({ owner: 'frontend-engineer', handovers: [{ from: 'backend-engineer', to: 'frontend-engineer' }] });
    expect(sim.lastTo('frontend-engineer').text).toContain('Task t-4, “Order API”, is yours now');
    expect(sim.planned('p-6')).toMatchObject({ title: 'Receipt', status: 'queued' });
    const order = sim.state.tasks.filter((t) => t.status !== 'dropped').sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).map((t) => t.planTask);
    expect(order).toEqual(['p-4', 'p-1', 'p-3', 'p-6', 'p-5']);
  });

  it('tells the owner of a task under way what the new version changed in it', () => {
    const sim = running();
    const v1 = rawPlan();
    propose(sim, { ...v1, tasks: v1.tasks.map((t) => (t.id === 'p-1' ? { ...t, brief: 'The menu as data, with allergens.' } : t)) });
    approve(sim, 2);
    expect(sim.planned('p-1').brief).toBe('The menu as data, with allergens.');
    expect(sim.lastTo('frontend-engineer').text).toMatch(/^Version 2 of the plan changes your task t-1: its brief changed\./);
  });

  it('keeps done work and the stakeholder\'s own cancels as they are', () => {
    const sim = running();
    sim.done(sim.planned('p-1').id);
    sim.world = applyEvents(sim.world, [
      { type: 'task-status', id: sim.planned('p-2').id, status: 'dropped', at: sim.now },
      { type: 'task-cancelled', id: sim.planned('p-2').id, cancel: { at: sim.now, by: STAKEHOLDER, reason: 'Not now.', branch: null } },
    ]);
    propose(sim, rawPlan({ goal: 'Order ahead, quickly.' }));
    approve(sim, 2);
    expect(sim.planned('p-1').status).toBe('done');
    expect(sim.planned('p-2').status).toBe('dropped');
    expect(sim.state.tasks).toHaveLength(5);
  });
});

describe("the stakeholder's own edit", () => {
  it('is a new version by the stakeholder, which the CEO hears of and Undo can take back', () => {
    const sim = new Sim();
    propose(sim);
    // Cutting Menu look takes it out of what the final check waits for, as a person's edit has to.
    const edited = rawPlan({ tasks: rawPlan().tasks.filter((t) => t.id !== 'p-2').map((t) => (t.id === 'p-5' ? { ...t, after: t.after.filter((a) => a !== 'p-2') } : t)) });
    const result = sim.run((c) => editPlan(c, STAKEHOLDER, { plan: edited, note: 'The café prints its own menu cards.' }));
    expect(result).toMatchObject({ ok: true, version: { version: 2, by: STAKEHOLDER, note: 'The café prints its own menu cards.' } });
    expect(sim.lastTo('ceo').text).toBe("Robin edited the plan: version 2. Cut “Menu look” and changed “Final review of the whole result”. Robin's note: The café prints its own menu cards. No task covers the checklist item “Menu look works as asked.” (k-2) yet; cover it if you revise the plan. Build on this version if you revise it.");
    const d = sim.lastDecision();
    expect(d).toMatchObject({ kind: 'plan', by: STAKEHOLDER, what: 'You edited the plan, as version 2: The café prints its own menu cards.', reversible: true });
    expect(sim.steering.undos[d.id]).toEqual({ kind: 'plan', key: 'plan', version: 1 });
  });

  it("says what changed when there's no note", () => {
    const sim = new Sim();
    propose(sim);
    sim.run((c) => editPlan(c, STAKEHOLDER, { plan: rawPlan({ tasks: [...rawPlan().tasks].reverse() }), note: null }));
    expect(sim.lastDecision().what).toMatch(/^You edited the plan, as version 2: moved /);
  });

  it('comes back unchanged when nothing changed, and with the sentences when it fails the check', () => {
    const sim = new Sim();
    propose(sim);
    expect(sim.run((c) => editPlan(c, STAKEHOLDER, { plan: rawPlan(), note: null }))).toMatchObject({ ok: true, version: { version: 1 } });
    const bad = sim.run((c) => editPlan(c, STAKEHOLDER, { plan: { ...rawPlan(), goal: '' }, note: null }));
    expect(bad).toEqual({ ok: false, errors: ['The plan has no goal; say what the company is building.'] });
  });

  it("is the stakeholder's alone", () => {
    const sim = new Sim();
    propose(sim);
    expect(refusal(() => sim.run((c) => editPlan(c, 'ceo', { plan: rawPlan(), note: null }))).code).toBe('not-allowed');
  });

  it('goes back to an earlier version as a new one', () => {
    const sim = new Sim();
    propose(sim);
    sim.run((c) => editPlan(c, STAKEHOLDER, { plan: rawPlan({ goal: 'Something else.' }), note: null }));
    sim.apply(revertSteps(sim.ctx(), 1));
    expect(sim.steering.versions.map((v) => [v.version, v.by, v.plan.goal])).toEqual([
      [1, 'ceo', rawPlan().goal],
      [2, STAKEHOLDER, 'Something else.'],
      [3, STAKEHOLDER, rawPlan().goal],
    ]);
  });
});

describe('comments', () => {
  it('reach the CEO as the stakeholder\'s message, tied to the plan', () => {
    const sim = new Sim();
    propose(sim);
    const comment = sim.run((c) => commentPlan(c, STAKEHOLDER, { on: { kind: 'task', id: 'p-3' }, text: 'Slots of ten minutes.' }));
    expect(comment).toMatchObject({ id: 'c-1', by: STAKEHOLDER, version: 1, on: { kind: 'task', id: 'p-3' }, text: 'Slots of ten minutes.' });
    const m = sim.message(comment.message ?? '');
    expect(m).toMatchObject({ from: STAKEHOLDER, to: 'ceo', text: 'A comment on the plan (version 1), on the task “Slot picker”: Slots of ten minutes.' });
    expect(sim.handed).toContain(m.id);
  });

  it('are refused on something the plan lacks, from anyone else, and when too long', () => {
    const sim = new Sim();
    propose(sim);
    expect(refusal(() => sim.run((c) => commentPlan(c, STAKEHOLDER, { on: { kind: 'milestone', id: 'ms-9' }, text: 'Hm.' }))).message).toBe('Version 1 of the plan has no milestone ms-9.');
    expect(refusal(() => sim.run((c) => commentPlan(c, 'head-of-design', { on: { kind: 'plan' }, text: 'Hm.' }))).code).toBe('not-allowed');
    expect(refusal(() => sim.run((c) => commentPlan(c, STAKEHOLDER, { on: { kind: 'plan' }, text: 'x'.repeat(2001) }))).message).toBe('Keep a comment to 2,000 characters.');
  });
});

describe('assign while a plan governs', () => {
  it('is refused before any plan is approved, saying where work starts', () => {
    const sim = new Sim();
    expect(refusal(() => assignCheck(sim.ctx(), 'ceo', { parent: null, files: [] })).message).toBe(
      'Work starts from the plan here: propose it with propose_plan, and once Robin approves it, its tasks reach their owners. Until then nobody assigns work.',
    );
  });

  it('takes a part of an approved task inside its files', () => {
    const sim = running();
    expect(() => assignCheck(sim.ctx(), 'frontend-lead', { parent: sim.planned('p-1').id, files: ['src/menu/Card.tsx', './src/menu'] })).not.toThrow();
  });

  it('refuses work outside the plan, files outside the task, and parts of a task whose turn has not come', () => {
    const sim = running();
    expect(refusal(() => assignCheck(sim.ctx(), 'frontend-lead', { parent: null, files: [] })).message).toMatch(/^While the plan governs, assign only parts of approved tasks/);
    expect(refusal(() => assignCheck(sim.ctx(), 'frontend-lead', { parent: sim.planned('p-1').id, files: ['src/cart/'] })).message).toBe(
      "src/cart isn't inside the files of task t-1 (src/menu), so it can't be part of it; keep to its files, or ask the CEO to change the plan.",
    );
    expect(refusal(() => assignCheck(sim.ctx(), 'frontend-lead', { parent: sim.planned('p-3').id, files: [] })).message).toBe('Task t-3 waits for “Menu data” first, so its parts can\'t start yet.');
  });

  it("refuses a part of a task that is done, paused or isn't approved work", () => {
    const sim = running();
    sim.done(sim.planned('p-2').id);
    expect(refusal(() => assignCheck(sim.ctx(), 'head-of-design', { parent: sim.planned('p-2').id, files: [] })).message).toBe('Task t-2 is done, so it takes no more parts.');
    sim.world = applyEvents(sim.world, [{ type: 'task-paused', id: sim.planned('p-1').id, paused: { at: sim.now, by: STAKEHOLDER }, at: sim.now }]);
    expect(refusal(() => assignCheck(sim.ctx(), 'frontend-lead', { parent: sim.planned('p-1').id, files: [] })).message).toBe('Task t-1 is paused; it takes parts again once it resumes.');
    const loose = { ...sim.planned('p-4'), id: 't-99', planTask: null, askedBy: 'frontend-lead', priority: 9 };
    sim.world = applyEvents(sim.world, [{ type: 'task', task: loose, messageId: null }]);
    expect(refusal(() => assignCheck(sim.ctx(), 'frontend-lead', { parent: 't-99', files: [] })).message).toBe(
      "Task t-99 isn't part of the approved plan, so it can't be split; ask the CEO to add the work to the plan.",
    );
  });

  it("doesn't count the files of plan tasks that run only after the one a part belongs to, directly or through others", () => {
    const sim = running();
    // Slot picker waits for Menu data, and the final check for everything.
    expect([...laterThan(sim.ctx(), sim.planned('p-1').id)]).toEqual([sim.planned('p-3').id, sim.planned('p-5').id]);
    expect([...laterThan(sim.ctx(), sim.planned('p-5').id)]).toEqual([]);
  });

  it('refuses set_goal, since the plan sets the goal', () => {
    expect(refusal(() => refuseSetGoal(new Sim().ctx())).message).toBe('The plan sets the goal and its milestones here; propose a new version with propose_plan.');
    expect(() => refuseSetGoal(new Sim({ planApproval: 'off' }).ctx())).not.toThrow();
  });
});

describe('the board order with the plan', () => {
  it('gives the plan\'s order the places its tasks held, and puts new ones after the task before them', () => {
    expect(mergePlanOrder(['x', 'a', 'y', 'b', 'z'], ['b', 'n1', 'a', 'n2'])).toEqual(['x', 'b', 'n1', 'y', 'a', 'n2', 'z']);
    expect(mergePlanOrder(['x', 'a', 'y'], ['n0', 'a'])).toEqual(['x', 'n0', 'a', 'y']);
    expect(mergePlanOrder(['x', 'y'], ['n1', 'n2'])).toEqual(['x', 'y', 'n1', 'n2']);
    expect(mergePlanOrder([], ['n1'])).toEqual(['n1']);
  });
});

describe("the CEO's start turn", () => {
  it('asks for the plan first while approval is on, and says nothing new while it is off', () => {
    expect(startTurnLines(new Sim({ planApproval: 'milestones' }).ctx())?.join(' ')).toContain('Robin approves it before work starts, one milestone at a time');
    expect(startTurnLines(new Sim({ planApproval: 'off' }).ctx())).toBeNull();
  });
});

describe('time', () => {
  it('stamps versions and approvals with the company clock', () => {
    const sim = new Sim();
    propose(sim);
    sim.tick(5 * MIN);
    const approval = approve(sim, 1);
    expect(approval.at).toBe(sim.now);
    expect(sim.steering.versions[0]?.at).toBe(sim.now - 5 * MIN);
  });
});
