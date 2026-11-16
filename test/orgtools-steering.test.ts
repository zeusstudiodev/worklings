// Steering's org tools, called the way a desk calls them against the kit's company with a fake SteeringApi: who may
// use each, good calls with what reaches the company, every refusal with its sentence, the caps, and the citing rule,
// which the company applies (a cite that isn't the stakeholder's message to the CEO is refused there).
import { afterEach, describe, expect, it } from 'vitest';
import { type Message, personById, STAKEHOLDER, type Task, toolsFor } from '../src/core/company.ts';
import { DECISION_LIMITS, STEERING_TOOLS } from '../src/core/steering.ts';
import { tooLong } from '../src/core/too-long.ts';
import { closeServers, FakeCompany, NOW, office, type Office, ok, refused } from './orgtools-kit.ts';
import { type SteeringFake, steeringFake } from './orgtools-steering-kit.ts';

afterEach(closeServers);

type Steered = FakeCompany & SteeringFake;

/** The kit's company once it serves steering: every SteeringApi method, answering as the fake does. */
async function steeringOffice(): Promise<Office<Steered>> {
  const company = new FakeCompany();
  const steering = steeringFake({ people: () => company.staff, messages: () => company.messages, tasks: () => company.taskList, now: () => NOW + 100 });
  return office({ company: Object.assign(company, steering) });
}

/** A message from the stakeholder to someone, newer than anything the fake changes: their word to act on. */
function said(o: Office<Steered>, to: string, text: string): string {
  const m: Message = { id: `m-${o.company.messages.length + 1}`, from: STAKEHOLDER, to, text, origin: null, relayOf: null, note: null, at: NOW + 200, deliveredAt: NOW + 201, interrupt: false };
  o.company.messages.push(m);
  return m.id;
}

const steered = (o: Office<Steered>) => o.company.steered.map((c) => [c.method, c.by, c.input]);

const PLAN = {
  goal: 'Take pickup orders online by spring.',
  milestones: [{ id: 'ms-1', title: 'Pickup works', doneWhen: 'A guest can order and pay for pickup.' }],
  tasks: [
    { id: 'p-1', title: 'Map the pickup flow', owner: 'ux-designer', files: ['docs/flow.md'], milestone: 'ms-1', after: [], brief: 'Map it end to end.', doneWhen: 'The flow is reviewed.' },
    { id: 'p-2', title: 'Build the order page', owner: 'frontend-engineer', files: ['web/src/order/'], milestone: 'ms-1', after: ['p-1'], brief: 'Build it from the flow.', doneWhen: 'It works on a phone.' },
  ],
};

describe('who may use the steering tools', () => {
  it('lists ack and decide to everyone, steer_task to managers and the plan and settings tools to the CEO', async () => {
    const o = await steeringOffice();
    const expected: Record<string, string[]> = {
      'ui-designer': [...STEERING_TOOLS.everyone],
      'frontend-lead': [...STEERING_TOOLS.everyone, ...STEERING_TOOLS.managers],
      'head-of-design': [...STEERING_TOOLS.everyone, ...STEERING_TOOLS.managers],
      'qa-engineer': [...STEERING_TOOLS.everyone, ...STEERING_TOOLS.checkers],
      ceo: [...STEERING_TOOLS.everyone, ...STEERING_TOOLS.managers, ...STEERING_TOOLS.ceo, ...STEERING_TOOLS.checkers],
    };
    for (const [id, steering] of Object.entries(expected)) {
      const me = personById(o.company.staff, id);
      if (!me) throw new Error(`no ${id}`);
      expect(await o.list(id)).toEqual([...toolsFor(me), ...steering]);
    }
  });

  it("lists none of them, and message for one person, while the company doesn't serve steering", async () => {
    const o = await office();
    expect(await o.list('ceo')).not.toContain('ack');
    expect((await o.listed('ceo', 'message')).inputSchema).toMatchObject({ required: ['to', 'text'], properties: { to: {}, text: {} } });
    expect((await o.listed('ceo', 'message')).inputSchema).not.toHaveProperty('properties.room');
    expect(await o.call('ui-designer', 'ack', { message: 'm-2', agree: true, text: 'On it.' })).toEqual(refused("This company doesn't take ack yet."));
  });

  it("refuses the managers' and the CEO's steering tools to those below them, without asking the company", async () => {
    const o = await steeringOffice();
    expect(await o.call('ui-designer', 'steer_task', { action: 'pause', task: 't-1' })).toEqual(refused('Only heads, team leads and the CEO can use steer_task. Ask your manager instead.'));
    expect(await o.call('head-of-design', 'propose_plan', PLAN)).toEqual(refused('Only the CEO can use propose_plan. Ask the CEO.'));
    expect(await o.call('frontend-lead', 'approve_plan', { version: 1, cites: ['m-1'] })).toEqual(refused('Only the CEO can use approve_plan. Ask your manager to take it to the CEO.'));
    expect(await o.call('qa-engineer', 'change_settings', { maxDesks: 4, cites: ['m-1'] })).toEqual(refused('Only the CEO can use change_settings. Ask your manager to take it to the CEO.'));
    expect(steered(o)).toEqual([]);
  });

  it('tells each desk about acknowledging, deciding and citing, and the CEO about the plan', async () => {
    const o = await steeringOffice();
    expect(await o.instructions('ui-designer')).toContain('Acknowledge every message from the stakeholder and from your manager with ack');
    expect(await o.instructions('ui-designer')).not.toContain('steer_task');
    expect(await o.instructions('head-of-design')).toContain("steer_task pauses, resumes, cancels, reassigns or orders your own team's tasks.");
    expect(await o.instructions('ceo')).toContain("approve_plan and change_settings act only on the stakeholder's own message to you, which you cite.");
    expect(await (await office()).instructions('ceo')).not.toContain('ack');
  });
});

