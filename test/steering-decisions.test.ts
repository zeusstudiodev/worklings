// The decision log (src/company/decisions.ts and src/core/steering-state.ts): decisions from every source, Undo
// through each kind's inverse (an undo is a decision too, which Undo can take back while it is the newest), Reconsider,
// the view's projection and the state read back from company.json.
import { DEFAULT_PRESET, PRESETS } from '../src/core/presets.ts';
import { describe, expect, it } from 'vitest';
import { cancelAgain, reopenSteps, steerTask } from '../src/company/board.ts';
import {
  answerDecision,
  applyEvents,
  approvalDecision,
  officeDecision,
  officeInverse,
  orgDecision,
  reconsider,
  recordDecision,
  type UndoOps,
  undoDecision,
} from '../src/company/decisions.ts';
import { changeSettings, settingsUndoSteps } from '../src/company/leash.ts';
import { editPlan, proposePlan, revertSteps } from '../src/company/plan.ts';
import type { Approval, OfficeChange, Question, Task } from '../src/core/company.ts';
import { STEERING_VIEW_LIMITS, type Ack, type Decision } from '../src/core/steering.ts';
import { blankSteering, foldSteering, reviveSteering, STEERING_STATE_LIMITS, steeringView } from '../src/core/steering-state.ts';
import { PEOPLE, rawPlan, refusal, Sim, STAKEHOLDER, THE_OFFICE } from './steering-core-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

/** The desks at once a new company starts with: its preset's (Balanced). */
const DESKS = PRESETS[DEFAULT_PRESET].desks;

/** Undo's carrying out, as the company wires it: steering's own kinds through their modules, the org flow faked. */
function ops(sim: Sim, calls: string[] = [], org = { ok: true, message: 'Done.', changed: [] as string[] }): UndoOps {
  return {
    settings: (change) => settingsUndoSteps(sim.ctx(), change),
    plan: (version) => revertSteps(sim.ctx(), version),
    reopen: (tasks) => reopenSteps(sim.ctx(), tasks),
    cancel: (tasks, reason) => cancelAgain(sim.ctx(), tasks, reason),
    org: (plan) => {
      calls.push(`org ${JSON.stringify(plan.change)}`);
      return org;
    },
    office: (change) => {
      calls.push(`office ${JSON.stringify(change)}`);
      return org;
    },
  };
}

/** A firing as the org flow leaves it: off the staff, and in studio.yaml's fired list. */
function fire(sim: Sim, id: string): void {
  const gone = sim.people.find((p) => p.id === id);
  sim.people = sim.people.filter((p) => p.id !== id);
  if (gone) sim.fired.push(gone);
}

const undo = (sim: Sim, id: string, calls: string[] = []) => sim.run((c) => undoDecision(c, ops(sim, calls), STAKEHOLDER, id));
const record = (sim: Sim, events: ReturnType<typeof answerDecision>) => sim.apply([{ events, effects: [] }]);

function question(sim: Sim, extra: Partial<Question> = {}): Question {
  const q: Question = { id: sim.newId('question'), from: 'head-of-design', text: 'Which spelling?', options: ['Swiss', 'German'], recommended: 0, taskId: null, askedAt: sim.now, answer: null, withdrawn: null, ...extra };
  return { ...q, answer: { option: 0, text: 'With ss, not ß.', at: sim.now, appliesAt: sim.now } };
}

function approval(sim: Sim, answer: NonNullable<Approval['answer']>): Approval {
  return {
    id: sim.newId('approval'), person: 'ui-designer', tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push', kind: 'push', askedAt: sim.now,
    expiresAt: sim.now + 60_000, alwaysRule: { rule: 'Bash(git push:*)', sentence: 'Pushes from this company.' }, answer, withdrawn: null,
  };
}

