import { describe, expect, it } from 'vitest';
import { demoCompanyView } from '../src/core/demo-company.ts';
import { deskReason, headline, inboxSentence, nowGroups, spendLine } from '../web/src/company/now/nowModel.ts';
import { approval, company, desk, min, NOW, question, report, task, update, withPeople } from './panels-work-kit.ts';

describe('the headline', () => {
  it('starts with what needs you', () => {
    expect(inboxSentence(company({ approvals: [approval('a1', 'frontend-engineer', 'Push the work branch to GitHub')] }), NOW)?.text).toBe('Kai needs your OK to push the work branch to GitHub.');
    expect(inboxSentence(company({ questions: [question('q1', 'ceo', 'Cards?', ['Yes', 'No'])] }), NOW)?.text).toBe('The CEO has a question for you.');
    expect(inboxSentence(company({ questions: [question('q1', 'ceo', 'Cards?', ['Yes', 'No']), question('q2', 'ui-designer', '15?', ['Yes', 'No'])], approvals: [approval('a1', 'frontend-engineer', 'Push')] }), NOW)?.text).toBe('Three things need you.');
    expect(inboxSentence(company({ phase: 'proposed', proposal: { company: 'Plant Pal', goal: '', theme: 'garden', rooms: [], people: [], questions: [] } }), NOW)?.text).toBe("The CEO's proposal is ready for you.");
    expect(inboxSentence(company(), NOW)).toBeNull();
  });

  it('follows with the company’s state, and while people work the latest report', () => {
    const working = update(
      company({ reports: [report('r1', 'qa-engineer', 'head-of-engineering', 'Done.', { at: NOW - min(25) })], desks: { working: 1, waiting: 0, max: 8 } }),
      'frontend-engineer',
      { desk: desk('working') },
    );
    expect(headline(working, NOW, 'One at work.')).toEqual({ needs: null, rest: ['One at work.', 'Last report 25 min ago from the QA engineer.'] });
    // Nobody at work: the state's own sentence already ends with the latest report.
    const idle = company({ reports: [report('r1', 'qa-engineer', 'head-of-engineering', 'Done.')] });
    expect(headline(idle, NOW, 'Nobody is at work. Last report 20 min ago from QA engineer.').rest).toEqual(['Nobody is at work. Last report 20 min ago from QA engineer.']);
  });

  it('leaves the latest report out when the inbox already names its author', () => {
    const c = update(
      company({ approvals: [approval('a1', 'frontend-engineer', 'Push')], reports: [report('r1', 'frontend-engineer', 'frontend-lead', 'Done.')], desks: { working: 1, waiting: 0, max: 8 } }),
      'ui-designer',
      { desk: desk('working') },
    );
    expect(headline(c, NOW, 'One at work.')).toEqual({ needs: 'Kai needs your OK to push.', rest: ['One at work.'] });
  });

  it('says a waiting proposal once', () => {
    const c = company({ phase: 'proposed', proposal: { company: 'Plant Pal', goal: '', theme: 'garden', rooms: [], people: [], questions: [] } });
    expect(headline(c, NOW, "The CEO's proposal is ready for you.")).toEqual({ needs: "The CEO's proposal is ready for you.", rest: [] });
  });

  it('says what was spent, and that it is an estimate on a plan', () => {
    const c = withPeople(company(), (people) => people.map((p, i) => ({ ...p, cost: i === 0 ? 4.2 : 0 })));
    expect(spendLine(c)).toBe('$4.20 spent, API-equivalent.');
    expect(spendLine({ ...c, settings: { ...c.settings, billing: 'api-key' } })).toBe('$4.20 spent.');
  });
});

describe('the groups', () => {
  it('puts each person in the first group that fits, with the task under the status line', () => {
    let c = company({
      tasks: [task('t1', 'frontend-engineer', 'Pickup slot picker'), task('t2', 'ui-designer', 'Slot visuals')],
      approvals: [approval('a1', 'qa-engineer', 'Push')],
      reports: [report('r1', 'office-manager', 'ceo', 'Set the office up as a café.', { outcome: 'done', at: NOW - min(5) })],
    });
    c = update(c, 'frontend-engineer', { desk: desk('working'), task: 't1', status: { person: 'frontend-engineer', text: 'Wiring the slots to the store.', taskId: 't1', at: NOW - min(2) } });
    c = update(c, 'ui-designer', { desk: desk('starting'), task: 't2' });
    c = update(c, 'qa-engineer', { desk: desk('working') });
    c = update(c, 'head-of-design', { desk: desk('failed', { since: NOW - min(4), problem: 'It failed.' }) });
    c = update(c, 'frontend-lead', { desk: desk('waiting', { queue: 1 }) });
    const g = nowGroups(c, NOW);
    expect(g.waiting.map((r) => r.person.id)).toEqual(['qa-engineer']);
    expect(g.stuck.map((r) => r.person.id)).toEqual(['head-of-design']);
    expect(g.working.map((r) => [r.person.id, r.lead, r.task?.title ?? null])).toEqual([
      ['frontend-engineer', 'Wiring the slots to the store.', 'Pickup slot picker'],
      ['ui-designer', 'On it: Slot visuals.', null],
    ]);
    expect(g.desks.rows.map((r) => r.person.id)).toEqual(['frontend-lead']);
    expect(g.desks.reason).toBe("The hub's desks are all in use by other companies.");
    expect(g.done.map((r) => r.person.id)).toEqual(['office-manager']);
    expect(g.others.map((r) => r.person.id).sort()).toEqual(['ceo', 'head-of-engineering']);
  });

  it('shows five waiting for a desk, then a count, and says why they wait', () => {
    const c = withPeople(company({ desks: { working: 8, waiting: 7, max: 8 } }), (people) => people.map((p, i) => ({ ...p, desk: { ...p.desk, state: i < 7 ? 'waiting' : 'idle', queue: i + 1 } })));
    const g = nowGroups(c, NOW);
    expect(g.desks.rows).toHaveLength(5);
    expect(g.desks.more).toBe(2);
    expect(deskReason(c)).toBe('The company is using its eight desks.');
  });

  it('draws the demo café without anyone in two groups', () => {
    const c = demoCompanyView(NOW);
    const g = nowGroups(c, NOW);
    const ids = [...g.waiting, ...g.stuck, ...g.working, ...g.desks.rows, ...g.done, ...g.others].map((r) => r.person.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length + g.desks.more).toBe(c.people.length);
    expect(inboxSentence(c, NOW)?.text).toBe('Six things need you.');
  });
});
