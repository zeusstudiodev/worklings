// The approvals policy, by the autonomy decision (SPEC-v3.md, "Approvals"): what a desk's PermissionRequest may do
// without asking (reading and editing the project or the desk's worktree, anything in the desk's own scratch folder,
// the project's own commands, installing the dependencies it declares, git's routine on the company's branch, the org
// tools), and what goes
// to the stakeholder's inbox with its kind, a plain summary and the exact command or path: push, deploy, publish,
// anything else outside the project, branch deletion, paid APIs and outside hosts, messages to people outside the
// company, global settings, and whatever the policy can't place. Changes to how Claude Code and git run in the
// project (.claude/, CLAUDE.md and the files it imports with @path, .mcp.json, .git/, .husky/, hook managers, local
// git config) always ask, with no Always allow, and no rule lifts them: a hook, a server, a setting or an instruction
// written there would later run outside this gate, or raise a person's own place. Chained and nested commands are
// judged part by part, and one part that asks makes the whole ask. The office's own records (.worklings) are refused
// outright. The request is untrusted: every field is checked.
//
// What it covers, and what it can't. It gates the actions Claude Code's own tools take, by what they name: a file the
// Edit or Write tool changes, a command the Bash or PowerShell tool runs (its programs, paths, redirections, the
// commands nested in it, the scripts it runs by name and the lifecycle scripts npm runs with them, the files a patch it
// applies names), an MCP call. Code a desk writes and then runs (a script, a test, a declared package's install step)
// runs with the user's own authority, and the policy sees only the command that starts it, not what that code does. It
// reads commands; it doesn't sandbox them. Code that one command alone brings in and runs (from its input, inline, from
// the network, a package the project doesn't declare yet) asks.
import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { posix, win32 } from 'node:path';
import { type ApprovalAdvice, type AskKind, isManager, ORG_TOOLS, type Person, toolsFor } from '../core/company.ts';
import { type Leash, STEERING_TOOLS } from '../core/steering.ts';
import { isCheckerSeat } from '../core/size.ts';
import { oneLine } from '../core/events.ts';
import { redactClip, redactSecrets } from '../core/redact.ts';
import { importedFiles } from './imports.ts';
import { opened, throughLink as linkBetween } from './paths.ts';
import { COMPUTED, type Dialect, scanCommand, type SimpleCommand } from './shell.ts';

export interface AlwaysRule {
  /** A Claude Code permission rule scoped to the project, as "Always allow" stores it ("Bash(git push origin:*)"). */
  rule: string;
  /** What it allows, as the inbox finishes "Always allow adds a rule for this company: ..." ("any git push to origin"). */
  sentence: string;
}

/** What the policy says about a PermissionRequest; the hub answers allow and deny itself and puts an ask in the inbox. */
export type PermissionVerdict =
  | { verdict: 'allow' }
  | { verdict: 'deny'; message: string }
  | { verdict: 'ask'; kind: AskKind; summary: string; detail: string; alwaysRule: AlwaysRule | null; advice?: ApprovalAdvice };

export interface PolicyOptions {
  /** The company's project folder. */
  root: string;
  /** The desk's checkout or worktree; the payload's own cwd when it lies in the project, else the project. */
  cwd?: string | null;
  /** The company's work branch; null when the project isn't a git repository. */
  branch: string | null;
  /** The company's Always allow rules. */
  rules: readonly string[];
  /**
   * The desk's own scratch folder, which its TMP, TEMP and TMPDIR name: reading, writing, running and deleting there
   * needs nobody. The rest of the temporary folder, the desk's settings beside it included, is outside the project.
   */
  scratch?: string | null;
  /**
   * The desk's person. v0.2: they may read and write their own handover notes, `.worklings/handover/<person>.md` in the
   * project folder, and nothing else under .worklings. The records the office shares, `.worklings-shared/` (the brief and,
   * v0.3, the screenshots of the app), every desk may read and none may change: the office asks for those notes when their context grows large.
   */
  person?: string | null;
  /**
   * The person's leash (SPEC-v3.md, "Per-person leash"). Trusted lifts the routine in-project asks: other programs run
   * on the project's files, git housekeeping in the person's own worktree, and merging their own task branch into the
   * work branch. Setup files and the ask list that leaves the project or is visible to others ask under every leash.
   * "check" holds the task in the company and changes nothing here; absent is the default.
   */
  leash?: Leash;
  /**
   * The process ids this desk itself started and that are running now, as the office recorded them
   * (src/runtime/descendants.ts, startedBy). A stop that names only these, by number, needs nobody; every other stop asks.
   */
  ownProcesses?: Iterable<number>;
  /**
   * v0.4 (SPEC-v0.4.md, H5): the desk is a harness company's Tester, who writes the acceptance tests into
   * `.worklings-shared/acceptance/`: that folder, and nothing else of the office's records, is theirs to change.
   */
  acceptance?: boolean;
  /** For tests: the home and temporary folders and the platform; the machine's own otherwise. */
  home?: string;
  tmp?: string;
  platform?: NodeJS.Platform;
}

/** The PermissionRequest hook's answer, in the shape Claude Code 2.1.312 reads (test/fixtures/claude-2.1.312/desk/). */
export function permissionAnswer(behavior: 'allow' | 'deny', message?: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: behavior === 'allow' ? { behavior } : { behavior, message: message?.trim() || 'Not allowed.' },
    },
  };
}

/**
 * What the office advises on an ask and what the person does if it is a no, by what kind of ask it is (v0.2: an ask carries
 * a recommendation, and without an answer it is always a no). The sentences are the inbox's, in plain words.
 */
const ADVICE: Record<AskKind, Omit<ApprovalAdvice, 'ifNoAnswer'>> = {
  push: { recommend: 'deny', why: 'Nothing is pushed from inside a company: the work stays committed on its branch, and you publish it when you are ready.', fallback: 'Carry on without pushing, and say in your report what is ready to push.' },
  deploy: { recommend: 'deny', why: 'Deploying changes what people see online, so it waits until you have looked at the result.', fallback: 'Carry on without deploying, and say in your report what to deploy.' },
  publish: { recommend: 'deny', why: 'Publishing makes it public and cannot be taken back.', fallback: 'Carry on without publishing, and say in your report what is ready to publish.' },
  'outside-project': { recommend: 'deny', why: "It reads or changes something outside the project and the desk's own scratch folder.", fallback: 'Use the project folder, or your scratch folder ($TMPDIR), for it instead.' },
  'branch-delete': { recommend: 'deny', why: 'A deleted branch cannot be brought back from here.', fallback: 'Leave the branch, and say in your report which one can go.' },
  'paid-api': { recommend: 'deny', why: 'It spends money or uses an account that is yours.', fallback: 'Carry on with a local stand-in, and say in your report what needs the paid service.' },
  'message-out': { recommend: 'deny', why: 'It sends something to people outside the company.', fallback: 'Carry on without sending it, and put the message in your report for you to send.' },
  'global-config': { recommend: 'deny', why: 'It changes how Claude Code, git or this computer is set up, and that outlasts the task.', fallback: 'Carry on without the change, and tell your manager what you need.' },
  other: { recommend: 'deny', why: "The office can't tell what this does to your project or your computer, so the careful answer is no unless you know the program.", fallback: "Use the project's own scripts and tools instead." },
};

/** The advice for an ask: by its kind, always a no. A connector is never recommended, whatever its tool is called: the stakeholder allows a server, and then it no longer asks. */
function adviceFor(kind: AskKind, summary: string): ApprovalAdvice {
  const base = ADVICE[kind];
  if (kind === 'other' && /^Stop a program/.test(summary)) {
    return { recommend: 'deny', why: "A stop by name, port or pattern could end somebody else's work. The desk stops what it started by its process id.", fallback: 'Stop only what you started, by its process id, or leave it running and say so in your report.', ifNoAnswer: 'deny' };
  }
  return { ...base, ifNoAnswer: 'deny' };
}

const RECORDS = 'The office keeps its own records in .worklings, and nobody in the company reads or changes them. Leave them as they are.';
const SHARED_COMMIT =
  "This is the company's shared checkout, where a commit would sweep in other people's half-done work. The office commits your task's files for you when you report the task done. Carry on; don't commit here.";
const UNREADABLE = "The office couldn't read this request, so it counts as a no.";
const NO_QUESTIONS = 'Nobody answers that kind of question here. Use ask to put a question to your manager or to the stakeholder.';
/** Kinds whose approvals never offer "Always allow" (docs/design-v3.md, Inbox). */
const NO_ALWAYS: ReadonlySet<AskKind> = new Set(['outside-project', 'branch-delete', 'global-config']);
const DETAIL_LIMIT = 2_000;
const SUMMARY_LIMIT = 140;
/** Commands nested deeper than this ($(...) in $(...) in ..., scripts that run scripts) aren't read; the policy asks. */
const DEPTH_LIMIT = 4;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `sticky`: no Always allow rule lifts it, whatever the company's rules say. */
type Ask = { verdict: 'ask'; kind: AskKind; summary: string; rule: AlwaysRule | null; sticky: boolean };
type Judgement = { verdict: 'allow' } | { verdict: 'deny'; message: string } | Ask;
interface Judged {
  j: Judgement;
  /** The simple command it is about, for rules and the exact Always allow rule. */
  raw: string;
}

const ALLOW: Judgement = { verdict: 'allow' };
const deny = (message: string): Judgement => ({ verdict: 'deny', message });
const ask = (kind: AskKind, summary: string, rule: AlwaysRule | null = null): Judgement => ({
  verdict: 'ask',
  kind,
  summary: oneLine(redactSecrets(summary), SUMMARY_LIMIT),
  rule: NO_ALWAYS.has(kind) ? null : rule,
  sticky: false,
});
/** A change to how Claude Code or git runs in the project: always asked, never lifted by a rule. */
const askSetup = (summary: string): Judgement => ({ ...(ask('global-config', summary) as Ask), sticky: true });
/**
 * The first judgement that isn't an allow: a deny, then an ask no rule lifts (a change to the setup), then any ask; else
 * an allow. A sticky ask comes first so that a rule matching the command can't lift it along with a lesser one.
 */
const first = (...judgements: Judgement[]): Judgement =>
  judgements.find((j) => j.verdict === 'deny') ?? judgements.find((j) => j.verdict === 'ask' && j.sticky) ?? judgements.find((j) => j.verdict === 'ask') ?? ALLOW;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------------------------------
// Where a path is

interface Ctx {
  win: boolean;
  p: typeof win32 | typeof posix;
  root: string;
  /** Where routine work happens: the project and the desk's checkout or worktree. */
  bases: string[];
  /** Where relative paths start; null after a `cd` the policy couldn't follow. */
  cwd: string | null;
  branch: string | null;
  home: string;
  tmp: string;
  /** The office's own records: the project's .worklings and the hub's ~/.worklings. */
  records: string[];
  /** Claude Code's own scratch for this project: task output in the temporary folder, and its memory. */
  scratch: string[];
  /** The desk's own scratch folder, its TMP, TEMP and TMPDIR; null when the office named none. */
  deskScratch: string | null;
  /** The person's own handover notes, the one file under .worklings they may use; null without a person. */
  notes: string | null;
  /**
   * v0.3: the office's records every desk reads, `.worklings-shared/` (the company's brief, the screenshots of the running app):
   * kept as records, so nobody changes them, but read by anyone in the company.
   */
  shared: string;
  /** v0.4: the acceptance tests' folder when this desk is the Tester, who may write there; null for everyone else. */
  acceptance: string | null;
  /** The shell the command runs in, for what its variables and /tmp stand for; null for the file tools. */
  shell: Dialect | null;
  /** Variables the policy stands values for that the command may set itself first (and IFS, which splits them all). */
  moved: ReadonlySet<string>;
  /** Whether the person is Trusted, so routine in-project work goes ahead. */
  trusted: boolean;
  /** The process ids the desk itself started and may stop by number. */
  own: ReadonlySet<number>;
  /** What the command's own text makes safe to stop: its background jobs (`$!`), and ids found by looking a port up. */
  jobs: Jobs;
  /** Variables the command sets more than once (a loop, a subshell, a second value): no value stands for them. */
  multi: Set<string>;
  depth: number;
  pkg: { scripts: Map<string, string>; deps: Set<string> } | null | undefined;
  /** Variables the command sets itself (`for f in src/*.ts`, `DIR=dist`), with a value that stands for each. */
  vars: Map<string, string>;
  /** The file redirected into the command being judged (`patch -p1 < fix.diff`), if any. */
  stdin: string | null;
  platform: NodeJS.Platform;
  /** The files each folder's CLAUDE.md files import, by comparison key: read once per request, shared by its parts. */
  imports: Map<string, Set<string>>;
  /** The folder git runs each base's hooks from when its config moves them (core.hooksPath): read once per request. */
  hooks: Map<string, string | null>;
}

/**
 * Shared by every part of one command (the object is carried by reference through the nested bodies): whether a
 * background job ran yet, the variables set to its id (`PID=$!`), and the variables set to the id of whatever listens on
 * a port (`PID=$(netstat -ano | grep :3918 | awk '{print $5}')`), each with that port.
 */
interface Jobs {
  started: boolean;
  vars: Set<string>;
  /** Files the command wrote the id of its background job into (`echo $! > "$TMPDIR/x.pid"`), by comparison key. */
  files: Set<string>;
}

/** `setup`: inside the project, in a file that changes how Claude Code, git or the editor runs there. */
type Place = 'inside' | 'setup' | 'records' | 'scratch' | 'global' | 'outside' | 'unknown';

/** What runs differently after a change to the project's setup. */
type Runs = 'Claude Code' | 'git' | 'VS Code' | 'npm' | 'yarn' | 'pip';

interface Where {
  place: Place;
  path: string;
  /** For `setup`: what runs differently, and the path from the project (or worktree) folder, with forward slashes. */
  setup?: { runs: Runs; rel: string };
  /** For `unknown`: a name Windows could open as another file (a short name it can't expand, a name of only dots). */
  odd?: true;
}

/**
 * Whether a path inside the project changes how Claude Code, git or VS Code runs there: Claude Code's settings,
 * agents, hooks, commands and skills (.claude/), its instructions (CLAUDE.md), its MCP servers (.mcp.json), git's own
 * folder (hooks, config), husky's hooks, and VS Code's tasks, which it runs by itself when a task says to run as the
 * folder opens; and the package managers' own settings (.npmrc, .yarnrc, .yarnrc.yml, pip.conf, pip.ini), which can point
 * them at another registry, preload code into every script (node-options) or swap the shell scripts run in. Names compare
 * without case: on Windows they are the same files.
 */
function setupOf(parts: readonly string[]): Runs | null {
  const names = parts.map((part) => part.toLowerCase());
  const file = names.at(-1) ?? '';
  if (names.includes('.claude') || file === 'claude.md' || file === 'claude.local.md' || file === '.mcp.json') return 'Claude Code';
  if (names.includes('.git') || names.includes('.husky')) return 'git';
  if (file === '.vscode' || (file === 'tasks.json' && names.at(-2) === '.vscode')) return 'VS Code';
  return packageSetup(file);
}

/** The package manager a settings file of this name (in lower case) changes, or null. */
function packageSetup(file: string): Runs | null {
  if (file === '.npmrc') return 'npm';
  if (file === '.yarnrc' || file === '.yarnrc.yml') return 'yarn';
  if (file === 'pip.conf' || file === 'pip.ini') return 'pip';
  return null;
}

/** Claude Code's name for a project folder in its own folders: every character but letters and digits as "-". */
const encoded = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-');

function inside(p: typeof win32 | typeof posix, base: string, full: string): boolean {
  const rel = p.relative(base, full);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
}

function makeCtx(o: PolicyOptions, payload: Obj): Ctx {
  const platform = o.platform ?? process.platform;
  const win = platform === 'win32';
  const p = win ? win32 : posix;
  // Every folder compared against, as the platform opens it (paths.ts), like every path judged.
  const at = (path: string) => opened(p.resolve(path), platform) ?? p.resolve(path);
  const root = at(o.root);
  const home = at(o.home ?? homedir());
  const tmp = at(o.tmp ?? tmpdir());
  const asked = typeof o.cwd === 'string' && o.cwd !== '' ? at(o.cwd) : null;
  // The payload's cwd is Claude Code's own report: trusted only inside the project.
  const reported = typeof payload.cwd === 'string' && payload.cwd.length < 1_000 && p.isAbsolute(payload.cwd) ? at(payload.cwd) : null;
  const cwd = asked ?? (reported && inside(p, root, reported) ? reported : root);
  const bases = [...new Set([root, cwd])];
  // Never a folder that holds the project, the worktree or the home folder, whatever the office was told.
  const named = typeof o.scratch === 'string' && o.scratch !== '' && p.isAbsolute(o.scratch) ? at(o.scratch) : null;
  const deskScratch = named !== null && ![...bases, home].some((folder) => inside(p, named, folder)) ? named : null;
  return {
    win,
    p,
    root,
    bases,
    cwd,
    branch: typeof o.branch === 'string' && o.branch !== '' ? o.branch : null,
    home,
    tmp,
    records: [p.join(root, '.worklings'), p.join(root, '.worklings-shared'), p.join(home, '.worklings')],
    scratch: bases.flatMap((b) => [p.join(tmp, 'claude', encoded(b)), p.join(home, '.claude', 'projects', encoded(b), 'memory')]),
    deskScratch,
    shared: p.join(root, '.worklings-shared'),
    acceptance: o.acceptance === true ? p.join(root, '.worklings-shared', 'acceptance') : null,
    notes: typeof o.person === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(o.person) ? p.join(root, '.worklings', 'handover', `${o.person}.md`) : null,
    shell: null,
    moved: new Set(),
    trusted: o.leash === 'trusted',
    own: new Set([...(o.ownProcesses ?? [])].filter((pid) => Number.isSafeInteger(pid) && pid > 0)),
    jobs: { started: false, vars: new Set(), files: new Set() },
    multi: new Set(),
    depth: 0,
    pkg: undefined,
    vars: new Map(),
    stdin: null,
    platform,
    imports: new Map(),
    hooks: new Map(),
  };
}

const compareKey = (ctx: Ctx, path: string) => (ctx.win ? path.toLowerCase() : path);

/** Whether a CLAUDE.md or CLAUDE.local.md in `base` imports `full`, so that writing it changes every desk's instructions. */
function importedBy(ctx: Ctx, base: string, full: string): boolean {
  let keys = ctx.imports.get(base);
  if (!keys) {
    keys = new Set(importedFiles(base, { platform: ctx.platform }).map((file) => compareKey(ctx, file)));
    ctx.imports.set(base, keys);
  }
  return keys.has(compareKey(ctx, full));
}

/** A git config value as git reads it: quotes dropped, escapes read, a comment after it cut. */
function configValue(raw: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (c === '\\') {
      const next = raw.charAt(i + 1);
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '#' || c === ';')) break;
    else out += c;
  }
  return out.trim();
}

/** core.hooksPath in a git config's text: the last value in a [core] section, which may follow its header on the line. */
function hooksPathIn(config: string): string | null {
  let core = false;
  let value: string | null = null;
  for (const raw of config.split(/\r?\n/)) {
    let line = raw;
    const header = /^\s*\[([^\]]*)\]/.exec(line);
    if (header) {
      core = /^\s*core\s*$/i.test(header[1] ?? '');
      line = line.slice(header[0].length);
    }
    const set = core ? /^\s*hookspath\s*=(.*)$/i.exec(line) : null;
    if (set) value = configValue(set[1] ?? '');
  }
  return value;
}

/** The folder git runs a checkout's hooks from when its config moves them there (core.hooksPath), or null. */
function hooksFolder(ctx: Ctx, base: string): string | null {
  const known = ctx.hooks.get(base);
  if (known !== undefined) return known;
  const dirs = gitDirs(base, ctx);
  const config = dirs ? readSmall(ctx.p.join(dirs.common, 'config')) : null;
  const value = config === null ? null : hooksPathIn(config);
  // Relative to the checkout git runs the hook in; git reads ~ as the home folder.
  const folder = value ? ctx.p.resolve(base, value.replace(/^~(?=$|[\\/])/, () => ctx.home)) : null;
  const found = folder === null ? null : (opened(folder, ctx.platform) ?? folder);
  ctx.hooks.set(base, found);
  return found;
}

const inHooksFolder = (ctx: Ctx, base: string, full: string): boolean => {
  const folder = hooksFolder(ctx, base);
  return folder !== null && inside(ctx.p, folder, full);
};

const within = (ctx: Ctx, base: string, full: string) => inside(ctx.p, base, full);

function exists(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

/** Whether a folder or file between `base` and `full` is a link, which could lead anywhere. */
const throughLink = (ctx: Ctx, base: string, full: string): boolean => linkBetween(ctx.p, base, full);

/** Settings and secrets for the whole computer, by where they live under the home folder or the system. */
const GLOBAL_IN_HOME = [
  '.claude', '.claude.json', '.gitconfig', '.git-credentials', '.config', '.npmrc', '.yarnrc', '.yarnrc.yml', '.bashrc',
  '.bash_profile', '.profile', '.zshrc', '.zprofile', '.zshenv', '.ssh', '.aws', '.azure', '.docker', '.kube', '.gnupg',
  '.netrc', '.cargo', '.rustup', 'AppData', 'Library', 'Documents/PowerShell', 'Documents/WindowsPowerShell', '.vscode', '.cursor',
];
const GLOBAL_SYSTEM_WIN = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];
const GLOBAL_SYSTEM_POSIX = ['/etc', '/usr', '/bin', '/sbin', '/opt', '/System', '/Library', '/var', '/private/etc'];
const HARMLESS_PATHS = new Set(['/dev/null', '/dev/zero', '/dev/urandom', '/dev/stdout', '/dev/stderr', '/dev/stdin', '/dev/tty', 'nul', 'con', '$null']);

/**
 * The variables the office sets to the desk's own scratch folder (harness.ts, DESK_TEMP_VARIABLES). Not TMP: the desk
 * keeps the machine's TMP, so `$TMP` is the shared temporary folder and is judged as outside the project.
 */
const TEMP_NAMES = ['TMPDIR', 'TEMP'];
/**
 * How each shell reads them. In Bash also the forms that give the variable's own value when it is set, as it always is
 * in a desk: `${TMPDIR:-/tmp}`, `${TMPDIR-x}`, `${TMPDIR:=x}`, `${TMPDIR:?x}`; never `:+` (which gives the other word),
 * a cut or a replacement, or a default holding another expansion.
 */
const OWN_TEMP: Record<Dialect, RegExp> = {
  bash: /^\$(?:TMPDIR|TEMP|\{(?:TMPDIR|TEMP)(?::?[-=?][^}$]*)?\})(?=$|[\\/])/,
  powershell: /^\$(?:env:(?:TMPDIR|TEMP)|\{env:(?:TMPDIR|TEMP)\})(?=$|[\\/])/i,
};

/**
 * A variable the command set itself, where the policy knows its value (`for f in src/*.ts`, `DIR=dist`): `$DIR`, `${DIR}`
 * and the forms that give a set variable's own value, `${DIR:?}`, `${DIR:-x}`, `${DIR:=x}` (and without the colon). A
 * value that is empty, and every form that gives the other word or a cut (`:+`, `#`, `/`), stays as written.
 */
