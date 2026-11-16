// The studio over many companies in the hub (SPEC-v0.3.md, "Stream S"): the portfolios (src/studio/portfolios.ts) with
// their shared budget held on each company's desks (hold.ts) and their shared brief in each company's brief file, the
// studio chat (src/studio/chat.ts) with its tools over MCP for its own desk token, and the routes the lobby calls.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CompanyHandle, LobbyCompany, NeedsYouItem } from '../core/company.ts';
import { safeId } from '../core/events.ts';
import type { Harness } from '../runtime/harness.ts';
import { HttpError, readBody, send } from '../server/http.ts';
import { StudioChat, STUDIO_PERSON } from '../studio/chat.ts';
import { mcpServer } from '../studio/mcp.ts';
import { type Portfolio, portfolioPause, type PortfolioView, rollUp, type StudioLobbyView } from '../studio/model.ts';
import { PortfolioStore } from '../studio/portfolios.ts';
import { runStudioTool, STUDIO_TOOLS, type StudioCompany } from '../studio/tools.ts';
import type { Hold } from './hold.ts';
import { company, fields } from './input.ts';
import type { NodeHandler } from './seams.ts';
import type { OpenSeat, Seat } from './seat.ts';
import type { DeskTokens } from './tokens.ts';

/** The studio desk's key in the hub's desk-token table: never a company's id (those are slugs with no "@"). */
export const STUDIO_KEY = '@studio';
const KB = 1024;

export interface StudioWiring {
  dir: string;
  /** Every company in the lobby, open or not, in the lobby's order. */
  seats: () => Seat[];
  /** A company's lobby entry as the hub builds it, before the studio's own touches. */
  entryOf: (seat: Seat) => LobbyCompany;
  holdOf: (handle: CompanyHandle) => Hold | undefined;
  tokens: DeskTokens;
  hubUrl: () => string;
  harness: () => Harness;
  stakeholder: () => string;
  /** The lobby changed. */
  changed: () => void;
  now: () => number;
  warn: (line: string) => void;
}

