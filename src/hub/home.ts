// The hub's own folder, ~/.worklings (outside every project): the key that signs the companies' logs, the registry of
// companies, the person's settings and the lock that keeps a second hub from running the same companies. Each company's
// folder has a lock of its own too, for a hub started from another home.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { safeId } from '../core/events.ts';
import { PERSON_NAME } from '../core/studio.ts';
import { plainPath } from '../safe-fs.ts';
import { isInside } from '../server/office.ts';
import { findGit } from './folders.ts';

const FOLDER = '.worklings';
/** The variable that moved the folder while the tool was called Headcount (read as src/server/token.ts reads it). */
const LEGACY_HOME_ENV = 'HEADCOUNT_HOME';
const KEY_FILE = 'hub.key';
const REGISTRY_FILE = 'companies.json';
const SETTINGS_FILE = 'settings.json';
const LOCK_FILE = 'hub.lock';
/** A company's state folder in its project, where its own lock goes. */
const COMPANY_STATE = '.worklings';
export const KEY_BYTES = 32;

/** A problem with the hub's own files, in a sentence that says how to fix it. */
export class HubHomeError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where ~/.worklings lives, found as the office token's folder is: WORKLINGS_HOME, the old name's variable, then home. */
export const worklingsHome = (env: NodeJS.ProcessEnv = process.env): string => env.WORKLINGS_HOME ?? env[LEGACY_HOME_ENV] ?? homedir();

