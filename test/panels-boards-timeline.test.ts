import { describe, expect, it } from 'vitest';
import { timeline } from '../src/core/boards.ts';
import { STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import {
  DEFAULT_FILTER,
  earlierWords,
  EVERYONE,
  filterTimeline,
  pageGroups,
  timelineEmpty,
  timelineGroups,
  timelineHeading,
  whoChoices,
  whoInSentence,
} from '../web/src/company/dashboards/boardsModel.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { at, company, entry, NOW, PEOPLE, ROOMS } from './panels-boards-kit.ts';

describe('the Timeline’s headings', () => {
  it('heads today’s lines by the hour, then yesterday, then the day', () => {
    expect(timelineHeading(at(14, 25), NOW)).toBe(hourMinute(at(14)));
    expect(timelineHeading(at(0, 5), NOW)).toBe(hourMinute(at(0)));
    expect(timelineHeading(at(22, 0, 4), NOW)).toBe('Yesterday');
    expect(timelineHeading(at(9, 0, 2), NOW)).toBe('Mon 2 Nov');
  });

  it('groups lines newest first under those headings', () => {
    const groups = timelineGroups(
      [
        entry('a', 'ceo', at(9, 0, 2), { kind: 'report' }),
        entry('b', 'ceo', at(14, 10), { kind: 'report' }),
        entry('c', 'ceo', at(13, 50), { kind: 'report' }),
        entry('d', 'ceo', at(8, 0, 4), { kind: 'report' }),
        entry('e', 'ceo', at(23, 0, 4), { kind: 'report' }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.heading, g.lines.map((l) => l.entry.id)])).toEqual([
      [hourMinute(at(14)), ['b']],
      [hourMinute(at(13)), ['c']],
      ['Yesterday', ['e', 'd']],
      ['Mon 2 Nov', ['a']],
    ]);
  });
});

describe('folding status lines', () => {
  it("folds one person's status lines in an hour into the latest", () => {
    const groups = timelineGroups(
      [
        entry('k1', 'frontend-engineer', at(14, 1)),
        entry('k2', 'frontend-engineer', at(14, 12)),
        entry('k3', 'frontend-engineer', at(14, 20)),
        entry('m1', 'ui-designer', at(14, 15)),
        entry('k0', 'frontend-engineer', at(13, 59)),
      ],
      NOW,
    );
    const [two, one] = groups;
    expect(two?.lines.map((l) => [l.entry.id, l.earlier.map((e) => e.id)])).toEqual([
      ['k3', ['k2', 'k1']],
      ['m1', []],
    ]);
    expect(one?.lines.map((l) => [l.entry.id, l.earlier.length])).toEqual([['k0', 0]]);
  });

  it('never folds reports, decisions or messages', () => {
    const groups = timelineGroups(
      [entry('r1', 'frontend-engineer', at(14, 1), { kind: 'report' }), entry('r2', 'frontend-engineer', at(14, 2), { kind: 'report' }), entry('s', 'frontend-engineer', at(14, 3))],
      NOW,
    );
    expect(groups[0]?.lines.map((l) => [l.entry.id, l.earlier.length])).toEqual([
      ['s', 0],
      ['r2', 0],
      ['r1', 0],
    ]);
  });

  it('folds within the hour on earlier days too', () => {
    const groups = timelineGroups([entry('y1', 'ceo', at(10, 5, 4)), entry('y2', 'ceo', at(10, 40, 4)), entry('y3', 'ceo', at(11, 5, 4))], NOW);
    expect(groups.map((g) => [g.heading, g.lines.map((l) => [l.entry.id, l.earlier.map((e) => e.id)])])).toEqual([
      [
        'Yesterday',
        [
          ['y3', []],
          ['y2', ['y1']],
        ],
      ],
    ]);
  });

  it('counts what folded in words', () => {
    expect([earlierWords(1), earlierWords(5), earlierWords(14)]).toEqual(['and one earlier update', 'and five earlier updates', 'and 14 earlier updates']);
  });
});

describe('the Who filter and the Status lines checkbox', () => {
  const entries = [
    entry('s-kai', 'frontend-engineer', at(14, 1)),
    entry('r-mina', 'ui-designer', at(14, 2), { kind: 'report', people: ['ui-designer', 'head-of-design'] }),
    entry('d-you', STAKEHOLDER, at(14, 3), { kind: 'decision', people: [STAKEHOLDER, 'frontend-engineer'] }),
    entry('m-office', THE_OFFICE, at(14, 4), { kind: 'milestone' }),
  ];

  it('keeps everything for everyone, status lines on', () => {
    expect(filterTimeline(entries, DEFAULT_FILTER, PEOPLE).map((e) => e.id)).toEqual(['s-kai', 'r-mina', 'd-you', 'm-office']);
  });

  it('keeps the lines about one person, theirs and those that name them', () => {
    expect(filterTimeline(entries, { who: 'person:frontend-engineer', status: true }, PEOPLE).map((e) => e.id)).toEqual(['s-kai', 'd-you']);
    expect(filterTimeline(entries, { who: `person:${STAKEHOLDER}`, status: true }, PEOPLE).map((e) => e.id)).toEqual(['d-you']);
  });

  it("keeps the lines about a room's people", () => {
    expect(filterTimeline(entries, { who: 'room:design', status: true }, PEOPLE).map((e) => e.id)).toEqual(['r-mina']);
  });

  it('hides status lines when the box is off', () => {
    expect(filterTimeline(entries, { who: EVERYONE, status: false }, PEOPLE).map((e) => e.id)).toEqual(['r-mina', 'd-you', 'm-office']);
  });

  it('offers rooms that have people, then you, the people and the office', () => {
    const choices = whoChoices(PEOPLE, ROOMS);
    expect(choices.rooms.map((c) => c.label)).toEqual(['Direction', 'Design', 'Engineering', 'Quality']);
    expect(choices.people.map((c) => c.label)).toEqual(['You', 'Mara, CEO', 'Ada, head of design', 'Mina, UI designer', 'Kai, frontend engineer', 'QA engineer', 'The office']);
    expect(choices.people[0]?.value).toBe(`person:${STAKEHOLDER}`);
  });

  it('says what an empty Timeline holds, for nothing and for each filter', () => {
    expect(timelineEmpty(0, DEFAULT_FILTER, null)).toBe('Nothing to tell yet. Status lines, reports and decisions show up here as they happen.');
    expect(timelineEmpty(4, { who: 'person:qa-engineer', status: true }, whoInSentence('person:qa-engineer', PEOPLE, ROOMS))).toBe('Nothing about the QA engineer yet.');
    expect(timelineEmpty(4, { who: 'room:quality', status: false }, whoInSentence('room:quality', PEOPLE, ROOMS))).toBe('Nothing about Quality yet. Status lines are hidden.');
    expect(timelineEmpty(4, { who: EVERYONE, status: false }, null)).toBe('Only status lines so far. Turn on Status lines to see them.');
    expect([whoInSentence(`person:${STAKEHOLDER}`, PEOPLE, ROOMS), whoInSentence(`person:${THE_OFFICE}`, PEOPLE, ROOMS), whoInSentence('person:frontend-engineer', PEOPLE, ROOMS), whoInSentence(EVERYONE, PEOPLE, ROOMS)]).toEqual([
      'you',
      'the office',
      'Kai',
      null,
    ]);
  });
});

describe('paging a long Timeline', () => {
  it('draws the first lines under their headings and counts the rest', () => {
    const groups = timelineGroups(
      Array.from({ length: 30 }, (_, i) => entry(`r${i}`, 'ceo', at(14, 0) - i * 5 * 60_000, { kind: 'report' })),
      NOW,
    );
    const page = pageGroups(groups, 10);
    expect(page.groups.flatMap((g) => g.lines).length).toBe(10);
    expect(page.more).toBe(20);
    expect(pageGroups(groups, 100).more).toBe(0);
  });
});

describe('the Timeline agrees with the state', () => {
  it('folds the status lines boards.ts tells, and keeps every other line', () => {
    const c = company({
      statuses: [
        { person: 'frontend-engineer', text: 'Starting the slot picker.', taskId: null, at: at(14, 2) },
        { person: 'frontend-engineer', text: 'The slot picker renders.', taskId: null, at: at(14, 20) },
      ],
      reports: [{ id: 'r-1', person: 'frontend-engineer', to: 'ceo', taskId: null, outcome: 'done', text: 'Slot picker done.', at: at(14, 25) }],
    });
    const groups = timelineGroups(filterTimeline(timeline(c), DEFAULT_FILTER, c.people), NOW);
    expect(groups.flatMap((g) => g.lines.map((l) => [l.entry.text, l.earlier.map((e) => e.text)]))).toEqual([
      ['Kai finished and reported to Mara: Slot picker done.', []],
      ['Kai: The slot picker renders.', ['Kai: Starting the slot picker.']],
    ]);
  });
});
