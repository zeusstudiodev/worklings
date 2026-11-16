// share_screenshot reads a PNG the person made and hands its bytes to the company. The path comes from the model, so it
// is checked like any outside input: inside the desk's folder or the project, no link on the way (plainPath), a regular
// file of at most LIMITS.screenshot bytes with a PNG's signature. The checks run again once the file is open, so a link
// swapped in between can't carry the read somewhere else.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { LIMITS, OrgRefusal } from '../core/company.ts';
import { plainPath } from '../safe-fs.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** "IHDR": the chunk every PNG starts with, right after the signature and the chunk's length. */
const IHDR = [0x49, 0x48, 0x44, 0x52];
/** The signature and the IHDR chunk: length, type, 13 bytes of header and the CRC. */
const PNG_MIN = 8 + 4 + 4 + 13 + 4;

class Refused extends OrgRefusal {
  constructor(message: string) {
    super('invalid', message);
  }
}

/** True when `full` is `base` or lies under it. */
export const isInside = (base: string, full: string): boolean => {
  const rel = relative(base, full);
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
};

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;

const isPng = (bytes: Uint8Array): boolean =>
  bytes.length >= PNG_MIN && PNG_SIGNATURE.every((b, i) => bytes[i] === b) && IHDR.every((b, i) => bytes[12 + i] === b);

/** A refusal for what the file system said, or the error itself when it is something no sentence covers. */
function refusalFor(error: unknown, shown: string): Error {
  if (error instanceof OrgRefusal) return error;
  const code = error instanceof Error && 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') return new Refused(`There is no file at ${shown}.`);
  if (code === 'EISDIR') return new Refused(`${shown} is a folder, not a PNG file.`);
  if (code === 'ELOOP') return new Refused(`${shown} is a link; Worklings doesn't read through links.`);
  if (code === 'EACCES' || code === 'EPERM') return new Refused(`${shown} can't be read: permission denied.`);
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The bytes of the PNG at `given` (relative to the desk's folder `cwd`, or absolute), when it lies inside `cwd` or the
 * project `root`. Throws an OrgRefusal with a sentence for anything else.
 */
export async function readScreenshot(root: string, cwd: string, given: string): Promise<Uint8Array> {
  const shown = JSON.stringify(given.length > 120 ? `${given.slice(0, 119)}…` : given);
  if (given.includes('\0')) throw new Refused(`${shown} is not a path.`);
  const full = resolve(cwd, given);
  const base = isInside(cwd, full) ? cwd : isInside(root, full) ? root : null;
  if (base === null) throw new Refused(`${shown} is outside your working folder and the project, so it can't be shared.`);
  const checked = () => {
    try {
      return plainPath(base, full, Refused);
    } catch (error) {
      throw refusalFor(error, shown);
    }
  };

  const path = checked();
  const named = await lstat(path, { bigint: true }).catch((error: unknown) => {
    throw refusalFor(error, shown);
  });
  if (named.isDirectory()) throw new Refused(`${shown} is a folder, not a PNG file.`);
  if (!named.isFile()) throw new Refused(`${shown} is not a regular file.`);
  if (named.size > BigInt(LIMITS.screenshot)) throw new Refused(`${shown} is larger than ${megabytes(LIMITS.screenshot)}, the most a shared screenshot may be.`);
  // O_NOFOLLOW where the platform has it (not Windows): the last step can't be a link even if one appears now.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error: unknown) => {
    throw refusalFor(error, shown);
  });
  try {
    // What was opened must be the file just checked, and the path must still have no link on the way.
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.ino !== named.ino || opened.dev !== named.dev || opened.size !== named.size) {
      throw new Refused(`${shown} changed while it was being read; share it again.`);
    }
    checked();

    const size = Number(opened.size);
    if (size < PNG_MIN) throw new Refused(`${shown} is not a PNG image; share_screenshot takes PNG files only.`);
    const bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const { bytesRead } = await handle.read(bytes, read, size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read !== size) throw new Refused(`${shown} changed while it was being read; share it again.`);
    if (!isPng(bytes)) throw new Refused(`${shown} is not a PNG image; share_screenshot takes PNG files only.`);
    return bytes;
  } finally {
    await handle.close();
  }
}
