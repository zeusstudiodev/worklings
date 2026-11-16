// A finished task's diff (docs/design-v3.md, "Tasks"): `git show <commit>` read into files of numbered lines, with the
// caps the wide view draws (500 lines a file) and the sentences around it. Pure, so it can be tested.

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'note';

export interface DiffLine {
  kind: DiffLineKind;
  /** Line numbers before and after, where the line has one. */
  old: number | null;
  new: number | null;
  text: string;
}

export interface DiffFile {
  path: string;
  /** Where a renamed or copied file came from. */
  from: string | null;
  change: 'added' | 'deleted' | 'renamed' | 'modified';
  binary: boolean;
  added: number;
  removed: number;
  /** The lines shown, at most the cap. */
  lines: DiffLine[];
  /** Lines past the cap. */
  more: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  added: number;
  removed: number;
}

/** Lines a file shows before the rest become a `git show` command. */
export const DIFF_LINES_SHOWN = 500;
/** A line longer than this (minified code) is cut, so one line can't fill the page. */
export const DIFF_LINE_CHARS = 1_000;
/** Files open when the diff opens. */
export const DIFF_FILES_OPEN = 5;

/** A path as git writes it: plain, or quoted with C escapes and octal bytes for anything unusual ("a/caf\303\251.md"). */
export function unquotePath(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const body = text.slice(1, -1);
  const encoder = new TextEncoder();
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i] ?? '';
    if (c !== '\\') {
      bytes.push(...encoder.encode(c));
      continue;
    }
    const next = body[i + 1] ?? '';
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 3;
    } else if (Object.hasOwn(simple, next)) {
      bytes.push(simple[next] ?? 0);
      i += 1;
    } else bytes.push(92);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** "a/src/x.ts" -> "src/x.ts"; "/dev/null" stays as it is. */