function substitute(raw: string, ctx: Ctx): string {
  // A value may name other variables the command set (`n=${p:-home}`): a few passes settle them.
  let text = raw;
  for (let pass = 0; pass < 3 && /\$[{\w]/.test(text); pass++) {
    const next = text.replace(/\$\{(\w+)(?:(:?[-=?])([^}$`]*))?\}|\$(\w+)/g, (m, braced: string | undefined, op: string | undefined, word: string | undefined, bare: string | undefined) => {
      const value = ctx.vars.get(braced ?? bare ?? '');
      if (value === undefined) return m;
      if (op === undefined || value !== '') return value;
      // Empty: `:-` and `:=` take their word, `-` and `=` leave it empty, `?` stops the command.
      return op.endsWith('?') ? m : op.startsWith(':') ? (word ?? '') : '';
    });
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Expands the home folder and a few known variables; null when the path holds a value the shell works out later. */
function expand(raw: string, ctx: Ctx): string | null {
  if (raw.includes(COMPUTED)) return null;
  // Where the command may set IFS, any value it expands can split into other paths.
  if (ctx.moved.has('IFS') && raw.includes('$')) return null;
  let s = substitute(raw, ctx);
  // PowerShell: `@(...)`, `@{...}` and `@name` (splatting) and `(...)` are values it works out as it runs.
  if (ctx.shell === 'powershell' && /^[@(]/.test(s)) return null;
  s = s.replace(/^~(?=$|[\\/])/, () => ctx.home);
  // Bash reads `~name` as that user's home, `~+` as $PWD and `~-` as $OLDPWD: folders the policy doesn't follow.
  if (ctx.shell === 'bash' && s.startsWith('~')) return null;
  s = s.replace(/^(?:\$HOME|\$\{HOME\}|\$env:(?:USERPROFILE|HOME)|%USERPROFILE%|\$USERPROFILE)(?=$|[\\/])/i, () => ctx.home);
  // In a desk's own shell they name its scratch folder, unless the command sets them itself first.
  const folder = ctx.deskScratch;
  if (folder !== null && ctx.shell !== null && !TEMP_NAMES.some((name) => ctx.moved.has(name))) s = s.replace(OWN_TEMP[ctx.shell], () => folder);
  s = s.replace(/^(?:\$TMPDIR|\$\{TMPDIR\}|\$TEMP|\$TMP|\$env:(?:TEMP|TMP)|%TEMP%|%TMP%)(?=$|[\\/])/i, () => ctx.tmp);
  if (ctx.cwd !== null && !ctx.moved.has('PWD')) s = s.replace(/^(?:\$PWD|\$\{PWD\}|%CD%)(?=$|[\\/])/i, () => ctx.cwd ?? '');
  // Any other variable is unknown until the shell runs.
  if (/\$[A-Za-z_{(]|%[A-Za-z_]+%|\$env:/i.test(s)) return null;
  if (ctx.win) {
    // Git Bash's /c/Users/...
    s = s.replace(/^\/([a-zA-Z])(?=$|\/)/, (_m, drive: string) => `${drive.toUpperCase()}:`);
    // and its /tmp, the user's temporary folder: every Git Bash shares one mount table, so a desk's TMP doesn't move
    // it. To PowerShell and the file tools /tmp is C:\tmp.
    if (ctx.shell === 'bash') s = s.replace(/^\/tmp(?=$|\/)/, () => ctx.tmp);
  }
  return s;
}

/** The part of a path before its first wildcard, so `src/*.ts` is judged as `src`. */
function staticPart(path: string): string {
  const parts = path.split(/[\\/]/);
  const at = parts.findIndex((part) => /[*?[]/.test(part));
  if (at === -1) return path;
  const kept = parts.slice(0, at).join('/');
  return kept === '' ? (/^[\\/]/.test(path) ? '/' : '.') : kept;
}

function placeOf(raw: string, ctx: Ctx): Where {
  if (HARMLESS_PATHS.has(raw.trim().toLowerCase())) return { place: 'inside', path: raw };
  const expanded = expand(raw.trim(), ctx);
  if (expanded === null || expanded === '') return { place: 'unknown', path: raw };
  // A wildcard followed by `..` matches folders the path then climbs out of (`src/*/../../../x`), and a brace list is
  // several paths: where either is, the shell works the path out later.
  const pieces = expanded.split(/[\\/]/);
  const wild = pieces.findIndex((part) => /[*?[]/.test(part));
  if ((wild !== -1 && pieces.slice(wild + 1).includes('..')) || (ctx.shell === 'bash' && expanded.includes('{'))) return { place: 'unknown', path: raw };
  const target = staticPart(expanded);
  if (!ctx.p.isAbsolute(target) && ctx.cwd === null) return { place: 'unknown', path: raw };
  // On Windows a POSIX path such as /usr/bin that isn't a drive is in Git Bash's own folders: outside.
  if (ctx.win && /^\/(?![a-zA-Z](?:$|\/))/.test(target)) return { place: 'outside', path: raw };
  // Judged as the platform will open it: ".claude./x", "CLAUDE.md:evil" and CLAUD~1.MD are what they stand for.
  const resolved = ctx.p.resolve(ctx.cwd ?? ctx.root, target);
  const full = opened(resolved, ctx.platform);
  if (full === null) return { place: 'unknown', path: resolved, odd: true };
  // The person's own handover notes: exactly that file, whichever folder the desk works in.
  if (ctx.notes !== null && compareKey(ctx, full) === compareKey(ctx, ctx.notes) && !throughLink(ctx, ctx.root, full)) return { place: 'inside', path: full };
  for (const base of ctx.bases) {
    if (!within(ctx, base, full)) continue;
    const parts = ctx.p.relative(base, full).split(ctx.p.sep).filter(Boolean);
    if (parts.some((part) => part.toLowerCase() === '.worklings' || part.toLowerCase() === '.worklings-shared')) return { place: 'records', path: full };
    if (throughLink(ctx, base, full)) return { place: 'outside', path: full };
    const runs = setupOf(parts) ?? (importedBy(ctx, base, full) ? 'Claude Code' : null) ?? (inHooksFolder(ctx, base, full) ? 'git' : null);
    return runs ? { place: 'setup', path: full, setup: { runs, rel: parts.join('/') } } : { place: 'inside', path: full };
  }
  if (ctx.records.some((r) => within(ctx, r, full))) return { place: 'records', path: full };
  // The desk's own scratch folder, unless a link on the way leads somewhere else.
  if (ctx.deskScratch !== null && within(ctx, ctx.deskScratch, full)) {
    return throughLink(ctx, ctx.deskScratch, full) ? { place: 'outside', path: full } : { place: 'scratch', path: full };
  }
  if (ctx.scratch.some((s) => within(ctx, s, full))) return { place: 'scratch', path: full };
  // The temporary folder is outside the project, not a setting, though on Windows it lies under AppData.
  if (within(ctx, ctx.tmp, full)) return { place: 'outside', path: full };
  const system = ctx.win ? GLOBAL_SYSTEM_WIN : GLOBAL_SYSTEM_POSIX;
  if (GLOBAL_IN_HOME.some((g) => within(ctx, ctx.p.join(ctx.home, g), full)) || system.some((g) => within(ctx, ctx.p.resolve(g), full))) {
    return { place: 'global', path: full };
  }
  return { place: 'outside', path: full };
}

/** A path as the stakeholder reads it: under ~ when it is in the home folder, and its end kept when it is long. */
function shown(path: string, ctx: Ctx): string {
  const full = ctx.p.isAbsolute(path) ? path : ctx.p.resolve(ctx.cwd ?? ctx.root, path);
  const rel = within(ctx, ctx.home, full) ? ctx.p.relative(ctx.home, full).replaceAll('\\', '/') : null;
  const text = rel === null ? full : rel === '' ? '~' : `~/${rel}`;
  const line = text.replace(/\s+/g, ' ');
  return line.length > 90 ? `…${line.slice(-89)}` : line;
}

/** Where programs are installed: their names and whether they are there are no secret, so `ls` and `stat` may look. */
const PROGRAM_FOLDERS_WIN = ['C:\\Program Files', 'C:\\Program Files (x86)'];
const PROGRAM_FOLDERS_POSIX = ['/usr', '/opt', '/bin', '/sbin', '/Applications'];

/** Whether a path is in a folder of installed programs, for a program that only lists names (`ls`, `stat`, `Test-Path`). */
function inProgramFolder(path: string, ctx: Ctx): boolean {
  return (ctx.win ? PROGRAM_FOLDERS_WIN : PROGRAM_FOLDERS_POSIX).some((folder) => within(ctx, ctx.p.resolve(folder), path));
}

/**
 * PowerShell reads an unquoted comma as an array (`Remove-Item src,..\..\x`, `$a = ,'x'`), and the reader keeps no quotes, so
 * in PowerShell each piece of a word with a comma is judged as a path of its own: the paths it names, or null for a word
 * without one. A piece that still holds a variable is a value worked out as it runs.
 */
function commaPieces(raw: string, ctx: Ctx): string[] | null {
  if (ctx.shell !== 'powershell') return null;
  const text = substitute(raw.trim(), ctx);
  if (!text.includes(',')) return null;
  const pieces = text.split(',').map((piece) => piece.trim()).filter((piece) => piece !== '');
  return pieces.length === 0 ? [COMPUTED] : pieces.map((piece) => (piece.includes('$') ? COMPUTED : piece));
}

function readPath(raw: string, ctx: Ctx, verb = 'Read', names = false): Judgement {
  const pieces = commaPieces(raw, ctx);
  if (pieces !== null) return first(...pieces.map((piece) => readPath(piece, ctx, verb, names)));
  const { place, path, odd } = placeOf(raw, ctx);
  if (place === 'inside' || place === 'setup' || place === 'scratch') return ALLOW;
  // The records the office shares with every desk (the brief, the screenshots of the app) may be read, not through a link.
  if (place === 'records' && within(ctx, ctx.shared, path) && !throughLink(ctx, ctx.root, path)) return ALLOW;
  if (names && (place === 'outside' || place === 'global') && inProgramFolder(path, ctx)) return ALLOW;
  if (place === 'records') return deny(RECORDS);
  if (place === 'unknown') return ask('other', odd ? `${verb} ${shown(path, ctx)}, a name Windows could open as another file` : `${verb} a file whose name it works out as it runs`);
  return ask('outside-project', `${verb} ${shown(path, ctx)}, outside the project`);
}

/** How a setup change reads after "Change how Claude Code runs in this project: ". */
const SETUP_VERBS: Record<string, string> = { Delete: 'delete ', Move: 'move ', Rename: 'rename ', 'Make a link at': 'a link at ' };

function writePath(raw: string, ctx: Ctx, verb = 'Change'): Judgement {
  const pieces = commaPieces(raw, ctx);
  if (pieces !== null) return first(...pieces.map((piece) => writePath(piece, ctx, verb)));
  const where = placeOf(raw, ctx);
  const { place, path } = where;
  if (place === 'setup' && where.setup) return askSetup(`Change how ${where.setup.runs} runs in this project: ${SETUP_VERBS[verb] ?? ''}${where.setup.rel}`);
  // Deleting the project or worktree folder itself, or all of it by `*` (PowerShell's matches .claude), takes .claude
  // and .git with it.
  const whole = !/[*?[]/.test(raw) || /(?:^|[\\/])\*$/.test(raw.trim());
  if (place === 'inside' && verb === 'Delete' && whole && ctx.bases.some((b) => ctx.p.relative(b, path) === '')) {
    return askSetup('Delete the project folder itself, its .claude and .git included');
  }
  if (place === 'inside' || place === 'scratch') return ALLOW;
  // The Tester's acceptance tests, the one shared record a desk writes: inside that folder only, never through a link.
  if (place === 'records' && ctx.acceptance !== null && within(ctx, ctx.acceptance, path) && !throughLink(ctx, ctx.root, path)) return ALLOW;
  if (place === 'records') return deny(RECORDS);
  if (place === 'unknown') return ask('other', where.odd ? `${verb} ${shown(path, ctx)}, a name Windows could open as another file` : `${verb} a file whose name it works out as it runs`);
  if (place === 'global') return ask('global-config', `${verb} ${shown(path, ctx)}, a setting for the whole computer`);
  return ask('outside-project', `${verb} ${shown(path, ctx)}, outside the project`);
}

/** Words that may be paths leaving the folder: absolute, home-based or climbing out with "..". */
function looksOutside(word: string): boolean {
  if (word.includes('://')) return false;
  return /^(?:~|\$HOME|\$env:|%USERPROFILE%|\/|\\\\|[A-Za-z]:[\\/])/i.test(word) || /(^|[\\/])\.\.([\\/]|$)/.test(word);
}

/**
 * What a word may name: the word itself, or for an option the value it carries: after `=` (`--out=x`), after `:` in
 * PowerShell's `-Path:x`, and attached to a short option (`-o.git/hooks/x`, `-uhttp://host`). Some of these are no
 * path at all (`-rf` gives `f`); each is judged as the path it would be, so only one that leaves the project or names
 * its setup makes a difference.
 */
function optionValues(arg: string): string[] {
  if (!arg.startsWith('-')) return [arg];
  const values: string[] = [];
  if (arg.includes('=')) values.push(arg.slice(arg.indexOf('=') + 1));
  if (arg.startsWith('--')) return values;
  const named = /^-[A-Za-z][\w-]*:([\s\S]+)$/.exec(arg)?.[1];
  if (named !== undefined) values.push(named);
  if (arg.length > 2) values.push(arg.slice(2));
  return values.filter((v) => v !== '');
}

/** This computer's own addresses, which only programs on it reach. */
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i;

/** The host of an address a program listens on (`0.0.0.0:8000`, `[::]:9229`, `tcp://0.0.0.0:3000`, `localhost`), or null for a port alone. */
function listenHost(value: string): string | null {
  const v = value.replace(/^[a-z]+:\/\//i, '').replace(/\/[\s\S]*$/, '');
  if (/^\d+$/.test(v)) return null;
  const bracketed = /^(\[[^\]]*\])(?::\d*)?$/.exec(v);
  if (bracketed) return bracketed[1] ?? v;
  const host = v.split(':').length > 2 ? v : v.replace(/:\d*$/, '');
  // `:8000` names no host, which servers read as every interface.
  return host === '' ? '0.0.0.0' : host;
}

/**
 * A server or debugger told to listen beyond this computer, in a sentence, or null: node's `--inspect=0.0.0.0:9229` (and
 * `-brk`, `-wait`, `-port`; whoever reaches the port runs code here), `--host`, `--hostname`, `--bind`, `--ip` and
 * `--listen` with an address that isn't this computer's, `--host` with no address (vite and astro: every interface), and
 * Django's `runserver 0.0.0.0:8000`. The rule python's http.server has always had, for every server. `-H` is a host only
 * to some programs (`grep -H`, `mysql -H` mean other things), so serverJudge reads it for those.
 */
function listensWide(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const next = args[i + 1];
    const inspect = /^--(?:inspect(?:-brk|-wait|-port)?|debug-port)(?:=([\s\S]*))?$/.exec(a);
    if (inspect) {
      const value = inspect[1] ?? (/-port$/.test(a) ? next : undefined);
      const host = value === undefined ? null : listenHost(value);
      if (host !== null && !LOOPBACK.test(host)) return `Open a debugger on ${host}, which lets other computers run code on this one`;
      continue;
    }
    const flag = /^(--host|--hostname|--bind|--ip|--listen)(?:=([\s\S]*))?$/.exec(a);
    if (flag) {
      const value = flag[2] ?? (next !== undefined && !next.startsWith('-') ? next : undefined);
      if (value === undefined) {
        if (flag[1] === '--host') return 'Serve the project on every network the computer is on (--host with no address)';
        continue;
      }
      const host = listenHost(value);
      if (host !== null && !LOOPBACK.test(host)) return `Serve the project on ${host}, which other computers on the network can reach`;
      continue;
    }
    if (a === 'runserver' && next !== undefined && !next.startsWith('-')) {
      const host = listenHost(next);
      if (host !== null && !LOOPBACK.test(host)) return `Serve the project on ${host}, which other computers on the network can reach`;
    }
  }
  return null;
}

/** Static servers that listen on every interface unless given an address, with the options that give it. */
const WIDE_BY_DEFAULT: ReadonlyMap<string, readonly string[]> = new Map([
  ['serve', ['-l', '--listen']],
  ['http-server', ['-a']],
  ['live-server', ['--host']],
  ['five-server', ['--host']],
  ['browser-sync', ['--listen']],
  ['light-server', ['-b', '--bind']],
]);
/** Programs whose `-H` is the address they listen on (`next dev -H`, `gatsby develop -H`). */
const H_IS_HOST = new Set(['next', 'gatsby']);

/**
 * A server program's own way of listening beyond this computer: a static server (WIDE_BY_DEFAULT) asks unless every address
 * it is given is loopback (`serve -l tcp://127.0.0.1:3000`, `http-server -a 127.0.0.1`; a port alone keeps every interface),
 * and `-H` with an address that isn't loopback for the programs where `-H` is the host.
 */
function serverJudge(tool: string, args: readonly string[], rule: AlwaysRule | null): Judgement {
  if (H_IS_HOST.has(tool)) {
    const wide = [...flagValues(args, ['-H']), ...args.filter((a) => /^-H./.test(a)).map((a) => a.slice(2).replace(/^=/, ''))]
      .map(listenHost)
      .find((h): h is string => h !== null && !LOOPBACK.test(h));
    return wide === undefined ? ALLOW : ask('other', `Serve the project on ${wide}, which other computers on the network can reach`, rule);
  }
  const flags = WIDE_BY_DEFAULT.get(tool);
  if (flags === undefined) return ALLOW;
  const given = flagValues(args, flags).map(listenHost);
  if (given.length > 0 && given.every((h) => h !== null && LOOPBACK.test(h))) return ALLOW;
  return ask('other', `Serve the project on every network the computer is on (${tool} listens on all of them unless given 127.0.0.1)`, rule);
}

/**
 * Checks the words of an allowed tool that point outside the folder (`eslint ../other`, `--out=C:\elsewhere`, `-o../x`), and
 * that it doesn't listen beyond this computer (listensWide).
 */
function argsStayInside(args: readonly string[], ctx: Ctx): Judgement {
  const judgements: Judgement[] = [];
  const wide = listensWide(args);
  if (wide !== null) judgements.push(ask('other', wide));
  for (const arg of args) {
    for (const value of optionValues(arg)) {
      if (!value.startsWith('-') && looksOutside(value)) judgements.push(readPath(value, ctx, 'Use'));
    }
  }
  return first(...judgements);
}

// ---------------------------------------------------------------------------------------------------------------------
// The project's package.json and git

function packageOf(ctx: Ctx): { scripts: Map<string, string>; deps: Set<string> } | null {
  if (ctx.pkg !== undefined) return ctx.pkg;
  ctx.pkg = null;
  const file = ctx.p.join(ctx.cwd ?? ctx.root, 'package.json');
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? Number.POSITIVE_INFINITY) > 1024 * 1024) return null;
    const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isObj(json)) return null;
    const scripts = new Map<string, string>();
    if (isObj(json.scripts)) for (const [k, v] of Object.entries(json.scripts)) if (typeof v === 'string') scripts.set(k, v);
    const deps = new Set<string>();
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const list = json[key];
      if (isObj(list)) for (const name of Object.keys(list)) deps.add(name);
    }
    ctx.pkg = { scripts, deps };
  } catch {
    // No package.json, or not one the policy can read: no scripts and no dependencies.
  }
  return ctx.pkg;
}

/** A program the project installs (node_modules/.bin), so running it is the project's own command. */
function projectBin(name: string, ctx: Ctx): boolean {
  if (!/^[\w.@-]{1,100}$/.test(name)) return false;
  const bin = ctx.p.join(ctx.cwd ?? ctx.root, 'node_modules', '.bin');
  return [name, `${name}.cmd`, `${name}.exe`].some((n) => {
    try {
      return statSync(ctx.p.join(bin, n), { throwIfNoEntry: false })?.isFile() === true;
    } catch {
      return false;
    }
  });
}

const MAX_GIT_FILE = 64 * 1024;

function readSmall(file: string): string | null {
  try {
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > MAX_GIT_FILE) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The git folder for `dir`, and the one that holds its config (a worktree keeps its own HEAD; the config is shared). */
function gitDirs(dir: string, ctx: Ctx): { git: string; common: string } | null {
  let at = dir;
  for (let i = 0; i < 64; i++) {
    const dotGit = ctx.p.join(at, '.git');
    let stat;
    try {
      stat = lstatSync(dotGit, { throwIfNoEntry: false });
    } catch {
      return null;
    }
    if (stat?.isDirectory()) return { git: dotGit, common: dotGit };
    if (stat?.isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readSmall(dotGit) ?? '')?.[1]?.trim();
      if (!pointer) return null;
      const git = ctx.p.resolve(at, pointer);
      const common = readSmall(ctx.p.join(git, 'commondir'))?.trim();
      return { git, common: common ? ctx.p.resolve(git, common) : git };
    }
    const up = ctx.p.dirname(at);
    if (up === at) return null;
    at = up;
  }
  return null;
}

function currentBranch(dir: string, ctx: Ctx): string | null {
  const dirs = gitDirs(dir, ctx);
  const head = dirs ? readSmall(ctx.p.join(dirs.git, 'HEAD')) : null;
  return head ? (/^ref:\s*refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim() ?? null) : null;
}

const HOST_NAMES: [RegExp, string][] = [
  [/(^|\.)github\.com$/i, 'GitHub'],
  [/(^|\.)gitlab\.com$/i, 'GitLab'],
  [/(^|\.)bitbucket\.org$/i, 'Bitbucket'],
  [/(^|\.)(dev\.azure|visualstudio)\.com$/i, 'Azure DevOps'],
  [/(^|\.)codeberg\.org$/i, 'Codeberg'],
];

/** Where a remote lives, as a name ("GitHub") or a host, from the repository's config. */
function remoteHost(dir: string, remote: string, ctx: Ctx): string | null {
  const dirs = gitDirs(dir, ctx);
  const config = dirs ? readSmall(ctx.p.join(dirs.common, 'config')) : null;
  if (!config) return null;
  const section = new RegExp(`\\[remote "${remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]([^[]*)`).exec(config)?.[1] ?? '';
  const url = /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1]?.trim();
  if (!url) return null;
  const host = /^[\w.+-]+:\/\/(?:[^@/]+@)?([^/:]+)/.exec(url)?.[1] ?? /^(?:[^@/]+@)?([^:/]+):/.exec(url)?.[1] ?? null;
  if (!host) return null;
  return HOST_NAMES.find(([re]) => re.test(host))?.[1] ?? host;
}

// ---------------------------------------------------------------------------------------------------------------------
// Programs

/** Positional words, past the flags; a flag in `valued` takes the next word as its value. */
function positionals(args: readonly string[], valued: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (valued.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

const has = (args: readonly string[], ...flags: string[]) => args.some((a) => flags.includes(a) || flags.some((f) => f.startsWith('--') && a.startsWith(`${f}=`)));
/** The word after the first of `flags`, when there is one. */
const valueOf = (args: readonly string[], ...flags: string[]) => {
  const at = args.findIndex((a) => flags.includes(a));
  return at === -1 ? undefined : args[at + 1];
};

const MAX_PATCH = 1024 * 1024;

/** The files a patch changes, from its headers; null when the patch can't be read here (missing, too big, outside). */
function patchTargets(file: string, ctx: Ctx): string[] | null {
  const where = placeOf(file, ctx);
  if (where.place !== 'inside' && where.place !== 'setup' && where.place !== 'scratch') return null;
  let text: string;
  try {
    const stat = statSync(where.path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > MAX_PATCH) return null;
    text = readFileSync(where.path, 'utf8');
  } catch {
    return null;
  }
  const targets = new Set<string>();
  const header = /^(?:diff --git a\/(\S+) b\/(\S+)|\+\+\+ (\S+)|--- (\S+)|(?:rename|copy) (?:from|to) (\S+))/gm;
  for (const m of text.matchAll(header)) {
    for (const path of m.slice(1)) {
      if (path && path !== '/dev/null') targets.add(path.replace(/^[ab]\//, ''));
    }
  }
  return [...targets];
}

/** Applying patches is writing the files they name; a patch the policy can't read asks. */
function patchJudge(files: readonly string[], ctx: Ctx, raw: string): Judgement {
  const unreadable = ask('other', "Apply a patch the office can't read first", exactRule('Bash', raw));
  if (files.length === 0 || files.includes('-')) return unreadable;
  const judgements: Judgement[] = [];
  for (const file of files) {
    judgements.push(readPath(file, ctx));
    const targets = patchTargets(file, ctx);
    if (targets === null) judgements.push(unreadable);
    else judgements.push(...targets.map((t) => writePath(t, ctx)));
  }
  return first(...judgements);
}

/** An exact-command rule: offered only for one simple command that holds no secret. */
function exactRule(tool: string, raw: string): AlwaysRule | null {
  const command = raw.replace(/\s+/g, ' ').trim();
  if (command === '' || command.length > 200 || redactSecrets(command) !== command || /[()]/.test(command)) return null;
  return { rule: `${tool}(${command})`, sentence: `${command}, exactly as written` };
}

const SWITCHES = ['-b', '-B', '-c', '-C', '--orphan'];

/** Environment variables that, set before a command, can make git or another program run code of the setter's choosing. */
const DANGEROUS_ENV = new Set([
  'PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'BASH_ENV', 'ENV',
  'PAGER', 'GIT_PAGER', 'EDITOR', 'VISUAL', 'GIT_EDITOR', 'LESSOPEN', 'LESSCLOSE', 'PYTHONSTARTUP', 'PYTHONPATH', 'PERL5OPT',
  'PERL5LIB', 'RUBYOPT', 'RUBYLIB', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY', 'CURL_HOME', 'WGETRC', 'CDPATH',
  'BROWSER', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS',
]);
/**
 * Those, plus whole families: GIT_* (GIT_CONFIG_COUNT/KEY/VALUE point git's config at a command), PYTHON* (PYTHONBREAKPOINT
 * names a function `breakpoint()` calls, PYTHONSTARTUP and PYTHONPATH load code), npm_config_* in any case (node-options,
 * script-shell, registry, userconfig: npm and pnpm read every setting from one), and YARN_* and PIP_* (yarn's yarnPath runs
 * a file, pip's index and config files) for the same reason.
 */
function dangerousEnv(name: string): boolean {
  const n = name.toUpperCase();
  return /^(?:GIT_|PYTHON|NPM_CONFIG_|YARN_|PIP_)/.test(n) || DANGEROUS_ENV.has(n);
}

/** The value after `flag`, whether given as `--flag value` or `--flag=value` (or `-O<value>` attached). */
function optionValue(rest: readonly string[], at: number, flag: string): string | undefined {
  const a = rest[at] ?? '';
  if (a === flag) return rest[at + 1];
  if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  return undefined;
}

/** Git options that write a file (--output, --output-directory, -o) or run a program (-O pager, --ext-diff). */
function gitRestOptions(rest: readonly string[], ctx: Ctx, rule: AlwaysRule | null): Judgement {
  const checks: Judgement[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? '';
    const out = optionValue(rest, i, '--output') ?? optionValue(rest, i, '--output-directory') ?? optionValue(rest, i, '-o');
    if (out !== undefined) checks.push(writePath(out, ctx, 'Write'));
    if (a === '-O' || (a.startsWith('-O') && a.length > 2) || a === '--open-files-in-pager' || a.startsWith('--open-files-in-pager=')) {
      checks.push(ask('other', 'Run git with a pager program of its own (git -O)', rule));
    }
    if (a === '--ext-diff') checks.push(ask('other', 'Run git with the external diff program its config names (git --ext-diff)', rule));
  }
  return first(...checks);
}

/**
 * Whether a `git merge` merges the person's own task branch into the work branch: the desk works in its task's worktree
 * (outside the project), whose branch is the company's task branch, and the merge runs where the work branch is checked
 * out with that one branch named.
 */
function mergesOwnTaskBranch(rest: readonly string[], here: string, ctx: Ctx): boolean {
  if (ctx.branch === null || ctx.cwd === null || within(ctx, ctx.root, ctx.cwd)) return false;
  const own = currentBranch(ctx.cwd, ctx);
  if (own === null || !own.startsWith(`${ctx.branch}--`)) return false;
  const named = positionals(rest, new Set(['-m', '--message', '-F', '--file', '-s', '--strategy', '-X', '--strategy-option']));
  return currentBranch(here, ctx) === ctx.branch && named.length === 1 && named[0] === own;
}

/** Putting files back from git throws away what is in them now: asked when a name is the project, a folder, a wildcard or `.`. */
function discards(paths: readonly string[], ctx: Ctx, rule: AlwaysRule | null): Judgement {
  const wide = paths.some((p) => {
    if (/[*?[]/.test(p) || p === '.' || p === '..' || /^\.{1,2}[\\/]*$/.test(p)) return true;
    const where = placeOf(p, ctx);
    if (where.place === 'unknown') return true;
    try {
      return statSync(where.path).isDirectory();
    } catch {
      return false;
    }
  });
  return wide ? ask('other', "Throw away the uncommitted changes in whole folders (git checkout or git restore)", rule) : ALLOW;
}

function gitJudge(args: string[], ctx: Ctx, raw: string): Judgement {
  let dir = ctx.cwd;
  let i = 0;
  const checks: Judgement[] = [];
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    const a = args[i] ?? '';
    if (a === '-C') {
      const target = args[i + 1] ?? '';
      checks.push(readPath(target, ctx));
      const expanded = expand(target, ctx);
      dir = expanded === null || dir === null ? null : ctx.p.resolve(dir, expanded);
      i += 2;
      continue;
    }
    if (a === '-c') return ask('other', 'Run git with one of its settings changed for this command', exactRule('Bash', raw));
    // --exec-path=<dir> makes git run its subcommands from <dir>; --config-env reads a setting from an environment
    // variable, which another assignment can fill with a command (core.fsmonitor and the like).
    if (a.startsWith('--exec-path=')) return ask('other', 'Run git with its own programs taken from another folder (git --exec-path)', exactRule('Bash', raw));
    if (a === '--config-env' || a.startsWith('--config-env=')) return ask('other', 'Run git with a setting read from an environment variable (git --config-env)', exactRule('Bash', raw));
    if (a.startsWith('--git-dir') || a.startsWith('--work-tree')) checks.push(readPath(a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[++i] ?? ''), ctx));
    i++;
  }
  const at = first(...checks);
  if (at.verdict !== 'allow') return at;
  const sub = args[i];
  const rest = args.slice(i + 1);
  const pos = positionals(rest);
  const here = dir ?? ctx.root;
  const rule = exactRule('Bash', raw);
  // Options that write a file or run a program, whatever the subcommand: git log --output=, git grep -O<pager>, the
  // external diff a repository's config names.
  const option = gitRestOptions(rest, ctx, rule);
  if (option.verdict !== 'allow') return option;
  // Trusted: git housekeeping in the person's own worktree, which holds only their task's work (in the shared checkout
  // stash, reset and clean reach everyone's changes, so they still ask there).
  const ownWorktree = ctx.trusted && !within(ctx, ctx.root, here);
  switch (sub) {
    case undefined: case 'status': case 'diff': case 'log': case 'show': case 'blame': case 'shortlog': case 'describe': case 'rev-parse':
    case 'rev-list': case 'ls-files': case 'ls-tree': case 'cat-file': case 'grep': case 'show-ref': case 'name-rev': case 'merge-base':
    case 'whatchanged': case 'count-objects': case 'check-ignore': case 'check-attr': case 'var': case 'help': case 'version':
    case 'show-branch': case 'range-diff': case 'fsck': case 'gc': case 'format-patch': case 'notes':
    case 'tag':
      return ALLOW;
    case 'request-pull':
      // It asks the address it is given for its branches (git ls-remote), and the address can carry data out.
      return ask('other', `Contact ${oneLine(pos[1] ?? 'another repository', 60)} to write a pull request summary (git request-pull)`, rule);
    case 'maintenance':
      // `run` tidies this repository; register, start and the rest write the user's git config and schedule tasks.
      return pos[0] === 'run' ? ALLOW : ask('global-config', `Schedule git's upkeep on the whole computer (git maintenance${pos[0] ? ` ${oneLine(pos[0], 20)}` : ''})`);
    case 'add':
      // Staging changes no file.
      return ALLOW;
    case 'rm': case 'mv':
      return first(...pos.map((p) => writePath(p, ctx, sub === 'rm' ? 'Delete' : 'Move')));
    case 'restore':
      // Only the index (--staged) changes no file; the working tree is written otherwise, and a folder at once discards its work.
      return has(rest, '--staged', '-S') && !has(rest, '--worktree', '-W') ? ALLOW : first(discards(pos, ctx, rule), ...pos.map((p) => writePath(p, ctx)));
    case 'apply': case 'am':
      if (sub === 'apply' && has(rest, '--check', '--stat', '--numstat', '--summary') && !has(rest, '--apply')) return ALLOW;
      if (sub === 'am' && has(rest, '--abort', '--quit', '--skip', '--continue', '--show-current-patch')) return ALLOW;
      return patchJudge(pos.length > 0 ? pos : ctx.stdin ? [ctx.stdin] : [], ctx, raw);
    case 'commit': case 'revert': {
      // The shared checkout is the project itself; a task's own worktree is a folder of its own, outside it. A commit
      // in the shared checkout carries along whatever anyone else has staged or changed, so the office makes it instead.
      if (sub === 'commit' && within(ctx, ctx.root, here)) return deny(SHARED_COMMIT);
      if (sub === 'commit' && has(rest, '--no-verify', '-n')) return ask('other', "Commit without running the project's own git hooks", rule);
      if (ctx.branch === null) return ask('other', 'Commit, though the company has no work branch to commit on', rule);
      const current = currentBranch(here, ctx);
      const ok = current !== null && (current === ctx.branch || current.startsWith(`${ctx.branch}--`));
      return ok ? ALLOW : ask('other', `Commit on ${current ?? 'a detached HEAD'} instead of the work branch ${ctx.branch}`, rule);
    }
    case 'reflog':
      return pos[0] === 'expire' || pos[0] === 'delete' ? ask('other', "Rewrite git's record of where branches have been", rule) : ALLOW;
    case 'branch': {
      const names = positionals(rest, new Set(['-u', '--set-upstream-to', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format']));
      // Short options may come together (-Df).
      const short = (letters: RegExp) => rest.some((a) => /^-[A-Za-z]{2,}$/.test(a) && letters.test(a));
      if (has(rest, '-d', '-D', '--delete') || short(/[dD]/)) return ask('branch-delete', names.length === 1 ? `Delete the branch ${names[0]}` : `Delete the branches ${names.join(', ')}`);
      // Moving a branch to another commit rewrites it as git reset does, for every checkout that has it.
      if (has(rest, '-f', '--force') || short(/f/)) return ask('other', 'Move a branch to another commit (git branch --force)', rule);
      if (has(rest, '-m', '-M', '--move', '-c', '-C', '--copy')) return ask('other', 'Rename or copy a branch', rule);
      if (has(rest, '-u', '--set-upstream-to', '--unset-upstream', '--edit-description')) return ask('other', 'Change where a branch pushes and pulls', rule);
      return ALLOW;
    }
    case 'checkout': case 'switch': {
      if (sub === 'checkout' && rest.includes('--')) return first(discards(rest.slice(rest.indexOf('--') + 1), ctx, rule), ...rest.slice(rest.indexOf('--') + 1).map((p) => writePath(p, ctx)));
      // A name in the project's setup is a file put back from git, even one the checkout has lost: never a branch.
      if (pos.some((w) => placeOf(w, ctx).place === 'setup')) return first(...pos.map((p) => writePath(p, ctx)));
      const made = has(rest, ...SWITCHES);
      const target = (made ? valueOf(rest, ...SWITCHES) : positionals(rest)[0]) ?? '';
      if (!made && !has(rest, '--detach') && target !== '' && currentBranch(here, ctx) === target) return ALLOW;
      // Files named after checkout put their committed version back: an edit in the project.
      if (!made && sub === 'checkout' && pos.length > 0 && pos.every((w) => exists(ctx.p.resolve(here, w)))) return first(discards(pos, ctx, rule), ...pos.map((p) => writePath(p, ctx)));
      return ask('other', `Switch the shared checkout to ${target || 'another branch'}, under everyone's feet`, rule);
    }
    case 'stash':
      return pos[0] === 'list' || pos[0] === 'show' || ownWorktree ? ALLOW : ask('other', "Put the checkout's uncommitted changes aside, everyone's included (git stash)", rule);
    case 'reset': {
      if (ownWorktree) return ALLOW;
      if (has(rest, '--hard', '--merge', '--keep')) return ask('other', 'Throw away uncommitted changes in the checkout (git reset)', rule);
      // Unstaging, or unstaging named files, is routine; moving the branch to another commit is not.
      const before = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
      const refs = positionals(before);
      return refs.length === 0 || refs.every((w) => exists(ctx.p.resolve(here, w))) ? ALLOW : ask('other', 'Move the branch to another commit (git reset)', rule);
    }
    case 'clean':
      return has(rest, '-n', '--dry-run') || ownWorktree ? ALLOW : ask('other', "Delete the untracked files in the checkout, everyone's new files included (git clean)", rule);
    case 'merge': case 'rebase': case 'cherry-pick': {
      if (has(rest, '--abort', '--quit', '--skip') || ownWorktree) return ALLOW;
      // Trusted may merge their own task branch into the work branch.
      if (sub === 'merge' && ctx.trusted && mergesOwnTaskBranch(rest, here, ctx)) return ALLOW;
      return ask('other', `Rewrite the branch with git ${sub}`, rule);
    }
    case 'pull':
      return ask('other', `Pull from ${pos[0] ?? 'its remote'} into the checkout`, rule);
    case 'fetch': {
      const remote = pos[0] ?? 'origin';
      const where = remoteHost(here, remote, ctx);
      return ask('other', `Fetch from ${remote}${where ? ` (${where})` : ''}`, { rule: `Bash(git fetch ${remote}:*)`, sentence: `any git fetch from ${remote}` });
    }
    case 'push': {
      const named = positionals(rest, new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']));
      const remote = named[0] ?? null;
      const refs = named.slice(1);
      const where = remoteHost(here, remote ?? 'origin', ctx);
      if (has(rest, '--delete', '-d') || refs.some((r) => r.startsWith(':'))) {
        const gone = refs.map((r) => r.replace(/^:/, '')).join(', ');
        return ask('branch-delete', `Delete ${gone || 'a branch'} on ${where ?? remote ?? 'its remote'}`);
      }
      const force = has(rest, '--force', '-f', '--force-with-lease', '--mirror', '--force-if-includes') || refs.some((r) => r.startsWith('+'));
      const current = currentBranch(here, ctx);
      const pushed = refs.length === 1 ? (refs[0] ?? '').replace(/^\+/, '').split(':')[0] : refs.length === 0 ? current : null;
      const what = has(rest, '--tags') ? 'the tags' : ctx.branch !== null && pushed === ctx.branch ? 'the work branch' : refs.length > 0 ? refs.join(', ') : (current ?? 'the current branch');
      const to = where ? ` to ${where}` : remote ? ` to ${remote}` : '';
      const always: AlwaysRule | null = force ? null : remote ? { rule: `Bash(git push ${remote}:*)`, sentence: `any git push to ${remote}` } : { rule: 'Bash(git push:*)', sentence: 'any git push' };
      return ask('push', `${force ? 'Force-push' : 'Push'} ${what}${to}`, always);
    }
    case 'remote':
      return pos.length === 0 || pos[0] === 'show' || pos[0] === 'get-url' ? ALLOW : ask('other', 'Change where git pushes and fetches (git remote)', rule);
    case 'config': {
      if (has(rest, '--global', '--system')) return ask('global-config', "Change git's settings for the whole computer");
      const reads = has(rest, '--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin', '--get-urlmatch');
      const edits = has(rest, '--unset', '--unset-all', '--add', '--replace-all', '--rename-section', '--remove-section', '-e', '--edit');
      // The repository's own settings can name hooks, aliases and programs git runs later (core.hooksPath and the like).
      return reads || (pos.length <= 1 && !edits) ? ALLOW : askSetup(`Change how git runs in this project: git config ${oneLine(pos[0] ?? '', 40)}`.trim());
    }
    case 'worktree':
      return pos[0] === 'list' ? ALLOW : ask('other', 'Make or remove a git worktree, which the office manages', rule);
    case 'archive':
      // Writes a tarball to stdout; --output writes a file and --remote asks another repository for one.
      if (has(rest, '--remote') || rest.some((a) => a.startsWith('--remote='))) return ask('other', 'Fetch an archive from another repository (git archive --remote)', rule);
      return first(...[...rest.flatMap((a, k) => (a === '-o' || a === '--output' ? [rest[k + 1] ?? ''] : a.startsWith('--output=') ? [a.slice(9)] : []))].map((p) => writePath(p, ctx, 'Write')));
    case 'send-email':
      return ask('message-out', 'Send patches by email (git send-email)');
    case 'clone': case 'submodule':
      return ask('other', `Download another repository (git ${sub})`, rule);
    default:
      return ask('other', `Run git ${oneLine(sub, 40)}`, rule);
  }
}

/** A word in a script, target, task or subcommand name that says it deploys or publishes. */
const RELEASE_WORD = /(?:^|[:_.-])(deploy|ship|upload|publish|release|submit|push|deliver)(?:[:_.-]|$)/i;

/** How a release word asks: as a deploy when it changes what runs out there, else as a publish. */
const releaseKind = (word: string): AskKind => (/^(?:deploy|ship|upload)$/i.test(word) ? 'deploy' : 'publish');

/**
 * Asks as a deploy or a publish when a program's name, or one of the words it is given (subcommands, task names, what it
 * runs), says it releases: `ovsx publish`, `kamal deploy`, `semantic-release`, `pod trunk push`. Null when none does.
 */
function releaseAsk(tool: string, words: readonly string[], raw: string): Judgement | null {
  const at = words.findIndex((w) => RELEASE_WORD.test(w));
  const said = RELEASE_WORD.exec(tool)?.[1] ?? (at === -1 ? undefined : RELEASE_WORD.exec(words[at] ?? '')?.[1]);
  if (said === undefined) return null;
  const kind = releaseKind(said);
  const shownWords = words.slice(0, at === -1 ? 1 : at + 1);
  return ask(kind, `${kind === 'deploy' ? 'Deploy' : 'Publish'} with ${oneLine([tool, ...shownWords].join(' '), 60)}`, exactRule('Bash', raw));
}

/** A command's subcommand words (`pub publish`, `trunk push`): up to two at its start, past the options before them. */
function subcommandWords(args: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length && (args[i] ?? '').startsWith('-')) i++;
  for (; i < args.length && out.length < 2; i++) {
    const a = args[i] ?? '';
    if (a.startsWith('-')) break;
    out.push(a);
  }
  return out;
}

/** The values given to any of `flags`, as `-t x`, `--target x` or `--target=x`. */
function flagValues(args: readonly string[], flags: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (flags.includes(a)) {
      const value = args[i + 1];
      if (value !== undefined) out.push(value);
      i++;
      continue;
    }
    const long = flags.find((f) => f.startsWith('--') && a.startsWith(`${f}=`));
    if (long) out.push(a.slice(long.length + 1));
  }
  return out;
}

/**
 * The package scripts a pattern names: itself, or with `*` (`star`: what it matches) and `**` (anything) the scripts in
 * package.json that match. A name with no wildcard is judged even when package.json doesn't have it.
 */
function scriptsMatching(pattern: string, star: string, ctx: Ctx): string[] {
  if (!pattern.includes('*')) return pattern ? [pattern] : [];
  const source = pattern
    .split(/(\*\*|\*)/)
    .map((part) => (part === '**' ? '.*' : part === '*' ? star : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const re = new RegExp(`^${source}$`);
  return [...(packageOf(ctx)?.scripts.keys() ?? [])].filter((name) => re.test(name));
}

/**
 * What a package script does, judged as the command it runs; a name that says deploy or publish asks anyway. npm runs
 * `pre<name>` before it and `post<name>` after it (`hooks`), so those are judged with it; `node --run` runs neither.
 */
function scriptJudge(name: string | undefined, tool: string, ctx: Ctx, raw: string, hooks = true, passed: readonly string[] = []): Judgement {
  if (!name) return ALLOW;
  const scripts = packageOf(ctx)?.scripts;
  const around = hooks ? [`pre${name}`, `post${name}`].filter((hook) => scripts?.has(hook)) : [];
  return first(oneScript(name, ctx, raw, passed), ...around.map((hook) => oneScript(hook, ctx, raw)));
}

/**
 * The words a package manager passes on to a script (after its name, without the first `--`), quoted as npm quotes them when
 * it adds them to the script's command; null when a word holds a value the shell works out or a single quote.
 */
function passedOn(words: readonly string[]): string | null {
  const quoted = words.map((w) => (w.includes(COMPUTED) || w.includes("'") ? null : /^[\w@%+=:,./-]+$/.test(w) ? w : `'${w}'`));
  return quoted.some((w) => w === null) ? null : quoted.join(' ');
}

/** What follows a script's name on the command line, the first `--` left out: what the package manager adds to the script. */
function afterScript(args: readonly string[], name: string | undefined): string[] {
  const at = name === undefined ? -1 : args.indexOf(name);
  if (at === -1) return [];
  const rest = args.slice(at + 1);
  const dashes = rest.indexOf('--');
  return dashes === -1 ? rest : [...rest.slice(0, dashes), ...rest.slice(dashes + 1)];
}

/** The scripts npm runs by itself around an install (`npm install`, `npm ci`, `npm rebuild`, a bare `yarn`) and a pack. */
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'preprepare', 'prepare', 'postprepare'];
const PACK_SCRIPTS = ['prepack', 'preprepare', 'prepare', 'postprepare', 'postpack'];
const VERSION_SCRIPTS = ['preversion', 'version', 'postversion'];

/** The lifecycle scripts of the project's package.json among `names`, each judged as the command it runs. */
function lifecycleJudge(names: readonly string[], ctx: Ctx, raw: string): Judgement {
  const scripts = packageOf(ctx)?.scripts;
  return first(...names.filter((name) => scripts?.has(name) && !(name === 'prepare' && plainHusky(scripts.get(name) ?? '', ctx))).map((name) => oneScript(name, ctx, raw)));
}

/**
 * A `prepare` that is exactly `husky` or `husky install`, with at most a folder inside the project: it points git's hooks
 * (core.hooksPath in the project's own .git/config) at a folder of the project, whose files ask to be written, so the
 * install that runs it needs nobody. Anything more in the script is judged as any script is.
 */
function plainHusky(body: string, ctx: Ctx): boolean {
  const m = /^husky(?:\s+install)?(?:\s+([\w./-]+))?$/.exec(body.trim());
  if (!m) return false;
  if (m[1] === undefined) return true;
  const where = placeOf(m[1], ctx);
  return (where.place === 'inside' || where.place === 'setup') && ctx.bases.some((base) => within(ctx, base, where.path));
}

function oneScript(name: string, ctx: Ctx, raw: string, passed: readonly string[] = []): Judgement {
  const word = RELEASE_WORD.exec(name)?.[1];
  if (word) return ask(releaseKind(word), `Run the project's ${name} script`, exactRule('Bash', raw));
  const body = packageOf(ctx)?.scripts.get(name);
  if (body === undefined) return ALLOW;
  if (ctx.depth >= DEPTH_LIMIT) return ask('other', `Run the project's ${name} script, which runs too many scripts in turn to read`, exactRule('Bash', raw));
  // The words passed on land at the end of the script's command (`next dev` with `-- -H 0.0.0.0`), so they are judged there.
  const extra = passedOn(passed);
  if (extra === null) return ask('other', `Pass words to the project's ${name} script that the office can't read`, exactRule('Bash', raw));
  const j = toJudgement(judgeShell(extra === '' ? body : `${body} ${extra}`, 'bash', { ...ctx, depth: ctx.depth + 1 }));
  return j.verdict === 'ask' ? ask(j.kind, `${j.summary} (the project's ${name} script)`, exactRule('Bash', raw)) : j;
}

const NPM_VALUED = new Set(['--prefix', '-w', '--workspace', '-C', '--dir', '--filter', '-F', '--cwd', '--registry', '--tag', '--otp']);
const PUBLISH_COMMANDS = new Set(['publish', 'unpublish', 'deprecate', 'dist-tag', 'dist-tags', 'owner', 'access', 'team', 'org', 'star', 'unstar', 'hook', 'trust']);
const ACCOUNT_COMMANDS = new Set(['login', 'logout', 'adduser', 'add-user', 'token', 'profile']);
const PACKAGE_COMMANDS = new Set([
  'install', 'i', 'in', 'ins', 'inst', 'add', 'ci', 'clean-install', 'uninstall', 'remove', 'rm', 'r', 'un', 'unlink', 'update', 'up', 'upgrade',
  'dedupe', 'prune', 'rebuild', 'link', 'ln', 'audit', 'outdated', 'ls', 'list', 'll', 'la', 'view', 'v', 'info', 'show', 'why', 'explain', 'pack',
  'doctor', 'root', 'bin', 'prefix', 'help', 'search', 'version', 'init', 'create', 'fund', 'query', 'sbom', 'pkg', 'shrinkwrap', 'completion',
  'whoami', 'ping', 'licenses', 'import', 'patch', 'patch-commit', 'store', 'env', 'workspaces', 'workspace',
]);
const SCRIPT_SHORTCUTS = new Set(['test', 't', 'tst', 'start', 'stop', 'restart']);

const INSTALLS = new Set(['install', 'i', 'in', 'ins', 'inst', 'add', 'update', 'up', 'upgrade']);
/** A package spec that is an address, not a registry name: a URL, a git or hosting shorthand, or `user/repo`. */
const fromAnAddress = (spec: string): boolean =>
  /^(?:[a-z][a-z0-9+.-]*:\/\/|git\+|github:|gitlab:|bitbucket:|gist:|git@)/i.test(spec) ||
  /^[\w.-]+\/[\w.-]+(?:#\S*)?$/.test(spec) ||
  /^[\w.@/-]+@(?:https?:|git\+|git:|github:|gitlab:|bitbucket:|gist:|file:|link:|portal:)/i.test(spec);

/** Options of the package managers that point them at another registry or another configuration. */
const REGISTRY_OPTIONS = /^--(?:registry|userconfig|globalconfig|script-shell|node-options|index-url|extra-index-url|find-links|trusted-host|proxy|https-proxy|cafile)(?:=|$)/;

/** Where a package spec that is a path leads: a `file:` or `link:` spec always asks; a plain path asks when it leaves the project. */
function pathSpec(spec: string, ctx: Ctx): Judgement {
  if (/^(?:file|link|portal):/i.test(spec)) return ask('other', `Install ${oneLine(spec, 60)}, a package from a folder or file instead of the registry`);
  if (/^(?:\.{0,2}[\\/]|~|[A-Za-z]:[\\/]|\/)/.test(spec) || /\.\.[\\/]/.test(spec)) return readPath(spec, ctx, 'Install from');
  return ALLOW;
}

/** A lockfile or manifest beside the project's package.json, read whole when it is small enough to read on every request. */
const MAX_MANIFEST = 32 * 1024 * 1024;
function manifestText(files: readonly string[], ctx: Ctx): string {
  const base = ctx.cwd ?? ctx.root;
  return files
    .map((name) => {
      const file = ctx.p.join(base, name);
      try {
        const stat = statSync(file, { throwIfNoEntry: false });
        return stat?.isFile() && stat.size <= MAX_MANIFEST ? readFileSync(file, 'utf8') : '';
      } catch {
        return '';
      }
    })
    .join('\n');
}

const NPM_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The registry packages among an install's specs that the project doesn't declare: not in package.json and not in its
 * lockfile. An alias (`x@npm:y`) names the package it installs too. Paths and addresses are judged elsewhere.
 */
function undeclaredPackages(specs: readonly string[], ctx: Ctx): string[] {
  const names = specs.flatMap((spec) => {
    if (/^(?:\.{0,2}[\\/]|~|[A-Za-z]:[\\/]|\/)|^(?:file|link|portal|workspace):/i.test(spec)) return [];
    const alias = /^((?:@[^/@]+\/)?[^@]+)@npm:((?:@[^/@]+\/)?[^@]+)/.exec(spec);
    return alias ? [alias[1] ?? '', alias[2] ?? ''] : [unversioned(spec)];
  });
  const deps = packageOf(ctx)?.deps;
  const unknown = names.filter((name) => name !== '' && !deps?.has(name));
  if (unknown.length === 0) return [];
  const locks = manifestText(NPM_LOCKFILES, ctx);
  return unknown.filter((name) => {
    const n = escapeRe(name);
    return !new RegExp(`"node_modules/${n}"|(?:^|[\\s"'/])${n}@|^\\s*"?${n}"?\\s*:\\s*[{\\[]`, 'm').test(locks);
  });
}

/** The files a Python project declares its packages in. */
const PYTHON_MANIFESTS = [
  'requirements.txt', 'requirements-dev.txt', 'requirements-test.txt', 'dev-requirements.txt', 'requirements/base.txt', 'requirements/dev.txt',
  'constraints.txt', 'pyproject.toml', 'setup.cfg', 'setup.py', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'uv.lock', 'pdm.lock',
];
/** Python's packaging tools themselves: installing or upgrading them in the project's environment runs nothing of a stranger's. */
const PYTHON_TOOLING = new Set(['pip', 'setuptools', 'wheel']);
/** A Python package name as the index compares them: lower case, with runs of `-`, `_` and `.` as one `-`. */
const pyName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** The Python requirements among `specs` (`requests`, `Django==4.2`, `x[extra]>=1`) that the project doesn't declare. */
function undeclaredPython(specs: readonly string[], ctx: Ctx): string[] {
  const names = specs.map((spec) => /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(spec)?.[0] ?? '').filter((name) => name !== '' && !PYTHON_TOOLING.has(pyName(name)));
  if (names.length === 0) return [];
  const text = pyName(manifestText(PYTHON_MANIFESTS, ctx));
  return names.filter((name) => !new RegExp(`(?:^|[^a-z0-9-])${escapeRe(pyName(name))}(?:[^a-z0-9-]|$)`, 'm').test(text));
}

/** An install of Python packages the project doesn't declare yet asks: their build and install steps run as the user. */
function pythonInstallAsk(specs: readonly string[], ctx: Ctx, raw: string): Judgement {
  const fresh = undeclaredPython(specs, ctx);
  return fresh.length === 0
    ? ALLOW
    : ask('other', `Install ${oneLine(fresh.join(', '), 60)} from the Python package index, ${fresh.length === 1 ? 'a package' : 'packages'} the project doesn't use yet`, exactRule('Bash', raw));
}

function npmJudge(tool: string, args: string[], ctx: Ctx, raw: string): Judgement {
  const anotherRegistry = args.find((a) => REGISTRY_OPTIONS.test(a));
  if (anotherRegistry !== undefined) return ask('other', `Run ${tool} against another registry or configuration (${anotherRegistry.split('=')[0]})`, exactRule('Bash', raw));
  const pos = positionals(args, NPM_VALUED);
  const sub = pos[0];
  const global = has(args, '-g', '--global', '--location=global');
  if (sub === undefined) {
    if (global) return ask('global-config', `Change what ${tool} installs for the whole computer`);
    // A bare `yarn` installs, and runs the install scripts as it does.
    return tool === 'yarn' ? lifecycleJudge(INSTALL_SCRIPTS, ctx, raw) : ALLOW;
  }
  // `npm init <x>`, `npm create <x>` and `pnpm/yarn/bun create <x>` download create-<x> and run it, as `npx create-<x>` does.
  if ((sub === 'create' || (tool === 'npm' && (sub === 'init' || sub === 'innit'))) && pos[1] !== undefined && !global) {
    const initializer = pos[1];
    const pkg = initializer.startsWith('@') ? (initializer.includes('/') ? initializer.replace(/^(@[^/]+)\/(.+)$/, '$1/create-$2') : `${initializer}/create`) : `create-${initializer}`;
    const j = packageRunJudge(tool === 'npm' ? 'npx' : tool, [pkg, ...args.slice(args.indexOf(initializer) + 1)], ctx, raw);
    return j.verdict === 'ask' ? { ...j, rule: exactRule('Bash', raw) } : j;
  }
  if (PUBLISH_COMMANDS.has(sub)) {
    return ask('publish', sub === 'publish' ? `Publish the package with ${tool}` : `Change the published package on the registry (${tool} ${sub})`, exactRule('Bash', raw));
  }
  if (ACCOUNT_COMMANDS.has(sub)) return ask('global-config', `Change the ${tool} sign-in on this computer`);
  if (sub === 'config' || sub === 'c' || sub === 'set') return ['get', 'list', 'ls'].includes(pos[1] ?? '') ? ALLOW : ask('global-config', `Change ${tool}'s settings`);
  if (sub === 'cache') return ['ls', 'verify', 'list'].includes(pos[1] ?? '') ? ALLOW : ask('global-config', `Change ${tool}'s cache for the whole computer`);
  if (sub === 'exec' || sub === 'x' || sub === 'dlx') return packageRunJudge(tool, args.slice(args.indexOf(sub) + 1), ctx, raw);
  if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') return first(scriptJudge(pos[1], tool, ctx, raw, true, afterScript(args, pos[1])), argsStayInside(args, ctx));
  if (PACKAGE_COMMANDS.has(sub)) {
    if (global || ((sub === 'link' || sub === 'ln') && pos.length === 1)) return ask('global-config', `Install ${pos.slice(1).join(', ') || 'a package'} for the whole computer`);
    // What the project declares (package.json, its lockfile) installs without asking. A package it doesn't declare yet runs
    // install scripts nobody has read, and one named by an address downloads whatever is there, so both ask.
    if (INSTALLS.has(sub)) {
      const elsewhere = pos.slice(1).find(fromAnAddress);
      if (elsewhere !== undefined) return ask('other', `Install ${oneLine(elsewhere, 60)}, a package from an address instead of the registry`, exactRule('Bash', raw));
      const paths = first(...pos.slice(1).map((spec) => pathSpec(spec, ctx)));
      if (paths.verdict !== 'allow') return paths;
      const fresh = undeclaredPackages(pos.slice(1), ctx);
      if (fresh.length > 0) {
        return ask('other', `Install ${oneLine(fresh.join(', '), 60)} from the npm registry, ${fresh.length === 1 ? 'a package' : 'packages'} the project doesn't use yet`, exactRule('Bash', raw));
      }
    }
    if (INSTALLS.has(sub) || sub === 'ci' || sub === 'clean-install' || sub === 'rebuild') return lifecycleJudge(INSTALL_SCRIPTS, ctx, raw);
    if (sub === 'pack') return lifecycleJudge(PACK_SCRIPTS, ctx, raw);
    if (sub === 'version' && pos.length > 1) return lifecycleJudge(VERSION_SCRIPTS, ctx, raw);
    return ALLOW;
  }
  if (SCRIPT_SHORTCUTS.has(sub)) return first(scriptJudge(sub === 't' || sub === 'tst' ? 'test' : sub, tool, ctx, raw, true, afterScript(args, sub)), argsStayInside(args, ctx));
  // yarn, pnpm and bun run a script by its name alone.
  if (tool !== 'npm' && packageOf(ctx)?.scripts.has(sub)) return first(scriptJudge(sub, tool, ctx, raw, true, afterScript(args, sub)), argsStayInside(args, ctx));
  return ask('other', `Run ${tool} ${oneLine(sub, 40)}`, exactRule('Bash', raw));
}

/** A package name without its version: "wrangler@4" is wrangler, "@astrojs/upgrade@1" is @astrojs/upgrade. */
const unversioned = (name: string) => name.replace(/^(@[^/@]+\/[^@]+|[^@]+)@.*$/, '$1');

/** npx, pnpm dlx, bunx and the like: a package's program, the project's or downloaded. */
function packageRunJudge(tool: string, args: string[], ctx: Ctx, raw: string): Judgement {
  // -c and --call hand a whole command line to a shell.
  if (args.some((a) => a === '-c' || a === '--call' || a.startsWith('--call='))) return ask('other', `Run ${tool} with a command line of its own (${tool} -c)`, exactRule('Bash', raw));
  let pkg: string | null = null;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '-p' || a === '--package') {
      pkg = args[++i] ?? null;
      continue;
    }
    if (a.startsWith('--package=')) {
      pkg = a.slice(10);
      continue;
    }
    if (a === '--') {
      i++;
      break;
    }
    if (!a.startsWith('-')) break;
    // Before the program, an option is the runner's own: `npx --node-options=--require=x vitest` preloads code.
    if (REGISTRY_OPTIONS.test(a)) return ask('other', `Run ${tool} against another registry or configuration (${a.split('=')[0]})`, exactRule('Bash', raw));
  }
  const program = args[i];
  if (program === undefined) return ALLOW;
  const name = unversioned(program);
  const bin = name.split('/').pop() ?? name;
  const rest = args.slice(i + 1);
  const known = programJudge(bin, rest, ctx, raw, 'bash');
  if (known !== null) return known;
  // Even the project's own program asks when its subcommand says it releases: `npx vsce publish`.
  const release = releaseAsk(bin, subcommandWords(rest), raw);
  if (packageOf(ctx)?.deps.has(unversioned(pkg ?? program)) || projectBin(name, ctx)) return first(release ?? ALLOW, serverJudge(bin, rest, exactRule('Bash', raw)), argsStayInside(rest, ctx));
  return release ?? ask('other', `Run ${oneLine(name, 60)} from the npm registry, which the project doesn't depend on`, { rule: `Bash(${tool} ${name}:*)`, sentence: `running ${name} with ${tool}` });
}

const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|[\w.-]+\.localhost|host\.docker\.internal)$/i;
const PAID_APIS: [RegExp, string][] = [
  [/(^|\.)api\.openai\.com$/i, 'OpenAI'], [/(^|\.)api\.anthropic\.com$/i, 'Anthropic'], [/(^|\.)generativelanguage\.googleapis\.com$/i, 'Gemini'],
  [/(^|\.)api\.stripe\.com$/i, 'Stripe'], [/(^|\.)api\.mistral\.ai$/i, 'Mistral'], [/(^|\.)api\.cohere\.(?:ai|com)$/i, 'Cohere'],
  [/(^|\.)api\.replicate\.com$/i, 'Replicate'], [/(^|\.)api\.elevenlabs\.io$/i, 'ElevenLabs'], [/(^|\.)api\.groq\.com$/i, 'Groq'],
  [/(^|\.)openrouter\.ai$/i, 'OpenRouter'], [/(^|\.)api\.deepseek\.com$/i, 'DeepSeek'], [/(^|\.)maps\.googleapis\.com$/i, 'Google Maps'],
  [/(^|\.)api\.apify\.com$/i, 'Apify'], [/(^|\.)twint\.ch$/i, 'TWINT'], [/(^|\.)api(?:-m)?\.paypal\.com$/i, 'PayPal'],
  [/(^|\.)api\.lemonsqueezy\.com$/i, 'Lemon Squeezy'], [/(^|\.)api\.polar\.sh$/i, 'Polar'], [/(^|\.)api\.cloudflare\.com$/i, 'Cloudflare'],
  [/(^|\.)api\.together\.xyz$/i, 'Together'], [/(^|\.)api\.perplexity\.ai$/i, 'Perplexity'], [/(^|\.)api\.x\.ai$/i, 'xAI'],
];
const MESSAGING: [RegExp, string][] = [
  [/(^|\.)slack\.com$/i, 'Slack'], [/(^|\.)discord(?:app)?\.com$/i, 'Discord'], [/(^|\.)api\.telegram\.org$/i, 'Telegram'],
  [/(^|\.)api\.twilio\.com$/i, 'Twilio'], [/(^|\.)api\.sendgrid\.com$/i, 'SendGrid'], [/(^|\.)api\.mailgun\.net$/i, 'Mailgun'],
  [/(^|\.)api\.postmarkapp\.com$/i, 'Postmark'], [/(^|\.)api\.resend\.com$/i, 'Resend'], [/(^|\.)outlook\.office(?:365)?\.com$/i, 'Outlook'],
  [/(^|\.)graph\.microsoft\.com$/i, 'Microsoft 365'], [/(^|\.)gmail\.googleapis\.com$/i, 'Gmail'], [/(^|\.)api\.brevo\.com$/i, 'Brevo'],
  [/(^|\.)api\.mailchimp\.com$/i, 'Mailchimp'], [/(^|\.)graph\.facebook\.com$/i, 'WhatsApp or Facebook'], [/(^|\.)webhook\.office\.com$/i, 'Teams'],
];

/** The host of a URL with a scheme, or of a bare local address such as localhost:5173. */
function hostOf(word: string): string | null {
  const url = /^(?:https?|wss?|ftp):\/\/(?:[^@/\s]+@)?(\[[^\]]+\]|[^/:?#\s]+)/i.exec(word)?.[1];
  if (url) return url.toLowerCase();
  const local = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(?::\d+)?(?:[/?#]|$)/i.exec(word)?.[1];
  return local ? local.toLowerCase() : null;
}

/** A request to a host: local is routine; a paid API or a messaging service says so; anything else asks. */
function hostJudge(host: string, raw: string): Judgement {
  if (LOCAL_HOST.test(host)) return ALLOW;
  const paid = PAID_APIS.find(([re]) => re.test(host))?.[1];
  if (paid) return ask('paid-api', `Call the ${paid} API (${host})`, exactRule('Bash', raw));
  const messaging = MESSAGING.find(([re]) => re.test(host))?.[1];
  if (messaging) return ask('message-out', `Send something through ${messaging} (${host})`, exactRule('Bash', raw));
  return ask('other', `Reach ${host} over the network`, exactRule('Bash', raw));
}

/** Whether everything before the path of a URL or `host:port/...` is written out: no variable or computed value in it. */
function addressKnown(word: string): boolean {
  const authority = word.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '').split(/[/?#]/, 1)[0] ?? '';
  return !/[$`]|%\w+%/.test(authority) && !authority.includes(COMPUTED);
}

/** The address a positional word of curl or wget names, before its path: a URL, `host:port/path`, `user@host`, or a bare name. */
function hostOfWord(word: string): string | null {
  const m = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/)?(?:[^@/?#\s]*@)?(\[[^\]]+\]|[^/:?#\s]+)/.exec(word);
  return m?.[1]?.toLowerCase() ?? null;
}

/** Options of curl and wget that take a value, by letter (a short one, alone or at the end of a cluster) and by name. */
const CURL_SHORT = new Set('dHXowuAebcFmrTKxEDzCQYyUPt'.split(''));
const CURL_LONG = new Set([
  'data', 'data-raw', 'data-binary', 'data-urlencode', 'data-ascii', 'json', 'header', 'request', 'output', 'write-out', 'user', 'user-agent', 'referer', 'cookie', 'cookie-jar',
  'form', 'form-string', 'max-time', 'connect-timeout', 'range', 'upload-file', 'config', 'proxy', 'resolve', 'connect-to', 'retry', 'retry-delay', 'retry-max-time',
  'limit-rate', 'cacert', 'cert', 'key', 'dump-header', 'url', 'max-redirs', 'output-dir', 'oauth2-bearer', 'proxy-user', 'preproxy', 'unix-socket', 'doh-url', 'interface',
  'speed-time', 'speed-limit', 'keepalive-time', 'expect100-timeout', 'aws-sigv4', 'variable', 'rate', 'time-cond', 'continue-at', 'etag-save', 'etag-compare', 'trace', 'trace-ascii',
]);
const WGET_SHORT = new Set('OPoaUetTwQlIBXDARiEcN'.split('').filter((c) => c !== 'c'));
const WGET_LONG = new Set([
  'output-document', 'directory-prefix', 'output-file', 'append-output', 'user-agent', 'execute', 'tries', 'timeout', 'wait', 'waitretry', 'quota', 'level', 'include-directories',
  'base', 'exclude-directories', 'domains', 'accept', 'reject', 'header', 'user', 'password', 'post-data', 'post-file', 'body-data', 'body-file', 'referer', 'load-cookies',
  'save-cookies', 'ca-certificate', 'certificate', 'bind-address', 'input-file', 'limit-rate', 'read-timeout', 'connect-timeout', 'dns-timeout', 'method', 'http-user', 'http-password',
  'proxy-user', 'proxy-password', 'default-page', 'config', 'rejected-log', 'warc-file', 'accept-regex', 'reject-regex',
]);
/** Options that send the request somewhere else, run a configuration the command doesn't show, or read the addresses from a file. */
const CURL_REROUTES = /^(?:proxy.*|preproxy|socks.*|resolve|connect-to|config|doh-url|unix-socket|abstract-unix-socket|netrc.*|next|interface|haproxy.*)$/;
const WGET_REROUTES = /^(?:execute|input-file|span-hosts|proxy.*|config|base|warc-file|mirror|input-metalink|force-html)$/;
/** Options whose value is a file the request sends, or writes. */
const CURL_SENDS = new Set(['data', 'data-raw', 'data-binary', 'data-urlencode', 'data-ascii', 'json', 'form', 'form-string', 'upload-file']);
const CURL_WRITES = new Set(['output', 'cookie-jar', 'dump-header', 'trace', 'trace-ascii', 'etag-save', 'output-dir']);
const WGET_SENDS = new Set(['post-file', 'body-file']);
const WGET_WRITES = new Set(['output-document', 'directory-prefix', 'output-file', 'append-output', 'save-cookies', 'rejected-log']);

/** The file a curl value sends: `@file`, or `name=@file` and `name=<file` of a form field; null when it sends text. */
function sentFile(value: string, form: boolean): string | null {
  const m = form ? /^[^=]*=[@<](.+?)(?:;.*)?$/s.exec(value) : /^@(.+)$/s.exec(value);
  const file = m?.[1]?.replace(/^"(.*)"$/, '$1');
  return file !== undefined && file !== '-' ? file : null;
}

interface Opt {
  name: string;
  value: string | null;
}

/** curl's and wget's words as options (a long name or a short letter, with its value) and the words that are addresses. */
function fetchWords(tool: string, args: readonly string[]): { opts: Opt[]; positionals: string[] } {
  const wget = tool === 'wget';
  const shortValued = wget ? WGET_SHORT : CURL_SHORT;
  const longValued = wget ? WGET_LONG : CURL_LONG;
  const opts: Opt[] = [];
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = (eq === -1 ? a.slice(2) : a.slice(2, eq)).toLowerCase();
      if (eq !== -1) opts.push({ name, value: a.slice(eq + 1) });
      else opts.push({ name, value: longValued.has(name) ? (args[++i] ?? '') : null });
    } else if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const ch = a.charAt(k);
        if (shortValued.has(ch)) {
          opts.push({ name: ch, value: k + 1 < a.length ? a.slice(k + 1) : (args[++i] ?? '') });
          break;
        }
        opts.push({ name: ch, value: null });
      }
    } else positionals.push(a);
  }
  // `--url` names an address like a bare word does.
  for (const o of opts) if (o.name === 'url' && o.value) positionals.push(o.value);
  return { opts, positionals };
}

function fetchJudge(tool: string, args: string[], ctx: Ctx, raw: string): Judgement {
  const rule = exactRule('Bash', raw);
  if (tool === 'curl' || tool === 'wget') {
    const wget = tool === 'wget';
    const { opts, positionals: words } = fetchWords(tool, args);
    const judgements: Judgement[] = [];
    for (const o of opts) {
      const reroutes = wget ? WGET_REROUTES.test(o.name) || o.name === 'H' || o.name === 'e' || o.name === 'i' || o.name === 'Y' || o.name === 'B' || o.name === 'm' : CURL_REROUTES.test(o.name) || o.name === 'x' || o.name === 'K';
      if (reroutes) judgements.push(ask('other', `Run ${tool} with an option that sends it to another address or runs a configuration (${o.name.length === 1 ? `-${o.name}` : `--${o.name}`})`, rule));
      const value = o.value ?? '';
      if (wget ? WGET_SENDS.has(o.name) : CURL_SENDS.has(o.name) || o.name === 'T' || o.name === 'd' || o.name === 'F') {
        const file = wget ? value : o.name === 'T' || o.name === 'upload-file' ? (value === '-' ? null : value) : sentFile(value, o.name === 'F' || o.name === 'form' || o.name === 'form-string');
        if (file) judgements.push(readPath(file, ctx, 'Send'));
      }
      if (wget ? WGET_WRITES.has(o.name) || o.name === 'O' || o.name === 'P' || o.name === 'o' || o.name === 'a' : CURL_WRITES.has(o.name) || o.name === 'o' || o.name === 'c' || o.name === 'D') {
        if (value !== '' && value !== '-') judgements.push(writePath(value, ctx, 'Write'));
      }
      if (wget && (o.name === 'load-cookies') && value) judgements.push(readPath(value, ctx));
    }
    // Every address is judged, and a word that names none counts as one that isn't this computer's.
    let hosts = 0;
    for (const a of words) {
      hosts++;
      const word = substitute(a, ctx);
      const host = hostOfWord(word);
      if (!host || !addressKnown(word)) judgements.push(ask('other', 'Reach the network at an address it works out as it runs', rule));
      else judgements.push(hostJudge(host, raw));
    }
    if (hosts === 0) judgements.push(ask('other', 'Reach the network at an address it works out as it runs', rule));
    return first(...judgements);
  }
  // The other fetchers (http, xh, aria2c, Invoke-WebRequest): an address is a word with a scheme or a local host.
  const judgements: Judgement[] = [];
  let hosts = 0;
  const out = ['-o', '--output', '--output-dir', '-OutFile', '-outfile'];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (out.includes(a)) {
      judgements.push(writePath(args[++i] ?? '', ctx, 'Write'));
      continue;
    }
    if (a === '-T' || a === '--upload-file' || a.toLowerCase() === '-infile') {
      judgements.push(readPath(args[++i] ?? '', ctx));
      continue;
    }
    const at = /^@(.+)$/.exec(a.includes('=@') ? a.slice(a.indexOf('=@') + 1) : a)?.[1];
    if (at && at !== '-') judgements.push(readPath(at, ctx));
    const word = substitute(a, ctx);
    const host = a.startsWith('-') ? null : hostOf(word);
    if (host) {
      hosts++;
      judgements.push(addressKnown(word) ? hostJudge(host, raw) : ask('other', 'Reach the network at an address it works out as it runs', rule));
    }
  }
  if (hosts === 0) judgements.push(ask('other', 'Reach the network at an address it works out as it runs', rule));
  return first(...judgements);
}

const GH_VALUED = new Set(['-R', '--repo', '--hostname', '-X', '--method', '-f', '-F', '--field', '--raw-field', '-H', '--header', '--input', '-q', '--jq', '-t', '--template', '-b', '--body', '--title', '-B', '--base']);
const GH_READS = new Set(['view', 'list', 'status', 'diff', 'checks', 'search', 'download', 'watch']);

function ghJudge(args: string[], raw: string): Judgement {
  const [group, action] = positionals(args, GH_VALUED);
  const rule = exactRule('Bash', raw);
  const reads = action === undefined || GH_READS.has(action);
  switch (group) {
    case undefined: case 'help': case 'version': case 'status': case 'search':
      return ALLOW;
    case 'pr': case 'issue': {
      const what = group === 'pr' ? 'a pull request' : 'an issue';
      if (reads) return ALLOW;
      if (action === 'create') return group === 'pr' ? ask('publish', 'Open a pull request on GitHub', rule) : ask('message-out', 'Open an issue on GitHub', rule);
      if (action === 'comment' || action === 'review') return ask('message-out', `Comment on ${what} on GitHub`, { rule: `Bash(gh ${group} ${action}:*)`, sentence: `any comment on ${what} on GitHub` });
      if (action === 'merge') return ask('push', 'Merge a pull request on GitHub', rule);
      if (action === 'checkout') return ask('other', "Switch the shared checkout to a pull request's branch", rule);
      return ask('other', `Change ${what} on GitHub (gh ${group} ${oneLine(action ?? '', 20)})`, rule);
    }
    case 'release':
      return reads ? ALLOW : ask('publish', 'Publish or change a release on GitHub', rule);
    case 'gist':
      return reads || action === 'clone' ? ALLOW : ask('publish', 'Publish or change a gist on GitHub', rule);
    case 'repo':
      if (reads) return ALLOW;
      return action === 'create' || action === 'fork' ? ask('publish', 'Make a repository on GitHub', rule) : ask('other', `Change a repository on GitHub (gh repo ${oneLine(action ?? '', 20)})`, rule);
    case 'run':
      return reads ? ALLOW : ask('other', 'Rerun or cancel a workflow run on GitHub', rule);
    case 'workflow':
      return reads ? ALLOW : ask('deploy', 'Start or change a workflow on GitHub', rule);
    case 'auth':
      return action === 'status' ? ALLOW : ask('global-config', 'Change the GitHub sign-in on this computer');
    case 'config': case 'extension': case 'alias':
      return action === undefined || action === 'get' || action === 'list' ? ALLOW : ask('global-config', 'Change the GitHub command line for the whole computer');
    case 'api': {
      const method = (valueOf(args, '-X', '--method') ?? 'GET').toUpperCase();
      const writes = method !== 'GET' || has(args, '-f', '-F', '--field', '--raw-field', '--input');
      if (!writes) return ALLOW;
      return /comments|reviews|discussions|(?:^|\/)issues\/?$|(?:^|\/)pulls\/?$/.test(action ?? '')
        ? ask('message-out', 'Post to GitHub through its API', rule)
        : ask('other', 'Change something on GitHub through its API', rule);
    }
    default:
      return ask('other', `Use GitHub's ${oneLine(group, 20)} command`, rule);
  }
}

/** Command-line tools for hosting and clouds: anything that changes what runs out there counts as a deploy. */
const CLOUD = new Map<string, string>([
  ['aws', 'AWS'], ['gcloud', 'Google Cloud'], ['gsutil', 'Google Cloud Storage'], ['az', 'Azure'], ['doctl', 'DigitalOcean'],
  ['kubectl', 'Kubernetes'], ['helm', 'Helm'], ['terraform', 'Terraform'], ['tofu', 'OpenTofu'], ['pulumi', 'Pulumi'],
  ['serverless', 'Serverless'], ['sls', 'Serverless'], ['cdk', 'AWS CDK'], ['sam', 'AWS SAM'], ['railway', 'Railway'], ['render', 'Render'],
  ['heroku', 'Heroku'], ['fly', 'Fly.io'], ['flyctl', 'Fly.io'], ['vercel', 'Vercel'], ['vc', 'Vercel'], ['netlify', 'Netlify'], ['ntl', 'Netlify'],
  ['wrangler', 'Cloudflare'], ['firebase', 'Firebase'], ['surge', 'Surge'], ['supabase', 'Supabase'], ['convex', 'Convex'], ['sanity', 'Sanity'],
  ['shopify', 'Shopify'], ['apify', 'Apify'], ['eas', 'EAS'], ['deployctl', 'Deno Deploy'], ['amplify', 'AWS Amplify'], ['gh-pages', 'GitHub Pages'],
  ['ngrok', 'ngrok'], ['cloudflared', 'Cloudflare Tunnel'], ['lt', 'localtunnel'], ['stripe', 'Stripe'], ['twilio', 'Twilio'],
]);
/** Their subcommands that only work here: a local dev server, a build, a read of the project's own files. */
const CLOUD_LOCAL = new Map<string, readonly string[]>([
  ['vercel', ['dev', 'build', 'pull', 'link', 'help']],
  ['vc', ['dev', 'build', 'pull', 'link', 'help']],
  ['netlify', ['dev', 'build', 'serve', 'help']],
  ['ntl', ['dev', 'build', 'serve', 'help']],
  ['wrangler', ['dev', 'build', 'types', 'init', 'generate', 'docs', 'help', 'pages dev', 'd1 migrations create', 'whoami']],
  ['firebase', ['emulators:start', 'emulators:exec', 'serve', 'help', 'init']],
  ['supabase', ['start', 'stop', 'status', 'gen', 'init', 'migration new', 'db diff', 'db reset', 'functions serve', 'help']],
  ['convex', ['dev', 'codegen', 'help']],
  ['shopify', ['app dev', 'app info', 'app generate', 'app build', 'app config', 'theme dev', 'theme check', 'help', 'version']],
  ['apify', ['run', 'create', 'init', 'validate-schema', 'help']],
  ['eas', ['build:configure', 'update:configure', 'diagnostics', 'help', 'config']],
  ['terraform', ['init', 'validate', 'fmt', 'version', 'providers', 'graph']],
  ['tofu', ['init', 'validate', 'fmt', 'version']],
  ['cdk', ['synth', 'init', 'doctor']],
  ['sam', ['build', 'validate', 'local', 'init']],
  ['serverless', ['offline', 'print', 'package']],
  ['sls', ['offline', 'print', 'package']],
  ['helm', ['template', 'lint', 'version', 'dependency', 'create']],
  ['sanity', ['dev', 'build', 'start', 'help', 'init', 'typegen']],
]);
const CHANGES_OUT_THERE = /\b(?:deploy|publish|release|submit|update|up|push|apply|destroy|delete|create|put|rm|remove|sync|cp|mv|invoke|rollout|scale|patch|replace|install|uninstall|upgrade|rollback|set|secret|unset|import|execute|run|call|trigger)\b/;

function cloudJudge(tool: string, args: string[], raw: string): Judgement {
  const name = CLOUD.get(tool) ?? tool;
  const pos = positionals(args, new Set(['--project', '-p', '--profile', '--region', '-c', '--config', '--env', '-e', '--app', '-a', '--name']));
  const words = pos.slice(0, 2).join(' ');
  const rule = exactRule('Bash', raw);
  if ((CLOUD_LOCAL.get(tool) ?? []).some((l) => words === l || words.startsWith(`${l} `) || pos[0] === l)) return ALLOW;
  if (has(args, '--help', '-h', '--version') || (tool === 'wrangler' && has(args, '--local'))) return ALLOW;
  if (pos[0] === 'login' || pos[0] === 'logout' || pos[0] === 'auth') return ask('global-config', `Change the ${name} sign-in on this computer`);
  if (tool === 'ngrok' || tool === 'cloudflared' || tool === 'lt') return ask('publish', `Open the dev server to the internet with ${name}`, rule);
  if (tool === 'stripe' || tool === 'twilio') return ask('paid-api', `Use the ${name} account from the command line`, rule);
  if (tool === 'eas' && pos[0] === 'build') return ask('paid-api', 'Start a cloud build on EAS', rule);
  if (tool === 'eas' && (pos[0] === 'submit' || pos[0] === 'update')) return ask('publish', pos[0] === 'submit' ? 'Submit the app to the store with EAS' : 'Publish an update to the app with EAS', rule);
  if (tool === 'apify' && pos[0] === 'call') return ask('paid-api', 'Run an actor on Apify, which costs credits', rule);
  if (tool === 'gh-pages') return ask('publish', 'Publish the site to GitHub Pages', rule);
  if (tool === 'shopify' && /release|publish/.test(words)) return ask('publish', `Release on ${name} (${oneLine(`shopify ${words}`, 40)})`, rule);
  const deploysByDefault = ['vercel', 'vc', 'surge', 'netlify', 'ntl'].includes(tool) && (pos[0] === undefined || pos[0] === 'deploy');
  if (deploysByDefault || CHANGES_OUT_THERE.test(words)) return ask('deploy', `Deploy or change ${name} (${oneLine(`${tool} ${words}`.trim(), 50)})`, rule);
  return ask('other', `Use the ${name} command line (${oneLine(`${tool} ${words}`.trim(), 50)})`, rule);
}

/** Inline code that names the files of how Claude Code or git runs in the project (see setupOf). */
const INLINE_SETUP = /\.claude\b|claude(?:\.local)?\.md|\.mcp\.json|\.git[\\/]|\.husky|hookspath/i;
/** Inline code that names a package manager's settings file (see packageSetup). */
const INLINE_PACKAGE_SETUP = /\.npmrc|\.yarnrc|pip\.(?:conf|ini)/i;
/** Inline code that names VS Code's tasks, which it can run by itself when the folder opens. */
const INLINE_EDITOR_SETUP = /\.vscode[\\/]tasks\.json/i;
const SHELL_PROGRAMS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish', 'cmd', 'pwsh', 'powershell']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'python', 'python3', 'py', 'ruby', 'php', 'tsx', 'ts-node', 'bun', 'lua', 'luajit']);

/**
 * Inline code is silent only when it reads as a small closed grammar: numbers, plain strings, constants, lists and records of
 * them, arithmetic, and printing them. A list of dangerous words can't be complete (`this[x].getBuiltinModule(...)` with `x`
 * built from pieces, `breakpoint()` with PYTHONBREAKPOINT set), so every other name, a member looked up by `[`, a call of
 * anything but these, and a string that could hold code (`$`, `@`, `#`, `{`, `}`, `\`, a backtick) makes it ask.
 */
const INLINE_CALLS = new Set(['console.log', 'console.error', 'print', 'puts', 'echo', 'process.exit', 'JSON.stringify']);
/** Printers some languages call without parentheses: `print 1 + 1` (Perl, Lua), `puts 2 * 3` (Ruby), `echo 1;` (PHP). */
const INLINE_BARE = new Set(['print', 'puts', 'echo']);
const INLINE_CONSTANTS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil']);
const INLINE_BINARY = new Set(['+', '-', '*', '/', '%', '**', '//']);

type InlineToken = { kind: 'number' | 'string' | 'name' | 'op'; text: string };

/** The code as tokens of the grammar, or null at the first character outside it. A line break ends a statement. */
function inlineTokens(code: string): InlineToken[] | null {
  const out: InlineToken[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code.charAt(i);
    if (c === '\n') {
      out.push({ kind: 'op', text: ';' });
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    const rest = code.slice(i);
    const token =
      (/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/.exec(rest) && { kind: 'number' as const, re: /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ }) ||
      (/^["']/.test(rest) && { kind: 'string' as const, re: c === '"' ? /^"[^"\\$@#{}`\n]*"/ : /^'[^'\\$@#{}`\n]*'/ }) ||
      (/^[A-Za-z_]/.test(rest) && { kind: 'name' as const, re: /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?![\w$])/ }) || { kind: 'op' as const, re: /^(?:\*\*|\/\/|[-+*/%(),;[\]{}:])/ };
    const m = token.re.exec(rest);
    if (!m) return null;
    out.push({ kind: token.kind, text: m[0] });
    i += m[0].length;
  }
  return out;
}

/** Whether the tokens are statements of the closed grammar (see INLINE_CALLS): a recursive descent that only says yes or no. */
function inlineGrammar(tokens: readonly InlineToken[]): boolean {
  let at = 0;
  const peek = (): InlineToken | undefined => tokens[at];
  const op = (text: string): boolean => {
    if (peek()?.kind === 'op' && peek()?.text === text) {
      at++;
      return true;
    }
    return false;
  };
  const list = (close: string, item: () => boolean): boolean => {
    if (op(close)) return true;
    do {
      if (peek()?.kind === 'op' && peek()?.text === close) break;
      if (!item()) return false;
    } while (op(','));
    return op(close);
  };
  const pair = (): boolean => {
    const key = peek();
    if (key === undefined || key.kind === 'op') return false;
    at++;
    return op(':') && expr();
  };
  const call = (name: string): boolean => {
    if (name !== 'process.exit') return list(')', expr);
    const code = peek();
    if (code?.kind === 'number' && /^\d{1,3}$/.test(code.text)) at++;
    return op(')');
  };
  const atom = (): boolean => {
    const t = peek();
    if (t === undefined) return false;
    at++;
    if (t.kind === 'number' || t.kind === 'string') return true;
    if (t.kind === 'name') return INLINE_CONSTANTS.has(t.text) || (INLINE_CALLS.has(t.text) && op('(') && call(t.text));
    if (t.text === '(') return expr() && op(')');
    if (t.text === '[') return list(']', expr);
    if (t.text === '{') return list('}', pair);
    return false;
  };
  const expr = (): boolean => {
    while (op('-') || op('+'));
    if (!atom()) return false;
    while (peek()?.kind === 'op' && INLINE_BINARY.has(peek()?.text ?? '')) {
      at++;
      while (op('-') || op('+'));
      if (!atom()) return false;
    }
    return true;
  };
  const statement = (): boolean => {
    const t = peek();
    if (t === undefined || (t.kind === 'op' && t.text === ';')) return true;
    const next = tokens[at + 1];
    if (t.kind === 'name' && INLINE_BARE.has(t.text) && !(next?.kind === 'op' && next.text === '(')) {
      at++;
      if (peek() === undefined || (peek()?.kind === 'op' && peek()?.text === ';')) return true;
      do if (!expr()) return false;
      while (op(','));
      return true;
    }
    return expr();
  };
  do if (!statement()) return false;
  while (op(';'));
  return at === tokens.length;
}

/** Whether inline code is only literals, arithmetic and printing them (see INLINE_CALLS). */
function plainInlineCode(code: string): boolean {
  if (code.includes(COMPUTED)) return false;
  const tokens = inlineTokens(code);
  return tokens !== null && inlineGrammar(tokens);
}

/** Inline code, as `node -e` gets it: the office's records refused, setup files asked, and anything outside the closed grammar asked. */
function judgeInlineCode(code: string, raw: string): Judgement {
  if (/\.worklings/i.test(code)) return deny(RECORDS);
  if (INLINE_SETUP.test(code)) return askSetup('Change how Claude Code or git runs in this project, with inline code that names its files');
  if (INLINE_PACKAGE_SETUP.test(code)) return askSetup('Change how a package manager runs in this project, with inline code that names its settings file');
  if (INLINE_EDITOR_SETUP.test(code)) return askSetup('Change how VS Code runs in this project, with inline code that names its tasks');
  return plainInlineCode(code) ? ALLOW : ask('other', 'Run inline code that is more than printing plain values (it could start programs, read files or reach the network)', exactRule('Bash', raw));
}

/** What a shell program is given to run: commands to judge, a script it runs by name, or commands it reads as it runs. */
interface ShellRun {
  commands: string[];
  dialect: Dialect;
  script: { file: string; rest: string[] } | null;
  /** It reads its commands from its input (a pipe, a heredoc), which the office can't read first. */
  input: boolean;
  /** Why what it runs can't be read, when it can't. */
  unreadable: string | null;
  /** The folder it runs in, when it is told one (`pwsh -WorkingDirectory`). */
  cwd?: string;
}

const shellRun = (o: Partial<ShellRun> & { dialect: Dialect }): ShellRun => ({ commands: [], script: null, input: false, unreadable: null, ...o });

/**
 * bash, sh, zsh, dash and fish. Short options come together (`-lc` is `-l -c`, as are `-ec` and `-xc`), and `-o` and
 * `-O` take the next word. With -c the first word that isn't an option is the command; without it, a script to run;
 * with -s, or with neither, the shell reads its commands from its input. fish's -C runs a command first.
 */
function shRun(tool: string, args: readonly string[]): ShellRun {
  let c = false;
  let given = false;
  let fromInput = false;
  let info = false;
  const commands: string[] = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--' || a === '-') {
      i++;
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a : a.slice(0, eq);
      const value = eq === -1 ? undefined : a.slice(eq + 1);
      // fish's --command is what it runs, its --init-command what it runs first.
      if (name === '--command' || name === '--init-command') {
        commands.push(value ?? args[++i] ?? '');
        if (name === '--command') given = true;
      } else if ((name === '--rcfile' || name === '--init-file' || name === '--emulate') && value === undefined) i++;
      else if (name === '--version' || name === '--help') info = true;
      continue;
    }
    if (/^[-+][A-Za-z]+$/.test(a)) {
      const letters = a.slice(1);
      if (a.startsWith('-') && letters.includes('c')) c = true;
      if (a.startsWith('-') && letters.includes('s')) fromInput = true;
      if (tool === 'fish' && a.startsWith('-') && letters.includes('C')) commands.push(args[++i] ?? '');
      i += [...letters].filter((l) => l === 'o' || l === 'O').length;
      continue;
    }
    break;
  }
  const word = args[i];
  if (given) return shellRun({ dialect: 'bash', commands });
  if (c) return shellRun({ dialect: 'bash', commands: word === undefined ? commands : [...commands, word] });
  if (word !== undefined && !fromInput) return shellRun({ dialect: 'bash', commands, script: { file: word, rest: args.slice(i + 1) } });
  return shellRun({ dialect: 'bash', commands, input: !info });
}

/** A PowerShell parameter as its command line takes one: by any start of its name, after -, -- or /, a value after `:`. */
function psParameter(word: string): { name: string; value: string | undefined } | null {
  const m = /^(?:--?|\/)([A-Za-z?][\w-]*)(?::([\s\S]*))?$/.exec(word);
  return m ? { name: (m[1] ?? '').toLowerCase(), value: m[2] } : null;
}

/** Whether `name` starts `full` with at least `least` letters, as PowerShell takes a parameter's name. */
const startsName = (name: string, full: string, least = 1): boolean => name.length >= least && full.startsWith(name);

/** PowerShell's parameters that take the next word as their value, with the least of each name it takes. */
const PS_VALUED: readonly [string, number][] = [
  ['executionpolicy', 2], ['ep', 2], ['inputformat', 3], ['if', 2], ['outputformat', 1], ['of', 2], ['windowstyle', 1], ['version', 1],
  ['psconsolefile', 3], ['configurationname', 6], ['configurationfile', 14], ['workingdirectory', 2], ['wd', 2], ['settingsfile', 8],
  ['custompipename', 3], ['encodedarguments', 8], ['ea', 2],
];

/**
 * PowerShell's base64 -EncodedCommand as the command it holds: UTF-16LE text, read only when it is plainly that, with no
 * control characters a command doesn't hold. Null when it can't be read, so the policy asks.
 */
function decodedCommand(value: string | undefined): string | null {
  const b64 = (value ?? '').replace(/\s+/g, '');
  if (b64 === '' || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length % 2 !== 0) return null;
  const text = bytes.toString('utf16le');
  return /(?![\t\n\r])\p{Cc}/u.test(text) ? null : text;
}

/**
 * powershell and pwsh: -Command by any start of its name (-c, -Com, -Comm), -CommandWithArgs, -EncodedCommand (-e,
 * -ec, -enc) decoded, -File. A word that is no parameter starts the command in Windows PowerShell, which runs it as
 * -Command, and is the script in pwsh, which runs it as -File. With none of these it reads its commands from its input.
 */
function psRun(tool: string, args: readonly string[]): ShellRun {
  let info = false;
  // -WorkingDirectory (-wd) moves the folder the command or script runs in.
  let cwd: string | undefined;
  const out = (o: Partial<ShellRun> & { dialect: Dialect }): ShellRun => shellRun(cwd === undefined ? o : { ...o, cwd });
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const p = psParameter(a);
    if (p === null) {
      if (tool === 'powershell') return out({ dialect: 'powershell', commands: [args.slice(i).join(' ')] });
      return out({ dialect: 'powershell', script: { file: a, rest: args.slice(i + 1) } });
    }
    const { name, value } = p;
    if (name === 'wd' || startsName(name, 'workingdirectory', 2)) {
      cwd = value ?? args[++i] ?? '';
      continue;
    }
    if (startsName(name, 'command')) {
      const command = [...(value !== undefined ? [value] : []), ...args.slice(i + 1)].join(' ');
      return command.trim() === '-' ? out({ dialect: 'powershell', input: true }) : out({ dialect: 'powershell', commands: [command] });
    }
    if (name === 'cwa' || startsName(name, 'commandwithargs', 8)) return out({ dialect: 'powershell', commands: [value ?? args[i + 1] ?? ''] });
    if (name === 'ec' || startsName(name, 'encodedcommand')) {
      const command = decodedCommand(value ?? args[i + 1]);
      return command === null
        ? out({ dialect: 'powershell', unreadable: `Run PowerShell code given in base64 (${tool} -EncodedCommand) that the office can't read` })
        : out({ dialect: 'powershell', commands: [command] });
    }
    if (startsName(name, 'file')) {
      const file = value ?? args[i + 1];
      if (file === undefined || file === '-') return out({ dialect: 'powershell', input: file === '-' });
      return out({ dialect: 'powershell', script: { file, rest: args.slice(i + (value === undefined ? 2 : 1)) } });
    }
    if (name === '?' || startsName(name, 'help')) info = true;
    else if (value === undefined && PS_VALUED.some(([full, least]) => startsName(name, full, least))) i++;
  }
  return out({ dialect: 'powershell', input: !info });
}

/**
 * cmd: /c, /k and /r run the rest as a command (//c as Git Bash writes it, and /cdir with it attached). A single quote is
 * a plain character to cmd but not to the reader, so a command holding one can't be read. To cmd a backslash is a plain
 * character too, the folder separator, where the Bash reader would take it as an escape (`..\..\x` as `....x`): it is
 * read as `/`, which names the same folders. `^`, cmd's escape, stays in the word, so a program or path it splits asks.
 */
function cmdRun(args: readonly string[]): ShellRun {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const m = /^\/\/?([ckr])([\s\S]*)$/i.exec(a);
    if (m) {
      const command = [m[2] ?? '', ...args.slice(i + 1)].join(' ').trim();
      if (command.includes("'")) return shellRun({ dialect: 'bash', unreadable: "Run a cmd command the office can't read: cmd doesn't take ' as a quote" });
      // cmd's `set NAME=value` sets the variable for the commands after it, which the Bash reader takes as a harmless `set`.
      const set = [...command.matchAll(/(?:^|[&|(\s])set\s+(?:\/[ap]\s+)?"?([A-Za-z_][\w]*)=/gi)].find((s) => dangerousEnv(s[1] ?? ''));
      if (set) return shellRun({ dialect: 'bash', unreadable: `Set ${oneLine(set[1] ?? '', 40)} in cmd, which can make a later command run code` });
      return shellRun({ dialect: 'bash', commands: [command.replaceAll('\\', '/')] });
    }
    if (/^\/\/?\?$/.test(a)) return shellRun({ dialect: 'bash' });
  }
  return shellRun({ dialect: 'bash', input: true });
}

/**
 * A shell program: the command it is given (`bash -lc "..."`, `pwsh -Comm "..."`, `cmd /k ...`, a decoded
 * -EncodedCommand) is judged as a command of its own, and a script it runs by name as the script it is. Commands it reads
 * from its input run unread, so they ask, unless that input is a file the redirect named (judged as the script it is).
 */
function shellProgramJudge(tool: string, args: readonly string[], ctx: Ctx, raw: string): Judgement {
  const run = tool === 'cmd' ? cmdRun(args) : tool === 'pwsh' || tool === 'powershell' ? psRun(tool, args) : shRun(tool, args);
  const rule = exactRule('Bash', raw);
  const there = run.cwd === undefined ? ctx : movedTo(run.cwd, ctx);
  const judgements = run.commands.map((command) => toJudgement(judgeShell(command, run.dialect, { ...there, depth: ctx.depth + 1 })));
  if (run.unreadable !== null) judgements.push(ask('other', run.unreadable, rule));
  if (run.script) judgements.push(runFile(run.script.file, tool, there, raw), argsStayInside(run.script.rest, there));
  if (run.input && ctx.stdin === null) judgements.push(ask('other', `Run commands ${tool} reads from its input, which the office can't read first`, rule));
  return first(...judgements);
}

/** The context of a command that runs in another folder (`env -C dir`, `pwsh -WorkingDirectory dir`). */
function movedTo(dir: string, ctx: Ctx): Ctx {
  const expanded = expand(dir, ctx);
  return { ...ctx, cwd: expanded === null || expanded === '' || ctx.cwd === null ? null : ctx.p.resolve(ctx.cwd, expanded), pkg: undefined };
}

/** The process's own input under another name, which a program given it as its script reads its code from. */
const FROM_INPUT = /^\/(?:dev\/(?:stdin|fd\/\d+)|proc\/(?:self|thread-self|\d+)\/fd\/\d+)$/;

/** The code a program reads from its input (a pipe, a heredoc, a here-string) runs unread, so it asks. */
const fromInputAsk = (tool: string, raw: string): Judgement => ask('other', `Run code ${tool} reads from its input, which the office can't read first`, exactRule('Bash', raw));

/** A script a shell or an interpreter runs by name: the project's own code where it lives inside, unless it is its input. */
function runFile(file: string, tool: string, ctx: Ctx, raw: string): Judgement {
  return FROM_INPUT.test(file.trim()) ? fromInputAsk(tool, raw) : readPath(file, ctx);
}

/** The interpreters' family names, for the flags they share. */
const FAMILY: Readonly<Record<string, string>> = { nodejs: 'node', python3: 'python', py: 'python', luajit: 'lua', 'ts-node': 'tsx' };
/** Flags that only print something and run no code, when they are all a command is given. */
const INFO_ONLY: Readonly<Record<string, readonly string[]>> = {
  node: ['-v', '--version', '-h', '--help', '--v8-options'],
  python: ['-V', '-VV', '--version', '-h', '--help', '-?', '--list', '-0', '-0p', '--list-paths'],
  ruby: ['-v', '--version', '-h', '--help'],
  php: ['-v', '--version', '-h', '--help', '-m', '-i', '--ini'],
  lua: ['-v'],
  tsx: ['-v', '--version', '-h', '--help'],
  bun: ['-v', '--version', '-h', '--help'],
  deno: ['-V', '--version', '-h', '--help'],
};

/**
 * The inline code a command line gives an interpreter, however its flag is written: `-e code`, `--eval=code`, `-e"code"`
 * attached, or inside a cluster of short flags (`python -Ic`, `-uc`, `perl -le`, `ruby -ne`). Perl's `-M`/`-m` text becomes
 * a `use` line, so it is code too, and its `-d` starts a debugger that reads commands. Null when there is none.
 */
function inlineCode(tool: string, args: readonly string[]): string | null {
  const family = FAMILY[tool] ?? tool;
  const from = (i: number, attached: string) => [attached, ...args.slice(i + 1)].filter((w) => w !== '').join(' ');
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') return null;
    if (family === 'node' || family === 'tsx' || family === 'bun') {
      const long = /^--(?:eval|print)(?:=([\s\S]*))?$/.exec(a);
      if (long) return from(i, long[1] ?? '');
      const short = /^-[ep]+$/.test(a) ? '' : /^-[ep]([\s\S]+)$/.exec(a)?.[1];
      if (short !== undefined) return from(i, short);
      continue;
    }
    if (family === 'php') {
      const m = /^-([rBRE])([\s\S]*)$/.exec(a);
      if (m) return from(i, m[2] ?? '');
      continue;
    }
    if (!/^-[^-]/.test(a)) continue;
    for (let k = 1; k < a.length; k++) {
      const l = a.charAt(k);
      const rest = a.slice(k + 1);
      if (family === 'python') {
        if (l === 'c') return from(i, rest);
        if (l === 'm' || l === 'W' || l === 'X') break;
      } else if (family === 'ruby') {
        if (l === 'e') return from(i, rest);
        if ('rICEFixTWK0l'.includes(l)) break;
      } else if (family === 'perl') {
        if (l === 'e' || l === 'E' || l === 'M' || l === 'm') return from(i, rest);
        if (l === 'd' || l === 'D') return COMPUTED;
        if ('iIxCF'.includes(l)) break;
        if (l === 'l' || l === '0') k += /^[0-7]*/.exec(rest)?.[0].length ?? 0;
      } else if (family === 'lua') {
        if (l === 'e') return from(i, rest);
        if (l === 'l') return `require ${from(i, rest)}`;
      } else {
        if (l === 'e' || l === 'c') return from(i, rest);
      }
    }
  }
  return null;
}

/**
 * Python's own options before its script: inline code (`-c`, in a cluster too), a module (`-m`, `-Im`), or the script.
 * Its options take no values but -W and -X, and stop at the first word that isn't one.
 */
function pythonArgs(args: readonly string[]): { module: { name: string; rest: string[] } | null; file: string | undefined } {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') return { module: null, file: args[i + 1] };
    if (a === '-' || !a.startsWith('-')) return { module: null, file: a };
    if (a.startsWith('--')) continue;
    for (let k = 1; k < a.length; k++) {
      const l = a.charAt(k);
      if (l === 'm') {
        const attached = a.slice(k + 1);
        return { module: attached !== '' ? { name: attached, rest: args.slice(i + 1) } : { name: args[i + 1] ?? '', rest: args.slice(i + 2) }, file: undefined };
      }
      if (l === 'W' || l === 'X') {
        if (k === a.length - 1) i++;
        break;
      }
    }
  }
  return { module: null, file: undefined };
}

/**
 * Python modules known as the project's tools: test runners, linters and builders that run the project's own code and
 * nothing a command line hands them. Any other module asks: `timeit -s`, `code`, `pdb`, `runpy` and the like run code given
 * on the command line or read from the input.
 */
const PYTHON_TOOLS = new Set([
  'pytest', 'unittest', 'venv', 'json.tool', 'py_compile', 'compileall', 'mypy', 'black', 'ruff', 'isort', 'flake8', 'pylint', 'pyright', 'build', 'doctest',
  // Dev servers and project tools: they import and serve the project's own app. A host such as 0.0.0.0 is where the server
  // listens, not a write or a send.
  'uvicorn', 'flask', 'gunicorn', 'hypercorn', 'django', 'fastapi', 'alembic', 'mkdocs',
]);
/** Their subcommands that run code typed on the command line or read from the input (`django shell -c`, `flask shell`). */
const PYTHON_SHELLS = new Set(['shell', 'dbshell', 'shell_plus']);

/** A module of the project itself (`python -m app`, `-m pkg.cli`): a file or package under the working folder. */
function projectModule(name: string, ctx: Ctx): boolean {
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(name) || ctx.cwd === null) return false;
  const base = ctx.p.join(ctx.cwd, ...name.split('.'));
  return [`${base}.py`, ctx.p.join(base, '__main__.py'), ctx.p.join(base, '__init__.py')].some(exists);
}

function pythonModuleJudge(name: string, rest: string[], ctx: Ctx, raw: string): Judgement {
  const rule = exactRule('Bash', raw);
  if (name === 'pip') return pipJudge(rest, ctx, raw);
  if (name === 'twine' || name === 'flit') return ask('publish', 'Publish the package to PyPI', rule);
  if (name === 'coverage' && rest[0] === 'run') {
    // `coverage run -m <module>` runs that module, `coverage run <file>` that script.
    const m = rest.findIndex((a) => a === '-m' || a === '--module');
    if (m !== -1) return pythonModuleJudge(rest[m + 1] ?? '', rest.slice(m + 2), ctx, raw);
    const file = positionals(rest.slice(1), new Set(['--rcfile', '--source', '--include', '--omit', '--context', '--data-file', '--concurrency']))[0];
    return first(file === undefined ? ALLOW : runFile(file, 'python', ctx, raw), argsStayInside(rest, ctx));
  }
  if (name === 'coverage') return argsStayInside(rest, ctx);
  // A server only this computer reaches is a preview; the default listens to every network the computer is on.
  if (name === 'http.server') {
    const bind = flagValues(rest, ['-b', '--bind'])[0];
    return bind !== undefined && LOOPBACK.test(bind) ? argsStayInside(rest, ctx) : ask('other', "Serve the project's files to other computers on the network (python -m http.server)", rule);
  }
  // gunicorn and hypercorn take their address with -b as well as --bind (argsStayInside reads --bind).
  if (name === 'gunicorn' || name === 'hypercorn') {
    const wide = [...flagValues(rest, ['-b']), ...rest.filter((a) => /^-b./.test(a)).map((a) => a.slice(2))].map(listenHost).find((h) => h !== null && !LOOPBACK.test(h));
    if (wide !== undefined && wide !== null) return ask('other', `Serve the project on ${wide}, which other computers on the network can reach (python -m ${name})`, rule);
  }
  if ((name === 'django' || name === 'flask') && PYTHON_SHELLS.has(positionals(rest)[0] ?? '')) {
    return ask('other', `Run code typed into ${name}'s shell, which the office can't read first (python -m ${name} ${oneLine(positionals(rest)[0] ?? '', 20)})`, rule);
  }
  // mkdocs gh-deploy publishes and alembic upgrade changes a database, as the programs do.
  if (name === 'mkdocs' || name === 'alembic') return devToolJudge(name, rest, ctx, raw);
  if (PYTHON_TOOLS.has(name) || projectModule(name, ctx)) return argsStayInside(rest, ctx);
  return ask('other', `Run the Python module ${oneLine(name || 'it is given', 40)}, which the office doesn't know as one of the project's tools`, rule);
}

/**
 * deno: `eval` runs inline code; publish, deploy and a release task ask; a module from the network (`https:`, `npm:`,
 * `jsr:`, an import map or config there) asks wherever deno would run or install it, and `deno x` runs a package's program;
 * a bare `deno` or `deno run -` reads its code from its input.
 */
function denoJudge(args: string[], ctx: Ctx, raw: string): Judgement {
  const rule = exactRule('Bash', raw);
  const words = subcommandWords(args);
  const sub = words[0];
  if (sub === 'eval') return judgeInlineCode(positionals(args).slice(1).join(' '), raw);
  const release = releaseAsk('deno', words, raw);
  if (release) return release;
  if (sub === 'install' && has(args, '-g', '--global')) return ask('global-config', 'Install a program with deno for the whole computer');
  const remote = args.find((a) => /(?:^|=)(?:https?|npm|jsr|data|blob):/i.test(a));
  const runs = sub === undefined || ['run', 'x', 'serve', 'test', 'bench', 'install', 'i', 'repl', 'compile', 'cache'].includes(sub) || remote === sub;
  if (remote !== undefined && runs) return ask('other', `Run ${oneLine(remote.replace(/^[^=]*=/, ''), 60)} from the network, which the project doesn't hold`, rule);
  if (sub === 'x') return ask('other', `Run ${oneLine(words[1] ?? 'a package', 40)} with deno x, which the project doesn't hold`, rule);
  if (sub === undefined || sub === 'repl') {
    const info = args.length > 0 && args.every((a) => INFO_ONLY.deno?.includes(a));
    return info || ctx.stdin !== null ? ALLOW : fromInputAsk('deno', raw);
  }
  if (sub === 'run') {
    const script = positionals(args, new Set(['-c', '--config', '--import-map', '--location', '--seed', '--cert', '--lock', '-L', '--log-level']))[1];
    if (script === undefined || script === '-') return ctx.stdin !== null ? argsStayInside(args, ctx) : fromInputAsk('deno', raw);
    return first(runFile(script, 'deno', ctx, raw), argsStayInside(args, ctx));
  }
  return argsStayInside(args, ctx);
}

function interpreterJudge(tool: string, args: string[], ctx: Ctx, raw: string): Judgement {
  if (SHELL_PROGRAMS.has(tool)) return shellProgramJudge(tool, args, ctx, raw);
  if (tool === 'deno') return denoJudge(args, ctx, raw);
  const family = FAMILY[tool] ?? tool;
  // Code node loads before the script does.
  if (family === 'node' && args.some((a) => /^(?:-r|--require|--import|--loader|--experimental-loader)(?:=|$)/.test(a) || /^-r./.test(a))) {
    return ask('other', 'Run node with code of its own loaded first (-r, --import or --loader)', exactRule('Bash', raw));
  }
  // `node --run deploy` runs a package script by its name, and no pre or post script with it.
  if (family === 'node') {
    const script = valueOf(args, '--run') ?? args.find((a) => a.startsWith('--run='))?.slice('--run='.length);
    if (script !== undefined) return scriptJudge(script, tool, ctx, raw, false);
  }
  // A flag found after the script is the script's own, but the script it names is still judged.
  const code = inlineCode(tool, args);
  if (code !== null) return first(judgeInlineCode(code, raw), argsStayInside(args, ctx));
  const python = family === 'python' ? pythonArgs(args) : null;
  if (python?.module) return first(pythonModuleJudge(python.module.name, python.module.rest, ctx, raw), argsStayInside(args, ctx));
  // A script runs where it lives: inside the project it is the project's own code.
  const file = python
    ? python.file
    : valueOf(args.map((a) => a.toLowerCase()), '-file') !== undefined
      ? args[args.findIndex((a) => a.toLowerCase() === '-file') + 1]
      : positionals(args, new Set(['-r', '--require', '--import', '--loader', '-W', '-X', '--env-file']))[0];
  if (file === undefined || file === '-') {
    // With no script it runs what it reads from its input: asked, unless that input is a file the command names (judged as
    // a read where it is redirected), or the command only asks for the version or the help, or runs node's test runner.
    const info = file === undefined && args.length > 0 && args.every((a) => INFO_ONLY[family]?.includes(a));
    const tests = file === undefined && family === 'node' && args.includes('--test');
    return info || tests || ctx.stdin !== null ? argsStayInside(args, ctx) : fromInputAsk(tool, raw);
  }
  return first(runFile(file, tool, ctx, raw), argsStayInside(args, ctx));
}

// -U is --upgrade, which takes no value: read as one, it hid the package after it.
const PIP_VALUED = new Set(['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-i', '--index-url', '--extra-index-url', '-f', '--find-links', '-t', '--target', '--prefix', '--root', '--proxy', '--trusted-host', '--cert', '--python']);

function pipJudge(args: string[], ctx: Ctx, raw: string): Judgement {
  const sub = positionals(args, PIP_VALUED)[0];
  if (sub === 'config') return ask('global-config', "Change pip's settings");
  if ((sub === 'install' || sub === 'uninstall') && has(args, '--user', '--break-system-packages')) return ask('global-config', 'Install Python packages for the whole computer');
  if (sub === 'upload') return ask('publish', 'Publish the package to PyPI', exactRule('Bash', raw));
  if (sub !== 'install' && sub !== 'download') return ALLOW;
  const judgements: Judgement[] = [];
  const named: string[] = [];
  let subSeen = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const name = a.startsWith('--') ? a.split('=')[0] ?? a : a.length === 2 ? a : a.slice(0, 2);
    const attached = a.startsWith('--') ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : null) : a.length > 2 && a.startsWith('-') ? a.slice(2) : null;
    if (/^(?:--index-url|-i|--extra-index-url|--find-links|-f|--trusted-host|--proxy)$/.test(name)) {
      judgements.push(ask('other', `Run pip against another package index or address (${name})`, exactRule('Bash', raw)));
      continue;
    }
    if (a.startsWith('-') && PIP_VALUED.has(name)) {
      const value = attached ?? args[++i] ?? '';
      // Requirement, constraint and editable paths are files or folders; the others only name where things go.
      if (/^(?:-r|--requirement|-c|--constraint|-e|--editable)$/.test(name)) judgements.push(/:\/\/|^git\+/i.test(value) ? ask('other', `Install from ${oneLine(value, 60)}, an address instead of the index`) : readPath(value, ctx, 'Install from'));
      else if (/^(?:-t|--target|--prefix|--root)$/.test(name)) judgements.push(writePath(value, ctx, 'Install into'));
      continue;
    }
    if (a.startsWith('-')) continue;
    if (!subSeen && (a === 'install' || a === 'download')) {
      subSeen = true;
      continue;
    }
    // A requirement: a name, a name with a version, a path, or an address (`git+`, `https://`, `name @ url`).
    if (/:\/\/|^(?:git|hg|svn|bzr)\+| @ |@\s*(?:https?|git|file):/i.test(a)) judgements.push(ask('other', `Install ${oneLine(a, 60)}, a package from an address instead of the index`, exactRule('Bash', raw)));
    else if (/^(?:\.{0,2}[\\/]|~|[A-Za-z]:[\\/]|\/)/.test(a) || /\.\.[\\/]/.test(a)) judgements.push(readPath(a, ctx, 'Install from'));
    else named.push(a);
  }
  return first(...judgements, pythonInstallAsk(named, ctx, raw));
}

/** Programs that only read: their path words are reads. */
const READERS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'ls', 'dir', 'tree', 'stat', 'file', 'du', 'df', 'diff', 'cmp', 'md5sum', 'sha1sum', 'sha256sum',
  'shasum', 'realpath', 'readlink', 'basename', 'dirname', 'cut', 'nl', 'column', 'strings', 'xxd', 'od', 'hexdump', 'type',
  'get-content', 'gc', 'get-childitem', 'gci', 'test-path', 'get-item', 'gi', 'resolve-path', 'get-filehash', 'bat', 'select-string', 'sls',
  'import-csv', 'get-acl', 'jq', 'yq', 'zipinfo',
]);
/** Readers that only list names or test that something is there: they may look in the folders of installed programs. */
const NAME_LISTERS = new Set(['ls', 'dir', 'stat', 'tree', 'test-path', 'get-childitem', 'gci', 'get-item', 'gi', 'resolve-path']);
/** PowerShell's ways to read the computer's processes and network state, without a remote computer. */
const CIM_READERS = new Set(['get-ciminstance', 'gcim', 'get-wmiobject', 'gwmi', 'get-nettcpconnection', 'get-netudpendpoint']);
/** Programs that write or delete their path words, with the verb the summary uses. */
const WRITERS = new Map<string, string>([
  ['rm', 'Delete'], ['rmdir', 'Delete'], ['del', 'Delete'], ['erase', 'Delete'], ['rd', 'Delete'], ['unlink', 'Delete'], ['shred', 'Delete'],
  ['remove-item', 'Delete'], ['ri', 'Delete'], ['mkdir', 'Make'], ['md', 'Make'], ['new-item', 'Make'], ['ni', 'Make'], ['touch', 'Change'],
  ['chmod', 'Change'], ['chown', 'Change'], ['chgrp', 'Change'], ['truncate', 'Change'], ['tee', 'Write'], ['set-content', 'Write'],
  ['sc', 'Write'], ['add-content', 'Write'], ['ac', 'Write'], ['out-file', 'Write'], ['clear-content', 'Change'], ['rename-item', 'Rename'],
  ['ren', 'Rename'], ['rename', 'Rename'], ['rni', 'Rename'], ['install', 'Change'],
]);
/** Programs whose last path word is written and the others read (moved, for a move). */
const COPIERS = new Map<string, string>([
  ['cp', 'Copy'], ['copy', 'Copy'], ['copy-item', 'Copy'], ['cpi', 'Copy'], ['xcopy', 'Copy'], ['robocopy', 'Copy'], ['mv', 'Move'],
  ['move', 'Move'], ['move-item', 'Move'], ['mi', 'Move'], ['ln', 'Link'], ['mklink', 'Link'], ['rsync', 'Copy'],
]);
/**
 * An archiver's words without the patterns it is told to leave out or in (`--exclude=.git`, `--exclude .git`, `zip -x
 * "*.log"`): they are matched against names, never opened, so `.git` there is no change to git's folder.
 */
function withoutPatterns(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (/^--(?:exclude|include|exclude-tag|exclude-ignore)=/.test(a)) continue;
    if (/^--(?:exclude|include|exclude-tag|exclude-ignore)$/.test(a)) {
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * tar options that name a program it starts (`-I`, `--use-compress-program`, `--to-command`, `--checkpoint-action`, `-F` and
 * the volume scripts), in any form: a long name with `=` or a space, a letter in a cluster (`-cIf`), or in the old style
 * without a dash (`tar cIf prog x.tar`), and a long name shortened as GNU tar accepts (`--to-com=prog`). zip's `-TT` names
 * the command that tests an archive.
 */
function runsAProgram(tool: string, args: readonly string[]): boolean {
  if (tool === 'zip') return args.some((a) => /^-TT/.test(a) || /^--unzip-command/.test(a));
  if (tool !== 'tar') return false;
  const old = oldStyleTar(args);
  return (old !== null && /[IF]/.test(old)) || args.some((a) => longOption(a, ['use-compress-program', 'to-command', 'checkpoint-action', 'info-script', 'new-volume-script', 'rsh-command', 'remote-shell']) || /^-[A-Za-z]*[IF]/.test(a));
}

/** tar's first word in the old style, letters without a dash (`tar xzf x.tgz`), or null. */
const oldStyleTar = (args: readonly string[]): string | null => (args[0] !== undefined && /^[A-Za-z]+$/.test(args[0]) ? args[0] : null);

/** Whether a word is one of the long options `names`, whole or shortened to a start of at least two letters (GNU's getopt takes either). */
function longOption(word: string, names: readonly string[]): boolean {
  const given = /^--([A-Za-z][\w-]*)(?:=|$)/.exec(word)?.[1];
  return given !== undefined && given.length >= 2 && names.some((name) => name.startsWith(given));
}

/** The values of tar's renaming options in every form: `--transform=x`, `--xform x` (or a start of either), bsdtar's `-s x`, `-sx`, `-xs x`. */
function tarRenames(args: readonly string[]): string[] | null {
  const values: string[] = [];
  let found = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (longOption(a, ['transform', 'xform'])) {
      found = true;
      values.push(a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[++i] ?? ''));
      continue;
    }
    const s = /^-[A-Za-z]*s([\s\S]*)$/.exec(a);
    if (s && !a.startsWith('--')) {
      found = true;
      values.push(s[1] !== '' ? (s[1] ?? '') : (args[++i] ?? ''));
    }
  }
  const old = oldStyleTar(args);
  if (old !== null && old.includes('s')) found = true;
  return found ? values : null;
}

/**
 * What an archiver unpacks into the folder, or null when it only packs, lists or tests: the folders it unpacks into
 * (`-C`, `--directory`, unzip's `-d`, 7z's `-o`; the working folder when none is named) and whether it may write
 * outside them (`-P`, `--absolute-names`, unzip's `-:`) or is one the office never lets unpack silently (7z, Expand-Archive).
 */
function unpacks(tool: string, args: readonly string[]): { into: string[]; anywhere: boolean } | null {
  if (tool === 'tar') {
    const old = oldStyleTar(args);
    const extracting = (old !== null && old.includes('x')) || args.some((a) => longOption(a, ['extract', 'get']) || /^-[A-Za-z]*x/.test(a));
    if (!extracting) return null;
    const into: string[] = [];
    let anywhere = old !== null && old.includes('P');
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? '';
      if (longOption(a, ['directory'])) into.push(a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[++i] ?? ''));
      else if (longOption(a, ['absolute-names'])) anywhere = true;
      else if (/^-[A-Za-z]/.test(a)) {
        // A letter that takes a value takes the rest of its word, or the next word: `-C dir`, `-Cdir`, `-xC dir`.
        for (let k = 1; k < a.length; k++) {
          const l = a.charAt(k);
          if (l === 'P') anywhere = true;
          if (!'fCTXbHKLNVgIF'.includes(l)) continue;
          const value = k + 1 < a.length ? a.slice(k + 1) : (args[++i] ?? '');
          if (l === 'C') into.push(value);
          break;
        }
      }
    }
    return { into: into.length > 0 ? into : ['.'], anywhere };
  }
  if (tool === 'unzip') {
    if (args.some((a) => /^-[A-Za-ce-z]*[ltvZpcz]/.test(a))) return null;
    const into = flagValues(args, ['-d']).concat(args.filter((a) => /^-d./.test(a)).map((a) => a.slice(2)));
    return { into: into.length > 0 ? into : ['.'], anywhere: args.some((a) => /^-\S*[:^]/.test(a)) };
  }
  if (tool === '7z') {
    const sub = positionals(args)[0]?.toLowerCase();
    return sub === 'x' || sub === 'e' ? { into: args.filter((a) => /^-o./.test(a)).map((a) => a.slice(2)), anywhere: true } : null;
  }
  if (tool === 'expand-archive') return { into: [], anywhere: true };
  return null;
}

/**
 * The files gzip, xz and zstd write when they decompress in place: each file named without its suffix (`CLAUDE.md.gz` writes
 * CLAUDE.md). Null when they write elsewhere by a name the office can't know (a suffix of their own with `-S`, the name kept
 * inside the file with `-N`); empty when they don't decompress to a file (they compress, test, list or write to the output).
 */
function decompressed(tool: string, args: readonly string[]): string[] | null {
  if (tool !== 'gzip' && tool !== 'gunzip' && tool !== 'xz' && tool !== 'zstd') return [];
  const short = args.filter((a) => /^-[A-Za-z]+$/.test(a)).join('');
  const decompressing = tool === 'gunzip' || /d/.test(short) || has(args, '--decompress', '--uncompress');
  if (!decompressing || /[ctl]/.test(short) || has(args, '--stdout', '--to-stdout', '--test', '--list')) return [];
  if (/[NS]/.test(short) || has(args, '--name', '--suffix') || args.some((a) => /^-S./.test(a))) return null;
  return positionals(args, new Set(['-o', '-T', '--threads'])).map((file) =>
    file.replace(/\.t(?:gz|az|xz|zst)$/i, '.tar').replace(/(?:\.(?:gz|z|xz|lzma|zst|zstd)|[-_]gz|[-_]z)$/i, ''),
  );
}

/**
 * An archiver: a program it starts asks; renaming what it packs or unpacks asks every time (`--transform 's,^cfg,.claude,'`
 * turns a harmless folder into setup); every word that leaves the folder is judged as a write; and unpacking into the
 * project asks every time, since what an archive holds (a .claude folder, a .git/hooks file, an .npmrc) is only known once
 * it is out. Unpacking with tar or unzip into the desk's own scratch folder, with nothing that writes outside it, is the
 * desk's own work.
 */
function archiveJudge(tool: string, args: string[], ctx: Ctx, rule: AlwaysRule | null): Judgement {
  if (runsAProgram(tool, args)) return ask('other', `Run ${tool} with an option that makes it start another program`, rule);
  const renames = tool === 'tar' ? tarRenames(args) : null;
  if (renames !== null) {
    if (renames.some((v) => /\.worklings/i.test(v))) return deny(RECORDS);
    return askSetup('Rename what tar packs or unpacks with a pattern, which can turn a name into .claude, .git or another setup file');
  }
  const writes = first(...withoutPatterns(args).flatMap(optionValues).map((a) => writePath(a, ctx, 'Write')));
  if (writes.verdict !== 'allow') return writes;
  const outputs = decompressed(tool, args);
  if (outputs === null) return askSetup(`Decompress with ${tool} under a name kept inside the file, which can be a setup file such as .claude or .npmrc`);
  const named = first(...outputs.map((file) => writePath(file, ctx, 'Write')));
  if (named.verdict !== 'allow') return named;
  const unpacking = unpacks(tool, args);
  if (unpacking === null) return ALLOW;
  const places = unpacking.into.map((dir) => placeOf(dir, ctx));
  if (!unpacking.anywhere && places.length > 0 && places.every((w) => w.place === 'scratch')) return ALLOW;
  return askSetup(`Unpack an archive with ${tool}: what it holds is only known once it is out, and it can write .claude, .git or another setup file`);
}

/** Archives: see archiveJudge. */
const ARCHIVERS = new Set(['tar', 'zip', 'unzip', '7z', 'gzip', 'gunzip', 'xz', 'zstd', 'expand-archive', 'compress-archive']);
/** Programs that are harmless whatever their words. */
const HARMLESS_PROGRAMS = new Set([
  'echo', 'printf', 'true', 'false', 'test', '[', '[[', ':', 'tr', 'pwd', 'date', 'whoami', 'hostname', 'uname', 'which', 'where', 'sleep', 'cygpath',
  'exit', 'unset', 'write-output', 'write-host', 'write-error', 'write-verbose', 'get-date', 'get-location', 'get-command', 'gcm', 'get-process',
  'gps', 'ps', 'get-service', 'select-object', 'select', 'where-object', 'foreach-object', 'sort-object', 'measure-object', 'compare-object',
  'format-table', 'format-list', 'ft', 'fl', 'out-string', 'out-null', 'convertfrom-json', 'convertto-json', 'get-help', 'tasklist', 'lsof',
  'netstat', 'seq', 'yes', 'wait', 'jobs', 'read', 'shift', 'local', 'readonly', 'alias', 'history', 'clear', 'cls', 'nproc', 'id', 'groups',
  'tput', 'stty', 'ver', 'locale', 'getconf', 'return', 'break', 'continue', 'start-sleep', 'set -e', 'set', 'export', 'declare', 'typeset',
]);
/** The project's own tools: tests, builds, linters, dev servers. Their path words are checked only when they leave. */
const DEV_TOOLS = new Set([
  'tsc', 'eslint', 'prettier', 'biome', 'oxlint', 'stylelint', 'vitest', 'jest', 'mocha', 'ava', 'c8', 'nyc', 'vite', 'webpack', 'rollup',
  'esbuild', 'parcel', 'tsup', 'unbuild', 'turbo', 'nx', 'astro', 'next', 'nuxt', 'nuxi', 'remix', 'svelte-kit', 'gatsby', 'storybook',
  'tailwindcss', 'postcss', 'sass', 'babel', 'rimraf', 'concurrently', 'nodemon', 'serve', 'http-server', 'live-server', 'vue-tsc',
  'svelte-check', 'lint-staged', 'husky', 'commitlint', 'typedoc', 'knip', 'madge', 'size-limit', 'react-native', 'expo', 'pod', 'xcodebuild',
  'swift', 'gradle', 'gradlew', 'mvn', 'cmake', 'ninja', 'meson', 'make', 'just', 'pytest', 'ruff', 'black', 'isort', 'mypy', 'pyright', 'pylint',
  'flake8', 'tox', 'nox', 'poetry', 'pipenv', 'uv', 'hatch', 'flit', 'twine', 'conda', 'rustc', 'rustfmt', 'cargo', 'go', 'gofmt', 'golangci-lint',
  'bundle', 'gem', 'rake', 'rails', 'rspec', 'mix', 'composer', 'artisan', 'dotnet', 'flutter', 'dart', 'tauri', 'cap', 'ionic', 'ng', 'electron',
  'wasm-pack', 'protoc', 'buf', 'prisma', 'drizzle-kit', 'hugo', 'jekyll', 'mkdocs', 'zola', 'lighthouse', 'playwright', 'cypress', 'sharp',
  'alembic', 'svgo', 'magick', 'ffmpeg', 'ffprobe', 'gltf-transform', 'changeset', 'lerna', 'electron-builder', 'node-gyp', 'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'find', 'sed', 'awk', 'gawk', 'perl', 'xargs', 'diff3', 'patch', 'mysql', 'psql', 'mongosh', 'redis-cli',
]);

/** The values that follow any of `flags` (`-e code`), joined; for inline code given to perl, awk and the like. */
function inlineValues(args: readonly string[], flags: readonly string[]): string {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i] ?? '')) {
      out.push(args[i + 1] ?? '');
      i++;
    }
  }
  return out.join('\n');
}

