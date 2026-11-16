// v0.2: the office runs a task's check itself (PlanTask.check) when the task is reported done, as the gate: a model's "the
// tests pass" is a claim, an exit code is a fact. The command is the plain one the plan linter validated (commandProblem
// in src/core/plan-lint.ts: one line, no pipe, redirect or substitution, steps chained with &&), and it comes from the
// approved plan, never from a report. It runs as an argument list with no shell, in the task's folder, with a timeout and
// a bounded tail of output, after the approvals policy has judged it as it would a desk's own Bash: a command that would
// ask the stakeholder (a push, the network, something outside the project) isn't run by the office, and the task goes to
// a person instead. What a check prints is untrusted: it is masked and cut before anyone reads it.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { commandProblem } from '../core/plan-lint.ts';
import { redactClip } from '../core/redact.ts';
import { classifyPermission } from '../runtime/approvals.ts';
import { COMPUTED, scanCommand } from '../runtime/shell.ts';
import { killDesk } from '../server/claude.ts';
import { findNpm } from '../server/preview.ts';

/** How long a check may run before the office stops it and everything it started. */
export const CHECK_TIMEOUT_MS = 5 * 60_000;
/** The most output the runner holds, newest kept; a check that prints more than TOTAL_CAP is stopped. */
const KEEP_BYTES = 64 * 1024;
const TOTAL_CAP = 32 * 1024 * 1024;
/** How much of the output a person is given, and how much the board keeps. */
export const CHECK_TAIL_CHARS = 1_500;
export const CHECK_BOARD_CHARS = 600;

export interface CheckResult {
  /** unrunnable: the office wouldn't or couldn't run it (the tail says why); a person reviews the task instead. */
  state: 'passed' | 'failed' | 'unrunnable';
  /** The end of the output, or why it wasn't run; masked, cut to CHECK_TAIL_CHARS. */
  tail: string;
}

export interface CheckRequest {
  command: string;
  /** The task's folder: its worktree, or the project. */
  cwd: string;
  /** The project folder, for the approvals policy. */
  root: string;
  branch: string | null;
  /** The task's owner, as the policy knows a desk's person. */
  person: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The company's seam for running a check: tests pass a fake. */
export type CheckRunner = (request: CheckRequest) => Promise<CheckResult>;

interface Step {
  /** `cd`, which the runner does itself, or a program with its arguments. */
  kind: 'cd' | 'run';
  file: string;
  args: string[];
}

const unrunnable = (why: string): CheckResult => ({ state: 'unrunnable', tail: why });

/** The program as the office starts it: Node itself, npm and npx as this Node's CLI scripts, anything else from the PATH. */
function programFor(name: string, cwd: string, env: NodeJS.ProcessEnv): { file: string; args: string[] } | string {
  const win = process.platform === 'win32';
  if (name === 'node' || name === 'node.exe') return { file: process.execPath, args: [] };
  if (name === 'npm' || name === 'npx') {
    const npm = findNpm(env);
    if (!npm) return `The office couldn't find npm to run ${name}.`;
    if (name === 'npm') return { file: npm.command, args: npm.args };
    const cli = npm.args[0];
    if (cli !== undefined && /npm-cli\.js$/.test(cli)) return { file: npm.command, args: [cli.replace(/npm-cli\.js$/, 'npx-cli.js')] };
    return { file: join(dirname(npm.command), 'npx'), args: [] };
  }
  const isFile = (path: string): boolean => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  if (/[\\/]/.test(name)) {
    const full = resolve(cwd, name);
    // A script path inside the project: started as it is. On Windows only a real executable starts without a shell.
    if (win && !/\.(?:exe|com)$/i.test(full)) return `${name} starts only through a shell on Windows, which the office doesn't use for a check; give the check as a command that runs without one (node, npm or an .exe).`;
    return isFile(full) ? { file: full, args: [] } : `${name} isn't a file in ${cwd}.`;
  }
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter((dir) => dir !== '' && isAbsolute(dir));
  const exts = win ? ['.exe', '.com'] : [''];
  for (const dir of dirs) for (const ext of exts) if (isFile(join(dir, name + ext))) return { file: join(dir, name + ext), args: [] };
  if (win && dirs.some((dir) => ['.cmd', '.bat'].some((ext) => existsSync(join(dir, name + ext))))) {
    return `${name} starts only through a shell on Windows, which the office doesn't use for a check; give the check as a command that runs without one (node, npm or an .exe).`;
  }
  return `The office couldn't find ${name} to run the check.`;
}

/** Options that point a package manager at another registry or configuration, or make it run a command of the check's choosing. */
const NPM_HIJACKS = /^--(?:prefix|userconfig|globalconfig|script-shell|node-options|registry|call|package|cache)(?:=|$)/;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'powershell', 'pwsh']);

