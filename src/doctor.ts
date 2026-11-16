// `worklings doctor`, and the lobby's first-run check: is everything Worklings needs here? Node, Claude Code (found,
// its version, signed in), git, the hub's ports and, optionally, Tailscale, each as one plain line with one fix.
//
// The sign-in comes from Claude Code itself: `claude auth status --json` (2.1.312; docs/claude-code-surfaces.md,
// "Sign-in status") costs nothing and calls no model, and Worklings never opens a credential file or the keychain. Of
// its answer only loggedIn, authMethod, apiProvider, subscriptionType and apiKeySource are read: the email and
// organisation it prints too are never looked at, shown or kept. Every command runs from an argument list, never through
// a shell, and is stopped after a time limit.
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { findGit } from './hub/folders.ts';
import { readSettings, runningHub, worklingsHome } from './hub/home.ts';
import { claudeEnv, type ClaudeLookup, findClaude } from './server/claude.ts';
import { findTailscale, tailnetReady, TailnetError, type TailscaleLookup } from './server/tailnet.ts';
import { tokenFile } from './server/token.ts';

/** Claude Code's install page (checked on code.claude.com, 5 Nov 2026). */
export const CLAUDE_INSTALL_URL = 'https://code.claude.com/docs/en/setup';
/** Claude Code's page on signing in and the accounts it takes. */
export const CLAUDE_SIGN_IN_URL = 'https://code.claude.com/docs/en/authentication';
const NODE_URL = 'https://nodejs.org';
const GIT_URL = 'https://git-scm.com/downloads';
const TAILSCALE_URL = 'https://tailscale.com/download';
/** The Claude Code release the desks, the org tools and the hooks are pinned to (test/fixtures/claude-2.1.312/). */
export const TESTED_CLAUDE = '2.1.312';
export const MIN_NODE = 22;
/** `claude --version` and `git --version` answer at once; `claude auth status` took 3 to 12 s on Windows. */
const VERSION_MS = 15_000;
const SIGN_IN_MS = 45_000;
const OUTPUT_LIMIT = 256 * 1024;

const VARIABLES = ['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE'];

export interface ClaudeStatus {
  /** ready: found and signed in. missing: not found or won't start. signed-out. unknown: found, sign-in unreadable. */
  state: 'ready' | 'missing' | 'signed-out' | 'unknown';
  /** "2.1.312", or null when it didn't say. */
  version: string | null;
  /** How it is signed in, for a sentence: "your Claude Max plan", "an API key"; null when it isn't. */
  account: string | null;
  /** True when it bills per token (an API key or a cloud provider), so a company's cost is real money. */
  perToken: boolean;
  /** What was found, in one sentence. */
  message: string;
  /** The one thing to do about it, or null when there is nothing to do. */
  fix: string | null;
  /** The page the fix needs, or null. */
  link: string | null;
}

export interface CheckOptions {
  /** The environment to look in and run with: process.env unless given. */
  env?: NodeJS.ProcessEnv;
  /** Claude Code, when already looked up (tests); findClaude(env) otherwise. */
  claude?: ClaudeLookup;
  /** How long a sign-in check may take (45 s unless given). */
  timeoutMs?: number;
}

interface Ran {
  code: number | null;
  stdout: string;
  /** Why it gave no answer at all: it didn't start, it was too slow, or it printed far too much. */
  failed: { why: 'start' | 'timeout' | 'flood'; code: string | null } | null;
}

