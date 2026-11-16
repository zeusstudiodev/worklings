// The harness seam: what the switchboard needs from the program that runs a person (start a session new or resumed,
// send it a turn, interrupt it, close it, kill it, and hear what it does), with Claude Code as its one implementation
// so another harness (Codex) can come later. The switchboard sees only HarnessPlan, HarnessProcess and DeskEvent.
//
// The Claude Code harness runs the user's own `claude` through findClaude and deskEnv: an argument list, never a shell,
// the office's hooks and org tools in two files in a fresh temporary folder outside the project, beside the desk's own
// scratch folder (its TMP, TEMP and TMPDIR), all removed when the desk exits. The desk's token reaches the process
// only through its environment; the files and the command line name the variable, never its value
// (docs/claude-code-surfaces.md, "Stream-json desks" and "Org tools over MCP").
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedLoads } from '../core/loads.ts';
import { ClaudeError, type ClaudeLookup, deskEnv, findClaude, killDesk, startDesk } from '../server/claude.ts';
import { type Carry, readCarry, serverConfigs, toolPrefixOf } from '../server/claude-config.ts';
import { type Family, endWatch, recordNow, reap, watchDesk } from './descendants.ts';
import type { PlainDesk } from '../core/plain.ts';
import { plainDeskArgs, plainDeskSettings } from './plain-desk.ts';
import { controlAnswer, controlRefusal, type DeskEvent, interruptLine, LineSplitter, parseLine, userLine } from './protocol.ts';

/** How long a PermissionRequest may wait for the stakeholder, in seconds: Claude Code's default, past the hub's 590 s. */
export const PERMISSION_TIMEOUT_S = 600;
/** Stop and SubagentStop only tell the office the desk is alive; the hub answers them at once. */
const LIVENESS_TIMEOUT_S = 5;
/** The variable that carries a desk's token. */
export const TOKEN_VARIABLE = 'WORKLINGS_DESK_TOKEN';
/** The effort a desk runs at when the company sets none for its person. */
export const DEFAULT_EFFORT = 'medium';
/** The org tools' server as a desk's --mcp-config names it: its tools reach the model as mcp__org__<tool>. */
export const ORG_SERVER = 'org';
/**
 * Where the switchboard's appended prompt wants the desk's scratch folder named; the harness fills it with the folder's
 * own path, so the person can give it to the Write tool as the computer reads it (on Windows, with backslashes).
 */
export const SCRATCH_PATH_MARK = '{{scratch-folder}}';
/** How much of a desk's standard error is kept, from its end, for the sentence a crash shows. */
const STDERR_KEEP = 16 * 1024;
/** After the process exits, how long its pipes may stay open (held by something it started) before they are dropped. */
const PIPE_GRACE_MS = 2_000;

export interface HarnessPlan {
  /** Whose desk this is, for messages. */
  person: string;
  /** The project's checkout or the task's worktree. */
  cwd: string;
  sessionId: string;
  /** Resume `sessionId`; otherwise start a new session with that id. */
  resume: boolean;
  /** null runs the user's own default model. */
  model: string | null;
  /** Claude Code's --effort for the desk (one of steering's EFFORTS); null runs at DEFAULT_EFFORT, never at the user's own. */
  effort: string | null;
  /** The agent file to run as. */
  agent: string | null;
  /**
   * What the desk loads (src/core/loads.ts). Given, the desk starts lean: only the project's and local settings, only
   * the servers named here and the org tools, only these tools (docs/claude-code-surfaces.md, "Lean desks"). Left out,
   * it starts the way it did before 0.2: with the user's whole Claude Code setup.
   */
  loads?: ResolvedLoads | null;
  /**
   * Names this person's desk the same way every time it opens, so the folder it works in, and the path the person is
   * told in its prompt (SCRATCH_PATH_MARK), are the same each time. A changed prompt costs the whole conversation its
   * place in Claude Code's prompt cache: a resumed session must see exactly the system prompt it had.
   */
  stable?: string;
  /** Appended to the system prompt. */
  systemPrompt: string;
  /** The hub's loopback origin, for /mcp and /desk/*. */
  hubUrl: string;
  /** Permission rules the desk may use without asking: the org tools and the company's Always allow rules. */
  allow: readonly string[];
  /**
   * Permission rules that always go through the approval hook, even where acceptEdits would let an edit through: the
   * files that change how Claude Code and git run in the project.
   */
  ask: readonly string[];
  /** Permission rules it may never use: the office's own records. */
  deny: readonly string[];
  /**
   * Gives the desk its token once its own scratch folder exists, so the office can tie the folder to the desk (the
   * approvals policy lets a desk work freely in its own scratch). The token is only ever placed in the process's
   * environment.
   */
  issueToken(scratch: string): string;
  /**
   * v0.7: a plain desk (SPEC-v0.7.md): Claude Code as the person runs it, with only the allowed differences
   * (src/runtime/plain-desk.ts). systemPrompt, agent, loads, allow, ask and deny are not used, and the desk keeps the
   * machine's own temporary folder.
   */
  plain?: PlainDesk;
}

