// The hub: the one Worklings server on a machine, with a lobby of companies. It keeps the registry in ~/.worklings,
// opens every company with the real parts (the org flow, a switchboard per company sharing the hub's desk cap, the
// org tools, the previews), watches each company's folder with v1 and v2's office (desks drawn as their people, other
// sessions as visitors), and serves the lobby, each company's snapshot and actions, and the desks' intake. It listens
// on loopback only. With --tailnet, `tailscale serve` reaches a second loopback port that has the pages, streams and API
// (token required) but no intake and no folder browser, since Tailscale passes the phone's own Host header through.
import { cleanLaunch, isWorkChoice, shapeOfChoice } from '../core/plain.ts';
import { cleanPackIds } from '../core/packs.ts';
import { type Installed, installPacks, PackRefusal, undoInstall } from '../packs/install.ts';
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Library } from '../composer/library.ts';
import {
  type CompanyHandle, DEFAULT_IDLE_MS, DEFAULT_MAX_DESKS, type DeskControl, type DeskEvents, LIMITS, type LobbyCompany, OrgRefusal,
} from '../core/company.ts';
import { DEMO_COMPANY } from '../core/demo-company.ts';
import { safeId } from '../core/events.ts';
import { slugId } from '../core/studio.ts';
import { plainPath } from '../safe-fs.ts';
import { Aside, type AsideOptions } from '../server/aside.ts';
import { HttpError, readBody, send, sendError, serveWebApp, tokenOf, withFrames } from '../server/http.ts';
import { claudeHome, isInside, Office } from '../server/office.ts';
import { transcriptDir } from '../server/replay.ts';
import { officeApi } from '../server/run.ts';
import { sameToken } from '../server/token.ts';
import { checkCompanyFolder, hasCompanyState, listFolder, makeFolder, type Places, shortFolder } from './folders.ts';
import { HubGate, hubOpenCap, MAX_HUB_DESKS } from './gate.ts';
import { knownHost, localOnly, sameOrigin, type Side, tailnetAddress } from './guards.ts';
import {
  HeldByAnotherHub, HubHomeError, hubDir, loadHubKey, readRegistry, readSettings, type RegistryEntry, stakeholderName, takeCompanyLock, takeLock, updateSettings, worklingsHome,
  writeRegistry,
} from './home.ts';
import { fields, whole } from './input.ts';
import { helpersOf } from './helpers.ts';
import { callerOf, intake } from './intake.ts';
import { company, companyRoute } from './routes.ts';
import { type Hold, holdable } from './hold.ts';
import { hubStudio } from './studio.ts';
import { claudeCode, type Harness } from '../runtime/harness.ts';
import type { StudioLobbyView } from '../studio/model.ts';
import type { HubMakers, SwitchboardOptions, Tailnet } from './seams.ts';
import { brokenEntry, companySnapshot, type HubContext, type OpenSeat, type Seat } from './seat.ts';
import { setupRoutes } from './setup-routes.ts';
import { DeskTokens } from './tokens.ts';

export type { HubMakers } from './seams.ts';

/** The hub's port: not the watching office's 7421, so both can run. */
export const DEFAULT_HUB_PORT = 7430;
/** How long an approval waits for the stakeholder: inside Claude Code's 600 s default for an http hook, with a margin. */
export const APPROVAL_WAIT_MS = 590_000;
/** A browser that stops reading its stream is cut off past this much unsent data, and reconnects to a fresh snapshot. */
const MAX_BACKLOG = 8 * 1024 * 1024;
const LOBBY_EVERY_MS = 250;
const POLL_EVERY_MS = 1_000;
const KB = 1024;
const BROWSE_HERE = "Browse works on the computer running Worklings; type the folder's path here.";
/** Intake paths, which the tailnet's port doesn't have. */
const INTAKE = /^\/(?:hooks$|otel\/|mcp$|desk\/|\.well-known\/|register$)/;
const MAKERS = [
  'createCompany', 'openCompany', 'companyIdAt', 'orgOps', 'createSwitchboard', 'classifyPermission', 'orgToolsHandler', 'createPreviews', 'startTailnet',
] as const;

export interface HubOptions {
  /**
   * A developer's override of the shape new companies are founded in (WORKLINGS_SHAPE): it wins over the choice the start
   * form or the CLI sends. Left out, a new company runs as its creator chose (`plain` or the `team`); a request that names
   * no choice (the tests' and the e2e world's API calls) founds a classic one, as before 0.2.
   */
  shape?: 'plain' | 'solo' | 'harness' | 'classic';
  /** 0 picks a free port (tests). */
  port: number;
  /** The office's access token (~/.worklings/token). */
  token: string;
  webDir: string | null;
  library: Library;
  /** The folder that holds .worklings: WORKLINGS_HOME (or the old name's variable), else the home folder. */
  home?: string;
  /** Claude Code's executable for the desks, when it isn't found the usual way (tests point it at a fake). */
  claude?: string;
  /**
   * v0.3: the studio chat's own executable, when it differs from the companies' (`claude`): a real check runs a real
   * studio chat over companies whose desks are faked.
   */
  studioClaude?: string;
  /** Also serve the hub on the tailnet through `tailscale serve` (never Funnel), from a port of its own. */
  tailnet?: boolean;
  /** The loopback port tailscale serve proxies to: the one kept in the settings, else the hub's port plus one. */
  tailnetPort?: number;
  /** The parts the hub wires together; whatever is missing comes from src/hub/real.ts. */
  make?: Partial<HubMakers>;
  /** The environment git and the desks start from (this process's when not given). */
  env?: NodeJS.ProcessEnv;
  /** Claude Code's config folder, whose projects/ holds the transcripts. */
  claudeHome?: string;
  /** Each company office's Ask aside and Catch me up (tests pass a fake Claude Code). */
  aside?: AsideOptions;
  now?: () => number;
  /** How often the hub looks for changes; a company's stream sends at most one snapshot each time (100 ms). */
  tickMs?: number;
  /** How long an approval waits before it counts as a no; the desks' PermissionRequest hook must wait longer. */
  approvalWaitMs?: number;
  /** For the desks: the switchboard's waits and where their temporary folders go (tests keep them in their own). */
  desks?: Pick<SwitchboardOptions, 'timing' | 'scratch'>;
}

