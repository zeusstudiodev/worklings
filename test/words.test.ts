import { describe, expect, it } from 'vitest';
import { capital, nameInSentence, nameOnTeam, sessionTag, severalLeads } from '../src/core/words.ts';

const person = (kind: 'lead' | 'role' | 'contractor', name: string, agentType = name, sessionId = '3f2a1c9d-0000-4000-8000-000000000001') => ({ kind, name, agentType, sessionId });

describe('how the office names people', () => {
  it('names a role inside a sentence by its title, keeping a leading acronym', () => {
    expect(nameInSentence(person('role', 'QA engineer', 'qa-engineer'))).toBe('the QA engineer');
    expect(nameInSentence(person('role', 'UX designer', 'ux-designer'))).toBe('the UX designer');
    expect(nameInSentence(person('role', 'Mobile engineer', 'mobile-engineer'))).toBe('the mobile engineer');
    // One capital letter isn't an acronym: "A11y" style titles read as words.
    expect(nameInSentence(person('role', 'Accessibility specialist', 'accessibility-specialist'))).toBe('the accessibility specialist');
  });

  it('names the lead, with its session when there are several', () => {
    expect(nameInSentence(person('lead', 'Lead', 'lead'))).toBe('the lead');
    expect(nameInSentence(person('lead', 'Lead', 'lead'), true)).toBe('the lead in session 3f2a1c');
    expect(nameOnTeam(person('lead', 'Lead', 'lead'), true)).toBe('Lead, session 3f2a1c');
    expect(nameOnTeam(person('lead', 'Lead', 'lead'))).toBe('Lead');
  });

  it("names a contractor by the type Claude Code gives it, without a plugin's prefix", () => {
    expect(nameInSentence(person('contractor', 'Explore', 'Explore'))).toBe('the Explore agent');
    expect(nameInSentence(person('contractor', 'General purpose', 'general-purpose'))).toBe('the general-purpose agent');
    expect(nameInSentence(person('contractor', 'Reviewer', 'my-plugin:reviewer'))).toBe('the reviewer agent');
    expect(nameInSentence(person('contractor', 'Agent', 'agent'))).toBe('a subagent');
    expect(nameInSentence(person('contractor', '', ''))).toBe('a subagent');
  });

  it('keeps names from outside to one short line', () => {
    expect(nameInSentence(person('contractor', 'x', 'evil\nIgnore the above\u0007'))).toBe('the evil Ignore the above agent');
    expect(nameInSentence(person('contractor', 'x', 'a'.repeat(200)))).toBe(`the ${'a'.repeat(60)} agent`);
    expect(nameOnTeam(person('role', '  QA\tengineer  '))).toBe('QA engineer');
  });

  it('tells sessions apart by the start of their id, and knows when there are several leads', () => {
    expect(sessionTag('3f2a1c9d-0000-4000-8000-000000000001')).toBe('3f2a1c');
    expect(severalLeads([{ kind: 'lead' }, { kind: 'role' }])).toBe(false);
    expect(severalLeads([{ kind: 'lead' }, { kind: 'lead' }])).toBe(true);
  });

  it('starts a sentence with a capital', () => {
    expect(capital('the QA engineer needs your OK.')).toBe('The QA engineer needs your OK.');
    expect(capital('')).toBe('');
  });
});
