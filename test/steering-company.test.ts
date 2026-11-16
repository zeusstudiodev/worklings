// Steering through the company (src/company/company.ts with the kit's switchboard, org and git): the plan and its gate,
// the task board, the leash and settings, the decision log with undo and reconsider, and a restart in the middle of a
// plan. What reaches each person is read from the turns the switchboard was handed.
import { DEFAULT_PRESET, PRESETS } from '../src/core/presets.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Company } from '../src/company/index.ts';
import { OrgRefusal, type Question, STAKEHOLDER, type Task, THE_OFFICE, UNDO_MS } from '../src/core/company.ts';
import type { PlanApproval } from '../src/core/steering.ts';
import { crashCopy, fenced, rig, type Rig, type Turn } from './company-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

/** The desks at once a new company starts with: its preset's (Balanced). */
const DESKS = PRESETS[DEFAULT_PRESET].desks;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Lets what a change brings due run: steering settles after every change, before anyone hears of it. */
const settled = () => vi.advanceTimersByTimeAsync(0);

/** The café's plan for the kit's org: two milestones, the slot picker after the menu data. */
const PLAN = {
  goal: 'A bilingual café website with pickup orders.',
  milestones: [
    { id: 'ms-1', title: 'Menu pages live', doneWhen: 'The menu reads well on a phone.' },
    { id: 'ms-2', title: 'Pickup orders work', doneWhen: 'A guest orders, pays and picks up.' },
  ],
  tasks: [
    { id: 'p-1', title: 'Menu data', owner: 'frontend-engineer', files: ['src/menu'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' },
    { id: 'p-2', title: 'Menu look', owner: 'ui-designer', files: ['src/styles'], milestone: 'ms-1', after: [], brief: 'The menu in the chalk style.', doneWhen: 'It matches the design.', check: 'npm test' },
    { id: 'p-3', title: 'Slot picker', owner: 'frontend-engineer', files: ['src/slots'], milestone: 'ms-2', after: ['p-1'], brief: 'Pick a pickup slot.', doneWhen: 'A slot is saved.', check: 'npm test' },
    { id: 'p-4', title: 'Pickup flow', owner: 'ux-designer', files: ['docs/flow.md'], milestone: 'ms-2', after: [], brief: 'Map the pickup.', doneWhen: 'Reviewed.', check: 'npm test' },
  ],
  note: null,
  cites: [] as string[],
};

async function company(planApproval: PlanApproval = 'before-work'): Promise<Rig> {
  return rig({ running: true, planApproval });
}

function propose(c: Company, plan: unknown = PLAN): number {
  const result = c.proposePlan('ceo', withChecklist(plan));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.version.version;
}

const taskOf = (c: Company, planTask: string): Task => {
  const t = c.view().tasks.find((x) => x.planTask === planTask && x.status !== 'dropped');
  if (!t) throw new Error(`No task for ${planTask}.`);
  return t;
};

/** The turns a person was handed, as the words after the fence. */
const turnsTo = (r: Rig, person: string): Turn[] => r.desks().turns.filter((t) => t.plan.person.id === person);
const words = (t: Turn) => fenced(t).words;
const assignmentOf = (r: Rig, task: Task): Turn | undefined => r.desks().turns.find((t) => t.turn.messageId !== null && words(t).startsWith(`New task ${task.id}`));

/** The owner reports it done and the manager who asked accepts it. */
async function finish(r: Rig, task: Task): Promise<void> {
  r.company.report(task.owner, { taskId: task.id, outcome: 'done', text: `${task.title} is done.`, form: { files: [], open: [], check: { ran: 'npm test', passed: true } } });
  // A clean done with other work still open is accepted by the office; the rest waits for its manager.
  if (r.company.view().tasks.find((t) => t.id === task.id)?.status === 'review') r.company.review(task.askedBy, { taskId: task.id, verdict: 'accept', note: '' });
  await r.company.idle();
  await settled();
}

const refusal = (run: () => unknown): OrgRefusal => {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('It was expected to be refused, and it went through.');
};

describe('the plan before work starts', () => {
  it('starts nothing before Approve, counts the plan in the inbox and keeps assign for later', async () => {
    const r = await company();
    expect(words(r.desks().turns.find((t) => t.plan.person.id === 'ceo' && words(t).includes('started the company')) ?? r.desks().turns[0] ?? ({} as Turn))).toContain('First propose the plan with propose_plan');
    propose(r.company);
    const view = r.company.view();
    expect(view.steering?.plan?.versions.map((v) => v.version)).toEqual([1]);
    expect(view.inbox).toBe(1);
    expect(view.tasks).toEqual([]);
    expect(turnsTo(r, 'frontend-engineer')).toEqual([]);
    expect(refusal(() => r.company.assign('ceo', { to: 'head-of-design', title: 'Menu look', brief: 'The chalk style.', files: [], doneWhen: 'It matches.', parent: null, milestone: null, worktree: false })).message).toMatch(
      /^Work starts from the plan here: propose it with propose_plan/,
    );
    expect(refusal(() => r.company.setGoal('ceo', { text: 'A café site.', milestones: [] })).code).toBe('not-allowed');
  });

  it('makes the tasks on Approve and hands out those whose turn came, in priority order', async () => {
    const r = await company();
    propose(r.company);
    r.desks().turns.length = 0;
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    const tasks = r.company.view().tasks;
    expect(tasks.map((t) => [t.planTask, t.priority, t.status, t.askedBy])).toEqual([
      ['p-1', 1, 'queued', 'frontend-lead'],
      ['p-2', 2, 'queued', 'head-of-design'],
      ['p-3', 3, 'queued', 'frontend-lead'],
      ['p-4', 4, 'queued', 'head-of-design'],
    ]);
    const handed = r.desks().turns.filter((t) => words(t).startsWith('New task'));
    expect(handed.map((t) => [t.plan.person.id, t.turn.priority])).toEqual([
      ['frontend-engineer', 1],
      ['ui-designer', 2],
      ['ux-designer', 4],
    ]);
    expect(r.company.view().inbox).toBe(0);
    expect(r.company.view().goal?.milestones.map((m) => m.id)).toEqual(['ms-1', 'ms-2']);
    // The notice asks nothing of the CEO, so it waits for the CEO's next turn instead of opening one.
    expect(turnsTo(r, 'ceo').map(words).some((w) => w.startsWith('Robin approved version 1'))).toBe(false);
    r.company.say('ceo', 'What is first?');
    expect(turnsTo(r, 'ceo').at(-1)?.turn.text).toMatch(/Since your last turn[^]*- Robin approved version 1 of the plan\./);
    expect(r.company.view().steering?.decisions.at(-1)).toMatchObject({ kind: 'plan', by: STAKEHOLDER, what: 'You approved version 1 of the plan.' });
  });

  it('hands out a task once what it waits for is done', async () => {
    const r = await company();
    propose(r.company);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    r.desks().deliverAll();
    const slots = taskOf(r.company, 'p-3');
    expect(assignmentOf(r, slots)).toBeUndefined();
    await finish(r, taskOf(r.company, 'p-1'));
    expect(assignmentOf(r, slots)?.plan.person.id).toBe('frontend-engineer');
  });

  it('lets a head split an approved task inside its files, and nothing else', async () => {
    const r = await company();
    propose(r.company, { ...PLAN, tasks: PLAN.tasks.map((t) => (t.id === 'p-2' ? { ...t, owner: 'head-of-design' } : t)) });
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    const look = taskOf(r.company, 'p-2');
    const part = r.company.assign('head-of-design', { to: 'ui-designer', title: 'Buttons', brief: 'Chalk buttons.', files: ['src/styles/buttons.css'], doneWhen: 'They match.', parent: look.id, milestone: null, worktree: false });
    expect(part).toMatchObject({ parent: look.id, priority: look.priority });
    expect(refusal(() => r.company.assign('head-of-design', { to: 'ui-designer', title: 'Logo', brief: 'A logo.', files: ['public/logo.svg'], doneWhen: 'Done.', parent: look.id, milestone: null, worktree: false })).message).toMatch(
      /isn't inside the files of task/,
    );
  });
});

describe('at every milestone', () => {
  it('holds the next milestone once the approved one is done, until it is approved', async () => {
    const r = await company('milestones');
    propose(r.company);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: 'ms-1', cites: [] });
    expect(r.company.view().tasks.map((t) => t.planTask)).toEqual(['p-1', 'p-2']);
    r.desks().deliverAll();
    await finish(r, taskOf(r.company, 'p-1'));
    expect(r.company.view().steering?.plan?.waiting).toBeNull();
    await finish(r, taskOf(r.company, 'p-2'));
    const held = r.company.view();
    expect(held.steering?.plan?.waiting).toMatchObject({ milestone: 'ms-1', report: null });
    expect(held.inbox).toBe(1);
    expect(turnsTo(r, 'ceo').map(words).at(-1)).toMatch(/^“Menu pages live” is done/);
    const report = r.company.report('ceo', { taskId: null, outcome: 'progress', text: 'Menu pages are live; pickup orders are next.' });
    expect(r.company.view().steering?.plan?.waiting?.report).toBe(report.id);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: 'ms-2', cites: [] });
    const next = r.company.view();
    expect(next.steering?.plan?.waiting).toBeNull();
    expect(next.tasks.map((t) => t.planTask)).toEqual(['p-1', 'p-2', 'p-3', 'p-4']);
    expect(assignmentOf(r, taskOf(r.company, 'p-3'))?.plan.person.id).toBe('frontend-engineer');
  });
});