export interface HarnessExit {
  code: number | null;
  signal: string | null;
  /** The end of its standard error. */
  stderr: string;
  /** Why it couldn't run at all, in a sentence; null when it ran. */
  error: string | null;
}

export interface HarnessHandlers {
  /** One event per line the desk writes, in order. */
  event(e: DeskEvent): void;
  /** Once, after the process has gone, its last line was read and its temporary folder removed. */
  exit(x: HarnessExit): void;
  /**
   * A plain sentence for the stakeholder about how this desk was started (it came up the standard way, or a check
   * couldn't run), at most once per sentence per harness. Left out, only the log hears it.
   */
  notice?(sentence: string): void;
}

export interface HarnessProcess {
  readonly pid: number | null;
  /** Writes one user turn. False when the desk can't take input any more. */
  send(text: string, uuid: string): boolean;
  /** Asks the desk to stop its turn; the answer comes as an `ack` event with the same id. */
  interrupt(requestId: string): boolean;
  /** Answers a control_request the desk sent; `error` refuses it instead. */
  answer(requestId: string, response: Record<string, unknown> | null, error?: string): boolean;
  /** Ends its input: it finishes what it was given, then exits. */
  close(): void;
  /** Kills it and everything it started. Never rejects. */
  kill(): Promise<void>;
}

export interface Harness {
  readonly name: string;
  /** Starts a desk; throws a HarnessError with a sentence when it can't. Events arrive after this returns. */
  start(plan: HarnessPlan, on: HarnessHandlers): HarnessProcess;
  /**
   * Stops what this person's desks started and left running (dev servers and watchers that outlived their shells), by
   * the pids it recorded. Called when the person's desk is closed, after the desk itself is gone. Never rejects.
   */
  reap?(person: string): Promise<void>;
}

/** A desk that couldn't start; the message is a sentence for the office. */
export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessError';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Claude Code

/**
 * The org tools' server as a desk's --mcp-config names it, the token as a variable the config expands, and the user's
 * servers this person was assigned (`assigned`, keyed by their catalogue names; their configurations may hold secrets, so
 * this goes only into the desk's own file).
 */
export function deskMcpConfig(plan: Pick<HarnessPlan, 'hubUrl'>, assigned: Record<string, object> = {}): object {
  return {
    mcpServers: {
      ...assigned,
      [ORG_SERVER]: { type: 'http', url: hubPath(plan.hubUrl, 'mcp'), headers: { Authorization: `Bearer \${${TOKEN_VARIABLE}}` }, alwaysLoad: true },
    },
  };
}

/**
 * The office's hooks and permission rules, passed with --settings. A lean desk reads no user settings, so `carry` brings
 * over what protects the user from them, each as the user wrote it: their permission rules join the office's, their
 * hooks on every event run before the office's own, and their sandbox, MCP allow and deny lists and environment come
 * along (src/server/claude-config.ts). The office's `allow` list is only the office's: the user's own are not carried.
 */
