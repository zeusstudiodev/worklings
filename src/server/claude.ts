// Runs Claude Code headless (`claude -p`) for the office's own questions: Ask aside and Catch me up. The person's own
// Claude Code answers (Worklings holds no API key), read-only and in one turn: no tools, no MCP servers, no hooks and
// no transcript left behind. The prompt goes in on stdin, never on the command line, nothing runs through a shell, and
// nothing here logs the prompt, the answer or the environment.
import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { CALL_TIMEOUT_MS } from '../core/aside.ts';
import { oneLine, safeId } from '../core/events.ts';
import { knownModel } from '../core/pricing.ts';
import { type TokenUsage, usageFromApi } from '../core/usage.ts';

export const DEFAULT_MODEL = 'haiku';
/** The office's copy says this figure too ("It stops at 60s"), so it lives in core. */
export const DEFAULT_TIMEOUT_MS = CALL_TIMEOUT_MS;
/** The variable that names the Claude Code to run, ahead of the PATH. */
const CLAUDE_VARIABLE = 'WORKLINGS_CLAUDE';
/** Its name before the rename to Worklings: read when CLAUDE_VARIABLE is unset or empty, so older setups keep working. */
const LEGACY_CLAUDE_VARIABLE = 'HEADCOUNT_CLAUDE';
const STDOUT_LIMIT = 4 * 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;
/** How long a killed run may take to go before the caller gets its answer anyway. */
const KILL_WAIT_MS = 5_000;
/**
 * How long taskkill itself may take. On a loaded machine it can need more than KILL_WAIT_MS, and giving up early kills
 * only Claude Code and leaves what it started running, so the kill goes on after the caller has its answer.
 */
const TREE_KILL_MS = 30_000;

/**
 * Added before the caller's arguments on every run, followed by `--model <model>`: print mode with one JSON result, one
 * turn, no built-in tools, no MCP tools or servers, no session saved to disk and no user or project hooks. `--tools` and
 * `--disallowedTools` take lists, so another flag must follow each of their values.
 */
export const READ_ONLY_FLAGS: readonly string[] = Object.freeze([
  '-p',
  '--output-format', 'json',
  '--max-turns', '1',
  '--tools', '',
  '--disallowedTools', 'mcp__*',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--settings', '{"disableAllHooks":true}',
]);

/** Flags a caller can't pass: the runner sets them, or they would give the run tools or permissions. */
const RESERVED_FLAGS: ReadonlySet<string> = new Set([
  ...READ_ONLY_FLAGS.filter((arg) => arg.startsWith('-')),
  '--print', '--model', '--allowedTools', '--allowed-tools', '--disallowed-tools', '--permission-mode', '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions', '--mcp-config',
]);

/**
 * Caller flags that take a value. A value that starts with "-" would reach Claude Code as a flag of its own
 * (`--resume --debug`), so the runner refuses it.
 */
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--resume', '-r', '--session-id', '--system-prompt', '--append-system-prompt', '--fallback-model']);

export type ClaudeErrorCode = 'not-installed' | 'not-signed-in' | 'timed-out' | 'cancelled' | 'limit' | 'too-long' | 'bad-output' | 'failed';

/** A run that gave no answer. The message is a sentence for the person, with at most one line of Claude Code's text. */
export class ClaudeError extends Error {
  readonly code: ClaudeErrorCode;
  /** For `limit`, when it resets ("3pm"); for `failed`, Claude Code's own first line; null otherwise or when unknown. */
  readonly detail: string | null;

  constructor(code: ClaudeErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = 'ClaudeError';
    this.code = code;
    this.detail = detail;
  }
}

const NOT_SIGNED_IN = "Claude Code isn't signed in. Run claude in a terminal, sign in, then ask again.";
const TOO_LONG = 'The prompt is too long for the model. Try a model with a larger context window.';
const BAD_OUTPUT =
  `Claude Code answered in a form the office doesn't understand. Update Claude Code, and check that ${CLAUDE_VARIABLE} or the PATH leads to it.`;
const shellOnly = (name: string) =>
  `Found ${name}, which can only run through a shell; set ${CLAUDE_VARIABLE} to claude.exe or to Claude Code's cli.js.`;

// ---------------------------------------------------------------------------------------------------------------------
// Finding the executable

