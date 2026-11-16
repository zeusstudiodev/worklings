import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { approveChoices, doneMilestones } from '../web/src/company/plan/planModel.ts';
import {
  browse,
  callOf,
  doneLine,
  findCommands,
  findOptions,
  isMacLike,
  isPaletteKey,
  keepRecent,
  type KeyPress,
  madeByCall,
  matchScore,
  type PaletteCall,
  type PaletteCommand,
  paletteCommands,
  readRecents,
  recentsKey,
  resultsLine,
  runWord,
  shortcutLabel,
  stepValue,
  talkChips,
} from '../web/src/company/palette/paletteModel.ts';
import { inverseOf, resultOf } from '../web/src/company/palette/run.ts';
import type { ReshapeAction } from '../src/core/snapshot.ts';
import { decision, planVersion, steered } from './panels-steering-kit.ts';
import { company, desk, message, NOW, studio, task, update } from './panels-work-kit.ts';

const snap = { studio };

/** The café at work: Kai working on the slot picker, Mina's palette task paused, a plan waiting, a decision to undo. */
function cafe() {
  const view = steered(
    {
      tasks: [
        task('t-11', 'frontend-engineer', 'Pickup slot picker', { status: 'working' }),
        task('t-24', 'ui-designer', 'Darker palette across the site', { paused: { at: NOW, by: STAKEHOLDER } }),
        task('t-1', 'ui-designer', 'Menu page layout', { status: 'done' }),
      ],
      messages: [message('m-5', STAKEHOLDER, 'ceo', 'Make the palette darker.')],
    },
    {
      plan: {
        versions: [planVersion(3, 'ceo', { plan: { goal: 'Pickup orders', milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'x' }, { id: 'ms-2', title: 'Pickup orders work', doneWhen: 'y' }], tasks: [] } })],
        approved: null,
        comments: [],
        waiting: null,
      },
      settings: { planApproval: 'milestones', leash: { people: {}, rooms: {} }, effort: {} },
      decisions: [decision('d-1', STAKEHOLDER, 'leash', 'You made Mina check with you before each task.', { reversible: true })],
    },
  );
  return update(view, 'frontend-engineer', { desk: desk('working') });
}

const ids = (commands: readonly PaletteCommand[]) => commands.map((c) => c.id);