/** The office's hooks for a plain desk: each an http hook to the hub, the desk's token read from its environment. */
export function officeHooks(hubUrl: string) {
  const hook = (path: string, timeout: number) => ({
    type: 'http',
    url: hubPath(hubUrl, path),
    timeout,
    headers: { 'X-Worklings-Desk': `$${TOKEN_VARIABLE}` },
    allowedEnvVars: [TOKEN_VARIABLE],
  });
  return { permission: hook('desk/permission', PERMISSION_TIMEOUT_S), liveness: hook('desk/hook', LIVENESS_TIMEOUT_S), refusal: hook('desk/refuse', LIVENESS_TIMEOUT_S) };
}

export function deskSettings(plan: Pick<HarnessPlan, 'hubUrl' | 'allow' | 'ask' | 'deny'> & Partial<Pick<HarnessPlan, 'model' | 'effort'>>, carry: Carry | null = null): object {
  const hook = (path: string, timeout: number) => ({
    type: 'http',
    url: hubPath(plan.hubUrl, path),
    timeout,
    headers: { 'X-Worklings-Desk': `$${TOKEN_VARIABLE}` },
    allowedEnvVars: [TOKEN_VARIABLE],
  });
  const office: Record<string, unknown[]> = {
    PermissionRequest: [{ hooks: [hook('desk/permission', PERMISSION_TIMEOUT_S)] }],
    Stop: [{ hooks: [hook('desk/hook', LIVENESS_TIMEOUT_S)] }],
    SubagentStop: [{ hooks: [hook('desk/hook', LIVENESS_TIMEOUT_S)] }],
  };
  const hooks: Record<string, unknown[]> = { ...(carry ? structuredClone(carry.hooks) : {}) };
  for (const [event, groups] of Object.entries(office)) hooks[event] = [...(hooks[event] ?? []), ...groups];
  const permissions: Record<string, unknown> = {
    allow: [...plan.allow],
    ask: dedupe([...plan.ask, ...(carry?.ask ?? [])]),
    deny: dedupe([...plan.deny, ...(carry?.deny ?? [])]),
  };
  if (carry && carry.additionalDirectories.length > 0) permissions.additionalDirectories = structuredClone(carry.additionalDirectories);
  if (carry?.disableBypassPermissionsMode !== undefined) permissions.disableBypassPermissionsMode = structuredClone(carry.disableBypassPermissionsMode);
  const settings: Record<string, unknown> = { ...(carry ? structuredClone(carry.extra) : {}), hooks, permissions };
  // A person on "the user's own default model" keeps it: a lean desk doesn't read the user's settings for it.
  if (carry?.model && !plan.model) settings.model = carry.model;
  // A lean desk leaves the user's memory out; the folder walk would bring it back for a project under their home folder.
  if (carry && carry.excludeMemory.length > 0) settings.claudeMdExcludes = [...carry.excludeMemory];
  return settings;
}

const dedupe = (rules: readonly unknown[]): unknown[] => {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const key = JSON.stringify(r);
    return !seen.has(key) && seen.add(key);
  });
};

/**
 * What Claude Code's own argument parser says, as the very first thing on standard error, when it doesn't take one of the
 * three flags a lean desk adds ("error: unknown option '--tools'"). Anything else on standard error, or anywhere but its
 * start, is not this.
 */
const FLAGS_REJECTED = /^error: (?:unknown option|option) '--(?:setting-sources|strict-mcp-config|tools)\b[^']*'/;

/** The tools a lean desk is given: its built-ins, the Skill tool when assigned, and ToolSearch when it has servers of its own. */
export function leanTools(loads: ResolvedLoads): string[] {
  return [...loads.tools, ...(loads.skills ? ['Skill'] : []), ...(loads.mcp.length > 0 ? ['ToolSearch'] : [])];
}

/** The flags that take no value, so what follows one is a flag, not its value. */
const SWITCHES: ReadonlySet<string> = new Set(['--verbose', '--strict-mcp-config']);