export interface FoundClaude {
  found: true;
  /** What to spawn: Claude Code itself, or this Node for a JavaScript entry point. */
  command: string;
  /** Arguments before Claude Code's own: the entry point when `command` is Node. */
  prefixArgs: string[];
  /** The file that runs, for messages. */
  path: string;
}

export interface MissingClaude {
  found: false;
  /** Why, as a sentence the person can act on. */
  reason: string;
}

export type ClaudeLookup = FoundClaude | MissingClaude;

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
/** The PATHEXT kinds worth looking for: what Node can start, and npm's .cmd shim. .vbs, .js, .wsf and the rest need a shell. */
const USABLE_EXTENSIONS = new Set(['.com', '.exe', '.bat', '.cmd']);
/** Where npm puts Claude Code next to its claude.cmd shim. */
const NPM_ENTRY = ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'];

function isFile(file: string): boolean {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    // A PATH entry that is a file, or a folder this user may not read: nothing to run there.
    return false;
  }
}

/** Windows variable names ignore case, and a copied environment keeps whatever case it had ("Path"). */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32' || Object.hasOwn(env, name)) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, '$1');

/** PATHEXT's usable extensions, in its order. Each one costs a file check in every PATH folder (about 0.1 ms on Windows). */
function pathExtensions(value: string | undefined): string[] {
  const read = (list: string) => [...new Set(list.split(';').map((ext) => ext.trim().toLowerCase()))].filter((ext) => USABLE_EXTENSIONS.has(ext));
  const exts = read(value ?? '');
  return exts.length > 0 ? exts : read(DEFAULT_PATHEXT);
}

/** How to run `file` without a shell, or null when only a shell could. JavaScript runs with this Node when configured. */
function launch(file: string, platform: NodeJS.Platform, exists: (file: string) => boolean, configured: boolean): FoundClaude | null {
  const p = platform === 'win32' ? win32 : posix;
  const ext = p.extname(file).toLowerCase();
  const withNode = (entry: string): FoundClaude => ({ found: true, command: process.execPath, prefixArgs: [entry], path: entry });
  if (configured && (ext === '.js' || ext === '.mjs' || ext === '.cjs')) return withNode(file);
  if (platform !== 'win32' || ext === '.exe' || ext === '.com') return { found: true, command: file, prefixArgs: [], path: file };
  // Node refuses to spawn .cmd and .bat files without a shell; npm's claude.cmd only starts the cli.js beside it.
  if (ext === '.cmd' || ext === '.bat') {
    const entry = p.join(p.dirname(file), ...NPM_ENTRY);
    if (exists(entry)) return withNode(entry);
  }
  return null;
}

/**
 * Finds Claude Code: WORKLINGS_CLAUDE first (the full path to the executable, or to a .js, .mjs or .cjs entry point
 * that runs with this Node), or LEGACY_CLAUDE_VARIABLE, its old name, when WORKLINGS_CLAUDE is unset or empty; then
 * the PATH. On Windows it tries PATHEXT's .com, .exe, .bat and .cmd in its order, as the shell does, but starts only
 * .exe and .com files directly: an npm claude.cmd runs through the cli.js beside it, and a .cmd or .bat without one is
 * skipped, with the reason kept for the message. Empty and relative PATH entries are skipped, so a project folder can't
 * supply a claude of its own. `exists` says whether a file is there (a folder doesn't count).
 */