describe('ack', () => {
  it('records what the person will do with a message from their manager', async () => {
    const o = await steeringOffice();
    expect(await o.call('head-of-design', 'ack', { message: 'm-2', agree: true, text: ' Darkening the palette with Kai today. ' })).toEqual(
      ok('Acknowledged m-2; whoever follows it sees what you will do.'),
    );
    expect(steered(o)).toEqual([['ack', 'head-of-design', { message: 'm-2', agree: true, text: 'Darkening the palette with Kai today.' }]]);
  });

  it('says so when they disagree', async () => {
    const o = await steeringOffice();
    expect(await o.call('head-of-design', 'ack', { message: 'm-2', agree: false, text: 'A darker palette fails contrast on the order button.' })).toEqual(ok('Told them you disagree with m-2, and why.'));
  });

  it('needs agree, the id, and one sentence within the cap', async () => {
    const o = await steeringOffice();
    expect(await o.call('head-of-design', 'ack', { message: 'm-2', text: 'On it.' })).toEqual(refused('ack needs agree. true when you will do it; false when you disagree.'));
    expect(await o.call('head-of-design', 'ack', { message: 'm 2', agree: true, text: 'On it.' })).toEqual(refused('message must be an id like "m-12", not "m 2".'));
    const long = 'x'.repeat(DECISION_LIMITS.what + 1);
    expect(await o.call('head-of-design', 'ack', { message: 'm-2', agree: true, text: long })).toEqual(refused(tooLong('text', long.length, DECISION_LIMITS.what)));
    expect(steered(o)).toEqual([]);
  });

  it("passes the company's refusal on: a message that wasn't sent to them", async () => {
    const o = await steeringOffice();
    expect(await o.call('ui-designer', 'ack', { message: 'm-1', agree: true, text: 'On it.' })).toEqual(refused("Message m-1 wasn't sent to you, so it isn't yours to acknowledge."));
  });
});

describe('decide', () => {
  it('records a decision with why, the alternatives and each cite once', async () => {
    const o = await steeringOffice();
    const args = { what: 'Pickup times come in 15-minute slots.', why: 'The kitchen plans in quarters of an hour.', alternatives: ['Free times', '30-minute slots'], cites: ['m-2', 'm-2'] };
    expect(await o.call('ui-designer', 'decide', args)).toEqual(ok('Recorded in the decision log as d-1. The stakeholder can ask you to reconsider it.'));
    expect(steered(o)).toEqual([['recordDecision', 'ui-designer', { what: args.what, why: args.why, alternatives: args.alternatives, cites: ['m-2'] }]]);
  });

  it('holds what, why, the alternatives and the cites to their caps', async () => {
    const o = await steeringOffice();
    const base = { what: 'Slots of 15 minutes.', why: 'The kitchen plans so.' };
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, what: 'w'.repeat(DECISION_LIMITS.what + 1) }, tooLong('what', DECISION_LIMITS.what + 1, DECISION_LIMITS.what)],
      [{ what: base.what }, 'decide needs why. Why, in a sentence or two.'],
      [{ ...base, why: 'y'.repeat(DECISION_LIMITS.why + 1) }, tooLong('why', DECISION_LIMITS.why + 1, DECISION_LIMITS.why)],
      [{ ...base, alternatives: ['a', 'b', 'c', 'd', 'e'] }, `alternatives has 5 entries; the most is ${DECISION_LIMITS.alternatives}.`],
      [{ ...base, cites: Array.from({ length: 11 }, (_, i) => `m-${i + 1}`) }, 'cites has 11 entries; the most is 10.'],
    ];
    for (const [args, sentence] of cases) expect(await o.call('ui-designer', 'decide', args)).toEqual(refused(sentence));
    expect(steered(o)).toEqual([]);
  });
});

