// The company's git work: its work branch, a worktree and branch for each long task, a commit for each finished task,
// the merges on the work branch and a task's diff. Git runs from an argument list, never through a shell, with no
// prompts and a timeout that stops it and everything it started; nothing here pushes, fetches or touches a remote, only
// branches named worklings/... change, and the project's own git hooks run. Every failure is a sentence the office can
// show as it is.
//
// The calls are asynchronous, so a slow hook or a busy machine never holds up the hub, and the ones that change a
// checkout take turns in it (`oneAtATime`).
import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readdir, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { LIMITS, OrgRefusal, type Task } from '../core/company.ts';
import { oneLine } from '../core/events.ts';
import { redactSecrets } from '../core/redact.ts';
import { plainPath } from '../safe-fs.ts';
import { tokenFile } from '../server/token.ts';

const BRANCH_PREFIX = 'worklings/';
/**
 * Between the company's id and a task's in a task branch: worklings/<company>--<task>. Git can't hold
 * worklings/<company>/<task> next to the work branch worklings/<company>, because one ref name can't be a branch and a
 * folder of branches at once.
 */
const TASK_SEPARATOR = '--';
const FIRST_COMMIT = 'Start the project';

/**
 * How long git may run before Worklings stops it and everything it started: plain calls (reading, listing, staging),
 * and those that run the project's own hooks (checkouts, commits, merges), which may lint, test or install. Tests
 * shorten them to see a hook that hangs stopped.
 */
export const gitTimeouts = { plainMs: 60_000, hooksMs: 5 * 60_000 };

const DIFF_LIMIT = 200 * 1024;
/** Everything else git prints, lists of paths above all: far beyond any project's, and still a bound. */
const OUTPUT_LIMIT = 64 * 1024 * 1024;
/** Git's error output kept for its sentence: the first lines say why. */
const STDERR_LIMIT = 64 * 1024;
/** How long a stopped git may take to go before its caller hears anyway. */
const KILL_WAIT_MS = 5_000;
/** Off Windows, how long git has to take its lock files away after being asked to stop, before it is made to. */
const KILL_GRACE_MS = 2_000;

/** One part of a branch name, and a folder name, on every system. */
const ID = /^[A-Za-z0-9](?:[\w.-]{0,62}[A-Za-z0-9])?$/;
/** Names Windows keeps for devices, which can't be folders. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

/**
 * What Worklings and Claude Code put in a company's folder before any work (its state, the studio and CLAUDE.md): a
 * folder holding only these is new, whichever of them the company wrote first, and becomes a repository.
 */
const OWN_ENTRIES: ReadonlySet<string> = new Set(['.worklings', '.claude', 'CLAUDE.md']);

/**
 * What git reads to find a repository and its index (`git rev-parse --local-env-vars`). Git sets some of them for the
 * hooks it runs, so an office started from a hook would otherwise point every call here at that hook's repository.
 */
const REPOSITORY_VARIABLES: ReadonlySet<string> = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR',
  'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
]);

/** Diffs as plain text: no colours, and none of the external diff or conversion programs a repository can name. */
const DIFF_FLAGS: readonly string[] = ['--no-color', '--no-ext-diff', '--no-textconv', '--patch-with-stat'];

const GIT_MISSING = "Git isn't installed, or Worklings can't find it on the PATH.";
const SET_IDENTITY = 'Set them with git config --global user.name "Your Name" and git config --global user.email "you@example.com".';

const companyBranch = (companyId: string): string => `${BRANCH_PREFIX}${companyId}`;
/** Worktrees live outside every project, in Worklings' own folder (~/.worklings, or where WORKLINGS_HOME puts it). */
const worktreesFolder = (): string => resolve(dirname(tokenFile()), 'worktrees');

/**
 * The calls that change a checkout run one at a time in it, as they would by hand: two commits at once would fight
 * over its index, and a merge would take another task's freshly staged files for changes in its way.
 */
const turns = new Map<string, Promise<void>>();

