// Folder paths as the hub hands them over (Windows or POSIX), for Start a company and the demo's folders. Pure.

/** "C:\Users\you\Projects" -> "C:\Users\you"; null for a drive or a root. */
export function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '');
  const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (at < 0) return null;
  const parent = trimmed.slice(0, at);
  if (parent === '' || /^[A-Za-z]:$/.test(parent)) return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : '/';
  return parent;
}

export const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? path;

/** A folder inside another, with the separator the parent uses. */
export const joinPath = (parent: string, name: string): string => `${parent.replace(/[\\/]+$/, '')}${parent.includes('\\') ? '\\' : '/'}${name}`;

/** The same folder, ignoring case and a trailing separator, as Windows does. */
export const sameFolder = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
/** True when `inner` is a folder somewhere inside `outer`, with either separator. */
export function insideOf(outer: string, inner: string): boolean {
  const base = outer.replace(/[\\/]+$/, '').toLowerCase();
  const path = inner.toLowerCase();
  return path.length > base.length + 1 && path.startsWith(base) && (path[base.length] === '\\' || path[base.length] === '/');
}
