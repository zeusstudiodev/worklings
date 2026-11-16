import { describe, expect, it } from 'vitest';
import { STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import type { Decision } from '../src/core/steering.ts';
import {
  byDay,
  countLine,
  DECISION_PAGE,
  decisionEntry,
  dayHeading,
  filterChoices,
  filterDecisions,
  isFiltered,
  moreLine,
  NO_FILTER,
  type DecisionNote,
  noteEnds,
  noteView,
  redoOf,
  shownCount,
  validFilter,
} from '../web/src/company/decisions/decisionsModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { audience, copy, decision } from './panels-steering-kit.ts';
import { company, message, min, NOW, studio, task } from './panels-work-kit.ts';

const snap = { studio };
const HOUR = 60 * min(1);

/** A log with one of most kinds, oldest last. */
function log(): Decision[] {
  return [
    decision('d1', STAKEHOLDER, 'approval', 'You allowed Kai to push to GitHub, once.', { at: NOW - min(5), people: [STAKEHOLDER, 'frontend-engineer'], rooms: ['engineering'], links: { approval: 'a-3' } }),
    decision('d2', 'head-of-design', 'decide', 'Ada chose espresso brown over charcoal.', {
      at: NOW - min(20),
      people: ['head-of-design', 'ui-designer'],
      rooms: ['design'],
      why: 'It keeps 7:1 on the menu and reads warm.',
      alternatives: ['Charcoal', 'Keep the light palette'],
      links: { message: 'm2' },
    }),
    decision('d3', STAKEHOLDER, 'leash', 'You made Mina check with you before each task.', { at: NOW - min(40), people: [STAKEHOLDER, 'ui-designer'], rooms: ['design'], reversible: true }),
    decision('d4', 'ceo', 'plan', 'The CEO wrote version 3 of the plan.', { at: NOW - 26 * HOUR, people: ['ceo'], links: { planVersion: 3 }, reversible: true }),
    decision('d5', THE_OFFICE, 'task', 'The office cancelled “Apple Pay at pickup”.', { at: NOW - 50 * HOUR, people: [THE_OFFICE, 'frontend-engineer'], rooms: ['engineering'], links: { task: 't-18' } }),
  ];
}

describe('filters', () => {
  it('keeps what concerns a person, a room or a kind, newest first, and all of them together', () => {
    const all = log();
    expect(filterDecisions(all, NO_FILTER).map((d) => d.id)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(filterDecisions(all, { ...NO_FILTER, who: 'ui-designer' }).map((d) => d.id)).toEqual(['d2', 'd3']);
    expect(filterDecisions(all, { ...NO_FILTER, room: 'engineering' }).map((d) => d.id)).toEqual(['d1', 'd5']);
    expect(filterDecisions(all, { ...NO_FILTER, kind: 'leash' }).map((d) => d.id)).toEqual(['d3']);
    expect(filterDecisions(all, { who: STAKEHOLDER, room: 'design', kind: 'leash' }).map((d) => d.id)).toEqual(['d3']);
    expect(filterDecisions(all, { who: 'ceo', room: 'design', kind: '' })).toEqual([]);
  });

  it('offers only who, rooms and kinds the log holds, with how many each has', () => {
    const choices = filterChoices(snap, company(), log());
    expect(choices.who).toEqual([
      { value: STAKEHOLDER, label: 'You (2)' },
      { value: 'ceo', label: 'Noor, CEO (1)' },
      { value: 'frontend-engineer', label: 'Kai, frontend engineer (2)' },
      { value: 'head-of-design', label: 'Ada, head of design (1)' },
      { value: 'ui-designer', label: 'Mina, UI designer (2)' },
      { value: THE_OFFICE, label: 'The office (1)' },
    ]);
    expect(choices.rooms).toEqual([
      { value: 'design', label: 'Design (2)' },
      { value: 'engineering', label: 'Engineering (2)' },
    ]);
    expect(choices.kinds.map((k) => k.label)).toEqual(['Approvals (1)', 'The plan (1)', 'Leashes (1)', 'Tasks (1)', 'Calls people made (1)']);
  });

  it('drops a choice the log no longer holds instead of hiding everything', () => {
    const choices = filterChoices(snap, company(), log());
    expect(validFilter({ who: 'gone', room: 'design', kind: 'nonsense' }, choices)).toEqual({ who: '', room: 'design', kind: '' });
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, room: 'design' })).toBe(true);
  });

  it('counts what it shows', () => {
    expect(countLine(0, 0, false)).toBe('');
    expect(countLine(300, 300, false)).toBe('300 decisions, newest first.');
    expect(countLine(1, 1, false)).toBe('One decision, newest first.');
    expect(countLine(2, 300, true)).toBe('Two of 300 decisions match.');
  });
});