/** The command line after the executable. Every value is the switchboard's own or checked before it gets here. */
export function deskArgs(plan: HarnessPlan, files: { settings: string; mcp: string }, o: { lean?: boolean } = {}): string[] {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  args.push(plan.resume ? '--resume' : '--session-id', plan.sessionId);
  if (plan.model) args.push('--model', plan.model);
  // Always named: left to Claude Code a desk reads the user's own `effortLevel` (their interactive setting, xhigh on one
  // machine), and a desk's thinking is what the company sets. DEFAULT_EFFORT is what 0.1.0's desks ran at in the benchmark.
  args.push('--effort', plan.effort ?? DEFAULT_EFFORT);
  // Snapshot off from the first launch, so a changed place in the org reaches the person when the desk reopens.
  args.push('--permission-mode', 'acceptEdits', '--system-prompt-snapshot', 'off');
  if (plan.systemPrompt) args.push('--append-system-prompt', plan.systemPrompt);
  if (plan.agent) args.push('--agent', plan.agent);
  args.push('--settings', files.settings, '--mcp-config', files.mcp);
  // Lean: only the project's and local settings (the user's own deny rules and hooks come along in --settings), only the
  // servers in --mcp-config, only the named tools. --tools without --strict-mcp-config would load every MCP tool upfront.
  if (plan.loads && o.lean !== false) args.push('--setting-sources', 'project,local', '--strict-mcp-config', '--tools', leanTools(plan.loads).join(','));
  for (let i = 1; i < args.length; i++) {
    const flag = args[i - 1] ?? '';
    if (flag.startsWith('--') && !SWITCHES.has(flag) && (args[i] ?? '').startsWith('-')) {
      throw new HarnessError(`The desk's ${flag} value starts with "-", so Claude Code would read it as a flag.`);
    }
  }
  return args;
}

/**
 * The variables the office points at the desk's own scratch folder: Node, Python, PowerShell and Git Bash's $TMPDIR
 * read one of them. Not TMP: Git Bash's /tmp mount reads it, and all of a user's Git Bash processes share one mount
 * table, so a desk setting TMP could move /tmp for the user's other shells. TMP stays the machine's, so the desk's
 * /tmp is the ordinary temporary folder, which the approvals policy treats as outside the project.
 */
const DESK_TEMP_VARIABLES = ['TEMP', 'TMPDIR'];

/**
 * A desk's environment: deskEnv's (the host session's wiring gone, prompt caching on), session events, the token, and
 * the desk's own scratch folder as TEMP and TMPDIR, so scratch files land where the desk may work freely.
 */
export function deskEnvironment(base: NodeJS.ProcessEnv, token: string, scratch: string | null = null, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env = deskEnv(base, platform);
  const ours = new Set([TOKEN_VARIABLE, ...(scratch === null ? [] : DESK_TEMP_VARIABLES)]);
  for (const key of Object.keys(env)) {
    if (ours.has(platform === 'win32' ? key.toUpperCase() : key)) delete env[key];
  }
  env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';
  env[TOKEN_VARIABLE] = token;
  if (scratch !== null) for (const name of DESK_TEMP_VARIABLES) env[name] = scratch;
  return env;
}

/** `path` under the hub's origin, whether or not the origin ends with a slash. */
function hubPath(hubUrl: string, path: string): string {
  return `${hubUrl.replace(/\/+$/, '')}/${path}`;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false; // unreadable counts as missing: Claude Code couldn't start there either
  }
}

export interface ClaudeCodeOptions {
  /** The environment the desks start from; process.env when not given. findClaude searches it. */
  env?: NodeJS.ProcessEnv;
  /** Claude Code's executable (a path, as WORKLINGS_CLAUDE takes it) or a finished lookup; found the usual way otherwise. */
  claude?: string | ClaudeLookup;
  /** Where each desk's temporary folder is made; the system's temporary folder when not given. */
  scratch?: string;
}