export interface RunningHub {
  server: Server;
  port: number;
  /** The hub on this machine: http://127.0.0.1:<port>/. */
  url: string;
  /** The tailnet's https address, with --tailnet. */
  tailnetUrl: string | null;
  /** The loopback port the tailnet reaches the hub through: pages, streams and the API only. */
  tailnetPort: number | null;
  /**
   * What POST /api/companies does: a new company in the folder, or the one already in its .worklings/. Without a prompt
   * only the one already there, as the lobby's Undo of a removal asks.
   */
  addCompany(input: { folder: unknown; prompt?: unknown; launch?: unknown; work?: unknown; packs?: unknown }): Promise<{ id: string; reopened: boolean }>;
  lobby(): StudioLobbyView;
  /** Closes every company (their desks are killed), the previews, the tailnet and the server. */
  close(): Promise<void>;
}

async function makers(given: Partial<HubMakers> = {}): Promise<HubMakers> {
  // The real parts load only when something is missing, so tests that pass every part never touch them.
  const real = MAKERS.every((key) => given[key] !== undefined) ? null : (await import('./real.ts')).REAL;
  const pick = <K extends keyof HubMakers>(key: K): HubMakers[K] => {
    const value = given[key] ?? real?.[key];
    if (!value) throw new Error(`The hub has no ${key}.`);
    return value;
  };
  const optional = <K extends 'ownProcesses' | 'stopsByPid'>(key: K): Pick<HubMakers, K> | Record<string, never> => {
    const value = given[key] ?? real?.[key];
    return value ? ({ [key]: value } as Pick<HubMakers, K>) : {};
  };
  return {
    createCompany: pick('createCompany'), openCompany: pick('openCompany'), companyIdAt: pick('companyIdAt'), orgOps: pick('orgOps'),
    createSwitchboard: pick('createSwitchboard'), classifyPermission: pick('classifyPermission'), orgToolsHandler: pick('orgToolsHandler'),
    createPreviews: pick('createPreviews'), startTailnet: pick('startTailnet'),
    // Optional parts: a hub given every other part (a test's fakes) has neither, and every stop asks.
    ...optional('ownProcesses'), ...optional('stopsByPid'),
  };
}

/** How the hub makes a company, given the switchboard's factory. */
type Build = (desks: (events: DeskEvents, companyId: string) => DeskControl) => CompanyHandle;
/** A company just made, with the id its switchboard and desk tokens were keyed by. */
type Made = { handle: CompanyHandle; key: string };

const frame = (event: string, value: unknown) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;

function broadcast(clients: Set<ServerResponse>, event: string, value: unknown) {
  const text = frame(event, value);
  for (const res of clients) {
    if (res.writableLength > MAX_BACKLOG) res.destroy();
    else res.write(text);
  }
}

const sameFolder = (a: string, b: string) => isInside(a, b) && isInside(b, a);

/** Listens on 127.0.0.1 only and gives the port it got. */
function listen(server: Server, port: number): Promise<number> {
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      const address = server.address();
      done(typeof address === 'object' && address ? address.port : port);
    });
  });
}