describe('an entry', () => {
  it('says who decided when, why and what else they weighed, and links to the message', () => {
    const messages = [message('m2', 'ceo', 'head-of-design', 'Make it darker.', { origin: STAKEHOLDER, relayOf: 'm1' })];
    const entry = decisionEntry(company({ messages }), log()[1] as Decision, NOW);
    expect(entry).toEqual({
      id: 'd2',
      what: 'Ada chose espresso brown over charcoal.',
      by: `By Ada, head of design, at ${hourMinute(NOW - min(20))}.`,
      tag: 'Their call',
      why: 'It keeps 7:1 on the menu and reads warm.',
      alternatives: ['Charcoal', 'Keep the light palette'],
      links: [{ key: 'message:m2', label: "The CEO's message to Ada", path: 'people/ceo' }],
      undone: null,
      reconsidered: null,
      canUndo: false,
      reconsiderTo: { id: 'head-of-design', name: 'Ada' },
    });
  });

  it('links to your message’s trace, a task, a question, an approval and a plan version', () => {
    const room = audience('room', 'design', 'the design room', 'g-1');
    const c = company({ messages: [copy('m1', 'head-of-design', 'Darker.', room)], tasks: [task('t-11', 'frontend-engineer', 'Pickup slot picker')] });
    const d = decision('d9', STAKEHOLDER, 'answer', 'You answered Mina: 15-minute windows.', { links: { message: 'm1', task: 't-11', question: 'q-3', approval: 'a-1', planVersion: 4 } });
    expect(decisionEntry(c, d, NOW).links).toEqual([
      { key: 'message:m1', label: 'Your message to the design room', path: 'messages/m1' },
      { key: 'task:t-11', label: 'Task: Pickup slot picker', path: 'tasks/t-11' },
      { key: 'question:q-3', label: 'The question', path: 'inbox#q-3' },
      { key: 'approval:a-1', label: 'The approval', path: 'inbox#a-1' },
      { key: 'plan:4', label: 'Version 4 of the plan', path: 'plan/v4' },
    ]);
    // A message that left the view still opens its trace, which says so.
    expect(decisionEntry(company(), decision('d10', 'ceo', 'org', 'x', { links: { message: 'm-old' } }), NOW).links).toEqual([{ key: 'message:m-old', label: 'The message', path: 'messages/m-old' }]);
  });

  it('offers Undo only while it can be taken back, and Reconsider only to someone in the company', () => {
    const c = company();
    expect(decisionEntry(c, log()[2] as Decision, NOW)).toMatchObject({ canUndo: true, reconsiderTo: null, by: `By you at ${hourMinute(NOW - min(40))}.` });
    expect(decisionEntry(c, log()[4] as Decision, NOW)).toMatchObject({ canUndo: false, reconsiderTo: null, by: expect.stringMatching(/^By the office on \w{3} \d+ \w{3} at /) });
    const gone = decision('d11', 'seo-specialist', 'decide', 'Meta tags first.');
    expect(decisionEntry(c, gone, NOW).reconsiderTo).toBeNull();
  });

  it('shows an undone decision and a reconsidered one as such', () => {
    const undone = decision('d3', STAKEHOLDER, 'leash', 'You made Mina check with you before each task.', { reversible: true, undone: { at: NOW - min(2), by: STAKEHOLDER, decision: 'd12' } });
    expect(decisionEntry(company(), undone, NOW)).toMatchObject({ canUndo: false, undone: { text: `Undone by you at ${hourMinute(NOW - min(2))}.`, path: 'decisions/d12' } });
    const back = decision('d2', 'head-of-design', 'decide', 'Espresso brown.', { reconsider: { at: NOW - min(1), note: 'Charcoal reads better at night.', message: 'm30' } });
    expect(decisionEntry(company(), back, NOW).reconsidered).toEqual({ text: `You asked Ada to reconsider at ${hourMinute(NOW - min(1))}: “Charcoal reads better at night.”`, path: 'messages/m30' });
  });

  it('finds the undo that Undo under "Undone." takes back, when it can be', () => {
    const decisions = [
      decision('d3', STAKEHOLDER, 'leash', 'x', { reversible: true, undone: { at: NOW, by: STAKEHOLDER, decision: 'd12' } }),
      decision('d12', STAKEHOLDER, 'undo', 'You undid: x', { reversible: true, links: { decision: 'd3' } }),
      decision('d4', STAKEHOLDER, 'leash', 'y', { reversible: true, undone: { at: NOW, by: STAKEHOLDER, decision: 'd13' } }),
      decision('d13', STAKEHOLDER, 'undo', 'You undid: y', { reversible: false }),
    ];
    expect(redoOf(decisions, 'd3')).toBe('d12');
    expect(redoOf(decisions, 'd4')).toBeNull();
    expect(redoOf(decisions, 'd12')).toBeNull();
  });

  it('ends "Undone." with its undo window, also when the undo can\'t itself be undone', () => {
    const undone: DecisionNote = { kind: 'undone', text: 'Undone.', until: NOW + 10_000 };
    expect(noteEnds(undone)).toBe(NOW + 10_000);
    // In the window: "Undone. Undo" when the undo can be taken back, the plain line when it can't.
    expect(noteView(undone, true, false)).toBe('undo-line');
    expect(noteView(undone, false, false)).toBe('line');
    // Past it, neither stays: the entry's own "Undone by you at 14:40." says it from then on.
    expect(noteView(undone, true, true)).toBeNull();
    expect(noteView(undone, false, true)).toBeNull();
  });

  it('keeps what a press said until the next press, and shows nothing while it is busy', () => {
    for (const kind of ['sent', 'failed', 'redone'] as const) {
      const note: DecisionNote = { kind, text: 'Said.' };
      expect(noteEnds(note)).toBeNull();
      expect(noteView(note, false, false)).toBe('line');
    }
    expect(noteView({ kind: 'busy', text: 'Undoing…' }, true, false)).toBeNull();
    expect(noteView(null, true, false)).toBeNull();
    expect(noteEnds(null)).toBeNull();
  });
});

