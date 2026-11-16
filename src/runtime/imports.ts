// The files a project's CLAUDE.md and CLAUDE.local.md files import with `@path` (Claude Code's memory imports). They
// are instructions every desk reads, so the approvals policy treats writing them as it treats writing .claude/ (it
// asks), and each desk's settings send their edits through the approval hook. A plain AGENTS.md that nothing imports
// stays an ordinary doc. Read only inside the project and never through a link, five hops deep as Claude Code follows
// them, with caps on the walk, the files and their sizes; cached until a file read changes or a minute has passed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { opened, type PathModule, throughLink } from './paths.ts';

export { throughLink } from './paths.ts';

/** Claude Code follows imports five hops deep. */
const MAX_HOPS = 5;
/** At most this many files are read for one project, instruction files included. */
const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
/** The walk that finds CLAUDE.md files: how many folders, and how deep. */
const MAX_FOLDERS = 2_000;
const MAX_WALK_DEPTH = 8;
/** A walk stands this long before the next one looks again for new CLAUDE.md files. */
const WALK_TTL_MS = 60_000;
/** Folders that hold no instructions of the project's own. */
const SKIPPED = new Set([
  'node_modules', '.git', '.worklings', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.astro', '.svelte-kit', '.turbo', '.cache',
  '.venv', 'venv', '__pycache__', 'target', 'vendor',
]);
const INSTRUCTION_FILES = new Set(['claude.md', 'claude.local.md']);

interface Entry {
  walkedAt: number;
  /** Every file read (instruction files and imports), with its stamp when read. */
  stamps: Map<string, string>;
  /** The imported files, by their comparison key. */
  keys: Set<string>;
  /** The imported files, as full paths. */
  files: string[];
}

const cache = new Map<string, Entry>();

export interface ImportOptions {
  platform?: NodeJS.Platform;
  /** For tests: the clock the walk's age is measured by. */
  now?: () => number;
}

const pathFor = (platform: NodeJS.Platform): PathModule => (platform === 'win32' ? win32 : posix);
/** How two paths compare: without case on Windows. */
const keyOf = (path: string, win: boolean) => (win ? path.toLowerCase() : path);

function inside(p: PathModule, base: string, full: string): boolean {
  const rel = p.relative(base, full);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
}

/** A file's size and change time, or "missing": what says it changed since it was read. */
function stampOf(path: string): string {
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat ? `${stat.mtimeMs}:${stat.size}` : 'missing';
  } catch {
    return 'unreadable';
  }
}

/** The CLAUDE.md and CLAUDE.local.md files in the project, by a bounded walk that never enters a link. */
function instructionFiles(base: string, p: PathModule): string[] {
  const found: string[] = [];
  let folders = 0;
  const walk = (dir: string, depth: number) => {
    if (folders >= MAX_FOLDERS || depth > MAX_WALK_DEPTH) return;
    folders++;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (entry.isFile() && INSTRUCTION_FILES.has(name.toLowerCase())) found.push(p.join(dir, name));
      else if (entry.isDirectory() && !SKIPPED.has(name.toLowerCase())) walk(p.join(dir, name), depth + 1);
    }
  };
  walk(base, 0);
  return found;
}

/**
 * The `@path` imports in a CLAUDE.md, as Claude Code reads them: anywhere in the text after a space or at a line's
 * start, never inside a code block or a code span; a trailing full stop or bracket isn't part of the path.
 */
export function importsIn(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const plain = line.replace(/`[^`]*`/g, ' ');
    for (const m of plain.matchAll(/(?:^|\s)@([^\s`'"<>|*?]+)/g)) {
      const path = (m[1] ?? '').replace(/[.,;:!)\]}]+$/, '');
      if (path !== '' && !path.startsWith('@')) out.push(path);
    }
  }
  return out;
}

