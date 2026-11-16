// Cancelling a task through the company with real git (src/company/git.ts) in a temp repository: the owner hears to
// stop, and once they have, the task's changed files are saved on a branch named after the task and go back to the
// work branch's version, which never moves. Git runs with no global or system settings and a test identity.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompany } from '../src/company/index.ts';
import { type DeskEvents, STAKEHOLDER } from '../src/core/company.ts';
import { FakeDesks, fakeOrg, KEY, proposal } from './company-kit.ts';
import { tempDir, writeTree } from './library-kit.ts';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const REPOSITORY_VARIABLES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR',
  'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];
const IDENTITY = { GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Lovelace', GIT_COMMITTER_EMAIL: 'ada@example.com' };

beforeEach(() => {
  for (const name of REPOSITORY_VARIABLES) vi.stubEnv(name, undefined);
  const home = tempDir('worklings-home-');
  writeFileSync(join(home, 'gitconfig'), '');
  vi.stubEnv('WORKLINGS_HOME', home);
  vi.stubEnv('HEADCOUNT_HOME', undefined);
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(home, 'gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(home));
  for (const [name, value] of Object.entries(IDENTITY)) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trimEnd();
const settled = () => new Promise<void>((done) => setImmediate(done));

describe('cancelling a task in the shared checkout', () => {
  it("saves its changed files on a branch named after the task and puts them back, leaving the work branch where it was", async () => {
    const root = writeTree(tempDir('worklings-cafe-'), { 'src/menu/items.json': '["espresso"]\n', 'src/app.ts': 'export const app = 1;\n' });
    git(root, 'init', '--quiet', '--initial-branch=main');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'Start');
    const boards: FakeDesks[] = [];
    const company = createCompany({
      key: KEY,
      org: fakeOrg(),
      desks: (events: DeskEvents, companyId: string) => {
        const board = new FakeDesks(events, companyId);
        boards.push(board);
        return board;
      },
      warn: () => {},
      root,
      prompt: 'A bilingual café website with pickup orders.',
      stakeholder: 'Robin',
    });
    try {
      const desks = () => boards.at(-1) as FakeDesks;
      const proposed = company.proposeOrg('ceo', proposal());
      if (!proposed.ok) throw new Error(proposed.errors.join('; '));
      company.start();
      await company.idle();
      const branch = company.view().branch;
      expect(branch).toBe(`worklings/${company.id}`);
      const head = git(root, 'rev-parse', 'HEAD');

      const task = company.createTask(STAKEHOLDER, { title: 'Menu data', brief: 'The whole menu as data.', files: ['src/menu'], owner: 'frontend-engineer', doneWhen: 'Every item is in.', milestone: null, cites: [] });
      desks().deliverAll();
      // Sam's work in the checkout: one file changed, one new.
      writeTree(root, { 'src/menu/items.json': '["espresso", "flat white"]\n', 'src/menu/prices.json': '{"espresso": 4.2}\n' });

      company.steerTask(STAKEHOLDER, { action: 'cancel', task: task.id, reason: 'The café sends its own menu.', cites: [] });
      await settled();
      await company.idle();
      // Nothing is saved before Sam has heard to stop.
      expect(company.view().tasks.find((t) => t.id === task.id)?.cancel?.branch).toBeNull();
      expect(readFileSync(join(root, 'src/menu/prices.json'), 'utf8')).toBe('{"espresso": 4.2}\n');

      desks().deliverAll();
      await settled();
      await company.idle();
      const saved = `worklings/${company.id}--${task.id}`;
      expect(company.view().tasks.find((t) => t.id === task.id)?.cancel?.branch).toBe(saved);
      expect(git(root, 'show', `${saved}:src/menu/items.json`)).toBe('["espresso", "flat white"]');
      expect(git(root, 'show', `${saved}:src/menu/prices.json`)).toBe('{"espresso": 4.2}');
      expect(git(root, 'rev-parse', `${saved}^`)).toBe(head);
      expect(git(root, 'symbolic-ref', '--short', 'HEAD')).toBe(branch);
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(readFileSync(join(root, 'src/menu/items.json'), 'utf8')).toBe('["espresso"]\n');
      expect(existsSync(join(root, 'src/menu/prices.json'))).toBe(false);
      expect(git(root, 'status', '--porcelain', '--', 'src')).toBe('');

      // Undo opens it again and names the branch its earlier work is on.
      const cancel = company.view().steering?.decisions.find((d) => d.kind === 'task' && d.links.task === task.id && d.reversible);
      company.undoDecision(STAKEHOLDER, cancel?.id ?? '');
      const reopened = desks().turns.at(-1);
      expect(reopened?.plan.person.id).toBe('frontend-engineer');
      expect(reopened?.turn.text).toContain(`Your earlier work on it is on the branch ${saved}`);
    } finally {
      await company.close();
    }
  });
});
