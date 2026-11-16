// Worklings writes into project folders it didn't create, and a cloned repo can ship a symlink or junction (say
// .claude/rules/style.md -> ~/.zshrc). Every read of studio files and every write goes through these checks, so a link
// can't carry either one outside the project.
import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const isLink = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true;

/**
 * Resolves `target` (absolute, or relative to `root`) and returns it when it lies inside `root` and no folder or file
 * between the two is a link. Otherwise throws `Err` with a message for the person running the command.
 */
export function plainPath(root: string, target: string, Err: new (message: string) => Error = Error): string {
  const base = resolve(root);
  const full = resolve(base, target);
  const rel = relative(base, full);
  if (rel === '') return full;
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Err(`${target} is outside the project folder.`);
  let current = base;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (isLink(current)) throw new Err(`${relative(base, current).replaceAll('\\', '/')} is a symlink or junction; Worklings doesn't read or write through links.`);
  }
  return full;
}