describe('steer_task', () => {
  it("pauses, resumes, cancels and reassigns a task of the caller's own people", async () => {
    const o = await steeringOffice();
    const asked = said(o, 'head-of-design', 'Pause the streak card until the palette is settled.');
    expect(await o.call('head-of-design', 'steer_task', { action: 'pause', task: 't-1', cites: [asked] })).toEqual(
      ok('Paused "Build the streak card" (t-1): Kai stops at their next step, and its turns wait until you resume it.'),
    );
    expect(await o.call('head-of-design', 'steer_task', { action: 'resume', task: 't-1' })).toEqual(ok('Resumed "Build the streak card" (t-1); it goes back in line in its place.'));
    expect(await o.call('head-of-design', 'steer_task', { action: 'cancel', task: 't-2', reason: 'The flow moved to the plan.' })).toEqual(
      ok('Cancelled "Map the pickup flow" (t-2). Its work stays on the branch worklings/cancelled/t-2.'),
    );
    expect(await o.call('head-of-design', 'steer_task', { action: 'reassign', task: 't-1', to: 'ux-designer', note: 'Kai started the layout.' })).toEqual(
      ok('"Build the streak card" (t-1) is Lea, UX designer\'s now, with your note. Kai stops working on it.'),
    );
    expect(steered(o)).toEqual([
      ['steerTask', 'head-of-design', { action: 'pause', task: 't-1', cites: [asked] }],
      ['steerTask', 'head-of-design', { action: 'resume', task: 't-1', cites: [] }],
      ['steerTask', 'head-of-design', { action: 'cancel', task: 't-2', reason: 'The flow moved to the plan.', cites: [] }],
      ['steerTask', 'head-of-design', { action: 'reassign', task: 't-1', to: 'ux-designer', note: 'Kai started the layout.', cites: [] }],
    ]);
  });

  it("orders the caller's people's tasks", async () => {
    const o = await steeringOffice();
    expect(await o.call('head-of-design', 'steer_task', { action: 'order', tasks: ['t-2', 't-1'] })).toEqual(ok('Set the order of 2 tasks; your people get them first to last.'));
    expect(steered(o)).toEqual([['steerTask', 'head-of-design', { action: 'order', tasks: ['t-2', 't-1'], cites: [] }]]);
  });

  it("refuses a task outside the caller's team, and a new owner who isn't one of their people, without asking the company", async () => {
    const o = await steeringOffice();
    expect(await o.call('head-of-engineering', 'steer_task', { action: 'pause', task: 't-1' })).toEqual(
      refused('"Build the streak card" (t-1) belongs to Kai, UI designer, who isn\'t one of your people; ask their manager to steer it.'),
    );
    expect(await o.call('head-of-design', 'steer_task', { action: 'reassign', task: 't-1', to: 'frontend-engineer', note: 'Take it.' })).toEqual(
      refused("Sam isn't one of your people; give tasks only to the people below you."),
    );
    expect(await o.call('head-of-design', 'steer_task', { action: 'pause', task: 't-9' })).toEqual(refused('There is no task t-9; tasks lists them.'));
    expect(await o.call('head-of-design', 'steer_task', { action: 'order', tasks: ['t-1', 't-3'] })).toEqual(
      refused('"Set up the build" (t-3) belongs to Sam, frontend engineer, who isn\'t one of your people; ask their manager to steer it.'),
    );
    expect(steered(o)).toEqual([]);
  });

  it("takes each action's own fields, and needs them", async () => {
    const o = await steeringOffice();
    expect(await o.call('head-of-design', 'steer_task', { action: 'pause', task: 't-1', reason: 'Why not.' })).toEqual(refused('action "pause" doesn\'t take reason; it takes task and cites.'));
    expect(await o.call('head-of-design', 'steer_task', { action: 'cancel', task: 't-1' })).toEqual(refused('action "cancel" needs reason.'));
    expect(await o.call('head-of-design', 'steer_task', { action: 'reassign', task: 't-1', to: 'ux-designer' })).toEqual(refused('action "reassign" needs note.'));
    expect(await o.call('head-of-design', 'steer_task', { action: 'order', tasks: ['t-1', 't-1'] })).toEqual(refused('tasks has t-1 twice; give each task once.'));
    expect(await o.call('head-of-design', 'steer_task', { action: 'stop', task: 't-1' })).toEqual(
      refused('action must be "pause", "resume", "cancel", "reassign", "order", "pause-room" or "resume-room", not "stop".'),
    );
    expect(steered(o)).toEqual([]);
  });

  it('pauses or resumes a whole room for its head and the CEO, and nobody else', async () => {
    const o = await steeringOffice();
    expect(await o.call('head-of-design', 'steer_task', { action: 'pause-room', room: 'design' })).toEqual(
      ok('Paused 2 open tasks in the design room; their turns wait until you resume them.'),
    );
    expect(await o.call('ceo', 'steer_task', { action: 'resume-room', room: 'design' })).toEqual(ok('Resumed 2 tasks in the design room.'));
    expect(await o.call('head-of-design', 'steer_task', { action: 'pause-room', room: 'engineering' })).toEqual(refused('A head pauses only their own room; ask its head.'));
    expect(await o.call('frontend-lead', 'steer_task', { action: 'pause-room', room: 'engineering' })).toEqual(
      refused("Only heads and the CEO pause a whole room; pause your people's tasks one at a time."),
    );
    expect(await o.call('ceo', 'steer_task', { action: 'pause-room', room: 'attic' })).toEqual(refused('Nobody works in a room with the id "attic"; org lists the rooms.'));
    expect(steered(o).map(([method, by]) => [method, by])).toEqual([
      ['steerTask', 'head-of-design'],
      ['steerTask', 'ceo'],
    ]);
  });
});