/** A desk's temporary folder, under the scratch base. */
const DESK_FOLDER_PREFIX = 'worklings-desk-';
/** Names the process that made a desk folder, so a later run can tell a leaked folder from a live desk's. */
const OWNER_FILE = 'owner.pid';
/** A desk folder is swept only once it is this old, so one another process is still setting up is left alone. */
const SWEEP_MIN_AGE_MS = 5 * 60_000;
/** The scratch bases already swept this process, so the sweep runs once each, at the first desk that uses them. */
const sweptBases = new Set<string>();

/** Whether the process that made a desk folder is still running (this process counts; a permission error means it is). */
function ownerAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function ownerPid(folder: string): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(join(folder, OWNER_FILE), 'utf8')).trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null; // no owner file (an older desk, or one mid-creation): the age check decides
  }
}

/**
 * Removes desk folders in `base` whose owning process is gone: other hubs run beside this one (the user's own, the
 * e2e hubs, reviewers'), so a folder is swept only when its owner pid is not running and it is older than a few
 * minutes, never a live desk's. Off the event loop, never rejects; gives back the folders it removed, for the tests.
 */
export async function sweepLeakedDesks(
  base: string,
  o: { alive?: (pid: number) => boolean; now?: number; minAgeMs?: number } = {},
): Promise<string[]> {
  const alive = o.alive ?? ownerAlive;
  const now = o.now ?? Date.now();
  const minAgeMs = o.minAgeMs ?? SWEEP_MIN_AGE_MS;
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return []; // the base isn't there yet, or can't be read
  }
  const removed: string[] = [];
  await Promise.all(
    names.map(async (name) => {
      if (!name.startsWith(DESK_FOLDER_PREFIX)) return;
      const folder = join(base, name);
      try {
        const info = await stat(folder);
        if (!info.isDirectory() || now - info.mtimeMs < minAgeMs) return;
        const pid = await ownerPid(folder);
        if (pid !== null && alive(pid)) return;
        await rm(folder, REMOVE);
        removed.push(folder);
      } catch {
        // Gone already, or held open by something: leave it for the next sweep.
      }
    }),
  );
  return removed;
}

/**
 * Makes a desk's temporary folder. With a stable name it is the same folder every time the person's desk opens, so the
 * scratch path in their prompt doesn't change and a resumed session keeps its prompt cache. A folder that is there
 * already is taken over only when the process that made it is gone; otherwise (another hub on this machine runs the same
 * company, a leftover that can't be told from a live desk's yet) the desk gets a random folder of its own, as before.
 */
function makeDeskFolder(base: string, stable: string | undefined): string {
  if (stable !== undefined && stable !== '') {
    const folder = join(base, DESK_FOLDER_PREFIX + createHash('sha256').update(stable).digest('hex').slice(0, 16));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        mkdirSync(folder, { mode: 0o700 });
        return folder;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !leftOver(folder)) break;
        rmSync(folder, REMOVE);
      }
    }
  }
  return mkdtempSync(join(base, DESK_FOLDER_PREFIX));
}

/** Whether a desk folder is a leftover of a desk that is gone: its owner isn't running, and it isn't mid-creation. */
function leftOver(folder: string): boolean {
  try {
    const info = statSync(folder);
    if (!info.isDirectory()) return false;
    let pid = Number.NaN;
    try {
      pid = Number.parseInt(readFileSync(join(folder, OWNER_FILE), 'utf8').trim(), 10);
    } catch {
      // No owner file: made by an older version, or still being set up. Its age decides.
    }
    if (Number.isInteger(pid) && pid > 0) return !ownerAlive(pid);
    return Date.now() - info.mtimeMs >= SWEEP_MIN_AGE_MS;
  } catch {
    return false;
  }
}

