// Builds the one commit that goes public. The full history (run/v1 to run/v3) stays local; what is pushed to the public
// repository (scripts/home.json) as `main` is a parentless commit holding exactly the files scripts/release-manifest.json
// lists. It is made as Zeus Studio (home.json's maker and email), and a personal identity is always refused.
//
//   node scripts/release-squash.ts [--dry-run] [--author "Name <email>" | --name "Name" --email <email>] [--yes]
//                                  [--allow-office-hours] [--branch release] [--message "Worklings 0.1.0"]
//
//   --dry-run              show the files and size, the identity, whether the clock allows it and the privacy scan,
//                          and do nothing else: no commit, no ref, nothing staged
//   --author               the identity of the commit, author and committer alike; default is Zeus Studio's, from
//                          scripts/home.json (never `git config`). Any other must not be the maintainer's own name, handle
//                          or personal email (check-public's personalIdentity), and should be a GitHub noreply address
//   --name, --email        the same identity as --author, in two parts
//   --yes                  no questions: the commit is made with what it prints. Only with Zeus Studio's email or a
//                          GitHub noreply email; any other email still has to be typed back, without --yes
//   --allow-office-hours   make the commit although it is Monday to Friday, 08:00 to 18:00 in this machine's time zone
//   --branch               the local branch that gets the commit (default `release`); it must not exist yet
//   --message              the commit message (default "Worklings <version>"); never gets trailers
//   --manifest, --repo     another manifest file or repository folder (the tests use them)
//
// The source is the index, not the working tree: run `node scripts/release-plugin.ts --stage` first, which puts the built
// plugin/runtime/ (ignored on working branches) into the index. Everything else must equal HEAD. The script builds the
// tree in a temporary index (read-index, filter, write-tree), scans that tree with scripts/check-public.mjs, asks for
// confirmation and only then writes the commit with `git commit-tree` and the branch ref. The working tree, the real
// index and the current branch are never touched. It never sets a date: the commit is stamped when it runs.
//
// Test-only: WORKLINGS_RELEASE_NOW (a local date-time such as 2026-11-14T10:00:00) replaces the clock for the office-hours
// check and for nothing else.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { blocklist, type Entry, globToRegExp, personalIdentity, type Scan, scanBlobs, treeEntries } from './check-public.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPTIONS = ['--dry-run', '--allow-office-hours', '--yes'];
const VALUED = ['--author', '--name', '--email', '--branch', '--message', '--manifest', '--repo'];
// Office hours: Monday to Friday from 08:00 up to, not including, 18:00.
const OFFICE_START = 8;
const OFFICE_END = 18;
const NOREPLY = /^(\d+\+)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?@users\.noreply\.github\.com$/i;

class SquashError extends Error {}

/** Who publishes Worklings (scripts/home.json): the release's default identity, public by design. */
const HOME = JSON.parse(readFileSync(join(HERE, 'home.json'), 'utf8')) as { maker: string; email: string };
const STUDIO = { name: HOME.maker, email: HOME.email };
/** An address that may be public in every clone: Zeus Studio's own, or a GitHub noreply one. */
const publicEmail = (email: string) => NOREPLY.test(email) || email.toLowerCase() === STUDIO.email.toLowerCase();

type Manifest = { include: string[]; exclude: string[]; require: string[]; dirtyAllowed: string[] };

/** Every date variable git would honour: dropped from the environment, so the commit is stamped when it is made. */
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (/^GIT_(AUTHOR|COMMITTER)_DATE$/.test(key) || key === 'GIT_INDEX_FILE') delete env[key];
  return env;
}

function runGit(repo: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}): string {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', input: opts.input, env: gitEnv(opts.env), maxBuffer: 1 << 29, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new SquashError(`git ${args[0]} failed${stderr ? `: ${stderr}` : '.'}`);
  }
}

// ---- manifest ------------------------------------------------------------------------------------------------------

export { globToRegExp };