describe('propose_plan', () => {
  it("proposes the plan with its note and the stakeholder's message it answers", async () => {
    const o = await steeringOffice();
    expect(await o.call('ceo', 'propose_plan', { ...PLAN, note: 'First version.', cites: ['m-1'] })).toEqual(
      ok('Proposed version 1 of the plan: 1 milestone and 2 tasks. The stakeholder reviews it and approves it; none of its work starts before then, and what they want changed comes to you as a message.'),
    );
    expect(steered(o)).toEqual([['proposePlan', 'ceo', { ...PLAN, note: 'First version.', cites: ['m-1'] }]]);
  });

  it('takes contracts and task kinds as optional parts of the plan and hands them to the company as sent', async () => {
    const o = await steeringOffice();
    const contracts = [{ id: 'c-1', title: 'Orders API', file: 'docs/api.md', writer: 'p-1', dependents: ['p-2'] }];
    const tasks = PLAN.tasks.map((t, i) => (i === 1 ? { ...t, kind: 'integration' } : t));
    const sent = { ...PLAN, tasks, contracts };
    expect((await o.call('ceo', 'propose_plan', sent)).isError).toBe(false);
    expect(steered(o)).toEqual([['proposePlan', 'ceo', { ...sent, note: null, cites: [] }]]);
    const listed = JSON.stringify(await o.listed('ceo', 'propose_plan'));
    expect(listed).toContain('"contracts"');
    expect(listed).toContain('"verification"');
    expect(listed).toContain('"dependents"');
  });

  it("gives back the company's sentences for a plan that doesn't check out", async () => {
    const o = await steeringOffice();
    o.company.refusePlans(['tasks[1].owner: "nobody" is nobody in the company', 'tasks[1].files: web/src/order/ is also in tasks[0]']);
    expect(await o.call('ceo', 'propose_plan', PLAN)).toEqual(
      refused('- tasks[1].owner: "nobody" is nobody in the company\n- tasks[1].files: web/src/order/ is also in tasks[0]'),
    );
  });

  it('needs the goal as text and the milestones and tasks as lists, and a note within the cap', async () => {
    const o = await steeringOffice();
    expect(await o.call('ceo', 'propose_plan', { ...PLAN, milestones: 'one' })).toEqual(refused('milestones must be a list, not "one".'));
    expect(await o.call('ceo', 'propose_plan', { milestones: PLAN.milestones, tasks: PLAN.tasks })).toEqual(refused('propose_plan needs goal. What the company is building, in a sentence or two.'));
    expect(await o.call('ceo', 'propose_plan', { ...PLAN, note: 'n'.repeat(1001) })).toEqual(refused('note is 1,001 characters; the limit is 1,000: cut about 30.'));
    expect(steered(o)).toEqual([]);
  });
});

