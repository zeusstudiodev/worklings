import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import type { FeedLine } from '../web/src/company/feed/feedModel.ts';
import { ageOf, anythingNew, feedKeyName, heldLines, HOLD_MS, isQuiet, newReplies, QUIET_MS, stripFeedLines, stripLines, stripName } from '../web/src/company/strip/stripModel.ts';
import { min, NOW, sec } from './panels-work-kit.ts';

function line(id: string, at: number, extra: Partial<FeedLine> = {}): FeedLine {
  return { id, kind: 'between', at, from: 'frontend-engineer', to: 'ui-designer', lead: 'Kai to Mina:', words: id, sentence: [id], body: null, yours: false, tone: 'plain', link: null, about: null, item: null, ...extra };
}

describe('the live strip', () => {
  const lines = [line('a', NOW - min(4)), line('b', NOW - min(3)), line('c', NOW - min(2)), line('d', NOW - min(1))];

  it('shows the newest lines, three on the office and one on a board or a phone, the newest nearest the bar', () => {
    expect(stripLines(lines, 3).map((l) => l.id)).toEqual(['b', 'c', 'd']);
    expect(stripLines(lines, 1).map((l) => l.id)).toEqual(['d']);
    expect(stripLines([], 3)).toEqual([]);
  });

  it('leaves out what needs you while the inbox shows beside the office, and keeps it otherwise', () => {
    const mixed = [line('a', NOW - min(3)), line('ask', NOW - min(2), { tone: 'needs' }), line('stuck', NOW - min(1), { tone: 'stuck' })];
    expect(stripFeedLines(mixed, true).map((l) => l.id)).toEqual(['a', 'stuck']);
    expect(stripFeedLines(mixed, false)).toBe(mixed);
  });

  it('says how old each line is', () => {
    expect([sec(20), min(2), min(75), min(60 * 30)].map(ageOf)).toEqual(['just now', '2 min', '1 h', '1 d']);
  });

  it('fades away after five quiet minutes', () => {
    expect(isQuiet(lines, NOW)).toBe(false);
    expect(isQuiet(lines, NOW - min(1) + QUIET_MS)).toBe(true);
    expect(isQuiet([], NOW)).toBe(true);
  });

  it('keeps each line a short moment (well under the second a relay is promised in), then shows the newest and skips the ones between', () => {
    expect(HOLD_MS).toBeLessThanOrEqual(300);
    const shown = [line('a', NOW)];
    const newer = [line('b', NOW + 200), line('c', NOW + 400)];
    expect(heldLines(shown, NOW, newer, NOW + HOLD_MS / 2)).toEqual({ lines: shown, wait: NOW + HOLD_MS });
    expect(heldLines(shown, NOW, newer, NOW + HOLD_MS)).toEqual({ lines: newer, wait: null });
    // A burst's count growing in place is a change too.
    const grown = [{ ...shown[0], words: 'Five people acknowledged your message.' } as FeedLine];
    expect(heldLines(shown, NOW - HOLD_MS, grown, NOW).lines).toBe(grown);
    expect(heldLines([], NOW, newer, NOW).lines).toBe(newer);
  });

  it('counts new replies and disagreements since you last looked, less what you read in their thread', () => {
    const replies = [
      line('r1', NOW - min(5), { kind: 'reply', from: 'ceo' }),
      line('r2', NOW - min(1), { kind: 'reply', from: 'head-of-design' }),
      line('x', NOW - min(1), { kind: 'disagree', from: 'ui-designer' }),
      line('y', NOW - min(1), { kind: 'yours', from: STAKEHOLDER }),
    ];
    expect(newReplies(replies, NOW - min(10), {})).toBe(3);
    expect(newReplies(replies, NOW - min(10), { ceo: NOW - min(2) })).toBe(2);
    expect(newReplies(replies, NOW - min(3), {})).toBe(2);
    expect(anythingNew([line('y', NOW, { from: STAKEHOLDER })], NOW - min(1))).toBe(false);
  });

  it('names the strip and Feed by what is new', () => {
    expect(stripName(0)).toBe('Open the feed');
    expect(stripName(2)).toBe('Open the feed, 2 new replies');
    expect(feedKeyName(false, 1, true)).toBe('Feed, 1 new reply');
    expect(feedKeyName(false, 0, true)).toBe('Feed, new lines');
    expect(feedKeyName(false, 0, false)).toBe('Feed');
    expect(feedKeyName(true, 3, true)).toBe('Close the feed');
  });
});