/** Claude Code, the one harness so far. */
export function claudeCode(o: ClaudeCodeOptions = {}): Harness {
  const base = o.env ?? process.env;
  const scratch = o.scratch ?? tmpdir();
  // One harness per switchboard: its persons' recorded processes are keyed by this and their name.
  const harnessId = randomUUID();
  const ownerOf = (person: string) => `${harnessId}/${person}`;
  // Claude Code on this machine didn't take the lean desk's flags: every desk from then on starts the old way.
  let leanRefused = false;
  /** What the stakeholder has been told, so a sentence is said once per company (one harness serves one switchboard). */
  const toldStakeholder = new Set<string>();
  /** Writes a sentence to the log and hands it to the stakeholder through the handlers, once each. */
  const tell = (on: HarnessHandlers, sentence: string): void => {
    noteOnce(sentence);
    if (toldStakeholder.has(sentence)) return;
    toldStakeholder.add(sentence);
    try {
      on.notice?.(sentence);
    } catch {
      // A notice that can not be shown never stops a desk.
    }
  };
  const lookup = (): ClaudeLookup => {
    if (typeof o.claude === 'object') return o.claude;
    return findClaude(typeof o.claude === 'string' ? { ...base, WORKLINGS_CLAUDE: o.claude } : base);
  };
  return {
    name: 'Claude Code',
    start(plan, on) {
      const claude = lookup();
      if (!claude.found) throw new HarnessError(claude.reason);
      if (!isFolder(plan.cwd)) throw new HarnessError(`Claude Code can't start in ${plan.cwd}: the folder doesn't exist.`);
      // Once per process per base: clear away folders left by hubs that have since gone.
      if (!sweptBases.has(scratch)) {
        sweptBases.add(scratch);
        void sweepLeakedDesks(scratch);
      }
      const folder = makeDeskFolder(scratch, plan.stable);
      try {
        writeFileSync(join(folder, OWNER_FILE), String(process.pid), { mode: 0o600 });
        // The desk's own scratch folder sits beside its settings, never around them: the settings stay unwritable.
        const tmp = join(folder, 'scratch');
        mkdirSync(tmp);
        const token = plan.issueToken(tmp);
        const files = { settings: join(folder, 'settings.json'), mcp: join(folder, 'mcp.json') };
        if (plan.plain) {
          writeFileSync(files.settings, `${JSON.stringify(plainDeskSettings(officeHooks(plan.hubUrl)), null, 2)}\n`, { mode: 0o600 });
          const args = plainDeskArgs({ sessionId: plan.sessionId, resume: plan.resume, launch: plan.plain, settingsFile: files.settings });
          const child = startDesk(claude, args, plan.cwd, deskEnvironment(base, token, null));
          return attach(child, plan, folder, on, child.pid === undefined ? null : watchDesk(ownerOf(plan.person), child.pid, tmp), null);
        }
        // A lean desk reads no user settings, so what protects the user in them goes into its own file (see deskSettings).
        // When any of it can't be carried in full the desk starts the standard way instead, where Claude Code reads the
        // user's own settings itself, and the stakeholder is told why.
        const carry = plan.loads && !leanRefused ? readCarry(base) : null;
        for (const note of carry?.notes ?? []) noteOnce(note);
        if (carry && !carry.complete) tell(on, `Desks start with your whole Claude Code setup instead of the lean one, because ${carry.problem ?? 'your settings could not be carried over in full'}. They are heavier, and nothing you set up is left out.`);
        const lean = plan.loads && !leanRefused && carry?.complete === true ? plan.loads : null;
        const assigned = lean && lean.mcp.length > 0 ? serverConfigs(lean.mcp, base) : { servers: {}, missing: [] as string[] };
        for (const name of assigned.missing) noteOnce(`${plan.person}'s desk was assigned the MCP server ${JSON.stringify(name.slice(0, 60))}, which isn't installed any more: it starts without it.`);
        writeFileSync(files.settings, `${JSON.stringify(deskSettings(plan, lean ? carry : null), null, 2)}\n`, { mode: 0o600 });
        writeFileSync(files.mcp, `${JSON.stringify(deskMcpConfig(plan, assigned.servers), null, 2)}\n`, { mode: 0o600 });
        // The person is told where its scratch folder is, as the computer names it (see SCRATCH_PATH_MARK).
        const prompt = plan.systemPrompt.split(SCRATCH_PATH_MARK).join(tmp);
        const env = deskEnvironment(base, token, tmp);
        // Belt and braces: --strict-mcp-config already leaves the account's own connectors out.
        if (lean) env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
        const child = startDesk(claude, deskArgs({ ...plan, systemPrompt: prompt }, files, { lean: lean !== null }), plan.cwd, env);
        const guard: LeanGuard | null = lean
          ? { allowed: [`mcp__${ORG_SERVER}__`, ...Object.keys(assigned.servers).map(toolPrefixOf)], servers: new Set([ORG_SERVER, ...Object.keys(assigned.servers)]), say: (sentence) => tell(on, sentence), refused: () => (leanRefused = true) }
          : null;
        return attach(child, plan, folder, on, child.pid === undefined ? null : watchDesk(ownerOf(plan.person), child.pid, tmp), guard);
      } catch (error) {
        removeFolder(folder);
        if (error instanceof ClaudeError) throw new HarnessError(error.message);
        throw error;
      }
    },
    async reap(person) {
      try {
        await reap(ownerOf(person));
      } catch (error) {
        process.stderr.write(`worklings: couldn't stop what ${person}'s desk started: ${error instanceof Error ? error.message : String(error)}
`);
      }
    },
  };
}