describe('approve_plan', () => {
  it("approves the latest version on the stakeholder's message to the CEO, citing it", async () => {
    const o = await steeringOffice();
    await o.call('ceo', 'propose_plan', PLAN);
    const yes = said(o, 'ceo', 'The plan is good: go ahead.');
    expect(await o.call('ceo', 'approve_plan', { version: 1, cites: [yes] })).toEqual(ok(`Approved version 1 of the plan, as the stakeholder asked in ${yes}. Its tasks go to their owners in order.`));
    expect(await o.call('ceo', 'approve_plan', { version: 1, through: 'ms-1', cites: [yes] })).toEqual(
      ok(`Approved version 1 of the plan through the milestone ms-1, as the stakeholder asked in ${yes}. Its tasks go to their owners in order.`),
    );
    expect(steered(o).slice(1)).toEqual([
      ['approvePlan', 'ceo', { version: 1, through: null, cites: [yes] }],
      ['approvePlan', 'ceo', { version: 1, through: 'ms-1', cites: [yes] }],
    ]);
  });

  it("refuses a cite that isn't the stakeholder's message to the CEO, and one older than the version", async () => {
    const o = await steeringOffice();
    await o.call('ceo', 'propose_plan', PLAN);
    expect(await o.call('ceo', 'approve_plan', { version: 1, cites: ['m-2'] })).toEqual(refused("Message m-2 isn't the stakeholder's to you, so it can't approve the plan for them."));
    const toAda = said(o, 'head-of-design', 'Approve the plan.');
    expect(await o.call('ceo', 'approve_plan', { version: 1, cites: [toAda] })).toEqual(refused(`Message ${toAda} isn't the stakeholder's to you, so it can't approve the plan for them.`));
    expect(await o.call('ceo', 'approve_plan', { version: 1, cites: ['m-1'] })).toEqual(refused('Message m-1 is older than what it would change.'));
  });

  it("needs the stakeholder's message, and the latest version", async () => {
    const o = await steeringOffice();
    await o.call('ceo', 'propose_plan', PLAN);
    expect(await o.call('ceo', 'approve_plan', { version: 1 })).toEqual(refused("approve_plan needs cites. The stakeholder's message to you that asks for this, by the id its turn gives."));
    expect(await o.call('ceo', 'approve_plan', { version: 1, cites: [] })).toEqual(refused('cites needs at least 1 entry; it has 0.'));
    const yes = said(o, 'ceo', 'Approve version 2.');
    expect(await o.call('ceo', 'approve_plan', { version: 2, cites: [yes] })).toEqual(refused("Version 2 isn't the latest: approve version 1."));
    expect(await o.call('ceo', 'approve_plan', { version: 0, cites: [yes] })).toEqual(refused('version must be a whole number from 1 to 1000000, not the number 0.'));
  });
});

