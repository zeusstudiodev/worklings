// v0.2's asks, checks, pages and handover in the browser: what a recommendation, a default and a batch say, how a check's
// result is worded, the page line of a person and the end card's content. Pure view models.
import { describe, expect, it } from 'vitest';
import type { Approval, CompanyView, Question } from '../src/core/company.ts';
import { adviceLines, batchCards, batchResultLine, byDefaultLine, ifNoAnswer } from '../web/src/company/inbox/asksModel.ts';
import { handoverOf } from '../web/src/company/inbox/handoverModel.ts';
import { checkWords } from '../web/src/company/plan/checkModel.ts';
import { pageLine } from '../web/src/company/person/personModel.ts';
import { sizeWords } from '../web/src/company/spending/spendingModel.ts';

const NOW = Date.UTC(2026, 10, 13, 14, 0);
const clock = (at: number): string => new Date(at).toISOString().slice(11, 16);

const people = [
  { id: 'ceo', name: 'Noor', title: 'CEO', level: 'ceo', room: 'direction', reportsTo: null },
  { id: 'kai', name: 'Kai', title: 'UI designer', level: 'worker', room: 'design', reportsTo: 'ceo' },
];

const question = (over: Partial<Question> = {}): Question => ({
  id: 'q-1', from: 'kai', text: 'Cards or a list?', options: ['Cards', 'A list'], recommended: 0, taskId: null, askedAt: NOW, answer: null, withdrawn: null, ...over,
});
const approval = (over: Partial<Approval> = {}): Approval =>
  ({ id: 'a-1', person: 'kai', tool: 'Bash', summary: 'Push the work branch', detail: 'git push', kind: 'push', askedAt: NOW, expiresAt: NOW + 600_000, alwaysRule: null, answer: null, withdrawn: null, ...over }) as Approval;
const company = (over: Partial<CompanyView> = {}): CompanyView => ({ people, questions: [], approvals: [], tasks: [], reports: [], ...over }) as unknown as CompanyView;

