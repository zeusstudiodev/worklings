// The studio's routes (docs/architecture.md, "The hub's routes"): the studio chat and the portfolios, each refusal an
// ActionError carrying the hub's sentence, as every other action in the lobby.
import type { Portfolio, StudioEntry, StudioModel } from '../../../src/studio/model.ts';
import { exchange, refusal } from '../company/api.ts';

export interface PortfolioChange {
  name?: string;
  companies?: string[];
  /** Dollars, or null for none. */
  budget?: number | null;
  brief?: string | null;
}

export interface StudioActions {
  say(text: string): Promise<StudioEntry>;
  stop(): Promise<void>;
  setModel(model: StudioModel): Promise<void>;
  /** The studio chat's own budget, in dollars. */
  setBudget(budget: number): Promise<void>;
  clear(): Promise<void>;
  createPortfolio(change: PortfolioChange & { name: string }): Promise<Portfolio>;
  updatePortfolio(id: string, change: PortfolioChange): Promise<Portfolio>;
  deletePortfolio(id: string): Promise<Portfolio>;
}

async function call<T>(path: string, token: string | null, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const answer = await exchange(path, token, init);
  if (!answer.ok) throw refusal(answer.status, answer.body);
  return answer.body as T;
}

export function liveStudio(token: string | null): StudioActions {
  const portfolio = (id: string) => `/api/portfolios/${encodeURIComponent(id)}`;
  return {
    say: (text) => call<StudioEntry>('/api/studio/messages', token, { body: { text } }),
    stop: async () => void (await call('/api/studio/stop', token, { body: {} })),
    setModel: async (model) => void (await call('/api/studio/settings', token, { body: { model } })),
    setBudget: async (budget) => void (await call('/api/studio/settings', token, { body: { budget } })),
    clear: async () => void (await call('/api/studio/clear', token, { body: {} })),
    createPortfolio: (change) => call<Portfolio>('/api/portfolios', token, { body: change }),
    updatePortfolio: (id, change) => call<Portfolio>(portfolio(id), token, { body: change }),
    deletePortfolio: (id) => call<Portfolio>(portfolio(id), token, { method: 'DELETE' }),
  };
}
