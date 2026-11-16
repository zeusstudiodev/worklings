import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, progressBoard, spendBoard } from '../src/core/boards.ts';
import { THE_OFFICE } from '../src/core/company.ts';
import {
  ASK_FOR_DASHBOARD,
  askToChange,
  atWords,
  blockedWords,
  boardChoices,
  bucketLabel,
  chooseBoard,
  dayLabel,
  madeByLine,
  milestoneShare,
  milestoneWords,
  nothingSpent,
  peakWords,
  refusedNote,
  roomName,
  roomsOfBars,
  spentNote,
  spentTitle,
  stepWords,
  tickLabel,
} from '../web/src/company/dashboards/boardsModel.ts';
import { dollars, hourMinute } from '../web/src/lib/format.ts';
import { at, company, dashboard, hours, min, NOW, PEOPLE, person, ROOMS } from './panels-boards-kit.ts';

describe('which board the tab shows', () => {
  const dashboards = [dashboard('d-1', 'Launch checklist', NOW - min(30)), dashboard('d-2', 'Orders', NOW - min(5))];

  it('shows the board the address names, built-in or the CEO’s', () => {
    expect(chooseBoard('spend', null, dashboards).board).toMatchObject({ kind: 'built-in', id: 'spend', title: 'Spend' });
    expect(chooseBoard('d-1', 'timeline', dashboards).board).toMatchObject({ kind: 'ceo', id: 'd-1', title: 'Launch checklist' });
  });

  it('reopens the last one viewed when the address names none, and Progress the first time', () => {
    expect(chooseBoard(null, 'timeline', dashboards)).toMatchObject({ board: { id: 'timeline' }, gone: false });
    expect(chooseBoard(null, 'd-2', dashboards)).toMatchObject({ board: { id: 'd-2' }, gone: false });
    expect(chooseBoard(null, null, dashboards)).toMatchObject({ board: { id: 'progress' }, gone: false });
  });

  it('falls back to Progress quietly when the remembered dashboard went, and says so when the address named it', () => {
    expect(chooseBoard(null, 'd-9', dashboards)).toMatchObject({ board: { id: 'progress' }, gone: false });
    expect(chooseBoard('d-9', null, dashboards)).toMatchObject({ board: { id: 'progress' }, gone: true });
  });

  it('lists the built-in boards, then the CEO’s dashboards newest first', () => {
    expect(boardChoices(dashboards)).toEqual({
      builtIn: [
        { value: 'progress', label: 'Progress' },
        { value: 'spend', label: 'Spend' },
        { value: 'timeline', label: 'Timeline' },
      ],
      ceo: [
        { value: 'd-2', label: 'Orders' },
        { value: 'd-1', label: 'Launch checklist' },
      ],
    });
    expect(boardChoices([]).ceo).toEqual([]);
  });

  it('starts the CEO’s box with the design’s words', () => {
    expect(ASK_FOR_DASHBOARD).toBe('Make a dashboard that shows ');
    expect(askToChange('Launch checklist')).toBe('Change the dashboard “Launch checklist”: ');
  });
});

describe('a refused dashboard', () => {
  const refusal = { at: NOW - min(10), kind: 'dashboard-refused' as const, by: THE_OFFICE, text: 'The office turned down the CEO\'s dashboard “Launch checklist”: Widget 3 needs points as a list with at least one entry.' };

  it('leaves the office’s sentence atop the tab', () => {
    expect(refusedNote([refusal], [])).toEqual({ text: refusal.text, at: refusal.at });
  });

  it('stands until the CEO publishes again, and a refused update leaves the note while the last good one stays up', () => {
    const published = dashboard('d-1', 'Launch checklist', NOW - min(30));
    expect(refusedNote([refusal], [published])).not.toBeNull();
    const republished = { at: NOW - min(2), kind: 'dashboard' as const, by: 'ceo', text: 'The CEO updated the dashboard “Launch checklist”.' };
    expect(refusedNote([refusal, republished], [published])).toBeNull();
    expect(refusedNote([refusal], [dashboard('d-1', 'Launch checklist', NOW - min(1))])).toBeNull();
  });

  it('shows only the latest refusal, as plain text', () => {
    const later = { ...refusal, at: NOW - min(1), text: 'The office turned down the CEO\'s dashboard “**Orders**”: Widget 1 has kind "pie".' };
    expect(refusedNote([refusal, later], [])?.text).toBe('The office turned down the CEO\'s dashboard “Orders”: Widget 1 has kind "pie".');
  });

  it('is nothing when nothing was refused', () => {
    expect(refusedNote([{ at: NOW, kind: 'hire', by: 'ceo', text: 'The CEO hired Lena.' }], [])).toBeNull();
  });
});