describe('versions', () => {
  it("keeps the stakeholder's edit and the CEO's revision as versions, and approves only the latest", async () => {
    const r = await company();
    propose(r.company);
    const edit = r.company.editPlan(STAKEHOLDER, { plan: { ...PLAN, tasks: PLAN.tasks.filter((t) => t.id !== 'p-4') }, note: 'The flow waits for the launch.' });
    expect(edit).toMatchObject({ ok: true, version: { version: 2, by: STAKEHOLDER } });
    expect(turnsTo(r, 'ceo').map(words).at(-1)).toMatch(/^Robin edited the plan: version 2\. Cut “Pickup flow”\./);
    r.desks().deliverAll();
    const ask = r.company.say('ceo', 'Revise it: bring the pickup flow back.', { typed: true });
    vi.advanceTimersByTime(60_000);
    const revised = r.company.proposePlan('ceo', withChecklist({ ...PLAN, note: 'The flow is back.', cites: [ask.id] }));
    expect(revised).toMatchObject({ ok: true, version: { version: 3, by: 'ceo', cites: [ask.id] } });
    expect(r.company.view().steering?.plan?.versions.map((v) => [v.version, v.by])).toEqual([[1, 'ceo'], [2, STAKEHOLDER], [3, 'ceo']]);
    expect(refusal(() => r.company.approvePlan(STAKEHOLDER, { version: 2, through: null, cites: [] })).code).toBe('conflict');
    expect(r.company.approvePlan(STAKEHOLDER, { version: 3, through: null, cites: [] }).version).toBe(3);
  });

  it("makes a task wait for the owner of a file its brief names outside its own files, with a note, and refuses nothing", async () => {
    const r = await company();
    const withBrief = (brief: string, files = ['src/slots'], after: string[] = []) => ({ ...PLAN, tasks: PLAN.tasks.map((t) => (t.id === 'p-3' ? { ...t, brief, files, after } : t)) });
    const waits = (result: ReturnType<Company['proposePlan']>): string[] | undefined => (result.ok ? result.version.plan.tasks.find((t) => t.id === 'p-3')?.after : undefined);
    const read = r.company.proposePlan('ceo', withChecklist(withBrief('Pick a pickup slot, finishing src/menu/index.ts on the way.')));
    expect(read).toMatchObject({ ok: true, notes: ['A brief reads a file another task owns, so the office made p-3 wait for p-1.'] });
    expect(waits(read)).toEqual(['p-1']);
    // A file nobody owns, a URL or a name in passing changes nothing, and one in its own files goes through as it was.
    expect(waits(r.company.proposePlan('ceo', withChecklist(withBrief('Follow SPEC.md, Node.js 22 and https://example.com/src/menu/a.ts.'))))).toEqual([]);
    const own = r.company.proposePlan('ceo', withChecklist(withBrief('Pick a slot, finishing src/menu/index.ts.', ['src/slots', 'src/menu/index.ts'], ['p-1'])));
    expect(own).toMatchObject({ ok: true });
    expect(own.ok && own.notes).toBeFalsy();
  });
});