function readManifest(file: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new SquashError(`The manifest ${file} can't be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const m = raw as Partial<Record<keyof Manifest, unknown>>;
  const list = (key: keyof Manifest): string[] => {
    const v = m[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new SquashError(`The manifest needs "${key}" as a list of strings.`);
    return v as string[];
  };
  return { include: list('include'), exclude: list('exclude'), require: list('require'), dirtyAllowed: list('dirtyAllowed') };
}

// ---- the clock -----------------------------------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

function now(): Date {
  const fake = process.env.WORKLINGS_RELEASE_NOW;
  if (fake === undefined || fake === '') return new Date();
  const d = new Date(fake);
  if (Number.isNaN(d.getTime())) throw new SquashError(`WORKLINGS_RELEASE_NOW (test-only) is not a date: ${fake}`);
  return d;
}

/** null when the commit may be made now, else when it can be: the office closes at 18:00 the same day. */
export function officeHoursRefusal(at: Date): string | null {
  const day = at.getDay();
  if (day === 0 || day === 6 || at.getHours() < OFFICE_START || at.getHours() >= OFFICE_END) return null;
  return `It is ${DAYS[day]} ${pad(at.getHours())}:${pad(at.getMinutes())}, inside office hours (Monday to Friday, ${pad(OFFICE_START)}:00 to ${OFFICE_END}:00, this machine's time zone). The release commit is made outside them: run this again from ${OFFICE_END}:00 today, or at any time on a weekend. To make it now anyway, pass --allow-office-hours.`;
}

// ---- identity ------------------------------------------------------------------------------------------------------

type Identity = { name: string; email: string };

function identity(author: string | undefined, named?: { name?: string; email?: string }): Identity | string {
  let who: Identity;
  if (named?.name !== undefined || named?.email !== undefined) {
    if (author !== undefined) return 'Pass either --author or --name and --email, not both.';
    const name = named.name?.trim() ?? '';
    const email = named.email?.trim() ?? '';
    if (!name || !email) return '--name and --email go together: pass both.';
    if (!/^[^<>\s]+@[^<>\s]+$/.test(email)) return `--email must be an email address, not "${email}".`;
    who = { name, email };
  } else if (author !== undefined) {
    const m = /^(.+?)\s*<([^<>\s]+)>$/.exec(author.trim());
    if (!m) return `--author must look like "Name <email>", not "${author}".`;
    who = { name: (m[1] as string).trim(), email: m[2] as string };
  } else return STUDIO;
  if (personalIdentity(`${who.name} <${who.email}>`)) {
    return `${who.name} <${who.email}> is the maintainer's own identity, and Worklings is published as ${STUDIO.name}: leave out --author to use ${STUDIO.name} <${STUDIO.email}>.`;
  }
  return who;
}

// ---- reading the index ---------------------------------------------------------------------------------------------

type Staged = { mode: string; hash: string; path: string; size: number };

function indexFiles(repo: string): Staged[] {
  const rows = runGit(repo, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean);
  const files: Staged[] = [];
  for (const row of rows) {
    const m = /^(\d+) ([0-9a-f]+) (\d)\t(.*)$/s.exec(row);
    if (!m || m[3] !== '0') throw new SquashError('The index has unresolved merge entries. Resolve or abort the merge first.');
    if (m[1] === '160000') continue; // a submodule has no files of its own to publish
    files.push({ mode: m[1] as string, hash: m[2] as string, path: m[4] as string, size: 0 });
  }
  const sizes = runGit(repo, ['cat-file', '--batch-check=%(objectsize)'], { input: files.map((f) => `${f.hash}\n`).join('') }).split('\n');
  files.forEach((f, i) => (f.size = Number(sizes[i])));
  return files;
}

/** Tracked paths that differ from HEAD (staged or not), other than the ones a release stages on purpose. */
function dirtyPaths(repo: string, allowed: string[]): string[] {
  const changed = runGit(repo, ['diff-index', '--name-only', '-z', 'HEAD', '--']).split('\0').filter(Boolean);
  return changed.filter((p) => !allowed.some((prefix) => p.startsWith(prefix)));
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`);
const top = (path: string) => (path.includes('/') ? `${path.split('/')[0]}/` : path);

// ---- confirmation through stdin ------------------------------------------------------------------------------------

function asker(): { ask(question: string): Promise<string>; close(): void } {
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question) {
      process.stdout.write(question);
      const next = await lines.next();
      process.stdout.write('\n');
      return next.done ? '' : next.value.trim();
    },
    close: () => rl.close(),
  };
}

// ---- the run -------------------------------------------------------------------------------------------------------

type Args = { flags: Set<string>; values: Map<string, string> };

function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (OPTIONS.includes(a)) flags.add(a);
    else if (VALUED.includes(a)) {
      const v = argv[++i];
      if (v === undefined) throw new SquashError(`${a} needs a value.`);
      values.set(a, v);
    } else throw new SquashError(`Unknown option ${a}. Options: ${[...OPTIONS, ...VALUED.map((v) => `${v} <value>`)].join(', ')}.`);
  }
  return { flags, values };
}

async function run(argv: string[]): Promise<void> {
  const { flags, values } = parseArgs(argv);
  const dry = flags.has('--dry-run');
  const out = (line = '') => process.stdout.write(`${line}\n`);
  // Fails closed: without the private blocklist the privacy scan can't run, so nothing is made.
  blocklist();
  const repo = runGit(values.get('--repo') ?? process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const manifest = readManifest(values.get('--manifest') ?? join(HERE, 'release-manifest.json'));
  const branch = values.get('--branch') ?? 'release';
  const problems: string[] = [];

  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new SquashError(`"${branch}" is not a usable branch name.`);
  const branchRef = `refs/heads/${branch}`;
  let exists = true;
  try {
    runGit(repo, ['show-ref', '--verify', '--quiet', branchRef]);
  } catch {
    exists = false;
  }
  if (exists) problems.push(`The branch ${branch} exists already. Look at it, then delete it yourself (git branch -D ${branch}) or pass --branch <other name>.`);

  const dirty = dirtyPaths(repo, manifest.dirtyAllowed);
  if (dirty.length > 0) {
    problems.push(`${dirty.length} tracked file(s) differ from HEAD, so the release would not match a commit you can check out: ${dirty.slice(0, 8).join(', ')}${dirty.length > 8 ? ', ...' : ''}. Commit or revert them first.`);
  }

  // What ships: the index, filtered by the manifest.
  const all = indexFiles(repo);
  const include = manifest.include.map(globToRegExp);
  const exclude = manifest.exclude.map(globToRegExp);
  const shipped = all.filter((f) => include.some((re) => re.test(f.path)) && !exclude.some((re) => re.test(f.path)));
  const leftOut = all.filter((f) => !shipped.includes(f));
  for (const [i, re] of include.entries()) {
    if (!all.some((f) => re.test(f.path))) problems.push(`The manifest's include pattern "${manifest.include[i]}" matches nothing in the index.`);
  }
  for (const path of manifest.require) {
    if (!shipped.some((f) => f.path === path)) {
      problems.push(
        path.startsWith('plugin/runtime/')
          ? `${path} is not in the index. Run \`node scripts/release-plugin.ts --stage\` first: it builds the plugin runtime and stages it.`
          : `${path} would not be in the release.`,
      );
    }
  }

  const who = identity(values.get('--author'), { name: values.get('--name'), email: values.get('--email') });
  const yes = flags.has('--yes');
  if (typeof who === 'string') problems.push(who);

  const at = now();
  const tooEarly = flags.has('--allow-office-hours') ? null : officeHoursRefusal(at);

  const entries: Entry[] = shipped.map((f) => ({ path: f.path, hash: f.hash }));
  const total = shipped.reduce((sum, f) => sum + f.size, 0);
  // A dry run scans the files it would commit; a real run scans the written tree instead (below).
  const scan: Scan = dry ? scanBlobs(repo, entries) : { hits: 0, scanned: 0, lines: [] };

  const report = () => {
    out(`Release commit: ${shipped.length} files, ${kb(total)}. Left out: ${leftOut.length} files.`);
    out();
    for (const f of shipped) out(`  ${f.path}`);
    out();
    const groups = new Map<string, number>();
    for (const f of leftOut) groups.set(top(f.path), (groups.get(top(f.path)) ?? 0) + 1);
    out('Left out by the manifest:');
    for (const [name, n] of groups) out(`  ${name} (${n})`);
    out();
  };

  if (dry) {
    report();
    out(typeof who === 'string' ? `Identity: refused. ${who}` : `Identity: ${who.name} <${who.email}>${who.email === STUDIO.email ? ` (${STUDIO.name}'s own)` : NOREPLY.test(who.email) ? ' (a GitHub noreply address)' : " (NOT Zeus Studio's or a noreply address: it would be public in every clone)"}`);
    out(`Clock: ${DAYS[at.getDay()]} ${pad(at.getHours())}:${pad(at.getMinutes())}. ${tooEarly ? `Not allowed now. ${tooEarly}` : flags.has('--allow-office-hours') ? 'Allowed (--allow-office-hours).' : 'Allowed now.'}`);
    out(scan.hits ? `Privacy scan: ${scan.hits} hit(s) in ${scan.scanned} text files, the commit would be refused:` : `Privacy scan: clean, ${scan.scanned} text files, no hits.`);
    for (const line of scan.lines) out(`  ${line}`);
    out(`Branch: ${branch} would be created${exists ? ' (it exists already: refused)' : ''}.`);
    if (problems.length > 0) {
      out();
      out('A real run would refuse now:');
      for (const p of problems) out(`  - ${p}`);
    }
    out();
    out('Dry run: nothing was created, staged or changed.');
    return;
  }

  if (problems.length > 0) throw new SquashError(`Not making the release commit:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  if (tooEarly) throw new SquashError(tooEarly);
  if (typeof who === 'string') throw new SquashError(who);

  const dir = mkdtempSync(join(tmpdir(), 'worklings-squash-'));
  let tree: string;
  try {
    const indexFile = join(dir, 'index');
    const lines = shipped.map((f) => `${f.mode} ${f.hash}\t${f.path}`).join('\n');
    // update-index's own stdin format is `mode SP hash TAB path`, one per line; paths with newlines can't occur in a
    // repository that passes the manifest, and update-index refuses them in this format.
    execFileSync('git', ['update-index', '--add', '--index-info'], { cwd: repo, input: `${lines}\n`, env: { ...gitEnv(), GIT_INDEX_FILE: indexFile }, stdio: ['pipe', 'pipe', 'pipe'] });
    tree = execFileSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8', env: { ...gitEnv(), GIT_INDEX_FILE: indexFile } }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The scan that counts is the one over the tree that will be committed, read back from git.
  const final = scanBlobs(repo, treeEntries(repo, tree));
  if (final.hits > 0) {
    throw new SquashError(`The privacy scan found ${final.hits} hit(s) in the release tree, so no commit was made:\n${final.lines.map((l) => `  ${l}`).join('\n')}`);
  }

  const version = (() => {
    try {
      return (JSON.parse(runGit(repo, ['show', `${tree}:package.json`])) as { version?: string }).version;
    } catch {
      return undefined;
    }
  })();
  const message = values.get('--message') ?? (version ? `Worklings ${version}` : 'Worklings');

  out(`Tree ${tree.slice(0, 12)}: ${shipped.length} files, ${kb(total)}; the privacy scan is clean (${final.scanned} text files).`);
  out(`Commit message: ${message}`);
  out(`Author and committer: ${who.name} <${who.email}>`);
  if (yes) {
    // No questions: only for Zeus Studio's address or a noreply one, so an unattended run never publishes a personal email.
    if (!publicEmail(who.email)) {
      throw new SquashError(`--yes needs ${STUDIO.name}'s email or a GitHub noreply email, and ${who.email} is neither. Leave out --author to commit as ${STUDIO.name} <${STUDIO.email}>, or run without --yes to confirm this one by typing it.`);
    }
    out(`--yes: making the commit as ${who.name} <${who.email}>, without asking.`);
  }
  const q = yes ? null : asker();
  try {
    if (q && !publicEmail(who.email)) {
      out(`${who.email} is neither ${STUDIO.name}'s address nor a GitHub noreply one, so it would be public in every clone, forever.`);
      out(`Recommended: leave out --author, and the commit is made as ${STUDIO.name} <${STUDIO.email}>.`);
      const typed = await q.ask('To publish this email anyway, type it exactly: ');
      if (typed !== who.email) throw new SquashError('Declined: the email was not confirmed. Nothing was created.');
    }
    if (q) {
      const answer = await q.ask(`Create one parentless commit on a new local branch "${branch}" as ${who.name} <${who.email}>? [y/N] `);
      if (!/^y(es)?$/i.test(answer)) throw new SquashError('Declined. Nothing was created.');
    }
  } finally {
    q?.close();
  }

  const env = { GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email };
  const commit = runGit(repo, ['commit-tree', tree, '-F', '-'], { input: `${message}\n`, env }).trim();
  // The all-zero old value makes update-ref refuse if the branch appeared meanwhile.
  runGit(repo, ['update-ref', branchRef, commit, '0000000000000000000000000000000000000000']);
  out();
  out(`Created ${branch} at ${commit.slice(0, 12)}: no parent, ${shipped.length} files. The working tree, the index and the current branch are unchanged.`);
  out('Next: docs/launch/release-steps.md, "Push the release". The run branches stay local.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
