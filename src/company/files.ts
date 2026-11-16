// The files a task owns: paths relative to the project, which no two open tasks share. A folder owns what is under
// it. Paths are compared without case, since Windows and macOS treat "App.tsx" and "app.tsx" as one file.
import { LIMITS } from '../core/company.ts';

export type FilesCheck = { ok: true; files: string[] } | { ok: false; error: string };

const shown = (raw: string) => `"${raw.length > 80 ? `${raw.slice(0, 79)}…` : raw}"`;

/** The folders no task owns: the company's own state and git's. */
const RESERVED = new Set(['.worklings', '.git']);

/** The problem with one path, in a sentence, or null when it is a plain relative path inside the project. */
function problemWith(raw: string, path: string): string | null {
  if (raw.length > LIMITS.path) return `A path can be up to ${LIMITS.path} characters; ${shown(raw)} is longer.`;
  if (/^(?:[\\/~]|[a-zA-Z]:)/.test(raw.trim())) return `${shown(raw)} is an absolute path; name files relative to the project, like src/app.ts.`;
  if (path === '') return 'A file path is empty; name the files or folders the task owns, or none.';
  // Control characters, and a colon, which no path inside a project needs (on Windows it opens a drive or a stream).
  if (/\p{Cc}/u.test(raw) || raw.includes(':')) return `${shown(raw)} has a character a project path can't have.`;
  const parts = path.split('/');
  if (parts.includes('..')) return `${shown(raw)} leaves the project; name files inside it.`;
  if (RESERVED.has((parts[0] ?? '').toLowerCase()) || parts.some((p) => p.toLowerCase() === '.git')) return `${shown(raw)} is git's or Worklings' own folder, which no task owns.`;
  return null;
}

/** "./src//app\\" -> "src/app": forward slashes, no "." segments, no trailing slash. */
export function normalizePath(raw: string): string {
  return raw
    .trim()
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

/** Checks and normalizes the files an assignment names. Duplicates go; the order stays. */
export function checkTaskFiles(raw: readonly unknown[]): FilesCheck {
  if (raw.length > LIMITS.files) {
    return { ok: false, error: `A task owns up to ${LIMITS.files} files or folders, and this one names ${raw.length}; name folders instead of every file.` };
  }
  const files: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') return { ok: false, error: 'Files are paths written as text, relative to the project.' };
    const path = normalizePath(entry);
    const problem = problemWith(entry, path);
    if (problem) return { ok: false, error: problem };
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(path);
  }
  return { ok: true, files };
}

/** Whether two owned paths touch: the same file, or one is a folder the other is inside. */
export function overlaps(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || y.startsWith(`${x}/`) || x.startsWith(`${y}/`);
}