describe('the task board', () => {
  async function working(): Promise<Rig> {
    const r = await company();
    propose(r.company);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    r.desks().deliverAll();
    await settled();
    return r;
  }

  it('pauses a task with "stop and wait" for an owner at work, holds it, and resumes it', async () => {
    const r = await working();
    const menu = taskOf(r.company, 'p-1');
    r.desks().views = [{ person: 'frontend-engineer', state: 'working', sessionId: null, since: 0, context: null, problem: null, queue: null }];
    const [paused] = r.company.steerTask(STAKEHOLDER, { action: 'pause', task: menu.id, cites: [] });
    expect(paused?.paused).toMatchObject({ by: STAKEHOLDER });
    const stop = r.desks().stops.at(-1);
    expect(stop?.plan.person.id).toBe('frontend-engineer');
    expect(stop && words(stop)).toBe(`Robin paused task ${menu.id}, “Menu data”. Stop work on it now and wait: you'll hear when it resumes.`);
    r.company.steerTask(STAKEHOLDER, { action: 'resume', task: menu.id, cites: [] });
    expect(words(turnsTo(r, 'frontend-engineer').at(-1) ?? ({} as Turn))).toBe(`Robin resumed task ${menu.id}, “Menu data”: carry on where you stopped.`);
  });

  it("holds a task's turn that hasn't gone out while it is paused", async () => {
    const r = await company();
    propose(r.company);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    const look = taskOf(r.company, 'p-2');
    const turn = assignmentOf(r, look)?.turn.messageId ?? '';
    r.company.steerTask(STAKEHOLDER, { action: 'pause', task: look.id, cites: [] });
    expect(r.desks().withdrawn).toContain(turn);
    const before = r.desks().turns.length;
    r.company.steerTask(STAKEHOLDER, { action: 'resume', task: look.id, cites: [] });
    expect(r.desks().turns.slice(before).map((t) => t.turn.messageId)).toEqual([turn]);
  });

  it("pauses and resumes a room's open tasks", async () => {
    const r = await working();
    const paused = r.company.steerTask(STAKEHOLDER, { action: 'pause-room', room: 'design', cites: [] });
    expect(paused.map((t) => [t.planTask, Boolean(t.paused)])).toEqual([['p-2', true], ['p-4', true]]);
    expect(taskOf(r.company, 'p-1').paused ?? null).toBeNull();
    const resumed = r.company.steerTask(STAKEHOLDER, { action: 'resume-room', room: 'design', cites: [] });
    expect(resumed.every((t) => t.paused === null)).toBe(true);
  });

  it('cancels a task with a reason, stops its owner and saves the work once they heard', async () => {
    const r = await working();
    const menu = taskOf(r.company, 'p-1');
    const [cancelled] = r.company.steerTask(STAKEHOLDER, { action: 'cancel', task: menu.id, reason: 'The café sends its own menu.', cites: [] });
    expect(cancelled).toMatchObject({ status: 'dropped', cancel: { reason: 'The café sends its own menu.', branch: null } });
    await settled();
    expect(r.git.calls.some((c) => c[0] === 'saveTaskWork')).toBe(false);
    r.desks().deliverAll();
    await settled();
    await r.company.idle();
    expect(r.git.calls.find((c) => c[0] === 'saveTaskWork')).toEqual(['saveTaskWork', r.root, menu.id, 'src/menu', expect.stringMatching(/^Unfinished: Menu data/)]);
    expect(r.company.view().tasks.find((t) => t.id === menu.id)?.cancel?.branch).toBe(`worklings/${r.company.id}--${menu.id}`);
    // The slot picker waited for the menu data; a cancel counts as over, so it starts.
    expect(assignmentOf(r, taskOf(r.company, 'p-3'))).toBeDefined();
  });

  it('reassigns a task with a handover note: the old owner stops, the new one gets the brief and the note', async () => {
    const r = await working();
    const flow = taskOf(r.company, 'p-4');
    r.company.postStatus('ux-designer', 'Sketching the pickup steps.', flow.id);
    const [moved] = r.company.steerTask(STAKEHOLDER, { action: 'reassign', task: flow.id, to: 'ui-designer', note: 'Kai knows the counter.', cites: [] });
    expect(moved).toMatchObject({ owner: 'ui-designer', handovers: [{ from: 'ux-designer', to: 'ui-designer', note: 'Kai knows the counter.' }] });
    const brief = words(turnsTo(r, 'ui-designer').at(-1) ?? ({} as Turn));
    expect(brief).toContain(`Task ${flow.id}, “Pickup flow”, is yours now: Robin moved it to you from Lea.`);
    expect(brief).toContain("Robin's note: Kai knows the counter.");
    expect(brief).toContain('What Lea did so far:\n- Started Pickup flow.\n- Sketching the pickup steps.');
    expect(words(turnsTo(r, 'ux-designer').at(-1) ?? ({} as Turn))).toMatch(/^Robin moved task .*, to Kai: “Kai knows the counter\.”\. Stop work on it now/);
  });

  it("creates the stakeholder's own task, which reaches its owner and is told to their head", async () => {
    const r = await working();
    const t = r.company.createTask(STAKEHOLDER, { title: 'Fix the footer', brief: 'The footer overlaps on phones.', files: ['src/Footer.tsx'], owner: 'ui-designer', doneWhen: 'It fits at 375 px.', milestone: null, cites: [] });
    expect(t).toMatchObject({ askedBy: STAKEHOLDER, priority: 5 });
    const turn = assignmentOf(r, t);
    expect(turn && fenced(turn)).toMatchObject({ who: 'From the office', id: turn?.turn.messageId });
    expect(turn?.turn.priority).toBe(5);
    expect(words(turnsTo(r, 'head-of-design').at(-1) ?? ({} as Turn))).toMatch(/^Robin gave Kai a task of their own/);
  });

  it('sets the order work is handed out in', async () => {
    const r = await working();
    const ids = ['p-4', 'p-1', 'p-2', 'p-3'].map((p) => taskOf(r.company, p).id);
    const ordered = r.company.steerTask(STAKEHOLDER, { action: 'order', tasks: ids, cites: [] });
    expect(ordered.map((t) => t.planTask)).toEqual(['p-4', 'p-1', 'p-2', 'p-3']);
    expect(r.company.view().steering?.decisions.at(-1)?.what).toBe('You moved “Pickup flow” to the top of the board.');
  });
});

