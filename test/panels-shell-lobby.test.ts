// The lobby's own words (web/src/company/lobby/lobbyModel.ts): company names told apart, what needs you, paths in
// sentences.
import { describe, expect, it } from 'vitest';
import { type CompanySummary, type NeedsYouItem, STAGES } from '../src/core/company.ts';
import { needsAcross } from '../src/core/overview.ts';
import { companyHref } from '../web/src/company/address.ts';
import { cardLines, checklistLine, lobbyNames, moreWords, needsLine, needsStrip, needsWords, progressLine, routeOf, shortenPaths, spendLine, stageWord } from '../web/src/company/lobby/lobbyModel.ts';

const company = (id: string, name: string, root: string) => ({ id, name, root });

describe("a company's name in the lobby", () => {
  it('stays as it is when no other company has it', () => {
    const names = lobbyNames([company('cafe', 'Café Lumen', 'C:\\Users\\you\\cafe-lumen'), company('plant', 'Plant Pal', 'C:\\Users\\you\\plant-pal')]);
    expect([...names]).toEqual([
      ['cafe', 'Café Lumen'],
      ['plant', 'Plant Pal'],
    ]);
  });

  it('is told apart by its folder from others of the same name, whatever their case', () => {
    const names = lobbyNames([company('a', 'Plant Pal', 'C:\\Users\\you\\plant-phone'), company('b', 'plant pal', 'C:\\Users\\you\\plant-desktop\\'), company('c', 'Café', 'C:\\c')]);
    expect(names.get('a')).toBe('Plant Pal in plant-phone');
    expect(names.get('b')).toBe('plant pal in plant-desktop');
    expect(names.get('c')).toBe('Café');
  });

  it('is told apart by more of the path when the folders have the same name too', () => {
    const names = lobbyNames([company('a', 'Plant Pal', 'C:\\Users\\you\\work\\plant-pal'), company('b', 'Plant Pal', 'D:\\plant-pal')]);
    expect(names.get('a')).toBe('Plant Pal in C:\\Users\\you\\work\\plant-pal');
    expect(names.get('b')).toBe('Plant Pal in D:\\plant-pal');
    expect(new Set(names.values()).size).toBe(2);
  });

  it('says what needs you in words', () => {
    expect(needsWords(0)).toBe('');
    expect(needsWords(1)).toBe(', one needs you');
    expect(needsWords(3)).toBe(', three need you');
  });
});

describe("a path in the office's sentences", () => {
  const long = 'C:\\Users\\jamie\\AppData\\Local\\Temp\\claude\\scratchpad\\companies\\plant-phone';

  it('is cut in the middle so it fits, its last folder kept', () => {
    expect(shortenPaths(`Its folder isn't at ${long} any more. Put it back, or remove the company from the lobby.`)).toBe(
      "Its folder isn't at C:\\Users\\…\\plant-phone any more. Put it back, or remove the company from the lobby.",
    );
    expect(shortenPaths(`It ran from ${long}.`)).toBe('It ran from C:\\Users\\…\\plant-phone.');
    expect(shortenPaths('Its folder isn\'t at /home/you/projects/clients/2026/autumn/plant-phone any more.')).toBe("Its folder isn't at /home/…/plant-phone any more.");
  });

  it("is found whole when it is a company's own folder, spaces and all", () => {
    const spaced = 'C:\\Users\\jamie\\Desktop\\Development\\ledger-app\\companies\\ledger';
    expect(shortenPaths(`Its folder isn't at ${spaced} any more.`, [spaced])).toBe("Its folder isn't at C:\\Users\\…\\ledger any more.");
  });

  it('leaves short paths and other words alone', () => {
    expect(shortenPaths("Its folder isn't at C:\\work\\plant any more, and/or moved.")).toBe("Its folder isn't at C:\\work\\plant any more, and/or moved.");
    expect(shortenPaths('Nobody is at work.')).toBe('Nobody is at work.');
  });
});