describe('what the palette reaches', () => {
  it('reaches every action with steering: message, stop, pause, the plan, tasks, the leash, decisions and every view', () => {
    const all = ids(paletteCommands(snap, cafe(), { steering: true }));
    expect(all).toEqual(
      expect.arrayContaining([
        'message:everyone',
        'message:room:design',
        'message:team:head-of-design',
        'message:person:frontend-engineer',
        'stop:frontend-engineer',
        'pause-company',
        'pause-room:engineering',
        'resume-room:design',
        'approve-plan:through:ms-1',
        'approve-plan',
        'open:plan',
        'create-task',
        'pause-task:t-11',
        'resume-task:t-24',
        'cancel-task:t-11',
        'reassign-task:t-24',
        'leash:ui-designer',
        'model:ui-designer',
        'effort:ui-designer',
        'room-leash:design',
        'undo-last',
        'open:decision:d-1',
        'open:decisions',
        'open:org',
        'open:tasks',
        'open:dashboards',
        'open:person:ceo',
        'open:task:t-1',
        'open:trace:m-5',
        'open:settings',
      ]),
    );
    // Done tasks can't be steered; someone not at work can't be stopped.
    expect(all).not.toContain('pause-task:t-1');
    expect(all).not.toContain('stop:ui-designer');
    // The views of stage and dock: no tabs to open, and the talk bar is where every message is written.
    for (const gone of ['open:now', 'open:people', 'open:send']) expect(all).not.toContain(gone);
  });

  it('takes a pause or a resume back with the opposite call, and nothing else that way', () => {
    expect(inverseOf({ on: 'steer', method: 'pauseTask', args: ['t-11'] })).toEqual({ on: 'steer', method: 'resumeTask', args: ['t-11'] });
    expect(inverseOf({ on: 'steer', method: 'resumeRoom', args: ['design'] })).toEqual({ on: 'steer', method: 'pauseRoom', args: ['design'] });
    expect(inverseOf({ on: 'actions', method: 'pause', args: [] })).toEqual({ on: 'actions', method: 'resume', args: [] });
    expect(inverseOf({ on: 'steer', method: 'cancelTask', args: ['t-11', 'why'] })).toBeNull();
    expect(inverseOf({ on: 'navigate', path: 'org' })).toBeNull();
  });

  it('takes a hire, a fire, a rehire and a move back through the opposite reshape', () => {
    const reshape = (action: ReshapeAction): PaletteCall => ({ on: 'actions', method: 'reshape', args: [action] });
    const before = company();
    const kai = before.people.find((p) => p.level !== 'ceo')!;
    expect(inverseOf(reshape({ action: 'fire', role: kai.id }))).toEqual(reshape({ action: 'rehire', role: kai.id }));
    expect(inverseOf(reshape({ action: 'rehire', role: kai.id }))).toEqual(reshape({ action: 'fire', role: kai.id }));
    // A hire from the library is taken back by firing the role.
    expect(inverseOf(reshape({ action: 'hire', role: 'ui-designer', department: 'design' }))).toEqual(reshape({ action: 'fire', role: 'ui-designer' }));
    // A move goes back to the room the person left, known only from the company before it.
    expect(inverseOf(reshape({ action: 'move', role: kai.id, department: 'elsewhere' }), before)).toEqual(reshape({ action: 'move', role: kai.id, department: kai.room }));
    expect(inverseOf(reshape({ action: 'move', role: kai.id, department: 'elsewhere' }))).toBeNull();
  });

  it('keeps the opposite call with the result, worked out before the change is made', () => {
    const before = company();
    const kai = before.people.find((p) => p.level !== 'ceo')!;
    const call: PaletteCall = { on: 'actions', method: 'reshape', args: [{ action: 'move', role: kai.id, department: 'elsewhere' }] };
    expect(resultOf(call, before).inverse).toEqual({ on: 'actions', method: 'reshape', args: [{ action: 'move', role: kai.id, department: kai.room }] });
  });

  it('opens the feed where there is a talk bar, and catches you up only where the office can write the digest', () => {
    const byId = (options: { feed?: boolean; catchUp?: boolean }) => new Map(paletteCommands(snap, cafe(), { steering: true, ...options }).map((c) => [c.id, c]));
    expect(byId({}).has('open:feed')).toBe(false);
    expect(byId({ feed: true }).get('open:feed')).toMatchObject({ label: 'Open the feed', action: { kind: 'feed', catchUp: false }, sends: false });
    expect(byId({ feed: true }).has('catch-up')).toBe(false);
    expect(byId({ feed: true, catchUp: true }).get('catch-up')).toMatchObject({ label: 'Catch me up', action: { kind: 'feed', catchUp: true } });
    expect(callOf({ kind: 'feed', catchUp: true }, {})).toEqual({ on: 'talk', method: 'openFeed', args: [true] });
  });

  it("offers only v3's own actions until steering is bound", () => {
    const all = ids(paletteCommands(snap, cafe(), { steering: false }));
    expect(all).toContain('message:person:ceo');
    expect(all).toContain('stop:frontend-engineer');
    expect(all).toContain('open:inbox');
    for (const id of ['message:everyone', 'pause-room:engineering', 'approve-plan', 'create-task', 'leash:ui-designer', 'undo-last', 'open:decisions']) expect(all).not.toContain(id);
  });

  it('offers Resume work while you have it paused, and no plan approval once the latest is approved', () => {
    const paused = { ...cafe(), pause: { reason: 'stakeholder' as const, since: NOW, until: null, message: 'You paused work.' } };
    const all = ids(paletteCommands(snap, paused, { steering: true }));
    expect(all).toContain('resume-company');
    expect(all).not.toContain('pause-company');
    const view = cafe();
    const approved = { ...view, steering: view.steering && { ...view.steering, plan: view.steering.plan && { ...view.steering.plan, approved: { version: 3, through: null, at: NOW, by: STAKEHOLDER, cites: [] } } } };
    expect(ids(paletteCommands(snap, approved, { steering: true }))).not.toContain('approve-plan');
  });

  it("offers the plan's approvals as the plan page does: its primary suggested, the others not, nothing already done", () => {
    const view = cafe();
    const plan = view.steering?.plan ?? null;
    const setting = view.steering?.settings.planApproval ?? null;
    const choices = approveChoices(plan, setting, doneMilestones(view, plan?.versions.at(-1)?.plan ?? { goal: '', milestones: [], tasks: [] }));
    const offered = paletteCommands(snap, view, { steering: true }).filter((c) => c.action.kind === 'approve-plan');
    expect(offered.map((c) => [c.label, c.action.kind === 'approve-plan' ? c.action.through : 'x'])).toEqual([choices?.primary, ...(choices?.more ?? [])].map((c) => [c?.label, c?.through]));
    expect(offered.map((c) => c.suggested)).toEqual(offered.map((_, i) => i === 0));
    // A milestone the board has finished is no stopping point: it is never offered.
    const done = doneMilestones(view, plan?.versions.at(-1)?.plan ?? { goal: '', milestones: [], tasks: [] });
    for (const c of offered) if (c.action.kind === 'approve-plan' && c.action.through !== null) expect(done.has(c.action.through)).toBe(false);
  });

  it('never offers a milestone the board has finished, and moves its primary to the next one', () => {
    const view = cafe();
    const latest = view.steering?.plan?.versions.at(-1)?.plan;
    const first = latest?.milestones[0]?.id ?? '';
    // The goal marks the first milestone done, as the CEO does when its work is.
    const finished = { ...view, goal: { text: 'Pickup orders', setAt: NOW, milestones: [{ id: first, title: 'Menu pages live', doneWhen: 'x', doneAt: NOW }] } };
    const offered = paletteCommands(snap, finished, { steering: true }).filter((c) => c.action.kind === 'approve-plan');
    expect(offered.map((c) => c.id)).not.toContain(`approve-plan:through:${first}`);
    expect(offered.some((c) => c.suggested)).toBe(true);
  });

  it('asks for what each command still needs, one step at a time', () => {
    const byId = new Map(paletteCommands(snap, cafe(), { steering: true }).map((c) => [c.id, c]));
    expect(byId.get('message:room:design')?.steps.map((s) => [s.kind, s.label])).toEqual([['text', 'Message to the design room']]);
    expect(byId.get('reassign-task:t-11')?.steps.map((s) => s.key)).toEqual(['to', 'note']);
    const reassign = byId.get('reassign-task:t-11')?.steps[0];
    expect(reassign?.kind === 'choice' && reassign.options.map((o) => o.value)).not.toContain('frontend-engineer');
    expect(byId.get('create-task')?.steps.map((s) => s.key)).toEqual(['title', 'owner', 'brief', 'doneWhen']);
    expect(byId.get('leash:frontend-engineer')?.steps[0]).toMatchObject({ kind: 'choice', options: expect.arrayContaining([expect.objectContaining({ value: 'room', hint: 'Now' })]) });
    expect(byId.get('pause-company')?.steps).toEqual([]);
  });
});

