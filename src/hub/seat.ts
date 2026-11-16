// A company as the hub holds it: the company itself, the office that watches its folder (v1 and v2's live office,
// which draws its desks as their people and its other sessions as visitors) and the browsers following it.
import type { ServerResponse } from 'node:http';
import { basename } from 'node:path';
import type { CompanyHandle, CompanyView, LobbyCompany, Pause, PreviewView } from '../core/company.ts';
import { type CostEstimate, estimateCompanyCost } from '../core/cost-estimate.ts';
import type { Snapshot } from '../core/snapshot.ts';
import { inSentence } from '../core/studio.ts';
import type { Aside } from '../server/aside.ts';
import type { ApiHandlers } from '../server/http.ts';
import type { Office } from '../server/office.ts';
import type { Library } from '../composer/library.ts';
import type { HubMakers, Previews } from './seams.ts';
import type { DeskTokens } from './tokens.ts';

export interface OpenSeat {
  state: 'open';
  /** The company's id: its address (/c/<id>) and its line in the registry. */
  id: string;
  /**
   * The id the hub gave the company's switchboard and desk tokens before the company existed. A reopened company's is
   * its id; a new one's is provisional until the hub restarts, since createCompany chooses the id.
   */
  key: string;
  root: string;
  handle: CompanyHandle;
  office: Office;
  aside: Aside;
  /** v2's studio, reshape, Ask aside and Catch me up for this company's office. */
  api: Omit<ApiHandlers, 'sessions' | 'replay'>;
  /** Browsers following the company's snapshot stream. */
  clients: Set<ServerResponse>;
  /** The company changed since the last snapshot went out. */
  changed: boolean;
  unsubscribe: () => void;
  /** Gives back the company's lock in its folder (src/hub/home.ts), once the company has closed. */
  unlock: () => void;
  /**
   * v0.3: the portfolio the company is in (src/hub/studio.ts), and the pause its spent budget holds the company in; the
   * company's own view knows neither, so its snapshot carries them.
   */
  overlay?: { pause: Pause | null; portfolio: { id: string; name: string } } | null;
}

/** A company in the registry that couldn't open (its folder is gone, its state unreadable): the lobby says why. */
export interface BrokenSeat {
  state: 'broken';
  id: string;
  root: string;
  problem: string;
}

export type Seat = OpenSeat | BrokenSeat;

/** What the hub's routes share. */
export interface HubContext {
  readonly library: Library;
  readonly make: HubMakers;
  readonly tokens: DeskTokens;
  readonly previews: Previews;
  /** Claude Code's config folder, whose projects/ holds the transcripts. */
  readonly claudeDir: string;
  /** The environment git and the desks start from. */
  readonly env: NodeJS.ProcessEnv;
  /** How long an approval waits for the stakeholder before it counts as a no. */
  readonly approvalWaitMs: number;
  readonly now: () => number;
  /** The companies that run, in the lobby's order. */
  open(): OpenSeat[];
  /** The company whose desks carry this key in their tokens. */
  byKey(key: string): OpenSeat | undefined;
}

const PREVIEW_OFF: PreviewView = { state: 'off', url: null, command: null, problem: null };

/** The company's preview as the proxies see it (off, with the command a start would run); off when they fail. */
export function previewOf(previews: Previews, seat: { id: string; root: string }): PreviewView {
  try {
    return previews.view(seat.id, seat.root);
  } catch {
    return PREVIEW_OFF;
  }
}

/** Gives the office every desk session the company knows, so their main agents are drawn as their people. */
export function syncSessions(seat: OpenSeat) {
  for (const [sessionId, person] of seat.handle.sessions()) seat.office.assignSession(sessionId, person);
}

/**
 * What a company's stream sends: the office's snapshot (the 3D scene's people, visitors, totals, Ask aside) with the
 * company's view in `company`, each person's figure in `agentKey` and the preview from the proxies. A person's cost
 * is what the company recorded from their finished turns, or what their transcripts show so far when that is more,
 * so someone in the middle of their first turn doesn't read $0.
 */
export function companySnapshot(seat: OpenSeat, previews: Previews): Snapshot {
  syncSessions(seat);
  const own = seat.handle.view();
  // A portfolio whose budget is spent holds the company's desks: its view says so as its own budget pause would.
  const held = seat.overlay?.pause ?? null;
  const view = held && own.pause === null ? { ...own, pause: held } : own;
  const spent = seat.office.spentBy();
  const people = view.people.map((p) => ({ ...p, agentKey: seat.office.agentKeyOf(p.id), cost: Math.max(p.cost, spent.get(p.id) ?? 0) }));
  return {
    ...seat.office.snapshot(),
    project: { name: view.name, root: seat.root },
    company: { ...view, people, preview: previewOf(previews, seat), estimate: estimateOf(view) },
    ...portfolioOf(seat),
  };
}

/** v0.3: the portfolio the company is in, beside its view, for the inbox's "Open the portfolio". */
const portfolioOf = (seat: OpenSeat): { portfolio: { id: string; name: string; held: boolean } | null } => ({
  portfolio: seat.overlay ? { ...seat.overlay.portfolio, held: seat.overlay.pause !== null } : null,
});

/**
 * What the company costs an hour while it works: from the proposal until the start (only the CEO is hired then), from
 * the people after it, at the company's desk cap and on its billing. Null while the CEO drafts.
 */
export function estimateOf(view: Pick<CompanyView, 'phase' | 'proposal' | 'people' | 'settings'> & { spending?: CompanyView['spending'] }): CostEstimate | null {
  const org = view.phase === 'proposed' ? view.proposal : view.phase === 'founding' || view.people.length === 0 ? null : view;
  if (!org) return null;
  // An `ANTHROPIC_MODEL` that runs everyone prices everyone as that model.
  const override = view.spending?.modelOverride ?? null;
  const people = override ? org.people.map((p) => ({ level: p.level, model: 'inherit' })) : org.people;
  return estimateCompanyCost({ people }, { maxDesks: view.settings.maxDesks, billing: view.settings.billing, ...(override ? { yourModel: override } : {}) });
}

/** A company that can't run, as the lobby shows it. */
export function brokenEntry(seat: BrokenSeat): LobbyCompany {
  return {
    id: seat.id, name: basename(seat.root) || seat.id, root: seat.root, phase: 'stopped', theme: 'office', people: [], working: 0, waiting: 0, needsYou: 0,
    pause: null, spend: 0, latest: null, problem: seat.problem,
  };
}

/** "Kai's" or, for a role without a name, "the UX designer's". */
export function possessive(person: { name: string; title: string }): string {
  return person.name === person.title ? `the ${inSentence(person.title)}'s` : `${person.name}'s`;
}
