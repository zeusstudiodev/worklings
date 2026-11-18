// v0.9 (SPEC-v0.9.md, "The pack format"): installs packs into a project's .claude/ as plain files, records them in
// .claude/worklings-packs.json, reads how they stand, and removes them. The office does this at the person's request,
// before a job's session starts; no desk writes these files, so the desk policy (writes under .claude/ always ask) is
// untouched. Every path goes through plainPath, and a project's files are untrusted: a file of the person's own is never
// written over, and the record never vouches for a file the library didn't write.
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emptyRecord, type FolderPacks, type JobPack, PACK_IDS, PACK_RECORD, type PackId, type PackPlace, type PackRecord, packOf, parsePackRecord, stateOf } from '../core/packs.ts';
import { LIBRARY_DIR } from '../paths.ts';
import { isLink, plainPath } from '../safe-fs.ts';

/** A pack that can't be added or removed, with the sentence that says why. */
export class PackRefusal extends Error {}

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** The most of the record read. */
const RECORD_BYTES = 1024 * 1024;

/** The pack's own copy of a file, in the library. */
export const sourceOf = (id: PackId, file: string, library = LIBRARY_DIR): string => join(library, 'packs', id, ...file.split('/'));

/** Each of a pack's files as the library has them. */
function sources(id: PackId, library: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const file of packOf(id).files) out[file] = readFileSync(sourceOf(id, file, library));
  return out;
}

const expectedOf = (id: PackId, library: string): Record<string, string> => Object.fromEntries(Object.entries(sources(id, library)).map(([f, b]) => [f, sha(b)]));

/** A file's hash, or null when it isn't a plain file there (missing, a folder, a link, unreadable). */
function hashAt(path: string): string | null {
  try {
    if (isLink(path)) return null;
    const s = statSync(path, { throwIfNoEntry: false });
    return s?.isFile() ? sha(readFileSync(path)) : null;
  } catch {
    return null;
  }
}

const claudeDir = (root: string) => plainPath(root, '.claude', PackRefusal);
const inClaude = (root: string, file: string) => plainPath(root, join('.claude', ...file.split('/')), PackRefusal);

/** The record as a file holds it: missing, read, or there but not something Worklings can read (never written over). */
function loadRecord(root: string): { kind: 'none' } | { kind: 'read'; record: PackRecord } | { kind: 'unreadable' } {
  try {
    const path = inClaude(root, PACK_RECORD);
    const s = statSync(path, { throwIfNoEntry: false });
    if (!s) return { kind: 'none' };
    if (!s.isFile() || s.size > RECORD_BYTES) return { kind: 'unreadable' };
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'unreadable' };
    return { kind: 'read', record: parsePackRecord(raw) };
  } catch {
    return { kind: 'unreadable' };
  }
}

export function readRecord(root: string): PackRecord {
  const loaded = loadRecord(root);
  return loaded.kind === 'read' ? loaded.record : emptyRecord();
}

const UNREADABLE_RECORD = `This folder's .claude/${PACK_RECORD} isn't a record Worklings can read, so it leaves the packs alone. Fix or delete that file first.`;