export function findClaude(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = isFile,
): ClaudeLookup {
  const p = platform === 'win32' ? win32 : posix;
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';

  const valueOf = (name: string) => unquote(envValue(env, name, platform) ?? '');
  // The new name wins even when it leads nowhere: falling back past it would hide the mistake.
  const variable = [CLAUDE_VARIABLE, LEGACY_CLAUDE_VARIABLE].find((name) => valueOf(name) !== '');
  if (variable) {
    const configured = valueOf(variable);
    // Messages name the variable that holds the path, and the new name when that is the old one.
    const named = variable === CLAUDE_VARIABLE ? variable : `${variable} (renamed ${CLAUDE_VARIABLE})`;
    if (!p.isAbsolute(configured)) {
      return { found: false, reason: `${named} must be the full path to ${exe} or to Claude Code's cli.js, but it is ${configured}.` };
    }
    if (!exists(configured)) {
      return { found: false, reason: `${named} is set to ${configured}, but there is no file there. Set it to the full path of ${exe} or of Claude Code's cli.js.` };
    }
    return (
      launch(configured, platform, exists, true) ?? {
        found: false,
        reason: `${named} points to ${p.basename(configured)}, which can only run through a shell; set it to claude.exe or to Claude Code's cli.js.`,
      }
    );
  }

  const dirs = (envValue(env, 'PATH', platform) ?? '').split(p.delimiter).map(unquote).filter((dir) => dir !== '' && p.isAbsolute(dir));
  const names = platform === 'win32' ? pathExtensions(envValue(env, 'PATHEXT', platform)).map((ext) => `claude${ext}`) : ['claude'];
  let skipped: string | undefined;
  for (const dir of dirs) {
    for (const name of names) {
      const file = p.join(dir, name);
      if (!exists(file)) continue;
      const found = launch(file, platform, exists, false);
      if (found) return found;
      skipped ??= name;
    }
  }
  if (skipped) return { found: false, reason: shellOnly(skipped) };
  return { found: false, reason: `Claude Code isn't installed, or it isn't on the PATH the office sees. Install it, or set ${CLAUDE_VARIABLE} to the full path of ${exe}.` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Running it

/**
 * What a Claude Code session sets for the processes it starts. The office may run inside one (the plugin's
 * /worklings:office, or an office started from a session), and its own calls must not think they run in it: besides
 * these, every CLAUDE_CODE_* and CLAUDE_AGENT_SDK_* variable (entry point, session ids, messaging sockets and tokens,
 * desktop wiring) goes, except the person's own configuration below.
 */
const HOST_VARIABLES: ReadonlySet<string> = new Set(['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'ENABLE_IDE_INTEGRATION']);

/**
 * CLAUDE_CODE_* variables that are the person's own configuration, kept: sign-in, provider, network, telemetry and
 * privacy settings, and where Git Bash lives (Claude Code on Windows needs it). ANTHROPIC_*, CLAUDE_CONFIG_DIR, proxies
 * and everything else pass through as they are.
 */
const OWN_CONFIGURATION: ReadonlySet<string> = new Set([
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS', 'CLAUDE_CODE_ENABLE_TELEMETRY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_GIT_BASH_PATH',
]);

/**
 * The environment Claude Code runs with: the office's, without the wiring of a Claude Code session the office may run
 * in (see HOST_VARIABLES; with CLAUDECODE set, Claude Code even refuses to start), and with prompt caching off (each
 * prompt is sent once, so a cache write would cost extra and never be read). Names match without case on Windows.
 */
export function claudeEnv(base: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    const name = platform === 'win32' ? key.toUpperCase() : key;
    if (HOST_VARIABLES.has(name) || name === 'DISABLE_PROMPT_CACHING') continue;
    if ((name.startsWith('CLAUDE_CODE_') || name.startsWith('CLAUDE_AGENT_SDK_')) && !OWN_CONFIGURATION.has(name)) continue;
    env[key] = value;
  }
  env.DISABLE_PROMPT_CACHING = '1';
  return env;
}

export interface RunClaudeOptions {
  /** Arguments after the read-only flags, such as ['--resume', id, '--fork-session'] or ['--system-prompt', text]. */
  args: string[];
  /** The prompt. It goes to stdin, never on the command line. */
  input: string;
  /** The folder Claude Code runs in. */
  cwd: string;
  /** Model alias or id; DEFAULT_MODEL (haiku) when not given. */
  model?: string;
  /** How long to wait before stopping the run; DEFAULT_TIMEOUT_MS (60 s) when not given. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** The environment to start from (process.env when not given); claudeEnv adjusts it, and findClaude searches it. */
  env?: NodeJS.ProcessEnv;
  /** The executable when already looked up; findClaude(env) otherwise. */
  claude?: ClaudeLookup;
}

export interface ClaudeResult {
  /** Claude Code's answer. */
  text: string;
  /**
   * total_cost_usd exactly as Claude Code reported it, or null when it didn't. It is not always this run's cost: with
   * --resume <id> --fork-session it also counts what the original session had cost before, restored from its
   * transcript. Price a run from `usage` and `model` with costOf in src/core/pricing.ts.
   */
  reportedCostUsd: number | null;
  /** Tokens this run's own request used. */
  usage: TokenUsage;
  /** The model that answered: the first modelUsage key, or that entry's canonicalModel when the price table doesn't know the key. */
  model: string | null;
  sessionId: string | null;
  /** Claude Code's duration_ms, or the measured wall time when it doesn't report one. */
  durationMs: number;
}

/**
 * Runs Claude Code once with the read-only flags plus `args`, `input` on stdin, and returns its answer. Rejects with a
 * ClaudeError when there is no answer (not installed, not signed in, timed out, cancelled, limit reached, too long,
 * output it can't read, any other failure), killing the whole process tree on timeout and cancel. Rejects with a plain
 * Error when the call itself is wrong (a reserved flag in `args`, a model name that isn't one).
 */
export async function runClaude(o: RunClaudeOptions): Promise<ClaudeResult> {
  const model = o.model ?? DEFAULT_MODEL;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  checkCall(model, o.args, timeoutMs);
  if (o.signal?.aborted) throw cancelled();
  const env = o.env ?? process.env;
  const claude = o.claude ?? findClaude(env);
  if (!claude.found) throw new ClaudeError('not-installed', claude.reason);
  const started = Date.now();
  const child = startClaude(claude, [...READ_ONLY_FLAGS, '--model', model, ...o.args], o.cwd, claudeEnv(env));
  const output = await collect(child, { input: o.input, timeoutMs, signal: o.signal, path: claude.path, cwd: o.cwd });
  return parseClaudeOutput({ ...output, elapsedMs: Date.now() - started });
}

function checkCall(model: string, args: readonly string[], timeoutMs: number): void {
  if (!/^\w[\w.:@[\]/-]{0,127}$/.test(model)) throw new Error(`runClaude: ${JSON.stringify(model)} is not a model name.`);
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new Error('runClaude: timeoutMs must be a positive number of milliseconds.');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const equals = arg.startsWith('-') ? arg.indexOf('=') : -1;
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (RESERVED_FLAGS.has(flag)) throw new Error(`runClaude: the runner sets ${flag} to keep Claude Code read-only, so callers can't pass it.`);
    if (!VALUE_FLAGS.has(flag)) continue;
    const value = equals === -1 ? args[i + 1] : arg.slice(equals + 1);
    if (value === undefined || value === '' || value.startsWith('-')) throw new Error(`runClaude: ${flag} needs a value that doesn't start with "-".`);
    // The value is text, not a flag: it isn't checked as one.
    if (equals === -1) i += 1;
  }
}

const cancelled = () => new ClaudeError('cancelled', 'Cancelled before Claude Code answered.');

/** "Claude Code didn't answer within 60 seconds, so the office stopped it." */
export function timedOut(ms: number): ClaudeError {
  const seconds = Math.round(ms / 100) / 10;
  return new ClaudeError('timed-out', `Claude Code didn't answer within ${seconds} second${seconds === 1 ? '' : 's'}, so the office stopped it.`);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    // Unreadable counts as missing: Claude Code couldn't start there either.
    return false;
  }
}

function startFailure(error: unknown, file: string, cwd: string): ClaudeError {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    // Spawn says ENOENT for a missing working folder too.
    if (!isFolder(cwd)) return new ClaudeError('failed', `Claude Code can't start in ${cwd}: the folder doesn't exist.`);
    return new ClaudeError('not-installed', `Couldn't find Claude Code at ${file}. Install it, or set ${CLAUDE_VARIABLE} to its full path.`);
  }
  if (code === 'EACCES' || code === 'EPERM') return new ClaudeError('failed', `The office isn't allowed to run ${file}. Check that it is an executable you can run.`);
  return new ClaudeError('failed', `The office couldn't start Claude Code at ${file}${code ? ` (${code})` : ''}.`);
}

