// The CEO's size (v0.2, SPEC-v0.2.md "Better by design", 1): propose_org takes small, medium or large, and code holds the
// people to its shape under the stakeholder's preset, with the exact fix in every sentence. The stakeholder's own edit is
// held to none of it.
import { describe, expect, it } from 'vitest';
import { checkProposal, type OrgProposal } from '../src/core/org.ts';
import type { PresetId } from '../src/core/presets.ts';
import { companySize, isCheckerSeat, SIZE_RULES, sizeOfMakers } from '../src/core/size.ts';

const libraryRoles = new Set(['ceo', 'head', 'frontend-engineer', 'qa-engineer', 'code-reviewer', 'accessibility-specialist', 'team-lead']);
type Raw = Record<string, unknown>;

const person = (id: string, title: string, level: string, reportsTo: string | null, library: string): Raw => ({
  id, name: 'Sam', title, level, room: 'work', reportsTo, model: 'sonnet', owns: `The ${title.toLowerCase()}'s area.`, library,
});
const ceo = (): Raw => ({ ...person('ceo', 'CEO', 'ceo', null, 'ceo'), room: 'direction', model: 'opus' });
const maker = (n: number, reportsTo = 'ceo'): Raw => person(`maker-${n}`, `Maker ${n}`, 'worker', reportsTo, 'frontend-engineer');
const makers = (count: number, reportsTo = 'ceo'): Raw[] => Array.from({ length: count }, (_, i) => maker(i + 1, reportsTo));
const qa = (): Raw => person('qa-engineer', 'QA engineer', 'worker', 'ceo', 'qa-engineer');
const reviewer = (): Raw => person('code-reviewer', 'Code reviewer', 'worker', 'ceo', 'code-reviewer');

function org(size: unknown, people: Raw[]): Raw {
  return {
    company: 'Test Co',
    goal: 'Build the thing.',
    ...(size === undefined ? {} : { size }),
    sizing: 'Balanced: because the goal is this big.',
    theme: 'office',
    rooms: [
      { id: 'direction', title: 'Direction', style: 'direction' },
      { id: 'work', title: 'Work', style: 'engineering' },
    ],
    people,
    questions: [],
  };
}
const errorsOf = (raw: unknown, preset: PresetId = 'balanced'): string[] => {
  const result = checkProposal(raw, { libraryRoles, preset });
  return result.ok ? [] : result.errors;
};

describe('the size field', () => {
  it('is required of the CEO and must be small, medium or large', () => {
    const wanted = errorsOf(org(undefined, [ceo(), ...makers(1)]));
    expect(wanted).toHaveLength(1);
    expect(wanted[0]).toMatch(/^size: expected one of small, medium, large, got nothing; pick the one the goal needs: small is the CEO and one maker/);
    expect(errorsOf(org('huge', [ceo(), ...makers(1)]))[0]).toMatch(/^size: expected one of small, medium, large, got "huge"/);
  });

  it('is kept on the proposal, and may be left out of the stakeholder’s edit, which no size rule binds', () => {
    const result = checkProposal(org('small', [ceo(), ...makers(1)]), { libraryRoles });
    expect(result.ok && result.proposal.size).toBe('small');
    const edit = checkProposal(org(undefined, [ceo(), ...makers(4), qa(), person('head-of-x', 'Head', 'head', 'ceo', 'head')]), { libraryRoles, enforceSize: false });
    expect(edit.ok).toBe(true);
    // A size an edit carries is read, not enforced.
    expect(checkProposal(org('small', [ceo(), ...makers(3)]), { libraryRoles, enforceSize: false }).ok).toBe(true);
    expect(checkProposal(org('huge', [ceo(), ...makers(3)]), { libraryRoles, enforceSize: false }).ok).toBe(false);
  });
});

