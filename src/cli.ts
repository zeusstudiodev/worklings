#!/usr/bin/env node
import { cleanLaunch, PERMISSION_MODES, type PlainLaunch } from './core/plain.ts';
import { cleanPackIds, PACK_IDS, PACK_RECORD, PACKS, type PackId } from './core/packs.ts';
import { folderPacks, installPacks, removePack } from './packs/install.ts';
import { EFFORTS } from './core/steering.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openBrowser } from './browser.ts';
import { compose } from './composer/compose.ts';
import { detect } from './composer/detect.ts';
import { DEFAULT_LIBRARY, lintLibrary, loadLibrary } from './composer/library.ts';
import { writePlan } from './composer/write.ts';
import { consent, terminalAsker } from './consent.ts';
import { RIGOR_LEVELS, type Rigor, serializeStudio } from './core/studio.ts';
import { claudeMissing, claudeStatus, formatDoctor, runDoctor } from './doctor.ts';
import { DEFAULT_PORT, HOOK_EVENTS, hooksStatus, ignoreLocalSettings, installHooks, settingsFile, uninstallHooks } from './server/hooks-config.ts';
import { DemoPlayer, demoStudio } from './server/demo.ts';
import { HttpError } from './server/http.ts';
import { Office } from './server/office.ts';
import { loadProjectStudio, MANIFEST } from './server/project.ts';
import { listSessions, ReplayPlayer, transcriptDir } from './server/replay.ts';
import { reshape } from './server/reshape.ts';
import { tailorRole } from './composer/tailor.ts';
import { runOffice } from './server/run.ts';
import { freshToken, loadToken } from './server/token.ts';
import { LIMITS } from './core/company.ts';
import { DEFAULT_HUB_PORT, type RunningHub, startHub } from './hub/index.ts';
import { hubDir, runningHub, worklingsHome } from './hub/home.ts';
import { PACKAGE_JSON, WEB_DIR } from './paths.ts';

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };

const USAGE = `worklings ${pkg.version}
Claude Code with an office around it: give it a job, then watch, approve and steer it from a 3D office. It can also staff a project with an AI studio.

Usage
  worklings                          Open the hub's lobby: your companies, the demo company and a new company
      --port <n>                       Port (default ${DEFAULT_HUB_PORT})
      --tailnet                        Also serve it on your tailnet through tailscale serve (token required)
      --no-open                        Don't open a browser
  worklings hub                      The same. One hub runs per computer; when it runs already, this opens it
      --stop                           Stop the hub that runs on this computer (it closes its companies' desks first)
  worklings demo                     Open the demo company: made up, with no Claude Code and nothing to pay
      --port <n>                       Port (default ${DEFAULT_PORT - 1})
  worklings doctor                   Check Node, Claude Code and its sign-in, git, the hub's ports and Tailscale
      --port <n>                       The hub's port to check (default ${DEFAULT_HUB_PORT})
  worklings new [dir] --prompt <text>
                                     Start a job in a folder: Claude Code works on your words as you wrote them
                                     (through the hub when one runs, else in a hub started for it)
      --model <m>, --effort <e>        For this job only; left out, your Claude Code's own defaults
      --permission-mode <mode>         For this job only (acceptEdits, auto, bypassPermissions, manual, dontAsk)
      --plan-first                     Start in Claude Code's plan mode; you approve the plan in the inbox
      --pack <name>                    Add a pack to the project's .claude/ first (repeat, or a,b):
                                       ${PACK_IDS.join(', ')}; off unless named
      --team                           A team instead (experimental): a Lead, a Builder and a Reviewer
      --port <n>, --tailnet, --no-open As for the hub
  worklings office [dir]             Watch a project's Claude Code sessions in the 3D office (default: this folder)
      --port <n>                       Port (default ${DEFAULT_PORT}); hooks are installed for this port
      --yes                            Add the hooks sessions report through without asking
      --lan                            Also listen on the local network (token required for everything)
      --no-open                        Don't open a browser
  worklings new [dir]                Generate a studio for a project; --offline does this even with --prompt
      --domain <id>                    Kind of project (detected when there is code; see \`worklings domains\`)
      --rigor lean|standard|full       Team size and process (default lean)
      --name <text> --idea <text>      Project name and a sentence on what it is
      --stack <a,b>                    Intended stack for a project with no code yet (e.g. expo,typescript)
      --add <roles> --remove <roles>   Adjust the team (comma-separated role ids)
      --force                          Replace files you edited (backed up to .claude/studio/backup/)
      --dry-run                        Show what would be written
  worklings packs [dir]              List the packs and which this folder has (plain files in .claude/)
  worklings packs add <name> [dir]   Add a pack to the folder's .claude/
  worklings packs remove <name> [dir]
                                     Remove a pack: the files of it you didn't edit
  worklings replay [dir]             Replay a past Claude Code session of a project in the office
      --session <id|latest>            Which session (default latest; the start of an id is enough)
      --speed <n>                      Playback speed (default 4)
  worklings detect [dir]             Show the detected stack, commands and matching domains
  worklings domains                  List the kinds of project and their lean teams
  worklings adopt [dir] [--write]    Infer a studio from existing .claude/agents; --write saves studio.yaml
  worklings tailor <role> [dir] --note <text> [--note <text>...]
                                     Fit a role to this project (replaces its earlier notes)
  worklings hire <role> [dir] [--room <id>]     Hire a role from the library
  worklings fire <role> [dir]                   Fire a role (its file is archived in .claude/studio/fired/)
  worklings rehire <role> [dir]                 Bring a fired role back
  worklings move <role> <room> [dir]            Move a role to another room
  worklings model <role> <inherit|opus|sonnet|haiku> [dir]   Change the model a role runs on
  worklings hooks install|uninstall|status [dir] [--port <n>] [--user] [--yes]
                                     Live events for the office (project-local settings unless --user);
                                     install asks before it writes, and --yes agrees for scripts
  worklings lint-library [--library <dir>]
  worklings help | --help | --version

Changed in this version: \`worklings\` alone opens the hub's lobby. The office that watches a folder's sessions is
\`worklings office\` (\`worklings <dir>\` still opens it), and installing hooks asks first unless you pass --yes.

Add --json to new, detect, domains, adopt, hooks and doctor for machine-readable output.
`;