describe('days and times', () => {
  it('names a day like "Mon 3 Nov", with the year only when it is another', () => {
    expect(dayLabel(at(9, 0, 3), NOW)).toBe('Tue 3 Nov');
    expect(dayLabel(new Date(2025, 11, 31, 9).getTime(), NOW)).toBe('Wed 31 Dec 2025');
  });

  it('says when inside a sentence, today, yesterday and before', () => {
    expect(atWords(at(14, 2), NOW)).toBe(`at ${hourMinute(at(14, 2))}`);
    expect(atWords(at(0, 0), NOW)).toBe(`at ${hourMinute(at(0, 0))}`);
    expect(atWords(at(23, 59, 4), NOW)).toBe(`yesterday at ${hourMinute(at(23, 59, 4))}`);
    expect(atWords(at(9, 15, 2), NOW)).toBe(`on Mon 2 Nov at ${hourMinute(at(9, 15, 2))}`);
  });

  it('says who made a CEO’s dashboard and when', () => {
    expect(madeByLine({ by: 'ceo', publishedAt: at(14, 2) }, PEOPLE, NOW)).toBe(`Made by the CEO at ${hourMinute(at(14, 2))}.`);
    expect(madeByLine({ by: 'head-of-design', publishedAt: at(9, 0, 4) }, PEOPLE, NOW)).toBe(`Made by Ada, head of design, yesterday at ${hourMinute(at(9, 0, 4))}.`);
  });
});

describe('the Progress board in words', () => {
  it('says how far each milestone is, or when it was done', () => {
    expect(milestoneWords({ done: true, doneAt: at(13, 40), tasks: { done: 5, total: 5 } }, NOW)).toBe(`Done at ${hourMinute(at(13, 40))}`);
    expect(milestoneWords({ done: false, doneAt: null, tasks: { done: 8, total: 10 } }, NOW)).toBe('8 of 10 tasks done');
    expect(milestoneWords({ done: false, doneAt: null, tasks: { done: 0, total: 0 } }, NOW)).toBe('No tasks yet');
    expect([milestoneShare({ done: true, tasks: { done: 2, total: 5 } }), milestoneShare({ done: false, tasks: { done: 2, total: 5 } }), milestoneShare({ done: false, tasks: { done: 0, total: 0 } })]).toEqual([1, 0.4, 0]);
  });

  it('agrees with the board: the bars and the words come from the same counts', () => {
    const c = company({
      goal: { text: 'Pickup orders', setAt: NOW - hours(5), milestones: [{ id: 'ms-1', title: 'Pickup', doneWhen: '', doneAt: null }] },
      tasks: [
        { id: 't1', title: 'Slots', brief: '', owner: 'frontend-engineer', askedBy: 'ceo', files: [], doneWhen: '', status: 'done', outcome: null, parent: null, milestone: 'ms-1', worktree: null, commit: null, createdAt: NOW - hours(4), updatedAt: NOW - hours(1) },
        { id: 't2', title: 'Cart', brief: '', owner: 'frontend-engineer', askedBy: 'ceo', files: [], doneWhen: '', status: 'working', outcome: null, parent: null, milestone: 'ms-1', worktree: null, commit: null, createdAt: NOW - hours(4), updatedAt: NOW - hours(1) },
        { id: 't3', title: 'Photos', brief: '', owner: 'ui-designer', askedBy: 'ceo', files: [], doneWhen: '', status: 'dropped', outcome: null, parent: null, milestone: 'ms-1', worktree: null, commit: null, createdAt: NOW - hours(4), updatedAt: NOW - hours(1) },
      ],
    });
    const m = progressBoard(c, NOW).milestones[0];
    expect(m && milestoneWords(m, NOW)).toBe('1 of 2 tasks done');
    expect(m && milestoneShare(m)).toBe(0.5);
  });

  it('says who is blocked, for how long and why', () => {
    expect(blockedWords({ owner: 'qa-engineer', why: 'The order API isn’t there yet.', since: NOW - min(15) }, PEOPLE, NOW)).toEqual({
      who: 'The QA engineer, blocked for 15 min',
      why: 'The order API isn’t there yet.',
    });
    expect(blockedWords({ owner: 'frontend-engineer', why: null, since: NOW - min(75) }, PEOPLE, NOW)).toEqual({ who: 'Kai, frontend engineer, blocked for 1 h 15 min', why: 'Nobody said why yet.' });
    expect(blockedWords({ owner: 'seo-specialist', why: null, since: NOW }, PEOPLE, NOW).who).toBe('SEO specialist, blocked for under a minute');
  });

  it('names rooms for the charts, and people who left', () => {
    expect([roomName('design', ROOMS), roomName(null, ROOMS), roomName('games-room', ROOMS)]).toEqual(['Design', 'People who left', 'Games room']);
  });

  it('draws a CEO’s bars in room hues only when every bar is a room', () => {
    expect(roomsOfBars(['Engineering', 'design', ' Content '], ROOMS)).toEqual(['engineering', 'design', 'content']);
    expect(roomsOfBars(['Engineering', 'Stripe'], ROOMS)).toBeNull();
    expect(roomsOfBars([], ROOMS)).toBeNull();
  });
});