/** Sentences already written to the log: a note about the user's setup is told once per process, not once per desk. */
const told = new Set<string>();
function noteOnce(note: string): void {
  if (told.has(note)) return;
  told.add(note);
  process.stderr.write(`worklings: ${note}\n`);
}

/** For tests: forget what was already told, so the next note is written again. */
export function forgetNotes(): void {
  told.clear();
}

/** What a lean desk is checked against once it says what it loaded. */
interface LeanGuard {
  /** The tool-name prefixes of the MCP servers it was given: the org tools' and its assigned ones. */
  allowed: readonly string[];
  /** Their names as Claude Code lists them in init: "org" and the assigned servers'. */
  servers: ReadonlySet<string>;
  /** A sentence for the stakeholder, said once. */
  say(sentence: string): void;
  /** Claude Code didn't take the lean flags: the harness starts later desks the old way. */
  refused(): void;
}

const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;
const removeFailed = (folder: string, error: unknown) =>
  process.stderr.write(`worklings: couldn't remove a desk's temporary folder ${folder}: ${error instanceof Error ? error.message : String(error)}\n`);

/** Removes the folder of a desk that never started, which holds only its two files and an empty scratch folder. */
function removeFolder(folder: string): void {
  try {
    rmSync(folder, REMOVE);
  } catch (error) {
    removeFailed(folder, error);
  }
}

/** Removes the folder of a desk that ran, off the event loop: its scratch folder may hold a lot by now. Never rejects. */
async function removeRanFolder(folder: string): Promise<void> {
  try {
    await rm(folder, REMOVE);
  } catch (error) {
    removeFailed(folder, error);
  }
}