describe('finding by typing', () => {
  const commands = () => paletteCommands(snap, cafe(), { steering: true });

  it('matches every word against a word, at its start, inside it or by its letters in order', () => {
    expect(ids(findCommands(commands(), 'msg design', [])).slice(0, 2)).toEqual(['message:room:design', 'message:person:head-of-design']);
    expect(findCommands(commands(), 'design team', [])[0]?.id).toBe('message:team:head-of-design');
    expect(findCommands(commands(), 'pause slot', [])[0]?.id).toBe('pause-task:t-11');
    expect(findCommands(commands(), 'kai leash', [])[0]?.id).toBe('leash:frontend-engineer');
    expect(findCommands(commands(), 'undo', [])[0]?.id).toBe('undo-last');
    expect(findCommands(commands(), 'trust mina', [])[0]?.id).toBe('leash:ui-designer');
    expect(findCommands(commands(), 'zebra', [])).toEqual([]);
  });

  it('finds words without their accents and in any case', () => {
    expect(matchScore('LÉA', 'Message Léa, German copywriter')).not.toBeNull();
    expect(matchScore('lea', 'Message Léa, German copywriter')).not.toBeNull();
    expect(matchScore('', 'anything')).toBe(0);
  });

  it('puts recent actions first among equals, and before anything is typed', () => {
    const recent = ['message:room:engineering'];
    expect(findCommands(commands(), 'message room', recent)[0]?.id).toBe('message:room:engineering');
    const groups = browse(commands(), [...recent, 'gone-command']);
    expect(groups.map((g) => g.title)).toEqual(['Recent', 'Suggested']);
    expect(ids(groups[0]?.commands ?? [])).toEqual(recent);
    // v0.2: Open progress joins the suggestions; eight in all before anything is typed, the recent one counted.
    expect(ids(groups[1]?.commands ?? [])).toEqual(['message:everyone', 'message:person:ceo', 'pause-company', 'approve-plan:through:ms-1', 'create-task', 'undo-last', 'open:progress']);
  });

  it('offers at most eight before anything is typed, three of them recent, and finds every other by typing', () => {
    const all = commands();
    const many = ['open:org', 'open:tasks', 'open:dashboards', 'open:preview', 'open:settings'];
    const groups = browse(all, many);
    expect(groups.flatMap((g) => g.commands)).toHaveLength(8);
    expect(ids(groups[0]?.commands ?? [])).toEqual(many.slice(0, 3));
    expect(browse(all, []).flatMap((g) => g.commands)).toHaveLength(8);
    const offered = new Set(ids(browse(all, []).flatMap((g) => g.commands)));
    expect(offered.has('open:customize')).toBe(false);
    expect(findCommands(all, 'customize', [])[0]?.id).toBe('open:customize');
  });
});