function startClaude(claude: FoundClaude, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  try {
    return spawn(claude.command, [...claude.prefixArgs, ...args], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      // Its own process group off Windows, so a timeout can kill everything it started; Windows uses taskkill /T.
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    // Spawn throws, rather than emitting 'error', for arguments it rejects outright.
    throw startFailure(error, claude.path, cwd);
  }
}

/** Kills the process and everything it started: taskkill /T on Windows, the process group elsewhere. Never rejects. */
function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL'); // the group is already gone: make sure of the process itself
    }
    return Promise.resolve();
  }
  // The full path, so a taskkill.exe in the project folder can't stand in for it.
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  return new Promise((done) => {
    execFile(taskkill, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: TREE_KILL_MS }, (error) => {
      // taskkill fails when the process ended a moment ago, or when it couldn't run: then stop the process itself.
      if (error) child.kill();
      done();
    });
  });
}

/** Resolves when the process has exited, or after `ms` when it hasn't. */
function exited(child: ChildProcessWithoutNullStreams, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
}

interface Collected {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

function collect(
  child: ChildProcessWithoutNullStreams,
  o: { input: string; timeoutMs: number; signal: AbortSignal | undefined; path: string; cwd: string },
): Promise<Collected> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stopping = false;
    let settled = false;
    const onAbort = () => stop(cancelled());
    const timer = setTimeout(() => stop(timedOut(o.timeoutMs)), o.timeoutMs);
    o.signal?.addEventListener('abort', onAbort, { once: true });

