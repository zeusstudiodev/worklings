import { TERMS } from './public-blocklist-kit.ts';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { globToRegExp, officeHoursRefusal } from '../scripts/release-squash.ts';
import { tempDir, writeTree } from './library-kit.ts';

// Each case starts Node and several git processes, and some loop over several repositories: slow when the machine is busy.
vi.setConfig({ testTimeout: 180_000 });

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'release-squash.ts');
const NOREPLY = '12345+someone@users.noreply.github.com';
const STUDIO = 'Zeus Studio <support@zeusstudio.dev>';
// Local date-times: the gate reads the machine's own time zone, and so does the tests' clock.
const WEDNESDAY_NOON = '2026-11-11T12:00:00';
const WEDNESDAY_EVENING = '2026-11-11T19:00:00';
const SATURDAY_MORNING = '2026-11-14T10:00:00';
// A made-up private path, from the test blocklist (test/public-blocklist-kit.ts).
const LOCAL_PATH: string = TERMS.localPath;

const manifest = {
  include: ['src/**', 'README.md', 'LICENSE', 'package.json', 'plugin/**', '.claude/rules/**'],
  exclude: ['.claude/runs/**', '**/*.log'],
  require: ['package.json', 'plugin/runtime/runtime.json'],
  dirtyAllowed: ['plugin/'],
};

const cleanEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
};

const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: cleanEnv() }).trim();

type Setup = { repo: string; manifestFile: string };

function makeRepo(extra: Record<string, string> = {}, email = NOREPLY): Setup {
  const repo = tempDir('worklings-squash-');
  writeTree(repo, {
    'package.json': { name: 'demo', version: '1.2.3' },
    'README.md': 'Hello\n',
    LICENSE: 'MIT\n',
    'src/a.ts': 'export const a = 1;\n',
    'src/deep/b.ts': 'export const b = 2;\n',
    '.claude/rules/r.md': 'rule\n',
    '.claude/runs/log.md': 'progress\n',
    '.claude/settings.local.json': '{}',
    'dist/x.js': 'x',
    'debug.log': 'log',
    'plugin/runtime/runtime.json': { version: '1.2.3' },
    ...extra,
  });
  git(repo, 'init', '-q', '-b', 'run/v3');
  git(repo, 'config', 'user.name', 'Some One');
  git(repo, 'config', 'user.email', email);
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '--all', '--force');
  git(repo, 'commit', '-q', '-m', 'work in progress\n\nCo-Authored-By: Somebody <s@example.com>');
  const manifestFile = join(tempDir('worklings-squash-manifest-'), 'manifest.json');
  writeTree(join(manifestFile, '..'), { 'manifest.json': manifest });
  return { repo, manifestFile };
}