/** sed's inline scripts: every -e/--expression, or the first positional when neither -e nor -f gives the script. */
function sedScripts(args: readonly string[]): string[] {
  const scripts: string[] = [];
  let given = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '-e' || a === '--expression') {
      scripts.push(args[i + 1] ?? '');
      given = true;
      i++;
    } else if (a.startsWith('--expression=')) {
      scripts.push(a.slice('--expression='.length));
      given = true;
    } else if (a === '-f' || a === '--file' || a.startsWith('--file=') || (/^-[a-z]*f/.test(a) && !a.startsWith('--'))) {
      given = true; // the script is in a file, which isn't read here
    }
  }
  if (!given) {
    const first = positionals(args)[0];
    if (first !== undefined) scripts.push(first);
  }
  return scripts;
}

/** What sed is given besides its scripts (`-e script`, `-f file`, or the first word when neither is used): options and files. */
function sedFiles(args: readonly string[]): string[] {
  const out: string[] = [];
  let scripted = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '-e' || a === '--expression' || a === '-f' || a === '--file') {
      scripted = true;
      i++;
    } else if (a.startsWith('--expression=') || a.startsWith('--file=')) scripted = true;
    else out.push(a);
  }
  if (scripted) return out;
  const at = out.findIndex((a) => !a.startsWith('-'));
  return at === -1 ? out : out.filter((_a, k) => k !== at);
}

