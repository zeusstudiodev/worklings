// The parts the hub wires together, as it calls them. Each is built by its own stream against docs/architecture.md
// ("Seams between the streams"); startHub takes them in `make`, so tests pass fakes and src/hub/real.ts the real ones.
// The shapes the contract (src/core/company.ts) doesn't hold yet are written here, and named in the hub's report.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Library } from '../composer/library.ts';
import type { CompanyApi, CreateCompany, DeskControl, DeskEvents, OpenCompany, OrgOps, PreviewView } from '../core/company.ts';
import type { PermissionVerdict, PolicyOptions } from '../runtime/approvals.ts';
import type { SwitchboardTiming } from '../runtime/index.ts';

/** What `createSwitchboard`'s `hub` is: the hub's loopback URL and its desk-token table. */
export interface HubLink {
  /** The hub's loopback origin with a trailing slash, for `/mcp` and `/desk/*`. */
  url: string;
  /**
   * A new token for a person's desk. `cwd` is the desk's checkout or worktree, the project when it isn't given; `scratch`
   * is the desk's own scratch folder, which the approvals policy lets it work in freely.
   */
  issue(person: string, cwd?: string, scratch?: string): string;
  revoke(token: string): void;
}

/**
 * The hub's caps across all its companies, which every company's switchboard shares: people working at once (`max`, the
 * usage limit) and desks open, idle ones included (`openMax`, memory).
 */
export interface DeskGate {
  /** Takes a process slot for a company's desk, with `working` a working slot too; false while either is full. */
  take(companyId: string, working?: boolean): boolean;
  /** Gives a process slot back when a desk closes. */
  give(companyId: string): void;
  /** A working slot for a desk that is open and idle, when a turn comes for it; false while all of them are in use. */
  takeWork(companyId: string): boolean;
  giveWork(companyId: string): void;
  hasWork(): boolean;
  /** Called when a slot frees up (or a cap grows), so a switchboard with people waiting can try again. */
  onFree(listener: () => void): () => void;
  readonly max: number;
  readonly openMax: number;
  readonly inUse: number;
  readonly working: number;
}

export interface SwitchboardOptions {
  companyId: string;
  root: string;
  hub: HubLink;
  events: DeskEvents;
  maxDesks: number;
  idleMs: number;
  /** The hub's cap across companies (see DeskGate). */
  gate?: DeskGate;
  /** The company's Always allow rules, read each time a desk opens. */
  rules?: () => readonly string[];
  /** Desks open at once, idle ones included, when not the switchboard's default (tests). */
  maxOpen?: number;
  env?: NodeJS.ProcessEnv;
  /** Claude Code's executable, when it isn't found the usual way (tests point it at a fake). */
  claude?: string;
  now?: () => number;
  /** Shorter or longer waits than the switchboard's own (tests). */
  timing?: Partial<SwitchboardTiming>;
  /** Where each desk's temporary folder goes; the system's temporary folder when not given. */
  scratch?: string;
}

export type { PermissionVerdict, PolicyOptions } from '../runtime/approvals.ts';

/** Who an org-tools call comes from, by its desk token. */
export interface DeskCaller {
  company: CompanyApi;
  person: string;
  /** The company's project folder. */
  root: string;
  /** The desk's checkout or worktree. */
  cwd: string;
}

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** The preview proxies (src/server/preview.ts). */
export interface Previews {
  start(companyId: string, root: string): unknown;
  stop(companyId: string): unknown;
  /** With `root`, a preview that is off names the command a start would run. */
  view(companyId: string, root?: string): PreviewView;
  closeAll(): unknown;
}

/** Something served on the tailnet: the hub at 443, or a preview at a port of its own. */
export interface TailnetEntry {
  host: string;
  port: number;
  url: string;
  stop(): Promise<void>;
}

export interface PreviewsOptions {
  /** Called after a company's preview changes, so its stream sends a new snapshot. */
  onChange?: (companyId: string) => void;
  env?: NodeJS.ProcessEnv;
  /** The tailnet while --tailnet is on: each running preview is served on it too, for a phone. */
  tailnet?: () => { serve(port: number): Promise<TailnetEntry> } | null;
}

export interface Tailnet {
  /** The machine's ts.net name, as browsers send it in Host. */
  host: string;
  /** The HTTPS address the tailnet reaches the hub on. */
  url: string;
  stop(): unknown;
  /** Serves a preview proxy's local port at https://<host>:<port>/ too. */
  serve(port: number): Promise<TailnetEntry>;
}

export interface HubMakers {
  createCompany: CreateCompany;
  openCompany: OpenCompany;
  /** The id of the company in a folder's .worklings/, read without opening it; null when none checks out with `key`. */
  companyIdAt: (root: string, key: Uint8Array) => string | null;
  orgOps: (library: Library) => OrgOps;
  createSwitchboard: (o: SwitchboardOptions) => DeskControl;
  /** The hub passes the desk's own folder from its token as `cwd`, so a desk in a worktree is judged from there. */
  classifyPermission: (payload: unknown, o: PolicyOptions) => PermissionVerdict;
  /**
   * The process ids a desk itself started and that are running now, by the desk's scratch folder: what its person may
   * stop by number without asking (`ownProcesses` in the policy's options). Left out, every stop asks.
   */
  ownProcesses?: (scratch: string) => Promise<Iterable<number>>;
  /** Whether a PermissionRequest could be a stop by process id, so the read above is made only for those. */
  stopsByPid?: (payload: unknown) => boolean;
  orgToolsHandler: (o: { resolve: (token: string) => DeskCaller | null }) => NodeHandler;
  createPreviews: (o: PreviewsOptions) => Previews;
  /** `ledger` is where the preview ports served on the tailnet are written down: tailnet.json in the hub's own folder. */
  startTailnet: (o: { port: number; tailscale?: string; ledger?: string }) => Promise<Tailnet>;
}