    function settle(finish: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      finish();
    }

    // Timed out, cancelled or flooding: kill the whole tree, and answer only once it is gone (or after KILL_WAIT_MS),
    // so a caller that allows one run at a time never has two.
    function stop(error: ClaudeError) {
      if (stopping || settled) return;
      stopping = true;
      clearTimeout(timer);
      void Promise.all([killTree(child), exited(child, KILL_WAIT_MS)]).then(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        settle(() => reject(error));
      });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stopping) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_LIMIT) stop(new ClaudeError('bad-output', 'Claude Code sent more than 4 MB, so the office stopped it.'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const room = STDERR_LIMIT - stderrBytes;
      if (room <= 0) return;
      const part = chunk.subarray(0, room);
      stderr.push(part);
      stderrBytes += part.length;
    });
    child.on('error', (error) => {
      if (!stopping) settle(() => reject(startFailure(error, o.path, o.cwd)));
    });
    child.on('close', (exitCode, signal) => {
      if (stopping) return;
      settle(() => resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode, signal }));
    });
    // Claude Code may exit before it reads all of its input (it stops early when it isn't signed in). Writing then fails
    // with EPIPE, and the exit status and output say what went wrong, so the write error itself adds nothing.
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the result

export interface ClaudeOutput {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  /** Wall time of the run, used when Claude Code doesn't report duration_ms. */
  elapsedMs?: number;
}

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isResult = (value: unknown): value is Fields => isObject(value) && value.type === 'result';
const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const modelId = (value: unknown) => (typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value) ? value : null);

/** `--output-format json` prints one result object; with --verbose, an array of messages that ends with the result. */
function resultOf(stdout: string): Fields | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null; // not JSON at all: the caller explains what went wrong
  }
  if (Array.isArray(value)) value = value.findLast(isResult);
  return isResult(value) ? value : null;
}

function modelOf(modelUsage: unknown): string | null {
  if (!isObject(modelUsage)) return null;
  const key = Object.keys(modelUsage)[0];
  if (key === undefined) return null;
  const entry = modelUsage[key];
  const canonical = isObject(entry) ? modelId(entry.canonicalModel) : null;
  const id = modelId(key);
  return id && (knownModel(id) || !canonical) ? id : canonical;
}

