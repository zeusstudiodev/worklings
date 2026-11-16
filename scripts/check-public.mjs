// Before pushing to a public repo: scans text files for this machine's paths, the maintainer's names, handle and email,
// names of private projects, secret shapes, and links to Worklings' home that aren't the one in scripts/home.json.
// Prints file:line for each hit and exits 1 on any.
//   node scripts/check-public.mjs                  the tracked files the release ships (scripts/release-manifest.json),
//                                                  as they are in the working tree (npm run check:public)
//   node scripts/check-public.mjs --all            every tracked file, the internal run logs too
//   node scripts/check-public.mjs --tree <rev>     the files of a commit or tree, read from git (what a release holds)
//   node scripts/check-public.mjs --dir <folder>   every file in an exported folder
// scripts/release-squash.ts imports scanBlobs() and runs it on the tree it is about to commit.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-public.mjs';
/** Where Worklings lives, as scripts/home.json says: links to any other owner's copy are hits. */
const HOME = JSON.parse(readFileSync(join(root, 'scripts', 'home.json'), 'utf8'));
const OWNER = String(HOME.repository).split('/')[0].toLowerCase();

// The private terms (this machine's paths, the maintainer's names, handle and email, other private projects) are not
// in the repository, since a shipped list would publish what it guards. They live in a JSON file outside it:
//   { "patterns": [ { "label": "...", "regex": "...", "flags": "i", "identity": true, "inNotices": false } ] }
// `identity` marks the patterns a release commit's author must not match; `inNotices: false` lets third-party notices
// keep their authors' lines for that pattern. Without the file the scan refuses to run: it fails closed.
export const BLOCKLIST_PATH = () =>
  process.env.WORKLINGS_PUBLIC_BLOCKLIST || join(homedir(), '.config', 'worklings', 'public-blocklist.json');
const loaded = new Map();

/** The private patterns as { label, re, identity, inNotices }; throws when the file is missing or malformed. */
export function blocklist() {
  const file = BLOCKLIST_PATH();
  const known = loaded.get(file);
  if (known) return known;
  const refuse = (why) =>
    new Error(`The privacy scan needs its private blocklist at ${file} (${why}), and refuses to run without it. Ask the maintainer for the file, or set WORKLINGS_PUBLIC_BLOCKLIST to its path.`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw refuse('missing or not JSON');
  }
  const list = Array.isArray(raw?.patterns) ? raw.patterns : null;
  if (!list || list.length === 0) throw refuse('no patterns in it');
  const patterns = list.map((p) => {
    if (typeof p?.label !== 'string' || typeof p?.regex !== 'string') throw refuse('a pattern needs a label and a regex');
    let re;
    try {
      re = new RegExp(p.regex, typeof p.flags === 'string' ? p.flags.replace(/g/g, '') : '');
    } catch {
      throw refuse(`the pattern "${p.label}" isn't a valid regular expression`);
    }
    return { label: p.label, re, identity: p.identity === true, inNotices: p.inNotices !== false };
  });
  loaded.set(file, patterns);
  return patterns;
}

// Third-party licences must keep their authors' copyright lines, addresses included: there only the patterns marked
// for notices count.
const NOTICES = 'THIRD-PARTY-NOTICES.md';
const personal = () => blocklist().map(({ label, re }) => [label, re]);
const noticePersonal = () => blocklist().flatMap(({ label, re, inNotices }) => (inNotices ? [[label, re]] : []));

/** Whether a commit identity ("Name <email>") is the maintainer's own: a pattern the blocklist marks as identity. */
export function personalIdentity(text) {
  return blocklist().some(({ identity, re }) => identity && re.test(text));
}