describe('what people decide (the decide tool)', () => {
  it("records the decision with its why, its alternatives, the stakeholder's message it follows and the task it was made on", () => {
    const sim = new Sim();
    const word = sim.say('ui-designer', 'Darker, please.');
    const t: Task = { id: 't-24', title: 'Palette', brief: '', owner: 'ui-designer', askedBy: 'head-of-design', files: [], doneWhen: 'Done.', status: 'working', outcome: null, parent: null, milestone: null, worktree: null, commit: null, createdAt: sim.now, updatedAt: sim.now };
    sim.world = applyEvents(sim.world, [{ type: 'task', task: t, messageId: null }]);
    const d = sim.run((c) => recordDecision(c, 'ui-designer', { what: 'Text goes espresso brown, #3B2A20.', why: 'Readable in sunlight.', alternatives: ['Dark grey', 'Bold prices only'], cites: [word.id] }));
    expect(d).toMatchObject({
      by: 'ui-designer', kind: 'decide', what: 'Text goes espresso brown, #3B2A20.', why: 'Readable in sunlight.', alternatives: ['Dark grey', 'Bold prices only'],
      people: ['ui-designer', 'head-of-design'], rooms: ['design'], links: { message: word.id, task: 't-24' }, reversible: false, undone: null, reconsider: null,
    });
  });

  it("links a relay of the stakeholder's message over a manager's own", () => {
    const sim = new Sim();
    const mine = sim.post('head-of-design', 'ui-designer', 'Keep the chalk texture.');
    const relayed = sim.newMessage('head-of-design', 'ui-designer', 'Darker, please.');
    sim.world = applyEvents(sim.world, [{ type: 'message', message: { ...relayed, origin: STAKEHOLDER } }]);
    const d = sim.run((c) => recordDecision(c, 'ui-designer', { what: 'Darker text.', why: '', alternatives: [], cites: [mine.id, relayed.id] }));
    expect(d.links.message).toBe(relayed.id);
    expect(d.why).toBeNull();
  });

  it("refuses a cite that isn't the person's own message, the stakeholder, and words over the limits", () => {
    const sim = new Sim();
    const notMine = sim.say('head-of-design', 'Darker.');
    const call = (by: string, input: Partial<Parameters<typeof recordDecision>[2]>) => () => sim.run((c) => recordDecision(c, by, { what: 'Darker.', why: '', alternatives: [], cites: [], ...input }));
    expect(refusal(call('ui-designer', { cites: [notMine.id] })).message).toBe(`You can cite only messages you received, and ${notMine.id} isn't one of yours.`);
    expect(refusal(call(STAKEHOLDER, {})).code).toBe('not-allowed');
    expect(refusal(call('ui-designer', { what: ' ' })).message).toBe('Say what you decided, in one sentence.');
    expect(refusal(call('ui-designer', { what: 'x'.repeat(301) })).message).toBe('Say what you decided in up to 300 characters; the why can say more.');
    expect(refusal(call('ui-designer', { alternatives: ['a', 'b', 'c', 'd', 'e'] })).message).toBe('Name up to 4 alternatives: the ones you weighed most.');
    expect(refusal(call('ui-designer', { alternatives: [3] })).message).toBe('List the alternatives as sentences.');
    expect(refusal(call('nobody', {})).code).toBe('unknown');
  });
});

describe("the stakeholder's answers, approvals and rules", () => {
  it('records an answer with its question and task', () => {
    const sim = new Sim();
    const q = question(sim, { taskId: 't-3' });
    record(sim, answerDecision(sim.ctx(), q));
    expect(sim.lastDecision()).toMatchObject({ kind: 'answer', what: 'You answered Ada: Swiss: With ss, not ß.', links: { question: q.id, task: 't-3' }, people: [STAKEHOLDER, 'head-of-design'], rooms: ['design'] });
  });

  it('records an approval once and a denial with its why', () => {
    const sim = new Sim();
    record(sim, approvalDecision(sim.ctx(), approval(sim, { decision: 'allow', always: false, at: sim.now, appliesAt: sim.now, note: null })));
    expect(sim.lastDecision()).toMatchObject({ kind: 'approval', what: 'You allowed Kai to push the work branch to GitHub, once.', reversible: false });
    record(sim, approvalDecision(sim.ctx(), approval(sim, { decision: 'deny', always: false, at: sim.now, appliesAt: sim.now, note: 'Not before the review.' })));
    expect(sim.lastDecision()).toMatchObject({ kind: 'approval', what: "You didn't allow Kai to push the work branch to GitHub.", why: 'Not before the review.' });
  });

  it('records Always allow as a rule, which Undo removes and Undo again puts back', () => {
    const sim = new Sim();
    const a = approval(sim, { decision: 'allow', always: true, at: sim.now, appliesAt: sim.now, note: null });
    sim.world = applyEvents(sim.world, [{ type: 'settings', settings: { ...sim.state.settings, alwaysAllow: ['Bash(git push:*)'] } }]);
    record(sim, approvalDecision(sim.ctx(), a));
    const rule = sim.lastDecision();
    expect(rule).toMatchObject({ kind: 'rule', what: 'You always allowed Kai to push the work branch to GitHub: Bash(git push:*).', reversible: true, links: { approval: a.id } });
    const undone = undo(sim, rule.id);
    expect(sim.state.settings.alwaysAllow).toEqual([]);
    expect(undone).toMatchObject({ kind: 'undo', what: 'You undid “You always allowed Kai to push the work branch to GitHub: Bash(git push:*)”: Bash(git push:*) is asked again.', links: { decision: rule.id } });
    expect(sim.decisions().find((d) => d.id === rule.id)?.undone).toEqual({ at: sim.now, by: STAKEHOLDER, decision: undone.id });
    undo(sim, undone.id);
    expect(sim.state.settings.alwaysAllow).toEqual(['Bash(git push:*)']);
  });
});