function oneAtATime<T>(folder: string, work: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? resolve(folder).toLowerCase() : resolve(folder);
  const result = (turns.get(key) ?? Promise.resolve()).then(work);
  const over = result.then(
    () => undefined,
    () => undefined,
  );
  turns.set(key, over);
  void over.then(() => {
    if (turns.get(key) === over) turns.delete(key);
  });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// The work branch

export interface BranchResult {
  /** The company's work branch, checked out in the project; null when it couldn't be. */
  branch: string | null;
  /** Why not, in a sentence; null when the branch is ready. */
  problem: string | null;
}

/**
 * Puts the project on the company's work branch, worklings/<companyId>. A repository switches to it (made from HEAD
 * the first time, an unborn HEAD included) and keeps its uncommitted changes as they are; when switching would clash
 * with them, it stays as it was and the problem says which files. A new folder becomes a repository whose first commit
 * holds a .gitignore (FIRST_IGNORE). A folder with files that isn't a repository stays as it is. Only an id git can't
 * use rejects.
 */
export async function prepareBranch(root: string, companyId: string): Promise<BranchResult> {
  const branch = companyBranch(checkId(companyId, 'company'));
  const folder = resolve(root);
  return oneAtATime(folder, async () => {
    try {
      if (!(await isFolder(folder))) return refused(`${folder} isn't a folder, so finished tasks won't be committed.`);
      const place = await placeOf(folder);
      if (place.kind === 'top') return await switchTo(folder, branch);
      if (place.kind === 'broken') return refused(`Git can't work in ${folder}, so finished tasks won't be committed: ${place.says}`);
      if (await isNewFolder(folder)) return await startRepository(folder, branch);
      if (place.kind === 'inside') {
        return refused(`${folder} is a folder inside the git repository at ${place.top}, so finished tasks won't be committed. Run the company in ${place.top} instead.`);
      }
      return refused(`${folder} isn't a git repository, so finished tasks won't be committed until it is one.`);
    } catch (error) {
      // Git missing, or stopped at its timeout: the company runs without commits and says why.
      return refused(error instanceof Error ? error.message : String(error));
    }
  });
}

const refused = (problem: string): BranchResult => ({ branch: null, problem });

/**
 * The commit a branch points at, or null: asked once the work branch is made, it is where the company started, which the
 * final review diffs against. Read only. Never rejects: a company without it just gives its reviewer a log to read.
 */
export async function branchTip(root: string, branch: string): Promise<string | null> {
  try {
    return await commitOf(resolve(root), `refs/heads/${branch}`);
  } catch {
    return null;
  }
}

async function switchTo(root: string, branch: string): Promise<BranchResult> {
  if ((await onBranch(root)) === branch) return { branch, problem: null };
  const exists = (await commitOf(root, `refs/heads/${branch}`)) !== null;
  if (exists) {
    const clash = await clashesWith(root, branch);
    if (clash.length > 0) {
      return refused(`Switching to ${branch} would clash with uncommitted changes to ${fileList(clash)}, so the checkout was left as it is. Commit or stash them, then open the company again.`);
    }
  }
  // A new branch starts where HEAD is, so making it can't clash with anything. --no-overwrite-ignore keeps an ignored
  // file (a local .env) from being replaced by one the branch tracks.
  const args = exists ? ['switch', '--quiet', '--no-guess', '--no-overwrite-ignore', branch] : ['switch', '--quiet', '--create', branch];
  const r = await run(root, args, { timeoutMs: gitTimeouts.hooksMs });
  // A post-checkout hook that fails still leaves the switch made.
  if (r.status === 0 || (await onBranch(root)) === branch) return { branch, problem: null };
  return refused(`Couldn't switch to ${branch}, so the checkout was left as it is: ${gitSays(r)}`);
}

/** Uncommitted changes, new files included, to files that differ between HEAD and `branch`. */
async function clashesWith(root: string, branch: string): Promise<string[]> {
  // On an unborn HEAD there is nothing to compare with; git refuses a switch that would clash by itself.
  if ((await commitOf(root, 'HEAD')) === null) return [];
  const differ = new Set(names(await ok(root, ['diff', '--name-only', '-z', '--no-renames', 'HEAD', branch, '--'], `compare HEAD with ${branch}`)));
  return (await changes(root)).map((c) => c.path).filter((path) => differ.has(path));
}

async function startRepository(root: string, branch: string): Promise<BranchResult> {
  await ok(root, ['init', '--quiet'], `make ${root} a git repository`);
  let started = false;
  let ignoring = false;
  try {
    if (await identityMissing(root)) {
      return refused(`Git has no name and email for you, so ${root} couldn't have its first commit and was left as it was. ${SET_IDENTITY} Then open the company again.`);
    }
    // Worklings made this repository, so its first commit ignores what tools install and build: a person who ran npm
    // install before anyone wrote a .gitignore once left thousands of files in the way of every commit.
    await writeFile(plainPath(root, '.gitignore'), FIRST_IGNORE, { flag: 'wx' });
    ignoring = true;
    await ok(root, ['add', '--', '.gitignore'], 'add the .gitignore');
    const r = await run(root, ['commit', '--quiet', '-m', FIRST_COMMIT], { timeoutMs: gitTimeouts.hooksMs });
    if (r.status !== 0) return refused(`Couldn't make the first commit in ${root}, so it was left as it was: ${gitSays(r)}`);
    started = true;
  } finally {
    // The folder was new, so taking away the repository (and the .gitignore) made a moment ago leaves it as it was.
    if (!started) {
      await rm(join(root, '.git'), { recursive: true, force: true, maxRetries: 3 });
      if (ignoring) await rm(join(root, '.gitignore'), { force: true });
    }
  }
  return switchTo(root, branch);
}

/** The .gitignore of a repository Worklings makes: installed packages, build output and local secrets. */
const FIRST_IGNORE = [
  '# Written by Worklings when it made this repository: what tools install and build, and local secrets.',
  'node_modules/',
  '.venv/',
  '__pycache__/',
  'dist/',
  'build/',
  'coverage/',
  '.env',
  '.env.*',
  '!.env.example',
  '',
].join('\n');

const isNewFolder = async (folder: string): Promise<boolean> => (await readdir(folder)).every((name) => OWN_ENTRIES.has(name));

// ---------------------------------------------------------------------------------------------------------------------
// Worktrees for long tasks

export interface Worktree {
  path: string;
  branch: string;
}

/**
 * Gives a long task its own worktree and branch, worklings/<companyId>--<taskId>, made from the company's work branch.
 * The worktree lives outside the project, in Worklings' worktrees folder under <companyId>/<taskId>. Asked again for
 * the same task, it gives back the worktree already made; a task branch kept from before is checked out again.
 */
export async function addWorktree(root: string, companyId: string, taskId: string): Promise<Worktree> {
  const company = companyBranch(checkId(companyId, 'company'));
  const branch = `${company}${TASK_SEPARATOR}${checkId(taskId, 'task')}`;
  const repo = resolve(root);
  return oneAtATime(repo, async () => {
    await topFolder(repo, `make a worktree for ${branch}`);
    const path = join(worktreesFolder(), companyId, taskId);
    if (isInside(repo, path)) throw new Error(`Worklings' worktrees folder ${worktreesFolder()} is inside the project, so a task's worktree would be part of it.`);

    const known = await worktrees(repo);
    const held = known.find((w) => w.branch === branch);
    if (held && !samePath(held.path, path)) throw new Error(`${branch} is already checked out at ${held.path}, so it can't have a second worktree.`);
    if (held && (await exists(path))) return { path, branch };
    // Its folder was deleted by hand: clear git's record of it and make it again.
    if (held) await ok(repo, ['worktree', 'remove', path], `clear the missing worktree at ${path}`);
    else if ((await exists(path)) || known.some((w) => samePath(w.path, path))) throw new Error(`${path} is already there, so the task's worktree can't be made in it.`);

    if ((await commitOf(repo, `refs/heads/${company}`)) === null) {
      throw new Error(`${company} has no commits yet, so a task can't have a worktree until the first task is committed in the checkout.`);
    }
    await mkdir(dirname(path), { recursive: true });
    const args = (await commitOf(repo, `refs/heads/${branch}`)) === null
      ? ['worktree', 'add', '--quiet', '-b', branch, path, company]
      : ['worktree', 'add', '--quiet', path, branch];
    const r = await run(repo, args, { timeoutMs: gitTimeouts.hooksMs });
    // A post-checkout hook that fails still leaves the worktree made.
    if (r.status !== 0 && !(await worktrees(repo)).some((w) => w.branch === branch && samePath(w.path, path))) {
      throw new Error(`Couldn't make a worktree for ${branch}: ${gitSays(r)}`);
    }
    return { path, branch };
  });
}

/**
 * Merges a task's branch into the company's work branch in the project's checkout, always with a merge commit, and
 * gives that commit; null when the branch brought nothing new. A merge that conflicts is undone and refused with
 * OrgRefusal('conflict') naming the files, and so is one that uncommitted changes in the checkout keep from starting.
 */
export async function mergeWorktree(root: string, worktree: Worktree, message: string): Promise<{ commit: string | null }> {
  const { company } = taskBranchParts(worktree.branch);
  const text = checkMessage(message);
  const repo = resolve(root);
  return oneAtATime(repo, async () => {
    await topFolder(repo, `merge ${worktree.branch}`);
    const head = await onBranch(repo);
    if (head !== company) {
      throw new Error(`The checkout is on ${head ?? 'a detached HEAD'}, not ${company}, so ${worktree.branch} wasn't merged. Switch it back to ${company} first.`);
    }
    if ((await commitOf(repo, `refs/heads/${worktree.branch}`)) === null) throw new Error(`${worktree.branch} doesn't exist any more, so there is nothing to merge.`);
    // Undoing a failed merge below must never undo someone else's.
    if ((await commitOf(repo, 'MERGE_HEAD')) !== null) {
      throw new Error(`The checkout is in the middle of another merge, so ${worktree.branch} wasn't merged. Finish or abort that merge first.`);
    }

    const before = await commitOf(repo, 'HEAD');
    // A merge never carries uncommitted changes along (autostash) or replaces ignored files.
    const r = await run(repo, ['merge', '--no-ff', '--no-edit', '--no-autostash', '--no-overwrite-ignore', '-m', text, worktree.branch], { timeoutMs: gitTimeouts.hooksMs });
    if (r.status === 0) {
      const after = await commitOf(repo, 'HEAD');
      return { commit: after === before ? null : after };
    }

    if ((await commitOf(repo, 'MERGE_HEAD')) !== null) {
      const conflicted = names(await ok(repo, ['diff', '--name-only', '-z', '--diff-filter=U'], 'list the conflicting files'));
      const abort = await run(repo, ['merge', '--abort']);
      if (abort.status !== 0) {
        throw new Error(`Merging ${worktree.branch} stopped half-way and couldn't be undone: ${gitSays(abort)} Run git merge --abort in ${repo}.`);
      }
      if (conflicted.length > 0) {
        throw new OrgRefusal('conflict', `Merging ${worktree.branch} into ${company} conflicts in ${fileList(conflicted)}, so the merge was undone. Bring the task's worktree up to date with ${company} and settle them there, then merge again.`);
      }
      throw new Error(`The merge of ${worktree.branch} was stopped, so it was undone: ${gitSays(r)}`);
    }
    // Git refused before it started.
    const blocking = await blockedBy(repo, worktree.branch);
    if (blocking.length > 0) {
      throw new OrgRefusal('conflict', `${worktree.branch} can't be merged while the checkout has uncommitted changes to ${fileList(blocking)}. Commit them, then merge again.`);
    }
    throw new Error(`Couldn't merge ${worktree.branch} into ${company}: ${gitSays(r)}`);
  });
}

/** What keeps a merge from starting: anything staged in the checkout, and uncommitted changes to files the merge brings. */
async function blockedBy(repo: string, branch: string): Promise<string[]> {
  const incoming = new Set(names(await ok(repo, ['diff', '--name-only', '-z', '--no-renames', `HEAD...${branch}`, '--'], `list what ${branch} changes`)));
  return (await changes(repo)).filter((c) => c.staged || incoming.has(c.path)).map((c) => c.path);
}

/**
 * Removes a task's worktree, only ever one in Worklings' worktrees folder, then its branch if it is merged (git branch
 * -d, never -D: an unmerged branch stays with its work). A worktree with uncommitted changes stays too, and the error
 * says which files.
 */
export async function removeWorktree(root: string, worktree: Worktree): Promise<void> {
  taskBranchParts(worktree.branch);
  const path = ownWorktree(worktree.path);
  const repo = resolve(root);
  return oneAtATime(repo, async () => {
    await topFolder(repo, `remove the worktree of ${worktree.branch}`);
    const registered = (await worktrees(repo)).some((w) => samePath(w.path, path));
    if (await exists(path)) {
      if (!registered) throw new Error(`${path} isn't a worktree of ${repo}, so it was left alone.`);
      const left = (await changes(path)).map((c) => c.path);
      if (left.length > 0) throw new Error(`The worktree of ${worktree.branch} has uncommitted changes to ${fileList(left)}, so it was kept. Commit or drop them first.`);
      await ok(repo, ['worktree', 'remove', path], `remove the worktree at ${path}`);
    } else if (registered) {
      // Deleted by hand: clear git's record of it.
      await ok(repo, ['worktree', 'remove', path], `clear the missing worktree at ${path}`);
    }
    // `git branch -d` refuses an unmerged branch with an error; asking first keeps that from being one.
    if ((await commitOf(repo, `refs/heads/${worktree.branch}`)) !== null && (await run(repo, ['merge-base', '--is-ancestor', worktree.branch, 'HEAD'])).status === 0) {
      await ok(repo, ['branch', '-d', worktree.branch], `delete ${worktree.branch}`);
    }
    const companyFolder = dirname(path);
    if (!samePath(companyFolder, worktreesFolder()) && (await exists(companyFolder)) && (await readdir(companyFolder)).length === 0) await rmdir(companyFolder);
  });
}

/** The repository's worktrees, the main one first, with the branch each has checked out. */
async function worktrees(repo: string): Promise<{ path: string; branch: string | null }[]> {
  const out: { path: string; branch: string | null }[] = [];
  for (const field of (await ok(repo, ['worktree', 'list', '--porcelain', '-z'], 'list the worktrees')).toString('utf8').split('\0')) {
    if (field.startsWith('worktree ')) out.push({ path: resolve(field.slice('worktree '.length)), branch: null });
    const last = out.at(-1);
    if (last && field.startsWith('branch refs/heads/')) last.branch = field.slice('branch refs/heads/'.length);
  }
  return out;
}

/** A worktree path from a task: inside Worklings' worktrees folder and reached without links, or refused. */
function ownWorktree(path: string): string {
  const base = worktreesFolder();
  const full = resolve(path);
  if (!isAbsolute(path) || samePath(base, full) || !isInside(base, full)) throw new Error(`${path} isn't in Worklings' worktrees folder ${base}, so it was left alone.`);
  return plainPath(base, full);
}

/** The work branch a task branch belongs to; refuses any branch that isn't a task branch Worklings makes. */
function taskBranchParts(branch: string): { company: string } {
  const at = branch.startsWith(BRANCH_PREFIX) ? branch.indexOf(TASK_SEPARATOR, BRANCH_PREFIX.length) : -1;
  const companyId = branch.slice(BRANCH_PREFIX.length, at);
  if (at === -1 || !validId(companyId, 'company') || !validId(branch.slice(at + TASK_SEPARATOR.length), 'task')) {
    throw new Error(`${oneLine(branch, 120)} isn't a task branch Worklings makes, so it was left alone.`);
  }
  return { company: companyBranch(companyId) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Commits

/**
 * Commits a finished task's files, and only them: changes to them, new files and deletions included, whatever else is
 * staged stays out (`git add -A`, then `git commit --only`). Gives the commit, or null when none of them changed. The
 * project's own hooks run. Rejects with a sentence when git has no name and email (never making one up), when the
 * checkout isn't on a worklings/ branch, and for any path that isn't relative and inside the folder.
 *
 * With `strays`, the commit also takes every other uncommitted change in the checkout that no open task owns (none of
 * `strays.except`) and that isn't Worklings' or Claude Code's own (.worklings, .claude, CLAUDE.md): work a person did
 * outside their task's files (a CLI finished beside the engine it wires up) would otherwise stay out of every commit,
 * since only an open task's own commit takes its files. Those files are named in the commit message and given back.
 */
export async function commitTask(
  cwd: string,
  files: readonly string[],
  message: string,
  strays?: { except: readonly string[] },
): Promise<{ commit: string | null; strays: string[] }> {
  const specs = taskPathspecs(files);
  const text = checkMessage(message);
  if (specs.length === 0) return { commit: null, strays: [] };
  const own = specs.map((spec) => spec.slice(LITERAL.length));
  const others = strays ? strays.except.flatMap((file) => taskPathspecs([file])).map((spec) => spec.slice(LITERAL.length)) : [];
  const folder = resolve(cwd);
  return oneAtATime(folder, async () => {
    await topFolder(folder, "commit the task's files");
    const branch = await onBranch(folder);
    if (branch === null || !branch.startsWith(BRANCH_PREFIX)) {
      throw new Error(`${folder} is on ${branch ?? 'a detached HEAD'}, not the company's branch, so the task's files weren't committed.`);
    }
    const noIdentity = `Git has no name and email for you, so the task's files weren't committed. ${SET_IDENTITY}`;

    // Exact paths, so a file the task names but never wrote doesn't stop the staging.
    const listed = await ok(folder, ['ls-files', '-z', '--modified', '--deleted', '--others', '--exclude-standard', '--', ...specs], "list the task's changes");
    const changed = [...new Set(names(listed))];
    const taken = (path: string, entries: readonly string[]) => entries.some((entry) => entry === '.' || inEntry(path, entry));
    const extra = strays
      ? [...new Set((await changes(folder)).map((c) => c.path))].filter((path) => !taken(path, own) && !taken(path, others) && !officeOwn(path) && !installed(path))
      : [];
    const toStage = [...changed, ...extra];
    if (toStage.length > 0) {
      if (await identityMissing(folder)) throw new Error(noIdentity);
      await ok(folder, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], "stage the task's files", { input: toStage.map(literal).join('\0') });
    }
    // Read whole and filtered here: the strays can be thousands of files, more than one command line holds.
    const strayed = new Set(extra);
    const staged = names(await ok(folder, ['diff', '--cached', '--name-only', '-z', '--no-renames'], "list the task's staged files")).filter(
      (path) => taken(path, own) || strayed.has(path),
    );
    if (staged.length === 0) return { commit: null, strays: [] };
    if (toStage.length === 0 && (await identityMissing(folder))) throw new Error(noIdentity);

    const went = extra.filter((path) => staged.includes(path));
    const body = went.length > 0 ? `${text.trimEnd()}\n\nAlso committed, changed outside the task's files: ${fewNames(went)}.` : text;
    const commit = ['commit', '--only', '--quiet', '-m', body, '--pathspec-from-file=-', '--pathspec-file-nul'];
    const r = await run(folder, commit, { input: staged.map(literal).join('\0'), timeoutMs: gitTimeouts.hooksMs });
    if (r.status !== 0) throw new Error(`Couldn't commit the task's files: ${gitSays(r)}`);
    return { commit: await commitOf(folder, 'HEAD'), strays: went };
  });
}

/** Whether a path git gives (forward slashes) is a task's file entry or inside it: without case, as Windows reads them. */
function inEntry(path: string, entry: string): boolean {
  const p = path.toLowerCase();
  const e = entry.toLowerCase().replace(/\/+$/, '');
  return p === e || p.startsWith(`${e}/`);
}

/**
 * Worklings' and Claude Code's own files, which a task's commit never takes unless the task names them: the office's
 * records and the setup that changes how Claude Code runs (.claude folders, CLAUDE.md files), which only change with
 * the stakeholder's approval.
 */
function officeOwn(path: string): boolean {
  const parts = path.toLowerCase().split('/');
  const name = parts.at(-1) ?? '';
  return parts.some((part) => part === '.worklings' || part === '.claude') || name === 'claude.md' || name === 'claude.local.md';
}

/**
 * What a project's package managers install, which no stray commit takes: a person who ran npm install before the
 * project had a .gitignore would otherwise put thousands of package files in the company's history.
 */
function installed(path: string): boolean {
  return path.toLowerCase().split('/').some((part) => part === 'node_modules' || part === '.venv' || part === '__pycache__');
}

/** The commit message names this many strays at most, then counts the rest: the message goes on git's command line. */
const NAMED_STRAYS = 20;

const fewNames = (paths: readonly string[]): string =>
  paths.length <= NAMED_STRAYS ? paths.join(', ') : `${paths.slice(0, NAMED_STRAYS).join(', ')} and ${(paths.length - NAMED_STRAYS).toLocaleString('en-US')} more`;

// ---------------------------------------------------------------------------------------------------------------------
// Saving a cancelled task's work (SPEC-v3.md "Steering", 4)

/** A save's branch names past the first: worklings/<company>--<task>-2, -3... when a task was cancelled before. */
const MAX_SAVES = 50;

/**
 * Keeps a cancelled task's unfinished work in the shared checkout: the task's files as they are now (changes, new files
 * and deletions; ignored files stay out) become one commit on a new branch, worklings/<company>--<task>, made from the
 * work branch, without touching the work branch or what else is staged; then those files go back to the work branch's
 * version, new ones removed. Gives the branch, or null when none of the files had changed (they stay as they are).
 * The commit is git's plumbing, so the project's own hooks don't run: they would refuse unfinished work, which is what
 * a save keeps. Refuses, leaving everything as it was, when the checkout isn't on the company's work branch.
 */
export async function saveTaskWork(root: string, companyId: string, taskId: string, files: readonly string[], message: string): Promise<{ branch: string | null }> {
  const company = companyBranch(checkId(companyId, 'company'));
  const task = checkId(taskId, 'task');
  const specs = taskPathspecs(files);
  const text = checkMessage(message);
  const repo = resolve(root);
  if (specs.length === 0) return { branch: null };
  return oneAtATime(repo, async () => {
    await topFolder(repo, "save the task's work");
    const head = await onBranch(repo);
    if (head !== company) {
      throw new Error(`The checkout is on ${head ?? 'a detached HEAD'}, not ${company}, so the task's work wasn't saved and its files were left as they are.`);
    }
    const base = await commitOf(repo, 'HEAD');
    const against = base ?? (await emptyTree(repo));
    const differ = names(await ok(repo, ['diff', '--name-only', '-z', '--no-renames', against, '--', ...specs], "list the task's changes"));
    const added = names(await ok(repo, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...specs], "list the task's new files"));
    const changed = [...new Set([...differ, ...added])];
    if (changed.length === 0) return { branch: null };
    if (await identityMissing(repo)) throw new Error(`Git has no name and email for you, so the task's work wasn't saved and its files were left as they are. ${SET_IDENTITY}`);

    // The commit is made in an index of its own, from the work branch with the task's files laid over it.
    const scratch = await mkdtemp(join(tmpdir(), 'worklings-save-'));
    let commit: string;
    try {
      const env = { GIT_INDEX_FILE: join(scratch, 'index') };
      await ok(repo, base ? ['read-tree', base] : ['read-tree', '--empty'], 'start from the work branch', { env });
      await ok(repo, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], "take the task's files", { env, input: changed.map(literal).join('\0') });
      const tree = (await ok(repo, ['write-tree'], "write the task's files", { env })).toString('utf8').trim();
      commit = (await ok(repo, ['commit-tree', tree, ...(base ? ['-p', base] : []), '-F', '-'], "commit the task's work", { input: text })).toString('utf8').trim();
    } finally {
      await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
    }
    const branch = await newBranch(repo, `${company}${TASK_SEPARATOR}${task}`, commit);

    // Now the files go back to the work branch's version: tracked ones restored, new ones removed.
    const known = new Set([
      // By the task's own entries, not each changed file: a folder can hold thousands, more than one command line holds.
      ...names(await ok(repo, ['ls-files', '-z', '--cached', '--', ...specs], 'list the tracked files')),
      ...(base ? names(await ok(repo, ['ls-tree', '-r', '-z', '--name-only', base, '--', ...specs], 'list the files on the work branch')) : []),
    ]);
    const tracked = changed.filter((path) => known.has(path));
    if (tracked.length > 0) {
      const args = base ? ['restore', `--source=${base}`, '--staged', '--worktree'] : ['rm', '--cached', '--quiet', '--ignore-unmatch'];
      await ok(repo, [...args, '--pathspec-from-file=-', '--pathspec-file-nul'], "put the task's files back", { input: tracked.map(literal).join('\0') });
    }
    for (const path of changed.filter((p) => !known.has(p) || !base)) await removeNew(repo, path);
    return { branch };
  });
}

