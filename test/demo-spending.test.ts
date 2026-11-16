// The static demo carries a preset and a budget, so the spending plan shows without a live office.
import { describe, expect, it } from 'vitest';
import { demoCompanyView, demoFoundingView, demoPausedView, demoProposalView } from '../src/core/demo-company.ts';

const NOW = Date.UTC(2026, 10, 13, 12);

describe('the demo company’s spending plan', () => {
  it('shows the café on Thorough with a budget it is well inside, and the CEO near their own', () => {
    const view = demoCompanyView(NOW);
    expect(view.settings).toMatchObject({ preset: 'thorough', models: { ceo: 'opus', head: 'opus', lead: 'sonnet', worker: 'sonnet' }, budget: { company: 60, person: 8 } });
    const s = view.spending;
    expect(s?.preset).toBe('thorough');
    expect(s?.budget).toMatchObject({ company: 60, person: 8, state: 'ok', warnAt: 0.8 });
    expect(s?.budget.share).toBeGreaterThan(0.6);
    expect(s?.budget.people[0]).toMatchObject({ person: 'ceo', state: 'warning' });
    expect(s?.job?.basis).toBe('plan');
    expect(s?.presets).toHaveLength(3);
  });

  it('shows the proposal with the preset’s selector data and each person’s fixed prompt', () => {
    const s = demoProposalView(NOW).spending;
    expect(s?.preset).toBe('balanced');
    expect(s?.loads?.tokens).toBeGreaterThan(0);
    expect(s?.outside).toMatchObject({ side: 'over', min: 3, max: 10 });
    expect(s?.budget.state).toBe('off');
  });

  it('gives every other demo view the same fields, so the form never meets a missing one', () => {
    for (const view of [demoFoundingView(NOW), demoPausedView(NOW)]) {
      expect(view.settings.preset).toBe('balanced');
      expect(view.spending?.presets.map((p) => p.id)).toEqual(['lean', 'balanced', 'thorough']);
      expect(view.spending?.live.perHour).toBeGreaterThanOrEqual(0);
    }
  });
});