describe('what happens when nobody answers', () => {
  it('says a safe question takes the pick at a time, and any other counts as a no with what the asker does', () => {
    const c = company();
    expect(ifNoAnswer(c, question({ safe: true, defaultAt: NOW + 600_000 }))).toContain('Kai takes the pick, “Cards”, at ');
    const no = ifNoAnswer(c, question({ safe: false, defaultAt: NOW + 600_000, fallback: 'carries on with the simplest version' }));
    expect(no).toMatch(/counts as a no\. Kai then: carries on with the simplest version\.$/);
    expect(ifNoAnswer(c, question())).toBeNull();
    expect(ifNoAnswer(c, question({ safe: true, defaultAt: NOW, answer: { option: 0, text: 'Cards', at: NOW, appliesAt: NOW } }))).toBeNull();
  });

  it('says the answer the office gave because nobody did', () => {
    const q = question({ answer: { option: 1, text: 'A list', at: NOW, appliesAt: NOW, byDefault: true } });
    expect(byDefaultLine(company(), q)).toMatch(/^You didn't answer, so Kai took the pick, “A list”, at /);
    expect(byDefaultLine(company(), question({ answer: { option: 1, text: 'A list', at: NOW, appliesAt: NOW } }))).toBeNull();
  });
});

describe('the advice on a request for approval', () => {
  it('words the recommendation, why, and that no answer is a no with what the person does instead', () => {
    const a = approval({ advice: { recommend: 'deny', why: 'It would publish outside the company', fallback: 'keeps the branch local and carries on', ifNoAnswer: 'deny' } });
    const lines = adviceLines(company(), a);
    expect(lines?.recommend).toBe('The office suggests saying no.');
    expect(lines?.why).toBe('It would publish outside the company.');
    expect(lines?.ifNoAnswer).toBe("If you don't answer, it is a no. Kai then: keeps the branch local and carries on.");
    expect(adviceLines(company(), approval())).toBeNull();
    expect(adviceLines(company(), approval({ advice: { recommend: 'allow', why: 'x', fallback: 'y', ifNoAnswer: 'deny' } }))?.recommend).toBe('The office suggests allowing it once.');
  });
});

describe('asks raised together', () => {
  it('makes one card for a batch of two or more, saying what the press does for each, and leaves single asks alone', () => {
    const c = company({
      questions: [question({ id: 'q-1', batch: 'b-1' }), question({ id: 'q-2', text: 'Which font?', recommended: null, batch: 'b-1' })],
      approvals: [approval({ id: 'a-1', batch: 'b-1', advice: { recommend: 'allow', why: 'Inside the project', fallback: 'waits', ifNoAnswer: 'deny' } }), approval({ id: 'a-2', summary: 'Delete a branch' })],
      batches: [
        { id: 'b-1', at: NOW, items: [{ kind: 'question', id: 'q-1' }, { kind: 'question', id: 'q-2' }, { kind: 'approval', id: 'a-1' }] },
        { id: 'a-2', at: NOW, items: [{ kind: 'approval', id: 'a-2' }] },
      ],
    });
    const cards = batchCards(c);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe('Three asks raised together.');
    expect(cards[0]?.answers).toBe(2);
    expect(cards[0]?.rows.map((r) => r.does)).toEqual(['Answers “Cards”.', 'No pick, so it stays for you.', 'Allows it once.']);
    expect(batchCards(company())).toEqual([]);
  });

  it('says what the press did', () => {
    expect(batchResultLine({ answered: 2, left: 0 })).toBe('Answered 2 with the recommendations. Undo stays a few seconds on each.');
    expect(batchResultLine({ answered: 2, left: 1 })).toMatch(/One has no pick and waits for you\.$/);
    expect(batchResultLine({ answered: 1, left: 3 })).toMatch(/3 have no pick and wait for you\.$/);
  });
});

describe('a task check', () => {
  const owner = { name: 'Sam', title: 'Frontend engineer' };
  const check = (state: 'pending' | 'running' | 'passed' | 'failed' | 'unrunnable', runs = 1, tail = '') => ({ check: { command: 'npm test', state, runs, at: NOW, tail } });

  it('words each state, a failure naming who the task went back to', () => {
    expect(checkWords(check('passed'), owner)).toMatchObject({ tag: 'Check passed', sentence: 'The check passed.' });
    expect(checkWords(check('passed', 2), owner)?.sentence).toBe('The check passed on its 2nd run, after the task went back to Sam.');
    expect(checkWords(check('failed', 1, 'AssertionError: nope'), owner)).toMatchObject({ tag: 'Check failed', sentence: 'The check failed on its 1st run, so the task went back to Sam.', tail: 'AssertionError: nope' });
    expect(checkWords(check('running'), owner)?.tag).toBe('Check running');
    expect(checkWords(check('pending'), owner)?.tag).toBe('Check not run');
    expect(checkWords(check('unrunnable'), owner)?.sentence).toContain('a person reviews the task instead');
  });

  it('has nothing for a task with no check, and names a gone owner plainly', () => {
    expect(checkWords({}, owner)).toBeNull();
    expect(checkWords(check('failed'), undefined)?.sentence).toContain('went back to its owner');
  });
});

describe('a person’s pages', () => {
  const log = [{ at: NOW - 3_600_000, kind: 'handover', text: 'Kai started a fresh page: their notes are in .worklings/notes/kai.md.' }, { at: NOW, kind: 'handover', text: 'Kai started a fresh page: the office wrote their notes.' }];

  it('says the size of the page and since when a fresh one, from the newest handover line', () => {
    expect(pageLine({ name: 'Kai', context: { tokens: 82_400, fresh: 2 } }, log, clock)).toBe("This page holds about 82.4k tokens. On their 2nd fresh page since 14:00: the old one's notes carry over.");
    expect(pageLine({ name: 'Kai', context: { tokens: null, fresh: 1 } }, [], clock)).toBe("On a fresh page: the old one's notes carry over.");
    expect(pageLine({ name: 'Kai', context: { tokens: 900, fresh: 0 } }, log, clock)).toBe('This page holds about 900 tokens.');
    expect(pageLine({ name: 'Kai' }, log, clock)).toBeNull();
    expect(pageLine({ name: 'Kai', context: { tokens: null, fresh: 0 } }, log, clock)).toBeNull();
  });
});

describe('the size the CEO chose', () => {
  it('says it in everyday words, and nothing for a proposal that declared none', () => {
    expect(sizeWords('small')).toBe('A small company: the CEO and one maker, no heads and no QA or reviewer seat.');
    expect(sizeWords('large')).toContain('with heads only when more than 6 makers need briefing');
    expect(sizeWords(undefined)).toBeNull();
  });
});

describe('the end card', () => {
  const base = {
    people,
    settings: { billing: 'plan' },
    spending: { budget: { spent: 4.2 }, job: { low: 3.1, high: 9.4 } },
    reports: [{ id: 'r-1', person: 'ceo', to: '@stakeholder', taskId: null, outcome: 'done', text: 'Built a plant app.\n\nOpen it with npm run dev.\n\nNot done: German copy.', at: NOW + 1_000 }],
    tasks: [],
  };

  it('is nothing while the company works', () => {
    expect(handoverOf({ ...base, done: null } as never)).toBeNull();
  });

  it('says the CEO is writing it before there is one, and never shows an older report as the handover', () => {
    const old = { ...base, done: NOW + 5_000 };
    expect(handoverOf(old as never)).toMatchObject({ state: 'waiting', paragraphs: [] });
  });

  it('shows the handover the CEO wrote in the end check’s own turn, which the office marks done a moment later', () => {
    const work = { id: 't-1', status: 'done', createdAt: NOW - 60_000, updatedAt: NOW - 30_000 };
    const endCheck = { id: 't-2', status: 'done', createdAt: NOW, updatedAt: NOW + 900, followUp: { kind: 'end-check', verification: 't-2', items: [] } };
    // The handover came at NOW + 1 s, in the end check's turn; the plan was marked done when that turn ended, 4 s later.
    expect(handoverOf({ ...base, tasks: [work, endCheck], done: NOW + 5_000 } as never)).toMatchObject({ state: 'written', writtenAt: NOW + 1_000 });
    // A report from before the end check is still not the handover.
    const later = { ...endCheck, createdAt: NOW + 2_000 };
    expect(handoverOf({ ...base, tasks: [work, later], done: NOW + 5_000 } as never)).toMatchObject({ state: 'waiting' });
    // Once the end check's failures went to a re-check, the handover is asked for after the plan is done.
    const recheck = { id: 't-3', status: 'done', createdAt: NOW + 500, updatedAt: NOW + 800, followUp: { kind: 'recheck', verification: 't-2', items: [] } };
    expect(handoverOf({ ...base, tasks: [work, endCheck, recheck], done: NOW + 5_000 } as never)).toMatchObject({ state: 'waiting' });
  });

  it('shows the CEO’s words by paragraph with the cost against the estimate', () => {
    const h = handoverOf({ ...base, done: NOW } as never);
    expect(h?.state).toBe('written');
    expect(h?.paragraphs).toEqual(['Built a plant app.', 'Open it with npm run dev.', 'Not done: German copy.']);
    expect(h?.cost).toBe('$4.20 so far (API-equivalent, not a bill), against an estimate of $3.10 to $9.40.');
    expect(h?.by).toBe('Noor');
    expect(h?.checklist).toBeNull();
  });

  it('leads with the checklist the final review marked, and has none for a plan without one', () => {
    const checklist = {
      version: 1,
      rows: [{ id: 'k-1', text: 'The page says whether to swim.', quote: null, covers: ['p-1'], state: 'met', verdict: null, tasks: [] }],
      counts: { met: 1, partly: 0, 'not-met': 0, unchecked: 0 },
      reviewedAt: NOW,
    };
    expect(handoverOf({ ...base, done: NOW, checklist } as never)?.checklist).toEqual(checklist);
    expect(handoverOf({ ...base, done: NOW, checklist: { ...checklist, rows: [] } } as never)?.checklist).toBeNull();
    expect(handoverOf({ ...base, done: NOW + 5_000, checklist } as never)).toMatchObject({ state: 'waiting', checklist });
  });
});