/** Runs a program once from an argument list with no shell and no input, stopped after `timeoutMs`. Never rejects. */
function runQuietly(command: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Ran> {
  return new Promise((done) => {
    const child = execFile(
      command,
      [...args],
      { env, timeout: timeoutMs, maxBuffer: OUTPUT_LIMIT, windowsHide: true, shell: false, encoding: 'utf8' },
      (error, stdout) => {
        if (!error) return done({ code: 0, stdout, failed: null });
        const code = typeof error.code === 'string' ? error.code : null;
        if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return done({ code: null, stdout: '', failed: { why: 'flood', code } });
        if (code !== null) return done({ code: null, stdout: '', failed: { why: 'start', code } });
        if (error.killed) return done({ code: null, stdout: '', failed: { why: 'timeout', code: null } });
        done({ code: typeof error.code === 'number' ? error.code : null, stdout, failed: null });
      },
    );
    // Nothing these commands do reads input; a closed stdin keeps one that would from waiting.
    child.stdin?.end();
    child.on('error', () => undefined);
  });
}

/** "2.1.312" from "2.1.312 (Claude Code)" or "git version 2.55.0.windows.3"; null when there is no version in it. */
function versionIn(text: string): string | null {
  return /(\d{1,4})\.(\d{1,4})\.(\d{1,6})/.exec(text)?.[0] ?? null;
}

/** Negative when `a` is the older version, positive when it is the newer one. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const PLANS: Readonly<Record<string, string>> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', ultra: 'Ultra' };
const PROVIDERS: Readonly<Record<string, string>> = { bedrock: 'Amazon Bedrock', vertex: 'Google Cloud', foundry: 'Microsoft Foundry' };
const known = (table: Readonly<Record<string, string>>, value: unknown) => (typeof value === 'string' && Object.hasOwn(table, value) ? (table[value] ?? null) : null);

/** What `auth status --json` says about the sign-in, reading only the fields named at the top of this file. */
function signIn(stdout: string): { loggedIn: boolean; account: string | null; perToken: boolean } | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null; // not JSON: an older Claude Code, or something else on the PATH
  }
  if (!isObject(value) || typeof value.loggedIn !== 'boolean') return null;
  if (!value.loggedIn) return { loggedIn: false, account: null, perToken: false };
  const provider = known(PROVIDERS, value.apiProvider);
  if (provider) return { loggedIn: true, account: provider, perToken: true };
  if (value.authMethod === 'api_key' || typeof value.apiKeySource === 'string') return { loggedIn: true, account: 'an API key', perToken: true };
  if (value.authMethod === 'claude.ai') {
    const plan = known(PLANS, value.subscriptionType);
    return { loggedIn: true, account: plan ? `your Claude ${plan} plan` : 'your Claude account', perToken: false };
  }
  return { loggedIn: true, account: "Claude Code's own sign-in", perToken: false };
}

const status = (state: ClaudeStatus['state'], message: string, fix: string | null, link: string | null, more: Partial<ClaudeStatus> = {}): ClaudeStatus => ({
  state, version: null, account: null, perToken: false, message, fix, link, ...more,
});

function missing(reason: string, env: NodeJS.ProcessEnv): ClaudeStatus {
  const variable = VARIABLES.find((name) => (env[name] ?? '').trim() !== '');
  if (variable) return status('missing', `Worklings can't run the Claude Code that ${variable} names.`, reason, null);
  // A claude.cmd without the cli.js beside it: found, but only a shell could start it.
  if (reason.startsWith('Found ')) return status('missing', reason, `Install Claude Code from ${CLAUDE_INSTALL_URL}, then run claude once to sign in.`, CLAUDE_INSTALL_URL);
  return status('missing', "Claude Code isn't installed, or it isn't on the PATH.", `Install it from ${CLAUDE_INSTALL_URL}, then run claude once in a terminal to sign in.`, CLAUDE_INSTALL_URL);
}

/** What to say when Claude Code can't be found, from the lookup alone (nothing starts); null when it is found. */
export function claudeMissing(env: NodeJS.ProcessEnv = process.env): ClaudeStatus | null {
  const lookup = findClaude(env);
  return lookup.found ? null : missing(lookup.reason, env);
}

/**
 * Is Claude Code here and signed in? Runs `claude --version` and `claude auth status --json`, both free, with the
 * environment desks get (the host session's wiring removed). Never rejects: a problem is a state with its fix.
 */