describe('days and pages', () => {
  it('heads each day: today, yesterday, then the date', () => {
    expect(byDay(filterDecisions(log(), NO_FILTER), NOW).map((d) => [d.heading, d.decisions.map((x) => x.id)])).toEqual([
      ['Today', ['d1', 'd2', 'd3']],
      ['Yesterday', ['d4']],
      [dayHeading(NOW - 50 * HOUR, NOW), ['d5']],
    ]);
    expect(dayHeading(NOW - 50 * HOUR, NOW)).toMatch(/^\w{3} \d{1,2} \w{3}$/);
  });

  it('shows a long log a page at a time, and enough of it to hold the decision an address names', () => {
    const long = Array.from({ length: 300 }, (_, i) => decision(`d${i}`, 'ceo', 'org', `Change ${i}`, { at: NOW - i * min(1) }));
    const sorted = filterDecisions(long, NO_FILTER);
    expect(shownCount(sorted, 1, null)).toBe(DECISION_PAGE);
    expect(shownCount(sorted, 2, null)).toBe(DECISION_PAGE * 2);
    expect(shownCount(sorted, 1, 'd120')).toBe(150);
    expect(shownCount(sorted, 7, null)).toBe(300);
    expect(shownCount(sorted, 1, 'unknown')).toBe(DECISION_PAGE);
    expect(moreLine(250)).toBe('Show 50 more (250 left)');
    expect(moreLine(30)).toBe('Show the last 30');
    expect(moreLine(2)).toBe('Show the last two');
  });
});