/** `<home>/.worklings`, made when missing. */
export function hubDir(home: string): string {
  const dir = join(home, FOLDER);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAtomically(file: string, text: string) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  try {
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * The key that signs every company's event log: 32 random bytes made on the first start, then read. Never printed,
 * logged or sent. A damaged key stops the hub: a new one would make every log line fail its check.
 */
export function loadHubKey(dir: string): Uint8Array {
  const file = join(dir, KEY_FILE);
  // An empty file is a key that was never written (the first start stopped half-way), so nothing was signed with it.
  if (existsSync(file) && statSync(file).size === 0) rmSync(file);
  try {
    writeFileSync(file, randomBytes(KEY_BYTES), { flag: 'wx', mode: 0o600 });
    chmodSync(file, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = readFileSync(file);
  if (key.length !== KEY_BYTES) {
    throw new HubHomeError(
      `${file} should hold ${KEY_BYTES} bytes but holds ${key.length}. Put back the original from a backup: with a new key, every company's log would fail its check.`,
    );
  }
  return new Uint8Array(key);
}

/** A company in the registry: its id and its project folder. */
export interface RegistryEntry {
  id: string;
  root: string;
}

/** The companies the hub runs. A missing file is an empty lobby; a broken one stops the hub rather than forget them. */
export function readRegistry(dir: string, warn: (line: string) => void = () => {}): RegistryEntry[] {
  const file = join(dir, REGISTRY_FILE);
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    raw = undefined;
  }
  const list = isObj(raw) ? raw.companies : undefined;
  if (!Array.isArray(list)) {
    throw new HubHomeError(`${file} isn't the hub's list of companies. Fix it, or delete it and add the folders again: each folder keeps its company in .worklings/.`);
  }
  const entries: RegistryEntry[] = [];
  for (const item of list as unknown[]) {
    const id = isObj(item) ? safeId(item.id) : undefined;
    const root = isObj(item) && typeof item.root === 'string' && isAbsolute(item.root) ? item.root : undefined;
    if (!id || !root) {
      warn(`skipped an entry of ${file} without a usable id and folder`);
      continue;
    }
    if (entries.some((e) => e.id === id || (isInside(e.root, root) && isInside(root, e.root)))) {
      warn(`skipped a second entry for ${id} in ${file}`);
      continue;
    }
    entries.push({ id, root });
  }
  return entries;
}

export function writeRegistry(dir: string, entries: readonly RegistryEntry[]) {
  writeAtomically(join(dir, REGISTRY_FILE), `${JSON.stringify({ version: 1, companies: entries.map(({ id, root }) => ({ id, root })) }, null, 2)}\n`);
}

/** The person's settings in ~/.worklings/settings.json, each null when it is missing or unusable. */
export interface HubSettings {
  /** Their name in messages ("Robin"). */
  stakeholder: string | null;
  /** The hub's cap on desks across companies. */
  maxDesks: number | null;
  /** The loopback port `tailscale serve` proxies to, kept the same between runs (Tailscale's entry names it). */
  tailnetPort: number | null;
}

function readSettingsObject(dir: string): Obj | null {
  const file = join(dir, SETTINGS_FILE);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return isObj(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function readSettings(dir: string): HubSettings {
  const raw = readSettingsObject(dir) ?? {};
  const name = typeof raw.stakeholder === 'string' ? raw.stakeholder.trim() : '';
  const whole = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
  return {
    stakeholder: PERSON_NAME.test(name) ? name : null,
    maxDesks: whole(raw.maxDesks, 1, Number.MAX_SAFE_INTEGER),
    tailnetPort: whole(raw.tailnetPort, 1024, 65_535),
  };
}

/** Changes some settings and keeps every other key the person put there. A file that isn't JSON is left alone. */
export function updateSettings(dir: string, patch: Obj) {
  const current = readSettingsObject(dir);
  if (current === null) throw new HubHomeError(`${join(dir, SETTINGS_FILE)} isn't a JSON object, so Worklings won't change it. Fix it first.`);
  writeAtomically(join(dir, SETTINGS_FILE), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
}

/**
 * `git config user.name` as git answers it in `cwd`, or null when git or the setting is missing. Git is started by its
 * full path from the PATH's absolute folders (findGit): by name, a relative PATH entry (".", "node_modules/.bin") would
 * find a git of the company's folder's own first, and run it there.
 */
export function gitUserName(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const git = findGit(env);
  if (git === null) return Promise.resolve(null);
  return new Promise((done) => {
    execFile(git, ['config', '--get', 'user.name'], { cwd, env, timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
      done(error ? null : String(stdout).trim() || null);
    });
  });
}

/**
 * The stakeholder's name for a new company: "stakeholder" in ~/.worklings/settings.json, else the first word of
 * `git config user.name` (read in the company's folder, so a project's own identity counts), else empty.
 */
export async function stakeholderName(dir: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const saved = readSettings(dir).stakeholder;
  if (saved) return saved;
  const first = (await gitUserName(cwd, env))?.split(/\s+/)[0] ?? '';
  return PERSON_NAME.test(first) ? first : '';
}

/** The hub that holds the lock: its process and port. */
export interface HubLock {
  pid: number;
  port: number;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The hub running on this machine for this folder, from its lock, or null when there is none (or it died). */
export function runningHub(dir: string): HubLock | null {
  const file = join(dir, LOCK_FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!isObj(raw) || !Number.isInteger(raw.pid) || !Number.isInteger(raw.port)) return null;
    const lock = { pid: raw.pid as number, port: raw.port as number };
    return alive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

/** A lock file as it is on disk: its text, the hub it names (null while it is half-written) and when it was written. */
interface LockOnDisk {
  text: string;
  holder: HubLock | null;
  /** The folder a company's lock was taken in. */
  root: string | null;
  writtenAt: number;
}

/** A lock nobody can read yet is one a hub is still writing for this long; after that, one a hub left half-written. */
const HALF_WRITTEN_MS = 10_000;

function lockOnDisk(file: string): LockOnDisk | null {
  let text: string;
  let writtenAt: number;
  try {
    writtenAt = statSync(file).mtimeMs;
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    raw = undefined; // half-written: its hub is still writing it, or died doing so
  }
  const holder = isObj(raw) && Number.isInteger(raw.pid) && Number.isInteger(raw.port) ? { pid: raw.pid as number, port: raw.port as number } : null;
  return { text, holder, root: isObj(raw) && typeof raw.root === 'string' ? raw.root : null, writtenAt };
}

/** Left by a hub that is gone, or by this process: two hubs in one process, as tests start them one after the other, are left to their caller. */
function leftOver(lock: LockOnDisk): boolean {
  if (!lock.holder) return Date.now() - lock.writtenAt > HALF_WRITTEN_MS;
  return lock.holder.pid === process.pid || !alive(lock.holder.pid);
}

/** Creates the file holding `text` only when there is none ('wx'): false when it exists. */
function created(file: string, text: string): boolean {
  try {
    writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Removes a left-over lock so a new one can be made, while holding `<lock>.taking`, made with 'wx' too: of hubs taking
 * over at once only one removes it, and only while it is still the left-over one. False while another hub is taking it
 * over; one left by a hub that died doing so goes after a while.
 */
function cleared(file: string, seen: string): boolean {
  const taking = `${file}.taking`;
  if (!created(taking, `${process.pid}\n`)) {
    const since = statSync(taking, { throwIfNoEntry: false })?.mtimeMs;
    if (since === undefined) return true; // that hub is done: look again
    if (Date.now() - since <= HALF_WRITTEN_MS) return false;
    rmSync(taking, { force: true });
    if (!created(taking, `${process.pid}\n`)) return false;
  }
  try {
    if (lockOnDisk(file)?.text === seen) rmSync(file, { force: true });
    return true;
  } finally {
    rmSync(taking, { force: true });
  }
}

/**
 * Takes `file` for this hub: it is created only when there is none ('wx'), so of hubs starting at once one gets it. A
 * lock `stale` says is left over is taken over; a live hub's refuses with `held`'s error, which also says when another
 * hub is starting at the same moment. Returns the release, which removes the lock only while it is still this hub's.
 */
function lockWith(file: string, text: string, stale: (lock: LockOnDisk) => boolean, held: (holder: HubLock | null) => Error): () => void {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (created(file, text)) {
      return () => {
        if (lockOnDisk(file)?.text === text) rmSync(file, { force: true });
      };
    }
    const lock = lockOnDisk(file);
    if (lock === null) continue;
    if (!stale(lock)) throw held(lock.holder);
    if (!cleared(file, lock.text)) throw held(null);
  }
  throw held(null);
}

/** Marks this process as the hub for these companies, so a second hub doesn't open the same desks. Returns the release. */
export function takeLock(dir: string, port: number): () => void {
  return lockWith(join(dir, LOCK_FILE), `${JSON.stringify({ pid: process.pid, port })}\n`, leftOver, (holder) =>
    new HubHomeError(
      holder
        ? `Another Worklings hub is running (process ${holder.pid}, port ${holder.port}). Open http://127.0.0.1:${holder.port}/ or stop it first.`
        : 'Another Worklings hub is starting. Wait a moment, or stop it first.',
    ),
  );
}

/** Another hub runs the company, as the sentence says. */
export class HeldByAnotherHub extends Error {}

/** The same folder, links resolved: a lock that names another folder came along when the folder was copied. */
function sameFolderOnDisk(a: string, b: string): boolean {
  try {
    const [x, y] = [realpathSync.native(a), realpathSync.native(b)];
    return isInside(x, y) && isInside(y, x);
  } catch {
    return false; // the folder the lock names is gone: it was moved or copied from there
  }
}

/**
 * Marks this hub as the one that runs the company in `root`, with `<root>/.worklings/hub.lock`. A hub started from
 * another home shares no ~/.worklings lock, and both would append to the company's log; with this one the second hub
 * refuses the company with a sentence naming the first. A lock left by a hub that is gone, and one copied along with the
 * folder, are taken over. Returns the release.
 */
export function takeCompanyLock(root: string, port: number): () => void {
  mkdirSync(plainPath(root, COMPANY_STATE, HubHomeError), { recursive: true });
  // Out of git from the start, as the company's store keeps the folder.
  const ignore = plainPath(root, `${COMPANY_STATE}/.gitignore`, HubHomeError);
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  const file = plainPath(root, `${COMPANY_STATE}/${LOCK_FILE}`, HubHomeError);
  const stale = (lock: LockOnDisk) => (lock.root !== null && !sameFolderOnDisk(lock.root, root)) || leftOver(lock);
  return lockWith(file, `${JSON.stringify({ pid: process.pid, port, root })}\n`, stale, (holder) =>
    new HeldByAnotherHub(
      holder
        ? `Another Worklings hub runs this company (process ${holder.pid}, port ${holder.port}). Open it at http://127.0.0.1:${holder.port}/, or stop that hub and add the folder here again.`
        : 'Another Worklings hub is opening this company right now. Wait a moment, then add the folder again.',
    ),
  );
}