describe('a small company: the CEO and exactly one maker', () => {
  it('accepts the CEO and one maker reporting to it', () => {
    expect(errorsOf(org('small', [ceo(), ...makers(1)]))).toEqual([]);
  });

  it('refuses none, or more than one, saying which to keep and which size fits', () => {
    expect(errorsOf(org('small', [ceo(), qa()]))).toEqual([
      'people: a small company is the CEO plus exactly one maker, and this has none; add the one person who does the work, reporting to the CEO',
      'people[1] ("qa-engineer") is a QA or reviewer seat, and a small company has none: the maker tests their own work and you check the result yourself at the end; remove them',
    ]);
    expect(errorsOf(org('small', [ceo(), ...makers(3)]))).toEqual([
      'people: a small company is the CEO plus exactly one maker, and this has 3 makers ("maker-1", "maker-2" and "maker-3"); keep one and remove the rest, or set size to medium',
    ]);
    expect(errorsOf(org('small', [ceo(), ...makers(6)]))[0]).toContain('or set size to large');
  });

  it('refuses a head, a team lead and a QA or reviewer seat, each by name with the fix', () => {
    const lead = person('team-lead', 'Team lead', 'lead', 'ceo', 'team-lead');
    const head = person('head-of-x', 'Head of x', 'head', 'ceo', 'head');
    expect(errorsOf(org('small', [ceo(), ...makers(1), head, lead, reviewer()]))).toEqual([
      'people[2] ("head-of-x") is a head, and a small company is flat; make them a worker who reports to the CEO, or remove them',
      'people[3] ("team-lead") is a team lead, and leads sit only under a head in a large company; make them a worker who reports to the CEO',
      'people[4] ("code-reviewer") is a QA or reviewer seat, and a small company has none: the maker tests their own work and you check the result yourself at the end; remove them',
    ]);
  });
});

describe('a medium company: flat, the CEO and 2 to 4 makers', () => {
  it('accepts two to four makers reporting to the CEO', () => {
    for (const n of [2, 3, 4]) expect(errorsOf(org('medium', [ceo(), ...makers(n)]))).toEqual([]);
  });

  it('refuses one maker or five, saying which size fits', () => {
    expect(errorsOf(org('medium', [ceo(), ...makers(1)]))).toEqual(['people: a medium company is the CEO plus 2 to 4 makers, and this has 1 maker ("maker-1"); add a maker, or set size to small']);
    expect(errorsOf(org('medium', [ceo(), ...makers(5)]))).toEqual([
      'people: a medium company is the CEO plus 2 to 4 makers, and this has 5 makers ("maker-1", "maker-2", "maker-3", "maker-4" and "maker-5"); cut it to 4, or set size to large',
    ]);
  });

  it('refuses a head even with five makers under them, and anyone who reports to someone but the CEO', () => {
    const head = person('head-of-x', 'Head of x', 'head', 'ceo', 'head');
    expect(errorsOf(org('medium', [ceo(), head, ...makers(3, 'head-of-x')]))).toEqual([
      'people[1] ("head-of-x") is a head, and a medium company is flat; make them a worker who reports to the CEO, or remove them',
    ]);
    // Without a head, a worker under someone else is sent back to the CEO; a worker under a team lead is the lead's fault, named once.
    const lead = person('team-lead', 'Team lead', 'lead', 'ceo', 'team-lead');
    expect(errorsOf(org('medium', [ceo(), ...makers(3), { ...maker(4), id: 'maker-9', reportsTo: 'maker-1' }]))).toContain('people[4].reportsTo: "maker-1" is a worker; people report to the CEO, a head or a team lead');
    expect(errorsOf(org('medium', [ceo(), lead, ...makers(3, 'team-lead')]))).toEqual([
      'people[1] ("team-lead") is a team lead, and leads sit only under a head in a large company; make them a worker who reports to the CEO',
    ]);
  });

  it('allows one checker seat only under Thorough', () => {
    const people = [ceo(), ...makers(3), qa()];
    expect(errorsOf(org('medium', people), 'balanced')).toEqual([
      'people[4] ("qa-engineer") is a QA or reviewer seat, and Balanced has none: makers test their own work, the office runs each task\'s check, and one independent review comes at the end; remove them',
    ]);
    expect(errorsOf(org('medium', people), 'lean')[0]).toContain('Lean has none');
    expect(errorsOf(org('medium', people), 'thorough')).toEqual([]);
    expect(errorsOf(org('medium', [ceo(), ...makers(3), qa(), reviewer()]), 'thorough')).toEqual([
      'people[5] ("code-reviewer") is a QA or reviewer seat, and a medium company has at most one; remove them',
    ]);
  });
});

