// v0.2's spending plan in the browser: the sentences the form says, the budget's figures, what a desk loads, the pause for
// budget wherever pause is shown, and the demo's three routes. Pure, so none of it needs a page.
import { describe, expect, it } from 'vitest';
import { THE_OFFICE } from '../src/core/company.ts';
import { demoCompanyView, demoProposalView } from '../src/core/demo-company.ts';
import { defaultLoads, estimateLoads } from '../src/core/loads.ts';
import type { OrgProposal } from '../src/core/org.ts';
import { budgetViewOf, presetInfos } from '../src/core/spending.ts';
import { companyState, stateOfCompany } from '../web/src/company/model.ts';
import { waitsForWords } from '../web/src/company/pauseWords.ts';
import { editPerson } from '../web/src/company/proposal/model.ts';
import { budgetIn, modelsIn, officeAnswerIn, presetIn } from '../web/src/company/spending/demoSpending.ts';
import {
  BUDGET_MESSAGE,
  barMeter,
  budgetFigure,
  compactDollars,
  capField,
  capWords,
  fixedPromptLine,
  loadsSummary,
  loadsToWrite,
  mcpNamed,
  modelsSentence,
  outsideSentence,
  parseDollars,
  presetChangedLine,
  presetFacts,
  spendWithBudget,
  tokensShort,
} from '../web/src/company/spending/spendingModel.ts';

const NOW = Date.UTC(2026, 10, 13, 12);