describe('change_settings', () => {
  it("changes one setting on the stakeholder's message, citing it", async () => {
    const o = await steeringOffice();
    const asked = said(o, 'ceo', 'Ask me at every milestone.');
    expect(await o.call('ceo', 'change_settings', { planApproval: 'milestones', cites: [asked] })).toEqual(
      ok("Plan approval is set: the plan waits for the stakeholder's approval before work starts and at every milestone. It is in the decision log."),
    );
    expect(await o.call('ceo', 'change_settings', { idleMinutes: 10, cites: [said(o, 'ceo', 'Close idle desks after ten minutes.')] })).toEqual(
      ok('An open desk with nothing to do now closes after 10 minutes. It is in the decision log.'),
    );
    expect(steered(o)[0]).toEqual(['changeSettings', 'ceo', { planApproval: 'milestones', cites: [asked] }]);
    expect(steered(o)[1]?.[2]).toMatchObject({ idleMs: 600_000 });
  });

  it("makes someone Trusted only once the stakeholder says yes, and sets a person's or a room's leash", async () => {
    const o = await steeringOffice();
    expect(await o.call('ceo', 'change_settings', { leash: 'trusted', person: 'ui-designer', cites: [said(o, 'ceo', 'Trust Kai with routine work.')] })).toEqual(
      ok('Kai becomes Trusted once the stakeholder says yes in their inbox. It is in the decision log.'),
    );
    expect(await o.call('ceo', 'change_settings', { leash: 'check', room: 'design', cites: [said(o, 'ceo', 'Design checks with me before each task.')] })).toEqual(
      ok('The design room now waits for the stakeholder before each new task. It is in the decision log.'),
    );
    expect(await o.call('ceo', 'change_settings', { effort: 'high', person: 'qa-engineer', cites: [said(o, 'ceo', 'More effort for QA.')] })).toEqual(
      ok('The QA engineer works at high effort from their next desk. It is in the decision log.'),
    );
    expect(steered(o).map((c) => c[2])).toEqual([
      { leash: { person: 'ui-designer', leash: 'trusted' }, cites: ['m-4'] },
      { leash: { room: 'design', leash: 'check' }, cites: ['m-5'] },
      { effort: { person: 'qa-engineer', effort: 'high' }, cites: ['m-6'] },
    ]);
  });

  it('takes one change at a time, with the person or room it needs', async () => {
    const o = await steeringOffice();
    const cites = [said(o, 'ceo', 'Change it.')];
    const cases: [Record<string, unknown>, string][] = [
      [{ maxDesks: 4, planApproval: 'off', cites }, 'change_settings takes one change at a time: one of maxDesks, idleMinutes, planApproval, leash, effort, model and removeRule.'],
      [{ cites }, 'change_settings takes one change at a time: one of maxDesks, idleMinutes, planApproval, leash, effort, model and removeRule.'],
      [{ leash: 'check', cites }, 'leash needs one of person or room: whose leash it is.'],
      [{ leash: 'check', person: 'ui-designer', room: 'design', cites }, 'leash needs one of person or room: whose leash it is.'],
      [{ effort: 'high', room: 'design', cites }, 'effort needs person, and is for one person, not a room.'],
      [{ maxDesks: 4, person: 'ceo', cites }, "maxDesks is the company's: it takes no person or room."],
      [{ maxDesks: 21, cites }, 'maxDesks must be a whole number from 1 to 20, not the number 21.'],
      [{ model: 'gpt-9', person: 'ui-designer', cites }, 'model must be "inherit", "sonnet", "opus" or "haiku", not "gpt-9".'],
      [{ leash: 'check', person: 'nobody', cites }, 'Nobody in the org has the id "nobody"; org lists everyone\'s id.'],
    ];
    for (const [args, sentence] of cases) expect(await o.call('ceo', 'change_settings', args)).toEqual(refused(sentence));
    expect(steered(o)).toEqual([]);
  });

  it("refuses a cite that isn't the stakeholder's message to the CEO", async () => {
    const o = await steeringOffice();
    expect(await o.call('ceo', 'change_settings', { maxDesks: 4, cites: ['m-2'] })).toEqual(refused("Message m-2 isn't the stakeholder's to you, so it can't change a setting for them."));
    expect(await o.call('ceo', 'change_settings', { maxDesks: 4 })).toEqual(refused("change_settings needs cites. The stakeholder's message to you that asks for this, by the id its turn gives."));
  });
});