describe('a large company: 5 or more makers, heads only when more than 6 need briefing', () => {
  const head = (id: string): Raw => person(id, `Head ${id}`, 'head', 'ceo', 'head');
  /** Seven makers: four under the first head, three under the second. */
  const withHeads = (): Raw[] => [ceo(), head('head-a'), head('head-b'), ...makers(4, 'head-a'), ...makers(3, 'head-b').map((m, i) => ({ ...m, id: `maker-${i + 5}` }))];

  it('accepts five makers flat, and seven with two heads who brief three or more each', () => {
    expect(errorsOf(org('large', [ceo(), ...makers(5)]))).toEqual([]);
    expect(errorsOf(org('large', withHeads()))).toEqual([]);
  });

  it('refuses fewer than five makers', () => {
    expect(errorsOf(org('large', [ceo(), ...makers(3)]))).toEqual(['people: a large company has 5 or more makers, and this has 3 makers ("maker-1", "maker-2" and "maker-3"); set size to medium, or add the makers the goal needs']);
  });

  it('refuses a head while 6 makers or fewer work in it', () => {
    expect(errorsOf(org('large', [ceo(), head('head-a'), ...makers(6, 'head-a')]))).toEqual([
      'people[1] ("head-a") is a head, and a large company has a head only when more than 6 makers work in it, and this has 6; make them a worker who reports to the CEO, or remove them',
    ]);
  });

  it('refuses a head who briefs fewer than three, saying how to fix it', () => {
    const people = [ceo(), head('head-a'), head('head-b'), ...makers(5, 'head-a'), ...makers(2, 'head-b').map((m, i) => ({ ...m, id: `maker-${i + 6}` }))];
    expect(errorsOf(org('large', people))).toEqual([
      'people[2] ("head-b") is a head who briefs 2; a head briefs 3 or more: remove them and have their people report to the CEO, or move at least 1 more under them',
    ]);
  });

  it('allows a team lead under a head, and holds a room of more than six to no team lead of its own', () => {
    const lead = person('team-lead', 'Team lead', 'lead', 'head-a', 'team-lead');
    expect(errorsOf(org('large', [...withHeads(), lead]))).toEqual([]);
    // Seven makers and a head in one room is a flat shape the size allows, which the stakeholder's own edit would be asked to give a lead.
    expect(errorsOf(org('large', withHeads()))).toEqual([]);
    expect(checkProposal(org('large', withHeads()), { libraryRoles, enforceSize: false }).ok).toBe(false);
  });
});