/**
 * Keeps a cancelled task's work in its worktree: whatever is uncommitted there becomes one more commit on the task's
 * own branch, so removing the worktree later loses nothing. Gives the branch when it holds work the work branch
 * doesn't (now or from earlier commits), else null. Plumbing again, so no hooks run. A worktree already gone keeps
 * what its branch holds.
 */
export async function saveWorktree(root: string, worktree: Worktree, message: string): Promise<{ branch: string | null }> {
  const { company } = taskBranchParts(worktree.branch);
  const text = checkMessage(message);
  const path = ownWorktree(worktree.path);
  const repo = resolve(root);
  const ahead = async (): Promise<{ branch: string | null }> => {
    if ((await commitOf(repo, `refs/heads/${worktree.branch}`)) === null) return { branch: null };
    const count = Number((await ok(repo, ['rev-list', '--count', `${company}..${worktree.branch}`], `count what ${worktree.branch} holds`)).toString('utf8').trim());
    return { branch: count > 0 ? worktree.branch : null };
  };
  if (!(await exists(path))) return ahead();
  return oneAtATime(path, async () => {
    const head = await onBranch(path);
    if (head !== worktree.branch) throw new Error(`The worktree at ${path} is on ${head ?? 'a detached HEAD'}, not ${worktree.branch}, so its work wasn't saved.`);
    if ((await changes(path)).length === 0) return ahead();
    if (await identityMissing(path)) throw new Error(`Git has no name and email for you, so the task's work wasn't saved. ${SET_IDENTITY}`);
    const base = await commitOf(path, 'HEAD');
    if (base === null) throw new Error(`${worktree.branch} has no commits, so the work in its worktree can't be saved on it.`);
    const scratch = await mkdtemp(join(tmpdir(), 'worklings-save-'));
    try {
      const env = { GIT_INDEX_FILE: join(scratch, 'index') };
      await ok(path, ['read-tree', base], "start from the task's branch", { env });
      await ok(path, ['add', '-A'], 'take the worktree as it is', { env });
      const tree = (await ok(path, ['write-tree'], "write the worktree's files", { env })).toString('utf8').trim();
      const commit = (await ok(path, ['commit-tree', tree, '-p', base, '-F', '-'], "commit the task's work", { input: text })).toString('utf8').trim();
      // Only if the branch is still where it was: a commit made meanwhile isn't overwritten.
      await ok(path, ['update-ref', `refs/heads/${worktree.branch}`, commit, base], `move ${worktree.branch} to the saved work`);
      // The worktree's own index follows its branch, so it shows nothing uncommitted and can be removed.
      await ok(path, ['read-tree', 'HEAD'], "update the worktree's index");
    } finally {
      await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
    }
    return { branch: worktree.branch };
  });
}