describe('message to a room, a team or everyone', () => {
  it("lets the CEO write to everyone, a room and a head's team", async () => {
    const o = await steeringOffice();
    expect(await o.call('ceo', 'message', { everyone: true, text: 'We open on Monday.' })).toEqual(
      ok('Sent to everyone: 8 people. It reaches each of them at their next step; replies come to you as messages.'),
    );
    expect(await o.call('ceo', 'message', { room: 'design', text: 'The palette goes darker.' })).toEqual(
      ok('Sent to the design room: Ada, head of design, Kai, UI designer and Lea, UX designer. It reaches each of them at their next step; replies come to you as messages.'),
    );
    expect(await o.call('ceo', 'message', { team: 'head-of-design', text: 'Thanks for the flow.' })).toEqual(
      ok("Sent to head-of-design's team: Ada, head of design, Kai, UI designer and Lea, UX designer. It reaches each of them at their next step; replies come to you as messages."),
    );
    expect(steered(o).map((c) => (c[2] as { to: unknown }).to)).toEqual([{ kind: 'everyone' }, { kind: 'room', id: 'design' }, { kind: 'team', head: 'head-of-design' }]);
    expect(steered(o)[0]).toEqual(['send', 'ceo', { to: { kind: 'everyone' }, text: 'We open on Monday.', for: [] }]);
  });

  it('lets a head write to their own room and their own team only', async () => {
    const o = await steeringOffice();
    expect((await o.call('head-of-design', 'message', { room: 'design', text: 'Review at four.' })).isError).toBe(false);
    expect((await o.call('head-of-design', 'message', { team: 'head-of-design', text: 'Review at four.' })).isError).toBe(false);
    expect(await o.call('head-of-design', 'message', { room: 'engineering', text: 'Hello.' })).toEqual(refused('A head writes to their own room; reach another room through its head.'));
    expect(await o.call('head-of-design', 'message', { team: 'head-of-engineering', text: 'Hello.' })).toEqual(refused('A head writes to their own team; reach another team through its head.'));
    expect(await o.call('head-of-design', 'message', { everyone: true, text: 'Hello.' })).toEqual(refused('Only the CEO writes to everyone. Write to your own team or room instead.'));
    expect(steered(o)).toHaveLength(2);
  });

  it('refuses a room or a team to leads and workers, more than one audience, and a team that has no head', async () => {
    const o = await steeringOffice();
    expect(await o.call('frontend-lead', 'message', { room: 'engineering', text: 'Hi.' })).toEqual(
      refused('Only the CEO and heads write to a room or a team. Write to people one at a time, or ask your manager to pass it on.'),
    );
    expect(await o.call('ceo', 'message', { to: 'head-of-design', room: 'design', text: 'Hi.' })).toEqual(refused('message takes exactly one of to, room, team or everyone: who it is for.'));
    expect(await o.call('ceo', 'message', { text: 'Hi.' })).toEqual(refused('message takes exactly one of to, room, team or everyone: who it is for.'));
    expect(await o.call('ceo', 'message', { team: 'ui-designer', text: 'Hi.' })).toEqual(refused("Kai isn't a head; a team is a head and the people below them."));
    expect(await o.call('ceo', 'message', { room: 'attic', text: 'Hi.' })).toEqual(refused('Nobody works in a room with the id "attic"; org lists the rooms.'));
    expect(steered(o)).toEqual([]);
  });

  it('still writes to one person with to', async () => {
    const o = await steeringOffice();
    expect(await o.call('ceo', 'message', { to: 'head-of-design', text: 'Ready?' })).toEqual(ok('Sent to Ada, head of design. It reaches them at their next step; a reply comes to you as a message.'));
    expect(o.company.calls.filter((c) => c.method === 'message').map((c) => c.input)).toEqual([{ to: 'head-of-design', text: 'Ready?' }]);
    expect(steered(o)).toEqual([]);
  });
});

describe('cites on report, post_status and assign', () => {
  it('passes the cites on to the company, each once', async () => {
    const o = await steeringOffice();
    await o.call('ui-designer', 'report', { outcome: 'progress', summary: 'Halfway through the card.', task: 't-1', cites: ['m-2', 'm-2'] });
    await o.call('ui-designer', 'post_status', { text: 'Darkening the palette.', cites: ['m-2'] });
    await o.call('head-of-design', 'assign', { to: 'ui-designer', title: 'Darken the palette', brief: 'As asked.', files: ['web/src/palette.ts'], doneWhen: 'Contrast passes.', cites: ['m-2'] });
    const inputs = Object.fromEntries(o.company.calls.filter((c) => ['report', 'postStatus', 'assign'].includes(c.method)).map((c) => [c.method, c.input]));
    expect(inputs.report).toEqual({ taskId: 't-1', outcome: 'progress', text: 'Halfway through the card.', cites: ['m-2'] });
    expect(inputs.postStatus).toEqual({ text: 'Darkening the palette.', taskId: null, cites: ['m-2'] });
    expect(inputs.assign).toMatchObject({ to: 'ui-designer', title: 'Darken the palette', cites: ['m-2'] });
  });

  it("takes no cites while the company doesn't serve steering", async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'report', { outcome: 'progress', summary: 'Halfway.', cites: ['m-2'] })).toEqual(refused("report doesn't take cites; it takes task, state, files, check, open, note, outcome and summary."));
    expect(await o.call('ui-designer', 'post_status', { text: 'Working.', cites: ['m-2'] })).toEqual(refused("post_status doesn't take cites; it takes text and task."));
  });
});