type Options = Record<string, string | boolean | string[] | undefined>;
type Command = (positionals: string[], options: Options) => number | Promise<number>;

const out = (text: string) => process.stdout.write(`${text}\n`);
const err = (text: string) => process.stderr.write(`${text}\n`);
const list = (value: unknown) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);
const dirArg = (positionals: string[]) => resolve(positionals[0] ?? '.');
const json = (options: Options, value: unknown) => {
  if (options.json) out(JSON.stringify(value, null, 2));
  return Boolean(options.json);
};

function libraryFrom(options: Options) {
  return loadLibrary(typeof options.library === 'string' ? resolve(options.library) : DEFAULT_LIBRARY);
}

/** The office's access token: the saved one, or a fresh one for --lan so the link dies with the office. */
const tokenFor = (options: Options) => (options.lan ? freshToken() : loadToken());

/**
 * Started from inside Claude Code (the plugin runs this CLI there), what is printed lands in a transcript: a link then
 * leaves its token out, and the browser is the one that opens with it.
 */
const insideClaude = (): boolean => Boolean(process.env.CLAUDECODE);
const shown = (link: string): string => (insideClaude() ? link.replace(/\?token=[^&\s]*/, '') : link);
/** The line after a printed link when its token was left out. */
function tokenNote(options: Options): string[] {
  if (!insideClaude()) return [];
  return [options['no-open'] ? '  The link has no token here because Claude Code records this output. Run `worklings` in a terminal to open it with the token.' : '  The browser opened it with the token, which is left out of this output because Claude Code records it.'];
}

const validSpeed = (speed: number) => Number.isFinite(speed) && speed > 0 && speed <= 600;

/** --port 0 lets the office pick any free port (handy for scripts); hooks need a real one. */
function portOf(options: Options, allowAny = false, fallback = DEFAULT_PORT): number {
  if (options.port === undefined) return fallback;
  const port = Number(options.port);
  const min = allowAny ? 0 : 1;
  if (!Number.isInteger(port) || port < min || port > 65535) throw new Error(`--port must be a number between ${min} and 65535, got ${String(options.port)}`);
  return port;
}

/** Hooks an earlier version installed still post to the office; installing again, with the same port, updates them. */
const olderHooksHint = (port: number | null, user: boolean) =>
  `The hooks an earlier version installed still work; \`worklings hooks install${port !== null && port !== DEFAULT_PORT ? ` --port ${port}` : ''}${user ? ' --user' : ''}\` updates them.`;

/** What installing the office's hooks writes, said before the person is asked. */
function hooksExplained(where: string, port: number, user: boolean): string[] {
  return [
    `Worklings will add an http hook for ${HOOK_EVENTS.length} events to ${where}${user ? '' : ', which stays out of git'}.`,
    `From then on every Claude Code session ${user ? 'on this computer' : 'in this project'} posts its prompts and tool calls to 127.0.0.1:${port}, the office's port.`,
    'When nothing listens there they fail quietly and never block a session, and `worklings hooks uninstall` takes them out.',
  ];
}

/**
 * `worklings hooks install` asks before it writes: --yes agrees for scripts, and a terminal asks the person. False when
 * they said no; an error when nobody can answer, since writing without a yes is never the default.
 */
async function agreeToHooks(where: string, port: number, user: boolean, options: Options): Promise<boolean> {
  if (options.yes) return true;
  if (options.json) throw new Error('Pass --yes with --json: Worklings asks before it writes hooks, and --json leaves nobody to ask.');
  const asker = terminalAsker();
  if (!asker.interactive) throw new Error(`Installing hooks changes ${where}, so Worklings asks first, and nobody can answer here. Run it in a terminal, or pass --yes to agree.`);
  for (const line of hooksExplained(where, port, user)) out(line);
  const answer = await consent(asker, 'Add them?', false);
  if (answer !== 'yes') out(`Nothing changed in ${where}.`);
  return answer === 'yes';
}

/**
 * The office offers its hooks when the project has none or they post to another port: a terminal asks, --yes adds
 * them, and with nobody to ask nothing is written (the office says how to add them). A refusal to write (a settings
 * file that isn't JSON, a link) is said and the office opens anyway.
 */
