// The demo's spending plan: the hub's three routes (preset, models, budget) as pure changes to a company's view, with the
// hub's refusals as sentences, so the static demo and the demo company behave as the live office does. The numbers come from
// the same core functions the hub uses (src/core/spending.ts).
import { type CompanyView, type CompanySettings, type Question, STAKEHOLDER, THE_OFFICE } from '../../../../src/core/company.ts';
import { proposalLoadCosts } from '../../../../src/core/org.ts';
import { isPresetId, MODEL_LEVELS, type ModelsByLevel, PRESET_IDS, PRESETS } from '../../../../src/core/presets.ts';
import { budgetLevel, cleanBudget, multipleWords, presetInfos, spendingViewOf } from '../../../../src/core/spending.ts';
import { ROLE_MODELS, type RoleModel } from '../../../../src/core/studio.ts';
import { refused } from '../demoModel.ts';
import { capWords } from './spendingModel.ts';

const money = capWords;

/** What the demo's pretend Claude Code has installed, for the loads form's server list. */
const DEMO_INSTALLED = {
  mcp: [
    { name: 'github', summary: 'Issues, pull requests and repositories.', kind: 'remote' as const },
    { name: 'plugin:context7:context7', summary: 'Current documentation for libraries.', kind: 'local' as const },
  ],
  skills: 4,
};

/** The view's `spending`, worked out from what the view shows, as the hub does. Cheap enough to run on every change. */
export function withSpendingIn(view: CompanyView, now: number): CompanyView {
  const spentBy: Record<string, number> = {};
  for (const p of view.spend.byPerson) spentBy[p.person] = p.all;
  const asking = view.questions.find((q) => q.preset === true && q.answer === null && q.withdrawn === null);
  return {
    ...view,
    spending: spendingViewOf({
      settings: view.settings,
      phase: view.phase,
      proposal: view.proposal,
      people: view.people.map((p) => ({ id: p.id, level: p.level, model: p.model })),
      planTasks: view.tasks.length > 0 ? view.tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped').length : null,
      spentBy,
      samples: view.spend.samples,
      now,
      modelOverride: null,
      presetQuestion: asking?.id ?? null,
      loads: view.phase === 'proposed' && view.proposal ? proposalLoadCosts(view.proposal) : null,
      catalogue: DEMO_INSTALLED,
    }),
  };
}

/** The office's own "How thorough?" question, as the hub asks it when a company is founded. */
export function presetQuestionOf(view: CompanyView, id: string, now: number): Question {
  const infos = presetInfos({ billing: view.settings.billing });
  return {
    id,
    from: THE_OFFICE,
    text: 'How thorough?',
    options: infos.map((i) => `${i.label}: ${i.team.min} to ${i.team.max} people, ${multipleWords(i.multiple)}`),
    recommended: PRESET_IDS.indexOf(view.settings.preset),
    why: 'More people and more checks cost more. Balanced stands until you choose, and you can change it on the proposal.',
    taskId: null,
    askedAt: now,
    answer: null,
    withdrawn: null,
    preset: true,
  };
}

const beforeStart = (view: CompanyView): void => {
  if (view.phase !== 'founding' && view.phase !== 'proposed') {
    throw refused(409, "The company has started, so its team is set. Change the desks at once in settings, and a person's model from the org chart.", 'conflict');
  }
  if (view.starting) throw refused(409, 'The company is starting; the org is being hired now.', 'busy');
};

/** A preset before the start: its desks and models for whatever was not set by hand, the proposal's people with them. */
export function presetIn(view: CompanyView, preset: unknown, now: number): CompanyView {
  if (!isPresetId(preset)) throw refused(400, `preset must be ${PRESET_IDS.map((p) => `"${p}"`).join(' or ')}.`, 'invalid');
  beforeStart(view);
  const label = PRESETS[preset].label;
  const asks = view.questions.map((q) => (q.preset === true && q.answer === null && q.withdrawn === null ? { ...q, withdrawn: { reason: `You chose ${label}.`, at: now } } : q));
  const s = view.settings;
  if (s.preset === preset) return withSpendingIn({ ...view, questions: asks }, now);
  const was = PRESETS[s.preset];
  const next = PRESETS[preset];
  const models = { ...s.models };
  for (const level of MODEL_LEVELS) if (s.models[level] === was.models[level]) models[level] = next.models[level];
  const settings: CompanySettings = { ...s, preset, models, maxDesks: s.maxDesks === was.desks ? next.desks : s.maxDesks };
  const proposal = view.proposal && view.phase === 'proposed' ? { ...view.proposal, people: view.proposal.people.map((p) => (p.model === was.models[p.level] ? { ...p, model: models[p.level] } : p)) } : view.proposal;
  return withSpendingIn(
    {
      ...view,
      settings,
      proposal,
      questions: asks,
      desks: { ...view.desks, max: settings.maxDesks },
      log: [...view.log, { at: now, kind: 'settings', by: STAKEHOLDER, text: `You chose ${label}: ${next.team.min} to ${next.team.max} people, ${settings.maxDesks} at work at once.` }],
    },
    now,
  );
}

