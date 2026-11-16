// The plans the e2e fixtures have the fake CEO propose must pass the check the company holds the CEO to, or a spec that
// proposes one fails for a reason that has nothing to do with what it looks at. Options as src/company/plan.ts passes them
// for propose_plan: structure on, the checklist required (v0.2), the declared size, the Balanced preset.
import { describe, expect, test } from 'vitest';
import { checkPlan } from '../src/core/plan.ts';
import { companySize, type Size } from '../src/core/size.ts';
import { PLAN, PLAN_CONTRACTS, PLAN_V2, PROMPT, PROPOSAL, PROPOSAL_FOR_CEO } from './e2e/v3-world.ts';

// The specs run the company with the headed roster (restoreRoster in v3-kit.ts) and the size the CEO declared.
const people = PROPOSAL.people;
const size = companySize(people, PROPOSAL_FOR_CEO.size as Size);

describe('the e2e fixture plans', () => {
  test.each([
    ['PLAN', PLAN],
    ['PLAN_V2', PLAN_V2],
    ['PLAN_CONTRACTS', PLAN_CONTRACTS],
  ])('%s passes checkPlan as the CEO proposes it', (_name, plan) => {
    const check = checkPlan(plan, people, { structure: true, checklist: true, preset: 'balanced', size });
    expect(check.ok ? [] : check.errors).toEqual([]);
    // Each item quotes the e2e company's own words.
    for (const item of plan.checklist) expect(PROMPT).toContain(item.quote);
  });
});