/** A sed script that runs a shell command (the `e` command, the s///e flag) or writes a file (w/W, the s///w flag). */
const SED_COMMAND = /(?:^|[;{}\n])[ \t]*(?:[0-9]+|\$|\/(?:\\.|[^/\\])*\/[IM]*|,|~[0-9]+|\+[0-9]+|![ \t]*|[ \t])*[ \t]*[ewW](?:[ \t]|;|$)/;
// An `s` starts a substitution only where a command can start: not at the end of a word inside one (`rows.filter`).
const SED_SUBST = /(?<![\w.$\\])s([^\s\w\\;])(?:\\.|(?!\1)[\s\S])*?\1(?:\\.|(?!\1)[\s\S])*?\1([0-9gpmiMI]*)/g;
const SED_SUBST_FLAG = /(?<![\w.$\\])s([^\s\w\\;])(?:\\.|(?!\1)[\s\S])*?\1(?:\\.|(?!\1)[\s\S])*?\1[0-9gpmiMI]*[ew]/;
// What a substitution says (its pattern and replacement are text, even when they hold braces or `;`) is cut out before
// the rest is read for commands.
const sedRunsOrWrites = (script: string): boolean => SED_SUBST_FLAG.test(script) || SED_COMMAND.test(script.replace(SED_SUBST, 's'));

