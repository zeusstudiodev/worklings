// The office's access token: required for every change made from the browser, and for everything in --lan mode.
// It persists in ~/.worklings/token so a bookmarked URL keeps working across restarts.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FOLDER = '.worklings';
/** Where the token lived while the tool was called Headcount. Read to keep old links working, never changed. */
const LEGACY_FOLDER = '.headcount';
/** The variable that moved the token folder under the old name; WORKLINGS_HOME wins when both are set. */
const LEGACY_HOME_ENV = 'HEADCOUNT_HOME';

/** WORKLINGS_HOME moves the token folder, so tests and portable setups never touch the real home folder. */
const defaultHome = () => process.env.WORKLINGS_HOME ?? process.env[LEGACY_HOME_ENV] ?? homedir();

export function tokenFile(home = defaultHome()): string {
  return join(home, FOLDER, 'token');
}

export function loadToken(home = defaultHome()): string {
  const file = tokenFile(home);
  const saved = readToken(file);
  if (saved) return saved;
  // Only the first run after the rename takes the old token, so links bookmarked before it keep working; once the
  // folder exists, deleting the token file gets a new one rather than the old one back.
  const legacy = existsSync(join(home, FOLDER)) ? null : readToken(join(home, LEGACY_FOLDER, 'token'));
  const token = legacy ?? freshToken();
  mkdirSync(join(home, FOLDER), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

/** The token saved in a file, or null when there is no file or it doesn't hold a token the office would make. */
function readToken(file: string): string | null {
  if (!existsSync(file)) return null;
  const token = readFileSync(file, 'utf8').trim();
  return /^[\w-]{32,}$/.test(token) ? token : null;
}

/** A new random token, for a --lan office whose link should stop working when the office stops. */
export function freshToken(): string {
  return randomBytes(24).toString('base64url');
}

export function sameToken(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