/** Makes a branch at a commit under the first free name: `name`, then `name-2`, `name-3`... Never moves one that exists. */
async function newBranch(repo: string, name: string, commit: string): Promise<string> {
  for (let n = 1; n <= MAX_SAVES; n += 1) {
    const branch = n === 1 ? name : `${name}-${n}`;
    if ((await commitOf(repo, `refs/heads/${branch}`)) !== null) continue;
    // The empty old value makes git refuse a branch that appeared meanwhile, rather than move it.
    const r = await run(repo, ['update-ref', `refs/heads/${branch}`, commit, '']);
    if (r.status === 0) return branch;
    if ((await commitOf(repo, `refs/heads/${branch}`)) === null) throw new Error(`Couldn't make the branch ${branch}: ${gitSays(r)}`);
  }
  throw new Error(`${name} has been saved ${MAX_SAVES} times already, so the work wasn't saved again. Delete old branches of it first.`);
}

/** Removes a new file the save kept on its branch, then the folders it leaves empty, never leaving the project. */
async function removeNew(repo: string, path: string): Promise<void> {
  const file = plainPath(repo, path);
  await rm(file, { force: true, maxRetries: 3 });
  // Folders are best effort: git doesn't track them, so one left behind (unreadable, or in use on Windows) is harmless.
  for (let dir = dirname(file); isInside(repo, dir) && !samePath(repo, dir); dir = dirname(dir)) {
    const left = await readdir(dir).then(
      (entries) => entries.length,
      () => 1,
    );
    if (left > 0) break;
    const gone = await rmdir(dir).then(
      () => true,
      () => false,
    );
    if (!gone) break;
  }
}