/** awk's program: every -e/--source, or the first positional when neither that nor -f gives it; null when -f does. */
function awkProgram(args: readonly string[]): string | null {
  const given = inlineValues(args, ['-e', '--source']);
  if (given !== '') return given;
  if (args.some((a) => a === '-f' || a === '--file' || a.startsWith('--file=') || (/^-[a-z]*f/.test(a) && !a.startsWith('--')))) return null;
  return positionals(args, new Set(['-F', '--field-separator', '-v', '--assign', '-e', '--source', '-f', '--file']))[0] ?? null;
}

/** An awk program that runs a command (`system()`, a pipe to or from getline) or writes a file (a print redirect). */
const AWK_POWERS = /\bsystem\s*\(|\bprintf?\b[^;{}\n)]*(?:>>?|\|)|getline\s*<|[|&][ \t]*getline/;

/** go's build flags that take the next word, so it isn't read as the package. */
const GO_VALUED = new Set([
  '-o', '-p', '-C', '-tags', '-ldflags', '-gcflags', '-asmflags', '-mod', '-modfile', '-overlay', '-pgo', '-exec', '-toolexec', '-buildmode', '-compiler',
  '-gccgoflags', '-installsuffix', '-pkgdir', '-coverpkg', '-covermode',
]);
/** The options of `uv add`, `poetry add` and `pipenv install` that take the next word, so it isn't read as a package. */
const PY_ADD_VALUED = new Set([
  '--group', '-G', '--optional', '--extra', '--python', '-p', '--index', '--default-index', '--source', '--package', '--project', '--directory', '-C', '-r',
  '--requirements', '--rev', '--tag', '--branch', '-m', '--marker', '--bounds', '--constraints', '--extra-index-url', '-i', '--index-url',
]);

/** uvx and `uv tool run` download a program from the Python package index and run it. */
function uvxAsk(args: readonly string[], rule: AlwaysRule | null): Judgement {
  const name = positionals(args, new Set(['--from', '--with', '--with-editable', '--with-requirements', '--python', '-p', '--index', '--index-url', '--extra-index-url']))[0];
  return ask('other', `Run ${oneLine(name ?? 'a tool', 40)} from the Python package index, which the project doesn't depend on`, rule);
}

/** The files `find` writes its list to (-fprint, -fprint0, -fprintf, -fls). */
const findOutputs = (args: readonly string[]): string[] => args.flatMap((a, k) => (['-fprint', '-fprint0', '-fprintf', '-fls'].includes(a) ? [args[k + 1] ?? ''] : []));

/**
 * sort: the files it reads, the one it writes (`-o file`, `-ofile`, `-uo file`, `--output=file`) and the folder it keeps its
 * temporary files in (`-T`).
 */
function sortJudge(args: readonly string[], ctx: Ctx): Judgement {
  const writes: string[] = [];
  const reads: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      reads.push(...args.slice(i + 1));
      break;
    }
    const long = /^--(output|temporary-directory|files0-from|key|field-separator|buffer-size|compress-program|parallel|batch-size|sort|random-source)(?:=([\s\S]*))?$/.exec(a);
    if (long) {
      const value = long[2] ?? args[++i] ?? '';
      if (long[1] === 'output' || long[1] === 'temporary-directory') writes.push(value);
      else if (long[1] === 'files0-from' || long[1] === 'random-source') reads.push(value);
      continue;
    }
    if (a.startsWith('--') || a === '-') continue;
    if (!a.startsWith('-')) {
      reads.push(a);
      continue;
    }
    for (let k = 1; k < a.length; k++) {
      const l = a.charAt(k);
      if ('oTktS'.includes(l)) {
        const value = k + 1 < a.length ? a.slice(k + 1) : (args[++i] ?? '');
        if (l === 'o' || l === 'T') writes.push(value);
        break;
      }
    }
  }
  if (args.some((a) => /^--compress-program/.test(a))) return ask('other', 'Run sort with a program of its own (--compress-program)');
  return first(...writes.map((w) => writePath(w, ctx, 'Write')), ...reads.map((r) => readPath(r, ctx)));
}