/** The first non-empty line of Claude Code's own text, without terminal colour codes, cut to about `max` characters. */
function firstLine(text: string, max = 160): string {
  const plain = text.replace(/\p{Cc}\[[\d;?]*[A-Za-z]/gu, '');
  for (const line of plain.split(/\r?\n/)) {
    const clean = oneLine(line.replace(/\p{Cc}/gu, ' '), max);
    if (clean) return clean;
  }
  return '';
}

function limitReached(text: string, status: number | null): ClaudeError {
  const reset = /\bresets?\s+(?:at\s+)?([^·|\n]+)/i.exec(text)?.[1]?.replace(/[\s.]+$/, '');
  if (reset) {
    const when = oneLine(reset, 40);
    return new ClaudeError('limit', `Claude Code has reached its usage limit. It resets ${when}, so ask again then.`, when);
  }
  if (status === 529 || /overloaded/i.test(text)) return new ClaudeError('limit', 'Claude is overloaded right now. Try again in a minute.');
  const line = firstLine(text);
  return new ClaudeError('limit', line ? `Claude Code has hit a limit: ${line}` : 'Claude Code has hit a usage or rate limit. Try again later.');
}

/** The failures a person can do something specific about, from Claude Code's text and the API status. */
function classify(text: string, status: number | null): ClaudeError | null {
  if (status === 401 || /not logged in|please run \/login|invalid api key|authenticat(?:e|ion)|oauth token/i.test(text)) {
    return new ClaudeError('not-signed-in', NOT_SIGNED_IN);
  }
  if (status === 429 || status === 529 || /usage[ _]limit|rate[ _]limit|hit your limit|overloaded|credit balance/i.test(text)) {
    return limitReached(text, status);
  }
  if (status === 413 || /prompt is too long|context window|context length/i.test(text)) return new ClaudeError('too-long', TOO_LONG);
  return null;
}

function resultFailure(result: Fields): ClaudeError {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const text = [result.result, ...errors].filter((t): t is string => typeof t === 'string').join('\n');
  const status = typeof result.api_error_status === 'number' ? result.api_error_status : null;
  const known = classify(text, status);
  if (known) return known;
  // With no tools and one turn, a model that reaches for a tool runs out of turns before it says anything.
  if (result.subtype === 'error_max_turns' && !firstLine(text)) {
    return new ClaudeError('failed', 'It started to act on that instead of answering, and a side question can only be answered. Ask what it knows or plans instead.', null);
  }
  const line = firstLine(text) || (typeof result.subtype === 'string' ? firstLine(result.subtype, 60) : '');
  return new ClaudeError('failed', line ? `Claude Code couldn't answer: ${line}` : "Claude Code couldn't answer and didn't say why.", line || null);
}

function noResult(out: ClaudeOutput): ClaudeError {
  const exitCode = out.exitCode ?? null;
  const signal = out.signal ?? null;
  if (exitCode === 0 || (exitCode === null && signal === null)) return new ClaudeError('bad-output', BAD_OUTPUT);
  // It stopped before writing a result. Its words may say why, but only stderr is quoted: stdout could echo the prompt.
  const stderr = out.stderr ?? '';
  const known = classify(`${stderr}\n${out.stdout}`, null);
  if (known) return known;
  const line = firstLine(stderr);
  const how = exitCode === null ? `unexpectedly (${signal})` : `with exit code ${exitCode}`;
  return new ClaudeError('failed', line ? `Claude Code stopped ${how}: ${line}` : `Claude Code stopped ${how} and didn't say why.`, line || null);
}

/**
 * Turns what a finished run printed into its answer, or throws the ClaudeError that explains why there is none. Every
 * field is treated as untrusted and optional.
 */
export function parseClaudeOutput(out: ClaudeOutput): ClaudeResult {
  const result = resultOf(out.stdout);
  if (!result) throw noResult(out);
  const failed = result.is_error === true || (typeof result.subtype === 'string' && result.subtype.startsWith('error'));
  if (failed) throw resultFailure(result);
  if (typeof result.result !== 'string') throw new ClaudeError('bad-output', BAD_OUTPUT);
  const duration = amount(result.duration_ms);
  return {
    text: result.result,
    reportedCostUsd: amount(result.total_cost_usd),
    usage: usageFromApi(result.usage),
    model: modelOf(result.modelUsage),
    sessionId: safeId(result.session_id) ?? null,
    durationMs: Math.round(duration ?? Math.max(0, out.elapsedMs ?? 0)),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Desks (v3): the switchboard's long-lived stream-json sessions (src/runtime/). One-shot calls above stay exactly as
// they are; a desk shares the executable lookup, the cleaned environment, the start and the tree kill.

/**
 * The environment a desk runs with: claudeEnv's, but with prompt caching left on. A desk is one long conversation
 * whose every request rereads it (about 45k tokens on 2.1.312), so its cache pays for itself many times over.
 */
export function deskEnv(base: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env = claudeEnv(base, platform);
  delete env.DISABLE_PROMPT_CACHING;
  return env;
}

/**
 * Starts Claude Code for a desk as one-shot calls start it: an argument list, no shell, its own process group off
 * Windows so killDesk reaches everything it starts. Throws a ClaudeError when the start is refused outright.
 */
export function startDesk(claude: FoundClaude, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  return startClaude(claude, args, cwd, env);
}

/**
 * How long a desk's taskkill may take. A desk's tree is bigger than a one-shot call's (its shells, dev servers, MCP
 * servers), and on a loaded machine taskkill can need more than a one-shot call's 5 s; giving up early kills only the
 * desk and leaves its children running.
 */
const DESK_KILL_WAIT_MS = 30_000;

/** Kills a desk and everything it started: taskkill /T on Windows, the process group elsewhere. Never rejects. */
export function killDesk(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') return killTree(child);
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  return new Promise((done) => {
    execFile(taskkill, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: DESK_KILL_WAIT_MS }, (error) => {
      // taskkill fails when the desk ended a moment ago, or when it couldn't run: then stop the desk itself.
      if (error) child.kill();
      done();
    });
  });
}
