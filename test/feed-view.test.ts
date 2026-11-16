import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { feedLines, foldBursts } from '../web/src/company/feed/feedModel.ts';
import {
  applyPage,
  cursorOf,
  filterLines,
  filterSentence,
  firstNewRow,
  NO_EARLIER,
  needsProbe,
  NO_FILTER,
  offersEarlier,
  parseFilter,
  rowsOf,
  slideOut,
  unreadReply,
  whoCalled,
  whoOptions,
  withEarlier,
} from '../web/src/company/feed/feedView.ts';
import { ack, audience, copy, steered } from './panels-steering-kit.ts';
import { message, min, NOW, studio } from './panels-work-kit.ts';

const snap = { studio };

/** Your message, its relays, and an acknowledgement: the chain the design draws on a rail. */
function chain() {
  return steered(
    {
      messages: [
        message('m-1', STAKEHOLDER, 'ceo', 'Make the palette darker.', { at: NOW - min(30) }),
        message('m-2', 'ceo', 'head-of-design', 'Make the palette darker.', { at: NOW - min(29), relayOf: 'm-1', origin: STAKEHOLDER, note: 'Darker palette for the menu.' }),
        message('m-3', 'head-of-design', 'ui-designer', 'Make the palette darker.', { at: NOW - min(28), relayOf: 'm-2', origin: STAKEHOLDER }),
      ],
    },
    { acks: [ack('k-1', 'm-3', 'ui-designer', 'Darkening the tokens now.', { at: NOW - min(27) })] },
  );
}

// Stalls follow messages that sit unanswered; these tests are about the rest.
const linesOf = (c: ReturnType<typeof chain>, now = NOW) => feedLines(snap, c, now).filter((l) => l.kind !== 'stall');

const rows = (c: ReturnType<typeof chain>, now = NOW) => {
  const all = linesOf(c, now);
  return rowsOf(foldBursts(all), all, now);
};

describe('threads', () => {
  it('hangs the relays and acknowledgements under your message on a rail, while they come in a row', () => {
    const r = rows(chain());
    expect(r.map((x) => [x.line.kind, x.rail])).toEqual([
      ['yours', false],
      ['passed', true],
      ['passed', true],
      ['ack', true],
    ]);
    expect(r.every((x) => x.onYours === null)).toBe(true);
  });

  it('starts a line that comes after other lines with "On your message", linking to where it went', () => {
    const c = chain();
    c.messages.push(message('m-9', 'head-of-design', STAKEHOLDER, 'Unrelated, a question.', { at: NOW - min(20) }));
    c.steering?.acks.push(ack('k-2', 'm-3', 'head-of-design', 'Also on it.', { at: NOW - min(10) }));
    const late = rows(c).find((x) => x.line.id === 'ack:k-2');
    expect(late).toMatchObject({ rail: false, onYours: { words: 'Make the palette darker.', path: 'messages/m-1' } });
  });

  it('writes a relay whose message has left the view from its own words', () => {
    const c = chain();
    c.messages = c.messages.slice(1);
    const r = rows(c);
    expect(r[0]?.line.kind).toBe('passed');
    expect(r[0]?.onYours?.words).toContain('Darker palette');
  });

  it('puts every copy of a room message and its relays under the one line', () => {
    const design = audience('room', 'design', 'the design room', 'g-1');
    const c = steered(
      {
        messages: [
          copy('m-1', 'head-of-design', 'Darker cards.', design, { at: NOW - min(9) }),
          copy('m-2', 'ui-designer', 'Darker cards.', design, { at: NOW - min(9) }),
        ],
      },
      { acks: [ack('k-1', 'm-2', 'ui-designer', 'On it.', { at: NOW - min(8) })] },
    );
    expect(rows(c).map((x) => [x.line.kind, x.rail])).toEqual([
      ['yours', false],
      ['ack', true],
    ]);
  });

  it("shares a header between one speaker's lines of one kind within two minutes", () => {
    const c = steered({
      messages: [
        message('m-1', 'head-of-design', STAKEHOLDER, 'First.', { at: NOW - min(10) }),
        message('m-2', 'head-of-design', STAKEHOLDER, 'Second.', { at: NOW - min(9) }),
        message('m-3', 'head-of-design', STAKEHOLDER, 'Much later.', { at: NOW - min(2) }),
      ],
    });
    expect(rows(c).map((x) => x.joined)).toEqual([false, true, false]);
  });

  it('names the day once per day', () => {
    const c = steered({
      messages: [
        message('m-1', 'head-of-design', STAKEHOLDER, 'Yesterday.', { at: NOW - 26 * 60 * 60_000 }),
        message('m-2', 'head-of-design', STAKEHOLDER, 'Today.', { at: NOW - min(5) }),
        message('m-3', 'ui-designer', STAKEHOLDER, 'Also.', { at: NOW - min(4) }),
      ],
    });
    expect(rows(c).map((x) => x.day)).toEqual(['Yesterday', 'Today', null]);
  });
});

