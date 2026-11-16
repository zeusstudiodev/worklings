import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET, MODEL_LEVELS, outsideRange, PRESET_IDS, presetGuidance, presetModels, PRESETS } from '../src/core/presets.ts';
import { budgetLevel, cleanBudget, estimateJob, JOB_BASIS, liveRate, LIVE_FLOOR_MS, LIVE_WINDOW_MS, multipleWords, presetInfos, typicalPeople, WARN_AT } from '../src/core/spending.ts';

const MIN = 60_000;

describe('the presets', () => {
  it('are Lean, Balanced and Thorough, with Balanced the default', () => {
    expect(PRESET_IDS).toEqual(['lean', 'balanced', 'thorough']);
    expect(DEFAULT_PRESET).toBe('balanced');
  });

  it('grow in team, desks and care, and none runs anyone on a small model', () => {
    const [lean, balanced, thorough] = PRESET_IDS.map((id) => PRESETS[id]);
    if (!lean || !balanced || !thorough) throw new Error('missing preset');
    expect(lean.team.max).toBeLessThan(balanced.team.max);
    expect(balanced.team.max).toBeLessThan(thorough.team.max);
    expect(lean.desks).toBeLessThan(balanced.desks);
    expect(balanced.desks).toBeLessThan(thorough.desks);
    // Robin, 13 Nov 2026: the CEO on Opus and everyone else on Sonnet by default; Thorough adds Opus for the heads.
    for (const p of [lean, balanced, thorough]) {
      expect(p.models.ceo).toBe('opus');
      expect(p.models.worker).toBe('sonnet');
      expect(Object.values(p.models)).not.toContain('haiku');
    }
    expect(balanced.models).toEqual({ ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' });
    expect(thorough.models.head).toBe('opus');
    // Testing and review fold away in Lean and Balanced (makers test their own work, the office runs each task's check and
    // one independent review comes at the end), and only Thorough has seats for them.
    expect([lean.qa, lean.review]).toEqual(['folded', 'folded']);
    expect([balanced.qa, balanced.review]).toEqual(['folded', 'folded']);
    expect([thorough.qa, thorough.review]).toEqual(['separate', 'separate']);
    expect([lean.checkers, balanced.checkers, thorough.checkers]).toEqual([0, 0, 2]);
    // The spec's "at most 4 or 5 roles at once" holds for the default.
    expect(balanced.desks).toBeLessThanOrEqual(5);
  });

  it('cap the size: Lean small or medium with up to 3 makers, Balanced and Thorough any size', () => {
    expect(PRESETS.lean.sizes).toEqual(['small', 'medium']);
    expect(PRESETS.lean.maxMakers).toBe(3);
    expect(PRESETS.balanced.sizes).toEqual(['small', 'medium', 'large']);
    expect(PRESETS.thorough.sizes).toEqual(['small', 'medium', 'large']);
  });

  it('use aliases Claude Code resolves, never a dated model id', () => {
    for (const id of PRESET_IDS) for (const level of MODEL_LEVELS) expect(['sonnet', 'opus', 'haiku', 'inherit']).toContain(PRESETS[id].models[level]);
  });

  it('hand out their models as a copy, so one company cannot change the table', () => {
    const models = presetModels('lean');
    models.ceo = 'haiku';
    expect(PRESETS.lean.models.ceo).toBe('opus');
  });

  it('say when an org is under or over a range, counting the CEO', () => {
    expect(outsideRange('lean', 2)).toBeNull();
    expect(outsideRange('lean', 4)).toBeNull();
    expect(outsideRange('lean', 5)).toBe('over');
    expect(outsideRange('balanced', 2)).toBe('under');
    expect(outsideRange('balanced', 10)).toBeNull();
    expect(outsideRange('thorough', 5)).toBe('under');
    expect(outsideRange('thorough', 25)).toBeNull();
  });
});

describe('what the CEO is told about the preset', () => {
  it('names the preset, the sizes it allows, its desks, how testing and review are staffed and where to say why', () => {
    const lines = presetGuidance('lean', true).join('\n');
    expect(lines).toContain('Lean');
    expect(lines).toContain("the stakeholder's choice");
    expect(lines).toContain('small or medium');
    expect(lines).toContain('Lean stops at medium, with up to 3 makers');
    expect(lines).toContain('Up to 3 work at once');
    expect(lines).toContain('no QA or reviewer seat');
    expect(lines).toContain('you check the result yourself at the end');
    expect(lines).toContain('sizing');
    expect(lines).toContain('Lean: ');
  });

  it('describes Balanced as makers testing their own work, the office running each task check and one review at the end', () => {
    const lines = presetGuidance('balanced', true).join('\n');
    expect(lines).toContain("Makers test their own work, the office runs each task's check, and one independent review of the whole result happens at the end");
    expect(lines).toContain('no QA or reviewer seat working alongside');
    expect(lines).not.toMatch(/its own seat|independent QA person/i);
    expect(lines).toContain('small, medium or large');
  });

  it('says the default is only the default until the stakeholder chooses', () => {
    expect(presetGuidance('balanced', false).join('\n')).toContain('the default until the stakeholder chooses');
  });

  it('allows a checker seat in Thorough, one in a medium company and up to two in a large one, and still no test tasks', () => {
    const lines = presetGuidance('thorough', true).join('\n');
    expect(lines).toContain('A checker seat');
    expect(lines).toContain('one in a medium company, up to two in a large one');
    expect(lines).toContain('tests are never a task of their own');
  });

  it('lists the models as set, so a changed level reaches the CEO', () => {
    expect(presetGuidance('balanced', true, { ceo: 'opus', head: 'opus', lead: 'sonnet', worker: 'haiku' }).join('\n')).toContain('head opus, lead sonnet, worker haiku');
  });
});

describe('what each preset costs', () => {
  const infos = presetInfos();
  const by = Object.fromEntries(infos.map((i) => [i.id, i]));

  it('rises from Lean to Thorough, an hour and for the whole job', () => {
    expect(by.lean?.perHour).toBeLessThan(by.balanced?.perHour ?? 0);
    expect(by.balanced?.perHour).toBeLessThan(by.thorough?.perHour ?? 0);
    const mid = (id: string) => ((by[id]?.job.low ?? 0) + (by[id]?.job.high ?? 0)) / 2;
    expect(mid('lean')).toBeLessThan(mid('balanced'));
    expect(mid('balanced')).toBeLessThan(mid('thorough'));
  });

  it('measures multiples against Balanced', () => {
    expect(by.balanced?.multiple).toBe(1);
    expect(by.lean?.multiple).toBeLessThan(1);
    expect(by.thorough?.multiple).toBeGreaterThan(1.5);
    expect(multipleWords(1)).toBe('the default cost');
    expect(multipleWords(0.4)).toBe("about 0.4x Balanced's cost");
  });

  it('gives each a range, not one figure', () => {
    for (const i of infos) expect(i.job.low).toBeLessThan(i.job.high);
  });

  it('prices every person as the override when ANTHROPIC_MODEL runs everyone', () => {
    const forced = presetInfos({ modelOverride: 'haiku' });
    const normal = by.balanced?.perHour ?? 0;
    expect(forced.find((i) => i.id === 'balanced')?.perHour).toBeLessThan(normal / 5);
    // With one model for all, the preset's models no longer separate Balanced from Thorough per person.
    const hourly = forced.map((i) => i.perHour);
    expect(hourly[0]).toBeLessThan(hourly[2] ?? 0);
  });

  it('rests on the typical team: heads and workers beside the CEO', () => {
    const people = typicalPeople('thorough');
    expect(people[0]).toEqual({ level: 'ceo', model: 'opus' });
    expect(people.filter((p) => p.level === 'head')).toHaveLength(2);
    expect(people).toHaveLength(14);
  });
});

describe('the whole job', () => {
  const team = typicalPeople('balanced');

  it('counts a plan’s tasks when there is one, and says so', () => {
    const job = estimateJob({ people: team, maxDesks: 5, tasks: 20, from: 'proposal' });
    expect(job?.basis).toBe('plan');
    expect(job?.tasks).toEqual({ low: 20, high: 20 });
    expect(job?.lines.join(' ')).toContain("the plan's 20 tasks");
  });

  it('assumes tasks per person from a proposal or the preset, and says that too', () => {
    const fromProposal = estimateJob({ people: team, maxDesks: 5, tasks: null, from: 'proposal' });
    const fromPreset = estimateJob({ people: team, maxDesks: 5, tasks: null, from: 'preset' });
    expect(fromProposal?.basis).toBe('proposal');
    expect(fromPreset?.basis).toBe('preset');
    expect(fromProposal?.tasks).toEqual({ low: 6 * JOB_BASIS.tasksPerPerson.low, high: 6 * JOB_BASIS.tasksPerPerson.high });
    expect(fromPreset?.lines.join(' ')).toContain("preset's typical team");
  });

  it('is honest that it is rough, and what it rests on', () => {
    const text = estimateJob({ people: team, maxDesks: 5, tasks: null, from: 'preset' })?.lines.join(' ') ?? '';
    expect(text).toContain('rough guide');
    expect(text).toContain(`${JOB_BASIS.minutesPerTask.low} to ${JOB_BASIS.minutesPerTask.high} minutes of work a task`);
    expect(text).toContain('Spend dashboard');
  });

  it('costs more for more tasks and for dearer models, and less for a smaller plan', () => {
    const small = estimateJob({ people: team, maxDesks: 5, tasks: 6, from: 'proposal' });
    const big = estimateJob({ people: team, maxDesks: 5, tasks: 30, from: 'proposal' });
    expect(big?.high ?? 0).toBeGreaterThan((small?.high ?? 0) * 3);
    const opus = team.map((p) => ({ ...p, model: 'opus' }));
    expect(estimateJob({ people: opus, maxDesks: 5, tasks: 30, from: 'proposal' })?.low ?? 0).toBeGreaterThan(big?.low ?? 0);
  });

  it('takes longer on the clock with fewer desks', () => {
    const wide = estimateJob({ people: team, maxDesks: 8, tasks: 30, from: 'proposal' });
    const narrow = estimateJob({ people: team, maxDesks: 2, tasks: 30, from: 'proposal' });
    expect(narrow?.hours.high ?? 0).toBeGreaterThan(wide?.hours.high ?? 0);
  });

  it('has no estimate for a CEO with nobody to do the work', () => {
    expect(estimateJob({ people: [{ level: 'ceo', model: 'opus' }], maxDesks: 5, tasks: null, from: 'preset' })).toBeNull();
  });
});

describe('the live cost an hour', () => {
  const now = 10 * 60 * 60_000;

  it('is zero before any turn has ended', () => {
    expect(liveRate([], now)).toEqual({ perHour: 0, windowMinutes: 5 });
  });

  it('divides what ended in the last quarter hour by the quarter hour', () => {
    const rate = liveRate([{ at: now - 60 * MIN, cost: 5 }, { at: now - 10 * MIN, cost: 0.5 }, { at: now - 2 * MIN, cost: 0.25 }], now);
    expect(rate.windowMinutes).toBe(LIVE_WINDOW_MS / MIN);
    expect(rate.perHour).toBeCloseTo(3, 6);
  });

  it('keeps a young company to a floor, so one turn is not an hourly rate', () => {
    const rate = liveRate([{ at: now - 1 * MIN, cost: 0.1 }], now);
    expect(rate.windowMinutes).toBe(LIVE_FLOOR_MS / MIN);
    expect(rate.perHour).toBeCloseTo(1.2, 6);
  });

  it('ignores a cost that is not a number', () => {
    expect(liveRate([{ at: now - MIN, cost: Number.NaN }, { at: now - MIN, cost: -3 }], now).perHour).toBe(0);
  });
});

describe('the budget thresholds', () => {
  it('warns at 80% and pauses at all of it, counted in cents', () => {
    expect(WARN_AT).toBe(0.8);
    expect(budgetLevel(7.99, 10)).toBe('ok');
    expect(budgetLevel(8, 10)).toBe('warning');
    expect(budgetLevel(9.99, 10)).toBe('warning');
    expect(budgetLevel(10, 10)).toBe('paused');
    expect(budgetLevel(10.4, 10)).toBe('paused');
    // 0.1 + 0.2 is 0.30000000000000004 in floats: it still reaches a $0.30 cap, and a cent short does not.
    expect(budgetLevel(0.1 + 0.2, 0.3)).toBe('paused');
    expect(budgetLevel(0.29, 0.3)).toBe('warning');
  });

  it('takes a dollar amount to the cent, within limits, and nothing else', () => {
    expect(cleanBudget(50)).toBe(50);
    expect(cleanBudget(12.345)).toBe(12.35);
    expect(cleanBudget(0.01)).toBe(0.01);
    expect(cleanBudget(0)).toBeNull();
    expect(cleanBudget(-5)).toBeNull();
    expect(cleanBudget(1_000_001)).toBeNull();
    expect(cleanBudget(Number.NaN)).toBeNull();
    expect(cleanBudget(Number.POSITIVE_INFINITY)).toBeNull();
    expect(cleanBudget('50')).toBeNull();
    expect(cleanBudget(null)).toBeNull();
  });
});
