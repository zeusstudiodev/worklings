// v0.3, "Acceptance first" (SPEC-v0.3.md, Q2): each checklist item may carry the check that accepts it, written with the
// plan: a walk on the running app, a command, or a judgement for the final review. The plan reader keeps it, refuses one the
// office couldn't run with a sentence that says how to write it, and the brief lists it for the makers.
import { describe, expect, it } from 'vitest';
import { briefOf } from '../src/company/brief.ts';
import { acceptLine, parseStep, readAccept } from '../src/core/acceptance.ts';
import { foldAll, foundedState } from '../src/core/company-state.ts';
import { checkPlan } from '../src/core/plan.ts';

const read = (raw: unknown) => {
  const problems: string[] = [];
  const accept = readAccept(raw, 'The checklist item “Votes”', (p) => problems.push(p));
  return { accept, problems };
};

describe('parseStep', () => {
  it('reads the six plain steps', () => {
    expect(parseStep('open "/books"')).toEqual({ verb: 'open', target: '/books' });
    expect(parseStep('click "Sign up"')).toEqual({ verb: 'click', target: 'Sign up' });
    expect(parseStep('fill "Email" with "pat{unique}@example.com"')).toEqual({ verb: 'fill', target: 'Email', value: 'pat{unique}@example.com' });
    expect(parseStep('select "Currency" option "CHF"')).toEqual({ verb: 'select', target: 'Currency', value: 'CHF' });
    expect(parseStep('Check "Alex"')).toEqual({ verb: 'check', target: 'Alex' });
    expect(parseStep('see "Your vote counted"')).toEqual({ verb: 'see', target: 'Your vote counted' });
  });

  it('refuses what it could not drive, saying how to write it', () => {
    expect(parseStep('press the big button')).toContain("isn't a step the office can drive");
    expect(parseStep('fill "Email"')).toContain('needs with "…"');
    expect(parseStep('click "Go" with "x"')).toContain("doesn't take");
    expect(parseStep('open "https://evil.example/"')).toContain('a path on the app');
    expect(parseStep('open "//evil.example/x"')).toContain('a path on the app');
  });
});

describe('readAccept', () => {
  it('keeps a walk, a command and a judgement', () => {
    expect(read({ kind: 'walk', page: '/', steps: ['click "Vote"', 'see "1 vote"'] })).toEqual({ accept: { kind: 'walk', page: '/', steps: ['click "Vote"', 'see "1 vote"'] }, problems: [] });
    expect(read({ kind: 'command', command: 'npm test' })).toEqual({ accept: { kind: 'command', command: 'npm test' }, problems: [] });
    expect(read({ kind: 'judgement', why: 'How it feels on a phone.' }).accept).toEqual({ kind: 'judgement', why: 'How it feels on a phone.' });
    expect(read(undefined)).toEqual({ accept: null, problems: [] });
  });

  it('refuses a walk that cannot fail, a bad step, an unsafe command and an unknown kind', () => {
    expect(read({ kind: 'walk', page: '/', steps: ['click "Vote"'] }).problems[0]).toContain('no see step');
    expect(read({ kind: 'walk', page: '/', steps: ['tap Vote', 'see "x"'] }).problems[0]).toContain("isn't a step the office can drive");
    expect(read({ kind: 'walk', page: 'http://x', steps: ['see "x"'] }).problems[0]).toContain('a path on the app');
    expect(read({ kind: 'walk', page: '/', steps: [] }).problems[0]).toContain('no steps');
    expect(read({ kind: 'command', command: 'npm test | tee out' }).problems[0]).toContain('a pipe');
    expect(read({ kind: 'magic' }).problems[0]).toContain('the kinds are walk, command and judgement');
  });

  it('reads as one line', () => {
    expect(acceptLine({ kind: 'walk', page: '/', steps: ['click "Vote"', 'see "1 vote"'] })).toBe('walk on "/": click "Vote"; see "1 vote"');
    expect(acceptLine({ kind: 'command', command: 'npm test' })).toBe('command: npm test');
  });
});

const PEOPLE = [
  { id: 'ceo', name: 'Ada', title: 'CEO', level: 'ceo' as const },
  { id: 'lea', name: 'Lea', title: 'Frontend engineer', level: 'worker' as const },
];
const PLAN = (accept: unknown) => ({
  goal: 'A book club app.',
  milestones: [{ id: 'ms-1', title: 'Votes', doneWhen: 'Members vote.' }],
  tasks: [{ id: 'p-1', title: 'Voting', owner: 'lea', files: ['src'], milestone: 'ms-1', after: [], brief: 'Votes.', doneWhen: 'Votes count.', check: 'npm test' }],
  checklist: [{ id: 'k-1', text: 'Members vote on the next read.', quote: 'vote on the next read', covers: ['p-1'], accept }],
});

describe('a plan with acceptance checks', () => {
  it('keeps each item’s check, and refuses one the office could not run', () => {
    const ok = checkPlan(PLAN({ kind: 'walk', page: '/', steps: ['click "Vote"', 'see "Your vote counted"'] }), PEOPLE, { checklist: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.plan.checklist?.[0]?.accept).toEqual({ kind: 'walk', page: '/', steps: ['click "Vote"', 'see "Your vote counted"'] });
    const bad = checkPlan(PLAN({ kind: 'walk', page: '/', steps: ['vote please'] }), PEOPLE, { checklist: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toContain('The checklist item “Members vote on the next read.”');
    // An item without one is fine: the final review judges it.
    expect(checkPlan(PLAN(undefined), PEOPLE, { checklist: true }).ok).toBe(true);
  });

  it('lists them in the brief for the makers to build against', () => {
    const plan = checkPlan(PLAN({ kind: 'walk', page: '/', steps: ['fill "Title" with "Dune"', 'click "Suggest"', 'see "Dune"'] }), PEOPLE, { checklist: true });
    if (!plan.ok) throw new Error(plan.errors.join('\n'));
    const at = Date.UTC(2026, 10, 14, 9);
    const state = foldAll(foundedState({ type: 'founded', id: 'club', name: 'Book club', root: '/p', prompt: 'A book club app.', stakeholder: 'Robin', at }), [
      { type: 'plan-version', version: { version: 1, by: 'ceo', at, plan: plan.plan, note: null, cites: [] } },
    ]);
    const brief = briefOf(state);
    expect(brief).toContain('## Acceptance checks');
    expect(brief).toContain('- k-1: walk on "/": fill "Title" with "Dune"; click "Suggest"; see "Dune"');
    expect(brief).toContain('Build so they pass as written');
  });
});