function devToolJudge(tool: string, args: string[], ctx: Ctx, raw: string): Judgement {
  const pos = positionals(args);
  const words = pos.join(' ');
  const sub = pos[0];
  const rule = exactRule('Bash', raw);
  const served = serverJudge(tool, args, rule);
  if (served.verdict !== 'allow') return served;
  switch (tool) {
    case 'cargo':
      if (sub === 'publish' || sub === 'yank' || sub === 'owner') return ask('publish', 'Publish the crate to crates.io', rule);
      if (sub === 'install' || sub === 'login' || sub === 'logout') return ask('global-config', `Install ${pos[1] ?? 'a program'} for the whole computer`);
      break;
    case 'go': {
      if (sub === 'install') return ask('global-config', `Install ${pos[1] ?? 'a program'} for the whole computer`);
      if (sub === 'env' && has(args, '-w', '-u')) return ask('global-config', "Change Go's settings for the whole computer");
      // -exec and -toolexec put a program of their choosing in front of what go builds and runs.
      if (args.some((a) => /^--?(?:exec|toolexec)(?:=|$)/.test(a))) return ask('other', `Run go with a program of its own in between (go ${oneLine(sub ?? '', 20)} -exec)`, rule);
      // `go run module/path@version` downloads that module and runs it.
      if (sub === 'run') {
        const target = positionals(args.slice(args.indexOf('run') + 1), GO_VALUED)[0];
        if (target !== undefined && target.includes('@') && !/^\.{0,2}[\\/]/.test(target)) return ask('other', `Run ${oneLine(target, 60)} from the network, which the project doesn't hold`, rule);
      }
      break;
    }
    case 'gem':
      if (sub === 'push' || sub === 'yank') return ask('publish', 'Publish the gem', rule);
      if (sub === 'install' || sub === 'uninstall' || sub === 'update') return ask('global-config', 'Install Ruby gems for the whole computer');
      break;
    case 'dotnet':
      if (words.startsWith('nuget push')) return ask('publish', 'Publish the package to NuGet', rule);
      if (sub === 'tool' && has(args, '-g', '--global')) return ask('global-config', 'Install a .NET tool for the whole computer');
      break;
    case 'uv': case 'poetry': case 'pipenv': case 'hatch': case 'flit': case 'twine':
      if (sub === 'publish' || sub === 'upload') return ask('publish', 'Publish the package to PyPI', rule);
      if (tool === 'uv' && sub === 'tool' && pos[1] === 'install') return ask('global-config', `Install ${pos[2] ?? 'a tool'} for the whole computer`);
      if (tool === 'uv' && sub === 'tool' && (pos[1] === 'run' || pos[1] === 'x')) return uvxAsk(args.slice(args.indexOf(pos[1]) + 1), rule);
      if (tool === 'uv' && sub === 'pip' && pos[1] === 'install') return pipJudge(args.slice(args.indexOf('pip') + 1), ctx, raw);
      if (((tool === 'uv' || tool === 'poetry') && sub === 'add') || (tool === 'pipenv' && sub === 'install')) {
        const specs = positionals(args.slice(args.indexOf(sub) + 1), PY_ADD_VALUED);
        const elsewhere = specs.find((s) => /:\/\/|^(?:git|hg|svn|bzr)\+|@\s*(?:https?|git|file):/i.test(s));
        if (elsewhere !== undefined) return ask('other', `Install ${oneLine(elsewhere, 60)}, a package from an address instead of the index`, rule);
        const paths = specs.filter((s) => /^(?:\.{0,2}[\\/]|~|[A-Za-z]:[\\/]|\/)|^\.{1,2}$/.test(s) || /\.\.[\\/]/.test(s));
        return first(...paths.map((p) => readPath(p, ctx, 'Install from')), pythonInstallAsk(specs.filter((s) => !paths.includes(s)), ctx, raw), argsStayInside(args, ctx));
      }
      break;
    case 'lerna': case 'changeset':
      if (sub === 'publish') return ask('publish', `Publish the packages with ${tool}`, rule);
      break;
    case 'electron-builder':
      if (has(args, '--publish', '-p') && !args.includes('never')) return ask('publish', 'Publish the app with electron-builder', rule);
      break;
    case 'mkdocs':
      if (sub === 'gh-deploy') return ask('publish', 'Publish the docs to GitHub Pages', rule);
      break;
    case 'ng': case 'hugo':
      if (sub === 'deploy') return ask('deploy', `Deploy with ${tool} deploy`, rule);
      break;
    case 'prisma':
      if (/^(?:migrate deploy|migrate reset|db push|db execute)/.test(words)) return ask('deploy', 'Change the database that DATABASE_URL points to (prisma)', rule);
      break;
    case 'drizzle-kit':
      if (sub === 'push' || sub === 'migrate' || sub === 'drop') return ask('deploy', 'Change the database the drizzle config points to', rule);
      break;
    case 'alembic': {
      const step = positionals(args, new Set(['-c', '--config', '-n', '--name', '-x']))[0];
      if (step === 'upgrade' || step === 'downgrade' || step === 'stamp') return ask('deploy', `Change the database the alembic config points to (alembic ${step})`, rule);
      break;
    }
    case 'playwright': case 'cypress':
      if (sub === 'install') return ask('other', `Download ${tool}'s browsers for the whole computer`, rule);
      break;
    case 'make': case 'just': case 'rake': case 'gradle': case 'gradlew': case 'mvn': {
      const target = pos.find((w) => RELEASE_WORD.test(w));
      if (target) return ask(releaseKind(RELEASE_WORD.exec(target)?.[1] ?? ''), `Run the ${target} step (${tool} ${target})`, rule);
      break;
    }
    case 'turbo': case 'nx': {
      // Task names, however they are given: `turbo run deploy`, `turbo deploy`, `nx run app:deploy`, `nx run-many -t build,deploy`.
      const tasks = [...positionals(args, TASK_VALUED), ...flagValues(args, ['-t', '--target', '--targets']).flatMap((v) => v.split(','))];
      const release = releaseAsk(tool, tasks, raw);
      if (release) return first(release, argsStayInside(args, ctx));
      break;
    }
    case 'concurrently': {
      // Each command it is given runs in a shell of its own (`npm:dev` runs a package script), and so does --teardown's.
      const commands = [...positionals(args, CONCURRENTLY_VALUED), ...flagValues(args, ['--teardown'])];
      return first(...commands.map((command) => concurrentJudge(command, ctx, raw)));
    }
    case 'nodemon': {
      // --exec runs its command in a shell instead of node.
      const exec = flagValues(args, ['--exec', '-x']);
      if (exec.length > 0) return first(...exec.map((command) => toJudgement(judgeShell(command, 'bash', { ...ctx, depth: ctx.depth + 1 }))), argsStayInside(args, ctx));
      break;
    }
    case 'mysql': case 'psql': case 'mongosh': case 'redis-cli': {
      const host = [valueOf(args, '-h', '--host'), ...args.map(hostOf)].find((h): h is string => typeof h === 'string' && h !== '' && !LOCAL_HOST.test(h));
      if (host) return ask('other', `Connect to the database at ${oneLine(host, 40)}`, rule);
      break;
    }
    case 'perl': {
      const checks: Judgement[] = [];
      const code = inlineCode('perl', args);
      if (code !== null) checks.push(judgeInlineCode(code, raw));
      // -i, -i.bak, -pi, -ni... edit the files named in place; -I (include) is a different, uppercase flag.
      if (args.some((a) => /^-[a-z]*i/.test(a))) checks.push(...positionals(args, new Set(['-e', '-E'])).map((p) => writePath(p, ctx)));
      if (checks.length > 0) return first(...checks);
      break;
    }
    case 'sed': {
      const checks: Judgement[] = [];
      if (sedScripts(args).some(sedRunsOrWrites)) checks.push(ask('other', 'Run sed with a script that can run a command or write a file', rule));
      if (args.some((a) => a === '--in-place' || a.startsWith('--in-place=') || /^-[a-z]*i/.test(a))) checks.push(...pos.slice(1).map((p) => writePath(p, ctx)));
      // The script is no path, whatever it starts with (`/start/,/end/p`); the files after it are judged as any program's.
      checks.push(argsStayInside(sedFiles(args), ctx));
      return first(...checks);
    }
    case 'awk': case 'gawk': case 'mawk': case 'nawk': {
      const program = awkProgram(args);
      if (program !== null && AWK_POWERS.test(program)) return ask('other', 'Run awk with a program that can run a command or write a file', rule);
      break;
    }
    case 'patch': {
      // `patch [file [patchfile]]`, the patch from -i or standard input.
      const named = positionals(args, new Set(['-i', '--input', '-p', '-d', '--directory', '-o', '--output', '-r', '--reject-file', '-B', '-z', '-D', '-F', '-V']));
      const input = valueOf(args, '-i', '--input') ?? args.find((a) => a.startsWith('--input='))?.slice(8) ?? named[1] ?? ctx.stdin;
      return first(named[0] ? writePath(named[0], ctx) : ALLOW, patchJudge(input ? [input] : [], ctx, raw));
    }
    case 'find': {
      const stop = args.findIndex((a) => a.startsWith('-') || a === '(' || a === '!');
      const roots = (stop === -1 ? args : args.slice(0, stop)).filter((a) => a !== '');
      const targets = roots.length > 0 ? roots : ['.'];
      const outputs = findOutputs(args).map((file) => writePath(file, ctx, 'Write'));
      const execAt = args.findIndex((a) => ['-exec', '-execdir', '-ok', '-okdir'].includes(a));
      if (execAt !== -1) {
        const endAt = args.findIndex((a, k) => k > execAt && (a === ';' || a === '+'));
        const inner = args.slice(execAt + 1, endAt === -1 ? undefined : endAt).map((w) => (w === '{}' ? (targets[0] ?? '.') : w));
        return first(...outputs, ...targets.map((r) => readPath(r, ctx)), toJudgement(judgeWords(inner, { ...ctx, depth: ctx.depth + 1 }, 'bash', inner.join(' ')).parts));
      }
      return first(...outputs, ...targets.map((r) => (args.includes('-delete') ? writePath(r, ctx, 'Delete') : readPath(r, ctx))));
    }
    case 'grep': case 'egrep': case 'fgrep': case 'rg': case 'ag': {
      const explicit = has(args, '-e', '--regexp', '-f', '--file');
      const named = positionals(args, new Set(['-e', '--regexp', '-f', '--file', '-A', '-B', '-C', '-m', '--max-count', '-g', '--glob', '-t', '--type', '--include', '--exclude']));
      return first(...(explicit ? named : named.slice(1)).map((p) => readPath(p, ctx)));
    }
    case 'xargs': {
      const inner = positionals(args, new Set(['-n', '-I', '-L', '-P', '-d', '-s', '-a', '-E']));
      const program = programName(inner[0] ?? '');
      if (inner.length === 0 || READERS.has(program) || HARMLESS_PROGRAMS.has(program) || program === 'grep' || program === 'rg') return ALLOW;
      return ask('other', `Run ${oneLine(program, 30)} on a list of files it works out as it runs`, rule);
    }
    default:
      break;
  }
  // A subcommand that says it releases asks: `dart pub publish`, `mix hex.publish`, `pod trunk push`, `wasm-pack publish`.
  const release = SUBCOMMAND_TOOLS.has(tool) ? releaseAsk(tool, subcommandWords(args), raw) : null;
  return first(release ?? ALLOW, argsStayInside(args, ctx));
}

/** Dev tools whose first words are subcommands rather than files, so a release word there is the command's own. */
const SUBCOMMAND_TOOLS = new Set([
  'cargo', 'go', 'gem', 'uv', 'poetry', 'pipenv', 'hatch', 'flit', 'twine', 'conda', 'bundle', 'composer', 'mix', 'dart', 'flutter', 'pod',
  'wasm-pack', 'expo', 'react-native', 'tauri', 'cap', 'ionic', 'swift', 'buf', 'prisma', 'drizzle-kit', 'lerna', 'changeset', 'mkdocs', 'hugo',
  'jekyll', 'zola', 'ng', 'astro', 'next', 'nuxt', 'nuxi', 'remix', 'gatsby', 'storybook', 'svelte-kit', 'vite', 'playwright', 'cypress',
  'rails', 'artisan', 'electron-builder', 'node-gyp',
]);
/** turbo's and nx's options that take the next word, so it isn't read as a task. */
const TASK_VALUED = new Set([
  '--filter', '-F', '--concurrency', '--cache-dir', '--log-order', '--output-logs', '--env-mode', '--cache', '--profile', '--team', '--token',
  '--api', '--scope', '--ignore', '-t', '--target', '--targets', '-p', '--projects', '--exclude', '--base', '--head', '-c', '--configuration',
  '--parallel',
]);
/** concurrently's options that take the next word, so it isn't read as a command. */
const CONCURRENTLY_VALUED = new Set([
  '-n', '--names', '-c', '--prefix-colors', '-p', '--prefix', '-s', '--success', '-m', '--max-processes', '--restart-tries', '--restart-after',
  '-t', '--timestamp-format', '-l', '--prefix-length', '--hide', '--default-input-target', '--name-separator', '--teardown', '--pad-prefix',
]);

/** One command concurrently runs: `npm:name` (yarn:, pnpm:, bun:, node:) runs package scripts, wildcards and all; anything else, a shell. */
function concurrentJudge(command: string, ctx: Ctx, raw: string): Judgement {
  const short = /^(npm|yarn|pnpm|bun|node):(\S+)/.exec(command.trim());
  if (short) return first(...scriptsMatching(short[2] ?? '', '.*', ctx).map((name) => scriptJudge(name, short[1] ?? 'npm', ctx, raw)));
  return toJudgement(judgeShell(command, 'bash', { ...ctx, depth: ctx.depth + 1 }));
}

/** npm-run-all, run-s and run-p: each word names package scripts (`*` within a `:` part, `**` across), as `npm run` runs them. */
function runAllJudge(args: readonly string[], ctx: Ctx, raw: string): Judgement {
  const end = args.indexOf('--');
  const own = end === -1 ? args : args.slice(0, end);
  // --npm-path names the program that runs every script.
  const judgements = flagValues(own, ['--npm-path']).map((program) => toJudgement(judgeWords([program], { ...ctx, depth: ctx.depth + 1 }, 'bash', raw).parts));
  for (const word of positionals(own, new Set(['--max-parallel', '--npm-path']))) {
    const pattern = word.trim().split(/\s+/)[0] ?? '';
    judgements.push(...scriptsMatching(pattern, '[^:]*', ctx).map((name) => scriptJudge(name, 'npm', ctx, raw)));
  }
  return first(...judgements);
}

/** A program's name as the policy looks it up: no folder, no Windows extension, in lower case. */
function programName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word;
  return base.replace(/\.(?:exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
}

/** The words of the command a wrapper runs: `timeout 30 npm test`, `nice -n 5 make`, `env A=1 node x.js`. */
function wrapped(tool: string, args: readonly string[]): string[] {
  const valued = new Set(['-n', '-s', '-k', '--signal', '--kill-after', '--interval', '-u', '--unset', '-o', '-e', '-i', '-p', '-C', '--chdir']);
  let k = 0;
  while (k < args.length) {
    const a = args[k] ?? '';
    if (a === '--') {
      k++;
      break;
    }
    if (a.startsWith('-')) {
      // exec -a NAME gives the program another name; the word after it is not the program.
      k += (valued.has(a) && tool !== 'env') || (tool === 'exec' && a === '-a') ? 2 : a === '-u' || a === '--unset' ? 2 : 1;
      continue;
    }
    if (/^[A-Za-z_]\w*=/.test(a)) {
      k++;
      continue;
    }
    break;
  }
  // timeout's first word is how long it waits.
  if (tool === 'timeout' && k < args.length) k++;
  return args.slice(k);
}

/** The command watch runs: past its options, of which only -n and -q take a value. */
function watchCommand(args: readonly string[]): string[] {
  let i = 0;
  while (i < args.length) {
    const a = args[i] ?? '';
    if (a === '--') return args.slice(i + 1);
    if (!a.startsWith('-')) break;
    i += ['-n', '--interval', '-q', '--equexit'].includes(a) ? 2 : 1;
  }
  return args.slice(i);
}

/**
 * env: its assignments set the command's environment (a dangerous one was asked before this); `-C dir` / `--chdir` runs the
 * command in another folder, which the command is judged from; `-S string` / `--split-string` splits one word into the
 * command and its words, judged as a command line. Short options come together (`-iC dir`); -u, -C and -S take a value.
 */
function envJudge(args: readonly string[], ctx: Ctx, dialect: Dialect, raw: string): Judgement {
  let dir: string | undefined;
  let split: string | undefined;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      i++;
      break;
    }
    if (/^[A-Za-z_]\w*=/.test(a) || a === '-') continue;
    if (!a.startsWith('-')) break;
    const long = /^--([\w-]+)(?:=([\s\S]*))?$/.exec(a);
    if (long) {
      const takes = ['chdir', 'split-string', 'unset'].includes(long[1] ?? '');
      const value = takes ? (long[2] ?? args[++i] ?? '') : undefined;
      if (long[1] === 'chdir') dir = value;
      if (long[1] === 'split-string') split = value;
      continue;
    }
    for (let k = 1; k < a.length; k++) {
      const l = a.charAt(k);
      if (l === 'u' || l === 'C' || l === 'S') {
        const value = k + 1 < a.length ? a.slice(k + 1) : (args[++i] ?? '');
        if (l === 'C') dir = value;
        if (l === 'S') split = value;
        break;
      }
    }
  }
  const inner = args.slice(i);
  const there = dir === undefined ? ctx : movedTo(dir, ctx);
  if (split !== undefined) return toJudgement(judgeShell([split, ...inner].join(' '), 'bash', { ...there, depth: ctx.depth + 1 }));
  if (inner.length === 0) return ask('other', 'Print the environment, which holds secrets');
  return toJudgement(judgeWords(inner, there, dialect, raw).parts);
}

/** sqlite3's options that take the next word. */
const SQLITE_VALUED = new Set(['-separator', '-newline', '-nullvalue', '-vfs', '-mmap', '-lookaside', '-pagecache', '-heap', '-maxsize', '-escape']);
/** sqlite3's dot-commands that only show or format: every other one can run a program, read a file or write one. */
const SQLITE_SAFE_DOTS = new Set([
  'tables', 'table', 'schema', 'indexes', 'indices', 'headers', 'header', 'mode', 'width', 'dump', 'databases', 'show', 'help', 'timer', 'nullvalue',
  'separator', 'print', 'quit', 'exit', 'dbinfo', 'stats', 'eqp', 'explain', 'changes', 'bail', 'echo', 'fullschema', 'lint', 'expert', 'prompt',
  'dbconfig', 'limit', 'parameter', 'scanstats', 'sha3sum', 'version',
]);
/** SQL that reaches past the database: another database file, a file written or read, an extension loaded, an editor. */
const SQLITE_POWERS = /\battach\b|\bvacuum\b[\s\S]*\binto\b|load_extension|writefile|readfile|\bfsdir\b|\bzipfile\b|\bsqlar|\bedit\s*\(|fts3_tokenizer/i;

/**
 * sqlite3: the database file is changed where it lies; SQL and dot-commands on the command line (and in -cmd) are read,
 * and those that can run a program or reach other files ask; with nothing to run it reads its commands from its input.
 */
function sqliteJudge(args: readonly string[], ctx: Ctx, raw: string): Judgement {
  const rule = exactRule('Bash', raw);
  const texts: string[] = [];
  const reads: string[] = [];
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const opt = a.replace(/^--(?=\w)/, '-');
    if (/^-(?:A|ar|archive)/.test(opt)) return ask('other', 'Run sqlite3 on an archive, which can write files where it unpacks', rule);
    if (opt === '-cmd') texts.push(args[++i] ?? '');
    else if (opt === '-init') reads.push(args[++i] ?? '');
    else if (SQLITE_VALUED.has(opt)) i++;
    else if (!a.startsWith('-') || a === '-') pos.push(a);
  }
  const [db, ...sql] = pos;
  for (const text of [...texts, ...sql]) {
    const dots = [...text.matchAll(/(?:^|\n)[ \t]*\.(\w+)/g)].map((m) => (m[1] ?? '').toLowerCase());
    if (dots.some((dot) => !SQLITE_SAFE_DOTS.has(dot)) || SQLITE_POWERS.test(text)) return ask('other', 'Run sqlite3 with a command that can run a program or reach files outside the database', rule);
  }
  if (sql.length === 0 && ctx.stdin === null) return fromInputAsk('sqlite3', raw);
  return first(db === undefined || db === ':memory:' ? ALLOW : writePath(db, ctx), ...reads.map((file) => readPath(file, ctx)));
}

/** fd's options that take the next word. */
const FD_VALUED = new Set([
  '-d', '--max-depth', '--min-depth', '--exact-depth', '-t', '--type', '-e', '--extension', '-E', '--exclude', '-S', '--size', '-c', '--color', '-j',
  '--threads', '-o', '--owner', '--changed-within', '--changed-before', '--max-results', '--path-separator', '--batch-size', '--format', '--ignore-file',
  '--base-directory', '--search-path', '--and',
]);

/** fd: a reader, unless -x/-X (--exec, --exec-batch) runs a command on what it finds, judged as find -exec's is. */
function fdJudge(args: readonly string[], ctx: Ctx, raw: string): Judgement {
  let inner: string[] | null = null;
  const own: string[] = [];
  for (let i = 0; i < args.length && inner === null; i++) {
    const a = args[i] ?? '';
    const long = /^--(?:exec|exec-batch)(?:=([\s\S]*))?$/.exec(a);
    if (long) {
      inner = [...(long[1] !== undefined ? [long[1]] : []), ...args.slice(i + 1)];
      break;
    }
    own.push(a);
    if (!/^-[A-Za-z]+$/.test(a)) {
      if (FD_VALUED.has(a) && i + 1 < args.length) own.push(args[++i] ?? '');
      continue;
    }
    for (let k = 1; k < a.length; k++) {
      const l = a.charAt(k);
      if (l === 'x' || l === 'X') {
        own.pop();
        inner = [a.slice(k + 1), ...args.slice(i + 1)].filter((w) => w !== '');
        break;
      }
      if ('dteEScjo'.includes(l)) {
        if (k === a.length - 1 && i + 1 < args.length) own.push(args[++i] ?? '');
        break;
      }
    }
  }
  // `-x cmd ;` may be followed by more of fd's own words.
  const end = inner?.indexOf(';') ?? -1;
  if (inner !== null && end !== -1) {
    own.push(...inner.slice(end + 1));
    inner = inner.slice(0, end);
  }
  const searched = positionals(own, FD_VALUED);
  const reads = [...searched, ...flagValues(own, ['--base-directory', '--search-path', '--ignore-file'])].map((p) => readPath(p, ctx));
  if (inner === null) return first(...reads);
  if (inner.length === 0) return ask('other', 'Run a program on every file fd finds', exactRule('Bash', raw));
  const at = searched[1] ?? '.';
  const words = inner.map((w) => w.replace(/\{(?:\/|\/\/|\.|\/\.)?\}/g, at));
  return first(...reads, toJudgement(judgeWords(words, { ...ctx, depth: ctx.depth + 1 }, 'bash', words.join(' ')).parts));
}

const WRAPPERS = new Set(['time', 'nice', 'nohup', 'stdbuf', 'caffeinate', 'builtin', 'exec', 'timeout', 'watch', 'dotenv', 'cross-env', 'cross-env-shell', 'chronic', 'env']);
const HOOK_MANAGERS = new Set(['husky', 'lefthook', 'pre-commit', 'simple-git-hooks']);
const SYSTEM_PACKAGES = new Set(['pipx', 'brew', 'choco', 'winget', 'scoop', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'snap', 'port']);
const SYSTEM_SETTINGS = new Set([
  'setx', 'reg', 'defaults', 'crontab', 'schtasks', 'launchctl', 'systemctl', 'chsh', 'set-executionpolicy', 'install-module', 'install-package',
  'set-itemproperty', 'sp', 'new-itemproperty', 'remove-itemproperty', 'update-alternatives',
]);
const FETCHERS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'aria2c', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm']);
const CONNECTORS = new Set(['ssh', 'sftp', 'ftp', 'telnet', 'nc', 'ncat', 'netcat', 'socat', 'tftp', 'rclone', 'nslookup', 'dig', 'host', 'bitsadmin', 'start-bitstransfer']);
const MAILERS = new Set(['sendmail', 'mail', 'mailx', 'mutt', 'msmtp', 'send-mailmessage']);
const KILLERS = new Set(['kill', 'pkill', 'killall', 'taskkill', 'stop-process', 'spps', 'fuser']);
/** Whether a command may stop a program at all: the hub reads the desk's own processes only for those (stopsByPid). */
const NAMES_A_KILLER = /\b(?:kill|taskkill|stop-process|spps)\b/i;
/** A process id written as a number: never 0 (the caller's group), a negative one (a group) or a job ("%1"). */
const PROCESS_ID = /^[1-9]\d{0,9}$/;

/** Whether a Bash or PowerShell request could be a stop by process id, so that its desk's own processes are worth reading. */
export function stopsByPid(payload: unknown): boolean {
  if (!isObj(payload) || (payload.tool_name !== 'Bash' && payload.tool_name !== 'PowerShell') || !isObj(payload.tool_input)) return false;
  const command = payload.tool_input.command;
  return typeof command === 'string' && command.length <= 100_000 && NAMES_A_KILLER.test(command);
}

/**
 * The ids a stop names, when it names processes by number (or by a variable the command set to one) and nothing else:
 * `taskkill /PID 123 /F` (also `//PID`, as Git Bash writes it, and /T), `Stop-Process -Id 123,456 -Force` (and its
 * aliases in PowerShell) and `kill -9 123`, each id as written. Null for a stop by name, image, filter, port, pattern,
 * job or process group. `msys` is whether the numbers are MSYS's own (`kill` in Git Bash on Windows), where the same
 * number can be another program's, though `$!` still is this command's own job.
 */
function stoppedIds(tool: string, args: readonly string[], ctx: Ctx, dialect: Dialect): { ids: string[]; msys: boolean } | null {
  const ids: string[] = [];
  if (tool === 'taskkill') {
    for (let i = 0; i < args.length; i++) {
      const flag = /^(?:\/\/?|-)([A-Za-z]+)$/.exec(args[i] ?? '')?.[1]?.toLowerCase();
      if (flag === 'f' || flag === 't') continue;
      if (flag !== 'pid') return null;
      ids.push(args[++i] ?? '');
    }
  } else if (tool === 'stop-process' || tool === 'spps' || (tool === 'kill' && dialect === 'powershell')) {
    for (let i = 0; i < args.length; i++) {
      const word = args[i] ?? '';
      const flag = word.toLowerCase();
      if (flag === '-force' || flag === '-passthru') continue;
      if (flag === '-erroraction' || flag === '-ea') {
        if (!/^[A-Za-z0-9]+$/.test(args[++i] ?? '')) return null;
        continue;
      }
      // `-Id 1,2`, `-Id 1, 2` and the same without -Id, which is where a bare number goes.
      if (flag !== '-id' && word.startsWith('-')) return null;
      let list = flag === '-id' ? (args[++i] ?? '') : word;
      while (list.endsWith(',') && i + 1 < args.length) list += args[++i] ?? '';
      ids.push(...list.split(','));
    }
  } else if (tool === 'kill' && dialect === 'bash') {
    let i = 0;
    for (; i < args.length; i++) {
      const word = args[i] ?? '';
      if (word === '--') {
        i++;
        break;
      }
      if (word === '-s' || word === '-n') {
        if (!/^[A-Za-z0-9]+$/.test(args[++i] ?? '')) return null;
      } else if (!/^-[A-Za-z0-9]+$/.test(word) || /^-[lL]$/.test(word)) break;
    }
    ids.push(...args.slice(i));
  } else return null;
  return ids.length > 0 ? { ids, msys: tool === 'kill' && dialect === 'bash' && ctx.win } : null;
}

/** `kill $(cat FILE)`, signal options allowed, and nothing else in the command but where its output goes. */
const KILL_FROM_FILE = /^kill((?:\s+-[A-Za-z0-9]+|\s+-[sn]\s+\w+)*)\s+(?:--\s+)?"?\$\(\s*cat\s+(?:"([^"]+)"|'([^']+)'|([^\s)"']+))\s*\)"?((?:\s+(?:[0-9]?>\s*\/dev\/null|2>&1|\|\|\s*(?:true|:)))*)\s*$/;

/**
 * Whether `kill $(cat FILE)` stops only what the desk started: FILE is in the project or the desk's scratch folder, and
 * either this command wrote the id of its own background job into it, or (where numbers are the system's) it holds an
 * id in the desk's own recorded family.
 */
function stopsFromPidFile(raw: string, ctx: Ctx): boolean {
  const m = KILL_FROM_FILE.exec(raw.trim());
  const file = m?.[2] ?? m?.[3] ?? m?.[4];
  if (file === undefined) return false;
  const where = placeOf(file, ctx);
  if (where.place !== 'inside' && where.place !== 'scratch') return false;
  if (ctx.jobs.files.has(compareKey(ctx, where.path))) return true;
  if (ctx.win) return false;
  const text = readSmall(where.path)?.trim() ?? '';
  return PROCESS_ID.test(text) && ctx.own.has(Number(text));
}

/** The variable a word is, as `$PID`, `${PID}` or "$PID" after the shell's quotes; null for any other word. */
const variableOf = (word: string): string | null => /^\$(\w+)$/.exec(word)?.[1] ?? /^\$\{(\w+)\}$/.exec(word)?.[1] ?? null;

/**
 * Whether a stop names only processes the desk itself started:
 * - a number in its own recorded family (the office read the family at ask time);
 * - `$!` and a variable set from it in the same command (`cmd & PID=$!; ...; kill $PID`), which is this command's job;
 * Nothing else: a lookup by port, name or pattern can't be shown to find only the desk's own.
 */
function stopsOwn(tool: string, args: readonly string[], ctx: Ctx, dialect: Dialect, raw: string): boolean {
  if (tool === 'kill' && dialect === 'bash' && stopsFromPidFile(raw, ctx)) return true;
  const stop = stoppedIds(tool, args, ctx, dialect);
  if (stop === null) return false;
  return stop.ids.every((id) => {
    if (PROCESS_ID.test(id)) return !stop.msys && ctx.own.has(Number(id));
    if (tool === 'kill' && dialect === 'bash' && ctx.jobs.started && (id === '$!' || ctx.jobs.vars.has(variableOf(id) ?? ''))) return true;
    return false;
  });
}
const OPENERS = new Set(['open', 'xdg-open', 'start', 'explorer', 'start-process', 'saps', 'invoke-item', 'ii']);
const KEYCHAINS = new Set(['gpg', 'ssh-keygen', 'ssh-add', 'security', 'cmdkey', 'get-storedcredential']);
/** Programs that look up or probe another computer by its name, which alone can carry data out. */
const NET_PROBES = new Set([
  'ping', 'ping6', 'tracert', 'traceroute', 'tracepath', 'mtr', 'pathping', 'whois', 'resolve-dnsname', 'test-netconnection', 'tnc', 'test-connection',
]);
/** Clients of storage servers (MinIO's mc), whose alias/bucket paths look like folders in the project. */
const STORAGE_CLIENTS = new Set(['mc', 'mcli']);
/** npm-run-all and its short names: each word names package scripts to run. */
const RUN_ALL = new Set(['npm-run-all', 'npm-run-all2', 'run-s', 'run-p']);

/** A runner: the subcommand that runs the rest of its words as a command (`uv run`, `bundle exec`). */
interface Runner {
  sub: string;
  /** Its options, before the subcommand or after it, that take the next word as their value. */
  valued: ReadonlySet<string>;
  /** Options after which the rest is a Python module to run (`uv run -m twine upload`). */
  module?: ReadonlySet<string>;
}
const CONDA_RUN: Runner = { sub: 'run', valued: new Set(['-n', '--name', '-p', '--prefix', '--cwd']) };
const RUNNERS = new Map<string, Runner>([
  ['uv', {
    sub: 'run',
    valued: new Set([
      '--with', '--with-editable', '--with-requirements', '--python', '-p', '--project', '--directory', '--env-file', '--extra', '--group', '--no-group',
      '--only-group', '--package', '--index', '--default-index', '--index-url', '-i', '--extra-index-url', '--find-links', '-f', '--index-strategy',
      '--keyring-provider', '--resolution', '--prerelease', '--exclude-newer', '--link-mode', '--config-setting', '-C', '--cache-dir', '--config-file',
      '--color', '--refresh-package', '--reinstall-package', '--upgrade-package', '-P', '--python-platform', '--allow-insecure-host',
      '--no-binary-package', '--no-build-package',
    ]),
    module: new Set(['-m', '--module']),
  }],
  ['poetry', { sub: 'run', valued: new Set(['-P', '--project', '-C', '--directory']) }],
  ['pdm', { sub: 'run', valued: new Set(['-p', '--project', '--venv']) }],
  ['pipenv', { sub: 'run', valued: new Set(['--python']) }],
  ['hatch', { sub: 'run', valued: new Set(['-e', '--env', '-p', '--project']) }],
  ['rye', { sub: 'run', valued: new Set(['--pyproject']) }],
  ['pixi', { sub: 'run', valued: new Set(['--manifest-path', '-e', '--environment']) }],
  ['bundle', { sub: 'exec', valued: new Set(['--gemfile']) }],
  ['conda', CONDA_RUN],
  ['mamba', CONDA_RUN],
  ['micromamba', CONDA_RUN],
]);

/** The command a runner runs (`uv run --with x pytest -q` runs `pytest -q`), or null when it doesn't run one. */
function runnerCommand(args: readonly string[], runner: Runner): string[] | null {
  let i = 0;
  const skip = () => {
    i += runner.valued.has(args[i] ?? '') ? 2 : 1;
  };
  while (i < args.length && (args[i] ?? '').startsWith('-')) skip();
  if (args[i] !== runner.sub) return null;
  i++;
  while (i < args.length) {
    const a = args[i] ?? '';
    if (a === '--') return args.slice(i + 1);
    if (!a.startsWith('-') || a === '-') break;
    if (runner.module?.has(a)) return ['python', '-m', ...args.slice(i + 1)];
    skip();
  }
  return args.slice(i);
}

/** A program the project's own Python environment installed (.venv or venv, bin or Scripts), which a runner runs. */
function venvBin(name: string, ctx: Ctx): boolean {
  if (!/^[\w.@-]{1,100}$/.test(name)) return false;
  const base = ctx.cwd ?? ctx.root;
  return ['.venv', 'venv'].some((env) =>
    [ctx.p.join(base, env, 'bin', name), ctx.p.join(base, env, 'Scripts', `${name}.exe`), ctx.p.join(base, env, 'Scripts', name)].some((file) => {
      try {
        return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
      } catch {
        return false;
      }
    }),
  );
}

/**
 * The command a runner runs, judged as the command it is. A Python file runs with the project's Python; a program the
 * project's own environment installed is the project's own tool (its release subcommands still ask); anything else is
 * judged as if it were typed alone, so an unknown program asks unless the person is Trusted.
 */
function runnerJudge(inner: readonly string[], ctx: Ctx, dialect: Dialect, raw: string): Judgement {
  const head = inner[0];
  if (head === undefined) return ALLOW;
  if (/\.pyw?$/i.test(head)) return toJudgement(judgeWords(['python', ...inner], ctx, dialect, raw).parts);
  const name = programName(head);
  const rest = inner.slice(1);
  if (!/[\\/$]/.test(head) && venvBin(name, ctx) && programJudge(name, [...rest], ctx, raw, dialect) === null) {
    return first(releaseAsk(name, subcommandWords(rest), raw) ?? ALLOW, argsStayInside(rest, ctx));
  }
  return toJudgement(judgeWords(inner, ctx, dialect, raw).parts);
}