describe('what the stakeholder’s preset allows', () => {
  it('holds Lean to small or medium, with up to 3 makers', () => {
    expect(errorsOf(org('large', [ceo(), ...makers(5)]), 'lean')).toEqual([
      'size: Lean allows small or medium companies, and you chose large; set size to medium or smaller, whichever the goal needs',
      'people: Lean allows up to 3 makers, and this has 5 (maker-1, maker-2, maker-3, maker-4 and maker-5); remove 2'.replace('(maker-1, maker-2, maker-3, maker-4 and maker-5)', '("maker-1", "maker-2", "maker-3", "maker-4" and "maker-5")'),
    ]);
    expect(errorsOf(org('medium', [ceo(), ...makers(4)]), 'lean')).toEqual(['people: Lean allows up to 3 makers, and this has 4 ("maker-1", "maker-2", "maker-3" and "maker-4"); remove 1']);
    expect(errorsOf(org('medium', [ceo(), ...makers(3)]), 'lean')).toEqual([]);
    expect(errorsOf(org('small', [ceo(), ...makers(1)]), 'lean')).toEqual([]);
  });

  it('lets Balanced pick any size, with no QA or reviewer seat at any size, and Thorough up to two', () => {
    expect(errorsOf(org('large', [ceo(), ...makers(5)]), 'balanced')).toEqual([]);
    expect(errorsOf(org('large', [ceo(), ...makers(5), qa()]), 'balanced')).toHaveLength(1);
    expect(errorsOf(org('large', [ceo(), ...makers(5), qa(), reviewer()]), 'thorough')).toEqual([]);
    expect(errorsOf(org('large', [ceo(), ...makers(5), qa(), reviewer(), person('accessibility-specialist', 'Accessibility specialist', 'worker', 'ceo', 'accessibility-specialist')]), 'thorough')).toEqual([
      'people[8] ("accessibility-specialist") is a QA or reviewer seat, and Thorough has at most 2; remove them',
    ]);
  });

  it('takes Balanced when no preset is given', () => {
    const result = checkProposal(org('medium', [ceo(), ...makers(2), qa()]), { libraryRoles });
    expect(result.ok).toBe(false);
  });

  it('reads the shape after the schema, so a mistyped manager does not also make a head look short of people', () => {
    const people = [ceo(), person('head-a', 'Head a', 'head', 'ceo', 'head'), ...makers(7, 'head-a')];
    (people[2] as Raw).reportsTo = 'head-nobody';
    const errors = errorsOf(org('large', people));
    expect(errors).toEqual(['people[2].reportsTo: "head-nobody" is not in the proposal']);
  });
});

describe('the helpers the size rules and the plan share', () => {
  it('know a checker seat by its id or its title', () => {
    expect(isCheckerSeat({ id: 'qa-engineer', title: 'Whoever' })).toBe(true);
    expect(isCheckerSeat({ id: 'x', title: 'Code reviewer' })).toBe(true);
    expect(isCheckerSeat({ id: 'accessibility-specialist', title: 'A11y' })).toBe(true);
    expect(isCheckerSeat({ id: 'frontend-engineer', title: 'Frontend engineer' })).toBe(false);
    expect(isCheckerSeat({ id: 'security-engineer', title: 'Security engineer' })).toBe(false);
  });

  it('give a company without a declared size the one its makers make up, and the declared size stands otherwise', () => {
    const people = (n: number) => [{ id: 'ceo', title: 'CEO', level: 'ceo' }, ...Array.from({ length: n }, (_, i) => ({ id: `m${i}`, title: 'Maker', level: 'worker' })), { id: 'qa-engineer', title: 'QA', level: 'worker' }];
    expect([1, 2, 4, 5, 9].map((n) => sizeOfMakers(n))).toEqual(['small', 'medium', 'medium', 'large', 'large']);
    expect(companySize(people(1), undefined)).toBe('small');
    expect(companySize(people(3), undefined)).toBe('medium');
    expect(companySize(people(6), undefined)).toBe('large');
    expect(companySize(people(6), 'small')).toBe('small');
    expect(SIZE_RULES.small.maxTasks).toBe(4);
    expect(SIZE_RULES.medium.maxTasks).toBe(10);
    expect(SIZE_RULES.large.maxTasks).toBe(30);
  });
});

describe('proposals kept from before the size existed', () => {
  it('are read as they were, with no size', () => {
    const old = org(undefined, [ceo(), ...makers(5), qa()]) as unknown as OrgProposal;
    const result = checkProposal(old, { libraryRoles, enforceSize: false });
    expect(result.ok && result.proposal.size).toBeUndefined();
  });
});