describe('the talk bar chips', () => {
  it("offers Catch me up, asking the CEO how it's going, and Pause work, from the palette's suggestions", () => {
    const chips = talkChips(paletteCommands(snap, cafe(), { steering: true, feed: true, catchUp: true }), cafe());
    expect(chips.map((c) => c.id)).toEqual(['catch-up', 'message:person:ceo', 'pause-company']);
    expect(chips.map((c) => c.label)).toEqual(['Catch me up', "Ask Noor how it's going", 'Pause work']);
    expect(chips[1]?.draft).toBe('How is it going?');
    expect(chips[0]?.draft).toBeNull();
  });

  it('offers Raise the budget for a company paused for its budget, four at most', () => {
    const paused = { ...cafe(), pause: { reason: 'budget' as const, since: NOW, until: null, message: 'Paused: the budget is spent.' } };
    const all = paletteCommands(snap, paused, { steering: true, feed: true, catchUp: true });
    expect(all.find((c) => c.id === 'raise-budget')).toMatchObject({ label: 'Raise the budget', action: { kind: 'open', path: 'settings' }, sends: false, suggested: true });
    expect(talkChips(all, paused).map((c) => c.id)).toEqual(['catch-up', 'message:person:ceo', 'raise-budget', 'pause-company']);
    expect(talkChips(all, paused, 3)).toHaveLength(3);
    // No catch-up where the office can't write one: the chips come from what the palette offers.
    expect(talkChips(paletteCommands(snap, paused, { steering: true }), paused).map((c) => c.id)).toEqual(['message:person:ceo', 'raise-budget', 'pause-company']);
    const yours = { ...cafe(), pause: { reason: 'stakeholder' as const, since: NOW, until: null, message: 'You paused work.' } };
    expect(talkChips(paletteCommands(snap, yours, { steering: true }), yours).map((c) => c.label)).toContain('Resume work');
  });

  it("narrows a step's choices the same way", () => {
    const owner = paletteCommands(snap, cafe(), { steering: true }).find((c) => c.id === 'create-task')?.steps[1];
    expect(owner?.kind).toBe('choice');
    if (owner?.kind !== 'choice') return;
    expect(findOptions(owner.options, 'ui')[0]?.value).toBe('ui-designer');
    expect(findOptions(owner.options, '')).toHaveLength(8);
  });

  it('says what it found once typing settles', () => {
    expect(resultsLine(12, 12, false)).toBe('Twelve actions.');
    expect(resultsLine(1, 1, true)).toBe('One choice.');
    expect(resultsLine(120, 40, false)).toBe('120 actions, the best 40 shown. Type more to narrow them.');
    expect(resultsLine(0, 0, false)).toBe('No action matches. Try another word.');
  });
});