describe('org and office changes', () => {
  it('records each change to the org with the change that takes it back', () => {
    const sim = new Sim();
    record(sim, orgDecision(sim.ctx(), 'ceo', { action: 'hire', role: 'ux-designer' }, 'The CEO hired Lea, UX designer.'));
    record(sim, orgDecision(sim.ctx(), STAKEHOLDER, { action: 'fire', role: 'office-manager' }, 'You let Tia go.'));
    record(sim, orgDecision(sim.ctx(), 'ceo', { action: 'move', role: 'ui-designer', before: { room: 'engineering', reportsTo: 'frontend-lead' } }, 'The CEO moved Kai to Design.'));
    record(sim, orgDecision(sim.ctx(), 'ceo', { action: 'rehire', role: 'qa-engineer' }, 'The CEO rehired the QA engineer.'));
    expect(sim.decisions().map((d) => [d.kind, d.what, sim.steering.undos[d.id]])).toEqual([
      ['org', 'The CEO hired Lea, UX designer.', { kind: 'org', key: 'org:ux-designer', change: { action: 'fire', role: 'ux-designer' } }],
      ['org', 'You let Tia go.', { kind: 'org', key: 'org:office-manager', change: { action: 'rehire', role: 'office-manager' } }],
      ['org', 'The CEO moved Kai to Design.', { kind: 'org', key: 'org:ui-designer', change: { action: 'move', role: 'ui-designer', room: 'engineering', reportsTo: 'frontend-lead' } }],
      ['org', 'The CEO rehired the QA engineer.', { kind: 'org', key: 'org:qa-engineer', change: { action: 'fire', role: 'qa-engineer' } }],
    ]);
  });

  it('works out the inverse of every office change from the office before it', () => {
    const before = new Sim().office;
    const cases: [OfficeChange, OfficeChange | null][] = [
      [{ change: 'theme', theme: 'arcade' }, { change: 'theme', theme: 'cafe' }],
      [{ change: 'theme', theme: 'cafe' }, null],
      [{ change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games' } }, { change: 'remove-room', room: 'games' }],
      [{ change: 'remove-room', room: 'meeting' }, { change: 'add-room', room: { id: 'meeting', title: 'Meeting room', kind: 'meeting' } }],
      [{ change: 'room-theme', room: 'design', theme: 'garden' }, { change: 'room-theme', room: 'design', theme: null }],
      [{ change: 'decor', add: ['arcade-machine'], remove: ['plant'] }, { change: 'decor', add: ['plant'], remove: ['arcade-machine'] }],
      [{ change: 'look', person: 'ui-designer', look: { color: '#000000' } }, { change: 'look', person: 'ui-designer', look: { color: '#336699' } }],
    ];
    for (const [change, inverse] of cases) expect(officeInverse(change, before)).toEqual(inverse);
  });

  it('records an office change as reversible only when it changed something', () => {
    const sim = new Sim();
    record(sim, officeDecision(sim.ctx(), 'office-manager', { change: 'theme', theme: 'arcade' }, sim.office, 'Tia made the office an arcade.'));
    expect(sim.lastDecision()).toMatchObject({ kind: 'office', what: 'Tia made the office an arcade.', reversible: true });
    record(sim, officeDecision(sim.ctx(), 'office-manager', { change: 'theme', theme: 'cafe' }, sim.office, 'Tia made the office a café.'));
    expect(sim.lastDecision().reversible).toBe(false);
  });
});

describe('undo', () => {
  it('takes an org change back through the org flow', () => {
    const sim = new Sim();
    record(sim, orgDecision(sim.ctx(), 'ceo', { action: 'hire', role: 'ux-designer' }, 'The CEO hired Lea, UX designer.'));
    const calls: string[] = [];
    const d = undo(sim, sim.lastDecision().id, calls);
    expect(calls).toEqual(['org {"action":"fire","role":"ux-designer"}']);
    expect(d.what).toBe('You undid “The CEO hired Lea, UX designer”: Lea is let go again.');
    expect(sim.steering.undos[d.id]).toEqual({ kind: 'org', key: 'org:ux-designer', change: { action: 'rehire', role: 'ux-designer' } });
  });

  it("is refused when the org flow refuses, leaving the decision as it was", () => {
    const sim = new Sim();
    record(sim, orgDecision(sim.ctx(), 'ceo', { action: 'hire', role: 'ux-designer' }, 'The CEO hired Lea.'));
    const id = sim.lastDecision().id;
    const refused = refusal(() => sim.run((c) => undoDecision(c, ops(sim, [], { ok: false, message: 'studio.yaml has a mistake.', changed: [] }), STAKEHOLDER, id)));
    expect(refused).toEqual({ code: 'conflict', message: 'studio.yaml has a mistake.' });
    expect(sim.decisions().find((d) => d.id === id)?.undone).toBeNull();
  });

  it('takes an office change back with its inverse', () => {
    const sim = new Sim();
    record(sim, officeDecision(sim.ctx(), STAKEHOLDER, { change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games' } }, sim.office, 'You added the games room.'));
    const calls: string[] = [];
    undo(sim, sim.lastDecision().id, calls);
    expect(calls).toEqual(['office {"change":"remove-room","room":"games"}']);
  });

  it('takes a plan edit back to the version before, as a new version', () => {
    const sim = new Sim();
    sim.run((c) => proposePlan(c, 'ceo', withChecklist(rawPlan())));
    sim.run((c) => editPlan(c, STAKEHOLDER, { plan: rawPlan({ goal: 'Only menus.' }), note: null }));
    const d = undo(sim, sim.lastDecision().id);
    expect(sim.steering.versions.map((v) => v.plan.goal)).toEqual([rawPlan().goal, 'Only menus.', rawPlan().goal]);
    expect(d.links).toEqual({ decision: sim.decisions().at(-2)?.id, planVersion: 3 });
    expect(sim.steering.undos[d.id]).toEqual({ kind: 'plan', key: 'plan', version: 2 });
  });

  it("can't take back a plan edit once the CEO has proposed a newer version", () => {
    const sim = new Sim();
    sim.run((c) => proposePlan(c, 'ceo', withChecklist(rawPlan())));
    sim.run((c) => editPlan(c, STAKEHOLDER, { plan: rawPlan({ goal: 'Only menus.' }), note: null }));
    const edit = sim.lastDecision();
    sim.run((c) => proposePlan(c, 'ceo', withChecklist(rawPlan({ goal: 'Menus and pickup.' }))));
    expect(refusal(() => undo(sim, edit.id))).toEqual({ code: 'conflict', message: 'Something later changed the same thing, so this one can only be undone after that.' });
  });

  it('takes settings and a leash back to what they were, and an undo can be undone', () => {
    const sim = new Sim();
    sim.run((c) => changeSettings(c, STAKEHOLDER, { maxDesks: 4, cites: [] }));
    const d = undo(sim, sim.lastDecision().id);
    expect(sim.state.settings.maxDesks).toBe(DESKS);
    expect(d.what).toBe(`You undid “You set 4 desks at once”: ${DESKS} desks at once again.`);
    undo(sim, d.id);
    expect(sim.state.settings.maxDesks).toBe(4);
    sim.run((c) => changeSettings(c, STAKEHOLDER, { leash: { person: 'german-copywriter', leash: 'check' }, cites: [] }));
    const leash = undo(sim, sim.lastDecision().id);
    expect(Object.hasOwn(sim.steering.settings.leash.people, 'german-copywriter')).toBe(false);
    expect(leash.what).toBe('You undid “You set Lena to check with you before each task”: Lena has no leash of their own again.');
  });

  it('takes a model change back through the reshape path, and plan approval back to what it was', () => {
    const sim = new Sim();
    sim.run((c) => changeSettings(c, STAKEHOLDER, { model: { person: 'ui-designer', model: 'opus' }, planApproval: 'milestones', cites: [] }));
    const model = sim.decisions().find((d) => d.what === 'You moved Kai to Opus.');
    const approval = sim.decisions().find((d) => d.what === 'You set plan approval to “At every milestone”.');
    undo(sim, model?.id ?? '');
    expect(sim.effects.at(-1)).toEqual({ kind: 'model', person: 'ui-designer', model: 'sonnet' });
    expect(sim.lastDecision().what).toBe('You undid “You moved Kai to Opus”: Kai runs on Sonnet again.');
    undo(sim, approval?.id ?? '');
    expect(sim.steering.settings.planApproval).toBe('before-work');
  });

  it('only takes back the newest change of a thing, then the one before once that is undone', () => {
    const sim = new Sim();
    sim.run((c) => changeSettings(c, STAKEHOLDER, { maxDesks: 4, cites: [] }));
    const first = sim.lastDecision();
    sim.run((c) => changeSettings(c, STAKEHOLDER, { maxDesks: 6, cites: [] }));
    const second = sim.lastDecision();
    expect(refusal(() => undo(sim, first.id)).code).toBe('conflict');
    undo(sim, second.id);
    expect(sim.state.settings.maxDesks).toBe(4);
    undo(sim, first.id);
    expect(sim.state.settings.maxDesks).toBe(DESKS);
    const view = steeringView({ steering: sim.steering, acks: [], people: PEOPLE });
    expect(view.decisions.filter((d) => d.reversible).map((d) => d.kind)).toEqual(['undo']);
  });

  it('opens a cancelled task again, naming where its work is', () => {
    const sim = new Sim();
    const t: Task = { id: 't-18', title: 'Apple Pay', brief: 'Cards.', owner: 'frontend-engineer', askedBy: 'frontend-lead', files: ['src/pay'], doneWhen: 'Paid.', status: 'working', outcome: null, parent: null, milestone: null, worktree: null, commit: null, createdAt: sim.now, updatedAt: sim.now };
    sim.world = applyEvents(sim.world, [{ type: 'task', task: t, messageId: null }]);
    sim.run((c) => steerTask(c, STAKEHOLDER, { action: 'cancel', task: 't-18', reason: 'TWINT only.', cites: [] }));
    sim.world = applyEvents(sim.world, [{ type: 'task-saved', save: 't-18', tasks: ['t-18'], branch: 'worklings/cafe--t-18' }]);
    const d = undo(sim, sim.lastDecision().id);
    expect(sim.task('t-18')).toMatchObject({ status: 'queued', cancel: null });
    expect(sim.lastTo('frontend-engineer').text).toContain('Your earlier work on it is on the branch worklings/cafe--t-18');
    expect(d).toMatchObject({ what: 'You undid “You cancelled “Apple Pay”: TWINT only”: the task is open again.', links: { decision: expect.any(String), task: 't-18' } });
    expect(sim.steering.undos[d.id]).toEqual({ kind: 'cancel', key: 'task:t-18', tasks: ['t-18'], reason: 'TWINT only.' });
    undo(sim, d.id);
    expect(sim.task('t-18')).toMatchObject({ status: 'dropped', cancel: { reason: 'TWINT only.' } });
  });

  it("is refused when what it needs is gone: a rule already removed, a person who left", () => {
    const sim = new Sim();
    sim.world = applyEvents(sim.world, [{ type: 'settings', settings: { ...sim.state.settings, alwaysAllow: ['Bash(git push:*)'] } }]);
    record(sim, approvalDecision(sim.ctx(), approval(sim, { decision: 'allow', always: true, at: sim.now, appliesAt: sim.now, note: null })));
    const rule = sim.lastDecision();
    sim.world = applyEvents(sim.world, [{ type: 'settings', settings: { ...sim.state.settings, alwaysAllow: [] } }]);
    expect(refusal(() => undo(sim, rule.id)).message).toBe('That rule is gone already, so there is nothing to undo.');
    sim.run((c) => changeSettings(c, STAKEHOLDER, { effort: { person: 'backend-engineer', effort: 'max' }, cites: [] }));
    const effort = sim.lastDecision();
    fire(sim, 'backend-engineer');
    expect(refusal(() => undo(sim, effort.id)).message).toBe("Noah isn't in the company any more.");
  });

  it("is the stakeholder's alone, and only for decisions that can be undone", () => {
    const sim = new Sim();
    sim.run((c) => changeSettings(c, STAKEHOLDER, { maxDesks: 4, cites: [] }));
    const id = sim.lastDecision().id;
    expect(refusal(() => sim.run((c) => undoDecision(c, ops(sim), 'ceo', id))).code).toBe('not-allowed');
    expect(refusal(() => undo(sim, 'd-404')).code).toBe('unknown');
    record(sim, answerDecision(sim.ctx(), question(sim)));
    expect(refusal(() => undo(sim, sim.lastDecision().id)).message).toBe("That decision can't be undone; send it back with Reconsider, or decide again.");
    undo(sim, id);
    expect(refusal(() => undo(sim, id)).message).toBe('That decision was undone already.');
  });
});

describe('reconsider', () => {
  it('sends the decision back to whoever made it, with the note, as a message that cites it', () => {
    const sim = new Sim();
    const d = sim.run((c) => recordDecision(c, 'frontend-lead', { what: 'Checkout is two steps.', why: 'Keeps the cart safe.', alternatives: ['One page'], cites: [] }));
    const m = sim.run((c) => reconsider(c, STAKEHOLDER, { decision: d.id, note: 'One page would be quicker on a phone.' }));
    expect(m).toMatchObject({ from: STAKEHOLDER, to: 'frontend-lead', cites: [d.id], text: `Please reconsider your decision ${d.id}: “Checkout is two steps”\nOne page would be quicker on a phone.` });
    expect(sim.handed).toContain(m.id);
    expect(sim.decisions().find((x) => x.id === d.id)?.reconsider).toEqual({ at: sim.now, note: 'One page would be quicker on a phone.', message: m.id });
    expect(sim.lastDecision()).toMatchObject({ kind: 'reconsider', what: 'You asked Ola to reconsider “Checkout is two steps”.', links: { decision: d.id, message: m.id } });
  });

  it("is refused for the stakeholder's own decisions, the office's, someone who left, and without a note", () => {
    const sim = new Sim();
    sim.run((c) => changeSettings(c, STAKEHOLDER, { maxDesks: 4, cites: [] }));
    const own = sim.lastDecision();
    expect(refusal(() => sim.run((c) => reconsider(c, STAKEHOLDER, { decision: own.id, note: 'Hm.' }))).message).toBe('You made that decision yourself; undo it, or decide again.');
    const office: Decision = { ...own, id: 'd-90', by: THE_OFFICE };
    sim.world = applyEvents(sim.world, [{ type: 'decision-recorded', decision: office, key: null, undo: null }]);
    expect(refusal(() => sim.run((c) => reconsider(c, STAKEHOLDER, { decision: 'd-90', note: 'Hm.' }))).code).toBe('closed');
    const d = sim.run((c) => recordDecision(c, 'qa-engineer', { what: 'Tests on a phone viewport.', why: '', alternatives: [], cites: [] }));
    expect(refusal(() => sim.run((c) => reconsider(c, STAKEHOLDER, { decision: d.id, note: ' ' }))).message).toBe('Say what to look at again, so they know what to reconsider.');
    expect(refusal(() => sim.run((c) => reconsider(c, 'ceo', { decision: d.id, note: 'Hm.' }))).code).toBe('not-allowed');
    fire(sim, 'qa-engineer');
    expect(refusal(() => sim.run((c) => reconsider(c, STAKEHOLDER, { decision: d.id, note: 'Hm.' }))).message).toBe("The QA engineer isn't in the company any more.");
  });
});

describe('the view and the state', () => {
  it('carries no plan before one is proposed, and the newest versions with the approved one after', () => {
    const sim = new Sim();
    expect(steeringView({ steering: sim.steering, acks: [], people: PEOPLE }).plan).toBeNull();
    sim.run((c) => proposePlan(c, 'ceo', withChecklist(rawPlan())));
    sim.world = applyEvents(sim.world, [{ type: 'plan-approved', approval: { version: 1, through: null, at: sim.now, by: STAKEHOLDER, cites: [] } }]);
    for (let i = 2; i <= 14; i += 1) sim.run((c) => proposePlan(c, 'ceo', withChecklist(rawPlan({ goal: `Goal ${i}.` }))));
    const view = steeringView({ steering: sim.steering, acks: [], people: PEOPLE });
    expect(view.plan?.versions.map((v) => v.version)).toEqual([1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(view.plan?.approved?.version).toBe(1);
  });

  it('carries the newest acknowledgements and decisions, and every person\'s leash', () => {
    const sim = new Sim();
    const acks: Ack[] = Array.from({ length: STEERING_VIEW_LIMITS.acks + 5 }, (_, i) => ({ id: `k-${i}`, message: `m-${i}`, by: 'ceo', agree: true, text: 'Will do.', at: i }));
    const view = steeringView({ steering: sim.steering, acks, people: PEOPLE });
    expect(view.acks).toHaveLength(STEERING_VIEW_LIMITS.acks);
    expect(view.acks[0]?.id).toBe('k-5');
    expect(Object.keys(view.people)).toEqual(PEOPLE.map((p) => p.id));
    expect(view.settings).toEqual({ planApproval: 'before-work', leash: { people: {}, rooms: {} }, effort: {} });
  });

  it("marks a decision reversible only while the company says its undo can run", () => {
    const sim = new Sim();
    sim.run((c) => changeSettings(c, STAKEHOLDER, { maxDesks: 4, cites: [] }));
    expect(steeringView({ steering: sim.steering, acks: [], people: PEOPLE, possible: () => false }).decisions[0]?.reversible).toBe(false);
    expect(steeringView({ steering: sim.steering, acks: [], people: PEOPLE }).decisions[0]?.reversible).toBe(true);
  });

  it('keeps the newest decisions, and their undos with them', () => {
    let host = { tasks: [] as Task[], assignments: {}, steering: blankSteering('before-work') };
    const at = 0;
    for (let i = 1; i <= STEERING_STATE_LIMITS.decisions + 2; i += 1) {
      const decision: Decision = { id: `d-${i}`, at, by: STAKEHOLDER, kind: 'setting', what: `Change ${i}.`, why: null, alternatives: [], people: [STAKEHOLDER], rooms: [], links: {}, reversible: true, undone: null, reconsider: null };
      host = foldSteering(host, { type: 'decision-recorded', decision, key: 'setting:maxDesks', undo: { kind: 'settings', key: 'setting:maxDesks', change: { maxDesks: 8 } } });
    }
    expect(host.steering.decisions).toHaveLength(STEERING_STATE_LIMITS.decisions);
    expect(host.steering.decisions[0]?.id).toBe('d-3');
    expect(Object.hasOwn(host.steering.undos, 'd-1')).toBe(false);
    expect(Object.hasOwn(host.steering.undos, 'd-3')).toBe(true);
    expect(host.steering.counters.decision).toBe(STEERING_STATE_LIMITS.decisions + 2);
  });

  it('reads back from company.json as it was, with records that have no prototype', () => {
    const sim = new Sim();
    sim.run((c) => proposePlan(c, 'ceo', withChecklist(rawPlan())));
    sim.run((c) => changeSettings(c, STAKEHOLDER, { leash: { person: 'german-copywriter', leash: 'check' }, effort: { person: 'ceo', effort: 'high' }, cites: [] }));
    const back = reviveSteering(JSON.parse(JSON.stringify(sim.steering)));
    expect(back).toEqual(sim.steering);
    expect(Object.getPrototypeOf(back.settings.leash.people)).toBeNull();
    expect(Object.getPrototypeOf(back.undos)).toBeNull();
  });

  it('runs a company from before steering with plan approval off, and drops values it doesn\'t know', () => {
    expect(reviveSteering(undefined).settings.planApproval).toBe('off');
    const back = reviveSteering({ settings: { planApproval: 'sometimes', leash: { people: { lena: 'loose', kai: 'trusted' }, rooms: [] }, effort: { kai: 'huge', noah: 'max' } } });
    expect(back.settings).toEqual({ planApproval: 'off', leash: { people: { kai: 'trusted' }, rooms: {} }, effort: { noah: 'max' } });
  });

  it('changes nothing for an event it doesn\'t know', () => {
    const host = { tasks: [] as Task[], assignments: {}, steering: blankSteering() };
    expect(foldSteering(host, { type: 'nothing' } as never)).toBe(host);
  });
});
