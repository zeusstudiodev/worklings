// The studio's words in the lobby (SPEC-v0.3.md, S3): where the lobby's address points (the list, the studio chat, a
// portfolio), a portfolio card's lines, and each line of the studio chat. Pure, for tests.
import type { LobbyCompany, LobbyView } from '../../../src/core/company.ts';
import { countWord } from '../../../src/core/now.ts';
import type { PortfolioView, StudioEntry, StudioLobbyView, StudioModel, StudioView } from '../../../src/studio/model.ts';
import { dollars } from '../lib/format.ts';
import { capWords } from '../company/spending/spendingModel.ts';
import type { StateTone } from '../company/ui/tone.ts';

/** Where the lobby's address points: `/`, `/studio`, `/p/new` or `/p/<id>`. */
export type LobbyPlace = { kind: 'list' } | { kind: 'studio' } | { kind: 'new-portfolio' } | { kind: 'portfolio'; id: string };

export function lobbyPlace(path: string): LobbyPlace {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'studio') return { kind: 'studio' };
  if (parts.length === 2 && parts[0] === 'p') {
    let id = parts[1] ?? '';
    try {
      id = decodeURIComponent(id);
    } catch {
      return { kind: 'list' };
    }
    return id === 'new' ? { kind: 'new-portfolio' } : { kind: 'portfolio', id };
  }
  return { kind: 'list' };
}

export const portfolioPath = (id: string): string => `/p/${encodeURIComponent(id)}`;
export const STUDIO_PATH = '/studio';

/** The studio's parts of a lobby, empty for a hub (or the demo) that has none. */
export function studioParts(lobby: LobbyView): { portfolios: PortfolioView[]; studio: StudioView | null } {
  const s = lobby as Partial<StudioLobbyView>;
  return { portfolios: Array.isArray(s.portfolios) ? s.portfolios : [], studio: s.studio ?? null };
}

export const MODEL_WORDS: Record<StudioModel, string> = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' };

/** "$4.20 of $20 budget", "$4.20, no shared budget". */
export function portfolioMoney(p: Pick<PortfolioView, 'spent' | 'budget'>): string {
  return p.budget === null ? `${dollars(p.spent)}, no shared budget` : `${dollars(p.spent)} of ${capWords(p.budget)} budget`;
}

/** The share of the budget spent, for the card's meter; null without a budget. */
export const budgetShare = (p: Pick<PortfolioView, 'spent' | 'budget'>): number | null => (p.budget === null || p.budget <= 0 ? null : Math.min(1, p.spent / p.budget));

/** The card's pill: paused while held, else how many companies. */
export function portfolioPill(p: Pick<PortfolioView, 'held' | 'companies' | 'level'>): { word: string; tone: StateTone } {
  if (p.held) return { word: 'Paused', tone: 'rest' };
  const n = p.companies.length;
  return { word: `${n === 0 ? 'No' : countWord(n).replace(/^./, (c) => c.toUpperCase())} ${n === 1 ? 'company' : 'companies'}`, tone: p.level === 'warning' ? 'needs' : 'neutral' };
}

/** "11 of 26 tasks", "No plan yet". */
export function portfolioProgress(p: Pick<PortfolioView, 'tasks' | 'milestones'>): { line: string; share: number | null } {
  if (p.tasks.planned === 0) return { line: 'No plan yet', share: null };
  const ms = p.milestones.planned > 0 ? `${p.milestones.done} of ${p.milestones.planned} milestones, ` : '';
  return { line: `${ms}${p.tasks.done} of ${p.tasks.planned} tasks`, share: Math.min(1, p.tasks.done / p.tasks.planned) };
}

/** The companies in a portfolio, in its order, and the lobby's others. */
export function membersOf(p: Pick<PortfolioView, 'companies'>, companies: readonly LobbyCompany[]): LobbyCompany[] {
  return p.companies.flatMap((id) => companies.filter((c) => c.id === id));
}

export function outside(portfolios: readonly Pick<PortfolioView, 'companies'>[], companies: readonly LobbyCompany[]): LobbyCompany[] {
  const inOne = new Set(portfolios.flatMap((p) => p.companies));
  return companies.filter((c) => !inOne.has(c.id));
}

/** What the studio chat card in the list says: the last answer, or what it is for. */
export function studioCardLine(s: StudioView | null): string {
  if (!s) return 'Ask across every company.';
  if (s.state === 'thinking' || s.state === 'starting') return 'Thinking…';
  const last = [...s.entries].reverse().find((e) => e.kind === 'studio' || e.kind === 'reply');
  if (!last) return 'Ask across every company: it reads them all and can message a team\'s CEO. It costs nothing until you write.';
  return last.kind === 'reply' ? `${last.by ?? 'A CEO'}${last.companies?.[0] ? ` at ${last.companies[0].name}` : ''}: ${last.text}` : last.text;
}

/** The studio chat's own spend against its budget: "$0.42 of its $5.00 budget". */
export const studioSpendWords = (s: Pick<StudioView, 'spent' | 'budget'>): string => `${s.spent > 0 ? dollars(s.spent) : 'Nothing'} of its ${dollars(s.budget)} budget spent`;

/** Whether the studio chat has spent its own budget, so it takes no new message. */
export const studioBudgetSpent = (s: Pick<StudioView, 'spent' | 'budget'>): boolean => s.spent >= s.budget;

/** "$0.03", what one answer cost; "Cost unknown" when Claude Code didn't say. */
export const costWords = (cost: number | null | undefined): string => (typeof cost === 'number' ? `${dollars(cost)}, API-equivalent` : 'Cost unknown');

/** Names joined: "Plant Pal", "Plant Pal and Corner Bakery", "Plant Pal, Corner Bakery and Tool API". */
export function namesJoined(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The lead of a line in the chat: who says it. */
export function entryLead(e: StudioEntry): string {
  switch (e.kind) {
    case 'you':
      return 'You';
    case 'studio':
      return 'Studio chat';
    case 'relay': {
      const names = (e.companies ?? []).map((c) => c.name);
      return `Asked the ${names.length === 1 ? 'CEO' : 'CEOs'} of ${namesJoined(names)}`;
    }
    case 'reply':
      return `${e.by ?? 'The CEO'} at ${e.companies?.[0]?.name ?? 'a company'}`;
    default:
      return 'The office';
  }
}

/** What the screen reader hears when a line arrives; null for the stakeholder's own. */
export function entryNews(e: StudioEntry): string | null {
  if (e.kind === 'studio') return 'The studio chat answered.';
  if (e.kind === 'reply') return `${entryLead(e)} answered.`;
  if (e.kind === 'note') return e.text;
  return null;
}

/** What the box above the chat says about waiting answers. */
export function waitingWords(n: number): string | null {
  if (n === 0) return null;
  return `Waiting for ${n === 1 ? 'one message' : `${countWord(n)} messages`} to be answered by CEOs; answers show here as they come.`;
}

/** Things to ask, for an empty chat. */
export const STARTERS = ['How far along is every company?', 'What waits on me, and where do I click?', 'Ask every CEO what they need from me this week.'] as const;

/** A budget typed in a box: dollars to the cent, null for none, or a sentence saying what is wrong. */
export function readBudget(text: string): { ok: true; value: number | null } | { ok: false; why: string } {
  const t = text.trim().replace(/^\$/, '').replaceAll(',', '');
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0.01 || n > 1_000_000) return { ok: false, why: 'A budget is a dollar amount from $0.01 to $1,000,000, or empty for none.' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}