/** Where an import leads, as the platform opens it, when that is inside the project and not through a link. */
function resolveImport(raw: string, from: string, base: string, p: PathModule, platform: NodeJS.Platform): string | null {
  if (raw.startsWith('~')) return null; // the home folder: never the project
  const full = opened(p.resolve(p.dirname(from), raw), platform);
  if (full === null || !inside(p, base, full) || throughLink(p, base, full)) return null;
  return full;
}

function readSmall(path: string): string | null {
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function build(base: string, p: PathModule, platform: NodeJS.Platform, now: number): Entry {
  const win = platform === 'win32';
  const stamps = new Map<string, string>();
  const keys = new Set<string>();
  const files: string[] = [];
  const queue: { file: string; hops: number }[] = instructionFiles(base, p).map((file) => ({ file, hops: 0 }));
  const seen = new Set(queue.map((q) => keyOf(q.file, win)));
  for (let i = 0; i < queue.length && stamps.size < MAX_FILES; i++) {
    const { file, hops } = queue[i] ?? { file: '', hops: MAX_HOPS };
    stamps.set(file, stampOf(file));
    const text = readSmall(file);
    if (text === null || hops >= MAX_HOPS) continue;
    for (const raw of importsIn(text)) {
      const target = resolveImport(raw, file, base, p, platform);
      if (target === null) continue;
      const key = keyOf(target, win);
      // An import that isn't there yet still counts: writing it would add to every desk's instructions.
      if (!keys.has(key)) {
        keys.add(key);
        files.push(target);
      }
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ file: target, hops: hops + 1 });
      }
    }
  }
  return { walkedAt: now, stamps, keys, files };
}

function entryFor(base: string, o: ImportOptions): { entry: Entry; win: boolean; p: PathModule } {
  const platform = o.platform ?? process.platform;
  const win = platform === 'win32';
  const p = pathFor(platform);
  // The folder as the platform opens it, so it compares with the paths the policy canonicalises.
  const root = opened(p.resolve(base), platform) ?? p.resolve(base);
  const now = (o.now ?? Date.now)();
  const cacheKey = `${platform}:${keyOf(root, win)}`;
  const cached = cache.get(cacheKey);
  // Its age either way: a clock set back mustn't keep an old walk forever.
  const fresh = cached !== undefined && Math.abs(now - cached.walkedAt) < WALK_TTL_MS;
  if (cached && fresh && [...cached.stamps].every(([file, stamp]) => stampOf(file) === stamp)) return { entry: cached, win, p };
  const entry = build(root, p, platform, now);
  cache.set(cacheKey, entry);
  return { entry, win, p };
}

/** The files the project's CLAUDE.md and CLAUDE.local.md files import, as full paths inside `base`. */
export function importedFiles(base: string, o: ImportOptions = {}): readonly string[] {
  return entryFor(base, o).entry.files;
}

/** Whether `full` is a file the project's CLAUDE.md files import (and so instructions every desk reads). */
export function isImported(base: string, full: string, o: ImportOptions = {}): boolean {
  const { entry, win } = entryFor(base, o);
  const platform = o.platform ?? process.platform;
  return entry.keys.has(keyOf(opened(full, platform) ?? full, win));
}

/**
 * The imported files as permission-rule paths relative to the desk's folder ("./AGENTS.md"), for the rules that send
 * their edits through the approval hook. A path with characters a rule can't hold safely is left out; the policy
 * still asks for it whenever the hook is asked.
 */
export function importRulePaths(cwd: string, o: ImportOptions = {}): string[] {
  const platform = o.platform ?? process.platform;
  const p = pathFor(platform);
  const from = opened(p.resolve(cwd), platform) ?? p.resolve(cwd);
  const paths: string[] = [];
  for (const file of importedFiles(cwd, o)) {
    const rel = p.relative(from, file).split(p.sep).join('/');
    if (/^[\w./@+ -]{1,200}$/.test(rel) && !rel.split('/').includes('..')) paths.push(`./${rel}`);
  }
  return paths;
}