describe('the leash', () => {
  it('holds each new task of someone who checks first, until the stakeholder says start', async () => {
    const r = await company('off');
    r.company.changeSettings(STAKEHOLDER, { leash: { person: 'ux-designer', leash: 'check' }, cites: [] });
    const t = r.company.assign('head-of-design', { to: 'ux-designer', title: 'Pickup flow', brief: 'Map it.', files: ['docs/flow.md'], doneWhen: 'Reviewed.', parent: null, milestone: null, worktree: false });
    expect(assignmentOf(r, t)).toBeUndefined();
    const q = r.company.view().questions.find((x) => x.gate?.task === t.id);
    expect(q).toMatchObject({ from: THE_OFFICE, text: `Lea would like to start “Pickup flow”. Start it, or hold it until you resume it?`, options: ['Start it', 'Not now'] });
    expect(r.company.view().inbox).toBe(1);
    r.company.answer(q?.id ?? '', { option: 0, text: '' });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(assignmentOf(r, t)?.plan.person.id).toBe('ux-designer');
    expect(r.company.view().steering?.decisions.at(-1)).toMatchObject({ kind: 'answer', what: 'You let Lea start “Pickup flow”.' });
  });

  it('gives each desk its effort and leash', async () => {
    const r = await company('off');
    r.company.changeSettings(STAKEHOLDER, { effort: { person: 'ui-designer', effort: 'high' }, cites: [] });
    r.company.changeSettings(STAKEHOLDER, { leash: { room: 'design', leash: 'trusted' }, cites: [] });
    r.company.say('ui-designer', 'Darker buttons, please.');
    const plan = turnsTo(r, 'ui-designer').at(-1)?.plan;
    expect([plan?.effort, plan?.leash]).toEqual(['high', 'trusted']);
    expect(plan?.systemPrompt).toContain('Acknowledge every message from Robin');
  });

  it('waits for the inbox before the CEO makes someone Trusted by talking', async () => {
    const r = await company('off');
    const word = r.company.say('ceo', 'Make Kai Trusted.', { typed: true });
    vi.advanceTimersByTime(1_000);
    r.company.changeSettings('ceo', { leash: { person: 'ui-designer', leash: 'trusted' }, cites: [word.id] });
    expect(r.company.view().steering?.people['ui-designer']?.leash).toBe('default');
    const q = r.company.view().questions.at(-1) as Question;
    expect(q).toMatchObject({ from: 'ceo', options: ['Make Kai Trusted', 'Keep the leash as it is'] });
    r.company.answer(q.id, { option: 0, text: '' });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(r.company.view().steering?.people['ui-designer']).toMatchObject({ leash: 'trusted', leashFrom: 'person' });
    expect(r.company.view().steering?.decisions.find((d) => d.kind === 'leash')).toMatchObject({ by: 'ceo', what: 'The CEO made Kai Trusted, as you asked.', links: { message: word.id, question: q.id } });
  });

  it("changes a setting on the stakeholder's cited word, and refuses one without it", async () => {
    const r = await company('off');
    expect(refusal(() => r.company.changeSettings('ceo', { maxDesks: 4, cites: [] })).code).toBe('not-allowed');
    const word = r.company.say('ceo', 'Only four people at once.', { typed: true });
    vi.advanceTimersByTime(1_000);
    r.company.changeSettings('ceo', { maxDesks: 4, cites: [word.id] });
    expect(r.company.view().settings.maxDesks).toBe(4);
    expect(r.desks().maxDesks).toBe(4);
    expect(r.company.view().log.at(-1)?.text).toBe('The CEO set the desks at once to 4.');
    vi.advanceTimersByTime(1_000);
    expect(refusal(() => r.company.changeSettings('ceo', { maxDesks: 6, cites: [word.id] })).message).toMatch(/is older than the last change to the desks at once/);
    r.company.updateSettings({ maxDesks: 6 });
    expect(r.company.view().steering?.decisions.at(-1)?.what).toBe('You set 6 desks at once.');
  });

  it('sets the idle time and a model, which reach the switchboard and the agent file', async () => {
    const r = await company('off');
    r.company.changeSettings(STAKEHOLDER, { idleMs: 600_000, model: { person: 'ui-designer', model: 'opus' }, cites: [] });
    expect(r.desks().idleTimes.at(-1)).toBe(600_000);
    expect(r.org.calls).toContain('model:ui-designer:opus');
    expect(r.company.view().people.find((p) => p.id === 'ui-designer')?.model).toBe('opus');
  });
});