/**
 * Why a check's step is not one the office runs by itself, or null. A check is what the stakeholder's plan says and nothing
 * more: it doesn't download a package to run (`npx -p`), run a command line (`npx -c`, `npm exec -c`), preload code into node
 * (`-r`, `--import`, `--loader`, `-e`, `-p`), open a debugger (`--inspect`), start a shell, read a script outside the task's
 * folder, or change where a package manager reads its settings and packages from.
 */
export function stepProblem(head: string, rest: readonly string[], cwd: string, folder: string): string | null {
  const name = head.replace(/\.exe$/i, '').split(/[\\/]/).pop()?.toLowerCase() ?? head;
  const hijack = rest.find((a) => NPM_HIJACKS.test(a));
  if (hijack !== undefined) return `The check uses ${hijack.split('=')[0]}, which changes what the package manager runs or reads, so a person reviews it.`;
  // A debugger, on any address: a check has no use for one, and one open beyond this computer lets others run code on it.
  const debug = rest.find((a) => /^--(?:inspect|debug-port)/.test(a));
  if (debug !== undefined) return `The check opens a debugger (${debug.split('=')[0]}), so a person reviews it.`;
  const runs = name === 'npx' || rest.some((a) => a === 'exec' || a === 'x' || a === 'dlx');
  if ((name === 'npx' || name === 'npm' || name === 'pnpm' || name === 'yarn') && runs && rest.some((a) => a === '-c' || a === '-p' || /^-[A-Za-z]*[cp]$/.test(a))) {
    return `The check runs ${name} with -c or -p, which runs a command line or downloads a package, so a person reviews it.`;
  }
  if (SHELLS.has(name)) return `The check starts a shell (${name}), which can run anything, so a person reviews it.`;
  if (name === 'node' || name === 'nodejs') {
    const flag = rest.find((a) => /^(?:-r|--require|--import|--loader|--experimental-loader|-e|--eval|-p|--print|-pe|-ep|--env-file|--run)(?:=|$)/.test(a) || /^-r./.test(a));
    if (flag !== undefined) return `The check runs node with ${flag.split('=')[0]}, which loads or runs code the plan doesn't show, so a person reviews it.`;
  }
  if (/^(?:python[\d.]*|py)$/.test(name)) {
    const script = rest.find((a) => !a.startsWith('-') || a === '-');
    if (rest.includes('-c') || script === undefined || script === '-') return 'The check runs python without a script file, so a person reviews it.';
    const inside = relative(cwd, resolve(folder, script));
    if (inside.startsWith('..') || isAbsolute(inside)) return "The check runs a python script from outside the task's folder, so a person reviews it.";
  }
  return null;
}

/** The check as steps with no shell in them, or why it can't be one. Pure but for looking programs up. */
export function stepsOf(command: string, cwd: string, env: NodeJS.ProcessEnv): Step[] | string {
  const problem = commandProblem(command);
  if (problem !== null) return `The check ${problem}.`;
  const scanned = scanCommand(command, 'bash');
  if (!scanned || scanned.nested.length > 0 || scanned.commands.length === 0) return "The office couldn't read the check as plain commands chained with &&.";
  const steps: Step[] = [];
  let folder = cwd;
  for (const c of scanned.commands) {
    if (c.redirects.length > 0) return 'The check redirects input or output, and a check is plain commands.';
    const [head, ...rest] = c.words;
    if (head === undefined || c.words.some((w) => w.includes(COMPUTED))) return "The check holds a value the shell would work out, so the office can't run it.";
    if (/^[A-Za-z_]\w*=/.test(head)) return 'The check sets an environment variable first, and the office runs a check as a program with its arguments.';
    if (head === 'cd') {
      const to = rest[0];
      if (to === undefined || rest.length !== 1) return 'The check has a cd that names no single folder.';
      const next = resolve(folder, to);
      const inside = relative(cwd, next);
      if (inside.startsWith('..') || isAbsolute(inside)) return 'The check changes folder to somewhere outside the task\'s folder.';
      folder = next;
      steps.push({ kind: 'cd', file: next, args: [] });
      continue;
    }
    const refused = stepProblem(head, rest, cwd, folder);
    if (refused !== null) return refused;
    const program = programFor(head, folder, env);
    if (typeof program === 'string') return program;
    steps.push({ kind: 'run', file: program.file, args: [...program.args, ...rest] });
  }
  return steps;
}

/** What a check is given from the office's own environment: where programs and temporary files are, and nothing a token could ride in. */
const ENV_ALLOWED = /^(?:PATH|PATHEXT|HOME|HOMEDRIVE|HOMEPATH|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|SYSTEMROOT|WINDIR|COMSPEC|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|OS|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|LANG|LC_[A-Z_]+|TZ|npm_config_cache|NODE_ENV|NODE_PATH|NODE_NO_WARNINGS)$/i;

/**
 * What a check runs with: an allowlist, not a denylist, so a variable nobody thought of (a token, a key, an endpoint) never reaches
 * it. NODE_OPTIONS is left out on purpose: it can make node load code of its own.
 */
