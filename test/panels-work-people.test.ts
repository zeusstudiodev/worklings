import { describe, expect, it } from 'vitest';
import { STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import {
  called,
  findPeople,
  flatten,
  foundLine,
  introduced,
  keepsOpen,
  nameOf,
  openItems,
  ordinal,
  orgOutline,
  visitorsOf,
  workOf,
} from '../web/src/company/people/peopleModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { agent, approval, company, desk, min, NOW, person, question, report, sec, snapshotOf, studio, task, update } from './panels-work-kit.ts';

const kai = (c = company()) => c.people.find((p) => p.id === 'frontend-engineer')!;

describe('how the office names people', () => {
  it('introduces someone first and then uses their name, with the CEO always the CEO', () => {
    const c = company();
    expect(introduced(kai(c))).toBe('Kai, frontend engineer');
    expect(called(kai(c))).toBe('Kai');
    const qa = c.people.find((p) => p.id === 'qa-engineer')!;
    expect(introduced(qa)).toBe('the QA engineer');
    expect(called(qa)).toBe('the QA engineer');
    const ceo = c.people.find((p) => p.level === 'ceo')!;
    expect(introduced(ceo)).toBe('the CEO');
    expect(called(ceo)).toBe('the CEO');
  });

  it('names you and people who left the company', () => {
    const c = company();
    expect(nameOf(c, STAKEHOLDER).called).toBe('you');
    expect(nameOf(c, 'seo-specialist').called).toBe('the SEO specialist');
  });

  it('names the office as the office, not as a role called "@office"', () => {
    expect(nameOf(company(), THE_OFFICE)).toEqual({ called: 'the office', introduced: 'the office', subject: 'the office', person: null });
  });

  it('says places in line in words up to twelve, then as numerals', () => {
    expect([1, 2, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual(['first', 'second', 'twelfth', '13th', '21st', '22nd', '23rd', '111th']);
  });
});

describe('the desk-and-work table', () => {
  it('shows the status line while working, and how long it has stood once over ten minutes', () => {
    let c = update(company(), 'frontend-engineer', { desk: desk('working'), status: { person: 'frontend-engineer', text: 'Wiring the streak card to the store.', taskId: null, at: NOW - min(4) } });
    expect(workOf(c, kai(c), NOW)).toMatchObject({ kind: 'working', word: 'Working', tone: 'working', line: 'Wiring the streak card to the store.' });
    c = update(c, 'frontend-engineer', { status: { person: 'frontend-engineer', text: 'Wiring the streak card to the store.', taskId: null, at: NOW - min(12) } });
    expect(workOf(c, kai(c), NOW).line).toBe('Wiring the streak card to the store, for 12 min.');
  });

  it('says what someone is on before their first status line', () => {
    const c = update(company({ tasks: [task('t1', 'frontend-engineer', 'Build the streak card')] }), 'frontend-engineer', { desk: desk('working'), task: 't1' });
    expect(workOf(c, kai(c), NOW).line).toBe('On it: Build the streak card.');
  });

  it('puts what waits on you first, with the item to answer', () => {
    const c = update(company({ approvals: [approval('a1', 'frontend-engineer', 'Push the work branch to GitHub')] }), 'frontend-engineer', { desk: desk('working') });
    expect(workOf(c, kai(c), NOW)).toMatchObject({
      kind: 'needs-ok',
      word: 'Needs your OK',
      tone: 'needs',
      line: 'Waiting for your OK: push the work branch to GitHub. 3 min.',
      item: 'a1',
    });
    const asks = company({ questions: [question('q1', 'frontend-engineer', 'Which payment provider', ['Stripe', 'TWINT'])] });
    expect(workOf(asks, kai(asks), NOW)).toMatchObject({ word: 'Needs your answer', line: 'Waiting for your answer: Which payment provider. 2 min.', item: 'q1' });
  });

  it('forgets an approval once its hook gave up, and answered or withdrawn items', () => {
    const c = company({
      approvals: [
        approval('a1', 'frontend-engineer', 'Push', { expiresAt: NOW - sec(1) }),
        approval('a2', 'frontend-engineer', 'Push', { answer: { decision: 'allow', always: false, at: NOW - sec(2), appliesAt: NOW + sec(3), note: null } }),
      ],
      questions: [question('q1', 'frontend-engineer', 'Which?', ['A', 'B'], { withdrawn: { reason: 'Kai was stopped.', at: NOW - sec(5) } })],
    });
    expect(openItems(c, NOW)).toEqual([]);
    expect(workOf(c, kai(c), NOW).kind).toBe('off');
  });

  it('says where someone waiting for a desk is in line', () => {
    const c = update(company(), 'frontend-engineer', { desk: desk('waiting', { queue: 2 }) });
    expect(workOf(c, kai(c), NOW)).toMatchObject({ word: 'Waiting for a desk', tone: 'waiting', line: 'Has work and waits for a desk, second in line.' });
  });

  it('reads a failed turn as work for 30 seconds, then as stuck with the problem on its own line', () => {
    const failing = (since: number) =>
      update(company(), 'frontend-engineer', { desk: desk('failed', { since, problem: 'The typecheck fails in Card.tsx.' }), status: { person: 'frontend-engineer', text: 'Typechecking.', taskId: null, at: NOW - min(1) } });
    let c = failing(NOW - sec(20));
    expect(workOf(c, kai(c), NOW)).toMatchObject({ kind: 'working', line: 'Typechecking.' });
    c = failing(NOW - min(4));
    expect(workOf(c, kai(c), NOW)).toMatchObject({ kind: 'stuck', word: 'Stuck', tone: 'error', line: 'Stuck for 4 min.', problem: 'The typecheck fails in Card.tsx. Send Kai a message to try again.' });
  });

  it('says a crash behind an open question too, since answering shows nothing of it', () => {
    const q = question('q1', 'frontend-engineer', 'Which provider?', ['Stripe', 'TWINT']);
    const c = update(company({ questions: [q] }), 'frontend-engineer', { desk: desk('failed', { since: NOW - min(4), problem: 'Claude Code isn’t signed in' }) });
    const work = workOf(c, kai(c), NOW);
    expect(work).toMatchObject({ kind: 'needs-answer', word: 'Needs your answer' });
    expect(work.problem).toBe('Also stuck for 4 min. Claude Code isn’t signed in.');
    // Before 30 seconds a failed step is just work going on, so nothing is added.
    const fresh = update(company({ questions: [q] }), 'frontend-engineer', { desk: desk('failed', { since: NOW - sec(10), problem: 'x' }) });
    expect(workOf(fresh, kai(fresh), NOW).problem).toBeNull();
  });

  it('gives someone who is stuck a way on, with or without a reason', () => {
    const c = update(company(), 'qa-engineer', { desk: desk('failed', { since: NOW - min(4), problem: null }) });
    expect(workOf(c, c.people.find((p) => p.id === 'qa-engineer')!, NOW)).toMatchObject({ kind: 'stuck', problem: 'Send the QA engineer a message to try again.' });
  });

  it('gives a blocked task the blocking report’s first sentence', () => {
    const c = update(
      company({
        tasks: [task('t1', 'frontend-engineer', 'Pay with TWINT', { status: 'blocked' })],
        reports: [report('r1', 'frontend-engineer', 'frontend-lead', 'The TWINT sandbox needs a merchant id. I asked Ola for one.', { taskId: 't1', outcome: 'blocked' })],
      }),
      'frontend-engineer',
      { desk: desk('idle'), task: 't1' },
    );
    expect(workOf(c, kai(c), NOW)).toMatchObject({ kind: 'blocked', word: 'Blocked', line: 'The TWINT sandbox needs a merchant id.' });
  });

  it('says the rest of the table in words', () => {
    const at = (state: Parameters<typeof desk>[0], extra = {}) => {
      const c = update(company({ reports: [report('r1', 'frontend-engineer', 'frontend-lead', 'Done.', { at: NOW - min(40) })] }), 'frontend-engineer', { desk: desk(state, extra) });
      return workOf(c, kai(c), NOW);
    };
    expect(at('starting')).toMatchObject({ word: 'Starting', line: 'On it.' });
    expect(at('stopping')).toMatchObject({ word: 'Stopping', line: 'Stopping after this step.' });
    expect(at('idle')).toMatchObject({ word: 'Idle', line: `Done for now. Last report at ${hourMinute(NOW - min(40))}.` });
    expect(at('closed')).toMatchObject({ word: 'Off duty', line: 'Nothing assigned.' });
    expect(at('away', { since: NOW - min(20) })).toMatchObject({ word: 'In Claude Code', tone: 'rest', line: `With you in Claude Code since ${hourMinute(NOW - min(20))}.` });
  });

  it('keeps a status line from a person plain and masked', () => {
    const c = update(company(), 'frontend-engineer', { desk: desk('working'), status: { person: 'frontend-engineer', text: 'Testing with `sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD`', taskId: null, at: NOW } });
    const line = workOf(c, kai(c), NOW).line;
    expect(line).not.toContain('abcdefghijklmnop');
    expect(line).not.toContain('`');
  });
});

describe('the org as an outline', () => {
  it('puts the CEO first, then the office manager, then each head under their room’s name with their people', () => {
    const outline = flatten(orgOutline({ studio }, company()));
    expect(outline.map((n) => [n.person.id, n.depth, n.room?.name ?? null])).toEqual([
      ['ceo', 1, null],
      ['office-manager', 2, null],
      ['head-of-engineering', 2, 'Engineering'],
      ['qa-engineer', 3, null],
      ['frontend-lead', 3, null],
      ['frontend-engineer', 4, null],
      ['head-of-design', 2, 'Design'],
      ['ui-designer', 3, null],
    ]);
  });

  it('lists a studio without an org room by room', () => {
    const c = company({ people: [person('a', 'A', 'Writer', 'design'), person('b', 'B', 'Coder', 'engineering'), person('c', 'C', 'Painter', 'design')] });
    expect(flatten(orgOutline({ studio }, c)).map((n) => [n.person.id, n.depth, n.room?.name ?? null])).toEqual([
      ['a', 1, 'Design'],
      ['c', 1, null],
      ['b', 1, 'Engineering'],
    ]);
  });

  it('places everyone once, even when managers report to each other', () => {
    const c = company({ people: [person('a', 'A', 'One', 'design', { reportsTo: 'b' }), person('b', 'B', 'Two', 'design', { reportsTo: 'a' })] });
    expect(flatten(orgOutline({ studio }, c)).map((n) => n.person.id).sort()).toEqual(['a', 'b']);
  });

  it('finds people by name, title or room, without minding case or accents', () => {
    const c = update(company(), 'ui-designer', { name: 'Zoé' });
    const outline = orgOutline({ studio }, c);
    expect(findPeople({ studio }, outline, 'zoe').map((n) => n.person.id)).toEqual(['ui-designer']);
    // The frontend lead's title doesn't say engineer, but their room does.
    expect(findPeople({ studio }, outline, 'ENGINEER').map((n) => n.person.id)).toEqual(['head-of-engineering', 'qa-engineer', 'frontend-lead', 'frontend-engineer']);
    expect(findPeople({ studio }, outline, 'frontend').map((n) => n.person.id)).toEqual(['frontend-lead', 'frontend-engineer']);
    expect(findPeople({ studio }, outline, 'design').map((n) => n.person.id)).toEqual(['head-of-design', 'ui-designer']);
    expect(findPeople({ studio }, outline, '  ')).toHaveLength(8);
    expect(foundLine(4, 31)).toBe('4 of 31 people');
  });

  it('keeps a room open while someone in it works or needs you', () => {
    const quiet = company();
    const engineering = (c: typeof quiet) => orgOutline({ studio }, c)[0]!.children.find((n) => n.person.id === 'head-of-engineering')!;
    expect(keepsOpen(quiet, engineering(quiet), NOW)).toBe(false);
    const busy = update(quiet, 'frontend-engineer', { desk: desk('working') });
    expect(keepsOpen(busy, engineering(busy), NOW)).toBe(true);
    const asks = company({ questions: [question('q1', 'qa-engineer', 'Retry?', ['Yes', 'No'])] });
    expect(keepsOpen(asks, engineering(asks), NOW)).toBe(true);
  });
});

describe('visitors', () => {
  it('are sessions the company didn’t start, with v2’s words, newest first', () => {
    const c = update(company(), 'frontend-engineer', { desk: desk('working', { sessionId: 'desk-1' }), agentKey: 'desk-1:lead' });
    const agents = [
      agent('desk-1:lead', 'desk-1'),
      agent('desk-1:sub', 'desk-1', { kind: 'contractor', agentId: 'sub', agentType: 'Explore', name: 'Explore' }),
      agent('mine:lead', 'mine', { lastEventAt: NOW - min(9), status: 'idle', statusSince: NOW - min(9) }),
      agent('other:lead', 'other', { lastEventAt: NOW - min(1), costEstimate: 0.42 }),
    ];
    const rows = visitorsOf(snapshotOf(c, { agents }), c, NOW);
    expect(rows.map((r) => [r.key, r.name, r.word, r.cost])).toEqual([
      ['other:lead', 'Lead, session other', 'On it', 0.42],
      ['mine:lead', 'Lead, session mine', 'Idle', 0],
    ]);
  });
});
