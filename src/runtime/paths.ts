// Paths as the file system will open them, for every comparison that decides what a desk may write. Windows (its Win32
// layer) drops trailing dots and spaces from each component and opens a file's alternate data stream (name:stream) on
// the file itself, so ".claude./x", ".claude /x" and "CLAUDE.md:evil" are .claude/x and CLAUDE.md there; an 8.3 short
// name (CLAUD~1.MD) is the long name it stands for, where the volume keeps short names. Links are seen for what they
// are: a folder or file on the way that is a link (a junction on Windows) could lead anywhere.
import { lstatSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export type PathModule = typeof win32 | typeof posix;

/** A component Windows may read as an 8.3 short name. */
const SHORT_NAME = /~\d/;

/**
 * The path Windows opens for `full` (absolute): each component without its data stream and its trailing dots and
 * spaces, and short names expanded through the part of the path that exists. Null when nobody can say which file it
 * is: a short name that can't be expanded, or a component of only dots and spaces ("...", ".. ") that Windows versions
 * read differently.
 */
export function windowsPath(full: string): string | null {
  const { root } = win32.parse(full);
  const parts: string[] = [];
  for (const raw of full.slice(root.length).split(/[\\/]+/)) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      parts.pop();
      continue;
    }
    const name = raw.replace(/:.*$/s, '');
    if (/^[. ]*$/.test(name)) return null;
    parts.push(name.replace(/[. ]+$/, ''));
  }
  const plain = parts.length > 0 ? win32.join(root, ...parts) : root;
  if (!parts.some((part) => SHORT_NAME.test(part))) return plain;
  // Expand short names through the deepest part of the path that is there; what follows must hold none.
  for (let i = parts.length; i > 0; i--) {
    let real: string;
    try {
      real = realpathSync.native(win32.join(root, ...parts.slice(0, i)));
    } catch {
      continue;
    }
    const rest = parts.slice(i);
    if (rest.some((part) => SHORT_NAME.test(part))) return null;
    return rest.length > 0 ? win32.join(real, ...rest) : real;
  }
  return null;
}

/** `full` as the platform opens it: Windows' rules there, the path as it is elsewhere. Null: which file is unknown. */
export function opened(full: string, platform: NodeJS.Platform): string | null {
  return platform === 'win32' ? windowsPath(full) : full;
}

/** Whether a folder or file between `base` and `full` is a link (a junction on Windows), which could lead anywhere. */
export function throughLink(p: PathModule, base: string, full: string): boolean {
  const rel = p.relative(base, full);
  if (rel === '') return false;
  let at = base;
  for (const part of rel.split(p.sep)) {
    at = p.join(at, part);
    try {
      const stat = lstatSync(at, { throwIfNoEntry: false });
      if (!stat) return false;
      if (stat.isSymbolicLink()) return true;
    } catch {
      return true; // can't look: don't trust it
    }
  }
  return false;
}