export async function startHub(o: HubOptions): Promise<RunningHub> {
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now;
  const warn = (line: string) => process.stderr.write(`worklings: ${line}\n`);
  const dir = hubDir(o.home ?? worklingsHome(env));
  const hubKey = loadHubKey(dir);
  const registry = readRegistry(dir, warn);
  /** Every company in the registry, by id, in the lobby's order. */
  const seats = new Map<string, Seat>();
  const make = await makers(o.make);
  const org = make.orgOps(o.library);
  /** The tailnet while --tailnet is on. */
  let tailscale: Tailnet | null = null;
  const previews = make.createPreviews({
    onChange: (companyId) => {
      const s = seats.get(companyId);
      if (s?.state === 'open') s.changed = true;
    },
    tailnet: () => tailscale,
    ...(o.env ? { env: o.env } : {}),
  });
  const tokens = new DeskTokens();
  const gate = new HubGate(Math.min(readSettings(dir).maxDesks ?? DEFAULT_MAX_DESKS, MAX_HUB_DESKS), { open: hubOpenCap });
  const claudeDir = o.claudeHome ?? claudeHome();
  const clock = o.now ? { now: o.now } : {};
  const lobbyClients = new Set<ServerResponse>();
  let lobbyChanged = true;
  let hubUrl = '';
  let hubPort = 0;
  let stopTicking = () => {};
  let releaseLock = () => {};
  /** Set when the hub starts closing: from then on no company is added. */
  let closingDown = false;
  /** The plan's usage limit, which every company rests through together once one meets it, in the words it came with. */
  let planRest: { since: number; until: number; message: string } | null = null;
  const resting = () => (planRest !== null && now() < planRest.until ? planRest : null);
  /** Each company's DeskEvents, so the limit one company meets reaches the others as theirs. */
  const deskEvents = new WeakMap<CompanyHandle, DeskEvents>();
  /** v0.3: each company's portfolio hold on its desks (hold.ts). */
  const holds = new WeakMap<CompanyHandle, Hold>();

  // Adding and removing companies one at a time, so two presses can't put two companies in one folder.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  };
  /** Resolves once the adds and removals queued so far are done, and any queued while it waits. */
  const settled = async () => {
    for (let waited = queue; ; waited = queue) {
      await waited;
      if (waited === queue) return;
    }
  };

  const open = (): OpenSeat[] => [...seats.values()].filter((s): s is OpenSeat => s.state === 'open');
  const ctx: HubContext = {
    library: o.library, make, tokens, previews, claudeDir, env, approvalWaitMs: o.approvalWaitMs ?? APPROVAL_WAIT_MS, now, open,
    byKey: (key) => open().find((s) => s.key === key),
  };
  const mcp = make.orgToolsHandler({ resolve: (token) => callerOf(ctx, token) });
  /** The studio chat's desk runs on the user's own Claude Code like the companies' desks (made at its first message). */
  let harness: Harness | null = null;
  const studio = hubStudio({
    dir,
    seats: () => [...seats.values()],
    entryOf: (s) => lobbyEntryOf(s),
    holdOf: (handle) => holds.get(handle),
    tokens,
    hubUrl: () => hubUrl,
    harness: () => {
      const claude = o.studioClaude ?? o.claude;
      return (harness ??= claudeCode({ env, ...(claude ? { claude } : {}), ...(o.desks?.scratch ? { scratch: o.desks.scratch } : {}) }));
    },
    stakeholder: () => readSettings(dir).stakeholder ?? open().map((s) => s.handle.view().stakeholder).find((n) => n) ?? '',
    changed: () => {
      lobbyChanged = true;
    },
    now,
    warn,
  });

  /**
   * Makes a company with its switchboard. The company makes the switchboard while it is being made and names itself
   * to it, so the desks' tokens and the hub's cap are keyed by that id from the first desk on; `holder` has the company
   * once it exists, for the Always allow rules each desk opens with.
   */
  const made = (root: string, build: Build): Made => {
    const holder: { handle: CompanyHandle | null; key: string | null; events: DeskEvents | null; hold: Hold | null } = { handle: null, key: null, events: null, hold: null };
    const desks = (events: DeskEvents, companyId: string): DeskControl => {
      holder.key = companyId;
      holder.events = events;
      // A usage limit is the plan's, not one company's: the company that meets it rests, and so does every other.
      const limited: DeskEvents['limited'] = (until, message, reason) => {
        events.limited(until, message, reason);
        if (reason === 'usage-limit' && holder.handle) restEveryCompany(holder.handle, until, message);
      };
      const control = make.createSwitchboard({
        companyId, root, events: { ...events, limited }, maxDesks: DEFAULT_MAX_DESKS, idleMs: DEFAULT_IDLE_MS, gate,
        hub: {
          url: hubUrl, issue: (person, cwd, scratch) => tokens.issue(companyId, person, cwd ?? null, scratch ?? null), revoke: (token) => void tokens.revoke(token),
        },
        rules: () => holder.handle?.view().settings.alwaysAllow ?? [],
        ...(o.env ? { env: o.env } : {}), ...(o.claude ? { claude: o.claude } : {}), ...clock,
        ...(o.desks?.timing ? { timing: o.desks.timing } : {}), ...(o.desks?.scratch ? { scratch: o.desks.scratch } : {}),
      });
      // v0.3: a portfolio's spent budget holds the desks between the company and its switchboard.
      const held = holdable(control, now);
      holder.hold = held.hold;
      // A company that opens while the plan rests rests from its first moment, so no turn of it starts before the reset.
      const rest = resting();
      if (rest) held.control.pause(rest.until);
      return held.control;
    };
    const handle = build(desks);
    holder.handle = handle;
    if (holder.events) deskEvents.set(handle, holder.events);
    if (holder.hold) holds.set(handle, holder.hold);
    return { handle, key: holder.key ?? handle.id };
  };

  const nameOf = (seat: Seat) => {
    if (seat.state === 'broken') return basename(seat.root) || seat.id;
    try {
      return seat.handle.lobbyEntry().name;
    } catch {
      return basename(seat.root) || seat.id;
    }
  };

  function seatFor(handle: CompanyHandle, root: string, key: string, unlock: () => void): OpenSeat {
    const office = new Office(root, handle.lobbyEntry().name, 'live', { claudeHome: claudeDir, now });
    const inMemory = handle.memoryStudio?.() ?? null;
    if (inMemory) office.pinStudio(inMemory);
    else office.loadStudio();
    const aside = new Aside(office, o.aside);
    office.aside = aside;
    const seat: OpenSeat = {
      state: 'open', id: handle.id, key, root, handle, office, aside, api: officeApi(office, aside, { root, library: o.library, mode: 'live' }),
      clients: new Set(), changed: true, unsubscribe: () => {}, unlock,
    };
    seat.unsubscribe = handle.onChange(() => {
      seat.changed = true;
      lobbyChanged = true;
    });
    return seat;
  }

  function problemOf(error: unknown): string {
    if (error instanceof OrgRefusal || error instanceof HttpError) return error.message;
    warn(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return "Its state in .worklings couldn't be read, so it can't run. Remove it from the lobby, or put the folder back as it was.";
  }

  /**
   * Takes the company's lock in its folder before anything opens it, so a hub started from another home can't run it
   * too: refused with a sentence naming the hub that has it.
   */
  function lockCompany(root: string): () => void {
    let unlock: () => void;
    try {
      unlock = takeCompanyLock(root, hubPort);
    } catch (error) {
      if (error instanceof HeldByAnotherHub) throw new HttpError(409, error.message, { code: 'other-hub' });
      if (error instanceof HubHomeError) throw new HttpError(400, error.message, { code: 'link' });
      throw error;
    }
    return () => {
      try {
        unlock();
      } catch (error) {
        warn(`couldn't give back the lock in ${root}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
  }

  /** Makes a company under its folder's lock; when making it fails, the lock goes back at once. */
  function opening(root: string, build: Build): { opened: Made; unlock: () => void } {
    const unlock = lockCompany(root);
    try {
      return { opened: company(() => made(root, build)), unlock };
    } catch (error) {
      unlock();
      throw error;
    }
  }

  /**
   * Seats a company that just opened; one that can't be seated is closed again, so its desks don't run unseen, and its
   * lock goes back once it has.
   */
  function seated(opened: Made, root: string, unlock: () => void): OpenSeat {
    let seat: OpenSeat;
    try {
      if (safeId(opened.handle.id) === undefined) throw new Error(`The company in ${root} came back with an id the hub can't use.`);
      seat = seatFor(opened.handle, root, opened.key, unlock);
    } catch (error) {
      void opened.handle.close().catch(() => {}).finally(unlock);
      throw error;
    }
    // Opened while the plan rests: it rests with the others, in its own timeline too, and wakes with them.
    const rest = resting();
    if (rest) deskEvents.get(seat.handle)?.limited(rest.until, rest.message, 'usage-limit');
    return seat;
  }

  /**
   * Rests every other open company until the plan's usage limit resets, so they wake together; companies opened
   * meanwhile rest too. A limit with no reset time rests only the company that met it, until it is resumed.
   */
  function restEveryCompany(from: CompanyHandle, until: number | null, message: string) {
    if (until === null || !Number.isFinite(until) || until <= now()) return;
    const current = resting();
    if (current && current.until >= until) return;
    planRest = { since: current?.since ?? now(), until, message };
    lobbyChanged = true;
    for (const s of open()) if (s.handle !== from) deskEvents.get(s.handle)?.limited(until, message, 'usage-limit');
  }

  /** Why a company can't run beside one in the lobby: one's folder is inside the other's, so its hooks would be ambiguous. */
  function nesting(id: string, root: string): string | null {
    for (const s of seats.values()) {
      if (s.id === id) continue;
      if (isInside(s.root, root)) return `Its folder is inside ${nameOf(s)}'s folder, so it can't run beside it. Remove one of the two from the lobby.`;
      if (isInside(root, s.root)) return `${nameOf(s)}'s folder is inside its folder, so it can't run beside it. Remove one of the two from the lobby.`;
    }
    return null;
  }

  function openRegistered(entry: RegistryEntry): Seat {
    const broken = (problem: string): Seat => ({ state: 'broken', id: entry.id, root: entry.root, problem });
    if (!existsSync(entry.root)) return broken(`Its folder isn't at ${entry.root} any more. Put it back, or remove the company from the lobby.`);
    // A registry written by hand can hold two folders one inside the other; addCompany never adds such a pair.
    const nested = nesting(entry.id, entry.root);
    if (nested) return broken(nested);
    try {
      const { opened, unlock } = opening(entry.root, (desks) => make.openCompany({ root: entry.root, key: hubKey, org, desks, ...clock, ...(o.env ? { env: o.env } : {}) }));
      return seated(opened, entry.root, unlock);
    } catch (error) {
      return broken(problemOf(error));
    }
  }

  function saveRegistry() {
    try {
      writeRegistry(dir, [...seats.values()].map((s) => ({ id: s.id, root: s.root })));
    } catch (error) {
      // The companies keep running; only a restart would miss the change.
      warn(`couldn't save the list of companies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /** A new company's id: its folder's name as a slug ("Café Lumen" is cafe-lumen), with a number when the lobby has it. */
  function newId(root: string): string {
    const base = slugId(basename(root).normalize('NFD').replace(/\p{M}/gu, ''), 40) || 'company';
    let id = base;
    for (let n = 2; seats.has(id) || id === DEMO_COMPANY; n += 1) id = `${base}-${n}`;
    return id;
  }

  function seat(opened: Made, root: string, unlock: () => void, reopened: boolean): { id: string; reopened: boolean } {
    const s = seated(opened, root, unlock);
    seats.set(s.id, s);
    saveRegistry();
    lobbyChanged = true;
    return { id: s.id, reopened };
  }

  const placesNow = (): Places => ({ companies: [...seats.values()].map((s) => ({ name: nameOf(s), root: s.root })), home: homedir(), own: [dir, claudeDir] });
  /** The first-run check, the consent step for watching a project, and the health and stop routes (setup-routes.ts). */
  const setup = setupRoutes({ env, claude: o.claude, places: placesNow, now, stop: () => void close() });

  /**
   * Takes back what addCompany made for a company that couldn't be made: the state folder the company lock made, while
   * it holds nothing but its .gitignore, and the project folder when the call made it, while it is empty. What anyone
   * else put there stays.
   */
  function takeBack(root: string, ours: { folder: boolean; state: boolean }) {
    try {
      const state = join(root, '.worklings');
      if (ours.state && existsSync(state) && readdirSync(state).every((name) => name === '.gitignore')) {
        rmSync(join(state, '.gitignore'), { force: true });
        rmdirSync(state);
      }
      if (ours.folder) rmdirSync(root);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // ENOTEMPTY (EEXIST on some systems): something else is in it, so it stays.
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') warn(`couldn't take back ${root}, which the hub made for a company that didn't start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The Undo of a removal for a company whose folder moved or was deleted. */
  const folderGone = (root: string) => new HttpError(400, `Its folder isn't at ${shortFolder(root)} any more. If it moved, add it from where it is now.`, { code: 'missing' });

  function addCompany(input: { folder: unknown; prompt?: unknown; launch?: unknown; work?: unknown; packs?: unknown }): Promise<{ id: string; reopened: boolean }> {
    return serial(async () => {
      if (closingDown) throw new HttpError(503, 'The hub is closing. Add the folder again once it runs.', { code: 'closing' });
      // v0.9: the packs a new one-session job starts with (SPEC-v0.9.md); none unless the person named them.
      const named = cleanPackIds(input.packs);
      if (!named.ok) throw new HttpError(400, named.message, { code: 'bad-input' });
      const packs = named.ids;
      // A company that couldn't open gets another try when its folder is added again.
      const typed = typeof input.folder === 'string' ? resolve(input.folder.trim()) : null;
      const broken = typed ? [...seats.values()].find((s) => s.state === 'broken' && sameFolder(s.root, typed)) : undefined;
      if (broken && packs.length > 0) throw new HttpError(409, 'A company worked in this folder before, so adding it reopens that company. Packs are added when a new job starts.', { code: 'packs' });
      if (broken) {
        const again = openRegistered({ id: broken.id, root: broken.root });
        seats.set(broken.id, again);
        lobbyChanged = true;
        if (again.state === 'broken') throw new HttpError(409, again.problem, { code: 'cannot-run' });
        return { id: again.id, reopened: true };
      }
      // Without a prompt the call reopens the company the folder holds (the lobby's Undo of a removal): a folder that has
      // gone, or holds no company, gets a sentence saying so, not a request for a prompt or advice to make the folder.
      const reopening = input.prompt === undefined;
      const check = checkCompanyFolder(input.folder, placesNow());
      if (!check.ok) {
        if (reopening && check.code === 'missing' && typed) throw folderGone(typed);
        throw new HttpError(check.status, check.message, { code: check.code });
      }
      const root = check.root;
      if (packs.length > 0 && check.exists && hasCompanyState(root)) {
        throw new HttpError(409, 'A company worked in this folder before, so adding it reopens that company. Packs are added when a new job starts.', { code: 'packs' });
      }
      if (check.exists && hasCompanyState(root)) {
        try {
          plainPath(root, '.worklings');
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error), { code: 'link' });
        }
        const copyOf = (twin: Seat) =>
          new HttpError(409, `This folder holds a copy of ${nameOf(twin)}, which runs from ${twin.root}. Delete the copy's .worklings folder to start a new company there.`, { code: 'copy' });
        // A copy of a company's folder holds that company's id: refused before opening it could start a desk.
        const twin = seats.get(make.companyIdAt(root, hubKey) ?? '');
        if (twin) throw copyOf(twin);
        const { opened, unlock } = opening(root, (desks) => make.openCompany({ root, key: hubKey, org, desks, ...clock, ...(o.env ? { env: o.env } : {}) }));
        const late = seats.get(opened.handle.id);
        if (late) {
          try {
            await opened.handle.close();
          } finally {
            unlock();
          }
          throw copyOf(late);
        }
        return seat(opened, root, unlock, true);
      }
      if (reopening) {
        if (!check.exists) throw folderGone(root);
        throw new HttpError(400, `No company works in ${shortFolder(root)} any more: its .worklings folder is gone.`, { code: 'no-company' });
      }
      const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
      if (prompt === '') throw new HttpError(400, 'Say what to build.', { code: 'bad-input' });
      if (prompt.length > LIMITS.prompt) {
        throw new HttpError(400, `Keep the first prompt to ${LIMITS.prompt.toLocaleString('en-US')} characters.`, { code: 'bad-input' });
      }
      // What this call makes, so a company that can't be made there leaves the folder as it found it.
      const ours = { folder: !check.exists, state: !existsSync(join(root, '.worklings')) };
      if (ours.folder) mkdirSync(root);
      let installed: Installed | null = null;
      try {
        const stakeholder = await stakeholderName(dir, root, env);
        const id = newId(root);
        // The company keeps its shape in its own state (the founded event), so it reopens as it was made.
        const shape = o.shape ?? (isWorkChoice(input.work) ? shapeOfChoice(input.work) : 'classic');
        if (packs.length > 0 && shape !== 'plain') throw new HttpError(400, 'Packs are for a one-session job; a team has its own reviewer.', { code: 'packs' });
        // The office adds the packs itself, at the person's request and before the session starts: no desk writes them.
        if (packs.length > 0) {
          try {
            installed = installPacks(root, packs);
          } catch (error) {
            if (error instanceof PackRefusal) throw new HttpError(409, error.message, { code: 'packs' });
            throw error;
          }
        }
        const { opened, unlock } = opening(root, (desks) => make.createCompany({ id, root, prompt, stakeholder, key: hubKey, org, desks, ...clock, ...(o.env ? { env: o.env } : {}), ...(shape !== 'classic' ? { shape } : {}), ...(shape === 'plain' ? { launch: cleanLaunch(input.launch), packs } : {}) }));
        return seat(opened, root, unlock, false);
      } catch (error) {
        if (installed) undoInstall(root, installed);
        takeBack(root, ours);
        throw error;
      }
    });
  }

  async function closeSeat(s: OpenSeat) {
    s.unsubscribe();
    for (const res of s.clients) res.end();
    s.clients.clear();
    try {
      // The last look at the transcripts is written down before the desks stop, so the next start reads it.
      s.handle.noteSpend(s.office.spentBy());
      await s.handle.close();
    } catch (error) {
      warn(`${nameOf(s)} didn't close cleanly: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Its log is shut now, so another hub may have the company.
    s.unlock();
    tokens.revokeCompany(s.key);
    gate.release(s.key);
    try {
      await previews.stop(s.id);
    } catch (error) {
      warn(`${nameOf(s)}'s preview didn't stop cleanly: ${error instanceof Error ? error.message : String(error)}`);
    }
    await s.aside.close();
  }

  function removeCompany(id: string): Promise<{ id: string; removed: true }> {
    return serial(async () => {
      const s = seats.get(id);
      if (!s) throw new HttpError(404, "That company isn't in the lobby any more.", { code: 'gone' });
      seats.delete(id);
      saveRegistry();
      studio.forget(id);
      lobbyChanged = true;
      if (s.state === 'open') await closeSeat(s);
      return { id, removed: true };
    });
  }

  /** Companies whose failure the terminal has been told about, so a lobby sent four times a second says it once. */
  const reported = new Set<string>();
  function lobbyEntryOf(s: Seat): LobbyCompany {
    if (s.state === 'broken') return brokenEntry(s);
    try {
      const entry = s.handle.lobbyEntry();
      if (!entry.summary) return entry;
      // The card's preview link, only while the preview is up: its proxy URL, never the office's.
      const preview = previews.view(s.id);
      return { ...entry, summary: { ...entry.summary, preview: preview.state === 'up' ? preview.url : null } };
    } catch (error) {
      if (!reported.has(s.id)) warn(`${s.root}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      reported.add(s.id);
      return brokenEntry({ state: 'broken', id: s.id, root: s.root, problem: "It stopped answering, so it can't run. The terminal the hub runs in says why; remove it from the lobby and add its folder again." });
    }
  }

  /**
   * A desk sends the office no hook before its turn ends, so the office would read a desk's transcript only from then
   * on, and a person's spend would stand still through their first turn. Each poll, the sessions of the people at an
   * open desk are named to the office where Claude Code writes their transcripts: under the folder the desk works in
   * (the project's, or a task's worktree).
   */
  /** The helpers each company's office has seen finish, so their files aren't read again (v0.4, H2). */
  const finishedHelpers = new WeakMap<OpenSeat, Set<string>>();
  function followDesks(s: OpenSeat) {
    const folders = new Map<string, string[]>();
    for (const desk of tokens.desksOf(s.key)) {
      const list = folders.get(desk.person) ?? [];
      for (const cwd of [desk.cwd ?? s.root, s.root]) {
        const folder = transcriptDir(cwd, claudeDir);
        if (!list.includes(folder)) list.push(folder);
      }
      folders.set(desk.person, list);
    }
    if (folders.size === 0) return;
    for (const [sessionId, person] of s.handle.sessions()) {
      const list = folders.get(person);
      if (!list) continue;
      const file = list.map((folder) => join(folder, `${sessionId}.jsonl`)).find((path) => existsSync(path));
      if (file && !s.office.follows(sessionId)) s.office.followDesk(sessionId, person, file);
      // v0.4 (H2): the helpers the person's desk started, beside the desk's transcript; each finished one is read once more.
      if (!file) continue;
      const done = finishedHelpers.get(s) ?? new Set<string>();
      finishedHelpers.set(s, done);
      for (const h of helpersOf(dirname(file), sessionId)) {
        const key = `${sessionId}:${h.agentId}`;
        if (done.has(key)) continue;
        s.office.followHelper(sessionId, person, h);
        if (h.finished) done.add(key);
      }
    }
  }

  function lobby(): StudioLobbyView {
    const companies = [...seats.values()].map(lobbyEntryOf);
    const rest = resting();
    // v0.3: each company with its portfolio's pause, the portfolios rolled up, and the studio chat.
    return studio.lobby(companies, {
      // What the gate holds, idle and closing desks included, so the lobby never says no desk is in use while slots are held.
      hub: { maxDesks: gate.max, working: companies.reduce((n, c) => n + c.working, 0), inUse: gate.inUse, rest: rest ? { since: rest.since, until: rest.until } : null },
      serverTime: now(),
    });
  }

  /**
   * What the office's pages may frame: the preview proxies, on 127.0.0.1 at any port, and on the tailnet's name at any
   * port with --tailnet. Any port, since a preview started after a page loaded comes on a port that page never heard of.
   */
  const frameSources = (): string[] => ['http://127.0.0.1:*', ...(tailscale ? [`https://${tailscale.host}:*`] : [])];

  function openOr404(raw: string): OpenSeat {
    let id: string | undefined;
    try {
      id = safeId(decodeURIComponent(raw));
    } catch {
      id = undefined;
    }
    const s = id === undefined ? undefined : seats.get(id);
    if (!s) throw new HttpError(404, "That company isn't in the lobby any more.", { code: 'gone' });
    if (s.state === 'broken') throw new HttpError(409, s.problem, { code: 'cannot-run' });
    return s;
  }

  function stream(res: ServerResponse, clients: Set<ServerResponse>, event: string, first: unknown) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' });
    res.write('retry: 2000\n\n');
    res.write(frame(event, first));
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    res.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === '/events/lobby') return stream(res, lobbyClients, 'lobby', lobby());
    if (method === 'GET' && path === '/api/lobby') return send(res, 200, lobby());
    const events = /^\/events\/c\/([^/]+)$/.exec(path);
    if (method === 'GET' && events) {
      const s = openOr404(events[1] ?? '');
      return stream(res, s.clients, 'snapshot', companySnapshot(s, previews));
    }
    if (method === 'POST' && path === '/api/companies') {
      // v0.4: a first prompt of up to LIMITS.prompt characters, four bytes each at most in UTF-8, and its folder.
      // v0.7: a plain job's launch choices (model, effort, permission mode, plan first), each optional; cleanLaunch keeps what it knows.
      const body = fields(await readBody(req, 280 * KB), ['folder', 'prompt', 'launch', 'work', 'packs']);
      if (body.work !== undefined && !isWorkChoice(body.work)) throw new HttpError(400, 'Say how the work runs: plain or team.', { code: 'bad-input' });
      const added = await addCompany({ folder: body.folder, prompt: body.prompt, launch: body.launch, work: body.work, packs: body.packs });
      return send(res, added.reopened ? 200 : 201, added);
    }
    const removing = /^\/api\/companies\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && removing) return send(res, 200, await removeCompany(openOrBroken(removing[1] ?? '')));
    if (method === 'POST' && path === '/api/hub/settings') {
      const maxDesks = whole(fields(await readBody(req, KB), ['maxDesks']), 'maxDesks', 1, MAX_HUB_DESKS);
      updateSettings(dir, { maxDesks });
      gate.setMax(maxDesks);
      lobbyChanged = true;
      return send(res, 200, { maxDesks });
    }
    if (path === '/api/folders' && (method === 'GET' || method === 'POST')) {
      localOnly(req, BROWSE_HERE);
      if (method === 'GET') {
        // Git runs only for the folder the person chose, for its uncommitted-changes note, never for a level browsed through.
        const listing = await listFolder(url.searchParams.get('path') ?? homedir(), { ...placesNow(), library: o.library, env, chosen: url.searchParams.get('chosen') === '1' });
        if ('ok' in listing) throw new HttpError(listing.status, listing.message, { code: listing.code });
        return send(res, 200, listing);
      }
      const body = fields(await readBody(req, 4 * KB), ['parent', 'name']);
      const made = makeFolder(body.parent, body.name, placesNow());
      if (!made.ok) throw new HttpError(made.status, made.message, { code: made.code });
      return send(res, 201, { path: made.path });
    }
    if (await studio.route(req, res, path)) return;
    const scoped = /^\/api\/c\/([^/]+)\/(.+)$/.exec(path);
    if (scoped) return companyRoute(ctx, openOr404(scoped[1] ?? ''), req, res, scoped[2] ?? '');
    if (await setup(req, res, path, url)) return;
    throw new HttpError(404, 'No such endpoint.');
  }

  /** A company's id from the path, open or not: removing one that can't run is how its problem goes away. */
  function openOrBroken(raw: string): string {
    let id: string | undefined;
    try {
      id = safeId(decodeURIComponent(raw));
    } catch {
      id = undefined;
    }
    if (id === undefined || !seats.has(id)) throw new HttpError(404, "That company isn't in the lobby any more.", { code: 'gone' });
    return id;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, side: Side) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (!knownHost(req, side)) {
      throw new HttpError(403, side.kind === 'local' ? 'This hub answers only on localhost.' : "This is the hub's tailnet port: open the hub at its ts.net address.", { code: 'host' });
    }
    // Intake exists only on the local port: the tailnet's port has the office's pages, streams and API, nothing else.
    if (side.kind === 'local') {
      if (await intake(ctx, req, res, path, mcp, studio)) return;
    } else if (INTAKE.test(path)) {
      throw new HttpError(404, 'Not found.');
    }
    if (path.startsWith('/api/') || path.startsWith('/events/')) {
      if (!sameOrigin(req, side)) throw new HttpError(403, 'Cross-origin requests are not allowed.', { code: 'origin' });
      if (!sameToken(tokenOf(req, url), o.token)) throw new HttpError(401, 'Open the hub with the link the CLI printed: it carries the access token.');
      if (side.kind === 'tailnet' && path === '/api/folders') throw new HttpError(403, BROWSE_HERE, { code: 'local-only' });
      return api(req, res, path, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    serveWebApp(o.webDir, req, path, res, withFrames(frameSources()));
  }

  const serveOn = (side: Side) => (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res, side).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) warn(error instanceof Error ? (error.stack ?? error.message) : String(error));
      if (res.headersSent) res.end();
      else sendError(res, status === 500 ? new HttpError(500, "Something went wrong in the hub; the terminal it runs in says what.") : error, status);
    });
  };
  const tailSide: Side & { kind: 'tailnet' } = { kind: 'tailnet', address: null };
  const server = createServer(serveOn({ kind: 'local' }));
  let tailServer: Server | null = null;

  const shut = async (s: Server | null) => {
    if (!s?.listening) return;
    s.closeAllConnections();
    await new Promise<void>((done) => s.close(() => done()));
  };
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      closingDown = true;
      stopTicking();
      for (const res of lobbyClients) res.end();
      try {
        await studio.close();
      } catch (error) {
        warn(`the studio chat didn't close cleanly: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Off the tailnet first, so nothing reaches a hub that is going away.
      try {
        await tailscale?.stop();
      } catch (error) {
        warn(`tailscale serve didn't stop cleanly: ${error instanceof Error ? error.message : String(error)}`);
      }
      // A company being added or removed right now gets there first, so one added during the shutdown closes with the rest.
      await settled();
      await Promise.all(open().map((s) => closeSeat(s)));
      try {
        await previews.closeAll();
      } catch (error) {
        warn(`the previews didn't stop cleanly: ${error instanceof Error ? error.message : String(error)}`);
      }
      releaseLock();
      await Promise.all([shut(tailServer), shut(server)]);
    })());

  const port = await listen(server, o.port);
  hubUrl = `http://127.0.0.1:${port}/`;
  hubPort = port;
  let tailnetPort: number | null = null;

  try {
    releaseLock = takeLock(dir, port);
    let renamed = false;
    for (const entry of registry) {
      const s = openRegistered(entry);
      if (s.id !== entry.id) renamed = true;
      seats.set(s.id, s);
    }
    if (renamed) saveRegistry();
    // A portfolio whose budget was spent before the restart holds its companies again before their desks get going.
    studio.settle();
    // A rest on the plan's limit outlives a restart in each company's log; the hub takes it up again from them.
    for (const s of open()) {
      const pause = lobbyEntryOf(s).pause;
      if (pause?.reason !== 'usage-limit' || pause.until === null || pause.until <= now() || (planRest && planRest.until >= pause.until)) continue;
      planRest = { since: pause.since, until: pause.until, message: pause.message };
    }
    if (o.tailnet) {
      // The port tailscale serve proxies to stays the same between runs: Tailscale refuses an entry for another one.
      const saved = readSettings(dir).tailnetPort;
      const wanted = o.tailnetPort ?? saved ?? (o.port === 0 ? 0 : port < 65_535 ? port + 1 : port - 1);
      tailServer = createServer(serveOn(tailSide));
      try {
        tailnetPort = await listen(tailServer, wanted);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        throw new Error(`Port ${wanted}, which your tailnet reaches the hub through, is in use. Free it, or set "tailnetPort" in ${dir}${sep}settings.json.`, { cause: error });
      }
      if (o.tailnetPort === undefined && saved === null && wanted !== 0) {
        try {
          updateSettings(dir, { tailnetPort });
        } catch (error) {
          warn(`couldn't keep the tailnet port in the settings: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // The ledger of preview ports served on the tailnet lives in this hub's own folder, whatever home it was given.
      tailscale = await make.startTailnet({ port: tailnetPort, ledger: join(dir, 'tailnet.json') });
      tailSide.address = tailnetAddress(tailscale.host, tailscale.url);
    }
  } catch (error) {
    await close();
    throw error;
  }

  let lastPoll = 0;
  let lastLobby = 0;
  let lastProblem = '';
  const timer = setInterval(() => {
    const at = Date.now();
    const poll = at - lastPoll >= POLL_EVERY_MS;
    if (poll) lastPoll = at;
    for (const s of open()) {
      // One company's bad transcript or studio file must not stop the others: say so once and go on.
      try {
        if (poll) {
          followDesks(s);
          s.office.poll();
          // What the transcripts show of turns that haven't ended is written down, so a restart doesn't start it from $0.
          s.handle.noteSpend(s.office.spentBy());
        }
        const changed = s.office.takeChanges() || s.changed;
        s.changed = false;
        if (changed && s.clients.size > 0) broadcast(s.clients, 'snapshot', companySnapshot(s, previews));
      } catch (error) {
        const problem = `${nameOf(s)}: ${error instanceof Error ? error.message : String(error)}`;
        if (problem !== lastProblem) warn(problem);
        lastProblem = problem;
      }
    }
    if (poll) {
      try {
        studio.settle();
      } catch (error) {
        const problem = `the studio: ${error instanceof Error ? error.message : String(error)}`;
        if (problem !== lastProblem) warn(problem);
        lastProblem = problem;
      }
    }
    if (lobbyChanged && at - lastLobby >= LOBBY_EVERY_MS) {
      lobbyChanged = false;
      lastLobby = at;
      if (lobbyClients.size > 0) broadcast(lobbyClients, 'lobby', lobby());
    }
  }, o.tickMs ?? 100);
  stopTicking = () => clearInterval(timer);

  return { server, port, url: hubUrl, tailnetUrl: tailscale?.url ?? null, tailnetPort, addCompany, lobby, close };
}
