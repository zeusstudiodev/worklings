// What the lobby asks the hub on a first run, the consent step for watching a project with v2's office, and the two
// routes `worklings hub --stop` uses:
//
//   GET  /api/setup                   Claude Code (found, version, signed in) and git, each with one fix. Checked once
//                                     and kept for a while; ?fresh=1 checks again (after the person signs in, say).
//   GET  /api/watch?folder=<path>     what watching the folder writes, for the consent step to show. This computer only.
//   POST /api/watch                   {folder, consent: true, port?}: writes the office's hooks into the folder's
//                                     .claude/settings.local.json, only with consent. This computer only.
//   GET  /api/health                  {ok, app: 'worklings-hub', pid}: proof that a process is this hub, before
//                                     `worklings hub --stop` stops the process its lock names.
//   POST /api/hub/stop                closes the hub as Ctrl+C does (desks, previews, the tailnet), once the answer has
//                                     gone. This computer only.
//
// The hub's own checks (loopback Host, same origin, the token) run before these, as for every /api/ route. The watching
// office itself is `worklings office <folder>`, which the answers name; the hub doesn't run one.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { claudeStatus, type ClaudeStatus, gitStatus, type GitStatus } from '../doctor.ts';
import { findClaude } from '../server/claude.ts';
import { DEFAULT_PORT, HOOK_EVENTS, hooksStatus, ignoreLocalSettings, installHooks, settingsFile, wouldIgnoreLocalSettings } from '../server/hooks-config.ts';
import { HttpError, readBody, send } from '../server/http.ts';
import { checkCompanyFolder, type Places } from './folders.ts';
import { localOnly } from './guards.ts';
import { fields, optionalWhole } from './input.ts';

const KB = 1024;
/** A check stays this fresh: signing in or installing Claude Code happens in another window, and ?fresh=1 is the button. */
const FRESH_MS = 5 * 60_000;
const LOCAL_ONLY = 'Watching a project works on the computer running Worklings: start it there.';
/** Where the hooks go in a project, as people see the path. */
const LOCAL_SETTINGS = '.claude/settings.local.json';

export interface SetupView {
  claude: ClaudeStatus;
  git: GitStatus;
  /** When this was checked (the hub's clock). */
  checkedAt: number;
}

/** What the consent step shows before anything is written. */
export interface WatchPlan {
  folder: string;
  /** The settings file the hooks go in, relative to the folder. */
  file: string;
  /** The office's port the hooks post to. */
  port: number;
  /** How many Claude Code events they report. */
  events: number;
  /** True when the folder's hooks already post to this port: nothing to write. */
  installed: boolean;
  /** The port its hooks post to now, when it has some. */
  installedPort: number | null;
  /** True when watching adds .claude/settings.local.json to the folder's .gitignore too. */
  gitignore: boolean;
  /** The command that opens the office for the folder once the hooks are in. */
  open: string;
}

export interface SetupOptions {
  /** The environment the desks start from. */
  env: NodeJS.ProcessEnv;
  /** Claude Code's executable when the hub was given one (tests point it at a fake). */
  claude?: string;
  /** The hub's companies and its own folders, for the folder checks. */
  places: () => Places;
  now: () => number;
  /** How long a check stays fresh (five minutes unless given). */
  freshMs?: number;
  /** Closes the hub, as Ctrl+C does; without it there is no stop route. */
  stop?: () => void;
  /** The hub's process id, which /api/health names (this process's unless given). */
  pid?: number;
}

/** What GET /api/health answers. */
export interface HubHealth {
  ok: true;
  app: 'worklings-hub';
  pid: number;
}

export type SetupRoute = (req: IncomingMessage, res: ServerResponse, path: string, url: URL) => Promise<boolean>;

/** A folder to watch: an existing one, by the same rules as a company's folder (no links, system or home folders). */
function watchedFolder(raw: unknown, places: Places): string {
  const check = checkCompanyFolder(raw, places);
  if (!check.ok) throw new HttpError(check.status, check.message, { code: check.code });
  if (!check.exists) throw new HttpError(400, "That folder doesn't exist. Pick the project's folder.", { code: 'missing' });
  return check.root;
}

/** The port from the query or the body, or the watching office's own. */
function portFrom(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_PORT;
  const port = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value;
  return optionalWhole({ port }, 'port', 1, 65_535) ?? DEFAULT_PORT;
}