// v0.2: the card's TL;DR, the stage in a word and where a needs-you item opens (SPEC-v0.2.md, "Simple, visible, proven", 1).
describe("a company's card", () => {
  const NOW = Date.UTC(2026, 10, 13, 18, 0);
  const summary = (over: Partial<CompanySummary> = {}): CompanySummary => ({
    goal: 'A bilingual website for Café Lumen.',
    stage: 'working',
    milestones: { done: 1, planned: 3 },
    tasks: { done: 11, planned: 16 },
    achieved: [
      { title: 'Order status page', by: 'Kai', at: NOW - 600_000 },
      { title: 'Menu page layout', by: 'Mina', at: NOW - 3_600_000 },
    ],
    working: [
      { name: 'Theo', task: 'Pickup orders' },
      { name: 'Kai', task: 'Pickup slot picker' },
      { name: 'Ines', task: null },
      { name: 'Sofia', task: 'Pay with TWINT' },
    ],
    needs: { count: 2, items: [{ company: 'cafe', kind: 'question', text: 'Which pickup window?', from: 'Mina', at: NOW - 360_000, target: { panel: 'inbox', item: 'q-3' } }] },
    spend: { spent: 4.2, budget: 20 },
    preview: null,
    movedAt: NOW - 12 * 60_000,
    checklist: null,
    ...over,
  });

  it('says where it stands in lines a person reads, with no ids', () => {
    const card = cardLines(summary(), NOW);
    expect(card).toEqual({
      goal: 'A bilingual website for Café Lumen.',
      stage: { word: 'Working', tone: 'working' },
      progress: { line: '1 of 3 milestones, 11 of 16 tasks', share: 11 / 16 },
      needs: { count: 2, first: 'Mina: Which pickup window?' },
      finished: ['Order status page', 'Menu page layout'],
      now: ['Theo on “Pickup orders”', 'Kai on “Pickup slot picker”', 'Ines'],
      nowMore: 1,
      spend: '$4.20 of $20 budget',
      checklist: null,
      moved: 'Moved 12 min ago',
    });
    expect(moreWords(1)).toBe('and one more');
  });

  it('says money without a budget, a company with no plan yet, and nothing it has none of', () => {
    const card = cardLines(summary({ goal: '  ', milestones: { done: 0, planned: 0 }, tasks: { done: 0, planned: 0 }, achieved: [], working: [], needs: { count: 0, items: [] }, spend: { spent: 0, budget: null }, movedAt: null }), NOW);
    expect(card).toMatchObject({ goal: null, progress: { line: 'No plan yet', share: null }, needs: { count: 0, first: null }, finished: [], now: [], spend: 'Nothing spent yet', moved: null });
    expect(spendLine({ spent: 4.2, budget: null })).toBe('$4.20, no budget');
    expect(spendLine({ spent: 0, budget: 12.5 })).toBe('$0 of $12.50 budget');
    expect(progressLine({ milestones: { done: 0, planned: 0 }, tasks: { done: 1, planned: 1 } })).toEqual({ line: '1 of 1 task', share: 1 });
  });

  it('says the checklist once the final review has marked it', () => {
    expect(checklistLine({ met: 0, partly: 0, 'not-met': 0, unchecked: 6 })).toBeNull();
    expect(checklistLine({ met: 5, partly: 1, 'not-met': 0, unchecked: 0 })).toBe('5 of 6 met, 1 partly met');
    expect(checklistLine({ met: 3, partly: 0, 'not-met': 1, unchecked: 2 })).toBe('3 of 6 met, 1 not met, 2 not checked');
    expect(checklistLine(null)).toBeNull();
  });

  it('puts every stage in a word, waiting for you on the highlighter', () => {
    expect(STAGES.map((s) => stageWord(s).word)).toEqual(['Scoping', 'Waiting for your OK', 'Working', 'Checking', 'Done', 'Paused', 'Stuck']);
    expect(stageWord('waiting').tone).toBe('needs');
    expect(stageWord('stuck').tone).toBe('error');
  });

  it('opens each needs-you item at its place: the inbox on its item, the proposal or progress, the plan as its own view', () => {
    expect(routeOf({ panel: 'inbox', item: 'q-3' })).toEqual({ main: { kind: 'progress' }, panel: { kind: 'inbox', item: 'q-3' } });
    expect(routeOf({ panel: 'proposal' })).toEqual({ main: { kind: 'progress' }, panel: { kind: 'proposal' } });
    expect(routeOf({ main: 'plan' })).toEqual({ main: { kind: 'plan', version: null }, panel: null });
    expect(routeOf({ main: 'progress' })).toEqual({ main: { kind: 'progress' }, panel: null });
    expect(companyHref('cafe', routeOf({ panel: 'inbox', item: 'q-3' }))).toBe('/c/cafe/progress?panel=inbox/q-3');
    expect(needsLine({ from: null, text: 'Work has stopped with 2 tasks still open.' })).toBe('Work has stopped with 2 tasks still open.');
  });
});

describe('the needs-you strip across companies', () => {
  it('takes every company’s items oldest first, all of them, and none from a company without a summary', () => {
    const item = (company: string, at: number): NeedsYouItem => ({ company, kind: 'question', text: `Q ${at}`, from: null, at, target: { panel: 'inbox', item: `q-${at}` } });
    const withItems = (id: string, ats: number[]) => ({ summary: { needs: { count: ats.length, items: ats.map((at) => item(id, at)) } } as CompanySummary });
    const all = needsAcross([withItems('a', [5, 1, 9]), { summary: undefined }, withItems('b', [3, 2, 8, 7, 6, 4])]);
    expect(all.map((i) => i.at)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('says one number: the badge is every item, three show, and "Show all" opens all of them', () => {
    const items = Array.from({ length: 14 }, (_, n) => n);
    const closed = needsStrip(items, false);
    expect(closed.total).toBe(14);
    expect(closed.shown).toEqual([0, 1, 2]);
    expect(closed.toggle).toBe('Show all 14');
    const open = needsStrip(items, true);
    expect(open.shown).toHaveLength(14);
    expect(open.toggle).toBe('Show fewer');
    expect(needsStrip(items.slice(0, 8), false).toggle).toBe('Show all eight');
    expect(needsStrip(items.slice(0, 3), false)).toEqual({ total: 3, shown: [0, 1, 2], toggle: null });
  });
});