describe('bursts', () => {
  it('folds four acknowledgements of one message within a minute and keeps them for "Show them"', () => {
    const people = ['ui-designer', 'head-of-design', 'frontend-engineer', 'head-of-engineering'];
    const c = steered(
      { messages: [message('m-1', STAKEHOLDER, 'ceo', 'Ship it.', { at: NOW - min(9) })] },
      { acks: people.map((p, i) => ack(`k-${i}`, 'm-1', p, 'On it.', { at: NOW - min(8) + i * 1000 })) },
    );
    const folded = foldBursts(feedLines(snap, c, NOW));
    const burst = folded.find((l) => l.kind === 'burst');
    expect(burst?.words).toBe('Four people acknowledged your message.');
    expect(burst?.members?.map((m) => m.from)).toEqual(people);
    expect(folded.filter((l) => l.kind === 'ack')).toEqual([]);
  });
});

describe('filters', () => {
  const c = chain();
  const all = linesOf(c);

  it('matches the speaker or the one spoken to', () => {
    expect(filterLines(all, { who: 'person:head-of-design', kind: 'all' }, c).map((l) => l.id)).toEqual(['m:m-2', 'm:m-3']);
  });

  it('matches anyone in a room', () => {
    expect(filterLines(all, { who: 'room:design', kind: 'all' }, c).map((l) => l.id).sort()).toEqual(['ack:k-1', 'm:m-2', 'm:m-3']);
  });

  it('filters by kind, with acknowledgements and relays under "Passed on"', () => {
    expect(filterLines(all, { who: 'all', kind: 'passed' }, c).map((l) => l.kind).sort()).toEqual(['ack', 'passed', 'passed']);
    expect(filterLines(all, { who: 'all', kind: 'yours' }, c).map((l) => l.kind)).toEqual(['yours']);
  });

  it('says what it shows once, and when nothing matches', () => {
    expect(filterSentence(NO_FILTER, null, 4)).toBeNull();
    expect(filterSentence({ who: 'person:ui-designer', kind: 'all' }, 'Mina', 2)).toBe('Showing lines with Mina.');
    expect(filterSentence({ who: 'person:ui-designer', kind: 'all' }, 'Mina', 0)).toBe('Nothing with Mina yet.');
    expect(filterSentence({ who: 'all', kind: 'needs' }, null, 0)).toBe('Nothing in needs you yet.');
  });

  it('lists the rooms and the people by room, and reads a stored filter safely', () => {
    const o = whoOptions(snap, c);
    expect(o.rooms.map((r) => r.label)).toEqual(['Direction', 'Engineering', 'Design']);
    expect(o.people.find((g) => g.room === 'Design')?.people.map((p) => p.value)).toEqual(['person:head-of-design', 'person:ui-designer']);
    expect(whoCalled(snap, c, 'person:ui-designer')).toBe('Mina');
    expect(parseFilter({ who: 'x', kind: 'nope' })).toEqual(NO_FILTER);
    expect(parseFilter({ who: 'person:kai', kind: 'work' })).toEqual({ who: 'person:kai', kind: 'work' });
    expect(parseFilter(null)).toEqual(NO_FILTER);
  });
});

describe('unread', () => {
  it('puts the New rule above the first line from anyone but you since you last looked', () => {
    const c = steered({
      messages: [
        message('m-1', STAKEHOLDER, 'ceo', 'Hello.', { at: NOW - min(30) }),
        message('m-2', 'ceo', STAKEHOLDER, 'Hi.', { at: NOW - min(20) }),
        message('m-3', 'ceo', STAKEHOLDER, 'Also.', { at: NOW - min(5) }),
      ],
    });
    const r = rows(c);
    expect(firstNewRow(r, NOW - min(25))).toBe(1);
    expect(firstNewRow(r, NOW)).toBe(-1);
  });

  it("keeps a reply's dot until its conversation has been seen", () => {
    const c = steered({ messages: [message('m-1', 'ceo', STAKEHOLDER, 'Hi.', { at: NOW - min(20) })] });
    const [line] = feedLines(snap, c, NOW);
    expect(line && unreadReply(line, {})).toBe(true);
    expect(line && unreadReply(line, { ceo: NOW - min(10) })).toBe(false);
    expect(line && unreadReply(line, { ceo: NOW - min(30) })).toBe(true);
  });
});