/** One model for everyone at a level, in the settings and in the proposal together. */
export function modelsIn(view: CompanyView, change: Partial<Record<keyof ModelsByLevel, unknown>>, now: number): CompanyView {
  beforeStart(view);
  const given = MODEL_LEVELS.filter((l) => change[l] !== undefined);
  if (given.length === 0) throw refused(400, `Send the model for a level: ${MODEL_LEVELS.join(', ')}.`, 'invalid');
  const models = { ...view.settings.models };
  for (const level of given) {
    const model = change[level];
    if (typeof model !== 'string' || !(ROLE_MODELS as readonly string[]).includes(model)) throw refused(400, `A model is one of ${ROLE_MODELS.join(', ')}.`, 'invalid');
    models[level] = model as RoleModel;
  }
  const proposal = view.proposal && view.phase === 'proposed' ? { ...view.proposal, people: view.proposal.people.map((p) => (given.includes(p.level) ? { ...p, model: models[p.level] } : p)) } : view.proposal;
  return withSpendingIn(
    { ...view, settings: { ...view.settings, models }, proposal, log: [...view.log, { at: now, kind: 'settings', by: STAKEHOLDER, text: `You set the models: ${given.map((l) => `${l} ${models[l]}`).join(', ')}.` }] },
    now,
  );
}

/** A budget, to the cent; null clears it. The company's cap pauses at the limit and asks at 80%, as the hub does. */
export function budgetIn(view: CompanyView, change: { company?: number | null; person?: number | null }, now: number, by: string = STAKEHOLDER): CompanyView {
  const keys = (['company', 'person'] as const).filter((k) => change[k] !== undefined);
  if (keys.length === 0) throw refused(400, 'Send company or person: a dollar amount, or null for none.', 'invalid');
  const next = { ...view.settings.budget };
  const lines: string[] = [];
  for (const key of keys) {
    const raw = change[key];
    const value = raw === null || raw === undefined ? null : cleanBudget(raw);
    if (raw !== null && raw !== undefined && value === null) throw refused(400, `${key} must be a dollar amount from $0.01 to $1,000,000, or null for none.`, 'invalid');
    if (value === next[key]) continue;
    next[key] = value;
    const whose = key === 'company' ? "the company's" : "each person's";
    lines.push(value === null ? `You took ${whose} budget off.` : `You set ${whose} budget to ${money(value)}.`);
  }
  if (lines.length === 0) return view;
  let out: CompanyView = { ...view, settings: { ...view.settings, budget: next }, log: [...view.log, ...lines.map((text) => ({ at: now, kind: 'settings' as const, by, text }))] };
  out = settleCompanyBudget(out, now);
  return withSpendingIn(out, now);
}

const spentOf = (view: CompanyView): number => view.spend.byPerson.reduce((n, p) => n + p.all, 0);

/** The company's cap against its spend: a notice at 80%, a pause at the cap, and both lifted when the cap allows work again. */
function settleCompanyBudget(view: CompanyView, now: number): CompanyView {
  const cap = view.settings.budget.company;
  const spent = spentOf(view);
  const level = cap === null ? 'ok' : budgetLevel(spent, cap);
  // Notices that no longer stand are taken back.
  let questions = view.questions.map((q) =>
    q.budget?.scope === 'company' && q.answer === null && q.withdrawn === null && (cap === null || q.budget.cap !== cap) ? { ...q, withdrawn: { reason: cap === null ? 'The budget was taken off.' : 'The budget changed.', at: now } } : q,
  );
  let pause = view.pause;
  let log = view.log;
  if (cap !== null && level !== 'ok') {
    const at = level === 'paused' ? 100 : 80;
    if (!questions.some((q) => q.budget?.scope === 'company' && q.budget.at === at && q.budget.cap === cap)) {
      const up = (v: number) => (v >= 10 ? Math.ceil(v) : Math.ceil(v * 100) / 100);
      const raiseTo = [up(cap * 1.5), up(cap * 2)];
      const text =
        at === 80
          ? `The company has spent ${money(spent)} of its ${money(cap)} budget, 80%. At ${money(cap)} everyone stops until you raise it.`
          : `The company's ${money(cap)} budget is spent (${money(spent)}), so nobody takes another turn; turns under way finish first. Raise the budget to carry on, or leave the company paused.`;
      questions = [
        ...questions,
        {
          id: `q-budget-${at}-${Math.round(cap * 100)}`,
          from: THE_OFFICE,
          text,
          options: [...raiseTo.map((v) => `Raise it to ${money(v)}${at === 100 ? ' and carry on' : ''}`), at === 80 ? 'Carry on' : 'Leave it paused'],
          recommended: null,
          taskId: null,
          askedAt: now,
          answer: null,
          withdrawn: null,
          budget: { scope: 'company', person: null, at, cap, raiseTo },
        },
      ];
    }
  }
  if (cap !== null && level === 'paused' && pause?.reason !== 'budget' && pause?.reason !== 'stakeholder') {
    const sentence = `Paused: the company's ${money(cap)} budget is spent. Raise it to carry on.`;
    pause = { reason: 'budget', since: now, until: null, message: sentence };
    log = [...log, { at: now, kind: 'pause', by: THE_OFFICE, text: sentence }];
  } else if (level !== 'paused' && pause?.reason === 'budget') {
    pause = null;
    log = [...log, { at: now, kind: 'resume', by: THE_OFFICE, text: 'The budget allows work again, so the company carries on.' }];
  }
  return { ...view, questions, pause, log };
}

/** An answer to one of the office's own questions, once it applies: "How thorough?" picks a preset, a budget notice raises its cap. */
export function officeAnswerIn(view: CompanyView, q: Question, now: number): CompanyView {
  const option = q.answer?.option;
  if (option === null || option === undefined) return view;
  try {
    if (q.preset === true) {
      const preset = PRESET_IDS[option];
      return preset === undefined ? view : presetIn(view, preset, now);
    }
    const raise = q.budget?.raiseTo[option];
    if (!q.budget || raise === undefined) return view;
    const current = view.settings.budget[q.budget.scope];
    return current !== null && raise <= current ? view : budgetIn(view, { [q.budget.scope]: raise }, now);
  } catch {
    // The company started before the answer took effect: it started as it was.
    return view;
  }
}
