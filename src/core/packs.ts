// v0.9 (SPEC-v0.9.md): packs, opt-in Claude Code setup a job can start with. Each is plain files under the project's
// .claude/ that the person can read, edit or delete, off unless they add it, and recommended only where a paired bench
// against plain Claude Code showed it helped. 0.4.0 ships Kickoff alone (the maintainer, 18 Nov 2026): check before done
// and the review round were measured and not shipped (docs/benchmark.md, "Packs"). Pure, with no Node APIs: the start form, the CLI
// and the installer read it alike. The files themselves are in library/packs/<id>/, laid out as they land in .claude/.

export const PACK_IDS = ['kickoff'] as const;
export type PackId = (typeof PACK_IDS)[number];
export const isPackId = (v: unknown): v is PackId => typeof v === 'string' && (PACK_IDS as readonly string[]).includes(v);

export interface Pack {
  id: PackId;
  title: string;
  /** What it does, in one sentence. */
  does: string;
  /** What kind of request it is for, in a few words ("For short or open requests"). */
  forWhat: string;
  /** What it costs, as the start form shows it before anyone adds it. */
  cost: string;
  /** What the bench measured, in plain words. */
  measured: string;
  /** The most it may cost against plain, by the median pair, for the bench's decision rule. */
  costCeiling: number;
  /** Its files, as paths under .claude/ (and under library/packs/<id>/). */
  files: readonly string[];
}

export const PACKS: readonly Pack[] = [
  {
    id: 'kickoff',
    title: 'Kickoff',
    does: 'Claude Code reads the project, then asks two to four questions that change the result, each with its pick, and waits for your answers.',
    forWhat: 'For short or open requests',
    cost: 'One round of questions in the inbox before the build, and one answer from you.',
    measured:
      'In our tests it came closer to what was asked than plain Claude Code in all 6 runs, with a stand-in who knew the full request answering. The questions cost a few cents; the whole job about 3x a plain guess, a few tens of cents.',
    costCeiling: 1.5,
    files: ['rules/worklings-kickoff.md'],
  },
];

export const packOf = (id: PackId): Pack => PACKS.find((p) => p.id === id) as Pack;

/** The pack ids in a list read from a record or the log, in catalogue order; anything else is left out. */
export const packList = (raw: unknown): PackId[] => (Array.isArray(raw) ? PACK_IDS.filter((id) => raw.includes(id)) : []);

