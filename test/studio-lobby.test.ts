// v0.3, the lobby as the top level: where its address points, a portfolio card's words, the studio chat's lines, and the
// company's feed naming the studio chat as the sender of its messages.
import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import type { PortfolioView, StudioEntry } from '../src/studio/model.ts';
import { feedLines } from '../web/src/company/feed/feedModel.ts';
import {
  budgetShare, entryLead, entryNews, lobbyPlace, namesJoined, portfolioMoney, portfolioPill, portfolioProgress, readBudget, studioBudgetSpent, studioCardLine, studioParts, studioSpendWords, waitingWords,
} from '../web/src/studio/studioModel.ts';
import { company, message, min, NOW, studio } from './panels-work-kit.ts';

const p = (over: Partial<PortfolioView> = {}): PortfolioView => ({
  id: 'p-client-work', name: 'Client work', companies: ['plant-pal', 'corner-bakery'], budget: 20, brief: null, createdAt: 1, line: 'Two working.', stages: { working: 2 },
  milestones: { done: 1, planned: 4 }, tasks: { done: 5, planned: 12 }, working: 3, spent: 7.5, level: 'ok', needsYou: 0, firstNeed: null, held: false, ...over,
});

describe('the lobby as the top level', () => {
  it('reads its address: the list, the studio chat, a new portfolio or one portfolio', () => {
    expect(lobbyPlace('/')).toEqual({ kind: 'list' });
    expect(lobbyPlace('/studio')).toEqual({ kind: 'studio' });
    expect(lobbyPlace('/p/new')).toEqual({ kind: 'new-portfolio' });
    expect(lobbyPlace('/p/p-client%20work')).toEqual({ kind: 'portfolio', id: 'p-client work' });
    expect(lobbyPlace('/p/%E0%A4%A')).toEqual({ kind: 'list' });
    expect(lobbyPlace('/new')).toEqual({ kind: 'list' });
  });

  it("reads a lobby from a hub without the studio's parts (the demo, an older hub) as having none", () => {
    expect(studioParts({ companies: [], hub: { maxDesks: 8, working: 0 }, serverTime: 0 })).toEqual({ portfolios: [], studio: null });
  });

  it("words a portfolio's card: money against the budget, its pill, its progress", () => {
    expect(portfolioMoney(p())).toBe('$7.50 of $20 budget');
    expect(portfolioMoney(p({ budget: null }))).toBe('$7.50, no shared budget');
    expect(budgetShare(p())).toBe(0.375);
    expect(budgetShare(p({ budget: null }))).toBeNull();
    expect(portfolioPill(p())).toEqual({ word: 'Two companies', tone: 'neutral' });
    expect(portfolioPill(p({ companies: [] }))).toEqual({ word: 'No companies', tone: 'neutral' });
    expect(portfolioPill(p({ level: 'warning' })).tone).toBe('needs');
    expect(portfolioPill(p({ held: true }))).toEqual({ word: 'Paused', tone: 'rest' });
    expect(portfolioProgress(p())).toEqual({ line: '1 of 4 milestones, 5 of 12 tasks', share: 5 / 12 });
    expect(portfolioProgress(p({ tasks: { done: 0, planned: 0 } }))).toEqual({ line: 'No plan yet', share: null });
  });

  it('reads a budget typed in a box, empty for none, and says what is wrong in a sentence', () => {
    expect(readBudget(' $1,250.456 ')).toEqual({ ok: true, value: 1250.46 });
    expect(readBudget('')).toEqual({ ok: true, value: null });
    expect(readBudget('0')).toMatchObject({ ok: false });
    expect(readBudget('lots')).toEqual({ ok: false, why: 'A budget is a dollar amount from $0.01 to $1,000,000, or empty for none.' });
  });
});

describe("the studio chat's lines", () => {
  const e = (over: Partial<StudioEntry>): StudioEntry => ({ id: 'e-1', at: 1, kind: 'studio', text: 'x', ...over });

  it('says who speaks in each line, and reads out answers but not your own words', () => {
    expect(entryLead(e({ kind: 'you' }))).toBe('You');
    expect(entryLead(e({ kind: 'relay', companies: [{ id: 'a', name: 'Plant Pal' }, { id: 'b', name: 'Corner Bakery' }] }))).toBe('Asked the CEOs of Plant Pal and Corner Bakery');
    expect(entryLead(e({ kind: 'relay', companies: [{ id: 'a', name: 'Plant Pal' }] }))).toBe('Asked the CEO of Plant Pal');
    expect(entryLead(e({ kind: 'reply', by: 'Mara, the CEO', companies: [{ id: 'a', name: 'Plant Pal' }] }))).toBe('Mara, the CEO at Plant Pal');
    expect(entryNews(e({ kind: 'you' }))).toBeNull();
    expect(entryNews(e({ kind: 'studio' }))).toBe('The studio chat answered.');
    expect(namesJoined(['A', 'B', 'C'])).toBe('A, B and C');
    expect(waitingWords(0)).toBeNull();
    expect(waitingWords(2)).toBe('Waiting for two messages to be answered by CEOs; answers show here as they come.');
  });

  it("puts the latest answer on the lobby's studio card, or what the chat is for", () => {
    const view = { model: 'sonnet' as const, state: 'idle' as const, problem: null, spent: 0, budget: 5, waiting: 0, entries: [] as StudioEntry[] };
    expect(studioCardLine(view)).toContain('It costs nothing until you write.');
    expect(studioCardLine({ ...view, state: 'thinking' })).toBe('Thinking…');
    expect(studioCardLine({ ...view, entries: [e({ kind: 'studio', text: 'All fine.' }), e({ kind: 'reply', text: 'Half done.', by: 'Mara, the CEO', companies: [{ id: 'a', name: 'Plant Pal' }] })] })).toBe('Mara, the CEO at Plant Pal: Half done.');
  });

  it("shows the studio chat's own spend against its budget, and when that budget is spent", () => {
    expect(studioSpendWords({ spent: 0, budget: 5 })).toBe('Nothing of its $5.00 budget spent');
    expect(studioSpendWords({ spent: 0.42, budget: 5 })).toBe('$0.42 of its $5.00 budget spent');
    expect(studioBudgetSpent({ spent: 4.99, budget: 5 })).toBe(false);
    expect(studioBudgetSpent({ spent: 5, budget: 5 })).toBe(true);
  });
});

describe("a company's feed", () => {
  it('names the studio chat as the sender of its message, never you, and the CEO as replying', () => {
    const sent = message('m-3', STAKEHOLDER, 'ceo', 'How far along?', { fromOffice: true, fromStudio: true, deliveredAt: NOW - min(2) });
    const reply = message('m-4', 'ceo', STAKEHOLDER, 'Half done.', { turnReply: true, cites: ['m-3'] });
    const lines = feedLines({ studio }, company({ messages: [sent, reply] }), NOW);
    expect(lines.find((l) => l.about === 'm-3')).toMatchObject({ lead: expect.stringMatching(/^Studio chat to /), yours: false });
    expect(lines.some((l) => l.lead.startsWith('You to'))).toBe(false);
    const answer = lines.find((l) => l.id === 'm:m-4');
    expect(answer?.sentence.map((x) => (typeof x === 'string' ? x : x.text)).join('')).toMatch(/ replied$/);
  });
});
