// A stakeholder's edit of what a person loads is a change like any other (src/company/company.ts, proposalChanges).
import { describe, expect, it } from 'vitest';
import { proposalChanges } from '../src/company/company.ts';
import type { OrgProposal } from '../src/core/org.ts';

const proposal = (loads?: OrgProposal['people'][number]['loads']): OrgProposal => ({
  company: 'Plant Pal',
  goal: 'A plant care app.',
  theme: 'office',
  rooms: [{ id: 'engineering', title: 'Engineering', style: 'engineering' }],
  people: [
    { id: 'ceo', name: 'Juno', title: 'CEO', level: 'ceo', room: 'engineering', reportsTo: null, model: 'opus', owns: 'The company' },
    { id: 'kit', name: 'Kit', title: 'Frontend engineer', level: 'worker', room: 'engineering', reportsTo: 'ceo', model: 'sonnet', owns: 'The app', ...(loads ? { loads } : {}) },
  ],
  questions: [],
}) as OrgProposal;

describe('proposalChanges and loads', () => {
  it('counts a change to what a person loads, so the edit is stored', () => {
    expect(proposalChanges(proposal(), proposal({ mcp: ['browser-tools'] }))).toEqual(['changed Kit, frontend engineer (loads something else at their desk)']);
    expect(proposalChanges(proposal({ skills: true }), proposal())).toHaveLength(1);
  });

  it("doesn't count their level's defaults written out", () => {
    expect(proposalChanges(proposal(), proposal({ tools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'], skills: false, mcp: [] }))).toEqual([]);
  });
});
