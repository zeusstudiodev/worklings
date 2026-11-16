// v0.2's spending plan inside a company (Robin, 13 Nov 2026): the office's own "How thorough?" question, the preset it
// sets, the models by level, and the budget: a notice at 80%, a hard pause at 100%, for the company and for each person.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgRefusal, THE_OFFICE, UNDO_MS } from '../src/core/company.ts';
import { PRESETS } from '../src/core/presets.ts';
import { ended, proposal, rig } from './company-kit.ts';

function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

/** The company settles a change in a microtask: let it. */
const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/** A turn that ended having cost `usd`. */
const costing = (usd: number) => ({ ...ended('Done.'), costUsd: usd });

const founding = (o: Parameters<typeof rig>[0] = {}) => rig({ now: () => Date.now(), ...o });
const running = (o: Parameters<typeof rig>[0] = {}) => rig({ now: () => Date.now(), running: true, ...o });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the office’s "How thorough?" question', () => {
  it('is asked first, at founding, with the presets and what each costs, and Balanced as its pick', async () => {
    const { company, org, desks } = await founding();
    const view = company.view();
    const q = view.questions[0];
    expect(view.questions).toHaveLength(1);
    expect(q).toMatchObject({ from: THE_OFFICE, text: 'How thorough?', recommended: 1, preset: true, answer: null, withdrawn: null });
    expect(q?.options).toHaveLength(3);
    expect(q?.options[0]).toMatch(/^Lean: 2 to 4 people, about \d(\.\d)?x Balanced's cost$/);
    expect(q?.options[1]).toBe('Balanced: 3 to 10 people, the default cost');
    expect(q?.options[2]).toMatch(/^Thorough: 6 to 25 people, about \d(\.\d)?x Balanced's cost$/);
    expect(view.spending?.presetQuestion).toBe(q?.id);
    expect(view.inbox).toBe(1);
    // Balanced stands until the stakeholder chooses: its desks and its models, and the CEO is told so.
    expect(view.settings).toMatchObject({ preset: 'balanced', maxDesks: 5, models: { ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' }, budget: { company: null, person: null } });
    expect(desks().maxDesks).toBe(5);
    expect(org.openings[0]).toMatchObject({ preset: 'balanced', models: PRESETS.balanced.models });
  });

  it('sets the preset once answered, after the undo window: its desks, its models, and the CEO is told', async () => {
    const { company, desks } = await founding();
    const q = company.view().questions[0];
    company.answer(q?.id ?? '', { option: 0, text: '' });
    // Inside the undo window nothing has changed.
    expect(company.view().settings.preset).toBe('balanced');
    vi.advanceTimersByTime(UNDO_MS);
    const view = company.view();
    expect(view.settings).toMatchObject({ preset: 'lean', maxDesks: 3 });
    expect(desks().maxDesks).toBe(3);
    expect(view.spending?.presetQuestion).toBeNull();
    expect(view.inbox).toBe(0);
    const told = desks().textsFor('ceo').at(-1) ?? '';
    expect(told).toContain('chose Lean for how thorough the company is');
    expect(told).toContain('Size your draft to it.');
    expect(told).toContain('small or medium');
    expect(view.log.some((l) => l.kind === 'settings' && l.text === 'You chose Lean: 2 to 4 people, 3 at work at once.')).toBe(true);
    expect(view.steering?.decisions.some((d) => d.kind === 'answer' && d.what.startsWith('You answered the office: Lean'))).toBe(true);
  });

  it('can be undone inside its window, and then the preset does not change', async () => {
    const { company } = await founding();
    const q = company.view().questions[0];
    company.answer(q?.id ?? '', { option: 2, text: '' });
    company.undo(q?.id ?? '');
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(company.view().settings.preset).toBe('balanced');
    expect(company.view().spending?.presetQuestion).toBe(q?.id);
  });

  it('never blocks: with no answer the CEO proposes, the company starts as Balanced and the question goes', async () => {
    const { company, desks } = await founding();
    expect(company.proposeOrg('ceo', proposal()).ok).toBe(true);
    // Still open beside the chart, so the proposal can show the selector.
    expect(company.view().spending?.presetQuestion).not.toBeNull();
    company.start();
    await company.idle();
    const view = company.view();
    expect(view.phase).toBe('running');
    expect(view.settings.preset).toBe('balanced');
    expect(view.questions.find((q) => q.preset)?.withdrawn?.reason).toBe('The company started as Balanced.');
    expect(view.spending?.presetQuestion).toBeNull();
    expect(view.inbox).toBe(0);
    expect(desks().textsFor('ceo').at(-1)).toContain('started the company');
  });

  it('takes the answer into the scoping message when the CEO asks questions, and does not wait for it', async () => {
    const { company, desks } = await founding();
    const asked = company.askScoping('ceo', [{ text: 'Who is it for?', options: ['Just me', 'Anyone'], recommended: 1, why: 'Others use it too.' }]);
    // The stakeholder picks Thorough first: the CEO hears it with the answers, not as a turn of its own.
    const thorough = company.view().questions.find((q) => q.preset);
    const before = desks().textsFor('ceo').length;
    company.answer(thorough?.id ?? '', { option: 2, text: '' });
    vi.advanceTimersByTime(UNDO_MS);
    expect(desks().textsFor('ceo')).toHaveLength(before);
    company.answer(asked[0]?.id ?? '', { option: 0, text: '' });
    vi.advanceTimersByTime(UNDO_MS);
    const text = desks().textsFor('ceo').at(-1) ?? '';
    expect(text).toContain('Answers to your scoping questions:');
    expect(text).toContain("Thoroughness: Thorough (the stakeholder's choice)");
    expect(text).toContain('small, medium or large');
    expect(text).toContain('Now draft the org from these answers, sized to the goal they describe and to the preset above.');
  });
});

describe('choosing a preset on the proposal', () => {
  it('moves the models that still follow the old preset, keeps the ones set by hand, and asks the CEO to revise', async () => {
    const { company, desks } = await founding();
    company.proposeOrg('ceo', proposal());
    const before = desks().textsFor('ceo').length;
    const settings = company.setPreset('thorough');
    expect(settings).toMatchObject({ preset: 'thorough', maxDesks: 8, models: { ceo: 'opus', head: 'opus', lead: 'sonnet', worker: 'sonnet' } });
    const view = company.view();
    const model = (id: string) => view.proposal?.people.find((p) => p.id === id)?.model;
    expect(model('head-of-design')).toBe('opus');
    expect(model('head-of-engineering')).toBe('opus');
    // Lea was put on Haiku by hand, which no preset takes back; the others on Sonnet stay there.
    expect(model('ux-designer')).toBe('haiku');
    expect(model('ui-designer')).toBe('sonnet');
    expect(view.proposalEdited).toBe(true);
    expect(desks().maxDesks).toBe(8);
    const told = desks().textsFor('ceo').slice(before);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('chose Thorough');
    expect(told[0]).toContain('Revise your proposal to it with propose_org, keeping the ids of everyone who stays.');
    expect(told[0]).toContain('small, medium or large');
    // The open question was settled by the choice.
    expect(view.questions.find((q) => q.preset)?.withdrawn?.reason).toBe('You chose Thorough.');
  });

  it('leaves the CEO alone with resize false, and keeps a desks number the stakeholder set', async () => {
    const { company, desks } = await founding();
    company.proposeOrg('ceo', proposal());
    company.updateSettings({ maxDesks: 4 });
    const before = desks().textsFor('ceo').length;
    company.setPreset('lean', { resize: false });
    expect(desks().textsFor('ceo')).toHaveLength(before);
    expect(company.view().settings).toMatchObject({ preset: 'lean', maxDesks: 4 });
  });

  it('says when the proposal is outside the preset’s range, and by which side', async () => {
    const { company } = await founding();
    company.proposeOrg('ceo', proposal());
    expect(company.view().spending?.outside).toBeNull();
    company.setPreset('lean', { resize: false });
    expect(company.view().spending?.outside).toEqual({ side: 'over', people: 8, min: 2, max: 4 });
    company.setPreset('thorough', { resize: false });
    // Eight people are inside Thorough's 6 to 25.
    expect(company.view().spending?.outside).toBeNull();
  });

  it('asks the CEO to size a draft that is not out yet, unless scoping answers are on their way', async () => {
    const { company, desks } = await founding();
    const before = desks().textsFor('ceo').length;
    company.setPreset('lean');
    expect(desks().textsFor('ceo').slice(before).join('\n')).toContain('Size your draft to it.');
    const again = await founding();
    again.company.askScoping('ceo', [{ text: 'Who?', options: ['Me', 'You'], recommended: 0, why: 'Because.' }]);
    const base = again.desks().textsFor('ceo').length;
    again.company.setPreset('thorough');
    expect(again.desks().textsFor('ceo')).toHaveLength(base);
  });

  it('is refused once the company has started, and for a preset it does not have', async () => {
    const { company } = await running();
    expect(refusal(() => company.setPreset('lean'))).toMatchObject({ code: 'conflict' });
    const fresh = await founding();
    expect(refusal(() => fresh.company.setPreset('huge' as never))).toMatchObject({ code: 'invalid', message: 'A preset is one of lean, balanced, thorough.' });
  });

  it('puts the preset’s name in front of a sizing that does not name it', async () => {
    const { company } = await founding();
    const named = company.proposeOrg('ceo', proposal({ sizing: 'An owner for each area, tested apart.' }));
    expect(named.ok && named.proposal.sizing).toBe('Balanced: An owner for each area, tested apart.');
    const own = company.proposeOrg('ceo', proposal({ sizing: 'Balanced for a café with a payment area.' }));
    expect(own.ok && own.proposal.sizing).toBe('Balanced for a café with a payment area.');
    const long = company.proposeOrg('ceo', proposal({ sizing: 'x'.repeat(300) }));
    expect(long.ok && long.proposal.sizing).toHaveLength(300);
    expect(long.ok && long.proposal.sizing?.startsWith('Balanced: x')).toBe(true);
  });

  it('hands the check the models of the company, and the stakeholder’s edits too', async () => {
    const { company, org } = await founding();
    company.setModels({ worker: 'haiku' });
    company.proposeOrg('ceo', proposal());
    expect(org.checks.at(-1)).toEqual({ preset: 'balanced', models: { ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'haiku' } });
    company.editProposal(proposal());
    expect(org.checks.at(-1)).toMatchObject({ enforceSize: false, models: { worker: 'haiku' } });
  });
});

describe('models by level', () => {
  it('change the settings and the proposal together, in one action', async () => {
    const { company, desks } = await founding();
    company.proposeOrg('ceo', proposal());
    const before = desks().textsFor('ceo').length;
    const result = company.setModels({ head: 'opus', worker: 'haiku' });
    expect(result.settings.models).toEqual({ ceo: 'opus', head: 'opus', lead: 'sonnet', worker: 'haiku' });
    const model = (id: string) => result.proposal?.people.find((p) => p.id === id)?.model;
    expect([model('head-of-design'), model('ui-designer'), model('ux-designer'), model('frontend-lead'), model('ceo')]).toEqual(['opus', 'haiku', 'haiku', 'sonnet', 'opus']);
    // The CEO hears it as the stakeholder's edit of its proposal.
    expect(desks().textsFor('ceo').slice(before).join('\n')).toContain('runs on haiku');
    expect(company.view().spending?.models).toEqual(result.settings.models);
  });

  it('are the settings alone while the CEO is still drafting', async () => {
    const { company } = await founding();
    const result = company.setModels({ ceo: 'sonnet' });
    expect(result.proposal).toBeNull();
    expect(result.settings.models.ceo).toBe('sonnet');
  });

  it('refuse a model nobody has, nothing at all, a level that does not exist, and a company that has started', async () => {
    const fresh = await founding();
    expect(refusal(() => fresh.company.setModels({ head: 'gpt-9' as never }))).toMatchObject({ code: 'invalid', message: 'A model is one of inherit, sonnet, opus, haiku.' });
    expect(refusal(() => fresh.company.setModels({}))).toMatchObject({ code: 'invalid' });
    expect(refusal(() => fresh.company.setModels({ boss: 'opus' } as never))).toMatchObject({ code: 'invalid' });
    const { company } = await running();
    expect(refusal(() => company.setModels({ head: 'opus' }))).toMatchObject({ code: 'conflict' });
  });
});

describe('ANTHROPIC_MODEL', () => {
  it('runs everyone when the environment names a model, as it did before people carried aliases', async () => {
    const { company, desks } = await running({ env: { ANTHROPIC_MODEL: 'claude-sonnet-5-5' } });
    const t = desks().turns.at(-1);
    expect(t?.plan.model).toBe('claude-sonnet-5-5');
    expect(company.view().spending?.modelOverride).toBe('claude-sonnet-5-5');
    // The agent files still say what each person is on; the variable is what overrides it at the desk.
    expect(company.view().people.find((p) => p.id === 'ui-designer')?.model).toBe('sonnet');
  });

  it('is ignored when it is unset, empty, or could be read as a flag', async () => {
    for (const env of [{}, { ANTHROPIC_MODEL: '' }, { ANTHROPIC_MODEL: '--add-dir=/' }]) {
      const { company, desks } = await running({ env });
      expect(company.view().spending?.modelOverride).toBeNull();
      expect(desks().turns.at(-1)?.plan.model).toBe('opus');
    }
  });

  it('is what the estimates price everyone as', async () => {
    const forced = await founding({ env: { ANTHROPIC_MODEL: 'haiku' } });
    const normal = await founding();
    const cost = (r: typeof forced) => r.company.view().spending?.presets.find((p) => p.id === 'balanced')?.perHour ?? 0;
    expect(cost(forced)).toBeLessThan(cost(normal) / 5);
  });
});

describe('what the proposal shows of its cost', () => {
  it('carries each person’s fixed prompt, the whole job and the live rate', async () => {
    const { company } = await founding();
    company.proposeOrg('ceo', proposal());
    const s = company.view().spending;
    expect(s?.loads?.byPerson.ceo?.tokens).toBe(26_000);
    expect(s?.loads?.byPerson['ui-designer']?.tokens).toBe(13_000);
    expect(s?.loads?.tokens).toBe(26_000 + 7 * 13_000);
    expect(s?.job).toMatchObject({ basis: 'proposal' });
    expect(s?.job?.low).toBeLessThan(s?.job?.high ?? 0);
    expect(s?.presets.map((p) => p.id)).toEqual(['lean', 'balanced', 'thorough']);
    expect(s?.live).toEqual({ perHour: 0, windowMinutes: 5 });
  });

  it('is counted from the plan’s tasks once there is one, and the fixed prompts go when the company runs', async () => {
    const { company } = await running();
    expect(company.view().spending?.loads).toBeNull();
    expect(company.view().spending?.job?.basis).toBe('proposal');
  });

  it('shows the live cost an hour over the last quarter hour', async () => {
    const { company, desks } = await running();
    desks().events.turn('ui-designer', costing(0.5));
    expect(company.view().spending?.live).toEqual({ perHour: 6, windowMinutes: 5 });
    vi.advanceTimersByTime(20 * 60_000);
    desks().events.turn('ui-designer', costing(0.25));
    expect(company.view().spending?.live).toEqual({ perHour: 1, windowMinutes: 15 });
  });
});

describe('the budget', () => {
  it('is set in dollars to the cent, cleared with null, and logged', async () => {
    const { company } = await founding();
    const set = company.setBudget({ company: 50, person: 12.345 });
    expect(set.budget).toEqual({ company: 50, person: 12.35 });
    expect(company.view().settings.budget).toEqual({ company: 50, person: 12.35 });
    const log = company.view().log.map((l) => l.text);
    expect(log).toContain("You set the company's budget to $50.");
    expect(log).toContain("You set each person's budget to $12.35.");
    expect(company.setBudget({ company: null }).budget).toEqual({ company: null, person: 12.35 });
    expect(company.view().log.at(-1)?.text).toBe("You took the company's budget off.");
  });

  it('is refused when it is not a dollar amount or names nothing', async () => {
    const { company } = await founding();
    for (const bad of [0, -1, 2_000_000, Number.NaN, '5' as never]) expect(refusal(() => company.setBudget({ company: bad })).code).toBe('invalid');
    expect(refusal(() => company.setBudget({})).code).toBe('invalid');
    expect(company.view().settings.budget).toEqual({ company: null, person: null });
  });

  it('gives a notice at 80%: one question in the inbox, once, and no pause', async () => {
    const { company, desks } = await running();
    company.setBudget({ company: 10 });
    desks().events.turn('ui-designer', costing(7.99));
    await tick();
    expect(company.view().questions.filter((q) => q.budget)).toEqual([]);
    desks().events.turn('ui-designer', costing(0.02));
    await tick();
    const view = company.view();
    const notice = view.questions.filter((q) => q.budget);
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({ from: THE_OFFICE, answer: null, withdrawn: null, budget: { scope: 'company', person: null, at: 80, cap: 10, raiseTo: [15, 20] } });
    expect(notice[0]?.text).toContain('$8.01 of its $10 budget, 80%');
    expect(notice[0]?.options).toEqual(['Raise it to $15', 'Raise it to $20', 'Carry on']);
    expect(view.pause).toBeNull();
    expect(view.spending?.budget).toMatchObject({ company: 10, state: 'warning', spent: expect.closeTo(8.01, 6) });
    expect(view.inbox).toBe(1);
    // Another turn under the cap says nothing more.
    desks().events.turn('ui-designer', costing(0.5));
    await tick();
    expect(company.view().questions.filter((q) => q.budget)).toHaveLength(1);
    expect(desks().pauses).toEqual([]);
  });

  it('pauses hard at 100%: nobody takes another turn, turns under way finish, and the inbox asks to raise or stop', async () => {
    const { company, desks } = await running();
    company.setBudget({ company: 10 });
    desks().events.turn('ui-designer', costing(8.5));
    await tick();
    desks().events.turn('frontend-engineer', costing(1.6));
    await tick();
    const view = company.view();
    expect(view.pause).toMatchObject({ reason: 'budget', until: null, message: "Paused: the company's $10 budget is spent. Raise it to carry on." });
    // The switchboard rests with no end; its working desks finish their turn first (DeskControl.pause).
    expect(desks().pauses).toEqual([null]);
    const asks = view.questions.filter((q) => q.budget);
    expect(asks.map((q) => [q.budget?.at, q.withdrawn?.reason ?? null])).toEqual([[80, 'The budget is spent now.'], [100, null]]);
    const stop = asks[1];
    expect(stop?.options).toEqual(['Raise it to $15 and carry on', 'Raise it to $20 and carry on', 'Leave it paused']);
    expect(stop?.text).toContain('nobody takes another turn; turns under way finish first');
    expect(view.spending?.budget.state).toBe('paused');
    expect(view.log.some((l) => l.kind === 'pause' && l.by === THE_OFFICE)).toBe(true);
    // A usage limit does not take the pause over, and the stakeholder's resume does not lift it either.
    desks().events.limited(Date.now() + 1_000, 'Limit reached.', 'usage-limit');
    expect(company.view().pause?.reason).toBe('budget');
    expect(refusal(() => company.resume())).toMatchObject({ code: 'conflict', message: "The company's $10 budget is spent. Raise it, or take it off, to carry on." });
    expect(desks().resumes).toBe(0);
  });

  it('carries on when the stakeholder raises it, from the answer or from the settings, and not before', async () => {
    const { company, desks } = await running();
    company.setBudget({ company: 10 });
    desks().events.turn('ui-designer', costing(11));
    await tick();
    const ask = company.view().questions.find((q) => q.budget?.at === 100);
    company.answer(ask?.id ?? '', { option: 0, text: '' });
    await tick();
    expect(company.view().pause?.reason).toBe('budget');
    vi.advanceTimersByTime(UNDO_MS);
    await tick();
    const view = company.view();
    expect(view.settings.budget.company).toBe(15);
    expect(view.pause).toBeNull();
    expect(desks().resumes).toBe(1);
    expect(view.questions.find((q) => q.id === ask?.id)?.answer?.option).toBe(0);
    expect(view.log.map((l) => l.text)).toContain('The budget allows work again, so the company carries on.');
    // Spent again past the new cap: paused again, and the settings lift it as well.
    desks().events.turn('ui-designer', costing(5));
    await tick();
    expect(company.view().pause?.reason).toBe('budget');
    company.setBudget({ company: 100 });
    await tick();
    expect(company.view().pause).toBeNull();
    expect(desks().resumes).toBe(2);
    expect(company.view().questions.filter((q) => q.budget && q.withdrawn === null && q.answer === null)).toEqual([]);
  });

  it('stays paused when the stakeholder answers "Leave it paused", and lifts when the budget goes', async () => {
    const { company, desks } = await running();
    company.setBudget({ company: 10 });
    desks().events.turn('ui-designer', costing(10));
    await tick();
    const ask = company.view().questions.find((q) => q.budget?.at === 100);
    company.answer(ask?.id ?? '', { option: 2, text: '' });
    vi.advanceTimersByTime(UNDO_MS);
    await tick();
    expect(company.view().pause?.reason).toBe('budget');
    expect(company.view().settings.budget.company).toBe(10);
    company.setBudget({ company: null });
    await tick();
    expect(company.view().pause).toBeNull();
    expect(desks().resumes).toBe(1);
  });

  it('counts what the transcripts showed of a turn that has not ended, so a long turn does not slip past', async () => {
    const { company, desks } = await running();
    company.setBudget({ company: 1 });
    company.noteSpend(new Map([['ui-designer', 1.2]]));
    await tick();
    expect(company.view().pause?.reason).toBe('budget');
    expect(desks().pauses).toEqual([null]);
  });

  it('lets a budget below what is already spent pause at once', async () => {
    const { company, desks } = await running();
    desks().events.turn('ui-designer', costing(3));
    company.setBudget({ company: 2 });
    await tick();
    expect(company.view().pause?.reason).toBe('budget');
    expect(desks().pauses).toEqual([null]);
  });

  it('keeps the stakeholder’s own pause, and the office does not resume what the stakeholder paused', async () => {
    const { company, desks } = await running();
    company.pause();
    company.setBudget({ company: 1 });
    desks().events.turn('ui-designer', costing(2));
    await tick();
    expect(company.view().pause?.reason).toBe('stakeholder');
    company.setBudget({ company: 50 });
    await tick();
    expect(company.view().pause?.reason).toBe('stakeholder');
    expect(desks().resumes).toBe(0);
  });

  it('survives a restart: the pause, the cap, the notices and the held person', async () => {
    const r = await running();
    r.company.setBudget({ company: 10, person: 3 });
    r.desks().events.turn('ui-designer', costing(4));
    await tick();
    r.desks().events.turn('frontend-engineer', costing(7));
    await tick();
    await r.company.close();
    const again = r.reopen();
    const board = r.boards.at(-1);
    expect(board?.pauses).toEqual([null]);
    const view = again.view();
    expect(view.pause?.reason).toBe('budget');
    expect(view.settings.budget).toEqual({ company: 10, person: 3 });
    expect(view.questions.filter((q) => q.budget && q.withdrawn === null && q.answer === null).map((q) => q.budget?.scope)).toEqual(expect.arrayContaining(['company', 'person']));
    // No second notice for the same cap after the restart.
    await tick();
    const count = again.view().questions.filter((q) => q.budget).length;
    await tick();
    expect(again.view().questions.filter((q) => q.budget)).toHaveLength(count);
    // Kai is still over their own budget: a word to them waits.
    const before = board?.textsFor('ui-designer').length ?? 0;
    again.say('ui-designer', 'Try navy.');
    expect(board?.textsFor('ui-designer')).toHaveLength(before);
    await again.close();
  });
});

describe('a person’s budget', () => {
  it('pauses that person alone: their turns wait, their manager is told, the inbox asks', async () => {
    const { company, desks } = await running();
    company.setBudget({ person: 1 });
    desks().events.turn('ui-designer', costing(1.2));
    await tick();
    const view = company.view();
    // Not the company: nobody else stops.
    expect(view.pause).toBeNull();
    expect(desks().pauses).toEqual([]);
    const ask = view.questions.find((q) => q.budget?.scope === 'person');
    expect(ask).toMatchObject({ from: THE_OFFICE, budget: { scope: 'person', person: 'ui-designer', at: 100, cap: 1, raiseTo: [1.5, 2] } });
    expect(ask?.text).toContain('Kai has used $1.20 of their $1 budget');
    expect(ask?.options).toEqual(['Raise it to $1.50 for everyone', 'Raise it to $2 for everyone', 'Leave Kai paused']);
    expect(desks().textsFor('head-of-design').at(-1)).toContain('Kai has used their whole $1 budget, so Kai takes no more turns until Robin raises it.');
    expect(view.spending?.budget.people).toEqual([expect.objectContaining({ person: 'ui-designer', state: 'paused' })]);
    const kai = desks().textsFor('ui-designer').length;
    company.say('ui-designer', 'Try navy.');
    expect(desks().textsFor('ui-designer')).toHaveLength(kai);
    // Everyone else still gets turns.
    const sam = desks().textsFor('frontend-engineer').length;
    company.say('frontend-engineer', 'Try green.');
    expect(desks().textsFor('frontend-engineer')).toHaveLength(sam + 1);
  });

  it('takes turns waiting for the desk back from the switchboard, and hands every held word over once the budget is raised', async () => {
    const { company, desks } = await running();
    company.say('ui-designer', 'First, a palette.');
    expect(desks().textsFor('ui-designer')).toHaveLength(1);
    company.setBudget({ person: 1 });
    desks().events.turn('ui-designer', costing(2));
    await tick();
    expect(desks().withdrawn.length).toBeGreaterThan(0);
    company.say('ui-designer', 'Then the streak card.');
    expect(desks().textsFor('ui-designer')).toHaveLength(1);
    company.setBudget({ person: 5 });
    await tick();
    const texts = desks().textsFor('ui-designer');
    expect(texts.join('\n')).toContain('Then the streak card.');
    expect(company.view().questions.filter((q) => q.budget && q.withdrawn === null && q.answer === null)).toEqual([]);
    expect(company.view().log.map((l) => l.text)).toContain('Kai is under budget again, so their turns carry on.');
  });

  it('raises the cap for everyone from the answer', async () => {
    const { company, desks } = await running();
    company.setBudget({ person: 1 });
    desks().events.turn('ui-designer', costing(1.1));
    await tick();
    const ask = company.view().questions.find((q) => q.budget?.scope === 'person');
    company.answer(ask?.id ?? '', { option: 1, text: '' });
    vi.advanceTimersByTime(UNDO_MS);
    await tick();
    expect(company.view().settings.budget.person).toBe(2);
    company.say('ui-designer', 'Back to work.');
    expect(desks().textsFor('ui-designer').at(-1)).toContain('Back to work.');
  });

  it('asks the stakeholder only, for a person with nobody above them', async () => {
    const { company, desks } = await running();
    company.setBudget({ person: 1 });
    const before = desks().turns.length;
    desks().events.turn('ceo', costing(1.5));
    await tick();
    expect(company.view().questions.find((q) => q.budget?.person === 'ceo')).toBeDefined();
    expect(desks().turns).toHaveLength(before);
  });

  it('is a person’s own spending: the company’s other people do not count against it', async () => {
    const { company, desks } = await running();
    company.setBudget({ person: 3 });
    for (const person of ['ui-designer', 'ux-designer', 'frontend-engineer']) desks().events.turn(person, costing(2));
    await tick();
    expect(company.view().questions.filter((q) => q.budget)).toEqual([]);
    expect(company.view().spending?.budget.people.map((p) => p.state)).toEqual(['ok', 'ok', 'ok']);
  });
});