/** Found out before anything is staged. `git var` reads the same settings a commit would, with the folder's own. */
async function identityMissing(cwd: string): Promise<boolean> {
  for (const name of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    if ((await run(cwd, ['var', name])).status !== 0) return true;
  }
  return false;
}

/** Git takes pathspecs as patterns; a task's files are names ("app/[id].tsx" is one file). */
const LITERAL = ':(literal)';
const literal = (path: string): string => `${LITERAL}${path}`;

/** A task's files and folders as pathspecs, each checked to be a relative path that stays inside the folder. */
function taskPathspecs(files: readonly string[]): string[] {
  if (files.length > LIMITS.files) throw new Error(`A task names at most ${LIMITS.files} files or folders, and this one names ${files.length}.`);
  return [...new Set(files.map(projectPath))].map(literal);
}

function projectPath(file: string): string {
  const shown = `"${oneLine(file, 100)}"`;
  if (file === '' || file.length > LIMITS.path || /\p{Cc}/u.test(file)) throw new Error(`${shown} isn't a file name a task can have.`);
  const slashed = file.replaceAll('\\', '/');
  if (posix.isAbsolute(slashed) || win32.isAbsolute(file) || /^[A-Za-z]:/.test(file)) {
    throw new Error(`${shown} isn't inside the project: a task's files are given relative to its folder.`);
  }
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) throw new Error(`${shown} leads out of the project folder, so it can't be one of a task's files.`);
  if (parts.some((part) => part.toLowerCase() === '.git')) throw new Error(`${shown} is in git's own folder, so it can't be one of a task's files.`);
  return parts.length === 0 ? '.' : parts.join('/');
}