/** Judges one program call, or null when the program isn't one the policy knows (the caller decides then). */
function programJudge(tool: string, args: string[], ctx: Ctx, raw: string, dialect: Dialect): Judgement | null {
  const rule = exactRule(dialect === 'powershell' ? 'PowerShell' : 'Bash', raw);
  if (tool === 'sudo' || tool === 'doas' || tool === 'runas' || tool === 'gsudo') return ask('global-config', `Run ${oneLine(args.join(' '), 60)} as an administrator`);
  // `command -v` only looks a program up; otherwise `command` runs the rest as a command of its own.
  if (tool === 'command') {
    const at = args.findIndex((a) => !a.startsWith('-'));
    if (at === -1 || args.slice(0, at).some((flag) => /[vV]/.test(flag))) return ALLOW;
    return toJudgement(judgeWords(args.slice(at), ctx, dialect, raw).parts);
  }
  // A trap's action runs later in the same shell, so it is judged as the command it is.
  if (tool === 'trap') {
    const action = positionals(args)[0];
    if (action === undefined || action === '' || action === '-' || /^\d+$/.test(action)) return ALLOW;
    return toJudgement(judgeShell(action, dialect, { ...ctx, depth: ctx.depth + 1 }));
  }
  if (WRAPPERS.has(tool)) {
    // env (and the dotenv wrappers) can set a dangerous variable for the command they run.
    if (tool === 'env' || tool === 'dotenv' || tool === 'cross-env' || tool === 'cross-env-shell') {
      const bad = args.find((a) => /^[A-Za-z_]\w*=/.test(a) && dangerousEnv(a.slice(0, a.indexOf('='))));
      if (bad) return ask('other', `Run a command with ${oneLine(bad.slice(0, bad.indexOf('=')), 40)} set, which can make a program run code`, rule);
    }
    if (tool === 'env') return envJudge(args, ctx, dialect, raw);
    // watch and cross-env-shell hand their words to a shell as one command line (`sh -c`), unless watch is told -x.
    if (tool === 'watch' || tool === 'cross-env-shell') {
      const inner = tool === 'watch' ? watchCommand(args) : wrapped(tool, args);
      if (inner.length === 0) return ALLOW;
      if (tool === 'watch' && has(args, '-x', '--exec')) return toJudgement(judgeWords(inner, ctx, dialect, raw).parts);
      return toJudgement(judgeShell(inner.join(' '), 'bash', { ...ctx, depth: ctx.depth + 1 }));
    }
    const inner = wrapped(tool, args);
    if (inner.length === 0) return ALLOW;
    return toJudgement(judgeWords(inner, ctx, dialect, raw).parts);
  }
  // Runners run the rest as a command, which is judged as the command it is: `uv run git push`, `bundle exec gem push`.
  const runner = RUNNERS.get(tool);
  const run = runner ? runnerCommand(args, runner) : null;
  if (run !== null) {
    // `uv run --with x` installs x for the run: a package the project doesn't declare asks, as an install does.
    const extra = tool === 'uv' ? first(...flagValues(args, ['--with-requirements', '--with-editable']).map((p) => readPath(p, ctx, 'Install from')), pythonInstallAsk(flagValues(args, ['--with']).flatMap((v) => v.split(',')), ctx, raw)) : ALLOW;
    return first(runnerJudge(run, ctx, dialect, raw), extra);
  }
  if (tool === 'uvx') return uvxAsk(args, rule);
  if (RUN_ALL.has(tool)) return runAllJudge(args, ctx, raw);
  if (
    tool === 'printenv' || tool === 'compgen' || ((tool === 'set' || tool === 'export' || tool === 'declare' || tool === 'typeset') && dialect === 'bash' && args.every((a) => /^-[A-Za-z]*$/.test(a)))
  ) {
    return ask('other', 'Print the environment, which holds secrets');
  }
  // A link made by PowerShell points wherever -Value (or its alias -Target) says, by any start of its name (-Va, -Valu). The
  // kind is found by its word, whatever start of -ItemType names it.
  if (tool === 'new-item' || tool === 'ni') {
    const kindAt = args.findIndex((a) => /^(?:symboliclink|junction|hardlink)$/i.test(a));
    if (kindAt !== -1) {
      let target: string | undefined;
      const paths: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i] ?? '';
        if (i === kindAt) continue;
        const p = a.startsWith('-') ? psParameter(a) : null;
        if (p === null) paths.push(a);
        else if (startsName(p.name, 'value', 2) || startsName(p.name, 'target', 2)) target = p.value ?? args[++i];
      }
      return target === undefined ? ask('other', 'Make a link to somewhere it does not name') : first(linkTarget(target, ctx), ...paths.map((q) => writePath(q, ctx, 'Make')));
    }
  }
  if (tool === 'git') return gitJudge(args, ctx, raw);
  if (HOOK_MANAGERS.has(tool)) {
    // They install the hooks git runs on every commit, the company's own included; running them is a lint pass.
    const sub = positionals(args)[0];
    const runs = (tool === 'lefthook' && ['run', 'version', 'dump'].includes(sub ?? '')) || (tool === 'pre-commit' && ['run', 'validate-config', 'validate-manifest'].includes(sub ?? ''));
    return runs ? argsStayInside(args, ctx) : askSetup(`Change how git runs in this project: ${tool}${sub ? ` ${oneLine(sub, 20)}` : ''}`);
  }
  if (tool === 'gh') return ghJudge(args, raw);
  if (tool === 'glab') {
    const [group, action] = positionals(args);
    if (action === undefined || ['view', 'list', 'status', 'diff', 'ci'].includes(action)) return ALLOW;
    if (action === 'note' || (group === 'issue' && action === 'create')) return ask('message-out', 'Post on GitLab', rule);
    return ask(action === 'create' ? 'publish' : 'other', `Change something on GitLab (glab ${oneLine(`${group} ${action}`, 30)})`, rule);
  }
  if (tool === 'bun') {
    const sub = args[0];
    if (sub === 'x') return packageRunJudge('bunx', args.slice(1), ctx, raw);
    if (sub === 'run') return scriptJudge(args[1], 'bun', ctx, raw);
    // `bun file.ts` runs a file, `bun -e` inline code; anything else is bun as a package manager.
    if ((sub !== undefined && /\.[cm]?[jt]sx?$/.test(sub)) || inlineCode('bun', args) !== null) return interpreterJudge(tool, args, ctx, raw);
    return npmJudge(tool, args, ctx, raw);
  }
  if (tool === 'npm' || tool === 'pnpm' || tool === 'yarn') return npmJudge(tool, args, ctx, raw);
  if (tool === 'npx' || tool === 'pnpx' || tool === 'bunx') return packageRunJudge(tool, args, ctx, raw);
  if (tool === 'pip' || tool === 'pip3') return pipJudge(args, ctx, raw);
  if (SYSTEM_PACKAGES.has(tool)) {
    const sub = positionals(args)[0] ?? '';
    return tool !== 'pipx' && ['list', 'search', 'info', 'show', 'outdated', 'doctor'].includes(sub)
      ? ALLOW
      : ask('global-config', `Install or change programs on the whole computer (${tool} ${oneLine(sub, 20)})`);
  }
  if (CLOUD.has(tool)) return cloudJudge(tool, args, raw);
  if (tool === 'docker' || tool === 'podman' || tool === 'docker-compose') {
    const sub = positionals(args)[0] ?? '';
    if (sub === 'push') return ask('publish', 'Publish a container image', rule);
    if (sub === 'login' || sub === 'logout') return ask('global-config', `Change the ${tool} sign-in on this computer`);
    if (tool === 'docker-compose' || ['compose', 'build', 'ps', 'images', 'logs', 'inspect', 'version', 'info', 'buildx'].includes(sub)) return argsStayInside(args, ctx);
    return ask('other', `Run containers with ${tool} ${oneLine(sub, 20)}`, rule);
  }
  if (FETCHERS.has(tool)) return fetchJudge(tool, args, ctx, raw);
  // These send or fetch over the network whatever their arguments look like, so no leash lets them through.
  if ((tool === 'openssl' && args.some((a) => ['s_client', 's_server', 's_time'].includes(a))) || (tool === 'certutil' && (args.some((a) => /^[-/](urlcache|verifyctl|url|syncwithwu|ping)$/i.test(a)) || args.some((a) => remoteWord(a) !== null)))) {
    return ask('other', `Reach another computer with ${tool} ${oneLine(args.find((a) => !a.startsWith('-') && !a.startsWith('/')) ?? '', 20)}`.trim(), rule);
  }
  if (CONNECTORS.has(tool)) {
    const host = positionals(args, new Set(['-p', '-i', '-l', '-o', '-F', '-J', '-L', '-R', '-D', '-P']))[0];
    return ask('other', `Connect to ${oneLine(host ?? 'another computer', 40)} over the network`, rule);
  }
  // A name alone can carry data out: looking it up sends it to whoever answers for the name.
  if (NET_PROBES.has(tool)) return ask('other', `Reach ${oneLine(positionals(args).find((w) => /[A-Za-z]/.test(w)) ?? 'another computer', 40)} over the network (${tool})`, rule);
  // Their alias/bucket paths look like folders in the project.
  if (STORAGE_CLIENTS.has(tool)) return ask('other', `Use a storage server with ${oneLine(`${tool} ${positionals(args)[0] ?? ''}`.trim(), 40)}`, rule);
  if (tool === 'scp' || (tool === 'rsync' && args.some((a) => /^[^/\\-][^/\\]*:/.test(a) && !/^[A-Za-z]:[\\/]/.test(a)))) return ask('deploy', 'Copy files to another computer', rule);
  if (MAILERS.has(tool)) return ask('message-out', 'Send an email');
  // What the desk itself started, named by its process id, is its own to stop; anything else is someone else's program.
  if (KILLERS.has(tool)) return stopsOwn(tool, args, ctx, dialect, raw) ? ALLOW : ask('other', 'Stop a program that is running on the computer', rule);
  if (SYSTEM_SETTINGS.has(tool)) return tool === 'reg' && args[0]?.toLowerCase() === 'query' ? ALLOW : ask('global-config', `Change a setting of the whole computer (${tool})`);
  if (tool === 'code' || tool === 'cursor') {
    return has(args, '--install-extension', '--uninstall-extension') ? ask('global-config', "Change the editor's extensions for the whole computer") : ask('other', 'Open the editor on the computer', rule);
  }
  if (tool === 'claude') {
    const sub = positionals(args)[0];
    return sub === 'config' || sub === 'mcp' || sub === 'plugin' || sub === 'plugins' || sub === 'install' || sub === 'update'
      ? ask('global-config', "Change Claude Code's own setup")
      : ask('other', 'Start another Claude Code, which costs money of its own', rule);
  }
  if (tool === 'worklings' || tool === 'headcount') return ask('other', 'Run Worklings itself', rule);
  if (OPENERS.has(tool)) return ask('other', `Open ${oneLine(args.join(' ') || 'a program', 50)} on the computer`, rule);
  if (KEYCHAINS.has(tool)) return ask('global-config', 'Use the keys and passwords stored on the computer');
  if (SHELL_PROGRAMS.has(tool) || INTERPRETERS.has(tool)) return interpreterJudge(tool, args, ctx, raw);
  const writes = WRITERS.get(tool);
  if (writes !== undefined) {
    const words = tool === 'install' ? args.flatMap(coreutilsOption) : args;
    const paths = positionals(words, new Set(['-m', '--mode', '-o', '--owner', '-g', '--group', '-itemtype', '-ItemType', '-value', '-Value', '-encoding', '-Encoding']));
    if (paths.length === 0) return writes === 'Delete' ? ask('other', 'Delete files it works out as it runs', rule) : ALLOW;
    return first(...paths.map((p) => writePath(p, ctx, writes)));
  }
  if (tool === 'mklink') return mklinkJudge(args, ctx, rule);
  const copies = COPIERS.get(tool);
  if (copies !== undefined) {
    // cp, mv and ln take their target folder with -t however it is written: `-t dir`, `-rt dir`, `-tdir`, `--target-directory=dir`.
    const words = tool === 'cp' || tool === 'mv' || tool === 'ln' ? args.flatMap(coreutilsOption) : args;
    const named = positionals(words, new Set(['-t', '--target-directory', '-S', '--suffix', '-destination', '-Destination']));
    // -T (no target folder) is another option: only PowerShell's -Destination compares without case.
    const destFlag = words.findIndex((a) => a === '-t' || a === '--target-directory' || a.toLowerCase() === '-destination');
    const dest = destFlag !== -1 ? words[destFlag + 1] : named.at(-1);
    const sources = destFlag !== -1 ? named : named.slice(0, -1);
    // A folder copied or moved whole brings its own .claude, .git or .vscode along into the project.
    const carried = copies !== 'Link' && dest !== undefined ? sources.map((s) => carriedSetup(s, ctx)).find((c) => c !== null) : undefined;
    // ln's link goes into the folder -t names, at (or into) the destination named, or into the working folder when none
    // is; mklink names the link first.
    const linkAt = tool === 'ln' ? { at: dest ?? null, into: destFlag !== -1 } : undefined;
    return first(
      ...sources.map((s) => (copies === 'Move' ? writePath(s, ctx, 'Move') : copies === 'Link' ? linkTarget(s, ctx, linkAt) : readPath(s, ctx))),
      dest !== undefined ? writePath(dest, ctx, copies === 'Link' ? 'Make a link at' : 'Write') : ALLOW,
      carried ? askSetup(`Change how ${carried.runs} runs in this project: ${carried.what}`) : ALLOW,
    );
  }
  // An archive may write anywhere it is unpacked: every word it names is judged as a write, and what an option carries
  // too (`-C../x`, `--directory=../x`, `-o../x`).
  if (ARCHIVERS.has(tool)) return archiveJudge(tool, args, ctx, rule);
  if (tool === 'dd') return first(...args.filter((a) => a.startsWith('of=')).map((a) => writePath(a.slice(3), ctx, 'Write')), ...args.filter((a) => a.startsWith('if=')).map((a) => readPath(a.slice(3), ctx)));
  // `source file` runs the file in this shell: the project's own script where it lives inside, unless it is the input.
  if (tool === 'source' || tool === '.') {
    const [file, ...rest] = positionals(args);
    return file === undefined ? ALLOW : first(runFile(file, tool, ctx, raw), argsStayInside(rest, ctx));
  }
  if (tool === 'sort') return sortJudge(args, ctx);
  // uniq writes its second file.
  if (tool === 'uniq') {
    const [input, output] = positionals(args, new Set(['-f', '-s', '-w', '--skip-fields', '--skip-chars', '--check-chars']));
    return first(input === undefined ? ALLOW : readPath(input, ctx), output === undefined ? ALLOW : writePath(output, ctx, 'Write'));
  }
  if (tool === 'sqlite3') return sqliteJudge(args, ctx, raw);
  if (tool === 'fd' || tool === 'fdfind') return fdJudge(args, ctx, raw);
  if (READERS.has(tool)) {
    const valued = new Set(['-n', '-c', '-encoding', '-Encoding', '-filter', '-Filter', '-depth', '-Depth', '-tail', '-Tail', '-totalcount', '-TotalCount']);
    // cut's delimiter and field list are words of their own (`cut -d ' ' -f 2`), which no other reader's flags are.
    if (tool === 'cut') for (const flag of ['-d', '-f', '-b', '--delimiter', '--fields', '--bytes']) valued.add(flag);
    return first(...positionals(args, valued).map((p) => readPath(p, ctx, 'Read', NAME_LISTERS.has(tool))));
  }
  // wmic and CIM only look at the computer's processes and services unless a verb or a remote option makes them do more.
  if (tool === 'wmic') {
    return args.some((a) => /^(?:call|delete|set|create|assoc|\/node:|\/user:|\/password:|\/output:|\/record:)/i.test(a)) ? ask('other', 'Run wmic to change something on the computer', rule) : ALLOW;
  }
  if (CIM_READERS.has(tool)) return args.some((a) => /^-(?:computername|cimsession|credential)$/i.test(a)) ? ask('other', `Read another computer with ${tool}`, rule) : ALLOW;
  if (HARMLESS_PROGRAMS.has(tool)) return ALLOW;
  if (DEV_TOOLS.has(tool)) return devToolJudge(tool, args, ctx, raw);
  return null;
}

const SETUP_NAMES = ['.claude', '.git', '.husky', '.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', '.vscode', '.npmrc', '.yarnrc', '.yarnrc.yml', 'pip.conf', 'pip.ini'];
const SETUP_FOLDERS = ['.claude', '.git', '.husky', '.vscode'];

/** What runs differently with a setup file or folder of this name. */
const runsFor = (name: string): Runs => (/^\.(?:git|husky)$/i.test(name) ? 'git' : /^\.vscode$/i.test(name) ? 'VS Code' : (packageSetup(name.toLowerCase()) ?? 'Claude Code'));

/** How a copy or move brings setup along: a .claude, .git, .husky or .vscode folder itself, or a folder holding one at its top. */
function carriedSetup(source: string, ctx: Ctx): { what: string; runs: Runs } | null {
  const where = placeOf(source, ctx);
  if (where.place === 'unknown' || where.place === 'records') return null;
  try {
    if (statSync(where.path, { throwIfNoEntry: false })?.isDirectory() !== true) return null;
  } catch {
    return null;
  }
  const name = ctx.p.basename(where.path).toLowerCase();
  if (SETUP_FOLDERS.includes(name)) return { what: `a copy of ${name}`, runs: runsFor(name) };
  const held = SETUP_NAMES.find((n) => exists(ctx.p.join(where.path, n)));
  return held ? { what: `a folder that brings its own ${held}`, runs: runsFor(held) } : null;
}

/**
 * cp's, mv's, ln's and install's short options one to a word, so -t's target folder is a word of its own: `-rt dir` is
 * `-t dir`; `-t.git/hooks` and `--target-directory=x` carry it attached. -S takes the rest of its word as a suffix.
 */
function coreutilsOption(a: string): string[] {
  if (a.startsWith('--target-directory=')) return ['--target-directory', a.slice('--target-directory='.length)];
  if (!/^-[A-Za-z]/.test(a)) return [a];
  for (let k = 1; k < a.length; k++) {
    const c = a.charAt(k);
    if (c === 'S') return [a];
    if (c === 't') return k + 1 < a.length ? ['-t', a.slice(k + 1)] : ['-t'];
  }
  return [a];
}

/**
 * A link's target outside the project would let later reads and writes through it leave the project, and one to the
 * project's setup would let a later write change it (a hard link doesn't even look like a link afterwards). `ln`'s link
 * (`at`: the destination it names, null for the working folder) and its target both in the desk's own scratch folder
 * are the desk's own work, like any other file there.
 */
function linkTarget(target: string, ctx: Ctx, ln?: { at: string | null; into: boolean }): Judgement {
  const pieces = commaPieces(target, ctx);
  if (pieces !== null) return first(...pieces.map((piece) => linkTarget(piece, ctx, ln)));
  const where = placeOf(target, ctx);
  if (where.place === 'inside') return ALLOW;
  if (where.place === 'records') return deny(RECORDS);
  if (where.place === 'setup' && where.setup) return askSetup(`Change how ${where.setup.runs} runs in this project: a link to ${where.setup.rel}`);
  if (ln !== undefined && scratchLink(target, ln, ctx)) return ALLOW;
  return ask('outside-project', `Link to ${shown(where.path, ctx)}, outside the project`);
}

/**
 * cmd's `mklink [/D | /H | /J] link target`, its flag in either case and as Git Bash passes it (`//D`). The link is a write
 * at its place; the target is judged as a link out of the project, from the working folder, and for a symbolic link (no flag
 * or /D) from the link's own folder too, where Windows reads a relative target. Anything else in its words asks.
 */
function mklinkJudge(args: readonly string[], ctx: Ctx, rule: AlwaysRule | null): Judgement {
  let symbolic = true;
  const names: string[] = [];
  for (const a of args) {
    const flag = /^\/\/?([dhj])$/i.exec(a)?.[1];
    if (flag !== undefined) symbolic = symbolic && flag.toLowerCase() === 'd';
    else names.push(a);
  }
  const [link, target] = names;
  if (names.length !== 2 || link === undefined || target === undefined || names.some((n) => /^\/\/?[A-Za-z?]$/.test(n))) {
    return ask('other', "Make a link with mklink, from words the office can't read as a link and its target", rule);
  }
  const at = placeOf(link, ctx);
  const linkFolder: Ctx | null = at.place === 'unknown' ? null : { ...ctx, cwd: ctx.p.dirname(at.path) };
  const fromLink = !symbolic ? ALLOW : linkFolder === null ? ask('other', 'Make a link whose place it works out as it runs') : linkTarget(target, linkFolder);
  return first(writePath(link, ctx, 'Make a link at'), linkTarget(target, ctx), fromLink);
}

/**
 * Whether ln makes a link in the desk's own scratch folder to something in it. A symbolic link's relative target is
 * read from the folder the link is in, not the working one, so the target has to stay in the scratch folder read from
 * the working folder (as a hard link reads it) and from every folder the link may be in: the one -t names, the working
 * folder when no destination is named, and else the destination itself (a folder it goes into) or its folder (the
 * link's own name). placeOf already counts a path through a link that leaves the scratch folder as outside.
 */
function scratchLink(target: string, ln: { at: string | null; into: boolean }, ctx: Ctx): boolean {
  const folder = ctx.deskScratch;
  if (folder === null) return false;
  const mine = (w: Where) => w.place === 'scratch' && within(ctx, folder, w.path);
  const link = placeOf(ln.at ?? '.', ctx);
  if (!mine(placeOf(target, ctx)) || !mine(link)) return false;
  const from = ln.at === null || ln.into ? [link.path] : [link.path, ctx.p.dirname(link.path)];
  return from.every((cwd) => mine(placeOf(target, { ...ctx, cwd })));
}

/**
 * Follows a variable the command sets: it stands for the first of its values that leaves the folder, else the first,
 * so `cat $f` is judged as the worst file `f` takes. A value the shell works out leaves it unknown.
 */
function remember(ctx: Ctx, name: string, values: readonly string[], loop = false): void {
  if (!/^\w{1,64}$/.test(name)) return;
  // Used without quotes, a value with a space splits into words, and one with a glob or brace becomes several paths: those a
  // loop walks through are patterns the shell matches against real names, which a value somebody set is not.
  const splits = (v: string) => {
    const known = substitute(v, ctx);
    return /\s|\{/.test(known) || (!loop && /[*?[]/.test(known));
  };
  if (values.length === 0 || values.some((v) => v.includes(COMPUTED) || splits(v)) || ctx.multi.has(name)) {
    ctx.vars.delete(name);
    return;
  }
  const worst = values.find((v) => looksOutside(v) || /\$|%\w+%/.test(v));
  ctx.vars.set(name, worst ?? values[0] ?? '');
}

/**
 * What a variable set from `$!` stands for, so that a later stop can name it: `$!` is the id of the background job this
 * very command started. Any other value (or the same name set again to one) takes it away.
 */
function followStopTargets(ctx: Ctx, name: string, value: string): void {
  ctx.jobs.vars.delete(name);
  if (ctx.multi.has(name)) return;
  if (value === '$!' && ctx.jobs.started) {
    ctx.jobs.vars.add(name);
    return;
  }
  // A copy of one of them (`P2=$PID`) stands for the same thing.
  const from = variableOf(value);
  if (from !== null && from !== name) {
    if (ctx.jobs.vars.has(from)) ctx.jobs.vars.add(name);
  }
}

const CD = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'push-location']);
/** Shell keywords in front of a command (`if git push; then`, `do npm test`): the command after them is judged. */
const KEYWORD_PREFIX = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', 'time', '{', 'elseif', 'try', 'finally']);
/** Keywords that open or close a block and run nothing by themselves. */
const KEYWORD_ALONE = new Set(['fi', 'done', 'esac', '}', 'for', 'foreach', 'select', 'case', 'in', 'function', 'switch', 'catch', 'param', 'begin', 'process', 'end']);

/** Judges one simple command given as words; `cwd` comes back for a `cd`. */
function judgeWords(input: readonly string[], ctx: Ctx, dialect: Dialect, raw: string): { parts: Judged[]; cwd?: string | null } {
  let words = [...input];
  while (words.length > 0 && KEYWORD_PREFIX.has((words[0] ?? '').toLowerCase())) words.shift();
  // `NAME+=value` changes a variable by what it already held.
  const appended = /^([A-Za-z_]\w*)\+=/.exec(words[0] ?? '')?.[1];
  if (appended !== undefined && dialect === 'bash') {
    ctx.vars.delete(appended);
    ctx.jobs.vars.delete(appended);
    return { parts: [] };
  }
  // NAME=value on its own sets a variable the policy follows; before a command it is the command's own.
  const assignments: [string, string][] = [];
  while (words.length > 0 && /^[A-Za-z_]\w*=/.test(words[0] ?? '')) {
    const word = words.shift() ?? '';
    assignments.push([word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)]);
  }
  if (words.length === 0) {
    const bad = assignments.find(([name]) => dangerousEnv(name));
    if (bad) return { parts: [{ j: ask('other', `Set ${oneLine(bad[0], 40)}, which can make a later command run code or reach another address`, exactRule('Bash', raw)), raw }] };
    for (const [name, value] of assignments) {
      remember(ctx, name, [value]);
      followStopTargets(ctx, name, value);
    }
  }
  // A command run with a dangerous variable set first (`BASH_ENV=x cmd`, `GIT_CONFIG_KEY_0=...`) can make git or
  // another program run code, so it asks whatever the command is.
  const badPrefix = words.length > 0 ? assignments.find(([name]) => dangerousEnv(name)) : undefined;
  if (badPrefix) return { parts: [{ j: ask('other', `Run a command with ${oneLine(badPrefix[0], 40)} set, which can make a program run code`, exactRule(dialect === 'powershell' ? 'PowerShell' : 'Bash', raw)), raw }] };
  // In PowerShell `$x = value` sets a variable; `$x = Get-Thing ...` runs the command on the right.
  if (dialect === 'powershell' && /^\$[\w:]+$/.test(words[0] ?? '') && words[1] === '=') {
    const right = words.slice(2);
    if (right.length === 1 && !/^[A-Za-z]+-[A-Za-z]+$/.test(right[0] ?? '') && programJudge(programName(right[0] ?? ''), [], ctx, raw, dialect) === null) {
      remember(ctx, (words[0] ?? '').slice(1), right);
      return { parts: [] };
    }
    words = right;
  }
  if (words.length === 0) return { parts: [] };
  const head = words[0] ?? '';
  // PowerShell gives a parameter its value after a colon as well: `-Path:x` is `-Path x`. A switch's `:$true` stays put.
  const args = dialect === 'powershell' ? words.slice(1).flatMap(colonParameter) : words.slice(1);
  // `for x in a b c` runs nothing itself; its variable stands for the words it walks through.
  if ((head === 'for' || head === 'select' || head === 'foreach') && args[1] === 'in') {
    remember(ctx, (args[0] ?? '').replace(/^\$/, ''), args.slice(2), true);
    return { parts: [] };
  }
  if (KEYWORD_ALONE.has(head.toLowerCase())) return { parts: [] };
  if (dialect === 'bash') forgetSet(ctx, head, args);
  if (head === 'export' || head === 'local' || head === 'readonly' || head === 'declare' || head === 'typeset') {
    for (const arg of args) if (/^[A-Za-z_]\w*=/.test(arg)) remember(ctx, arg.slice(0, arg.indexOf('=')), [arg.slice(arg.indexOf('=') + 1)]);
    // Exporting a dangerous variable sets it for the commands that follow in the same shell.
    const bad = args.find((arg) => /^[A-Za-z_]\w*=/.test(arg) && dangerousEnv(arg.slice(0, arg.indexOf('='))));
    if (bad) return { parts: [{ j: ask('other', `Set ${oneLine(bad.slice(0, bad.indexOf('=')), 40)}, which can make a later command run code`, exactRule('Bash', raw)), raw }] };
  }
  // A program named by a variable runs from where the variable leads, when the policy knows ($TMPDIR/check.sh).
  const placed = /^\$/.test(head) && /[\\/]/.test(head) && expand(head, ctx) !== null;
  if (head.includes(COMPUTED) || (/^\$/.test(head) && !placed)) return { parts: [{ j: ask('other', 'Run a program whose name it works out as it runs'), raw }] };
  // PowerShell: `[IO.File]::Delete(...)`, `[ScriptBlock]::Create(...)`: .NET called straight, which can do anything a program can.
  if (dialect === 'powershell' && (head.startsWith('[') || head.includes('::') || head.includes('('))) {
    return { parts: [{ j: ask('other', 'Run PowerShell code that calls .NET directly (it could change files or reach the network)', exactRule('PowerShell', raw)), raw }] };
  }
  const tool = programName(head);
  if (CD.has(tool)) {
    const target = valueOf(args.map((a) => a.toLowerCase()), '-path', '-literalpath') !== undefined ? args[args.findIndex((a) => ['-path', '-literalpath'].includes(a.toLowerCase())) + 1] : positionals(args)[0];
    // `cd -` and `cd ~-` go back to a folder the policy didn't follow; CDPATH (asked where it is set) makes a name mean another folder.
    if (target === '-' || target === '~-') return { parts: [{ j: ask('other', 'Change to the folder it was in before, which the office does not follow'), raw }], cwd: null };
    const expanded = expand(target ?? '~', ctx);
    return { parts: [], cwd: expanded === null || ctx.cwd === null ? null : ctx.p.resolve(ctx.cwd, expanded) };
  }
  if (tool === 'popd' || tool === 'pop-location') return { parts: [], cwd: null };
  // After a `cd` out of the project, every command works on somewhere else.
  if (!HARMLESS_PROGRAMS.has(tool)) {
    if (ctx.cwd === null) return { parts: [{ j: ask('other', `Run ${oneLine(tool, 40)} in a folder it works out as it runs`), raw }] };
    const here = placeOf(ctx.cwd, ctx);
    if (here.place === 'records') return { parts: [{ j: deny(RECORDS), raw }] };
    if (here.place !== 'inside' && here.place !== 'scratch') return { parts: [{ j: ask('outside-project', `Run ${oneLine(tool, 40)} in ${shown(here.path, ctx)}, outside the project`), raw }] };
  }
  // A program given as a path: the project's own script, or one in the desk's scratch, runs as it is; a known tool is
  // judged by its name.
  if (/[\\/]/.test(head)) {
    const where = placeOf(head, ctx);
    if (where.place === 'records') return { parts: [{ j: deny(RECORDS), raw }] };
    if (where.place !== 'inside' && where.place !== 'scratch') return { parts: [{ j: ask('outside-project', `Run ${shown(where.path, ctx)}, from outside the project`), raw }] };
    // In PowerShell a word with a slash is only a script when there is one: anything else is code it reads differently.
    if (dialect === 'powershell' && !['', '.ps1', '.exe', '.cmd', '.bat', '.com'].some((ext) => isFile(`${where.path}${ext}`))) {
      return { parts: [{ j: ask('other', `Run ${shown(where.path, ctx)}, which isn't a file in the project`, exactRule('PowerShell', raw)), raw }] };
    }
    return { parts: [{ j: programJudge(tool, args, ctx, raw, dialect) ?? argsStayInside(args, ctx), raw }] };
  }
  const known = programJudge(tool, args, ctx, raw, dialect);
  if (known !== null) return { parts: [{ j: known, raw }] };
  // The project's own program; a subcommand that says it releases (`vsce publish`) still asks.
  if (projectBin(tool, ctx) || packageOf(ctx)?.deps.has(tool)) return { parts: [{ j: first(releaseAsk(tool, subcommandWords(args), raw) ?? ALLOW, serverJudge(tool, args, exactRule(dialect === 'powershell' ? 'PowerShell' : 'Bash', raw)), argsStayInside(args, ctx)), raw }] };
  // Trusted runs other programs on the project's files; each word that names a path is still judged.
  if (ctx.trusted) return { parts: [{ j: trustedRun(tool, args, ctx, raw), raw }] };
  // It asks either way; one whose name or words say it releases asks as that, so the inbox says what it is.
  const unknown = ask('other', `Run ${oneLine(tool, 40)}, a program the office doesn't know`, exactRule(dialect === 'powershell' ? 'PowerShell' : 'Bash', raw));
  return { parts: [{ j: releaseAsk(tool, positionals(args), raw) ?? unknown, raw }] };
}