const stripSide = (path: string) => (path === '/dev/null' ? path : path.replace(/^[ab]\//, ''));

/** The two paths of a `diff --git a/x b/y` line, quoted or not. */
function gitPaths(rest: string): [string, string] | null {
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest);
  if (quoted?.[1] && quoted[2]) return [stripSide(unquotePath(quoted[1])), stripSide(unquotePath(quoted[2]))];
  // Unquoted paths with spaces: split where " b/" starts, assuming the same path on both sides.
  const half = /^a\/(.+) b\/(.+)$/.exec(rest);
  return half?.[1] && half[2] ? [half[1], half[2]] : null;
}

const cut = (text: string) => (text.length > DIFF_LINE_CHARS ? `${text.slice(0, DIFF_LINE_CHARS - 1)}…` : text);

/** Reads a unified diff (what `git show` or `git diff` prints); the commit's header before the first file is skipped. */
export function parseDiff(text: string, shown = DIFF_LINES_SHOWN): ParsedDiff {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  const push = (line: DiffLine) => {
    if (!file) return;
    if (file.lines.length < shown) file.lines.push(line);
    else file.more += 1;
  };
  const start = (path: string, from: string | null): DiffFile => {
    const f: DiffFile = { path, from, change: 'modified', binary: false, added: 0, removed: 0, lines: [], more: 0 };
    files.push(f);
    inHunk = false;
    return f;
  };
  const rows = text.split(/\r?\n/);
  for (const [index, raw] of rows.entries()) {
    if (raw.startsWith('diff --git ')) {
      const paths = gitPaths(raw.slice('diff --git '.length));
      file = start(paths?.[1] ?? raw.slice('diff --git '.length), paths && paths[0] !== paths[1] ? paths[0] : null);
      continue;
    }
    if (!file) {
      // A plain `diff -u` has no git line: its "--- " header starts the file.
      if (raw.startsWith('--- ')) file = start(stripSide(unquotePath(raw.slice(4).split('\t')[0] ?? '')), null);
      else continue;
    }
    if (!inHunk) {
      if (raw.startsWith('new file mode')) file.change = 'added';
      else if (raw.startsWith('deleted file mode')) file.change = 'deleted';
      else if (raw.startsWith('rename from ')) {
        file.from = unquotePath(raw.slice('rename from '.length));
        file.change = 'renamed';
      } else if (raw.startsWith('rename to ')) {
        file.path = unquotePath(raw.slice('rename to '.length));
        file.change = 'renamed';
      } else if (raw.startsWith('Binary files ') || raw === 'GIT binary patch') file.binary = true;
      else if (raw.startsWith('--- ')) {
        const from = stripSide(unquotePath(raw.slice(4).split('\t')[0] ?? ''));
        if (from === '/dev/null') file.change = 'added';
      } else if (raw.startsWith('+++ ')) {
        const to = stripSide(unquotePath(raw.slice(4).split('\t')[0] ?? ''));
        if (to === '/dev/null') file.change = 'deleted';
        else if (file.change !== 'renamed') file.path = to;
      }
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      push({ kind: 'hunk', old: null, new: null, text: cut(raw) });
      continue;
    }
    if (!inHunk) continue;
    const mark = raw.charAt(0);
    if (mark === '+') {
      file.added += 1;
      push({ kind: 'add', old: null, new: newLine++, text: cut(raw.slice(1)) });
    } else if (mark === '-') {
      file.removed += 1;
      push({ kind: 'del', old: oldLine++, new: null, text: cut(raw.slice(1)) });
    } else if (mark === ' ') {
      push({ kind: 'ctx', old: oldLine++, new: newLine++, text: cut(raw.slice(1)) });
    } else if (mark === '\\') {
      push({ kind: 'note', old: null, new: null, text: raw.slice(2) });
    } else if (raw === '') {
      // An empty line in a hunk is a context line whose space something trimmed; the one after the last newline is nothing.
      if (index < rows.length - 1) push({ kind: 'ctx', old: oldLine++, new: newLine++, text: '' });
    } else inHunk = false;
  }
  return { files, added: files.reduce((s, f) => s + f.added, 0), removed: files.reduce((s, f) => s + f.removed, 0) };
}

const n = (x: number) => x.toLocaleString('en-US');

/** "4 files, 120 lines added and 12 removed, in a1b2c3d on worklings/plant-pal." */
export function changedLine(diff: ParsedDiff, commit: string, branch: string | null): string {
  const files = `${n(diff.files.length)} ${diff.files.length === 1 ? 'file' : 'files'}`;
  const lines = (count: number) => `${n(count)} ${count === 1 ? 'line' : 'lines'}`;
  const counts =
    diff.added > 0 && diff.removed > 0 ? `${lines(diff.added)} added and ${n(diff.removed)} removed`
      : diff.added > 0 ? `${lines(diff.added)} added`
        : diff.removed > 0 ? `${lines(diff.removed)} removed`
          : '';
  return `${files}${counts ? `, ${counts}` : ''}, in ${shortCommit(commit)}${branch ? ` on ${branch}` : ''}.`;
}

export const shortCommit = (commit: string): string => commit.slice(0, 7);

/** A path for a shell: quoted when it has anything a shell would split or read. */
const shellPath = (path: string) => (/^[\w./@+-]+$/.test(path) ? path : `"${path.replaceAll('"', '\\"')}"`);

/** The command that shows a file whole: "git show a1b2c3d -- src/streak/Card.tsx". */
export const moreCommand = (file: Pick<DiffFile, 'path'>, commit: string): string => `git show ${shortCommit(commit)} -- ${shellPath(file.path)}`;

/** "412 more lines:", before the command. */
export const moreLines = (file: Pick<DiffFile, 'more'>): string => `${n(file.more)} more ${file.more === 1 ? 'line' : 'lines'}:`;

/** How a file's counts read beside it: "+12 −3", or what happened to it. */
export function fileCounts(file: DiffFile): string {
  if (file.binary) return file.change === 'added' ? 'New binary file' : file.change === 'deleted' ? 'Binary file deleted' : 'Binary file';
  const parts = [file.added > 0 ? `+${n(file.added)}` : '', file.removed > 0 ? `−${n(file.removed)}` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : file.change === 'renamed' ? 'Renamed' : 'No line changes';
}

/** The same counts for a screen reader: "12 lines added, 3 removed". */
export function fileCountsSaid(file: DiffFile): string {
  if (file.binary) return fileCounts(file);
  const parts = [file.added > 0 ? `${n(file.added)} ${file.added === 1 ? 'line' : 'lines'} added` : '', file.removed > 0 ? `${n(file.removed)} removed` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : fileCounts(file);
}

/** "Couldn't read the diff: fatal: bad object a1b2c3d." from git's first line. */
export function diffFailedLine(message: string): string {
  const first = message.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';
  return `Couldn't read the diff: ${first ? first.replace(/[.\s]+$/, '') : 'the office sent nothing back'}.`;
}

/** What changed in a file, said in words for its summary line. */
export function changeWord(file: DiffFile): string | null {
  if (file.change === 'added') return 'new';
  if (file.change === 'deleted') return 'deleted';
  if (file.change === 'renamed') return file.from ? `renamed from ${file.from}` : 'renamed';
  return null;
}