// ---------------------------------------------------------------------------------------------------------------------
// Diffs

/**
 * What a task changed, as a patch with stats: its commit when it has one (for a merge, what it brought into the work
 * branch); otherwise its worktree, committed or not, against where it left the company's work branch; otherwise its
 * files in the checkout against HEAD, new files included. Secrets masked, at most 200 KB with a line saying when it
 * was cut, and empty when nothing changed. Never touches the index, so it doesn't wait its turn in the checkout.
 */
export async function taskDiff(root: string, task: Task): Promise<string> {
  const repo = resolve(root);
  if (task.commit !== null) return shown(await commitDiff(repo, task.commit));
  if (task.worktree !== null) return worktreeDiff(repo, task.worktree);
  const specs = taskPathspecs(task.files);
  if (specs.length === 0) return '';
  await topFolder(repo, "show the task's changes");
  const base = (await commitOf(repo, 'HEAD')) ?? (await emptyTree(repo));
  return shown(await workTreeDiff(repo, base, specs));
}

async function commitDiff(repo: string, commit: string): Promise<Run> {
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error(`"${oneLine(commit, 80)}" isn't a commit id.`);
  const r = await run(repo, ['show', ...DIFF_FLAGS, '--diff-merges=first-parent', '--format=commit %H%n%n%B', commit, '--'], { limit: DIFF_LIMIT });
  if (r.status !== 0) throw new Error(`Couldn't show commit ${commit}: ${gitSays(r)}`);
  return r;
}

async function worktreeDiff(repo: string, worktree: Worktree): Promise<string> {
  const { company } = taskBranchParts(worktree.branch);
  const path = ownWorktree(worktree.path);
  if (await exists(path)) {
    // From where the task left the work branch, so other tasks merged there since don't show up reversed.
    const base = (await ok(path, ['merge-base', company, 'HEAD'], `find where ${worktree.branch} started`)).toString('utf8').trim();
    return shown(await workTreeDiff(path, base, []));
  }
  // The worktree is gone: what its branch still holds, if anything.
  if ((await commitOf(repo, `refs/heads/${worktree.branch}`)) === null) return '';
  const r = await run(repo, ['diff', ...DIFF_FLAGS, `${company}...${worktree.branch}`, '--'], { limit: DIFF_LIMIT });
  if (r.status !== 0) throw new Error(`Couldn't show what ${worktree.branch} changed: ${gitSays(r)}`);
  return shown(r);
}

/**
 * The work tree against `base`. New files show up through a copy of the index that marks them as added (intent to
 * add), so the real index stays as it is.
 */