describe('the presets in words', () => {
  it('says which model each level runs on, grouping the levels that share one', () => {
    expect(modelsSentence({ ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' })).toBe('The CEO on Opus, everyone else on Sonnet.');
    expect(modelsSentence({ ceo: 'opus', head: 'opus', lead: 'sonnet', worker: 'sonnet' })).toBe('The CEO and heads on Opus, everyone else on Sonnet.');
    expect(modelsSentence({ ceo: 'sonnet', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' })).toBe('Everyone on Sonnet.');
    expect(modelsSentence({ ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'haiku' })).toBe('The CEO on Opus, heads and leads on Sonnet, workers on Haiku.');
  });

  it('lists the facts a person compares presets by, fewer in the compact scoping card', () => {
    const [lean, balanced] = presetInfos();
    expect(lean && presetFacts(lean).map((f) => f.label)).toEqual(['People', 'At work at once', 'Models', 'Cost while it works', 'Whole job']);
    expect(balanced && presetFacts(balanced, true).map((f) => f.label)).toEqual(['People', 'Cost while it works', 'Whole job']);
    expect(balanced && presetFacts(balanced)[0]?.value).toBe('3 to 10');
    expect(balanced && presetFacts(balanced).at(-1)?.value).toMatch(/^about \$[\d.]+ to \$[\d.]+$/);
  });

  it('says what a preset change told the CEO, by where the company is', () => {
    expect(presetChangedLine('Lean', 'proposed', false)).toBe('Lean is set. The CEO is revising the proposal to fit it.');
    expect(presetChangedLine('Lean', 'founding', true)).toBe('Lean is set. The CEO hears it with your answers.');
    expect(presetChangedLine('Lean', 'founding', false)).toBe('Lean is set. The CEO sizes its draft to it.');
  });

  it('says a proposal outside the preset range, either side', () => {
    expect(outsideSentence({ side: 'under', people: 2, min: 6, max: 25 }, 'Thorough')).toContain('has 2 people, fewer than the 6 to 25 that Thorough sizes to');
    expect(outsideSentence({ side: 'over', people: 12, min: 2, max: 4 }, 'Lean')).toContain('more than the 2 to 4');
  });
});

describe('the budget', () => {
  it('reads what a person types as dollars: symbols and commas are fine, empty is no budget, the rest is refused', () => {
    expect(parseDollars('$1,200')).toEqual({ ok: true, value: 1200 });
    expect(parseDollars(' 4.5 ')).toEqual({ ok: true, value: 4.5 });
    expect(parseDollars('')).toEqual({ ok: true, value: null });
    for (const bad of ['0', '0.001', '12.345', 'twenty', '-3', '2000000', '1e3']) expect(parseDollars(bad)).toEqual({ ok: false, message: BUDGET_MESSAGE });
  });

  it('shows caps as they are typed', () => {
    expect(capWords(20)).toBe('$20');
    expect(capWords(4.5)).toBe('$4.50');
    expect(capWords(1200)).toBe('$1,200');
    expect(capField(null)).toBe('');
    expect(capField(4.5)).toBe('4.50');
    expect(capField(20)).toBe('20');
  });

  it('works out the bar figure with its state and words', () => {
    const view = (spent: number) => budgetViewOf({ budget: { company: 20, person: null } }, { a: spent });
    expect(budgetFigure(view(4.2))).toMatchObject({ text: '$4.20 of $20', state: 'ok' });
    expect(budgetFigure(view(16))).toMatchObject({ state: 'warning', words: 'The company has spent 80% of its budget.' });
    expect(budgetFigure(view(20))).toMatchObject({ state: 'paused', share: 1, words: 'The company budget is spent, so work is paused.' });
    expect(budgetFigure(budgetViewOf({ budget: { company: null, person: null } }, { a: 4 }))).toBeNull();
  });

  it("puts the bar's money in one short meter, the API-equivalent words in its name and tooltip", () => {
    const money = { label: 'API-equivalent' as const, title: 'What the same tokens would cost on the Claude API.' };
    const budget = budgetViewOf({ budget: { company: 60, person: null } }, { a: 40.27 });
    const meter = barMeter(40.27, budget, money);
    expect(meter).toMatchObject({ text: '$40 of $60', state: 'ok', name: '$40.27 of the $60 budget spent, API-equivalent' });
    expect(meter.share).toBeCloseTo(40.27 / 60);
    expect(meter.title).toBe('67% of the company budget is spent. API-equivalent: What the same tokens would cost on the Claude API.');
    expect(meter.text).not.toContain('API');
    const none = barMeter(4.2, budgetViewOf({ budget: { company: null, person: null } }, { a: 4.2 }), { label: 'Spend', title: 'What Claude Code reported.' });
    expect(none).toEqual({ text: '$4.20', share: null, state: null, name: '$4.20 spent, no budget', title: 'What Claude Code reported.' });
    expect(compactDollars(1234.9)).toBe('$1,234');
    expect(compactDollars(9.99)).toBe('$9.99');
  });

  it('adds the budget to the phone spend line only when there is one', () => {
    const budget = budgetViewOf({ budget: { company: 20, person: null } }, { a: 4.2 });
    expect(spendWithBudget(4.2, budget, true)).toBe('$4.20 of $20 spent, API-equivalent.');
    expect(spendWithBudget(4.2, undefined, false)).toBe('$4.20 spent.');
  });

  it('puts a company paused for budget in the pill, the sentence and the words for what it waits for', () => {
    const view = { ...demoCompanyView(NOW), pause: { reason: 'budget' as const, since: NOW, until: null, message: "Paused: the company's $60 budget is spent. Raise it to carry on." } };
    const state = companyState(stateOfCompany(view, NOW), NOW);
    expect(state).toMatchObject({ pill: 'Over budget', tone: 'needs', sentence: "Paused: the company's $60 budget is spent. Raise it to carry on." });
    expect(waitsForWords(view.pause)).toBe('you raise the budget');
    expect(waitsForWords({ reason: 'stakeholder' })).toBe('you resume work');
    expect(waitsForWords(null)).toBe('you resume work');
  });
});

describe('what a desk loads', () => {
  const worker = { level: 'worker' as const };

  it('says tokens the way the proposal says them', () => {
    expect([tokensShort(980), tokensShort(13_000), tokensShort(13_600), tokensShort(98_450)]).toEqual(['980', '13k', '13.6k', '98.5k']);
    expect(fixedPromptLine({ tokens: 13_000, measured: true })).toBe('about 13k tokens before any work');
    expect(fixedPromptLine(estimateLoads({ mcp: ['github'] }, 'worker'))).toBe('about 14.8k tokens before any work (partly estimated)');
  });

  it('writes only what differs from the defaults of the level', () => {
    const base = defaultLoads('worker');
    expect(loadsToWrite(base, 'worker')).toBeUndefined();
    expect(loadsToWrite({ ...base, skills: true }, 'worker')).toEqual({ skills: true });
    expect(loadsToWrite({ ...base, tools: ['Read'], mcp: ['github'] }, 'worker')).toEqual({ tools: ['Read'], mcp: ['github'] });
    expect(loadsToWrite(defaultLoads('ceo'), 'ceo')).toBeUndefined();
    expect(loadsToWrite(base, 'ceo')).toEqual({ tools: base.tools });
  });

  it('names the servers the proposal gives people, and summarises a person only when they differ', () => {
    expect(mcpNamed([{ loads: { mcp: ['b', 'a'] } }, { loads: { mcp: ['a'] } }, {}])).toEqual(['a', 'b']);
    expect(loadsSummary({ ...worker })).toBeNull();
    expect(loadsSummary({ ...worker, loads: { skills: true, mcp: ['github'] } })).toBe('Skills on; MCP github.');
    expect(loadsSummary({ ...worker, loads: { tools: ['Read', 'Grep'] } })).toBe('Tools Read, Grep.');
  });

  it('edits the loads of a person through the proposal: set, cleared, or left alone when the edit has none', () => {
    const proposal = demoProposalView(NOW).proposal as OrgProposal;
    const person = proposal.people.find((p) => p.level === 'worker');
    if (!person) throw new Error('the demo proposal has no worker');
    const edit = { name: person.name, title: person.title, room: person.room, reportsTo: person.reportsTo, model: person.model, owns: person.owns };
    const set = editPerson(proposal, person.id, { ...edit, loads: { skills: true } });
    expect(set.people.find((p) => p.id === person.id)?.loads).toEqual({ skills: true });
    const kept = editPerson(set, person.id, edit);
    expect(kept.people.find((p) => p.id === person.id)?.loads).toEqual({ skills: true });
    const cleared = editPerson(set, person.id, { ...edit, loads: undefined });
    expect(cleared.people.find((p) => p.id === person.id)).not.toHaveProperty('loads');
  });
});

describe('the demo routes', () => {
  const proposed = () => demoProposalView(NOW);

  it('takes a preset before the start: desks, models and the proposal people follow, and the spending of the view with it', () => {
    const view = presetIn(proposed(), 'thorough', NOW);
    expect(view.settings).toMatchObject({ preset: 'thorough', maxDesks: 8, models: { ceo: 'opus', head: 'opus' } });
    expect(view.spending?.preset).toBe('thorough');
    expect(view.proposal?.people.find((p) => p.level === 'head')?.model).toBe('opus');
    expect(() => presetIn(proposed(), 'huge', NOW)).toThrow(/preset must be/);
    expect(() => presetIn({ ...proposed(), phase: 'running' }, 'lean', NOW)).toThrow(/has started/);
  });

  it('sets models for one level in the settings and the proposal together', () => {
    const view = modelsIn(proposed(), { worker: 'haiku' }, NOW);
    expect(view.settings.models.worker).toBe('haiku');
    expect(view.proposal?.people.filter((p) => p.level === 'worker').every((p) => p.model === 'haiku')).toBe(true);
    expect(() => modelsIn(proposed(), {}, NOW)).toThrow(/Send the model/);
    expect(() => modelsIn(proposed(), { head: 'gpt-9' }, NOW)).toThrow(/A model is one of/);
  });

  it('sets, validates and clears a budget; the cap asks at 80% and pauses at the limit, and raising it lifts the pause', () => {
    const base = { ...demoCompanyView(NOW), pause: null };
    const spent = base.spend.byPerson.reduce((n, p) => n + p.all, 0);
    expect(() => budgetIn(base, { company: 0 }, NOW)).toThrow(/dollar amount from \$0.01 to \$1,000,000/);
    expect(() => budgetIn(base, {}, NOW)).toThrow(/Send company or person/);
    const warn = budgetIn(base, { company: Math.ceil(spent / 0.85) }, NOW);
    expect(warn.spending?.budget.state).toBe('warning');
    expect(warn.questions.find((q) => q.budget?.at === 80)).toMatchObject({ from: THE_OFFICE });
    const paused = budgetIn(base, { company: Math.floor(spent) }, NOW);
    expect(paused.pause?.reason).toBe('budget');
    expect(paused.questions.some((q) => q.budget?.at === 100)).toBe(true);
    const raised = budgetIn(paused, { company: Math.ceil(spent * 2) }, NOW);
    expect(raised.pause).toBeNull();
    expect(raised.questions.filter((q) => q.budget && q.answer === null && q.withdrawn === null)).toEqual([]);
    expect(budgetIn(raised, { company: null }, NOW).spending?.budget.state).toBe('off');
  });

  it('acts on the office own answers: a preset, and a raised cap', () => {
    const view = proposed();
    const ask = { id: 'q-t', from: THE_OFFICE, text: 'How thorough?', options: ['Lean', 'Balanced', 'Thorough'], recommended: 1, taskId: null, askedAt: NOW, answer: { option: 0, text: 'Lean', at: NOW, appliesAt: NOW }, withdrawn: null, preset: true };
    expect(officeAnswerIn({ ...view, questions: [ask] }, ask, NOW).settings.preset).toBe('lean');
  });
});