/** The packs a request names, in catalogue order, or a sentence saying which name isn't a pack. */
export function cleanPackIds(raw: unknown): { ok: true; ids: PackId[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, message: 'Name the packs as a list.' };
  for (const id of raw) {
    if (!isPackId(id)) return { ok: false, message: `${typeof id === 'string' ? `"${id.slice(0, 40)}"` : 'That'} isn't a pack. The packs are ${PACK_IDS.join(', ')}.` };
  }
  return { ok: true, ids: PACK_IDS.filter((id) => raw.includes(id)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The record: .claude/worklings-packs.json

export const PACK_RECORD = 'worklings-packs.json';

export interface PackRecordEntry {
  version: number;
  /** ISO time it was added. */
  added: string;
  /** Each file's path under .claude/ and the SHA-256 of what was written. */
  files: Record<string, string>;
}

export interface PackRecord {
  version: 1;
  packs: Partial<Record<PackId, PackRecordEntry>>;
}

export const emptyRecord = (): PackRecord => ({ version: 1, packs: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The record from its JSON, keeping only what is well formed: it is a project file anyone may edit. */
export function parsePackRecord(raw: unknown): PackRecord {
  const out = emptyRecord();
  if (!isObj(raw) || !isObj(raw.packs)) return out;
  for (const id of PACK_IDS) {
    if (!Object.hasOwn(raw.packs, id)) continue;
    const e = raw.packs[id];
    if (!isObj(e) || !isObj(e.files)) continue;
    const files: Record<string, string> = {};
    for (const [path, hash] of Object.entries(e.files)) {
      if (packOf(id).files.includes(path) && typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) files[path] = hash;
    }
    out.packs[id] = { version: typeof e.version === 'number' ? e.version : 1, added: typeof e.added === 'string' ? e.added : '', files };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// What a folder holds

/**
 * A pack in a folder: not there, there as added, there with a file edited, partly removed, or blocked by a file of the
 * person's own where one of its files would go.
 */
export type PackState = 'absent' | 'installed' | 'edited' | 'partial' | 'conflict';

export interface PackPlace {
  state: PackState;
  /** For a conflict, the person's file in the way (a path under .claude/). */
  file?: string;
}

/** What the start form needs to know about a folder's packs (the hub's folder reading). */
export interface FolderPacks {
  /** Whether .claude/ can be written; null when it can, else why not. */
  blocked: string | null;
  /** The detector's kind of project: its domain id, or null; and whether the folder has no code yet. */
  domain: string | null;
  empty: boolean;
  packs: Record<PackId, PackPlace>;
}

const PACK_STATES: readonly PackState[] = ['absent', 'installed', 'edited', 'partial', 'conflict'];

/** A folder's packs as the hub sent them, or null when the answer doesn't hold them (an older hub). */
export function cleanFolderPacks(raw: unknown): FolderPacks | null {
  if (!isObj(raw) || !isObj(raw.packs)) return null;
  const packs = {} as Record<PackId, PackPlace>;
  for (const id of PACK_IDS) {
    const p = Object.hasOwn(raw.packs, id) ? raw.packs[id] : undefined;
    const state = isObj(p) && (PACK_STATES as readonly unknown[]).includes(p.state) ? (p.state as PackState) : 'absent';
    packs[id] = isObj(p) && typeof p.file === 'string' ? { state, file: p.file } : { state };
  }
  return {
    blocked: typeof raw.blocked === 'string' ? raw.blocked : null,
    domain: typeof raw.domain === 'string' ? raw.domain : null,
    empty: raw.empty === true,
    packs,
  };
}

/** Every pack absent, in a folder that takes them (a new folder, the demo's). */
export function noPacks(empty: boolean, domain: string | null = null): FolderPacks {
  return { blocked: null, domain, empty, packs: Object.fromEntries(PACK_IDS.map((id) => [id, { state: 'absent' }])) as Record<PackId, PackPlace> };
}

/**
 * A pack's state from what is on disk: each file's hash now (null when missing) and the library's hashes. Only files with
 * the library's exact contents count as the pack as added, whatever the record says: the record is a project file anyone
 * may write, so a hash in it never vouches for a file.
 */
export function stateOf(id: PackId, entry: PackRecordEntry | undefined, now: Readonly<Record<string, string | null>>, expected: Readonly<Record<string, string>>): PackPlace {
  const files = packOf(id).files;
  const there = files.filter((f) => now[f] !== null && now[f] !== undefined);
  if (there.length === 0) return { state: 'absent' };
  if (entry) {
    if (there.length < files.length) return { state: 'partial' };
    return files.every((f) => now[f] === expected[f]) ? { state: 'installed' } : { state: 'edited' };
  }
  // No record: files with the pack's exact contents count as it; anything else in its place is the person's own.
  const own = there.find((f) => now[f] !== expected[f]);
  if (own !== undefined) return { state: 'conflict', file: own };
  return there.length === files.length ? { state: 'installed' } : { state: 'partial' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Recommendations (SPEC-v0.9.md, "Recommendation rules")

/** A request of at most this many words counts as short. */
export const SHORT_WORDS = 40;

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** The task kinds a request in a folder falls under: short, existing or new, and the folder's domain when it has one. */
export function taskKinds(input: { domain: string | null; empty: boolean; words: string }): string[] {
  const kinds: string[] = [];
  const n = wordCount(input.words);
  if (n > 0 && n <= SHORT_WORDS) kinds.push('short');
  kinds.push(input.empty ? 'new' : 'existing');
  if (input.domain) kinds.push(input.domain);
  return kinds;
}

/**
 * Where each pack met its decision rule in the bench (SPEC-v0.9.md, "How each pack is measured"), by task kind. A pack
 * with no kinds here is never recommended. The v0.9 bench (docs/benchmark.md, "Packs", 18 Nov 2026) met no rule, and
 * the rule isn't changed after seeing the data, so it is empty: kickoff passed on quality but missed its cost line.
 */
export const RECOMMENDED: Readonly<Record<PackId, readonly string[]>> = {
  kickoff: [],
};

export interface Recommendation {
  id: PackId;
  /** Why, in a few words: "For a short request". */
  why: string;
}

const WHY: Readonly<Record<string, string>> = { short: 'For a short request', existing: 'For work in existing code', new: 'For a new project' };

/** The packs to recommend for a request in a folder, in catalogue order; never one the folder already has. */
export function recommendPacks(input: { domain: string | null; empty: boolean; words: string }, have: readonly PackId[] = [], table: Readonly<Record<PackId, readonly string[]>> = RECOMMENDED): Recommendation[] {
  const kinds = taskKinds(input);
  const out: Recommendation[] = [];
  for (const id of PACK_IDS) {
    if (have.includes(id)) continue;
    const kind = kinds.find((k) => table[id].includes(k));
    if (kind !== undefined) out.push({ id, why: WHY[kind] ?? 'Helped on this kind of project in our tests' });
  }
  return out;
}

/** What the office shows of a job's packs: those it started with, and how each stands in the folder now. */
export interface JobPack {
  id: PackId;
  title: string;
  state: PackState;
}