describe('running a command', () => {
  it('makes the office call each command names, with its arguments', () => {
    // A message's words are typed; a Stop is typed only when the person wrote an instruction, not its default words.
    expect(callOf({ kind: 'message', to: { kind: 'person', id: 'ceo' } }, { text: 'Revise it.' })).toEqual({ on: 'actions', method: 'say', args: ['ceo', 'Revise it.', { typed: true }] });
    expect(callOf({ kind: 'message', to: { kind: 'room', id: 'design' } }, { text: 'Darker.' })).toEqual({ on: 'steer', method: 'send', args: [{ kind: 'room', id: 'design' }, 'Darker.', [], { typed: true }] });
    expect(callOf({ kind: 'stop', person: 'kai' }, { instruction: '' })).toEqual({ on: 'actions', method: 'stop', args: ['kai', 'Stop here and wait for my next message.', { typed: false }] });
    expect(callOf({ kind: 'stop', person: 'kai' }, { instruction: ' Use the brand colours. ' })).toEqual({ on: 'actions', method: 'stop', args: ['kai', 'Use the brand colours.', { typed: true }] });
    expect(callOf({ kind: 'pause-company' }, {})).toEqual({ on: 'actions', method: 'pause', args: [] });
    expect(callOf({ kind: 'pause-room', room: 'design' }, {})).toEqual({ on: 'steer', method: 'pauseRoom', args: ['design'] });
    expect(callOf({ kind: 'approve-plan', version: 3, through: 'ms-2' }, {})).toEqual({ on: 'steer', method: 'approvePlan', args: [3, 'ms-2'] });
    expect(callOf({ kind: 'cancel-task', task: 't-11' }, { reason: 'Cards wait.' })).toEqual({ on: 'steer', method: 'cancelTask', args: ['t-11', 'Cards wait.'] });
    expect(callOf({ kind: 'reassign-task', task: 't-11' }, { to: 'backend-engineer', note: 'Kai is on the cart.' })).toEqual({ on: 'steer', method: 'reassignTask', args: ['t-11', 'backend-engineer', 'Kai is on the cart.'] });
    expect(callOf({ kind: 'create-task' }, { title: 'Holiday hours', owner: 'backend-engineer', brief: 'Pickup slots skip holidays.', doneWhen: 'Slots skip holidays.' })).toEqual({
      on: 'steer',
      method: 'createTask',
      args: [{ title: 'Holiday hours', brief: 'Pickup slots skip holidays.', files: [], owner: 'backend-engineer', doneWhen: 'Slots skip holidays.', milestone: null }],
    });
    expect(callOf({ kind: 'leash', person: 'kai' }, { leash: 'room' })).toEqual({ on: 'steer', method: 'changeSettings', args: [{ leash: { person: 'kai', leash: null } }] });
    expect(callOf({ kind: 'room-leash', room: 'design' }, { leash: 'default' })).toEqual({ on: 'steer', method: 'changeSettings', args: [{ leash: { room: 'design', leash: null } }] });
    expect(callOf({ kind: 'model', person: 'kai' }, { model: 'opus' })).toEqual({ on: 'steer', method: 'changeSettings', args: [{ model: { person: 'kai', model: 'opus' } }] });
    expect(callOf({ kind: 'effort', person: 'kai' }, { effort: 'xhigh' })).toEqual({ on: 'steer', method: 'changeSettings', args: [{ effort: { person: 'kai', effort: 'xhigh' } }] });
    expect(callOf({ kind: 'effort', person: 'kai' }, { effort: 'default' })).toEqual({ on: 'steer', method: 'changeSettings', args: [{ effort: { person: 'kai', effort: null } }] });
    expect(callOf({ kind: 'undo-decision', decision: 'd-1' }, {})).toEqual({ on: 'steer', method: 'undoDecision', args: ['d-1'] });
    expect(callOf({ kind: 'open', path: 'decisions/d-1' }, {})).toEqual({ on: 'navigate', path: 'decisions/d-1' });
  });

  it('checks each answer before moving on', () => {
    const text = { kind: 'text' as const, key: 'reason', label: 'Why?', optional: false, max: 10, long: false, hint: null };
    expect(stepValue(text, '  Cards wait  ')).toEqual({ ok: true, value: 'Cards wait' });
    expect(stepValue(text, '   ')).toEqual({ ok: false, why: 'Write something first.' });
    expect(stepValue({ ...text, optional: true }, '')).toEqual({ ok: true, value: '' });
    expect(stepValue(text, 'Twelve chars')).toEqual({ ok: false, why: '12 of 10. Shorten it by 2.' });
    const choice = { kind: 'choice' as const, key: 'to', label: 'Who?', options: [{ value: 'kai', label: 'Kai', hint: null }] };
    expect(stepValue(choice, 'kai')).toEqual({ ok: true, value: 'kai' });
    expect(stepValue(choice, 'mallory')).toEqual({ ok: false, why: 'Pick one of the choices.' });
  });

  it('says what it did', () => {
    const c = cafe();
    const find = (id: string) => paletteCommands(snap, c, { steering: true }).find((x) => x.id === id)!;
    expect(doneLine(snap, c, find('message:room:design'), { text: 'x' })).toBe('Sent to the design room.');
    expect(doneLine(snap, c, find('pause-task:t-11'), {})).toBe('Paused “Pickup slot picker”.');
    expect(doneLine(snap, c, find('reassign-task:t-11'), { to: 'qa-engineer', note: 'x' })).toBe('Handed “Pickup slot picker” to the QA engineer.');
    expect(doneLine(snap, c, find('leash:ui-designer'), { leash: 'trusted' })).toBe("Mina's leash is now: trusted.");
    expect(doneLine(snap, c, find('effort:ui-designer'), { effort: 'max' })).toBe('Mina works at max effort from their next desk.');
    expect(doneLine(snap, c, find('open:inbox'), {})).toBeNull();
    expect(runWord({ kind: 'create-task' })).toBe('Create the task');
  });

  it("finds the decision a command made for its toast's Undo, never someone else's, an older one or another's target", () => {
    const before = new Set(['d-1']);
    const pause: PaletteCall = { on: 'steer', method: 'pauseTask', args: ['t-11'] };
    const paused = decision('d-2', STAKEHOLDER, 'task', 'You paused “Pickup slot picker”.', { reversible: true, links: { task: 't-11' } });
    expect(madeByCall(pause, before, paused)).toBe(true);
    expect(madeByCall(pause, before, { ...paused, by: 'ceo' })).toBe(false);
    expect(madeByCall(pause, before, { ...paused, links: { task: 't-24' } })).toBe(false);
    expect(madeByCall(pause, before, { ...paused, id: 'd-1' })).toBe(false);
    expect(madeByCall(pause, before, { ...paused, reversible: false })).toBe(false);
    expect(madeByCall(pause, before, { ...paused, undone: { at: NOW, by: STAKEHOLDER, decision: 'd-3' } })).toBe(false);
    // A leash you changed in another tab meanwhile is no part of the pause: only of a leash command for that person.
    const leash = decision('d-4', STAKEHOLDER, 'leash', 'You made Sam check with you before each task.', { reversible: true, people: ['frontend-engineer'], rooms: ['engineering'] });
    expect(madeByCall(pause, before, leash)).toBe(false);
    expect(madeByCall({ on: 'steer', method: 'changeSettings', args: [{ leash: { person: 'frontend-engineer', leash: 'check' } }] }, before, leash)).toBe(true);
    expect(madeByCall({ on: 'steer', method: 'changeSettings', args: [{ leash: { person: 'ui-designer', leash: 'check' } }] }, before, leash)).toBe(false);
    expect(madeByCall({ on: 'steer', method: 'changeSettings', args: [{ leash: { room: 'engineering', leash: 'check' } }] }, before, leash)).toBe(true);
    const model = decision('d-5', STAKEHOLDER, 'setting', 'You moved Sam to Opus.', { reversible: true, people: ['frontend-engineer'] });
    expect(madeByCall({ on: 'steer', method: 'changeSettings', args: [{ model: { person: 'frontend-engineer', model: 'opus' } }] }, before, model)).toBe(true);
    expect(madeByCall({ on: 'steer', method: 'changeSettings', args: [{ effort: { person: 'ui-designer', effort: 'max' } }] }, before, model)).toBe(false);
    const room = decision('d-6', STAKEHOLDER, 'task', 'You paused the design room: 2 tasks.', { reversible: true, rooms: ['design'] });
    expect(madeByCall({ on: 'steer', method: 'pauseRoom', args: ['design'] }, before, room)).toBe(true);
    expect(madeByCall({ on: 'steer', method: 'pauseRoom', args: ['engineering'] }, before, room)).toBe(false);
    // A message, a Stop or pausing the whole company makes no decision to take back.
    for (const call of [callOf({ kind: 'message', to: { kind: 'person', id: 'ceo' } }, { text: 'Hi.' }), callOf({ kind: 'stop', person: 'kai' }, {}), callOf({ kind: 'pause-company' }, {})]) {
      expect(madeByCall(call, before, leash)).toBe(false);
    }
  });

  it('hints each plan approval by what it approves, the whole plan included where it comes last', () => {
    const offered = paletteCommands(snap, cafe(), { steering: true }).filter((c) => c.action.kind === 'approve-plan');
    const whole = offered.filter((c) => c.action.kind === 'approve-plan' && c.action.through === null);
    expect(whole.map((c) => c.hint)).toEqual(['Work starts on its tasks']);
    expect(offered.filter((c) => !whole.includes(c)).map((c) => c.hint)).toEqual(['The milestones after it wait for you']);
  });
});