describe('earlier pages', () => {
  const held = [message('m-5', STAKEHOLDER, 'ceo', 'Five.', { at: NOW - min(5) }), message('m-6', STAKEHOLDER, 'ceo', 'Six.', { at: NOW - min(4) })];
  const page = (ids: number[], more: boolean) => ({
    messages: ids.map((n) => message(`m-${n}`, STAKEHOLDER, 'ceo', `${n}.`, { at: NOW - min(100 - n) })),
    acks: [],
    more,
  });

  it('asks before the oldest message held, then before the last message of the page before', () => {
    const c = steered({ messages: held });
    expect(cursorOf(c, NO_EARLIER)).toBe('m-5');
    expect(cursorOf(c, applyPage(NO_EARLIER, page([4, 3], true)))).toBe('m-3');
  });

  it('offers earlier lines only once the office has said something older is kept', () => {
    expect(offersEarlier(NO_EARLIER, null)).toBe(false);
    expect(offersEarlier(NO_EARLIER, { cursor: 'm-5', has: false })).toBe(false);
    expect(offersEarlier(NO_EARLIER, { cursor: 'm-5', has: true })).toBe(true);
    expect(offersEarlier(applyPage(NO_EARLIER, page([4, 3], true)), null)).toBe(true);
    // A page that was the last: the feed says nothing older is kept instead of offering more.
    expect(offersEarlier(applyPage(NO_EARLIER, page([4, 3], false)), { cursor: 'm-5', has: true })).toBe(false);
  });

  it('asks the office for one message before the oldest held, once, until something older is found', () => {
    expect(needsProbe(null, NO_EARLIER, null)).toBe(false);
    expect(needsProbe('m-5', NO_EARLIER, null)).toBe(true);
    expect(needsProbe('m-5', NO_EARLIER, { cursor: 'm-5', has: false })).toBe(false);
    expect(needsProbe('m-5', NO_EARLIER, { cursor: 'm-5', has: true })).toBe(false);
    // The view moved on and nothing was before the old cursor, so ask again; once something was found, never.
    expect(needsProbe('m-6', NO_EARLIER, { cursor: 'm-5', has: false })).toBe(true);
    expect(needsProbe('m-6', NO_EARLIER, { cursor: 'm-5', has: true })).toBe(false);
    expect(needsProbe('m-5', applyPage(NO_EARLIER, page([4], true)), null)).toBe(false);
  });

  it('puts a page in front, oldest first, and merges repeated messages by id', () => {
    const c = steered({ messages: held });
    const second = applyPage(applyPage(NO_EARLIER, page([4, 3], true)), page([3, 2, 1], false));
    expect(second.messages.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4']);
    expect(second.more).toBe(false);
    // A page that repeats what the view holds adds it once.
    expect(withEarlier(c, applyPage(NO_EARLIER, page([5, 4], true))).messages.map((m) => m.id)).toEqual(['m-4', 'm-5', 'm-6']);
  });

  it('keeps the same view when nothing was fetched, and never asks again after an empty page', () => {
    const c = steered({ messages: held });
    expect(withEarlier(c, NO_EARLIER)).toBe(c);
    expect(applyPage(NO_EARLIER, { messages: [], acks: [], more: true }).more).toBe(false);
  });

  it('carries the acknowledgements of the earlier messages, once, oldest first', () => {
    const c = steered({ messages: held }, { acks: [ack('k-9', 'm-5', 'ceo', 'Ok.', { at: NOW - min(3) })] });
    const a = ack('k-1', 'm-3', 'ceo', 'Ok.', { at: NOW - min(50) });
    const three = message('m-3', STAKEHOLDER, 'ceo', 'Three.', { at: NOW - min(60) });
    const e = applyPage(applyPage(NO_EARLIER, { messages: [three], acks: [a], more: true }), { messages: [three], acks: [a], more: true });
    expect(withEarlier(c, e).steering?.acks.map((x) => x.id)).toEqual(['k-1', 'k-9']);
  });

  it('keeps the lines that slide out of a live view, so the feed runs without a gap after a page', () => {
    const msg = (n: number) => message(`m-${n}`, STAKEHOLDER, 'ceo', `${n}.`, { at: NOW - min(1000 - n) });
    const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => msg(from + i));
    // The view carries the newest 200 of 400; one page of the 200 before it is fetched.
    const view1 = steered({ messages: range(200, 400) });
    const paged = applyPage(NO_EARLIER, { messages: range(0, 200).reverse(), acks: [], more: true });
    // Fifty messages arrive: the view's window moves forward and m-200 to m-249 leave it.
    const view2 = steered({ messages: range(250, 450) });
    const ids = withEarlier(view2, slideOut(paged, view1, view2)).messages.map((m) => m.id);
    expect(ids).toEqual(range(0, 450).map((m) => m.id));
    // Nothing is held twice when the same slide is folded again.
    expect(slideOut(slideOut(paged, view1, view2), view1, view2).messages).toHaveLength(250);
    // Nothing left the view: the same object comes back.
    expect(slideOut(paged, view2, view2)).toBe(paged);
  });

  it('lets a message unsent while a page is held leave the feed: only the window\'s front slides out', () => {
    const msg = (n: number) => message(`m-${n}`, STAKEHOLDER, 'ceo', `${n}.`, { at: NOW - min(1000 - n) });
    const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => msg(from + i));
    const unsent = msg(399);
    const view1 = steered({ messages: range(200, 400) }, { acks: [ack('k-1', 'm-399', 'ceo', 'Ok.', { at: NOW })] });
    const paged = applyPage(NO_EARLIER, { messages: range(0, 200).reverse(), acks: [], more: true });
    // The newest message is unsent: it leaves the view from its end, not its front.
    const view2 = steered({ messages: range(200, 399) });
    const kept = slideOut(paged, view1, view2);
    expect(kept.messages.map((m) => m.id)).not.toContain(unsent.id);
    expect(kept.acks.map((a) => a.id)).not.toContain('k-1');
    expect(withEarlier(view2, kept).messages.map((m) => m.id)).toEqual(range(0, 399).map((m) => m.id));
  });
});