export async function claudeStatus(o: CheckOptions = {}): Promise<ClaudeStatus> {
  const env = o.env ?? process.env;
  const lookup = o.claude ?? findClaude(env);
  if (!lookup.found) return missing(lookup.reason, env);
  const childEnv = claudeEnv(env);
  const run = (args: string[], ms: number) => runQuietly(lookup.command, [...lookup.prefixArgs, ...args], childEnv, ms);
  const [versionRan, authRan] = await Promise.all([run(['--version'], VERSION_MS), run(['auth', 'status', '--json'], o.timeoutMs ?? SIGN_IN_MS)]);
  if (versionRan.failed?.why === 'start') {
    const code = versionRan.failed.code ? ` (${versionRan.failed.code})` : '';
    return status('missing', `Claude Code at ${lookup.path} didn't start${code}.`, `Reinstall it from ${CLAUDE_INSTALL_URL}.`, CLAUDE_INSTALL_URL);
  }
  const version = versionRan.code === 0 ? versionIn(versionRan.stdout) : null;
  const more = { version };
  const named = version ? `Claude Code ${version}` : 'Claude Code';
  const said = authRan.failed === null ? signIn(authRan.stdout) : null;
  if (authRan.failed?.why === 'timeout') {
    const seconds = Math.round((o.timeoutMs ?? SIGN_IN_MS) / 1000);
    return status('unknown', `${named} didn't say whether it's signed in within ${seconds} seconds.`, 'Run claude once in a terminal to check that you are signed in.', null, more);
  }
  if (!said && authRan.failed === null && authRan.stdout.trim() === '') {
    // Older releases have no `auth` command: commander says so on stderr and exits with 1.
    return status('unknown', `${named} can't say whether it's signed in: it has no claude auth status.`, 'Update it with claude update, or run claude once in a terminal to check.', null, more);
  }
  if (!said) {
    return status('unknown', `${named} answered claude auth status in a form Worklings doesn't read.`, 'Update it with claude update, and check that WORKLINGS_CLAUDE or the PATH leads to it.', null, more);
  }
  if (!said.loggedIn) return status('signed-out', `${named} isn't signed in.`, 'Run claude once in a terminal and sign in.', CLAUDE_SIGN_IN_URL, more);
  const billing = said.perToken ? ', so companies are billed per token' : '';
  return status('ready', `${named} is signed in with ${said.account ?? 'its own sign-in'}${billing}.`, null, null, { ...more, account: said.account, perToken: said.perToken });
}

export interface GitStatus {
  found: boolean;
  version: string | null;
  message: string;
  fix: string | null;
  link: string | null;
}

/** Is git on the PATH? A company works on a branch of its own, so it needs git. */
export async function gitStatus(env: NodeJS.ProcessEnv = process.env): Promise<GitStatus> {
  const git = findGit(env);
  const fix = `Install it from ${GIT_URL}: each company works on a git branch of its own.`;
  if (git === null) return { found: false, version: null, message: "Git isn't installed, or it isn't on the PATH.", fix, link: GIT_URL };
  const ran = await runQuietly(git, ['--version'], env, VERSION_MS);
  const version = ran.code === 0 ? versionIn(ran.stdout) : null;
  if (version === null) return { found: false, version: null, message: `Git at ${git} didn't answer git --version.`, fix, link: GIT_URL };
  return { found: true, version, message: `Git ${version}.`, fix: null, link: null };
}

/** Whether a port on 127.0.0.1 is free to listen on, taken, or not this user's to take. */
export function portState(port: number, host = '127.0.0.1'): Promise<'free' | 'taken' | 'denied'> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'EACCES' || error.code === 'EPERM' ? 'denied' : 'taken'));
    probe.listen(port, host, () => probe.close(() => done('free')));
  });
}

export type CheckState = 'ok' | 'warn' | 'fail' | 'off';