describe('recents and the shortcut', () => {
  const memory = () => {
    const store = new Map<string, string>();
    return { store, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  };

  it('keeps the eight latest commands per company, newest first, without repeats', () => {
    const s = memory();
    for (let i = 0; i < 10; i++) keepRecent(s, 'cafe', `c${i}`);
    keepRecent(s, 'cafe', 'c5');
    expect(readRecents(s, 'cafe')).toEqual(['c5', 'c9', 'c8', 'c7', 'c6', 'c4', 'c3', 'c2']);
    expect(readRecents(s, 'other')).toEqual([]);
    expect(s.store.has(recentsKey('cafe'))).toBe(true);
  });

  it('works without storage, and ignores what it cannot read', () => {
    const refuse = () => {
      throw new Error('blocked');
    };
    expect(readRecents({ getItem: refuse }, 'cafe')).toEqual([]);
    expect(keepRecent({ getItem: refuse, setItem: refuse }, 'cafe', 'x')).toEqual(['x']);
    expect(readRecents({ getItem: () => '{"not":"a list"}' }, 'cafe')).toEqual([]);
    expect(readRecents({ getItem: () => '["a", 3, "b"]' }, 'cafe')).toEqual(['a', 'b']);
  });

  it('opens on Ctrl+K, or Cmd+K on a Mac, and nothing else', () => {
    const key = (extra: Partial<KeyPress>): KeyPress => ({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
    expect(isPaletteKey(key({ ctrlKey: true }), false)).toBe(true);
    expect(isPaletteKey(key({ key: 'K', ctrlKey: true }), false)).toBe(true);
    expect(isPaletteKey(key({ metaKey: true }), true)).toBe(true);
    expect(isPaletteKey(key({ ctrlKey: true }), true)).toBe(false);
    expect(isPaletteKey(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isPaletteKey(key({ key: 'j', ctrlKey: true }), false)).toBe(false);
    expect(isMacLike('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)')).toBe(true);
    expect(isMacLike('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(shortcutLabel(false)).toBe('Ctrl+K');
  });
});

it('never needs a person who left', () => {
  // A plain company without steering in its view still builds its commands.
  expect(() => paletteCommands(snap, company(), { steering: true })).not.toThrow();
});