function attach(child: ChildProcessWithoutNullStreams, plan: HarnessPlan, folder: string, on: HarnessHandlers, family: Family | null, guard: LeanGuard | null = null): HarnessProcess {
  const lines = new LineSplitter();
  let stderr = '';
  let writable = true;
  let finished = false;
  let spawnError: string | null = null;
  let exit: { code: number | null; signal: string | null } | null = null;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let sawInit = false;
  /** The first words Claude Code wrote on standard error, which stay when the tail moves on. */
  let stderrHead = '';
  /** Set when the desk loaded MCP tools it wasn't given: it is stopped and nothing more it says is passed on. */
  let refused: string | null = null;

  const event = (e: DeskEvent) => {
    if (refused !== null) return;
    if (e.kind === 'init') {
      sawInit = true;
      // Its MCP configuration held secrets; it has been read, so it goes now rather than when the desk does.
      void rm(join(folder, 'mcp.json'), { force: true }).catch(() => undefined);
      if (guard) {
        const names = [...new Set([...(e.tools ?? []).filter((t) => t.startsWith('mcp__') && !guard.allowed.some((prefix) => t.startsWith(prefix))).map((t) => /^mcp__(.+?)__/.exec(t)?.[1] ?? t), ...e.mcpServers.map((m) => m.name).filter((n) => !guard.servers.has(n))])];
        if (names.length > 0) {
          // The 215k pitfall: MCP tools of the user's that nobody assigned. The desk is refused, not run.
          refused = `${plan.person}'s desk came up with MCP tools nobody assigned (${names.slice(0, 5).join(', ')}), which would load them into every request, so it was stopped. This Claude Code may not honour --strict-mcp-config: update it, then try again.`;
          spawnError = refused;
          void killDesk(child);
          return;
        }
        if (e.tools === null) guard.say("This Claude Code doesn't list a desk's tools when it starts, so the office can't check that a desk loaded only what it was given.");
      }
    }
    try {
      on.event(e);
    } catch (error) {
      // A fault in the switchboard must not stop it reading the desk.
      process.stderr.write(`worklings: a desk event for ${plan.person} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    if (family) endWatch(family);
    clearTimeout(grace);
    writable = false;
    const rest = lines.end();
    if (rest !== null) event(parseLine(rest));
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
    if (guard && !sawInit && spawnError === null && exit?.code === 1 && FLAGS_REJECTED.test(stderrHead)) {
      // This Claude Code doesn't have the lean flags. Said once; the person's desk reopens the old way (the switchboard's
      // one automatic retry), and so does every desk after it.
      guard.refused();
      guard.say("This Claude Code didn't take the flags that make a desk lean, so desks start with your whole Claude Code setup from now on (heavier, and nothing you set up is left out).");
      spawnError = "This version of Claude Code didn't take the lean desk flags, so desks now start with its standard loading (heavier: it loads your whole Claude Code setup).";
    }
    const gone: HarnessExit = { code: exit?.code ?? null, signal: exit?.signal ?? null, stderr, error: spawnError };
    // The exit is told once the folder has gone, so whoever waits for it finds nothing of the desk left.
    void removeRanFolder(folder).then(() => {
      try {
        on.exit(gone);
      } catch (error) {
        process.stderr.write(`worklings: a desk exit for ${plan.person} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      }
    });
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of lines.push(chunk)) event(parseLine(line));
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderrHead.length < 400) stderrHead = (stderrHead + chunk).slice(0, 400);
    stderr = (stderr + chunk).slice(-STDERR_KEEP);
  });
  // Writing to a desk that has just gone fails with EPIPE; the exit says what happened.
  child.stdin.on('error', () => {
    writable = false;
  });
  child.on('error', (error) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    spawnError = code === 'ENOENT' ? "Couldn't find Claude Code to start it. Install it, or set WORKLINGS_CLAUDE to its full path." : `Claude Code couldn't start${code ? ` (${code})` : ''}.`;
    // A start that failed has no process to wait for.
    if (child.pid === undefined) finish();
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
    writable = false;
    // Something the desk started may still hold its pipes; its own lines are in by now or soon.
    grace = setTimeout(finish, PIPE_GRACE_MS);
  });
  child.on('close', (code, signal) => {
    exit ??= { code, signal };
    finish();
  });

  const write = (line: string): boolean => {
    if (!writable || child.stdin.destroyed || !child.stdin.writable) return false;
    child.stdin.write(line);
    return true;
  };

  return {
    pid: child.pid ?? null,
    send: (text, uuid) => write(userLine(text, plan.sessionId, uuid)),
    interrupt: (requestId) => write(interruptLine(requestId)),
    answer: (requestId, response, error) => write(error !== undefined || response === null ? controlRefusal(requestId, error ?? 'Not served by the office.') : controlAnswer(requestId, response)),
    close: () => {
      if (!writable) return;
      writable = false;
      child.stdin.end();
    },
    kill: async () => {
      // Written down first: once the desk is gone, what its shells started can no longer be traced back to it.
      if (family) await recordNow(family).catch(() => undefined);
      await killDesk(child);
    },
  };
}
