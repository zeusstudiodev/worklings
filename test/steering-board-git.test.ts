// Saving a cancelled task's work (src/company/git.ts: saveTaskWork, saveWorktree) against real repositories in temp
// folders. Git runs with no global or system settings of this machine and a test identity, as in company-git.test.ts.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addWorktree, removeWorktree, saveTaskWork, saveWorktree } from '../src/company/git.ts';
import { tempDir, writeTree } from './library-kit.ts';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * New files enough that listing them overflows one command line: Windows holds 32,767 characters, and 1,200 paths of
 * about 40 characters (50 with git's `:(literal)` prefix) make 60,000, without the minutes thousands of files cost.
 */
const OVERFLOW_FILES = 1200;
/** Writing, saving and restoring that many files takes most of a minute on a loaded machine. */
const MANY_FILES_MS = 240_000;

const REPOSITORY_VARIABLES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR',
  'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];
const IDENTITY = { GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Lovelace', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const FILES = { '.gitignore': '*.log\n', 'a.txt': 'a\n', 'b.txt': 'b\n', 'gone.txt': 'gone\n', 'other.txt': 'other\n', 'app/[id].tsx': 'one\n', 'app/i.tsx': 'two\n' };
const MESSAGE = 'Unfinished: Apple Pay\n\nSaved when Robin cancelled it: Not now.\n\nWorklings task t-4, by Sam.';

let template = '';

function isolate(): string {
  for (const name of REPOSITORY_VARIABLES) vi.stubEnv(name, undefined);
  const folder = tempDir('worklings-home-');
  const config = join(folder, 'gitconfig');
  writeFileSync(config, '');
  vi.stubEnv('WORKLINGS_HOME', folder);
  vi.stubEnv('HEADCOUNT_HOME', undefined);
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(folder));
  for (const [name, value] of Object.entries(IDENTITY)) vi.stubEnv(name, value);
  return folder;
}

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trimEnd();
const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8');
const write = (root: string, file: string, text: string) => writeTree(root, { [file]: text });

/** A copy of a repository on the company's work branch, worklings/acme, with one commit holding FILES. */
function company(): string {
  const root = tempDir('worklings-repo-');
  cpSync(template, root, { recursive: true });
  return root;
}

beforeAll(() => {
  isolate();
  template = writeTree(tempDir('worklings-template-'), FILES);
  git(template, 'init', '--quiet', '--initial-branch=main');
  git(template, 'add', '-A');
  git(template, 'commit', '--quiet', '-m', 'Start');
  git(template, 'switch', '--quiet', '--create', 'worklings/acme');
  vi.unstubAllEnvs();
});

beforeEach(() => {
  isolate();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('saving a cancelled task in the shared checkout', () => {
  it("commits the task's files on a branch of its own, leaving the work branch and everything else as it was", async () => {
    const root = company();
    const head = git(root, 'rev-parse', 'HEAD');
    write(root, 'app/i.tsx', 'two, changed\n');
    write(root, 'app/parts/new.tsx', 'new\n');
    write(root, 'app/debug.log', 'ignored\n');
    rmSync(join(root, 'gone.txt'));
    write(root, 'other.txt', 'other, changed\n');
    write(root, 'b.txt', 'b, staged\n');
    git(root, 'add', 'b.txt');

    const { branch } = await saveTaskWork(root, 'acme', 't-4', ['app', 'gone.txt'], MESSAGE);
    expect(branch).toBe('worklings/acme--t-4');

    // The work branch didn't move, and the branch starts from it.
    expect(git(root, 'symbolic-ref', '--short', 'HEAD')).toBe('worklings/acme');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(root, 'rev-parse', `${branch}^`)).toBe(head);
    expect(git(root, 'log', '-1', '--format=%B', branch ?? '').trim()).toBe(MESSAGE);
    // The branch holds the task's work and nothing else.
    expect(git(root, 'diff', '--name-status', '--no-renames', head, branch ?? '').split('\n').sort()).toEqual(['A\tapp/parts/new.tsx', 'D\tgone.txt', 'M\tapp/i.tsx']);
    expect(git(root, 'show', `${branch}:app/i.tsx`)).toBe('two, changed');

    // The task's files are back to the work branch's version; the rest is untouched.
    expect(read(root, 'app/i.tsx')).toBe('two\n');
    expect(read(root, 'gone.txt')).toBe('gone\n');
    expect(existsSync(join(root, 'app/parts'))).toBe(false);
    expect(read(root, 'app/debug.log')).toBe('ignored\n');
    expect(read(root, 'other.txt')).toBe('other, changed\n');
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('b.txt');
    expect(git(root, 'status', '--porcelain', '--', 'app', 'gone.txt')).toBe('');
  });

  it('saves a task whose folder holds more new files than one command line holds', async () => {
    const root = company();
    const head = git(root, 'rev-parse', 'HEAD');
    writeTree(root, Object.fromEntries(Array.from({ length: OVERFLOW_FILES }, (_, i) => [`app/generated/component-number-${String(i).padStart(4, '0')}.tsx`, `export const n = ${i};\n`])));
    write(root, 'app/i.tsx', 'two, changed\n');

    const { branch } = await saveTaskWork(root, 'acme', 't-4', ['app'], MESSAGE);
    expect(branch).toBe('worklings/acme--t-4');
    expect(git(root, 'diff', '--name-only', '--no-renames', head, branch ?? '').split('\n')).toHaveLength(OVERFLOW_FILES + 1);
    expect(existsSync(join(root, 'app/generated'))).toBe(false);
    expect(read(root, 'app/i.tsx')).toBe('two\n');
    expect(git(root, 'status', '--porcelain')).toBe('');
  }, MANY_FILES_MS);

  it('takes a file the task had staged, and takes it out of the index', async () => {
    const root = company();
    write(root, 'app/staged.tsx', 'staged\n');
    git(root, 'add', 'app/staged.tsx');
    const { branch } = await saveTaskWork(root, 'acme', 't-4', ['app'], MESSAGE);
    expect(git(root, 'show', `${branch}:app/staged.tsx`)).toBe('staged');
    expect(existsSync(join(root, 'app/staged.tsx'))).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('names a second save of the same task with a number, never moving the first', async () => {
    const root = company();
    write(root, 'app/i.tsx', 'first\n');
    const first = await saveTaskWork(root, 'acme', 't-4', ['app'], MESSAGE);
    const tip = git(root, 'rev-parse', first.branch ?? '');
    write(root, 'app/i.tsx', 'second\n');
    const second = await saveTaskWork(root, 'acme', 't-4', ['app'], MESSAGE);
    expect(second.branch).toBe('worklings/acme--t-4-2');
    expect(git(root, 'rev-parse', first.branch ?? '')).toBe(tip);
    expect(git(root, 'show', 'worklings/acme--t-4-2:app/i.tsx')).toBe('second');
  });

  it('makes no branch when none of the files changed', async () => {
    const root = company();
    write(root, 'other.txt', 'other, changed\n');
    expect(await saveTaskWork(root, 'acme', 't-4', ['app'], MESSAGE)).toEqual({ branch: null });
    expect(await saveTaskWork(root, 'acme', 't-4', [], MESSAGE)).toEqual({ branch: null });
    expect(git(root, 'branch', '--list', 'worklings/acme--*')).toBe('');
    expect(read(root, 'other.txt')).toBe('other, changed\n');
  });

  it("refuses when the checkout isn't on the work branch, and leaves the files as they are", async () => {
    const root = company();
    git(root, 'switch', '--quiet', 'main');
    write(root, 'app/i.tsx', 'changed\n');
    await expect(saveTaskWork(root, 'acme', 't-4', ['app'], MESSAGE)).rejects.toThrow(
      "The checkout is on main, not worklings/acme, so the task's work wasn't saved and its files were left as they are.",
    );
    expect(read(root, 'app/i.tsx')).toBe('changed\n');
    expect(git(root, 'branch', '--list', 'worklings/acme--*')).toBe('');
  });

  it('refuses a path outside the project before touching anything', async () => {
    const root = company();
    await expect(saveTaskWork(root, 'acme', 't-4', ['../elsewhere'], MESSAGE)).rejects.toThrow('leads out of the project folder');
  });

  it('saves on a work branch with no commits yet, as a first commit of its own', async () => {
    const root = tempDir('worklings-unborn-');
    git(root, 'init', '--quiet', '--initial-branch=worklings/acme');
    write(root, 'app/new.tsx', 'new\n');
    const { branch } = await saveTaskWork(root, 'acme', 't-1', ['app'], MESSAGE);
    expect(branch).toBe('worklings/acme--t-1');
    expect(git(root, 'show', `${branch}:app/new.tsx`)).toBe('new');
    expect(existsSync(join(root, 'app'))).toBe(false);
  });
});

describe("saving a cancelled task's worktree", () => {
  it('commits what is uncommitted there on its own branch, so the worktree can go and the work stays', async () => {
    const root = company();
    const head = git(root, 'rev-parse', 'HEAD');
    const worktree = await addWorktree(root, 'acme', 't-5');
    write(worktree.path, 'app/i.tsx', 'worktree change\n');
    write(worktree.path, 'app/extra.tsx', 'extra\n');
    expect(await saveWorktree(root, worktree, MESSAGE)).toEqual({ branch: 'worklings/acme--t-5' });
    expect(git(worktree.path, 'status', '--porcelain')).toBe('');
    expect(git(root, 'show', 'worklings/acme--t-5:app/extra.tsx')).toBe('extra');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    await removeWorktree(root, worktree);
    expect(existsSync(worktree.path)).toBe(false);
    expect(git(root, 'branch', '--list', 'worklings/acme--t-5')).toContain('worklings/acme--t-5');
  });

  it('gives no branch for a worktree where nothing was done', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't-6');
    expect(await saveWorktree(root, worktree, MESSAGE)).toEqual({ branch: null });
  });

  it("keeps a branch that has the work's commits, even with nothing uncommitted", async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't-7');
    write(worktree.path, 'a.txt', 'committed\n');
    git(worktree.path, 'commit', '--quiet', '-am', 'Some work');
    expect(await saveWorktree(root, worktree, MESSAGE)).toEqual({ branch: 'worklings/acme--t-7' });
  });

  it('keeps what the branch holds when the worktree folder is gone', async () => {
    const root = company();
    const worktree = await addWorktree(root, 'acme', 't-8');
    write(worktree.path, 'a.txt', 'committed\n');
    git(worktree.path, 'commit', '--quiet', '-am', 'Some work');
    rmSync(worktree.path, { recursive: true, force: true });
    expect(await saveWorktree(root, worktree, MESSAGE)).toEqual({ branch: 'worklings/acme--t-8' });
  });
});
