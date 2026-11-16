// A proposal person with no model gets the spending plan's: the CEO on Opus and everyone else on Sonnet, as aliases the
// user's Claude Code resolves (never a dated id), unless the company's models by level say otherwise.
import { describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { checkProposal } from '../src/core/org.ts';
import { orgOps } from '../src/org/index.ts';
import { cafeProposal, personOf } from './org-kit.ts';

const ops = orgOps(loadLibrary());
const modelsOf = (result: ReturnType<typeof ops.check>): Record<string, string> => {
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return Object.fromEntries(result.proposal.people.map((p) => [p.id, p.model]));
};

/** The café org with every person's model left out, as a CEO that takes the preset's writes it. */
const bare = () => {
  const proposal = cafeProposal();
  for (const p of proposal.people) delete (p as { model?: unknown }).model;
  return proposal;
};

describe('the models of a proposal’s people', () => {
  it('default to the CEO on Opus and everyone else on Sonnet when none is given', () => {
    const models = modelsOf(ops.check(bare(), { preset: 'thorough' }));
    expect(models.ceo).toBe('opus');
    expect(Object.entries(models).filter(([id]) => id !== 'ceo').every(([, m]) => m === 'sonnet')).toBe(true);
    expect(Object.keys(models)).toHaveLength(18);
  });

  it('take an `inherit` from the CEO as no model, since it writes that out of habit', () => {
    const proposal = cafeProposal();
    for (const p of proposal.people) p.model = 'inherit';
    const models = modelsOf(ops.check(proposal, { preset: 'thorough' }));
    expect(models.ceo).toBe('opus');
    expect(models['ui-designer']).toBe('sonnet');
  });

  it('keep a model the CEO names, and the stakeholder’s own `inherit`', () => {
    const proposal = bare();
    personOf(proposal, 'qa-engineer').model = 'haiku';
    personOf(proposal, 'ui-designer').model = 'opus';
    const kept = modelsOf(ops.check(proposal, { preset: 'thorough' }));
    expect([kept['qa-engineer'], kept['ui-designer']]).toEqual(['haiku', 'opus']);
    const edited = bare();
    personOf(edited, 'ui-designer').model = 'inherit';
    const mine = modelsOf(ops.check(edited, { enforceSize: false }));
    expect(mine['ui-designer']).toBe('inherit');
    // A person the stakeholder left without one still gets the default.
    expect(mine['qa-engineer']).toBe('sonnet');
  });

  it('follow the company’s models by level, for every level', () => {
    const proposal = bare();
    const models = modelsOf(ops.check(proposal, { preset: 'thorough', models: { ceo: 'sonnet', head: 'opus', lead: 'haiku', worker: 'opus' } }));
    const byLevel: Record<string, string> = { ceo: 'sonnet', head: 'opus', lead: 'haiku', worker: 'opus' };
    const level = (id: string): string => String(proposal.people.find((p) => p.id === id)?.level ?? 'worker');
    for (const [id, model] of Object.entries(models)) expect(model).toBe(byLevel[level(id)]);
  });

  it('are aliases Claude Code resolves, never a dated model id, and a name it does not know is refused', () => {
    expect(Object.values(modelsOf(ops.check(bare(), { preset: 'thorough' }))).every((m) => ['opus', 'sonnet', 'haiku', 'inherit'].includes(m))).toBe(true);
    const proposal = cafeProposal();
    personOf(proposal, 'ui-designer').model = 'claude-sonnet-5-5-20260101';
    const refused = ops.check(proposal, { preset: 'thorough' });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : refused.errors[0]).toContain('model: expected one of inherit, sonnet, opus, haiku or left out');
  });

  it('check the same in the browser’s copy of the rules, which has no library to ask', () => {
    const result = checkProposal(bare(), { libraryRoles: new Set(loadLibrary().roles.keys()), enforceSize: false });
    expect(result.ok && result.proposal.people.find((p) => p.id === 'ceo')?.model).toBe('opus');
  });
});