async function workTreeDiff(cwd: string, base: string, specs: readonly string[]): Promise<Run> {
  const diff = async (env?: Readonly<Record<string, string>>): Promise<Run> => {
    const r = await run(cwd, ['diff', ...DIFF_FLAGS, base, '--', ...specs], { env, limit: DIFF_LIMIT });
    if (r.status !== 0) throw new Error(`Couldn't show the changes in ${cwd}: ${gitSays(r)}`);
    return r;
  };
  const added = names(await ok(cwd, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...specs], 'list the new files'));
  if (added.length === 0) return diff();
  const scratch = await mkdtemp(join(tmpdir(), 'worklings-diff-'));
  try {
    const index = join(scratch, 'index');
    const real = resolve(cwd, (await ok(cwd, ['rev-parse', '--git-path', 'index'], 'find the index')).toString('utf8').trim());
    if (await exists(real)) await copyFile(real, index);
    const env = { GIT_INDEX_FILE: index };
    await ok(cwd, ['add', '--intent-to-add', '--pathspec-from-file=-', '--pathspec-file-nul'], 'include the new files', { env, input: added.map(literal).join('\0') });
    return await diff(env);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** The empty tree in the repository's own hash: what a branch with no commits yet is compared with. */
async function emptyTree(repo: string): Promise<string> {
  return (await ok(repo, ['hash-object', '-t', 'tree', '--stdin'], 'name the empty tree', { input: '' })).toString('utf8').trim();
}

/** A diff for the office: secrets masked, and cut on a line at the limit, with a line saying so. */
function shown(r: Run): string {
  if (!r.cut && r.stdout.length <= DIFF_LIMIT) return redactSecrets(r.stdout.toString('utf8'));
  const end = r.stdout.lastIndexOf(0x0a, DIFF_LIMIT - 1);
  const kept = r.stdout.subarray(0, end >= 0 ? end + 1 : DIFF_LIMIT).toString('utf8');
  return `${redactSecrets(kept)}${kept.endsWith('\n') ? '' : '\n'}The diff is longer than ${DIFF_LIMIT / 1024} KB, so the rest was cut.\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Running git

interface Run {
  /** Git's exit code; -1 when something stopped it. */
  status: number;
  stdout: Buffer;
  stderr: string;
  /** The output went past the caller's limit, so git was stopped there. */
  cut: boolean;
}

interface RunOptions {
  input?: string;
  timeoutMs?: number;
  /** Added to the environment, after what points at another repository is taken out. */
  env?: Readonly<Record<string, string>> | undefined;
  /** Keep this many bytes of output and stop git past them, instead of failing. */
  limit?: number;
}

/**
 * Runs git once. It answers with what git printed and its exit code; it fails, with a sentence, when git couldn't
 * start, ran out of time or printed far too much, and then it has stopped git and everything git started first.
 */
async function run(cwd: string, args: readonly string[], o: RunOptions = {}): Promise<Run> {
  const git = gitExecutable();
  const timeoutMs = o.timeoutMs ?? gitTimeouts.plainMs;
  const command = args[0] ?? '';
  const limit = o.limit ?? OUTPUT_LIMIT;
  return new Promise<Run>((answer, fail) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      // Its own process group off Windows, so a stop reaches the hooks it runs; Windows uses taskkill /T.
      child = spawn(git, args, { cwd, env: gitEnv(o.env), windowsHide: true, detached: process.platform !== 'win32' });
    } catch (error) {
      // Spawn throws, rather than emitting 'error', for arguments it rejects outright.
      fail(new Error(`Couldn't run git ${command} in ${cwd}${codeText(errorCode(error))}.`));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let stopping = false;
    const timer = setTimeout(() => stop(() => fail(new Error(timedOut(command, cwd, timeoutMs)))), timeoutMs);

    function settle(finish: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    }
    // Out of time or flooding: take down everything git started, and answer once git is gone (or after KILL_WAIT_MS).
    function stop(finish: () => void): void {
      if (stopping || settled) return;
      stopping = true;
      clearTimeout(timer);
      void Promise.all([killTree(child), exited(child, KILL_WAIT_MS)]).then(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        settle(finish);
      });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stopping) return;
      stdout.push(chunk);
      stdoutBytes += chunk.length;
      if (stdoutBytes <= limit) return;
      if (o.limit !== undefined) stop(() => answer({ status: 0, stdout: Buffer.concat(stdout), stderr: '', cut: true }));
      else stop(() => fail(new Error(`git ${command} printed more than ${OUTPUT_LIMIT / (1024 * 1024)} MB in ${cwd}, so Worklings stopped it.`)));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const room = STDERR_LIMIT - stderrBytes;
      if (room <= 0) return;
      const part = chunk.subarray(0, room);
      stderr.push(part);
      stderrBytes += part.length;
    });
    child.on('error', (error) => {
      if (stopping) return;
      // A 'close' may still follow; this is the answer.
      stopping = true;
      clearTimeout(timer);
      void startProblem(errorCode(error), command, cwd).then((problem) => settle(() => fail(new Error(problem))));
    });
    child.on('close', (status) => {
      if (stopping) return;
      settle(() => answer({ status: status ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), cut: false }));
    });
    // Git may stop before it reads all of its input; how it stopped says why, so the failed write adds nothing.
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

/** Runs git and gives what it printed, or fails with "Couldn't <doing>: <git's words>". */
async function ok(cwd: string, args: readonly string[], doing: string, o?: RunOptions): Promise<Buffer> {
  const r = await run(cwd, args, o);
  if (r.status !== 0) throw new Error(`Couldn't ${doing}: ${gitSays(r)}`);
  return r.stdout;
}

/** Stops git and everything it started: taskkill /T on Windows, its process group elsewhere. Never rejects. */
async function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform !== 'win32') {
    // Git takes its lock files away when it is asked to stop; whatever is left of the group then goes for good, even
    // after git itself has ended, since a hook it ran may still be going.
    signalGroup(pid, 'SIGTERM');
    await exited(child, KILL_GRACE_MS);
    signalGroup(pid, 'SIGKILL');
    return;
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  // The full path, so a taskkill.exe in the project folder can't stand in for it.
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  await new Promise<void>((done) => {
    execFile(taskkill, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: KILL_WAIT_MS }, (error) => {
      // taskkill fails when git ended a moment ago, or when it couldn't run: then stop git itself.
      if (error) child.kill();
      done();
    });
  });
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // No such group any more: everything in it has ended.
  }
}

/** Resolves when git has exited, or after `ms` when it hasn't. */
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

function gitEnv(extra: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!REPOSITORY_VARIABLES.has(process.platform === 'win32' ? key.toUpperCase() : key)) env[key] = value;
  }
  // No prompt ever waits for an answer (a hook may still reach a remote), and no optional lock on the index, so a
  // look at the repository never gets in the way of a person's own git command.
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extra };
}

let lookup: { path: string; git: string | null } | null = null;

/**
 * Git from the PATH's absolute folders, looked up once per PATH. A relative entry (".", "node_modules/.bin") would be
 * read inside the project git runs in, which could then put a git of its own first.
 */
function gitExecutable(): string {
  const pathValue = process.env.PATH ?? '';
  const known = lookup !== null && lookup.path === pathValue ? lookup : { path: pathValue, git: findGit(pathValue) };
  lookup = known;
  if (known.git === null) throw new Error(GIT_MISSING);
  return known.git;
}

function findGit(pathValue: string): string | null {
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  const folders = pathValue.split(delimiter).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter((d) => d !== '' && isAbsolute(d));
  return folders.map((folder) => join(folder, name)).find(runnable) ?? null;
}