/**
 * A folder as one word for a shell, in single quotes so `$`, backticks and spaces stay literal in bash and in
 * PowerShell. For PowerShell (on Windows, where that is the shell people paste into) every character it takes as a
 * single quote is doubled: ' and the typographic ‘ ’ ‚ ‛, any of which would end the word. For bash a ' is closed,
 * escaped and reopened.
 */
export function shellQuote(word: string, windows = process.platform === 'win32'): string {
  return `'${windows ? word.replace(/['‘’‚‛]/g, (q) => q + q) : word.replaceAll("'", String.raw`'\''`)}'`;
}

const openCommand = (folder: string, port: number) => `npx worklings office ${shellQuote(folder)}${port === DEFAULT_PORT ? '' : ` --port ${port}`}`;

/** A refusal to touch the settings (not JSON, a linked .claude or .gitignore), as the sentence the hooks code says. */
function settingsRefusal(error: unknown): never {
  throw new HttpError(400, error instanceof Error ? error.message : String(error), { code: 'settings' });
}

export function watchPlan(folder: string, port: number): WatchPlan {
  let status: ReturnType<typeof hooksStatus>;
  let gitignore: boolean;
  try {
    status = hooksStatus(settingsFile(folder), folder);
    gitignore = wouldIgnoreLocalSettings(folder);
  } catch (error) {
    settingsRefusal(error);
  }
  return {
    folder, file: LOCAL_SETTINGS, port, events: HOOK_EVENTS.length, installed: status.installed && status.port === port, installedPort: status.port, gitignore,
    open: openCommand(folder, port),
  };
}

/** The routes above, for the hub's api(): true when one of them answered. */
export function setupRoutes(o: SetupOptions): SetupRoute {
  const freshMs = o.freshMs ?? FRESH_MS;
  let last: SetupView | null = null;
  let checking: Promise<SetupView> | null = null;

  const check = (): Promise<SetupView> =>
    (checking ??= (async () => {
      const claude = o.claude ? findClaude({ ...o.env, WORKLINGS_CLAUDE: o.claude }) : undefined;
      const [found, git] = await Promise.all([claudeStatus({ env: o.env, ...(claude ? { claude } : {}) }), gitStatus(o.env)]);
      last = { claude: found, git, checkedAt: o.now() };
      return last;
    })().finally(() => {
      checking = null;
    }));

  return async (req, res, path, url) => {
    const method = req.method ?? 'GET';
    if (path === '/api/health' && method === 'GET') {
      const health: HubHealth = { ok: true, app: 'worklings-hub', pid: o.pid ?? process.pid };
      send(res, 200, health);
      return true;
    }
    if (path === '/api/hub/stop' && method === 'POST' && o.stop) {
      localOnly(req, 'Stopping the hub works only on the computer running it.');
      const stop = o.stop;
      // The answer goes first: closing the hub cuts every connection, this one too.
      res.once('finish', () => stop());
      send(res, 202, { stopping: true, pid: o.pid ?? process.pid });
      return true;
    }
    if (path === '/api/setup' && method === 'GET') {
      const fresh = url.searchParams.get('fresh') === '1';
      const view = !fresh && last !== null && o.now() - last.checkedAt < freshMs ? last : await check();
      send(res, 200, view);
      return true;
    }
    if (path === '/api/watch' && method === 'GET') {
      localOnly(req, LOCAL_ONLY);
      const folder = watchedFolder(url.searchParams.get('folder'), o.places());
      send(res, 200, watchPlan(folder, portFrom(url.searchParams.get('port'))));
      return true;
    }
    if (path === '/api/watch' && method === 'POST') {
      localOnly(req, LOCAL_ONLY);
      const body = fields(await readBody(req, 4 * KB), ['folder', 'consent', 'port']);
      if (body.consent !== true) {
        throw new HttpError(400, `Watching a project writes hooks into its ${LOCAL_SETTINGS}, so it needs the person's OK first: send consent: true once they agreed.`, {
          code: 'consent',
        });
      }
      const folder = watchedFolder(body.folder, o.places());
      const port = portFrom(body.port);
      let gitignoreUpdated: boolean;
      try {
        // .gitignore first, as `worklings hooks install` does: a linked one stops it before any hook is written.
        gitignoreUpdated = ignoreLocalSettings(folder);
        installHooks(settingsFile(folder), port, folder);
      } catch (error) {
        settingsRefusal(error);
      }
      send(res, 200, { ...watchPlan(folder, port), installed: true, gitignoreUpdated });
      return true;
    }
    return false;
  };
}