export function checkEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) if (ENV_ALLOWED.test(key) && value !== undefined) env[key] = value;
  return { ...env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', npm_config_update_notifier: 'false' };
}

// The escape sequences a terminal program prints: colours and cursor moves (CSI), operating-system commands such as a window title
// or a link (OSC, ended by BEL or ST), the other escapes, and the control characters left, which would otherwise reach a screen.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[0-~]|\u009b[0-9;?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** The end of a check's output as lines a person can read: no colours, no blank run, secrets masked. */
export function tailOf(output: string, chars: number): string {
  const text = output.replace(ANSI, '').replace(/\r\n?/g, '\n').replace(CONTROLS, '').replace(/\n{3,}/g, '\n\n').trim();
  const kept = text.length > chars ? `…${text.slice(text.length - chars + 1)}` : text;
  return redactClip(kept, chars + 1);
}

/** Runs one program and answers with its exit code, the newest of its output and whether it was stopped. */
function runOne(step: Step, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal: AbortSignal | undefined): Promise<{ code: number | null; output: string; stopped: 'time' | 'flood' | 'abort' | null }> {
  return new Promise((done) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(step.file, step.args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (error) {
      done({ code: null, output: `Couldn't start ${step.file}: ${(error as Error).message}`, stopped: null });
      return;
    }
    let kept = Buffer.alloc(0);
    let total = 0;
    let stopped: 'time' | 'flood' | 'abort' | null = null;
    let settled = false;
    const finish = (code: number | null, extra = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      done({ code, output: kept.toString('utf8') + extra, stopped });
    };
    const stop = (why: 'time' | 'flood' | 'abort'): void => {
      if (stopped !== null || settled) return;
      stopped = why;
      void killDesk(child).then(() => finish(null));
    };
    const timer = setTimeout(() => stop('time'), timeoutMs);
    const onAbort = (): void => stop('abort');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const take = (chunk: Buffer): void => {
      if (stopped !== null) return;
      total += chunk.length;
      kept = kept.length + chunk.length > KEEP_BYTES ? Buffer.concat([kept, chunk]).subarray(-KEEP_BYTES) : Buffer.concat([kept, chunk]);
      if (total > TOTAL_CAP) stop('flood');
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.stdin.on('error', () => undefined);
    child.stdin.end();
    child.on('error', (error) => {
      if (stopped === null) finish(null, `\nCouldn't run ${step.file}: ${error.message}`);
    });
    child.on('close', (code) => finish(code));
  });
}

/**
 * Runs a task's check. `unrunnable` (with the reason) when the approvals policy would ask or refuse it, when it isn't a
 * plain command, or when a program can't be started without a shell; otherwise passed or failed by the exit codes.
 */
export const runCheck: CheckRunner = async (request) => {
  const verdict = classifyPermission(
    { tool_name: 'Bash', tool_input: { command: request.command } },
    { root: request.root, cwd: request.cwd, branch: request.branch, rules: [], person: request.person },
  );
  if (verdict.verdict !== 'allow') {
    return unrunnable(`The office doesn't run this check by itself, because it would ask ${verdict.verdict === 'ask' ? `first (${verdict.summary})` : 'to be refused'}.`);
  }
  const env = checkEnv();
  const steps = stepsOf(request.command, request.cwd, env);
  if (typeof steps === 'string') return unrunnable(steps);
  const timeoutMs = request.timeoutMs ?? CHECK_TIMEOUT_MS;
  let folder = request.cwd;
  let output = '';
  for (const step of steps) {
    if (step.kind === 'cd') {
      if (!existsSync(step.file) || !statSync(step.file).isDirectory()) return { state: 'failed', tail: tailOf(`${output}\nThe folder ${relative(request.cwd, step.file).split(sep).join('/')} doesn't exist.`, CHECK_TAIL_CHARS) };
      folder = step.file;
      continue;
    }
    const r = await runOne(step, folder, env, timeoutMs, request.signal);
    output += `${output === '' ? '' : '\n'}${r.output}`;
    if (r.stopped === 'abort') return unrunnable('The company closed before the check finished.');
    if (r.stopped === 'time') return { state: 'failed', tail: tailOf(`${output}\n\nThe check ran past ${Math.round(timeoutMs / 1000)} seconds, so the office stopped it.`, CHECK_TAIL_CHARS) };
    if (r.stopped === 'flood') return { state: 'failed', tail: tailOf(`${output}\n\nThe check printed far too much, so the office stopped it.`, CHECK_TAIL_CHARS) };
    if (r.code !== 0) return { state: 'failed', tail: tailOf(`${output}\n\nExit code ${r.code ?? 'none'}.`, CHECK_TAIL_CHARS) };
  }
  return { state: 'passed', tail: tailOf(output, CHECK_TAIL_CHARS) };
};
