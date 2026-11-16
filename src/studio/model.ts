// v0.3, the studio over many companies (SPEC-v0.3.md, "Stream S"): the shapes the hub, the studio chat and the lobby
// share, and the portfolio's roll-up from its companies' lobby entries. Pure, with no Node APIs: the web app imports it.
import type { CompanyStage, LobbyCompany, LobbyView, NeedsYouItem, Pause } from '../core/company.ts';
import { countWord } from '../core/now.ts';
import { budgetLevel, type BudgetLevel } from '../core/spending.ts';

/** What a portfolio and the studio chat take, in characters (lists in entries). */
export const STUDIO_LIMITS = {
  name: 60,
  brief: 4_000,
  /** Companies in one portfolio. */
  members: 100,
  portfolios: 50,
  /** What the stakeholder types into the studio chat, and what it sends a CEO. */
  message: 4_000,
  /** Entries the chat keeps, oldest dropped first. */
  entries: 200,
  /** Relays kept, oldest dropped first. */
  relays: 50,
  /** A CEO's reply as the chat keeps it. */
  reply: 2_000,
} as const;

/** The models the studio chat may run on; Sonnet unless the stakeholder picks another. */
export const STUDIO_MODELS = ['sonnet', 'opus', 'haiku'] as const;
export type StudioModel = (typeof STUDIO_MODELS)[number];
export const DEFAULT_STUDIO_MODEL: StudioModel = 'sonnet';

/** What the studio chat itself may spend, API-equivalent dollars, until the stakeholder raises it. */
export const DEFAULT_STUDIO_BUDGET = 5;
/** The studio chat's budget runs from a cent to this. */
export const MAX_STUDIO_BUDGET = 10_000;

/** Why the studio chat takes no new message once its own budget is spent, and how to raise it. */
export const studioBudgetSentence = (budget: number): string =>
  `The studio chat has spent its ${money(budget)} budget. Raise its budget at the top of the chat to ask more.`;

/** A group of companies with a shared budget and an optional brief. A company is in at most one. */
export interface Portfolio {
  /** "p-client-work": its address (/p/<id>). */
  id: string;
  name: string;
  /** Company ids, in the order they were added. */
  companies: string[];
  /** Dollars, API-equivalent, to the cent; null: none. A hard cap on what its companies spend together. */
  budget: number | null;
  /** The stakeholder's words for every company in it; they reach each CEO through its brief file. */
  brief: string | null;
  createdAt: number;
}

/** A portfolio as the lobby shows it: the portfolio and its companies rolled up. */
export interface PortfolioView extends Portfolio {
  /** What is happening, in one line: "Two working, one waiting for your OK." */
  line: string;
  /** The companies by stage, for the card's pills. */
  stages: Partial<Record<CompanyStage, number>>;
  milestones: { done: number; planned: number };
  tasks: { done: number; planned: number };
  /** People at work across its companies. */
  working: number;
  /** What its companies have spent together, API-equivalent. */
  spent: number;
  /** Where the spend stands against the budget; 'ok' without one. */
  level: BudgetLevel;
  /** Things that wait on the stakeholder across its companies (each inbox's count). */
  needsYou: number;
  /** The oldest of what waits, across its companies; null when nothing does. */
  firstNeed: NeedsYouItem | null;
  /** The budget is spent: every company in it is paused until it is raised or taken off. */
  held: boolean;
}

/** One line in the studio chat. */
export interface StudioEntry {
  id: string;
  at: number;
  /**
   * you: what the stakeholder typed. studio: the studio chat's answer. relay: what it sent to CEOs (shown as sent). reply:
   * a CEO's answer to a relay, in that company's words. note: the office's own line (a stop, a failure).
   */
  kind: 'you' | 'studio' | 'relay' | 'reply' | 'note';
  text: string;
  /** studio: what the answer cost, API-equivalent; null when Claude Code didn't say. */
  cost?: number | null;
  /** relay and reply: the companies it went to, or the one that answered. */
  companies?: { id: string; name: string }[];
  /** reply: who answered ("Mara, the CEO"). */
  by?: string;
  /** relay and reply: the relay's id. */
  relay?: string;
}

export type StudioState = 'idle' | 'starting' | 'thinking' | 'failed';