/** Checked once per PATH, so the few stat calls stay synchronous. */
function runnable(file: string): boolean {
  try {
    if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) return false;
    if (process.platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    // Not one this user may run, or a PATH folder they can't read: the next folder may have it.
    return false;
  }
}

const exists = (path: string): Promise<boolean> => access(path).then(
  () => true,
  () => false,
);

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Missing, or a folder this user can't look at: git can't work there either.
    return false;
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

const codeText = (code: string | undefined): string => (code ? ` (${code})` : '');

async function startProblem(code: string | undefined, command: string, cwd: string): Promise<string> {
  // Git's own path was found on the PATH, so a missing file is nearly always the folder.
  if (code === 'ENOENT') return (await isFolder(cwd)) ? GIT_MISSING : `${cwd} doesn't exist, so git can't run there.`;
  // Windows says ENAMETOOLONG, others E2BIG: said plainly, so nobody reads it as the folder not being a repository.
  if (code === 'ENAMETOOLONG' || code === 'E2BIG') {
    return `Couldn't run git ${command} in ${cwd}: its list of files was longer than one command can hold${codeText(code)}.`;
  }
  return `Couldn't run git ${command} in ${cwd}${codeText(code)}.`;
}

function timedOut(command: string, cwd: string, ms: number): string {
  const seconds = Math.round(ms / 1000);
  const took = seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} second${seconds === 1 ? '' : 's'}`;
  return `git ${command} didn't finish within ${took} in ${cwd}, so Worklings stopped it.`;
}

/** Git's own words for why it stopped: its first error line without "fatal:", or else its first line, masked. */
function gitSays(r: Run): string {
  // A hook's output can carry terminal colours and other control characters.
  const lines = `${r.stderr}\n${r.stdout.toString('utf8')}`
    .replace(/\p{Cc}\[[\d;?]*[A-Za-z]/gu, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\p{Cc}/gu, ' ').trim())
    .filter((line) => line !== '' && !/^(?:hint|warning):/i.test(line));
  const line = lines.find((l) => /^(?:fatal|error):/i.test(l)) ?? lines[0] ?? '';
  const words = redactSecrets(oneLine(line.replace(/^(?:fatal|error):\s*/i, ''), 300));
  if (words === '') return r.status === -1 ? 'git was stopped before it finished.' : `git stopped with exit code ${r.status} without saying why.`;
  return /[.!?]$/.test(words) ? words : `${words}.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the repository

type Place = { kind: 'top' } | { kind: 'inside'; top: string } | { kind: 'none' } | { kind: 'broken'; says: string };

/** Whether a folder is the top of a git checkout, a folder inside one, or not in one at all. */
async function placeOf(folder: string): Promise<Place> {
  // In English, so "not a git repository" reads the same whatever language git speaks.
  const r = await run(folder, ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--show-prefix'], { env: { LC_ALL: 'C' } });
  if (r.status !== 0) return /not a git repository/i.test(r.stderr) ? { kind: 'none' } : { kind: 'broken', says: gitSays(r) };
  const [inside, top, prefix] = r.stdout.toString('utf8').split('\n');
  if (inside !== 'true' || !top) return { kind: 'broken', says: "it isn't a checkout." };
  return prefix ? { kind: 'inside', top: resolve(top) } : { kind: 'top' };
}

/** Fails with a sentence saying what the folder is, unless it is the top of a git checkout. */
async function topFolder(folder: string, doing: string): Promise<void> {
  const place = await placeOf(folder);
  if (place.kind === 'top') return;
  if (place.kind === 'none') throw new Error(`${folder} isn't a git repository, so Worklings can't ${doing}.`);
  if (place.kind === 'inside') throw new Error(`${folder} isn't the top folder of its git repository (${place.top}), so Worklings can't ${doing}.`);
  throw new Error(`Git can't work in ${folder}, so Worklings can't ${doing}: ${place.says}`);
}

/** The branch HEAD is on, born or not; null for a detached HEAD. */
async function onBranch(cwd: string): Promise<string | null> {
  const r = await run(cwd, ['symbolic-ref', '--quiet', 'HEAD']);
  if (r.status === 1) return null;
  if (r.status !== 0) throw new Error(`Couldn't read which branch ${cwd} is on: ${gitSays(r)}`);
  const ref = r.stdout.toString('utf8').trim();
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
}

/** The commit a ref points at, or null when there is none (a branch with no commits, a missing ref). */
async function commitOf(cwd: string, ref: string): Promise<string | null> {
  const r = await run(cwd, ['rev-parse', '--quiet', '--verify', `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.toString('utf8').trim() : null;
}

/** Every uncommitted change in a checkout, one per file, new files included. */
async function changes(cwd: string): Promise<{ path: string; staged: boolean }[]> {
  const out = await ok(cwd, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'], `read the changes in ${cwd}`);
  return names(out).map((entry) => ({ path: entry.slice(3), staged: entry[0] !== ' ' && entry[0] !== '?' }));
}

const names = (out: Buffer): string[] => out.toString('utf8').split('\0').filter((name) => name !== '');

// ---------------------------------------------------------------------------------------------------------------------
// Checks

function validId(id: string, kind: 'company' | 'task'): boolean {
  return ID.test(id) && !id.includes('..') && !id.endsWith('.lock') && !DEVICE_NAME.test(id) && !(kind === 'company' && id.includes(TASK_SEPARATOR));
}

function checkId(id: string, kind: 'company' | 'task'): string {
  if (validId(id, kind)) return id;
  const without = kind === 'company' ? `, and no "${TASK_SEPARATOR}"` : '';
  throw new Error(`"${oneLine(id, 80)}" can't name a ${kind} in a git branch: use up to 64 letters, digits, "-", "_" and ".", starting and ending with a letter or digit${without}.`);
}

function checkMessage(message: string): string {
  if (message.trim() === '' || message.includes('\0')) throw new Error('A commit needs a message saying what the work was.');
  return message;
}

const samePath = (a: string, b: string): boolean => relative(resolve(a), resolve(b)) === '';

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** "a.txt", "a.txt and b.txt", "a.txt, b.txt, c.txt and 4 more". */
function fileList(paths: readonly string[]): string {
  const shownPaths = paths.slice(0, 3).map((path) => oneLine(path, 120));
  const more = paths.length - shownPaths.length;
  if (more > 0) return `${shownPaths.join(', ')} and ${more} more`;
  const last = shownPaths.pop() ?? '';
  return shownPaths.length > 0 ? `${shownPaths.join(', ')} and ${last}` : last;
}