describe('the decision log', () => {
  it('records a decision from every source', async () => {
    const r = await company();
    propose(r.company);
    r.company.editPlan(STAKEHOLDER, { plan: { ...PLAN, goal: 'Pickup orders first.' }, note: null });
    r.company.approvePlan(STAKEHOLDER, { version: 2, through: null, cites: [] });
    r.desks().deliverAll();
    r.company.changeSettings(STAKEHOLDER, { maxDesks: 6, leash: { person: 'ux-designer', leash: 'check' }, cites: [] });
    r.company.steerTask(STAKEHOLDER, { action: 'pause', task: taskOf(r.company, 'p-2').id, cites: [] });
    r.company.createTask(STAKEHOLDER, { title: 'Fix the footer', brief: 'It overlaps.', files: ['src/Footer.tsx'], owner: 'ui-designer', doneWhen: 'It fits.', milestone: null, cites: [] });
    r.company.recordDecision('frontend-engineer', { what: 'The menu is one JSON file.', why: 'One source for both languages.', alternatives: ['A CMS'], cites: [] });
    r.company.hire(STAKEHOLDER, { role: 'qa-engineer', room: 'engineering', reportsTo: 'head-of-engineering', name: 'Tom', title: 'QA engineer' });
    r.company.changeOffice(STAKEHOLDER, { change: 'theme', theme: 'garden' });
    const q = r.company.askStakeholder('ceo', { text: 'Which brown?', options: ['Espresso', 'Walnut'], recommended: 0, taskId: null });
    r.company.answer(q.id, { option: 0, text: '' });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    const kinds = new Set(r.company.view().steering?.decisions.map((d) => d.kind));
    expect([...kinds].sort()).toEqual(['answer', 'decide', 'leash', 'office', 'org', 'plan', 'setting', 'task']);
  });

  it('records approvals and Always allow rules, which Undo takes back', async () => {
    const r = await company('off');
    const asked = r.company.requestApproval('ui-designer', {
      tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push', kind: 'push', expiresAt: Date.now() + 600_000, alwaysRule: { rule: 'Bash(git push:*)', sentence: 'Pushes from this company.' },
    });
    const a = r.company.view().approvals.at(-1);
    r.company.decide(a?.id ?? '', { decision: 'allow', always: true, note: null });
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await asked;
    const rule = r.company.view().steering?.decisions.at(-1);
    expect(rule).toMatchObject({ kind: 'rule', what: 'You always allowed Kai to push the work branch to GitHub: Bash(git push:*).', reversible: true });
    r.company.undoDecision(STAKEHOLDER, rule?.id ?? '');
    expect(r.company.view().settings.alwaysAllow).toEqual([]);
  });

  it('undoes an org change, an office change, a setting and a cancel, each as a decision of its own', async () => {
    const r = await company();
    propose(r.company);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    r.desks().deliverAll();
    r.company.hire(STAKEHOLDER, { role: 'qa-engineer', room: 'engineering', reportsTo: 'head-of-engineering', name: 'Tom', title: 'QA engineer' });
    const hire = r.company.view().steering?.decisions.at(-1);
    r.company.undoDecision(STAKEHOLDER, hire?.id ?? '');
    expect(r.company.people().some((p) => p.id === 'qa-engineer')).toBe(false);
    r.company.changeOffice(STAKEHOLDER, { change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games' } });
    r.company.undoDecision(STAKEHOLDER, r.company.view().steering?.decisions.at(-1)?.id ?? '');
    expect(r.org.calls.at(-1)).toBe('office:remove-room');
    r.company.changeSettings(STAKEHOLDER, { maxDesks: 3, cites: [] });
    r.company.undoDecision(STAKEHOLDER, r.company.view().steering?.decisions.at(-1)?.id ?? '');
    expect(r.company.view().settings.maxDesks).toBe(DESKS);
    const menu = taskOf(r.company, 'p-1');
    r.company.steerTask(STAKEHOLDER, { action: 'cancel', task: menu.id, reason: 'Not now.', cites: [] });
    const undo = r.company.undoDecision(STAKEHOLDER, r.company.view().steering?.decisions.at(-1)?.id ?? '');
    expect(r.company.view().tasks.find((t) => t.id === menu.id)).toMatchObject({ status: 'queued', cancel: null });
    expect(undo.kind).toBe('undo');
    expect(r.company.view().steering?.decisions.filter((d) => d.kind === 'undo')).toHaveLength(4);
  });

  it('sends a decision back to whoever made it with Reconsider', async () => {
    const r = await company('off');
    const d = r.company.recordDecision('frontend-lead', { what: 'Checkout is two steps.', why: 'It keeps the cart safe.', alternatives: [], cites: [] });
    const m = r.company.reconsider(STAKEHOLDER, { decision: d.id, note: 'One page would be quicker on a phone.' });
    expect(words(turnsTo(r, 'frontend-lead').at(-1) ?? ({} as Turn))).toBe(`Please reconsider your decision ${d.id}: “Checkout is two steps”\nOne page would be quicker on a phone.`);
    expect(r.company.view().steering?.decisions.find((x) => x.id === d.id)?.reconsider).toMatchObject({ message: m.id });
  });
});

describe('a restart in the middle of a plan', () => {
  it('picks the plan up where it stopped: versions, approval, the board and the next turn', async () => {
    const r = await company();
    propose(r.company);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    r.desks().deliverAll();
    const menu = taskOf(r.company, 'p-1');
    r.company.report(menu.owner, { taskId: menu.id, outcome: 'done', text: 'Menu data is in.', form: { files: [], open: [], check: { ran: 'npm test', passed: true } } });
    // The office accepts a clean done itself, as the manager's review would have.
    // A crash right after the review: the copy holds the log as it was then.
    const copy = crashCopy(r.root);
    await r.company.close();
    const again = r.reopen(copy);
    try {
      await again.idle();
      await settled();
      const view = again.view();
      expect(view.steering?.plan?.versions.map((v) => v.version)).toEqual([1]);
      expect(view.steering?.plan?.approved).toMatchObject({ version: 1, through: null });
      expect(view.steering?.settings.planApproval).toBe('before-work');
      const slots = view.tasks.find((t) => t.planTask === 'p-3');
      expect(slots).toMatchObject({ status: 'queued', priority: 3 });
      const board = r.boards.at(-1);
      expect(board?.turns.some((t) => words(t).startsWith(`New task ${slots?.id}`))).toBe(true);
    } finally {
      await again.close();
    }
  });

  it('runs a save the restart cut off', async () => {
    const r = await company();
    propose(r.company);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    r.desks().deliverAll();
    const menu = taskOf(r.company, 'p-1');
    r.company.steerTask(STAKEHOLDER, { action: 'cancel', task: menu.id, reason: 'Not now.', cites: [] });
    const copy = crashCopy(r.root);
    await r.company.close();
    const calls = r.git.calls.length;
    const again = r.reopen(copy);
    try {
      await again.idle();
      await settled();
      await again.idle();
      expect(r.git.calls.slice(calls).some((c) => c[0] === 'saveTaskWork' && c[2] === menu.id)).toBe(true);
      expect(again.view().tasks.find((t) => t.id === menu.id)?.cancel?.branch).toBe(`worklings/${again.id}--${menu.id}`);
    } finally {
      await again.close();
    }
  });
});