export interface DoctorCheck {
  id: 'node' | 'claude' | 'sign-in' | 'git' | 'hub-port' | 'tailnet-port' | 'tailscale';
  state: CheckState;
  /** A failure here stops companies from running, and doctor exits with 1. */
  required: boolean;
  /** What was found, in one sentence. */
  line: string;
  /** The one thing to do about it; null when there is nothing to do. */
  fix: string | null;
}

export interface DoctorReport {
  /** True when no required check failed. */
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions extends CheckOptions {
  /** The hub's port: its default unless the person named one. */
  hubPort: number;
  /** Node's version, process.versions.node unless given (tests). */
  nodeVersion?: string;
  /** Tailscale's CLI, when already looked up (tests); findTailscale(env) otherwise. */
  tailscale?: TailscaleLookup;
}

function nodeCheck(version: string): DoctorCheck {
  const major = Number(version.split('.')[0]);
  if (major >= MIN_NODE) return { id: 'node', state: 'ok', required: true, line: `Node.js ${version}.`, fix: null };
  return { id: 'node', state: 'fail', required: true, line: `Node.js ${version} is too old: Worklings needs ${MIN_NODE} or newer.`, fix: `Install the current LTS from ${NODE_URL}.` };
}

/** Two lines: Claude Code itself (found, its version), then its sign-in, each with its own fix. */
function claudeChecks(found: ClaudeStatus): DoctorCheck[] {
  if (found.state === 'missing') return [{ id: 'claude', state: 'fail', required: true, line: found.message, fix: found.fix }];
  const version = found.version;
  const installed: DoctorCheck =
    version && compareVersions(version, TESTED_CLAUDE) < 0
      ? { id: 'claude', state: 'warn', required: true, line: `Claude Code ${version} is older than ${TESTED_CLAUDE}, the version Worklings is tested with.`, fix: 'Update it with claude update.' }
      : { id: 'claude', state: 'ok', required: true, line: version ? `Claude Code ${version}.` : 'Claude Code is installed.', fix: null };
  const signedIn: DoctorCheck =
    found.state === 'ready'
      ? { id: 'sign-in', state: 'ok', required: true, line: `Signed in to Claude Code with ${found.account ?? 'its own sign-in'}${found.perToken ? ', so companies are billed per token' : ''}.`, fix: null }
      : found.state === 'signed-out'
        ? { id: 'sign-in', state: 'fail', required: true, line: "Claude Code isn't signed in.", fix: found.fix }
        : { id: 'sign-in', state: 'warn', required: true, line: found.message, fix: found.fix };
  return [installed, signedIn];
}

const gitCheck = (git: GitStatus): DoctorCheck => ({ id: 'git', state: git.found ? 'ok' : 'fail', required: true, line: git.message, fix: git.fix });

async function portChecks(hubPort: number, env: NodeJS.ProcessEnv): Promise<DoctorCheck[]> {
  const dir = dirname(tokenFile(worklingsHome(env)));
  const hub = runningHub(dir);
  if (hub) {
    const line = hub.port === hubPort ? `A Worklings hub is already running on port ${hubPort}.` : `A Worklings hub is already running, on port ${hub.port}.`;
    return [{ id: 'hub-port', state: 'ok', required: false, line, fix: hub.port === hubPort ? null : `Open it with npx worklings, or stop it first to use port ${hubPort}.` }];
  }
  const tailnetPort = readSettings(dir).tailnetPort ?? (hubPort < 65_535 ? hubPort + 1 : hubPort - 1);
  const [hubState, tailnetState] = await Promise.all([portState(hubPort), portState(tailnetPort)]);
  const other = hubPort + 10 <= 65_535 ? hubPort + 10 : hubPort - 10;
  const hubCheck: DoctorCheck =
    hubState === 'free'
      ? { id: 'hub-port', state: 'ok', required: false, line: `Port ${hubPort} is free for the hub.`, fix: null }
      : {
          id: 'hub-port', state: 'warn', required: false,
          line: hubState === 'denied' ? `Worklings isn't allowed to listen on port ${hubPort}.` : `Something else is using port ${hubPort}, the hub's port.`,
          fix: `Start the hub on another port: npx worklings --port ${other}.`,
        };
  const settings = join(dir, 'settings.json');
  const tailnetCheck: DoctorCheck =
    tailnetState === 'free'
      ? { id: 'tailnet-port', state: 'ok', required: false, line: `Port ${tailnetPort} is free for the hub on your tailnet (--tailnet).`, fix: null }
      : {
          id: 'tailnet-port', state: 'warn', required: false,
          line: `Something else is using port ${tailnetPort}, which --tailnet puts the hub on.`,
          fix: `Only --tailnet needs it: free it, or set "tailnetPort" in ${settings}.`,
        };
  return [hubCheck, tailnetCheck];
}

/** "Tailscale isn't running: start it, then try again." as a line and its fix. */
function splitSentence(message: string): { line: string; fix: string | null } {
  const at = message.indexOf(': ');
  if (at === -1) return { line: message, fix: null };
  const rest = message.slice(at + 2);
  return { line: `${message.slice(0, at)}.`, fix: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/** Tailscale is optional: missing, it's a note; installed, `tailscale status` says whether --tailnet would work. */
async function tailscaleCheck(env: NodeJS.ProcessEnv, lookup: TailscaleLookup, timeoutMs: number): Promise<DoctorCheck> {
  if (!lookup.found) {
    if ((env.WORKLINGS_TAILSCALE ?? '').trim() === '') {
      return {
        id: 'tailscale', state: 'off', required: false,
        line: "Tailscale isn't installed. It's optional: it puts the hub on your phone.", fix: `To use it, install it from ${TAILSCALE_URL} and sign in.`,
      };
    }
    return { id: 'tailscale', state: 'warn', required: false, ...splitSentence(lookup.reason) };
  }
  try {
    const host = await tailnetReady({ tailscale: lookup.path, env, timeoutMs });
    return { id: 'tailscale', state: 'ok', required: false, line: `Tailscale is ready: npx worklings --tailnet puts the hub on https://${host}.`, fix: null };
  } catch (error) {
    if (!(error instanceof TailnetError)) throw error;
    return { id: 'tailscale', state: 'warn', required: false, ...splitSentence(error.message) };
  }
}

/** Every check, in the order a person fixes them. What it finds is a line with its fix, never a rejection. */
export async function runDoctor(o: DoctorOptions): Promise<DoctorReport> {
  const env = o.env ?? process.env;
  const [claude, git, ports, tailscale] = await Promise.all([
    claudeStatus(o),
    gitStatus(env),
    portChecks(o.hubPort, env),
    tailscaleCheck(env, o.tailscale ?? findTailscale(undefined, env), Math.min(o.timeoutMs ?? VERSION_MS, VERSION_MS)),
  ]);
  const checks = [nodeCheck(o.nodeVersion ?? process.versions.node), ...claudeChecks(claude), gitCheck(git), ...ports, tailscale];
  return { ok: !checks.some((c) => c.required && c.state === 'fail'), checks };
}

/** The report as the terminal shows it: a line per check, its fix under it, and what to do next. */
export function formatDoctor(report: DoctorReport): string {
  const out = ['Worklings doctor', ''];
  for (const check of report.checks) {
    out.push(`  ${check.state.padEnd(5)} ${check.line}`);
    if (check.fix) out.push(`        ${check.fix}`);
  }
  out.push('');
  const failed = report.checks.filter((c) => c.required && c.state === 'fail').length;
  if (failed === 0) out.push('Everything Worklings needs is here. Run npx worklings to open the lobby.');
  else out.push(`${failed === 1 ? 'One thing' : `${failed} things`} to fix before companies can run. The demo works without ${failed === 1 ? 'it' : 'them'}: npx worklings demo.`);
  return `${out.join('\n')}\n`;
}