function writeRecord(root: string, record: PackRecord) {
  const path = inClaude(root, PACK_RECORD);
  if (Object.keys(record.packs).length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

/** The folders under .claude/ a pack writes into. */
const PACK_FOLDERS = [...new Set(PACK_IDS.flatMap((id) => packOf(id).files.map((f) => f.split('/').slice(0, -1).join('/')).filter(Boolean)))];

/** Why .claude/ can't take files, or null when it can. */
export function blockedWhy(root: string): string | null {
  const blocked = "Worklings can't write to this folder's .claude/, so packs can't be added.";
  try {
    const dir = claudeDir(root);
    if (existsSync(dir) && !statSync(dir).isDirectory()) return blocked;
    accessSync(existsSync(dir) ? dir : root, constants.W_OK);
    for (const sub of PACK_FOLDERS) {
      const at = join(dir, ...sub.split('/'));
      if (existsSync(at)) {
        if (isLink(at) || !statSync(at).isDirectory()) return blocked;
        accessSync(at, constants.W_OK);
      }
    }
    const record = join(dir, PACK_RECORD);
    if (existsSync(record)) {
      if (isLink(record) || !statSync(record).isFile()) return blocked;
      accessSync(record, constants.W_OK);
    }
    return null;
  } catch {
    return blocked;
  }
}

/** How every pack stands in a folder, for the start form. `domain` and `empty` are the detector's. */
export function folderPacks(root: string, kind: { domain: string | null; empty: boolean }, library = LIBRARY_DIR): FolderPacks {
  const record = readRecord(root);
  const packs = {} as Record<PackId, PackPlace>;
  for (const id of PACK_IDS) {
    const now: Record<string, string | null> = {};
    for (const file of packOf(id).files) {
      try {
        now[file] = hashAt(inClaude(root, file));
      } catch {
        now[file] = null;
      }
    }
    packs[id] = stateOf(id, record.packs[id], now, expectedOf(id, library));
  }
  return { blocked: existsSync(root) ? blockedWhy(root) : null, domain: kind.domain, empty: kind.empty, packs };
}

export interface Installed {
  /** Packs written now. */
  added: PackId[];
  /** Packs the folder already had, as added. */
  already: PackId[];
  /** What this install made or changed, so a job that doesn't start can take it back exactly. */
  made: { dirs: string[]; files: string[]; record: { before: Buffer | null } | null };
}

const NOTHING: Installed['made'] = { dirs: [], files: [], record: null };

/**
 * Adds packs to the project's .claude/. Everything is checked before anything is written: a file of the person's own in
 * a pack's place, a pack edited or partly removed, a record it can't read, or a .claude/ it can't write refuses the lot.
 * A write that fails half way takes back what it wrote.
 */
export function installPacks(root: string, ids: readonly PackId[], o: { library?: string; now?: () => number } = {}): Installed {
  const library = o.library ?? LIBRARY_DIR;
  const wanted = PACK_IDS.filter((id) => ids.includes(id));
  if (wanted.length === 0) return { added: [], already: [], made: NOTHING };
  const blocked = blockedWhy(root);
  if (blocked) throw new PackRefusal(blocked);
  const loaded = loadRecord(root);
  if (loaded.kind === 'unreadable') throw new PackRefusal(UNREADABLE_RECORD);
  const record = loaded.kind === 'read' ? loaded.record : emptyRecord();
  const places = folderPacks(root, { domain: null, empty: false }, library).packs;
  const added: PackId[] = [];
  const already: PackId[] = [];
  for (const id of wanted) {
    const place = places[id];
    const title = packOf(id).title;
    if (place.state === 'installed') already.push(id);
    else if (place.state === 'conflict') throw new PackRefusal(`This folder has its own .claude/${place.file ?? ''}, so the ${title} pack would replace it. Rename that file, or leave the pack out.`);
    else if (place.state === 'edited' || place.state === 'partial') {
      throw new PackRefusal(
        record.packs[id]
          ? `The ${title} pack is in this folder already, edited or partly removed. Worklings leaves it as it is: remove it with \`worklings packs remove ${id}\` to add it afresh.`
          : `Part of the ${title} pack is in this folder already, and it isn't in the record. Worklings leaves it as it is: delete its files in .claude/ to add it afresh.`,
      );
    } else added.push(id);
  }
  if (added.length === 0) return { added, already, made: NOTHING };
  const recordPath = inClaude(root, PACK_RECORD);
  const made: Installed['made'] = { dirs: [], files: [], record: null };
  const mkdir = (dir: string) => {
    const missing: string[] = [];
    for (let d = dir; !existsSync(d); d = dirname(d)) missing.unshift(d);
    for (const d of missing) {
      mkdirSync(d);
      made.dirs.push(d);
    }
  };
  try {
    const at = new Date((o.now ?? Date.now)()).toISOString();
    for (const id of added) {
      const files: Record<string, string> = {};
      for (const [file, bytes] of Object.entries(sources(id, library))) {
        const path = inClaude(root, file);
        mkdir(dirname(path));
        writeFileSync(path, bytes, { flag: 'wx' });
        made.files.push(path);
        files[file] = sha(bytes);
      }
      record.packs[id] = { version: 1, added: at, files };
    }
    made.record = { before: existsSync(recordPath) ? readFileSync(recordPath) : null };
    writeRecord(root, record);
  } catch (error) {
    restore(root, made);
    throw error instanceof PackRefusal ? error : new PackRefusal(`Worklings couldn't add the packs: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { added, already, made };
}

/** Puts back what an install made or changed; never throws, and leaves anything that changed since as it is. */
function restore(root: string, made: Installed['made']) {
  const quietly = (step: () => void) => {
    try {
      step();
    } catch {
      // gone already, or changed since: it stays
    }
  };
  if (made.record) {
    const recordPath = inClaude(root, PACK_RECORD);
    quietly(() => (made.record?.before ? writeFileSync(recordPath, made.record.before) : existsSync(recordPath) && unlinkSync(recordPath)));
  }
  for (const path of [...made.files].reverse()) quietly(() => unlinkSync(path));
  for (const dir of [...made.dirs].reverse()) quietly(() => readdirSync(dir).length === 0 && rmdirSync(dir));
}

/** Takes back an install for a job that didn't start: the files it wrote, the record, and the folders it made. Never throws. */
export function undoInstall(root: string, installed: Installed): void {
  restore(root, installed.made);
}

export interface Removed {
  /** Files deleted, as paths under .claude/. */
  removed: string[];
  /** Files left because they aren't the pack's as added (edited, or never the library's). */
  kept: string[];
}

/** Removes a pack: its files that are still the library's and the record's, then its line in the record. */
export function removePack(root: string, id: PackId, library = LIBRARY_DIR): Removed {
  const loaded = loadRecord(root);
  if (loaded.kind === 'unreadable') throw new PackRefusal(UNREADABLE_RECORD);
  const record = loaded.kind === 'read' ? loaded.record : emptyRecord();
  const entry = record.packs[id];
  if (!entry) throw new PackRefusal(`The ${packOf(id).title} pack isn't recorded in this folder's .claude/${PACK_RECORD}, so Worklings leaves its files alone; delete them yourself if you don't want them.`);
  const expected = expectedOf(id, library);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const file of packOf(id).files) {
    const path = inClaude(root, file);
    const now = hashAt(path);
    if (now === null) continue;
    if (now === entry.files[file] && now === expected[file]) {
      unlinkSync(path);
      removed.push(file);
      for (let dir = dirname(path); dir !== claudeDir(root) && readdirSync(dir).length === 0; dir = dirname(dir)) rmdirSync(dir);
    } else kept.push(file);
  }
  delete record.packs[id];
  writeRecord(root, record);
  return { removed, kept };
}

/** The packs a job started with, and how each stands in its folder now. */
export function jobPacks(root: string, ids: readonly PackId[], library = LIBRARY_DIR): JobPack[] {
  if (ids.length === 0) return [];
  let places: Record<PackId, PackPlace> | null = null;
  try {
    places = folderPacks(root, { domain: null, empty: false }, library).packs;
  } catch {
    places = null;
  }
  return PACK_IDS.filter((id) => ids.includes(id)).map((id) => ({ id, title: packOf(id).title, state: places?.[id].state ?? 'absent' }));
}