/** Links to Worklings' repository, demo or marketplace under an owner other than scripts/home.json's. */
const HOME_LINKS = /github\.com\/([\w.-]+)\/worklings\b|\b([\w-]+)\.github\.io\/worklings\b|(?:marketplace add |--marketplace |--repo |repos\/|gh repo (?:create|view|edit) |`)([\w.-]+)\/worklings\b/gi;

/** Where in the line a link to another owner's Worklings starts, or -1. */
export function foreignHome(line) {
  for (const m of line.matchAll(HOME_LINKS)) {
    const owner = (m[1] ?? m[2] ?? m[3] ?? '').toLowerCase();
    if (owner !== OWNER) return m.index ?? 0;
  }
  return -1;
}

/** `*` stays inside a folder level, `**` crosses folders, a trailing `/` means everything below. */
export function globToRegExp(pattern) {
  const p = pattern.endsWith('/') ? `${pattern}**` : pattern;
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Whether a path ships in the release, by the manifest's include and exclude patterns. */
export function shipsBy(manifest) {
  const include = manifest.include.map(globToRegExp);
  const exclude = manifest.exclude.map(globToRegExp);
  return (path) => include.some((re) => re.test(path)) && !exclude.some((re) => re.test(path));
}

const secrets = [
  ['Anthropic key', /sk-ant-/],
  ['GitHub token', /ghp_|github_pat_/],
  ['AWS key id', /AKIA/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY/],
];

// Secret shapes are allowed only where the redactor is tested with made-up keys.
const fakeKeyFiles = new Set([
  'src/core/redact.ts',
  'test/aside.test.ts',
  'test/boards.test.ts',
  'test/budget.test.ts',
  'test/check-public.test.ts',
  'test/check-run.test.ts',
  'test/checklist.test.ts',
  'test/company-ceo.test.ts',
  'test/company-git.test.ts',
  'test/company-messages.test.ts',
  'test/company-tasks.test.ts',
  'test/company-view.test.ts',
  'test/digest.test.ts',
  'test/events.test.ts',
  'test/excerpt.test.ts',
  'test/masking.test.ts',
  'test/overview.test.ts',
  'test/panels-work-people.test.ts',
  'test/redact.test.ts',
  'test/runtime-protocol.test.ts',
  'test/steering-plan-check.test.ts',
  'test/story.test.ts',
]);

const git = (args, cwd, input) =>
  execFileSync('git', args, { cwd, input, encoding: input === undefined ? 'utf8' : 'buffer', maxBuffer: 1 << 29 });

/** The files of a tree-ish as { path, hash }, from git. */
export function treeEntries(cwd, treeish) {
  return git(['ls-tree', '-r', '-z', '--full-tree', treeish], cwd)
    .split('\0')
    .filter(Boolean)
    .flatMap((row) => {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(row);
      return m && m[2] === 'blob' ? [{ path: m[4], hash: m[3] }] : [];
    });
}

/** Reads blobs by hash through one `git cat-file --batch` process: one Buffer per entry, in order. */
function readBlobs(cwd, entries) {
  if (!entries.length) return [];
  const out = git(['cat-file', '--batch'], cwd, Buffer.from(entries.map((e) => `${e.hash}\n`).join('')));
  const blobs = [];
  let at = 0;
  for (const e of entries) {
    const eol = out.indexOf(10, at);
    const [, type, size] = out.subarray(at, eol).toString('latin1').split(' ');
    if (type !== 'blob') throw new Error(`${e.path}: ${e.hash} is not a blob`);
    blobs.push(out.subarray(eol + 1, eol + 1 + Number(size)));
    at = eol + 1 + Number(size) + 1;
  }
  return blobs;
}

/** Scans files given as { path, read() -> Buffer } (paths with forward slashes). Returns { hits, scanned, lines }. */
export function scanFiles(files) {
  const lines = [];
  let hits = 0;
  let scanned = 0;
  for (const { path: file, read } of files) {
    if (file === SELF) continue;
    let buf;
    try {
      buf = read();
    } catch {
      continue; // listed but deleted in the working tree
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    scanned++;
    const text = buf.toString('utf8').split(/\r?\n/);
    // Any copy of the notices (the plugin runtime bundles them) keeps its authors' lines.
    const mine = file === NOTICES || file.endsWith(`/${NOTICES}`) ? noticePersonal() : personal();
    const checks = fakeKeyFiles.has(file) ? mine : [...mine, ...secrets];
    text.forEach((line, i) => {
      const away = foreignHome(line);
      if (away >= 0) {
        hits++;
        lines.push(`${file}:${i + 1}: not Worklings' home (${HOME.repository}): ...${line.slice(Math.max(0, away - 30), away + 60).trim()}`);
      }
      for (const [kind, re] of checks) {
        const m = re.exec(line);
        if (!m) continue;
        // A key's prefix followed by regex syntax is the redactor's pattern (bundled into the plugin runtime and the web
        // app), not a key: a real key goes on with letters and digits.
        if (secrets.some(([k]) => k === kind) && /^[[\\({|]/.test(line.slice(m.index + m[0].length))) continue;
        hits++;
        const at = Math.max(0, m.index - 30);
        lines.push(`${file}:${i + 1}: ${kind}: ...${line.slice(at, m.index + m[0].length + 30).trim()}`);
      }
    });
  }
  return { hits, scanned, lines };
}

/** Scans git blobs ({ path, hash }) of the repository at `cwd`. */
export function scanBlobs(cwd, entries) {
  const blobs = readBlobs(cwd, entries);
  return scanFiles(entries.map((e, i) => ({ path: e.path, read: () => blobs[i] })));
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? (e.name === '.git' ? [] : walk(full)) : [full];
  });
}

function main(args) {
  try {
    blocklist();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  let result;
  let what = 'tracked text files';
  if (flag('--tree')) {
    result = scanBlobs(root, treeEntries(root, flag('--tree')));
    what = `text files in ${flag('--tree')}`;
  } else if (flag('--dir')) {
    const dir = flag('--dir');
    result = scanFiles(walk(dir).map((f) => ({ path: relative(dir, f).split(sep).join('/'), read: () => readFileSync(f) })));
    what = `text files in ${dir}`;
  } else {
    const all = args.includes('--all');
    const ships = shipsBy(JSON.parse(readFileSync(join(root, 'scripts', 'release-manifest.json'), 'utf8')));
    const files = git(['ls-files', '-z'], root)
      .split('\0')
      .filter(Boolean)
      .filter((f) => all || ships(f));
    result = scanFiles(files.map((f) => ({ path: f, read: () => readFileSync(join(root, f)) })));
    if (!all) what = 'tracked text files the release ships';
  }
  for (const line of result.lines) console.log(line);
  console.log(result.hits ? `\n${result.hits} hit(s) in ${result.scanned} ${what}.` : `Clean: ${result.scanned} ${what}, no hits.`);
  process.exit(result.hits ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