/** The studio chat as the lobby shows it. */
export interface StudioView {
  model: StudioModel;
  state: StudioState;
  /** Why the last answer failed, in a sentence; null otherwise. */
  problem: string | null;
  /** Newest last, at most STUDIO_LIMITS.entries. */
  entries: StudioEntry[];
  /** What the studio chat itself has spent so far; the CEOs' answers count in their own companies. */
  spent: number;
  /** What it may spend before it takes no new message, API-equivalent dollars. */
  budget: number;
  /** Relays still waiting for a CEO's answer. */
  waiting: number;
}

/** The hub's lobby with the studio's parts: what /api/lobby and the lobby stream send since v0.3. */
export interface StudioLobbyView extends LobbyView {
  portfolios: PortfolioView[];
  studio: StudioView;
}

/** The order stages are named in a portfolio's line: what needs the stakeholder first. */
const STAGE_ORDER: readonly CompanyStage[] = ['waiting', 'stuck', 'working', 'checking', 'scoping', 'paused', 'done'];
const STAGE_WORDS: Record<CompanyStage, string> = {
  waiting: 'waiting for your OK',
  stuck: 'stuck',
  working: 'working',
  checking: 'checking',
  scoping: 'scoping',
  paused: 'paused',
  done: 'done',
};

/** A company's stage as a portfolio counts it: its card's, or stuck for one that can't run. */
export function stageOfEntry(c: Pick<LobbyCompany, 'summary' | 'problem' | 'pause'>): CompanyStage {
  if (c.problem) return 'stuck';
  return c.summary?.stage ?? (c.pause ? 'paused' : 'scoping');
}

const money = (n: number): string => (n >= 10 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);

/** "Paused: the Client work portfolio's $50 budget is spent. Raise it on the portfolio in the lobby to carry on." */
export const portfolioPauseSentence = (p: Pick<Portfolio, 'name' | 'budget'>): string =>
  `Paused: the ${p.name} portfolio's ${money(p.budget ?? 0)} budget is spent. Raise it on the portfolio in the lobby to carry on.`;

/** The pause a company in a spent portfolio shows, as the company's own budget pause reads. */
export function portfolioPause(p: Pick<Portfolio, 'name' | 'budget'>, since: number): Pause {
  return { reason: 'budget', since, until: null, message: portfolioPauseSentence(p) };
}

/** Whether a portfolio's companies together have spent its budget. */
export const portfolioSpent = (p: Pick<Portfolio, 'budget'>, spent: number): boolean => p.budget !== null && budgetLevel(spent, p.budget) === 'paused';

/** "Two working, one waiting for your OK." from the companies' stages; "No companies in it yet." when empty. */
export function portfolioLine(stages: Partial<Record<CompanyStage, number>>, held: boolean, p: Pick<Portfolio, 'name' | 'budget'>): string {
  if (held) return `Paused: its ${money(p.budget ?? 0)} budget is spent.`;
  const parts = STAGE_ORDER.flatMap((s) => {
    const n = stages[s] ?? 0;
    return n > 0 ? [`${countWord(n)} ${STAGE_WORDS[s]}`] : [];
  });
  if (parts.length === 0) return 'No companies in it yet.';
  const line = parts.join(', ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/** The portfolio rolled up from its companies' lobby entries (companies that left the lobby are skipped). */
export function rollUp(p: Portfolio, companies: readonly LobbyCompany[]): PortfolioView {
  const members = p.companies.flatMap((id) => companies.filter((c) => c.id === id));
  const stages: Partial<Record<CompanyStage, number>> = {};
  const milestones = { done: 0, planned: 0 };
  const tasks = { done: 0, planned: 0 };
  let working = 0;
  let spent = 0;
  let needsYou = 0;
  const needs: NeedsYouItem[] = [];
  for (const c of members) {
    const stage = stageOfEntry(c);
    stages[stage] = (stages[stage] ?? 0) + 1;
    working += c.working;
    spent += c.summary?.spend.spent ?? c.spend;
    needsYou += c.needsYou;
    if (c.summary) {
      milestones.done += c.summary.milestones.done;
      milestones.planned += c.summary.milestones.planned;
      tasks.done += c.summary.tasks.done;
      tasks.planned += c.summary.tasks.planned;
      needs.push(...c.summary.needs.items);
    }
  }
  needs.sort((a, b) => a.at - b.at);
  const held = portfolioSpent(p, spent);
  return {
    ...p,
    companies: [...p.companies],
    line: portfolioLine(stages, held, p),
    stages,
    milestones,
    tasks,
    working,
    spent: Math.round(spent * 100) / 100,
    level: p.budget === null ? 'ok' : budgetLevel(spent, p.budget),
    needsYou,
    firstNeed: needs[0] ?? null,
    held,
  };
}