/** A word that names another computer, not a file: a URL, `host:port`, `user@host:path` or a UNC path. Its host, or null. */
function remoteWord(word: string): string | null {
  const url = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/\s]+@)?([^/:?#\s]*)/.exec(word);
  if (url) return url[1] || word;
  const unc = /^(?:\\\\|\/\/)([^\\/\s]+)/.exec(word);
  if (unc) return unc[1] ?? word;
  const scp = /^[^\s@/\\:]+@([^\s@/\\:]+):/.exec(word);
  if (scp) return scp[1] ?? word;
  const port = /^([A-Za-z0-9][A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\]):\d{1,5}(?:[/?#]|$)/.exec(word);
  return port ? (port[1] ?? word) : null;
}

/** PowerShell's `-Name:value` as `-Name value`; a switch given `:$true` or `:$false` stays one word. */
function colonParameter(word: string): string[] {
  const m = /^(-[A-Za-z][A-Za-z0-9]+):([\s\S]+)$/.exec(word);
  if (!m || /^\$(?:true|false)$/i.test(m[2] ?? '')) return [word];
  return [m[1] ?? word, m[2] ?? ''];
}

/**
 * A program a Trusted person runs on the project's files. Its name or a word it is given that says it deploys or
 * publishes asks as that (`kamal deploy`, `ansible-playbook deploy.yml`); otherwise every word that names a path, alone
 * or carried by an option (`-o.git/hooks/x`, `-OutFile:x`, `-uhttp://host`), is judged, so the project's setup still
 * asks, the office's records are refused and anything outside the project asks.
 */
function trustedRun(tool: string, args: readonly string[], ctx: Ctx, raw: string): Judgement {
  const judgements: Judgement[] = [releaseAsk(tool, positionals(args), raw) ?? ALLOW, serverJudge(tool, args, exactRule('Bash', raw))];
  for (const value of args.flatMap(optionValues).flatMap((v) => commaPieces(v, ctx) ?? [v])) {
    if (value === '' || value.startsWith('-')) continue;
    // A word that reaches another computer is not a path in the project, whatever the program does with it.
    const remote = remoteWord(value);
    if (remote) {
      judgements.push(ask('other', `Reach ${oneLine(remote, 60)} over the network`));
      continue;
    }
    const where = placeOf(value, ctx);
    if (where.place === 'setup' && where.setup) judgements.push(askSetup(`Change how ${where.setup.runs} runs in this project: ${where.setup.rel}`));
    else if (where.place !== 'inside' && where.place !== 'scratch') judgements.push(readPath(value, ctx, 'Use'));
  }
  return first(...judgements);
}

/** Builtins that set the variables their words name. */
const SETTERS = new Set(['read', 'unset', 'mapfile', 'readarray', 'getopts', 'declare', 'typeset', 'local', 'readonly', 'export']);

/**
 * What a command that sets variables by their name takes away: `read D`, `unset D`, `printf -v D`, `export D=x` (set
 * again just after), a `declare -n` that makes one name stand for another, and everything with `eval`, `source` and the
 * builtins that may set any variable.
 */
function forgetSet(ctx: Ctx, head: string, args: readonly string[]): void {
  if (ANY_BINDERS.has(head) || ((head === 'declare' || head === 'typeset' || head === 'local') && args.some((a) => /^-[A-Za-z]*n/.test(a)))) {
    ctx.vars.clear();
    ctx.jobs.vars.clear();
    return;
  }
  const names = SETTERS.has(head) ? args : head === 'printf' ? args.filter((a) => a.startsWith('-v')).map((a) => (a === '-v' ? (args[args.indexOf(a) + 1] ?? '') : a.slice(2))) : [];
  for (const arg of names) {
    const name = arg.replace(/\+?=[\s\S]*$/, '');
    if (/^[A-Za-z_]\w*$/.test(name)) {
      ctx.vars.delete(name);
      ctx.jobs.vars.delete(name);
    } else if (!arg.startsWith('-') && arg !== '') {
      // A name it works out could be any of them.
      ctx.vars.clear();
      ctx.jobs.vars.clear();
    }
  }
}

/** Programs that write or replace the files they are given: naming a pid file to one may change what it holds. */
const isFileWriter = (head: string): boolean => WRITERS.has(head) || COPIERS.has(head) || ['tee', 'sed', 'dd', 'truncate', 'ln', 'install'].includes(head);

/**
 * What the stop targets of this command's own text stop standing for once a later command touches them: a variable named
 * to a builtin that sets it (`read PID`, `export PID=1`, `for PID in ...`), anything a builtin that may set any variable
 * does (`eval`, `source`, `printf -v`), and a pid file written to again or named to a program that may write it. The command
 * that sets them to a job or a lookup is judged after this, and puts its own back.
 */
function untrackTouched(cmd: SimpleCommand, ctx: Ctx): void {
  const jobs = ctx.jobs;
  const at = cmd.words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w));
  const head = at === -1 ? '' : programName(cmd.words[at] ?? '');
  const rest = at === -1 ? [] : cmd.words.slice(at + 1);
  // `wait` reaps the job, and its number can then be somebody else's.
  if (head === 'wait') {
    jobs.vars.clear();
    jobs.files.clear();
    jobs.started = false;
    return;
  }
  if (ANY_BINDERS.has(head) || ENV_SETTERS.has(head) || (head === 'printf' && rest.some((w) => w.startsWith('-v')))) {
    jobs.vars.clear();
    jobs.files.clear();
    return;
  }
  for (const word of rest) {
    const name = /^(?:-v)?([A-Za-z_]\w*)(?:\+?=.*)?$/.exec(word)?.[1];
    if (name !== undefined && (BINDERS.has(head) || head === 'for' || head === 'select' || head === 'getopts')) {
      jobs.vars.delete(name);
    }
  }
  if (jobs.files.size === 0) return;
  // The file stays trusted only through commands the policy can place: it forgets the file at one it can't (a script, a test
  // run, an unknown program), at one that may write it, and at a substitution, which runs commands of its own.
  const nested = cmd.words.some((w) => w.includes(COMPUTED)) || cmd.redirects.some((r) => r.target.includes(COMPUTED));
  if (head !== '' && (!keepsFiles(head, rest) || (nested && head !== 'kill'))) {
    jobs.files.clear();
    return;
  }
  if (head === '' && nested) {
    jobs.files.clear();
    return;
  }
  const touched = [...cmd.redirects.filter((r) => r.op === '>').map((r) => r.target), ...(isFileWriter(head) ? rest.filter((w) => !w.startsWith('-')) : [])];
  for (const target of touched) {
    const where = placeOf(target, ctx);
    if (where.place === 'unknown') jobs.files.clear();
    else jobs.files.delete(compareKey(ctx, where.path));
  }
}

/** Programs that read, print or wait and never write a file they are given (curl and wget unless told to save). */
const PLACED_BETWEEN = new Set([
  'cat', 'head', 'tail', 'wc', 'ls', 'stat', 'test', '[', '[[', 'sleep', 'wait', 'kill', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rm', 'true', 'false',
  'date', 'pwd', 'tasklist', 'netstat', 'ps', 'which', 'where', 'cygpath', 'curl', 'wget', 'cd', 'seq', 'uniq', 'cut', 'tr', 'basename', 'dirname',
]);
function keepsFiles(head: string, rest: readonly string[]): boolean {
  if (!PLACED_BETWEEN.has(head)) return false;
  return !((head === 'curl' || head === 'wget') && rest.some((w) => /^-[A-Za-z]*[oOcDa]|^--(?:output|cookie-jar|dump-header|output-document|trace|append-output)/.test(w)));
}

function judgeSimple(cmd: SimpleCommand, ctx: Ctx, dialect: Dialect): { parts: Judged[]; cwd?: string | null } {
  const parts: Judged[] = [];
  if (dialect === 'bash' && (ctx.jobs.started || ctx.jobs.vars.size > 0 || ctx.jobs.files.size > 0)) untrackTouched(cmd, ctx);
  for (const r of cmd.redirects) {
    if (r.op === '<<<') continue;
    const j = r.op === '>' ? writePath(r.target, ctx, 'Write') : readPath(r.target, ctx);
    if (j.verdict !== 'allow') parts.push({ j, raw: cmd.raw });
  }
  const stdin = cmd.redirects.filter((r) => r.op === '<').at(-1)?.target ?? null;
  const judged = judgeWords(cmd.words, stdin === ctx.stdin ? ctx : { ...ctx, stdin }, dialect, cmd.raw);
  // `echo $! > file` (or `printf %s $! > file`) keeps the id of this command's own background job where a later
  // `kill $(cat file)` finds it. `$!` is the only word it prints: any other text would put another id in the file.
  const head = programName(cmd.words[0] ?? '');
  const sole = (head === 'echo' && cmd.words.length === 2 && cmd.words[1] === '$!') || (head === 'printf' && cmd.words.length === 3 && cmd.words[1] === '%s' && cmd.words[2] === '$!');
  if (dialect === 'bash' && ctx.jobs.started && sole && cmd.redirects.length === 1 && cmd.redirects[0]?.op === '>' && !/>>/.test(cmd.raw)) {
    const where = placeOf(cmd.redirects[0].target, ctx);
    if (where.place === 'inside' || where.place === 'scratch') ctx.jobs.files.add(compareKey(ctx, where.path));
  }
  return 'cwd' in judged ? { parts: [...parts, ...judged.parts], cwd: judged.cwd ?? null } : { parts: [...parts, ...judged.parts] };
}

/** The variables the policy stands a value for in Bash (the temporary folder's and the working folder's) and IFS. */
const WATCHED = ['TMPDIR', 'TEMP', 'TMP', 'PWD', 'IFS'];
/** A word that sets one of them, or names it to a builtin that does: `TMPDIR=x`, `read TMP`, `-vTEMP`, `ref=PWD`. */
const SETS_WATCHED = /(?:^|=|^-[A-Za-z]*)(TMPDIR|TEMP|TMP|PWD|IFS)(?:\+?=|\[|$)/;
/** Builtins that set the variables their words name. */
const BINDERS = new Set(['read', 'declare', 'typeset', 'local', 'export', 'readonly', 'unset']);
/** Builtins that may set any variable, whatever their words say. */
const ANY_BINDERS = new Set(['eval', 'source', '.', 'let', 'mapfile', 'readarray', 'getopts', 'trap', 'enable']);
/** Programs that run the rest with an environment of their choosing. */
const ENV_SETTERS = new Set(['env', 'dotenv', 'dotenvx']);
/** A word whose value the shell works out as it runs. */
const dynamic = (word: string) => word.includes('$') || word.includes('`') || word.includes(COMPUTED);
/**
 * A word given to a builtin that sets variables, when the NAME it sets is worked out (`read "$n"`, `export "$n=x"`). A
 * value that is worked out (`export DIR="$TMPDIR/x"`) sets the one variable it names and nothing else.
 */
const dynamicName = (word: string) => dynamic(word.includes('=') ? word.slice(0, word.indexOf('=')) : word);

/**
 * The watched variables a Bash command may set before it uses them, so the values the policy stands for them no longer
 * hold: the ones it names to set, and all of them where a builtin sets a variable whose name it works out (`read "$n"`,
 * `printf -v "$n"`, eval, source) or a program starts the rest with another environment (`env -i`).
 */
function bashMoves(commands: readonly SimpleCommand[]): Set<string> {
  const moved = new Set<string>();
  const all = () => {
    for (const name of WATCHED) moved.add(name);
  };
  for (const { words } of commands) {
    for (const word of words) {
      const name = SETS_WATCHED.exec(word)?.[1];
      if (name) moved.add(name);
      if (ENV_SETTERS.has(programName(word))) all();
    }
    // The command that runs: past keywords (`time -p` too) and its own assignments, and through command and builtin.
    let at = words.findIndex((w) => !KEYWORD_PREFIX.has(w.toLowerCase()) && !w.startsWith('-') && !/^[A-Za-z_]\w*=/.test(w));
    while (at !== -1 && (words[at] === 'command' || words[at] === 'builtin')) {
      at++;
      while ((words[at] ?? '').startsWith('-')) at++;
    }
    const head = at === -1 ? undefined : words[at];
    if (head === undefined) continue;
    const rest = words.slice(at + 1);
    // printf sets a variable with -v NAME (or -vNAME), and a first word it works out may be that -v.
    const v = rest.findIndex((w) => w.startsWith('-v'));
    const vName = v === -1 ? null : rest[v] === '-v' ? (rest[v + 1] ?? '') : (rest[v] ?? '');
    const printfSets = (rest[0] !== undefined && rest[0] !== '--' && dynamic(rest[0])) || (vName !== null && dynamic(vName));
    // A head it works out may be any builtin; one with a path in it is a program, which can't set the shell's variables.
    const anyBuiltin = dynamic(head) && !/[\\/]/.test(head);
    if (
      anyBuiltin || ANY_BINDERS.has(head) || (BINDERS.has(head) && rest.some(dynamicName)) || (head === 'printf' && printfSets) ||
      (head === 'exec' && rest.some((w) => w.startsWith('-') || dynamic(w)))
    ) {
      all();
    }
  }
  return moved;
}

/** PowerShell's ways to set the temporary folder's variables: the env: drive, an assignment to $env:TEMP, their names. */
const PS_SETS_TEMP = [/(?<!\$\{?)\benv:/i, /\$\{?env:(?:tmpdir|temp|tmp)\}?\s*(?:[-+*/%]|\?\?)?=/i, /(?<![\w$:-])(?:tmpdir|temp|tmp)(?![\w-])/i];

/** Every simple command of a Bash script and of the commands nested in it, in the order they are written. */
function allCommands(command: string, depth = 0): SimpleCommand[] {
  if (depth > DEPTH_LIMIT) return [];
  const scanned = scanCommand(command, 'bash');
  return scanned ? [...scanned.commands, ...scanned.nested.flatMap((body) => allCommands(body, depth + 1))] : [];
}

/**
 * The variables a script sets more than once, by assignment, `read`, `for`, `+=`, `export` and the like: a loop can run a
 * command again after a later one changed what they hold, and a subshell's assignment doesn't reach the shell around it, so no
 * single value can stand for them.
 */
function assignedTwice(command: string): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  const note = (name: string) => (seen.has(name) ? twice.add(name) : seen.add(name));
  for (const { words } of allCommands(command)) {
    let at = 0;
    while (at < words.length && KEYWORD_PREFIX.has((words[at] ?? '').toLowerCase())) at++;
    const head = words[at] ?? '';
    for (let i = at; i < words.length; i++) {
      const w = words[i] ?? '';
      const assign = /^([A-Za-z_]\w*)\+?=/.exec(w)?.[1];
      if (assign !== undefined && (i === at || SETTERS.has(head) || /^[A-Za-z_]\w*=/.test(words[i - 1] ?? '') || i < words.length)) note(assign);
      else if (i === at + 1 && (head === 'for' || head === 'select') && /^[A-Za-z_]\w*$/.test(w)) note(w);
      else if (i > at && (SETTERS.has(head) || head === 'printf') && /^[A-Za-z_]\w*$/.test(w)) note(w);
    }
  }
  return twice;
}

/** Every simple command in `command` and the commands nested in it, judged in order. */
function judgeShell(command: string, dialect: Dialect, ctx: Ctx): Judged[] {
  if (ctx.depth > DEPTH_LIMIT) return [{ j: ask('other', 'Run a command nested too deep for the office to read'), raw: command }];
  const scanned = scanCommand(command, dialect);
  if (!scanned) return [{ j: ask('other', "Run a command the office can't read (an open quote or bracket)"), raw: command }];
  // Read before any part is judged: a loop can run a part again after a later one set a variable.
  const found = dialect === 'bash' ? bashMoves(scanned.commands) : new Set(PS_SETS_TEMP.some((re) => re.test(command)) ? TEMP_NAMES : []);
  const moved = found.size === 0 ? ctx.moved : new Set([...ctx.moved, ...found]);
  const out: Judged[] = [];
  let here: Ctx = { ...ctx, shell: dialect, moved };
  for (const simple of scanned.commands) {
    const r = judgeSimple(simple, here, dialect);
    out.push(...r.parts);
    if ('cwd' in r) here = { ...here, cwd: r.cwd ?? null, pkg: undefined };
    // From here on `$!` is the id of a job this command started.
    if (simple.background) ctx.jobs.started = true;
  }
  for (const body of scanned.nested) out.push(...judgeShell(body, dialect, { ...ctx, shell: dialect, moved, depth: ctx.depth + 1 }));
  return out;
}

/** The judgement of a list of parts: a deny wins, then the first ask, else allow. */
function toJudgement(parts: readonly Judged[]): Judgement {
  return first(...parts.map((p) => p.j));
}

// ---------------------------------------------------------------------------------------------------------------------
// Permission rules

interface Rule {
  tool: string;
  content: string | null;
}

function parseRules(rules: readonly string[]): Rule[] {
  const out: Rule[] = [];
  for (const rule of Array.isArray(rules) ? rules.slice(0, 500) : []) {
    if (typeof rule !== 'string' || rule.length > 1_000) continue;
    const m = /^([A-Za-z_][\w-]*)(?:\(([\s\S]*)\))?$/.exec(rule.trim());
    if (m?.[1]) out.push({ tool: m[1], content: m[2] ?? null });
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Claude Code's command rules: exact, a prefix before ":*", or wildcards. A bare tool name allows every command. */
function commandMatches(content: string | null, command: string): boolean {
  if (content === null) return true;
  const pattern = squash(content);
  const text = squash(command);
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return text === prefix || text.startsWith(`${prefix} `);
  }
  if (pattern.includes('*')) {
    const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
    return re.test(text);
  }
  return text === pattern;
}

/** A path rule's pattern ("//c/x/**", "~/x/*", "./src/**", "src/**") as a test of a full path. */
function pathMatches(content: string, path: string, ctx: Ctx): boolean {
  let pattern = content.trim();
  if (pattern.startsWith('//')) pattern = ctx.win ? pattern.slice(1).replace(/^\/([a-zA-Z])(?=\/)/, (_m, d: string) => `${d}:`) : pattern.slice(1);
  else if (pattern.startsWith('~/')) pattern = ctx.p.join(ctx.home, pattern.slice(2));
  else pattern = ctx.p.join(ctx.cwd ?? ctx.root, pattern.replace(/^\.\//, ''));
  const norm = (s: string) => (ctx.win ? s.replaceAll('\\', '/').toLowerCase() : s);
  const body = norm(pattern)
    .split(/(\*\*\/?|\*)/)
    .map((part) => (part.startsWith('**') ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`).test(norm(path));
}

function toolRuleMatches(rule: Rule, tool: string, input: Obj, ctx: Ctx): boolean {
  if (tool.startsWith('mcp__')) return rule.content === null && (rule.tool === tool || tool.startsWith(`${rule.tool.replace(/__\*$/, '')}__`));
  if (rule.tool !== tool) return false;
  if (rule.content === null) return true;
  if (tool === 'WebFetch') {
    const host = typeof input.url === 'string' ? hostOf(input.url) : null;
    const domain = /^domain:(.+)$/.exec(rule.content.trim())?.[1]?.toLowerCase();
    return host !== null && domain !== undefined && (host === domain || host.endsWith(`.${domain}`));
  }
  const file = [input.file_path, input.notebook_path, input.path].find((v): v is string => typeof v === 'string');
  return file !== undefined && pathMatches(rule.content, ctx.p.resolve(ctx.cwd ?? ctx.root, file), ctx);
}

// ---------------------------------------------------------------------------------------------------------------------
// Tools

const ROUTINE_TOOLS = new Set([
  'Agent', 'Task', 'Skill', 'TodoWrite', 'ToolSearch', 'LSP', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool',
  'ExitPlanMode', 'TaskOutput', 'BashOutput', 'KillShell', 'KillBash', 'TaskStop', 'Monitor', 'WebSearch', 'ListAgents', 'ReportFindings',
]);

/** A connector's name as people say it: "claude_ai_Gmail" is Gmail. */
const serverName = (server: string) => server.replace(/^(?:claude_ai_|plugin_[^_]+_)/, '').replace(/[_-]+/g, ' ').trim() || server;

/** The org tools by their full names: the only tools of the office's own server a desk may use, and the ones it is allowed. */
const KNOWN_ORG_TOOLS: ReadonlySet<string> = new Set([...Object.values(ORG_TOOLS).flat(), ...Object.values(STEERING_TOOLS).flat()].map((t) => `mcp__org__${t}`));

/** The allow rules for one person's org tools, each by its exact name: a bare `mcp__org` would also allow a tool the office doesn't have. */
export function orgToolRules(person: Pick<Person, 'id' | 'level'> & { title?: string }): string[] {
  const checks = person.level === 'ceo' || isCheckerSeat({ id: person.id, title: person.title ?? '' });
  const steering = [
    ...STEERING_TOOLS.everyone,
    ...(isManager(person) ? STEERING_TOOLS.managers : []),
    ...(person.level === 'ceo' ? STEERING_TOOLS.ceo : []),
    ...(checks ? STEERING_TOOLS.checkers : []),
  ];
  return [...toolsFor(person), ...steering].map((t) => `mcp__org__${t}`);
}

/**
 * The browser tools of Chrome DevTools, which a desk uses to look at the app it is building: the user's own server, the
 * desk's own page, never the office's, and named by the form Claude Code gives a plugin's server or a user's own. A tool
 * that opens an address asks unless the address is this computer's; one that reads a file or writes one is judged as the
 * file tools are. The rest act on the page the desk opened, so they need nobody.
 */
const BROWSER_TOOL = /^mcp__(?:plugin_chrome-devtools-mcp_)?chrome-devtools__([a-z_]+)$/;
const BROWSER_TOOLS = new Set([
  'click', 'close_page', 'drag', 'emulate', 'evaluate_script', 'fill', 'fill_form', 'get_console_message', 'get_css_styles', 'get_network_request',
  'handle_dialog', 'hover', 'lighthouse_audit', 'list_console_messages', 'list_network_requests', 'list_pages', 'navigate_page', 'new_page',
  'performance_analyze_insight', 'performance_start_trace', 'performance_stop_trace', 'press_key', 'resize_page', 'screencast_start', 'screencast_stop',
  'select_page', 'take_heapsnapshot', 'take_screenshot', 'take_snapshot', 'type_text', 'upload_file', 'wait_for', 'click_at',
  'analyze_heapsnapshot_contexts', 'close_heapsnapshot', 'compare_heapsnapshots', 'query_heapsnapshot_objects', 'get_heapsnapshot_class_nodes',
  'get_heapsnapshot_details', 'get_heapsnapshot_dominators', 'get_heapsnapshot_duplicate_strings', 'get_heapsnapshot_edges',
  'get_heapsnapshot_object_details', 'get_heapsnapshot_retainers', 'get_heapsnapshot_retaining_paths', 'get_heapsnapshot_summary',
]);

/** The tools of the server that read the files they are given; every other file parameter is a place they write. */
const BROWSER_READERS = /^(?:upload_file|analyze_heapsnapshot_contexts|close_heapsnapshot|compare_heapsnapshots|get_heapsnapshot_\w+|query_heapsnapshot_objects)$/;
/** Tools that run code or hand files to the page: asked every time (one Always allow covers the server), whatever the arguments. */
const BROWSER_RUNS = new Set(['upload_file', 'evaluate_script']);

/** An ask no Always allow lifts: the stakeholder allowing the server must not allow a path or an address with it. */
const stuck = (j: Judgement): Judgement => (j.verdict === 'ask' ? { ...j, rule: null, sticky: true } : j);

/** Every string, and every string of a list, an input holds under a key that names what it is: [key, value]. */
function stringsOf(input: Obj, key: RegExp): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of Object.entries(input)) {
    if (!key.test(name)) continue;
    for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string' && v !== '') out.push([name, v]);
  }
  return out;
}

function browserToolJudge(tool: string, input: Obj, ctx: Ctx): Judgement | null {
  const name = BROWSER_TOOL.exec(tool)?.[1];
  if (name === undefined || !BROWSER_TOOLS.has(name)) return null;
  const server = /^(mcp__.+?)__/.exec(tool)?.[1] ?? tool;
  const judgements: Judgement[] = [];
  // Every address is this computer's.
  for (const [, url] of stringsOf(input, /url/i)) {
    const host = hostOf(url);
    if (!host || !LOCAL_HOST.test(host) || !addressKnown(url)) judgements.push(stuck(ask('other', `Open ${host ?? oneLine(url, 60)} in the browser`)));
  }
  // Every value under a key that names a path, file, folder or source is a read or a write, by what the tool does.
  for (const [key, value] of stringsOf(input, /(path|file|dir|source)/i)) {
    const reads = BROWSER_READERS.test(name) || (name === 'evaluate_script' && /source/i.test(key));
    judgements.push(stuck(reads ? readPath(value, ctx) : writePath(value, ctx, 'Write')));
  }
  // Code and files handed to the page ask the first time, whatever else is in order.
  if (BROWSER_RUNS.has(name) || stringsOf(input, /script/i).some(([key]) => /init/i.test(key))) {
    judgements.push(ask('other', `Use the browser to ${name.replace(/_/g, ' ')}, which runs code in the page or hands it files`, { rule: server, sentence: `anything the browser tools can do, every time` }));
  }
  return first(...judgements);
}

function connectorJudge(tool: string): Judgement {
  const [, server = '', name = ''] = /^mcp__(.+?)__(.+)$/.exec(tool) ?? [];
  const who = serverName(server);
  const action = name.replace(/[_-]+/g, ' ').trim();
  const n = name.toLowerCase();
  // A server the person was assigned is the user's own and not the office's: its first use is the stakeholder's to allow, and
  // a verb in a tool's name ("get", "export") says nothing about what the tool does. Always allow is for the whole server;
  // spending, sending and deleting keep one for the tool alone, so a read allowed once doesn't open them.
  const perServer: AlwaysRule = { rule: `mcp__${server}`, sentence: `anything ${who} can do, every time` };
  const perTool: AlwaysRule = { rule: tool, sentence: `${action} through ${who}, every time` };
  if (/(?:^|_|-)(?:pay|charge|purchase|buy|order|checkout|transfer|refund|subscribe)/.test(n)) return ask('paid-api', `Spend money with ${who} (${action})`, perTool);
  if (/send|post|reply|comment|message|email|mail|invite|share|notify|publish|tweet|(?:^|_)dm(?:_|$)|chat|draft/.test(n)) return ask('message-out', `Send something with ${who} (${action})`, perTool);
  if (/delete|remove|archive|drop|destroy|cancel|revoke|deactivate|disable|purge|trash/.test(n)) return ask('other', `Delete or remove something with ${who} (${action})`, perTool);
  return ask('other', `Use ${who} to ${action}`, perServer);
}

function judgeTool(tool: string, input: Obj, ctx: Ctx): Judgement {
  if (KNOWN_ORG_TOOLS.has(tool)) return ALLOW;
  // `mcp__org__<anything else>` is not the office's: a server can't take the org's name (src/server/claude-config.ts), so nothing legitimate lands here.
  if (tool === 'mcp__org' || tool.startsWith('mcp__org__')) return deny('The office has no such tool.');
  if (tool.startsWith('mcp__')) return browserToolJudge(tool, input, ctx) ?? connectorJudge(tool);
  const path = [input.file_path, input.notebook_path, input.path].find((v): v is string => typeof v === 'string' && v !== '');
  switch (tool) {
    case 'Read': case 'NotebookRead': case 'LS': case 'Glob': case 'Grep': {
      const pattern = tool === 'Glob' && typeof input.pattern === 'string' && looksOutside(input.pattern) ? input.pattern : null;
      return first(path ? readPath(path, ctx) : ALLOW, pattern ? readPath(pattern, ctx) : ALLOW);
    }
    case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return path ? writePath(path, ctx) : deny(UNREADABLE);
    case 'WebFetch': {
      const host = typeof input.url === 'string' ? hostOf(input.url) : null;
      if (!host) return deny(UNREADABLE);
      return LOCAL_HOST.test(host) ? ALLOW : ask('other', `Read ${host} on the web`, { rule: `WebFetch(domain:${host})`, sentence: `reading pages on ${host}` });
    }
    case 'AskUserQuestion':
      return deny(NO_QUESTIONS);
    case 'EnterWorktree': case 'ExitWorktree':
      return ask('other', 'Work in a worktree of its own, which the office manages for long tasks');
    case 'CronCreate': case 'CronDelete': case 'ScheduleWakeup': case 'RemoteTrigger':
      return ask('other', 'Schedule work for later on the computer', { rule: tool, sentence: `${tool}, every time` });
    case 'PushNotification': case 'SendMessage': case 'Workflow':
      return ask('other', `Use Claude Code's ${tool} tool`, { rule: tool, sentence: `${tool}, every time` });
    default:
      return ROUTINE_TOOLS.has(tool) ? ALLOW : ask('other', `Use the ${oneLine(tool, 40)} tool`);
  }
}

/** The exact request, masked, for the inbox's "Show the command". */
function detailOf(tool: string, input: Obj): string {
  if (typeof input.command === 'string') return redactClip(input.command, DETAIL_LIMIT);
  const path = [input.file_path, input.notebook_path, input.path, input.url].find((v): v is string => typeof v === 'string');
  if (path) return redactClip(path, DETAIL_LIMIT);
  return redactClip(`${tool} ${jsonOf(input)}`.trim(), DETAIL_LIMIT);
}

/** An input as JSON, or nothing for one that can't be written (a cycle a caller built). */
function jsonOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * The policy for one PermissionRequest payload. Allow and deny need no one; an ask carries what the inbox shows. A rule
 * in `rules` that matches an asking request (for a chained command, every asking part) allows it; nothing allows the
 * office's own records.
 */
export function classifyPermission(payload: unknown, o: PolicyOptions): PermissionVerdict {
  if (!isObj(payload)) return { verdict: 'deny', message: UNREADABLE };
  const tool = typeof payload.tool_name === 'string' && payload.tool_name.length > 0 && payload.tool_name.length <= 200 ? payload.tool_name : null;
  if (!tool) return { verdict: 'deny', message: UNREADABLE };
  const input = isObj(payload.tool_input) ? payload.tool_input : {};
  const ctx = makeCtx(o, payload);
  const rules = parseRules(o.rules);

  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = typeof input.command === 'string' && input.command.length <= 100_000 ? input.command : null;
    if (command === null || command.trim() === '') return { verdict: 'deny', message: UNREADABLE };
    if (/WORKLINGS_|x-worklings-desk/i.test(command)) return { verdict: 'deny', message: 'The office keeps its own wiring (the desk token and its settings) out of what a desk reads or sends.' };
    if (tool === 'Bash') ctx.multi = assignedTwice(command);
    const parts = judgeShell(command, tool === 'PowerShell' ? 'powershell' : 'bash', ctx);
    const denied = parts.find((p) => p.j.verdict === 'deny')?.j;
    if (denied?.verdict === 'deny') return { verdict: 'deny', message: denied.message };
    const asking = parts.filter((p): p is Judged & { j: Ask } => p.j.verdict === 'ask');
    if (asking.length === 0) return { verdict: 'allow' };
    const ours = rules.filter((r) => r.tool === tool);
    const sticky = asking.some((p) => p.j.sticky);
    // A whole chain is allowed only by a rule written for exactly it: a prefix or a wildcard covers one part at a
    // time, so "git push origin:*" can't carry a "&& npm publish" along. No rule lifts a change to the project's setup.
    if (!sticky && ours.some((r) => r.content !== null && !/\*/.test(r.content) && commandMatches(r.content, command))) return { verdict: 'allow' };
    const open = asking.filter((p) => p.j.sticky || !ours.some((r) => commandMatches(r.content, p.raw)));
    // A change to the project's setup leads, so its kind is the one the inbox shows.
    open.sort((a, b) => Number(b.j.sticky) - Number(a.j.sticky));
    const [one, two] = open;
    if (!one) return { verdict: 'allow' };
    const summary = two ? `${one.j.summary}, then ${lowerFirst(two.j.summary)}${open.length > 2 ? ` and ${open.length - 2} more` : ''}` : one.j.summary;
    const rule = open.length === 1 && asking.length === 1 ? one.j.rule : null;
    const alwaysRule = rule && tool === 'PowerShell' ? { ...rule, rule: rule.rule.replace(/^Bash\(/, 'PowerShell(') } : rule;
    const shownSummary = oneLine(summary, SUMMARY_LIMIT);
    return { verdict: 'ask', kind: one.j.kind, summary: shownSummary, detail: detailOf(tool, input), alwaysRule, advice: adviceFor(one.j.kind, shownSummary) };
  }

  const j = judgeTool(tool, input, ctx);
  if (j.verdict === 'allow') return { verdict: 'allow' };
  if (j.verdict === 'deny') return { verdict: 'deny', message: j.message };
  if (!j.sticky && rules.some((r) => toolRuleMatches(r, tool, input, ctx))) return { verdict: 'allow' };
  return { verdict: 'ask', kind: j.kind, summary: j.summary, detail: detailOf(tool, input), alwaysRule: j.rule, advice: adviceFor(j.kind, j.summary) };
}