describe('the checklist', () => {
  const review = (owner: string): Task => ({
    id: 't-9', title: 'Final review of the whole result', brief: 'Review it.', owner, askedBy: STAKEHOLDER, files: [], doneWhen: 'Every item is judged.', status: 'working',
    outcome: null, parent: null, milestone: 'ms-1', worktree: null, commit: null, createdAt: NOW, updatedAt: NOW,
  });

  it('is part of propose_plan, sent to the company as it came, with the rule in one sentence', async () => {
    const o = await steeringOffice();
    const checklist = [{ id: 'k-1', text: 'Orders can be placed.', quote: 'order ahead', covers: ['p-1', 'p-2'] }];
    expect((await o.call('ceo', 'propose_plan', { ...PLAN, checklist })).isError).toBe(false);
    expect(steered(o)).toEqual([['proposePlan', 'ceo', { ...PLAN, checklist, note: null, cites: [] }]]);
    const listed = await o.listed('ceo', 'propose_plan');
    expect(listed.description).toContain(
      'A checklist: each thing the stakeholder asked for, as a short sentence that can be checked, quoting their words in quote where it can, with the tasks that cover it; every task covers at least one.',
    );
    expect(listed.inputSchema).toMatchObject({ properties: { checklist: { type: 'array', minItems: 1, maxItems: 20, items: { required: ['id', 'text', 'quote', 'covers'] } } } });
  });

  it('is marked by the CEO and the checker seats only; anyone else is refused before the company is asked', async () => {
    const o = await steeringOffice();
    for (const id of ['ceo', 'qa-engineer']) expect(await o.list(id)).toContain('mark_checklist');
    for (const id of ['ui-designer', 'frontend-lead', 'head-of-design']) {
      expect(await o.list(id)).not.toContain('mark_checklist');
      expect(await o.call(id, 'mark_checklist', { task: 't-9', items: [{ item: 'k-1', verdict: 'met', evidence: 'Seen.' }] })).toEqual(
        refused("Only the final review's owner, the CEO or a QA or reviewer seat, can use mark_checklist. Report what you checked instead."),
      );
    }
    expect(steered(o)).toEqual([]);
  });

  it('hands each verdict to the company with its evidence, and says what comes next', async () => {
    const o = await steeringOffice();
    o.company.taskList.push(review('qa-engineer'));
    const items = [
      { item: 'k-1', verdict: 'met', evidence: 'Orders go through.', files: ['src/orders.ts'], check: { ran: 'npm test', passed: true }, page: '/order' },
      { item: 'k-2', verdict: 'not-met', evidence: 'No pickup slots.' },
    ];
    expect(await o.call('qa-engineer', 'mark_checklist', { task: 't-9', items })).toEqual(
      ok('Marked 2 checklist items. Report the review with report once every item is marked; the office sends each item not met back to its maker.'),
    );
    expect(steered(o)).toEqual([
      [
        'markChecklist',
        'qa-engineer',
        {
          task: 't-9',
          items: [
            { item: 'k-1', verdict: 'met', evidence: 'Orders go through.', files: ['src/orders.ts'], check: { ran: 'npm test', passed: true }, page: '/order' },
            { item: 'k-2', verdict: 'not-met', evidence: 'No pickup slots.', files: [], check: null, page: null },
          ],
        },
      ],
    ]);
  });

  it('refuses a verdict, a page or a list the tool can see is wrong, naming the field', async () => {
    const o = await steeringOffice();
    const call = (items: unknown) => o.call('ceo', 'mark_checklist', { task: 't-9', items });
    expect(await call([{ item: 'k-1', verdict: 'pass', evidence: 'Seen.' }])).toEqual(refused('items[0].verdict must be "met", "partly" or "not-met", not "pass".'));
    expect(await call([{ item: 'k-1', verdict: 'met', evidence: 'Seen.', page: 'https://example.com' }])).toEqual(refused('items[0].page must be a path on the preview, like "/menu", not "https://example.com".'));
    // A path that starts with two slashes is another site to a browser.
    expect(await call([{ item: 'k-1', verdict: 'met', evidence: 'Seen.', page: '//attacker.example/x' }])).toEqual(refused('items[0].page must be a path on the preview, like "/menu", not "//attacker.example/x".'));
    expect(await call([])).toEqual(refused('items needs at least 1 entry; it has 0.'));
    expect(steered(o)).toEqual([]);
  });
});