async function offerHooks(root: string, port: number, options: Options): Promise<void> {
  const file = settingsFile(root);
  const where = relative(root, file).replaceAll('\\', '/');
  const status = hooksStatus(file);
  if (status.installed && status.port === port) return;
  const asker = terminalAsker();
  if (!options.yes) {
    if (!asker.interactive) return;
    if (status.installed) out(`This project's hooks post to port ${status.port}, and this office is on ${port}.`);
    else for (const line of hooksExplained(where, port, false)) out(line);
  }
  const answer = await consent(asker, status.installed ? 'Point them at this office?' : 'Add them?', Boolean(options.yes));
  if (answer !== 'yes') return;
  try {
    const ignored = ignoreLocalSettings(root);
    installHooks(file, port, root);
    out(`Installed office hooks for port ${port} in ${where}${ignored ? ' (and added it to .gitignore)' : ''}.`);
  } catch (error) {
    err(`No hooks written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** What `serve` keeps running: an office or the hub. */
interface Served {
  url: string;
  close(): Promise<void>;
  /** Its server, whose close (from `worklings hub --stop`, say) ends the command too. */
  server?: { once(event: 'close', listener: () => void): unknown };
}

/** Prints the link (to `path` under the server), opens the browser and keeps it running until Ctrl+C. */
async function serve(running: Served, token: string, options: Options, lines: string[], onStop: () => void = () => {}, path = ''): Promise<number> {
  const link = `${running.url}${path}?token=${token}`;
  out(lines[0] ?? 'Worklings office');
  out(`  Open: ${shown(link)}`);
  for (const line of tokenNote(options)) out(line);
  if (options.lan) {
    out('  Listening on your local network too, over plain HTTP: use it on a network you trust, and treat the link as a');
    out('  password. It stops working when this office stops.');
  }
  for (const line of lines.slice(1)) out(`  ${line}`);
  out('  Press Ctrl+C to stop.');
  if (!options['no-open']) openBrowser(link);
  await new Promise<void>((done) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      onStop();
      void running.close().then(done);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // Closed from elsewhere (the hub's stop route): nothing is left to run, so the command ends.
    running.server?.once('close', () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      if (!stopped) onStop();
      stopped = true;
      done();
    });
  });
  return 0;
}

/** How long a hub may take to close its companies after `worklings hub --stop` asked it to, before it is ended. */
const STOP_WAIT_MS = 30_000;

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Resolves true once the process has gone, false when it is still there after `ms`. */
async function gone(pid: number, ms: number): Promise<boolean> {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    if (!isRunning(pid)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return !isRunning(pid);
}

/**
 * `worklings hub --stop`: stops this computer's hub by the process its lock names, and only once that process proves
 * it is the hub (the lock's port answers /api/health with the same process id), so a process number another program
 * got since is never stopped. The hub closes as it does on Ctrl+C; one still there after STOP_WAIT_MS is ended.
 */
async function stopHub(): Promise<number> {
  const lock = runningHub(hubDir(worklingsHome()));
  if (!lock) {
    out('No Worklings hub is running on this computer.');
    return 0;
  }
  const token = loadToken();
  const base = `http://127.0.0.1:${lock.port}`;
  const headers = { authorization: `Bearer ${token}` };
  const isHub = async (): Promise<boolean> => {
    const health = (await fetch(`${base}/api/health`, { headers, signal: AbortSignal.timeout(5_000) })
      .then(async (res) => (res.ok ? ((await res.json()) as unknown) : null))
      .catch(() => null)) as { app?: unknown; pid?: unknown } | null;
    return health?.app === 'worklings-hub' && health.pid === lock.pid;
  };
  if (!(await isHub())) {
    err(`The hub's lock names process ${lock.pid} on port ${lock.port}, but no Worklings hub answers there as that process, so nothing was stopped.`);
    return 1;
  }
  out(`Stopping the Worklings hub on port ${lock.port} (process ${lock.pid}): it closes every company's desks first.`);
  const asked = await fetch(`${base}/api/hub/stop`, { method: 'POST', headers, signal: AbortSignal.timeout(5_000) }).then(
    (res) => res.status === 202,
    () => false,
  );
  if (!asked || !(await gone(lock.pid, STOP_WAIT_MS))) {
    // The proof is as old as the wait: the hub may have gone meanwhile and its number may belong to another program now.
    if (!(await gone(lock.pid, 0)) && !(await isHub())) {
      err(`Process ${lock.pid} no longer answers on port ${lock.port} as the Worklings hub, so it was left running.`);
      return 1;
    }
    try {
      process.kill(lock.pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    if (!(await gone(lock.pid, 5_000))) {
      err(`The hub (process ${lock.pid}) is still running. Stop it from the terminal it runs in.`);
      return 1;
    }
  }
  out('Stopped.');
  return 0;
}

/** hire, fire, rehire, move and model: the same changes the office makes, straight from a terminal or a skill. */
function change(dir: string | undefined, action: Record<string, unknown>, options: Options): number {
  if (typeof action.role !== 'string') throw new Error(`Say which role, e.g. \`worklings ${String(action.action)} qa-engineer\`.`);
  const result = reshape({ root: resolve(dir ?? '.'), library: libraryFrom(options) }, action);
  if (json(options, result)) return 0;
  out(result.message);
  for (const f of result.changed) out(`  ~ ${f}`);
  return 0;
}

/** Starts a server, turning a busy port into a clear message instead of a stack trace. */
async function start<T>(launch: () => Promise<T>, port: number, what = 'an office'): Promise<T | null> {
  try {
    return await launch();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      err(`Port ${port} is already in use. If ${what} is already running there, open it; otherwise pass --port.`);
      return null;
    }
    throw error;
  }
}

/**
 * The hub's opening lines: its companies, the tailnet link with --tailnet, and for a first run what helps most: the
 * demo company when there is no company yet, and how to get Claude Code when it can't be found.
 */
function hubLines(hub: RunningHub, token: string, first: string): string[] {
  const companies = hub.lobby().companies;
  const lines = [first || `Worklings hub: ${companies.length === 0 ? 'no companies yet' : companies.map((c) => c.name).join(', ')}`];
  if (hub.tailnetUrl) {
    lines.push(`On your tailnet: ${shown(`${hub.tailnetUrl}?token=${token}`)}`);
    lines.push('Only your tailnet reaches it, never the public internet. The link carries the token: treat it as a password.');
  }
  if (companies.length === 0) lines.push(`The demo company, made up and free: ${shown(`${hub.url}c/demo?token=${token}`)}`);
  const missing = claudeMissing();
  if (missing) lines.push(`${missing.message} ${missing.fix ?? ''} Until then the demo company works, and new companies can't start.`.replace(/\s+/g, ' ').trim());
  lines.push("Closing the hub closes every company's desks; they pick up where they stopped when it opens again.");
  return lines;
}

/** Starts a hub on this computer, saying plainly why when it can't. */
async function launchHub(port: number, options: Options, token: string): Promise<RunningHub | null> {
  if (options.lan) throw new Error('The hub never listens on the local network: use --tailnet to reach it from your phone.');
  const library = libraryFrom(options);
  // New companies run as their creator chooses (one Claude Code session, or the experimental team). WORKLINGS_SHAPE is a
  // developer's override that wins over that choice: plain, solo, harness or classic.
  const named = process.env.WORKLINGS_SHAPE;
  const shape = named === 'classic' || named === 'harness' || named === 'solo' || named === 'plain' ? named : undefined;
  return start(() => startHub({ port, token, webDir: WEB_DIR, library, tailnet: Boolean(options.tailnet), ...(shape ? { shape } : {}) }), port, 'a hub');
}

/** What a hub already running on `port` says to a new company: null when nothing answers there. */
async function askHub(port: number, token: string, folder: string, prompt: string, launch: PlainLaunch, work: 'plain' | 'team', packs: readonly PackId[]): Promise<{ id: string; reopened: boolean } | null> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/companies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ folder, prompt, launch, work, ...(packs.length > 0 ? { packs } : {}) }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if ((error as { cause?: { code?: unknown } }).cause?.code === 'ECONNREFUSED') return null;
    throw new Error(`The hub on port ${port} didn't answer: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const body = (await res.json().catch(() => null)) as { id?: unknown; reopened?: unknown; error?: unknown } | null;
  if (res.ok && typeof body?.id === 'string') return { id: body.id, reopened: body.reopened === true };
  if (res.status === 401) throw new Error(`The hub on port ${port} didn't take this computer's token. Is it running with another WORKLINGS_HOME?`);
  if (typeof body?.error === 'string' && res.status !== 404) throw new Error(body.error);
  throw new Error(`Something other than a Worklings hub answers on port ${port}. Pass --port with the hub's port.`);
}

/** The launch choices a `new` names, as the hub takes them; a value Claude Code wouldn't take is refused here, not dropped. */
function launchOf(options: Options): PlainLaunch {
  const asked = { model: options.model, effort: options.effort, permissionMode: options['permission-mode'], planFirst: options['plan-first'] === true };
  const launch = cleanLaunch(asked);
  if (typeof asked.model === 'string' && launch.model === null) throw new Error(`--model ${asked.model} isn't a model name Claude Code takes.`);
  if (typeof asked.effort === 'string' && launch.effort === null) throw new Error(`--effort takes ${EFFORTS.join(', ')}.`);
  if (typeof asked.permissionMode === 'string' && launch.permissionMode === null) throw new Error(`--permission-mode takes ${PERMISSION_MODES.join(', ')}; for plan mode, use --plan-first.`);
  return launch;
}

/** The packs `--pack` names (repeated, or comma-separated); a name that isn't a pack is refused here. */
function packsOf(options: Options): PackId[] {
  const raw = options.pack;
  const names = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).flatMap((n) => String(n).split(',')).map((n) => n.trim()).filter(Boolean);
  const named = cleanPackIds(names);
  if (!named.ok) throw new Error(named.message);
  if (named.ids.length > 0 && options.team === true) throw new Error('Packs are for a one-session job; a team has its own reviewer. Leave out --team or --pack.');
  return named.ids;
}

/** How the job runs: one Claude Code session, unless `--team` asks for the experimental team. */
function launchWork(options: Options): 'plain' | 'team' {
  return options.team === true ? 'team' : 'plain';
}

/** `worklings new [dir] --prompt "..."`: a company in the folder, through the running hub or a new one. */
async function newCompany(positionals: string[], options: Options): Promise<number> {
  const folder = dirArg(positionals);
  const prompt = String(options.prompt).trim();
  if (prompt === '') throw new Error('Say what to build, e.g. `worklings new --prompt "A bilingual café website with pickup orders"`.');
  if (prompt.length > LIMITS.prompt) throw new Error(`Keep the first prompt to ${LIMITS.prompt.toLocaleString('en-US')} characters.`);
  // The CEO is a Claude Code session: without one that starts and is signed in, a company would be made only to fail.
  const claude = await claudeStatus();
  if (claude.state === 'missing' || claude.state === 'signed-out') {
    throw new Error(`${claude.message} ${claude.fix ?? ''} No company was started; \`worklings demo\` shows one meanwhile.`.replace(/\s+/g, ' ').trim());
  }
  const token = loadToken();
  // The hub that runs on this computer is found by its lock, whatever port it took; --port names one.
  const port = options.port === undefined ? (runningHub(hubDir(worklingsHome()))?.port ?? DEFAULT_HUB_PORT) : portOf(options, false, DEFAULT_HUB_PORT);
  // v0.7: the job's own launch choices; anything left out, or that Claude Code wouldn't take, is left to Claude Code.
  const launch = launchOf(options);
  const packs = packsOf(options);
  const told = await askHub(port, token, folder, prompt, launch, launchWork(options), packs);
  if (told) {
    const link = `http://127.0.0.1:${port}/c/${encodeURIComponent(told.id)}/progress?token=${token}`;
    out(told.reopened ? `${folder} already has a company: it is back in the lobby.` : `Started a job in ${folder}.`);
    out(`  Open: ${shown(link)}`);
    for (const line of tokenNote(options)) out(line);
    if (!options['no-open']) openBrowser(link);
    return 0;
  }
  const hub = await launchHub(port, options, token);
  if (!hub) return 1;
  let added: { id: string; reopened: boolean };
  try {
    added = await hub.addCompany({ folder, prompt, launch, work: launchWork(options), packs });
  } catch (error) {
    await hub.close();
    throw error;
  }
  const first = added.reopened ? `Worklings hub: ${folder} already has a company, back in the lobby` : `Worklings hub: started a job in ${folder}.`;
  return serve(hub, token, options, hubLines(hub, token, first), () => {}, `c/${encodeURIComponent(added.id)}/progress`);
}

const commands: Record<string, Command> = {
  async office(positionals, options) {
    if (options.tailnet) throw new Error('--tailnet serves the hub: run `worklings hub --tailnet`.');
    const root = dirArg(positionals);
    if (!existsSync(root)) throw new Error(`No such folder: ${root}`);
    const project = loadProjectStudio(root);
    const name = project.studio?.name ?? detect(root).name;
    const token = tokenFor(options);
    const port = portOf(options, true);
    const running = await start(() => runOffice({ root, name, port, lan: Boolean(options.lan), token, webDir: WEB_DIR, library: libraryFrom(options), mode: 'live' }), port);
    if (!running) return 1;
    // Hooks for --port 0's passing port would lead nowhere once this office closes, so they are offered only for a set one.
    if (port !== 0) await offerHooks(root, running.port, options);
    const studio = project.studio
      ? `${project.studio.roles.length} roles ${project.source === 'manifest' ? 'from .claude/studio.yaml' : 'inferred from .claude/agents'}`
      : 'no studio yet: run `worklings new` to create one';
    const hooks = hooksStatus(settingsFile(root));
    for (const e of project.errors) err(`  studio.yaml: ${e}`);
    const lines = [
      `Worklings office for ${name} (${studio})`,
      hooks.installed
        ? `Live: hooks installed for port ${hooks.port}${hooks.port !== running.port ? ` (this office is on ${running.port}: run \`worklings hooks install --port ${running.port}\`)` : ''}`
        : 'Live: hooks not installed. Run `worklings hooks install` to watch sessions as they happen.',
    ];
    // On another port, the install command above updates them too.
    if (hooks.legacy && hooks.port === running.port) lines.push(olderHooksHint(hooks.port, false));
    return serve(running, token, options, lines);
  },

  async demo(_positionals, options) {
    const library = libraryFrom(options);
    const office = new Office(process.cwd(), 'Plant Pal', 'demo');
    office.setStudio({ studio: demoStudio(library, pkg.version), source: 'manifest', errors: [] });
    const token = tokenFor(options);
    // One below the live office's port, so the demo can run next to it.
    const port = portOf(options, true, DEFAULT_PORT - 1);
    const running = await start(() => runOffice({ root: process.cwd(), name: office.name, port, lan: Boolean(options.lan), token, webDir: WEB_DIR, library, mode: 'demo', office }), port);
    if (!running) return 1;
    const player = new DemoPlayer(office);
    player.start();
    // The demo company lives in the web app (/c/demo); the same server keeps v2's demo office at its root.
    const lines = [
      'Worklings demo: a made-up company at work, with no Claude Code and nothing to pay',
      `The office that watches a project, with a made-up studio, is at ${shown(`${running.url}?token=${token}`)}`,
    ];
    return serve(running, token, options, lines, () => player.stop(), 'c/demo');
  },

  async doctor(positionals, options) {
    if (positionals.length > 0) throw new Error('The doctor checks this computer, not a folder: run `worklings doctor` on its own.');
    if (!options.json) err("Checking this computer. Claude Code takes a few seconds to say whether it's signed in.");
    const report = await runDoctor({ hubPort: portOf(options, false, DEFAULT_HUB_PORT) });
    if (!json(options, report)) process.stdout.write(formatDoctor(report));
    return report.ok ? 0 : 1;
  },

  help() {
    process.stdout.write(USAGE);
    return 0;
  },

  async replay(positionals, options) {
    const root = dirArg(positionals);
    const sessions = listSessions(root);
    if (sessions.length === 0) throw new Error(`No Claude Code sessions recorded for ${root} (looked in ${transcriptDir(root)}).`);
    const wanted = options.session === undefined || options.session === 'latest' ? sessions[0] : sessions.find((s) => s.id.startsWith(String(options.session)));
    if (!wanted) throw new Error(`No session starting with "${String(options.session)}". Recent ones: ${sessions.slice(0, 5).map((s) => s.id.slice(0, 8)).join(', ')}`);
    const speed = options.speed === undefined ? 4 : Number(options.speed);
    if (!validSpeed(speed)) throw new Error(`--speed must be a number above 0 and up to 600, got ${String(options.speed)}`);
    const project = loadProjectStudio(root);
    const office = new Office(root, project.studio?.name ?? detect(root).name, 'replay');
    const player = new ReplayPlayer(office, root);
    // Load before the server starts: a session that can't be replayed should end the command, not leave it hanging.
    player.load(wanted.id, wanted.title);
    player.setSpeed(speed);
    const token = tokenFor(options);
    const port = portOf(options, true);
    const control = (body: unknown) => {
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      if (typeof b.session === 'string') {
        const next = listSessions(root).find((s) => s.id === b.session);
        if (!next) throw new HttpError(404, 'No such session.');
        try {
          player.load(next.id, next.title);
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error));
        }
      }
      if (b.restart === true) player.restart();
      if (typeof b.speed === 'number') {
        if (!validSpeed(b.speed)) throw new HttpError(400, 'Speed must be above 0 and up to 600.');
        player.setSpeed(b.speed);
      }
      if (typeof b.play === 'boolean') player.play(b.play);
      return { ok: true };
    };
    const running = await start(
      () => runOffice({ root, name: office.name, port, lan: Boolean(options.lan), token, webDir: WEB_DIR, library: libraryFrom(options), mode: 'replay', office, api: { sessions: () => listSessions(root), replay: control } }),
      port,
    );
    if (!running) return 1;
    player.play(true);
    return serve(running, token, options, [`Replaying "${wanted.title}" from ${new Date(wanted.startedAt).toLocaleString()} (${wanted.subagents} subagents)`], () => player.stop());
  },

  async hub(positionals, options) {
    if (positionals.length > 0) throw new Error('The hub takes no folder: start a company with `worklings new <dir> --prompt "..."`, or from the lobby.');
    if (options.stop) return stopHub();
    const token = loadToken();
    // One hub per computer: run again with no port named, it opens the one that runs instead of failing on its port.
    const already = options.port === undefined ? runningHub(hubDir(worklingsHome())) : null;
    if (already) {
      const link = `http://127.0.0.1:${already.port}/?token=${token}`;
      out(`A Worklings hub is already running on port ${already.port}.`);
      out(`  Open: ${shown(link)}`);
      for (const line of tokenNote(options)) out(line);
      out('  To start it again with other options, stop it first (Ctrl+C where it runs).');
      if (!options['no-open']) openBrowser(link);
      return 0;
    }
    const port = portOf(options, true, DEFAULT_HUB_PORT);
    const hub = await launchHub(port, options, token);
    if (!hub) return 1;
    return serve(hub, token, options, hubLines(hub, token, ''));
  },

  new(positionals, options) {
    if (typeof options.prompt === 'string' && !options.offline) return newCompany(positionals, options);
    if (options.pack !== undefined) throw new Error('--pack goes with --prompt, for a job; `worklings packs add <name>` adds one to a folder.');
    const root = dirArg(positionals);
    const library = libraryFrom(options);
    const detection = detect(root, library);
    const rigor = (options.rigor ?? 'lean') as Rigor;
    if (!RIGOR_LEVELS.includes(rigor)) throw new Error(`--rigor must be one of ${RIGOR_LEVELS.join(', ')}`);
    let domain = typeof options.domain === 'string' ? options.domain : undefined;
    const notes: string[] = [];
    if (!domain) {
      const best = detection.domains[0];
      if (best) {
        domain = best.id;
        notes.push(`Detected a ${library.domains.get(best.id)?.title.toLowerCase() ?? best.id} (${best.reasons.join(', ')}).`);
      } else if (detection.isEmpty) {
        throw new Error(`This folder has no code yet, so pass --domain. Kinds of project: ${[...library.domains.keys()].sort().join(', ')}`);
      } else {
        domain = 'generic';
        notes.push('No specific kind of project detected; using the generic studio. Pass --domain to choose one.');
      }
    }
    const existing = loadProjectStudio(root);
    const plan = compose({
      library, domain, rigor, detection, version: pkg.version,
      ...(typeof options.name === 'string' ? { name: options.name } : {}),
      ...(typeof options.idea === 'string' ? { idea: options.idea } : {}),
      stacks: list(options.stack), add: list(options.add), remove: list(options.remove),
      fired: existing.source === 'manifest' ? (existing.studio?.fired ?? []) : [],
    });
    const result = writePlan(root, plan, { force: Boolean(options.force), dryRun: Boolean(options['dry-run']) });
    if (json(options, { domain, rigor, studio: plan.studio, result, notes: [...notes, ...plan.notes] })) return 0;
    for (const note of [...notes, ...plan.notes]) out(note);
    const verb = options['dry-run'] ? 'Would write' : 'Wrote';
    out(`${verb} ${result.written.length} file(s) for a ${rigor} ${domain} studio: ${plan.studio.roles.map((r) => r.id).join(', ')}.`);
    for (const f of result.written) out(`  + ${f}`);
    if (result.unchanged.length > 0) out(`  ${result.unchanged.length} file(s) already up to date.`);
    if (result.kept.length > 0) {
      out(`  Kept ${result.kept.length} file(s) you changed (use --force to replace them; originals are backed up):`);
      for (const f of result.kept) out(`  = ${f}`);
    }
    if (!options['dry-run']) out('Next: `worklings office` to watch sessions live; it asks before adding the hooks they report through.');
    return 0;
  },

  detect(positionals, options) {
    const library = libraryFrom(options);
    const d = detect(dirArg(positionals), library);
    if (json(options, d)) return 0;
    out(`${d.name}${d.isEmpty ? ' (no code yet)' : ''}`);
    if (d.frameworks.length > 0) out(`  Stack: ${d.frameworks.join(', ')}${d.packageManager ? ` (${d.packageManager})` : ''}`);
    const commandsLine = Object.entries(d.commands).map(([k, v]) => `${k}: ${v}`).join(' · ');
    if (commandsLine) out(`  Commands: ${commandsLine}`);
    if (d.folders.length > 0) out(`  Folders: ${d.folders.join(', ')}`);
    out(d.domains.length > 0 ? '  Looks like:' : '  No specific kind of project detected (the generic studio fits).');
    for (const m of d.domains.slice(0, 3)) out(`    ${m.id} (score ${m.score}): ${m.reasons.join(', ')}`);
    return 0;
  },

  packs(positionals, options) {
    const [verb, ...rest] = positionals;
    if (verb === 'add' || verb === 'remove') {
      const named = cleanPackIds([rest[0] ?? '']);
      if (!named.ok || named.ids.length === 0) throw new Error(`Say which pack: ${PACK_IDS.join(', ')}.`);
      const id = named.ids[0] as PackId;
      const root = dirArg(rest.slice(1));
      if (!existsSync(root)) throw new Error(`No such folder: ${root}`);
      const title = PACKS.find((p) => p.id === id)?.title ?? id;
      if (verb === 'add') {
        const done = installPacks(root, [id]);
        out(done.added.length > 0 ? `Added ${title} to ${root}'s .claude/ (recorded in .claude/${PACK_RECORD}).` : `${root} has ${title} already.`);
        return 0;
      }
      const gone = removePack(root, id);
      out(`Removed ${title}: ${gone.removed.length} file${gone.removed.length === 1 ? '' : 's'}.`);
      if (gone.kept.length > 0) out(`  Kept, because they were edited: ${gone.kept.map((f) => `.claude/${f}`).join(', ')}. Delete them yourself if you don't want them.`);
      return 0;
    }
    const root = dirArg(positionals);
    if (!existsSync(root)) throw new Error(`No such folder: ${root}`);
    const there = folderPacks(root, { domain: null, empty: false });
    if (json(options, PACKS.map((p) => ({ id: p.id, title: p.title, for: p.forWhat, cost: p.cost, files: p.files, state: there.packs[p.id].state })))) return 0;
    const said: Record<string, string> = { absent: 'not here', installed: 'here', edited: 'here, edited', partial: 'partly removed', conflict: 'blocked by a file of your own' };
    for (const p of PACKS) {
      out(`${p.id.padEnd(18)} ${p.title}: ${said[there.packs[p.id].state] ?? ''}`);
      out(`${' '.repeat(19)}${p.forWhat}. ${p.cost}`);
    }
    if (there.blocked) out(there.blocked);
    return 0;
  },

  domains(_positionals, options) {
    const library = libraryFrom(options);
    const domains = [...library.domains.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (json(options, domains.map((d) => ({ id: d.id, title: d.title, summary: d.summary, lean: d.roles.lean })))) return 0;
    for (const d of domains) out(`${d.id.padEnd(18)} ${d.title}: ${d.summary}\n${' '.repeat(19)}lean team: ${d.roles.lean.join(', ')}`);
    return 0;
  },

  adopt(positionals, options) {
    const root = dirArg(positionals);
    const project = loadProjectStudio(root);
    if (!project.studio) throw new Error('No .claude/agents folder here, so there is nothing to adopt. Use `worklings new` instead.');
    if (json(options, project)) return 0;
    out(`${project.studio.roles.length} roles in ${project.studio.departments.length} rooms (${project.source === 'manifest' ? 'from studio.yaml' : 'inferred'}):`);
    for (const d of project.studio.departments) {
      const roles = project.studio.roles.filter((r) => r.department === d.id).map((r) => r.id);
      if (roles.length > 0) out(`  ${d.name}: ${roles.join(', ')}`);
    }
    if (options.write) {
      const file = resolve(root, MANIFEST);
      if (existsSync(file) && !options.force) throw new Error(`${MANIFEST} already exists; pass --force to replace it.`);
      writeFileSync(file, serializeStudio(project.studio));
      out(`Wrote ${MANIFEST}. Move roles between rooms by editing it, or from the office.`);
    }
    return 0;
  },

  async hooks(positionals, options) {
    const [action = 'status', dir] = positionals;
    const root = resolve(dir ?? '.');
    const user = Boolean(options.user);
    const file = settingsFile(root, user);
    const where = user ? file : relative(root, file).replaceAll('\\', '/');
    // In a project, writes go through plainPath (see hooks-config.ts); the person's own settings are theirs.
    const project = user ? undefined : root;
    if (action === 'install') {
      const port = portOf(options);
      if (!(await agreeToHooks(where, port, user, options))) return 0;
      // .gitignore first: a linked .gitignore stops the command before it writes anything, and a linked .claude before
      // any hook is written (the .gitignore line it may have added is harmless).
      const ignored = user ? false : ignoreLocalSettings(root);
      installHooks(file, port, project);
      if (json(options, { installed: true, file, port, gitignoreUpdated: ignored })) return 0;
      out(`Installed office hooks for port ${port} in ${where}${ignored ? ' (and added it to .gitignore)' : ''}.`);
      out('Claude Code sessions started from now on report to the office. When the office is closed, hooks fail quietly and never block a session.');
      out(`They post your prompts and tool calls to whatever answers on 127.0.0.1:${port}, office or not: remove them with \`worklings hooks uninstall${user ? ' --user' : ''}\` when you stop using the office.`);
      return 0;
    }
    if (action === 'uninstall') {
      const { removed } = uninstallHooks(file, project);
      if (json(options, { removed, file })) return 0;
      out(removed > 0 ? `Removed ${removed} office hook(s) from ${where}.` : `No office hooks in ${where}.`);
      return 0;
    }
    if (action === 'status') {
      const status = hooksStatus(file);
      if (json(options, { ...status, file })) return 0;
      out(status.installed ? `Office hooks installed in ${where} for port ${status.port} (${status.events.length} events).` : `No office hooks in ${where}.`);
      if (status.legacy) out(olderHooksHint(status.port, user));
      return 0;
    }
    throw new Error(`Unknown hooks action "${action}". Use install, uninstall or status.`);
  },

  tailor(positionals, options) {
    const [role, dir] = positionals;
    if (!role) throw new Error('Say which role, e.g. `worklings tailor qa-engineer --note "Test on a real iPhone"`.');
    const notes = Array.isArray(options.note) ? options.note : typeof options.note === 'string' ? [options.note] : [];
    const file = tailorRole(resolve(dir ?? '.'), role, notes.map(String));
    if (json(options, { ok: true, changed: [file] })) return 0;
    out(`Added ${notes.length} project note(s) to ${file}.`);
    return 0;
  },

  hire: (positionals, options) =>
    change(positionals[1], { action: 'hire', role: positionals[0], ...(typeof options.room === 'string' ? { department: options.room } : {}) }, options),
  fire: (positionals, options) => change(positionals[1], { action: 'fire', role: positionals[0] }, options),
  rehire: (positionals, options) => change(positionals[1], { action: 'rehire', role: positionals[0] }, options),
  move: (positionals, options) => change(positionals[2], { action: 'move', role: positionals[0], department: positionals[1] }, options),
  model: (positionals, options) => change(positionals[2], { action: 'model', role: positionals[0], model: positionals[1] }, options),

  'lint-library'(_positionals, options) {
    const lib = libraryFrom(options);
    const problems = lintLibrary(lib);
    const counts = `${lib.roles.size} roles, ${lib.rules.size} rules, ${lib.skills.size} skills, ${lib.domains.size} domains`;
    if (problems.length === 0) {
      out(`Library OK: ${counts}`);
      return 0;
    }
    err(`${problems.join('\n')}\n\n${problems.length} problem(s) in ${counts}`);
    return 1;
  },
};

/** How many single-letter edits turn one word into the other, for "Did you mean hub?". */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** True for an argument meant as a folder: one that exists here, or that is written as a path. */
const meantAsFolder = (arg: string) => existsSync(resolve(arg)) || isAbsolute(arg) || /[\\/]/.test(arg) || arg.startsWith('.') || arg.startsWith('~');

/** The commands in the order the help shows them. */
const ORDER = ['hub', 'demo', 'doctor', 'new', 'office', 'packs', 'replay', 'detect', 'domains', 'adopt', 'tailor', 'hire', 'fire', 'rehire', 'move', 'model', 'hooks', 'lint-library', 'help'];

/** Says that a word is neither a command nor a folder, with the closest command and every command. */
function unknownCommand(word: string): string {
  const rank = (name: string) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);
  const names = Object.keys(commands).sort((a, b) => rank(a) - rank(b));
  const closest = names.map((name) => ({ name, d: editDistance(word.toLowerCase(), name) })).sort((a, b) => a.d - b.d)[0];
  const guess = closest && closest.d <= Math.max(1, Math.floor(closest.name.length / 3)) ? ` Did you mean \`worklings ${closest.name}\`?` : '';
  return `"${word}" isn't a Worklings command, or a folder here.${guess}\nCommands: ${names.join(', ')}. Run \`worklings --help\` to see what each does.`;
}

const LAN_MOVED =
  "`worklings` alone opens the hub now, which never listens on the local network. Use `worklings office --lan` for the office that watches this folder on your network, or `worklings --tailnet` to reach the hub from your phone.";

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      json: { type: 'boolean' },
      library: { type: 'string' },
      port: { type: 'string' },
      lan: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      stop: { type: 'boolean' },
      domain: { type: 'string' },
      rigor: { type: 'string' },
      name: { type: 'string' },
      idea: { type: 'string' },
      stack: { type: 'string' },
      add: { type: 'string' },
      remove: { type: 'string' },
      force: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      write: { type: 'boolean' },
      user: { type: 'boolean' },
      session: { type: 'string' },
      speed: { type: 'string' },
      room: { type: 'string' },
      note: { type: 'string', multiple: true },
      prompt: { type: 'string' },
      offline: { type: 'boolean' },
      tailnet: { type: 'boolean' },
      model: { type: 'string' },
      effort: { type: 'string' },
      'permission-mode': { type: 'string' },
      'plan-first': { type: 'boolean' },
      team: { type: 'boolean' },
      pack: { type: 'string', multiple: true },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.version) {
    out(pkg.version);
    return 0;
  }
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const [first, ...rest] = positionals;
  // `worklings` alone opens the hub's lobby; the office that watches a folder is `worklings office`.
  if (first === undefined) {
    if (values.lan) throw new Error(LAN_MOVED);
    return commands.hub?.([], values) ?? 2;
  }
  const command = Object.hasOwn(commands, first) ? commands[first] : undefined;
  if (command) return command(rest, values);
  // `worklings <dir>` still opens the office for that folder, as it did before the hub became the default.
  if (meantAsFolder(first)) return commands.office?.(positionals, values) ?? 2;
  err(unknownCommand(first));
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    err(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