describe('the Spend board in words', () => {
  it('labels money as v2 does: API-equivalent on a plan, Spend with an API key', () => {
    expect([spentTitle('API-equivalent', 'today'), spentTitle('API-equivalent', 'week'), spentTitle('Spend', 'all')]).toEqual(['API-equivalent today', 'API-equivalent over 7 days', 'Spent so far']);
    expect(spentNote(true)).toBe('What the same tokens would cost on the Claude API.');
    expect(spentNote(false)).toBe('What Claude Code reported for your API key.');
  });

  it('says nothing was spent in each range', () => {
    expect([nothingSpent('today'), nothingSpent('week'), nothingSpent('all')]).toEqual(['Nothing spent today.', 'Nothing spent in the last 7 days.', 'Nothing spent yet.']);
  });

  it('titles the over-time chart by its buckets', () => {
    expect([1, 2, 4, 12, 24, 48, 168, 336, 720].map((h) => stepWords(h * HOUR_MS))).toEqual([
      'By the hour',
      'Every two hours',
      'Every four hours',
      'Every twelve hours',
      'By the day',
      'Every two days',
      'By the week',
      'Every two weeks',
      'Every 30 days',
    ]);
  });

  it('names buckets for the table and the ticks', () => {
    expect(bucketLabel(at(13), HOUR_MS, NOW)).toBe(`${hourMinute(at(13))} to ${hourMinute(at(14))}`);
    expect(bucketLabel(at(12, 0, 4), 4 * HOUR_MS, NOW)).toBe(`Wed 4 Nov, ${hourMinute(at(12, 0, 4))} to ${hourMinute(at(16, 0, 4))}`);
    expect(bucketLabel(at(0, 0, 3), DAY_MS, NOW)).toBe('Tue 3 Nov');
    expect(tickLabel(at(13), HOUR_MS, NOW)).toBe(hourMinute(at(13)));
    expect(tickLabel(at(12, 0, 4), 4 * HOUR_MS, NOW)).toBe(`Wed ${hourMinute(at(12, 0, 4))}`);
    expect(tickLabel(at(0, 0, 3), DAY_MS, NOW)).toBe('3 Nov');
  });

  it('dates the ticks of a chart that spans a week, where a weekday alone could be last week’s', () => {
    expect(tickLabel(new Date(2026, 9, 29, 8).getTime(), 4 * HOUR_MS, NOW, 7 * DAY_MS)).toBe('29 Oct');
    expect(tickLabel(at(8), 4 * HOUR_MS, NOW, 7 * DAY_MS)).toBe('5 Nov');
    expect(tickLabel(at(8, 0, 4), HOUR_MS, NOW, 30 * HOUR_MS)).toBe(`Wed ${hourMinute(at(8, 0, 4))}`);
  });

  it('says when the most was spent, from the same series the chart draws', () => {
    const c = company({
      people: [person('ceo', 'Mara', 'CEO', 'direction', { level: 'ceo', cost: 3 })],
      spend: { samples: [], hourly: [{ hour: at(9), cost: 0.4 }, { hour: at(11), cost: 2.1 }, { hour: at(13), cost: 0.5 }], byPerson: [{ person: 'ceo', today: 3, week: 3, all: 3 }] },
    });
    const today = spendBoard(c, NOW).today;
    expect(peakWords(today.series, NOW, dollars)).toBe(`Most was spent from ${hourMinute(at(11))} to ${hourMinute(at(12))}: $2.10.`);
    expect(peakWords({ step: HOUR_MS, points: [{ at: at(9), value: 0 }] }, NOW, dollars)).toBeNull();
  });

  it('says a peak was today on a chart that starts before today', () => {
    const week = { step: 4 * HOUR_MS, points: [{ at: at(12, 0, 4), value: 2 }, { at: at(0, 0, 5), value: 8.21 }, { at: at(4, 0, 5), value: 1 }] };
    expect(peakWords(week, NOW, dollars)).toBe(`Most was spent today, from ${hourMinute(at(0))} to ${hourMinute(at(4))}: $8.21.`);
  });

  it('says the day of a peak in day-sized buckets', () => {
    expect(peakWords({ step: DAY_MS, points: [{ at: at(0, 0, 3), value: 4 }, { at: at(0, 0, 4), value: 1 }] }, NOW, dollars)).toBe('Most was spent on Tue 3 Nov: $4.00.');
  });
});