function squash(s: Setup, args: string[], opts: { now?: string; stdin?: string; env?: Record<string, string> } = {}) {
  const env: NodeJS.ProcessEnv = { ...cleanEnv(), ...opts.env };
  if (opts.now) env.WORKLINGS_RELEASE_NOW = opts.now;
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo', s.repo, '--manifest', s.manifestFile], { encoding: 'utf8', input: opts.stdin ?? '', env, timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const refs = (repo: string) => git(repo, 'for-each-ref');
const hasBranch = (repo: string, name = 'release') => refs(repo).includes(`refs/heads/${name}`);
const indexHash = (repo: string) => createHash('sha256').update(readFileSync(join(repo, '.git', 'index'))).digest('hex');

describe('release squash: the commit', () => {
  it('is parentless, holds exactly the manifest files, has no trailer and leaves the checkout alone', () => {
    const s = makeRepo();
    const before = { refs: refs(s.repo), index: indexHash(s.repo), head: git(s.repo, 'rev-parse', 'HEAD'), branch: git(s.repo, 'branch', '--show-current') };
    const r = squash(s, [], { now: WEDNESDAY_EVENING, stdin: 'y\n' });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);

    expect(git(s.repo, 'rev-list', '--parents', '-n', '1', 'release').split(' ')).toHaveLength(1); // no parent
    expect(git(s.repo, 'rev-list', '--count', 'release')).toBe('1');
    expect(git(s.repo, 'ls-tree', '-r', '--name-only', 'release').split('\n')).toEqual([
      '.claude/rules/r.md',
      'LICENSE',
      'README.md',
      'package.json',
      'plugin/runtime/runtime.json',
      'src/a.ts',
      'src/deep/b.ts',
    ]);
    const raw = git(s.repo, 'cat-file', '-p', 'release');
    expect(raw).toContain('Worklings 1.2.3');
    expect(raw).not.toMatch(/^parent /m);
    expect(raw).not.toMatch(/Co-Authored-By|Signed-off-by|Generated with|Claude/i);
    expect(git(s.repo, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', 'release')).toBe(`${STUDIO}|${STUDIO}`);

    expect(git(s.repo, 'rev-parse', 'HEAD')).toBe(before.head);
    expect(git(s.repo, 'branch', '--show-current')).toBe(before.branch);
    expect(indexHash(s.repo)).toBe(before.index);
    expect(refs(s.repo).replace(/^.*refs\/heads\/release\n?/m, '')).toBe(before.refs);
    expect(git(s.repo, 'status', '--porcelain')).toBe('');
  });

  it('never uses a date variable: a forged one in the environment is ignored', () => {
    const s = makeRepo();
    const forged = '2001-01-01T00:00:00 +0000';
    const r = squash(s, [], { now: WEDNESDAY_EVENING, stdin: 'y\n', env: { GIT_AUTHOR_DATE: forged, GIT_COMMITTER_DATE: forged } });
    expect(r.code).toBe(0);
    const [author, committer] = git(s.repo, 'log', '-1', '--format=%at %ct', 'release').split(' ').map(Number) as [number, number];
    const nowSeconds = Date.now() / 1000;
    expect(Math.abs(nowSeconds - author)).toBeLessThan(120);
    expect(Math.abs(nowSeconds - committer)).toBeLessThan(120);
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).not.toMatch(/--date|--reset-author|--amend/);
    // The only mention is the pattern that drops them from the environment.
    expect(source).toContain('GIT_(AUTHOR|COMMITTER)_DATE$/.test(key)');
  });
});

describe('release squash: office hours', () => {
  it('refuses Monday to Friday from 08:00 to 18:00 and says when it can run', () => {
    for (const now of ['2026-11-11T12:00:00', '2026-11-11T08:00:00', '2026-11-09T17:59:00', '2026-11-13T09:30:00']) {
      const s = makeRepo();
      const r = squash(s, [], { now, stdin: 'y\n' });
      expect(r.code, now).toBe(1);
      expect(r.err, now).toContain('inside office hours');
      expect(r.err, now).toContain('from 18:00 today');
      expect(r.err, now).toContain('--allow-office-hours');
      expect(hasBranch(s.repo), now).toBe(false);
    }
  });

  it('accepts evenings, early mornings and weekends', () => {
    for (const now of [WEDNESDAY_EVENING, '2026-11-11T18:00:00', '2026-11-11T07:59:00', SATURDAY_MORNING, '2026-11-15T12:00:00']) {
      const s = makeRepo();
      const r = squash(s, [], { now, stdin: 'y\n' });
      expect(r.code, `${now}: ${r.err}`).toBe(0);
      expect(hasBranch(s.repo), now).toBe(true);
    }
  });

  it('can be overridden with --allow-office-hours', () => {
    const s = makeRepo();
    const r = squash(s, ['--allow-office-hours'], { now: WEDNESDAY_NOON, stdin: 'y\n' });
    expect(r.code, r.err).toBe(0);
    expect(hasBranch(s.repo)).toBe(true);
  });

  it('is a pure function of the date', () => {
    expect(officeHoursRefusal(new Date(2026, 10, 11, 12, 0))).toMatch(/Wednesday 12:00/);
    expect(officeHoursRefusal(new Date(2026, 10, 14, 12, 0))).toBeNull();
  });
});

describe('release squash: identity', () => {
  it('prints the identity and makes nothing when the answer is no, or empty', () => {
    for (const stdin of ['n\n', '\n', '']) {
      const s = makeRepo();
      const r = squash(s, [], { now: SATURDAY_MORNING, stdin });
      expect(r.code, JSON.stringify(stdin)).toBe(1);
      expect(r.out).toContain(STUDIO);
      expect(r.err).toContain('Declined');
      expect(hasBranch(s.repo)).toBe(false);
    }
  });

  it('uses --author when given, and accepts a yes', () => {
    const s = makeRepo();
    const r = squash(s, ['--author', 'Other Name <9+other@users.noreply.github.com>'], { now: SATURDAY_MORNING, stdin: 'yes\n' });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Other Name <9+other@users.noreply.github.com>');
    expect(git(s.repo, 'log', '-1', '--format=%an|%ae|%cn|%ce', 'release')).toBe('Other Name|9+other@users.noreply.github.com|Other Name|9+other@users.noreply.github.com');
  });

  it('runs without questions with --name, --email and --yes, and prints the identity it used', () => {
    const s = makeRepo();
    const r = squash(s, ['--name', 'Night Run', '--email', '7+night@users.noreply.github.com', '--yes'], { now: SATURDAY_MORNING, stdin: '' });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('--yes: making the commit as Night Run <7+night@users.noreply.github.com>, without asking.');
    expect(git(s.repo, 'log', '-1', '--format=%an|%ae|%cn|%ce', 'release')).toBe('Night Run|7+night@users.noreply.github.com|Night Run|7+night@users.noreply.github.com');
  });

  it('never publishes a personal email with --yes, and wants --name and --email together', () => {
    const s = makeRepo();
    const personal = squash(s, ['--name', 'Night Run', '--email', 'someone@example.com', '--yes'], { now: SATURDAY_MORNING, stdin: '' });
    expect(personal.code).toBe(1);
    expect(personal.err).toContain("--yes needs Zeus Studio's email or a GitHub noreply email");
    const half = squash(s, ['--name', 'Night Run', '--yes'], { now: SATURDAY_MORNING, stdin: '' });
    expect(half.code).toBe(1);
    expect(half.err).toContain('--name and --email go together');
    expect(hasBranch(s.repo)).toBe(false);
  });

  it('refuses a malformed --author', () => {
    const s = makeRepo();
    const r = squash(s, ['--author', 'no-brackets'], { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('--author must look like');
    expect(hasBranch(s.repo)).toBe(false);
  });

  it("refuses an email that is neither the studio's nor noreply unless it is typed back exactly", () => {
    const other = 'someone@example.com';
    const author = ['--author', `Some One <${other}>`];
    const refused = makeRepo();
    const a = squash(refused, author, { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(a.code).toBe(1);
    expect(a.out).toContain("neither Zeus Studio's address nor a GitHub noreply one");
    expect(a.out).toContain(`the commit is made as ${STUDIO}`);
    expect(hasBranch(refused.repo)).toBe(false);

    const accepted = makeRepo();
    const b = squash(accepted, author, { now: SATURDAY_MORNING, stdin: `${other}\ny\n` });
    expect(b.code, b.err).toBe(0);
    expect(git(accepted.repo, 'log', '-1', '--format=%ae', 'release')).toBe(other);

    const typedWrong = makeRepo();
    expect(squash(typedWrong, author, { now: SATURDAY_MORNING, stdin: 'other@example.com\ny\n' }).code).toBe(1);
    expect(hasBranch(typedWrong.repo)).toBe(false);
  });

  it('commits as Zeus Studio by default, whatever git config says, and with --yes asks nothing', () => {
    const s = makeRepo({}, 'someone@example.com');
    const r = squash(s, ['--yes'], { now: SATURDAY_MORNING, stdin: '' });
    expect(r.code, r.err).toBe(0);
    expect(git(s.repo, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', 'release')).toBe(`${STUDIO}|${STUDIO}`);
  });

  it('refuses to run without the private blocklist, making nothing', () => {
    const s = makeRepo();
    const r = squash(s, ['--yes'], { now: SATURDAY_MORNING, stdin: '', env: { WORKLINGS_PUBLIC_BLOCKLIST: join(s.repo, 'no-such-blocklist.json') } });
    expect(r.code).toBe(1);
    expect(r.err).toContain('refuses to run without it');
    expect(hasBranch(s.repo)).toBe(false);
  });

  it("refuses the maintainer's own identity, even typed back", () => {
    for (const email of [TERMS.email, `1+${TERMS.handle}@users.noreply.github.com`]) {
      const s = makeRepo();
      const r = squash(s, ['--author', `Some One <${email}>`], { now: SATURDAY_MORNING, stdin: `${email}\ny\n` });
      expect(r.code, email).toBe(1);
      expect(r.err).toContain("is the maintainer's own identity");
      expect(hasBranch(s.repo)).toBe(false);
    }
  });
});

describe('release squash: refusals', () => {
  it('refuses when the privacy scan hits, naming the file and line', () => {
    const s = makeRepo({ 'src/leak.ts': `// fine\nconst p = '${LOCAL_PATH.replace(/\\/g, '/')}';\n`.replace('C:/Users', '/Users') });
    const r = squash(s, [], { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('privacy scan');
    expect(r.err).toContain('src/leak.ts:2');
    expect(hasBranch(s.repo)).toBe(false);
  });

  it('scans the tree it commits, not the files it leaves out', () => {
    const s = makeRepo({ '.claude/runs/log.md': `${LOCAL_PATH}\n` });
    const r = squash(s, [], { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(r.code, r.err).toBe(0);
  });

  it('refuses uncommitted changes outside plugin/, an existing branch and a missing runtime', () => {
    const dirty = makeRepo();
    writeTree(dirty.repo, { 'src/a.ts': 'export const a = 99;\n' });
    const d = squash(dirty, [], { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(d.code).toBe(1);
    expect(d.err).toContain('src/a.ts');

    const taken = makeRepo();
    git(taken.repo, 'branch', 'release');
    const t = squash(taken, [], { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(t.code).toBe(1);
    expect(t.err).toContain('release exists already');

    const bare = makeRepo();
    git(bare.repo, 'rm', '-q', '--cached', 'plugin/runtime/runtime.json');
    git(bare.repo, 'commit', '-q', '-m', 'drop runtime');
    const b = squash(bare, [], { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(b.code).toBe(1);
    expect(b.err).toContain('release-plugin.ts --stage');
  });

  it('allows the plugin runtime to be staged but uncommitted, as release-plugin --stage leaves it', () => {
    const s = makeRepo();
    git(s.repo, 'rm', '-q', '--cached', 'plugin/runtime/runtime.json');
    git(s.repo, 'commit', '-q', '-m', 'drop runtime');
    git(s.repo, 'add', '--force', 'plugin/runtime/runtime.json');
    const r = squash(s, [], { now: SATURDAY_MORNING, stdin: 'y\n' });
    expect(r.code, r.err).toBe(0);
    expect(git(s.repo, 'ls-tree', '-r', '--name-only', 'release')).toContain('plugin/runtime/runtime.json');
  });
});

describe('release squash: --dry-run', () => {
  it('reports files, size, identity, clock and scan, and changes nothing', () => {
    const s = makeRepo();
    const before = { refs: refs(s.repo), index: indexHash(s.repo), status: git(s.repo, 'status', '--porcelain', '--ignored'), branches: git(s.repo, 'branch', '--list') };
    const r = squash(s, ['--dry-run'], { now: WEDNESDAY_NOON, stdin: '' });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Release commit: 7 files');
    expect(r.out).toContain('src/deep/b.ts');
    expect(r.out).not.toContain('  .claude/runs/log.md');
    expect(r.out).toMatch(/Left out: 4 files/);
    expect(r.out).toContain(`Identity: ${STUDIO} (Zeus Studio's own)`);
    expect(r.out).toContain('Not allowed now');
    expect(r.out).toContain('from 18:00 today');
    expect(r.out).toContain('Privacy scan: clean');
    expect(r.out).toContain('Dry run: nothing was created');

    expect(refs(s.repo)).toBe(before.refs);
    expect(indexHash(s.repo)).toBe(before.index);
    expect(git(s.repo, 'status', '--porcelain', '--ignored')).toBe(before.status);
    expect(git(s.repo, 'branch', '--list')).toBe(before.branches);
  });

  it('shows a privacy hit and a clock that allows the commit', () => {
    const s = makeRepo({ 'src/leak.ts': '// /Users/zelda/x\n' });
    const r = squash(s, ['--dry-run'], { now: SATURDAY_MORNING });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Allowed now');
    expect(r.out).toContain('src/leak.ts:1');
    expect(r.out).toContain('would be refused');
    expect(hasBranch(s.repo)).toBe(false);
  });
});

describe('release manifest patterns', () => {
  it('matches * inside a folder, ** across folders and a trailing slash below it', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('**/*.log').test('debug.log')).toBe(true);
    expect(globToRegExp('**/*.log').test('a/b/debug.log')).toBe(true);
    expect(globToRegExp('docs/').test('docs/x.md')).toBe(true);
    expect(globToRegExp('README.md').test('docs/README.md')).toBe(false);
    expect(globToRegExp('.claude/**/*.local.*').test('.claude/a/b.local.json')).toBe(true);
  });
});
