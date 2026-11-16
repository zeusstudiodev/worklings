// The company's git work against real repositories in temp folders. Git runs with no global or system settings of
// this machine (no hooks, signing, line-ending conversion or default branch of its own) and a test identity.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addWorktree, commitTask, gitTimeouts, mergeWorktree, prepareBranch, removeWorktree, taskDiff } from '../src/company/git.ts';
import { OrgRefusal, STAKEHOLDER, type Task } from '../src/core/company.ts';
import { tempDir, writeTree } from './library-kit.ts';

// Each test runs git a dozen times or more, and one call takes up to a second while the machine is busy.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * Untracked files enough that listing them overflows one command line: Windows holds 32,767 characters, and 1,200 paths
 * of about 40 characters (50 with git's `:(literal)` prefix) make 60,000, so the overflow is sure without the minutes
 * that thousands of files cost a loaded machine.
 */
const OVERFLOW_FILES = 1200;
/** A many-files test writes and stages that many files, which takes most of a minute on a loaded machine. */
const MANY_FILES_MS = 240_000;

/** What git reads to find a repository: a test run started from a git hook would point the tests' git at this one. */
const REPOSITORY_VARIABLES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR',
  'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];
const IDENTITY = { GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Lovelace', GIT_COMMITTER_EMAIL: 'ada@example.com' };
/** What every copied repository's one commit holds. */
const FILES = { 'a.txt': 'a\n', 'b.txt': 'b\n', 'gone.txt': 'gone\n', 'other.txt': 'other\n', 'app/[id].tsx': 'one\n', 'app/i.tsx': 'two\n', 'site/index.html': '<p>Hello</p>\n' };
const CUT = 'The diff is longer than 200 KB, so the rest was cut.';
const TIMEOUTS = { ...gitTimeouts };

const fake = (prefix: string, length = 40) => prefix + 'a1B2c3D4e5F6g7H8i9J0'.repeat(10).slice(0, length);

let home = '';
/** Made once and copied by the tests, which is far quicker than git making each one. */
let onMain = '';
let onWorkBranch = '';

/** Git's own settings only, a test identity, and Worklings' home in a new folder, which it returns. */
function isolate(): string {
  for (const name of REPOSITORY_VARIABLES) vi.stubEnv(name, undefined);
  const folder = tempDir('worklings-home-');
  const config = join(folder, 'gitconfig');
  writeFileSync(config, '');
  vi.stubEnv('WORKLINGS_HOME', folder);
  vi.stubEnv('HEADCOUNT_HOME', undefined);
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  // A folder the tests make is never inside a repository, wherever the machine keeps its temp folder.
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(folder));
  for (const [name, value] of Object.entries(IDENTITY)) vi.stubEnv(name, value);
  return folder;
}

beforeAll(() => {
  isolate();
  onMain = writeTree(tempDir('worklings-template-'), FILES);
  git(onMain, 'init', '--quiet', '--initial-branch=main');
  git(onMain, 'add', '-A');
  git(onMain, 'commit', '--quiet', '-m', 'Start');
  onWorkBranch = copyOf(onMain);
  git(onWorkBranch, 'switch', '--quiet', '--create', 'worklings/acme');
  vi.unstubAllEnvs();
});

beforeEach(() => {
  home = isolate();
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(gitTimeouts, TIMEOUTS);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trimEnd();
}

function copyOf(template: string): string {
  const root = tempDir('worklings-repo-');
  cpSync(template, root, { recursive: true });
  return root;
}

/** A repository on main with one commit that holds FILES. */
const repository = (): string => copyOf(onMain);
/** The same, on the company's work branch. */
const company = (): string => copyOf(onWorkBranch);

/** Git with no name and email: none in the environment, and none guessed from the machine. */
function noIdentity(): void {
  for (const name of [...Object.keys(IDENTITY), 'EMAIL']) vi.stubEnv(name, undefined);
  writeFileSync(join(home, 'gitconfig'), '[user]\n\tuseConfigOnly = true\n');
}

function hook(root: string, name: string, body: string): void {
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.git', 'hooks', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** A line of a hook that runs this Node with a script (which holds no double quotes, "$" or backslashes). */
const nodeLine = (script: string, ...args: string[]) => [process.execPath, '-e', script, ...args].map((part) => `"${part.replaceAll('\\', '/')}"`).join(' ');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

const pidIn = (file: string): number => (existsSync(file) ? Number(readFileSync(file, 'utf8')) || 0 : 0);
const branchOf = (cwd: string) => git(cwd, 'symbolic-ref', '--short', 'HEAD');
const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8');
const write = (root: string, file: string, text: string) => writeTree(root, { [file]: text });
const filesOf = (cwd: string, commit: string) => git(cwd, 'diff-tree', '--no-commit-id', '--name-status', '-r', commit).split('\n');

function task(fields: Partial<Task>): Task {
  return {
    id: 't1', title: 'Write the notes', brief: 'Notes for the launch.', owner: 'writer', askedBy: STAKEHOLDER, files: [], doneWhen: 'The notes are in.',
    status: 'working', outcome: null, parent: null, milestone: null, worktree: null, commit: null, createdAt: 0, updatedAt: 0, ...fields,
  };
}

/** What a call failed with; the test fails when it succeeds. */
async function rejection(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('It was expected to fail, and it succeeded.');
}

describe('prepareBranch', () => {
  it('switches a repository to a new work branch, keeping uncommitted changes as they are', async () => {
    const root = repository();
    const start = git(root, 'rev-parse', 'main');
    write(root, 'a.txt', 'a, changed\n');
    write(root, 'b.txt', 'b, staged\n');
    git(root, 'add', 'b.txt');
    write(root, 'new.txt', 'new\n');
    const before = git(root, 'status', '--porcelain');

    expect(await prepareBranch(root, 'acme')).toEqual({ branch: 'worklings/acme', problem: null });
    expect(branchOf(root)).toBe('worklings/acme');
    expect(git(root, 'rev-parse', 'worklings/acme')).toBe(start);
    expect(git(root, 'status', '--porcelain')).toBe(before);
    expect(read(root, 'a.txt')).toBe('a, changed\n');
    expect(git(root, 'rev-parse', 'main')).toBe(start);
  });

  it('switches back to the work branch when it exists, and does nothing when it is on it', async () => {
    const root = company();
    write(root, 'notes.md', 'notes\n');
    git(root, 'add', 'notes.md');
    git(root, 'commit', '--quiet', '-m', 'Notes');
    git(root, 'switch', '--quiet', 'main');

    expect(await prepareBranch(root, 'acme')).toEqual({ branch: 'worklings/acme', problem: null });
    expect(branchOf(root)).toBe('worklings/acme');
    expect(read(root, 'notes.md')).toBe('notes\n');
    expect(await prepareBranch(root, 'acme')).toEqual({ branch: 'worklings/acme', problem: null });
  });

  it('leaves the checkout as it was when switching would clash with uncommitted changes', async () => {
    const root = company();
    write(root, 'a.txt', 'a, on the work branch\n');
    git(root, 'commit', '--quiet', '-am', 'Change a');
    git(root, 'switch', '--quiet', 'main');
    write(root, 'a.txt', 'a, not committed\n');

    expect(await prepareBranch(root, 'acme')).toEqual({
      branch: null,
      problem: 'Switching to worklings/acme would clash with uncommitted changes to a.txt, so the checkout was left as it is. Commit or stash them, then open the company again.',
    });
    expect(branchOf(root)).toBe('main');
    expect(read(root, 'a.txt')).toBe('a, not committed\n');
  });

  it('starts the work branch on an unborn HEAD, keeping what is staged', async () => {
    const root = writeTree(tempDir(), { 'a.txt': 'a\n' });
    git(root, 'init', '--quiet');
    git(root, 'add', 'a.txt');

    expect(await prepareBranch(root, 'acme')).toEqual({ branch: 'worklings/acme', problem: null });
    expect(git(root, 'symbolic-ref', 'HEAD')).toBe('refs/heads/worklings/acme');
    expect(git(root, 'status', '--porcelain')).toBe('A  a.txt');
  });

  it.each([
    ['an empty folder', {}],
    ['a folder holding only what Worklings wrote', { '.worklings/.gitignore': '*\n', '.claude/studio.yaml': 'roles: []\n', 'CLAUDE.md': '# Studio\n' }],
  ])('makes %s a repository whose first commit ignores what tools install and build', async (_name, files) => {
    const root = writeTree(tempDir(), files);

    expect(await prepareBranch(root, 'acme')).toEqual({ branch: 'worklings/acme', problem: null });
    expect(branchOf(root)).toBe('worklings/acme');
    expect(git(root, 'log', '--format=%s')).toBe('Start the project');
    expect(git(root, 'ls-tree', '-r', '--name-only', 'HEAD')).toBe('.gitignore');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/^node_modules\/$/m);
    expect(git(root, 'check-ignore', 'node_modules/react/index.js', '.env')).toBe('node_modules/react/index.js\n.env');
    // The default branch holds the first commit too.
    expect(git(root, 'branch', '--format=%(refname:short)').split('\n')).toHaveLength(2);
  });

  it("leaves a folder with files that isn't a repository alone", async () => {
    const root = writeTree(tempDir(), { 'notes.txt': 'mine\n' });

    expect(await prepareBranch(root, 'acme')).toEqual({ branch: null, problem: `${root} isn't a git repository, so finished tasks won't be committed until it is one.` });
    expect(existsSync(join(root, '.git'))).toBe(false);
  });

  it('leaves a folder inside a repository alone', async () => {
    const root = repository();

    const result = await prepareBranch(join(root, 'site'), 'acme');
    expect(result.branch).toBeNull();
    expect(result.problem).toMatch(/site is a folder inside the git repository at .+, so finished tasks won't be committed\. Run the company in .+ instead\.$/);
    expect(branchOf(root)).toBe('main');
    expect(existsSync(join(root, 'site', '.git'))).toBe(false);
  });

  it('leaves a new folder as it was when git has no name and email for the first commit', async () => {
    noIdentity();
    const root = tempDir();

    const result = await prepareBranch(root, 'acme');
    expect(result.branch).toBeNull();
    expect(result.problem).toMatch(/^Git has no name and email for you, so .+ couldn't have its first commit and was left as it was\. Set them with git config --global user\.name/);
    expect(existsSync(join(root, '.git'))).toBe(false);
  });

  it("refuses ids git can't use in a branch name", async () => {
    const root = repository();
    for (const id of ['', 'a b', '../up', 'a/b', 'acme--t1', '-flag', 'x.lock', 'nul', 'CON.txt', 'a'.repeat(65)]) {
      await expect(prepareBranch(root, id)).rejects.toThrow(/can't name a company in a git branch/);
    }
    expect(branchOf(root)).toBe('main');
  });
});

describe('commitTask', () => {
  it("commits only the task's files, leaving out a file someone else staged", async () => {
    const root = company();
    write(root, 'other.txt', 'other, staged by someone else\n');
    git(root, 'add', 'other.txt');
    write(root, 'a.txt', 'a, by the task\n');
    write(root, 'src/new.ts', 'export const n = 1;\n');
    rmSync(join(root, 'gone.txt'));

    const { commit } = await commitTask(root, ['a.txt', 'src/', 'gone.txt', 'docs/never-written.md'], 'Write the notes');
    expect(commit).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(filesOf(root, 'HEAD')).toEqual(['M\ta.txt', 'D\tgone.txt', 'A\tsrc/new.ts']);
    expect(git(root, 'log', '-1', '--format=%s')).toBe('Write the notes');
    expect(git(root, 'status', '--porcelain')).toBe('M  other.txt');
    expect(branchOf(root)).toBe('worklings/acme');
  });

  it("gives null when none of the task's files changed", async () => {
    const root = company();
    write(root, 'b.txt', 'b, by someone else\n');
    const head = git(root, 'rev-parse', 'HEAD');

    expect(await commitTask(root, ['a.txt', 'docs/never-written.md'], 'Write the notes')).toEqual({ commit: null, strays: [] });
    expect(await commitTask(root, [], 'Write the notes')).toEqual({ commit: null, strays: [] });
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(root, 'status', '--porcelain')).toBe(' M b.txt');
  });

  it("takes the changes no open task owns along with the task's, and names them in the message", async () => {
    // As benchmark run 1 left it: the task wired the engine into the CLI and finished the scaffold's files on the way.
    const root = company();
    write(root, 'a.txt', 'a, by the task\n');
    write(root, 'b.txt', 'b, outside the task\n');
    write(root, 'tools/cli.ts', 'export const cli = 1;\n');
    write(root, 'other.txt', 'other, by an open task\n');
    write(root, 'site/index.html', '<p>Work in progress</p>\n');
    write(root, '.claude/agents/ceo.md', 'the office writes this\n');
    write(root, 'CLAUDE.md', 'the office writes this too\n');

    const done = await commitTask(root, ['a.txt'], 'Wire the engine', { except: ['other.txt', 'site/'] });
    expect(done.strays).toEqual(['b.txt', 'tools/cli.ts']);
    expect(filesOf(root, 'HEAD')).toEqual(['M\ta.txt', 'M\tb.txt', 'A\ttools/cli.ts']);
    expect(git(root, 'log', '-1', '--format=%B')).toBe("Wire the engine\n\nAlso committed, changed outside the task's files: b.txt, tools/cli.ts.");
    expect(git(root, 'status', '--porcelain', '--untracked-files=all').split('\n').sort()).toEqual(['?? .claude/agents/ceo.md', '?? CLAUDE.md', ' M other.txt', ' M site/index.html'].sort());
  });

  it("leaves installed packages out of the strays, in a checkout that doesn't ignore them", async () => {
    // As a company met it on 12 Nov 2026: someone ran npm install before the project had a .gitignore, and the commit
    // listed every package file on one git command line, which overflowed it (ENAMETOOLONG on Windows).
    const root = company();
    writeTree(root, Object.fromEntries(Array.from({ length: OVERFLOW_FILES }, (_, i) => [`node_modules/package-${i}/lib/index-${i}.js`, 'module.exports = 1;\n'])));
    write(root, 'a.txt', 'a, by the task\n');
    write(root, 'b.txt', 'b, outside the task\n');

    const done = await commitTask(root, ['a.txt'], 'Change a', { except: [] });
    expect(done.strays).toEqual(['b.txt']);
    expect(filesOf(root, 'HEAD')).toEqual(['M\ta.txt', 'M\tb.txt']);
  }, MANY_FILES_MS);

  it('commits more strays than one command line holds, and names the first few in the message', async () => {
    const root = company();
    writeTree(root, Object.fromEntries(Array.from({ length: OVERFLOW_FILES }, (_, i) => [`generated/pages/page-number-${String(i).padStart(4, '0')}.html`, `<p>${i}</p>\n`])));
    write(root, 'a.txt', 'a, by the task\n');

    const done = await commitTask(root, ['a.txt'], 'Generate the pages', { except: [] });
    expect(done.strays).toHaveLength(OVERFLOW_FILES);
    expect(filesOf(root, 'HEAD')).toHaveLength(OVERFLOW_FILES + 1);
    const body = git(root, 'log', '-1', '--format=%B');
    expect(body).toMatch(/^Generate the pages\n\nAlso committed, changed outside the task's files: generated\/pages\/page-number-0000\.html, .+ and 1,180 more\.$/);
    expect(git(root, 'status', '--porcelain')).toBe('');
  }, MANY_FILES_MS);

  it('leaves everything outside the task out unless asked, as before', async () => {
    const root = company();
    write(root, 'a.txt', 'a, by the task\n');
    write(root, 'b.txt', 'b, outside the task\n');
    expect((await commitTask(root, ['a.txt'], 'Change a')).strays).toEqual([]);
    expect(filesOf(root, 'HEAD')).toEqual(['M\ta.txt']);
    expect(git(root, 'status', '--porcelain')).toBe(' M b.txt');
  });

  it('takes file names as names, not as patterns', async () => {
    const root = company();
    write(root, 'app/[id].tsx', 'one, changed\n');
    write(root, 'app/i.tsx', 'two, changed\n');

    await commitTask(root, ['app/[id].tsx'], 'Change the page');
    expect(filesOf(root, 'HEAD')).toEqual(['M\tapp/[id].tsx']);
    expect(git(root, 'status', '--porcelain')).toBe(' M app/i.tsx');
  });

  it('takes turns with another commit in the same checkout', async () => {
    const root = company();
    write(root, 'a.txt', 'a, by one task\n');
    write(root, 'b.txt', 'b, by another\n');

    const [first, second] = await Promise.all([commitTask(root, ['a.txt'], 'Change a'), commitTask(root, ['b.txt'], 'Change b')]);
    expect(git(root, 'log', '-2', '--format=%s').split('\n')).toEqual(['Change b', 'Change a']);
    expect(filesOf(root, first.commit ?? 'missing')).toEqual(['M\ta.txt']);
    expect(filesOf(root, second.commit ?? 'missing')).toEqual(['M\tb.txt']);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it.each([
    ['../outside.txt', /leads out of the project folder/],
    ['notes/../../outside.txt', /leads out of the project folder/],
    ['/etc/passwd', /isn't inside the project/],
    ['C:\\Windows\\win.ini', /isn't inside the project/],
    ['C:notes.txt', /isn't inside the project/],
    ['\\\\server\\share\\notes.txt', /isn't inside the project/],
    ['.git/config', /is in git's own folder/],
    ['notes.txt\n', /isn't a file name a task can have/],
  ])('refuses %j as one of the files', async (file, message) => {
    const root = company();
    const head = git(root, 'rev-parse', 'HEAD');
    await expect(commitTask(root, ['a.txt', file], 'Write the notes')).rejects.toThrow(message);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('says git has no name and email, and stages nothing', async () => {
    const root = company();
    noIdentity();
    write(root, 'a.txt', 'a, by the task\n');

    await expect(commitTask(root, ['a.txt'], 'Write the notes')).rejects.toThrow(
      `Git has no name and email for you, so the task's files weren't committed. Set them with git config --global user.name "Your Name" and git config --global user.email "you@example.com".`,
    );
    expect(git(root, 'status', '--porcelain')).toBe(' M a.txt');
  });

  it("runs the project's git hooks, and says what a hook that stops the commit said", async () => {
    const root = company();
    hook(root, 'pre-commit', 'echo "The linter found 2 problems" >&2\nexit 1');
    write(root, 'a.txt', 'a, by the task\n');
    const head = git(root, 'rev-parse', 'HEAD');

    await expect(commitTask(root, ['a.txt'], 'Write the notes')).rejects.toThrow("Couldn't commit the task's files: The linter found 2 problems.");
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('keeps the process going while a hook runs', async () => {
    const root = company();
    hook(root, 'pre-commit', nodeLine('setTimeout(() => {}, 2000)'));
    write(root, 'a.txt', 'a, by the task\n');

    let ticks = 0;
    const ticking = setInterval(() => {
      ticks += 1;
    }, 50);
    try {
      const { commit } = await commitTask(root, ['a.txt'], 'Write the notes');
      expect(commit).toBe(git(root, 'rev-parse', 'HEAD'));
    } finally {
      clearInterval(ticking);
    }
    // The hook alone takes two seconds; a call that held the process up would have left no turn for the timer.
    expect(ticks).toBeGreaterThan(10);
  });

  it('stops a hook that hangs, and everything it started, when git runs out of time', async () => {
    const root = company();
    const pidFile = join(home, 'hook.pid');
    hook(root, 'pre-commit', nodeLine("require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", pidFile));
    write(root, 'a.txt', 'a, by the task\n');
    gitTimeouts.hooksMs = 15_000;

    const failure = rejection(commitTask(root, ['a.txt'], 'Write the notes'));
    await vi.waitFor(() => expect(pidIn(pidFile)).toBeGreaterThan(0), { timeout: 60_000, interval: 100 });
    const pid = pidIn(pidFile);
    expect(alive(pid)).toBe(true);

    expect((await failure).message).toBe(`git commit didn't finish within 15 seconds in ${root}, so Worklings stopped it.`);
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 10_000, interval: 100 });
    expect(git(root, 'log', '-1', '--format=%s')).toBe('Start');
  });

  it("refuses to commit on a branch that isn't the company's", async () => {
    const root = repository();
    write(root, 'a.txt', 'a, by the task\n');

    await expect(commitTask(root, ['a.txt'], 'Write the notes')).rejects.toThrow(/ is on main, not the company's branch, so the task's files weren't committed\.$/);
    expect(git(root, 'rev-list', '--count', 'main')).toBe('1');
  });

  it("says a folder that isn't a repository can't have commits", async () => {
    const root = writeTree(tempDir(), { 'a.txt': 'a\n' });
    await expect(commitTask(root, ['a.txt'], 'Write the notes')).rejects.toThrow(`${root} isn't a git repository, so Worklings can't commit the task's files.`);
  });
});

describe('worktrees', () => {
  it('makes a worktree outside the project, merges it into the work branch, then removes it and its branch', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    expect(worktree).toEqual({ path: join(home, '.worklings', 'worktrees', 'acme', 't1'), branch: 'worklings/acme--t1' });
    expect(branchOf(worktree.path)).toBe('worklings/acme--t1');

    write(worktree.path, 'notes.md', 'notes\n');
    const done = await commitTask(worktree.path, ['notes.md'], 'Write the notes');
    expect(done.commit).toBe(git(worktree.path, 'rev-parse', 'HEAD'));

    const merged = await mergeWorktree(root, worktree, 'Merge the notes');
    expect(merged.commit).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(git(root, 'log', '-1', '--format=%s %P').split(' ')).toEqual(['Merge', 'the', 'notes', expect.any(String), done.commit]);
    expect(read(root, 'notes.md')).toBe('notes\n');

    await removeWorktree(root, worktree);
    expect(existsSync(worktree.path)).toBe(false);
    expect(existsSync(join(home, '.worklings', 'worktrees', 'acme'))).toBe(false);
    expect(git(root, 'branch', '--list', 'worklings/acme--t1')).toBe('');
    expect(git(root, 'worktree', 'list', '--porcelain')).not.toContain('acme--t1');
  });

  it('gives back the same worktree when asked again, and makes it again when its folder was deleted', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    expect(await addWorktree(root, 'acme', 't1')).toEqual(worktree);

    rmSync(worktree.path, { recursive: true, force: true });
    expect(await addWorktree(root, 'acme', 't1')).toEqual(worktree);
    expect(read(worktree.path, 'a.txt')).toBe('a\n');
  });

  it('gives null for a merge that brings nothing new', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    const head = git(root, 'rev-parse', 'HEAD');

    expect(await mergeWorktree(root, worktree, 'Merge nothing')).toEqual({ commit: null });
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('undoes a merge that conflicts and names the files', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    write(worktree.path, 'a.txt', 'a, from the worktree\n');
    await commitTask(worktree.path, ['a.txt'], 'Change a in the worktree');
    write(root, 'a.txt', 'a, from the checkout\n');
    await commitTask(root, ['a.txt'], 'Change a in the checkout');
    const head = git(root, 'rev-parse', 'HEAD');

    const error = await rejection(mergeWorktree(root, worktree, 'Merge the change to a'));
    expect(error).toBeInstanceOf(OrgRefusal);
    expect(error).toMatchObject({
      code: 'conflict',
      message: "Merging worklings/acme--t1 into worklings/acme conflicts in a.txt, so the merge was undone. Bring the task's worktree up to date with worklings/acme and settle them there, then merge again.",
    });
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(read(root, 'a.txt')).toBe('a, from the checkout\n');
  });

  it('refuses to merge over uncommitted changes to the files the merge brings', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    write(worktree.path, 'a.txt', 'a, from the worktree\n');
    await commitTask(worktree.path, ['a.txt'], 'Change a');
    write(root, 'a.txt', 'a, someone is still on it\n');

    const error = await rejection(mergeWorktree(root, worktree, 'Merge the change to a'));
    expect(error).toBeInstanceOf(OrgRefusal);
    expect(error).toMatchObject({ code: 'conflict', message: "worklings/acme--t1 can't be merged while the checkout has uncommitted changes to a.txt. Commit them, then merge again." });
    expect(read(root, 'a.txt')).toBe('a, someone is still on it\n');
  });

  it("refuses to merge into a branch that isn't the company's", async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    write(worktree.path, 'notes.md', 'notes\n');
    await commitTask(worktree.path, ['notes.md'], 'Write the notes');
    git(root, 'switch', '--quiet', 'main');
    const main = git(root, 'rev-parse', 'main');

    await expect(mergeWorktree(root, worktree, 'Merge the notes')).rejects.toThrow(
      "The checkout is on main, not worklings/acme, so worklings/acme--t1 wasn't merged. Switch it back to worklings/acme first.",
    );
    expect(git(root, 'rev-parse', 'main')).toBe(main);
  });

  it("keeps a branch that isn't merged when its worktree goes, and checks it out again for the task", async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    write(worktree.path, 'notes.md', 'notes\n');
    await commitTask(worktree.path, ['notes.md'], 'Write the notes');

    await removeWorktree(root, worktree);
    expect(existsSync(worktree.path)).toBe(false);
    expect(git(root, 'branch', '--list', '--format=%(refname:short)', 'worklings/acme--t1')).toBe('worklings/acme--t1');

    const again = await addWorktree(root, 'acme', 't1');
    expect(read(again.path, 'notes.md')).toBe('notes\n');
  });

  it('keeps a worktree that has uncommitted changes', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    write(worktree.path, 'draft.md', 'draft\n');

    await expect(removeWorktree(root, worktree)).rejects.toThrow(
      'The worktree of worklings/acme--t1 has uncommitted changes to draft.md, so it was kept. Commit or drop them first.',
    );
    expect(read(worktree.path, 'draft.md')).toBe('draft\n');
  });

  it("refuses to remove anything outside Worklings' worktrees folder, or a branch it didn't make", async () => {
    const root = company();
    const elsewhere = writeTree(tempDir(), { 'keep.txt': 'keep\n' });
    const folder = join(home, '.worklings', 'worktrees');

    await expect(removeWorktree(root, { path: elsewhere, branch: 'worklings/acme--t1' })).rejects.toThrow(`${elsewhere} isn't in Worklings' worktrees folder`);
    await expect(removeWorktree(root, { path: folder, branch: 'worklings/acme--t1' })).rejects.toThrow(`${folder} isn't in Worklings' worktrees folder`);
    await expect(removeWorktree(root, { path: join(folder, 'acme', 't1'), branch: 'main' })).rejects.toThrow("main isn't a task branch Worklings makes, so it was left alone.");
    expect(read(elsewhere, 'keep.txt')).toBe('keep\n');
    expect(git(root, 'rev-list', '--count', 'main')).toBe('1');
  });

  it('refuses a worktree while the work branch has no commits', async () => {
    const root = writeTree(tempDir(), { 'a.txt': 'a\n' });
    git(root, 'init', '--quiet');
    await prepareBranch(root, 'acme');

    await expect(addWorktree(root, 'acme', 't1')).rejects.toThrow(/^worklings\/acme has no commits yet/);
    expect(existsSync(join(home, '.worklings', 'worktrees', 'acme', 't1'))).toBe(false);
  });
});

describe('taskDiff', () => {
  it("shows a finished task's commit with its message and stats", async () => {
    const root = company();
    write(root, 'a.txt', 'a\nand a second line\n');
    const { commit } = await commitTask(root, ['a.txt'], 'Add a line to a');

    const diff = await taskDiff(root, task({ files: ['a.txt'], status: 'done', commit }));
    expect(diff).toContain(`commit ${commit}\n\nAdd a line to a\n`);
    expect(diff).toMatch(/ a\.txt \| 1 \+\n 1 file changed, 1 insertion\(\+\)/);
    expect(diff).toContain('\n+and a second line\n');
  });

  it('shows what a merge brought into the work branch, not an empty merge', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    write(worktree.path, 'notes.md', 'notes\n');
    await commitTask(worktree.path, ['notes.md'], 'Write the notes');
    const { commit } = await mergeWorktree(root, worktree, 'Merge the notes');

    const diff = await taskDiff(root, task({ worktree, status: 'done', commit }));
    expect(diff).toMatch(/ notes\.md \| 1 \+/);
    expect(diff).toContain('\n+notes\n');
  });

  it("shows an open task's files against HEAD, new files included and the index untouched", async () => {
    const root = company();
    write(root, 'a.txt', 'a, by the task\n');
    write(root, 'src/new.ts', 'export const n = 1;\n');
    write(root, 'b.txt', 'b, by someone else\n');
    const status = git(root, 'status', '--porcelain', '--untracked-files=all');

    const diff = await taskDiff(root, task({ files: ['a.txt', 'src'] }));
    expect(diff).toContain('\n+a, by the task\n');
    expect(diff).toMatch(/ src\/new\.ts \| 1 \+/);
    expect(diff).toContain('\n+export const n = 1;\n');
    expect(diff).not.toContain('b.txt');
    expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe(status);
  });

  it('shows an open task on a work branch with no commits yet', async () => {
    const root = writeTree(tempDir(), { 'readme.md': 'hello\n' });
    git(root, 'init', '--quiet');
    await prepareBranch(root, 'acme');

    expect(await taskDiff(root, task({ files: ['readme.md'] }))).toContain('\n+hello\n');
  });

  it('shows a worktree task against where it left the work branch, committed or not', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't1');
    write(worktree.path, 'notes.md', 'notes\n');
    await commitTask(worktree.path, ['notes.md'], 'Write the notes');
    write(worktree.path, 'a.txt', 'a, not committed yet\n');
    write(worktree.path, 'draft.md', 'draft\n');
    write(root, 'b.txt', 'b, from another task\n');
    await commitTask(root, ['b.txt'], 'Change b');

    const diff = await taskDiff(root, task({ worktree }));
    expect(diff).toContain('\n+notes\n');
    expect(diff).toContain('\n+a, not committed yet\n');
    expect(diff).toContain('\n+draft\n');
    expect(diff).not.toContain('b.txt');
  });

  it('gives nothing for a task whose files are as they were', async () => {
    const root = company();
    expect(await taskDiff(root, task({ files: ['a.txt'] }))).toBe('');
    expect(await taskDiff(root, task({ files: [] }))).toBe('');
  });

  it('cuts a diff past 200 KB on a line, and says so', async () => {
    const root = company();
    write(root, 'big.txt', 'one line of a long file\n'.repeat(15_000));

    const diff = await taskDiff(root, task({ files: ['big.txt'] }));
    expect(Buffer.byteLength(diff)).toBeLessThanOrEqual(200 * 1024 + CUT.length + 1);
    expect(diff.endsWith(`one line of a long file\n${CUT}\n`)).toBe(true);
  });

  it('masks secrets', async () => {
    const root = company();
    const token = fake('ghp_', 36);
    write(root, 'a.txt', `GITHUB_TOKEN=${token}\n`);

    const diff = await taskDiff(root, task({ files: ['a.txt'] }));
    expect(diff).toContain('+GITHUB_TOKEN=[redacted]');
    expect(diff).not.toContain(token);
  });
});