export interface HubStudio {
  /** Whether a desk token is the studio desk's. */
  owns(token: string | null): boolean;
  /** The studio chat's tools, for its desk's token. */
  mcp: NodeHandler;
  /** The lobby with the studio's parts: each company's entry with its portfolio's pause, the portfolios, the chat. */
  lobby(companies: LobbyCompany[], base: Omit<StudioLobbyView, 'companies' | 'portfolios' | 'studio'>): StudioLobbyView;
  /** Each company's portfolio pause and brief, and the CEOs' answers: the hub calls it every second and after a change. */
  settle(): void;
  /** Routes under /api/portfolios and /api/studio; false for anything else. */
  route(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean>;
  /** A company left the lobby: it leaves its portfolio too. */
  forget(companyId: string): void;
  close(): Promise<void>;
}

export function hubStudio(w: StudioWiring): HubStudio {
  const store = new PortfolioStore(w.dir, { now: w.now, warn: w.warn });
  /** When each portfolio's budget was found spent, for the pause's "since". */
  const heldSince = new Map<string, number>();
  /** The shared brief each company has, as last set, so it is set again only when it changes. */
  const briefs = new Map<string, string>();

  const open = (): OpenSeat[] => w.seats().filter((s): s is OpenSeat => s.state === 'open');
  const nameOf = (id: string): string | null => {
    const seat = w.seats().find((s) => s.id === id);
    if (!seat) return null;
    try {
      return w.entryOf(seat).name;
    } catch {
      return id;
    }
  };

  /** The portfolios rolled up from the companies' own entries. */
  const views = (raw: readonly LobbyCompany[]): PortfolioView[] => store.all().map((p) => rollUp(p, raw));

  const pausedBy = (id: string, portfolios: readonly PortfolioView[]): PortfolioView | undefined => portfolios.find((p) => p.held && p.companies.includes(id));

  /** A company's entry with its portfolio's pause, when the portfolio holds it and nothing else paused it first. */
  function decorate(entry: LobbyCompany, portfolios: readonly PortfolioView[]): LobbyCompany {
    const p = pausedBy(entry.id, portfolios);
    if (!p || entry.pause) return entry;
    const pause = portfolioPause(p, heldSince.get(p.id) ?? w.now());
    const item: NeedsYouItem = { company: entry.id, kind: 'budget', text: pause.message, from: null, at: pause.since, target: { main: 'progress' } };
    const summary = entry.summary ? { ...entry.summary, stage: 'paused' as const, needs: { ...entry.summary.needs, items: [...entry.summary.needs.items, item].sort((a, b) => a.at - b.at) } } : undefined;
    return { ...entry, pause, ...(summary ? { summary } : {}) };
  }

  const rawEntries = (): LobbyCompany[] => w.seats().map((s) => w.entryOf(s));

  function studioCompany(seat: Seat, portfolios: () => PortfolioView[]): StudioCompany {
    const name = nameOf(seat.id) ?? seat.id;
    return {
      id: seat.id,
      name,
      entry: () => decorate(w.entryOf(seat), portfolios()),
      view: () => (seat.state === 'open' ? seat.handle.view() : null),
      sayToCeo: (text) => {
        if (seat.state !== 'open') throw new HttpError(409, `${name} can't run, so nothing reaches its CEO.`);
        const ceo = seat.handle.people().find((p) => p.level === 'ceo');
        if (!ceo) throw new HttpError(409, `${name} has no CEO.`);
        // v0.7: a plain job's session reads only the person's own words, never the studio chat's.
        if (seat.handle.view().shape === 'plain') throw new HttpError(409, `${name} is a plain Claude Code job, which hears only your own words: write to it in its office.`);
        return company(() => seat.handle.say(ceo.id, text, { studio: true }));
      },
    };
  }

  const host = {
    companies: () => {
      const portfolios = () => views(rawEntries());
      return w.seats().map((s) => studioCompany(s, portfolios));
    },
    portfolios: () => views(rawEntries()),
  };

  const chat = new StudioChat({
    dir: w.dir,
    host,
    harness: w.harness,
    hubUrl: w.hubUrl,
    issueToken: (scratch) => w.tokens.issue(STUDIO_KEY, STUDIO_PERSON, null, scratch),
    revokeToken: (token) => void w.tokens.revoke(token),
    stakeholder: w.stakeholder,
    onChange: w.changed,
    now: w.now,
    warn: w.warn,
  });

  const owns = (token: string | null): boolean => w.tokens.resolve(token)?.companyId === STUDIO_KEY;

  const mcp = mcpServer({
    resolve: (token) => (owns(token) ? chat : null),
    tools: STUDIO_TOOLS,
    instructions: "The studio chat's tools: read across the stakeholder's companies and relay to their CEOs. Nothing here approves or changes anything.",
    call: (_caller, name, args) => runStudioTool(chat.tools, name, args),
    log: w.warn,
  });

  function settle(): void {
    const raw = rawEntries();
    const portfolios = views(raw);
    for (const p of portfolios) {
      if (p.held && !heldSince.has(p.id)) heldSince.set(p.id, w.now());
      if (!p.held) heldSince.delete(p.id);
    }
    for (const seat of open()) {
      const p = portfolios.find((x) => x.companies.includes(seat.id));
      const hold = w.holdOf(seat.handle);
      const held = p?.held === true;
      if (hold && hold.on !== held) {
        hold.set(held);
        seat.changed = true;
        w.changed();
      }
      const overlay = held && p ? { pause: portfolioPause(p, heldSince.get(p.id) ?? w.now()), portfolio: { id: p.id, name: p.name } } : p ? { pause: null, portfolio: { id: p.id, name: p.name } } : null;
      if (JSON.stringify(seat.overlay ?? null) !== JSON.stringify(overlay)) {
        seat.overlay = overlay;
        seat.changed = true;
      }
      // The shared brief reaches the CEO through the company's brief file, set again only when it changes.
      const brief = p?.brief ? { portfolio: p.name, text: p.brief } : null;
      const key = brief ? `${brief.portfolio}\n${brief.text}` : '';
      if ((briefs.get(seat.id) ?? '') !== key) {
        try {
          seat.handle.setSharedBrief?.(brief);
          briefs.set(seat.id, key);
        } catch (error) {
          w.warn(`couldn't give ${seat.id} its portfolio's brief: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    chat.settle();
  }

  const changedPortfolios = () => {
    settle();
    w.changed();
  };

  const known = (id: string) => nameOf(id);
  const portfolioBody = async (req: IncomingMessage) => fields(await readBody(req, 16 * KB), ['name', 'companies', 'budget', 'brief']);

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    const method = req.method ?? 'GET';
    if (path === '/api/portfolios' && method === 'POST') {
      const body = await portfolioBody(req);
      const made: Portfolio = company(() => store.create(body, known));
      changedPortfolios();
      send(res, 201, made);
      return true;
    }
    const one = /^\/api\/portfolios\/([^/]+)$/.exec(path);
    if (one) {
      let id: string | undefined;
      try {
        id = safeId(decodeURIComponent(one[1] ?? ''));
      } catch {
        // A malformed escape names no portfolio: the same 404 as one that is gone.
        id = undefined;
      }
      if (id === undefined || !store.get(id)) throw new HttpError(404, "That portfolio isn't in the lobby any more.", { code: 'gone' });
      if (method === 'POST') {
        const body = await portfolioBody(req);
        const changed = company(() => store.update(id, body, known));
        changedPortfolios();
        send(res, 200, changed);
        return true;
      }
      if (method === 'DELETE') {
        const removed = company(() => store.remove(id));
        changedPortfolios();
        send(res, 200, removed);
        return true;
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (path === '/api/studio' && method === 'GET') {
      send(res, 200, chat.view());
      return true;
    }
    if (path === '/api/studio/messages' && method === 'POST') {
      const body = fields(await readBody(req, 16 * KB), ['text']);
      if (typeof body.text !== 'string') throw new HttpError(400, 'Send text.', { code: 'bad-input' });
      const text = body.text;
      const entry = company(() => chat.say(text));
      send(res, 202, entry);
      return true;
    }
    if (path === '/api/studio/stop' && method === 'POST') {
      fields(await readBody(req, KB), []);
      company(() => chat.stop());
      send(res, 200, chat.view());
      return true;
    }
    if (path === '/api/studio/settings' && method === 'POST') {
      const body = fields(await readBody(req, KB), ['model', 'budget']);
      if (body.model === undefined && body.budget === undefined) throw new HttpError(400, 'Send model, budget or both.', { code: 'bad-input' });
      if (body.model !== undefined) company(() => chat.setModel(body.model));
      if (body.budget !== undefined) company(() => chat.setBudget(body.budget));
      const view = chat.view();
      send(res, 200, { model: view.model, budget: view.budget });
      return true;
    }
    if (path === '/api/studio/clear' && method === 'POST') {
      fields(await readBody(req, KB), []);
      company(() => chat.clear());
      send(res, 200, chat.view());
      return true;
    }
    return false;
  }

  return {
    owns,
    mcp,
    lobby(companies, base) {
      const portfolios = views(companies);
      return { ...base, companies: companies.map((c) => decorate(c, portfolios)), portfolios, studio: chat.view() };
    },
    settle,
    route,
    forget(companyId) {
      store.forget(companyId);
      briefs.delete(companyId);
      w.changed();
    },
    close: () => chat.close(),
  };
}

